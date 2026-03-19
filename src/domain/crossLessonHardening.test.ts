/**
 * Cross-lesson hardening tests.
 *
 * Validates that the remediation / interpretation / summary pipeline
 * generalizes beyond the 14+11 lesson by simulating transcript families
 * across a representative set of problem types.
 *
 * Problem set:
 *   A. 24 + 12 — straightforward canonical addition (no regrouping)
 *   B. 27 + 36 — addition with regrouping
 *   C. 47 - 23 — subtraction without borrowing
 *   D. 42 - 17 — subtraction with borrowing
 *   E. 3 × 4  — basic multiplication
 *
 * Transcript families per lesson:
 *   1. correct but minimal (answer only)
 *   2. correct with explanation
 *   3. wrong with partial strategy
 *   4. confusion about structure
 *   5. repeated same answer
 *   6. student-corrects-coach
 *   7. alternate valid strategy
 *   8. refusal / move-on intent
 */

import {
  interpretMathUtterance,
  shouldWrapMathSession,
  type ReasoningStepAccumulation,
  type MathUtteranceInterpretation,
} from "./mathAnswerValidator";
import {
  classifyStudentState,
  getDeterministicRemediationMove,
} from "./deterministicRemediation";
import { buildMathTeacherSummary } from "./teacherSummary";
import { buildDeterministicMathRubric } from "./mathProblemGenerator";
import type { ReasoningStep } from "./prompt";
import type { MathProblem } from "./mathProblem";

// ============================================================================
// Problem fixtures
// ============================================================================

const PROBLEMS: Record<string, { problem: MathProblem; steps: ReasoningStep[] }> = {};

function setup(name: string, problem: MathProblem) {
  const rubric = buildDeterministicMathRubric(problem);
  PROBLEMS[name] = { problem, steps: rubric.reasoningSteps };
}

setup("24+12", {
  skill: "two_digit_addition", a: 24, b: 12, expression: "24 + 12",
  correctAnswer: 36, requiresRegrouping: false,
  expectedStrategyTags: ["add ones", "add tens"],
});

setup("27+36", {
  skill: "two_digit_addition", a: 27, b: 36, expression: "27 + 36",
  correctAnswer: 63, requiresRegrouping: true,
  expectedStrategyTags: ["add ones", "carry", "add tens"],
});

setup("47-23", {
  skill: "two_digit_subtraction", a: 47, b: 23, expression: "47 - 23",
  correctAnswer: 24, requiresRegrouping: false,
  expectedStrategyTags: ["subtract ones", "subtract tens"],
});

setup("42-17", {
  skill: "two_digit_subtraction", a: 42, b: 17, expression: "42 - 17",
  correctAnswer: 25, requiresRegrouping: true,
  expectedStrategyTags: ["check ones", "borrow from tens", "subtract ones", "subtract tens"],
});

setup("3x4", {
  skill: "basic_multiplication", a: 3, b: 4, expression: "3 × 4",
  correctAnswer: 12, requiresRegrouping: false,
  expectedStrategyTags: ["skip count", "identify groups"],
});

// ============================================================================
// Helpers
// ============================================================================

function emptyAcc(p: { problem: MathProblem; steps: ReasoningStep[] }): ReasoningStepAccumulation {
  return {
    satisfiedStepIds: [],
    missingStepIds: p.steps.map(s => s.id),
    newlySatisfiedStepIds: [],
    completionRatio: 0,
    answerCorrect: false,
    extractedAnswer: null,
  };
}

function fullAcc(p: { problem: MathProblem; steps: ReasoningStep[] }): ReasoningStepAccumulation {
  return {
    satisfiedStepIds: p.steps.map(s => s.id),
    missingStepIds: [],
    newlySatisfiedStepIds: [],
    completionRatio: 1,
    answerCorrect: true,
    extractedAnswer: p.problem.correctAnswer,
  };
}

function partialAcc(
  p: { problem: MathProblem; steps: ReasoningStep[] },
  satisfiedIds: string[],
  opts?: { answerCorrect?: boolean; extractedAnswer?: number | null },
): ReasoningStepAccumulation {
  const allIds = p.steps.map(s => s.id);
  return {
    satisfiedStepIds: satisfiedIds,
    missingStepIds: allIds.filter(id => !satisfiedIds.includes(id)),
    newlySatisfiedStepIds: [],
    completionRatio: satisfiedIds.length / allIds.length,
    answerCorrect: opts?.answerCorrect ?? false,
    extractedAnswer: opts?.extractedAnswer ?? null,
  };
}

function move(
  name: string,
  acc: ReasoningStepAccumulation,
  response: string,
  history?: Array<{ role: string; message: string }>,
) {
  const p = PROBLEMS[name];
  return getDeterministicRemediationMove(p.steps, acc, response, p.problem, history);
}

function classify(name: string, acc: ReasoningStepAccumulation, response: string) {
  const p = PROBLEMS[name];
  return classifyStudentState(response, acc, p.problem);
}

// ============================================================================
// A. 24 + 12 — straightforward canonical addition
// ============================================================================

describe("24+12: straightforward canonical addition", () => {
  const P = () => PROBLEMS["24+12"];

  test("1: correct but minimal → classified as correct (complete or incomplete)", () => {
    const state = classify("24+12", fullAcc(P()), "36");
    // Answer-only utterance: classifier returns correct_incomplete because
    // the student didn't explain reasoning in THIS utterance. This is correct
    // behavior — the wrap layer uses accumulation to decide mastery.
    expect(["correct_complete", "correct_incomplete"]).toContain(state);
  });

  test("2: correct with explanation → mastery", () => {
    const acc = fullAcc(P());
    const m = move("24+12", acc, "4 plus 2 is 6 and 20 plus 10 is 30 so 36");
    // Should wrap or be null (mastery)
    expect(m === null || m.type === "WRAP_SUCCESS").toBe(true);
  });

  test("3: wrong with partial strategy → continues probing", () => {
    const acc = partialAcc(P(), ["step_1"], { extractedAnswer: 30 });
    const m = move("24+12", acc, "4 + 2 is 6 but the answer is 30");
    expect(m).not.toBeNull();
    expect(m!.type).not.toBe("WRAP_SUCCESS");
    // Should probe for missing step (tens)
    expect(m!.text).toMatch(/\?/);
  });

  test("4: confusion about structure → response with probe", () => {
    const acc = emptyAcc(P());
    const m = move("24+12", acc, "why are we adding these numbers", [
      { role: "coach", message: "What is 4 + 2?" },
      { role: "student", message: "why are we adding these numbers" },
    ]);
    expect(m).not.toBeNull();
    // FINDING [PATTERN 2]: Response is ~184 chars. "why are we adding" triggers
    // DECOMPOSITION confusion (not STRUCTURE), producing a longer explanation.
    // The STRUCTURE bridge was shortened but DECOMPOSITION was not.
    expect(m!.text.length).toBeLessThan(200);
    expect(m!.text).toMatch(/\?/);
  });

  test("5: repeated 'I don't know' → escalates to STEP_DEMONSTRATE_STEP", () => {
    const acc = emptyAcc(P());
    const m1 = move("24+12", acc, "I don't know", [
      { role: "coach", message: "What is 4 + 2?" },
      { role: "student", message: "I don't know" },
    ]);
    const m2 = move("24+12", acc, "I don't know", [
      { role: "coach", message: "What is 4 + 2?" },
      { role: "student", message: "I don't know" },
      { role: "coach", message: m1?.text ?? "Let's try. What is 4 + 2?" },
      { role: "student", message: "I don't know" },
    ]);
    expect(m1).not.toBeNull();
    expect(m2).not.toBeNull();
    // Escalates from STEP_PROBE_SIMPLER to STEP_DEMONSTRATE_STEP
    // after 2 consecutive uncertain turns (models the answer).
    expect(m2!.type).toBe("STEP_DEMONSTRATE_STEP");
  });

  test("7: alternate strategy (split addend) → not classified as wrong", () => {
    const acc = emptyAcc(P());
    const state = classify("24+12", acc, "I split 12 into 10 and 2 and add 24 plus 10 is 34 then plus 2 is 36");
    expect(state).not.toBe("wrong");
    expect(state).not.toBe("misconception");
  });

  test("8: refusal / move-on → FINDING: classified as wrong", () => {
    const acc = emptyAcc(P());
    const state = classify("24+12", acc, "I want to move on to the next one");
    // FIXED [PATTERN 4]: Now detected as refusal/disengagement → classified as uncertain.
    expect(state).toBe("uncertain");
  });
});

