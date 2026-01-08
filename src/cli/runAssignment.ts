import readline from "readline";
import { loadLesson } from "../loaders/lessonLoader";
import { FakeEvaluator } from "../domain/fakeEvaluator";
import { askQuestion, askForStudent, generateId } from "./helpers";
import { Session } from "../domain/session";
import { SessionStore } from "../stores/sessionStore";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

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
  const evaluator = new FakeEvaluator();
  const evaluation = evaluator.evaluate(submission);

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
  console.log("\n---");
  console.log("\nEvaluation Result:");
  console.log(`  Total Score: ${evaluation.totalScore}/100`);
  console.log(`  Feedback: ${evaluation.feedback}`);
  console.log("\n  Criteria Scores:");
  for (const criterion of evaluation.criteriaScores) {
    console.log(`    - ${criterion.criterionId}: ${criterion.score} ${criterion.comment ? `(${criterion.comment})` : ""}`);
  }

  console.log(`\nSession saved! ID: ${session.id}`);
  console.log(`Student: ${student.name} (${student.id})`);
}

runLesson();
