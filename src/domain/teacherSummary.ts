/**
 * Deterministic teacher-facing summary builder.
 *
 * Builds structured TeacherSummary objects from validator output,
 * then renders them using deterministic templates. No LLM calls.
 *
 * The summary never claims facts the validator rejected and
 * explicitly states what evidence is missing.
 */

import type { ValidationResult, EvidenceChecklistItem, OverallStatus } from "./deterministicValidator";
import type { RequiredEvidence, ReasoningStep } from "./prompt";
import type { MathProblem } from "./mathProblem";
import type { MathValidationResult, MathBoundingDecision, ReasoningStepAccumulation } from "./mathAnswerValidator";
import { normalizeNumberWords } from "./mathAnswerValidator";

// ============================================================================
// Helpers
// ============================================================================

const DIGIT_TO_WORD: Record<number, string> = {
  0: "zero", 1: "one", 2: "two", 3: "three", 4: "four",
  5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine",
  10: "ten", 11: "eleven", 12: "twelve", 13: "thirteen", 14: "fourteen",
  15: "fifteen", 16: "sixteen", 17: "seventeen", 18: "eighteen", 19: "nineteen",
  20: "twenty",
};

function numberToWord(n: number): string {
  return DIGIT_TO_WORD[n] ?? String(n);
}

// ============================================================================
// Types
// ============================================================================

export type PerformanceLevel = "Strong" | "Developing" | "Needs Support" | "Not Enough Evidence";

export type EvidenceItem = {
  kind: "correct" | "incorrect" | "missing" | "note";
  label: string;
  entity?: string;
  attribute?: string;
  detail?: string;
};

export type TeacherSummary = {
  overallLevel: PerformanceLevel;
  masteryMet: boolean;
  correctEvidence: EvidenceItem[];
  incorrectEvidence: EvidenceItem[];
  missingEvidence: EvidenceItem[];
  notes: EvidenceItem[];
  rubricTarget?: string;
  cleanedStudentResponse?: string;
  confidence: "high" | "medium" | "low";
  renderedSummary: string;
};

// ============================================================================
// Performance level mapping
// ============================================================================

function mapOverallStatus(status: OverallStatus): PerformanceLevel {
  switch (status) {
    case "strong": return "Strong";
    case "developing": return "Developing";
    case "needs_support": return "Needs Support";
  }
}

// ============================================================================
// Evidence extraction from validator output
// ============================================================================

function buildCorrectEvidence(
  validation: ValidationResult,
  requiredEvidence: RequiredEvidence,
  referenceFacts: Record<string, string[]>,
): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  const incorrectEntities = new Set(validation.incorrectPairs.map(p => p.entity));

  for (const pair of validation.extractedPairs) {
    // Only include pairs that are NOT in the incorrect list
    if (incorrectEntities.has(pair.entity)) continue;
    // Verify the attribute is actually accepted in referenceFacts
    const acceptable = referenceFacts[pair.entity];
    if (!acceptable) continue;
    const isAccepted = acceptable.some(
      a => a.toLowerCase() === pair.attribute.toLowerCase()
    );
    if (!isAccepted) continue;

    items.push({
      kind: "correct",
      label: `${pair.entity} ${requiredEvidence.attributeLabel}: ${pair.attribute}`,
      entity: pair.entity,
      attribute: pair.attribute,
    });
  }

  return items;
}

function buildIncorrectEvidence(
  validation: ValidationResult,
  requiredEvidence: RequiredEvidence,
): EvidenceItem[] {
  return validation.incorrectPairs.map(pair => ({
    kind: "incorrect" as const,
    label: `${pair.entity} ${requiredEvidence.attributeLabel}: claimed "${pair.claimed}"`,
    entity: pair.entity,
    attribute: pair.claimed,
    detail: `Acceptable: ${pair.acceptable.join(", ")}`,
  }));
}

function buildMissingEvidence(
  checklist: EvidenceChecklistItem[],
): EvidenceItem[] {
  return checklist
    .filter(item => !item.satisfied)
    .map(item => ({
      kind: "missing" as const,
      label: item.label,
    }));
}

// ============================================================================
// Confidence calculation
// ============================================================================

function calculateConfidence(
  validation: ValidationResult,
  checklist: EvidenceChecklistItem[],
): "high" | "medium" | "low" {
  const totalItems = checklist.length;
  if (totalItems === 0) return "low";

  const satisfiedCount = checklist.filter(i => i.satisfied).length;
  const hasEntities = validation.matchedEntities.length > 0;

  // No entities at all — we can't reliably assess
  if (!hasEntities && satisfiedCount === 0) return "low";

  // Some evidence but with factual errors — moderate confidence
  if (validation.hasFactualErrors) return "medium";

  // Strong evidence or clear gap — high confidence
  if (satisfiedCount === totalItems || validation.isOffTopic) return "high";

  return satisfiedCount > 0 ? "medium" : "low";
}

// ============================================================================
// Rendering templates
// ============================================================================

function formatEvidenceList(items: EvidenceItem[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0].label;
  if (items.length === 2) return `${items[0].label} and ${items[1].label}`;
  return items.slice(0, -1).map(i => i.label).join(", ") + ", and " + items[items.length - 1].label;
}

function renderStrong(summary: TeacherSummary): string {
  const correctList = formatEvidenceList(summary.correctEvidence);
  if (correctList) {
    return `The student met the goal. They correctly identified ${correctList}.`;
  }
  return "The student met the goal.";
}

