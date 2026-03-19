/**
 * Deterministic coaching for open-ended explanation prompts.
 *
 * Coverage-based (not procedure-based): progress = new extractable evidence.
 * Pure functions — no LLM calls, no side effects.
 *
 * Reuses deterministicValidator.ts for entity-attribute extraction and
 * factual validation.
 */

import { RequiredEvidence } from "./prompt";
import {
  validate,
  ValidationResult,
  buildEvidenceChecklist,
  EvidenceChecklistItem,
  buildMissingEvidenceProbe,
  buildFactualCorrectionResponse,
} from "./deterministicValidator";

// ============================================================================
// Types
// ============================================================================

/** Student states for explanation prompts — coverage-based. */
export type ExplanationState =
  | "no_evidence"
  | "claim_only"
  | "partial_evidence"
  | "factual_error"
  | "complete"
  | "uncertain"
  | "frustrated"
  | "meta_question";

/** Remediation move types for explanation prompts. */
export type ExplanationMoveType =
  | "EVIDENCE_PROBE"
  | "SPECIFICITY_PROBE"
  | "FACTUAL_CORRECTION"
  | "CLARIFICATION"
  | "ENCOURAGEMENT_PROBE"
  | "HINT"
  | "MODEL_AND_ASK"
  | "WRAP_MASTERY"
  | "WRAP_SUPPORT";

/** A single remediation move returned by the explanation pipeline. */
export interface ExplanationMove {
  type: ExplanationMoveType;
  text: string;
  state: ExplanationState;
  /** Which criterion this move targets (if any). */
  targetCriterion?: string;
  /** Human-readable explanation of why this move was selected. */
  explanation: string;
}

/** Wrap decision for explanation sessions. */
export interface ExplanationWrapDecision {
  action: "wrap_mastery" | "wrap_support" | "continue_probing";
  reason: string;
}

/** Accumulated evidence across turns. */
export interface AccumulatedExplanationEvidence {
  /** All entity-attribute pairs seen across all turns. */
  allPairs: Array<{ entity: string; attribute: string }>;
  /** Factual errors that have NOT been corrected in a later turn. */
  activeErrors: Array<{ entity: string; claimed: string; acceptable: string[] }>;
  /** Factual errors that WERE corrected in a later turn. */
  correctedErrors: Array<{ entity: string; claimed: string; corrected: string }>;
  /** Indices of successCriteria that have been satisfied. */
  satisfiedCriteriaIndices: number[];
  /** Indices of successCriteria not yet satisfied. */
  missingCriteriaIndices: number[];
  /** Whether any turn contained a general on-topic claim without specifics. */
  hasGeneralClaim: boolean;
  /** Consecutive turns with no new evidence (resets on progress). */
  consecutiveNoProgressTurns: number;
  /** Total remediation turns so far. */
  totalRemediationTurns: number;
  /** Whether the evidence bar is fully met. */
  isComplete: boolean;
}

/** Teacher-facing summary for explanation sessions. */
export interface ExplanationTeacherSummary {
  status: "mastery" | "partial" | "minimal" | "no_evidence";
  renderedSummary: string;
  keyObservations: string[];
}

// ============================================================================
// Pattern constants
// ============================================================================

