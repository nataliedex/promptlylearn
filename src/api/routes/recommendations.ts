/**
 * Recommendations API Routes
 *
 * Endpoints for the "What Should I Do Next?" teacher recommendation system.
 */

import { Router } from "express";
import { recommendationStore, RecommendationStore } from "../../stores/recommendationStore";
import { actionOutcomeStore } from "../../stores/actionOutcomeStore";
import {
  refreshRecommendations,
  generateRecommendations,
} from "../../domain/recommendationEngine";
import {
  StudentPerformanceData,
  AssignmentAggregateData,
  RECOMMENDATION_CONFIG,
  FeedbackType,
  BadgeType,
  isBadgeType,
  getBadgeTypeName,
  RecommendationStatus,
  ChecklistActionKey,
  CHECKLIST_ACTIONS,
  isValidChecklistActionKey,
  ChecklistActionEntry,
  SubmitChecklistRequest,
  SubmitChecklistResponse,
} from "../../domain/recommendation";
import { SessionStore } from "../../stores/sessionStore";
import { StudentStore } from "../../stores/studentStore";
import { ClassStore } from "../../stores/classStore";
import { StudentAssignmentStore } from "../../stores/studentAssignmentStore";
import { CoachSessionStore } from "../../stores/coachSessionStore";
import { getAllLessons } from "../../loaders/lessonLoader";
import {
  pushAssignmentBack,
  awardBadge,
  addTeacherNote,
} from "../../stores/actionHandlers";
import { teacherSettingsStore } from "../../stores/teacherSettingsStore";
import { teacherTodoStore } from "../../stores/teacherTodoStore";
import { TeacherTodo } from "../../domain/teacherTodo";

const router = Router();
const sessionStore = new SessionStore();
const studentStore = new StudentStore();
const classStore = new ClassStore();
const studentAssignmentStore = new StudentAssignmentStore();
const coachSessionStore = new CoachSessionStore();

// ============================================
// Data Gathering Helpers
// ============================================

/**
 * Gather student performance data from sessions and related sources
 */
function gatherStudentPerformanceData(): StudentPerformanceData[] {
  const students: StudentPerformanceData[] = [];
  const allSessions = sessionStore.getAll();
  const allStudents = studentStore.getAll();
  const lessons = getAllLessons();

  // Group sessions by student+assignment to get latest attempt
  const sessionsByKey = new Map<string, typeof allSessions>();
  for (const session of allSessions) {
    if (session.status !== "completed") continue;

    const key = `${session.studentId}-${session.lessonId}`;
    const existing = sessionsByKey.get(key) || [];
    existing.push(session);
    sessionsByKey.set(key, existing);
  }

  // Process each student+assignment combination
  for (const [key, sessions] of sessionsByKey) {
    // Sort by completion date, newest first
    sessions.sort((a, b) => {
      const aDate = new Date(a.completedAt || a.startedAt).getTime();
      const bDate = new Date(b.completedAt || b.startedAt).getTime();
      return bDate - aDate;
    });

    const latestSession = sessions[0];
    const previousSession = sessions[1];

    const student = allStudents.find((s) => s.id === latestSession.studentId);
    const lesson = lessons.find((l) => l.id === latestSession.lessonId);
    if (!student || !lesson) continue;

    // Calculate hint usage rate
    const responses = latestSession.submission?.responses || [];
    const hintsUsed = responses.filter((r) => r.hintUsed).length;
    const hintUsageRate = responses.length > 0 ? hintsUsed / responses.length : 0;

    // Get coach intent from coach sessions
    const coachInsights = coachSessionStore.getInsightsForStudent(student.id);
    const coachIntent = coachInsights?.intentLabel;

    // Check for teacher note
    const hasTeacherNote = !!latestSession.educatorNotes;

    // Get previous score if available (rounded to whole number)
    const previousScore = previousSession?.evaluation?.totalScore !== undefined
      ? Math.round(previousSession.evaluation.totalScore)
      : undefined;

    students.push({
      studentId: student.id,
      studentName: student.name,
      assignmentId: lesson.id,
      assignmentTitle: lesson.title,
      score: Math.round(latestSession.evaluation?.totalScore || 0),
      hintUsageRate,
      coachIntent,
      hasTeacherNote,
      completedAt: latestSession.completedAt?.toISOString?.() || latestSession.completedAt as unknown as string,
      previousScore,
    });
  }

  return students;
}

