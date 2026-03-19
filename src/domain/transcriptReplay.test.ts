/**
 * Tests for transcriptReplay markdown report rendering and golden-fixture
 * expectation checking.
 *
 * Uses the exported renderMarkdownReport / checkExpectations functions with
 * synthetic ReplayResult/AuditIssue data to verify stable markdown structure
 * and regression behavior.
 */

import {
  renderMarkdownReport,
  auditResult,
  checkExpectations,
  runFixture,
  DEMO_EXPLANATION,
  DEMO_MATH,
  ISSUE_SEVERITY,
  type ReplayResult,
  type AuditIssue,
  type TurnRecord,
  type Fixture,
  type ExplanationFixture,
  type MathFixture,
} from "./transcriptReplay";

// ============================================================================
// Helpers
// ============================================================================

function makeTurn(overrides: Partial<TurnRecord> = {}): TurnRecord {
  return {
    turnNum: 1,
    studentMessage: "test response",
    state: "partial_evidence",
    moveType: "EVIDENCE_PROBE",
    responseText: "What else?",
    words: 2,
    target: null,
    wrapAction: "continue_probing",
    ...overrides,
  };
}

function makeResult(overrides: Partial<ReplayResult> = {}): ReplayResult {
  return {
    fixture: DEMO_EXPLANATION as Fixture,
    fixtureName: "test fixture",
    turns: [makeTurn()],
    summaryStatus: "partial",
    summaryRendered: "Student showed partial understanding.",
    summaryObservations: ["1 entity found"],
    coachTexts: ["What else?"],
    hasEvidence: true,
    satisfiedCount: 1,
    totalRequired: 2,
    ...overrides,
  };
}

function makeIssue(overrides: Partial<AuditIssue> = {}): AuditIssue {
  return {
    code: "OVERLONG",
    severity: "medium",
    turn: 1,
    detail: "EVIDENCE_PROBE at turn 1: 30 words (limit 25)",
    ...overrides,
  };
}

// ============================================================================
// Structure tests
// ============================================================================

describe("renderMarkdownReport", () => {
  it("starts with the report heading", () => {
    const md = renderMarkdownReport([{ result: makeResult(), issues: [] }]);
    expect(md.startsWith("# Transcript Audit Report\n")).toBe(true);
  });

  it("includes fixture name as H2", () => {
    const md = renderMarkdownReport([{
      result: makeResult({ fixtureName: "my fixture" }),
      issues: [],
    }]);
    expect(md).toContain("## my fixture");
  });

  it("includes the metadata table with all required fields", () => {
    const md = renderMarkdownReport([{
      result: makeResult({
        fixtureName: "meta test",
        turns: [makeTurn({ wrapAction: "wrap_mastery" })],
        summaryStatus: "mastery",
        satisfiedCount: 2,
        totalRequired: 2,
      }),
      issues: [],
    }]);
    expect(md).toContain("| Mode | explanation |");
    expect(md).toContain("| Result | **PASS** |");
    expect(md).toContain("| Turns | 1 |");
    expect(md).toContain("| Satisfied | 2/2 |");
    expect(md).toContain("| Final wrap | wrap_mastery |");
    expect(md).toContain("| Summary status | mastery |");
  });

  it("includes per-turn table with correct headers", () => {
    const md = renderMarkdownReport([{ result: makeResult(), issues: [] }]);
    expect(md).toContain("| # | Student utterance | State | Move | Strategy | Escalation | Words | Wrap |");
  });

  it("renders turn data in the table", () => {
    const md = renderMarkdownReport([{
      result: makeResult({
        turns: [makeTurn({
          turnNum: 2,
          studentMessage: "Earth is rock",
          state: "partial_evidence",
          moveType: "EVIDENCE_PROBE",
          target: "Jupiter materials",
          responseText: "Tell me more",
          words: 3,
          wrapAction: "continue_probing",
        })],
      }),
      issues: [],
    }]);
    // Column now shows strategy + escalation instead of target + response
    expect(md).toContain("| 2 |");
    expect(md).toContain("Earth is rock");
    expect(md).toContain("partial_evidence");
    expect(md).toContain("EVIDENCE_PROBE");
  });

  it("includes aggregate summary section", () => {
    const md = renderMarkdownReport([
      { result: makeResult(), issues: [] },
      { result: makeResult({ fixtureName: "second" }), issues: [] },
    ]);
    expect(md).toContain("## Aggregate Summary");
    expect(md).toContain("| Fixtures | 2 |");
    expect(md).toContain("| Pass | 2 |");
    expect(md).toContain("| Warn | 0 |");
    expect(md).toContain("| Fail | 0 |");
  });
});

