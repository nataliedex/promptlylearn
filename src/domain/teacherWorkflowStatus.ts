/**
 * Teacher Workflow Status
 *
 * Unified status computation for educator workflow across all surfaces.
 * This is the single source of truth for "what does the teacher need to do next?"
 *
 * Three distinct concepts (do not conflate):
 * 1. Student Progress: what the student did (not submitted / submitted / completed)
 * 2. Teacher Review State: whether teacher has reviewed (pending_review / reviewed)
 * 3. Teacher Workflow Status: computed label telling teacher what to do next
 *
 * This module implements #3.
 */

import { DerivedInsight, InsightType } from "./derivedInsight";

// ============================================
// Workflow Status Enum
// ============================================

export type TeacherWorkflowStatus =
  | "NEEDS_REVIEW"
  | "ACTION_REQUIRED"
  | "FOLLOW_UP_SCHEDULED"
  | "RESOLVED"
  | "NO_ACTION";

// ============================================
// Display Labels (educator UI only)
// ============================================

export const WORKFLOW_STATUS_LABELS: Record<TeacherWorkflowStatus, string> = {
  NEEDS_REVIEW: "Needs review",
  ACTION_REQUIRED: "Action required",
  FOLLOW_UP_SCHEDULED: "Follow-up scheduled",
  RESOLVED: "Resolved",
  NO_ACTION: "—",
};

// ============================================
// Status Colors (for UI consistency)
// ============================================

export const WORKFLOW_STATUS_COLORS: Record<
  TeacherWorkflowStatus,
  { color: string; bgColor: string }
> = {
  NEEDS_REVIEW: { color: "#d97706", bgColor: "#fffbeb" }, // amber
  ACTION_REQUIRED: { color: "#dc2626", bgColor: "#fef2f2" }, // red
  FOLLOW_UP_SCHEDULED: { color: "#7c3aed", bgColor: "#f5f3ff" }, // violet
  RESOLVED: { color: "#059669", bgColor: "#ecfdf5" }, // green
  NO_ACTION: { color: "#94a3b8", bgColor: "#f8fafc" }, // slate
};

// ============================================
// Insight Types that Require Action
// ============================================

const ACTIONABLE_INSIGHT_TYPES: InsightType[] = [
  "MOVE_ON_EVENT",
  "MISCONCEPTION_FLAG",
  "NEEDS_SUPPORT",
  "CHECK_IN",
  "EXTEND_LEARNING",
  "CHALLENGE_OPPORTUNITY",
  "CELEBRATE_PROGRESS",
];

const HIGH_PRIORITY_INSIGHT_TYPES: InsightType[] = [
  "MOVE_ON_EVENT",
  "NEEDS_SUPPORT",
  "MISCONCEPTION_FLAG",
];

// ============================================
// Input Types for Status Computation
// ============================================

export interface WorkflowStatusInputs {
  /** Current review state from StudentAssignment */
  reviewState: "pending_review" | "reviewed" | "not_started" | "followup_scheduled" | "resolved" | null;

  /** Whether student has submitted work */
  hasSubmission: boolean;

  /** Derived insights for this student+assignment (active only) */
  derivedInsights: DerivedInsight[];

  /** Number of open (non-completed, non-superseded) todos for this student+assignment */
  openTodosCount: number;

  /** Optional: whether assignment was reopened for review */
  reopenedForReview?: boolean;
}

export interface AssignmentWorkflowRollup {
  needsReviewCount: number;
  actionRequiredCount: number;
  followUpScheduledCount: number;
  resolvedCount: number;
  notSubmittedCount: number;
  totalStudents: number;
}

// ============================================
// Main Computation Function
// ============================================

/**
 * Compute the teacher workflow status for a single student-assignment.
 *
 * Priority order:
 * 1. ACTION_REQUIRED - pending_review + high-priority actionable insight
 * 2. NEEDS_REVIEW - pending_review (but no high-priority insights)
 * 3. FOLLOW_UP_SCHEDULED - reviewed + open todos
 * 4. RESOLVED - reviewed + no open todos
 * 5. NO_ACTION - no submission + no todos + no insights
 */