/**
 * Gather assignment aggregate data
 */
function gatherAssignmentAggregates(): AssignmentAggregateData[] {
  const aggregates: AssignmentAggregateData[] = [];
  const lessons = getAllLessons();
  const classes = classStore.getAll();
  const allSessions = sessionStore.getAll();

  for (const lesson of lessons) {
    for (const cls of classes) {
      // Get students in this class assigned to this lesson
      const assignedStudentIds = studentAssignmentStore.getAssignedStudentIds(lesson.id);
      const classStudentIds = cls.studentIds || [];
      const relevantStudentIds = assignedStudentIds.filter((id) => classStudentIds.includes(id));

      if (relevantStudentIds.length === 0) continue;

      // Get completed sessions for this lesson+class
      const completedSessions = allSessions.filter(
        (s) =>
          s.lessonId === lesson.id &&
          relevantStudentIds.includes(s.studentId) &&
          s.status === "completed"
      );

      // Group by student to get latest
      const latestByStudent = new Map<string, typeof completedSessions[0]>();
      for (const session of completedSessions) {
        const existing = latestByStudent.get(session.studentId);
        if (
          !existing ||
          new Date(session.completedAt || session.startedAt) >
            new Date(existing.completedAt || existing.startedAt)
        ) {
          latestByStudent.set(session.studentId, session);
        }
      }

      const latestSessions = Array.from(latestByStudent.values());
      const completedCount = latestSessions.length;
      const scores = latestSessions.map((s) => s.evaluation?.totalScore || 0);
      const averageScore =
        scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

      // Find students needing support
      const studentsNeedingSupport = latestSessions
        .filter((s) => (s.evaluation?.totalScore || 0) < RECOMMENDATION_CONFIG.STRUGGLING_THRESHOLD)
        .map((s) => s.studentId);

      // Calculate days since assigned (approximate - use first assignment date)
      const assignments = studentAssignmentStore.getAssignmentsByClass(lesson.id);
      const classAssignment = assignments.find((a) => a.classId === cls.id);
      const daysSinceAssigned = classAssignment
        ? Math.floor(
            (Date.now() - new Date(classAssignment.assignedAt).getTime()) / (1000 * 60 * 60 * 24)
          )
        : 0;

      aggregates.push({
        assignmentId: lesson.id,
        assignmentTitle: lesson.title,
        classId: cls.id,
        className: cls.name,
        studentCount: relevantStudentIds.length,
        completedCount,
        averageScore,
        studentsNeedingSupport,
        daysSinceAssigned,
      });
    }
  }

  return aggregates;
}

// ============================================
// API Endpoints
// ============================================

/**
 * GET /api/recommendations
 * Returns recommendations sorted by priority with optional status filtering
 *
 * Query params:
 * - status: "active" | "pending" | "resolved" | "all" (default: "active")
 * - limit: number (default: MAX_ACTIVE_RECOMMENDATIONS)
 * - assignmentId: string (optional filter)
 * - includeReviewed: "true" (legacy, same as status=all)
 */
