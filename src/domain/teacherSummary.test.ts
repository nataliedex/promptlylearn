import { buildTeacherSummary, buildMathTeacherSummary, type TeacherSummary } from "./teacherSummary";
import type { ValidationResult, EvidenceChecklistItem } from "./deterministicValidator";
import type { RequiredEvidence, ReasoningStep } from "./prompt";

// ============================================================================
// Shared fixtures: planets materials lesson
// ============================================================================

const requiredEvidence: RequiredEvidence = {
  minEntities: 2,
  entityLabel: "planets",
  attributeLabel: "materials",
  minAttributeTypes: 2,
  requirePairing: true,
};

const referenceFacts: Record<string, string[]> = {
  Earth: ["rock", "metal", "iron"],
  Mars: ["rock", "dust", "iron", "ice"],
  Jupiter: ["gas", "hydrogen", "helium"],
  Saturn: ["gas", "hydrogen", "helium"],
};

// ============================================================================
// Test: Strong summary
// ============================================================================

describe("buildTeacherSummary — Strong", () => {
  test("renders strong summary with correct evidence", () => {
    const validation: ValidationResult = {
      matchedEntities: ["Earth", "Mars"],
      extractedPairs: [
        { entity: "Earth", attribute: "rock" },
        { entity: "Mars", attribute: "dust" },
      ],
      incorrectPairs: [],
      distinctAttributeTypes: ["rock", "dust"],
      meetsEvidenceBar: true,
      hasFactualErrors: false,
      isOffTopic: false,
    };

    const checklist: EvidenceChecklistItem[] = [
      { label: "Earth materials described", satisfied: true, type: "entity_attribute" },
      { label: "Mars materials described", satisfied: true, type: "entity_attribute" },
    ];

    const summary = buildTeacherSummary({
      validation,
      checklist,
      overallStatus: "strong",
      requiredEvidence,
      referenceFacts,
    });

    expect(summary.overallLevel).toBe("Strong");
    expect(summary.masteryMet).toBe(true);
    expect(summary.correctEvidence).toHaveLength(2);
    expect(summary.incorrectEvidence).toHaveLength(0);
    expect(summary.missingEvidence).toHaveLength(0);
    expect(summary.renderedSummary).toContain("met the goal");
    expect(summary.renderedSummary).toContain("Earth materials: rock");
    expect(summary.renderedSummary).toContain("Mars materials: dust");
    expect(summary.confidence).toBe("high");
  });
});

// ============================================================================
// Test: Developing (partial) summary
// ============================================================================

describe("buildTeacherSummary — Developing", () => {
  test("renders developing summary with correct + missing evidence", () => {
    const validation: ValidationResult = {
      matchedEntities: ["Earth"],
      extractedPairs: [
        { entity: "Earth", attribute: "rock" },
      ],
      incorrectPairs: [],
      distinctAttributeTypes: ["rock"],
      meetsEvidenceBar: false,
      hasFactualErrors: false,
      isOffTopic: false,
    };

    const checklist: EvidenceChecklistItem[] = [
      { label: "Earth materials described", satisfied: true, type: "entity_attribute" },
      { label: "planets #2 materials described", satisfied: false, type: "entity_attribute" },
    ];

    const summary = buildTeacherSummary({
      validation,
      checklist,
      overallStatus: "developing",
      requiredEvidence,
      referenceFacts,
    });

    expect(summary.overallLevel).toBe("Developing");
    expect(summary.masteryMet).toBe(false);
    expect(summary.correctEvidence).toHaveLength(1);
    expect(summary.missingEvidence).toHaveLength(1);
    expect(summary.renderedSummary).toContain("partial understanding");
    expect(summary.renderedSummary).toContain("Earth materials: rock");
    expect(summary.renderedSummary).toContain("planets #2 materials described");
    expect(summary.confidence).toBe("medium");
  });
});

// ============================================================================
// Test: Needs Support (incorrect) summary
// ============================================================================

describe("buildTeacherSummary — Needs Support", () => {
  test("renders needs support summary with incorrect evidence", () => {
    const validation: ValidationResult = {
      matchedEntities: ["Earth", "Mars"],
      extractedPairs: [
        { entity: "Earth", attribute: "gas" },
        { entity: "Mars", attribute: "water" },
      ],
      incorrectPairs: [
        { entity: "Earth", claimed: "gas", acceptable: ["rock", "metal", "iron"] },
        { entity: "Mars", claimed: "water", acceptable: ["rock", "dust", "iron", "ice"] },
      ],
      distinctAttributeTypes: ["gas", "water"],
      meetsEvidenceBar: false,
      hasFactualErrors: true,
      isOffTopic: false,
    };

    const checklist: EvidenceChecklistItem[] = [
      { label: "Earth materials described", satisfied: false, type: "entity_attribute" },
      { label: "Mars materials described", satisfied: false, type: "entity_attribute" },
    ];

    const summary = buildTeacherSummary({
      validation,
      checklist,
      overallStatus: "needs_support",
      requiredEvidence,
      referenceFacts,
    });

    expect(summary.overallLevel).toBe("Needs Support");
    expect(summary.masteryMet).toBe(false);
    expect(summary.correctEvidence).toHaveLength(0);
    expect(summary.incorrectEvidence).toHaveLength(2);
    expect(summary.renderedSummary).toContain("did not yet provide accurate evidence");
    expect(summary.renderedSummary).toContain("incorrect descriptions");
    expect(summary.renderedSummary).toContain("Earth");
    expect(summary.confidence).toBe("medium");
  });
});

// ============================================================================
// Test: Not Enough Evidence (no usable content)
// ============================================================================

describe("buildTeacherSummary — Not Enough Evidence", () => {
  test("renders not-enough-evidence when response is off-topic with no entities", () => {
    const validation: ValidationResult = {
      matchedEntities: [],
      extractedPairs: [],
      incorrectPairs: [],
      distinctAttributeTypes: [],
      meetsEvidenceBar: false,
      hasFactualErrors: false,
      isOffTopic: true,
    };

    const checklist: EvidenceChecklistItem[] = [
      { label: "Earth materials described", satisfied: false, type: "entity_attribute" },
      { label: "Mars materials described", satisfied: false, type: "entity_attribute" },
    ];

    const summary = buildTeacherSummary({
      validation,
      checklist,
      overallStatus: "needs_support",
      requiredEvidence,
      referenceFacts,
    });

    expect(summary.overallLevel).toBe("Not Enough Evidence");
    expect(summary.masteryMet).toBe(false);
    expect(summary.correctEvidence).toHaveLength(0);
    expect(summary.incorrectEvidence).toHaveLength(0);
    expect(summary.renderedSummary).toBe(
      "The student did not provide enough usable verbal evidence to evaluate mastery on this question."
    );
    expect(summary.confidence).toBe("low");
    expect(summary.notes).toHaveLength(1);
    expect(summary.notes[0].label).toContain("off-topic");
  });
});

// ============================================================================
// Test: Summary never upgrades rejected facts
// ============================================================================

