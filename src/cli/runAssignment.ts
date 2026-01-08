import "dotenv/config";
import readline from "readline";
import { loadLesson } from "../loaders/lessonLoader";
import { FakeEvaluator } from "../domain/fakeEvaluator";
import { LLMEvaluator } from "../domain/llmEvaluator";
import { Evaluator } from "../domain/evaluator";
import { askQuestion, askForStudent, generateId } from "./helpers";
import { Session } from "../domain/session";
import { SessionStore } from "../stores/sessionStore";

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

async function runLesson() {
  const startedAt = new Date();

  // 1. Ask who is taking this lesson
  const student = await askForStudent(rl);

  // 2. Load the lesson
  const lesson = loadLesson("intro-prompts.json");
  console.log(`Starting lesson: ${lesson.title}`);
  console.log(`${lesson.description}\n`);
  console.log(`Difficulty: ${lesson.difficulty}`);
  console.log(`Number of prompts: ${lesson.prompts.length}\n`);
  console.log("Type 'hint' for a hint on any question.\n");
  console.log("---\n");

  // 3. Collect responses
  const responses: any[] = [];
  for (const prompt of lesson.prompts) {
    const result = await askQuestion(rl, prompt.input, prompt.hints);
    responses.push({ promptId: prompt.id, ...result });
  }

  rl.close();

  // 4. Build submission
  const submission = {
    assignmentId: lesson.id,
    studentId: student.id,
    responses,
    submittedAt: new Date()
  };

  // 5. Evaluate
  console.log("\nEvaluating your responses...\n");
  const evaluator = createEvaluator();
  const evaluation = await evaluator.evaluate(submission, lesson);

  // 6. Build and save session
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

  // 7. Display results
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
  console.log(`Student: ${student.name} (${student.id})`);
}

runLesson();
