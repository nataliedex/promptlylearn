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
import { recommendationStore } from "../../stores/recommendationStore";
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

      // Get earliest assignment date for this lesson
      const earliestAssignedAt = studentAssignmentStore.getEarliestAssignedAt(lesson.id);
      if (earliestAssignedAt) {
        computedState.assignedAt = earliestAssignedAt;
      }

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
 * Also resolves any related global recommendations to ensure consistency.
 */
router.post("/:id/students/:studentId/action", (req, res) => {
  try {
    const { id, studentId } = req.params;
    const { action, teacherId } = req.body;

    if (!action || !["reviewed", "reassigned", "no-action-needed"].includes(action)) {
      return res.status(400).json({ error: "Invalid action. Must be: reviewed, reassigned, or no-action-needed" });
    }

    let result;

    // For reassign, use the pushToStudent method which resets the assignment
    if (action === "reassigned") {
      result = studentAssignmentStore.pushToStudent(id, studentId);
      if (!result) {
        return res.status(404).json({ error: "Assignment not found" });
      }
    } else {
      // For other actions, just mark the action
      result = studentAssignmentStore.markAction(id, studentId, action);
      if (!result) {
        return res.status(404).json({ error: "Assignment not found" });
      }
    }

    // Resolve any related global recommendations for this student+assignment
    // This ensures "What Should I Do Next?" doesn't show insights that have
    // already been addressed at the assignment level
    const resolvedRecommendationIds = recommendationStore.resolveByStudentAssignment(
      studentId,
      id,
      teacherId
    );

    res.json({
      success: true,
      assignment: result,
      resolvedRecommendations: resolvedRecommendationIds.length,
    });
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

// ============================================
// Shared Issues API (Question-Level Grouping)
// ============================================

/**
 * Shared Issue Types
 */
interface SharedIssue {
  type: "question_missed" | "hint_dependent" | "low_score_only";
  questionId?: string;
  questionNumber?: number;
  questionText?: string;
  studentIds: string[];
  studentNames: string[];
  title: string;
  evidence: string;
}

interface SharedIssuesResponse {
  assignmentId: string;
  hasQuestionLevelData: boolean;
  sharedIssues: SharedIssue[];
  lowScoreStudents: {
    studentId: string;
    studentName: string;
    score: number;
  }[];
}

/**
 * GET /api/assignments/:id/shared-issues
 *
 * Computes question-level shared issues for an assignment.
 * Groups students by:
 * 1. Same question missed (outcome = "developing" or "not-attempted")
 * 2. Same hint dependency (used hints on same question)
 *
 * Falls back to low-score-only if no question-level patterns exist.
 */
router.get("/:id/shared-issues", (req, res) => {
  try {
    const { id } = req.params;
    const lessons = getAllLessons();
    const lesson = lessons.find(l => l.id === id);

    if (!lesson) {
      return res.status(404).json({ error: "Assignment not found" });
    }

    const assignedStudentIds = studentAssignmentStore.getAssignedStudentIds(id);
    const allSessions = sessionStore.getAll();
    const allStudents = studentStore.getAll();

    // Get completed sessions for this assignment
    const completedSessions = allSessions.filter(
      s => s.lessonId === id && s.status === "completed"
    );

    // Build student name lookup
    const studentNameMap = new Map<string, string>();
    allStudents.forEach(s => studentNameMap.set(s.id, s.name));

    // Track question-level issues
    // Map: questionId -> { missed: Set<studentId>, hintUsed: Set<studentId> }
    const questionIssues = new Map<string, {
      missed: Set<string>;
      hintUsed: Set<string>;
    }>();

    // Track low-score students (score < 50)
    const lowScoreStudents: { studentId: string; studentName: string; score: number }[] = [];

    // Process each completed session
    for (const session of completedSessions) {
      const studentName = studentNameMap.get(session.studentId) || "Student";
      const score = session.evaluation?.totalScore ?? 100;

      // Track low score students
      if (score < 50) {
        lowScoreStudents.push({
          studentId: session.studentId,
          studentName,
          score: Math.round(score),
        });
      }

      // Process each response
      for (const response of session.submission?.responses || []) {
        const promptId = response.promptId;

        if (!questionIssues.has(promptId)) {
          questionIssues.set(promptId, {
            missed: new Set(),
            hintUsed: new Set(),
          });
        }

        const issues = questionIssues.get(promptId)!;

        // Check if question was "missed" (low score on this question)
        const criteriaScore = session.evaluation?.criteriaScores?.find(
          c => c.criterionId === promptId
        );
        const questionScore = criteriaScore?.score;

        // Consider "missed" if score < 60 or no score recorded
        if (questionScore !== undefined && questionScore < 60) {
          issues.missed.add(session.studentId);
        }

        // Track hint usage
        if (response.hintUsed) {
          issues.hintUsed.add(session.studentId);
        }
      }
    }

    // Build shared issues from question-level data
    const sharedIssues: SharedIssue[] = [];

    // Group by same question missed (2+ students)
    for (const [questionId, issues] of questionIssues) {
      if (issues.missed.size >= 2) {
        const prompt = lesson.prompts.find(p => p.id === questionId);
        const promptIndex = lesson.prompts.findIndex(p => p.id === questionId);
        const studentIds = Array.from(issues.missed);
        const studentNames = studentIds.map(id => studentNameMap.get(id) || "Student");

        // Truncate question text for display
        const questionText = prompt?.input || "";
        const truncatedText = questionText.length > 60
          ? questionText.slice(0, 60) + "..."
          : questionText;

        sharedIssues.push({
          type: "question_missed",
          questionId,
          questionNumber: promptIndex + 1,
          questionText: truncatedText,
          studentIds,
          studentNames,
          title: `${studentIds.length} students missed Question ${promptIndex + 1}`,
          evidence: `"${truncatedText}"`,
        });

        // DEV LOGGING
        if (process.env.NODE_ENV === "development") {
          console.log("[SharedIssues] Question missed:", {
            assignmentId: id,
            questionId,
            questionNumber: promptIndex + 1,
            studentIds,
            studentNames,
          });
        }
      }
    }

    // Group by same hint dependency (2+ students used hints on same question)
    // Only add if not already captured by "missed" for same students
    for (const [questionId, issues] of questionIssues) {
      if (issues.hintUsed.size >= 2) {
        // Check if we already have a "missed" issue for these same students
        const existingMissedIssue = sharedIssues.find(
          si => si.questionId === questionId && si.type === "question_missed"
        );

        // Skip if the hint users are a subset of the missed users
        if (existingMissedIssue) {
          const hintUsers = Array.from(issues.hintUsed);
          const missedUsers = new Set(existingMissedIssue.studentIds);
          const allHintUsersAlreadyCaptured = hintUsers.every(id => missedUsers.has(id));
          if (allHintUsersAlreadyCaptured) continue;
        }

        const prompt = lesson.prompts.find(p => p.id === questionId);
        const promptIndex = lesson.prompts.findIndex(p => p.id === questionId);
        const studentIds = Array.from(issues.hintUsed);
        const studentNames = studentIds.map(id => studentNameMap.get(id) || "Student");

        const questionText = prompt?.input || "";
        const truncatedText = questionText.length > 60
          ? questionText.slice(0, 60) + "..."
          : questionText;

        sharedIssues.push({
          type: "hint_dependent",
          questionId,
          questionNumber: promptIndex + 1,
          questionText: truncatedText,
          studentIds,
          studentNames,
          title: `${studentIds.length} students needed hints on Question ${promptIndex + 1}`,
          evidence: `Used coaching support to complete this question`,
        });

        // DEV LOGGING
        if (process.env.NODE_ENV === "development") {
          console.log("[SharedIssues] Hint dependent:", {
            assignmentId: id,
            questionId,
            questionNumber: promptIndex + 1,
            studentIds,
            studentNames,
          });
        }
      }
    }

    // Sort by number of students (most impactful first)
    sharedIssues.sort((a, b) => b.studentIds.length - a.studentIds.length);

    const hasQuestionLevelData = sharedIssues.length > 0;

    // DEV LOGGING: Summary
    if (process.env.NODE_ENV === "development") {
      console.log("[SharedIssues] Summary:", {
        assignmentId: id,
        hasQuestionLevelData,
        sharedIssuesCount: sharedIssues.length,
        lowScoreStudentsCount: lowScoreStudents.length,
        sharedIssueTypes: sharedIssues.map(si => ({
          type: si.type,
          questionId: si.questionId,
          studentCount: si.studentIds.length,
        })),
      });
    }

    const response: SharedIssuesResponse = {
      assignmentId: id,
      hasQuestionLevelData,
      sharedIssues,
      lowScoreStudents,
    };

    res.json(response);
  } catch (error) {
    console.error("Error fetching shared issues:", error);
    res.status(500).json({ error: "Failed to fetch shared issues" });
  }
});

export default router;
