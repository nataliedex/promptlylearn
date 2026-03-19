import type { ConceptAnchor } from "./prompt";

/**
 * Concept Anchor Validator
 *
 * Lightweight keyword/token matching to ensure coach follow-ups stay
 * within the question's conceptual scope. No LLM call required.
 *
 * A probe is valid if it:
 *   1. Does NOT introduce any offTopicConcepts
 *   2. References at least one allowedEntity or allowedAttribute
 *
 * When a probe fails validation, it is replaced with an anchored fallback
 * built deterministically from the anchor data.
 */

// ============================================================================
// Core validation
// ============================================================================

/** Tokenize text into lowercase words for matching. */
function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s'-]/g, " ").split(/\s+/).filter(Boolean);
}

/**
 * Check whether `text` introduces any off-topic concepts.
 * Uses both single-word and multi-word phrase matching.
 * Returns the first offending concept found, or null if clean.
 */
export function findOffTopicViolation(
  text: string,
  anchor: ConceptAnchor,
): string | null {
  const lower = text.toLowerCase();
  for (const concept of anchor.offTopicConcepts) {
    // Multi-word phrase match (e.g., "life on mars")
    if (concept.includes(" ")) {
      if (lower.includes(concept)) return concept;
      continue;
    }
    // Single-word: match as whole word
    const re = new RegExp(`\\b${escapeRegex(concept)}\\b`, "i");
    if (re.test(text)) return concept;
  }
  return null;
}

/**
 * Check whether `text` references at least one allowed entity or attribute.
 * Returns true if the text is "anchored" — i.e., on-topic.
 */
export function isAnchored(
  text: string,
  anchor: ConceptAnchor,
): boolean {
  const lower = text.toLowerCase();
  for (const entity of anchor.allowedEntities) {
    if (entity.includes(" ")) {
      if (lower.includes(entity)) return true;
      continue;
    }
    const re = new RegExp(`\\b${escapeRegex(entity)}\\b`, "i");
    if (re.test(text)) return true;
  }
  for (const attr of anchor.allowedAttributes) {
    if (attr.includes(" ")) {
      if (lower.includes(attr)) return true;
      continue;
    }
    const re = new RegExp(`\\b${escapeRegex(attr)}\\b`, "i");
    if (re.test(text)) return true;
  }
  return false;
}

/**
 * Full validation: a probe is valid if it has no off-topic violations
 * AND is anchored (references at least one allowed entity/attribute).
 */
export function isProbeValid(
  probeText: string,
  anchor: ConceptAnchor,
): boolean {
  const violation = findOffTopicViolation(probeText, anchor);
  if (violation) return false;
  return isAnchored(probeText, anchor);
}

// ============================================================================
// Anchored fallback generation (Part 4)
// ============================================================================

/**
 * Build a deterministic anchored fallback probe from the anchor data.
 * Uses allowed entities and attributes to construct simple, safe questions.
 *
 * If `missingEntity` is provided, targets that specific entity.
 * Otherwise picks the first available entity.
 */
export function buildAnchoredFallback(
  anchor: ConceptAnchor,
  missingEntity?: string,
): string {
  const entity = missingEntity || anchor.allowedEntities[0];
  if (!entity) return "Can you tell me more about that?";

  const attr = anchor.allowedAttributes[0];
  if (attr) {
    return `What is ${entity} made of?`;
  }

  return `Tell me about ${entity}.`;
}

/**
 * Build multiple anchored fallback probes — one per allowed entity.
 * Used when we need a pool of safe deterministic probes.
 */
export function buildAnchoredFallbacks(anchor: ConceptAnchor): string[] {
  const fallbacks: string[] = [];
  for (const entity of anchor.allowedEntities) {
    if (anchor.allowedAttributes.length > 0) {
      fallbacks.push(`What is ${entity} made of?`);
      // Also add attribute-specific variant
      const attr = anchor.allowedAttributes[0];
      if (attr) {
        fallbacks.push(`Tell one ${attr} found on ${entity}.`);
      }
    } else {
      fallbacks.push(`Tell me about ${entity}.`);
    }
  }
  return fallbacks;
}

// ============================================================================
// Probe sanitization — validate and replace if needed
// ============================================================================

/**
 * Validate a proposed probe against the concept anchor.
 * If valid, returns it unchanged.
 * If invalid, returns a replacement from:
 *   1. The prompt's allowedProbes (if any remain unused)
 *   2. An anchored deterministic fallback
 *
 * @param proposedProbe - The probe text to validate
 * @param anchor - The concept anchor for this prompt
 * @param allowedProbes - Pre-generated probes from the prompt
 * @param usedProbes - Already-asked probes (for deduplication)
 * @returns The original probe if valid, or a safe replacement
 */
export function sanitizeProbe(
  proposedProbe: string,
  anchor: ConceptAnchor,
  allowedProbes?: string[],
  usedProbes?: string[],
): { probe: string; wasReplaced: boolean; reason?: string } {
  // Check validity
  const violation = findOffTopicViolation(proposedProbe, anchor);
  const anchored = isAnchored(proposedProbe, anchor);

  if (!violation && anchored) {
    return { probe: proposedProbe, wasReplaced: false };
  }

  const reason = violation
    ? `off-topic concept: "${violation}"`
    : "not anchored to any allowed entity or attribute";

  // Try an unused allowedProbe first
  if (allowedProbes?.length) {
    const usedSet = new Set((usedProbes || []).map(q => q.toLowerCase().trim()));
    for (const probe of allowedProbes) {
      if (!usedSet.has(probe.toLowerCase().trim()) && isProbeValid(probe, anchor)) {
        return { probe, wasReplaced: true, reason };
      }
    }
    // All used — try any valid allowedProbe
    for (const probe of allowedProbes) {
      if (isProbeValid(probe, anchor)) {
        return { probe, wasReplaced: true, reason };
      }
    }
  }

  // Fall back to anchored deterministic probe
  const fallback = buildAnchoredFallback(anchor);
  return { probe: fallback, wasReplaced: true, reason };
}

// ============================================================================
// Helpers
// ============================================================================

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
