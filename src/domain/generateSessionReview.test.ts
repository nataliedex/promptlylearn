/**
 * Tests for the session review packet generator.
 *
 * Uses synthetic session/prompt data to verify markdown rendering,
 * mode detection, promotion logic, and multi-prompt handling.
 */

import {
  buildSessionReview,
  analyzePrompt,
  buildStudentJourneySummary,
  detectMode,
  usesDeterministicPipeline,
  recommendPromotion,
  renderSessionReview,
  isPlaceholderTranscript,
  compareReplayToLive,
  type SessionFile,
  type SessionReview,
  type PromptAnalysis,
  type TranscriptTurn,
  type DetectedMode,
  type LiveOutcome,
} from "./generateSessionReview";
import type { Lesson } from "./lesson";
import type { Prompt } from "./prompt";

// ============================================================================
// Shared test data
// ============================================================================

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

const MATH_TRANSCRIPT: TranscriptTurn[] = [
  { role: "coach", message: "What is 11 + 14?" },
  { role: "student", message: "1 + 4 = 5" },
  { role: "coach", message: "Good. Now the tens." },
  { role: "student", message: "10 + 10 = 20" },
  { role: "coach", message: "Now combine." },
  { role: "student", message: "20 + 5 = 25" },
];

const EXPLANATION_TRANSCRIPT: TranscriptTurn[] = [
  { role: "coach", message: "What are planets made of?" },
  { role: "student", message: "Earth is made of rock" },
  { role: "coach", message: "Name another planet." },
  { role: "student", message: "Jupiter is made of gas" },
];

function makeLesson(prompts: Prompt[]): Lesson {
  return {
    id: "lesson-test",
    title: "Test Lesson",
    description: "A test lesson",
    prompts,
    difficulty: "beginner",
  };
}

function makeSession(responses: Array<{ promptId: string; turns: TranscriptTurn[] }>): SessionFile {
  return {
    id: "session-test-123",
    lessonId: "lesson-test",
    lessonTitle: "Test Lesson",
    studentName: "Test Student",
    submission: {
      responses: responses.map(r => ({
        promptId: r.promptId,
        conversationTurns: r.turns,
      })),
    },
  };
}

// ============================================================================
// Mode detection
// ============================================================================

describe("detectMode", () => {
  it("detects math mode", () => {
    expect(detectMode(MATH_PROMPT)).toBe("math");
  });

  it("detects explanation mode", () => {
    expect(detectMode(EXPLANATION_PROMPT)).toBe("explanation");
  });

  it("returns unsupported for generic prompt", () => {
    expect(detectMode(UNSUPPORTED_PROMPT)).toBe("unsupported");
  });

  it("prefers math when both math and explanation fields exist", () => {
    const hybrid: Prompt = {
      ...EXPLANATION_PROMPT,
      mathProblem: MATH_PROMPT.mathProblem,
      assessment: {
        ...EXPLANATION_PROMPT.assessment,
        reasoningSteps: MATH_PROMPT.assessment!.reasoningSteps,
      },
    };
    expect(detectMode(hybrid)).toBe("math");
  });
});

describe("usesDeterministicPipeline", () => {
  it("returns true for math with reasoning steps", () => {
    expect(usesDeterministicPipeline(MATH_PROMPT, "math")).toBe(true);
  });

  it("returns true for explanation with required fields", () => {
    expect(usesDeterministicPipeline(EXPLANATION_PROMPT, "explanation")).toBe(true);
  });

  it("returns false for unsupported mode", () => {
    expect(usesDeterministicPipeline(UNSUPPORTED_PROMPT, "unsupported")).toBe(false);
  });
});

// ============================================================================
// Math session report
// ============================================================================

describe("math session report", () => {
  it("produces a replay with correct verdict", () => {
    const analysis = analyzePrompt(MATH_PROMPT, MATH_TRANSCRIPT);
    expect(analysis.mode).toBe("math");
    expect(analysis.deterministicPipeline).toBe(true);
    expect(analysis.verdict).toBe("PASS");
    expect(analysis.replayResult).not.toBeNull();
    expect(analysis.replayResult!.satisfiedCount).toBe(3);
    expect(analysis.replayResult!.totalRequired).toBe(3);
  });

  it("renders math-specific turn details in markdown", () => {
    const session = makeSession([{ promptId: "math-q1", turns: MATH_TRANSCRIPT }]);
    const lesson = makeLesson([MATH_PROMPT]);
    const review = buildSessionReview(session, lesson);
    const md = renderSessionReview(review);

    expect(md).toContain("# Session Review Packet");
    expect(md).toContain("| Session ID | session-test-123 |");
    expect(md).toContain("| math-q1 | math | yes | PASS |");
    expect(md).toContain("### Replay Analysis");
    expect(md).toContain("Satisfied steps:");
    expect(md).toContain("Missing steps:");
    expect(md).toContain("Completion:");
    expect(md).toContain("### Final Outcome");
    expect(md).toContain("| Satisfied | 3/3 |");
    expect(md).toContain("| Verdict | **PASS** |");
  });
});

