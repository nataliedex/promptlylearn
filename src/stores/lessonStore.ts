import fs from "fs";
import path from "path";
import { Lesson } from "../domain/lesson";

const LESSONS_DIR = path.join(__dirname, "../data/lessons");

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
