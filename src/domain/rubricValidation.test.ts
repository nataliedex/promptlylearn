import {
  validateRubricForGrade,
  parseGradeNumber,
  RubricValidationResult,
  detectVagueMathCriteria,
} from "./rubricValidation";
import { PromptAssessment } from "./prompt";

// ============================================================================
// parseGradeNumber
// ============================================================================

describe("parseGradeNumber", () => {
  test("parses 'K' to 0", () => {
    expect(parseGradeNumber("K")).toBe(0);
  });

  test("parses 'kindergarten' to 0", () => {
    expect(parseGradeNumber("kindergarten")).toBe(0);
  });

  test("parses '1' to 1", () => {
    expect(parseGradeNumber("1")).toBe(1);
  });

  test("parses '2nd grade' to 2", () => {
    expect(parseGradeNumber("2nd grade")).toBe(2);
  });

  test("parses '3' to 3", () => {
    expect(parseGradeNumber("3")).toBe(3);
  });

  test("parses 'grade 5' to 5", () => {
    expect(parseGradeNumber("grade 5")).toBe(5);
  });

  test("parses '8th' to 8", () => {
    expect(parseGradeNumber("8th")).toBe(8);
  });

  test("defaults to 2 for undefined", () => {
    expect(parseGradeNumber(undefined)).toBe(2);
  });

  test("defaults to 2 for unparseable string", () => {
    expect(parseGradeNumber("advanced")).toBe(2);
  });
});

// ============================================================================
// K-1 grade validation
// ============================================================================

describe("validateRubricForGrade — K-1", () => {
  test("rewrites 'demonstrates understanding' for K-1", () => {
    const assessment: PromptAssessment = {
      learningObjective: "Demonstrates understanding of subtraction",
      successCriteria: [
        "Demonstrates understanding of subtraction's role in decision-making",
      ],
    };

    const result = validateRubricForGrade(assessment, "K");
    expect(result.wasModified).toBe(true);
    expect(result.assessment.learningObjective).not.toContain("Demonstrates understanding");
    expect(result.assessment.successCriteria![0]).not.toContain("decision-making");
    expect(result.flagged.length).toBeGreaterThan(0);
  });

  test("rewrites abstract verbs for K-1", () => {
    const assessment: PromptAssessment = {
      successCriteria: [
        "Identifies the correct operation",
        "Demonstrates ability to count",
        "Recognizes the pattern",
      ],
    };

    const result = validateRubricForGrade(assessment, "1");
    expect(result.wasModified).toBe(true);
    // "Identifies" → "name", "Demonstrates" → "show", "Recognizes" → "notice"
    expect(result.assessment.successCriteria![0].toLowerCase()).toContain("name");
    expect(result.assessment.successCriteria![1].toLowerCase()).toContain("show");
    expect(result.assessment.successCriteria![2].toLowerCase()).toContain("notice");
  });

  test("flags 'associative property' for K-1", () => {
    const assessment: PromptAssessment = {
      successCriteria: [
        "Applies the associative property to solve the problem",
      ],
    };

    const result = validateRubricForGrade(assessment, "K");
    expect(result.flagged.some(f => f.term === "associative property")).toBe(true);
  });

  test("flags 'problem-solving' for K-1", () => {
    const assessment: PromptAssessment = {
      learningObjective: "Uses problem-solving to find the answer",
    };

    const result = validateRubricForGrade(assessment, "1");
    expect(result.wasModified).toBe(true);
    expect(result.assessment.learningObjective).toContain("figuring out");
  });

  test("removes mathematically incorrect criteria", () => {
    const assessment: PromptAssessment = {
      successCriteria: [
        "Says what subtraction means",
        "Subtraction order does not affect the final result",
        "Gives a real-life example",
      ],
    };

    const result = validateRubricForGrade(assessment, "1");
    expect(result.wasModified).toBe(true);
    // The incorrect criterion should be removed entirely
    expect(result.assessment.successCriteria).toHaveLength(2);
    expect(result.assessment.successCriteria![0]).toBe("Says what subtraction means");
    expect(result.assessment.successCriteria![1]).toBe("Gives a real-life example");
    expect(result.flagged.some(f => f.reason.includes("mathematically incorrect"))).toBe(true);
  });

  test("passes clean K-1 criteria unchanged", () => {
    const assessment: PromptAssessment = {
      learningObjective: "Say what subtraction means",
      successCriteria: [
        "Says what subtraction means",
        "Gives one example of taking away",
      ],
    };

    const result = validateRubricForGrade(assessment, "K");
    expect(result.wasModified).toBe(false);
    expect(result.flagged).toHaveLength(0);
  });
});