// ============================================================================
// Explanation session report
// ============================================================================

describe("explanation session report", () => {
  it("produces a replay with correct verdict", () => {
    const analysis = analyzePrompt(EXPLANATION_PROMPT, EXPLANATION_TRANSCRIPT);
    expect(analysis.mode).toBe("explanation");
    expect(analysis.deterministicPipeline).toBe(true);
    expect(analysis.verdict).toBe("PASS");
    expect(analysis.replayResult).not.toBeNull();
    expect(analysis.replayResult!.satisfiedCount).toBe(2);
  });

  it("renders explanation-specific turn details in markdown", () => {
    const session = makeSession([{ promptId: "expl-q1", turns: EXPLANATION_TRANSCRIPT }]);
    const lesson = makeLesson([EXPLANATION_PROMPT]);
    const review = buildSessionReview(session, lesson);
    const md = renderSessionReview(review);

    expect(md).toContain("| expl-q1 | explanation | yes | PASS |");
    expect(md).toContain("Entities matched:");
    expect(md).toContain("Pairs extracted:");
    expect(md).toContain("Accumulated:");
    expect(md).toContain("No-progress streak:");
  });
});

// ============================================================================
// Multi-prompt session
// ============================================================================

describe("multi-prompt session", () => {
  it("analyzes all prompts with conversation turns", () => {
    const session = makeSession([
      { promptId: "math-q1", turns: MATH_TRANSCRIPT },
      { promptId: "expl-q1", turns: EXPLANATION_TRANSCRIPT },
    ]);
    const lesson = makeLesson([MATH_PROMPT, EXPLANATION_PROMPT]);
    const review = buildSessionReview(session, lesson);

    expect(review.prompts).toHaveLength(2);
    expect(review.prompts[0].promptId).toBe("math-q1");
    expect(review.prompts[1].promptId).toBe("expl-q1");
  });

  it("renders prompt overview table with both prompts", () => {
    const session = makeSession([
      { promptId: "math-q1", turns: MATH_TRANSCRIPT },
      { promptId: "expl-q1", turns: EXPLANATION_TRANSCRIPT },
    ]);
    const lesson = makeLesson([MATH_PROMPT, EXPLANATION_PROMPT]);
    const review = buildSessionReview(session, lesson);
    const md = renderSessionReview(review);

    expect(md).toContain("## Prompt Overview");
    expect(md).toContain("| math-q1 | math | yes | PASS |");
    expect(md).toContain("| expl-q1 | explanation | yes | PASS |");
    expect(md).toContain("| Prompts included | math-q1, expl-q1 |");
  });

  it("filters by prompt ID when specified", () => {
    const session = makeSession([
      { promptId: "math-q1", turns: MATH_TRANSCRIPT },
      { promptId: "expl-q1", turns: EXPLANATION_TRANSCRIPT },
    ]);
    const lesson = makeLesson([MATH_PROMPT, EXPLANATION_PROMPT]);
    const review = buildSessionReview(session, lesson, "expl-q1");

    expect(review.prompts).toHaveLength(1);
    expect(review.prompts[0].promptId).toBe("expl-q1");
  });
});

// ============================================================================
// Unsupported prompt mode
// ============================================================================

describe("unsupported prompt mode", () => {
  it("sets mode to unsupported and skips replay", () => {
    const turns: TranscriptTurn[] = [
      { role: "coach", message: "Write a story about a cat." },
      { role: "student", message: "Once upon a time there was a cat." },
    ];
    const analysis = analyzePrompt(UNSUPPORTED_PROMPT, turns);

    expect(analysis.mode).toBe("unsupported");
    expect(analysis.deterministicPipeline).toBe(false);
    expect(analysis.replayResult).toBeNull();
    expect(analysis.verdict).toBeNull();
    expect(analysis.issues).toBeNull();
  });

  it("renders unsupported notice in markdown", () => {
    const session = makeSession([{
      promptId: "generic-q1",
      turns: [
        { role: "coach", message: "Write a story." },
        { role: "student", message: "Once upon a time." },
      ],
    }]);
    const lesson = makeLesson([UNSUPPORTED_PROMPT]);
    const review = buildSessionReview(session, lesson);
    const md = renderSessionReview(review);

    expect(md).toContain("| generic-q1 | unsupported | no | — |");
    expect(md).toContain("Deterministic replay not available");
    expect(md).toContain("No deterministic analysis available");
  });
});

