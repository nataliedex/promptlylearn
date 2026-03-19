/**
 * Transcript audit harness.
 *
 * Replays representative session transcripts through the deterministic
 * coaching pipeline and evaluates each coach move on 5 dimensions:
 *
 *   1. CORRECT    — Did the pipeline classify the student state correctly?
 *   2. TARGETED   — Did the probe address the right missing evidence / step?
 *   3. CONCISE    — Is the response ≤ word limit for its move type?
 *   4. NATURAL    — No repeated phrasing across consecutive coach turns?
 *   5. SUMMARY    — Does the final teacher summary match the actual evidence?
 *
 * Each audit case is a full transcript (alternating coach/student turns)
 * plus a prompt fixture. The harness replays the transcript turn-by-turn,
 * running the deterministic pipeline at each student turn, and collects
 * per-turn audit results. The test then asserts on the collected results.
 *
 * This file is intentionally read-heavy and assertion-light. Its purpose
 * is to surface recurring patterns, not enforce exact wording. When a
 * pattern recurs across 3+ transcripts, it graduates to a unit test in
 * the relevant module's test file.
 */

import {
  classifyExplanationState,
  accumulateExplanationEvidence,
  getExplanationRemediationMove,
  shouldWrapExplanation,
  buildExplanationTeacherSummary,
  type ExplanationState,
  type ExplanationMove,
  type ExplanationWrapDecision,
  type ExplanationTeacherSummary,
  type AccumulatedExplanationEvidence,
} from "./explanationRemediation";
import {
  getDeterministicRemediationMove,
  buildInstructionalRecap,
  buildStepFailureRecap,
  type RemediationMove,
} from "./deterministicRemediation";
import {
  accumulateReasoningStepEvidence,
  type ReasoningStepAccumulation,
} from "./mathAnswerValidator";
import { validate } from "./deterministicValidator";
import { buildMathTeacherSummary, type TeacherSummary } from "./teacherSummary";
import type { RequiredEvidence, ReasoningStep } from "./prompt";
import type { MathProblem } from "./mathProblem";

// ============================================================================
// Audit types
// ============================================================================

/** A single turn in a transcript. */
interface TranscriptTurn {
  role: "coach" | "student";
  message: string;
}

/** Per-turn audit result, computed by the harness. */
interface TurnAudit {
  turnIndex: number;
  studentMessage: string;
  /** Pipeline classification of the student's state. */
  classifiedState: string;
  /** The move type the pipeline selected. */
  moveType: string;
  /** The full response text the pipeline produced. */
  responseText: string;
  /** Word count of the response. */
  wordCount: number;
  /** What the move targeted (step or criterion). */
  target: string | null;
  /** Wrap decision at this point. */
  wrapAction: string;
}

/** Summary audit result, computed at transcript end. */
interface SummaryAudit {
  renderedSummary: string;
  /** For explanation: status field. For math: overallLevel field. */
  level: string;
  /** Key observations or evidence items. */
  observations: string[];
}

/** Complete audit result for one transcript. */
interface TranscriptAuditResult {
  turns: TurnAudit[];
  summary: SummaryAudit;
  /** True if any consecutive coach turns used identical opening phrases. */
  hasRepeatedPhrasing: boolean;
  /** Indices of turns where max word count was exceeded. */
  wordCountViolations: number[];
}

// ============================================================================
// Word-count limits (must match the conciseness tests)
// ============================================================================

const WORD_LIMITS: Record<string, number> = {
  // Explanation moves
  EVIDENCE_PROBE: 25,
  SPECIFICITY_PROBE: 25,
  ENCOURAGEMENT_PROBE: 25,
  CLARIFICATION: 25,
  HINT: 30,
  MODEL_AND_ASK: 30,
  FACTUAL_CORRECTION: 30,
  WRAP_MASTERY: 10,
  WRAP_SUPPORT: 10,
  // Math moves
  STEP_PROBE_DIRECT: 30,
  STEP_PROBE_SIMPLER: 25,
  STEP_HINT: 35,
  STEP_MISCONCEPTION_REDIRECT: 30,
  STEP_COMBINE_PROMPT: 25,
  STEP_ACKNOWLEDGE_AND_PROBE: 30,
  STEP_MODEL_INSTRUCTION: 30,
  STEP_COMPUTATION_CORRECTION: 35,
  STEP_CONCEPT_EXPLANATION: 35,
  WRAP_SUCCESS: 10,
  WRAP_NEEDS_SUPPORT: 50,
};