// ============================================================================
// Verdict tests
// ============================================================================

describe("markdown verdict", () => {
  it("shows PASS when no issues", () => {
    const md = renderMarkdownReport([{ result: makeResult(), issues: [] }]);
    expect(md).toContain("| Result | **PASS** |");
  });

  it("shows WARN for medium-severity issues", () => {
    const md = renderMarkdownReport([{
      result: makeResult(),
      issues: [makeIssue({ severity: "medium" })],
    }]);
    expect(md).toContain("| Result | **WARN** |");
  });

  it("shows FAIL for high-severity issues", () => {
    const md = renderMarkdownReport([{
      result: makeResult(),
      issues: [makeIssue({ code: "REPEATED_OPENING", severity: "high", detail: "test" })],
    }]);
    expect(md).toContain("| Result | **FAIL** |");
  });

  it("FAIL takes precedence over WARN", () => {
    const md = renderMarkdownReport([{
      result: makeResult(),
      issues: [
        makeIssue({ severity: "medium" }),
        makeIssue({ code: "PREMATURE_WRAP", severity: "high", detail: "test" }),
      ],
    }]);
    expect(md).toContain("| Result | **FAIL** |");
  });
});

// ============================================================================
// Issue rendering tests
// ============================================================================

describe("markdown issue section", () => {
  it("omits Issues heading when no issues", () => {
    const md = renderMarkdownReport([{ result: makeResult(), issues: [] }]);
    expect(md).not.toContain("### Issues");
  });

  it("includes issue table when issues present", () => {
    const issue = makeIssue({
      code: "TARGET_STUCK",
      severity: "medium",
      turn: 3,
      detail: 'Target "step_ones" probed 3 times',
    });
    const md = renderMarkdownReport([{ result: makeResult(), issues: [issue] }]);
    expect(md).toContain("### Issues");
    expect(md).toContain("| Severity | Code | Turn | Detail |");
    expect(md).toContain('| medium | TARGET_STUCK | 3 | Target "step_ones" probed 3 times |');
  });

  it("shows dash for issues without a turn number", () => {
    const issue = makeIssue({
      code: "SUMMARY_MISMATCH",
      severity: "high",
      turn: undefined,
      detail: "Summary mismatch",
    });
    const md = renderMarkdownReport([{ result: makeResult(), issues: [issue] }]);
    expect(md).toContain("| high | SUMMARY_MISMATCH | — | Summary mismatch |");
  });
});

// ============================================================================
// Aggregate summary tests
// ============================================================================