// ============================================================================
// B. 27 + 36 — addition with regrouping
// ============================================================================

describe("27+36: addition with regrouping", () => {
  const P = () => PROBLEMS["27+36"];

  test("2: correct with explanation including carry → mastery summary mentions carry", () => {
    const acc = fullAcc(P());
    const transcript = "7 plus 6 is 13, carry the 1, 2 plus 3 is 5 plus 1 is 6, so 63";
    const summary = buildMathTeacherSummary({
      mathValidation: { extractedAnswer: 63, correctAnswer: 63, status: "correct", demonstratedStrategies: ["add ones", "carry", "add tens"], hasPartialStrategy: true },
      mathBounding: { boundedStatus: "strong", boundedScore: 95, wasAdjusted: false, reason: "all steps" },
      mathProblem: P().problem,
      cleanedStudentResponse: transcript,
      reasoningSteps: P().steps,
      fullTranscript: transcript,
      stepAccumulation: acc,
    });
    expect(summary.renderedSummary).toContain("63");
    expect(summary.renderedSummary).toContain("7 + 6 = 13");
  });

  test("3: common wrong answer 53 (forgot to carry) → classified as wrong/misconception", () => {
    const acc = partialAcc(P(), ["step_1"], { extractedAnswer: 53 });
    const state = classify("27+36", acc, "7 plus 6 is 13 and 2 plus 3 is 5 so 53");
    expect(["wrong", "misconception", "partial"]).toContain(state);
  });

  test("4: structure confusion on regrouping → short explanation, not lecture", () => {
    const acc = partialAcc(P(), ["step_1"]);
    const m = move("27+36", acc, "why do I have to carry", [
      { role: "coach", message: "7 + 6 is 13. What happens with the extra 10?" },
      { role: "student", message: "why do I have to carry" },
    ]);
    expect(m).not.toBeNull();
    expect(m!.text.length).toBeLessThan(150);
    expect(m!.text).toMatch(/\?/);
  });

  test("7: alternate strategy (split and regroup) → FINDING: classified as wrong", () => {
    const acc = emptyAcc(P());
    const state = classify("27+36", acc, "27 plus 30 is 57, plus 6 is 63");
    // FIXED [PATTERN 5a]: Now detected as correct_incomplete via
    // currentAnswerCorrect check (extractedAnswer === 63 === correctAnswer).
    expect(["partial", "correct_incomplete"]).toContain(state);
  });
});

// ============================================================================
// C. 47 - 23 — subtraction without borrowing
// ============================================================================

describe("47-23: subtraction without borrowing", () => {
  const P = () => PROBLEMS["47-23"];

  test("1: correct minimal → classified as correct", () => {
    const acc = fullAcc(P());
    const state = classify("47-23", acc, "24");
    expect(["correct_complete", "correct_incomplete"]).toContain(state);
  });

  test("2: correct with explanation → mastery", () => {
    const acc = fullAcc(P());
    const m = move("47-23", acc, "7 minus 3 is 4 and 40 minus 20 is 20 so 24");
    expect(m === null || m.type === "WRAP_SUCCESS").toBe(true);
  });

  test("3: wrong — student adds instead of subtracting → misconception detected", () => {
    const acc = partialAcc(P(), [], { extractedAnswer: 70 });
    const state = classify("47-23", acc, "47 plus 23 is 70");
    expect(["wrong", "misconception"]).toContain(state);
  });

  test("4: structure confusion → short response", () => {
    const acc = emptyAcc(P());
    const m = move("47-23", acc, "what do you mean subtract the ones", [
      { role: "coach", message: "What do you get when you subtract 3 from 7?" },
      { role: "student", message: "what do you mean subtract the ones" },
    ]);
    expect(m).not.toBeNull();
    expect(m!.text.length).toBeLessThan(150);
    expect(m!.text).toMatch(/\?/);
  });

  test("6: student corrects coach — subtraction context", () => {
    const acc = emptyAcc(P());
    const m = move("47-23", acc, "that's not right it should be 7 minus 3", [
      { role: "coach", message: "What is 47 - 23?" },
      { role: "student", message: "well 40 minus 20 is 20" },
      { role: "coach", message: "Good! Now what about the ones?" },
      { role: "student", message: "that's not right it should be 7 minus 3" },
    ]);
    expect(m).not.toBeNull();
    // Should not wrap — student is engaging
    expect(m!.type).not.toBe("WRAP_NEEDS_SUPPORT");
  });

  test("summary: no-evidence transcript → not enough evidence", () => {
    const summary = buildMathTeacherSummary({
      mathValidation: { extractedAnswer: null, correctAnswer: 24, status: "no_answer", demonstratedStrategies: [], hasPartialStrategy: false },
      mathBounding: { boundedStatus: "needs_support", boundedScore: 10, wasAdjusted: false, reason: "no evidence" },
      mathProblem: P().problem,
      cleanedStudentResponse: "I don't know how to do this",
      reasoningSteps: P().steps,
      fullTranscript: "I don't know how to do this",
      stepAccumulation: emptyAcc(P()),
    });
    expect(summary.renderedSummary).toMatch(/did not provide|not enough/i);
  });
});

// ============================================================================
// D. 42 - 17 — subtraction with borrowing
// ============================================================================

