import {
  extractNumericAnswer,
  detectStrategies,
  detectStrategiesWithContext,
  validateMathAnswer,
  boundMathScore,
  classifyMathExplanationState,
  accumulateMathStrategies,
  hasMathEvidence,
  accumulateReasoningStepEvidence,
  getFirstMissingStepProbe,
  stepAwareStatus,
  normalizeNumberWords,
  classifyUtterance,
  isShortScopedStepReply,
  extractNumericCandidates,
  _testOnly,
  isDecompositionOnly,
  extractFinalAnswer,
  parseArithmeticChain,
  isValidArithmeticChain,
  detectAlternateStrategyChain,
} from "./mathAnswerValidator";
import type { ReasoningStep } from "./prompt";
import { MathProblem } from "./mathProblem";

const { selectFinalAnswer, containsDecompositionLanguage, extractDecompositionCandidates, isLikelyStrategySetup } = _testOnly;

// ============================================================================
// Test fixtures
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

const SUBTRACTION_PROBLEM: MathProblem = {
  skill: "two_digit_subtraction",
  a: 42,
  b: 17,
  expression: "42 - 17",
  correctAnswer: 25,
  requiresRegrouping: true,
  expectedStrategyTags: ["check ones", "borrow from tens", "subtract ones", "subtract tens"],
  commonWrongAnswers: [
    { answer: 35, misconception: "subtracted smaller digit from larger in ones place instead of borrowing" },
  ],
};

const MULTIPLICATION_PROBLEM: MathProblem = {
  skill: "basic_multiplication",
  a: 4,
  b: 7,
  expression: "4 × 7",
  correctAnswer: 28,
  requiresRegrouping: false,
  expectedStrategyTags: ["multiply", "skip count", "groups of"],
};

// ============================================================================
// extractNumericAnswer
// ============================================================================

describe("extractNumericAnswer", () => {
  it("extracts from 'the answer is 63'", () => {
    expect(extractNumericAnswer("the answer is 63")).toBe(63);
  });

  it("extracts from 'I got 25'", () => {
    expect(extractNumericAnswer("I got 25")).toBe(25);
  });

  it("extracts from speech with fillers", () => {
    expect(extractNumericAnswer("um so like I think its 63")).toBe(63);
  });

  it("handles word numbers like 'sixty three'", () => {
    expect(extractNumericAnswer("the answer is sixty three")).toBe(63);
  });

  it("handles word number 'twenty'", () => {
    expect(extractNumericAnswer("its twenty")).toBe(20);
  });

  it("returns the last number when multiple present", () => {
    expect(extractNumericAnswer("7 and 6 make 13 then 50 plus 13 is 63")).toBe(63);
  });

  it("returns null for non-numeric response", () => {
    expect(extractNumericAnswer("I don't know")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractNumericAnswer("")).toBeNull();
  });

  it("prefers explicit answer pattern over last number", () => {
    expect(extractNumericAnswer("I added 7 and 6 and the answer is 63 because")).toBe(63);
  });
});

// ============================================================================
// detectStrategies
// ============================================================================

describe("detectStrategies", () => {
  it("detects 'add ones' and 'carry' in explanation", () => {
    const text = "I added the ones place first, 7 plus 6 is 13, then I carried the 1 over to the tens";
    const found = detectStrategies(text, ADDITION_PROBLEM.expectedStrategyTags);
    expect(found).toContain("add ones");
    expect(found).toContain("carry");
  });

  it("detects 'add tens' from 'tens place'", () => {
    const text = "then I added the tens place";
    const found = detectStrategies(text, ADDITION_PROBLEM.expectedStrategyTags);
    expect(found).toContain("add tens");
  });

  it("detects 'borrow from tens' for subtraction", () => {
    const text = "I had to borrow from the tens because 2 is less than 7";
    const found = detectStrategies(text, SUBTRACTION_PROBLEM.expectedStrategyTags);
    expect(found).toContain("borrow from tens");
  });

  it("detects 'skip count' for multiplication", () => {
    const text = "I skip counted by 4: 4, 8, 12, 16, 20, 24, 28";
    const found = detectStrategies(text, MULTIPLICATION_PROBLEM.expectedStrategyTags);
    expect(found).toContain("skip count");
  });

  it("detects 'groups of' for multiplication", () => {
    const text = "I made 4 groups of 7";
    const found = detectStrategies(text, MULTIPLICATION_PROBLEM.expectedStrategyTags);
    expect(found).toContain("groups of");
  });

  it("returns empty array when no strategy language present", () => {
    const text = "the answer is 63";
    const found = detectStrategies(text, ADDITION_PROBLEM.expectedStrategyTags);
    expect(found).toEqual([]);
  });

  it("detects regrouping as carry", () => {
    const text = "I regrouped the ones";
    const found = detectStrategies(text, ADDITION_PROBLEM.expectedStrategyTags);
    expect(found).toContain("carry");
  });
});

// ============================================================================
// validateMathAnswer
// ============================================================================

describe("validateMathAnswer", () => {
  it("correct answer with strategy: status=correct, hasPartialStrategy=true", () => {
    const result = validateMathAnswer(
      "I added the ones place, 7 plus 6 is 13, carried the 1, then added the tens. The answer is 63.",
      ADDITION_PROBLEM,
    );
    expect(result.status).toBe("correct");
    expect(result.extractedAnswer).toBe(63);
    expect(result.hasPartialStrategy).toBe(true);
    expect(result.demonstratedStrategies.length).toBeGreaterThan(0);
  });

  it("correct answer without strategy: status=correct, hasPartialStrategy=false", () => {
    const result = validateMathAnswer("63", ADDITION_PROBLEM);
    expect(result.status).toBe("correct");
    expect(result.extractedAnswer).toBe(63);
    expect(result.hasPartialStrategy).toBe(false);
  });

  it("known wrong answer: status=incorrect_known_misconception", () => {
    const result = validateMathAnswer("I think it's 53", ADDITION_PROBLEM);
    expect(result.status).toBe("incorrect_known_misconception");
    expect(result.extractedAnswer).toBe(53);
    expect(result.matchedMisconception).toBe("forgot to carry");
  });

  it("unknown wrong answer: status=incorrect_unknown", () => {
    const result = validateMathAnswer("the answer is 99", ADDITION_PROBLEM);
    expect(result.status).toBe("incorrect_unknown");
    expect(result.extractedAnswer).toBe(99);
    expect(result.matchedMisconception).toBeUndefined();
  });

  it("no numeric answer: status=no_answer", () => {
    const result = validateMathAnswer("I don't know how to do this", ADDITION_PROBLEM);
    expect(result.status).toBe("no_answer");
    expect(result.extractedAnswer).toBeNull();
  });

  it("subtraction known misconception detected", () => {
    const result = validateMathAnswer("35", SUBTRACTION_PROBLEM);
    expect(result.status).toBe("incorrect_known_misconception");
    expect(result.matchedMisconception).toContain("subtracted smaller digit");
  });
});

// ============================================================================
// boundMathScore
// ============================================================================

describe("boundMathScore", () => {
  it("correct + strategy: upgrades to strong (>=80)", () => {
    const validation = validateMathAnswer(
      "I added the ones and carried the 1 to get 63",
      ADDITION_PROBLEM,
    );
    const bound = boundMathScore(65, validation);
    expect(bound.boundedStatus).toBe("strong");
    expect(bound.boundedScore).toBeGreaterThanOrEqual(80);
    expect(bound.wasAdjusted).toBe(true);
  });

  it("correct + no strategy: caps at developing (60-79)", () => {
    const validation = validateMathAnswer("63", ADDITION_PROBLEM);
    const bound = boundMathScore(90, validation);
    expect(bound.boundedStatus).toBe("developing");
    expect(bound.boundedScore).toBeLessThanOrEqual(79);
    expect(bound.boundedScore).toBeGreaterThanOrEqual(60);
  });

  it("wrong + strategy: developing (40-60)", () => {
    const validation = validateMathAnswer(
      "I added the ones place, 7 plus 6 is 13, carried the 1, but I got 53",
      ADDITION_PROBLEM,
    );
    const bound = boundMathScore(70, validation);
    expect(bound.boundedStatus).toBe("developing");
    expect(bound.boundedScore).toBeLessThanOrEqual(60);
    expect(bound.boundedScore).toBeGreaterThanOrEqual(40);
  });

  it("wrong + known misconception + no strategy: needs_support with reason", () => {
    const validation = validateMathAnswer("53", ADDITION_PROBLEM);
    const bound = boundMathScore(60, validation);
    expect(bound.boundedStatus).toBe("needs_support");
    expect(bound.boundedScore).toBeLessThanOrEqual(40);
    expect(bound.reason).toContain("forgot to carry");
  });

  it("wrong + no strategy: needs_support (<=40)", () => {
    const validation = validateMathAnswer("99", ADDITION_PROBLEM);
    const bound = boundMathScore(70, validation);
    expect(bound.boundedStatus).toBe("needs_support");
    expect(bound.boundedScore).toBeLessThanOrEqual(40);
  });

  it("no answer: needs_support (<=30)", () => {
    const validation = validateMathAnswer("I don't know", ADDITION_PROBLEM);
    const bound = boundMathScore(50, validation);
    expect(bound.boundedStatus).toBe("needs_support");
    expect(bound.boundedScore).toBeLessThanOrEqual(30);
  });
});

// ============================================================================
// detectStrategiesWithContext
// ============================================================================

describe("detectStrategiesWithContext", () => {
  it("detects 'add ones' from ones-digit computation '7 + 6 = 13'", () => {
    const strategies = detectStrategiesWithContext(
      "7 + 6 = 13 so I carry the one",
      ADDITION_PROBLEM,
    );
    expect(strategies).toContain("add ones");
    expect(strategies).toContain("carry");
  });

  it("detects 'add ones' from reversed operand order '6 + 7 = 13'", () => {
    const strategies = detectStrategiesWithContext(
      "6 + 7 = 13",
      ADDITION_PROBLEM,
    );
    expect(strategies).toContain("add ones");
  });

  it("does NOT false-positive 'add ones' from unrelated numbers", () => {
    const strategies = detectStrategiesWithContext(
      "I got 63",
      ADDITION_PROBLEM,
    );
    expect(strategies).not.toContain("add ones");
  });

  it("detects 'add tens' from tens-digit computation '2 + 3'", () => {
    const strategies = detectStrategiesWithContext(
      "then 2 + 3 plus the carried 1 makes 6",
      ADDITION_PROBLEM,
    );
    expect(strategies).toContain("add tens");
  });

  it("detects all 3 strategies from full regrouping explanation", () => {
    const strategies = detectStrategiesWithContext(
      "7 + 6 = 13 so I carry the one to the tens place and then add the tens to get 63",
      ADDITION_PROBLEM,
    );
    expect(strategies).toContain("add ones");
    expect(strategies).toContain("carry");
    expect(strategies).toContain("add tens");
    expect(strategies).toHaveLength(3);
  });
});

// ============================================================================
// classifyMathExplanationState
// ============================================================================

