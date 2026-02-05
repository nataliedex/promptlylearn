import { Router } from "express";
import { randomUUID } from "crypto";
import { StudentStore } from "../../stores/studentStore";
import { StudentAssignmentStore } from "../../stores/studentAssignmentStore";
import { ClassStore } from "../../stores/classStore";
import { getAllLessons, loadLessonById } from "../../loaders/lessonLoader";
import { Student } from "../../domain/student";
import { badgeStore } from "../../stores/badgeStore";
import { actionOutcomeStore } from "../../stores/actionOutcomeStore";
import { SessionStore } from "../../stores/sessionStore";
import { BADGE_TYPES, BadgeType } from "../../domain/recommendation";
import { studentProfileStore } from "../../stores/studentProfileStore";
import { getStudentDisplayName } from "../../domain/studentProfile";

const router = Router();
const studentStore = new StudentStore();
const studentAssignmentStore = new StudentAssignmentStore();
const classStore = new ClassStore();

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
// Includes preferredName from profile for coach usage
router.get("/:id", (req, res) => {
  try {
    const student = studentStore.load(req.params.id);
    if (!student) {
      return res.status(404).json({ error: "Student not found" });
    }

    // Get profile to include preferredName and pronouns
    const profile = studentProfileStore.get(req.params.id);
    const preferredName = profile ? getStudentDisplayName(profile) : student.name.split(/\s+/)[0];

    res.json({
      ...student,
      preferredName,
      pronouns: profile?.pronouns,
    });
  } catch (error) {
    console.error("Error fetching student:", error);
    res.status(500).json({ error: "Failed to fetch student" });
  }
});

// GET /api/students/login/:code - Login student by studentCode
// This is the primary way students access the app
router.get("/login/:code", (req, res) => {
  try {
    const code = req.params.code?.trim();
    if (!code) {
      return res.status(400).json({ error: "Student code is required" });
    }

    const student = studentStore.findByCode(code);
    if (!student) {
      return res.status(404).json({ error: "Invalid student code" });
    }

    // Get profile for preferredName
    const profile = studentProfileStore.get(student.id);
    const preferredName = profile ? getStudentDisplayName(profile) : student.name.split(/\s+/)[0];

    res.json({
      student: {
        ...student,
        preferredName,
        pronouns: profile?.pronouns,
      },
    });
  } catch (error) {
    console.error("Error logging in student:", error);
    res.status(500).json({ error: "Failed to login" });
  }
});

// POST /api/students - Create student (demo mode only when ENABLE_DEMO_LOGIN=true)
// For real students, use educator tools to create them
router.post("/", (req, res) => {
  try {
    const { name, isDemo } = req.body;

    // Check if demo mode is enabled
    const demoEnabled = process.env.ENABLE_DEMO_LOGIN === "true";

    if (!demoEnabled && isDemo) {
      return res.status(403).json({ error: "Demo mode is not enabled" });
    }

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ error: "Name is required" });
    }

    const trimmedName = name.trim();

    // For demo mode, check if student already exists by name
    if (isDemo) {
      const existing = studentStore.findByName(trimmedName);
      if (existing) {
        return res.json({ student: existing, isNew: false });
      }

      // Create demo student (no studentCode, marked as demo)
      const newStudent: Student = {
        id: randomUUID(),
        name: `Demo Student`, // Don't use user input as legal name
        preferredName: trimmedName, // Use input as preferred name only
        isDemo: true,
        classes: [],
        assignments: [],
        createdAt: new Date(),
      };

      studentStore.save(newStudent);
      return res.status(201).json({ student: newStudent, isNew: true });
    }

    // Non-demo student creation (should be done by educator, not here)
    // This path is kept for backwards compatibility but generates a code
    const existing = studentStore.findByName(trimmedName);
    if (existing) {
      return res.json({ student: existing, isNew: false });
    }

    const newStudent: Student = {
      id: randomUUID(),
      name: trimmedName,
      studentCode: studentStore.generateUniqueCode(),
      classes: [],
      assignments: [],
      createdAt: new Date(),
    };

    studentStore.save(newStudent);
    res.status(201).json({ student: newStudent, isNew: true });
  } catch (error) {
    console.error("Error creating student:", error);
    res.status(500).json({ error: "Failed to create student" });
  }
});

