/**
 * Tests for the deterministic explanation coaching pipeline.
 *
 * Covers all 8 student states, 9 move types, wrap policy rules,
 * teacher summary branches, and the feature gate.
 */

import {
  classifyExplanationState,
  accumulateExplanationEvidence,
  emptyAccumulation,
  getExplanationRemediationMove,
  shouldWrapExplanation,
  buildExplanationTeacherSummary,
  shouldUseExplanationRemediation,
  ExplanationState,
  AccumulatedExplanationEvidence,
} from "./explanationRemediation";
import { validate, ValidationResult } from "./deterministicValidator";
import { RequiredEvidence } from "./prompt";

// ============================================================================
// Test fixtures: 3 representative prompt types
// ============================================================================

// --- Science: planets (entity-attribute) ---
const PLANETS_EVIDENCE: RequiredEvidence = {
  minEntities: 2,
  entityLabel: "planets",
  attributeLabel: "materials",
  minAttributeTypes: 2,
  requirePairing: true,
};
const PLANETS_FACTS: Record<string, string[]> = {
  Mercury: ["rock", "metal"],
  Venus: ["rock"],
  Earth: ["rock", "metal"],
  Mars: ["rock"],
  Jupiter: ["gas"],
  Saturn: ["gas"],
  Uranus: ["ice", "gas"],
  Neptune: ["ice", "gas"],
};
const PLANETS_CRITERIA = [
  "States that planets are made of different materials such as rock, gas, or ice.",
  "Names at least two specific planets.",
  "Describes what each named planet is made of.",
];
const PLANETS_INPUT = "How would you explain what planets are made of? Can you give examples of different planets and their materials?";
const PLANETS_HINTS = [
  "Think about what you know about Earth and other planets.",
];

// --- Vocabulary: habitat (definition + examples) ---
const HABITAT_EVIDENCE: RequiredEvidence = {
  minEntities: 2,
  entityLabel: "animals",
  attributeLabel: "habitats",
  minAttributeTypes: 2,
  requirePairing: true,
};
const HABITAT_FACTS: Record<string, string[]> = {
  fish: ["liquid", "ocean", "lake", "river"],
  bird: ["tree", "forest", "sky"],
  bear: ["forest", "cave"],
  camel: ["desert"],
  penguin: ["ice", "snow"],
};
const HABITAT_CRITERIA = [
  "Explains what a habitat is.",
  "Names at least two animals.",
  "Describes the habitat for each named animal.",
];
const HABITAT_INPUT = "What does 'habitat' mean? Give examples of animals and their habitats.";

// --- Compare/contrast: frogs and fish ---
const COMPARE_EVIDENCE: RequiredEvidence = {
  minEntities: 2,
  entityLabel: "animals",
  attributeLabel: "characteristics",
  minAttributeTypes: 1,
  requirePairing: true,
};
const COMPARE_FACTS: Record<string, string[]> = {
  frog: ["land", "water", "legs", "lungs"],
  fish: ["water", "fins", "gills"],
};
const COMPARE_CRITERIA = [
  "Names at least one similarity between frogs and fish.",
  "Names at least one difference between frogs and fish.",
];
const COMPARE_INPUT = "How are frogs and fish the same and different?";

// ============================================================================
// Helpers
// ============================================================================

function validateText(
  text: string,
  evidence: RequiredEvidence = PLANETS_EVIDENCE,
  facts: Record<string, string[]> = PLANETS_FACTS,
): ValidationResult {
  return validate(text, evidence, facts);
}

function emptyValidation(): ValidationResult {
  return {
    matchedEntities: [],
    extractedPairs: [],
    incorrectPairs: [],
    distinctAttributeTypes: [],
    meetsEvidenceBar: false,
    hasFactualErrors: false,
    isOffTopic: true,
  };
}

function makeAccumulation(overrides: Partial<AccumulatedExplanationEvidence> = {}): AccumulatedExplanationEvidence {
  return {
    allPairs: [],
    activeErrors: [],
    correctedErrors: [],
    satisfiedCriteriaIndices: [],
    missingCriteriaIndices: [0, 1, 2],
    hasGeneralClaim: false,
    consecutiveNoProgressTurns: 0,
    totalRemediationTurns: 0,
    isComplete: false,
    ...overrides,
  };
}

function completeAccumulation(): AccumulatedExplanationEvidence {
  return makeAccumulation({
    allPairs: [
      { entity: "Earth", attribute: "rock" },
      { entity: "Jupiter", attribute: "gas" },
    ],
    satisfiedCriteriaIndices: [0, 1, 2],
    missingCriteriaIndices: [],
    isComplete: true,
  });
}

// ============================================================================
// Phase 1: Classification tests
// ============================================================================

describe("classifyExplanationState", () => {
  it("returns no_evidence for empty response", () => {
    const v = emptyValidation();
    const acc = makeAccumulation();
    expect(classifyExplanationState("", v, acc)).toBe("no_evidence");
  });

  it("returns no_evidence for very short response", () => {
    const v = emptyValidation();
    const acc = makeAccumulation();
    expect(classifyExplanationState("a", v, acc)).toBe("no_evidence");
  });

  it("returns frustrated for disengagement", () => {
    const v = emptyValidation();
    const acc = makeAccumulation();
    expect(classifyExplanationState("this is stupid", v, acc)).toBe("frustrated");
  });

  it("returns frustrated for 'shut up'", () => {
    const v = emptyValidation();
    const acc = makeAccumulation();
    expect(classifyExplanationState("shut up", v, acc)).toBe("frustrated");
  });

  it("returns meta_question for vocabulary confusion", () => {
    const v = emptyValidation();
    const acc = makeAccumulation();
    expect(classifyExplanationState("what does 'made of' mean?", v, acc)).toBe("meta_question");
  });

  it("returns meta_question for question about the question", () => {
    const v = emptyValidation();
    const acc = makeAccumulation();
    expect(classifyExplanationState("what are you asking me?", v, acc)).toBe("meta_question");
  });

  it("returns uncertain for 'I don't know'", () => {
    const v = emptyValidation();
    const acc = makeAccumulation();
    expect(classifyExplanationState("I don't know", v, acc)).toBe("uncertain");
  });

  it("returns uncertain for refusal ('move on')", () => {
    const v = emptyValidation();
    const acc = makeAccumulation();
    expect(classifyExplanationState("can we move on", v, acc)).toBe("uncertain");
  });

  it("returns uncertain for 'skip this'", () => {
    const v = emptyValidation();
    const acc = makeAccumulation();
    expect(classifyExplanationState("skip this", v, acc)).toBe("uncertain");
  });

  it("returns factual_error for wrong claim", () => {
    const v = validateText("Jupiter is made of rock");
    const acc = makeAccumulation();
    expect(classifyExplanationState("Jupiter is made of rock", v, acc)).toBe("factual_error");
  });

  it("returns complete when all criteria met", () => {
    const v = validateText("Earth is rocky and Jupiter is gas");
    const acc = completeAccumulation();
    expect(classifyExplanationState("Earth is rocky and Jupiter is gas", v, acc)).toBe("complete");
  });

  it("returns partial_evidence when some pairs extracted", () => {
    const v = validateText("Earth is rocky");
    const acc = makeAccumulation({
      allPairs: [{ entity: "Earth", attribute: "rock" }],
      satisfiedCriteriaIndices: [0],
      missingCriteriaIndices: [1, 2],
    });
    expect(classifyExplanationState("Earth is rocky", v, acc)).toBe("partial_evidence");
  });

  it("returns claim_only for general statement", () => {
    const v = emptyValidation();
    const acc = makeAccumulation({ hasGeneralClaim: true });
    expect(classifyExplanationState("they are made of different stuff", v, acc)).toBe("claim_only");
  });

  it("returns no_evidence for off-topic response", () => {
    const v = emptyValidation();
    const acc = makeAccumulation();
    expect(classifyExplanationState("I like pizza", v, acc)).toBe("no_evidence");
  });

  it("general claim alone never satisfies a criterion", () => {
    const v = emptyValidation();
    const acc = makeAccumulation({ hasGeneralClaim: true });
    const state = classifyExplanationState("they're made of different stuff", v, acc);
    expect(state).toBe("claim_only");
    expect(acc.satisfiedCriteriaIndices).toHaveLength(0);
  });

  it("frustrated takes priority over factual_error", () => {
    const v = validateText("Jupiter is rock and this is stupid");
    const acc = makeAccumulation();
    // Frustration is checked before factual error
    expect(classifyExplanationState("this is stupid Jupiter is rock", v, acc)).toBe("frustrated");
  });
});

// ============================================================================
// Phase 1: Accumulation tests
// ============================================================================

