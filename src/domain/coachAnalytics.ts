/**
 * Coach Analytics Domain Types
 *
 * Internal analytics schema for capturing per-turn, per-question, per-assignment
 * learning signals from coach conversations. For educator insights and internal
 * analytics only - not student-facing.
 *
 * Key principles:
 * - Describe learning behaviors; do not label students as "good/bad"
 * - All signals scoped to specific attempt/question unless explicitly aggregated
 * - Filler speech (um, uh, like, you know) is NOT penalized
 * - Minimal but extensible data model
 */

// Schema version for future migrations
export const COACH_ANALYTICS_SCHEMA_VERSION = 1;

// ============================================
// Enums and Constants
// ============================================

export type Speaker = "student" | "coach";
export type Modality = "text" | "voice" | "video";
export type ConfidenceLevel = "high" | "medium" | "low" | "unknown";

export type CoachActionTag =
  | "affirm_move_on"
  | "probe"
  | "hint"
  | "correct_misconception"
  | "ask_for_example"
  | "ask_for_explanation"
  | "reframe_question"
  | "reduce_complexity"
  | "encourage"
  | "summarize"
  | "move_on_stagnation"
  | "move_on_time"
  | "check_understanding"
  | "repair"
  | "mode_switch_offer";

export type MisconceptionType =
  | "concept_confusion"
  | "procedure_error"
  | "vocabulary_misread"
  | "units_or_scale_error"
  | "cause_effect_reversal"
  | "overgeneralization"
  | "misapplied_rule";

export type StagnationReason =
  | "repeating_same_answer"
  | "no_new_information"
  | "off_topic"
  | "cannot_start"
  | "silent_or_minimal";

export type MoveOnTrigger =
  | "stagnation_threshold"
  | "time_threshold"
  | "student_requested"
  | "coach_judgment";

export type CorrectnessEstimate = "correct" | "partially_correct" | "incorrect" | "unknown";

export type SupportLevel = "none" | "light_probe" | "hinted" | "guided" | "heavy_support";

export type QuestionOutcomeTag =
  | "mastery_fast"
  | "mastery_after_probe"
  | "mastery_after_hint"
  | "partial_understanding"
  | "needs_support"
  | "moved_on";

export type OverallSupportLevel = "none" | "light" | "moderate" | "high";
export type OverallOutcome = "strong" | "developing" | "needs_support" | "mixed";

export type RecommendationType =
  | "extend_learning"
  | "check_in"
  | "needs_support"
  | "group_support"
  | "celebrate_progress"
  | "challenge_opportunity";

export type SuggestedAction = "award_badge" | "add_todo" | "invite_support_session";

// ============================================
// A) ConversationTurnAnalytics
// ============================================

/**
 * Represents one coach-to-student or student-to-coach exchange.
 */
export interface ConfidenceSignals {
  /** Derived from phrases like "I'm not sure", "I think", "maybe" */
  selfReportedConfidence: ConfidenceLevel;
  /** Phrases like "I'm not sure", "I guess", "maybe" detected */
  uncertaintyPhrasesDetected: boolean;
  /** Phrases like "I know", "definitely", "the answer is" detected */
  certaintyPhrasesDetected: boolean;
}

export interface ConversationTurnAnalytics {
  id: string;
  timestamp: string; // ISO string
  speaker: Speaker;
  modality: Modality;
  /** Original transcript text (unchanged, includes fillers) */
  transcriptText: string;
  /** Optional cleaned text for analysis only (fillers removed); original stays intact */
  cleanedTranscriptText?: string;
  /** Approximate token count */
  tokenCountApprox?: number;
  /** Duration in milliseconds (for voice/video) */
  durationMs?: number;
  /**
   * Count of filler words (um, uh, like, you know, etc.)
   * NOTE: This is informational only - DO NOT use as a negative score
   */
  fillerWordCount?: number;
  /**
   * Count of hesitation markers (long pauses, restarts)
   * NOTE: DO NOT penalize by default
   */
  hesitationMarkersCount?: number;
  /** Confidence signals derived from content, not fillers */
  confidenceSignals: ConfidenceSignals;
  /** Coach action classification (null for student turns) */
  coachActionTag: CoachActionTag | null;
  /** Number of questions asked in this turn (ideally 0 or 1; track for QA) */
  coachQuestionCountInTurn: number;
  /** Internal debugging notes only */
  notes?: string;
}

// ============================================
// B) QuestionAttemptAnalytics
// ============================================

/**
 * Analytics for one assignment question within one student attempt.
 */
export interface QuestionAttemptAnalytics {
  questionId: string;
  questionIndex: number;
  startedAt: string; // ISO string
  endedAt: string; // ISO string
  timeSpentMs: number;
  studentTurnCount: number;
  coachTurnCount: number;
  hintCount: number;
  probeCount: number;
  reframeCount: number;

  // Misconception tracking
  misconceptionDetected: boolean;
  misconceptionType: MisconceptionType | null;
  /** Conservative: set to "low" unless clear evidence */
  misconceptionConfidence: ConfidenceLevel;

  // Stagnation tracking
  stagnationDetected: boolean;
  stagnationReason: StagnationReason | null;
  moveOnTriggered: boolean;
  moveOnTrigger: MoveOnTrigger | null;

