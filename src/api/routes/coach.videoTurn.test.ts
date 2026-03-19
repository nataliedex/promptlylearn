/**
 * Full-flow regression tests for the video-turn decision chain.
 *
 * These simulate the exact sequence of validators, bounding, step accumulation,
 * resolvePostEvaluation, and backstops that the /api/coach/video-turn handler
 * runs — WITHOUT requiring an LLM. They exercise the LIVE PATH that determines
 * shouldContinue, turnKind, and response text.
 *
 * Key test case: "25" → "five" (student said correct answer 25 on turn 1,
 * then says "five" when asked "What do you get when you add 1 and 4?")
 */

import {
  validateMathAnswer,
  boundMathScore,
  classifyMathExplanationState,
  accumulateReasoningStepEvidence,
  getFirstMissingStepProbe,
  stepAwareStatus,
  hasMathEvidence,
  type MathValidationResult,
  type ReasoningStepAccumulation,
} from "../../domain/mathAnswerValidator";
import {
  resolvePostEvaluation,
  checkMathMastery,
  promptRequiresMathExplanation,
  isOffTopicResponse,
  countOffTopicTurns,
  containsEndingLanguage,
  buildPerformanceAwareClose,
  isPraiseOnly,
  CORRECT_THRESHOLD,
} from "../../domain/videoCoachGuardrails";
import { buildDeterministicMathRubric } from "../../domain/mathProblemGenerator";
import {
  getDeterministicRemediationMove,
  shouldUseDeterministicRemediation,
  classifyStudentState,
  detectMisconceptionCategory,
  buildInstructionalRecap,
  detectConversationMisconceptions,
  buildStepFailureRecap,
  detectPersistentStepFailure,
} from "../../domain/deterministicRemediation";
import { ReasoningStep } from "../../domain/prompt";
import { MathProblem } from "../../domain/mathProblem";

// ── Test fixtures ────────────────────────────────────────────────

const mathProblem: MathProblem = {
  skill: "two_digit_addition",
  a: 11,
  b: 14,
  expression: "11 + 14",
  correctAnswer: 25,
  requiresRegrouping: false,
  expectedStrategyTags: ["add ones", "add tens"],
};

const reasoningSteps: ReasoningStep[] = [
  {
    id: "step_1",
    label: "Add the ones",
    expectedStatements: ["1 + 4 = 5"],
    probe: "What do you get when you add 1 and 4?",
    kind: "ones_sum",
  },
  {
    id: "step_2",
    label: "Add the tens",
    expectedStatements: ["10 + 10 = 20"],
    probe: "What do you get when you add 10 and 10?",
    kind: "tens_sum",
  },
  {
    id: "step_3",
    label: "Combine the totals",
    expectedStatements: ["20 + 5 = 25", "The final answer is 25"],
    probe: "What do you get when you combine 20 and 5?",
    kind: "combine",
  },
];

const promptInput = "Solve 11 + 14. Tell how you got your answer.";

// ── Helper: simulate the video-turn decision chain ───────────────

interface SimulatedTurnResult {
  mathValidation: MathValidationResult;
  mathAnswerCorrect: boolean;
  stepAccumulation: ReasoningStepAccumulation | null;
  resolvedShouldContinue: boolean;
  resolvedProbeFirst: boolean;
  finalShouldContinue: boolean;
  finalResponse: string;
  turnKind: "FEEDBACK" | "PROBE" | "REFLECTION" | "WRAP";
  debugTrace: string[];
  /** Pre-built instructional recap for client-side wraps */
  instructionalRecap?: string;
  /** Fraction of reasoning steps satisfied (0-1) */
  completionRatio: number;
}

function simulateVideoTurnDecisionChain(opts: {
  studentResponse: string;
  conversationHistory: Array<{ role: "student" | "coach"; message: string }>;
  attemptCount: number;
  maxAttempts: number;
  followUpCount: number;
  timeRemainingSec?: number;
}): SimulatedTurnResult {
  const trace: string[] = [];
  const { studentResponse, conversationHistory, attemptCount, maxAttempts, followUpCount, timeRemainingSec } = opts;

  // 1. Math validation (full transcript)
  const fullMathTranscript = [
    ...conversationHistory.filter(h => h.role === "student").map(h => h.message),
    studentResponse,
  ].join(" ");

  let mathValidation = validateMathAnswer(fullMathTranscript, mathProblem);
  trace.push(`mathValidation: status=${mathValidation.status} extracted=${mathValidation.extractedAnswer}`);

  // Per-turn correction
  if (mathValidation.status !== "correct") {
    const perTurnMessages = [
      ...conversationHistory.filter(h => h.role === "student").map(h => h.message),
      studentResponse,
    ];
    for (const turn of perTurnMessages) {
      const turnValidation = validateMathAnswer(turn, mathProblem);
      if (turnValidation.status === "correct") {
        const allStrategies = new Set([
          ...mathValidation.demonstratedStrategies,
          ...turnValidation.demonstratedStrategies,
        ]);
        mathValidation = {
          ...mathValidation,
          status: "correct",
          extractedAnswer: turnValidation.extractedAnswer,
          demonstratedStrategies: Array.from(allStrategies),
          hasPartialStrategy: allStrategies.size > 0,
        };
        trace.push(`per-turn-correction: turn="${turn.slice(0, 40)}" → correct (answer=${turnValidation.extractedAnswer})`);
        break;
      }
    }
  }

  // 2. Bounding
  const mathBounding = boundMathScore(60, mathValidation); // placeholder score=60 for continuation turns
  trace.push(`mathBounding: status=${mathBounding.boundedStatus} score=${mathBounding.boundedScore}`);

  // 3. Math explanation state
  const requiresExplanation = promptRequiresMathExplanation(promptInput);
  const mathExplanationState = classifyMathExplanationState(mathValidation, requiresExplanation);
  trace.push(`mathExplanationState=${mathExplanationState}`);

  // 4. Step accumulation
  const stepAccumulation = accumulateReasoningStepEvidence(
    reasoningSteps,
    conversationHistory,
    studentResponse,
    mathProblem.correctAnswer,
  );
  trace.push(`stepAccumulation: satisfied=[${stepAccumulation.satisfiedStepIds}] missing=[${stepAccumulation.missingStepIds}] answer=${stepAccumulation.answerCorrect}`);

  // 5. Math mastery
  let mathMasteryOverride = checkMathMastery(mathValidation, mathBounding);
  if (stepAccumulation.alternateStrategyDetected && stepAccumulation.answerCorrect) {
    mathMasteryOverride = true;
    trace.push(`step-mastery: alternate strategy detected + correct answer → mastery`);
  } else if (stepAccumulation.missingStepIds.length > 0 && mathMasteryOverride && !stepAccumulation.alternateStrategyDetected) {
    mathMasteryOverride = false;
    trace.push("step-mastery: overriding strategy mastery — missing steps remain");
  }

  // 6. resolvePostEvaluation
  const mathAnswerCorrect = mathValidation.status === "correct";
  const feedbackScore = mathBounding.boundedScore;
  const resolved = resolvePostEvaluation(
    { score: feedbackScore, isCorrect: feedbackScore >= CORRECT_THRESHOLD, shouldContinue: true },
    attemptCount,
    maxAttempts,
    followUpCount,
    mathBounding.boundedStatus,
    timeRemainingSec,
    mathMasteryOverride,
    mathAnswerCorrect,
  );
  trace.push(`resolvePostEval: shouldContinue=${resolved.shouldContinue} probeFirst=${resolved.probeFirst}`);

  let resolvedShouldContinue = resolved.shouldContinue;
  let resolvedProbeFirst = resolved.probeFirst;

  // 7. Step-aware wrap prevention
  if (
    stepAccumulation &&
    !mathMasteryOverride &&
    !resolvedShouldContinue &&
    stepAccumulation.missingStepIds.length > 0 &&
    (stepAccumulation.newlySatisfiedStepIds.length > 0 || stepAccumulation.satisfiedStepIds.length > 0 || stepAccumulation.answerCorrect) &&
    (!timeRemainingSec || timeRemainingSec > 15)
  ) {
    trace.push(`step-wrap-prevent: forcing continuation (satisfied=${stepAccumulation.satisfiedStepIds.length} answer=${stepAccumulation.answerCorrect})`);
    resolvedShouldContinue = true;
    resolvedProbeFirst = true;
  }

  // 8. Step-aware probe upgrade (skip if alternate strategy mastery)
  if (
    stepAccumulation &&
    !mathMasteryOverride &&
    resolvedShouldContinue &&
    !resolvedProbeFirst &&
    stepAccumulation.missingStepIds.length > 0 &&
    stepAccumulation.answerCorrect
  ) {
    trace.push("step-probe-upgrade: upgrading to probeFirst");
    resolvedProbeFirst = true;
  }

  // 9. Build response
  let finalShouldContinue = resolvedShouldContinue;
  let finalResponse = "";

  if (resolvedProbeFirst) {
    // Math probe path — prefer deterministic remediation (matches real server)
    if (shouldUseDeterministicRemediation(reasoningSteps, stepAccumulation)) {
      const remediationMove = getDeterministicRemediationMove(
        reasoningSteps, stepAccumulation!, studentResponse, mathProblem, conversationHistory,
      );
      if (remediationMove && remediationMove.type !== "WRAP_SUCCESS") {
        if (mathExplanationState === "correct_incomplete" && mathValidation.status === "correct") {
          finalResponse = `That's right, ${mathValidation.extractedAnswer} is correct! ${remediationMove.text}`;
        } else {
          finalResponse = remediationMove.text;
        }
        trace.push(`deterministic-remediation-probeFirst: type=${remediationMove.type} step=${remediationMove.targetStepId} state=${remediationMove.studentState} → "${finalResponse.slice(0, 80)}"`);
      } else if (remediationMove?.type === "WRAP_SUCCESS") {
        finalShouldContinue = false;
        finalResponse = "Great work! You solved the problem correctly and explained your thinking.";
        trace.push("deterministic-remediation-probeFirst: WRAP_SUCCESS");
      }
    }
    // Fallback: raw step probe
    if (!finalResponse) {
      const missingStep = getFirstMissingStepProbe(reasoningSteps, stepAccumulation);
      if (missingStep) {
        finalResponse = missingStep.probe;
        trace.push(`step-probe: "${missingStep.label}" → "${missingStep.probe}"`);
      }
    }
  } else if (resolvedShouldContinue) {
    // Continue path (non-probeFirst): Try deterministic remediation first
    if (shouldUseDeterministicRemediation(reasoningSteps, stepAccumulation)) {
      const remediationMove = getDeterministicRemediationMove(
        reasoningSteps, stepAccumulation!, studentResponse, mathProblem, conversationHistory,
      );
      if (remediationMove && remediationMove.type !== "WRAP_SUCCESS") {
        if (mathExplanationState === "correct_incomplete" && mathValidation.status === "correct") {
          finalResponse = `That's right, ${mathValidation.extractedAnswer} is correct! ${remediationMove.text}`;
        } else {
          finalResponse = remediationMove.text;
        }
        trace.push(`deterministic-remediation: type=${remediationMove.type} step=${remediationMove.targetStepId} state=${remediationMove.studentState} → "${finalResponse.slice(0, 80)}"`);
      } else if (remediationMove?.type === "WRAP_SUCCESS") {
        finalShouldContinue = false;
        finalResponse = "Great work! You solved the problem correctly and explained your thinking.";
        trace.push("deterministic-remediation: WRAP_SUCCESS");
      }
    }
    // Legacy fallback for correct_incomplete
    if (!finalResponse && mathExplanationState === "correct_incomplete") {
      const missingStep = getFirstMissingStepProbe(reasoningSteps, stepAccumulation);
      const probe = missingStep?.probe || "Can you explain how you solved it?";
      finalResponse = `That's right, ${mathValidation.extractedAnswer} is correct! ${probe}`;
      trace.push(`correct_incomplete: "${finalResponse.slice(0, 80)}"`);
    }
  }

  // 10. Final backstops

  // REASONING-STEP ANTI-WRAP GUARD: Never wrap when reasoning steps exist
  // with missing steps and attempts remain — unless alternate strategy was detected.
  if (!finalShouldContinue && reasoningSteps.length > 0 &&
      stepAccumulation.missingStepIds.length > 0 &&
      !stepAccumulation.alternateStrategyDetected &&
      attemptCount < maxAttempts - 1 &&
      (!timeRemainingSec || timeRemainingSec > 15)) {
    const antiWrapProbe = getFirstMissingStepProbe(reasoningSteps, stepAccumulation);
    if (antiWrapProbe) {
      trace.push(`step-anti-wrap: OVERRIDE — missing steps + attemptCount=${attemptCount} < max=${maxAttempts} → "${antiWrapProbe.probe}"`);
      finalShouldContinue = true;
      finalResponse = antiWrapProbe.probe;
    }
  }

  // MISCONCEPTION ANTI-WRAP: When a misconception is detected, redirect
  // instead of wrapping — even at max attempts.
  if (!finalShouldContinue && reasoningSteps.length > 0 &&
      stepAccumulation.missingStepIds.length > 0 &&
      (!timeRemainingSec || timeRemainingSec > 15)) {
    const misconceptionMove = getDeterministicRemediationMove(
      reasoningSteps, stepAccumulation, studentResponse, mathProblem, conversationHistory,
    );
    if (misconceptionMove && (misconceptionMove.type === "STEP_MISCONCEPTION_REDIRECT" || misconceptionMove.type === "STEP_MODEL_INSTRUCTION" || misconceptionMove.type === "STEP_CONCEPT_EXPLANATION")) {
      trace.push(`misconception-anti-wrap: OVERRIDE — type=${misconceptionMove.type} ${misconceptionMove.misconceptionCategory || ""} → "${misconceptionMove.text.slice(0, 80)}"`);
      finalShouldContinue = true;
      finalResponse = misconceptionMove.text;
    }
  }

  // Existing backstop: evidence-based (skip if alternate strategy detected)
  if (!finalShouldContinue && stepAccumulation.missingStepIds.length > 0 &&
      !stepAccumulation.alternateStrategyDetected &&
      (stepAccumulation.satisfiedStepIds.length > 0 || stepAccumulation.answerCorrect) &&
      (!timeRemainingSec || timeRemainingSec > 15)) {
    const backstopProbe = getFirstMissingStepProbe(reasoningSteps, stepAccumulation);
    if (backstopProbe) {
      trace.push(`step-backstop: FINAL OVERRIDE → "${backstopProbe.probe}"`);
      finalShouldContinue = true;
      finalResponse = backstopProbe.probe;
    }
  }

  if (!finalShouldContinue && mathAnswerCorrect && feedbackScore < CORRECT_THRESHOLD &&
      !(stepAccumulation.alternateStrategyDetected) &&
      (!timeRemainingSec || timeRemainingSec > 15)) {
    const probe = getFirstMissingStepProbe(reasoningSteps, stepAccumulation);
    if (probe) {
      trace.push(`math-answer-backstop: FINAL OVERRIDE → "${probe.probe}"`);
      finalShouldContinue = true;
      finalResponse = `That's right, ${mathValidation.extractedAnswer} is the answer! ${probe.probe}`;
    }
  }

  // 11. Final praise-only guard: If wrapping with praise-only text and score < 80,
  // replace with performance-aware close
  if (!finalShouldContinue && isPraiseOnly(finalResponse) && feedbackScore < CORRECT_THRESHOLD) {
    const closeStatus = mathBounding.boundedStatus === "strong" ? "developing" : mathBounding.boundedStatus;
    trace.push(`praise-only-guard: replacing "${finalResponse}" with ${closeStatus} close`);
    finalResponse = buildPerformanceAwareClose(closeStatus as any);
  }

  // 11b. Instructional recap: enhance wrap with concrete solution model
  // when a misconception or persistent step failure was detected
  if (
    !finalShouldContinue &&
    reasoningSteps.length > 0 &&
    stepAccumulation.missingStepIds.length > 0 &&
    feedbackScore < CORRECT_THRESHOLD
  ) {
    const misconceptionCategory = detectConversationMisconceptions(
      conversationHistory, studentResponse, mathProblem, stepAccumulation, reasoningSteps,
    );
    if (misconceptionCategory) {
      const recap = buildInstructionalRecap(reasoningSteps, mathProblem, misconceptionCategory);
      trace.push(`instructional-recap: misconception="${misconceptionCategory}" → "${recap.slice(0, 80)}"`);
      finalResponse = recap;
    } else {
      const stepFailure = detectPersistentStepFailure(
        reasoningSteps, stepAccumulation, conversationHistory, mathProblem,
      );
      if (stepFailure) {
        const recap = buildStepFailureRecap(reasoningSteps, stepFailure.step, mathProblem);
        trace.push(`instructional-recap: step-failure="${stepFailure.step.label}" (${stepFailure.failures}x) → "${recap.slice(0, 80)}"`);
        finalResponse = recap;
      }
    }
  }

  // 12. Pre-compute instructional recap for client-side wraps (all turns)
  let instructionalRecap: string | undefined;
  if (stepAccumulation.missingStepIds.length > 0) {
    const recapCategory = detectConversationMisconceptions(
      conversationHistory, studentResponse, mathProblem, stepAccumulation, reasoningSteps,
    );
    if (recapCategory) {
      instructionalRecap = buildInstructionalRecap(reasoningSteps, mathProblem, recapCategory);
      trace.push(`instructionalRecap: "${recapCategory}" → "${instructionalRecap.slice(0, 80)}"`);
    } else {
      const stepFailure = detectPersistentStepFailure(
        reasoningSteps, stepAccumulation, conversationHistory, mathProblem,
      );
      if (stepFailure) {
        instructionalRecap = buildStepFailureRecap(reasoningSteps, stepFailure.step, mathProblem);
        trace.push(`instructionalRecap: step-failure="${stepFailure.step.label}" → "${instructionalRecap.slice(0, 80)}"`);
      }
    }
  }

  // 13. Compute turnKind
  let turnKind: "FEEDBACK" | "PROBE" | "REFLECTION" | "WRAP" = "FEEDBACK";
  if (finalShouldContinue && finalResponse.includes("?")) {
    turnKind = "PROBE";
  } else if (!finalShouldContinue) {
    turnKind = "WRAP";
  }
  trace.push(`RESULT: turnKind=${turnKind} shouldContinue=${finalShouldContinue}`);

  return {
    mathValidation,
    mathAnswerCorrect,
    stepAccumulation,
    resolvedShouldContinue,
    resolvedProbeFirst,
    finalShouldContinue,
    finalResponse,
    turnKind,
    debugTrace: trace,
    instructionalRecap,
    completionRatio: stepAccumulation?.completionRatio ?? 0,
  };
}


