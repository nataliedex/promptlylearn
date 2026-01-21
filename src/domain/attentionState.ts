/**
 * Attention State - Single Source of Truth for "Needs Attention"
 *
 * This module defines the canonical rules for determining if a student
 * needs teacher attention TODAY (intervention/check-in).
 *
 * CANONICAL RULES - "Needs Attention Now":
 * A student needs attention if they have a recommendation with:
 *   - status = "active" (pending_review)
 *   - AND category in: Needs Support, Check-in Suggested, or elevated Developing
 *
 * EXPLICITLY EXCLUDED from attention count:
 *   - Celebrate Progress (celebrations are NOT attention items)
 *   - Challenge Opportunity (enrichment, not intervention)
 *   - Administrative / Monitor (no immediate action needed)
 *   - Group Review (unless explicitly needs-support + urgent)
 *   - Any recommendation with status: resolved, dismissed, pending, reviewed
 *
 * A student does NOT need attention if:
 * - All recommendations are "resolved" (action_taken)
 * - All recommendations are "dismissed"
 * - All recommendations are "pending" (awaiting_student_action)
 * - All recommendations are "reviewed" (legacy status)
 * - Their only active recommendations are celebrations/enrichment
 */

import { Recommendation, RecommendationStatus, RECOMMENDATION_CONFIG } from "./recommendation";

// ============================================
// Types
// ============================================

/**
 * Attention status for a single student on a specific assignment
 */
export interface StudentAttentionStatus {
  studentId: string;
  studentName: string;
  assignmentId: string;
  assignmentTitle?: string;
  needsAttention: boolean;
  attentionReason?: string;
  activeRecommendationIds: string[];
  pendingRecommendationIds: string[];
  resolvedRecommendationIds: string[];
}

/**
 * Aggregated attention counts for dashboard display
 */
export interface AttentionCounts {
  totalNeedingAttention: number;
  byAssignment: Map<string, number>;
  byClass: Map<string, number>;
}

/**
 * Summary of attention state for an assignment/lesson
 */
export interface AssignmentAttentionSummary {
  assignmentId: string;
  assignmentTitle?: string;
  totalStudents: number;
  needingAttentionCount: number;
  pendingCount: number;
  resolvedCount: number;
  studentsNeedingAttention: StudentAttentionStatus[];
  studentsPending: StudentAttentionStatus[];
}

/**
 * Full attention state for dashboard
 */
export interface DashboardAttentionState {
  studentsNeedingAttention: StudentAttentionStatus[];
  totalNeedingAttention: number;
  assignmentSummaries: AssignmentAttentionSummary[];
  pendingCount: number;
}

// ============================================
// Status Classification
// ============================================

/**
 * Statuses that indicate a student NEEDS attention (unresolved)
 */
export const NEEDS_ATTENTION_STATUSES: RecommendationStatus[] = ["active"];

/**
 * Statuses that indicate the recommendation is PENDING student action
 * (teacher has acted, waiting for student)
 */
export const PENDING_STATUSES: RecommendationStatus[] = ["pending"];

/**
 * Statuses that indicate the recommendation is RESOLVED
 * (no longer needs attention)
 */
export const RESOLVED_STATUSES: RecommendationStatus[] = ["resolved", "dismissed", "reviewed"];

/**
 * Check if a recommendation status indicates the student needs attention
 */
export function statusNeedsAttention(status: RecommendationStatus): boolean {
  return NEEDS_ATTENTION_STATUSES.includes(status);
}

/**
 * Check if a recommendation status indicates pending student action
 */
export function statusIsPending(status: RecommendationStatus): boolean {
  return PENDING_STATUSES.includes(status);
}

/**
 * Check if a recommendation status indicates resolution
 */
export function statusIsResolved(status: RecommendationStatus): boolean {
  return RESOLVED_STATUSES.includes(status);
}

// ============================================
// Category-Based Attention Filtering
// ============================================

/**
 * Rule names that indicate a student needs IMMEDIATE attention (intervention/check-in).
 * These are the categories where teacher action is needed NOW.
 */
export const ATTENTION_NOW_RULE_NAMES = [
  "needs-support",       // Student struggling - needs intervention
  "check-in-suggested",  // Explicit check-in recommendation
  "group-support",       // Multiple students need support (only if urgent)
];

/**
 * Rule names that are CONDITIONALLY attention-requiring.
 * "developing" only counts if elevated (high coach/hint usage, repeated issues, etc.)
 */