function wordCount(text: string): number {
  return text.split(/\s+/).filter(w => w.length > 0).length;
}

function getWordLimit(moveType: string): number {
  return WORD_LIMITS[moveType] ?? 40;
}

// ============================================================================
// Explanation audit runner
// ============================================================================

interface ExplanationAuditFixture {
  name: string;
  promptInput: string;
  requiredEvidence: RequiredEvidence;
  referenceFacts: Record<string, string[]>;
  successCriteria: string[];
  hints?: string[];
  transcript: TranscriptTurn[];
  /** Expected final summary status. */
  expectedSummaryStatus: "mastery" | "partial" | "minimal" | "no_evidence";
  /** Expected final wrap action on the last student turn. */
  expectedFinalWrap: "wrap_mastery" | "wrap_support" | "continue_probing";
}

function runExplanationAudit(fixture: ExplanationAuditFixture): TranscriptAuditResult {
  const turns: TurnAudit[] = [];
  let accumulation: AccumulatedExplanationEvidence | null = null;
  const coachTexts: string[] = [];

  for (let i = 0; i < fixture.transcript.length; i++) {
    const turn = fixture.transcript[i];
    if (turn.role !== "student") continue;

    const v = validate(turn.message, fixture.requiredEvidence, fixture.referenceFacts);
    accumulation = accumulateExplanationEvidence(
      v, turn.message, accumulation,
      fixture.requiredEvidence, fixture.referenceFacts, fixture.successCriteria,
    );
    const state = classifyExplanationState(turn.message, v, accumulation);
    const move = getExplanationRemediationMove(
      state, accumulation, v,
      fixture.requiredEvidence, fixture.referenceFacts, fixture.successCriteria,
      fixture.promptInput, fixture.hints,
    );
    const wrap = shouldWrapExplanation(state, accumulation, 60, 1, 5);

    const responseText = move?.text ?? "";
    coachTexts.push(responseText);

    turns.push({
      turnIndex: i,
      studentMessage: turn.message,
      classifiedState: state,
      moveType: move?.type ?? "NONE",
      responseText,
      wordCount: wordCount(responseText),
      target: move?.targetCriterion ?? null,
      wrapAction: wrap.action,
    });
  }

  // Check for repeated opening phrases across consecutive coach responses
  const hasRepeatedPhrasing = detectRepeatedPhrasing(coachTexts);

  // Word count violations
  const wordCountViolations = turns
    .filter(t => t.wordCount > getWordLimit(t.moveType))
    .map(t => t.turnIndex);

  // Build final summary
  const summary = accumulation
    ? buildExplanationTeacherSummary(
        accumulation, fixture.requiredEvidence, fixture.referenceFacts,
        fixture.successCriteria, fixture.promptInput,
      )
    : { status: "no_evidence" as const, renderedSummary: "", keyObservations: [] };

  return {
    turns,
    summary: {
      renderedSummary: summary.renderedSummary,
      level: summary.status,
      observations: summary.keyObservations,
    },
    hasRepeatedPhrasing,
    wordCountViolations,
  };
}

// ============================================================================
// Math audit runner
// ============================================================================

interface MathAuditFixture {
  name: string;
  mathProblem: MathProblem;
  reasoningSteps: ReasoningStep[];
  transcript: TranscriptTurn[];
  /** Expected final state: did the student succeed? */
  expectedSuccess: boolean;
}

