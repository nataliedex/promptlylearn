/**
 * Coaching Invites API Routes
 *
 * Endpoints for teacher-pushed enrichment coaching sessions.
 */

import { Router } from "express";
import { coachingInviteStore } from "../../stores/coachingInviteStore";
import { recommendationStore } from "../../stores/recommendationStore";
import { CoachingInviteStatus } from "../../domain/coachingInvite";

const router = Router();

// ============================================
// Teacher Endpoints
// ============================================

/**
 * POST /api/coaching-invites
 * Create a new coaching invite (teacher action)
 */
router.post("/", (req, res) => {
  try {
    const {
      teacherId = "educator",
      studentId,
      classId,
      subject,
      assignmentId,
      assignmentTitle,
      title,
      teacherNote,
      sourceRecommendationId,
    } = req.body;

    // Validate required fields
    if (!studentId) {
      return res.status(400).json({ error: "studentId is required" });
    }
    if (!subject) {
      return res.status(400).json({ error: "subject is required" });
    }
    if (!title) {
      return res.status(400).json({ error: "title is required" });
    }

    // Create the invite
    const invite = coachingInviteStore.create({
      teacherId,
      studentId,
      classId,
      subject,
      assignmentId,
      assignmentTitle,
      title,
      teacherNote,
      sourceRecommendationId,
    });

    // If created from a recommendation, resolve it
    if (sourceRecommendationId) {
      recommendationStore.resolveByStudentAssignment(
        studentId,
        assignmentId || "",
        teacherId
      );
    }

    res.json({
      success: true,
      invite,
    });
  } catch (error) {
    console.error("Error creating coaching invite:", error);
    res.status(500).json({ error: "Failed to create coaching invite" });
  }
});

/**
 * GET /api/coaching-invites
 * Get coaching invites (teacher view)
 * Query params: teacherId, studentId, status
 */
router.get("/", (req, res) => {
  try {
    const { teacherId, studentId, status } = req.query;

    let invites = coachingInviteStore.getAll();

    // Filter by teacher
    if (teacherId && typeof teacherId === "string") {
      invites = invites.filter((inv) => inv.teacherId === teacherId);
    }

    // Filter by student
    if (studentId && typeof studentId === "string") {
      invites = invites.filter((inv) => inv.studentId === studentId);
    }

    // Filter by status
    if (status && typeof status === "string") {
      invites = invites.filter((inv) => inv.status === status);
    }

    // Sort by createdAt descending (newest first)
    invites.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    const counts = coachingInviteStore.getCounts(
      studentId as string | undefined
    );

    res.json({
      invites,
      counts,
    });
  } catch (error) {
    console.error("Error fetching coaching invites:", error);
    res.status(500).json({ error: "Failed to fetch coaching invites" });
  }
});

/**
 * GET /api/coaching-invites/:id
 * Get a single coaching invite
 */
router.get("/:id", (req, res) => {
  try {
    const invite = coachingInviteStore.load(req.params.id);

    if (!invite) {
      return res.status(404).json({ error: "Coaching invite not found" });
    }

    res.json({ invite });
  } catch (error) {
    console.error("Error fetching coaching invite:", error);
    res.status(500).json({ error: "Failed to fetch coaching invite" });
  }
});

// ============================================
// Student Endpoints
// ============================================

/**
 * GET /api/students/:studentId/coaching-invites
 * Get coaching invites for a student
 * Query params: status (default: returns all)
 */
router.get("/student/:studentId", (req, res) => {
  try {
    const { studentId } = req.params;
    const { status } = req.query;

    let invites = coachingInviteStore.getByStudent(studentId);

    // Filter by status if specified
    if (status && typeof status === "string") {
      invites = invites.filter((inv) => inv.status === status);
    }

    // Sort pending first, then by createdAt
    invites.sort((a, b) => {
      if (a.status === "pending" && b.status !== "pending") return -1;
      if (b.status === "pending" && a.status !== "pending") return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    const counts = coachingInviteStore.getCounts(studentId);

    res.json({
      invites,
      counts,
    });
  } catch (error) {
    console.error("Error fetching student coaching invites:", error);
    res.status(500).json({ error: "Failed to fetch coaching invites" });
  }
});

/**
 * POST /api/coaching-invites/:id/start
 * Mark an invite as started (student action)
 */
router.post("/:id/start", (req, res) => {
  try {
    const invite = coachingInviteStore.markStarted(req.params.id);

    if (!invite) {
      return res.status(404).json({ error: "Coaching invite not found" });
    }

    res.json({
      success: true,
      invite,
    });
  } catch (error) {
    console.error("Error starting coaching invite:", error);
    res.status(500).json({ error: "Failed to start coaching invite" });
  }
});

/**
 * POST /api/coaching-invites/:id/complete
 * Mark an invite as completed (student action)
 */
router.post("/:id/complete", (req, res) => {
  try {
    const { messageCount } = req.body;
    const invite = coachingInviteStore.markCompleted(req.params.id, messageCount);

    if (!invite) {
      return res.status(404).json({ error: "Coaching invite not found" });
    }

    res.json({
      success: true,
      invite,
    });
  } catch (error) {
    console.error("Error completing coaching invite:", error);
    res.status(500).json({ error: "Failed to complete coaching invite" });
  }
});

/**
 * POST /api/coaching-invites/:id/dismiss
 * Dismiss an invite (student action - optional)
 */
router.post("/:id/dismiss", (req, res) => {
  try {
    const invite = coachingInviteStore.markDismissed(req.params.id);

    if (!invite) {
      return res.status(404).json({ error: "Coaching invite not found" });
    }

    res.json({
      success: true,
      invite,
    });
  } catch (error) {
    console.error("Error dismissing coaching invite:", error);
    res.status(500).json({ error: "Failed to dismiss coaching invite" });
  }
});

/**
 * POST /api/coaching-invites/:id/activity
 * Update activity timestamp and message count
 */
router.post("/:id/activity", (req, res) => {
  try {
    const { messageCount } = req.body;
    const invite = coachingInviteStore.updateActivity(req.params.id, messageCount);

    if (!invite) {
      return res.status(404).json({ error: "Coaching invite not found" });
    }

    res.json({
      success: true,
      invite,
    });
  } catch (error) {
    console.error("Error updating coaching invite activity:", error);
    res.status(500).json({ error: "Failed to update activity" });
  }
});

export default router;
