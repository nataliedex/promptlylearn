/**
 * Deterministic math problem generation.
 *
 * Pure functions that produce math problems with known correct answers,
 * strategy tags, and common wrong answers. No LLM calls.
 * The LLM is used separately for wording, hints, and rubric language.
 */

import { MathProblem, MathProblemSkill, CommonWrongAnswer } from "./mathProblem";
import { GradeBand } from "./blueprints";
import type { Prompt, ReasoningStep, ReasoningStepKind } from "./prompt";

// ============================================================================
// Configuration — operand ranges per skill per grade band
// ============================================================================

interface SkillConfig {
  aRange: [number, number];
  bRange?: [number, number];
}

const SKILL_CONFIG: Record<MathProblemSkill, Partial<Record<GradeBand, SkillConfig>>> = {
  two_digit_addition: {
    "K-2": { aRange: [10, 49], bRange: [10, 49] },
    "3-4": { aRange: [10, 99], bRange: [10, 99] },
    "5-6": { aRange: [100, 999], bRange: [100, 999] },
  },
  two_digit_subtraction: {
    "K-2": { aRange: [20, 50], bRange: [10, 30] },
    "3-4": { aRange: [30, 99], bRange: [10, 50] },
    "5-6": { aRange: [100, 999], bRange: [10, 500] },
  },
  basic_multiplication: {
    "K-2": { aRange: [2, 5], bRange: [1, 5] },
    "3-4": { aRange: [2, 9], bRange: [2, 12] },
    "5-6": { aRange: [2, 12], bRange: [10, 99] },
  },
  place_value: {
    "K-2": { aRange: [10, 99] },
    "3-4": { aRange: [100, 999] },
    "5-6": { aRange: [1000, 9999] },
  },
};

// ============================================================================
// Random helpers
// ============================================================================

/** Random integer in [min, max] inclusive. */
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ============================================================================
// Shared computation helpers (used by both generators and rebuild)
// ============================================================================

/** Compute addition-specific derived fields from operands. */
function computeAdditionMeta(a: number, b: number): Pick<MathProblem, "requiresRegrouping" | "expectedStrategyTags" | "commonWrongAnswers"> {
  const correctAnswer = a + b;
  const onesSum = (a % 10) + (b % 10);
  const requiresRegrouping = onesSum >= 10;
  const expectedStrategyTags = requiresRegrouping
    ? ["add ones", "carry", "add tens"]
    : ["add ones", "add tens"];
  const commonWrongAnswers: CommonWrongAnswer[] = [];
  if (requiresRegrouping) {
    const wrongNoCarry =
      (Math.floor(a / 10) + Math.floor(b / 10)) * 10 + (onesSum % 10);
    if (wrongNoCarry !== correctAnswer) {
      commonWrongAnswers.push({ answer: wrongNoCarry, misconception: "forgot to carry" });
    }
  }
  return { requiresRegrouping, expectedStrategyTags, commonWrongAnswers: commonWrongAnswers.length > 0 ? commonWrongAnswers : undefined };
}

/** Compute subtraction-specific derived fields from operands. */
function computeSubtractionMeta(a: number, b: number): Pick<MathProblem, "requiresRegrouping" | "expectedStrategyTags" | "commonWrongAnswers"> {
  const correctAnswer = a - b;
  const requiresRegrouping = (a % 10) < (b % 10);
  const expectedStrategyTags = requiresRegrouping
    ? ["check ones", "borrow from tens", "subtract ones", "subtract tens"]
    : ["subtract ones", "subtract tens"];
  const commonWrongAnswers: CommonWrongAnswer[] = [];
  if (requiresRegrouping) {
    const wrongReversed =
      (Math.floor(a / 10) - Math.floor(b / 10)) * 10 +
      Math.abs((a % 10) - (b % 10));
    if (wrongReversed !== correctAnswer) {
      commonWrongAnswers.push({
        answer: wrongReversed,
        misconception: "subtracted smaller digit from larger in ones place instead of borrowing",
      });
    }
  }
  return { requiresRegrouping, expectedStrategyTags, commonWrongAnswers: commonWrongAnswers.length > 0 ? commonWrongAnswers : undefined };
}

// ============================================================================
// Per-skill generators
// ============================================================================

function getConfig(skill: MathProblemSkill, gradeBand: GradeBand): SkillConfig {
  return SKILL_CONFIG[skill][gradeBand] || SKILL_CONFIG[skill]["K-2"]!;
}

function generateAddition(gradeBand: GradeBand): MathProblem {
  const config = getConfig("two_digit_addition", gradeBand);
  const a = randInt(config.aRange[0], config.aRange[1]);
  const b = randInt(config.bRange![0], config.bRange![1]);
  const meta = computeAdditionMeta(a, b);
  return {
    skill: "two_digit_addition",
    a, b,
    expression: `${a} + ${b}`,
    correctAnswer: a + b,
    ...meta,
  };
}

function generateSubtraction(gradeBand: GradeBand): MathProblem {
  const config = getConfig("two_digit_subtraction", gradeBand);
  let a = randInt(config.aRange[0], config.aRange[1]);
  let b = randInt(config.bRange![0], config.bRange![1]);
  if (a <= b) {
    [a, b] = [Math.max(a, b) + 1, Math.min(a, b)];
  }
  const meta = computeSubtractionMeta(a, b);
  return {
    skill: "two_digit_subtraction",
    a, b,
    expression: `${a} - ${b}`,
    correctAnswer: a - b,
    ...meta,
  };
}

