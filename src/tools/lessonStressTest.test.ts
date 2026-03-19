/**
 * Tests for the lesson stress tester.
 *
 * Covers mode detection, case generation, transcript building,
 * replay integration, markdown generation, and CLI argument parsing.
 */

import type { Prompt } from "../domain/prompt";
import type { Lesson } from "../domain/lesson";

// ── Mocks ───────────────────────────────────────────────────────────────

jest.mock("../loaders/lessonLoader", () => ({
  loadLessonById: jest.fn(),
  getAllLessons: jest.fn(() => []),
}));

// Mock the replay engine with deterministic results
const mockRunFixture = jest.fn();
const mockAuditResult = jest.fn();

jest.mock("../domain/transcriptReplay", () => ({
  runFixture: (...args: any[]) => mockRunFixture(...args),
  auditResult: (...args: any[]) => mockAuditResult(...args),
  renderMarkdownReport: jest.fn(() => "# Mock Report"),
}));

import {
  detectPromptMode,
  buildMathCases,
  buildExplanationCases,
  buildCases,
  buildTranscript,
  runCase,
  runStressTest,
  renderStressTestMarkdown,
  parseArgs,
  type PromptMode,
  type SimulatedCase,
  type CaseResult,
  type StressTestSummary,
} from "./lessonStressTest";

// ── Test data ───────────────────────────────────────────────────────────

const MATH_PROMPT: Prompt = {
  id: "math-q1",
  type: "explain",
  input: "What is 11 + 14?",
  mathProblem: {
    skill: "two_digit_addition",
    a: 11,
    b: 14,
    expression: "11 + 14",
    correctAnswer: 25,
    requiresRegrouping: false,
    expectedStrategyTags: ["add ones", "add tens", "combine"],
  },
  assessment: {
    reasoningSteps: [
      { id: "s1", label: "Add ones", expectedStatements: ["1 + 4 = 5"], probe: "What is 1 + 4?", kind: "ones_sum" as const },
      { id: "s2", label: "Add tens", expectedStatements: ["10 + 10 = 20"], probe: "What is 10 + 10?", kind: "tens_sum" as const },
      { id: "s3", label: "Combine", expectedStatements: ["20 + 5 = 25"], probe: "What is 20 + 5?", kind: "combine" as const },
    ],
  },
};

const EXPLANATION_PROMPT: Prompt = {
  id: "expl-q1",
  type: "explain",
  input: "What are planets made of? Give examples.",
  assessment: {
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
  },
};

const UNSUPPORTED_PROMPT: Prompt = {
  id: "generic-q1",
  type: "explain",
  input: "Write a story about a cat.",
};

function makeMathLesson(): Lesson {
  return {
    id: "lesson-math",
    title: "Math Lesson",
    description: "Test math lesson",
    difficulty: "beginner",
    prompts: [MATH_PROMPT],
  };
}

function makeExplanationLesson(): Lesson {
  return {
    id: "lesson-expl",
    title: "Science Lesson",
    description: "Test explanation lesson",
    difficulty: "beginner",
    prompts: [EXPLANATION_PROMPT],
  };
}

// Default mock return values
function setupDefaultMocks() {
  mockRunFixture.mockReturnValue({
    fixture: { mode: "math" },
    fixtureName: "test",
    turns: [
      {
        turnNum: 1,
        studentMessage: "1 + 4 = 5",
        state: "partial",
        moveType: "STEP_PROBE_DIRECT",
        target: "s2",
        responseText: "Good. Now the tens.",
        words: 4,
        wrapAction: "continue",
        satisfiedSteps: ["s1"],
        missingSteps: ["s2", "s3"],
        completion: 0.33,
      },
    ],
    summaryStatus: "mastery",
    summaryRendered: "Good work.",
    summaryObservations: [],
    coachTexts: ["Good. Now the tens."],
    hasEvidence: true,
    satisfiedCount: 3,
    totalRequired: 3,
  });
  mockAuditResult.mockReturnValue([]);
}

