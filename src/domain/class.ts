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
 */

export interface Class {
  id: string;
  name: string; // Required, free text - teacher defines meaning

  // Optional metadata - flexible, teacher-defined
  description?: string;
  gradeLevel?: string; // e.g., "2nd Grade", "K-1", "9th Grade"
  schoolYear?: string; // e.g., "2024-2025"
  period?: string; // e.g., "Period 3", "Morning", "Block A"
  subject?: string; // e.g., "Math", "Reading", "Science"

  // Student membership - embedded for simplicity
  // Future: Could migrate to separate ClassMembership entities if needed
  studentIds: string[];

  // For future multi-teacher support
  teacherId?: string;

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
  subject?: string;
  studentCount: number;
  createdAt: string;
  archivedAt?: string;
}

/**
 * Input type for creating a new class
 */
export interface CreateClassInput {
  name: string;
  description?: string;
  gradeLevel?: string;
  schoolYear?: string;
  period?: string;
  subject?: string;
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
  subject?: string;
}
