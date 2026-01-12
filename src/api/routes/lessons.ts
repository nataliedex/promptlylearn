import { Router } from "express";
import { loadLesson, getAllLessons } from "../../loaders/lessonLoader";
import { generateLesson, generateSingleQuestion, type LessonParams } from "../../domain/lessonGenerator";
import { saveLesson } from "../../stores/lessonStore";

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

export default router;