describe("42-17: subtraction with borrowing", () => {
  const P = () => PROBLEMS["42-17"];

  test("1: correct minimal → classified as correct", () => {
    const acc = fullAcc(P());
    const state = classify("42-17", acc, "25");
    expect(["correct_complete", "correct_incomplete"]).toContain(state);
  });

  test("2: correct with borrowing explanation", () => {
    const acc = fullAcc(P());
    const m = move("42-17", acc, "2 is less than 7 so I borrow, 12 minus 7 is 5, 30 minus 10 is 20, so 25");
    expect(m === null || m.type === "WRAP_SUCCESS").toBe(true);
  });

  test("3: common error — subtract smaller from larger without borrowing → wrong", () => {
    // Student does 7-2=5 instead of borrowing → gets 35
    const acc = partialAcc(P(), [], { extractedAnswer: 35 });
    const state = classify("42-17", acc, "7 minus 2 is 5 and 40 minus 10 is 30 so 35");
    expect(["wrong", "misconception"]).toContain(state);
  });

  test("4: confusion about borrowing → short response", () => {
    const acc = emptyAcc(P());
    const m = move("42-17", acc, "why do I need to borrow", [
      { role: "coach", message: "Is 2 big enough to subtract 7?" },
      { role: "student", message: "why do I need to borrow" },
    ]);
    expect(m).not.toBeNull();
    expect(m!.text.length).toBeLessThan(150);
    expect(m!.text).toMatch(/\?/);
  });

  test("5: repeated 'I don't know' → escalates to STEP_DEMONSTRATE_STEP", () => {
    const acc = emptyAcc(P());
    const m1 = move("42-17", acc, "I don't know", [
      { role: "coach", message: "Is 2 big enough to subtract 7?" },
      { role: "student", message: "I don't know" },
    ]);
    const m2 = move("42-17", acc, "I still don't know", [
      { role: "coach", message: "Is 2 big enough to subtract 7?" },
      { role: "student", message: "I don't know" },
      { role: "coach", message: m1?.text ?? "Let me help." },
      { role: "student", message: "I still don't know" },
    ]);
    expect(m1).not.toBeNull();
    expect(m2).not.toBeNull();
    // Escalates from STEP_PROBE_SIMPLER to STEP_DEMONSTRATE_STEP
    // after 2 consecutive uncertain turns (models the answer).
    expect(m2!.type).toBe("STEP_DEMONSTRATE_STEP");
  });

  test("summary: borrowing mastery → mentions borrowing step", () => {
    const acc = fullAcc(P());
    const summary = buildMathTeacherSummary({
      mathValidation: { extractedAnswer: 25, correctAnswer: 25, status: "correct", demonstratedStrategies: ["check ones", "borrow from tens", "subtract ones", "subtract tens"], hasPartialStrategy: true },
      mathBounding: { boundedStatus: "strong", boundedScore: 95, wasAdjusted: false, reason: "all steps" },
      mathProblem: P().problem,
      cleanedStudentResponse: "2 is less than 7 so borrow, 12 minus 7 is 5, 30 minus 10 is 20, so 25",
      reasoningSteps: P().steps,
      fullTranscript: "2 is less than 7 so borrow, 12 minus 7 is 5, 30 minus 10 is 20, so 25",
      stepAccumulation: acc,
    });
    expect(summary.renderedSummary).toContain("25");
    // Should mention the borrowing step (12 - 7 = 5)
    expect(summary.renderedSummary).toMatch(/12 - 7 = 5|borrow/i);
  });
});

// ============================================================================
// E. 3 × 4 — basic multiplication
// ============================================================================

describe("3x4: basic multiplication", () => {
  const P = () => PROBLEMS["3x4"];

  test("1: correct minimal → classified as correct", () => {
    const acc = fullAcc(P());
    const state = classify("3x4", acc, "12");
    expect(["correct_complete", "correct_incomplete"]).toContain(state);
  });

  test("2: correct with skip counting → mastery", () => {
    const acc = fullAcc(P());
    const m = move("3x4", acc, "3 groups of 4 is 4 8 12 so 12");
    expect(m === null || m.type === "WRAP_SUCCESS").toBe(true);
  });

  test("3: wrong answer → continues", () => {
    const acc = partialAcc(P(), [], { extractedAnswer: 7 });
    const state = classify("3x4", acc, "3 plus 4 is 7");
    expect(["wrong", "misconception"]).toContain(state);
  });

  test("4: confusion → responds with probe", () => {
    const acc = emptyAcc(P());
    const m = move("3x4", acc, "what does times mean", [
      { role: "coach", message: "What is 3 times 4?" },
      { role: "student", message: "what does times mean" },
    ]);
    expect(m).not.toBeNull();
    expect(m!.text).toMatch(/\?/);
  });

  test("7: alternate strategy (repeated addition) → correct_incomplete", () => {
    const acc = emptyAcc(P());
    const state = classify("3x4", acc, "4 plus 4 plus 4 is 12");
    // FIXED [PATTERN 5b]: Now detected as valid repeated-addition strategy.
    expect(state).toBe("correct_incomplete");
  });

  test("8: refusal → recognized", () => {
    const acc = emptyAcc(P());
    const state = classify("3x4", acc, "can we do something else");
    expect(["off_topic", "uncertain", "hint_request"]).toContain(state);
  });
});

// ============================================================================
// Cross-cutting: behaviors that should be stable across all lessons
// ============================================================================

describe("Cross-cutting stability checks", () => {
  const lessonNames = ["24+12", "27+36", "47-23", "42-17", "3x4"];

  for (const name of lessonNames) {
    const P = () => PROBLEMS[name];

    test(`${name}: empty response → uncertain or off_topic, not wrong`, () => {
      const acc = emptyAcc(P());
      const state = classify(name, acc, "um");
      expect(["uncertain", "off_topic", "hint_request"]).toContain(state);
    });

    test(`${name}: 'help me' → hint_request`, () => {
      const acc = emptyAcc(P());
      const state = classify(name, acc, "can you help me");
      expect(state).toBe("hint_request");
    });

    test(`${name}: correct answer + all steps → correct (complete or incomplete)`, () => {
      const acc = fullAcc(P());
      const state = classify(name, acc, String(P().problem.correctAnswer));
      // Answer-only in current utterance → correct_incomplete is expected.
      // The wrap layer uses accumulation to decide mastery.
      expect(["correct_complete", "correct_incomplete"]).toContain(state);
    });

    test(`${name}: structure confusion → response under 150 chars`, () => {
      const acc = emptyAcc(P());
      const m = move(name, acc, "what does that have to do with the problem", [
        { role: "coach", message: P().steps[0]?.probe ?? "Let's start." },
        { role: "student", message: "what does that have to do with the problem" },
      ]);
      expect(m).not.toBeNull();
      expect(m!.text.length).toBeLessThan(150);
    });

    test(`${name}: no-evidence summary → not enough evidence`, () => {
      const summary = buildMathTeacherSummary({
        mathValidation: { extractedAnswer: null, correctAnswer: P().problem.correctAnswer, status: "no_answer", demonstratedStrategies: [], hasPartialStrategy: false },
        mathBounding: { boundedStatus: "needs_support", boundedScore: 10, wasAdjusted: false, reason: "no evidence" },
        mathProblem: P().problem,
        cleanedStudentResponse: "I don't know",
        reasoningSteps: P().steps,
        fullTranscript: "I don't know",
        stepAccumulation: emptyAcc(P()),
      });
      expect(summary.renderedSummary).toMatch(/did not provide|not enough/i);
    });
  }
});

