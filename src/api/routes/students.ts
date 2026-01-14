import { Router } from "express";
import { randomUUID } from "crypto";
import { StudentStore } from "../../stores/studentStore";
import { StudentAssignmentStore } from "../../stores/studentAssignmentStore";
import { getAllLessons } from "../../loaders/lessonLoader";
import { Student } from "../../domain/student";

const router = Router();
const studentStore = new StudentStore();
const studentAssignmentStore = new StudentAssignmentStore();

// GET /api/students - List all students
router.get("/", (req, res) => {
  try {
    const students = studentStore.getAll();
    res.json(students);
  } catch (error) {
    console.error("Error fetching students:", error);
    res.status(500).json({ error: "Failed to fetch students" });
  }
});

// GET /api/students/:id - Get student by ID
router.get("/:id", (req, res) => {
  try {
    const student = studentStore.load(req.params.id);
    if (!student) {
      return res.status(404).json({ error: "Student not found" });
    }
    res.json(student);
  } catch (error) {
    console.error("Error fetching student:", error);
    res.status(500).json({ error: "Failed to fetch student" });
  }
});

// POST /api/students - Create or find student by name
router.post("/", (req, res) => {
  try {
    const { name } = req.body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ error: "Name is required" });
    }

    const trimmedName = name.trim();

    // Check if student already exists
    const existing = studentStore.findByName(trimmedName);
    if (existing) {
      return res.json({ student: existing, isNew: false });
    }

    // Create new student
    const newStudent: Student = {
      id: randomUUID(),
      name: trimmedName,
      createdAt: new Date(),
    };

    studentStore.save(newStudent);
    res.status(201).json({ student: newStudent, isNew: true });
  } catch (error) {
    console.error("Error creating student:", error);
    res.status(500).json({ error: "Failed to create student" });
  }
});

// GET /api/students/lookup/:name - Find student by name
router.get("/lookup/:name", (req, res) => {
  try {
    const student = studentStore.findByName(req.params.name);
    if (!student) {
      return res.status(404).json({ error: "Student not found" });
    }
    res.json(student);
  } catch (error) {
    console.error("Error finding student:", error);
    res.status(500).json({ error: "Failed to find student" });
  }
});

/**
 * GET /api/students/:id/lessons
 * Get lessons assigned to a specific student
 * Returns lesson summaries (not full lesson content)
 */
router.get("/:id/lessons", (req, res) => {
  try {
    const { id } = req.params;

    // Verify student exists
    const student = studentStore.load(id);
    if (!student) {
      return res.status(404).json({ error: "Student not found" });
    }

    // Get all assignments for this student
    const assignments = studentAssignmentStore.getStudentAssignments(id);
    const assignedLessonIds = [...new Set(assignments.map(a => a.lessonId))];

    // Get full lesson data and filter to assigned ones
    const allLessons = getAllLessons();
    const assignedLessons = allLessons
      .filter(lesson => assignedLessonIds.includes(lesson.id))
      .map(lesson => ({
        id: lesson.id,
        title: lesson.title,
        description: lesson.description,
        difficulty: lesson.difficulty,
        gradeLevel: lesson.gradeLevel,
        promptCount: lesson.prompts.length,
        standards: lesson.standards,
      }));

    res.json({
      studentId: id,
      studentName: student.name,
      lessons: assignedLessons,
      count: assignedLessons.length,
    });
  } catch (error) {
    console.error("Error fetching student lessons:", error);
    res.status(500).json({ error: "Failed to fetch student lessons" });
  }
});

export default router;
