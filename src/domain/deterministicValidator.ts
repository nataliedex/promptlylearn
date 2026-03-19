/**
 * Deterministic factual validation layer.
 *
 * Extracts named entities and paired attributes from student text,
 * checks them against prompt-specific referenceFacts, and produces
 * a bounding decision that can upgrade or downgrade the LLM's scoring.
 *
 * Pure functions — no LLM calls, no side effects.
 */

import { RequiredEvidence } from "./prompt";

// ============================================================================
// Types
// ============================================================================

export interface ValidationResult {
  /** Entities the student named that exist in referenceFacts keys. */
  matchedEntities: string[];
  /** Entity-attribute pairs extracted from student text. */
  extractedPairs: Array<{ entity: string; attribute: string }>;
  /** Pairs where the attribute contradicts referenceFacts. */
  incorrectPairs: Array<{ entity: string; claimed: string; acceptable: string[] }>;
  /** Distinct normalized attribute types found (e.g., ["rock", "gas"]). */
  distinctAttributeTypes: string[];
  /** Whether the student meets the requiredEvidence thresholds for "strong". */
  meetsEvidenceBar: boolean;
  /** Whether the student has factual errors that should cap at "developing". */
  hasFactualErrors: boolean;
  /** Whether the response is off-topic (no relevant entities or attributes). */
  isOffTopic: boolean;
}

export type OverallStatus = "strong" | "developing" | "needs_support";

export interface BoundingDecision {
  /** The bounded overallStatus. */
  boundedStatus: OverallStatus;
  /** The bounded numeric score. */
  boundedScore: number;
  /** Whether the score/status was changed. */
  wasAdjusted: boolean;
  /** Direction of adjustment. */
  direction: "upgrade" | "downgrade" | "none";
  /** Reason for the adjustment (for logging). */
  reason: string;
}

// ============================================================================
// Built-in attribute alias table
// ============================================================================

/**
 * Common science attribute aliases. Maps regex patterns to canonical labels.
 * This covers the most common K-5 science domains. Extend as needed.
 */
const BUILT_IN_ALIASES: Array<{ pattern: RegExp; canonical: string }> = [
  { pattern: /^rock(?:y|s)?$/i, canonical: "rock" },
  { pattern: /^stone$/i, canonical: "rock" },
  { pattern: /^solid$/i, canonical: "rock" },
  { pattern: /^silicon$/i, canonical: "rock" },
  { pattern: /^metal$/i, canonical: "metal" },
  { pattern: /^iron$/i, canonical: "metal" },
  { pattern: /^gas(?:eous|es)?$/i, canonical: "gas" },
  { pattern: /^hydrogen$/i, canonical: "gas" },
  { pattern: /^helium$/i, canonical: "gas" },
  { pattern: /^ic[ey]$/i, canonical: "ice" },
  { pattern: /^frozen$/i, canonical: "ice" },
  { pattern: /^methane$/i, canonical: "ice" },
  { pattern: /^ammonia$/i, canonical: "ice" },
  { pattern: /^liquid$/i, canonical: "liquid" },
  { pattern: /^water$/i, canonical: "liquid" },
  { pattern: /^dust$/i, canonical: "rock" },
  { pattern: /^dirt$/i, canonical: "rock" },
  { pattern: /^soil$/i, canonical: "rock" },
];

// ============================================================================
// Attribute normalization
// ============================================================================

/**
 * Build a lookup of all acceptable attribute words from referenceFacts values.
 * Returns a Set of canonical labels that appear in the facts.
 */
export function collectCanonicalAttributes(
  referenceFacts: Record<string, string[]>
): Set<string> {
  const labels = new Set<string>();
  for (const values of Object.values(referenceFacts)) {
    for (const v of values) {
      labels.add(v.toLowerCase());
    }
  }
  return labels;
}

/**
 * Normalize a raw word to a canonical attribute label.
 * First checks the built-in alias table, then checks if the word itself
 * is a canonical label in the referenceFacts.
 */