function generateMultiplication(gradeBand: GradeBand): MathProblem {
  const config = getConfig("basic_multiplication", gradeBand);
  const a = randInt(config.aRange[0], config.aRange[1]);
  const b = randInt(config.bRange![0], config.bRange![1]);

  return {
    skill: "basic_multiplication",
    a,
    b,
    expression: `${a} × ${b}`,
    correctAnswer: a * b,
    requiresRegrouping: false,
    expectedStrategyTags: ["multiply", "skip count", "groups of"],
  };
}

function generatePlaceValue(gradeBand: GradeBand): MathProblem {
  const config = getConfig("place_value", gradeBand);
  const a = randInt(config.aRange[0], config.aRange[1]);

  const digits = String(a).split("").reverse();
  const places: Array<"ones" | "tens" | "hundreds"> = ["ones", "tens", "hundreds"];
  // Pick a random place that exists in the number
  const availablePlaces = places.slice(0, digits.length);
  const targetPlace = availablePlaces[randInt(0, availablePlaces.length - 1)];
  const placeIndex = places.indexOf(targetPlace);
  const correctAnswer = parseInt(digits[placeIndex], 10);

  return {
    skill: "place_value",
    a,
    expression: String(a),
    correctAnswer,
    requiresRegrouping: false,
    expectedStrategyTags: ["identify digit", `name ${targetPlace} place`],
    targetPlace,
  };
}

// ============================================================================
// Public API
// ============================================================================

const GENERATORS: Record<MathProblemSkill, (gradeBand: GradeBand) => MathProblem> = {
  two_digit_addition: generateAddition,
  two_digit_subtraction: generateSubtraction,
  basic_multiplication: generateMultiplication,
  place_value: generatePlaceValue,
};

/**
 * Generate a single deterministic math problem for the given skill and grade band.
 */
export function generateMathProblem(skill: MathProblemSkill, gradeBand: GradeBand): MathProblem {
  const generator = GENERATORS[skill];
  if (!generator) {
    throw new Error(`Unknown math problem skill: ${skill}`);
  }
  return generator(gradeBand);
}

/**
 * Generate N unique math problems for a given skill.
 * Problems are unique by expression (no duplicate a,b pairs).
 */
export function generateMathProblemSet(
  skill: MathProblemSkill,
  gradeBand: GradeBand,
  count: number,
): MathProblem[] {
  const seen = new Set<string>();
  const problems: MathProblem[] = [];
  let attempts = 0;
  const maxAttempts = count * 20;

  while (problems.length < count && attempts < maxAttempts) {
    const problem = generateMathProblem(skill, gradeBand);
    if (!seen.has(problem.expression)) {
      seen.add(problem.expression);
      problems.push(problem);
    }
    attempts++;
  }

  return problems;
}

/**
 * Detect math skill from a topic string.
 * Returns null if the topic doesn't map to a supported deterministic skill.
 */
export function detectMathSkill(topic: string): MathProblemSkill | null {
  const lower = topic.toLowerCase();
  if (/addition|adding|add\b|sum|plus/.test(lower)) return "two_digit_addition";
  if (/subtraction|subtracting|subtract|minus|difference/.test(lower)) return "two_digit_subtraction";
  if (/multiplication|multiplying|multiply|times|product|groups?\s+of/.test(lower)) return "basic_multiplication";
  if (/place\s*value|ones?\s+(?:and|or)\s+tens|digit/.test(lower)) return "place_value";
  return null;
}

// ============================================================================
// Expression parsing & math prompt consistency
// ============================================================================

export interface ParsedExpression {
  a: number;
  b: number;
  operation: "+" | "-" | "×";
  expression: string;
  correctAnswer: number;
}

/**
 * Parse an arithmetic expression from prompt text.
 * Handles: "27 + 36", "49 - 27", "5 × 3", "5 x 3", "5 * 3"
 * Returns null if no expression found.
 */
export function parseExpressionFromText(text: string): ParsedExpression | null {
  const match = text.match(/(\d+)\s*([+\-×x*÷/])\s*(\d+)/);
  if (!match) return null;

  const a = parseInt(match[1], 10);
  const rawOp = match[2];
  const b = parseInt(match[3], 10);

  let operation: "+" | "-" | "×";
  let correctAnswer: number;
  let expression: string;

  switch (rawOp) {
    case "+":
      operation = "+";
      correctAnswer = a + b;
      expression = `${a} + ${b}`;
      break;
    case "-":
      operation = "-";
      correctAnswer = a - b;
      expression = `${a} - ${b}`;
      break;
    case "×": case "x": case "*":
      operation = "×";
      correctAnswer = a * b;
      expression = `${a} × ${b}`;
      break;
    case "÷": case "/":
      // Treat division as unsupported for rebuild (no "division" skill exists yet)
      return null;
    default:
      return null;
  }

  return { a, b, operation, expression, correctAnswer };
}

/**
 * Rebuild a MathProblem from a parsed expression, preserving the skill.
 * Recomputes ALL derived fields: correctAnswer, requiresRegrouping,
 * expectedStrategyTags, commonWrongAnswers.
 * Returns null if the expression doesn't match the skill's operation.
 */
