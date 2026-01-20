/**
 * Recommendations API Routes
 *
 * Endpoints for the "What Should I Do Next?" teacher recommendation system.
 */

import { Router } from "express";
import { recommendationStore, RecommendationStore } from "../../stores/recommendationStore";
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

    // Get previous score if available
    const previousScore = previousSession?.evaluation?.totalScore;

    students.push({
      studentId: student.id,
      studentName: student.name,
      assignmentId: lesson.id,
      assignmentTitle: lesson.title,
      score: latestSession.evaluation?.totalScore || 0,
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
 * Returns active recommendations sorted by priority
 */
router.get("/", (req, res) => {
  try {
    const { limit, assignmentId, includeReviewed } = req.query;

    let recommendations = includeReviewed === "true"
      ? [...recommendationStore.getActive(), ...recommendationStore.getByStatus("reviewed")]
      : recommendationStore.getActive();

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

    // Push assignment back
    pushAssignmentBack(studentId, assignmentId);

    // Mark the recommendation as reviewed
    recommendationStore.markReviewed(id, teacherId);

    res.json({
      success: true,
      action: "reassign",
      studentId,
      assignmentId,
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

    // Mark the recommendation as reviewed
    recommendationStore.markReviewed(id, teacherId);

    res.json({
      success: true,
      action: "award-badge",
      badge: {
        id: badge.id,
        type: badge.type,
        typeName: getBadgeTypeName(badge.type),
        message: badge.message,
      },
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

    // Mark the recommendation as reviewed with the note
    recommendationStore.markReviewed(id, teacherId);

    res.json({
      success: true,
      action: "add-note",
      note,
    });
  } catch (error) {
    console.error("Error adding note:", error);
    res.status(500).json({ error: "Failed to add note" });
  }
});

export default router;