// ── TESTS ────────────────────────────────────────────────────────

describe("video-turn full decision chain", () => {

  describe("25 → five (golden case)", () => {
    // Student said "25" on turn 1, coach asked "What do you get when you add 1 and 4?",
    // student says "five". Expected: PROBE for next missing step, NOT WRAP.
    const result = simulateVideoTurnDecisionChain({
      studentResponse: "five",
      conversationHistory: [
        { role: "student", message: "25" },
        { role: "coach", message: "What do you get when you add 1 and 4?" },
      ],
      attemptCount: 2,
      maxAttempts: 2,
      followUpCount: 1,
    });

    it("detects correct answer from prior turn", () => {
      expect(result.mathAnswerCorrect).toBe(true);
      expect(result.mathValidation.status).toBe("correct");
    });

    it("accumulates step_1 as satisfied (five = 5 matches 1 + 4 = 5)", () => {
      expect(result.stepAccumulation!.satisfiedStepIds).toContain("step_1");
    });

    it("accumulates step_3 as satisfied (25 matches combine step)", () => {
      expect(result.stepAccumulation!.satisfiedStepIds).toContain("step_3");
    });

    it("has missing steps remaining", () => {
      expect(result.stepAccumulation!.missingStepIds.length).toBeGreaterThan(0);
      expect(result.stepAccumulation!.missingStepIds).toContain("step_2");
    });

    it("does NOT wrap — continues to probe", () => {
      expect(result.finalShouldContinue).toBe(true);
      expect(result.turnKind).toBe("PROBE");
    });

    it("probes for the next missing step (tens)", () => {
      expect(result.finalResponse).toContain("?");
      // Should be the tens step probe
      expect(result.finalResponse.toLowerCase()).toMatch(/add.*10|tens/i);
    });

    it("produces a clean debug trace", () => {
      // Log the trace for manual inspection
      console.log("[25→five trace]\n" + result.debugTrace.join("\n"));
      expect(result.debugTrace.some(t => t.includes("WRAP"))).toBe(false);
    });
  });

  describe("25 → 1 + 4 = 5 (explicit step)", () => {
    const result = simulateVideoTurnDecisionChain({
      studentResponse: "1 + 4 = 5",
      conversationHistory: [
        { role: "student", message: "25" },
        { role: "coach", message: "What do you get when you add 1 and 4?" },
      ],
      attemptCount: 2,
      maxAttempts: 2,
      followUpCount: 1,
    });

    it("detects correct answer from prior turn", () => {
      expect(result.mathAnswerCorrect).toBe(true);
    });

    it("satisfies step_1 (ones sum)", () => {
      expect(result.stepAccumulation!.satisfiedStepIds).toContain("step_1");
    });

    it("continues to probe for remaining steps", () => {
      expect(result.finalShouldContinue).toBe(true);
      expect(result.turnKind).toBe("PROBE");
    });
  });

  describe("25 → 1 + 4 = 5 → 10 + 10 = 20 (two steps done)", () => {
    const result = simulateVideoTurnDecisionChain({
      studentResponse: "10 + 10 = 20",
      conversationHistory: [
        { role: "student", message: "25" },
        { role: "coach", message: "What do you get when you add 1 and 4?" },
        { role: "student", message: "1 + 4 = 5" },
        { role: "coach", message: "What do you get when you add 10 and 10?" },
      ],
      attemptCount: 3,
      maxAttempts: 2,
      followUpCount: 2,
    });

    it("has all three steps satisfied (answer + ones + tens + combine)", () => {
      // step_1 from "1 + 4 = 5", step_2 from "10 + 10 = 20", step_3 from "25"
      expect(result.stepAccumulation!.satisfiedStepIds).toContain("step_1");
      expect(result.stepAccumulation!.satisfiedStepIds).toContain("step_2");
      expect(result.stepAccumulation!.satisfiedStepIds).toContain("step_3");
    });

    it("has no missing steps", () => {
      expect(result.stepAccumulation!.missingStepIds).toHaveLength(0);
    });
  });

  describe("first turn: just 25 (no explanation)", () => {
    const result = simulateVideoTurnDecisionChain({
      studentResponse: "25",
      conversationHistory: [],
      attemptCount: 1,
      maxAttempts: 2,
      followUpCount: 0,
    });

    it("detects correct answer", () => {
      expect(result.mathAnswerCorrect).toBe(true);
    });

    it("has missing steps (no explanation yet)", () => {
      expect(result.stepAccumulation!.missingStepIds.length).toBeGreaterThan(0);
    });

    it("continues to probe for explanation", () => {
      expect(result.finalShouldContinue).toBe(true);
      expect(result.turnKind).toBe("PROBE");
    });
  });

  describe("wrong answer: 30", () => {
    const result = simulateVideoTurnDecisionChain({
      studentResponse: "30",
      conversationHistory: [],
      attemptCount: 1,
      maxAttempts: 2,
      followUpCount: 0,
    });

    it("detects incorrect answer", () => {
      expect(result.mathAnswerCorrect).toBe(false);
    });

    it("continues (attempt 1 of 2)", () => {
      expect(result.finalShouldContinue).toBe(true);
    });
  });

  describe("edge: five as first response (no prior 25)", () => {
    const result = simulateVideoTurnDecisionChain({
      studentResponse: "five",
      conversationHistory: [],
      attemptCount: 1,
      maxAttempts: 2,
      followUpCount: 0,
    });

    it("detects incorrect answer (5 ≠ 25)", () => {
      expect(result.mathAnswerCorrect).toBe(false);
    });

    it("continues (first attempt)", () => {
      expect(result.finalShouldContinue).toBe(true);
    });
  });
});