export function normalizeAttribute(
  raw: string,
  canonicalLabels: Set<string>
): string | null {
  const lower = raw.toLowerCase();

  // Check built-in aliases first
  for (const alias of BUILT_IN_ALIASES) {
    if (alias.pattern.test(lower)) return alias.canonical;
  }

  // Check if the raw word is itself a canonical label
  if (canonicalLabels.has(lower)) return lower;

  return null;
}

// ============================================================================
// Entity extraction
// ============================================================================

/**
 * Extract entity names from student text by matching against referenceFacts keys.
 * Case-insensitive word-boundary matching. Returns deduplicated canonical names.
 */
export function extractEntities(
  text: string,
  referenceFacts: Record<string, string[]>
): string[] {
  const matched = new Set<string>();
  const lower = text.toLowerCase();

  for (const entityName of Object.keys(referenceFacts)) {
    const pattern = new RegExp(buildEntityMatchPattern(entityName), "i");
    if (pattern.test(lower)) {
      matched.add(entityName);
    }
  }

  return Array.from(matched);
}

// ============================================================================
// Entity-attribute pair extraction
// ============================================================================

/** Linking verbs that connect entities to attributes. */
const LINKING_PATTERNS = /(?:is|are|was|were)\s+(?:made\s+(?:of|from|out\s+of)|composed\s+of|mostly|mainly|primarily)|(?:made\s+(?:of|from|out\s+of)|composed\s+of)/i;

/**
 * Extract entity-attribute pairs from student text using referenceFacts
 * as the source of entity names and attribute vocabulary.
 *
 * Two-pass approach:
 *   1. Proximity: find "entity ... linking verb ... attribute" within a clause.
 *   2. Segment fallback: split at "and" / "," and match entity + nearest attribute.
 */
export function extractEntityAttributePairs(
  text: string,
  referenceFacts: Record<string, string[]>
): Array<{ entity: string; attribute: string }> {
  const canonicalLabels = collectCanonicalAttributes(referenceFacts);
  const entityNames = Object.keys(referenceFacts);
  const pairs: Array<{ entity: string; attribute: string }> = [];
  const seenEntities = new Set<string>();

  // Build a regex for all attribute words (built-in aliases + canonical labels)
  const allAttributeWords = new Set<string>();
  for (const alias of BUILT_IN_ALIASES) {
    // Extract word from regex pattern (e.g., /^rock(?:y|s)?$/i -> "rock")
    // We'll match against individual words, so add common forms
    allAttributeWords.add(alias.canonical);
  }
  for (const label of canonicalLabels) {
    allAttributeWords.add(label);
  }

  // Pass 1: Proximity-based extraction
  for (const entityName of entityNames) {
    if (seenEntities.has(entityName)) continue;
    const entityPattern = new RegExp(
      `\\b${entityInflectionFragment(entityName)}\\b([^.?!]{0,50}?)\\b(${Array.from(getAllAttributeWords()).join("|")})\\b`,
      "ig"
    );
    let match;
    while ((match = entityPattern.exec(text)) !== null) {
      const middleText = match[1];
      // Only accept if there's a linking pattern in between
      if (LINKING_PATTERNS.test(middleText) || /made\s+of/i.test(middleText)) {
        const rawAttr = match[2];
        const normalized = normalizeAttribute(rawAttr, canonicalLabels);
        if (normalized && !seenEntities.has(entityName)) {
          seenEntities.add(entityName);
          pairs.push({ entity: entityName, attribute: normalized });
        }
      }
    }
  }

  // Pass 2: Segment fallback
  const segments = text.split(/\band\b|,/i).map(s => s.trim());
  for (const seg of segments) {
    const segLower = seg.toLowerCase();
    for (const entityName of entityNames) {
      if (seenEntities.has(entityName)) continue;
      if (!new RegExp(buildEntityMatchPattern(entityName), "i").test(segLower)) continue;

      // Find the nearest attribute word in this segment
      const words = segLower.split(/\s+/);
      for (const word of words) {
        const cleaned = word.replace(/[^a-z]/g, "");
        if (!cleaned) continue;
        const normalized = normalizeAttribute(cleaned, canonicalLabels);
        if (normalized) {
          seenEntities.add(entityName);
          pairs.push({ entity: entityName, attribute: normalized });
          break;
        }
      }
    }
  }

  return pairs;
}