export const CONDITIONAL_ATTENTION_RULE_NAMES = [
  "developing",  // Only if elevated
];

/**
 * Rule names that should NEVER be included in attention count.
 * These are positive/informational categories, not interventions.
 */
export const EXCLUDED_ATTENTION_RULE_NAMES = [
  "notable-improvement",   // Celebration - not intervention
  "ready-for-challenge",   // Enrichment - not intervention
  "watch-progress",        // Monitor only - no immediate action
];

/**
 * Insight types that should NEVER be included in attention count.
 */
export const EXCLUDED_ATTENTION_INSIGHT_TYPES = [
  "celebrate_progress",      // Celebrations are NOT attention items
  "challenge_opportunity",   // Enrichment is NOT intervention
  "monitor",                 // No immediate action needed
];

/**
 * Check if a "developing" recommendation is elevated (requiring attention).
 * A developing student is elevated if they have:
 * - High coach/hint usage (>50%)
 * - Repeated help requests (>3)
 * - An explicit isElevated flag
 */
function isDevelopingElevated(rec: Recommendation): boolean {
  const signals = rec.triggerData?.signals || {};

  // Check for explicit elevation flag
  if (signals.isElevated === true) {
    return true;
  }

  // Check for escalation from developing
  if (signals.escalatedFromDeveloping === true) {
    return true;
  }

  // Check for high hint/coach usage (>50%)
  const hintUsageRate = signals.hintUsageRate as number | undefined;
  if (hintUsageRate !== undefined && hintUsageRate > RECOMMENDATION_CONFIG.NEEDS_SUPPORT_HINT_THRESHOLD) {
    return true;
  }

  // Check for repeated help requests (>3)
  const helpRequestCount = signals.helpRequestCount as number | undefined;
  if (helpRequestCount !== undefined && helpRequestCount >= RECOMMENDATION_CONFIG.ESCALATION_HELP_REQUESTS) {
    return true;
  }

  return false;
}

/**
 * Determine if a recommendation requires immediate teacher attention.
 * This is the canonical filter for the "X students need attention today" section.
 *
 * @param rec - The recommendation to check
 * @returns true if this recommendation requires teacher attention NOW
 */
export function isAttentionNowRecommendation(rec: Recommendation): boolean {
  // Must have active status (pending_review)
  if (!statusNeedsAttention(rec.status)) {
    return false;
  }

  const ruleName = rec.triggerData?.ruleName || "";
  const insightType = rec.insightType;

  // EXCLUDE: Celebration and enrichment categories (by insight type)
  if (EXCLUDED_ATTENTION_INSIGHT_TYPES.includes(insightType)) {
    return false;
  }

  // EXCLUDE: Specific non-attention rule names
  if (EXCLUDED_ATTENTION_RULE_NAMES.includes(ruleName)) {
    return false;
  }

  // INCLUDE: Direct attention-requiring rules
  if (ATTENTION_NOW_RULE_NAMES.includes(ruleName)) {
    return true;
  }

  // CONDITIONAL: Developing is only included if elevated
  if (CONDITIONAL_ATTENTION_RULE_NAMES.includes(ruleName)) {
    return isDevelopingElevated(rec);
  }

  // Fallback: check_in insight type with non-excluded rules
  if (insightType === "check_in") {
    return true;
  }

  return false;
}

/**
 * Get a problem-focused attention reason for display.
 * This generates the text shown in the "needs attention" list.
 *
 * @param rec - The recommendation
 * @returns A short, problem-focused summary (e.g., "Needs support on Division Basics (38%)")
 */
export function getAttentionReason(rec: Recommendation): string {
  const signals = rec.triggerData?.signals || {};
  const ruleName = rec.triggerData?.ruleName || "";
  const assignmentTitle = signals.assignmentTitle || rec.assignmentId || "";

  // Build reason based on rule/category
  switch (ruleName) {
    case "needs-support":
      const score = signals.score as number | undefined;
      if (score !== undefined) {
        return `Needs support on ${assignmentTitle} (${Math.round(score)}%)`;
      }
      return `Needs support on ${assignmentTitle}`;

    case "group-support":
      const studentCount = signals.studentCount as number | undefined;
      if (studentCount) {
        return `Group needs support (${studentCount} students)`;
      }
      return "Group needs support";

    case "check-in-suggested":
      const coachIntent = signals.coachIntent as string | undefined;
      if (coachIntent === "support-seeking") {
        return "Check-in suggested: seeking help in coach";
      }
      const hintRate = signals.hintUsageRate as number | undefined;
      if (hintRate !== undefined && hintRate > 0.5) {
        return `Check-in suggested: high coach usage (${Math.round(hintRate * 100)}%)`;
      }
      return "Check-in suggested";

    case "developing":
      const devHintRate = signals.hintUsageRate as number | undefined;
      if (devHintRate !== undefined && devHintRate > 0.5) {
        return `Developing with high coach usage (${Math.round(devHintRate * 100)}%)`;
      }
      const helpRequests = signals.helpRequestCount as number | undefined;
      if (helpRequests !== undefined && helpRequests >= 3) {
        return `Developing with repeated help requests (${helpRequests})`;
      }
      return "Developing - needs monitoring";

    default:
      // Fallback to the recommendation's own summary/reason
      return rec.summary || rec.reason || "Needs attention";
  }
}