// ============================================================================
// Promotion recommendation logic
// ============================================================================

describe("recommendPromotion", () => {
  const threeTurns: TranscriptTurn[] = [
    { role: "coach", message: "Q" },
    { role: "student", message: "A1" },
    { role: "coach", message: "Follow-up" },
    { role: "student", message: "A2" },
    { role: "coach", message: "Follow-up" },
    { role: "student", message: "A3" },
  ];

  const twoTurns: TranscriptTurn[] = [
    { role: "coach", message: "Q" },
    { role: "student", message: "A1" },
    { role: "coach", message: "Follow-up" },
    { role: "student", message: "A2" },
  ];

  const oneTurn: TranscriptTurn[] = [
    { role: "coach", message: "Q" },
    { role: "student", message: "A1" },
  ];

  it("promotes clean PASS with enough substance", () => {
    expect(recommendPromotion("math", "PASS", [], threeTurns, 3)).toBe("Promote to golden fixture");
  });

  it("flags WARN as debugging example", () => {
    expect(recommendPromotion("math", "WARN", [], threeTurns, 3)).toBe("Good debugging example");
  });

  it("flags FAIL as debugging example", () => {
    expect(recommendPromotion("explanation", "FAIL", [], threeTurns, 3)).toBe("Good debugging example");
  });

  it("returns no promotion for unsupported mode", () => {
    expect(recommendPromotion("unsupported", null, null, threeTurns, 0)).toBe("No promotion needed");
  });

  it("returns no promotion for trivial single-turn session", () => {
    expect(recommendPromotion("math", "PASS", [], oneTurn, 1)).toBe("No promotion needed");
  });

  it("returns no promotion for null verdict", () => {
    expect(recommendPromotion("explanation", null, null, threeTurns, 0)).toBe("No promotion needed");
  });

  it("promotes 2-turn PASS when few existing turns", () => {
    // existingTurnCount < 3 means corpus is thin, so promote even 2-turn sessions
    expect(recommendPromotion("math", "PASS", [], twoTurns, 2)).toBe("Promote to golden fixture");
  });

  it("skips promotion for 2-turn PASS when corpus already has 3+ turns", () => {
    expect(recommendPromotion("math", "PASS", [], twoTurns, 3)).toBe("No promotion needed");
  });
});

// ============================================================================
// Session metadata in markdown
// ============================================================================

describe("session metadata rendering", () => {
  it("includes all metadata fields", () => {
    const session = makeSession([{ promptId: "math-q1", turns: MATH_TRANSCRIPT }]);
    const lesson = makeLesson([MATH_PROMPT]);
    const review = buildSessionReview(session, lesson);
    const md = renderSessionReview(review);

    expect(md).toContain("## Session Metadata");
    expect(md).toContain("| Session ID | session-test-123 |");
    expect(md).toContain("| Lesson ID | lesson-test |");
    expect(md).toContain("| Lesson title | Test Lesson |");
    expect(md).toContain("| Student | Test Student |");
    expect(md).toContain("| Generated |");
  });

  it("renders empty session gracefully", () => {
    const session = makeSession([]);
    const lesson = makeLesson([MATH_PROMPT]);
    const review = buildSessionReview(session, lesson);
    const md = renderSessionReview(review);

    expect(md).toContain("## Session Metadata");
    expect(md).toContain("| Prompts included | (none) |");
    expect(md).toContain("No prompts with conversation data found");
  });

  it("includes transcript timestamps when available", () => {
    const turnsWithTs: TranscriptTurn[] = [
      { role: "coach", message: "What is 11 + 14?", timestampSec: 0 },
      { role: "student", message: "1 + 4 = 5", timestampSec: 5 },
    ];
    const session = makeSession([{ promptId: "math-q1", turns: turnsWithTs }]);
    const lesson = makeLesson([MATH_PROMPT]);
    const review = buildSessionReview(session, lesson);
    const md = renderSessionReview(review);

    expect(md).toContain("*(0s)*");
    expect(md).toContain("*(5s)*");
  });
});

// ============================================================================
// Skips prompts with no conversation data
// ============================================================================