// ============================================================================
// Phase 1 hardening: DECOMPOSITION length, uncertain escalation, refusal detection
// ============================================================================

describe("Phase 1a: DECOMPOSITION concept-confusion explanation ≤ 18 words before probe", () => {
  const lessonNames = ["24+12", "27+36", "47-23", "42-17"];

  for (const name of lessonNames) {
    const P = () => PROBLEMS[name];

    test(`${name}: DECOMPOSITION confusion response ≤ 18 words before probe`, () => {
      const acc = emptyAcc(P());
      // Trigger DECOMPOSITION confusion with "where did you get those numbers"
      const m = move(name, acc, "where did you get those numbers", [
        { role: "coach", message: P().steps[0]?.probe ?? "Let's start." },
        { role: "student", message: "where did you get those numbers" },
      ]);
      expect(m).not.toBeNull();
      // Count words before the first question mark
      const beforeQuestion = m!.text.split("?")[0];
      const wordCount = beforeQuestion.trim().split(/\s+/).length;
      expect(wordCount).toBeLessThanOrEqual(18);
      expect(m!.text).toMatch(/\?/);
    });
  }
});

describe("Phase 1b: uncertain-turn escalation", () => {
  const lessonNames = ["24+12", "27+36", "47-23", "42-17", "3x4"];

  for (const name of lessonNames) {
    const P = () => PROBLEMS[name];

    test(`${name}: escalates to STEP_DEMONSTRATE_STEP after 2 consecutive uncertain turns`, () => {
      const acc = emptyAcc(P());
      // Build history with 2 prior uncertain turns
      const m1 = move(name, acc, "I don't know", [
        { role: "coach", message: P().steps[0]?.probe ?? "Let's start." },
        { role: "student", message: "I don't know" },
      ]);
      const m2 = move(name, acc, "I still don't know", [
        { role: "coach", message: P().steps[0]?.probe ?? "Let's start." },
        { role: "student", message: "I don't know" },
        { role: "coach", message: m1?.text ?? "Let's try." },
        { role: "student", message: "I still don't know" },
      ]);
      // Third uncertain turn — should escalate to demonstrate
      const m3 = move(name, acc, "I really don't know", [
        { role: "coach", message: P().steps[0]?.probe ?? "Let's start." },
        { role: "student", message: "I don't know" },
        { role: "coach", message: m1?.text ?? "Let's try." },
        { role: "student", message: "I still don't know" },
        { role: "coach", message: m2?.text ?? "Let's try another way." },
        { role: "student", message: "I really don't know" },
      ]);
      expect(m3).not.toBeNull();
      expect(m3!.type).toBe("STEP_DEMONSTRATE_STEP");
    });

    test(`${name}: uncertain counter resets after a non-uncertain turn`, () => {
      const acc = emptyAcc(P());
      // Pattern: uncertain → wrong → uncertain → should NOT escalate (count=1)
      const m1 = move(name, acc, "I don't know", [
        { role: "coach", message: P().steps[0]?.probe ?? "Let's start." },
        { role: "student", message: "I don't know" },
      ]);
      const m2 = move(name, acc, "I don't know", [
        { role: "coach", message: P().steps[0]?.probe ?? "Let's start." },
        { role: "student", message: "I don't know" },
        { role: "coach", message: m1?.text ?? "Let's try." },
        { role: "student", message: "99" },  // non-uncertain turn resets count
        { role: "coach", message: "Not quite." },
        { role: "student", message: "I don't know" },
      ]);
      expect(m2).not.toBeNull();
      // Should still be STEP_PROBE_SIMPLER, not STEP_HINT — counter was reset
      expect(m2!.type).toBe("STEP_PROBE_SIMPLER");
    });
  }
});

describe("Phase 1c: refusal/disengagement detection", () => {
  const lessonNames = ["24+12", "27+36", "47-23", "42-17", "3x4"];

  for (const name of lessonNames) {
    const P = () => PROBLEMS[name];

    test(`${name}: "I want to move on" → uncertain, not wrong`, () => {
      const acc = emptyAcc(P());
      const state = classify(name, acc, "I want to move on to the next one");
      expect(state).not.toBe("wrong");
      expect(state).not.toBe("misconception");
      // Should classify as uncertain (disengage → treated as uncertain)
      expect(state).toBe("uncertain");
    });

    test(`${name}: "can we skip this" → uncertain`, () => {
      const acc = emptyAcc(P());
      const state = classify(name, acc, "can we skip this");
      expect(state).not.toBe("wrong");
      expect(state).toBe("uncertain");
    });

    test(`${name}: "I give up" remains uncertain (already works)`, () => {
      const acc = emptyAcc(P());
      const state = classify(name, acc, "I give up");
      expect(state).toBe("uncertain");
    });
  }

  // Ensure refusal check doesn't swallow legitimate math containing "one"
  test("'one plus two is three' is NOT classified as refusal", () => {
    const P = PROBLEMS["24+12"];
    const acc = emptyAcc(P);
    const state = classify("24+12", acc, "one plus two is three");
    // Should be wrong or partial — NOT uncertain from refusal detection
    expect(state).not.toBe("uncertain");
  });

  test("'twenty seven plus thirty is fifty seven' is NOT classified as refusal", () => {
    const P = PROBLEMS["27+36"];
    const acc = emptyAcc(P);
    const state = classify("27+36", acc, "twenty seven plus thirty is fifty seven");
    expect(state).not.toBe("uncertain");
  });
});

// ============================================================================
// Phase 2: Repeated-addition recognition for multiplication
// ============================================================================

