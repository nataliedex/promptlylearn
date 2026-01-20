import fs from "fs";
import path from "path";
import { Lesson } from "../domain/lesson";
import { AssignmentStudent } from "../domain/studentAssignment";
import { AssignmentStudentStore } from "../stores/assignmentStudentStore";

const LESSONS_DIR = path.join(__dirname, "../data/lessons");

/**
 * Lesson Loader - Handles loading lessons and creating assignment tracking records
 *
 * This module bridges the lesson data (JSON files) with the assignment tracking system.
 * When lessons are assigned to students, AssignmentStudent records are created to track:
 * - Number of attempts per student
 * - Scores and completion status
 * - Time spent and support used
 */

// ============================================
// Core Lesson Loading
// ============================================

/**
 * Load a single lesson by filename
 */
export function loadLesson(fileName: string): Lesson {
  const filePath = path.join(LESSONS_DIR, fileName);
  const rawData = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(rawData) as Lesson;
}

/**
 * Load a lesson by its ID
 */
export function loadLessonById(lessonId: string): Lesson | null {
  const lessons = getAllLessons();
  return lessons.find((l) => l.id === lessonId) || null;
}

/**
 * Get all available lessons
 */
export function getAllLessons(): Lesson[] {
  if (!fs.existsSync(LESSONS_DIR)) {
    return [];
  }

  const files = fs.readdirSync(LESSONS_DIR).filter((f) => f.endsWith(".json"));
  const lessons: Lesson[] = [];

  for (const file of files) {
    try {
      const lesson = loadLesson(file);
      lessons.push(lesson);
    } catch {
      // Skip invalid files
    }
  }

  // Sort by difficulty: beginner first, then intermediate, then advanced
  const difficultyOrder = { beginner: 0, intermediate: 1, advanced: 2 };
  return lessons.sort(
    (a, b) => difficultyOrder[a.difficulty] - difficultyOrder[b.difficulty]
  );
}

/**
 * Get lessons filtered by subject
 */
export function getLessonsBySubject(subject: string): Lesson[] {
  const lessons = getAllLessons();
  return lessons.filter(
    (l) => l.subject?.toLowerCase() === subject.toLowerCase()
  );
}

/**
 * Get lessons filtered by difficulty
 */
export function getLessonsByDifficulty(
  difficulty: "beginner" | "intermediate" | "advanced"
): Lesson[] {
  const lessons = getAllLessons();
  return lessons.filter((l) => l.difficulty === difficulty);
}

/**
 * Get lessons filtered by grade level
 */
export function getLessonsByGradeLevel(gradeLevel: string): Lesson[] {
  const lessons = getAllLessons();
  return lessons.filter(
    (l) => l.gradeLevel?.toLowerCase() === gradeLevel.toLowerCase()
  );
}

/**
 * Get available subjects from all lessons
 */
export function getAvailableSubjects(): string[] {
  const lessons = getAllLessons();
  const subjects = new Set<string>();

  for (const lesson of lessons) {
    if (lesson.subject) {
      subjects.add(lesson.subject);
    }
  }

  return Array.from(subjects).sort();
}

// ============================================
// Assignment Student Record Management
// ============================================

/**
 * Start an assignment for a student.
 * Creates or updates the AssignmentStudent record to track this attempt.
 *
 * @param studentId - The student's ID
 * @param lessonId - The lesson/assignment ID
 * @returns The AssignmentStudent record
 */
export function startAssignment(
  studentId: string,
  lessonId: string
): AssignmentStudent {
  const store = new AssignmentStudentStore();
  return store.startAttempt(studentId, lessonId);
}

/**
 * Complete an assignment attempt for a student.
 * Updates the AssignmentStudent record with completion data.
 *
 * @param studentId - The student's ID
 * @param lessonId - The lesson/assignment ID
 * @param score - The score achieved (0-100)
 * @param timeSpentSeconds - Optional time spent in seconds
 * @returns The updated AssignmentStudent record
 */
export function completeAssignment(
  studentId: string,
  lessonId: string,
  score: number,
  timeSpentSeconds?: number
): AssignmentStudent {
  const store = new AssignmentStudentStore();
  return store.completeAttempt(studentId, lessonId, score, timeSpentSeconds);
}

/**
 * Record hint usage for an assignment.
 *
 * @param studentId - The student's ID
 * @param lessonId - The lesson/assignment ID
 * @param hintsUsed - Number of hints used
 */
export function recordHintUsage(
  studentId: string,
  lessonId: string,
  hintsUsed: number
): void {
  const store = new AssignmentStudentStore();
  store.recordHintUsage(studentId, lessonId, hintsUsed);
}

/**
 * Record coach session usage for an assignment.
 *
 * @param studentId - The student's ID
 * @param lessonId - The lesson/assignment ID
 */
export function recordCoachSession(studentId: string, lessonId: string): void {
  const store = new AssignmentStudentStore();
  store.recordCoachSession(studentId, lessonId);
}

/**
 * Get the assignment record for a student and lesson.
 *
 * @param studentId - The student's ID
 * @param lessonId - The lesson/assignment ID
 * @returns The AssignmentStudent record or null if not found
 */
export function getAssignmentRecord(
  studentId: string,
  lessonId: string
): AssignmentStudent | null {
  const store = new AssignmentStudentStore();
  return store.load(studentId, lessonId);
}

/**
 * Get all assignment records for a student.
 *
 * @param studentId - The student's ID
 * @returns Array of AssignmentStudent records
 */
export function getStudentAssignments(studentId: string): AssignmentStudent[] {
  const store = new AssignmentStudentStore();
  return store.getByStudent(studentId);
}

/**
 * Get all assignment records for a lesson.
 *
 * @param lessonId - The lesson/assignment ID
 * @returns Array of AssignmentStudent records
 */
export function getLessonAssignments(lessonId: string): AssignmentStudent[] {
  const store = new AssignmentStudentStore();
  return store.getByAssignment(lessonId);
}

/**
 * Check if a student has completed an assignment.
 *
 * @param studentId - The student's ID
 * @param lessonId - The lesson/assignment ID
 * @returns True if completed at least once
 */
export function hasCompletedAssignment(
  studentId: string,
  lessonId: string
): boolean {
  const store = new AssignmentStudentStore();
  return store.isCompleted(studentId, lessonId);
}

/**
 * Get the number of attempts for a student on an assignment.
 *
 * @param studentId - The student's ID
 * @param lessonId - The lesson/assignment ID
 * @returns Number of attempts
 */
export function getAttemptCount(studentId: string, lessonId: string): number {
  const store = new AssignmentStudentStore();
  return store.getAttemptCount(studentId, lessonId);
}

// ============================================
// Lesson Summary with Assignment Data
// ============================================

export interface LessonWithProgress extends Lesson {
  assignmentRecord?: AssignmentStudent;
  attemptCount: number;
  highestScore?: number;
  isCompleted: boolean;
}

/**
 * Get all lessons with student progress data.
 * Useful for displaying lesson selection with previous attempt info.
 *
 * @param studentId - The student's ID
 * @returns Array of lessons with progress data
 */
export function getLessonsWithProgress(studentId: string): LessonWithProgress[] {
  const lessons = getAllLessons();
  const store = new AssignmentStudentStore();

  return lessons.map((lesson) => {
    const assignmentRecord = store.load(studentId, lesson.id);
    return {
      ...lesson,
      assignmentRecord: assignmentRecord || undefined,
      attemptCount: assignmentRecord?.attempts || 0,
      highestScore: assignmentRecord?.highestScore,
      isCompleted: assignmentRecord?.lastCompletedAt !== undefined,
    };
  });
}