describe("buildTeacherSummary — never upgrades rejected facts", () => {
  test("incorrect pairs are listed as incorrect, not correct", () => {
    // Scenario: student says "Earth is made of gas" — validator rejected it
    const validation: ValidationResult = {
      matchedEntities: ["Earth", "Mars"],
      extractedPairs: [
        { entity: "Earth", attribute: "gas" },    // WRONG
        { entity: "Mars", attribute: "rock" },     // correct
      ],
      incorrectPairs: [
        { entity: "Earth", claimed: "gas", acceptable: ["rock", "metal", "iron"] },
      ],
      distinctAttributeTypes: ["gas", "rock"],
      meetsEvidenceBar: false,
      hasFactualErrors: true,
      isOffTopic: false,
    };

    const checklist: EvidenceChecklistItem[] = [
      { label: "Earth materials described", satisfied: false, type: "entity_attribute" },
      { label: "Mars materials described", satisfied: true, type: "entity_attribute" },
    ];

    const summary = buildTeacherSummary({
      validation,
      checklist,
      overallStatus: "developing",
      requiredEvidence,
      referenceFacts,
    });

    // Earth's "gas" must NOT appear in correctEvidence
    expect(summary.correctEvidence.find(e => e.entity === "Earth")).toBeUndefined();

    // Earth's "gas" MUST appear in incorrectEvidence
    expect(summary.incorrectEvidence).toHaveLength(1);
    expect(summary.incorrectEvidence[0].entity).toBe("Earth");
    expect(summary.incorrectEvidence[0].attribute).toBe("gas");
    expect(summary.incorrectEvidence[0].detail).toContain("rock");

    // Mars's "rock" should appear in correctEvidence
    expect(summary.correctEvidence).toHaveLength(1);
    expect(summary.correctEvidence[0].entity).toBe("Mars");
    expect(summary.correctEvidence[0].attribute).toBe("rock");

    // Summary should not say "Strong" or "met the goal"
    expect(summary.overallLevel).not.toBe("Strong");
    expect(summary.renderedSummary).not.toContain("met the goal");
  });

  test("even if most evidence is correct, one rejection prevents Strong claim", () => {
    const validation: ValidationResult = {
      matchedEntities: ["Earth", "Mars"],
      extractedPairs: [
        { entity: "Earth", attribute: "cheese" }, // WRONG — rejected
        { entity: "Mars", attribute: "rock" },
      ],
      incorrectPairs: [
        { entity: "Earth", claimed: "cheese", acceptable: ["rock", "metal", "iron"] },
      ],
      distinctAttributeTypes: ["cheese", "rock"],
      meetsEvidenceBar: false,
      hasFactualErrors: true,
      isOffTopic: false,
    };

    const checklist: EvidenceChecklistItem[] = [
      { label: "Earth materials described", satisfied: false, type: "entity_attribute" },
      { label: "Mars materials described", satisfied: true, type: "entity_attribute" },
    ];

    const summary = buildTeacherSummary({
      validation,
      checklist,
      overallStatus: "developing",
      requiredEvidence,
      referenceFacts,
    });

    expect(summary.overallLevel).toBe("Developing");
    expect(summary.masteryMet).toBe(false);
    // "cheese" must not be in correct evidence
    expect(summary.correctEvidence.every(e => e.attribute !== "cheese")).toBe(true);
    // "cheese" must be in incorrect evidence
    expect(summary.incorrectEvidence.some(e => e.attribute === "cheese")).toBe(true);
  });
});

// ============================================================================
// Test: Rubric target and cleaned response passthrough
// ============================================================================

describe("buildTeacherSummary — metadata passthrough", () => {
  test("includes rubricTarget and cleanedStudentResponse when provided", () => {
    const validation: ValidationResult = {
      matchedEntities: ["Earth"],
      extractedPairs: [{ entity: "Earth", attribute: "rock" }],
      incorrectPairs: [],
      distinctAttributeTypes: ["rock"],
      meetsEvidenceBar: false,
      hasFactualErrors: false,
      isOffTopic: false,
    };

    const checklist: EvidenceChecklistItem[] = [
      { label: "Earth materials described", satisfied: true, type: "entity_attribute" },
    ];

    const summary = buildTeacherSummary({
      validation,
      checklist,
      overallStatus: "developing",
      requiredEvidence,
      referenceFacts,
      rubricTarget: "Name two planets and describe what each is made of",
      cleanedStudentResponse: "Earth is made of rock",
    });

    expect(summary.rubricTarget).toBe("Name two planets and describe what each is made of");
    expect(summary.cleanedStudentResponse).toBe("Earth is made of rock");
  });
});

// ============================================================================
// Test: Evidence item structure
// ============================================================================

describe("EvidenceItem structure", () => {
  test("correct items have entity and attribute", () => {
    const validation: ValidationResult = {
      matchedEntities: ["Earth"],
      extractedPairs: [{ entity: "Earth", attribute: "rock" }],
      incorrectPairs: [],
      distinctAttributeTypes: ["rock"],
      meetsEvidenceBar: false,
      hasFactualErrors: false,
      isOffTopic: false,
    };

    const checklist: EvidenceChecklistItem[] = [
      { label: "Earth materials described", satisfied: true, type: "entity_attribute" },
    ];

    const summary = buildTeacherSummary({
      validation,
      checklist,
      overallStatus: "developing",
      requiredEvidence,
      referenceFacts,
    });

    const item = summary.correctEvidence[0];
    expect(item.kind).toBe("correct");
    expect(item.entity).toBe("Earth");
    expect(item.attribute).toBe("rock");
    expect(item.label).toContain("Earth");
    expect(item.label).toContain("rock");
  });

  test("incorrect items have detail about acceptable attributes", () => {
    const validation: ValidationResult = {
      matchedEntities: ["Earth"],
      extractedPairs: [{ entity: "Earth", attribute: "gas" }],
      incorrectPairs: [
        { entity: "Earth", claimed: "gas", acceptable: ["rock", "metal", "iron"] },
      ],
      distinctAttributeTypes: ["gas"],
      meetsEvidenceBar: false,
      hasFactualErrors: true,
      isOffTopic: false,
    };

    const checklist: EvidenceChecklistItem[] = [
      { label: "Earth materials described", satisfied: false, type: "entity_attribute" },
    ];

    const summary = buildTeacherSummary({
      validation,
      checklist,
      overallStatus: "needs_support",
      requiredEvidence,
      referenceFacts,
    });

    const item = summary.incorrectEvidence[0];
    expect(item.kind).toBe("incorrect");
    expect(item.entity).toBe("Earth");
    expect(item.attribute).toBe("gas");
    expect(item.detail).toContain("rock");
    expect(item.detail).toContain("metal");
    expect(item.detail).toContain("iron");
  });

  test("missing items have labels from the evidence checklist", () => {
    const validation: ValidationResult = {
      matchedEntities: [],
      extractedPairs: [],
      incorrectPairs: [],
      distinctAttributeTypes: [],
      meetsEvidenceBar: false,
      hasFactualErrors: false,
      isOffTopic: false,
    };

    const checklist: EvidenceChecklistItem[] = [
      { label: "Earth materials described", satisfied: false, type: "entity_attribute" },
      { label: "Mars materials described", satisfied: false, type: "entity_attribute" },
    ];

    const summary = buildTeacherSummary({
      validation,
      checklist,
      overallStatus: "needs_support",
      requiredEvidence,
      referenceFacts,
    });

    expect(summary.missingEvidence).toHaveLength(2);
    expect(summary.missingEvidence[0].kind).toBe("missing");
    expect(summary.missingEvidence[0].label).toBe("Earth materials described");
    expect(summary.missingEvidence[1].label).toBe("Mars materials described");
  });
});