export function rebuildMathProblemFromExpression(
  parsed: ParsedExpression,
  existingSkill: MathProblemSkill,
): MathProblem | null {
  const { a, b, operation, expression, correctAnswer } = parsed;

  // Validate operation matches skill
  const skillOpMap: Record<MathProblemSkill, string> = {
    two_digit_addition: "+",
    two_digit_subtraction: "-",
    basic_multiplication: "×",
    place_value: "", // place_value has no two-operand expression
  };
  if (existingSkill === "place_value") return null;
  if (skillOpMap[existingSkill] !== operation) return null;

  if (existingSkill === "two_digit_addition") {
    const meta = computeAdditionMeta(a, b);
    return { skill: existingSkill, a, b, expression, correctAnswer, ...meta };
  }

  if (existingSkill === "two_digit_subtraction") {
    const meta = computeSubtractionMeta(a, b);
    return { skill: existingSkill, a, b, expression, correctAnswer, ...meta };
  }

  if (existingSkill === "basic_multiplication") {
    return {
      skill: existingSkill, a, b, expression, correctAnswer,
      requiresRegrouping: false,
      expectedStrategyTags: ["multiply", "skip count", "groups of"],
    };
  }

  return null;
}

/**
 * Build place-value referenceFacts for a pair of operands.
 * E.g., for a=27, b=36: { "27": ["7 ones", "2 tens"], "36": ["6 ones", "3 tens"] }
 */
export function buildMathReferenceFacts(a: number, b: number): Record<string, string[]> {
  const facts: Record<string, string[]> = {};
  for (const num of [a, b]) {
    const digits = String(num).split("").reverse();
    const places = ["ones", "tens", "hundreds", "thousands"];
    facts[String(num)] = digits.map((d, i) => `${d} ${places[i]}`);
  }
  return facts;
}

/**
 * Validate that a prompt's visible text, filledSlots, and mathProblem are consistent.
 * Returns errors describing any inconsistencies found.
 */
export function validateMathPromptConsistency(prompt: {
  input: string;
  filledSlots?: Record<string, string>;
  mathProblem?: MathProblem;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!prompt.mathProblem) return { valid: true, errors };

  const parsed = parseExpressionFromText(prompt.input);
  if (!parsed) {
    errors.push("No arithmetic expression found in prompt text");
    return { valid: false, errors };
  }

  // Check expression matches
  if (parsed.expression !== prompt.mathProblem.expression) {
    errors.push(
      `prompt.input expression "${parsed.expression}" != mathProblem.expression "${prompt.mathProblem.expression}"`
    );
  }

  // Check filledSlots
  if (prompt.filledSlots?.expression && prompt.filledSlots.expression !== parsed.expression) {
    errors.push(
      `filledSlots.expression "${prompt.filledSlots.expression}" != parsed expression "${parsed.expression}"`
    );
  }

  // Check correctAnswer
  if (prompt.mathProblem.correctAnswer !== parsed.correctAnswer) {
    errors.push(
      `mathProblem.correctAnswer ${prompt.mathProblem.correctAnswer} != computed ${parsed.correctAnswer}`
    );
  }

  return { valid: errors.length === 0, errors };
}

// ============================================================================
// Deterministic math prompt metadata builders
// ============================================================================

/**
 * Build operand-specific hints for a math problem.
 */
export function buildMathHints(problem: MathProblem): string[] {
  if (problem.skill === "two_digit_addition" && problem.b !== undefined) {
    const onesA = problem.a % 10;
    const onesB = problem.b % 10;
    if (problem.requiresRegrouping) {
      return [
        `Start with the ones place: what is ${onesA} + ${onesB}?`,
        `When the ones add up to 10 or more, remember to carry to the tens.`,
      ];
    }
    return [
      `Start with the ones place: what is ${onesA} + ${onesB}?`,
      `Then add the tens place digits.`,
    ];
  }
  if (problem.skill === "two_digit_subtraction" && problem.b !== undefined) {
    const onesA = problem.a % 10;
    const onesB = problem.b % 10;
    if (problem.requiresRegrouping) {
      return [
        `Look at the ones: is ${onesA} big enough to subtract ${onesB}?`,
        `If not, you'll need to borrow from the tens.`,
      ];
    }
    return [
      `Start with the ones: what is ${onesA} - ${onesB}?`,
      `Then subtract the tens.`,
    ];
  }
  if (problem.skill === "basic_multiplication" && problem.b !== undefined) {
    return [
      `Think of ${problem.a} groups of ${problem.b}.`,
      `Try skip counting by ${problem.b}: ${problem.b}, ${problem.b * 2}, ${problem.b * 3}...`,
    ];
  }
  return [
    "Look at each part of the problem carefully.",
    problem.requiresRegrouping ? "Remember to check if you need to regroup." : "Start with what you know.",
  ];
}

/**
 * Build operand-specific allowed probes for coaching follow-ups.
 */
export function buildMathAllowedProbes(problem: MathProblem): string[] {
  if (problem.skill === "two_digit_addition" && problem.b !== undefined) {
    const onesA = problem.a % 10;
    const onesB = problem.b % 10;
    const onesSum = onesA + onesB;
    const tensA = Math.floor(problem.a / 10);
    const tensB = Math.floor(problem.b / 10);
    const probes = [`What is ${onesA} + ${onesB}?`];
    if (problem.requiresRegrouping) {
      probes.push(`What do you do when ${onesA} + ${onesB} makes ${onesSum}?`);
    }
    probes.push(`What is ${tensA} + ${tensB} in the tens place?`);
    return probes;
  }
  if (problem.skill === "two_digit_subtraction" && problem.b !== undefined) {
    const onesA = problem.a % 10;
    const onesB = problem.b % 10;
    const probes = [`Is ${onesA} big enough to subtract ${onesB}?`];
    if (problem.requiresRegrouping) {
      probes.push(`What do you do when the top ones digit is smaller?`);
    }
    const tensA = Math.floor(problem.a / 10);
    const tensB = Math.floor(problem.b / 10);
    probes.push(`What is ${tensA} - ${tensB} in the tens place?`);
    return probes;
  }
  return [];
}