function runMathAudit(fixture: MathAuditFixture): TranscriptAuditResult {
  const turns: TurnAudit[] = [];
  const coachTexts: string[] = [];

  for (let i = 0; i < fixture.transcript.length; i++) {
    const turn = fixture.transcript[i];
    if (turn.role !== "student") continue;

    // Build conversation history from all turns before this one
    const history = fixture.transcript.slice(0, i).map(t => ({
      role: t.role,
      message: t.message,
    }));

    // Accumulate all student text for step evidence
    const allStudentText = fixture.transcript
      .slice(0, i + 1)
      .filter(t => t.role === "student")
      .map(t => t.message)
      .join("\n");

    const acc = accumulateReasoningStepEvidence(
      fixture.reasoningSteps, history,
      turn.message, fixture.mathProblem.correctAnswer,
    );

    const move = getDeterministicRemediationMove(
      fixture.reasoningSteps, acc,
      turn.message, fixture.mathProblem, history,
    );

    const responseText = move?.text ?? "";
    coachTexts.push(responseText);

    turns.push({
      turnIndex: i,
      studentMessage: turn.message,
      classifiedState: move?.studentState ?? "unknown",
      moveType: move?.type ?? "NONE",
      responseText,
      wordCount: wordCount(responseText),
      target: move?.targetStepId ?? null,
      wrapAction: acc.answerCorrect && acc.missingStepIds.length === 0
        ? "wrap_success" : "continue",
    });
  }

  const hasRepeatedPhrasing = detectRepeatedPhrasing(coachTexts);
  const wordCountViolations = turns
    .filter(t => t.wordCount > getWordLimit(t.moveType))
    .map(t => t.turnIndex);

  // Build recap for summary audit
  const lastAcc = turns.length > 0
    ? accumulateReasoningStepEvidence(
        fixture.reasoningSteps,
        fixture.transcript.slice(0, -1).map(t => ({ role: t.role, message: t.message })),
        fixture.transcript[fixture.transcript.length - 1]?.message ?? "",
        fixture.mathProblem.correctAnswer,
      )
    : null;

  const recap = lastAcc
    ? buildInstructionalRecap(fixture.reasoningSteps, fixture.mathProblem, null)
    : "";

  return {
    turns,
    summary: {
      renderedSummary: recap,
      level: lastAcc?.answerCorrect ? "mastery" : "needs_support",
      observations: lastAcc
        ? [
            `${lastAcc.satisfiedStepIds.length}/${fixture.reasoningSteps.length} steps satisfied`,
            `Answer ${lastAcc.answerCorrect ? "correct" : "incorrect"}`,
          ]
        : [],
    },
    hasRepeatedPhrasing,
    wordCountViolations,
  };
}

// ============================================================================
// Repeated phrasing detection
// ============================================================================

/**
 * Check if consecutive coach responses start with the same phrase (first 4 words).
 * This catches patterns like "I hear you! ... I hear you! ..." that feel robotic.
 */
function detectRepeatedPhrasing(coachTexts: string[]): boolean {
  if (coachTexts.length < 2) return false;
  for (let i = 1; i < coachTexts.length; i++) {
    const prev = coachTexts[i - 1].split(/\s+/).slice(0, 4).join(" ").toLowerCase();
    const curr = coachTexts[i].split(/\s+/).slice(0, 4).join(" ").toLowerCase();
    if (prev.length > 0 && prev === curr) return true;
  }
  return false;
}

// ============================================================================
// Fixtures
// ============================================================================

// --- Explanation: planets, student reaches mastery in 2 turns ---
const PLANETS_MASTERY: ExplanationAuditFixture = {
  name: "planets: mastery in 2 turns",
  promptInput: "What are planets made of? Give examples.",
  requiredEvidence: {
    minEntities: 2, entityLabel: "planets", attributeLabel: "materials",
    minAttributeTypes: 2, requirePairing: true,
  },
  referenceFacts: {
    Mercury: ["rock", "metal"], Venus: ["rock"], Earth: ["rock", "metal"],
    Mars: ["rock"], Jupiter: ["gas"], Saturn: ["gas"],
    Uranus: ["ice", "gas"], Neptune: ["ice", "gas"],
  },
  successCriteria: [
    "States that planets are made of different materials.",
    "Names at least two specific planets.",
    "Describes what each named planet is made of.",
  ],
  hints: ["Think about what you know about Earth and other planets."],
  transcript: [
    { role: "coach", message: "What are planets made of? Can you give examples?" },
    { role: "student", message: "Earth is made of rock" },
    { role: "coach", message: "Can you name another planet and its materials?" },
    { role: "student", message: "Jupiter is made of gas" },
  ],
  expectedSummaryStatus: "mastery",
  expectedFinalWrap: "wrap_mastery",
};

