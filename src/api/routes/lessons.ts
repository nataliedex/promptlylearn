import { Router } from "express";
import { loadLesson, getAllLessons } from "../../loaders/lessonLoader";
import { generateLesson, generateSingleQuestion, type LessonParams } from "../../domain/lessonGenerator";
import { saveLesson, archiveLesson, unarchiveLesson, deleteLesson, getArchivedLessons, updateLessonSubject } from "../../stores/lessonStore";
import { StudentAssignmentStore } from "../../stores/studentAssignmentStore";
import { ClassStore } from "../../stores/classStore";
import { recommendationStore } from "../../stores/recommendationStore";
import { teacherTodoStore } from "../../stores/teacherTodoStore";
import { awardBadge } from "../../stores/actionHandlers";
import { StudentStore } from "../../stores/studentStore";
import { SessionStore } from "../../stores/sessionStore";
import { ChecklistActionKey, CHECKLIST_ACTIONS } from "../../domain/recommendation";
import { deriveReviewState } from "../../domain/studentAssignment";

const router = Router();
const studentAssignmentStore = new StudentAssignmentStore();
const classStore = new ClassStore();
const studentStore = new StudentStore();
const sessionStore = new SessionStore();

// GET /api/lessons - List all lessons
router.get("/", (req, res) => {
  try {
    const lessons = getAllLessons();
    // Return lesson metadata without full prompts for listing
    const lessonList = lessons.map(lesson => ({
      id: lesson.id,
      title: lesson.title,
      description: lesson.description,
      difficulty: lesson.difficulty,
      gradeLevel: lesson.gradeLevel,
      promptCount: lesson.prompts.length,
      standards: lesson.standards,
      subject: lesson.subject,
    }));
    res.json(lessonList);
  } catch (error) {
    console.error("Error fetching lessons:", error);
    res.status(500).json({ error: "Failed to fetch lessons" });
  }
});

// GET /api/lessons/unassigned - List lessons with no assignments
router.get("/unassigned", (req, res) => {
  try {
    const lessons = getAllLessons();
    // Filter to only lessons that have no student assignments
    const unassignedLessons = lessons.filter(lesson =>
      !studentAssignmentStore.hasAssignments(lesson.id)
    );
    // Return lesson metadata without full prompts for listing
    const lessonList = unassignedLessons.map(lesson => ({
      id: lesson.id,
      title: lesson.title,
      description: lesson.description,
      difficulty: lesson.difficulty,
      gradeLevel: lesson.gradeLevel,
      promptCount: lesson.prompts.length,
      standards: lesson.standards,
      subject: lesson.subject,
    }));
    res.json(lessonList);
  } catch (error) {
    console.error("Error fetching unassigned lessons:", error);
    res.status(500).json({ error: "Failed to fetch unassigned lessons" });
  }
});

// GET /api/lessons/:id - Get full lesson by ID
router.get("/:id", (req, res) => {
  try {
    const lessons = getAllLessons();
    const lesson = lessons.find(l => l.id === req.params.id);

    if (!lesson) {
      return res.status(404).json({ error: "Lesson not found" });
    }

    res.json(lesson);
  } catch (error) {
    console.error("Error fetching lesson:", error);
    res.status(500).json({ error: "Failed to fetch lesson" });
  }
});

// POST /api/lessons/generate - Generate a new lesson
router.post("/generate", async (req, res) => {
  try {
    const { mode, content, difficulty, questionCount, gradeLevel } = req.body;

    if (!mode || !content || !difficulty || !questionCount) {
      return res.status(400).json({
        error: "mode, content, difficulty, and questionCount are required",
      });
    }

    const params: LessonParams = {
      mode,
      content,
      difficulty,
      questionCount,
      gradeLevel,
    };

    const lesson = await generateLesson(params);

    if (!lesson) {
      return res.status(500).json({ error: "Failed to generate lesson" });
    }

    res.json(lesson);
  } catch (error) {
    console.error("Error generating lesson:", error);
    res.status(500).json({ error: "Failed to generate lesson" });
  }
});

