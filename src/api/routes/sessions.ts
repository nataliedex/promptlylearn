import { Router } from "express";
import { randomUUID } from "crypto";
import { SessionStore } from "../../stores/sessionStore";
import { Session } from "../../domain/session";

const router = Router();
const sessionStore = new SessionStore();

// GET /api/sessions - List sessions (optionally filter by studentId)
router.get("/", (req, res) => {
  try {
    const { studentId, status } = req.query;

    let sessions: Session[];

    if (studentId && typeof studentId === "string") {
      if (status === "in_progress") {
        sessions = sessionStore.getInProgressByStudentId(studentId);
      } else if (status === "completed") {
        sessions = sessionStore.getCompletedByStudentId(studentId);
      } else {
        sessions = sessionStore.getByStudentId(studentId);
      }
    } else {
      sessions = sessionStore.getAll();
      if (status === "in_progress") {
        sessions = sessions.filter(s => s.status === "in_progress");
      } else if (status === "completed") {
        sessions = sessions.filter(s => s.status === "completed");
      }
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
