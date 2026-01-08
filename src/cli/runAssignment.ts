import "dotenv/config";
import readline from "readline";
import { loadLesson } from "../loaders/lessonLoader";
import { FakeEvaluator } from "../domain/fakeEvaluator";
import { LLMEvaluator } from "../domain/llmEvaluator";
import { Evaluator } from "../domain/evaluator";
import { askQuestion, askForStudent, askMenu, generateId } from "./helpers";
import { Session } from "../domain/session";
import { SessionStore } from "../stores/sessionStore";
import { showProgressSummary } from "./progressSummary";
import { Student } from "../domain/student";
import { Lesson } from "../domain/lesson";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

/**
 * Select the appropriate evaluator based on environment.
 * Uses LLMEvaluator if OPENAI_API_KEY is set, otherwise FakeEvaluator.
 */
function createEvaluator(): Evaluator {
  if (process.env.OPENAI_API_KEY) {
    console.log("Using LLM evaluation (OpenAI)\n");
    return new LLMEvaluator();
  } else {
    console.log("No OPENAI_API_KEY found - using fake evaluator");
    console.log("Set OPENAI_API_KEY in .env for real AI evaluation\n");
    return new FakeEvaluator();
  }
}

/**
 * Run a lesson for a student
 */
async function runLesson(student: Student, lesson: Lesson): Promise<void> {
  const startedAt = new Date();

  console.log(`\nStarting lesson: ${lesson.title}`);
  console.log(`${lesson.description}\n`);
  console.log(`Difficulty: ${lesson.difficulty}`);
  console.log(`Number of prompts: ${lesson.prompts.length}\n`);
  console.log("Type 'hint' for a hint on any question.\n");
  console.log("---\n");

  // Collect responses
  const responses: any[] = [];
  for (const prompt of lesson.prompts) {
    const result = await askQuestion(rl, prompt.input, prompt.hints);
    responses.push({ promptId: prompt.id, ...result });
  }

  // Build submission
  const submission = {
    assignmentId: lesson.id,
    studentId: student.id,
    responses,
    submittedAt: new Date()
  };

  // Evaluate
  console.log("\nEvaluating your responses...\n");
  const evaluator = createEvaluator();
  const evaluation = await evaluator.evaluate(submission, lesson);

  // Build and save session
  const session: Session = {
    id: generateId(),
    studentId: student.id,
    studentName: student.name,
    lessonId: lesson.id,
    lessonTitle: lesson.title,
    submission,
    evaluation,
    startedAt,
    completedAt: new Date()
  };

  const store = new SessionStore();
  store.save(session);

  // Display results
  console.log("---");
  console.log("\nEvaluation Result:");
  console.log(`  Total Score: ${evaluation.totalScore}/100`);
  console.log(`\n  Feedback: ${evaluation.feedback}`);
  console.log("\n  Per-Prompt Scores:");
  for (const criterion of evaluation.criteriaScores) {
    const prompt = lesson.prompts.find(p => p.id === criterion.criterionId);
    const promptLabel = prompt ? prompt.input.substring(0, 50) + "..." : criterion.criterionId;
    console.log(`\n    [${criterion.criterionId}] ${promptLabel}`);
    console.log(`      Score: ${criterion.score}/50`);
    if (criterion.comment) {
      console.log(`      Comment: ${criterion.comment}`);
    }
  }

  console.log(`\n---`);
  console.log(`\nSession saved! ID: ${session.id}`);
}

/**
 * Main application loop
 */
async function main() {
  console.log("Welcome to Promptly Learn!\n");

  // 1. Identify student
  const student = await askForStudent(rl);

  // 2. Main menu loop
  let running = true;
  while (running) {
    const choice = await askMenu(rl, [
      "Start a new lesson",
      "View my progress",
      "Exit"
    ]);

    switch (choice) {
      case 1:
        // Start lesson
        const lesson = loadLesson("intro-prompts.json");
        await runLesson(student, lesson);
        console.log("");
        break;

      case 2:
        // View progress
        showProgressSummary(student);
        break;

      case 3:
        // Exit
        running = false;
        console.log(`\nGoodbye, ${student.name}! Keep learning!\n`);
        break;
    }
  }

  rl.close();
}

main();