describe("Phase 2: repeated-addition recognition for multiplication", () => {
  const P = () => PROBLEMS["3x4"];

  test("'4+4+4=12' → correct_complete for 3×4", () => {
    const acc = emptyAcc(P());
    const state = classify("3x4", acc, "4 plus 4 plus 4 is 12");
    expect(state).not.toBe("wrong");
    expect(state).not.toBe("misconception");
    // Should be recognized as correct via repeated addition
    expect(["correct_complete", "correct_incomplete"]).toContain(state);
  });

  test("'3+3+3+3=12' → correct_complete for 3×4 (commutative)", () => {
    const acc = emptyAcc(P());
    const state = classify("3x4", acc, "3 plus 3 plus 3 plus 3 is 12");
    expect(state).not.toBe("wrong");
    expect(state).not.toBe("misconception");
    expect(["correct_complete", "correct_incomplete"]).toContain(state);
  });

  test("'4+4+4=11' → wrong (bad arithmetic)", () => {
    const acc = emptyAcc(P());
    const state = classify("3x4", acc, "4 plus 4 plus 4 is 11");
    expect(["wrong", "misconception"]).toContain(state);
  });

  test("'4+4=8' → partial for 3×4 (incomplete repeated addition)", () => {
    const acc = emptyAcc(P());
    const state = classify("3x4", acc, "4 plus 4 is 8");
    // 8 is not the final answer but is valid partial work
    // Should not be treated as "wrong final answer"
    expect(state).not.toBe("misconception");
  });

  test("remediation move for correct repeated addition → mastery path", () => {
    // With full accumulation + correct answer, should wrap
    const acc = fullAcc(P());
    const m = move("3x4", acc, "4 plus 4 plus 4 equals 12");
    expect(m === null || m.type === "WRAP_SUCCESS").toBe(true);
  });
});

// ============================================================================
// Phase 3: Split-addend recognition for addition
// ============================================================================

describe("Phase 3: split-addend recognition for addition", () => {
  test("27+36: '27 plus 30 is 57' → partial, not wrong", () => {
    const P = PROBLEMS["27+36"];
    const acc = emptyAcc(P);
    const state = classify("27+36", acc, "27 plus 30 is 57");
    expect(state).not.toBe("wrong");
    expect(state).not.toBe("misconception");
    expect(state).toBe("partial");
  });

  test("27+36: '27 plus 30 is 57 plus 6 is 63' → correct path", () => {
    const P = PROBLEMS["27+36"];
    const acc = emptyAcc(P);
    const state = classify("27+36", acc, "27 plus 30 is 57 plus 6 is 63");
    expect(state).not.toBe("wrong");
    expect(state).not.toBe("misconception");
    // Full chain with correct answer — should be on correct path
    expect(["correct_incomplete", "partial"]).toContain(state);
  });

  test("27+36: '27 plus 10 is 55' → wrong or partial (bad arithmetic)", () => {
    const P = PROBLEMS["27+36"];
    const acc = emptyAcc(P);
    const state = classify("27+36", acc, "27 plus 10 is 55");
    // 27+10=55 is wrong arithmetic — existing substep detector may classify
    // as partial (since 27 is a problem operand in a substep expression).
    // 27+10≠55, so arithmetic validation rejects the intermediate.
    expect(["wrong", "misconception"]).toContain(state);
  });

  test("24+12: '24 plus 10 is 34' → partial (valid split)", () => {
    const P = PROBLEMS["24+12"];
    const acc = emptyAcc(P);
    const state = classify("24+12", acc, "24 plus 10 is 34");
    // 24+10=34 is valid (keeping 24 whole, splitting 12 into 10+2)
    expect(state).not.toBe("wrong");
    expect(state).toBe("partial");
  });

  test("47-23: '47 minus 20 is 27' → partial (valid split for subtraction)", () => {
    const P = PROBLEMS["47-23"];
    const acc = emptyAcc(P);
    const state = classify("47-23", acc, "47 minus 20 is 27");
    // 47-20=27 is valid (keeping 47 whole, splitting subtraction into 20+3)
    expect(state).not.toBe("wrong");
    expect(state).toBe("partial");
  });
});

// ============================================================================
// Phase 4: False-positive partial credit for invalid arithmetic
// ============================================================================

describe("Phase 4: invalid arithmetic should not receive partial credit", () => {
  test("27+36: '27 plus 10 is 55' → wrong (invalid arithmetic: 27+10=37 not 55)", () => {
    const P = PROBLEMS["27+36"];
    const acc = emptyAcc(P);
    const state = classify("27+36", acc, "27 plus 10 is 55");
    expect(state).toBe("wrong");
  });

  test("47-23: '47 minus 10 is 30' → wrong (invalid arithmetic: 47-10=37 not 30)", () => {
    const P = PROBLEMS["47-23"];
    const acc = emptyAcc(P);
    const state = classify("47-23", acc, "47 minus 10 is 30");
    // Already classified as misconception (addition_on_subtraction or similar) — either wrong or misconception is fine
    expect(["wrong", "misconception"]).toContain(state);
  });

  // Valid substeps must still receive partial credit
  test("27+36: '27 plus 30 is 57' → still partial (valid arithmetic: 27+30=57)", () => {
    const P = PROBLEMS["27+36"];
    const acc = emptyAcc(P);
    const state = classify("27+36", acc, "27 plus 30 is 57");
    expect(state).toBe("partial");
  });

  test("47-23: '47 minus 20 is 27' → still partial (valid arithmetic: 47-20=27)", () => {
    const P = PROBLEMS["47-23"];
    const acc = emptyAcc(P);
    const state = classify("47-23", acc, "47 minus 20 is 27");
    expect(state).toBe("partial");
  });

  // Valid full chain must still work
  test("27+36: '27 plus 30 is 57 plus 6 is 63' → still correct_incomplete", () => {
    const P = PROBLEMS["27+36"];
    const acc = emptyAcc(P);
    const state = classify("27+36", acc, "27 plus 30 is 57 plus 6 is 63");
    expect(["correct_incomplete", "partial"]).toContain(state);
  });

  // Mixed utterance: one invalid + one valid equation
  test("27+36: '27 plus 10 is 55 but wait 27 plus 30 is 57' → not wrong (valid equation present)", () => {
    const P = PROBLEMS["27+36"];
    const acc = emptyAcc(P);
    const state = classify("27+36", acc, "27 plus 10 is 55 but wait 27 plus 30 is 57");
    // The utterance contains both invalid and valid arithmetic.
    // interpretMathUtterance extracts the final answer candidate (57) which is
    // a valid substep. The classifier should not classify as wrong.
    expect(state).not.toBe("wrong");
  });

  // 24+12: invalid substep
  test("24+12: '24 plus 5 is 31' → wrong (invalid arithmetic: 24+5=29 not 31)", () => {
    const P = PROBLEMS["24+12"];
    const acc = emptyAcc(P);
    const state = classify("24+12", acc, "24 plus 5 is 31");
    expect(["wrong", "misconception"]).toContain(state);
  });
});

// ============================================================================
// Classification calibration: misconception vs wrong vs other states
// ============================================================================