/**
 * Build operand-specific retry questions for wrong answers.
 */
export function buildMathRetryQuestions(problem: MathProblem): string[] {
  if (problem.skill === "two_digit_addition" && problem.b !== undefined) {
    const onesA = problem.a % 10;
    const onesB = problem.b % 10;
    return [
      `Let's start with the ones. What is ${onesA} + ${onesB}?`,
      `Try adding ${problem.a} and ${problem.b} step by step, starting with the ones place.`,
    ];
  }
  if (problem.skill === "two_digit_subtraction" && problem.b !== undefined) {
    const onesA = problem.a % 10;
    const onesB = problem.b % 10;
    return [
      `Look at the ones place first. Can you take ${onesB} from ${onesA}?`,
      `Try subtracting step by step, starting with the ones.`,
    ];
  }
  if (problem.skill === "basic_multiplication" && problem.b !== undefined) {
    return [
      `Can you skip count by ${problem.b}?`,
      `How many groups of ${problem.b} make ${problem.a} × ${problem.b}?`,
    ];
  }
  return [];
}

/**
 * Build a complete, deterministic rubric for a math problem.
 * No LLM needed — all fields are derived from the problem's operands and skill.
 * Produces the universal rubric template with problem-specific numbers.
 */
/** Full deterministic rubric output including structured reasoning steps. */
export interface DeterministicMathRubric {
  learningObjective: string;
  expectedReasoningSteps: string[];
  reasoningSteps: ReasoningStep[];
  expectedConcepts: string[];
  successCriteria: string[];
  misconceptions: string[];
  scoringLevels: { strong: string; developing: string; needsSupport: string };
  allowedProbes: string[];
  retryQuestions: string[];
  referenceFacts: Record<string, string[]>;
  requiredExamples: string;
  validVocabulary: string[];
}

export function buildDeterministicMathRubric(problem: MathProblem): DeterministicMathRubric {
  if (problem.skill === "two_digit_addition" && problem.b !== undefined) {
    return buildAdditionRubric(problem.a, problem.b, problem);
  }
  if (problem.skill === "two_digit_subtraction" && problem.b !== undefined) {
    return buildSubtractionRubric(problem.a, problem.b, problem);
  }
  if (problem.skill === "basic_multiplication" && problem.b !== undefined) {
    return buildMultiplicationRubric(problem.a, problem.b, problem);
  }
  if (problem.skill === "place_value") {
    return buildPlaceValueRubric(problem);
  }
  // Fallback for unknown skills
  return buildGenericMathRubric(problem);
}

