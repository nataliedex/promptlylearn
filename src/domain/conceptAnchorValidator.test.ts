import {
  findOffTopicViolation,
  isAnchored,
  isProbeValid,
  sanitizeProbe,
  buildAnchoredFallback,
  buildAnchoredFallbacks,
} from "./conceptAnchorValidator";
import type { ConceptAnchor } from "./prompt";

// ============================================================================
// Test anchor: planets materials lesson
// ============================================================================

const planetsAnchor: ConceptAnchor = {
  anchorSentence: "This question is about what Earth and Mars are made of.",
  coreConcepts: ["earth materials", "mars materials", "rocky planets"],
  allowedEntities: ["earth", "mars"],
  allowedAttributes: ["rock", "metal", "dust", "ice"],
  offTopicConcepts: ["gravity", "atmosphere", "life on mars", "orbit", "temperature"],
};

// ============================================================================
// findOffTopicViolation
// ============================================================================

describe("findOffTopicViolation", () => {
  test("detects single-word off-topic concept (gravity)", () => {
    const result = findOffTopicViolation(
      "How does gravity affect the materials on Earth and Mars?",
      planetsAnchor,
    );
    expect(result).toBe("gravity");
  });

  test("detects multi-word off-topic concept (life on mars)", () => {
    const result = findOffTopicViolation(
      "Is there life on Mars?",
      planetsAnchor,
    );
    expect(result).toBe("life on mars");
  });

  test("detects atmosphere as off-topic", () => {
    const result = findOffTopicViolation(
      "What is the atmosphere of Mars like?",
      planetsAnchor,
    );
    expect(result).toBe("atmosphere");
  });

  test("returns null for on-topic probe about Earth materials", () => {
    const result = findOffTopicViolation(
      "What is Earth made of?",
      planetsAnchor,
    );
    expect(result).toBeNull();
  });

  test("returns null for on-topic probe about Mars", () => {
    const result = findOffTopicViolation(
      "What is Mars made of?",
      planetsAnchor,
    );
    expect(result).toBeNull();
  });

  test("returns null for on-topic probe mentioning rock", () => {
    const result = findOffTopicViolation(
      "Can you name a rocky planet?",
      planetsAnchor,
    );
    expect(result).toBeNull();
  });
});

// ============================================================================
// isAnchored
// ============================================================================

describe("isAnchored", () => {
  test("anchored when mentioning an allowed entity (Earth)", () => {
    expect(isAnchored("What is Earth made of?", planetsAnchor)).toBe(true);
  });

  test("anchored when mentioning an allowed entity (Mars)", () => {
    expect(isAnchored("Tell me about Mars.", planetsAnchor)).toBe(true);
  });

  test("anchored when mentioning an allowed attribute (rock)", () => {
    expect(isAnchored("Is it made of rock?", planetsAnchor)).toBe(true);
  });

  test("anchored when mentioning an allowed attribute (metal)", () => {
    expect(isAnchored("Does it contain metal?", planetsAnchor)).toBe(true);
  });

  test("not anchored for completely unrelated text", () => {
    expect(isAnchored("How are you feeling today?", planetsAnchor)).toBe(false);
  });

  test("not anchored for off-topic concept only", () => {
    expect(isAnchored("Tell me about gravity.", planetsAnchor)).toBe(false);
  });
});

// ============================================================================
// isProbeValid — combined check
// ============================================================================

describe("isProbeValid", () => {
  test("valid: 'What is Mars made of?' — on-topic and anchored", () => {
    expect(isProbeValid("What is Mars made of?", planetsAnchor)).toBe(true);
  });

  test("valid: 'Tell one material found on Earth.' — anchored to entity + attribute", () => {
    expect(isProbeValid("Tell one material found on Earth.", planetsAnchor)).toBe(true);
  });

  test("invalid: 'How does gravity affect Earth and Mars?' — off-topic (gravity)", () => {
    expect(isProbeValid("How does gravity affect Earth and Mars?", planetsAnchor)).toBe(false);
  });

  test("invalid: 'What is the temperature on Mars?' — off-topic (temperature)", () => {
    expect(isProbeValid("What is the temperature on Mars?", planetsAnchor)).toBe(false);
  });

  test("invalid: 'How are you feeling?' — not anchored at all", () => {
    expect(isProbeValid("How are you feeling?", planetsAnchor)).toBe(false);
  });
});

// ============================================================================
// sanitizeProbe — validate and replace
// ============================================================================

