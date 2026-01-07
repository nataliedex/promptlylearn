import readline from "readline";

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