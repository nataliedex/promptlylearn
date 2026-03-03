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
}): WrapDecision {
  const { shouldContinue, coachResponse, realElapsedSec, maxDurationSec } = params;
  const timerExpired = realElapsedSec >= maxDurationSec;
  const timeRemaining = maxDurationSec - realElapsedSec;
  const inClosingWindow = timeRemaining > 0 && timeRemaining < CLOSING_WINDOW_SEC;
  const hasQuestion = coachResponse.includes("?");

  // (a) Timer expired → wrap
  if (timerExpired) {
    return { action: "wrap", reason: "timer_expired" };
  }

  // (b) Closing window: < 15s remaining → wrap
  if (inClosingWindow) {
    return { action: "wrap", reason: "closing_window" };
  }

  // (b2) Probing cutoff: < WRAP_BUFFER_SEC remaining → stop probing, wrap gracefully.
  const inProbingCutoff = timeRemaining > 0 && timeRemaining < WRAP_BUFFER_SEC;
  if (inProbingCutoff) {
    return { action: "wrap", reason: "probing_cutoff" };
  }

  // HARD RULE: coach asked a question + shouldContinue → student must answer
  if (shouldContinue && hasQuestion) {
    return {
      action: "start_student_turn",
      reason: "HARD_RULE: coach asked question + shouldContinue=true",
    };
  }

  // (c) shouldContinue=false AND no question → explicit end
  if (!shouldContinue && !hasQuestion) {
    return { action: "end_conversation", reason: "explicit_end" };
  }

  // (d) shouldContinue=true (no question mark, but still continuing)
  if (shouldContinue) {
    return {
      action: "start_student_turn",
      reason: "shouldContinue=true, no question but continuing",
    };
  }

  // (e) shouldContinue=false but has question — treat as explicit end
  return { action: "end_conversation", reason: "explicit_end" };
}

/**
 * Build a closing statement summarizing the student's main ideas.
 * Used when the closing window triggers instead of the generic SESSION_WRAP_MESSAGE.
 *
 * @param studentTopics - Key topics the student discussed (extracted from transcript)
 * @param studentName - Optional student name for personalization
 */
export function buildClosingStatement(
  studentTopics: string[],
  studentName?: string,
): string {
  const name = studentName || "there";
  const timeNote = "We're almost out of time.";

  if (studentTopics.length === 0) {
    return `Great effort, ${name}! ${timeNote}`;
  }

  const topicPhrase = studentTopics.length === 1
    ? `how ${studentTopics[0]}`
    : studentTopics.slice(0, -1).map(t => `how ${t}`).join(", ") + " and how " + studentTopics[studentTopics.length - 1];

  return `Nice work, ${name}! You shared some great thinking about ${topicPhrase}. ${timeNote}`;
}
