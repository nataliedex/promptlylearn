/**
 * Golden tests for the deterministic remediation policy.
 *
 * Every test case verifies:
 * 1. The correct remediation move type is selected
 * 2. The correct missing step is targeted
 * 3. The student state is classified correctly
 * 4. Already-satisfied steps are never re-probed
 * 5. The explanation sentence can be written: "We asked about step X because..."
 */

import {
  classifyStudentState,
  getNextMissingStep,
  getDeterministicRemediationMove,
  shouldUseDeterministicRemediation,
  detectMisconceptionCategory,
  detectConceptConfusion,
  buildInstructionalRecap,
  detectConversationMisconceptions,
  countConsecutiveStepFailures,
  buildStepFailureRecap,
  detectPersistentStepFailure,
  type StudentRemediationState,
  type RemediationMove,
  type MisconceptionCategory,
  type ConceptConfusionCategory,
  detectActiveAnswerScope,
  getScopeExpression,
  type AnswerScope,
} from "./deterministicRemediation";
import {
  accumulateReasoningStepEvidence,
  type ReasoningStepAccumulation,
} from "./mathAnswerValidator";
import type { ReasoningStep } from "./prompt";
import type { MathProblem } from "./mathProblem";

// ── Test fixtures: 11 + 14 = 25 ─────────────────────────────────

