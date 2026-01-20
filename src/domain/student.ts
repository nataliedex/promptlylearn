/**
 * Student Domain Model
 *
 * Simple by design - students do NOT need logins at this stage.
 * A student can belong to one or more classes.
 *
 * Relationships:
 * - Student belongs to Classes (via classes array)
 * - Student has Assignments (via assignments array)
 * - Student can have Insights generated about them
 * - Student can earn Badges
 */

export interface Student {
  id: string;
  name: string;

  // Relationship arrays for easy lookups
  classes: string[]; // Array of classIds this student belongs to
  assignments: string[]; // Array of assignmentIds assigned to this student

  // Optional private notes for teacher (IEP, ESL, accommodations, etc.)
  // This is teacher-only information, never shown to students
  notes?: string;

  createdAt: Date;
}

/**
 * Input type for creating a new student
 */
export interface CreateStudentInput {
  name: string;
  classIds?: string[];
  notes?: string;
}

/**
 * Input type for updating a student
 */
export interface UpdateStudentInput {
  name?: string;
  notes?: string;
}

/**
 * Student with badge count for dashboard display
 */
export interface StudentWithBadges extends Student {
  badgeCount: number;
  recentBadges?: string[]; // Badge IDs
}
