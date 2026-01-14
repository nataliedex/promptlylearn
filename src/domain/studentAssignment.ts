/**
 * Student Assignment Domain Model
 *
 * Tracks which students are assigned to which lessons through which class.
 * This enables:
 * - Assigning lessons to specific students (not all students)
 * - Knowing which class context an assignment was made through
 * - Dashboard metrics that only count assigned students
 *
 * Note: A Session is created when a student STARTS working.
 * A StudentAssignment is created when a teacher ASSIGNS the lesson.
 */

export interface StudentAssignment {
  id: string;
  lessonId: string;
  classId: string; // Which class context this assignment was made through
  studentId: string;
  assignedAt: string;
  assignedBy?: string; // For future: teacherId who assigned
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