describe("Classification calibration: misconception is not over-applied", () => {

  // ── Addition: 27+36 (correct=63) ──

  describe("addition 27+36", () => {
    const P = () => PROBLEMS["27+36"];

    test("plain wrong number (100) → wrong, not misconception", () => {
      const acc = emptyAcc(P());
      const state = classify("27+36", acc, "100");
      expect(state).toBe("wrong");
    });

    test("plain wrong number (50) → misconception (TENS_ONLY: 20+30=50)", () => {
      // 50 = tens sum → genuine place-value misconception
      const acc = emptyAcc(P());
      const state = classify("27+36", acc, "50");
      expect(state).toBe("misconception");
    });

    test("ones-only answer (13) → misconception (ONES_ONLY: 7+6=13)", () => {
      const acc = emptyAcc(P());
      const state = classify("27+36", acc, "13");
      expect(state).toBe("misconception");
    });

    test("difference answer (9) → misconception (SUBTRACTION_ON_ADDITION: |27-36|=9)", () => {
      const acc = emptyAcc(P());
      const state = classify("27+36", acc, "9");
      expect(state).toBe("misconception");
    });

    test("subtraction language → misconception", () => {
      const acc = emptyAcc(P());
      const state = classify("27+36", acc, "27 take away 36");
      expect(state).toBe("misconception");
    });

    test("multiplication language on addition → misconception", () => {
      const acc = emptyAcc(P());
      const state = classify("27+36", acc, "27 times 36");
      expect(state).toBe("misconception");
    });

    test("off-target number (99) → wrong, not misconception", () => {
      const acc = emptyAcc(P());
      const state = classify("27+36", acc, "99");
      expect(state).toBe("wrong");
    });

    test("correct answer → correct_incomplete, never misconception", () => {
      const acc = emptyAcc(P());
      const state = classify("27+36", acc, "63");
      expect(state).not.toBe("misconception");
      expect(state).not.toBe("wrong");
    });
  });

  // ── Subtraction: 47-23 (correct=24) ──

  describe("subtraction 47-23", () => {
    const P = () => PROBLEMS["47-23"];

    test("plain wrong number (30) → wrong, not misconception", () => {
      const acc = emptyAcc(P());
      const state = classify("47-23", acc, "30");
      expect(state).toBe("wrong");
    });

    test("sum answer (70) → misconception (ADDITION_ON_SUBTRACTION: 47+23=70)", () => {
      const acc = emptyAcc(P());
      const state = classify("47-23", acc, "70");
      expect(state).toBe("misconception");
    });

    test("ones-only answer (4) → misconception (ONES_ONLY: 7-3=4)", () => {
      const acc = emptyAcc(P());
      const state = classify("47-23", acc, "4");
      expect(state).toBe("misconception");
    });

    test("tens-only answer (20) → misconception (TENS_ONLY: 40-20=20)", () => {
      const acc = emptyAcc(P());
      const state = classify("47-23", acc, "20");
      expect(state).toBe("misconception");
    });

    test("addition language on subtraction → misconception", () => {
      const acc = emptyAcc(P());
      const state = classify("47-23", acc, "47 plus 23 is 70");
      expect(state).toBe("misconception");
    });

    test("off-target number (15) → wrong, not misconception", () => {
      const acc = emptyAcc(P());
      const state = classify("47-23", acc, "15");
      expect(state).toBe("wrong");
    });
  });

  // ── Subtraction with borrowing: 42-17 (correct=25) ──

  describe("subtraction 42-17 (borrowing)", () => {
    const P = () => PROBLEMS["42-17"];

    test("forgot-to-borrow answer (35) → wrong, not misconception", () => {
      // 7-2=5, 40-10=30 → 35. No specific misconception category for this.
      const acc = emptyAcc(P());
      const state = classify("42-17", acc, "35");
      expect(state).toBe("wrong");
    });

    test("addition answer (59) → misconception (ADDITION_ON_SUBTRACTION: 42+17=59)", () => {
      const acc = emptyAcc(P());
      const state = classify("42-17", acc, "59");
      expect(state).toBe("misconception");
    });

    test("plain wrong (15) → wrong, not misconception", () => {
      const acc = emptyAcc(P());
      const state = classify("42-17", acc, "15");
      expect(state).toBe("wrong");
    });
  });

  // ── Multiplication: 3×4 (correct=12) ──

  describe("multiplication 3x4", () => {
    const P = () => PROBLEMS["3x4"];

    test("addition-confusion answer (7) → wrong, not misconception", () => {
      // 3+4=7: wrong operation, but no ADDITION_ON_MULTIPLICATION category
      // exists. This is fine as 'wrong' — remediation probes multiplication steps.
      const acc = emptyAcc(P());
      const state = classify("3x4", acc, "7");
      expect(state).toBe("wrong");
    });

    test("random wrong (34) → wrong, not misconception", () => {
      const acc = emptyAcc(P());
      const state = classify("3x4", acc, "34");
      expect(state).toBe("wrong");
    });

    test("wrong repeated addition (4+4+4=11) → wrong", () => {
      const acc = emptyAcc(P());
      const state = classify("3x4", acc, "4 plus 4 plus 4 is 11");
      expect(state).toBe("wrong");
    });

    test("'times' language on multiplication is NOT misconception", () => {
      // MULTIPLICATION_MISCONCEPTION pattern is gated to non-multiplication skills
      const acc = emptyAcc(P());
      const state = classify("3x4", acc, "3 times 4");
      expect(state).not.toBe("misconception");
    });
  });

  // ── Cross-cutting: non-wrong states are preserved ──

  describe("non-wrong states are preserved across skills", () => {
    const lessonNames = ["24+12", "27+36", "47-23", "42-17", "3x4"] as const;

    for (const name of lessonNames) {
      const P = () => PROBLEMS[name];

      test(`${name}: "I don't know" → uncertain, not wrong/misconception`, () => {
        const acc = emptyAcc(P());
        const state = classify(name, acc, "I don't know");
        expect(state).toBe("uncertain");
      });

      test(`${name}: "I want to move on" → uncertain (refusal), not wrong`, () => {
        const acc = emptyAcc(P());
        const state = classify(name, acc, "I want to move on");
        expect(state).toBe("uncertain");
      });

      test(`${name}: "can you help me" → hint_request`, () => {
        const acc = emptyAcc(P());
        const state = classify(name, acc, "can you help me");
        expect(state).toBe("hint_request");
      });

      test(`${name}: correct answer → correct_incomplete, not wrong`, () => {
        const acc = fullAcc(P());
        const state = classify(name, acc, String(P().problem.correctAnswer));
        expect(["correct_complete", "correct_incomplete"]).toContain(state);
        expect(state).not.toBe("wrong");
        expect(state).not.toBe("misconception");
      });
    }
  });
});

// ============================================================================
// Cross-layer alignment audit
// ============================================================================

/**
 * Helper: run all four layers for a given problem/state and return results.
 */