describe("markdown aggregate summary", () => {
  it("counts pass/warn/fail correctly", () => {
    const pass = { result: makeResult({ fixtureName: "a" }), issues: [] as AuditIssue[] };
    const warn = { result: makeResult({ fixtureName: "b" }), issues: [makeIssue({ severity: "medium" })] };
    const fail = {
      result: makeResult({ fixtureName: "c" }),
      issues: [makeIssue({ code: "PREMATURE_WRAP", severity: "high", detail: "x" })],
    };
    const md = renderMarkdownReport([pass, warn, fail]);
    expect(md).toContain("| Fixtures | 3 |");
    expect(md).toContain("| Pass | 1 |");
    expect(md).toContain("| Warn | 1 |");
    expect(md).toContain("| Fail | 1 |");
  });

  it("includes issue frequency table", () => {
    const md = renderMarkdownReport([
      { result: makeResult({ fixtureName: "a" }), issues: [makeIssue({ code: "OVERLONG", severity: "medium", detail: "x" })] },
      { result: makeResult({ fixtureName: "b" }), issues: [makeIssue({ code: "OVERLONG", severity: "medium", detail: "y" }), makeIssue({ code: "REPEATED_OPENING", severity: "high", detail: "z" })] },
    ]);
    expect(md).toContain("### Issues by Type");
    expect(md).toContain("| OVERLONG | medium | 2 |");
    expect(md).toContain("| REPEATED_OPENING | high | 1 |");
  });

  it("omits issue frequency table when no issues", () => {
    const md = renderMarkdownReport([{ result: makeResult(), issues: [] }]);
    expect(md).not.toContain("### Issues by Type");
  });
});

// ============================================================================
// Edge case tests
// ============================================================================

describe("markdown edge cases", () => {
  it("truncates long student utterances", () => {
    const longMsg = "a".repeat(60);
    const md = renderMarkdownReport([{
      result: makeResult({
        turns: [makeTurn({ studentMessage: longMsg })],
      }),
      issues: [],
    }]);
    // Should be truncated to 40 chars with ellipsis
    expect(md).toContain("a".repeat(39) + "…");
    expect(md).not.toContain("a".repeat(41));
  });

  it("escapes pipe characters in text", () => {
    const md = renderMarkdownReport([{
      result: makeResult({
        turns: [makeTurn({ studentMessage: "yes | no", responseText: "a | b" })],
      }),
      issues: [],
    }]);
    expect(md).toContain("yes \\| no");
  });

  it("handles empty turns array", () => {
    const md = renderMarkdownReport([{
      result: makeResult({ turns: [] }),
      issues: [],
    }]);
    expect(md).toContain("| Turns | 0 |");
    expect(md).toContain("| Final wrap | none |");
  });
});

// ============================================================================
// Integration: built-in demos produce valid markdown
// ============================================================================

describe("markdown integration with built-in demos", () => {
  it("renders explanation demo without errors", () => {
    const result = runFixture(DEMO_EXPLANATION as Fixture);
    const issues = auditResult(result);
    const md = renderMarkdownReport([{ result, issues }]);
    expect(md).toContain("# Transcript Audit Report");
    expect(md).toContain("## planets: claim");
    expect(md).toContain("| Mode | explanation |");
    expect(md).toContain("### Turns");
    expect(md).toContain("## Aggregate Summary");
  });

  it("renders math demo without errors", () => {
    const result = runFixture(DEMO_MATH as Fixture);
    const issues = auditResult(result);
    const md = renderMarkdownReport([{ result, issues }]);
    expect(md).toContain("## 11+14: smooth walkthrough");
    expect(md).toContain("| Mode | math |");
    expect(md).toContain("| Result | **PASS** |");
  });

  it("renders both demos with correct aggregate counts", () => {
    const r1 = runFixture(DEMO_EXPLANATION as Fixture);
    const r2 = runFixture(DEMO_MATH as Fixture);
    const md = renderMarkdownReport([
      { result: r1, issues: auditResult(r1) },
      { result: r2, issues: auditResult(r2) },
    ]);
    expect(md).toContain("| Fixtures | 2 |");
    expect(md).toContain("| Pass | 2 |");
  });
});

// ============================================================================
// Golden-fixture expectation checking
// ============================================================================

