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
  // Only show completed sessions (those with evaluation results)
  const sessions = sessionStore.getCompletedByStudentId(student.id);

  if (sessions.length === 0) {
    console.log("\nYou haven't completed any sessions yet. Try a lesson first!\n");
    return;
  }

  console.log("\nYour past sessions:\n");

  const options = sessions.map(s => {
    const date = s.completedAt ? new Date(s.completedAt).toLocaleDateString() : "Unknown";
    return `${date} - ${s.lessonTitle} (${s.evaluation?.totalScore ?? 0}/100)`;
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
 * @param isEducator - if true, offer audio playback and note-taking options
 * @returns the (possibly modified) session
 */
export async function displaySessionReplay(
  rl: readline.Interface,
  session: Session,
  isEducator: boolean = false
): Promise<Session> {
  const sessionStore = new SessionStore();
  let modified = false;

  const date = session.completedAt ? new Date(session.completedAt).toLocaleDateString() : "In progress";
  const time = session.completedAt ? new Date(session.completedAt).toLocaleTimeString() : "";

  console.log("\n" + "=".repeat(60));
  console.log(`Session Review: ${session.lessonTitle}`);
  console.log("=".repeat(60));
  console.log(`Student: ${session.studentName}`);
  console.log(`Date: ${date}${time ? ` at ${time}` : ""}`);
  console.log(`Total Score: ${session.evaluation?.totalScore ?? "N/A"}/100`);
  console.log(`Overall Feedback: ${session.evaluation?.feedback ?? "Session not yet completed"}`);

  // Show existing session notes
  if (session.educatorNotes) {
    console.log(`\n📝 Educator Notes: ${session.educatorNotes}`);
  }

  console.log("=".repeat(60));

  // Display each response
  for (let i = 0; i < session.submission.responses.length; i++) {
    const response = session.submission.responses[i];
    const criteriaScore = session.evaluation?.criteriaScores.find(
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

    // Show existing educator note for this response
    if (response.educatorNote) {
      console.log(`\n📝 Your note: ${response.educatorNote}`);
    }

    // Offer to add/edit note for this response (educators only)
    if (isEducator) {
      const noteAction = response.educatorNote ? "Edit note" : "Add note";
      const wantToNote = await askYesNo(rl, `   ${noteAction} for this response?`);
      if (wantToNote) {
        const note = await askForNote(rl, response.educatorNote);
        if (note !== null) {
          session.submission.responses[i].educatorNote = note || undefined;
          modified = true;
          if (note) {
            console.log(`   Note saved.\n`);
          } else {
            console.log(`   Note removed.\n`);
          }
        }
      }
    }
  }

  console.log("\n" + "=".repeat(60));

  // Offer to add/edit session-level notes (educators only)
  if (isEducator) {
    const sessionNoteAction = session.educatorNotes ? "Edit session notes" : "Add session notes";
    const wantSessionNote = await askYesNo(rl, `${sessionNoteAction}?`);
    if (wantSessionNote) {
      const note = await askForNote(rl, session.educatorNotes);
      if (note !== null) {
        session.educatorNotes = note || undefined;
        modified = true;
        if (note) {
          console.log(`Session notes saved.\n`);
        } else {
          console.log(`Session notes removed.\n`);
        }
      }
    }
  }

  // Save if modified
  if (modified) {
    sessionStore.save(session);
    console.log("Changes saved.\n");
  }

  console.log("=".repeat(60) + "\n");

  return session;
}

/**
 * Ask for a note (supports multiline, empty to clear)
 */
async function askForNote(
  rl: readline.Interface,
  existingNote?: string
): Promise<string | null> {
  if (existingNote) {
    console.log(`\n   Current note: "${existingNote}"`);
  }
  console.log("   Enter your note (or press Enter to clear, 'cancel' to keep unchanged):");

  return new Promise((resolve) => {
    rl.question("   > ", (answer) => {
      const trimmed = answer.trim();
      if (trimmed.toLowerCase() === "cancel") {
        resolve(null); // No change
      } else {
        resolve(trimmed); // Empty string will clear the note
      }
    });
  });
}
