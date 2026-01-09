import "dotenv/config";
import readline from "readline";
import { getAllLessons } from "../loaders/lessonLoader";
import { FakeEvaluator } from "../domain/fakeEvaluator";
import { LLMEvaluator } from "../domain/llmEvaluator";
import { Evaluator } from "../domain/evaluator";
import { askQuestion, askForStudent, askMenu, askMore, generateId } from "./helpers";
import { Session } from "../domain/session";
import { SessionStore } from "../stores/sessionStore";
import { showProgressSummary } from "./progressSummary";
import { reviewPastSessions } from "./sessionReplay";
import { runEducatorDashboard } from "./educatorDashboard";
import { startMoreConversation } from "./coach";
import { speak } from "./voice";
import { Student } from "../domain/student";
import { Lesson } from "../domain/lesson";
import { PromptResponse } from "../domain/submission";
import { Prompt } from "../domain/prompt";

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
    return new LLMEvaluator();
  } else {
    console.log("No OPENAI_API_KEY found - using fake evaluator");
    console.log("Set OPENAI_API_KEY in .env for real AI evaluation\n");
    return new FakeEvaluator();
  }
}

/**
 * Let the user choose a lesson from available options
 */
async function chooseLesson(): Promise<Lesson | null> {
  const lessons = getAllLessons();

  if (lessons.length === 0) {
    console.log("\nNo lessons available.\n");
    return null;
  }

  console.log("\nChoose a lesson:\n");
  const options = lessons.map(l => `${l.title} (${l.difficulty})`);

  const choice = await askMenu(rl, [...options, "Back to main menu"]);

  if (choice === options.length + 1) {
    return null; // Back to main menu
  }

  return lessons[choice - 1];
}

/**
 * Run a single prompt and get evaluation for it
 */
async function runPrompt(
  student: Student,
  prompt: Prompt,
  promptNumber: number,
  totalPrompts: number,
  evaluator: Evaluator,
  lesson: Lesson
): Promise<PromptResponse> {
  console.log(`\n--- Question ${promptNumber} of ${totalPrompts} ---\n`);

  // Get student's answer (with help support)
  const result = await askQuestion(rl, prompt.input, prompt.hints);

  // Build a mini submission for this single prompt to get feedback
  const miniSubmission = {
    assignmentId: lesson.id,
    studentId: student.id,
    responses: [{
      promptId: prompt.id,
      response: result.response,
      reflection: result.reflection,
      hintUsed: result.hintUsed
    }],
    submittedAt: new Date()
  };

  // Evaluate this single response
  console.log("\n🤖 Evaluating your answer...\n");
  const evaluation = await evaluator.evaluate(miniSubmission, {
    ...lesson,
    prompts: [prompt] // Only include this prompt for evaluation
  });

  // Show feedback for this question
  const score = evaluation.criteriaScores[0];
  console.log(`Score: ${score?.score || 0}/50`);
  if (score?.comment) {
    console.log(`Feedback: ${score.comment}`);
    await speak(score.comment);
  }

  // Build the response object
  const response: PromptResponse = {
    promptId: prompt.id,
    response: result.response,
    reflection: result.reflection,
    hintUsed: result.hintUsed,
    inputSource: result.inputSource,
    helpConversation: result.helpConversation
  };

  // Offer "more" exploration
  const moreResult = await askMore(rl);
  if (moreResult.wantsMore) {
    const moreConversation = await startMoreConversation(
      rl,
      prompt.input,
      result.response,
      score?.comment || "Good effort!",
      moreResult.initialQuestion
    );
    response.moreConversation = moreConversation;
  }

  return response;
}

/**
 * Run a lesson for a student with conversational flow
 */
async function runLesson(student: Student, lesson: Lesson): Promise<void> {
  const startedAt = new Date();
  const evaluator = createEvaluator();

  console.log(`\n${"=".repeat(50)}`);
  console.log(`Starting lesson: ${lesson.title}`);
  console.log(`${"=".repeat(50)}`);
  console.log(`\n${lesson.description}\n`);
  console.log(`Difficulty: ${lesson.difficulty}`);
  console.log(`Questions: ${lesson.prompts.length}`);
  console.log(`\nTip: Type 'help' to chat with the AI coach!`);
  console.log(`${"=".repeat(50)}`);

  // Coach greeting
  const greeting = `Hello ${student.name}! Today we're going to work on ${lesson.title}. ${lesson.description} We have ${lesson.prompts.length} questions to work through together. Remember, you can type 'v' to speak your answers, or type 'help' if you need me. Let's get started!`;
  console.log(`\n🤖 Coach: ${greeting}\n`);
  await speak(greeting);

  // Collect responses one at a time with immediate feedback
  const responses: PromptResponse[] = [];
  let totalScore = 0;

  for (let i = 0; i < lesson.prompts.length; i++) {
    const prompt = lesson.prompts[i];
    const response = await runPrompt(
      student,
      prompt,
      i + 1,
      lesson.prompts.length,
      evaluator,
      lesson
    );
    responses.push(response);
  }

  // Build final submission
  const submission = {
    assignmentId: lesson.id,
    studentId: student.id,
    responses,
    submittedAt: new Date()
  };

  // Get final evaluation for the whole lesson
  const finalEvaluation = await evaluator.evaluate(submission, lesson);

  // Build and save session
  const session: Session = {
    id: generateId(),
    studentId: student.id,
    studentName: student.name,
    lessonId: lesson.id,
    lessonTitle: lesson.title,
    submission,
    evaluation: finalEvaluation,
    startedAt,
    completedAt: new Date()
  };

  const store = new SessionStore();
  store.save(session);

  // Display final results
  console.log(`\n${"=".repeat(50)}`);
  console.log("🎉 Lesson Complete!");
  console.log(`${"=".repeat(50)}`);
  console.log(`\nFinal Score: ${finalEvaluation.totalScore}/100`);
  console.log(`\nOverall Feedback: ${finalEvaluation.feedback}`);
  console.log(`${"=".repeat(50)}\n`);

  // Coach closing message
  const closing = `Great job, ${student.name}! You finished the ${lesson.title} lesson and scored ${finalEvaluation.totalScore} out of 100 points. ${finalEvaluation.feedback} I'm so proud of your hard work today. See you next time!`;
  console.log(`🤖 Coach: ${closing}\n`);
  await speak(closing);
}

/**
 * Student menu loop
 */
async function runStudentMode(student: Student): Promise<void> {
  let running = true;
  while (running) {
    const choice = await askMenu(rl, [
      "Start a new lesson",
      "Review past sessions",
      "View my progress",
      "Exit"
    ]);

    switch (choice) {
      case 1:
        // Choose and start lesson
        const lesson = await chooseLesson();
        if (lesson) {
          await runLesson(student, lesson);
        }
        console.log("");
        break;

      case 2:
        // Review past sessions
        await reviewPastSessions(rl, student);
        break;

      case 3:
        // View progress
        showProgressSummary(student);
        break;

      case 4:
        // Exit
        running = false;
        console.log(`\nGoodbye, ${student.name}! Keep learning!\n`);
        break;
    }
  }
}

/**
 * Main application entry point
 */
async function main() {
  console.log("Welcome to Promptly Learn!\n");
  console.log("Are you a:\n");

  const roleChoice = await askMenu(rl, ["Student", "Educator"]);

  if (roleChoice === 1) {
    // Student mode
    const student = await askForStudent(rl);
    await runStudentMode(student);
  } else {
    // Educator mode
    await runEducatorDashboard(rl);
  }

  rl.close();
}

main();