describe("runtime backfill: reasoningSteps from mathProblem", () => {
  it("buildDeterministicMathRubric produces reasoningSteps for addition", () => {
    const rubric = buildDeterministicMathRubric(mathProblem);
    expect(rubric.reasoningSteps).toBeDefined();
    expect(rubric.reasoningSteps.length).toBeGreaterThanOrEqual(3);
    // Must have ones_sum, tens_sum, combine
    const kinds = rubric.reasoningSteps.map(s => s.kind);
    expect(kinds).toContain("ones_sum");
    expect(kinds).toContain("tens_sum");
    expect(kinds).toContain("combine");
  });

  it("each reasoning step has probe, expectedStatements, and id", () => {
    const rubric = buildDeterministicMathRubric(mathProblem);
    for (const step of rubric.reasoningSteps) {
      expect(step.id).toBeTruthy();
      expect(step.probe).toContain("?");
      expect(step.expectedStatements.length).toBeGreaterThan(0);
      expect(step.kind).toBeTruthy();
    }
  });

  it("backfilled steps work with step accumulation (25 → five)", () => {
    const rubric = buildDeterministicMathRubric(mathProblem);
    const acc = accumulateReasoningStepEvidence(
      rubric.reasoningSteps,
      [
        { role: "student", message: "25" },
        { role: "coach", message: "What do you get when you add 1 and 4?" },
      ],
      "five",
      mathProblem.correctAnswer,
    );
    // "five" → 5 should match ones_sum (1 + 4 = 5)
    expect(acc.satisfiedStepIds).toContain("step_1");
    // "25" should match combine step
    expect(acc.satisfiedStepIds).toContain("step_3");
    // tens_sum should be missing
    expect(acc.missingStepIds).toContain("step_2");
    expect(acc.answerCorrect).toBe(true);
  });

  it("backfilled steps produce correct probe for missing tens step", () => {
    const rubric = buildDeterministicMathRubric(mathProblem);
    const acc = accumulateReasoningStepEvidence(
      rubric.reasoningSteps,
      [
        { role: "student", message: "25" },
        { role: "coach", message: "What do you get when you add 1 and 4?" },
      ],
      "five",
      mathProblem.correctAnswer,
    );
    const missing = getFirstMissingStepProbe(rubric.reasoningSteps, acc);
    expect(missing).toBeTruthy();
    expect(missing!.probe.toLowerCase()).toMatch(/add.*10/);
  });

  it("works for subtraction problems too", () => {
    const subProblem: MathProblem = {
      skill: "two_digit_subtraction",
      a: 47,
      b: 23,
      expression: "47 - 23",
      correctAnswer: 24,
      requiresRegrouping: false,
      expectedStrategyTags: ["subtract ones", "subtract tens"],
    };
    const rubric = buildDeterministicMathRubric(subProblem);
    expect(rubric.reasoningSteps.length).toBeGreaterThanOrEqual(2);
    expect(rubric.reasoningSteps.every(s => s.probe.includes("?"))).toBe(true);
  });
});

describe("promptRequiresMathExplanation duplication fix", () => {
  it("matches 'Tell how you got your answer'", () => {
    expect(promptRequiresMathExplanation("Solve 11 + 14. Tell how you got your answer.")).toBe(true);
  });

  it("matches 'tell how you got your answer' (lowercase)", () => {
    expect(promptRequiresMathExplanation("solve 11 + 14. tell how you got your answer.")).toBe(true);
  });

  it("still matches 'explain'", () => {
    expect(promptRequiresMathExplanation("Explain how you solved 11 + 14.")).toBe(true);
  });

  it("still matches 'tell how you did'", () => {
    expect(promptRequiresMathExplanation("Tell how you did it.")).toBe(true);
  });

  it("still matches 'show how'", () => {
    expect(promptRequiresMathExplanation("Show how you solved this.")).toBe(true);
  });

  it("returns false for bare computation prompt", () => {
    expect(promptRequiresMathExplanation("Solve 11 + 14.")).toBe(false);
  });

  it("does NOT produce duplication when used in generator logic", () => {
    const rawInput = "Solve 11 + 14. Tell how you got your answer.";
    const finalInput = promptRequiresMathExplanation(rawInput)
      ? rawInput
      : `${rawInput.replace(/[.!?]\s*$/, "")}. Tell how you got your answer.`;
    // Should NOT duplicate the phrase
    expect(finalInput).toBe("Solve 11 + 14. Tell how you got your answer.");
    expect(finalInput.match(/Tell how you got your answer/g)?.length).toBe(1);
  });
});

describe("isOffTopicResponse with number words", () => {
  it("'five' is NOT off-topic for math (normalizes to 5)", () => {
    expect(isOffTopicResponse("five", mathProblem)).toBe(false);
  });

  it("'twenty five' is NOT off-topic for math", () => {
    expect(isOffTopicResponse("twenty five", mathProblem)).toBe(false);
  });

  it("'a five' is NOT off-topic for math", () => {
    expect(isOffTopicResponse("a five", mathProblem)).toBe(false);
  });

  it("'you get five' is NOT off-topic for math", () => {
    expect(isOffTopicResponse("you get five", mathProblem)).toBe(false);
  });

  it("'pizza' is still off-topic for math", () => {
    expect(isOffTopicResponse("pizza", mathProblem)).toBe(true);
  });

  it("'I like dogs' is still off-topic for math", () => {
    expect(isOffTopicResponse("I like dogs", mathProblem)).toBe(true);
  });
});

describe("25 → five → next probe targets tens (not strategy drift)", () => {
  // After student says "five" satisfying ones step, next probe must be
  // the tens step probe, NOT a strategy-drift probe like "count up from 11"
  const result = simulateVideoTurnDecisionChain({
    studentResponse: "five",
    conversationHistory: [
      { role: "student", message: "25" },
      { role: "coach", message: "What do you get when you add 1 and 4?" },
    ],
    attemptCount: 2,
    maxAttempts: 2,
    followUpCount: 1,
  });

  it("ones step is satisfied", () => {
    expect(result.stepAccumulation!.satisfiedStepIds).toContain("step_1");
  });

  it("next probe asks about tens, not alternate strategy", () => {
    expect(result.finalResponse).toContain("?");
    // Must be the tens step probe from reasoningSteps
    expect(result.finalResponse).toMatch(/add.*10|tens/i);
    // Must NOT contain strategy-drift language
    expect(result.finalResponse.toLowerCase()).not.toContain("count up");
    expect(result.finalResponse.toLowerCase()).not.toContain("count on");
  });

  it("turn is PROBE, not WRAP", () => {
    expect(result.turnKind).toBe("PROBE");
    expect(result.finalShouldContinue).toBe(true);
  });
});

describe("after ones step, next probe comes from missing reasoning step", () => {
  // Student says "1 + 4 = 5" satisfying ones step.
  // Next probe must be the structured tens step probe.
  const result = simulateVideoTurnDecisionChain({
    studentResponse: "1 + 4 = 5",
    conversationHistory: [
      { role: "student", message: "25" },
      { role: "coach", message: "Can you explain how you got 25?" },
    ],
    attemptCount: 2,
    maxAttempts: 2,
    followUpCount: 1,
  });

  it("ones step is satisfied", () => {
    expect(result.stepAccumulation!.satisfiedStepIds).toContain("step_1");
  });

  it("tens step is missing", () => {
    expect(result.stepAccumulation!.missingStepIds).toContain("step_2");
  });

  it("probe targets tens — the next MISSING step", () => {
    // Probe should be "What do you get when you add 10 and 10?"
    expect(result.finalResponse.toLowerCase()).toMatch(/add.*10/);
  });

  it("probe does NOT use generic strategy wording", () => {
    expect(result.finalResponse.toLowerCase()).not.toContain("what did you do with");
    expect(result.finalResponse.toLowerCase()).not.toContain("count up");
  });
});

describe("25 → 10 + 10 = 20 → next probe asks about 1 and 4", () => {
  // Tens step first, then ones step should be the next probe.
  const result = simulateVideoTurnDecisionChain({
    studentResponse: "10 + 10 = 20",
    conversationHistory: [
      { role: "student", message: "25" },
      { role: "coach", message: "Can you explain how you got 25?" },
    ],
    attemptCount: 2,
    maxAttempts: 2,
    followUpCount: 1,
  });

  it("tens step is satisfied", () => {
    expect(result.stepAccumulation!.satisfiedStepIds).toContain("step_2");
  });

  it("ones step is missing", () => {
    expect(result.stepAccumulation!.missingStepIds).toContain("step_1");
  });

  it("next probe asks exactly about 1 and 4", () => {
    expect(result.finalResponse.toLowerCase()).toMatch(/add.*1.*4|add.*4.*1/);
    expect(result.finalResponse).toContain("?");
  });

  it("turn is PROBE, not WRAP", () => {
    expect(result.turnKind).toBe("PROBE");
  });
});

describe("no vague fallback probe when reasoningSteps are present", () => {
  // After each step is satisfied, the next probe must come from reasoningSteps.
  // Vague probes like "What do you think X means?" are never acceptable.
  const vaguePhrases = [
    "what do you think",
    "tell me more",
    "can you count up",
    "count on from",
    "what does that mean",
    "how would you describe",
  ];

  it("after ones step: no vague probe", () => {
    const result = simulateVideoTurnDecisionChain({
      studentResponse: "1 + 4 = 5",
      conversationHistory: [
        { role: "student", message: "25" },
        { role: "coach", message: "?" },
      ],
      attemptCount: 2,
      maxAttempts: 2,
      followUpCount: 1,
    });
    const lower = result.finalResponse.toLowerCase();
    for (const phrase of vaguePhrases) {
      expect(lower).not.toContain(phrase);
    }
    // Must use the exact step probe
    expect(lower).toMatch(/add.*10/);
  });

  it("after tens step: no vague probe", () => {
    const result = simulateVideoTurnDecisionChain({
      studentResponse: "10 + 10 = 20",
      conversationHistory: [
        { role: "student", message: "25" },
        { role: "coach", message: "?" },
      ],
      attemptCount: 2,
      maxAttempts: 2,
      followUpCount: 1,
    });
    const lower = result.finalResponse.toLowerCase();
    for (const phrase of vaguePhrases) {
      expect(lower).not.toContain(phrase);
    }
    // Must use the exact step probe for ones
    expect(lower).toMatch(/add.*1.*4|add.*4.*1/);
  });

  it("first turn (25 only): no vague probe", () => {
    const result = simulateVideoTurnDecisionChain({
      studentResponse: "25",
      conversationHistory: [],
      attemptCount: 1,
      maxAttempts: 2,
      followUpCount: 0,
    });
    const lower = result.finalResponse.toLowerCase();
    for (const phrase of vaguePhrases) {
      expect(lower).not.toContain(phrase);
    }
    // Must contain a question from reasoningSteps
    expect(result.finalResponse).toContain("?");
  });
});

// ============================================================================
// REGRESSION: "I don't know" on reasoning-step prompts must PROBE, not WRAP
// ============================================================================

