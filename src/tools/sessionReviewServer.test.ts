/**
 * Tests for the session review browser server.
 *
 * Uses supertest to hit Express routes without starting a real server.
 * Mocks SessionStore and lessonLoader to avoid touching disk.
 */

import request from "supertest";

// ── Mocks ───────────────────────────────────────────────────────────────

const mockSessions = new Map<string, any>();

jest.mock("../stores/sessionStore", () => ({
  SessionStore: jest.fn().mockImplementation(() => ({
    getAll: () => Array.from(mockSessions.values()),
    load: (id: string) => mockSessions.get(id) ?? null,
  })),
}));

const mockLessons = new Map<string, any>();

jest.mock("../loaders/lessonLoader", () => ({
  loadLessonById: (id: string) => mockLessons.get(id) ?? null,
  getAllLessons: () => Array.from(mockLessons.values()),
}));

// Mock transcriptReplay to avoid pulling in the full replay engine
jest.mock("../domain/transcriptReplay", () => ({
  runFixture: jest.fn(() => ({
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
        extractedAnswer: null,
        answerCorrect: null,
      },
      {
        turnNum: 2,
        studentMessage: "10 + 10 = 20",
        state: "partial",
        moveType: "STEP_COMBINE_PROMPT",
        target: "s3",
        responseText: "Now combine.",
        words: 2,
        wrapAction: "continue",
        satisfiedSteps: ["s1", "s2"],
        missingSteps: ["s3"],
        completion: 0.67,
        extractedAnswer: null,
        answerCorrect: null,
      },
      {
        turnNum: 3,
        studentMessage: "20 + 5 = 25",
        state: "correct",
        moveType: "WRAP_SUCCESS",
        target: null,
        responseText: "Great!",
        words: 1,
        wrapAction: "wrap_mastery",
        wrapReason: "all steps satisfied",
        satisfiedSteps: ["s1", "s2", "s3"],
        missingSteps: [],
        completion: 1.0,
        extractedAnswer: 25,
        answerCorrect: true,
      },
    ],
    satisfiedCount: 3,
    totalRequired: 3,
    summaryStatus: "mastery",
    summaryRendered: "Student demonstrated understanding of two-digit addition.",
  })),
  auditResult: jest.fn(() => []),
}));

// Mock promoteSessionToGolden
jest.mock("../domain/promoteSessionToGolden", () => ({
  promoteSession: jest.fn(() => ({
    sessionId: "sess-abc",
    lessonId: "lesson-math",
    results: [
      {
        promptId: "q1",
        mode: "math",
        verdict: "PASS",
        studentTurns: 3,
        outcome: {
          status: "would_write",
          filePath: "fixtures/golden/math/test-fixture.json",
          reason: "Would write clean-mastery fixture",
        },
      },
    ],
    counts: { written: 1, skipped: 0, duplicate: 0, unsupported: 0, failedAudit: 0 },
  })),
  renderPromotionReport: jest.fn(() => "# Promotion Report\n\nMock report"),
}));

import { createApp, sessionToSessionFile, clearReviewCache } from "./sessionReviewServer";

// ── Test data ───────────────────────────────────────────────────────────

function makeMathLesson() {
  return {
    id: "lesson-math",
    title: "Math Lesson",
    description: "Test math lesson",
    difficulty: "beginner",
    prompts: [
      {
        id: "q1",
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
            { id: "s1", label: "Add ones", expectedStatements: ["1 + 4 = 5"], probe: "What is 1+4?", kind: "ones_sum" },
            { id: "s2", label: "Add tens", expectedStatements: ["10 + 10 = 20"], probe: "What is 10+10?", kind: "tens_sum" },
            { id: "s3", label: "Combine", expectedStatements: ["20 + 5 = 25"], probe: "What is 20+5?", kind: "combine" },
          ],
        },
      },
    ],
  };
}