// POST /api/students/:id/regenerate-code - Regenerate student's login code
router.post("/:id/regenerate-code", (req, res) => {
  try {
    const { id } = req.params;

    const student = studentStore.load(id);
    if (!student) {
      return res.status(404).json({ error: "Student not found" });
    }

    const newCode = studentStore.regenerateCode(id);
    if (!newCode) {
      return res.status(500).json({ error: "Failed to regenerate code" });
    }

    res.json({ studentCode: newCode });
  } catch (error) {
    console.error("Error regenerating student code:", error);
    res.status(500).json({ error: "Failed to regenerate code" });
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
 * Only returns active (non-completed) assignments
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

    // Get only active (non-completed) assignments for this student
    const allActiveAssignments = studentAssignmentStore.getActiveStudentAssignments(id);

    // Filter to only assignments whose classId matches a class the student currently belongs to.
    // classStore.findByStudent is the canonical source of truth for class membership.
    const studentClasses = classStore.findByStudent(id);
    const studentClassIds = new Set(studentClasses.map(c => c.id));
    const activeAssignments = allActiveAssignments.filter(a => studentClassIds.has(a.classId));

    // Debug: log filtered-out orphaned active assignments
    const orphanedActive = allActiveAssignments.filter(a => !studentClassIds.has(a.classId));
    if (orphanedActive.length > 0) {
      console.log(`[StudentLessons] Filtered ${orphanedActive.length} orphaned active assignment(s) for student ${id}:`,
        orphanedActive.map(a => `lessonId=${a.lessonId} classId=${a.classId}`));
    }

    const assignedLessonIds = [...new Set(activeAssignments.map(a => a.lessonId))];

    // Build a map from classId to class name
    const classNameMap: Record<string, string> = {};
    studentClasses.forEach(c => {
      classNameMap[c.id] = c.name;
    });

    // Build maps of attempts, assignedAt, dueDate, and classId per lesson
    const attemptsMap: Record<string, number> = {};
    const assignedAtMap: Record<string, string> = {};
    const dueDateMap: Record<string, string> = {};
    const classIdMap: Record<string, string> = {};
    activeAssignments.forEach(a => {
      attemptsMap[a.lessonId] = a.attempts || 1;
      if (a.assignedAt) {
        assignedAtMap[a.lessonId] = String(a.assignedAt);
      }
      if (a.dueDate) {
        dueDateMap[a.lessonId] = String(a.dueDate);
      }
      if (a.classId) {
        classIdMap[a.lessonId] = a.classId;
      }
    });

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
        subject: lesson.subject,
        attempts: attemptsMap[lesson.id] || 1,
        assignedAt: assignedAtMap[lesson.id],
        dueDate: dueDateMap[lesson.id],
        className: classIdMap[lesson.id] ? classNameMap[classIdMap[lesson.id]] : undefined,
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

/**
 * GET /api/students/:id/assignments
 * Get all assignment records for a student with reviewState
 * Returns assignment metadata including reviewState for teacher dashboard use
 */
router.get("/:id/assignments", (req, res) => {
  try {
    const { id } = req.params;

    // Verify student exists
    const student = studentStore.load(id);
    if (!student) {
      return res.status(404).json({ error: "Student not found" });
    }

    // Get all assignments for this student, filtered to classes the student currently belongs to.
    // This prevents orphaned assignments (from class removal) from leaking into the student view.
    const allAssignments = studentAssignmentStore.getStudentAssignments(id);
    const studentClasses = classStore.findByStudent(id);
    const studentClassIds = new Set(studentClasses.map(c => c.id));
    const assignments = allAssignments.filter(a => studentClassIds.has(a.classId));

    // Debug: log filtered-out orphaned assignments
    const orphaned = allAssignments.filter(a => !studentClassIds.has(a.classId));
    if (orphaned.length > 0) {
      console.log(`[StudentAssignments] Filtered ${orphaned.length} orphaned assignment(s) for student ${id}:`,
        orphaned.map(a => `lessonId=${a.lessonId} classId=${a.classId}`));
    }

    // Get lesson titles for each assignment
    const allLessons = getAllLessons();
    const lessonMap = new Map(allLessons.map(l => [l.id, l]));

    const assignmentsWithDetails = assignments.map(a => {
      const lesson = lessonMap.get(a.lessonId);
      return {
        ...a,
        lessonTitle: lesson?.title || "Unknown Lesson",
        subject: lesson?.subject,
        totalQuestions: lesson?.prompts?.length || 0,
      };
    });

    res.json({
      studentId: id,
      studentName: student.name,
      assignments: assignmentsWithDetails,
      count: assignmentsWithDetails.length,
    });
  } catch (error) {
    console.error("Error fetching student assignments:", error);
    res.status(500).json({ error: "Failed to fetch student assignments" });
  }
});

// ============================================
// Student-Facing Badge & Note Endpoints
// ============================================

/**
 * Student-facing badge response type
 */
interface StudentBadge {
  id: string;
  badgeType: BadgeType;
  badgeTypeName: string;
  subject?: string;
  assignmentId?: string;
  assignmentTitle?: string;
  awardedAt: string;
  awardedBy?: string;
  reason?: string;
  evidence?: {
    previousScore?: number;
    currentScore?: number;
    improvement?: number;
    subjectAverageScore?: number;
    subjectAssignmentCount?: number;
    hintUsageRate?: number;
  };
  celebratedAt?: string; // When the student was shown a celebration for this badge
}

/**
 * GET /api/students/:id/badges
 * Get badges awarded to a specific student
 */
router.get("/:id/badges", (req, res) => {
  try {
    const { id } = req.params;

    // Verify student exists
    const student = studentStore.load(id);
    if (!student) {
      return res.status(404).json({ error: "Student not found" });
    }

    // Get all badges for this student
    const rawBadges = badgeStore.getByStudent(id);

    // Build lesson map for assignment titles and subjects
    const allLessons = getAllLessons();
    const lessonMap = new Map(allLessons.map((l) => [l.id, l]));

    // Transform to student-facing format
    const badges: StudentBadge[] = rawBadges.map((badge) => {
      const lesson = badge.assignmentId ? lessonMap.get(badge.assignmentId) : null;

      return {
        id: badge.id,
        badgeType: badge.type,
        badgeTypeName: BADGE_TYPES[badge.type] || badge.type,
        subject: lesson?.subject,
        assignmentId: badge.assignmentId,
        assignmentTitle: lesson?.title,
        awardedAt: typeof badge.issuedAt === "string" ? badge.issuedAt : badge.issuedAt.toISOString(),
        awardedBy: badge.awardedBy,
        reason: badge.message,
        evidence: badge.evidence,
        celebratedAt: badge.celebratedAt,
      };
    });

    res.json({
      studentId: id,
      studentName: student.name,
      badges,
      count: badges.length,
    });
  } catch (error) {
    console.error("Error fetching student badges:", error);
    res.status(500).json({ error: "Failed to fetch student badges" });
  }
});

/**
 * POST /api/students/:id/badges/:badgeId/mark-celebrated
 * Mark a badge as celebrated (shown to student)
 */
router.post("/:id/badges/:badgeId/mark-celebrated", (req, res) => {
  try {
    const { id, badgeId } = req.params;

    // Verify student exists
    const student = studentStore.load(id);
    if (!student) {
      return res.status(404).json({ error: "Student not found" });
    }

    // Load the badge
    const badge = badgeStore.load(badgeId);
    if (!badge) {
      return res.status(404).json({ error: "Badge not found" });
    }

    // Verify the badge belongs to this student
    if (badge.studentId !== id) {
      return res.status(403).json({ error: "Badge does not belong to this student" });
    }

    // Mark as celebrated
    badge.celebratedAt = new Date().toISOString();
    badgeStore.save(badge);

    res.json({ success: true, celebratedAt: badge.celebratedAt });
  } catch (error) {
    console.error("Error marking badge as celebrated:", error);
    res.status(500).json({ error: "Failed to mark badge as celebrated" });
  }
});

/**
 * Student-facing note response type
 */
interface StudentNote {
  id: string;
  createdAt: string;
  teacherName: string;
  subject?: string;
  assignmentId?: string;
  assignmentTitle?: string;
  attemptNumber?: number;
  noteText: string;
  source: "session" | "recommendation";
}

/**
 * PRIVACY: Patterns that indicate system/internal notes that should NEVER be shown to students.
 * These notes are for educator tracking only.
 */
const SYSTEM_NOTE_PATTERNS = [
  /\[System\s*·/i,                    // [System · date] markers
  /---\s*\n\[System/i,                // System note blocks
  /Action taken:/i,                    // Internal action tracking
  /Added to Teacher To-Dos/i,          // Internal workflow tracking
  /Follow-up completed:/i,             // Follow-up tracking
  /Needs support:.*show similar/i,     // Group analysis patterns
  /Group averaged \d+%/i,              // Group score analysis
];

/**
 * PRIVACY: Check if a note contains system/internal content that should be hidden from students.
 * @param noteText - The note text to check
 * @returns true if the note is system/internal (should NOT be shown to students)
 */
function isSystemNote(noteText: string): boolean {
  if (!noteText) return false;
  return SYSTEM_NOTE_PATTERNS.some((pattern) => pattern.test(noteText));
}

/**
 * PRIVACY: Extract only the student-visible portion of educator notes.
 * Removes system blocks while preserving teacher-written personal notes.
 * @param noteText - The full educator notes text (may contain mixed content)
 * @returns The cleaned note text safe for student viewing, or null if nothing remains
 */
function extractStudentVisibleNote(noteText: string): string | null {
  if (!noteText) return null;

  // Remove system note blocks (--- followed by [System ...] sections)
  let cleaned = noteText.replace(/\n---\n\[System\s*·[^\]]*\][^\n]*(\n[^\n---]*)?/gi, "");

  // Remove standalone system markers
  cleaned = cleaned.replace(/\[System\s*·[^\]]*\][^\n]*/gi, "");

  // Remove action tracking lines
  cleaned = cleaned.replace(/Action taken:[^\n]*/gi, "");
  cleaned = cleaned.replace(/Added to Teacher To-Dos[^\n]*/gi, "");
  cleaned = cleaned.replace(/Follow-up completed:[^\n]*/gi, "");

  // Clean up extra whitespace/separators
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
  cleaned = cleaned.replace(/^---\s*$/gm, "").trim();

  // If the cleaned text is entirely a system note or empty, return null
  if (!cleaned || isSystemNote(cleaned)) {
    return null;
  }

  return cleaned;
}

/**
 * PRIVACY GUARD: Log warning if a potentially private note is about to be exposed.
 * This runs in development as a safety check.
 */
function logPrivacyLeakageAttempt(context: string, noteText: string): void {
  if (process.env.NODE_ENV !== "production") {
    console.warn(
      `[PRIVACY GUARD] Blocked potential note leakage to student:\n` +
      `  Context: ${context}\n` +
      `  Note preview: ${noteText.substring(0, 100)}...`
    );
  }
}

/**
 * GET /api/students/:id/notes
 * Get teacher notes for a specific student (from sessions and recommendation actions)
 */
router.get("/:id/notes", (req, res) => {
  try {
    const { id } = req.params;

    // Verify student exists
    const student = studentStore.load(id);
    if (!student) {
      return res.status(404).json({ error: "Student not found" });
    }

    const notes: StudentNote[] = [];

    // Build lesson map for assignment titles and subjects
    const allLessons = getAllLessons();
    const lessonMap = new Map(allLessons.map((l) => [l.id, l]));

    // 1. Get notes from completed sessions (educatorNotes field)
    const sessionStore = new SessionStore();
    const completedSessions = sessionStore.getCompletedByStudentId(id);

    // Group sessions by lessonId to calculate attempt numbers
    const sessionsByLesson = new Map<string, typeof completedSessions>();
    completedSessions.forEach((session) => {
      const existing = sessionsByLesson.get(session.lessonId) || [];
      existing.push(session);
      sessionsByLesson.set(session.lessonId, existing);
    });

    // Sort sessions within each lesson by date (oldest first for attempt numbering)
    sessionsByLesson.forEach((sessions) => {
      sessions.sort((a, b) => {
        const dateA = new Date(a.completedAt || a.startedAt).getTime();
        const dateB = new Date(b.completedAt || b.startedAt).getTime();
        return dateA - dateB;
      });
    });

    // Extract notes from sessions - PRIVACY FILTERED
    completedSessions.forEach((session) => {
      if (session.educatorNotes) {
        // PRIVACY: Extract only student-visible content, filtering out system notes
        const studentVisibleNote = extractStudentVisibleNote(session.educatorNotes);

        // If the entire note is system/internal, skip it
        if (!studentVisibleNote) {
          logPrivacyLeakageAttempt(
            `session-${session.id}`,
            session.educatorNotes
          );
          return;
        }

        const lesson = lessonMap.get(session.lessonId);
        const lessonSessions = sessionsByLesson.get(session.lessonId) || [];
        const attemptNumber = lessonSessions.findIndex((s) => s.id === session.id) + 1;

        // Convert dates to ISO strings (handling both string and Date types)
        const completedDate = session.completedAt
          ? (typeof session.completedAt === "string" ? session.completedAt : new Date(session.completedAt).toISOString())
          : null;
        const startedDate = typeof session.startedAt === "string"
          ? session.startedAt
          : session.startedAt.toISOString();
        const createdAt = completedDate || startedDate;

        notes.push({
          id: `session-${session.id}`,
          createdAt,
          teacherName: "Your teacher",
          subject: lesson?.subject,
          assignmentId: session.lessonId,
          assignmentTitle: session.lessonTitle,
          attemptNumber,
          noteText: studentVisibleNote,
          source: "session",
        });
      }
    });

    // 2. Get notes from recommendation action outcomes - PRIVACY FILTERED
    const outcomes = actionOutcomeStore.getByStudent(id);
    outcomes.forEach((outcome) => {
      if (outcome.actionType === "add_note" && outcome.metadata?.noteText) {
        // PRIVACY: Only include notes explicitly marked for student visibility
        // Default is "educator" (private) for backward compatibility
        const visibility = outcome.metadata.noteVisibility || "educator";

        if (visibility !== "student") {
          logPrivacyLeakageAttempt(
            `outcome-${outcome.id}`,
            outcome.metadata.noteText
          );
          return; // Skip educator-only notes
        }

        // Additional safety check: even if marked student-visible, filter system content
        if (isSystemNote(outcome.metadata.noteText)) {
          logPrivacyLeakageAttempt(
            `outcome-${outcome.id} (marked student but contains system content)`,
            outcome.metadata.noteText
          );
          return;
        }

        const lesson = outcome.affectedAssignmentId
          ? lessonMap.get(outcome.affectedAssignmentId)
          : null;

        notes.push({
          id: `outcome-${outcome.id}`,
          createdAt: outcome.actedAt,
          teacherName: "Your teacher",
          subject: lesson?.subject,
          assignmentId: outcome.affectedAssignmentId,
          assignmentTitle: lesson?.title,
          noteText: outcome.metadata.noteText,
          source: "recommendation",
        });
      }
    });

    // Sort notes by date (newest first)
    notes.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    res.json({
      studentId: id,
      studentName: student.name,
      notes,
      count: notes.length,
    });
  } catch (error) {
    console.error("Error fetching student notes:", error);
    res.status(500).json({ error: "Failed to fetch student notes" });
  }
});

export default router;
