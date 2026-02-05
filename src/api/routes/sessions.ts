import { Router } from "express";
import { randomUUID } from "crypto";
import { SessionStore } from "../../stores/sessionStore";
import { Session } from "../../domain/session";

const router = Router();
const sessionStore = new SessionStore();

// ============================================
// PRIVACY: Note filtering for student audience
// ============================================

/**
 * PRIVACY: Patterns that indicate system/internal notes that should NEVER be shown to students.
 */
const SYSTEM_NOTE_PATTERNS = [
  /\[System\s*·/i,                    // [System · date] markers
  /---\s*\n\[System/i,                // System note blocks
  /Action taken:/i,                    // Internal action tracking
  /Added to Teacher To-Dos/i,          // Internal workflow tracking
  /Follow-up completed:/i,             // Follow-up tracking
  /Needs support:.*show similar/i,     // Group analysis patterns
  /Group averaged \d+%/i,              // Group score analysis
];

/**
 * PRIVACY: Check if a note contains system/internal content.
 */
function isSystemNote(noteText: string): boolean {
  if (!noteText) return false;
  return SYSTEM_NOTE_PATTERNS.some((pattern) => pattern.test(noteText));
}

/**
 * PRIVACY: Extract only the student-visible portion of educator notes.
 * @returns The cleaned note text safe for student viewing, or undefined if nothing remains
 */
function extractStudentVisibleNote(noteText: string | undefined): string | undefined {
  if (!noteText) return undefined;

  // Remove system note blocks
  let cleaned = noteText.replace(/\n---\n\[System\s*·[^\]]*\][^\n]*(\n[^\n---]*)?/gi, "");
  cleaned = cleaned.replace(/\[System\s*·[^\]]*\][^\n]*/gi, "");
  cleaned = cleaned.replace(/Action taken:[^\n]*/gi, "");
  cleaned = cleaned.replace(/Added to Teacher To-Dos[^\n]*/gi, "");
  cleaned = cleaned.replace(/Follow-up completed:[^\n]*/gi, "");

  // Clean up whitespace
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
  cleaned = cleaned.replace(/^---\s*$/gm, "").trim();

  // If nothing student-visible remains, return undefined
  if (!cleaned || isSystemNote(cleaned)) {
    return undefined;
  }

  return cleaned;
}

/**
 * PRIVACY: Sanitize a session for student consumption.
 * Removes system notes from educatorNotes field.
 */
function sanitizeSessionForStudent(session: Session): Session {
  return {
    ...session,
    educatorNotes: extractStudentVisibleNote(session.educatorNotes),
  };
}

/**
 * PRIVACY GUARD: Log when a system note is filtered out.
 */
function logPrivacyFilter(sessionId: string, originalNote: string): void {
  if (process.env.NODE_ENV !== "production") {
    console.log(
      `[PRIVACY] Filtered system note from session ${sessionId} for student audience`
    );
  }
}

// GET /api/sessions - List sessions (optionally filter by studentId)
// PRIVACY: Use ?audience=student to get sanitized data for student-facing views
router.get("/", (req, res) => {
  try {
    const { studentId, status, audience } = req.query;
    const isStudentAudience = audience === "student";

    let sessions: Session[];

    if (studentId && typeof studentId === "string") {
      if (status === "in_progress") {
        sessions = sessionStore.getInProgressByStudentId(studentId);
      } else if (status === "completed") {
        sessions = sessionStore.getCompletedByStudentId(studentId);
      } else if (status === "paused") {
        sessions = sessionStore.getPausedByStudentId(studentId);
      } else {
        sessions = sessionStore.getByStudentId(studentId);
      }
    } else {
      sessions = sessionStore.getAll();
      if (status === "in_progress") {
        sessions = sessions.filter(s => s.status === "in_progress");
      } else if (status === "completed") {
        sessions = sessions.filter(s => s.status === "completed");
      } else if (status === "paused") {
        sessions = sessions.filter(s => s.status === "paused");
      }
    }

    // PRIVACY: When audience is "student", sanitize educatorNotes to remove system content
    if (isStudentAudience) {
      sessions = sessions.map((session) => {
        if (session.educatorNotes && isSystemNote(session.educatorNotes)) {
          logPrivacyFilter(session.id, session.educatorNotes);
        }
        return sanitizeSessionForStudent(session);
      });
    }

    res.json(sessions);
  } catch (error) {
    console.error("Error fetching sessions:", error);
    res.status(500).json({ error: "Failed to fetch sessions" });
  }
});

// GET /api/sessions/:id - Get session by ID
router.get("/:id", (req, res) => {
  try {
    const session = sessionStore.load(req.params.id);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    res.json(session);
  } catch (error) {
    console.error("Error fetching session:", error);
    res.status(500).json({ error: "Failed to fetch session" });
  }
});

// POST /api/sessions - Create new session
router.post("/", (req, res) => {
  try {
    const { studentId, studentName, lessonId, lessonTitle } = req.body;

    if (!studentId || !studentName || !lessonId || !lessonTitle) {
      return res.status(400).json({
        error: "studentId, studentName, lessonId, and lessonTitle are required",
      });
    }

    const session: Session = {
      id: randomUUID(),
      studentId,
      studentName,
      lessonId,
      lessonTitle,
      submission: {
        assignmentId: lessonId,
        studentId,
        responses: [],
        submittedAt: new Date(),
      },
      startedAt: new Date(),
      status: "in_progress",
      currentPromptIndex: 0,
    };

    sessionStore.save(session);
    res.status(201).json(session);
  } catch (error) {
    console.error("Error creating session:", error);
    res.status(500).json({ error: "Failed to create session" });
  }
});

// PUT /api/sessions/:id - Update session
router.put("/:id", (req, res) => {
  try {
    const existingSession = sessionStore.load(req.params.id);
    if (!existingSession) {
      return res.status(404).json({ error: "Session not found" });
    }

    const updatedSession: Session = {
      ...existingSession,
      ...req.body,
      id: existingSession.id, // Prevent ID change
    };

    sessionStore.save(updatedSession);
    res.json(updatedSession);
  } catch (error) {
    console.error("Error updating session:", error);
    res.status(500).json({ error: "Failed to update session" });
  }
});

// DELETE /api/sessions/:id - Delete session
router.delete("/:id", (req, res) => {
  try {
    const deleted = sessionStore.delete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: "Session not found" });
    }
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting session:", error);
    res.status(500).json({ error: "Failed to delete session" });
  }
});

export default router;