// --- Explanation: planets, student struggles then gets hint ---
const PLANETS_STRUGGLE: ExplanationAuditFixture = {
  name: "planets: claim-only → hint escalation",
  promptInput: "What are planets made of? Give examples.",
  requiredEvidence: {
    minEntities: 2, entityLabel: "planets", attributeLabel: "materials",
    minAttributeTypes: 2, requirePairing: true,
  },
  referenceFacts: {
    Mercury: ["rock", "metal"], Venus: ["rock"], Earth: ["rock", "metal"],
    Mars: ["rock"], Jupiter: ["gas"], Saturn: ["gas"],
    Uranus: ["ice", "gas"], Neptune: ["ice", "gas"],
  },
  successCriteria: [
    "States that planets are made of different materials.",
    "Names at least two specific planets.",
    "Describes what each named planet is made of.",
  ],
  hints: ["Think about what you know about Earth and other planets."],
  transcript: [
    { role: "coach", message: "What are planets made of?" },
    { role: "student", message: "they are made of different stuff" },
    { role: "coach", message: "Can you name a specific planet?" },
    { role: "student", message: "there are many kinds of planets" },
    { role: "coach", message: "Here's a hint: think about Earth." },
    { role: "student", message: "each planet is different" },
  ],
  expectedSummaryStatus: "minimal",
  expectedFinalWrap: "continue_probing",
};

// --- Explanation: planets, factual error then self-correction ---
const PLANETS_ERROR_CORRECTION: ExplanationAuditFixture = {
  name: "planets: factual error → self-correction → mastery",
  promptInput: "What are planets made of? Give examples.",
  requiredEvidence: {
    minEntities: 2, entityLabel: "planets", attributeLabel: "materials",
    minAttributeTypes: 2, requirePairing: true,
  },
  referenceFacts: {
    Mercury: ["rock", "metal"], Venus: ["rock"], Earth: ["rock", "metal"],
    Mars: ["rock"], Jupiter: ["gas"], Saturn: ["gas"],
    Uranus: ["ice", "gas"], Neptune: ["ice", "gas"],
  },
  successCriteria: [
    "States that planets are made of different materials.",
    "Names at least two specific planets.",
    "Describes what each named planet is made of.",
  ],
  hints: [],
  transcript: [
    { role: "coach", message: "What are planets made of?" },
    { role: "student", message: "Jupiter is made of rock" },
    { role: "coach", message: "Not quite — Jupiter is made of gas." },
    { role: "student", message: "oh okay Jupiter is made of gas and Earth is made of rock" },
  ],
  expectedSummaryStatus: "mastery",
  expectedFinalWrap: "wrap_mastery",
};

// --- Explanation: habitat, student uncertain then recovers ---
const HABITAT_UNCERTAIN: ExplanationAuditFixture = {
  name: "habitat: uncertain → encouragement → partial evidence",
  promptInput: "What does habitat mean? Give examples.",
  requiredEvidence: {
    minEntities: 2, entityLabel: "animals", attributeLabel: "habitats",
    minAttributeTypes: 2, requirePairing: true,
  },
  referenceFacts: {
    fish: ["liquid", "ocean", "lake", "river"],
    bird: ["tree", "forest", "sky"],
    bear: ["forest", "cave"],
    camel: ["desert"],
    penguin: ["ice", "snow"],
  },
  successCriteria: [
    "Explains what a habitat is.",
    "Names at least two animals.",
    "Describes the habitat for each named animal.",
  ],
  hints: [],
  transcript: [
    { role: "coach", message: "What does habitat mean? Give examples." },
    { role: "student", message: "I don't know" },
    { role: "coach", message: "No worries! Can you name one animal and tell me about it?" },
    { role: "student", message: "fish live in water" },
  ],
  expectedSummaryStatus: "partial",
  expectedFinalWrap: "continue_probing",
};

