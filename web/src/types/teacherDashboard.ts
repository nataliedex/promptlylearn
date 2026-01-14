/**
 * Teacher Dashboard Data Model
 *
 * Design Philosophy:
 * - Fewer metrics, stronger signals
 * - Language-based understanding levels (not numeric scores)
 * - Focus on "Who needs my help and why?"
 * - Teacher notes are primary, not secondary
 * - Derived signals over raw metrics
 */

// ============================================
// Core Enums
// ============================================

/**
 * Understanding levels replace numeric scores in teacher-facing UI.
 * Teachers see words, not numbers.
 */
export type UnderstandingLevel = "strong" | "developing" | "needs-support";

/**
 * Coach support level - descriptive, not judgmental.
 */
export type CoachSupportLevel = "minimal" | "some" | "significant";

/**
 * Why a student might need teacher attention.
 * Each reason is actionable.
 */
export type AttentionReason =
  | "significant-coach-support"  // Relied heavily on AI help
  | "inconsistent-understanding" // Strong in some areas, struggling in others
  | "incomplete"                 // Didn't finish
  | "struggling-throughout"      // Consistent difficulty
  | "improved-with-support";     // Positive signal worth noting

/**
 * Question-level outcome focused on learning journey.
 */
export type QuestionOutcome =
  | "demonstrated"    // Got it, showed reasoning
  | "with-support"    // Needed help but succeeded
  | "developing"      // Still working on it
  | "not-attempted";  // Didn't try

// ============================================
// Dashboard-Level Types
// ============================================

/**
 * A student who may need teacher attention.
 * This is the PRIMARY data structure for the dashboard.
 */
export interface StudentNeedingAttention {
  studentId: string;
  studentName: string;
  assignmentId: string;
  assignmentTitle: string;
  reason: AttentionReason;
  reasonDescription: string; // Human-readable explanation
  hasTeacherNote: boolean;
}

/**
 * Assignment card for the dashboard.
 * Focused on completion and distribution, not averages.
 */
export interface AssignmentSummaryCard {
  assignmentId: string;
  title: string;
  totalStudents: number;
  completedCount: number;
  inProgressCount: number;
  notStartedCount: number;

  // Understanding distribution (not scores)
  distribution: {
    strong: number;
    developing: number;
    needsSupport: number;
  };

  // Quick signal
  studentsNeedingAttention: number;
}

/**
 * Top-level dashboard data.
 * Intentionally minimal.
 */
export interface EducatorDashboardData {
  // Primary: Who needs help right now?
  studentsNeedingAttention: StudentNeedingAttention[];

  // Secondary: Review by assignment
  assignments: AssignmentSummaryCard[];

  // Metadata
  totalStudents: number;
}

// ============================================
// Assignment Review Types
// ============================================

/**
 * Student row in assignment review table.
 */
export interface StudentAssignmentRow {
  studentId: string;
  studentName: string;

  // Progress
  isComplete: boolean;
  questionsAnswered: number;
  totalQuestions: number;

  // Understanding (derived from responses, not raw score)
  understanding: UnderstandingLevel;

  // Coach interaction
  coachSupport: CoachSupportLevel;

  // Action needed?
  needsReview: boolean;
  attentionReasons: AttentionReason[];

  // Teacher engagement
  hasTeacherNote: boolean;

  // Session reference
  sessionId?: string;
}

/**
 * Full assignment review data.
 */
export interface AssignmentReviewData {
  assignmentId: string;
  title: string;
  questionCount: number;

  // Summary stats
  stats: {
    completed: number;
    inProgress: number;
    notStarted: number;
    needingAttention: number;
  };

  // Distribution
  distribution: {
    strong: number;
    developing: number;
    needsSupport: number;
  };

  // Student rows
  students: StudentAssignmentRow[];
}

// ============================================
// Student Drilldown Types
// ============================================

/**
 * Question analysis for student drilldown.
 * Collapsed by default, expandable.
 */
export interface QuestionSummary {
  questionId: string;
  questionNumber: number;
  questionText: string;

  // Outcome (what the teacher sees first)
  outcome: QuestionOutcome;

  // Coach interaction
  usedHint: boolean;
  hintCount: number;
  totalHintsAvailable: number;
  improvedAfterHelp: boolean;

  // Content (shown when expanded)
  studentResponse: string;
  hasVoiceRecording: boolean;
  audioBase64?: string;
  audioFormat?: string;

  // Teacher note
  teacherNote?: string;
}

/**
 * Learning journey insights - derived, not stored.
 */
export interface LearningJourneyInsights {
  startedStrong: boolean;
  improvedOverTime: boolean;
  struggledConsistently: boolean;
  recoveredWithSupport: boolean;
}

/**
 * Full student drilldown data.
 */
export interface StudentDrilldownData {
  // Identity
  studentId: string;
  studentName: string;
  assignmentId: string;
  assignmentTitle: string;

  // Completion
  completedAt?: string;
  isComplete: boolean;

  // Understanding summary
  understanding: UnderstandingLevel;
  coachSupport: CoachSupportLevel;

  // Why flagged (if applicable)
  needsReview: boolean;
  attentionReasons: AttentionReason[];

  // Learning journey
  insights: LearningJourneyInsights;

  // Questions (collapsed by default)
  questions: QuestionSummary[];

  // Teacher notes (primary)
  teacherNote: string;

  // Session metadata
  sessionId: string;
  timeSpentMinutes?: number;
}

// ============================================
// Teacher Notes (First-Class)
// ============================================

/**
 * Teacher note - stored and retrievable.
 */
export interface TeacherNote {
  id: string;
  studentId: string;
  sessionId: string;
  questionId?: string; // Optional: for question-level notes
  content: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================
// Display Helper Types
// ============================================

export interface UnderstandingDisplay {
  label: string;
  color: string;
  bgColor: string;
}

export interface AttentionReasonDisplay {
  label: string;
  isPositive: boolean;
}
