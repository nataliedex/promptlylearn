import { PromptAssessment } from "./prompt";

/**
 * Grade-level rubric validation.
 *
 * After the LLM generates assessment rubrics, this module checks that
 * success criteria, misconceptions, and learning objectives are
 * developmentally appropriate for the student's grade level.
 *
 * Two layers of protection:
 * 1. Prompt constraints in buildGradeGuidelines() (prevention)
 * 2. This post-generation validation (catch + fix)
 */

// ============================================================================
// Forbidden-term tables — keyed by max grade where the term is disallowed
// ============================================================================

interface ForbiddenEntry {
  /** Regex pattern to match (case-insensitive) */
  pattern: RegExp;
  /** Human-readable label for diagnostics */
  label: string;
  /** Maximum grade number where this term is disallowed (inclusive) */
  maxGrade: number;
  /** Simpler replacement phrase (if automatic rewrite is possible) */
  replacement?: string;
}

const FORBIDDEN_TERMS: ForbiddenEntry[] = [
  // --- K-1 only (maxGrade 1) ---
  { pattern: /\bdecision[- ]?making\b/i, label: "decision-making", maxGrade: 1, replacement: "choosing" },
  { pattern: /\bproblem[- ]?solving\b/i, label: "problem-solving", maxGrade: 1, replacement: "figuring out" },
  { pattern: /\bdemonstrate(?:s)? understanding\b/i, label: "demonstrates understanding", maxGrade: 1, replacement: "shows they know" },
  { pattern: /\barticulate(?:s)?\b/i, label: "articulates", maxGrade: 1, replacement: "says" },
  { pattern: /\banalyze(?:s)?\b/i, label: "analyzes", maxGrade: 1, replacement: "looks at" },
  { pattern: /\bevaluate(?:s)?\b/i, label: "evaluates", maxGrade: 1, replacement: "checks" },

  // --- K-3 (maxGrade 3) ---
  { pattern: /\bassociative property\b/i, label: "associative property", maxGrade: 3 },
  { pattern: /\bdistributive property\b/i, label: "distributive property", maxGrade: 3 },
  { pattern: /\bcommutative property\b/i, label: "commutative property", maxGrade: 3 },
  { pattern: /\balgebraic thinking\b/i, label: "algebraic thinking", maxGrade: 3 },
  { pattern: /\bnumber theory\b/i, label: "number theory", maxGrade: 3 },
  { pattern: /\balgebraic reasoning\b/i, label: "algebraic reasoning", maxGrade: 3 },
  { pattern: /\bproof\b/i, label: "proof", maxGrade: 3 },
  { pattern: /\btheorem\b/i, label: "theorem", maxGrade: 3 },
  { pattern: /\bmetacogniti\w+/i, label: "metacognitive", maxGrade: 3 },
  { pattern: /\bsynthesize(?:s)?\b/i, label: "synthesize", maxGrade: 3, replacement: "combine" },
  { pattern: /\bsynth[ei]s[ei]s\b/i, label: "synthesis", maxGrade: 3, replacement: "combining ideas" },

  // --- K-5 (maxGrade 5) ---
  { pattern: /\bformal proof\b/i, label: "formal proof", maxGrade: 5 },
  { pattern: /\baxiomatic\b/i, label: "axiomatic", maxGrade: 5 },
  { pattern: /\bset theory\b/i, label: "set theory", maxGrade: 5 },
  { pattern: /\bsynthesizes? (?:multiple |several )?(?:mathematical |scientific )?principles?\b/i, label: "synthesizes principles", maxGrade: 5 },
];

// ============================================================================
// Overly-abstract verb patterns for K-2
// These verbs are fine for older grades but too academic for K-2 criteria
// ============================================================================

const K2_ABSTRACT_VERBS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bdemonstrate(?:s)?\b/gi, replacement: "show" },
  { pattern: /\bidentif(?:y|ies)\b/gi, replacement: "name" },
  { pattern: /\bdescribe(?:s)? (?:the )?(?:role|significance|importance)\b/gi, replacement: "tell why" },
  { pattern: /\bappl(?:y|ies)\b/gi, replacement: "use" },
  { pattern: /\bcomprehend(?:s)?\b/gi, replacement: "understand" },
  { pattern: /\brecognize(?:s)?\b/gi, replacement: "notice" },
];

// ============================================================================
// Vague criteria detection — phrases that are not observable or measurable
// These are banned in successCriteria, expectedConcepts, and scoringLevels
// ============================================================================