describe("skips empty prompts", () => {
  it("ignores prompts without conversation turns", () => {
    const session: SessionFile = {
      id: "session-empty",
      lessonId: "lesson-test",
      submission: {
        responses: [
          { promptId: "math-q1", conversationTurns: [] },
          { promptId: "expl-q1", conversationTurns: EXPLANATION_TRANSCRIPT },
        ],
      },
    };
    const lesson = makeLesson([MATH_PROMPT, EXPLANATION_PROMPT]);
    const review = buildSessionReview(session, lesson);

    expect(review.prompts).toHaveLength(1);
    expect(review.prompts[0].promptId).toBe("expl-q1");
  });
});

// ============================================================================
// Video placeholder transcript detection
// ============================================================================

describe("isPlaceholderTranscript", () => {
  it("detects standard video placeholder", () => {
    const turns: TranscriptTurn[] = [
      { role: "coach", message: "What is 11 + 14?" },
      { role: "student", message: "[Video conversation: 2 coach prompts, 36s duration]" },
    ];
    expect(isPlaceholderTranscript(turns)).toBe(true);
  });

  it("detects empty transcript as placeholder", () => {
    expect(isPlaceholderTranscript([])).toBe(true);
  });

  it("detects transcript with no student turns as placeholder", () => {
    const turns: TranscriptTurn[] = [
      { role: "coach", message: "What is 11 + 14?" },
    ];
    expect(isPlaceholderTranscript(turns)).toBe(true);
  });

  it("does NOT flag real student speech", () => {
    expect(isPlaceholderTranscript(MATH_TRANSCRIPT)).toBe(false);
  });

  it("does NOT flag real explanation speech", () => {
    expect(isPlaceholderTranscript(EXPLANATION_TRANSCRIPT)).toBe(false);
  });
});

describe("placeholder transcript skips replay", () => {
  const PLACEHOLDER_TRANSCRIPT: TranscriptTurn[] = [
    { role: "coach", message: "What is 11 + 14?" },
    { role: "student", message: "[Video conversation: 2 coach prompts, 36s duration]" },
  ];

  it("skips replay for math prompt with placeholder transcript", () => {
    const analysis = analyzePrompt(MATH_PROMPT, PLACEHOLDER_TRANSCRIPT);
    expect(analysis.replayResult).toBeNull();
    expect(analysis.verdict).toBeNull();
    expect(analysis.issues).toBeNull();
    expect(analysis.placeholderSkipped).toBe(true);
  });

  it("skips replay for explanation prompt with placeholder transcript", () => {
    const analysis = analyzePrompt(EXPLANATION_PROMPT, PLACEHOLDER_TRANSCRIPT);
    expect(analysis.replayResult).toBeNull();
    expect(analysis.verdict).toBeNull();
    expect(analysis.placeholderSkipped).toBe(true);
  });

  it("does NOT skip replay for real math transcript", () => {
    const analysis = analyzePrompt(MATH_PROMPT, MATH_TRANSCRIPT);
    expect(analysis.replayResult).not.toBeNull();
    expect(analysis.verdict).toBe("PASS");
    expect(analysis.placeholderSkipped).toBeUndefined();
  });

  it("does NOT skip replay for real explanation transcript", () => {
    const analysis = analyzePrompt(EXPLANATION_PROMPT, EXPLANATION_TRANSCRIPT);
    expect(analysis.replayResult).not.toBeNull();
    expect(analysis.verdict).toBe("PASS");
    expect(analysis.placeholderSkipped).toBeUndefined();
  });

  it("renders placeholder notice in markdown", () => {
    const session = makeSession([{ promptId: "math-q1", turns: PLACEHOLDER_TRANSCRIPT }]);
    const lesson = makeLesson([MATH_PROMPT]);
    const review = buildSessionReview(session, lesson);
    const md = renderSessionReview(review);

    expect(md).toContain("Replay unavailable — video transcript not captured.");
    expect(md).not.toContain("### Turn Details");
    expect(md).not.toContain("Satisfied steps:");
  });

  it("existing PASS/WARN/FAIL logic unchanged for valid transcripts", () => {
    // Math PASS still works
    const mathAnalysis = analyzePrompt(MATH_PROMPT, MATH_TRANSCRIPT);
    expect(mathAnalysis.verdict).toBe("PASS");
    expect(mathAnalysis.replayResult!.satisfiedCount).toBe(3);

    // Explanation PASS still works
    const explAnalysis = analyzePrompt(EXPLANATION_PROMPT, EXPLANATION_TRANSCRIPT);
    expect(explAnalysis.verdict).toBe("PASS");
    expect(explAnalysis.replayResult!.satisfiedCount).toBe(2);
  });
});

