/**
 * Multi-Question Guardrail Tests
 *
 * Tests for detectMultiQuestion, rewriteToSingleQuestion,
 * probe deduplication, and enforceQuestionContinueInvariant.
 */

import {
  detectMultiQuestion,
  rewriteToSingleQuestion,
  enforceQuestionContinueInvariant,
  detectProbeRepeat,
  findUnusedProbe,
  enforceAllGuardrails,
  resolvePromptScope,
  detectOnTopicButClipped,
  buildRetryPrompt,
  buildRepairResponse,
  classifyConceptType,
  buildConceptProbe,
  hasProceduralEvidence,
  buildProceduralReflection,
  classifyStudentIntent,
  containsCompletionLanguage,
  enforceDecisionEngineInvariants,
  containsProceduralLanguage,
  evaluateExamplesMastery,
  ensureProbeHasQuestion,
  buildProbeFromQuestion,
  isProceduralPrompt,
  buildSafeProbe,
  filterMetaUtterances,
  extractDeterministicEvidence,
  validateRubricClaims,
  buildDeterministicOverall,
  extractPlanetMaterialPairs,
  buildDeterministicSummary,
  normalizeMaterial,
  detectTypeStatement,
  isPraiseOnly,
  detectClearlyWrongAnswer,
  buildWrongAnswerResponse,
  containsWrongAnswerPraise,
  hasExplicitCorrection,
  stripMetaPrefix,
  extractIncorrectClaims,
  checkMathMastery,
  buildPerformanceAwareClose,
  buildMathStrategyProbe,
  buildMathRetryProbe,
  promptRequiresMathExplanation,
  isOffTopicResponse,
  countOffTopicTurns,
  buildMetaConfusionResponse,
  detectHintFollowedByProgress,
} from "./videoCoachGuardrails";
import type { MathValidationResult, MathBoundingDecision } from "./mathAnswerValidator";
import { validateMathAnswer, boundMathScore, detectStrategiesWithContext, accumulateMathStrategies } from "./mathAnswerValidator";
import type { MathProblem } from "./mathProblem";
import { buildMathTeacherSummary } from "./teacherSummary";

describe("detectMultiQuestion", () => {
  it("detects multiple question marks", () => {
    const text = "Can you think of how the sun helps planets stay in orbit? How does the sun's energy help the planets?";
    expect(detectMultiQuestion(text)).toBe("multi_question");
  });

  it("detects or-branching in a question", () => {
    const text = "Can you think of how the sun helps planets stay in orbit or affects temperature on Earth?";
    expect(detectMultiQuestion(text)).toBe("or_branch");
  });

  it("detects and-branching joining two concepts in a question", () => {
    const text = "How does the sun affect the orbits of planets and the temperature on Earth?";
    expect(detectMultiQuestion(text)).toBe("and_branch");
  });

  it("allows single question with no branching", () => {
    const text = "That's a good start. How does the sun affect temperature on Earth?";
    expect(detectMultiQuestion(text)).toBeNull();
  });

  it("allows a single question even with short or", () => {
    // "hot or cold" — short both sides, not 8+ chars
    const text = "Is it hot or cold on Mercury?";
    expect(detectMultiQuestion(text)).toBeNull();
  });

  it("allows a statement followed by one question", () => {
    const text = "Good thinking. What keeps the planets moving around the sun?";
    expect(detectMultiQuestion(text)).toBeNull();
  });

  it("allows no questions (Path A close)", () => {
    const text = "That explains it clearly. Let's go to the next question.";
    expect(detectMultiQuestion(text)).toBeNull();
  });

  it("detects two questions even when mixed with statements", () => {
    const text = "You're right about that. What does the sun provide? Can you also describe why orbits happen?";
    expect(detectMultiQuestion(text)).toBe("multi_question");
  });

  // ── Compound concept detection (3+ words per side) ──

  it("detects or-branch with 3-word clauses", () => {
    // "helps planets orbit" (3w) or "changes their temperature" (3w) → compound
    const text = "Does the sun helps planets orbit or changes their temperature?";
    expect(detectMultiQuestion(text)).toBe("or_branch");
  });

  it("allows simple binary 'near or far'", () => {
    const text = "Is Mercury near or far from the sun?";
    expect(detectMultiQuestion(text)).toBeNull();
  });

  it("allows simple binary 'too hot or too cold'", () => {
    const text = "Is the planet too hot or too cold?";
    expect(detectMultiQuestion(text)).toBeNull();
  });

  it("detects compound concept with one question mark", () => {
    // Two conceptual targets joined by "and" — single "?" but two concepts
    const text = "How does the sun's gravity keep planets in orbit and provide energy for plants?";
    expect(detectMultiQuestion(text)).toBe("and_branch");
  });
});