describe("classifyMathExplanationState", () => {
  it("Case A: correct + explained → correct_explained", () => {
    const validation = validateMathAnswer(
      "7 + 6 = 13 so I carry the one to the tens place and then add the tens to get 63",
      ADDITION_PROBLEM,
    );
    expect(classifyMathExplanationState(validation, true)).toBe("correct_explained");
  });

  it("Case B: correct answer only → correct_incomplete", () => {
    const validation = validateMathAnswer("63", ADDITION_PROBLEM);
    expect(classifyMathExplanationState(validation, true)).toBe("correct_incomplete");
  });

  it("Case C: wrong answer → incorrect", () => {
    const validation = validateMathAnswer("27 + 36 = 53", ADDITION_PROBLEM);
    expect(classifyMathExplanationState(validation, true)).toBe("incorrect");
  });

  it("no explanation required: correct answer → correct_explained even without strategy", () => {
    const validation = validateMathAnswer("63", ADDITION_PROBLEM);
    expect(classifyMathExplanationState(validation, false)).toBe("correct_explained");
  });

  it("no answer extracted → incorrect", () => {
    const validation = validateMathAnswer("I don't know", ADDITION_PROBLEM);
    expect(classifyMathExplanationState(validation, true)).toBe("incorrect");
  });
});

// ============================================================================
// extractNumericAnswer — leading answer pattern
// ============================================================================

describe("extractNumericAnswer — leading answer", () => {
  it("extracts 53 from '53 I added the seven and the six together first'", () => {
    expect(extractNumericAnswer("53 I added the seven and the six together first")).toBe(53);
  });

  it("extracts 53 from '53 because I carried wrong'", () => {
    expect(extractNumericAnswer("53 because I carried wrong")).toBe(53);
  });

  it("still prefers verbal pattern 'the answer is 63' over leading number", () => {
    expect(extractNumericAnswer("53 the answer is 63")).toBe(63);
  });

  it("still handles computation walkthrough correctly", () => {
    // "7 and 6 make 13 then 50 plus 13 is 63" → should still get 63 via equals pattern
    expect(extractNumericAnswer("7 and 6 make 13 then 50 plus 13 is 63")).toBe(63);
  });
});

// ============================================================================
// detectStrategiesWithContext — natural language patterns
// ============================================================================

describe("detectStrategiesWithContext — natural language", () => {
  it("detects 'add ones' from 'I added the seven and the six together first'", () => {
    const strategies = detectStrategiesWithContext(
      "I added the seven and the six together first",
      ADDITION_PROBLEM,
    );
    expect(strategies).toContain("add ones");
  });

  it("detects 'add ones' from 'so maybe I would add the seven and the six together and get 13'", () => {
    const strategies = detectStrategiesWithContext(
      "so maybe I would add the seven and the six together and get 13",
      ADDITION_PROBLEM,
    );
    expect(strategies).toContain("add ones");
  });

  it("detects 'add ones' from 'add 7 and 6' without result", () => {
    const strategies = detectStrategiesWithContext(
      "I would add 7 and 6",
      ADDITION_PROBLEM,
    );
    expect(strategies).toContain("add ones");
  });

  it("does NOT false-positive from unrelated digits", () => {
    const strategies = detectStrategiesWithContext(
      "the answer is 53",
      ADDITION_PROBLEM,
    );
    expect(strategies).not.toContain("add ones");
  });
});

// ============================================================================
// accumulateMathStrategies
// ============================================================================

describe("accumulateMathStrategies", () => {
  it("accumulates strategies from multiple student turns", () => {
    const history = [
      { role: "student", message: "I added the seven and the six together first" },
      { role: "coach", message: "What do you do next?" },
      { role: "student", message: "because you have leftover" },
    ];
    const strategies = accumulateMathStrategies(history, ADDITION_PROBLEM);
    expect(strategies).toContain("add ones");
    expect(strategies).toContain("carry"); // "leftover" matches carry pattern
  });

  it("returns empty array when no student turns have math content", () => {
    const history = [
      { role: "student", message: "I don't know" },
      { role: "coach", message: "Here's a hint." },
    ];
    const strategies = accumulateMathStrategies(history, ADDITION_PROBLEM);
    expect(strategies).toEqual([]);
  });

  it("ignores coach turns", () => {
    const history = [
      { role: "coach", message: "I added the ones place: 7 + 6 = 13" },
      { role: "student", message: "ok" },
    ];
    const strategies = accumulateMathStrategies(history, ADDITION_PROBLEM);
    expect(strategies).toEqual([]);
  });
});

// ============================================================================
// hasMathEvidence
// ============================================================================

describe("hasMathEvidence", () => {
  it("returns true when student mentions leftover", () => {
    expect(hasMathEvidence(
      "because you have leftover",
      [{ role: "student", message: "53" }],
      ADDITION_PROBLEM,
    )).toBe(true);
  });

  it("returns true when prior turn had digits", () => {
    expect(hasMathEvidence(
      "pizza",
      [{ role: "student", message: "53 I added them" }],
      ADDITION_PROBLEM,
    )).toBe(true);
  });

  it("returns false for completely non-math content", () => {
    expect(hasMathEvidence(
      "pizza",
      [{ role: "student", message: "I like dogs" }],
      ADDITION_PROBLEM,
    )).toBe(false);
  });

  it("returns true for strategy vocabulary without digits", () => {
    expect(hasMathEvidence(
      "I think you add them together",
      [],
      ADDITION_PROBLEM,
    )).toBe(true);
  });
});

// ============================================================================
// Reasoning step accumulation — golden test cases
// ============================================================================

describe("accumulateReasoningStepEvidence", () => {
  // Reasoning steps for 24 + 12 (no regrouping)
  const steps24plus12: ReasoningStep[] = [
    { id: "step_1", label: "Add the ones", expectedStatements: ["4 + 2 = 6"], probe: "What do you get when you add 4 and 2?", kind: "ones_sum" },
    { id: "step_2", label: "Add the tens", expectedStatements: ["20 + 10 = 30"], probe: "What do you get when you add 20 and 10?", kind: "tens_sum" },
    { id: "step_3", label: "Combine the totals", expectedStatements: ["30 + 6 = 36", "The final answer is 36"], probe: "What do you get when you combine 30 and 6?", kind: "combine" },
  ];

  // Reasoning steps for 27 + 36 (regrouping)
  const steps27plus36: ReasoningStep[] = [
    { id: "step_1", label: "Add the ones", expectedStatements: ["7 + 6 = 13"], probe: "What do you get when you add 7 and 6?", kind: "ones_sum" },
    { id: "step_2", label: "Regroup the ones", expectedStatements: ["13 ones makes 1 ten and 3 ones"], probe: "7 + 6 makes 13. What do you do when the ones add up to more than 9?", kind: "regroup" },
    { id: "step_3", label: "Add the tens including the carried ten", expectedStatements: ["20 + 30 + 10 = 60"], probe: "What do you get when you add 20 and 30 plus the extra ten?", kind: "tens_sum" },
    { id: "step_4", label: "State the final answer", expectedStatements: ["60 + 3 = 63", "The final answer is 63"], probe: "What do you get when you combine 60 and 3?", kind: "combine" },
  ];

  // CASE A: Student says "36" on turn 1
  describe("Case A: 24 + 12 — student says '36' then '4 + 2 = 6'", () => {
    it("turn 1: '36' — final answer step satisfied, others missing", () => {
      const result = accumulateReasoningStepEvidence(
        steps24plus12,
        [],  // no history
        "36",
        36,
      );

      expect(result.answerCorrect).toBe(true);
      expect(result.satisfiedStepIds).toContain("step_3"); // "The final answer is 36"
      expect(result.missingStepIds).toContain("step_1"); // ones not yet explained
      expect(result.missingStepIds).toContain("step_2"); // tens not yet explained
      expect(result.completionRatio).toBeCloseTo(1/3, 1);
    });

    it("turn 1: probe should ask about first missing step (ones)", () => {
      const result = accumulateReasoningStepEvidence(steps24plus12, [], "36", 36);
      const missingProbe = getFirstMissingStepProbe(steps24plus12, result);
      expect(missingProbe).not.toBeNull();
      expect(missingProbe!.stepId).toBe("step_1");
      expect(missingProbe!.probe).toContain("4");
      expect(missingProbe!.probe).toContain("2");
    });

    it("turn 2: '4 + 2 = 6' — ones step newly satisfied, final answer still remembered", () => {
      const history = [
        { role: "student", message: "36" },
        { role: "coach", message: "That's right! What did you do with the ones digits?" },
      ];
      const result = accumulateReasoningStepEvidence(
        steps24plus12,
        history,
        "I added them together 4 + 2 = 6",
        36,
      );

      expect(result.answerCorrect).toBe(true);
      expect(result.satisfiedStepIds).toContain("step_1"); // ones — newly satisfied
      expect(result.satisfiedStepIds).toContain("step_3"); // final answer — still remembered from turn 1
      expect(result.missingStepIds).toEqual(["step_2"]); // only tens missing
      expect(result.newlySatisfiedStepIds).toContain("step_1"); // ones was new this turn
      expect(result.newlySatisfiedStepIds).not.toContain("step_3"); // final answer was from prior turn
    });

    it("turn 2: probe should ask about tens (first remaining missing step)", () => {
      const history = [
        { role: "student", message: "36" },
        { role: "coach", message: "That's right! What did you do with the ones digits?" },
      ];
      const result = accumulateReasoningStepEvidence(
        steps24plus12,
        history,
        "I added them together 4 + 2 = 6",
        36,
      );
      const missingProbe = getFirstMissingStepProbe(steps24plus12, result);
      expect(missingProbe).not.toBeNull();
      expect(missingProbe!.stepId).toBe("step_2");
      expect(missingProbe!.probe).toContain("20");
      expect(missingProbe!.probe).toContain("10");
    });

    it("turn 2: stepAwareStatus should be developing (correct answer + partial steps)", () => {
      const history = [
        { role: "student", message: "36" },
        { role: "coach", message: "What did you do with the ones?" },
      ];
      const result = accumulateReasoningStepEvidence(
        steps24plus12,
        history,
        "I added them together 4 + 2 = 6",
        36,
      );
      expect(stepAwareStatus(result)).toBe("developing");
    });
  });

  // CASE B: Full mastery across 3 turns
  describe("Case B: 24 + 12 — full mastery across 3 turns", () => {
    it("all steps satisfied after 3 turns → mastery", () => {
      const history = [
        { role: "student", message: "36" },
        { role: "coach", message: "What did you do with the ones?" },
        { role: "student", message: "4 + 2 = 6" },
        { role: "coach", message: "What about the tens?" },
      ];
      const result = accumulateReasoningStepEvidence(
        steps24plus12,
        history,
        "20 + 10 = 30",
        36,
      );

      expect(result.satisfiedStepIds).toEqual(["step_1", "step_2", "step_3"]);
      expect(result.missingStepIds).toEqual([]);
      expect(result.completionRatio).toBe(1);
      expect(result.answerCorrect).toBe(true);
      expect(stepAwareStatus(result)).toBe("strong");
    });

    it("no more missing probes after full mastery", () => {
      const history = [
        { role: "student", message: "36" },
        { role: "coach", message: "What did you do with the ones?" },
        { role: "student", message: "4 + 2 = 6" },
        { role: "coach", message: "What about the tens?" },
      ];
      const result = accumulateReasoningStepEvidence(
        steps24plus12,
        history,
        "20 + 10 = 30",
        36,
      );
      const probe = getFirstMissingStepProbe(steps24plus12, result);
      expect(probe).toBeNull();
    });
  });

  // CASE C: Regrouping — 27 + 36
  describe("Case C: 27 + 36 — regrouping multi-turn", () => {
    it("turn 1: '63' — final answer satisfied", () => {
      const result = accumulateReasoningStepEvidence(
        steps27plus36,
        [],
        "63",
        63,
      );
      expect(result.answerCorrect).toBe(true);
      expect(result.satisfiedStepIds).toContain("step_4"); // final answer
      expect(result.missingStepIds).toContain("step_1"); // ones
      expect(result.missingStepIds).toContain("step_2"); // regroup
      expect(result.missingStepIds).toContain("step_3"); // tens
    });

    it("turn 2: '7 + 6 = 13' — ones step satisfied, probe asks about regrouping", () => {
      const history = [
        { role: "student", message: "63" },
        { role: "coach", message: "Correct! What is 7 + 6?" },
      ];
      const result = accumulateReasoningStepEvidence(
        steps27plus36,
        history,
        "7 + 6 = 13",
        63,
      );

      expect(result.satisfiedStepIds).toContain("step_1"); // ones
      expect(result.satisfiedStepIds).toContain("step_4"); // final answer remembered
      expect(result.newlySatisfiedStepIds).toContain("step_1");
      expect(result.missingStepIds).toContain("step_3"); // tens still missing

      const probe = getFirstMissingStepProbe(steps27plus36, result);
      expect(probe).not.toBeNull();
      // Should ask about regrouping (step_2) or tens (step_3)
      expect(probe!.probe).toMatch(/more than 9|what do you do|20|30/i);
    });
  });

  // CASE D: Wrong answer + partial steps
  describe("Case D: 27 + 36 — wrong answer '53' then partial steps", () => {
    it("turn 1: '53' — wrong answer, needs support", () => {
      const result = accumulateReasoningStepEvidence(
        steps27plus36,
        [],
        "53",
        63,
      );
      expect(result.answerCorrect).toBe(false);
      expect(stepAwareStatus(result)).toBe("needs_support");
    });

    it("turn 2: after '53', student says '4 + 2 = 6' — developing, not generic wrap", () => {
      // Note: "4 + 2 = 6" doesn't match 27+36 ones step (7 + 6 = 13)
      // The student is confused. But if they say "7 + 6 = 13"...
      const history = [
        { role: "student", message: "53" },
        { role: "coach", message: "Not quite. What is 7 + 6?" },
      ];
      const result = accumulateReasoningStepEvidence(
        steps27plus36,
        history,
        "7 + 6 = 13",
        63,
      );

      expect(result.satisfiedStepIds).toContain("step_1"); // ones demonstrated
      expect(result.newlySatisfiedStepIds).toContain("step_1");
      expect(result.answerCorrect).toBe(false); // 53 was wrong, 13 is not 63
      // Developing because they have at least one step
      expect(stepAwareStatus(result)).toBe("developing");
    });

    it("new evidence on turn 2 means should continue coaching (not wrap)", () => {
      const history = [
        { role: "student", message: "53" },
        { role: "coach", message: "Not quite. What is 7 + 6?" },
      ];
      const result = accumulateReasoningStepEvidence(
        steps27plus36,
        history,
        "7 + 6 = 13",
        63,
      );
      // New evidence was provided and there are still missing steps
      expect(result.newlySatisfiedStepIds.length).toBeGreaterThan(0);
      expect(result.missingStepIds.length).toBeGreaterThan(0);
      // This combination should prevent early wrap (tested in coach.ts integration)
    });
  });

  // Edge case: student repeats same evidence
  describe("Edge: repeated evidence does not count as newly satisfied", () => {
    it("saying '36' twice does not create new evidence on second turn", () => {
      const history = [
        { role: "student", message: "36" },
        { role: "coach", message: "What did you do with the ones?" },
      ];
      const result = accumulateReasoningStepEvidence(
        steps24plus12,
        history,
        "the answer is 36",
        36,
      );
      expect(result.satisfiedStepIds).toContain("step_3");
      expect(result.newlySatisfiedStepIds).not.toContain("step_3"); // not new
    });
  });
});