// ============================================================================
// Math teacher summary with reasoning steps
// ============================================================================

describe("buildMathTeacherSummary with reasoning steps", () => {
  const reasoningSteps: ReasoningStep[] = [
    { id: "step_1", label: "Add the ones", expectedStatements: ["4 + 2 = 6"], probe: "What is 4 + 2?", kind: "ones_sum" },
    { id: "step_2", label: "Add the tens", expectedStatements: ["20 + 10 = 30"], probe: "What is 20 + 10?", kind: "tens_sum" },
    { id: "step_3", label: "Combine the totals", expectedStatements: ["30 + 6 = 36", "The final answer is 36"], probe: "What is 30 + 6?", kind: "combine" },
  ];

  const mathProblem = {
    skill: "two_digit_addition" as const,
    a: 24, b: 12, expression: "24 + 12",
    correctAnswer: 36, requiresRegrouping: false,
    expectedStrategyTags: ["add ones", "add tens"],
  };

  test("mastery summary uses concrete step evidence", () => {
    const summary = buildMathTeacherSummary({
      mathValidation: {
        extractedAnswer: 36, correctAnswer: 36, status: "correct",
        demonstratedStrategies: ["add ones", "add tens"],
        hasPartialStrategy: true,
      },
      mathBounding: {
        boundedStatus: "strong", boundedScore: 95,
        wasAdjusted: false, reason: "correct answer with explanation",
      },
      mathProblem,
      cleanedStudentResponse: "4 + 2 is 6, and 20 + 10 is 30, so 30 + 6 = 36",
      reasoningSteps,
      fullTranscript: "4 + 2 is 6, and 20 + 10 is 30, so 30 + 6 = 36",
    });

    expect(summary.masteryMet).toBe(true);
    expect(summary.renderedSummary).toContain("4 + 2 = 6");
    expect(summary.renderedSummary).toContain("20 + 10 = 30");
    expect(summary.renderedSummary).toContain("36");
  });

  test("partial summary mentions missing steps by label", () => {
    const summary = buildMathTeacherSummary({
      mathValidation: {
        extractedAnswer: 36, correctAnswer: 36, status: "correct",
        demonstratedStrategies: ["add ones"],
        hasPartialStrategy: true,
      },
      mathBounding: {
        boundedStatus: "developing", boundedScore: 65,
        wasAdjusted: false, reason: "correct answer, partial explanation",
      },
      mathProblem,
      cleanedStudentResponse: "4 + 2 is 6, the answer is 36",
      reasoningSteps,
      fullTranscript: "4 + 2 is 6, the answer is 36",
    });

    expect(summary.masteryMet).toBe(false);
    // Should mention what's missing
    expect(summary.renderedSummary).toContain("add the tens");
  });

  test("falls back to strategy-based summary when no reasoning steps", () => {
    const summary = buildMathTeacherSummary({
      mathValidation: {
        extractedAnswer: 36, correctAnswer: 36, status: "correct",
        demonstratedStrategies: ["add ones", "add tens"],
        hasPartialStrategy: true,
      },
      mathBounding: {
        boundedStatus: "strong", boundedScore: 95,
        wasAdjusted: false, reason: "correct",
      },
      mathProblem,
      cleanedStudentResponse: "4 + 2 is 6, and 20 + 10 is 30, so 36",
    });

    // No reasoning steps — falls back to strategy-based
    expect(summary.renderedSummary).toContain("24 + 12");
    expect(summary.renderedSummary).toContain("36");
  });

  it("PART 3: summary uses accumulated satisfied reasoning steps", () => {
    const steps: ReasoningStep[] = [
      { id: "ones_sum", label: "Add the ones", expectedStatements: ["1 + 4 = 5"], probe: "What do you get when you add 1 and 4?", kind: "ones_sum" },
      { id: "tens_sum", label: "Add the tens", expectedStatements: ["10 + 10 = 20"], probe: "What do you get when you add 10 and 10?", kind: "tens_sum" },
      { id: "combine", label: "Combine the totals", expectedStatements: ["20 + 5 = 25", "The final answer is 25"], probe: "What do you get when you combine 20 and 5?", kind: "combine" },
    ];

    const summary = buildMathTeacherSummary({
      mathValidation: {
        extractedAnswer: 25, correctAnswer: 25, status: "correct",
        demonstratedStrategies: [],
        hasPartialStrategy: false,
      },
      mathBounding: {
        boundedStatus: "strong", boundedScore: 95,
        wasAdjusted: false, reason: "step-aware",
      },
      mathProblem: { a: 11, b: 14, expression: "11 + 14", correctAnswer: 25, skill: "two_digit_addition", requiresRegrouping: false, expectedStrategyTags: [] },
      cleanedStudentResponse: "20",
      reasoningSteps: steps,
      fullTranscript: "25 five 20 nothing but 20",
      stepAccumulation: {
        satisfiedStepIds: ["ones_sum", "tens_sum", "combine"],
        missingStepIds: [],
        newlySatisfiedStepIds: ["tens_sum"],
        completionRatio: 1,
        answerCorrect: true,
        extractedAnswer: 25,
      },
    });

    // Summary should mention both steps from accumulation
    expect(summary.renderedSummary).toContain("1 + 4 = 5");
    expect(summary.renderedSummary).toContain("10 + 10 = 20");
    expect(summary.renderedSummary).toContain("25");
  });

  it("PART 3: partial accumulation mentions missing steps", () => {
    const steps: ReasoningStep[] = [
      { id: "ones_sum", label: "Add the ones", expectedStatements: ["1 + 4 = 5"], probe: "?", kind: "ones_sum" },
      { id: "tens_sum", label: "Add the tens", expectedStatements: ["10 + 10 = 20"], probe: "?", kind: "tens_sum" },
    ];

    const summary = buildMathTeacherSummary({
      mathValidation: {
        extractedAnswer: 25, correctAnswer: 25, status: "correct",
        demonstratedStrategies: [],
        hasPartialStrategy: false,
      },
      mathBounding: {
        boundedStatus: "developing", boundedScore: 60,
        wasAdjusted: false, reason: "step-aware",
      },
      mathProblem: { a: 11, b: 14, expression: "11 + 14", correctAnswer: 25, skill: "two_digit_addition", requiresRegrouping: false, expectedStrategyTags: [] },
      cleanedStudentResponse: "five",
      reasoningSteps: steps,
      fullTranscript: "25 five",
      stepAccumulation: {
        satisfiedStepIds: ["ones_sum"],
        missingStepIds: ["tens_sum"],
        newlySatisfiedStepIds: ["ones_sum"],
        completionRatio: 0.5,
        answerCorrect: true,
        extractedAnswer: 25,
      },
    });

    // Should mention the satisfied step
    expect(summary.renderedSummary).toContain("1 + 4 = 5");
    // Should mention missing step
    expect(summary.renderedSummary).toMatch(/add the tens/i);
  });
});

// ============================================================================
// Alternate strategy summaries
// ============================================================================