/**
 * Get all attribute words (raw forms) that we should look for in student text.
 */
function getAllAttributeWords(): Set<string> {
  const words = new Set<string>();
  // Common forms from built-in aliases
  const forms = [
    "rock", "rocky", "rocks", "stone", "solid", "silicon", "dust", "dirt", "soil",
    "metal", "iron",
    "gas", "gaseous", "gases", "hydrogen", "helium",
    "ice", "icy", "frozen", "methane", "ammonia",
    "liquid", "water",
  ];
  for (const f of forms) words.add(f);
  return words;
}

// ============================================================================
// Incorrect pair detection
// ============================================================================

/**
 * Check extracted pairs against referenceFacts ground truth.
 * Returns pairs where the attribute contradicts the acceptable values.
 */
export function findIncorrectPairs(
  pairs: Array<{ entity: string; attribute: string }>,
  referenceFacts: Record<string, string[]>
): Array<{ entity: string; claimed: string; acceptable: string[] }> {
  const incorrect: Array<{ entity: string; claimed: string; acceptable: string[] }> = [];

  for (const pair of pairs) {
    const acceptable = referenceFacts[pair.entity];
    if (!acceptable) continue;

    const acceptableLower = acceptable.map(a => a.toLowerCase());
    if (!acceptableLower.includes(pair.attribute.toLowerCase())) {
      incorrect.push({
        entity: pair.entity,
        claimed: pair.attribute,
        acceptable,
      });
    }
  }

  return incorrect;
}

// ============================================================================
// Main validation function
// ============================================================================

/**
 * Run deterministic validation against student text.
 *
 * Extracts entities and attributes, checks them against referenceFacts,
 * and evaluates whether the requiredEvidence thresholds are met.
 */
export function validate(
  text: string,
  requiredEvidence: RequiredEvidence,
  referenceFacts: Record<string, string[]>
): ValidationResult {
  const canonicalLabels = collectCanonicalAttributes(referenceFacts);
  const matchedEntities = extractEntities(text, referenceFacts);
  const extractedPairs = extractEntityAttributePairs(text, referenceFacts);
  const incorrectPairs = findIncorrectPairs(extractedPairs, referenceFacts);

  // Distinct attribute types from correct pairs only
  const correctPairs = extractedPairs.filter(
    p => !incorrectPairs.some(ip => ip.entity === p.entity)
  );
  const distinctAttributeTypes = Array.from(
    new Set(correctPairs.map(p => p.attribute))
  );

  // Check if any attribute words appear at all (even without entity pairing)
  const hasAnyAttributeWord = hasAttributeWords(text, canonicalLabels);

  // Off-topic: no entities AND no attribute words at all
  const isOffTopic = matchedEntities.length === 0 && !hasAnyAttributeWord;

  // Evidence bar evaluation
  const hasEnoughEntities = matchedEntities.length >= requiredEvidence.minEntities;
  const hasEnoughAttributeTypes = requiredEvidence.minAttributeTypes
    ? distinctAttributeTypes.length >= requiredEvidence.minAttributeTypes
    : true;
  const requirePairing = requiredEvidence.requirePairing !== false;
  const allPairedCorrectly = requirePairing
    ? correctPairs.length >= requiredEvidence.minEntities
    : true;
  const hasFactualErrors = incorrectPairs.length > 0;

  const meetsEvidenceBar =
    hasEnoughEntities &&
    hasEnoughAttributeTypes &&
    allPairedCorrectly &&
    !hasFactualErrors;

  return {
    matchedEntities,
    extractedPairs,
    incorrectPairs,
    distinctAttributeTypes,
    meetsEvidenceBar,
    hasFactualErrors,
    isOffTopic,
  };
}

/**
 * Check if the text contains any attribute words at all.
 */
function hasAttributeWords(text: string, canonicalLabels: Set<string>): boolean {
  const words = text.toLowerCase().split(/\s+/);
  for (const word of words) {
    const cleaned = word.replace(/[^a-z]/g, "");
    if (!cleaned) continue;
    if (normalizeAttribute(cleaned, canonicalLabels) !== null) return true;
  }
  return false;
}