describe("checkExpectations", () => {
  it("returns no issues when fixture has no expectations", () => {
    const fixture: Fixture = { ...DEMO_EXPLANATION } as Fixture;
    delete (fixture as any).expectedVerdict;
    delete (fixture as any).expectedIssueCodes;
    const issues = checkExpectations(fixture, []);
    expect(issues).toEqual([]);
  });

  it("returns no issues when expected PASS matches actual PASS", () => {
    const fixture: Fixture = {
      ...DEMO_EXPLANATION,
      expectedVerdict: "PASS",
    } as Fixture;
    const issues = checkExpectations(fixture, []);
    expect(issues).toEqual([]);
  });

  it("returns EXPECTATION_MISMATCH when expected PASS but got WARN", () => {
    const fixture: Fixture = {
      ...DEMO_EXPLANATION,
      expectedVerdict: "PASS",
    } as Fixture;
    const actualIssues: AuditIssue[] = [
      makeIssue({ code: "OVERLONG", severity: "medium", detail: "test" }),
    ];
    const mismatches = checkExpectations(fixture, actualIssues);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].code).toBe("EXPECTATION_MISMATCH");
    expect(mismatches[0].severity).toBe("high");
    expect(mismatches[0].detail).toContain("Expected verdict PASS but got WARN");
  });

  it("returns EXPECTATION_MISMATCH when expected PASS but got FAIL", () => {
    const fixture: Fixture = {
      ...DEMO_EXPLANATION,
      expectedVerdict: "PASS",
    } as Fixture;
    const actualIssues: AuditIssue[] = [
      makeIssue({ code: "PREMATURE_WRAP", severity: "high", detail: "test" }),
    ];
    const mismatches = checkExpectations(fixture, actualIssues);
    expect(mismatches.some(m => m.detail.includes("Expected verdict PASS but got FAIL"))).toBe(true);
  });

  it("returns no issues when expected WARN matches actual WARN", () => {
    const fixture: Fixture = {
      ...DEMO_EXPLANATION,
      expectedVerdict: "WARN",
    } as Fixture;
    const actualIssues: AuditIssue[] = [
      makeIssue({ code: "OVERLONG", severity: "medium", detail: "test" }),
    ];
    const mismatches = checkExpectations(fixture, actualIssues);
    expect(mismatches).toEqual([]);
  });

  it("checks expectedIssueCodes — missing expected code", () => {
    const fixture: Fixture = {
      ...DEMO_EXPLANATION,
      expectedIssueCodes: ["OVERLONG"],
    } as Fixture;
    const mismatches = checkExpectations(fixture, []);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].detail).toContain("Expected issue code OVERLONG not found");
  });

  it("checks expectedIssueCodes — unexpected extra code", () => {
    const fixture: Fixture = {
      ...DEMO_EXPLANATION,
      expectedIssueCodes: [],
    } as Fixture;
    const actualIssues: AuditIssue[] = [
      makeIssue({ code: "OVERLONG", severity: "medium", detail: "test" }),
    ];
    const mismatches = checkExpectations(fixture, actualIssues);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].detail).toContain("Unexpected issue code OVERLONG");
  });

  it("passes when expectedIssueCodes match exactly", () => {
    const fixture: Fixture = {
      ...DEMO_EXPLANATION,
      expectedIssueCodes: ["OVERLONG", "TARGET_STUCK"],
    } as Fixture;
    const actualIssues: AuditIssue[] = [
      makeIssue({ code: "OVERLONG", severity: "medium", detail: "x" }),
      makeIssue({ code: "TARGET_STUCK", severity: "medium", detail: "y" }),
    ];
    const mismatches = checkExpectations(fixture, actualIssues);
    expect(mismatches).toEqual([]);
  });

  it("backward compatible: no expectations means no mismatches even with issues", () => {
    const fixture: Fixture = { ...DEMO_EXPLANATION } as Fixture;
    const actualIssues: AuditIssue[] = [
      makeIssue({ code: "OVERLONG", severity: "medium", detail: "x" }),
      makeIssue({ code: "PREMATURE_WRAP", severity: "high", detail: "y" }),
    ];
    const mismatches = checkExpectations(fixture, actualIssues);
    expect(mismatches).toEqual([]);
  });
});

// ============================================================================
// Golden-fixture integration with markdown report
// ============================================================================

