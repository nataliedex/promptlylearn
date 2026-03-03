/**
 * Derived Teacher Insights v1
 *
 * Deterministic insights derived from AssignmentAttemptAnalytics.
 * These surface actionable summaries for educators without requiring
 * additional LLM calls.
 *
 * Principles:
 * - Neutral, professional language (no "great job", "poor", etc.)
 * - Age-agnostic wording
 * - Avoids permanent labels on students
 * - Max 3 insights per attempt to avoid clutter
 */

// ============================================
// Insight Types
// ============================================

export type InsightType =
  | "NEEDS_SUPPORT"
  | "CHECK_IN"
  | "EXTEND_LEARNING"
  | "CHALLENGE_OPPORTUNITY"
  | "CELEBRATE_PROGRESS"
  | "GROUP_SUPPORT_CANDIDATE"
  | "MOVE_ON_EVENT"
  | "MISCONCEPTION_FLAG";

export type InsightSeverity = "low" | "medium" | "high";

export type InsightScope = "assignment" | "question" | "session";

export type SuggestedInsightAction =
  | "ADD_TODO"
  | "AWARD_BADGE"
  | "INVITE_SUPPORT_SESSION"
  | "INVITE_ENRICHMENT_SESSION"
  | "REASSIGN_WITH_HINTS"
  | "MARK_REVIEWED";

// ============================================
// Navigation Targets
// ============================================

export interface NavigationTargets {
  route: string;
  state: {
    scrollToSection?: string;
    highlightQuestionId?: string;
  };
}

// ============================================
// Evidence Object
// ============================================

export interface InsightEvidence {
  timeSpentMs?: number;
  hintCount?: number;
  probeCount?: number;
  reframeCount?: number;
  moveOnTriggered?: boolean;
  misconceptionType?: string;
  correctnessEstimate?: string;
  confidenceEstimate?: string;
  supportLevelUsed?: string;
  studentTurnCount?: number;
  questionIndex?: number;
  outcomeTag?: string;
  stagnationReason?: string;
}

// ============================================
// DerivedInsight
// ============================================

export interface DerivedInsight {
  /** Stable ID: ${attemptId}:${type}:${questionId?} */
  id: string;
  attemptId: string;
  assignmentId: string;
  studentId: string;
  classId: string;
  createdAt: string; // ISO string

  type: InsightType;
  severity: InsightSeverity;
  scope: InsightScope;

  /** Question ID if scope is "question" */
  questionId?: string;

  /** Short, UI-ready title */
  title: string;

  /** 1-2 sentences explaining the insight (max 160 chars per sentence) */
  why: string;

  /** Structured evidence justifying the insight */
  evidence: InsightEvidence;

  /** Suggested actions for the educator */
  suggestedActions: SuggestedInsightAction[];

  /** Navigation info for click-through */
  navigationTargets: NavigationTargets;
}

// ============================================
// Group Insight (assignment-level rollup)
// ============================================

export interface GroupInsight {
  id: string;
  assignmentId: string;
  classId: string;
  createdAt: string;

  type: "GROUP_SUPPORT_CANDIDATE";
  severity: InsightSeverity;

  title: string;
  why: string;

  /** Student IDs affected */
  affectedStudentIds: string[];

  /** Common misconception type if applicable */
  commonMisconceptionType?: string;

  /** Common question ID if applicable */
  commonQuestionId?: string;

  suggestedActions: SuggestedInsightAction[];

  navigationTargets: NavigationTargets;
}

// ============================================
// Insight Priority (for ordering)
// ============================================

export const INSIGHT_PRIORITY: Record<InsightType, number> = {
  MOVE_ON_EVENT: 1,
  MISCONCEPTION_FLAG: 2,
  NEEDS_SUPPORT: 3,
  CHECK_IN: 4,
  EXTEND_LEARNING: 5,
  CHALLENGE_OPPORTUNITY: 6,
  CELEBRATE_PROGRESS: 7,
  GROUP_SUPPORT_CANDIDATE: 8,
};

export const SEVERITY_PRIORITY: Record<InsightSeverity, number> = {
  high: 1,
  medium: 2,
  low: 3,
};

// ============================================
// Helper: Create Insight ID
// ============================================

export function createInsightId(
  attemptId: string,
  type: InsightType,
  questionId?: string
): string {
  if (questionId) {
    return `${attemptId}:${type}:${questionId}`;
  }
  return `${attemptId}:${type}`;
}

// ============================================
// Helper: Sort Insights by Priority
// ============================================

export function sortInsightsByPriority(insights: DerivedInsight[]): DerivedInsight[] {
  return [...insights].sort((a, b) => {
    // First by severity
    const severityDiff = SEVERITY_PRIORITY[a.severity] - SEVERITY_PRIORITY[b.severity];
    if (severityDiff !== 0) return severityDiff;

    // Then by type priority
    return INSIGHT_PRIORITY[a.type] - INSIGHT_PRIORITY[b.type];
  });
}