// ============================================================================
// Tests
// ============================================================================

beforeEach(() => {
  jest.clearAllMocks();
  setupDefaultMocks();
});

// ── Mode detection ──────────────────────────────────────────────────────

describe("detectPromptMode", () => {
  it("detects math mode", () => {
    expect(detectPromptMode(MATH_PROMPT)).toBe("math");
  });

  it("detects explanation mode", () => {
    expect(detectPromptMode(EXPLANATION_PROMPT)).toBe("explanation");
  });

  it("throws for unsupported prompt", () => {
    expect(() => detectPromptMode(UNSUPPORTED_PROMPT)).toThrow(
      /neither math.*nor explanation/,
    );
  });

  it("prefers math when both fields exist", () => {
    const hybrid: Prompt = {
      ...EXPLANATION_PROMPT,
      mathProblem: MATH_PROMPT.mathProblem,
      assessment: {
        ...EXPLANATION_PROMPT.assessment,
        reasoningSteps: MATH_PROMPT.assessment!.reasoningSteps,
      },
    };
    expect(detectPromptMode(hybrid)).toBe("math");
  });
});

// ── Math case generation ────────────────────────────────────────────────

describe("buildMathCases", () => {
  it("generates 7 cases", () => {
    const cases = buildMathCases(MATH_PROMPT);
    expect(cases).toHaveLength(7);
  });

  it("includes all expected case names", () => {
    const cases = buildMathCases(MATH_PROMPT);
    const names = cases.map(c => c.name);
    expect(names).toContain("perfect_reasoning");
    expect(names).toContain("wrong_then_correct");
    expect(names).toContain("uncertainty_escalation");
    expect(names).toContain("stall_no_progress");
    expect(names).toContain("misconception_subtraction");
    expect(names).toContain("hint_request");
    expect(names).toContain("long_stall");
  });

  it("perfect_reasoning uses expected statements from steps", () => {
    const cases = buildMathCases(MATH_PROMPT);
    const perfect = cases.find(c => c.name === "perfect_reasoning")!;
    expect(perfect.studentTurns).toEqual(["1 + 4 = 5", "10 + 10 = 20", "20 + 5 = 25"]);
  });

  it("wrong_then_correct starts with incorrect answer", () => {
    const cases = buildMathCases(MATH_PROMPT);
    const wrongCase = cases.find(c => c.name === "wrong_then_correct")!;
    // First turn should be wrong (not matching any expected statement)
    expect(wrongCase.studentTurns[0]).not.toBe("1 + 4 = 5");
    // Remaining turns should include correct steps
    expect(wrongCase.studentTurns.slice(1)).toEqual(["1 + 4 = 5", "10 + 10 = 20", "20 + 5 = 25"]);
  });

  it("misconception uses subtraction result", () => {
    const cases = buildMathCases(MATH_PROMPT);
    const misconception = cases.find(c => c.name === "misconception_subtraction")!;
    // |11 - 14| = 3
    expect(misconception.studentTurns[0]).toBe("3");
  });

  it("uncertainty_escalation says 'I don't know'", () => {
    const cases = buildMathCases(MATH_PROMPT);
    const uncertainty = cases.find(c => c.name === "uncertainty_escalation")!;
    expect(uncertainty.studentTurns[0]).toContain("don't know");
  });
});

// ── Explanation case generation ─────────────────────────────────────────