function renderDeveloping(summary: TeacherSummary): string {
  const correctList = formatEvidenceList(summary.correctEvidence);
  const missingList = formatEvidenceList(summary.missingEvidence);

  if (correctList && missingList) {
    return `The student showed partial understanding. They correctly identified ${correctList}, but still needed ${missingList}.`;
  }
  if (correctList) {
    return `The student showed partial understanding. They correctly identified ${correctList}.`;
  }
  if (missingList) {
    return `The student showed partial understanding, but still needed ${missingList}.`;
  }
  return "The student showed partial understanding.";
}

function renderNeedsSupport(summary: TeacherSummary): string {
  const incorrectList = formatEvidenceList(summary.incorrectEvidence);
  const missingList = formatEvidenceList(summary.missingEvidence);

  if (incorrectList) {
    return `The student attempted the question but did not yet provide accurate evidence. They gave incorrect descriptions for ${incorrectList}.`;
  }
  if (missingList) {
    return `The student attempted the question but did not yet provide the needed evidence. Missing: ${missingList}.`;
  }
  return "The student attempted the question but did not yet provide accurate evidence.";
}

function renderNotEnoughEvidence(): string {
  return "The student did not provide enough usable verbal evidence to evaluate mastery on this question.";
}

function renderSummary(summary: TeacherSummary): string {
  switch (summary.overallLevel) {
    case "Strong": return renderStrong(summary);
    case "Developing": return renderDeveloping(summary);
    case "Needs Support": return renderNeedsSupport(summary);
    case "Not Enough Evidence": return renderNotEnoughEvidence();
  }
}

// ============================================================================
// Main builder
// ============================================================================

export interface BuildTeacherSummaryInput {
  validation: ValidationResult;
  checklist: EvidenceChecklistItem[];
  overallStatus: OverallStatus;
  requiredEvidence: RequiredEvidence;
  referenceFacts: Record<string, string[]>;
  rubricTarget?: string;
  cleanedStudentResponse?: string;
}

/**
 * Build a structured TeacherSummary from deterministic validator output.
 *
 * The summary:
 * - Never claims facts the validator rejected
 * - Explicitly lists what evidence is missing
 * - Uses "Not Enough Evidence" when there's no usable content
 * - Is built entirely from validator data, not freeform narration
 */
export function buildTeacherSummary(input: BuildTeacherSummaryInput): TeacherSummary {
  const {
    validation,
    checklist,
    overallStatus,
    requiredEvidence,
    referenceFacts,
    rubricTarget,
    cleanedStudentResponse,
  } = input;

  const correctEvidence = buildCorrectEvidence(validation, requiredEvidence, referenceFacts);
  const incorrectEvidence = buildIncorrectEvidence(validation, requiredEvidence);
  const missingEvidence = buildMissingEvidence(checklist);

  // Notes: record if off-topic or if there were bounding adjustments
  const notes: EvidenceItem[] = [];
  if (validation.isOffTopic) {
    notes.push({
      kind: "note",
      label: "Response was off-topic — no relevant entities or attributes detected.",
    });
  }

  // Determine performance level
  // If no entities matched and no evidence at all, use "Not Enough Evidence"
  const hasAnyEvidence = correctEvidence.length > 0
    || incorrectEvidence.length > 0
    || validation.matchedEntities.length > 0;

  let overallLevel: PerformanceLevel;
  if (!hasAnyEvidence && validation.isOffTopic) {
    overallLevel = "Not Enough Evidence";
  } else {
    overallLevel = mapOverallStatus(overallStatus);
  }

  const confidence = calculateConfidence(validation, checklist);
  const masteryMet = overallLevel === "Strong";

  // Build the summary object (renderedSummary filled after)
  const summary: TeacherSummary = {
    overallLevel,
    masteryMet,
    correctEvidence,
    incorrectEvidence,
    missingEvidence,
    notes,
    rubricTarget,
    cleanedStudentResponse,
    confidence,
    renderedSummary: "", // placeholder
  };

  // Render the template-based summary
  summary.renderedSummary = renderSummary(summary);

  return summary;
}

// ============================================================================
// Math-specific teacher summary
// ============================================================================

export interface BuildMathTeacherSummaryInput {
  mathValidation: MathValidationResult;
  mathBounding: MathBoundingDecision;
  mathProblem: MathProblem;
  cleanedStudentResponse: string;
  /** Strategies accumulated across all conversation turns (not just the current turn). */
  combinedStrategies?: string[];
  /** Structured reasoning steps from the rubric. When present, used for concrete evidence language. */
  reasoningSteps?: ReasoningStep[];
  /** Full student transcript (all turns concatenated) for matching against reasoning steps. */
  fullTranscript?: string;
  /** Pre-computed reasoning step accumulation from conversation-level analysis. */
  stepAccumulation?: ReasoningStepAccumulation;
}

function mapMathStatus(status: string): PerformanceLevel {
  switch (status) {
    case "strong": return "Strong";
    case "developing": return "Developing";
    case "needs_support": return "Needs Support";
    default: return "Not Enough Evidence";
  }
}

/**
 * Build a teacher-facing summary for a deterministic math problem.
 * Uses math validation results instead of entity/attribute science validation.
 */