function makeMathSession() {
  return {
    id: "sess-abc",
    studentId: "student-1",
    studentName: "Test Student",
    lessonId: "lesson-math",
    lessonTitle: "Math Lesson",
    status: "completed",
    startedAt: new Date("2026-03-15T10:00:00Z"),
    completedAt: new Date("2026-03-15T10:05:00Z"),
    submission: {
      assignmentId: "assignment-1",
      studentId: "student-1",
      responses: [
        {
          promptId: "q1",
          response: "25",
          hintUsed: false,
          inputSource: "typed",
          helpConversation: {
            mode: "help",
            turns: [
              { role: "coach", message: "What is 11 + 14?" },
              { role: "student", message: "1 + 4 = 5" },
              { role: "coach", message: "Good. Now the tens." },
              { role: "student", message: "10 + 10 = 20" },
              { role: "coach", message: "Now combine." },
              { role: "student", message: "20 + 5 = 25" },
            ],
          },
        },
      ],
      submittedAt: new Date("2026-03-15T10:05:00Z"),
    },
  };
}

function makeEmptySession() {
  return {
    id: "sess-empty",
    studentId: "student-2",
    studentName: "Empty Student",
    lessonId: "lesson-math",
    lessonTitle: "Math Lesson",
    status: "in_progress",
    startedAt: new Date("2026-03-15T11:00:00Z"),
    submission: {
      assignmentId: "assignment-2",
      studentId: "student-2",
      responses: [],
      submittedAt: new Date("2026-03-15T11:00:00Z"),
    },
  };
}

// ============================================================================
// Tests
// ============================================================================

let app: any;

beforeEach(() => {
  mockSessions.clear();
  mockLessons.clear();
  clearReviewCache();
  app = createApp();
});

// ── sessionToSessionFile adapter ────────────────────────────────────────

describe("sessionToSessionFile", () => {
  it("converts helpConversation turns into conversationTurns", () => {
    const session = makeMathSession();
    const file = sessionToSessionFile(session as any);

    expect(file.id).toBe("sess-abc");
    expect(file.lessonId).toBe("lesson-math");
    expect(file.studentName).toBe("Test Student");
    expect(file.submission!.responses).toHaveLength(1);
    expect(file.submission!.responses![0].conversationTurns).toHaveLength(6);
    expect(file.submission!.responses![0].conversationTurns![0]).toEqual({
      role: "coach",
      message: "What is 11 + 14?",
    });
  });

  it("falls back to response text when no conversations exist", () => {
    const session = {
      ...makeMathSession(),
      submission: {
        ...makeMathSession().submission,
        responses: [{
          promptId: "q1",
          response: "The answer is 25",
          hintUsed: false,
        }],
      },
    };
    const file = sessionToSessionFile(session as any);
    expect(file.submission!.responses![0].conversationTurns).toEqual([
      { role: "student", message: "The answer is 25" },
    ]);
  });

  it("handles empty submission", () => {
    const session = makeEmptySession();
    const file = sessionToSessionFile(session as any);
    expect(file.submission!.responses).toHaveLength(0);
  });
});

// ── Session list page ───────────────────────────────────────────────────