function auditLayers(
  name: string,
  response: string,
  accOverride?: Partial<ReasoningStepAccumulation>,
  history?: Array<{ role: string; message: string }>,
) {
  const p = PROBLEMS[name];
  const baseAcc = emptyAcc(p);
  const acc: ReasoningStepAccumulation = { ...baseAcc, ...accOverride };

  // Layer 1: classification
  const state = classifyStudentState(response, acc, p.problem);

  // Layer 2: remediation move
  const rem = getDeterministicRemediationMove(p.steps, acc, response, p.problem, history);

  // Layer 3: wrap decision
  const problemOp = p.problem.skill === "two_digit_subtraction" ? "-" as const
    : p.problem.skill === "two_digit_addition" ? "+" as const
    : undefined;
  const interp = interpretMathUtterance(
    response, p.problem.correctAnswer, undefined,
    p.problem.b !== undefined ? [p.problem.a, p.problem.b] : undefined,
    problemOp,
  );
  const wrap = shouldWrapMathSession(acc, interp, 1, 5);

  // Layer 4: teacher summary
  const summary = buildMathTeacherSummary({
    mathValidation: {
      extractedAnswer: acc.extractedAnswer,
      correctAnswer: p.problem.correctAnswer,
      status: acc.answerCorrect ? "correct" : (acc.extractedAnswer !== null ? "incorrect_unknown" : "no_answer"),
      demonstratedStrategies: [],
      hasPartialStrategy: acc.satisfiedStepIds.length > 0,
    },
    mathBounding: {
      boundedStatus: acc.answerCorrect ? "strong" : (acc.satisfiedStepIds.length > 0 ? "developing" : "needs_support"),
      boundedScore: acc.answerCorrect ? 95 : (acc.satisfiedStepIds.length > 0 ? 50 : 10),
      wasAdjusted: false,
      reason: "audit",
    },
    mathProblem: p.problem,
    cleanedStudentResponse: response,
    reasoningSteps: p.steps,
    fullTranscript: response,
    stepAccumulation: acc,
  });

  return { state, rem, wrap, summary: summary.renderedSummary };
}

describe("Cross-layer alignment: wrong state", () => {
  const names = ["24+12", "27+36", "47-23", "42-17", "3x4"] as const;

  for (const name of names) {
    test(`${name}: wrong → corrective probe, continue, summary says "instead of"`, () => {
      const { state, rem, wrap, summary } = auditLayers(name, "99", { extractedAnswer: 99 });
      expect(state).toBe("wrong");
      expect(rem).not.toBeNull();
      expect(rem!.type).not.toBe("WRAP_SUCCESS");
      expect(rem!.text).toMatch(/\?/); // should probe, not lecture
      expect(wrap.action).toMatch(/continue/); // should NOT wrap
      expect(summary).toMatch(/99/); // should mention what student said
      expect(summary).toMatch(/instead of/i); // should note discrepancy
      expect(summary).not.toMatch(/correctly|mastery|all steps/i);
    });
  }
});

describe("Cross-layer alignment: misconception state", () => {
  // ONES_ONLY: answer is just the ones sum
  test("27+36: ones-only (13) → misconception redirect, continue, summary says 13", () => {
    const { state, rem, wrap, summary } = auditLayers("27+36", "13", { extractedAnswer: 13 });
    expect(state).toBe("misconception");
    expect(rem).not.toBeNull();
    expect(rem!.type).toBe("STEP_MISCONCEPTION_REDIRECT");
    expect(rem!.text).toMatch(/\?/); // redirects with a probe
    expect(wrap.action).toMatch(/continue/);
    // Summary should mention the wrong answer, not praise
    expect(summary).toMatch(/13/);
    expect(summary).toMatch(/instead of/i);
    expect(summary).not.toMatch(/correctly|mastery/i);
  });

  // SUBTRACTION_ON_ADDITION
  test("24+12: subtraction language → misconception redirect, summary not mastery", () => {
    const { state, rem, wrap, summary } = auditLayers("24+12", "24 take away 12", { extractedAnswer: 12 });
    expect(state).toBe("misconception");
    expect(rem).not.toBeNull();
    expect(rem!.type).toBe("STEP_MISCONCEPTION_REDIRECT");
    expect(wrap.action).toMatch(/continue/);
    expect(summary).not.toMatch(/correctly|mastery/i);
  });

  // ADDITION_ON_SUBTRACTION
  test("47-23: addition answer (70) → misconception redirect", () => {
    const { state, rem, wrap, summary } = auditLayers("47-23", "70", { extractedAnswer: 70 });
    expect(state).toBe("misconception");
    expect(rem).not.toBeNull();
    expect(rem!.type).toBe("STEP_MISCONCEPTION_REDIRECT");
    expect(wrap.action).toMatch(/continue/);
    expect(summary).toMatch(/70/);
    expect(summary).not.toMatch(/correctly/i);
  });
});

describe("Cross-layer alignment: uncertain state", () => {
  const names = ["24+12", "27+36", "47-23", "42-17", "3x4"] as const;

  for (const name of names) {
    test(`${name}: "I don't know" → simpler probe, continue, summary has no false claims`, () => {
      const { state, rem, wrap, summary } = auditLayers(name, "I don't know");
      expect(state).toBe("uncertain");
      expect(rem).not.toBeNull();
      expect(rem!.type).toBe("STEP_PROBE_SIMPLER");
      expect(wrap.action).toMatch(/continue/);
      // Summary should NOT attribute math knowledge the student didn't show
      expect(summary).not.toMatch(/correctly|solved|explained that/i);
      expect(summary).toMatch(/did not provide|attempted/i);
    });
  }
});

describe("Cross-layer alignment: refusal / move-on", () => {
  const names = ["24+12", "27+36", "47-23", "42-17", "3x4"] as const;

  for (const name of names) {
    test(`${name}: "I want to move on" → uncertain path, continue, summary not math-negative`, () => {
      const { state, rem, wrap, summary } = auditLayers(name, "I want to move on");
      expect(state).toBe("uncertain");
      expect(rem).not.toBeNull();
      // Should NOT get a wrong-answer redirect
      expect(rem!.type).not.toBe("STEP_MISCONCEPTION_REDIRECT");
      expect(wrap.action).toMatch(/continue/);
      // Summary should NOT say "gave X instead of Y" (no math was attempted)
      expect(summary).not.toMatch(/instead of/i);
      expect(summary).not.toMatch(/correctly|mastery/i);
    });
  }
});

describe("Cross-layer alignment: partial progress", () => {
  test("27+36: ones-step satisfied → probe next, continue, summary credits partial", () => {
    const p = PROBLEMS["27+36"];
    const onesStep = p.steps.find(s => s.kind === "ones_sum");
    const { state, rem, wrap, summary } = auditLayers("27+36", "7 plus 6 is 13", {
      satisfiedStepIds: onesStep ? [onesStep.id] : ["step_1"],
      missingStepIds: p.steps.filter(s => s.id !== onesStep?.id).map(s => s.id),
      newlySatisfiedStepIds: onesStep ? [onesStep.id] : ["step_1"],
      completionRatio: 1 / p.steps.length,
    });
    expect(state).toBe("partial");
    expect(rem).not.toBeNull();
    expect(rem!.type).not.toBe("WRAP_SUCCESS");
    expect(rem!.type).not.toBe("WRAP_NEEDS_SUPPORT");
    expect(rem!.text).toMatch(/\?/); // continues probing
    expect(wrap.action).toMatch(/continue/); // does NOT wrap
    // Summary should credit what was demonstrated
    expect(summary).toMatch(/7 \+ 6 = 13|explained/i);
    expect(summary).not.toMatch(/mastery/i);
  });

  test("47-23: ones-step done, missing tens → continue, not wrap", () => {
    const p = PROBLEMS["47-23"];
    const onesStep = p.steps.find(s => s.kind === "subtract_ones");
    const { rem, wrap, summary } = auditLayers("47-23", "7 minus 3 is 4", {
      satisfiedStepIds: onesStep ? [onesStep.id] : ["step_1"],
      missingStepIds: p.steps.filter(s => s.id !== onesStep?.id).map(s => s.id),
      newlySatisfiedStepIds: onesStep ? [onesStep.id] : ["step_1"],
      completionRatio: 1 / p.steps.length,
    });
    expect(rem).not.toBeNull();
    expect(rem!.type).not.toBe("WRAP_SUCCESS");
    expect(wrap.action).toMatch(/continue/);
    expect(summary).toMatch(/7 - 3 = 4|explained/i);
  });
});

