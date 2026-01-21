/**
 * Teacher To-Do API Routes
 *
 * Endpoints for managing teacher to-do items created from soft actions
 * in the recommendation checklist workflow.
 */

import { Router } from "express";
import { teacherTodoStore } from "../../stores/teacherTodoStore";
import {
  CreateTeacherTodoInput,
  CreateTeacherTodosBatchInput,
  groupTodosByClass,
} from "../../domain/teacherTodo";

const router = Router();

// ============================================
// GET /api/teacher-todos
// Get todos with optional filtering
// ============================================

router.get("/", (req, res) => {
  try {
    const { status, teacherId, classId, grouped } = req.query;

    let todos = teacherTodoStore.getAll();

    // Filter by status
    if (status === "open" || status === "done") {
      todos = todos.filter((t) => t.status === status);
    }

    // Filter by teacher
    if (typeof teacherId === "string") {
      todos = todos.filter((t) => t.teacherId === teacherId);
    }

    // Filter by class
    if (typeof classId === "string") {
      todos = todos.filter((t) => t.classId === classId);
    }

    // Sort by createdAt (newest first)
    todos.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const counts = teacherTodoStore.getCounts(
      typeof teacherId === "string" ? teacherId : undefined
    );

    // Return grouped if requested
    if (grouped === "true") {
      const groupedTodos = groupTodosByClass(todos);
      return res.json({
        grouped: groupedTodos,
        todos,
        count: todos.length,
        openCount: counts.open,
        doneCount: counts.done,
      });
    }

    res.json({
      todos,
      count: todos.length,
      openCount: counts.open,
      doneCount: counts.done,
    });
  } catch (error) {
    console.error("Error getting teacher todos:", error);
    res.status(500).json({ error: "Failed to get teacher todos" });
  }
});

// ============================================
// GET /api/teacher-todos/:id
// Get a single todo
// ============================================

router.get("/:id", (req, res) => {
  try {
    const { id } = req.params;
    const todo = teacherTodoStore.load(id);

    if (!todo) {
      return res.status(404).json({ error: "Todo not found" });
    }

    res.json({ todo });
  } catch (error) {
    console.error("Error getting teacher todo:", error);
    res.status(500).json({ error: "Failed to get teacher todo" });
  }
});

// ============================================
// POST /api/teacher-todos
// Create one or more todos
// ============================================

router.post("/", (req, res) => {
  try {
    const { todos: todoInputs, batch } = req.body as {
      todos?: CreateTeacherTodoInput[];
      batch?: CreateTeacherTodosBatchInput;
    };

    let created;

    if (batch) {
      // Create from batch input
      if (!batch.teacherId || !batch.recommendationId || !batch.actions?.length) {
        return res.status(400).json({
          error: "Batch requires teacherId, recommendationId, and actions array",
        });
      }
      created = teacherTodoStore.createBatch(batch);
    } else if (todoInputs && todoInputs.length > 0) {
      // Create from individual inputs
      created = teacherTodoStore.createMany(todoInputs);
    } else {
      return res.status(400).json({
        error: "Request must include either 'todos' array or 'batch' object",
      });
    }

    const counts = teacherTodoStore.getCounts();

    res.status(201).json({
      success: true,
      todos: created,
      count: created.length,
      totalOpen: counts.open,
    });
  } catch (error) {
    console.error("Error creating teacher todos:", error);
    res.status(500).json({ error: "Failed to create teacher todos" });
  }
});

// ============================================
// POST /api/teacher-todos/:id/complete
// Mark a todo as complete
// ============================================

router.post("/:id/complete", (req, res) => {
  try {
    const { id } = req.params;
    const todo = teacherTodoStore.complete(id);

    if (!todo) {
      return res.status(404).json({ error: "Todo not found" });
    }

    const counts = teacherTodoStore.getCounts();

    res.json({
      success: true,
      todo,
      totalOpen: counts.open,
    });
  } catch (error) {
    console.error("Error completing teacher todo:", error);
    res.status(500).json({ error: "Failed to complete teacher todo" });
  }
});

// ============================================
// POST /api/teacher-todos/:id/reopen
// Reopen a completed todo
// ============================================

router.post("/:id/reopen", (req, res) => {
  try {
    const { id } = req.params;
    const todo = teacherTodoStore.reopen(id);

    if (!todo) {
      return res.status(404).json({ error: "Todo not found" });
    }

    const counts = teacherTodoStore.getCounts();

    res.json({
      success: true,
      todo,
      totalOpen: counts.open,
    });
  } catch (error) {
    console.error("Error reopening teacher todo:", error);
    res.status(500).json({ error: "Failed to reopen teacher todo" });
  }
});

// ============================================
// DELETE /api/teacher-todos/:id
// Delete a todo
// ============================================

router.delete("/:id", (req, res) => {
  try {
    const { id } = req.params;
    const deleted = teacherTodoStore.delete(id);

    if (!deleted) {
      return res.status(404).json({ error: "Todo not found" });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting teacher todo:", error);
    res.status(500).json({ error: "Failed to delete teacher todo" });
  }
});

// ============================================
// GET /api/teacher-todos/counts
// Get counts only (for badges)
// ============================================

router.get("/stats/counts", (req, res) => {
  try {
    const { teacherId } = req.query;
    const counts = teacherTodoStore.getCounts(
      typeof teacherId === "string" ? teacherId : undefined
    );

    res.json(counts);
  } catch (error) {
    console.error("Error getting teacher todo counts:", error);
    res.status(500).json({ error: "Failed to get counts" });
  }
});

export default router;
