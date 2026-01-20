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
 * Action status for teacher workflow.
 * Tracks what action the teacher took on a flagged student.
 */
export type StudentActionStatus = "reviewed" | "reassigned" | "no-action-needed";

export interface StudentAssignment {
  id: string;
  lessonId: string;
  classId: string; // Which class context this assignment was made through
  studentId: string;
  assignedAt: string;
  assignedBy?: string; // For future: teacherId who assigned

  // Completion tracking
  completedAt?: string; // When student completed the assignment
  attempts: number; // Number of times assigned (increments on push)

  // Review tracking
  reviewedAt?: string; // When teacher reviewed this student's work
  reviewedBy?: string; // For future: teacherId who reviewed

  // Action tracking for teacher workflow
  actionStatus?: StudentActionStatus; // What action teacher took
  actionAt?: string; // When action was taken
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
