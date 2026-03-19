/**
 * Deterministic Remediation Policy for Math Coaching
 *
 * When reasoningSteps exist, this module replaces generic LLM-driven follow-ups
 * with a small, fixed menu of remediation moves tied to the specific missing
 * reasoning step and the student's state.
 *
 * Every non-success coach turn must be explainable as:
 *   "We asked about step X because step X is the next missing step
 *    and the student state was Y."
 *
 * Pure functions, no LLM calls.
 */

import type { ReasoningStep, ReasoningStepKind } from "./prompt";
import type { ReasoningStepAccumulation, MathUtteranceInterpretation } from "./mathAnswerValidator";
import type { MathProblem } from "./mathProblem";
import {
  extractNumericAnswer,
  extractFinalAnswer,
  normalizeNumberWords,
  interpretMathUtterance,
} from "./mathAnswerValidator";
import {
  determineConversationStrategy,
  shouldUpgradeMove,
  type StrategyInput,
  type ConversationStrategyDecision,
  type Strategy,
} from "./conversationStrategy";

// ============================================================================
// Student state classification
// ============================================================================

/**
 * Classified student state for the current turn.
 * Drives which remediation template to use.
 */
export type StudentRemediationState =
  | "wrong"                  // Gave a wrong numeric answer, no specific misconception
  | "misconception"          // Gave a wrong answer that matches a known misconception pattern
  | "uncertain"              // Said "I don't know", hedged heavily, or gave no answer
  | "partial"                // Some steps satisfied but missing others, no wrong answer this turn
  | "hint_request"           // Explicitly asked for a hint
  | "concept_confusion"      // Asking about a concept: "what does ones mean?", "where did you get 10 and 10?"
  | "correct_incomplete"     // Correct final answer but missing step explanation
  | "alternate_setup"        // Student is setting up an alternate strategy (split/break/decompose)
  | "valid_inefficient"      // Student proposed a true decomposition that isn't the best strategy here
  | "noncanonical_active"       // Student is actively constructing or defending a multi-step non-canonical strategy
  | "math_relevant_resistance"  // Student resists coach's method but response is still math-relevant
  | "computation_mistake"       // Valid strategy structure but incorrect arithmetic inside it
  | "av_delivery_complaint"     // Student complains about audio/video quality ("your mouth is messed up")
  | "mixed_strategy_active"     // Student has canonical progress AND continues exploring non-canonical decomposition
  | "method_acknowledgment_repair";  // Student feels their math reasoning was ignored ("did you hear me?")

/**
 * Answer scope — what question was the student responding to?
 * Used to prevent misattributing sub-step answers to the whole problem.
 */
export type AnswerScope =
  | "ONES_SUBSTEP"      // Coach asked about ones (e.g., "What is 1 + 4?")
  | "TENS_SUBSTEP"      // Coach asked about tens (e.g., "What is 10 + 10?")
  | "COMBINE_SUBSTEP"   // Coach asked about combining (e.g., "What is 20 + 5?")
  | "WHOLE_PROBLEM"     // Coach asked the original question or student volunteered
  | "STRATEGY_SETUP"    // Coach asked about decomposition strategy
  | "CLARIFICATION";    // Student is clarifying/correcting a misattribution

/**
 * Specific misconception categories — drives the exact wording of the redirect.
 *
 * Each category maps to a deterministic template so the coach names the
 * misconception briefly and warmly before redirecting to the missing step.
 */
export type MisconceptionCategory =
  | "SUBTRACTION_ON_ADDITION"   // Student subtracted when they should add
  | "ADDITION_ON_SUBTRACTION"   // Student added when they should subtract
  | "MULTIPLICATION_MISUSE"     // Student multiplied when they should add/subtract
  | "ONES_ONLY_CONFUSION"       // Student only handled the ones, ignored tens
  | "TENS_ONLY_CONFUSION"       // Student only handled the tens, ignored ones
  | "KNOWN_WRONG_ANSWER"        // Answer matches a commonWrongAnswer from the problem
  | "GENERIC_WRONG";            // Wrong answer but no identifiable category

/**
 * Remediation move types — the small, fixed menu of responses.
 */
export type RemediationMoveType =
  | "STEP_PROBE_DIRECT"            // "What do you get when you add 1 and 4?"
  | "STEP_PROBE_SIMPLER"           // "Let's do just the ones. What is 1 + 4?"
  | "STEP_HINT"                    // "Hint: Start with the ones. What is 1 plus 4?"
  | "STEP_MISCONCEPTION_REDIRECT"  // "We're adding in this problem, not subtracting. What is 1 plus 4?"
  | "STEP_COMBINE_PROMPT"          // "Now that you have 5 and 20, what is 20 + 5?"
  | "STEP_ACKNOWLEDGE_AND_PROBE"   // "Good. What do you get when you add 1 and 4?"
  | "STEP_MODEL_INSTRUCTION"       // "In this problem, 10 + 10 = 20. Now what is 20 + 5?"
  | "STEP_COMPUTATION_CORRECTION"  // "Close — 14 + 10 is 24, not 34. What do you do with the 1 left?"
  | "STEP_CONCEPT_EXPLANATION"     // "Good question. In 14, the 1 means one ten... What is 10 + 10?"
  | "STEP_DEMONSTRATE_STEP"        // Escalation: model the answer after repeated uncertainty
  | "WRAP_SUCCESS"                 // All steps satisfied + correct answer
  | "WRAP_NEEDS_SUPPORT";          // Max attempts, no progress

/**
 * A fully resolved remediation move — deterministic text + metadata.
 */
export interface RemediationMove {
  /** The remediation move type. */
  type: RemediationMoveType;
  /** The full coach response text. */
  text: string;
  /** The step this move targets (null for WRAP moves). */
  targetStepId: string | null;
  /** The step kind this move targets (null for WRAP moves). */
  targetStepKind: ReasoningStepKind | null;
  /** The student state that triggered this move. */
  studentState: StudentRemediationState | "success";
  /** Specific misconception category when studentState is "misconception". */
  misconceptionCategory?: MisconceptionCategory;
  /** Human-readable explanation: "We asked about step X because..." */
  explanation: string;
}

// ============================================================================
// Misconception detection patterns
// ============================================================================

/** Patterns that indicate the student is subtracting instead of adding. */
const SUBTRACTION_LANGUAGE = /\b(?:take\s+away|taking\s+away|subtract(?:ed|ing)?|minus|took|less|took\s+off|take\s+off)\b/i;

/** Explicit subtraction expression: "A - B = C" */
const SUBTRACTION_EXPRESSION = /\d+\s*-\s*\d+\s*=\s*\d+/;

/** Patterns that indicate the student is adding instead of subtracting. */
const ADDITION_LANGUAGE_ON_SUBTRACTION = /\b(?:add(?:ed|ing)?|plus|put\s+together|putting\s+together)\b/i;

/** Patterns that indicate the student is multiplying instead of adding/subtracting. */
const MULTIPLICATION_MISCONCEPTION = /\b(?:times|multiply|multipli(?:ed|cation)|groups?\s+of)\b/i;

/** Patterns that indicate the student explicitly asked for a hint. */
const HINT_REQUEST = /\b(?:hint|help|clue|i need help|can you help|give me a hint|can i (?:have|get) a hint)\b/i;

