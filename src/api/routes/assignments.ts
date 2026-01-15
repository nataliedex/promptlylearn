/**
 * Assignment Lifecycle API Routes
 *
 * Handles assignment state tracking and lifecycle transitions.
 * Philosophy: Teachers should not manage dashboards - the system
 * surfaces what needs attention and quietly archives the rest.
 */

import { Router } from "express";
import { getAllLessons } from "../../loaders/lessonLoader";
import { SessionStore } from "../../stores/sessionStore";
import { StudentStore } from "../../stores/studentStore";
import { StudentAssignmentStore } from "../../stores/studentAssignmentStore";
import {
  getAssignmentState,
  getAllAssignmentStates,
  recordTeacherView,
  recordStudentActivity,
  resolveAssignment,
  archiveAssignmentWithSummary,
  restoreAssignment,
  getAssignmentsReadyForArchive,
} from "../../stores/assignmentStateStore";
import {
  computeAssignmentState,
  generateTeacherSummary,
  shouldResolve,
  type ComputedAssignmentState,
} from "../../domain/assignmentLifecycle";

const router = Router();
const sessionStore = new SessionStore();
const studentStore = new StudentStore();
const studentAssignmentStore = new StudentAssignmentStore();

/**
 * GET /api/assignments/dashboard
 *
 * Returns all assignments grouped by lifecycle state.
 * This is the primary endpoint for the educator dashboard.
 */
router.get("/dashboard", (req, res) => {
  try {
    const lessons = getAllLessons();
    const allSessions = sessionStore.getAll();

    const active: ComputedAssignmentState[] = [];
    const resolved: ComputedAssignmentState[] = [];
    const archived: ComputedAssignmentState[] = [];

    for (const lesson of lessons) {
      // Get explicitly assigned students for this lesson
      const assignedStudentIds = studentAssignmentStore.getAssignedStudentIds(lesson.id);

      // Skip lessons with no assignments (they won't appear in dashboard)
      if (assignedStudentIds.length === 0) {
        continue;
      }

      const stateRecord = getAssignmentState(lesson.id);
      const lessonSessions = allSessions.filter(s => s.lessonId === lesson.id);

      const computedState = computeAssignmentState(
        lesson,
        lessonSessions,
        assignedStudentIds,
        stateRecord
      );

      // Auto-resolve if conditions are met
      if (shouldResolve(computedState) && stateRecord.lifecycleState === "active") {
        resolveAssignment(lesson.id);
        computedState.lifecycleState = "resolved";
      }

      // Group by lifecycle state
      switch (computedState.lifecycleState) {
        case "active":
          active.push(computedState);
          break;
        case "resolved":
          resolved.push(computedState);
          break;
        case "archived":
          archived.push(computedState);
          break;
      }
    }

    // Sort active by priority (most urgent first)
    active.sort((a, b) => {
      // Prioritize: students needing support > not reviewed > incomplete
      const priorityA = a.activeReasons.includes("students-need-support") ? 3 :
                        a.activeReasons.includes("not-reviewed") ? 2 : 1;
      const priorityB = b.activeReasons.includes("students-need-support") ? 3 :
                        b.activeReasons.includes("not-reviewed") ? 2 : 1;
      return priorityB - priorityA;
    });

    res.json({
      active,
      resolved,
      archivedCount: archived.length,
    });
  } catch (error) {
    console.error("Error fetching assignment dashboard:", error);
    res.status(500).json({ error: "Failed to fetch assignment dashboard" });
  }
});

/**
 * GET /api/assignments/:id
 *
 * Get computed state for a single assignment.
 */
router.get("/:id", (req, res) => {
  try {
    const { id } = req.params;
    const lessons = getAllLessons();
    const lesson = lessons.find(l => l.id === id);

    if (!lesson) {
      return res.status(404).json({ error: "Assignment not found" });
    }

    // Get explicitly assigned students for this lesson
    const assignedStudentIds = studentAssignmentStore.getAssignedStudentIds(id);

    const stateRecord = getAssignmentState(id);
    const allSessions = sessionStore.getAll();

    const lessonSessions = allSessions.filter(s => s.lessonId === id);
    const computedState = computeAssignmentState(
      lesson,
      lessonSessions,
      assignedStudentIds,
      stateRecord
    );

    res.json({
      ...computedState,
      stateRecord,
      hasAssignments: assignedStudentIds.length > 0,
    });
  } catch (error) {
    console.error("Error fetching assignment:", error);
    res.status(500).json({ error: "Failed to fetch assignment" });
  }
});

