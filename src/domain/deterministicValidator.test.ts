import {
  extractEntities,
  extractEntityAttributePairs,
  findIncorrectPairs,
  validate,
  boundScore,
  normalizeAttribute,
  collectCanonicalAttributes,
  buildEvidenceChecklist,
  buildMissingEvidenceProbe,
  containsFactualErrorPraise,
  buildFactualCorrectionResponse,
} from "./deterministicValidator";
import { RequiredEvidence } from "./prompt";

// ============================================================================
// Fixtures
// ============================================================================

const PLANET_FACTS: Record<string, string[]> = {
  Mercury: ["rock", "metal"],
  Venus: ["rock"],
  Earth: ["rock", "metal"],
  Mars: ["rock"],
  Jupiter: ["gas"],
  Saturn: ["gas"],
  Uranus: ["ice", "gas"],
  Neptune: ["ice", "gas"],
};

const PLANET_EVIDENCE: RequiredEvidence = {
  minEntities: 2,
  entityLabel: "planets",
  attributeLabel: "materials",
  minAttributeTypes: 2,
  requirePairing: true,
};

const CANONICAL = collectCanonicalAttributes(PLANET_FACTS);

// ============================================================================
// normalizeAttribute
// ============================================================================

describe("normalizeAttribute", () => {
  test("normalizes 'rocky' to 'rock'", () => {
    expect(normalizeAttribute("rocky", CANONICAL)).toBe("rock");
  });

  test("normalizes 'gaseous' to 'gas'", () => {
    expect(normalizeAttribute("gaseous", CANONICAL)).toBe("gas");
  });

  test("normalizes 'hydrogen' to 'gas'", () => {
    expect(normalizeAttribute("hydrogen", CANONICAL)).toBe("gas");
  });

  test("normalizes 'iron' to 'metal'", () => {
    expect(normalizeAttribute("iron", CANONICAL)).toBe("metal");
  });

  test("normalizes 'icy' to 'ice'", () => {
    expect(normalizeAttribute("icy", CANONICAL)).toBe("ice");
  });

  test("returns null for unknown words", () => {
    expect(normalizeAttribute("lollipops", CANONICAL)).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(normalizeAttribute("", CANONICAL)).toBeNull();
  });
});

// ============================================================================
// extractEntities
// ============================================================================

describe("extractEntities", () => {
  test("finds planet names in student text", () => {
    const entities = extractEntities("Earth is cool and Jupiter is big", PLANET_FACTS);
    expect(entities).toContain("Earth");
    expect(entities).toContain("Jupiter");
  });

  test("is case-insensitive", () => {
    const entities = extractEntities("earth and MARS", PLANET_FACTS);
    expect(entities).toContain("Earth");
    expect(entities).toContain("Mars");
  });

  test("returns empty array for off-topic text", () => {
    const entities = extractEntities("clouds rainbows lollipops", PLANET_FACTS);
    expect(entities).toHaveLength(0);
  });

  test("deduplicates repeated mentions", () => {
    const entities = extractEntities("Earth is rocky. Earth has metal too.", PLANET_FACTS);
    expect(entities).toHaveLength(1);
    expect(entities[0]).toBe("Earth");
  });

  test("finds multiple planets", () => {
    const entities = extractEntities(
      "Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, and Neptune",
      PLANET_FACTS
    );
    expect(entities).toHaveLength(8);
  });

  // --- Inflection support ---

  const ANIMAL_FACTS: Record<string, string[]> = {
    frog: ["land", "water", "legs", "lungs"],
    fish: ["water", "fins", "gills"],
    fox: ["forest", "den"],
    bear: ["forest", "cave"],
    camel: ["desert"],
    penguin: ["ice", "snow"],
  };

  test("matches simple plural 'frogs' for key 'frog'", () => {
    const entities = extractEntities("frogs have legs", ANIMAL_FACTS);
    expect(entities).toContain("frog");
  });

  test("matches simple plural 'bears' for key 'bear'", () => {
    const entities = extractEntities("bears live in forests", ANIMAL_FACTS);
    expect(entities).toContain("bear");
  });

  test("matches simple plural 'penguins' for key 'penguin'", () => {
    const entities = extractEntities("penguins live on ice", ANIMAL_FACTS);
    expect(entities).toContain("penguin");
  });

  test("matches 'fishes' for key 'fish' (sh-ending gets -es)", () => {
    const entities = extractEntities("fishes swim in water", ANIMAL_FACTS);
    expect(entities).toContain("fish");
  });

  test("matches 'foxes' for key 'fox' (x-ending gets -es)", () => {
    const entities = extractEntities("foxes live in dens", ANIMAL_FACTS);
    expect(entities).toContain("fox");
  });

  test("still matches exact singular 'frog'", () => {
    const entities = extractEntities("a frog has legs", ANIMAL_FACTS);
    expect(entities).toContain("frog");
  });

  test("does NOT match 'frogspawn' for key 'frog'", () => {
    const entities = extractEntities("frogspawn is found in ponds", ANIMAL_FACTS);
    expect(entities).not.toContain("frog");
  });

  test("does NOT match 'bearing' for key 'bear'", () => {
    const entities = extractEntities("she is bearing a heavy load", ANIMAL_FACTS);
    expect(entities).not.toContain("bear");
  });

  test("preserves exact match for entities ending in 's' (Mars)", () => {
    const entities = extractEntities("Mars is red", PLANET_FACTS);
    expect(entities).toContain("Mars");
  });

  test("does not match 'Mar' for entity 'Mars'", () => {
    const entities = extractEntities("Mar is not a planet", PLANET_FACTS);
    expect(entities).not.toContain("Mars");
  });

  test("does not match 'Venues' for entity 'Venus'", () => {
    const entities = extractEntities("There are many venues", PLANET_FACTS);
    expect(entities).not.toContain("Venus");
  });
});