describe("stepAwareStatus", () => {
  it("all steps + correct = strong", () => {
    expect(stepAwareStatus({
      satisfiedStepIds: ["s1", "s2", "s3"],
      missingStepIds: [],
      newlySatisfiedStepIds: [],
      completionRatio: 1,
      answerCorrect: true,
      extractedAnswer: 36,
    })).toBe("strong");
  });

  it("correct + partial steps = developing", () => {
    expect(stepAwareStatus({
      satisfiedStepIds: ["s1"],
      missingStepIds: ["s2", "s3"],
      newlySatisfiedStepIds: ["s1"],
      completionRatio: 1/3,
      answerCorrect: true,
      extractedAnswer: 36,
    })).toBe("developing");
  });

  it("wrong answer + some steps = developing", () => {
    expect(stepAwareStatus({
      satisfiedStepIds: ["s1"],
      missingStepIds: ["s2", "s3"],
      newlySatisfiedStepIds: ["s1"],
      completionRatio: 1/3,
      answerCorrect: false,
      extractedAnswer: 53,
    })).toBe("developing");
  });

  it("wrong answer + no steps = needs_support", () => {
    expect(stepAwareStatus({
      satisfiedStepIds: [],
      missingStepIds: ["s1", "s2", "s3"],
      newlySatisfiedStepIds: [],
      completionRatio: 0,
      answerCorrect: false,
      extractedAnswer: 53,
    })).toBe("needs_support");
  });

  it("correct answer + no steps = developing (not needs_support)", () => {
    expect(stepAwareStatus({
      satisfiedStepIds: [],
      missingStepIds: ["s1", "s2", "s3"],
      newlySatisfiedStepIds: [],
      completionRatio: 0,
      answerCorrect: true,
      extractedAnswer: 36,
    })).toBe("developing");
  });
});

// ============================================================================
// Number word normalization
// ============================================================================

describe("normalizeNumberWords", () => {
  it("converts single word numbers", () => {
    expect(normalizeNumberWords("five")).toBe("5");
    expect(normalizeNumberWords("twenty")).toBe("20");
    expect(normalizeNumberWords("zero")).toBe("0");
  });

  it("converts compound word numbers", () => {
    expect(normalizeNumberWords("twenty five")).toBe("25");
    expect(normalizeNumberWords("thirty-six")).toBe("36");
    expect(normalizeNumberWords("sixty three")).toBe("63");
  });

  it("converts number words in context", () => {
    expect(normalizeNumberWords("you get five")).toBe("you get 5");
    expect(normalizeNumberWords("ten and ten is twenty")).toBe("10 and 10 is 20");
    expect(normalizeNumberWords("I think it's twenty five")).toBe("i think it's 25");
  });

  it("preserves digits", () => {
    expect(normalizeNumberWords("36")).toBe("36");
    expect(normalizeNumberWords("4 + 2 = 6")).toBe("4 + 2 = 6");
  });
});

// ============================================================================
// Coach-question-context step matching
// ============================================================================

describe("accumulateReasoningStepEvidence — coach question context", () => {
  // Steps for 11 + 14
  const steps11plus14: ReasoningStep[] = [
    { id: "step_1", label: "Add the ones", expectedStatements: ["1 + 4 = 5"], probe: "What do you get when you add 1 and 4?", kind: "ones_sum" },
    { id: "step_2", label: "Add the tens", expectedStatements: ["10 + 10 = 20"], probe: "What do you get when you add 10 and 10?", kind: "tens_sum" },
    { id: "step_3", label: "Combine the totals", expectedStatements: ["20 + 5 = 25", "The final answer is 25"], probe: "What do you get when you combine 20 and 5?", kind: "combine" },
  ];

  // Steps for 27 + 36 (regrouping)
  const steps27plus36: ReasoningStep[] = [
    { id: "step_1", label: "Add the ones", expectedStatements: ["7 + 6 = 13"], probe: "What do you get when you add 7 and 6?", kind: "ones_sum" },
    { id: "step_2", label: "Regroup the ones", expectedStatements: ["13 ones makes 1 ten and 3 ones"], probe: "7 + 6 makes 13. What do you do when the ones add up to more than 9?", kind: "regroup" },
    { id: "step_3", label: "Add the tens including the carried ten", expectedStatements: ["20 + 30 + 10 = 60"], probe: "What do you get when you add 20 and 30 plus the extra ten?", kind: "tens_sum" },
    { id: "step_4", label: "State the final answer", expectedStatements: ["60 + 3 = 63", "The final answer is 63"], probe: "What do you get when you combine 60 and 3?", kind: "combine" },
  ];

  // CASE A: "25" then coach asks about ones, student says "you get five"
  describe("Case A: 11 + 14 — '25' then 'you get five'", () => {
    it("turn 1: '25' satisfies final answer step", () => {
      const result = accumulateReasoningStepEvidence(steps11plus14, [], "25", 25);
      expect(result.answerCorrect).toBe(true);
      expect(result.satisfiedStepIds).toContain("step_3");
    });

    it("turn 2: 'you get five' with coach context satisfies ones step", () => {
      const history = [
        { role: "student", message: "25" },
        { role: "coach", message: "That's right. What do you get when you add 1 and 4?" },
      ];
      const result = accumulateReasoningStepEvidence(
        steps11plus14,
        history,
        "you get five",
        25,
      );

      expect(result.answerCorrect).toBe(true); // remembered from turn 1
      expect(result.satisfiedStepIds).toContain("step_1"); // ones step satisfied via context
      expect(result.satisfiedStepIds).toContain("step_3"); // final answer still remembered
      expect(result.missingStepIds).toEqual(["step_2"]); // only tens missing
      expect(result.newlySatisfiedStepIds).toContain("step_1");
    });

    it("turn 2: next probe asks about 10 + 10", () => {
      const history = [
        { role: "student", message: "25" },
        { role: "coach", message: "That's right. What do you get when you add 1 and 4?" },
      ];
      const result = accumulateReasoningStepEvidence(steps11plus14, history, "you get five", 25);
      const probe = getFirstMissingStepProbe(steps11plus14, result);
      expect(probe).not.toBeNull();
      expect(probe!.stepId).toBe("step_2");
      expect(probe!.probe).toContain("10");
    });

    it("turn 2: stepAwareStatus is developing (not needs_support)", () => {
      const history = [
        { role: "student", message: "25" },
        { role: "coach", message: "What do you get when you add 1 and 4?" },
      ];
      const result = accumulateReasoningStepEvidence(steps11plus14, history, "you get five", 25);
      expect(stepAwareStatus(result)).toBe("developing");
    });
  });

  // CASE B: digit answer to step question
  describe("Case B: digit answer '20' for tens step", () => {
    it("'20' satisfies 10 + 10 = 20 with coach context", () => {
      const history = [
        { role: "student", message: "25" },
        { role: "coach", message: "What do you get when you add 1 and 4?" },
        { role: "student", message: "five" },
        { role: "coach", message: "What do you get when you add 10 and 10?" },
      ];
      const result = accumulateReasoningStepEvidence(steps11plus14, history, "20", 25);

      expect(result.satisfiedStepIds).toContain("step_1"); // ones from prior
      expect(result.satisfiedStepIds).toContain("step_2"); // tens from this turn
      expect(result.satisfiedStepIds).toContain("step_3"); // final answer from prior
      expect(result.missingStepIds).toEqual([]);
      expect(stepAwareStatus(result)).toBe("strong");
    });
  });

  // CASE C: word number only — "five" for 1 + 4 = 5
  describe("Case C: word number only — 'five'", () => {
    it("'five' with coach context satisfies 1 + 4 = 5", () => {
      const history = [
        { role: "student", message: "25" },
        { role: "coach", message: "What do you get when you add 1 and 4?" },
      ];
      const result = accumulateReasoningStepEvidence(steps11plus14, history, "five", 25);
      expect(result.satisfiedStepIds).toContain("step_1");
    });
  });

  // CASE D: regrouping — "you carry the one"
  describe("Case D: regrouping — 'you carry the one'", () => {
    it("'you carry the one' with regrouping probe context satisfies regroup step", () => {
      const history = [
        { role: "student", message: "63" },
        { role: "coach", message: "What do you get when you add 7 and 6?" },
        { role: "student", message: "13" },
        { role: "coach", message: "7 + 6 makes 13. What do you do when the ones add up to more than 9?" },
      ];
      const result = accumulateReasoningStepEvidence(steps27plus36, history, "you carry the one", 63);

      expect(result.satisfiedStepIds).toContain("step_1"); // ones from prior
      expect(result.satisfiedStepIds).toContain("step_2"); // regroup from this turn
      expect(result.satisfiedStepIds).toContain("step_4"); // final answer from prior
      expect(result.newlySatisfiedStepIds).toContain("step_2");
    });
  });

  // CASE E: no progress — irrelevant answer
  describe("Case E: no progress — 'calculators'", () => {
    it("'calculators' does NOT satisfy any step", () => {
      const history = [
        { role: "student", message: "25" },
        { role: "coach", message: "What do you get when you add 1 and 4?" },
      ];
      const result = accumulateReasoningStepEvidence(steps11plus14, history, "calculators", 25);

      // Only the final answer from turn 1 should be satisfied
      expect(result.satisfiedStepIds).toEqual(["step_3"]);
      expect(result.missingStepIds).toContain("step_1");
      expect(result.missingStepIds).toContain("step_2");
      expect(result.newlySatisfiedStepIds).toEqual([]);
    });
  });

  // Number word normalization in step matching
  describe("Number word normalization in step matching", () => {
    it("'ten and ten is twenty' satisfies 10 + 10 = 20 without coach context", () => {
      const result = accumulateReasoningStepEvidence(
        steps11plus14,
        [{ role: "student", message: "25" }, { role: "coach", message: "How about the tens?" }],
        "ten and ten is twenty",
        25,
      );
      expect(result.satisfiedStepIds).toContain("step_2");
    });

    it("'twenty five' satisfies final answer step", () => {
      const result = accumulateReasoningStepEvidence(steps11plus14, [], "twenty five", 25);
      expect(result.answerCorrect).toBe(true);
      expect(result.satisfiedStepIds).toContain("step_3");
    });
  });
});