/**
 * POST /api/assignments/:id/view
 *
 * Record that a teacher viewed an assignment.
 * This is critical for lifecycle transitions.
 */
router.post("/:id/view", (req, res) => {
  try {
    const { id } = req.params;
    const updatedState = recordTeacherView(id);
    res.json(updatedState);
  } catch (error) {
    console.error("Error recording teacher view:", error);
    res.status(500).json({ error: "Failed to record teacher view" });
  }
});

/**
 * POST /api/assignments/:id/activity
 *
 * Record new student activity on an assignment.
 * Called when a student submits a response.
 */
router.post("/:id/activity", (req, res) => {
  try {
    const { id } = req.params;
    recordStudentActivity(id);
    res.json({ success: true });
  } catch (error) {
    console.error("Error recording student activity:", error);
    res.status(500).json({ error: "Failed to record student activity" });
  }
});

/**
 * POST /api/assignments/:id/students/:studentId/action
 *
 * Mark an action taken on a student's assignment.
 * Used for teacher workflow (reviewed, reassigned, no-action-needed).
 */
router.post("/:id/students/:studentId/action", (req, res) => {
  try {
    const { id, studentId } = req.params;
    const { action } = req.body;

    if (!action || !["reviewed", "reassigned", "no-action-needed"].includes(action)) {
      return res.status(400).json({ error: "Invalid action. Must be: reviewed, reassigned, or no-action-needed" });
    }

    // For reassign, use the pushToStudent method which resets the assignment
    if (action === "reassigned") {
      const result = studentAssignmentStore.pushToStudent(id, studentId);
      if (!result) {
        return res.status(404).json({ error: "Assignment not found" });
      }
      return res.json({ success: true, assignment: result });
    }

    // For other actions, just mark the action
    const result = studentAssignmentStore.markAction(id, studentId, action);
    if (!result) {
      return res.status(404).json({ error: "Assignment not found" });
    }

    res.json({ success: true, assignment: result });
  } catch (error) {
    console.error("Error marking student action:", error);
    res.status(500).json({ error: "Failed to mark student action" });
  }
});

/**
 * GET /api/assignments/:id/status
 *
 * Get the review status for an assignment (how many students addressed).
 */
router.get("/:id/status", (req, res) => {
  try {
    const { id } = req.params;
    const lessons = getAllLessons();
    const lesson = lessons.find(l => l.id === id);

    if (!lesson) {
      return res.status(404).json({ error: "Assignment not found" });
    }

    const assignedStudentIds = studentAssignmentStore.getAssignedStudentIds(id);
    const allSessions = sessionStore.getAll();
    const lessonSessions = allSessions.filter(s => s.lessonId === id && s.status === "completed");

    // Get action status for each student
    const studentStatuses = assignedStudentIds.map(studentId => {
      const assignment = studentAssignmentStore.getAssignment(id, studentId);
      const session = lessonSessions.find(s => s.studentId === studentId);

      return {
        studentId,
        hasCompleted: !!session,
        actionStatus: assignment?.actionStatus,
        actionAt: assignment?.actionAt,
      };
    });

    // Count statuses
    const completed = studentStatuses.filter(s => s.hasCompleted).length;
    const addressed = studentStatuses.filter(s => s.actionStatus).length;
    const unaddressed = studentStatuses.filter(s => s.hasCompleted && !s.actionStatus).length;

    const actionBreakdown = {
      reviewed: studentStatuses.filter(s => s.actionStatus === "reviewed").length,
      reassigned: studentStatuses.filter(s => s.actionStatus === "reassigned").length,
      noActionNeeded: studentStatuses.filter(s => s.actionStatus === "no-action-needed").length,
    };

    res.json({
      totalAssigned: assignedStudentIds.length,
      completed,
      addressed,
      unaddressed,
      actionBreakdown,
      isFullyReviewed: unaddressed === 0 && completed > 0,
    });
  } catch (error) {
    console.error("Error fetching assignment status:", error);
    res.status(500).json({ error: "Failed to fetch assignment status" });
  }
});

/**
 * POST /api/assignments/:id/resolve
 *
 * Manually mark an assignment as resolved.
 */
