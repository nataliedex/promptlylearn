/**
 * Classes API Routes
 *
 * CRUD operations for classes/sections.
 * Classes are teacher-defined groupings of students.
 */

import { Router } from "express";
import { randomUUID } from "crypto";
import { ClassStore } from "../../stores/classStore";
import { StudentStore } from "../../stores/studentStore";
import { Student } from "../../domain/student";

const router = Router();
const classStore = new ClassStore();
const studentStore = new StudentStore();

// ============================================
// Class CRUD
// ============================================

/**
 * GET /api/classes
 * List all classes (excludes archived by default)
 */
router.get("/", (req, res) => {
  try {
    const includeArchived = req.query.includeArchived === "true";
    const classes = classStore.getAllSummaries(includeArchived);
    res.json(classes);
  } catch (error) {
    console.error("Error fetching classes:", error);
    res.status(500).json({ error: "Failed to fetch classes" });
  }
});

/**
 * GET /api/classes/archived
 * List only archived classes
 */
router.get("/archived", (req, res) => {
  try {
    const classes = classStore.getArchived();
    res.json(classes);
  } catch (error) {
    console.error("Error fetching archived classes:", error);
    res.status(500).json({ error: "Failed to fetch archived classes" });
  }
});

/**
 * GET /api/classes/:id
 * Get a class by ID with full details including student info
 */
router.get("/:id", (req, res) => {
  try {
    const classObj = classStore.load(req.params.id);

    if (!classObj) {
      return res.status(404).json({ error: "Class not found" });
    }

    // Load student details for the class
    const students: Student[] = [];
    for (const studentId of classObj.studentIds) {
      const student = studentStore.load(studentId);
      if (student) {
        students.push(student);
      }
    }

    res.json({
      ...classObj,
      students,
    });
  } catch (error) {
    console.error("Error fetching class:", error);
    res.status(500).json({ error: "Failed to fetch class" });
  }
});

/**
 * POST /api/classes
 * Create a new class
 */
router.post("/", (req, res) => {
  try {
    const { name, description, gradeLevel, schoolYear, period, subject } = req.body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ error: "Class name is required" });
    }

    const classObj = classStore.create({
      name: name.trim(),
      description,
      gradeLevel,
      schoolYear,
      period,
      subject,
    });

    res.status(201).json(classObj);
  } catch (error) {
    console.error("Error creating class:", error);
    res.status(500).json({ error: "Failed to create class" });
  }
});

/**
 * PUT /api/classes/:id
 * Update a class
 */
router.put("/:id", (req, res) => {
  try {
    const { name, description, gradeLevel, schoolYear, period, subject } = req.body;

    const updated = classStore.update(req.params.id, {
      name: name?.trim(),
      description,
      gradeLevel,
      schoolYear,
      period,
      subject,
    });

    if (!updated) {
      return res.status(404).json({ error: "Class not found" });
    }

    res.json(updated);
  } catch (error) {
    console.error("Error updating class:", error);
    res.status(500).json({ error: "Failed to update class" });
  }
});

/**
 * POST /api/classes/:id/archive
 * Archive a class (soft delete)
 */
router.post("/:id/archive", (req, res) => {
  try {
    const archived = classStore.archive(req.params.id);

    if (!archived) {
      return res.status(404).json({ error: "Class not found" });
    }

    res.json(archived);
  } catch (error) {
    console.error("Error archiving class:", error);
    res.status(500).json({ error: "Failed to archive class" });
  }
});

/**
 * POST /api/classes/:id/restore
 * Restore an archived class
 */
router.post("/:id/restore", (req, res) => {
  try {
    const restored = classStore.restore(req.params.id);

    if (!restored) {
      return res.status(404).json({ error: "Class not found" });
    }

    res.json(restored);
  } catch (error) {
    console.error("Error restoring class:", error);
    res.status(500).json({ error: "Failed to restore class" });
  }
});

/**
 * DELETE /api/classes/:id
 * Permanently delete a class
 */
router.delete("/:id", (req, res) => {
  try {
    const deleted = classStore.delete(req.params.id);

    if (!deleted) {
      return res.status(404).json({ error: "Class not found" });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting class:", error);
    res.status(500).json({ error: "Failed to delete class" });
  }
});

// ============================================
// Student Membership
// ============================================

/**
 * POST /api/classes/:id/students
 * Add students to a class by their IDs
 */
router.post("/:id/students", (req, res) => {
  try {
    const { studentIds } = req.body;

    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ error: "studentIds array is required" });
    }

    const updated = classStore.addStudents(req.params.id, studentIds);

    if (!updated) {
      return res.status(404).json({ error: "Class not found" });
    }

    res.json(updated);
  } catch (error) {
    console.error("Error adding students to class:", error);
    res.status(500).json({ error: "Failed to add students to class" });
  }
});

/**
 * POST /api/classes/:id/students/bulk
 * Bulk add students by name - creates students if they don't exist
 * Supports comma-separated or newline-separated names
 */
router.post("/:id/students/bulk", (req, res) => {
  try {
    const { names } = req.body;

    if (!names || typeof names !== "string") {
      return res.status(400).json({ error: "names string is required" });
    }

    // Parse names - split by comma or newline
    const nameList = names
      .split(/[,\n]/)
      .map((n: string) => n.trim())
      .filter((n: string) => n.length > 0);

    if (nameList.length === 0) {
      return res.status(400).json({ error: "No valid names provided" });
    }

    // Create or find students
    const studentIds: string[] = [];
    const created: Student[] = [];
    const existing: Student[] = [];

    for (const name of nameList) {
      // Check if student exists
      let student = studentStore.findByName(name);

      if (student) {
        existing.push(student);
      } else {
        // Create new student
        student = {
          id: randomUUID(),
          name,
          createdAt: new Date(),
        };
        studentStore.save(student);
        created.push(student);
      }

      studentIds.push(student.id);
    }

    // Add students to class
    const updated = classStore.addStudents(req.params.id, studentIds);

    if (!updated) {
      return res.status(404).json({ error: "Class not found" });
    }

    res.json({
      class: updated,
      created: created.length,
      existing: existing.length,
      students: [...created, ...existing],
    });
  } catch (error) {
    console.error("Error bulk adding students:", error);
    res.status(500).json({ error: "Failed to bulk add students" });
  }
});

/**
 * DELETE /api/classes/:id/students/:studentId
 * Remove a student from a class
 */
router.delete("/:id/students/:studentId", (req, res) => {
  try {
    const updated = classStore.removeStudent(req.params.id, req.params.studentId);

    if (!updated) {
      return res.status(404).json({ error: "Class not found" });
    }

    res.json(updated);
  } catch (error) {
    console.error("Error removing student from class:", error);
    res.status(500).json({ error: "Failed to remove student from class" });
  }
});

export default router;