// ============================================================================
// extractEntityAttributePairs — inflection
// ============================================================================

describe("extractEntityAttributePairs — inflection", () => {
  const COMPARE_FACTS: Record<string, string[]> = {
    frog: ["land", "water", "legs", "lungs"],
    fish: ["water", "fins", "gills"],
  };

  test("extracts pair from 'frogs have legs' via segment fallback", () => {
    const pairs = extractEntityAttributePairs("frogs have legs", COMPARE_FACTS);
    const frogPair = pairs.find(p => p.entity === "frog");
    expect(frogPair).toBeDefined();
    expect(frogPair!.attribute).toBe("legs");
  });

  test("extracts pair from 'fishes have fins'", () => {
    const pairs = extractEntityAttributePairs("fishes have fins", COMPARE_FACTS);
    const fishPair = pairs.find(p => p.entity === "fish");
    expect(fishPair).toBeDefined();
    expect(fishPair!.attribute).toBe("fins");
  });

  test("does NOT extract from 'frogspawn has legs'", () => {
    const pairs = extractEntityAttributePairs("frogspawn has legs", COMPARE_FACTS);
    expect(pairs.find(p => p.entity === "frog")).toBeUndefined();
  });
});

// ============================================================================
// extractEntityAttributePairs
// ============================================================================

describe("extractEntityAttributePairs", () => {
  test("extracts 'made of' pairs", () => {
    const pairs = extractEntityAttributePairs(
      "Earth is made of rock and Jupiter is made of gas",
      PLANET_FACTS
    );
    expect(pairs).toEqual(
      expect.arrayContaining([
        { entity: "Earth", attribute: "rock" },
        { entity: "Jupiter", attribute: "gas" },
      ])
    );
  });

  test("normalizes aliases (rocky -> rock)", () => {
    const pairs = extractEntityAttributePairs(
      "Earth is made of rocky stuff and Jupiter is made of gaseous material",
      PLANET_FACTS
    );
    const earthPair = pairs.find(p => p.entity === "Earth");
    const jupiterPair = pairs.find(p => p.entity === "Jupiter");
    expect(earthPair?.attribute).toBe("rock");
    expect(jupiterPair?.attribute).toBe("gas");
  });

  test("handles segment fallback (no linking verb)", () => {
    const pairs = extractEntityAttributePairs(
      "Earth rock, Jupiter gas",
      PLANET_FACTS
    );
    expect(pairs.length).toBeGreaterThanOrEqual(2);
    const earthPair = pairs.find(p => p.entity === "Earth");
    const jupiterPair = pairs.find(p => p.entity === "Jupiter");
    expect(earthPair?.attribute).toBe("rock");
    expect(jupiterPair?.attribute).toBe("gas");
  });

  test("returns empty for text with no attributes", () => {
    const pairs = extractEntityAttributePairs(
      "Earth is cool and Jupiter is big",
      PLANET_FACTS
    );
    expect(pairs).toHaveLength(0);
  });
});