// POST /api/lessons/generate-question - Generate a single additional question
router.post("/generate-question", async (req, res) => {
  try {
    const { lessonContext, existingQuestions, difficulty, focus, subject, gradeLevel } = req.body;

    if (!lessonContext || !existingQuestions || !difficulty) {
      return res.status(400).json({
        error: "lessonContext, existingQuestions, and difficulty are required",
      });
    }

    const prompt = await generateSingleQuestion(lessonContext, existingQuestions, difficulty, {
      focus: focus || undefined,
      subject: subject || undefined,
      gradeLevel: gradeLevel || undefined,
    });

    if (!prompt) {
      return res.status(500).json({ error: "Failed to generate question" });
    }

    res.json(prompt);
  } catch (error) {
    console.error("Error generating question:", error);
    res.status(500).json({ error: "Failed to generate question" });
  }
});

// POST /api/lessons - Save a new lesson
router.post("/", (req, res) => {
  try {
    const lesson = req.body;

    if (!lesson.id || !lesson.title || !lesson.prompts) {
      return res.status(400).json({
        error: "id, title, and prompts are required",
      });
    }

    const filePath = saveLesson(lesson);
    res.status(201).json({ lesson, filePath });
  } catch (error) {
    console.error("Error saving lesson:", error);
    res.status(500).json({ error: "Failed to save lesson" });
  }
});

// GET /api/lessons/archived - List all archived lessons
router.get("/archived/list", (req, res) => {
  try {
    const lessons = getArchivedLessons();
    // Return lesson metadata without full prompts for listing
    const lessonList = lessons.map(lesson => ({
      id: lesson.id,
      title: lesson.title,
      description: lesson.description,
      difficulty: lesson.difficulty,
      gradeLevel: lesson.gradeLevel,
      promptCount: lesson.prompts.length,
      standards: lesson.standards,
      subject: lesson.subject,
      archivedAt: (lesson as any).archivedAt,
    }));
    res.json(lessonList);
  } catch (error) {
    console.error("Error fetching archived lessons:", error);
    res.status(500).json({ error: "Failed to fetch archived lessons" });
  }
});

// POST /api/lessons/:id/archive - Archive a lesson
router.post("/:id/archive", (req, res) => {
  try {
    const { id } = req.params;
    const success = archiveLesson(id);

    if (success) {
      res.json({ success: true, message: `Lesson "${id}" archived successfully` });
    } else {
      res.status(404).json({ error: "Lesson not found" });
    }
  } catch (error) {
    console.error("Error archiving lesson:", error);
    res.status(500).json({ error: "Failed to archive lesson" });
  }
});

// POST /api/lessons/:id/unarchive - Unarchive a lesson
router.post("/:id/unarchive", (req, res) => {
  try {
    const { id } = req.params;
    const success = unarchiveLesson(id);

    if (success) {
      res.json({ success: true, message: `Lesson "${id}" restored successfully` });
    } else {
      res.status(404).json({ error: "Archived lesson not found" });
    }
  } catch (error) {
    console.error("Error unarchiving lesson:", error);
    res.status(500).json({ error: "Failed to restore lesson" });
  }
});

// DELETE /api/lessons/:id - Permanently delete a lesson
router.delete("/:id", (req, res) => {
  try {
    const { id } = req.params;
    const success = deleteLesson(id);

    if (success) {
      res.json({ success: true, message: `Lesson "${id}" deleted successfully` });
    } else {
      res.status(404).json({ error: "Lesson not found" });
    }
  } catch (error) {
    console.error("Error deleting lesson:", error);
    res.status(500).json({ error: "Failed to delete lesson" });
  }
});

// PATCH /api/lessons/:id/subject - Update lesson subject
router.patch("/:id/subject", (req, res) => {
  try {
    const { id } = req.params;
    const { subject } = req.body;

    // subject can be a string or null to clear
    if (subject !== null && subject !== undefined && typeof subject !== "string") {
      return res.status(400).json({ error: "subject must be a string or null" });
    }

    const lesson = updateLessonSubject(id, subject ?? null);

    if (!lesson) {
      return res.status(404).json({ error: "Lesson not found" });
    }

    res.json({
      success: true,
      lesson: {
        id: lesson.id,
        title: lesson.title,
        subject: lesson.subject,
      },
    });
  } catch (error) {
    console.error("Error updating lesson subject:", error);
    res.status(500).json({ error: "Failed to update lesson subject" });
  }
});

