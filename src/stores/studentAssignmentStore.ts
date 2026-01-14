/**
 * Student Assignment Store
 *
 * Tracks which students are assigned to which lessons.
 * Stored as a single JSON file for simplicity (assignments.json).
 *
 * This is a critical store that determines:
 * - Which students appear in the dashboard for each lesson
 * - Which students are expected to complete each lesson
 */

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  StudentAssignment,
  LessonClassAssignment,
  AssignLessonInput,
  LessonAssignmentSummary,
} from "../domain/studentAssignment";

const DATA_DIR = path.join(__dirname, "../../data");
const ASSIGNMENTS_FILE = path.join(DATA_DIR, "student-assignments.json");

interface AssignmentsData {
  assignments: StudentAssignment[];
}

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadData(): AssignmentsData {
  ensureDataDir();

  if (fs.existsSync(ASSIGNMENTS_FILE)) {
    try {
      const raw = fs.readFileSync(ASSIGNMENTS_FILE, "utf-8");
      return JSON.parse(raw);
    } catch {
      // Corrupted file, start fresh
    }
  }

  return { assignments: [] };
}

function saveData(data: AssignmentsData): void {
  ensureDataDir();
  fs.writeFileSync(ASSIGNMENTS_FILE, JSON.stringify(data, null, 2), "utf-8");
}

export class StudentAssignmentStore {
  /**
   * Assign a lesson to students through a class
   *
   * @param lessonId - The lesson to assign
   * @param classId - The class context
   * @param studentIds - Specific students (if omitted, use all students in class)
   * @param classStudentIds - All students in the class (used if studentIds omitted)
   */
  assignLesson(
    lessonId: string,
    classId: string,
    studentIds: string[],
    assignedBy?: string
  ): StudentAssignment[] {
    const data = loadData();
    const now = new Date().toISOString();
    const newAssignments: StudentAssignment[] = [];

    for (const studentId of studentIds) {
      // Check if already assigned
      const existing = data.assignments.find(
        (a) => a.lessonId === lessonId && a.studentId === studentId
      );

      if (!existing) {
        const assignment: StudentAssignment = {
          id: randomUUID(),
          lessonId,
          classId,
          studentId,
          assignedAt: now,
          assignedBy,
        };
        data.assignments.push(assignment);
        newAssignments.push(assignment);
      }
    }

    saveData(data);
    return newAssignments;
  }

  /**
   * Remove all assignments for a lesson from a specific class
   */
  unassignLessonFromClass(lessonId: string, classId: string): number {
    const data = loadData();
    const before = data.assignments.length;

    data.assignments = data.assignments.filter(
      (a) => !(a.lessonId === lessonId && a.classId === classId)
    );

    saveData(data);
    return before - data.assignments.length;
  }

  /**
   * Remove a specific student's assignment
   */
  unassignStudent(lessonId: string, studentId: string): boolean {
    const data = loadData();
    const before = data.assignments.length;

    data.assignments = data.assignments.filter(
      (a) => !(a.lessonId === lessonId && a.studentId === studentId)
    );

    if (data.assignments.length < before) {
      saveData(data);
      return true;
    }

    return false;
  }

  /**
   * Get all assigned student IDs for a lesson
   */
  getAssignedStudentIds(lessonId: string): string[] {
    const data = loadData();
    return [
      ...new Set(
        data.assignments.filter((a) => a.lessonId === lessonId).map((a) => a.studentId)
      ),
    ];
  }

  /**
   * Get assignments for a lesson grouped by class
   */
  getAssignmentsByClass(lessonId: string): LessonClassAssignment[] {
    const data = loadData();
    const lessonAssignments = data.assignments.filter((a) => a.lessonId === lessonId);

    // Group by class
    const byClass = new Map<
      string,
      { studentIds: string[]; assignedAt: string }
    >();

    for (const assignment of lessonAssignments) {
      const existing = byClass.get(assignment.classId);
      if (existing) {
        existing.studentIds.push(assignment.studentId);
        // Use earliest assignment date
        if (assignment.assignedAt < existing.assignedAt) {
          existing.assignedAt = assignment.assignedAt;
        }
      } else {
        byClass.set(assignment.classId, {
          studentIds: [assignment.studentId],
          assignedAt: assignment.assignedAt,
        });
      }
    }

    return Array.from(byClass.entries()).map(([classId, data]) => ({
      lessonId,
      classId,
      studentIds: data.studentIds,
      assignedAt: data.assignedAt,
    }));
  }

  /**
   * Get assignment summary for a lesson
   */
  getAssignmentSummary(
    lessonId: string,
    classNames: Record<string, string>
  ): LessonAssignmentSummary {
    const byClass = this.getAssignmentsByClass(lessonId);

    return {
      lessonId,
      totalAssigned: byClass.reduce((sum, c) => sum + c.studentIds.length, 0),
      assignmentsByClass: byClass.map((c) => ({
        classId: c.classId,
        className: classNames[c.classId] || "Unknown Class",
        studentCount: c.studentIds.length,
        assignedAt: c.assignedAt,
      })),
    };
  }

  /**
   * Get all lessons assigned to a specific student
   */
  getStudentAssignments(studentId: string): StudentAssignment[] {
    const data = loadData();
    return data.assignments.filter((a) => a.studentId === studentId);
  }

  /**
   * Check if a lesson has any assignments
   */
  hasAssignments(lessonId: string): boolean {
    const data = loadData();
    return data.assignments.some((a) => a.lessonId === lessonId);
  }

  /**
   * Get all assignments (for admin/debugging)
   */
  getAll(): StudentAssignment[] {
    return loadData().assignments;
  }

  /**
   * Delete all assignments for a lesson (when lesson is deleted)
   */
  deleteAllForLesson(lessonId: string): number {
    const data = loadData();
    const before = data.assignments.length;

    data.assignments = data.assignments.filter((a) => a.lessonId !== lessonId);

    saveData(data);
    return before - data.assignments.length;
  }

  /**
   * Delete all assignments for a student (when student is deleted)
   */
  deleteAllForStudent(studentId: string): number {
    const data = loadData();
    const before = data.assignments.length;

    data.assignments = data.assignments.filter((a) => a.studentId !== studentId);

    saveData(data);
    return before - data.assignments.length;
  }
}
