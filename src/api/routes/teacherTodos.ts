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
  TeacherTodo,
  RecommendationCategory,
  groupTodosByClass,
} from "../../domain/teacherTodo";
import { getAllLessons } from "../../loaders/lessonLoader";
import { recommendationStore } from "../../stores/recommendationStore";
import { SessionStore } from "../../stores/sessionStore";
import { StudentAssignmentStore } from "../../stores/studentAssignmentStore";
import { deriveReviewState } from "../../domain/studentAssignment";

const sessionStore = new SessionStore();
const studentAssignmentStore = new StudentAssignmentStore();

/**
 * Recalculate and update the assignment's reviewState based on live todo data.
 * Called after completing, reopening, or superseding a todo to keep state in sync.
 */
function syncAssignmentReviewState(todo: TeacherTodo): void {
  if (!todo.assignmentId || !todo.studentIds?.length) return;

  for (const studentId of todo.studentIds) {
    const assignment = studentAssignmentStore.getAssignment(todo.assignmentId, studentId);
    if (!assignment) continue;

    // Count open and completed todos from the assignment's linked todoIds
    const todoIds = assignment.todoIds || [];
    let openCount = 0;
    let completedCount = 0;
    for (const tid of todoIds) {
      const t = teacherTodoStore.load(tid);
      if (!t) continue;
      if (t.status === "open") openCount++;
      else if (t.status === "done") completedCount++;
    }

    const hasBadge = (assignment.badgeIds?.length || 0) > 0;
    const newState = deriveReviewState(
      !!assignment.completedAt,
      !!assignment.reviewedAt,
      openCount,
      completedCount,
      hasBadge
    );

    // Only update if state actually changed
    if (newState !== assignment.reviewState) {
      studentAssignmentStore.setReviewState(todo.assignmentId, studentId, newState);
    }
  }
}

/**
 * Append a system note to sessions for a completed todo.
 * Finds the latest completed session for each (assignmentId, studentId) pair
 * and appends a "[System]" note documenting the follow-up completion.
 */
function appendFollowupNoteToSessions(todo: TeacherTodo): void {
  if (!todo.assignmentId || !todo.studentIds?.length) return;
  const dateStr = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const systemNote = `\n---\n[System · ${dateStr}]\nFollow-up completed: "${todo.label}"`;

  for (const studentId of todo.studentIds) {
    const sessions = sessionStore.getByStudentId(studentId)
      .filter((s) => s.lessonId === todo.assignmentId && s.status === "completed");
    if (sessions.length === 0) continue;
    const latest = sessions[0]; // Already sorted newest-first
    latest.educatorNotes = (latest.educatorNotes || "") + systemNote;
    sessionStore.save(latest);
  }
}

/**
 * Remove the follow-up completion note from sessions when a todo is reopened.
 * Looks for the exact system note appended by appendFollowupNoteToSessions
 * and removes it from the session's educatorNotes.
 */
function removeFollowupNoteFromSessions(todo: TeacherTodo): void {
  if (!todo.assignmentId || !todo.studentIds?.length) return;
  // Match the note pattern regardless of date
  const noteMarker = `Follow-up completed: "${todo.label}"`;

  for (const studentId of todo.studentIds) {
    const sessions = sessionStore.getByStudentId(studentId)
      .filter((s) => s.lessonId === todo.assignmentId && s.status === "completed");
    if (sessions.length === 0) continue;
    const latest = sessions[0];
    if (!latest.educatorNotes) continue;

    // Find and remove the system note block containing this marker
    const notePattern = new RegExp(
      `\\n---\\n\\[System · [^\\]]+\\]\\nFollow-up completed: "${todo.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`,
    );
    const updated = latest.educatorNotes.replace(notePattern, "");
    if (updated !== latest.educatorNotes) {
      latest.educatorNotes = updated || undefined;
      sessionStore.save(latest);
    }
  }
}

const router = Router();

/**
 * Map recommendation rule name to human-readable category
 */
function getRuleCategory(ruleName: string): RecommendationCategory {
  switch (ruleName) {
    case "needs-support":
      return "Needs Support";
    case "developing":
      return "Developing";
    case "group-support":
      return "Group Support";
    case "ready-for-challenge":
      return "Ready for Challenge";
    case "notable-improvement":
      return "Celebrate Progress";
    case "watch-progress":
      return "Monitor";
    default:
      return "Needs Support"; // Default fallback
  }
}

