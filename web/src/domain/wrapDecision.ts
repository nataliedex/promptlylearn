/**
 * Post-TTS wrap decision logic.
 *
 * Extracted from VideoConversationRecorder for testability.
 * Determines what happens after the coach finishes speaking.
 */

export type WrapDecision =
  | { action: "start_student_turn"; reason: string }
  | { action: "wrap"; reason: WrapReason }
  | { action: "end_conversation"; reason: WrapReason };

export type WrapReason =
  | "timer_expired"
  | "closing_window"
  | "probing_cutoff"
  | "max_exchanges_reached"
  | "no_speech_limit"
  | "explicit_end"
  | "server_wrap"
  | "error_fallback";

/** Seconds remaining below which we enter the closing window. */
export const CLOSING_WINDOW_SEC = 15;

/** Seconds remaining below which no new open-ended questions should be asked. */
export const NO_NEW_QUESTION_SEC = 25;

/**
 * Buffer before session end where we stop probing entirely.
 * At 120s maxDuration, this means no new student turns after 90s elapsed.
 * Prevents the coach from asking questions at 1:32 and then immediately wrapping.
 */
export const WRAP_BUFFER_SEC = 30;

/** Check if we're in the no-new-question window (15s <= remaining < 25s). */
export function isInNoNewQuestionWindow(realElapsedSec: number, maxDurationSec: number): boolean {
  const remaining = maxDurationSec - realElapsedSec;
  return remaining > 0 && remaining < NO_NEW_QUESTION_SEC;
}

/**
 * Determine what to do after coach TTS completes.
 *
 * HARD RULE: If the coach output contains a question (?) AND shouldContinue=true,
 * we MUST start the student turn — never wrap — unless:
 *   - The timer has actually expired, OR
 *   - We are inside the closing window (< 15s remaining)
 */
export type VideoTurnKind = "FEEDBACK" | "PROBE" | "WRAP";
export function decidePostCoachAction(params: {
  shouldContinue: boolean;
  coachResponse: string;
  realElapsedSec: number;
  maxDurationSec: number;
  turnKind?: VideoTurnKind;
  wrapReason?: string;
  criteriaStatus?: string;
  /** Fraction of reasoning steps satisfied (0-1). When >= 0.66, probing cutoff uses CLOSING_WINDOW_SEC instead of WRAP_BUFFER_SEC. */
  completionRatio?: number;
}): WrapDecision {
  const { shouldContinue, coachResponse, realElapsedSec, maxDurationSec, turnKind, wrapReason, criteriaStatus, completionRatio } = params;

  const timerExpired = realElapsedSec >= maxDurationSec;
  const timeRemaining = maxDurationSec - realElapsedSec;
  const inClosingWindow = timeRemaining > 0 && timeRemaining < CLOSING_WINDOW_SEC;
  // Near-success leniency: when student has completed most steps, use the
  // shorter CLOSING_WINDOW_SEC buffer instead of the full WRAP_BUFFER_SEC.
  // This gives ~15 extra seconds for the student to answer the final combine step.
  const effectiveProbingBuffer = (completionRatio ?? 0) >= 0.66 ? CLOSING_WINDOW_SEC : WRAP_BUFFER_SEC;
  const inProbingCutoff = timeRemaining > 0 && timeRemaining < effectiveProbingBuffer;
  const hasQuestion = coachResponse.includes("?");

  // SERVER WRAP PRIORITY: If the server already delivered a WRAP (success or
  // otherwise), end immediately — do NOT layer a timing-based wrap on top.
  // The server's wrap message IS the closing message; a second generic close
  // ("Let's wrap up for now.") would weaken the successful ending.
  if (!shouldContinue && turnKind === "WRAP") {
    return { action: "end_conversation", reason: "server_wrap" };
  }

  if (timerExpired) return { action: "wrap", reason: "timer_expired" };
  if (inClosingWindow) return { action: "wrap", reason: "closing_window" };

  // Probing cutoff: stop starting new student turns when time is running out.
  // Checked BEFORE the HARD RULE — time pressure overrides question obligation.
  if (inProbingCutoff) return { action: "wrap", reason: "probing_cutoff" };

  // HARD RULE: coach asked a question + shouldContinue → student must answer
  if (shouldContinue && hasQuestion) {
    return { action: "start_student_turn", reason: "HARD_RULE: coach asked question + shouldContinue=true" };
  }

  // Use server-provided wrapReason when available; only "explicit_end" if server says so
  if (!shouldContinue) {
    if (wrapReason === "explicit_end") return { action: "end_conversation", reason: "explicit_end" };
    return { action: "end_conversation", reason: "server_wrap" };
  }

  return { action: "start_student_turn", reason: "shouldContinue=true, no question but continuing" };
}

/**
 * Build a closing statement summarizing the student's main ideas.
 * Used when wrapping up the session.
 *
 * @param studentTopics - Key topics the student discussed (extracted from transcript)
 * @param studentName - Optional student name for personalization
 * @param wrapReason - Why the session is ending. Only "closing_window" and "timer_expired"
 *   use "almost out of time" language; other reasons use neutral wrap copy.
 */
export function buildClosingStatement(
  studentTopics: string[],
  studentName?: string,
  wrapReason?: WrapReason,
): string {
  const name = studentName || "there";
  const isTimePressure = wrapReason === "closing_window" || wrapReason === "timer_expired";
  const timeNote = isTimePressure
    ? "We're almost out of time."
    : "Let's wrap up for now.";

  if (studentTopics.length === 0) {
    return `Great effort, ${name}! ${timeNote}`;
  }

  const topicPhrase = studentTopics.length === 1
    ? `how ${studentTopics[0]}`
    : studentTopics.slice(0, -1).map(t => `how ${t}`).join(", ") + " and how " + studentTopics[studentTopics.length - 1];

  return `Nice work, ${name}! You shared some great thinking about ${topicPhrase}. ${timeNote}`;
}