// ============================================
// Lesson Assignment Endpoints
// ============================================

/**
 * GET /api/lessons/:id/assignments
 * Get all assignments for a lesson (which classes and students)
 */
router.get("/:id/assignments", (req, res) => {
  try {
    const { id } = req.params;

    // Verify lesson exists
    const lessons = getAllLessons();
    const lesson = lessons.find(l => l.id === id);
    if (!lesson) {
      return res.status(404).json({ error: "Lesson not found" });
    }

    // Get class names for the summary
    const classes = classStore.getAll();
    const classNames: Record<string, string> = {};
    classes.forEach(c => {
      classNames[c.id] = c.name;
    });

    const summary = studentAssignmentStore.getAssignmentSummary(id, classNames);
    res.json(summary);
  } catch (error) {
    console.error("Error fetching lesson assignments:", error);
    res.status(500).json({ error: "Failed to fetch lesson assignments" });
  }
});

/**
 * POST /api/lessons/:id/assign
 * Assign a lesson to students through a class
 *
 * Body: {
 *   classId: string,
 *   studentIds?: string[]  // If omitted, assigns to ALL students in class
 * }
 */
router.post("/:id/assign", (req, res) => {
  try {
    const { id } = req.params;
    const { classId, studentIds } = req.body;

    if (!classId) {
      return res.status(400).json({ error: "classId is required" });
    }

    // Verify lesson exists
    const lessons = getAllLessons();
    const lesson = lessons.find(l => l.id === id);
    if (!lesson) {
      return res.status(404).json({ error: "Lesson not found" });
    }

    // Verify class exists and get students
    const classObj = classStore.load(classId);
    if (!classObj) {
      return res.status(404).json({ error: "Class not found" });
    }

    // Determine which students to assign
    let assignStudentIds: string[];
    if (studentIds && Array.isArray(studentIds) && studentIds.length > 0) {
      // Assign specific students (validate they're in the class)
      assignStudentIds = studentIds.filter(sid => classObj.studentIds.includes(sid));
      if (assignStudentIds.length === 0) {
        return res.status(400).json({ error: "None of the specified students are in this class" });
      }
    } else {
      // Assign all students in class
      assignStudentIds = classObj.studentIds;
    }

    if (assignStudentIds.length === 0) {
      return res.status(400).json({ error: "Class has no students to assign" });
    }

    // Create assignments
    const newAssignments = studentAssignmentStore.assignLesson(
      id,
      classId,
      assignStudentIds
    );

    res.status(201).json({
      success: true,
      lessonId: id,
      classId,
      className: classObj.name,
      assignedCount: newAssignments.length,
      totalInClass: classObj.studentIds.length,
      assignments: newAssignments,
    });
  } catch (error) {
    console.error("Error assigning lesson:", error);
    res.status(500).json({ error: "Failed to assign lesson" });
  }
});

/**
 * DELETE /api/lessons/:id/assign/:classId
 * Remove all assignments for a lesson from a specific class
 */
router.delete("/:id/assign/:classId", (req, res) => {
  try {
    const { id, classId } = req.params;

    const removedCount = studentAssignmentStore.unassignLessonFromClass(id, classId);

    res.json({
      success: true,
      lessonId: id,
      classId,
      removedCount,
    });
  } catch (error) {
    console.error("Error unassigning lesson:", error);
    res.status(500).json({ error: "Failed to unassign lesson" });
  }
});

/**
 * GET /api/lessons/:id/assigned-students
 * Get list of student IDs assigned to this lesson with assignment details
 * (Used by assignment lifecycle for dashboard computation)
 */