function buildAdditionRubric(a: number, b: number, problem: MathProblem): DeterministicMathRubric {
  const onesA = a % 10;
  const onesB = b % 10;
  const onesSum = onesA + onesB;
  const tensA = Math.floor(a / 10) * 10;
  const tensB = Math.floor(b / 10) * 10;
  const correct = a + b;
  const regroup = problem.requiresRegrouping;

  // Structured reasoning steps — the machine-facing layer
  const reasoningSteps: ReasoningStep[] = [];
  let stepNum = 0;

  const addStep = (label: string, expected: string[], probe: string, kind: ReasoningStepKind): void => {
    stepNum++;
    reasoningSteps.push({
      id: `step_${stepNum}`,
      label,
      expectedStatements: expected,
      probe,
      kind,
    });
  };

  addStep("Add the ones", [`${onesA} + ${onesB} = ${onesSum}`],
    `What do you get when you add ${onesA} and ${onesB}?`, "ones_sum");

  if (regroup) {
    const onesKept = onesSum % 10;
    const carried = Math.floor(onesSum / 10);
    addStep("Regroup the ones",
      [`${onesSum} ones makes ${carried} ten and ${onesKept} ones`],
      `${onesA} + ${onesB} makes ${onesSum}. What do you do when the ones add up to more than 9?`, "regroup");

    const tensTotal = tensA + tensB + carried * 10;
    addStep("Add the tens including the carried ten",
      [`${tensA} + ${tensB} + ${carried * 10} = ${tensTotal}`],
      `What do you get when you add ${tensA} and ${tensB} plus the extra ten?`, "tens_sum");

    addStep("State the final answer",
      [`${tensTotal} + ${onesKept} = ${correct}`, `The final answer is ${correct}`],
      `What do you get when you combine ${tensTotal} and ${onesKept}?`, "combine");
  } else {
    const tensSum = tensA + tensB;
    addStep("Add the tens", [`${tensA} + ${tensB} = ${tensSum}`],
      `What do you get when you add ${tensA} and ${tensB}?`, "tens_sum");

    addStep("Combine the totals", [`${tensSum} + ${onesSum} = ${correct}`, `The final answer is ${correct}`],
      `What do you get when you combine ${tensSum} and ${onesSum}?`, "combine");
  }

  // Flat string steps (backward-compatible expectedReasoningSteps)
  const flatSteps = reasoningSteps.map(s => `${s.label}: ${s.expectedStatements[0]}`);

  // Teacher-facing fields derived from structured steps
  const concepts: string[] = [
    `${a} is made of ${tensA} and ${onesA}`,
    `${b} is made of ${tensB} and ${onesB}`,
    `${onesA} + ${onesB} = ${onesSum}`,
  ];
  if (regroup) {
    const onesKept = onesSum % 10;
    const carried = Math.floor(onesSum / 10);
    concepts.push(`${onesSum} ones becomes ${carried} ten and ${onesKept} ones`);
    concepts.push(`${tensA} + ${tensB} + ${carried * 10} = ${tensA + tensB + carried * 10}`);
    concepts.push(`${tensA + tensB + carried * 10} + ${onesKept} = ${correct}`);
  } else {
    concepts.push(`${tensA} + ${tensB} = ${tensA + tensB}`);
    concepts.push(`${tensA + tensB} + ${onesSum} = ${correct}`);
  }

  const criteria: string[] = [`States that ${onesA} + ${onesB} = ${onesSum}`];
  if (regroup) {
    const onesKept = onesSum % 10;
    const carried = Math.floor(onesSum / 10);
    criteria.push(`Explains that ${onesSum} ones makes ${carried} ten and ${onesKept} ones`);
    criteria.push(`Explains that the extra ten is added to the tens place`);
    criteria.push(`States that the final answer is ${correct}`);
  } else {
    criteria.push(`States that ${tensA} + ${tensB} = ${tensA + tensB}`);
    criteria.push(`States that ${tensA + tensB} + ${onesSum} = ${correct}`);
    criteria.push(`States that the final answer is ${correct}`);
  }

  // Misconceptions — tied to actual likely wrong outputs
  const misconceptions: string[] = [];
  if (problem.commonWrongAnswers) {
    for (const cw of problem.commonWrongAnswers) {
      misconceptions.push(`Says ${cw.answer} because ${cw.misconception}`);
    }
  }
  if (regroup) {
    // Common regrouping misconceptions with actual numbers
    const wrongNoCarry = tensA + tensB + (onesSum % 10);
    if (!misconceptions.some(m => m.includes(String(wrongNoCarry)))) {
      misconceptions.push(`Says ${wrongNoCarry} because they forgot to regroup after ${onesA} + ${onesB} = ${onesSum}`);
    }
    misconceptions.push(`Says ${correct} but does not explain regrouping`);
  } else {
    const wrongOnesOnly = onesSum;
    const wrongTensOnly = tensA + tensB;
    misconceptions.push(`Says ${wrongTensOnly} because they added ${tensA} + ${tensB} but forgot to add ${onesA} + ${onesB}`);
    misconceptions.push(`Says ${wrongOnesOnly} because they only added the ones`);
  }
  misconceptions.push(`Gives ${correct} but cannot explain how they got it`);

  // Scoring levels referencing actual criteria
  const strongParts = regroup
    ? [
        `States that ${onesA} + ${onesB} = ${onesSum}`,
        `explains that ${onesSum} ones makes 1 ten and ${onesSum % 10} ones`,
        `explains that the extra ten is added to the tens place`,
        `and gives the final answer ${correct}`,
      ]
    : [
        `States that ${onesA} + ${onesB} = ${onesSum}`,
        `states that ${tensA} + ${tensB} = ${tensA + tensB}`,
        `states that ${tensA + tensB} + ${onesSum} = ${correct}`,
        `and gives the final answer ${correct}`,
      ];

  // requiredExamples — concrete
  const requiredExamples = regroup
    ? `Says that ${onesA} + ${onesB} = ${onesSum}, explains regrouping, and gives the final answer ${correct}.`
    : `Says how to add the ones and tens and gives the final answer ${correct}.`;

  // Probes and retries derived from reasoning steps
  const allowedProbes = reasoningSteps.map(s => s.probe);
  const retryQuestions = [
    `Can you start with the ones digits, ${onesA} and ${onesB}?`,
    ...(regroup
      ? [`${onesA} + ${onesB} makes ${onesSum}. What do you do with the extra ten?`]
      : [`Now what do you get when you add ${tensA} and ${tensB}?`]),
    `What is the total when you put it all together?`,
  ];

  return {
    learningObjective: regroup
      ? `Explain how to solve ${a} + ${b} by adding the ones, regrouping, and then adding the tens.`
      : `Explain how to add ${a} and ${b} by adding the ones and tens separately.`,
    expectedReasoningSteps: flatSteps,
    reasoningSteps,
    expectedConcepts: concepts,
    successCriteria: criteria,
    misconceptions,
    scoringLevels: {
      strong: strongParts.join(", ") + ".",
      developing: "Gives the correct answer or part of the explanation, but misses one or more key steps.",
      needsSupport: "Gives an incorrect answer, incomplete explanation, or unrelated response.",
    },
    allowedProbes,
    retryQuestions,
    referenceFacts: buildMathReferenceFacts(a, b),
    requiredExamples,
    validVocabulary: regroup
      ? ["ones", "tens", "add", "regroup", "carry", "total", "sum"]
      : ["ones", "tens", "add", "total", "sum"],
  };
}