// ============================================
// Core Attention Logic
// ============================================

/**
 * Determine if a student needs attention for a specific assignment
 * based on their recommendations.
 *
 * IMPORTANT: Returns true ONLY if student has an ATTENTION-NOW recommendation
 * (intervention/check-in categories). Celebrations and enrichment do NOT count.
 *
 * @param recommendations - All recommendations (will be filtered)
 * @param studentId - The student to check
 * @param assignmentId - The assignment to check (optional)
 * @returns true if student has any attention-now recommendations
 */
export function studentNeedsAttention(
  recommendations: Recommendation[],
  studentId: string,
  assignmentId?: string
): boolean {
  const studentRecs = recommendations.filter((r) => {
    if (!r.studentIds.includes(studentId)) return false;
    if (assignmentId && r.assignmentId !== assignmentId) return false;
    return true;
  });

  // Only count as needing attention if they have ATTENTION-NOW recommendations
  return studentRecs.some(isAttentionNowRecommendation);
}

/**
 * Get detailed attention status for a student on an assignment.
 *
 * IMPORTANT: "needsAttention" is true ONLY if the student has a recommendation
 * that passes the `isAttentionNowRecommendation` filter (intervention categories).
 * Celebrations and enrichment do NOT cause needsAttention to be true.
 */
export function getStudentAttentionStatus(
  recommendations: Recommendation[],
  studentId: string,
  studentName: string,
  assignmentId?: string,
  assignmentTitle?: string
): StudentAttentionStatus {
  const studentRecs = recommendations.filter((r) => {
    if (!r.studentIds.includes(studentId)) return false;
    if (assignmentId && r.assignmentId !== assignmentId) return false;
    return true;
  });

  // All active (any category) - for tracking
  const allActiveRecs = studentRecs.filter((r) => statusNeedsAttention(r.status));

  // ATTENTION-NOW recs only - filtered by category (intervention/check-in)
  const attentionNowRecs = allActiveRecs.filter(isAttentionNowRecommendation);

  const pendingRecs = studentRecs.filter((r) => statusIsPending(r.status));
  const resolvedRecs = studentRecs.filter((r) => statusIsResolved(r.status));

  // Determine attention reason from highest priority ATTENTION-NOW recommendation
  // Use problem-focused reason, not celebration text
  let attentionReason: string | undefined;
  if (attentionNowRecs.length > 0) {
    const highestPriority = attentionNowRecs.sort((a, b) => b.priority - a.priority)[0];
    attentionReason = getAttentionReason(highestPriority);
  }

  return {
    studentId,
    studentName,
    assignmentId: assignmentId || "",
    assignmentTitle,
    // CRITICAL: Only true if student has ATTENTION-NOW recommendations
    // (not celebrations or enrichment)
    needsAttention: attentionNowRecs.length > 0,
    attentionReason,
    // Track all active IDs (both attention-now and others)
    activeRecommendationIds: allActiveRecs.map((r) => r.id),
    pendingRecommendationIds: pendingRecs.map((r) => r.id),
    resolvedRecommendationIds: resolvedRecs.map((r) => r.id),
  };
}

/**
 * Get all students needing attention from a set of recommendations.
 *
 * IMPORTANT: Only returns students with ATTENTION-NOW recommendations
 * (intervention/check-in categories). Students with only celebrations
 * or enrichment recommendations are NOT included.
 */