export function buildMathTeacherSummary(input: BuildMathTeacherSummaryInput): TeacherSummary {
  const { mathValidation, mathBounding, mathProblem, cleanedStudentResponse, combinedStrategies, reasoningSteps, fullTranscript, stepAccumulation } = input;

  // Use combined (conversation-level) strategies when available, otherwise fall back to current turn
  const effectiveStrategies = combinedStrategies ?? mathValidation.demonstratedStrategies;

  const overallLevel = mapMathStatus(mathBounding.boundedStatus);
  const masteryMet = mathBounding.boundedStatus === "strong";

  const correctEvidence: EvidenceItem[] = [];
  const incorrectEvidence: EvidenceItem[] = [];
  const missingEvidence: EvidenceItem[] = [];
  const notes: EvidenceItem[] = [];

  // Correct answer evidence
  if (mathValidation.status === "correct") {
    correctEvidence.push({
      kind: "correct",
      label: `Correct answer: ${mathProblem.expression} = ${mathValidation.correctAnswer}`,
    });
  } else if (mathValidation.extractedAnswer !== null) {
    incorrectEvidence.push({
      kind: "incorrect",
      label: `Answer given: ${mathValidation.extractedAnswer}, expected: ${mathValidation.correctAnswer}`,
    });
    if (mathValidation.matchedMisconception) {
      incorrectEvidence.push({
        kind: "incorrect",
        label: `Likely misconception: ${mathValidation.matchedMisconception}`,
      });
    }
  } else {
    missingEvidence.push({
      kind: "missing",
      label: "No numeric answer provided",
    });
  }

  // Strategy evidence
  for (const tag of effectiveStrategies) {
    correctEvidence.push({
      kind: "correct",
      label: `Strategy demonstrated: ${tag}`,
    });
  }

  // Missing strategies
  const demonstrated = new Set(effectiveStrategies.map(s => s.toLowerCase()));
  for (const tag of mathProblem.expectedStrategyTags) {
    if (!demonstrated.has(tag.toLowerCase())) {
      missingEvidence.push({
        kind: "missing",
        label: `Strategy not demonstrated: ${tag}`,
      });
    }
  }

  // Rendered summary — prefer accumulated-step-based summary, then reasoning-step, then strategy-based
  const renderedSummary = stepAccumulation && reasoningSteps?.length
    ? buildAccumulatedStepSummary(reasoningSteps, stepAccumulation, mathProblem, mathValidation, fullTranscript)
    : reasoningSteps?.length && fullTranscript
      ? buildReasoningStepSummary(reasoningSteps, fullTranscript, mathProblem, mathValidation, masteryMet)
      : buildEvidenceBasedMathSummary(mathValidation, mathProblem, effectiveStrategies, masteryMet);

  return {
    overallLevel,
    masteryMet,
    correctEvidence,
    incorrectEvidence,
    missingEvidence,
    notes,
    cleanedStudentResponse,
    confidence: "high",
    renderedSummary,
  };
}

/**
 * Build evidence-based summary text using concrete details about
 * what the student demonstrated, what they got right/wrong, and
 * what strategies are missing. Avoids generic fallback language.
 */
function buildEvidenceBasedMathSummary(
  mathValidation: MathValidationResult,
  mathProblem: MathProblem,
  effectiveStrategies: string[],
  masteryMet: boolean,
): string {
  if (masteryMet) {
    const strategies = effectiveStrategies.join(", ");
    return `The student solved ${mathProblem.expression} correctly (=${mathValidation.correctAnswer}) and explained their strategy using ${strategies}.`;
  }

  const demonstrated = new Set(effectiveStrategies.map(s => s.toLowerCase()));
  const onesA = mathProblem.b !== undefined ? mathProblem.a % 10 : null;
  const onesB = mathProblem.b !== undefined ? mathProblem.b % 10 : null;

  // Build evidence parts
  const parts: string[] = [];
  if (demonstrated.has("add ones") && onesA !== null && onesB !== null) {
    parts.push(`knew to add the ones (${onesA} and ${onesB})`);
  }
  if (demonstrated.has("carry")) {
    parts.push("recognized the need to regroup/carry");
  }
  if (demonstrated.has("add tens")) {
    parts.push("addressed the tens place");
  }
  if (demonstrated.has("check ones")) {
    parts.push("checked whether borrowing was needed");
  }
  if (demonstrated.has("borrow from tens")) {
    parts.push("knew to borrow from the tens");
  }
  if (demonstrated.has("subtract ones") && onesA !== null && onesB !== null) {
    parts.push(`subtracted the ones (${onesA} and ${onesB})`);
  }

  // Answer status
  if (mathValidation.status === "correct") {
    parts.push(`gave the correct total of ${mathValidation.correctAnswer}`);
  } else if (mathValidation.extractedAnswer !== null) {
    parts.push(`gave ${mathValidation.extractedAnswer} instead of ${mathValidation.correctAnswer}`);
  }

  // Missing pieces
  const missing: string[] = [];
  if (!demonstrated.has("carry") && mathProblem.requiresRegrouping && mathProblem.skill === "two_digit_addition") {
    missing.push("did not fully explain how to regroup the extra ten");
  }
  if (!demonstrated.has("borrow from tens") && mathProblem.requiresRegrouping && mathProblem.skill === "two_digit_subtraction") {
    missing.push("did not explain borrowing from the tens");
  }
  if (!demonstrated.has("add tens") && mathProblem.skill === "two_digit_addition") {
    missing.push("did not address the tens place");
  }
  if (mathValidation.matchedMisconception) {
    missing.push(`likely misconception: ${mathValidation.matchedMisconception}`);
  }

  // No evidence at all
  if (parts.length === 0 && mathValidation.extractedAnswer === null) {
    return "The student did not provide enough math-related verbal evidence to evaluate.";
  }

  const evidencePart = parts.length > 0
    ? `The student ${parts.join(", ")}`
    : "The student attempted the problem";
  const missingPart = missing.length > 0 ? `, but ${missing.join(" and ")}` : "";

  return `${evidencePart}${missingPart}.`;
}

