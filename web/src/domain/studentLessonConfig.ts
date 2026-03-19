/**
 * Student Lesson Config
 *
 * Maps student profile preferences (pacing, coach help style) to
 * concrete timing and prompt parameters used during lessons.
 *
 * This is a config layer — it does NOT change the state machine or
 * rewrite prompts. It produces values that are consumed at key
 * decision points (timing props, API request fields).
 */

import type { PacePreference, CoachHelpStyle } from "../services/api";

// ── Timing config ───────────────────────────────────────────────────

export interface LessonTimingConfig {
  /** Max recording duration in seconds */
  maxDurationSec: number;
  /** Sustained silence before turn ends (ms) */
  silenceDurationMs: number;
  /** Min speech before silence detection triggers (ms) */
  minSpeechBeforeSilenceMs: number;
}

const TIMING_DEFAULTS: LessonTimingConfig = {
  maxDurationSec: 120,        // 2 min
  silenceDurationMs: 1100,    // 1.1s
  minSpeechBeforeSilenceMs: 1500,  // 1.5s
};

const TIMING_TAKE_MY_TIME: LessonTimingConfig = {
  maxDurationSec: 180,        // 3 min
  silenceDurationMs: 1500,    // 1.5s — more patient
  minSpeechBeforeSilenceMs: 2000,  // 2s
};

const TIMING_KEEP_IT_MOVING: LessonTimingConfig = {
  maxDurationSec: 90,         // 1.5 min
  silenceDurationMs: 900,     // 0.9s — quicker turn
  minSpeechBeforeSilenceMs: 1200,  // 1.2s
};

export function getTimingConfig(pace?: PacePreference): LessonTimingConfig {
  if (pace === "take_my_time") return TIMING_TAKE_MY_TIME;
  if (pace === "keep_it_moving") return TIMING_KEEP_IT_MOVING;
  return TIMING_DEFAULTS;
}

// ── Coach style config ──────────────────────────────────────────────

/**
 * Returns a short system-prompt fragment that steers the coach's
 * pedagogical approach.  Injected once into the LLM system prompt;
 * does NOT replace the four-path framework.
 */
export function getCoachStyleDirective(style?: CoachHelpStyle): string | undefined {
  switch (style) {
    case "hints_first":
      return (
        "=== STUDENT PREFERENCE: HINTS FIRST ===\n" +
        "Before asking the student to retry, offer a concrete hint drawn from the hint list.\n" +
        "Only ask for a new attempt after the hint has been delivered.\n"
      );
    case "examples_first":
      return (
        "=== STUDENT PREFERENCE: EXAMPLES FIRST ===\n" +
        "When the student is stuck or gave a partial answer, provide a brief worked example\n" +
        "of a SIMILAR (not identical) problem before asking for another attempt.\n" +
        "Keep examples to 1–2 sentences.\n"
      );
    case "ask_me_questions":
      return (
        "=== STUDENT PREFERENCE: SOCRATIC ===\n" +
        "Use a Socratic approach: guide with questions rather than explanations.\n" +
        "Instead of telling the student what to do, ask one focused question\n" +
        "that helps them discover the next step themselves.\n"
      );
    default:
      return undefined;
  }
}

// ── Combined config ─────────────────────────────────────────────────

export interface StudentLessonConfig {
  timing: LessonTimingConfig;
  coachHelpStyle?: CoachHelpStyle;
  coachStyleDirective?: string;
  pacePreference?: PacePreference;
}

export function buildStudentLessonConfig(
  pace?: PacePreference,
  coachStyle?: CoachHelpStyle,
): StudentLessonConfig {
  return {
    timing: getTimingConfig(pace),
    coachHelpStyle: coachStyle,
    coachStyleDirective: getCoachStyleDirective(coachStyle),
    pacePreference: pace,
  };
}
