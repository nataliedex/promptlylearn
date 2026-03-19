/**
 * Math answer validation and score bounding.
 *
 * Validates student spoken answers against MathProblem ground truth.
 * Pure functions, no LLM calls. Math equivalent of deterministicValidator.ts.
 */

import { MathProblem } from "./mathProblem";
import type { ReasoningStep } from "./prompt";

// ============================================================================
// Types
// ============================================================================

export type MathAnswerStatus =
  | "correct"
  | "incorrect_known_misconception"
  | "incorrect_unknown"
  | "no_answer";

export interface MathValidationResult {
  /** Did the student give the correct numeric answer? */
  status: MathAnswerStatus;
  /** The numeric answer extracted from student text, or null. */
  extractedAnswer: number | null;
  /** The correct answer from the MathProblem. */
  correctAnswer: number;
  /** If the wrong answer matches a known misconception, which one? */
  matchedMisconception?: string;
  /** Which strategy tags the student demonstrated. */
  demonstratedStrategies: string[];
  /** Whether the student showed valid strategy even if the final answer is wrong. */
  hasPartialStrategy: boolean;
}

export interface MathBoundingDecision {
  boundedStatus: "strong" | "developing" | "needs_support";
  boundedScore: number;
  wasAdjusted: boolean;
  reason: string;
}

// ============================================================================
// Answer extraction
// ============================================================================

/** Word-to-number mapping for spoken math. */
const WORD_NUMBERS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90, hundred: 100,
};

/** Common speech fillers to strip. */
const FILLERS = [
  /\bum+\b/g, /\buh+\b/g, /\blike\b/g, /\byou know\b/g, /\bwell\b/g,
  /\bso\b/g, /\bbasically\b/g, /\bi think\b/g, /\bmaybe\b/g,
];

/**
 * Extract the final numeric answer from student spoken text.
 * Handles speech fillers, word numbers, and explicit answer patterns.
 */