describe("buildExplanationCases", () => {
  it("generates 6 cases", () => {
    const cases = buildExplanationCases(EXPLANATION_PROMPT);
    expect(cases).toHaveLength(6);
  });

  it("includes all expected case names", () => {
    const cases = buildExplanationCases(EXPLANATION_PROMPT);
    const names = cases.map(c => c.name);
    expect(names).toContain("mastery_fast");
    expect(names).toContain("claim_only_stall");
    expect(names).toContain("factual_error_then_correction");
    expect(names).toContain("uncertainty_recovery");
    expect(names).toContain("meta_question");
    expect(names).toContain("long_stall");
  });

  it("mastery_fast provides evidence for required entities", () => {
    const cases = buildExplanationCases(EXPLANATION_PROMPT);
    const mastery = cases.find(c => c.name === "mastery_fast")!;
    // Should reference at least 2 entities (minEntities)
    expect(mastery.studentTurns.length).toBeGreaterThanOrEqual(2);
    // First turn should mention an entity
    expect(mastery.studentTurns[0]).toContain("Mercury");
  });

  it("claim_only_stall has vague answers", () => {
    const cases = buildExplanationCases(EXPLANATION_PROMPT);
    const stall = cases.find(c => c.name === "claim_only_stall")!;
    expect(stall.studentTurns).toHaveLength(3);
    // Should not contain specific entity names
    for (const turn of stall.studentTurns) {
      expect(turn).not.toContain("Mercury");
      expect(turn).not.toContain("Jupiter");
    }
  });

  it("factual_error starts with wrong information", () => {
    const cases = buildExplanationCases(EXPLANATION_PROMPT);
    const errorCase = cases.find(c => c.name === "factual_error_then_correction")!;
    expect(errorCase.studentTurns[0]).toContain("chocolate"); // obviously wrong
    expect(errorCase.studentTurns[1]).toContain("Actually"); // correction
  });
});

// ── buildCases dispatcher ───────────────────────────────────────────────

describe("buildCases", () => {
  it("dispatches to math for math mode", () => {
    const cases = buildCases(MATH_PROMPT, "math");
    expect(cases).toHaveLength(7);
    expect(cases[0].name).toBe("perfect_reasoning");
  });

  it("dispatches to explanation for explanation mode", () => {
    const cases = buildCases(EXPLANATION_PROMPT, "explanation");
    expect(cases).toHaveLength(6);
    expect(cases[0].name).toBe("mastery_fast");
  });
});

// ── Transcript building ─────────────────────────────────────────────────

describe("buildTranscript", () => {
  it("starts with coach turn containing prompt input", () => {
    const transcript = buildTranscript(["1 + 4 = 5"], MATH_PROMPT, "math");
    expect(transcript[0]).toEqual({ role: "coach", message: "What is 11 + 14?" });
  });

  it("includes student turns", () => {
    const transcript = buildTranscript(["1 + 4 = 5"], MATH_PROMPT, "math");
    const studentTurns = transcript.filter(t => t.role === "student");
    expect(studentTurns).toHaveLength(1);
    expect(studentTurns[0].message).toBe("1 + 4 = 5");
  });

  it("interleaves coach responses between student turns", () => {
    const transcript = buildTranscript(
      ["1 + 4 = 5", "10 + 10 = 20"],
      MATH_PROMPT,
      "math",
    );
    // coach → student → coach → student
    expect(transcript.length).toBeGreaterThanOrEqual(4);
    expect(transcript[0].role).toBe("coach");
    expect(transcript[1].role).toBe("student");
    expect(transcript[2].role).toBe("coach");
    expect(transcript[3].role).toBe("student");
  });

  it("calls runFixture to generate coach responses", () => {
    buildTranscript(["1 + 4 = 5", "10 + 10 = 20"], MATH_PROMPT, "math");
    // runFixture called once per student turn to generate the coach response
    expect(mockRunFixture).toHaveBeenCalledTimes(2);
  });
});

// ── Replay integration ──────────────────────────────────────────────────