router.get("/", (req, res) => {
  try {
    const { limit, assignmentId, includeReviewed, status } = req.query;

    let recommendations: ReturnType<typeof recommendationStore.getActive>;

    // Handle status filtering
    const statusFilter = status as RecommendationStatus | "all" | undefined;

    if (statusFilter === "all" || includeReviewed === "true") {
      // Return all recommendations
      recommendations = recommendationStore.getAll();
    } else if (statusFilter === "pending") {
      recommendations = recommendationStore.getByStatus("pending");
    } else if (statusFilter === "resolved") {
      recommendations = recommendationStore.getByStatus("resolved");
    } else if (statusFilter === "reviewed") {
      recommendations = recommendationStore.getByStatus("reviewed");
    } else if (statusFilter === "dismissed") {
      recommendations = recommendationStore.getByStatus("dismissed");
    } else {
      // Default: active only
      recommendations = recommendationStore.getActive();
    }

    // Filter by assignment if specified
    if (assignmentId && typeof assignmentId === "string") {
      recommendations = recommendations.filter((r) => r.assignmentId === assignmentId);
    }

    // Sort by priority
    recommendations.sort((a, b) => b.priority - a.priority);

    // Apply limit
    const maxLimit = limit ? parseInt(limit as string, 10) : RECOMMENDATION_CONFIG.MAX_ACTIVE_RECOMMENDATIONS;
    recommendations = recommendations.slice(0, maxLimit);

    const stats = recommendationStore.getStats();

    res.json({
      recommendations,
      stats,
    });
  } catch (error) {
    console.error("Error fetching recommendations:", error);
    res.status(500).json({ error: "Failed to fetch recommendations" });
  }
});

/**
 * POST /api/recommendations/refresh
 * Regenerate recommendations from current data
 */
router.post("/refresh", (req, res) => {
  try {
    const students = gatherStudentPerformanceData();
    const aggregates = gatherAssignmentAggregates();

    const result = refreshRecommendations(students, aggregates, false);

    res.json({
      generated: result.generated,
      pruned: result.pruned,
      studentDataPoints: students.length,
      aggregateDataPoints: aggregates.length,
    });
  } catch (error) {
    console.error("Error refreshing recommendations:", error);
    res.status(500).json({ error: "Failed to refresh recommendations" });
  }
});

/**
 * POST /api/recommendations/:id/review
 * Mark a recommendation as reviewed
 */
router.post("/:id/review", (req, res) => {
  try {
    const { id } = req.params;
    const { reviewedBy } = req.body;

    const recommendation = recommendationStore.markReviewed(id, reviewedBy);

    if (!recommendation) {
      return res.status(404).json({ error: "Recommendation not found" });
    }

    res.json({ success: true, recommendation });
  } catch (error) {
    console.error("Error marking recommendation reviewed:", error);
    res.status(500).json({ error: "Failed to mark recommendation reviewed" });
  }
});

/**
 * POST /api/recommendations/:id/dismiss
 * Dismiss a recommendation (teacher chose to ignore)
 */
router.post("/:id/dismiss", (req, res) => {
  try {
    const { id } = req.params;

    const recommendation = recommendationStore.dismiss(id);

    if (!recommendation) {
      return res.status(404).json({ error: "Recommendation not found" });
    }

    res.json({ success: true, recommendation });
  } catch (error) {
    console.error("Error dismissing recommendation:", error);
    res.status(500).json({ error: "Failed to dismiss recommendation" });
  }
});

/**
 * POST /api/recommendations/:id/feedback
 * Submit feedback on recommendation quality
 */
router.post("/:id/feedback", (req, res) => {
  try {
    const { id } = req.params;
    const { feedback, note } = req.body;

    if (!feedback || !["helpful", "not-helpful"].includes(feedback)) {
      return res.status(400).json({ error: "Invalid feedback value" });
    }

    const recommendation = recommendationStore.addFeedback(id, feedback as FeedbackType, note);

    if (!recommendation) {
      return res.status(404).json({ error: "Recommendation not found" });
    }

    res.json({ success: true, recommendation });
  } catch (error) {
    console.error("Error submitting feedback:", error);
    res.status(500).json({ error: "Failed to submit feedback" });
  }
});

/**
 * GET /api/recommendations/badge-types
 * Get available badge types
 * NOTE: This route must come BEFORE /:id to avoid being captured by the param route
 */