router.get("/:id/assigned-students", (req, res) => {
  try {
    const { id } = req.params;

    const studentIds = studentAssignmentStore.getAssignedStudentIds(id);
    const hasAssignments = studentIds.length > 0;

    // Get earliest assignment date
    const earliestAssignedAt = studentAssignmentStore.getEarliestAssignedAt(id);

    // Get full assignment details for each student (including attempts and reviewState)
    const assignments: Record<string, {
      attempts: number;
      completedAt?: string;
      reviewedAt?: string;
      reviewState: string;
      lastActionAt?: string;
      todoIds?: string[];
      badgeIds?: string[];
    }> = {};
    studentIds.forEach((studentId) => {
      const assignment = studentAssignmentStore.getAssignment(id, studentId);
      if (assignment) {
        // Derive reviewState from live todo data (single source of truth)
        const todoIds = assignment.todoIds || [];
        let openTodoCount = 0;
        let completedTodoCount = 0;
        for (const todoId of todoIds) {
          const todo = teacherTodoStore.load(todoId);
          if (!todo) continue;
          if (todo.status === "open") openTodoCount++;
          else if (todo.status === "done") completedTodoCount++;
          // superseded todos don't count
        }

        const hasBadge = (assignment.badgeIds?.length || 0) > 0;
        const reviewState = deriveReviewState(
          !!assignment.completedAt,
          !!assignment.reviewedAt,
          openTodoCount,
          completedTodoCount,
          hasBadge
        );

        assignments[studentId] = {
          attempts: assignment.attempts || 1,
          completedAt: assignment.completedAt,
          reviewedAt: assignment.reviewedAt,
          reviewState,
          lastActionAt: assignment.lastActionAt,
          todoIds: assignment.todoIds,
          badgeIds: assignment.badgeIds,
        };
      }
    });

    // Derive classId from the first assignment (all share the same class context)
    let classId: string | undefined;
    let className: string | undefined;
    for (const sid of studentIds) {
      const a = studentAssignmentStore.getAssignment(id, sid);
      if (a?.classId) {
        classId = a.classId;
        const classObj = classStore.load(a.classId);
        className = classObj?.name;
        break;
      }
    }

    res.json({
      lessonId: id,
      hasAssignments,
      studentIds,
      assignments,
      classId,
      className,
      earliestAssignedAt,
      count: studentIds.length,
    });
  } catch (error) {
    console.error("Error fetching assigned students:", error);
    res.status(500).json({ error: "Failed to fetch assigned students" });
  }
});

/**
 * GET /api/lessons/:id/students/:studentId/assignment
 * Get assignment details for a specific student including completion and review status
 */
router.get("/:id/students/:studentId/assignment", (req, res) => {
  try {
    const { id, studentId } = req.params;

    const assignment = studentAssignmentStore.getAssignment(id, studentId);
    if (!assignment) {
      return res.status(404).json({ error: "Assignment not found" });
    }

    res.json(assignment);
  } catch (error) {
    console.error("Error fetching assignment:", error);
    res.status(500).json({ error: "Failed to fetch assignment" });
  }
});

/**
 * POST /api/lessons/:id/students/:studentId/review
 * Mark a student's assignment as reviewed by teacher
 * This removes the student from the "needs attention" summaries
 * AND resolves any related global recommendations to ensure consistency
 */
router.post("/:id/students/:studentId/review", (req, res) => {
  try {
    const { id, studentId } = req.params;
    const { reviewedBy } = req.body;

    const success = studentAssignmentStore.markReviewed(id, studentId, reviewedBy);
    if (!success) {
      return res.status(404).json({ error: "Assignment not found" });
    }

    // Resolve any related global recommendations for this student+assignment
    // This ensures "What Should I Do Next?" doesn't show insights that have
    // already been addressed at the assignment level
    const resolvedRecommendationIds = recommendationStore.resolveByStudentAssignment(
      studentId,
      id,
      reviewedBy
    );

    // Get updated assignment to return reviewState
    const assignment = studentAssignmentStore.getAssignment(id, studentId);

    res.json({
      success: true,
      lessonId: id,
      studentId,
      reviewedAt: new Date().toISOString(),
      reviewState: assignment?.reviewState || "reviewed",
      resolvedRecommendations: resolvedRecommendationIds.length,
    });
  } catch (error) {
    console.error("Error marking assignment as reviewed:", error);
    res.status(500).json({ error: "Failed to mark as reviewed" });
  }
});

/**
 * POST /api/lessons/:id/students/:studentId/append-note
 * Append a system note to the latest completed session for a student+assignment.
 * Used to defer note creation (e.g., after an undo window expires).
 */