describe("buildMathTeacherSummary — alternate strategy summaries", () => {
  const steps14plus11: ReasoningStep[] = [
    { id: "ones_sum", label: "Add the ones", expectedStatements: ["4 + 1 = 5"], probe: "?", kind: "ones_sum" },
    { id: "tens_sum", label: "Add the tens", expectedStatements: ["10 + 10 = 20"], probe: "?", kind: "tens_sum" },
    { id: "combine", label: "Combine the totals", expectedStatements: ["20 + 5 = 25"], probe: "?", kind: "combine" },
  ];

  const mathProblem14plus11 = {
    a: 14, b: 11, expression: "14 + 11",
    correctAnswer: 25, skill: "two_digit_addition" as const,
    requiresRegrouping: false, expectedStrategyTags: [],
  };

  test("split-addend strategy: describes student's actual reasoning, not canonical steps", () => {
    const transcript = "well 14 + 11 if I split up the 11 to a 10 and a 1 I can add the 10 to the 14 so 10 + 14 is 24 and then an extra 1 is 25";
    const summary = buildMathTeacherSummary({
      mathValidation: {
        extractedAnswer: 25, correctAnswer: 25, status: "correct",
        demonstratedStrategies: [], hasPartialStrategy: false,
      },
      mathBounding: {
        boundedStatus: "strong", boundedScore: 95,
        wasAdjusted: false, reason: "alternate strategy",
      },
      mathProblem: mathProblem14plus11,
      cleanedStudentResponse: transcript,
      reasoningSteps: steps14plus11,
      fullTranscript: transcript,
      stepAccumulation: {
        satisfiedStepIds: ["ones_sum"],
        missingStepIds: ["tens_sum", "combine"],
        newlySatisfiedStepIds: [],
        completionRatio: 0.33,
        answerCorrect: true,
        extractedAnswer: 25,
        alternateStrategyDetected: true,
      },
    });

    // Should describe actual strategy, NOT canonical steps
    expect(summary.renderedSummary).toContain("splitting 11");
    expect(summary.renderedSummary).toContain("14");
    expect(summary.renderedSummary).toContain("25");
    // Must NOT mention missing canonical steps
    expect(summary.renderedSummary).not.toContain("did not yet explain");
    expect(summary.renderedSummary).not.toContain("add the tens");
    expect(summary.renderedSummary).not.toContain("combine the totals");
  });

  test("tens-first-count-on strategy: describes student's actual reasoning", () => {
    const transcript = "I'm going to start with the tens so 10 + 10 is 20 then I'll take the 20 and add 4 and get 24 and then plus 1 to get 25";
    const summary = buildMathTeacherSummary({
      mathValidation: {
        extractedAnswer: 25, correctAnswer: 25, status: "correct",
        demonstratedStrategies: [], hasPartialStrategy: false,
      },
      mathBounding: {
        boundedStatus: "strong", boundedScore: 95,
        wasAdjusted: false, reason: "alternate strategy",
      },
      mathProblem: mathProblem14plus11,
      cleanedStudentResponse: transcript,
      reasoningSteps: steps14plus11,
      fullTranscript: transcript,
      stepAccumulation: {
        satisfiedStepIds: ["tens_sum"],
        missingStepIds: ["ones_sum", "combine"],
        newlySatisfiedStepIds: [],
        completionRatio: 0.33,
        answerCorrect: true,
        extractedAnswer: 25,
        alternateStrategyDetected: true,
      },
    });

    // Should describe the tens-first approach
    expect(summary.renderedSummary).toContain("10 + 10 = 20");
    expect(summary.renderedSummary).toContain("25");
    // Must NOT mention missing canonical steps
    expect(summary.renderedSummary).not.toContain("did not yet explain");
    expect(summary.renderedSummary).not.toContain("add the ones");
  });

  test("canonical path still summarized correctly (no regression)", () => {
    const transcript = "4 + 1 is 5, and 10 + 10 is 20, so 20 + 5 is 25";
    const summary = buildMathTeacherSummary({
      mathValidation: {
        extractedAnswer: 25, correctAnswer: 25, status: "correct",
        demonstratedStrategies: [], hasPartialStrategy: false,
      },
      mathBounding: {
        boundedStatus: "strong", boundedScore: 95,
        wasAdjusted: false, reason: "all steps",
      },
      mathProblem: mathProblem14plus11,
      cleanedStudentResponse: transcript,
      reasoningSteps: steps14plus11,
      fullTranscript: transcript,
      stepAccumulation: {
        satisfiedStepIds: ["ones_sum", "tens_sum", "combine"],
        missingStepIds: [],
        newlySatisfiedStepIds: [],
        completionRatio: 1,
        answerCorrect: true,
        extractedAnswer: 25,
        // NOT alternateStrategyDetected — canonical path
      },
    });

    // Should mention all canonical steps
    expect(summary.renderedSummary).toContain("4 + 1 = 5");
    expect(summary.renderedSummary).toContain("10 + 10 = 20");
    expect(summary.renderedSummary).toContain("25");
    expect(summary.renderedSummary).toContain("explained all steps");
  });

  test("answer-only with no explanation gets appropriate summary", () => {
    const transcript = "25";
    const summary = buildMathTeacherSummary({
      mathValidation: {
        extractedAnswer: 25, correctAnswer: 25, status: "correct",
        demonstratedStrategies: [], hasPartialStrategy: false,
      },
      mathBounding: {
        boundedStatus: "developing", boundedScore: 50,
        wasAdjusted: false, reason: "answer only",
      },
      mathProblem: mathProblem14plus11,
      cleanedStudentResponse: transcript,
      reasoningSteps: steps14plus11,
      fullTranscript: transcript,
      stepAccumulation: {
        satisfiedStepIds: [],
        missingStepIds: ["ones_sum", "tens_sum", "combine"],
        newlySatisfiedStepIds: [],
        completionRatio: 0,
        answerCorrect: true,
        extractedAnswer: 25,
        // No alternate strategy — just an answer
      },
    });

    // Should note correct answer but missing explanation
    expect(summary.renderedSummary).toContain("correct");
    expect(summary.renderedSummary).toContain("25");
    expect(summary.renderedSummary).toMatch(/did not yet explain/i);
  });

  test("live transcript 1: split-addend 14+11 with split 11", () => {
    // Exact user-provided transcript
    const transcript = "well 14 + 11 if I split up the 11 to a 10 and a one I can add the 10 to the 14 so 10 + 14 is 24 and then an extra one is 25";
    const summary = buildMathTeacherSummary({
      mathValidation: {
        extractedAnswer: 25, correctAnswer: 25, status: "correct",
        demonstratedStrategies: [], hasPartialStrategy: false,
      },
      mathBounding: {
        boundedStatus: "strong", boundedScore: 95,
        wasAdjusted: false, reason: "alternate strategy",
      },
      mathProblem: mathProblem14plus11,
      cleanedStudentResponse: transcript,
      reasoningSteps: steps14plus11,
      fullTranscript: transcript,
      stepAccumulation: {
        satisfiedStepIds: [],
        missingStepIds: ["ones_sum", "tens_sum", "combine"],
        newlySatisfiedStepIds: [],
        completionRatio: 0,
        answerCorrect: true,
        extractedAnswer: 25,
        alternateStrategyDetected: true,
      },
    });

    // Should describe split-addend approach
    expect(summary.renderedSummary).toContain("solved 14 + 11 correctly (=25)");
    expect(summary.renderedSummary).not.toContain("did not yet explain");
    expect(summary.renderedSummary).toContain("splitting 11");
    expect(summary.renderedSummary).toContain("14");
  });

  test("live transcript 2: tens-first 14+11 across two turns", () => {
    // Multi-turn transcript combined
    const transcript = "I'm going to start with the tens so I'm going to add 10 + 10 and that's 20 then I'll take the 20 and add 4 and get 24 and then plus 1 to get 25";
    const summary = buildMathTeacherSummary({
      mathValidation: {
        extractedAnswer: 25, correctAnswer: 25, status: "correct",
        demonstratedStrategies: [], hasPartialStrategy: false,
      },
      mathBounding: {
        boundedStatus: "strong", boundedScore: 95,
        wasAdjusted: false, reason: "alternate strategy",
      },
      mathProblem: mathProblem14plus11,
      cleanedStudentResponse: transcript,
      reasoningSteps: steps14plus11,
      fullTranscript: transcript,
      stepAccumulation: {
        satisfiedStepIds: ["tens_sum"],
        missingStepIds: ["ones_sum", "combine"],
        newlySatisfiedStepIds: [],
        completionRatio: 0.33,
        answerCorrect: true,
        extractedAnswer: 25,
        alternateStrategyDetected: true,
      },
    });

    expect(summary.renderedSummary).toContain("solved 14 + 11 correctly (=25)");
    expect(summary.renderedSummary).not.toContain("did not yet explain");
    expect(summary.renderedSummary).toContain("10 + 10 = 20");
    expect(summary.renderedSummary).toContain("25");
  });

  test("STT transcript with missing equals: '14 + 10 24' and 'break it up into'", () => {
    const transcript = "well 14 + 11 if I take that 11 and break it up into 10 and 1 to 14 + 10 24 and then add the one to get 25 25 is the answer";
    const summary = buildMathTeacherSummary({
      mathValidation: {
        extractedAnswer: 25, correctAnswer: 25, status: "correct",
        demonstratedStrategies: [], hasPartialStrategy: false,
      },
      mathBounding: {
        boundedStatus: "strong", boundedScore: 95,
        wasAdjusted: false, reason: "alternate strategy",
      },
      mathProblem: mathProblem14plus11,
      cleanedStudentResponse: transcript,
      reasoningSteps: steps14plus11,
      fullTranscript: transcript,
      stepAccumulation: {
        satisfiedStepIds: [],
        missingStepIds: ["ones_sum", "tens_sum", "combine"],
        newlySatisfiedStepIds: [],
        completionRatio: 0,
        answerCorrect: true,
        extractedAnswer: 25,
        alternateStrategyDetected: true,
      },
    });

    // Must NOT say "unclear" or mention missing canonical steps
    expect(summary.renderedSummary).not.toContain("unclear");
    expect(summary.renderedSummary).not.toContain("did not yet explain");
    // Should describe the split-addend strategy
    expect(summary.renderedSummary).toContain("splitting 11");
    expect(summary.renderedSummary).toContain("14 + 10 = 24");
    expect(summary.renderedSummary).toContain("24 + 1 = 25");
  });

  test("STT decomposition-only: 'break 11 into 10 and 1' with no explicit equations", () => {
    // Extreme STT case: student describes decomposition but no formatted equations
    const transcript = "I take 11 and break it up into 10 and 1 then put the 10 with 14 to get 24 then the 1 makes 25";
    const summary = buildMathTeacherSummary({
      mathValidation: {
        extractedAnswer: 25, correctAnswer: 25, status: "correct",
        demonstratedStrategies: [], hasPartialStrategy: false,
      },
      mathBounding: {
        boundedStatus: "strong", boundedScore: 95,
        wasAdjusted: false, reason: "alternate strategy",
      },
      mathProblem: mathProblem14plus11,
      cleanedStudentResponse: transcript,
      reasoningSteps: steps14plus11,
      fullTranscript: transcript,
      stepAccumulation: {
        satisfiedStepIds: [],
        missingStepIds: ["ones_sum", "tens_sum", "combine"],
        newlySatisfiedStepIds: [],
        completionRatio: 0,
        answerCorrect: true,
        extractedAnswer: 25,
        alternateStrategyDetected: true,
      },
    });

    // Should NOT say unclear
    expect(summary.renderedSummary).not.toContain("unclear");
    expect(summary.renderedSummary).not.toContain("did not yet explain");
    // Should describe splitting strategy
    expect(summary.renderedSummary).toContain("splitting 11");
    expect(summary.renderedSummary).toContain("25");
  });

  test("safety: alternateStrategyDetected never produces 'unclear' or canonical missing-step language", () => {
    // Even a very messy STT transcript should not say "unclear" when alternate detected
    const transcript = "um so 25 because 14 and 11 I did 10 plus 14 is 24 and 1 more";
    const summary = buildMathTeacherSummary({
      mathValidation: {
        extractedAnswer: 25, correctAnswer: 25, status: "correct",
        demonstratedStrategies: [], hasPartialStrategy: false,
      },
      mathBounding: {
        boundedStatus: "strong", boundedScore: 95,
        wasAdjusted: false, reason: "alternate strategy",
      },
      mathProblem: mathProblem14plus11,
      cleanedStudentResponse: transcript,
      reasoningSteps: steps14plus11,
      fullTranscript: transcript,
      stepAccumulation: {
        satisfiedStepIds: [],
        missingStepIds: ["ones_sum", "tens_sum", "combine"],
        newlySatisfiedStepIds: [],
        completionRatio: 0,
        answerCorrect: true,
        extractedAnswer: 25,
        alternateStrategyDetected: true,
      },
    });

    expect(summary.renderedSummary).not.toContain("unclear");
    expect(summary.renderedSummary).not.toContain("did not yet explain");
    expect(summary.renderedSummary).toContain("solved 14 + 11 correctly (=25)");
  });

  test("STT with 'just' and 'should be' result indicators: split-that-into-a", () => {
    const transcript = "14 + 11 I would take that 14 and then look at the 11 and split that into a 10 and 1 so it had 14 + 10 just 24 and then add the remaining one should be 25 25 the correct answer";
    const summary = buildMathTeacherSummary({
      mathValidation: {
        extractedAnswer: 25, correctAnswer: 25, status: "correct",
        demonstratedStrategies: [], hasPartialStrategy: false,
      },
      mathBounding: {
        boundedStatus: "strong", boundedScore: 95,
        wasAdjusted: false, reason: "alternate strategy",
      },
      mathProblem: mathProblem14plus11,
      cleanedStudentResponse: transcript,
      reasoningSteps: steps14plus11,
      fullTranscript: transcript,
      stepAccumulation: {
        satisfiedStepIds: [],
        missingStepIds: ["ones_sum", "tens_sum", "combine"],
        newlySatisfiedStepIds: [],
        completionRatio: 0,
        answerCorrect: true,
        extractedAnswer: 25,
        alternateStrategyDetected: true,
      },
    });

    // Must NOT say generic "showed their reasoning" or "unclear"
    expect(summary.renderedSummary).not.toContain("showed their reasoning");
    expect(summary.renderedSummary).not.toContain("unclear");
    expect(summary.renderedSummary).not.toContain("did not yet explain");
    // Should describe the concrete chain
    expect(summary.renderedSummary).toContain("splitting 11");
    expect(summary.renderedSummary).toContain("14 + 10 = 24");
    expect(summary.renderedSummary).toContain("24 + 1 = 25");
  });

  test("STT with 'to get' result indicator: full chain not compressed", () => {
    const transcript = "so for 14 + 11 I would take the 14 and then split the 11 into a 10 and a one I'd add 14 + 10 to get 24 and then add the one and get 25";
    const summary = buildMathTeacherSummary({
      mathValidation: {
        extractedAnswer: 25, correctAnswer: 25, status: "correct",
        demonstratedStrategies: [], hasPartialStrategy: false,
      },
      mathBounding: {
        boundedStatus: "strong", boundedScore: 95,
        wasAdjusted: false, reason: "alternate strategy",
      },
      mathProblem: mathProblem14plus11,
      cleanedStudentResponse: transcript,
      reasoningSteps: steps14plus11,
      fullTranscript: transcript,
      stepAccumulation: {
        satisfiedStepIds: [],
        missingStepIds: ["ones_sum", "tens_sum", "combine"],
        newlySatisfiedStepIds: [],
        completionRatio: 0,
        answerCorrect: true,
        extractedAnswer: 25,
        alternateStrategyDetected: true,
      },
    });

    // Must show full chain, not just final step
    expect(summary.renderedSummary).not.toContain("by showing: 24 + 1 = 25");
    expect(summary.renderedSummary).toContain("splitting 11");
    expect(summary.renderedSummary).toContain("14 + 10 = 24");
    expect(summary.renderedSummary).toContain("24 + 1 = 25");
  });
});

