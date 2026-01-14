import { Router } from "express";
import { loadLesson, getAllLessons } from "../../loaders/lessonLoader";
import { generateLesson, generateSingleQuestion, type LessonParams } from "../../domain/lessonGenerator";
import { saveLesson, archiveLesson, unarchiveLesson, getArchivedLessons } from "../../stores/lessonStore";
import { StudentAssignmentStore } from "../../stores/studentAssignmentStore";
import { ClassStore } from "../../stores/classStore";

const router = Router();
const studentAssignmentStore = new StudentAssignmentStore();
const classStore = new ClassStore();

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
    }));
    res.json(lessonList);
  } catch (error) {
    console.error("Error fetching lessons:", error);
    res.status(500).json({ error: "Failed to fetch lessons" });
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
    const { lessonContext, existingQuestions, difficulty } = req.body;

    if (!lessonContext || !existingQuestions || !difficulty) {
      return res.status(400).json({
        error: "lessonContext, existingQuestions, and difficulty are required",
      });
    }

    const prompt = await generateSingleQuestion(lessonContext, existingQuestions, difficulty);

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

    // Get full assignment details for each student (including attempts)
    const assignments: Record<string, { attempts: number; completedAt?: string; reviewedAt?: string }> = {};
    studentIds.forEach((studentId) => {
      const assignment = studentAssignmentStore.getAssignment(id, studentId);
      if (assignment) {
        assignments[studentId] = {
          attempts: assignment.attempts || 1,
          completedAt: assignment.completedAt,
          reviewedAt: assignment.reviewedAt,
        };
      }
    });

    res.json({
      lessonId: id,
      hasAssignments,
      studentIds,
      assignments,
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
 */
router.post("/:id/students/:studentId/review", (req, res) => {
  try {
    const { id, studentId } = req.params;
    const { reviewedBy } = req.body;

    const success = studentAssignmentStore.markReviewed(id, studentId, reviewedBy);
    if (!success) {
      return res.status(404).json({ error: "Assignment not found" });
    }

    res.json({
      success: true,
      lessonId: id,
      studentId,
      reviewedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error marking assignment as reviewed:", error);
    res.status(500).json({ error: "Failed to mark as reviewed" });
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
      message: `Assignment pushed back to student (attempt #${assignment.attempts})`,
    });
  } catch (error) {
    console.error("Error pushing assignment:", error);
    res.status(500).json({ error: "Failed to push assignment" });
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

export default router;