describe("sanitizeProbe", () => {
  const allowedProbes = [
    "What is Earth made of?",
    "What is Mars made of?",
    "Can you name another rocky planet?",
  ];

  test("passes through a valid probe unchanged", () => {
    const result = sanitizeProbe("What is Mars made of?", planetsAnchor, allowedProbes);
    expect(result.wasReplaced).toBe(false);
    expect(result.probe).toBe("What is Mars made of?");
  });

  test("replaces gravity probe with an allowedProbe", () => {
    const result = sanitizeProbe(
      "How does gravity affect the materials on Earth and Mars?",
      planetsAnchor,
      allowedProbes,
    );
    expect(result.wasReplaced).toBe(true);
    expect(result.reason).toContain("gravity");
    // Should pick one of the valid allowedProbes
    expect(allowedProbes).toContain(result.probe);
  });

  test("replaces off-topic probe with unused allowedProbe (dedup)", () => {
    const usedProbes = ["What is Earth made of?"];
    const result = sanitizeProbe(
      "What is the atmosphere of Mars?",
      planetsAnchor,
      allowedProbes,
      usedProbes,
    );
    expect(result.wasReplaced).toBe(true);
    // Should skip the already-used probe
    expect(result.probe).not.toBe("What is Earth made of?");
    expect(allowedProbes).toContain(result.probe);
  });

  test("falls back to anchored deterministic probe when no allowedProbes", () => {
    const result = sanitizeProbe(
      "How does gravity affect Earth?",
      planetsAnchor,
      undefined, // no allowedProbes
    );
    expect(result.wasReplaced).toBe(true);
    expect(result.probe).toContain("earth");
  });

  test("replaces unanchored probe even without off-topic violation", () => {
    const result = sanitizeProbe(
      "How are you feeling today?",
      planetsAnchor,
      allowedProbes,
    );
    expect(result.wasReplaced).toBe(true);
    expect(allowedProbes).toContain(result.probe);
  });
});

// ============================================================================
// buildAnchoredFallback
// ============================================================================

describe("buildAnchoredFallback", () => {
  test("builds fallback for a specific entity", () => {
    const fallback = buildAnchoredFallback(planetsAnchor, "mars");
    expect(fallback.toLowerCase()).toContain("mars");
  });

  test("builds fallback for first entity when none specified", () => {
    const fallback = buildAnchoredFallback(planetsAnchor);
    expect(fallback.toLowerCase()).toContain("earth");
  });

  test("fallback is itself valid against the anchor", () => {
    const fallback = buildAnchoredFallback(planetsAnchor);
    // The fallback should pass anchoring (mentions an entity)
    expect(isAnchored(fallback, planetsAnchor)).toBe(true);
  });
});

// ============================================================================
// buildAnchoredFallbacks — pool of safe probes
// ============================================================================

describe("buildAnchoredFallbacks", () => {
  test("generates fallbacks for all entities", () => {
    const fallbacks = buildAnchoredFallbacks(planetsAnchor);
    expect(fallbacks.length).toBeGreaterThanOrEqual(2);
    // Should mention each entity
    const all = fallbacks.join(" ").toLowerCase();
    expect(all).toContain("earth");
    expect(all).toContain("mars");
  });

  test("all generated fallbacks are valid probes", () => {
    const fallbacks = buildAnchoredFallbacks(planetsAnchor);
    for (const fb of fallbacks) {
      expect(isAnchored(fb, planetsAnchor)).toBe(true);
      expect(findOffTopicViolation(fb, planetsAnchor)).toBeNull();
    }
  });
});

// ============================================================================
// Scenario tests (matching user requirements)
// ============================================================================

describe("Scenario: planets lesson concept anchoring", () => {
  test("gravity follow-up is rejected as off-topic", () => {
    const result = isProbeValid(
      "How does gravity affect the materials on Earth and Mars?",
      planetsAnchor,
    );
    expect(result).toBe(false);
  });

  test("'What is Mars made of?' is allowed", () => {
    const result = isProbeValid("What is Mars made of?", planetsAnchor);
    expect(result).toBe(true);
  });

  test("misconception correction stays in-scope", () => {
    const correction = "Not quite — Earth is made of rock and metal, not gas. What is Mars made of?";
    expect(findOffTopicViolation(correction, planetsAnchor)).toBeNull();
    expect(isAnchored(correction, planetsAnchor)).toBe(true);
  });

  test("re-ask question stays in-scope", () => {
    const reask = "Let's try again. What are Earth and Mars made of?";
    expect(findOffTopicViolation(reask, planetsAnchor)).toBeNull();
    expect(isAnchored(reask, planetsAnchor)).toBe(true);
  });

  test("if no valid generated probe exists, fallback uses anchored deterministic question", () => {
    // All allowedProbes happen to be used, and the proposed probe is off-topic
    const allUsed = [
      "What is Earth made of?",
      "What is Mars made of?",
      "Can you name another rocky planet?",
    ];
    const result = sanitizeProbe(
      "What is the orbit of Mars?",
      planetsAnchor,
      allUsed, // same as allowedProbes — they'll all be "used"
      allUsed,
    );
    expect(result.wasReplaced).toBe(true);
    // Should still produce a valid probe
    expect(isAnchored(result.probe, planetsAnchor)).toBe(true);
    expect(findOffTopicViolation(result.probe, planetsAnchor)).toBeNull();
  });
});

// ============================================================================
// Backwards compatibility
// ============================================================================

describe("backwards compatibility", () => {
  test("Prompt without conceptAnchor: probe passes through unchanged", () => {
    // This tests the coach-level behavior — if no anchor, no filtering.
    // Since sanitizeProbe requires an anchor, this is tested at the integration
    // level. Here we just verify the module doesn't crash on edge cases.
    const emptyAnchor: ConceptAnchor = {
      anchorSentence: "",
      coreConcepts: [],
      allowedEntities: [],
      allowedAttributes: [],
      offTopicConcepts: [],
    };
    // With no off-topic concepts, nothing is off-topic
    expect(findOffTopicViolation("How does gravity work?", emptyAnchor)).toBeNull();
    // With no allowed entities/attributes, nothing is anchored
    expect(isAnchored("How does gravity work?", emptyAnchor)).toBe(false);
  });
});
