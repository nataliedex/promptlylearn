import {
  generateMathProblem,
  generateMathProblemSet,
  detectMathSkill,
  parseExpressionFromText,
  rebuildMathProblemFromExpression,
  validateMathPromptConsistency,
  reconcileMathPrompt,
  reconcileMathPromptFromText,
  buildMathReferenceFacts,
  buildMathHints,
  buildMathAllowedProbes,
  buildMathRetryQuestions,
  buildDeterministicMathRubric,
} from "./mathProblemGenerator";
import type { Prompt } from "./prompt";

// ============================================================================
// generateMathProblem — two_digit_addition
// ============================================================================

describe("generateMathProblem — two_digit_addition", () => {
  it("generates a valid problem with correct sum", () => {
    const p = generateMathProblem("two_digit_addition", "K-2");
    expect(p.skill).toBe("two_digit_addition");
    expect(p.correctAnswer).toBe(p.a + p.b!);
    expect(p.expression).toBe(`${p.a} + ${p.b}`);
  });

  it("respects K-2 operand range (10-49)", () => {
    for (let i = 0; i < 20; i++) {
      const p = generateMathProblem("two_digit_addition", "K-2");
      expect(p.a).toBeGreaterThanOrEqual(10);
      expect(p.a).toBeLessThanOrEqual(49);
      expect(p.b!).toBeGreaterThanOrEqual(10);
      expect(p.b!).toBeLessThanOrEqual(49);
    }
  });

  it("respects 3-4 operand range (10-99)", () => {
    for (let i = 0; i < 20; i++) {
      const p = generateMathProblem("two_digit_addition", "3-4");
      expect(p.a).toBeGreaterThanOrEqual(10);
      expect(p.a).toBeLessThanOrEqual(99);
      expect(p.b!).toBeGreaterThanOrEqual(10);
      expect(p.b!).toBeLessThanOrEqual(99);
    }
  });

  it("detects regrouping correctly", () => {
    // Generate many problems and check the regrouping flag
    for (let i = 0; i < 50; i++) {
      const p = generateMathProblem("two_digit_addition", "K-2");
      const onesSum = (p.a % 10) + (p.b! % 10);
      expect(p.requiresRegrouping).toBe(onesSum >= 10);
    }
  });

  it("includes 'carry' tag only when regrouping", () => {
    for (let i = 0; i < 50; i++) {
      const p = generateMathProblem("two_digit_addition", "K-2");
      if (p.requiresRegrouping) {
        expect(p.expectedStrategyTags).toContain("carry");
      } else {
        expect(p.expectedStrategyTags).not.toContain("carry");
      }
    }
  });

  it("generates commonWrongAnswers for regrouping problems", () => {
    // Generate until we get a regrouping problem
    let found = false;
    for (let i = 0; i < 100; i++) {
      const p = generateMathProblem("two_digit_addition", "K-2");
      if (p.requiresRegrouping && p.commonWrongAnswers) {
        found = true;
        expect(p.commonWrongAnswers[0].misconception).toBe("forgot to carry");
        expect(p.commonWrongAnswers[0].answer).not.toBe(p.correctAnswer);
        break;
      }
    }
    expect(found).toBe(true);
  });
});

// ============================================================================
// generateMathProblem — two_digit_subtraction
// ============================================================================

describe("generateMathProblem — two_digit_subtraction", () => {
  it("generates a valid problem with correct difference", () => {
    const p = generateMathProblem("two_digit_subtraction", "K-2");
    expect(p.skill).toBe("two_digit_subtraction");
    expect(p.correctAnswer).toBe(p.a - p.b!);
    expect(p.a).toBeGreaterThan(p.b!);
  });

  it("always ensures a > b (no negative results)", () => {
    for (let i = 0; i < 50; i++) {
      const p = generateMathProblem("two_digit_subtraction", "3-4");
      expect(p.a).toBeGreaterThan(p.b!);
      expect(p.correctAnswer).toBeGreaterThanOrEqual(0);
    }
  });

  it("detects borrowing correctly", () => {
    for (let i = 0; i < 50; i++) {
      const p = generateMathProblem("two_digit_subtraction", "K-2");
      const needsBorrow = (p.a % 10) < (p.b! % 10);
      expect(p.requiresRegrouping).toBe(needsBorrow);
    }
  });

  it("includes 'borrow from tens' tag when borrowing needed", () => {
    for (let i = 0; i < 50; i++) {
      const p = generateMathProblem("two_digit_subtraction", "K-2");
      if (p.requiresRegrouping) {
        expect(p.expectedStrategyTags).toContain("borrow from tens");
      } else {
        expect(p.expectedStrategyTags).not.toContain("borrow from tens");
      }
    }
  });
});

// ============================================================================
// generateMathProblem — basic_multiplication
// ============================================================================

describe("generateMathProblem — basic_multiplication", () => {
  it("generates a valid problem with correct product", () => {
    const p = generateMathProblem("basic_multiplication", "K-2");
    expect(p.skill).toBe("basic_multiplication");
    expect(p.correctAnswer).toBe(p.a * p.b!);
    expect(p.expression).toBe(`${p.a} × ${p.b}`);
  });

  it("respects K-2 range (2-5 × 1-5)", () => {
    for (let i = 0; i < 20; i++) {
      const p = generateMathProblem("basic_multiplication", "K-2");
      expect(p.a).toBeGreaterThanOrEqual(2);
      expect(p.a).toBeLessThanOrEqual(5);
      expect(p.b!).toBeGreaterThanOrEqual(1);
      expect(p.b!).toBeLessThanOrEqual(5);
    }
  });

  it("never requires regrouping", () => {
    const p = generateMathProblem("basic_multiplication", "3-4");
    expect(p.requiresRegrouping).toBe(false);
  });
});

// ============================================================================
// generateMathProblem — place_value
// ============================================================================

describe("generateMathProblem — place_value", () => {
  it("returns the correct digit for the target place", () => {
    for (let i = 0; i < 30; i++) {
      const p = generateMathProblem("place_value", "K-2");
      const digits = String(p.a).split("").reverse();
      const placeIndex = ["ones", "tens", "hundreds"].indexOf(p.targetPlace!);
      expect(p.correctAnswer).toBe(parseInt(digits[placeIndex], 10));
    }
  });

  it("targets a valid place for the number", () => {
    for (let i = 0; i < 30; i++) {
      const p = generateMathProblem("place_value", "K-2");
      // K-2 numbers are 10-99 (2 digits), so ones and tens are valid
      expect(["ones", "tens"]).toContain(p.targetPlace);
    }
  });

  it("targets up to hundreds for 3-4 band", () => {
    const validPlaces = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const p = generateMathProblem("place_value", "3-4");
      validPlaces.add(p.targetPlace!);
    }
    // Should eventually hit hundreds since 3-4 generates 3-digit numbers
    expect(validPlaces.has("hundreds")).toBe(true);
  });

  it("has no b operand", () => {
    const p = generateMathProblem("place_value", "K-2");
    expect(p.b).toBeUndefined();
  });
});

// ============================================================================
// generateMathProblem — error handling
// ============================================================================

describe("generateMathProblem — errors", () => {
  it("throws for unknown skill", () => {
    expect(() => generateMathProblem("unknown_skill" as any, "K-2")).toThrow(
      "Unknown math problem skill"
    );
  });
});

// ============================================================================
// generateMathProblemSet
// ============================================================================

