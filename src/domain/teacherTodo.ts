/**
 * Teacher To-Do Domain Model
 *
 * Represents actionable items for teachers created from soft actions
 * in the recommendation checklist workflow.
 *
 * When a teacher submits soft actions (like "run_small_group_review",
 * "review_responses", etc.), each becomes a TeacherTodo that they can
 * track and check off as completed.
 */

import { ChecklistActionKey } from "./recommendation";

// ============================================
// Types
// ============================================

export type TeacherTodoStatus = "open" | "done" | "superseded";

/**
 * Recommendation category for display (human-readable)
 */
export type RecommendationCategory =
  | "Needs Support"
  | "Developing"
  | "Ready for Challenge"
  | "Celebrate Progress"
  | "Group Support"
  | "Monitor";

/**
 * TeacherTodo - An actionable item for a teacher
 */
export interface TeacherTodo {
  id: string;
  teacherId: string;
  recommendationId: string;

  // Action details
  actionKey: ChecklistActionKey;
  label: string;  // Teacher-friendly text
  category?: RecommendationCategory;  // e.g., "Needs Support", "Developing"

  // Context (optional - helps make todo understandable)
  classId?: string;
  className?: string;  // Denormalized for display
  subject?: string;
  assignmentId?: string;
  assignmentTitle?: string;  // Denormalized for display
  studentIds?: string[];
  studentNames?: string;  // Comma-separated names for display

  // Status tracking
  status: TeacherTodoStatus;
  createdAt: string;  // ISO timestamp
  doneAt?: string;    // ISO timestamp when completed
  supersededAt?: string;  // ISO timestamp when superseded by review reopen
}

/**
 * Input for creating a Teacher To-Do
 */
export interface CreateTeacherTodoInput {
  teacherId: string;
  recommendationId: string;
  actionKey: ChecklistActionKey;
  label: string;
  category?: RecommendationCategory;
  classId?: string;
  className?: string;
  subject?: string;
  assignmentId?: string;
  assignmentTitle?: string;
  studentIds?: string[];
  studentNames?: string;
}

/**
 * Batch input for creating multiple todos at once
 */
export interface CreateTeacherTodosBatchInput {
  teacherId: string;
  recommendationId: string;
  classId?: string;
  className?: string;
  subject?: string;
  assignmentId?: string;
  assignmentTitle?: string;
  studentIds?: string[];
  studentNames?: string;
  actions: {
    actionKey: ChecklistActionKey;
    label: string;
  }[];
}

// ============================================
// API Request/Response Types
// ============================================

/**
 * Request to create multiple todos
 */
export interface CreateTodosRequest {
  todos: CreateTeacherTodoInput[];
}

/**
 * Request to create todos from a batch input
 */
export interface CreateTodosBatchRequest {
  batch: CreateTeacherTodosBatchInput;
}

/**
 * Response from creating todos
 */
export interface CreateTodosResponse {
  success: boolean;
  todos: TeacherTodo[];
  count: number;
}

/**
 * Response from getting todos
 */
export interface GetTodosResponse {
  todos: TeacherTodo[];
  count: number;
  openCount: number;
  doneCount: number;
}

/**
 * Response from completing a todo
 */
export interface CompleteTodoResponse {
  success: boolean;
  todo: TeacherTodo;
}

// ============================================
// Grouping for Display
// ============================================

/**
 * Todos grouped by class for display/printing
 */
export interface TodosByClass {
  classId: string | null;
  className: string;
  subjects: TodosBySubject[];
  todoCount: number;
}

/**
 * Todos grouped by subject within a class
 */
export interface TodosBySubject {
  subject: string | null;
  assignments: TodosByAssignment[];
  todoCount: number;
}

/**
 * Todos grouped by assignment within a subject
 */
export interface TodosByAssignment {
  assignmentId: string | null;
  assignmentTitle: string | null;
  todos: TeacherTodo[];
}

/**
 * Group todos by class > subject > assignment for display
 */
