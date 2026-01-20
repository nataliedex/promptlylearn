/**
 * Class / Section Domain Model
 *
 * Teachers think in classes/sections, not individual students.
 * The system should not force a structure - teachers define what a class means.
 *
 * Examples:
 * - Elementary: "2025-2026 Mrs. Smith's Class"
 * - Middle school: "6th Grade Math"
 * - High school: "Period 1 - 9th Grade English"
 *
 * Relationships:
 * - Class belongs to a Teacher (via teacherId)
 * - Class has Students (via students array)
 * - Class has Subjects that can be taught
 * - Assignments are made to students through a Class context
 */

export interface Class {
  id: string;
  name: string; // Required, free text - teacher defines meaning
  teacherId: string; // Required: which teacher owns this class

  // Student membership
  students: string[]; // Array of studentIds in this class
  studentIds: string[]; // Legacy alias for students (deprecated, use students)

  // Subject configuration
  subjects: string[]; // Subject areas covered (e.g., ["Reading", "Math", "Science"])
  // Maps subject name to array of excluded student IDs
  // If a student is in this array, they do NOT receive assignments for that subject
  subjectExclusions?: Record<string, string[]>;

  // Optional metadata - flexible, teacher-defined
  description?: string;
  gradeLevel?: string; // e.g., "2nd Grade", "K-1", "9th Grade"
  schoolYear?: string; // e.g., "2024-2025"
  period?: string; // e.g., "Period 3", "Morning", "Block A"
  subject?: string; // Legacy single subject field (deprecated, use subjects array)

  // Timestamps
  createdAt: string;
  updatedAt?: string;
  archivedAt?: string; // Soft archive - class is hidden but data preserved
}

/**
 * Summary type for listing classes (without full student details)
 */
export interface ClassSummary {
  id: string;
  name: string;
  gradeLevel?: string;
  schoolYear?: string;
  period?: string;
  subject?: string; // Legacy
  subjects: string[];
  studentCount: number;
  createdAt: string;
  archivedAt?: string;
}

/**
 * Input type for creating a new class
 */
export interface CreateClassInput {
  name: string;
  teacherId: string; // Required: which teacher owns this class
  description?: string;
  gradeLevel?: string;
  schoolYear?: string;
  period?: string;
  subject?: string; // Legacy
  subjects?: string[];
  studentIds?: string[];
}

/**
 * Input type for updating a class
 */
export interface UpdateClassInput {
  name?: string;
  description?: string;
  gradeLevel?: string;
  schoolYear?: string;
  period?: string;
  subject?: string; // Legacy
  subjects?: string[];
  subjectExclusions?: Record<string, string[]>;
}