// ============================================================================
// Score bounding
// ============================================================================

const STATUS_RANK: Record<OverallStatus, number> = {
  needs_support: 0,
  developing: 1,
  strong: 2,
};

/**
 * Bound the LLM's scoring based on deterministic validation.
 *
 * Rules:
 * - Off-topic → force "needs_support", cap score at 30
 * - Factual errors or missing evidence → cap at "developing"
 * - Evidence bar met + no errors + LLM under-rated → upgrade to "strong"
 * - LLM and validator agree → no change
 */
export function boundScore(
  llmStatus: OverallStatus,
  llmScore: number,
  validation: ValidationResult,
  threshold: number = 80
): BoundingDecision {
  // Off-topic: force needs_support
  if (validation.isOffTopic) {
    const newScore = Math.min(llmScore, 30);
    const wasAdjusted = llmStatus !== "needs_support" || llmScore > 30;
    return {
      boundedStatus: "needs_support",
      boundedScore: newScore,
      wasAdjusted,
      direction: wasAdjusted ? "downgrade" : "none",
      reason: wasAdjusted ? "off-topic: no relevant entities or attributes" : "already needs_support",
    };
  }

  // Factual errors or missing evidence: cap at "developing"
  if (validation.hasFactualErrors || !validation.meetsEvidenceBar) {
    if (STATUS_RANK[llmStatus] > STATUS_RANK["developing"]) {
      // Downgrade from strong → developing
      return {
        boundedStatus: "developing",
        boundedScore: Math.min(llmScore, threshold - 1),
        wasAdjusted: true,
        direction: "downgrade",
        reason: validation.hasFactualErrors
          ? `factual error: ${validation.incorrectPairs.map(p => `${p.entity}≠${p.claimed}`).join(", ")}`
          : "evidence bar not met",
      };
    }
    // LLM already at developing or lower — no downgrade needed,
    // but ensure score doesn't exceed threshold
    if (llmStatus === "developing" && llmScore >= threshold) {
      return {
        boundedStatus: "developing",
        boundedScore: threshold - 1,
        wasAdjusted: true,
        direction: "downgrade",
        reason: "score capped: evidence bar not met",
      };
    }
    // LLM already at or below developing — no change
    return {
      boundedStatus: llmStatus,
      boundedScore: llmScore,
      wasAdjusted: false,
      direction: "none",
      reason: "LLM already at or below developing",
    };
  }

  // Evidence bar met + no errors: allow or upgrade to "strong"
  if (validation.meetsEvidenceBar && !validation.hasFactualErrors) {
    if (STATUS_RANK[llmStatus] < STATUS_RANK["strong"]) {
      // Upgrade to strong
      return {
        boundedStatus: "strong",
        boundedScore: Math.max(llmScore, threshold),
        wasAdjusted: true,
        direction: "upgrade",
        reason: "evidence bar met with no factual errors",
      };
    }
    // Already strong — no change
    return {
      boundedStatus: llmStatus,
      boundedScore: llmScore,
      wasAdjusted: false,
      direction: "none",
      reason: "LLM and validator agree: strong",
    };
  }

  // Fallback: no change
  return {
    boundedStatus: llmStatus,
    boundedScore: llmScore,
    wasAdjusted: false,
    direction: "none",
    reason: "no adjustment needed",
  };
}

// ============================================================================
// Evidence checklist
// ============================================================================

export interface EvidenceChecklistItem {
  /** Human-readable label (e.g., "Earth material described"). */
  label: string;
  /** Whether this item has been satisfied. */
  satisfied: boolean;
  /** Type of evidence: entity-attribute pairing or conceptual criterion. */
  type: "entity_attribute" | "concept";
}

/**
 * Build a deterministic evidence checklist for a prompt.
 *
 * Combines:
 * 1. Per-entity attribute checks from requiredEvidence + referenceFacts
 * 2. Non-entity criteria from successCriteria / expectedConcepts
 *
 * The validation result is used to mark which items are satisfied.
 */
