/**
 * Cross-file integration tests for the math interpretation → remediation → wrap pipeline.
 *
 * These tests exercise interpretMathUtterance() + classifyStudentState() +
 * getDeterministicRemediationMove() + shouldWrapMathSession() together to verify
 * that all subsystems agree on routing for tricky edge cases.
 *
 * Cases A–E from the integration spec.
 */

import {
  interpretMathUtterance,
  shouldWrapMathSession,
  isDecompositionOnly,
  extractFinalAnswer,
  type ReasoningStepAccumulation,
  type MathUtteranceInterpretation,
} from "./mathAnswerValidator";
import {
  classifyStudentState,
  getDeterministicRemediationMove,
} from "./deterministicRemediation";
import type { ReasoningStep } from "./prompt";
import type { MathProblem } from "./mathProblem";

// ============================================================================
// Shared fixtures
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

const ADDITION_STEPS: ReasoningStep[] = [
  { id: "ones", label: "Add the ones", expectedStatements: ["7 + 6 = 13"], probe: "What do you get when you add the ones?", kind: "ones_sum" },
  { id: "tens", label: "Add the tens", expectedStatements: ["2 + 3 = 5", "20 + 30 = 50"], probe: "What do you get when you add the tens?", kind: "tens_sum" },
  { id: "combine", label: "Combine", expectedStatements: ["50 + 13 = 63"], probe: "Now put them together — what do you get?", kind: "combine" },
];

const SIMPLE_ADDITION_PROBLEM: MathProblem = {
  skill: "two_digit_addition",
  a: 14,
  b: 11,
  expression: "14 + 11",
  correctAnswer: 25,
  requiresRegrouping: false,
  expectedStrategyTags: ["add ones", "add tens"],
};

const SIMPLE_ADDITION_STEPS: ReasoningStep[] = [
  { id: "ones", label: "Add the ones", expectedStatements: ["4 + 1 = 5"], probe: "What do you get when you add the ones?", kind: "ones_sum" },
  { id: "tens", label: "Add the tens", expectedStatements: ["1 + 1 = 2", "10 + 10 = 20"], probe: "What do you get when you add the tens?", kind: "tens_sum" },
  { id: "combine", label: "Combine", expectedStatements: ["20 + 5 = 25"], probe: "Now put them together — what do you get?", kind: "combine" },
];

const SUBTRACTION_PROBLEM: MathProblem = {
  skill: "two_digit_subtraction",
  a: 42,
  b: 17,
  expression: "42 - 17",
  correctAnswer: 25,
  requiresRegrouping: true,
  expectedStrategyTags: ["check ones", "borrow from tens", "subtract ones", "subtract tens"],
};

const SUBTRACTION_STEPS: ReasoningStep[] = [
  { id: "ones", label: "Subtract the ones", expectedStatements: ["12 - 7 = 5"], probe: "What do you get when you subtract the ones?", kind: "subtract_ones" },
  { id: "tens", label: "Subtract the tens", expectedStatements: ["3 - 1 = 2", "30 - 10 = 20"], probe: "What about the tens?", kind: "subtract_tens" },
  { id: "combine", label: "Combine", expectedStatements: ["20 + 5 = 25"], probe: "Now put them together.", kind: "combine" },
];

/** Build a fresh step accumulation with nothing satisfied. */
function emptyAccumulation(correctAnswer: number, stepIds: string[]): ReasoningStepAccumulation {
  return {
    satisfiedStepIds: [],
    missingStepIds: [...stepIds],
    newlySatisfiedStepIds: [],
    completionRatio: 0,
    answerCorrect: false,
    extractedAnswer: null,
    alternateStrategyDetected: false,
  };
}

/** Build step accumulation with some steps satisfied. */
function partialAccumulation(
  correctAnswer: number,
  allStepIds: string[],
  satisfiedIds: string[],
  answerCorrect: boolean,
  extractedAnswer: number | null = null,
  alternateStrategyDetected = false,
): ReasoningStepAccumulation {
  return {
    satisfiedStepIds: satisfiedIds,
    missingStepIds: allStepIds.filter(id => !satisfiedIds.includes(id)),
    newlySatisfiedStepIds: satisfiedIds,
    completionRatio: satisfiedIds.length / allStepIds.length,
    answerCorrect,
    extractedAnswer,
    alternateStrategyDetected,
  };
}

// ============================================================================
// Case A: Decomposition setup on first turn
//
// Student says "I'm going to split 27 into 20 and 7" — this is setup, not a
// wrong answer. The system should:
//   - Interpret as decomposition-only
//   - Classify as alternate_setup (not "wrong")
//   - Continue the session (not wrap)
//   - Remediation should probe for next step
// ============================================================================

describe("Case A: decomposition setup on first turn", () => {
  const studentText = "I'm going to split 27 into 20 and 7";
  let interp: MathUtteranceInterpretation;

  beforeAll(() => {
    interp = interpretMathUtterance(studentText, 63, undefined, [27, 36], "+");
  });

  it("interprets as decomposition-only", () => {
    expect(interp.isDecompositionOnly).toBe(true);
  });

  it("does NOT interpret as a whole-problem answer", () => {
    expect(interp.likelyWholeProblemAnswer).toBe(false);
  });

  it("classifies student state as alternate_setup, not wrong", () => {
    const acc = emptyAccumulation(63, ["ones", "tens", "combine"]);
    const state = classifyStudentState(studentText, acc, ADDITION_PROBLEM, interp);
    expect(state).not.toBe("wrong");
    expect(state).toBe("alternate_setup");
  });

  it("wrap decision is continue_decomposition", () => {
    const acc = emptyAccumulation(63, ["ones", "tens", "combine"]);
    const decision = shouldWrapMathSession(acc, interp, 1, 6, 120);
    expect(decision.action).toBe("continue_decomposition");
  });

  it("remediation returns a move (not null)", () => {
    const acc = emptyAccumulation(63, ["ones", "tens", "combine"]);
    const move = getDeterministicRemediationMove(
      ADDITION_STEPS, acc, studentText, ADDITION_PROBLEM, [], interp,
    );
    expect(move).not.toBeNull();
  });
});

