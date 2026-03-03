/**
 * Coach Analytics API Routes
 *
 * Educator-only endpoints for retrieving coach analytics data.
 * These endpoints are for internal analytics and educator insights only.
 */

import { Router } from "express";
import {
  loadAnalytics,
  getStudentAssignmentAnalytics,
  getAssignmentAnalytics,
  getAnalyticsSummary,
  deriveTeacherInsight,
} from "../../stores/coachAnalyticsStore";
import { AssignmentAttemptAnalytics } from "../../domain/coachAnalytics";
import {
  getStudentAssignmentDerivedInsights,
  getAssignmentDerivedInsights,
  deriveGroupInsights,
} from "../../stores/derivedInsightStore";
import {
  resolveInsight,
  resolveAllInsightsForStudent,
  removeAllResolutionsForStudent,
} from "../../stores/insightResolutionStore";

const router = Router();

// ============================================
// GET /api/educator/assignments/:assignmentId/students/:studentId/analytics
// Retrieve analytics for a specific student's assignment attempts
// ============================================

router.get("/assignments/:assignmentId/students/:studentId/analytics", (req, res) => {
  try {
    const { assignmentId, studentId } = req.params;
    const { attemptId } = req.query;

    if (!assignmentId || !studentId) {
      return res.status(400).json({ error: "assignmentId and studentId are required" });
    }

    // If specific attemptId provided, return that attempt only
    if (attemptId && typeof attemptId === "string") {
      const analytics = loadAnalytics(assignmentId, studentId, attemptId);
      if (!analytics) {
        return res.status(404).json({ error: "Analytics not found for this attempt" });
      }

      // Derive teacher insight
      const insight = deriveTeacherInsight(analytics);

      return res.json({
        analytics,
        teacherInsight: insight,
      });
    }

    // Otherwise return all attempts for this student/assignment
    const allAnalytics = getStudentAssignmentAnalytics(assignmentId, studentId);

    if (allAnalytics.length === 0) {
      return res.json({
        analytics: [],
        message: "No analytics found for this student assignment",
      });
    }

    // Derive insights for each attempt
    const analyticsWithInsights = allAnalytics.map((a) => ({
      analytics: a,
      teacherInsight: deriveTeacherInsight(a),
    }));

    res.json({
      studentId,
      assignmentId,
      attemptCount: allAnalytics.length,
      attempts: analyticsWithInsights,
    });
  } catch (error) {
    console.error("Error retrieving student analytics:", error);
    res.status(500).json({ error: "Failed to retrieve analytics" });
  }
});

// ============================================
// GET /api/educator/assignments/:assignmentId/analytics-summary
// Retrieve rollup analytics summary for an assignment (all students)
// ============================================

router.get("/assignments/:assignmentId/analytics-summary", (req, res) => {
  try {
    const { assignmentId } = req.params;

    if (!assignmentId) {
      return res.status(400).json({ error: "assignmentId is required" });
    }

    const summary = getAnalyticsSummary(assignmentId);

    res.json({
      assignmentId,
      summary,
    });
  } catch (error) {
    console.error("Error retrieving analytics summary:", error);
    res.status(500).json({ error: "Failed to retrieve analytics summary" });
  }
});

// ============================================
// GET /api/educator/assignments/:assignmentId/analytics
// Retrieve full analytics for an assignment (all students, all attempts)
// For detailed educator review or debugging
// ============================================

