/**
 * Tests for the stress test browser routes in sessionReviewServer.
 *
 * Uses supertest to hit Express routes without starting a real server.
 * Mocks SessionStore, lessonLoader, transcriptReplay, and lessonStressTest
 * to avoid touching disk or running real replay.
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

// Mock transcriptReplay
const mockRunFixture = jest.fn();
const mockAuditResult = jest.fn();

jest.mock("../domain/transcriptReplay", () => ({
  runFixture: (...args: any[]) => mockRunFixture(...args),
  auditResult: (...args: any[]) => mockAuditResult(...args),
  renderMarkdownReport: jest.fn(() => "# Mock Report"),
}));

// Mock generateSessionReview (used by session review routes)
jest.mock("../domain/generateSessionReview", () => ({
  buildSessionReview: jest.fn(() => ({
    sessionId: "test",
    lessonId: "test",
    lessonTitle: null,
    studentName: null,
    timestamp: new Date().toISOString(),
    prompts: [],
  })),
  renderSessionReview: jest.fn(() => "# Mock Review"),
}));

// Mock promoteSessionToGolden
jest.mock("../domain/promoteSessionToGolden", () => ({
  promoteSession: jest.fn(() => ({
    sessionId: "test",
    lessonId: "test",
    results: [],
    counts: { written: 0, skipped: 0, duplicate: 0, unsupported: 0, failedAudit: 0 },
  })),
  renderPromotionReport: jest.fn(() => "# Mock Promotion"),
}));

import { createApp, clearReviewCache } from "./sessionReviewServer";

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
      {
        id: "q2",
        type: "explain",
        input: "Write a story about a cat.",
        // No mathProblem or requiredEvidence — unsupported
      },
    ],
  };
}

function makeExplanationLesson() {
  return {
    id: "lesson-expl",
    title: "Science Lesson",
    description: "Test explanation lesson",
    difficulty: "beginner",
    prompts: [
      {
        id: "expl-q1",
        type: "explain",
        input: "What are planets made of?",
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
      },
    ],
  };
}

function setupDefaultMocks() {
  mockRunFixture.mockReturnValue({
    fixture: { mode: "math", transcript: [
      { role: "coach", message: "What is 11 + 14?" },
      { role: "student", message: "1 + 4 = 5" },
    ] },
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
    summaryRendered: "Student showed understanding.",
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

let app: any;

beforeEach(() => {
  mockSessions.clear();
  mockLessons.clear();
  clearReviewCache();
  jest.clearAllMocks();
  setupDefaultMocks();
  app = createApp();
});

// ── /stress page ────────────────────────────────────────────────────────

describe("GET /stress", () => {
  it("loads the stress test page", async () => {
    const res = await request(app).get("/stress");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Prompt Stress Tester");
    expect(res.text).toContain("select lesson");
  });

  it("shows lesson list when lessons exist", async () => {
    mockLessons.set("lesson-math", makeMathLesson());

    const res = await request(app).get("/stress");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Math Lesson");
    expect(res.text).toContain("lesson-math");
  });

  it("shows prompts for selected lesson", async () => {
    mockLessons.set("lesson-math", makeMathLesson());

    const res = await request(app).get("/stress?lesson=lesson-math");
    expect(res.status).toBe(200);
    expect(res.text).toContain("q1");
    expect(res.text).toContain("What is 11 + 14?");
    expect(res.text).toContain("badge-math");
  });

  it("shows run link when both lesson and prompt selected", async () => {
    mockLessons.set("lesson-math", makeMathLesson());

    const res = await request(app).get("/stress?lesson=lesson-math&prompt=q1");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Run Stress Test");
    expect(res.text).toContain("/stress/run");
  });

  it("shows empty state when no lessons exist", async () => {
    const res = await request(app).get("/stress");
    expect(res.text).toContain("No lessons found");
  });
});

// ── /stress/run ─────────────────────────────────────────────────────────

describe("GET /stress/run", () => {
  it("renders stress test results for math prompt", async () => {
    mockLessons.set("lesson-math", makeMathLesson());

    const res = await request(app).get("/stress/run?lesson=lesson-math&prompt=q1");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Stress Test: q1");
    expect(res.text).toContain("Prompt Metadata");
    expect(res.text).toContain("lesson-math");
    expect(res.text).toContain("Math Lesson");
    expect(res.text).toContain("badge-math");
  });

  it("shows case overview table with all case names", async () => {
    mockLessons.set("lesson-math", makeMathLesson());

    const res = await request(app).get("/stress/run?lesson=lesson-math&prompt=q1");
    expect(res.text).toContain("Case Overview");
    expect(res.text).toContain("perfect_reasoning");
    expect(res.text).toContain("wrong_then_correct");
    expect(res.text).toContain("uncertainty_escalation");
    expect(res.text).toContain("stall_no_progress");
    expect(res.text).toContain("misconception_subtraction");
    expect(res.text).toContain("hint_request");
    expect(res.text).toContain("long_stall");
  });

  it("shows verdict badges with correct classes", async () => {
    mockLessons.set("lesson-math", makeMathLesson());

    const res = await request(app).get("/stress/run?lesson=lesson-math&prompt=q1");
    expect(res.text).toContain("badge-pass");
    expect(res.text).toContain("PASS");
  });

  it("shows aggregate summary bar", async () => {
    mockLessons.set("lesson-math", makeMathLesson());

    const res = await request(app).get("/stress/run?lesson=lesson-math&prompt=q1");
    expect(res.text).toContain("summary-bar");
    expect(res.text).toContain("PASS:");
    expect(res.text).toContain("WARN:");
    expect(res.text).toContain("FAIL:");
  });

  it("shows expandable case details with transcript and strategy column", async () => {
    mockLessons.set("lesson-math", makeMathLesson());

    const res = await request(app).get("/stress/run?lesson=lesson-math&prompt=q1");
    expect(res.text).toContain("<details>");
    expect(res.text).toContain("Transcript");
    expect(res.text).toContain("Replay Analysis");
    expect(res.text).toContain("Final Outcome");
    expect(res.text).toContain("Strategy");
  });

  it("shows per-turn chips (state, move, wrap)", async () => {
    mockLessons.set("lesson-math", makeMathLesson());

    const res = await request(app).get("/stress/run?lesson=lesson-math&prompt=q1");
    expect(res.text).toContain("chip-state");
    expect(res.text).toContain("chip-move");
    expect(res.text).toContain("chip-wrap");
  });

  it("includes markdown download link", async () => {
    mockLessons.set("lesson-math", makeMathLesson());

    const res = await request(app).get("/stress/run?lesson=lesson-math&prompt=q1");
    expect(res.text).toContain("Download Markdown Report");
    expect(res.text).toContain("/stress/markdown");
  });

  it("includes fixture JSON links for each case", async () => {
    mockLessons.set("lesson-math", makeMathLesson());

    const res = await request(app).get("/stress/run?lesson=lesson-math&prompt=q1");
    expect(res.text).toContain("/stress/case-fixture");
    expect(res.text).toContain("Download Fixture JSON");
  });

  it("returns 400 when lesson or prompt missing", async () => {
    const res = await request(app).get("/stress/run");
    expect(res.status).toBe(400);
    expect(res.text).toContain("required");
  });

  it("returns 404 for unknown lesson", async () => {
    const res = await request(app).get("/stress/run?lesson=nonexistent&prompt=q1");
    expect(res.status).toBe(404);
    expect(res.text).toContain("not found");
  });

  it("returns 404 for unknown prompt", async () => {
    mockLessons.set("lesson-math", makeMathLesson());

    const res = await request(app).get("/stress/run?lesson=lesson-math&prompt=nonexistent");
    expect(res.status).toBe(404);
    expect(res.text).toContain("not found");
  });

  it("returns 400 for unsupported prompt", async () => {
    mockLessons.set("lesson-math", makeMathLesson());

    const res = await request(app).get("/stress/run?lesson=lesson-math&prompt=q2");
    expect(res.status).toBe(400);
    expect(res.text).toContain("Cannot stress test");
    expect(res.text).toContain("neither math nor explanation");
  });

  it("works for explanation prompts", async () => {
    mockLessons.set("lesson-expl", makeExplanationLesson());

    const res = await request(app).get("/stress/run?lesson=lesson-expl&prompt=expl-q1");
    expect(res.status).toBe(200);
    expect(res.text).toContain("mastery_fast");
    expect(res.text).toContain("claim_only_stall");
    expect(res.text).toContain("badge-explanation");
  });
});

// ── /stress/markdown ────────────────────────────────────────────────────

describe("GET /stress/markdown", () => {
  it("returns plain text markdown report", async () => {
    mockLessons.set("lesson-math", makeMathLesson());

    const res = await request(app).get("/stress/markdown?lesson=lesson-math&prompt=q1");
    expect(res.status).toBe(200);
    expect(res.type).toContain("text/plain");
    expect(res.text).toContain("# Lesson Stress Test Report");
    expect(res.text).toContain("lesson-math");
  });

  it("returns 400 when params missing", async () => {
    const res = await request(app).get("/stress/markdown");
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown lesson", async () => {
    const res = await request(app).get("/stress/markdown?lesson=nonexistent&prompt=q1");
    expect(res.status).toBe(404);
  });
});

// ── /stress/case-fixture ────────────────────────────────────────────────

describe("GET /stress/case-fixture", () => {
  it("returns fixture JSON for a specific case", async () => {
    mockLessons.set("lesson-math", makeMathLesson());

    const res = await request(app).get(
      "/stress/case-fixture?lesson=lesson-math&prompt=q1&case=perfect_reasoning",
    );
    expect(res.status).toBe(200);
    expect(res.type).toContain("application/json");
    const body = JSON.parse(res.text);
    expect(body.mode).toBe("math");
    expect(body.transcript).toBeDefined();
    expect(body.mathProblem).toBeDefined();
  });

  it("returns 400 when params missing", async () => {
    const res = await request(app).get("/stress/case-fixture");
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown case name", async () => {
    mockLessons.set("lesson-math", makeMathLesson());

    const res = await request(app).get(
      "/stress/case-fixture?lesson=lesson-math&prompt=q1&case=nonexistent",
    );
    expect(res.status).toBe(404);
    expect(res.text).toContain("not found");
  });

  it("returns 404 for unknown lesson", async () => {
    const res = await request(app).get(
      "/stress/case-fixture?lesson=nonexistent&prompt=q1&case=perfect_reasoning",
    );
    expect(res.status).toBe(404);
  });
});

// ── Nav link ────────────────────────────────────────────────────────────

describe("navigation", () => {
  it("includes Stress Test link in nav bar", async () => {
    const res = await request(app).get("/");
    expect(res.text).toContain('href="/stress"');
    expect(res.text).toContain("Stress Test");
  });
});