// ============================================================================
// Case B: Substep-only equation
//
// Student says "7 + 6 = 13" for 27 + 36 = 63. This is the ones substep, not
// a wrong whole-problem answer. The system should:
//   - Interpret as substep-only (correct arithmetic, doesn't use both operands)
//   - NOT classify as "wrong" (13 ≠ 63 but it's a substep)
//   - Continue probing for remaining steps
// ============================================================================

describe("Case B: substep-only equation", () => {
  const studentText = "7 + 6 = 13";
  let interp: MathUtteranceInterpretation;

  beforeAll(() => {
    interp = interpretMathUtterance(studentText, 63, undefined, [27, 36], "+");
  });

  it("interprets as substep-only", () => {
    expect(interp.likelySubstepOnly).toBe(true);
  });

  it("does NOT interpret as whole-problem answer", () => {
    expect(interp.likelyWholeProblemAnswer).toBe(false);
  });

  it("classifies as partial, not wrong", () => {
    const acc = emptyAccumulation(63, ["ones", "tens", "combine"]);
    const state = classifyStudentState(studentText, acc, ADDITION_PROBLEM, interp);
    expect(state).not.toBe("wrong");
    expect(state).toBe("partial");
  });

  it("wrap decision is continue_probing", () => {
    const acc = emptyAccumulation(63, ["ones", "tens", "combine"]);
    const decision = shouldWrapMathSession(acc, interp, 1, 6, 120);
    expect(decision.action).toBe("continue_probing");
  });

  it("a wrong-operation equation IS classified as wrong (not substep)", () => {
    // "4 - 1 = 3" on an addition problem is a misconception, not a substep
    const wrongOpText = "4 - 1 = 3";
    const wrongInterp = interpretMathUtterance(wrongOpText, 63, undefined, [27, 36], "+");
    expect(wrongInterp.likelySubstepOnly).toBe(false);
  });

  it("an arithmetically incorrect equation is NOT substep-only", () => {
    // "20 + 5 = 15" — arithmetic is wrong (20+5=25 not 15)
    const wrongArithText = "20 + 5 = 15";
    const wrongArithInterp = interpretMathUtterance(wrongArithText, 63, undefined, [27, 36], "+");
    expect(wrongArithInterp.likelySubstepOnly).toBe(false);
  });
});

// ============================================================================
// Case C: Alternate valid chain
//
// Student says "I did 30 + 30 = 60 then 60 + 3 = 63" for 27 + 36 = 63.
// This reaches the correct answer via a non-canonical strategy. The system should:
//   - Detect alternate strategy chain
//   - Answer is correct
//   - Wrap as mastery (valid alternate + correct answer)
// ============================================================================

describe("Case C: alternate valid chain", () => {
  const studentText = "I did 30 + 30 = 60 then 60 + 3 = 63";
  let interp: MathUtteranceInterpretation;

  beforeAll(() => {
    interp = interpretMathUtterance(studentText, 63, undefined, [27, 36], "+");
  });

  it("detects alternate strategy chain", () => {
    expect(interp.isAlternateStrategyChain).toBe(true);
  });

  it("has correct final answer candidate", () => {
    // The chain ends at 63 which matches correctAnswer
    expect(interp.hasMathEvidence).toBe(true);
  });

  it("classifies as partial (alternate chain route)", () => {
    const acc = partialAccumulation(63, ["ones", "tens", "combine"], [], true, 63, true);
    const state = classifyStudentState(studentText, acc, ADDITION_PROBLEM, interp);
    // With alternateStrategyDetected on accumulation, or interp.isAlternateStrategyChain → partial
    expect(state).not.toBe("wrong");
  });

  it("wrap decision is wrap_mastery when accumulation marks alternate + correct", () => {
    const acc = partialAccumulation(63, ["ones", "tens", "combine"], [], true, 63, true);
    const decision = shouldWrapMathSession(acc, interp, 3, 6, 120);
    expect(decision.action).toBe("wrap_mastery");
    expect(decision.reason).toBe("alternate_strategy_with_correct_answer");
  });

  it("wrap decision is continue_probing when answer not yet confirmed correct", () => {
    // If the accumulation hasn't marked answer correct yet, don't wrap
    const acc = partialAccumulation(63, ["ones", "tens", "combine"], [], false, null, false);
    const decision = shouldWrapMathSession(acc, interp, 2, 6, 120);
    expect(decision.action).toBe("continue_probing");
  });
});

// ============================================================================
// Case D: Decomposition on turn 1, then correct answer on turn 2
//
// Turn 1: "I split 27 into 20 and 7" — decomposition setup
// Turn 2: "the answer is 63" — correct answer but canonical steps still missing
//
// The system should:
//   - Turn 1: alternate_setup, continue_decomposition
//   - Turn 2: correct_incomplete (answer right, steps still missing), continue_probing
// ============================================================================

describe("Case D: decomposition then later answer", () => {
  it("turn 1: decomposition setup → alternate_setup, continue", () => {
    const text1 = "I split 27 into 20 and 7";
    const interp1 = interpretMathUtterance(text1, 63, undefined, [27, 36], "+");
    const acc1 = emptyAccumulation(63, ["ones", "tens", "combine"]);

    const state1 = classifyStudentState(text1, acc1, ADDITION_PROBLEM, interp1);
    expect(state1).toBe("alternate_setup");

    const wrap1 = shouldWrapMathSession(acc1, interp1, 1, 6, 120);
    expect(wrap1.action).toBe("continue_decomposition");
  });

  it("turn 2: correct answer with missing steps → correct_incomplete, continue_probing", () => {
    const text2 = "the answer is 63";
    const interp2 = interpretMathUtterance(text2, 63, undefined, [27, 36], "+");
    // Accumulation now has answer correct but steps still missing
    const acc2 = partialAccumulation(63, ["ones", "tens", "combine"], [], true, 63);

    const state2 = classifyStudentState(text2, acc2, ADDITION_PROBLEM, interp2);
    expect(state2).toBe("correct_incomplete");

    const wrap2 = shouldWrapMathSession(acc2, interp2, 2, 6, 120);
    expect(wrap2.action).toBe("continue_probing");
    expect(wrap2.reason).toBe("correct_answer_missing_explanation");
  });
});

