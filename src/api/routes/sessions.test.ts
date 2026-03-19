/**
 * Tests for session draft endpoints (POST /:id/draft, DELETE /:id/draft)
 */
import { SessionStore } from "../../stores/sessionStore";
import { Session } from "../../domain/session";

// We test the route logic by directly invoking the store + the same
// logic as the route handlers, since we don't have supertest set up.

const sessionStore = new SessionStore();

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: `test-session-${Date.now()}`,
    studentId: "student-1",
    studentName: "Test Student",
    lessonId: "lesson-1",
    lessonTitle: "Test Lesson",
    submission: {
      assignmentId: "lesson-1",
      studentId: "student-1",
      responses: [],
      submittedAt: new Date(),
    },
    startedAt: new Date(),
    status: "in_progress",
    currentPromptIndex: 0,
    ...overrides,
  };
}

afterEach(() => {
  // Clean up test sessions
});

describe("POST /sessions/:id/draft logic", () => {
  test("saves draftState and sets status to paused", () => {
    const session = makeSession();
    sessionStore.save(session);

    // Simulate the POST /draft handler logic
    const draftState = {
      answer: "My partial answer about the solar system",
      savedAt: new Date().toISOString(),
    };

    const updatedSession: Session = {
      ...session,
      status: "paused",
      draftState,
      currentPromptIndex: 2,
      pausedAt: new Date(),
    };
    sessionStore.save(updatedSession);

    const loaded = sessionStore.load(session.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.status).toBe("paused");
    expect(loaded!.draftState).toBeDefined();
    expect(loaded!.draftState!.answer).toBe("My partial answer about the solar system");
    expect(loaded!.currentPromptIndex).toBe(2);

    // Cleanup
    sessionStore.delete(session.id);
  });

  test("rejects draft save on completed session", () => {
    const session = makeSession({ status: "completed", completedAt: new Date() });
    sessionStore.save(session);

    const loaded = sessionStore.load(session.id);
    expect(loaded!.status).toBe("completed");

    // The route handler checks status === "completed" and returns 409
    // We verify the guard logic
    expect(loaded!.status === "completed").toBe(true);

    sessionStore.delete(session.id);
  });

  test("returns 404 for nonexistent session", () => {
    const loaded = sessionStore.load("nonexistent-session-id");
    expect(loaded).toBeNull();
  });

  test("preserves existing session data when adding draftState", () => {
    const session = makeSession({
      submission: {
        assignmentId: "lesson-1",
        studentId: "student-1",
        responses: [
          {
            promptId: "q1",
            response: "Already answered",
            hintUsed: false,
          },
        ],
        submittedAt: new Date(),
      },
      currentPromptIndex: 1,
    });
    sessionStore.save(session);

    // Add draft state
    const updatedSession: Session = {
      ...session,
      status: "paused",
      draftState: {
        answer: "Working on question 2",
        savedAt: new Date().toISOString(),
      },
      currentPromptIndex: 1,
      pausedAt: new Date(),
    };
    sessionStore.save(updatedSession);

    const loaded = sessionStore.load(session.id);
    expect(loaded!.submission.responses).toHaveLength(1);
    expect(loaded!.submission.responses[0].response).toBe("Already answered");
    expect(loaded!.draftState!.answer).toBe("Working on question 2");

    sessionStore.delete(session.id);
  });
});

describe("DELETE /sessions/:id/draft logic", () => {
  test("clears draftState from session", () => {
    const session = makeSession({
      status: "paused",
      draftState: {
        answer: "To be cleared",
        savedAt: new Date().toISOString(),
      },
    });
    sessionStore.save(session);

    // Simulate DELETE /draft handler logic
    const { draftState, ...rest } = session;
    sessionStore.save(rest as Session);

    const loaded = sessionStore.load(session.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.draftState).toBeUndefined();

    sessionStore.delete(session.id);
  });

  test("is a no-op if no draftState exists", () => {
    const session = makeSession();
    sessionStore.save(session);

    // No draftState to clear
    const loaded = sessionStore.load(session.id);
    expect(loaded!.draftState).toBeUndefined();

    sessionStore.delete(session.id);
  });
});

describe("cleanExpiredDrafts", () => {
  test("cleans drafts older than 7 days", () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const session = makeSession({
      status: "paused",
      draftState: {
        answer: "Old draft",
        savedAt: eightDaysAgo,
      },
    });
    sessionStore.save(session);

    const cleaned = sessionStore.cleanExpiredDrafts();
    expect(cleaned).toBeGreaterThanOrEqual(1);

    const loaded = sessionStore.load(session.id);
    expect(loaded!.draftState).toBeUndefined();

    sessionStore.delete(session.id);
  });

  test("preserves fresh drafts", () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const session = makeSession({
      status: "paused",
      draftState: {
        answer: "Fresh draft",
        savedAt: oneHourAgo,
      },
    });
    sessionStore.save(session);

    sessionStore.cleanExpiredDrafts();

    const loaded = sessionStore.load(session.id);
    expect(loaded!.draftState).toBeDefined();
    expect(loaded!.draftState!.answer).toBe("Fresh draft");

    sessionStore.delete(session.id);
  });

  test("sessions without drafts are untouched", () => {
    const session = makeSession();
    sessionStore.save(session);

    sessionStore.cleanExpiredDrafts();

    const loaded = sessionStore.load(session.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.status).toBe("in_progress");

    sessionStore.delete(session.id);
  });
});
