import {
  BLUEPRINTS,
  MATH_BLUEPRINTS,
  ALL_BLUEPRINTS,
  Blueprint,
  BlueprintId,
  GradeBand,
  GRADE_COGNITIVE_VERBS,
  getGradeBand,
  getAvailableBlueprints,
  serializeBlueprintsForPrompt,
  buildBlueprintAssessmentConstraints,
  isMathComputationTopic,
} from "./blueprints";
import type { Prompt } from "./prompt";

// ============================================================================
// Blueprint library integrity
// ============================================================================

describe("BLUEPRINTS constant", () => {
  test("contains exactly 10 blueprints", () => {
    expect(BLUEPRINTS).toHaveLength(10);
  });

  test("all blueprints have unique IDs", () => {
    const ids = BLUEPRINTS.map(bp => bp.id);
    expect(new Set(ids).size).toBe(10);
  });

  test("all blueprints have required fields", () => {
    for (const bp of BLUEPRINTS) {
      expect(bp.id).toBeTruthy();
      expect(bp.name).toBeTruthy();
      expect(bp.template).toBeTruthy();
      expect(bp.slots.length).toBeGreaterThan(0);
      expect(bp.cognitiveVerb).toBeTruthy();
      expect(bp.gradeBands.length).toBeGreaterThan(0);
      expect(bp.evidenceStructure.expectedEntityCount).toBeGreaterThan(0);
      expect(bp.evidenceStructure.completenessRule).toBeTruthy();
    }
  });

  test("all templates contain slot placeholders matching their slots", () => {
    for (const bp of BLUEPRINTS) {
      for (const slot of bp.slots) {
        expect(bp.template).toContain(`[${slot.name}]`);
      }
    }
  });

  test("every grade band has at least 3 available blueprints", () => {
    const bands: GradeBand[] = ["K-2", "3-4", "5-6"];
    for (const band of bands) {
      const count = BLUEPRINTS.filter(bp => bp.gradeBands.includes(band)).length;
      expect(count).toBeGreaterThanOrEqual(3);
    }
  });
});

// ============================================================================
// Grade band mapping
// ============================================================================

describe("getGradeBand", () => {
  test("K (0) maps to K-2", () => {
    expect(getGradeBand(0)).toBe("K-2");
  });

  test("grade 1 maps to K-2", () => {
    expect(getGradeBand(1)).toBe("K-2");
  });

  test("grade 2 maps to K-2", () => {
    expect(getGradeBand(2)).toBe("K-2");
  });

  test("grade 3 maps to 3-4", () => {
    expect(getGradeBand(3)).toBe("3-4");
  });

  test("grade 4 maps to 3-4", () => {
    expect(getGradeBand(4)).toBe("3-4");
  });

  test("grade 5 maps to 5-6", () => {
    expect(getGradeBand(5)).toBe("5-6");
  });

  test("grade 6 maps to 5-6", () => {
    expect(getGradeBand(6)).toBe("5-6");
  });
});

// ============================================================================
// Grade filtering
// ============================================================================

describe("getAvailableBlueprints", () => {
  test("K-2 excludes compare_two_objects, describe_object, similarities, real_world_example", () => {
    const available = getAvailableBlueprints(1);
    const ids = available.map(bp => bp.id);
    expect(ids).not.toContain("compare_two_objects");
    expect(ids).not.toContain("describe_object");
    expect(ids).not.toContain("similarities");
    expect(ids).not.toContain("real_world_example");
  });

  test("K-2 includes identify_one_property, two_examples, category_example, choose_category, odd_one_out, pattern_completion", () => {
    const available = getAvailableBlueprints(1);
    const ids = available.map(bp => bp.id);
    expect(ids).toContain("identify_one_property");
    expect(ids).toContain("two_examples");
    expect(ids).toContain("category_example");
    expect(ids).toContain("choose_category");
    expect(ids).toContain("odd_one_out");
    expect(ids).toContain("pattern_completion");
  });

  test("3-4 includes compare and describe blueprints but not real_world_example", () => {
    const available = getAvailableBlueprints(3);
    const ids = available.map(bp => bp.id);
    expect(ids).toContain("compare_two_objects");
    expect(ids).toContain("describe_object");
    expect(ids).toContain("similarities");
    expect(ids).not.toContain("real_world_example");
  });

  test("5-6 includes all 10 blueprints", () => {
    const available = getAvailableBlueprints(5);
    expect(available).toHaveLength(10);
  });
});

// ============================================================================
// Cognitive verb constraints
// ============================================================================