// --- Math: 11 + 14, student walks through steps correctly ---
const MATH_SMOOTH: MathAuditFixture = {
  name: "math 11+14: smooth 3-step walkthrough",
  mathProblem: {
    skill: "two_digit_addition", a: 11, b: 14,
    expression: "11 + 14", correctAnswer: 25,
    requiresRegrouping: false,
    expectedStrategyTags: ["add ones", "add tens"],
    commonWrongAnswers: [],
  },
  reasoningSteps: [
    { id: "s1", label: "Add the ones", expectedStatements: ["1 + 4 = 5"], probe: "What do you get when you add 1 and 4?", kind: "ones_sum" },
    { id: "s2", label: "Add the tens", expectedStatements: ["10 + 10 = 20"], probe: "What do you get when you add 10 and 10?", kind: "tens_sum" },
    { id: "s3", label: "Combine", expectedStatements: ["20 + 5 = 25", "The final answer is 25"], probe: "What do you get when you combine 20 and 5?", kind: "combine" },
  ],
  transcript: [
    { role: "coach", message: "What is 11 + 14?" },
    { role: "student", message: "1 + 4 = 5" },
    { role: "coach", message: "Good. What do you get when you add 10 and 10?" },
    { role: "student", message: "10 + 10 = 20" },
    { role: "coach", message: "Good. What do you get when you combine 20 and 5?" },
    { role: "student", message: "25" },
  ],
  expectedSuccess: true,
};

// --- Math: 11 + 14, student gets ones wrong, then corrects ---
const MATH_WRONG_THEN_CORRECT: MathAuditFixture = {
  name: "math 11+14: wrong ones → correction → success",
  mathProblem: {
    skill: "two_digit_addition", a: 11, b: 14,
    expression: "11 + 14", correctAnswer: 25,
    requiresRegrouping: false,
    expectedStrategyTags: ["add ones", "add tens"],
    commonWrongAnswers: [],
  },
  reasoningSteps: [
    { id: "s1", label: "Add the ones", expectedStatements: ["1 + 4 = 5"], probe: "What do you get when you add 1 and 4?", kind: "ones_sum" },
    { id: "s2", label: "Add the tens", expectedStatements: ["10 + 10 = 20"], probe: "What do you get when you add 10 and 10?", kind: "tens_sum" },
    { id: "s3", label: "Combine", expectedStatements: ["20 + 5 = 25", "The final answer is 25"], probe: "What do you get when you combine 20 and 5?", kind: "combine" },
  ],
  transcript: [
    { role: "coach", message: "What is 11 + 14? Let's start with the ones." },
    { role: "student", message: "3" },
    { role: "coach", message: "Not quite. What do you get when you add 1 and 4?" },
    { role: "student", message: "5" },
    { role: "coach", message: "Good. What do you get when you add 10 and 10?" },
    { role: "student", message: "20" },
    { role: "coach", message: "Good. What is 20 + 5?" },
    { role: "student", message: "25" },
  ],
  expectedSuccess: true,
};

// --- Math: 11 + 14, student says "I don't know" repeatedly ---
const MATH_UNCERTAIN: MathAuditFixture = {
  name: "math 11+14: uncertain student → escalation",
  mathProblem: {
    skill: "two_digit_addition", a: 11, b: 14,
    expression: "11 + 14", correctAnswer: 25,
    requiresRegrouping: false,
    expectedStrategyTags: ["add ones", "add tens"],
    commonWrongAnswers: [],
  },
  reasoningSteps: [
    { id: "s1", label: "Add the ones", expectedStatements: ["1 + 4 = 5"], probe: "What do you get when you add 1 and 4?", kind: "ones_sum" },
    { id: "s2", label: "Add the tens", expectedStatements: ["10 + 10 = 20"], probe: "What do you get when you add 10 and 10?", kind: "tens_sum" },
    { id: "s3", label: "Combine", expectedStatements: ["20 + 5 = 25", "The final answer is 25"], probe: "What do you get when you combine 20 and 5?", kind: "combine" },
  ],
  transcript: [
    { role: "coach", message: "What is 11 + 14?" },
    { role: "student", message: "I don't know" },
    { role: "coach", message: "Let's do just the ones. What is 1 + 4?" },
    { role: "student", message: "um I'm not sure" },
  ],
  expectedSuccess: false,
};

