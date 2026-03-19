/**
 * Tests for useAutoSave localStorage helpers and TTL logic.
 * Uses node environment with manual global mocks.
 */
import {
  saveToLocalStorage,
  getLocalStorageDraft,
  clearDraftEverywhere,
} from "./useAutoSave";

// Mock localStorage as a global (node environment)
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: jest.fn((key: string) => store[key] || null),
  setItem: jest.fn((key: string, value: string) => { store[key] = value; }),
  removeItem: jest.fn((key: string) => { delete store[key]; }),
  clear: jest.fn(() => { Object.keys(store).forEach(k => delete store[k]); }),
};

(global as any).localStorage = localStorageMock;

// Mock fetch for clearDraftEverywhere
(global as any).fetch = jest.fn(() => Promise.resolve({ ok: true }));

beforeEach(() => {
  localStorageMock.clear();
  jest.clearAllMocks();
});

// ============================================================================
// saveToLocalStorage / getLocalStorageDraft round-trip
// ============================================================================

describe("saveToLocalStorage + getLocalStorageDraft", () => {
  test("round-trip: saved draft can be loaded back", () => {
    const payload = {
      draftState: {
        answer: "My partial answer",
        savedAt: new Date().toISOString(),
      },
      currentPromptIndex: 2,
      mode: "type",
    };

    saveToLocalStorage("session-123", payload as any);
    const loaded = getLocalStorageDraft("session-123");

    expect(loaded).not.toBeNull();
    expect(loaded!.draftState.answer).toBe("My partial answer");
    expect(loaded!.currentPromptIndex).toBe(2);
  });

  test("returns null for nonexistent session", () => {
    const loaded = getLocalStorageDraft("nonexistent");
    expect(loaded).toBeNull();
  });

  test("stores with correct localStorage key", () => {
    const payload = {
      draftState: { savedAt: new Date().toISOString() },
      currentPromptIndex: 0,
    };

    saveToLocalStorage("abc-def", payload as any);
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      "promptly-draft-abc-def",
      expect.any(String)
    );
  });

  test("saves all draft fields", () => {
    const payload = {
      draftState: {
        answer: "partial",
        followUpAnswer: "follow up text",
        conversationHistory: [{ role: "coach" as const, message: "Tell me more" }],
        showHint: true,
        hintIndex: 1,
        videoAttemptCount: 2,
        savedAt: new Date().toISOString(),
      },
      currentPromptIndex: 3,
      mode: "voice",
    };

    saveToLocalStorage("session-full", payload as any);
    const loaded = getLocalStorageDraft("session-full");

    expect(loaded!.draftState.answer).toBe("partial");
    expect(loaded!.draftState.followUpAnswer).toBe("follow up text");
    expect(loaded!.draftState.conversationHistory).toHaveLength(1);
    expect(loaded!.draftState.showHint).toBe(true);
    expect(loaded!.draftState.hintIndex).toBe(1);
    expect(loaded!.draftState.videoAttemptCount).toBe(2);
  });
});

// ============================================================================
// TTL enforcement
// ============================================================================

describe("draft TTL", () => {
  test("draft older than 7 days returns null", () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const payload = {
      draftState: {
        answer: "old answer",
        savedAt: eightDaysAgo,
      },
      currentPromptIndex: 1,
    };

    saveToLocalStorage("session-old", payload as any);
    const loaded = getLocalStorageDraft("session-old");

    expect(loaded).toBeNull();
    // Should also clean up localStorage
    expect(localStorageMock.removeItem).toHaveBeenCalledWith("promptly-draft-session-old");
  });

  test("draft younger than 7 days is returned", () => {
    const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    const payload = {
      draftState: {
        answer: "recent answer",
        savedAt: oneDayAgo,
      },
      currentPromptIndex: 0,
    };

    saveToLocalStorage("session-recent", payload as any);
    const loaded = getLocalStorageDraft("session-recent");

    expect(loaded).not.toBeNull();
    expect(loaded!.draftState.answer).toBe("recent answer");
  });

  test("draft exactly 7 days old returns null (boundary)", () => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 - 1000).toISOString();
    const payload = {
      draftState: {
        answer: "boundary answer",
        savedAt: sevenDaysAgo,
      },
      currentPromptIndex: 0,
    };

    saveToLocalStorage("session-boundary", payload as any);
    const loaded = getLocalStorageDraft("session-boundary");

    expect(loaded).toBeNull();
  });

  test("draft at 6 days 23 hours is still valid", () => {
    const almostExpired = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000)).toISOString();
    const payload = {
      draftState: {
        answer: "almost expired",
        savedAt: almostExpired,
      },
      currentPromptIndex: 0,
    };

    saveToLocalStorage("session-almost", payload as any);
    const loaded = getLocalStorageDraft("session-almost");

    expect(loaded).not.toBeNull();
  });
});