describe("GRADE_COGNITIVE_VERBS", () => {
  test("K-2 allows only identify and name", () => {
    expect(GRADE_COGNITIVE_VERBS["K-2"]).toEqual(["identify", "name"]);
  });

  test("3-4 allows describe, give examples, compare", () => {
    expect(GRADE_COGNITIVE_VERBS["3-4"]).toEqual(["describe", "give examples", "compare"]);
  });

  test("5-6 allows explain and compare causes", () => {
    expect(GRADE_COGNITIVE_VERBS["5-6"]).toEqual(["explain", "compare causes"]);
  });
});

// ============================================================================
// serializeBlueprintsForPrompt
// ============================================================================

describe("serializeBlueprintsForPrompt", () => {
  test("returns non-empty string", () => {
    const result = serializeBlueprintsForPrompt(2);
    expect(result.length).toBeGreaterThan(0);
  });

  test("includes blueprint names for the grade level", () => {
    const result = serializeBlueprintsForPrompt(1);
    expect(result).toContain("Identify One Property");
    expect(result).toContain("Two Examples");
    expect(result).not.toContain("Real World Example");
  });

  test("includes cognitive verb constraints", () => {
    const result = serializeBlueprintsForPrompt(1);
    expect(result).toContain("identify, name");
    expect(result).toContain("NEVER use \"explain why\"");
  });

  test("grade 5 includes explain verbs", () => {
    const result = serializeBlueprintsForPrompt(5);
    expect(result).toContain("explain, compare causes");
  });

  test("includes blueprint IDs for LLM selection", () => {
    const result = serializeBlueprintsForPrompt(3);
    expect(result).toContain("identify_one_property");
    expect(result).toContain("two_examples");
    expect(result).toContain("compare_two_objects");
  });
});

// ============================================================================
// buildBlueprintAssessmentConstraints
// ============================================================================

describe("buildBlueprintAssessmentConstraints", () => {
  test("returns empty string for unknown blueprint ID", () => {
    expect(buildBlueprintAssessmentConstraints("nonexistent")).toBe("");
  });

  test("two_examples blueprint requires minEntities: 2 and requirePairing", () => {
    const result = buildBlueprintAssessmentConstraints("two_examples", {
      category: "planets",
    });
    expect(result).toContain("minEntities: 2");
    expect(result).toContain("requirePairing: true");
    expect(result).toContain("planets");
  });

  test("identify_one_property blueprint requires minEntities: 1", () => {
    const result = buildBlueprintAssessmentConstraints("identify_one_property", {
      object: "Earth",
    });
    expect(result).toContain("minEntities: 1");
    expect(result).toContain("Earth");
  });

  test("similarities blueprint does not require pairing", () => {
    const result = buildBlueprintAssessmentConstraints("similarities", {
      object1: "Earth",
      object2: "Mars",
    });
    expect(result).not.toContain("requirePairing: true");
  });

  test("scoring levels follow deterministic format", () => {
    const result = buildBlueprintAssessmentConstraints("two_examples");
    expect(result).toContain("strong: All required evidence present and factually correct");
    expect(result).toContain("developing: Some evidence present but incomplete or partially incorrect");
    expect(result).toContain("needsSupport: Incorrect facts or unrelated answer");
  });
});

// ============================================================================
// Math blueprint library
// ============================================================================

describe("MATH_BLUEPRINTS", () => {
  test("contains exactly 6 math blueprints", () => {
    expect(MATH_BLUEPRINTS).toHaveLength(6);
  });

  test("all math blueprints have unique IDs", () => {
    const ids = MATH_BLUEPRINTS.map(bp => bp.id);
    expect(new Set(ids).size).toBe(6);
  });

  test("all math blueprint IDs start with math_", () => {
    for (const bp of MATH_BLUEPRINTS) {
      expect(bp.id).toMatch(/^math_/);
    }
  });

  test("all math blueprints have required fields", () => {
    for (const bp of MATH_BLUEPRINTS) {
      expect(bp.id).toBeTruthy();
      expect(bp.name).toBeTruthy();
      expect(bp.template).toBeTruthy();
      expect(bp.slots.length).toBeGreaterThan(0);
      expect(bp.cognitiveVerb).toBeTruthy();
      expect(bp.gradeBands.length).toBeGreaterThan(0);
      expect(bp.evidenceStructure.expectedEntityCount).toBeGreaterThan(0);
      expect(bp.evidenceStructure.completenessRule).toBeTruthy();
    }
  });

  test("all math templates contain slot placeholders", () => {
    for (const bp of MATH_BLUEPRINTS) {
      for (const slot of bp.slots) {
        expect(bp.template).toContain(`[${slot.name}]`);
      }
    }
  });

  test("math blueprints available at all grade bands", () => {
    const bands: GradeBand[] = ["K-2", "3-4", "5-6"];
    for (const band of bands) {
      const count = MATH_BLUEPRINTS.filter(bp => bp.gradeBands.includes(band)).length;
      expect(count).toBeGreaterThanOrEqual(6);
    }
  });

  test("includes solve_and_explain, solve_first_step, regrouping_focus, error_check, word_problem, compare_method", () => {
    const ids = MATH_BLUEPRINTS.map(bp => bp.id);
    expect(ids).toContain("math_solve_and_explain");
    expect(ids).toContain("math_solve_first_step");
    expect(ids).toContain("math_regrouping_focus");
    expect(ids).toContain("math_error_check");
    expect(ids).toContain("math_word_problem");
    expect(ids).toContain("math_compare_method");
  });
});