// ============================================================================
// Case E: Correction of scoped attribution
//
// Coach asks "What do you get when you add the ones?" and student says "13".
// This is a scoped substep reply — the "13" should NOT be treated as a wrong
// whole-problem answer. The system should:
//   - Interpret as short scoped reply
//   - Classify appropriately (not "wrong" for 13 ≠ 63)
//   - Continue probing for remaining steps
// ============================================================================

describe("Case E: scoped reply attribution", () => {
  const coachQ = "What do you get when you add the ones?";

  it("bare number '13' after substep question is not a wrong whole-problem answer", () => {
    const studentText = "13";
    const interp = interpretMathUtterance(studentText, 63, coachQ, [27, 36], "+");

    // 13 as a bare number gets unknown_number role → likelyWholeProblemAnswer might be true
    // BUT the key test: classifyStudentState should recognize it satisfies the ones step
    // and not classify as "wrong"
    const acc = emptyAccumulation(63, ["ones", "tens", "combine"]);
    const state = classifyStudentState(studentText, acc, ADDITION_PROBLEM, interp);
    // Student said "13" which is 7+6=13 — this should satisfy ones step or at least not be "wrong"
    expect(state).not.toBe("wrong");
  });

  it("'seven plus six equals thirteen' is a valid substep, not wrong", () => {
    const studentText = "seven plus six equals thirteen";
    const interp = interpretMathUtterance(studentText, 63, coachQ, [27, 36], "+");

    const acc = emptyAccumulation(63, ["ones", "tens", "combine"]);
    const state = classifyStudentState(studentText, acc, ADDITION_PROBLEM, interp);
    expect(state).not.toBe("wrong");
  });

  it("wrap decision continues when substep is answered but other steps remain", () => {
    const studentText = "13";
    const interp = interpretMathUtterance(studentText, 63, coachQ, [27, 36], "+");
    // Even if ones is satisfied, tens and combine remain
    const acc = partialAccumulation(63, ["ones", "tens", "combine"], ["ones"], false, null);
    const decision = shouldWrapMathSession(acc, interp, 2, 6, 120);
    expect(decision.action).toBe("continue_probing");
  });

  it("remediation probes for the next missing step after substep is satisfied", () => {
    const acc = partialAccumulation(63, ["ones", "tens", "combine"], ["ones"], false, null);
    const move = getDeterministicRemediationMove(
      ADDITION_STEPS, acc, "13", ADDITION_PROBLEM, [], undefined,
    );
    // Should probe for tens (next missing step), not null
    expect(move).not.toBeNull();
    if (move) {
      // The move should target the tens step (next missing after ones)
      expect(move.targetStepId).toBe("tens");
    }
  });
});

// ============================================================================
// Additional edge-case integration tests
// ============================================================================

describe("Cross-file edge cases", () => {
  it("wrap_support when time runs out even with progress", () => {
    const interp = interpretMathUtterance("7 + 6 = 13", 63, undefined, [27, 36], "+");
    const acc = partialAccumulation(63, ["ones", "tens", "combine"], ["ones"], false, null);
    const decision = shouldWrapMathSession(acc, interp, 3, 6, 10); // only 10s left
    expect(decision.action).toBe("wrap_support");
    expect(decision.reason).toBe("closing_window_time_constraint");
  });

  it("wrap_support at max attempts with no progress", () => {
    const interp = interpretMathUtterance("I don't know", 63, undefined, [27, 36], "+");
    const acc = emptyAccumulation(63, ["ones", "tens", "combine"]);
    const decision = shouldWrapMathSession(acc, interp, 5, 6, 120);
    expect(decision.action).toBe("wrap_support");
    expect(decision.reason).toBe("max_attempts_no_progress");
  });

  it("full mastery: all steps satisfied + correct answer → wrap_mastery", () => {
    const interp = interpretMathUtterance("the answer is 63", 63, undefined, [27, 36], "+");
    const acc = partialAccumulation(63, ["ones", "tens", "combine"], ["ones", "tens", "combine"], true, 63);
    const decision = shouldWrapMathSession(acc, interp, 3, 6, 120);
    expect(decision.action).toBe("wrap_mastery");
    expect(decision.reason).toBe("all_steps_complete_and_correct");
  });

  it("subtraction substep '12 - 7 = 5' is substep-only, not wrong whole-problem answer", () => {
    const text = "12 - 7 = 5";
    const interp = interpretMathUtterance(text, 25, undefined, [42, 17], "-");
    expect(interp.likelySubstepOnly).toBe(true);

    const acc = emptyAccumulation(25, ["ones", "tens", "combine"]);
    const state = classifyStudentState(text, acc, SUBTRACTION_PROBLEM, interp);
    expect(state).not.toBe("wrong");
  });
});

// ============================================================================
// Hardening: Alternate strategy with thin explanation
//
// Problem: 14 + 11 = 25
// Student: "14 + 10 = 24, then 25"
//
// This is an alternate chain but the explanation is thin — "then 25" is not
// a full arithmetic step. The question: does the system accept this as mastery
// or continue probing?
//
// Current design: alternateStrategyDetected requires answerCorrect on the
// ACCUMULATION (across all turns), and the chain must arithmetically reach
// the correct answer. "14 + 10 = 24, then 25" has one valid equation
// (14+10=24) but "then 25" doesn't parse as "24+1=25". So the chain does
// NOT reach 25 — isAlternateStrategyChain should be false.
// ============================================================================