// ============================================================================
// findIncorrectPairs
// ============================================================================

describe("findIncorrectPairs", () => {
  test("flags Earth=gas as incorrect", () => {
    const incorrect = findIncorrectPairs(
      [{ entity: "Earth", attribute: "gas" }],
      PLANET_FACTS
    );
    expect(incorrect).toHaveLength(1);
    expect(incorrect[0].entity).toBe("Earth");
    expect(incorrect[0].claimed).toBe("gas");
    expect(incorrect[0].acceptable).toEqual(["rock", "metal"]);
  });

  test("flags Jupiter=rock as incorrect", () => {
    const incorrect = findIncorrectPairs(
      [{ entity: "Jupiter", attribute: "rock" }],
      PLANET_FACTS
    );
    expect(incorrect).toHaveLength(1);
    expect(incorrect[0].entity).toBe("Jupiter");
    expect(incorrect[0].claimed).toBe("rock");
  });

  test("accepts Earth=rock as correct", () => {
    const incorrect = findIncorrectPairs(
      [{ entity: "Earth", attribute: "rock" }],
      PLANET_FACTS
    );
    expect(incorrect).toHaveLength(0);
  });

  test("accepts Uranus=ice as correct", () => {
    const incorrect = findIncorrectPairs(
      [{ entity: "Uranus", attribute: "ice" }],
      PLANET_FACTS
    );
    expect(incorrect).toHaveLength(0);
  });

  test("accepts Uranus=gas as correct (has both ice and gas)", () => {
    const incorrect = findIncorrectPairs(
      [{ entity: "Uranus", attribute: "gas" }],
      PLANET_FACTS
    );
    expect(incorrect).toHaveLength(0);
  });
});

// ============================================================================
// validate — required test cases
// ============================================================================