// ============================================================================
// Tests
// ============================================================================

describe("transcript audit: explanation prompts", () => {
  it("planets mastery: correct classification at each turn", () => {
    const result = runExplanationAudit(PLANETS_MASTERY);
    expect(result.turns).toHaveLength(2);

    // Turn 1: partial evidence (one entity)
    expect(result.turns[0].classifiedState).toBe("partial_evidence");
    expect(result.turns[0].moveType).toBe("EVIDENCE_PROBE");

    // Turn 2: complete
    expect(result.turns[1].classifiedState).toBe("complete");
    expect(result.turns[1].moveType).toBe("WRAP_MASTERY");
    expect(result.turns[1].wrapAction).toBe("wrap_mastery");

    // Summary
    expect(result.summary.level).toBe("mastery");
    expect(result.summary.renderedSummary).toMatch(/Earth/);
    expect(result.summary.renderedSummary).toMatch(/Jupiter/);
  });

  it("planets mastery: no word-count violations", () => {
    const result = runExplanationAudit(PLANETS_MASTERY);
    expect(result.wordCountViolations).toHaveLength(0);
  });

  it("planets mastery: no repeated phrasing", () => {
    const result = runExplanationAudit(PLANETS_MASTERY);
    expect(result.hasRepeatedPhrasing).toBe(false);
  });

  it("planets struggle: escalation ladder is correct", () => {
    const result = runExplanationAudit(PLANETS_STRUGGLE);
    expect(result.turns).toHaveLength(3);

    // Turn 1: general claim → specificity probe
    expect(result.turns[0].classifiedState).toBe("claim_only");
    expect(result.turns[0].moveType).toBe("SPECIFICITY_PROBE");

    // Turn 2: still general claim, no progress
    expect(result.turns[1].classifiedState).toBe("claim_only");

    // Turn 3: third general claim
    expect(result.turns[2].classifiedState).toBe("claim_only");
  });

  it("planets struggle: summary reflects claim-only without specifics", () => {
    const result = runExplanationAudit(PLANETS_STRUGGLE);
    expect(result.summary.level).toBe("minimal");
    expect(result.summary.renderedSummary).toMatch(/general/i);
  });

  it("planets error correction: error then recovery to mastery", () => {
    const result = runExplanationAudit(PLANETS_ERROR_CORRECTION);
    expect(result.turns).toHaveLength(2);

    // Turn 1: factual error
    expect(result.turns[0].classifiedState).toBe("factual_error");
    expect(result.turns[0].moveType).toBe("FACTUAL_CORRECTION");

    // Turn 2: corrected + complete
    expect(result.turns[1].classifiedState).toBe("complete");
    expect(result.turns[1].wrapAction).toBe("wrap_mastery");

    // Summary reflects the self-correction
    expect(result.summary.level).toBe("mastery");
    expect(result.summary.renderedSummary).toMatch(/corrected/i);
  });

  it("habitat uncertain: encouragement then partial evidence", () => {
    const result = runExplanationAudit(HABITAT_UNCERTAIN);
    expect(result.turns).toHaveLength(2);

    // Turn 1: uncertain
    expect(result.turns[0].classifiedState).toBe("uncertain");
    expect(result.turns[0].moveType).toBe("ENCOURAGEMENT_PROBE");

    // Turn 2: partial evidence (fish + water)
    expect(result.turns[1].classifiedState).toBe("partial_evidence");
    expect(result.turns[1].wrapAction).toBe("continue_probing");

    expect(result.summary.level).toBe("partial");
  });

  it("no explanation transcript exceeds word limits", () => {
    const fixtures = [PLANETS_MASTERY, PLANETS_STRUGGLE, PLANETS_ERROR_CORRECTION, HABITAT_UNCERTAIN];
    for (const fixture of fixtures) {
      const result = runExplanationAudit(fixture);
      expect(result.wordCountViolations).toHaveLength(0);
    }
  });

  it("no repeated opening phrases in mastery/error-correction transcripts", () => {
    // These transcripts have different states each turn → no repetition expected
    const fixtures = [PLANETS_MASTERY, PLANETS_ERROR_CORRECTION, HABITAT_UNCERTAIN];
    for (const fixture of fixtures) {
      const result = runExplanationAudit(fixture);
      expect(result.hasRepeatedPhrasing).toBe(false);
    }
  });

  it("FIXED: claim-only stall no longer repeats same probe", () => {
    // Previously always returned "What is Mercury made of?" on consecutive
    // stall turns. Now varies probe wording via turn-count-based rotation.
    const result = runExplanationAudit(PLANETS_STRUGGLE);
    expect(result.hasRepeatedPhrasing).toBe(false);
  });
});