const VAGUE_CRITERIA_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bclear understanding\b/i, label: "clear understanding" },
  { pattern: /\bdemonstrates?\s+understanding\b/i, label: "demonstrates understanding" },
  { pattern: /\bshows?\s+understanding\b/i, label: "shows understanding" },
  { pattern: /\bdemonstrates?\s+knowledge\b/i, label: "demonstrates knowledge" },
  { pattern: /\bshows?\s+knowledge\b/i, label: "shows knowledge" },
  { pattern: /\bstrong\s+explanation\b/i, label: "strong explanation" },
  { pattern: /\bgood\s+explanation\b/i, label: "good explanation" },
  { pattern: /\bexplains?\s+clearly\b/i, label: "explains clearly" },
  { pattern: /\buses?\s+correct\s+vocabulary\b/i, label: "uses correct vocabulary" },
  { pattern: /\bclear\s+step-by-step\b/i, label: "clear step-by-step" },
  { pattern: /\ball\s+key\s+concepts?\b/i, label: "all key concepts" },
  { pattern: /\bkey\s+ideas?\b/i, label: "key ideas" },
  { pattern: /\bthorough\s+explanation\b/i, label: "thorough explanation" },
  { pattern: /\bcomprehensive\s+understanding\b/i, label: "comprehensive understanding" },
];

/**
 * Math-specific vague criteria patterns.
 * These detect rubric criteria that reference math operations generically
 * instead of using the actual numbers from the problem.
 */
const MATH_VAGUE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bexplains?\s+how\s+to\s+add\s+the\s+ones\b/i, label: "explains how to add the ones" },
  { pattern: /\bexplains?\s+how\s+to\s+add\s+the\s+tens\b/i, label: "explains how to add the tens" },
  { pattern: /\bexplains?\s+how\s+to\s+subtract\s+the\s+ones\b/i, label: "explains how to subtract the ones" },
  { pattern: /\bexplains?\s+how\s+to\s+subtract\s+the\s+tens\b/i, label: "explains how to subtract the tens" },
  { pattern: /\bexplains?\s+how\s+to\s+add\s+two[- ]digit\s+numbers?\b/i, label: "explains how to add two-digit numbers" },
  { pattern: /\bexplains?\s+how\s+to\s+subtract\s+two[- ]digit\s+numbers?\b/i, label: "explains how to subtract two-digit numbers" },
  { pattern: /\bexplains?\s+the\s+(?:addition|subtraction|multiplication)\s+(?:process|procedure|method)\b/i, label: "explains the process" },
  { pattern: /\bincludes?\s+all\s+steps?\b/i, label: "includes all steps" },
  { pattern: /\bshows?\s+all\s+(?:the\s+)?(?:work|steps)\b/i, label: "shows all work" },
  { pattern: /\bexplains?\s+(?:the\s+)?regrouping\b(?!\s+that\b)(?!\s+\d)/i, label: "explains regrouping" },
  { pattern: /\bexplains?\s+(?:the\s+)?borrowing\b(?!\s+that\b)(?!\s+\d)/i, label: "explains borrowing" },
  { pattern: /\bexplains?\s+(?:the\s+)?carrying\b(?!\s+that\b)(?!\s+\d)/i, label: "explains carrying" },
];

/**
 * Check if a criterion text contains vague, non-observable language.
 * Returns the matched vague phrase label, or null if clean.
 */
export function detectVagueCriteria(text: string): string | null {
  for (const entry of VAGUE_CRITERIA_PATTERNS) {
    if (entry.pattern.test(text)) {
      return entry.label;
    }
  }
  return null;
}

/**
 * Check if a math criterion uses generic language instead of problem-specific numbers.
 * Returns the matched vague phrase label, or null if clean.
 */
export function detectVagueMathCriteria(text: string): string | null {
  for (const entry of MATH_VAGUE_PATTERNS) {
    if (entry.pattern.test(text)) {
      return entry.label;
    }
  }
  return null;
}

// ============================================================================
// Mathematically-incorrect pattern detection
// ============================================================================

const MATH_ERRORS: Array<{ pattern: RegExp; label: string }> = [
  // "subtraction order does not matter" — subtraction is NOT commutative
  { pattern: /subtraction\s+order\s+does\s+not\s+(?:matter|affect)/i, label: "subtraction is not commutative" },
  { pattern: /order\s+(?:of|in)\s+subtraction\s+does\s+not\s+(?:matter|affect)/i, label: "subtraction is not commutative" },
  // "division order does not matter" — division is NOT commutative
  { pattern: /division\s+order\s+does\s+not\s+(?:matter|affect)/i, label: "division is not commutative" },
  { pattern: /order\s+(?:of|in)\s+division\s+does\s+not\s+(?:matter|affect)/i, label: "division is not commutative" },
];