describe("validate", () => {
  test("Earth+rock and Jupiter+gas => Strong allowed", () => {
    const result = validate(
      "Earth is made of rock and Jupiter is made of gas",
      PLANET_EVIDENCE,
      PLANET_FACTS
    );
    expect(result.meetsEvidenceBar).toBe(true);
    expect(result.hasFactualErrors).toBe(false);
    expect(result.isOffTopic).toBe(false);
    expect(result.matchedEntities).toContain("Earth");
    expect(result.matchedEntities).toContain("Jupiter");
    expect(result.distinctAttributeTypes).toContain("rock");
    expect(result.distinctAttributeTypes).toContain("gas");
  });

  test("Earth=gas => not Strong (factual error)", () => {
    const result = validate(
      "Earth is made of gas",
      PLANET_EVIDENCE,
      PLANET_FACTS
    );
    expect(result.hasFactualErrors).toBe(true);
    expect(result.meetsEvidenceBar).toBe(false);
  });

  test("Earth=rock, Jupiter=rock => Developing (factual error for Jupiter)", () => {
    const result = validate(
      "Earth is made of rock and Jupiter is made of rock",
      PLANET_EVIDENCE,
      PLANET_FACTS
    );
    expect(result.hasFactualErrors).toBe(true);
    expect(result.meetsEvidenceBar).toBe(false);
    expect(result.incorrectPairs.some(p => p.entity === "Jupiter")).toBe(true);
  });

  test("clouds rainbows lollipops => Needs Support (off-topic)", () => {
    const result = validate(
      "clouds rainbows lollipops",
      PLANET_EVIDENCE,
      PLANET_FACTS
    );
    expect(result.isOffTopic).toBe(true);
    expect(result.meetsEvidenceBar).toBe(false);
    expect(result.matchedEntities).toHaveLength(0);
  });

  test("missing second planet => not Strong", () => {
    const result = validate(
      "Earth is made of rock and metal",
      PLANET_EVIDENCE,
      PLANET_FACTS
    );
    expect(result.meetsEvidenceBar).toBe(false);
    expect(result.matchedEntities).toHaveLength(1);
    expect(result.hasFactualErrors).toBe(false);
  });

  test("three correct planet-material pairs => Strong", () => {
    const result = validate(
      "Earth is made of rock, Jupiter is made of gas, and Neptune is made of ice",
      PLANET_EVIDENCE,
      PLANET_FACTS
    );
    expect(result.meetsEvidenceBar).toBe(true);
    expect(result.hasFactualErrors).toBe(false);
    expect(result.matchedEntities).toHaveLength(3);
    expect(result.distinctAttributeTypes.length).toBeGreaterThanOrEqual(2);
  });

  test("two planets named but only one attribute type => not Strong (minAttributeTypes=2)", () => {
    const result = validate(
      "Earth is made of rock and Mars is made of rock",
      PLANET_EVIDENCE,
      PLANET_FACTS
    );
    // Both are factually correct but only 1 distinct attribute type
    expect(result.hasFactualErrors).toBe(false);
    expect(result.meetsEvidenceBar).toBe(false);
    expect(result.distinctAttributeTypes).toEqual(["rock"]);
  });

  test("handles messy student speech with filler words", () => {
    const result = validate(
      "um well Earth is like made of um rock I think and Jupiter is uh made of gas",
      PLANET_EVIDENCE,
      PLANET_FACTS
    );
    expect(result.meetsEvidenceBar).toBe(true);
    expect(result.hasFactualErrors).toBe(false);
  });
});

// ============================================================================
// boundScore
// ============================================================================

describe("boundScore", () => {
  test("upgrades developing to strong when evidence bar met", () => {
    const validation = validate(
      "Earth is made of rock and Jupiter is made of gas",
      PLANET_EVIDENCE,
      PLANET_FACTS
    );
    const result = boundScore("developing", 65, validation, 80);
    expect(result.boundedStatus).toBe("strong");
    expect(result.boundedScore).toBe(80);
    expect(result.direction).toBe("upgrade");
    expect(result.wasAdjusted).toBe(true);
  });

  test("downgrades strong to developing when factual errors exist", () => {
    const validation = validate(
      "Earth is made of gas",
      PLANET_EVIDENCE,
      PLANET_FACTS
    );
    const result = boundScore("strong", 90, validation, 80);
    expect(result.boundedStatus).toBe("developing");
    expect(result.boundedScore).toBe(79);
    expect(result.direction).toBe("downgrade");
    expect(result.wasAdjusted).toBe(true);
  });

  test("downgrades to needs_support when off-topic", () => {
    const validation = validate(
      "clouds rainbows lollipops",
      PLANET_EVIDENCE,
      PLANET_FACTS
    );
    const result = boundScore("strong", 85, validation, 80);
    expect(result.boundedStatus).toBe("needs_support");
    expect(result.boundedScore).toBeLessThanOrEqual(30);
    expect(result.direction).toBe("downgrade");
  });

  test("no change when LLM and validator agree on strong", () => {
    const validation = validate(
      "Earth is made of rock and Jupiter is made of gas",
      PLANET_EVIDENCE,
      PLANET_FACTS
    );
    const result = boundScore("strong", 90, validation, 80);
    expect(result.wasAdjusted).toBe(false);
    expect(result.direction).toBe("none");
    expect(result.boundedStatus).toBe("strong");
    expect(result.boundedScore).toBe(90);
  });

  test("no change when LLM says developing and evidence bar not met", () => {
    const validation = validate(
      "Earth is made of rock",
      PLANET_EVIDENCE,
      PLANET_FACTS
    );
    const result = boundScore("developing", 60, validation, 80);
    expect(result.wasAdjusted).toBe(false);
    expect(result.direction).toBe("none");
  });

  test("caps developing score below threshold when evidence bar not met", () => {
    const validation = validate(
      "Earth is made of rock",
      PLANET_EVIDENCE,
      PLANET_FACTS
    );
    // LLM says developing but gave a high score
    const result = boundScore("developing", 85, validation, 80);
    expect(result.boundedStatus).toBe("developing");
    expect(result.boundedScore).toBe(79);
    expect(result.wasAdjusted).toBe(true);
    expect(result.direction).toBe("downgrade");
  });

  test("upgrades needs_support to strong when evidence bar fully met", () => {
    const validation = validate(
      "Earth is made of rock and Jupiter is made of gas",
      PLANET_EVIDENCE,
      PLANET_FACTS
    );
    const result = boundScore("needs_support", 40, validation, 80);
    expect(result.boundedStatus).toBe("strong");
    expect(result.boundedScore).toBe(80);
    expect(result.direction).toBe("upgrade");
  });
});