// ============================================================================
// clearDraftEverywhere
// ============================================================================

describe("clearDraftEverywhere", () => {
  test("removes from localStorage", () => {
    const payload = {
      draftState: { answer: "to be cleared", savedAt: new Date().toISOString() },
      currentPromptIndex: 0,
    };
    saveToLocalStorage("session-clear", payload as any);

    clearDraftEverywhere("session-clear");

    expect(localStorageMock.removeItem).toHaveBeenCalledWith("promptly-draft-session-clear");
  });

  test("fires DELETE request to server", () => {
    clearDraftEverywhere("session-clear");

    expect((global as any).fetch).toHaveBeenCalledWith(
      expect.stringContaining("/sessions/session-clear/draft"),
      expect.objectContaining({ method: "DELETE" })
    );
  });
});

// ============================================================================
// Edge cases
// ============================================================================

describe("edge cases", () => {
  test("getLocalStorageDraft handles corrupted JSON gracefully", () => {
    store["promptly-draft-bad"] = "not valid json{{{";
    localStorageMock.getItem.mockImplementationOnce(() => "not valid json{{{");
    const loaded = getLocalStorageDraft("bad");
    expect(loaded).toBeNull();
  });

  test("draft with missing savedAt is still returned", () => {
    const payload = {
      draftState: { answer: "no timestamp" },
      currentPromptIndex: 0,
    };
    store["promptly-draft-no-ts"] = JSON.stringify(payload);
    localStorageMock.getItem.mockImplementationOnce(() => JSON.stringify(payload));
    const loaded = getLocalStorageDraft("no-ts");
    expect(loaded).not.toBeNull();
  });
});

// ============================================================================
// Video mode draft persistence (resume flow bug fix)
// ============================================================================

describe("video mode draft persistence", () => {
  test("video mode is persisted in draft payload", () => {
    const payload = {
      draftState: {
        videoAttemptCount: 1,
        savedAt: new Date().toISOString(),
      },
      currentPromptIndex: 0,
      mode: "video",
    };

    saveToLocalStorage("session-video", payload as any);
    const loaded = getLocalStorageDraft("session-video");

    expect(loaded).not.toBeNull();
    expect(loaded!.mode).toBe("video");
  });

  test("draft round-trip preserves all video fields", () => {
    const payload = {
      draftState: {
        videoAttemptCount: 3,
        videoFollowUpCount: 2,
        videoHintUsed: true,
        videoHintIndex: 1,
        conversationHistory: [
          { role: "student" as const, message: "Earth is made of rock" },
          { role: "coach" as const, message: "Can you tell me about another planet?" },
        ],
        savedAt: new Date().toISOString(),
      },
      currentPromptIndex: 0,
      mode: "video",
    };

    saveToLocalStorage("session-video-full", payload as any);
    const loaded = getLocalStorageDraft("session-video-full");

    expect(loaded).not.toBeNull();
    expect(loaded!.draftState.videoAttemptCount).toBe(3);
    expect(loaded!.draftState.videoFollowUpCount).toBe(2);
    expect(loaded!.draftState.videoHintUsed).toBe(true);
    expect(loaded!.draftState.videoHintIndex).toBe(1);
    expect(loaded!.draftState.conversationHistory).toHaveLength(2);
    expect(loaded!.mode).toBe("video");
  });

  test("clearDraftEverywhere makes getLocalStorageDraft return null", () => {
    const payload = {
      draftState: {
        answer: "in progress answer",
        savedAt: new Date().toISOString(),
      },
      currentPromptIndex: 1,
      mode: "type",
    };

    saveToLocalStorage("session-to-clear", payload as any);
    expect(getLocalStorageDraft("session-to-clear")).not.toBeNull();

    clearDraftEverywhere("session-to-clear");
    expect(getLocalStorageDraft("session-to-clear")).toBeNull();
  });
});

