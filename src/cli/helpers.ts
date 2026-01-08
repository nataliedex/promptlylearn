import readline from "readline";
import { Student } from "../domain/student";
import { StudentStore } from "../stores/studentStore";
import { SessionStore } from "../stores/sessionStore";
import { CoachConversation } from "../domain/submission";
import { startHelpConversation } from "./coach";

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
}

/**
 * Ask a question with support for AI coach help
 *
 * Student can type:
 * - "help" to start a conversation with the AI coach
 * - "hint" for static hints (fallback)
 * - Their answer to continue
 */
export async function askQuestion(
  rl: readline.Interface,
  promptText: string,
  hints?: string[]
): Promise<QuestionResult> {
  let hintUsed = false;
  let helpConversation: CoachConversation | undefined;

  return new Promise((resolve) => {
    const showPrompt = () => {
      console.log(`${promptText}`);
      console.log("(Type 'help' to talk with the AI coach, or answer below)\n");
    };

    showPrompt();

    const innerAsk = () => {
      rl.question("> ", async (answer: string) => {
        const lowerAnswer = answer.toLowerCase().trim();

        if (lowerAnswer === "help") {
          // Start AI coach conversation
          hintUsed = true;
          helpConversation = await startHelpConversation(rl, promptText, hints || []);
          innerAsk(); // Ask again after help conversation
        } else if (lowerAnswer === "hint") {
          // Fallback to static hints
          if (hints && hints.length > 0) {
            console.log("\n📝 Hint:", hints.join("; "), "\n");
          } else {
            console.log("\nNo hints available. Try 'help' to talk with the AI coach.\n");
          }
          hintUsed = true;
          innerAsk();
        } else if (lowerAnswer === "") {
          // Empty answer, ask again
          console.log("Please type your answer, or 'help' for guidance.\n");
          innerAsk();
        } else {
          // Got an answer, ask for reflection
          rl.question("\nOptional: Explain your thinking (or press enter to skip):\n> ", (reflection) => {
            resolve({
              response: answer,
              reflection: reflection.trim() || undefined,
              hintUsed,
              helpConversation
            });
          });
        }
      });
    };

    innerAsk();
  });
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

/**
 * Ask if student wants to explore more (for "more" feature)
 */
export async function askMore(rl: readline.Interface): Promise<boolean> {
  return new Promise((resolve) => {
    rl.question("\nWant to explore this topic more? (type 'more' or press enter to continue): ", (answer) => {
      resolve(answer.toLowerCase().trim() === "more");
    });
  });
}
