import { Router } from "express";
import { loadLesson, getAllLessons } from "../../loaders/lessonLoader";

const router = Router();

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

export default router;