describe("golden-fixture expectation in markdown", () => {
  it("EXPECTATION_MISMATCH appears in markdown issues table", () => {
    const result = makeResult({ fixtureName: "golden test" });
    const issues: AuditIssue[] = [
      {
        code: "EXPECTATION_MISMATCH",
        severity: "high",
        detail: "Expected verdict PASS but got WARN",
      },
    ];
    const md = renderMarkdownReport([{ result, issues }]);
    expect(md).toContain("| Result | **FAIL** |");
    expect(md).toContain("| high | EXPECTATION_MISMATCH | — | Expected verdict PASS but got WARN |");
  });

  it("aggregate summary counts EXPECTATION_MISMATCH as Fail", () => {
    const pass = { result: makeResult({ fixtureName: "a" }), issues: [] as AuditIssue[] };
    const mismatch = {
      result: makeResult({ fixtureName: "b" }),
      issues: [{
        code: "EXPECTATION_MISMATCH" as const,
        severity: "high" as const,
        detail: "Expected verdict PASS but got WARN",
      }],
    };
    const md = renderMarkdownReport([pass, mismatch]);
    expect(md).toContain("| Fixtures | 2 |");
    expect(md).toContain("| Pass | 1 |");
    expect(md).toContain("| Fail | 1 |");
    expect(md).toContain("| EXPECTATION_MISMATCH | high | 1 |");
  });
});

// ============================================================================
// Strategy metadata in replay output
// ============================================================================

describe("strategy metadata in replay", () => {
  it("math replay includes strategyLevel on each turn", () => {
    const result = runFixture(DEMO_MATH as Fixture);
    for (const t of result.turns) {
      expect(t.strategyLevel).toBeDefined();
      expect(typeof t.strategyLevel).toBe("string");
    }
  });

  it("explanation replay includes strategyLevel on each turn", () => {
    const result = runFixture(DEMO_EXPLANATION as Fixture);
    for (const t of result.turns) {
      expect(t.strategyLevel).toBeDefined();
      expect(typeof t.strategyLevel).toBe("string");
    }
  });

  it("math replay includes uncertainStreak and noProgressStreak", () => {
    const result = runFixture(DEMO_MATH as Fixture);
    for (const t of result.turns) {
      expect(typeof t.uncertainStreak).toBe("number");
      expect(typeof t.noProgressStreak).toBe("number");
    }
  });

  it("markdown includes Strategy and Escalation columns", () => {
    const result = runFixture(DEMO_MATH as Fixture);
    const issues = auditResult(result);
    const md = renderMarkdownReport([{ result, issues }]);
    expect(md).toContain("Strategy");
    expect(md).toContain("Escalation");
  });
});

// ============================================================================
// TARGET_STUCK suppression when escalation is working
// ============================================================================

describe("TARGET_STUCK suppression", () => {
  it("suppresses TARGET_STUCK when move types vary (escalation working)", () => {
    const result = makeResult({
      fixture: DEMO_MATH as Fixture,
      turns: [
        makeTurn({ turnNum: 1, target: "step_ones", moveType: "STEP_PROBE_SIMPLER", state: "uncertain" }),
        makeTurn({ turnNum: 2, target: "step_ones", moveType: "STEP_HINT", state: "uncertain", escalationReason: "uncertainty_streak_2" }),
        makeTurn({ turnNum: 3, target: "step_ones", moveType: "STEP_DEMONSTRATE_STEP", state: "uncertain", escalationReason: "uncertainty_streak_3_plus" }),
      ],
      coachTexts: ["probe", "hint", "demonstrate"],
    });
    const issues = auditResult(result);
    expect(issues.find(i => i.code === "TARGET_STUCK")).toBeUndefined();
  });

  it("suppresses TARGET_STUCK when escalationReason is present", () => {
    const result = makeResult({
      fixture: DEMO_MATH as Fixture,
      turns: [
        makeTurn({ turnNum: 1, target: "step_ones", moveType: "STEP_PROBE_SIMPLER", state: "uncertain" }),
        makeTurn({ turnNum: 2, target: "step_ones", moveType: "STEP_PROBE_SIMPLER", state: "uncertain" }),
        makeTurn({ turnNum: 3, target: "step_ones", moveType: "STEP_PROBE_SIMPLER", state: "uncertain", escalationReason: "uncertainty_streak_3_plus" }),
      ],
      coachTexts: ["a", "b", "c"],
    });
    const issues = auditResult(result);
    expect(issues.find(i => i.code === "TARGET_STUCK")).toBeUndefined();
  });

  it("still flags TARGET_STUCK when no escalation occurs", () => {
    const result = makeResult({
      fixture: DEMO_MATH as Fixture,
      turns: [
        makeTurn({ turnNum: 1, target: "step_ones", moveType: "STEP_PROBE_SIMPLER", state: "uncertain" }),
        makeTurn({ turnNum: 2, target: "step_ones", moveType: "STEP_PROBE_SIMPLER", state: "uncertain" }),
        makeTurn({ turnNum: 3, target: "step_ones", moveType: "STEP_PROBE_SIMPLER", state: "uncertain" }),
      ],
      coachTexts: ["a", "b", "c"],
    });
    const issues = auditResult(result);
    expect(issues.find(i => i.code === "TARGET_STUCK")).toBeDefined();
  });
});