// ============================================================================
// Transcript source labeling
// ============================================================================

describe("transcript source", () => {
  it("labels real speech as 'captured speech'", () => {
    const analysis = analyzePrompt(MATH_PROMPT, MATH_TRANSCRIPT);
    expect(analysis.transcriptSource).toBe("captured speech");
  });

  it("labels placeholder as 'placeholder only'", () => {
    const placeholder: TranscriptTurn[] = [
      { role: "coach", message: "What is 11 + 14?" },
      { role: "student", message: "[Video conversation: 2 coach prompts, 36s duration]" },
    ];
    const analysis = analyzePrompt(MATH_PROMPT, placeholder);
    expect(analysis.transcriptSource).toBe("placeholder only");
  });

  it("labels empty transcript as 'unavailable'", () => {
    // analyzePrompt won't normally be called with empty turns (buildSessionReview skips them),
    // but the field should still be set correctly
    const analysis = analyzePrompt(UNSUPPORTED_PROMPT, []);
    expect(analysis.transcriptSource).toBe("unavailable");
  });

  it("renders transcript source in markdown", () => {
    const session = makeSession([{ promptId: "math-q1", turns: MATH_TRANSCRIPT }]);
    const lesson = makeLesson([MATH_PROMPT]);
    const review = buildSessionReview(session, lesson);
    const md = renderSessionReview(review);

    expect(md).toContain("**Transcript source:** captured speech");
  });

  it("renders placeholder source in markdown", () => {
    const placeholder: TranscriptTurn[] = [
      { role: "coach", message: "What is 11 + 14?" },
      { role: "student", message: "[Video conversation: 3 coach prompts, 45s duration]" },
    ];
    const session = makeSession([{ promptId: "math-q1", turns: placeholder }]);
    const lesson = makeLesson([MATH_PROMPT]);
    const review = buildSessionReview(session, lesson);
    const md = renderSessionReview(review);

    expect(md).toContain("**Transcript source:** placeholder only");
  });

  it("unsupported mode still gets transcript source", () => {
    const turns: TranscriptTurn[] = [
      { role: "coach", message: "Write a story." },
      { role: "student", message: "Once upon a time." },
    ];
    const analysis = analyzePrompt(UNSUPPORTED_PROMPT, turns);
    expect(analysis.transcriptSource).toBe("captured speech");
  });
});

// ============================================================================
// Mixed old/new session formats
// ============================================================================

describe("backward compatibility with old sessions", () => {
  it("old session without conversationTurns still loads (empty turns skipped)", () => {
    const session: SessionFile = {
      id: "old-session",
      lessonId: "lesson-test",
      submission: {
        responses: [
          { promptId: "math-q1" },  // no conversationTurns field at all
        ],
      },
    };
    const lesson = makeLesson([MATH_PROMPT]);
    const review = buildSessionReview(session, lesson);
    // Should produce no prompts (empty turns are skipped)
    expect(review.prompts).toHaveLength(0);
  });

  it("mixed session: one prompt with real turns, one with placeholder", () => {
    const placeholder: TranscriptTurn[] = [
      { role: "coach", message: "Write a story." },
      { role: "student", message: "[Video conversation: 1 coach prompts, 20s duration]" },
    ];
    const session = makeSession([
      { promptId: "math-q1", turns: MATH_TRANSCRIPT },
      { promptId: "expl-q1", turns: placeholder },
    ]);
    const lesson = makeLesson([MATH_PROMPT, EXPLANATION_PROMPT]);
    const review = buildSessionReview(session, lesson);

    expect(review.prompts).toHaveLength(2);
    // First prompt: real transcript → full replay
    expect(review.prompts[0].transcriptSource).toBe("captured speech");
    expect(review.prompts[0].replayResult).not.toBeNull();
    expect(review.prompts[0].verdict).toBe("PASS");
    // Second prompt: placeholder → skipped
    expect(review.prompts[1].transcriptSource).toBe("placeholder only");
    expect(review.prompts[1].replayResult).toBeNull();
    expect(review.prompts[1].placeholderSkipped).toBe(true);
  });
});

// ============================================================================
// Replay fidelity comparison
// ============================================================================

