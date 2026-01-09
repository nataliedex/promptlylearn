import readline from "readline";
import { Student } from "../domain/student";
import { Session } from "../domain/session";
import { SessionStore } from "../stores/sessionStore";
import { askMenu, askYesNo } from "./helpers";
import { playAudio } from "./voice";

/**
 * Let the student review their past sessions
 */
export async function reviewPastSessions(
  rl: readline.Interface,
  student: Student
): Promise<void> {
  const sessionStore = new SessionStore();
  const sessions = sessionStore.getByStudentId(student.id);

  if (sessions.length === 0) {
    console.log("\nYou haven't completed any sessions yet. Try a lesson first!\n");
    return;
  }

  console.log("\nYour past sessions:\n");

  const options = sessions.map(s => {
    const date = new Date(s.completedAt).toLocaleDateString();
    return `${date} - ${s.lessonTitle} (${s.evaluation.totalScore}/100)`;
  });

  const choice = await askMenu(rl, [...options, "Back to main menu"]);

  if (choice === options.length + 1) {
    return; // Back to main menu
  }

  const session = sessions[choice - 1];
  await displaySessionReplay(rl, session);
}

/**
 * Display a full replay of a session
 * @param rl - readline interface for interactive prompts
 * @param session - the session to display
 * @param isEducator - if true, offer audio playback options
 */
export async function displaySessionReplay(
  rl: readline.Interface,
  session: Session,
  isEducator: boolean = false
): Promise<void> {
  const date = new Date(session.completedAt).toLocaleDateString();
  const time = new Date(session.completedAt).toLocaleTimeString();

  console.log("\n" + "=".repeat(60));
  console.log(`Session Review: ${session.lessonTitle}`);
  console.log("=".repeat(60));
  console.log(`Date: ${date} at ${time}`);
  console.log(`Total Score: ${session.evaluation.totalScore}/100`);
  console.log(`Overall Feedback: ${session.evaluation.feedback}`);
  console.log("=".repeat(60));

  // Display each response
  for (let i = 0; i < session.submission.responses.length; i++) {
    const response = session.submission.responses[i];
    const criteriaScore = session.evaluation.criteriaScores.find(
      c => c.criterionId === response.promptId
    );

    console.log(`\n--- Question ${i + 1} ---\n`);

    // We don't have the original prompt text stored in session
    // So we'll show the prompt ID and the student's response
    console.log(`Prompt ID: ${response.promptId}`);

    // Show input method
    if (response.inputSource === "voice") {
      console.log(`Input: 🎤 Voice`);
    } else {
      console.log(`Input: ⌨️  Typed`);
    }

    console.log(`\nAnswer:`);
    console.log(`  "${response.response}"`);

    if (response.reflection) {
      console.log(`\nReasoning:`);
      console.log(`  "${response.reflection}"`);
    }

    // Offer audio playback for educators (play full response: answer + reasoning together)
    const hasAudio = response.audioPath || response.reflectionAudioPath;
    if (hasAudio && isEducator) {
      console.log(`\n   🔊 Audio recording available`);

      const wantToPlay = await askYesNo(rl, "   Play full response?");
      if (wantToPlay) {
        console.log("   Playing...");
        // Play answer and reasoning back-to-back as one full response
        if (response.audioPath) {
          await playAudio(response.audioPath);
        }
        if (response.reflectionAudioPath) {
          await playAudio(response.reflectionAudioPath);
        }
      }
    }

    if (response.hintUsed) {
      console.log(`\n  (Used hint or coach help)`);
    }

    if (criteriaScore) {
      console.log(`\nScore: ${criteriaScore.score}/50`);
      if (criteriaScore.comment) {
        console.log(`Feedback: ${criteriaScore.comment}`);
      }
    }
  }

  console.log("\n" + "=".repeat(60) + "\n");
}
