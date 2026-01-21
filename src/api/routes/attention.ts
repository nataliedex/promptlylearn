/**
 * Attention State API Routes
 *
 * Provides a single source of truth for "needs attention" state
 * across all dashboard sections.
 */

import { Router } from "express";
import { recommendationStore } from "../../stores/recommendationStore";
import { StudentStore } from "../../stores/studentStore";
import { ClassStore } from "../../stores/classStore";
import { StudentAssignmentStore } from "../../stores/studentAssignmentStore";
import { getAllLessons } from "../../loaders/lessonLoader";
import {
  getStudentsNeedingAttention,
  getAssignmentAttentionSummary,
  getDashboardAttentionState,
  StudentAttentionStatus,
  AssignmentAttentionSummary,
  DashboardAttentionState,
} from "../../domain/attentionState";

const router = Router();
const studentStore = new StudentStore();
const classStore = new ClassStore();
const studentAssignmentStore = new StudentAssignmentStore();

// ============================================
// Helper Functions
// ============================================

/**
 * Build student ID -> name map
 */
function buildStudentMap(): Map<string, string> {
  const students = studentStore.getAll();
  const map = new Map<string, string>();
  for (const student of students) {
    map.set(student.id, student.name);
  }
  return map;
}

/**
 * Get assignment info (id, title, total students)
 */
function getAssignmentInfo(): Array<{ id: string; title: string; totalStudents: number }> {
  const lessons = getAllLessons();
  return lessons.map((lesson) => {
    const assignedStudentIds = studentAssignmentStore.getAssignedStudentIds(lesson.id);
    return {
      id: lesson.id,
      title: lesson.title,
      totalStudents: assignedStudentIds.length,
    };
  });
}

// ============================================
// API Endpoints
// ============================================

/**
 * GET /api/attention
 * Get full dashboard attention state
 *
 * Returns:
 * - studentsNeedingAttention: All students with active recommendations
 * - totalNeedingAttention: Count of students needing attention
 * - assignmentSummaries: Attention summary per assignment
 * - pendingCount: Number of pending recommendations
 */
router.get("/", (req, res) => {
  try {
    const recommendations = recommendationStore.getAll();
    const studentMap = buildStudentMap();
    const assignmentInfo = getAssignmentInfo();

    const state = getDashboardAttentionState(recommendations, studentMap, assignmentInfo);

    res.json(state);
  } catch (error) {
    console.error("Error getting attention state:", error);
    res.status(500).json({ error: "Failed to get attention state" });
  }
});

/**
 * GET /api/attention/students
 * Get students needing attention with optional filtering
 *
 * Query params:
 * - assignmentId: Filter to specific assignment
 * - classId: Filter to specific class
 */
router.get("/students", (req, res) => {
  try {
    const { assignmentId, classId } = req.query;

    const recommendations = recommendationStore.getAll();
    const studentMap = buildStudentMap();

    // Get class student IDs if filtering by class
    let classStudentIds: string[] | undefined;
    if (classId && typeof classId === "string") {
      const cls = classStore.load(classId);
      if (cls) {
        classStudentIds = cls.studentIds;
      }
    }

    const students = getStudentsNeedingAttention(recommendations, studentMap, {
      assignmentId: typeof assignmentId === "string" ? assignmentId : undefined,
      classStudentIds,
    });

    res.json({
      students,
      count: students.length,
    });
  } catch (error) {
    console.error("Error getting students needing attention:", error);
    res.status(500).json({ error: "Failed to get students needing attention" });
  }
});

/**
 * GET /api/attention/assignment/:assignmentId
 * Get attention summary for a specific assignment
 */
router.get("/assignment/:assignmentId", (req, res) => {
  try {
    const { assignmentId } = req.params;

    const recommendations = recommendationStore.getAll();
    const studentMap = buildStudentMap();
    const lessons = getAllLessons();
    const lesson = lessons.find((l) => l.id === assignmentId);

    if (!lesson) {
      return res.status(404).json({ error: "Assignment not found" });
    }

    const assignedStudentIds = studentAssignmentStore.getAssignedStudentIds(assignmentId);

    const summary = getAssignmentAttentionSummary(
      recommendations,
      assignmentId,
      lesson.title,
      studentMap,
      assignedStudentIds.length
    );

    res.json(summary);
  } catch (error) {
    console.error("Error getting assignment attention summary:", error);
    res.status(500).json({ error: "Failed to get assignment attention summary" });
  }
});

/**
 * GET /api/attention/counts
 * Get attention counts for dashboard badges
 *
 * Returns:
 * - totalNeedingAttention: Total students needing attention
 * - pendingCount: Number of pending recommendations
 * - byAssignment: Map of assignmentId -> count
 */
router.get("/counts", (req, res) => {
  try {
    const recommendations = recommendationStore.getAll();
    const studentMap = buildStudentMap();

    // Get all students needing attention
    const studentsNeedingAttention = getStudentsNeedingAttention(recommendations, studentMap);

    // Count pending
    const pendingCount = recommendations.filter((r) => r.status === "pending").length;

    // Count by assignment
    const byAssignment: Record<string, number> = {};
    for (const rec of recommendations) {
      if (rec.status === "active" && rec.assignmentId) {
        byAssignment[rec.assignmentId] = (byAssignment[rec.assignmentId] || 0) + rec.studentIds.length;
      }
    }

    res.json({
      totalNeedingAttention: studentsNeedingAttention.length,
      pendingCount,
      byAssignment,
    });
  } catch (error) {
    console.error("Error getting attention counts:", error);
    res.status(500).json({ error: "Failed to get attention counts" });
  }
});

/**
 * GET /api/attention/student/:studentId
 * Check if a specific student needs attention
 *
 * Query params:
 * - assignmentId: Optional - check for specific assignment only
 */
router.get("/student/:studentId", (req, res) => {
  try {
    const { studentId } = req.params;
    const { assignmentId } = req.query;

    const recommendations = recommendationStore.getAll();

    // Filter recommendations for this student
    let studentRecs = recommendations.filter((r) => r.studentIds.includes(studentId));

    if (assignmentId && typeof assignmentId === "string") {
      studentRecs = studentRecs.filter((r) => r.assignmentId === assignmentId);
    }

    const activeRecs = studentRecs.filter((r) => r.status === "active");
    const pendingRecs = studentRecs.filter((r) => r.status === "pending");

    res.json({
      studentId,
      needsAttention: activeRecs.length > 0,
      activeRecommendationCount: activeRecs.length,
      pendingRecommendationCount: pendingRecs.length,
      activeRecommendationIds: activeRecs.map((r) => r.id),
      pendingRecommendationIds: pendingRecs.map((r) => r.id),
    });
  } catch (error) {
    console.error("Error checking student attention:", error);
    res.status(500).json({ error: "Failed to check student attention" });
  }
});

export default router;