// ============================================================================
// Grade 2-3 validation
// ============================================================================

describe("validateRubricForGrade — Grade 2-3", () => {
  test("flags 'associative property' for grade 2", () => {
    const assessment: PromptAssessment = {
      successCriteria: [
        "Applies the associative property to multi-digit operations",
      ],
    };

    const result = validateRubricForGrade(assessment, "2");
    expect(result.flagged.some(f => f.term === "associative property")).toBe(true);
  });

  test("flags 'theorem' and 'proof' for grade 3", () => {
    const assessment: PromptAssessment = {
      successCriteria: [
        "States the theorem correctly",
        "Provides a proof of the concept",
      ],
    };

    const result = validateRubricForGrade(assessment, "3");
    expect(result.flagged.some(f => f.term === "theorem")).toBe(true);
    expect(result.flagged.some(f => f.term === "proof")).toBe(true);
  });

  test("rewrites 'synthesize' for grade 3", () => {
    const assessment: PromptAssessment = {
      learningObjective: "Synthesize information from the passage",
    };

    const result = validateRubricForGrade(assessment, "3");
    expect(result.wasModified).toBe(true);
    expect(result.assessment.learningObjective).toContain("combine");
  });

  test("does NOT rewrite abstract verbs for grade 2-3 (only K-1)", () => {
    const assessment: PromptAssessment = {
      successCriteria: [
        "Identifies the correct operation",
        "Demonstrates the regrouping step",
      ],
    };

    const result = validateRubricForGrade(assessment, "2");
    // Abstract verb rewrites only apply to K-1, not 2-3
    expect(result.assessment.successCriteria![0]).toBe("Identifies the correct operation");
    expect(result.assessment.successCriteria![1]).toBe("Demonstrates the regrouping step");
  });

  test("removes mathematically incorrect division claims", () => {
    const assessment: PromptAssessment = {
      successCriteria: [
        "Explains what division means",
        "Division order does not matter when dividing",
      ],
    };

    const result = validateRubricForGrade(assessment, "3");
    expect(result.assessment.successCriteria).toHaveLength(1);
    expect(result.assessment.successCriteria![0]).toBe("Explains what division means");
  });
});

// ============================================================================
// Grade 4-5 validation
// ============================================================================

describe("validateRubricForGrade — Grade 4-5", () => {
  test("allows 'associative property' for grade 4", () => {
    const assessment: PromptAssessment = {
      successCriteria: [
        "Uses the associative property to simplify the expression",
      ],
    };

    const result = validateRubricForGrade(assessment, "4");
    // associative property has maxGrade 3, so grade 4 should be fine
    expect(result.flagged.filter(f => f.term === "associative property")).toHaveLength(0);
  });

  test("flags 'formal proof' for grade 5", () => {
    const assessment: PromptAssessment = {
      successCriteria: [
        "Constructs a formal proof of the property",
      ],
    };

    const result = validateRubricForGrade(assessment, "5");
    expect(result.flagged.some(f => f.term === "formal proof")).toBe(true);
  });

  test("flags 'axiomatic' for grade 4", () => {
    const assessment: PromptAssessment = {
      learningObjective: "Understand the axiomatic basis of arithmetic",
    };

    const result = validateRubricForGrade(assessment, "4");
    expect(result.flagged.some(f => f.term === "axiomatic")).toBe(true);
  });
});

// ============================================================================
// Grade 6+ validation
// ============================================================================

describe("validateRubricForGrade — Grade 6+", () => {
  test("allows academic terms for grade 6", () => {
    const assessment: PromptAssessment = {
      learningObjective: "Analyze the relationship between variables",
      successCriteria: [
        "Identifies at least two variables and states how they relate",
        "Synthesize information from multiple sources",
        "Constructs a formal proof",
      ],
    };

    const result = validateRubricForGrade(assessment, "6");
    // All terms should be allowed for grade 6+
    expect(result.wasModified).toBe(false);
    expect(result.flagged).toHaveLength(0);
  });

  test("still catches mathematically incorrect statements for grade 6", () => {
    const assessment: PromptAssessment = {
      successCriteria: [
        "Order of subtraction does not affect the result",
      ],
    };

    const result = validateRubricForGrade(assessment, "8");
    expect(result.wasModified).toBe(true);
    expect(result.assessment.successCriteria).toBeUndefined(); // removed as only criterion
  });
});