describe("runCase", () => {
  it("returns PASS when audit finds no issues", () => {
    mockAuditResult.mockReturnValue([]);
    const simCase: SimulatedCase = {
      name: "perfect",
      description: "Perfect student",
      studentTurns: ["1 + 4 = 5"],
    };
    const result = runCase(simCase, MATH_PROMPT, "math");
    expect(result.verdict).toBe("PASS");
    expect(result.issueCodes).toEqual([]);
  });

  it("returns WARN for medium-severity issues", () => {
    mockAuditResult.mockReturnValue([
      { code: "TARGET_STUCK", severity: "medium", detail: "stuck" },
    ]);
    const simCase: SimulatedCase = {
      name: "stall",
      description: "Stalling student",
      studentTurns: ["maybe"],
    };
    const result = runCase(simCase, MATH_PROMPT, "math");
    expect(result.verdict).toBe("WARN");
    expect(result.issueCodes).toEqual(["TARGET_STUCK"]);
  });

  it("returns FAIL for high-severity issues", () => {
    mockAuditResult.mockReturnValue([
      { code: "REPEATED_OPENING", severity: "high", detail: "repeated" },
    ]);
    const simCase: SimulatedCase = {
      name: "broken",
      description: "Broken case",
      studentTurns: ["something"],
    };
    const result = runCase(simCase, MATH_PROMPT, "math");
    expect(result.verdict).toBe("FAIL");
  });

  it("includes replay metadata in result", () => {
    const simCase: SimulatedCase = {
      name: "test",
      description: "Test case",
      studentTurns: ["1 + 4 = 5"],
    };
    const result = runCase(simCase, MATH_PROMPT, "math");
    expect(result.turnCount).toBe(1);
    expect(result.satisfiedCount).toBe(3);
    expect(result.totalRequired).toBe(3);
  });
});

// ── Full stress test ────────────────────────────────────────────────────

describe("runStressTest", () => {
  it("runs all math cases", () => {
    const summary = runStressTest(makeMathLesson(), "math-q1");
    expect(summary.mode).toBe("math");
    expect(summary.cases).toHaveLength(7);
    expect(summary.counts.pass).toBe(7);
    expect(summary.counts.warn).toBe(0);
    expect(summary.counts.fail).toBe(0);
  });

  it("runs all explanation cases", () => {
    const summary = runStressTest(makeExplanationLesson(), "expl-q1");
    expect(summary.mode).toBe("explanation");
    expect(summary.cases).toHaveLength(6);
  });

  it("throws for unknown prompt ID", () => {
    expect(() => runStressTest(makeMathLesson(), "nonexistent")).toThrow(
      /Prompt "nonexistent" not found/,
    );
  });

  it("includes lesson metadata", () => {
    const summary = runStressTest(makeMathLesson(), "math-q1");
    expect(summary.lessonId).toBe("lesson-math");
    expect(summary.lessonTitle).toBe("Math Lesson");
    expect(summary.promptId).toBe("math-q1");
    expect(summary.promptText).toBe("What is 11 + 14?");
  });
});

// ── Markdown generation ─────────────────────────────────────────────────

describe("renderStressTestMarkdown", () => {
  it("includes lesson metadata", () => {
    const summary = runStressTest(makeMathLesson(), "math-q1");
    const md = renderStressTestMarkdown(summary);
    expect(md).toContain("# Lesson Stress Test Report");
    expect(md).toContain("lesson-math");
    expect(md).toContain("Math Lesson");
    expect(md).toContain("math-q1");
  });

  it("includes case overview table", () => {
    const summary = runStressTest(makeMathLesson(), "math-q1");
    const md = renderStressTestMarkdown(summary);
    expect(md).toContain("## Case Overview");
    expect(md).toContain("perfect_reasoning");
    expect(md).toContain("wrong_then_correct");
    expect(md).toContain("uncertainty_escalation");
  });

  it("includes per-case detail sections", () => {
    const summary = runStressTest(makeMathLesson(), "math-q1");
    const md = renderStressTestMarkdown(summary);
    expect(md).toContain("## Case: perfect_reasoning");
    expect(md).toContain("## Case: wrong_then_correct");
  });

  it("includes summary counts", () => {
    const summary = runStressTest(makeMathLesson(), "math-q1");
    const md = renderStressTestMarkdown(summary);
    expect(md).toContain("## Summary");
    expect(md).toContain("| PASS |");
    expect(md).toContain("| WARN |");
    expect(md).toContain("| FAIL |");
  });

  it("shows issues when present", () => {
    mockAuditResult.mockReturnValueOnce([
      { code: "TARGET_STUCK", severity: "medium", turn: 2, detail: "stuck on s1" },
    ]);
    // Remaining calls return empty
    mockAuditResult.mockReturnValue([]);

    const summary = runStressTest(makeMathLesson(), "math-q1");
    const md = renderStressTestMarkdown(summary);
    expect(md).toContain("TARGET_STUCK");
  });
});