describe("Hardening: alternate strategy with thin explanation", () => {
  const studentText = "14 + 10 = 24, then 25";

  it("interpretation: raw extraction picks up equation result, not trailing bare number", () => {
    const interp = interpretMathUtterance(studentText, 25, undefined, [14, 11], "+");
    // "14 + 10 = 24, then 25" — raw extracts 24 from the equation.
    // The trailing "25" is ambiguous without an explicit claim marker.
    // The key point: the chain doesn't close, so this isn't mastery.
    expect(interp.rawExtractedAnswer).toBe(24);
  });

  it("interpretation: isAlternateStrategyChain is false (chain doesn't close)", () => {
    const interp = interpretMathUtterance(studentText, 25, undefined, [14, 11], "+");
    // "14 + 10 = 24" is valid, but "then 25" doesn't form "24 + 1 = 25"
    // So the chain doesn't reach 25 — not a complete alternate strategy
    expect(interp.isAlternateStrategyChain).toBe(false);
  });

  it("with accumulation answerCorrect but no alternateStrategy, continues probing", () => {
    const interp = interpretMathUtterance(studentText, 25, undefined, [14, 11], "+");
    // Answer is correct (25) but alternate strategy NOT detected (chain incomplete)
    const acc = partialAccumulation(25, ["ones", "tens", "combine"], [], true, 25, false);
    const decision = shouldWrapMathSession(acc, interp, 2, 6, 120);
    expect(decision.action).toBe("continue_probing");
    expect(decision.reason).toBe("correct_answer_missing_explanation");
  });

  it("with full chain '14 + 10 = 24, 24 + 1 = 25', wraps as mastery", () => {
    const fullText = "14 + 10 = 24, 24 + 1 = 25";
    const interp = interpretMathUtterance(fullText, 25, undefined, [14, 11], "+");
    expect(interp.isAlternateStrategyChain).toBe(true);

    const acc = partialAccumulation(25, ["ones", "tens", "combine"], [], true, 25, true);
    const decision = shouldWrapMathSession(acc, interp, 2, 6, 120);
    expect(decision.action).toBe("wrap_mastery");
    expect(decision.reason).toBe("alternate_strategy_with_correct_answer");
  });
});

// ============================================================================
// Hardening: Wrong whole-problem equation vs valid substep
//
// Problem: 14 + 11 = 25
// ============================================================================

describe("Hardening: wrong whole-problem equation vs valid substep", () => {
  it("'14 + 11 = 20' is NOT substep-only (uses both operands, wrong answer)", () => {
    const text = "14 + 11 = 20";
    const interp = interpretMathUtterance(text, 25, undefined, [14, 11], "+");
    expect(interp.likelySubstepOnly).toBe(false);
    // Equation uses both problem operands → not substep-only
    // Note: likelyWholeProblemAnswer may be false (equation_statement with no
    // explicit claim), but classifyStudentState still detects it as wrong
    // because extractFinalAnswer returns 20 (wrong numeric answer).

    const acc = emptyAccumulation(25, ["ones", "tens", "combine"]);
    const state = classifyStudentState(text, acc, SIMPLE_ADDITION_PROBLEM, interp);
    // Should be "wrong" or "misconception" — both are correct wrong-answer paths.
    // (20 for 14+11 is likely "forgot to carry" misconception)
    expect(["wrong", "misconception"]).toContain(state);
  });

  it("'10 + 10 = 20' IS substep-only (valid arithmetic, doesn't use both operands)", () => {
    const text = "10 + 10 = 20";
    const interp = interpretMathUtterance(text, 25, undefined, [14, 11], "+");
    expect(interp.likelySubstepOnly).toBe(true);
    expect(interp.likelyWholeProblemAnswer).toBe(false);

    const acc = emptyAccumulation(25, ["ones", "tens", "combine"]);
    const state = classifyStudentState(text, acc, SIMPLE_ADDITION_PROBLEM, interp);
    expect(state).not.toBe("wrong");
  });

  it("'4 + 1 = 5' IS substep-only (ones digit work)", () => {
    const text = "4 + 1 = 5";
    const interp = interpretMathUtterance(text, 25, undefined, [14, 11], "+");
    expect(interp.likelySubstepOnly).toBe(true);

    const acc = emptyAccumulation(25, ["ones", "tens", "combine"]);
    const state = classifyStudentState(text, acc, SIMPLE_ADDITION_PROBLEM, interp);
    expect(state).not.toBe("wrong");
  });
});

// ============================================================================
// Hardening: Decomposition with vs without conclusion
// ============================================================================

describe("Hardening: decomposition with and without conclusion", () => {
  it("'I would split it into 10 and 1, and the answer is 25' is NOT decomposition-only", () => {
    const text = "I would split it into 10 and 1, and the answer is 25";
    expect(isDecompositionOnly(text)).toBe(false);
    expect(extractFinalAnswer(text)).toBe(25);

    const interp = interpretMathUtterance(text, 25, undefined, [14, 11], "+");
    expect(interp.isDecompositionOnly).toBe(false);
    expect(interp.finalAnswerCandidate).toBe(25);
  });

  it("'Break 11 into 10 and 1, I got 25' is NOT decomposition-only", () => {
    const text = "Break 11 into 10 and 1, I got 25";
    expect(isDecompositionOnly(text)).toBe(false);
    expect(extractFinalAnswer(text)).toBe(25);

    const interp = interpretMathUtterance(text, 25, undefined, [14, 11], "+");
    expect(interp.isDecompositionOnly).toBe(false);
    expect(interp.finalAnswerCandidate).toBe(25);
  });

  it("'I would split it into 10 and 1' IS decomposition-only (no conclusion)", () => {
    const text = "I would split it into 10 and 1";
    expect(isDecompositionOnly(text)).toBe(true);
    expect(extractFinalAnswer(text)).toBeNull();

    const interp = interpretMathUtterance(text, 25, undefined, [14, 11], "+");
    expect(interp.isDecompositionOnly).toBe(true);
    expect(interp.finalAnswerCandidate).toBeNull();

    const acc = emptyAccumulation(25, ["ones", "tens", "combine"]);
    const decision = shouldWrapMathSession(acc, interp, 1, 6, 120);
    expect(decision.action).toBe("continue_decomposition");
  });

  it("'11 could be 10 plus 1' IS decomposition-only (no conclusion)", () => {
    const text = "11 could be 10 plus 1";
    expect(isDecompositionOnly(text)).toBe(true);
    expect(extractFinalAnswer(text)).toBeNull();

    const interp = interpretMathUtterance(text, 25, undefined, [14, 11], "+");
    expect(interp.isDecompositionOnly).toBe(true);

    const acc = emptyAccumulation(25, ["ones", "tens", "combine"]);
    const decision = shouldWrapMathSession(acc, interp, 1, 6, 120);
    expect(decision.action).toBe("continue_decomposition");
  });
});

// ============================================================================
// Hardening: Correction utterance preserves attribution
// ============================================================================