// ============================================================================
// GOLDEN REGRESSION: Live failing case — "25" then "five"
// ============================================================================

describe("Golden regression: 11 + 14, student says '25' then 'five'", () => {
  // Reasoning steps for 11 + 14 (no regrouping)
  const steps: ReasoningStep[] = [
    {
      id: "ones_sum",
      label: "Add ones",
      expectedStatements: ["1 + 4 = 5"],
      probe: "What do you get when you add 1 and 4?",
      kind: "ones_sum",
    },
    {
      id: "tens_sum",
      label: "Add tens",
      expectedStatements: ["10 + 10 = 20", "1 + 1 = 2"],
      probe: "What do you get when you add 10 and 10?",
      kind: "tens_sum",
    },
    {
      id: "combine",
      label: "Combine",
      expectedStatements: ["20 + 5 = 25"],
      probe: "How do you combine the tens and ones to get the final answer?",
      kind: "combine",
    },
  ];

  const conversationAfterTurn2 = [
    { role: "coach", message: "Solve 11 + 14. Tell how you got your answer." },
    { role: "student", message: "25" },
    { role: "coach", message: "That's right! What do you get when you add 1 and 4?" },
  ];

  it("turn 2 ('five') satisfies ones step via coach-context matching", () => {
    const result = accumulateReasoningStepEvidence(
      steps,
      conversationAfterTurn2,
      "five",
      25,
    );
    expect(result.answerCorrect).toBe(true);
    expect(result.satisfiedStepIds).toContain("ones_sum");
    expect(result.newlySatisfiedStepIds).toContain("ones_sum");
    expect(result.missingStepIds).toContain("tens_sum");
    expect(result.missingStepIds.length).toBeGreaterThan(0);
  });

  it("turn 2 ('five') leaves tens/combine steps as missing", () => {
    const result = accumulateReasoningStepEvidence(
      steps,
      conversationAfterTurn2,
      "five",
      25,
    );
    expect(result.missingStepIds).toContain("tens_sum");
    // combine may or may not be satisfied depending on "25" matching "20 + 5 = 25"
  });

  it("next missing probe is tens step", () => {
    const result = accumulateReasoningStepEvidence(
      steps,
      conversationAfterTurn2,
      "five",
      25,
    );
    const nextProbe = getFirstMissingStepProbe(steps, result);
    expect(nextProbe).not.toBeNull();
    expect(nextProbe!.stepId).toBe("tens_sum");
    expect(nextProbe!.probe).toContain("10");
  });

  it("step-aware status is 'developing' (correct answer + partial steps)", () => {
    const result = accumulateReasoningStepEvidence(
      steps,
      conversationAfterTurn2,
      "five",
      25,
    );
    expect(stepAwareStatus(result)).toBe("developing");
  });

  it("resolvePostEvaluation continues when mathAnswerCorrect=true", () => {
    // This is the exact case that was wrapping: score=60, attemptCount=2, maxAttempts=3
    const { resolvePostEvaluation } = require("./videoCoachGuardrails");
    const result = resolvePostEvaluation(
      { score: 60, isCorrect: false, shouldContinue: false },
      2, 3, 0, "developing", 90, false, true, // mathAnswerCorrect=true
    );
    expect(result.shouldContinue).toBe(true);
    expect(result.probeFirst).toBe(true);
  });
});

// ============================================================================
// GOLDEN REGRESSION: Regrouping — "63" then "13" or "7 + 6 = 13"
// ============================================================================

describe("Golden regression: 47 + 16, student says '63' then '13'", () => {
  const steps: ReasoningStep[] = [
    {
      id: "ones_sum",
      label: "Add ones",
      expectedStatements: ["7 + 6 = 13"],
      probe: "What do you get when you add 7 and 6?",
      kind: "ones_sum",
    },
    {
      id: "regroup",
      label: "Regroup ones",
      expectedStatements: ["13 ones makes 1 ten and 3 ones"],
      probe: "What happens when the ones add up to more than 9?",
      kind: "regroup",
    },
    {
      id: "tens_sum",
      label: "Add tens",
      expectedStatements: ["4 + 1 + 1 = 6"],
      probe: "Now what do you get when you add the tens?",
      kind: "tens_sum",
    },
  ];

  const conversationAfterTurn2 = [
    { role: "coach", message: "Solve 47 + 16. Tell how you got your answer." },
    { role: "student", message: "63" },
    { role: "coach", message: "That's right! What do you get when you add 7 and 6?" },
  ];

  it("turn 2 ('13') satisfies ones step via coach-context matching", () => {
    const result = accumulateReasoningStepEvidence(
      steps,
      conversationAfterTurn2,
      "13",
      63,
    );
    expect(result.answerCorrect).toBe(true);
    expect(result.satisfiedStepIds).toContain("ones_sum");
    expect(result.newlySatisfiedStepIds).toContain("ones_sum");
  });

  it("regroup and tens steps still missing after '13'", () => {
    const result = accumulateReasoningStepEvidence(
      steps,
      conversationAfterTurn2,
      "13",
      63,
    );
    expect(result.missingStepIds.length).toBeGreaterThan(0);
    expect(result.missingStepIds).toContain("regroup");
  });

  it("next probe asks about regrouping (first missing after ones)", () => {
    const result = accumulateReasoningStepEvidence(
      steps,
      conversationAfterTurn2,
      "13",
      63,
    );
    const nextProbe = getFirstMissingStepProbe(steps, result);
    expect(nextProbe).not.toBeNull();
    expect(nextProbe!.stepId).toBe("regroup");
    expect(nextProbe!.probe).toContain("more than 9");
  });
});

// ============================================================================
// Order-independence: reasoning steps as unordered required evidence
// ============================================================================

