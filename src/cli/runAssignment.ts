import "dotenv/config";
import readline from "readline";
import {
  getAllLessons,
  startAssignment,
  completeAssignment,
  recordHintUsage,
  recordCoachSession,
  getAssignmentRecord,
  getLessonsWithProgress,
  LessonWithProgress,
} from "../loaders/lessonLoader";
import { FakeEvaluator } from "../domain/fakeEvaluator";
import { LLMEvaluator } from "../domain/llmEvaluator";
import { Evaluator } from "../domain/evaluator";
import { askQuestion, askForStudent, askMenu, askMore, generateId } from "./helpers";
import { Session } from "../domain/session";
import { SessionStore } from "../stores/sessionStore";
import { showProgressSummary } from "./progressSummary";
import { reviewPastSessions } from "./sessionReplay";
import { runEducatorDashboard } from "./educatorDashboard";
import { startMoreConversation, coachElaboration } from "./coach";
import { speak } from "./voice";
import { Student } from "../domain/student";
import { Lesson } from "../domain/lesson";
import { PromptResponse, Submission } from "../domain/submission";
import { Prompt } from "../domain/prompt";
import { AssignmentStudent } from "../domain/studentAssignment";
import { Insight, InsightType, InsightPriority, InsightStatus } from "../domain/insight";
import { InsightStore } from "../stores/insightStore";
import { RECOMMENDATION_CONFIG } from "../domain/recommendation";

// ============================================
// Session Management
// ============================================

/**
 * Save an in-progress session
 */