function buildSubtractionRubric(a: number, b: number, problem: MathProblem): DeterministicMathRubric {
  const onesA = a % 10;
  const onesB = b % 10;
  const tensA = Math.floor(a / 10) * 10;
  const tensB = Math.floor(b / 10) * 10;
  const correct = a - b;
  const regroup = problem.requiresRegrouping;

  const reasoningSteps: ReasoningStep[] = [];
  let stepNum = 0;
  const addStep = (label: string, expected: string[], probe: string, kind: ReasoningStepKind): void => {
    stepNum++;
    reasoningSteps.push({ id: `step_${stepNum}`, label, expectedStatements: expected, probe, kind });
  };

  if (regroup) {
    addStep("Identify that borrowing is needed",
      [`${onesA} is less than ${onesB}, so borrowing is needed`],
      `Is ${onesA} big enough to subtract ${onesB}?`, "identify_borrow");

    addStep("Borrow from the tens",
      [`Borrow 1 ten from ${tensA}, making the ones ${onesA + 10}`],
      `What do you do when the ones digit on top is smaller?`, "borrow");

    addStep("Subtract the ones after borrowing",
      [`${onesA + 10} - ${onesB} = ${onesA + 10 - onesB}`],
      `What is ${onesA + 10} minus ${onesB}?`, "subtract_ones");

    addStep("Subtract the tens",
      [`${tensA - 10} - ${tensB} = ${tensA - 10 - tensB}`],
      `What is ${tensA - 10} minus ${tensB}?`, "subtract_tens");
  } else {
    addStep("Subtract the ones",
      [`${onesA} - ${onesB} = ${onesA - onesB}`],
      `What do you get when you subtract ${onesB} from ${onesA}?`, "subtract_ones");

    addStep("Subtract the tens",
      [`${tensA} - ${tensB} = ${tensA - tensB}`],
      `What do you get when you subtract ${tensB} from ${tensA}?`, "subtract_tens");
  }

  addStep("State the final answer",
    [`The final answer is ${correct}`],
    `What is the final answer?`, "final_answer");

  const flatSteps = reasoningSteps.map(s => `${s.label}: ${s.expectedStatements[0]}`);

  const criteria: string[] = regroup
    ? [
        `Says that ${onesA} is less than ${onesB} so borrowing is needed`,
        `Says ${onesA + 10} - ${onesB} = ${onesA + 10 - onesB} after borrowing`,
        `States that the final answer is ${correct}`,
      ]
    : [
        `States that ${onesA} - ${onesB} = ${onesA - onesB}`,
        `States that ${tensA} - ${tensB} = ${tensA - tensB}`,
        `States that the final answer is ${correct}`,
      ];

  const concepts = regroup
    ? [
        `${onesA} is less than ${onesB}, so you need to borrow`,
        `Borrow 1 ten from ${tensA} to make ${onesA + 10} ones`,
        `${onesA + 10} - ${onesB} = ${onesA + 10 - onesB}`,
        `${tensA - 10} - ${tensB} = ${tensA - 10 - tensB}`,
        `The final answer is ${correct}`,
      ]
    : [
        `${onesA} - ${onesB} = ${onesA - onesB}`,
        `${tensA} - ${tensB} = ${tensA - tensB}`,
        `The final answer is ${correct}`,
      ];

  const misconceptions: string[] = [];
  if (problem.commonWrongAnswers) {
    for (const cw of problem.commonWrongAnswers) {
      misconceptions.push(`Says ${cw.answer} because ${cw.misconception}`);
    }
  }
  misconceptions.push(`Gives ${correct} but cannot explain how they got it`);

  const strongText = regroup
    ? `Explains that ${onesA} is less than ${onesB} so borrowing is needed, says ${onesA + 10} - ${onesB} = ${onesA + 10 - onesB}, and gives the final answer ${correct}.`
    : `States that ${onesA} - ${onesB} = ${onesA - onesB}, states that ${tensA} - ${tensB} = ${tensA - tensB}, and gives the final answer ${correct}.`;

  const allowedProbes = reasoningSteps.map(s => s.probe);
  const retryQuestions = regroup
    ? [
        `Look at the ones place: is ${onesA} big enough to take away ${onesB}?`,
        `When you borrow, ${onesA} becomes ${onesA + 10}. What is ${onesA + 10} minus ${onesB}?`,
      ]
    : [
        `Start with the ones: what is ${onesA} minus ${onesB}?`,
        `Now subtract the tens: what is ${tensA} minus ${tensB}?`,
      ];

  return {
    learningObjective: `Explain how to solve ${a} - ${b}${regroup ? " using borrowing" : " by subtracting the ones and tens separately"}.`,
    expectedReasoningSteps: flatSteps,
    reasoningSteps,
    expectedConcepts: concepts,
    successCriteria: criteria,
    misconceptions,
    scoringLevels: {
      strong: strongText,
      developing: "Gives the correct answer or part of the explanation, but misses one or more key steps.",
      needsSupport: "Gives an incorrect answer, incomplete explanation, or unrelated response.",
    },
    allowedProbes,
    retryQuestions,
    referenceFacts: buildMathReferenceFacts(a, b),
    requiredExamples: regroup
      ? `Explains borrowing and gives the final answer ${correct}.`
      : `Subtracts the ones and tens and gives the final answer ${correct}.`,
    validVocabulary: regroup
      ? ["ones", "tens", "subtract", "borrow", "take away", "difference"]
      : ["ones", "tens", "subtract", "take away", "difference"],
  };
}