export function computeTeacherWorkflowStatus(
  inputs: WorkflowStatusInputs
): TeacherWorkflowStatus {
  const {
    reviewState,
    hasSubmission,
    derivedInsights,
    openTodosCount,
  } = inputs;

  // Get actionable insights (those with suggested actions)
  const actionableInsights = derivedInsights.filter(
    (insight) =>
      ACTIONABLE_INSIGHT_TYPES.includes(insight.type) &&
      insight.suggestedActions.length > 0
  );

  // Check for high-priority insights (medium/high severity or specific types)
  const hasHighPriorityInsight = actionableInsights.some(
    (insight) =>
      HIGH_PRIORITY_INSIGHT_TYPES.includes(insight.type) ||
      insight.severity === "high" ||
      insight.severity === "medium"
  );

  // Rule 1 & 2: Pending review states
  if (reviewState === "pending_review") {
    // Rule 2: Upgrade to ACTION_REQUIRED if high-priority insights exist
    if (hasHighPriorityInsight) {
      return "ACTION_REQUIRED";
    }
    // Rule 1: Base case - needs review
    return "NEEDS_REVIEW";
  }

  // Rule 3: Follow-up scheduled (reviewed but has open todos)
  // Also applies to followup_scheduled review state
  if (
    (reviewState === "reviewed" || reviewState === "followup_scheduled") &&
    openTodosCount > 0
  ) {
    return "FOLLOW_UP_SCHEDULED";
  }

  // Rule 4: Resolved (reviewed and no open todos)
  if (
    reviewState === "reviewed" ||
    reviewState === "resolved" ||
    reviewState === "followup_scheduled"
  ) {
    // If followup_scheduled but no open todos, still consider resolved
    if (openTodosCount === 0) {
      return "RESOLVED";
    }
    return "FOLLOW_UP_SCHEDULED";
  }

  // Rule 5: No action needed
  // Only if no submission AND no todos AND no active insights
  if (!hasSubmission && openTodosCount === 0 && actionableInsights.length === 0) {
    return "NO_ACTION";
  }

  // Fallback: If there's a submission but review state is weird, default to NEEDS_REVIEW
  if (hasSubmission) {
    return "NEEDS_REVIEW";
  }

  return "NO_ACTION";
}

// ============================================
// Assignment-Level Rollup
// ============================================

export interface StudentWorkflowData {
  studentId: string;
  status: TeacherWorkflowStatus;
  hasSubmission: boolean;
}

/**
 * Compute assignment-level workflow rollup from individual student statuses.
 */
export function computeAssignmentWorkflowRollup(
  students: StudentWorkflowData[]
): AssignmentWorkflowRollup {
  const rollup: AssignmentWorkflowRollup = {
    needsReviewCount: 0,
    actionRequiredCount: 0,
    followUpScheduledCount: 0,
    resolvedCount: 0,
    notSubmittedCount: 0,
    totalStudents: students.length,
  };

  for (const student of students) {
    switch (student.status) {
      case "NEEDS_REVIEW":
        rollup.needsReviewCount++;
        break;
      case "ACTION_REQUIRED":
        rollup.actionRequiredCount++;
        // Also count in needsReviewCount for summary purposes
        rollup.needsReviewCount++;
        break;
      case "FOLLOW_UP_SCHEDULED":
        rollup.followUpScheduledCount++;
        break;
      case "RESOLVED":
        rollup.resolvedCount++;
        break;
      case "NO_ACTION":
        if (!student.hasSubmission) {
          rollup.notSubmittedCount++;
        }
        break;
    }
  }

  return rollup;
}

/**
 * Get the assignment-level status label from rollup.
 */