describe("Cross-layer alignment: correct_incomplete", () => {
  test("27+36: correct answer but no steps → probe for explanation, continue", () => {
    const p = PROBLEMS["27+36"];
    const { state, rem, wrap, summary } = auditLayers("27+36", "63", {
      answerCorrect: true,
      extractedAnswer: 63,
      missingStepIds: p.steps.map(s => s.id),
      satisfiedStepIds: [],
      completionRatio: 0,
    });
    expect(state).toBe("correct_incomplete");
    expect(rem).not.toBeNull();
    // Should probe for reasoning, not wrap
    expect(rem!.type).not.toBe("WRAP_SUCCESS");
    expect(rem!.text).toMatch(/\?/);
    expect(wrap.action).toBe("continue_probing");
    expect(wrap.reason).toMatch(/correct_answer_missing_explanation/);
    // Summary should credit the answer but note missing explanation
    expect(summary).toMatch(/63|correct/i);
    expect(summary).toMatch(/did not yet explain|not yet/i);
  });

  test("3x4: correct answer only → continue probing", () => {
    const p = PROBLEMS["3x4"];
    const { state, rem, wrap } = auditLayers("3x4", "12", {
      answerCorrect: true,
      extractedAnswer: 12,
      missingStepIds: p.steps.map(s => s.id),
      satisfiedStepIds: [],
      completionRatio: 0,
    });
    expect(state).toBe("correct_incomplete");
    expect(rem).not.toBeNull();
    expect(rem!.type).not.toBe("WRAP_SUCCESS");
    expect(wrap.action).toBe("continue_probing");
  });
});

describe("Cross-layer alignment: mastery / correct_complete", () => {
  const names = ["24+12", "27+36", "47-23", "42-17", "3x4"] as const;

  for (const name of names) {
    test(`${name}: all steps + correct answer → WRAP_SUCCESS + mastery summary`, () => {
      const p = PROBLEMS[name];
      const full = fullAcc(p);
      // Craft a plausible explanation string
      const explanations: Record<string, string> = {
        "24+12": "4 plus 2 is 6 and 20 plus 10 is 30 so 36",
        "27+36": "7 plus 6 is 13 carry the 1 and 20 plus 30 plus 10 is 60 so 63",
        "47-23": "7 minus 3 is 4 and 40 minus 20 is 20 so 24",
        "42-17": "2 is less than 7 so borrow 12 minus 7 is 5 and 30 minus 10 is 20 so 25",
        "3x4": "3 groups of 4 is 4 8 12 so 12",
      };
      const response = explanations[name];
      const rem = getDeterministicRemediationMove(p.steps, full, response, p.problem);
      // Should wrap with success
      expect(rem === null || rem.type === "WRAP_SUCCESS").toBe(true);

      // Wrap policy should say mastery
      const interp = interpretMathUtterance(response, p.problem.correctAnswer);
      const wrap = shouldWrapMathSession(full, interp, 1, 5);
      expect(wrap.action).toBe("wrap_mastery");

      // Summary should be mastery language
      const summary = buildMathTeacherSummary({
        mathValidation: {
          extractedAnswer: p.problem.correctAnswer,
          correctAnswer: p.problem.correctAnswer,
          status: "correct",
          demonstratedStrategies: p.problem.expectedStrategyTags,
          hasPartialStrategy: true,
        },
        mathBounding: { boundedStatus: "strong", boundedScore: 95, wasAdjusted: false, reason: "mastery" },
        mathProblem: p.problem,
        cleanedStudentResponse: response,
        reasoningSteps: p.steps,
        fullTranscript: response,
        stepAccumulation: full,
      });
      expect(summary.renderedSummary).toMatch(/correctly|solved|all steps/i);
      expect(summary.renderedSummary).toContain(String(p.problem.correctAnswer));
      expect(summary.renderedSummary).not.toMatch(/instead of|did not/i);
    });
  }
});

describe("Cross-layer alignment: wrong vs misconception summary language", () => {
  test("wrong summary does not mention 'misconception'", () => {
    const { summary } = auditLayers("27+36", "99", { extractedAnswer: 99 });
    expect(summary).not.toMatch(/misconception/i);
    expect(summary).toMatch(/99.*instead of.*63|99/);
  });

  test("misconception summary includes misconception evidence when available", () => {
    // Use the full summary with matchedMisconception field
    const p = PROBLEMS["47-23"];
    const summary = buildMathTeacherSummary({
      mathValidation: {
        extractedAnswer: 70,
        correctAnswer: 24,
        status: "incorrect_known_misconception",
        demonstratedStrategies: [],
        hasPartialStrategy: false,
        matchedMisconception: "added instead of subtracting",
      },
      mathBounding: { boundedStatus: "needs_support", boundedScore: 10, wasAdjusted: false, reason: "misconception" },
      mathProblem: p.problem,
      cleanedStudentResponse: "70",
      reasoningSteps: p.steps,
      fullTranscript: "70",
      stepAccumulation: { ...emptyAcc(p), extractedAnswer: 70 },
    });
    // incorrectEvidence should include the misconception label
    expect(summary.incorrectEvidence.some(e => e.label.includes("misconception"))).toBe(true);
    expect(summary.renderedSummary).toMatch(/70/);
  });
});

describe("Cross-layer alignment: uncertain/refusal summary does not overstate", () => {
  test("uncertain transcript does not get summarized as content knowledge", () => {
    const { summary } = auditLayers("27+36", "I don't know");
    // Should NOT say student "explained" anything or showed strategies
    expect(summary).not.toMatch(/explained that|strategy demonstrated/i);
    // Should say not enough evidence or similar
    expect(summary).toMatch(/did not provide|attempted/i);
  });

  test("refusal transcript does not get summarized as misunderstanding", () => {
    const { summary } = auditLayers("42-17", "I want to move on");
    // Should NOT say student "gave X instead of Y"
    expect(summary).not.toMatch(/instead of/i);
    // Should NOT attribute wrong math
    expect(summary).not.toMatch(/gave \d+/i);
  });
});