function buildMultiplicationRubric(a: number, b: number, _problem: MathProblem): DeterministicMathRubric {
  const correct = a * b;
  const skipCounts = Array.from({ length: a }, (_, i) => b * (i + 1));

  const reasoningSteps: ReasoningStep[] = [
    { id: "step_1", label: "Identify the groups", expectedStatements: [`${a} groups of ${b}`], probe: `How many groups of ${b} do you need?`, kind: "identify_groups" },
    { id: "step_2", label: "Skip count", expectedStatements: [`Skip count by ${b}: ${skipCounts.join(", ")}`], probe: `Can you skip count by ${b}?`, kind: "skip_count" },
    { id: "step_3", label: "State the final answer", expectedStatements: [`${a} × ${b} = ${correct}`, `The final answer is ${correct}`], probe: `What is ${a} times ${b}?`, kind: "final_answer" },
  ];

  return {
    learningObjective: `Explain how to solve ${a} × ${b} using groups or skip counting.`,
    expectedReasoningSteps: reasoningSteps.map(s => `${s.label}: ${s.expectedStatements[0]}`),
    reasoningSteps,
    expectedConcepts: [
      `${a} groups of ${b}`,
      `Skip counting by ${b}: ${skipCounts.join(", ")}`,
      `${a} × ${b} = ${correct}`,
    ],
    successCriteria: [
      `Says there are ${a} groups of ${b}`,
      `Shows skip counting or repeated addition`,
      `States that the final answer is ${correct}`,
    ],
    misconceptions: [
      `Says ${a + b} because they added instead of multiplied`,
      `Gives ${correct} but cannot explain how they got it`,
      "Gives an unrelated answer",
    ],
    scoringLevels: {
      strong: `Explains ${a} groups of ${b}, uses skip counting or repeated addition, and states the correct answer ${correct}.`,
      developing: "Gives the correct answer or part of the explanation, but misses one or more key steps.",
      needsSupport: "Gives an incorrect answer, incomplete explanation, or unrelated response.",
    },
    allowedProbes: reasoningSteps.map(s => s.probe),
    retryQuestions: [
      `Think of ${a} groups of ${b}. Can you count them?`,
      `Try skip counting by ${b}: ${b}, ${b * 2}...`,
    ],
    referenceFacts: { [String(a)]: [`${a} groups`], [String(b)]: [`of ${b}`], answer: [String(correct)] },
    requiredExamples: `Explains groups or skip counting and gives the final answer ${correct}.`,
    validVocabulary: ["groups", "times", "multiply", "skip count", "total"],
  };
}

function buildPlaceValueRubric(problem: MathProblem): DeterministicMathRubric {
  const num = problem.a;
  const place = problem.targetPlace || "ones";
  const correct = problem.correctAnswer;
  const digits = String(num).split("").reverse();
  const placeNames = ["ones", "tens", "hundreds"];
  const placeDescriptions = digits.map((d, i) => `${d} in the ${placeNames[i]} place`);

  const reasoningSteps: ReasoningStep[] = [
    { id: "step_1", label: "Look at the number", expectedStatements: [`The number is ${num}`], probe: `What number are we looking at?`, kind: "generic" },
    { id: "step_2", label: "Identify the place value", expectedStatements: [`The ${place} digit is ${correct}`], probe: `Which digit is in the ${place} place?`, kind: "final_answer" },
  ];

  return {
    learningObjective: `Identify the digit in the ${place} place of ${num}.`,
    expectedReasoningSteps: reasoningSteps.map(s => `${s.label}: ${s.expectedStatements[0]}`),
    reasoningSteps,
    expectedConcepts: placeDescriptions.map(d => `Identifies ${d}`),
    successCriteria: [`Says the ${place} digit is ${correct}`],
    misconceptions: [
      `Confuses ones and tens places`,
      "Gives the whole number instead of one digit",
    ],
    scoringLevels: {
      strong: `States that the ${place} digit of ${num} is ${correct}.`,
      developing: "Identifies a digit but names the wrong place value.",
      needsSupport: "Gives an incorrect or unrelated response.",
    },
    allowedProbes: reasoningSteps.map(s => s.probe),
    retryQuestions: [
      `Look at ${num}. The rightmost digit is the ones place. What is the ${place} digit?`,
    ],
    referenceFacts: { [String(num)]: placeDescriptions },
    requiredExamples: `Names the ${place} digit of ${num} as ${correct}.`,
    validVocabulary: ["ones", "tens", "digit", "place value"],
  };
}

function buildGenericMathRubric(problem: MathProblem): DeterministicMathRubric {
  const reasoningSteps: ReasoningStep[] = [
    { id: "step_1", label: "Solve the problem", expectedStatements: [`${problem.expression} = ${problem.correctAnswer}`], probe: `How did you solve ${problem.expression}?`, kind: "generic" },
    { id: "step_2", label: "State the answer", expectedStatements: [`The answer is ${problem.correctAnswer}`], probe: `What is the final answer?`, kind: "final_answer" },
  ];

  return {
    learningObjective: `Solve ${problem.expression} and explain the reasoning.`,
    expectedReasoningSteps: reasoningSteps.map(s => `${s.label}: ${s.expectedStatements[0]}`),
    reasoningSteps,
    expectedConcepts: [`Solves ${problem.expression} correctly`],
    successCriteria: [`Says the correct answer is ${problem.correctAnswer}`],
    misconceptions: ["Gives an incorrect answer", "Gives an unrelated response"],
    scoringLevels: {
      strong: `States the correct answer ${problem.correctAnswer} with explanation.`,
      developing: "Gives the correct answer without explanation.",
      needsSupport: "Gives an incorrect or unrelated response.",
    },
    allowedProbes: reasoningSteps.map(s => s.probe),
    retryQuestions: [`Try solving ${problem.expression} step by step.`],
    referenceFacts: { answer: [String(problem.correctAnswer)] },
    requiredExamples: `Gives the correct answer ${problem.correctAnswer} with explanation.`,
    validVocabulary: [],
  };
}

/**
 * Detect the MathProblemSkill from a ParsedExpression's operation.
 */
function skillFromOperation(operation: "+" | "-" | "×"): MathProblemSkill {
  switch (operation) {
    case "+": return "two_digit_addition";
    case "-": return "two_digit_subtraction";
    case "×": return "basic_multiplication";
  }
}

/**
 * Build a full MathProblem from a ParsedExpression (no pre-existing skill needed).
 * Used when bootstrapping mathProblem from teacher-authored text.
 */