function saveProgress(
  student: Student,
  lesson: Lesson,
  responses: PromptResponse[],
  startedAt: Date,
  currentPromptIndex: number,
  existingSessionId?: string
): string {
  const store = new SessionStore();

  const submission: Submission = {
    assignmentId: lesson.id,
    studentId: student.id,
    responses,
    submittedAt: new Date(),
  };

  const session: Session = {
    id: existingSessionId || generateId(),
    studentId: student.id,
    studentName: student.name,
    lessonId: lesson.id,
    lessonTitle: lesson.title,
    submission,
    startedAt,
    status: "in_progress",
    currentPromptIndex,
  };

  store.save(session);
  return session.id;
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// ============================================
// Evaluator Selection
// ============================================

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

// ============================================
// Insight Generation
// ============================================

/**
 * Generate insights based on student performance on an assignment.
 * Creates Insight objects that can be reviewed by teachers.
 */
function generateInsightsFromSession(
  student: Student,
  lesson: Lesson,
  score: number,
  assignmentRecord: AssignmentStudent,
  hintCount: number,
  coachInteractionCount: number
): Insight[] {
  const insights: Insight[] = [];
  const insightStore = new InsightStore();

  // Calculate hint usage rate
  const totalQuestions = lesson.prompts.length;
  const hintUsageRate = totalQuestions > 0 ? hintCount / totalQuestions : 0;

  // Determine insight type based on performance
  let insightType: InsightType | null = null;
  let priority: InsightPriority = "medium";
  let summary = "";
  let evidence: string[] = [];
  let suggestedActions: string[] = [];

  // Check for struggling student (check_in insight)
  if (score < RECOMMENDATION_CONFIG.STRUGGLING_THRESHOLD) {
    // Check if this insight already exists
    if (!insightStore.exists(student.id, lesson.id, "check_in")) {
      insightType = "check_in";
      priority = "high";
      summary = `${student.name} may need support with ${lesson.title}`;
      evidence = [
        `Score: ${score}% (below ${RECOMMENDATION_CONFIG.STRUGGLING_THRESHOLD}% threshold)`,
        `Hint usage: ${Math.round(hintUsageRate * 100)}%`,
        `Attempts: ${assignmentRecord.attempts}`,
      ];
      if (coachInteractionCount > 0) {
        evidence.push(`Coach interactions: ${coachInteractionCount}`);
      }
      suggestedActions = [
        "Schedule a brief check-in conversation",
        "Review specific areas of difficulty",
        "Consider additional practice materials",
      ];
    }
  }
  // Check for excelling student (challenge_opportunity insight)
  else if (
    score >= RECOMMENDATION_CONFIG.EXCELLING_THRESHOLD &&
    hintUsageRate < RECOMMENDATION_CONFIG.MINIMAL_HINT_USAGE
  ) {
    if (!insightStore.exists(student.id, lesson.id, "challenge_opportunity")) {
      insightType = "challenge_opportunity";
      priority = "medium";
      summary = `${student.name} is ready for a challenge`;
      evidence = [
        `Score: ${score}% (excellent performance)`,
        `Minimal hint usage: ${Math.round(hintUsageRate * 100)}%`,
        `Completed with confidence`,
      ];
      suggestedActions = [
        "Assign advanced follow-up lesson",
        "Consider peer tutoring opportunity",
        "Offer enrichment activities",
      ];
    }
  }
  // Check for improvement (celebrate_progress insight)
  else if (assignmentRecord.attempts > 1 && assignmentRecord.highestScore !== undefined) {
    const previousBest = assignmentRecord.highestScore;
    const improvement = score - previousBest;

    if (improvement >= RECOMMENDATION_CONFIG.SIGNIFICANT_IMPROVEMENT) {
      if (!insightStore.exists(student.id, lesson.id, "celebrate_progress")) {
        insightType = "celebrate_progress";
        priority = "medium";
        summary = `${student.name} showed great improvement!`;
        evidence = [
          `Score improved from ${previousBest}% to ${score}% (+${improvement} points)`,
          `Attempt #${assignmentRecord.attempts}`,
          `Demonstrated persistence and growth`,
        ];
        suggestedActions = [
          "Acknowledge the improvement publicly or privately",
          "Consider awarding a progress badge",
          "Share success strategies with class",
        ];
      }
    }
  }
  // Check for heavy hint usage (monitor insight)
  else if (hintUsageRate >= RECOMMENDATION_CONFIG.HEAVY_HINT_USAGE) {
    if (!insightStore.exists(student.id, lesson.id, "monitor")) {
      insightType = "monitor";
      priority = "low";
      summary = `${student.name} used hints frequently`;
      evidence = [
        `Score: ${score}%`,
        `Hint usage rate: ${Math.round(hintUsageRate * 100)}%`,
        `May indicate developing understanding`,
      ];
      suggestedActions = [
        "Monitor progress on next assignment",
        "Check if concepts need reinforcement",
        "No immediate action needed",
      ];
    }
  }

  // Create and save insight if one was generated
  if (insightType) {
    const insight: Insight = {
      id: generateId(),
      studentId: student.id,
      assignmentId: lesson.id,
      classId: "", // Will be filled when class context is known
      subject: lesson.subject,
      type: insightType,
      priority,
      confidence: 0.85, // High confidence since based on objective data
      summary,
      evidence,
      suggestedActions,
      status: "pending_review" as InsightStatus,
      createdAt: new Date(),
    };

    insightStore.save(insight);
    insights.push(insight);
  }

  return insights;
}

// ============================================
// Lesson Selection
// ============================================

/**
 * Let the user choose a lesson from available options
 * Shows progress information for returning students
 */
async function chooseLesson(student: Student): Promise<Lesson | null> {
  const lessonsWithProgress = getLessonsWithProgress(student.id);

  if (lessonsWithProgress.length === 0) {
    console.log("\nNo lessons available.\n");
    return null;
  }

  console.log("\nChoose a lesson:\n");

  const options = lessonsWithProgress.map((l: LessonWithProgress) => {
    let label = `${l.title} (${l.difficulty})`;
    if (l.attemptCount > 0) {
      const scoreInfo = l.highestScore !== undefined ? ` - Best: ${l.highestScore}%` : "";
      label += ` [${l.attemptCount} attempt${l.attemptCount > 1 ? "s" : ""}${scoreInfo}]`;
    }
    return label;
  });

  const choice = await askMenu(rl, [...options, "Back to main menu"]);

  if (choice === options.length + 1) {
    return null; // Back to main menu
  }

  return lessonsWithProgress[choice - 1];
}

/**
 * Ask if student wants to continue or save and exit
 */
async function askContinueOrSave(rl: readline.Interface): Promise<"continue" | "save"> {
  console.log("\nWhat would you like to do?\n");
  const choice = await askMenu(rl, [
    "Continue to next question",
    "Save and exit (continue later)",
  ]);
  return choice === 1 ? "continue" : "save";
}

// ============================================
// Prompt Execution
// ============================================

/**
 * Run a single prompt and get evaluation for it
 * Returns the response along with hint/coach usage data
 */
async function runPrompt(
  student: Student,
  prompt: Prompt,
  promptNumber: number,
  totalPrompts: number,
  evaluator: Evaluator,
  lesson: Lesson
): Promise<{ response: PromptResponse; usedHint: boolean; usedCoach: boolean }> {
  console.log(`\n--- Question ${promptNumber} of ${totalPrompts} ---\n`);

  // Get student's answer (with help support)
  const result = await askQuestion(rl, prompt.input, prompt.hints);

  // Track if hint or coach was used
  const usedHint = result.hintUsed;
  const usedCoach = result.helpConversation !== undefined;

  // Coach helps student elaborate on their answer with follow-up questions
  let elaborations: string[] = [];
  let elaborationConversation;
  const gradeLevel = lesson.gradeLevel || "2nd grade";

  const elaborationResult = await coachElaboration(rl, prompt.input, result.response, gradeLevel);
  if (elaborationResult) {
    elaborations = elaborationResult.elaborations;
    elaborationConversation = elaborationResult.conversation;
  }

  // Build full answer: response + reflection + elaborations
  let fullAnswer = result.response;
  if (result.reflection) {
    fullAnswer += `\n\nStudent's reasoning: ${result.reflection}`;
  }
  if (elaborations.length > 0) {
    fullAnswer += `\n\nStudent's elaborations from follow-up questions: ${elaborations.join(" ")}`;
  }

  // Build a mini submission for this single prompt to get feedback
  const miniSubmission: Submission = {
    assignmentId: lesson.id,
    studentId: student.id,
    responses: [
      {
        promptId: prompt.id,
        response: fullAnswer, // Use combined response + reflection + elaborations
        reflection: result.reflection,
        hintUsed: result.hintUsed,
      },
    ],
    submittedAt: new Date(),
  };

  // Evaluate this single response
  console.log("\n🤖 Evaluating your answer...\n");
  const evaluation = await evaluator.evaluate(miniSubmission, {
    ...lesson,
    prompts: [prompt], // Only include this prompt for evaluation
  });

  // Show feedback for this question
  const score = evaluation.criteriaScores[0];
  console.log(`Score: ${score?.score || 0}/50`);
  if (score?.comment) {
    console.log(`Feedback: ${score.comment}`);
    await speak(score.comment);
  }

  // Build the response object (store original response, not combined)
  const response: PromptResponse = {
    promptId: prompt.id,
    response: result.response,
    reflection: result.reflection,
    elaborations: elaborations.length > 0 ? elaborations : undefined,
    hintUsed: result.hintUsed,
    inputSource: result.inputSource,
    audioPath: result.audioPath,
    reflectionAudioPath: result.reflectionAudioPath,
    helpConversation: result.helpConversation,
    elaborationConversation,
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

  return { response, usedHint, usedCoach };
}

// ============================================
// Lesson Execution
// ============================================

/**
 * Run a lesson for a student with conversational flow
 * Supports resuming from a saved session
 * Tracks AssignmentStudent progress and generates insights
 */
async function runLesson(
  student: Student,
  lesson: Lesson,
  existingSession?: Session
): Promise<"completed" | "saved"> {
  const startedAt = existingSession?.startedAt ? new Date(existingSession.startedAt) : new Date();
  const evaluator = createEvaluator();
  const startIndex = existingSession?.currentPromptIndex || 0;
  const sessionId = existingSession?.id;

  // Start tracking this assignment attempt
  let assignmentRecord: AssignmentStudent;
  if (!existingSession) {
    assignmentRecord = startAssignment(student.id, lesson.id);
  } else {
    // Get existing record for resumed session
    const existingRecord = getAssignmentRecord(student.id, lesson.id);
    assignmentRecord = existingRecord || startAssignment(student.id, lesson.id);
  }

  // Track hint and coach usage
  let totalHintCount = 0;
  let totalCoachInteractions = 0;

  // Collect existing responses if resuming
  const responses: PromptResponse[] = existingSession?.submission?.responses || [];

  // Count hints/coach from existing responses
  for (const resp of responses) {
    if (resp.hintUsed) totalHintCount++;
    if (resp.helpConversation) totalCoachInteractions++;
  }

  if (existingSession) {
    console.log(`\n${"=".repeat(50)}`);
    console.log(`Resuming lesson: ${lesson.title}`);
    console.log(`${"=".repeat(50)}`);
    console.log(`\nYou've already completed ${startIndex} of ${lesson.prompts.length} questions.`);
    console.log(`Let's continue where you left off!`);
    console.log(`${"=".repeat(50)}`);

    const resumeGreeting = `Welcome back, ${student.name}! Let's continue with ${lesson.title}. You've already answered ${startIndex} questions. Ready to keep going?`;
    console.log(`\n🤖 Coach: ${resumeGreeting}\n`);
    await speak(resumeGreeting);
  } else {
    console.log(`\n${"=".repeat(50)}`);
    console.log(`Starting lesson: ${lesson.title}`);
    console.log(`${"=".repeat(50)}`);
    console.log(`\n${lesson.description}\n`);
    console.log(`Difficulty: ${lesson.difficulty}`);
    console.log(`Questions: ${lesson.prompts.length}`);

    // Show attempt info if this is a retry
    if (assignmentRecord.attempts > 1) {
      const bestScore = assignmentRecord.highestScore;
      console.log(`Attempt: #${assignmentRecord.attempts}`);
      if (bestScore !== undefined) {
        console.log(`Your best score: ${bestScore}%`);
      }
    }

    console.log(`\nTip: Type 'help' to chat with the AI coach!`);
    console.log(`${"=".repeat(50)}`);

    const greeting = `Hello ${student.name}! Today we're working on ${lesson.title}. Type 'v' to speak your answers or 'help' if you need me. Let's go!`;
    console.log(`\n🤖 Coach: ${greeting}\n`);
    await speak(greeting);
  }

  // Process remaining prompts
  for (let i = startIndex; i < lesson.prompts.length; i++) {
    const prompt = lesson.prompts[i];
    const { response, usedHint, usedCoach } = await runPrompt(
      student,
      prompt,
      i + 1,
      lesson.prompts.length,
      evaluator,
      lesson
    );
    responses.push(response);

    // Track hint and coach usage
    if (usedHint) {
      totalHintCount++;
      recordHintUsage(student.id, lesson.id, 1);
    }
    if (usedCoach) {
      totalCoachInteractions++;
      recordCoachSession(student.id, lesson.id);
    }

    // Offer save option if not on the last question
    if (i < lesson.prompts.length - 1) {
      const choice = await askContinueOrSave(rl);
      if (choice === "save") {
        saveProgress(student, lesson, responses, startedAt, i + 1, sessionId);
        const saveMessage = `Great work so far, ${student.name}! I've saved your progress. You've completed ${i + 1} of ${lesson.prompts.length} questions. Come back soon to finish!`;
        console.log(`\n🤖 Coach: ${saveMessage}\n`);
        await speak(saveMessage);
        return "saved";
      }
    }
  }

  // Build final submission
  const submission: Submission = {
    assignmentId: lesson.id,
    studentId: student.id,
    responses,
    submittedAt: new Date(),
  };

  // Get final evaluation for the whole lesson
  const finalEvaluation = await evaluator.evaluate(submission, lesson);
  const score = finalEvaluation.totalScore;

  // Calculate time spent
  const completedAt = new Date();
  const timeSpentSeconds = Math.round((completedAt.getTime() - startedAt.getTime()) / 1000);

  // Complete the assignment tracking
  const updatedAssignmentRecord = completeAssignment(
    student.id,
    lesson.id,
    score,
    timeSpentSeconds
  );

  // Generate insights based on performance
  const insights = generateInsightsFromSession(
    student,
    lesson,
    score,
    updatedAssignmentRecord,
    totalHintCount,
    totalCoachInteractions
  );

  // Build and save completed session
  const session: Session = {
    id: sessionId || generateId(),
    studentId: student.id,
    studentName: student.name,
    lessonId: lesson.id,
    lessonTitle: lesson.title,
    submission,
    evaluation: finalEvaluation,
    startedAt,
    completedAt,
    status: "completed",
  };

  const store = new SessionStore();
  store.save(session);

  // Display final results
  console.log(`\n${"=".repeat(50)}`);
  console.log("🎉 Lesson Complete!");
  console.log(`${"=".repeat(50)}`);
  console.log(`\nFinal Score: ${score}/100`);

  // Show improvement if this was a retry
  if (updatedAssignmentRecord.attempts > 1 && updatedAssignmentRecord.highestScore !== undefined) {
    if (score === updatedAssignmentRecord.highestScore) {
      console.log(`🏆 New personal best!`);
    } else {
      console.log(`Personal best: ${updatedAssignmentRecord.highestScore}%`);
    }
  }

  console.log(`\nOverall Feedback: ${finalEvaluation.feedback}`);

  // Show insights generated (for transparency)
  if (insights.length > 0) {
    console.log(`\n📊 Learning insights generated for your teacher.`);
  }

  console.log(`${"=".repeat(50)}\n`);

  // Coach closing message
  const closing = `Great job, ${student.name}! You finished the ${lesson.title} lesson and scored ${score} out of 100 points. ${finalEvaluation.feedback} I'm so proud of your hard work today. See you next time!`;
  console.log(`🤖 Coach: ${closing}\n`);
  await speak(closing);

  return "completed";
}

// ============================================
// Resume Lesson
// ============================================

/**
 * Resume an in-progress lesson
 */
async function resumeLesson(student: Student): Promise<void> {
  const store = new SessionStore();
  const inProgressSessions = store.getInProgressByStudentId(student.id);

  if (inProgressSessions.length === 0) {
    console.log("\nYou don't have any lessons in progress.\n");
    return;
  }

  console.log("\nChoose a lesson to continue:\n");

  const options = inProgressSessions.map((s) => {
    const progress = s.currentPromptIndex || 0;
    return `${s.lessonTitle} (${progress} questions completed)`;
  });

  const choice = await askMenu(rl, [...options, "Back to main menu"]);

  if (choice === options.length + 1) {
    return; // Back to menu
  }

  const session = inProgressSessions[choice - 1];

  // Find the lesson
  const lessons = getAllLessons();
  const lesson = lessons.find((l) => l.id === session.lessonId);

  if (!lesson) {
    console.log("\nSorry, this lesson is no longer available.\n");
    // Clean up the orphaned session
    store.delete(session.id);
    return;
  }

  await runLesson(student, lesson, session);
}

// ============================================
// Student Mode
// ============================================

/**
 * Student menu loop
 */
async function runStudentMode(student: Student): Promise<void> {
  const store = new SessionStore();
  let running = true;

  while (running) {
    // Check for in-progress lessons
    const inProgressCount = store.getInProgressByStudentId(student.id).length;

    const menuOptions = [
      "Start a new lesson",
      ...(inProgressCount > 0 ? [`Continue a lesson (${inProgressCount} in progress)`] : []),
      "Review past sessions",
      "View my progress",
      "Exit",
    ];

    const choice = await askMenu(rl, menuOptions);

    // Adjust choice based on whether "Continue" option is present
    const hasInProgress = inProgressCount > 0;
    const adjustedChoice = hasInProgress ? choice : choice === 1 ? 1 : choice + 1;

    switch (adjustedChoice) {
      case 1:
        // Start new lesson
        const lesson = await chooseLesson(student);
        if (lesson) {
          await runLesson(student, lesson);
        }
        console.log("");
        break;

      case 2:
        // Continue lesson (only if in-progress lessons exist)
        await resumeLesson(student);
        break;

      case 3:
        // Review past sessions
        await reviewPastSessions(rl, student);
        break;

      case 4:
        // View progress
        showProgressSummary(student);
        break;

      case 5:
        // Exit
        running = false;
        console.log(`\nGoodbye, ${student.name}! Keep learning!\n`);
        break;
    }
  }
}

// ============================================
// Main Entry Point
// ============================================

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
