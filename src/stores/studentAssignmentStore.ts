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
  StudentActionStatus,
  ReviewState,
  LessonClassAssignment,
  AssignLessonInput,
  LessonAssignmentSummary,
  deriveReviewState,
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
   * @param assignedBy - Teacher who assigned (optional)
   * @param dueDate - Optional due date (ISO string)
   */
  assignLesson(
    lessonId: string,
    classId: string,
    studentIds: string[],
    assignedBy?: string,
    dueDate?: string
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
          dueDate,
          attempts: 1,
          reviewState: "not_started", // New assignments start as not started (student hasn't submitted)
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
   * Get the earliest assignment date for a lesson
   */
  getEarliestAssignedAt(lessonId: string): string | null {
    const data = loadData();
    const lessonAssignments = data.assignments.filter((a) => a.lessonId === lessonId);

    if (lessonAssignments.length === 0) {
      return null;
    }

    // Find earliest assignedAt
    return lessonAssignments.reduce((earliest, assignment) => {
      if (!earliest || assignment.assignedAt < earliest) {
        return assignment.assignedAt;
      }
      return earliest;
    }, lessonAssignments[0].assignedAt);
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

  /**
   * Mark an assignment as completed by a student
   */
  markCompleted(lessonId: string, studentId: string): boolean {
    const data = loadData();
    const assignment = data.assignments.find(
      (a) => a.lessonId === lessonId && a.studentId === studentId
    );

    if (!assignment) return false;

    assignment.completedAt = new Date().toISOString();
    saveData(data);
    return true;
  }

  /**
   * Mark an assignment as reviewed by teacher.
   * Sets reviewedAt timestamp; the actual state is derived from data.
   */
  markReviewed(
    lessonId: string,
    studentId: string,
    reviewedBy?: string
  ): boolean {
    const data = loadData();
    const assignment = data.assignments.find(
      (a) => a.lessonId === lessonId && a.studentId === studentId
    );

    if (!assignment) return false;

    const now = new Date().toISOString();

    // Set reviewedAt (the key timestamp for deriving state)
    if (!assignment.reviewedAt) {
      assignment.reviewedAt = now;
      assignment.reviewedBy = reviewedBy;
    }

    // Update stored reviewState for backwards compatibility
    // Note: Actual state should be derived via deriveReviewState() in API layer
    if (!assignment.reviewState || assignment.reviewState === "not_started" || assignment.reviewState === "pending_review") {
      assignment.reviewState = "reviewed";
    }

    saveData(data);
    return true;
  }

  /**
   * Push an assignment back to a student (reassign).
   * Clears completion, increments attempts. State becomes "not_started" since student needs to resubmit.
   */
  pushToStudent(
    lessonId: string,
    studentId: string,
    pushedBy?: string
  ): StudentAssignment | null {
    const data = loadData();
    const assignment = data.assignments.find(
      (a) => a.lessonId === lessonId && a.studentId === studentId
    );

    if (!assignment) return null;

    const now = new Date().toISOString();

    // Clear completion status (student needs to redo)
    assignment.completedAt = undefined;
    // Clear reviewedAt since they need to resubmit
    assignment.reviewedAt = undefined;
    // Increment attempts
    assignment.attempts = (assignment.attempts || 1) + 1;
    assignment.assignedBy = pushedBy;

    // Set state to not_started (student needs to submit again)
    assignment.reviewState = "not_started";
    assignment.lastActionAt = now;

    // Legacy fields (deprecated)
    assignment.actionStatus = "reassigned";
    assignment.actionAt = now;

    saveData(data);
    return assignment;
  }

  /**
   * Mark an action taken on a student's assignment.
   * Used for teacher workflow to track what was done.
   * @deprecated Use setReviewState for new code
   */
  markAction(
    lessonId: string,
    studentId: string,
    action: StudentActionStatus
  ): StudentAssignment | null {
    const data = loadData();
    const assignment = data.assignments.find(
      (a) => a.lessonId === lessonId && a.studentId === studentId
    );

    if (!assignment) return null;

    const now = new Date().toISOString();

    // Legacy field
    assignment.actionStatus = action;
    assignment.actionAt = now;

    // Map legacy action to new reviewState
    if (action === "reviewed") {
      assignment.reviewState = "reviewed";
      if (!assignment.reviewedAt) {
        assignment.reviewedAt = now;
      }
    } else if (action === "reassigned") {
      // Reassigned = student needs to resubmit
      assignment.reviewState = "not_started";
      assignment.lastActionAt = now;
    } else if (action === "badge-awarded") {
      // Badge awarded = resolved
      assignment.reviewState = "resolved";
      assignment.lastActionAt = now;
    }

    saveData(data);
    return assignment;
  }

  /**
   * Set the canonical review state for an assignment.
   * Note: Actual state should be derived via deriveReviewState() in API layer.
   * This method stores the state for backwards compatibility.
   */
  setReviewState(
    lessonId: string,
    studentId: string,
    state: ReviewState,
    options?: {
      reviewedBy?: string;
      todoId?: string;
      badgeId?: string;
    }
  ): StudentAssignment | null {
    const data = loadData();
    const assignment = data.assignments.find(
      (a) => a.lessonId === lessonId && a.studentId === studentId
    );

    if (!assignment) return null;

    const now = new Date().toISOString();

    // Set the stored state (for backwards compatibility)
    assignment.reviewState = state;

    // When reopening for review, clear follow-up references
    // (the actual todos are superseded, not deleted)
    if (state === "pending_review") {
      assignment.todoIds = [];
      assignment.reviewedAt = undefined;
      assignment.reviewedBy = undefined;
    }

    // Set reviewedAt on first review (this is key for deriving state)
    if (state !== "not_started" && state !== "pending_review" && !assignment.reviewedAt) {
      assignment.reviewedAt = now;
      assignment.reviewedBy = options?.reviewedBy;
    }

    // Set action timestamp for follow-up states
    if (state === "followup_scheduled" || state === "resolved") {
      assignment.lastActionAt = now;
    }

    // Link todo if provided (key for deriving followup_scheduled/resolved)
    if (options?.todoId) {
      assignment.todoIds = assignment.todoIds || [];
      if (!assignment.todoIds.includes(options.todoId)) {
        assignment.todoIds.push(options.todoId);
      }
    }

    // Link badge if provided (key for deriving resolved)
    if (options?.badgeId) {
      assignment.badgeIds = assignment.badgeIds || [];
      if (!assignment.badgeIds.includes(options.badgeId)) {
        assignment.badgeIds.push(options.badgeId);
      }
    }

    // Sync legacy fields for backwards compatibility
    if (state === "reviewed" || state === "resolved") {
      assignment.actionStatus = "reviewed";
    }
    assignment.actionAt = now;

    saveData(data);
    return assignment;
  }

  /**
   * Get students who need attention but haven't been addressed.
   * A student is "addressed" if they have an actionStatus set.
   */
  getUnaddressedAssignments(lessonId: string): StudentAssignment[] {
    const data = loadData();
    return data.assignments.filter(
      (a) => a.lessonId === lessonId && a.completedAt && !a.actionStatus
    );
  }

  /**
   * Clear action status (for re-evaluation after student resubmits)
   */
  clearActionStatus(lessonId: string, studentId: string): boolean {
    const data = loadData();
    const assignment = data.assignments.find(
      (a) => a.lessonId === lessonId && a.studentId === studentId
    );

    if (!assignment) return false;

    assignment.actionStatus = undefined;
    assignment.actionAt = undefined;

    saveData(data);
    return true;
  }

  /**
   * Undo a reassignment by restoring previous state.
   * Decrements attempts and restores completed/reviewed status.
   */
  undoReassignment(
    lessonId: string,
    studentId: string,
    previousCompletedAt?: string,
    previousReviewedAt?: string,
    previousReviewState?: ReviewState
  ): StudentAssignment | null {
    const data = loadData();
    const assignment = data.assignments.find(
      (a) => a.lessonId === lessonId && a.studentId === studentId
    );

    if (!assignment) return null;

    // Restore previous state
    assignment.completedAt = previousCompletedAt;
    assignment.reviewedAt = previousReviewedAt;
    // Decrement attempts (minimum 1)
    assignment.attempts = Math.max(1, (assignment.attempts || 1) - 1);

    // Restore review state based on data (derive it)
    if (previousReviewState && ["not_started", "pending_review", "reviewed", "followup_scheduled", "resolved"].includes(previousReviewState)) {
      assignment.reviewState = previousReviewState;
    } else if (previousReviewedAt) {
      assignment.reviewState = "reviewed";
    } else if (previousCompletedAt) {
      assignment.reviewState = "pending_review";
    } else {
      assignment.reviewState = "not_started";
    }

    // Clear legacy action status
    assignment.actionStatus = undefined;
    assignment.actionAt = undefined;
    assignment.lastActionAt = undefined;

    saveData(data);
    return assignment;
  }

  /**
   * Get assignment for a specific student and lesson
   */
  getAssignment(lessonId: string, studentId: string): StudentAssignment | null {
    const data = loadData();
    return (
      data.assignments.find(
        (a) => a.lessonId === lessonId && a.studentId === studentId
      ) || null
    );
  }

  /**
   * Get active (not completed) assignments for a student
   */
  getActiveStudentAssignments(studentId: string): StudentAssignment[] {
    const data = loadData();
    return data.assignments.filter(
      (a) => a.studentId === studentId && !a.completedAt
    );
  }

  /**
   * Get unreviewed assignments for a lesson (students who need teacher attention)
   */
  getUnreviewedAssignments(lessonId: string): StudentAssignment[] {
    const data = loadData();
    return data.assignments.filter(
      (a) => a.lessonId === lessonId && a.completedAt && !a.reviewedAt
    );
  }

  /**
   * Get assignments by review state
   */
  getByReviewState(lessonId: string, state: ReviewState): StudentAssignment[] {
    const data = loadData();
    return data.assignments.filter(
      (a) => a.lessonId === lessonId && a.reviewState === state
    );
  }

  /**
   * Get review state counts for a lesson.
   * Note: This uses stored state; for accurate counts, derive states in API layer.
   */
  getReviewStateCounts(lessonId: string): Record<ReviewState, number> {
    const data = loadData();
    const lessonAssignments = data.assignments.filter((a) => a.lessonId === lessonId);

    const counts: Record<ReviewState, number> = {
      not_started: 0,
      pending_review: 0,
      reviewed: 0,
      followup_scheduled: 0,
      resolved: 0,
    };

    for (const assignment of lessonAssignments) {
      const state = assignment.reviewState || "not_started";
      if (state in counts) {
        counts[state as ReviewState]++;
      } else {
        // Handle legacy states by mapping to new states
        counts.not_started++;
      }
    }

    return counts;
  }

  /**
   * Migrate existing assignments to use the new reviewState values.
   * Maps old states to new states and handles unset states.
   */
  migrateToReviewState(): { migrated: number; total: number } {
    const data = loadData();
    let migrated = 0;

    // Map old states to new states
    const stateMapping: Record<string, ReviewState> = {
      not_reviewed: "pending_review", // If completed, otherwise not_started
      reviewed: "reviewed",
      action_scheduled: "followup_scheduled",
      badge_awarded: "resolved",
      reassigned: "not_started", // Reassigned means student needs to resubmit
    };

    for (const assignment of data.assignments) {
      const currentState = assignment.reviewState;
      let needsMigration = false;
      let newState: ReviewState;

      // Check if state needs migration (old state or no state)
      if (!currentState) {
        needsMigration = true;
        // Determine state from legacy fields and completion status
        if (!assignment.completedAt) {
          newState = "not_started";
        } else if (!assignment.reviewedAt) {
          newState = "pending_review";
        } else if (assignment.actionStatus === "badge-awarded") {
          newState = "resolved";
        } else if (assignment.todoIds && assignment.todoIds.length > 0) {
          newState = "followup_scheduled";
        } else {
          newState = "reviewed";
        }
      } else if (currentState in stateMapping && !["not_started", "pending_review", "reviewed", "followup_scheduled", "resolved"].includes(currentState as string)) {
        // Old state that needs mapping
        needsMigration = true;
        newState = stateMapping[currentState as string];
        // Adjust based on actual data (handle legacy "not_reviewed" state)
        if ((currentState as string) === "not_reviewed") {
          newState = assignment.completedAt ? "pending_review" : "not_started";
        }
      } else {
        // Already has new state format
        newState = currentState;
      }

      if (needsMigration) {
        assignment.reviewState = newState;
        migrated++;
      }
    }

    if (migrated > 0) {
      saveData(data);
    }

    return { migrated, total: data.assignments.length };
  }
}

// ============================================
// Auto-migrate on module load
// ============================================

/**
 * Migrate review state for all existing assignments.
 * This ensures backwards compatibility with existing data.
 */
export function migrateReviewStateOnLoad(): void {
  const store = new StudentAssignmentStore();
  const result = store.migrateToReviewState();
  if (result.migrated > 0) {
    console.log(`[StudentAssignmentStore] Migrated ${result.migrated}/${result.total} assignments to reviewState`);
  }
}

// Run migration on module load
migrateReviewStateOnLoad();
