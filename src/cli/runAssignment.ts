import readline from "readline";
import { loadLesson } from "../loaders/lessonLoader";
import { FakeEvaluator } from "../domain/fakeEvaluator";
import { askQuestion } from "./helpers";  // import the helper

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function runLesson() {
  const lesson = loadLesson("intro-prompts.json");
  const evaluator = new FakeEvaluator();
  const responses: any[] = [];

  for (const prompt of lesson.prompts) {
    const result = await askQuestion(rl, prompt.input, prompt.hints);
    responses.push({ promptId: prompt.id, ...result });
  }

  rl.close();

  const submission = {
    assignmentId: lesson.id,
    studentId: "student1",
    responses,
    submittedAt: new Date()
  };

  const evaluation = evaluator.evaluate(submission);
  console.log("\nEvaluation Result:", evaluation);
}

runLesson();