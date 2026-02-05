/**
 * Student Assignment Domain Model
 *
 * Tracks which students are assigned to which lessons through which class.
 * This enables:
 * - Assigning lessons to specific students (not all students)
 * - Knowing which class context an assignment was made through
 * - Dashboard metrics that only count assigned students
 * - Tracking multiple attempts per student per assignment
 *
 * Note: A Session is created when a student STARTS working.
 * A StudentAssignment is created when a teacher ASSIGNS the lesson.
 */

/**
 * Legacy action status for teacher workflow.
 * @deprecated Use ReviewState instead for new code.
 */
export type StudentActionStatus = "reviewed" | "reassigned" | "no-action-needed" | "badge-awarded";

/**
 * Canonical Review State - Single Source of Truth
 *
 * Each student-assignment pair has ONE state, DERIVED from underlying data:
 * - not_started: Student has not submitted work yet
 * - pending_review: Student completed, teacher hasn't reviewed
 * - reviewed: Teacher reviewed, no follow-up scheduled
 * - followup_scheduled: Teacher reviewed + at least one open follow-up
 * - resolved: All follow-ups completed/dismissed
 *
 * These states are computed via deriveReviewState() rather than stored directly.
 */
export type ReviewState =
  | "not_started"
  | "pending_review"
  | "reviewed"
  | "followup_scheduled"
  | "resolved";

/**
 * Display labels for each review state
 */
export const REVIEW_STATE_LABELS: Record<ReviewState, string> = {
  not_started: "Not started",
  pending_review: "Awaiting review",
  reviewed: "Reviewed",
  followup_scheduled: "Follow-up scheduled",
  resolved: "Reviewed",
};

/**
 * UI configuration for review state badges
 */
export const REVIEW_STATE_CONFIG: Record<ReviewState, { bg: string; color: string; icon: string }> = {
  not_started: { bg: "#f1f5f9", color: "#64748b", icon: "" },
  pending_review: { bg: "#fff7ed", color: "#ea580c", icon: "" },
  reviewed: { bg: "#e8f5e9", color: "#166534", icon: "✓" },
  followup_scheduled: { bg: "#fef3c7", color: "#b45309", icon: "📋" },
  resolved: { bg: "#e8f5e9", color: "#166534", icon: "✓" },
};

/**
 * Derive the review state from underlying data.
 * This is the SINGLE SOURCE OF TRUTH for determining a student's review state.
 * States are computed, not stored, to prevent drift.
 *
 * @param hasCompleted - Student has submitted work
 * @param hasBeenReviewed - Teacher has opened/reviewed the submission
 * @param openTodoCount - Number of open follow-up todos
 * @param completedTodoCount - Number of completed todos
 * @param hasBadgeOrNote - Badge awarded or note added as follow-up
 */
export function deriveReviewState(
  hasCompleted: boolean,
  hasBeenReviewed: boolean,
  openTodoCount: number,
  completedTodoCount: number,
  hasBadgeOrNote: boolean
): ReviewState {
  // 1. Pre-submission
  if (!hasCompleted) return "not_started";

  // 2. Awaiting teacher review
  if (!hasBeenReviewed) return "pending_review";

  // 3. Has open follow-ups
  if (openTodoCount > 0) return "followup_scheduled";

  // 4. Had follow-ups, all resolved
  if (completedTodoCount > 0 || hasBadgeOrNote) return "resolved";

  // 5. Reviewed without creating follow-ups
  return "reviewed";
}

/**
 * Get the display label for a review state
 */
export function getReviewStateLabel(state: ReviewState): string {
  return REVIEW_STATE_LABELS[state] || state;
}

/**
 * Check if a review state indicates the submission has been seen by teacher
 */
export function isReviewed(state: ReviewState): boolean {
  return state !== "not_started" && state !== "pending_review";
}

/**
 * Check if a review state has an associated follow-up
 */
export function hasFollowup(state: ReviewState): boolean {
  return state === "followup_scheduled";
}