// ============================================================================
// ATTRIBUTION: sub-step answer not misrepresented as wrong final answer
// ============================================================================
describe("teacher summary attribution: sub-step vs whole-problem", () => {
  test("sub-step answer (20) with demonstrated steps is NOT reported as 'gave 20 instead of 25'", () => {
    const mathProblem = {
      skill: "two_digit_addition" as const,
      a: 14, b: 11, expression: "14 + 11",
      correctAnswer: 25, requiresRegrouping: false,
      expectedStrategyTags: ["add ones", "add tens"],
    };

    const summary = buildMathTeacherSummary({
      mathProblem,
      mathValidation: {
        status: "incorrect_unknown" as const,
        extractedAnswer: 20,
        correctAnswer: 25,
        demonstratedStrategies: [] as string[],
        hasPartialStrategy: false,
      },
      mathBounding: {
        boundedStatus: "needs_support", boundedScore: 30,
        wasAdjusted: false, reason: "sub-step only",
      },
      reasoningSteps: [
        { id: "ones_sum", label: "Add the ones", expectedStatements: ["4 + 1 = 5"], probe: "What is 4 + 1?", kind: "ones_sum" as const },
        { id: "tens_sum", label: "Add the tens", expectedStatements: ["10 + 10 = 20"], probe: "What is 10 + 10?", kind: "tens_sum" as const },
        { id: "combine", label: "Combine", expectedStatements: ["20 + 5 = 25"], probe: "What is 20 + 5?", kind: "combine" as const },
      ],
      cleanedStudentResponse: "20",
      fullTranscript: "5 20",
      stepAccumulation: {
        satisfiedStepIds: ["ones_sum", "tens_sum"],
        missingStepIds: ["combine"],
        newlySatisfiedStepIds: ["tens_sum"],
        completionRatio: 0.67,
        answerCorrect: false,
        extractedAnswer: 20,
      },
    });

    // Must NOT say "gave 20 instead of 25" — 20 was a correct sub-step, not a wrong final
    expect(summary.renderedSummary).not.toMatch(/gave 20 instead of 25/i);
    // Should mention sub-steps were correct
    expect(summary.renderedSummary).toMatch(/sub-step|not yet.*final/i);
  });

  test("operand value (14) from decomposition is NOT reported as 'gave 14 instead of 25'", () => {
    const mathProblem = {
      skill: "two_digit_addition" as const,
      a: 14, b: 11, expression: "14 + 11",
      correctAnswer: 25, requiresRegrouping: false,
      expectedStrategyTags: ["add ones", "add tens"],
    };

    const summary = buildMathTeacherSummary({
      mathProblem,
      mathValidation: {
        status: "incorrect_unknown" as const,
        extractedAnswer: 14,
        correctAnswer: 25,
        demonstratedStrategies: [] as string[],
        hasPartialStrategy: false,
      },
      mathBounding: {
        boundedStatus: "needs_support", boundedScore: 20,
        wasAdjusted: false, reason: "decomposition only",
      },
      reasoningSteps: [
        { id: "ones_sum", label: "Add the ones", expectedStatements: ["4 + 1 = 5"], probe: "What is 4 + 1?", kind: "ones_sum" as const },
        { id: "tens_sum", label: "Add the tens", expectedStatements: ["10 + 10 = 20"], probe: "What is 10 + 10?", kind: "tens_sum" as const },
        { id: "combine", label: "Combine", expectedStatements: ["20 + 5 = 25"], probe: "What is 20 + 5?", kind: "combine" as const },
      ],
      cleanedStudentResponse: "5 + 9 = 14",
      fullTranscript: "split 14 to 5 + 9. 5 + 9 = 14",
      stepAccumulation: {
        satisfiedStepIds: [],
        missingStepIds: ["ones_sum", "tens_sum", "combine"],
        newlySatisfiedStepIds: [],
        completionRatio: 0,
        answerCorrect: false,
        extractedAnswer: 14,
      },
    });

    // Must NOT say "gave 14 instead of 25" — 14 is the operand being decomposed
    expect(summary.renderedSummary).not.toMatch(/gave 14 instead of 25/i);
    // Should describe it as a decomposition/strategy attempt
    expect(summary.renderedSummary).toMatch(/decomposition|strategy|not yet.*final/i);
  });

  // Bug D: student explicitly denies answering a step → summary should not credit it
  test("explicit negation 'I didn't answer the five' → step NOT credited as demonstrated", () => {
    const summary = buildMathTeacherSummary({
      mathProblem: {
        skill: "two_digit_addition",
        a: 14, b: 11, expression: "14 + 11",
        correctAnswer: 25, requiresRegrouping: false,
        expectedStrategyTags: ["add ones", "add tens"],
      },
      mathValidation: {
        extractedAnswer: 20, correctAnswer: 25, status: "incorrect_unknown" as const,
        demonstratedStrategies: [], hasPartialStrategy: false,
      },
      mathBounding: {
        boundedStatus: "needs_support", boundedScore: 30,
        wasAdjusted: false, reason: "partial steps only",
      },
      reasoningSteps: [
        { id: "ones_sum", label: "Add the ones", expectedStatements: ["4 + 1 = 5"], probe: "What is 4 + 1?", kind: "ones_sum" as const },
        { id: "tens_sum", label: "Add the tens", expectedStatements: ["10 + 10 = 20"], probe: "What is 10 + 10?", kind: "tens_sum" as const },
        { id: "combine", label: "Combine", expectedStatements: ["20 + 5 = 25"], probe: "What is 20 + 5?", kind: "combine" as const },
      ],
      cleanedStudentResponse: "I didn't answer the five but 10 and 10 is 20",
      fullTranscript: "Coach: What is 4 + 1? Student: I didn't answer the five but 10 and 10 is 20",
      stepAccumulation: {
        satisfiedStepIds: ["ones_sum", "tens_sum"],
        missingStepIds: ["combine"],
        newlySatisfiedStepIds: ["tens_sum"],
        completionRatio: 0.67,
        answerCorrect: false,
        extractedAnswer: 20,
      },
    });

    // Must NOT credit "add the ones" / "4 + 1 = 5" as demonstrated
    expect(summary.renderedSummary).not.toMatch(/explained that 4 \+ 1 = 5/i);
    // SHOULD credit "add the tens" as demonstrated
    expect(summary.renderedSummary).toMatch(/10 \+ 10 = 20/i);
    // The ones step should appear as missing
    expect(summary.renderedSummary).toMatch(/add the ones/i);
  });

  // Bug: summary says "gave 7 instead of 25" when 7 was only a decomposition part
  test("decomposition part (7 from '14 = 7 + 7') is NOT reported as a final answer attempt", () => {
    const summary = buildMathTeacherSummary({
      mathProblem: {
        skill: "two_digit_addition",
        a: 14, b: 11, expression: "14 + 11",
        correctAnswer: 25, requiresRegrouping: false,
        expectedStrategyTags: ["add ones", "add tens"],
      },
      mathValidation: {
        extractedAnswer: 7, correctAnswer: 25, status: "incorrect_unknown" as const,
        demonstratedStrategies: [], hasPartialStrategy: false,
      },
      mathBounding: {
        boundedStatus: "needs_support", boundedScore: 30,
        wasAdjusted: false, reason: "partial steps only",
      },
      reasoningSteps: [
        { id: "ones_sum", label: "Add the ones", expectedStatements: ["4 + 1 = 5"], probe: "What is 4 + 1?", kind: "ones_sum" as const },
        { id: "tens_sum", label: "Add the tens", expectedStatements: ["10 + 10 = 20"], probe: "What is 10 + 10?", kind: "tens_sum" as const },
        { id: "combine", label: "Combine", expectedStatements: ["20 + 5 = 25"], probe: "What is 20 + 5?", kind: "combine" as const },
      ],
      cleanedStudentResponse: "14 is 7 + 7 and 11 is 5 + 6",
      fullTranscript: "Coach: What is 14 + 11? Student: 14 is 7 + 7 and 11 is 5 + 6. Student: I said 14 is 7 + 7. Coach: Let's use tens and ones.",
      stepAccumulation: {
        satisfiedStepIds: ["ones_sum"],
        missingStepIds: ["tens_sum", "combine"],
        newlySatisfiedStepIds: [],
        completionRatio: 0.33,
        answerCorrect: false,
        extractedAnswer: 7,
      },
    });

    // Must NOT say "gave 7 instead of 25" — 7 is a decomposition part
    expect(summary.renderedSummary).not.toMatch(/gave 7 instead of 25/i);
    // Should describe decomposition exploration or partial progress
    expect(summary.renderedSummary).toMatch(/decomposition|split|explored|sub-steps/i);
  });
});