// ============================================================================
// Reasoning-step-based summary (Part 5)
// ============================================================================

/**
 * Check if a reasoning step was demonstrated in the student's transcript.
 * Uses number matching: if the expected statement contains 2+ numbers,
 * all must appear in the transcript.
 */
function isStepDemonstrated(step: ReasoningStep, transcript: string): boolean {
  const lower = transcript.toLowerCase();
  return step.expectedStatements.some(stmt => {
    const nums = stmt.match(/\d+/g) || [];
    if (nums.length >= 2) {
      return nums.every(n => lower.includes(n));
    }
    return lower.includes(stmt.toLowerCase());
  });
}

/**
 * Build a teacher summary using structured reasoning steps for concrete evidence.
 *
 * Example output:
 *   "The student added 4 + 2 = 6, added 20 + 10 = 30, and combined them to get 36."
 *   "The student added 7 + 6 = 13, but did not explain how to regroup the extra ten."
 */
function buildReasoningStepSummary(
  steps: ReasoningStep[],
  transcript: string,
  mathProblem: MathProblem,
  mathValidation: MathValidationResult,
  masteryMet: boolean,
): string {
  const demonstrated: string[] = [];
  const missing: string[] = [];

  for (const step of steps) {
    if (isStepDemonstrated(step, transcript)) {
      // Use the first expected statement as the concrete evidence
      demonstrated.push(step.expectedStatements[0].toLowerCase());
    } else {
      missing.push(step.label.toLowerCase());
    }
  }

  if (masteryMet && demonstrated.length > 0) {
    return `The student solved ${mathProblem.expression} correctly (=${mathValidation.correctAnswer}). They explained: ${demonstrated.join(", ")}.`;
  }

  if (demonstrated.length === 0 && mathValidation.extractedAnswer === null) {
    return "The student did not provide enough math-related verbal evidence to evaluate.";
  }

  const parts: string[] = [];
  if (demonstrated.length > 0) {
    parts.push(`The student explained: ${demonstrated.join(", ")}`);
  } else {
    parts.push("The student attempted the problem");
  }

  if (mathValidation.status === "correct") {
    parts.push(`gave the correct answer ${mathValidation.correctAnswer}`);
  } else if (mathValidation.extractedAnswer !== null) {
    parts.push(`gave ${mathValidation.extractedAnswer} instead of ${mathValidation.correctAnswer}`);
  }

  const missingPart = missing.length > 0
    ? `, but did not explain: ${missing.join(", ")}`
    : "";

  return `${parts.join(", ")}${missingPart}.`;
}

/**
 * Build a teacher summary using pre-computed reasoning step accumulation.
 * This is the most precise summary — it knows exactly which steps were
 * demonstrated across ALL turns (not just the current one).
 *
 * Example output:
 *   "The student gave the correct answer 36 and explained that 4 + 2 = 6,
 *    but did not yet explain that 20 + 10 = 30."
 */