// ── CLI argument parsing ────────────────────────────────────────────────

describe("parseArgs", () => {
  // Mock process.exit to prevent test from exiting
  const mockExit = jest.spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit called");
  });
  const mockLog = jest.spyOn(console, "log").mockImplementation(() => {});

  afterAll(() => {
    mockExit.mockRestore();
    mockLog.mockRestore();
  });

  it("parses basic lessonId and promptId", () => {
    const args = parseArgs(["node", "script", "lesson-123", "q1"]);
    expect(args.lessonId).toBe("lesson-123");
    expect(args.promptId).toBe("q1");
    expect(args.verbose).toBe(false);
    expect(args.markdownPath).toBeNull();
  });

  it("parses --verbose flag", () => {
    const args = parseArgs(["node", "script", "lesson-123", "q1", "--verbose"]);
    expect(args.verbose).toBe(true);
  });

  it("parses --markdown path", () => {
    const args = parseArgs(["node", "script", "lesson-123", "q1", "--markdown", "report.md"]);
    expect(args.markdownPath).toBe("report.md");
  });

  it("parses all flags together", () => {
    const args = parseArgs(["node", "script", "lesson-123", "q1", "--verbose", "--markdown", "out.md"]);
    expect(args.lessonId).toBe("lesson-123");
    expect(args.promptId).toBe("q1");
    expect(args.verbose).toBe(true);
    expect(args.markdownPath).toBe("out.md");
  });

  it("exits on --help", () => {
    expect(() => parseArgs(["node", "script", "--help"])).toThrow("process.exit called");
  });

  it("exits with no arguments", () => {
    expect(() => parseArgs(["node", "script"])).toThrow("process.exit called");
  });
});

// ── Long stall cases ────────────────────────────────────────────────────

describe("long_stall cases", () => {
  it("math long_stall has 6 student turns", () => {
    const cases = buildMathCases(MATH_PROMPT);
    const longStall = cases.find(c => c.name === "long_stall")!;
    expect(longStall).toBeDefined();
    expect(longStall.studentTurns).toHaveLength(6);
  });

  it("explanation long_stall has 6 student turns", () => {
    const cases = buildExplanationCases(EXPLANATION_PROMPT);
    const longStall = cases.find(c => c.name === "long_stall")!;
    expect(longStall).toBeDefined();
    expect(longStall.studentTurns).toHaveLength(6);
  });

  it("long_stall turns are all uncertain/vague", () => {
    const cases = buildMathCases(MATH_PROMPT);
    const longStall = cases.find(c => c.name === "long_stall")!;
    for (const turn of longStall.studentTurns) {
      expect(
        /don't know|not sure|maybe|confused/i.test(turn),
      ).toBe(true);
    }
  });
});

// ── Strategy metadata in markdown ────────────────────────────────────────

describe("stress markdown strategy metadata", () => {
  it("includes Strategy and Escalation columns in turn table", () => {
    const summary = runStressTest(makeMathLesson(), "math-q1");
    const md = renderStressTestMarkdown(summary);
    expect(md).toContain("Strategy");
    expect(md).toContain("Escalation");
  });
});