router.post("/:id/students/:studentId/append-note", (req, res) => {
  try {
    const { id, studentId } = req.params;
    const { note } = req.body;

    if (!note || typeof note !== "string") {
      return res.status(400).json({ error: "note is required" });
    }

    const sessions = sessionStore.getByStudentId(studentId)
      .filter((s) => s.lessonId === id && s.status === "completed");

    if (sessions.length === 0) {
      return res.status(404).json({ error: "No completed session found" });
    }

    const latest = sessions[0];
    latest.educatorNotes = (latest.educatorNotes || "") + note;
    sessionStore.save(latest);

    res.json({ success: true });
  } catch (error) {
    console.error("Error appending note:", error);
    res.status(500).json({ error: "Failed to append note" });
  }
});

/**
 * POST /api/lessons/:id/students/:studentId/push
 * Push an assignment back to a student for another attempt
 * This clears completion/review status and increments attempts counter
 */
router.post("/:id/students/:studentId/push", (req, res) => {
  try {
    const { id, studentId } = req.params;
    const { pushedBy } = req.body;

    const assignment = studentAssignmentStore.pushToStudent(id, studentId, pushedBy);
    if (!assignment) {
      return res.status(404).json({ error: "Assignment not found" });
    }

    res.json({
      success: true,
      lessonId: id,
      studentId,
      attempts: assignment.attempts,
      reviewState: assignment.reviewState,
      message: `Assignment pushed back to student (attempt #${assignment.attempts})`,
    });
  } catch (error) {
    console.error("Error pushing assignment:", error);
    res.status(500).json({ error: "Failed to push assignment" });
  }
});

/**
 * POST /api/lessons/:id/students/:studentId/undo-reassignment
 * Undo a reassignment by restoring previous state
 */
router.post("/:id/students/:studentId/undo-reassignment", (req, res) => {
  try {
    const { id, studentId } = req.params;
    const { previousCompletedAt, previousReviewedAt, previousReviewState } = req.body;

    const assignment = studentAssignmentStore.undoReassignment(
      id,
      studentId,
      previousCompletedAt,
      previousReviewedAt,
      previousReviewState
    );
    if (!assignment) {
      return res.status(404).json({ error: "Assignment not found" });
    }

    res.json({
      success: true,
      lessonId: id,
      studentId,
      attempts: assignment.attempts,
      completedAt: assignment.completedAt,
      reviewedAt: assignment.reviewedAt,
      reviewState: assignment.reviewState,
      message: "Reassignment undone successfully",
    });
  } catch (error) {
    console.error("Error undoing reassignment:", error);
    res.status(500).json({ error: "Failed to undo reassignment" });
  }
});

/**
 * POST /api/lessons/:id/students/:studentId/review-state
 * Set the canonical review state for a student's assignment
 * This is the preferred endpoint for updating review status
 */
router.post("/:id/students/:studentId/review-state", (req, res) => {
  try {
    const { id, studentId } = req.params;
    const { reviewState, reviewedBy, todoId, badgeId } = req.body;

    // Validate reviewState
    const validStates = ["not_started", "pending_review", "reviewed", "followup_scheduled", "resolved"];
    if (!reviewState || !validStates.includes(reviewState)) {
      return res.status(400).json({
        error: `Invalid reviewState. Must be one of: ${validStates.join(", ")}`,
      });
    }

    const assignment = studentAssignmentStore.setReviewState(id, studentId, reviewState, {
      reviewedBy,
      todoId,
      badgeId,
    });

    if (!assignment) {
      return res.status(404).json({ error: "Assignment not found" });
    }

    res.json({
      success: true,
      lessonId: id,
      studentId,
      reviewState: assignment.reviewState,
      reviewedAt: assignment.reviewedAt,
      lastActionAt: assignment.lastActionAt,
    });
  } catch (error) {
    console.error("Error setting review state:", error);
    res.status(500).json({ error: "Failed to set review state" });
  }
});

/**
 * POST /api/lessons/:id/students/:studentId/complete
 * Mark a student's assignment as completed
 * Called when a student finishes their session
 */