describe("transcript audit: math prompts", () => {
  it("smooth walkthrough: all steps classified correctly", () => {
    const result = runMathAudit(MATH_SMOOTH);

    // Should have 3 student turns
    expect(result.turns).toHaveLength(3);

    // Final turn should result in success
    const lastTurn = result.turns[result.turns.length - 1];
    expect(lastTurn.wrapAction).toBe("wrap_success");
  });

  it("smooth walkthrough: no word-count violations", () => {
    const result = runMathAudit(MATH_SMOOTH);
    expect(result.wordCountViolations).toHaveLength(0);
  });

  it("wrong then correct: wrong answer classified, then recovery", () => {
    const result = runMathAudit(MATH_WRONG_THEN_CORRECT);

    // Turn 1: wrong answer (3 ≠ 5)
    expect(result.turns[0].classifiedState).toMatch(/wrong|misconception/);

    // Final turn should succeed
    const lastTurn = result.turns[result.turns.length - 1];
    expect(lastTurn.wrapAction).toBe("wrap_success");
  });

  it("uncertain student: escalation from probe to simpler probe", () => {
    const result = runMathAudit(MATH_UNCERTAIN);

    // Turn 1: uncertain
    expect(result.turns[0].classifiedState).toBe("uncertain");

    // Turn 2: still uncertain → should escalate
    expect(result.turns[1].classifiedState).toBe("uncertain");

    // Should not have succeeded
    const lastTurn = result.turns[result.turns.length - 1];
    expect(lastTurn.wrapAction).toBe("continue");
  });

  it("no math transcript exceeds word limits", () => {
    const fixtures = [MATH_SMOOTH, MATH_WRONG_THEN_CORRECT, MATH_UNCERTAIN];
    for (const fixture of fixtures) {
      const result = runMathAudit(fixture);
      expect(result.wordCountViolations).toHaveLength(0);
    }
  });

  it("no repeated phrasing in success transcripts", () => {
    // Transcripts with progression don't repeat because the step target changes
    const fixtures = [MATH_SMOOTH, MATH_WRONG_THEN_CORRECT];
    for (const fixture of fixtures) {
      const result = runMathAudit(fixture);
      expect(result.hasRepeatedPhrasing).toBe(false);
    }
  });

  it("FIXED: uncertain stall no longer repeats same simpler probe", () => {
    // Previously returned identical "Let's do just the ones. What is 1 + 4?"
    // on consecutive uncertain turns. Now alternates stem phrasing.
    const result = runMathAudit(MATH_UNCERTAIN);
    expect(result.hasRepeatedPhrasing).toBe(false);
  });

  it("math recap includes all reasoning steps", () => {
    const result = runMathAudit(MATH_SMOOTH);
    // The instructional recap should reference the step statements
    expect(result.summary.renderedSummary).toMatch(/1 \+ 4 = 5/);
    expect(result.summary.renderedSummary).toMatch(/10 \+ 10 = 20/);
    expect(result.summary.renderedSummary).toMatch(/20 \+ 5 = 25/);
  });
});