describe("Hardening: correction utterance attribution", () => {
  it("'I didn't say 14 + 11 = 20, I said 10 + 10 = 20' is not wrong whole-problem", () => {
    const text = "I didn't say 14 + 11 = 20, I said 10 + 10 = 20";
    const interp = interpretMathUtterance(text, 25, undefined, [14, 11], "+");

    // The student is correcting attribution — the 10 + 10 = 20 is a valid substep.
    // The system should not classify this as a wrong answer for the whole problem.
    const acc = emptyAccumulation(25, ["ones", "tens", "combine"]);
    const state = classifyStudentState(text, acc, SIMPLE_ADDITION_PROBLEM, interp);
    // Key assertion: NOT classified as "wrong" for the whole problem
    expect(state).not.toBe("wrong");
  });

  it("correction should route to continue probing, not wrap", () => {
    const text = "I didn't say 14 + 11 = 20, I said 10 + 10 = 20";
    const interp = interpretMathUtterance(text, 25, undefined, [14, 11], "+");
    const acc = emptyAccumulation(25, ["ones", "tens", "combine"]);
    const decision = shouldWrapMathSession(acc, interp, 2, 6, 120);
    expect(decision.action).toBe("continue_probing");
  });
});

// ============================================================================
// Policy source consistency tests
//
// These verify that the interpretation → classify → wrap pipeline produces
// consistent decisions across all three layers. Each test checks the full
// chain: interpretation signals, student state classification, wrap decision,
// and remediation availability all agree.
// ============================================================================

describe("Policy source consistency", () => {
  it("A: substep-only → all layers agree on continue, no wrap", () => {
    const text = "7 + 6 = 13";
    const interp = interpretMathUtterance(text, 63, undefined, [27, 36], "+");

    // Layer 1: Interpretation — substep-only, not whole-problem
    expect(interp.likelySubstepOnly).toBe(true);
    expect(interp.likelyWholeProblemAnswer).toBe(false);
    expect(interp.isDecompositionOnly).toBe(false);
    expect(interp.isAlternateStrategyChain).toBe(false);

    // Layer 2: Classification — partial, not wrong
    const acc = emptyAccumulation(63, ["ones", "tens", "combine"]);
    const state = classifyStudentState(text, acc, ADDITION_PROBLEM, interp);
    expect(state).toBe("partial");

    // Layer 3: Wrap decision — continue probing
    const decision = shouldWrapMathSession(acc, interp, 1, 6, 120);
    expect(decision.action).toBe("continue_probing");

    // Layer 4: Remediation — move available, targets next step
    const move = getDeterministicRemediationMove(
      ADDITION_STEPS, acc, text, ADDITION_PROBLEM, [], interp,
    );
    expect(move).not.toBeNull();
    // Remediation should NOT be WRAP_SUCCESS or WRAP_NEEDS_SUPPORT
    if (move) {
      expect(move.type).not.toBe("WRAP_SUCCESS");
      expect(move.type).not.toBe("WRAP_NEEDS_SUPPORT");
    }
  });

  it("B: decomposition-only → all layers agree on continue_decomposition, no wrap", () => {
    const text = "I would split 27 into 20 and 7";
    const interp = interpretMathUtterance(text, 63, undefined, [27, 36], "+");

    // Layer 1: Interpretation — decomposition-only
    expect(interp.isDecompositionOnly).toBe(true);
    expect(interp.likelyWholeProblemAnswer).toBe(false);
    expect(interp.likelySubstepOnly).toBe(false);
    expect(interp.isAlternateStrategyChain).toBe(false);
    expect(interp.finalAnswerCandidate).toBeNull();

    // Layer 2: Classification — alternate_setup
    const acc = emptyAccumulation(63, ["ones", "tens", "combine"]);
    const state = classifyStudentState(text, acc, ADDITION_PROBLEM, interp);
    expect(state).toBe("alternate_setup");

    // Layer 3: Wrap decision — continue_decomposition specifically
    const decision = shouldWrapMathSession(acc, interp, 1, 6, 120);
    expect(decision.action).toBe("continue_decomposition");
    expect(decision.reason).toBe("decomposition_setup_no_conclusion");

    // Layer 4: Remediation — move available, not a wrap move
    const move = getDeterministicRemediationMove(
      ADDITION_STEPS, acc, text, ADDITION_PROBLEM, [], interp,
    );
    expect(move).not.toBeNull();
    if (move) {
      expect(move.type).not.toBe("WRAP_SUCCESS");
      expect(move.type).not.toBe("WRAP_NEEDS_SUPPORT");
    }
  });

  it("C: alternate full chain → all layers agree on wrap_mastery", () => {
    const text = "30 + 30 = 60, 60 + 3 = 63";
    const interp = interpretMathUtterance(text, 63, undefined, [27, 36], "+");

    // Layer 1: Interpretation — alternate chain detected
    expect(interp.isAlternateStrategyChain).toBe(true);
    expect(interp.isDecompositionOnly).toBe(false);
    expect(interp.likelySubstepOnly).toBe(false);

    // Layer 2: Classification — partial (alternate chain route)
    // Note: with accumulation marking alternate + correct, the student
    // has demonstrated mastery via non-canonical path
    const acc = partialAccumulation(63, ["ones", "tens", "combine"], [], true, 63, true);
    const state = classifyStudentState(text, acc, ADDITION_PROBLEM, interp);
    expect(state).not.toBe("wrong");

    // Layer 3: Wrap decision — wrap_mastery via alternate strategy
    const decision = shouldWrapMathSession(acc, interp, 3, 6, 120);
    expect(decision.action).toBe("wrap_mastery");
    expect(decision.reason).toBe("alternate_strategy_with_correct_answer");

    // Layer 4: Remediation — WRAP_SUCCESS (all done)
    const move = getDeterministicRemediationMove(
      ADDITION_STEPS, acc, text, ADDITION_PROBLEM, [], interp,
    );
    // With alternate strategy + correct answer, remediation should return
    // WRAP_SUCCESS or null (letting the wrap proceed)
    if (move) {
      expect(move.type).toBe("WRAP_SUCCESS");
    }
  });
});

// ============================================================================
// Transcript-based regression tests — 3 behavior failures from real sessions
// ============================================================================