export function extractNumericAnswer(text: string): number | null {
  let normalized = text.toLowerCase();

  // Strip fillers
  for (const filler of FILLERS) {
    normalized = normalized.replace(filler, " ");
  }

  // Handle compound word numbers (e.g., "sixty three" → "63")
  // Process tens+ones compounds first
  const tensWords = ["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  const onesWords = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

  for (const tens of tensWords) {
    for (const ones of onesWords) {
      const compound = new RegExp(`\\b${tens}[\\s-]+${ones}\\b`, "g");
      const value = WORD_NUMBERS[tens] + WORD_NUMBERS[ones];
      normalized = normalized.replace(compound, String(value));
    }
  }

  // Replace remaining single word numbers
  for (const [word, num] of Object.entries(WORD_NUMBERS)) {
    normalized = normalized.replace(new RegExp(`\\b${word}\\b`, "g"), String(num));
  }

  // HIGH PRIORITY: Verbal answer patterns (unambiguous conclusions)
  const verbalPatterns = [
    /(?:the answer is|answer is)\s*(\d+)/i,
    /(\d+)\s*(?:is the answer|is my answer)/i,
    /(?:i got|i get|that gives|that makes|to get)\s*(\d+)/i,
  ];

  for (const pattern of verbalPatterns) {
    const match = normalized.match(pattern);
    if (match) {
      return parseInt(match[1], 10);
    }
  }

  // LOW PRIORITY: Equals sign / "it's" / "that's" — may appear in intermediate
  // calculations like "7 + 6 = 13". Prefer the LAST match (most likely the conclusion).
  const equalsPattern = /(?:it'?s|that'?s|equals?|=)\s*(\d+)/gi;
  const equalsMatches = [...normalized.matchAll(equalsPattern)];
  if (equalsMatches.length > 0) {
    return parseInt(equalsMatches[equalsMatches.length - 1][1], 10);
  }

  // Extract all numbers
  const numbers = normalized.match(/\d+/g);
  if (!numbers || numbers.length === 0) {
    return null;
  }

  if (numbers.length === 1) {
    return parseInt(numbers[0], 10);
  }

  // LEADING ANSWER: Number at start of text, followed by explanation language.
  // e.g., "53 I added the seven and the six together first" → 53
  // Only matches when followed by a pronoun/conjunction (not "7 and 6" computation).
  const leadingMatch = normalized.match(/^(\d+)\s+(?:i\s|because|since|and\s+then|but\s|so\s+i|my\s|the\s|we\s)/i);
  if (leadingMatch) {
    return parseInt(leadingMatch[1], 10);
  }

  // Multiple numbers: prefer the last one (often the conclusion)
  return parseInt(numbers[numbers.length - 1], 10);
}

// ============================================================================
// Numeric candidate roles — answer-role attribution
// ============================================================================

/** Role assigned to a numeric mention in student text. */
export type NumericRole =
  | "final_answer_candidate"    // "the answer is 25", "I got 25", bare "25"
  | "substep_result"            // "7 + 6 = 13" — result of an explicit equation
  | "decomposition_part"        // "split 14 into 10 and 4" — parts of a decomposition
  | "operand_reference"         // "the 7 and the 6" — referencing problem operands
  | "intermediate_result"       // "14 + 10 = 24, then 1 more is 25" — 24 is intermediate
  | "unknown_number";           // unclassifiable mention

/** A numeric mention with its role attribution. */
export interface NumericCandidate {
  value: number;
  role: NumericRole;
  /** Character offset in the normalized text where this number appears. */
  offset: number;
  /** The substring that produced this number (for debugging). */
  source: string;
}

/** Setup/decomposition patterns that suppress final-answer extraction. */
const SETUP_DECOMPOSITION_SUPPRESSORS = [
  /\b(?:I\s+)?(?:would|could|can|will|might|should)\s+(?:split|break|decompose)/i,
  /\bsplit\s+(?:it\s+)?(?:into\s+)?\d+\s*(?:\+|and|plus)\s*\d+/i,
  /\bsplit\s+\d+\s+into\s+\d+\s*(?:\+|and|plus)\s*\d+/i,
  /\b(?:could\s+be|is\s+like|is\s+the\s+same\s+as)\s+\d+\s*(?:\+|and|plus)\s*\d+/i,
  /\bbreak\s+(?:it\s+)?into\s+\d+\s*(?:\+|and|plus)\s*\d+/i,
  /\b(?:I\s+)?(?:would|could|can)\s+(?:do|make|use)\s+\d+\s*(?:\+|and|plus)\s*\d+/i,
];

/** Conclusion markers that override suppression — student IS giving a result. */
const CONCLUSION_MARKERS = /(?:the answer is|answer is|i got|i get|that gives|that makes|to get|equals?|so\s+it(?:'s| is))\s*\d+/i;

/** Equation pattern indicating actual computation (not just decomposition). */
const HAS_COMPUTATION_RESULT = /\b\d+\s*(?:\+|plus)\s*(?:the\s+)?\d+\s*(?:=|is|equals|makes?|gets?)\s*\d+\b/i;

/**
 * Extract numeric candidates with role attribution from student text.
 *
 * Instead of jumping directly to a single extracted answer, this builds
 * a list of every numeric mention with its likely role: final answer,
 * substep result, decomposition part, intermediate result, etc.
 *
 * The caller can then select the best candidate for their purpose.
 */
export function extractNumericCandidates(text: string): NumericCandidate[] {
  const normalized = normalizeNumberWords(text.toLowerCase());
  const candidates: NumericCandidate[] = [];

  // Track which character offsets have already been classified
  const classified = new Set<number>();

  // --- 1. Explicit final-answer claims ---
  const finalAnswerPatterns = [
    /(?:the answer is|answer is)\s*(\d+)/gi,
    /(\d+)\s*(?:is the answer|is my answer)/gi,
    /(?:i got|i get|that gives|that makes|to get)\s*(\d+)/gi,
  ];
  for (const pattern of finalAnswerPatterns) {
    for (const match of normalized.matchAll(pattern)) {
      const val = parseInt(match[1], 10);
      const offset = match.index! + match[0].indexOf(match[1]);
      if (!classified.has(offset)) {
        candidates.push({ value: val, role: "final_answer_candidate", offset, source: match[0].trim() });
        classified.add(offset);
      }
    }
  }

  // --- 2. Equation results: "A + B = C" → C is substep_result, A and B are operand_reference ---
  const eqPattern = /\b(\d+)\s*(?:\+|plus|and|minus|-)\s*(?:the\s+)?(\d+)\s*(?:=|is|equals|makes?|gets?)\s*(\d+)\b/gi;
  for (const match of normalized.matchAll(eqPattern)) {
    const opA = parseInt(match[1], 10);
    const opB = parseInt(match[2], 10);
    const result = parseInt(match[3], 10);
    const baseOffset = match.index!;
    const offsetA = baseOffset + match[0].indexOf(match[1]);
    const offsetB = baseOffset + match[0].indexOf(match[2], match[1].length);
    const offsetR = baseOffset + match[0].lastIndexOf(match[3]);

    if (!classified.has(offsetA)) {
      candidates.push({ value: opA, role: "operand_reference", offset: offsetA, source: match[0].trim() });
      classified.add(offsetA);
    }
    if (!classified.has(offsetB)) {
      candidates.push({ value: opB, role: "operand_reference", offset: offsetB, source: match[0].trim() });
      classified.add(offsetB);
    }
    if (!classified.has(offsetR)) {
      candidates.push({ value: result, role: "substep_result", offset: offsetR, source: match[0].trim() });
      classified.add(offsetR);
    }
  }

  // --- 3. Decomposition parts: "split 14 into 10 and 4" ---
  const decompPattern = /\b(?:split|broke|break|decompose[ds]?|made?)\s+(?:(?:it|the)\s+)?(?:(?:the\s+)?(\d+)\s+)?(?:into\s+)?(\d+)\s*(?:\+|and|plus)\s*(\d+)/gi;
  for (const match of normalized.matchAll(decompPattern)) {
    const baseOffset = match.index!;
    if (match[1]) {
      const whole = parseInt(match[1], 10);
      const wOffset = baseOffset + match[0].indexOf(match[1]);
      if (!classified.has(wOffset)) {
        candidates.push({ value: whole, role: "operand_reference", offset: wOffset, source: match[0].trim() });
        classified.add(wOffset);
      }
    }
    const partA = parseInt(match[2], 10);
    const partB = parseInt(match[3], 10);
    const oA = baseOffset + match[0].indexOf(match[2]);
    const oB = baseOffset + match[0].lastIndexOf(match[3]);
    if (!classified.has(oA)) {
      candidates.push({ value: partA, role: "decomposition_part", offset: oA, source: match[0].trim() });
      classified.add(oA);
    }
    if (!classified.has(oB)) {
      candidates.push({ value: partB, role: "decomposition_part", offset: oB, source: match[0].trim() });
      classified.add(oB);
    }
  }

  // --- 4. "could be A + B" pattern → decomposition parts ---
  const couldBePattern = /\b(?:could\s+be|is\s+like|would\s+(?:do|make|use))\s+(\d+)\s*(?:\+|and|plus)\s*(\d+)/gi;
  for (const match of normalized.matchAll(couldBePattern)) {
    const baseOffset = match.index!;
    const a = parseInt(match[1], 10);
    const b = parseInt(match[2], 10);
    const oA = baseOffset + match[0].indexOf(match[1]);
    const oB = baseOffset + match[0].lastIndexOf(match[2]);
    if (!classified.has(oA)) {
      candidates.push({ value: a, role: "decomposition_part", offset: oA, source: match[0].trim() });
      classified.add(oA);
    }
    if (!classified.has(oB)) {
      candidates.push({ value: b, role: "decomposition_part", offset: oB, source: match[0].trim() });
      classified.add(oB);
    }
  }

  // --- 5. Remaining unclassified numbers → final_answer_candidate or unknown ---
  for (const match of normalized.matchAll(/\b(\d+)\b/g)) {
    const offset = match.index!;
    if (classified.has(offset)) continue;
    const val = parseInt(match[1], 10);
    // A bare number in a short text without decomposition language is likely a final answer attempt
    candidates.push({ value: val, role: "unknown_number", offset, source: match[0] });
    classified.add(offset);
  }

  return candidates.sort((a, b) => a.offset - b.offset);
}

/**
 * Select the best final-answer candidate from numeric candidates.
 *
 * Priority:
 * 1. Explicit final_answer_candidate (verbal claim like "the answer is 25")
 * 2. Last substep_result that appears after conclusion language
 * 3. Unknown number that appears to be a standalone answer
 *
 * Returns null if only decomposition parts or operand references are found.
 */
function selectFinalAnswer(candidates: NumericCandidate[]): number | null {
  // Prefer explicit final answer claims — take the last one (most conclusive)
  const finalClaims = candidates.filter(c => c.role === "final_answer_candidate");
  if (finalClaims.length > 0) return finalClaims[finalClaims.length - 1].value;

  // Substep results can be final if they're the last equation result
  const substepResults = candidates.filter(c => c.role === "substep_result");
  if (substepResults.length > 0) return substepResults[substepResults.length - 1].value;

  // Unknown numbers — if there's exactly one, it's likely the answer
  const unknowns = candidates.filter(c => c.role === "unknown_number");
  if (unknowns.length === 1) return unknowns[0].value;
  if (unknowns.length > 1) return unknowns[unknowns.length - 1].value;

  // Only decomposition parts / operand references → no final answer
  return null;
}

/**
 * Check if the text is a setup/decomposition utterance that should NOT
 * produce a whole-problem final answer.
 *
 * "I would split it 5 + 9" → true (no final answer should be extracted)
 * "14 could be 7 + 7" → true
 * "the answer is 25" → false (explicit conclusion)
 * "split it into 5 + 9 and I got 14" → false (has conclusion marker)
 */
export function isDecompositionOnly(text: string): boolean {
  const normalized = normalizeNumberWords(text);
  // Must match a setup/decomposition suppressor
  if (!SETUP_DECOMPOSITION_SUPPRESSORS.some(p => p.test(normalized))) return false;
  // Must NOT have a conclusion marker OR a computation equation
  // "split 11 into 10 + 1, then 14 + 10 = 24, +1 = 25" has both decomposition
  // AND computation — it's NOT decomposition-only
  if (CONCLUSION_MARKERS.test(normalized)) return false;
  if (HAS_COMPUTATION_RESULT.test(normalized)) return false;
  return true;
}

/**
 * Role-aware final answer extraction.
 *
 * Wraps extractNumericAnswer with setup/decomposition suppression.
 * If the utterance is purely decomposition/setup language (no conclusion),
 * returns null instead of treating decomposition parts as wrong answers.
 *
 * For callers that need the legacy behavior, extractNumericAnswer() remains
 * unchanged and available.
 */
export function extractFinalAnswer(text: string): number | null {
  // If the text is decomposition-only, suppress answer extraction
  if (isDecompositionOnly(text)) return null;

  // Use candidate-based extraction for richer analysis
  const candidates = extractNumericCandidates(text);
  if (candidates.length === 0) return null;

  // If ALL candidates are decomposition_part or operand_reference, no final answer
  const hasAnswerCandidate = candidates.some(c =>
    c.role === "final_answer_candidate" ||
    c.role === "substep_result" ||
    c.role === "unknown_number"
  );
  if (!hasAnswerCandidate) return null;

  // Use the legacy extractor — it has been well-tested for conclusion detection
  // but gate it with our decomposition suppression above
  return extractNumericAnswer(text);
}

// ============================================================================
// Arithmetic chain parsing — alternate strategy detection
// ============================================================================

/** A single arithmetic step extracted from text. */
export interface ArithmeticStep {
  operandA: number;
  operandB: number;
  result: number;
  operator: "+" | "-";
}

/**
 * Parse all explicit arithmetic equations from text.
 * "14 + 10 = 24, then 1 more is 25" → [{14,10,24,"+"}, ...]
 *
 * Also handles "then N more is M" as "result + N = M".
 */
export function parseArithmeticChain(text: string): ArithmeticStep[] {
  const normalized = normalizeNumberWords(text);
  const steps: ArithmeticStep[] = [];

  // Standard equations: "A + B = C" / "A plus B is C" / "A and B makes C"
  const eqPattern = /\b(\d+)\s*(?:\+|plus|and)\s*(?:the\s+)?(\d+)\s*(?:=|is|equals|makes?|gets?)\s*(\d+)\b/gi;
  for (const match of normalized.matchAll(eqPattern)) {
    steps.push({
      operandA: parseInt(match[1], 10),
      operandB: parseInt(match[2], 10),
      result: parseInt(match[3], 10),
      operator: "+",
    });
  }

  // Subtraction equations: "A - B = C" / "A minus B is C"
  const subPattern = /\b(\d+)\s*(?:-|minus)\s*(\d+)\s*(?:=|is|equals|makes?|gets?)\s*(\d+)\b/gi;
  for (const match of normalized.matchAll(subPattern)) {
    steps.push({
      operandA: parseInt(match[1], 10),
      operandB: parseInt(match[2], 10),
      result: parseInt(match[3], 10),
      operator: "-",
    });
  }

  // Continuation patterns: "then N more is M" → previous_result + N = M
  const contPattern = /\bthen\s+(?:\+\s*)?(\d+)\s+more\s+(?:is|equals|makes|=)\s+(\d+)\b/gi;
  for (const match of normalized.matchAll(contPattern)) {
    const addend = parseInt(match[1], 10);
    const result = parseInt(match[2], 10);
    const prevResult = result - addend;
    if (prevResult > 0) {
      steps.push({ operandA: prevResult, operandB: addend, result, operator: "+" });
    }
  }

  // "+N = M" or "+N is M" continuation (e.g., "then +1 = 25")
  const plusContPattern = /(?<!\d\s*)\+\s*(\d+)\s*(?:=|is|equals|makes)\s*(\d+)\b/gi;
  for (const match of normalized.matchAll(plusContPattern)) {
    const addend = parseInt(match[1], 10);
    const result = parseInt(match[2], 10);
    const prevResult = result - addend;
    if (prevResult > 0) {
      // Only add if not already captured by the standard equation pattern
      const alreadyCaptured = steps.some(s =>
        s.operandA === prevResult && s.operandB === addend && s.result === result
      );
      if (!alreadyCaptured) {
        steps.push({ operandA: prevResult, operandB: addend, result, operator: "+" });
      }
    }
  }

  return steps;
}

/**
 * Check if parsed arithmetic steps form a valid chain reaching the correct answer.
 *
 * A valid alternate chain means:
 * - At least one step exists
 * - The chain terminates at the correct answer (some step has result === correctAnswer)
 * - Each step is arithmetically valid (operandA OP operandB === result)
 * - Steps are connected: at least one step's result feeds into another step's operand,
 *   OR a single step directly reaches the answer from problem operands
 */
export function isValidArithmeticChain(
  steps: ArithmeticStep[],
  correctAnswer: number,
): boolean {
  if (steps.length === 0) return false;

  // Must terminate at the correct answer
  const reachesAnswer = steps.some(s => s.result === correctAnswer);
  if (!reachesAnswer) return false;

  // Each step must be arithmetically valid
  const allValid = steps.every(s => {
    if (s.operator === "+") return s.operandA + s.operandB === s.result;
    if (s.operator === "-") return s.operandA - s.operandB === s.result;
    return false;
  });
  if (!allValid) return false;

  // If only one step, it must reach the answer directly
  if (steps.length === 1) return true;

  // For multi-step chains, check connectivity: some step's result should
  // appear as an operand in a subsequent step
  const results = new Set(steps.map(s => s.result));
  const operands = new Set(steps.flatMap(s => [s.operandA, s.operandB]));
  // At least one intermediate result must be consumed by another step
  for (const r of results) {
    if (r !== correctAnswer && operands.has(r)) return true;
  }
  // Even without strict connectivity, if we have multiple valid steps
  // all reaching the answer, that's a valid (if verbose) strategy
  return true;
}

/**
 * Improved alternate-strategy detection using arithmetic chain parsing.
 *
 * Replaces the old co-occurrence-based approach with actual chain validation.
 * A valid alternate strategy requires:
 * 1. At least one explicit arithmetic equation in the text
 * 2. The equations form a valid chain reaching the correct answer
 * 3. Each equation is arithmetically correct
 *
 * "14 + 10 = 24, then 1 more is 25" → valid chain: [14+10=24, 24+1=25]
 * "14 could be 7 + 7" → no equation reaching 25, NOT valid
 * "11 is 10 + 1" → no equation reaching 25, NOT valid
 */
export function detectAlternateStrategyChain(
  text: string,
  correctAnswer: number,
): boolean {
  const chain = parseArithmeticChain(text);
  return isValidArithmeticChain(chain, correctAnswer);
}

// ============================================================================
// Strategy tag detection
// ============================================================================

const STRATEGY_PATTERNS: Record<string, RegExp[]> = {
  "add ones": [
    /add(?:ed|ing)?\s+(?:the\s+)?ones/i,
    /ones?\s+place/i,
    /start(?:ed)?\s+with\s+(?:the\s+)?ones/i,
    /first\s+I?\s*(?:added?|put)\s+(?:the\s+)?\d/i,           // "first I added 7 and 6"
    /\b\d\s*\+\s*\d\s*(?:=|is|equals|makes?|gets?)\s*\d+/i,  // "7 + 6 = 13"
  ],
  "carry": [
    /carr(?:y|ied|ying)/i,
    /regroup(?:ed|ing)?/i,
    /move(?:d)?\s+(?:the\s+)?(?:1|one)\s+(?:to|over)/i,
    /put\s+(?:the\s+)?(?:1|one)\s+(?:on\s+top|above|over)/i,
    /more\s+than\s+(?:9|10|nine|ten)/i,                        // "more than 9"
    /extra\s+ten/i,                                              // "the extra ten"
    /left\s*over/i,                                              // "left over"
    /moved?\s+(?:the\s+)?(?:extra|1|one)\s+(?:\w+\s+)?(?:to|into|over)/i,  // "moved the extra to tens"
  ],
  "add tens": [
    /add(?:ed|ing)?\s+(?:the\s+)?tens/i,
    /tens?\s+place/i,
    /then\s+(?:the\s+)?tens/i,
    /then\s+(?:I\s+)?(?:added?|put)/i,                          // "then I added"
  ],
  "check ones": [
    /check(?:ed)?\s+(?:the\s+)?ones/i,
    /look(?:ed)?\s+at\s+(?:the\s+)?ones/i,
  ],
  "borrow from tens": [
    /borrow(?:ed|ing)?/i,
    /take\s+(?:one|1|a\s+ten)\s+from/i,
    /regroup(?:ed|ing)?/i,
  ],
  "subtract ones": [
    /subtract(?:ed|ing)?\s+(?:the\s+)?ones/i,
    /take(?:\s+away)?\s+(?:the\s+)?ones/i,
  ],
  "subtract tens": [
    /subtract(?:ed|ing)?\s+(?:the\s+)?tens/i,
    /take(?:\s+away)?\s+(?:the\s+)?tens/i,
  ],
  "multiply": [
    /multipl(?:y|ied|ying)/i,
    /times/i,
  ],
  "skip count": [
    /skip\s*count/i,
    /count(?:ed|ing)?\s+by/i,
  ],
  "groups of": [
    /groups?\s+of/i,
    /sets?\s+of/i,
    /rows?\s+of/i,
  ],
  "identify digit": [
    /digit/i,
    /number\s+in/i,
    /the\s+\d\s+(?:is|means)/i,
  ],
  "name ones place": [/ones?\s+place/i],
  "name tens place": [/tens?\s+place/i],
  "name hundreds place": [/hundreds?\s+place/i],
};

/**
 * Detect which strategy tags the student demonstrated in their explanation.
 */
export function detectStrategies(text: string, expectedTags: string[]): string[] {
  const found: string[] = [];
  for (const tag of expectedTags) {
    const patterns = STRATEGY_PATTERNS[tag];
    if (!patterns) continue;
    if (patterns.some((p) => p.test(text))) {
      found.push(tag);
    }
  }
  return found;
}

/** Map single digit 0-9 to word form for flexible pattern matching. */
const NUM_TO_WORD: Record<number, string> = {
  0: "zero", 1: "one", 2: "two", 3: "three", 4: "four",
  5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine",
};

export function numToWord(n: number): string {
  return NUM_TO_WORD[n] ?? String(n);
}

/**
 * Context-aware strategy detection that uses the MathProblem's actual operands
 * to recognize computational demonstrations of strategy.
 *
 * Example: For 27 + 36, a student saying "7 + 6 = 13" demonstrates "add ones"
 * even though they never said the word "ones."
 *
 * Also detects natural-language mentions like "I added the seven and the six"
 * (with optional articles between operands).
 */
export function detectStrategiesWithContext(
  text: string,
  problem: MathProblem,
): string[] {
  const found = detectStrategies(text, problem.expectedStrategyTags);
  const foundSet = new Set(found);

  // Context-aware: detect "add ones" via operand ones-digit computation
  if (
    problem.expectedStrategyTags.includes("add ones") &&
    !foundSet.has("add ones") &&
    problem.b !== undefined
  ) {
    const onesA = problem.a % 10;
    const onesB = problem.b % 10;
    const onesSum = onesA + onesB;
    const wordA = numToWord(onesA);
    const wordB = numToWord(onesB);

    // Pattern A: "7 + 6 = 13" or "7 and the 6 make 13" (with optional "the")
    const onesPattern = new RegExp(
      `\\b${onesA}\\s*(?:\\+|plus|and)\\s*(?:the\\s+)?${onesB}\\s*(?:=|is|equals|makes?|gets?)\\s*${onesSum}\\b`, "i"
    );
    const reversePattern = new RegExp(
      `\\b${onesB}\\s*(?:\\+|plus|and)\\s*(?:the\\s+)?${onesA}\\s*(?:=|is|equals|makes?|gets?)\\s*${onesSum}\\b`, "i"
    );

    // Pattern B: mention of operand digits in addition context, without result
    // "added the seven and the six" or "add 7 and 6 together"
    const digitOrWord = `(?:${onesA}|${wordA})`;
    const digitOrWordB = `(?:${onesB}|${wordB})`;
    const mentionPattern = new RegExp(
      `\\b(?:add(?:ed|ing)?|put|combin(?:e|ed|ing))\\s+(?:the\\s+)?${digitOrWord}\\s+(?:and|plus|with)\\s+(?:the\\s+)?${digitOrWordB}\\b`, "i"
    );
    const reverseMention = new RegExp(
      `\\b(?:add(?:ed|ing)?|put|combin(?:e|ed|ing))\\s+(?:the\\s+)?${digitOrWordB}\\s+(?:and|plus|with)\\s+(?:the\\s+)?${digitOrWord}\\b`, "i"
    );

    if (
      onesPattern.test(text) || reversePattern.test(text) ||
      mentionPattern.test(text) || reverseMention.test(text)
    ) {
      foundSet.add("add ones");
    }
  }

  // Context-aware: detect "add tens" via tens-digit mention
  if (
    problem.expectedStrategyTags.includes("add tens") &&
    !foundSet.has("add tens") &&
    problem.b !== undefined
  ) {
    const tensA = Math.floor(problem.a / 10);
    const tensB = Math.floor(problem.b / 10);
    // "2 + 3" or "2 and 3" (tens digits), allow optional "the"
    const tensPattern = new RegExp(
      `\\b${tensA}\\s*(?:\\+|plus|and)\\s*(?:the\\s+)?${tensB}\\b`, "i"
    );
    if (tensPattern.test(text)) {
      foundSet.add("add tens");
    }
  }

  // Context-aware: detect "check ones" via ones comparison
  if (
    problem.expectedStrategyTags.includes("check ones") &&
    !foundSet.has("check ones") &&
    problem.b !== undefined
  ) {
    const onesA = problem.a % 10;
    const onesB = problem.b % 10;
    // "2 is less than 7" or "2 < 7"
    const compPattern = new RegExp(
      `\\b${onesA}\\s*(?:is\\s+)?(?:less|smaller|not\\s+enough)`, "i"
    );
    if (compPattern.test(text)) {
      foundSet.add("check ones");
    }
  }

  return Array.from(foundSet);
}

// ============================================================================
// Main validation
// ============================================================================

/**
 * Validate a student's answer against deterministic math problem data.
 *
 * Uses role-aware extraction: setup/decomposition utterances (e.g., "I would split
 * it 5 + 9") return no_answer instead of being treated as a wrong final answer.
 */
export function validateMathAnswer(
  studentText: string,
  problem: MathProblem,
): MathValidationResult {
  // Use role-aware extraction: suppress answer for decomposition-only utterances
  const extractedAnswer = extractFinalAnswer(studentText);
  const demonstratedStrategies = detectStrategiesWithContext(studentText, problem);
  const hasPartialStrategy = demonstratedStrategies.length > 0;

  if (extractedAnswer === null) {
    return {
      status: "no_answer",
      extractedAnswer: null,
      correctAnswer: problem.correctAnswer,
      demonstratedStrategies,
      hasPartialStrategy,
    };
  }

  if (extractedAnswer === problem.correctAnswer) {
    return {
      status: "correct",
      extractedAnswer,
      correctAnswer: problem.correctAnswer,
      demonstratedStrategies,
      hasPartialStrategy,
    };
  }

  // Fallback: if the primary extractor picked an intermediate calculation result
  // but the correct answer appears in a conclusion position in the text, the student
  // DID state the answer. This handles multi-step explanations like
  // "14 + 10 = 24, then 1 more is 25" where the extractor picks 24.
  // Only triggers when the correct answer appears after conclusion language
  // or at the end of the text (not in a random position).
  const normalizedText = normalizeNumberWords(studentText);
  const conclusionPattern = new RegExp(
    `(?:` +
    `(?:is|get|got|gives|makes|equals?|=|then|more is|left over.*(?:get|is))\\s*${problem.correctAnswer}\\b` +
    `|\\b${problem.correctAnswer}\\s*$` +  // answer at end of text
    `)`,
    "i",
  );
  if (conclusionPattern.test(normalizedText)) {
    return {
      status: "correct",
      extractedAnswer: problem.correctAnswer,
      correctAnswer: problem.correctAnswer,
      demonstratedStrategies,
      hasPartialStrategy,
    };
  }

  // Check known misconceptions
  const misconception = problem.commonWrongAnswers?.find(
    (cwa) => cwa.answer === extractedAnswer,
  );

  return {
    status: misconception ? "incorrect_known_misconception" : "incorrect_unknown",
    extractedAnswer,
    correctAnswer: problem.correctAnswer,
    matchedMisconception: misconception?.misconception,
    demonstratedStrategies,
    hasPartialStrategy,
  };
}

// ============================================================================
// Score bounding
// ============================================================================

/**
 * Bound an LLM score based on deterministic math validation.
 *
 * Rules:
 * - Correct answer + strategy → strong (≥80)
 * - Correct answer, no strategy → developing (60-79)
 * - Wrong answer + valid strategy → developing (40-60)
 * - Wrong answer, no strategy → needs_support (≤40)
 * - No answer extracted → needs_support (≤30)
 */
export function boundMathScore(
  llmScore: number,
  validation: MathValidationResult,
): MathBoundingDecision {
  if (validation.status === "no_answer") {
    return {
      boundedStatus: "needs_support",
      boundedScore: Math.min(llmScore, 30),
      wasAdjusted: llmScore > 30,
      reason: "no numeric answer extracted",
    };
  }

  if (validation.status === "correct") {
    if (validation.hasPartialStrategy) {
      return {
        boundedStatus: "strong",
        boundedScore: Math.max(llmScore, 80),
        wasAdjusted: llmScore < 80,
        reason: "correct answer with strategy demonstrated",
      };
    }
    return {
      boundedStatus: "developing",
      boundedScore: Math.max(Math.min(llmScore, 79), 60),
      wasAdjusted: llmScore < 60 || llmScore > 79,
      reason: "correct answer but no strategy explanation detected",
    };
  }

  // Incorrect answer
  if (validation.hasPartialStrategy) {
    return {
      boundedStatus: "developing",
      boundedScore: Math.max(Math.min(llmScore, 60), 40),
      wasAdjusted: llmScore < 40 || llmScore > 60,
      reason: validation.matchedMisconception
        ? `wrong answer (${validation.matchedMisconception}) but valid strategy shown`
        : "wrong answer but valid strategy shown",
    };
  }

  return {
    boundedStatus: "needs_support",
    boundedScore: Math.min(llmScore, 40),
    wasAdjusted: llmScore > 40,
    reason: validation.matchedMisconception
      ? `wrong answer: ${validation.matchedMisconception}`
      : "incorrect answer with no strategy",
  };
}

// ============================================================================
// 3-state classification for explanation prompts
// ============================================================================

/**
 * Three-way classification for math explanation prompts.
 * - correct_explained: correct answer + at least one strategy demonstrated
 * - correct_incomplete: correct answer, but no strategy explanation
 * - incorrect: wrong answer or no answer extracted
 */
export type MathExplanationState =
  | "correct_explained"
  | "correct_incomplete"
  | "incorrect";

/**
 * Classify a math answer into one of three states for explanation prompts.
 * When the prompt does NOT require explanation, any correct answer counts
 * as "correct_explained" (explanation is optional).
 */
export function classifyMathExplanationState(
  validation: MathValidationResult,
  promptRequiresExplanation: boolean,
): MathExplanationState {
  if (validation.status !== "correct") return "incorrect";
  if (!promptRequiresExplanation) return "correct_explained";
  return validation.hasPartialStrategy ? "correct_explained" : "correct_incomplete";
}

// ============================================================================
// Conversation-level evidence accumulation
// ============================================================================

/**
 * Accumulate strategies demonstrated across all student turns in conversation history.
 * Returns the union of strategies detected in every student message.
 */
export function accumulateMathStrategies(
  conversationHistory: Array<{ role: string; message: string }>,
  problem: MathProblem,
): string[] {
  const allStrategies = new Set<string>();
  for (const turn of conversationHistory) {
    if (turn.role === "student") {
      const strategies = detectStrategiesWithContext(turn.message, problem);
      strategies.forEach(s => allStrategies.add(s));
    }
  }
  return Array.from(allStrategies);
}

/** Math vocabulary pattern for evidence detection (mirrors MATH_VOCAB_PATTERN in videoCoachGuardrails). */
const MATH_EVIDENCE_PATTERN = /\b(?:add(?:ed|ing|s)?|plus|minus|subtract(?:ed|ing|s)?|tens?|ones?|carr(?:y|ied|ying)|borrow(?:ed|ing)?|times|equals?|multiply|multipli(?:ed|cation)|divid(?:e|ed|ing)|regroup(?:ed|ing)?|sum|total|answer|hundred(?:s)?|place|digit|number|leftover|left\s*over|together|first\s+step|next\s+step|start\s+with)\b/i;

/**
 * Check whether there is ANY usable math evidence across the current response
 * and all prior student turns. Returns true if the student has provided digits,
 * math vocabulary, or demonstrated any strategy.
 *
 * Used to distinguish "needs_support" (some evidence) from "not_enough_evidence" (nothing).
 */
export function hasMathEvidence(
  currentResponse: string,
  conversationHistory: Array<{ role: string; message: string }>,
  problem: MathProblem,
): boolean {
  const allStudentText = [
    currentResponse,
    ...conversationHistory.filter(h => h.role === "student").map(h => h.message),
  ].join(" ");

  // Any digit → evidence
  if (/\d/.test(allStudentText)) return true;
  // Any math vocabulary → evidence
  if (MATH_EVIDENCE_PATTERN.test(allStudentText)) return true;
  // Any strategies detected → evidence
  const strategies = detectStrategiesWithContext(allStudentText, problem);
  if (strategies.length > 0) return true;

  return false;
}

// ============================================================================
// Conversation-level reasoning step accumulation
// ============================================================================

/** How a step was satisfied — used for debugging and evidence confidence. */
export type EvidenceSource =
  | "explicit_equation"    // Student stated a structural equation in their text
  | "short_scoped_reply"   // Short answer to coach question, combined with coach operands
  | "prior_turn_evidence"  // Already satisfied from a prior turn
  | "coach_modeled";       // Coach stated the step's answer

/** Detailed evidence record for a satisfied step. */
export interface StepEvidenceRecord {
  stepId: string;
  source: EvidenceSource;
  /** The student utterance text that satisfied this step. */
  utteranceText: string;
  /** 0-based turn index in the conversation (-1 if from coach-modeled). */
  turnIndex: number;
  /** The coach question that preceded this answer (if source is short_scoped_reply). */
  coachQuestionText?: string;
}

export interface ReasoningStepAccumulation {
  /** Step IDs that have been satisfied across all turns (canonical decomposition). */
  satisfiedStepIds: string[];
  /** Step IDs that are still missing (canonical decomposition). */
  missingStepIds: string[];
  /** Step IDs that were newly satisfied on the latest turn (not in prior turns). */
  newlySatisfiedStepIds: string[];
  /** Fraction of steps satisfied (0–1). Boosted by alternate strategy evidence. */
  completionRatio: number;
  /** Whether the student's final numeric answer is correct. */
  answerCorrect: boolean;
  /** The extracted final answer (from full transcript), or null. */
  extractedAnswer: number | null;
  /**
   * Whether the student demonstrated a mathematically valid alternate strategy
   * (not the canonical ones/tens/combine decomposition) that reaches the correct answer.
   * When true, the student has shown sufficient reasoning for success even if
   * canonical step IDs remain "missing". Defaults to false when not set.
   */
  alternateStrategyDetected?: boolean;
  /** Evidence source for each satisfied step (for debugging/logging). */
  evidenceSources?: Record<string, EvidenceSource>;
  /** Detailed evidence records for each satisfied step. */
  evidenceRecords?: StepEvidenceRecord[];
}

// ============================================================================
// Number word normalization for step matching
// ============================================================================

const TENS_WORDS = ["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const ONES_WORDS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/**
 * Normalize number words to digits in a text string.
 * "you get five" → "you get 5"
 * "twenty five" → "25"
 * "ten and ten is twenty" → "10 and 10 is 20"
 *
 * Exported for testing.
 */
export function normalizeNumberWords(text: string): string {
  let normalized = text.toLowerCase();

  // Compound tens+ones first (e.g., "twenty five" → "25")
  for (const tens of TENS_WORDS) {
    for (const ones of ONES_WORDS) {
      const compound = new RegExp(`\\b${tens}[\\s-]+${ones}\\b`, "gi");
      const value = WORD_NUMBERS[tens] + WORD_NUMBERS[ones];
      normalized = normalized.replace(compound, String(value));
    }
  }

  // Single word numbers
  for (const [word, num] of Object.entries(WORD_NUMBERS)) {
    normalized = normalized.replace(new RegExp(`\\b${word}\\b`, "gi"), String(num));
  }

  return normalized;
}

// ============================================================================
// Utterance typing
// ============================================================================

/** Classification of a student utterance for evidence weighting. */
export type UtteranceType =
  | "equation_statement"        // "7 + 6 = 13", "1 plus 4 is 5"
  | "final_answer_claim"        // "the answer is 63", "I got 25"
  | "scoped_substep_answer"     // "five", "20", "you get five" (short reply to probe)
  | "strategy_setup"            // "first I look at the ones place"
  | "decomposition_statement"   // "I broke 14 into 10 and 4"
  | "alternate_strategy_chain"  // "14 + 10 = 24, then 1 more is 25"
  | "unclear_or_none";          // "calculators", "I like pizza"

/** Equation pattern: num OP num RESULT num */
const EQUATION_PATTERN = /\b\d+\s*(?:\+|plus|and|minus|-)\s*(?:the\s+)?\d+\s*(?:=|is|equals|makes?|gets?)\s*\d+\b/i;

/** Multiple equations in one response (alternate strategy chain). */
const MULTI_EQUATION_PATTERN = /\b\d+\s*(?:\+|plus|and|minus|-)\s*(?:the\s+)?\d+\s*(?:=|is|equals|makes?|gets?)\s*\d+\b.*\b\d+\s*(?:\+|plus|and|minus|-)\s*(?:the\s+)?\d+\s*(?:=|is|equals|makes?|gets?)\s*\d+\b/is;

/** Verbal answer patterns (same as in extractNumericAnswer). */
const VERBAL_ANSWER_PATTERNS = [
  /(?:the answer is|answer is)\s*\d+/i,
  /\d+\s*(?:is the answer|is my answer)/i,
  /(?:i got|i get|that gives|that makes|to get)\s*\d+/i,
];

/** Decomposition language patterns (broke/split/made into). */
const DECOMPOSITION_LANGUAGE = /\b(?:bro(?:ke|ak|ken)|split(?:ting)?|decompos(?:e|ed|ing)|made?\s+(?:it\s+)?into|break(?:ing)?\s+(?:it\s+)?(?:into|down))\b/i;

/** Strategy setup patterns (procedural narration without a result). */
const STRATEGY_SETUP_PATTERN = /\b(?:first\s+(?:I\s+)?(?:look|start|add|check)|I(?:'m| am)\s+going\s+to|start(?:ed)?\s+with|I\s+(?:would|will)\s+(?:start|look|add)|let\s+me\s+(?:start|look|think))\b/i;

/**
 * Classify a student utterance into one of 7 categories.
 * Used for evidence weighting — not for gating (a response can still
 * satisfy a step regardless of its classification).
 */
export function classifyUtterance(text: string, coachQuestion?: string): UtteranceType {
  const normalized = normalizeNumberWords(text);

  // Multi-equation → alternate strategy chain
  if (MULTI_EQUATION_PATTERN.test(normalized)) return "alternate_strategy_chain";

  // Single equation
  if (EQUATION_PATTERN.test(normalized)) return "equation_statement";

  // Verbal answer claim
  if (VERBAL_ANSWER_PATTERNS.some(p => p.test(normalized))) return "final_answer_claim";

  // Decomposition language
  if (DECOMPOSITION_LANGUAGE.test(normalized)) return "decomposition_statement";

  // Strategy setup
  if (STRATEGY_SETUP_PATTERN.test(normalized)) return "strategy_setup";

  // Short scoped reply (when responding to a coach question)
  if (coachQuestion && isShortScopedStepReply(text)) return "scoped_substep_answer";

  // If it contains any digit at all, treat as scoped substep for short texts
  if (/\d/.test(normalized) && isShortScopedStepReply(text)) return "scoped_substep_answer";

  return "unclear_or_none";
}

// ============================================================================
// Short scoped reply detection
// ============================================================================

/**
 * Check if a student response is short enough to be treated as a direct
 * scoped answer to the preceding coach question.
 *
 * Used to gate coach-context matching: only short, direct responses
 * should borrow operands from the coach question. This prevents
 * long unrelated text (e.g., "I have 7 dogs and 6 cats, there are 13 total")
 * from accidentally satisfying steps via combined number matching.
 */
export function isShortScopedStepReply(text: string, maxWords: number = 15): boolean {
  let cleaned = text.toLowerCase();
  // Strip fillers
  for (const filler of FILLERS) {
    cleaned = cleaned.replace(filler, " ");
  }
  // Strip common conversational padding
  cleaned = cleaned.replace(/\b(?:um+|uh+|hmm+|ok(?:ay)?|yeah|yes|no|right)\b/gi, " ");
  const words = cleaned.trim().split(/\s+/).filter(w => w.length > 0);
  return words.length <= maxWords;
}

// ============================================================================
// Decomposition detection helpers
// ============================================================================

/**
 * Check if text contains decomposition language (broke/split/made into).
 */
function containsDecompositionLanguage(text: string): boolean {
  return DECOMPOSITION_LANGUAGE.test(text);
}

/**
 * Extract decomposition candidates from text.
 * E.g., "I broke 14 into 10 and 4" → [{parts: [10, 4], whole: 14}]
 */
function extractDecompositionCandidates(
  text: string,
): Array<{ parts: number[]; whole?: number }> {
  const normalized = normalizeNumberWords(text);
  const results: Array<{ parts: number[]; whole?: number }> = [];

  // "broke/split N into A and B"
  const breakPattern = /\b(?:bro(?:ke|ak|ken)|split(?:ting)?|decompos(?:e|ed|ing)|break(?:ing)?|made?)\s+(?:the\s+)?(\d+)\s+(?:into|(?:in)?to)\s+(\d+)\s+(?:and|plus)\s+(\d+)/gi;
  for (const match of normalized.matchAll(breakPattern)) {
    results.push({
      whole: parseInt(match[1]),
      parts: [parseInt(match[2]), parseInt(match[3])],
    });
  }

  return results;
}

/**
 * Check if the text is likely a strategy setup (procedural narration
 * about what the student will do, without stating a result).
 */
function isLikelyStrategySetup(text: string): boolean {
  if (!STRATEGY_SETUP_PATTERN.test(text)) return false;
  // Must NOT contain an equation or answer claim
  const normalized = normalizeNumberWords(text);
  return !EQUATION_PATTERN.test(normalized) &&
    !VERBAL_ANSWER_PATTERNS.some(p => p.test(normalized));
}

// ============================================================================
// Step satisfaction — structural equation matching
// ============================================================================

/**
 * Check whether all numbers from an expected statement appear in the text.
 * Uses word-boundary matching to avoid false positives (e.g., "3" in "63").
 */
function allNumbersPresent(nums: string[], text: string): boolean {
  return nums.every(n => new RegExp(`\\b${n}\\b`).test(text));
}

/**
 * Check whether the text contains a structural equation matching the expected
 * numbers. For a 3-number expected statement like "7 + 6 = 13" (nums=[7,6,13]),
 * requires: operand1 OPERATOR operand2 RESULT_CONNECTOR result
 *
 * This is stricter than allNumbersPresent — it prevents "I have 7 dogs and
 * 6 cats, there are 13 total" from satisfying "7 + 6 = 13".
 */
function containsStructuralEquation(nums: string[], text: string): boolean {
  if (nums.length < 3) return false;

  // For 3-number statements (a OP b = c), require structural pattern
  if (nums.length === 3) {
    const [a, b, result] = nums;
    const op = `\\s*(?:\\+|plus|and|minus|-)\\s*(?:the\\s+)?`;
    const eq = `\\s*(?:=|is|equals|makes?|gets?)\\s*`;

    // Try both operand orders: a OP b = result and b OP a = result
    const fwd = new RegExp(`\\b${a}${op}${b}${eq}${result}\\b`, "i");
    const rev = new RegExp(`\\b${b}${op}${a}${eq}${result}\\b`, "i");
    return fwd.test(text) || rev.test(text);
  }

  // For 4+ number statements (e.g., "20 + 30 + 10 = 60"), fall back to
  // allNumbersPresent — false positives with 4+ specific numbers are rare
  return allNumbersPresent(nums, text);
}

/**
 * Check if all numbers from an expected statement appear within proximity of
 * each other (within ~60 characters). This prevents scattered numbers across
 * unrelated topics from satisfying steps, while allowing natural-language
 * math descriptions like "the ones is the four and the one and I got five".
 *
 * Additionally requires math-relevant context (operators, math vocabulary
 * related to computation — not generic words like "total" or "number").
 */
function allNumbersPresentInMathContext(nums: string[], text: string): boolean {
  if (!allNumbersPresent(nums, text)) return false;

  // Check proximity: find positions of each number and ensure they cluster
  const positions: number[] = [];
  for (const n of nums) {
    const match = text.match(new RegExp(`\\b${n}\\b`));
    if (match && match.index !== undefined) positions.push(match.index);
  }
  if (positions.length < nums.length) return false;

  const span = Math.max(...positions) - Math.min(...positions);
  // If numbers span more than ~80 chars, they're likely in separate contexts
  if (span > 80) return false;

  // Require computation-specific vocabulary: operators, place-value words,
  // or result-connectors (is/equals/makes) adjacent to a number.
  const COMPUTATION_CONTEXT = /\b(?:add(?:ed|ing|s)?|plus|minus|subtract(?:ed|ing|s)?|tens?|ones?|carr(?:y|ied|ying)|borrow(?:ed|ing)?|equals?|regroup(?:ed|ing)?|together)\b/i;
  if (COMPUTATION_CONTEXT.test(text) || /[+\-=]/.test(text)) return true;
  // Check if a result-connector appears adjacent to one of the nums
  // "I got 5" / "that makes 13" / "is 20" — but not "she got 6 more" (non-math)
  for (const n of nums) {
    if (new RegExp(`(?:is|makes?|gets?)\\s+${n}\\b`, "i").test(text)) return true;
    if (new RegExp(`\\bI\\s+got\\s+${n}\\b`, "i").test(text)) return true;
    if (new RegExp(`\\b${n}\\s+(?:is|makes?|equals?)`, "i").test(text)) return true;
  }
  return false;
}

/**
 * Check if a reasoning step is demonstrated in the given text.
 *
 * Text is normalized (number words → digits) before matching.
 *
 * Matching strategies (in priority order):
 * 1. Exact substring match of the expected statement.
 * 2. For statements with 3 numbers: structural equation matching
 *    (requires num OP num = result pattern, not just co-occurrence).
 * 3. For statements with 4+ numbers: all numbers present (co-occurrence
 *    is sufficient — 4+ specific numbers rarely appear randomly together).
 * 4. For "combine"/"final_answer" steps: answer number alone suffices.
 * 5. For statements with 1 number: that number must appear in the text.
 */
export function isStepSatisfied(step: ReasoningStep, text: string): boolean {
  const lower = normalizeNumberWords(text);

  for (const stmt of step.expectedStatements) {
    // Priority 1: exact substring match
    if (lower.includes(stmt.toLowerCase())) return true;

    const nums = stmt.match(/\d+/g) || [];

    if (nums.length >= 2) {
      // For combine/final_answer steps, having the result number is enough
      if (step.kind === "combine" || step.kind === "final_answer") {
        const resultNum = nums[nums.length - 1];
        if (new RegExp(`\\b${resultNum}\\b`).test(lower)) return true;
      }

      // Priority 2: structural equation (a OP b = c pattern)
      if (containsStructuralEquation(nums, lower)) return true;

      // Priority 3: all numbers present with math context
      // Prevents "I have 7 dogs and 6 cats, there are 13" from satisfying "7 + 6 = 13"
      // but allows "the ones is four and one and I got five"
      if (allNumbersPresentInMathContext(nums, lower)) return true;
    } else if (nums.length === 1) {
      if (new RegExp(`\\b${nums[0]}\\b`).test(lower)) return true;
    }
  }

  return false;
}

/**
 * Check if a reasoning step is satisfied when considering the prior coach
 * question as context for the student's response.
 *
 * When the coach asks "What do you get when you add 1 and 4?" and the student
 * says "five", the operands come from the coach question and the result from
 * the student. This function combines them to check satisfaction.
 *
 * GUARD: Only applies to short, scoped replies. Long unrelated responses
 * must not borrow operands from the coach question.
 */
/**
 * Check whether coach text explicitly demonstrates a step's result (e.g.,
 * "0 + 2 = 2") vs. merely asking about it (e.g., "What is 0 + 2?").
 *
 * A coach question like "What is 0 + 2?" contains the operands but NOT the
 * "= result" equation. Only count as coach-modeled when the coach stated the
 * result, not when the coach asked the student to compute it.
 */
function isCoachModeledStep(step: ReasoningStep, coachText: string): boolean {
  const coachNorm = normalizeNumberWords(coachText);
  // First check: does isStepSatisfied even match?
  if (!isStepSatisfied(step, coachText)) return false;
  // Second check: the coach must have stated the result equation (= N)
  // not just mentioned the operands in a question.
  return step.expectedStatements.some(stmt => {
    const nums = stmt.match(/\d+/g) || [];
    if (nums.length < 2) return true; // single-number steps: presence is enough
    const resultNum = nums[nums.length - 1];
    return new RegExp(`=\\s*${resultNum}\\b`).test(coachNorm);
  });
}

function isStepSatisfiedWithCoachContext(
  step: ReasoningStep,
  studentText: string,
  coachQuestion: string,
): boolean {
  // First check without context — student may have stated everything
  if (isStepSatisfied(step, studentText)) return true;

  // GUARD: Only use coach-context matching for short, scoped replies.
  // This prevents "I have 7 dogs and 6 cats, there are 13 total"
  // from satisfying "7 + 6 = 13" when the coach asked about 7 + 6.
  if (!isShortScopedStepReply(studentText)) return false;

  // GUARD: If the coach explicitly stated the step's result equation (e.g.,
  // "0 + 2 = 2"), do NOT credit the student — the coach demonstrated, not asked.
  // But if the coach merely asked a question containing the operands (e.g.,
  // "What is 0 + 2?"), the student still deserves credit for providing the result.
  // We detect demonstration by checking for the result equation (= result) in
  // the coach text, not by running full isStepSatisfied (which matches on
  // operand co-occurrence alone).
  const coachNormalized = normalizeNumberWords(coachQuestion);
  const coachIsDemonstration = step.expectedStatements.some(stmt => {
    const nums = stmt.match(/\d+/g) || [];
    if (nums.length < 2) return false;
    const resultNum = nums[nums.length - 1];
    // Coach must contain "= result" pattern to count as demonstration
    return new RegExp(`=\\s*${resultNum}\\b`).test(coachNormalized);
  });
  if (coachIsDemonstration) return false;

  // Combine coach question + student response for number-based matching.
  // The student must contribute the RESULT number — if the coach provided all
  // the operands (e.g., "What is 0 + 2?"), the student must supply the answer
  // (e.g., "2"), not just any number.
  const normalizedStudent = normalizeNumberWords(studentText);
  const combined = normalizeNumberWords(`${coachQuestion} ${studentText}`);

  for (const stmt of step.expectedStatements) {
    const nums = stmt.match(/\d+/g) || [];
    if (nums.length >= 2) {
      if (!allNumbersPresent(nums, combined)) continue;
      // Ensure the student contributed the result number, not just operands
      const resultNum = nums[nums.length - 1];
      if (new RegExp(`\\b${resultNum}\\b`).test(normalizedStudent)) return true;
    }
  }

  // Special case for "regroup" kind: student says "carry the one" / "regroup"
  // in response to a regrouping probe
  if (step.kind === "regroup") {
    const normalizedStudent = normalizeNumberWords(studentText);
    if (/\b(?:carr(?:y|ied|ying)|regroup(?:ed|ing)?|move(?:d)?\s+(?:the\s+)?(?:1|one)|extra\s+ten|left\s*over)\b/i.test(normalizedStudent)) {
      // Check that the coach question was about this regrouping step
      const coachNorm = normalizeNumberWords(coachQuestion);
      const stepNums = step.expectedStatements[0].match(/\d+/g) || [];
      // If the coach question contains at least one number from this step, it's contextual
      if (stepNums.some(n => coachNorm.includes(n))) return true;
    }
  }

  return false;
}

/**
 * Detect whether the student demonstrated a valid alternate arithmetic strategy
 * to reach the correct answer, even if it doesn't match the canonical decomposition.
 *
 * Example: For 11 + 14 = 25, the canonical steps are 1+4=5, 10+10=20, 20+5=25.
 * But "14 + 10 = 24, then +1 = 25" is also valid. This function detects such
 * alternate arithmetic chains by checking if intermediate numbers in the student's
 * text can be combined to reach the answer or each other.
 */
export function detectAlternateStrategyEvidence(text: string, correctAnswer: number): boolean {
  const normalized = normalizeNumberWords(text);
  const matches = [...normalized.matchAll(/\b\d+\b/g)];
  const numbers = matches.map(m => parseInt(m[0]));
  // Need the answer itself present in the text
  if (!numbers.includes(correctAnswer)) return false;
  // Collect unique intermediate numbers (not the answer, not 0)
  const intermediates = [...new Set(numbers.filter(n => n !== correctAnswer && n > 0))];
  // Need at least 2 intermediate numbers to constitute a decomposition
  if (intermediates.length < 2) return false;

  // An alternate strategy must show a DIRECT arithmetic path to the answer:
  // some pair of intermediates must sum to the answer itself.
  // This distinguishes "14 + 10 = 24, 24 + 1 = 25" (has 24+1=25) from
  // "1 + 4 = 5" (canonical ones step, no pair sums to 25).
  for (let i = 0; i < intermediates.length; i++) {
    for (let j = 0; j < intermediates.length; j++) {
      if (i === j) continue;
      if (intermediates[i] + intermediates[j] === correctAnswer) return true;
    }
  }
  return false;
}

/**
 * Accumulate reasoning step evidence across the full student conversation.
 *
 * Reads ALL student turns (from conversationHistory + current response)
 * and checks each reasoning step against the combined transcript.
 * Also tracks which steps were newly satisfied on the current turn
 * (i.e., not demonstrated in prior turns alone).
 *
 * For the latest turn, uses coach-question context: if the coach asked
 * "What do you get when you add 1 and 4?" and the student says "five",
 * the system combines the operands from the question with the result
 * from the answer to satisfy the step "1 + 4 = 5".
 *
 * This is the core function for multi-turn math coaching:
 * - It NEVER forgets evidence from prior turns
 * - It distinguishes new vs. prior evidence for wrap decisions
 * - It provides the first missing step for probe selection
 */
export function accumulateReasoningStepEvidence(
  reasoningSteps: ReasoningStep[],
  conversationHistory: Array<{ role: string; message: string }>,
  currentResponse: string,
  correctAnswer: number,
): ReasoningStepAccumulation {
  // Build transcripts
  const priorStudentMessages = conversationHistory
    .filter(h => h.role === "student")
    .map(h => h.message);
  const priorStudentText = priorStudentMessages.join(" ");
  const fullText = priorStudentText
    ? `${priorStudentText} ${currentResponse}`
    : currentResponse;

  // Extract the last coach question for context-aware step matching.
  // This enables matching "you get five" against "1 + 4 = 5" when the
  // coach asked "What do you get when you add 1 and 4?"
  // IMPORTANT: Use the last *math* coach question (contains digits + "?"), not
  // procedural messages like "I didn't catch that — would you like a hint?"
  const PROCEDURAL_COACH_MSG = /didn't catch|would you like a hint|want to give it|try again|try answering|that's okay/i;
  let lastCoachQuestion = "";
  let lastMathCoachQuestion = "";
  for (let i = conversationHistory.length - 1; i >= 0; i--) {
    if (conversationHistory[i].role === "coach") {
      if (!lastCoachQuestion) lastCoachQuestion = conversationHistory[i].message;
      if (!lastMathCoachQuestion && /\d/.test(conversationHistory[i].message) && conversationHistory[i].message.includes("?") && !PROCEDURAL_COACH_MSG.test(conversationHistory[i].message)) {
        lastMathCoachQuestion = conversationHistory[i].message;
      }
      if (lastCoachQuestion && lastMathCoachQuestion) break;
    }
  }

  // Also build per-turn coach-student pairs for mid-conversation context matching.
  // IMPORTANT: Skip no-speech student turns — they carry no evidence and would
  // consume the coach question pairing, breaking context for the next real answer.
  const NO_SPEECH = /^\s*$|no\s*speech\s*detected/i;
  const turnPairs: Array<{ coachQ: string; studentA: string }> = [];
  let pendingCoachQ = "";
  for (const entry of conversationHistory) {
    if (entry.role === "coach") {
      // Only update pendingCoachQ if this is a substantive (non-procedural) message,
      // OR if there's no pending question yet. This way a math question carries
      // through retry messages.
      if (!PROCEDURAL_COACH_MSG.test(entry.message) || !pendingCoachQ) {
        pendingCoachQ = entry.message;
      }
    } else if (entry.role === "student") {
      if (NO_SPEECH.test(entry.message)) {
        // Skip no-speech turns — don't consume the pending coach question
        continue;
      }
      turnPairs.push({ coachQ: pendingCoachQ, studentA: entry.message });
      pendingCoachQ = "";
    }
  }
  // Add current response with its coach context.
  // Prefer the last math coach question for richer context matching.
  const currentCoachContext = lastMathCoachQuestion || lastCoachQuestion;
  turnPairs.push({ coachQ: currentCoachContext, studentA: currentResponse });

  // Check answer correctness per-turn (not from concatenated text, which
  // confuses intermediate calculations with final answers).
  // If ANY individual turn contained the correct answer, it counts.
  // Uses role-aware extraction: decomposition-only turns don't produce answers.
  const allTurns = [...priorStudentMessages, currentResponse];
  let extractedAnswer: number | null = null;
  let answerCorrect = false;
  for (const turn of allTurns) {
    // Use role-aware extraction — suppresses decomposition-only utterances
    const turnAnswer = extractFinalAnswer(turn);
    if (turnAnswer === correctAnswer) {
      answerCorrect = true;
      extractedAnswer = turnAnswer;
      break;
    }
    // Fallback: if extractFinalAnswer picked an intermediate result but
    // the correct answer appears as a standalone number in the turn, count it.
    // This handles "14 + 10 = 24 and then 25" where the extractor picks 24
    // but 25 is clearly present as the final result.
    if (turnAnswer !== correctAnswer) {
      const normalized = normalizeNumberWords(turn);
      if (new RegExp(`\\b${correctAnswer}\\b`).test(normalized)) {
        // Only count if the turn is NOT decomposition-only
        if (!isDecompositionOnly(turn)) {
          answerCorrect = true;
          extractedAnswer = correctAnswer;
          break;
        }
      }
    }
    // Track the latest extracted answer even if wrong
    if (turnAnswer !== null) {
      extractedAnswer = turnAnswer;
    }
  }

  // Build concatenated coach text for modeled-instruction detection.
  // When the coach explicitly states a step's answer (e.g., "In this problem,
  // 10 + 10 = 20"), that step is established and should remain satisfied even
  // if the student never restated it. This prevents regression to earlier steps
  // after modeled instruction.
  const coachMessages = conversationHistory
    .filter(h => h.role === "coach")
    .map(h => h.message);
  const fullCoachText = coachMessages.join(" ");

  // Evidence priority ordering:
  // 1. Explicit equation in student text (highest confidence)
  // 2. Short scoped reply to coach question (high confidence)
  // 3. Prior-turn evidence (maintained)
  // 4. Coach-modeled instruction (lowest, but valid for non-combine steps)
  const satisfiedStepIds: string[] = [];
  const missingStepIds: string[] = [];
  const newlySatisfiedStepIds: string[] = [];
  const evidenceSources: Record<string, EvidenceSource> = {};
  const evidenceRecords: StepEvidenceRecord[] = [];

  for (const step of reasoningSteps) {
    let satisfied = false;
    let source: EvidenceSource = "explicit_equation";
    let evidenceUtterance = "";
    let evidenceTurnIndex = -1;
    let evidenceCoachQ = "";

    // Priority 1: explicit equation in full student text
    // Find which specific turn satisfied it
    if (isStepSatisfied(step, fullText)) {
      satisfied = true;
      source = "explicit_equation";
      // Find the specific turn that satisfied this step
      for (let ti = 0; ti < turnPairs.length; ti++) {
        if (isStepSatisfied(step, turnPairs[ti].studentA)) {
          evidenceUtterance = turnPairs[ti].studentA;
          evidenceTurnIndex = ti;
          break;
        }
      }
      if (!evidenceUtterance) evidenceUtterance = fullText;
    }

    // Priority 2: short scoped reply with coach context
    if (!satisfied) {
      for (let ti = 0; ti < turnPairs.length; ti++) {
        const pair = turnPairs[ti];
        if (pair.coachQ && isStepSatisfiedWithCoachContext(step, pair.studentA, pair.coachQ)) {
          satisfied = true;
          source = "short_scoped_reply";
          evidenceUtterance = pair.studentA;
          evidenceTurnIndex = ti;
          evidenceCoachQ = pair.coachQ;
          break;
        }
      }
    }

    // Priority 3: coach-modeled instruction (non-combine/non-final_answer only)
    if (!satisfied && step.kind !== "combine" && step.kind !== "final_answer") {
      if (isCoachModeledStep(step, fullCoachText)) {
        satisfied = true;
        source = "coach_modeled";
        evidenceTurnIndex = -1;
      }
    }

    if (satisfied) {
      satisfiedStepIds.push(step.id);
      evidenceSources[step.id] = source;
      const record: StepEvidenceRecord = {
        stepId: step.id,
        source,
        utteranceText: evidenceUtterance,
        turnIndex: evidenceTurnIndex,
      };
      if (evidenceCoachQ) record.coachQuestionText = evidenceCoachQ;
      evidenceRecords.push(record);

      // Check if it was already satisfied before the current turn
      let satisfiedInPrior = false;
      if (priorStudentText) {
        satisfiedInPrior = isStepSatisfied(step, priorStudentText);
      }
      if (!satisfiedInPrior) {
        const priorPairs = turnPairs.slice(0, -1);
        for (const pair of priorPairs) {
          if (pair.coachQ && isStepSatisfiedWithCoachContext(step, pair.studentA, pair.coachQ)) {
            satisfiedInPrior = true;
            break;
          }
        }
      }
      if (!satisfiedInPrior && step.kind !== "combine" && step.kind !== "final_answer") {
        if (isCoachModeledStep(step, fullCoachText)) {
          satisfiedInPrior = true;
        }
      }

      if (!satisfiedInPrior) {
        newlySatisfiedStepIds.push(step.id);
      }
    } else {
      missingStepIds.push(step.id);
    }
  }

  // Base completion ratio from canonical step matching
  let completionRatio = reasoningSteps.length > 0
    ? satisfiedStepIds.length / reasoningSteps.length
    : 0;

  // ALTERNATE STRATEGY RECOGNITION:
  // If the student has the correct answer AND showed intermediate arithmetic
  // (a valid decomposition that isn't the canonical steps), boost completionRatio.
  // Uses chain-based detection: requires actual arithmetic equations forming a
  // valid path to the answer, not just number co-occurrence.
  // IMPORTANT: alternate strategy does NOT backfill canonical steps — it only
  // boosts completionRatio and sets alternateStrategyDetected.
  const alternateStrategyDetected = answerCorrect && missingStepIds.length > 0 && (
    detectAlternateStrategyChain(fullText, correctAnswer) ||
    // Fallback to legacy detection for broader coverage
    detectAlternateStrategyEvidence(fullText, correctAnswer)
  );
  if (alternateStrategyDetected) {
    completionRatio = Math.max(completionRatio, 0.66);
  }

  return {
    satisfiedStepIds,
    missingStepIds,
    newlySatisfiedStepIds,
    completionRatio,
    answerCorrect,
    extractedAnswer,
    alternateStrategyDetected,
    evidenceSources,
    evidenceRecords,
  };
}

/**
 * Get the first missing reasoning step's probe from accumulated evidence.
 * Returns the probe question for the first step that hasn't been demonstrated,
 * or null if all steps are satisfied.
 */
export function getFirstMissingStepProbe(
  reasoningSteps: ReasoningStep[],
  accumulation: ReasoningStepAccumulation,
): { probe: string; stepId: string; label: string } | null {
  const missingSet = new Set(accumulation.missingStepIds);
  for (const step of reasoningSteps) {
    if (missingSet.has(step.id)) {
      return { probe: step.probe, stepId: step.id, label: step.label };
    }
  }
  return null;
}

/**
 * Determine step-aware performance level from accumulated reasoning step evidence.
 *
 * - STRONG: all steps satisfied AND answer correct
 * - DEVELOPING: answer correct + at least one step, OR some steps but answer wrong
 * - NEEDS_SUPPORT: no steps satisfied and wrong/no answer
 */
export function stepAwareStatus(
  accumulation: ReasoningStepAccumulation,
): "strong" | "developing" | "needs_support" {
  const { satisfiedStepIds, missingStepIds, answerCorrect } = accumulation;
  const totalSteps = satisfiedStepIds.length + missingStepIds.length;

  // All steps satisfied + correct answer = mastery
  if (missingStepIds.length === 0 && answerCorrect) {
    return "strong";
  }

  // Correct answer + at least one step OR some steps demonstrated
  if (answerCorrect && satisfiedStepIds.length > 0) {
    return "developing";
  }
  if (satisfiedStepIds.length > 0) {
    return "developing";
  }

  // Correct answer but no explanation steps at all
  if (answerCorrect && totalSteps > 0) {
    return "developing";
  }

  return "needs_support";
}

// ============================================================================
// Shared interpretation contract — one canonical parse per utterance
// ============================================================================

/**
 * The canonical interpretation of a student math utterance.
 *
 * Downstream files (deterministicRemediation, coach routing) should consume
 * this object instead of independently re-parsing the same text. Computing
 * all signals once prevents disagreement between subsystems.
 */
export interface MathUtteranceInterpretation {
  /** Classification of the utterance for evidence weighting. */
  utteranceKind: UtteranceType;

  /** Best final-answer candidate (decomposition-suppressed). null if decomposition-only. */
  finalAnswerCandidate: number | null;

  /** Raw extracted answer (NO decomposition suppression). Useful for checking
   *  if any number was spoken at all, regardless of context. */
  rawExtractedAnswer: number | null;

  /** All numeric mentions with role attribution. */
  numericCandidates: NumericCandidate[];

  /** Detected decomposition parts (e.g., "broke 14 into 10 and 4"). */
  decompositionParts: Array<{ parts: number[]; whole?: number }>;

  /** Parsed arithmetic equations from the text. */
  parsedArithmeticChain: ArithmeticStep[];

  /** True if text is pure setup/decomposition with no conclusion. */
  isDecompositionOnly: boolean;

  /** True if arithmetic chain forms a valid path to correctAnswer. */
  isAlternateStrategyChain: boolean;

  /** True if response is short enough for coach-context matching. */
  isShortScopedReply: boolean;

  /** True when finalAnswerCandidate is likely a whole-problem answer
   *  (not a scoped substep answer to a coach probe). */
  likelyWholeProblemAnswer: boolean;

  /** True when the utterance only shows substep-level work (equation or
   *  scoped reply) with no explicit final-answer claim. */
  likelySubstepOnly: boolean;

  /** Whether any math evidence (digits, vocab, strategies) exists. */
  hasMathEvidence: boolean;
}

/**
 * Build a single canonical interpretation of a student math utterance.
 *
 * Call this once per turn, then pass the result to downstream consumers
 * (classifyStudentState, wrap decisions, coach routing) so they all agree
 * on what the student said.
 *
 * @param studentText - The current student utterance.
 * @param correctAnswer - The problem's correct answer.
 * @param coachQuestion - The preceding coach question (for scoped-reply detection).
 * @param problemOperands - The problem's operands [a, b] for substep vs whole-problem detection.
 * @param problemOperation - The problem's expected operation ("+" or "-") for misconception detection.
 */
export function interpretMathUtterance(
  studentText: string,
  correctAnswer: number,
  coachQuestion?: string,
  problemOperands?: [number, number],
  problemOperation?: "+" | "-",
): MathUtteranceInterpretation {
  const normalized = normalizeNumberWords(studentText);

  // Core extractions — each computed exactly once
  const numericCandidates = extractNumericCandidates(studentText);
  const finalAnswerCandidate = extractFinalAnswer(studentText);
  const rawExtractedAnswer = extractNumericAnswer(studentText);
  const decompositionParts = extractDecompositionCandidates(studentText);
  const chain = parseArithmeticChain(studentText);
  const decompOnly = isDecompositionOnly(studentText);
  const shortScoped = isShortScopedStepReply(studentText);
  const utteranceKind = classifyUtterance(studentText, coachQuestion);

  // Derived signals
  const altChain = chain.length > 0 && isValidArithmeticChain(chain, correctAnswer);

  // likelyWholeProblemAnswer: the student made an explicit final-answer claim
  // or gave a standalone number (not part of an equation or decomposition)
  const hasFinalClaim = numericCandidates.some(c => c.role === "final_answer_candidate");
  const hasOnlySubstepOrDecomp = numericCandidates.length > 0 &&
    numericCandidates.every(c =>
      c.role === "substep_result" ||
      c.role === "decomposition_part" ||
      c.role === "operand_reference" ||
      c.role === "intermediate_result"
    );

  // A bare standalone number (e.g., "21", "three") is a whole-problem answer
  // unless it appears inside an equation. unknown_number candidates indicate standalone.
  const hasStandaloneNumber = numericCandidates.some(c => c.role === "unknown_number");

  const likelyWholeProblemAnswer = hasFinalClaim ||
    (utteranceKind === "final_answer_claim") ||
    hasStandaloneNumber ||
    (!decompOnly && !hasOnlySubstepOrDecomp && finalAnswerCandidate !== null);

  // likelySubstepOnly: true ONLY for equation statements (A + B = C form)
  // where no explicit final-answer claim is present AND the arithmetic is correct
  // AND the equation does NOT use the problem's main operands (which would make it
  // a whole-problem answer attempt, not a substep).
  // "10 + 10 = 20" with correct answer 25 → substep-only (substep of 11+14)
  // "1 - 4 = 3" on an addition problem → NOT substep-only (wrong operation = misconception)
  // "20 + 5 = 15" → NOT substep-only (arithmetic is wrong: 20+5=25 not 15)
  // "14 - 11 = 3" → NOT substep-only (uses both problem operands = whole-problem attempt)
  const hasArithmeticallyCorrectEquation = chain.length > 0 &&
    chain.every(s => {
      if (s.operator === "+") return s.operandA + s.operandB === s.result;
      if (s.operator === "-") return s.operandA - s.operandB === s.result;
      return false;
    });

  // An equation using BOTH problem operands is a whole-problem answer, not a substep.
  const equationUsesBothOperands = problemOperands && chain.length > 0 &&
    chain.some(s => {
      const ops = new Set([s.operandA, s.operandB]);
      return ops.has(problemOperands[0]) && ops.has(problemOperands[1]);
    });

  // An equation using the WRONG operation is a misconception, not a substep.
  // "4 - 1 = 3" on an addition problem → wrong operation on the ones digits.
  const equationUsesWrongOperation = problemOperation && chain.length > 0 &&
    chain.some(s => s.operator !== problemOperation);

  const likelySubstepOnly =
    utteranceKind === "equation_statement" &&
    !hasFinalClaim &&
    !decompOnly &&
    !hasStandaloneNumber &&
    hasArithmeticallyCorrectEquation &&
    !equationUsesBothOperands &&
    !equationUsesWrongOperation;

  // Math evidence: any digit, math vocab, or strategy language
  const hasMathEvidenceSignal = /\d/.test(normalized) ||
    MATH_EVIDENCE_PATTERN.test(normalized) ||
    utteranceKind !== "unclear_or_none";

  return {
    utteranceKind,
    finalAnswerCandidate,
    rawExtractedAnswer,
    numericCandidates,
    decompositionParts,
    parsedArithmeticChain: chain,
    isDecompositionOnly: decompOnly,
    isAlternateStrategyChain: altChain,
    isShortScopedReply: shortScoped,
    likelyWholeProblemAnswer,
    likelySubstepOnly,
    hasMathEvidence: hasMathEvidenceSignal,
  };
}

// ============================================================================
// Math wrap decision — centralized rules for when to wrap a math session
// ============================================================================

/** Discriminated union for math wrap decisions. */
export type MathWrapDecision =
  | { action: "wrap_mastery"; reason: string }
  | { action: "wrap_support"; reason: string }
  | { action: "continue_probing"; reason: string }
  | { action: "continue_decomposition"; reason: string };

/**
 * Centralized math wrap decision.
 *
 * Replaces scattered anti-wrap guards in the route handler with explicit,
 * testable rules. The rules are:
 *
 * WRAP AS MASTERY when:
 *   - All canonical steps complete + correct answer, OR
 *   - Valid alternate strategy chain + correct answer + sufficient explanation
 *
 * CONTINUE PROBING when:
 *   - Answer correct but explanation incomplete
 *   - Canonical steps missing but usable progress exists
 *   - Utterance is decomposition/setup without conclusion
 *   - Student gave a scoped substep answer
 *
 * WRAP AS SUPPORT when:
 *   - No usable math evidence after sufficient attempts
 *   - Explicit give-up near attempt limit
 *   - Closing window forces wrap (time constraint)
 */
export function shouldWrapMathSession(
  stepAccumulation: ReasoningStepAccumulation,
  interpretation: MathUtteranceInterpretation,
  attemptCount: number,
  maxAttempts: number,
  timeRemainingSec?: number,
  feedbackScore?: number,
): MathWrapDecision {
  const CLOSING_WINDOW_SEC = 15;
  const hasTime = !timeRemainingSec || timeRemainingSec > CLOSING_WINDOW_SEC;

  // ── Rule 1: MASTERY — all steps satisfied + correct answer ──
  if (stepAccumulation.missingStepIds.length === 0 && stepAccumulation.answerCorrect) {
    return { action: "wrap_mastery", reason: "all_steps_complete_and_correct" };
  }

  // ── Rule 2: MASTERY via alternate strategy ──
  if (stepAccumulation.alternateStrategyDetected && stepAccumulation.answerCorrect) {
    return { action: "wrap_mastery", reason: "alternate_strategy_with_correct_answer" };
  }

  // ── Rule 3: CONTINUE — decomposition/setup utterance ──
  if (interpretation.isDecompositionOnly && hasTime) {
    return { action: "continue_decomposition", reason: "decomposition_setup_no_conclusion" };
  }

  // ── Rule 4: CONTINUE — answer correct but explanation incomplete ──
  if (stepAccumulation.answerCorrect && stepAccumulation.missingStepIds.length > 0 && hasTime) {
    return { action: "continue_probing", reason: "correct_answer_missing_explanation" };
  }

  // ── Rule 5: CONTINUE — progress exists + missing steps ──
  if (
    stepAccumulation.missingStepIds.length > 0 &&
    (stepAccumulation.satisfiedStepIds.length > 0 || stepAccumulation.newlySatisfiedStepIds.length > 0) &&
    hasTime
  ) {
    return { action: "continue_probing", reason: "partial_progress_with_missing_steps" };
  }

  // ── Rule 6: CONTINUE — substep-only answer, more steps to probe ──
  if (interpretation.likelySubstepOnly && stepAccumulation.missingStepIds.length > 0 && hasTime) {
    return { action: "continue_probing", reason: "substep_answer_more_steps_needed" };
  }

  // ── Rule 7: CONTINUE — student has math evidence, early in session ──
  if (
    interpretation.hasMathEvidence &&
    stepAccumulation.missingStepIds.length > 0 &&
    attemptCount < maxAttempts - 1 &&
    hasTime
  ) {
    return { action: "continue_probing", reason: "math_evidence_with_missing_steps" };
  }

  // ── Rule 8: WRAP SUPPORT — closing window ──
  if (!hasTime) {
    return { action: "wrap_support", reason: "closing_window_time_constraint" };
  }

  // ── Rule 9: WRAP SUPPORT — near max attempts with no progress ──
  if (
    attemptCount >= maxAttempts - 1 &&
    stepAccumulation.satisfiedStepIds.length === 0 &&
    !stepAccumulation.answerCorrect
  ) {
    return { action: "wrap_support", reason: "max_attempts_no_progress" };
  }

  // ── Default: continue probing if there are missing steps ──
  if (stepAccumulation.missingStepIds.length > 0) {
    return { action: "continue_probing", reason: "missing_steps_default" };
  }

  return { action: "wrap_support", reason: "no_missing_steps_no_mastery" };
}

/** Internal helpers exposed only for unit tests. Not part of the public API. */
export const _testOnly = {
  selectFinalAnswer,
  containsDecompositionLanguage,
  extractDecompositionCandidates,
  isLikelyStrategySetup,
};