// ============================================================================
// Video preview draft persistence (server-side draft upload resume)
// ============================================================================

describe("video preview draft persistence", () => {
  test("draft with videoPhase=preview and videoBlobKey round-trips correctly", () => {
    const payload = {
      draftState: {
        conversationHistory: [
          { role: "coach" as const, message: "What is Earth made of?" },
          { role: "student" as const, message: "Rock and metal" },
        ],
        videoPhase: "preview",
        videoRecordedDuration: 45,
        videoBlobKey: "/uploads/video/draft-123.webm",
        videoSessionSummary: "Student explained Earth is made of rock and metal.",
        videoAttemptCount: 1,
        savedAt: new Date().toISOString(),
      },
      currentPromptIndex: 0,
      mode: "video",
    };

    saveToLocalStorage("session-preview", payload as any);
    const loaded = getLocalStorageDraft("session-preview");

    expect(loaded).not.toBeNull();
    expect(loaded!.draftState.videoPhase).toBe("preview");
    expect(loaded!.draftState.videoRecordedDuration).toBe(45);
    expect(loaded!.draftState.videoBlobKey).toBe("/uploads/video/draft-123.webm");
    expect(loaded!.draftState.videoSessionSummary).toBe("Student explained Earth is made of rock and metal.");
    expect(loaded!.mode).toBe("video");
  });

  test("draft without video preview fields still loads (backwards compatible)", () => {
    const payload = {
      draftState: {
        answer: "partial answer",
        savedAt: new Date().toISOString(),
      },
      currentPromptIndex: 1,
      mode: "type",
    };

    saveToLocalStorage("session-no-preview", payload as any);
    const loaded = getLocalStorageDraft("session-no-preview");

    expect(loaded).not.toBeNull();
    expect(loaded!.draftState.videoPhase).toBeUndefined();
    expect(loaded!.draftState.videoBlobKey).toBeUndefined();
    expect(loaded!.draftState.videoSessionSummary).toBeUndefined();
  });

  test("video preview fields in DraftPayload shape match expected keys", () => {
    const payload = {
      draftState: {
        videoPhase: "preview",
        videoRecordedDuration: 60,
        videoSessionSummary: "Summary text",
        videoBlobKey: "/uploads/video/abc.webm",
        savedAt: new Date().toISOString(),
      },
      currentPromptIndex: 0,
      mode: "video",
    };

    saveToLocalStorage("session-shape", payload as any);
    const loaded = getLocalStorageDraft("session-shape");

    expect(loaded).not.toBeNull();
    expect(loaded!.draftState.videoPhase).toBe("preview");
    expect(loaded!.draftState.videoRecordedDuration).toBe(60);
    expect(loaded!.draftState.videoSessionSummary).toBe("Summary text");
    expect(loaded!.draftState.videoBlobKey).toBe("/uploads/video/abc.webm");
  });

  test("server-side DraftState fields (vcrPhase, videoDraft) round-trip as raw JSON", () => {
    // This tests the server-side DraftState shape (used by session.draftState)
    // which uses different field names than the client-side DraftPayload
    const serverPayload = {
      draftState: {
        conversationHistory: [
          { role: "coach" as const, message: "Question?" },
          { role: "student" as const, message: "Answer." },
        ],
        vcrPhase: "preview",
        recordedDuration: 90,
        videoDraft: {
          url: "/uploads/video/server-draft.webm",
          mimeType: "video/webm",
          durationSec: 90,
          sizeBytes: 5000000,
          createdAt: "2026-03-05T14:00:00.000Z",
          kind: "coach_convo",
        },
        sessionSummary: "Server-side summary.",
        savedAt: new Date().toISOString(),
      },
      currentPromptIndex: 2,
      mode: "video",
    };

    saveToLocalStorage("session-server", serverPayload as any);
    const loaded = getLocalStorageDraft("session-server") as any;

    expect(loaded).not.toBeNull();
    expect(loaded.draftState.vcrPhase).toBe("preview");
    expect(loaded.draftState.recordedDuration).toBe(90);
    expect(loaded.draftState.videoDraft.url).toBe("/uploads/video/server-draft.webm");
    expect(loaded.draftState.sessionSummary).toBe("Server-side summary.");
  });
});