router.get("/assignments/:assignmentId/analytics", (req, res) => {
  try {
    const { assignmentId } = req.params;
    const { includeInsights } = req.query;

    if (!assignmentId) {
      return res.status(400).json({ error: "assignmentId is required" });
    }

    const allAnalytics = getAssignmentAnalytics(assignmentId);

    if (allAnalytics.length === 0) {
      return res.json({
        assignmentId,
        analytics: [],
        message: "No analytics found for this assignment",
      });
    }

    // Optionally include derived insights
    if (includeInsights === "true") {
      const analyticsWithInsights = allAnalytics.map((a) => ({
        analytics: a,
        teacherInsight: deriveTeacherInsight(a),
      }));

      return res.json({
        assignmentId,
        totalAttempts: allAnalytics.length,
        uniqueStudents: new Set(allAnalytics.map((a) => a.studentId)).size,
        analytics: analyticsWithInsights,
      });
    }

    res.json({
      assignmentId,
      totalAttempts: allAnalytics.length,
      uniqueStudents: new Set(allAnalytics.map((a) => a.studentId)).size,
      analytics: allAnalytics,
    });
  } catch (error) {
    console.error("Error retrieving assignment analytics:", error);
    res.status(500).json({ error: "Failed to retrieve analytics" });
  }
});

// ============================================
// GET /api/educator/analytics/question/:questionId
// Retrieve analytics aggregated by question across all attempts
// Useful for identifying commonly problematic questions
// ============================================

router.get("/analytics/question/:questionId", (req, res) => {
  try {
    const { questionId } = req.params;
    const { assignmentId } = req.query;

    if (!questionId) {
      return res.status(400).json({ error: "questionId is required" });
    }

    // Get all analytics (optionally filtered by assignment)
    let allAnalytics: AssignmentAttemptAnalytics[];
    if (assignmentId && typeof assignmentId === "string") {
      allAnalytics = getAssignmentAnalytics(assignmentId);
    } else {
      // Would need to scan all files - for now require assignmentId
      return res.status(400).json({ error: "assignmentId query parameter is required" });
    }

    // Extract question analytics for the specified questionId
    const questionAnalytics = allAnalytics.flatMap((a) =>
      a.questionAnalytics
        .filter((q) => q.questionId === questionId)
        .map((q) => ({
          studentId: a.studentId,
          attemptId: a.attemptId,
          questionAnalytics: q,
        }))
    );

    if (questionAnalytics.length === 0) {
      return res.json({
        questionId,
        analytics: [],
        message: "No analytics found for this question",
      });
    }

    // Calculate aggregates
    const totalAttempts = questionAnalytics.length;
    const misconceptionCount = questionAnalytics.filter((q) => q.questionAnalytics.misconceptionDetected).length;
    const moveOnCount = questionAnalytics.filter((q) => q.questionAnalytics.moveOnTriggered).length;
    const masteryCount = questionAnalytics.filter((q) =>
      q.questionAnalytics.outcomeTag.startsWith("mastery")
    ).length;

    // Aggregate misconception types
    const misconceptionTypes: Record<string, number> = {};
    for (const q of questionAnalytics) {
      if (q.questionAnalytics.misconceptionType) {
        misconceptionTypes[q.questionAnalytics.misconceptionType] =
          (misconceptionTypes[q.questionAnalytics.misconceptionType] || 0) + 1;
      }
    }

    // Aggregate stagnation reasons
    const stagnationReasons: Record<string, number> = {};
    for (const q of questionAnalytics) {
      if (q.questionAnalytics.stagnationReason) {
        stagnationReasons[q.questionAnalytics.stagnationReason] =
          (stagnationReasons[q.questionAnalytics.stagnationReason] || 0) + 1;
      }
    }

    res.json({
      questionId,
      assignmentId,
      summary: {
        totalAttempts,
        masteryCount,
        masteryRate: Math.round((masteryCount / totalAttempts) * 100),
        misconceptionCount,
        misconceptionRate: Math.round((misconceptionCount / totalAttempts) * 100),
        moveOnCount,
        moveOnRate: Math.round((moveOnCount / totalAttempts) * 100),
        avgTimeMs: Math.round(
          questionAnalytics.reduce((sum, q) => sum + q.questionAnalytics.timeSpentMs, 0) / totalAttempts
        ),
        avgHints: Math.round(
          (questionAnalytics.reduce((sum, q) => sum + q.questionAnalytics.hintCount, 0) / totalAttempts) * 10
        ) / 10,
      },
      misconceptionBreakdown: misconceptionTypes,
      stagnationBreakdown: stagnationReasons,
      attempts: questionAnalytics,
    });
  } catch (error) {
    console.error("Error retrieving question analytics:", error);
    res.status(500).json({ error: "Failed to retrieve question analytics" });
  }
});