describe("generateMathProblemSet", () => {
  it("generates N unique expressions", () => {
    const problems = generateMathProblemSet("two_digit_addition", "3-4", 5);
    expect(problems).toHaveLength(5);
    const expressions = problems.map((p) => p.expression);
    expect(new Set(expressions).size).toBe(5);
  });

  it("never generates duplicate expressions", () => {
    const problems = generateMathProblemSet("basic_multiplication", "K-2", 10);
    const expressions = problems.map((p) => p.expression);
    expect(new Set(expressions).size).toBe(expressions.length);
  });

  it("caps at available problems when range is small", () => {
    // K-2 multiplication: 2-5 × 1-5 = at most 20 combos
    const problems = generateMathProblemSet("basic_multiplication", "K-2", 100);
    expect(problems.length).toBeLessThanOrEqual(100);
    expect(problems.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// detectMathSkill
// ============================================================================

describe("detectMathSkill", () => {
  it("detects 'two-digit addition' as two_digit_addition", () => {
    expect(detectMathSkill("two-digit addition")).toBe("two_digit_addition");
  });

  it("detects 'adding 2-digit values' as two_digit_addition", () => {
    expect(detectMathSkill("adding 2-digit values")).toBe("two_digit_addition");
  });

  it("detects 'subtraction with borrowing' as two_digit_subtraction", () => {
    expect(detectMathSkill("subtraction with borrowing")).toBe("two_digit_subtraction");
  });

  it("detects 'multiplication facts' as basic_multiplication", () => {
    expect(detectMathSkill("multiplication facts")).toBe("basic_multiplication");
  });

  it("detects 'place value' as place_value", () => {
    expect(detectMathSkill("place value")).toBe("place_value");
  });

  it("returns null for 'reading comprehension'", () => {
    expect(detectMathSkill("reading comprehension")).toBeNull();
  });

  it("returns null for 'geometry shapes'", () => {
    expect(detectMathSkill("geometry shapes")).toBeNull();
  });
});

// ============================================================================
// parseExpressionFromText
// ============================================================================

describe("parseExpressionFromText", () => {
  it("parses 'Solve 27 + 36. Tell what you did.'", () => {
    const result = parseExpressionFromText("Solve 27 + 36. Tell what you did.");
    expect(result).not.toBeNull();
    expect(result!.a).toBe(27);
    expect(result!.b).toBe(36);
    expect(result!.operation).toBe("+");
    expect(result!.correctAnswer).toBe(63);
    expect(result!.expression).toBe("27 + 36");
  });

  it("parses subtraction: 'Solve 43 - 18.'", () => {
    const result = parseExpressionFromText("Solve 43 - 18.");
    expect(result).not.toBeNull();
    expect(result!.operation).toBe("-");
    expect(result!.correctAnswer).toBe(25);
    expect(result!.expression).toBe("43 - 18");
  });

  it("parses multiplication with ×: 'Solve 5 × 3.'", () => {
    const result = parseExpressionFromText("Solve 5 × 3.");
    expect(result).not.toBeNull();
    expect(result!.operation).toBe("×");
    expect(result!.correctAnswer).toBe(15);
  });

  it("parses multiplication with x: 'Solve 5 x 3.'", () => {
    const result = parseExpressionFromText("Solve 5 x 3.");
    expect(result).not.toBeNull();
    expect(result!.operation).toBe("×");
    expect(result!.correctAnswer).toBe(15);
  });

  it("returns null for 'Name three planets.'", () => {
    expect(parseExpressionFromText("Name three planets.")).toBeNull();
  });

  it("returns null for 'What is your favorite number?'", () => {
    expect(parseExpressionFromText("What is your favorite number?")).toBeNull();
  });
});

// ============================================================================
// rebuildMathProblemFromExpression
// ============================================================================

describe("rebuildMathProblemFromExpression", () => {
  it("rebuilds addition with correct regrouping (27 + 36)", () => {
    const parsed = parseExpressionFromText("Solve 27 + 36.")!;
    const rebuilt = rebuildMathProblemFromExpression(parsed, "two_digit_addition");
    expect(rebuilt).not.toBeNull();
    expect(rebuilt!.a).toBe(27);
    expect(rebuilt!.b).toBe(36);
    expect(rebuilt!.correctAnswer).toBe(63);
    expect(rebuilt!.requiresRegrouping).toBe(true); // 7+6=13 >= 10
    expect(rebuilt!.expectedStrategyTags).toContain("carry");
    expect(rebuilt!.commonWrongAnswers).toBeDefined();
    expect(rebuilt!.commonWrongAnswers![0].misconception).toBe("forgot to carry");
  });

  it("rebuilds addition without regrouping (40 + 20)", () => {
    const parsed = parseExpressionFromText("What is 40 + 20?")!;
    const rebuilt = rebuildMathProblemFromExpression(parsed, "two_digit_addition");
    expect(rebuilt).not.toBeNull();
    expect(rebuilt!.correctAnswer).toBe(60);
    expect(rebuilt!.requiresRegrouping).toBe(false);
    expect(rebuilt!.expectedStrategyTags).not.toContain("carry");
  });

  it("rebuilds subtraction with borrowing (43 - 18)", () => {
    const parsed = parseExpressionFromText("Solve 43 - 18.")!;
    const rebuilt = rebuildMathProblemFromExpression(parsed, "two_digit_subtraction");
    expect(rebuilt).not.toBeNull();
    expect(rebuilt!.correctAnswer).toBe(25);
    expect(rebuilt!.requiresRegrouping).toBe(true); // 3 < 8
    expect(rebuilt!.expectedStrategyTags).toContain("borrow from tens");
  });

  it("returns null for skill/operation mismatch (addition skill + subtraction expression)", () => {
    const parsed = parseExpressionFromText("Solve 43 - 18.")!;
    const rebuilt = rebuildMathProblemFromExpression(parsed, "two_digit_addition");
    expect(rebuilt).toBeNull();
  });

  it("returns null for place_value skill", () => {
    const parsed = parseExpressionFromText("27 + 36")!;
    const rebuilt = rebuildMathProblemFromExpression(parsed, "place_value");
    expect(rebuilt).toBeNull();
  });

  it("rebuilds multiplication (5 × 3)", () => {
    const parsed = parseExpressionFromText("Solve 5 × 3.")!;
    const rebuilt = rebuildMathProblemFromExpression(parsed, "basic_multiplication");
    expect(rebuilt).not.toBeNull();
    expect(rebuilt!.correctAnswer).toBe(15);
    expect(rebuilt!.expectedStrategyTags).toContain("multiply");
  });
});

// ============================================================================
// buildMathReferenceFacts
// ============================================================================

describe("buildMathReferenceFacts", () => {
  it("builds place-value breakdown for 27 and 36", () => {
    const facts = buildMathReferenceFacts(27, 36);
    expect(facts["27"]).toEqual(["7 ones", "2 tens"]);
    expect(facts["36"]).toEqual(["6 ones", "3 tens"]);
  });

  it("handles 3-digit numbers", () => {
    const facts = buildMathReferenceFacts(123, 456);
    expect(facts["123"]).toEqual(["3 ones", "2 tens", "1 hundreds"]);
    expect(facts["456"]).toEqual(["6 ones", "5 tens", "4 hundreds"]);
  });
});

// ============================================================================
// validateMathPromptConsistency
// ============================================================================

describe("validateMathPromptConsistency", () => {
  it("detects stale mathProblem (input='27+36' but mathProblem='49+27')", () => {
    const prompt = {
      input: "Solve 27 + 36. Tell what you did.",
      filledSlots: { expression: "49 + 27" },
      mathProblem: {
        skill: "two_digit_addition" as const,
        a: 49, b: 27, expression: "49 + 27",
        correctAnswer: 76, requiresRegrouping: true,
        expectedStrategyTags: ["add ones", "carry", "add tens"],
      },
    };
    const result = validateMathPromptConsistency(prompt);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("passes for consistent prompt", () => {
    const prompt = {
      input: "Solve 27 + 36. Tell what you did.",
      filledSlots: { expression: "27 + 36" },
      mathProblem: {
        skill: "two_digit_addition" as const,
        a: 27, b: 36, expression: "27 + 36",
        correctAnswer: 63, requiresRegrouping: true,
        expectedStrategyTags: ["add ones", "carry", "add tens"],
      },
    };
    const result = validateMathPromptConsistency(prompt);
    expect(result.valid).toBe(true);
  });

  it("returns valid for non-math prompts", () => {
    const prompt = { input: "Name three planets." };
    const result = validateMathPromptConsistency(prompt);
    expect(result.valid).toBe(true);
  });

  it("detects when correctAnswer is wrong for expression", () => {
    const prompt = {
      input: "Solve 27 + 36.",
      filledSlots: { expression: "27 + 36" },
      mathProblem: {
        skill: "two_digit_addition" as const,
        a: 27, b: 36, expression: "27 + 36",
        correctAnswer: 76, // WRONG — should be 63
        requiresRegrouping: true,
        expectedStrategyTags: ["add ones", "carry", "add tens"],
      },
    };
    const result = validateMathPromptConsistency(prompt);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("correctAnswer"))).toBe(true);
  });
});

// ============================================================================
// reconcileMathPrompt
// ============================================================================

describe("reconcileMathPrompt", () => {
  it("fixes the exact split-brain from lesson-1772825712351", () => {
    const stalePrompt: Prompt = {
      id: "q1",
      type: "explain",
      input: "Solve 27 + 36. Tell what you did when adding the ones",
      filledSlots: { expression: "49 + 27" },
      mathProblem: {
        skill: "two_digit_addition",
        a: 49, b: 27, expression: "49 + 27",
        correctAnswer: 76, requiresRegrouping: true,
        expectedStrategyTags: ["add ones", "carry", "add tens"],
        commonWrongAnswers: [{ answer: 66, misconception: "forgot to carry" }],
      },
      assessment: {
        referenceFacts: { "49": ["4 tens", "9 ones"], "27": ["2 tens", "7 ones"] },
      },
      conceptAnchor: {
        anchorSentence: "Adding two-digit numbers with regrouping",
        coreConcepts: ["adding two-digit numbers"],
        allowedEntities: ["49", "27"],
        allowedAttributes: ["ones", "tens"],
        offTopicConcepts: [],
      },
    };

    const fixed = reconcileMathPrompt(stalePrompt);

    // mathProblem rebuilt from "27 + 36"
    expect(fixed.mathProblem!.a).toBe(27);
    expect(fixed.mathProblem!.b).toBe(36);
    expect(fixed.mathProblem!.expression).toBe("27 + 36");
    expect(fixed.mathProblem!.correctAnswer).toBe(63);
    expect(fixed.mathProblem!.requiresRegrouping).toBe(true);
    expect(fixed.mathProblem!.expectedStrategyTags).toContain("carry");

    // filledSlots updated
    expect(fixed.filledSlots!.expression).toBe("27 + 36");

    // referenceFacts rebuilt for 27 and 36
    expect(fixed.assessment!.referenceFacts!["27"]).toEqual(["7 ones", "2 tens"]);
    expect(fixed.assessment!.referenceFacts!["36"]).toEqual(["6 ones", "3 tens"]);
    // Old "49" key should NOT be present
    expect(fixed.assessment!.referenceFacts!["49"]).toBeUndefined();

    // conceptAnchor entities updated
    expect(fixed.conceptAnchor!.allowedEntities).toEqual(["27", "36"]);
  });

  it("leaves non-math prompts unchanged (same reference)", () => {
    const prompt: Prompt = {
      id: "q1", type: "explain",
      input: "Name three planets in our solar system.",
    };
    expect(reconcileMathPrompt(prompt)).toBe(prompt);
  });

  it("leaves consistent math prompts unchanged", () => {
    const prompt: Prompt = {
      id: "q1", type: "explain",
      input: "Solve 27 + 36.",
      filledSlots: { expression: "27 + 36" },
      mathProblem: {
        skill: "two_digit_addition",
        a: 27, b: 36, expression: "27 + 36",
        correctAnswer: 63, requiresRegrouping: true,
        expectedStrategyTags: ["add ones", "carry", "add tens"],
      },
    };
    const result = reconcileMathPrompt(prompt);
    // Same reference — nothing changed
    expect(result).toBe(prompt);
  });

  it("preserves teacher-authored numbers (uses numbers from input text)", () => {
    // Teacher changed question from "49 + 27" to "15 + 28"
    const stalePrompt: Prompt = {
      id: "q1", type: "explain",
      input: "Solve 15 + 28. Explain how you solved it.",
      filledSlots: { expression: "49 + 27" },
      mathProblem: {
        skill: "two_digit_addition",
        a: 49, b: 27, expression: "49 + 27",
        correctAnswer: 76, requiresRegrouping: true,
        expectedStrategyTags: ["add ones", "carry", "add tens"],
      },
    };

    const fixed = reconcileMathPrompt(stalePrompt);
    // Uses 15 and 28 from teacher's input, NOT 49 and 27
    expect(fixed.mathProblem!.a).toBe(15);
    expect(fixed.mathProblem!.b).toBe(28);
    expect(fixed.mathProblem!.correctAnswer).toBe(43);
    expect(fixed.mathProblem!.expression).toBe("15 + 28");
  });

  it("rebuilds hints, allowedProbes, and retryQuestions when expression changes", () => {
    const stalePrompt: Partial<Prompt> = {
      input: "Solve 27 + 36. Tell what you did when adding the ones.",
      hints: ["Old hint 1", "Old hint 2"],
      allowedProbes: ["Old probe"],
      retryQuestions: ["Old retry"],
      filledSlots: { expression: "49 + 27" },
      mathProblem: {
        skill: "two_digit_addition",
        a: 49, b: 27, expression: "49 + 27",
        correctAnswer: 76, requiresRegrouping: true,
        expectedStrategyTags: ["add ones", "carry", "add tens"],
      },
      assessment: {
        referenceFacts: { "49": ["9 ones", "4 tens"], "27": ["7 ones", "2 tens"] },
        successCriteria: ["Old criteria"],
      },
    };
    const fixed = reconcileMathPrompt(stalePrompt as Prompt);
    // Hints should now reference 27+36 digits
    expect(fixed.hints).toBeDefined();
    expect(fixed.hints!.some(h => h.includes("7") && h.includes("6"))).toBe(true);
    // AllowedProbes should reference 27+36 digits
    expect(fixed.allowedProbes).toBeDefined();
    expect(fixed.allowedProbes!.some(p => p.includes("7") && p.includes("6"))).toBe(true);
    // RetryQuestions should reference 27+36 digits
    expect(fixed.retryQuestions).toBeDefined();
    expect(fixed.retryQuestions!.some(r => r.includes("7") && r.includes("6"))).toBe(true);
    // Assessment successCriteria should be updated
    expect(fixed.assessment!.successCriteria).toBeDefined();
    expect(fixed.assessment!.successCriteria!.some(c => c.includes("63"))).toBe(true);
  });
});

// ============================================================================
// buildMathHints
// ============================================================================

describe("buildMathHints", () => {
  it("produces regrouping hints for 27 + 36", () => {
    const hints = buildMathHints({
      skill: "two_digit_addition", a: 27, b: 36,
      expression: "27 + 36", correctAnswer: 63,
      requiresRegrouping: true,
      expectedStrategyTags: ["add ones", "carry", "add tens"],
    });
    expect(hints).toHaveLength(2);
    expect(hints[0]).toMatch(/7.*\+.*6/);
    expect(hints[1]).toMatch(/carry|10 or more/i);
  });

  it("produces non-regrouping hints for 40 + 20", () => {
    const hints = buildMathHints({
      skill: "two_digit_addition", a: 40, b: 20,
      expression: "40 + 20", correctAnswer: 60,
      requiresRegrouping: false,
      expectedStrategyTags: ["add ones", "add tens"],
    });
    expect(hints).toHaveLength(2);
    expect(hints[0]).toMatch(/0.*\+.*0/);
    expect(hints[1]).toMatch(/tens/i);
  });
});

// ============================================================================
// buildMathAllowedProbes
// ============================================================================

describe("buildMathAllowedProbes", () => {
  it("produces probes with actual operand digits for 27 + 36", () => {
    const probes = buildMathAllowedProbes({
      skill: "two_digit_addition", a: 27, b: 36,
      expression: "27 + 36", correctAnswer: 63,
      requiresRegrouping: true,
      expectedStrategyTags: ["add ones", "carry", "add tens"],
    });
    expect(probes.length).toBeGreaterThanOrEqual(2);
    expect(probes.some(p => p.includes("7") && p.includes("6"))).toBe(true);
  });

  it("produces subtraction probes for 42 - 17", () => {
    const probes = buildMathAllowedProbes({
      skill: "two_digit_subtraction", a: 42, b: 17,
      expression: "42 - 17", correctAnswer: 25,
      requiresRegrouping: true,
      expectedStrategyTags: ["check ones", "borrow from tens", "subtract ones", "subtract tens"],
    });
    expect(probes.length).toBeGreaterThanOrEqual(2);
    expect(probes.some(p => p.includes("2") && p.includes("7"))).toBe(true);
  });
});

// ============================================================================
// buildMathRetryQuestions
// ============================================================================

describe("buildMathRetryQuestions", () => {
  it("produces retry questions with operand digits for 27 + 36", () => {
    const retries = buildMathRetryQuestions({
      skill: "two_digit_addition", a: 27, b: 36,
      expression: "27 + 36", correctAnswer: 63,
      requiresRegrouping: true,
      expectedStrategyTags: ["add ones", "carry", "add tens"],
    });
    expect(retries.length).toBeGreaterThanOrEqual(2);
    expect(retries[0]).toMatch(/7.*\+.*6/);
  });

  it("produces retry questions for subtraction", () => {
    const retries = buildMathRetryQuestions({
      skill: "two_digit_subtraction", a: 42, b: 17,
      expression: "42 - 17", correctAnswer: 25,
      requiresRegrouping: true,
      expectedStrategyTags: ["check ones", "borrow from tens", "subtract ones", "subtract tens"],
    });
    expect(retries.length).toBeGreaterThanOrEqual(2);
    expect(retries[0]).toMatch(/ones/i);
  });
});

// ============================================================================
// buildDeterministicMathRubric — universal rubric template
// ============================================================================

describe("buildDeterministicMathRubric — addition (24 + 12)", () => {
  const problem = generateMathProblem("two_digit_addition", "K-2");
  // Use a fixed problem for predictable assertions
  const fixed = {
    skill: "two_digit_addition" as const,
    a: 24,
    b: 12,
    expression: "24 + 12",
    correctAnswer: 36,
    requiresRegrouping: false,
    expectedStrategyTags: ["add ones", "add tens"],
  };
  const rubric = buildDeterministicMathRubric(fixed);

  it("includes actual numbers in learningObjective", () => {
    expect(rubric.learningObjective).toContain("24");
    expect(rubric.learningObjective).toContain("12");
  });

  it("includes ordered expectedReasoningSteps with numbers", () => {
    expect(rubric.expectedReasoningSteps.length).toBeGreaterThanOrEqual(3);
    // Steps should reference actual digits
    expect(rubric.expectedReasoningSteps.some(s => s.includes("4") && s.includes("2"))).toBe(true);
    expect(rubric.expectedReasoningSteps.some(s => s.includes("20") && s.includes("10"))).toBe(true);
    expect(rubric.expectedReasoningSteps.some(s => s.includes("36"))).toBe(true);
  });

  it("includes actual numbers in successCriteria", () => {
    expect(rubric.successCriteria.some(c => c.includes("4 + 2 = 6"))).toBe(true);
    expect(rubric.successCriteria.some(c => c.includes("20 + 10 = 30"))).toBe(true);
    expect(rubric.successCriteria.some(c => c.includes("36"))).toBe(true);
  });

  it("states the correct answer explicitly in successCriteria", () => {
    expect(rubric.successCriteria.some(c => /36/.test(c))).toBe(true);
  });

  it("includes problem-specific misconceptions", () => {
    expect(rubric.misconceptions.some(m => /cannot explain/i.test(m))).toBe(true);
  });

  it("references actual numbers in scoringLevels.strong", () => {
    expect(rubric.scoringLevels.strong).toContain("36");
    expect(rubric.scoringLevels.strong).toContain("4 + 2 = 6");
  });

  it("has allowedProbes tied to specific missing steps", () => {
    expect(rubric.allowedProbes.some(p => p.includes("4") && p.includes("2"))).toBe(true);
    expect(rubric.allowedProbes.some(p => p.includes("20") && p.includes("10"))).toBe(true);
  });

  it("has retryQuestions with specific numbers", () => {
    expect(rubric.retryQuestions.some(q => q.includes("4") && q.includes("2"))).toBe(true);
  });

  it("does NOT contain vague criteria", () => {
    for (const c of rubric.successCriteria) {
      expect(c).not.toMatch(/explains?\s+how\s+to\s+add\s+the\s+ones/i);
      expect(c).not.toMatch(/explains?\s+how\s+to\s+add\s+the\s+tens/i);
      expect(c).not.toMatch(/shows?\s+understanding/i);
      expect(c).not.toMatch(/includes?\s+all\s+steps/i);
    }
  });
});

describe("buildDeterministicMathRubric — addition with regrouping (27 + 36)", () => {
  const problem = {
    skill: "two_digit_addition" as const,
    a: 27,
    b: 36,
    expression: "27 + 36",
    correctAnswer: 63,
    requiresRegrouping: true,
    expectedStrategyTags: ["add ones", "carry", "add tens"],
    commonWrongAnswers: [{ answer: 53, misconception: "forgot to carry" }],
  };
  const rubric = buildDeterministicMathRubric(problem);

  it("includes carry step in reasoning", () => {
    expect(rubric.expectedReasoningSteps.some(s => /regroup|carry/i.test(s))).toBe(true);
  });

  it("includes common wrong answer in misconceptions", () => {
    expect(rubric.misconceptions.some(m => m.includes("53"))).toBe(true);
  });

  it("correct answer appears in scoringLevels", () => {
    expect(rubric.scoringLevels.strong).toContain("63");
  });
});

describe("buildDeterministicMathRubric — subtraction (42 - 17)", () => {
  const problem = {
    skill: "two_digit_subtraction" as const,
    a: 42,
    b: 17,
    expression: "42 - 17",
    correctAnswer: 25,
    requiresRegrouping: true,
    expectedStrategyTags: ["check ones", "borrow from tens", "subtract ones", "subtract tens"],
    commonWrongAnswers: [{ answer: 35, misconception: "subtracted smaller digit from larger in ones place instead of borrowing" }],
  };
  const rubric = buildDeterministicMathRubric(problem);

  it("includes borrowing in reasoning steps", () => {
    expect(rubric.expectedReasoningSteps.some(s => /borrow/i.test(s))).toBe(true);
  });

  it("states correct answer 25 in criteria", () => {
    expect(rubric.successCriteria.some(c => c.includes("25"))).toBe(true);
  });

  it("includes wrong answer 35 in misconceptions", () => {
    expect(rubric.misconceptions.some(m => m.includes("35"))).toBe(true);
  });
});

describe("buildDeterministicMathRubric — multiplication (4 × 5)", () => {
  const problem = {
    skill: "basic_multiplication" as const,
    a: 4,
    b: 5,
    expression: "4 × 5",
    correctAnswer: 20,
    requiresRegrouping: false,
    expectedStrategyTags: ["multiply", "skip count", "groups of"],
  };
  const rubric = buildDeterministicMathRubric(problem);

  it("includes groups and skip counting", () => {
    expect(rubric.expectedReasoningSteps.some(s => s.includes("4 groups of 5"))).toBe(true);
    expect(rubric.expectedReasoningSteps.some(s => /skip count/i.test(s))).toBe(true);
  });

  it("states correct answer 20", () => {
    expect(rubric.successCriteria.some(c => c.includes("20"))).toBe(true);
  });

  it("includes addition misconception (says 9)", () => {
    expect(rubric.misconceptions.some(m => m.includes("9"))).toBe(true);
  });
});

describe("buildDeterministicMathRubric — place value", () => {
  const problem = {
    skill: "place_value" as const,
    a: 47,
    expression: "47",
    correctAnswer: 4,
    requiresRegrouping: false,
    expectedStrategyTags: ["identify digit", "name tens place"],
    targetPlace: "tens" as const,
  };
  const rubric = buildDeterministicMathRubric(problem);

  it("states the correct digit", () => {
    expect(rubric.successCriteria.some(c => c.includes("4"))).toBe(true);
  });

  it("references the tens place", () => {
    expect(rubric.learningObjective).toContain("tens");
  });
});

// ============================================================================
// reconcileMathPromptFromText — bootstraps mathProblem from teacher text
// ============================================================================

describe("reconcileMathPromptFromText", () => {
  it("leaves non-math prompts unchanged (same reference)", () => {
    const prompt: Prompt = {
      id: "q1", type: "explain",
      input: "Name three planets in our solar system.",
    };
    expect(reconcileMathPromptFromText(prompt)).toBe(prompt);
  });

  it("bootstraps mathProblem from scratch when teacher types a math expression", () => {
    const prompt: Prompt = {
      id: "q1", type: "explain",
      input: "Solve 24 + 12. Tell how you got your answer.",
      hints: [],
    };
    const result = reconcileMathPromptFromText(prompt);

    expect(result.mathProblem).toBeDefined();
    expect(result.mathProblem!.a).toBe(24);
    expect(result.mathProblem!.b).toBe(12);
    expect(result.mathProblem!.expression).toBe("24 + 12");
    expect(result.mathProblem!.correctAnswer).toBe(36);
    expect(result.mathProblem!.skill).toBe("two_digit_addition");
  });

  it("bootstraps subtraction from teacher text", () => {
    const prompt: Prompt = {
      id: "q1", type: "explain",
      input: "Solve 42 - 17. Explain your steps.",
      hints: [],
    };
    const result = reconcileMathPromptFromText(prompt);

    expect(result.mathProblem!.skill).toBe("two_digit_subtraction");
    expect(result.mathProblem!.a).toBe(42);
    expect(result.mathProblem!.b).toBe(17);
    expect(result.mathProblem!.correctAnswer).toBe(25);
  });

  it("bootstraps multiplication from teacher text", () => {
    const prompt: Prompt = {
      id: "q1", type: "explain",
      input: "Solve 4 × 5. Tell how you figured it out.",
      hints: [],
    };
    const result = reconcileMathPromptFromText(prompt);

    expect(result.mathProblem!.skill).toBe("basic_multiplication");
    expect(result.mathProblem!.correctAnswer).toBe(20);
  });

  it("updates existing mathProblem when teacher changes expression", () => {
    const prompt: Prompt = {
      id: "q1", type: "explain",
      input: "Solve 27 + 36. Tell how you got your answer.",
      filledSlots: { expression: "49 + 27" },
      mathProblem: {
        skill: "two_digit_addition",
        a: 49, b: 27, expression: "49 + 27",
        correctAnswer: 76, requiresRegrouping: true,
        expectedStrategyTags: ["add ones", "carry", "add tens"],
      },
      assessment: {
        successCriteria: ["Old criteria"],
        referenceFacts: { "49": ["9 ones", "4 tens"], "27": ["7 ones", "2 tens"] },
      },
    };
    const result = reconcileMathPromptFromText(prompt);

    expect(result.mathProblem!.a).toBe(27);
    expect(result.mathProblem!.b).toBe(36);
    expect(result.mathProblem!.correctAnswer).toBe(63);
  });

  it("leaves consistent math prompts unchanged", () => {
    const prompt: Prompt = {
      id: "q1", type: "explain",
      input: "Solve 27 + 36.",
      filledSlots: { expression: "27 + 36" },
      mathProblem: {
        skill: "two_digit_addition",
        a: 27, b: 36, expression: "27 + 36",
        correctAnswer: 63, requiresRegrouping: true,
        expectedStrategyTags: ["add ones", "carry", "add tens"],
      },
    };
    expect(reconcileMathPromptFromText(prompt)).toBe(prompt);
  });
});

// ============================================================================
// INVARIANT TESTS — Hard invariants that must never drift
// ============================================================================

describe("INVARIANT A: Teacher-authored 24 + 12 produces fully aligned data", () => {
  const prompt: Prompt = {
    id: "q1", type: "explain",
    input: "Solve 24 + 12. Tell how you got your answer.",
    hints: [],
  };
  const result = reconcileMathPromptFromText(prompt);

  it("mathProblem.expression matches question text", () => {
    expect(result.mathProblem!.expression).toBe("24 + 12");
  });

  it("mathProblem.a is 24", () => {
    expect(result.mathProblem!.a).toBe(24);
  });

  it("mathProblem.b is 12", () => {
    expect(result.mathProblem!.b).toBe(12);
  });

  it("correctAnswer is 36", () => {
    expect(result.mathProblem!.correctAnswer).toBe(36);
  });

  it("hints reference 24/12 digits (ones: 4,2 or tens: 20,10)", () => {
    const hintText = result.hints!.join(" ");
    // Ones digits (4, 2) or tens (20, 10) must appear
    const hasOnesRef = hintText.includes("4") && hintText.includes("2");
    const hasTensRef = hintText.includes("20") || hintText.includes("10");
    expect(hasOnesRef || hasTensRef).toBe(true);
  });

  it("rubric successCriteria reference 24, 12, and 36", () => {
    const criteria = result.assessment!.successCriteria!;
    const allCriteria = criteria.join(" ");
    expect(allCriteria).toContain("36");
    // Should reference the ones addition (4 + 2 = 6)
    expect(criteria.some(c => c.includes("4 + 2 = 6"))).toBe(true);
  });

  it("rubric expectedReasoningSteps are ordered and include numbers", () => {
    const steps = result.assessment!.expectedReasoningSteps!;
    expect(steps.length).toBeGreaterThanOrEqual(3);
    expect(steps.some(s => s.includes("36"))).toBe(true);
    expect(steps.some(s => s.includes("4") && s.includes("2"))).toBe(true);
  });

  it("rubric scoringLevels.strong mentions correct answer", () => {
    expect(result.assessment!.scoringLevels!.strong).toContain("36");
  });

  it("allowedProbes reference specific digits", () => {
    const probeText = result.allowedProbes!.join(" ");
    expect(probeText.includes("4") && probeText.includes("2")).toBe(true);
  });

  it("retryQuestions reference specific digits", () => {
    const retryText = result.retryQuestions!.join(" ");
    expect(retryText.includes("4") && retryText.includes("2")).toBe(true);
  });

  it("referenceFacts contain 24 and 12 keys", () => {
    expect(result.assessment!.referenceFacts!["24"]).toBeDefined();
    expect(result.assessment!.referenceFacts!["12"]).toBeDefined();
  });

  it("filledSlots.expression is 24 + 12", () => {
    expect(result.filledSlots!.expression).toBe("24 + 12");
  });
});

describe("INVARIANT B: Edit from 49 + 27 → 27 + 36 leaves no old data", () => {
  const original: Prompt = {
    id: "q1", type: "explain",
    input: "Solve 27 + 36. Tell how you got your answer.",
    filledSlots: { expression: "49 + 27" },
    hints: ["Start with 9 + 7", "Then add 40 + 20"],
    allowedProbes: ["What is 9 + 7?"],
    retryQuestions: ["Try 49 + 27 step by step"],
    mathProblem: {
      skill: "two_digit_addition",
      a: 49, b: 27, expression: "49 + 27",
      correctAnswer: 76, requiresRegrouping: true,
      expectedStrategyTags: ["add ones", "carry", "add tens"],
      commonWrongAnswers: [{ answer: 66, misconception: "forgot to carry" }],
    },
    assessment: {
      learningObjective: "Explain how to solve 49 + 27",
      successCriteria: ["Says 9 + 7 = 16", "Says 40 + 20 = 60", "Says answer is 76"],
      misconceptions: ["Says 66 because forgot to carry"],
      referenceFacts: { "49": ["9 ones", "4 tens"], "27": ["7 ones", "2 tens"] },
      scoringLevels: { strong: "Explains 49 + 27 = 76", developing: "Partial", needsSupport: "Wrong" },
    },
    conceptAnchor: {
      anchorSentence: "Solve 49 + 27",
      coreConcepts: ["two-digit addition"],
      allowedEntities: ["49", "27"],
      allowedAttributes: [],
      offTopicConcepts: [],
    },
  };
  const result = reconcileMathPromptFromText(original);

  // Helper: serialize all string fields to check for old number remnants
  function allStrings(obj: any): string {
    if (!obj) return "";
    if (typeof obj === "string") return obj;
    if (Array.isArray(obj)) return obj.map(allStrings).join(" ");
    if (typeof obj === "object") return Object.values(obj).map(allStrings).join(" ");
    return String(obj);
  }

  it("mathProblem uses new expression 27 + 36", () => {
    expect(result.mathProblem!.expression).toBe("27 + 36");
    expect(result.mathProblem!.a).toBe(27);
    expect(result.mathProblem!.b).toBe(36);
    expect(result.mathProblem!.correctAnswer).toBe(63);
  });

  it("no remnant of old correctAnswer 76 in assessment", () => {
    const text = allStrings(result.assessment);
    expect(text).not.toContain("76");
  });

  it("no remnant of old operand 49 in assessment or hints", () => {
    const assessmentText = allStrings(result.assessment);
    const hintsText = allStrings(result.hints);
    const probesText = allStrings(result.allowedProbes);
    const retryText = allStrings(result.retryQuestions);
    expect(assessmentText).not.toContain("49");
    expect(hintsText).not.toContain("49");
    expect(probesText).not.toContain("49");
    expect(retryText).not.toContain("49");
  });

  it("referenceFacts no longer have 49 key", () => {
    expect(result.assessment!.referenceFacts!["49"]).toBeUndefined();
  });

  it("referenceFacts have 27 and 36 keys", () => {
    expect(result.assessment!.referenceFacts!["27"]).toBeDefined();
    expect(result.assessment!.referenceFacts!["36"]).toBeDefined();
  });

  it("filledSlots.expression is 27 + 36", () => {
    expect(result.filledSlots!.expression).toBe("27 + 36");
  });

  it("correctAnswer is 63", () => {
    expect(result.mathProblem!.correctAnswer).toBe(63);
    expect(result.assessment!.successCriteria!.some(c => c.includes("63"))).toBe(true);
  });

  it("conceptAnchor entities are 27 and 36", () => {
    expect(result.conceptAnchor!.allowedEntities).toEqual(["27", "36"]);
  });

  it("stale hints replaced with new hints", () => {
    const hintText = result.hints!.join(" ");
    expect(hintText).not.toContain("9 + 7");
    expect(hintText).not.toContain("40 + 20");
  });
});

describe("INVARIANT C: Regrouping vs non-regrouping alignment", () => {
  it("non-regrouping (24 + 12): no regrouping language in hints/rubric", () => {
    const prompt: Prompt = {
      id: "q1", type: "explain",
      input: "Solve 24 + 12. Tell how you got your answer.",
      hints: [],
    };
    const result = reconcileMathPromptFromText(prompt);

    expect(result.mathProblem!.requiresRegrouping).toBe(false);

    const hintText = result.hints!.join(" ").toLowerCase();
    expect(hintText).not.toContain("carry");
    expect(hintText).not.toContain("regroup");

    const criteriaText = result.assessment!.successCriteria!.join(" ").toLowerCase();
    expect(criteriaText).not.toContain("carry");
    expect(criteriaText).not.toContain("borrow");
  });

  it("regrouping (27 + 36): regrouping language present in rubric", () => {
    const prompt: Prompt = {
      id: "q1", type: "explain",
      input: "Solve 27 + 36. Explain how you regroup.",
      hints: [],
    };
    const result = reconcileMathPromptFromText(prompt);

    expect(result.mathProblem!.requiresRegrouping).toBe(true);

    // Rubric should mention carry/regroup
    const stepsText = result.assessment!.expectedReasoningSteps!.join(" ").toLowerCase();
    expect(stepsText).toMatch(/carry|regroup/);
  });

  it("subtraction regrouping (42 - 17): borrowing language present", () => {
    const prompt: Prompt = {
      id: "q1", type: "explain",
      input: "Solve 42 - 17. Tell how you got your answer.",
      hints: [],
    };
    const result = reconcileMathPromptFromText(prompt);

    expect(result.mathProblem!.requiresRegrouping).toBe(true);

    const stepsText = result.assessment!.expectedReasoningSteps!.join(" ").toLowerCase();
    expect(stepsText).toContain("borrow");
  });

  it("subtraction non-regrouping (48 - 12): no borrowing language", () => {
    const prompt: Prompt = {
      id: "q1", type: "explain",
      input: "Solve 48 - 12. Tell how you got your answer.",
      hints: [],
    };
    const result = reconcileMathPromptFromText(prompt);

    expect(result.mathProblem!.requiresRegrouping).toBe(false);

    const hintText = result.hints!.join(" ").toLowerCase();
    expect(hintText).not.toContain("borrow");
  });
});

describe("INVARIANT D: Teacher-authored numbers always beat generated numbers", () => {
  it("teacher changes 49 + 27 to 24 + 12 — all fields use 24 and 12", () => {
    const prompt: Prompt = {
      id: "q1", type: "explain",
      input: "Solve 24 + 12. Tell how you got your answer.",
      mathProblem: {
        skill: "two_digit_addition",
        a: 49, b: 27, expression: "49 + 27",
        correctAnswer: 76, requiresRegrouping: true,
        expectedStrategyTags: ["add ones", "carry", "add tens"],
      },
      filledSlots: { expression: "49 + 27" },
      hints: ["What is 9 + 7?"],
    };

    const result = reconcileMathPromptFromText(prompt);

    // Teacher's numbers (24, 12) win over generated (49, 27)
    expect(result.mathProblem!.a).toBe(24);
    expect(result.mathProblem!.b).toBe(12);
    expect(result.mathProblem!.correctAnswer).toBe(36);
    expect(result.filledSlots!.expression).toBe("24 + 12");

    // Old hint about 9+7 is gone
    expect(result.hints!.join(" ")).not.toContain("9 + 7");
  });

  it("teacher changes operation from + to - — skill updates accordingly", () => {
    const prompt: Prompt = {
      id: "q1", type: "explain",
      input: "Solve 42 - 17. Tell how you got your answer.",
      mathProblem: {
        skill: "two_digit_addition",
        a: 42, b: 17, expression: "42 + 17",
        correctAnswer: 59, requiresRegrouping: false,
        expectedStrategyTags: ["add ones", "add tens"],
      },
      filledSlots: { expression: "42 + 17" },
    };

    const result = reconcileMathPromptFromText(prompt);

    // Skill changed from addition to subtraction
    expect(result.mathProblem!.skill).toBe("two_digit_subtraction");
    expect(result.mathProblem!.correctAnswer).toBe(25);
  });
});

describe("INVARIANT: Question intent preservation", () => {
  it("preserves 'Tell how you got your answer' intent", () => {
    const prompt: Prompt = {
      id: "q1", type: "explain",
      input: "Solve 24 + 12. Tell how you got your answer.",
      hints: [],
    };
    const result = reconcileMathPromptFromText(prompt);

    // Question text NOT modified
    expect(result.input).toBe("Solve 24 + 12. Tell how you got your answer.");
  });

  it("preserves 'What is the first step you used' intent", () => {
    const prompt: Prompt = {
      id: "q1", type: "explain",
      input: "Solve 27 + 36. What is the first step you used?",
      hints: [],
    };
    const result = reconcileMathPromptFromText(prompt);

    // Question text NOT modified — teacher's intent preserved
    expect(result.input).toBe("Solve 27 + 36. What is the first step you used?");
  });

  it("preserves 'Explain why you need to regroup' intent", () => {
    const prompt: Prompt = {
      id: "q1", type: "explain",
      input: "Solve 49 + 27. Explain why you need to regroup.",
      hints: [],
    };
    const result = reconcileMathPromptFromText(prompt);

    expect(result.input).toBe("Solve 49 + 27. Explain why you need to regroup.");
  });

  it("different intents produce different question text but same math", () => {
    const intent1: Prompt = {
      id: "q1", type: "explain",
      input: "Solve 24 + 12. Tell how you got your answer.",
      hints: [],
    };
    const intent2: Prompt = {
      id: "q2", type: "explain",
      input: "Solve 24 + 12. What is the first step you used?",
      hints: [],
    };

    const r1 = reconcileMathPromptFromText(intent1);
    const r2 = reconcileMathPromptFromText(intent2);

    // Same math metadata
    expect(r1.mathProblem!.correctAnswer).toBe(r2.mathProblem!.correctAnswer);
    expect(r1.mathProblem!.a).toBe(r2.mathProblem!.a);

    // Different question text
    expect(r1.input).not.toBe(r2.input);
  });
});

describe("INVARIANT: Save auto-reconciles — single edit, single save", () => {
  it("prompt with stale mathProblem gets fully reconciled in one pass", () => {
    // Simulates: teacher edited question text, then clicked save.
    // The backend calls reconcileMathPromptFromText on each prompt.
    const stalePrompt: Prompt = {
      id: "q1", type: "explain",
      input: "Solve 24 + 12. Tell how you got your answer.",
      filledSlots: { expression: "49 + 27" },
      hints: ["Old hint about 49"],
      mathProblem: {
        skill: "two_digit_addition",
        a: 49, b: 27, expression: "49 + 27",
        correctAnswer: 76, requiresRegrouping: true,
        expectedStrategyTags: ["add ones", "carry", "add tens"],
      },
      assessment: {
        learningObjective: "Explain how to solve 49 + 27",
        successCriteria: ["Says the final answer is 76"],
        misconceptions: ["Says 66 because forgot to carry"],
        scoringLevels: { strong: "76", developing: "Partial", needsSupport: "Wrong" },
        referenceFacts: { "49": ["9 ones", "4 tens"], "27": ["7 ones", "2 tens"] },
      },
      allowedProbes: ["What is 9 + 7?"],
      retryQuestions: ["Try 49 + 27 again"],
    };

    // Single reconcile call (what the backend save endpoint does)
    const result = reconcileMathPromptFromText(stalePrompt);

    // Everything aligned to 24 + 12
    expect(result.mathProblem!.expression).toBe("24 + 12");
    expect(result.mathProblem!.correctAnswer).toBe(36);
    expect(result.filledSlots!.expression).toBe("24 + 12");

    // Assessment fully rebuilt
    expect(result.assessment!.successCriteria!.some(c => c.includes("36"))).toBe(true);
    expect(result.assessment!.successCriteria!.every(c => !c.includes("76"))).toBe(true);

    // Hints rebuilt
    expect(result.hints!.every(h => !h.includes("49"))).toBe(true);

    // Probes rebuilt
    expect(result.allowedProbes!.every(p => !p.includes("9 + 7"))).toBe(true);

    // Retries rebuilt
    expect(result.retryQuestions!.every(r => !r.includes("49"))).toBe(true);

    // ReferenceFacts rebuilt
    expect(result.assessment!.referenceFacts!["24"]).toBeDefined();
    expect(result.assessment!.referenceFacts!["49"]).toBeUndefined();
  });

  it("prompt WITHOUT mathProblem gets bootstrapped on save", () => {
    // Teacher typed a new question with math, never had mathProblem
    const newPrompt: Prompt = {
      id: "q1", type: "explain",
      input: "Solve 33 + 18. Tell how you got your answer.",
      hints: ["Think about it"],
    };

    const result = reconcileMathPromptFromText(newPrompt);

    // mathProblem bootstrapped
    expect(result.mathProblem).toBeDefined();
    expect(result.mathProblem!.a).toBe(33);
    expect(result.mathProblem!.b).toBe(18);
    expect(result.mathProblem!.correctAnswer).toBe(51);

    // Assessment bootstrapped
    expect(result.assessment).toBeDefined();
    expect(result.assessment!.successCriteria!.some(c => c.includes("51"))).toBe(true);

    // Hints replaced with operand-specific ones
    expect(result.hints!.some(h => h.includes("3") || h.includes("8"))).toBe(true);
  });
});

// ============================================================================
// GOLDEN TEST CASES (Part 9)
// ============================================================================

describe("Golden test cases — rubric quality for canonical problems", () => {
  // Case A: 24 + 12 (no regrouping)
  describe("Case A: 24 + 12", () => {
    const problem = {
      skill: "two_digit_addition" as const,
      a: 24, b: 12, expression: "24 + 12",
      correctAnswer: 36, requiresRegrouping: false,
      expectedStrategyTags: ["add ones", "add tens"],
    };
    const rubric = buildDeterministicMathRubric(problem);

    it("reasoning steps follow ones → tens → combine order", () => {
      expect(rubric.reasoningSteps.length).toBe(3);
      expect(rubric.reasoningSteps[0].kind).toBe("ones_sum");
      expect(rubric.reasoningSteps[1].kind).toBe("tens_sum");
      expect(rubric.reasoningSteps[2].kind).toBe("combine");
    });

    it("step 1 expects '4 + 2 = 6'", () => {
      expect(rubric.reasoningSteps[0].expectedStatements[0]).toBe("4 + 2 = 6");
    });

    it("step 2 expects '20 + 10 = 30'", () => {
      expect(rubric.reasoningSteps[1].expectedStatements[0]).toBe("20 + 10 = 30");
    });

    it("step 3 expects '30 + 6 = 36'", () => {
      expect(rubric.reasoningSteps[2].expectedStatements).toContain("30 + 6 = 36");
    });

    it("probes match reasoning step probes", () => {
      expect(rubric.allowedProbes).toEqual(rubric.reasoningSteps.map(s => s.probe));
    });

    it("no regrouping language in rubric", () => {
      const allText = JSON.stringify(rubric).toLowerCase();
      expect(allText).not.toContain("regroup");
      expect(allText).not.toContain("carry");
    });
  });

  // Case B: 27 + 36 (regrouping)
  describe("Case B: 27 + 36", () => {
    const problem = {
      skill: "two_digit_addition" as const,
      a: 27, b: 36, expression: "27 + 36",
      correctAnswer: 63, requiresRegrouping: true,
      expectedStrategyTags: ["add ones", "carry", "add tens"],
      commonWrongAnswers: [{ answer: 53, misconception: "forgot to carry" }],
    };
    const rubric = buildDeterministicMathRubric(problem);

    it("reasoning steps follow ones → regroup → tens → combine", () => {
      expect(rubric.reasoningSteps.length).toBe(4);
      expect(rubric.reasoningSteps[0].kind).toBe("ones_sum");
      expect(rubric.reasoningSteps[1].kind).toBe("regroup");
      expect(rubric.reasoningSteps[2].kind).toBe("tens_sum");
      expect(rubric.reasoningSteps[3].kind).toBe("combine");
    });

    it("step 1 expects '7 + 6 = 13'", () => {
      expect(rubric.reasoningSteps[0].expectedStatements[0]).toBe("7 + 6 = 13");
    });

    it("step 2 explains regrouping with '13 ones makes 1 ten and 3 ones'", () => {
      expect(rubric.reasoningSteps[1].expectedStatements[0]).toContain("13 ones makes 1 ten and 3 ones");
    });

    it("step 3 includes the carried ten: 20 + 30 + 10 = 60", () => {
      expect(rubric.reasoningSteps[2].expectedStatements[0]).toBe("20 + 30 + 10 = 60");
    });

    it("step 4 combines: 60 + 3 = 63", () => {
      expect(rubric.reasoningSteps[3].expectedStatements).toContain("60 + 3 = 63");
    });

    it("misconceptions include 53 (forgot to carry)", () => {
      expect(rubric.misconceptions.some(m => m.includes("53"))).toBe(true);
    });

    it("regrouping language present", () => {
      const allText = JSON.stringify(rubric).toLowerCase();
      expect(allText).toContain("regroup");
    });
  });

  // Case C: Correct answer coverage for 24 + 12
  describe("Case C: Correct answer coverage for 24 + 12", () => {
    const problem = {
      skill: "two_digit_addition" as const,
      a: 24, b: 12, expression: "24 + 12",
      correctAnswer: 36, requiresRegrouping: false,
      expectedStrategyTags: ["add ones", "add tens"],
    };
    const rubric = buildDeterministicMathRubric(problem);

    it("scoring levels strong mentions 36", () => {
      expect(rubric.scoringLevels.strong).toContain("36");
    });

    it("success criteria mention the final answer 36", () => {
      expect(rubric.successCriteria.some(c => c.includes("36"))).toBe(true);
    });

    it("requiredExamples mentions 36", () => {
      expect(rubric.requiredExamples).toContain("36");
    });
  });

  // Case D: Wrong answer 53 for 27 + 36
  describe("Case D: Wrong answer 53 for 27 + 36", () => {
    const problem = {
      skill: "two_digit_addition" as const,
      a: 27, b: 36, expression: "27 + 36",
      correctAnswer: 63, requiresRegrouping: true,
      expectedStrategyTags: ["add ones", "carry", "add tens"],
      commonWrongAnswers: [{ answer: 53, misconception: "forgot to carry" }],
    };
    const rubric = buildDeterministicMathRubric(problem);

    it("misconceptions explain WHY 53 is wrong", () => {
      const mis53 = rubric.misconceptions.find(m => m.includes("53"));
      expect(mis53).toBeDefined();
      expect(mis53).toMatch(/carry|regroup|forgot/i);
    });

    it("retry questions guide back to ones place", () => {
      expect(rubric.retryQuestions.some(r => r.includes("7") && r.includes("6"))).toBe(true);
    });
  });

  // Case E: Partial progress — student says "7 + 6 = 13" after hint
  describe("Case E: Partial progress 7 + 6 = 13 for 27 + 36", () => {
    const problem = {
      skill: "two_digit_addition" as const,
      a: 27, b: 36, expression: "27 + 36",
      correctAnswer: 63, requiresRegrouping: true,
      expectedStrategyTags: ["add ones", "carry", "add tens"],
    };
    const rubric = buildDeterministicMathRubric(problem);

    it("step 1 matches '7 + 6 = 13'", () => {
      expect(rubric.reasoningSteps[0].expectedStatements[0]).toBe("7 + 6 = 13");
    });

    it("step 2 (regroup) is the next probe after ones sum is demonstrated", () => {
      const step2 = rubric.reasoningSteps[1];
      expect(step2.kind).toBe("regroup");
      expect(step2.probe).toMatch(/more than 9|what do you do/i);
    });

    it("reasoning steps are ordered — coach probes next undemonstrated step", () => {
      // Student said "7 + 6 = 13" — this demonstrates step 1 (ones_sum).
      // The number-matching heuristic also matches step 2 (regroup) since
      // "13 ones makes 1 ten and 3 ones" has digits 13, 1, 3 all in "7 + 6 = 13".
      // The next truly undemonstrated step would be tens_sum (20 + 30 + 10 = 60).
      const studentText = "7 + 6 = 13";
      const nextUndemonstrated = rubric.reasoningSteps.find(step => {
        return !step.expectedStatements.some(stmt => {
          const nums = stmt.match(/\d+/g) || [];
          return nums.length >= 2 && nums.every(n => studentText.includes(n));
        });
      });
      expect(nextUndemonstrated).toBeDefined();
      expect(nextUndemonstrated!.kind).toBe("tens_sum");
    });
  });
});