export function buildEvidenceChecklist(
  validation: ValidationResult,
  requiredEvidence: RequiredEvidence,
  referenceFacts: Record<string, string[]>,
  successCriteria?: string[],
  missingCriteria?: string[],
): EvidenceChecklistItem[] {
  const checklist: EvidenceChecklistItem[] = [];

  // 1. Per-entity items: which required entities have correct attributes
  const entityNames = Object.keys(referenceFacts);
  const pairedEntities = new Set(
    validation.extractedPairs
      .filter(p => !validation.incorrectPairs.some(ip => ip.entity === p.entity))
      .map(p => p.entity)
  );

  // Only add entity items for entities the student mentioned or that are required
  // Use the entities from the question context — pick top N entities based on minEntities
  const mentionedEntities = validation.matchedEntities;
  const entitiesToTrack = mentionedEntities.length > 0
    ? mentionedEntities
    : entityNames.slice(0, requiredEvidence.minEntities);

  for (const entity of entitiesToTrack) {
    checklist.push({
      label: `${entity} ${requiredEvidence.attributeLabel} described`,
      satisfied: pairedEntities.has(entity),
      type: "entity_attribute",
    });
  }

  // If student mentioned fewer entities than required, add placeholder items
  if (mentionedEntities.length < requiredEvidence.minEntities) {
    const remaining = requiredEvidence.minEntities - mentionedEntities.length;
    for (let i = 0; i < remaining; i++) {
      checklist.push({
        label: `${requiredEvidence.entityLabel} #${mentionedEntities.length + i + 1} ${requiredEvidence.attributeLabel} described`,
        satisfied: false,
        type: "entity_attribute",
      });
    }
  }

  // 2. Non-entity criteria from successCriteria that aren't about entity-attribute pairings
  if (successCriteria) {
    const entityPattern = new RegExp(
      entityNames.map(n => escapeRegex(n)).join("|"),
      "i"
    );
    for (const criterion of successCriteria) {
      // Skip criteria that are clearly about naming entities or their attributes
      if (entityPattern.test(criterion)) continue;
      if (/\bnames?\s+(?:at\s+least\s+)?\d/i.test(criterion)) continue;
      if (/\bdescribes?\s+what\s+each/i.test(criterion)) continue;
      if (/\bstates?\s+that\s+planets?\b/i.test(criterion)) continue;

      const isMissing = missingCriteria
        ? missingCriteria.some(mc => mc === criterion || criterion.includes(mc) || mc.includes(criterion))
        : true; // If no missingCriteria info, assume missing

      checklist.push({
        label: criterion,
        satisfied: !isMissing,
        type: "concept",
      });
    }
  }

  return checklist;
}

// ============================================================================
// Missing-evidence probe generation
// ============================================================================

/**
 * Build a scope-locked probe targeting the first missing evidence item.
 * Returns null if all evidence is satisfied.
 */
export function buildMissingEvidenceProbe(
  checklist: EvidenceChecklistItem[],
  requiredEvidence: RequiredEvidence,
  referenceFacts: Record<string, string[]>,
): string | null {
  const missing = checklist.filter(item => !item.satisfied);
  if (missing.length === 0) return null;

  const first = missing[0];

  if (first.type === "entity_attribute") {
    // Extract entity name from the label
    const entityNames = Object.keys(referenceFacts);
    const matchedEntity = entityNames.find(name =>
      first.label.toLowerCase().startsWith(name.toLowerCase())
    );

    if (matchedEntity) {
      return `What is ${matchedEntity} made of?`;
    }
    // Generic entity prompt
    return `Can you name another ${requiredEvidence.entityLabel.replace(/s$/, "")} and describe its ${requiredEvidence.attributeLabel}?`;
  }

  // Concept criterion — turn it into a question
  return criterionToQuestion(first.label);
}

/**
 * Convert a success criterion statement into a direct question.
 */