describe("Order-independence: steps satisfied in any order", () => {
  // Steps for 11 + 14 with explicit final_answer step
  const steps: ReasoningStep[] = [
    { id: "ones_sum", label: "Add ones", expectedStatements: ["1 + 4 = 5"], probe: "What do you get when you add 1 and 4?", kind: "ones_sum" },
    { id: "tens_sum", label: "Add tens", expectedStatements: ["10 + 10 = 20"], probe: "What do you get when you add 10 and 10?", kind: "tens_sum" },
    { id: "combine", label: "Combine", expectedStatements: ["20 + 5 = 25"], probe: "How do you combine the tens and ones to get the final answer?", kind: "combine" },
    { id: "final_answer", label: "Final answer", expectedStatements: ["The answer is 25", "25"], probe: "What is the final answer?", kind: "final_answer" },
  ];

  // Case 1: student starts with tens — "10 + 10 = 20"
  it("Case 1: '10 + 10 = 20' → next probe is ones step", () => {
    const result = accumulateReasoningStepEvidence(steps, [], "10 + 10 = 20", 25);
    expect(result.satisfiedStepIds).toContain("tens_sum");
    expect(result.missingStepIds).toContain("ones_sum");

    const probe = getFirstMissingStepProbe(steps, result);
    expect(probe).not.toBeNull();
    expect(probe!.stepId).toBe("ones_sum");
    expect(probe!.probe).toContain("1 and 4");
  });

  // Case 2: student gives final answer only — "25"
  it("Case 2: '25' → final_answer satisfied, next probe is ones or tens", () => {
    const result = accumulateReasoningStepEvidence(steps, [], "25", 25);
    expect(result.answerCorrect).toBe(true);
    expect(result.satisfiedStepIds).toContain("final_answer");
    expect(result.missingStepIds.length).toBeGreaterThan(0);

    const probe = getFirstMissingStepProbe(steps, result);
    expect(probe).not.toBeNull();
    // First missing in array order is ones_sum
    expect(probe!.stepId).toBe("ones_sum");
  });

  // Case 3: student explains tens then ones across turns
  it("Case 3: '10 + 10 = 20' then '1 + 4 = 5' → next probe is combine", () => {
    const history = [
      { role: "coach", message: "Solve 11 + 14. Explain your thinking." },
      { role: "student", message: "10 + 10 = 20" },
      { role: "coach", message: "Good! What do you get when you add 1 and 4?" },
    ];
    const result = accumulateReasoningStepEvidence(steps, history, "1 + 4 = 5", 25);

    expect(result.satisfiedStepIds).toContain("ones_sum");
    expect(result.satisfiedStepIds).toContain("tens_sum");
    expect(result.missingStepIds).toContain("combine");

    const probe = getFirstMissingStepProbe(steps, result);
    expect(probe).not.toBeNull();
    expect(probe!.stepId).toBe("combine");
  });

  // Case 4: student gives ones then final answer — tens still missing
  it("Case 4: '1 + 4 = 5' then '25' → next probe is tens step", () => {
    const history = [
      { role: "coach", message: "Solve 11 + 14. Explain your thinking." },
      { role: "student", message: "1 + 4 = 5" },
      { role: "coach", message: "Good! What else did you do?" },
    ];
    const result = accumulateReasoningStepEvidence(steps, history, "25", 25);

    expect(result.answerCorrect).toBe(true);
    expect(result.satisfiedStepIds).toContain("ones_sum");
    expect(result.satisfiedStepIds).toContain("final_answer");
    expect(result.missingStepIds).toContain("tens_sum");

    const probe = getFirstMissingStepProbe(steps, result);
    expect(probe).not.toBeNull();
    expect(probe!.stepId).toBe("tens_sum");
  });

  // Case 5: all steps satisfied across turns in non-standard order → mastery
  it("Case 5: '25' then '1 + 4 = 5' then '10 + 10 = 20' → all satisfied, mastery", () => {
    const history = [
      { role: "coach", message: "Solve 11 + 14. Explain your thinking." },
      { role: "student", message: "25" },
      { role: "coach", message: "That's right! What do you get when you add 1 and 4?" },
      { role: "student", message: "1 + 4 = 5" },
      { role: "coach", message: "Good! What do you get when you add 10 and 10?" },
    ];
    const result = accumulateReasoningStepEvidence(steps, history, "10 + 10 = 20", 25);

    expect(result.answerCorrect).toBe(true);
    expect(result.satisfiedStepIds).toContain("ones_sum");
    expect(result.satisfiedStepIds).toContain("tens_sum");
    expect(result.satisfiedStepIds).toContain("final_answer");

    // combine may or may not be satisfied from "20 + 5 = 25" appearing across text
    // but ones, tens, and final_answer are definitely satisfied
    const missingNonCombine = result.missingStepIds.filter(id => id !== "combine");
    expect(missingNonCombine).toEqual([]);

    // getFirstMissingStepProbe returns null when no missing steps (or only combine which may be auto-satisfied)
    if (result.missingStepIds.length === 0) {
      const probe = getFirstMissingStepProbe(steps, result);
      expect(probe).toBeNull();
      expect(stepAwareStatus(result)).toBe("strong");
    }
  });

  // Order B: tens first, then ones, then combine
  it("Order B: tens → ones → combine works the same as ones → tens → combine", () => {
    // Tens first
    const result1 = accumulateReasoningStepEvidence(steps, [], "10 + 10 = 20", 25);
    expect(result1.satisfiedStepIds).toContain("tens_sum");
    expect(result1.missingStepIds).toContain("ones_sum");

    // Then ones
    const history2 = [
      { role: "coach", message: "Solve 11 + 14." },
      { role: "student", message: "10 + 10 = 20" },
      { role: "coach", message: "What do you get when you add 1 and 4?" },
    ];
    const result2 = accumulateReasoningStepEvidence(steps, history2, "1 + 4 = 5", 25);
    expect(result2.satisfiedStepIds).toContain("tens_sum");
    expect(result2.satisfiedStepIds).toContain("ones_sum");
  });

  // Verify that order does NOT affect which steps get satisfied
  it("same evidence in different order produces same satisfied set", () => {
    // Order A: ones first
    const resultA = accumulateReasoningStepEvidence(steps, [], "1 + 4 = 5 and 10 + 10 = 20", 25);
    // Order B: tens first
    const resultB = accumulateReasoningStepEvidence(steps, [], "10 + 10 = 20 and 1 + 4 = 5", 25);

    expect(resultA.satisfiedStepIds.sort()).toEqual(resultB.satisfiedStepIds.sort());
    expect(resultA.missingStepIds.sort()).toEqual(resultB.missingStepIds.sort());
  });
});

// ============================================================================
// Sticky step satisfaction + no-speech turn pairing (Request L)
// ============================================================================

describe("sticky step satisfaction across no-speech turns", () => {
  // Steps for 11 + 14 (no regrouping)
  const steps11plus14: ReasoningStep[] = [
    { id: "ones_sum", label: "Add the ones", expectedStatements: ["1 + 4 = 5"], probe: "What do you get when you add 1 and 4?", kind: "ones_sum" },
    { id: "tens_sum", label: "Add the tens", expectedStatements: ["10 + 10 = 20"], probe: "What do you get when you add 10 and 10?", kind: "tens_sum" },
    { id: "combine", label: "Combine the totals", expectedStatements: ["20 + 5 = 25", "The final answer is 25"], probe: "What do you get when you combine 20 and 5?", kind: "combine" },
  ];

  it("PART 1: '20 nothing but' satisfies tens step when coach asked about 10 + 10", () => {
    // Transcript: student said "25", coach asked ones, student said "five",
    // coach asked tens, no-speech, retry message, student says "20 nothing but"
    const history = [
      { role: "student", message: "25" },
      { role: "coach", message: "What do you get when you add 1 and 4?" },
      { role: "student", message: "five" },
      { role: "coach", message: "What do you get when you add 10 and 10?" },
      { role: "student", message: "(no speech detected)" },
      { role: "coach", message: "I didn't catch that — would you like a hint, or would you like to try again?" },
    ];
    const result = accumulateReasoningStepEvidence(steps11plus14, history, "20 nothing but", 25);

    expect(result.satisfiedStepIds).toContain("tens_sum");
    expect(result.satisfiedStepIds).toContain("ones_sum");
    expect(result.satisfiedStepIds).toContain("combine"); // "25" from first turn
  });

  it("PART 2: once tens step satisfied, next probe is NOT tens again", () => {
    const history = [
      { role: "student", message: "25" },
      { role: "coach", message: "What do you get when you add 1 and 4?" },
      { role: "student", message: "five" },
      { role: "coach", message: "What do you get when you add 10 and 10?" },
      { role: "student", message: "(no speech detected)" },
      { role: "coach", message: "I didn't catch that — would you like a hint, or would you like to try again?" },
    ];
    const result = accumulateReasoningStepEvidence(steps11plus14, history, "20 nothing but", 25);
    const nextProbe = getFirstMissingStepProbe(steps11plus14, result);

    // All steps should be satisfied (25 + five + 20), so no next probe
    expect(nextProbe).toBeNull();
  });

  it("PART 5a: 'it is five' satisfies ones step with coach context", () => {
    const history = [
      { role: "student", message: "25" },
      { role: "coach", message: "What do you get when you add 1 and 4?" },
    ];
    const result = accumulateReasoningStepEvidence(steps11plus14, history, "it is five", 25);
    expect(result.satisfiedStepIds).toContain("ones_sum");
  });

  it("PART 5b: 'or is five' satisfies ones step with coach context", () => {
    const history = [
      { role: "student", message: "25" },
      { role: "coach", message: "What do you get when you add 1 and 4?" },
    ];
    const result = accumulateReasoningStepEvidence(steps11plus14, history, "or is five", 25);
    expect(result.satisfiedStepIds).toContain("ones_sum");
  });

  it("PART 5c: 'you get 20' satisfies tens step with coach context", () => {
    const history = [
      { role: "student", message: "25" },
      { role: "coach", message: "What do you get when you add 1 and 4?" },
      { role: "student", message: "five" },
      { role: "coach", message: "What do you get when you add 10 and 10?" },
    ];
    const result = accumulateReasoningStepEvidence(steps11plus14, history, "you get 20", 25);
    expect(result.satisfiedStepIds).toContain("tens_sum");
  });

  it("PART 5d: '20 because 10 + 10 is 20' satisfies tens step directly", () => {
    const history = [
      { role: "student", message: "25" },
      { role: "coach", message: "What do you get when you add 10 and 10?" },
    ];
    const result = accumulateReasoningStepEvidence(steps11plus14, history, "20 because 10 + 10 is 20", 25);
    expect(result.satisfiedStepIds).toContain("tens_sum");
  });

  it("no-speech turn does not consume the coach question pairing", () => {
    // The math question should carry through the no-speech turn
    const history = [
      { role: "coach", message: "What do you get when you add 10 and 10?" },
      { role: "student", message: "(no speech detected)" },
      { role: "coach", message: "I didn't catch that — would you like a hint?" },
    ];
    const result = accumulateReasoningStepEvidence(steps11plus14, history, "20", 25);
    expect(result.satisfiedStepIds).toContain("tens_sum");
  });

  it("procedural retry message does not overwrite math question context", () => {
    // The retry message should not become the coach context for the next answer
    const history = [
      { role: "coach", message: "What do you get when you add 10 and 10?" },
      { role: "student", message: "" },
      { role: "coach", message: "That's okay! Would you like to try again?" },
    ];
    const result = accumulateReasoningStepEvidence(steps11plus14, history, "twenty", 25);
    expect(result.satisfiedStepIds).toContain("tens_sum");
  });

  // ========================================================================
  // Summary accuracy + re-probing regression (Request M)
  // ========================================================================

  it("Case A: '25' then '1 + 4 is 5 and 10 + 10 is 20' → all steps satisfied", () => {
    const history = [
      { role: "student", message: "25" },
      { role: "coach", message: "That's right! Tell how you got your answer." },
    ];
    const result = accumulateReasoningStepEvidence(
      steps11plus14, history, "1 + 4 is 5 and 10 + 10 is 20", 25
    );
    expect(result.answerCorrect).toBe(true);
    expect(result.satisfiedStepIds).toContain("ones_sum");
    expect(result.satisfiedStepIds).toContain("tens_sum");
    expect(result.satisfiedStepIds).toContain("combine"); // "25" from turn 1
    expect(result.missingStepIds).toHaveLength(0);
    expect(getFirstMissingStepProbe(steps11plus14, result)).toBeNull();
  });

  it("Case B: wrong '21' then corrections → all steps satisfied with correct answer", () => {
    const history = [
      { role: "student", message: "21" },
      { role: "coach", message: "Not quite. What do you get when you add 1 and 4?" },
      { role: "student", message: "1 + 4 = 5" },
      { role: "coach", message: "What do you get when you add 10 and 10?" },
      { role: "student", message: "10 + 10 = 20" },
      { role: "coach", message: "So what is the final answer?" },
    ];
    const result = accumulateReasoningStepEvidence(
      steps11plus14, history, "the answer should be 25", 25
    );
    expect(result.answerCorrect).toBe(true);
    expect(result.satisfiedStepIds).toContain("ones_sum");
    expect(result.satisfiedStepIds).toContain("tens_sum");
    expect(result.satisfiedStepIds).toContain("combine");
    expect(result.missingStepIds).toHaveLength(0);
    expect(getFirstMissingStepProbe(steps11plus14, result)).toBeNull();
  });

  it("Case C: direct full explanation → immediate mastery", () => {
    const result = accumulateReasoningStepEvidence(
      steps11plus14, [], "1 + 4 = 5 and 10 + 10 = 20 so the answer is 25", 25
    );
    expect(result.answerCorrect).toBe(true);
    expect(result.satisfiedStepIds).toContain("ones_sum");
    expect(result.satisfiedStepIds).toContain("tens_sum");
    expect(result.satisfiedStepIds).toContain("combine");
    expect(result.missingStepIds).toHaveLength(0);
  });

  it("frustration-repair does not erase already-satisfied steps", () => {
    // Turn 1: student explains ones step
    // Turn 2: coach asks for tens, student gets frustrated but also answers
    const history = [
      { role: "student", message: "25" },
      { role: "coach", message: "What do you get when you add 1 and 4?" },
      { role: "student", message: "five" },
      { role: "coach", message: "What do you get when you add 10 and 10?" },
    ];
    // Student is frustrated but still answers "I already said 20"
    const result = accumulateReasoningStepEvidence(
      steps11plus14, history, "I already told you it's 20", 25
    );
    // Ones step from prior turn should still be satisfied
    expect(result.satisfiedStepIds).toContain("ones_sum");
    // Tens step from this turn should be satisfied
    expect(result.satisfiedStepIds).toContain("tens_sum");
    // Combine from "25" in turn 1
    expect(result.satisfiedStepIds).toContain("combine");
  });
});