function buildAccumulatedStepSummary(
  steps: ReasoningStep[],
  accumulation: ReasoningStepAccumulation,
  mathProblem: MathProblem,
  mathValidation: MathValidationResult,
  fullTranscript?: string,
): string {
  // ALTERNATE STRATEGY: When the student used a valid non-canonical method,
  // describe their actual reasoning path instead of listing missing canonical steps.
  if (accumulation.alternateStrategyDetected && accumulation.answerCorrect && fullTranscript) {
    return buildAlternateStrategySummary(fullTranscript, mathProblem, mathValidation);
  }

  const satisfiedSet = new Set(accumulation.satisfiedStepIds);

  // NEGATION RESPECT: If the student explicitly denied answering a step
  // ("I didn't answer the five", "I wasn't answering that"), do not credit
  // that step as demonstrated. Check the transcript for negation patterns.
  const negatedStepIds = new Set<string>();
  if (fullTranscript) {
    const negationPattern = /\b(?:didn'?t|did not|wasn'?t|not)\s+(?:answer|say|do|mean)\s+(?:the\s+)?(\w+)/gi;
    let negMatch;
    while ((negMatch = negationPattern.exec(fullTranscript)) !== null) {
      const negatedWord = negMatch[1].toLowerCase();
      // Map the negated word to a step: "five" → ones_sum step with 5, etc.
      for (const step of steps) {
        for (const stmt of step.expectedStatements) {
          const nums = stmt.match(/\d+/g) || [];
          for (const n of nums) {
            const nWord = numberToWord(parseInt(n));
            if (negatedWord === nWord || negatedWord === n) {
              negatedStepIds.add(step.id);
            }
          }
        }
      }
    }
  }

  const demonstrated: string[] = [];
  const missing: string[] = [];

  for (const step of steps) {
    if (satisfiedSet.has(step.id) && !negatedStepIds.has(step.id)) {
      demonstrated.push(step.expectedStatements[0].toLowerCase());
    } else {
      missing.push(step.label.toLowerCase());
    }
  }

  // All steps + correct answer = mastery
  if (missing.length === 0 && accumulation.answerCorrect) {
    return `The student solved ${mathProblem.expression} correctly (=${mathValidation.correctAnswer}) and explained all steps: ${demonstrated.join(", ")}.`;
  }

  // No evidence at all
  if (demonstrated.length === 0 && !accumulation.answerCorrect && accumulation.extractedAnswer === null) {
    return "The student did not provide enough math-related verbal evidence to evaluate.";
  }

  const parts: string[] = [];

  // Answer status — don't misattribute sub-step answers as whole-problem attempts
  if (accumulation.answerCorrect) {
    parts.push(`The student gave the correct final answer ${mathValidation.correctAnswer}`);
  } else if (accumulation.extractedAnswer !== null) {
    // Check if the extracted answer matches a sub-step expected value or an operand
    // (operands appear when the student says "5 + 9 = 14" — 14 is an operand, not a wrong final answer)
    const isSubStepValue = steps.some(step =>
      step.expectedStatements.some(stmt => {
        const m = stmt.match(/=\s*(\d+)/);
        return m && parseInt(m[1]) === accumulation.extractedAnswer;
      })
    );
    const isOperandValue = accumulation.extractedAnswer === mathProblem.a
      || accumulation.extractedAnswer === (mathProblem.b ?? -1);

    // Check if the extracted answer is a decomposition part (e.g., 7 from "14 = 7 + 7").
    // A number is a decomposition part if it cleanly pairs with another number to form
    // an operand, AND the transcript contains decomposition evidence.
    const ea = accumulation.extractedAnswer!;
    const isDecompositionPart = (() => {
      if (!fullTranscript) return false;
      const a = mathProblem.a;
      const b = mathProblem.b ?? 0;
      // Check if ea is a valid part of either operand (ea + complement = operand)
      const complementA = a - ea;
      const complementB = b - ea;
      const validPartOfA = ea > 0 && ea < a && complementA > 0;
      const validPartOfB = ea > 0 && ea < b && complementB > 0;
      if (!validPartOfA && !validPartOfB) return false;
      // Verify transcript mentions this decomposition
      const norm = normalizeNumberWords(fullTranscript);
      if (validPartOfA) {
        const hasDecompEvidence = new RegExp(`\\b${a}\\b.*\\b${ea}\\b.*\\b${complementA}\\b|\\b${ea}\\s*(?:\\+|and|plus)\\s*${complementA}\\b`).test(norm);
        if (hasDecompEvidence) return true;
      }
      if (validPartOfB) {
        const hasDecompEvidence = new RegExp(`\\b${b}\\b.*\\b${ea}\\b.*\\b${complementB}\\b|\\b${ea}\\s*(?:\\+|and|plus)\\s*${complementB}\\b`).test(norm);
        if (hasDecompEvidence) return true;
      }
      return false;
    })();

    if ((isSubStepValue || isOperandValue) && demonstrated.length > 0) {
      // The student's last answer was a correct sub-step result or operand restatement
      parts.push(`The student worked through sub-steps correctly but did not yet give the final answer of ${mathValidation.correctAnswer}`);
    } else if (isOperandValue && demonstrated.length === 0) {
      // Student restated an operand as part of a decomposition, not as a final answer attempt
      parts.push(`The student proposed a decomposition strategy but did not yet reach the final answer of ${mathValidation.correctAnswer}`);
    } else if (isDecompositionPart) {
      // The extracted answer is a decomposition part (e.g., 7 from "14 = 7 + 7"),
      // NOT a final answer attempt
      parts.push(`The student explored a decomposition strategy but did not yet reach the final answer of ${mathValidation.correctAnswer}`);
    } else {
      parts.push(`The student gave ${accumulation.extractedAnswer} instead of ${mathValidation.correctAnswer}`);
    }
  } else {
    parts.push("The student attempted the problem");
  }

  // Demonstrated steps
  if (demonstrated.length > 0) {
    parts.push(`explained that ${demonstrated.join(", ")}`);
  }

  const missingPart = missing.length > 0
    ? `, but did not yet explain: ${missing.join(", ")}`
    : "";

  return `${parts.join(" and ")}${missingPart}.`;
}

// ============================================================================
// Alternate Strategy Summary
// ============================================================================

/**
 * Reasoning path type detected from student transcript.
 */
type ReasoningPath =
  | "canonical"
  | "split_addend"
  | "bridge_to_friendly"
  | "tens_first_count_on"
  | "multi_decomposition"
  | "mixed"
  | "unclear";

/**
 * Detect the student's reasoning path from their transcript.
 * Returns the path type and the arithmetic chain found.
 */
