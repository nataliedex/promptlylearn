import readline from "readline";
import { Student } from "../domain/student";

/**
 * Generate a simple unique ID (good enough for local development)
 */
export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

/**
 * Ask the user to identify themselves at the start of a session.
 * For now, just asks for a name and generates an ID.
 * Later this could look up existing students or integrate with auth.
 */
export async function askForStudent(rl: readline.Interface): Promise<Student> {
  return new Promise((resolve) => {
    rl.question("What is your name?\n> ", (name: string) => {
      const student: Student = {
        id: generateId(),
        name: name.trim() || "Anonymous",
        createdAt: new Date()
      };
      console.log(`\nWelcome, ${student.name}!\n`);
      resolve(student);
    });
  });
}

export async function askQuestion(
    rl: readline.Interface,
    promptText: string,
    hints?: string[]
): Promise<{ response: string; reflection?: string, hintUsed: boolean }> {

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