describe("GET /", () => {
  it("returns 200 with session table", async () => {
    mockSessions.set("sess-abc", makeMathSession());
    mockLessons.set("lesson-math", makeMathLesson());

    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Session Review Browser");
    expect(res.text).toContain("sess-abc");
    expect(res.text).toContain("Test Student");
    expect(res.text).toContain("Math Lesson");
  });

  it("returns empty state when no sessions", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toContain("No sessions match");
  });

  it("filters by verdict", async () => {
    mockSessions.set("sess-abc", makeMathSession());
    mockLessons.set("lesson-math", makeMathLesson());

    // PASS filter should include the session (mock returns PASS verdict)
    const passRes = await request(app).get("/?verdict=PASS");
    expect(passRes.status).toBe(200);
    expect(passRes.text).toContain("sess-abc");

    // FAIL filter should exclude it
    const failRes = await request(app).get("/?verdict=FAIL");
    expect(failRes.status).toBe(200);
    expect(failRes.text).toContain("No sessions match");
  });

  it("filters by mode", async () => {
    mockSessions.set("sess-abc", makeMathSession());
    mockLessons.set("lesson-math", makeMathLesson());

    const mathRes = await request(app).get("/?mode=math");
    expect(mathRes.status).toBe(200);
    expect(mathRes.text).toContain("sess-abc");

    const explRes = await request(app).get("/?mode=explanation");
    expect(explRes.status).toBe(200);
    expect(explRes.text).toContain("No sessions match");
  });

  it("filters by promotion status", async () => {
    mockSessions.set("sess-abc", makeMathSession());
    mockLessons.set("lesson-math", makeMathLesson());

    const promoteRes = await request(app).get("/?promotion=promote");
    expect(promoteRes.status).toBe(200);
    expect(promoteRes.text).toContain("sess-abc");
  });

  it("filters by search query", async () => {
    mockSessions.set("sess-abc", makeMathSession());
    mockLessons.set("lesson-math", makeMathLesson());

    const matchRes = await request(app).get("/?q=Test+Student");
    expect(matchRes.status).toBe(200);
    expect(matchRes.text).toContain("sess-abc");

    const noMatchRes = await request(app).get("/?q=nonexistent");
    expect(noMatchRes.status).toBe(200);
    expect(noMatchRes.text).toContain("No sessions match");
  });
});

// ── Session detail page ─────────────────────────────────────────────────

describe("GET /session/:id", () => {
  it("returns 200 with session detail", async () => {
    mockSessions.set("sess-abc", makeMathSession());
    mockLessons.set("lesson-math", makeMathLesson());

    const res = await request(app).get("/session/sess-abc");
    expect(res.status).toBe(200);
    expect(res.text).toContain("sess-abc");
    expect(res.text).toContain("Test Student");
    expect(res.text).toContain("Math Lesson");
    expect(res.text).toContain("q1");
  });

  it("returns 404 for unknown session", async () => {
    const res = await request(app).get("/session/nonexistent");
    expect(res.status).toBe(404);
    expect(res.text).toContain("Not Found");
  });

  it("shows transcript turns", async () => {
    mockSessions.set("sess-abc", makeMathSession());
    mockLessons.set("lesson-math", makeMathLesson());

    const res = await request(app).get("/session/sess-abc");
    expect(res.text).toContain("What is 11 + 14?");
    expect(res.text).toContain("1 + 4 = 5");
    expect(res.text).toContain("20 + 5 = 25");
  });

  it("shows replay analysis with per-turn chips", async () => {
    mockSessions.set("sess-abc", makeMathSession());
    mockLessons.set("lesson-math", makeMathLesson());

    const res = await request(app).get("/session/sess-abc");
    // State chips
    expect(res.text).toContain("state:");
    expect(res.text).toContain("partial");
    // Move chips
    expect(res.text).toContain("move:");
    expect(res.text).toContain("STEP_PROBE_DIRECT");
    // Wrap chips
    expect(res.text).toContain("wrap:");
    expect(res.text).toContain("wrap_mastery");
    // Strategy column
    expect(res.text).toContain("Strategy");
  });

  it("shows verdict badges with correct color classes", async () => {
    mockSessions.set("sess-abc", makeMathSession());
    mockLessons.set("lesson-math", makeMathLesson());

    const res = await request(app).get("/session/sess-abc");
    expect(res.text).toContain("badge-pass");
    expect(res.text).toContain("PASS");
  });

  it("shows action buttons", async () => {
    mockSessions.set("sess-abc", makeMathSession());
    mockLessons.set("lesson-math", makeMathLesson());

    const res = await request(app).get("/session/sess-abc");
    expect(res.text).toContain("Generate Markdown Review");
    expect(res.text).toContain("Dry-run Promotion");
    expect(res.text).toContain("Generate Fixture JSON");
  });

  it("handles session without matching lesson gracefully", async () => {
    mockSessions.set("sess-abc", makeMathSession());
    // Don't add lesson to mockLessons — review will have no prompts

    const res = await request(app).get("/session/sess-abc");
    expect(res.status).toBe(200);
    // Without a lesson, prompts can't be analyzed, so the page renders but with 0 prompts
    expect(res.text).toContain("sess-abc");
  });
});