// ============================================================================
// Long-stall math escalation in replay
// ============================================================================

describe("long-stall math escalation", () => {
  it("exercises escalation across 6 uncertain turns", () => {
    const mathFixture: MathFixture = {
      mode: "math",
      name: "long-stall: 11+14",
      mathProblem: {
        skill: "two_digit_addition",
        a: 11,
        b: 14,
        expression: "11 + 14",
        correctAnswer: 25,
        requiresRegrouping: false,
        expectedStrategyTags: ["add ones", "add tens", "combine"],
      },
      reasoningSteps: [
        { id: "step_ones", label: "Add ones", expectedStatements: ["1 + 4 = 5"], probe: "What is 1+4?", kind: "ones_sum" as const },
        { id: "step_tens", label: "Add tens", expectedStatements: ["10 + 10 = 20"], probe: "What is 10+10?", kind: "tens_sum" as const },
        { id: "step_combine", label: "Combine", expectedStatements: ["20 + 5 = 25"], probe: "What is 20+5?", kind: "combine" as const },
      ],
      transcript: [
        { role: "coach", message: "Let's solve 11 + 14." },
        { role: "student", message: "I don't know" },
        { role: "coach", message: "Let's start small." },
        { role: "student", message: "I'm not sure" },
        { role: "coach", message: "Think about ones." },
        { role: "student", message: "um maybe" },
        { role: "coach", message: "What is 1 + 4?" },
        { role: "student", message: "I still don't know" },
        { role: "coach", message: "That's ok." },
        { role: "student", message: "I'm confused" },
        { role: "coach", message: "Here's how it works." },
        { role: "student", message: "I really don't know" },
      ],
    };

    const result = runFixture(mathFixture);

    // Should have 6 student turns
    expect(result.turns).toHaveLength(6);

    // Collect strategy levels across the transcript
    const strategies = result.turns.map(t => t.strategyLevel);
    const moveTypes = result.turns.map(t => t.moveType);

    // The strategy should advance past probe_simpler at some point
    const advancedStrategies = new Set(strategies);
    const hasEscalation = advancedStrategies.has("hint") ||
      advancedStrategies.has("demonstrate_step") ||
      advancedStrategies.has("guided_completion") ||
      advancedStrategies.has("wrap_support");
    expect(hasEscalation).toBe(true);

    // Move types should vary (not all the same)
    const uniqueMoves = new Set(moveTypes);
    expect(uniqueMoves.size).toBeGreaterThan(1);

    // At least one turn should have an escalation reason
    const escalationReasons = result.turns.filter(t => t.escalationReason);
    expect(escalationReasons.length).toBeGreaterThan(0);
  });

  it("TARGET_STUCK is suppressed for long-stall with escalation", () => {
    const mathFixture: MathFixture = {
      mode: "math",
      name: "long-stall suppressed",
      mathProblem: {
        skill: "two_digit_addition",
        a: 11,
        b: 14,
        expression: "11 + 14",
        correctAnswer: 25,
        requiresRegrouping: false,
        expectedStrategyTags: ["add ones", "add tens", "combine"],
      },
      reasoningSteps: [
        { id: "step_ones", label: "Add ones", expectedStatements: ["1 + 4 = 5"], probe: "What is 1+4?", kind: "ones_sum" as const },
        { id: "step_tens", label: "Add tens", expectedStatements: ["10 + 10 = 20"], probe: "What is 10+10?", kind: "tens_sum" as const },
        { id: "step_combine", label: "Combine", expectedStatements: ["20 + 5 = 25"], probe: "What is 20+5?", kind: "combine" as const },
      ],
      transcript: [
        { role: "coach", message: "Let's solve 11 + 14." },
        { role: "student", message: "I don't know" },
        { role: "coach", message: "Let's start small." },
        { role: "student", message: "I'm not sure" },
        { role: "coach", message: "Think about ones." },
        { role: "student", message: "um maybe" },
        { role: "coach", message: "What is 1 + 4?" },
        { role: "student", message: "I still don't know" },
      ],
    };

    const result = runFixture(mathFixture);
    const issues = auditResult(result);

    // TARGET_STUCK should be suppressed because move types change via escalation
    const targetStuck = issues.filter(i => i.code === "TARGET_STUCK");
    expect(targetStuck).toHaveLength(0);
  });
});