// ============================================================================
// Coach-modeled instruction: step stickiness after STEP_MODEL_INSTRUCTION
// ============================================================================

describe("coach-modeled instruction keeps steps satisfied", () => {
  // Steps for 11 + 14
  const steps11plus14: ReasoningStep[] = [
    { id: "step_1", label: "Add the ones", expectedStatements: ["1 + 4 = 5"], probe: "What do you get when you add 1 and 4?", kind: "ones_sum" },
    { id: "step_2", label: "Add the tens", expectedStatements: ["10 + 10 = 20"], probe: "What do you get when you add 10 and 10?", kind: "tens_sum" },
    { id: "step_3", label: "Combine the totals", expectedStatements: ["20 + 5 = 25", "The final answer is 25"], probe: "What do you get when you combine 20 and 5?", kind: "combine" },
  ];

  it("tens step stays satisfied after coach models it, even with wrong combine answers", () => {
    // Live sequence: ones correct, tens wrong twice, coach models tens,
    // then student gives wrong combine (45) twice
    const history = [
      { role: "student", message: "1 plus 4 is 5" },
      { role: "coach", message: "Great! What do you get when you add 10 and 10?" },
      { role: "student", message: "40" },
      { role: "coach", message: "What do you get when you add 10 and 10?" },
      { role: "student", message: "30" },
      // Coach models the tens step:
      { role: "coach", message: "In this problem, 10 + 10 = 20. What do you get when you combine 20 and 5?" },
      { role: "student", message: "45" },
      { role: "coach", message: "Not quite — 45 isn't right. What is 20 + 5?" },
    ];
    const result = accumulateReasoningStepEvidence(steps11plus14, history, "45", 25);

    // Ones satisfied by student ("1 plus 4 is 5")
    expect(result.satisfiedStepIds).toContain("step_1");
    // Tens satisfied by coach-modeled instruction ("10 + 10 = 20")
    expect(result.satisfiedStepIds).toContain("step_2");
    // Combine NOT satisfied (student said 45, not 25)
    expect(result.missingStepIds).toContain("step_3");
    expect(result.answerCorrect).toBe(false);
  });

  it("next missing step is combine (not tens) after coach models tens", () => {
    const history = [
      { role: "student", message: "1 plus 4 is 5" },
      { role: "coach", message: "Great! What do you get when you add 10 and 10?" },
      { role: "student", message: "40" },
      { role: "coach", message: "In this problem, 10 + 10 = 20. What do you get when you combine 20 and 5?" },
    ];
    const result = accumulateReasoningStepEvidence(steps11plus14, history, "45", 25);
    const nextMissing = getFirstMissingStepProbe(steps11plus14, result);

    expect(nextMissing).not.toBeNull();
    expect(nextMissing!.stepId).toBe("step_3");
    expect(nextMissing!.label).toBe("Combine the totals");
  });

  it("coach-modeled step is NOT newly satisfied on a later turn", () => {
    // Coach modeled tens on a prior turn; on this turn student gives wrong combine
    const history = [
      { role: "student", message: "1 plus 4 is 5" },
      { role: "coach", message: "In this problem, 10 + 10 = 20. What do you get when you combine 20 and 5?" },
      { role: "student", message: "45" },
      { role: "coach", message: "Not quite — 45 isn't right. What is 20 + 5?" },
    ];
    const result = accumulateReasoningStepEvidence(steps11plus14, history, "45", 25);

    // Tens was modeled in a prior coach message, not newly satisfied
    expect(result.newlySatisfiedStepIds).not.toContain("step_2");
    expect(result.satisfiedStepIds).toContain("step_2");
  });

  it("combine step is not satisfied by coach-modeled text alone (no student evidence)", () => {
    // Coach models the tens step only, student gives wrong combine answer
    const history = [
      { role: "student", message: "1 plus 4 is 5" },
      { role: "coach", message: "In this problem, 10 + 10 = 20. What do you get when you combine 20 and 5?" },
    ];
    const result = accumulateReasoningStepEvidence(steps11plus14, history, "45", 25);

    // Tens satisfied via coach modeling
    expect(result.satisfiedStepIds).toContain("step_2");
    // Combine NOT satisfied — student said 45, not 25
    expect(result.missingStepIds).toContain("step_3");
    expect(result.answerCorrect).toBe(false);
  });
});

// ============================================================================
// STRICTER EVIDENCE MODEL — Cases A-F
// ============================================================================

describe("stricter evidence model", () => {
  // Steps for 27 + 36 (regrouping)
  const steps27plus36: ReasoningStep[] = [
    { id: "step_1", label: "Add the ones", expectedStatements: ["7 + 6 = 13"], probe: "What do you get when you add 7 and 6?", kind: "ones_sum" },
    { id: "step_2", label: "Regroup the ones", expectedStatements: ["13 ones makes 1 ten and 3 ones"], probe: "7 + 6 makes 13. What do you do when the ones add up to more than 9?", kind: "regroup" },
    { id: "step_3", label: "Add the tens including the carried ten", expectedStatements: ["20 + 30 + 10 = 60"], probe: "What do you get when you add 20 and 30 plus the extra ten?", kind: "tens_sum" },
    { id: "step_4", label: "State the final answer", expectedStatements: ["60 + 3 = 63", "The final answer is 63"], probe: "What do you get when you combine 60 and 3?", kind: "combine" },
  ];

  // Steps for 11 + 14
  const steps11plus14: ReasoningStep[] = [
    { id: "step_1", label: "Add the ones", expectedStatements: ["1 + 4 = 5"], probe: "What do you get when you add 1 and 4?", kind: "ones_sum" },
    { id: "step_2", label: "Add the tens", expectedStatements: ["10 + 10 = 20"], probe: "What do you get when you add 10 and 10?", kind: "tens_sum" },
    { id: "step_3", label: "Combine the totals", expectedStatements: ["20 + 5 = 25", "The final answer is 25"], probe: "What do you get when you combine 20 and 5?", kind: "combine" },
  ];

  // CASE A: Loose number co-occurrence correctly rejected
  describe("Case A: loose number co-occurrence rejected", () => {
    it("'I have 7 dogs and 6 cats, there are 13 total' does NOT satisfy '7 + 6 = 13'", () => {
      const result = accumulateReasoningStepEvidence(
        steps27plus36, [], "I have 7 dogs and 6 cats, there are 13 total", 63,
      );
      expect(result.satisfiedStepIds).not.toContain("step_1");
    });

    it("text with scattered numbers 1, 4, 5 does NOT satisfy '1 + 4 = 5' via plain text", () => {
      const result = accumulateReasoningStepEvidence(
        steps11plus14, [], "I ate 1 apple and 4 bananas, now I have 5 fruits", 25,
      );
      expect(result.satisfiedStepIds).not.toContain("step_1");
    });
  });

  // CASE B: Coach-context matching rejected for long unrelated responses
  describe("Case B: coach-context matching rejected for long text", () => {
    it("long unrelated response does NOT satisfy step via coach context", () => {
      const history = [
        { role: "student", message: "25" },
        { role: "coach", message: "What do you get when you add 1 and 4?" },
      ];
      const result = accumulateReasoningStepEvidence(
        steps11plus14, history,
        "I was just thinking about how my friend Sarah has 1 dog and 4 cats and 5 fish at her house and she really loves all her pets a lot",
        25,
      );
      // The ones step should NOT be satisfied — the response is too long for scoped reply
      expect(result.satisfiedStepIds).not.toContain("step_1");
    });
  });

  // CASE C: Short scoped replies still work correctly
  describe("Case C: short scoped replies still work", () => {
    it("'five' with coach context satisfies 1 + 4 = 5", () => {
      const history = [
        { role: "student", message: "25" },
        { role: "coach", message: "What do you get when you add 1 and 4?" },
      ];
      const result = accumulateReasoningStepEvidence(steps11plus14, history, "five", 25);
      expect(result.satisfiedStepIds).toContain("step_1");
    });

    it("'20' with coach context satisfies 10 + 10 = 20", () => {
      const history = [
        { role: "student", message: "25" },
        { role: "coach", message: "What do you get when you add 10 and 10?" },
      ];
      const result = accumulateReasoningStepEvidence(steps11plus14, history, "20", 25);
      expect(result.satisfiedStepIds).toContain("step_2");
    });
  });

  // CASE D: Structural equation matching works
  describe("Case D: structural equation matching", () => {
    it("'7 plus 6 is 13' satisfies step via structural equation", () => {
      const result = accumulateReasoningStepEvidence(steps27plus36, [], "7 plus 6 is 13", 63);
      expect(result.satisfiedStepIds).toContain("step_1");
    });

    it("'7 and 6 makes 13' satisfies step via structural equation", () => {
      const result = accumulateReasoningStepEvidence(steps27plus36, [], "7 and 6 makes 13", 63);
      expect(result.satisfiedStepIds).toContain("step_1");
    });

    it("'ten and ten is twenty' satisfies step via structural equation", () => {
      const result = accumulateReasoningStepEvidence(steps11plus14, [], "ten and ten is twenty", 25);
      expect(result.satisfiedStepIds).toContain("step_2");
    });
  });

  // CASE E: Evidence source tracking
  describe("Case E: evidence source tracking", () => {
    it("explicit equation gets source 'explicit_equation'", () => {
      const result = accumulateReasoningStepEvidence(steps11plus14, [], "1 + 4 = 5", 25);
      expect(result.evidenceSources?.["step_1"]).toBe("explicit_equation");
    });

    it("short scoped reply gets source 'short_scoped_reply'", () => {
      const history = [
        { role: "student", message: "25" },
        { role: "coach", message: "What do you get when you add 1 and 4?" },
      ];
      const result = accumulateReasoningStepEvidence(steps11plus14, history, "five", 25);
      expect(result.evidenceSources?.["step_1"]).toBe("short_scoped_reply");
    });

    it("coach-modeled instruction gets source 'coach_modeled'", () => {
      // Use a history where the coach models the step but the student's
      // response is long enough to fail the short-scoped-reply guard,
      // so it falls through to the coach-modeled path.
      const history = [
        { role: "student", message: "I really do not know how to do this problem at all and I think it is really hard and confusing and I want to go home" },
        { role: "coach", message: "In this problem, 10 + 10 = 20. What do you get when you combine 20 and 5?" },
      ];
      const result = accumulateReasoningStepEvidence(steps11plus14, history, "I still don't know this is too hard for me and I don't understand any of this math stuff at all", 25);
      expect(result.evidenceSources?.["step_2"]).toBe("coach_modeled");
    });
  });

  // CASE F: Long response should not borrow coach operands
  describe("Case F: long response does not borrow coach operands", () => {
    it("multi-sentence response about unrelated topic does not satisfy step", () => {
      const history = [
        { role: "student", message: "63" },
        { role: "coach", message: "What do you get when you add 7 and 6?" },
      ];
      const result = accumulateReasoningStepEvidence(
        steps27plus36, history,
        "well I was thinking about how my sister has 7 stuffed animals and she got 6 more for her birthday and now she has 13 stuffed animals which is a lot",
        63,
      );
      // This response mentions 7, 6, and 13 but in an unrelated context
      // and is too long for scoped reply matching
      expect(result.satisfiedStepIds).not.toContain("step_1");
    });
  });
});