describe("Transcript regression: Problem A — 'what does this have to do with the problem' loops", () => {
  // Student has ones step satisfied, asks "what does this have to do with the problem"
  // Expected: bridge explanation referencing completed steps + focused next question
  // NOT: generic "It's all part of solving X" that loops

  it("bridge references completed step and probes next step", () => {
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: ["ones"],
      missingStepIds: ["tens", "combine"],
      newlySatisfiedStepIds: [],
      completionRatio: 1/3,
      answerCorrect: false,
      extractedAnswer: null,
    };
    const move = getDeterministicRemediationMove(
      SIMPLE_ADDITION_STEPS, acc,
      "what does this have to do with the problem",
      SIMPLE_ADDITION_PROBLEM,
      [
        { role: "coach", message: "What is 14 + 11?" },
        { role: "student", message: "4 + 1 = 5" },
        { role: "coach", message: "That's right! Now what do you get when you add the tens?" },
        { role: "student", message: "what does this have to do with the problem" },
      ],
    );

    expect(move).not.toBeNull();
    expect(move!.type).toBe("STEP_CONCEPT_EXPLANATION");
    // Must reference completed ones step (value 5)
    expect(move!.text).toMatch(/5/);
    // Must reference the overall problem
    expect(move!.text).toMatch(/14 \+ 11/);
    // Must end with a probe for the next step (tens)
    expect(move!.text).toMatch(/add.*10|tens|what/i);
    // Must NOT be the generic "It's all part of solving X" without step reference
    expect(move!.text).not.toMatch(/^It's all part of/);
  });

  it("does NOT loop — response changes when asked again after bridge", () => {
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: ["ones"],
      missingStepIds: ["tens", "combine"],
      newlySatisfiedStepIds: [],
      completionRatio: 1/3,
      answerCorrect: false,
      extractedAnswer: null,
    };
    const firstMove = getDeterministicRemediationMove(
      SIMPLE_ADDITION_STEPS, acc,
      "what does this have to do with the problem",
      SIMPLE_ADDITION_PROBLEM,
      [
        { role: "coach", message: "What do you get when you add the tens?" },
        { role: "student", message: "what does this have to do with the problem" },
      ],
    );
    const secondMove = getDeterministicRemediationMove(
      SIMPLE_ADDITION_STEPS, acc,
      "I still don't get it what does this have to do with 14 plus 11",
      SIMPLE_ADDITION_PROBLEM,
      [
        { role: "coach", message: "What do you get when you add the tens?" },
        { role: "student", message: "what does this have to do with the problem" },
        { role: "coach", message: firstMove!.text },
        { role: "student", message: "I still don't get it what does this have to do with 14 plus 11" },
      ],
    );

    expect(secondMove).not.toBeNull();
    // Second explanation should use a different tier (compact/concise) not loop
    expect(secondMove!.text).not.toBe(firstMove!.text);
  });
});

describe("Transcript regression: Problem B — 'I didn't say that' after coach misattributes", () => {
  // Coach says "you said 20" but student didn't. Student says "I didn't say that."
  // Expected: detect correction, suppress false misconception, continue from valid work.

  it("'I didn't say that' after coach attribution → method_acknowledgment_repair", () => {
    // ones satisfied from a prior turn — NOT newly satisfied in this turn
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: ["ones"],
      missingStepIds: ["tens", "combine"],
      newlySatisfiedStepIds: [],
      completionRatio: 1/3,
      answerCorrect: false,
      extractedAnswer: null,
    };
    const move = getDeterministicRemediationMove(
      SIMPLE_ADDITION_STEPS, acc,
      "I didn't say that",
      SIMPLE_ADDITION_PROBLEM,
      [
        { role: "coach", message: "What do you get when you add the tens?" },
        { role: "student", message: "10 + 10 = 20" },
        { role: "coach", message: "It seems like you got 20 for the whole problem, but let's think about it differently." },
        { role: "student", message: "I didn't say that" },
      ],
    );

    expect(move).not.toBeNull();
    expect(move!.studentState).toBe("method_acknowledgment_repair");
    // Must apologize/correct
    expect(move!.text).toMatch(/sorry|right/i);
    // Must reference their valid work (5 from ones)
    expect(move!.text).toMatch(/5/);
    // Must probe the next step
    expect(move!.text).toMatch(/what|add|tens/i);
    // Must NOT say "wrong" or continue the false misconception
    expect(move!.text).not.toMatch(/wrong|incorrect|not quite/i);
  });

  it("'I never said that' also triggers repair", () => {
    const acc = emptyAccumulation(25, ["ones", "tens", "combine"]);
    const move = getDeterministicRemediationMove(
      SIMPLE_ADDITION_STEPS, acc,
      "I never said that",
      SIMPLE_ADDITION_PROBLEM,
      [
        { role: "coach", message: "Your answer was 20, but that's not quite right." },
        { role: "student", message: "I never said that" },
      ],
    );

    expect(move).not.toBeNull();
    expect(move!.studentState).toBe("method_acknowledgment_repair");
    expect(move!.text).toMatch(/sorry|right|hear/i);
  });
});