// ============================================================================
// containsFactualErrorPraise
// ============================================================================

describe("containsFactualErrorPraise", () => {
  test("detects 'Good thinking'", () => {
    expect(containsFactualErrorPraise("Good thinking.")).toBe(true);
  });

  test("detects 'Good start'", () => {
    expect(containsFactualErrorPraise("Good start! Let me tell you more.")).toBe(true);
  });

  test("detects 'Nice work'", () => {
    expect(containsFactualErrorPraise("Nice work on that answer.")).toBe(true);
  });

  test("detects 'Great job'", () => {
    expect(containsFactualErrorPraise("Great job!")).toBe(true);
  });

  test("does not flag a correction", () => {
    expect(containsFactualErrorPraise("Not quite—Earth is made of rock.")).toBe(false);
  });

  test("does not flag neutral response", () => {
    expect(containsFactualErrorPraise("Let's think about that again.")).toBe(false);
  });
});

// ============================================================================
// buildFactualCorrectionResponse
// ============================================================================

describe("buildFactualCorrectionResponse", () => {
  test("Earth=gas produces explicit correction", () => {
    const response = buildFactualCorrectionResponse(
      [{ entity: "Earth", claimed: "gas", acceptable: ["rock", "metal"] }],
      PLANET_EVIDENCE,
    );
    expect(response).toContain("Not quite");
    expect(response).toContain("Earth");
    expect(response).toContain("rock and metal");
    expect(response).toContain("?");
    expect(response).not.toMatch(/good|nice|great/i);
  });

  test("Jupiter=rock produces explicit correction", () => {
    const response = buildFactualCorrectionResponse(
      [{ entity: "Jupiter", claimed: "rock", acceptable: ["gas"] }],
      PLANET_EVIDENCE,
    );
    expect(response).toContain("Not quite");
    expect(response).toContain("Jupiter");
    expect(response).toContain("gas");
  });
});

// ============================================================================
// buildEvidenceChecklist
// ============================================================================

