/**
 * TeacherTodoStore - Persistence layer for Teacher To-Do items
 *
 * Stores todos as JSON file, following the same pattern as other stores.
 */

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  TeacherTodo,
  TeacherTodoStatus,
  CreateTeacherTodoInput,
  CreateTeacherTodosBatchInput,
} from "../domain/teacherTodo";

const DATA_FILE = path.join(__dirname, "../../data/teacher-todos.json");

interface TeacherTodoData {
  todos: TeacherTodo[];
  lastUpdated: string;
}

export class TeacherTodoStore {
  constructor() {
    // Ensure data directory exists
    const dataDir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }

  // ============================================
  // CRUD Operations
  // ============================================

  /**
   * Create a single todo
   */
  create(input: CreateTeacherTodoInput): TeacherTodo {
    const data = this.loadData();
    const now = new Date().toISOString();

    const todo: TeacherTodo = {
      id: randomUUID(),
      teacherId: input.teacherId,
      recommendationId: input.recommendationId,
      actionKey: input.actionKey,
      label: input.label,
      classId: input.classId,
      className: input.className,
      subject: input.subject,
      assignmentId: input.assignmentId,
      assignmentTitle: input.assignmentTitle,
      studentIds: input.studentIds,
      studentNames: input.studentNames,
      status: "open",
      createdAt: now,
    };

    data.todos.push(todo);
    this.writeData(data);

    return todo;
  }

  /**
   * Create multiple todos at once (from a batch)
   */
  createBatch(batch: CreateTeacherTodosBatchInput): TeacherTodo[] {
    const data = this.loadData();
    const now = new Date().toISOString();
    const created: TeacherTodo[] = [];

    for (const action of batch.actions) {
      const todo: TeacherTodo = {
        id: randomUUID(),
        teacherId: batch.teacherId,
        recommendationId: batch.recommendationId,
        actionKey: action.actionKey,
        label: action.label,
        classId: batch.classId,
        className: batch.className,
        subject: batch.subject,
        assignmentId: batch.assignmentId,
        assignmentTitle: batch.assignmentTitle,
        studentIds: batch.studentIds,
        studentNames: batch.studentNames,
        status: "open",
        createdAt: now,
      };

      data.todos.push(todo);
      created.push(todo);
    }

    this.writeData(data);
    return created;
  }

  /**
   * Create multiple todos from individual inputs
   */
  createMany(inputs: CreateTeacherTodoInput[]): TeacherTodo[] {
    const data = this.loadData();
    const now = new Date().toISOString();
    const created: TeacherTodo[] = [];

    for (const input of inputs) {
      const todo: TeacherTodo = {
        id: randomUUID(),
        teacherId: input.teacherId,
        recommendationId: input.recommendationId,
        actionKey: input.actionKey,
        label: input.label,
        classId: input.classId,
        className: input.className,
        subject: input.subject,
        assignmentId: input.assignmentId,
        assignmentTitle: input.assignmentTitle,
        studentIds: input.studentIds,
        studentNames: input.studentNames,
        status: "open",
        createdAt: now,
      };

      data.todos.push(todo);
      created.push(todo);
    }

    this.writeData(data);
    return created;
  }

  /**
   * Load a todo by ID
   */
  load(id: string): TeacherTodo | null {
    const data = this.loadData();
    return data.todos.find((t) => t.id === id) || null;
  }

  /**
   * Get all todos
   */
  getAll(): TeacherTodo[] {
    const data = this.loadData();
    return data.todos;
  }

  /**
   * Get todos by status
   */
  getByStatus(status: TeacherTodoStatus): TeacherTodo[] {
    const data = this.loadData();
    return data.todos.filter((t) => t.status === status);
  }

  /**
   * Get open todos
   */
  getOpen(): TeacherTodo[] {
    return this.getByStatus("open");
  }

  /**
   * Get done todos
   */
  getDone(): TeacherTodo[] {
    return this.getByStatus("done");
  }

  /**
   * Get todos by teacher
   */
  getByTeacher(teacherId: string, status?: TeacherTodoStatus): TeacherTodo[] {
    const data = this.loadData();
    return data.todos.filter((t) => {
      if (t.teacherId !== teacherId) return false;
      if (status && t.status !== status) return false;
      return true;
    });
  }

  /**
   * Get todos by recommendation
   */
  getByRecommendation(recommendationId: string): TeacherTodo[] {
    const data = this.loadData();
    return data.todos.filter((t) => t.recommendationId === recommendationId);
  }

  /**
   * Get todos by class
   */
  getByClass(classId: string, status?: TeacherTodoStatus): TeacherTodo[] {
    const data = this.loadData();
    return data.todos.filter((t) => {
      if (t.classId !== classId) return false;
      if (status && t.status !== status) return false;
      return true;
    });
  }

  /**
   * Mark a todo as complete
   */
  complete(id: string): TeacherTodo | null {
    const data = this.loadData();
    const todo = data.todos.find((t) => t.id === id);

    if (!todo) return null;

    todo.status = "done";
    todo.doneAt = new Date().toISOString();

    this.writeData(data);
    return todo;
  }

  /**
   * Reopen a completed todo
   */
  reopen(id: string): TeacherTodo | null {
    const data = this.loadData();
    const todo = data.todos.find((t) => t.id === id);

    if (!todo) return null;

    todo.status = "open";
    todo.doneAt = undefined;

    this.writeData(data);
    return todo;
  }

  /**
   * Supersede a todo (mark as inactive due to review reopen)
   */
  supersede(id: string): TeacherTodo | null {
    const data = this.loadData();
    const todo = data.todos.find((t) => t.id === id);

    if (!todo) return null;

    todo.status = "superseded";
    todo.supersededAt = new Date().toISOString();

    this.writeData(data);
    return todo;
  }

  /**
   * Delete a todo
   */
  delete(id: string): boolean {
    const data = this.loadData();
    const index = data.todos.findIndex((t) => t.id === id);

    if (index === -1) return false;

    data.todos.splice(index, 1);
    this.writeData(data);
    return true;
  }

  /**
   * Get counts (excludes superseded todos)
   */
  getCounts(teacherId?: string): { total: number; open: number; done: number } {
    const data = this.loadData();
    let todos = data.todos.filter((t) => t.status !== "superseded");

    if (teacherId) {
      todos = todos.filter((t) => t.teacherId === teacherId);
    }

    return {
      total: todos.length,
      open: todos.filter((t) => t.status === "open").length,
      done: todos.filter((t) => t.status === "done").length,
    };
  }

  // ============================================
  // File I/O
  // ============================================

  private loadData(): TeacherTodoData {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const content = fs.readFileSync(DATA_FILE, "utf-8");
        return JSON.parse(content);
      }
    } catch (err) {
      console.error("Error loading teacher todos:", err);
    }

    return {
      todos: [],
      lastUpdated: new Date().toISOString(),
    };
  }

  private writeData(data: TeacherTodoData): void {
    data.lastUpdated = new Date().toISOString();
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  }
}

// Export singleton instance
export const teacherTodoStore = new TeacherTodoStore();