// ============================================================================
// Transcript-level summary quality: noisy/misleading reconstruction
// ============================================================================

describe("Summary quality — noisy transcript reconstruction", () => {
  const steps14plus11: ReasoningStep[] = [
    { id: "ones_sum", label: "Add the ones", expectedStatements: ["4 + 1 = 5"], probe: "?", kind: "ones_sum" },
    { id: "tens_sum", label: "Add the tens", expectedStatements: ["10 + 10 = 20"], probe: "?", kind: "tens_sum" },
    { id: "combine", label: "Combine the totals", expectedStatements: ["20 + 5 = 25"], probe: "?", kind: "combine" },
  ];

  const mathProblem14plus11 = {
    a: 14, b: 11, expression: "14 + 11",
    correctAnswer: 25, skill: "two_digit_addition" as const,
    requiresRegrouping: false, expectedStrategyTags: [],
  };

  // Case 1: Noncanonical decomposition with bad interim coach probe
  // Student decomposed 14=8+6, 11=5+6. Coach asked "What is 8+5?" (wrong pair).
  // Student answered, then student corrected to 6+6, then completed.
  // Summary should NOT list 8+5 as student's chosen reasoning.
  test("noncanonical with bad coach probe: summary shows final path, not interim detour", () => {
    // fullTranscript = all student turns concatenated
    const fullTranscript = [
      "14 is 8 plus 6 and 11 is 5 plus 6",
      "8 plus 5 is 13",          // answering bad coach probe
      "I think you mean 6 plus 6",
      "6 plus 6 is 12",
      "12 plus 13 is 25",
    ].join(" ");

    const summary = buildMathTeacherSummary({
      mathValidation: {
        extractedAnswer: 25, correctAnswer: 25, status: "correct",
        demonstratedStrategies: [], hasPartialStrategy: false,
      },
      mathBounding: {
        boundedStatus: "strong", boundedScore: 95,
        wasAdjusted: false, reason: "alternate strategy",
      },
      mathProblem: mathProblem14plus11,
      cleanedStudentResponse: "12 plus 13 is 25",
      reasoningSteps: steps14plus11,
      fullTranscript,
      stepAccumulation: {
        satisfiedStepIds: [],
        missingStepIds: ["ones_sum", "tens_sum", "combine"],
        newlySatisfiedStepIds: [],
        completionRatio: 0,
        answerCorrect: true,
        extractedAnswer: 25,
        alternateStrategyDetected: true,
      },
    });

    expect(summary.renderedSummary).toContain("25");
    expect(summary.renderedSummary).toContain("solved");
    // Should describe the decomposition
    expect(summary.renderedSummary).toMatch(/8 \+ 6|5 \+ 6|splitting|decompos/i);
    // Should NOT lead with or emphasize the bad coach probe pair as the student's method
    // 8+5 may appear as a computed step (it IS valid math), but the description
    // should emphasize the decomposition strategy, not list 8+5 as the first/primary step
    expect(summary.renderedSummary).not.toMatch(/^.*by showing: 8 \+ 5/);
  });

  // Case 2: Method-repair — student corrects coach pair
  // Coach said "What is 8+5?", student said "you mean 6+6", then computed.
  // Summary should reflect the corrected pair.
  test("method-repair correction: summary reflects corrected pair, not mistaken coach pair", () => {
    const fullTranscript = [
      "14 is 8 plus 6 and 11 is 5 plus 6",
      "you mean 6 plus 6",
      "6 plus 6 is 12",
      "8 plus 5 is 13",
      "12 plus 13 is 25",
    ].join(" ");

    const summary = buildMathTeacherSummary({
      mathValidation: {
        extractedAnswer: 25, correctAnswer: 25, status: "correct",
        demonstratedStrategies: [], hasPartialStrategy: false,
      },
      mathBounding: {
        boundedStatus: "strong", boundedScore: 95,
        wasAdjusted: false, reason: "alternate strategy",
      },
      mathProblem: mathProblem14plus11,
      cleanedStudentResponse: "12 plus 13 is 25",
      reasoningSteps: steps14plus11,
      fullTranscript,
      stepAccumulation: {
        satisfiedStepIds: [],
        missingStepIds: ["ones_sum", "tens_sum", "combine"],
        newlySatisfiedStepIds: [],
        completionRatio: 0,
        answerCorrect: true,
        extractedAnswer: 25,
        alternateStrategyDetected: true,
      },
    });

    expect(summary.renderedSummary).toContain("25");
    // Must mention 6+6 in the chain (student's corrected pair)
    expect(summary.renderedSummary).toMatch(/6 \+ 6/);
  });

  // Case 3: Structure confusion — student never provides math evidence
  test("structure confusion only: summary says not enough evidence", () => {
    const fullTranscript = [
      "what does that have to do with the problem",
      "I still don't get why we're doing that",
      "I don't know",
    ].join(" ");

    const summary = buildMathTeacherSummary({
      mathValidation: {
        extractedAnswer: null, correctAnswer: 25, status: "no_answer",
        demonstratedStrategies: [], hasPartialStrategy: false,
      },
      mathBounding: {
        boundedStatus: "needs_support", boundedScore: 10,
        wasAdjusted: false, reason: "no evidence",
      },
      mathProblem: mathProblem14plus11,
      cleanedStudentResponse: "I don't know",
      reasoningSteps: steps14plus11,
      fullTranscript,
      stepAccumulation: {
        satisfiedStepIds: [],
        missingStepIds: ["ones_sum", "tens_sum", "combine"],
        newlySatisfiedStepIds: [],
        completionRatio: 0,
        answerCorrect: false,
        extractedAnswer: null,
      },
    });

    // Must not imply the student explained any steps
    expect(summary.renderedSummary).not.toMatch(/explained/i);
    // Must say something about lack of evidence
    expect(summary.renderedSummary).toMatch(/did not provide|not enough|attempted/i);
    // Must NOT list specific math steps as demonstrated
    expect(summary.renderedSummary).not.toMatch(/\d+ \+ \d+ = \d+/);
  });
});