/**
 * Check if a review state is considered complete (reviewed or resolved)
 */
export function isComplete(state: ReviewState): boolean {
  return state === "reviewed" || state === "resolved";
}

export interface StudentAssignment {
  id: string;
  lessonId: string;
  classId: string; // Which class context this assignment was made through
  studentId: string;
  assignedAt: string;
  assignedBy?: string; // For future: teacherId who assigned
  dueDate?: string; // Optional due date (ISO string, date only)

  // Completion tracking
  completedAt?: string; // When student completed the assignment
  attempts: number; // Number of times assigned (increments on push)

  // ============================================
  // NEW: Single Source of Truth for Review State
  // ============================================
  reviewState: ReviewState; // Canonical state

  // Review metadata
  reviewedAt?: string; // When teacher first reviewed this student's work
  reviewedBy?: string; // Teacher who reviewed

  // Action metadata (when reviewState has an action)
  lastActionAt?: string; // When last action was taken

  // Linked data IDs (for lookups)
  todoIds?: string[]; // Follow-up todos created for this assignment
  badgeIds?: string[]; // Badges awarded for this assignment

  // ============================================
  // DEPRECATED: Legacy fields for backwards compatibility
  // These will be removed in a future version
  // ============================================
  /** @deprecated Use reviewState instead */
  actionStatus?: StudentActionStatus;
  /** @deprecated Use lastActionAt instead */
  actionAt?: string;
}

// ============================================
// Assignment Student - Per-Student Progress Tracking
// ============================================

/**
 * AssignmentStudent - Tracks per-student progress on an assignment
 *
 * This is a lightweight interface for tracking attempts, scores, and completion
 * at the student-assignment level. Used for:
 * - Tracking multiple attempts
 * - Recording scores per attempt
 * - Generating insights based on performance
 */
export interface AssignmentStudent {
  studentId: string;
  assignmentId: string;

  // Attempt tracking
  attempts: number; // Number of times attempted
  currentAttempt?: number; // Current attempt number (for in-progress tracking)

  // Score tracking
  score?: number; // Latest score (0-100)
  highestScore?: number; // Best score across all attempts

  // Completion tracking
  startedAt?: Date; // When student first started
  lastCompletedAt?: Date;
  firstCompletedAt?: Date;

  // Support usage (for insight generation)
  hintsUsed?: number;
  coachSessionCount?: number;
  totalTimeSpent?: number; // Total seconds spent
}

/**
 * Create a new AssignmentStudent record
 */
export function createAssignmentStudent(
  studentId: string,
  assignmentId: string
): AssignmentStudent {
  return {
    studentId,
    assignmentId,
    attempts: 0,
  };
}

/**
 * Record a completed attempt
 */
export function recordAttempt(
  record: AssignmentStudent,
  score: number,
  timeSpent?: number
): AssignmentStudent {
  const now = new Date();
  return {
    ...record,
    attempts: record.attempts + 1,
    score,
    highestScore: Math.max(record.highestScore || 0, score),
    lastCompletedAt: now,
    firstCompletedAt: record.firstCompletedAt || now,
    totalTimeSpent: (record.totalTimeSpent || 0) + (timeSpent || 0),
  };
}

/**
 * Convenience type for querying - represents all students assigned
 * to a lesson through a specific class
 */
export interface LessonClassAssignment {
  lessonId: string;
  classId: string;
  className?: string; // Denormalized for convenience
  studentIds: string[];
  assignedAt: string;
}

/**
 * Input type for assigning a lesson to a class
 */
export interface AssignLessonInput {
  classId: string;
  studentIds?: string[]; // If omitted, assigns to ALL students in class
}

/**
 * Summary of assignments for a lesson
 */
export interface LessonAssignmentSummary {
  lessonId: string;
  totalAssigned: number;
  assignmentsByClass: {
    classId: string;
    className: string;
    studentCount: number;
    assignedAt: string;
  }[];
}
