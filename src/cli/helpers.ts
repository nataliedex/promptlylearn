import readline from "readline";
import { Student } from "../domain/student";
import { StudentStore } from "../stores/studentStore";
import { SessionStore } from "../stores/sessionStore";

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

export async function askQuestion(
  rl: readline.Interface,
  promptText: string,
  hints?: string[]
): Promise<{ response: string; reflection?: string; hintUsed: boolean }> {
  let hintUsed = false;

  return new Promise((resolve) => {
    const innerAsk = () => {
      rl.question(`${promptText}\n> `, async (answer: string) => {
        if (answer.toLowerCase() === "hint" && hints && hints.length > 0) {
          console.log("\nHint:", hints.join("; "));
          hintUsed = true;
          innerAsk(); // ask the question again after hint
        } else {
          rl.question("Optional: Describe your reasoning / reflection:\n> ", (reflection) => {
            resolve({ response: answer, reflection: reflection || undefined, hintUsed });
          });
        }
      });
    };
    innerAsk();
  });
}
