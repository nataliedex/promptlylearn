import { Router } from "express";
import { LLMEvaluator } from "../../domain/llmEvaluator";
import { FakeEvaluator } from "../../domain/fakeEvaluator";
import { Evaluator } from "../../domain/evaluator";
import { Submission } from "../../domain/submission";
import { Lesson } from "../../domain/lesson";
import { getAllLessons } from "../../loaders/lessonLoader";

const router = Router();

// Get the appropriate evaluator based on API key availability
function getEvaluator(): Evaluator {
  if (process.env.OPENAI_API_KEY) {
    return new LLMEvaluator();
  }
  console.log("No OPENAI_API_KEY found, using FakeEvaluator");
  return new FakeEvaluator();
}

// POST /api/evaluate - Evaluate a submission
router.post("/", async (req, res) => {
  try {
    const { submission, lessonId } = req.body;

    if (!submission || !lessonId) {
      return res.status(400).json({
        error: "submission and lessonId are required",
      });
    }

    // Find the lesson
    const lessons = getAllLessons();
    const lesson = lessons.find(l => l.id === lessonId);

    if (!lesson) {
      return res.status(404).json({ error: "Lesson not found" });
    }

    const evaluator = getEvaluator();
    const evaluation = await evaluator.evaluate(submission as Submission, lesson);

    res.json(evaluation);
  } catch (error) {
    console.error("Error evaluating submission:", error);
    res.status(500).json({ error: "Failed to evaluate submission" });
  }
});

// POST /api/evaluate/response - Evaluate a single response
router.post("/response", async (req, res) => {
  try {
    const { response, lessonId } = req.body;

    if (!response || !lessonId) {
      return res.status(400).json({
        error: "response and lessonId are required",
      });
    }

    // Find the lesson
    const lessons = getAllLessons();
    const lesson = lessons.find(l => l.id === lessonId);

    if (!lesson) {
      return res.status(404).json({ error: "Lesson not found" });
    }

    // Create a minimal submission for single response evaluation
    const submission: Submission = {
      assignmentId: lessonId,
      studentId: "temp",
      responses: [response],
      submittedAt: new Date(),
    };

    const evaluator = getEvaluator();
    const evaluation = await evaluator.evaluate(submission, lesson);

    // Return just the first criteria score and feedback
    const result = {
      score: evaluation.criteriaScores[0]?.score ?? 0,
      comment: evaluation.criteriaScores[0]?.comment ?? evaluation.feedback,
      totalScore: evaluation.totalScore,
    };

    res.json(result);
  } catch (error) {
    console.error("Error evaluating response:", error);
    res.status(500).json({ error: "Failed to evaluate response" });
  }
});

export default router;