// ============================================================================
// Public API
// ============================================================================

export interface RubricValidationResult {
  /** The cleaned/validated assessment data */
  assessment: PromptAssessment;
  /** Terms that were flagged and removed or rewritten */
  flagged: Array<{ field: string; term: string; reason: string }>;
  /** Whether any changes were made */
  wasModified: boolean;
}

/**
 * Validate and clean a generated rubric for grade-appropriateness.
 *
 * - Removes or rewrites forbidden terms based on grade level
 * - Simplifies abstract verbs for K-2
 * - Flags mathematically incorrect statements
 * - Returns cleaned assessment + list of flagged items
 */
export function validateRubricForGrade(
  assessment: PromptAssessment,
  gradeLevel?: string
): RubricValidationResult {
  const gradeNum = parseGradeNumber(gradeLevel);
  const flagged: RubricValidationResult["flagged"] = [];
  let wasModified = false;

  // Deep-copy to avoid mutating the input
  const result: PromptAssessment = {
    learningObjective: assessment.learningObjective,
    expectedReasoningSteps: assessment.expectedReasoningSteps ? [...assessment.expectedReasoningSteps] : undefined,
    expectedConcepts: assessment.expectedConcepts ? [...assessment.expectedConcepts] : undefined,
    requiredExamples: assessment.requiredExamples,
    validVocabulary: assessment.validVocabulary ? [...assessment.validVocabulary] : undefined,
    misconceptions: assessment.misconceptions ? [...assessment.misconceptions] : undefined,
    scoringLevels: assessment.scoringLevels ? { ...assessment.scoringLevels } : undefined,
    successCriteria: assessment.successCriteria ? [...assessment.successCriteria] : undefined,
    evaluationFocus: assessment.evaluationFocus ? [...assessment.evaluationFocus] : undefined,
    requiredEvidence: assessment.requiredEvidence ? { ...assessment.requiredEvidence } : undefined,
    referenceFacts: assessment.referenceFacts
      ? Object.fromEntries(Object.entries(assessment.referenceFacts).map(([k, v]) => [k, [...v]]))
      : undefined,
  };

  // --- Validate learning objective ---
  if (result.learningObjective) {
    const cleaned = validateText(result.learningObjective, gradeNum, "learningObjective", flagged);
    if (cleaned !== result.learningObjective) {
      result.learningObjective = cleaned;
      wasModified = true;
    }
  }

  // --- Validate expectedConcepts ---
  if (result.expectedConcepts) {
    const cleanedConcepts: string[] = [];
    for (const concept of result.expectedConcepts) {
      const cleaned = validateText(concept, gradeNum, "expectedConcepts", flagged);
      if (isMathematicallyIncorrect(cleaned)) {
        flagged.push({
          field: "expectedConcepts",
          term: concept,
          reason: "mathematically incorrect — removed entirely",
        });
        wasModified = true;
        continue;
      }
      const vagueMatch = detectVagueCriteria(cleaned);
      if (vagueMatch) {
        flagged.push({
          field: "expectedConcepts",
          term: concept,
          reason: `vague criterion "${vagueMatch}" — not observable, removed`,
        });
        wasModified = true;
        continue;
      }
      if (cleaned !== concept) wasModified = true;
      cleanedConcepts.push(cleaned);
    }
    result.expectedConcepts = cleanedConcepts.length > 0 ? cleanedConcepts : undefined;
  }

  // --- Validate requiredExamples ---
  if (result.requiredExamples) {
    const cleaned = validateText(result.requiredExamples, gradeNum, "requiredExamples", flagged);
    if (cleaned !== result.requiredExamples) {
      result.requiredExamples = cleaned;
      wasModified = true;
    }
  }

  // --- Validate scoringLevels ---
  if (result.scoringLevels) {
    for (const key of ["strong", "developing", "needsSupport"] as const) {
      const original = result.scoringLevels[key];
      let cleaned = validateText(original, gradeNum, `scoringLevels.${key}`, flagged);
      const vagueMatch = detectVagueCriteria(cleaned);
      if (vagueMatch) {
        flagged.push({
          field: `scoringLevels.${key}`,
          term: vagueMatch,
          reason: `vague phrase "${vagueMatch}" in scoring level — flagged`,
        });
        wasModified = true;
      }
      if (cleaned !== original) {
        result.scoringLevels[key] = cleaned;
        wasModified = true;
      }
    }
  }

  // --- Validate success criteria ---
  if (result.successCriteria) {
    const cleanedCriteria: string[] = [];
    for (const criterion of result.successCriteria) {
      const cleaned = validateText(criterion, gradeNum, "successCriteria", flagged);
      // Drop criteria that are mathematically incorrect
      if (isMathematicallyIncorrect(cleaned)) {
        flagged.push({
          field: "successCriteria",
          term: criterion,
          reason: "mathematically incorrect — removed entirely",
        });
        wasModified = true;
        continue;
      }
      // Drop criteria that use vague, non-observable language
      const vagueMatch = detectVagueCriteria(cleaned);
      if (vagueMatch) {
        flagged.push({
          field: "successCriteria",
          term: criterion,
          reason: `vague criterion "${vagueMatch}" — not observable, removed`,
        });
        wasModified = true;
        continue;
      }
      if (cleaned !== criterion) wasModified = true;
      cleanedCriteria.push(cleaned);
    }
    result.successCriteria = cleanedCriteria.length > 0 ? cleanedCriteria : undefined;
  }

  // --- Validate misconceptions ---
  if (result.misconceptions) {
    const cleanedMisconceptions: string[] = [];
    for (const misconception of result.misconceptions) {
      // Misconceptions describe wrong ideas — we still clean language but keep them
      const cleaned = validateText(misconception, gradeNum, "misconceptions", flagged);
      // Drop mathematically-incorrect misconceptions that state falsehoods as fact
      if (isMathematicallyIncorrect(cleaned)) {
        flagged.push({
          field: "misconceptions",
          term: misconception,
          reason: "mathematically incorrect statement in misconception — removed",
        });
        wasModified = true;
        continue;
      }
      if (cleaned !== misconception) wasModified = true;
      cleanedMisconceptions.push(cleaned);
    }
    result.misconceptions = cleanedMisconceptions.length > 0 ? cleanedMisconceptions : undefined;
  }

  // --- Validate evaluationFocus for K-2 ---
  if (result.evaluationFocus && gradeNum <= 2) {
    // K-2 prompts rarely need "reasoning" or "evidence" — flag but don't remove
    // (the coach prompt already handles this contextually)
  }

  return { assessment: result, flagged, wasModified };
}

