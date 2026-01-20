import fs from "fs";
import path from "path";
import { Lesson } from "../domain/lesson";

const LESSONS_DIR = path.join(__dirname, "../data/lessons");
const ARCHIVE_DIR = path.join(LESSONS_DIR, "archive");

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