describe("buildEvidenceChecklist", () => {
  test("tracks per-entity completion for Earth and Jupiter", () => {
    const validation = validate(
      "Earth is made of rock and Jupiter is made of gas",
      PLANET_EVIDENCE,
      PLANET_FACTS
    );
    const checklist = buildEvidenceChecklist(
      validation, PLANET_EVIDENCE, PLANET_FACTS,
    );
    const earthItem = checklist.find(i => i.label.includes("Earth"));
    const jupiterItem = checklist.find(i => i.label.includes("Jupiter"));
    expect(earthItem?.satisfied).toBe(true);
    expect(jupiterItem?.satisfied).toBe(true);
  });

  test("marks unsatisfied entity when only one planet described", () => {
    const validation = validate(
      "Earth is made of rock",
      PLANET_EVIDENCE,
      PLANET_FACTS
    );
    const checklist = buildEvidenceChecklist(
      validation, PLANET_EVIDENCE, PLANET_FACTS,
    );
    const earthItem = checklist.find(i => i.label.includes("Earth"));
    expect(earthItem?.satisfied).toBe(true);
    // Should have a placeholder for the missing second entity
    const unsatisfied = checklist.filter(i => !i.satisfied);
    expect(unsatisfied.length).toBeGreaterThan(0);
  });

  test("includes non-entity criteria from successCriteria", () => {
    const validation = validate(
      "Earth is made of rock and Mars is made of rock",
      PLANET_EVIDENCE,
      PLANET_FACTS
    );
    const criteria = [
      "Names at least two specific planets.",
      "Describes what each planet is made of.",
      "Explains why the materials are important for understanding our solar system.",
    ];
    const checklist = buildEvidenceChecklist(
      validation, PLANET_EVIDENCE, PLANET_FACTS,
      criteria,
      ["Explains why the materials are important for understanding our solar system."],
    );
    const importanceItem = checklist.find(i =>
      i.label.toLowerCase().includes("why the materials are important")
    );
    expect(importanceItem).toBeDefined();
    expect(importanceItem!.satisfied).toBe(false);
    expect(importanceItem!.type).toBe("concept");
  });

  test("correct materials without importance explanation is not fully satisfied", () => {
    const validation = validate(
      "Earth has rock and Mars has rock and dust",
      PLANET_EVIDENCE,
      PLANET_FACTS
    );
    const criteria = [
      "Names at least two specific planets.",
      "Describes what each planet is made of.",
      "Explains why the materials are important.",
    ];
    const checklist = buildEvidenceChecklist(
      validation, PLANET_EVIDENCE, PLANET_FACTS,
      criteria,
      ["Explains why the materials are important."],
    );
    const allSatisfied = checklist.every(i => i.satisfied);
    expect(allSatisfied).toBe(false);
  });
});

// ============================================================================
// buildMissingEvidenceProbe
// ============================================================================

describe("buildMissingEvidenceProbe", () => {
  test("asks about missing entity", () => {
    const validation = validate(
      "Earth is made of rock",
      PLANET_EVIDENCE,
      PLANET_FACTS
    );
    const checklist = buildEvidenceChecklist(
      validation, PLANET_EVIDENCE, PLANET_FACTS,
    );
    const probe = buildMissingEvidenceProbe(
      checklist, PLANET_EVIDENCE, PLANET_FACTS,
    );
    expect(probe).toBeTruthy();
    expect(probe).toContain("?");
  });

  test("asks about importance when entity facts are complete", () => {
    const validation = validate(
      "Earth is made of rock and Jupiter is made of gas",
      PLANET_EVIDENCE,
      PLANET_FACTS
    );
    const criteria = [
      "Names at least two specific planets.",
      "Explains why the materials are important.",
    ];
    const checklist = buildEvidenceChecklist(
      validation, PLANET_EVIDENCE, PLANET_FACTS,
      criteria,
      ["Explains why the materials are important."],
    );
    const probe = buildMissingEvidenceProbe(
      checklist, PLANET_EVIDENCE, PLANET_FACTS,
    );
    expect(probe).toBeTruthy();
    expect(probe!.toLowerCase()).toContain("why");
  });

  test("returns null when all evidence is satisfied", () => {
    const validation = validate(
      "Earth is made of rock and Jupiter is made of gas",
      PLANET_EVIDENCE,
      PLANET_FACTS
    );
    const checklist = buildEvidenceChecklist(
      validation, PLANET_EVIDENCE, PLANET_FACTS,
    );
    const probe = buildMissingEvidenceProbe(
      checklist, PLANET_EVIDENCE, PLANET_FACTS,
    );
    expect(probe).toBeNull();
  });

  test("off-topic probe cannot introduce gravity", () => {
    const validation = validate(
      "Earth is made of rock",
      PLANET_EVIDENCE,
      PLANET_FACTS
    );
    const checklist = buildEvidenceChecklist(
      validation, PLANET_EVIDENCE, PLANET_FACTS,
    );
    const probe = buildMissingEvidenceProbe(
      checklist, PLANET_EVIDENCE, PLANET_FACTS,
    );
    expect(probe).toBeTruthy();
    expect(probe!.toLowerCase()).not.toContain("gravity");
    // Probe must target a missing entity or attribute
    expect(probe).toContain("?");
  });
});