function detectReasoningPath(
  text: string,
  mathProblem: MathProblem,
): { path: ReasoningPath; chain: Array<{ left: number; right: number; result: number }>; decomps?: Array<{ whole: number; partA: number; partB: number }> } {
  const normalized = normalizeNumberWords(text);

  // Extract all equations: "14 + 10 = 24", "24 + 1 = 25", "10 + 10 and that's 20", etc.
  // Result indicators include STT-style: "just", "should be", "to get", "that's"
  const resultIndicator = `(?:=|is|gives|makes|gets?|just|(?:should|would|could)\\s+be|to\\s+(?:get|make)|and\\s+that(?:'s|\\s+is))`;
  const eqPattern = new RegExp(`(\\d+)\\s*([+\\-])\\s*(\\d+)\\s*${resultIndicator}\\s*(\\d+)`, "gi");
  const chain: Array<{ left: number; right: number; result: number; op: string }> = [];
  let match;
  while ((match = eqPattern.exec(normalized)) !== null) {
    chain.push({
      left: parseInt(match[1]),
      op: match[2],
      right: parseInt(match[3]),
      result: parseInt(match[4]),
    });
  }

  // Also extract implicit chains: "add 4 and get 24", "plus 1 to get 25"
  const implicitOp = `(?:plus|and|added?\\s+to)`;
  const implicitResult = `(?:is|=|gives|makes|gets?|just|(?:should|would|could)\\s+be|to\\s+get|to\\s+make|and\\s+get|and\\s+that(?:'s|\\s+is))`;
  const implicitPattern = new RegExp(`(\\d+)\\s*${implicitOp}\\s*(\\d+)\\s*${implicitResult}\\s*(\\d+)`, "gi");

  // Also match "take the 20 and add 4 and get 24" → need to capture across "and add"
  const verbAddPattern = /(?:add|plus)\s*(\d+)\s*(?:and\s+(?:get|that's)|to\s+get|(?:=|is|gives|makes|gets?|(?:should|would)\s+be))\s*(\d+)/gi;

  // Also match "extra 1 is 25", "1 more is 25", "remaining 1 should be 25"
  const extraPattern = /(?:extra|more|another|remaining)\s*(\d+)\s*(?:is|=|gives|makes|gets?|(?:should|would)\s+be)\s*(\d+)/gi;
  while ((match = implicitPattern.exec(normalized)) !== null) {
    const entry = {
      left: parseInt(match[1]),
      op: "+",
      right: parseInt(match[2]),
      result: parseInt(match[3]),
    };
    // Avoid duplicates
    if (!chain.some(c => c.left === entry.left && c.right === entry.right && c.result === entry.result)) {
      chain.push(entry);
    }
  }

  // Handle "add 4 and get 24" / "plus 1 to get 25" — finds the preceding number as left operand
  while ((match = verbAddPattern.exec(normalized)) !== null) {
    const right = parseInt(match[1]);
    const result = parseInt(match[2]);
    const left = result - right; // infer the left operand
    const entry = { left, op: "+", right, result };
    if (!chain.some(c => c.left === entry.left && c.right === entry.right && c.result === entry.result)) {
      chain.push(entry);
    }
  }

  // Handle "extra 1 is 25" / "1 more is 25" — infer left operand
  while ((match = extraPattern.exec(normalized)) !== null) {
    const right = parseInt(match[1]);
    const result = parseInt(match[2]);
    const left = result - right;
    const entry = { left, op: "+", right, result };
    if (!chain.some(c => c.left === entry.left && c.right === entry.right && c.result === entry.result)) {
      chain.push(entry);
    }
  }

  // Juxtaposition: "14 + 10 24" — operator present but no result indicator (common in STT).
  // Only accept when the arithmetic checks out: left op right === result.
  const juxtaPattern = /(\d+)\s*([+\-])\s*(\d+)\s+(\d+)/g;
  while ((match = juxtaPattern.exec(normalized)) !== null) {
    const left = parseInt(match[1]);
    const op = match[2];
    const right = parseInt(match[3]);
    const result = parseInt(match[4]);
    const expected = op === "+" ? left + right : left - right;
    if (expected === result) {
      const entry = { left, op, right, result };
      if (!chain.some(c => c.left === entry.left && c.right === entry.right && c.result === entry.result)) {
        chain.push(entry);
      }
    }
  }

  // Verb-add with optional article: "add the 1 to get 25", "add 4 and get 24",
  // "add the remaining 1 should be 25"
  const verbAddWithArticle = /(?:add|plus)\s+(?:the\s+|a\s+|an\s+)?(?:remaining\s+|extra\s+|last\s+)?(\d+)\s*(?:and\s+(?:get|that's|make)|to\s+(?:get|make)|(?:=|is|gives|makes|gets?|(?:should|would)\s+be))\s*(\d+)/gi;
  while ((match = verbAddWithArticle.exec(normalized)) !== null) {
    const right = parseInt(match[1]);
    const result = parseInt(match[2]);
    const left = result - right;
    const entry = { left, op: "+", right, result };
    if (!chain.some(c => c.left === entry.left && c.right === entry.right && c.result === entry.result)) {
      chain.push(entry);
    }
  }

  // Detect decomposition statements: "break 11 into 10 and 1", "split 11 into a 10 and 1"
  // Handles both "split 11 into 10 and 1" (direct) and "take 11 and break it into 10 and 1" (two-verb)
  const decompPattern = /(?:break|split|separate)\s+(?:the\s+|that\s+)?(\d+)\s+(?:(?:up\s+)?into|to)\s+(?:a\s+|an\s+|the\s+)?(\d+)\s+and\s+(?:a\s+|an\s+|the\s+)?(\d+)/gi;
  let decomposition: { whole: number; partA: number; partB: number } | null = null;
  if ((match = decompPattern.exec(normalized)) !== null) {
    decomposition = { whole: parseInt(match[1]), partA: parseInt(match[2]), partB: parseInt(match[3]) };
  }
  // Also match simpler form: "break it up into 10 and 1", "split that into a 10 and 1"
  if (!decomposition) {
    const simpleDecomp = /(?:break|split|separate)\s+(?:it|that|them)\s+(?:up\s+)?(?:into|to)\s+(?:a\s+|an\s+|the\s+)?(\d+)\s+and\s+(?:a\s+|an\s+|the\s+)?(\d+)/gi;
    if ((match = simpleDecomp.exec(normalized)) !== null) {
      const partA = parseInt(match[1]);
      const partB = parseInt(match[2]);
      // Find which operand this refers to by checking if parts sum to a or b
      const { a: opA } = mathProblem;
      const opB = mathProblem.b ?? 0;
      const whole = (partA + partB === opA) ? opA : (partA + partB === opB) ? opB : partA + partB;
      decomposition = { whole, partA, partB };
    }
  }

  // Detect multi-decomposition: "14 is 8 plus 6 and 11 is 5 plus 6"
  // Pattern: X is A plus B (where A + B = X and X is an operand)
  const multiDecomps: Array<{ whole: number; partA: number; partB: number }> = [];
  const equivPattern = /\b(\d+)\s+(?:is|=|equals?|could\s+(?:also\s+)?be)\s+(\d+)\s*(?:\+|plus|and)\s*(\d+)\b/gi;
  let eqMatch;
  while ((eqMatch = equivPattern.exec(normalized)) !== null) {
    const whole = parseInt(eqMatch[1]);
    const pA = parseInt(eqMatch[2]);
    const pB = parseInt(eqMatch[3]);
    if (pA + pB === whole && (whole === mathProblem.a || whole === (mathProblem.b ?? 0))) {
      multiDecomps.push({ whole, partA: pA, partB: pB });
    }
  }

  // Arithmetic validation: filter out phantom matches where left op right ≠ result.
  // This prevents cross-boundary matches like "6 and 11 is 5" from decomposition
  // statements such as "14 is 8 plus 6 and 11 is 5 plus 6".
  const validChain = chain.filter(c => {
    const expected = c.op === "+" ? c.left + c.right : c.left - c.right;
    return expected === c.result;
  });
  // Replace chain contents with validated entries
  chain.length = 0;
  chain.push(...validChain);

  const { a, correctAnswer } = mathProblem;
  const b = mathProblem.b ?? 0;
  const simpleChain = chain.map(c => ({ left: c.left, right: c.right, result: c.result }));

  if (chain.length === 0 && !decomposition && multiDecomps.length === 0) {
    return { path: "unclear", chain: simpleChain };
  }

  // Multi-decomposition: both operands decomposed non-canonically (e.g., 14=8+6, 11=5+6).
  // Prioritize this classification — the student's strategy IS the decomposition,
  // and the chain equations are cross-pair computations within that strategy.
  if (multiDecomps.length >= 2) {
    return { path: "multi_decomposition", chain: simpleChain, decomps: multiDecomps };
  }

  // If we have decomposition but no chain entries, infer chain from decomposition + answer
  if (chain.length === 0 && decomposition) {
    const keptWhole = decomposition.whole === a ? b : a;
    const step1Result = keptWhole + decomposition.partA;
    chain.push({ left: keptWhole, op: "+", right: decomposition.partA, result: step1Result });
    if (step1Result !== correctAnswer) {
      chain.push({ left: step1Result, op: "+", right: decomposition.partB, result: correctAnswer });
    }
    const updatedSimpleChain = chain.map(c => ({ left: c.left, right: c.right, result: c.result }));
    return { path: "split_addend", chain: updatedSimpleChain };
  }

  // Classify the path
  const onesA = a % 10, onesB = b % 10;
  const tensA = a - onesA, tensB = b - onesB;

  // Canonical: ones + tens + combine
  const hasOnesStep = chain.some(c =>
    (c.left === onesA && c.right === onesB) || (c.left === onesB && c.right === onesA));
  const hasTensStep = chain.some(c =>
    (c.left === tensA && c.right === tensB) || (c.left === tensB && c.right === tensA));
  if (hasOnesStep && hasTensStep) {
    return { path: "canonical", chain: simpleChain };
  }

  // Split addend: one addend kept whole, other split
  // e.g., 14 + 10 = 24, 24 + 1 = 25 (split 11 into 10 + 1)
  // e.g., 11 + 10 = 21, 21 + 4 = 25 (split 14 into 10 + 4)
  const usesWholeAddend = chain.some(c =>
    c.left === a || c.right === a || c.left === b || c.right === b);
  if (usesWholeAddend) {
    // Check if it also bridges to a friendly number
    const firstResult = chain[0]?.result;
    if (firstResult && firstResult % 5 === 0 && firstResult !== correctAnswer) {
      return { path: "bridge_to_friendly", chain: simpleChain };
    }
    return { path: "split_addend", chain: simpleChain };
  }

  // Tens first then count on: starts with tens, then adds remainder
  if (hasTensStep && !hasOnesStep) {
    return { path: "tens_first_count_on", chain: simpleChain };
  }

  // Mixed or unrecognized pattern with valid arithmetic
  if (chain.some(c => c.result === correctAnswer)) {
    return { path: "mixed", chain: simpleChain };
  }

  return { path: "unclear", chain: simpleChain };
}

/**
 * Rank equations in a multi-decomposition chain by instructional coherence.
 *
 * Given decompositions (e.g. 14=8+6, 11=5+6), the student's strategy combines
 * cross-decomposition pairs to reach the answer. This function orders the chain
 * so the summary reads naturally:
 *
 *   1. Shared-factor cross-pairs first (e.g. 6+6=12 — same part in both decomps)
 *   2. Other strategy-coherent cross-pairs (e.g. 8+5=13)
 *   3. Final combination step last (e.g. 12+13=25)
 *
 * Detour equations (not a valid cross-pair and not the final combination) are
 * suppressed when the remaining chain still reaches the correct answer.
 */
function rankMultiDecompChain(
  chain: Array<{ left: number; right: number; result: number }>,
  decomps: Array<{ whole: number; partA: number; partB: number }>,
  mathProblem: MathProblem,
): Array<{ left: number; right: number; result: number }> {
  if (chain.length === 0 || decomps.length < 2) return chain;

  const correctAnswer = mathProblem.correctAnswer;

  // Collect all decomposition parts per operand
  const partsA = decomps.filter(d => d.whole === mathProblem.a).flatMap(d => [d.partA, d.partB]);
  const partsB = decomps.filter(d => d.whole === (mathProblem.b ?? 0)).flatMap(d => [d.partA, d.partB]);

  // Build valid cross-pairs: one part from each operand's decomposition,
  // excluding pairs whose result equals an original operand (those are just
  // restating the decomposition, not a combining step).
  const origOperands = new Set(decomps.map(d => d.whole));
  type ScoredPair = { left: number; right: number; result: number; isShared: boolean };
  const crossPairs: ScoredPair[] = [];

  for (const pa of partsA) {
    for (const pb of partsB) {
      const result = pa + pb;
      if (origOperands.has(result)) continue; // skip decomp restatements
      crossPairs.push({ left: pa, right: pb, result, isShared: pa === pb });
    }
  }

  // Find the final combination step (result === correctAnswer)
  const finalStep = chain.find(c => c.result === correctAnswer);

  // Match chain equations to cross-pairs
  const matchesCrossPair = (c: { left: number; right: number; result: number }) =>
    crossPairs.some(cp =>
      (cp.left === c.left && cp.right === c.right && cp.result === c.result) ||
      (cp.left === c.right && cp.right === c.left && cp.result === c.result));

  // Categorize chain entries
  const sharedFactorSteps: Array<{ left: number; right: number; result: number }> = [];
  const otherCrossPairSteps: Array<{ left: number; right: number; result: number }> = [];
  const detourSteps: Array<{ left: number; right: number; result: number }> = [];

  for (const c of chain) {
    if (c.result === correctAnswer) continue; // handle final step separately
    if (matchesCrossPair(c)) {
      const isShared = crossPairs.some(cp =>
        cp.isShared && cp.result === c.result &&
        ((cp.left === c.left && cp.right === c.right) || (cp.left === c.right && cp.right === c.left)));
      if (isShared) {
        sharedFactorSteps.push(c);
      } else {
        otherCrossPairSteps.push(c);
      }
    } else {
      detourSteps.push(c);
    }
  }

  // Assemble the ranked chain:
  // 1. Shared-factor cross-pairs
  // 2. Other valid cross-pairs
  // 3. Detour steps — include only if needed to reach the answer
  //    (i.e., their result feeds into the final combination)
  const coreChain = [...sharedFactorSteps, ...otherCrossPairSteps];
  const coreResults = new Set(coreChain.map(c => c.result));

  // Include detour only if its result is needed by the final step
  // and no core step already produces that result.
  for (const d of detourSteps) {
    if (finalStep && (finalStep.left === d.result || finalStep.right === d.result) && !coreResults.has(d.result)) {
      coreChain.push(d);
      coreResults.add(d.result);
    }
  }

  // 4. Final combination step last
  if (finalStep) {
    coreChain.push(finalStep);
  }

  // Safety: if ranking produced an empty chain, fall back to original
  return coreChain.length > 0 ? coreChain : chain;
}

/**
 * Build a summary that faithfully describes the student's alternate reasoning path.
 * Does NOT reference canonical step labels or list canonical steps as "missing".
 */
function buildAlternateStrategySummary(
  fullTranscript: string,
  mathProblem: MathProblem,
  mathValidation: MathValidationResult,
): string {
  const { path, chain, decomps } = detectReasoningPath(fullTranscript, mathProblem);

  const prefix = `The student solved ${mathProblem.expression} correctly (=${mathValidation.correctAnswer})`;

  if (chain.length === 0 && path === "unclear") {
    // Safety: if alternateStrategyDetected was set, the transcript had real arithmetic
    // work that the evaluator recognized. Avoid "unclear" — use a generous fallback.
    return `${prefix} and showed their reasoning.`;
  }

  // Build a natural description of the arithmetic chain
  const chainDesc = chain
    .map(c => `${c.left} + ${c.right} = ${c.result}`)
    .join(", then ");

  switch (path) {
    case "canonical":
      return `${prefix} using place-value steps: ${chainDesc}.`;
    case "split_addend": {
      // Identify which addend was split
      const keptWhole = chain[0]?.left === mathProblem.a || chain[0]?.right === mathProblem.a ? mathProblem.a : (mathProblem.b ?? 0);
      const split = keptWhole === mathProblem.a ? (mathProblem.b ?? 0) : mathProblem.a;
      return `${prefix} by splitting ${split} and adding to ${keptWhole}: ${chainDesc}.`;
    }
    case "bridge_to_friendly":
      return `${prefix} by bridging to a friendly number: ${chainDesc}.`;
    case "tens_first_count_on":
      return `${prefix} by adding the tens first, then counting on: ${chainDesc}.`;
    case "multi_decomposition": {
      const decompDesc = (decomps ?? [])
        .map(d => `${d.whole} = ${d.partA} + ${d.partB}`)
        .join(" and ");
      const orderedChain = rankMultiDecompChain(chain, decomps ?? [], mathProblem);
      const orderedDesc = orderedChain.length > 0
        ? orderedChain.map(c => `${c.left} + ${c.right} = ${c.result}`).join(", then ")
        : chainDesc;
      return `${prefix} by decomposing both numbers (${decompDesc}), then combining parts: ${orderedDesc}.`;
    }
    case "mixed":
      return `${prefix} by showing: ${chainDesc}.`;
    case "unclear":
      // We have chain entries but couldn't classify — still describe the work
      return `${prefix} by showing: ${chainDesc}.`;
    default:
      return `${prefix} by showing: ${chainDesc}.`;
  }
}