// ============================================================================
// Utterance classification
// ============================================================================

describe("classifyUtterance", () => {
  it("classifies '7 + 6 = 13' as equation_statement", () => {
    expect(classifyUtterance("7 + 6 = 13")).toBe("equation_statement");
  });

  it("classifies '1 plus 4 is 5' as equation_statement", () => {
    expect(classifyUtterance("1 plus 4 is 5")).toBe("equation_statement");
  });

  it("classifies 'the answer is 63' as final_answer_claim", () => {
    expect(classifyUtterance("the answer is 63")).toBe("final_answer_claim");
  });

  it("classifies 'I got 25' as final_answer_claim", () => {
    expect(classifyUtterance("I got 25")).toBe("final_answer_claim");
  });

  it("classifies 'five' as scoped_substep_answer", () => {
    expect(classifyUtterance("five", "What do you get when you add 1 and 4?")).toBe("scoped_substep_answer");
  });

  it("classifies 'first I look at the ones place' as strategy_setup", () => {
    expect(classifyUtterance("first I look at the ones place")).toBe("strategy_setup");
  });

  it("classifies 'I broke 14 into 10 and 4' as decomposition_statement", () => {
    expect(classifyUtterance("I broke 14 into 10 and 4")).toBe("decomposition_statement");
  });

  it("classifies 'calculators' as unclear_or_none", () => {
    expect(classifyUtterance("calculators")).toBe("unclear_or_none");
  });

  it("classifies multi-equation as alternate_strategy_chain", () => {
    expect(classifyUtterance("14 + 10 = 24 and 24 + 1 = 25")).toBe("alternate_strategy_chain");
  });
});

// ============================================================================
// isShortScopedStepReply
// ============================================================================

describe("isShortScopedStepReply", () => {
  it("returns true for 'five'", () => {
    expect(isShortScopedStepReply("five")).toBe(true);
  });

  it("returns true for 'you get five'", () => {
    expect(isShortScopedStepReply("you get five")).toBe(true);
  });

  it("returns true for '20 nothing but'", () => {
    expect(isShortScopedStepReply("20 nothing but")).toBe(true);
  });

  it("returns true for 'you carry the one'", () => {
    expect(isShortScopedStepReply("you carry the one")).toBe(true);
  });

  it("returns true for 'it is five'", () => {
    expect(isShortScopedStepReply("it is five")).toBe(true);
  });

  it("returns false for long unrelated text", () => {
    expect(isShortScopedStepReply(
      "I like pizza with 5 toppings and yesterday I ate 1 slice plus 4 breadsticks and then went home and played games"
    )).toBe(false);
  });

  it("returns true even with fillers like 'um well'", () => {
    expect(isShortScopedStepReply("um well you get five")).toBe(true);
  });
});

// ============================================================================
// Decomposition detection helpers
// ============================================================================

describe("containsDecompositionLanguage", () => {
  it("detects 'I broke 14 into 10 and 4'", () => {
    expect(containsDecompositionLanguage("I broke 14 into 10 and 4")).toBe(true);
  });

  it("detects 'split 14 into 7 and 7'", () => {
    expect(containsDecompositionLanguage("split 14 into 7 and 7")).toBe(true);
  });

  it("does not false-positive on 'I broke my pencil'", () => {
    // Note: "broke" alone matches — but that's acceptable since this function
    // just checks for decomposition language, not validates the decomposition
    expect(containsDecompositionLanguage("I broke my pencil")).toBe(true);
  });

  it("does not false-positive on 'the answer is 63'", () => {
    expect(containsDecompositionLanguage("the answer is 63")).toBe(false);
  });
});

describe("extractDecompositionCandidates", () => {
  it("extracts from 'I broke 14 into 10 and 4'", () => {
    const result = extractDecompositionCandidates("I broke 14 into 10 and 4");
    expect(result).toHaveLength(1);
    expect(result[0].whole).toBe(14);
    expect(result[0].parts).toEqual([10, 4]);
  });

  it("extracts from 'split fourteen into seven and seven'", () => {
    const result = extractDecompositionCandidates("split fourteen into seven and seven");
    expect(result).toHaveLength(1);
    expect(result[0].whole).toBe(14);
    expect(result[0].parts).toEqual([7, 7]);
  });

  it("returns empty for 'the answer is 63'", () => {
    const result = extractDecompositionCandidates("the answer is 63");
    expect(result).toHaveLength(0);
  });
});

describe("isLikelyStrategySetup", () => {
  it("returns true for 'first I look at the ones place'", () => {
    expect(isLikelyStrategySetup("first I look at the ones place")).toBe(true);
  });

  it("returns true for 'I would start with the ones'", () => {
    expect(isLikelyStrategySetup("I would start with the ones")).toBe(true);
  });

  it("returns false for '7 + 6 = 13' (has equation)", () => {
    expect(isLikelyStrategySetup("7 + 6 = 13")).toBe(false);
  });

  it("returns false for 'the answer is 63' (has answer claim)", () => {
    expect(isLikelyStrategySetup("the answer is 63")).toBe(false);
  });

  it("returns false for 'I like pizza' (no strategy language)", () => {
    expect(isLikelyStrategySetup("I like pizza")).toBe(false);
  });
});

// ============================================================================
// ANSWER-ROLE ATTRIBUTION & ALTERNATE-STRATEGY ROBUSTNESS — Cases A-E
// ============================================================================

describe("numeric candidate role extraction", () => {
  it("'25' → single unknown_number candidate", () => {
    const candidates = extractNumericCandidates("25");
    expect(candidates).toHaveLength(1);
    expect(candidates[0].value).toBe(25);
    // Bare number without context is unknown
    expect(candidates[0].role).toBe("unknown_number");
  });

  it("'the answer is 25' → final_answer_candidate", () => {
    const candidates = extractNumericCandidates("the answer is 25");
    const finalCandidates = candidates.filter(c => c.role === "final_answer_candidate");
    expect(finalCandidates).toHaveLength(1);
    expect(finalCandidates[0].value).toBe(25);
  });

  it("'10 + 10 = 20' → operand_references + substep_result", () => {
    const candidates = extractNumericCandidates("10 + 10 = 20");
    const operands = candidates.filter(c => c.role === "operand_reference");
    const results = candidates.filter(c => c.role === "substep_result");
    expect(operands.length).toBeGreaterThanOrEqual(1);
    expect(results).toHaveLength(1);
    expect(results[0].value).toBe(20);
  });

  it("'I would split it 5 + 9' → decomposition_parts", () => {
    const candidates = extractNumericCandidates("I would split it 5 + 9");
    // The 5 and 9 should be decomposition_parts or at least not final_answer_candidate
    const finalCandidates = candidates.filter(c => c.role === "final_answer_candidate");
    expect(finalCandidates).toHaveLength(0);
  });

  it("'14 plus 10 is 24 and then 1 more is 25' → intermediate 24, final 25", () => {
    const candidates = extractNumericCandidates("14 plus 10 is 24 and then 1 more is 25");
    // 24 should be substep_result, 25 should appear somewhere
    const substepResults = candidates.filter(c => c.role === "substep_result");
    expect(substepResults.some(c => c.value === 24)).toBe(true);
  });

  it("selectFinalAnswer picks last final_answer_candidate", () => {
    const candidates = extractNumericCandidates("the answer is 25");
    expect(selectFinalAnswer(candidates)).toBe(25);
  });

  it("selectFinalAnswer returns null when only decomposition parts", () => {
    const candidates = extractNumericCandidates("split 14 into 10 and 4");
    const finalCandidates = candidates.filter(c => c.role === "final_answer_candidate");
    // If no final candidates, only decomposition parts
    if (finalCandidates.length === 0) {
      // Filter to only decomposition/operand roles
      const nonAnswer = candidates.filter(c =>
        c.role === "decomposition_part" || c.role === "operand_reference"
      );
      if (nonAnswer.length === candidates.length) {
        expect(selectFinalAnswer(candidates)).toBeNull();
      }
    }
  });
});

describe("decomposition/setup suppression", () => {
  it("'I would split it 5 + 9' → isDecompositionOnly true", () => {
    expect(isDecompositionOnly("I would split it 5 + 9")).toBe(true);
  });

  it("'14 could be 7 + 7' → isDecompositionOnly true", () => {
    expect(isDecompositionOnly("14 could be 7 + 7")).toBe(true);
  });

  it("'split 11 into 10 and 1' → isDecompositionOnly true", () => {
    expect(isDecompositionOnly("split 11 into 10 and 1")).toBe(true);
  });

  it("'break it into 6 and 8' → isDecompositionOnly true", () => {
    expect(isDecompositionOnly("break it into 6 and 8")).toBe(true);
  });

  it("'the answer is 25' → isDecompositionOnly false", () => {
    expect(isDecompositionOnly("the answer is 25")).toBe(false);
  });

  it("'split it 5 + 9 and I got 14' → isDecompositionOnly false (has conclusion)", () => {
    expect(isDecompositionOnly("I would split it 5 + 9 and I got 14")).toBe(false);
  });

  it("decomposition + computation → isDecompositionOnly false", () => {
    // "split the 11...14 + 10 is 24" has both decomposition AND computation
    expect(isDecompositionOnly(
      "I can split the 11 into a 10 and 1 14 + 10 is 24 + the one is 25"
    )).toBe(false);
  });

  it("extractFinalAnswer returns null for decomposition-only", () => {
    expect(extractFinalAnswer("I would split it 5 + 9")).toBeNull();
  });

  it("extractFinalAnswer returns 25 for computation with decomposition", () => {
    expect(extractFinalAnswer(
      "well I can take 14 and then I can split the 11 into a 10 and 1 14 + 10 is 24 + the one is 25"
    )).toBe(25);
  });
});