export function getAssignmentStatusLabel(rollup: AssignmentWorkflowRollup): string {
  if (rollup.actionRequiredCount > 0) {
    return "Needs attention";
  }

  if (rollup.needsReviewCount > 0) {
    return "Needs review";
  }

  if (rollup.followUpScheduledCount > 0) {
    return "Follow-ups scheduled";
  }

  if (rollup.resolvedCount > 0) {
    return "Reviewed";
  }

  return "Awaiting submissions";
}

/**
 * Get detailed summary text for assignment review status.
 */
export function getAssignmentReviewSummary(rollup: AssignmentWorkflowRollup): string {
  const { needsReviewCount, actionRequiredCount, followUpScheduledCount, resolvedCount, notSubmittedCount, totalStudents } = rollup;

  // All reviewed with no action required
  if (needsReviewCount === 0 && actionRequiredCount === 0) {
    if (followUpScheduledCount > 0) {
      return `Reviews complete. Follow-ups scheduled for ${followUpScheduledCount} student${followUpScheduledCount === 1 ? "" : "s"}.`;
    }
    if (resolvedCount === totalStudents) {
      return "All students reviewed";
    }
    if (notSubmittedCount > 0) {
      return `${resolvedCount} reviewed, ${notSubmittedCount} awaiting submission`;
    }
    return "All students reviewed";
  }

  // Has items needing review
  if (actionRequiredCount > 0) {
    return `${actionRequiredCount} student${actionRequiredCount === 1 ? "" : "s"} need${actionRequiredCount === 1 ? "s" : ""} attention`;
  }

  if (needsReviewCount > 0) {
    return `${needsReviewCount} student${needsReviewCount === 1 ? "" : "s"} need${needsReviewCount === 1 ? "s" : ""} review`;
  }

  return "";
}

// ============================================
// Helper: Check if all reviews are complete
// ============================================

/**
 * Returns true only when all students with submissions have been reviewed
 * and there are no action-required items.
 */
export function areAllReviewsComplete(rollup: AssignmentWorkflowRollup): boolean {
  return rollup.needsReviewCount === 0 && rollup.actionRequiredCount === 0;
}

// ============================================
// Helper: Convert ReviewState to WorkflowStatusInputs
// ============================================

/**
 * Convert a ReviewState string to the partial inputs needed for workflow status.
 * Note: derivedInsights and openTodosCount must be provided separately.
 */
export function reviewStateToWorkflowInput(
  reviewState: string | null | undefined,
  hasSubmission: boolean
): Pick<WorkflowStatusInputs, "reviewState" | "hasSubmission"> {
  // Normalize the reviewState to our expected values
  const normalizedState = normalizeReviewState(reviewState);

  return {
    reviewState: normalizedState,
    hasSubmission,
  };
}

/**
 * Normalize various review state values to our canonical set.
 */
function normalizeReviewState(
  state: string | null | undefined
): WorkflowStatusInputs["reviewState"] {
  if (!state) return null;

  switch (state) {
    case "pending_review":
      return "pending_review";
    case "reviewed":
      return "reviewed";
    case "not_started":
      return "not_started";
    case "followup_scheduled":
      return "followup_scheduled";
    case "resolved":
      return "resolved";
    default:
      // Legacy/unknown states
      return null;
  }
}

// ============================================
// Compact Status for API responses
// ============================================

export interface CompactWorkflowStatus {
  status: TeacherWorkflowStatus;
  label: string;
  color: string;
  bgColor: string;
}

/**
 * Get compact workflow status object for API responses.
 */
export function getCompactWorkflowStatus(
  inputs: WorkflowStatusInputs
): CompactWorkflowStatus {
  const status = computeTeacherWorkflowStatus(inputs);
  const colors = WORKFLOW_STATUS_COLORS[status];

  return {
    status,
    label: WORKFLOW_STATUS_LABELS[status],
    color: colors.color,
    bgColor: colors.bgColor,
  };
}