router.post("/:id/students/:studentId/complete", (req, res) => {
  try {
    const { id, studentId } = req.params;

    const success = studentAssignmentStore.markCompleted(id, studentId);
    if (!success) {
      return res.status(404).json({ error: "Assignment not found" });
    }

    res.json({
      success: true,
      lessonId: id,
      studentId,
      completedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error marking assignment as completed:", error);
    res.status(500).json({ error: "Failed to mark as completed" });
  }
});

/**
 * POST /api/lessons/:id/students/:studentId/review-actions
 * Submit review actions for a student's assignment
 *
 * This endpoint allows teachers to:
 * - Award a badge
 * - Create a teacher to-do
 * - Mark as reviewed
 * - Resolve related recommendations
 *
 * All actions in one call to keep the review workflow efficient.
 */
router.post("/:id/students/:studentId/review-actions", (req, res) => {
  try {
    const { id, studentId } = req.params;
    const {
      awardBadgeType,
      badgeMessage,
      createTodo,
      todoActionKey,
      todoCustomLabel,
      recommendationId,
      teacherId = "educator",
    } = req.body;

    // Verify assignment exists
    const assignment = studentAssignmentStore.getAssignment(id, studentId);
    if (!assignment) {
      return res.status(404).json({ error: "Assignment not found" });
    }

    // Get lesson and student info for context
    const lessons = getAllLessons();
    const lesson = lessons.find(l => l.id === id);
    const student = studentStore.load(studentId);

    const results: {
      badge?: { id: string; type: string };
      todo?: { id: string; label: string };
      reviewed: boolean;
      resolvedRecommendations: number;
    } = {
      reviewed: false,
      resolvedRecommendations: 0,
    };

    // 1. Award badge if requested
    if (awardBadgeType) {
      try {
        const badge = awardBadge(studentId, awardBadgeType, id, teacherId, badgeMessage);
        results.badge = { id: badge.id, type: badge.type };
      } catch (err) {
        console.error("Error awarding badge:", err);
        // Continue with other actions
      }
    }

    // 2. Create teacher to-do if requested
    if (createTodo && todoActionKey) {
      try {
        // Validate and get the action config
        const actionKey = (todoActionKey === "custom" ? "add_note" : todoActionKey) as ChecklistActionKey;
        const actionConfig = CHECKLIST_ACTIONS[actionKey];
        const todoLabel = todoActionKey === "custom" && todoCustomLabel
          ? todoCustomLabel.trim()
          : (actionConfig?.label || todoActionKey);

        const todo = teacherTodoStore.create({
          teacherId,
          recommendationId: recommendationId || "",
          actionKey,
          label: todoLabel,
          assignmentId: id,
          assignmentTitle: lesson?.title,
          studentIds: [studentId],
          studentNames: student?.name || studentId,
          subject: lesson?.subject,
        });
        results.todo = { id: todo.id, label: todo.label };
      } catch (err) {
        console.error("Error creating todo:", err);
        // Continue with other actions
      }
    }

    // 3. Set reviewState based on actions taken (single source of truth)
    // Priority: followup_scheduled (has open todo) > resolved (badge/completed todo) > reviewed
    let finalReviewState: "reviewed" | "followup_scheduled" | "resolved" = "reviewed";
    if (results.todo) {
      // Has an open follow-up todo
      finalReviewState = "followup_scheduled";
    } else if (results.badge) {
      // Badge awarded counts as resolved action
      finalReviewState = "resolved";
    }

    // Use setReviewState for proper state management
    const updatedAssignment = studentAssignmentStore.setReviewState(id, studentId, finalReviewState, {
      reviewedBy: teacherId,
      badgeId: results.badge?.id,
      todoId: results.todo?.id,
    });
    results.reviewed = !!updatedAssignment;

    // 4. Resolve any related global recommendations
    const resolvedIds = recommendationStore.resolveByStudentAssignment(studentId, id, teacherId);
    results.resolvedRecommendations = resolvedIds.length;

    res.json({
      success: true,
      lessonId: id,
      studentId,
      reviewedAt: new Date().toISOString(),
      reviewState: finalReviewState,
      ...results,
    });
  } catch (error) {
    console.error("Error submitting review actions:", error);
    res.status(500).json({ error: "Failed to submit review actions" });
  }
});

export default router;