describe("compareReplayToLive", () => {
  // Build a mock ReplayResult with a given summaryStatus
  function mockReplayResult(summaryStatus: string): any {
    return { summaryStatus, satisfiedCount: 3, totalRequired: 3, turns: [] };
  }

  it("returns 'Replay unavailable' when no replay result", () => {
    expect(compareReplayToLive(null, { liveScore: 80 })).toBe("Replay unavailable");
  });

  it("returns 'Replay unavailable' when no live outcome", () => {
    expect(compareReplayToLive(mockReplayResult("mastery"), null)).toBe("Replay unavailable");
  });

  it("returns 'Replay unavailable' when live outcome has no data", () => {
    expect(compareReplayToLive(mockReplayResult("mastery"), {})).toBe("Replay unavailable");
  });

  it("matches when replay=mastery and live score ≥ 70", () => {
    expect(compareReplayToLive(mockReplayResult("mastery"), { liveScore: 85 }))
      .toBe("Replay matches live outcome");
  });

  it("matches when replay=needs_support and live score < 70", () => {
    expect(compareReplayToLive(mockReplayResult("needs_support"), { liveScore: 40 }))
      .toBe("Replay matches live outcome");
  });

  it("differs when replay=mastery but live score < 70", () => {
    expect(compareReplayToLive(mockReplayResult("mastery"), { liveScore: 50 }))
      .toBe("Replay differs from live outcome");
  });

  it("differs when replay=needs_support but live score ≥ 70", () => {
    expect(compareReplayToLive(mockReplayResult("needs_support"), { liveScore: 80 }))
      .toBe("Replay differs from live outcome");
  });

  it("matches when replay=needs_support and deferredByCoach", () => {
    expect(compareReplayToLive(mockReplayResult("needs_support"), { deferredByCoach: true }))
      .toBe("Replay matches live outcome");
  });

  it("differs when replay=mastery but deferredByCoach", () => {
    expect(compareReplayToLive(mockReplayResult("mastery"), { deferredByCoach: true }))
      .toBe("Replay differs from live outcome");
  });

  it("deferredByCoach takes precedence over high score", () => {
    // Deferred = needs_support, even if score was 90
    expect(compareReplayToLive(mockReplayResult("mastery"), { liveScore: 90, deferredByCoach: true }))
      .toBe("Replay differs from live outcome");
  });
});

describe("replay fidelity in analyzePrompt", () => {
  it("shows 'Replay matches' when live score aligns with replay mastery", () => {
    const analysis = analyzePrompt(MATH_PROMPT, MATH_TRANSCRIPT, { liveScore: 85 });
    expect(analysis.replayFidelity).toBe("Replay matches live outcome");
  });

  it("shows 'Replay unavailable' when no live outcome provided", () => {
    const analysis = analyzePrompt(MATH_PROMPT, MATH_TRANSCRIPT);
    expect(analysis.replayFidelity).toBe("Replay unavailable");
  });

  it("shows 'Replay unavailable' for placeholder transcript", () => {
    const placeholder: TranscriptTurn[] = [
      { role: "coach", message: "What is 11 + 14?" },
      { role: "student", message: "[Video conversation: 2 coach prompts, 36s duration]" },
    ];
    const analysis = analyzePrompt(MATH_PROMPT, placeholder, { liveScore: 85 });
    expect(analysis.replayFidelity).toBe("Replay unavailable");
  });

  it("shows 'Replay unavailable' for unsupported mode", () => {
    const turns: TranscriptTurn[] = [
      { role: "coach", message: "Write a story." },
      { role: "student", message: "Once upon a time." },
    ];
    const analysis = analyzePrompt(UNSUPPORTED_PROMPT, turns, { liveScore: 85 });
    expect(analysis.replayFidelity).toBe("Replay unavailable");
  });
});

describe("replay fidelity in markdown", () => {
  it("renders fidelity label in markdown", () => {
    const session: SessionFile = {
      id: "session-test-123",
      lessonId: "lesson-test",
      lessonTitle: "Test Lesson",
      studentName: "Test Student",
      submission: {
        responses: [{
          promptId: "math-q1",
          conversationTurns: MATH_TRANSCRIPT,
        }],
      },
      evaluation: {
        totalScore: 85,
        criteriaScores: [{ criterionId: "math-q1", score: 85 }],
      },
    };
    const lesson = makeLesson([MATH_PROMPT]);
    const review = buildSessionReview(session, lesson);
    const md = renderSessionReview(review);

    expect(md).toContain("**Replay fidelity:** Replay matches live outcome");
  });

  it("renders 'Replay unavailable' when no evaluation", () => {
    const session = makeSession([{ promptId: "math-q1", turns: MATH_TRANSCRIPT }]);
    const lesson = makeLesson([MATH_PROMPT]);
    const review = buildSessionReview(session, lesson);
    const md = renderSessionReview(review);

    expect(md).toContain("**Replay fidelity:** Replay unavailable");
  });

  it("renders 'differs' when live and replay disagree", () => {
    const session: SessionFile = {
      id: "session-test-123",
      lessonId: "lesson-test",
      lessonTitle: "Test Lesson",
      studentName: "Test Student",
      submission: {
        responses: [{
          promptId: "math-q1",
          conversationTurns: MATH_TRANSCRIPT,
        }],
      },
      evaluation: {
        totalScore: 40,
        criteriaScores: [{ criterionId: "math-q1", score: 40 }],
      },
    };
    const lesson = makeLesson([MATH_PROMPT]);
    const review = buildSessionReview(session, lesson);
    const md = renderSessionReview(review);

    // Replay says mastery (all 3 steps satisfied), but live score is 40 → differs
    expect(md).toContain("**Replay fidelity:** Replay differs from live outcome");
  });
});