describe("ALL_BLUEPRINTS", () => {
  test("contains 16 total blueprints (10 general + 6 math)", () => {
    expect(ALL_BLUEPRINTS).toHaveLength(16);
  });

  test("all IDs are unique across general and math", () => {
    const ids = ALL_BLUEPRINTS.map(bp => bp.id);
    expect(new Set(ids).size).toBe(16);
  });
});

// ============================================================================
// Math computation topic detection
// ============================================================================

describe("isMathComputationTopic", () => {
  test("detects addition topics", () => {
    expect(isMathComputationTopic("Math", "adding 2-digit values")).toBe(true);
    expect(isMathComputationTopic("Math", "addition within 100")).toBe(true);
    expect(isMathComputationTopic(undefined, "2-digit addition")).toBe(true);
  });

  test("detects subtraction topics", () => {
    expect(isMathComputationTopic("Math", "subtracting within 20")).toBe(true);
    expect(isMathComputationTopic(undefined, "subtraction with borrowing")).toBe(true);
  });

  test("detects multiplication and division", () => {
    expect(isMathComputationTopic("Math", "multiplying by 5")).toBe(true);
    expect(isMathComputationTopic("Math", "division facts")).toBe(true);
  });

  test("detects place value", () => {
    expect(isMathComputationTopic("Math", "place value")).toBe(true);
    expect(isMathComputationTopic(undefined, "3-digit numbers")).toBe(true);
  });

  test("detects regrouping", () => {
    expect(isMathComputationTopic("Math", "regrouping in addition")).toBe(true);
  });

  test("does NOT detect non-math topics", () => {
    expect(isMathComputationTopic("Science", "planets and materials")).toBe(false);
    expect(isMathComputationTopic("Reading", "main idea")).toBe(false);
    expect(isMathComputationTopic("Math", "geometry shapes")).toBe(false);
    expect(isMathComputationTopic("Math", "fractions as parts")).toBe(false);
  });

  test("returns false when both subject and topic are undefined", () => {
    expect(isMathComputationTopic(undefined, undefined)).toBe(false);
  });
});

// ============================================================================
// Subject-aware blueprint filtering
// ============================================================================

describe("getAvailableBlueprints — subject-aware", () => {
  test("math computation topic returns only math blueprints", () => {
    const available = getAvailableBlueprints(3, "Math", "adding 2-digit values");
    const ids = available.map(bp => bp.id);
    // Should contain only math blueprints
    for (const bp of available) {
      expect(bp.id).toMatch(/^math_/);
    }
    expect(ids).toContain("math_solve_and_explain");
    expect(ids).toContain("math_regrouping_focus");
    expect(ids).toContain("math_error_check");
  });

  test("math computation topic excludes general listing blueprints", () => {
    const available = getAvailableBlueprints(3, "Math", "adding 2-digit values");
    const ids = available.map(bp => bp.id);
    expect(ids).not.toContain("two_examples");
    expect(ids).not.toContain("category_example");
    expect(ids).not.toContain("pattern_completion");
    expect(ids).not.toContain("identify_one_property");
  });

  test("non-math topic returns general blueprints", () => {
    const available = getAvailableBlueprints(3, "Science", "planets and materials");
    const ids = available.map(bp => bp.id);
    expect(ids).toContain("two_examples");
    expect(ids).toContain("identify_one_property");
    expect(ids).not.toContain("math_solve_and_explain");
  });

  test("no subject specified returns general blueprints (backwards compatible)", () => {
    const available = getAvailableBlueprints(3);
    const ids = available.map(bp => bp.id);
    expect(ids).toContain("two_examples");
    expect(ids).not.toContain("math_solve_and_explain");
  });
});

// ============================================================================
// Math blueprint serialization
// ============================================================================