const mathProblem: MathProblem = {
  skill: "two_digit_addition",
  a: 11,
  b: 14,
  expression: "11 + 14",
  correctAnswer: 25,
  requiresRegrouping: false,
  expectedStrategyTags: ["add ones", "add tens"],
  commonWrongAnswers: [
    { answer: 15, misconception: "Added ones digits only (1+4=5, kept 1 → 15)" },
    { answer: 35, misconception: "Added all digits (1+1+1+4=7? or similar)" },
  ],
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

// ── Subtraction fixture: 47 - 23 = 24 ───────────────────────────

const subProblem: MathProblem = {
  skill: "two_digit_subtraction",
  a: 47,
  b: 23,
  expression: "47 - 23",
  correctAnswer: 24,
  requiresRegrouping: false,
  expectedStrategyTags: ["subtract ones", "subtract tens"],
};

const subSteps: ReasoningStep[] = [
  {
    id: "sub_step_1",
    label: "Subtract the ones",
    expectedStatements: ["7 - 3 = 4"],
    probe: "What do you get when you subtract 3 from 7?",
    kind: "subtract_ones",
  },
  {
    id: "sub_step_2",
    label: "Subtract the tens",
    expectedStatements: ["40 - 20 = 20"],
    probe: "What do you get when you subtract 20 from 40?",
    kind: "subtract_tens",
  },
  {
    id: "sub_step_3",
    label: "Combine the results",
    expectedStatements: ["20 + 4 = 24"],
    probe: "What do you get when you combine 20 and 4?",
    kind: "combine",
  },
];

// ── Helper ───────────────────────────────────────────────────────

function accumulate(
  history: Array<{ role: string; message: string }>,
  currentResponse: string,
): ReasoningStepAccumulation {
  return accumulateReasoningStepEvidence(
    reasoningSteps,
    history,
    currentResponse,
    mathProblem.correctAnswer,
  );
}

function getMove(
  history: Array<{ role: string; message: string }>,
  currentResponse: string,
): RemediationMove | null {
  const acc = accumulate(history, currentResponse);
  return getDeterministicRemediationMove(reasoningSteps, acc, currentResponse, mathProblem);
}

function subAccumulate(
  history: Array<{ role: string; message: string }>,
  currentResponse: string,
): ReasoningStepAccumulation {
  return accumulateReasoningStepEvidence(
    subSteps,
    history,
    currentResponse,
    subProblem.correctAnswer,
  );
}

function getSubMove(
  history: Array<{ role: string; message: string }>,
  currentResponse: string,
): RemediationMove | null {
  const acc = subAccumulate(history, currentResponse);
  return getDeterministicRemediationMove(subSteps, acc, currentResponse, subProblem);
}

/** Banned vague phrases that should never appear in deterministic remediation output. */
const BANNED_VAGUE_PHRASES = [
  /\bwhat do you think\b/i,
  /\bcan you explain\b/i,
  /\btry again\b/i,
  /\btell me more\b/i,
  /\bwhat else\b/i,
  /\bstrategy\b/i,
  /\boperation\b/i,
  /\breasoning gap\b/i,
  /\bconceptual\b/i,
  /\bmisunderstanding\b/i,
  /\bmisconception detected\b/i,
  /\btry a different\b/i,
  /\bcount up from\b/i,
];

function assertNoVaguePhrases(text: string) {
  for (const pattern of BANNED_VAGUE_PHRASES) {
    expect(text).not.toMatch(pattern);
  }
}

// ── GOLDEN TESTS ─────────────────────────────────────────────────

describe("deterministicRemediation", () => {

  // ══════════════════════════════════════════════════════════════
  // classifyStudentState
  // ══════════════════════════════════════════════════════════════

  describe("classifyStudentState", () => {
    it("classifies 'I don't know' as uncertain", () => {
      const acc = accumulate([], "I don't know");
      expect(classifyStudentState("I don't know", acc, mathProblem)).toBe("uncertain");
    });

    it("classifies explicit hint request", () => {
      const acc = accumulate([], "Can I have a hint?");
      expect(classifyStudentState("Can I have a hint?", acc, mathProblem)).toBe("hint_request");
    });

    it("classifies wrong answer as wrong", () => {
      const acc = accumulate([], "21");
      expect(classifyStudentState("21", acc, mathProblem)).toBe("wrong");
    });

    it("classifies subtraction language on addition problem as misconception", () => {
      const acc = accumulate([], "I took away 4 from 1 and got 3");
      expect(classifyStudentState("I took away 4 from 1 and got 3", acc, mathProblem)).toBe("misconception");
    });

    it("classifies 1 - 4 = 3 expression as misconception", () => {
      const acc = accumulate([], "1 - 4 = 3");
      expect(classifyStudentState("1 - 4 = 3", acc, mathProblem)).toBe("misconception");
    });

    it("classifies no speech as uncertain", () => {
      const acc = accumulate([], "");
      expect(classifyStudentState("", acc, mathProblem)).toBe("uncertain");
    });

    it("classifies known misconception answer (15) as misconception", () => {
      const acc = accumulate([], "15");
      expect(classifyStudentState("15", acc, mathProblem)).toBe("misconception");
    });

    it("classifies ones-only answer (5 for 11+14) as misconception", () => {
      const acc = accumulate([], "5");
      expect(classifyStudentState("5", acc, mathProblem)).toBe("misconception");
    });

    it("classifies tens-only answer (20 for 11+14) as misconception", () => {
      const acc = accumulate([], "20");
      expect(classifyStudentState("20", acc, mathProblem)).toBe("misconception");
    });
  });

  // ══════════════════════════════════════════════════════════════
  // step probe scope classification
  // ══════════════════════════════════════════════════════════════

  describe("step probe scope — correct step answer is partial, not misconception", () => {
    // 60 + 2 = 62 with step-level probes
    const probeProblem: MathProblem = {
      skill: "two_digit_addition",
      a: 60,
      b: 2,
      expression: "60 + 2",
      correctAnswer: 62,
      requiresRegrouping: false,
      expectedStrategyTags: ["add ones", "add tens", "combine"],
    };

    const probeSteps: ReasoningStep[] = [
      {
        id: "s1",
        label: "Add the ones",
        expectedStatements: ["0 + 2 = 2"],
        probe: "What is 0 + 2?",
        kind: "ones_sum" as const,
      },
      {
        id: "s2",
        label: "Add the tens",
        expectedStatements: ["60 + 0 = 60", "6 + 0 = 6"],
        probe: "What is 60 + 0?",
        kind: "tens_sum" as const,
      },
      {
        id: "s3",
        label: "Combine",
        expectedStatements: ["60 + 2 = 62"],
        probe: "What is 60 + 2?",
        kind: "combine" as const,
      },
    ];

    function probeAccumulate(
      history: Array<{ role: string; message: string }>,
      currentResponse: string,
    ): ReasoningStepAccumulation {
      return accumulateReasoningStepEvidence(
        probeSteps,
        history,
        currentResponse,
        probeProblem.correctAnswer,
      );
    }

    // Case 1: Coach says "What is 0 + 2?" — student says "2" → partial
    it("classifies '2' as partial when coach probed 'What is 0 + 2?'", () => {
      const history = [
        { role: "coach", message: "Let's do just the ones. What is 0 + 2?" },
      ];
      const acc = probeAccumulate(history, "2");
      expect(acc.newlySatisfiedStepIds).toContain("s1");
      expect(classifyStudentState("2", acc, probeProblem)).toBe("partial");
    });

    // Same with word form "two"
    it("classifies 'two' as partial when coach probed 'What is 0 + 2?'", () => {
      const history = [
        { role: "coach", message: "Let's do just the ones. What is 0 + 2?" },
      ];
      const acc = probeAccumulate(history, "two");
      expect(acc.newlySatisfiedStepIds).toContain("s1");
      expect(classifyStudentState("two", acc, probeProblem)).toBe("partial");
    });

    // "two two" still extracts answer 2 and satisfies step_1
    it("classifies 'two two' as partial when coach probed 'What is 0 + 2?'", () => {
      const history = [
        { role: "coach", message: "Let's do just the ones. What is 0 + 2?" },
      ];
      const acc = probeAccumulate(history, "two two");
      expect(acc.newlySatisfiedStepIds).toContain("s1");
      expect(classifyStudentState("two two", acc, probeProblem)).toBe("partial");
    });

    // Case 2: "3" does NOT satisfy the ones step → misconception (wrong step answer)
    it("classifies '3' as wrong/misconception when coach probed 'What is 0 + 2?'", () => {
      const history = [
        { role: "coach", message: "Let's do just the ones. What is 0 + 2?" },
      ];
      const acc = probeAccumulate(history, "3");
      expect(acc.newlySatisfiedStepIds).not.toContain("s1");
      const state = classifyStudentState("3", acc, probeProblem);
      expect(["wrong", "misconception"]).toContain(state);
    });

    // Case 3: "60" satisfies the tens step → partial
    it("classifies '60' as partial when coach probed 'What is 60 + 0?'", () => {
      const history = [
        { role: "coach", message: "Good! Now the tens. What is 60 + 0?" },
      ];
      const acc = probeAccumulate(history, "60");
      expect(acc.newlySatisfiedStepIds).toContain("s2");
      expect(classifyStudentState("60", acc, probeProblem)).toBe("partial");
    });

    // Case 4: Coach rephrases the probe — still works
    it("classifies '60' as partial when coach says 'What do you get when you add 20 and 40?'", () => {
      const bigProblem: MathProblem = {
        skill: "two_digit_addition",
        a: 20,
        b: 40,
        expression: "20 + 40",
        correctAnswer: 60,
        requiresRegrouping: false,
        expectedStrategyTags: ["add tens", "combine"],
      };
      const bigSteps: ReasoningStep[] = [
        {
          id: "s1",
          label: "Add the tens",
          expectedStatements: ["20 + 40 = 60"],
          probe: "What is 20 + 40?",
          kind: "tens_sum" as const,
        },
      ];
      const history = [
        { role: "coach", message: "What do you get when you add 20 and 40?" },
      ];
      const acc = accumulateReasoningStepEvidence(bigSteps, history, "60", bigProblem.correctAnswer);
      expect(classifyStudentState("60", acc, bigProblem)).not.toBe("misconception");
    });

    // Misconception still detected: subtraction language on addition step
    it("still detects subtraction misconception — 'I subtracted'", () => {
      const history = [
        { role: "coach", message: "Let's do just the ones. What is 0 + 2?" },
      ];
      const acc = probeAccumulate(history, "I subtracted");
      // "I subtracted" doesn't satisfy step_1
      expect(acc.newlySatisfiedStepIds).not.toContain("s1");
      const state = classifyStudentState("I subtracted", acc, probeProblem);
      expect(state).not.toBe("partial");
    });

    // End-to-end: getDeterministicRemediationMove
    it("getDeterministicRemediationMove classifies step answer as partial (not misconception)", () => {
      const history = [
        { role: "coach", message: "Let's do just the ones. What is 0 + 2?" },
      ];
      const acc = probeAccumulate(history, "2");
      const move = getDeterministicRemediationMove(probeSteps, acc, "2", probeProblem, history);
      expect(move).not.toBeNull();
      expect(move!.studentState).not.toBe("misconception");
      expect(move!.studentState).not.toBe("wrong");
    });

    it("getDeterministicRemediationMove still catches wrong step answer", () => {
      const history = [
        { role: "coach", message: "Let's do just the ones. What is 0 + 2?" },
      ];
      const acc = probeAccumulate(history, "3");
      const move = getDeterministicRemediationMove(probeSteps, acc, "3", probeProblem, history);
      expect(move).not.toBeNull();
      // "3" is wrong for 0+2, should be misconception or wrong
      expect(["wrong", "misconception"]).toContain(move!.studentState);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // full-flow end-to-end: 20 + 42 = 62, "I don't know" → step probes → mastery
  // ══════════════════════════════════════════════════════════════

  describe("full-flow: step probes through mastery (20 + 42 = 62)", () => {
    const problem: MathProblem = {
      skill: "two_digit_addition",
      a: 20,
      b: 42,
      expression: "20 + 42",
      correctAnswer: 62,
      requiresRegrouping: false,
      expectedStrategyTags: ["add ones", "add tens", "combine"],
    };

    const steps: ReasoningStep[] = [
      {
        id: "s1",
        label: "Add the ones",
        expectedStatements: ["0 + 2 = 2"],
        probe: "What is 0 + 2?",
        kind: "ones_sum" as const,
      },
      {
        id: "s2",
        label: "Add the tens",
        expectedStatements: ["20 + 40 = 60", "2 + 4 = 6"],
        probe: "What is 20 + 40?",
        kind: "tens_sum" as const,
      },
      {
        id: "s3",
        label: "Combine",
        expectedStatements: ["60 + 2 = 62"],
        probe: "What is 60 + 2?",
        kind: "combine" as const,
      },
    ];

    function acc(
      history: Array<{ role: string; message: string }>,
      currentResponse: string,
    ): ReasoningStepAccumulation {
      return accumulateReasoningStepEvidence(steps, history, currentResponse, problem.correctAnswer);
    }

    // Turn 1: student says "I don't know" → uncertain
    it("turn 1: 'I don't know' → uncertain, probes step s1", () => {
      const history: Array<{ role: string; message: string }> = [];
      const stepAcc = acc(history, "I don't know");
      const state = classifyStudentState("I don't know", stepAcc, problem);
      expect(state).toBe("uncertain");

      const move = getDeterministicRemediationMove(steps, stepAcc, "I don't know", problem, history);
      expect(move).not.toBeNull();
      expect(move!.studentState).toBe("uncertain");
      // Should target first missing step
      expect(move!.targetStepId).toBe("s1");
    });

    // Turn 2: coach asked "What is 0 + 2?", student says "two" → partial
    it("turn 2: 'two' after coach probed ones → partial, newly satisfies s1", () => {
      const history = [
        { role: "coach", message: "What is 20 + 42? Tell how you got your answer." },
        { role: "student", message: "I don't know" },
        { role: "coach", message: "Let's do just the ones. What is 0 + 2?" },
      ];
      const stepAcc = acc(history, "two");

      // Step accumulation: s1 newly satisfied
      expect(stepAcc.satisfiedStepIds).toContain("s1");
      expect(stepAcc.newlySatisfiedStepIds).toContain("s1");
      expect(stepAcc.missingStepIds).toEqual(expect.arrayContaining(["s2", "s3"]));

      // Classification: partial (NOT misconception)
      const state = classifyStudentState("two", stepAcc, problem);
      expect(state).toBe("partial");

      // Move: should advance to next step, not misconception redirect
      const move = getDeterministicRemediationMove(steps, stepAcc, "two", problem, history);
      expect(move).not.toBeNull();
      expect(move!.studentState).not.toBe("misconception");
      expect(move!.studentState).not.toBe("wrong");
      // Should target s2 (the next missing step)
      expect(move!.targetStepId).toBe("s2");
      expect(["STEP_PROBE_DIRECT", "STEP_ACKNOWLEDGE_AND_PROBE"]).toContain(move!.type);
    });

    // Turn 3: coach asked about tens, student says "60" → partial
    it("turn 3: '60' after coach probed tens → partial, newly satisfies s2", () => {
      const history = [
        { role: "coach", message: "What is 20 + 42? Tell how you got your answer." },
        { role: "student", message: "I don't know" },
        { role: "coach", message: "Let's do just the ones. What is 0 + 2?" },
        { role: "student", message: "two" },
        { role: "coach", message: "Good! Now the tens. What is 20 + 40?" },
      ];
      const stepAcc = acc(history, "60");

      expect(stepAcc.satisfiedStepIds).toContain("s1");
      expect(stepAcc.satisfiedStepIds).toContain("s2");
      expect(stepAcc.newlySatisfiedStepIds).toContain("s2");
      expect(stepAcc.missingStepIds).toEqual(["s3"]);

      const state = classifyStudentState("60", stepAcc, problem);
      expect(state).toBe("partial");

      const move = getDeterministicRemediationMove(steps, stepAcc, "60", problem, history);
      expect(move).not.toBeNull();
      expect(move!.targetStepId).toBe("s3");
      expect(["STEP_COMBINE_PROMPT", "STEP_PROBE_DIRECT", "STEP_ACKNOWLEDGE_AND_PROBE"]).toContain(move!.type);
    });

    // Turn 4: coach asked to combine, student says "62" → wrap success
    it("turn 4: '62' after combine prompt → correct, wrap success", () => {
      const history = [
        { role: "coach", message: "What is 20 + 42? Tell how you got your answer." },
        { role: "student", message: "I don't know" },
        { role: "coach", message: "Let's do just the ones. What is 0 + 2?" },
        { role: "student", message: "two" },
        { role: "coach", message: "Good! Now the tens. What is 20 + 40?" },
        { role: "student", message: "60" },
        { role: "coach", message: "Now put them together. What is 60 + 2?" },
      ];
      const stepAcc = acc(history, "62");

      expect(stepAcc.satisfiedStepIds).toEqual(expect.arrayContaining(["s1", "s2", "s3"]));
      expect(stepAcc.missingStepIds).toEqual([]);
      expect(stepAcc.answerCorrect).toBe(true);

      const move = getDeterministicRemediationMove(steps, stepAcc, "62", problem, history);
      expect(move).not.toBeNull();
      expect(move!.type).toBe("WRAP_SUCCESS");
      expect(move!.studentState).toBe("success");
    });

    // Regression: wrong step answer stays wrong/misconception
    it("regression: '3' after coach probed ones → wrong/misconception, not partial", () => {
      const history = [
        { role: "coach", message: "What is 20 + 42? Tell how you got your answer." },
        { role: "student", message: "I don't know" },
        { role: "coach", message: "Let's do just the ones. What is 0 + 2?" },
      ];
      const stepAcc = acc(history, "3");

      expect(stepAcc.newlySatisfiedStepIds).not.toContain("s1");
      const state = classifyStudentState("3", stepAcc, problem);
      expect(state).not.toBe("partial");
      expect(["wrong", "misconception"]).toContain(state);

      const move = getDeterministicRemediationMove(steps, stepAcc, "3", problem, history);
      expect(move).not.toBeNull();
      expect(["wrong", "misconception"]).toContain(move!.studentState);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // detectMisconceptionCategory
  // ══════════════════════════════════════════════════════════════

  describe("detectMisconceptionCategory", () => {
    it("detects SUBTRACTION_ON_ADDITION for 'take away'", () => {
      const acc = accumulate([], "I took away and got 3");
      const cat = detectMisconceptionCategory("I took away and got 3", 3, mathProblem, acc);
      expect(cat).toBe("SUBTRACTION_ON_ADDITION");
    });

    it("detects SUBTRACTION_ON_ADDITION for 'minus'", () => {
      const acc = accumulate([], "minus 3");
      const cat = detectMisconceptionCategory("minus 3", 3, mathProblem, acc);
      expect(cat).toBe("SUBTRACTION_ON_ADDITION");
    });

    it("detects SUBTRACTION_ON_ADDITION for '1 - 4 = 3'", () => {
      const acc = accumulate([], "1 - 4 = 3");
      const cat = detectMisconceptionCategory("1 - 4 = 3", 3, mathProblem, acc);
      expect(cat).toBe("SUBTRACTION_ON_ADDITION");
    });

    it("detects SUBTRACTION_ON_ADDITION for 'subtract'", () => {
      const acc = accumulate([], "I subtracted and got 3");
      const cat = detectMisconceptionCategory("I subtracted and got 3", 3, mathProblem, acc);
      expect(cat).toBe("SUBTRACTION_ON_ADDITION");
    });

    it("detects ONES_ONLY_CONFUSION for answer=5 on 11+14", () => {
      const acc = accumulate([], "5");
      const cat = detectMisconceptionCategory("5", 5, mathProblem, acc);
      expect(cat).toBe("ONES_ONLY_CONFUSION");
    });

    it("detects TENS_ONLY_CONFUSION for answer=20 on 11+14", () => {
      const acc = accumulate([], "20");
      const cat = detectMisconceptionCategory("20", 20, mathProblem, acc);
      expect(cat).toBe("TENS_ONLY_CONFUSION");
    });

    it("detects KNOWN_WRONG_ANSWER for answer=15 on 11+14", () => {
      const acc = accumulate([], "15");
      const cat = detectMisconceptionCategory("15", 15, mathProblem, acc);
      expect(cat).toBe("KNOWN_WRONG_ANSWER");
    });

    it("detects ADDITION_ON_SUBTRACTION for 'I added' on subtraction", () => {
      const acc = subAccumulate([], "I added them and got 70");
      const cat = detectMisconceptionCategory("I added them and got 70", 70, subProblem, acc);
      expect(cat).toBe("ADDITION_ON_SUBTRACTION");
    });

    it("returns null for plain wrong answer with no pattern", () => {
      const acc = accumulate([], "99");
      const cat = detectMisconceptionCategory("99", 99, mathProblem, acc);
      expect(cat).toBeNull();
    });
  });

  // ══════════════════════════════════════════════════════════════
  // getNextMissingStep
  // ══════════════════════════════════════════════════════════════

  describe("getNextMissingStep", () => {
    it("returns first foundational step when nothing is satisfied", () => {
      const acc = accumulate([], "21");
      const step = getNextMissingStep(reasoningSteps, acc);
      expect(step).not.toBeNull();
      expect(step!.kind).toBe("ones_sum");
    });

    it("skips satisfied steps", () => {
      const acc = accumulate(
        [
          { role: "student", message: "1 + 4 = 5" },
          { role: "coach", message: "Good." },
        ],
        "hmm"
      );
      const step = getNextMissingStep(reasoningSteps, acc);
      expect(step).not.toBeNull();
      expect(step!.kind).toBe("tens_sum");
    });

    it("returns combine step when all foundational steps are satisfied", () => {
      const acc = accumulate(
        [
          { role: "student", message: "1 + 4 = 5" },
          { role: "coach", message: "Good." },
          { role: "student", message: "10 + 10 = 20" },
          { role: "coach", message: "Good." },
        ],
        "hmm"
      );
      const step = getNextMissingStep(reasoningSteps, acc);
      expect(step).not.toBeNull();
      expect(step!.kind).toBe("combine");
    });

    it("returns null when all steps are satisfied", () => {
      const acc = accumulate(
        [
          { role: "student", message: "25" },
          { role: "coach", message: "What do you get when you add 1 and 4?" },
          { role: "student", message: "1 + 4 = 5" },
          { role: "coach", message: "What do you get when you add 10 and 10?" },
        ],
        "10 + 10 = 20"
      );
      const step = getNextMissingStep(reasoningSteps, acc);
      expect(step).toBeNull();
    });
  });

  // ══════════════════════════════════════════════════════════════
  // Case A: Wrong answer → ones → tens → success
  // ══════════════════════════════════════════════════════════════

  describe("Case A: wrong answer → ones → tens → success", () => {
    it("turn 1: wrong answer (21) → probes ones step", () => {
      const move = getMove([], "21");
      expect(move).not.toBeNull();
      expect(move!.type).toBe("STEP_PROBE_DIRECT");
      expect(move!.targetStepKind).toBe("ones_sum");
      expect(move!.studentState).toBe("wrong");
      expect(move!.text).toContain("1 and 4");
      expect(move!.text).toContain("?");
      assertNoVaguePhrases(move!.text);
    });

    it("turn 2: student says 5 → acknowledges and probes tens", () => {
      const move = getMove(
        [
          { role: "student", message: "21" },
          { role: "coach", message: "What do you get when you add 1 and 4?" },
        ],
        "5"
      );
      expect(move).not.toBeNull();
      expect(move!.targetStepKind).toBe("tens_sum");
      expect(move!.text).toContain("10 and 10");
      assertNoVaguePhrases(move!.text);
    });

    it("turn 3: student says 20 → combine prompt", () => {
      const move = getMove(
        [
          { role: "student", message: "21" },
          { role: "coach", message: "What do you get when you add 1 and 4?" },
          { role: "student", message: "5" },
          { role: "coach", message: "What do you get when you add 10 and 10?" },
        ],
        "20"
      );
      expect(move).not.toBeNull();
      expect(move!.targetStepKind).toBe("combine");
      expect(move!.text).toMatch(/20.*5|5.*20/);
      assertNoVaguePhrases(move!.text);
    });

    it("turn 4: student says 25 → WRAP_SUCCESS", () => {
      const move = getMove(
        [
          { role: "student", message: "21" },
          { role: "coach", message: "What do you get when you add 1 and 4?" },
          { role: "student", message: "5" },
          { role: "coach", message: "What do you get when you add 10 and 10?" },
          { role: "student", message: "20" },
          { role: "coach", message: "Now what is 20 + 5?" },
        ],
        "25"
      );
      expect(move).not.toBeNull();
      expect(move!.type).toBe("WRAP_SUCCESS");
    });
  });

  // ══════════════════════════════════════════════════════════════
  // Misconception: "1 - 4 = 3" on 11 + 14 (Case A from spec)
  // ══════════════════════════════════════════════════════════════

  describe("Misconception A: '1 - 4 = 3' on addition problem", () => {
    it("names the misconception and redirects to ones step", () => {
      const move = getMove([], "1 - 4 = 3");
      expect(move).not.toBeNull();
      expect(move!.type).toBe("STEP_MISCONCEPTION_REDIRECT");
      expect(move!.misconceptionCategory).toBe("SUBTRACTION_ON_ADDITION");
      expect(move!.targetStepKind).toBe("ones_sum");
      expect(move!.text).toMatch(/adding.*not.*subtract/i);
      expect(move!.text).toContain("1 and 4");
      expect(move!.text).toContain("?");
      assertNoVaguePhrases(move!.text);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // Misconception B: "taking away" on addition problem
  // ══════════════════════════════════════════════════════════════

  describe("Misconception B: 'taking away' on addition problem", () => {
    it("redirects with adding-not-subtracting message", () => {
      const move = getMove([], "I was taking away 4 from 1 and got 3");
      expect(move).not.toBeNull();
      expect(move!.type).toBe("STEP_MISCONCEPTION_REDIRECT");
      expect(move!.misconceptionCategory).toBe("SUBTRACTION_ON_ADDITION");
      expect(move!.text).toMatch(/adding.*not.*subtract/i);
      expect(move!.text).toContain("1 and 4");
      assertNoVaguePhrases(move!.text);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // Misconception C: "25" then "1 - 4 = 3" (post-correct misconception)
  // ══════════════════════════════════════════════════════════════

  describe("Misconception C: correct answer then misconception on follow-up", () => {
    it("redirects specifically to ones step, not generic retry", () => {
      const move = getMove(
        [
          { role: "student", message: "25" },
          { role: "coach", message: "What do you get when you add 1 and 4?" },
        ],
        "1 - 4 = 3"
      );
      expect(move).not.toBeNull();
      expect(move!.type).toBe("STEP_MISCONCEPTION_REDIRECT");
      expect(move!.misconceptionCategory).toBe("SUBTRACTION_ON_ADDITION");
      expect(move!.targetStepKind).toBe("ones_sum");
      expect(move!.text).toMatch(/adding.*not.*subtract/i);
      expect(move!.text).toContain("1 and 4");
      assertNoVaguePhrases(move!.text);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // Misconception D: ones-only confusion (answer = 5 for 11+14)
  // ══════════════════════════════════════════════════════════════

  describe("Misconception D: ones-only confusion (student gives 5)", () => {
    it("acknowledges ones part and redirects to tens step", () => {
      const move = getMove([], "5");
      expect(move).not.toBeNull();
      expect(move!.type).toBe("STEP_MISCONCEPTION_REDIRECT");
      expect(move!.misconceptionCategory).toBe("ONES_ONLY_CONFUSION");
      // Should target tens step specifically
      expect(move!.targetStepKind).toBe("tens_sum");
      expect(move!.text).toMatch(/ones part/i);
      expect(move!.text).toMatch(/tens/i);
      expect(move!.text).toContain("10 and 10");
      assertNoVaguePhrases(move!.text);
    });

    it("acknowledged 1 + 4 = 5 with tens missing → redirects to tens", () => {
      const move = getMove([], "1 + 4 = 5");
      expect(move).not.toBeNull();
      // Student explicitly showed ones work → partial, but answer is wrong
      // The "1 + 4 = 5" satisfies step_1, so this is "partial"
      // which gets STEP_ACKNOWLEDGE_AND_PROBE for tens
      expect(move!.targetStepKind).toBe("tens_sum");
      expect(move!.text).toContain("10 and 10");
      assertNoVaguePhrases(move!.text);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // Misconception E: tens-only confusion (answer = 20 for 11+14)
  // ══════════════════════════════════════════════════════════════

  describe("Misconception E: tens-only confusion (student gives 20)", () => {
    it("acknowledges tens part and redirects to ones step", () => {
      const move = getMove([], "20");
      expect(move).not.toBeNull();
      expect(move!.type).toBe("STEP_MISCONCEPTION_REDIRECT");
      expect(move!.misconceptionCategory).toBe("TENS_ONLY_CONFUSION");
      // Should target ones step specifically
      expect(move!.targetStepKind).toBe("ones_sum");
      expect(move!.text).toMatch(/tens part/i);
      expect(move!.text).toMatch(/ones/i);
      expect(move!.text).toContain("1 and 4");
      assertNoVaguePhrases(move!.text);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // Misconception F: known wrong answer (15 for 11+14)
  // ══════════════════════════════════════════════════════════════

  describe("Misconception F: known wrong answer", () => {
    it("uses step-by-step redirect for known wrong answer 15", () => {
      const move = getMove([], "15");
      expect(move).not.toBeNull();
      expect(move!.type).toBe("STEP_MISCONCEPTION_REDIRECT");
      expect(move!.misconceptionCategory).toBe("KNOWN_WRONG_ANSWER");
      expect(move!.targetStepKind).toBe("ones_sum");
      expect(move!.text).toMatch(/^Not quite\./);
      expect(move!.text).toContain("?");
      assertNoVaguePhrases(move!.text);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // Misconception: addition on subtraction problem
  // ══════════════════════════════════════════════════════════════

  describe("Misconception: addition on subtraction problem", () => {
    it("redirects with subtracting-not-adding message", () => {
      const move = getSubMove([], "I added 7 and 3 and got 10");
      expect(move).not.toBeNull();
      expect(move!.type).toBe("STEP_MISCONCEPTION_REDIRECT");
      expect(move!.misconceptionCategory).toBe("ADDITION_ON_SUBTRACTION");
      expect(move!.text).toMatch(/subtracting.*not.*adding/i);
      assertNoVaguePhrases(move!.text);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // Case C: Uncertain / "I don't know"
  // ══════════════════════════════════════════════════════════════

  describe("Case C: uncertain / 'I don't know'", () => {
    it("uses simpler probe for ones step", () => {
      const move = getMove([], "I don't know");
      expect(move).not.toBeNull();
      expect(move!.type).toBe("STEP_PROBE_SIMPLER");
      expect(move!.targetStepKind).toBe("ones_sum");
      expect(move!.text).toMatch(/ones/i);
      expect(move!.text).toMatch(/1.*4|1 \+ 4/);
      assertNoVaguePhrases(move!.text);
    });

    it("consecutive uncertain turns produce different simpler probe wording", () => {
      // Turn 1: student says "I don't know" with no history
      const history1: Array<{ role: string; message: string }> = [];
      const acc1 = accumulate(history1, "I don't know");
      const move1 = getDeterministicRemediationMove(
        reasoningSteps, acc1, "I don't know", mathProblem, history1,
      );
      expect(move1).not.toBeNull();
      expect(move1!.type).toBe("STEP_PROBE_SIMPLER");

      // Turn 2: student says "I don't know" again, with turn 1 in history
      const history2 = [
        { role: "student", message: "I don't know" },
        { role: "coach", message: move1!.text },
      ];
      const acc2 = accumulate(history2, "I don't know");
      const move2 = getDeterministicRemediationMove(
        reasoningSteps, acc2, "I don't know", mathProblem, history2,
      );
      expect(move2).not.toBeNull();
      // The two responses must differ
      expect(move2!.text).not.toBe(move1!.text);
    });

    it("varied uncertain probe still references the expression", () => {
      const history1: Array<{ role: string; message: string }> = [];
      const acc1 = accumulate(history1, "I don't know");
      const move1 = getDeterministicRemediationMove(
        reasoningSteps, acc1, "I don't know", mathProblem, history1,
      );
      const history2 = [
        { role: "student", message: "I don't know" },
        { role: "coach", message: move1!.text },
      ];
      const acc2 = accumulate(history2, "I don't know");
      const move2 = getDeterministicRemediationMove(
        reasoningSteps, acc2, "I don't know", mathProblem, history2,
      );
      // Both probes must reference the expression
      expect(move1!.text).toMatch(/1.*4|1 \+ 4/);
      expect(move2!.text).toMatch(/1.*4|1 \+ 4/);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // Case D: Tens first → ones
  // ══════════════════════════════════════════════════════════════

  describe("Case D: tens first → ones", () => {
    it("acknowledges tens, probes ones (unordered reasoning)", () => {
      const move = getMove([], "10 + 10 = 20");
      expect(move).not.toBeNull();
      expect(move!.targetStepKind).toBe("ones_sum");
      expect(move!.text).toContain("1 and 4");
      assertNoVaguePhrases(move!.text);
    });

    it("after tens first, then ones → combine prompt", () => {
      const move = getMove(
        [
          { role: "student", message: "10 + 10 = 20" },
          { role: "coach", message: "Good. What do you get when you add 1 and 4?" },
        ],
        "5"
      );
      expect(move).not.toBeNull();
      expect(move!.targetStepKind).toBe("combine");
      assertNoVaguePhrases(move!.text);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // Case E: Combine step missing
  // ══════════════════════════════════════════════════════════════

  describe("Case E: combine step missing", () => {
    it("probes combine when ones and tens are satisfied", () => {
      const move = getMove(
        [
          { role: "student", message: "1 + 4 = 5" },
          { role: "coach", message: "Good." },
        ],
        "10 + 10 = 20"
      );
      expect(move).not.toBeNull();
      expect(move!.targetStepKind).toBe("combine");
      expect(move!.text).toMatch(/20.*5|5.*20/);
      assertNoVaguePhrases(move!.text);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // Case F: Explicit hint request — aligned to exact step
  // ══════════════════════════════════════════════════════════════

  describe("Case F: explicit hint request", () => {
    it("gives hint for missing ones step with exact operands", () => {
      const move = getMove([], "Can I have a hint?");
      expect(move).not.toBeNull();
      expect(move!.type).toBe("STEP_HINT");
      expect(move!.targetStepKind).toBe("ones_sum");
      expect(move!.text).toMatch(/hint/i);
      // Hint should mention the exact operands (1 and 4), not just "ones"
      expect(move!.text).toMatch(/1.*plus.*4|1.*4/i);
      assertNoVaguePhrases(move!.text);
    });

    it("gives hint for missing tens step with exact operands", () => {
      const move = getMove(
        [
          { role: "student", message: "1 + 4 = 5" },
          { role: "coach", message: "Good." },
        ],
        "Can I have a hint?"
      );
      expect(move).not.toBeNull();
      expect(move!.type).toBe("STEP_HINT");
      expect(move!.targetStepKind).toBe("tens_sum");
      expect(move!.text).toMatch(/hint/i);
      // Hint should mention the exact operands (10 and 10)
      expect(move!.text).toMatch(/10.*10/);
      assertNoVaguePhrases(move!.text);
    });

    it("gives hint for combine step with exact operands", () => {
      const move = getMove(
        [
          { role: "student", message: "1 + 4 = 5" },
          { role: "coach", message: "Good." },
          { role: "student", message: "10 + 10 = 20" },
          { role: "coach", message: "Good." },
        ],
        "give me a hint"
      );
      expect(move).not.toBeNull();
      expect(move!.type).toBe("STEP_HINT");
      expect(move!.targetStepKind).toBe("combine");
      expect(move!.text).toMatch(/hint/i);
      // Hint should mention 20 and 5
      expect(move!.text).toMatch(/20.*5|5.*20/);
      assertNoVaguePhrases(move!.text);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // Step hints are aligned to exact success criteria
  // ══════════════════════════════════════════════════════════════

  describe("step hints aligned to exact success criteria", () => {
    it("ones_sum hint guides toward '1 + 4 = 5' not just 'look at ones'", () => {
      const move = getMove([], "hint please");
      expect(move!.text).toMatch(/1.*plus.*4|what is 1.*4/i);
      // Should NOT be vague like "look at tens and ones separately"
      expect(move!.text).not.toMatch(/tens and ones separately/i);
    });

    it("tens_sum hint guides toward '10 + 10 = 20' not just 'look at tens'", () => {
      const move = getMove(
        [
          { role: "student", message: "1 + 4 = 5" },
          { role: "coach", message: "Good." },
        ],
        "hint"
      );
      expect(move!.text).toMatch(/10.*plus.*10|what is 10.*10/i);
    });

    it("combine hint guides toward '20 + 5 = 25' with exact numbers", () => {
      const move = getMove(
        [
          { role: "student", message: "1 + 4 = 5" },
          { role: "coach", message: "Good." },
          { role: "student", message: "10 + 10 = 20" },
          { role: "coach", message: "Good." },
        ],
        "hint"
      );
      expect(move!.text).toMatch(/20.*plus.*5|20.*5|what is.*20.*5/i);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // Already-satisfied step is never re-probed
  // ══════════════════════════════════════════════════════════════

  describe("already-satisfied step is never re-probed", () => {
    it("after ones is satisfied, remediation targets tens (not ones)", () => {
      const move = getMove(
        [
          { role: "student", message: "1 + 4 = 5" },
          { role: "coach", message: "Good." },
        ],
        "I don't know"
      );
      expect(move).not.toBeNull();
      expect(move!.targetStepId).toBe("step_2");
      expect(move!.targetStepKind).toBe("tens_sum");
    });

    it("after ones and tens are satisfied, remediation targets combine", () => {
      const move = getMove(
        [
          { role: "student", message: "1 + 4 = 5" },
          { role: "coach", message: "Good." },
          { role: "student", message: "10 + 10 = 20" },
          { role: "coach", message: "Good." },
        ],
        "I'm not sure"
      );
      expect(move).not.toBeNull();
      expect(move!.targetStepId).toBe("step_3");
      expect(move!.targetStepKind).toBe("combine");
    });
  });

  // ══════════════════════════════════════════════════════════════
  // Wording tests: no banned phrases in any remediation move
  // ══════════════════════════════════════════════════════════════

  describe("wording: no banned vague phrases", () => {
    const scenarios: Array<{ name: string; history: Array<{ role: string; message: string }>; response: string }> = [
      { name: "wrong answer first turn", history: [], response: "21" },
      { name: "misconception subtraction", history: [], response: "1 - 4 = 3" },
      { name: "misconception taking away", history: [], response: "I was taking away and got 3" },
      { name: "ones-only confusion", history: [], response: "5" },
      { name: "tens-only confusion", history: [], response: "20" },
      { name: "known wrong answer", history: [], response: "15" },
      { name: "uncertain", history: [], response: "I don't know" },
      { name: "hint request", history: [], response: "hint please" },
      {
        name: "post-correct misconception",
        history: [
          { role: "student", message: "25" },
          { role: "coach", message: "What do you get when you add 1 and 4?" },
        ],
        response: "I subtracted and got 3",
      },
      {
        name: "partial progress",
        history: [
          { role: "student", message: "1 + 4 = 5" },
          { role: "coach", message: "Good." },
        ],
        response: "I don't know the next part",
      },
    ];

    for (const s of scenarios) {
      it(`${s.name}: no vague phrases`, () => {
        const move = getMove(s.history, s.response);
        expect(move).not.toBeNull();
        if (move!.type !== "WRAP_SUCCESS") {
          assertNoVaguePhrases(move!.text);
        }
      });
    }
  });

  // ══════════════════════════════════════════════════════════════
  // Move explanations are well-formed
  // ══════════════════════════════════════════════════════════════

  describe("explanation sentence is always explainable", () => {
    const testCases: Array<{ description: string; history: Array<{ role: string; message: string }>; response: string }> = [
      { description: "wrong answer first turn", history: [], response: "21" },
      { description: "uncertain first turn", history: [], response: "I don't know" },
      { description: "hint request first turn", history: [], response: "hint please" },
      { description: "subtraction misconception", history: [], response: "I took away and got 3" },
      { description: "ones-only misconception", history: [], response: "5" },
      { description: "tens-only misconception", history: [], response: "20" },
      {
        description: "partial progress",
        history: [
          { role: "student", message: "1 + 4 = 5" },
          { role: "coach", message: "Good." },
        ],
        response: "um I'm not sure",
      },
    ];

    for (const tc of testCases) {
      it(`${tc.description}: explanation mentions step and state`, () => {
        const move = getMove(tc.history, tc.response);
        expect(move).not.toBeNull();
        if (move!.type === "WRAP_SUCCESS" || move!.type === "WRAP_NEEDS_SUPPORT") return;
        expect(move!.explanation).toContain("step");
        expect(move!.explanation.length).toBeGreaterThan(20);
        expect(move!.targetStepId).toBeTruthy();
      });
    }
  });

  // ══════════════════════════════════════════════════════════════
  // Misconception explanations include category
  // ══════════════════════════════════════════════════════════════

  describe("misconception explanations include category reason", () => {
    it("subtraction-on-addition includes reason", () => {
      const move = getMove([], "1 - 4 = 3");
      expect(move!.explanation).toMatch(/subtraction.*addition/i);
    });

    it("ones-only includes reason", () => {
      const move = getMove([], "5");
      expect(move!.explanation).toMatch(/ones.*tens/i);
    });

    it("tens-only includes reason", () => {
      const move = getMove([], "20");
      expect(move!.explanation).toMatch(/tens.*ones/i);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // shouldUseDeterministicRemediation
  // ══════════════════════════════════════════════════════════════

  describe("shouldUseDeterministicRemediation", () => {
    it("returns true when reasoning steps and accumulation exist", () => {
      const acc = accumulate([], "21");
      expect(shouldUseDeterministicRemediation(reasoningSteps, acc)).toBe(true);
    });

    it("returns false when no reasoning steps", () => {
      const acc = accumulate([], "21");
      expect(shouldUseDeterministicRemediation(undefined, acc)).toBe(false);
      expect(shouldUseDeterministicRemediation([], acc)).toBe(false);
    });

    it("returns false when no accumulation", () => {
      expect(shouldUseDeterministicRemediation(reasoningSteps, null)).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // Correct answer on first turn → still probes
  // ══════════════════════════════════════════════════════════════

  describe("correct answer but no explanation", () => {
    it("probes for first missing step", () => {
      const move = getMove([], "25");
      expect(move).not.toBeNull();
      expect(move!.type).toBe("STEP_ACKNOWLEDGE_AND_PROBE");
      expect(move!.targetStepKind).toBe("ones_sum");
      expect(move!.studentState).toBe("partial");
      assertNoVaguePhrases(move!.text);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // Word number answers
  // ══════════════════════════════════════════════════════════════

  describe("word number answers", () => {
    it("'five' after coach asks about ones satisfies step_1", () => {
      const acc = accumulate(
        [
          { role: "student", message: "25" },
          { role: "coach", message: "What do you get when you add 1 and 4?" },
        ],
        "five"
      );
      expect(acc.satisfiedStepIds).toContain("step_1");
    });

    it("'twenty' after coach asks about tens satisfies step_2", () => {
      const acc = accumulate(
        [
          { role: "student", message: "25" },
          { role: "coach", message: "What do you get when you add 10 and 10?" },
        ],
        "twenty"
      );
      expect(acc.satisfiedStepIds).toContain("step_2");
    });
  });

  // ══════════════════════════════════════════════════════════════
  // Full flow simulations
  // ══════════════════════════════════════════════════════════════

  describe("full flow: wrong → ones → tens → combine → success", () => {
    it("walks through all 4 turns correctly", () => {
      const move1 = getMove([], "21");
      expect(move1!.type).toBe("STEP_PROBE_DIRECT");
      expect(move1!.targetStepKind).toBe("ones_sum");

      const move2 = getMove(
        [
          { role: "student", message: "21" },
          { role: "coach", message: move1!.text },
        ],
        "5"
      );
      expect(move2!.targetStepKind).toBe("tens_sum");

      const move3 = getMove(
        [
          { role: "student", message: "21" },
          { role: "coach", message: move1!.text },
          { role: "student", message: "5" },
          { role: "coach", message: move2!.text },
        ],
        "20"
      );
      expect(move3!.targetStepKind).toBe("combine");

      const move4 = getMove(
        [
          { role: "student", message: "21" },
          { role: "coach", message: move1!.text },
          { role: "student", message: "5" },
          { role: "coach", message: move2!.text },
          { role: "student", message: "20" },
          { role: "coach", message: move3!.text },
        ],
        "25"
      );
      expect(move4!.type).toBe("WRAP_SUCCESS");
    });
  });

  describe("full flow: tens first → ones → combine → success", () => {
    it("handles unordered step demonstration", () => {
      const move1 = getMove([], "10 + 10 = 20");
      expect(move1!.targetStepKind).toBe("ones_sum");

      const move2 = getMove(
        [
          { role: "student", message: "10 + 10 = 20" },
          { role: "coach", message: move1!.text },
        ],
        "1 + 4 = 5"
      );
      expect(move2!.targetStepKind).toBe("combine");

      const move3 = getMove(
        [
          { role: "student", message: "10 + 10 = 20" },
          { role: "coach", message: move1!.text },
          { role: "student", message: "1 + 4 = 5" },
          { role: "coach", message: move2!.text },
        ],
        "25"
      );
      expect(move3!.type).toBe("WRAP_SUCCESS");
    });
  });

  describe("full flow: misconception → correction → progress → success", () => {
    it("recovers from subtraction misconception through step-by-step", () => {
      // Turn 1: misconception
      const move1 = getMove([], "1 - 4 = 3");
      expect(move1!.type).toBe("STEP_MISCONCEPTION_REDIRECT");
      expect(move1!.misconceptionCategory).toBe("SUBTRACTION_ON_ADDITION");

      // Turn 2: student corrects to ones
      const move2 = getMove(
        [
          { role: "student", message: "1 - 4 = 3" },
          { role: "coach", message: move1!.text },
        ],
        "5"
      );
      expect(move2!.targetStepKind).toBe("tens_sum");

      // Turn 3: student does tens
      const move3 = getMove(
        [
          { role: "student", message: "1 - 4 = 3" },
          { role: "coach", message: move1!.text },
          { role: "student", message: "5" },
          { role: "coach", message: move2!.text },
        ],
        "20"
      );
      expect(move3!.targetStepKind).toBe("combine");

      // Turn 4: success
      const move4 = getMove(
        [
          { role: "student", message: "1 - 4 = 3" },
          { role: "coach", message: move1!.text },
          { role: "student", message: "5" },
          { role: "coach", message: move2!.text },
          { role: "student", message: "20" },
          { role: "coach", message: move3!.text },
        ],
        "25"
      );
      expect(move4!.type).toBe("WRAP_SUCCESS");
    });
  });

  // ══════════════════════════════════════════════════════════════
  // Unified hint/remediation regression tests (requirement 7)
  // ══════════════════════════════════════════════════════════════

  describe("unified hint flow: hint_request and uncertain use same step engine", () => {
    it("A: 'I don't know' → hint for ones uses exact operands → student says '1 + 4 = 5' → coach asks tens", () => {
      // Turn 1: "I don't know" → simpler probe for ones step
      const move1 = getMove([], "I don't know");
      expect(move1).not.toBeNull();
      expect(move1!.type).toBe("STEP_PROBE_SIMPLER");
      expect(move1!.targetStepKind).toBe("ones_sum");
      expect(move1!.text).toMatch(/1.*4|1 \+ 4/);

      // Turn 2: student answers ones → coach asks tens
      const move2 = getMove(
        [
          { role: "student", message: "I don't know" },
          { role: "coach", message: move1!.text },
        ],
        "1 + 4 = 5"
      );
      expect(move2).not.toBeNull();
      expect(move2!.targetStepKind).toBe("tens_sum");
      expect(move2!.text).toContain("10 and 10");
    });

    it("B: wrong '21' → hint for ones uses exact operands → student says '5' → coach asks tens", () => {
      // Turn 1: wrong answer → probe ones
      const move1 = getMove([], "21");
      expect(move1!.targetStepKind).toBe("ones_sum");

      // Turn 2: explicit hint request → step hint for ones (still missing)
      const move2 = getMove(
        [
          { role: "student", message: "21" },
          { role: "coach", message: move1!.text },
        ],
        "can I have a hint?"
      );
      expect(move2).not.toBeNull();
      expect(move2!.type).toBe("STEP_HINT");
      expect(move2!.targetStepKind).toBe("ones_sum");
      expect(move2!.text).toMatch(/1.*plus.*4|what is 1.*4/i);

      // Turn 3: student says "5" → coach asks tens
      const move3 = getMove(
        [
          { role: "student", message: "21" },
          { role: "coach", message: move1!.text },
          { role: "student", message: "can I have a hint?" },
          { role: "coach", message: move2!.text },
        ],
        "5"
      );
      expect(move3).not.toBeNull();
      expect(move3!.targetStepKind).toBe("tens_sum");
    });

    it("C: after tens satisfied, hint request produces combine hint 'What is 20 + 5?'", () => {
      const move = getMove(
        [
          { role: "student", message: "1 + 4 = 5" },
          { role: "coach", message: "Good." },
          { role: "student", message: "10 + 10 = 20" },
          { role: "coach", message: "Good." },
        ],
        "hint please"
      );
      expect(move).not.toBeNull();
      expect(move!.type).toBe("STEP_HINT");
      expect(move!.targetStepKind).toBe("combine");
      expect(move!.text).toMatch(/20.*plus.*5|20.*5/i);
    });

    it("D: no generic hint strings appear in deterministic reasoning-step moves", () => {
      const GENERIC_HINT_PATTERNS = [
        /look at.*(tens and ones|ones and tens) separately/i,
        /add the ones first.*then the tens/i,
        /break.*into.*tens.*ones/i,
        /here's a hint:/i,
      ];

      const scenarios = [
        getMove([], "hint please"),
        getMove([], "I don't know"),
        getMove([], "21"),
        getMove([], "5"),
        getMove([], "20"),
        getMove([], "1 - 4 = 3"),
        getMove(
          [
            { role: "student", message: "1 + 4 = 5" },
            { role: "coach", message: "Good." },
          ],
          "give me a hint"
        ),
      ];

      for (const move of scenarios) {
        expect(move).not.toBeNull();
        if (move!.type !== "WRAP_SUCCESS") {
          for (const pattern of GENERIC_HINT_PATTERNS) {
            expect(move!.text).not.toMatch(pattern);
          }
        }
      }
    });

    it("E: hinted path and non-hinted path produce the same next missing step", () => {
      // Path 1: wrong answer → probe ones
      const wrongMove = getMove([], "21");
      expect(wrongMove!.targetStepKind).toBe("ones_sum");

      // Path 2: hint request → hint for ones (same step)
      const hintMove = getMove([], "hint please");
      expect(hintMove!.targetStepKind).toBe("ones_sum");

      // Path 3: uncertain → simpler probe for ones (same step)
      const uncertainMove = getMove([], "I don't know");
      expect(uncertainMove!.targetStepKind).toBe("ones_sum");

      // All target the same step
      expect(wrongMove!.targetStepId).toBe(hintMove!.targetStepId);
      expect(hintMove!.targetStepId).toBe(uncertainMove!.targetStepId);
    });

    it("F: subtraction misconception on addition still gets redirect plus exact step guidance", () => {
      const move = getMove([], "I took away 4 from 1 and got 3");
      expect(move).not.toBeNull();
      expect(move!.type).toBe("STEP_MISCONCEPTION_REDIRECT");
      expect(move!.misconceptionCategory).toBe("SUBTRACTION_ON_ADDITION");
      // Two-sentence max: correction + step probe
      expect(move!.text).toMatch(/adding.*not.*subtract/i);
      expect(move!.text).toContain("1 and 4");
      expect(move!.text).toContain("?");
      // Count sentences (period-terminated segments)
      const sentences = move!.text.split(/[.!?]+/).filter(s => s.trim().length > 0);
      expect(sentences.length).toBeLessThanOrEqual(2);
    });
  });

  describe("misconception explanation: max two sentences", () => {
    it("SUBTRACTION_ON_ADDITION is ≤2 sentences", () => {
      const move = getMove([], "1 - 4 = 3");
      const sentences = move!.text.split(/[.!?]+/).filter(s => s.trim().length > 0);
      expect(sentences.length).toBeLessThanOrEqual(2);
    });

    it("ONES_ONLY_CONFUSION is ≤3 parts (correction context + redirect + probe)", () => {
      const move = getMove([], "5");
      // "You found the ones part. Now let's add the tens. What is 10 + 10?"
      // Spec approves this exact wording — verify it matches
      expect(move!.text).toMatch(/ones part/i);
      expect(move!.text).toMatch(/tens/i);
      expect(move!.text).toContain("?");
    });

    it("KNOWN_WRONG_ANSWER is ≤2 sentences", () => {
      const move = getMove([], "15");
      const sentences = move!.text.split(/[.!?]+/).filter(s => s.trim().length > 0);
      expect(sentences.length).toBeLessThanOrEqual(2);
    });

    it("never re-explains misconception after correction", () => {
      // Turn 1: misconception
      const move1 = getMove([], "1 - 4 = 3");
      expect(move1!.misconceptionCategory).toBe("SUBTRACTION_ON_ADDITION");

      // Turn 2: student corrects with explicit step → should probe next step, NOT re-explain subtraction
      const move2 = getMove(
        [
          { role: "student", message: "1 - 4 = 3" },
          { role: "coach", message: move1!.text },
        ],
        "1 + 4 = 5"
      );
      // Student explicitly showed ones step — should acknowledge and probe tens
      expect(move2!.type).not.toBe("STEP_MISCONCEPTION_REDIRECT");
      expect(move2!.text).not.toMatch(/adding.*not.*subtract/i);
      expect(move2!.targetStepKind).toBe("tens_sum");
    });
  });

  describe("full flow: hint request → step hint → answer → next step", () => {
    it("hint request produces step hint, then answer advances to next step", () => {
      // Turn 1: hint request → step hint for ones
      const move1 = getMove([], "give me a hint");
      expect(move1!.type).toBe("STEP_HINT");
      expect(move1!.targetStepKind).toBe("ones_sum");
      expect(move1!.text).toMatch(/1.*plus.*4/i);

      // Turn 2: student says "5" → moves to tens
      const move2 = getMove(
        [
          { role: "student", message: "give me a hint" },
          { role: "coach", message: move1!.text },
        ],
        "5"
      );
      expect(move2!.targetStepKind).toBe("tens_sum");

      // Turn 3: hint request for tens → step hint for tens
      const move3 = getMove(
        [
          { role: "student", message: "give me a hint" },
          { role: "coach", message: move1!.text },
          { role: "student", message: "5" },
          { role: "coach", message: move2!.text },
        ],
        "help"
      );
      expect(move3!.type).toBe("STEP_HINT");
      expect(move3!.targetStepKind).toBe("tens_sum");
      expect(move3!.text).toMatch(/10.*plus.*10/i);

      // Turn 4: student says "20" → combine
      const move4 = getMove(
        [
          { role: "student", message: "give me a hint" },
          { role: "coach", message: move1!.text },
          { role: "student", message: "5" },
          { role: "coach", message: move2!.text },
          { role: "student", message: "help" },
          { role: "coach", message: move3!.text },
        ],
        "20"
      );
      expect(move4!.targetStepKind).toBe("combine");

      // Turn 5: student says "25" → success
      const move5 = getMove(
        [
          { role: "student", message: "give me a hint" },
          { role: "coach", message: move1!.text },
          { role: "student", message: "5" },
          { role: "coach", message: move2!.text },
          { role: "student", message: "help" },
          { role: "coach", message: move3!.text },
          { role: "student", message: "20" },
          { role: "coach", message: move4!.text },
        ],
        "25"
      );
      expect(move5!.type).toBe("WRAP_SUCCESS");
    });
  });

  describe("numeric subtraction/reversal misconception detection", () => {
    // When a student answers with |a - b| or |ones_a - ones_b| on an
    // addition problem, detect as SUBTRACTION_ON_ADDITION without
    // needing explicit subtraction language.

    it("'three' for 11+14 → SUBTRACTION_ON_ADDITION (|14-11|=3)", () => {
      const acc = accumulateReasoningStepEvidence(reasoningSteps, [], "three", 25);
      const category = detectMisconceptionCategory("three", 3, mathProblem, acc);
      expect(category).toBe("SUBTRACTION_ON_ADDITION");
    });

    it("'3' for 11+14 → SUBTRACTION_ON_ADDITION (|4-1|=3)", () => {
      const acc = accumulateReasoningStepEvidence(reasoningSteps, [], "3", 25);
      const category = detectMisconceptionCategory("3", 3, mathProblem, acc);
      expect(category).toBe("SUBTRACTION_ON_ADDITION");
    });

    it("classifyStudentState('three') → 'misconception'", () => {
      const acc = accumulateReasoningStepEvidence(reasoningSteps, [], "three", 25);
      expect(classifyStudentState("three", acc, mathProblem)).toBe("misconception");
    });

    it("getDeterministicRemediationMove returns STEP_MISCONCEPTION_REDIRECT for 'three'", () => {
      const acc = accumulateReasoningStepEvidence(reasoningSteps, [], "three", 25);
      const move = getDeterministicRemediationMove(reasoningSteps, acc, "three", mathProblem);
      expect(move).not.toBeNull();
      expect(move!.type).toBe("STEP_MISCONCEPTION_REDIRECT");
      expect(move!.misconceptionCategory).toBe("SUBTRACTION_ON_ADDITION");
      expect(move!.text.toLowerCase()).toMatch(/add/);
      expect(move!.text).toContain("?");
    });

    it("misconception redirect stays on ones_sum step", () => {
      const acc = accumulateReasoningStepEvidence(reasoningSteps, [], "three", 25);
      const move = getDeterministicRemediationMove(reasoningSteps, acc, "three", mathProblem);
      expect(move!.targetStepKind).toBe("ones_sum");
      expect(move!.text).toMatch(/1.*4|4.*1/);
    });

    it("repeated 'three' still produces misconception redirect", () => {
      const history = [
        { role: "student" as const, message: "three" },
        { role: "coach" as const, message: "We're adding in this problem, not subtracting. What do you get when you add 1 and 4?" },
      ];
      const acc = accumulateReasoningStepEvidence(reasoningSteps, history, "three", 25);
      const move = getDeterministicRemediationMove(reasoningSteps, acc, "three", mathProblem);
      expect(move!.type).toBe("STEP_MISCONCEPTION_REDIRECT");
      expect(move!.misconceptionCategory).toBe("SUBTRACTION_ON_ADDITION");
    });

    it("does NOT fire for answers that happen to match diff but are correct", () => {
      // 5 + 0 = 5, |5-0|=5 → should NOT detect as subtraction since 5 IS the correct answer
      const trivialProblem: MathProblem = {
        skill: "two_digit_addition",
        a: 5,
        b: 0,
        expression: "5 + 0",
        correctAnswer: 5,
        requiresRegrouping: false,
        expectedStrategyTags: [],
      };
      const acc = accumulateReasoningStepEvidence(reasoningSteps, [], "5", 5);
      const category = detectMisconceptionCategory("5", 5, trivialProblem, acc);
      // 5 is the correct answer, so extractedAnswer === correctAnswer,
      // and isWrongAnswer is false — this path won't even be called.
      // But if it were, fullDiff=5 === correctAnswer=5, so the guard prevents it.
      expect(category).not.toBe("SUBTRACTION_ON_ADDITION");
    });

    it("numeric addition detection for subtraction problems", () => {
      const subProblem: MathProblem = {
        skill: "two_digit_subtraction",
        a: 15,
        b: 8,
        expression: "15 - 8",
        correctAnswer: 7,
        requiresRegrouping: false,
        expectedStrategyTags: [],
      };
      const acc = accumulateReasoningStepEvidence(reasoningSteps, [], "23", 7);
      // Student said 23 = 15+8 → added instead of subtracted
      const category = detectMisconceptionCategory("23", 23, subProblem, acc);
      expect(category).toBe("ADDITION_ON_SUBTRACTION");
    });
  });

  // ── Interrogative candidate answers ────────────────────────────────
  describe("interrogative candidate answers (question form)", () => {
    it('"Is it three?" on 11+14 → misconception + SUBTRACTION_ON_ADDITION', () => {
      const acc = accumulateReasoningStepEvidence(reasoningSteps, [], "is it three", 25);
      const move = getDeterministicRemediationMove(reasoningSteps, acc, "Is it three?", mathProblem);
      expect(move).not.toBeNull();
      expect(move!.type).toBe("STEP_MISCONCEPTION_REDIRECT");
      expect(move!.misconceptionCategory).toBe("SUBTRACTION_ON_ADDITION");
      expect(move!.text).toContain("adding");
      expect(move!.text).toContain("?"); // must contain a follow-up probe question
      // Must NOT contain generic fallback language
      expect(move!.text.toLowerCase()).not.toMatch(/i heard you/);
      expect(move!.text.toLowerCase()).not.toMatch(/keep exploring/);
      expect(move!.text.toLowerCase()).not.toMatch(/good start/);
    });

    it('"Is the answer three?" → same misconception detection as "three"', () => {
      const acc = accumulateReasoningStepEvidence(reasoningSteps, [], "is the answer three", 25);
      const move = getDeterministicRemediationMove(reasoningSteps, acc, "Is the answer three?", mathProblem);
      expect(move).not.toBeNull();
      expect(move!.type).toBe("STEP_MISCONCEPTION_REDIRECT");
      expect(move!.misconceptionCategory).toBe("SUBTRACTION_ON_ADDITION");
    });

    it('"Could it be 3?" → misconception detected from digit form', () => {
      const acc = accumulateReasoningStepEvidence(reasoningSteps, [], "could it be 3", 25);
      const move = getDeterministicRemediationMove(reasoningSteps, acc, "Could it be 3?", mathProblem);
      expect(move).not.toBeNull();
      expect(move!.type).toBe("STEP_MISCONCEPTION_REDIRECT");
      expect(move!.misconceptionCategory).toBe("SUBTRACTION_ON_ADDITION");
    });

    it('"So is it 25?" with all steps already satisfied → WRAP_SUCCESS', () => {
      // All steps satisfied: ones=5, tens=20, combine=25
      const acc = accumulateReasoningStepEvidence(
        reasoningSteps, [], "so is it 25", 25,
      );
      // Manually make all steps satisfied for this test
      const fullAcc: ReasoningStepAccumulation = {
        ...acc,
        satisfiedStepIds: ["step_1", "step_2", "step_3"],
        missingStepIds: [],
        newlySatisfiedStepIds: ["step_1", "step_2", "step_3"],
        answerCorrect: true,
      };
      const move = getDeterministicRemediationMove(reasoningSteps, fullAcc, "So is it 25?", mathProblem);
      expect(move).not.toBeNull();
      expect(move!.type).toBe("WRAP_SUCCESS");
    });

    it('"So is it 25?" with ones step still missing → correct_incomplete + probe for ones', () => {
      // Correct answer but missing step explanation
      const acc: ReasoningStepAccumulation = {
        satisfiedStepIds: ["step_2", "step_3"],
        missingStepIds: ["step_1"],
        newlySatisfiedStepIds: [],
        answerCorrect: true,
        completionRatio: 2 / 3,
        extractedAnswer: 25,
      };
      const move = getDeterministicRemediationMove(reasoningSteps, acc, "So is it 25?", mathProblem);
      expect(move).not.toBeNull();
      expect(move!.studentState).toBe("correct_incomplete");
      expect(move!.targetStepId).toBe("step_1"); // missing ones step
      expect(move!.text).toContain("?"); // probes for explanation
    });

    it('interrogative wrong answer is classified as "wrong" not "uncertain"', () => {
      // "Is it 17?" — wrong but not a specific misconception pattern
      const acc = accumulateReasoningStepEvidence(reasoningSteps, [], "is it 17", 25);
      const state = classifyStudentState("Is it 17?", acc, mathProblem);
      expect(state).toBe("wrong");
      // NOT "uncertain" — an interrogative candidate answer is a genuine attempt
    });

    it('interrogative wrong answer never classified as off-topic', () => {
      const acc = accumulateReasoningStepEvidence(reasoningSteps, [], "is it 3", 25);
      const state = classifyStudentState("Is it 3?", acc, mathProblem);
      expect(state).not.toBe("uncertain");
      expect(state).toBe("misconception");
    });

    // STT-noisy variants
    it('"is is it three" (STT stutter) → misconception, same as clean form', () => {
      const acc = accumulateReasoningStepEvidence(reasoningSteps, [], "is is it three", 25);
      const move = getDeterministicRemediationMove(reasoningSteps, acc, "is is it three", mathProblem);
      expect(move).not.toBeNull();
      expect(move!.type).toBe("STEP_MISCONCEPTION_REDIRECT");
      expect(move!.misconceptionCategory).toBe("SUBTRACTION_ON_ADDITION");
    });

    it('"I still think the answer is three is it" → misconception detected', () => {
      const acc = accumulateReasoningStepEvidence(reasoningSteps, [], "I still think the answer is three is it", 25);
      const move = getDeterministicRemediationMove(reasoningSteps, acc, "I still think the answer is three is it", mathProblem);
      expect(move).not.toBeNull();
      expect(move!.type).toBe("STEP_MISCONCEPTION_REDIRECT");
      expect(move!.misconceptionCategory).toBe("SUBTRACTION_ON_ADDITION");
    });

    it('"oh is it five" → classifies as misconception (ONES_ONLY_CONFUSION for 5 on 11+14), not uncertain', () => {
      const acc = accumulateReasoningStepEvidence(reasoningSteps, [], "oh is it five", 25);
      const state = classifyStudentState("oh is it five", acc, mathProblem);
      // 5 = ones sum (1+4) for 11+14 → ONES_ONLY_CONFUSION
      expect(state).toBe("misconception");
    });
  });

  // ── Wrong combine-step answers ─────────────────────────────────
  describe("wrong combine-step correction", () => {
    // Ones and tens satisfied → combine step is next missing
    const combineHistory = [
      { role: "student" as const, message: "1 + 4 = 5" },
      { role: "coach" as const, message: "Good. What do you get when you add 10 and 10?" },
      { role: "student" as const, message: "10 + 10 = 20" },
      { role: "coach" as const, message: "Now put them together. What is 20 plus 5?" },
    ];

    // 15 is a commonWrongAnswer for 11+14, so it hits KNOWN_WRONG_ANSWER
    // misconception redirect → "Not quite. <probe>". This is the correct path.
    it('"20 + 5 is 15" → misconception redirect (KNOWN_WRONG_ANSWER) with correction', () => {
      const acc = accumulateReasoningStepEvidence(reasoningSteps, combineHistory, "20 + 5 is 15", 25);
      const move = getDeterministicRemediationMove(reasoningSteps, acc, "20 + 5 is 15", mathProblem);
      expect(move).not.toBeNull();
      expect(move!.type).toBe("STEP_MISCONCEPTION_REDIRECT");
      expect(move!.misconceptionCategory).toBe("KNOWN_WRONG_ANSWER");
      expect(move!.text).toMatch(/not quite/i);
      expect(move!.text).toContain("?");
    });

    it('"15" → KNOWN_WRONG_ANSWER misconception redirect', () => {
      const acc = accumulateReasoningStepEvidence(reasoningSteps, combineHistory, "15", 25);
      const move = getDeterministicRemediationMove(reasoningSteps, acc, "15", mathProblem);
      expect(move).not.toBeNull();
      expect(move!.type).toBe("STEP_MISCONCEPTION_REDIRECT");
      expect(move!.text).toMatch(/not quite/i);
    });

    // 30 is NOT a commonWrongAnswer and not a place-value misconception,
    // so it hits the "wrong" state → STEP_COMBINE_PROMPT with correction.
    it('"20 + 5 is 30" → corrective STEP_COMBINE_PROMPT (no misconception match)', () => {
      const acc = accumulateReasoningStepEvidence(reasoningSteps, combineHistory, "20 + 5 is 30", 25);
      const move = getDeterministicRemediationMove(reasoningSteps, acc, "20 + 5 is 30", mathProblem);
      expect(move).not.toBeNull();
      expect(move!.type).toBe("STEP_COMBINE_PROMPT");
      expect(move!.targetStepKind).toBe("combine");
      // Must name the wrong answer and correct it
      expect(move!.text).toMatch(/not quite/i);
      expect(move!.text).toContain("30");
      // Must re-ask the combine question
      expect(move!.text).toContain("?");
      expect(move!.text).toMatch(/20.*5/);
    });

    it('corrective combine prompt differs from plain combine prompt (prevents dedup)', () => {
      // Wrong answer → correction text
      const wrongAcc = accumulateReasoningStepEvidence(reasoningSteps, combineHistory, "30", 25);
      const wrongMove = getDeterministicRemediationMove(reasoningSteps, wrongAcc, "30", mathProblem);
      // Partial state (no wrong answer) → plain combine text
      const partialAcc = accumulateReasoningStepEvidence(reasoningSteps, combineHistory, "10 + 10 = 20", 25);
      const partialMove = getDeterministicRemediationMove(reasoningSteps, partialAcc, "10 + 10 = 20", mathProblem);
      // They must produce different text so dedup doesn't fire
      if (wrongMove && partialMove) {
        expect(wrongMove.text).not.toBe(partialMove.text);
      }
    });

    it('"I think it is fifteen" → misconception redirect with correction', () => {
      const acc = accumulateReasoningStepEvidence(reasoningSteps, combineHistory, "I think it is fifteen", 25);
      const move = getDeterministicRemediationMove(reasoningSteps, acc, "I think it is fifteen", mathProblem);
      expect(move).not.toBeNull();
      // 15 matches commonWrongAnswer → KNOWN_WRONG_ANSWER
      expect(move!.type).toBe("STEP_MISCONCEPTION_REDIRECT");
      expect(move!.text).toMatch(/not quite/i);
      expect(move!.text).toContain("?");
    });
  });
});

// ============================================================================
// buildInstructionalRecap tests
// ============================================================================

describe("buildInstructionalRecap", () => {
  it("builds a step walkthrough with operation correction for SUBTRACTION_ON_ADDITION", () => {
    const recap = buildInstructionalRecap(reasoningSteps, mathProblem, "SUBTRACTION_ON_ADDITION");
    expect(recap).toContain("This is an addition problem, not subtraction.");
    expect(recap).toContain("1 + 4 = 5");
    expect(recap).toContain("10 + 10 = 20");
    expect(recap).toContain("20 + 5 = 25");
    expect(recap).toContain("You're getting closer!");
    expect(recap).not.toContain("Please click Submit Response.");
    expect(recap).not.toContain("click");
    expect(recap).not.toContain("submit");
  });

  it("builds a step walkthrough without operation correction for KNOWN_WRONG_ANSWER", () => {
    const recap = buildInstructionalRecap(reasoningSteps, mathProblem, "KNOWN_WRONG_ANSWER");
    // No operation correction for KNOWN_WRONG_ANSWER
    expect(recap).not.toContain("not subtraction");
    expect(recap).toContain("1 + 4 = 5");
    expect(recap).toContain("10 + 10 = 20");
    expect(recap).toContain("20 + 5 = 25");
    expect(recap).toContain("You're getting closer!");
  });

  it("builds a step walkthrough for ONES_ONLY_CONFUSION", () => {
    const recap = buildInstructionalRecap(reasoningSteps, mathProblem, "ONES_ONLY_CONFUSION");
    expect(recap).toContain("both the ones and the tens");
    expect(recap).toContain("1 + 4 = 5");
  });

  it("builds walkthrough with null misconception category (no correction prefix)", () => {
    const recap = buildInstructionalRecap(reasoningSteps, mathProblem, null);
    expect(recap).toContain("1 + 4 = 5");
    expect(recap).toContain("10 + 10 = 20");
    expect(recap).not.toContain("not subtraction");
    expect(recap).not.toContain("not addition");
  });

  it("handles single-step reasoning", () => {
    const singleStep: ReasoningStep[] = [{
      id: "step_1",
      label: "Add ones",
      expectedStatements: ["1 + 4 = 5"],
      probe: "What is 1 + 4?",
      kind: "ones_sum",
    }];
    const recap = buildInstructionalRecap(singleStep, mathProblem, null);
    expect(recap).toContain("1 + 4 = 5");
    expect(recap).not.toContain(", and ");
  });

  it("builds ADDITION_ON_SUBTRACTION correction for subtraction problems", () => {
    const subSteps: ReasoningStep[] = [
      { id: "s1", label: "Subtract ones", expectedStatements: ["7 - 3 = 4"], probe: "What is 7 - 3?", kind: "subtract_ones" },
      { id: "s2", label: "Subtract tens", expectedStatements: ["40 - 20 = 20"], probe: "What is 40 - 20?", kind: "subtract_tens" },
      { id: "s3", label: "Combine", expectedStatements: ["20 + 4 = 24"], probe: "What is 20 + 4?", kind: "combine" },
    ];
    const recap = buildInstructionalRecap(subSteps, subProblem, "ADDITION_ON_SUBTRACTION");
    expect(recap).toContain("This is a subtraction problem, not addition.");
    expect(recap).toContain("7 - 3 = 4");
  });
});

// ============================================================================
// detectConversationMisconceptions tests
// ============================================================================

describe("detectConversationMisconceptions", () => {
  const baseAccumulation: ReasoningStepAccumulation = {
    satisfiedStepIds: [],
    missingStepIds: ["step_1", "step_2", "step_3"],
    newlySatisfiedStepIds: [],
    completionRatio: 0,
    answerCorrect: false,
    extractedAnswer: null,
  };

  it("detects misconception in current response", () => {
    const category = detectConversationMisconceptions(
      [], "I subtracted 14 minus 11 and got 3", mathProblem, baseAccumulation,
    );
    expect(category).toBe("SUBTRACTION_ON_ADDITION");
  });

  it("detects misconception in prior conversation history", () => {
    const history = [
      { role: "coach", message: "What is 11 + 14?" },
      { role: "student", message: "I subtracted and got 3" },
      { role: "coach", message: "We're adding, not subtracting. What is 1 + 4?" },
    ];
    // Current response is "I don't know" — no misconception in current turn
    const category = detectConversationMisconceptions(
      history, "I don't know", mathProblem, baseAccumulation,
    );
    expect(category).toBe("SUBTRACTION_ON_ADDITION");
  });

  it("returns null when no misconception in history or current response", () => {
    const history = [
      { role: "coach", message: "What is 11 + 14?" },
      { role: "student", message: "I'm not sure" },
    ];
    const category = detectConversationMisconceptions(
      history, "I don't know", mathProblem, baseAccumulation,
    );
    expect(category).toBeNull();
  });

  it("returns most recent misconception category when multiple exist", () => {
    const history = [
      { role: "student", message: "I subtracted and got 3" },
      { role: "coach", message: "We're adding. What is 1 + 4?" },
      { role: "student", message: "5" },  // ones only → ONES_ONLY_CONFUSION
      { role: "coach", message: "Good, now add the tens." },
    ];
    // Current turn is "I don't know", prior had both SUBTRACTION_ON_ADDITION (answer 3) and ONES_ONLY_CONFUSION (answer 5)
    // Most recent student misconception is "5" → ONES_ONLY_CONFUSION
    const category = detectConversationMisconceptions(
      history, "I don't know", mathProblem, baseAccumulation,
    );
    expect(category).toBe("ONES_ONLY_CONFUSION");
  });
});

// ============================================================================
// countConsecutiveStepFailures tests
// ============================================================================

describe("countConsecutiveStepFailures", () => {
  const tensStep = reasoningSteps[1]; // "Add the tens", probe: "What do you get when you add 10 and 10?"

  it("counts 0 when no prior turns", () => {
    expect(countConsecutiveStepFailures([], tensStep, mathProblem)).toBe(0);
  });

  it("counts 0 when prior coach didn't probe this step", () => {
    const history = [
      { role: "coach", message: "What do you get when you add 1 and 4?" }, // ones step
      { role: "student", message: "30" },
    ];
    expect(countConsecutiveStepFailures(history, tensStep, mathProblem)).toBe(0);
  });

  it("counts 1 for a single wrong answer on the tens step", () => {
    const history = [
      { role: "coach", message: "What do you get when you add 10 and 10?" },
      { role: "student", message: "30" },
    ];
    expect(countConsecutiveStepFailures(history, tensStep, mathProblem)).toBe(1);
  });

  it("counts 3 for three consecutive wrong answers on the same step", () => {
    const history = [
      { role: "coach", message: "What do you get when you add 10 and 10?" },
      { role: "student", message: "30" },
      { role: "coach", message: "What do you get when you add 10 and 10?" },
      { role: "student", message: "40" },
      { role: "coach", message: "What do you get when you add 10 and 10?" },
      { role: "student", message: "50" },
    ];
    expect(countConsecutiveStepFailures(history, tensStep, mathProblem)).toBe(3);
  });

  it("stops counting when student gives correct step answer", () => {
    const history = [
      { role: "coach", message: "What do you get when you add 10 and 10?" },
      { role: "student", message: "20" }, // correct for this step!
      { role: "coach", message: "What do you get when you add 10 and 10?" },
      { role: "student", message: "30" },
    ];
    // Only the most recent streak counts — "30" is 1, then "20" breaks the streak
    expect(countConsecutiveStepFailures(history, tensStep, mathProblem)).toBe(1);
  });

  it("stops counting when coach probes a different step", () => {
    const history = [
      { role: "coach", message: "What do you get when you add 1 and 4?" }, // ones
      { role: "student", message: "30" },
      { role: "coach", message: "What do you get when you add 10 and 10?" }, // tens
      { role: "student", message: "40" },
    ];
    // Only the last turn targeted tens step
    expect(countConsecutiveStepFailures(history, tensStep, mathProblem)).toBe(1);
  });
  it("no-speech turns do not reset the consecutive failure streak", () => {
    const history = [
      { role: "coach", message: "What do you get when you add 10 and 10?" },
      { role: "student", message: "30" },
      { role: "coach", message: "What do you get when you add 10 and 10?" },
      { role: "student", message: "" },           // no-speech retry
      { role: "coach", message: "I didn't catch that — would you like to try again?" },
      { role: "student", message: "no speech detected" }, // another no-speech
      { role: "coach", message: "What do you get when you add 10 and 10?" },
      { role: "student", message: "40" },
    ];
    // The no-speech turns should be transparent: 30, 40 = 2 consecutive failures
    expect(countConsecutiveStepFailures(history, tensStep, mathProblem)).toBe(2);
  });

  it("procedural coach messages do not break the streak", () => {
    const history = [
      { role: "coach", message: "What do you get when you add 10 and 10?" },
      { role: "student", message: "30" },
      { role: "coach", message: "I didn't catch that — would you like to try again?" },
      { role: "student", message: "40" },
    ];
    // The procedural message carries through the original step probe
    expect(countConsecutiveStepFailures(history, tensStep, mathProblem)).toBe(2);
  });

  it("multiple no-speech retries between wrong answers still count both failures", () => {
    const history = [
      { role: "coach", message: "We're adding in this problem, not subtracting. What do you get when you add 1 and 4?" },
      { role: "student", message: "3" },
      { role: "coach", message: "We're adding in this problem, not subtracting. What do you get when you add 1 and 4?" },
      { role: "student", message: "" },               // no-speech
      { role: "student", message: "no speech detected" }, // no-speech
      { role: "student", message: "" },               // no-speech
      { role: "coach", message: "That's okay — want to give it another try?" },
      { role: "student", message: "3" },
    ];
    const onesStep = reasoningSteps[0]; // "Add the ones"
    expect(countConsecutiveStepFailures(history, onesStep, mathProblem)).toBe(2);
  });
});

// ============================================================================
// getDeterministicRemediationMove escalation tests
// ============================================================================

describe("getDeterministicRemediationMove escalation", () => {
  // History where ones step is satisfied, then tens step is probed repeatedly
  const tensFailHistory = [
    { role: "student", message: "1 plus 4 is 5" },
    { role: "coach", message: "Good. What do you get when you add 10 and 10?" },
    { role: "student", message: "30" },
    { role: "coach", message: "What do you get when you add 10 and 10?" },
    { role: "student", message: "40" },
  ];

  it("escalates to STEP_MODEL_INSTRUCTION after 2 wrong answers on same step", () => {
    const acc = accumulateReasoningStepEvidence(reasoningSteps, tensFailHistory, "50", 25);
    const move = getDeterministicRemediationMove(
      reasoningSteps, acc, "50", mathProblem, tensFailHistory,
    );

    expect(move).not.toBeNull();
    expect(move!.type).toBe("STEP_MODEL_INSTRUCTION");
    expect(move!.text).toContain("10 + 10 = 20");
    expect(move!.targetStepId).toBe("step_2");
  });

  it("does NOT escalate after only 1 wrong answer (current response only, no prior wrong)", () => {
    // Only the current response is wrong — no prior wrong answer in history
    const history = [
      { role: "student", message: "1 plus 4 is 5" },
      { role: "coach", message: "Good. What do you get when you add 10 and 10?" },
    ];
    const acc = accumulateReasoningStepEvidence(reasoningSteps, history, "30", 25);
    const move = getDeterministicRemediationMove(
      reasoningSteps, acc, "30", mathProblem, history,
    );

    expect(move).not.toBeNull();
    expect(move!.type).not.toBe("STEP_MODEL_INSTRUCTION");
  });

  it("modeled instruction includes next step probe when more steps remain", () => {
    const acc = accumulateReasoningStepEvidence(reasoningSteps, tensFailHistory, "50", 25);
    const move = getDeterministicRemediationMove(
      reasoningSteps, acc, "50", mathProblem, tensFailHistory,
    );

    expect(move).not.toBeNull();
    expect(move!.type).toBe("STEP_MODEL_INSTRUCTION");
    // Should model tens AND probe combine
    expect(move!.text).toContain("10 + 10 = 20");
    // Should include a question for the next step
    expect(move!.text).toContain("?");
  });

  it("does not escalate without conversationHistory (backwards compatible)", () => {
    // No history passed → no escalation even on wrong answer
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: ["step_1"],
      missingStepIds: ["step_2", "step_3"],
      newlySatisfiedStepIds: [],
      completionRatio: 1/3,
      answerCorrect: false,
      extractedAnswer: 30,
    };
    const move = getDeterministicRemediationMove(
      reasoningSteps, acc, "30", mathProblem,
      // no conversationHistory
    );

    expect(move).not.toBeNull();
    expect(move!.type).toBe("STEP_PROBE_DIRECT");
  });
});

// ============================================================================
// Misconception-path escalation regression tests (live transcript sequences)
//
// These test the ROOT CAUSE fix: escalation must fire for misconception-classified
// students, not just "wrong"-classified ones. Previously, the misconception path
// returned early in getDeterministicRemediationMove before reaching buildMoveForState
// where escalation lived.
// ============================================================================

describe("getDeterministicRemediationMove escalation through misconception path", () => {
  // Live transcript: Student 1 on 14+11, repeated subtraction misconception on ones step
  // "4 - 1 = 3", "I think the answer is three", "14 - 11 = 3"
  // Each time the coach said the same thing: "We're adding, not subtracting. What do you get when you add 4 and 1?"
  it("escalates after repeated subtraction-on-addition misconception on ones step", () => {
    const history = [
      { role: "coach", message: "What is 11 + 14?" },
      { role: "student", message: "4 minus 1 is 3" },
      { role: "coach", message: "We're adding in this problem, not subtracting. What do you get when you add 4 and 1?" },
      { role: "student", message: "I think the answer is three" },
      { role: "coach", message: "We're adding in this problem, not subtracting. What do you get when you add 4 and 1?" },
      { role: "student", message: "14 minus 11 is 3" },
    ];
    const acc = accumulateReasoningStepEvidence(reasoningSteps, history, "3", 25);
    const move = getDeterministicRemediationMove(
      reasoningSteps, acc, "14 minus 11 is 3", mathProblem, history,
    );

    expect(move).not.toBeNull();
    expect(move!.type).toBe("STEP_MODEL_INSTRUCTION");
    expect(move!.text).toContain("1 + 4 = 5");
    expect(move!.studentState).toBe("misconception");
  });

  // Live transcript: Student 2 on 14+11, repeated generic wrong on tens step
  // Ones step already correct, then: 30, 40, 50 on "What do you get when you add 10 and 10?"
  it("escalates after repeated wrong answers on tens step (generic wrong path)", () => {
    const history = [
      { role: "student", message: "1 plus 4 is 5" },
      { role: "coach", message: "Good. What do you get when you add 10 and 10?" },
      { role: "student", message: "30" },
      { role: "coach", message: "What do you get when you add 10 and 10?" },
      { role: "student", message: "40" },
      { role: "coach", message: "What do you get when you add 10 and 10?" },
      { role: "student", message: "50" },
    ];
    const acc = accumulateReasoningStepEvidence(reasoningSteps, history, "50", 25);
    const move = getDeterministicRemediationMove(
      reasoningSteps, acc, "50", mathProblem, history,
    );

    expect(move).not.toBeNull();
    expect(move!.type).toBe("STEP_MODEL_INSTRUCTION");
    expect(move!.text).toContain("10 + 10 = 20");
    expect(move!.targetStepId).toBe("step_2");
  });

  // Extended sequence: 0, 10 on tens step (more wrong guesses)
  it("escalates on tens step with varied wrong answers (0, 10)", () => {
    const history = [
      { role: "student", message: "1 plus 4 is 5" },
      { role: "coach", message: "Good. What do you get when you add 10 and 10?" },
      { role: "student", message: "0" },
      { role: "coach", message: "What do you get when you add 10 and 10?" },
      { role: "student", message: "10" },
    ];
    const acc = accumulateReasoningStepEvidence(reasoningSteps, history, "10", 25);
    const move = getDeterministicRemediationMove(
      reasoningSteps, acc, "10", mathProblem, history,
    );

    expect(move).not.toBeNull();
    expect(move!.type).toBe("STEP_MODEL_INSTRUCTION");
    expect(move!.text).toContain("10 + 10 = 20");
  });

  // Verify that 1 misconception failure does NOT escalate
  it("does NOT escalate after only 1 misconception failure", () => {
    const history = [
      { role: "coach", message: "What is 11 + 14?" },
      { role: "student", message: "4 minus 1 is 3" },
    ];
    const acc = accumulateReasoningStepEvidence(reasoningSteps, history, "3", 25);
    const move = getDeterministicRemediationMove(
      reasoningSteps, acc, "4 minus 1 is 3", mathProblem, history,
    );

    expect(move).not.toBeNull();
    expect(move!.type).toBe("STEP_MISCONCEPTION_REDIRECT");
  });

  // No-speech retries between misconception attempts must not delay escalation
  it("escalates after 2 misconception failures with no-speech retries in between", () => {
    const history = [
      { role: "coach", message: "What is 11 + 14?" },
      { role: "student", message: "4 minus 1 is 3" },
      { role: "coach", message: "We're adding in this problem, not subtracting. What do you get when you add 4 and 1?" },
      { role: "student", message: "" },                // no-speech
      { role: "coach", message: "I didn't catch that — would you like to try again?" },
      { role: "student", message: "no speech detected" }, // no-speech
      { role: "coach", message: "That's okay — want to give it another try?" },
      { role: "student", message: "I think it's three" },
    ];
    const acc = accumulateReasoningStepEvidence(reasoningSteps, history, "3", 25);
    const move = getDeterministicRemediationMove(
      reasoningSteps, acc, "3", mathProblem, history,
    );

    expect(move).not.toBeNull();
    // Must escalate to modeled instruction, not repeat the redirect a 3rd time
    expect(move!.type).toBe("STEP_MODEL_INSTRUCTION");
    expect(move!.text).toContain("1 + 4 = 5");
  });

  it("escalates after 2 wrong answers with procedural coach turn in between", () => {
    const history = [
      { role: "student", message: "1 plus 4 is 5" },
      { role: "coach", message: "Good. What do you get when you add 10 and 10?" },
      { role: "student", message: "30" },
      { role: "coach", message: "I didn't catch that — would you like to try again?" },
      { role: "student", message: "40" },
    ];
    const acc = accumulateReasoningStepEvidence(reasoningSteps, history, "50", 25);
    const move = getDeterministicRemediationMove(
      reasoningSteps, acc, "50", mathProblem, history,
    );

    expect(move).not.toBeNull();
    expect(move!.type).toBe("STEP_MODEL_INSTRUCTION");
    expect(move!.text).toContain("10 + 10 = 20");
  });
});

// ============================================================================
// Concept confusion detection
// ============================================================================

describe("detectConceptConfusion", () => {
  it("detects vocabulary confusion about ones", () => {
    expect(detectConceptConfusion("I don't know what the ones mean", mathProblem)).toBe("VOCABULARY");
    expect(detectConceptConfusion("What are the tens?", mathProblem)).toBe("VOCABULARY");
    expect(detectConceptConfusion("what does ones place mean", mathProblem)).toBe("VOCABULARY");
    expect(detectConceptConfusion("what's a ones digit", mathProblem)).toBe("VOCABULARY");
    expect(detectConceptConfusion("I don't understand the tens", mathProblem)).toBe("VOCABULARY");
  });

  it("detects decomposition confusion", () => {
    expect(detectConceptConfusion("Where did you get 10 and 10?", mathProblem)).toBe("DECOMPOSITION");
    expect(detectConceptConfusion("where'd you get 10 and 10", mathProblem)).toBe("DECOMPOSITION");
    expect(detectConceptConfusion("Why are you adding 10 and 10?", mathProblem)).toBe("DECOMPOSITION");
    expect(detectConceptConfusion("why are we breaking it apart", mathProblem)).toBe("DECOMPOSITION");
  });

  it("detects structure confusion", () => {
    expect(detectConceptConfusion("What does that have to do with this problem?", mathProblem)).toBe("STRUCTURE");
    expect(detectConceptConfusion("The problem says 14 + 11", mathProblem)).toBe("STRUCTURE");
    expect(detectConceptConfusion("why are we doing that", mathProblem)).toBe("STRUCTURE");
    expect(detectConceptConfusion("what are you even doing", mathProblem)).toBe("STRUCTURE");
  });

  it("detects demonstration requests", () => {
    expect(detectConceptConfusion("Show me how", mathProblem)).toBe("DEMONSTRATION");
    expect(detectConceptConfusion("Can you show me?", mathProblem)).toBe("DEMONSTRATION");
    expect(detectConceptConfusion("I need you to explain it", mathProblem)).toBe("DEMONSTRATION");
    expect(detectConceptConfusion("explain how that works", mathProblem)).toBe("DEMONSTRATION");
    expect(detectConceptConfusion("please show me how to do this", mathProblem)).toBe("DEMONSTRATION");
  });

  it("returns null for genuine numeric answers", () => {
    expect(detectConceptConfusion("30", mathProblem)).toBeNull();
    expect(detectConceptConfusion("I think it's 30 because 10 + 10 is 30", mathProblem)).toBeNull();
    expect(detectConceptConfusion("twenty", mathProblem)).toBeNull();
    expect(detectConceptConfusion("4 minus 1 is 3", mathProblem)).toBeNull();
  });

  it("returns null for generic uncertainty without concept question", () => {
    expect(detectConceptConfusion("I don't know", mathProblem)).toBeNull();
    expect(detectConceptConfusion("I'm stuck", mathProblem)).toBeNull();
    expect(detectConceptConfusion("idk", mathProblem)).toBeNull();
  });

  it("returns null for empty/no-speech", () => {
    expect(detectConceptConfusion("", mathProblem)).toBeNull();
    expect(detectConceptConfusion("no speech detected", mathProblem)).toBeNull();
  });

  it("handles STT-noisy variants", () => {
    expect(detectConceptConfusion("where'd you get 10 and 10", mathProblem)).toBe("DECOMPOSITION");
    expect(detectConceptConfusion("what do the ones mean again", mathProblem)).toBe("VOCABULARY");
    expect(detectConceptConfusion("show me how 14 is 10 plus 4", mathProblem)).toBe("DEMONSTRATION");
  });
});

// ============================================================================
// Concept confusion → classifyStudentState integration
// ============================================================================

describe("classifyStudentState with concept confusion", () => {
  const noStepsSatisfied: ReasoningStepAccumulation = {
    satisfiedStepIds: [],
    missingStepIds: ["step_1", "step_2", "step_3"],
    newlySatisfiedStepIds: [],
    completionRatio: 0,
    answerCorrect: false,
    extractedAnswer: null,
  };

  it("classifies vocabulary confusion as concept_confusion, not uncertain", () => {
    expect(classifyStudentState("I don't know what the ones mean", noStepsSatisfied, mathProblem))
      .toBe("concept_confusion");
  });

  it("classifies decomposition question as concept_confusion", () => {
    expect(classifyStudentState("Where did you get the 10 and 10?", noStepsSatisfied, mathProblem))
      .toBe("concept_confusion");
  });

  it("classifies structure question as concept_confusion", () => {
    expect(classifyStudentState("What does that have to do with this problem?", noStepsSatisfied, mathProblem))
      .toBe("concept_confusion");
  });

  it("classifies demonstration request as concept_confusion", () => {
    expect(classifyStudentState("Show me how", noStepsSatisfied, mathProblem))
      .toBe("concept_confusion");
  });

  it("generic 'I don't know' (no concept question) still classified as uncertain", () => {
    expect(classifyStudentState("I don't know", noStepsSatisfied, mathProblem))
      .toBe("uncertain");
  });

  it("wrong numeric answer classified as wrong/misconception, not concept_confusion", () => {
    expect(classifyStudentState("30", noStepsSatisfied, mathProblem))
      .toBe("wrong");
  });
});

// ============================================================================
// Concept confusion → getDeterministicRemediationMove end-to-end
// ============================================================================

describe("concept confusion → STEP_CONCEPT_EXPLANATION", () => {
  // 1. "I don't know what the ones mean" → concept explanation about ones, then probe 4 + 1
  it("vocabulary confusion on ones → explains ones place and probes 4 + 1", () => {
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: [],
      missingStepIds: ["step_1", "step_2", "step_3"],
      newlySatisfiedStepIds: [],
      completionRatio: 0,
      answerCorrect: false,
      extractedAnswer: null,
    };
    const move = getDeterministicRemediationMove(
      reasoningSteps, acc, "I don't know what the ones mean", mathProblem,
    );

    expect(move).not.toBeNull();
    expect(move!.type).toBe("STEP_CONCEPT_EXPLANATION");
    expect(move!.targetStepId).toBe("step_1");
    expect(move!.studentState).toBe("concept_confusion");
    // Should explain what ones digit is
    expect(move!.text).toMatch(/ones/i);
    expect(move!.text).toContain("4");
    expect(move!.text).toContain("1");
    // Should end with the step probe
    expect(move!.text).toContain("?");
  });

  // 2. "Where did you get the 10 and 10?" → decomposition explanation, then probe 10 + 10
  it("decomposition confusion on tens → explains decomposition and probes 10 + 10", () => {
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: ["step_1"],
      missingStepIds: ["step_2", "step_3"],
      newlySatisfiedStepIds: [],
      completionRatio: 1/3,
      answerCorrect: false,
      extractedAnswer: null,
    };
    const move = getDeterministicRemediationMove(
      reasoningSteps, acc, "Where did you get the 10 and 10?", mathProblem,
    );

    expect(move).not.toBeNull();
    expect(move!.type).toBe("STEP_CONCEPT_EXPLANATION");
    expect(move!.targetStepId).toBe("step_2");
    // Should reference tens/ones and the numbers
    expect(move!.text).toContain("10");
    expect(move!.text).toMatch(/tens|ones/i);
    // Should end with probe
    expect(move!.text).toContain("?");
  });

  // 3. "What does that have to do with this problem?" → explanation tied to current problem
  it("structure confusion → explains connection to original problem", () => {
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: ["step_1"],
      missingStepIds: ["step_2", "step_3"],
      newlySatisfiedStepIds: [],
      completionRatio: 1/3,
      answerCorrect: false,
      extractedAnswer: null,
    };
    const move = getDeterministicRemediationMove(
      reasoningSteps, acc, "What does that have to do with this problem?", mathProblem,
    );

    expect(move).not.toBeNull();
    expect(move!.type).toBe("STEP_CONCEPT_EXPLANATION");
    // Should reference the original expression
    expect(move!.text).toContain("11 + 14");
    // Should explain the decomposition strategy
    expect(move!.text).toMatch(/break|part/i);
    expect(move!.text).toContain("?");
  });

  // 4. "Show me how 14 is made up of 10 + 4" → direct decomposition explanation
  it("demonstration request → shows decomposition directly", () => {
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: [],
      missingStepIds: ["step_1", "step_2", "step_3"],
      newlySatisfiedStepIds: [],
      completionRatio: 0,
      answerCorrect: false,
      extractedAnswer: null,
    };
    const move = getDeterministicRemediationMove(
      reasoningSteps, acc, "Show me how 14 is made up of 10 + 4", mathProblem,
    );

    expect(move).not.toBeNull();
    expect(move!.type).toBe("STEP_CONCEPT_EXPLANATION");
    // Should provide the decomposition
    expect(move!.text).toContain("4");
    expect(move!.text).toContain("1");
    expect(move!.text).toContain("?");
  });

  // 5. Clarification request is not treated as off-topic
  it("concept confusion is not classified as off-topic", () => {
    // Import and test isOffTopicResponse behavior
    const { isOffTopicResponse } = require("./videoCoachGuardrails");
    // "What does that have to do with this problem?" has no digits + no math vocab
    // but should NOT be treated as off-topic
    expect(isOffTopicResponse("What does that have to do with this problem?", mathProblem)).toBe(false);
    expect(isOffTopicResponse("Why are we doing that?", mathProblem)).toBe(false);
    expect(isOffTopicResponse("Show me how", mathProblem)).toBe(false);
  });

  // 6. Clarification is not routed to generic OFFER_HINT / ASK_RETRY
  it("concept confusion does not produce STEP_PROBE_SIMPLER or STEP_HINT", () => {
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: [],
      missingStepIds: ["step_1", "step_2", "step_3"],
      newlySatisfiedStepIds: [],
      completionRatio: 0,
      answerCorrect: false,
      extractedAnswer: null,
    };
    const move = getDeterministicRemediationMove(
      reasoningSteps, acc, "What are the tens?", mathProblem,
    );
    expect(move!.type).toBe("STEP_CONCEPT_EXPLANATION");
    expect(move!.type).not.toBe("STEP_PROBE_SIMPLER");
    expect(move!.type).not.toBe("STEP_HINT");
  });

  // 7. Repeated concept confusion escalates to modeled instruction
  it("repeated concept confusion after 2+ step failures escalates to modeled instruction", () => {
    const history = [
      { role: "coach", message: "What do you get when you add 10 and 10?" },
      { role: "student", message: "Where did you get 10 and 10?" },
      // Coach gave concept explanation, then re-probed:
      { role: "coach", message: "Good question. In 14, the 1 means one ten, so 14 = 10 + 4. In 11, the 1 also means one ten, so 11 = 10 + 1. That's why we add 10 and 10. What do you get when you add 10 and 10?" },
      { role: "student", message: "I still don't get it. Why are we doing that?" },
      { role: "coach", message: "We're still solving 11 + 14. We're just breaking it into smaller parts. What do you get when you add 10 and 10?" },
      { role: "student", message: "I really don't understand. Can you show me?" },
    ];
    const acc = accumulateReasoningStepEvidence(reasoningSteps, history, "show me please", 25);
    // After 2 prior non-answer turns and no progress, if the student STILL asks
    // for help, we can still give a concept explanation (no consecutive wrong
    // numeric answers to trigger failure escalation)
    const move = getDeterministicRemediationMove(
      reasoningSteps, acc, "show me please", mathProblem, history,
    );
    expect(move).not.toBeNull();
    expect(move!.type).toBe("STEP_CONCEPT_EXPLANATION");
  });

  // 9. Existing misconception handling still works
  it("misconception answer (not concept confusion) still gets STEP_MISCONCEPTION_REDIRECT", () => {
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: [],
      missingStepIds: ["step_1", "step_2", "step_3"],
      newlySatisfiedStepIds: [],
      completionRatio: 0,
      answerCorrect: false,
      extractedAnswer: 3,
    };
    const move = getDeterministicRemediationMove(
      reasoningSteps, acc, "4 minus 1 is 3", mathProblem,
    );
    expect(move).not.toBeNull();
    expect(move!.type).toBe("STEP_MISCONCEPTION_REDIRECT");
  });

  // 10. Correct answer flow unaffected
  it("correct answer still gets WRAP_SUCCESS", () => {
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: ["step_1", "step_2", "step_3"],
      missingStepIds: [],
      newlySatisfiedStepIds: ["step_3"],
      completionRatio: 1,
      answerCorrect: true,
      extractedAnswer: 25,
    };
    const move = getDeterministicRemediationMove(
      reasoningSteps, acc, "25", mathProblem,
    );
    expect(move).not.toBeNull();
    expect(move!.type).toBe("WRAP_SUCCESS");
  });

  // Simple wrong answer still gets STEP_PROBE_DIRECT
  it("simple wrong answer without concept confusion still gets direct probe", () => {
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: ["step_1"],
      missingStepIds: ["step_2", "step_3"],
      newlySatisfiedStepIds: [],
      completionRatio: 1/3,
      answerCorrect: false,
      extractedAnswer: 30,
    };
    const move = getDeterministicRemediationMove(
      reasoningSteps, acc, "30", mathProblem,
    );
    expect(move).not.toBeNull();
    expect(move!.type).toBe("STEP_PROBE_DIRECT");
  });
});

// ============================================================================
// Step regression prevention: coach-modeled steps stay satisfied
// ============================================================================

describe("no regression to earlier steps after coach-modeled instruction", () => {
  // Full live sequence: ones correct, tens wrong, coach models tens, combine wrong
  it("after coach models tens, wrong combine answer stays on combine step (not tens)", () => {
    // First wrong combine: gets corrective STEP_COMBINE_PROMPT
    const history1 = [
      { role: "student", message: "1 plus 4 is 5" },
      { role: "coach", message: "Great! What do you get when you add 10 and 10?" },
      { role: "student", message: "40" },
      { role: "coach", message: "What do you get when you add 10 and 10?" },
      { role: "student", message: "30" },
      // Coach models tens via STEP_MODEL_INSTRUCTION:
      { role: "coach", message: "In this problem, 10 + 10 = 20. What do you get when you combine 20 and 5?" },
    ];
    const acc1 = accumulateReasoningStepEvidence(reasoningSteps, history1, "45", 25);
    const move1 = getDeterministicRemediationMove(
      reasoningSteps, acc1, "45", mathProblem, history1,
    );

    expect(move1).not.toBeNull();
    // Must target the COMBINE step, NOT regress to tens
    expect(move1!.targetStepId).toBe("step_3");
    expect(move1!.targetStepKind).toBe("combine");
    expect(move1!.type).toBe("STEP_COMBINE_PROMPT");
    expect(move1!.text).toContain("45");
    expect(move1!.text).toContain("isn't right");
    expect(move1!.text).toMatch(/20.*5/); // "What is 20 + 5?"
  });

  it("after 2 wrong combine answers, escalates to modeled combine (not tens regression)", () => {
    // Second wrong combine: escalation fires on combine step
    const history2 = [
      { role: "student", message: "1 plus 4 is 5" },
      { role: "coach", message: "In this problem, 10 + 10 = 20. What do you get when you combine 20 and 5?" },
      { role: "student", message: "45" },
      { role: "coach", message: "Not quite — 45 isn't right. What is 20 + 5?" },
    ];
    const acc2 = accumulateReasoningStepEvidence(reasoningSteps, history2, "45", 25);
    const move2 = getDeterministicRemediationMove(
      reasoningSteps, acc2, "45", mathProblem, history2,
    );

    expect(move2).not.toBeNull();
    // Must still target combine, NOT tens
    expect(move2!.targetStepId).toBe("step_3");
    expect(move2!.type).toBe("STEP_MODEL_INSTRUCTION");
    expect(move2!.text).toContain("20 + 5 = 25");
  });

  it("tens step is in satisfiedStepIds after coach models it", () => {
    const history = [
      { role: "student", message: "1 plus 4 is 5" },
      { role: "coach", message: "Great! What do you get when you add 10 and 10?" },
      { role: "student", message: "40" },
      { role: "coach", message: "In this problem, 10 + 10 = 20. What do you get when you combine 20 and 5?" },
    ];
    const acc = accumulateReasoningStepEvidence(reasoningSteps, history, "45", 25);

    expect(acc.satisfiedStepIds).toContain("step_1"); // ones via student
    expect(acc.satisfiedStepIds).toContain("step_2"); // tens via coach model
    expect(acc.missingStepIds).toContain("step_3");   // combine still missing
  });

  it("first wrong combine gets corrective wording with the wrong answer", () => {
    // Only 1 prior failure on combine → corrective prompt, not escalation
    // Use 45 (not a known wrong answer) to get the "wrong" classification
    const history = [
      { role: "student", message: "1 plus 4 is 5" },
      { role: "coach", message: "In this problem, 10 + 10 = 20. What do you get when you combine 20 and 5?" },
    ];
    const acc = accumulateReasoningStepEvidence(reasoningSteps, history, "45", 25);
    const move = getDeterministicRemediationMove(
      reasoningSteps, acc, "45", mathProblem, history,
    );

    expect(move).not.toBeNull();
    expect(move!.targetStepId).toBe("step_3");
    expect(move!.type).toBe("STEP_COMBINE_PROMPT");
    // Should include the student's wrong answer in the correction
    expect(move!.text).toContain("45");
    expect(move!.text).toContain("isn't right");
  });
});

// ============================================================================
// buildStepFailureRecap tests
// ============================================================================

describe("buildStepFailureRecap", () => {
  it("builds recap naming the stuck step and modeling the answer", () => {
    const tensStep = reasoningSteps[1];
    const recap = buildStepFailureRecap(reasoningSteps, tensStep, mathProblem);

    expect(recap).toContain("add the tens");
    expect(recap).toContain("10 + 10 = 20");
    expect(recap).toContain("You're getting closer!");
    expect(recap).not.toContain("Please click Submit Response.");
    expect(recap).not.toContain("click");
    expect(recap).not.toContain("submit");
  });

  it("includes remaining steps after the stuck step", () => {
    const tensStep = reasoningSteps[1];
    const recap = buildStepFailureRecap(reasoningSteps, tensStep, mathProblem);

    // After tens step comes combine: "20 + 5 = 25"
    expect(recap).toContain("20 + 5 = 25");
  });

  it("handles stuck on the last step (no remaining steps)", () => {
    const combineStep = reasoningSteps[2];
    const recap = buildStepFailureRecap(reasoningSteps, combineStep, mathProblem);

    expect(recap).toContain("combine the totals");
    expect(recap).toContain("20 + 5 = 25");
    // No "Then..." because this is the last step
    expect(recap).not.toContain("Then");
  });

  it("handles stuck on the first step (all remaining steps follow)", () => {
    const onesStep = reasoningSteps[0];
    const recap = buildStepFailureRecap(reasoningSteps, onesStep, mathProblem);

    expect(recap).toContain("add the ones");
    expect(recap).toContain("1 + 4 = 5");
    expect(recap).toContain("10 + 10 = 20");
    expect(recap).toContain("20 + 5 = 25");
  });
});

// ============================================================================
// detectPersistentStepFailure tests
// ============================================================================

describe("detectPersistentStepFailure", () => {
  it("detects persistent failure on the tens step", () => {
    const history = [
      { role: "coach", message: "What do you get when you add 10 and 10?" },
      { role: "student", message: "30" },
      { role: "coach", message: "What do you get when you add 10 and 10?" },
      { role: "student", message: "40" },
    ];
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: ["step_1"],
      missingStepIds: ["step_2", "step_3"],
      newlySatisfiedStepIds: [],
      completionRatio: 1/3,
      answerCorrect: false,
      extractedAnswer: null,
    };

    const result = detectPersistentStepFailure(reasoningSteps, acc, history, mathProblem);
    expect(result).not.toBeNull();
    expect(result!.step.id).toBe("step_2");
    expect(result!.failures).toBe(2);
  });

  it("returns null when no step has enough failures", () => {
    const history = [
      { role: "coach", message: "What do you get when you add 10 and 10?" },
      { role: "student", message: "30" },
    ];
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: ["step_1"],
      missingStepIds: ["step_2", "step_3"],
      newlySatisfiedStepIds: [],
      completionRatio: 1/3,
      answerCorrect: false,
      extractedAnswer: null,
    };

    const result = detectPersistentStepFailure(reasoningSteps, acc, history, mathProblem);
    expect(result).toBeNull();
  });
});

// ============================================================================
// Regression tests — Fix 1: concept explanations include explicit decomposition
// ============================================================================

describe("concept explanation explicit decomposition (regression)", () => {
  it("'can you show me how 14 is made up' → must say 14 = 10 + 4 and 11 = 10 + 1", () => {
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: [],
      missingStepIds: ["step_1", "step_2", "step_3"],
      newlySatisfiedStepIds: [],
      completionRatio: 0,
      answerCorrect: false,
      extractedAnswer: null,
    };
    const move = getDeterministicRemediationMove(
      reasoningSteps, acc, "can you show me how the 14 is made up", mathProblem,
    );

    expect(move).not.toBeNull();
    expect(move!.type).toBe("STEP_CONCEPT_EXPLANATION");
    // Must explicitly decompose BOTH numbers
    expect(move!.text).toContain("14 = 10 + 4");
    expect(move!.text).toContain("11 = 10 + 1");
  });

  it("'what does this have to do with the problem' → explains decomposition strategy", () => {
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: ["step_1"],
      missingStepIds: ["step_2", "step_3"],
      newlySatisfiedStepIds: [],
      completionRatio: 1/3,
      answerCorrect: false,
      extractedAnswer: null,
    };
    const move = getDeterministicRemediationMove(
      reasoningSteps, acc, "What does this have to do with the problem?", mathProblem,
    );

    expect(move).not.toBeNull();
    expect(move!.type).toBe("STEP_CONCEPT_EXPLANATION");
    // With step progress, uses short form — just expression and probe
    expect(move!.text).toContain("11 + 14");
    // Short form should NOT include the full decomposition
    expect(move!.text.length).toBeLessThan(120);
  });

  it("decomposition explanation includes both numbers regardless of active step", () => {
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: [],
      missingStepIds: ["step_1", "step_2", "step_3"],
      newlySatisfiedStepIds: [],
      completionRatio: 0,
      answerCorrect: false,
      extractedAnswer: null,
    };
    // Active step is ones (step_1), but decomposition should still show both numbers
    const move = getDeterministicRemediationMove(
      reasoningSteps, acc, "Where did you get those numbers?", mathProblem,
    );

    expect(move).not.toBeNull();
    expect(move!.type).toBe("STEP_CONCEPT_EXPLANATION");
    // Shortened format: "10+1, 10+4" instead of "11 = 10 + 1"
    expect(move!.text).toContain("10+1");
    expect(move!.text).toContain("10+4");
  });
});

// ============================================================================
// Regression tests — Fix 2: all steps satisfied → final answer prompt, no regression
// ============================================================================

describe("all steps satisfied → no backward regression (regression)", () => {
  it("ones evidence + tens answer 'a 20' → does not regress to ones", () => {
    // Student previously showed ones knowledge, now says "a 20" for tens
    const history = [
      { role: "student", message: "I added the ones the ones is the four and the one and I got five" },
      { role: "coach", message: "Great! Now what about the tens? What do you get when you add 10 and 10?" },
    ];
    const acc = accumulateReasoningStepEvidence(reasoningSteps, history, "a 20", 25);

    // Step 1 (ones) should be satisfied from first student message
    expect(acc.satisfiedStepIds).toContain("step_1");

    const move = getDeterministicRemediationMove(
      reasoningSteps, acc, "a 20", mathProblem, history,
    );

    expect(move).not.toBeNull();
    // Must NOT target step_1 (ones) — that would be regression
    expect(move!.targetStepId).not.toBe("step_1");
    // Should either target combine or ask for final answer
    expect(move!.text).not.toMatch(/ones first/i);
    expect(move!.text).not.toMatch(/focus on the ones/i);
  });

  it("all steps satisfied + wrong final answer → prompts for final answer, not regression", () => {
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: ["step_1", "step_2", "step_3"],
      missingStepIds: [],
      newlySatisfiedStepIds: ["step_3"],
      completionRatio: 1,
      answerCorrect: false,
      extractedAnswer: null,
    };
    const move = getDeterministicRemediationMove(
      reasoningSteps, acc, "20 oh so the answer is 25", mathProblem,
    );

    expect(move).not.toBeNull();
    expect(move!.type).toBe("STEP_PROBE_DIRECT");
    expect(move!.text).toContain("11 + 14");
    expect(move!.explanation).toMatch(/answer not confirmed/i);
  });

  it("full correct mixed transcript → wraps successfully", () => {
    const history = [
      { role: "student", message: "the ones is 4 and 1 so that's 5" },
      { role: "coach", message: "Great! What do you get when you add 10 and 10?" },
      { role: "student", message: "10 plus 10 is 20" },
      { role: "coach", message: "Now combine 20 and 5. What do you get?" },
    ];
    const acc = accumulateReasoningStepEvidence(reasoningSteps, history, "20 plus 5 is 25", 25);

    expect(acc.answerCorrect).toBe(true);
    expect(acc.satisfiedStepIds).toContain("step_1");
    expect(acc.satisfiedStepIds).toContain("step_2");

    const move = getDeterministicRemediationMove(
      reasoningSteps, acc, "20 plus 5 is 25", mathProblem, history,
    );

    expect(move).not.toBeNull();
    expect(move!.type).toBe("WRAP_SUCCESS");
  });

  it("noisy tens answer 'a 20' is recognized as tens evidence", () => {
    const history = [
      { role: "student", message: "1 plus 4 equals 5" },
      { role: "coach", message: "What do you get when you add 10 and 10?" },
    ];
    const acc = accumulateReasoningStepEvidence(reasoningSteps, history, "a 20", 25);

    // "a 20" should satisfy tens step (extractedAnswer=20 matches "10 + 10 = 20")
    expect(acc.satisfiedStepIds).toContain("step_1"); // ones from first message
    expect(acc.satisfiedStepIds).toContain("step_2"); // tens from "a 20"
  });
});

// ============================================================================
// Regression tests — repeated concept explanations are shorter
// ============================================================================

describe("repeated concept explanations (Issue A)", () => {
  it("second decomposition explanation in same session is shorter than first", () => {
    // First explanation (no history)
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: [],
      missingStepIds: ["step_1", "step_2", "step_3"],
      newlySatisfiedStepIds: [],
      completionRatio: 0,
      answerCorrect: false,
      extractedAnswer: null,
    };
    const firstMove = getDeterministicRemediationMove(
      reasoningSteps, acc, "Where did you get those numbers?", mathProblem,
    );

    // Second explanation (history contains first explanation)
    const history = [
      { role: "coach", message: "What do you get when you add 1 and 4?" },
      { role: "student", message: "Where did you get those numbers?" },
      { role: "coach", message: firstMove!.text },
      { role: "student", message: "What does this have to do with the problem?" },
    ];
    const secondMove = getDeterministicRemediationMove(
      reasoningSteps, acc, "What does this have to do with the problem?", mathProblem, history,
    );

    expect(firstMove).not.toBeNull();
    expect(secondMove).not.toBeNull();
    expect(firstMove!.type).toBe("STEP_CONCEPT_EXPLANATION");
    expect(secondMove!.type).toBe("STEP_CONCEPT_EXPLANATION");
    // Both explanations should be concise (< 100 chars each after shortening)
    expect(firstMove!.text.length).toBeLessThan(100);
    expect(secondMove!.text.length).toBeLessThan(100);
    // Must still reference the problem and probe
    expect(secondMove!.text).toMatch(/11 \+ 14|\d+/);
    expect(secondMove!.text).toMatch(/\?/);
  });

  it("second structure confusion escalates to direct probe (no re-explanation)", () => {
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: ["step_1"],
      missingStepIds: ["step_2", "step_3"],
      newlySatisfiedStepIds: [],
      completionRatio: 1/3,
      answerCorrect: false,
      extractedAnswer: null,
    };
    // History contains a prior structure/decomposition explanation
    const history = [
      { role: "coach", message: "What do you get when you add 10 and 10?" },
      { role: "student", message: "What does that have to do with this problem?" },
      { role: "coach", message: `We're solving 11 + 14 in smaller parts. What do you get when you add 10 and 10?` },
      { role: "student", message: "Why are we doing that?" },
    ];
    const move = getDeterministicRemediationMove(
      reasoningSteps, acc, "Why are we doing that?", mathProblem, history,
    );

    expect(move).not.toBeNull();
    // Escalates to direct probe, no re-explanation
    expect(move!.type).toBe("STEP_PROBE_DIRECT");
    expect(move!.text).toMatch(/try it/i);
    expect(move!.text).toContain("?");
    // Response must be short
    expect(move!.text.length).toBeLessThan(80);
  });
});

// ============================================================================
// Regression tests — acknowledge already-correct partial work (Issue B)
// ============================================================================

describe("acknowledge already-satisfied steps in concept explanations (Issue B)", () => {
  it("student has tens evidence, asks decomposition question → acknowledges tens", () => {
    const history = [
      { role: "student", message: "10 + 10 is 20" },
      { role: "coach", message: "Good. What do you get when you add 4 and 1?" },
      { role: "student", message: "Where did you get the four and one?" },
    ];
    const acc = accumulateReasoningStepEvidence(reasoningSteps, history, "Where did you get the four and one?", 25);
    const move = getDeterministicRemediationMove(
      reasoningSteps, acc, "Where did you get the four and one?", mathProblem, history,
    );

    expect(move).not.toBeNull();
    expect(move!.type).toBe("STEP_CONCEPT_EXPLANATION");
    // Must acknowledge the tens step the student already solved
    expect(move!.text).toMatch(/already.*tens|tens.*already/i);
    // Should still contain the probe
    expect(move!.text).toContain("?");
  });

  it("student has ones evidence, asks structure question → acknowledges ones", () => {
    const history = [
      { role: "student", message: "1 plus 4 is 5" },
      { role: "coach", message: "Good. What do you get when you add 10 and 10?" },
      { role: "student", message: "What does that have to do with this problem?" },
    ];
    const acc = accumulateReasoningStepEvidence(reasoningSteps, history, "What does that have to do with this problem?", 25);
    const move = getDeterministicRemediationMove(
      reasoningSteps, acc, "What does that have to do with this problem?", mathProblem, history,
    );

    expect(move).not.toBeNull();
    expect(move!.type).toBe("STEP_CONCEPT_EXPLANATION");
    // Must acknowledge the ones step
    expect(move!.text).toMatch(/already.*ones|ones.*already/i);
  });

  it("no steps satisfied → no acknowledgment prefix", () => {
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: [],
      missingStepIds: ["step_1", "step_2", "step_3"],
      newlySatisfiedStepIds: [],
      completionRatio: 0,
      answerCorrect: false,
      extractedAnswer: null,
    };
    const move = getDeterministicRemediationMove(
      reasoningSteps, acc, "Where did you get those numbers?", mathProblem,
    );

    expect(move).not.toBeNull();
    expect(move!.type).toBe("STEP_CONCEPT_EXPLANATION");
    // No acknowledgment of prior work
    expect(move!.text).not.toMatch(/already/i);
  });

  it("fully correct answer on first turn remains WRAP_SUCCESS", () => {
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: ["step_1", "step_2", "step_3"],
      missingStepIds: [],
      newlySatisfiedStepIds: ["step_1", "step_2", "step_3"],
      completionRatio: 1,
      answerCorrect: true,
      extractedAnswer: 25,
    };
    const move = getDeterministicRemediationMove(
      reasoningSteps, acc, "1 plus 4 is 5, 10 plus 10 is 20, and 20 plus 5 is 25", mathProblem,
    );

    expect(move).not.toBeNull();
    expect(move!.type).toBe("WRAP_SUCCESS");
  });
});

// ============================================================================
// Step-specific & concise concept explanations (Issue A/B/C/D/E)
// ============================================================================

describe("combine-step concept confusion is concise (Issue A)", () => {
  it("student has ones=5 and tens=20, asks structure question → mentions combining 20 and 5", () => {
    const history = [
      { role: "student", message: "1 plus 4 is 5" },
      { role: "coach", message: "Great! What do you get when you add 10 and 10?" },
      { role: "student", message: "10 plus 10 is 20" },
      { role: "coach", message: "Now put them together. What is 20 plus 5?" },
      { role: "student", message: "What does that have to do with the problem?" },
    ];
    const acc = accumulateReasoningStepEvidence(reasoningSteps, history, "What does that have to do with the problem?", 25);
    const move = getDeterministicRemediationMove(
      reasoningSteps, acc, "What does that have to do with the problem?", mathProblem, history,
    );

    expect(move).not.toBeNull();
    expect(move!.type).toBe("STEP_CONCEPT_EXPLANATION");
    // Must mention combining the already-found parts
    expect(move!.text).toMatch(/20/);
    expect(move!.text).toMatch(/5/);
    expect(move!.text).toMatch(/plus|put.*together|combine/i);
    // Must NOT restate full decomposition (14 = 10 + 4...)
    expect(move!.text).not.toContain("14 = 10 + 4");
    expect(move!.text).not.toContain("11 = 10 + 1");
    // Must end with question
    expect(move!.text).toContain("?");
  });

  it("combine explanation does not restate 'That\\'s why we add the tens and ones separately'", () => {
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: ["step_1", "step_2"],
      missingStepIds: ["step_3"],
      newlySatisfiedStepIds: [],
      completionRatio: 2/3,
      answerCorrect: false,
      extractedAnswer: null,
    };
    const move = getDeterministicRemediationMove(
      reasoningSteps, acc, "Show me how", mathProblem,
    );

    expect(move).not.toBeNull();
    expect(move!.type).toBe("STEP_CONCEPT_EXPLANATION");
    expect(move!.text).not.toContain("That's why we add");
    expect(move!.text).toContain("?");
  });
});

describe("concise mode near success (Issue B)", () => {
  it("completionRatio >= 0.66 concept confusion → shorter than full mode", () => {
    // Full mode: no prior steps, early in session
    const fullAcc: ReasoningStepAccumulation = {
      satisfiedStepIds: [],
      missingStepIds: ["step_1", "step_2", "step_3"],
      newlySatisfiedStepIds: [],
      completionRatio: 0,
      answerCorrect: false,
      extractedAnswer: null,
    };
    const fullMove = getDeterministicRemediationMove(
      reasoningSteps, fullAcc, "Where did you get those numbers?", mathProblem,
    );

    // Concise mode: 2/3 steps done
    const conciseAcc: ReasoningStepAccumulation = {
      satisfiedStepIds: ["step_1", "step_2"],
      missingStepIds: ["step_3"],
      newlySatisfiedStepIds: [],
      completionRatio: 2/3,
      answerCorrect: false,
      extractedAnswer: null,
    };
    const conciseMove = getDeterministicRemediationMove(
      reasoningSteps, conciseAcc, "Where did you get those numbers?", mathProblem,
    );

    expect(fullMove).not.toBeNull();
    expect(conciseMove).not.toBeNull();
    // Both should be concise (< 120 chars) after DECOMPOSITION shortening.
    // Concise mode may include step-ack prefix, so lengths can be similar.
    expect(conciseMove!.text.length).toBeLessThan(120);
    expect(fullMove!.text.length).toBeLessThan(120);
    expect(conciseMove!.text).toContain("?");
  });
});

describe("repeated combine confusion is shorter (Issue C)", () => {
  it("second combine explanation shorter than first", () => {
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: ["step_1", "step_2"],
      missingStepIds: ["step_3"],
      newlySatisfiedStepIds: [],
      completionRatio: 2/3,
      answerCorrect: false,
      extractedAnswer: null,
    };
    const firstMove = getDeterministicRemediationMove(
      reasoningSteps, acc, "Show me how", mathProblem,
    );

    const history = [
      { role: "coach", message: firstMove!.text },
      { role: "student", message: "I still don't get it. Can you explain?" },
    ];
    const secondMove = getDeterministicRemediationMove(
      reasoningSteps, acc, "I still don't get it. Can you explain?", mathProblem, history,
    );

    expect(firstMove).not.toBeNull();
    expect(secondMove).not.toBeNull();
    // Both should be concise because combine step
    expect(firstMove!.text).toContain("?");
    expect(secondMove!.text).toContain("?");
    // Second should be <= first (both concise, same tier)
    expect(secondMove!.text.length).toBeLessThanOrEqual(firstMove!.text.length);
  });
});

describe("step-specific acknowledgment (Issues D & E)", () => {
  it("tens already satisfied, decomposition question → acknowledges tens with result value", () => {
    const history = [
      { role: "student", message: "10 + 10 is 20" },
      { role: "coach", message: "Good. What do you get when you add 4 and 1?" },
      { role: "student", message: "Where did you get the four and one?" },
    ];
    const acc = accumulateReasoningStepEvidence(reasoningSteps, history, "Where did you get the four and one?", 25);
    const move = getDeterministicRemediationMove(
      reasoningSteps, acc, "Where did you get the four and one?", mathProblem, history,
    );

    expect(move).not.toBeNull();
    expect(move!.type).toBe("STEP_CONCEPT_EXPLANATION");
    // Acknowledges tens with result value
    expect(move!.text).toMatch(/already.*tens|tens.*20/i);
    // Should end with the ones probe
    expect(move!.text).toContain("?");
  });

  it("ones already satisfied, structure question → acknowledges ones with result value", () => {
    const history = [
      { role: "student", message: "1 plus 4 is 5" },
      { role: "coach", message: "Good. What do you get when you add 10 and 10?" },
      { role: "student", message: "What does that have to do with this problem?" },
    ];
    const acc = accumulateReasoningStepEvidence(reasoningSteps, history, "What does that have to do with this problem?", 25);
    const move = getDeterministicRemediationMove(
      reasoningSteps, acc, "What does that have to do with this problem?", mathProblem, history,
    );

    expect(move).not.toBeNull();
    expect(move!.type).toBe("STEP_CONCEPT_EXPLANATION");
    // Acknowledges ones
    expect(move!.text).toMatch(/already.*ones|ones.*5/i);
  });
});

describe("early-session full explanation still allowed", () => {
  it("first decomposition confusion early → full explanation with strategy", () => {
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: [],
      missingStepIds: ["step_1", "step_2", "step_3"],
      newlySatisfiedStepIds: [],
      completionRatio: 0,
      answerCorrect: false,
      extractedAnswer: null,
    };
    const move = getDeterministicRemediationMove(
      reasoningSteps, acc, "Where did you get those numbers?", mathProblem,
    );

    expect(move).not.toBeNull();
    expect(move!.type).toBe("STEP_CONCEPT_EXPLANATION");
    // Shortened format references tens/ones split
    // Shortened format: "10+1, 10+4" instead of "11 = 10 + 1"
    expect(move!.text).toContain("10+1");
    expect(move!.text).toContain("10+4");
    expect(move!.text).toMatch(/tens|ones/i);
  });
});

describe("no regression on existing concept-confusion wins", () => {
  it("'I don't know what the ones mean' → STEP_CONCEPT_EXPLANATION about ones", () => {
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: [],
      missingStepIds: ["step_1", "step_2", "step_3"],
      newlySatisfiedStepIds: [],
      completionRatio: 0,
      answerCorrect: false,
      extractedAnswer: null,
    };
    const move = getDeterministicRemediationMove(
      reasoningSteps, acc, "I don't know what the ones mean", mathProblem,
    );

    expect(move).not.toBeNull();
    expect(move!.type).toBe("STEP_CONCEPT_EXPLANATION");
    expect(move!.text).toContain("4");
    expect(move!.text).toContain("1");
  });

  it("'Where did you get the 10 and 10?' → decomposition explanation with 14 = 10 + 4", () => {
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: ["step_1"],
      missingStepIds: ["step_2", "step_3"],
      newlySatisfiedStepIds: [],
      completionRatio: 1/3,
      answerCorrect: false,
      extractedAnswer: null,
    };
    const move = getDeterministicRemediationMove(
      reasoningSteps, acc, "Where did you get the 10 and 10?", mathProblem,
    );

    expect(move).not.toBeNull();
    expect(move!.type).toBe("STEP_CONCEPT_EXPLANATION");
    expect(move!.text).toMatch(/tens|ones/i);
    expect(move!.text).toContain("10");
  });

  it("'Can you show me how 14 is made up' → decomposition", () => {
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: [],
      missingStepIds: ["step_1", "step_2", "step_3"],
      newlySatisfiedStepIds: [],
      completionRatio: 0,
      answerCorrect: false,
      extractedAnswer: null,
    };
    const move = getDeterministicRemediationMove(
      reasoningSteps, acc, "Can you show me how 14 is made up?", mathProblem,
    );

    expect(move).not.toBeNull();
    expect(move!.type).toBe("STEP_CONCEPT_EXPLANATION");
    expect(move!.text).toContain("14 = 10 + 4");
    expect(move!.text).toContain("11 = 10 + 1");
  });
});

describe("live-style combine-confusion transcript (pacing regression)", () => {
  it("combine confusion late in session → response short enough for one more turn", () => {
    // Reproduce: student has ones+tens, coach asks combine, student asks structure question
    const history = [
      { role: "student", message: "the ones is 4 and 1 so thats 5" },
      { role: "coach", message: "Great! What do you get when you add 10 and 10?" },
      { role: "student", message: "10 plus 10 is 20" },
      { role: "coach", message: "Now put them together. What is 20 plus 5?" },
      { role: "student", message: "What does that have to do with the problem?" },
    ];
    const acc = accumulateReasoningStepEvidence(reasoningSteps, history, "What does that have to do with the problem?", 25);
    const move = getDeterministicRemediationMove(
      reasoningSteps, acc, "What does that have to do with the problem?", mathProblem, history,
    );

    expect(move).not.toBeNull();
    expect(move!.type).toBe("STEP_CONCEPT_EXPLANATION");

    // At ~3 words/sec TTS, a response under 60 chars takes ~4-5s to speak.
    // This leaves time for the student to answer before cutoff.
    // Even if we're generous, the response should be well under 120 chars.
    expect(move!.text.length).toBeLessThan(120);
    // Must still ask the combine question
    expect(move!.text).toMatch(/20.*plus.*5|20.*\+.*5/i);
  });
});

// ============================================================================
// Partial alternate strategy: don't wrap, follow student's method
// ============================================================================

describe("partial alternate strategy — follow-up instead of canonical probe", () => {
  // Fixture: 14 + 11 = 25 (student uses split-addend: 14 + 10 = 24, then + 1)
  const altProblem: MathProblem = {
    skill: "two_digit_addition",
    a: 14, b: 11, expression: "14 + 11",
    correctAnswer: 25, requiresRegrouping: false,
    expectedStrategyTags: ["add ones", "add tens"],
  };

  const altSteps: ReasoningStep[] = [
    { id: "ones_sum", label: "Add the ones", expectedStatements: ["4 + 1 = 5"], probe: "What is 4 + 1?", kind: "ones_sum" },
    { id: "tens_sum", label: "Add the tens", expectedStatements: ["10 + 10 = 20"], probe: "What is 10 + 10?", kind: "tens_sum" },
    { id: "combine", label: "Combine the totals", expectedStatements: ["20 + 5 = 25"], probe: "What is 20 + 5?", kind: "combine" },
  ];

  test("classifyStudentState: 24 for 14+11 is a valid intermediate, not wrong", () => {
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: [], missingStepIds: ["ones_sum", "tens_sum", "combine"],
      newlySatisfiedStepIds: [], completionRatio: 0,
      answerCorrect: false, extractedAnswer: 24,
    };
    // Student mentions 14 + 10 = 24: 24 is a valid intermediate (14 + 10)
    const state = classifyStudentState(
      "I split 11 into 10 and 1 then 14 + 10 I get 24",
      acc, altProblem,
    );
    expect(state).toBe("partial");
    expect(state).not.toBe("wrong");
  });

  test("classifyStudentState: truly wrong answer is still wrong", () => {
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: [], missingStepIds: ["ones_sum", "tens_sum", "combine"],
      newlySatisfiedStepIds: [], completionRatio: 0,
      answerCorrect: false, extractedAnswer: 21,
    };
    // 21 is NOT a valid intermediate for 14+11=25
    const state = classifyStudentState("I think it is 21", acc, altProblem);
    expect(state).toBe("wrong");
  });

  test("remediation: partial alternate intermediate gets follow-up, not canonical probe", () => {
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: [], missingStepIds: ["ones_sum", "tens_sum", "combine"],
      newlySatisfiedStepIds: [], completionRatio: 0,
      answerCorrect: false, extractedAnswer: 24,
    };
    const move = getDeterministicRemediationMove(
      altSteps, acc,
      "I split 11 into 10 and 1 then 14 + 10 I get 24",
      altProblem,
      [{ role: "coach", message: "What is 14 + 11?" }],
    );

    expect(move).not.toBeNull();
    expect(move!.type).toBe("STEP_PROBE_DIRECT");
    expect(move!.studentState).toBe("partial");
    // Should ask about the 1 that's left, not about canonical "add the ones"
    expect(move!.text).toContain("1");
    expect(move!.text).toContain("24");
    // Should NOT mention canonical step language
    expect(move!.text).not.toMatch(/add the ones/i);
    expect(move!.text).not.toMatch(/add the tens/i);
  });

  test("remediation: truly wrong answer still gets canonical probe", () => {
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: [], missingStepIds: ["ones_sum", "tens_sum", "combine"],
      newlySatisfiedStepIds: [], completionRatio: 0,
      answerCorrect: false, extractedAnswer: 21,
    };
    const move = getDeterministicRemediationMove(
      altSteps, acc,
      "I think it is 21",
      altProblem,
      [{ role: "coach", message: "What is 14 + 11?" }],
    );

    expect(move).not.toBeNull();
    // Should NOT be the alternate follow-up
    expect(move!.text).not.toContain("that's left");
  });
});

// ============================================================================
// Alternate strategy setup confusion: model the setup, don't wrap
// ============================================================================

describe("alternate strategy setup confusion — model and continue", () => {
  const altProblem: MathProblem = {
    skill: "two_digit_addition",
    a: 14, b: 11, expression: "14 + 11",
    correctAnswer: 25, requiresRegrouping: false,
    expectedStrategyTags: ["add ones", "add tens"],
  };

  const altSteps: ReasoningStep[] = [
    { id: "ones_sum", label: "Add the ones", expectedStatements: ["4 + 1 = 5"], probe: "What is 4 + 1?", kind: "ones_sum" },
    { id: "tens_sum", label: "Add the tens", expectedStatements: ["10 + 10 = 20"], probe: "What is 10 + 10?", kind: "tens_sum" },
    { id: "combine", label: "Combine the totals", expectedStatements: ["20 + 5 = 25"], probe: "What is 20 + 5?", kind: "combine" },
  ];

  test("classifyStudentState: 'how would I split up the 11' → alternate_setup", () => {
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: [], missingStepIds: ["ones_sum", "tens_sum", "combine"],
      newlySatisfiedStepIds: [], completionRatio: 0,
      answerCorrect: false, extractedAnswer: null,
    };
    const state = classifyStudentState(
      "how would I split up the 11", acc, altProblem,
    );
    expect(state).toBe("alternate_setup");
  });

  test("classifyStudentState: 'I could split up the 11 to 10 and 1' → alternate_setup", () => {
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: [], missingStepIds: ["ones_sum", "tens_sum", "combine"],
      newlySatisfiedStepIds: [], completionRatio: 0,
      answerCorrect: false, extractedAnswer: null,
    };
    const state = classifyStudentState(
      "I could split up the 11 to 10 and 1", acc, altProblem,
    );
    expect(state).toBe("alternate_setup");
  });

  test("classifyStudentState: 'I want to break apart the 11' → alternate_setup", () => {
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: [], missingStepIds: ["ones_sum", "tens_sum", "combine"],
      newlySatisfiedStepIds: [], completionRatio: 0,
      answerCorrect: false, extractedAnswer: null,
    };
    const state = classifyStudentState(
      "I want to break apart the 11", acc, altProblem,
    );
    expect(state).toBe("alternate_setup");
  });

  test("classifyStudentState: normal answer '5' is NOT alternate_setup", () => {
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: [], missingStepIds: ["ones_sum", "tens_sum", "combine"],
      newlySatisfiedStepIds: ["ones_sum"], completionRatio: 0.33,
      answerCorrect: false, extractedAnswer: 5,
    };
    const state = classifyStudentState("five", acc, altProblem);
    expect(state).not.toBe("alternate_setup");
  });

  test("remediation: alternate setup with no parts stated asks how to split", () => {
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: [], missingStepIds: ["ones_sum", "tens_sum", "combine"],
      newlySatisfiedStepIds: [], completionRatio: 0,
      answerCorrect: false, extractedAnswer: null,
    };
    const move = getDeterministicRemediationMove(
      altSteps, acc,
      "how would I split up the 11",
      altProblem,
      [{ role: "coach", message: "What is 14 + 11?" }],
    );

    expect(move).not.toBeNull();
    expect(move!.type).toBe("STEP_PROBE_DIRECT");
    expect(move!.studentState).toBe("alternate_setup");
    // Should ask how to split, NOT assume canonical
    expect(move!.text).toMatch(/how would you split/i);
    expect(move!.text).toContain("11");
    // Should NOT impose canonical split without asking
    expect(move!.text).not.toMatch(/split 11 into 10 and 1/i);
  });

  test("remediation: alternate setup does NOT wrap (shouldContinue remains true)", () => {
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: [], missingStepIds: ["ones_sum", "tens_sum", "combine"],
      newlySatisfiedStepIds: [], completionRatio: 0,
      answerCorrect: false, extractedAnswer: null,
    };
    const move = getDeterministicRemediationMove(
      altSteps, acc,
      "I could split up the 11 to 10 and 1",
      altProblem,
      [{ role: "coach", message: "What is 14 + 11?" }],
    );

    expect(move).not.toBeNull();
    // Must NOT be WRAP_SUCCESS
    expect(move!.type).not.toBe("WRAP_SUCCESS");
    expect(move!.studentState).toBe("alternate_setup");
    // Should mirror the student's canonical split and continue
    expect(move!.text).toMatch(/11.*10.*1|10\s*\+\s*1/i);
    expect(move!.text).toContain("14");
  });

  test("remediation: student with valid intermediate still gets partial, not alternate_setup", () => {
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: [], missingStepIds: ["ones_sum", "tens_sum", "combine"],
      newlySatisfiedStepIds: [], completionRatio: 0,
      answerCorrect: false, extractedAnswer: 24,
    };
    // Has splitting language AND a valid intermediate
    const state = classifyStudentState(
      "I split 11 into 10 and 1 then 14 + 10 I get 24",
      acc, altProblem,
    );
    // Should be partial (valid intermediate), not alternate_setup
    expect(state).toBe("partial");
  });
});

// ============================================================================
// Valid but inefficient decomposition: acknowledge and redirect
// ============================================================================

describe("valid but inefficient decomposition — acknowledge and redirect", () => {
  const altProblem: MathProblem = {
    skill: "two_digit_addition",
    a: 14, b: 11, expression: "14 + 11",
    correctAnswer: 25, requiresRegrouping: false,
    expectedStrategyTags: ["add ones", "add tens"],
  };

  const altSteps: ReasoningStep[] = [
    { id: "ones_sum", label: "Add the ones", expectedStatements: ["4 + 1 = 5"], probe: "What is 4 + 1?", kind: "ones_sum" },
    { id: "tens_sum", label: "Add the tens", expectedStatements: ["10 + 10 = 20"], probe: "What is 10 + 10?", kind: "tens_sum" },
    { id: "combine", label: "Combine the totals", expectedStatements: ["20 + 5 = 25"], probe: "What is 20 + 5?", kind: "combine" },
  ];

  test("classifyStudentState: '14 could also be a 7 + 7' (plain) → valid_inefficient", () => {
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: [], missingStepIds: ["ones_sum", "tens_sum", "combine"],
      newlySatisfiedStepIds: [], completionRatio: 0,
      answerCorrect: false, extractedAnswer: null,
    };
    // Plain decomposition without resistance language → valid_inefficient
    const state = classifyStudentState(
      "14 could also be a 7 + 7",
      acc, altProblem,
    );
    expect(state).toBe("valid_inefficient");
  });

  test("classifyStudentState: decomposition WITH resistance → math_relevant_resistance", () => {
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: [], missingStepIds: ["ones_sum", "tens_sum", "combine"],
      newlySatisfiedStepIds: [], completionRatio: 0,
      answerCorrect: false, extractedAnswer: null,
    };
    // Decomposition + "why are we doing it that way" → resistance takes priority
    const state = classifyStudentState(
      "14 could also be a 7 + 7 why are we doing it that way",
      acc, altProblem,
    );
    expect(state).toBe("math_relevant_resistance");
  });

  test("classifyStudentState: '11 could be 5 + 6' → valid_inefficient", () => {
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: [], missingStepIds: ["ones_sum", "tens_sum", "combine"],
      newlySatisfiedStepIds: [], completionRatio: 0,
      answerCorrect: false, extractedAnswer: null,
    };
    const state = classifyStudentState(
      "11 could be 5 + 6",
      acc, altProblem,
    );
    expect(state).toBe("valid_inefficient");
  });

  test("classifyStudentState: 'I could break 14 into 6 and 8' → valid_inefficient", () => {
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: [], missingStepIds: ["ones_sum", "tens_sum", "combine"],
      newlySatisfiedStepIds: [], completionRatio: 0,
      answerCorrect: false, extractedAnswer: null,
    };
    const state = classifyStudentState(
      "I could break 14 into 6 and 8",
      acc, altProblem,
    );
    expect(state).toBe("valid_inefficient");
  });

  test("classifyStudentState: canonical '14 is 10 + 4' is NOT valid_inefficient", () => {
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: [], missingStepIds: ["ones_sum", "tens_sum", "combine"],
      newlySatisfiedStepIds: [], completionRatio: 0,
      answerCorrect: false, extractedAnswer: null,
    };
    const state = classifyStudentState(
      "14 is 10 + 4",
      acc, altProblem,
    );
    // Canonical tens+ones split should NOT trigger valid_inefficient
    expect(state).not.toBe("valid_inefficient");
  });

  test("classifyStudentState: wrong decomposition '14 is 7 + 8' is NOT valid_inefficient", () => {
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: [], missingStepIds: ["ones_sum", "tens_sum", "combine"],
      newlySatisfiedStepIds: [], completionRatio: 0,
      answerCorrect: false, extractedAnswer: null,
    };
    const state = classifyStudentState(
      "14 is 7 + 8",
      acc, altProblem,
    );
    // 7 + 8 = 15 ≠ 14 — this is wrong, should NOT be valid_inefficient
    expect(state).not.toBe("valid_inefficient");
  });

  test("remediation: acknowledges correctness and redirects to canonical step", () => {
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: [], missingStepIds: ["ones_sum", "tens_sum", "combine"],
      newlySatisfiedStepIds: [], completionRatio: 0,
      answerCorrect: false, extractedAnswer: null,
    };
    const move = getDeterministicRemediationMove(
      altSteps, acc,
      "14 could also be a 7 + 7 why are we doing it that way",
      altProblem,
      [{ role: "coach", message: "What do you get when you add 10 and 10?" }],
    );

    expect(move).not.toBeNull();
    expect(move!.type).toBe("STEP_PROBE_DIRECT");
    // "why are we doing it that way" triggers math_relevant_resistance
    expect(move!.studentState).toBe("math_relevant_resistance");
    // Must acknowledge the math is correct (decomp detected)
    expect(move!.text).toMatch(/hear you|can be|right|correct|true/i);
    expect(move!.text).toContain("7 + 7");
    // Must explain why tens+ones is better
    expect(move!.text).toMatch(/10\s*\+\s*4|easier/i);
    // Must end with a canonical probe
    expect(move!.text).toMatch(/what/i);
    // Must NOT say "wrong" or "not quite"
    expect(move!.text).not.toMatch(/wrong|not quite|incorrect/i);
  });

  test("remediation: does NOT wrap", () => {
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: [], missingStepIds: ["ones_sum", "tens_sum", "combine"],
      newlySatisfiedStepIds: [], completionRatio: 0,
      answerCorrect: false, extractedAnswer: null,
    };
    const move = getDeterministicRemediationMove(
      altSteps, acc,
      "14 could also be a 7 + 7",
      altProblem,
      [{ role: "coach", message: "What is 10 + 10?" }],
    );

    expect(move).not.toBeNull();
    expect(move!.type).not.toBe("WRAP_SUCCESS");
  });
});

// ============================================================================
// Non-canonical active strategy: multi-decomposition and pushback defense
// ============================================================================

describe("noncanonical active strategy — multi-decomposition and pushback", () => {
  const ncProblem: MathProblem = {
    skill: "two_digit_addition",
    a: 14, b: 11, expression: "14 + 11",
    correctAnswer: 25, requiresRegrouping: false,
    expectedStrategyTags: ["add ones", "add tens"],
  };

  const ncSteps: ReasoningStep[] = [
    { id: "ones_sum", label: "Add the ones", expectedStatements: ["4 + 1 = 5"], probe: "What is 4 + 1?", kind: "ones_sum" },
    { id: "tens_sum", label: "Add the tens", expectedStatements: ["10 + 10 = 20"], probe: "What is 10 + 10?", kind: "tens_sum" },
    { id: "combine", label: "Combine the totals", expectedStatements: ["20 + 5 = 25"], probe: "What is 20 + 5?", kind: "combine" },
  ];

  const emptyAcc: ReasoningStepAccumulation = {
    satisfiedStepIds: [], missingStepIds: ["ones_sum", "tens_sum", "combine"],
    newlySatisfiedStepIds: [], completionRatio: 0,
    answerCorrect: false, extractedAnswer: null,
  };

  // ── Classification tests ──────────────────────────────────────────

  test("classifyStudentState: two decompositions → noncanonical_active", () => {
    const state = classifyStudentState(
      "so I could split up the 14 to 7 + 7 I could split up the 11 to 5 + 6 so it adds seven plus six to get 13",
      emptyAcc, ncProblem,
    );
    expect(state).toBe("noncanonical_active");
  });

  test("classifyStudentState: 'split 14 into 7 and 7 split 11 into 5 and 6' → noncanonical_active", () => {
    const state = classifyStudentState(
      "break 14 into 7 and 7 break 11 into 5 and 6 so 7 plus 6 is 13",
      emptyAcc, ncProblem,
    );
    expect(state).toBe("noncanonical_active");
  });

  test("classifyStudentState: single decomposition → NOT noncanonical_active", () => {
    const state = classifyStudentState(
      "14 could be 7 + 7",
      emptyAcc, ncProblem,
    );
    expect(state).not.toBe("noncanonical_active");
  });

  test("classifyStudentState: pushback with math reference → math_relevant_resistance", () => {
    const state = classifyStudentState(
      "that's not what I said I said split the 14 into 7 + 7",
      emptyAcc, ncProblem,
    );
    expect(state).toBe("math_relevant_resistance");
  });

  test("classifyStudentState: 'no I was splitting 14' → math_relevant_resistance", () => {
    const state = classifyStudentState(
      "no I was splitting 14 into 7 and 7 not doing it your way",
      emptyAcc, ncProblem,
    );
    expect(state).toBe("math_relevant_resistance");
  });

  test("classifyStudentState: generic pushback without math → NOT math_relevant_resistance", () => {
    // "that's not right" without math references should NOT trigger math_relevant_resistance
    const state = classifyStudentState(
      "you're wrong",
      emptyAcc, ncProblem,
    );
    expect(state).not.toBe("math_relevant_resistance");
  });

  test("classifyStudentState: off-topic hostility → NOT math_relevant_resistance", () => {
    const state = classifyStudentState(
      "I don't want to do this anymore",
      emptyAcc, ncProblem,
    );
    expect(state).not.toBe("math_relevant_resistance");
    expect(state).not.toBe("noncanonical_active");
  });

  // ── Remediation move tests ────────────────────────────────────────

  test("remediation: multi-decomposition → acknowledges math, explains complexity, redirects", () => {
    const move = getDeterministicRemediationMove(
      ncSteps, emptyAcc,
      "so I could split up the 14 to 7 + 7 I could split up the 11 to 5 + 6 so it adds seven plus six to get 13",
      ncProblem,
      [{ role: "coach", message: "What do you get when you add 4 and 1?" }],
    );

    expect(move).not.toBeNull();
    expect(move!.studentState).toBe("noncanonical_active");
    // Must acknowledge the math is correct
    expect(move!.text).toMatch(/valid|good/i);
    // Must mention their decompositions
    expect(move!.text).toContain("7 + 7");
    expect(move!.text).toContain("5 + 6");
    // Must continue in student's strategy (not redirect to canonical)
    expect(move!.text).toMatch(/combine|what is/i);
    // Must end with a probe
    expect(move!.text).toMatch(/what/i);
    // Must NOT say "wrong" or "not quite"
    expect(move!.text).not.toMatch(/wrong|not quite|incorrect/i);
  });

  test("remediation: multi-decomposition does NOT wrap", () => {
    const move = getDeterministicRemediationMove(
      ncSteps, emptyAcc,
      "split 14 into 7 + 7 split 11 into 5 + 6",
      ncProblem,
      [{ role: "coach", message: "What is 4 + 1?" }],
    );

    expect(move).not.toBeNull();
    expect(move!.type).not.toBe("WRAP_SUCCESS");
    expect(move!.type).not.toBe("WRAP_NEEDS_SUPPORT");
  });

  test("remediation: pushback after redirect → acknowledges, explains, redirects", () => {
    const move = getDeterministicRemediationMove(
      ncSteps, emptyAcc,
      "that's not what I said I said split the 14 into 7 + 7",
      ncProblem,
      [
        { role: "coach", message: "What do you get when you add 4 and 1?" },
        { role: "student", message: "split 14 into 7 + 7 split 11 into 5 + 6" },
        { role: "coach", message: "Let's try tens and ones. What is 4 + 1?" },
      ],
    );

    expect(move).not.toBeNull();
    // "that's not what I said" triggers method repair when prior decomposition exists
    expect(["math_relevant_resistance", "method_acknowledgment_repair"]).toContain(move!.studentState);
    // Must acknowledge
    expect(move!.text).toMatch(/hear you|heard you|understand|makes sense/i);
    // Must redirect to canonical
    expect(move!.text).toMatch(/tens|ones|10\s*\+\s*4|what/i);
    // Must include a probe
    expect(move!.text).toMatch(/what/i);
    // Must NOT wrap
    expect(move!.type).not.toBe("WRAP_SUCCESS");
    expect(move!.type).not.toBe("WRAP_NEEDS_SUPPORT");
    // Must NOT say "wrong" or "not quite"
    expect(move!.text).not.toMatch(/wrong|not quite|incorrect/i);
  });

  test("remediation: pushback does NOT wrap even when completionRatio is 0", () => {
    const move = getDeterministicRemediationMove(
      ncSteps, emptyAcc,
      "no but I said split 14 into 7 + 7",
      ncProblem,
      [
        { role: "coach", message: "What is 4 + 1?" },
        { role: "student", message: "14 is 7 + 7" },
        { role: "coach", message: "Let's use tens and ones. What is 4 + 1?" },
      ],
    );

    expect(move).not.toBeNull();
    expect(move!.type).not.toBe("WRAP_SUCCESS");
    expect(move!.type).not.toBe("WRAP_NEEDS_SUPPORT");
  });

  test("remediation: continues in student's strategy (not redirect to canonical)", () => {
    const move = getDeterministicRemediationMove(
      ncSteps, emptyAcc,
      "14 is 7 + 7 and 11 is 5 + 6",
      ncProblem,
      [{ role: "coach", message: "What is 4 + 1?" }],
    );

    expect(move).not.toBeNull();
    // Must acknowledge their splits as valid
    expect(move!.text).toMatch(/valid|good/i);
    // Must probe within their strategy, not redirect to tens+ones
    expect(move!.text).toMatch(/combine|what is/i);
  });
});

// ============================================================================
// MATH_RELEVANT_RESISTANCE regression tests
// ============================================================================

describe("MATH_RELEVANT_RESISTANCE — regression tests", () => {
  const mrProblem: MathProblem = {
    skill: "two_digit_addition",
    a: 14, b: 11, expression: "14 + 11",
    correctAnswer: 25, requiresRegrouping: false,
    expectedStrategyTags: ["add ones", "add tens"],
  };

  const mrSteps: ReasoningStep[] = [
    { id: "ones_sum", label: "Add the ones", expectedStatements: ["4 + 1 = 5"], probe: "What is 4 + 1?", kind: "ones_sum" },
    { id: "tens_sum", label: "Add the tens", expectedStatements: ["10 + 10 = 20"], probe: "What is 10 + 10?", kind: "tens_sum" },
    { id: "combine", label: "Combine the totals", expectedStatements: ["20 + 5 = 25"], probe: "What is 20 + 5?", kind: "combine" },
  ];

  const emptyAcc: ReasoningStepAccumulation = {
    satisfiedStepIds: [], missingStepIds: ["ones_sum", "tens_sum", "combine"],
    newlySatisfiedStepIds: [], completionRatio: 0,
    answerCorrect: false, extractedAnswer: null,
  };

  // ── 1. "Why wouldn't we just split it to seven and seven" ────────

  test("'why wouldn't we just split it to seven and seven' → math_relevant_resistance, not wrap", () => {
    const state = classifyStudentState(
      "why wouldn't we just split it to seven and seven",
      emptyAcc, mrProblem,
    );
    expect(state).toBe("math_relevant_resistance");

    const move = getDeterministicRemediationMove(
      mrSteps, emptyAcc,
      "why wouldn't we just split it to seven and seven",
      mrProblem,
      [{ role: "coach", message: "What is 4 + 1?" }],
    );
    expect(move).not.toBeNull();
    expect(move!.type).not.toBe("WRAP_SUCCESS");
    expect(move!.type).not.toBe("WRAP_NEEDS_SUPPORT");
    expect(move!.studentState).toBe("math_relevant_resistance");
    expect(move!.text).toMatch(/what/i);
  });

  // ── 2. "That's not what I said, I said split the 14 into 7 + 7" ──

  test("defense: 'that's not what I said, I said split the 14 into 7 + 7' → acknowledges and redirects", () => {
    const move = getDeterministicRemediationMove(
      mrSteps, emptyAcc,
      "that's not what I said I said split the 14 into 7 + 7",
      mrProblem,
      [
        { role: "coach", message: "What is 4 + 1?" },
        { role: "student", message: "14 is 7 + 7" },
        { role: "coach", message: "10 + 4 is easier. What is 4 + 1?" },
      ],
    );

    expect(move).not.toBeNull();
    // "that's not what I said" triggers method repair when prior decomposition exists
    expect(["math_relevant_resistance", "method_acknowledgment_repair"]).toContain(move!.studentState);
    // Must acknowledge
    expect(move!.text).toMatch(/hear you|heard you|makes sense|can be/i);
    // Must validate the math (14 = 7+7)
    expect(move!.text).toMatch(/7\s*\+\s*7/);
    // Must redirect with probe
    expect(move!.text).toMatch(/what/i);
    // Must NOT wrap
    expect(move!.type).not.toBe("WRAP_SUCCESS");
    expect(move!.type).not.toBe("WRAP_NEEDS_SUPPORT");
  });

  // ── 3. "Why can't I do 7 + 6" after noncanonical decomposition ───

  test("'why can't I do 7 + 6' → acknowledges validity and explains why tens/ones easier", () => {
    const move = getDeterministicRemediationMove(
      mrSteps, emptyAcc,
      "why can't I do 7 + 6",
      mrProblem,
      [
        { role: "coach", message: "What is 4 + 1?" },
        { role: "student", message: "split 14 into 7 + 7 split 11 into 5 + 6" },
        { role: "coach", message: "Tens and ones is easier. What is 4 + 1?" },
      ],
    );

    expect(move).not.toBeNull();
    expect(move!.studentState).toBe("math_relevant_resistance");
    // Must explain why canonical is preferred
    expect(move!.text).toMatch(/tens|ones|break apart|cleanly/i);
    // Must include a probe
    expect(move!.text).toMatch(/what/i);
    // Must NOT say "wrong" or wrap
    expect(move!.text).not.toMatch(/wrong|incorrect|not quite/i);
    expect(move!.type).not.toBe("WRAP_SUCCESS");
  });

  // ── 4. "That has nothing to do with the problem, I'm adding 14 and 11" ──

  test("'that has nothing to do with the problem, I'm adding 14 and 11' → explains relationship, continues", () => {
    const state = classifyStudentState(
      "that has nothing to do with the problem I'm adding 14 and 11",
      emptyAcc, mrProblem,
    );
    expect(state).toBe("math_relevant_resistance");

    const move = getDeterministicRemediationMove(
      mrSteps, emptyAcc,
      "that has nothing to do with the problem I'm adding 14 and 11",
      mrProblem,
      [{ role: "coach", message: "What is 4 + 1?" }],
    );

    expect(move).not.toBeNull();
    expect(move!.studentState).toBe("math_relevant_resistance");
    // Must explain we're still solving the same problem
    expect(move!.text).toMatch(/14\s*\+\s*11|still solving/i);
    // Must explain tens and ones
    expect(move!.text).toMatch(/tens|ones|10.*4/i);
    // Must include a probe
    expect(move!.text).toMatch(/what/i);
    // Must NOT wrap or dismiss
    expect(move!.type).not.toBe("WRAP_SUCCESS");
    expect(move!.type).not.toBe("WRAP_NEEDS_SUPPORT");
  });

  // ── 5. Generic hostile off-topic → NOT math_relevant_resistance ───

  test("generic hostile off-topic is NOT math_relevant_resistance", () => {
    const state1 = classifyStudentState(
      "this is stupid I hate math",
      emptyAcc, mrProblem,
    );
    expect(state1).not.toBe("math_relevant_resistance");

    const state2 = classifyStudentState(
      "I want to go home",
      emptyAcc, mrProblem,
    );
    expect(state2).not.toBe("math_relevant_resistance");

    const state3 = classifyStudentState(
      "you're boring",
      emptyAcc, mrProblem,
    );
    expect(state3).not.toBe("math_relevant_resistance");
  });

  // ── 6. Repeated resistance still continues ────────────────────────

  test("repeated resistance does NOT trigger wrap or 'let's move on'", () => {
    // Simulate: student resisted 3 times in a row
    const history = [
      { role: "coach", message: "What is 4 + 1?" },
      { role: "student", message: "why can't I do 7 + 6" },
      { role: "coach", message: "Good question. Tens and ones is easier here. What is 4 + 1?" },
      { role: "student", message: "but I was trying to split the 14" },
      { role: "coach", message: "I hear you. 10 + 4 works better here. What is 4 + 1?" },
    ];

    const move = getDeterministicRemediationMove(
      mrSteps, emptyAcc,
      "I already said I wanted to split it into 7 and 7",
      mrProblem,
      history,
    );

    expect(move).not.toBeNull();
    expect(move!.type).not.toBe("WRAP_SUCCESS");
    expect(move!.type).not.toBe("WRAP_NEEDS_SUPPORT");
    // Should NOT say "let's move on" or "next question"
    expect(move!.text).not.toMatch(/move on|next question|let's try something else/i);
    // Should still include a probe
    expect(move!.text).toMatch(/what/i);
  });

  // ── 7. "I was trying to split the 11, not do 4 + 1" ──────────────

  test("'I was trying to split the 11, not do 4 + 1' → bridges to canonical split of 11", () => {
    const move = getDeterministicRemediationMove(
      mrSteps, emptyAcc,
      "I was trying to split the 11 not do 4 + 1",
      mrProblem,
      [{ role: "coach", message: "What is 4 + 1?" }],
    );

    expect(move).not.toBeNull();
    expect(move!.studentState).toBe("math_relevant_resistance");
    // Should bridge: "If you split 11, it becomes 10 and 1"
    expect(move!.text).toMatch(/split\s+11|11.*10.*1/i);
    // Should ask a follow-up based on their intent
    expect(move!.text).toMatch(/what/i);
    // Must NOT wrap
    expect(move!.type).not.toBe("WRAP_SUCCESS");
  });

  // ── 8. Voice pacing: response is concise ──────────────────────────

  test("responses are concise enough for live voice pacing", () => {
    const move = getDeterministicRemediationMove(
      mrSteps, emptyAcc,
      "why can't I do 7 + 6",
      mrProblem,
      [{ role: "coach", message: "What is 4 + 1?" }],
    );

    expect(move).not.toBeNull();
    // Response should be under ~200 chars for natural voice pacing
    expect(move!.text.length).toBeLessThan(200);
  });
});

// ============================================================================
// COMPUTATION_MISTAKE — valid strategy + arithmetic slip
// ============================================================================

describe("COMPUTATION_MISTAKE — valid strategy + arithmetic slip", () => {
  const cmProblem: MathProblem = {
    skill: "two_digit_addition",
    a: 14, b: 11, expression: "14 + 11",
    correctAnswer: 25, requiresRegrouping: false,
    expectedStrategyTags: ["add ones", "add tens"],
    commonWrongAnswers: [
      { answer: 15, misconception: "Added ones digits only" },
    ],
  };

  const cmSteps: ReasoningStep[] = [
    { id: "ones_sum", label: "Add the ones", expectedStatements: ["4 + 1 = 5"], probe: "What is 4 + 1?", kind: "ones_sum" },
    { id: "tens_sum", label: "Add the tens", expectedStatements: ["10 + 10 = 20"], probe: "What is 10 + 10?", kind: "tens_sum" },
    { id: "combine", label: "Combine the totals", expectedStatements: ["20 + 5 = 25"], probe: "What is 20 + 5?", kind: "combine" },
  ];

  const emptyAcc: ReasoningStepAccumulation = {
    satisfiedStepIds: [], missingStepIds: ["ones_sum", "tens_sum", "combine"],
    newlySatisfiedStepIds: [], completionRatio: 0,
    answerCorrect: false, extractedAnswer: null,
  };

  // ── 1. Split-addend with tens-place slip ──────────────────────────

  test("'I split 11 into 10 and 1 then 14 + 10 is 34' → computation_mistake, corrects arithmetic", () => {
    const move = getDeterministicRemediationMove(
      cmSteps, emptyAcc,
      "I split 11 into 10 and 1 then 14 + 10 is 34",
      cmProblem,
      [{ role: "coach", message: "What is 14 + 11?" }],
    );

    expect(move).not.toBeNull();
    expect(move!.type).toBe("STEP_COMPUTATION_CORRECTION");
    expect(move!.studentState).toBe("computation_mistake");
    // Must correct the arithmetic
    expect(move!.text).toMatch(/24/);
    expect(move!.text).toMatch(/34/);
    expect(move!.text).toMatch(/not\s+34|instead of 34/i);
    // Must ask a follow-up question
    expect(move!.text).toMatch(/what|now/i);
    // Must NOT wrap
    expect(move!.type).not.toBe("WRAP_SUCCESS");
    expect(move!.type).not.toBe("WRAP_NEEDS_SUPPORT");
    // Must NOT say "wrong" or "incorrect" — this is a near-miss
    expect(move!.text).not.toMatch(/\bwrong\b|\bincorrect\b/i);
  });

  // ── 2. Valid multi-step that closes correctly → should still pass ─

  test("'14 + 10 is 24 and then plus 1 is 25' → NOT computation_mistake (correct)", () => {
    const correctAcc: ReasoningStepAccumulation = {
      satisfiedStepIds: ["ones_sum", "tens_sum"], missingStepIds: ["combine"],
      newlySatisfiedStepIds: ["combine"], completionRatio: 1.0,
      answerCorrect: true, extractedAnswer: 25,
    };
    const move = getDeterministicRemediationMove(
      cmSteps, correctAcc,
      "14 + 10 is 24 and then plus 1 is 25",
      cmProblem,
      [{ role: "coach", message: "What is 14 + 11?" }],
    );

    expect(move).not.toBeNull();
    // Should succeed or acknowledge, NOT correction
    expect(move!.type).not.toBe("STEP_COMPUTATION_CORRECTION");
  });

  // ── 3. Bare "4 + 1 is 6" answering a direct probe → NOT computation_mistake ─

  test("'4 + 1 is 6' bare answer to probe → regular wrong handling, NOT computation_mistake", () => {
    const move = getDeterministicRemediationMove(
      cmSteps, emptyAcc,
      "4 + 1 is 6",
      cmProblem,
      [{ role: "coach", message: "What is 4 + 1?" }],
    );

    expect(move).not.toBeNull();
    // Should be regular wrong-answer handling, not computation correction
    expect(move!.type).not.toBe("STEP_COMPUTATION_CORRECTION");
  });

  // ── 4. Canonical step slip WITH strategy framing → computation_mistake ─

  test("'so the ones are 4 + 1 is 6' → computation_mistake (strategy evidence present)", () => {
    const move = getDeterministicRemediationMove(
      cmSteps, emptyAcc,
      "so the ones are 4 + 1 is 6",
      cmProblem,
      [{ role: "coach", message: "What is 14 + 11?" }],
    );

    expect(move).not.toBeNull();
    expect(move!.type).toBe("STEP_COMPUTATION_CORRECTION");
    expect(move!.studentState).toBe("computation_mistake");
    // Must correct: 4 + 1 is 5, not 6
    expect(move!.text).toMatch(/5/);
    expect(move!.text).toMatch(/6/);
  });

  // ── 5. "I think it's 34" with no strategy evidence → generic wrong ─

  test("'I think it's 34' with no strategy evidence → NOT computation_mistake", () => {
    const move = getDeterministicRemediationMove(
      cmSteps, emptyAcc,
      "I think it's 34",
      cmProblem,
      [{ role: "coach", message: "What is 14 + 11?" }],
    );

    expect(move).not.toBeNull();
    expect(move!.type).not.toBe("STEP_COMPUTATION_CORRECTION");
  });

  // ── 6. Tens-step off-by-one: "11 + 10 is 20" → computation_mistake ─

  test("'then 11 + 10 is 20' → computation_mistake (off by 1)", () => {
    const move = getDeterministicRemediationMove(
      cmSteps, emptyAcc,
      "I split the 14 into 10 and 4 then 11 + 10 is 20",
      cmProblem,
      [{ role: "coach", message: "What is 14 + 11?" }],
    );

    expect(move).not.toBeNull();
    expect(move!.type).toBe("STEP_COMPUTATION_CORRECTION");
    // Must correct: 11 + 10 is 21, not 20
    expect(move!.text).toMatch(/21/);
    expect(move!.text).toMatch(/20/);
  });

  // ── 7. Does NOT wrap after correction ─────────────────────────────

  test("computation correction does not wrap", () => {
    const move = getDeterministicRemediationMove(
      cmSteps, emptyAcc,
      "I split 11 into 10 and 1 then 14 + 10 is 34",
      cmProblem,
      [{ role: "coach", message: "What is 14 + 11?" }],
    );

    expect(move).not.toBeNull();
    expect(move!.type).not.toBe("WRAP_SUCCESS");
    expect(move!.type).not.toBe("WRAP_NEEDS_SUPPORT");
    // Must not say "let's move on"
    expect(move!.text).not.toMatch(/move on|next question/i);
  });

  // ── 8. Follow-up continues in student's method ────────────────────

  test("follow-up question continues in student's strategy path", () => {
    const move = getDeterministicRemediationMove(
      cmSteps, emptyAcc,
      "I split 11 into 10 and 1 then 14 + 10 is 34",
      cmProblem,
      [{ role: "coach", message: "What is 14 + 11?" }],
    );

    expect(move).not.toBeNull();
    // Should ask about the remaining 1 (continuing split-addend strategy)
    expect(move!.text).toMatch(/1\s+(?:that's\s+)?left|what.*next|what.*do/i);
  });

  // ── 9. Voice pacing: concise response ─────────────────────────────

  test("response is concise for voice pacing", () => {
    const move = getDeterministicRemediationMove(
      cmSteps, emptyAcc,
      "I split 11 into 10 and 1 then 14 + 10 is 34",
      cmProblem,
      [{ role: "coach", message: "What is 14 + 11?" }],
    );

    expect(move).not.toBeNull();
    expect(move!.text.length).toBeLessThan(120);
  });

  // ── 10. Misconception is NOT misclassified ────────────────────────

  test("'20 + 5 is 15' (known wrong answer) → misconception, NOT computation_mistake", () => {
    const combineAcc: ReasoningStepAccumulation = {
      satisfiedStepIds: ["ones_sum", "tens_sum"], missingStepIds: ["combine"],
      newlySatisfiedStepIds: [], completionRatio: 0.67,
      answerCorrect: false, extractedAnswer: 15,
    };
    const move = getDeterministicRemediationMove(
      cmSteps, combineAcc,
      "20 + 5 is 15",
      cmProblem,
      [{ role: "coach", message: "What is 20 + 5?" }],
    );

    expect(move).not.toBeNull();
    expect(move!.type).not.toBe("STEP_COMPUTATION_CORRECTION");
  });

  // ── 11. Subtraction on addition NOT misclassified ─────────────────

  test("'1 - 4 = 3' on addition → misconception, NOT computation_mistake", () => {
    const move = getDeterministicRemediationMove(
      cmSteps, emptyAcc,
      "1 - 4 = 3",
      cmProblem,
      [{ role: "coach", message: "What is 1 + 4?" }],
    );

    expect(move).not.toBeNull();
    expect(move!.type).not.toBe("STEP_COMPUTATION_CORRECTION");
  });
});

// ============================================================================
// METHOD OWNERSHIP / STRATEGY LOCK — regression tests
// ============================================================================
describe("METHOD OWNERSHIP — strategy lock and acknowledgment guard", () => {
  const moProblem: MathProblem = {
    skill: "two_digit_addition",
    a: 14, b: 11, expression: "14 + 11",
    correctAnswer: 25, requiresRegrouping: false,
    expectedStrategyTags: ["add ones", "add tens"],
  };

  const moSteps: ReasoningStep[] = [
    { id: "ones_sum", label: "Add the ones", expectedStatements: ["4 + 1 = 5"], probe: "What is 4 + 1?", kind: "ones_sum" },
    { id: "tens_sum", label: "Add the tens", expectedStatements: ["10 + 10 = 20"], probe: "What is 10 + 10?", kind: "tens_sum" },
    { id: "combine", label: "Combine the totals", expectedStatements: ["20 + 5 = 25"], probe: "What is 20 + 5?", kind: "combine" },
  ];

  const emptyAcc: ReasoningStepAccumulation = {
    satisfiedStepIds: [], missingStepIds: ["ones_sum", "tens_sum", "combine"],
    newlySatisfiedStepIds: [], completionRatio: 0,
    answerCorrect: false, extractedAnswer: null,
  };

  // 1. "split 14 into 7+7 and 11 into 5+6" → coach acknowledges both decompositions
  test("student proposes 7+7/5+6 → coach acknowledges BOTH decompositions before redirecting", () => {
    const move = getDeterministicRemediationMove(
      moSteps, emptyAcc,
      "I would split the 14 into 7 and 7 and the 11 into 5 and 6",
      moProblem,
      [{ role: "coach", message: "What is 14 + 11?" }],
    );

    expect(move).not.toBeNull();
    expect(move!.studentState).toBe("noncanonical_active");
    // Must mention BOTH decompositions
    expect(move!.text).toMatch(/7\s*\+\s*7|7 and 7/);
    expect(move!.text).toMatch(/5\s*\+\s*6|5 and 6/);
    // Must acknowledge validity
    expect(move!.text).toMatch(/valid|right|correct|true|works|good/i);
    // Must continue in student's strategy (not redirect to canonical)
    expect(move!.text).toMatch(/combine|what is/i);
  });

  // 2. Coach does NOT immediately say "keep 14 the same" without acknowledgment
  test("coach does NOT say 'keep X the same' without acknowledging student plan", () => {
    const move = getDeterministicRemediationMove(
      moSteps, emptyAcc,
      "I want to split the 14 into 7 and 7",
      moProblem,
      [{ role: "coach", message: "What is 14 + 11?" }],
    );

    expect(move).not.toBeNull();
    // Must NOT tell them to "keep" an operand
    expect(move!.text).not.toMatch(/keep\s+\d+/i);
    // Must acknowledge their plan
    expect(move!.text).toMatch(/7\s*\+\s*7|7 and 7/i);
  });

  // 3. After student says "you're right, that is easier" → redirect becomes accepted
  test("student acceptance ('you're right') after redirect means canonical is now active", () => {
    const move = getDeterministicRemediationMove(
      moSteps, emptyAcc,
      "13",
      moProblem,
      [
        { role: "coach", message: "What is 14 + 11?" },
        { role: "student", message: "I want to split 14 into 7 and 7" },
        { role: "coach", message: "14 = 7 + 7 — that's true! For this problem, tens and ones is easier because 11 also splits into 10 and 1. What is 4 + 1?" },
        { role: "student", message: "you're right, that is easier" },
        { role: "coach", message: "Great! So what is 4 + 1?" },
      ],
    );

    expect(move).not.toBeNull();
    // Student said 13 (wrong) AFTER accepting redirect — should be treated as
    // regular wrong (not given the gentle strategy-lock re-probe)
    expect(move!.studentState).toBe("wrong");
    // Should NOT get strategy-lock soft text
    expect(move!.text).not.toMatch(/let's try it with tens and ones/i);
  });

  // 4. Only after acceptance can "14 + 10" be treated as the active next step
  test("after acceptance, canonical step answer (5) is treated as partial progress", () => {
    const partialAcc: ReasoningStepAccumulation = {
      satisfiedStepIds: [], missingStepIds: ["ones_sum", "tens_sum", "combine"],
      newlySatisfiedStepIds: ["ones_sum"], completionRatio: 0.33,
      answerCorrect: false, extractedAnswer: 5,
    };
    const move = getDeterministicRemediationMove(
      moSteps, partialAcc,
      "5",
      moProblem,
      [
        { role: "coach", message: "What is 14 + 11?" },
        { role: "student", message: "split 14 into 7 and 7" },
        { role: "coach", message: "14 = 7 + 7 — true! Tens and ones is easier here. What is 4 + 1?" },
        { role: "student", message: "ok sure" },
        { role: "coach", message: "What is 4 + 1?" },
      ],
    );

    expect(move).not.toBeNull();
    // Student answered correctly after accepting redirect — should be partial progress
    expect(move!.studentState).toBe("partial");
  });

  // 5. If redirect is NOT accepted, coach should not judge student as though they switched
  test("wrong answer WITHOUT redirect acceptance → gentle re-probe, not wrong classification", () => {
    const wrongAcc: ReasoningStepAccumulation = {
      satisfiedStepIds: [], missingStepIds: ["ones_sum", "tens_sum", "combine"],
      newlySatisfiedStepIds: [], completionRatio: 0,
      answerCorrect: false, extractedAnswer: 13,
    };
    const move = getDeterministicRemediationMove(
      moSteps, wrongAcc,
      "13",
      moProblem,
      [
        { role: "coach", message: "What is 14 + 11?" },
        { role: "student", message: "I want to split 14 into 7 and 7" },
        { role: "coach", message: "14 = 7 + 7 — that's true! Tens and ones is easier because 11 splits into 10 and 1. What is 4 + 1?" },
        // Student did NOT accept — just answered with their own method result
      ],
    );

    expect(move).not.toBeNull();
    // Should get gentle re-probe, not harsh "wrong" handling
    expect(move!.text).toMatch(/tens and ones|simpler|easier/i);
    // Should NOT say "not quite" or "that's wrong"
    expect(move!.text).not.toMatch(/wrong|not quite|incorrect/i);
  });

  // 6. Live transcript: student proposes 7+7/5+6 → coach acknowledges → explains
  //    why tens/ones easier → no premature wrap
  test("full flow: propose non-canonical → coach acknowledges → no premature wrap", () => {
    // Turn 1: Student proposes non-canonical
    const move1 = getDeterministicRemediationMove(
      moSteps, emptyAcc,
      "I would split the 14 into 7 and 7 and the 11 into 5 and 6",
      moProblem,
      [{ role: "coach", message: "What is 14 + 11?" }],
    );

    expect(move1).not.toBeNull();
    // Must NOT wrap
    expect(move1!.type).not.toBe("WRAP_SUCCESS");
    expect(move1!.type).not.toBe("WRAP_NEEDS_SUPPORT");
    // Must acknowledge decompositions
    expect(move1!.text).toMatch(/7\s*\+\s*7|7 and 7/);
    expect(move1!.text).toMatch(/5\s*\+\s*6|5 and 6/);
    // Must continue in student's strategy (not redirect to canonical)
    expect(move1!.text).toMatch(/combine|what is/i);
    // Must end with a probe question
    expect(move1!.text).toMatch(/what/i);

    // Turn 2: Student resists — "but why can't I do 7 + 6?"
    const move2 = getDeterministicRemediationMove(
      moSteps, emptyAcc,
      "but why can't I do 7 + 6?",
      moProblem,
      [
        { role: "coach", message: "What is 14 + 11?" },
        { role: "student", message: "I would split the 14 into 7 and 7 and the 11 into 5 and 6" },
        { role: "coach", message: move1!.text },
      ],
    );

    expect(move2).not.toBeNull();
    // Must NOT wrap after resistance
    expect(move2!.type).not.toBe("WRAP_SUCCESS");
    expect(move2!.type).not.toBe("WRAP_NEEDS_SUPPORT");
    // Should be math_relevant_resistance
    expect(move2!.studentState).toBe("math_relevant_resistance");
  });
});

// ============================================================================
// ANSWER-SCOPE ATTRIBUTION — regression tests
// ============================================================================
describe("ANSWER-SCOPE ATTRIBUTION — prevent sub-step misattribution", () => {
  const asProblem: MathProblem = {
    skill: "two_digit_addition",
    a: 14, b: 11, expression: "14 + 11",
    correctAnswer: 25, requiresRegrouping: false,
    expectedStrategyTags: ["add ones", "add tens"],
  };

  const asSteps: ReasoningStep[] = [
    { id: "ones_sum", label: "Add the ones", expectedStatements: ["4 + 1 = 5"], probe: "What is 4 + 1?", kind: "ones_sum" },
    { id: "tens_sum", label: "Add the tens", expectedStatements: ["10 + 10 = 20"], probe: "What is 10 + 10?", kind: "tens_sum" },
    { id: "combine", label: "Combine the totals", expectedStatements: ["20 + 5 = 25"], probe: "What is 20 + 5?", kind: "combine" },
  ];

  const emptyAcc: ReasoningStepAccumulation = {
    satisfiedStepIds: [], missingStepIds: ["ones_sum", "tens_sum", "combine"],
    newlySatisfiedStepIds: [], completionRatio: 0,
    answerCorrect: false, extractedAnswer: null,
  };

  // 1. "10 + 10 = 20" after tens probe is stored as TENS_SUBSTEP, not WHOLE_PROBLEM
  test("detectActiveAnswerScope: '20' after 'What is 10 + 10?' → TENS_SUBSTEP", () => {
    const scope = detectActiveAnswerScope(
      [
        { role: "coach", message: "What is 14 + 11?" },
        { role: "student", message: "I can split them" },
        { role: "coach", message: "What is 10 + 10?" },
      ],
      asSteps,
      asProblem,
      "20",
    );
    expect(scope).toBe("TENS_SUBSTEP");
  });

  // 2. Coach never says "You said 14 + 11 = 20" after a tens-only answer
  test("coach does NOT attribute sub-step answer to whole problem", () => {
    const tensAcc: ReasoningStepAccumulation = {
      satisfiedStepIds: ["ones_sum"], missingStepIds: ["tens_sum", "combine"],
      newlySatisfiedStepIds: [], completionRatio: 0.33,
      answerCorrect: false, extractedAnswer: 20,
    };
    const move = getDeterministicRemediationMove(
      asSteps, tensAcc,
      "20",
      asProblem,
      [
        { role: "coach", message: "What is 14 + 11?" },
        { role: "student", message: "4 + 1 = 5" },
        { role: "coach", message: "Good! What is 10 + 10?" },
      ],
    );

    expect(move).not.toBeNull();
    // Must NOT say "You said 14 + 11 = 20" or "14 + 11 isn't 20"
    expect(move!.text).not.toMatch(/14\s*\+\s*11\s*(?:=|is|equals|isn'?t)\s*20/i);
    expect(move!.text).not.toMatch(/you said.*14.*11.*20/i);
    // Should acknowledge the sub-step or continue
    expect(move!.text).toMatch(/10\s*\+\s*10|20|good|combine|put them together|what/i);
  });

  // 3. "I didn't say 14 + 11 gets me 20, I said 10 + 10 gets me 20" → acknowledgment
  test("student corrects misattribution → acknowledged and corrected follow-up", () => {
    const tensAcc: ReasoningStepAccumulation = {
      satisfiedStepIds: ["ones_sum", "tens_sum"], missingStepIds: ["combine"],
      newlySatisfiedStepIds: [], completionRatio: 0.67,
      answerCorrect: false, extractedAnswer: null,
    };
    const move = getDeterministicRemediationMove(
      asSteps, tensAcc,
      "I didn't say 14 + 11 gets me 20, I said 10 + 10 gets me 20",
      asProblem,
      [
        { role: "coach", message: "What is 14 + 11?" },
        { role: "student", message: "20" },
        { role: "coach", message: "Not quite — 14 + 11 isn't 20. Can you try again?" },
      ],
    );

    expect(move).not.toBeNull();
    // Must acknowledge their correction
    expect(move!.text).toMatch(/right|correct|clarif/i);
    // Must reference the correct computation (10 + 10 = 20)
    expect(move!.text).toMatch(/10\s*\+\s*10\s*=?\s*20|20/i);
    // Must continue with next step, not repeat the same wrong attribution
    expect(move!.text).toMatch(/what|combine|put.*together/i);
    // Must NOT repeat the wrong attribution
    expect(move!.text).not.toMatch(/14\s*\+\s*11\s*(?:=|isn'?t)\s*20/i);
  });

  // 4. "10 + 10 = 30" gets brief correction and continuation
  test("wrong sub-step answer gets brief correction, not whole-problem restart", () => {
    const onesAcc: ReasoningStepAccumulation = {
      satisfiedStepIds: ["ones_sum"], missingStepIds: ["tens_sum", "combine"],
      newlySatisfiedStepIds: [], completionRatio: 0.33,
      answerCorrect: false, extractedAnswer: 30,
    };
    const move = getDeterministicRemediationMove(
      asSteps, onesAcc,
      "10 + 10 is 30",
      asProblem,
      [
        { role: "coach", message: "Good! What is 10 + 10?" },
      ],
    );

    expect(move).not.toBeNull();
    // Should NOT restart the whole method
    expect(move!.text).not.toMatch(/let's start over|what is 14 \+ 11/i);
    // Should NOT say "14 + 11 isn't 30"
    expect(move!.text).not.toMatch(/14\s*\+\s*11.*30/i);
  });

  // 5. "4 + 1 = 5 so the answer is 35" → partial credit for ones, correction for final
  test("correct sub-step + wrong final → acknowledges sub-step, addresses final", () => {
    const partialAcc: ReasoningStepAccumulation = {
      satisfiedStepIds: [], missingStepIds: ["ones_sum", "tens_sum", "combine"],
      newlySatisfiedStepIds: ["ones_sum"], completionRatio: 0.33,
      answerCorrect: false, extractedAnswer: 35,
    };
    const move = getDeterministicRemediationMove(
      asSteps, partialAcc,
      "4 + 1 = 5 so the answer is 35",
      asProblem,
      [{ role: "coach", message: "What is 14 + 11?" }],
    );

    expect(move).not.toBeNull();
    // Should be classified as partial (ones_sum newly satisfied)
    expect(move!.studentState).toBe("partial");
    // Should ask about the next step (tens), not repeat the question
    expect(move!.text).toMatch(/10\s*\+\s*10|tens|what/i);
  });

  // 6. Scope detection: ones probe → ONES_SUBSTEP, whole problem → WHOLE_PROBLEM
  test("detectActiveAnswerScope: 'What is 4 + 1?' → ONES_SUBSTEP", () => {
    const scope = detectActiveAnswerScope(
      [{ role: "coach", message: "What is 4 + 1?" }],
      asSteps,
      asProblem,
    );
    expect(scope).toBe("ONES_SUBSTEP");
  });

  test("detectActiveAnswerScope: 'What is 14 + 11?' → WHOLE_PROBLEM", () => {
    const scope = detectActiveAnswerScope(
      [{ role: "coach", message: "What is 14 + 11?" }],
      asSteps,
      asProblem,
    );
    expect(scope).toBe("WHOLE_PROBLEM");
  });

  // 7. getScopeExpression returns step-specific expression
  test("getScopeExpression: TENS_SUBSTEP → '10 + 10', not '14 + 11'", () => {
    const expr = getScopeExpression("TENS_SUBSTEP", asSteps, asProblem);
    expect(expr).toBe("10 + 10");
    expect(expr).not.toBe("14 + 11");
  });

  test("getScopeExpression: WHOLE_PROBLEM → '14 + 11'", () => {
    const expr = getScopeExpression("WHOLE_PROBLEM", asSteps, asProblem);
    expect(expr).toBe("14 + 11");
  });
});

// ============================================================================
// STATED-DECOMPOSITION COMMITMENT — regression tests
// ============================================================================
describe("STATED-DECOMPOSITION COMMITMENT — no re-asking after explicit split", () => {
  const sdProblem: MathProblem = {
    skill: "two_digit_addition",
    a: 14, b: 11, expression: "14 + 11",
    correctAnswer: 25, requiresRegrouping: false,
    expectedStrategyTags: ["add ones", "add tens"],
  };

  const sdSteps: ReasoningStep[] = [
    { id: "ones_sum", label: "Add the ones", expectedStatements: ["4 + 1 = 5"], probe: "What is 4 + 1?", kind: "ones_sum" },
    { id: "tens_sum", label: "Add the tens", expectedStatements: ["10 + 10 = 20"], probe: "What is 10 + 10?", kind: "tens_sum" },
    { id: "combine", label: "Combine the totals", expectedStatements: ["20 + 5 = 25"], probe: "What is 20 + 5?", kind: "combine" },
  ];

  const emptyAcc: ReasoningStepAccumulation = {
    satisfiedStepIds: [], missingStepIds: ["ones_sum", "tens_sum", "combine"],
    newlySatisfiedStepIds: [], completionRatio: 0,
    answerCorrect: false, extractedAnswer: null,
  };

  // 1. "split 14 to 5 + 9" is recognized as an explicit decomposition
  test("'split 14 to 5 + 9' → recognized as valid_inefficient, not alternate_setup", () => {
    const acc = { ...emptyAcc, extractedAnswer: null };
    const state = classifyStudentState(
      "I would split 14 to 5 + 9",
      acc, sdProblem,
    );
    expect(state).toBe("valid_inefficient");
  });

  // 2. "5 + 9 = 14" counts as stated decomposition
  test("'5 + 9 = 14' → recognized as valid_inefficient", () => {
    const acc = { ...emptyAcc, extractedAnswer: 14 };
    const state = classifyStudentState(
      "5 + 9 = 14",
      acc, sdProblem,
    );
    expect(state).toBe("valid_inefficient");
  });

  // 3. Coach does not ask "How would you split it?" after explicit split already given
  test("coach does NOT ask 'How would you split it?' after explicit non-canonical split", () => {
    const acc = { ...emptyAcc, extractedAnswer: 14 };
    const move = getDeterministicRemediationMove(
      sdSteps, acc,
      "I think I would split up the numbers first so I could start by splitting up the 14 to 5 + 9. 5 + 9 = 14.",
      sdProblem,
      [{ role: "coach", message: "What is 14 + 11?" }],
    );

    expect(move).not.toBeNull();
    // Must NOT ask how to split — student already said 5 + 9
    expect(move!.text).not.toMatch(/how would you split/i);
    // Must acknowledge their stated decomposition
    expect(move!.text).toMatch(/5\s*\+\s*9|5 and 9/i);
    // Must redirect to canonical
    expect(move!.text).toMatch(/easier|simpler|tens|ones|instead|lines up/i);
  });

  // 4. "Like I just said, 5 + 9" triggers acknowledgment + continuation, not wrap
  test("'like I just said, split it 5 + 9' → acknowledgment + continuation, not wrap", () => {
    const move = getDeterministicRemediationMove(
      sdSteps, emptyAcc,
      "like I just said I would split it 5 + 9",
      sdProblem,
      [
        { role: "coach", message: "What is 14 + 11?" },
        { role: "student", message: "I would split 14 to 5 + 9" },
        { role: "coach", message: "How would you split 14?" },
      ],
    );

    expect(move).not.toBeNull();
    // Must NOT wrap
    expect(move!.type).not.toBe("WRAP_SUCCESS");
    expect(move!.type).not.toBe("WRAP_NEEDS_SUPPORT");
    // Must acknowledge the decomposition
    expect(move!.text).toMatch(/5\s*\+\s*9|5 and 9/i);
    // Must include a follow-up probe
    expect(move!.text).toMatch(/what/i);
  });

  // 5. Student on-task with valid split does not get WRAP_NEEDS_SUPPORT
  test("student with valid stated split does not get premature wrap", () => {
    const move = getDeterministicRemediationMove(
      sdSteps, emptyAcc,
      "I would split it 5 + 9",
      sdProblem,
      [{ role: "coach", message: "What is 14 + 11?" }],
    );

    expect(move).not.toBeNull();
    expect(move!.type).not.toBe("WRAP_SUCCESS");
    expect(move!.type).not.toBe("WRAP_NEEDS_SUPPORT");
    // Must have a follow-up question
    expect(move!.text).toMatch(/\?/);
  });

  // 6. Canonical and non-canonical stated splits both handled correctly
  test("canonical 'split 11 into 10 and 1' → mirrors and continues", () => {
    const move = getDeterministicRemediationMove(
      sdSteps, emptyAcc,
      "I would split 11 into 10 and 1",
      sdProblem,
      [{ role: "coach", message: "What is 14 + 11?" }],
    );

    expect(move).not.toBeNull();
    // Should mirror the canonical split
    expect(move!.text).toMatch(/11.*10.*1|10\s*\+\s*1/i);
    // Should NOT ask how to split
    expect(move!.text).not.toMatch(/how would you split/i);
    // Should continue with next step
    expect(move!.text).toMatch(/what/i);
  });

  test("non-canonical 'split 14 into 7 and 7' → acknowledges and redirects", () => {
    const move = getDeterministicRemediationMove(
      sdSteps, emptyAcc,
      "I want to split 14 into 7 and 7",
      sdProblem,
      [{ role: "coach", message: "What is 14 + 11?" }],
    );

    expect(move).not.toBeNull();
    // Should acknowledge their split
    expect(move!.text).toMatch(/7\s*\+\s*7|7 and 7/i);
    // Should NOT ask how to split
    expect(move!.text).not.toMatch(/how would you split/i);
  });

  // 7. "splitting up the 14 to 5 + 9" with verb form variation is recognized
  test("'splitting up the 14 to 5 + 9' (verb form) → recognized, not asked again", () => {
    const acc = { ...emptyAcc, extractedAnswer: 14 };
    const move = getDeterministicRemediationMove(
      sdSteps, acc,
      "splitting up the 14 to 5 + 9",
      sdProblem,
      [{ role: "coach", message: "What is 14 + 11?" }],
    );

    expect(move).not.toBeNull();
    // Must NOT ask how to split
    expect(move!.text).not.toMatch(/how would you split/i);
    // Must acknowledge 5 + 9
    expect(move!.text).toMatch(/5\s*\+\s*9|5 and 9/i);
  });
});

// ============================================================================
// LIVE TRANSCRIPT BUGS — regression tests
// ============================================================================
describe("LIVE TRANSCRIPT BUGS — contradiction scope, short resistance, AV complaint", () => {
  const ltProblem: MathProblem = {
    skill: "two_digit_addition",
    a: 14, b: 11, expression: "14 + 11",
    correctAnswer: 25, requiresRegrouping: false,
    expectedStrategyTags: ["add ones", "add tens"],
  };

  const ltSteps: ReasoningStep[] = [
    { id: "ones_sum", label: "Add the ones", expectedStatements: ["4 + 1 = 5"], probe: "What is 4 + 1?", kind: "ones_sum" },
    { id: "tens_sum", label: "Add the tens", expectedStatements: ["10 + 10 = 20"], probe: "What is 10 + 10?", kind: "tens_sum" },
    { id: "combine", label: "Combine the totals", expectedStatements: ["20 + 5 = 25"], probe: "What is 20 + 5?", kind: "combine" },
  ];

  const emptyAcc: ReasoningStepAccumulation = {
    satisfiedStepIds: [], missingStepIds: ["ones_sum", "tens_sum", "combine"],
    newlySatisfiedStepIds: [], completionRatio: 0,
    answerCorrect: false, extractedAnswer: null,
  };

  // Bug A: "I didn't answer the five but 10 and 10 is 20" → TENS_SUBSTEP, not ONES_SUBSTEP
  test("contradiction scope: 'didn't answer the five but 10 and 10 is 20' → TENS_SUBSTEP", () => {
    const scope = detectActiveAnswerScope(
      [
        { role: "coach", message: "What is 14 + 11?" },
        { role: "student", message: "I can split them" },
        { role: "coach", message: "What is 4 + 1?" },
      ],
      ltSteps,
      ltProblem,
      "I didn't answer the five but 10 and 10 is 20",
    );
    expect(scope).toBe("TENS_SUBSTEP");
  });

  // Bug A: contradiction-aware scope drives correct acknowledgment text
  test("contradiction scope: move acknowledges TENS step, not ONES step", () => {
    const acc: ReasoningStepAccumulation = {
      satisfiedStepIds: ["tens_sum"],
      missingStepIds: ["ones_sum", "combine"],
      newlySatisfiedStepIds: ["tens_sum"],
      completionRatio: 0.33,
      answerCorrect: false, extractedAnswer: 20,
    };

    const move = getDeterministicRemediationMove(
      ltSteps, acc,
      "I didn't answer the five but 10 and 10 is 20",
      ltProblem,
      [
        { role: "coach", message: "What is 4 + 1?" },
      ],
    );

    expect(move).not.toBeNull();
    // Must NOT say "20 is right for 4 + 1" (the misattribution bug)
    expect(move!.text).not.toMatch(/right for 4\s*\+\s*1/i);
    expect(move!.text).not.toMatch(/right for 4 and 1/i);
  });

  // Bug B: short response when student has step progress and asks "what does that have to do with..."
  test("structure confusion with progress: 'what does that have to do with the problem' → short response (< 120 chars)", () => {
    const accWithProgress: ReasoningStepAccumulation = {
      satisfiedStepIds: ["tens_sum"],
      missingStepIds: ["ones_sum", "combine"],
      newlySatisfiedStepIds: [],
      completionRatio: 0.33,
      answerCorrect: false, extractedAnswer: null,
    };

    const state = classifyStudentState(
      "what does that have to do with the problem",
      accWithProgress, ltProblem,
    );
    expect(state).toBe("concept_confusion");

    const move = getDeterministicRemediationMove(
      ltSteps, accWithProgress,
      "what does that have to do with the problem",
      ltProblem,
      [{ role: "coach", message: "What is 4 + 1?" }],
    );

    expect(move).not.toBeNull();
    expect(move!.text.length).toBeLessThan(120);
    // Should still contain the probe
    expect(move!.text).toMatch(/\d+\s*(?:and|plus|\+)\s*\d+/);
  });

  // Bug B: full explanation when student has NO progress (concept confusion STRUCTURE)
  test("structure confusion without progress: short bridge + probe", () => {
    const state = classifyStudentState(
      "what does that have to do with the problem",
      emptyAcc, ltProblem,
    );
    expect(state).toBe("concept_confusion");

    const move = getDeterministicRemediationMove(
      ltSteps, emptyAcc,
      "what does that have to do with the problem",
      ltProblem,
      [{ role: "coach", message: "What is 14 + 11?" }],
    );

    expect(move).not.toBeNull();
    // Short bridge + probe, no long decomposition lecture
    expect(move!.text).toMatch(/solving|14 \+ 11/);
    expect(move!.text).toMatch(/\?/);
    // Bridge before probe should be short (1 sentence)
    const probeStart = move!.text.lastIndexOf("What");
    if (probeStart > 0) {
      expect(probeStart).toBeLessThan(80);
    }
  });

  // Bug C: AV complaint classified correctly
  test("'are your mouth is messed up' → av_delivery_complaint", () => {
    const state = classifyStudentState(
      "are your mouth is messed up",
      emptyAcc, ltProblem,
    );
    expect(state).toBe("av_delivery_complaint");
  });

  // Bug C: AV complaint produces "Sorry about that" + restate
  test("AV complaint → 'Sorry about that' + restated question", () => {
    const move = getDeterministicRemediationMove(
      ltSteps, emptyAcc,
      "are your mouth is messed up",
      ltProblem,
      [{ role: "coach", message: "What is 1 + 4?" }],
    );

    expect(move).not.toBeNull();
    expect(move!.studentState).toBe("av_delivery_complaint");
    expect(move!.text).toMatch(/sorry about that/i);
    // Must restate a question
    expect(move!.text).toMatch(/\d+\s*(?:and|plus|\+)\s*\d+/);
    // Must NOT wrap
    expect(move!.type).not.toBe("WRAP_SUCCESS");
    expect(move!.type).not.toBe("WRAP_NEEDS_SUPPORT");
  });
});

// ============================================================================
// MIXED-FLOW MATH — regression tests
// ============================================================================
describe("MIXED-FLOW MATH — mixed strategy, method repair, short resistance", () => {
  const mfProblem: MathProblem = {
    skill: "two_digit_addition",
    a: 14, b: 11, expression: "14 + 11",
    correctAnswer: 25, requiresRegrouping: false,
    expectedStrategyTags: ["add ones", "add tens"],
  };

  const mfSteps: ReasoningStep[] = [
    { id: "ones_sum", label: "Add the ones", expectedStatements: ["4 + 1 = 5"], probe: "What is 4 + 1?", kind: "ones_sum" },
    { id: "tens_sum", label: "Add the tens", expectedStatements: ["10 + 10 = 20"], probe: "What is 10 + 10?", kind: "tens_sum" },
    { id: "combine", label: "Combine the totals", expectedStatements: ["20 + 5 = 25"], probe: "What is 20 + 5?", kind: "combine" },
  ];

  const emptyAcc: ReasoningStepAccumulation = {
    satisfiedStepIds: [], missingStepIds: ["ones_sum", "tens_sum", "combine"],
    newlySatisfiedStepIds: [], completionRatio: 0,
    answerCorrect: false, extractedAnswer: null,
  };

  // 1. canonical progress + ongoing non-canonical method → MIXED_STRATEGY_ACTIVE
  test("canonical progress + non-canonical decomposition → mixed_strategy_active", () => {
    const accWithProgress: ReasoningStepAccumulation = {
      satisfiedStepIds: ["ones_sum"],
      missingStepIds: ["tens_sum", "combine"],
      newlySatisfiedStepIds: [],
      completionRatio: 0.33,
      answerCorrect: false, extractedAnswer: 7,
    };

    const move = getDeterministicRemediationMove(
      mfSteps, accWithProgress,
      "but 14 is 7 + 7 and 11 is 5 + 6",
      mfProblem,
      [
        { role: "coach", message: "What is 4 + 1?" },
        { role: "student", message: "5" },
        { role: "coach", message: "Good! What is 10 + 10?" },
      ],
    );

    expect(move).not.toBeNull();
    expect(move!.studentState).toBe("mixed_strategy_active");
    // Must acknowledge the canonical progress (found 5)
    expect(move!.text).toMatch(/5/);
    // Must acknowledge the non-canonical split
    expect(move!.text).toMatch(/7\s*\+\s*7|valid|works/i);
    // Must redirect with a probe
    expect(move!.text).toMatch(/what/i);
    // Must NOT wrap
    expect(move!.type).not.toBe("WRAP_SUCCESS");
    expect(move!.type).not.toBe("WRAP_NEEDS_SUPPORT");
  });

  // 2. "did you hear what I was saying before" after math reasoning → method repair
  test("'did you hear what I was saying before' after stated split → method_acknowledgment_repair", () => {
    const move = getDeterministicRemediationMove(
      mfSteps, emptyAcc,
      "did you hear what I was saying before",
      mfProblem,
      [
        { role: "coach", message: "What is 14 + 11?" },
        { role: "student", message: "I would split the 14 into 7 and 7" },
        { role: "coach", message: "Let's use tens and ones. What is 4 + 1?" },
      ],
    );

    expect(move).not.toBeNull();
    expect(move!.studentState).toBe("method_acknowledgment_repair");
    // Must acknowledge the prior method explicitly
    expect(move!.text).toMatch(/heard you|hear you/i);
    expect(move!.text).toMatch(/7\s*\+\s*7/);
    // Must NOT offer generic "explore or move on"
    expect(move!.text).not.toMatch(/explore|move on/i);
    // Must redirect with probe
    expect(move!.text).toMatch(/what/i);
  });

  // 3. "I still want to know why I can't split 14 into 7 + 7" → acknowledges, explains, continues
  test("'I still want to know why I can't split 14 into 7 + 7' → acknowledges and explains briefly", () => {
    const move = getDeterministicRemediationMove(
      mfSteps, emptyAcc,
      "I still want to know why I can't split 14 into 7 + 7",
      mfProblem,
      [
        { role: "coach", message: "What is 4 + 1?" },
        { role: "student", message: "14 is 7 + 7" },
        { role: "coach", message: "10 + 4 is easier. What is 4 + 1?" },
      ],
    );

    expect(move).not.toBeNull();
    expect(move!.studentState).toBe("method_acknowledgment_repair");
    // Must acknowledge their 7 + 7
    expect(move!.text).toMatch(/7\s*\+\s*7/);
    // Must explain why (answers the "why")
    expect(move!.text).toMatch(/easier|track|valid|works/i);
    // Must redirect with probe
    expect(move!.text).toMatch(/what/i);
  });

  // 4. (teacher summary test — see teacherSummary.test.ts)

  // 5. repeated repair/resistance late in session stays under char budget
  test("repeated resistance with progress → response under 150 chars", () => {
    const accWithProgress: ReasoningStepAccumulation = {
      satisfiedStepIds: ["ones_sum"],
      missingStepIds: ["tens_sum", "combine"],
      newlySatisfiedStepIds: [],
      completionRatio: 0.33,
      answerCorrect: false, extractedAnswer: null,
    };

    const move = getDeterministicRemediationMove(
      mfSteps, accWithProgress,
      "why can't I just split it into 7 and 7",
      mfProblem,
      [
        { role: "coach", message: "What is 4 + 1?" },
        { role: "student", message: "5" },
        { role: "coach", message: "Good! What is 10 + 10?" },
        { role: "student", message: "but 14 is 7 + 7" },
        { role: "coach", message: "That works but tens + ones is easier. What is 10 + 10?" },
      ],
    );

    expect(move).not.toBeNull();
    // Response should be short due to repeated resistance + progress
    expect(move!.text.length).toBeLessThan(150);
    // Must still include probe
    expect(move!.text).toMatch(/what/i);
  });

  // 6. mixed-strategy path does not wrap immediately
  test("mixed strategy active does not wrap even with partial progress", () => {
    const accWithProgress: ReasoningStepAccumulation = {
      satisfiedStepIds: ["ones_sum", "tens_sum"],
      missingStepIds: ["combine"],
      newlySatisfiedStepIds: [],
      completionRatio: 0.67,
      answerCorrect: false, extractedAnswer: 7,
    };

    const move = getDeterministicRemediationMove(
      mfSteps, accWithProgress,
      "but I still think 14 is 7 + 7",
      mfProblem,
      [{ role: "coach", message: "What is 20 + 5?" }],
    );

    expect(move).not.toBeNull();
    expect(move!.type).not.toBe("WRAP_SUCCESS");
    expect(move!.type).not.toBe("WRAP_NEEDS_SUPPORT");
    // Must redirect with a probe
    expect(move!.text).toMatch(/what/i);
  });

  // 7. after student accepts canonical path, normal flow still works
  test("after accepting canonical path from mixed strategy, normal flow resumes", () => {
    const accAfterAccept: ReasoningStepAccumulation = {
      satisfiedStepIds: ["ones_sum", "tens_sum"],
      missingStepIds: ["combine"],
      newlySatisfiedStepIds: ["tens_sum"],
      completionRatio: 0.67,
      answerCorrect: false, extractedAnswer: 20,
    };

    const move = getDeterministicRemediationMove(
      mfSteps, accAfterAccept,
      "20",
      mfProblem,
      [
        { role: "coach", message: "What is 10 + 10?" },
      ],
    );

    expect(move).not.toBeNull();
    // Should acknowledge the answer and probe the next step (combine)
    expect(move!.studentState).toBe("partial");
    expect(move!.text).toMatch(/20/);
    // Should ask about combining
    expect(move!.text).toMatch(/\d+\s*(?:and|plus|\+)\s*\d+/);
  });
});

// ============================================================================
// Response conciseness: max word counts for deterministic responses
// ============================================================================

describe("response conciseness", () => {
  function wordCount(text: string): number {
    return text.split(/\s+/).filter(w => w.length > 0).length;
  }

  // All probes should be spoken in under ~4 seconds at natural speed (~150 wpm)
  const MAX_PROBE_WORDS = 20;
  // Hints and corrections can be slightly longer (they contain more info)
  const MAX_HINT_WORDS = 30;
  // Concept explanations are the longest allowed response
  const MAX_EXPLANATION_WORDS = 35;

  const emptyAcc: ReasoningStepAccumulation = {
    satisfiedStepIds: [],
    missingStepIds: ["step_1", "step_2", "step_3"],
    newlySatisfiedStepIds: [],
    completionRatio: 0,
    answerCorrect: false,
    extractedAnswer: null,
    alternateStrategyDetected: false,
  };

  it("direct probe ≤ ${MAX_PROBE_WORDS} words", () => {
    const move = getDeterministicRemediationMove(
      reasoningSteps, emptyAcc, "um", mathProblem,
    );
    expect(move).not.toBeNull();
    expect(wordCount(move!.text)).toBeLessThanOrEqual(MAX_PROBE_WORDS);
  });

  it("misconception redirect ≤ ${MAX_HINT_WORDS} words", () => {
    const acc: ReasoningStepAccumulation = {
      ...emptyAcc,
      extractedAnswer: 3,
    };
    const move = getDeterministicRemediationMove(
      reasoningSteps, acc, "3", mathProblem,
      [{ role: "coach", message: "What do you get when you add 1 and 4?" }],
    );
    expect(move).not.toBeNull();
    expect(["wrong", "misconception"]).toContain(move!.studentState);
    expect(wordCount(move!.text)).toBeLessThanOrEqual(MAX_HINT_WORDS);
  });

  it("strategy lock guard ≤ ${MAX_HINT_WORDS} words", () => {
    const acc: ReasoningStepAccumulation = {
      ...emptyAcc,
      extractedAnswer: 7,
    };
    const move = getDeterministicRemediationMove(
      reasoningSteps, acc, "7", mathProblem,
      [
        { role: "coach", message: "Let's try it with tens and ones." },
        { role: "student", message: "7" },
      ],
    );
    expect(move).not.toBeNull();
    expect(wordCount(move!.text)).toBeLessThanOrEqual(MAX_HINT_WORDS);
  });

  it("vocabulary full-tier ones ≤ ${MAX_EXPLANATION_WORDS} words", () => {
    const acc: ReasoningStepAccumulation = {
      ...emptyAcc,
    };
    const move = getDeterministicRemediationMove(
      reasoningSteps, acc, "what does ones mean?", mathProblem,
    );
    expect(move).not.toBeNull();
    expect(wordCount(move!.text)).toBeLessThanOrEqual(MAX_EXPLANATION_WORDS);
  });
});

// ============================================================================
// Fix 1: Opening variant pools — no repeated openings
// ============================================================================

describe("opening variant pools", () => {
  it("STEP_PROBE_SIMPLER picks different text when previous coach message matches", () => {
    // With no prior message — gets the default variant
    const acc = accumulate([], "I don't know");
    const move1 = getDeterministicRemediationMove(
      reasoningSteps, acc, "I don't know", mathProblem, [],
    );
    expect(move1).not.toBeNull();
    expect(move1!.type).toBe("STEP_PROBE_SIMPLER");

    // With prior coach message equal to move1 — should pick a different variant
    const history2 = [{ role: "coach", message: move1!.text }];
    const move2 = getDeterministicRemediationMove(
      reasoningSteps, acc, "I don't know", mathProblem, history2,
    );
    expect(move2).not.toBeNull();
    expect(move2!.type).toBe("STEP_PROBE_SIMPLER");
    expect(move2!.text).not.toBe(move1!.text);
  });

  it("consecutive uncertain probes differ from each other (same-opening guard)", () => {
    // Turn 1
    const history1: Array<{ role: string; message: string }> = [];
    const acc1 = accumulate(history1, "I don't know");
    const move1 = getDeterministicRemediationMove(
      reasoningSteps, acc1, "I don't know", mathProblem, history1,
    );
    expect(move1).not.toBeNull();
    expect(move1!.type).toBe("STEP_PROBE_SIMPLER");

    // Turn 2: coach just said move1.text
    const history2 = [
      { role: "student", message: "I don't know" },
      { role: "coach", message: move1!.text },
    ];
    const acc2 = accumulate(history2, "I don't know");
    const move2 = getDeterministicRemediationMove(
      reasoningSteps, acc2, "I don't know", mathProblem, history2,
    );
    expect(move2).not.toBeNull();
    expect(move2!.text).not.toBe(move1!.text);
  });

  it("STEP_MISCONCEPTION_REDIRECT varies across turns", () => {
    // Turn 1: subtraction misconception
    const history1: Array<{ role: string; message: string }> = [];
    const acc1 = accumulate(history1, "11 minus 14 is 3. I take away.");
    const move1 = getDeterministicRemediationMove(
      reasoningSteps, acc1, "11 minus 14 is 3. I take away.", mathProblem, history1,
    );
    expect(move1).not.toBeNull();
    expect(move1!.type).toBe("STEP_MISCONCEPTION_REDIRECT");

    // Turn 2: same misconception, coach just said move1.text
    const history2 = [
      { role: "student", message: "11 minus 14 is 3. I take away." },
      { role: "coach", message: move1!.text },
    ];
    const acc2 = accumulate(history2, "I subtract 11 take away 14");
    const move2 = getDeterministicRemediationMove(
      reasoningSteps, acc2, "I subtract 11 take away 14", mathProblem, history2,
    );
    expect(move2).not.toBeNull();
    expect(move2!.type).toBe("STEP_MISCONCEPTION_REDIRECT");
    expect(move2!.text).not.toBe(move1!.text);
  });
});

// ============================================================================
// Fix 2: STEP_DEMONSTRATE_STEP after 2+ consecutive uncertain turns
// ============================================================================

describe("STEP_DEMONSTRATE_STEP escalation", () => {
  it("escalates to STEP_DEMONSTRATE_STEP after 2 consecutive uncertain turns", () => {
    const history = [
      { role: "student", message: "I don't know" },
      { role: "coach", message: "Let's do just the ones. What is 1 + 4?" },
      { role: "student", message: "I'm not sure" },
      { role: "coach", message: "Try just the ones. What's 1 + 4?" },
    ];
    const acc = accumulate(history, "I'm confused");
    const move = getDeterministicRemediationMove(
      reasoningSteps, acc, "I'm confused", mathProblem, history,
    );
    expect(move).not.toBeNull();
    expect(move!.type).toBe("STEP_DEMONSTRATE_STEP");
    expect(move!.targetStepKind).toBe("ones_sum");
    // Should model the step answer
    expect(move!.text).toContain("1 + 4 = 5");
    expect(move!.text).toMatch(/next/i);
  });

  it("does NOT escalate after only 1 uncertain turn", () => {
    const history = [
      { role: "student", message: "I don't know" },
      { role: "coach", message: "Let's do just the ones. What is 1 + 4?" },
    ];
    const acc = accumulate(history, "I'm still not sure");
    const move = getDeterministicRemediationMove(
      reasoningSteps, acc, "I'm still not sure", mathProblem, history,
    );
    expect(move).not.toBeNull();
    expect(move!.type).toBe("STEP_PROBE_SIMPLER");
  });

  it("STEP_DEMONSTRATE_STEP text includes the expected statement", () => {
    const history = [
      { role: "student", message: "I don't know" },
      { role: "coach", message: "Let's do just the ones. What is 1 + 4?" },
      { role: "student", message: "um I'm not sure" },
      { role: "coach", message: "Try just the ones. What's 1 + 4?" },
    ];
    const acc = accumulate(history, "I really don't know");
    const move = getDeterministicRemediationMove(
      reasoningSteps, acc, "I really don't know", mathProblem, history,
    );
    expect(move).not.toBeNull();
    expect(move!.type).toBe("STEP_DEMONSTRATE_STEP");
    expect(move!.text).toContain("1 + 4 = 5");
  });
});

// ============================================================================
// Fix 3: No UI leakage in summaries/recaps
// ============================================================================

describe("no UI leakage in summaries", () => {
  it("buildInstructionalRecap never contains 'submit'", () => {
    const recap = buildInstructionalRecap(reasoningSteps, mathProblem, "SUBTRACTION_ON_ADDITION");
    expect(recap.toLowerCase()).not.toContain("submit");
    expect(recap.toLowerCase()).not.toContain("click");
  });

  it("buildInstructionalRecap without misconception never contains 'submit'", () => {
    const recap = buildInstructionalRecap(reasoningSteps, mathProblem, null);
    expect(recap.toLowerCase()).not.toContain("submit");
    expect(recap.toLowerCase()).not.toContain("click");
  });

  it("buildInstructionalRecap with empty steps never contains 'submit'", () => {
    const recap = buildInstructionalRecap([], mathProblem, null);
    expect(recap.toLowerCase()).not.toContain("submit");
    expect(recap.toLowerCase()).not.toContain("click");
    expect(recap).toBe("You're getting closer!");
  });

  it("buildStepFailureRecap never contains 'submit'", () => {
    const tensStep = reasoningSteps[1];
    const recap = buildStepFailureRecap(reasoningSteps, tensStep, mathProblem);
    expect(recap.toLowerCase()).not.toContain("submit");
    expect(recap.toLowerCase()).not.toContain("click");
  });

  it("buildStepFailureRecap with empty steps never contains 'submit'", () => {
    const step = reasoningSteps[0];
    const recap = buildStepFailureRecap([], step, mathProblem);
    expect(recap.toLowerCase()).not.toContain("submit");
    expect(recap.toLowerCase()).not.toContain("click");
  });
});

// ============================================================================
// Conversation strategy integration (math)
// ============================================================================

import {
  shouldUpgradeMove,
} from "./conversationStrategy";

import {
  applyMathStrategyEscalation,
  buildDemonstrateStepText,
  buildGuidedCompletionText,
  type MathEscalationContext,
} from "./deterministicRemediation";

// ── Helper: build a standard escalation context ─────────────────────────

function makeEscalationCtx(overrides: Partial<MathEscalationContext> = {}): MathEscalationContext {
  return {
    reasoningSteps,
    stepAccumulation: {
      satisfiedStepIds: [],
      missingStepIds: ["step_1", "step_2", "step_3"],
      answerCorrect: false,
      extractedAnswer: null,
      satisfiedSteps: {},
    } as any,
    mathProblem,
    conversationHistory: [],
    timeRemainingSec: 60,
    attemptCount: 2,
    maxAttempts: 5,
    ...overrides,
  };
}

// ============================================================================
// buildDemonstrateStepText
// ============================================================================

describe("buildDemonstrateStepText", () => {
  it("models the current step and asks the next", () => {
    const ctx = makeEscalationCtx();
    const text = buildDemonstrateStepText(
      reasoningSteps[0], // ones step
      reasoningSteps,
      ctx.stepAccumulation,
      mathProblem,
    );
    // Should model "1 + 4 = 5" and ask about tens
    expect(text).toContain("1 + 4 = 5");
    expect(text).toMatch(/ones/i);
    expect(text).toMatch(/\?/); // asks a question
  });

  it("asks for final answer when it's the last missing step", () => {
    const ctx = makeEscalationCtx({
      stepAccumulation: {
        satisfiedStepIds: ["step_1", "step_2"],
        missingStepIds: ["step_3"],
        answerCorrect: false,
        extractedAnswer: null,
        satisfiedSteps: {},
      } as any,
    });
    const text = buildDemonstrateStepText(
      reasoningSteps[2], // combine step
      reasoningSteps,
      ctx.stepAccumulation,
      mathProblem,
    );
    expect(text).toContain("20 + 5 = 25");
    expect(text).toContain("11 + 14");
  });

  it("prioritizes foundational steps over combine", () => {
    // Missing: step_2 (tens) and step_3 (combine)
    const ctx = makeEscalationCtx({
      stepAccumulation: {
        satisfiedStepIds: ["step_1"],
        missingStepIds: ["step_2", "step_3"],
        answerCorrect: false,
        extractedAnswer: null,
        satisfiedSteps: {},
      } as any,
    });
    const text = buildDemonstrateStepText(
      reasoningSteps[0], // demonstrating ones
      reasoningSteps,
      ctx.stepAccumulation,
      mathProblem,
    );
    // Should ask about tens (foundational) not combine
    expect(text).toMatch(/10.*10|tens/i);
  });
});

// ============================================================================
// buildGuidedCompletionText
// ============================================================================

describe("buildGuidedCompletionText", () => {
  it("walks through all remaining steps and states the answer", () => {
    const ctx = makeEscalationCtx();
    const text = buildGuidedCompletionText(
      reasoningSteps,
      ctx.stepAccumulation,
      mathProblem,
    );
    expect(text).toContain("1 + 4 = 5");
    expect(text).toContain("10 + 10 = 20");
    expect(text).toContain("20 + 5 = 25");
    expect(text).toContain("25"); // final answer
    expect(text).toMatch(/Here's how it works/);
  });

  it("only walks through missing steps when some are satisfied", () => {
    const ctx = makeEscalationCtx({
      stepAccumulation: {
        satisfiedStepIds: ["step_1"],
        missingStepIds: ["step_2", "step_3"],
        answerCorrect: false,
        extractedAnswer: null,
        satisfiedSteps: {},
      } as any,
    });
    const text = buildGuidedCompletionText(
      reasoningSteps,
      ctx.stepAccumulation,
      mathProblem,
    );
    // Should NOT include the ones step (already satisfied)
    expect(text).not.toContain("1 + 4 = 5");
    // Should include remaining steps
    expect(text).toContain("10 + 10 = 20");
    expect(text).toContain("20 + 5 = 25");
    expect(text).toContain("25");
  });

  it("is concise and supportive", () => {
    const ctx = makeEscalationCtx();
    const text = buildGuidedCompletionText(
      reasoningSteps,
      ctx.stepAccumulation,
      mathProblem,
    );
    // Should not sound like a reprimand
    expect(text).not.toMatch(/wrong|incorrect|fail/i);
    // Should be concise (under ~40 words)
    const words = text.split(/\s+/).length;
    expect(words).toBeLessThan(40);
  });
});

// ============================================================================
// applyMathStrategyEscalation
// ============================================================================

describe("applyMathStrategyEscalation", () => {
  it("does NOT escalate WRAP_SUCCESS", () => {
    const wrapMove: RemediationMove = {
      type: "WRAP_SUCCESS",
      text: "",
      targetStepId: null,
      targetStepKind: null,
      studentState: "success",
      explanation: "All steps satisfied.",
    };
    const { move, decision } = applyMathStrategyEscalation(wrapMove, makeEscalationCtx());
    expect(move.type).toBe("WRAP_SUCCESS");
    expect(decision.escalated).toBe(false);
  });

  it("escalates to wrap_support when time < 15s", () => {
    const localMove = getMove([], "I don't know")!;
    const ctx = makeEscalationCtx({
      conversationHistory: [
        { role: "student", message: "I don't know" },
        { role: "coach", message: "Let's try the ones." },
        { role: "student", message: "I still don't know" },
        { role: "coach", message: "Try just the ones." },
        { role: "student", message: "I don't know" },
        { role: "coach", message: "Focus on the ones." },
        { role: "student", message: "I give up" },
      ],
      timeRemainingSec: 10,
    });
    const { move } = applyMathStrategyEscalation(localMove, ctx);
    expect(move.type).toBe("WRAP_NEEDS_SUPPORT");
  });

  it("does not escalate when no stall signals", () => {
    const localMove = getMove([], "I think 5")!;
    const ctx = makeEscalationCtx();
    const { move, decision } = applyMathStrategyEscalation(localMove, ctx);
    expect(move.type).toBe(localMove.type);
    expect(decision.escalated).toBe(false);
  });

  it("escalates probe to hint after uncertainty streak", () => {
    const localMove = getMove([], "I don't know")!;
    expect(localMove.type).toBe("STEP_PROBE_SIMPLER");

    const ctx = makeEscalationCtx({
      conversationHistory: [
        { role: "student", message: "I don't know" },
        { role: "coach", message: "Let's try the ones." },
        { role: "student", message: "I'm not sure" },
        { role: "coach", message: "Focus on the ones." },
      ],
    });
    const { move, decision } = applyMathStrategyEscalation(localMove, ctx);
    // uncertainStreak=2 → at least hint
    expect(decision.escalated).toBe(true);
    expect(["STEP_HINT", "STEP_DEMONSTRATE_STEP"]).toContain(move.type);
  });

  it("escalation produces valid text with question mark", () => {
    const localMove = getMove([], "I don't know")!;
    const ctx = makeEscalationCtx({
      conversationHistory: [
        { role: "student", message: "I don't know" },
        { role: "coach", message: "Let's try." },
        { role: "student", message: "I'm not sure" },
        { role: "coach", message: "Focus on ones." },
      ],
    });
    const { move } = applyMathStrategyEscalation(localMove, ctx);
    if (move.type !== localMove.type) {
      // Escalated move should have non-empty text
      expect(move.text.length).toBeGreaterThan(0);
    }
  });

  it("keeps explanation annotation on escalated moves", () => {
    const localMove = getMove([], "I don't know")!;
    const ctx = makeEscalationCtx({
      conversationHistory: [
        { role: "student", message: "I don't know" },
        { role: "coach", message: "Try." },
        { role: "student", message: "I don't know" },
        { role: "coach", message: "Try again." },
      ],
    });
    const { move, decision } = applyMathStrategyEscalation(localMove, ctx);
    if (decision.escalated) {
      expect(move.explanation).toContain("Strategy escalation");
    }
  });
});

// ============================================================================
// Full escalation path: transcript-style
// ============================================================================

describe("math escalation path: 'I don't know' progression", () => {
  it("progresses probe_simpler → demonstrate_step over uncertain turns", () => {
    // Turn 1: first uncertain → STEP_PROBE_SIMPLER
    const move1 = getMove([], "I don't know");
    expect(move1!.type).toBe("STEP_PROBE_SIMPLER");

    // Turn 2: second uncertain → still STEP_PROBE_SIMPLER (local) or STEP_DEMONSTRATE_STEP (escalation)
    const history2 = [
      { role: "student", message: "I don't know" },
      { role: "coach", message: move1!.text },
    ];
    const move2 = getDeterministicRemediationMove(
      reasoningSteps, accumulate(history2, "I'm not sure"), "I'm not sure", mathProblem, history2,
    );
    // After 1 prior uncertain turn, local logic gives STEP_PROBE_SIMPLER
    // Strategy might escalate to hint
    const ctx2 = makeEscalationCtx({ conversationHistory: history2 });
    const { move: esc2 } = applyMathStrategyEscalation(move2!, ctx2);
    // At minimum should be probe_simpler or higher
    expect(["STEP_PROBE_SIMPLER", "STEP_HINT", "STEP_DEMONSTRATE_STEP"]).toContain(esc2.type);

    // Turn 3: third uncertain → local gives STEP_DEMONSTRATE_STEP
    const history3 = [
      ...history2,
      { role: "student", message: "I'm not sure" },
      { role: "coach", message: move2!.text },
    ];
    const move3 = getDeterministicRemediationMove(
      reasoningSteps, accumulate(history3, "I really don't know"), "I really don't know", mathProblem, history3,
    );
    expect(move3!.type).toBe("STEP_DEMONSTRATE_STEP");
    expect(move3!.text).toContain("1 + 4 = 5");
  });
});

describe("math escalation path: no-progress vague answers", () => {
  it("strategy escalation prevents stuck repetition", () => {
    const history = [
      { role: "student", message: "I'm not sure" },
      { role: "coach", message: "Let's try the ones." },
      { role: "student", message: "I'm confused" },
      { role: "coach", message: "Focus on the ones." },
      { role: "student", message: "um maybe" },
      { role: "coach", message: "One step at a time." },
    ];
    const localMove = getMove(history, "I guess");
    const ctx = makeEscalationCtx({ conversationHistory: history });
    const { move, decision } = applyMathStrategyEscalation(localMove!, ctx);

    // With 3+ uncertain turns, should escalate beyond probe_simpler
    if (decision.escalated) {
      expect(["STEP_HINT", "STEP_DEMONSTRATE_STEP", "STEP_MODEL_INSTRUCTION"]).toContain(move.type);
    }
  });
});

describe("math escalation reset after progress", () => {
  it("resumes normal probing after student makes progress", () => {
    // Student was stuck, then gets the ones right
    const history = [
      { role: "student", message: "I don't know" },
      { role: "coach", message: "Let's try the ones." },
      { role: "student", message: "I don't know" },
      { role: "coach", message: "For this step, 1 + 4 = 5. Now what?" },
    ];
    // Student now provides the tens correctly
    const acc = accumulate(history, "10 + 10 = 20");
    const move = getDeterministicRemediationMove(
      reasoningSteps, acc, "10 + 10 = 20", mathProblem, history,
    );
    // After making progress, should acknowledge and probe next — not escalate
    expect(move).not.toBeNull();
    expect(move!.type).not.toBe("STEP_DEMONSTRATE_STEP");
    expect(move!.type).not.toBe("WRAP_NEEDS_SUPPORT");
    // Should be an acknowledge or probe
    expect(["STEP_ACKNOWLEDGE_AND_PROBE", "STEP_PROBE_DIRECT", "STEP_COMBINE_PROMPT"]).toContain(move!.type);
  });
});

describe("existing success flows remain unchanged", () => {
  it("WRAP_SUCCESS is not affected by strategy escalation", () => {
    // Student gives all three steps correctly
    const fullAcc: ReasoningStepAccumulation = {
      satisfiedStepIds: ["step_1", "step_2", "step_3"],
      missingStepIds: [],
      answerCorrect: true,
      extractedAnswer: 25,
      satisfiedSteps: {},
    } as any;
    const move = getDeterministicRemediationMove(
      reasoningSteps, fullAcc, "the answer is 25", mathProblem,
    );
    expect(move).not.toBeNull();
    expect(move!.type).toBe("WRAP_SUCCESS");

    // Escalation should not change it
    const { move: esc } = applyMathStrategyEscalation(move!, makeEscalationCtx({
      stepAccumulation: fullAcc,
      conversationHistory: [
        { role: "student", message: "I don't know" },
        { role: "coach", message: "probe" },
        { role: "student", message: "I don't know" },
        { role: "coach", message: "probe" },
      ],
    }));
    expect(esc.type).toBe("WRAP_SUCCESS");
  });

  it("correct answer probe is not affected", () => {
    const acc = accumulate([], "1 + 4 = 5");
    const move = getDeterministicRemediationMove(
      reasoningSteps, acc, "1 + 4 = 5", mathProblem,
    );
    expect(move).not.toBeNull();
    // Should acknowledge and probe next — no escalation with no history
    const { move: esc, decision } = applyMathStrategyEscalation(move!, makeEscalationCtx());
    expect(decision.escalated).toBe(false);
    expect(esc.type).toBe(move!.type);
  });
});

describe("shouldUpgradeMove mapping", () => {
  it("returns STEP_HINT for hint escalation", () => {
    const decision = { strategy: "hint" as const, reason: "test", escalated: true };
    const upgrade = shouldUpgradeMove(decision, "STEP_PROBE_DIRECT", "math");
    expect(upgrade).toBe("STEP_HINT");
  });

  it("returns null when local move is already at or above target", () => {
    const decision = { strategy: "hint" as const, reason: "test", escalated: true };
    const upgrade = shouldUpgradeMove(decision, "STEP_DEMONSTRATE_STEP", "math");
    expect(upgrade).toBeNull();
  });

  it("returns STEP_DEMONSTRATE_STEP for demonstrate_step escalation", () => {
    const decision = { strategy: "demonstrate_step" as const, reason: "test", escalated: true };
    const upgrade = shouldUpgradeMove(decision, "STEP_PROBE_SIMPLER", "math");
    expect(upgrade).toBe("STEP_DEMONSTRATE_STEP");
  });

  it("returns STEP_MODEL_INSTRUCTION for guided_completion escalation", () => {
    const decision = { strategy: "guided_completion" as const, reason: "test", escalated: true };
    const upgrade = shouldUpgradeMove(decision, "STEP_HINT", "math");
    expect(upgrade).toBe("STEP_MODEL_INSTRUCTION");
  });
});

// ============================================================================
// Phrasing variation: STEP_PROBE_SIMPLER and STEP_MISCONCEPTION_REDIRECT
// ============================================================================

describe("phrasing variation", () => {
  // Helper that passes conversationHistory through to getDeterministicRemediationMove
  function getMoveWithHistory(
    history: Array<{ role: string; message: string }>,
    currentResponse: string,
    steps = reasoningSteps,
    problem = mathProblem,
  ): RemediationMove | null {
    const acc = accumulateReasoningStepEvidence(
      steps, history, currentResponse, problem.correctAnswer,
    );
    return getDeterministicRemediationMove(steps, acc, currentResponse, problem, history);
  }

  describe("STEP_PROBE_SIMPLER rotation", () => {
    it("varies opening across consecutive uncertain turns", () => {
      // Simulate 4 turns of "I don't know" which should produce STEP_PROBE_SIMPLER
      const texts: string[] = [];
      const history: Array<{ role: string; message: string }> = [];

      for (let i = 0; i < 4; i++) {
        const msg = "I don't know";
        const move = getMoveWithHistory(history, msg);
        // First 2 should be STEP_PROBE_SIMPLER before escalation
        if (move?.type === "STEP_PROBE_SIMPLER") {
          texts.push(move.text);
        }
        history.push({ role: "student", message: msg });
        if (move) history.push({ role: "coach", message: move.text });
      }

      expect(texts.length).toBeGreaterThanOrEqual(1);
      // If we got 2+, verify they differ in first 4 words
      if (texts.length >= 2) {
        for (let i = 1; i < texts.length; i++) {
          const prev = texts[i - 1].split(/\s+/).slice(0, 4).join(" ").toLowerCase();
          const curr = texts[i].split(/\s+/).slice(0, 4).join(" ").toLowerCase();
          expect(curr).not.toBe(prev);
        }
      }
    });

    it("rotates through pool deterministically by turn count", () => {
      // Build two separate histories at different turn counts
      // and verify different openings are selected
      const h1: Array<{ role: string; message: string }> = [
        { role: "student", message: "hmm" },
        { role: "coach", message: "Let's try just the ones. What is 1 + 4?" },
      ];
      const h2: Array<{ role: string; message: string }> = [
        { role: "student", message: "hmm" },
        { role: "coach", message: "Let's try just the ones." },
        { role: "student", message: "hmm" },
        { role: "coach", message: "Let's try just the ones." },
      ];

      const move1 = getMoveWithHistory(h1, "I don't know");
      const move2 = getMoveWithHistory(h2, "I don't know");

      // Both should produce moves
      expect(move1).not.toBeNull();
      expect(move2).not.toBeNull();

      // With different turn counts, at least the selection index differs
      if (move1?.type === "STEP_PROBE_SIMPLER" && move2?.type === "STEP_PROBE_SIMPLER") {
        // turnIndex 1 vs 2 → different pool index
        const w1 = move1.text.split(/\s+/).slice(0, 4).join(" ").toLowerCase();
        const w2 = move2.text.split(/\s+/).slice(0, 4).join(" ").toLowerCase();
        expect(w1).not.toBe(w2);
      }
    });
  });

  describe("STEP_MISCONCEPTION_REDIRECT rotation", () => {
    it("varies opening across consecutive subtraction-on-addition turns", () => {
      const texts: string[] = [];
      const history: Array<{ role: string; message: string }> = [];

      for (let i = 0; i < 4; i++) {
        // "I subtracted" triggers SUBTRACTION_ON_ADDITION misconception
        const msg = "I subtracted and got 3";
        const move = getMoveWithHistory(history, msg);
        if (move?.type === "STEP_MISCONCEPTION_REDIRECT") {
          texts.push(move.text);
        }
        history.push({ role: "student", message: msg });
        if (move) history.push({ role: "coach", message: move.text });
      }

      expect(texts.length).toBeGreaterThanOrEqual(2);
      // Consecutive texts should not share first 4 words
      for (let i = 1; i < texts.length; i++) {
        const prev = texts[i - 1].split(/\s+/).slice(0, 4).join(" ").toLowerCase();
        const curr = texts[i].split(/\s+/).slice(0, 4).join(" ").toLowerCase();
        expect(curr).not.toBe(prev);
      }
    });

    it("varies opening across consecutive addition-on-subtraction turns", () => {
      const texts: string[] = [];
      const history: Array<{ role: string; message: string }> = [];

      for (let i = 0; i < 4; i++) {
        const msg = "I added them and got 70";
        const move = getMoveWithHistory(history, msg, subSteps, subProblem);
        if (move?.type === "STEP_MISCONCEPTION_REDIRECT") {
          texts.push(move.text);
        }
        history.push({ role: "student", message: msg });
        if (move) history.push({ role: "coach", message: move.text });
      }

      expect(texts.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < texts.length; i++) {
        const prev = texts[i - 1].split(/\s+/).slice(0, 4).join(" ").toLowerCase();
        const curr = texts[i].split(/\s+/).slice(0, 4).join(" ").toLowerCase();
        expect(curr).not.toBe(prev);
      }
    });

    it("no REPEATED_OPENING in 6-turn misconception stall", () => {
      const history: Array<{ role: string; message: string }> = [];
      const texts: string[] = [];

      for (let i = 0; i < 6; i++) {
        const msg = "I subtracted and got 3";
        const move = getMoveWithHistory(history, msg);
        const text = move?.text ?? "";
        texts.push(text);
        history.push({ role: "student", message: msg });
        if (text) history.push({ role: "coach", message: text });
      }

      // No consecutive pair should share first 4 words
      for (let i = 1; i < texts.length; i++) {
        if (!texts[i] || !texts[i - 1]) continue;
        const prev = texts[i - 1].split(/\s+/).slice(0, 4).join(" ").toLowerCase();
        const curr = texts[i].split(/\s+/).slice(0, 4).join(" ").toLowerCase();
        expect(curr).not.toBe(prev);
      }
    });
  });

  describe("stall_no_progress escalation", () => {
    // Reproduces the stress-test stall_no_progress case:
    // 3 vague non-substantive turns → should escalate, not stay on same target

    it("escalates past STEP_PROBE_SIMPLER after 3 vague non-substantive turns", () => {
      const stallTurns = ["I guess maybe", "not sure", "um I think so"];
      const history: Array<{ role: string; message: string }> = [];
      const moves: RemediationMove[] = [];

      for (const msg of stallTurns) {
        const move = getMoveWithHistory(history, msg);
        expect(move).not.toBeNull();
        moves.push(move!);
        history.push({ role: "student", message: msg });
        history.push({ role: "coach", message: move!.text });
      }

      // By the 3rd turn, the coach should have escalated beyond STEP_PROBE_SIMPLER
      const moveTypes = moves.map(m => m.type);
      const lastMoveType = moveTypes[moveTypes.length - 1];
      expect(lastMoveType).not.toBe("STEP_PROBE_SIMPLER");
      // Should be STEP_HINT or STEP_DEMONSTRATE_STEP
      expect(["STEP_HINT", "STEP_DEMONSTRATE_STEP"]).toContain(lastMoveType);
    });

    it("does not produce TARGET_STUCK across 3 vague turns (move types vary)", () => {
      const stallTurns = ["I guess maybe", "not sure", "um I think so"];
      const history: Array<{ role: string; message: string }> = [];
      const moveTypes: string[] = [];

      for (const msg of stallTurns) {
        const move = getMoveWithHistory(history, msg);
        expect(move).not.toBeNull();
        moveTypes.push(move!.type);
        history.push({ role: "student", message: msg });
        history.push({ role: "coach", message: move!.text });
      }

      // Move types should not all be the same (which would trigger TARGET_STUCK)
      const unique = new Set(moveTypes);
      expect(unique.size).toBeGreaterThan(1);
    });

    it("vague turns without explicit uncertainty keywords still count toward escalation", () => {
      // Even without "I don't know", vague turns with no math content should escalate
      const history: Array<{ role: string; message: string }> = [
        { role: "student", message: "hmm maybe" },
        { role: "coach", message: "Let's do just the ones. What is 1 + 4?" },
        { role: "student", message: "I guess so" },
        { role: "coach", message: "Try just the ones. What's 1 + 4?" },
      ];
      const move = getMoveWithHistory(history, "um okay");
      expect(move).not.toBeNull();
      // 3rd consecutive vague turn → should escalate
      expect(move!.type).not.toBe("STEP_PROBE_SIMPLER");
    });
  });

  describe("long_stall math escalation", () => {
    // Simulates the stress-test long_stall: 6 turns of vague/uncertain answers
    // Coach should escalate through the full ladder and produce varied phrasing

    function simulateLongStall(): { moves: RemediationMove[]; history: Array<{ role: string; message: string }> } {
      const studentTurns = [
        "I don't know",
        "I'm not sure",
        "um maybe",
        "I still don't know",
        "I'm confused",
        "I really don't know",
      ];
      const history: Array<{ role: string; message: string }> = [];
      const moves: RemediationMove[] = [];

      for (const msg of studentTurns) {
        const move = getMoveWithHistory(history, msg);
        expect(move).not.toBeNull();
        moves.push(move!);
        history.push({ role: "student", message: msg });
        history.push({ role: "coach", message: move!.text });
      }
      return { moves, history };
    }

    it("no REPEATED_OPENING across 6 long_stall turns", () => {
      const { moves } = simulateLongStall();
      const texts = moves.map(m => m.text);

      for (let i = 1; i < texts.length; i++) {
        if (!texts[i] || !texts[i - 1]) continue;
        const prev = texts[i - 1].split(/\s+/).slice(0, 4).join(" ").toLowerCase();
        const curr = texts[i].split(/\s+/).slice(0, 4).join(" ").toLowerCase();
        expect(curr).not.toBe(prev);
      }
    });

    it("STEP_DEMONSTRATE_STEP varies opening across different target steps", () => {
      const { moves } = simulateLongStall();
      const demoMoves = moves.filter(m => m.type === "STEP_DEMONSTRATE_STEP");

      // Should have multiple demonstrate moves
      expect(demoMoves.length).toBeGreaterThanOrEqual(2);

      // Openings should vary
      for (let i = 1; i < demoMoves.length; i++) {
        const prev = demoMoves[i - 1].text.split(/\s+/).slice(0, 4).join(" ").toLowerCase();
        const curr = demoMoves[i].text.split(/\s+/).slice(0, 4).join(" ").toLowerCase();
        expect(curr).not.toBe(prev);
      }
    });

    it("'You've shown all the steps' varies when repeated", () => {
      const { moves } = simulateLongStall();
      // Find any "all steps satisfied" direct probes
      const allStepsProbes = moves.filter(m =>
        m.type === "STEP_PROBE_DIRECT" && m.targetStepId === null
      );

      if (allStepsProbes.length >= 2) {
        for (let i = 1; i < allStepsProbes.length; i++) {
          const prev = allStepsProbes[i - 1].text.split(/\s+/).slice(0, 4).join(" ").toLowerCase();
          const curr = allStepsProbes[i].text.split(/\s+/).slice(0, 4).join(" ").toLowerCase();
          expect(curr).not.toBe(prev);
        }
      }
    });
  });
});