router.get("/badge-types", (req, res) => {
  try {
    const badgeTypes = [
      { id: "progress_star", name: "Progress Star", icon: "⭐", description: "Great effort and progress" },
      { id: "mastery_badge", name: "Mastery Badge", icon: "🏆", description: "Demonstrated understanding" },
      { id: "focus_badge", name: "Focus Badge", icon: "🎯", description: "Stayed on task" },
      { id: "creativity_badge", name: "Creativity Badge", icon: "💡", description: "Showed creative thinking" },
      { id: "collaboration_badge", name: "Collaboration Badge", icon: "🤝", description: "Helped others" },
    ];

    res.json({ badgeTypes });
  } catch (error) {
    console.error("Error fetching badge types:", error);
    res.status(500).json({ error: "Failed to fetch badge types" });
  }
});

/**
 * GET /api/recommendations/:id
 * Get a single recommendation by ID
 */
router.get("/:id", (req, res) => {
  try {
    const recommendation = recommendationStore.load(req.params.id);

    if (!recommendation) {
      return res.status(404).json({ error: "Recommendation not found" });
    }

    res.json(recommendation);
  } catch (error) {
    console.error("Error fetching recommendation:", error);
    res.status(500).json({ error: "Failed to fetch recommendation" });
  }
});

// ============================================
// Teacher Action Endpoints
// ============================================

/**
 * POST /api/recommendations/:id/actions/reassign
 * Push assignment back to student for retry
 */
router.post("/:id/actions/reassign", (req, res) => {
  try {
    const { id } = req.params;
    const { studentId, assignmentId, teacherId = "educator" } = req.body;

    if (!studentId || !assignmentId) {
      return res.status(400).json({ error: "studentId and assignmentId are required" });
    }

    // Get recommendation for previous score tracking
    const recommendation = recommendationStore.load(id);
    const previousScore = recommendation?.triggerData?.signals?.score;

    // Push assignment back
    pushAssignmentBack(studentId, assignmentId);

    // Create outcome with pending status (awaiting student retry)
    const outcome = actionOutcomeStore.save({
      recommendationId: id,
      actionType: "reassign",
      actedBy: teacherId,
      affectedStudentIds: [studentId],
      affectedAssignmentId: assignmentId,
      resolutionStatus: "pending",
      metadata: {
        previousScore: typeof previousScore === "number" ? previousScore : undefined,
      },
    });

    // Mark the recommendation as pending
    recommendationStore.markPending(id, outcome.id);

    res.json({
      success: true,
      action: "reassign",
      studentId,
      assignmentId,
      outcomeId: outcome.id,
      resolutionStatus: "pending",
    });
  } catch (error) {
    console.error("Error reassigning assignment:", error);
    res.status(500).json({ error: "Failed to reassign assignment" });
  }
});

/**
 * POST /api/recommendations/:id/actions/award-badge
 * Award a badge to student
 */
router.post("/:id/actions/award-badge", (req, res) => {
  try {
    const { id } = req.params;
    const { studentId, badgeType, message, assignmentId, teacherId = "educator" } = req.body;

    if (!studentId || !badgeType) {
      return res.status(400).json({ error: "studentId and badgeType are required" });
    }

    // Validate badge type
    if (!isBadgeType(badgeType)) {
      return res.status(400).json({
        error: `Invalid badge type: ${badgeType}. Valid types: progress_star, mastery_badge, focus_badge, creativity_badge, collaboration_badge`,
      });
    }

    // Award badge
    const badge = awardBadge(studentId, badgeType, assignmentId, teacherId, message);

    // Create outcome with completed status (no follow-up needed)
    const outcome = actionOutcomeStore.save({
      recommendationId: id,
      actionType: "award_badge",
      actedBy: teacherId,
      affectedStudentIds: [studentId],
      affectedAssignmentId: assignmentId,
      resolutionStatus: "completed",
      metadata: {
        badgeType,
        badgeMessage: message,
      },
    });

    // Mark the recommendation as resolved
    recommendationStore.markResolved(id, outcome.id, "completed");

    res.json({
      success: true,
      action: "award-badge",
      badge: {
        id: badge.id,
        type: badge.type,
        typeName: getBadgeTypeName(badge.type),
        message: badge.message,
      },
      outcomeId: outcome.id,
      resolutionStatus: "completed",
    });
  } catch (error) {
    console.error("Error awarding badge:", error);
    res.status(500).json({ error: "Failed to award badge" });
  }
});

