import fs from "fs";
import path from "path";
import { Lesson } from "../domain/lesson";

const LESSONS_DIR = path.join(__dirname, "../data/lessons");
const ARCHIVE_DIR = path.join(LESSONS_DIR, "archive");
const SEQUENCE_FILE = path.join(__dirname, "../data/lesson-sequences.json");

// ============================================
// Lesson Sequence Tracking
// ============================================

interface SequenceData {
  // Key format: "{subject}-{grade}-{difficulty}" → next sequence number
  sequences: Record<string, number>;
}

/**
 * Load sequence data from file
 */
function loadSequenceData(): SequenceData {
  try {
    if (fs.existsSync(SEQUENCE_FILE)) {
      const rawData = fs.readFileSync(SEQUENCE_FILE, "utf-8");
      return JSON.parse(rawData);
    }
  } catch {
    // Return default if file doesn't exist or is invalid
  }
  return { sequences: {} };
}

/**
 * Save sequence data to file
 */
function saveSequenceData(data: SequenceData): void {
  const dir = path.dirname(SEQUENCE_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(SEQUENCE_FILE, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * Normalize a grade level string to a short form for the system index
 * Examples: "2nd Grade" → "2", "Kindergarten" → "K", "K" → "K", "3" → "3"
 */
function normalizeGradeForIndex(gradeLevel: string): string {
  const lower = gradeLevel.toLowerCase().trim();

  // Handle kindergarten
  if (lower === "k" || lower === "kindergarten") {
    return "K";
  }

  // Extract number from grade level (e.g., "2nd grade" → "2", "3rd Grade" → "3")
  const match = lower.match(/(\d+)/);
  if (match) {
    return match[1];
  }

  // Return first character uppercase if nothing else works
  return gradeLevel.charAt(0).toUpperCase();
}

/**
 * Generate the sequence key for tracking
 */
function getSequenceKey(subject: string, gradeLevel: string, difficulty: string): string {
  const normalizedSubject = subject.toLowerCase().replace(/\s+/g, "-");
  const normalizedGrade = normalizeGradeForIndex(gradeLevel).toLowerCase();
  const normalizedDifficulty = difficulty.toLowerCase();
  return `${normalizedSubject}-${normalizedGrade}-${normalizedDifficulty}`;
}

/**
 * Generate a system index for a new lesson
 * Format: "{Subject} {Grade}.{Sequence}"
 * Example: "Math 1.3"
 */
export function generateSystemIndex(subject: string, gradeLevel: string, difficulty: string): string {
  const data = loadSequenceData();
  const key = getSequenceKey(subject, gradeLevel, difficulty);

  // Get next sequence number (default to 1 if not exists)
  const nextSequence = (data.sequences[key] || 0) + 1;

  // Update and save the sequence
  data.sequences[key] = nextSequence;
  saveSequenceData(data);

  // Build the system index
  const grade = normalizeGradeForIndex(gradeLevel);
  return `${subject} ${grade}.${nextSequence}`;
}

/**
 * Ensure the lessons directory exists
 */
function ensureLessonsDir(): void {
  if (!fs.existsSync(LESSONS_DIR)) {
    fs.mkdirSync(LESSONS_DIR, { recursive: true });
  }
}

/**
 * Generate a URL-safe lesson ID from a title
 */
export function generateLessonId(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 50);
}

/**
 * Check if a lesson with the given ID already exists
 */
export function lessonExists(id: string): boolean {
  const filePath = path.join(LESSONS_DIR, `${id}.json`);
  return fs.existsSync(filePath);
}

/**
 * Generate a unique lesson ID (appends number if ID exists)
 */
export function getUniqueLessonId(title: string): string {
  const baseId = generateLessonId(title);

  if (!lessonExists(baseId)) {
    return baseId;
  }

  // Append numbers until we find a unique ID
  let counter = 2;
  while (lessonExists(`${baseId}-${counter}`)) {
    counter++;
  }

  return `${baseId}-${counter}`;
}

/**
 * Save a lesson to the lessons directory
 * Returns the file path of the saved lesson
 */
export function saveLesson(lesson: Lesson): string {
  ensureLessonsDir();

  const filePath = path.join(LESSONS_DIR, `${lesson.id}.json`);
  const jsonContent = JSON.stringify(lesson, null, 2);

  fs.writeFileSync(filePath, jsonContent, "utf-8");

  return filePath;
}

/**
 * Delete a lesson by ID
 */
export function deleteLesson(id: string): boolean {
  const filePath = path.join(LESSONS_DIR, `${id}.json`);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }

  return false;
}

/**
 * Ensure the archive directory exists
 */
function ensureArchiveDir(): void {
  if (!fs.existsSync(ARCHIVE_DIR)) {
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  }
}

/**
 * Archive a lesson by ID (move to archive folder)
 */
export function archiveLesson(id: string): boolean {
  ensureArchiveDir();

  const sourcePath = path.join(LESSONS_DIR, `${id}.json`);
  const destPath = path.join(ARCHIVE_DIR, `${id}.json`);

  if (fs.existsSync(sourcePath)) {
    // Read the lesson, add archivedAt timestamp, then move
    const rawData = fs.readFileSync(sourcePath, "utf-8");
    const lesson = JSON.parse(rawData);
    lesson.archivedAt = new Date().toISOString();

    fs.writeFileSync(destPath, JSON.stringify(lesson, null, 2), "utf-8");
    fs.unlinkSync(sourcePath);
    return true;
  }

  return false;
}

/**
 * Unarchive a lesson by ID (move back to main folder)
 */
export function unarchiveLesson(id: string): boolean {
  const sourcePath = path.join(ARCHIVE_DIR, `${id}.json`);
  const destPath = path.join(LESSONS_DIR, `${id}.json`);

  if (fs.existsSync(sourcePath)) {
    // Read the lesson, remove archivedAt timestamp, then move
    const rawData = fs.readFileSync(sourcePath, "utf-8");
    const lesson = JSON.parse(rawData);
    delete lesson.archivedAt;

    fs.writeFileSync(destPath, JSON.stringify(lesson, null, 2), "utf-8");
    fs.unlinkSync(sourcePath);
    return true;
  }

  return false;
}

/**
 * Get all archived lessons
 */
export function getArchivedLessons(): Lesson[] {
  ensureArchiveDir();

  const files = fs.readdirSync(ARCHIVE_DIR).filter(f => f.endsWith(".json"));
  const lessons: Lesson[] = [];

  for (const file of files) {
    try {
      const filePath = path.join(ARCHIVE_DIR, file);
      const rawData = fs.readFileSync(filePath, "utf-8");
      const lesson = JSON.parse(rawData) as Lesson;
      lessons.push(lesson);
    } catch {
      // Skip invalid files
    }
  }

  return lessons;
}

/**
 * Update the subject for a lesson
 * Returns the updated lesson, or null if not found
 */
export function updateLessonSubject(id: string, subject: string | null): Lesson | null {
  const filePath = path.join(LESSONS_DIR, `${id}.json`);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const rawData = fs.readFileSync(filePath, "utf-8");
    const lesson = JSON.parse(rawData) as Lesson;

    if (subject === null || subject === "") {
      delete lesson.subject;
    } else {
      lesson.subject = subject;
    }

    fs.writeFileSync(filePath, JSON.stringify(lesson, null, 2), "utf-8");
    return lesson;
  } catch {
    return null;
  }
}
