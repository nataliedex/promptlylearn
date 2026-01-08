import fs from "fs";
import path from "path";
import { Lesson } from "../domain/lesson";

const LESSONS_DIR = path.join(__dirname, "../data/lessons");

/**
 * Load a single lesson by filename
 */
export function loadLesson(fileName: string): Lesson {
  const filePath = path.join(LESSONS_DIR, fileName);
  const rawData = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(rawData) as Lesson;
}

/**
 * Get all available lessons
 */
export function getAllLessons(): Lesson[] {
  const files = fs.readdirSync(LESSONS_DIR).filter(f => f.endsWith(".json"));
  const lessons: Lesson[] = [];

  for (const file of files) {
    try {
      const lesson = loadLesson(file);
      lessons.push(lesson);
    } catch {
      // Skip invalid files
    }
  }

  // Sort by difficulty: beginner first, then intermediate, then advanced
  const difficultyOrder = { beginner: 0, intermediate: 1, advanced: 2 };
  return lessons.sort((a, b) => difficultyOrder[a.difficulty] - difficultyOrder[b.difficulty]);
}