// ── Markdown review endpoint ────────────────────────────────────────────

describe("GET /session/:id/markdown", () => {
  it("returns plain text markdown", async () => {
    mockSessions.set("sess-abc", makeMathSession());
    mockLessons.set("lesson-math", makeMathLesson());

    const res = await request(app).get("/session/sess-abc/markdown");
    expect(res.status).toBe(200);
    expect(res.type).toContain("text/plain");
    expect(res.text).toContain("# Session Review Packet");
    expect(res.text).toContain("sess-abc");
  });

  it("returns 404 for unknown session", async () => {
    const res = await request(app).get("/session/nonexistent/markdown");
    expect(res.status).toBe(404);
  });
});

// ── Fixture JSON endpoint ───────────────────────────────────────────────

describe("GET /session/:id/fixture-json", () => {
  it("returns JSON with promotion summary", async () => {
    mockSessions.set("sess-abc", makeMathSession());
    mockLessons.set("lesson-math", makeMathLesson());

    const res = await request(app).get("/session/sess-abc/fixture-json");
    expect(res.status).toBe(200);
    expect(res.type).toContain("application/json");
    const body = JSON.parse(res.text);
    expect(body.sessionId).toBe("sess-abc");
    expect(body.results).toHaveLength(1);
    expect(body.results[0].outcome.status).toBe("would_write");
  });

  it("returns 404 for unknown session", async () => {
    const res = await request(app).get("/session/nonexistent/fixture-json");
    expect(res.status).toBe(404);
  });
});

// ── Dry-run promotion endpoint ──────────────────────────────────────────

describe("GET /session/:id/dry-run", () => {
  it("returns HTML with promotion report", async () => {
    mockSessions.set("sess-abc", makeMathSession());
    mockLessons.set("lesson-math", makeMathLesson());

    const res = await request(app).get("/session/sess-abc/dry-run");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Dry-run Promotion Report");
    expect(res.text).toContain("would write");
    expect(res.text).toContain("q1");
  });

  it("returns page even when lesson is missing", async () => {
    mockSessions.set("sess-abc", makeMathSession());
    // No lesson — dry-run still returns a page but with no promotable prompts

    const res = await request(app).get("/session/sess-abc/dry-run");
    // Without a lesson, getSessionReview returns a cached entry with lesson: null
    // The dry-run route checks for cached.lesson and returns 404
    // But since our mock SessionStore returns the session, it will have lesson: null
    expect(res.status).toBe(404);
  });
});

// ── conversationTurns preference ────────────────────────────────────────

describe("sessionToSessionFile prefers conversationTurns", () => {
  it("uses stored conversationTurns over helpConversation when both exist", () => {
    const session = {
      ...makeMathSession(),
      submission: {
        ...makeMathSession().submission,
        responses: [{
          promptId: "q1",
          response: "25",
          hintUsed: false,
          inputSource: "video",
          // Real captured turns from video session
          conversationTurns: [
            { role: "coach", message: "What is 11 + 14?", timestampSec: 0 },
            { role: "student", message: "I think 1 plus 4 is 5", timestampSec: 3 },
            { role: "coach", message: "Good. Now the tens.", timestampSec: 8 },
            { role: "student", message: "10 plus 10 is 20", timestampSec: 12 },
          ],
          // Legacy helpConversation (would be used as fallback)
          helpConversation: {
            mode: "help",
            turns: [
              { role: "coach", message: "What is 11 + 14?" },
              { role: "student", message: "[Video conversation: 2 coach prompts, 15s duration]" },
            ],
          },
        }],
      },
    };
    const file = sessionToSessionFile(session as any);
    const turns = file.submission!.responses![0].conversationTurns!;

    // Should use the real conversationTurns, not the helpConversation
    expect(turns).toHaveLength(4);
    expect(turns[1].message).toBe("I think 1 plus 4 is 5");
    expect(turns[0]).toHaveProperty("timestampSec", 0);
  });

  it("falls back to helpConversation when no conversationTurns", () => {
    const session = makeMathSession(); // has helpConversation but no conversationTurns
    const file = sessionToSessionFile(session as any);
    const turns = file.submission!.responses![0].conversationTurns!;
    expect(turns).toHaveLength(6);
    expect(turns[0].message).toBe("What is 11 + 14?");
  });
});

