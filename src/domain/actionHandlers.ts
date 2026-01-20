/**
 * Domain Action Handlers
 *
 * Re-exports action handlers for manipulating domain objects.
 * These methods make dashboards actionable by mutating domain objects
 * and ensuring dashboard summaries update dynamically.
 *
 * Usage:
 *   import { markInsightReviewed, awardBadge } from "./domain/actionHandlers";
 */

// Re-export all action handlers from stores
export {
  // ============================================
  // TEACHER ACTIONS
  // ============================================

  /**
   * Mark an insight as reviewed.
   * - Updates Insight.status to action_taken
   * - Creates a TeacherAction object linked to the Insight
   * - Removes the insight from educator dashboard pending list
   *
   * @param insightId - The insight to mark as reviewed
   * @param teacherId - The teacher taking action
   */
  markInsightReviewed,

  /**
   * Push an assignment back to a student for retry.
   * - Creates a new AssignmentStudent attempt
   * - Tracks previous attempts
   * - Most recent attempt appears first in assignment dashboard
   *
   * @param studentId - The student to push assignment to
   * @param assignmentId - The assignment to retry
   */
  pushAssignmentBack,

  /**
   * Add a teacher note to an insight.
   * - Updates TeacherAction.note linked to insight
   * - Updates summaries for both student and teacher dashboards
   *
   * @param insightId - The insight to add note to
   * @param note - The note content
   * @param teacherId - Optional teacher ID (defaults to "educator")
   */
  addTeacherNote,

  /**
   * Award a badge to a student.
   * - Creates a Badge object linked to student
   * - Optionally links to assignmentId
   * - Adds badge to student's record
   *
   * @param studentId - The student to award badge to
   * @param badgeType - Badge type (e.g., "progress_star", "mastery_badge")
   * @param assignmentId - Optional assignment to link badge to
   * @param teacherId - Optional teacher ID
   * @param message - Optional message for the student
   * @returns The created Badge object
   */
  awardBadge,

  // ============================================
  // STUDENT ACTIONS
  // ============================================

  /**
   * Complete an assignment.
   * - Updates AssignmentStudent.attempts, lastCompletedAt, score
   * - Triggers AI evaluation → generates Insight objects for flagged areas
   *
   * @param studentId - The student completing the assignment
   * @param assignmentId - The assignment being completed
   * @param answers - Array of answers with promptId, response, and optional hintUsed
   * @param score - Optional explicit score (calculated if not provided)
   * @returns The updated AssignmentStudent record
   */
  completeAssignment,

  /**
   * Ask the AI coach a question.
   * - Determines if question is support-seeking or enrichment-seeking
   * - Creates an Insight object linked to student and assignment
   *
   * @param studentId - The student asking
   * @param question - The question text
   * @param assignmentId - Optional assignment context
   * @returns The created Insight object
   */
  askCoach,

  /**
   * Retry an assignment.
   * - Increments AssignmentStudent.attempts
   * - Resets statuses so dashboard summaries update correctly
   *
   * @param studentId - The student retrying
   * @param assignmentId - The assignment to retry
   * @returns The updated AssignmentStudent record
   */
  retryAssignment,

  // ============================================
  // DASHBOARD HELPERS
  // ============================================

  /** Get count of pending insights */
  getPendingInsightsCount,

  /** Get pending insights for a specific student */
  getStudentPendingInsights,

  /** Get pending insights for a specific assignment */
  getAssignmentPendingInsights,

  /** Get all badges for a student */
  getStudentBadges,

  /** Get assignment record for student/assignment pair */
  getAssignmentRecord,

  /** Get all assignment records for a student */
  getStudentAssignments,

  /** Get teacher actions for an insight */
  getInsightActions,

  /** Get recent teacher actions */
  getRecentTeacherActions,

  /** Calculate understanding level for student on assignment */
  getStudentUnderstanding,

  // ============================================
  // BULK OPERATIONS
  // ============================================

  /** Mark all pending insights for an assignment as reviewed */
  markAllAssignmentInsightsReviewed,

  /** Mark all pending insights for a student as reviewed */
  markAllStudentInsightsReviewed,
} from "../stores/actionHandlers";

// Re-export types for convenience
export type { Insight, InsightType, InsightPriority, InsightStatus } from "./insight";
export type { TeacherAction, TeacherActionType, Badge, BadgeType } from "./recommendation";
export type { AssignmentStudent } from "./studentAssignment";
export type { StudentUnderstandingLevel } from "./dashboard";
