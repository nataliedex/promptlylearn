import { useEffect, useRef, useCallback } from "react";
import type { ConversationMessage, CoachFeedbackResponse } from "../services/api";

const API_BASE = "http://localhost:3001/api";
const DRAFT_LS_PREFIX = "promptly-draft-";
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DraftSnapshot {
  answer: string;
  followUpAnswer: string;
  conversationHistory: ConversationMessage[];
  feedback: CoachFeedbackResponse | null;
  showHint: boolean;
  hintIndex: number;
  currentIndex: number;
  mode: "voice" | "type" | "video";
  videoAttemptCount: number;
  videoFollowUpCount: number;
  videoHintUsed: boolean;
  videoHintIndex: number;
  /** VCR phase when draft was saved (e.g., "preview" for completed recording) */
  videoPhase?: string;
  /** Recorded video duration in seconds (for preview restore) */
  videoRecordedDuration?: number;
  /** Session summary text (for preview restore) */
  videoSessionSummary?: string;
  /** IndexedDB key for the recorded video Blob */
  videoBlobKey?: string;
}

export interface DraftPayload {
  draftState: {
    answer?: string;
    followUpAnswer?: string;
    conversationHistory?: Array<{ role: "student" | "coach"; message: string }>;
    feedback?: CoachFeedbackResponse;
    showHint?: boolean;
    hintIndex?: number;
    videoAttemptCount?: number;
    videoFollowUpCount?: number;
    videoHintUsed?: boolean;
    videoHintIndex?: number;
    videoPhase?: string;
    videoRecordedDuration?: number;
    videoSessionSummary?: string;
    videoBlobKey?: string;
    savedAt: string;
  };
  currentPromptIndex: number;
  mode?: string;
}