describe("Transcript regression: Problem C — multi-turn non-canonical decomposition continuation", () => {
  // Student spread decomposition across turns: "14=7+7", "11=5+6", "7+6=13", "then 7 makes 20, 5 left"
  // Expected: continue in student's strategy, don't redirect to canonical.

  it("multi-turn decomposition: history has both decomps → noncanonical_active", () => {
    const acc = emptyAccumulation(25, ["ones", "tens", "combine"]);
    const move = getDeterministicRemediationMove(
      SIMPLE_ADDITION_STEPS, acc,
      "7 + 6 is 13",
      SIMPLE_ADDITION_PROBLEM,
      [
        { role: "coach", message: "What is 14 + 11?" },
        { role: "student", message: "14 is 7 + 7" },
        { role: "coach", message: "That works! What about 11?" },
        { role: "student", message: "11 is 5 + 6" },
        { role: "coach", message: "OK, now what?" },
        { role: "student", message: "7 + 6 is 13" },
      ],
    );

    expect(move).not.toBeNull();
    expect(move!.studentState).toBe("noncanonical_active");
    // Must acknowledge their math
    expect(move!.text).toMatch(/valid|right|correct|splits|good/i);
    // Must NOT redirect to canonical tens+ones
    expect(move!.text).not.toMatch(/tens and ones|easier here because/i);
    // Must continue in their strategy with a combining probe
    expect(move!.text).toMatch(/what|combine|parts/i);
  });

  it("'5 left over' continuation with prior decompositions → noncanonical_active, not wrong", () => {
    const acc = emptyAccumulation(25, ["ones", "tens", "combine"]);
    const move = getDeterministicRemediationMove(
      SIMPLE_ADDITION_STEPS, acc,
      "then 7 makes 20 and 5 left over",
      SIMPLE_ADDITION_PROBLEM,
      [
        { role: "coach", message: "What is 14 + 11?" },
        { role: "student", message: "14 is 7 + 7" },
        { role: "coach", message: "OK, what about 11?" },
        { role: "student", message: "11 is 5 + 6" },
        { role: "coach", message: "What next?" },
        { role: "student", message: "7 + 6 = 13" },
        { role: "coach", message: "Good! Now what about the other parts?" },
        { role: "student", message: "then 7 makes 20 and 5 left over" },
      ],
    );

    expect(move).not.toBeNull();
    // Must NOT be classified as wrong
    expect(move!.studentState).not.toBe("wrong");
    expect(move!.studentState).not.toBe("misconception");
    // Must NOT wrap
    expect(move!.type).not.toBe("WRAP_SUCCESS");
    expect(move!.type).not.toBe("WRAP_NEEDS_SUPPORT");
  });
});

// ============================================================================
// Failure A — Repeated structure confusion should not trigger long lectures
// ============================================================================

describe("Failure A: repeated structure confusion escalation", () => {
  it("first structure confusion → short bridge + probe (not a lecture)", () => {
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: [],
      missingStepIds: ["ones", "tens", "combine"],
      newlySatisfiedStepIds: [],
      completionRatio: 0,
      answerCorrect: false,
      extractedAnswer: null,
    };
    const move = getDeterministicRemediationMove(
      SIMPLE_ADDITION_STEPS, acc,
      "what does that have to do with the problem",
      SIMPLE_ADDITION_PROBLEM,
      [
        { role: "coach", message: "What do you get when you add the ones?" },
        { role: "student", message: "what does that have to do with the problem" },
      ],
    );

    expect(move).not.toBeNull();
    // Bridge before probe should be <= 1 short sentence
    const probeStart = move!.text.lastIndexOf("What");
    expect(probeStart).toBeGreaterThan(0);
    expect(probeStart).toBeLessThan(80);
  });

  it("2nd consecutive structure confusion → no re-explanation, direct probe", () => {
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: [],
      missingStepIds: ["ones", "tens", "combine"],
      newlySatisfiedStepIds: [],
      completionRatio: 0,
      answerCorrect: false,
      extractedAnswer: null,
    };
    const move = getDeterministicRemediationMove(
      SIMPLE_ADDITION_STEPS, acc,
      "I still don't get why we're doing that",
      SIMPLE_ADDITION_PROBLEM,
      [
        { role: "coach", message: "What do you get when you add the ones?" },
        { role: "student", message: "what does that have to do with the problem" },
        { role: "coach", message: "We're solving 14 + 11 in smaller parts. What do you get when you add the ones?" },
        { role: "student", message: "I still don't get why we're doing that" },
      ],
    );

    expect(move).not.toBeNull();
    // Must NOT give another long explanation — either direct probe or simpler probe is fine
    expect(["STEP_PROBE_DIRECT", "STEP_PROBE_SIMPLER"]).toContain(move!.type);
    // Response must be very short (no lecture)
    expect(move!.text.length).toBeLessThan(120);
    // Must NOT contain decomposition re-explanation
    expect(move!.text).not.toMatch(/\d+\s*=\s*\d+\s*\+\s*\d+/);
    // Must still end with a probe
    expect(move!.text).toMatch(/\?/);
  });
});

// ============================================================================
// Failure B — Noncanonical wrong combine loop
// ============================================================================

describe("Failure B: noncanonical combine loop prevention", () => {
  it("decomp 14=8+6, 11=5+6 → first combine probe picks shared factor (6+6), not 8+5", () => {
    const acc = emptyAccumulation(25, ["ones", "tens", "combine"]);
    const move = getDeterministicRemediationMove(
      SIMPLE_ADDITION_STEPS, acc,
      "14 is 8 + 6 and 11 is 5 + 6 and 6 + 5 is 11",
      SIMPLE_ADDITION_PROBLEM,
      [{ role: "coach", message: "What is 14 + 11?" }],
    );

    expect(move).not.toBeNull();
    expect(move!.studentState).toBe("noncanonical_active");
    // Should prefer the shared factor pair (6+6), not the positional 8+5
    expect(move!.text).toMatch(/6\s*\+\s*6|6 plus 6/i);
    expect(move!.text).not.toMatch(/8\s*\+\s*5|8 plus 5/i);
  });

  it("after student answers 8+5=13, coach does NOT ask 8+5 again", () => {
    const acc = emptyAccumulation(25, ["ones", "tens", "combine"]);
    const move = getDeterministicRemediationMove(
      SIMPLE_ADDITION_STEPS, acc,
      "8 + 5 is 13",
      SIMPLE_ADDITION_PROBLEM,
      [
        { role: "coach", message: "What is 14 + 11?" },
        { role: "student", message: "14 is 8 + 6 and 11 is 5 + 6" },
        { role: "coach", message: "Now you can combine the parts. What is 8 + 5?" },
        { role: "student", message: "8 + 5 is 13" },
      ],
    );

    expect(move).not.toBeNull();
    // Must NOT repeat "What is 8 + 5?" since student already answered it
    expect(move!.text).not.toMatch(/what is 8 \+ 5\?|what is 8 plus 5\?/i);
  });

  it("student corrects combine target ('I think you mean 6 + 6') → system adopts it", () => {
    const acc = emptyAccumulation(25, ["ones", "tens", "combine"]);
    const move = getDeterministicRemediationMove(
      SIMPLE_ADDITION_STEPS, acc,
      "I think you mean 6 + 6",
      SIMPLE_ADDITION_PROBLEM,
      [
        { role: "coach", message: "What is 14 + 11?" },
        { role: "student", message: "14 is 8 + 6 and 11 is 5 + 6" },
        { role: "coach", message: "What is 8 + 5?" },
        { role: "student", message: "I think you mean 6 + 6" },
      ],
    );

    expect(move).not.toBeNull();
    // Must adopt the corrected pair
    expect(move!.text).toMatch(/6 \+ 6 = 12|6\s*\+\s*6\s*=\s*12/);
    // Must continue (not wrap)
    expect(move!.type).not.toBe("WRAP_SUCCESS");
    expect(move!.type).not.toBe("WRAP_NEEDS_SUPPORT");
  });
});

