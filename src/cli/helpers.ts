import readline from "readline";
import { Student } from "../domain/student";
import { StudentStore } from "../stores/studentStore";
import { SessionStore } from "../stores/sessionStore";
import { CoachConversation } from "../domain/submission";
import { startHelpConversation } from "./coach";
import { recordAndTranscribe, getInput, speak } from "./voice";

/**
 * Generate a simple unique ID (good enough for local development)
 */
export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

/**
 * Ask the user to identify themselves at the start of a session.
 * Looks up existing students by name to link returning users.
 */
export async function askForStudent(rl: readline.Interface): Promise<Student> {
  const studentStore = new StudentStore();
  const sessionStore = new SessionStore();

  return new Promise((resolve) => {
    rl.question("What is your name?\n> ", (name: string) => {
      const trimmedName = name.trim() || "Anonymous";

      // Check if student exists
      const existingStudent = studentStore.findByName(trimmedName);

      if (existingStudent) {
        // Returning student
        const sessions = sessionStore.getByStudentId(existingStudent.id);
        console.log(`\nWelcome back, ${existingStudent.name}!`);
        console.log(`You have completed ${sessions.length} session(s).\n`);
        resolve(existingStudent);
      } else {
        // New student
        const newStudent: Student = {
          id: generateId(),
          name: trimmedName,
          createdAt: new Date()
        };
        studentStore.save(newStudent);
        console.log(`\nWelcome, ${newStudent.name}! (New student created)\n`);
        resolve(newStudent);
      }
    });
  });
}

/**
 * Ask the user to choose from a menu of options
 */
export async function askMenu(
  rl: readline.Interface,
  options: string[]
): Promise<number> {
  return new Promise((resolve) => {
    console.log("What would you like to do?\n");
    options.forEach((opt, i) => {
      console.log(`  ${i + 1}. ${opt}`);
    });
    console.log("");

    const askChoice = () => {
      rl.question("> ", (answer: string) => {
        const choice = parseInt(answer, 10);
        if (choice >= 1 && choice <= options.length) {
          resolve(choice);
        } else {
          console.log(`Please enter a number between 1 and ${options.length}`);
          askChoice();
        }
      });
    };
    askChoice();
  });
}

export interface QuestionResult {
  response: string;
  reflection?: string;
  hintUsed: boolean;
  helpConversation?: CoachConversation;
  inputSource: "typed" | "voice";
  audioPath?: string;
  reflectionAudioPath?: string;
}

/**
 * Ask a question with support for AI coach help and voice input
 *
 * Student can:
 * - Type their answer
 * - Type "v" for voice input (auto-stops on silence)
 * - Type "help" for AI coach guidance
 */
export async function askQuestion(
  rl: readline.Interface,
  promptText: string,
  hints?: string[]
): Promise<QuestionResult> {
  let hintUsed = false;
  let helpConversation: CoachConversation | undefined;
  let inputSource: "typed" | "voice" = "typed";
  let audioPath: string | undefined;
  let gotAnswerFromHelp = false;
  let helpAnswer: string | undefined;

  console.log(`${promptText}`);
  await speak(promptText);
  console.log("(Type answer, 'v' for voice, or 'help' for guidance)\n");

  const innerAsk = async (): Promise<{ response: string; source: "typed" | "voice"; audioPath?: string } | null> => {
    return new Promise((resolve) => {
      rl.question("> ", async (answer: string) => {
        const lowerAnswer = answer.toLowerCase().trim();

        if (lowerAnswer === "help") {
          hintUsed = true;
          helpConversation = await startHelpConversation(rl, promptText, hints || []);

          // If they worked out an answer with the coach, use that
          if (helpConversation.finalAnswer) {
            gotAnswerFromHelp = true;
            helpAnswer = helpConversation.finalAnswer;
            resolve(null); // Signal that we got answer from help
          } else {
            // No answer from help, ask again
            resolve(await innerAsk());
          }
        } else if (lowerAnswer === "hint") {
          if (hints && hints.length > 0) {
            console.log("\n📝 Hint:", hints.join("; "), "\n");
          } else {
            console.log("\nNo hints available. Try 'help' for AI coach.\n");
          }
          hintUsed = true;
          resolve(await innerAsk());
        } else if (lowerAnswer === "v" || lowerAnswer === "voice") {
          const voiceResult = await recordAndTranscribe();
          if (voiceResult) {
            resolve({ response: voiceResult.text, source: "voice", audioPath: voiceResult.audioPath });
          } else {
            console.log("Let's try again.\n");
            resolve(await innerAsk());
          }
        } else if (lowerAnswer === "") {
          console.log("Type answer, 'v' for voice, or 'help' for guidance.\n");
          resolve(await innerAsk());
        } else {
          resolve({ response: answer, source: "typed" });
        }
      });
    });
  };

  const result = await innerAsk();

  let finalResponse: string;

  if (gotAnswerFromHelp && helpAnswer) {
    // Got answer from help conversation - ask if they want to add anything
    finalResponse = helpAnswer;
    inputSource = "typed"; // Help is always typed for now

    console.log("\nAnything else you'd like to add? ('v' for voice, or enter to continue):");
    const additionResult = await getInput(rl, "> ", true, false);
    if (additionResult?.text) {
      finalResponse = `${helpAnswer} ${additionResult.text}`;
    }
  } else if (result) {
    finalResponse = result.response;
    inputSource = result.source;
    audioPath = result.audioPath;
  } else {
    // Shouldn't happen, but fallback
    finalResponse = "";
  }

  // Ask for reflection (also supports voice, with audio saved)
  console.log("\nOptional: Explain your thinking ('v' for voice, or enter to skip):");
  const reflectionResult = await getInput(rl, "> ", true, true); // allowEmpty=true, saveAudio=true
  const reflection = reflectionResult?.text || undefined;
  const reflectionAudioPath = reflectionResult?.audioPath;

  return {
    response: finalResponse,
    reflection,
    hintUsed,
    helpConversation,
    inputSource,
    audioPath,
    reflectionAudioPath
  };
}

/**
 * Simple yes/no question
 */
export async function askYesNo(rl: readline.Interface, question: string): Promise<boolean> {
  return new Promise((resolve) => {
    rl.question(`${question} (yes/no): `, (answer) => {
      const lower = answer.toLowerCase().trim();
      resolve(lower === "yes" || lower === "y");
    });
  });
}

export interface AskMoreResult {
  wantsMore: boolean;
  initialQuestion?: string;
}

/**
 * Ask if student wants to explore more (for "more" feature)
 * Accepts "more", a question, or "v" for voice
 */
export async function askMore(rl: readline.Interface): Promise<AskMoreResult> {
  console.log("\nWant to explore more? ('more', ask a question, 'v' for voice, or enter to continue)");

  return new Promise((resolve) => {
    const ask = () => {
      rl.question("> ", async (answer) => {
        const trimmed = answer.trim();
        const lower = trimmed.toLowerCase();

        if (trimmed === "") {
          resolve({ wantsMore: false });
        } else if (lower === "more") {
          resolve({ wantsMore: true });
        } else if (lower === "v" || lower === "voice") {
          const voiceResult = await recordAndTranscribe(false); // Don't save audio for "more" prompt
          if (voiceResult) {
            resolve({ wantsMore: true, initialQuestion: voiceResult.text });
          } else {
            ask(); // Try again
          }
        } else {
          // They typed a question
          resolve({ wantsMore: true, initialQuestion: trimmed });
        }
      });
    };
    ask();
  });
}