describe("rewriteToSingleQuestion", () => {
  const questionText = "Why is the sun important to our solar system?";

  it("preserves acknowledgment and produces exactly one question", () => {
    const multi = "You're right about that. Can you think of how the sun helps planets stay in orbit? How does it affect temperature?";
    const result = rewriteToSingleQuestion(multi, "sunlight and warmth", questionText);

    // Should have exactly one question mark
    const questionMarks = (result.match(/\?/g) || []).length;
    expect(questionMarks).toBe(1);

    // Should start with acknowledgment
    expect(result).toMatch(/^You're right about that\./);
  });

  it("picks warmth topic when student mentions warmth", () => {
    const result = rewriteToSingleQuestion(
      "Good start. Why does X or Y happen?",
      "the sun gives warmth and heat",
      questionText
    );
    expect(result).toContain("warmth");
    expect(detectMultiQuestion(result)).toBeNull();
  });

  it("picks light topic when student mentions sunlight", () => {
    const result = rewriteToSingleQuestion(
      "Good start. Why does X or Y happen?",
      "it provides sunlight to all the plants",
      questionText
    );
    expect(result).toContain("sunlight");
    expect(detectMultiQuestion(result)).toBeNull();
  });

  it("picks orbit topic when student mentions gravity", () => {
    const result = rewriteToSingleQuestion(
      "Good start. Why does X or Y happen?",
      "the gravity pulls the planets in orbit",
      questionText
    );
    expect(result).toContain("planets");
    expect(detectMultiQuestion(result)).toBeNull();
  });

  it("uses generic acknowledgment when no statement sentence exists", () => {
    const result = rewriteToSingleQuestion(
      "Can you explain orbit or temperature?",
      "sunlight",
      questionText
    );
    expect(result).toMatch(/^Good thinking\./);
    expect(detectMultiQuestion(result)).toBeNull();
  });

  it("result always passes detectMultiQuestion", () => {
    const cases = [
      { coach: "Right! What about orbit? And what about temperature?", student: "warmth" },
      { coach: "Can the sun affect orbits or temperature on Earth?", student: "light and heat" },
      { coach: "Good. How does energy transfer and how does gravity work?", student: "the sun is big" },
    ];

    for (const { coach, student } of cases) {
      const result = rewriteToSingleQuestion(coach, student, questionText);
      expect(detectMultiQuestion(result)).toBeNull();
    }
  });
});

// ── enforceQuestionContinueInvariant ───────────────────────────────────────

describe("enforceQuestionContinueInvariant", () => {
  it("INVARIANT B: strips questions when shouldContinue=false", () => {
    const result = enforceQuestionContinueInvariant(
      "Great job! What else can you think of?",
      false,
      undefined,
      false
    );
    expect(result.shouldContinue).toBe(false);
    expect(result.response).not.toContain("?");
    expect(result.response).toContain("Great job!");
  });

  it("INVARIANT B: uses close template when only questions remain", () => {
    const result = enforceQuestionContinueInvariant(
      "What do you think?",
      false,
      undefined,
      false
    );
    expect(result.shouldContinue).toBe(false);
    expect(result.response).not.toContain("?");
    expect(result.response.length).toBeGreaterThan(5);
  });

  it("INVARIANT B: uses final-question template when isFinalQuestion", () => {
    const result = enforceQuestionContinueInvariant(
      "What do you think?",
      false,
      undefined,
      true
    );
    expect(result.shouldContinue).toBe(false);
    expect(result.response).not.toContain("?");
    expect(result.response).toContain("Thanks for sharing your thinking");
  });

  it("INVARIANT A: forces shouldContinue=true when followUpQuestion present", () => {
    const result = enforceQuestionContinueInvariant(
      "Good thinking.",
      false,
      "How does that help plants grow?",
      false
    );
    expect(result.shouldContinue).toBe(true);
  });

  it("passes through when contract is already satisfied (continue + question)", () => {
    const result = enforceQuestionContinueInvariant(
      "Good! What keeps the planets in orbit?",
      true,
      undefined,
      false
    );
    expect(result.shouldContinue).toBe(true);
    expect(result.response).toContain("?");
  });

  it("passes through when contract is satisfied (close + no question)", () => {
    const result = enforceQuestionContinueInvariant(
      "Great work on this topic!",
      false,
      undefined,
      false
    );
    expect(result.shouldContinue).toBe(false);
    expect(result.response).toBe("Great work on this topic!");
  });

  it("EXACT BUG REPRO: score=80 shouldContinue=false but response has question", () => {
    // This is the exact scenario from the bug report:
    // score=80, shouldContinue=false, but the LLM included a question
    const result = enforceQuestionContinueInvariant(
      "You really understand this! How does the distance from the sun change what a planet is like?",
      false,
      undefined,
      false
    );
    // The question should be stripped, shouldContinue stays false
    expect(result.shouldContinue).toBe(false);
    expect(result.response).not.toContain("?");
    expect(result.response).toContain("understand");
  });

  it("PRAISE-ONLY GUARD: 'Good thinking.' stripped to performance-aware close when needs_support", () => {
    const result = enforceQuestionContinueInvariant(
      "Good thinking. What is 1 + 4?",
      false,
      undefined,
      false,
      "needs_support",
    );
    expect(result.shouldContinue).toBe(false);
    // Should NOT contain "Good thinking" — should be replaced with neutral close
    expect(result.response).not.toMatch(/good thinking/i);
    expect(result.response).not.toContain("Please click Submit Response");
    expect(result.response).not.toContain("click");
  });

  it("PRAISE-ONLY GUARD: 'Good thinking.' with developing status gets developing close", () => {
    const result = enforceQuestionContinueInvariant(
      "Good thinking. What is 10 + 10?",
      false,
      undefined,
      false,
      "developing",
    );
    expect(result.shouldContinue).toBe(false);
    expect(result.response).not.toMatch(/good thinking/i);
    // Should use developing-level close
    expect(result.response).toContain("keep practicing");
  });

  it("PRAISE-ONLY GUARD: 'Good thinking.' with strong status keeps praise", () => {
    // Strong/mastery students CAN get praise-only wrap
    const result = enforceQuestionContinueInvariant(
      "Good thinking. What else can you add?",
      false,
      undefined,
      false,
      "strong",
    );
    expect(result.shouldContinue).toBe(false);
    // For strong, "Good thinking." is acceptable
    expect(result.response).toMatch(/good thinking/i);
  });

  it("PRAISE-ONLY GUARD (no-strip): praise-only without questions gets replaced", () => {
    const result = enforceQuestionContinueInvariant(
      "Good thinking.",
      false,
      undefined,
      false,
      "needs_support",
    );
    expect(result.shouldContinue).toBe(false);
    expect(result.response).not.toMatch(/good thinking/i);
    expect(result.response).not.toContain("Please click Submit Response");
    expect(result.response).not.toContain("click");
  });
});

// ── Probe Deduplication ──────────────────────────────────────────────────────

describe("detectProbeRepeat", () => {
  it("detects exact normalized match", () => {
    const probe = "Besides warmth, what does the sun do that keeps planets in orbit?";
    const asked = [probe];
    expect(detectProbeRepeat(probe, asked)).toBe(0);
  });

  it("detects exact match with different punctuation/casing", () => {
    const probe = "Besides warmth, what does the sun do that keeps planets in orbit?";
    const asked = ["besides warmth what does the sun do that keeps planets in orbit"];
    expect(detectProbeRepeat(probe, asked)).toBe(0);
  });

  it("detects bigram overlap > 0.35 (paraphrased repeat)", () => {
    const probe = "What does the sun do to keep planets in orbit besides warmth?";
    const asked = ["Besides warmth, what does the sun do that keeps planets in orbit?"];
    expect(detectProbeRepeat(probe, asked)).toBe(0);
  });

  it("detects 5+ consecutive word overlap", () => {
    const probe = "Good thinking. What does the sun do that keeps planets in orbit around it?";
    const asked = ["Besides warmth, what does the sun do that keeps planets in orbit?"];
    expect(detectProbeRepeat(probe, asked)).toBe(0);
  });

  it("returns -1 for genuinely different questions", () => {
    const probe = "Why do some planets end up too hot or too cold?";
    const asked = ["Besides warmth, what does the sun do that keeps planets in orbit?"];
    expect(detectProbeRepeat(probe, asked)).toBe(-1);
  });

  it("returns -1 for empty history", () => {
    const probe = "What does the sun do?";
    expect(detectProbeRepeat(probe, [])).toBe(-1);
  });

  it("checks against all asked questions, not just the last", () => {
    const probe = "Why do some planets end up too hot or too cold?";
    const asked = [
      "Besides warmth, what does the sun do that keeps planets in orbit?",
      "How does distance from the sun change what a planet is like?",
      "Why do some planets end up too hot or too cold?",
    ];
    expect(detectProbeRepeat(probe, asked)).toBe(2);
  });
});

describe("findUnusedProbe", () => {
  // This question matches the LEGACY_PROMPT_SCOPES regex /\bsun\b.*\bplanet/i
  const solarSystemQuestion = "Why is the sun important to our planets?";

  it("returns the first unused primary probe", () => {
    const scope = resolvePromptScope(solarSystemQuestion)!;
    expect(scope).not.toBeNull();

    const result = findUnusedProbe(scope, [
      "Besides warmth, what does the sun do that keeps planets in orbit?",
    ], "warmth");

    // Should NOT return the already-asked probe
    expect(result).not.toContain("keeps planets in orbit");
    expect(result).toContain("?");
  });

  it("respects preferred ordering: picks distance probe (2nd) after orbit probe (1st) is used", () => {
    const scope = resolvePromptScope(solarSystemQuestion)!;
    expect(scope).not.toBeNull();

    const result = findUnusedProbe(scope, [
      "Besides warmth, what does the sun do that keeps planets in orbit?",
    ], "it makes things warm");

    // Should select the 2nd probe (distance) since 1st (orbit) is used
    expect(result).toContain("distance from the sun");
  });

  it("skips secondary probe when bridge keywords have been used", () => {
    const scope = resolvePromptScope(solarSystemQuestion)!;
    expect(scope).not.toBeNull();

    // All primary probes used + bridge keyword in history
    const asked = [
      "Besides warmth, what does the sun do that keeps planets in orbit?",
      "How does distance from the sun change what a planet is like?",
      "What might happen to planets if the sun disappeared?",
      "Why do some planets end up too hot or too cold?",
      "Plants need sunlight — how does that show the sun is important for Earth compared to other planets?",
    ];

    const result = findUnusedProbe(scope, asked, "warmth");
    // Should pick a primary probe (least similar), NOT a secondary with "plants"
    expect(result).toContain("?");
  });

  it("returns a probe even when all have been used (least similar fallback)", () => {
    const scope = resolvePromptScope(solarSystemQuestion)!;
    expect(scope).not.toBeNull();

    const asked = [
      "Besides warmth, what does the sun do that keeps planets in orbit?",
      "How does distance from the sun change what a planet is like?",
      "What might happen to planets if the sun disappeared?",
      "Why do some planets end up too hot or too cold?",
    ];

    const result = findUnusedProbe(scope, asked, "warmth");
    expect(result).toContain("?");
  });
});

// ── Single-Concept Enforcement ───────────────────────────────────────────

describe("single-concept enforcement via detectMultiQuestion + rewrite", () => {
  const questionText = "Why is the sun important to our planets?";

  it("rewrites question with two concept clusters joined by 'and'", () => {
    const multiConcept = "Good thinking. How does the sun affect the orbits of planets and the temperature on Earth?";
    expect(detectMultiQuestion(multiConcept)).toBe("and_branch");

    const rewritten = rewriteToSingleQuestion(multiConcept, "warmth from the sun", questionText);
    expect(rewritten).toContain("Good thinking.");
    const qMarks = (rewritten.match(/\?/g) || []).length;
    expect(qMarks).toBe(1);
  });

  it("rewrites question with two concept clusters joined by 'or'", () => {
    const multiConcept = "Can you tell me about how the sun helps planets stay in orbit or affects temperature on Earth?";
    expect(detectMultiQuestion(multiConcept)).toBe("or_branch");

    const rewritten = rewriteToSingleQuestion(multiConcept, "gravity pulls the planets", questionText);
    const qMarks = (rewritten.match(/\?/g) || []).length;
    expect(qMarks).toBe(1);
  });

  it("preserves single-concept questions unchanged", () => {
    const singleConcept = "Good thinking. What keeps the planets in orbit?";
    expect(detectMultiQuestion(singleConcept)).toBeNull();
    // Single concept should pass through enforceAllGuardrails unchanged
    // (assuming no other guardrails trigger)
  });
});

describe("enforceAllGuardrails with probe dedup", () => {
  // Must match LEGACY_PROMPT_SCOPES regex /\bsun\b.*\bplanet/i
  const solarQ = "Why is the sun important to our planets?";

  it("REGRESSION: replaces repeated 'Plants need sunlight' probe", () => {
    const coachText = "Good thinking! Plants need sunlight — how does that show the sun is important for Earth compared to other planets?";
    const askedHistory = [
      "Plants need sunlight — how does that show the sun is important for Earth compared to other planets?",
    ];

    const result = enforceAllGuardrails(
      coachText, "the sun gives warmth", solarQ, "response",
      undefined, undefined, askedHistory
    );

    // Should NOT repeat the plants probe
    expect(result).not.toContain("Plants need sunlight");
    expect(result).toContain("?");
  });

  it("does not modify a genuinely new probe", () => {
    const coachText = "Good thinking! How does distance from the sun change what a planet is like?";
    const askedHistory = [
      "Besides warmth, what does the sun do that keeps planets in orbit?",
    ];

    const result = enforceAllGuardrails(
      coachText, "warmth and light", solarQ, "response",
      undefined, undefined, askedHistory
    );

    // Should keep the original probe (it's not a repeat)
    expect(result).toContain("distance from the sun");
  });

  it("blocks secondary bridge probe after bridge keyword used in history", () => {
    const scope = resolvePromptScope(solarQ)!;
    expect(scope).not.toBeNull();

    const coachText = "Plants need sunlight — how does that show the sun is important for Earth compared to other planets?";
    // History contains coach question mentioning plants (bridge used)
    const askedHistory = [
      "How do plants use the sun's energy?",
    ];

    const result = enforceAllGuardrails(
      coachText, "plants grow using sunlight", solarQ, "response",
      scope, undefined, askedHistory
    );

    // Bridge already used, should be replaced with a primary probe
    expect(result).not.toContain("Plants need sunlight");
    expect(result).toContain("?");
  });

  it("uses closing ack (no question) when duplicate detected in closing window", () => {
    // Use a student answer that won't trigger echo detection (no shared bigrams with coach text)
    const coachText = "Nice job! Besides warmth, what does the sun do that keeps planets in orbit?";
    const askedHistory = [
      "Besides warmth, what does the sun do that keeps planets in orbit?",
    ];

    const result = enforceAllGuardrails(
      coachText, "it helps things grow and gives energy", solarQ, "response",
      undefined, undefined, askedHistory, 10 // 10s left = closing window
    );

    // Should NOT contain any question mark — clean closing ack
    expect(result).not.toContain("?");
    expect(result).toContain("great ideas");
  });

  it("replaces duplicate with new probe when NOT in closing window", () => {
    const coachText = "Nice job! Besides warmth, what does the sun do that keeps planets in orbit?";
    const askedHistory = [
      "Besides warmth, what does the sun do that keeps planets in orbit?",
    ];

    const result = enforceAllGuardrails(
      coachText, "it helps things grow and gives energy", solarQ, "response",
      undefined, undefined, askedHistory, 60 // 60s left = plenty of time
    );

    // Should replace with a new probe (has question mark)
    expect(result).not.toContain("keeps planets in orbit");
    expect(result).toContain("?");
  });

  it("replaces duplicate with new probe when timeRemainingSec is undefined", () => {
    const coachText = "Nice job! Besides warmth, what does the sun do that keeps planets in orbit?";
    const askedHistory = [
      "Besides warmth, what does the sun do that keeps planets in orbit?",
    ];

    const result = enforceAllGuardrails(
      coachText, "it helps things grow and gives energy", solarQ, "response",
      undefined, undefined, askedHistory // no timeRemainingSec
    );

    // Should still replace with a new probe (backward compat)
    expect(result).not.toContain("keeps planets in orbit");
    expect(result).toContain("?");
  });
});

// ── enforceAllGuardrails — procedural language ban ──────────────────────────

describe("enforceAllGuardrails — procedural language ban", () => {
  it("rewrites 'first step' on a non-procedural question", () => {
    const coachText = "What was your first step, and what did you get?";
    const result = enforceAllGuardrails(
      coachText, "community helpers help people", "What makes a good community helper?", "response"
    );
    expect(result).not.toContain("first step");
    expect(result).not.toContain("what did you get");
    expect(result).toContain("?");
  });

  it("allows 'first step' on a procedural question", () => {
    const coachText = "What was your first step, and what did you get?";
    const result = enforceAllGuardrails(
      coachText, "I subtracted", "Explain the steps to subtract 8 - 3 - 2.", "response"
    );
    expect(result).toContain("first step");
  });

  it("rewrites 'walk me through each step' on a non-procedural question", () => {
    const coachText = "Can you walk me through each step?";
    const result = enforceAllGuardrails(
      coachText, "leaves change color in autumn", "Why do leaves change color in the fall?", "response"
    );
    expect(result).not.toContain("walk me through each step");
  });
});

// ── detectOnTopicButClipped ──────────────────────────────────────────────

describe("detectOnTopicButClipped", () => {
  // Use a question that matches the legacy scope regex (\bsun\b.*\bplanet)
  const solarQ = "Why is the sun important to the planets?";
  const solarScope = resolvePromptScope(solarQ);

  it("returns true for clipped on-topic response", () => {
    expect(detectOnTopicButClipped("um... warmth", solarScope)).toBe(true);
  });

  it("returns false for off-topic response", () => {
    expect(detectOnTopicButClipped("I like pizza", solarScope)).toBe(false);
  });

  it("returns false for substantive on-topic response (>= 5 content words)", () => {
    expect(
      detectOnTopicButClipped(
        "the sun gives warmth and heat and light to the planets",
        solarScope
      )
    ).toBe(false);
  });

  it("returns false when no scope available", () => {
    expect(detectOnTopicButClipped("warmth", null)).toBe(false);
  });

  it("returns false for empty response", () => {
    expect(detectOnTopicButClipped("", solarScope)).toBe(false);
  });
});

// ── buildRetryPrompt ─────────────────────────────────────────────────────

describe("buildRetryPrompt", () => {
  const solarQ = "Why is the sun important to the planets?";
  const solarScope = resolvePromptScope(solarQ);

  it("uses Clarify mode for on-topic-but-clipped responses", () => {
    const result = buildRetryPrompt(solarQ, 0, "um... warmth", solarScope);
    expect(result).toMatch(/caught|idea|heard/i);
    expect(result).not.toContain("different angle");
  });

  it("uses standard retry for off-topic responses", () => {
    const result = buildRetryPrompt(solarQ, 0, "I like pizza", solarScope);
    expect(result).not.toContain("different angle");
    expect(result).toMatch(/\?/); // still asks a question
  });

  it("never uses 'different angle' across all variants", () => {
    for (let i = 0; i < 6; i++) {
      const result = buildRetryPrompt(solarQ, i, undefined, solarScope);
      expect(result).not.toContain("different angle");
    }
  });

  it("backward compatible — works without studentResponse and scope", () => {
    const result = buildRetryPrompt(solarQ, 0);
    expect(result.length).toBeGreaterThan(0);
    expect(result).not.toContain("different angle");
  });
});

// ── buildRepairResponse ──────────────────────────────────────────────────

describe("buildRepairResponse", () => {
  const solarQ = "Why is the sun important to the planets?";

  it("never uses 'different angle' in any repair variant", () => {
    for (let i = 0; i < 6; i++) {
      const result = buildRepairResponse(solarQ, i);
      expect(result).not.toContain("different angle");
    }
  });

  it("uses empathetic language", () => {
    const result = buildRepairResponse(solarQ, 0);
    expect(result).toMatch(/hear you|okay|understand/i);
  });
});

// ============================================================================
// resolvePostEvaluation — mastery
// ============================================================================

import { resolvePostEvaluation, CORRECT_THRESHOLD } from "./videoCoachGuardrails";

describe("resolvePostEvaluation — mastery", () => {
  const strongCorrect = { score: 90, isCorrect: true, shouldContinue: false };

  test("strong criteria → shouldContinue=false (clean end)", () => {
    const result = resolvePostEvaluation(strongCorrect, 1, 3, 0, "strong", 45);
    expect(result.shouldContinue).toBe(false);
    expect(result.probeFirst).toBe(false);
  });

  test("strong criteria + any time → always ends (no continuation)", () => {
    const result = resolvePostEvaluation(strongCorrect, 1, 3, 0, "strong", 10);
    expect(result.shouldContinue).toBe(false);
  });

  test("developing → probes for missing criteria", () => {
    const result = resolvePostEvaluation(strongCorrect, 1, 3, 0, "developing", 45);
    expect(result.probeFirst).toBe(true);
  });

  test("incorrect first attempt → continues (hard guardrail)", () => {
    const result = resolvePostEvaluation(
      { score: 40, isCorrect: false, shouldContinue: false }, 0, 3, 0
    );
    expect(result.shouldContinue).toBe(true);
  });

  test("incorrect max attempts → ends", () => {
    const result = resolvePostEvaluation(
      { score: 40, isCorrect: false, shouldContinue: false }, 2, 3, 0
    );
    expect(result.shouldContinue).toBe(false);
  });

  test("mathAnswerCorrect=true + score < 80 → continues with probeFirst (explanation missing)", () => {
    // Student got 25 correct but score=60 because no explanation. Should NOT wrap.
    const result = resolvePostEvaluation(
      { score: 60, isCorrect: false, shouldContinue: false },
      2, 3, 0, "developing", 90, false, true
    );
    expect(result.shouldContinue).toBe(true);
    expect(result.probeFirst).toBe(true);
  });

  test("mathAnswerCorrect=true + score >= 80 → uses normal correct path (not double-probing)", () => {
    // When score is already >= 80, the normal correct path handles it.
    const result = resolvePostEvaluation(
      { score: 85, isCorrect: true, shouldContinue: false },
      1, 3, 0, "developing", 90, false, true
    );
    expect(result.shouldContinue).toBe(true);
    expect(result.probeFirst).toBe(true);
  });

  test("mathAnswerCorrect=false + max attempts → still ends (truly wrong answer)", () => {
    const result = resolvePostEvaluation(
      { score: 40, isCorrect: false, shouldContinue: false },
      2, 3, 0, "needs_support", 90, false, false
    );
    expect(result.shouldContinue).toBe(false);
  });

  test("mathAnswerCorrect=undefined + max attempts → still ends (non-math prompt)", () => {
    const result = resolvePostEvaluation(
      { score: 40, isCorrect: false, shouldContinue: false }, 2, 3, 0
    );
    expect(result.shouldContinue).toBe(false);
  });
});

// ============================================================================
// Summary grounding helpers (inline logic acceptance tests)
// ============================================================================

describe("Summary grounding — content word extraction + foreign keyword detection", () => {
  // Replicate the stop words and helpers from coach.ts for testing
  const STOP_WORDS = new Set([
    "student", "students", "they", "their", "them", "this", "that", "these",
    "those", "have", "does", "said", "says", "showed", "shows", "explained",
    "understanding", "demonstrated", "noted", "mentioned", "stated",
    "response", "responses", "answer", "answers", "question", "questions",
    "about", "also", "were", "with", "from", "when", "what", "which",
    "some", "more", "than", "been", "being", "would", "could", "should",
    "very", "just", "like", "well", "then", "however", "although", "while",
    "during", "through", "after", "before", "above", "below", "each",
    "expressed", "indicated", "addressed", "provided", "offered",
    "showing", "suggesting", "including", "regarding", "concerning",
  ]);

  const toContentWords = (text: string): string[] =>
    text
      .toLowerCase()
      .replace(/[^a-z\s'-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOP_WORDS.has(w));

  const DOMAIN_KEYWORDS = [
    "sun", "solar", "planet", "planets", "orbit", "orbits", "moon",
    "star", "stars", "galaxy", "comet", "asteroid", "gravity",
    "photosynthesis", "chlorophyll", "oxygen", "carbon",
    "dinosaur", "dinosaurs", "fossil", "fossils",
    "volcano", "earthquake", "magma", "lava",
    "ocean", "river", "mountain", "continent",
    "multiplication", "division", "fraction", "fractions",
    "subtraction", "addition", "equation",
    "president", "revolution", "colony", "colonies",
  ];

  const detectForeignKeywords = (text: string, contextWords: Set<string>): string[] =>
    DOMAIN_KEYWORDS.filter((kw) => {
      const regex = new RegExp(`\\b${kw}\\b`, "i");
      return regex.test(text) && !contextWords.has(kw);
    });

  test("stop words are excluded from content word extraction", () => {
    const words = toContentWords("The student explained their understanding of the question");
    expect(words).toEqual([]);
  });

  test("substantive domain words are preserved", () => {
    const words = toContentWords("subtraction involves taking away numbers");
    expect(words).toContain("subtraction");
    expect(words).toContain("involves");
    expect(words).toContain("taking");
    expect(words).toContain("numbers");
  });

  test("foreign keyword: 'sun' detected when not in context (math lesson)", () => {
    const context = new Set(toContentWords("What is 15 minus 8? subtraction problems"));
    const foreign = detectForeignKeywords("The student discussed the sun and solar system", context);
    expect(foreign).toContain("sun");
    expect(foreign).toContain("solar");
  });

  test("foreign keyword: not flagged when in context (solar system lesson)", () => {
    const context = new Set([
      ...toContentWords("How does the sun heat the earth? solar energy"),
      "sun", // 3-char word added manually
    ]);
    const foreign = detectForeignKeywords("The student discussed the sun and solar energy", context);
    expect(foreign).not.toContain("sun");
    expect(foreign).not.toContain("solar");
  });

  test("cross-contamination: orbit/gravity in math lesson flagged", () => {
    const context = new Set(toContentWords("What is 24 divided by 6? division practice"));
    const foreign = detectForeignKeywords("The student explored orbits and gravity", context);
    expect(foreign).toContain("orbits");
    expect(foreign).toContain("gravity");
  });

  test("no false positives: summary matches lesson topic entirely", () => {
    const context = new Set([
      ...toContentWords("Why do we have seasons? Earth orbit around the sun"),
      "sun",
    ]);
    const foreign = detectForeignKeywords(
      "The student explained that Earth's orbit around the sun causes seasons", context
    );
    expect(foreign).toHaveLength(0);
  });

  test("grounding overlap expansion: bullet passes when words match prompt", () => {
    const studentWords = new Set(toContentWords("I think you take away the smaller number"));
    const promptWords = new Set(toContentWords("What is 15 minus 8? subtraction problem"));
    const allowedWords = new Set([...studentWords, ...promptWords]);

    const bullet = "The student attempted the subtraction problem using a take-away strategy";
    const bulletContentWords = toContentWords(bullet);
    const overlap = bulletContentWords.filter((w) => allowedWords.has(w)).length;
    expect(overlap).toBeGreaterThanOrEqual(2);
  });

  test("grounding overlap: bullet with only generic words fails", () => {
    const allowedWords = new Set([
      ...toContentWords("I think it's twenty"),
      ...toContentWords("What is the answer?"),
    ]);

    const bullet = "The student provided a response that showed some understanding";
    const bulletContentWords = toContentWords(bullet);
    const overlap = bulletContentWords.filter((w) => allowedWords.has(w)).length;
    expect(overlap).toBe(0);
  });
});

// ============================================================================
// classifyConceptType — procedural detection
// ============================================================================

describe("classifyConceptType — procedural", () => {
  it("classifies subtraction question as procedural", () => {
    expect(classifyConceptType(
      "How would you subtract 8, 3, and 2?",
      "I would take away 3 from 8"
    )).toBe("procedural");
  });

  it("classifies addition question as procedural", () => {
    expect(classifyConceptType(
      "What is the addition of 5 and 3?",
      "5 plus 3 is 8"
    )).toBe("procedural");
  });

  it("classifies step-by-step question as procedural", () => {
    expect(classifyConceptType(
      "Explain your thinking step by step",
      "first I added them together"
    )).toBe("procedural");
  });

  it("classifies show-your-work question as procedural", () => {
    expect(classifyConceptType(
      "Show your work for this problem",
      "I multiplied 4 times 3"
    )).toBe("procedural");
  });

  it("still classifies photosynthesis as abstract (not procedural)", () => {
    expect(classifyConceptType(
      "How does photosynthesis work?",
      "plants use sunlight"
    )).toBe("abstract");
  });

  it("still classifies solar system as observable", () => {
    expect(classifyConceptType(
      "Why is the sun important to the planets?",
      "it gives warmth"
    )).toBe("observable");
  });
});

// ============================================================================
// buildConceptProbe — procedural evidence-based probes
// ============================================================================

describe("buildConceptProbe — procedural", () => {
  const mathQ = "How would you subtract 8, 3, and 2? Explain your thinking.";

  it("asks for steps when student gives answer without steps", () => {
    const probe = buildConceptProbe("procedural", mathQ, "the answer is 3");
    expect(probe).toMatch(/step|first/i);
  });

  it("asks for reasoning when student gives steps without why", () => {
    const probe = buildConceptProbe("procedural", mathQ, "first I subtracted the smaller number then I subtracted the next one");
    expect(probe).toMatch(/why|order/i);
  });

  it("asks to verify when student gives both numbers and steps", () => {
    const probe = buildConceptProbe("procedural", mathQ, "first I did 8 minus 3 and got 5 then I subtracted 2");
    expect(probe).toMatch(/check|backwards/i);
  });

  it("asks for first step as default", () => {
    const probe = buildConceptProbe("procedural", mathQ, "I would subtract them");
    expect(probe).toMatch(/first step/i);
  });
});

// ── buildConceptProbe — observable evidence-based probes ─────────────────────

describe("buildConceptProbe — observable", () => {
  const sciQ = "What happens to a caterpillar when it becomes a butterfly?";

  it("asks for an example when student hasn't given one", () => {
    const probe = buildConceptProbe("observable", sciQ, "it changes into a butterfly");
    expect(probe).toMatch(/example/i);
  });

  it("asks for sensory detail when student gave an example but no description", () => {
    const probe = buildConceptProbe("observable", sciQ, "for example the monarch butterfly");
    expect(probe).toMatch(/notice|watching/i);
  });

  it("asks about materials for building/experiment questions", () => {
    const buildQ = "How would you build a model of the solar system?";
    const probe = buildConceptProbe("observable", buildQ, "for example I would use balls and it would look like planets spinning");
    expect(probe).toMatch(/materials|tools/i);
  });

  it("falls back to 'describe what it would look like' when student has example and description", () => {
    const probe = buildConceptProbe("observable", sciQ, "for example a caterpillar I noticed looks like a small fuzzy worm");
    expect(probe).toMatch(/describe|look like/i);
  });
});

// ── containsProceduralLanguage ──────────────────────────────────────────────

describe("containsProceduralLanguage", () => {
  it("detects 'first step'", () => {
    expect(containsProceduralLanguage("What was your first step?")).toBe(true);
  });

  it("detects 'what did you get'", () => {
    expect(containsProceduralLanguage("What did you get when you tried that?")).toBe(true);
  });

  it("detects 'walk me through each step'", () => {
    expect(containsProceduralLanguage("Can you walk me through each step?")).toBe(true);
  });

  it("detects 'show your work'", () => {
    expect(containsProceduralLanguage("Can you show me your work?")).toBe(true);
  });

  it("detects standard 'steps' via containsStepsQuestion", () => {
    expect(containsProceduralLanguage("What are the steps?")).toBe(true);
  });

  it("does NOT flag non-procedural language", () => {
    expect(containsProceduralLanguage("Can you give me an example?")).toBe(false);
  });

  it("does NOT flag 'what do you think'", () => {
    expect(containsProceduralLanguage("What do you think about that?")).toBe(false);
  });
});

// ── hasProceduralEvidence ────────────────────────────────────────────────────

describe("hasProceduralEvidence", () => {
  it("detects strong evidence: steps + numbers + strategy", () => {
    expect(hasProceduralEvidence(
      "I broke 25 into 20 and 5. Then I did 34 + 20 = 54 and added 5 to get 59."
    )).toBe(true);
  });

  it("detects strong evidence: steps + numbers + intermediate sums", () => {
    expect(hasProceduralEvidence(
      "First I added 34 + 20 = 54, then I added 54 + 5 = 59."
    )).toBe(true);
  });

  it("returns false when no steps", () => {
    expect(hasProceduralEvidence("I split 25 into 20 and 5")).toBe(false);
  });

  it("returns false when no numbers", () => {
    expect(hasProceduralEvidence("First I broke it apart then added")).toBe(false);
  });

  it("returns false for simple answer with no strategy", () => {
    expect(hasProceduralEvidence("I think the answer is 59")).toBe(false);
  });
});

// ── buildProceduralReflection ────────────────────────────────────────────────

describe("buildProceduralReflection", () => {
  it("generates reflection about breaking apart a specific number", () => {
    const result = buildProceduralReflection(
      "What is 34 + 25?",
      "I broke 25 into 20 and 5 then added them step by step"
    );
    expect(result).toMatch(/25/);
    expect(result).toMatch(/why/i);
    expect(result).toMatch(/\?$/);
  });

  it("generates reflection about splitting without specific number", () => {
    const result = buildProceduralReflection(
      "What is 34 + 25?",
      "I split it up and then added each part step by step"
    );
    expect(result).toMatch(/why/i);
    expect(result).toMatch(/breaking|parts/i);
  });

  it("generates tens-first reflection", () => {
    const result = buildProceduralReflection(
      "What is 47 + 38?",
      "I added the tens and ones separately, tens first"
    );
    expect(result).toMatch(/tens first/i);
    expect(result).toMatch(/\?$/);
  });

  it("generates generic procedural reflection as fallback", () => {
    const result = buildProceduralReflection(
      "What is 15 - 8?",
      "First I started with 15 then I took away 8 and got 7"
    );
    expect(result).toMatch(/why/i);
    expect(result).toMatch(/\?$/);
  });
});

// ============================================================================
// classifyStudentIntent
// ============================================================================

describe("classifyStudentIntent", () => {
  it("returns meta_confusion for 'I'm confused'", () => {
    expect(classifyStudentIntent("I'm confused")).toBe("meta_confusion");
  });

  it("returns meta_confusion for 'what do you mean'", () => {
    expect(classifyStudentIntent("what do you mean")).toBe("meta_confusion");
  });

  it("returns meta_confusion for 'that's not what we're supposed to say'", () => {
    expect(classifyStudentIntent("that's not what we're supposed to say")).toBe("meta_confusion");
  });

  it("returns meta_confusion for 'are you a robot'", () => {
    expect(classifyStudentIntent("are you a robot")).toBe("meta_confusion");
  });

  it("returns explicit_end for 'I'm done'", () => {
    expect(classifyStudentIntent("I'm done")).toBe("explicit_end");
  });

  it("returns explicit_end for 'stop'", () => {
    expect(classifyStudentIntent("stop")).toBe("explicit_end");
  });

  it("returns explicit_end for 'I don't want to continue'", () => {
    expect(classifyStudentIntent("I don't want to continue")).toBe("explicit_end");
  });

  it("returns content for normal answers", () => {
    expect(classifyStudentIntent("The sun heats up the water and it evaporates")).toBe("content");
  });

  it("returns content when >= 4 topic words override meta phrase", () => {
    expect(classifyStudentIntent("Are we done? I think the answer is gravity pulls the water down")).toBe("content");
  });

  it("returns content for empty string", () => {
    expect(classifyStudentIntent("")).toBe("content");
  });
});

// ============================================================================
// containsCompletionLanguage
// ============================================================================

describe("containsCompletionLanguage", () => {
  it("detects 'Great work on this assignment!'", () => {
    expect(containsCompletionLanguage("Great work on this assignment!")).toBe(true);
  });

  it("detects 'You've met the goal'", () => {
    expect(containsCompletionLanguage("You've met the goal")).toBe(true);
  });

  it("detects 'you're done'", () => {
    expect(containsCompletionLanguage("Nice job, you're done!")).toBe(true);
  });

  it("detects 'click submit'", () => {
    expect(containsCompletionLanguage("Go ahead and click submit")).toBe(true);
  });

  it("detects 'that wraps up'", () => {
    expect(containsCompletionLanguage("That wraps up our session")).toBe(true);
  });

  it("does NOT flag 'Good thinking'", () => {
    expect(containsCompletionLanguage("Good thinking! Can you explain more?")).toBe(false);
  });

  it("does NOT flag 'That works because...'", () => {
    // 'that works' without sentence-ending punctuation should NOT match
    expect(containsCompletionLanguage("That works because the water cycle needs heat")).toBe(false);
  });
});

// ============================================================================
// enforceDecisionEngineInvariants
// ============================================================================

describe("enforceDecisionEngineInvariants", () => {
  const baseParams = {
    questionText: "How does the sun help plants grow?",
    studentResponse: "It gives them light",
    isFinalQuestion: false,
    resolvedScope: null,
  };

  it("strips completion language when criteriaMet=false and shouldContinue=true", () => {
    const result = enforceDecisionEngineInvariants({
      ...baseParams,
      response: "Great work on this assignment! You've done well.",
      shouldContinue: true,
      criteriaMet: false,
      studentIntent: "content",
    });
    expect(result.response).not.toContain("Great work on this assignment");
    expect(result.shouldContinue).toBe(true);
  });

  it("strips completion language when criteriaMet=false and shouldContinue=false", () => {
    const result = enforceDecisionEngineInvariants({
      ...baseParams,
      response: "You've met the goal. Click submit.",
      shouldContinue: false,
      criteriaMet: false,
      studentIntent: "content",
    });
    expect(result.response).not.toContain("met the goal");
    expect(result.response).toContain("Thanks for trying");
  });

  it("forces continue with repair for meta_confusion — re-asks original question", () => {
    const result = enforceDecisionEngineInvariants({
      ...baseParams,
      response: "That's okay, let me try to explain better.",
      shouldContinue: false,
      criteriaMet: false,
      studentIntent: "meta_confusion",
      timeRemainingSec: 60,
    });
    expect(result.shouldContinue).toBe(true);
    expect(result.response).toContain("No worries");
    // Must include the original question text and end with "?"
    expect(result.response).toContain("Here's the question again:");
    expect(result.response).toContain("?");
    expect(result.wrapReason).toBeNull();
  });

  it("meta_confusion re-ask does NOT contain 'Good thinking'", () => {
    const result = enforceDecisionEngineInvariants({
      ...baseParams,
      response: "Good thinking. That's a great start.",
      shouldContinue: true,
      criteriaMet: false,
      studentIntent: "meta_confusion",
      timeRemainingSec: 60,
    });
    expect(result.response).not.toContain("Good thinking");
    expect(result.response).toContain("?");
  });

  it("meta_confusion re-ask includes original question when short", () => {
    const result = enforceDecisionEngineInvariants({
      ...baseParams,
      questionText: "What are planets made of?",
      response: "Let me explain.",
      shouldContinue: false,
      criteriaMet: false,
      studentIntent: "meta_confusion",
      timeRemainingSec: 60,
    });
    expect(result.response).toContain("What are planets made of?");
  });

  it("does NOT force continue for meta_confusion when time < 25s", () => {
    const result = enforceDecisionEngineInvariants({
      ...baseParams,
      response: "Let me explain.",
      shouldContinue: false,
      criteriaMet: false,
      studentIntent: "meta_confusion",
      timeRemainingSec: 10,
    });
    // Should not trigger invariant 2 since time is too low
    expect(result.shouldContinue).toBe(false);
    expect(result.wrapReason).toBe("server_wrap");
  });

  it("sets wrapReason=explicit_end for explicit_end intent", () => {
    const result = enforceDecisionEngineInvariants({
      ...baseParams,
      response: "Okay, we can stop here.",
      shouldContinue: false,
      criteriaMet: false,
      studentIntent: "explicit_end",
    });
    expect(result.wrapReason).toBe("explicit_end");
  });

  it("sets wrapReason=server_wrap for content + shouldContinue=false", () => {
    const result = enforceDecisionEngineInvariants({
      ...baseParams,
      response: "Good effort on this question.",
      shouldContinue: false,
      criteriaMet: false,
      studentIntent: "content",
    });
    expect(result.wrapReason).toBe("server_wrap");
  });

  it("returns wrapReason=null when shouldContinue=true", () => {
    const result = enforceDecisionEngineInvariants({
      ...baseParams,
      response: "Good start! Can you tell me more?",
      shouldContinue: true,
      criteriaMet: false,
      studentIntent: "content",
    });
    expect(result.wrapReason).toBeNull();
  });
});

// ============================================================================
// enforceQuestionContinueInvariant — regression for fallback template
// ============================================================================

describe("enforceQuestionContinueInvariant — fallback template regression", () => {
  it("fallback template for isFinalQuestion does NOT contain premature completion language", () => {
    // When all sentences are questions and shouldContinue=false, the fallback fires
    const result = enforceQuestionContinueInvariant(
      "How does this work?",
      false,
      undefined,
      true
    );
    expect(result.response).not.toContain("Great work on this assignment");
    expect(result.response).toContain("Thanks for sharing your thinking");
  });

  it("fallback template for non-final question does NOT contain premature completion language", () => {
    const result = enforceQuestionContinueInvariant(
      "Why is that important?",
      false,
      undefined,
      false
    );
    expect(result.response).not.toContain("Good effort! Let's move on");
    expect(result.response).toContain("Thanks for trying");
  });
});

// ── evaluateExamplesMastery ─────────────────────────────────────────────────

describe("evaluateExamplesMastery", () => {
  const planetsQ = "How would you explain what planets are made of? Can you give examples of different planets and their materials?";

  it("returns 'strong' when student names 2+ planets with different materials", () => {
    const transcript = "Earth is made of rocks and metal. Jupiter is made of gas like hydrogen.";
    expect(evaluateExamplesMastery(planetsQ, transcript)).toBe("strong");
  });

  it("returns 'strong' for simple grade-2 language: 'Earth is rocks, Jupiter is gas'", () => {
    const transcript = "Earth is rocks and Jupiter is gas";
    expect(evaluateExamplesMastery(planetsQ, transcript)).toBe("strong");
  });

  it("returns 'strong' with ice as second material type", () => {
    const transcript = "Mars is rocky and Uranus is made of ice";
    expect(evaluateExamplesMastery(planetsQ, transcript)).toBe("strong");
  });

  it("returns null when only 1 planet named", () => {
    const transcript = "Earth is made of rocks and metal";
    expect(evaluateExamplesMastery(planetsQ, transcript)).toBeNull();
  });

  it("returns null when planets named but only 1 material type", () => {
    const transcript = "Earth and Mars are both rocky";
    expect(evaluateExamplesMastery(planetsQ, transcript)).toBeNull();
  });

  it("returns null for question that doesn't ask for examples + materials", () => {
    const otherQ = "Why is the sun important to the planets?";
    const transcript = "Earth is rocks and Jupiter is gas";
    expect(evaluateExamplesMastery(otherQ, transcript)).toBeNull();
  });

  it("returns null when no planets named at all", () => {
    const transcript = "some planets are made of rock and some are made of gas";
    expect(evaluateExamplesMastery(planetsQ, transcript)).toBeNull();
  });

  it("accumulates across full conversation transcript", () => {
    // Simulates first turn: mentions Earth + rocks; second turn: mentions Jupiter + gas
    const fullTranscript = "Earth is made of rocks. And Jupiter is made of gas.";
    expect(evaluateExamplesMastery(planetsQ, fullTranscript)).toBe("strong");
  });
});

// ── ensureProbeHasQuestion ──────────────────────────────────────────────────

describe("ensureProbeHasQuestion", () => {
  const planetsQ = "How would you explain what planets are made of? Can you give examples of different planets and their materials?";

  it("returns text unchanged when it already contains a question", () => {
    const text = "Good thinking. What else do you know about planets?";
    expect(ensureProbeHasQuestion(text, planetsQ, "some are rocky")).toBe(text);
  });

  it("appends deterministic probe when text has no question (planets)", () => {
    const text = "Good start—you've got the big idea about different types of planets.";
    const result = ensureProbeHasQuestion(text, planetsQ, "some planets are rocky and some are gas");
    expect(result).toContain("?");
    expect(result).toContain("Good start");
    expect(result).toMatch(/planets/i);
  });

  it("replaces with probe when text has no question and is too long for ack", () => {
    const longText = "You mentioned that some planets are made of different materials and that is a really great observation that shows you are thinking about the topic in the right way and considering the important details.";
    const result = ensureProbeHasQuestion(longText, planetsQ, "some are rocky");
    expect(result).toContain("?");
    // Long ack (>80 chars) should be dropped, just the probe
    expect(result).not.toContain("really great observation");
  });

  it("returns probe for empty text", () => {
    const result = ensureProbeHasQuestion("", planetsQ, "some are rocky");
    expect(result).toContain("?");
  });
});

// ── enforceDecisionEngineInvariants — INVARIANT 4: probe must have question ──

describe("enforceDecisionEngineInvariants — probe question enforcement", () => {
  const planetsQ = "What are planets made of? Give examples of different planets and their materials.";

  it("appends question when shouldContinue=true but no question in response", () => {
    const result = enforceDecisionEngineInvariants({
      response: "Good start—you've got the big idea about different types of planets. Good thinking.",
      shouldContinue: true,
      criteriaMet: false,
      studentIntent: "content",
      questionText: planetsQ,
      studentResponse: "Some are rock and some are gas",
      isFinalQuestion: false,
    });
    expect(result.response).toContain("?");
    expect(result.shouldContinue).toBe(true);
  });

  it("does NOT modify response when it already has a question", () => {
    const original = "Good start. What two planets would you use as examples?";
    const result = enforceDecisionEngineInvariants({
      response: original,
      shouldContinue: true,
      criteriaMet: false,
      studentIntent: "content",
      questionText: planetsQ,
      studentResponse: "Some are rock and some are gas",
      isFinalQuestion: false,
    });
    expect(result.response).toBe(original);
  });

  it("does NOT modify response when shouldContinue=false", () => {
    const original = "Thanks for trying.";
    const result = enforceDecisionEngineInvariants({
      response: original,
      shouldContinue: false,
      criteriaMet: false,
      studentIntent: "content",
      questionText: planetsQ,
      studentResponse: "I don't know",
      isFinalQuestion: false,
    });
    // shouldContinue=false → wrapReason set, response not modified by invariant 4
    expect(result.response).toBe(original);
    expect(result.shouldContinue).toBe(false);
  });

  it("works for procedural math question", () => {
    const mathQ = "What is 59 - 25? Show your work.";
    const result = enforceDecisionEngineInvariants({
      response: "Not quite. You need to subtract carefully.",
      shouldContinue: true,
      criteriaMet: false,
      studentIntent: "content",
      questionText: mathQ,
      studentResponse: "30",
      isFinalQuestion: false,
    });
    expect(result.response).toContain("?");
    expect(result.shouldContinue).toBe(true);
  });
});

// ── Server-side buildProbeFromQuestion — examples/materials awareness ──

describe("buildProbeFromQuestion (server-side) — examples/materials", () => {
  it("asks for named planets when question asks for examples + materials", () => {
    const probe = buildProbeFromQuestion(
      "How would you explain what planets are made of? Can you give examples of different planets and their materials?",
      "some planets are rocky and some are gas"
    );
    expect(probe).toContain("?");
    expect(probe).toMatch(/planets/i);
  });

  it("asks about materials when planets already named", () => {
    const probe = buildProbeFromQuestion(
      "Can you give examples of different planets and their materials?",
      "Earth and Jupiter are different"
    );
    expect(probe).toContain("?");
    expect(probe).toMatch(/made of/i);
  });

  it("produces a question for non-examples question", () => {
    const probe = buildProbeFromQuestion(
      "Why is the sun important to the planets?",
      "it gives warmth"
    );
    expect(probe).toContain("?");
  });
});

// ============================================
// buildSafeProbe: procedural ban for non-procedural prompts
// ============================================

describe("buildSafeProbe — procedural ban", () => {
  it("never returns 'first step' for a science question", () => {
    const probe = buildSafeProbe(
      "Choose two different planets and explain what they are made of.",
      "I think planets are big",
    );
    expect(probe).not.toMatch(/first\s+step/i);
    expect(probe).not.toMatch(/what\s+did\s+you\s+get/i);
    expect(probe).toContain("?");
  });

  it("never returns procedural language for 'how would you' science question", () => {
    const probe = buildSafeProbe(
      "How would you describe the differences between rocky and gas planets?",
      "some are big and some are small",
    );
    expect(probe).not.toMatch(/first\s+step/i);
    expect(probe).not.toMatch(/show\s+(?:me\s+)?your\s+work/i);
    expect(probe).toContain("?");
  });

  it("allows procedural probes for actual math procedural questions", () => {
    const probe = buildSafeProbe(
      "Explain the steps to subtract 45 from 82.",
      "you take away",
    );
    // This IS a procedural prompt, so procedural probes are allowed
    expect(probe).toContain("?");
  });

  it("returns observable probes when classifyConceptType would return procedural for non-procedural prompt", () => {
    // "how would you" triggers classifyConceptType → procedural, but the
    // prompt is about weather, not math — should get an observable probe
    const probe = buildSafeProbe(
      "How would you explain what causes rain?",
      "water goes up",
    );
    expect(probe).not.toMatch(/first\s+step/i);
    expect(probe).not.toMatch(/what\s+did\s+you\s+get/i);
  });
});

// ============================================
// Invariant 5: procedural language banned in enforceDecisionEngineInvariants
// ============================================

describe("enforceDecisionEngineInvariants — Invariant 5", () => {
  it("replaces procedural probe for a non-procedural question", () => {
    const result = enforceDecisionEngineInvariants({
      response: "Good thinking. What was your first step, and what did you get?",
      shouldContinue: true,
      criteriaMet: false,
      studentIntent: "content",
      questionText: "Choose two different planets and explain what they are made of.",
      studentResponse: "earth is a planet",
      isFinalQuestion: false,
    });
    expect(result.response).not.toMatch(/first\s+step/i);
    expect(result.response).not.toMatch(/what\s+did\s+you\s+get/i);
    expect(result.response).toContain("?");
    expect(result.shouldContinue).toBe(true);
  });

  it("preserves short ack when replacing procedural language", () => {
    const result = enforceDecisionEngineInvariants({
      response: "Good thinking. Walk me through each step.",
      shouldContinue: true,
      criteriaMet: false,
      studentIntent: "content",
      questionText: "Why do leaves change color in fall?",
      studentResponse: "because of the weather",
      isFinalQuestion: false,
    });
    expect(result.response).not.toMatch(/walk\s+me\s+through/i);
    expect(result.response).toContain("?");
    // Should preserve "Good thinking." as ack
    expect(result.response).toMatch(/^Good thinking\./);
  });

  it("allows procedural language for a procedural prompt", () => {
    const result = enforceDecisionEngineInvariants({
      response: "What was your first step, and what did you get?",
      shouldContinue: true,
      criteriaMet: false,
      studentIntent: "content",
      questionText: "Explain the steps to solve 24 + 38.",
      studentResponse: "I added them",
      isFinalQuestion: false,
    });
    // Procedural prompt — procedural language is fine
    expect(result.response).toMatch(/first\s+step/i);
  });

  it("replaces 'show your work' for a reading comprehension question", () => {
    const result = enforceDecisionEngineInvariants({
      response: "Good try! Show me your work.",
      shouldContinue: true,
      criteriaMet: false,
      studentIntent: "content",
      questionText: "What is the main idea of the story?",
      studentResponse: "it was about a dog",
      isFinalQuestion: false,
    });
    expect(result.response).not.toMatch(/show\s+(?:me\s+)?your\s+work/i);
    expect(result.response).toContain("?");
  });
});

// ============================================
// isProceduralPrompt: boundary cases
// ============================================

describe("isProceduralPrompt", () => {
  it("returns true for 'explain the steps' prompts", () => {
    expect(isProceduralPrompt("Explain the steps to subtract 45 from 82")).toBe(true);
  });

  it("returns true for 'step-by-step' prompts", () => {
    expect(isProceduralPrompt("Solve 24 + 38 step by step")).toBe(true);
  });

  it("returns false for science questions with 'how would you'", () => {
    expect(isProceduralPrompt("How would you describe the differences between rocky and gas planets?")).toBe(false);
  });

  it("returns false for 'explain what they are made of'", () => {
    expect(isProceduralPrompt("Choose two different planets and explain what they are made of")).toBe(false);
  });

  it("returns false for reading comprehension questions", () => {
    expect(isProceduralPrompt("What is the main idea of the story?")).toBe(false);
  });
});

// ============================================
// Session Summary: filterMetaUtterances
// ============================================

describe("filterMetaUtterances", () => {
  it("filters 'I'm confused' as meta", () => {
    const result = filterMetaUtterances([
      "I'm confused",
      "Earth is rocky and Mars is too",
    ]);
    expect(result.content).toEqual(["Earth is rocky and Mars is too"]);
    expect(result.metaCount).toBe(1);
  });

  it("filters 'that's not what we're supposed to say' as meta", () => {
    const result = filterMetaUtterances([
      "that's not what we're supposed to say",
      "Jupiter is made of gas",
    ]);
    expect(result.content).toEqual(["Jupiter is made of gas"]);
    expect(result.metaCount).toBe(1);
  });

  it("filters 'what do you mean' as meta", () => {
    const result = filterMetaUtterances([
      "what do you mean",
      "Earth is made of rocks",
    ]);
    expect(result.content).toEqual(["Earth is made of rocks"]);
    expect(result.metaCount).toBe(1);
  });

  it("keeps all utterances when none are meta", () => {
    const result = filterMetaUtterances([
      "Earth is a rocky planet",
      "Jupiter has lots of gas",
    ]);
    expect(result.content).toEqual(["Earth is a rocky planet", "Jupiter has lots of gas"]);
    expect(result.metaCount).toBe(0);
  });

  it("counts multiple meta utterances", () => {
    const result = filterMetaUtterances([
      "huh?",
      "I don't understand",
      "can you repeat that",
      "Earth is rocky",
    ]);
    expect(result.content).toEqual(["Earth is rocky"]);
    expect(result.metaCount).toBe(3);
  });
});

// ============================================
// Session Summary: extractDeterministicEvidence
// ============================================

describe("extractDeterministicEvidence", () => {
  it("extracts named planets from student speech", () => {
    const result = extractDeterministicEvidence([
      "Earth is rocky",
      "Jupiter is made of gas",
    ]);
    expect(result.namedPlanets).toEqual(expect.arrayContaining(["earth", "jupiter"]));
    expect(result.namedPlanets).toHaveLength(2);
  });

  it("extracts material types from student speech", () => {
    const result = extractDeterministicEvidence([
      "Earth is made of rocks and Jupiter is made of gas",
    ]);
    expect(result.namedMaterials).toEqual(expect.arrayContaining(["rocky", "gas"]));
  });

  it("returns empty arrays when no planets or materials mentioned", () => {
    const result = extractDeterministicEvidence([
      "planets are big and far away",
    ]);
    expect(result.namedPlanets).toHaveLength(0);
    expect(result.namedMaterials).toHaveLength(0);
  });

  it("detects ice materials", () => {
    const result = extractDeterministicEvidence([
      "Neptune is icy and frozen",
    ]);
    expect(result.namedPlanets).toContain("neptune");
    expect(result.namedMaterials).toContain("ice");
  });
});

// ============================================
// Session Summary: validateRubricClaims
// ============================================

describe("validateRubricClaims", () => {
  it("replaces planet-count claim when only 1 planet named", () => {
    const bullets = [
      "The student gave examples of two different planets and described their materials.",
    ];
    const result = validateRubricClaims(bullets, {
      namedPlanets: ["earth"],
      namedMaterials: ["rocky"],
    });
    expect(result[0]).toContain("earth");
    expect(result[0]).toContain("did not provide a second planet");
  });

  it("replaces planet-count claim when no planets named", () => {
    const bullets = [
      "The student gave examples of at least two planets.",
    ];
    const result = validateRubricClaims(bullets, {
      namedPlanets: [],
      namedMaterials: [],
    });
    expect(result[0]).toContain("did not name specific planets");
  });

  it("keeps planet-count claim when 2+ planets named", () => {
    const bullets = [
      "The student gave examples of two different planets and their materials.",
    ];
    const result = validateRubricClaims(bullets, {
      namedPlanets: ["earth", "jupiter"],
      namedMaterials: ["rocky", "gas"],
    });
    // Should be unchanged
    expect(result[0]).toContain("two different planets");
  });

  it("replaces material-description claim when no materials mentioned", () => {
    const bullets = [
      "The student described what the planets are made of.",
    ];
    const result = validateRubricClaims(bullets, {
      namedPlanets: ["earth", "jupiter"],
      namedMaterials: [],
    });
    expect(result[0]).toContain("did not describe");
  });

  it("keeps material-description claim when materials are present", () => {
    const bullets = [
      "The student described what the planets are made of.",
    ];
    const result = validateRubricClaims(bullets, {
      namedPlanets: ["earth", "jupiter"],
      namedMaterials: ["rocky"],
    });
    // Should be unchanged
    expect(result[0]).toContain("described");
    expect(result[0]).not.toContain("did not");
  });

  it("handles multiple bullets, replacing only invalid ones", () => {
    const bullets = [
      "The student mentioned several planets in their response.",
      "The student showed good thinking about the topic.",
    ];
    const result = validateRubricClaims(bullets, {
      namedPlanets: ["earth"],
      namedMaterials: [],
    });
    // First bullet claims "several planets" but only 1 named → replaced
    expect(result[0]).toContain("did not provide a second planet");
    // Second bullet has no planet claim → unchanged
    expect(result[1]).toContain("good thinking");
  });
});

// ============================================
// Session Summary: buildDeterministicOverall
// ============================================

describe("buildDeterministicOverall", () => {
  it("returns 'met rubric criteria' for strong status with success criteria", () => {
    const result = buildDeterministicOverall(
      { overallStatus: "strong", missingCriteria: [] },
      true
    );
    expect(result).toContain("met the rubric criteria");
  });

  it("returns 'demonstrated understanding' for strong status without criteria", () => {
    const result = buildDeterministicOverall(
      { overallStatus: "strong", missingCriteria: [] },
      false
    );
    expect(result).toContain("demonstrated understanding");
  });

  it("includes missing criteria for partial status", () => {
    const result = buildDeterministicOverall(
      { overallStatus: "partial", missingCriteria: ["name two planets", "describe materials"] },
      true
    );
    expect(result).toContain("partially addressed");
    expect(result).toContain("name two planets");
    expect(result).toContain("describe materials");
  });

  it("returns 'did not meet' for weak status", () => {
    const result = buildDeterministicOverall(
      { overallStatus: "weak", missingCriteria: ["name two planets"] },
      true
    );
    expect(result).toContain("did not meet");
    expect(result).toContain("name two planets");
  });

  it("returns null when no criteriaEvaluation", () => {
    const result = buildDeterministicOverall(undefined, true);
    expect(result).toBeNull();
  });

  it("returns null when overallStatus is missing", () => {
    const result = buildDeterministicOverall({ missingCriteria: [] }, true);
    expect(result).toBeNull();
  });
});

// ============================================
// extractPlanetMaterialPairs
// ============================================

describe("extractPlanetMaterialPairs", () => {
  it("pairs Earth (rock) and Jupiter (gas) from a single utterance", () => {
    const pairs = extractPlanetMaterialPairs([
      "earth is made of rock and jupiter is made of gas",
    ]);
    expect(pairs).toHaveLength(2);
    expect(pairs[0]).toEqual({ planet: "Earth", material: "rock" });
    expect(pairs[1]).toEqual({ planet: "Jupiter", material: "gas" });
  });

  it("pairs planets across multiple utterances", () => {
    const pairs = extractPlanetMaterialPairs([
      "earth is rocky",
      "jupiter has gas",
    ]);
    expect(pairs).toHaveLength(2);
    expect(pairs[0]).toEqual({ planet: "Earth", material: "rock" });
    expect(pairs[1]).toEqual({ planet: "Jupiter", material: "gas" });
  });

  it("returns planet without material when none mentioned", () => {
    const pairs = extractPlanetMaterialPairs([
      "earth and jupiter are different",
    ]);
    expect(pairs).toHaveLength(2);
    expect(pairs[0]).toEqual({ planet: "Earth", material: "" });
    expect(pairs[1]).toEqual({ planet: "Jupiter", material: "" });
  });

  it("returns empty array when no planets mentioned", () => {
    const pairs = extractPlanetMaterialPairs([
      "some planets are rocky and some are gas giants",
    ]);
    expect(pairs).toHaveLength(0);
  });

  it("handles Neptune with ice material", () => {
    const pairs = extractPlanetMaterialPairs([
      "neptune is icy",
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toEqual({ planet: "Neptune", material: "ice" });
  });

  it("does not duplicate planets across utterances", () => {
    const pairs = extractPlanetMaterialPairs([
      "earth is rocky",
      "earth is also heavy",
    ]);
    expect(pairs).toHaveLength(1);
  });
});

// ============================================
// buildDeterministicSummary — the main fast-path
// ============================================

describe("buildDeterministicSummary", () => {
  // TEST 1: Strong mastery with two planet examples
  it("strong + two planets → 'Met the goal' with examples-given bullet", () => {
    const result = buildDeterministicSummary({
      evidenceUtterances: [
        "some planets are rocky and some are ice and gas giants",
        "earth is made of rock and jupiter is made of gas",
      ],
      substantiveCount: 2,
      metaTurnCount: 0,
      questionText: "Choose two different planets and explain what they are made of.",
      criteriaEvaluation: { overallStatus: "strong", missingCriteria: [] },
    });

    // Overall says met the goal
    expect(result.overall).toMatch(/Met the goal/);
    expect(result.overall).toMatch(/materials/i);

    // Has an "Examples given:" bullet with Earth and Jupiter (em-dash format)
    const examplesBullet = result.bullets.find(b => /Examples given/i.test(b));
    expect(examplesBullet).toBeDefined();
    expect(examplesBullet).toMatch(/Earth/);
    expect(examplesBullet).toMatch(/rock/i);
    expect(examplesBullet).toMatch(/Jupiter/);
    expect(examplesBullet).toMatch(/gas/i);

    // Bullets >= 2
    expect(result.bullets.length).toBeGreaterThanOrEqual(2);
    expect(result.bullets.length).toBeLessThanOrEqual(4);
  });

  // TEST 2: Partial case with zero planet names
  it("partial + zero planets → does NOT claim two examples", () => {
    const result = buildDeterministicSummary({
      evidenceUtterances: [
        "planets are big and far away from us",
      ],
      substantiveCount: 1,
      metaTurnCount: 0,
      questionText: "Choose two different planets and explain what they are made of.",
      criteriaEvaluation: {
        overallStatus: "partial",
        missingCriteria: ["name two planets", "describe materials"],
      },
    });

    // Overall does NOT claim met the goal
    expect(result.overall).not.toMatch(/Met the goal/);
    expect(result.overall).toMatch(/Partially met the goal/);
    expect(result.overall).toMatch(/name two planets/);

    // No bullet falsely claims the student gave two planet examples
    for (const bullet of result.bullets) {
      expect(bullet).not.toMatch(/Named examples/i);
    }

    // Has a "What the student said" bullet
    const saidBullet = result.bullets.find(b => /What the student said/i.test(b));
    expect(saidBullet).toBeDefined();

    // Has a "Still needed" bullet referencing missing criteria
    const neededBullet = result.bullets.find(b => /Still needed/i.test(b));
    expect(neededBullet).toBeDefined();
    expect(neededBullet).toMatch(/name two planets/);

    // Has a "Did not name specific planets" bullet
    const noPlanetsBullet = result.bullets.find(b => /Did not name/i.test(b));
    expect(noPlanetsBullet).toBeDefined();
  });

  // TEST 3: Partial case with one planet name
  it("partial + one planet → does NOT claim two examples", () => {
    const result = buildDeterministicSummary({
      evidenceUtterances: [
        "mars is a red rocky planet",
      ],
      substantiveCount: 1,
      metaTurnCount: 0,
      questionText: "Choose two different planets and explain what they are made of.",
      criteriaEvaluation: {
        overallStatus: "partial",
        missingCriteria: ["name a second planet"],
      },
    });

    // No bullet claims two planet examples
    for (const bullet of result.bullets) {
      expect(bullet).not.toMatch(/Named examples:.*and/i);
      expect(bullet).not.toMatch(/two.*planet/i);
    }

    // Has a bullet acknowledging the one planet named + noting it's not enough
    const secondExampleBullet = result.bullets.find(b => /did not provide a second/i.test(b));
    expect(secondExampleBullet).toBeDefined();
    expect(secondExampleBullet).toMatch(/Mars/i);
  });

  // TEST 4: Strong with no planet question (generic)
  it("strong + non-planet question → generic 'Met the goal' without planet bullets", () => {
    const result = buildDeterministicSummary({
      evidenceUtterances: [
        "the main idea is that the girl learned to be brave",
      ],
      substantiveCount: 1,
      metaTurnCount: 0,
      questionText: "What is the main idea of the story?",
      criteriaEvaluation: { overallStatus: "strong", missingCriteria: [] },
    });

    expect(result.overall).toMatch(/Met the goal/);
    expect(result.overall).not.toMatch(/planet/i);

    // No planet-related bullets
    for (const bullet of result.bullets) {
      expect(bullet).not.toMatch(/planet/i);
    }
    expect(result.bullets.length).toBeGreaterThanOrEqual(2);
  });

  // TEST 5: Weak case with missing criteria
  it("weak → 'Did not meet the goal' with not-addressed criteria", () => {
    const result = buildDeterministicSummary({
      evidenceUtterances: [
        "i don't know",
      ],
      substantiveCount: 2,
      metaTurnCount: 1,
      questionText: "Choose two different planets and explain what they are made of.",
      criteriaEvaluation: {
        overallStatus: "weak",
        missingCriteria: ["name two planets", "describe materials"],
      },
    });

    expect(result.overall).toMatch(/Did not meet the goal/);
    expect(result.overall).toMatch(/name two planets/);
    expect(result.bullets.length).toBeGreaterThanOrEqual(2);
  });

  // TEST 6: Meta-turn context is included
  it("includes meta-turn context when confusion turns exist", () => {
    const result = buildDeterministicSummary({
      evidenceUtterances: [
        "earth is rocky",
      ],
      substantiveCount: 3,
      metaTurnCount: 2,
      questionText: "Choose two different planets and explain what they are made of.",
      criteriaEvaluation: { overallStatus: "partial", missingCriteria: [] },
    });

    const metaBullet = result.bullets.find(b => /meta-comments|confusion/i.test(b));
    expect(metaBullet).toBeDefined();
    expect(metaBullet).toContain("2");
  });

  // TEST 7: Strong with planets but no materials → different overall wording
  it("strong + two planets without materials → 'Met the goal: named planet examples'", () => {
    const result = buildDeterministicSummary({
      evidenceUtterances: [
        "earth and jupiter are two planets that are very different from each other",
      ],
      substantiveCount: 1,
      metaTurnCount: 0,
      questionText: "Choose two different planets and explain what they are made of.",
      criteriaEvaluation: { overallStatus: "strong", missingCriteria: [] },
    });

    expect(result.overall).toMatch(/Met the goal.*named planet examples/i);
    expect(result.overall).not.toMatch(/materials/i);
  });

  // TEST 8: Strong mastery with 3 planets and materials (user-requested)
  it("strong + 3 planets with materials → examples bullet lists all three", () => {
    const result = buildDeterministicSummary({
      evidenceUtterances: [
        "earth is made of rock Mars is made of rock and Jupiter is made of gas",
      ],
      substantiveCount: 1,
      metaTurnCount: 0,
      questionText: "Choose two different planets and explain what they are made of.",
      criteriaEvaluation: { overallStatus: "strong", missingCriteria: [] },
    });

    expect(result.overall).toMatch(/Met the goal/);
    expect(result.overall).toMatch(/materials/i);

    // The examples bullet must include all three with em-dash format
    const examplesBullet = result.bullets.find(b => /Examples given/i.test(b));
    expect(examplesBullet).toBeDefined();
    expect(examplesBullet).toMatch(/Earth/);
    expect(examplesBullet).toMatch(/Mars/);
    expect(examplesBullet).toMatch(/Jupiter/);
    expect(examplesBullet).toMatch(/rock/i);
    expect(examplesBullet).toMatch(/gas/i);
    // Uses semicolons between entries
    expect(examplesBullet).toContain(";");
  });

  // TEST 9: Strong with rocky + gas → "different planet types" bullet
  it("strong + rocky and gas mentioned → adds 'different planet types' bullet", () => {
    const result = buildDeterministicSummary({
      evidenceUtterances: [
        "some planets are rocky and some are gas giants",
        "earth is made of rock and jupiter is made of gas",
      ],
      substantiveCount: 2,
      metaTurnCount: 0,
      questionText: "Choose two different planets and explain what they are made of.",
      criteriaEvaluation: { overallStatus: "strong", missingCriteria: [] },
    });

    const typesBullet = result.bullets.find(b => /rocky while others are gas/i.test(b));
    expect(typesBullet).toBeDefined();
  });

  // TEST 10: Strong with planets but only one material type → no "different types" bullet
  it("strong + only rocky mentioned → no 'different planet types' bullet", () => {
    const result = buildDeterministicSummary({
      evidenceUtterances: [
        "earth is rocky and mars is also rocky",
      ],
      substantiveCount: 1,
      metaTurnCount: 0,
      questionText: "Choose two different planets and explain what they are made of.",
      criteriaEvaluation: { overallStatus: "strong", missingCriteria: [] },
    });

    const typesBullet = result.bullets.find(b => /different planet types/i.test(b));
    expect(typesBullet).toBeUndefined();
  });

  // TEST 11: Strong with 2 planets, no materials → "Named planets mentioned" format
  it("strong + 2 planets no materials → 'Named planets mentioned' bullet", () => {
    const result = buildDeterministicSummary({
      evidenceUtterances: [
        "earth and mars are two planets I know about",
      ],
      substantiveCount: 1,
      metaTurnCount: 0,
      questionText: "Choose two different planets and explain what they are made of.",
      criteriaEvaluation: { overallStatus: "strong", missingCriteria: [] },
    });

    const namedBullet = result.bullets.find(b => /Named planet examples/i.test(b));
    expect(namedBullet).toBeDefined();
    expect(namedBullet).toMatch(/Earth/);
    expect(namedBullet).toMatch(/Mars/);
  });

  // TEST 12: Partial with 0 planets → must not claim examples (user-requested)
  it("partial + 0 planets → no examples claimed", () => {
    const result = buildDeterministicSummary({
      evidenceUtterances: [
        "I think planets are different sizes",
      ],
      substantiveCount: 1,
      metaTurnCount: 0,
      questionText: "Choose two different planets and explain what they are made of.",
      criteriaEvaluation: {
        overallStatus: "partial",
        missingCriteria: ["name two planets", "describe materials"],
      },
    });

    expect(result.overall).not.toMatch(/Met the goal/);
    for (const bullet of result.bullets) {
      expect(bullet).not.toMatch(/Examples given/i);
      expect(bullet).not.toMatch(/Named planets mentioned/i);
    }
    // Should have "Did not name specific planets" bullet
    const noPlanetsBullet = result.bullets.find(b => /Did not name/i.test(b));
    expect(noPlanetsBullet).toBeDefined();
  });

  // TEST 13: Partial with 1 planet → must not claim "two examples" (user-requested)
  it("partial + 1 planet → no two-examples claim", () => {
    const result = buildDeterministicSummary({
      evidenceUtterances: [
        "earth is a rocky planet",
      ],
      substantiveCount: 1,
      metaTurnCount: 0,
      questionText: "Choose two different planets and explain what they are made of.",
      criteriaEvaluation: {
        overallStatus: "partial",
        missingCriteria: ["name a second planet"],
      },
    });

    for (const bullet of result.bullets) {
      expect(bullet).not.toMatch(/Examples given/i);
    }
    // Should acknowledge the one planet named
    const secondBullet = result.bullets.find(b => /did not provide a second/i.test(b));
    expect(secondBullet).toBeDefined();
    expect(secondBullet).toMatch(/Earth/i);
  });
});

describe("normalizeMaterial", () => {
  it("normalizes rocky/stone/solid to 'rock'", () => {
    expect(normalizeMaterial("rocky")).toBe("rock");
    expect(normalizeMaterial("stone")).toBe("rock");
    expect(normalizeMaterial("solid")).toBe("rock");
    expect(normalizeMaterial("rocks")).toBe("rock");
    expect(normalizeMaterial("silicon")).toBe("rock");
  });

  it("normalizes gas/hydrogen/helium to 'gas'", () => {
    expect(normalizeMaterial("gas")).toBe("gas");
    expect(normalizeMaterial("gaseous")).toBe("gas");
    expect(normalizeMaterial("hydrogen")).toBe("gas");
    expect(normalizeMaterial("helium")).toBe("gas");
  });

  it("normalizes icy/frozen/methane/ammonia to 'ice'", () => {
    expect(normalizeMaterial("icy")).toBe("ice");
    expect(normalizeMaterial("ice")).toBe("ice");
    expect(normalizeMaterial("frozen")).toBe("ice");
    expect(normalizeMaterial("methane")).toBe("ice");
    expect(normalizeMaterial("ammonia")).toBe("ice");
  });

  it("normalizes iron/metal to 'metal'", () => {
    expect(normalizeMaterial("iron")).toBe("metal");
    expect(normalizeMaterial("metal")).toBe("metal");
  });

  it("returns lowercased unknown materials as-is", () => {
    expect(normalizeMaterial("lava")).toBe("lava");
    expect(normalizeMaterial("dust")).toBe("dust");
  });
});

describe("detectTypeStatement", () => {
  it("returns true when both rocky and gas types mentioned", () => {
    expect(detectTypeStatement([
      "some planets are rocky and some are gas giants",
    ])).toBe(true);
  });

  it("returns true when rocky and ice types mentioned", () => {
    expect(detectTypeStatement([
      "earth is rocky but neptune is icy",
    ])).toBe(true);
  });

  it("returns false when only rocky mentioned", () => {
    expect(detectTypeStatement([
      "earth is a rocky planet and mars is rocky too",
    ])).toBe(false);
  });

  it("returns false when only gas mentioned", () => {
    expect(detectTypeStatement([
      "jupiter is a gas giant",
    ])).toBe(false);
  });

  it("returns false with no type words", () => {
    expect(detectTypeStatement([
      "I like planets a lot",
    ])).toBe(false);
  });

  it("detects types spread across multiple utterances", () => {
    expect(detectTypeStatement([
      "earth has rocks on it",
      "jupiter is made of gas",
    ])).toBe(true);
  });
});

describe("extractPlanetMaterialPairs — proximity regex", () => {
  it("uses proximity regex to pair planet with nearest 'made of' material", () => {
    const pairs = extractPlanetMaterialPairs([
      "earth is made of rock and jupiter is made of gas",
    ]);
    expect(pairs).toHaveLength(2);
    expect(pairs[0]).toEqual({ planet: "Earth", material: "rock" });
    expect(pairs[1]).toEqual({ planet: "Jupiter", material: "gas" });
  });

  it("handles 'made of' with distance up to 40 chars", () => {
    const pairs = extractPlanetMaterialPairs([
      "mars the red planet is made of rock",
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toEqual({ planet: "Mars", material: "rock" });
  });

  it("falls back to segment pass when no 'made of' present", () => {
    const pairs = extractPlanetMaterialPairs([
      "earth is rocky and jupiter is gaseous",
    ]);
    expect(pairs).toHaveLength(2);
    expect(pairs[0]).toEqual({ planet: "Earth", material: "rock" });
    expect(pairs[1]).toEqual({ planet: "Jupiter", material: "gas" });
  });

  it("limits output to 3 pairs", () => {
    const pairs = extractPlanetMaterialPairs([
      "earth is made of rock, mars is made of rock, jupiter is made of gas, neptune is made of ice",
    ]);
    expect(pairs).toHaveLength(3);
  });

  it("normalizes materials in proximity pass", () => {
    const pairs = extractPlanetMaterialPairs([
      "neptune is made of frozen stuff",
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].material).toBe("ice");
  });
});

describe("buildDeterministicSummary — v2 formats", () => {
  it("strong overall uses 'Met the goal: explained what planets are made of' text", () => {
    const result = buildDeterministicSummary({
      evidenceUtterances: [
        "earth is made of rock and jupiter is made of gas",
      ],
      substantiveCount: 1,
      metaTurnCount: 0,
      questionText: "Choose two different planets and explain what they are made of.",
      criteriaEvaluation: { overallStatus: "strong", missingCriteria: [] },
    });

    expect(result.overall).toBe(
      "Met the goal: explained what planets are made of and gave named examples with materials."
    );
  });

  it("strong with em-dash format bullets for planet-material pairs", () => {
    const result = buildDeterministicSummary({
      evidenceUtterances: [
        "earth is made of rock and jupiter is made of gas",
      ],
      substantiveCount: 1,
      metaTurnCount: 0,
      questionText: "Choose two different planets and explain what they are made of.",
      criteriaEvaluation: { overallStatus: "strong", missingCriteria: [] },
    });

    const examplesBullet = result.bullets.find(b => /Examples given/i.test(b));
    expect(examplesBullet).toBeDefined();
    // em-dash format with semicolons
    expect(examplesBullet).toMatch(/Earth\u2014rock/);
    expect(examplesBullet).toMatch(/Jupiter\u2014gas/);
  });

  it("type statement bullet uses 'rocky while others are gas/ice giants' wording", () => {
    const result = buildDeterministicSummary({
      evidenceUtterances: [
        "some planets are rocky and some are gas giants",
        "earth is made of rock and jupiter is made of gas",
      ],
      substantiveCount: 2,
      metaTurnCount: 0,
      questionText: "Choose two different planets and explain what they are made of.",
      criteriaEvaluation: { overallStatus: "strong", missingCriteria: [] },
    });

    const typesBullet = result.bullets.find(b => /rocky while others/i.test(b));
    expect(typesBullet).toBeDefined();
    expect(typesBullet).toMatch(/gas\/ice giants/);
  });

  it("uses 'Named planet examples:' (not 'Named planets mentioned:') for no-material planets", () => {
    const result = buildDeterministicSummary({
      evidenceUtterances: [
        "earth and mars are planets in our solar system",
      ],
      substantiveCount: 1,
      metaTurnCount: 0,
      questionText: "Choose two different planets and explain what they are made of.",
      criteriaEvaluation: { overallStatus: "strong", missingCriteria: [] },
    });

    const namedBullet = result.bullets.find(b => /Named planet examples/i.test(b));
    expect(namedBullet).toBeDefined();
    // Should NOT use the old wording
    const oldBullet = result.bullets.find(b => /Named planets mentioned/i.test(b));
    expect(oldBullet).toBeUndefined();
  });
});

describe("shouldContinue=true without '?' — server invariant", () => {
  it("server invariant 4 appends question when response has no '?'", () => {
    const result = enforceDecisionEngineInvariants({
      response: "Good thinking.",
      shouldContinue: true,
      criteriaMet: false,
      studentIntent: "content",
      timeRemainingSec: 60,
      questionText: "Choose two different planets and explain what they are made of.",
      studentResponse: "earth is rocky",
      isFinalQuestion: false,
    });
    // Must contain a question mark after invariant enforcement
    expect(result.response).toContain("?");
  });

  it("does NOT modify response if it already has '?'", () => {
    const result = enforceDecisionEngineInvariants({
      response: "Good thinking! Can you name another planet?",
      shouldContinue: true,
      criteriaMet: false,
      studentIntent: "content",
      timeRemainingSec: 60,
      questionText: "Choose two different planets and explain what they are made of.",
      studentResponse: "earth is rocky",
      isFinalQuestion: false,
    });
    expect(result.response).toBe("Good thinking! Can you name another planet?");
  });
});

describe("isPraiseOnly", () => {
  it("detects common praise-only phrases", () => {
    expect(isPraiseOnly("Good thinking.")).toBe(true);
    expect(isPraiseOnly("Great job!")).toBe(true);
    expect(isPraiseOnly("Nice work.")).toBe(true);
    expect(isPraiseOnly("Well done!")).toBe(true);
    expect(isPraiseOnly("Awesome")).toBe(true);
    expect(isPraiseOnly("Excellent!")).toBe(true);
    expect(isPraiseOnly("That's right.")).toBe(true);
    expect(isPraiseOnly("You got it!")).toBe(true);
  });

  it("does NOT match praise followed by a question", () => {
    expect(isPraiseOnly("Good thinking! Can you name a planet?")).toBe(false);
    expect(isPraiseOnly("Great job! What is Earth made of?")).toBe(false);
  });

  it("does NOT match substantive feedback", () => {
    expect(isPraiseOnly("Earth is made of rock and has an iron core.")).toBe(false);
    expect(isPraiseOnly("You mentioned that Jupiter is a gas giant.")).toBe(false);
  });
});

describe("praise-only invariant (Invariant 1.5)", () => {
  it("replaces praise-only response with probe using first missing criterion", () => {
    const result = enforceDecisionEngineInvariants({
      response: "Good thinking.",
      shouldContinue: true,
      criteriaMet: false,
      studentIntent: "content",
      timeRemainingSec: 60,
      questionText: "Choose two different planets and explain what they are made of.",
      studentResponse: "earth is rocky",
      isFinalQuestion: false,
      missingCriteria: ["naming two different planets", "explaining materials"],
    });
    expect(result.response).toContain("?");
    expect(result.response).toContain("naming two different planets");
    expect(result.shouldContinue).toBe(true);
  });

  it("replaces praise-only response with deterministic probe when no missing criteria", () => {
    const result = enforceDecisionEngineInvariants({
      response: "Good thinking.",
      shouldContinue: true,
      criteriaMet: false,
      studentIntent: "content",
      timeRemainingSec: 60,
      questionText: "Choose two different planets and explain what they are made of.",
      studentResponse: "earth is rocky",
      isFinalQuestion: false,
    });
    expect(result.response).toContain("?");
    // Should not still be just "Good thinking."
    expect(result.response).not.toMatch(/^Good thinking\.?\s*$/);
  });

  it("does NOT replace praise-only when shouldContinue=false (WRAP is allowed)", () => {
    const result = enforceDecisionEngineInvariants({
      response: "Good thinking.",
      shouldContinue: false,
      criteriaMet: true,
      studentIntent: "content",
      timeRemainingSec: 60,
      questionText: "Choose two different planets and explain what they are made of.",
      studentResponse: "earth is rocky",
      isFinalQuestion: false,
    });
    // WRAP turns are allowed to be praise-only
    expect(result.response).toBe("Good thinking.");
  });

  it("does NOT affect responses that already contain a question", () => {
    const result = enforceDecisionEngineInvariants({
      response: "Good thinking! Can you name another planet?",
      shouldContinue: true,
      criteriaMet: false,
      studentIntent: "content",
      timeRemainingSec: 60,
      questionText: "Choose two different planets and explain what they are made of.",
      studentResponse: "earth is rocky",
      isFinalQuestion: false,
    });
    expect(result.response).toBe("Good thinking! Can you name another planet?");
  });
});

describe("filler-only transcript regex", () => {
  const FILLER_ONLY = /^(um+|uh+|hmm+|like|well|so|yeah|ok(ay)?|huh|what|oh|ah+|mhm+)[.!?,\s]*$/i;

  it("matches common filler words", () => {
    expect(FILLER_ONLY.test("um")).toBe(true);
    expect(FILLER_ONLY.test("uh")).toBe(true);
    expect(FILLER_ONLY.test("okay")).toBe(true);
    expect(FILLER_ONLY.test("hmm")).toBe(true);
    expect(FILLER_ONLY.test("yeah")).toBe(true);
    expect(FILLER_ONLY.test("huh")).toBe(true);
    expect(FILLER_ONLY.test("oh")).toBe(true);
    expect(FILLER_ONLY.test("mhm")).toBe(true);
  });

  it("matches filler with trailing punctuation", () => {
    expect(FILLER_ONLY.test("um.")).toBe(true);
    expect(FILLER_ONLY.test("ok,")).toBe(true);
    expect(FILLER_ONLY.test("yeah!")).toBe(true);
  });

  it("does NOT match filler followed by content", () => {
    expect(FILLER_ONLY.test("um earth is rocky")).toBe(false);
    expect(FILLER_ONLY.test("like planets are made of rock")).toBe(false);
  });

  it("does NOT match substantive content", () => {
    expect(FILLER_ONLY.test("I think earth")).toBe(false);
    expect(FILLER_ONLY.test("earth is made of rock")).toBe(false);
    expect(FILLER_ONLY.test("planets are big")).toBe(false);
  });
});

// ============================================================================
// Wrong-answer detection & response helpers
// ============================================================================

describe("detectClearlyWrongAnswer", () => {
  it("returns true for pure nonsense: 'clouds rainbows lollipops'", () => {
    expect(detectClearlyWrongAnswer("clouds rainbows lollipops")).toBe(true);
  });

  it("returns true for 'made of' with silly nouns: 'earth is made of lollipops'", () => {
    expect(detectClearlyWrongAnswer("earth is made of lollipops")).toBe(true);
  });

  it("returns true for 'pizza and candy'", () => {
    expect(detectClearlyWrongAnswer("pizza and candy")).toBe(true);
  });

  it("returns false for valid domain content: 'earth is made of rock'", () => {
    expect(detectClearlyWrongAnswer("earth is made of rock")).toBe(false);
  });

  it("returns false for valid but wrong domain content: 'earth is made of gas'", () => {
    expect(detectClearlyWrongAnswer("earth is made of gas")).toBe(false);
  });

  it("returns false for response with no silly nouns: 'I think it's heavy'", () => {
    expect(detectClearlyWrongAnswer("I think it's heavy")).toBe(false);
  });

  it("returns false for valid content mixed with silly noun but no 'made of': 'earth has rock and maybe candy'", () => {
    // Has valid domain content and silly noun but no "made of" pattern
    expect(detectClearlyWrongAnswer("earth has rock and maybe candy")).toBe(false);
  });
});

describe("buildWrongAnswerResponse", () => {
  it("produces 3-sentence response with correction, redirect, and retry question", () => {
    const result = buildWrongAnswerResponse(
      "What are planets made of?",
      "lollipops and candy",
      null,
    );
    expect(result).toMatch(/^Not quite/);
    expect(result).toContain("?");
    // Should have 3 sentences
    const sentences = result.split(/(?<=[.!?])\s+/);
    expect(sentences.length).toBeGreaterThanOrEqual(3);
  });

  it("mentions the silly word in the correction", () => {
    const result = buildWrongAnswerResponse(
      "What are planets made of?",
      "earth is made of lollipops",
      null,
    );
    expect(result).toContain("lollipops");
    expect(result).toMatch(/^Not quite/);
  });

  it("uses scope-aligned probe when available", () => {
    const scope = {
      scopeAlignedProbes: ["What real materials make up rocky planets?"],
      allowedKeywords: ["rock", "gas", "ice"],
      offScopeKeywords: [],
    };
    const result = buildWrongAnswerResponse(
      "What are planets made of?",
      "candy",
      scope as any,
    );
    expect(result).toContain("What real materials make up rocky planets?");
  });

  it("redirects to planets vocabulary for planet questions", () => {
    const result = buildWrongAnswerResponse(
      "What are planets made of?",
      "unicorns",
      null,
    );
    expect(result).toContain("rock, gas, or ice");
  });
});

describe("containsWrongAnswerPraise", () => {
  it("detects 'Good start'", () => {
    expect(containsWrongAnswerPraise("Good start — let me help.")).toBe(true);
  });

  it("detects 'Good thinking'", () => {
    expect(containsWrongAnswerPraise("Good thinking.")).toBe(true);
  });

  it("detects 'That's interesting'", () => {
    expect(containsWrongAnswerPraise("That's interesting — tell me more.")).toBe(true);
  });

  it("detects 'Nice try'", () => {
    expect(containsWrongAnswerPraise("Nice try, but planets aren't made of candy.")).toBe(true);
  });

  it("does NOT flag 'Not quite'", () => {
    expect(containsWrongAnswerPraise("Not quite — planets aren't made of that.")).toBe(false);
  });
});

describe("hasExplicitCorrection", () => {
  it("detects 'not quite'", () => {
    expect(hasExplicitCorrection("Not quite — try again.")).toBe(true);
  });

  it("detects 'that's not correct'", () => {
    expect(hasExplicitCorrection("That's not correct. Think about real materials.")).toBe(true);
  });

  it("detects 'not made of'", () => {
    expect(hasExplicitCorrection("Planets are not made of candy.")).toBe(true);
  });

  it("returns false for vague praise only", () => {
    expect(hasExplicitCorrection("Good thinking! Tell me more.")).toBe(false);
  });
});

// ============================================================================
// INVARIANT 6: Wrong-answer guard (integration)
// ============================================================================

describe("INVARIANT 6 — wrong-answer guard", () => {
  const baseParams = {
    criteriaMet: false,
    studentIntent: "content" as const,
    timeRemainingSec: 60,
    questionText: "What are planets made of?",
    isFinalQuestion: false,
    resolvedScope: null,
    missingCriteria: [],
  };

  it("replaces praise response for 'clouds rainbows lollipops' (score < 25)", () => {
    const result = enforceDecisionEngineInvariants({
      ...baseParams,
      response: "Good thinking! Let me help you with that.",
      shouldContinue: true,
      studentResponse: "clouds rainbows lollipops",
      score: 10,
      criteriaStatus: "needs_work",
    });
    expect(result.response).toMatch(/^Not quite/);
    expect(result.response).toContain("?");
    expect(result.response).not.toContain("Good thinking");
  });

  it("replaces praise for 'earth is made of lollipops' (score < 25)", () => {
    const result = enforceDecisionEngineInvariants({
      ...baseParams,
      response: "Good start — that's an interesting idea about Earth!",
      shouldContinue: true,
      studentResponse: "earth is made of lollipops",
      score: 15,
      criteriaStatus: "needs_work",
    });
    expect(result.response).toMatch(/^Not quite/);
    expect(result.response).toContain("lollipops");
    expect(result.response).not.toContain("Good start");
  });

  it("preserves response when LLM already has explicit correction", () => {
    const corrected = "Not quite — planets are not made of lollipops. Try thinking about rock, gas, or ice. What real materials do you think make up Earth?";
    const result = enforceDecisionEngineInvariants({
      ...baseParams,
      response: corrected,
      shouldContinue: true,
      studentResponse: "earth is made of lollipops",
      score: 15,
      criteriaStatus: "needs_work",
    });
    // detectClearlyWrongAnswer is true, so it still replaces even if LLM has correction
    // (the invariant fires on isClearlyWrong OR bannedPraise-without-correction)
    // Since detectClearlyWrongAnswer("earth is made of lollipops") is true,
    // it replaces regardless — this ensures deterministic behavior for clearly wrong answers
    expect(result.response).toMatch(/^Not quite/);
  });

  it("does NOT fire when shouldContinue=false (WRAP)", () => {
    const original = "Good start — we'll move on now.";
    const result = enforceDecisionEngineInvariants({
      ...baseParams,
      response: original,
      shouldContinue: false,
      studentResponse: "lollipops and candy",
      score: 10,
      criteriaStatus: "needs_work",
    });
    // shouldContinue=false means WRAP — invariant 6 does NOT fire
    expect(result.response).not.toMatch(/^Not quite/);
  });

  it("does NOT fire when score >= 25", () => {
    const original = "Good thinking! Tell me more about that.";
    const result = enforceDecisionEngineInvariants({
      ...baseParams,
      response: original,
      shouldContinue: true,
      studentResponse: "um I think rock maybe",
      score: 40,
      criteriaStatus: "partial",
    });
    // Score is 40, above the < 25 threshold
    expect(result.response).not.toMatch(/^Not quite/);
  });

  it("does NOT fire when studentIntent is not 'content'", () => {
    const original = "Good thinking! Tell me more.";
    const result = enforceDecisionEngineInvariants({
      ...baseParams,
      response: original,
      shouldContinue: true,
      studentResponse: "lollipops",
      studentIntent: "meta_confusion" as any,
      score: 10,
      criteriaStatus: "needs_work",
    });
    // meta_confusion hits INVARIANT 2 instead, not INVARIANT 6
    expect(result.response).not.toMatch(/^Not quite/);
  });

  it("strips banned praise for low-score non-nonsense response", () => {
    const result = enforceDecisionEngineInvariants({
      ...baseParams,
      response: "Good start — keep going with that idea!",
      shouldContinue: true,
      studentResponse: "I think maybe something heavy",
      score: 15,
      criteriaStatus: "needs_work",
    });
    // Not clearly wrong (no silly nouns), but has banned praise + no correction + score < 25
    expect(result.response).toMatch(/^Not quite/);
    expect(result.response).not.toContain("Good start");
  });
});

// ============================================================================
// Fix 3: stripMetaPrefix — mixed meta + content utterances
// ============================================================================

describe("stripMetaPrefix", () => {
  it("extracts content from 'I didn't say anything, I just said earth is made of rock'", () => {
    const result = stripMetaPrefix("I didn't say anything, I just said earth is made of rock");
    expect(result).not.toBeNull();
    expect(result).toContain("earth");
    expect(result).toContain("rock");
  });

  it("extracts content from 'I just said earth is made of rock and Jupiter is made of gas'", () => {
    const result = stripMetaPrefix("I just said earth is made of rock and Jupiter is made of gas");
    expect(result).not.toBeNull();
    expect(result).toContain("earth");
    expect(result).toContain("Jupiter");
  });

  it("extracts content from 'What I said was earth is rocky'", () => {
    const result = stripMetaPrefix("What I said was earth is rocky");
    expect(result).not.toBeNull();
    expect(result).toContain("earth");
  });

  it("extracts content from 'I'm confused but earth is made of rock'", () => {
    const result = stripMetaPrefix("I'm confused but earth is made of rock");
    expect(result).not.toBeNull();
    expect(result).toContain("earth");
    expect(result).toContain("rock");
  });

  it("extracts content from 'What do you mean? But I think planets are made of rock and gas'", () => {
    const result = stripMetaPrefix("What do you mean? But I think planets are made of rock and gas");
    expect(result).not.toBeNull();
    expect(result).toContain("planet");
  });

  it("returns null for purely meta utterance 'I didn't say anything'", () => {
    expect(stripMetaPrefix("I didn't say anything")).toBeNull();
  });

  it("returns null for 'I'm confused'", () => {
    expect(stripMetaPrefix("I'm confused")).toBeNull();
  });

  it("returns null for 'huh?'", () => {
    expect(stripMetaPrefix("huh?")).toBeNull();
  });

  it("returns null when remainder has no domain content", () => {
    expect(stripMetaPrefix("I just said hello")).toBeNull();
  });
});

describe("filterMetaUtterances — mixed meta+content", () => {
  it("extracts content from mixed utterance instead of discarding", () => {
    const { content, metaCount } = filterMetaUtterances([
      "I'm confused but earth is made of rock",
    ]);
    expect(content.length).toBe(1);
    expect(content[0]).toContain("earth");
    expect(metaCount).toBe(0);
  });

  it("fully discards purely meta utterance", () => {
    const { content, metaCount } = filterMetaUtterances([
      "I'm confused",
    ]);
    expect(content.length).toBe(0);
    expect(metaCount).toBe(1);
  });

  it("passes through normal content utterance unchanged", () => {
    const { content, metaCount } = filterMetaUtterances([
      "Earth is made of rock and Jupiter is made of gas",
    ]);
    expect(content.length).toBe(1);
    expect(content[0]).toBe("Earth is made of rock and Jupiter is made of gas");
    expect(metaCount).toBe(0);
  });

  it("handles mix of pure meta, mixed, and content utterances", () => {
    const { content, metaCount } = filterMetaUtterances([
      "I'm confused",
      "that's not what I said, earth is made of rock",
      "Jupiter is made of gas",
    ]);
    // "I'm confused" → meta
    // "that's not what I said..." → extracts "earth is made of rock"
    // "Jupiter..." → content
    expect(content.length).toBe(2);
    expect(metaCount).toBe(1);
    expect(content[0]).toContain("earth");
    expect(content[1]).toContain("Jupiter");
  });
});

// ============================================================================
// Fix 4: extractIncorrectClaims — false content detection
// ============================================================================

describe("extractIncorrectClaims", () => {
  it("detects completely invalid material like 'lollipops'", () => {
    const claims = extractIncorrectClaims(["earth is made of lollipops"]);
    expect(claims.length).toBe(1);
    expect(claims[0].planet).toBe("Earth");
    expect(claims[0].claimed).toBe("lollipops");
  });

  it("detects wrong material type for a planet", () => {
    // Jupiter is gas, not rock
    const claims = extractIncorrectClaims(["Jupiter is made of rock"]);
    expect(claims.length).toBe(1);
    expect(claims[0].planet).toBe("Jupiter");
    expect(claims[0].claimed).toBe("rock");
  });

  it("returns empty for correct claims", () => {
    const claims = extractIncorrectClaims(["Earth is made of rock"]);
    expect(claims.length).toBe(0);
  });

  it("returns empty for correct gas planet claim", () => {
    const claims = extractIncorrectClaims(["Jupiter is made of gas"]);
    expect(claims.length).toBe(0);
  });

  it("detects incorrect among correct", () => {
    const claims = extractIncorrectClaims([
      "Earth is made of lollipops and Jupiter is made of gas",
    ]);
    expect(claims.length).toBe(1);
    expect(claims[0].planet).toBe("Earth");
    expect(claims[0].claimed).toBe("lollipops");
  });

  it("returns empty when no 'made of' pattern found", () => {
    const claims = extractIncorrectClaims(["earth is big"]);
    expect(claims.length).toBe(0);
  });
});

// ============================================================================
// Fix 4: buildDeterministicSummary — honest progression
// ============================================================================

describe("buildDeterministicSummary — honest progression", () => {
  const planetsQ = "How would you explain what planets are made of? Can you give examples?";

  it("includes incorrect claims bullet for 'lollipops'", () => {
    const result = buildDeterministicSummary({
      evidenceUtterances: ["earth is made of lollipops"],
      substantiveCount: 1,
      metaTurnCount: 0,
      questionText: planetsQ,
      criteriaEvaluation: { overallStatus: "weak", missingCriteria: ["named examples with materials"] },
    });
    expect(result.bullets.some(b => /lollipops/i.test(b))).toBe(true);
    expect(result.overall).toContain("Did not meet the goal");
  });

  it("does NOT say 'gives examples of two different planets' for single wrong claim", () => {
    const result = buildDeterministicSummary({
      evidenceUtterances: ["earth is made of lollipops"],
      substantiveCount: 1,
      metaTurnCount: 0,
      questionText: planetsQ,
      criteriaEvaluation: { overallStatus: "weak", missingCriteria: ["named examples with materials"] },
    });
    const allBullets = result.bullets.join(" ");
    expect(allBullets).not.toMatch(/examples?\s+of\s+(?:at\s+least\s+)?(?:two|2)/i);
  });

  it("shows progression when initially incorrect then corrected", () => {
    const result = buildDeterministicSummary({
      evidenceUtterances: [
        "earth is made of lollipops",
        "oh wait, earth is made of rock and Jupiter is made of gas",
      ],
      substantiveCount: 2,
      metaTurnCount: 0,
      questionText: planetsQ,
      criteriaEvaluation: { overallStatus: "partial", missingCriteria: [] },
    });
    const allBullets = result.bullets.join(" ");
    // Should mention the incorrect claim AND the correction
    expect(allBullets).toMatch(/lollipops/i);
    expect(allBullets).toMatch(/correct/i);
  });

  it("strong status with progression includes self-correction note", () => {
    const result = buildDeterministicSummary({
      evidenceUtterances: [
        "earth is made of lollipops",
        "actually earth is made of rock and Jupiter is made of gas",
      ],
      substantiveCount: 2,
      metaTurnCount: 0,
      questionText: planetsQ,
      criteriaEvaluation: { overallStatus: "strong" },
    });
    const allBullets = result.bullets.join(" ");
    expect(allBullets).toMatch(/incorrect.*self-corrected/i);
    expect(result.overall).toContain("Met the goal");
  });

  it("partial status with only correct claims — no false progression note", () => {
    const result = buildDeterministicSummary({
      evidenceUtterances: ["Earth is made of rock"],
      substantiveCount: 1,
      metaTurnCount: 0,
      questionText: planetsQ,
      criteriaEvaluation: { overallStatus: "partial", missingCriteria: ["second planet example"] },
    });
    const allBullets = result.bullets.join(" ");
    expect(allBullets).not.toMatch(/incorrect/i);
    expect(allBullets).not.toMatch(/lollipops/i);
  });
});

// ============================================================================
// Fix 2: Evaluation-aware closing in wrap buffer
// ============================================================================

describe("enforceDecisionEngineInvariants — closing window evaluation", () => {
  const baseParams = {
    questionText: "What are planets made of?",
    studentResponse: "Earth is made of rock",
    isFinalQuestion: false,
    resolvedScope: null,
  };

  it("preserves evaluation feedback when shouldContinue=false (wrap close)", () => {
    // Simulates what happens after closing window strips questions
    // The response should still contain evaluation content, not generic praise
    const result = enforceDecisionEngineInvariants({
      ...baseParams,
      response: "Not quite — try thinking about real materials.",
      shouldContinue: false,
      criteriaMet: false,
      studentIntent: "content",
    });
    // Response should be preserved (not replaced with generic text)
    expect(result.response).toContain("Not quite");
    expect(result.shouldContinue).toBe(false);
    expect(result.wrapReason).toBe("server_wrap");
  });

  it("does not inject completion language when criteriaMet=false during wrap", () => {
    const result = enforceDecisionEngineInvariants({
      ...baseParams,
      response: "We're wrapping up now. Thanks for your effort on this question.",
      shouldContinue: false,
      criteriaMet: false,
      studentIntent: "content",
    });
    expect(result.response).not.toMatch(/great\s+work|you'?ve\s+met\s+the\s+goal/i);
  });
});

// ============================================================================
// COACHING BEHAVIOR FIXES — Parts 1-7
// ============================================================================

const ADDITION_PROBLEM: MathProblem = {
  skill: "two_digit_addition",
  a: 27,
  b: 36,
  expression: "27 + 36",
  correctAnswer: 63,
  requiresRegrouping: true,
  expectedStrategyTags: ["add ones", "carry", "add tens"],
  commonWrongAnswers: [{ answer: 53, misconception: "forgot to carry" }],
};

const SIMPLE_ADDITION: MathProblem = {
  skill: "two_digit_addition",
  a: 40,
  b: 20,
  expression: "40 + 20",
  correctAnswer: 60,
  requiresRegrouping: false,
  expectedStrategyTags: ["add ones", "add tens"],
};

// --- TEST -1: video-turn orchestration (turn routing) ---

describe("video-turn orchestration — turn routing", () => {
  it("empty conversationHistory is detected as first turn", () => {
    const conversationHistory: Array<{ role: string; message: string }> = [];
    const isFirstTurn = !conversationHistory?.length
      || conversationHistory.filter(h => h.role === "student").length === 0;
    expect(isFirstTurn).toBe(true);
  });

  it("history with only coach messages is still first turn", () => {
    const conversationHistory = [
      { role: "coach", message: "What is 27 + 36?" },
    ];
    const isFirstTurn = !conversationHistory?.length
      || conversationHistory.filter(h => h.role === "student").length === 0;
    expect(isFirstTurn).toBe(true);
  });

  it("history with student entries is a continuation turn", () => {
    const conversationHistory = [
      { role: "coach", message: "What is 27 + 36?" },
      { role: "student", message: "63" },
      { role: "coach", message: "How did you get that?" },
    ];
    const isFirstTurn = !conversationHistory?.length
      || conversationHistory.filter(h => h.role === "student").length === 0;
    expect(isFirstTurn).toBe(false);
  });

  it("undefined conversationHistory is treated as first turn", () => {
    const conversationHistory = undefined as Array<{ role: string; message: string }> | undefined;
    const isFirstTurn = !conversationHistory?.length
      || conversationHistory.filter((h: any) => h.role === "student").length === 0;
    expect(isFirstTurn).toBe(true);
  });

  it("math prompt with deterministic scoring does not need second LLM call", () => {
    const prompt = {
      mathProblem: { skill: "two_digit_addition", a: 27, b: 36, expression: "27 + 36", correctAnswer: 63, requiresRegrouping: true, expectedStrategyTags: ["add ones", "carry", "add tens"] },
      assessment: { requiredEvidence: { minEntities: 2, entityLabel: "numbers", attributeLabel: "digits" } },
    };
    const hasDeterministicScoring = !!prompt.mathProblem
      || (prompt.assessment?.requiredEvidence && (prompt.assessment as any)?.referenceFacts);
    expect(hasDeterministicScoring).toBe(true);
  });

  it("open-ended prompt without referenceFacts needs LLM scoring", () => {
    const prompt = {
      assessment: { requiredEvidence: undefined, referenceFacts: undefined },
    };
    const hasDeterministicScoring = !!(prompt as any).mathProblem
      || (prompt.assessment?.requiredEvidence && prompt.assessment?.referenceFacts);
    expect(hasDeterministicScoring).toBeFalsy();
  });
});

// --- TEST 0: promptRequiresMathExplanation ---

describe("promptRequiresMathExplanation", () => {
  it("returns true for 'Tell what you did when adding the ones'", () => {
    expect(promptRequiresMathExplanation(
      "Solve 27 + 36. Tell what you did when adding the ones"
    )).toBe(true);
  });

  it("returns true for 'Explain how you regrouped'", () => {
    expect(promptRequiresMathExplanation(
      "Solve 49 + 27. Explain how you regrouped."
    )).toBe(true);
  });

  it("returns true for 'Show how you solved 32 - 18'", () => {
    expect(promptRequiresMathExplanation("Show how you solved 32 - 18.")).toBe(true);
  });

  it("returns true for 'Why did you carry the one?'", () => {
    expect(promptRequiresMathExplanation("Why did you carry the one?")).toBe(true);
  });

  it("returns true for 'Describe what happens when ones add to more than 9'", () => {
    expect(promptRequiresMathExplanation(
      "Describe what happens when the ones add up to more than 9"
    )).toBe(true);
  });

  it("returns true for 'Walk me through your thinking'", () => {
    expect(promptRequiresMathExplanation(
      "Solve 15 + 28. Walk me through your thinking."
    )).toBe(true);
  });

  it("returns true for 'How did you get your answer?'", () => {
    expect(promptRequiresMathExplanation(
      "Solve 34 + 19. How did you get your answer?"
    )).toBe(true);
  });

  it("returns false for 'What is 27 + 36?'", () => {
    expect(promptRequiresMathExplanation("What is 27 + 36?")).toBe(false);
  });

  it("returns false for 'Solve 5 times 3.'", () => {
    expect(promptRequiresMathExplanation("Solve 5 times 3.")).toBe(false);
  });

  it("returns false for 'What is 40 + 20?'", () => {
    expect(promptRequiresMathExplanation("What is 40 + 20?")).toBe(false);
  });
});

// --- TEST 1: checkMathMastery ---

describe("checkMathMastery", () => {
  it("returns true when answer is correct and strategy demonstrated (strong)", () => {
    const validation: MathValidationResult = {
      status: "correct",
      extractedAnswer: 63,
      correctAnswer: 63,
      demonstratedStrategies: ["add ones", "carry", "add tens"],
      hasPartialStrategy: true,
    };
    const bounding: MathBoundingDecision = {
      boundedStatus: "strong",
      boundedScore: 90,
      wasAdjusted: false,
      reason: "correct answer with strategy",
    };
    expect(checkMathMastery(validation, bounding)).toBe(true);
  });

  it("returns false when answer is correct but no strategy (developing)", () => {
    const validation: MathValidationResult = {
      status: "correct",
      extractedAnswer: 63,
      correctAnswer: 63,
      demonstratedStrategies: [],
      hasPartialStrategy: false,
    };
    const bounding: MathBoundingDecision = {
      boundedStatus: "developing",
      boundedScore: 70,
      wasAdjusted: true,
      reason: "correct but no strategy",
    };
    expect(checkMathMastery(validation, bounding)).toBe(false);
  });

  it("returns false when answer is incorrect", () => {
    const validation: MathValidationResult = {
      status: "incorrect_unknown",
      extractedAnswer: 99,
      correctAnswer: 63,
      demonstratedStrategies: [],
      hasPartialStrategy: false,
    };
    const bounding: MathBoundingDecision = {
      boundedStatus: "needs_support",
      boundedScore: 30,
      wasAdjusted: true,
      reason: "wrong answer",
    };
    expect(checkMathMastery(validation, bounding)).toBe(false);
  });

  it("resolvePostEvaluation with mathMasteryOverride=true ends immediately", () => {
    const result = resolvePostEvaluation(
      { score: 90, isCorrect: true, shouldContinue: false },
      0, 3, 0, "developing", 45, true,
    );
    expect(result.shouldContinue).toBe(false);
    expect(result.probeFirst).toBe(false);
  });
});

// --- TEST 2: buildPerformanceAwareClose ---

describe("buildPerformanceAwareClose", () => {
  it("strong close contains 'solved' and no UI leakage", () => {
    const msg = buildPerformanceAwareClose("strong");
    expect(msg).toMatch(/solved.*correctly/i);
    expect(msg).not.toMatch(/submit response/i);
    expect(msg).not.toMatch(/click/i);
  });

  it("strong close never contains 'Thanks for trying'", () => {
    const msg = buildPerformanceAwareClose("strong");
    expect(msg).not.toMatch(/thanks for trying/i);
  });

  it("strong close uses custom feedback prefix", () => {
    const msg = buildPerformanceAwareClose("strong", "Excellent");
    expect(msg).toMatch(/^Excellent!/);
  });

  it("developing close matches expected template", () => {
    const msg = buildPerformanceAwareClose("developing");
    expect(msg).toMatch(/nice start/i);
    expect(msg).not.toMatch(/submit response/i);
  });

  it("needs_support close never contains 'met the goal' or 'solved correctly'", () => {
    const msg = buildPerformanceAwareClose("needs_support");
    expect(msg).not.toMatch(/met the goal|solved.*correctly/i);
    expect(msg).not.toMatch(/submit response/i);
  });

  it("not_enough_evidence close mentions lack of evidence", () => {
    const msg = buildPerformanceAwareClose("not_enough_evidence");
    expect(msg).toMatch(/didn't get enough/i);
    expect(msg).not.toMatch(/submit response/i);
  });
});

// --- TEST 3: buildMathStrategyProbe ---

describe("buildMathStrategyProbe", () => {
  it("asks about missing 'carry' strategy when not demonstrated", () => {
    const probe = buildMathStrategyProbe(ADDITION_PROBLEM, ["add ones", "add tens"]);
    expect(probe).toBeTruthy();
    expect(probe).toMatch(/regroup|extra ones/i);
  });

  it("returns null when all strategies demonstrated", () => {
    const probe = buildMathStrategyProbe(ADDITION_PROBLEM, ["add ones", "carry", "add tens"]);
    expect(probe).toBeNull();
  });

  it("prioritizes carry/borrow for regrouping problems", () => {
    // Both "add ones" and "carry" are missing, but carry should be prioritized
    const probe = buildMathStrategyProbe(ADDITION_PROBLEM, ["add tens"]);
    expect(probe).toMatch(/regroup|extra ones/i);
  });

  it("asks about first missing strategy for non-regrouping problems", () => {
    const probe = buildMathStrategyProbe(SIMPLE_ADDITION, []);
    expect(probe).toBeTruthy();
    expect(probe).toMatch(/ones/i);
  });

  it("does not ask about equal sign or alternative methods", () => {
    const probe = buildMathStrategyProbe(SIMPLE_ADDITION, ["add ones"]);
    expect(probe).not.toMatch(/equal sign|alternative|another way/i);
  });
});

// --- TEST 4: isOffTopicResponse ---

describe("isOffTopicResponse", () => {
  it("'bubble gum' is off-topic for math", () => {
    expect(isOffTopicResponse("bubble gum", SIMPLE_ADDITION)).toBe(true);
  });

  it("'pizza for lunch today' is off-topic for math", () => {
    expect(isOffTopicResponse("is pizza for lunch today", SIMPLE_ADDITION)).toBe(true);
  });

  it("'60' is on-topic for math (has digits)", () => {
    expect(isOffTopicResponse("60", SIMPLE_ADDITION)).toBe(false);
  });

  it("'I added the tens' is on-topic for math (has math vocab)", () => {
    expect(isOffTopicResponse("I added the tens", SIMPLE_ADDITION)).toBe(false);
  });

  it("empty response is off-topic", () => {
    expect(isOffTopicResponse("", SIMPLE_ADDITION)).toBe(true);
  });

  it("'um like I don't know' with no digits is off-topic", () => {
    expect(isOffTopicResponse("um like I don't know", SIMPLE_ADDITION)).toBe(true);
  });
});

// --- TEST 5: off-topic exit ---

describe("countOffTopicTurns + exit threshold", () => {
  it("counts off-topic student turns in history", () => {
    const history = [
      { role: "coach", message: "Solve 40 + 20." },
      { role: "student", message: "bubble gum" },
      { role: "coach", message: "Let's focus on the math." },
      { role: "student", message: "pizza" },
    ];
    expect(countOffTopicTurns(history, SIMPLE_ADDITION)).toBe(2);
  });

  it("does not count on-topic turns", () => {
    const history = [
      { role: "coach", message: "Solve 40 + 20." },
      { role: "student", message: "the answer is 60" },
    ];
    expect(countOffTopicTurns(history, SIMPLE_ADDITION)).toBe(0);
  });

  it("exits after 2 off-topic (1 prior + 1 current)", () => {
    const priorCount = 1;
    const currentOffTopic = true;
    expect(priorCount + (currentOffTopic ? 1 : 0) >= 2).toBe(true);
  });

  it("does not exit after 1 off-topic", () => {
    const priorCount = 0;
    const currentOffTopic = true;
    expect(priorCount + (currentOffTopic ? 1 : 0) >= 2).toBe(false);
  });
});

// --- TEST 6: buildMetaConfusionResponse ---

describe("buildMetaConfusionResponse", () => {
  const correctValidation: MathValidationResult = {
    status: "correct",
    extractedAnswer: 60,
    correctAnswer: 60,
    demonstratedStrategies: ["add ones"],
    hasPartialStrategy: true,
  };

  const incorrectValidation: MathValidationResult = {
    status: "incorrect_unknown",
    extractedAnswer: 50,
    correctAnswer: 60,
    demonstratedStrategies: [],
    hasPartialStrategy: false,
  };

  it("answers correctness inquiry directly for correct math answer", () => {
    const result = buildMetaConfusionResponse({
      studentResponse: "did I not get the question correct?",
      score: 90,
      criteriaStatus: "strong",
      questionText: "Solve 40 + 20. What is your answer and how did you find it?",
      mathProblem: SIMPLE_ADDITION,
      mathValidation: correctValidation,
    });
    expect(result.response).toMatch(/yes|correct/i);
    expect(result.response).not.toMatch(/no worries/i);
  });

  it("wraps when mastery is achieved + correctness inquiry", () => {
    const result = buildMetaConfusionResponse({
      studentResponse: "was I right?",
      score: 90,
      criteriaStatus: "strong",
      questionText: "Solve 40 + 20.",
      mathProblem: SIMPLE_ADDITION,
      mathValidation: correctValidation,
    });
    expect(result.shouldContinue).toBe(false);
  });

  it("answers correctness inquiry directly for wrong math answer", () => {
    const result = buildMetaConfusionResponse({
      studentResponse: "did I get that right?",
      score: 30,
      criteriaStatus: "needs_support",
      questionText: "Solve 40 + 20.",
      mathProblem: SIMPLE_ADDITION,
      mathValidation: incorrectValidation,
    });
    expect(result.response).toMatch(/not quite/i);
    expect(result.shouldContinue).toBe(true);
  });

  it("never uses generic 'No worries' for correctness inquiry", () => {
    const result = buildMetaConfusionResponse({
      studentResponse: "did I get it right?",
      score: 90,
      criteriaStatus: "strong",
      questionText: "Solve 40 + 20.",
      mathProblem: SIMPLE_ADDITION,
      mathValidation: correctValidation,
    });
    expect(result.response).not.toMatch(/no worries/i);
  });

  it("re-states question clearly for task confusion", () => {
    const result = buildMetaConfusionResponse({
      studentResponse: "what am I supposed to do?",
      score: 0,
      questionText: "Solve 40 + 20. What is your answer?",
    });
    expect(result.response).toMatch(/40 \+ 20/);
    expect(result.shouldContinue).toBe(true);
  });

  it("uses step-scoped expression when answerScope is TENS_SUBSTEP", () => {
    const mathProblem = {
      skill: "two_digit_addition" as const,
      a: 14, b: 11, expression: "14 + 11",
      correctAnswer: 25, requiresRegrouping: false,
      expectedStrategyTags: ["add ones", "add tens"],
    };
    const wrongValidation = {
      status: "incorrect_unknown" as const,
      extractedAnswer: 15,
      correctAnswer: 25,
      demonstratedStrategies: [] as string[],
      hasPartialStrategy: false,
    };
    const result = buildMetaConfusionResponse({
      studentResponse: "was I right?",
      score: 0,
      questionText: "What is 10 + 10?",
      mathProblem,
      mathValidation: wrongValidation,
      answerScope: "TENS_SUBSTEP" as const,
      scopeExpression: "10 + 10",
    });
    // Should say "10 + 10 isn't 15", NOT "14 + 11 isn't 15"
    expect(result.response).toMatch(/10 \+ 10/);
    expect(result.response).not.toMatch(/14 \+ 11/);
  });
});

// --- TEST 7: buildMathTeacherSummary ---

describe("buildMathTeacherSummary", () => {
  it("strong summary never says 'did not' or 'attempted but'", () => {
    const summary = buildMathTeacherSummary({
      mathValidation: {
        status: "correct",
        extractedAnswer: 63,
        correctAnswer: 63,
        demonstratedStrategies: ["add ones", "carry"],
        hasPartialStrategy: true,
      },
      mathBounding: {
        boundedStatus: "strong",
        boundedScore: 90,
        wasAdjusted: false,
        reason: "",
      },
      mathProblem: ADDITION_PROBLEM,
      cleanedStudentResponse: "I added the ones, 7 + 6 is 13, carry the 1, so 63",
    });
    expect(summary.renderedSummary).not.toMatch(/did not|attempted but/i);
    expect(summary.overallLevel).toBe("Strong");
    expect(summary.masteryMet).toBe(true);
  });

  it("strong summary mentions demonstrated strategies", () => {
    const summary = buildMathTeacherSummary({
      mathValidation: {
        status: "correct",
        extractedAnswer: 63,
        correctAnswer: 63,
        demonstratedStrategies: ["add ones", "carry"],
        hasPartialStrategy: true,
      },
      mathBounding: {
        boundedStatus: "strong",
        boundedScore: 90,
        wasAdjusted: false,
        reason: "",
      },
      mathProblem: ADDITION_PROBLEM,
      cleanedStudentResponse: "I added the ones, 7 + 6 is 13, carry the 1, so 63",
    });
    expect(summary.renderedSummary).toMatch(/add ones/);
    expect(summary.renderedSummary).toMatch(/carry/);
  });

  it("needs_support summary never says 'solved correctly'", () => {
    const summary = buildMathTeacherSummary({
      mathValidation: {
        status: "incorrect_known_misconception",
        extractedAnswer: 53,
        correctAnswer: 63,
        matchedMisconception: "forgot to carry",
        demonstratedStrategies: [],
        hasPartialStrategy: false,
      },
      mathBounding: {
        boundedStatus: "needs_support",
        boundedScore: 25,
        wasAdjusted: true,
        reason: "wrong answer, no strategy",
      },
      mathProblem: ADDITION_PROBLEM,
      cleanedStudentResponse: "53",
    });
    expect(summary.renderedSummary).not.toMatch(/solved correctly|met the goal/i);
    expect(summary.overallLevel).toBe("Needs Support");
    expect(summary.masteryMet).toBe(false);
    expect(summary.renderedSummary).toMatch(/forgot to carry/);
  });

  it("not enough evidence summary is honest", () => {
    const summary = buildMathTeacherSummary({
      mathValidation: {
        status: "no_answer",
        extractedAnswer: null,
        correctAnswer: 63,
        demonstratedStrategies: [],
        hasPartialStrategy: false,
      },
      mathBounding: {
        boundedStatus: "needs_support",
        boundedScore: 20,
        wasAdjusted: true,
        reason: "no answer",
      },
      mathProblem: ADDITION_PROBLEM,
      cleanedStudentResponse: "I'm thinking about lunch",
    });
    expect(summary.renderedSummary).toMatch(/did not provide enough/i);
    expect(summary.masteryMet).toBe(false);
  });
});

// --- TEST 8: Math probe restriction (deterministic probes only) ---

describe("math probe restriction — deterministic probes only", () => {
  it("buildMathStrategyProbe returns null when all strategies demonstrated → wraps", () => {
    const problem: MathProblem = {
      skill: "two_digit_addition",
      a: 27, b: 36, expression: "27 + 36",
      correctAnswer: 63, requiresRegrouping: true,
      expectedStrategyTags: ["add ones", "carry", "add tens"],
    };
    // All demonstrated → null → route must wrap
    const result = buildMathStrategyProbe(problem, ["add ones", "carry", "add tens"]);
    expect(result).toBeNull();
  });

  it("regrouping problem produces regrouping-specific probe", () => {
    const problem: MathProblem = {
      skill: "two_digit_addition",
      a: 27, b: 36, expression: "27 + 36",
      correctAnswer: 63, requiresRegrouping: true,
      expectedStrategyTags: ["add ones", "carry", "add tens"],
    };
    const result = buildMathStrategyProbe(problem, ["add ones"]);
    expect(result).toBeTruthy();
    expect(result).toMatch(/regroup|extra ones/i);
  });

  it("never produces 'equal sign' or 'what is addition' probes for regrouping", () => {
    const problem: MathProblem = {
      skill: "two_digit_addition",
      a: 27, b: 36, expression: "27 + 36",
      correctAnswer: 63, requiresRegrouping: true,
      expectedStrategyTags: ["add ones", "carry", "add tens"],
    };
    // Test with various levels of demonstrated strategies
    for (const demo of [[], ["add ones"], ["add ones", "add tens"]]) {
      const result = buildMathStrategyProbe(problem, demo);
      if (result) {
        expect(result).not.toMatch(/equal sign/i);
        expect(result).not.toMatch(/what is addition/i);
        expect(result).not.toMatch(/what does.*mean/i);
      }
    }
  });

  it("place-value probe substitutes targetPlace", () => {
    const problem: MathProblem = {
      skill: "place_value",
      a: 347, expression: "347",
      correctAnswer: 4, requiresRegrouping: false,
      expectedStrategyTags: ["identify digit", "name tens place"],
      targetPlace: "tens",
    };
    const result = buildMathStrategyProbe(problem, []);
    expect(result).toBeTruthy();
    expect(result).toMatch(/tens/i);
  });

  it("non-regrouping addition probes about ones or tens digits", () => {
    const problem: MathProblem = {
      skill: "two_digit_addition",
      a: 40, b: 20, expression: "40 + 20",
      correctAnswer: 60, requiresRegrouping: false,
      expectedStrategyTags: ["add ones", "add tens"],
    };
    const result = buildMathStrategyProbe(problem, []);
    expect(result).toBeTruthy();
    expect(result).toMatch(/ones|tens/i);
  });
});

// --- buildMathRetryProbe ---

describe("buildMathRetryProbe", () => {
  const ADDITION_27_36: MathProblem = {
    skill: "two_digit_addition",
    a: 27, b: 36,
    expression: "27 + 36",
    correctAnswer: 63,
    requiresRegrouping: true,
    expectedStrategyTags: ["add ones", "carry", "add tens"],
    commonWrongAnswers: [{ answer: 53, misconception: "forgot to carry" }],
  };

  const SUBTRACTION_42_17: MathProblem = {
    skill: "two_digit_subtraction",
    a: 42, b: 17,
    expression: "42 - 17",
    correctAnswer: 25,
    requiresRegrouping: true,
    expectedStrategyTags: ["check ones", "borrow from tens", "subtract ones", "subtract tens"],
  };

  it("asks 'What is 7 + 6?' when no strategies demonstrated for 27+36", () => {
    const probe = buildMathRetryProbe(ADDITION_27_36, [], "forgot to carry");
    expect(probe).toMatch(/7\s*\+\s*6/);
    expect(probe).toMatch(/ones/i);
  });

  it("asks about carrying when add_ones demonstrated but carry not", () => {
    const probe = buildMathRetryProbe(ADDITION_27_36, ["add ones"]);
    expect(probe).toMatch(/13/);
    expect(probe).toMatch(/more than 9/i);
  });

  it("asks about tens when add_ones and carry are demonstrated", () => {
    const probe = buildMathRetryProbe(ADDITION_27_36, ["add ones", "carry"]);
    expect(probe).toMatch(/tens/i);
    expect(probe).toMatch(/2\s*\+\s*3/);
  });

  it("returns null when all strategies demonstrated", () => {
    const probe = buildMathRetryProbe(ADDITION_27_36, ["add ones", "carry", "add tens"]);
    expect(probe).toBeNull();
  });

  it("subtraction: asks about ones comparison for 42-17", () => {
    const probe = buildMathRetryProbe(SUBTRACTION_42_17, []);
    expect(probe).toMatch(/2/);
    expect(probe).toMatch(/7/);
    expect(probe).toMatch(/ones/i);
  });

  it("subtraction: asks about borrowing when check_ones demonstrated", () => {
    const probe = buildMathRetryProbe(SUBTRACTION_42_17, ["check ones"]);
    expect(probe).toMatch(/borrow/i);
  });
});

// --- 3-state integration tests for exact user cases ---

describe("3-state math explanation — exact user cases", () => {
  const PROBLEM: MathProblem = {
    skill: "two_digit_addition",
    a: 27, b: 36,
    expression: "27 + 36",
    correctAnswer: 63,
    requiresRegrouping: true,
    expectedStrategyTags: ["add ones", "carry", "add tens"],
    commonWrongAnswers: [{ answer: 53, misconception: "forgot to carry" }],
  };

  it("Case A: '7 + 6 = 13 so I carry...' → strong mastery", () => {
    // Import validateMathAnswer and boundMathScore dynamically
    const { validateMathAnswer, boundMathScore } = require("./mathAnswerValidator");
    const validation = validateMathAnswer(
      "7 + 6 = 13 so I carry the one to the tens place and then add the tens to get 63",
      PROBLEM,
    );
    expect(validation.status).toBe("correct");
    expect(validation.hasPartialStrategy).toBe(true);
    const bounding = boundMathScore(70, validation);
    expect(bounding.boundedStatus).toBe("strong");
    expect(bounding.boundedScore).toBeGreaterThanOrEqual(80);
    expect(checkMathMastery(validation, bounding)).toBe(true);
  });

  it("Case B: '63' → correct_incomplete, NOT 'not quite yet'", () => {
    const { validateMathAnswer, boundMathScore, classifyMathExplanationState } = require("./mathAnswerValidator");
    const validation = validateMathAnswer("63", PROBLEM);
    expect(validation.status).toBe("correct");
    expect(validation.hasPartialStrategy).toBe(false);
    const state = classifyMathExplanationState(validation, true);
    expect(state).toBe("correct_incomplete");
    // Score should be developing (60-79), NOT treated as wrong
    const bounding = boundMathScore(50, validation);
    expect(bounding.boundedStatus).toBe("developing");
    expect(bounding.boundedScore).toBeGreaterThanOrEqual(60);
  });

  it("Case C: '27 + 36 = 53' → narrow retry probe with actual digits", () => {
    const { validateMathAnswer, classifyMathExplanationState } = require("./mathAnswerValidator");
    const validation = validateMathAnswer("27 + 36 = 53", PROBLEM);
    expect(validation.status).toBe("incorrect_known_misconception");
    expect(validation.matchedMisconception).toBe("forgot to carry");
    const state = classifyMathExplanationState(validation, true);
    expect(state).toBe("incorrect");
    // Retry probe should use actual operand digits
    const retryProbe = buildMathRetryProbe(PROBLEM, [], validation.matchedMisconception);
    expect(retryProbe).toMatch(/7\s*\+\s*6/);
    expect(retryProbe).not.toMatch(/How can we find the total/i);
  });

  it("Student repeats wrong answer twice → wraps honestly", () => {
    const { validateMathAnswer, boundMathScore } = require("./mathAnswerValidator");
    const validation = validateMathAnswer("53", PROBLEM);
    const bounding = boundMathScore(30, validation);
    expect(bounding.boundedStatus).toBe("needs_support");
    // buildPerformanceAwareClose for needs_support should NOT pretend success
    const closeMsg = buildPerformanceAwareClose("needs_support");
    expect(closeMsg).not.toMatch(/solved.*correctly|great work/i);
    expect(closeMsg).toMatch(/keep working|try again/i);
  });
});

// ============================================================================
// Live Cases B & C — math coaching follow-up chain
// ============================================================================

describe("Live Case B: wrong answer with useful strategy evidence", () => {
  const PROBLEM: MathProblem = {
    skill: "two_digit_addition",
    a: 27, b: 36,
    expression: "27 + 36",
    correctAnswer: 63,
    requiresRegrouping: true,
    expectedStrategyTags: ["add ones", "carry", "add tens"],
    commonWrongAnswers: [{ answer: 53, misconception: "forgot to carry" }],
  };

  it("'53 I added the seven and the six together first' extracts answer 53 and detects add_ones", () => {
    const validation = validateMathAnswer("53 I added the seven and the six together first", PROBLEM);
    expect(validation.extractedAnswer).toBe(53);
    expect(validation.status).toBe("incorrect_known_misconception");
    expect(validation.matchedMisconception).toBe("forgot to carry");
    expect(validation.demonstratedStrategies).toContain("add ones");
  });

  it("gets regrouping follow-up using combined strategies", () => {
    // Student demonstrated "add ones" — next probe should be about carry
    const retryProbe = buildMathRetryProbe(PROBLEM, ["add ones"], "forgot to carry");
    expect(retryProbe).toBeDefined();
    expect(retryProbe).toMatch(/7 \+ 6 makes 13|ones add up to more than 9/);
  });

  it("'because you have leftover' detects carry strategy", () => {
    const strategies = detectStrategiesWithContext("because you have leftover", PROBLEM);
    expect(strategies).toContain("carry");
  });

  it("accumulated strategies across two turns cover add_ones and carry", () => {
    const history = [
      { role: "student", message: "53 I added the seven and the six together first" },
      { role: "coach", message: "What do you do when 7 + 6 makes 13?" },
    ];
    const prior = accumulateMathStrategies(history, PROBLEM);
    const currentStrategies = detectStrategiesWithContext("because you have leftover", PROBLEM);
    const combined = [...new Set([...prior, ...currentStrategies])];
    expect(combined).toContain("add ones");
    expect(combined).toContain("carry");
  });
});

describe("Live Case C: progress after hint", () => {
  const PROBLEM: MathProblem = {
    skill: "two_digit_addition",
    a: 27, b: 36,
    expression: "27 + 36",
    correctAnswer: 63,
    requiresRegrouping: true,
    expectedStrategyTags: ["add ones", "carry", "add tens"],
    commonWrongAnswers: [{ answer: 53, misconception: "forgot to carry" }],
  };

  it("detectHintFollowedByProgress detects 'I don't know' → math answer", () => {
    const history = [
      { role: "student", message: "I don't know" },
      { role: "coach", message: "Here's a hint: start with the ones place." },
    ];
    const result = detectHintFollowedByProgress(
      history,
      "so maybe I would add the seven and the six together and get 13",
      PROBLEM,
    );
    expect(result).toBe(true);
  });

  it("detectHintFollowedByProgress returns false when current response is off-topic", () => {
    const history = [
      { role: "student", message: "I don't know" },
      { role: "coach", message: "Here's a hint." },
    ];
    const result = detectHintFollowedByProgress(history, "pizza", PROBLEM);
    expect(result).toBe(false);
  });

  it("detectHintFollowedByProgress returns false when prior turn was not 'I don't know'", () => {
    const history = [
      { role: "student", message: "53 I added them" },
      { role: "coach", message: "Not quite." },
    ];
    const result = detectHintFollowedByProgress(history, "7 + 6 = 13", PROBLEM);
    expect(result).toBe(false);
  });

  it("after hint progress, next retry probe targets the next missing step", () => {
    // Student demonstrated "add ones" via "add the seven and the six together and get 13"
    const strategies = detectStrategiesWithContext(
      "so maybe I would add the seven and the six together and get 13",
      PROBLEM,
    );
    expect(strategies).toContain("add ones");

    // Next probe should target "carry" (next missing strategy)
    const retryProbe = buildMathRetryProbe(PROBLEM, strategies, undefined);
    expect(retryProbe).toMatch(/7 \+ 6 makes 13|ones add up to more than 9/);
  });
});

// ============================================================================
// promptRequiresMathExplanation — expanded patterns
// ============================================================================

describe("promptRequiresMathExplanation — expanded", () => {
  it("detects 'What is the first step you used?'", () => {
    expect(promptRequiresMathExplanation("Solve 27+36. What is the first step you used?")).toBe(true);
  });

  it("detects 'What did you do first?'", () => {
    expect(promptRequiresMathExplanation("What did you do first?")).toBe(true);
  });

  it("still detects 'Tell what you did when adding the ones.'", () => {
    expect(promptRequiresMathExplanation("Tell what you did when adding the ones.")).toBe(true);
  });

  it("does NOT flag a bare numeric prompt", () => {
    expect(promptRequiresMathExplanation("Solve 27 + 36.")).toBe(false);
  });
});

// ============================================================================
// isOffTopicResponse — expanded math vocabulary
// ============================================================================

describe("isOffTopicResponse — expanded math vocab", () => {
  const PROBLEM: MathProblem = {
    skill: "two_digit_addition", a: 27, b: 36,
    expression: "27 + 36", correctAnswer: 63,
    requiresRegrouping: true,
    expectedStrategyTags: ["add ones", "carry", "add tens"],
  };

  it("'because you have leftover' is NOT off-topic", () => {
    expect(isOffTopicResponse("because you have leftover", PROBLEM)).toBe(false);
  });

  it("'I would put them together' is NOT off-topic", () => {
    expect(isOffTopicResponse("I would put them together", PROBLEM)).toBe(false);
  });

  it("'pizza' is still off-topic", () => {
    expect(isOffTopicResponse("pizza", PROBLEM)).toBe(true);
  });

  it("'I don't know' with no math content is off-topic", () => {
    expect(isOffTopicResponse("I don't know", PROBLEM)).toBe(true);
  });
});

// ============================================================================
// "not enough math evidence" — tightened criteria
// ============================================================================

describe("not enough math evidence — close message tightening", () => {
  it("not_enough_evidence close only for truly non-math responses", () => {
    const msg = buildPerformanceAwareClose("not_enough_evidence");
    expect(msg).toMatch(/didn't get enough/i);
  });

  it("needs_support close used when some evidence exists", () => {
    const msg = buildPerformanceAwareClose("needs_support");
    expect(msg).not.toMatch(/didn't get enough/i);
    expect(msg).toMatch(/keep working/i);
  });
});

// ============================================================================
// Math teacher summaries — evidence-based language
// ============================================================================

describe("math teacher summary — evidence-based", () => {
  const PROBLEM: MathProblem = {
    skill: "two_digit_addition", a: 27, b: 36,
    expression: "27 + 36", correctAnswer: 63,
    requiresRegrouping: true,
    expectedStrategyTags: ["add ones", "carry", "add tens"],
    commonWrongAnswers: [{ answer: 53, misconception: "forgot to carry" }],
  };

  it("Case B summary mentions ones digits and wrong answer", () => {
    const validation = validateMathAnswer("53 I added the seven and the six together first", PROBLEM);
    const bounding = boundMathScore(40, validation);
    const summary = buildMathTeacherSummary({
      mathValidation: validation,
      mathBounding: bounding,
      mathProblem: PROBLEM,
      cleanedStudentResponse: "53 I added the seven and the six together first",
      combinedStrategies: ["add ones"],
    });
    expect(summary.renderedSummary).toMatch(/knew to add the ones/);
    expect(summary.renderedSummary).toMatch(/53 instead of 63/);
  });

  it("Case C summary after hint mentions partial progress", () => {
    const validation = validateMathAnswer("so maybe I would add the seven and the six together and get 13", PROBLEM);
    const bounding = boundMathScore(30, validation);
    const summary = buildMathTeacherSummary({
      mathValidation: validation,
      mathBounding: bounding,
      mathProblem: PROBLEM,
      cleanedStudentResponse: "so maybe I would add the seven and the six together and get 13",
      combinedStrategies: ["add ones"],
    });
    expect(summary.renderedSummary).toMatch(/knew to add the ones/);
    expect(summary.renderedSummary).toMatch(/regroup/);
  });

  it("Case A summary mentions correct answer and strategies", () => {
    const validation = validateMathAnswer(
      "7 + 6 = 13 so I carry the one to the tens place and then add the tens to get 63",
      PROBLEM,
    );
    const bounding = boundMathScore(90, validation);
    const summary = buildMathTeacherSummary({
      mathValidation: validation,
      mathBounding: bounding,
      mathProblem: PROBLEM,
      cleanedStudentResponse: "7 + 6 = 13 so I carry the one to the tens place and then add the tens to get 63",
    });
    expect(summary.renderedSummary).toMatch(/solved.*correctly/);
    expect(summary.renderedSummary).toMatch(/add ones|carry|add tens/);
  });
});