/**
 * Enrich todos with lesson data (subject, assignmentTitle) and category if missing.
 * This ensures older todos without these fields still display context.
 */
function enrichTodos(todos: TeacherTodo[]): TeacherTodo[] {
  const lessons = getAllLessons();
  const lessonMap = new Map(lessons.map(l => [l.id, l]));

  return todos.map(todo => {
    let enriched = { ...todo };
    let needsUpdate = false;

    // Enrich with lesson data if missing
    if ((!todo.subject || !todo.assignmentTitle) && todo.assignmentId) {
      const lesson = lessonMap.get(todo.assignmentId);
      if (lesson) {
        if (!todo.subject && lesson.subject) {
          enriched.subject = lesson.subject;
          needsUpdate = true;
        }
        if (!todo.assignmentTitle && lesson.title) {
          enriched.assignmentTitle = lesson.title;
          needsUpdate = true;
        }
      }
    }

    // Enrich with category from recommendation if missing
    if (!todo.category && todo.recommendationId) {
      const recommendation = recommendationStore.load(todo.recommendationId);
      if (recommendation?.triggerData?.ruleName) {
        enriched.category = getRuleCategory(recommendation.triggerData.ruleName);
        needsUpdate = true;
      }
    }

    return needsUpdate ? enriched : todo;
  });
}

// ============================================
// GET /api/teacher-todos
// Get todos with optional filtering
// ============================================

router.get("/", (req, res) => {
  try {
    const { status, teacherId, classId, grouped } = req.query;

    let todos = teacherTodoStore.getAll();

    // Exclude superseded todos by default (they're historical only)
    if (status !== "superseded") {
      todos = todos.filter((t) => t.status !== "superseded");
    }

    // Filter by status
    if (status === "open" || status === "done" || status === "superseded") {
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

    // Enrich todos with lesson data and category if missing
    todos = enrichTodos(todos);

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

    // Append system note to associated sessions
    appendFollowupNoteToSessions(todo);

    // Recalculate assignment reviewState (may transition to "resolved")
    syncAssignmentReviewState(todo);

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

    // Remove the system note that was added on completion
    removeFollowupNoteFromSessions(todo);

    // Recalculate assignment reviewState (may transition back to "followup_scheduled")
    syncAssignmentReviewState(todo);

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
// POST /api/teacher-todos/:id/supersede
// Mark a todo as superseded (e.g., when review is reopened)
// ============================================

router.post("/:id/supersede", (req, res) => {
  try {
    const { id } = req.params;
    const todo = teacherTodoStore.supersede(id);

    if (!todo) {
      return res.status(404).json({ error: "Todo not found" });
    }

    // Recalculate assignment reviewState (superseded todos don't count as active)
    syncAssignmentReviewState(todo);

    const counts = teacherTodoStore.getCounts();

    res.json({
      success: true,
      todo,
      totalOpen: counts.open,
    });
  } catch (error) {
    console.error("Error superseding teacher todo:", error);
    res.status(500).json({ error: "Failed to supersede teacher todo" });
  }
});

// ============================================
// DELETE /api/teacher-todos/:id
// Delete a todo and optionally reactivate its recommendation
// ============================================

router.delete("/:id", (req, res) => {
  try {
    const { id } = req.params;
    const { reactivateRecommendation } = req.query;

    // Load the todo first to get the recommendationId
    const todo = teacherTodoStore.load(id);
    if (!todo) {
      return res.status(404).json({ error: "Todo not found" });
    }

    const recommendationId = todo.recommendationId;

    // Delete the todo
    const deleted = teacherTodoStore.delete(id);
    if (!deleted) {
      return res.status(404).json({ error: "Todo not found" });
    }

    // Optionally reactivate the associated recommendation
    let reactivatedRecommendation = null;
    if (reactivateRecommendation === "true" && recommendationId) {
      reactivatedRecommendation = recommendationStore.reactivate(recommendationId);
    }

    res.json({
      success: true,
      reactivatedRecommendation: reactivatedRecommendation ? true : false,
    });
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