interface UseAutoSaveOptions {
  sessionId: string | null;
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// localStorage helpers (exported for testing)
// ---------------------------------------------------------------------------

export function saveToLocalStorage(sessionId: string, payload: DraftPayload): void {
  try {
    localStorage.setItem(`${DRAFT_LS_PREFIX}${sessionId}`, JSON.stringify(payload));
    console.log(`[DraftAttempt] saved to localStorage key=${DRAFT_LS_PREFIX}${sessionId} updatedAt=${payload.draftState.savedAt}`);
  } catch (err) {
    console.error("[auto-save] localStorage write failed:", err);
  }
}

export function getLocalStorageDraft(sessionId: string): DraftPayload | null {
  try {
    const raw = localStorage.getItem(`${DRAFT_LS_PREFIX}${sessionId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DraftPayload;
    // TTL check
    const savedAt = parsed?.draftState?.savedAt;
    if (savedAt) {
      const age = Date.now() - new Date(savedAt).getTime();
      if (age > DRAFT_TTL_MS) {
        localStorage.removeItem(`${DRAFT_LS_PREFIX}${sessionId}`);
        return null;
      }
    }
    return parsed;
  } catch {
    return null;
  }
}

function clearLocalStorage(sessionId: string): void {
  try {
    localStorage.removeItem(`${DRAFT_LS_PREFIX}${sessionId}`);
  } catch { /* ignore */ }
}

export function clearDraftEverywhere(sessionId: string): void {
  console.log(`[DraftAttempt] cleared key=${DRAFT_LS_PREFIX}${sessionId}`);
  clearLocalStorage(sessionId);
  // Fire-and-forget server clear
  fetch(`${API_BASE}/sessions/${sessionId}/draft`, {
    method: "DELETE",
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Build payload from snapshot
// ---------------------------------------------------------------------------

function buildPayload(snapshot: DraftSnapshot): DraftPayload {
  return {
    draftState: {
      answer: snapshot.answer || undefined,
      followUpAnswer: snapshot.followUpAnswer || undefined,
      conversationHistory:
        snapshot.conversationHistory.length > 0
          ? snapshot.conversationHistory
          : undefined,
      feedback: snapshot.feedback || undefined,
      showHint: snapshot.showHint || undefined,
      hintIndex: snapshot.showHint ? snapshot.hintIndex : undefined,
      videoAttemptCount: snapshot.videoAttemptCount || undefined,
      videoFollowUpCount: snapshot.videoFollowUpCount || undefined,
      videoHintUsed: snapshot.videoHintUsed || undefined,
      videoHintIndex: snapshot.videoHintIndex || undefined,
      videoPhase: snapshot.videoPhase || undefined,
      videoRecordedDuration: snapshot.videoRecordedDuration || undefined,
      videoSessionSummary: snapshot.videoSessionSummary || undefined,
      videoBlobKey: snapshot.videoBlobKey || undefined,
      savedAt: new Date().toISOString(),
    },
    currentPromptIndex: snapshot.currentIndex,
    mode: snapshot.mode,
  };
}

/** Returns true if the snapshot has any meaningful data worth saving. */
function hasContent(snapshot: DraftSnapshot): boolean {
  return !!(
    snapshot.answer ||
    snapshot.followUpAnswer ||
    snapshot.conversationHistory.length > 0 ||
    snapshot.feedback ||
    snapshot.showHint ||
    snapshot.videoAttemptCount > 0 ||
    snapshot.videoFollowUpCount > 0 ||
    snapshot.videoPhase === "preview"
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAutoSave({ sessionId, enabled }: UseAutoSaveOptions) {
  const snapshotRef = useRef<DraftSnapshot | null>(null);
  const isSavingRef = useRef(false);

  const updateSnapshot = useCallback((snapshot: DraftSnapshot) => {
    snapshotRef.current = snapshot;
  }, []);

  const saveDraft = useCallback(
    async (useBeacon = false): Promise<boolean> => {
      const snapshot = snapshotRef.current;
      if (!sessionId || !snapshot || !hasContent(snapshot)) return false;

      const payload = buildPayload(snapshot);

      if (useBeacon) {
        // localStorage first (synchronous, guaranteed)
        saveToLocalStorage(sessionId, payload);
        // sendBeacon for server save (best-effort)
        try {
          const blob = new Blob([JSON.stringify(payload)], {
            type: "application/json",
          });
          navigator.sendBeacon(
            `${API_BASE}/sessions/${sessionId}/draft`,
            blob
          );
        } catch { /* ignore */ }
        return true;
      }

      // Normal async save
      if (isSavingRef.current) return false;
      isSavingRef.current = true;

      try {
        const res = await fetch(`${API_BASE}/sessions/${sessionId}/draft`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          console.log(`[DraftAttempt] saved key=session:${sessionId} updatedAt=${payload.draftState.savedAt}`);
          clearLocalStorage(sessionId);
          return true;
        }
        // Server rejected — fall back to localStorage
        saveToLocalStorage(sessionId, payload);
        return false;
      } catch {
        saveToLocalStorage(sessionId, payload);
        return false;
      } finally {
        isSavingRef.current = false;
      }
    },
    [sessionId]
  );

  // Register beforeunload and popstate listeners
  useEffect(() => {
    if (!enabled || !sessionId) return;

    const handleBeforeUnload = () => {
      const snapshot = snapshotRef.current;
      if (!snapshot || !hasContent(snapshot)) return;
      // Sync localStorage write
      const payload = buildPayload(snapshot);
      saveToLocalStorage(sessionId, payload);
      // Also attempt sendBeacon
      try {
        const blob = new Blob([JSON.stringify(payload)], {
          type: "application/json",
        });
        navigator.sendBeacon(
          `${API_BASE}/sessions/${sessionId}/draft`,
          blob
        );
      } catch { /* ignore */ }
    };

    const handlePopState = () => {
      // Browser back button — attempt save
      const snapshot = snapshotRef.current;
      if (!snapshot || !hasContent(snapshot)) return;
      const payload = buildPayload(snapshot);
      saveToLocalStorage(sessionId, payload);
      try {
        const blob = new Blob([JSON.stringify(payload)], {
          type: "application/json",
        });
        navigator.sendBeacon(
          `${API_BASE}/sessions/${sessionId}/draft`,
          blob
        );
      } catch { /* ignore */ }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("popstate", handlePopState);
    };
  }, [enabled, sessionId]);

  return { updateSnapshot, saveDraft };
}