export function groupTodosByClass(todos: TeacherTodo[]): TodosByClass[] {
  const classMap = new Map<string, {
    classId: string | null;
    className: string;
    subjectMap: Map<string, {
      subject: string | null;
      assignmentMap: Map<string, {
        assignmentId: string | null;
        assignmentTitle: string | null;
        todos: TeacherTodo[];
      }>;
    }>;
  }>();

  for (const todo of todos) {
    const classKey = todo.classId || "__no_class__";
    const className = todo.className || "General";

    if (!classMap.has(classKey)) {
      classMap.set(classKey, {
        classId: todo.classId || null,
        className,
        subjectMap: new Map(),
      });
    }

    const classEntry = classMap.get(classKey)!;
    const subjectKey = todo.subject || "__no_subject__";

    if (!classEntry.subjectMap.has(subjectKey)) {
      classEntry.subjectMap.set(subjectKey, {
        subject: todo.subject || null,
        assignmentMap: new Map(),
      });
    }

    const subjectEntry = classEntry.subjectMap.get(subjectKey)!;
    const assignmentKey = todo.assignmentId || "__no_assignment__";

    if (!subjectEntry.assignmentMap.has(assignmentKey)) {
      subjectEntry.assignmentMap.set(assignmentKey, {
        assignmentId: todo.assignmentId || null,
        assignmentTitle: todo.assignmentTitle || null,
        todos: [],
      });
    }

    subjectEntry.assignmentMap.get(assignmentKey)!.todos.push(todo);
  }

  // Convert to array structure
  const result: TodosByClass[] = [];

  for (const [, classEntry] of classMap) {
    const subjects: TodosBySubject[] = [];

    for (const [, subjectEntry] of classEntry.subjectMap) {
      const assignments: TodosByAssignment[] = [];

      for (const [, assignmentEntry] of subjectEntry.assignmentMap) {
        assignments.push(assignmentEntry);
      }

      subjects.push({
        subject: subjectEntry.subject,
        assignments,
        todoCount: assignments.reduce((sum, a) => sum + a.todos.length, 0),
      });
    }

    result.push({
      classId: classEntry.classId,
      className: classEntry.className,
      subjects,
      todoCount: subjects.reduce((sum, s) => sum + s.todoCount, 0),
    });
  }

  // Sort by class name
  result.sort((a, b) => a.className.localeCompare(b.className));

  return result;
}

// ============================================
// Group by Student (for To-Do Panel)
// ============================================

/**
 * A single todo with context for display
 */
export interface TodoWithContext {
  todo: TeacherTodo;
  contextLine: string; // e.g., "Math · Division Basics · Lesson: Division Basics"
}

/**
 * Todos grouped by student for display
 */
export interface TodosByStudent {
  studentId: string;
  studentName: string;
  todos: TodoWithContext[];
}

/**
 * Build a context line from todo fields.
 * Format: "Subject · Assignment Title" (only includes fields that exist)
 */
function buildContextLine(todo: TeacherTodo): string {
  const parts: string[] = [];

  if (todo.subject) {
    parts.push(todo.subject);
  }

  if (todo.assignmentTitle) {
    parts.push(todo.assignmentTitle);
  }

  return parts.join(" · ");
}

/**
 * Group todos by student for the Teacher To-Do panel.
 *
 * For todos with multiple studentIds, creates a separate entry
 * for each student (splits them).
 */
export function groupTodosByStudent(todos: TeacherTodo[]): TodosByStudent[] {
  const studentMap = new Map<string, {
    studentId: string;
    studentName: string;
    todos: TodoWithContext[];
  }>();

  for (const todo of todos) {
    const contextLine = buildContextLine(todo);

    // If todo has studentIds, create entry per student
    if (todo.studentIds && todo.studentIds.length > 0) {
      // Parse studentNames (comma-separated) to match with studentIds
      const names = todo.studentNames?.split(",").map(n => n.trim()) || [];

      for (let i = 0; i < todo.studentIds.length; i++) {
        const studentId = todo.studentIds[i];
        const studentName = names[i] || studentId;

        if (!studentMap.has(studentId)) {
          studentMap.set(studentId, {
            studentId,
            studentName,
            todos: [],
          });
        }

        studentMap.get(studentId)!.todos.push({
          todo,
          contextLine,
        });
      }
    } else if (todo.studentNames) {
      // Fallback: use studentNames as key if no studentIds
      const key = todo.studentNames;
      if (!studentMap.has(key)) {
        studentMap.set(key, {
          studentId: key,
          studentName: todo.studentNames,
          todos: [],
        });
      }
      studentMap.get(key)!.todos.push({
        todo,
        contextLine,
      });
    } else {
      // No student info - put under "General"
      const key = "__no_student__";
      if (!studentMap.has(key)) {
        studentMap.set(key, {
          studentId: key,
          studentName: "General",
          todos: [],
        });
      }
      studentMap.get(key)!.todos.push({
        todo,
        contextLine,
      });
    }
  }

  // Convert to array and sort by student name
  const result = Array.from(studentMap.values());
  result.sort((a, b) => {
    // Put "General" at the end
    if (a.studentName === "General") return 1;
    if (b.studentName === "General") return -1;
    return a.studentName.localeCompare(b.studentName);
  });

  return result;
}