function buildMathProblemFromParsed(parsed: ParsedExpression): MathProblem {
  const skill = skillFromOperation(parsed.operation);
  const { a, b, expression, correctAnswer } = parsed;

  if (skill === "two_digit_addition") {
    const meta = computeAdditionMeta(a, b);
    return { skill, a, b, expression, correctAnswer, ...meta };
  }
  if (skill === "two_digit_subtraction") {
    const meta = computeSubtractionMeta(a, b);
    return { skill, a, b, expression, correctAnswer, ...meta };
  }
  // basic_multiplication
  return {
    skill, a, b, expression, correctAnswer,
    requiresRegrouping: false,
    expectedStrategyTags: ["multiply", "skip count", "groups of"],
  };
}

/**
 * Reconcile a math prompt's hidden data after the visible text has been edited.
 * If the prompt text expression differs from mathProblem, rebuild everything:
 * mathProblem, filledSlots, referenceFacts, conceptAnchor, hints, probes, retries.
 * Returns the prompt unchanged if no math data exists or no inconsistency found.
 */
export function reconcileMathPrompt(prompt: Prompt): Prompt {
  if (!prompt.mathProblem) return prompt;

  const validation = validateMathPromptConsistency(prompt);
  if (validation.valid) return prompt;

  const parsed = parseExpressionFromText(prompt.input);
  if (!parsed) {
    console.error(`[reconcile] Cannot parse expression from edited prompt: "${prompt.input}"`);
    return prompt;
  }

  const rebuilt = rebuildMathProblemFromExpression(parsed, prompt.mathProblem.skill);
  if (!rebuilt) {
    console.error(`[reconcile] Cannot rebuild mathProblem for skill=${prompt.mathProblem.skill} from expression="${parsed.expression}"`);
    return prompt;
  }

  return applyMathReconciliation(prompt, rebuilt, parsed);
}

/**
 * Reconcile ANY prompt that contains a math expression in its text.
 *
 * Unlike reconcileMathPrompt (which requires a pre-existing mathProblem),
 * this function bootstraps mathProblem from scratch when the teacher types
 * a math expression into question text. It also updates prompts that already
 * have mathProblem data if the expression changed.
 *
 * This is the canonical reconciliation entry point for the save pipeline.
 * The visible question text is the SOURCE OF TRUTH — teacher-authored
 * numbers always win over generated numbers.
 *
 * Returns the prompt unchanged if no math expression is found in the text.
 */
export function reconcileMathPromptFromText(prompt: Prompt): Prompt {
  const parsed = parseExpressionFromText(prompt.input);

  // No math expression in text → skip (non-math prompt)
  if (!parsed) return prompt;

  // If mathProblem already exists and is consistent, nothing to do
  if (prompt.mathProblem) {
    const validation = validateMathPromptConsistency(prompt);
    if (validation.valid) return prompt;

    // Expression changed — rebuild using existing skill
    const rebuilt = rebuildMathProblemFromExpression(parsed, prompt.mathProblem.skill);
    if (rebuilt) {
      return applyMathReconciliation(prompt, rebuilt, parsed);
    }
    // Skill mismatch (e.g., changed from + to -) — bootstrap fresh
  }

  // Bootstrap: create mathProblem from scratch based on teacher's text
  const freshProblem = buildMathProblemFromParsed(parsed);
  console.log(`[reconcile] Bootstrapped mathProblem from text: "${parsed.expression}" (answer: ${freshProblem.correctAnswer})`);
  return applyMathReconciliation(prompt, freshProblem, parsed);
}

/**
 * Apply reconciliation: rebuild all dependent fields from a MathProblem.
 * Preserves the teacher's original question intent (the prompt.input text).
 */
function applyMathReconciliation(
  prompt: Prompt,
  problem: MathProblem,
  parsed: ParsedExpression,
): Prompt {
  const rubric = buildDeterministicMathRubric(problem);
  const operandStrings = [String(parsed.a), String(parsed.b)];

  const oldExpression = prompt.mathProblem?.expression;
  if (oldExpression && oldExpression !== parsed.expression) {
    console.log(`[reconcile] Rebuilt mathProblem: ${oldExpression} → ${problem.expression} (answer: ${problem.correctAnswer})`);
  }

  return {
    ...prompt,
    filledSlots: { ...prompt.filledSlots, expression: parsed.expression },
    mathProblem: problem,
    hints: buildMathHints(problem),
    allowedProbes: buildMathAllowedProbes(problem),
    retryQuestions: buildMathRetryQuestions(problem),
    assessment: {
      ...(prompt.assessment || {}),
      learningObjective: rubric.learningObjective,
      expectedReasoningSteps: rubric.expectedReasoningSteps,
      reasoningSteps: rubric.reasoningSteps,
      expectedConcepts: rubric.expectedConcepts,
      successCriteria: rubric.successCriteria,
      misconceptions: rubric.misconceptions,
      scoringLevels: rubric.scoringLevels,
      referenceFacts: rubric.referenceFacts,
      requiredExamples: rubric.requiredExamples,
      validVocabulary: rubric.validVocabulary,
    },
    conceptAnchor: {
      ...(prompt.conceptAnchor || {
        anchorSentence: `Solve ${parsed.expression}`,
        coreConcepts: ["arithmetic", problem.skill.replace(/_/g, " ")],
        allowedEntities: operandStrings,
        allowedAttributes: [],
        offTopicConcepts: [],
      }),
      allowedEntities: operandStrings,
    },
  };
}