/**
 * POST /api/recommendations/:id/actions/add-note
 * Add a teacher note to the insight
 */
router.post("/:id/actions/add-note", (req, res) => {
  try {
    const { id } = req.params;
    const { note, teacherId = "educator" } = req.body;

    if (!note) {
      return res.status(400).json({ error: "note is required" });
    }

    const recommendation = recommendationStore.load(id);
    if (!recommendation) {
      return res.status(404).json({ error: "Recommendation not found" });
    }

    // Add note to the insight (if insightId is available, otherwise create one)
    // For now we'll add note to all students in the recommendation
    for (const studentId of recommendation.studentIds) {
      try {
        // Create a simple note insight for each student
        addTeacherNote(`rec-${id}`, note, teacherId);
      } catch {
        // If insight doesn't exist, that's okay - note is still recorded
      }
    }

    // Create outcome with follow_up_needed status (teacher may want to revisit)
    const outcome = actionOutcomeStore.save({
      recommendationId: id,
      actionType: "add_note",
      actedBy: teacherId,
      affectedStudentIds: recommendation.studentIds,
      affectedAssignmentId: recommendation.assignmentId,
      resolutionStatus: "follow_up_needed",
      metadata: {
        noteText: note,
      },
    });

    // Mark the recommendation as resolved with follow_up_needed
    recommendationStore.markResolved(id, outcome.id, "follow_up_needed");

    res.json({
      success: true,
      action: "add-note",
      note,
      outcomeId: outcome.id,
      resolutionStatus: "follow_up_needed",
    });
  } catch (error) {
    console.error("Error adding note:", error);
    res.status(500).json({ error: "Failed to add note" });
  }
});

// ============================================
// Checklist Actions Endpoint
// ============================================

/**
 * POST /api/recommendations/:id/actions/submit-checklist
 * Submit selected checklist actions for a recommendation
 *
 * Request body:
 * - selectedActionKeys: string[] (stable action keys)
 * - noteText?: string (required if add_note is selected)
 * - badgeType?: string (required if award_badge is selected)
 * - badgeMessage?: string (optional message with badge)
 *
 * Response:
 * - success: boolean
 * - recommendation: Updated recommendation object
 * - actionEntries: Array of recorded action entries
 * - systemActionsExecuted: Array of system action keys that were executed
 * - newStatus: The new recommendation status
 */