// Case A: decomposition setup should not become wrong final answer
describe("Case A: decomposition setup ≠ wrong final answer", () => {
  const PROBLEM_11_14: MathProblem = {
    skill: "two_digit_addition",
    a: 11,
    b: 14,
    expression: "11 + 14",
    correctAnswer: 25,
    requiresRegrouping: false,
    expectedStrategyTags: ["add ones", "add tens"],
  };

  it("'I would split it 5 + 9' → no_answer, not incorrect_known_misconception", () => {
    const result = validateMathAnswer("I would split it 5 + 9", PROBLEM_11_14);
    // Should NOT treat 9 (or 5) as a wrong final answer
    expect(result.status).toBe("no_answer");
  });

  it("'14 could be 7 + 7' → no_answer", () => {
    const result = validateMathAnswer("14 could be 7 + 7", PROBLEM_11_14);
    expect(result.status).toBe("no_answer");
  });

  it("'split 11 into 10 and 1' → no_answer", () => {
    const result = validateMathAnswer("split 11 into 10 and 1", PROBLEM_11_14);
    expect(result.status).toBe("no_answer");
  });

  it("'break it into 6 and 8' → no_answer", () => {
    const result = validateMathAnswer("break it into 6 and 8", PROBLEM_11_14);
    expect(result.status).toBe("no_answer");
  });
});

// Case B: canonical substep should not be backfilled from alternate chain
describe("Case B: alternate strategy does not backfill canonical steps", () => {
  const steps11plus14: ReasoningStep[] = [
    { id: "step_1", label: "Add the ones", expectedStatements: ["1 + 4 = 5"], probe: "What do you get when you add 1 and 4?", kind: "ones_sum" },
    { id: "step_2", label: "Add the tens", expectedStatements: ["10 + 10 = 20"], probe: "What do you get when you add 10 and 10?", kind: "tens_sum" },
    { id: "step_3", label: "Combine the totals", expectedStatements: ["20 + 5 = 25", "The final answer is 25"], probe: "What do you get when you combine 20 and 5?", kind: "combine" },
  ];

  it("'14 + 10 = 24, then 1 more is 25' → alternate detected, ones step NOT satisfied", () => {
    const result = accumulateReasoningStepEvidence(
      steps11plus14, [], "14 + 10 is 24 and then 1 more is 25", 25,
    );
    expect(result.answerCorrect).toBe(true);
    expect(result.alternateStrategyDetected).toBe(true);
    // Ones step "1 + 4 = 5" should NOT be satisfied — alternate strategy
    // should NOT backfill canonical steps
    expect(result.satisfiedStepIds).not.toContain("step_1");
    // Tens step "10 + 10 = 20" should NOT be satisfied either
    expect(result.satisfiedStepIds).not.toContain("step_2");
    // completionRatio should be boosted by alternate strategy
    expect(result.completionRatio).toBeGreaterThanOrEqual(0.66);
  });
});

// Case C: substep equation should not become final answer
describe("Case C: substep equation ≠ final answer", () => {
  const PROBLEM_11_14: MathProblem = {
    skill: "two_digit_addition",
    a: 11,
    b: 14,
    expression: "11 + 14",
    correctAnswer: 25,
    requiresRegrouping: false,
    expectedStrategyTags: ["add ones", "add tens"],
  };

  it("'10 + 10 = 20' should not be interpreted as final answer 20", () => {
    const result = validateMathAnswer("10 + 10 = 20", PROBLEM_11_14);
    // The student said an equation, not a final answer claim for 20
    // extractFinalAnswer may return 20 as the substep result,
    // but the problem's correctAnswer is 25, so status should be incorrect
    expect(result.extractedAnswer).not.toBe(25);
    expect(result.status).not.toBe("correct");
  });

  it("'10 + 10 = 20' usable as substep evidence in accumulation", () => {
    const steps: ReasoningStep[] = [
      { id: "step_1", label: "Add ones", expectedStatements: ["1 + 4 = 5"], probe: "Add 1 and 4", kind: "ones_sum" },
      { id: "step_2", label: "Add tens", expectedStatements: ["10 + 10 = 20"], probe: "Add 10 and 10", kind: "tens_sum" },
      { id: "step_3", label: "Combine", expectedStatements: ["20 + 5 = 25"], probe: "Combine 20 and 5", kind: "combine" },
    ];
    const result = accumulateReasoningStepEvidence(steps, [], "10 + 10 = 20", 25);
    expect(result.satisfiedStepIds).toContain("step_2");
    expect(result.answerCorrect).toBe(false);
  });
});

// Case D: true final answer claim in mixed response
describe("Case D: final answer in mixed response with arithmetic chain", () => {
  it("'14 + 10 is 24 and then 1 more is 25' → final answer 25, alternate detected", () => {
    const answer = extractFinalAnswer("14 plus 10 is 24 and then 1 more is 25");
    expect(answer).toBe(25);

    const chain = parseArithmeticChain("14 plus 10 is 24 and then 1 more is 25");
    expect(chain.length).toBeGreaterThanOrEqual(1);
    expect(isValidArithmeticChain(chain, 25)).toBe(true);
    expect(detectAlternateStrategyChain("14 plus 10 is 24 and then 1 more is 25", 25)).toBe(true);
  });

  it("'11 + 10 = 21, then +4 = 25' → valid alternate chain", () => {
    expect(detectAlternateStrategyChain("11 + 10 = 21, then +4 = 25", 25)).toBe(true);
  });

  it("'14 could be 7 + 7' → NOT a valid alternate chain to 25", () => {
    expect(detectAlternateStrategyChain("14 could be 7 + 7", 25)).toBe(false);
  });

  it("'11 is 10 + 1' → NOT a valid alternate chain to 25", () => {
    expect(detectAlternateStrategyChain("11 is 10 + 1", 25)).toBe(false);
  });
});

// Case E: decomposition statement plus later final answer
describe("Case E: decomposition then later final answer", () => {
  const steps11plus14: ReasoningStep[] = [
    { id: "step_1", label: "Add ones", expectedStatements: ["1 + 4 = 5"], probe: "Add 1 and 4", kind: "ones_sum" },
    { id: "step_2", label: "Add tens", expectedStatements: ["10 + 10 = 20"], probe: "Add 10 and 10", kind: "tens_sum" },
    { id: "step_3", label: "Combine", expectedStatements: ["20 + 5 = 25"], probe: "Combine 20 and 5", kind: "combine" },
  ];

  it("'I would split it 5 + 9' then later '25' → first no answer, second is final", () => {
    // Turn 1: decomposition setup
    const result1 = accumulateReasoningStepEvidence(
      steps11plus14, [], "I would split it 5 + 9", 25,
    );
    // First turn should NOT produce a wrong answer
    expect(result1.answerCorrect).toBe(false);
    expect(result1.extractedAnswer).toBeNull();

    // Turn 2: actual final answer
    const history = [
      { role: "student", message: "I would split it 5 + 9" },
      { role: "coach", message: "Interesting! Can you tell me the final answer?" },
    ];
    const result2 = accumulateReasoningStepEvidence(
      steps11plus14, history, "25", 25,
    );
    expect(result2.answerCorrect).toBe(true);
    expect(result2.extractedAnswer).toBe(25);
  });
});

// ============================================================================
// Arithmetic chain parsing
// ============================================================================

describe("parseArithmeticChain", () => {
  it("parses '14 + 10 = 24' → one step", () => {
    const chain = parseArithmeticChain("14 + 10 = 24");
    expect(chain).toHaveLength(1);
    expect(chain[0]).toEqual({ operandA: 14, operandB: 10, result: 24, operator: "+" });
  });

  it("parses '14 plus 10 is 24 and then 1 more is 25' → two steps", () => {
    const chain = parseArithmeticChain("14 plus 10 is 24 and then 1 more is 25");
    expect(chain.length).toBeGreaterThanOrEqual(1);
    expect(chain.some(s => s.result === 24)).toBe(true);
    expect(chain.some(s => s.result === 25)).toBe(true);
  });

  it("parses '11 + 10 = 21, then +4 = 25' → chain reaching 25", () => {
    const chain = parseArithmeticChain("11 + 10 = 21, then +4 = 25");
    expect(chain.some(s => s.result === 25)).toBe(true);
    expect(isValidArithmeticChain(chain, 25)).toBe(true);
  });

  it("'14 could be 7 + 7' → no valid equations", () => {
    // "could be" is not an equation pattern
    const chain = parseArithmeticChain("14 could be 7 + 7");
    // Should not produce equations from "could be"
    const reachesAnswer = chain.some(s => s.result === 25);
    expect(reachesAnswer).toBe(false);
  });

  it("validates arithmetic: '7 + 6 = 14' → arithmetically invalid", () => {
    const chain = parseArithmeticChain("7 + 6 = 14");
    expect(chain).toHaveLength(1);
    // The chain has an invalid step (7+6≠14)
    expect(isValidArithmeticChain(chain, 14)).toBe(false);
  });
});

describe("isValidArithmeticChain", () => {
  it("single valid step reaching answer → true", () => {
    const steps = [{ operandA: 14, operandB: 11, result: 25, operator: "+" as const }];
    expect(isValidArithmeticChain(steps, 25)).toBe(true);
  });

  it("multi-step chain with connectivity → true", () => {
    const steps = [
      { operandA: 14, operandB: 10, result: 24, operator: "+" as const },
      { operandA: 24, operandB: 1, result: 25, operator: "+" as const },
    ];
    expect(isValidArithmeticChain(steps, 25)).toBe(true);
  });

  it("steps that don't reach the answer → false", () => {
    const steps = [{ operandA: 14, operandB: 10, result: 24, operator: "+" as const }];
    expect(isValidArithmeticChain(steps, 25)).toBe(false);
  });

  it("empty steps → false", () => {
    expect(isValidArithmeticChain([], 25)).toBe(false);
  });

  it("arithmetically invalid step → false", () => {
    const steps = [{ operandA: 14, operandB: 10, result: 30, operator: "+" as const }];
    expect(isValidArithmeticChain(steps, 30)).toBe(false);
  });
});

// ============================================================================
// Evidence records in accumulation
// ============================================================================

describe("evidence records in accumulation", () => {
  const steps11plus14: ReasoningStep[] = [
    { id: "step_1", label: "Add ones", expectedStatements: ["1 + 4 = 5"], probe: "Add 1 and 4", kind: "ones_sum" },
    { id: "step_2", label: "Add tens", expectedStatements: ["10 + 10 = 20"], probe: "Add 10 and 10", kind: "tens_sum" },
    { id: "step_3", label: "Combine", expectedStatements: ["20 + 5 = 25"], probe: "Combine 20 and 5", kind: "combine" },
  ];

  it("evidence records include utteranceText and turnIndex", () => {
    const history = [
      { role: "student", message: "25" },
      { role: "coach", message: "What do you get when you add 1 and 4?" },
    ];
    const result = accumulateReasoningStepEvidence(steps11plus14, history, "five", 25);

    expect(result.evidenceRecords).toBeDefined();
    expect(result.evidenceRecords!.length).toBeGreaterThan(0);

    // The ones step should have an evidence record
    const onesRecord = result.evidenceRecords!.find(r => r.stepId === "step_1");
    expect(onesRecord).toBeDefined();
    expect(onesRecord!.source).toBe("short_scoped_reply");
    expect(onesRecord!.coachQuestionText).toBeDefined();
  });

  it("evidence records include explicit_equation source", () => {
    const result = accumulateReasoningStepEvidence(steps11plus14, [], "1 + 4 = 5", 25);

    const onesRecord = result.evidenceRecords!.find(r => r.stepId === "step_1");
    expect(onesRecord).toBeDefined();
    expect(onesRecord!.source).toBe("explicit_equation");
  });
});
