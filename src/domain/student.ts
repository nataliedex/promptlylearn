/**
 * Student Domain Model
 *
 * Students log in using a unique studentCode (human-typable identifier).
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

  // Unique login code for student access (e.g., "ABC123")
  // Human-typable, case-insensitive, educator can regenerate
  studentCode?: string;

  // True if this student was created via demo mode (not a real roster student)
  isDemo?: boolean;

  // Name the coach (and other student-facing UI) should use.
  // Falls back to first token of `name` when absent.
  preferredName?: string;

  // Optional pronouns (e.g. "she/her", "he/him", "they/them").
  // Used only when present; never invented.
  pronouns?: string;

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