// ============================================
// GET /api/educator/analytics/misconceptions
// Retrieve aggregated misconception data across assignments
// ============================================

router.get("/analytics/misconceptions", (req, res) => {
  try {
    const { assignmentId, classId } = req.query;

    if (!assignmentId || typeof assignmentId !== "string") {
      return res.status(400).json({ error: "assignmentId query parameter is required" });
    }

    const allAnalytics = getAssignmentAnalytics(assignmentId);

    // Filter by classId if provided
    let filteredAnalytics = allAnalytics;
    if (classId && typeof classId === "string") {
      filteredAnalytics = allAnalytics.filter((a) => a.classId === classId);
    }

    // Aggregate misconceptions
    const misconceptions: Array<{
      studentId: string;
      questionId: string;
      questionIndex: number;
      misconceptionType: string;
      misconceptionConfidence: string;
      attemptId: string;
    }> = [];

    for (const a of filteredAnalytics) {
      for (const q of a.questionAnalytics) {
        if (q.misconceptionDetected && q.misconceptionType) {
          misconceptions.push({
            studentId: a.studentId,
            questionId: q.questionId,
            questionIndex: q.questionIndex,
            misconceptionType: q.misconceptionType,
            misconceptionConfidence: q.misconceptionConfidence,
            attemptId: a.attemptId,
          });
        }
      }
    }

    // Group by type
    const byType: Record<string, number> = {};
    for (const m of misconceptions) {
      byType[m.misconceptionType] = (byType[m.misconceptionType] || 0) + 1;
    }

    // Group by question
    const byQuestion: Record<string, number> = {};
    for (const m of misconceptions) {
      byQuestion[m.questionId] = (byQuestion[m.questionId] || 0) + 1;
    }

    res.json({
      assignmentId,
      classId: classId || null,
      totalMisconceptions: misconceptions.length,
      byType,
      byQuestion,
      details: misconceptions,
    });
  } catch (error) {
    console.error("Error retrieving misconception analytics:", error);
    res.status(500).json({ error: "Failed to retrieve misconception analytics" });
  }
});

// ============================================
// GET /api/educator/assignments/:assignmentId/students/:studentId/derived-insights
// Retrieve derived teacher insights for a specific student assignment
// ============================================

router.get("/assignments/:assignmentId/students/:studentId/derived-insights", (req, res) => {
  try {
    const { assignmentId, studentId } = req.params;

    if (!assignmentId || !studentId) {
      return res.status(400).json({ error: "assignmentId and studentId are required" });
    }

    const insights = getStudentAssignmentDerivedInsights(assignmentId, studentId);

    res.json({
      assignmentId,
      studentId,
      insightCount: insights.length,
      insights,
    });
  } catch (error) {
    console.error("Error retrieving derived insights:", error);
    res.status(500).json({ error: "Failed to retrieve derived insights" });
  }
});

// ============================================
// GET /api/educator/assignments/:assignmentId/derived-insights
// Retrieve derived insights for all students in an assignment (compact)
// ============================================