export function getStudentsNeedingAttention(
  recommendations: Recommendation[],
  studentMap: Map<string, string>, // studentId -> studentName
  options?: {
    assignmentId?: string;
    classStudentIds?: string[];
  }
): StudentAttentionStatus[] {
  // Filter recommendations by assignment if specified
  let relevantRecs = recommendations;
  if (options?.assignmentId) {
    relevantRecs = recommendations.filter((r) => r.assignmentId === options.assignmentId);
  }

  // Get unique student IDs from recommendations
  const studentIds = new Set<string>();
  for (const rec of relevantRecs) {
    for (const sid of rec.studentIds) {
      // Filter by class if specified
      if (options?.classStudentIds && !options.classStudentIds.includes(sid)) {
        continue;
      }
      studentIds.add(sid);
    }
  }

  // Build attention status for each student
  const statuses: StudentAttentionStatus[] = [];
  for (const studentId of studentIds) {
    const studentName = studentMap.get(studentId) || `Student ${studentId.slice(0, 6)}`;
    const status = getStudentAttentionStatus(
      relevantRecs,
      studentId,
      studentName,
      options?.assignmentId
    );

    if (status.needsAttention) {
      statuses.push(status);
    }
  }

  // Sort by number of active recommendations (most first)
  statuses.sort((a, b) => b.activeRecommendationIds.length - a.activeRecommendationIds.length);

  return statuses;
}

/**
 * Get attention summary for a specific assignment
 */
export function getAssignmentAttentionSummary(
  recommendations: Recommendation[],
  assignmentId: string,
  assignmentTitle: string,
  studentMap: Map<string, string>,
  totalStudents: number
): AssignmentAttentionSummary {
  const assignmentRecs = recommendations.filter((r) => r.assignmentId === assignmentId);

  // Get unique students with any recommendation for this assignment
  const studentIds = new Set<string>();
  for (const rec of assignmentRecs) {
    for (const sid of rec.studentIds) {
      studentIds.add(sid);
    }
  }

  // Categorize students
  const studentsNeedingAttention: StudentAttentionStatus[] = [];
  const studentsPending: StudentAttentionStatus[] = [];
  let resolvedCount = 0;

  for (const studentId of studentIds) {
    const studentName = studentMap.get(studentId) || `Student ${studentId.slice(0, 6)}`;
    const status = getStudentAttentionStatus(
      assignmentRecs,
      studentId,
      studentName,
      assignmentId,
      assignmentTitle
    );

    if (status.needsAttention) {
      studentsNeedingAttention.push(status);
    } else if (status.pendingRecommendationIds.length > 0) {
      studentsPending.push(status);
    } else if (status.resolvedRecommendationIds.length > 0) {
      resolvedCount++;
    }
  }

  return {
    assignmentId,
    assignmentTitle,
    totalStudents,
    needingAttentionCount: studentsNeedingAttention.length,
    pendingCount: studentsPending.length,
    resolvedCount,
    studentsNeedingAttention,
    studentsPending,
  };
}

/**
 * Get full dashboard attention state
 */
export function getDashboardAttentionState(
  recommendations: Recommendation[],
  studentMap: Map<string, string>,
  assignmentInfo: Array<{ id: string; title: string; totalStudents: number }>
): DashboardAttentionState {
  // Get all students needing attention across all assignments
  const studentsNeedingAttention = getStudentsNeedingAttention(recommendations, studentMap);

  // Count pending recommendations
  const pendingCount = recommendations.filter((r) => statusIsPending(r.status)).length;

  // Build assignment summaries
  const assignmentSummaries = assignmentInfo.map((assignment) =>
    getAssignmentAttentionSummary(
      recommendations,
      assignment.id,
      assignment.title,
      studentMap,
      assignment.totalStudents
    )
  );

  return {
    studentsNeedingAttention,
    totalNeedingAttention: studentsNeedingAttention.length,
    assignmentSummaries,
    pendingCount,
  };
}

// ============================================
// Utility Functions for Actions
// ============================================

/**
 * Given a recommendation that was just acted upon, determine which
 * students should be removed from "needs attention" state.
 *
 * A student should be removed if they have NO OTHER active recommendations.
 */
export function getStudentsToRemoveFromAttention(
  allRecommendations: Recommendation[],
  actedRecommendation: Recommendation
): string[] {
  const studentsToRemove: string[] = [];

  for (const studentId of actedRecommendation.studentIds) {
    // Check if this student has any OTHER active recommendations
    const otherActiveRecs = allRecommendations.filter(
      (r) =>
        r.id !== actedRecommendation.id &&
        r.studentIds.includes(studentId) &&
        statusNeedsAttention(r.status)
    );

    if (otherActiveRecs.length === 0) {
      studentsToRemove.push(studentId);
    }
  }

  return studentsToRemove;
}