// ============================================================================
// Multi-decomposition chain ordering
// ============================================================================

describe("Multi-decomposition summary ordering", () => {
  const steps14plus11: ReasoningStep[] = [
    { id: "ones_sum", label: "Add the ones", expectedStatements: ["4 + 1 = 5"], probe: "?", kind: "ones_sum" },
    { id: "tens_sum", label: "Add the tens", expectedStatements: ["10 + 10 = 20"], probe: "?", kind: "tens_sum" },
    { id: "combine", label: "Combine the totals", expectedStatements: ["20 + 5 = 25"], probe: "?", kind: "combine" },
  ];

  const mathProblem14plus11 = {
    a: 14, b: 11, expression: "14 + 11",
    correctAnswer: 25, skill: "two_digit_addition" as const,
    requiresRegrouping: false, expectedStrategyTags: [],
  };

  const altAccumulation = {
    satisfiedStepIds: [] as string[],
    missingStepIds: ["ones_sum", "tens_sum", "combine"],
    newlySatisfiedStepIds: [] as string[],
    completionRatio: 0,
    answerCorrect: true,
    extractedAnswer: 25,
    alternateStrategyDetected: true,
  };

  test("bad coach probe answered first, student corrects → shared factor leads summary", () => {
    // Transcript order: 8+5 appears before 6+6 (student answered bad probe first).
    // Summary should reorder: 6+6 (shared factor) before 8+5.
    const fullTranscript = [
      "14 is 8 plus 6 and 11 is 5 plus 6",
      "8 plus 5 is 13",
      "I mean 6 plus 6",
      "6 plus 6 is 12",
      "12 plus 13 is 25",
    ].join(" ");

    const summary = buildMathTeacherSummary({
      mathValidation: {
        extractedAnswer: 25, correctAnswer: 25, status: "correct",
        demonstratedStrategies: [], hasPartialStrategy: false,
      },
      mathBounding: {
        boundedStatus: "strong", boundedScore: 95,
        wasAdjusted: false, reason: "alternate strategy",
      },
      mathProblem: mathProblem14plus11,
      cleanedStudentResponse: "12 plus 13 is 25",
      reasoningSteps: steps14plus11,
      fullTranscript,
      stepAccumulation: altAccumulation,
    });

    // 6+6 (shared factor) must appear BEFORE 8+5 in the summary
    const idx66 = summary.renderedSummary.indexOf("6 + 6 = 12");
    const idx85 = summary.renderedSummary.indexOf("8 + 5 = 13");
    expect(idx66).toBeGreaterThan(-1);
    expect(idx85).toBeGreaterThan(-1);
    expect(idx66).toBeLessThan(idx85);
    // Final combination is last
    expect(summary.renderedSummary).toMatch(/12 \+ 13 = 25\.$/);
  });

  test("both valid pairs present, summary prefers student-led core path", () => {
    // Student computes 6+6=12 and 8+5=13 (both valid cross-pairs).
    // 6+6 is the shared factor → should appear first regardless of transcript order.
    // Also: the detour equation "5+8=13" (duplicate of 8+5 in reverse) should be deduped.
    const fullTranscript = [
      "14 is 8 plus 6 and 11 is 5 plus 6",
      "5 plus 8 is 13",
      "6 plus 6 is 12",
      "13 plus 12 is 25",
    ].join(" ");

    const summary = buildMathTeacherSummary({
      mathValidation: {
        extractedAnswer: 25, correctAnswer: 25, status: "correct",
        demonstratedStrategies: [], hasPartialStrategy: false,
      },
      mathBounding: {
        boundedStatus: "strong", boundedScore: 95,
        wasAdjusted: false, reason: "alternate strategy",
      },
      mathProblem: mathProblem14plus11,
      cleanedStudentResponse: "13 plus 12 is 25",
      reasoningSteps: steps14plus11,
      fullTranscript,
      stepAccumulation: altAccumulation,
    });

    // Shared factor 6+6 appears before 5+8/8+5
    const idx66 = summary.renderedSummary.indexOf("6 + 6 = 12");
    expect(idx66).toBeGreaterThan(-1);
    // Must still contain enough detail to trace to the answer
    expect(summary.renderedSummary).toContain("25");
    expect(summary.renderedSummary).toMatch(/13 \+ 12 = 25|12 \+ 13 = 25/);
  });

  test("summary has enough detail to show complete path from decomposition to answer", () => {
    // Clean transcript: student decomposes both, computes both cross-pairs, combines.
    const fullTranscript = [
      "14 is 8 plus 6 and 11 is 5 plus 6",
      "6 plus 6 is 12",
      "8 plus 5 is 13",
      "12 plus 13 is 25",
    ].join(" ");

    const summary = buildMathTeacherSummary({
      mathValidation: {
        extractedAnswer: 25, correctAnswer: 25, status: "correct",
        demonstratedStrategies: [], hasPartialStrategy: false,
      },
      mathBounding: {
        boundedStatus: "strong", boundedScore: 95,
        wasAdjusted: false, reason: "alternate strategy",
      },
      mathProblem: mathProblem14plus11,
      cleanedStudentResponse: "12 plus 13 is 25",
      reasoningSteps: steps14plus11,
      fullTranscript,
      stepAccumulation: altAccumulation,
    });

    // Must describe: decompositions + both cross-pairs + final combination
    expect(summary.renderedSummary).toContain("14 = 8 + 6");
    expect(summary.renderedSummary).toContain("11 = 5 + 6");
    expect(summary.renderedSummary).toContain("6 + 6 = 12");
    expect(summary.renderedSummary).toContain("8 + 5 = 13");
    expect(summary.renderedSummary).toContain("12 + 13 = 25");
    // All in one sentence
    expect(summary.renderedSummary.split(".").filter(s => s.trim()).length).toBeLessThanOrEqual(2);
  });
});