describe("first-turn 'I don't know' on reasoning-step prompt → PROBE, not WRAP", () => {
  it("'I don't know' → PROBE with step-specific question", () => {
    const result = simulateVideoTurnDecisionChain({
      studentResponse: "I don't know",
      conversationHistory: [],
      attemptCount: 0,
      maxAttempts: 3,
      followUpCount: 0,
      timeRemainingSec: 110,
    });
    expect(result.finalShouldContinue).toBe(true);
    expect(result.turnKind).toBe("PROBE");
    expect(result.finalResponse).toContain("?");
    // Should be a simpler probe for the first missing step (ones)
    expect(result.finalResponse.toLowerCase()).toMatch(/ones|1.*4|1 \+ 4/);
  });

  it("'I still don't know' → PROBE, not WRAP", () => {
    const result = simulateVideoTurnDecisionChain({
      studentResponse: "I still don't know",
      conversationHistory: [
        { role: "student", message: "I don't know" },
        { role: "coach", message: "Let's do just the ones. What is 1 + 4?" },
      ],
      attemptCount: 1,
      maxAttempts: 3,
      followUpCount: 1,
      timeRemainingSec: 90,
    });
    expect(result.finalShouldContinue).toBe(true);
    expect(result.turnKind).toBe("PROBE");
    expect(result.finalResponse).toContain("?");
  });

  it("explicit hint request → exact step hint, not WRAP", () => {
    const result = simulateVideoTurnDecisionChain({
      studentResponse: "can I have a hint",
      conversationHistory: [],
      attemptCount: 0,
      maxAttempts: 3,
      followUpCount: 0,
      timeRemainingSec: 110,
    });
    expect(result.finalShouldContinue).toBe(true);
    expect(result.turnKind).toBe("PROBE");
    // Should be a STEP_HINT with step-specific text
    expect(result.finalResponse.toLowerCase()).toContain("hint");
    expect(result.finalResponse).toContain("?");
    expect(result.finalResponse.toLowerCase()).toMatch(/ones|1.*plus.*4/);
  });

  it("deterministic remediation cannot be overridden by generic wrap on early turns", () => {
    // Even with score=30 (no_answer), attemptCount=0, no evidence at all,
    // the system must produce a PROBE for reasoning-step prompts
    const result = simulateVideoTurnDecisionChain({
      studentResponse: "um",
      conversationHistory: [],
      attemptCount: 0,
      maxAttempts: 3,
      followUpCount: 0,
      timeRemainingSec: 110,
    });
    expect(result.turnKind).not.toBe("WRAP");
    expect(result.finalShouldContinue).toBe(true);
    expect(result.finalResponse).toContain("?");
    // Verify no "not enough evidence" or "try again later" language
    expect(result.finalResponse.toLowerCase()).not.toContain("not enough");
    expect(result.finalResponse.toLowerCase()).not.toContain("try again later");
    expect(result.finalResponse.toLowerCase()).not.toContain("move on");
  });
});

describe("browser payload regression: backfill-only reasoning steps", () => {
  // The browser may send requests where the frontend computed hasReasoningSteps=false
  // because the lesson JSON has mathProblem but no assessment.reasoningSteps.
  // The backend backfills reasoning steps from mathProblem at runtime.
  // These tests verify the backend STILL produces PROBE for "I don't know" and
  // "can I have a hint" even when the request comes from a frontend that didn't
  // know about reasoning steps.

  it("'I don't know' first turn with backfilled steps → PROBE", () => {
    // This mirrors the exact browser scenario: attemptCount=0 (no increment from
    // hintUpdates), conversationHistory includes the coach question
    const result = simulateVideoTurnDecisionChain({
      studentResponse: "I don't know",
      conversationHistory: [],
      attemptCount: 0,
      maxAttempts: 3,
      followUpCount: 0,
      timeRemainingSec: 105,
    });
    expect(result.turnKind).toBe("PROBE");
    expect(result.finalShouldContinue).toBe(true);
    expect(result.finalResponse).toContain("?");
  });

  it("'can I have a hint' first turn with backfilled steps → PROBE with hint", () => {
    const result = simulateVideoTurnDecisionChain({
      studentResponse: "can I have a hint",
      conversationHistory: [],
      attemptCount: 0,
      maxAttempts: 3,
      followUpCount: 0,
      timeRemainingSec: 108,
    });
    expect(result.turnKind).toBe("PROBE");
    expect(result.finalShouldContinue).toBe(true);
    expect(result.finalResponse.toLowerCase()).toContain("hint");
    expect(result.finalResponse).toContain("?");
  });
});

describe("wrong answer 'three' → repeated wrong/unclear → wrap wording", () => {
  it("first turn 'three' → PROBE, not WRAP", () => {
    const result = simulateVideoTurnDecisionChain({
      studentResponse: "three",
      conversationHistory: [],
      attemptCount: 0,
      maxAttempts: 3,
      followUpCount: 0,
    });
    expect(result.turnKind).toBe("PROBE");
    expect(result.finalShouldContinue).toBe(true);
    expect(result.finalResponse).toContain("?");
  });

  it("max attempts wrap does NOT use praise-only wording", () => {
    // Student at max attempts with no satisfied steps — should wrap but NOT with "Good thinking."
    const result = simulateVideoTurnDecisionChain({
      studentResponse: "I still dont know",
      conversationHistory: [
        { role: "coach", message: "Explain how to solve 11 + 14." },
        { role: "student", message: "three" },
        { role: "coach", message: "What do you get when you add 1 and 4?" },
      ],
      attemptCount: 2,
      maxAttempts: 2,
      followUpCount: 1,
    });
    // With no satisfied steps and max attempts, this should wrap
    // The wording must NOT be praise-only
    if (result.turnKind === "WRAP") {
      expect(result.finalResponse.toLowerCase()).not.toMatch(/^good thinking\.?\s*$/);
      expect(result.finalResponse.toLowerCase()).not.toMatch(/^great job\.?\s*$/);
      expect(result.finalResponse.toLowerCase()).not.toMatch(/^nice work\.?\s*$/);
    }
  });
});

describe("browser double-count regression: first-turn hint/IDK must PROBE, not WRAP", () => {
  // ROOT CAUSE: The browser included the current student turn in
  // conversationHistory, causing off-topic detection to count it twice:
  // once as a "prior" off-topic turn and once as the current response.
  // Total hit 2 → off-topic exit fired on the very first utterance.

  // After the fix, conversationHistory should NOT include the current
  // student turn. This test verifies the decision chain with CORRECT
  // history (no duplicate) and also verifies the off-topic counter
  // no longer double-counts.

  it("first-turn 'can I have a hint' → PROBE (not WRAP)", () => {
    // Correct history: only the coach greeting, NO student turn
    const result = simulateVideoTurnDecisionChain({
      studentResponse: "can I have a hint",
      conversationHistory: [
        { role: "coach", message: "Let's solve 11 + 14. Can you explain how you'd solve it?" },
      ],
      attemptCount: 0,
      maxAttempts: 3,
      followUpCount: 0,
    });
    expect(result.turnKind).toBe("PROBE");
    expect(result.finalShouldContinue).toBe(true);
    expect(result.finalResponse).toContain("?");
  });

  it("first-turn 'I don't know' → PROBE (not WRAP)", () => {
    const result = simulateVideoTurnDecisionChain({
      studentResponse: "I don't know",
      conversationHistory: [
        { role: "coach", message: "Let's solve 11 + 14. Can you explain how you'd solve it?" },
      ],
      attemptCount: 0,
      maxAttempts: 3,
      followUpCount: 0,
    });
    expect(result.turnKind).toBe("PROBE");
    expect(result.finalShouldContinue).toBe(true);
  });

  it("off-topic counter does not double-count when history excludes current turn", () => {
    // History with only the coach greeting — no student turns at all
    const history = [
      { role: "coach", message: "Let's solve 11 + 14." },
    ];
    const count = countOffTopicTurns(history, mathProblem);
    expect(count).toBe(0); // no student turns in history
  });

  it("off-topic counter WOULD double-count with old buggy history (defense check)", () => {
    // Simulates the old bug: history includes the current student turn
    const buggyHistory = [
      { role: "coach", message: "Let's solve 11 + 14." },
      { role: "student", message: "can I have a hint" },
    ];
    const count = countOffTopicTurns(buggyHistory, mathProblem);
    // "can I have a hint" is off-topic (no digits, no math vocab)
    expect(count).toBe(1);
    // With currentOffTopic=true, total would be 1+1=2 → off-topic exit
    // This confirms the double-count bug existed
    const currentOffTopic = isOffTopicResponse("can I have a hint", mathProblem);
    expect(currentOffTopic).toBe(true);
    expect(count + 1).toBe(2); // >= 2 threshold → would trigger WRAP
  });
});