// ============================================================================
// buildStudentJourneySummary
// ============================================================================

describe("buildStudentJourneySummary", () => {
  /** Helper to build a minimal PromptAnalysis with replay turns. */
  function makeAnalysis(
    turns: Array<{ state: string; wrapAction: string; target?: string | null }>,
    opts: {
      summaryStatus?: string;
      satisfiedCount?: number;
      totalRequired?: number;
      placeholderSkipped?: boolean;
      replayResult?: boolean;
    } = {},
  ): PromptAnalysis {
    const replayTurns = turns.map((t, i) => ({
      turnNum: i + 1,
      studentMessage: `turn ${i + 1}`,
      state: t.state,
      moveType: "STEP_PROBE_DIRECT",
      responseText: "ok",
      words: 1,
      target: t.target ?? null,
      wrapAction: t.wrapAction,
    }));

    return {
      promptId: "q1",
      promptText: "What is 20 + 42?",
      mode: "math",
      deterministicPipeline: true,
      turns: [],
      replayResult: opts.replayResult === false ? null : {
        fixture: {} as any,
        fixtureName: "test",
        turns: replayTurns,
        summaryStatus: opts.summaryStatus ?? "needs_support",
        summaryRendered: "",
        summaryObservations: [],
        coachTexts: [],
        hasEvidence: true,
        satisfiedCount: opts.satisfiedCount ?? 0,
        totalRequired: opts.totalRequired ?? 3,
      },
      issues: null,
      verdict: null,
      promotion: "No promotion needed",
      transcriptSource: "captured speech",
      replayFidelity: "Replay unavailable",
      journeySummary: "",
      placeholderSkipped: opts.placeholderSkipped,
    };
  }

  it("returns 'Solved independently' for 1-turn mastery", () => {
    const a = makeAnalysis(
      [{ state: "correct", wrapAction: "wrap_mastery" }],
      { summaryStatus: "mastery" },
    );
    expect(buildStudentJourneySummary(a)).toBe("Solved independently");
  });

  it("returns 'Solved with minimal guidance' for 2-turn clean mastery", () => {
    const a = makeAnalysis(
      [
        { state: "partial", wrapAction: "continue", target: "s1" },
        { state: "correct", wrapAction: "wrap_mastery" },
      ],
      { summaryStatus: "mastery", satisfiedCount: 3, totalRequired: 3 },
    );
    expect(buildStudentJourneySummary(a)).toBe("Solved with minimal guidance");
  });

  it("returns 'Needed a nudge, then succeeded' for quick success with uncertainty", () => {
    const a = makeAnalysis(
      [
        { state: "uncertain", wrapAction: "continue", target: "s1" },
        { state: "partial", wrapAction: "continue", target: "s2" },
        { state: "correct", wrapAction: "wrap_mastery" },
      ],
      { summaryStatus: "mastery", satisfiedCount: 3, totalRequired: 3 },
    );
    expect(buildStudentJourneySummary(a)).toBe("Needed a nudge, then succeeded");
  });

  it("returns 'Needed help to get started, then succeeded' for longer uncertain start", () => {
    const a = makeAnalysis(
      [
        { state: "uncertain", wrapAction: "continue", target: "s1" },
        { state: "uncertain", wrapAction: "continue", target: "s1" },
        { state: "partial", wrapAction: "continue", target: "s1" },
        { state: "partial", wrapAction: "continue", target: "s2" },
        { state: "correct", wrapAction: "wrap_mastery" },
      ],
      { summaryStatus: "mastery", satisfiedCount: 3, totalRequired: 3 },
    );
    expect(buildStudentJourneySummary(a)).toBe("Needed help to get started, then succeeded");
  });

  it("returns 'Overcame a misconception, then succeeded' for single misconception + mastery", () => {
    const a = makeAnalysis(
      [
        { state: "misconception", wrapAction: "continue", target: "s1" },
        { state: "partial", wrapAction: "continue", target: "s1" },
        { state: "partial", wrapAction: "continue", target: "s2" },
        { state: "correct", wrapAction: "wrap_mastery" },
      ],
      { summaryStatus: "mastery", satisfiedCount: 3, totalRequired: 3 },
    );
    expect(buildStudentJourneySummary(a)).toBe("Overcame a misconception, then succeeded");
  });

  it("returns 'Multiple misconceptions, but reached mastery' for repeated misconceptions + mastery", () => {
    const a = makeAnalysis(
      [
        { state: "misconception", wrapAction: "continue", target: "s1" },
        { state: "misconception", wrapAction: "continue", target: "s1" },
        { state: "partial", wrapAction: "continue", target: "s2" },
        { state: "correct", wrapAction: "wrap_mastery" },
      ],
      { summaryStatus: "mastery", satisfiedCount: 3, totalRequired: 3 },
    );
    expect(buildStudentJourneySummary(a)).toBe("Multiple misconceptions, but reached mastery");
  });

  it("returns 'Wrong answer initially, then self-corrected' for wrong + mastery", () => {
    const a = makeAnalysis(
      [
        { state: "wrong", wrapAction: "continue", target: "s1" },
        { state: "partial", wrapAction: "continue", target: "s1" },
        { state: "partial", wrapAction: "continue", target: "s2" },
        { state: "correct", wrapAction: "wrap_mastery" },
      ],
      { summaryStatus: "mastery", satisfiedCount: 3, totalRequired: 3 },
    );
    expect(buildStudentJourneySummary(a)).toBe("Wrong answer initially, then self-corrected");
  });

  it("returns 'Struggled with ones_sum' for misconception on a single step", () => {
    const a = makeAnalysis(
      [
        { state: "misconception", wrapAction: "continue", target: "ones_sum" },
        { state: "misconception", wrapAction: "continue", target: "ones_sum" },
        { state: "partial", wrapAction: "wrap_needs_support", target: "ones_sum" },
      ],
      { satisfiedCount: 1, totalRequired: 3 },
    );
    expect(buildStudentJourneySummary(a)).toBe("Struggled with ones sum");
  });

  it("returns 'Struggled throughout, no progress' for extended uncertain", () => {
    const a = makeAnalysis(
      [
        { state: "uncertain", wrapAction: "continue", target: "s1" },
        { state: "uncertain", wrapAction: "continue", target: "s1" },
        { state: "uncertain", wrapAction: "wrap_needs_support", target: "s1" },
      ],
      { satisfiedCount: 0, totalRequired: 3 },
    );
    expect(buildStudentJourneySummary(a)).toBe("Struggled throughout, no progress");
  });

  it("returns 'Multiple attempts, improving' for partial progress ≥ 50%", () => {
    const a = makeAnalysis(
      [
        { state: "partial", wrapAction: "continue", target: "s1" },
        { state: "partial", wrapAction: "continue", target: "s2" },
        { state: "partial", wrapAction: "wrap_needs_support", target: "s3" },
      ],
      { satisfiedCount: 2, totalRequired: 3 },
    );
    expect(buildStudentJourneySummary(a)).toBe("Multiple attempts, improving");
  });

  it("returns 'No replay data' when replayResult is null", () => {
    const a = makeAnalysis([], { replayResult: false });
    expect(buildStudentJourneySummary(a)).toBe("No replay data");
  });

  it("returns 'Replay unavailable' for placeholder transcript", () => {
    const a = makeAnalysis([], { placeholderSkipped: true, replayResult: false });
    expect(buildStudentJourneySummary(a)).toBe("Replay unavailable");
  });

  it("journey summary appears in markdown output", () => {
    const session: SessionFile = {
      id: "session-journey",
      lessonId: "lesson-test",
      submission: {
        responses: [{
          promptId: "math-q1",
          conversationTurns: MATH_TRANSCRIPT,
        }],
      },
    };
    const lesson = makeLesson([MATH_PROMPT]);
    const review = buildSessionReview(session, lesson);
    const md = renderSessionReview(review);
    expect(md).toContain("**Journey:**");
  });

  it("journey summary is populated on analyzePrompt result", () => {
    const result = analyzePrompt(MATH_PROMPT, MATH_TRANSCRIPT);
    expect(result.journeySummary).toBeTruthy();
    expect(typeof result.journeySummary).toBe("string");
  });
});