router.post("/:id/actions/submit-checklist", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      selectedActionKeys,
      noteText,
      badgeType,
      badgeMessage,
      teacherId = "educator",
    } = req.body as SubmitChecklistRequest & { teacherId?: string };

    // Validate recommendation exists
    const recommendation = recommendationStore.load(id);
    if (!recommendation) {
      return res.status(404).json({ error: "Recommendation not found" });
    }

    // Validate selectedActionKeys is an array with at least one item
    if (!Array.isArray(selectedActionKeys) || selectedActionKeys.length === 0) {
      return res.status(400).json({
        error: "selectedActionKeys must be a non-empty array",
      });
    }

    // Validate all action keys
    const invalidKeys = selectedActionKeys.filter(key => !isValidChecklistActionKey(key));
    if (invalidKeys.length > 0) {
      return res.status(400).json({
        error: `Invalid action keys: ${invalidKeys.join(", ")}`,
        validKeys: Object.keys(CHECKLIST_ACTIONS),
      });
    }

    // Validate required fields for specific actions
    if (selectedActionKeys.includes("add_note") && !noteText) {
      return res.status(400).json({
        error: "noteText is required when add_note is selected",
      });
    }

    if (selectedActionKeys.includes("award_badge") && !badgeType) {
      return res.status(400).json({
        error: "badgeType is required when award_badge is selected",
      });
    }

    if (badgeType && !isBadgeType(badgeType)) {
      return res.status(400).json({
        error: `Invalid badge type: ${badgeType}`,
      });
    }

    const now = new Date().toISOString();
    const actionEntries: ChecklistActionEntry[] = [];
    const systemActionsExecuted: ChecklistActionKey[] = [];
    let createsPendingState = false;

    // Process each selected action
    for (const actionKey of selectedActionKeys as ChecklistActionKey[]) {
      const actionConfig = CHECKLIST_ACTIONS[actionKey];

      // Create action entry
      const entry: ChecklistActionEntry = {
        id: `${id}-${actionKey}-${Date.now()}`,
        recommendationId: id,
        actionKey,
        label: actionConfig.label,
        isSystemAction: actionConfig.isSystemAction,
        executedAt: now,
        executedBy: teacherId,
        metadata: {},
      };

      // Execute system actions
      if (actionConfig.isSystemAction) {
        switch (actionKey) {
          case "reassign_student":
            // Reassign to first student (single student recommendation)
            if (recommendation.studentIds.length > 0 && recommendation.assignmentId) {
              pushAssignmentBack(
                recommendation.studentIds[0],
                recommendation.assignmentId
              );
              entry.metadata = {
                affectedStudentIds: [recommendation.studentIds[0]],
                affectedAssignmentId: recommendation.assignmentId,
              };
              systemActionsExecuted.push(actionKey);
              createsPendingState = true;
            }
            break;

          case "assign_practice":
            // For grouped recommendations, this would push practice to all students
            // For now, mark as executed and create pending state
            if (recommendation.studentIds.length > 0 && recommendation.assignmentId) {
              // Push assignment back for all students in the group
              for (const studentId of recommendation.studentIds) {
                pushAssignmentBack(studentId, recommendation.assignmentId);
              }
              entry.metadata = {
                affectedStudentIds: recommendation.studentIds,
                affectedAssignmentId: recommendation.assignmentId,
              };
              systemActionsExecuted.push(actionKey);
              createsPendingState = true;
            }
            break;

          case "award_badge":
            // Award badge to first student
            if (recommendation.studentIds.length > 0 && badgeType) {
              awardBadge(
                recommendation.studentIds[0],
                badgeType as BadgeType,
                recommendation.assignmentId,
                teacherId,
                badgeMessage
              );
              entry.metadata = {
                badgeType,
                badgeMessage,
                affectedStudentIds: [recommendation.studentIds[0]],
              };
              systemActionsExecuted.push(actionKey);
            }
            break;

          case "add_note":
            if (noteText) {
              addTeacherNote(`rec-${id}`, noteText, teacherId);
              entry.metadata = {
                noteText,
                affectedStudentIds: recommendation.studentIds,
              };
              systemActionsExecuted.push(actionKey);
            }
            break;
        }
      }

      actionEntries.push(entry);
    }

    // ============================================
    // Create Teacher To-Dos for soft actions
    // ============================================
    const softActionEntries = actionEntries.filter(e => !e.isSystemAction);
    let createdTodos: TeacherTodo[] = [];

    if (softActionEntries.length > 0) {
      // Get context for the todos (student names, assignment title, class info)
      const studentNames = recommendation.triggerData.signals.studentName as string
        || recommendation.triggerData.signals.studentNames as string
        || recommendation.studentIds.join(", ");
      const assignmentTitle = recommendation.triggerData.signals.assignmentTitle as string
        || undefined;
      const className = recommendation.triggerData.signals.className as string
        || undefined;

      // Create todos for each soft action
      const todoInputs = softActionEntries.map(entry => ({
        teacherId,
        recommendationId: id,
        actionKey: entry.actionKey,
        label: entry.label,
        assignmentId: recommendation.assignmentId,
        assignmentTitle,
        studentIds: recommendation.studentIds,
        studentNames,
        className,
      }));

      createdTodos = teacherTodoStore.createMany(todoInputs);
    }

    // Determine new status
    // - If system actions were executed -> "pending" (awaiting student action)
    // - If only soft actions -> "resolved" (recommendation is handled, todos created)
    let newStatus: RecommendationStatus;
    if (createsPendingState) {
      newStatus = "pending";
    } else {
      newStatus = "resolved";
    }

    // Update the recommendation with submitted actions
    const submittedActions = actionEntries.map(entry => ({
      actionKey: entry.actionKey,
      label: entry.label,
      submittedAt: entry.executedAt,
      submittedBy: entry.executedBy,
    }));

    // Determine resolution status with proper typing
    const resolutionStatus = createsPendingState ? "pending" as const : "completed" as const;

    // Create action outcome
    const outcome = actionOutcomeStore.save({
      recommendationId: id,
      actionType: systemActionsExecuted.length > 0 ? systemActionsExecuted[0] as any : "mark_reviewed",
      actedBy: teacherId,
      affectedStudentIds: recommendation.studentIds,
      affectedAssignmentId: recommendation.assignmentId,
      resolutionStatus,
      metadata: {
        noteText,
        badgeType,
        badgeMessage,
      },
    });

    // Update recommendation status and store submitted actions
    const updatedRecommendation: typeof recommendation = {
      ...recommendation,
      status: newStatus,
      submittedActions: [
        ...(recommendation.submittedActions || []),
        ...submittedActions,
      ],
      outcomeId: outcome.id,
      resolutionStatus,
      resolvedAt: now,
      reviewedAt: now,
      reviewedBy: teacherId,
    };

    recommendationStore.save(updatedRecommendation);

    const response: SubmitChecklistResponse & { createdTodos?: TeacherTodo[] } = {
      success: true,
      recommendation: updatedRecommendation,
      actionEntries,
      systemActionsExecuted,
      newStatus,
      createdTodos: createdTodos.length > 0 ? createdTodos : undefined,
    };

    res.json(response);
  } catch (error) {
    console.error("Error submitting checklist actions:", error);
    res.status(500).json({ error: "Failed to submit checklist actions" });
  }
});