  // Outcome estimates
  correctnessEstimate: CorrectnessEstimate;
  /**
   * Based on content + self-report phrases, NOT filler words.
   * Resilient to spoken disfluency.
   */
  confidenceEstimate: ConfidenceLevel;
  supportLevelUsed: SupportLevel;
  outcomeTag: QuestionOutcomeTag;

  /** Optional 1 short sentence for educator focus */
  recommendedTeacherFocus?: string;

  /** All conversation turns for this question */
  turns: ConversationTurnAnalytics[];
}

// ============================================
// C) AssignmentAttemptAnalytics
// ============================================

/**
 * System recommendation candidate derived from analytics.
 */
export interface SystemRecommendationCandidate {
  type: RecommendationType;
  reason: string; // 1 sentence
  suggestedActions: SuggestedAction[];
  confidence: ConfidenceLevel;
  sourceSignals: string[]; // e.g., ["low_hint_high_accuracy", "move_on_stagnation"]
}

/**
 * Rollup totals for the assignment attempt.
 */
export interface AssignmentAttemptTotals {
  totalTimeMs: number;
  totalStudentTurns: number;
  totalCoachTurns: number;
  totalHints: number;
  totalProbes: number;
  totalReframes: number;
  misconceptionsCount: number;
  moveOnsCount: number;
}

/**
 * Analytics rollup for the whole assignment attempt.
 */
export interface AssignmentAttemptAnalytics {
  assignmentId: string;
  studentId: string;
  attemptId: string;
  classId: string;
  subject: string;
  gradeLevel?: string;
  difficulty?: "beginner" | "intermediate" | "advanced";
  startedAt: string; // ISO string
  submittedAt: string; // ISO string
  modality: Modality; // Primary mode

  /** Per-question analytics */
  questionAnalytics: QuestionAttemptAnalytics[];

  /** Rollup totals */
  totals: AssignmentAttemptTotals;

  /** Internal classification */
  overallSupportLevel: OverallSupportLevel;
  overallOutcome: OverallOutcome;

  /** System-generated recommendation candidates */
  systemRecommendationCandidates: SystemRecommendationCandidate[];

  /** Schema version for migrations */
  version: number;
}

// ============================================
// D) Helper Types for Teacher-Facing Derivations
// ============================================

/**
 * Derived insight for teacher-facing display.
 * Produced by deterministic helper functions, not stored as raw data.
 */
export interface TeacherFacingInsight {
  /** 1-2 sentence "why" text explaining the insight */
  whyText: string;
  /** Category chip label for UI */
  categoryChip: string;
  /** Suggested quick actions for the teacher */
  suggestedQuickActions: string[];
}

// ============================================
// Factory Functions
// ============================================

/**
 * Create a new ConversationTurnAnalytics object with defaults.
 */
export function createTurnAnalytics(
  id: string,
  speaker: Speaker,
  transcriptText: string,
  modality: Modality = "text"
): ConversationTurnAnalytics {
  return {
    id,
    timestamp: new Date().toISOString(),
    speaker,
    modality,
    transcriptText,
    confidenceSignals: {
      selfReportedConfidence: "unknown",
      uncertaintyPhrasesDetected: false,
      certaintyPhrasesDetected: false,
    },
    coachActionTag: speaker === "coach" ? null : null,
    coachQuestionCountInTurn: 0,
  };
}

/**
 * Create a new QuestionAttemptAnalytics object with defaults.
 */
export function createQuestionAnalytics(
  questionId: string,
  questionIndex: number
): QuestionAttemptAnalytics {
  const now = new Date().toISOString();
  return {
    questionId,
    questionIndex,
    startedAt: now,
    endedAt: now,
    timeSpentMs: 0,
    studentTurnCount: 0,
    coachTurnCount: 0,
    hintCount: 0,
    probeCount: 0,
    reframeCount: 0,
    misconceptionDetected: false,
    misconceptionType: null,
    misconceptionConfidence: "low",
    stagnationDetected: false,
    stagnationReason: null,
    moveOnTriggered: false,
    moveOnTrigger: null,
    correctnessEstimate: "unknown",
    confidenceEstimate: "unknown",
    supportLevelUsed: "none",
    outcomeTag: "needs_support",
    turns: [],
  };
}

/**
 * Create a new AssignmentAttemptAnalytics object with defaults.
 */
export function createAssignmentAnalytics(
  assignmentId: string,
  studentId: string,
  attemptId: string,
  classId: string,
  subject: string
): AssignmentAttemptAnalytics {
  const now = new Date().toISOString();
  return {
    assignmentId,
    studentId,
    attemptId,
    classId,
    subject,
    startedAt: now,
    submittedAt: now,
    modality: "text",
    questionAnalytics: [],
    totals: {
      totalTimeMs: 0,
      totalStudentTurns: 0,
      totalCoachTurns: 0,
      totalHints: 0,
      totalProbes: 0,
      totalReframes: 0,
      misconceptionsCount: 0,
      moveOnsCount: 0,
    },
    overallSupportLevel: "none",
    overallOutcome: "developing",
    systemRecommendationCandidates: [],
    version: COACH_ANALYTICS_SCHEMA_VERSION,
  };
}