/** Patterns that indicate uncertainty / "I don't know". */
const UNCERTAINTY_PATTERNS = [
  /\bi\s+(?:still\s+|really\s+|just\s+)?(?:don'?t|do\s*not)\s+know\b/i,
  /\bno\s*idea\b/i,
  /\bi'?m\s*(?:still\s+)?(?:not\s*sure|confused|stuck|lost)\b/i,
  /\bi\s+(?:still\s+|really\s+)?(?:can'?t|cannot)\s+(?:do|figure|solve|get)\b/i,
  /\bi\s*give\s*up\b/i,
  /^\s*(?:i\s*don'?t\s*know|idk|no|nope|um+|uh+)\s*[.!?]*\s*$/i,
];

/** No speech detected patterns. */
const NO_SPEECH = /^\s*$|no\s*speech\s*detected/i;

// ============================================================================
// Concept confusion detection
// ============================================================================

/**
 * Concept confusion categories — what the student is confused about.
 */
export type ConceptConfusionCategory =
  | "VOCABULARY"          // "what does ones mean?", "what are the tens?"
  | "DECOMPOSITION"       // "where did you get 10 and 10?", "why are you adding 10 and 10?"
  | "STRUCTURE"           // "what does that have to do with this problem?", "the problem says 14 + 11"
  | "DEMONSTRATION";      // "show me how", "can you explain it?"

/**
 * Patterns that detect concept-confusion/clarification requests.
 *
 * These are students asking WHY or WHAT about the coaching approach, not
 * giving answers or expressing generic uncertainty. Critically, these
 * should NOT be treated as off-topic or as generic "I don't know".
 */
const VOCABULARY_CONFUSION = [
  /\bwhat\s+(?:does|do|is|are)\s+(?:the\s+)?(?:ones?|tens?|digit|place\s*value)\b/i,
  /\bwhat\s+(?:does|do)\s+(?:ones?|tens?)\s+(?:place|digit)?\s*mean\b/i,
  /\bwhat(?:'s| is)\s+(?:a |the )?(?:ones?|tens?)\s*(?:place|digit|column)?\b/i,
  /\bi\s*don'?t\s*(?:know|understand|get)\s+(?:what\s+)?(?:the\s+)?(?:ones?|tens?|digit|place)\b/i,
];

const DECOMPOSITION_CONFUSION = [
  /\bwhere(?:'d| did)\s+(?:you |the |that )?(?:get|come|find)\b/i,
  /\bwhy\s+(?:are\s+(?:you|we)|did\s+(?:you|we))\s+(?:adding|subtracting|breaking|splitting)\b/i,
  /\bhow\s+(?:is|did)\s+\d+\s+(?:made|broken|split)\b/i,
  /\bwhy\s+(?:are\s+(?:you|we)\s+)?(?:breaking|splitting)\s+it\b/i,
  /\bhow\s+(?:is|does)\s+\d+\s+(?:equal|=)\s+\d+\s*\+\s*\d+\b/i,
];

const STRUCTURE_CONFUSION = [
  /\bwhat\s+does\s+(?:that|this|it)\s+have\s+to\s+do\s+with\b/i,
  /\bwhy\s+(?:are\s+(?:you|we)|do\s+(?:you|we))\s+(?:doing\s+)?(?:that|this)\b/i,
  /\bthe\s+problem\s+(?:says|is)\b/i,
  /\bthat(?:'s| is)\s+not\s+(?:the|what)\s+(?:problem|question)\b/i,
  /\bi\s+thought\s+(?:the\s+problem|we)\s+(?:was|were)\b/i,
  /\bwhat\s+(?:are\s+(?:you|we)|do\s+(?:you|we))\s+(?:even\s+)?doing\b/i,
  /\bwhy\s+(?:is|are)\s+(?:you|we)\s+doing\s+(?:that|this)\b/i,
];

const DEMONSTRATION_REQUEST = [
  /\bshow\s+me\b/i,
  /\bcan\s+you\s+(?:show|explain|tell|teach)\b/i,
  /\bi\s+need\s+(?:you\s+to\s+)?(?:show|explain|tell)\b/i,
  /\bexplain\s+(?:it|that|this|how)\b/i,
  /\bhow\s+(?:does?\s+)?(?:that|this|it)\s+work\b/i,
  /\bwouldn'?t\s+it\s+be\s+nice\s+if\s+you\s+(?:show|explain)\b/i,
  /\bplease\s+(?:show|explain|teach|help)\s+me\b/i,
];

/**
 * Detect whether the student's response is a concept-confusion or
 * clarification request rather than an answer attempt.
 *
 * Returns the confusion category if detected, null otherwise.
 *
 * IMPORTANT: This must be checked BEFORE generic uncertainty classification.
 * "I don't know what the ones mean" is concept confusion, not generic "I don't know".
 *
 * Edge case: if the student ALSO provides a numeric answer ("I think it's 30
 * because 10 + 10 is 30"), this is a wrong answer with misconception — NOT
 * concept confusion. The numeric answer takes priority.
 */
export function detectConceptConfusion(
  studentResponse: string,
  mathProblem: MathProblem,
): ConceptConfusionCategory | null {
  const trimmed = studentResponse.trim();
  if (!trimmed) return null;

  // If the student gave a numeric answer, it's not concept confusion —
  // it's a wrong/correct answer that should flow through normal classification.
  // Exception: questions that happen to mention numbers from the problem
  // ("where did you get the 10 and 10?") are still concept confusion.
  const normalized = normalizeNumberWords(trimmed);
  const extractedAnswer = extractNumericAnswer(normalized);
  if (extractedAnswer !== null) {
    // Check: is this actually a question about the coaching approach?
    // "Where did you get 10 and 10?" has extracted=10 but is concept confusion.
    // "I think it's 30" has extracted=30 and is an answer attempt.
    const isQuestion = /\?|^(?:where|why|what|how|show)\b/i.test(trimmed);
    const mentionsCoachAction = /\b(?:you|we|did\s+you|are\s+you|where(?:'d)?)\s+(?:get|said|say|adding|breaking|splitting|doing|come)\b/i.test(trimmed);
    // If the extracted number is a problem operand, the student may be
    // referencing the problem ("The problem says 14 + 11"), not answering.
    const referencesOperand = extractedAnswer === mathProblem.a ||
      extractedAnswer === mathProblem.b;
    const mentionsProblem = /\b(?:problem|question)\s+(?:says?|is)\b/i.test(trimmed);
    if (!isQuestion && !mentionsCoachAction && !referencesOperand && !mentionsProblem) {
      return null; // Genuine answer attempt, not concept confusion
    }
  }

  if (VOCABULARY_CONFUSION.some(p => p.test(trimmed))) return "VOCABULARY";
  if (DECOMPOSITION_CONFUSION.some(p => p.test(trimmed))) return "DECOMPOSITION";
  if (STRUCTURE_CONFUSION.some(p => p.test(trimmed))) return "STRUCTURE";
  if (DEMONSTRATION_REQUEST.some(p => p.test(trimmed))) return "DEMONSTRATION";

  return null;
}

// ============================================================================
// Misconception classification
// ============================================================================

/**
 * Detect the specific misconception category from the student's response.
 *
 * Returns the most specific category that matches, or null if no
 * misconception is detected. Called only when the answer is wrong.
 *
 * Priority order (most specific first):
 * 1. Operation confusion (subtraction on addition, etc.)
 * 2. Place-value confusion (ones-only, tens-only)
 * 3. Known wrong answer from commonWrongAnswers
 * 4. null (no identifiable misconception)
 */
export function detectMisconceptionCategory(
  studentResponse: string,
  extractedAnswer: number | null,
  mathProblem: MathProblem,
  stepAccumulation: ReasoningStepAccumulation,
): MisconceptionCategory | null {
  const trimmed = studentResponse.trim();

  // ── 1. Operation confusion ──────────────────────────────────

  if (mathProblem.skill === "two_digit_addition") {
    // Subtraction language or expression on an addition problem
    if (SUBTRACTION_LANGUAGE.test(trimmed) || SUBTRACTION_EXPRESSION.test(trimmed)) {
      return "SUBTRACTION_ON_ADDITION";
    }

    // Numeric subtraction/reversal detection: student's answer equals
    // |a - b| or |ones_a - ones_b|, suggesting they subtracted instead
    // of adding (e.g., "three" for 11+14 → |14-11|=3 or |4-1|=3).
    if (extractedAnswer !== null && mathProblem.b !== undefined) {
      const fullDiff = Math.abs(mathProblem.a - mathProblem.b);
      const onesDiff = Math.abs((mathProblem.a % 10) - (mathProblem.b % 10));
      if (
        (extractedAnswer === fullDiff && fullDiff !== mathProblem.correctAnswer && fullDiff > 0) ||
        (extractedAnswer === onesDiff && onesDiff !== mathProblem.correctAnswer && onesDiff > 0)
      ) {
        return "SUBTRACTION_ON_ADDITION";
      }
    }
  }

  if (mathProblem.skill === "two_digit_subtraction") {
    if (ADDITION_LANGUAGE_ON_SUBTRACTION.test(trimmed)) {
      return "ADDITION_ON_SUBTRACTION";
    }

    // Numeric addition detection: student's answer equals a + b or
    // ones_a + ones_b, suggesting they added instead of subtracting.
    if (extractedAnswer !== null && mathProblem.b !== undefined) {
      const fullSum = mathProblem.a + mathProblem.b;
      const onesSum = (mathProblem.a % 10) + (mathProblem.b % 10);
      if (
        (extractedAnswer === fullSum && fullSum !== mathProblem.correctAnswer) ||
        (extractedAnswer === onesSum && onesSum !== mathProblem.correctAnswer && onesSum > 0)
      ) {
        return "ADDITION_ON_SUBTRACTION";
      }
    }
  }

  if (
    mathProblem.skill !== "basic_multiplication" &&
    MULTIPLICATION_MISCONCEPTION.test(trimmed)
  ) {
    return "MULTIPLICATION_MISUSE";
  }

  // ── 2. Place-value confusion ────────────────────────────────
  // Detect when the student's answer equals just the ones or just the tens part.

  if (extractedAnswer !== null && mathProblem.b !== undefined) {
    if (mathProblem.skill === "two_digit_addition") {
      const onesSum = (mathProblem.a % 10) + (mathProblem.b % 10);
      const tensSum = Math.floor(mathProblem.a / 10) * 10 + Math.floor(mathProblem.b / 10) * 10;

      // Student gave ONLY the ones sum (e.g., "5" for 11+14)
      if (extractedAnswer === onesSum && onesSum !== mathProblem.correctAnswer) {
        return "ONES_ONLY_CONFUSION";
      }

      // Student gave ONLY the tens sum (e.g., "20" for 11+14)
      if (extractedAnswer === tensSum && tensSum !== mathProblem.correctAnswer) {
        return "TENS_ONLY_CONFUSION";
      }
    }

    if (mathProblem.skill === "two_digit_subtraction") {
      const onesDiff = (mathProblem.a % 10) - (mathProblem.b % 10);
      const tensDiff = Math.floor(mathProblem.a / 10) * 10 - Math.floor(mathProblem.b / 10) * 10;

      if (extractedAnswer === onesDiff && onesDiff >= 0 && onesDiff !== mathProblem.correctAnswer) {
        return "ONES_ONLY_CONFUSION";
      }

      if (extractedAnswer === tensDiff && tensDiff !== mathProblem.correctAnswer) {
        return "TENS_ONLY_CONFUSION";
      }
    }
  }

  // ── 3. Known wrong answer ───────────────────────────────────

  if (extractedAnswer !== null) {
    const match = mathProblem.commonWrongAnswers?.find(
      cwa => cwa.answer === extractedAnswer,
    );
    if (match) {
      return "KNOWN_WRONG_ANSWER";
    }
  }

  return null;
}

// ============================================================================
// Alternate strategy intermediate detection
// ============================================================================

/**
 * Check if an extracted answer is a valid intermediate in an alternate strategy.
 *
 * For two-digit addition a + b = c, a valid intermediate is a number that:
 * 1. Equals one addend plus a decomposition part of the other addend
 *    (e.g., 14 + 10 = 24 when solving 14 + 11, because 11 = 10 + 1)
 * 2. Can reach the correct answer by adding the remaining part
 *    (e.g., 24 + 1 = 25)
 * 3. The student's text shows evidence of this decomposition (mentions both
 *    the intermediate AND one of the original addends or decomposition parts)
 *
 * This prevents valid partial work from being classified as "wrong."
 */
function isAlternateStrategyIntermediate(
  extractedAnswer: number,
  mathProblem: MathProblem,
  normalizedText: string,
): boolean {
  const { a, correctAnswer } = mathProblem;
  const b = mathProblem.b ?? 0;
  if (!correctAnswer || !b) return false;

  const remainder = correctAnswer - extractedAnswer;
  // The intermediate must be close to the answer (within the smaller addend)
  // and the remainder must be small and positive
  if (remainder <= 0 || remainder >= Math.min(a, b)) return false;

  // Check: does extractedAnswer = a + (b - remainder) or b + (a - remainder)?
  // That would mean the student added one whole addend to part of the other.
  const partFromB = b - remainder;
  const partFromA = a - remainder;
  const validDecomp =
    (partFromB > 0 && partFromB < b && extractedAnswer === a + partFromB) ||
    (partFromA > 0 && partFromA < a && extractedAnswer === b + partFromA);
  if (!validDecomp) return false;

  // Verify the text shows evidence: mentions at least one original addend
  // and the intermediate result (not just a random number match)
  const mentionsAddend = new RegExp(`\\b${a}\\b`).test(normalizedText) ||
                          new RegExp(`\\b${b}\\b`).test(normalizedText);
  if (!mentionsAddend) return false;

  // Reject if the text contains BOTH original operands in an equation together.
  // "14 + 11 = 20" is a wrong whole-problem answer, not an alternate strategy
  // intermediate, even though 20 happens to be a valid intermediate value.
  const bothOperandsInEquation = new RegExp(
    `\\b${a}\\s*[+\\-]\\s*${b}\\b|\\b${b}\\s*[+\\-]\\s*${a}\\b`
  ).test(normalizedText);
  if (bothOperandsInEquation) return false;

  // ARITHMETIC VALIDITY GATE: verify the student's stated equation is correct.
  // "27 + 10 = 55" is wrong arithmetic (27+10=37, not 55) even though 55
  // happens to be a valid split-addend intermediate value (27+28=55).
  // Extract equations of the form "X + Y = Z" or "X - Y = Z" from the text
  // and reject if any equation involving the extracted answer is invalid.
  const eqPattern = /(\d+)\s*([+\-]|plus|minus)\s*(\d+)\s*(?:=|is|equals?)\s*(\d+)/gi;
  let eqMatch: RegExpExecArray | null;
  while ((eqMatch = eqPattern.exec(normalizedText)) !== null) {
    const left = parseInt(eqMatch[1]);
    const opStr = eqMatch[2];
    const op = (opStr === "-" || opStr === "minus") ? "-" : "+";
    const right = parseInt(eqMatch[3]);
    const stated = parseInt(eqMatch[4]);
    // Only check equations whose result is the extracted answer
    if (stated === extractedAnswer) {
      const expected = op === "+" ? left + right : left - right;
      if (expected !== stated) {
        return false; // Student's arithmetic is wrong — not a valid intermediate
      }
    }
  }

  return true;
}

/**
 * Detect when the student is setting up an alternate strategy.
 *
 * Signals: student mentions splitting, breaking apart, or decomposing one of
 * the problem's operands, but has not yet produced a valid intermediate result.
 *
 * Examples:
 * - "how would I split up the 11"
 * - "I could split 11 into 10 and 1"
 * - "I want to break apart the 11"
 * - "I was going to take 14 and split 11"
 */
const ALTERNATE_SETUP_PATTERNS = [
  /\b(?:split|break|separate|take\s+apart|break\s+apart|decompose)\s+(?:up\s+)?(?:the\s+|that\s+)?(\d+)/i,
  /\b(?:split|break|separate)\s+(?:it|that|them)\s+(?:up\s+)?(?:into|to)\b/i,
  /\bhow\s+(?:would|do|can|could|should)\s+I\s+(?:split|break|separate|take\s+apart)\b/i,
  /\bI\s+(?:want|could|would|am going|was going|think I(?:'ll| will))\s+(?:to\s+)?(?:split|break|separate|take\s+apart)\b/i,
  /\b(?:split|break)\s+(?:the\s+)?numbers?\b/i,
  /\b(?:use|try)\s+(?:a\s+)?(?:different|another|other)\s+(?:way|method|strategy)\b/i,
];

function detectAlternateStrategySetup(
  studentResponse: string,
  mathProblem: MathProblem,
): boolean {
  const trimmed = studentResponse.trim();
  if (!ALTERNATE_SETUP_PATTERNS.some(p => p.test(trimmed))) return false;

  // Verify the student references one of the problem's operands
  const normalized = normalizeNumberWords(trimmed);
  const a = mathProblem.a;
  const b = mathProblem.b ?? 0;
  const mentionsOperand = new RegExp(`\\b${a}\\b`).test(normalized) ||
                            new RegExp(`\\b${b}\\b`).test(normalized);

  // Also accept if they say "split it" / "split the numbers" without naming the specific number
  const genericSplit = /\b(?:split|break)\s+(?:it|that|them|the\s+numbers?)\b/i.test(trimmed);

  return mentionsOperand || genericSplit;
}

/**
 * Detect when the student proposes a mathematically valid decomposition of
 * one of the problem's operands that isn't the canonical tens+ones split.
 *
 * Examples:
 * - "14 could be 7 + 7" (true: 7+7=14, but not tens+ones)
 * - "11 could be 5 + 6" (true: 5+6=11, but not tens+ones)
 * - "I could break 14 into 6 and 8" (true: 6+8=14)
 *
 * Returns the decomposition details if found, or null.
 */
function detectValidInefficientDecomposition(
  studentResponse: string,
  mathProblem: MathProblem,
): { operand: number; partA: number; partB: number } | null {
  const normalized = normalizeNumberWords(studentResponse.trim());
  const a = mathProblem.a;
  const b = mathProblem.b ?? 0;

  // Pattern 1: "14 could be 7 + 7", "14 is also 7 + 7", "14 = 7 + 7", "14 is 7 + 7"
  const equivPattern = /\b(\d+)\s+(?:could\s+(?:also\s+)?be\s+|is\s+(?:also\s+)?|=\s*|equals?\s+)(?:a\s+)?(\d+)\s*(?:\+|and|plus)\s*(\d+)\b/gi;
  let match;
  while ((match = equivPattern.exec(normalized)) !== null) {
    const operand = parseInt(match[1]);
    const pA = parseInt(match[2]);
    const pB = parseInt(match[3]);
    if ((operand === a || operand === b) && pA + pB === operand) {
      // Check it's NOT the canonical tens+ones split
      const tens = Math.floor(operand / 10) * 10;
      const ones = operand % 10;
      if (!((pA === tens && pB === ones) || (pA === ones && pB === tens))) {
        return { operand, partA: pA, partB: pB };
      }
    }
  }

  // Pattern 2: "break/split/splitting 14 into 6 and 8", "split 14 into 7 + 7"
  const breakPattern = /\b(?:break|split|separat|decompos)\w*\s+(?:up\s+)?(?:the\s+|that\s+)?(\d+)\s+(?:(?:up\s+)?into|to|as)\s+(?:a\s+)?(\d+)\s*(?:\+|and|plus)\s*(?:a\s+)?(\d+)\b/gi;
  while ((match = breakPattern.exec(normalized)) !== null) {
    const operand = parseInt(match[1]);
    const pA = parseInt(match[2]);
    const pB = parseInt(match[3]);
    if ((operand === a || operand === b) && pA + pB === operand) {
      const tens = Math.floor(operand / 10) * 10;
      const ones = operand % 10;
      if (!((pA === tens && pB === ones) || (pA === ones && pB === tens))) {
        return { operand, partA: pA, partB: pB };
      }
    }
  }

  // Pattern 3: "split it 5 + 9" (no operand named, infer from parts)
  const splitItPattern = /\b(?:break|split|separat|decompos)\w*\s+(?:up\s+)?(?:it|that|them|the\s+numbers?)\s+(?:(?:into|to|as)\s+)?(?:a\s+)?(\d+)\s*(?:\+|and|plus)\s*(?:a\s+)?(\d+)\b/gi;
  while ((match = splitItPattern.exec(normalized)) !== null) {
    const pA = parseInt(match[1]);
    const pB = parseInt(match[2]);
    const operand = pA + pB;
    if ((operand === a || operand === b) && pA + pB === operand) {
      const tens = Math.floor(operand / 10) * 10;
      const ones = operand % 10;
      if (!((pA === tens && pB === ones) || (pA === ones && pB === tens))) {
        return { operand, partA: pA, partB: pB };
      }
    }
  }

  // Pattern 4: Reverse equation "5 + 9 = 14"
  const reversePattern = /\b(\d+)\s*(?:\+|and|plus)\s*(\d+)\s*(?:=|is|equals?|makes?)\s*(\d+)\b/gi;
  while ((match = reversePattern.exec(normalized)) !== null) {
    const pA = parseInt(match[1]);
    const pB = parseInt(match[2]);
    const operand = parseInt(match[3]);
    if ((operand === a || operand === b) && pA + pB === operand) {
      const tens = Math.floor(operand / 10) * 10;
      const ones = operand % 10;
      if (!((pA === tens && pB === ones) || (pA === ones && pB === tens))) {
        return { operand, partA: pA, partB: pB };
      }
    }
  }

  return null;
}

// ============================================================================
// Stated decomposition parts (for method-ownership mirroring)
// ============================================================================

/**
 * Detect whether the student stated specific decomposition parts for an operand.
 *
 * This is broader than detectValidInefficientDecomposition — it catches BOTH
 * canonical and non-canonical stated parts, so the coach can mirror what the
 * student actually said before deciding whether to redirect.
 *
 * Examples:
 * - "split 11 into 10 and 1" → { operand: 11, partA: 10, partB: 1, isCanonical: true }
 * - "split 14 into 7 and 7" → { operand: 14, partA: 7, partB: 7, isCanonical: false }
 * - "I could split the 11" → null (no parts stated)
 */
function detectStatedDecompositionParts(
  normalizedText: string,
  a: number,
  b: number,
): { operand: number; partA: number; partB: number; isCanonical: boolean } | null {
  // Helper to validate and return a match
  const tryMatch = (operand: number, pA: number, pB: number) => {
    if ((operand === a || operand === b) && pA + pB === operand) {
      const tens = Math.floor(operand / 10) * 10;
      const ones = operand % 10;
      const isCanonical = (pA === tens && pB === ones) || (pA === ones && pB === tens);
      return { operand, partA: pA, partB: pB, isCanonical };
    }
    return null;
  };

  const patterns: RegExp[] = [
    // "split/break/splitting 14 into 7 and 7", "splitting up the 14 to 5 + 9"
    /\b(?:break|split|separat|decompos)\w*\s+(?:up\s+)?(?:the\s+|that\s+)?(\d+)\s+(?:(?:up\s+)?into|to|as)\s+(?:a\s+)?(\d+)\s*(?:\+|and|plus)\s*(?:a\s+)?(\d+)\b/gi,
    // "split it 5 + 9", "split it to 5 + 9", "break it into 7 and 7"
    /\b(?:break|split|separat|decompos)\w*\s+(?:up\s+)?(?:it|that|them|the\s+numbers?)\s+(?:(?:into|to|as)\s+)?(?:a\s+)?(\d+)\s*(?:\+|and|plus)\s*(?:a\s+)?(\d+)\b/gi,
    // "14 into 7 and 7", "14 is 7 + 7", "14 = 10 + 4", "14 could be 5 + 9"
    /\b(\d+)\s+(?:into|is|=|equals?|could\s+(?:also\s+)?be|can\s+be)\s+(?:a\s+)?(\d+)\s*(?:\+|and|plus)\s*(?:a\s+)?(\d+)\b/gi,
    // Reverse equation: "5 + 9 = 14", "7 and 7 is 14", "5 + 9 equals 14"
    /\b(\d+)\s*(?:\+|and|plus)\s*(\d+)\s*(?:=|is|equals?|makes?|gives?\s+(?:me\s+)?)\s*(\d+)\b/gi,
  ];

  for (let pi = 0; pi < patterns.length; pi++) {
    const pattern = patterns[pi];
    let match;
    while ((match = pattern.exec(normalizedText)) !== null) {
      if (pi === 1) {
        // "split it 5 + 9" — no operand captured, infer from parts
        const pA = parseInt(match[1]);
        const pB = parseInt(match[2]);
        const operand = pA + pB;
        const result = tryMatch(operand, pA, pB);
        if (result) return result;
      } else if (pi === 3) {
        // Reverse: "5 + 9 = 14" → operand is match[3]
        const pA = parseInt(match[1]);
        const pB = parseInt(match[2]);
        const operand = parseInt(match[3]);
        const result = tryMatch(operand, pA, pB);
        if (result) return result;
      } else {
        // Forward: operand = match[1], parts = match[2], match[3]
        const operand = parseInt(match[1]);
        const pA = parseInt(match[2]);
        const pB = parseInt(match[3]);
        const result = tryMatch(operand, pA, pB);
        if (result) return result;
      }
    }
  }

  return null;
}

// ============================================================================
// Redirect acceptance detection
// ============================================================================

/**
 * Detect whether the student has accepted the coach's redirect to canonical.
 *
 * Signals: "ok", "sure", "that's easier", "let's do it that way", "you're right",
 * "makes sense", "ok let's try that", or the student directly answers the
 * canonical probe (e.g., gives "5" after being asked "What is 4 + 1?").
 */
const REDIRECT_ACCEPTANCE_PATTERNS = [
  /\b(?:ok(?:ay)?|sure|alright|fine|yeah|yes|yep)\b/i,
  /\bthat(?:'s| is) (?:easier|simpler|better|fine)\b/i,
  /\blet(?:'s| us) (?:do|try) (?:it |that |this )?(?:way|that|this|instead)?\b/i,
  /\byou(?:'re| are) right\b/i,
  /\bmakes? sense\b/i,
  /\bgood (?:idea|point)\b/i,
  /\bI(?:'ll| will) (?:try|do) (?:it |that )?(?:your |that |this )?way\b/i,
];

/**
 * Check if the student has accepted a prior canonical redirect.
 *
 * Scans conversation history for a pattern: coach proposed canonical redirect,
 * then student responded with acceptance language or answered the canonical probe.
 *
 * Returns true if the most recent redirect was accepted.
 */
function hasAcceptedCanonicalRedirect(
  conversationHistory: Array<{ role: string; message: string }> | undefined,
): boolean {
  if (!conversationHistory || conversationHistory.length < 2) return false;

  // Walk backwards looking for the most recent coach redirect + student response
  for (let i = conversationHistory.length - 1; i >= 1; i--) {
    const entry = conversationHistory[i];
    if (entry.role !== "student") continue;

    // Check the coach message before this student message
    const prevCoach = conversationHistory.slice(0, i).reverse().find(e => e.role === "coach");
    if (!prevCoach) continue;

    // Was the coach message a redirect? Look for canonical method fingerprints
    const isRedirect = /\btens and ones\b|\beasier\b.*\b(?:split|break)\b|\b\d+\s*\+\s*\d+.*\bwhat\b/i.test(prevCoach.message);
    if (!isRedirect) continue;

    // Did the student accept?
    if (REDIRECT_ACCEPTANCE_PATTERNS.some(p => p.test(entry.message))) {
      return true;
    }

    // Or did the student answer the canonical probe with a number?
    const hasNumber = /\b\d+\b/.test(normalizeNumberWords(entry.message));
    const noResistance = !RESISTANCE_PATTERNS.some(p => p.test(entry.message));
    if (hasNumber && noResistance) {
      return true;
    }

    break; // Only check the most recent redirect-response pair
  }

  return false;
}

// ============================================================================
// Answer-scope attribution
// ============================================================================

/**
 * Map a ReasoningStepKind to the corresponding AnswerScope.
 */
function stepKindToScope(kind: ReasoningStepKind): AnswerScope {
  switch (kind) {
    case "identify_ones":
    case "ones_sum":
      return "ONES_SUBSTEP";
    case "identify_tens":
    case "tens_sum":
      return "TENS_SUBSTEP";
    case "combine":
    case "final_answer":
      return "COMBINE_SUBSTEP";
    default:
      return "WHOLE_PROBLEM";
  }
}

/**
 * Detect what scope the student's current answer is responding to.
 *
 * Looks at the last coach message and matches it against known step probes
 * and reasoning step patterns. Returns the scope so downstream code can
 * avoid misattributing sub-step answers to the whole problem.
 */
export function detectActiveAnswerScope(
  conversationHistory: Array<{ role: string; message: string }> | undefined,
  reasoningSteps: ReasoningStep[] | undefined,
  mathProblem: MathProblem,
  studentResponse?: string,
): AnswerScope {
  if (studentResponse) {
    // Check for attribution clarification — student correcting a specific numerical misattribution.
    // E.g., "I didn't say 14 + 11 = 20, I said 10 + 10 = 20"
    const hasCorrectionFrame = /\bI\s+(?:didn'?t\s+say|never\s+said|wasn'?t\s+saying)\b.*\bI\s+said\b/i.test(studentResponse)
      || /\bI\s+said\s+\d+\s+for\b/i.test(studentResponse);
    const hasNumericalContext = /\b\d+\s*(?:\+|plus)\s*\d+\s*(?:=|is|equals|gets?\s+(?:me|you)?)\s*\d+\b/i.test(studentResponse);
    if (hasCorrectionFrame && hasNumericalContext) return "CLARIFICATION";

    // CONTRADICTION-AWARE SCOPE: Student explicitly negates one substep and names another.
    // E.g., "I didn't answer the five but 10 and 10 is 20" — negates ones, names tens.
    // This overrides the default coach-message-based scope guess.
    if (reasoningSteps) {
      const overrideScope = detectContradictionScope(studentResponse, reasoningSteps, mathProblem);
      if (overrideScope) return overrideScope;
    }
  }

  if (!conversationHistory || conversationHistory.length === 0) return "WHOLE_PROBLEM";

  // Find the last coach message
  let lastCoachMsg: string | null = null;
  for (let i = conversationHistory.length - 1; i >= 0; i--) {
    if (conversationHistory[i].role === "coach") {
      lastCoachMsg = conversationHistory[i].message;
      break;
    }
  }
  if (!lastCoachMsg) return "WHOLE_PROBLEM";

  // Check for strategy setup language in coach message
  if (/\b(?:split|break|decompose)\b/i.test(lastCoachMsg) && /\bhow\b/i.test(lastCoachMsg)) {
    return "STRATEGY_SETUP";
  }

  // Match against reasoning step probes
  if (reasoningSteps) {
    for (const step of reasoningSteps) {
      // Match exact probe text
      if (step.probe && lastCoachMsg.includes(step.probe)) {
        return stepKindToScope(step.kind);
      }
      // Match numbers from expectedStatements in the coach question
      for (const stmt of step.expectedStatements) {
        const match = stmt.match(/^(\d+)\s*[+\-×÷]\s*(\d+)/);
        if (match) {
          const left = match[1];
          const right = match[2];
          const computePattern = new RegExp(`\\b${left}\\s*(?:\\+|plus|and)\\s*${right}\\b`, "i");
          if (computePattern.test(lastCoachMsg)) {
            return stepKindToScope(step.kind);
          }
        }
      }
    }
  }

  // If coach asked the original problem, it's whole-problem scope
  const a = mathProblem.a;
  const b = mathProblem.b ?? 0;
  const wholePattern = new RegExp(`\\b${a}\\s*(?:\\+|plus|and)\\s*${b}\\b|\\b${b}\\s*(?:\\+|plus|and)\\s*${a}\\b`, "i");
  if (wholePattern.test(lastCoachMsg)) {
    return "WHOLE_PROBLEM";
  }

  return "WHOLE_PROBLEM";
}

/**
 * Detect when the student explicitly contradicts the default scope by negating
 * one substep and positively naming another.
 *
 * E.g., "I didn't answer the five but 10 and 10 is 20"
 * → negates ones (five/5/4+1), positively names tens (10+10=20)
 * → return TENS_SUBSTEP
 */
function detectContradictionScope(
  studentResponse: string,
  reasoningSteps: ReasoningStep[],
  mathProblem: MathProblem,
): AnswerScope | null {
  const normalized = normalizeNumberWords(studentResponse.trim());
  const lower = normalized.toLowerCase();

  // Look for negation: "didn't answer", "didn't say", "not the", "wasn't answering"
  const hasNegation = /\b(?:didn'?t|did not|wasn'?t|not)\s+(?:answer|say|do|mean|get)\b/i.test(lower)
    || /\bnot\s+the\s+(?:five|four|one|ten|twenty)\b/i.test(lower);
  if (!hasNegation) return null;

  // Look for a positive computation: "10 and 10 is 20", "10 + 10 = 20", etc.
  const compMatch = normalized.match(/\b(\d+)\s*(?:\+|and|plus)\s*(\d+)\s*(?:=|is|equals|gets?\s*(?:me\s+)?)\s*(\d+)\b/i);
  if (!compMatch) return null;

  const left = parseInt(compMatch[1]);
  const right = parseInt(compMatch[2]);

  // Match the positive computation to a reasoning step
  for (const step of reasoningSteps) {
    for (const stmt of step.expectedStatements) {
      const stmtMatch = stmt.match(/^(\d+)\s*[+\-]\s*(\d+)/);
      if (stmtMatch) {
        const sLeft = parseInt(stmtMatch[1]);
        const sRight = parseInt(stmtMatch[2]);
        if ((left === sLeft && right === sRight) || (left === sRight && right === sLeft)) {
          return stepKindToScope(step.kind);
        }
      }
    }
  }

  return null;
}

/**
 * Get the step-specific expression for an AnswerScope.
 * E.g., for TENS_SUBSTEP returns "10 + 10" instead of "14 + 11".
 */
export function getScopeExpression(
  scope: AnswerScope,
  reasoningSteps: ReasoningStep[] | undefined,
  mathProblem: MathProblem,
): string {
  if (scope === "WHOLE_PROBLEM" || scope === "STRATEGY_SETUP" || scope === "CLARIFICATION") {
    return mathProblem.expression;
  }
  if (!reasoningSteps) return mathProblem.expression;

  const targetKinds: ReasoningStepKind[] = scope === "ONES_SUBSTEP"
    ? ["identify_ones", "ones_sum"]
    : scope === "TENS_SUBSTEP"
      ? ["identify_tens", "tens_sum"]
      : ["combine", "final_answer"];

  for (const step of reasoningSteps) {
    if (targetKinds.includes(step.kind)) {
      const stmt = step.expectedStatements[0];
      if (stmt) {
        // Extract left-hand side: "10 + 10 = 20" → "10 + 10"
        const eqMatch = stmt.match(/^(.+?)\s*=\s*\d+$/);
        return eqMatch ? eqMatch[1].trim() : stmt;
      }
    }
  }
  return mathProblem.expression;
}

// ============================================================================
// Multi-decomposition and pushback detection
// ============================================================================

/**
 * Detect when the student proposes TWO or more non-canonical decompositions
 * of the problem's operands and/or computes with them.
 *
 * Examples:
 * - "split 14 into 7+7, split 11 into 5+6, so 7+6=13"
 * - "14 is 7+7 and 11 is 5+6"
 * - "break 14 into 7 and 7 break 11 into 5 and 6 7 plus 6 is 13"
 *
 * Returns the decompositions if found, or null.
 */
/**
 * Detect repeated-addition strategy for multiplication problems.
 * E.g., "4+4+4=12" for 3×4, or "3+3+3+3=12" for 3×4.
 *
 * Returns:
 * - "correct" if the repeated addition matches the problem and sum is correct
 * - "partial" if valid repeated addition is in progress but incomplete
 * - "wrong" if repeated addition structure but bad arithmetic
 * - null if not a repeated-addition utterance
 */
function detectRepeatedAddition(
  normalized: string,
  mathProblem: MathProblem,
): "correct" | "partial" | "wrong" | null {
  const { a, b, correctAnswer } = mathProblem;
  if (!b) return null;

  // Match patterns like "4 + 4 + 4 = 12" or "4 plus 4 plus 4 is 12"
  // First, extract all numbers from addition chains
  const addChain = normalized.match(/(\d+)(?:\s*(?:\+|plus)\s*(\d+))+/i);
  if (!addChain) return null;

  // Extract the full chain of addends
  const fullMatch = addChain[0];
  const addends = [...fullMatch.matchAll(/\d+/g)].map(m => parseInt(m[0]));
  if (addends.length < 2) return null;

  // Check if all addends are the same number
  const addend = addends[0];
  if (!addends.every(n => n === addend)) return null;

  // The repeated addend should be one of the problem's operands
  if (addend !== a && addend !== b) return null;

  const count = addends.length;
  const expectedCount = addend === a ? b : a; // if adding "a" repeatedly, need "b" copies
  const sum = addend * count;

  // Check if the student stated a result
  const resultMatch = normalized.match(new RegExp(
    fullMatch.replace(/[+*?.()[\]{}|\\^$]/g, '\\$&') + '\\s*(?:=|is|equals?)\\s*(\\d+)', 'i'
  ));

  if (resultMatch) {
    const statedResult = parseInt(resultMatch[1]);
    if (statedResult === correctAnswer && sum === correctAnswer) {
      return "correct";
    }
    // Bad arithmetic or wrong total
    return "wrong";
  }

  // No stated result — check if the chain itself is complete or partial
  if (count === expectedCount && sum === correctAnswer) {
    return "correct"; // "4+4+4" without "=12" but complete chain
  }
  if (count < expectedCount) {
    return "partial"; // e.g., "4+4" for 3×4
  }

  return null;
}

function detectMultiDecompositionStrategy(
  studentResponse: string,
  mathProblem: MathProblem,
): { decomps: Array<{ operand: number; partA: number; partB: number }>; computed?: { left: number; right: number; result: number } } | null {
  const normalized = normalizeNumberWords(studentResponse.trim());
  const a = mathProblem.a;
  const b = mathProblem.b ?? 0;

  const decomps: Array<{ operand: number; partA: number; partB: number }> = [];

  // Find all decompositions: "14 into 7+7", "14 is 7+7", "14 = 7+7", "split 14 into 7 and 7"
  // Also handles STT variants: "split up the 14 to 7 + 7"
  const patterns = [
    /\b(\d+)\s+(?:into|is|=|equals?|could\s+(?:also\s+)?be|is\s+also)\s+(?:a\s+)?(\d+)\s*(?:\+|and|plus)\s*(?:a\s+)?(\d+)\b/gi,
    /\b(?:break|split|separate|make)\s+(?:up\s+)?(?:the\s+|that\s+)?(\d+)\s+(?:(?:up\s+)?into|to|as)\s+(?:a\s+)?(\d+)\s*(?:\+|and|plus)\s*(?:a\s+)?(\d+)\b/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(normalized)) !== null) {
      const operand = parseInt(match[1]);
      const pA = parseInt(match[2]);
      const pB = parseInt(match[3]);
      if ((operand === a || operand === b) && pA + pB === operand) {
        // Check it's NOT the canonical tens+ones split
        const tens = Math.floor(operand / 10) * 10;
        const ones = operand % 10;
        if (!((pA === tens && pB === ones) || (pA === ones && pB === tens))) {
          // Avoid duplicates
          if (!decomps.some(d => d.operand === operand)) {
            decomps.push({ operand, partA: pA, partB: pB });
          }
        }
      }
    }
  }

  if (decomps.length < 2) return null;

  // Check for computed result: "7 + 6 = 13", "7 plus 6 13", "so 13"
  let computed: { left: number; right: number; result: number } | undefined;
  const computeMatch = normalized.match(/\b(\d+)\s*(?:\+|plus)\s*(\d+)\s*(?:=|is|gives|makes|gets?)?\s*(\d+)\b/i);
  if (computeMatch) {
    const l = parseInt(computeMatch[1]);
    const r = parseInt(computeMatch[2]);
    const res = parseInt(computeMatch[3]);
    // Only count if the operands come from the decomposed parts
    const allParts = decomps.flatMap(d => [d.partA, d.partB]);
    if (allParts.includes(l) && allParts.includes(r) && l + r === res) {
      // Exclude if result equals an original operand — that's a decomposition
      // verification (e.g. "6 + 5 = 11" restating 11 = 5+6), not cross-pair work.
      const origOperands = decomps.map(d => d.operand);
      if (!origOperands.includes(res)) {
        computed = { left: l, right: r, result: res };
      }
    }
  }

  return { decomps, computed };
}

/**
 * Detect a multi-decomposition strategy spread across conversation turns.
 * Unlike detectMultiDecompositionStrategy (single utterance), this checks
 * conversation history for decompositions stated in prior student turns and
 * combines them with the current utterance.
 *
 * Example multi-turn sequence:
 * Turn 1: "14 = 7 + 7"   → decomposition of operand a
 * Turn 2: "11 = 5 + 6"   → decomposition of operand b
 * Turn 3: "7 + 6 = 13"   → cross-decomposition computation
 * Turn 4: "then 7 makes 20, 5 left over" → continuing strategy
 */
function detectMultiTurnDecompositionStrategy(
  studentResponse: string,
  mathProblem: MathProblem,
  conversationHistory?: Array<{ role: string; message: string }>,
): { decomps: Array<{ operand: number; partA: number; partB: number }>; isContinuation: boolean } | null {
  if (!conversationHistory || conversationHistory.length === 0) return null;

  // Collect all non-canonical decompositions from student history + current
  const allDecomps: Array<{ operand: number; partA: number; partB: number }> = [];
  const a = mathProblem.a;
  const b = mathProblem.b ?? 0;

  for (const entry of conversationHistory) {
    if (entry.role !== "student") continue;
    const decomp = detectValidInefficientDecomposition(entry.message, mathProblem);
    if (decomp && !allDecomps.some(d => d.operand === decomp.operand)) {
      allDecomps.push(decomp);
    }
    const multi = detectMultiDecompositionStrategy(entry.message, mathProblem);
    if (multi) {
      for (const d of multi.decomps) {
        if (!allDecomps.some(dd => dd.operand === d.operand)) {
          allDecomps.push(d);
        }
      }
    }
  }

  // Also check current utterance
  const currentDecomp = detectValidInefficientDecomposition(studentResponse, mathProblem);
  if (currentDecomp && !allDecomps.some(d => d.operand === currentDecomp.operand)) {
    allDecomps.push(currentDecomp);
  }

  // Need at least 2 decompositions (both operands) across all turns
  if (allDecomps.length < 2) return null;
  const hasA = allDecomps.some(d => d.operand === a);
  const hasB = allDecomps.some(d => d.operand === b);
  if (!hasA || !hasB) return null;

  // Check if current utterance is a continuation of the strategy:
  // uses parts from the decompositions, "left over", computation, etc.
  const normalized = normalizeNumberWords(studentResponse.trim());
  const allParts = allDecomps.flatMap(d => [d.partA, d.partB]);
  const mentionsPart = allParts.some(p => new RegExp(`\\b${p}\\b`).test(normalized));
  const hasLeftover = /\bleft\s*over\b|\bremain/i.test(studentResponse);
  const hasComputation = /\b\d+\s*(?:\+|plus)\s*\d+\b/i.test(normalized) || /\bmakes?\b.*\b\d+\b/i.test(normalized);

  const isContinuation = mentionsPart || hasLeftover || hasComputation;

  return { decomps: allDecomps, isContinuation };
}

/**
 * Detect math-relevant resistance: the student resists the coach's suggested
 * method but their response is still mathematically engaged.
 *
 * This is broader than simple pushback — it covers:
 * - Defense: "that's not what I said, I said split 14 into 7+7"
 * - Questioning: "why can't I do 7 + 6?"
 * - Objection: "that has nothing to do with the problem, I'm adding 14 and 11"
 * - Method preference: "I was trying to split the 11, not do 4 + 1"
 * - Why-resistance: "why wouldn't we split it to 7 and 7"
 *
 * MUST NOT fire on:
 * - Generic frustration without math content ("I don't want to do this")
 * - Hostile statements without method references ("you're wrong")
 * - Pure concept confusion ("what does ones mean?")
 *
 * Core product rule: math-relevant resistance is engagement, not failure.
 */
const RESISTANCE_PATTERNS = [
  // Defense / pushback
  /\bthat(?:'s| is) not what I (?:said|meant|was doing|was trying)\b/i,
  /\bno\b.*\bI (?:said|meant|was)\b/i,
  /\bbut I (?:said|was|want(?:ed)?)\b/i,
  /\bI (?:already |just )?(?:said|told you|explained)\b/i,
  /\bI (?:was|am) (?:trying|doing|splitting|breaking|adding)\b/i,
  /\bmy (?:way|method|answer|strategy)\b/i,
  /\bthat(?:'s| is) not (?:right|correct|what)\b.*\bI\b/i,
  /\byou(?:'re| are) not listening\b/i,
  /\blisten\b.*\bI (?:said|was)\b/i,
  // Questioning the method
  /\bwhy\s+(?:can'?t|couldn'?t|wouldn'?t|don'?t|won'?t)\s+(?:I|we)\b/i,
  /\bwhy\s+(?:are|do)\s+we\s+doing\s+it\s+(?:that|this|your)\s+way\b/i,
  /\bwhy\s+(?:are|do)\s+we\s+(?:have\s+to|need\s+to)\b/i,
  // Objection / irrelevance claim
  /\bthat\s+(?:has|doesn'?t\s+have)\s+(?:nothing|anything)\s+to\s+do\s+with\b/i,
  /\bthat(?:'s| is)\s+not\s+(?:really\s+)?(?:what\s+I\s+was\s+trying|the\s+(?:same|right)\s+(?:thing|way))\b/i,
  // Method preference with "not"
  /\bnot\s+(?:do(?:ing)?|use|using)\s+(?:that|this|your|the)\b/i,
  /\bI\s+(?:was|am)\s+(?:trying|doing)\b.*\bnot\s+(?:do(?:ing)?|that)\b/i,
];

// ============================================================================
// Replacement pair detection and noncanonical combine helpers
// ============================================================================

/**
 * Detect when the student corrects the coach's combine target and supplies
 * a replacement pair. Returns the pair or null.
 *
 * Examples:
 * - "I think you mean 6 + 6"
 * - "it's supposed to be 7 + 6"
 * - "no, 6 + 5"
 * - "shouldn't it be 6 + 6"
 * - "that's not how you're supposed to do it, it's supposed to be 7 + 6"
 * - "not 8 + 5, it should be 6 + 6"
 */
function detectReplacementPair(
  studentResponse: string,
): { left: number; right: number } | null {
  const trimmed = studentResponse.trim();
  const patterns = [
    // "I think you mean 6+6", "you mean 6+6"
    /\byou\s+mean\s+(\d+)\s*(?:\+|plus)\s*(\d+)\b/i,
    // "it's supposed to be 7+6", "supposed to be 7+6"
    /\bsupposed\s+to\s+be\s+(\d+)\s*(?:\+|plus)\s*(\d+)\b/i,
    // "shouldn't it be 6+6"
    /\bshouldn'?t\s+it\s+be\s+(\d+)\s*(?:\+|plus)\s*(\d+)\b/i,
    // "it should be 6+6", "it's 7+6"
    /\bit\s+(?:should|is|'s)\s+(?:be\s+)?(\d+)\s*(?:\+|plus)\s*(\d+)\b/i,
    // "no, 6+5" / "no 6+6"
    /\bno[,.]?\s+(\d+)\s*(?:\+|plus)\s*(\d+)\b/i,
    // "not 8+5, it should be 6+6" → extract the second pair
    /\bnot\s+\d+\s*(?:\+|plus)\s*\d+.*?(\d+)\s*(?:\+|plus)\s*(\d+)\b/i,
  ];

  for (const p of patterns) {
    const m = p.exec(trimmed);
    if (m) {
      return { left: parseInt(m[1]), right: parseInt(m[2]) };
    }
  }
  return null;
}

/**
 * Check if a replacement pair is mathematically relevant to the problem.
 * The parts must come from a valid decomposition of the operands.
 */
function isReplacementPairRelevant(
  pair: { left: number; right: number },
  mathProblem: MathProblem,
  conversationHistory?: Array<{ role: string; message: string }>,
): boolean {
  const a = mathProblem.a;
  const b = mathProblem.b ?? 0;
  const { left, right } = pair;

  // Check if parts are from any valid decomposition
  const allPossibleParts = new Set<number>();
  for (let i = 1; i < a; i++) allPossibleParts.add(i);
  for (let i = 1; i < b; i++) allPossibleParts.add(i);

  if (allPossibleParts.has(left) && allPossibleParts.has(right)) return true;

  // Also check if they come from a prior decomposition in history
  if (conversationHistory) {
    const decomp = findPriorStudentDecomposition(conversationHistory, mathProblem);
    if (decomp) {
      const decompParts = [decomp.partA, decomp.partB];
      if (decompParts.includes(left) || decompParts.includes(right)) return true;
    }
  }
  return false;
}

/**
 * Scan conversation history for combine pairs already asked by coach and
 * answered by the student. Returns answered pairs so we can skip them.
 */
function findAnsweredCombinePairs(
  conversationHistory?: Array<{ role: string; message: string }>,
): Array<{ left: number; right: number; result: number }> {
  if (!conversationHistory) return [];
  const answered: Array<{ left: number; right: number; result: number }> = [];

  for (let i = 0; i < conversationHistory.length - 1; i++) {
    const entry = conversationHistory[i];
    if (entry.role !== "coach") continue;

    // Extract "What is X + Y?" from coach message
    const askMatch = entry.message.match(/(?:what\s+is|what's)\s+(\d+)\s*(?:\+|plus)\s*(\d+)\s*\??/i);
    if (!askMatch) continue;
    const askL = parseInt(askMatch[1]);
    const askR = parseInt(askMatch[2]);

    // Check if the next student turn answers it
    const next = conversationHistory[i + 1];
    if (!next || next.role !== "student") continue;

    const expectedResult = askL + askR;
    const normalized = normalizeNumberWords(next.message);
    // Student says "X + Y = Z" or "Z" or "X + Y is Z"
    if (normalized.includes(String(expectedResult)) ||
        new RegExp(`\\b${askL}\\s*\\+\\s*${askR}\\s*(?:=|is)\\s*${expectedResult}\\b`).test(normalized)) {
      answered.push({ left: askL, right: askR, result: expectedResult });
    }
  }
  return answered;
}

/**
 * Select the best combine pair from two decompositions.
 * Prefers shared factors, avoids already-answered pairs.
 */
function selectBestCombinePair(
  decompA: { operand: number; partA: number; partB: number },
  decompB: { operand: number; partA: number; partB: number },
  conversationHistory?: Array<{ role: string; message: string }>,
): { left: number; right: number } | null {
  // Enumerate all 4 cross-pairs
  const pairs = [
    { left: decompA.partA, right: decompB.partA },
    { left: decompA.partA, right: decompB.partB },
    { left: decompA.partB, right: decompB.partA },
    { left: decompA.partB, right: decompB.partB },
  ];

  // Remove already-answered pairs
  const answered = findAnsweredCombinePairs(conversationHistory);
  const isAnswered = (l: number, r: number) =>
    answered.some(a => (a.left === l && a.right === r) || (a.left === r && a.right === l));
  const remaining = pairs.filter(p => !isAnswered(p.left, p.right));

  if (remaining.length === 0) return null;

  // Prefer shared factors (same number in both decomps)
  const shared = remaining.filter(p => p.left === p.right);
  if (shared.length > 0) return shared[0];

  // Prefer pairs with largest sum (more progress)
  remaining.sort((a, b) => (b.left + b.right) - (a.left + a.right));
  return remaining[0];
}

/**
 * Method-acknowledgment repair patterns.
 * Student feels their math reasoning was ignored and wants it acknowledged.
 * These are NOT generic chatter — they reference prior math work.
 */
const METHOD_REPAIR_PATTERNS = [
  // "Did you hear me?", "did you hear what I was saying"
  /\b(?:did|do)\s+you\s+(?:hear|listen|understand)\b/i,
  // "Are you listening?", "you're not listening"
  /\b(?:you(?:'re| are)\s+not|aren'?t\s+you)\s+listen/i,
  // "I'm still talking about 7 + 7", "I was saying..."
  /\bI(?:'m| am)\s+still\s+(?:talking|saying|asking)\b/i,
  // "I still want to know why I can't split..."
  /\bI\s+still\s+(?:want|need)\s+to\s+know\b/i,
  // "that's not what I said" / "that's not what I was saying"
  /\bthat(?:'s| is)\s+not\s+what\s+I\s+(?:said|was\s+saying|meant)\b/i,
  // "I said 7 + 7" / "like I said" (referencing prior method statement)
  /\b(?:like\s+)?I\s+(?:just\s+)?said\b.*\b\d+/i,
  // "you ignored" / "you didn't answer"
  /\byou\s+(?:ignored|didn'?t\s+(?:answer|respond|listen|hear))\b/i,
  // "I was saying before" / "what I said before"
  /\b(?:what\s+I\s+(?:said|was\s+saying)|I\s+was\s+saying)\s+(?:before|earlier)\b/i,
  // "I didn't say that" / "I never said that" / "I didn't say 10 + 10 is 10"
  /\bI\s+(?:didn'?t|never|did\s+not)\s+say\b/i,
  // "I never said that" / "I never said 10 + 10 is 10"
  /\bI\s+never\s+(?:said|told)\b/i,
  // "it's supposed to be 7+6" / "supposed to be 7+6"
  /\bsupposed\s+to\s+be\s+\d+\s*(?:\+|plus)\s*\d+\b/i,
  // "you mean 6+6" / "I think you mean 6+6"
  /\byou\s+mean\s+\d+\s*(?:\+|plus)\s*\d+\b/i,
  // "shouldn't it be 6+6"
  /\bshouldn'?t\s+it\s+be\s+\d+\s*(?:\+|plus)\s*\d+\b/i,
  // "that's not how you're supposed to do it"
  /\bthat(?:'s| is)\s+not\s+(?:how|right).*(?:supposed|should)\b/i,
];

/**
 * Math-relevance signals: decomposition language that counts as math-relevant
 * even without explicit operand numbers.
 */
const MATH_METHOD_LANGUAGE = /\b(?:split(?:ting)?|break(?:ing)?|tens?|ones?|decompos(?:e|ing)|place\s*value|adding|subtracting|plus|minus)\b/i;

function detectMathRelevantResistance(
  studentResponse: string,
  mathProblem: MathProblem,
): boolean {
  const trimmed = studentResponse.trim();
  if (!RESISTANCE_PATTERNS.some(p => p.test(trimmed))) return false;

  const normalized = normalizeNumberWords(trimmed);
  const a = mathProblem.a;
  const b = mathProblem.b ?? 0;

  // Tier 1: explicit math-relevant numbers (operands or decomposition parts)
  const nums = [...normalized.matchAll(/\b(\d+)\b/g)].map(m => parseInt(m[1]));
  for (const n of nums) {
    if (n === a || n === b) return true;
    if (n === mathProblem.correctAnswer) return true;
    // Valid decomposition part of an operand
    if ((n > 0 && n < a) || (n > 0 && n < b)) return true;
  }

  // Tier 2: decomposition/method language without explicit numbers
  // "I was trying to split the numbers" or "why can't I break it apart"
  if (MATH_METHOD_LANGUAGE.test(trimmed)) return true;

  // Tier 3: references the problem itself ("I'm adding 14 and 11", "the problem")
  if (/\b(?:the\s+)?problem\b/i.test(trimmed) && nums.length > 0) return true;

  return false;
}

// ============================================================================
// Method-acknowledgment repair detection
// ============================================================================

/** Find the most recent coach message in conversation history. */
function findLastCoachMessage(
  conversationHistory: Array<{ role: string; message: string }>,
): string | null {
  for (let i = conversationHistory.length - 1; i >= 0; i--) {
    if (conversationHistory[i].role === "coach") return conversationHistory[i].message;
  }
  return null;
}

/**
 * Check if a coach message attributes a specific result or misconception
 * to the student (e.g. "you said 20", "it seems like you got 10").
 * Used to validate "I didn't say that" as a math-relevant repair.
 */
function hasAttribution(coachMessage: string): boolean {
  return /\byou\s+(?:said|got|think|gave|answered|wrote|put)\b/i.test(coachMessage)
    || /\bit\s+(?:seems|sounds|looks)\s+like\s+you\b/i.test(coachMessage)
    || /\byou(?:'re| are)\s+(?:saying|thinking|getting)\b/i.test(coachMessage)
    || /\byour\s+answer\b/i.test(coachMessage);
}

/**
 * Detect when the student feels their math reasoning was ignored.
 * "Did you hear what I was saying before?" / "that's not what I said"
 *
 * Only fires when the response references math or a prior method — a bare
 * "did you hear me" with no math context is treated as uncertain.
 */
function detectMethodRepair(
  studentResponse: string,
  mathProblem: MathProblem,
  conversationHistory?: Array<{ role: string; message: string }>,
): boolean {
  const trimmed = studentResponse.trim();
  if (!METHOD_REPAIR_PATTERNS.some(p => p.test(trimmed))) return false;

  // Check math-relevance: numbers in response, decomposition language, or
  // the student previously stated a decomposition in the conversation.
  const normalized = normalizeNumberWords(trimmed);
  const nums = [...normalized.matchAll(/\b(\d+)\b/g)].map(m => parseInt(m[1]));
  const a = mathProblem.a;
  const b = mathProblem.b ?? 0;

  // Direct math content in the repair message
  for (const n of nums) {
    if (n === a || n === b || n === mathProblem.correctAnswer) return true;
    if ((n > 0 && n < a) || (n > 0 && n < b)) return true;
  }
  if (MATH_METHOD_LANGUAGE.test(trimmed)) return true;

  // If the student previously stated a decomposition, the repair is math-relevant
  // even without explicit numbers ("did you hear what I was saying before?")
  if (conversationHistory) {
    const priorDecomp = findPriorStudentDecomposition(conversationHistory, mathProblem);
    if (priorDecomp) return true;

    // "I didn't say that" / "I never said that" — if the prior coach turn
    // attributed a result or misconception, the denial is math-relevant even
    // without numbers. The student is correcting a misattribution.
    if (/\bI\s+(?:didn'?t|never|did\s+not)\s+(?:say|said|tell|told)\b/i.test(trimmed)) {
      const lastCoach = findLastCoachMessage(conversationHistory);
      if (lastCoach && hasAttribution(lastCoach)) return true;
    }
  }

  return false;
}

/**
 * Search conversation history for a non-canonical decomposition the student
 * previously stated. Returns the decomposition parts or null.
 *
 * Used by method-repair and mixed-strategy handlers to acknowledge
 * the student's prior work.
 */
function findPriorStudentDecomposition(
  conversationHistory: Array<{ role: string; message: string }>,
  mathProblem: MathProblem,
): { operand: number; partA: number; partB: number } | null {
  // Search student messages from most recent to oldest
  for (let i = conversationHistory.length - 1; i >= 0; i--) {
    const entry = conversationHistory[i];
    if (entry.role !== "student") continue;
    const decomp = detectValidInefficientDecomposition(entry.message, mathProblem);
    if (decomp) return decomp;
    // Also check multi-decomposition
    const multi = detectMultiDecompositionStrategy(entry.message, mathProblem);
    if (multi && multi.decomps.length > 0) return multi.decomps[0];
  }
  return null;
}

// ============================================================================
// Mixed-strategy detection
// ============================================================================

/**
 * Detect when a student has canonical progress AND continues referencing
 * a non-canonical decomposition or alternative plan.
 *
 * This is different from noncanonical_active (no canonical progress) and
 * math_relevant_resistance (defending but not computing).
 */
function detectMixedStrategyActive(
  studentResponse: string,
  stepAccumulation: ReasoningStepAccumulation,
  mathProblem: MathProblem,
  conversationHistory?: Array<{ role: string; message: string }>,
): boolean {
  // Must have at least one satisfied canonical step
  if (stepAccumulation.satisfiedStepIds.length === 0) return false;

  // Must not yet be complete
  if (stepAccumulation.missingStepIds.length === 0 && stepAccumulation.answerCorrect) return false;

  // Current response must reference a non-canonical decomposition
  const decomp = detectValidInefficientDecomposition(studentResponse, mathProblem);
  if (decomp) return true;

  const multi = detectMultiDecompositionStrategy(studentResponse, mathProblem);
  if (multi) return true;

  // Or the current response references a prior non-canonical decomposition
  // (e.g. "I still want to do 7 + 7" without restating the decomposition)
  if (conversationHistory) {
    const priorDecomp = findPriorStudentDecomposition(conversationHistory, mathProblem);
    if (priorDecomp) {
      // Student must be referencing the prior decomposition somehow
      const normalized = normalizeNumberWords(studentResponse.trim());
      const mentionsPart = new RegExp(`\\b${priorDecomp.partA}\\b`).test(normalized)
        || new RegExp(`\\b${priorDecomp.partB}\\b`).test(normalized);
      const mentionsDecompLang = MATH_METHOD_LANGUAGE.test(studentResponse);
      if (mentionsPart || mentionsDecompLang) return true;
    }
  }

  return false;
}

// ============================================================================
// Repeated resistance / repair detection
// ============================================================================

/**
 * Check if the student has already expressed resistance or method repair
 * in a prior turn. Used to trigger short-form responses.
 *
 * Looks for prior student messages that match resistance or repair patterns.
 * Returns true if at least one prior turn was resistance/repair.
 */
function hasRepeatedResistance(
  conversationHistory: Array<{ role: string; message: string }>,
  mathProblem: MathProblem,
): boolean {
  // Count student turns that are resistance or repair
  let count = 0;
  for (const entry of conversationHistory) {
    if (entry.role !== "student") continue;
    if (RESISTANCE_PATTERNS.some(p => p.test(entry.message))) count++;
    if (METHOD_REPAIR_PATTERNS.some(p => p.test(entry.message))) count++;
    if (count >= 1) return true;
  }
  return false;
}

// ============================================================================
// AV / delivery complaint detection
// ============================================================================

/**
 * Detect when student is complaining about audio/video quality rather than
 * doing math. STT may distort these ("are your mouth is messed up") so
 * patterns must be fuzzy.
 */
const AV_COMPLAINT_PATTERNS = [
  // Mouth/face/lips complaints (STT-distorted or direct)
  /\b(?:your|the)\s+(?:mouth|face|lips?)\s+(?:is|are|looks?|seems?)\s+(?:messed|weird|broken|wrong|funny|off|glitch)/i,
  // Voice complaints
  /\b(?:your|the)\s+(?:voice|sound|audio)\s+(?:is|are|sounds?)\s+(?:weird|broken|wrong|funny|off|glitch|bad|messed)/i,
  // Can't understand/hear
  /\b(?:I\s+)?(?:can'?t|cannot|couldn'?t)\s+(?:understand|hear)\s+(?:you|what\s+you)/i,
  // Video/screen complaints
  /\b(?:your|the)\s+(?:video|screen|picture|camera)\s+(?:is|are)\s+(?:frozen|broke|broken|laggy|glitch|messed)/i,
  // Generic "you're glitching/breaking/messing up"
  /\byou(?:'re|r| are)\s+(?:glitch|break|mess|freez|lag|bug)/i,
  // "are your mouth is messed up" (common STT distortion)
  /\bmouth\s+is\s+messed\b/i,
];

function detectAVDeliveryComplaint(studentResponse: string): boolean {
  const trimmed = studentResponse.trim();
  return AV_COMPLAINT_PATTERNS.some(p => p.test(trimmed));
}

// ============================================================================
// Computation mistake detection (valid strategy + arithmetic slip)
// ============================================================================

/**
 * Strategy evidence patterns. These indicate the student is working within
 * a recognizable multi-step strategy, not just answering a single probe.
 *
 * IMPORTANT: These must NOT match a bare equation like "20 + 5 is 30" — that's
 * just answering a coached probe. Strategy evidence means the student is
 * narrating or building a multi-step approach.
 */
const STRATEGY_EVIDENCE_PATTERNS = [
  // Decomposition language: "split 11 into 10 and 1", "break it apart"
  /\b(?:split|break|separate|decompose|take\s+apart|break\s+apart)\b/i,
  // Explicit step narration: "then 14 + 10", "so I add 10", "first the tens"
  /\b(?:then|so|first|next|and\s+then|now)\s+(?:I\s+)?(?:add|plus|put)\b/i,
  // Multi-equation: two or more arithmetic expressions (sign of multi-step work)
  /\b\d+\s*[+\-]\s*\d+\b.*\b\d+\s*[+\-]\s*\d+\b/,
  // Step sequencing: "then", "and then", "next" with numbers
  /\b(?:then|and\s+then|next|after\s+that)\s+\d+/i,
  // Place-value decomposition reference: "the ones", "the tens", "ones and tens"
  /\b(?:the\s+)?(?:ones?|tens?)\s+(?:are|is|part|digit|and)\b/i,
];

/**
 * Detect computation mistake inside a valid strategy.
 *
 * Returns details about the intended computation if the student showed a
 * recognizable strategy structure but got the arithmetic wrong.
 *
 * Three detection tiers:
 *
 * Tier 1 — Explicit equation with wrong result:
 *   "14 + 10 is 34" → the student wrote A op B = WRONG where A op B = CORRECT
 *   is a known valid sub-step of the problem.
 *
 * Tier 2 — Strategy language + wrong answer that's close to a valid intermediate:
 *   "I split 11 into 10 and 1 then I got 34" → decomposition language +
 *   wrong answer near a valid intermediate (24). The wrong answer should be
 *   a plausible arithmetic slip (off by a digit, tens-place error, ±1 error).
 *
 * Tier 3 — Canonical step arithmetic slip (no strategy framing needed):
 *   "4 + 1 is 6" → matches a canonical reasoning step's operands exactly,
 *   but the result is wrong. This is so clearly a computation slip on a
 *   coached sub-step that no additional strategy evidence is needed.
 */
export interface ComputationMistakeInfo {
  /** The left operand of the intended computation. */
  intendedLeft: number;
  /** The right operand of the intended computation. */
  intendedRight: number;
  /** The correct result of the intended computation. */
  correctResult: number;
  /** What the student said the result was. */
  studentResult: number;
  /** The next question to ask after correcting. */
  nextProbe: string;
  /** Whether this is a canonical step or alternate strategy step. */
  stepType: "canonical" | "alternate";
}

function detectComputationMistake(
  studentResponse: string,
  mathProblem: MathProblem,
  reasoningSteps: ReasoningStep[],
  stepAccumulation: ReasoningStepAccumulation,
): ComputationMistakeInfo | null {
  const normalized = normalizeNumberWords(studentResponse.trim());
  const a = mathProblem.a;
  const b = mathProblem.b ?? 0;
  const correctAnswer = mathProblem.correctAnswer;

  // Build the set of valid sub-computations for this problem.
  // Includes canonical steps AND common alternate-strategy intermediates.
  interface ValidComputation {
    left: number;
    right: number;
    result: number;
    stepType: "canonical" | "alternate";
  }
  const validComputations: ValidComputation[] = [];

  // Canonical steps from reasoningSteps
  for (const step of reasoningSteps) {
    for (const stmt of step.expectedStatements) {
      const m = stmt.match(/(\d+)\s*([+\-])\s*(\d+)\s*=\s*(\d+)/);
      if (m) {
        validComputations.push({
          left: parseInt(m[1]),
          right: parseInt(m[3]),
          result: parseInt(m[4]),
          stepType: "canonical",
        });
      }
    }
  }

  // Alternate-strategy intermediates: a + tens_of_b, b + tens_of_a, etc.
  const aTens = Math.floor(a / 10) * 10;
  const aOnes = a % 10;
  const bTens = Math.floor(b / 10) * 10;
  const bOnes = b % 10;
  if (bTens > 0) {
    validComputations.push({ left: a, right: bTens, result: a + bTens, stepType: "alternate" });
  }
  if (bOnes > 0) {
    validComputations.push({ left: a + bTens, right: bOnes, result: correctAnswer, stepType: "alternate" });
  }
  if (aTens > 0) {
    validComputations.push({ left: b, right: aTens, result: b + aTens, stepType: "alternate" });
  }
  if (aOnes > 0) {
    validComputations.push({ left: b + aTens, right: aOnes, result: correctAnswer, stepType: "alternate" });
  }

  // ── Tier 1: Explicit equation with wrong result + strategy context ──
  // Match "14 + 10 is 34", "10 + 10 is 30", etc.
  // REQUIRES strategy evidence beyond just answering a probe — otherwise
  // misconceptions like "1 - 4 = 3" on an addition problem or "20 + 5 = 15"
  // would be misclassified as computation slips.
  const hasStrategyEvidence = STRATEGY_EVIDENCE_PATTERNS.some(p => p.test(normalized));

  const eqPattern = /\b(\d+)\s*([+\-])\s*(\d+)\s*(?:=|is|equals?|makes?|gives?|gets?)\s*(\d+)\b/gi;
  let match;
  while ((match = eqPattern.exec(normalized)) !== null) {
    const left = parseInt(match[1]);
    const right = parseInt(match[3]);
    const studentResult = parseInt(match[4]);
    const op = match[2];
    const actualResult = op === "+" ? left + right : left - right;

    // If the student got it RIGHT, skip — not a mistake
    if (studentResult === actualResult) continue;

    // Guard: wrong-operation equations are misconceptions, not computation slips.
    // E.g., "1 - 4 = 3" on an addition problem — the operation itself is wrong.
    if (mathProblem.skill === "two_digit_addition" && op === "-") continue;
    if (mathProblem.skill === "two_digit_subtraction" && op === "+") continue;

    // Check if this computation matches a known valid sub-step
    for (const vc of validComputations) {
      if ((left === vc.left && right === vc.right) ||
          (left === vc.right && right === vc.left)) {
        // For canonical step computations (like "4 + 1 = 6" or "20 + 5 = 30"),
        // only treat as computation slip when there's broader strategy evidence
        // in the response. A bare "4 + 1 = 6" answering a direct probe should
        // go through normal wrong-answer handling. An alternate-strategy step
        // (like "14 + 10 = 34") with decomposition language is clearly a slip.
        if (vc.stepType === "canonical" && !hasStrategyEvidence) continue;

        const nextProbe = buildComputationFollowUp(vc, mathProblem, correctAnswer, reasoningSteps, stepAccumulation);
        return {
          intendedLeft: vc.left,
          intendedRight: vc.right,
          correctResult: vc.result,
          studentResult,
          nextProbe,
          stepType: vc.stepType,
        };
      }
    }
  }

  // ── Tier 2: Strategy language + wrong answer near a valid intermediate ─
  // Student shows strategy evidence but extracted answer doesn't match any step.
  if (!hasStrategyEvidence) return null;

  const extractedAnswer = extractNumericAnswer(normalized);
  if (extractedAnswer === null || extractedAnswer === correctAnswer) return null;

  // Guard: if the extracted answer IS one of the problem's operands, the student
  // is referencing the problem ("split the 11"), not computing a result.
  if (extractedAnswer === a || extractedAnswer === b) return null;

  // Guard: if the student wrote a correct explicit equation (e.g. "10 + 10 = 20"),
  // the extracted answer comes from valid work — don't misclassify it as a slip
  // on a different computation (e.g. 20 as an off-by-one on 11+10=21).
  const hasCorrectEquation = /\b(\d+)\s*([+\-])\s*(\d+)\s*(?:=|is)\s*(\d+)\b/gi;
  let eqCheck;
  while ((eqCheck = hasCorrectEquation.exec(normalized)) !== null) {
    const l = parseInt(eqCheck[1]);
    const r = parseInt(eqCheck[3]);
    const res = parseInt(eqCheck[4]);
    const actual = eqCheck[2] === "+" ? l + r : l - r;
    if (res === actual && res === extractedAnswer) return null;
  }

  // Check if the wrong answer is a plausible slip on a known valid computation
  for (const vc of validComputations) {
    // Plausible slip: off by 10 (tens-place error), off by 1, transposed digits
    const diff = Math.abs(extractedAnswer - vc.result);
    if (diff === 0) continue; // Correct — not a mistake

    const isPlausibleSlip =
      diff === 10 ||                                         // Tens-place error: 24→34
      diff === 1 ||                                          // Off-by-one: 5→6
      diff === 100 ||                                        // Hundreds-place: 20→120
      (extractedAnswer === parseInt(String(vc.result).split("").reverse().join(""))); // Digit swap: 24→42

    if (!isPlausibleSlip) continue;

    // Verify the student mentions at least one operand from this computation
    const mentionsLeft = new RegExp(`\\b${vc.left}\\b`).test(normalized);
    const mentionsRight = new RegExp(`\\b${vc.right}\\b`).test(normalized);
    if (!mentionsLeft && !mentionsRight) continue;

    const nextProbe = buildComputationFollowUp(vc, mathProblem, correctAnswer, reasoningSteps, stepAccumulation);
    return {
      intendedLeft: vc.left,
      intendedRight: vc.right,
      correctResult: vc.result,
      studentResult: extractedAnswer,
      nextProbe,
      stepType: vc.stepType,
    };
  }

  return null;
}

/**
 * Build the follow-up question after correcting a computation mistake.
 * Continues in the student's strategy path rather than restarting.
 */
function buildComputationFollowUp(
  correctedStep: { left: number; right: number; result: number; stepType: "canonical" | "alternate" },
  mathProblem: MathProblem,
  correctAnswer: number,
  reasoningSteps: ReasoningStep[],
  stepAccumulation: ReasoningStepAccumulation,
): string {
  const { result } = correctedStep;

  // If the corrected result IS the final answer, ask for the final answer
  if (result === correctAnswer) {
    return `So what is ${mathProblem.expression}?`;
  }

  // For alternate strategy: ask about the remainder
  if (correctedStep.stepType === "alternate") {
    const remainder = correctAnswer - result;
    if (remainder > 0 && remainder < Math.min(mathProblem.a, mathProblem.b ?? 0)) {
      return `Now what do you do with the ${remainder} that's left?`;
    }
  }

  // For canonical: find the next missing step after this one
  const nextStep = getNextMissingStep(reasoningSteps, stepAccumulation);
  if (nextStep) {
    const operands = extractStepOperandsPublic(nextStep, mathProblem);
    if (operands) {
      // If it's a combine step, reference the corrected result
      if (nextStep.kind === "combine" || nextStep.kind === "final_answer") {
        return `Now what is ${operands.expression}?`;
      }
      return `Now what is ${operands.expression}?`;
    }
    return nextStep.probe || `What's the next step?`;
  }

  return `Now use that to find ${mathProblem.expression}.`;
}

/** Public wrapper for extractStepOperands (needed by buildComputationFollowUp). */
function extractStepOperandsPublic(step: ReasoningStep, mathProblem: MathProblem) {
  const stmt = step.expectedStatements[0];
  if (!stmt) return null;
  const m = stmt.match(/(\d+)\s*([+\-])\s*(\d+)\s*=\s*(\d+)/);
  if (m) {
    return {
      left: m[1],
      right: m[3],
      result: m[4],
      expression: `${m[1]} ${m[2]} ${m[3]}`,
      operation: m[2] === "+" ? "add" as const : "subtract" as const,
    };
  }
  return null;
}

// ============================================================================
// Student state classification
// ============================================================================

/**
 * Classify the student's current response into a remediation state.
 *
 * Priority order:
 * 1. No speech → uncertain
 * 2. Hint request → hint_request
 * 3. Concept confusion → concept_confusion (BEFORE generic uncertainty)
 * 4. Uncertainty → uncertain
 * 5. Newly satisfied steps → partial
 * 6. Multi-decomposition active strategy → noncanonical_active
 * 6b. Math-relevant resistance → math_relevant_resistance
 * 6c. Computation mistake (valid strategy + arithmetic slip) → computation_mistake
 * 7. Wrong answer:
 *    a. Valid alternate-strategy intermediate → partial
 *    b. Alternate strategy setup language → alternate_setup
 *    c. Misconception pattern → misconception
 *    d. Otherwise → wrong
 * 8. No numeric answer + alternate setup language → alternate_setup
 * 9. Correct answer but missing steps → correct_incomplete
 */
export function classifyStudentState(
  studentResponse: string,
  stepAccumulation: ReasoningStepAccumulation,
  mathProblem: MathProblem,
  interpretation?: MathUtteranceInterpretation,
): StudentRemediationState {
  const trimmed = studentResponse.trim();

  // Build interpretation if not provided (backward compatible)
  const problemOp = mathProblem.skill === "two_digit_subtraction" ? "-" as const
    : mathProblem.skill === "two_digit_addition" ? "+" as const
    : undefined;
  const interp = interpretation ?? interpretMathUtterance(
    trimmed, mathProblem.correctAnswer, undefined,
    mathProblem.b !== undefined ? [mathProblem.a, mathProblem.b] : undefined,
    problemOp,
  );

  // No speech
  if (NO_SPEECH.test(trimmed)) {
    return "uncertain";
  }

  // AV/delivery complaint: "your mouth is messed up", "I can't hear you"
  // Must be checked BEFORE hint/uncertainty so it doesn't get treated as
  // generic confusion or off-topic chatter.
  if (detectAVDeliveryComplaint(trimmed)) {
    return "av_delivery_complaint";
  }

  // Explicit hint request
  if (HINT_REQUEST.test(trimmed)) {
    return "hint_request";
  }

  // Concept confusion: "What does ones mean?", "Where did you get 10 and 10?"
  // Must be checked BEFORE uncertainty so "I don't know what the ones mean"
  // routes to a concept explanation, not a generic simpler probe.
  if (detectConceptConfusion(trimmed, mathProblem) !== null) {
    return "concept_confusion";
  }

  // Refusal/disengagement: "I want to move on", "can we skip this", "next question"
  // Must be checked BEFORE number extraction so "move on" isn't treated as
  // wrong-answer "one" and "skip this" isn't treated as wrong-answer "this".
  // Guard: only fire when NO explicit arithmetic expression is present.
  const REFUSAL_PATTERNS = [
    /\b(?:move\s+on|skip\s+(?:this|it)|next\s+(?:one|question|problem))\b/i,
    /\bdon'?t\s+want\s+to\b/i,
    /\b(?:stop|quit)\b/i,
  ];
  const hasArithmeticExpr = /\d+\s*[\+\-\*×÷]\s*\d+/.test(normalizeNumberWords(trimmed));
  if (!hasArithmeticExpr && REFUSAL_PATTERNS.some(p => p.test(trimmed))) {
    return "uncertain";
  }

  // Uncertainty patterns
  if (UNCERTAINTY_PATTERNS.some(p => p.test(trimmed))) {
    return "uncertain";
  }

  // Check for newly satisfied steps FIRST — a student who correctly answers
  // a sub-step question (e.g., "1 + 4 = 5" when asked "What is 1 + 4?")
  // should be classified as partial progress, not as a wrong/misconception
  // based on the final answer mismatch.
  if (stepAccumulation.newlySatisfiedStepIds.length > 0 && stepAccumulation.missingStepIds.length > 0) {
    return "partial";
  }

  // Use DECOMPOSITION-AWARE extraction for wrong-answer detection.
  // This prevents "I would split it 5 + 9" from being treated as wrong answer 9.
  // Falls back to raw extraction for misconception detection (which needs the actual number).
  const normalized = normalizeNumberWords(trimmed);
  const extractedAnswer = interp.finalAnswerCandidate;
  const rawAnswer = interp.rawExtractedAnswer;

  // Decomposition-only utterances should NOT be classified as wrong answers.
  // "split 11 into 10 and 1" → extractedAnswer is null → skip wrong-answer path.
  const isWrongAnswer = extractedAnswer !== null && extractedAnswer !== mathProblem.correctAnswer;

  // Substep-only equations (e.g., "10 + 10 = 20" for a problem where answer is 25)
  // should NOT be treated as wrong whole-problem answers. If the utterance is
  // likely just a substep and doesn't claim to be the final answer, skip the
  // wrong-answer path and let it fall through to alternate/partial handling.
  const isSubstepNotWhole = isWrongAnswer && interp.likelySubstepOnly && !interp.likelyWholeProblemAnswer;

  // Repeated addition for multiplication: "4+4+4=12" for 3×4.
  // Must be checked BEFORE wrong-answer so valid repeated-addition isn't classified as wrong.
  if (mathProblem.skill === "basic_multiplication") {
    const repeatedAddResult = detectRepeatedAddition(normalized, mathProblem);
    if (repeatedAddResult === "correct") {
      return "correct_incomplete";
    }
    // "partial" — incomplete repeated addition like "4+4=8" — don't classify as wrong
    if (repeatedAddResult === "partial") {
      return "partial";
    }
    // "wrong" or null — fall through to normal classification
  }

  // Multi-decomposition active strategy: "split 14 into 7+7, split 11 into 5+6, 7+6=13"
  // Student is actively constructing a non-canonical strategy with TWO decompositions.
  // Must be checked BEFORE valid_inefficient and wrong-answer, since the computed
  // result (e.g. 13) looks "wrong" but is mathematically valid cross-decomposition work.
  if (detectMultiDecompositionStrategy(trimmed, mathProblem)) {
    return "noncanonical_active";
  }

  // Math-relevant pushback: "that's not what I said, I said split 14 into 7+7"
  // Student is defending their non-canonical method. Must not be treated as
  // uncertainty or wrapped. Only fires when math-relevant numbers are referenced.
  if (detectMathRelevantResistance(trimmed, mathProblem)) {
    return "math_relevant_resistance";
  }

  // Valid but inefficient decomposition: "14 could be 7 + 7"
  // Check BEFORE wrong-answer classification so true math isn't treated as wrong.
  // Only fire when the student explicitly proposes an equivalence — not just
  // mentioning a number that happens to be a factor or part.
  if (detectValidInefficientDecomposition(trimmed, mathProblem)) {
    return "valid_inefficient";
  }

  // Alternate strategy chain: student showed a valid arithmetic chain reaching
  // the correct answer (e.g., "14 + 10 = 24, then 1 more is 25").
  // Route to partial (progress) rather than wrong — the chain IS valid work.
  if (interp.isAlternateStrategyChain) {
    return "partial";
  }

  if (isWrongAnswer && !isSubstepNotWhole) {
    // Before classifying as wrong/misconception, check if the extracted answer
    // is a valid alternate-strategy intermediate. E.g., for 14+11=25, the student
    // says "14 + 10 ... I'd get 24" — 24 is NOT wrong, it's a partial step in
    // a split-addend strategy (14 + 10 = 24, then 24 + 1 = 25).
    if (isAlternateStrategyIntermediate(extractedAnswer, mathProblem, normalized)) {
      return "partial";
    }

    // Alternate strategy setup with wrong intermediate: student mentions
    // splitting/breaking but their number isn't a valid intermediate.
    // Still classify as alternate_setup so we model the correct setup
    // rather than giving a canonical wrong-answer response.
    if (detectAlternateStrategySetup(trimmed, mathProblem)) {
      return "alternate_setup";
    }

    // Use RAW answer for misconception detection — we need the actual number
    // even from decomposition context to detect misconception patterns like
    // subtraction-on-addition or place-value confusion.
    const misconceptionAnswer = extractedAnswer;
    const category = detectMisconceptionCategory(
      trimmed, misconceptionAnswer, mathProblem, stepAccumulation,
    );
    if (category) {
      return "misconception";
    }
    return "wrong";
  }

  // Substep-only equation that was suppressed from wrong-answer path above:
  // treat as partial progress rather than wrong.
  if (isSubstepNotWhole) {
    return "partial";
  }

  // Decomposition-only utterance without a final answer: alternate_setup.
  // "I would split it 5 + 9" → no final answer extracted, decomposition language present.
  if (interp.isDecompositionOnly) {
    return "alternate_setup";
  }

  // Alternate strategy setup: student is trying to split/break/decompose
  // a number but hasn't produced a valid intermediate yet, and no numeric
  // answer was extracted. E.g. "how would I split up the 11"
  if (detectAlternateStrategySetup(trimmed, mathProblem)) {
    return "alternate_setup";
  }

  // Correct answer but missing steps.
  // Check both accumulation flag AND current utterance's extracted answer,
  // since split-addend chains may state the correct answer before accumulation
  // has registered all steps.
  const currentAnswerCorrect = extractedAnswer !== null && extractedAnswer === mathProblem.correctAnswer;
  if ((stepAccumulation.answerCorrect || currentAnswerCorrect) && stepAccumulation.missingStepIds.length > 0) {
    return "correct_incomplete";
  }

  // No answer extracted, but not clearly uncertain — treat as uncertain
  if (extractedAnswer === null && stepAccumulation.newlySatisfiedStepIds.length === 0) {
    return "uncertain";
  }

  // Default: if steps are missing, treat as wrong
  if (stepAccumulation.missingStepIds.length > 0) {
    return "wrong";
  }

  // Everything satisfied
  return "correct_incomplete";
}

// ============================================================================
// Step selection: find the next missing step to remediate
// ============================================================================

/**
 * Get the next missing reasoning step to target.
 *
 * Returns foundational steps first (ones_sum, tens_sum, identify_ones, etc.)
 * before combine/final_answer steps. Within the same priority tier,
 * preserves the original step order.
 */
export function getNextMissingStep(
  reasoningSteps: ReasoningStep[],
  accumulation: ReasoningStepAccumulation,
): ReasoningStep | null {
  const missingSet = new Set(accumulation.missingStepIds);
  const missingSteps = reasoningSteps.filter(s => missingSet.has(s.id));

  if (missingSteps.length === 0) return null;

  // Separate foundational vs. combine/final steps
  const COMBINE_KINDS: ReasoningStepKind[] = ["combine", "final_answer"];
  const foundational = missingSteps.filter(s => !COMBINE_KINDS.includes(s.kind));
  const combining = missingSteps.filter(s => COMBINE_KINDS.includes(s.kind));

  // Prefer foundational steps first
  if (foundational.length > 0) {
    return foundational[0];
  }

  // All foundational done — return combine/final
  return combining[0] ?? null;
}

// ============================================================================
// Remediation move templates
// ============================================================================

/**
 * Operand info extracted from a reasoning step's expectedStatements.
 * For "1 + 4 = 5" → { left: "1", right: "4", result: "5", expression: "1 + 4" }
 */
interface StepOperands {
  left: string;
  right: string;
  result: string;
  expression: string;
  operation: "add" | "subtract" | "other";
}

function extractStepOperands(step: ReasoningStep, _mathProblem: MathProblem): StepOperands | null {
  const stmt = step.expectedStatements[0];
  if (!stmt) return null;

  const match = stmt.match(/(\d+)\s*([+\-])\s*(\d+)\s*=\s*(\d+)/);
  if (match) {
    const op = match[2] === "+" ? "add" as const : "subtract" as const;
    return {
      left: match[1],
      right: match[3],
      result: match[4],
      expression: `${match[1]} ${match[2]} ${match[3]}`,
      operation: op,
    };
  }

  return null;
}

/**
 * Build a step-specific hint aligned to the exact success criteria.
 *
 * Each hint guides the student toward the specific expected statement
 * for the missing step, using the actual operands from the problem.
 *
 * Example: ones_sum with "1 + 4 = 5" →
 *   "Hint: Start with the ones. What is 1 plus 4?"
 * NOT: "Hint: Look at tens and ones separately." (too broad)
 */
function buildStepHint(step: ReasoningStep, operands: StepOperands | null): string {
  if (!operands) {
    return `Hint: Try this part: ${step.label.toLowerCase()}.`;
  }

  const verb = operands.operation === "add" ? "plus" : "minus";

  switch (step.kind) {
    case "ones_sum":
    case "identify_ones":
      return `Hint: Start with the ones. What is ${operands.left} ${verb} ${operands.right}?`;
    case "tens_sum":
    case "identify_tens":
      return `Hint: Now the tens. What is ${operands.left} ${verb} ${operands.right}?`;
    case "combine":
    case "final_answer":
      return `Hint: You have ${operands.left} and ${operands.right}. Put them together. What is ${operands.left} ${verb} ${operands.right}?`;
    case "regroup":
      return `Hint: ${operands.left} ${verb} ${operands.right} is ${operands.result}. That's more than 9, so you carry the 1 to the tens.`;
    case "borrow":
    case "identify_borrow":
      return `Hint: ${operands.left} is smaller than ${operands.right}, so you need to borrow from the tens.`;
    case "subtract_ones":
      return `Hint: Subtract the ones. What is ${operands.left} ${verb} ${operands.right}?`;
    case "subtract_tens":
      return `Hint: Now subtract the tens. What is ${operands.left} ${verb} ${operands.right}?`;
    case "skip_count":
      return `Hint: Try counting by ${operands.right}s.`;
    case "identify_groups":
      return `Hint: How many groups of ${operands.right} are there?`;
    default:
      return `Hint: What is ${operands.left} ${verb} ${operands.right}?`;
  }
}

// ── Opening variant pools ──────────────────────────────────────────────

const DIRECT_PROBE_OPENINGS = [
  (probe: string) => probe,
  (probe: string) => `OK, ${probe.charAt(0).toLowerCase()}${probe.slice(1)}`,
  (probe: string) => `Let's think about this. ${probe}`,
];

const SIMPLER_PROBE_OPENINGS_OPERAND = [
  (kindLabel: string, expr: string) => `Let's do just the ${kindLabel}. What is ${expr}?`,
  (kindLabel: string, expr: string) => `Try just the ${kindLabel}. What's ${expr}?`,
  (kindLabel: string, expr: string) => `Focus on the ${kindLabel}. What is ${expr}?`,
  (kindLabel: string, expr: string) => `One step at a time — the ${kindLabel}. What is ${expr}?`,
];

const SIMPLER_PROBE_OPENINGS_NO_OPERAND = [
  (question: string) => `Let's try just this part. ${question}`,
  (question: string) => `Focus on this step. ${question}`,
  (question: string) => `One thing at a time. ${question}`,
  (question: string) => `Let's break it down. ${question}`,
];

const DEMONSTRATE_STEP_OPENINGS = [
  (stepAnswer: string) => `For this step, ${stepAnswer}. Now, what comes next?`,
  (stepAnswer: string) => `I'll help: ${stepAnswer}. What's the next part?`,
  (stepAnswer: string) => `Here's this one: ${stepAnswer}. What comes next?`,
  (stepAnswer: string) => `Let me show you: ${stepAnswer}. Now what?`,
];

const DEMONSTRATE_STEP_OPENINGS_NO_ANSWER = [
  (label: string) => `Let me show you: ${label}. What comes next?`,
  (label: string) => `Here's this one: ${label}. What's next?`,
  (label: string) => `I'll help with that: ${label}. Now what?`,
  (label: string) => `This part is: ${label}. What comes next?`,
];

const ALL_STEPS_SATISFIED_OPENINGS = [
  (expr: string) => `You've shown all the steps. So what is ${expr}?`,
  (expr: string) => `All the steps are done. What is ${expr}?`,
  (expr: string) => `Great, all the parts are there. What is ${expr}?`,
  (expr: string) => `Now put it all together. What is ${expr}?`,
];

const MISCONCEPTION_REDIRECT_TEMPLATES: Record<string, string[]> = {
  SUBTRACTION_ON_ADDITION: [
    "We're adding in this problem, not subtracting.",
    "Remember, we need to add here, not subtract.",
    "This one is addition, not subtraction.",
  ],
  ADDITION_ON_SUBTRACTION: [
    "We're subtracting in this problem, not adding.",
    "Remember, we need to subtract here, not add.",
    "This one is subtraction, not addition.",
  ],
  ONES_ONLY_CONFUSION_TENS: [
    "You found the ones part. Now let's add the tens.",
    "Good job on the ones! Now the tens.",
    "The ones are done. What about the tens?",
  ],
  ONES_ONLY_CONFUSION_OTHER: [
    "That's just part of the answer.",
    "You got part of it! There's more to do.",
    "That's one piece — let's keep going.",
  ],
  TENS_ONLY_CONFUSION_ONES: [
    "You found the tens part. Now let's add the ones.",
    "Good job on the tens! Now the ones.",
    "The tens are done. What about the ones?",
  ],
  TENS_ONLY_CONFUSION_OTHER: [
    "That's just part of the answer.",
    "You got part of it! There's more to do.",
    "That's one piece — let's keep going.",
  ],
  KNOWN_WRONG_ANSWER: [
    "Not quite.",
    "Hmm, not quite right.",
    "Close, but not quite.",
  ],
  GENERIC_WRONG: [
    "Not quite.",
    "Hmm, that's not it.",
    "Let's try again.",
  ],
};

/**
 * Pick an opening variant deterministically by turnIndex, with a same-opening
 * guard that compares the first 4 words against the previous coach message.
 *
 * turnIndex defaults to 0 when unavailable, giving the same result as
 * the old "pick first non-matching" behaviour on the first turn.
 */
function pickVariant(
  variants: string[],
  previousCoachMessage: string | undefined,
  turnIndex = 0,
): string {
  if (variants.length === 0) return "";
  const idx = turnIndex % variants.length;
  const candidate = variants[idx];

  if (previousCoachMessage) {
    const prevWords = previousCoachMessage.split(/\s+/).slice(0, 4).join(" ").toLowerCase();
    const candidateWords = candidate.split(/\s+/).slice(0, 4).join(" ").toLowerCase();
    if (prevWords === candidateWords && variants.length > 1) {
      return variants[(idx + 1) % variants.length];
    }
  }
  return candidate;
}

/**
 * Extract the last coach message from conversation history.
 */
function getLastCoachMessage(
  conversationHistory: Array<{ role: string; message: string }> | undefined,
): string | undefined {
  if (!conversationHistory) return undefined;
  for (let i = conversationHistory.length - 1; i >= 0; i--) {
    if (conversationHistory[i].role === "coach") return conversationHistory[i].message;
  }
  return undefined;
}

/**
 * Derive a turn index from conversation history (count of student messages).
 * Used for deterministic variant rotation.
 */
function deriveTurnIndex(
  conversationHistory: Array<{ role: string; message: string }> | undefined,
): number {
  if (!conversationHistory) return 0;
  return conversationHistory.filter(m => m.role === "student").length;
}

/**
 * Build the direct probe for a step.
 * Uses the step's pre-authored probe when available, otherwise builds from operands.
 */
function buildDirectProbe(
  step: ReasoningStep,
  operands: StepOperands | null,
  conversationHistory?: Array<{ role: string; message: string }>,
): string {
  const baseProbe = step.probe
    ? step.probe
    : operands
      ? `What do you get when you ${operands.operation === "add" ? "add" : "subtract"} ${operands.left} and ${operands.right}?`
      : `What do you get for this step: ${step.label.toLowerCase()}?`;

  const previousMsg = getLastCoachMessage(conversationHistory);
  const ti = deriveTurnIndex(conversationHistory);
  const openings = DIRECT_PROBE_OPENINGS.map(fn => fn(baseProbe));
  return pickVariant(openings, previousMsg, ti);
}

/**
 * Build a simpler version of the probe for uncertain students.
 */
function buildSimplerProbe(
  step: ReasoningStep,
  operands: StepOperands | null,
  uncertainCount = 0,
  conversationHistory?: Array<{ role: string; message: string }>,
): string {
  const previousMsg = getLastCoachMessage(conversationHistory);
  const ti = deriveTurnIndex(conversationHistory);

  if (!operands) {
    const question = step.probe || `What is the ${step.label.toLowerCase()}?`;
    const variants = SIMPLER_PROBE_OPENINGS_NO_OPERAND.map(fn => fn(question));
    return pickVariant(variants, previousMsg, ti);
  }

  const kindLabel = getKindLabel(step.kind);
  const variants = SIMPLER_PROBE_OPENINGS_OPERAND.map(fn => fn(kindLabel, operands.expression));
  return pickVariant(variants, previousMsg, ti);
}

/**
 * Get a friendly label for a step kind.
 */
function getKindLabel(kind: ReasoningStepKind): string {
  switch (kind) {
    case "ones_sum":
    case "identify_ones": return "ones";
    case "tens_sum":
    case "identify_tens": return "tens";
    case "combine":
    case "final_answer": return "last part";
    case "regroup": return "regrouping";
    case "borrow":
    case "identify_borrow": return "borrowing";
    case "subtract_ones": return "ones subtraction";
    case "subtract_tens": return "tens subtraction";
    case "skip_count": return "counting";
    case "identify_groups": return "groups";
    default: return "next part";
  }
}

/**
 * Build a combine prompt when all foundational steps are satisfied.
 */
function buildCombinePrompt(
  step: ReasoningStep,
  operands: StepOperands | null,
): string {
  if (operands) {
    return `Now put them together. What is ${operands.left} plus ${operands.right}?`;
  }
  return step.probe || "Now put those together. What is the final answer?";
}

// ============================================================================
// Concept explanation templates
// ============================================================================

/**
 * Build a step-aware concept explanation for a confused student.
 *
 * Each explanation is:
 * - short (2-3 sentences)
 * - concrete (uses the exact numbers from this problem)
 * - tied to the active step
 * - ends with one focused follow-up question
 *
 * This is NOT open-ended tutoring. It's a brief instructional moment
 * followed by an immediate return to the step probe.
 */
/**
 * Check whether the given concept confusion category has already been
 * explained in this conversation. Scans coach messages for fingerprints
 * that our concept-explanation templates leave behind.
 */
function hasExplainedCategorySameSession(
  category: ConceptConfusionCategory,
  conversationHistory: Array<{ role: string; message: string }> | undefined,
  mathProblem: MathProblem,
): boolean {
  if (!conversationHistory) return false;
  const a = mathProblem.a;
  const b = mathProblem.b ?? 0;
  const aTens = Math.floor(a / 10) * 10;
  const aOnes = a % 10;
  const bTens = Math.floor(b / 10) * 10;
  const bOnes = b % 10;

  // Fingerprints left by our first-time explanations:
  const decompFingerprint = `${a} = ${aTens} + ${aOnes}`;
  const vocabFingerprint = category === "VOCABULARY"
    ? "ones are the last digits"
    : null;

  for (const entry of conversationHistory) {
    if (entry.role !== "coach") continue;
    const msg = entry.message;
    if (category === "VOCABULARY" && vocabFingerprint && msg.includes(vocabFingerprint)) return true;
    if ((category === "DECOMPOSITION" || category === "STRUCTURE" || category === "DEMONSTRATION") &&
        (msg.includes(decompFingerprint) || msg.includes("Each part helps us solve"))) return true;
  }
  return false;
}

/**
 * Count consecutive structure-confusion turns from the student with no math
 * progress between them. Used to escalate after repeated why-are-we-doing-this.
 */
function countStructureConfusionTurns(
  conversationHistory: Array<{ role: string; message: string }> | undefined,
  mathProblem: MathProblem,
): number {
  if (!conversationHistory) return 0;
  let count = 0;
  const a = mathProblem.a;
  const b = mathProblem.b ?? 0;

  // Walk backward through student turns
  for (let i = conversationHistory.length - 1; i >= 0; i--) {
    const entry = conversationHistory[i];
    if (entry.role !== "student") continue;
    const msg = entry.message;

    // Check if this is a structure-confusion turn
    if (STRUCTURE_CONFUSION.some(p => p.test(msg)) ||
        /\bwhy\s+(?:are|do)\s+(?:you|we)\b/i.test(msg) ||
        /\bwhat\s+does\s+(?:that|this|it)\s+have\s+to\s+do\b/i.test(msg) ||
        /\bstill\s+don'?t\s+(?:get|understand)\b/i.test(msg)) {
      count++;
      continue;
    }

    // Check if this turn has math evidence (numbers, equations, decompositions)
    const normalized = normalizeNumberWords(msg);
    const hasNums = [...normalized.matchAll(/\b(\d+)\b/g)].some(m => {
      const n = parseInt(m[1]);
      return n === a || n === b || n === mathProblem.correctAnswer || (n > 0 && n < 100);
    });
    if (hasNums || /\d+\s*[\+\-]\s*\d+/.test(normalized)) {
      break; // Math progress found — stop counting
    }

    // Non-structure, non-math turn — stop counting consecutive streak
    break;
  }
  return count;
}

/**
 * Count consecutive uncertain turns (e.g., "I don't know") from the student
 * with no math progress or other state between them.
 * Used to escalate from STEP_PROBE_SIMPLER → STEP_HINT after 2+ consecutive.
 */
/**
 * Broader uncertain-turn detection for escalation counting.
 * Includes UNCERTAINTY_PATTERNS plus common variants like "I still don't know".
 */
const UNCERTAIN_TURN_PATTERNS = [
  ...UNCERTAINTY_PATTERNS,
  /\bi\s+(?:still\s+|really\s+)?(?:don'?t|do\s*not)\s+know\b/i,
  /\bi\s+(?:still\s+|really\s+)?(?:can'?t|cannot)\s+(?:do|figure|solve|get)\b/i,
  /\bi'?m\s+(?:still\s+)?(?:not\s+sure|confused|stuck|lost)\b/i,
];

function countConsecutiveUncertainTurns(
  conversationHistory: Array<{ role: string; message: string }> | undefined,
): number {
  if (!conversationHistory) return 0;
  let count = 0;

  // Walk backward through student turns
  for (let i = conversationHistory.length - 1; i >= 0; i--) {
    const entry = conversationHistory[i];
    if (entry.role !== "student") continue;
    const msg = entry.message;

    // Check if this is an uncertain turn (explicit patterns)
    if (UNCERTAIN_TURN_PATTERNS.some(p => p.test(msg))) {
      count++;
      continue;
    }

    // Vague non-substantive turn: no numbers, no equations, no math content,
    // and not a concept-confusion question (structure, vocabulary, decomposition,
    // demonstration request). classifyStudentState routes truly vague turns to
    // "uncertain" via the fallback path, so they count toward escalation.
    const isConceptQuestion =
      STRUCTURE_CONFUSION.some(p => p.test(msg)) ||
      VOCABULARY_CONFUSION.some(p => p.test(msg)) ||
      DECOMPOSITION_CONFUSION.some(p => p.test(msg)) ||
      DEMONSTRATION_REQUEST.some(p => p.test(msg)) ||
      /\bstill\s+don'?t\s+(?:get|understand)\b/i.test(msg);
    const normalized = normalizeNumberWords(msg);
    const hasNums = /\b\d+\b/.test(normalized);
    const hasEquation = /\d+\s*[\+\-\*×÷]\s*\d+/.test(normalized);
    if (!hasNums && !hasEquation && !isConceptQuestion) {
      count++;
      continue;
    }

    // Any turn with math content breaks the streak
    break;
  }
  return count;
}

/**
 * Build a short acknowledgment of already-satisfied steps.
 *
 * Returns a single sentence or empty string. When the active step is
 * combine, uses concrete results ("20" and "5") instead of operand
 * pairs ("10 and 10"). Capped to one sentence to avoid stacking.
 */
function buildStepAcknowledgment(
  stepAccumulation: ReasoningStepAccumulation | undefined,
  reasoningSteps: ReasoningStep[],
  mathProblem: MathProblem,
  activeStep?: ReasoningStep,
): string {
  if (!stepAccumulation || stepAccumulation.satisfiedStepIds.length === 0) return "";

  const a = mathProblem.a;
  const b = mathProblem.b ?? 0;
  const aTens = Math.floor(a / 10) * 10;
  const aOnes = a % 10;
  const bTens = Math.floor(b / 10) * 10;
  const bOnes = b % 10;
  const isSubtraction = mathProblem.skill === "two_digit_subtraction";
  const onesResult = isSubtraction ? aOnes - bOnes : aOnes + bOnes;
  const tensResult = isSubtraction ? aTens - bTens : aTens + bTens;

  const hasOnes = reasoningSteps.some(s =>
    stepAccumulation.satisfiedStepIds.includes(s.id) &&
    (s.kind === "ones_sum" || s.kind === "identify_ones" || s.kind === "subtract_ones"),
  );
  const hasTens = reasoningSteps.some(s =>
    stepAccumulation.satisfiedStepIds.includes(s.id) &&
    (s.kind === "tens_sum" || s.kind === "identify_tens" || s.kind === "subtract_tens"),
  );

  // Combine step: use concrete results for both parts in one sentence
  if (activeStep && (activeStep.kind === "combine" || activeStep.kind === "final_answer")) {
    if (hasOnes && hasTens) return `You already found ${tensResult} and ${onesResult}.`;
    if (hasTens) return `You already found the tens: ${tensResult}.`;
    if (hasOnes) return `You already found the ones: ${onesResult}.`;
    return "";
  }

  // Non-combine: acknowledge only the single most relevant satisfied step
  // to keep it short (cap to 1 sentence).
  if (hasTens && hasOnes) return `You already found the ones and tens.`;
  if (hasTens) return `You already found the tens: ${tensResult}.`;
  if (hasOnes) return `You already found the ones: ${onesResult}.`;
  return "";
}

/**
 * Explanation verbosity tier.
 *
 * full:    First explanation of a category, early in session. 2-3 sentences.
 * compact: Repeated explanation of same category, or mid-session. 1-2 sentences.
 * concise: Near success (completionRatio >= 0.66), combine step, or low time.
 *          Max 1 short sentence + 1 direct question.
 */
type ExplanationTier = "full" | "compact" | "concise";

function selectExplanationTier(
  isRepeat: boolean,
  step: ReasoningStep,
  stepAccumulation?: ReasoningStepAccumulation,
): ExplanationTier {
  // Concise: near success or on combine step
  const isCombine = step.kind === "combine" || step.kind === "final_answer";
  const nearSuccess = (stepAccumulation?.completionRatio ?? 0) >= 0.66;
  if (isCombine || nearSuccess) return "concise";

  // Compact: repeated explanation
  if (isRepeat) return "compact";

  // Full: first time, early in session
  return "full";
}

function buildConceptExplanation(
  category: ConceptConfusionCategory,
  step: ReasoningStep,
  operands: StepOperands | null,
  mathProblem: MathProblem,
  conversationHistory?: Array<{ role: string; message: string }>,
  stepAccumulation?: ReasoningStepAccumulation,
  reasoningSteps?: ReasoningStep[],
): string {
  const a = mathProblem.a;
  const b = mathProblem.b ?? 0;
  const aTens = Math.floor(a / 10) * 10;
  const aOnes = a % 10;
  const bTens = Math.floor(b / 10) * 10;
  const bOnes = b % 10;
  const probe = buildDirectProbe(step, operands);
  const opWord = mathProblem.skill === "two_digit_subtraction" ? "subtract" : "add";
  const isSubtraction = mathProblem.skill === "two_digit_subtraction";
  const onesResult = isSubtraction ? aOnes - bOnes : aOnes + bOnes;
  const tensResult = isSubtraction ? aTens - bTens : aTens + bTens;

  const isRepeat = hasExplainedCategorySameSession(category, conversationHistory, mathProblem);
  const tier = selectExplanationTier(isRepeat, step, stepAccumulation);
  const ack = (reasoningSteps && stepAccumulation)
    ? buildStepAcknowledgment(stepAccumulation, reasoningSteps, mathProblem, step)
    : "";
  const ackPrefix = ack ? `${ack} ` : "";

  // ── COMBINE / FINAL_ANSWER step ─────────────────────────────────────
  // Always concise: just reference the already-found parts and ask.
  if (step.kind === "combine" || step.kind === "final_answer") {
    if (operands) {
      return `${ackPrefix}Now we put them together: ${operands.left} plus ${operands.right}. What is ${operands.left} plus ${operands.right}?`;
    }
    return `${ackPrefix}Now we put the parts together. ${probe}`;
  }

  // ── VOCABULARY ───────────────────────────────────────────────────────
  if (category === "VOCABULARY") {
    if (tier === "concise") {
      switch (step.kind) {
        case "ones_sum": case "identify_ones": case "subtract_ones":
          return `${ackPrefix}The ones are ${aOnes} and ${bOnes}. ${probe}`;
        case "tens_sum": case "identify_tens": case "subtract_tens":
          return `${ackPrefix}The tens are ${aTens} and ${bTens}. ${probe}`;
        default:
          return `${ackPrefix}${probe}`;
      }
    }
    if (tier === "compact") {
      switch (step.kind) {
        case "ones_sum": case "identify_ones": case "subtract_ones":
          return `${ackPrefix}Remember, the ones are the last digits: ${aOnes} and ${bOnes}. ${probe}`;
        case "tens_sum": case "identify_tens": case "subtract_tens":
          return `${ackPrefix}Remember, the tens are ${aTens} and ${bTens}. ${probe}`;
        default:
          return `${ackPrefix}Remember what we talked about. ${probe}`;
      }
    }
    // full
    switch (step.kind) {
      case "ones_sum": case "identify_ones": case "subtract_ones":
        return `${ackPrefix}The ones are the last digits. In ${a} it's ${aOnes}, in ${b} it's ${bOnes}. ${probe}`;
      case "tens_sum": case "identify_tens": case "subtract_tens":
        return `${ackPrefix}The tens are the first digits. In ${a} it's ${aTens}, in ${b} it's ${bTens}. ${probe}`;
      case "regroup":
        return `${ackPrefix}That's okay. When the ones add up to more than 9, we carry the extra ten over to the tens column. ${probe}`;
      default:
        return `${ackPrefix}That's okay. Let me explain this part. ${probe}`;
    }
  }

  // ── DECOMPOSITION / STRUCTURE / DEMONSTRATION on non-combine steps ──
  // Full decomposition sentence: "14 = 10 + 4, and 11 = 10 + 1."
  const decomp = `${a} = ${aTens} + ${aOnes}, and ${b} = ${bTens} + ${bOnes}.`;
  const decompStrategy = `That's why we ${opWord} the tens and the ones separately. The tens are ${aTens} and ${bTens}, and the ones are ${aOnes} and ${bOnes}.`;

  // ── CONCISE tier ──────────────────────────────────────────────────
  if (tier === "concise") {
    // Step-specific one-liner + probe
    switch (step.kind) {
      case "ones_sum": case "identify_ones": case "subtract_ones":
        return `${ackPrefix}In ${a} the ones digit is ${aOnes}, in ${b} it's ${bOnes}. ${probe}`;
      case "tens_sum": case "identify_tens": case "subtract_tens":
        return `${ackPrefix}In ${a} the tens part is ${aTens}, in ${b} it's ${bTens}. ${probe}`;
      default:
        return `${ackPrefix}${probe}`;
    }
  }

  // ── COMPACT tier ──────────────────────────────────────────────────
  if (tier === "compact") {
    const compactDecomp = `Remember, ${a} is ${aTens} + ${aOnes} and ${b} is ${bTens} + ${bOnes}.`;
    if (category === "DECOMPOSITION") {
      return `${ackPrefix}${compactDecomp} ${probe}`;
    }
    if (category === "STRUCTURE") {
      return `${ackPrefix}We're solving ${mathProblem.expression}. ${probe}`;
    }
    // DEMONSTRATION
    return `${ackPrefix}${compactDecomp} ${probe}`;
  }

  // ── FULL tier ─────────────────────────────────────────────────────
  if (category === "DECOMPOSITION") {
    // Shortened to ≤18 words before probe (matches STRUCTURE pattern).
    return `${ackPrefix}Split into tens and ones: ${aTens}+${aOnes}, ${bTens}+${bOnes}. ${probe}`;
  }
  if (category === "STRUCTURE") {
    // When the student already has step progress, reference what they've done
    // to bridge the confusion — shows how completed steps connect to the goal.
    // Don't use ackPrefix here — stepAck already covers it, avoids duplication.
    if (stepAccumulation && stepAccumulation.satisfiedStepIds.length > 0 && reasoningSteps) {
      const stepAck = buildStepAcknowledgment(stepAccumulation, reasoningSteps, mathProblem, step);
      if (stepAck) {
        return `${stepAck} Each part helps us solve ${mathProblem.expression}. ${probe}`;
      }
      return `You've made progress on ${mathProblem.expression}. ${probe}`;
    }
    return `${ackPrefix}We're solving ${mathProblem.expression} in smaller parts. ${probe}`;
  }
  if (category === "DEMONSTRATION") {
    return `${ackPrefix}Sure. ${decomp} ${probe}`;
  }

  // Fallback
  return `${ackPrefix}Let me explain. ${probe}`;
}

// ============================================================================
// Misconception-specific redirect templates
// ============================================================================

/**
 * Build a misconception redirect with category-specific wording.
 *
 * Each category has a short, warm, grade-appropriate template that:
 * 1. Briefly names what the student did ("We're adding, not subtracting")
 * 2. Immediately redirects to the specific missing step
 *
 * Language rules:
 * - Use "adding" / "put together" / "ones" / "tens" (concrete, 2nd-grade)
 * - Never use "operation" / "strategy" / "conceptual misunderstanding"
 * - Keep to 1-2 sentences max
 */
function buildMisconceptionRedirect(
  category: MisconceptionCategory,
  step: ReasoningStep,
  operands: StepOperands | null,
  mathProblem: MathProblem,
  conversationHistory?: Array<{ role: string; message: string }>,
): string {
  const probe = buildDirectProbe(step, operands, conversationHistory);
  const previousMsg = getLastCoachMessage(conversationHistory);

  let templateKey: string;
  switch (category) {
    case "SUBTRACTION_ON_ADDITION":
      templateKey = "SUBTRACTION_ON_ADDITION";
      break;
    case "ADDITION_ON_SUBTRACTION":
      templateKey = "ADDITION_ON_SUBTRACTION";
      break;
    case "MULTIPLICATION_MISUSE": {
      const correctOp = mathProblem.skill === "two_digit_subtraction" ? "subtracting" : "adding";
      // Inline: no pool for rare multiplication misuse, just vary direct probe
      return `We're ${correctOp} in this problem, not multiplying. ${probe}`;
    }
    case "ONES_ONLY_CONFUSION":
      templateKey = (step.kind === "tens_sum" || step.kind === "identify_tens")
        ? "ONES_ONLY_CONFUSION_TENS"
        : "ONES_ONLY_CONFUSION_OTHER";
      break;
    case "TENS_ONLY_CONFUSION":
      templateKey = (step.kind === "ones_sum" || step.kind === "identify_ones")
        ? "TENS_ONLY_CONFUSION_ONES"
        : "TENS_ONLY_CONFUSION_OTHER";
      break;
    case "KNOWN_WRONG_ANSWER":
      templateKey = "KNOWN_WRONG_ANSWER";
      break;
    case "GENERIC_WRONG":
      templateKey = "GENERIC_WRONG";
      break;
  }

  const variants = MISCONCEPTION_REDIRECT_TEMPLATES[templateKey];
  const ti = deriveTurnIndex(conversationHistory);
  const opening = pickVariant(variants, previousMsg, ti);
  return `${opening} ${probe}`;
}

// ============================================================================
// Consecutive step-failure detection
// ============================================================================

/** Threshold: after this many wrong answers on the same step, model the answer. */
const STEP_FAILURE_ESCALATION_THRESHOLD = 2;

/**
 * Count how many prior turns the student gave a wrong answer while the coach
 * was probing the same step.
 *
 * Heuristic: a turn targets a step when the coach's probe text matches the
 * step's probe or expectedStatements operands. We detect this by checking
 * whether the coach message contains the step's probe text or the operands
 * from the step's expected statement.
 *
 * No-speech turns and procedural coach messages are transparent to this count:
 * they neither increment nor reset the consecutive failure streak. This prevents
 * audio retry loops from delaying escalation — if the student gave 2 wrong
 * answers on the same step, a no-speech retry in between does not reset the count.
 *
 * Returns the count of consecutive wrong student responses that followed
 * a probe for `targetStepId` (most recent streak only).
 */
export function countConsecutiveStepFailures(
  conversationHistory: Array<{ role: string; message: string }>,
  targetStep: ReasoningStep,
  mathProblem: MathProblem,
  currentResponse?: string,
): number {
  // Build fingerprints for this step's probe
  const operands = extractStepOperands(targetStep, mathProblem);
  const probeFingerprints: string[] = [];
  if (targetStep.probe) probeFingerprints.push(targetStep.probe.toLowerCase());
  if (operands) {
    probeFingerprints.push(`${operands.left} and ${operands.right}`);
    probeFingerprints.push(`${operands.right} and ${operands.left}`);
    probeFingerprints.push(operands.expression.toLowerCase());
  }

  if (probeFingerprints.length === 0) return 0;

  // Patterns for non-substantive turns that should be skipped, not break streaks
  const NO_SPEECH = /^\s*$|no\s*speech\s*detected/i;
  const PROCEDURAL_COACH_MSG = /didn't catch|would you like a hint|want to give it|try again|try answering|that's okay/i;

  // Extract coach→student pairs (forward pass), then count from the end.
  // Skip no-speech student turns — they carry no evidence and should not
  // consume the pending coach question (same logic as accumulateReasoningStepEvidence).
  // For procedural coach messages, let the prior substantive coach question carry through.
  //
  // We track two values:
  // - pendingCoach: the coach message to pair with the next student response
  // - lastSubstantiveCoach: the most recent non-procedural coach message,
  //   which carries through procedural retries
  const pairs: Array<{ coachMsg: string; studentMsg: string }> = [];
  let pendingCoach = "";
  let lastSubstantiveCoach = "";
  for (const entry of conversationHistory) {
    if (entry.role === "coach") {
      if (!PROCEDURAL_COACH_MSG.test(entry.message)) {
        // Substantive coach message — update both pending and last-substantive
        pendingCoach = entry.message;
        lastSubstantiveCoach = entry.message;
      } else {
        // Procedural message — only set pending if there's nothing yet,
        // otherwise let the last substantive coach carry through
        pendingCoach = lastSubstantiveCoach || entry.message;
      }
    } else if (entry.role === "student") {
      if (NO_SPEECH.test(entry.message)) {
        // Skip no-speech turns — don't consume the pending coach question
        continue;
      }
      if (pendingCoach) {
        pairs.push({ coachMsg: pendingCoach, studentMsg: entry.message });
        pendingCoach = "";
      }
    }
  }

  // If a current response was provided, pair it with the last substantive coach
  // context. This handles the case where the history ends with a student message
  // (e.g., after no-speech retries consumed the coach question) and the current
  // response needs its own pair for counting.
  if (currentResponse && !NO_SPEECH.test(currentResponse)) {
    const coachContext = pendingCoach || lastSubstantiveCoach;
    if (coachContext) {
      pairs.push({ coachMsg: coachContext, studentMsg: currentResponse });
    }
  }

  // Walk pairs backwards, counting consecutive wrong answers on this step
  let consecutiveFailures = 0;
  const stepExpected = targetStep.expectedStatements[0];
  const stepMatch = stepExpected?.match(/=\s*(\d+)/);
  const stepAnswer = stepMatch ? parseInt(stepMatch[1], 10) : null;

  for (let i = pairs.length - 1; i >= 0; i--) {
    const { coachMsg, studentMsg } = pairs[i];

    // Check if the coach was probing this specific step
    const coachLower = coachMsg.toLowerCase();
    const coachTargetedStep = probeFingerprints.some(fp => coachLower.includes(fp));
    if (!coachTargetedStep) break;

    // Check if the student gave a wrong numeric answer
    const normalized = normalizeNumberWords(studentMsg.trim());
    const extracted = extractNumericAnswer(normalized);

    if (extracted === null) break; // No number → uncertainty, streak ends
    if (stepAnswer !== null && extracted === stepAnswer) break; // Correct for this step
    if (extracted === mathProblem.correctAnswer) break; // Correct final answer

    consecutiveFailures++;
  }

  return consecutiveFailures;
}

/**
 * Build a modeled instruction that gives the student the answer for a stuck step.
 *
 * Used after STEP_FAILURE_ESCALATION_THRESHOLD wrong attempts on the same step.
 * Models the answer, then probes the next step (if any).
 *
 * Example: "In this problem, 10 + 10 = 20. Now what is 20 + 5?"
 */
function buildStepModelInstruction(
  step: ReasoningStep,
  operands: StepOperands | null,
  reasoningSteps: ReasoningStep[],
  accumulation: ReasoningStepAccumulation,
  mathProblem: MathProblem,
): string {
  // Model the stuck step's answer
  const stmt = step.expectedStatements[0] || step.label;
  const modelText = `In this problem, ${stmt}.`;

  // Find the next missing step AFTER this one to probe
  const COMBINE_KINDS: ReasoningStepKind[] = ["combine", "final_answer"];
  const missingSet = new Set(accumulation.missingStepIds);
  // Remove the current step — we just modeled it
  missingSet.delete(step.id);
  const remaining = reasoningSteps.filter(s => missingSet.has(s.id));

  if (remaining.length === 0) {
    // This was the last missing step — ask for the final answer
    return `${modelText} So what is ${mathProblem.expression}?`;
  }

  // Find the next step to probe (foundational first, then combine)
  const foundational = remaining.filter(s => !COMBINE_KINDS.includes(s.kind));
  const nextStep = foundational[0] || remaining[0];
  const nextOperands = extractStepOperands(nextStep, mathProblem);
  const nextProbe = buildDirectProbe(nextStep, nextOperands);

  return `${modelText} ${nextProbe}`;
}

// ============================================================================
// Step-specific instructional recap (no named misconception needed)
// ============================================================================

/**
 * Build a step-specific instructional recap for wraps when the student
 * persistently failed a specific reasoning step without a named misconception.
 *
 * Example: "We were working on the tens step. In this problem, 10 + 10 = 20.
 *           Then you combine 20 and 5 to get 25. You're getting closer!"
 */
export function buildStepFailureRecap(
  reasoningSteps: ReasoningStep[],
  failedStep: ReasoningStep,
  mathProblem: MathProblem,
): string {
  const stepLabel = failedStep.label.toLowerCase();
  const failedStmt = failedStep.expectedStatements[0];

  // Walk through the full solution path
  const stepStatements = reasoningSteps
    .map(s => s.expectedStatements[0])
    .filter((s): s is string => !!s);

  if (stepStatements.length === 0) {
    return "You're getting closer!";
  }

  const parts: string[] = [];

  // Name the stuck step
  parts.push(`We were working on the ${stepLabel} step.`);

  // Model the stuck step's answer
  if (failedStmt) {
    parts.push(`In this problem, ${failedStmt}.`);
  }

  // Show remaining steps to complete the solution
  const failedIdx = reasoningSteps.indexOf(failedStep);
  const afterSteps = reasoningSteps
    .slice(failedIdx + 1)
    .map(s => s.expectedStatements[0])
    .filter((s): s is string => !!s);

  if (afterSteps.length > 0) {
    const combined = afterSteps.length === 1
      ? afterSteps[0]
      : afterSteps.slice(0, -1).join(", ") + ", and " + afterSteps[afterSteps.length - 1];
    parts.push(`Then ${combined}.`);
  }

  parts.push("You're getting closer!");
  return parts.join(" ");
}

// ============================================================================
// Main remediation selector
// ============================================================================

/**
 * Select the deterministic remediation move for the current turn.
 *
 * Priority order:
 * 1. WRAP_SUCCESS if all steps satisfied + correct answer
 * 2. Misconception redirect (highest priority for wrong answers)
 * 3. Step-tied probe/hint/simpler based on student state
 * 4. Returns null only when no reasoning steps exist
 */
export function getDeterministicRemediationMove(
  reasoningSteps: ReasoningStep[],
  stepAccumulation: ReasoningStepAccumulation,
  studentResponse: string,
  mathProblem: MathProblem,
  conversationHistory?: Array<{ role: string; message: string }>,
  interpretation?: MathUtteranceInterpretation,
): RemediationMove | null {
  if (!reasoningSteps.length) return null;

  // 1. WRAP SUCCESS: all steps satisfied + correct answer
  if (stepAccumulation.missingStepIds.length === 0 && stepAccumulation.answerCorrect) {
    return {
      type: "WRAP_SUCCESS",
      text: "",
      targetStepId: null,
      targetStepKind: null,
      studentState: "success",
      explanation: "All reasoning steps satisfied and answer is correct.",
    };
  }

  // 1b. ALTERNATE STRATEGY SUCCESS: student showed a valid alternate arithmetic
  // decomposition (not the canonical ones/tens/combine) that reaches the correct
  // answer. Coaching may guide with the canonical method, but validation must
  // accept any mathematically valid, age-appropriate reasoning path.
  if (stepAccumulation.alternateStrategyDetected && stepAccumulation.answerCorrect) {
    // Check if the student's explanation is clear enough to count as success.
    // An alternate strategy with at least 2 canonical steps OR containing
    // explicit intermediate work is sufficient. If only the combine step is
    // satisfied (e.g. just "is it 25?"), ask one clarifying question.
    const canonicalStepsSatisfied = stepAccumulation.satisfiedStepIds.length;
    const hasExplicitWork = /\d+\s*[\+\-]\s*\d+\s*=\s*\d+/.test(
      normalizeNumberWords(studentResponse),
    );
    const priorExplicitWork = conversationHistory
      ? conversationHistory
          .filter(h => h.role === "student")
          .some(h => /\d+\s*[\+\-]\s*\d+\s*=\s*\d+/.test(normalizeNumberWords(h.message)))
      : false;

    if (canonicalStepsSatisfied >= 2 || hasExplicitWork || priorExplicitWork) {
      return {
        type: "WRAP_SUCCESS",
        text: "",
        targetStepId: null,
        targetStepKind: null,
        studentState: "success",
        explanation: `Alternate strategy detected with valid reasoning. Canonical coverage: ${canonicalStepsSatisfied}/${reasoningSteps.length}.`,
      };
    }
    // Alternate strategy detected but explanation is thin — ask one clarifying
    // question about the student's own method instead of forcing canonical steps.
    return {
      type: "STEP_PROBE_DIRECT",
      text: `That's right, the answer is ${mathProblem.correctAnswer}! Can you walk me through how you got there step by step?`,
      targetStepId: null,
      targetStepKind: null,
      studentState: "correct_incomplete",
      explanation: `Alternate strategy detected but explanation is thin (${canonicalStepsSatisfied} canonical steps). Asking for clarification of student's own method.`,
    };
  }

  // 1c. PARTIAL ALTERNATE STRATEGY: Student showed non-canonical intermediate
  // arithmetic work (e.g., "14 + 10 = 24 and then 25") but the chain is
  // incomplete. Ask about THEIR gap, not the canonical ones step.
  if (stepAccumulation.answerCorrect && stepAccumulation.missingStepIds.length > 0) {
    const allStudentText = conversationHistory
      ? conversationHistory.filter(h => h.role === "student").map(h => h.message).join(" ") + " " + studentResponse
      : studentResponse;
    const normalized = normalizeNumberWords(allStudentText);
    // Collect all canonical expected numbers
    const canonicalNums = new Set<number>();
    for (const step of reasoningSteps) {
      for (const stmt of step.expectedStatements) {
        const nums = stmt.match(/\d+/g) || [];
        nums.forEach(n => canonicalNums.add(parseInt(n)));
      }
    }
    // Find non-canonical intermediates in student text
    const studentNums = [...normalized.matchAll(/\b\d+\b/g)].map(m => parseInt(m[0]));
    const nonCanonical = [...new Set(studentNums)].filter(
      n => n > 0 && n !== mathProblem.correctAnswer && !canonicalNums.has(n),
    );
    // If student showed non-canonical intermediate work, ask about their method
    if (nonCanonical.length > 0) {
      // Find the gap: which intermediate is closest to but less than the answer?
      const nearAnswer = nonCanonical
        .filter(n => n < mathProblem.correctAnswer && n > mathProblem.correctAnswer * 0.5)
        .sort((a, b) => b - a)[0];
      if (nearAnswer) {
        const gap = mathProblem.correctAnswer - nearAnswer;
        return {
          type: "STEP_PROBE_DIRECT",
          text: `That's right, the answer is ${mathProblem.correctAnswer}! You got to ${nearAnswer} — how did you get from ${nearAnswer} to ${mathProblem.correctAnswer}?`,
          targetStepId: null,
          targetStepKind: null,
          studentState: "correct_incomplete",
          explanation: `Student showed non-canonical intermediate work (${nearAnswer}) with correct answer. Asking about their gap (${nearAnswer} → ${mathProblem.correctAnswer}, gap=${gap}) instead of canonical step.`,
        };
      }
    }
  }

  // 1d. PARTIAL ALTERNATE IN PROGRESS: Student has NOT yet given the correct
  // final answer, but their extracted answer is a valid alternate-strategy
  // intermediate (e.g., 24 for 14+11=25 via 14+10=24). Instead of treating
  // this as a wrong answer and probing canonical steps, follow up on THEIR
  // method by asking what comes next.
  if (!stepAccumulation.answerCorrect && stepAccumulation.extractedAnswer !== null) {
    const allStudentText = conversationHistory
      ? conversationHistory.filter(h => h.role === "student").map(h => h.message).join(" ") + " " + studentResponse
      : studentResponse;
    const normalizedAll = normalizeNumberWords(allStudentText);
    if (isAlternateStrategyIntermediate(stepAccumulation.extractedAnswer, mathProblem, normalizedAll)) {
      const intermediate = stepAccumulation.extractedAnswer;
      const remainder = mathProblem.correctAnswer - intermediate;
      // ATTRIBUTION GUARD: Do NOT say "You said 14 + 11 and you got to 20"
      // when the student was answering a sub-step like "What is 10 + 10?"
      // Instead, acknowledge the intermediate without attributing it to the whole problem.
      const scope = detectActiveAnswerScope(conversationHistory, reasoningSteps, mathProblem);
      const scopeExpr = scope !== "WHOLE_PROBLEM"
        ? getScopeExpression(scope, reasoningSteps, mathProblem)
        : null;
      const text = scopeExpr
        ? `Good — ${intermediate} is right for ${scopeExpr}. Now what do you do with the ${remainder} that's left?`
        : `Good, ${intermediate}. What do you do with the ${remainder} that's left?`;
      return {
        type: "STEP_PROBE_DIRECT",
        text,
        targetStepId: null,
        targetStepKind: null,
        studentState: "partial",
        explanation: `Student at alternate-strategy intermediate ${intermediate} (${mathProblem.correctAnswer} - ${intermediate} = ${remainder} remaining). Following up on their method instead of canonical steps.`,
      };
    }
  }

  // 1d-ii. ATTRIBUTION CLARIFICATION: Student is correcting a misattribution.
  // E.g., "I didn't say 14 + 11 = 20, I said 10 + 10 = 20."
  // Must run BEFORE computation mistake detection, which could misparse the claim.
  {
    const scope = detectActiveAnswerScope(conversationHistory, reasoningSteps, mathProblem, studentResponse);
    if (scope === "CLARIFICATION") {
      const nextStep = getNextMissingStep(reasoningSteps, stepAccumulation);
      const probe = nextStep
        ? buildDirectProbe(nextStep, extractStepOperands(nextStep, mathProblem))
        : `What is ${mathProblem.expression}?`;
      const claimMatch = studentResponse.match(/\b(\d+)\s*(?:\+|plus)\s*(\d+)\b/gi);
      // Find the SECOND computation (the one they're claiming they said)
      const claims = claimMatch || [];
      const theirClaim = claims.length >= 2 ? claims[claims.length - 1] : claims[0];
      const claimNums = theirClaim?.match(/(\d+)\s*(?:\+|plus)\s*(\d+)/i);
      const acknowledgment = claimNums
        ? `You're right — ${claimNums[1]} + ${claimNums[2]} = ${parseInt(claimNums[1]) + parseInt(claimNums[2])}. `
        : "You're right, thanks for clarifying. ";
      const combineHint = stepAccumulation.satisfiedStepIds.length > 0 && nextStep?.kind === "combine"
        ? `Now put them together: ${probe}`
        : probe;
      return {
        type: "STEP_ACKNOWLEDGE_AND_PROBE",
        text: `${acknowledgment}${combineHint}`,
        targetStepId: nextStep?.id ?? null,
        targetStepKind: nextStep?.kind ?? null,
        studentState: "partial",
        explanation: `Student corrected a misattribution. Acknowledged their clarification and continued to next step.`,
      };
    }
  }

  // 1e. COMPUTATION MISTAKE: Student shows a valid strategy structure but
  // makes an arithmetic slip inside it. E.g., "I split 11 into 10 and 1,
  // then 14 + 10 is 34" — the strategy (split-addend) is correct, but
  // 14 + 10 = 24, not 34. Correct the arithmetic briefly and continue
  // in the student's own method. Must check BEFORE generic classification
  // since the wrong answer would otherwise route to "wrong" or "misconception".
  {
    const compMistake = detectComputationMistake(studentResponse, mathProblem, reasoningSteps, stepAccumulation);
    if (compMistake) {
      return {
        type: "STEP_COMPUTATION_CORRECTION",
        text: `Close — ${compMistake.intendedLeft} + ${compMistake.intendedRight} is ${compMistake.correctResult}, not ${compMistake.studentResult}. ${compMistake.nextProbe}`,
        targetStepId: null,
        targetStepKind: null,
        studentState: "computation_mistake",
        explanation: `Student used valid ${compMistake.stepType} strategy but computed ${compMistake.intendedLeft} + ${compMistake.intendedRight} = ${compMistake.studentResult} (correct: ${compMistake.correctResult}). Corrected arithmetic and continued in student's method.`,
      };
    }
  }

  // 2. Classify student state
  // Build interpretation once and pass to classifyStudentState — avoids
  // re-deriving decomposition/substep signals that the validator already knows.
  const problemOp2 = mathProblem.skill === "two_digit_subtraction" ? "-" as const
    : mathProblem.skill === "two_digit_addition" ? "+" as const
    : undefined;
  const interp = interpretation ?? interpretMathUtterance(
    studentResponse, mathProblem.correctAnswer, undefined,
    mathProblem.b !== undefined ? [mathProblem.a, mathProblem.b] : undefined,
    problemOp2,
  );
  let studentState = classifyStudentState(studentResponse, stepAccumulation, mathProblem, interp);

  // 2a. STRATEGY LOCK GUARD: If the student was classified as "wrong" but
  // the coach previously redirected to canonical method and the student
  // has NOT accepted, their "wrong" answer may be from their own strategy.
  // Don't penalize them — re-probe gently instead.
  if (studentState === "wrong" && conversationHistory) {
    const coachRedirected = conversationHistory.some(
      e => e.role === "coach" && /\btens and ones\b|\beasier\b.*\b(?:split|break)\b/i.test(e.message),
    );
    if (coachRedirected && !hasAcceptedCanonicalRedirect(conversationHistory)) {
      const nextStep = getNextMissingStep(reasoningSteps, stepAccumulation);
      const probe = nextStep
        ? buildDirectProbe(nextStep, extractStepOperands(nextStep, mathProblem))
        : `What is ${mathProblem.expression}?`;
      return {
        type: "STEP_PROBE_DIRECT",
        text: `Let's try it with tens and ones. ${probe}`,
        targetStepId: nextStep?.id ?? null,
        targetStepKind: nextStep?.kind ?? null,
        studentState: "wrong",
        explanation: `Student answered wrong but has not accepted canonical redirect. Re-probed gently instead of marking wrong.`,
      };
    }
  }

  // 2a-ii. ANSWER-SCOPE ATTRIBUTION GUARD: Detect what scope the student
  // was answering in. If they answered a sub-step correctly but are classified
  // as "wrong" (because the sub-step answer ≠ whole-problem answer), reclassify.
  // Clarification is handled earlier (section 1d-ii).
  const answerScope = detectActiveAnswerScope(conversationHistory, reasoningSteps, mathProblem, studentResponse);

  if (studentState === "wrong" && answerScope !== "WHOLE_PROBLEM" && answerScope !== "STRATEGY_SETUP" && answerScope !== "CLARIFICATION") {
    // Student answered a sub-step probe. Check if their answer is correct FOR THAT STEP.
    const extractedAnswer = extractNumericAnswer(normalizeNumberWords(studentResponse.trim()));
    if (extractedAnswer !== null && reasoningSteps) {
      const targetKinds: ReasoningStepKind[] = answerScope === "ONES_SUBSTEP"
        ? ["identify_ones", "ones_sum"]
        : answerScope === "TENS_SUBSTEP"
          ? ["identify_tens", "tens_sum"]
          : ["combine", "final_answer"];
      for (const step of reasoningSteps) {
        if (!targetKinds.includes(step.kind)) continue;
        // Check if the student's answer matches the expected result for this step
        const stmtMatch = step.expectedStatements[0]?.match(/=\s*(\d+)/);
        if (stmtMatch && parseInt(stmtMatch[1]) === extractedAnswer) {
          // Correct sub-step answer! Do NOT classify as "wrong".
          const nextStep = getNextMissingStep(reasoningSteps, stepAccumulation);
          const probe = nextStep
            ? buildDirectProbe(nextStep, extractStepOperands(nextStep, mathProblem))
            : `What is ${mathProblem.expression}?`;
          const scopeExpr = getScopeExpression(answerScope, reasoningSteps, mathProblem);
          return {
            type: "STEP_ACKNOWLEDGE_AND_PROBE",
            text: `Good — ${scopeExpr} is ${extractedAnswer}. ${probe}`,
            targetStepId: nextStep?.id ?? null,
            targetStepKind: nextStep?.kind ?? null,
            studentState: "partial",
            explanation: `Student correctly answered ${answerScope} (${scopeExpr} = ${extractedAnswer}). Acknowledged and moved to next step. Not misattributed as whole-problem wrong answer.`,
          };
        }
      }
    }
  }

  // 2a-iii. METHOD ACKNOWLEDGMENT REPAIR: Student feels their math reasoning
  // was ignored ("did you hear me?", "that's not what I said").
  // Reclassify before state-specific handling so the repair path fires.
  // Can override: uncertain, math_relevant_resistance, valid_inefficient,
  // noncanonical_active, wrong, misconception — any state where the student
  // is correcting a misattribution or requesting acknowledgment.
  if (
    (studentState === "uncertain" || studentState === "math_relevant_resistance"
      || studentState === "valid_inefficient" || studentState === "noncanonical_active"
      || studentState === "wrong" || studentState === "misconception") &&
    detectMethodRepair(studentResponse, mathProblem, conversationHistory)
  ) {
    studentState = "method_acknowledgment_repair";
  }

  // 2a-iii-b. MULTI-TURN DECOMPOSITION: Student spread decompositions across
  // turns (Turn 1: "14=7+7", Turn 2: "11=5+6", Turn 3: "7+6=13").
  // classifyStudentState only checks single-utterance multi-decomposition.
  // Reclassify to noncanonical_active when history shows a coherent strategy
  // and the current utterance is computational (not resistance/questioning).
  if (
    studentState !== "method_acknowledgment_repair" &&
    studentState !== "concept_confusion" &&
    studentState !== "hint_request" &&
    studentState !== "av_delivery_complaint" &&
    studentState !== "math_relevant_resistance"
  ) {
    // Don't reclassify questioning/resistance utterances as noncanonical_active
    const isQuestioning = /\bwhy\s+(?:can'?t|couldn'?t|wouldn'?t|don'?t)\b/i.test(studentResponse);
    if (!isQuestioning) {
      const multiTurn = detectMultiTurnDecompositionStrategy(
        studentResponse, mathProblem, conversationHistory,
      );
      if (multiTurn && multiTurn.isContinuation) {
        studentState = "noncanonical_active";
      }
    }
  }

  // 2a-iv. MIXED STRATEGY ACTIVE: Student has canonical progress AND continues
  // referencing a non-canonical decomposition. Reclassify states that would
  // otherwise lose the mixed-strategy context.
  if (
    (studentState === "noncanonical_active" || studentState === "valid_inefficient" || studentState === "math_relevant_resistance") &&
    detectMixedStrategyActive(studentResponse, stepAccumulation, mathProblem, conversationHistory)
  ) {
    studentState = "mixed_strategy_active";
  }

  // 2b. ALTERNATE STRATEGY SETUP: Student is trying to split/break a number
  // but hasn't produced a valid intermediate yet.
  //
  // METHOD OWNERSHIP RULE: If the student stated specific decomposition parts,
  // the coach MUST mirror those parts before redirecting. The coach must NOT
  // silently replace the student's plan with the canonical tens+ones split.
  //
  // Three sub-cases:
  // 2b-i:  Student stated specific non-canonical parts → mirror, then redirect
  // 2b-ii: Student stated canonical parts → mirror and continue
  // 2b-iii: Student just said "split" with no parts → ask what they'd split into
  if (studentState === "alternate_setup") {
    const a = mathProblem.a;
    const b = mathProblem.b ?? 0;
    const normalized = normalizeNumberWords(studentResponse.trim());

    // Determine which operand they want to split
    const mentionsA = new RegExp(`\\b${a}\\b`).test(normalized);
    const mentionsB = new RegExp(`\\b${b}\\b`).test(normalized);
    const splitTarget = mentionsB && !mentionsA ? b
      : mentionsA && !mentionsB ? a
      : Math.min(a, b);
    const keptWhole = splitTarget === a ? b : a;
    const splitTens = Math.floor(splitTarget / 10) * 10;
    const splitOnes = splitTarget % 10;

    // Check if the student stated SPECIFIC parts (e.g., "split 11 into 10 and 1"
    // or "split 14 into 7 and 7"). detectValidInefficientDecomposition catches
    // non-canonical; we also need to detect canonical stated parts.
    const statedParts = detectStatedDecompositionParts(normalized, a, b);

    if (statedParts) {
      const { operand, partA, partB, isCanonical } = statedParts;

      if (isCanonical) {
        // 2b-ii: Student stated canonical split — mirror and continue
        const firstStep = keptWhole + Math.max(partA, partB);
        return {
          type: "STEP_PROBE_DIRECT",
          text: `Good thinking! ${operand} is ${partA} + ${partB}. What is ${keptWhole} + ${Math.max(partA, partB)}?`,
          targetStepId: null,
          targetStepKind: null,
          studentState: "alternate_setup",
          explanation: `Student stated canonical split ${operand} = ${partA} + ${partB}. Mirrored and continued.`,
        };
      } else {
        // 2b-i: Student stated non-canonical parts — mirror THEIR plan first,
        // then explain why canonical is easier, then redirect.
        // This should NOT have reached here (valid_inefficient handles it),
        // but as a safety net: mirror and redirect.
        const otherOperand = operand === a ? b : a;
        const otherTens = Math.floor(otherOperand / 10) * 10;
        const otherOnes = otherOperand % 10;
        const opTens = Math.floor(operand / 10) * 10;
        const opOnes = operand % 10;
        const nextStep = getNextMissingStep(reasoningSteps, stepAccumulation);
        const probe = nextStep ? buildDirectProbe(nextStep, extractStepOperands(nextStep, mathProblem)) : `What is ${mathProblem.expression}?`;

        return {
          type: "STEP_PROBE_DIRECT",
          text: `${operand} = ${partA} + ${partB} works! Try ${opTens} + ${opOnes} instead — it lines up with ${otherOperand}. ${probe}`,
          targetStepId: nextStep?.id ?? null,
          targetStepKind: nextStep?.kind ?? null,
          studentState: "alternate_setup",
          explanation: `Student stated non-canonical split ${operand} = ${partA} + ${partB}. Mirrored their plan, explained why canonical is easier, redirected.`,
        };
      }
    }

    // 2b-iii: Student said "split" but didn't specify parts — ask first.
    // Do NOT assume canonical split. Mirror their intent and ask.
    return {
      type: "STEP_PROBE_DIRECT",
      text: `Good idea to split ${splitTarget}! How would you split it?`,
      targetStepId: null,
      targetStepKind: null,
      studentState: "alternate_setup",
      explanation: `Student wants to split ${splitTarget} but didn't specify parts. Asked what they'd split it into rather than assuming canonical.`,
    };
  }

  // 2c. VALID BUT INEFFICIENT DECOMPOSITION: Student proposed a true
  // decomposition (e.g., "14 = 7 + 7") that isn't the canonical tens+ones
  // split. Acknowledge the math, explain why tens+ones is easier, and
  // redirect to the canonical next step.
  if (studentState === "valid_inefficient") {
    const decomp = detectValidInefficientDecomposition(studentResponse, mathProblem);
    if (decomp) {
      const { operand, partA, partB } = decomp;
      const tens = Math.floor(operand / 10) * 10;
      const ones = operand % 10;
      const otherOperand = operand === mathProblem.a ? (mathProblem.b ?? 0) : mathProblem.a;
      const otherTens = Math.floor(otherOperand / 10) * 10;
      const otherOnes = otherOperand % 10;

      // Find the current missing step to ask about
      const nextStep = getNextMissingStep(reasoningSteps, stepAccumulation);
      const probe = nextStep ? buildDirectProbe(nextStep, extractStepOperands(nextStep, mathProblem)) : `What is ${mathProblem.expression}?`;
      const targetId = nextStep?.id ?? null;
      const targetKind = nextStep?.kind ?? null;

      return {
        type: "STEP_PROBE_DIRECT",
        text: `${operand} = ${partA} + ${partB} works! Try ${tens} + ${ones} instead — it lines up with ${otherOperand}. ${probe}`,
        targetStepId: targetId,
        targetStepKind: targetKind,
        studentState: "valid_inefficient",
        explanation: `Student proposed valid decomposition ${operand} = ${partA} + ${partB}. Acknowledged correctness, explained why ${tens} + ${ones} is more useful here, redirected to canonical step.`,
      };
    }
  }

  // 2d. NONCANONICAL ACTIVE: Student proposes two non-canonical decompositions
  // and/or computes with them. CONTINUE in the student's strategy — guide them
  // through their own decomposition to completion rather than redirecting.
  if (studentState === "noncanonical_active") {
    // Check single-utterance first, then multi-turn
    const multiResult = detectMultiDecompositionStrategy(studentResponse, mathProblem);
    const multiTurnResult = !multiResult
      ? detectMultiTurnDecompositionStrategy(studentResponse, mathProblem, conversationHistory)
      : null;
    const decomps = multiResult?.decomps ?? multiTurnResult?.decomps ?? [];
    const computed = multiResult?.computed;

    if (decomps.length >= 2) {
      const a = mathProblem.a;
      const b = mathProblem.b ?? 0;
      const decompDesc = decomps.map(d => `${d.operand} = ${d.partA} + ${d.partB}`).join(" and ");
      const computedDesc = computed ? ` and ${computed.left} + ${computed.right} = ${computed.result}` : "";

      // Build a continuation probe in the student's strategy.
      // Figure out what the student still needs to reach the answer.
      const allParts = decomps.flatMap(d => [d.partA, d.partB]);
      const correctAnswer = mathProblem.correctAnswer;

      // Check if the student is correcting the coach's combine target
      const replacementPair = detectReplacementPair(studentResponse);

      // Gather already-answered combine pairs from conversation history
      const answeredPairs = findAnsweredCombinePairs(conversationHistory);

      let continuationProbe: string;
      if (replacementPair && isReplacementPairRelevant(replacementPair, mathProblem, conversationHistory)) {
        // Student corrected the pair — adopt it immediately
        const result = replacementPair.left + replacementPair.right;
        continuationProbe = `Right, ${replacementPair.left} + ${replacementPair.right} = ${result}. What do all the parts add up to?`;
      } else if (computed) {
        // They computed one cross-pair. Figure out remaining parts,
        // excluding parts already used in answered pairs.
        const allAnsweredParts = answeredPairs.flatMap(a => [a.left, a.right]);
        const usedParts = [...new Set([computed.left, computed.right, ...allAnsweredParts])];
        const remaining = allParts.filter(p => !usedParts.includes(p));
        if (remaining.length >= 2) {
          continuationProbe = `You have ${computed.result} from ${computed.left} + ${computed.right}. Now what about ${remaining[0]} and ${remaining[1]}?`;
        } else if (remaining.length === 1) {
          continuationProbe = `You have ${computed.result} and ${remaining[0]} left. What is ${computed.result} + ${remaining[0]}?`;
        } else {
          // All pairs answered — ask for final sum
          const partialSums = answeredPairs.map(a => a.result);
          if (computed) partialSums.push(computed.result);
          continuationProbe = `You've combined the pairs. What does everything add up to?`;
        }
      } else {
        // No computation yet — use intelligent pair selection
        const decompA = decomps.find(d => d.operand === a);
        const decompB = decomps.find(d => d.operand === b);
        if (decompA && decompB) {
          const bestPair = selectBestCombinePair(decompA, decompB, conversationHistory);
          if (bestPair) {
            continuationProbe = `What is ${bestPair.left} + ${bestPair.right}?`;
          } else {
            // All pairs answered — ask for final sum
            continuationProbe = `You've combined the pairs. What does everything add up to?`;
          }
        } else {
          continuationProbe = `Good splits! Now how do you combine the parts?`;
        }
      }

      return {
        type: "STEP_PROBE_DIRECT",
        text: `Good: ${decompDesc}${computedDesc}. ${continuationProbe}`,
        targetStepId: null,
        targetStepKind: null,
        studentState: "noncanonical_active",
        explanation: `Student actively constructed multi-decomposition strategy (${decompDesc}${computedDesc}). Acknowledged correctness, continuing in student's strategy.`,
      };
    }

    // Fallback: reclassified as noncanonical_active (e.g. multi-turn) but
    // can't assemble full decomp details. Acknowledge and continue.
    const fallbackDecomp = conversationHistory
      ? findPriorStudentDecomposition(conversationHistory, mathProblem)
      : null;
    const fallbackProbe = `How do you get from there to ${mathProblem.correctAnswer}?`;
    return {
      type: "STEP_PROBE_DIRECT",
      text: fallbackDecomp
        ? `You split ${fallbackDecomp.operand} into ${fallbackDecomp.partA} + ${fallbackDecomp.partB} — that works. ${fallbackProbe}`
        : `Your splitting strategy works. ${fallbackProbe}`,
      targetStepId: null,
      targetStepKind: null,
      studentState: "noncanonical_active",
      explanation: `Noncanonical active fallback: multi-turn strategy detected. Continuing in student's approach.`,
    };
  }

  // 2d-ii. MIXED STRATEGY ACTIVE: Student has canonical progress AND continues
  // exploring a non-canonical decomposition. Acknowledge both truths, then
  // choose one next step and stay consistent.
  if (studentState === "mixed_strategy_active") {
    const nextStep = getNextMissingStep(reasoningSteps, stepAccumulation);
    const probe = nextStep ? buildDirectProbe(nextStep, extractStepOperands(nextStep, mathProblem)) : `What is ${mathProblem.expression}?`;
    const targetId = nextStep?.id ?? null;
    const targetKind = nextStep?.kind ?? null;

    // Find what canonical step they've done
    const satisfiedStepLabels: string[] = [];
    for (const step of reasoningSteps) {
      if (stepAccumulation.satisfiedStepIds.includes(step.id)) {
        const m = step.expectedStatements[0]?.match(/=\s*(\d+)/);
        if (m) satisfiedStepLabels.push(m[1]);
      }
    }
    const progressAck = satisfiedStepLabels.length > 0
      ? `You already found ${satisfiedStepLabels.join(" and ")}. `
      : "";

    // Find the non-canonical decomposition (current response or prior)
    const currentDecomp = detectValidInefficientDecomposition(studentResponse, mathProblem)
      || (detectMultiDecompositionStrategy(studentResponse, mathProblem)?.decomps[0] ?? null);
    const decomp = currentDecomp || (conversationHistory
      ? findPriorStudentDecomposition(conversationHistory, mathProblem)
      : null);

    // Check if this is a repeated resistance (should use short form)
    const isRepeated = conversationHistory
      ? hasRepeatedResistance(conversationHistory, mathProblem)
      : false;

    let text: string;
    if (isRepeated) {
      // SHORT form for repeated mixed-strategy
      const decompAck = decomp ? `${decomp.partA} + ${decomp.partB} works` : "Your split works";
      text = `${decompAck}, but gets harder to track. ${progressAck}${probe}`;
    } else if (decomp) {
      text = `${progressAck}${decomp.operand} can be ${decomp.partA} + ${decomp.partB} — that's true, but harder to track. Let's use tens and ones. ${probe}`;
    } else {
      text = `${progressAck}Your other split is valid, but harder to track. ${probe}`;
    }

    return {
      type: "STEP_PROBE_DIRECT",
      text,
      targetStepId: targetId,
      targetStepKind: targetKind,
      studentState: "mixed_strategy_active",
      explanation: `Mixed strategy detected: student has canonical progress (${stepAccumulation.satisfiedStepIds.join(", ")}) and continues non-canonical decomposition. Acknowledged both, redirected to next canonical step.`,
    };
  }

  // 2d-iii. METHOD ACKNOWLEDGMENT REPAIR: Student feels their math reasoning
  // was ignored ("did you hear me?", "that's not what I said").
  // Acknowledge the previously stated method explicitly, answer "why" briefly
  // if present, redirect to next step.
  if (studentState === "method_acknowledgment_repair") {
    // REPLACEMENT PAIR: "it's supposed to be 7+6" / "you mean 6+6"
    // If student provides a corrected combine pair, treat as progress and continue.
    const replacementPair = detectReplacementPair(studentResponse);
    if (replacementPair && isReplacementPairRelevant(replacementPair, mathProblem, conversationHistory)) {
      const result = replacementPair.left + replacementPair.right;
      // Find remaining parts after using this pair
      const allDecomps = conversationHistory
        ? detectMultiTurnDecompositionStrategy(studentResponse, mathProblem, conversationHistory)
        : null;
      let followUp: string;
      if (allDecomps && allDecomps.decomps.length >= 2) {
        const allParts = allDecomps.decomps.flatMap(d => [d.partA, d.partB]);
        const remaining = allParts.filter(p => p !== replacementPair.left && p !== replacementPair.right);
        if (remaining.length >= 2) {
          followUp = `Now what about ${remaining[0]} and ${remaining[1]}?`;
        } else if (remaining.length === 1) {
          followUp = `What is ${result} + ${remaining[0]}?`;
        } else {
          followUp = `What does everything add up to?`;
        }
      } else {
        followUp = `What does everything add up to?`;
      }

      return {
        type: "STEP_PROBE_DIRECT",
        text: `Right, ${replacementPair.left} + ${replacementPair.right} = ${result}. ${followUp}`,
        targetStepId: null,
        targetStepKind: null,
        studentState: "method_acknowledgment_repair",
        explanation: `Student corrected combine pair to ${replacementPair.left}+${replacementPair.right}=${result}. Treated as progress, continuing in student's strategy.`,
      };
    }

    const nextStep = getNextMissingStep(reasoningSteps, stepAccumulation);
    const probe = nextStep ? buildDirectProbe(nextStep, extractStepOperands(nextStep, mathProblem)) : `What is ${mathProblem.expression}?`;
    const targetId = nextStep?.id ?? null;
    const targetKind = nextStep?.kind ?? null;

    // Find the student's prior decomposition to echo
    const priorDecomp = conversationHistory
      ? findPriorStudentDecomposition(conversationHistory, mathProblem)
      : null;
    // Also check current response for a decomposition
    const currentDecomp = detectValidInefficientDecomposition(studentResponse, mathProblem);
    const decomp = currentDecomp || priorDecomp;

    // Check if they're asking "why" ("I still want to know why I can't...")
    const asksWhy = /\bwhy\s+(?:I\s+)?can'?t\b|\bwhy\s+(?:can'?t|couldn'?t|won'?t)\s+(?:I|we)\b/i.test(studentResponse);

    // Check if repeated (short form)
    const isRepeated = conversationHistory
      ? hasRepeatedResistance(conversationHistory, mathProblem)
      : false;

    let text: string;
    if (isRepeated && decomp) {
      // SHORT form
      text = `I heard your ${decomp.partA} + ${decomp.partB} idea. Let's use the easier split now: ${probe}`;
    } else if (decomp && asksWhy) {
      text = `Yes, I heard you — ${decomp.operand} can be ${decomp.partA} + ${decomp.partB}. Tens and ones is easier here. ${probe}`;
    } else if (decomp) {
      text = `Yes, I heard you — ${decomp.operand} can be ${decomp.partA} + ${decomp.partB}. Tens and ones is easier here. ${probe}`;
    } else if (/\bI\s+(?:didn'?t|never|did\s+not)\s+(?:say|said|tell|told)\b/i.test(studentResponse)) {
      // "I didn't say that" — student is correcting a misattribution.
      // Suppress the misconception, acknowledge the correction, continue.
      const satisfiedLabels: string[] = [];
      for (const s of reasoningSteps) {
        if (stepAccumulation.satisfiedStepIds.includes(s.id)) {
          const m = s.expectedStatements[0]?.match(/=\s*(\d+)/);
          if (m) satisfiedLabels.push(m[1]);
        }
      }
      const validWork = satisfiedLabels.length > 0
        ? ` You've got ${satisfiedLabels.join(" and ")} so far.`
        : "";
      text = `You're right, sorry about that.${validWork} ${probe}`;
    } else {
      text = `I hear you, and your idea makes sense. Let's try it this way — ${probe}`;
    }

    return {
      type: "STEP_PROBE_DIRECT",
      text,
      targetStepId: targetId,
      targetStepKind: targetKind,
      studentState: "method_acknowledgment_repair",
      explanation: `Method acknowledgment repair: student felt ignored. Echoed their prior method${decomp ? ` (${decomp.operand} = ${decomp.partA} + ${decomp.partB})` : ""}, suppressed false misconception, redirected.`,
    };
  }

  // 2d-av. AV / DELIVERY COMPLAINT: Student is complaining about audio/video
  // quality ("your mouth is messed up", "I can't hear you"). Briefly acknowledge
  // and restate the current question. Never wrap, never lecture.
  if (studentState === "av_delivery_complaint") {
    const nextStep = getNextMissingStep(reasoningSteps, stepAccumulation);
    const probe = nextStep ? buildDirectProbe(nextStep, extractStepOperands(nextStep, mathProblem)) : `What is ${mathProblem.expression}?`;
    const targetId = nextStep?.id ?? null;
    const targetKind = nextStep?.kind ?? null;

    return {
      type: "STEP_PROBE_DIRECT",
      text: `Sorry about that! Let me ask again: ${probe}`,
      targetStepId: targetId,
      targetStepKind: targetKind,
      studentState: "av_delivery_complaint",
      explanation: `AV/delivery complaint detected. Acknowledged and restated current question.`,
    };
  }

  // 2e. MATH-RELEVANT RESISTANCE: Student resists the coach's method but is
  // still mathematically engaged. Could be defense ("that's not what I said"),
  // questioning ("why can't I do 7+6?"), objection ("that has nothing to do
  // with the problem"), or method preference ("I was trying to split the 11").
  //
  // Response policy:
  // 1. Acknowledge the student's idea or concern
  // 2. If their idea includes valid math, say so briefly
  // 3. Explain in one sentence why tens+ones is easier here
  // 4. Redirect with exactly one concrete next-step question
  // 5. Never wrap, never shut down, never give generic praise-only
  if (studentState === "math_relevant_resistance") {
    const a = mathProblem.a;
    const b = mathProblem.b ?? 0;
    const aTens = Math.floor(a / 10) * 10;
    const aOnes = a % 10;
    const bTens = Math.floor(b / 10) * 10;
    const bOnes = b % 10;

    const nextStep = getNextMissingStep(reasoningSteps, stepAccumulation);
    const probe = nextStep ? buildDirectProbe(nextStep, extractStepOperands(nextStep, mathProblem)) : `What is ${mathProblem.expression}?`;
    const targetId = nextStep?.id ?? null;
    const targetKind = nextStep?.kind ?? null;

    // Check if the student mentioned a specific valid decomposition to validate
    const decomp = detectValidInefficientDecomposition(studentResponse, mathProblem);

    // SHORT-FORM CAP: When the student has repeated resistance/repair, keep
    // responses under ~110 chars. This prevents long explanations from consuming
    // remaining time late in a session.
    const isRepeatedResistance = conversationHistory
      ? hasRepeatedResistance(conversationHistory, mathProblem)
      : false;
    const hasProgress = stepAccumulation.satisfiedStepIds.length > 0;

    if (isRepeatedResistance || hasProgress) {
      let shortText: string;
      if (decomp) {
        shortText = `Yes, ${decomp.partA} + ${decomp.partB} works, but ${aTens} + ${aOnes} is easier here. ${probe}`;
      } else {
        shortText = `I hear you! Let's use tens and ones for this one. ${probe}`;
      }
      return {
        type: "STEP_PROBE_DIRECT",
        text: shortText,
        targetStepId: targetId,
        targetStepKind: targetKind,
        studentState: "math_relevant_resistance",
        explanation: `Repeated/progress resistance detected. Short-form acknowledgment and redirect.`,
      };
    }

    // Check if they're asking "why" (questioning) vs defending (pushback)
    const isQuestioning = /\bwhy\s+(?:can'?t|couldn'?t|wouldn'?t|don'?t|are|do)\b/i.test(studentResponse);
    const isObjection = /\b(?:nothing|anything)\s+to\s+do\s+with\b/i.test(studentResponse);

    // Check if they reference splitting a specific operand (for "I was trying to split the 11")
    const normalized = normalizeNumberWords(studentResponse.trim());
    const mentionsA = new RegExp(`\\b${a}\\b`).test(normalized);
    const mentionsB = new RegExp(`\\b${b}\\b`).test(normalized);
    const referencedOperand = mentionsB ? b : mentionsA ? a : null;

    let text: string;

    if (decomp) {
      // Student mentioned a specific valid decomposition: validate it
      text = `I hear you — ${decomp.operand} can be ${decomp.partA} + ${decomp.partB}. ${aTens} + ${aOnes} is easier here. ${probe}`;
    } else if (isObjection) {
      // "That has nothing to do with the problem" — explain the connection.
      // SHORT form when the student already has step progress (they've shown
      // they can do it, just need a nudge back).
      const hasProgress = stepAccumulation.satisfiedStepIds.length > 0;
      text = hasProgress
        ? `It's all part of solving ${mathProblem.expression}. ${probe}`
        : `We're solving ${mathProblem.expression} with tens and ones: ${a} is ${aTens} + ${aOnes} and ${b} is ${bTens} + ${bOnes}. ${probe}`;
    } else if (isQuestioning) {
      // "Why can't I..." / "Why wouldn't we..." — answer the why
      text = `Good question. Tens and ones is easier here. ${probe}`;
    } else if (referencedOperand !== null) {
      // "I was trying to split the 11" — acknowledge their intent, bridge to canonical
      const refTens = Math.floor(referencedOperand / 10) * 10;
      const refOnes = referencedOperand % 10;
      const otherOperand = referencedOperand === a ? b : a;
      text = `That makes sense. If you split ${referencedOperand}, it becomes ${refTens} and ${refOnes}. What is ${otherOperand} + ${refTens}?`;
    } else {
      // General resistance with math content — warm redirect
      text = `I hear you! Tens and ones is easier here: ${a} is ${aTens} + ${aOnes} and ${b} is ${bTens} + ${bOnes}. ${probe}`;
    }

    return {
      type: "STEP_PROBE_DIRECT",
      text,
      targetStepId: targetId,
      targetStepKind: targetKind,
      studentState: "math_relevant_resistance",
      explanation: `Math-relevant resistance detected. Acknowledged student's idea, explained why canonical is easier, redirected with probe.`,
    };
  }

  // 3. Find next missing step
  const missingStep = getNextMissingStep(reasoningSteps, stepAccumulation);
  if (!missingStep) {
    // All steps satisfied but answer not confirmed correct — ask for the final
    // answer rather than returning null (which would fall through to the LLM
    // and risk backward regression like "let's focus on the ones first").
    if (!stepAccumulation.answerCorrect) {
      const previousMsg = getLastCoachMessage(conversationHistory);
      const ti = deriveTurnIndex(conversationHistory);
      const allStepsText = pickVariant(
        ALL_STEPS_SATISFIED_OPENINGS.map(fn => fn(mathProblem.expression)),
        previousMsg, ti,
      );
      return {
        type: "STEP_PROBE_DIRECT",
        text: allStepsText,
        targetStepId: null,
        targetStepKind: null,
        studentState: "correct_incomplete",
        explanation: `All reasoning steps satisfied but answer not confirmed. Prompting for final answer.`,
      };
    }
    return null;
  }

  // 4. Extract operands for template generation
  const operands = extractStepOperands(missingStep, mathProblem);

  // 4b. ESCALATION CHECK: Before any classification-specific handling, check if
  // the student has repeatedly failed the same step. This must run before the
  // misconception early-return so it fires for BOTH misconception and generic
  // wrong answers. Without this, misconception-classified students never reach
  // buildMoveForState where escalation previously lived.
  if (conversationHistory && (studentState === "wrong" || studentState === "misconception")) {
    const failures = countConsecutiveStepFailures(conversationHistory, missingStep, mathProblem, studentResponse);
    if (failures >= STEP_FAILURE_ESCALATION_THRESHOLD) {
      const modelText = buildStepModelInstruction(missingStep, operands, reasoningSteps, stepAccumulation, mathProblem);
      return {
        type: "STEP_MODEL_INSTRUCTION",
        text: modelText,
        targetStepId: missingStep.id,
        targetStepKind: missingStep.kind,
        studentState,
        explanation: `Student failed step "${missingStep.label}" (${missingStep.id}) ${failures} times consecutively (state: ${studentState}). Escalated to modeled instruction.`,
      };
    }
  }

  // 4c. CONCEPT CONFUSION: Student is asking about a concept, not giving an answer.
  // Return a brief instructional explanation tied to the active step, then re-probe.
  // ESCALATION: if 2+ consecutive structure confusions with no math progress,
  // do NOT re-explain — offer a move-on choice or graceful wrap.
  if (studentState === "concept_confusion") {
    const confusionCategory = detectConceptConfusion(studentResponse, mathProblem);
    if (confusionCategory) {
      // Escalation check for repeated STRUCTURE confusion
      if (confusionCategory === "STRUCTURE") {
        const structureCount = countStructureConfusionTurns(conversationHistory, mathProblem);
        if (structureCount >= 2) {
          // 2+ prior structure confusion turns in history (current is the 3rd+).
          // Short move-on choice, no re-explanation.
          const probe = buildDirectProbe(missingStep, operands);
          return {
            type: "STEP_PROBE_DIRECT",
            text: `Let's just try it. ${probe}`,
            targetStepId: missingStep.id,
            targetStepKind: missingStep.kind,
            studentState: "concept_confusion",
            explanation: `Repeated structure confusion (${structureCount + 1} consecutive). Skipped re-explanation, offered direct probe.`,
          };
        }
      }

      const explanation = buildConceptExplanation(confusionCategory, missingStep, operands, mathProblem, conversationHistory, stepAccumulation, reasoningSteps);
      return {
        type: "STEP_CONCEPT_EXPLANATION",
        text: explanation,
        targetStepId: missingStep.id,
        targetStepKind: missingStep.kind,
        studentState: "concept_confusion",
        explanation: `Student showed concept confusion (${confusionCategory}). Gave brief explanation tied to step "${missingStep.label}" (${missingStep.id}), then re-probed.`,
      };
    }
  }

  // 5. For misconceptions, detect the specific category and use it
  if (studentState === "misconception") {
    const normalized = normalizeNumberWords(studentResponse.trim());
    const extractedAnswer = extractNumericAnswer(normalized);
    const category = detectMisconceptionCategory(
      studentResponse.trim(), extractedAnswer, mathProblem, stepAccumulation,
    ) || "GENERIC_WRONG";

    // For place-value confusion, pick the right step to redirect to
    let targetStep = missingStep;
    let targetOperands = operands;

    if (category === "ONES_ONLY_CONFUSION") {
      // Student did ones only → redirect to tens step (if it's missing)
      const tensStep = reasoningSteps.find(
        s => (s.kind === "tens_sum" || s.kind === "identify_tens") &&
             stepAccumulation.missingStepIds.includes(s.id),
      );
      if (tensStep) {
        targetStep = tensStep;
        targetOperands = extractStepOperands(tensStep, mathProblem);
      }
    } else if (category === "TENS_ONLY_CONFUSION") {
      // Student did tens only → redirect to ones step (if it's missing)
      const onesStep = reasoningSteps.find(
        s => (s.kind === "ones_sum" || s.kind === "identify_ones") &&
             stepAccumulation.missingStepIds.includes(s.id),
      );
      if (onesStep) {
        targetStep = onesStep;
        targetOperands = extractStepOperands(onesStep, mathProblem);
      }
    }

    const text = buildMisconceptionRedirect(category, targetStep, targetOperands, mathProblem, conversationHistory);

    return {
      type: "STEP_MISCONCEPTION_REDIRECT",
      text,
      targetStepId: targetStep.id,
      targetStepKind: targetStep.kind,
      studentState: "misconception",
      misconceptionCategory: category,
      explanation: `Student showed misconception: ${misconceptionExplanation(category)}. Step "${targetStep.label}" (${targetStep.id}) is the target. Used category-specific redirect.`,
    };
  }

  // 6. Build move for non-misconception states
  return buildMoveForState(
    studentState,
    missingStep,
    operands,
    reasoningSteps,
    stepAccumulation,
    mathProblem,
    studentResponse,
    conversationHistory,
  );
}

/**
 * Human-readable explanation for a misconception category (for logs/tests).
 */
function misconceptionExplanation(category: MisconceptionCategory): string {
  switch (category) {
    case "SUBTRACTION_ON_ADDITION": return "student used subtraction language on an addition problem";
    case "ADDITION_ON_SUBTRACTION": return "student used addition language on a subtraction problem";
    case "MULTIPLICATION_MISUSE": return "student used multiplication on an add/subtract problem";
    case "ONES_ONLY_CONFUSION": return "student only handled the ones, ignored tens";
    case "TENS_ONLY_CONFUSION": return "student only handled the tens, ignored ones";
    case "KNOWN_WRONG_ANSWER": return "answer matches a known common wrong answer";
    case "GENERIC_WRONG": return "wrong answer with no specific identifiable pattern";
  }
}

/**
 * Build the specific remediation move for non-misconception states.
 */
function buildMoveForState(
  studentState: StudentRemediationState,
  step: ReasoningStep,
  operands: StepOperands | null,
  reasoningSteps: ReasoningStep[],
  accumulation: ReasoningStepAccumulation,
  mathProblem: MathProblem,
  studentResponse: string,
  conversationHistory?: Array<{ role: string; message: string }>,
): RemediationMove {
  const COMBINE_KINDS: ReasoningStepKind[] = ["combine", "final_answer"];
  const isCombineStep = COMBINE_KINDS.includes(step.kind);

  switch (studentState) {
    case "hint_request": {
      const hint = buildStepHint(step, operands);
      return {
        type: "STEP_HINT",
        text: hint,
        targetStepId: step.id,
        targetStepKind: step.kind,
        studentState,
        explanation: `Student asked for a hint. Step "${step.label}" (${step.id}) is the next missing step. Gave step-specific hint.`,
      };
    }

    case "uncertain": {
      // Escalation: after 2+ consecutive uncertain turns, demonstrate the step
      const uncertainCount = countConsecutiveUncertainTurns(conversationHistory);
      if (uncertainCount >= 2) {
        const stepAnswer = step.expectedStatements[0];
        const previousMsg = getLastCoachMessage(conversationHistory);
        const ti = deriveTurnIndex(conversationHistory);
        const demoText = stepAnswer
          ? pickVariant(DEMONSTRATE_STEP_OPENINGS.map(fn => fn(stepAnswer)), previousMsg, ti)
          : pickVariant(DEMONSTRATE_STEP_OPENINGS_NO_ANSWER.map(fn => fn(step.label.toLowerCase())), previousMsg, ti);
        return {
          type: "STEP_DEMONSTRATE_STEP",
          text: demoText,
          targetStepId: step.id,
          targetStepKind: step.kind,
          studentState,
          explanation: `Student uncertain ${uncertainCount + 1} consecutive times. Demonstrated step "${step.label}" (${step.id}) and prompted for next.`,
        };
      }
      const simpler = buildSimplerProbe(step, operands, uncertainCount, conversationHistory);
      return {
        type: "STEP_PROBE_SIMPLER",
        text: simpler,
        targetStepId: step.id,
        targetStepKind: step.kind,
        studentState,
        explanation: `Student is uncertain. Step "${step.label}" (${step.id}) is the next missing step. Used simpler probe to lower friction.`,
      };
    }

    case "concept_confusion": {
      // This path shouldn't be reached (handled above in getDeterministicRemediationMove)
      // but included for exhaustiveness
      const probe = buildDirectProbe(step, operands);
      return {
        type: "STEP_CONCEPT_EXPLANATION",
        text: `Let me explain. ${probe}`,
        targetStepId: step.id,
        targetStepKind: step.kind,
        studentState,
        explanation: `Student showed concept confusion. Step "${step.label}" (${step.id}) is the next missing step. Gave fallback explanation.`,
      };
    }

    case "misconception": {
      // This path shouldn't be reached (handled above in getDeterministicRemediationMove)
      // but included for exhaustiveness
      const probe = buildDirectProbe(step, operands);
      return {
        type: "STEP_MISCONCEPTION_REDIRECT",
        text: `Not quite. ${probe}`,
        targetStepId: step.id,
        targetStepKind: step.kind,
        studentState,
        explanation: `Student showed misconception. Step "${step.label}" (${step.id}) is the next missing step. Redirected.`,
      };
    }

    case "wrong": {
      // ESCALATION: After repeated wrong answers on the same step, model the answer
      // instead of re-asking the same probe. This prevents infinite loops where the
      // coach keeps repeating "What is 10 + 10?" and the student keeps guessing wrong.
      // Note: This is a safety net — the primary escalation check runs earlier in
      // getDeterministicRemediationMove before misconception classification.
      if (conversationHistory) {
        const failures = countConsecutiveStepFailures(conversationHistory, step, mathProblem, studentResponse);
        if (failures >= STEP_FAILURE_ESCALATION_THRESHOLD) {
          const modelText = buildStepModelInstruction(step, operands, reasoningSteps, accumulation, mathProblem);
          return {
            type: "STEP_MODEL_INSTRUCTION",
            text: modelText,
            targetStepId: step.id,
            targetStepKind: step.kind,
            studentState,
            explanation: `Student failed step "${step.label}" (${step.id}) ${failures} times consecutively. Escalated to modeled instruction.`,
          };
        }
      }

      if (isCombineStep) {
        const combine = buildCombinePrompt(step, operands);
        // When the student gave a wrong numeric answer for the combine step,
        // acknowledge the error before re-prompting. Without this, the coach
        // repeats the identical combine prompt and the dedup or the student
        // perceives no progress.
        const normalized = normalizeNumberWords(studentResponse.trim());
        const wrongAnswer = extractNumericAnswer(normalized);
        const corrective = wrongAnswer !== null
          ? `Not quite — ${wrongAnswer} isn't right. ${combine}`
          : `Not quite. ${combine}`;
        return {
          type: "STEP_COMBINE_PROMPT",
          text: corrective,
          targetStepId: step.id,
          targetStepKind: step.kind,
          studentState,
          explanation: `Student gave wrong answer (${wrongAnswer}). All foundational steps satisfied. Step "${step.label}" (${step.id}) is the combine step. Corrected and re-prompted.`,
        };
      }
      const probe = buildDirectProbe(step, operands);
      return {
        type: "STEP_PROBE_DIRECT",
        text: probe,
        targetStepId: step.id,
        targetStepKind: step.kind,
        studentState,
        explanation: `Student gave wrong answer with no step evidence. Step "${step.label}" (${step.id}) is the next missing foundational step. Asked directly.`,
      };
    }

    case "partial": {
      if (isCombineStep) {
        const combine = buildCombinePrompt(step, operands);
        return {
          type: "STEP_COMBINE_PROMPT",
          text: `Good. ${combine}`,
          targetStepId: step.id,
          targetStepKind: step.kind,
          studentState,
          explanation: `Student satisfied some steps. Step "${step.label}" (${step.id}) is the combine step. Acknowledged progress and prompted to combine.`,
        };
      }
      const probe = buildDirectProbe(step, operands);
      return {
        type: "STEP_ACKNOWLEDGE_AND_PROBE",
        text: `Good. ${probe}`,
        targetStepId: step.id,
        targetStepKind: step.kind,
        studentState,
        explanation: `Student satisfied some steps. Step "${step.label}" (${step.id}) is the next missing step. Acknowledged and probed.`,
      };
    }

    case "correct_incomplete": {
      if (isCombineStep) {
        const combine = buildCombinePrompt(step, operands);
        return {
          type: "STEP_COMBINE_PROMPT",
          text: combine,
          targetStepId: step.id,
          targetStepKind: step.kind,
          studentState,
          explanation: `Correct answer but missing combine step explanation. Step "${step.label}" (${step.id}). Prompted to combine.`,
        };
      }
      const probe = buildDirectProbe(step, operands);
      return {
        type: "STEP_PROBE_DIRECT",
        text: probe,
        targetStepId: step.id,
        targetStepKind: step.kind,
        studentState,
        explanation: `Correct answer but missing step explanation. Step "${step.label}" (${step.id}) is the next missing step. Probed directly.`,
      };
    }

    case "alternate_setup": {
      // Handled in section 2b of getDeterministicRemediationMove.
      // Fallback: model the alternate setup with the smaller operand.
      const a = mathProblem.a;
      const b = mathProblem.b ?? 0;
      const splitTarget = Math.min(a, b);
      const keptWhole = splitTarget === a ? b : a;
      const splitTens = Math.floor(splitTarget / 10) * 10;
      const splitOnes = splitTarget % 10;
      return {
        type: "STEP_PROBE_DIRECT",
        text: `You can split ${splitTarget} into ${splitTens} and ${splitOnes}. What is ${keptWhole} + ${splitTens}?`,
        targetStepId: null,
        targetStepKind: null,
        studentState,
        explanation: `Alternate strategy setup fallback. Modeled split of ${splitTarget} and asked for first step.`,
      };
    }

    case "valid_inefficient": {
      // Handled in section 2c of getDeterministicRemediationMove.
      // Fallback: acknowledge and redirect to canonical step.
      const probe = buildDirectProbe(step, operands);
      return {
        type: "STEP_PROBE_DIRECT",
        text: `That's a valid way to think about it! For this problem, let's use tens and ones. ${probe}`,
        targetStepId: step.id,
        targetStepKind: step.kind,
        studentState,
        explanation: `Valid inefficient decomposition fallback. Acknowledged and redirected to step "${step.label}".`,
      };
    }

    case "noncanonical_active": {
      // Handled in section 2d. Fallback: acknowledge and redirect.
      const probe = buildDirectProbe(step, operands);
      return {
        type: "STEP_PROBE_DIRECT",
        text: `That's creative math! For this problem, tens and ones is easier. ${probe}`,
        targetStepId: step.id,
        targetStepKind: step.kind,
        studentState,
        explanation: `Noncanonical active strategy fallback. Acknowledged and redirected to step "${step.label}".`,
      };
    }

    case "math_relevant_resistance": {
      // Handled in section 2e. Fallback: acknowledge and redirect.
      const probe = buildDirectProbe(step, operands);
      return {
        type: "STEP_PROBE_DIRECT",
        text: `I hear you! Let's try tens and ones for this one. ${probe}`,
        targetStepId: step.id,
        targetStepKind: step.kind,
        studentState,
        explanation: `Math-relevant resistance fallback. Acknowledged and redirected to step "${step.label}".`,
      };
    }

    case "computation_mistake": {
      // Handled in section 1e. Fallback: generic correction and probe.
      const probe = buildDirectProbe(step, operands);
      return {
        type: "STEP_COMPUTATION_CORRECTION",
        text: `Close — let me help. ${probe}`,
        targetStepId: step.id,
        targetStepKind: step.kind,
        studentState,
        explanation: `Computation mistake fallback. Redirected to step "${step.label}".`,
      };
    }

    case "av_delivery_complaint": {
      // Handled in section 2d-av. Fallback: acknowledge and restate.
      const probe = buildDirectProbe(step, operands);
      return {
        type: "STEP_PROBE_DIRECT",
        text: `Sorry about that! Let me ask again: ${probe}`,
        targetStepId: step.id,
        targetStepKind: step.kind,
        studentState,
        explanation: `AV/delivery complaint fallback. Acknowledged and restated question.`,
      };
    }

    case "mixed_strategy_active": {
      // Handled in section 2d-ii. Fallback: acknowledge and redirect.
      const probe = buildDirectProbe(step, operands);
      return {
        type: "STEP_PROBE_DIRECT",
        text: `Your split works, but tens and ones is easier here. ${probe}`,
        targetStepId: step.id,
        targetStepKind: step.kind,
        studentState,
        explanation: `Mixed strategy active fallback. Acknowledged and redirected to step "${step.label}".`,
      };
    }

    case "method_acknowledgment_repair": {
      // Handled in section 2d-iii. Fallback: acknowledge and redirect.
      const probe = buildDirectProbe(step, operands);
      return {
        type: "STEP_PROBE_DIRECT",
        text: `I hear you, and your idea makes sense. ${probe}`,
        targetStepId: step.id,
        targetStepKind: step.kind,
        studentState,
        explanation: `Method acknowledgment repair fallback. Acknowledged and redirected to step "${step.label}".`,
      };
    }
  }
}

// ============================================================================
// Instructional recap for wraps (misconception or persistent step failure)
// ============================================================================

/**
 * Operation-correction prefix for misconception categories.
 * Returns a short, age-appropriate sentence correcting the operation confusion,
 * or null if the misconception category doesn't need an operation correction.
 */
function operationCorrectionPrefix(category: MisconceptionCategory, mathProblem: MathProblem): string | null {
  switch (category) {
    case "SUBTRACTION_ON_ADDITION":
      return "This is an addition problem, not subtraction.";
    case "ADDITION_ON_SUBTRACTION":
      return "This is a subtraction problem, not addition.";
    case "MULTIPLICATION_MISUSE": {
      const correctOp = mathProblem.skill === "two_digit_subtraction" ? "subtraction" : "addition";
      return `This is an ${correctOp} problem, not multiplication.`;
    }
    case "ONES_ONLY_CONFUSION":
      return "Remember to add both the ones and the tens.";
    case "TENS_ONLY_CONFUSION":
      return "Remember to add both the tens and the ones.";
    default:
      return null;
  }
}

/**
 * Build a short instructional recap from reasoning steps.
 *
 * Walks through each reasoning step's expected statement in order,
 * producing a concrete solution model like:
 *   "1 + 4 = 5, 10 + 10 = 20, 20 + 5 = 25."
 *
 * Used at wrap time when a misconception was detected during the conversation,
 * so the student leaves with the correct solution modeled, not just generic reassurance.
 */
export function buildInstructionalRecap(
  reasoningSteps: ReasoningStep[],
  mathProblem: MathProblem,
  misconceptionCategory: MisconceptionCategory | null,
): string {
  // Build the step walkthrough from expectedStatements
  const stepStatements = reasoningSteps
    .map(s => s.expectedStatements[0])
    .filter((s): s is string => !!s);

  if (stepStatements.length === 0) {
    return "You're getting closer!";
  }

  // Operation correction prefix (if applicable)
  const correction = misconceptionCategory
    ? operationCorrectionPrefix(misconceptionCategory, mathProblem)
    : null;

  // Build the model: "1 + 4 = 5, 10 + 10 = 20, and 20 + 5 = 25."
  let model: string;
  if (stepStatements.length === 1) {
    model = `Here's how it works: ${stepStatements[0]}.`;
  } else {
    const allButLast = stepStatements.slice(0, -1).join(", ");
    const last = stepStatements[stepStatements.length - 1];
    model = `Here's how it works: ${allButLast}, and ${last}.`;
  }

  const parts: string[] = [];
  if (correction) parts.push(correction);
  parts.push(model);
  parts.push("You're getting closer!");

  return parts.join(" ");
}

/**
 * Scan conversation history for misconception evidence.
 *
 * Runs detectMisconceptionCategory on each prior student response to find
 * if any turn showed a misconception. Returns the most recent misconception
 * category found, or null.
 */
export function detectConversationMisconceptions(
  conversationHistory: Array<{ role: string; message: string }>,
  currentResponse: string,
  mathProblem: MathProblem,
  stepAccumulation: ReasoningStepAccumulation,
  reasoningSteps?: ReasoningStep[],
): MisconceptionCategory | null {
  // Build a map of step expected answers → their probe fingerprints.
  // A student answer that matches a step's expected value is only filtered
  // when the preceding coach question was probing that specific step.
  // E.g., "5" after "What is 1 + 4?" → filtered (correct sub-step).
  //        "five" after "What is 11 + 14?" → NOT filtered (ones-only misconception).
  const stepProbeMap = new Map<number, string[]>(); // expected answer → probe fingerprints
  if (reasoningSteps) {
    for (const step of reasoningSteps) {
      const stmt = step.expectedStatements[0];
      if (!stmt) continue;
      const answerMatch = stmt.match(/=\s*(\d+)/);
      if (!answerMatch) continue;
      const expected = parseInt(answerMatch[1], 10);
      const fps: string[] = [];
      if (step.probe) fps.push(step.probe.toLowerCase());
      const ops = extractStepOperands(step, mathProblem);
      if (ops) {
        fps.push(`${ops.left} and ${ops.right}`);
        fps.push(ops.expression.toLowerCase());
      }
      stepProbeMap.set(expected, fps);
    }
  }

  function isCorrectSubStepResponse(extracted: number, precedingCoachMsg: string, studentMsg: string): boolean {
    if (!reasoningSteps) return false;
    // Find the step whose expected answer matches
    for (const step of reasoningSteps) {
      const stmt = step.expectedStatements[0];
      if (!stmt) continue;
      const answerMatch = stmt.match(/=\s*(\d+)/);
      if (!answerMatch || parseInt(answerMatch[1], 10) !== extracted) continue;
      const ops = extractStepOperands(step, mathProblem);
      if (!ops) continue;

      // Case 1: Preceding coach probed this step
      const fps = stepProbeMap.get(extracted);
      if (fps && fps.length > 0) {
        const coachLower = precedingCoachMsg.toLowerCase();
        if (fps.some(fp => coachLower.includes(fp))) return true;
      }

      // Case 2: Student's own response contains step operands (showing work).
      // E.g., "1 plus 4 is 5" contains both "1" and "4" → sub-step work, not misconception.
      const studentLower = studentMsg.toLowerCase();
      const hasLeft = studentLower.includes(ops.left);
      const hasRight = studentLower.includes(ops.right);
      if (hasLeft && hasRight) return true;
    }
    return false;
  }

  // Check current response first
  const currentNormalized = normalizeNumberWords(currentResponse.trim());
  const currentExtracted = extractNumericAnswer(currentNormalized);
  if (currentExtracted !== null && currentExtracted !== mathProblem.correctAnswer) {
    // Find the preceding coach message for context
    const lastCoach = [...conversationHistory].reverse().find(h => h.role === "coach");
    if (!isCorrectSubStepResponse(currentExtracted, lastCoach?.message || "", currentResponse)) {
      const currentCategory = detectMisconceptionCategory(
        currentResponse.trim(), currentExtracted, mathProblem, stepAccumulation,
      );
      if (currentCategory) return currentCategory;
    }
  }

  // Scan prior student turns (most recent first)
  for (let i = conversationHistory.length - 1; i >= 0; i--) {
    const turn = conversationHistory[i];
    if (turn.role !== "student") continue;

    const normalized = normalizeNumberWords(turn.message.trim());
    const extracted = extractNumericAnswer(normalized);
    if (extracted === null || extracted === mathProblem.correctAnswer) continue;

    // Find the coach message that preceded this student turn
    let precedingCoach = "";
    for (let j = i - 1; j >= 0; j--) {
      if (conversationHistory[j].role === "coach") {
        precedingCoach = conversationHistory[j].message;
        break;
      }
    }

    if (isCorrectSubStepResponse(extracted, precedingCoach, turn.message)) continue;

    const category = detectMisconceptionCategory(
      turn.message.trim(), extracted, mathProblem, stepAccumulation,
    );
    if (category) return category;
  }

  return null;
}

/**
 * Detect the step with the most persistent failures in the conversation.
 *
 * Returns the step (and failure count) where the student gave the most
 * consecutive wrong answers, or null if no step has >= threshold failures.
 * Used at wrap time to produce a step-specific recap even when no named
 * misconception was detected.
 */
export function detectPersistentStepFailure(
  reasoningSteps: ReasoningStep[],
  stepAccumulation: ReasoningStepAccumulation,
  conversationHistory: Array<{ role: string; message: string }>,
  mathProblem: MathProblem,
): { step: ReasoningStep; failures: number } | null {
  const missingSet = new Set(stepAccumulation.missingStepIds);
  const missingSteps = reasoningSteps.filter(s => missingSet.has(s.id));

  let worst: { step: ReasoningStep; failures: number } | null = null;

  for (const step of missingSteps) {
    const failures = countConsecutiveStepFailures(conversationHistory, step, mathProblem);
    if (failures >= STEP_FAILURE_ESCALATION_THRESHOLD && (!worst || failures > worst.failures)) {
      worst = { step, failures };
    }
  }

  return worst;
}

// ============================================================================
// Integration helper: check if deterministic remediation applies
// ============================================================================

/**
 * Check whether deterministic remediation should be used for this turn.
 * Returns true when:
 * - The prompt has reasoning steps
 * - Step accumulation data is available
 */
export function shouldUseDeterministicRemediation(
  reasoningSteps: ReasoningStep[] | undefined,
  stepAccumulation: ReasoningStepAccumulation | null,
): boolean {
  if (!reasoningSteps?.length) return false;
  if (!stepAccumulation) return false;
  return true;
}

// ============================================================================
// Conversation strategy escalation — math integration
// ============================================================================

/**
 * Build a demonstrate-step response: model the current step, then ask the next.
 *
 * Example: "Let's do the ones together. 1 + 4 = 5. Now what do we add next?"
 */
export function buildDemonstrateStepText(
  currentStep: ReasoningStep,
  reasoningSteps: ReasoningStep[],
  accumulation: ReasoningStepAccumulation,
  mathProblem: MathProblem,
): string {
  const kindLabel = getKindLabel(currentStep.kind);
  const stepAnswer = currentStep.expectedStatements[0];

  const COMBINE_KINDS: ReasoningStepKind[] = ["combine", "final_answer"];
  const missingSet = new Set(accumulation.missingStepIds);
  missingSet.delete(currentStep.id);
  const remaining = reasoningSteps.filter(s => missingSet.has(s.id));

  const intro = stepAnswer
    ? `Let's do the ${kindLabel} together. ${stepAnswer}.`
    : `Let me show you the ${kindLabel} step.`;

  if (remaining.length === 0) {
    return `${intro} So what is ${mathProblem.expression}?`;
  }

  const foundational = remaining.filter(s => !COMBINE_KINDS.includes(s.kind));
  const nextStep = foundational[0] || remaining[0];
  const nextOperands = extractStepOperands(nextStep, mathProblem);
  const nextProbe = buildDirectProbe(nextStep, nextOperands);

  return `${intro} Now, ${nextProbe.charAt(0).toLowerCase()}${nextProbe.slice(1)}`;
}

/**
 * Build a guided-completion response: walk through all remaining steps supportively.
 *
 * Example: "Here's how it works. 1 + 4 = 5, 10 + 10 = 20, and 20 + 5 = 25.
 *           So the answer is 25."
 */
export function buildGuidedCompletionText(
  reasoningSteps: ReasoningStep[],
  accumulation: ReasoningStepAccumulation,
  mathProblem: MathProblem,
): string {
  // Gather remaining (unsatisfied) steps
  const missingSet = new Set(accumulation.missingStepIds);
  const missingSteps = reasoningSteps.filter(s => missingSet.has(s.id));

  // If nothing missing (shouldn't happen), fall back to full recap
  const stepsToModel = missingSteps.length > 0 ? missingSteps : reasoningSteps;

  const statements = stepsToModel
    .map(s => s.expectedStatements[0])
    .filter((s): s is string => !!s);

  if (statements.length === 0) {
    return `The answer is ${mathProblem.correctAnswer}. You're getting closer!`;
  }

  let model: string;
  if (statements.length === 1) {
    model = statements[0];
  } else {
    const allButLast = statements.slice(0, -1).join(", ");
    const last = statements[statements.length - 1];
    model = `${allButLast}, and ${last}`;
  }

  return `Here's how it works. ${model}. So the answer is ${mathProblem.correctAnswer}.`;
}

/**
 * Context for applying strategy escalation to a math remediation move.
 */
export interface MathEscalationContext {
  reasoningSteps: ReasoningStep[];
  stepAccumulation: ReasoningStepAccumulation;
  mathProblem: MathProblem;
  conversationHistory: Array<{ role: string; message: string }>;
  timeRemainingSec: number | null;
  attemptCount: number;
  maxAttempts: number;
}

/**
 * Build the StrategyInput for the conversation strategy controller
 * from the math pipeline's available context.
 */
function buildStrategyInputFromMathContext(
  move: RemediationMove,
  ctx: MathEscalationContext,
): StrategyInput {
  const history = ctx.conversationHistory;
  // Count prior uncertain turns from history
  let uncertainStreak = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role !== "student") continue;
    if (UNCERTAIN_TURN_PATTERNS.some(p => p.test(history[i].message))) {
      uncertainStreak++;
    } else {
      break;
    }
  }

  // Count how many consecutive turns targeted the same step
  let repeatedTargetCount = 0;
  if (move.targetStepId) {
    // Look at prior moves — we approximate by counting consecutive coach turns
    // without student progress. The real signal is the no-progress streak.
    repeatedTargetCount = uncertainStreak; // approximate
  }

  // Extract prior student state labels from history (best-effort)
  const priorStates: string[] = [];
  for (const entry of history) {
    if (entry.role !== "student") continue;
    if (UNCERTAIN_TURN_PATTERNS.some(p => p.test(entry.message))) {
      priorStates.push("uncertain");
    } else if (/\bi\s+(?:give\s+up|quit|don'?t\s+(?:care|want))\b/i.test(entry.message)) {
      priorStates.push("frustrated");
    } else {
      priorStates.push("partial");
    }
  }

  // No-progress: satisfied count didn't change
  const satisfiedBefore = ctx.stepAccumulation.satisfiedStepIds.length;
  // Determine progress from recent history
  const noProgressStreak = uncertainStreak; // uncertain turns ≈ no-progress turns

  return {
    mode: "math",
    currentState: move.studentState,
    priorStudentStates: priorStates,
    priorCoachMoves: [],
    satisfiedProgressBefore: satisfiedBefore,
    satisfiedProgressAfter: satisfiedBefore, // same turn, no new progress yet counted
    noProgressStreak,
    uncertainStreak,
    repeatedTargetCount,
    timeRemainingSec: ctx.timeRemainingSec,
    attemptCount: ctx.attemptCount,
    maxAttempts: ctx.maxAttempts,
    latestMoveType: move.type,
    latestWrapDecision: null,
  };
}

/**
 * Apply conversation strategy escalation to a local remediation move.
 *
 * If the strategy controller decides to escalate, this function generates
 * the appropriate upgraded text using the step/problem context.
 *
 * Returns the original move unchanged if no escalation is needed.
 * Returns an upgraded move with new type/text if escalation applies.
 */
export function applyMathStrategyEscalation(
  localMove: RemediationMove,
  ctx: MathEscalationContext,
): { move: RemediationMove; decision: ConversationStrategyDecision } {
  // Don't escalate wraps — they're already terminal
  if (localMove.type === "WRAP_SUCCESS" || localMove.type === "WRAP_NEEDS_SUPPORT") {
    return {
      move: localMove,
      decision: { strategy: "wrap_support", reason: "already_wrapping", escalated: false },
    };
  }

  const strategyInput = buildStrategyInputFromMathContext(localMove, ctx);
  const decision = determineConversationStrategy(strategyInput);

  // Check if we need to upgrade
  const upgradedMoveType = shouldUpgradeMove(decision, localMove.type, "math");
  if (!upgradedMoveType) {
    return { move: localMove, decision };
  }

  // Find the target step for text generation
  const targetStep = ctx.reasoningSteps.find(s => s.id === localMove.targetStepId);
  if (!targetStep) {
    return { move: localMove, decision };
  }

  // Generate upgraded text based on the escalated strategy
  switch (decision.strategy) {
    case "probe_simpler": {
      const operands = extractStepOperands(targetStep, ctx.mathProblem);
      const text = buildSimplerProbe(targetStep, operands, 0, ctx.conversationHistory);
      return {
        move: {
          ...localMove,
          type: "STEP_PROBE_SIMPLER",
          text,
          explanation: `${localMove.explanation} [Strategy escalation: ${decision.reason}]`,
        },
        decision,
      };
    }

    case "hint": {
      const operands = extractStepOperands(targetStep, ctx.mathProblem);
      const text = buildStepHint(targetStep, operands);
      return {
        move: {
          ...localMove,
          type: "STEP_HINT",
          text,
          explanation: `${localMove.explanation} [Strategy escalation: ${decision.reason}]`,
        },
        decision,
      };
    }

    case "demonstrate_step": {
      const text = buildDemonstrateStepText(
        targetStep, ctx.reasoningSteps, ctx.stepAccumulation, ctx.mathProblem,
      );
      return {
        move: {
          ...localMove,
          type: "STEP_DEMONSTRATE_STEP",
          text,
          explanation: `${localMove.explanation} [Strategy escalation: ${decision.reason}]`,
        },
        decision,
      };
    }

    case "guided_completion": {
      const text = buildGuidedCompletionText(
        ctx.reasoningSteps, ctx.stepAccumulation, ctx.mathProblem,
      );
      return {
        move: {
          ...localMove,
          type: "STEP_MODEL_INSTRUCTION",
          text,
          explanation: `${localMove.explanation} [Strategy escalation: ${decision.reason} → guided_completion]`,
        },
        decision,
      };
    }

    case "wrap_support": {
      const text = buildGuidedCompletionText(
        ctx.reasoningSteps, ctx.stepAccumulation, ctx.mathProblem,
      );
      return {
        move: {
          ...localMove,
          type: "WRAP_NEEDS_SUPPORT",
          text,
          explanation: `${localMove.explanation} [Strategy escalation: ${decision.reason} → wrap_support]`,
        },
        decision,
      };
    }

    default:
      return { move: localMove, decision };
  }
}