/**
 * Check a single text string for forbidden terms and abstract verbs.
 * Returns the cleaned string.
 */
function validateText(
  text: string,
  gradeNum: number,
  fieldName: string,
  flagged: RubricValidationResult["flagged"]
): string {
  let cleaned = text;

  // Check forbidden terms
  for (const entry of FORBIDDEN_TERMS) {
    if (gradeNum <= entry.maxGrade && entry.pattern.test(cleaned)) {
      if (entry.replacement) {
        cleaned = cleaned.replace(entry.pattern, entry.replacement);
        flagged.push({
          field: fieldName,
          term: entry.label,
          reason: `too advanced for grade ${gradeNum} — rewritten`,
        });
      } else {
        // No simple replacement — flag but keep (will be caught by prompt next time)
        flagged.push({
          field: fieldName,
          term: entry.label,
          reason: `too advanced for grade ${gradeNum} — flagged`,
        });
      }
    }
  }

  // K-1: simplify abstract verbs
  if (gradeNum <= 1) {
    for (const verb of K2_ABSTRACT_VERBS) {
      if (verb.pattern.test(cleaned)) {
        cleaned = cleaned.replace(verb.pattern, verb.replacement);
        flagged.push({
          field: fieldName,
          term: cleaned.match(verb.pattern)?.[0] || "abstract verb",
          reason: `too academic for K-2 — simplified`,
        });
      }
    }
  }

  return cleaned;
}

/**
 * Check if a text contains a mathematically incorrect statement.
 */
function isMathematicallyIncorrect(text: string): boolean {
  return MATH_ERRORS.some(err => err.pattern.test(text));
}

/**
 * Parse a grade-level string to a numeric value.
 * "K" → 0, "1st" → 1, "2nd" → 2, ..., "8th" → 8
 * Falls back to 2 if unparseable (safe default for elementary).
 *
 * Exported for use in tests and other modules.
 */
export function parseGradeNumber(gradeLevel?: string): number {
  if (!gradeLevel) return 2;
  const normalized = gradeLevel.toLowerCase().trim();
  if (normalized === "k" || normalized === "kindergarten") return 0;
  const match = normalized.match(/^(\d+)/);
  if (match) return parseInt(match[1], 10);
  const gradeMatch = normalized.match(/grade\s*(\d+)/);
  if (gradeMatch) return parseInt(gradeMatch[1], 10);
  return 2;
}