router.get("/assignments/:assignmentId/derived-insights", (req, res) => {
  try {
    const { assignmentId } = req.params;
    const { severity, type } = req.query;

    if (!assignmentId) {
      return res.status(400).json({ error: "assignmentId is required" });
    }

    let insights = getAssignmentDerivedInsights(assignmentId);

    // Filter by severity if provided
    if (severity && typeof severity === "string") {
      insights = insights.filter((i) => i.severity === severity);
    }

    // Filter by type if provided
    if (type && typeof type === "string") {
      insights = insights.filter((i) => i.type === type);
    }

    // Group by student for compact view
    const byStudent: Record<string, typeof insights> = {};
    for (const insight of insights) {
      if (!byStudent[insight.studentId]) {
        byStudent[insight.studentId] = [];
      }
      byStudent[insight.studentId].push(insight);
    }

    res.json({
      assignmentId,
      totalInsights: insights.length,
      uniqueStudents: Object.keys(byStudent).length,
      insights,
      byStudent,
    });
  } catch (error) {
    console.error("Error retrieving assignment derived insights:", error);
    res.status(500).json({ error: "Failed to retrieve derived insights" });
  }
});

// ============================================
// GET /api/educator/assignments/:assignmentId/group-insights
// Retrieve group-level insights for an assignment (class patterns)
// ============================================

router.get("/assignments/:assignmentId/group-insights", (req, res) => {
  try {
    const { assignmentId } = req.params;

    if (!assignmentId) {
      return res.status(400).json({ error: "assignmentId is required" });
    }

    const groupInsights = deriveGroupInsights(assignmentId);

    res.json({
      assignmentId,
      insightCount: groupInsights.length,
      insights: groupInsights,
    });
  } catch (error) {
    console.error("Error retrieving group insights:", error);
    res.status(500).json({ error: "Failed to retrieve group insights" });
  }
});

// ============================================
// POST /api/educator/assignments/:assignmentId/students/:studentId/resolve-insight
// Mark a specific insight as resolved
// ============================================

router.post("/assignments/:assignmentId/students/:studentId/resolve-insight", (req, res) => {
  try {
    const { assignmentId, studentId } = req.params;
    const { insightId, attemptId, reason } = req.body;

    if (!assignmentId || !studentId || !insightId) {
      return res.status(400).json({ error: "assignmentId, studentId, and insightId are required" });
    }

    const resolution = resolveInsight(
      insightId,
      assignmentId,
      studentId,
      attemptId || "unknown",
      "resolved",
      reason || "manual"
    );

    res.json({
      success: true,
      resolution,
    });
  } catch (error) {
    console.error("Error resolving insight:", error);
    res.status(500).json({ error: "Failed to resolve insight" });
  }
});

// ============================================
// POST /api/educator/assignments/:assignmentId/students/:studentId/resolve-all-insights
// Mark all insights for a student-assignment as resolved
// ============================================

router.post("/assignments/:assignmentId/students/:studentId/resolve-all-insights", (req, res) => {
  try {
    const { assignmentId, studentId } = req.params;
    const { reason } = req.body;

    if (!assignmentId || !studentId) {
      return res.status(400).json({ error: "assignmentId and studentId are required" });
    }

    const count = resolveAllInsightsForStudent(
      assignmentId,
      studentId,
      reason || "mark_reviewed"
    );

    res.json({
      success: true,
      resolvedCount: count,
    });
  } catch (error) {
    console.error("Error resolving all insights:", error);
    res.status(500).json({ error: "Failed to resolve insights" });
  }
});

// ============================================
// POST /api/educator/assignments/:assignmentId/students/:studentId/reactivate-insights
// Remove all resolutions for a student (used when reopening for review)
// ============================================

router.post("/assignments/:assignmentId/students/:studentId/reactivate-insights", (req, res) => {
  try {
    const { assignmentId, studentId } = req.params;

    if (!assignmentId || !studentId) {
      return res.status(400).json({ error: "assignmentId and studentId are required" });
    }

    const count = removeAllResolutionsForStudent(assignmentId, studentId);

    res.json({
      success: true,
      reactivatedCount: count,
    });
  } catch (error) {
    console.error("Error reactivating insights:", error);
    res.status(500).json({ error: "Failed to reactivate insights" });
  }
});

export default router;
