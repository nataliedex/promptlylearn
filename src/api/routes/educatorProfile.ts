import { Router } from "express";
import { teacherProfileStore } from "../../stores/teacherProfileStore";
import { studentProfileStore } from "../../stores/studentProfileStore";
import { StudentStore } from "../../stores/studentStore";
import { ClassStore } from "../../stores/classStore";
import { TeacherProfileUpdate } from "../../domain/teacherProfile";
import {
  StudentProfileEducatorUpdate,
  sanitizeProfileForStudent,
} from "../../domain/studentProfile";

const router = Router();
const studentStore = new StudentStore();
const classStore = new ClassStore();

// Default teacher ID for v1 (single-teacher mode)
const DEFAULT_TEACHER_ID = "teacher-1";
const DEFAULT_TEACHER_NAME = "Teacher";
const DEFAULT_STUDENT_FACING_NAME = "Mrs. Teacher";

// ============================================
// Teacher Profile Endpoints (Educator Only)
// ============================================

/**
 * GET /api/educator/profile
 * Get the current teacher's profile
 */
router.get("/profile", (req, res) => {
  try {
    const profile = teacherProfileStore.getOrCreate(
      DEFAULT_TEACHER_ID,
      DEFAULT_TEACHER_NAME,
      DEFAULT_STUDENT_FACING_NAME
    );
    res.json(profile);
  } catch (error) {
    console.error("Error fetching teacher profile:", error);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

/**
 * PATCH /api/educator/profile
 * Update the current teacher's profile
 */
router.patch("/profile", (req, res) => {
  try {
    const updates: TeacherProfileUpdate = req.body;

    // Validate updates
    if (updates.coachTone && !["supportive", "direct", "structured"].includes(updates.coachTone)) {
      return res.status(400).json({ error: "Invalid coachTone value" });
    }
    if (updates.coachVoiceMode && !["default_coach_voice", "teacher_voice"].includes(updates.coachVoiceMode)) {
      return res.status(400).json({ error: "Invalid coachVoiceMode value" });
    }

    // Ensure profile exists
    teacherProfileStore.getOrCreate(DEFAULT_TEACHER_ID, DEFAULT_TEACHER_NAME, DEFAULT_STUDENT_FACING_NAME);

    const updated = teacherProfileStore.update(DEFAULT_TEACHER_ID, updates);
    if (!updated) {
      return res.status(404).json({ error: "Profile not found" });
    }

    res.json(updated);
  } catch (error) {
    console.error("Error updating teacher profile:", error);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

// ============================================
// Student Profile Endpoints (Educator Only)
// ============================================

/**
 * GET /api/educator/students/:studentId/profile
 * Get a student's full profile (educator view - includes all fields)
 */
router.get("/students/:studentId/profile", (req, res) => {
  try {
    const { studentId } = req.params;

    // Verify student exists
    const student = studentStore.load(studentId);
    if (!student) {
      return res.status(404).json({ error: "Student not found" });
    }

    // Get class enrollments for this student
    const classes = classStore.findByStudent(studentId);
    const classIds = classes.map((c) => c.id);

    // Get or create profile
    const profile = studentProfileStore.getOrCreate(studentId, student.name, classIds);

    // Sync class IDs if they've changed
    if (JSON.stringify(profile.classIds.sort()) !== JSON.stringify(classIds.sort())) {
      studentProfileStore.syncClassIds(studentId, classIds);
    }

    res.json({
      profile,
      student: {
        id: student.id,
        name: student.name,
        studentCode: student.studentCode,
        isDemo: student.isDemo,
      },
    });
  } catch (error) {
    console.error("Error fetching student profile:", error);
    res.status(500).json({ error: "Failed to fetch student profile" });
  }
});

/**
 * PATCH /api/educator/students/:studentId/profile
 * Update a student's profile (educator only - students cannot edit)
 */
router.patch("/students/:studentId/profile", (req, res) => {
  try {
    const { studentId } = req.params;
    const updates: StudentProfileEducatorUpdate = req.body;

    // Verify student exists
    const student = studentStore.load(studentId);
    if (!student) {
      return res.status(404).json({ error: "Student not found" });
    }

    // Validate updates
    if (updates.inputPreference && !["voice", "typing", "no_preference"].includes(updates.inputPreference)) {
      return res.status(400).json({ error: "Invalid inputPreference value" });
    }
    if (updates.pacePreference && !["take_my_time", "keep_it_moving"].includes(updates.pacePreference)) {
      return res.status(400).json({ error: "Invalid pacePreference value" });
    }
    if (updates.coachHelpStyle && !["hints_first", "examples_first", "ask_me_questions"].includes(updates.coachHelpStyle)) {
      return res.status(400).json({ error: "Invalid coachHelpStyle value" });
    }

    // If legalName is being updated, also update the Student record
    if (updates.legalName && updates.legalName.trim()) {
      student.name = updates.legalName.trim();
      studentStore.save(student);
    }

    // Get class enrollments
    const classes = classStore.findByStudent(studentId);
    const classIds = classes.map((c) => c.id);

    // Ensure profile exists
    studentProfileStore.getOrCreate(studentId, student.name, classIds);

    const updated = studentProfileStore.update(studentId, updates);
    if (!updated) {
      return res.status(404).json({ error: "Profile not found" });
    }

    res.json({ profile: updated });
  } catch (error) {
    console.error("Error updating student profile:", error);
    res.status(500).json({ error: "Failed to update student profile" });
  }
});

// ============================================
// Student-Facing Profile Endpoint (Read Only)
// ============================================

/**
 * GET /api/students/:studentId/profile
 * Get a student's profile for student-facing UI (sanitized - no sensitive fields)
 *
 * PRIVACY: This endpoint MUST NOT include:
 * - legalName
 * - accommodations.notes
 * - Any teacher-only/internal fields
 */
router.get("/student-profile/:studentId", (req, res) => {
  try {
    const { studentId } = req.params;

    // Verify student exists
    const student = studentStore.load(studentId);
    if (!student) {
      return res.status(404).json({ error: "Student not found" });
    }

    // Get class enrollments
    const classes = classStore.findByStudent(studentId);
    const classIds = classes.map((c) => c.id);

    // Get or create profile
    const profile = studentProfileStore.getOrCreate(studentId, student.name, classIds);

    // PRIVACY: Sanitize for student viewing - removes legalName, accommodations.notes
    const safeProfile = sanitizeProfileForStudent(profile);

    res.json(safeProfile);
  } catch (error) {
    console.error("Error fetching student profile:", error);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

export default router;