// ============================================================================
// Long-stall explanation escalation in replay
// ============================================================================

describe("long-stall explanation escalation", () => {
  it("explanation replay tracks uncertainty streaks", () => {
    const explFixture: ExplanationFixture = {
      mode: "explanation",
      name: "long-stall: planets",
      promptInput: "What are planets made of?",
      requiredEvidence: {
        minEntities: 2,
        entityLabel: "planets",
        attributeLabel: "materials",
        minAttributeTypes: 2,
        requirePairing: true,
      },
      referenceFacts: {
        Mercury: ["rock", "metal"],
        Venus: ["rock"],
        Earth: ["rock", "metal"],
        Jupiter: ["gas"],
      },
      successCriteria: [
        "Names at least two specific planets.",
        "Describes what each named planet is made of.",
      ],
      transcript: [
        { role: "coach", message: "What are planets made of?" },
        { role: "student", message: "I don't know" },
        { role: "coach", message: "Think about what you know." },
        { role: "student", message: "I'm not sure" },
        { role: "coach", message: "That's ok. What about Earth?" },
        { role: "student", message: "um maybe stuff" },
        { role: "coach", message: "Let me help." },
        { role: "student", message: "I still don't know" },
      ],
    };

    const result = runFixture(explFixture);
    expect(result.turns).toHaveLength(4);

    // Later turns should have higher uncertainty streaks
    const lastTurn = result.turns[result.turns.length - 1];
    expect(lastTurn.uncertainStreak).toBeGreaterThanOrEqual(3);

    // Strategy should escalate beyond probe
    const strategies = result.turns.map(t => t.strategyLevel);
    const advancedStrategies = strategies.filter(s =>
      s === "hint" || s === "demonstrate_step" || s === "guided_completion" || s === "wrap_support",
    );
    expect(advancedStrategies.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Long-stall math: REPEATED_OPENING and SUMMARY_MISMATCH
// ============================================================================

describe("long-stall math replay", () => {
  // Build a 6-turn math long_stall fixture using the same approach as the stress test
  function buildLongStallMathFixture(): MathFixture {
    const mathProblem = {
      skill: "two_digit_addition" as const,
      a: 11,
      b: 14,
      expression: "11 + 14",
      correctAnswer: 25,
      requiresRegrouping: false,
      expectedStrategyTags: ["add ones", "add tens"],
      commonWrongAnswers: [
        { answer: 15, misconception: "ones only" },
        { answer: 35, misconception: "all digits" },
      ],
    };
    const reasoningSteps = [
      { id: "step_1", label: "Add the ones", expectedStatements: ["1 + 4 = 5"], probe: "What do you get when you add 1 and 4?", kind: "ones_sum" as const },
      { id: "step_2", label: "Add the tens", expectedStatements: ["10 + 10 = 20"], probe: "What do you get when you add 10 and 10?", kind: "tens_sum" as const },
      { id: "step_3", label: "Combine the totals", expectedStatements: ["20 + 5 = 25", "The final answer is 25"], probe: "What do you get when you combine 20 and 5?", kind: "combine" as const },
    ];

    // Build transcript interactively (same as stress test buildTranscript)
    const studentTurns = [
      "I don't know",
      "I'm not sure",
      "um maybe",
      "I still don't know",
      "I'm confused",
      "I really don't know",
    ];
    const transcript: Array<{ role: "coach" | "student"; message: string }> = [];
    transcript.push({ role: "coach", message: "What is 11 + 14?" });

    for (let i = 0; i < studentTurns.length; i++) {
      transcript.push({ role: "student", message: studentTurns[i] });
      if (i < studentTurns.length - 1) {
        // Run replay to get coach response
        const tempFixture: MathFixture = {
          mode: "math",
          name: "long-stall",
          mathProblem,
          reasoningSteps,
          transcript: [...transcript],
        };
        const tempResult = runFixture(tempFixture);
        const lastTurn = tempResult.turns[tempResult.turns.length - 1];
        if (lastTurn?.responseText) {
          transcript.push({ role: "coach", message: lastTurn.responseText });
        }
      }
    }

    return {
      mode: "math",
      name: "long-stall: 11 + 14",
      mathProblem,
      reasoningSteps,
      transcript,
    };
  }

  it("no REPEATED_OPENING in long_stall math replay", () => {
    const fixture = buildLongStallMathFixture();
    const result = runFixture(fixture);
    const issues = auditResult(result);

    const repeatedOpenings = issues.filter(i => i.code === "REPEATED_OPENING");
    expect(repeatedOpenings).toHaveLength(0);
  });

  it("no SUMMARY_MISMATCH in long_stall math replay", () => {
    const fixture = buildLongStallMathFixture();
    const result = runFixture(fixture);
    const issues = auditResult(result);

    const summaryMismatches = issues.filter(i => i.code === "SUMMARY_MISMATCH");
    expect(summaryMismatches).toHaveLength(0);
  });

  it("coach-demonstrated steps do not inflate satisfiedCount for summary", () => {
    const fixture = buildLongStallMathFixture();
    const result = runFixture(fixture);

    // When the coach demonstrates all steps, the student never gave the answer,
    // so summaryStatus should be "needs_support"
    expect(result.summaryStatus).toBe("needs_support");

    // The audit should not flag this as SUMMARY_MISMATCH, meaning
    // satisfiedCount must accurately reflect student-demonstrated evidence
    // (not coach-demonstrated evidence)
    const issues = auditResult(result);
    const mismatches = issues.filter(i => i.code === "SUMMARY_MISMATCH");
    expect(mismatches).toHaveLength(0);
  });

  it("STEP_DEMONSTRATE_STEP uses varied openings", () => {
    const fixture = buildLongStallMathFixture();
    const result = runFixture(fixture);

    // Find all demonstrate-step turns
    const demoTurns = result.turns.filter(t => t.moveType === "STEP_DEMONSTRATE_STEP");
    expect(demoTurns.length).toBeGreaterThanOrEqual(2);

    // Check no consecutive pair shares first 4 words
    for (let i = 1; i < demoTurns.length; i++) {
      const prev = demoTurns[i - 1].responseText.split(/\s+/).slice(0, 4).join(" ").toLowerCase();
      const curr = demoTurns[i].responseText.split(/\s+/).slice(0, 4).join(" ").toLowerCase();
      expect(curr).not.toBe(prev);
    }
  });
});