// ============================================================================
// Edge cases
// ============================================================================

describe("validateRubricForGrade — edge cases", () => {
  test("handles empty assessment", () => {
    const assessment: PromptAssessment = {};
    const result = validateRubricForGrade(assessment, "2");
    expect(result.wasModified).toBe(false);
    expect(result.flagged).toHaveLength(0);
  });

  test("handles undefined grade level (defaults to grade 2)", () => {
    const assessment: PromptAssessment = {
      successCriteria: ["Uses the associative property to add"],
    };
    // undefined → defaults to grade 2, which has maxGrade 3 for associative property
    const result = validateRubricForGrade(assessment);
    expect(result.flagged.some(f => f.term === "associative property")).toBe(true);
  });

  test("handles assessment with only misconceptions", () => {
    const assessment: PromptAssessment = {
      misconceptions: [
        "Thinks subtraction order does not affect the result",
      ],
    };

    const result = validateRubricForGrade(assessment, "2");
    // Misconception with math error should be removed
    expect(result.wasModified).toBe(true);
    expect(result.assessment.misconceptions).toBeUndefined();
  });

  test("preserves evaluationFocus unchanged", () => {
    const assessment: PromptAssessment = {
      evaluationFocus: ["understanding", "clarity"],
      successCriteria: ["Says what the answer is"],
    };

    const result = validateRubricForGrade(assessment, "K");
    expect(result.assessment.evaluationFocus).toEqual(["understanding", "clarity"]);
  });

  test("handles all criteria being removed (returns undefined)", () => {
    const assessment: PromptAssessment = {
      successCriteria: [
        "Subtraction order does not affect the final result",
      ],
    };

    const result = validateRubricForGrade(assessment, "2");
    expect(result.assessment.successCriteria).toBeUndefined();
  });

  test("multiple forbidden terms in same criterion", () => {
    const assessment: PromptAssessment = {
      successCriteria: [
        "Demonstrates understanding of problem-solving through decision-making",
      ],
    };

    const result = validateRubricForGrade(assessment, "1");
    expect(result.wasModified).toBe(true);
    expect(result.flagged.length).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================================
// detectVagueMathCriteria
// ============================================================================

describe("detectVagueMathCriteria", () => {
  test("detects 'explains how to add the ones together'", () => {
    expect(detectVagueMathCriteria("Explains how to add the ones together")).toBe("explains how to add the ones");
  });

  test("detects 'explains how to add the tens'", () => {
    expect(detectVagueMathCriteria("Explains how to add the tens")).toBe("explains how to add the tens");
  });

  test("detects 'explains how to subtract the ones'", () => {
    expect(detectVagueMathCriteria("Explains how to subtract the ones")).toBe("explains how to subtract the ones");
  });

  test("detects 'explains how to add two-digit numbers'", () => {
    expect(detectVagueMathCriteria("Explains how to add two-digit numbers")).toBe("explains how to add two-digit numbers");
  });

  test("detects 'includes all steps'", () => {
    expect(detectVagueMathCriteria("Includes all steps in the solution")).toBe("includes all steps");
  });

  test("detects 'shows all work'", () => {
    expect(detectVagueMathCriteria("Shows all the work")).toBe("shows all work");
  });

  test("detects 'explains regrouping' without numbers", () => {
    expect(detectVagueMathCriteria("Explains regrouping")).toBe("explains regrouping");
  });

  test("allows specific math criteria with numbers", () => {
    expect(detectVagueMathCriteria("States that 4 + 2 = 6")).toBeNull();
    expect(detectVagueMathCriteria("Says the final answer is 36")).toBeNull();
    expect(detectVagueMathCriteria("Says 20 + 10 = 30")).toBeNull();
  });

  test("allows 'explains that carrying 1 ten...' (specific)", () => {
    expect(detectVagueMathCriteria("Explains that carrying 1 ten from 14 gives 4 ones")).toBeNull();
  });

  test("returns null for non-math criteria", () => {
    expect(detectVagueMathCriteria("Names at least two planets")).toBeNull();
    expect(detectVagueMathCriteria("Says that Earth is made of rock")).toBeNull();
  });
});