const UNCERTAINTY_PATTERNS = [
  /\bi\s+(?:still\s+|really\s+|just\s+)?(?:don'?t|do\s*not)\s+know\b/i,
  /\bno\s*idea\b/i,
  /\bi'?m\s*(?:still\s+)?(?:not\s*sure|confused|stuck|lost)\b/i,
  /\bi\s+(?:still\s+|really\s+)?(?:can'?t|cannot)\s+(?:do|figure|solve|get|think|remember)\b/i,
  /\bi\s*give\s*up\b/i,
  /^\s*(?:i\s*don'?t\s*know|idk|no|nope|um+|uh+)\s*[.!?]*\s*$/i,
];

const FRUSTRATION_PATTERNS = [
  /\b(?:this\s+is\s+(?:stupid|dumb|boring|hard|impossible))\b/i,
  /\bi\s+(?:hate|don'?t\s+(?:like|want|care))\s+(?:this|it)\b/i,
  /\b(?:stop|quit|leave\s+me\s+alone)\b/i,
  /\b(?:shut\s+up)\b/i,
];

const REFUSAL_PATTERNS = [
  /\b(?:move\s+on|skip\s+(?:this|it)|next\s+(?:one|question|problem))\b/i,
  /\bdon'?t\s+want\s+to\b/i,
];

const META_QUESTION_PATTERNS = [
  /\bwhat\s+(?:does|do|is)\s+['""]?[\w\s]+['""]?\s+mean\b/i,
  /\bwhat\s+(?:does|do)\s+you\s+mean\b/i,
  /\bi\s+don'?t\s+understand\s+the\s+question\b/i,
  /\bwhat\s+(?:are|is)\s+(?:you|we)\s+(?:asking|supposed|talking\s+about)\b/i,
];

const GENERAL_CLAIM_PATTERNS = [
  /\b(?:they'?re|they\s+are|it'?s|it\s+is|these\s+are|those\s+are)\s+(?:made\s+(?:of|from)|composed\s+of)\s+(?:different|many|various|lots\s+of|all\s+kinds)\b/i,
  /\b(?:there\s+are|you\s+(?:can|could)\s+find)\s+(?:different|many|various)\s+(?:kinds?|types?|sorts?)\b/i,
  /\b(?:each|every)\s+(?:one|planet|animal)\s+(?:is|has)\s+(?:different|its\s+own)\b/i,
];

// ============================================================================
// Phase 1: Evidence extraction + classification
// ============================================================================

/**
 * Classify student state for an explanation prompt.
 *
 * Priority order: no-speech → frustrated → meta-question → refusal/uncertain →
 * factual_error → complete → partial_evidence → claim_only → no_evidence.
 */
export function classifyExplanationState(
  studentResponse: string,
  validation: ValidationResult,
  accumulation: AccumulatedExplanationEvidence,
): ExplanationState {
  const trimmed = studentResponse.trim();

  // 1. No speech / empty
  if (!trimmed || trimmed.length < 2) {
    return "no_evidence";
  }

  // 2. Frustration — check before uncertainty (takes priority)
  if (FRUSTRATION_PATTERNS.some(p => p.test(trimmed))) {
    return "frustrated";
  }

  // 3. Meta-question — asking about the question itself
  if (META_QUESTION_PATTERNS.some(p => p.test(trimmed))) {
    return "meta_question";
  }

  // 4. Refusal — maps to uncertain for remediation purposes
  if (REFUSAL_PATTERNS.some(p => p.test(trimmed))) {
    return "uncertain";
  }

  // 5. Uncertainty
  if (UNCERTAINTY_PATTERNS.some(p => p.test(trimmed))) {
    return "uncertain";
  }

  // 6. Factual error — student made a wrong claim
  if (validation.hasFactualErrors) {
    return "factual_error";
  }

  // 7. Complete — all criteria satisfied across turns
  if (accumulation.isComplete) {
    return "complete";
  }

  // 8. Partial evidence — some criteria satisfied, more remain
  if (accumulation.satisfiedCriteriaIndices.length > 0 ||
      validation.extractedPairs.length > 0) {
    return "partial_evidence";
  }

  // 9. Claim only — general on-topic statement without specifics
  if (accumulation.hasGeneralClaim || hasGeneralClaim(trimmed)) {
    return "claim_only";
  }

  // 10. Default: no evidence
  return "no_evidence";
}

/**
 * Check if text contains a general claim without specific evidence.
 */
function hasGeneralClaim(text: string): boolean {
  return GENERAL_CLAIM_PATTERNS.some(p => p.test(text));
}

/**
 * Accumulate explanation evidence across conversation turns.
 *
 * A turn counts as progress ONLY if it:
 * - satisfies a new criterion
 * - adds a new correct entity-attribute pair
 * - corrects a prior factual error
 */
export function accumulateExplanationEvidence(
  currentValidation: ValidationResult,
  currentResponse: string,
  priorAccumulation: AccumulatedExplanationEvidence | null,
  requiredEvidence: RequiredEvidence,
  referenceFacts: Record<string, string[]>,
  successCriteria: string[],
  missingCriteria?: string[],
): AccumulatedExplanationEvidence {
  const prior = priorAccumulation ?? emptyAccumulation(successCriteria);

  // Merge entity-attribute pairs (deduplicate by entity)
  const seenEntities = new Set(prior.allPairs.map(p => p.entity));
  const newPairs: Array<{ entity: string; attribute: string }> = [];
  for (const pair of currentValidation.extractedPairs) {
    if (!seenEntities.has(pair.entity)) {
      // Check this isn't an incorrect pair
      const isIncorrect = currentValidation.incorrectPairs.some(
        ip => ip.entity === pair.entity
      );
      if (!isIncorrect) {
        newPairs.push(pair);
        seenEntities.add(pair.entity);
      }
    }
  }
  const allPairs = [...prior.allPairs, ...newPairs];

  // Check for corrected errors: a prior error whose entity now has a correct pair
  const correctedErrors = [...prior.correctedErrors];
  const activeErrors: Array<{ entity: string; claimed: string; acceptable: string[] }> = [];

  for (const err of prior.activeErrors) {
    const nowCorrect = currentValidation.extractedPairs.some(
      p => p.entity === err.entity &&
        !currentValidation.incorrectPairs.some(ip => ip.entity === p.entity)
    );
    if (nowCorrect) {
      const correctAttr = currentValidation.extractedPairs.find(
        p => p.entity === err.entity
      )?.attribute ?? err.acceptable[0];
      correctedErrors.push({ entity: err.entity, claimed: err.claimed, corrected: correctAttr });
    } else {
      activeErrors.push(err);
    }
  }

  // Add new errors from this turn
  for (const ip of currentValidation.incorrectPairs) {
    const alreadyTracked = activeErrors.some(e => e.entity === ip.entity) ||
      correctedErrors.some(e => e.entity === ip.entity);
    if (!alreadyTracked) {
      activeErrors.push(ip);
    }
  }

  // Rebuild satisfied/missing criteria using the accumulated evidence
  const accumulatedText = currentResponse; // validation is already cumulative in coach.ts
  const checklist = buildEvidenceChecklist(
    // Build a synthetic validation from accumulated pairs
    {
      ...currentValidation,
      matchedEntities: Array.from(new Set([
        ...allPairs.map(p => p.entity),
        ...currentValidation.matchedEntities,
      ])),
      extractedPairs: allPairs,
      incorrectPairs: activeErrors,
      meetsEvidenceBar: allPairs.length >= requiredEvidence.minEntities &&
        activeErrors.length === 0 &&
        new Set(allPairs.map(p => p.attribute)).size >= (requiredEvidence.minAttributeTypes ?? 1),
    },
    requiredEvidence,
    referenceFacts,
    successCriteria,
    missingCriteria,
  );

  const satisfiedCriteriaIndices: number[] = [];
  const missingCriteriaIndices: number[] = [];
  checklist.forEach((item, i) => {
    if (item.satisfied) {
      satisfiedCriteriaIndices.push(i);
    } else {
      missingCriteriaIndices.push(i);
    }
  });

  // Determine progress
  const hadNewPairs = newPairs.length > 0;
  const hadNewCriteria = satisfiedCriteriaIndices.some(
    i => !prior.satisfiedCriteriaIndices.includes(i)
  );
  const hadCorrectedError = correctedErrors.length > prior.correctedErrors.length;
  const madeProgress = hadNewPairs || hadNewCriteria || hadCorrectedError;

  const hasGeneralClaimFlag = prior.hasGeneralClaim || hasGeneralClaim(currentResponse);

  // Check completeness: evidence bar met (entity-attribute thresholds) + no factual errors.
  // This is independent of concept criteria which require LLM evaluation.
  const evidenceBarMet = allPairs.length >= requiredEvidence.minEntities &&
    activeErrors.length === 0 &&
    new Set(allPairs.map(p => p.attribute)).size >= (requiredEvidence.minAttributeTypes ?? 1);
  const isComplete = evidenceBarMet;

  return {
    allPairs,
    activeErrors,
    correctedErrors,
    satisfiedCriteriaIndices,
    missingCriteriaIndices,
    hasGeneralClaim: hasGeneralClaimFlag,
    // Only count no-progress after at least one remediation turn has happened.
    // The first student response is the initial attempt, not a "no-progress" turn.
    consecutiveNoProgressTurns: madeProgress ? 0
      : (prior.totalRemediationTurns > 0 ? prior.consecutiveNoProgressTurns + 1 : 0),
    totalRemediationTurns: prior.totalRemediationTurns + 1,
    isComplete,
  };
}

/**
 * Create an empty accumulation for the first turn.
 */
export function emptyAccumulation(successCriteria: string[]): AccumulatedExplanationEvidence {
  return {
    allPairs: [],
    activeErrors: [],
    correctedErrors: [],
    satisfiedCriteriaIndices: [],
    missingCriteriaIndices: successCriteria.map((_, i) => i),
    hasGeneralClaim: false,
    consecutiveNoProgressTurns: 0,
    totalRemediationTurns: 0,
    isComplete: false,
  };
}

// ============================================================================
// Variant pools — deterministic phrasing variation
// ============================================================================

/** Pick a variant from a pool using turnIndex, avoiding the previous opening. */
function pickExplVariant(
  pool: readonly string[],
  turnIndex: number,
  lastCoachText: string | null,
): string {
  const idx = turnIndex % pool.length;
  const candidate = pool[idx];
  if (lastCoachText) {
    const prevWords = lastCoachText.split(/\s+/).slice(0, 4).join(" ").toLowerCase();
    const candidateWords = candidate.split(/\s+/).slice(0, 4).join(" ").toLowerCase();
    if (prevWords === candidateWords && pool.length > 1) {
      return pool[(idx + 1) % pool.length];
    }
  }
  return candidate;
}

const ENCOURAGEMENT_OPENINGS = [
  "Can you name one",           // "Can you name one planet and tell me about it?"
  "Think of one",               // "Think of one planet and tell me about it."
  "What's one",                 // "What's one planet you know about?"
  "Let's start with one",      // "Let's start with one planet. What do you know?"
] as const;

const HINT_STEMS = [
  "Here's a hint:",
  "Let me give you a clue:",
  "Try thinking about it this way:",
  "Here's something to help:",
] as const;

const MODEL_OPENINGS = [
  "For example,",              // "For example, Mercury is made of rock..."
  "Here's how it works:",      // "Here's how it works: Mercury is made of rock..."
  "Let me show you:",          // "Let me show you: Mercury is made of rock..."
  "I'll give you an example:", // "I'll give you an example: Mercury is made of rock..."
] as const;

const UNCERTAIN_ENCOURAGEMENTS = [
  "No worries!",
  "That's okay!",
  "It's all right!",
  "Don't worry!",
] as const;

const SPECIFICITY_OPENINGS = [
  "Can you name a specific",
  "What's a specific",
  "Tell me about one",
  "Which one do you know about?",
] as const;

function getLastCoachText(
  history?: Array<{ role: string; message: string }>,
): string | null {
  if (!history) return null;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "coach") return history[i].message;
  }
  return null;
}

// ============================================================================
// Phase 2: Remediation moves
// ============================================================================

/**
 * Select the next remediation move for an explanation prompt.
 *
 * Returns null if no deterministic move is appropriate (fall back to LLM).
 */
export function getExplanationRemediationMove(
  state: ExplanationState,
  accumulation: AccumulatedExplanationEvidence,
  validation: ValidationResult,
  requiredEvidence: RequiredEvidence,
  referenceFacts: Record<string, string[]>,
  successCriteria: string[],
  promptInput: string,
  hints?: string[],
  conversationHistory?: Array<{ role: string; message: string }>,
): ExplanationMove | null {
  // Extract last coach text for same-opening guard
  const lastCoachText = getLastCoachText(conversationHistory);

  // Complete → wrap mastery
  if (state === "complete") {
    return {
      type: "WRAP_MASTERY",
      text: "",
      state,
      explanation: "All criteria satisfied with no factual errors.",
    };
  }

  // Frustrated → wrap support immediately
  if (state === "frustrated") {
    return {
      type: "WRAP_SUPPORT",
      text: "",
      state,
      explanation: "Student expressed frustration or disengagement.",
    };
  }

  // Meta-question → clarification + re-ask
  if (state === "meta_question") {
    const simplifiedQuestion = simplifyPromptInput(promptInput);
    return {
      type: "CLARIFICATION",
      text: simplifiedQuestion,
      state,
      explanation: "Student asked about the question itself.",
    };
  }

  // Build checklist for probe generation
  const checklist = buildEvidenceChecklist(
    {
      ...validation,
      matchedEntities: Array.from(new Set([
        ...accumulation.allPairs.map(p => p.entity),
        ...validation.matchedEntities,
      ])),
      extractedPairs: accumulation.allPairs,
      incorrectPairs: accumulation.activeErrors,
      meetsEvidenceBar: accumulation.isComplete,
    },
    requiredEvidence,
    referenceFacts,
    successCriteria,
  );

  const noProgressCount = accumulation.consecutiveNoProgressTurns;

  // Uncertain → escalation ladder
  if (state === "uncertain") {
    return buildUncertainMove(noProgressCount, checklist, requiredEvidence, referenceFacts, hints, promptInput, accumulation.totalRemediationTurns, lastCoachText);
  }

  // Factual error → correction + probe
  if (state === "factual_error") {
    const correctionText = buildFactualCorrectionResponse(
      validation.incorrectPairs,
      requiredEvidence,
      checklist,
    );
    return {
      type: "FACTUAL_CORRECTION",
      text: correctionText,
      state,
      targetCriterion: validation.incorrectPairs[0]?.entity,
      explanation: `Factual error: ${validation.incorrectPairs.map(p => `${p.entity}≠${p.claimed}`).join(", ")}.`,
    };
  }

  // Claim only → specificity probe
  if (state === "claim_only") {
    if (noProgressCount >= 2) {
      // Escalate: give a hint
      return buildHintMove(checklist, requiredEvidence, referenceFacts, hints, promptInput, accumulation.totalRemediationTurns, lastCoachText);
    }
    const probe = buildVariedEvidenceProbe(
      checklist, requiredEvidence, referenceFacts, accumulation.totalRemediationTurns, lastCoachText,
    ) ?? buildSpecificityFallback(requiredEvidence, accumulation.totalRemediationTurns, lastCoachText);
    return {
      type: "SPECIFICITY_PROBE",
      text: probe,
      state,
      explanation: "Student made a general claim without specific examples.",
    };
  }

  // Partial evidence → probe or escalate
  if (state === "partial_evidence") {
    // Third consecutive no-progress turn → model-and-ask
    if (noProgressCount >= 3) {
      return buildModelAndAskMove(checklist, requiredEvidence, referenceFacts, accumulation.totalRemediationTurns, lastCoachText);
    }
    // Second consecutive no-progress turn → hint
    if (noProgressCount >= 2) {
      return buildHintMove(checklist, requiredEvidence, referenceFacts, hints, promptInput, accumulation.totalRemediationTurns, lastCoachText);
    }
    // Default: evidence probe for next missing criterion
    const probe = buildVariedEvidenceProbe(
      checklist, requiredEvidence, referenceFacts, accumulation.totalRemediationTurns, lastCoachText,
    );
    if (probe) {
      const missingItem = checklist.find(i => !i.satisfied);
      return {
        type: "EVIDENCE_PROBE",
        text: probe,
        state,
        targetCriterion: missingItem?.label,
        explanation: `Probing for missing evidence: ${missingItem?.label ?? "unknown"}.`,
      };
    }
    return null;
  }

  // No evidence → encouragement probe or escalate
  if (state === "no_evidence") {
    if (noProgressCount >= 2) {
      return buildHintMove(checklist, requiredEvidence, referenceFacts, hints, promptInput, accumulation.totalRemediationTurns, lastCoachText);
    }
    const probe = buildEncouragementProbe(requiredEvidence, promptInput, accumulation.totalRemediationTurns, lastCoachText);
    return {
      type: "ENCOURAGEMENT_PROBE",
      text: probe,
      state,
      explanation: "No evidence detected — encouraging student to begin.",
    };
  }

  return null;
}

// ============================================================================
// Move builders (internal)
// ============================================================================

function buildUncertainMove(
  noProgressCount: number,
  checklist: EvidenceChecklistItem[],
  requiredEvidence: RequiredEvidence,
  referenceFacts: Record<string, string[]>,
  hints?: string[],
  promptInput?: string,
  turnIndex?: number,
  lastCoachText?: string | null,
): ExplanationMove {
  const ti = turnIndex ?? 0;
  const lct = lastCoachText ?? null;
  // 3rd+ uncertain → model-and-ask or wrap
  if (noProgressCount >= 3) {
    return buildModelAndAskMove(checklist, requiredEvidence, referenceFacts, ti, lct);
  }
  // 2nd uncertain → hint
  if (noProgressCount >= 1) {
    return buildHintMove(checklist, requiredEvidence, referenceFacts, hints, promptInput, ti, lct);
  }
  // 1st uncertain → encouragement with varied opening
  const opening = pickExplVariant(UNCERTAIN_ENCOURAGEMENTS, ti, lct);
  const probe = buildEncouragementProbe(requiredEvidence, promptInput ?? "", ti, lct);
  return {
    type: "ENCOURAGEMENT_PROBE",
    text: `${opening} ${probe}`,
    state: "uncertain",
    explanation: "First uncertain turn — encouraging re-entry.",
  };
}

function buildHintMove(
  checklist: EvidenceChecklistItem[],
  requiredEvidence: RequiredEvidence,
  referenceFacts: Record<string, string[]>,
  hints?: string[],
  promptInput?: string,
  turnIndex?: number,
  lastCoachText?: string | null,
): ExplanationMove {
  const ti = turnIndex ?? 0;
  const lct = lastCoachText ?? null;
  const stem = pickExplVariant(HINT_STEMS, ti, lct);

  // Use authored hint if available
  if (hints && hints.length > 0) {
    const missingProbe = buildMissingEvidenceProbe(checklist, requiredEvidence, referenceFacts);
    const text = missingProbe
      ? `${stem} ${hints[0]} ${missingProbe}`
      : `${stem} ${hints[0]}`;
    return {
      type: "HINT",
      text,
      state: "uncertain",
      explanation: "Escalated to hint after repeated no-progress turns.",
    };
  }

  // Generate a hint from referenceFacts — reveal one entity-attribute pair
  const entities = Object.keys(referenceFacts);
  if (entities.length > 0) {
    const firstEntity = entities[0];
    const firstAttr = referenceFacts[firstEntity][0];
    const probe = buildMissingEvidenceProbe(checklist, requiredEvidence, referenceFacts)
      ?? `What about another ${requiredEvidence.entityLabel.replace(/s$/, "")}?`;
    return {
      type: "HINT",
      text: `${stem} ${firstEntity} is ${firstAttr}. ${probe}`,
      state: "uncertain",
      explanation: `Hint: revealed ${firstEntity}=${firstAttr}, probing for next.`,
    };
  }

  return {
    type: "HINT",
    text: "Think about a specific example you know.",
    state: "uncertain",
    explanation: "Generic hint — no referenceFacts available for specific hint.",
  };
}

function buildModelAndAskMove(
  checklist: EvidenceChecklistItem[],
  requiredEvidence: RequiredEvidence,
  referenceFacts: Record<string, string[]>,
  turnIndex?: number,
  lastCoachText?: string | null,
): ExplanationMove {
  const ti = turnIndex ?? 0;
  const lct = lastCoachText ?? null;
  const entities = Object.keys(referenceFacts);
  if (entities.length >= 2) {
    const e1 = entities[0];
    const a1 = referenceFacts[e1][0];
    const e2 = entities[1];
    const a2 = referenceFacts[e2][0];

    // Find a third entity to ask about, if available
    const remaining = entities.filter(e => e !== e1 && e !== e2);
    const askAbout = remaining.length > 0
      ? `What about ${remaining[0]}?`
      : `What about another ${requiredEvidence.entityLabel.replace(/s$/, "")}?`;

    const opening = pickExplVariant(MODEL_OPENINGS, ti, lct);
    return {
      type: "MODEL_AND_ASK",
      text: `${opening} ${e1} is made of ${a1} and ${e2} is made of ${a2}. ${askAbout}`,
      state: "uncertain",
      explanation: `Modeled ${e1}=${a1} and ${e2}=${a2}, asking about remaining entity.`,
    };
  }

  return {
    type: "WRAP_SUPPORT",
    text: "",
    state: "uncertain",
    explanation: "Cannot model — insufficient referenceFacts. Wrapping.",
  };
}

/**
 * Vary wording, not instructional priority.
 * Always probe the highest-priority missing evidence item unless
 * new student evidence changes the checklist ordering.
 *
 * Avoids identical consecutive wording by alternating phrasing
 * templates based on turnIndex (even / odd).
 */
const ENTITY_PROBE_POOL = [
  (entity: string) => `What is ${entity} made of?`,
  (entity: string) => `Tell me about ${entity}. What is it made of?`,
  (entity: string) => `What do you know about ${entity}?`,
  (entity: string) => `How about ${entity}? What is it made of?`,
] as const;

const GENERIC_ENTITY_PROBE_POOL = [
  (s: string, a: string) => `Can you name another ${s} and describe its ${a}?`,
  (s: string, a: string) => `What's another ${s} you know? What is it made of?`,
  (s: string, a: string) => `Tell me about a different ${s}. What is it made of?`,
  (s: string, a: string) => `What other ${s} can you think of?`,
] as const;

function buildVariedEvidenceProbe(
  checklist: EvidenceChecklistItem[],
  requiredEvidence: RequiredEvidence,
  referenceFacts: Record<string, string[]>,
  turnIndex: number,
  lastCoachText?: string | null,
): string | null {
  const missing = checklist.filter(item => !item.satisfied);
  if (missing.length === 0) return null;

  // Always target the first (highest-priority) missing item.
  const target = missing[0];
  const entityNames = Object.keys(referenceFacts);
  const singularLabel = requiredEvidence.entityLabel.replace(/s$/, "");

  if (target.type === "entity_attribute") {
    const matchedEntity = entityNames.find(name =>
      target.label.toLowerCase().startsWith(name.toLowerCase()),
    );
    if (matchedEntity) {
      const pool = ENTITY_PROBE_POOL.map(fn => fn(matchedEntity));
      return pickExplVariant(pool, turnIndex, lastCoachText ?? null);
    }
    // Generic — use varied pool
    const pool = GENERIC_ENTITY_PROBE_POOL.map(fn => fn(singularLabel, requiredEvidence.attributeLabel));
    return pickExplVariant(pool, turnIndex, lastCoachText ?? null);
  }

  // Concept criterion — varied pool
  const pool = [
    `Can you name a specific ${singularLabel}?`,
    `What ${singularLabel} can you think of?`,
    `Tell me one ${singularLabel} you know.`,
    `Which ${singularLabel} comes to mind?`,
  ];
  return pickExplVariant(pool, turnIndex, lastCoachText ?? null);
}

function buildEncouragementProbe(
  requiredEvidence: RequiredEvidence,
  promptInput: string,
  turnIndex?: number,
  lastCoachText?: string | null,
): string {
  const entityLabel = requiredEvidence.entityLabel.replace(/s$/, "");
  const ti = turnIndex ?? 0;
  const lct = lastCoachText ?? null;
  const pool = ENCOURAGEMENT_OPENINGS.map(o => `${o} ${entityLabel} and tell me about it?`);
  return pickExplVariant(pool, ti, lct);
}

function buildSpecificityFallback(
  requiredEvidence: RequiredEvidence,
  turnIndex: number,
  lastCoachText: string | null,
): string {
  const entityLabel = requiredEvidence.entityLabel.replace(/s$/, "");
  const pool = SPECIFICITY_OPENINGS.map(o =>
    o.endsWith("?") ? o.replace(/\?$/, ` ${entityLabel}?`) : `${o} ${entityLabel}?`
  );
  return pickExplVariant(pool, turnIndex, lastCoachText);
}

function simplifyPromptInput(promptInput: string): string {
  // Extract the core question for clarification
  const firstSentence = promptInput.split(/[.?!]/)[0].trim();
  const simplified = firstSentence.length > 60
    ? firstSentence.slice(0, 57) + "..."
    : firstSentence;
  return `Good question! ${simplified}? What do you think?`;
}

// ============================================================================
// Phase 3: Wrap policy
// ============================================================================

/**
 * Determine whether to wrap or continue an explanation session.
 *
 * Priority-ordered rules — first match wins.
 */
export function shouldWrapExplanation(
  state: ExplanationState,
  accumulation: AccumulatedExplanationEvidence,
  timeRemainingSec: number | null,
  attemptCount: number,
  maxAttempts: number,
): ExplanationWrapDecision {
  // 1. All criteria satisfied + no factual errors → wrap_mastery
  if (accumulation.isComplete) {
    return { action: "wrap_mastery", reason: "all_criteria_satisfied" };
  }

  // 2. Explicit stop/refusal → wrap_support immediately
  if (state === "frustrated") {
    return { action: "wrap_support", reason: "frustrated_or_disengaged" };
  }

  // 3. Time expired
  if (timeRemainingSec !== null && timeRemainingSec < 15) {
    return { action: "wrap_support", reason: "time_expired" };
  }

  // 4. Max attempts + no new evidence in last 2 turns
  if (attemptCount >= maxAttempts && accumulation.consecutiveNoProgressTurns >= 2) {
    return { action: "wrap_support", reason: "max_attempts_no_progress" };
  }

  // 5. Partial/claim_only/factual_error with time remaining → continue
  if (
    (state === "partial_evidence" || state === "claim_only" || state === "factual_error") &&
    (timeRemainingSec === null || timeRemainingSec >= 15)
  ) {
    return { action: "continue_probing", reason: "evidence_incomplete_time_remaining" };
  }

  // 6. No new evidence after 3 consecutive remediation turns
  if (accumulation.consecutiveNoProgressTurns >= 3) {
    return { action: "wrap_support", reason: "no_progress_3_consecutive_turns" };
  }

  // 7. Missing criteria exist → continue
  if (accumulation.missingCriteriaIndices.length > 0) {
    return { action: "continue_probing", reason: "missing_criteria_exist" };
  }

  // 8. Default: no missing criteria, no mastery signal
  return { action: "wrap_support", reason: "no_missing_criteria_no_mastery" };
}

// ============================================================================
// Phase 4: Teacher summary
// ============================================================================

/**
 * Build a teacher-facing summary for an explanation session.
 */
export function buildExplanationTeacherSummary(
  accumulation: AccumulatedExplanationEvidence,
  requiredEvidence: RequiredEvidence,
  referenceFacts: Record<string, string[]>,
  successCriteria: string[],
  learningObjective?: string,
): ExplanationTeacherSummary {
  const topic = learningObjective ?? "the topic";
  const entityLabel = requiredEvidence.entityLabel;

  // Complete
  if (accumulation.isComplete) {
    const entityList = accumulation.allPairs.map(p => p.entity).join(", ");
    const attrList = Array.from(new Set(accumulation.allPairs.map(p => p.attribute))).join(", ");
    let summary = `Student demonstrated understanding by naming ${entityList} and describing their ${requiredEvidence.attributeLabel} (${attrList}).`;
    const observations: string[] = [`Named ${accumulation.allPairs.length} ${entityLabel} with correct ${requiredEvidence.attributeLabel}.`];

    if (accumulation.correctedErrors.length > 0) {
      const corrections = accumulation.correctedErrors
        .map(e => `initially said ${e.entity} was ${e.claimed} but corrected to ${e.corrected}`)
        .join("; ");
      summary += ` ${corrections.charAt(0).toUpperCase() + corrections.slice(1)}.`;
      observations.push("Self-corrected factual errors during the session.");
    }

    return { status: "mastery", renderedSummary: summary, keyObservations: observations };
  }

  // Partial evidence
  if (accumulation.allPairs.length > 0) {
    const entityList = accumulation.allPairs.map(p => p.entity).join(", ");
    const totalNeeded = requiredEvidence.minEntities;
    let summary = `Student named ${accumulation.allPairs.length} of ${totalNeeded} required ${entityLabel} (${entityList}).`;

    const observations: string[] = [];

    if (accumulation.activeErrors.length > 0) {
      const errList = accumulation.activeErrors
        .map(e => `said ${e.entity} is ${e.claimed} (should be ${e.acceptable.join("/")})`)
        .join("; ");
      summary += ` Factual error: ${errList}.`;
      observations.push("Has uncorrected factual errors.");
    }

    if (accumulation.missingCriteriaIndices.length > 0) {
      observations.push(`${accumulation.missingCriteriaIndices.length} criteria still unmet.`);
    }

    return { status: "partial", renderedSummary: summary, keyObservations: observations };
  }

  // Factual errors only (mentioned entities but all attributes wrong)
  if (accumulation.activeErrors.length > 0) {
    const errList = accumulation.activeErrors
      .map(e => `described ${e.entity} as ${e.claimed} (should be ${e.acceptable.join("/")})`)
      .join("; ");
    return {
      status: "partial",
      renderedSummary: `Student provided incorrect information: ${errList}.`,
      keyObservations: ["Has uncorrected factual errors.", "No correct entity-attribute pairs."],
    };
  }

  // Claim only
  if (accumulation.hasGeneralClaim) {
    return {
      status: "minimal",
      renderedSummary: `Student made a general statement about ${topic} but did not provide specific examples or ${entityLabel}.`,
      keyObservations: ["General claim without specific evidence."],
    };
  }

  // No evidence
  return {
    status: "no_evidence",
    renderedSummary: `Student did not provide evidence related to ${topic}.`,
    keyObservations: ["No relevant evidence detected."],
  };
}

// ============================================================================
// Feature gate
// ============================================================================

/**
 * Returns true when the deterministic explanation path should be used.
 *
 * Requires: requiredEvidence + referenceFacts + successCriteria on the prompt,
 * and NO mathProblem.
 */
export function shouldUseExplanationRemediation(prompt: {
  mathProblem?: unknown;
  assessment?: {
    requiredEvidence?: RequiredEvidence;
    referenceFacts?: Record<string, string[]>;
    successCriteria?: string[];
  };
}): boolean {
  if (prompt.mathProblem) return false;
  if (!prompt.assessment?.requiredEvidence) return false;
  if (!prompt.assessment?.referenceFacts) return false;
  if (!prompt.assessment?.successCriteria?.length) return false;
  return true;
}
