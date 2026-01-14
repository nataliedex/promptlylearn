import { Router } from "express";
import { randomUUID } from "crypto";
import { CoachSessionStore } from "../../stores/coachSessionStore";
import { CoachSession, computeSessionIntent } from "../../domain/coachSession";

const router = Router();
const coachSessionStore = new CoachSessionStore();

// GET /api/coach-sessions - List coach sessions (optionally filter by studentId)
router.get("/", (req, res) => {
  try {
    const { studentId, limit } = req.query;

    let sessions: CoachSession[];

    if (studentId && typeof studentId === "string") {
      if (limit && typeof limit === "string") {
        sessions = coachSessionStore.getRecentByStudentId(studentId, parseInt(limit, 10));
      } else {
        sessions = coachSessionStore.getByStudentId(studentId);
      }
    } else {
      sessions = coachSessionStore.getAll();
    }

    res.json(sessions);
  } catch (error) {
    console.error("Error fetching coach sessions:", error);
    res.status(500).json({ error: "Failed to fetch coach sessions" });
  }
});

// GET /api/coach-sessions/insights/:studentId - Get coaching insights for a student
// NOTE: This must come BEFORE /:id to avoid "insights" being matched as an ID
router.get("/insights/:studentId", (req, res) => {
  try {
    const insights = coachSessionStore.getInsightsForStudent(req.params.studentId);
    res.json(insights);
  } catch (error) {
    console.error("Error fetching coaching insights:", error);
    res.status(500).json({ error: "Failed to fetch coaching insights" });
  }
});

// GET /api/coach-sessions/:id - Get coach session by ID
router.get("/:id", (req, res) => {
  try {
    const session = coachSessionStore.load(req.params.id);
    if (!session) {
      return res.status(404).json({ error: "Coach session not found" });
    }
    res.json(session);
  } catch (error) {
    console.error("Error fetching coach session:", error);
    res.status(500).json({ error: "Failed to fetch coach session" });
  }
});

// POST /api/coach-sessions - Create new coach session
router.post("/", (req, res) => {
  try {
    const { studentId, studentName, topics, messages, mode, startedAt, endedAt } = req.body;

    if (!studentId || !studentName) {
      return res.status(400).json({
        error: "studentId and studentName are required",
      });
    }

    // Compute intent scores from messages
    const { supportScore, enrichmentScore, intentLabel } = computeSessionIntent(messages || []);

    const session: CoachSession = {
      id: randomUUID(),
      studentId,
      studentName,
      topics: topics || [],
      messages: messages || [],
      mode: mode || "type",
      startedAt: startedAt || new Date().toISOString(),
      endedAt: endedAt,
      supportScore,
      enrichmentScore,
      intentLabel,
    };

    coachSessionStore.save(session);
    res.status(201).json(session);
  } catch (error) {
    console.error("Error creating coach session:", error);
    res.status(500).json({ error: "Failed to create coach session" });
  }
});

// PUT /api/coach-sessions/:id - Update coach session (e.g., add messages, end session)
router.put("/:id", (req, res) => {
  try {
    const existingSession = coachSessionStore.load(req.params.id);
    if (!existingSession) {
      return res.status(404).json({ error: "Coach session not found" });
    }

    // Merge updates
    const updatedMessages = req.body.messages || existingSession.messages;

    // Recompute intent scores if messages changed
    const { supportScore, enrichmentScore, intentLabel } = computeSessionIntent(updatedMessages);

    const updatedSession: CoachSession = {
      ...existingSession,
      ...req.body,
      id: existingSession.id, // Prevent ID change
      supportScore,
      enrichmentScore,
      intentLabel,
    };

    coachSessionStore.save(updatedSession);
    res.json(updatedSession);
  } catch (error) {
    console.error("Error updating coach session:", error);
    res.status(500).json({ error: "Failed to update coach session" });
  }
});

// DELETE /api/coach-sessions/:id - Delete coach session
router.delete("/:id", (req, res) => {
  try {
    const deleted = coachSessionStore.delete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: "Coach session not found" });
    }
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting coach session:", error);
    res.status(500).json({ error: "Failed to delete coach session" });
  }
});

export default router;