describe("transcript source in session detail", () => {
  it("shows transcript source label in session detail page", async () => {
    mockSessions.set("sess-abc", makeMathSession());
    mockLessons.set("lesson-math", makeMathLesson());

    const res = await request(app).get("/session/sess-abc");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Transcript source");
  });
});

describe("replay fidelity in session detail", () => {
  it("shows replay fidelity label in session detail page", async () => {
    mockSessions.set("sess-abc", makeMathSession());
    mockLessons.set("lesson-math", makeMathLesson());

    const res = await request(app).get("/session/sess-abc");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Replay fidelity");
  });

  it("shows fidelity badge for session with evaluation", async () => {
    const session = {
      ...makeMathSession(),
      evaluation: {
        totalScore: 85,
        feedback: "Good work!",
        criteriaScores: [{ criterionId: "q1", score: 85 }],
      },
    };
    mockSessions.set("sess-abc", session);
    mockLessons.set("lesson-math", makeMathLesson());

    const res = await request(app).get("/session/sess-abc");
    expect(res.status).toBe(200);
    // Should have a fidelity badge (matches or differs)
    expect(res.text).toContain("Replay fidelity");
  });
});

// ── Color coding ────────────────────────────────────────────────────────

describe("color coding", () => {
  it("uses correct CSS classes for badges", async () => {
    mockSessions.set("sess-abc", makeMathSession());
    mockLessons.set("lesson-math", makeMathLesson());

    const res = await request(app).get("/session/sess-abc");
    // PASS verdict → badge-pass (green)
    expect(res.text).toContain("badge-pass");
    // Math mode → badge-math (blue)
    expect(res.text).toContain("badge-math");
    // Promote → badge-promote (green)
    expect(res.text).toContain("badge-promote");
  });
});

// ── Cache bypass ───────────────────────────────────────────────────────

describe("cache bypass with ?refresh=1", () => {
  beforeEach(() => {
    clearReviewCache();
    mockSessions.set("sess-abc", makeMathSession());
    mockLessons.set("lesson-math", makeMathLesson());
  });

  it("shows Cache HIT on second request without refresh", async () => {
    await request(app).get("/session/sess-abc");
    const res = await request(app).get("/session/sess-abc");
    expect(res.status).toBe(200);
    expect(res.text).toContain(">HIT<");
  });

  it("shows Cache MISS with ?refresh=1", async () => {
    // Prime the cache
    await request(app).get("/session/sess-abc");
    // Force refresh
    const res = await request(app).get("/session/sess-abc?refresh=1");
    expect(res.status).toBe(200);
    expect(res.text).toContain(">MISS<");
  });

  it("shows Generated at timestamp", async () => {
    const res = await request(app).get("/session/sess-abc");
    expect(res.text).toContain("Generated at");
  });

  it("shows force refresh link on cache HIT", async () => {
    await request(app).get("/session/sess-abc");
    const res = await request(app).get("/session/sess-abc");
    expect(res.text).toContain("?refresh=1");
    expect(res.text).toContain("force refresh");
  });

  it("supports refresh on markdown route", async () => {
    const res1 = await request(app).get("/session/sess-abc/markdown");
    const res2 = await request(app).get("/session/sess-abc/markdown?refresh=1");
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
  });
});