describe("subtraction/reversal misconception: 'three' for 11+14", () => {
  // The student answers "three" for 11+14, likely confusing addition with
  // subtraction (14-11=3 or 4-1=3). This must be detected as SUBTRACTION_ON_ADDITION
  // and corrected with a misconception-aware redirect, not a generic re-ask.

  describe("misconception detection", () => {
    it("detectMisconceptionCategory('three', 3, mathProblem) → SUBTRACTION_ON_ADDITION", () => {
      const stepAcc = accumulateReasoningStepEvidence(
        reasoningSteps, [], "three", mathProblem.correctAnswer,
      );
      const category = detectMisconceptionCategory("three", 3, mathProblem, stepAcc);
      expect(category).toBe("SUBTRACTION_ON_ADDITION");
    });

    it("classifyStudentState('three') → 'misconception' (not 'wrong')", () => {
      const stepAcc = accumulateReasoningStepEvidence(
        reasoningSteps, [], "three", mathProblem.correctAnswer,
      );
      const state = classifyStudentState("three", stepAcc, mathProblem);
      expect(state).toBe("misconception");
    });

    it("detects '3' (digit) as SUBTRACTION_ON_ADDITION", () => {
      const stepAcc = accumulateReasoningStepEvidence(
        reasoningSteps, [], "3", mathProblem.correctAnswer,
      );
      const category = detectMisconceptionCategory("3", 3, mathProblem, stepAcc);
      expect(category).toBe("SUBTRACTION_ON_ADDITION");
    });

    it("detects numeric reversal for other addition problems", () => {
      const problem: MathProblem = {
        skill: "two_digit_addition",
        a: 23,
        b: 15,
        expression: "23 + 15",
        correctAnswer: 38,
        requiresRegrouping: false,
        expectedStrategyTags: ["add ones", "add tens"],
      };
      const stepAcc = accumulateReasoningStepEvidence(
        reasoningSteps, [], "8", problem.correctAnswer,
      );
      // 23 - 15 = 8 → subtraction reversal
      const category = detectMisconceptionCategory("8", 8, problem, stepAcc);
      expect(category).toBe("SUBTRACTION_ON_ADDITION");
    });
  });

  describe("A. Full-problem misconception: first turn 'three' for 11+14", () => {
    const result = simulateVideoTurnDecisionChain({
      studentResponse: "three",
      conversationHistory: [],
      attemptCount: 0,
      maxAttempts: 3,
      followUpCount: 0,
    });

    it("returns PROBE, not WRAP", () => {
      expect(result.turnKind).toBe("PROBE");
      expect(result.finalShouldContinue).toBe(true);
    });

    it("response explicitly redirects from subtraction to addition", () => {
      expect(result.finalResponse.toLowerCase()).toMatch(/add/);
      expect(result.finalResponse).toContain("?");
    });

    it("no generic praise", () => {
      expect(result.finalResponse.toLowerCase()).not.toMatch(/good\s+(start|thinking|job)/);
      expect(result.finalResponse.toLowerCase()).not.toMatch(/great/);
    });

    it("response stays on ones_sum step", () => {
      // The probe should reference the ones operands (1 and 4)
      expect(result.finalResponse).toMatch(/1.*4|4.*1/);
    });
  });

  describe("B. Sub-step misconception: 'three' after coach asks 'add 1 and 4'", () => {
    const result = simulateVideoTurnDecisionChain({
      studentResponse: "three",
      conversationHistory: [
        { role: "student", message: "twenty" },
        { role: "coach", message: "What do you get when you add 1 and 4?" },
      ],
      attemptCount: 1,
      maxAttempts: 3,
      followUpCount: 1,
    });

    it("returns PROBE, not WRAP", () => {
      expect(result.turnKind).toBe("PROBE");
      expect(result.finalShouldContinue).toBe(true);
    });

    it("response explicitly says add / not subtract", () => {
      expect(result.finalResponse.toLowerCase()).toMatch(/add/);
      expect(result.finalResponse).toContain("?");
    });

    it("response remains tied to ones_sum (1 and 4)", () => {
      expect(result.finalResponse).toMatch(/1.*4|4.*1/);
    });

    it("no 'keep exploring' or soft-close wording", () => {
      expect(result.finalResponse.toLowerCase()).not.toMatch(/keep exploring/);
      expect(result.finalResponse.toLowerCase()).not.toMatch(/move on/);
      expect(result.finalResponse.toLowerCase()).not.toMatch(/we'll come back/);
    });

    it("no praise-only response", () => {
      expect(result.finalResponse.toLowerCase()).not.toMatch(/^good\s/);
      expect(result.finalResponse.toLowerCase()).not.toMatch(/^great\s/);
      expect(result.finalResponse.toLowerCase()).not.toMatch(/^nice\s/);
    });
  });

  describe("C. Repeated misconception: 'three' again after misconception redirect", () => {
    const result = simulateVideoTurnDecisionChain({
      studentResponse: "three",
      conversationHistory: [
        { role: "student", message: "three" },
        { role: "coach", message: "We're adding in this problem, not subtracting. What do you get when you add 1 and 4?" },
      ],
      attemptCount: 2,
      maxAttempts: 3,
      followUpCount: 1,
    });

    it("still PROBE, not WRAP — even at max attempts", () => {
      expect(result.turnKind).toBe("PROBE");
      expect(result.finalShouldContinue).toBe(true);
    });

    it("still targets ones_sum with misconception redirect", () => {
      expect(result.finalResponse.toLowerCase()).toMatch(/add/);
      expect(result.finalResponse).toMatch(/1.*4|4.*1/);
      expect(result.finalResponse).toContain("?");
    });

    it("no wrap, no generic praise, no exploration", () => {
      expect(result.finalResponse.toLowerCase()).not.toMatch(/good\s+(start|thinking|job)/);
      expect(result.finalResponse.toLowerCase()).not.toMatch(/keep exploring/);
      expect(result.finalResponse.toLowerCase()).not.toMatch(/move on/);
      expect(result.finalResponse.toLowerCase()).not.toMatch(/thanks for trying/);
    });
  });

  describe("C2. Third attempt 'I think the answer is three' — escalation after repeated misconception", () => {
    const result = simulateVideoTurnDecisionChain({
      studentResponse: "I think the answer is three",
      conversationHistory: [
        { role: "student", message: "three" },
        { role: "coach", message: "We're adding in this problem, not subtracting. What do you get when you add 1 and 4?" },
        { role: "student", message: "three" },
        { role: "coach", message: "We're adding in this problem, not subtracting. What do you get when you add 1 and 4?" },
      ],
      attemptCount: 3,
      maxAttempts: 3,
      followUpCount: 2,
    });

    it("still continues — escalation overrides max-attempt wrap", () => {
      expect(result.finalShouldContinue).toBe(true);
    });

    it("escalates to modeled instruction instead of repeating misconception redirect", () => {
      // After 3 consecutive failures on the same step, the coach models the answer
      // instead of repeating "We're adding, not subtracting" a 3rd time
      expect(result.finalResponse).toContain("1 + 4 = 5");
      expect(result.debugTrace.some(t => t.includes("STEP_MODEL_INSTRUCTION"))).toBe(true);
    });
  });

  // ── Interrogative candidate answers ──────────────────────────────
  describe("interrogative candidate answers (question form)", () => {
    describe('"Is it three?" on 11+14 (first turn)', () => {
      const result = simulateVideoTurnDecisionChain({
        studentResponse: "Is it three?",
        conversationHistory: [],
        attemptCount: 0,
        maxAttempts: 3,
        followUpCount: 0,
      });

      it("extracts candidate answer 3", () => {
        expect(result.stepAccumulation!.extractedAnswer).toBe(3);
      });

      it("continues coaching (does not wrap)", () => {
        expect(result.finalShouldContinue).toBe(true);
        expect(result.turnKind).toBe("PROBE");
      });

      it("detects subtraction misconception and redirects", () => {
        expect(result.finalResponse.toLowerCase()).toContain("adding");
        expect(result.finalResponse).toContain("?");
      });

      it("does not use generic fallback language", () => {
        expect(result.finalResponse.toLowerCase()).not.toMatch(/i heard you/);
        expect(result.finalResponse.toLowerCase()).not.toMatch(/keep exploring/);
        expect(result.finalResponse.toLowerCase()).not.toMatch(/good start/);
        expect(result.finalResponse.toLowerCase()).not.toMatch(/big idea/);
      });
    });

    describe('"Is the answer three?" on 11+14', () => {
      const result = simulateVideoTurnDecisionChain({
        studentResponse: "Is the answer three?",
        conversationHistory: [],
        attemptCount: 0,
        maxAttempts: 3,
        followUpCount: 0,
      });

      it("same misconception detection as 'three'", () => {
        expect(result.finalShouldContinue).toBe(true);
        expect(result.finalResponse.toLowerCase()).toContain("adding");
      });
    });

    describe('"Could it be 3?" on 11+14', () => {
      const result = simulateVideoTurnDecisionChain({
        studentResponse: "Could it be 3?",
        conversationHistory: [],
        attemptCount: 0,
        maxAttempts: 3,
        followUpCount: 0,
      });

      it("same misconception detection from digit form", () => {
        expect(result.finalShouldContinue).toBe(true);
        expect(result.finalResponse.toLowerCase()).toContain("adding");
      });
    });

    describe('"So is it 25?" with ones and tens already satisfied', () => {
      const result = simulateVideoTurnDecisionChain({
        studentResponse: "So is it 25?",
        conversationHistory: [
          { role: "student", message: "1 plus 4 is 5" },
          { role: "coach", message: "Good. What do you get when you add 10 and 10?" },
          { role: "student", message: "10 plus 10 is 20" },
          { role: "coach", message: "Good. Now put them together." },
        ],
        attemptCount: 2,
        maxAttempts: 3,
        followUpCount: 2,
      });

      it("recognizes correct answer", () => {
        expect(result.mathAnswerCorrect).toBe(true);
      });

      it("wraps successfully (all steps + correct answer)", () => {
        expect(result.finalShouldContinue).toBe(false);
        expect(result.turnKind).toBe("WRAP");
      });
    });

    describe('interrogative wrong answer is never off-topic', () => {
      it('"Is it 3?" is not off-topic', () => {
        expect(isOffTopicResponse("Is it 3?", mathProblem)).toBe(false);
      });

      it('"Is it three?" is not off-topic', () => {
        expect(isOffTopicResponse("Is it three?", mathProblem)).toBe(false);
      });

      it('"Could it be 3?" is not off-topic', () => {
        expect(isOffTopicResponse("Could it be 3?", mathProblem)).toBe(false);
      });

      it('"Is the answer three?" is not off-topic', () => {
        expect(isOffTopicResponse("Is the answer three?", mathProblem)).toBe(false);
      });
    });

    // STT-noisy variants
    describe('STT-noisy interrogative variants', () => {
      describe('"is is it three" (STT stutter)', () => {
        const result = simulateVideoTurnDecisionChain({
          studentResponse: "is is it three",
          conversationHistory: [],
          attemptCount: 0,
          maxAttempts: 3,
          followUpCount: 0,
        });

        it("continues coaching — not wrapped", () => {
          expect(result.finalShouldContinue).toBe(true);
          expect(result.turnKind).toBe("PROBE");
        });

        it("detects subtraction misconception", () => {
          expect(result.finalResponse.toLowerCase()).toContain("adding");
          expect(result.finalResponse).toContain("?");
        });

        it("not off-topic", () => {
          expect(isOffTopicResponse("is is it three", mathProblem)).toBe(false);
        });
      });

      describe('"I still think the answer is three is it"', () => {
        const result = simulateVideoTurnDecisionChain({
          studentResponse: "I still think the answer is three is it",
          conversationHistory: [],
          attemptCount: 0,
          maxAttempts: 3,
          followUpCount: 0,
        });

        it("continues coaching with misconception redirect", () => {
          expect(result.finalShouldContinue).toBe(true);
          expect(result.finalResponse.toLowerCase()).toContain("adding");
        });

        it("not off-topic", () => {
          expect(isOffTopicResponse("I still think the answer is three is it", mathProblem)).toBe(false);
        });
      });

      describe('"oh is it five"', () => {
        const result = simulateVideoTurnDecisionChain({
          studentResponse: "oh is it five",
          conversationHistory: [],
          attemptCount: 0,
          maxAttempts: 3,
          followUpCount: 0,
        });

        it("continues coaching — wrong answer, not wrapped", () => {
          expect(result.finalShouldContinue).toBe(true);
          expect(result.turnKind).toBe("PROBE");
        });

        it("does not use generic fallback language", () => {
          expect(result.finalResponse.toLowerCase()).not.toMatch(/i heard you/);
          expect(result.finalResponse.toLowerCase()).not.toMatch(/keep exploring/);
        });

        it("not off-topic", () => {
          expect(isOffTopicResponse("oh is it five", mathProblem)).toBe(false);
        });
      });
    });

    // ── Wrong combine-step answer ────────────────────────────────
    describe('wrong combine-step answer "20 + 5 is 15"', () => {
      // 15 is a commonWrongAnswer → KNOWN_WRONG_ANSWER misconception → "Not quite. <probe>"
      const result = simulateVideoTurnDecisionChain({
        studentResponse: "20 + 5 is 15",
        conversationHistory: [
          { role: "student", message: "1 plus 4 is 5" },
          { role: "coach", message: "Good. What do you get when you add 10 and 10?" },
          { role: "student", message: "10 plus 10 is 20" },
          { role: "coach", message: "Now put them together. What is 20 plus 5?" },
        ],
        attemptCount: 2,
        maxAttempts: 3,
        followUpCount: 2,
      });

      it("continues coaching (does not wrap)", () => {
        expect(result.finalShouldContinue).toBe(true);
        expect(result.turnKind).toBe("PROBE");
      });

      it("includes a correction", () => {
        expect(result.finalResponse.toLowerCase()).toMatch(/not quite/i);
      });

      it("re-asks a question", () => {
        expect(result.finalResponse).toContain("?");
      });

      it("does not use generic fallback language", () => {
        expect(result.finalResponse.toLowerCase()).not.toMatch(/i heard you/);
        expect(result.finalResponse.toLowerCase()).not.toMatch(/keep exploring/);
      });
    });

    describe('wrong combine-step answer "30" (no misconception match)', () => {
      // 30 is NOT in commonWrongAnswers → "wrong" state → corrective combine prompt
      const result = simulateVideoTurnDecisionChain({
        studentResponse: "30",
        conversationHistory: [
          { role: "student", message: "1 plus 4 is 5" },
          { role: "coach", message: "Good. What do you get when you add 10 and 10?" },
          { role: "student", message: "10 plus 10 is 20" },
          { role: "coach", message: "Now put them together. What is 20 plus 5?" },
        ],
        attemptCount: 2,
        maxAttempts: 3,
        followUpCount: 2,
      });

      it("continues coaching", () => {
        expect(result.finalShouldContinue).toBe(true);
      });

      it("names the wrong answer", () => {
        expect(result.finalResponse).toContain("30");
      });

      it("includes correction and re-asks", () => {
        expect(result.finalResponse.toLowerCase()).toMatch(/not quite|not right/i);
        expect(result.finalResponse).toContain("?");
      });
    });

    // ── Dedup regression: statement forms with number words ───────
    describe('dedup regression: containsMathContent catches all candidate-answer forms', () => {
      // These verify that the student text is recognized as math content,
      // which prevents the dedup from replacing the server's response.
      // The actual dedup logic lives in VideoConversationRecorder and uses
      // containsMathContent + isInterrogativeMathAnswer from the state machine.

      it('"is the answer three" is not off-topic', () => {
        expect(isOffTopicResponse("is the answer three", mathProblem)).toBe(false);
      });

      it('"I think the answer is three" is not off-topic', () => {
        expect(isOffTopicResponse("I think the answer is three", mathProblem)).toBe(false);
      });

      it('"I think the answer is three is that right" is not off-topic', () => {
        expect(isOffTopicResponse("I think the answer is three is that right", mathProblem)).toBe(false);
      });
    });
  });

  // ============================================================================
  // Instructional recap: misconception → uncertainty/max-attempt wrap
  // ============================================================================

  describe("instructional recap on misconception wrap", () => {
    it("repeated misconception → 'I don't know' → supportive instructional wrap", () => {
      // Student subtracted twice (misconception), then says "I don't know"
      // At max attempts, anti-wrap guards don't fire, so wrap goes through
      // But the wrap should include instructional recap, not generic close
      const result = simulateVideoTurnDecisionChain({
        studentResponse: "I don't know",
        conversationHistory: [
          { role: "student", message: "I subtracted and got 3" },
          { role: "coach", message: "We're adding in this problem, not subtracting. What do you get when you add 1 and 4?" },
          { role: "student", message: "I took away 11 from 14 and got 3" },
          { role: "coach", message: "We're adding in this problem, not subtracting. What do you get when you add 1 and 4?" },
        ],
        attemptCount: 4,
        maxAttempts: 5,
        followUpCount: 4,
        timeRemainingSec: 10, // inside closing window → forces wrap
      });

      // Should be a WRAP (not continuing)
      expect(result.turnKind).toBe("WRAP");
      expect(result.finalShouldContinue).toBe(false);

      // Should contain instructional recap, not generic "Thanks for trying"
      expect(result.finalResponse).toContain("addition problem, not subtraction");
      expect(result.finalResponse).toContain("1 + 4 = 5");
      expect(result.finalResponse).toContain("10 + 10 = 20");
      expect(result.finalResponse).toContain("20 + 5 = 25");
      expect(result.finalResponse).toContain("You're getting closer!");
      expect(result.finalResponse).not.toContain("Thanks for trying");

      // Debug trace should show instructional recap fired
      expect(result.debugTrace.some(t => t.includes("instructional-recap"))).toBe(true);
    });

    it("misconception → max attempts → supportive instructional wrap (not generic)", () => {
      // Student gave ones-only confusion (5 for 11+14), then at max attempts gives wrong answer again
      // The misconception anti-wrap guard fires for the current misconception,
      // so we simulate the case where the student's CURRENT response is uncertain
      // but a PRIOR response had the misconception
      const result = simulateVideoTurnDecisionChain({
        studentResponse: "I just don't know",
        conversationHistory: [
          { role: "student", message: "five" },  // ONES_ONLY_CONFUSION
          { role: "coach", message: "You found the ones part. Now let's add the tens. What do you get when you add 10 and 10?" },
          { role: "student", message: "I'm not sure" },
          { role: "coach", message: "Let's do just the tens. What is 10 + 10?" },
        ],
        attemptCount: 4,
        maxAttempts: 5,
        followUpCount: 4,
        timeRemainingSec: 10,
      });

      expect(result.turnKind).toBe("WRAP");
      expect(result.finalShouldContinue).toBe(false);

      // Should contain instructional recap with ones+tens correction
      expect(result.finalResponse).toContain("both the ones and the tens");
      expect(result.finalResponse).toContain("1 + 4 = 5");
      expect(result.finalResponse).toContain("10 + 10 = 20");
      expect(result.finalResponse).toContain("You're getting closer!");
      expect(result.finalResponse).not.toContain("Thanks for trying");
    });

    it("no misconception in history → generic wrap (no instructional recap)", () => {
      // Student never showed a misconception, just said "I don't know" repeatedly
      const result = simulateVideoTurnDecisionChain({
        studentResponse: "I just don't know",
        conversationHistory: [
          { role: "student", message: "I don't know" },
          { role: "coach", message: "Let's do just the ones. What is 1 + 4?" },
          { role: "student", message: "I'm not sure" },
          { role: "coach", message: "Let's do just the ones. What is 1 + 4?" },
        ],
        attemptCount: 4,
        maxAttempts: 5,
        followUpCount: 4,
        timeRemainingSec: 10,
      });

      expect(result.turnKind).toBe("WRAP");
      // No misconception detected → no instructional recap
      expect(result.debugTrace.some(t => t.includes("instructional-recap"))).toBe(false);
    });

    it("misconception wrap does NOT contain UI leakage", () => {
      const result = simulateVideoTurnDecisionChain({
        studentResponse: "I give up",
        conversationHistory: [
          { role: "student", message: "I subtracted and got 3" },
          { role: "coach", message: "We're adding, not subtracting. What is 1 + 4?" },
        ],
        attemptCount: 4,
        maxAttempts: 5,
        followUpCount: 4,
        timeRemainingSec: 10,
      });

      expect(result.turnKind).toBe("WRAP");
      expect(result.finalResponse).not.toContain("Please click Submit Response.");
      expect(result.finalResponse).not.toContain("click");
      expect(result.finalResponse).toContain("You're getting closer!");
    });
  });

  // ============================================================================
  // instructionalRecap returned for client-side probing_cutoff wraps
  // ============================================================================

  describe("instructionalRecap for client-side wraps", () => {
    it("persistent misconception + probing turn → instructionalRecap included", () => {
      // Student is still being probed (shouldContinue=true), but the server
      // returns instructionalRecap so the client can use it if probing_cutoff fires
      const result = simulateVideoTurnDecisionChain({
        studentResponse: "three",
        conversationHistory: [
          { role: "student", message: "I subtracted and got 3" },
          { role: "coach", message: "We're adding, not subtracting. What is 1 + 4?" },
        ],
        attemptCount: 1,
        maxAttempts: 5,
        followUpCount: 1,
        timeRemainingSec: 60, // plenty of time — still probing
      });

      // The turn continues (misconception redirect), but instructionalRecap is present
      expect(result.finalShouldContinue).toBe(true);
      expect(result.instructionalRecap).toBeDefined();
      expect(result.instructionalRecap).toContain("addition problem, not subtraction");
      expect(result.instructionalRecap).toContain("1 + 4 = 5");
      expect(result.instructionalRecap).toContain("10 + 10 = 20");
      expect(result.instructionalRecap).toContain("20 + 5 = 25");
    });

    it("no misconception → no instructionalRecap", () => {
      const result = simulateVideoTurnDecisionChain({
        studentResponse: "I don't know",
        conversationHistory: [
          { role: "student", message: "I'm not sure" },
          { role: "coach", message: "Let's do just the ones. What is 1 + 4?" },
        ],
        attemptCount: 1,
        maxAttempts: 5,
        followUpCount: 1,
        timeRemainingSec: 60,
      });

      expect(result.instructionalRecap).toBeUndefined();
    });

    it("misconception in prior turn + current uncertainty → instructionalRecap for client wrap", () => {
      // The student showed subtraction misconception before, now says "I don't know"
      // Server continues (anti-wrap), but instructionalRecap is provided for client
      const result = simulateVideoTurnDecisionChain({
        studentResponse: "I don't know",
        conversationHistory: [
          { role: "student", message: "I subtracted and got 3" },
          { role: "coach", message: "We're adding, not subtracting. What is 1 + 4?" },
        ],
        attemptCount: 1,
        maxAttempts: 5,
        followUpCount: 1,
        timeRemainingSec: 60,
      });

      expect(result.instructionalRecap).toBeDefined();
      expect(result.instructionalRecap).toContain("addition problem, not subtraction");
      expect(result.instructionalRecap).toContain("Here's how it works");
    });

    it("all steps satisfied → no instructionalRecap (mastery, no missing steps)", () => {
      const result = simulateVideoTurnDecisionChain({
        studentResponse: "1 + 4 is 5, 10 + 10 is 20, and 20 + 5 is 25",
        conversationHistory: [],
        attemptCount: 0,
        maxAttempts: 5,
        followUpCount: 0,
        timeRemainingSec: 60,
      });

      // No missing steps → no recap needed
      expect(result.instructionalRecap).toBeUndefined();
    });

    it("persistent step failure (no misconception) → step-specific instructionalRecap", () => {
      // Student got ones right but failed tens twice — no named misconception
      const result = simulateVideoTurnDecisionChain({
        studentResponse: "50",
        conversationHistory: [
          { role: "student", message: "1 plus 4 is 5" },
          { role: "coach", message: "Good. What do you get when you add 10 and 10?" },
          { role: "student", message: "30" },
          { role: "coach", message: "What do you get when you add 10 and 10?" },
          { role: "student", message: "40" },
          { role: "coach", message: "What do you get when you add 10 and 10?" },
        ],
        attemptCount: 3,
        maxAttempts: 5,
        followUpCount: 3,
        timeRemainingSec: 60,
      });

      // Should have step-specific recap
      expect(result.instructionalRecap).toBeDefined();
      expect(result.instructionalRecap).toContain("add the tens");
      expect(result.instructionalRecap).toContain("10 + 10 = 20");
    });
  });

  // ============================================================================
  // Repeated wrong answers on same step: escalation + wrap
  // ============================================================================

  describe("repeated step failure escalation", () => {
    it("escalates from repeated probe to modeled instruction after 2 failures", () => {
      // Student got ones right, then failed tens twice
      const result = simulateVideoTurnDecisionChain({
        studentResponse: "50",
        conversationHistory: [
          { role: "student", message: "1 plus 4 is 5" },
          { role: "coach", message: "Good. What do you get when you add 10 and 10?" },
          { role: "student", message: "30" },
          { role: "coach", message: "What do you get when you add 10 and 10?" },
          { role: "student", message: "40" },
          { role: "coach", message: "What do you get when you add 10 and 10?" },
        ],
        attemptCount: 3,
        maxAttempts: 5,
        followUpCount: 3,
        timeRemainingSec: 60,
      });

      // Should still be coaching (not wrapping yet)
      expect(result.finalShouldContinue).toBe(true);
      // Should have escalated to modeled instruction
      expect(result.finalResponse).toContain("10 + 10 = 20");
      // Should probe the next step (combine)
      expect(result.finalResponse).toContain("?");
    });

    it("probing_cutoff wrap after step failure uses step-specific recap", () => {
      // Student repeatedly failed tens, then time runs out
      const result = simulateVideoTurnDecisionChain({
        studentResponse: "50",
        conversationHistory: [
          { role: "student", message: "1 plus 4 is 5" },
          { role: "coach", message: "Good. What do you get when you add 10 and 10?" },
          { role: "student", message: "30" },
          { role: "coach", message: "What do you get when you add 10 and 10?" },
          { role: "student", message: "40" },
          { role: "coach", message: "What do you get when you add 10 and 10?" },
        ],
        attemptCount: 4,
        maxAttempts: 5,
        followUpCount: 4,
        timeRemainingSec: 10, // closing window — forces wrap
      });

      expect(result.turnKind).toBe("WRAP");
      expect(result.finalShouldContinue).toBe(false);
      // Wrap should include step-specific recap, not generic close
      expect(result.finalResponse).toContain("add the tens");
      expect(result.finalResponse).toContain("10 + 10 = 20");
      expect(result.finalResponse).toContain("You're getting closer!");
      expect(result.finalResponse).not.toContain("Thanks for trying");
    });

    it("escalates through misconception path after repeated subtraction-on-addition", () => {
      // Live transcript: student keeps using subtraction on 14+11
      const result = simulateVideoTurnDecisionChain({
        studentResponse: "14 minus 11 is 3",
        conversationHistory: [
          { role: "coach", message: "What is 11 + 14?" },
          { role: "student", message: "4 minus 1 is 3" },
          { role: "coach", message: "We're adding in this problem, not subtracting. What do you get when you add 4 and 1?" },
          { role: "student", message: "I think the answer is three" },
          { role: "coach", message: "We're adding in this problem, not subtracting. What do you get when you add 4 and 1?" },
        ],
        attemptCount: 3,
        maxAttempts: 5,
        followUpCount: 3,
        timeRemainingSec: 60,
      });

      expect(result.finalShouldContinue).toBe(true);
      // Should escalate to modeled instruction, not repeat misconception redirect
      expect(result.finalResponse).toContain("1 + 4 = 5");
      expect(result.debugTrace.some(t => t.includes("STEP_MODEL_INSTRUCTION"))).toBe(true);
    });

    it("no repeated step failure → no escalation, generic close if wrapping", () => {
      // Student only failed once on tens step
      const result = simulateVideoTurnDecisionChain({
        studentResponse: "I don't know",
        conversationHistory: [
          { role: "student", message: "I'm not sure" },
          { role: "coach", message: "Let's do just the ones. What is 1 + 4?" },
        ],
        attemptCount: 4,
        maxAttempts: 5,
        followUpCount: 4,
        timeRemainingSec: 10,
      });

      expect(result.turnKind).toBe("WRAP");
      // No step failure pattern → no step recap
      expect(result.debugTrace.some(t => t.includes("step-failure"))).toBe(false);
    });
  });
});

// ============================================================================
// completionRatio pipeline regression tests
// ============================================================================

describe("completionRatio tracks progress across turns", () => {
  it("completionRatio > 0 after ones satisfied", () => {
    const result = simulateVideoTurnDecisionChain({
      studentResponse: "five",
      conversationHistory: [
        { role: "coach", message: "What do you get when you add 1 and 4?" },
      ],
      attemptCount: 1,
      maxAttempts: 5,
      followUpCount: 1,
    });
    expect(result.completionRatio).toBeGreaterThan(0);
    expect(result.stepAccumulation!.satisfiedStepIds).toContain("step_1");
  });

  it("completionRatio >= 0.66 after ones + tens satisfied", () => {
    const result = simulateVideoTurnDecisionChain({
      studentResponse: "20",
      conversationHistory: [
        { role: "coach", message: "What do you get when you add 1 and 4?" },
        { role: "student", message: "five" },
        { role: "coach", message: "Great! What do you get when you add 10 and 10?" },
      ],
      attemptCount: 2,
      maxAttempts: 5,
      followUpCount: 2,
    });
    expect(result.completionRatio).toBeGreaterThanOrEqual(0.66);
    expect(result.stepAccumulation!.satisfiedStepIds).toContain("step_1");
    expect(result.stepAccumulation!.satisfiedStepIds).toContain("step_2");
  });

  it("concept-confusion path preserves prior step progress in completionRatio", () => {
    // Student correctly answered ones, then asks a concept question
    const result = simulateVideoTurnDecisionChain({
      studentResponse: "Where did you get the 10 and 10?",
      conversationHistory: [
        { role: "student", message: "1 plus 4 is 5" },
        { role: "coach", message: "Good. What do you get when you add 10 and 10?" },
      ],
      attemptCount: 2,
      maxAttempts: 5,
      followUpCount: 2,
    });
    // Ones step should still be satisfied even though current response is concept confusion
    expect(result.completionRatio).toBeGreaterThan(0);
    expect(result.stepAccumulation!.satisfiedStepIds).toContain("step_1");
  });

  it("completionRatio >= 0.66 on combine probe turn after concept explanation", () => {
    // Full late-stage scenario: student has ones+tens, coach asks combine
    const result = simulateVideoTurnDecisionChain({
      studentResponse: "What does that have to do with the problem?",
      conversationHistory: [
        { role: "student", message: "the ones is 4 and 1 so thats 5" },
        { role: "coach", message: "Great! What do you get when you add 10 and 10?" },
        { role: "student", message: "Where did you get 10 and 10?" },
        { role: "coach", message: "In 14 the tens part is 10, in 11 it's 10. What do you get when you add 10 and 10?" },
        { role: "student", message: "20" },
        { role: "coach", message: "Now put them together. What is 20 plus 5?" },
      ],
      attemptCount: 5,
      maxAttempts: 8,
      followUpCount: 5,
    });
    // Both ones and tens should be satisfied
    expect(result.completionRatio).toBeGreaterThanOrEqual(0.66);
    expect(result.stepAccumulation!.satisfiedStepIds).toContain("step_1");
    expect(result.stepAccumulation!.satisfiedStepIds).toContain("step_2");
    // Should continue — concept confusion, not wrap
    expect(result.finalShouldContinue).toBe(true);
  });

  it("exact live transcript: student gets one more turn after coach asks combine", () => {
    // This reproduces the exact failure: student has ones+tens evidence,
    // coach asks combine question, then student gets confused.
    // The completionRatio must be >= 0.66 so leniency activates.

    // Turn 1: student answers ones
    const turn1 = simulateVideoTurnDecisionChain({
      studentResponse: "five",
      conversationHistory: [
        { role: "coach", message: "What do you get when you add 1 and 4?" },
      ],
      attemptCount: 1,
      maxAttempts: 5,
      followUpCount: 1,
    });
    expect(turn1.completionRatio).toBeGreaterThan(0);

    // Turn 2: student asks concept question about tens
    const turn2 = simulateVideoTurnDecisionChain({
      studentResponse: "Where did you get 10 and 10?",
      conversationHistory: [
        { role: "coach", message: "What do you get when you add 1 and 4?" },
        { role: "student", message: "five" },
        { role: "coach", message: "Great! What do you get when you add 10 and 10?" },
      ],
      attemptCount: 2,
      maxAttempts: 5,
      followUpCount: 2,
    });
    // Ones still satisfied
    expect(turn2.completionRatio).toBeGreaterThan(0);

    // Turn 3: student says "20" for tens
    const turn3 = simulateVideoTurnDecisionChain({
      studentResponse: "20",
      conversationHistory: [
        { role: "coach", message: "What do you get when you add 1 and 4?" },
        { role: "student", message: "five" },
        { role: "coach", message: "Great! What do you get when you add 10 and 10?" },
        { role: "student", message: "Where did you get 10 and 10?" },
        { role: "coach", message: "In 14 the tens part is 10, in 11 it's 10. What do you get when you add 10 and 10?" },
      ],
      attemptCount: 3,
      maxAttempts: 5,
      followUpCount: 3,
    });
    expect(turn3.completionRatio).toBeGreaterThanOrEqual(0.66);
    expect(turn3.stepAccumulation!.satisfiedStepIds).toContain("step_1");
    expect(turn3.stepAccumulation!.satisfiedStepIds).toContain("step_2");

    // Turn 4: student asks structure question on combine step
    const turn4 = simulateVideoTurnDecisionChain({
      studentResponse: "What does that have to do with the problem?",
      conversationHistory: [
        { role: "coach", message: "What do you get when you add 1 and 4?" },
        { role: "student", message: "five" },
        { role: "coach", message: "Great! What do you get when you add 10 and 10?" },
        { role: "student", message: "Where did you get 10 and 10?" },
        { role: "coach", message: "In 14 the tens part is 10, in 11 it's 10. What do you get when you add 10 and 10?" },
        { role: "student", message: "20" },
        { role: "coach", message: "Now put them together. What is 20 plus 5?" },
      ],
      attemptCount: 4,
      maxAttempts: 5,
      followUpCount: 4,
    });
    // Critical: completionRatio must still reflect 2/3 progress
    expect(turn4.completionRatio).toBeGreaterThanOrEqual(0.66);
    // Should continue — student asked a question, not wrapping
    expect(turn4.finalShouldContinue).toBe(true);
  });
});

describe("late combine leniency: completionRatio drives wrap decision", () => {
  it("completionRatio >= 0.66 after ones+tens → client has data for leniency", () => {
    // After the live transcript, completionRatio must be >= 0.66
    // so the client can reduce the probing cutoff buffer from 30s to 15s.
    const result = simulateVideoTurnDecisionChain({
      studentResponse: "20",
      conversationHistory: [
        { role: "coach", message: "What do you get when you add 1 and 4?" },
        { role: "student", message: "five" },
        { role: "coach", message: "Great! What do you get when you add 10 and 10?" },
      ],
      attemptCount: 2,
      maxAttempts: 5,
      followUpCount: 2,
    });

    // The key assertion: completionRatio is high enough for leniency
    expect(result.completionRatio).toBeGreaterThanOrEqual(0.66);
    // And the response continues (probes combine step)
    expect(result.finalShouldContinue).toBe(true);
  });

  it("completionRatio=0 would deny leniency (documents the bug)", () => {
    // This documents what happens when completionRatio is broken (always 0):
    // the client uses the full 30s buffer, cutting off the student.
    // With the fix, completionRatio is correct so the 15s buffer applies.
    const result = simulateVideoTurnDecisionChain({
      studentResponse: "What does that have to do with the problem?",
      conversationHistory: [
        { role: "coach", message: "What do you get when you add 1 and 4?" },
        { role: "student", message: "five" },
        { role: "coach", message: "Great! What do you get when you add 10 and 10?" },
        { role: "student", message: "20" },
        { role: "coach", message: "Now put them together. What is 20 plus 5?" },
      ],
      attemptCount: 3,
      maxAttempts: 5,
      followUpCount: 3,
    });

    // With the fix: completionRatio reflects real progress
    expect(result.completionRatio).toBeGreaterThanOrEqual(0.66);
    // Without the fix, this would be 0 and leniency would never activate
  });
});

// ============================================================================
// Mixed utterance and alternate strategy regression tests
// ============================================================================

describe("mixed utterances preserve step evidence", () => {
  it("ones evidence preserved when student also asks a question in same turn", () => {
    // Live failure: "4 + 1 is 5 what does that have to do with this problem"
    const result = simulateVideoTurnDecisionChain({
      studentResponse: "4 + 1 is 5 what does that have to do with this problem",
      conversationHistory: [
        { role: "coach", message: "What do you get when you add 1 and 4?" },
      ],
      attemptCount: 1,
      maxAttempts: 5,
      followUpCount: 1,
    });
    expect(result.stepAccumulation!.satisfiedStepIds).toContain("step_1");
    expect(result.completionRatio).toBeGreaterThan(0);
    // Should continue — student asked a question
    expect(result.finalShouldContinue).toBe(true);
  });

  it("final answer evidence preserved in mixed utterance", () => {
    // "I'm the final answer is 25" — should recognize 25 as the answer
    const result = simulateVideoTurnDecisionChain({
      studentResponse: "I'm the final answer is 25",
      conversationHistory: [
        { role: "coach", message: "What do you get when you combine 20 and 5?" },
      ],
      attemptCount: 1,
      maxAttempts: 5,
      followUpCount: 1,
    });
    expect(result.mathAnswerCorrect).toBe(true);
    expect(result.stepAccumulation!.satisfiedStepIds).toContain("step_3");
    expect(result.completionRatio).toBeGreaterThan(0);
  });
});

describe("alternate strategy recognition", () => {
  it("alternate decomposition (14+10=24, +1=25) counts as near-success", () => {
    const result = simulateVideoTurnDecisionChain({
      studentResponse: "14 + 10 = 24 and then plus 1 = 25",
      conversationHistory: [
        { role: "coach", message: "How did you solve 11 + 14?" },
      ],
      attemptCount: 1,
      maxAttempts: 5,
      followUpCount: 1,
    });
    expect(result.mathAnswerCorrect).toBe(true);
    // Alternate strategy must boost completionRatio to >= 0.66
    expect(result.completionRatio).toBeGreaterThanOrEqual(0.66);
  });

  it("verbose alternate strategy is recognized", () => {
    const result = simulateVideoTurnDecisionChain({
      studentResponse: "well so I did 14 + 10 and that is 24 and then I had one left over and I get 25",
      conversationHistory: [
        { role: "coach", message: "Can you explain how you solved it?" },
      ],
      attemptCount: 1,
      maxAttempts: 5,
      followUpCount: 1,
    });
    expect(result.mathAnswerCorrect).toBe(true);
    expect(result.completionRatio).toBeGreaterThanOrEqual(0.66);
  });

  it("alternate strategy does NOT fire without correct answer", () => {
    // Student shows work but wrong answer — should not boost
    const result = simulateVideoTurnDecisionChain({
      studentResponse: "14 + 10 = 24 and then plus 2 = 26",
      conversationHistory: [
        { role: "coach", message: "How did you solve 11 + 14?" },
      ],
      attemptCount: 1,
      maxAttempts: 5,
      followUpCount: 1,
    });
    expect(result.mathAnswerCorrect).toBe(false);
    // No boost — wrong answer
    expect(result.completionRatio).toBeLessThan(0.66);
  });
});

describe("live regression: student 1 full transcript", () => {
  // Student says "4+1 is 5, what does that have to do with this problem",
  // later "20", coach asks combine, student says "is it 25"
  it("completionRatio reaches >= 0.66 before combine and student gets the turn", () => {
    // Turn 1: mixed utterance with ones evidence
    const turn1 = simulateVideoTurnDecisionChain({
      studentResponse: "4 + 1 is 5 what does that have to do with this problem",
      conversationHistory: [
        { role: "coach", message: "What do you get when you add 1 and 4?" },
      ],
      attemptCount: 1,
      maxAttempts: 5,
      followUpCount: 1,
    });
    expect(turn1.stepAccumulation!.satisfiedStepIds).toContain("step_1");
    expect(turn1.completionRatio).toBeGreaterThan(0);

    // Turn 2: student says "20" for tens
    const turn2 = simulateVideoTurnDecisionChain({
      studentResponse: "20",
      conversationHistory: [
        { role: "coach", message: "What do you get when you add 1 and 4?" },
        { role: "student", message: "4 + 1 is 5 what does that have to do with this problem" },
        { role: "coach", message: "What do you get when you add 10 and 10?" },
      ],
      attemptCount: 2,
      maxAttempts: 5,
      followUpCount: 2,
    });
    expect(turn2.stepAccumulation!.satisfiedStepIds).toContain("step_1");
    expect(turn2.stepAccumulation!.satisfiedStepIds).toContain("step_2");
    expect(turn2.completionRatio).toBeGreaterThanOrEqual(0.66);

    // Turn 3: student says "is it 25" on combine
    const turn3 = simulateVideoTurnDecisionChain({
      studentResponse: "is it 25",
      conversationHistory: [
        { role: "coach", message: "What do you get when you add 1 and 4?" },
        { role: "student", message: "4 + 1 is 5 what does that have to do with this problem" },
        { role: "coach", message: "What do you get when you add 10 and 10?" },
        { role: "student", message: "20" },
        { role: "coach", message: "What do you get when you combine 20 and 5?" },
      ],
      attemptCount: 3,
      maxAttempts: 5,
      followUpCount: 3,
    });
    // All steps should be satisfied
    expect(turn3.stepAccumulation!.satisfiedStepIds).toContain("step_1");
    expect(turn3.stepAccumulation!.satisfiedStepIds).toContain("step_2");
    expect(turn3.stepAccumulation!.satisfiedStepIds).toContain("step_3");
    expect(turn3.completionRatio).toBe(1);
  });
});

describe("live regression: student 2 alternate strategy", () => {
  it("alternate strategy is not discarded — completionRatio reflects near-success", () => {
    // Student demonstrates valid alternate strategy
    const result = simulateVideoTurnDecisionChain({
      studentResponse: "well so I did 14 + 10 and that is 24 and then I had one left over and I get 25",
      conversationHistory: [
        { role: "coach", message: "Can you explain how you solved 11 + 14?" },
      ],
      attemptCount: 1,
      maxAttempts: 5,
      followUpCount: 1,
    });
    expect(result.mathAnswerCorrect).toBe(true);
    // Must be non-zero — alternate strategy recognized
    expect(result.completionRatio).toBeGreaterThanOrEqual(0.66);
    // Alternate strategy with explicit work → accepted as success (WRAP)
    expect(result.finalShouldContinue).toBe(false);
    expect(result.turnKind).toBe("WRAP");
  });

  it("alternate strategy student is not forced back to canonical ones probe", () => {
    // After alternate strategy, the system should not ask "What is 1 + 4?"
    const result = simulateVideoTurnDecisionChain({
      studentResponse: "well so I did 14 + 10 and that is 24 and then I had one left over and I get 25",
      conversationHistory: [
        { role: "coach", message: "Can you explain how you solved 11 + 14?" },
      ],
      attemptCount: 1,
      maxAttempts: 5,
      followUpCount: 1,
    });
    // The response should acknowledge progress, not regress to step 1
    // It can probe for remaining canonical steps, but the completionRatio
    // must reflect the student is near-done
    expect(result.completionRatio).toBeGreaterThanOrEqual(0.66);
  });
});

// ============================================================================
// Flexible reasoning validation: instructionalCoverage vs successEvidence
// ============================================================================

describe("alternate strategy accepted immediately (no canonical regression)", () => {
  it("split-one-addend: 14 + 10 = 24, then +1 = 25 → WRAP_SUCCESS", () => {
    const result = simulateVideoTurnDecisionChain({
      studentResponse: "14 + 10 = 24 and then plus 1 = 25",
      conversationHistory: [
        { role: "coach", message: "How did you solve 11 + 14?" },
      ],
      attemptCount: 1,
      maxAttempts: 5,
      followUpCount: 1,
    });
    expect(result.mathAnswerCorrect).toBe(true);
    expect(result.stepAccumulation!.alternateStrategyDetected).toBe(true);
    // Must WRAP with success, not probe for canonical steps
    expect(result.finalShouldContinue).toBe(false);
    expect(result.turnKind).toBe("WRAP");
  });

  it("split-other-addend: 11 + 10 = 21, then +4 = 25 → WRAP_SUCCESS", () => {
    const result = simulateVideoTurnDecisionChain({
      studentResponse: "11 + 10 = 21, then 21 + 4 = 25",
      conversationHistory: [
        { role: "coach", message: "How did you solve 11 + 14?" },
      ],
      attemptCount: 1,
      maxAttempts: 5,
      followUpCount: 1,
    });
    expect(result.mathAnswerCorrect).toBe(true);
    expect(result.stepAccumulation!.alternateStrategyDetected).toBe(true);
    expect(result.finalShouldContinue).toBe(false);
    expect(result.turnKind).toBe("WRAP");
  });

  it("bridge-to-friendly-number: 14 + 1 = 15, then +10 = 25 → WRAP_SUCCESS", () => {
    const result = simulateVideoTurnDecisionChain({
      studentResponse: "14 + 1 = 15 and 15 + 10 = 25",
      conversationHistory: [
        { role: "coach", message: "How did you solve 11 + 14?" },
      ],
      attemptCount: 1,
      maxAttempts: 5,
      followUpCount: 1,
    });
    expect(result.mathAnswerCorrect).toBe(true);
    expect(result.stepAccumulation!.alternateStrategyDetected).toBe(true);
    expect(result.finalShouldContinue).toBe(false);
    expect(result.turnKind).toBe("WRAP");
  });
});

describe("alternate strategy with explicit explanation → WRAP_SUCCESS", () => {
  it("student explains splitting: 'I split 11 into 10 and 1, added 10 to 14...'", () => {
    const result = simulateVideoTurnDecisionChain({
      studentResponse: "I split 11 into 10 and 1, then added 10 to 14 to get 24, then 1 more is 25",
      conversationHistory: [
        { role: "coach", message: "Can you explain how you solved it?" },
      ],
      attemptCount: 1,
      maxAttempts: 5,
      followUpCount: 1,
    });
    expect(result.mathAnswerCorrect).toBe(true);
    expect(result.stepAccumulation!.alternateStrategyDetected).toBe(true);
    expect(result.finalShouldContinue).toBe(false);
    expect(result.turnKind).toBe("WRAP");
  });
});

describe("alternate strategy + follow-up frustration: no canonical regression", () => {
  it("after valid alternate strategy, student frustrated about canonical probe", () => {
    // Student already showed alternate strategy, then coach (wrongly in old system)
    // asked canonical question, student is frustrated
    const result = simulateVideoTurnDecisionChain({
      studentResponse: "I already answered it my way, but 4 and 1 is 5",
      conversationHistory: [
        { role: "coach", message: "How did you solve 11 + 14?" },
        { role: "student", message: "14 + 10 = 24 and then plus 1 = 25" },
        { role: "coach", message: "What do you get when you add 1 and 4?" },
      ],
      attemptCount: 2,
      maxAttempts: 5,
      followUpCount: 2,
    });
    // Prior alternate strategy evidence carries forward — should not stay stuck
    expect(result.stepAccumulation!.alternateStrategyDetected).toBe(true);
    // Should wrap with success since the alternate strategy was already sufficient
    expect(result.finalShouldContinue).toBe(false);
    expect(result.turnKind).toBe("WRAP");
  });
});

describe("partially correct alternate strategy gets clarification, not regression", () => {
  it("'14 + 10 = 24 and then 25' → ask how, don't ask 'What is 4+1?'", () => {
    const result = simulateVideoTurnDecisionChain({
      studentResponse: "14 + 10 = 24 and then 25",
      conversationHistory: [
        { role: "coach", message: "How did you solve 11 + 14?" },
      ],
      attemptCount: 1,
      maxAttempts: 5,
      followUpCount: 1,
    });
    // Answer is correct (25 present), has some work (24), but chain is incomplete
    // (24 + ? = 25 is implicit). Check that the response is about clarifying
    // the gap, NOT regressing to canonical ones step.
    expect(result.mathAnswerCorrect).toBe(true);
    // The response should NOT ask about the canonical ones step
    expect(result.finalResponse.toLowerCase()).not.toMatch(/what do you get when you add 1 and 4/);
    expect(result.finalResponse.toLowerCase()).not.toMatch(/what is 1 \+ 4/);
  });
});

describe("wrong alternate strategy is not accepted", () => {
  it("'14 + 10 = 23 and then +1 = 24' → remediation, not success", () => {
    const result = simulateVideoTurnDecisionChain({
      studentResponse: "14 + 10 = 23 and then +1 = 24",
      conversationHistory: [
        { role: "coach", message: "How did you solve 11 + 14?" },
      ],
      attemptCount: 1,
      maxAttempts: 5,
      followUpCount: 1,
    });
    // Wrong arithmetic → no alternate strategy
    expect(result.mathAnswerCorrect).toBe(false);
    expect(result.stepAccumulation!.alternateStrategyDetected).toBe(false);
    // Must continue coaching
    expect(result.finalShouldContinue).toBe(true);
  });
});

describe("canonical path still passes (no regression)", () => {
  it("standard ones → tens → combine path still reaches WRAP_SUCCESS", () => {
    // Turn 1: ones
    const turn1 = simulateVideoTurnDecisionChain({
      studentResponse: "1 + 4 = 5",
      conversationHistory: [
        { role: "coach", message: "What do you get when you add 1 and 4?" },
      ],
      attemptCount: 1,
      maxAttempts: 5,
      followUpCount: 1,
    });
    expect(turn1.stepAccumulation!.satisfiedStepIds).toContain("step_1");
    expect(turn1.finalShouldContinue).toBe(true);

    // Turn 2: tens
    const turn2 = simulateVideoTurnDecisionChain({
      studentResponse: "10 + 10 = 20",
      conversationHistory: [
        { role: "coach", message: "What do you get when you add 1 and 4?" },
        { role: "student", message: "1 + 4 = 5" },
        { role: "coach", message: "What do you get when you add 10 and 10?" },
      ],
      attemptCount: 2,
      maxAttempts: 5,
      followUpCount: 2,
    });
    expect(turn2.stepAccumulation!.satisfiedStepIds).toContain("step_1");
    expect(turn2.stepAccumulation!.satisfiedStepIds).toContain("step_2");
    expect(turn2.finalShouldContinue).toBe(true);

    // Turn 3: combine
    const turn3 = simulateVideoTurnDecisionChain({
      studentResponse: "20 + 5 = 25",
      conversationHistory: [
        { role: "coach", message: "What do you get when you add 1 and 4?" },
        { role: "student", message: "1 + 4 = 5" },
        { role: "coach", message: "What do you get when you add 10 and 10?" },
        { role: "student", message: "10 + 10 = 20" },
        { role: "coach", message: "What do you get when you combine 20 and 5?" },
      ],
      attemptCount: 3,
      maxAttempts: 5,
      followUpCount: 3,
    });
    expect(turn3.stepAccumulation!.satisfiedStepIds).toContain("step_1");
    expect(turn3.stepAccumulation!.satisfiedStepIds).toContain("step_2");
    expect(turn3.stepAccumulation!.satisfiedStepIds).toContain("step_3");
    expect(turn3.completionRatio).toBe(1);
    // Should WRAP with success
    expect(turn3.finalShouldContinue).toBe(false);
    expect(turn3.turnKind).toBe("WRAP");
  });
});

describe("live transcript regression: alternate strategy", () => {
  it("'well I can take 14...split 11...14+10 is 24 + one is 25' → WRAP_SUCCESS", () => {
    const result = simulateVideoTurnDecisionChain({
      studentResponse: "well I can take 14 and then I can split the 11 into a 10 and 1 14 + 10 is 24 + the one is 25",
      conversationHistory: [
        { role: "coach", message: "Can you explain how you solved 11 + 14?" },
      ],
      attemptCount: 1,
      maxAttempts: 5,
      followUpCount: 1,
    });
    expect(result.mathAnswerCorrect).toBe(true);
    expect(result.stepAccumulation!.alternateStrategyDetected).toBe(true);
    expect(result.completionRatio).toBeGreaterThanOrEqual(0.66);
    // Should WRAP — student explained their reasoning fully
    expect(result.finalShouldContinue).toBe(false);
    expect(result.turnKind).toBe("WRAP");
    // Debug trace should show alternate strategy mastery path
    console.log("[live-transcript trace]\n" + result.debugTrace.join("\n"));
  });
});