// ============================================
// Settings Endpoints
// ============================================

/**
 * GET /api/recommendations/settings/thresholds
 * Get current threshold settings (merged with defaults)
 */
router.get("/settings/thresholds", (req, res) => {
  try {
    const thresholds = teacherSettingsStore.getThresholds();
    const defaults = teacherSettingsStore.getDefaults();
    const rawSettings = teacherSettingsStore.getRawThresholds();

    res.json({
      current: thresholds,
      defaults,
      customized: rawSettings,
      isCustomized: Object.keys(rawSettings).length > 0,
    });
  } catch (error) {
    console.error("Error getting threshold settings:", error);
    res.status(500).json({ error: "Failed to get threshold settings" });
  }
});

/**
 * PUT /api/recommendations/settings/thresholds
 * Update threshold settings
 */
router.put("/settings/thresholds", (req, res) => {
  try {
    const { teacherId = "educator", ...thresholds } = req.body;

    // Validate that at least one threshold is provided
    const validKeys = [
      "needsSupportScore",
      "needsSupportHintThreshold",
      "developingUpper",
      "developingHintMin",
      "developingHintMax",
      "strongThreshold",
      "escalationHelpRequests",
    ];

    const updates: Record<string, number> = {};
    for (const key of validKeys) {
      if (thresholds[key] !== undefined) {
        updates[key] = thresholds[key];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        error: "No valid threshold settings provided",
        validKeys,
      });
    }

    teacherSettingsStore.updateThresholds(updates, teacherId);

    res.json({
      success: true,
      updated: updates,
      current: teacherSettingsStore.getThresholds(),
    });
  } catch (error) {
    console.error("Error updating threshold settings:", error);
    const message = error instanceof Error ? error.message : "Failed to update threshold settings";
    res.status(400).json({ error: message });
  }
});

/**
 * POST /api/recommendations/settings/thresholds/reset
 * Reset threshold settings to defaults
 */
router.post("/settings/thresholds/reset", (req, res) => {
  try {
    const { teacherId = "educator" } = req.body;

    teacherSettingsStore.resetThresholds(teacherId);

    res.json({
      success: true,
      message: "Threshold settings reset to defaults",
      current: teacherSettingsStore.getThresholds(),
    });
  } catch (error) {
    console.error("Error resetting threshold settings:", error);
    res.status(500).json({ error: "Failed to reset threshold settings" });
  }
});

export default router;
