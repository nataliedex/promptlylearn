/**
 * Class / Section Types (Frontend)
 *
 * Matching backend domain models for Classes and StudentAssignments.
 */

// ============================================
// Class Types
// ============================================

export interface Class {
  id: string;
  name: string;
  description?: string;
  gradeLevel?: string;
  schoolYear?: string;
  period?: string;
  subject?: string;
  studentIds: string[];
  teacherId?: string;
  createdAt: string;
  updatedAt?: string;
  archivedAt?: string;
}

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

export interface CreateClassInput {
  name: string;
  description?: string;
  gradeLevel?: string;
  schoolYear?: string;
  period?: string;
  subject?: string;
  studentIds?: string[];
}

export interface UpdateClassInput {
  name?: string;
  description?: string;
  gradeLevel?: string;
  schoolYear?: string;
  period?: string;
  subject?: string;
}

// Class with full student details (from GET /api/classes/:id)
export interface ClassWithStudents extends Class {
  students: {
    id: string;
    name: string;
    notes?: string;
    createdAt: string;
  }[];
}

// ============================================
// Student Assignment Types
// ============================================

export interface StudentAssignment {
  id: string;
  lessonId: string;
  classId: string;
  studentId: string;
  assignedAt: string;
  assignedBy?: string;
}

export interface LessonClassAssignment {
  lessonId: string;
  classId: string;
  className?: string;
  studentIds: string[];
  assignedAt: string;
}

export interface AssignLessonInput {
  classId: string;
  studentIds?: string[];
}

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

// Response from POST /api/lessons/:id/assign
export interface AssignLessonResponse {
  success: boolean;
  lessonId: string;
  classId: string;
  className: string;
  assignedCount: number;
  totalInClass: number;
  assignments: StudentAssignment[];
}

// Response from GET /api/lessons/:id/assigned-students
export interface AssignedStudentsResponse {
  lessonId: string;
  hasAssignments: boolean;
  studentIds: string[];
  count: number;
}

// Bulk add students response
export interface BulkAddStudentsResponse {
  class: Class;
  created: number;
  existing: number;
  students: {
    id: string;
    name: string;
    createdAt: string;
  }[];
}