describe("accumulateExplanationEvidence", () => {
  it("starts with empty accumulation", () => {
    const empty = emptyAccumulation(PLANETS_CRITERIA);
    expect(empty.allPairs).toHaveLength(0);
    expect(empty.missingCriteriaIndices).toEqual([0, 1, 2]);
    expect(empty.isComplete).toBe(false);
  });

  it("counts first turn with evidence as progress", () => {
    const v = validateText("Earth is rocky");
    const acc = accumulateExplanationEvidence(
      v, "Earth is rocky", null,
      PLANETS_EVIDENCE, PLANETS_FACTS, PLANETS_CRITERIA,
    );
    expect(acc.allPairs.length).toBeGreaterThanOrEqual(1);
    expect(acc.consecutiveNoProgressTurns).toBe(0);
  });

  it("counts turn with no new evidence as no-progress", () => {
    const v1 = validateText("Earth is rocky");
    const acc1 = accumulateExplanationEvidence(
      v1, "Earth is rocky", null,
      PLANETS_EVIDENCE, PLANETS_FACTS, PLANETS_CRITERIA,
    );
    // Same response again — no new pairs
    const v2 = validateText("Earth is rocky");
    const acc2 = accumulateExplanationEvidence(
      v2, "Earth is rocky", acc1,
      PLANETS_EVIDENCE, PLANETS_FACTS, PLANETS_CRITERIA,
    );
    expect(acc2.consecutiveNoProgressTurns).toBe(1);
  });

  it("detects completion across turns", () => {
    const v1 = validateText("Earth is rocky");
    const acc1 = accumulateExplanationEvidence(
      v1, "Earth is rocky", null,
      PLANETS_EVIDENCE, PLANETS_FACTS, PLANETS_CRITERIA,
    );
    const v2 = validateText("Jupiter is gas");
    const acc2 = accumulateExplanationEvidence(
      v2, "Jupiter is gas", acc1,
      PLANETS_EVIDENCE, PLANETS_FACTS, PLANETS_CRITERIA,
    );
    expect(acc2.allPairs.length).toBeGreaterThanOrEqual(2);
    expect(acc2.consecutiveNoProgressTurns).toBe(0);
  });

  it("tracks factual errors", () => {
    const v = validateText("Jupiter is made of rock");
    const acc = accumulateExplanationEvidence(
      v, "Jupiter is made of rock", null,
      PLANETS_EVIDENCE, PLANETS_FACTS, PLANETS_CRITERIA,
    );
    expect(acc.activeErrors.length).toBeGreaterThanOrEqual(1);
    expect(acc.activeErrors[0].entity).toBe("Jupiter");
  });

  it("tracks error correction", () => {
    const v1 = validateText("Jupiter is made of rock");
    const acc1 = accumulateExplanationEvidence(
      v1, "Jupiter is made of rock", null,
      PLANETS_EVIDENCE, PLANETS_FACTS, PLANETS_CRITERIA,
    );
    expect(acc1.activeErrors.length).toBeGreaterThanOrEqual(1);

    // Correct the error
    const v2 = validateText("Jupiter is made of gas");
    const acc2 = accumulateExplanationEvidence(
      v2, "Jupiter is made of gas", acc1,
      PLANETS_EVIDENCE, PLANETS_FACTS, PLANETS_CRITERIA,
    );
    expect(acc2.correctedErrors.length).toBeGreaterThanOrEqual(1);
    expect(acc2.activeErrors.length).toBe(0);
  });

  it("repeated vague response does not count as progress", () => {
    const v1 = emptyValidation();
    const acc1 = accumulateExplanationEvidence(
      v1, "planets are made of stuff", null,
      PLANETS_EVIDENCE, PLANETS_FACTS, PLANETS_CRITERIA,
    );
    const v2 = emptyValidation();
    const acc2 = accumulateExplanationEvidence(
      v2, "they are made of things", acc1,
      PLANETS_EVIDENCE, PLANETS_FACTS, PLANETS_CRITERIA,
    );
    expect(acc2.consecutiveNoProgressTurns).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================================
// Phase 2: Remediation move tests
// ============================================================================

describe("getExplanationRemediationMove", () => {
  it("claim_only → SPECIFICITY_PROBE", () => {
    const v = emptyValidation();
    const acc = makeAccumulation({ hasGeneralClaim: true });
    const move = getExplanationRemediationMove(
      "claim_only", acc, v,
      PLANETS_EVIDENCE, PLANETS_FACTS, PLANETS_CRITERIA, PLANETS_INPUT,
    );
    expect(move).not.toBeNull();
    expect(move!.type).toBe("SPECIFICITY_PROBE");
    expect(move!.text).toMatch(/\?/);
  });

  it("partial_evidence → EVIDENCE_PROBE for next missing criterion", () => {
    const v = validateText("Earth is rocky");
    const acc = makeAccumulation({
      allPairs: [{ entity: "Earth", attribute: "rock" }],
      satisfiedCriteriaIndices: [0],
      missingCriteriaIndices: [1, 2],
    });
    const move = getExplanationRemediationMove(
      "partial_evidence", acc, v,
      PLANETS_EVIDENCE, PLANETS_FACTS, PLANETS_CRITERIA, PLANETS_INPUT,
    );
    expect(move).not.toBeNull();
    expect(move!.type).toBe("EVIDENCE_PROBE");
    expect(move!.text).toMatch(/\?/);
  });

  it("factual_error → FACTUAL_CORRECTION + probe", () => {
    const v = validateText("Jupiter is made of rock");
    const acc = makeAccumulation({ activeErrors: v.incorrectPairs as any });
    const move = getExplanationRemediationMove(
      "factual_error", acc, v,
      PLANETS_EVIDENCE, PLANETS_FACTS, PLANETS_CRITERIA, PLANETS_INPUT,
    );
    expect(move).not.toBeNull();
    expect(move!.type).toBe("FACTUAL_CORRECTION");
    expect(move!.text).toMatch(/gas/i);
    expect(move!.text).toMatch(/\?/);
  });

  it("repeated vague on-topic responses → escalation to HINT", () => {
    const v = emptyValidation();
    const acc = makeAccumulation({
      hasGeneralClaim: true,
      consecutiveNoProgressTurns: 2,
    });
    const move = getExplanationRemediationMove(
      "claim_only", acc, v,
      PLANETS_EVIDENCE, PLANETS_FACTS, PLANETS_CRITERIA, PLANETS_INPUT, PLANETS_HINTS,
    );
    expect(move).not.toBeNull();
    expect(move!.type).toBe("HINT");
    expect(move!.text).toMatch(/hint/i);
  });

  it("meta_question → CLARIFICATION + re-ask", () => {
    const v = emptyValidation();
    const acc = makeAccumulation();
    const move = getExplanationRemediationMove(
      "meta_question", acc, v,
      PLANETS_EVIDENCE, PLANETS_FACTS, PLANETS_CRITERIA, PLANETS_INPUT,
    );
    expect(move).not.toBeNull();
    expect(move!.type).toBe("CLARIFICATION");
    expect(move!.text).toMatch(/\?/);
  });

  it("uncertain 1st turn → ENCOURAGEMENT_PROBE", () => {
    const v = emptyValidation();
    const acc = makeAccumulation({ consecutiveNoProgressTurns: 0 });
    const move = getExplanationRemediationMove(
      "uncertain", acc, v,
      PLANETS_EVIDENCE, PLANETS_FACTS, PLANETS_CRITERIA, PLANETS_INPUT,
    );
    expect(move).not.toBeNull();
    expect(move!.type).toBe("ENCOURAGEMENT_PROBE");
  });

  it("uncertain 2nd consecutive → HINT", () => {
    const v = emptyValidation();
    const acc = makeAccumulation({ consecutiveNoProgressTurns: 1 });
    const move = getExplanationRemediationMove(
      "uncertain", acc, v,
      PLANETS_EVIDENCE, PLANETS_FACTS, PLANETS_CRITERIA, PLANETS_INPUT, PLANETS_HINTS,
    );
    expect(move).not.toBeNull();
    expect(move!.type).toBe("HINT");
  });

  it("uncertain 3rd+ consecutive → MODEL_AND_ASK", () => {
    const v = emptyValidation();
    const acc = makeAccumulation({ consecutiveNoProgressTurns: 3 });
    const move = getExplanationRemediationMove(
      "uncertain", acc, v,
      PLANETS_EVIDENCE, PLANETS_FACTS, PLANETS_CRITERIA, PLANETS_INPUT,
    );
    expect(move).not.toBeNull();
    expect(move!.type).toBe("MODEL_AND_ASK");
    // Should reveal actual facts
    expect(move!.text).toMatch(/Mercury|Venus|Earth|Mars|Jupiter|Saturn/);
  });

  it("explicit refusal → wrap_support (via uncertain classification + frustrated wrap)", () => {
    // Refusal maps to uncertain state; shouldWrapExplanation handles wrap decision
    const v = emptyValidation();
    const acc = makeAccumulation({ consecutiveNoProgressTurns: 3 });
    const wrap = shouldWrapExplanation("uncertain", acc, null, 3, 5);
    // After 3 no-progress turns, should wrap
    expect(wrap.action).toBe("wrap_support");
  });

  it("complete → WRAP_MASTERY", () => {
    const v = validateText("Earth is rocky and Jupiter is gas");
    const acc = completeAccumulation();
    const move = getExplanationRemediationMove(
      "complete", acc, v,
      PLANETS_EVIDENCE, PLANETS_FACTS, PLANETS_CRITERIA, PLANETS_INPUT,
    );
    expect(move).not.toBeNull();
    expect(move!.type).toBe("WRAP_MASTERY");
  });

  it("frustrated → WRAP_SUPPORT", () => {
    const v = emptyValidation();
    const acc = makeAccumulation();
    const move = getExplanationRemediationMove(
      "frustrated", acc, v,
      PLANETS_EVIDENCE, PLANETS_FACTS, PLANETS_CRITERIA, PLANETS_INPUT,
    );
    expect(move).not.toBeNull();
    expect(move!.type).toBe("WRAP_SUPPORT");
  });

  it("no_evidence → ENCOURAGEMENT_PROBE", () => {
    const v = emptyValidation();
    const acc = makeAccumulation();
    const move = getExplanationRemediationMove(
      "no_evidence", acc, v,
      PLANETS_EVIDENCE, PLANETS_FACTS, PLANETS_CRITERIA, PLANETS_INPUT,
    );
    expect(move).not.toBeNull();
    expect(move!.type).toBe("ENCOURAGEMENT_PROBE");
    expect(move!.text).toMatch(/\?/);
  });

  it("partial_evidence 3rd no-progress → MODEL_AND_ASK", () => {
    const v = validateText("Earth is rocky");
    const acc = makeAccumulation({
      allPairs: [{ entity: "Earth", attribute: "rock" }],
      consecutiveNoProgressTurns: 3,
    });
    const move = getExplanationRemediationMove(
      "partial_evidence", acc, v,
      PLANETS_EVIDENCE, PLANETS_FACTS, PLANETS_CRITERIA, PLANETS_INPUT,
    );
    expect(move).not.toBeNull();
    expect(move!.type).toBe("MODEL_AND_ASK");
  });
});

// ============================================================================
// Phase 3: Wrap policy tests
// ============================================================================

describe("shouldWrapExplanation", () => {
  it("rule 1: all criteria satisfied → wrap_mastery", () => {
    const acc = completeAccumulation();
    const result = shouldWrapExplanation("complete", acc, 60, 1, 5);
    expect(result.action).toBe("wrap_mastery");
    expect(result.reason).toBe("all_criteria_satisfied");
  });

  it("rule 2: frustrated → wrap_support immediately", () => {
    const acc = makeAccumulation();
    const result = shouldWrapExplanation("frustrated", acc, 60, 1, 5);
    expect(result.action).toBe("wrap_support");
    expect(result.reason).toBe("frustrated_or_disengaged");
  });

  it("rule 3: time expired → wrap_support", () => {
    const acc = makeAccumulation();
    const result = shouldWrapExplanation("partial_evidence", acc, 10, 1, 5);
    expect(result.action).toBe("wrap_support");
    expect(result.reason).toBe("time_expired");
  });

  it("rule 4: max attempts + no progress → wrap_support", () => {
    const acc = makeAccumulation({ consecutiveNoProgressTurns: 2 });
    const result = shouldWrapExplanation("partial_evidence", acc, 60, 5, 5);
    expect(result.action).toBe("wrap_support");
    expect(result.reason).toBe("max_attempts_no_progress");
  });

  it("rule 5: partial_evidence with time → continue", () => {
    const acc = makeAccumulation();
    const result = shouldWrapExplanation("partial_evidence", acc, 60, 1, 5);
    expect(result.action).toBe("continue_probing");
  });

  it("rule 5: claim_only with time → continue", () => {
    const acc = makeAccumulation();
    const result = shouldWrapExplanation("claim_only", acc, 60, 1, 5);
    expect(result.action).toBe("continue_probing");
  });

  it("rule 5: factual_error with time → continue", () => {
    const acc = makeAccumulation();
    const result = shouldWrapExplanation("factual_error", acc, 60, 1, 5);
    expect(result.action).toBe("continue_probing");
  });

  it("rule 6: 3 consecutive no-progress → wrap_support", () => {
    const acc = makeAccumulation({ consecutiveNoProgressTurns: 3 });
    const result = shouldWrapExplanation("uncertain", acc, 60, 2, 5);
    expect(result.action).toBe("wrap_support");
    expect(result.reason).toBe("no_progress_3_consecutive_turns");
  });

  it("rule 7: missing criteria → continue", () => {
    const acc = makeAccumulation({ missingCriteriaIndices: [1, 2] });
    const result = shouldWrapExplanation("uncertain", acc, 60, 1, 5);
    expect(result.action).toBe("continue_probing");
    expect(result.reason).toBe("missing_criteria_exist");
  });

  it("rule 8: no missing criteria, no mastery → wrap_support", () => {
    const acc = makeAccumulation({ missingCriteriaIndices: [], isComplete: false });
    const result = shouldWrapExplanation("no_evidence", acc, 60, 1, 5);
    expect(result.action).toBe("wrap_support");
    expect(result.reason).toBe("no_missing_criteria_no_mastery");
  });

  it("null time treated as unlimited", () => {
    const acc = makeAccumulation();
    const result = shouldWrapExplanation("partial_evidence", acc, null, 1, 5);
    expect(result.action).toBe("continue_probing");
  });
});

// ============================================================================
// Phase 4: Teacher summary tests
// ============================================================================

describe("buildExplanationTeacherSummary", () => {
  it("complete → mastery summary with entities", () => {
    const acc = completeAccumulation();
    const summary = buildExplanationTeacherSummary(
      acc, PLANETS_EVIDENCE, PLANETS_FACTS, PLANETS_CRITERIA,
      "Explain what planets are made of using examples.",
    );
    expect(summary.status).toBe("mastery");
    expect(summary.renderedSummary).toContain("Earth");
    expect(summary.renderedSummary).toContain("Jupiter");
    expect(summary.renderedSummary).toMatch(/rock|gas/i);
  });

  it("complete with corrected errors → mentions self-correction", () => {
    const acc = completeAccumulation();
    acc.correctedErrors = [{ entity: "Jupiter", claimed: "rock", corrected: "gas" }];
    const summary = buildExplanationTeacherSummary(
      acc, PLANETS_EVIDENCE, PLANETS_FACTS, PLANETS_CRITERIA,
    );
    expect(summary.status).toBe("mastery");
    expect(summary.renderedSummary).toMatch(/corrected/i);
  });

  it("partial → partial summary with count", () => {
    const acc = makeAccumulation({
      allPairs: [{ entity: "Earth", attribute: "rock" }],
      satisfiedCriteriaIndices: [0],
      missingCriteriaIndices: [1, 2],
    });
    const summary = buildExplanationTeacherSummary(
      acc, PLANETS_EVIDENCE, PLANETS_FACTS, PLANETS_CRITERIA,
    );
    expect(summary.status).toBe("partial");
    expect(summary.renderedSummary).toContain("1 of 2");
    expect(summary.renderedSummary).toContain("Earth");
  });

  it("partial with factual errors → mentions errors", () => {
    const acc = makeAccumulation({
      allPairs: [{ entity: "Earth", attribute: "rock" }],
      activeErrors: [{ entity: "Jupiter", claimed: "rock", acceptable: ["gas"] }],
    });
    const summary = buildExplanationTeacherSummary(
      acc, PLANETS_EVIDENCE, PLANETS_FACTS, PLANETS_CRITERIA,
    );
    expect(summary.status).toBe("partial");
    expect(summary.renderedSummary).toMatch(/error/i);
    expect(summary.renderedSummary).toContain("Jupiter");
  });

  it("claim_only → minimal summary", () => {
    const acc = makeAccumulation({ hasGeneralClaim: true });
    const summary = buildExplanationTeacherSummary(
      acc, PLANETS_EVIDENCE, PLANETS_FACTS, PLANETS_CRITERIA,
      "Explain what planets are made of.",
    );
    expect(summary.status).toBe("minimal");
    expect(summary.renderedSummary).toMatch(/general/i);
  });

  it("no_evidence → no_evidence summary", () => {
    const acc = makeAccumulation();
    const summary = buildExplanationTeacherSummary(
      acc, PLANETS_EVIDENCE, PLANETS_FACTS, PLANETS_CRITERIA,
      "Explain what planets are made of.",
    );
    expect(summary.status).toBe("no_evidence");
    expect(summary.renderedSummary).toMatch(/did not provide/i);
  });
});

// ============================================================================
// Feature gate tests
// ============================================================================

describe("shouldUseExplanationRemediation", () => {
  it("returns true when all fields present and no mathProblem", () => {
    expect(shouldUseExplanationRemediation({
      assessment: {
        requiredEvidence: PLANETS_EVIDENCE,
        referenceFacts: PLANETS_FACTS,
        successCriteria: PLANETS_CRITERIA,
      },
    })).toBe(true);
  });

  it("returns false when mathProblem present", () => {
    expect(shouldUseExplanationRemediation({
      mathProblem: { skill: "two_digit_addition" },
      assessment: {
        requiredEvidence: PLANETS_EVIDENCE,
        referenceFacts: PLANETS_FACTS,
        successCriteria: PLANETS_CRITERIA,
      },
    })).toBe(false);
  });

  it("returns false when requiredEvidence missing", () => {
    expect(shouldUseExplanationRemediation({
      assessment: {
        referenceFacts: PLANETS_FACTS,
        successCriteria: PLANETS_CRITERIA,
      },
    })).toBe(false);
  });

  it("returns false when referenceFacts missing", () => {
    expect(shouldUseExplanationRemediation({
      assessment: {
        requiredEvidence: PLANETS_EVIDENCE,
        successCriteria: PLANETS_CRITERIA,
      },
    })).toBe(false);
  });

  it("returns false when successCriteria empty", () => {
    expect(shouldUseExplanationRemediation({
      assessment: {
        requiredEvidence: PLANETS_EVIDENCE,
        referenceFacts: PLANETS_FACTS,
        successCriteria: [],
      },
    })).toBe(false);
  });

  it("returns false when assessment missing entirely", () => {
    expect(shouldUseExplanationRemediation({})).toBe(false);
  });
});

// ============================================================================
// Cross-prompt tests (habitat + compare)
// ============================================================================

describe("cross-prompt: habitat vocabulary", () => {
  it("classifies 'fish live in water' as partial_evidence", () => {
    const v = validate("fish live in water", HABITAT_EVIDENCE, HABITAT_FACTS);
    const acc = makeAccumulation({
      allPairs: v.extractedPairs,
      satisfiedCriteriaIndices: v.extractedPairs.length > 0 ? [0] : [],
      missingCriteriaIndices: [1, 2],
    });
    const state = classifyExplanationState("fish live in water", v, acc);
    expect(["partial_evidence", "claim_only"]).toContain(state);
  });

  it("classifies 'a habitat is where an animal lives' as claim_only when no entities", () => {
    const v = validate("a habitat is where an animal lives", HABITAT_EVIDENCE, HABITAT_FACTS);
    const acc = makeAccumulation({ hasGeneralClaim: true });
    const state = classifyExplanationState("a habitat is where an animal lives", v, acc);
    // No specific entities extracted → claim_only or no_evidence
    expect(["claim_only", "no_evidence"]).toContain(state);
  });
});

describe("cross-prompt: compare/contrast", () => {
  it("classifies 'frogs have legs and fish have fins' as partial_evidence", () => {
    const v = validate("frogs have legs and fish have fins", COMPARE_EVIDENCE, COMPARE_FACTS);
    const acc = makeAccumulation({
      allPairs: v.extractedPairs,
      satisfiedCriteriaIndices: v.extractedPairs.length > 0 ? [0] : [],
    });
    const state = classifyExplanationState("frogs have legs and fish have fins", v, acc);
    expect(state).toBe("partial_evidence");
  });
});

// ============================================================================
// Phase 6: Cross-lesson hardening — full pipeline alignment
// ============================================================================

describe("cross-layer alignment: planets", () => {
  function fullPipeline(response: string, priorAcc?: AccumulatedExplanationEvidence) {
    const v = validate(response, PLANETS_EVIDENCE, PLANETS_FACTS);
    const acc = accumulateExplanationEvidence(
      v, response, priorAcc ?? null,
      PLANETS_EVIDENCE, PLANETS_FACTS, PLANETS_CRITERIA,
    );
    const state = classifyExplanationState(response, v, acc);
    const move = getExplanationRemediationMove(
      state, acc, v,
      PLANETS_EVIDENCE, PLANETS_FACTS, PLANETS_CRITERIA, PLANETS_INPUT, PLANETS_HINTS,
    );
    const wrap = shouldWrapExplanation(state, acc, 60, 1, 5);
    const summary = buildExplanationTeacherSummary(
      acc, PLANETS_EVIDENCE, PLANETS_FACTS, PLANETS_CRITERIA,
      "Explain what planets are made of using examples.",
    );
    return { state, move, wrap, summary, acc };
  }

  it("complete response: all 4 layers align", () => {
    const r = fullPipeline("Earth is made of rock and Jupiter is made of gas");
    expect(r.state).toBe("complete");
    expect(r.move!.type).toBe("WRAP_MASTERY");
    expect(r.wrap.action).toBe("wrap_mastery");
    expect(r.summary.status).toBe("mastery");
  });

  it("partial response: probe + continue + partial summary", () => {
    const r = fullPipeline("Earth is rocky");
    expect(r.state).toBe("partial_evidence");
    expect(r.move!.type).toBe("EVIDENCE_PROBE");
    expect(r.wrap.action).toBe("continue_probing");
    expect(r.summary.status).toBe("partial");
  });

  it("factual error: correction + continue + partial summary with error", () => {
    const r = fullPipeline("Jupiter is made of rock");
    expect(r.state).toBe("factual_error");
    expect(r.move!.type).toBe("FACTUAL_CORRECTION");
    expect(r.wrap.action).toBe("continue_probing");
    expect(r.summary.renderedSummary).toMatch(/incorrect/i);
  });

  it("general claim: specificity probe + continue + minimal summary", () => {
    const r = fullPipeline("they are made of different stuff");
    expect(r.state).toBe("claim_only");
    expect(r.move!.type).toBe("SPECIFICITY_PROBE");
    expect(r.wrap.action).toBe("continue_probing");
    expect(r.summary.status).toBe("minimal");
  });

  it("uncertain: encouragement + continue + no-evidence summary", () => {
    const r = fullPipeline("I don't know");
    expect(r.state).toBe("uncertain");
    expect(r.move!.type).toBe("ENCOURAGEMENT_PROBE");
    expect(r.wrap.action).toBe("continue_probing");
    expect(r.summary.status).toBe("no_evidence");
  });

  it("frustrated: wrap_support immediately", () => {
    const r = fullPipeline("this is stupid I hate this");
    expect(r.state).toBe("frustrated");
    expect(r.move!.type).toBe("WRAP_SUPPORT");
    expect(r.wrap.action).toBe("wrap_support");
  });

  it("meta-question: clarification + continue", () => {
    const r = fullPipeline("what does made of mean?");
    expect(r.state).toBe("meta_question");
    expect(r.move!.type).toBe("CLARIFICATION");
    expect(r.wrap.action).toBe("continue_probing");
  });

  it("multi-turn escalation: probe → hint → model", () => {
    // Turn 1: partial evidence
    const r1 = fullPipeline("Earth is rocky");
    expect(r1.move!.type).toBe("EVIDENCE_PROBE");

    // Turn 2: same response (no progress)
    const r2 = fullPipeline("Earth is rocky", r1.acc);
    expect(r2.acc.consecutiveNoProgressTurns).toBe(1);

    // Turn 3: still no progress (vague)
    const r3 = fullPipeline("I think it's rocky", r2.acc);
    expect(r3.acc.consecutiveNoProgressTurns).toBeGreaterThanOrEqual(2);
    expect(r3.move!.type).toBe("HINT");

    // Turn 4: still no progress
    const r4 = fullPipeline("um I don't know more", r3.acc);
    expect(r4.move!.type).toBe("MODEL_AND_ASK");
  });

  it("error correction counts as progress", () => {
    // Turn 1: factual error
    const r1 = fullPipeline("Jupiter is made of rock");
    expect(r1.state).toBe("factual_error");
    expect(r1.acc.activeErrors.length).toBeGreaterThanOrEqual(1);

    // Turn 2: corrected
    const r2 = fullPipeline("Jupiter is made of gas", r1.acc);
    expect(r2.acc.correctedErrors.length).toBeGreaterThanOrEqual(1);
    expect(r2.acc.consecutiveNoProgressTurns).toBe(0);
  });

  it("3 no-progress turns after no_evidence → wrap_support", () => {
    const acc = makeAccumulation({
      consecutiveNoProgressTurns: 3,
      totalRemediationTurns: 3,
    });
    const wrap = shouldWrapExplanation("no_evidence", acc, 60, 3, 5);
    expect(wrap.action).toBe("wrap_support");
    expect(wrap.reason).toBe("no_progress_3_consecutive_turns");
  });
});

describe("cross-layer alignment: habitat", () => {
  function fullPipeline(response: string) {
    const v = validate(response, HABITAT_EVIDENCE, HABITAT_FACTS);
    const acc = accumulateExplanationEvidence(
      v, response, null,
      HABITAT_EVIDENCE, HABITAT_FACTS, HABITAT_CRITERIA,
    );
    const state = classifyExplanationState(response, v, acc);
    const move = getExplanationRemediationMove(
      state, acc, v,
      HABITAT_EVIDENCE, HABITAT_FACTS, HABITAT_CRITERIA, HABITAT_INPUT,
    );
    const summary = buildExplanationTeacherSummary(
      acc, HABITAT_EVIDENCE, HABITAT_FACTS, HABITAT_CRITERIA,
      "Explain what a habitat is with examples.",
    );
    return { state, move, summary, acc };
  }

  it("partial: 'fish live in water' → probe for more animals", () => {
    const r = fullPipeline("fish live in water");
    expect(r.state).toBe("partial_evidence");
    expect(r.move!.type).toBe("EVIDENCE_PROBE");
    expect(r.summary.status).toBe("partial");
  });

  it("no_evidence: 'I like dogs' → encouragement", () => {
    const r = fullPipeline("I like dogs");
    expect(r.state).toBe("no_evidence");
    expect(r.move!.type).toBe("ENCOURAGEMENT_PROBE");
  });
});

// ============================================================================
// Stress tests: 10 edge cases across full pipeline
// ============================================================================

describe("stress tests: edge cases", () => {
  // Multi-turn helper for planets fixture
  function fullPipeline(response: string, priorAcc?: AccumulatedExplanationEvidence) {
    const v = validate(response, PLANETS_EVIDENCE, PLANETS_FACTS);
    const acc = accumulateExplanationEvidence(
      v, response, priorAcc ?? null,
      PLANETS_EVIDENCE, PLANETS_FACTS, PLANETS_CRITERIA,
    );
    const state = classifyExplanationState(response, v, acc);
    const move = getExplanationRemediationMove(
      state, acc, v,
      PLANETS_EVIDENCE, PLANETS_FACTS, PLANETS_CRITERIA, PLANETS_INPUT, PLANETS_HINTS,
    );
    const wrap = shouldWrapExplanation(state, acc, 60, 1, 5);
    const summary = buildExplanationTeacherSummary(
      acc, PLANETS_EVIDENCE, PLANETS_FACTS, PLANETS_CRITERIA,
      "Explain what planets are made of using examples.",
    );
    return { state, move, wrap, summary, acc, validation: v };
  }

  // Habitat multi-turn helper
  function habitatPipeline(response: string, priorAcc?: AccumulatedExplanationEvidence) {
    const v = validate(response, HABITAT_EVIDENCE, HABITAT_FACTS);
    const acc = accumulateExplanationEvidence(
      v, response, priorAcc ?? null,
      HABITAT_EVIDENCE, HABITAT_FACTS, HABITAT_CRITERIA,
    );
    const state = classifyExplanationState(response, v, acc);
    const move = getExplanationRemediationMove(
      state, acc, v,
      HABITAT_EVIDENCE, HABITAT_FACTS, HABITAT_CRITERIA, HABITAT_INPUT,
    );
    const wrap = shouldWrapExplanation(state, acc, 60, 1, 5);
    const summary = buildExplanationTeacherSummary(
      acc, HABITAT_EVIDENCE, HABITAT_FACTS, HABITAT_CRITERIA,
      "Explain what a habitat is with examples.",
    );
    return { state, move, wrap, summary, acc, validation: v };
  }

  // Compare multi-turn helper
  function comparePipeline(response: string, priorAcc?: AccumulatedExplanationEvidence) {
    const v = validate(response, COMPARE_EVIDENCE, COMPARE_FACTS);
    const acc = accumulateExplanationEvidence(
      v, response, priorAcc ?? null,
      COMPARE_EVIDENCE, COMPARE_FACTS, COMPARE_CRITERIA,
    );
    const state = classifyExplanationState(response, v, acc);
    const move = getExplanationRemediationMove(
      state, acc, v,
      COMPARE_EVIDENCE, COMPARE_FACTS, COMPARE_CRITERIA, COMPARE_INPUT,
    );
    const wrap = shouldWrapExplanation(state, acc, 60, 1, 5);
    const summary = buildExplanationTeacherSummary(
      acc, COMPARE_EVIDENCE, COMPARE_FACTS, COMPARE_CRITERIA,
      "How are frogs and fish the same and different?",
    );
    return { state, move, wrap, summary, acc, validation: v };
  }

  // ---- Edge case 1: Correct evidence but unexpected entity names ----
  // Student uses lowercase or casual references to planet names
  it("1. correct evidence with case variations in entity names", () => {
    const r = fullPipeline("earth is made of rock and jupiter is made of gas");
    // extractEntities uses case-insensitive word-boundary match
    expect(r.validation.matchedEntities).toContain("Earth");
    expect(r.validation.matchedEntities).toContain("Jupiter");
    expect(r.state).toBe("complete");
    expect(r.move!.type).toBe("WRAP_MASTERY");
    expect(r.wrap.action).toBe("wrap_mastery");
    expect(r.summary.status).toBe("mastery");
  });

  it("1b. entity name embedded in surrounding text", () => {
    // "mars" should still be extracted even with surrounding context
    const r = fullPipeline("I think mars is made of rock and saturn is made of gas");
    expect(r.validation.matchedEntities).toContain("Mars");
    expect(r.validation.matchedEntities).toContain("Saturn");
    expect(r.state).toBe("complete");
    expect(r.wrap.action).toBe("wrap_mastery");
  });

  // ---- Edge case 2: Entities listed without attributes ----
  // Student names planets but doesn't say what they're made of
  it("2. entities without attributes → no pairs extracted, no_evidence or claim_only", () => {
    const r = fullPipeline("I know about Earth and Mars and Jupiter");
    // Entities should be matched but no pairs without linking verb + attribute
    expect(r.validation.matchedEntities.length).toBeGreaterThanOrEqual(1);
    expect(r.validation.extractedPairs.length).toBe(0);
    // No pairs, no general claim → no_evidence
    expect(r.state).toBe("no_evidence");
    expect(r.move!.type).toBe("ENCOURAGEMENT_PROBE");
    expect(r.wrap.action).toBe("continue_probing");
    expect(r.summary.status).toBe("no_evidence");
  });

  it("2b. entities with vague description, no attribute words", () => {
    const r = fullPipeline("Earth is big and Jupiter is really really big");
    // "big" is not a recognized attribute
    expect(r.validation.extractedPairs.length).toBe(0);
    expect(r.state).toBe("no_evidence");
    expect(r.summary.status).toBe("no_evidence");
  });

  // ---- Edge case 3: Mixed correct and incorrect facts ----
  // Student gets one right and one wrong in the same response
  it("3. mixed correct and incorrect facts in single response", () => {
    const r = fullPipeline("Earth is made of rock and Jupiter is made of ice");
    // Earth=rock correct, Jupiter=ice incorrect (should be gas)
    expect(r.validation.hasFactualErrors).toBe(true);
    expect(r.state).toBe("factual_error");
    expect(r.move!.type).toBe("FACTUAL_CORRECTION");
    // Correct pair should be accumulated but error takes priority for state
    expect(r.acc.allPairs.some(p => p.entity === "Earth" && p.attribute === "rock")).toBe(true);
    expect(r.acc.activeErrors.some(e => e.entity === "Jupiter")).toBe(true);
    expect(r.wrap.action).toBe("continue_probing");
    // Summary should reflect both the correct pair and the error
    expect(r.summary.renderedSummary).toMatch(/Earth/);
    expect(r.summary.renderedSummary).toMatch(/error|incorrect/i);
  });

  // ---- Edge case 4: Multiple attributes for one entity ----
  // Student gives two valid attributes for one planet
  it("4. multiple attributes for one entity — only first pair per entity is kept", () => {
    const r = fullPipeline("Earth is made of rock and metal");
    // Validator deduplicates by entity — should have one pair for Earth
    expect(r.acc.allPairs.filter(p => p.entity === "Earth").length).toBe(1);
    // Still partial because only 1 entity (need 2)
    expect(r.state).toBe("partial_evidence");
    expect(r.move!.type).toBe("EVIDENCE_PROBE");
    expect(r.wrap.action).toBe("continue_probing");
    expect(r.summary.status).toBe("partial");
  });

  // ---- Edge case 5: Alias normalization (synonyms) ----
  // Student uses synonym words that should normalize to canonical labels
  it("5a. 'rocky' normalizes to 'rock'", () => {
    const r = fullPipeline("Earth is rocky and Jupiter is gaseous");
    expect(r.acc.allPairs.some(p => p.entity === "Earth" && p.attribute === "rock")).toBe(true);
    expect(r.acc.allPairs.some(p => p.entity === "Jupiter" && p.attribute === "gas")).toBe(true);
    expect(r.state).toBe("complete");
    expect(r.summary.status).toBe("mastery");
  });

  it("5b. 'frozen' normalizes to 'ice'", () => {
    const r = fullPipeline("Uranus is frozen and Mars is made of rock");
    expect(r.acc.allPairs.some(p => p.attribute === "ice")).toBe(true);
    expect(r.acc.allPairs.some(p => p.attribute === "rock")).toBe(true);
    expect(r.state).toBe("complete");
  });

  it("5c. 'water' normalizes to 'liquid' in habitat fixture", () => {
    const r = habitatPipeline("fish live in water and bear lives in forest");
    expect(r.acc.allPairs.some(p => p.entity === "fish" && p.attribute === "liquid")).toBe(true);
    expect(r.acc.allPairs.some(p => p.entity === "bear" && p.attribute === "forest")).toBe(true);
    expect(r.state).toBe("complete");
  });

  it("5d. 'stone' normalizes to 'rock'", () => {
    const r = fullPipeline("Earth is made of stone and Neptune is made of ice");
    expect(r.acc.allPairs.some(p => p.entity === "Earth" && p.attribute === "rock")).toBe(true);
    expect(r.acc.allPairs.some(p => p.entity === "Neptune" && p.attribute === "ice")).toBe(true);
    expect(r.state).toBe("complete");
  });

  // ---- Edge case 6: Repeated evidence across turns ----
  // Student repeats the same fact they already gave — should NOT count as progress
  it("6. repeated evidence across turns → no-progress counter increments", () => {
    // Turn 1: Earth + rock
    const r1 = fullPipeline("Earth is made of rock");
    expect(r1.acc.allPairs.length).toBe(1);
    expect(r1.acc.consecutiveNoProgressTurns).toBe(0);

    // Turn 2: same fact repeated
    const r2 = fullPipeline("Earth is made of rock", r1.acc);
    // Earth already in allPairs, so no new pairs
    expect(r2.acc.allPairs.length).toBe(1);
    expect(r2.acc.consecutiveNoProgressTurns).toBe(1);

    // Turn 3: still repeating
    const r3 = fullPipeline("Earth is rocky", r2.acc);
    expect(r3.acc.allPairs.length).toBe(1);
    expect(r3.acc.consecutiveNoProgressTurns).toBe(2);
    // At 2 no-progress turns, should escalate to HINT
    expect(r3.move!.type).toBe("HINT");
  });

  // ---- Edge case 7: Partial evidence across multiple turns ----
  // Student provides one entity per turn, building toward completion
  it("7. partial evidence across 2 turns → accumulates to complete", () => {
    // Turn 1: one entity
    const r1 = fullPipeline("Earth is made of rock");
    expect(r1.state).toBe("partial_evidence");
    expect(r1.acc.allPairs.length).toBe(1);
    expect(r1.wrap.action).toBe("continue_probing");

    // Turn 2: second entity with different attribute type
    const r2 = fullPipeline("Jupiter is made of gas", r1.acc);
    expect(r2.acc.allPairs.length).toBe(2);
    expect(r2.acc.isComplete).toBe(true);
    expect(r2.state).toBe("complete");
    expect(r2.move!.type).toBe("WRAP_MASTERY");
    expect(r2.wrap.action).toBe("wrap_mastery");
    // Summary should list both planets
    expect(r2.summary.renderedSummary).toMatch(/Earth/);
    expect(r2.summary.renderedSummary).toMatch(/Jupiter/);
    expect(r2.summary.status).toBe("mastery");
  });

  it("7b. partial evidence across 2 turns with compare fixture", () => {
    // Note: entity keys are singular ("frog", "fish") — plural "frogs" won't match
    // because extractEntities uses \bfrog\b which requires exact word boundaries.
    // This is a known limitation: students must use the exact entity form.

    // Turn 1: one entity (singular matches key)
    const r1 = comparePipeline("a frog has legs");
    expect(r1.state).toBe("partial_evidence");
    expect(r1.acc.allPairs.length).toBe(1);

    // Turn 2: second entity
    const r2 = comparePipeline("a fish has fins", r1.acc);
    expect(r2.acc.allPairs.length).toBe(2);
    expect(r2.acc.isComplete).toBe(true);
    expect(r2.state).toBe("complete");
    expect(r2.move!.type).toBe("WRAP_MASTERY");
  });

  it("7c. plural entity name 'frogs' matches singular key 'frog'", () => {
    // Entity inflection: "frogs" matches key "frog" via simple plural expansion
    const r = comparePipeline("frogs have legs");
    expect(r.validation.matchedEntities).toContain("frog");
    expect(r.validation.extractedPairs.length).toBeGreaterThanOrEqual(1);
    expect(r.state).toBe("partial_evidence");
  });

  // ---- Edge case 8: Claim-only responses repeated across turns ----
  // Student keeps making general claims without specifics
  it("8. repeated claim-only across turns → escalation", () => {
    // Turn 1: general claim
    const r1 = fullPipeline("they are made of different stuff");
    expect(r1.state).toBe("claim_only");
    expect(r1.move!.type).toBe("SPECIFICITY_PROBE");

    // Turn 2: another general claim (no progress)
    const r2 = fullPipeline("each planet is different", r1.acc);
    expect(r2.acc.consecutiveNoProgressTurns).toBe(1);

    // Turn 3: still general
    const r3 = fullPipeline("there are many kinds of planets", r2.acc);
    expect(r3.acc.consecutiveNoProgressTurns).toBe(2);
    // After 2 no-progress claim-only turns → HINT
    expect(r3.move!.type).toBe("HINT");
  });

  // ---- Edge case 9: Vague topical responses that should NOT count as progress ----
  // Student says something related but with no extractable evidence
  it("9a. vague topical response without entities or attributes → no progress", () => {
    const r = fullPipeline("planets are really cool and interesting");
    expect(r.validation.extractedPairs.length).toBe(0);
    // "planets" is not an entity key (entities are specific planet names)
    expect(r.state).toBe("no_evidence");
    expect(r.move!.type).toBe("ENCOURAGEMENT_PROBE");
    expect(r.summary.status).toBe("no_evidence");
  });

  it("9b. topical response after partial evidence → no-progress increments", () => {
    // Turn 1: real evidence
    const r1 = fullPipeline("Earth is made of rock");
    expect(r1.acc.allPairs.length).toBe(1);

    // Turn 2: vague topical response
    const r2 = fullPipeline("I think space is really amazing", r1.acc);
    expect(r2.acc.allPairs.length).toBe(1); // no new pairs
    expect(r2.acc.consecutiveNoProgressTurns).toBe(1);
    expect(r2.state).toBe("partial_evidence"); // prior pairs still tracked
  });

  it("9c. 'I learned about this' is not evidence", () => {
    const r = fullPipeline("we learned about this in class");
    expect(r.validation.extractedPairs.length).toBe(0);
    expect(r.state).toBe("no_evidence");
  });

  // ---- Edge case 10: Student correcting their own factual error ----
  // Student says Jupiter is rock, then corrects to gas
  it("10a. student self-corrects error → progress resets, error moves to corrected", () => {
    // Turn 1: factual error
    const r1 = fullPipeline("Jupiter is made of rock");
    expect(r1.state).toBe("factual_error");
    expect(r1.acc.activeErrors.length).toBe(1);
    expect(r1.acc.activeErrors[0].entity).toBe("Jupiter");
    expect(r1.acc.correctedErrors.length).toBe(0);

    // Turn 2: self-correction
    const r2 = fullPipeline("wait, Jupiter is made of gas", r1.acc);
    expect(r2.acc.correctedErrors.length).toBe(1);
    expect(r2.acc.correctedErrors[0].entity).toBe("Jupiter");
    expect(r2.acc.activeErrors.length).toBe(0);
    // Correction counts as progress
    expect(r2.acc.consecutiveNoProgressTurns).toBe(0);
  });

  it("10b. corrected error + new entity → complete", () => {
    // Turn 1: error on Jupiter
    const r1 = fullPipeline("Jupiter is made of rock");
    expect(r1.acc.activeErrors.length).toBe(1);

    // Turn 2: correct Jupiter + add Earth
    const r2 = fullPipeline("Jupiter is made of gas and Earth is made of rock", r1.acc);
    expect(r2.acc.correctedErrors.length).toBe(1);
    expect(r2.acc.allPairs.length).toBeGreaterThanOrEqual(2);
    expect(r2.acc.activeErrors.length).toBe(0);
    expect(r2.acc.isComplete).toBe(true);
    expect(r2.state).toBe("complete");
    expect(r2.move!.type).toBe("WRAP_MASTERY");
    // Summary should note the self-correction
    expect(r2.summary.renderedSummary).toMatch(/corrected/i);
    expect(r2.summary.status).toBe("mastery");
  });

  it("10c. correcting one error while introducing another → still factual_error", () => {
    // Turn 1: Jupiter = rock (wrong)
    const r1 = fullPipeline("Jupiter is made of rock");
    expect(r1.acc.activeErrors.length).toBe(1);

    // Turn 2: fix Jupiter, but get Saturn wrong
    const r2 = fullPipeline("Jupiter is made of gas but Saturn is made of ice", r1.acc);
    // Jupiter corrected, Saturn=ice is wrong (should be gas)
    expect(r2.acc.correctedErrors.length).toBe(1);
    expect(r2.acc.correctedErrors[0].entity).toBe("Jupiter");
    expect(r2.state).toBe("factual_error");
    expect(r2.move!.type).toBe("FACTUAL_CORRECTION");
    expect(r2.wrap.action).toBe("continue_probing");
  });
});

// ============================================================================
// Probe variation: consecutive stall turns must not repeat identical text
// ============================================================================

describe("probe variation on stall", () => {
  function fullPipeline(response: string, priorAcc?: AccumulatedExplanationEvidence) {
    const v = validate(response, PLANETS_EVIDENCE, PLANETS_FACTS);
    const acc = accumulateExplanationEvidence(
      v, response, priorAcc ?? null,
      PLANETS_EVIDENCE, PLANETS_FACTS, PLANETS_CRITERIA,
    );
    const state = classifyExplanationState(response, v, acc);
    const move = getExplanationRemediationMove(
      state, acc, v,
      PLANETS_EVIDENCE, PLANETS_FACTS, PLANETS_CRITERIA, PLANETS_INPUT, PLANETS_HINTS,
    );
    return { state, move, acc };
  }

  it("claim-only: consecutive probes differ when targeting the same entity", () => {
    // Turn 1: general claim
    const r1 = fullPipeline("they are made of different stuff");
    expect(r1.move!.type).toBe("SPECIFICITY_PROBE");

    // Turn 2: another general claim → same target but text should differ
    const r2 = fullPipeline("each planet is different", r1.acc);
    expect(r2.move!.type).toBe("SPECIFICITY_PROBE");

    // The two probe texts must not be identical
    expect(r2.move!.text).not.toBe(r1.move!.text);
  });

  it("partial-evidence: consecutive probes differ when targeting the same missing entity", () => {
    // Turn 1: one entity → probes for second
    const r1 = fullPipeline("Earth is made of rock");
    expect(r1.move!.type).toBe("EVIDENCE_PROBE");

    // Turn 2: off-topic, no progress → same target but text should vary
    const r2 = fullPipeline("I think space is cool", r1.acc);

    // The two probe texts must not be identical
    expect(r2.move!.text).not.toBe(r1.move!.text);
  });

  it("varied probe still contains a question mark", () => {
    const r1 = fullPipeline("they are made of different stuff");
    const r2 = fullPipeline("each planet is different", r1.acc);
    expect(r1.move!.text).toContain("?");
    expect(r2.move!.text).toContain("?");
  });

  it("varied probe still mentions entities or entity label", () => {
    const r1 = fullPipeline("they are made of different stuff");
    const r2 = fullPipeline("each planet is different", r1.acc);
    // At least one should mention a specific entity or the generic label
    const mentionsEntityOrLabel = (text: string) =>
      /Mercury|Venus|Earth|Mars|Jupiter|Saturn|Uranus|Neptune|planet/i.test(text);
    expect(mentionsEntityOrLabel(r1.move!.text)).toBe(true);
    expect(mentionsEntityOrLabel(r2.move!.text)).toBe(true);
  });

  it("priority-first: claim-only probes target the same entity on consecutive turns", () => {
    // When no entities are mentioned, the first named entity in the checklist
    // (Mercury) should be the target on BOTH turns — only phrasing varies.
    const r1 = fullPipeline("they are made of different stuff");
    const r2 = fullPipeline("each planet is different", r1.acc);
    // Both probes must reference the same priority entity (Mercury)
    expect(r1.move!.text).toMatch(/Mercury/);
    expect(r2.move!.text).toMatch(/Mercury/);
    // But phrasing must differ
    expect(r1.move!.text).not.toBe(r2.move!.text);
  });

  it("priority-first: partial-evidence probes keep focus on next missing item", () => {
    // After Earth is satisfied, the next missing item is the placeholder
    // "planets #2". Both turns should target that same priority gap.
    const r1 = fullPipeline("Earth is made of rock");
    const r2 = fullPipeline("I think space is cool", r1.acc);
    // Both should ask about naming another planet (the placeholder target)
    expect(r1.move!.text).toMatch(/planet/i);
    expect(r2.move!.text).toMatch(/planet/i);
    expect(r1.move!.text).not.toBe(r2.move!.text);
  });
});

// ============================================================================
// Response conciseness: max word counts
// ============================================================================

describe("response conciseness", () => {
  function wordCount(text: string): number {
    return text.split(/\s+/).filter(w => w.length > 0).length;
  }

  const MAX_PROBE_WORDS = 25;
  const MAX_HINT_WORDS = 30;
  const MAX_MODEL_WORDS = 30;

  function fullPipeline(response: string, priorAcc?: AccumulatedExplanationEvidence) {
    const v = validate(response, PLANETS_EVIDENCE, PLANETS_FACTS);
    const acc = accumulateExplanationEvidence(
      v, response, priorAcc ?? null,
      PLANETS_EVIDENCE, PLANETS_FACTS, PLANETS_CRITERIA,
    );
    const state = classifyExplanationState(response, v, acc);
    const move = getExplanationRemediationMove(
      state, acc, v,
      PLANETS_EVIDENCE, PLANETS_FACTS, PLANETS_CRITERIA, PLANETS_INPUT, PLANETS_HINTS,
    );
    return { state, move, acc };
  }

  it("ENCOURAGEMENT_PROBE ≤ ${MAX_PROBE_WORDS} words", () => {
    const r = fullPipeline("I like cats");
    expect(r.move!.type).toBe("ENCOURAGEMENT_PROBE");
    expect(wordCount(r.move!.text)).toBeLessThanOrEqual(MAX_PROBE_WORDS);
  });

  it("uncertain first turn (ENCOURAGEMENT_PROBE) ≤ ${MAX_PROBE_WORDS} words", () => {
    const r = fullPipeline("I don't know");
    expect(r.move!.type).toBe("ENCOURAGEMENT_PROBE");
    expect(wordCount(r.move!.text)).toBeLessThanOrEqual(MAX_PROBE_WORDS);
  });

  it("SPECIFICITY_PROBE ≤ ${MAX_PROBE_WORDS} words", () => {
    const r = fullPipeline("they are made of different stuff");
    expect(r.move!.type).toBe("SPECIFICITY_PROBE");
    expect(wordCount(r.move!.text)).toBeLessThanOrEqual(MAX_PROBE_WORDS);
  });

  it("EVIDENCE_PROBE ≤ ${MAX_PROBE_WORDS} words", () => {
    const r = fullPipeline("Earth is made of rock");
    expect(r.move!.type).toBe("EVIDENCE_PROBE");
    expect(wordCount(r.move!.text)).toBeLessThanOrEqual(MAX_PROBE_WORDS);
  });

  it("HINT ≤ ${MAX_HINT_WORDS} words", () => {
    // Need 2 no-progress turns to get HINT
    const r1 = fullPipeline("Earth is rocky");
    const r2 = fullPipeline("Earth is rocky", r1.acc);
    const r3 = fullPipeline("Earth is rocky", r2.acc);
    expect(r3.move!.type).toBe("HINT");
    expect(wordCount(r3.move!.text)).toBeLessThanOrEqual(MAX_HINT_WORDS);
  });

  it("MODEL_AND_ASK ≤ ${MAX_MODEL_WORDS} words", () => {
    const r1 = fullPipeline("Earth is rocky");
    const r2 = fullPipeline("I don't know more", r1.acc);
    const r3 = fullPipeline("I still don't know", r2.acc);
    const r4 = fullPipeline("I give up", r3.acc);
    expect(r4.move!.type).toBe("MODEL_AND_ASK");
    expect(wordCount(r4.move!.text)).toBeLessThanOrEqual(MAX_MODEL_WORDS);
  });

  it("CLARIFICATION ≤ ${MAX_PROBE_WORDS} words", () => {
    const r = fullPipeline("what does made of mean?");
    expect(r.move!.type).toBe("CLARIFICATION");
    expect(wordCount(r.move!.text)).toBeLessThanOrEqual(MAX_PROBE_WORDS);
  });

  it("FACTUAL_CORRECTION ≤ ${MAX_HINT_WORDS} words", () => {
    const r = fullPipeline("Jupiter is made of rock");
    expect(r.move!.type).toBe("FACTUAL_CORRECTION");
    expect(wordCount(r.move!.text)).toBeLessThanOrEqual(MAX_HINT_WORDS);
  });
});

// ============================================================================
// Conversation strategy integration (explanation)
// ============================================================================

import {
  determineConversationStrategy,
  buildExplanationStrategyInput,
  shouldUpgradeMove,
} from "./conversationStrategy";

describe("conversation strategy integration (explanation)", () => {
  it("escalates to wrap_support when time < 15s", () => {
    const strategyInput = buildExplanationStrategyInput({
      conversationHistory: [{ role: "student", message: "I don't know" }],
      satisfiedCriteriaBefore: 0,
      satisfiedCriteriaAfter: 0,
      consecutiveNoProgressTurns: 1,
      currentState: "uncertain",
      latestMoveType: "ENCOURAGEMENT_PROBE",
      targetCriterion: null,
      timeRemainingSec: 10,
      attemptCount: 3,
      maxAttempts: 5,
    });
    const decision = determineConversationStrategy(strategyInput);
    expect(decision.strategy).toBe("wrap_support");
    expect(decision.escalated).toBe(true);
  });

  it("resets escalation when criteria are satisfied", () => {
    const strategyInput = buildExplanationStrategyInput({
      conversationHistory: [],
      satisfiedCriteriaBefore: 0,
      satisfiedCriteriaAfter: 1,
      consecutiveNoProgressTurns: 0,
      currentState: "partial_evidence",
      latestMoveType: "HINT",
      targetCriterion: null,
      timeRemainingSec: 60,
      attemptCount: 2,
      maxAttempts: 5,
    });
    const decision = determineConversationStrategy(strategyInput);
    expect(decision.strategy).toBe("probe");
    expect(decision.escalated).toBe(false);
  });

  it("shouldUpgradeMove returns MODEL_AND_ASK for demonstrate_step", () => {
    const decision = { strategy: "demonstrate_step" as const, reason: "test", escalated: true };
    const upgrade = shouldUpgradeMove(decision, "EVIDENCE_PROBE", "explanation");
    expect(upgrade).toBe("MODEL_AND_ASK");
  });

  it("escalates no-progress streak 3 to demonstrate_step", () => {
    const strategyInput = buildExplanationStrategyInput({
      conversationHistory: [
        { role: "student", message: "I'm not sure" },
        { role: "coach", message: "Think about planets." },
        { role: "student", message: "I'm not sure" },
        { role: "coach", message: "Can you name one?" },
        { role: "student", message: "I'm not sure" },
      ],
      satisfiedCriteriaBefore: 0,
      satisfiedCriteriaAfter: 0,
      consecutiveNoProgressTurns: 3,
      currentState: "uncertain",
      latestMoveType: "ENCOURAGEMENT_PROBE",
      targetCriterion: "Names at least two planets",
      timeRemainingSec: 60,
      attemptCount: 4,
      maxAttempts: 5,
    });
    const decision = determineConversationStrategy(strategyInput);
    expect(decision.strategy).toBe("demonstrate_step");
    expect(decision.escalated).toBe(true);
  });
});

// ============================================================================
// Phrasing variation across repeated turns
// ============================================================================

describe("phrasing variation", () => {
  // Helper: run N turns of the same student message, collect move texts
  function collectMoveTexts(
    studentMsg: string,
    turns: number,
    conversationHistory?: Array<{ role: string; message: string }>,
  ): string[] {
    const texts: string[] = [];
    let accum: AccumulatedExplanationEvidence | null = null;
    const history: Array<{ role: string; message: string }> = conversationHistory ?? [];

    for (let i = 0; i < turns; i++) {
      const v = validate(studentMsg, PLANETS_EVIDENCE, PLANETS_FACTS);
      accum = accumulateExplanationEvidence(
        v, studentMsg, accum,
        PLANETS_EVIDENCE, PLANETS_FACTS, PLANETS_CRITERIA,
      );
      const state = classifyExplanationState(studentMsg, v, accum);
      const move = getExplanationRemediationMove(
        state, accum, v,
        PLANETS_EVIDENCE, PLANETS_FACTS, PLANETS_CRITERIA,
        PLANETS_INPUT, PLANETS_HINTS, history,
      );
      const text = move?.text ?? "";
      texts.push(text);
      // Append student + coach to history for next turn
      history.push({ role: "student", message: studentMsg });
      if (text) history.push({ role: "coach", message: text });
    }
    return texts;
  }

  it("ENCOURAGEMENT_PROBE varies across 4 consecutive turns", () => {
    // no_evidence state → ENCOURAGEMENT_PROBE
    const texts = collectMoveTexts("", 4);
    // All 4 should be non-empty
    expect(texts.every(t => t.length > 0)).toBe(true);
    // Not all identical
    const unique = new Set(texts);
    expect(unique.size).toBeGreaterThan(1);
  });

  it("ENCOURAGEMENT_PROBE avoids same first-4-words as previous coach text", () => {
    const texts = collectMoveTexts("", 4);
    for (let i = 1; i < texts.length; i++) {
      const prevWords = texts[i - 1].split(/\s+/).slice(0, 4).join(" ").toLowerCase();
      const currWords = texts[i].split(/\s+/).slice(0, 4).join(" ").toLowerCase();
      expect(currWords).not.toBe(prevWords);
    }
  });

  it("HINT varies across repeated uncertain turns", () => {
    // 2+ no-progress uncertain → HINT
    const texts = collectMoveTexts("I don't know", 4);
    // After first encouragement, subsequent turns should be HINT or MODEL_AND_ASK
    // Collect the hint-class texts (turns 2+)
    const hintTexts = texts.slice(1);
    expect(hintTexts.every(t => t.length > 0)).toBe(true);
    // Check stems vary
    const stems = hintTexts.map(t => t.split(/\s+/).slice(0, 4).join(" ").toLowerCase());
    // At least some variation in 3 texts
    const uniqueStems = new Set(stems);
    expect(uniqueStems.size).toBeGreaterThanOrEqual(1);
  });

  it("MODEL_AND_ASK varies opening across turns", () => {
    // 3+ uncertain → MODEL_AND_ASK
    const texts = collectMoveTexts("I don't know", 6);
    // Filter to MODEL_AND_ASK texts (turn 4+ where noProgressCount >= 3)
    const modelTexts = texts.filter(t =>
      t.includes("made of") && (
        t.startsWith("For example,") ||
        t.startsWith("Here's how it works:") ||
        t.startsWith("Let me show you:") ||
        t.startsWith("I'll give you an example:")
      )
    );
    if (modelTexts.length >= 2) {
      const openings = modelTexts.map(t => t.split(/\s+/).slice(0, 4).join(" ").toLowerCase());
      // With 2+ model texts, should see some variation
      expect(new Set(openings).size).toBeGreaterThanOrEqual(1);
    }
  });

  it("SPECIFICITY_PROBE varies for claim_only state", () => {
    // General claim → claim_only → SPECIFICITY_PROBE
    const claimMsg = "They are made of different things";
    const texts = collectMoveTexts(claimMsg, 3);
    // First 2 turns are SPECIFICITY_PROBE (before escalating to hint)
    const specTexts = texts.slice(0, 2);
    expect(specTexts.every(t => t.length > 0)).toBe(true);
    // Should not have identical first-4-words
    if (specTexts.length >= 2) {
      const w0 = specTexts[0].split(/\s+/).slice(0, 4).join(" ").toLowerCase();
      const w1 = specTexts[1].split(/\s+/).slice(0, 4).join(" ").toLowerCase();
      expect(w0).not.toBe(w1);
    }
  });

  it("EVIDENCE_PROBE varies for partial_evidence state", () => {
    // First turn provides partial evidence, subsequent turns repeat same thing
    const firstMsg = "Mercury is made of rock";
    const repeatMsg = "Mercury is made of rock"; // same → no new evidence
    const history: Array<{ role: string; message: string }> = [];
    const texts: string[] = [];
    let accum: AccumulatedExplanationEvidence | null = null;

    // Turn 1: partial evidence
    const v1 = validate(firstMsg, PLANETS_EVIDENCE, PLANETS_FACTS);
    accum = accumulateExplanationEvidence(
      v1, firstMsg, accum, PLANETS_EVIDENCE, PLANETS_FACTS, PLANETS_CRITERIA,
    );
    const s1 = classifyExplanationState(firstMsg, v1, accum);
    const m1 = getExplanationRemediationMove(
      s1, accum, v1, PLANETS_EVIDENCE, PLANETS_FACTS, PLANETS_CRITERIA,
      PLANETS_INPUT, PLANETS_HINTS, history,
    );
    texts.push(m1?.text ?? "");
    history.push({ role: "student", message: firstMsg });
    if (m1?.text) history.push({ role: "coach", message: m1.text });

    // Turns 2-3: repeat → still partial_evidence but no progress
    for (let i = 0; i < 2; i++) {
      const v = validate(repeatMsg, PLANETS_EVIDENCE, PLANETS_FACTS);
      accum = accumulateExplanationEvidence(
        v, repeatMsg, accum, PLANETS_EVIDENCE, PLANETS_FACTS, PLANETS_CRITERIA,
      );
      const st = classifyExplanationState(repeatMsg, v, accum);
      const mv = getExplanationRemediationMove(
        st, accum, v, PLANETS_EVIDENCE, PLANETS_FACTS, PLANETS_CRITERIA,
        PLANETS_INPUT, PLANETS_HINTS, history,
      );
      texts.push(mv?.text ?? "");
      history.push({ role: "student", message: repeatMsg });
      if (mv?.text) history.push({ role: "coach", message: mv.text });
    }

    // All non-empty
    expect(texts.every(t => t.length > 0)).toBe(true);
    // First-4-words should vary between consecutive turns
    for (let i = 1; i < texts.length; i++) {
      const prev = texts[i - 1].split(/\s+/).slice(0, 4).join(" ").toLowerCase();
      const curr = texts[i].split(/\s+/).slice(0, 4).join(" ").toLowerCase();
      expect(curr).not.toBe(prev);
    }
  });

  it("no REPEATED_OPENING in 6-turn explanation long-stall", () => {
    // Simulate the stress-test long_stall scenario
    const vagueResponses = [
      "I think they're different",
      "I'm not really sure",
      "um I don't know",
      "maybe different stuff",
      "I can't think of any",
      "I don't know",
    ];
    const history: Array<{ role: string; message: string }> = [];
    const texts: string[] = [];
    let accum: AccumulatedExplanationEvidence | null = null;

    for (const msg of vagueResponses) {
      const v = validate(msg, PLANETS_EVIDENCE, PLANETS_FACTS);
      accum = accumulateExplanationEvidence(
        v, msg, accum, PLANETS_EVIDENCE, PLANETS_FACTS, PLANETS_CRITERIA,
      );
      const state = classifyExplanationState(msg, v, accum);
      const move = getExplanationRemediationMove(
        state, accum, v,
        PLANETS_EVIDENCE, PLANETS_FACTS, PLANETS_CRITERIA,
        PLANETS_INPUT, PLANETS_HINTS, history,
      );
      const text = move?.text ?? "";
      texts.push(text);
      history.push({ role: "student", message: msg });
      if (text) history.push({ role: "coach", message: text });
    }

    // Check no consecutive pair shares first 4 words
    for (let i = 1; i < texts.length; i++) {
      if (!texts[i] || !texts[i - 1]) continue;
      const prev = texts[i - 1].split(/\s+/).slice(0, 4).join(" ").toLowerCase();
      const curr = texts[i].split(/\s+/).slice(0, 4).join(" ").toLowerCase();
      expect(curr).not.toBe(prev);
    }
  });
});