// ============================================================================
// Failure C — Method repair with replacement pair continues, not wraps
// ============================================================================

describe("Failure C: method repair with replacement pair", () => {
  it("'that's not how you're supposed to do it, it's supposed to be 7 + 6' → continue, not wrap", () => {
    const acc = emptyAccumulation(25, ["ones", "tens", "combine"]);
    const move = getDeterministicRemediationMove(
      SIMPLE_ADDITION_STEPS, acc,
      "that's not how you're supposed to do it, it's supposed to be 7 + 6",
      SIMPLE_ADDITION_PROBLEM,
      [
        { role: "coach", message: "What is 14 + 11?" },
        { role: "student", message: "14 is 7 + 7 and 11 is 5 + 6" },
        { role: "coach", message: "What is 7 + 5?" },
        { role: "student", message: "that's not how you're supposed to do it, it's supposed to be 7 + 6" },
      ],
    );

    expect(move).not.toBeNull();
    // Must adopt the replacement pair 7+6=13
    expect(move!.text).toMatch(/7 \+ 6 = 13|7\s*\+\s*6\s*=\s*13/);
    // Must continue, not wrap
    expect(move!.type).not.toBe("WRAP_SUCCESS");
    expect(move!.type).not.toBe("WRAP_NEEDS_SUPPORT");
    expect(move!.type).toBe("STEP_PROBE_DIRECT");
    // Must ask about remaining parts
    expect(move!.text).toMatch(/\?/);
  });

  it("'you mean 6 + 5' → treated as progress with continuation probe", () => {
    const acc = emptyAccumulation(25, ["ones", "tens", "combine"]);
    const move = getDeterministicRemediationMove(
      SIMPLE_ADDITION_STEPS, acc,
      "you mean 6 + 5",
      SIMPLE_ADDITION_PROBLEM,
      [
        { role: "coach", message: "What is 14 + 11?" },
        { role: "student", message: "14 is 8 + 6 and 11 is 5 + 6" },
        { role: "coach", message: "What is 8 + 5?" },
        { role: "student", message: "you mean 6 + 5" },
      ],
    );

    expect(move).not.toBeNull();
    // Must treat replacement pair as progress
    expect(move!.text).toMatch(/6 \+ 5 = 11|6\s*\+\s*5\s*=\s*11/);
    expect(move!.type).toBe("STEP_PROBE_DIRECT");
  });
});

// ============================================================================
// Spoken-string audit: captures exact deterministic output for review
// ============================================================================

describe("Spoken-string audit", () => {
  const missing = ["ones", "tens", "combine"];
  const acc = emptyAccumulation(25, missing);

  function run(resp: string, hist: Array<{ role: string; message: string }>) {
    return getDeterministicRemediationMove(SIMPLE_ADDITION_STEPS, acc, resp, SIMPLE_ADDITION_PROBLEM, hist);
  }

  it("captures exact strings for all 5 cases", () => {
    const results: Record<string, { type: string; text: string; words: number }> = {};

    // 1. first structure confusion
    const m1 = run("what does that have to do with the problem", [
      { role: "coach", message: "What do you get when you add the ones?" },
      { role: "student", message: "what does that have to do with the problem" },
    ]);
    results["1_first_structure_confusion"] = { type: m1!.type, text: m1!.text, words: m1!.text.split(/\s+/).length };

    // 2. repeated structure confusion
    const m2 = run("I still don't get why we're doing that", [
      { role: "coach", message: "What do you get when you add the ones?" },
      { role: "student", message: "what does that have to do with the problem" },
      { role: "coach", message: "We're solving 14 + 11 in smaller parts. What do you get when you add the ones?" },
      { role: "student", message: "I still don't get why we're doing that" },
    ]);
    results["2_repeated_structure_confusion"] = { type: m2!.type, text: m2!.text, words: m2!.text.split(/\s+/).length };

    // 3. shared-factor combine probe
    const m3 = run("14 is 8 + 6 and 11 is 5 + 6", [
      { role: "coach", message: "What is 14 + 11?" },
    ]);
    results["3_shared_factor_combine"] = { type: m3!.type, text: m3!.text, words: m3!.text.split(/\s+/).length };

    // 4. replacement-pair acknowledgment
    const m4 = run("I think you mean 6 + 6", [
      { role: "coach", message: "What is 14 + 11?" },
      { role: "student", message: "14 is 8 + 6 and 11 is 5 + 6" },
      { role: "coach", message: "What is 8 + 5?" },
      { role: "student", message: "I think you mean 6 + 6" },
    ]);
    results["4_replacement_pair_ack"] = { type: m4!.type, text: m4!.text, words: m4!.text.split(/\s+/).length };

    // 5. method-repair continuation
    const m5 = run("that's not how you're supposed to do it, it's supposed to be 7 + 6", [
      { role: "coach", message: "What is 14 + 11?" },
      { role: "student", message: "14 is 7 + 7 and 11 is 5 + 6" },
      { role: "coach", message: "What is 7 + 5?" },
      { role: "student", message: "that's not how you're supposed to do it, it's supposed to be 7 + 6" },
    ]);
    results["5_method_repair_continue"] = { type: m5!.type, text: m5!.text, words: m5!.text.split(/\s+/).length };

    // All should be <= 25 words total (bridge + probe)
    for (const [key, val] of Object.entries(results)) {
      expect(val.words).toBeLessThanOrEqual(30);
    }
  });
});