function criterionToQuestion(criterion: string): string {
  const lower = criterion.toLowerCase();

  // "Explains why X" → "Why X?"
  const whyMatch = lower.match(/\bexplains?\s+why\s+(.+)/i);
  if (whyMatch) return `Why ${whyMatch[1].replace(/\.$/, "")}?`;

  // "Describes how X" → "How X?"
  const howMatch = lower.match(/\bdescribes?\s+how\s+(.+)/i);
  if (howMatch) return `How ${howMatch[1].replace(/\.$/, "")}?`;

  // "States that X" → "Can you tell me about X?"
  const stateMatch = lower.match(/\bstates?\s+that\s+(.+)/i);
  if (stateMatch) return `Can you tell me: ${stateMatch[1].replace(/\.$/, "")}?`;

  // "Gives X" / "Provides X" → "Can you give X?"
  const giveMatch = lower.match(/\b(?:gives?|provides?)\s+(.+)/i);
  if (giveMatch) return `Can you give ${giveMatch[1].replace(/\.$/, "")}?`;

  // Fallback: wrap as question
  return `Can you also talk about: ${criterion.replace(/\.$/, "")}?`;
}

// ============================================================================
// Factual-error response builder
// ============================================================================

/** Praise patterns to block when factual errors are present. */
const FACTUAL_ERROR_PRAISE = /\b(good\s+(?:start|thinking|try|effort|thought|idea|job|work)|that'?s\s+(?:interesting|a\s+good|right|correct)|nice\s+(?:try|idea|thought|work|job)|well\s+done|great\s+(?:start|job|work|thinking)|i\s+see\s+(?:your|what\s+you'?re)\s+thinking|interesting\s+idea|exactly|perfect)\b/i;

/**
 * Check if a coach response contains praise that should be blocked
 * when the student has made a factual error.
 */
export function containsFactualErrorPraise(response: string): boolean {
  return FACTUAL_ERROR_PRAISE.test(response);
}

/**
 * Build an explicit correction response for a factual error.
 * Uses referenceFacts to provide the correct answer.
 */
export function buildFactualCorrectionResponse(
  incorrectPairs: Array<{ entity: string; claimed: string; acceptable: string[] }>,
  requiredEvidence: RequiredEvidence,
  checklist?: EvidenceChecklistItem[],
): string {
  const first = incorrectPairs[0];
  const correctMaterials = first.acceptable.join(" and ");

  // Sentence 1: Explicit correction
  const correction = `Not quite—${first.entity} is made of ${correctMaterials}, not ${first.claimed}.`;

  // Sentence 2: Targeted retry question
  let retryQuestion: string;
  if (checklist) {
    const missing = checklist.filter(item => !item.satisfied);
    if (missing.length > 0) {
      const probe = buildMissingEvidenceProbe(checklist, requiredEvidence, {});
      retryQuestion = probe || `What is ${first.entity} made of?`;
    } else {
      retryQuestion = `What is ${first.entity} made of?`;
    }
  } else {
    retryQuestion = `What is ${first.entity} made of?`;
  }

  return `${correction} ${retryQuestion}`;
}

// ============================================================================
// Helpers
// ============================================================================

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a regex fragment (without \b anchors) for an entity name + simple plural.
 *
 * Conservative rules — no stemming, no fuzzy matching:
 *   - Entities ending in "s" (Mars, Venus): exact match only.
 *   - Entities ending in "sh", "ch", "x", "z": allow optional "es" suffix.
 *   - All others: allow optional "s" suffix.
 *
 * NOT supported (intentionally): y→ies, irregular plurals, depluralization.
 */
function entityInflectionFragment(entityName: string): string {
  const escaped = escapeRegex(entityName);

  // Entities already ending in "s" — no inflection (Mars, Venus, etc.)
  if (/s$/i.test(entityName)) {
    return escaped;
  }

  // Entities ending in sh, ch, x, z — plural adds "es"
  if (/(?:sh|ch|x|z)$/i.test(entityName)) {
    return `${escaped}(?:es)?`;
  }

  // Default: allow optional trailing "s"
  return `${escaped}s?`;
}

/**
 * Build a full regex pattern (with \b anchors) matching an entity name + simple plural.
 */
function buildEntityMatchPattern(entityName: string): string {
  return `\\b${entityInflectionFragment(entityName)}\\b`;
}