router.post("/:id/resolve", (req, res) => {
  try {
    const { id } = req.params;
    const updatedState = resolveAssignment(id);
    res.json(updatedState);
  } catch (error) {
    console.error("Error resolving assignment:", error);
    res.status(500).json({ error: "Failed to resolve assignment" });
  }
});

/**
 * POST /api/assignments/:id/archive
 *
 * Archive an assignment with a generated summary.
 */
router.post("/:id/archive", (req, res) => {
  try {
    const { id } = req.params;
    const lessons = getAllLessons();
    const lesson = lessons.find(l => l.id === id);

    if (!lesson) {
      return res.status(404).json({ error: "Assignment not found" });
    }

    // Get explicitly assigned students for this lesson
    const assignedStudentIds = studentAssignmentStore.getAssignedStudentIds(id);

    const stateRecord = getAssignmentState(id);
    const allSessions = sessionStore.getAll();

    const lessonSessions = allSessions.filter(s => s.lessonId === id);
    const computedState = computeAssignmentState(
      lesson,
      lessonSessions,
      assignedStudentIds,
      stateRecord
    );

    // Generate teacher summary
    const summary = generateTeacherSummary(
      lesson,
      lessonSessions,
      computedState.studentStatuses,
      stateRecord
    );

    const updatedState = archiveAssignmentWithSummary(id, summary);
    res.json(updatedState);
  } catch (error) {
    console.error("Error archiving assignment:", error);
    res.status(500).json({ error: "Failed to archive assignment" });
  }
});

/**
 * POST /api/assignments/:id/restore
 *
 * Restore an archived assignment to active state.
 */
router.post("/:id/restore", (req, res) => {
  try {
    const { id } = req.params;
    const updatedState = restoreAssignment(id);
    res.json(updatedState);
  } catch (error) {
    console.error("Error restoring assignment:", error);
    res.status(500).json({ error: "Failed to restore assignment" });
  }
});

/**
 * POST /api/assignments/auto-archive
 *
 * Check for and process auto-archive candidates.
 * Called periodically (e.g., on dashboard load).
 */
router.post("/auto-archive", (req, res) => {
  try {
    const candidates = getAssignmentsReadyForArchive();
    const archived: string[] = [];

    const lessons = getAllLessons();
    const allSessions = sessionStore.getAll();

    for (const candidate of candidates) {
      const lesson = lessons.find(l => l.id === candidate.assignmentId);
      if (!lesson) continue;

      // Get explicitly assigned students for this lesson
      const assignedStudentIds = studentAssignmentStore.getAssignedStudentIds(candidate.assignmentId);

      // Skip if no assignments
      if (assignedStudentIds.length === 0) continue;

      const lessonSessions = allSessions.filter(s => s.lessonId === candidate.assignmentId);
      const computedState = computeAssignmentState(
        lesson,
        lessonSessions,
        assignedStudentIds,
        candidate
      );

      // Generate summary and archive
      const summary = generateTeacherSummary(
        lesson,
        lessonSessions,
        computedState.studentStatuses,
        candidate
      );

      archiveAssignmentWithSummary(candidate.assignmentId, summary);
      archived.push(candidate.assignmentId);
    }

    res.json({
      checked: candidates.length,
      archived,
    });
  } catch (error) {
    console.error("Error processing auto-archive:", error);
    res.status(500).json({ error: "Failed to process auto-archive" });
  }
});

/**
 * GET /api/assignments/archived/list
 *
 * Get all archived assignments with their summaries.
 */
router.get("/archived/list", (req, res) => {
  try {
    const allStates = getAllAssignmentStates();
    const archivedStates = allStates.filter(s => s.lifecycleState === "archived");

    const lessons = getAllLessons();

    const archivedAssignments = archivedStates.map(state => {
      const lesson = lessons.find(l => l.id === state.assignmentId);
      return {
        assignmentId: state.assignmentId,
        title: lesson?.title || "Unknown",
        archivedAt: state.archivedAt,
        teacherSummary: state.teacherSummary,
        totalStudents: state.teacherSummary?.classPerformance.totalStudents || 0,
        averageScore: state.teacherSummary?.classPerformance.averageScore || 0,
        completionRate: state.teacherSummary?.classPerformance.completionRate || 0,
      };
    });

    res.json(archivedAssignments);
  } catch (error) {
    console.error("Error fetching archived assignments:", error);
    res.status(500).json({ error: "Failed to fetch archived assignments" });
  }
});

export default router;