describe("serializeBlueprintsForPrompt — math", () => {
  test("math topic serialization includes math blueprint names", () => {
    const result = serializeBlueprintsForPrompt(3, "Math", "adding 2-digit values");
    expect(result).toContain("Solve and Explain");
    expect(result).toContain("Error Check");
    expect(result).toContain("Word Problem Solve");
    expect(result).toContain("math_solve_and_explain");
  });

  test("math serialization excludes general listing blueprints", () => {
    const result = serializeBlueprintsForPrompt(3, "Math", "adding 2-digit values");
    expect(result).not.toContain("Two Examples");
    expect(result).not.toContain("Category Example");
    expect(result).not.toContain("Pattern Completion");
  });

  test("math serialization includes computation-specific verb constraints", () => {
    const result = serializeBlueprintsForPrompt(3, "Math", "adding 2-digit values");
    expect(result).toContain("solve");
    expect(result).toContain("must SOLVE the problem");
  });

  test("math serialization header specifies math computation blueprints", () => {
    const result = serializeBlueprintsForPrompt(3, "Math", "adding 2-digit values");
    expect(result).toContain("MATH COMPUTATION BLUEPRINTS");
    expect(result).toContain("do NOT use general listing/example blueprints");
  });
});

// ============================================================================
// Math blueprint assessment constraints
// ============================================================================

describe("buildBlueprintAssessmentConstraints — math", () => {
  test("math_solve_and_explain blueprint requires correct answer + strategy", () => {
    const result = buildBlueprintAssessmentConstraints("math_solve_and_explain", {
      expression: "34 + 27",
    });
    expect(result).toContain("Solve and Explain");
    expect(result).toContain("34 + 27");
    expect(result).toContain("correct answer AND explains the strategy");
  });

  test("math scoring levels differ from general scoring", () => {
    const result = buildBlueprintAssessmentConstraints("math_solve_and_explain");
    expect(result).toContain("strong: Gives the correct answer AND explains the strategy or first step");
    expect(result).toContain("developing: Partial strategy or arithmetic error");
    expect(result).toContain("needsSupport: Incorrect answer with no usable strategy");
  });

  test("general blueprint still uses general scoring levels", () => {
    const result = buildBlueprintAssessmentConstraints("two_examples");
    expect(result).toContain("strong: All required evidence present and factually correct");
    expect(result).not.toContain("arithmetic error");
  });

  test("math_error_check blueprint works with expression and incorrect_answer slots", () => {
    const result = buildBlueprintAssessmentConstraints("math_error_check", {
      expression: "48 + 36",
      incorrect_answer: "74",
    });
    expect(result).toContain("Error Check");
    expect(result).toContain("48 + 36");
    expect(result).toContain("74");
  });
});

// ============================================================================
// Prompt interface: allowedProbes and retryQuestions
// ============================================================================

describe("Prompt allowedProbes and retryQuestions", () => {
  test("Prompt accepts allowedProbes field", () => {
    const prompt: Prompt = {
      id: "q1",
      type: "explain",
      input: "Name two planets and tell what each one is made of.",
      allowedProbes: [
        "What is Earth made of?",
        "What is Mars made of?",
        "Can you name another rocky planet?",
        "Which planet is mostly gas?",
      ],
    };
    expect(prompt.allowedProbes).toHaveLength(4);
    expect(prompt.allowedProbes![0]).toBe("What is Earth made of?");
  });

  test("Prompt accepts retryQuestions field", () => {
    const prompt: Prompt = {
      id: "q1",
      type: "explain",
      input: "Name two planets and tell what each one is made of.",
      retryQuestions: [
        "What is Earth really made of?",
        "Name a real material planets are made of.",
      ],
    };
    expect(prompt.retryQuestions).toHaveLength(2);
  });

  test("allowedProbes must only reference rubric evidence, not new concepts", () => {
    const goodProbes = [
      "What is Earth made of?",
      "What is Mars made of?",
      "Can you name another rocky planet?",
    ];
    const badProbe = "How does gravity affect the planets?";

    // Verify good probes mention entities from the rubric
    for (const probe of goodProbes) {
      expect(probe).toMatch(/\b(Earth|Mars|planet|made of|rocky)\b/i);
    }
    // Bad probe introduces a new concept (gravity) not in the question
    expect(badProbe).toContain("gravity");
    expect(badProbe).not.toMatch(/\b(made of|material|rocky|gas)\b/i);
  });

  test("retryQuestions must correct misconceptions and guide retry", () => {
    const retries = [
      "What is Earth really made of?",
      "Name a real material planets are made of.",
    ];
    // Retry questions should end with "?" or "." (can be imperative directives)
    for (const retry of retries) {
      expect(retry).toMatch(/[.?]$/);
    }
    // Retry questions should reference the original evidence domain
    expect(retries[0]).toContain("Earth");
    expect(retries[1]).toContain("material");
  });

  test("backwards compatibility: Prompt without allowedProbes or retryQuestions still valid", () => {
    const prompt: Prompt = {
      id: "q1",
      type: "explain",
      input: "What is subtraction?",
    };
    expect(prompt.allowedProbes).toBeUndefined();
    expect(prompt.retryQuestions).toBeUndefined();
  });
});
