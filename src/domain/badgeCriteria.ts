/**
 * Badge Criteria Evaluator
 *
 * Implements formal, explainable badge criteria for v1:
 * - Progress Star: Growth/improvement on assignments
 * - Mastery Badge: Subject-level consistent excellence
 * - Focus Badge (Persistence): Completing work despite difficulty
 *
 * Each badge suggestion includes a human-readable reason
 * and structured evidence for transparency.
 */

import { BadgeType } from "./recommendation";

// ============================================
// Types
// ============================================

/**
 * Evidence structure for badge suggestions
 */
export interface BadgeEvidence {
  // For Progress Star
  previousScore?: number;
  currentScore?: number;
  improvement?: number;
  assignmentId?: string;
  assignmentTitle?: string;

  // For Mastery Badge
  subjectAssignmentCount?: number;
  subjectAverageScore?: number;
  subjectHintUsageRate?: number;
  distinctDays?: number;
  assignmentIds?: string[];

  // For Focus Badge
  hintUsageRate?: number;
  timeSpentMinutes?: number;
  questionCount?: number;
  completedAt?: string;
}

/**
 * A suggestion to award a badge with explanation
 */
export interface BadgeSuggestion {
  studentId: string;
  studentName: string;
  badgeType: BadgeType;
  subject?: string;
  assignmentId?: string;
  assignmentTitle?: string;
  reason: string; // Human-readable explanation
  evidence: BadgeEvidence;
  priority: "high" | "medium" | "low";
}

/**
 * Input data for evaluating a single student's badge eligibility
 */
export interface StudentBadgeContext {
  studentId: string;
  studentName: string;
  // Current assignment attempt
  currentAttempt?: {
    assignmentId: string;
    assignmentTitle: string;
    subject?: string;
    score: number;
    hintUsageRate: number; // 0-1
    timeSpentMinutes?: number;
    questionCount: number;
    completedAt: string;
  };
  // Historical attempts on same assignment (for improvement detection)
  previousAttempts?: {
    assignmentId: string;
    score: number;
    completedAt: string;
  }[];
  // Subject-level history (for mastery detection)
  subjectHistory?: {
    subject: string;
    assignments: {
      assignmentId: string;
      assignmentTitle: string;
      score: number;
      hintUsageRate: number;
      completedAt: string;
    }[];
  }[];
  // Previously awarded badges (for cooldown checks)
  awardedBadges?: {
    badgeType: BadgeType;
    subject?: string;
    assignmentId?: string;
    awardedAt: string;
  }[];
}

// ============================================
// Configuration Constants
// ============================================

export const BADGE_CRITERIA = {
  progressStar: {
    minImprovement: 20, // +20 points minimum
    minFinalScore: 60, // Must reach at least 60%
    minAttempts: 2, // At least 2 attempts on same assignment
    maxDaysSinceImprovement: 30, // Within last 30 days
    cooldownPerAssignmentDays: Infinity, // Max 1 ever per assignment
    cooldownPerSubjectDays: 14, // Max 1 per subject per 14 days
  },
  masteryBadge: {
    minAssignmentsInSubject: 3, // At least 3 assignments
    minSubjectAverageScore: 85, // 85%+ average
    maxHintUsageRate: 0.20, // <=20% hint usage
    minDistinctDays: 2, // Work spans at least 2 days
    cooldownPerSubjectDays: 30, // Max 1 per subject per 30 days
  },
  focusBadge: {
    minHintUsageRate: 0.60, // Used hints on >= 60% of questions
    minTimeSpentMinutes: 10, // At least 10 minutes (or median)
    minScore: 50, // Must score at least 50%
    cooldownDays: 14, // Max 1 per student per 14 days
  },
} as const;

// ============================================
// Cooldown Helpers
// ============================================

/**
 * Check if a badge was awarded within the cooldown period
 */
function isWithinCooldown(
  awardedAt: string,
  cooldownDays: number,
  now: Date = new Date()
): boolean {
  if (cooldownDays === Infinity) return true; // Always on cooldown
  const awardDate = new Date(awardedAt);
  const daysSince = (now.getTime() - awardDate.getTime()) / (1000 * 60 * 60 * 24);
  return daysSince < cooldownDays;
}

/**
 * Check if Progress Star can be awarded for this assignment
 */
function canAwardProgressStarForAssignment(
  assignmentId: string,
  awardedBadges: StudentBadgeContext["awardedBadges"]
): boolean {
  if (!awardedBadges) return true;
  // Max 1 Progress Star ever per assignment
  return !awardedBadges.some(
    b => b.badgeType === "progress_star" && b.assignmentId === assignmentId
  );
}

/**
 * Check if Progress Star can be awarded for this subject (14-day cooldown)
 */
function canAwardProgressStarForSubject(
  subject: string | undefined,
  awardedBadges: StudentBadgeContext["awardedBadges"],
  now: Date = new Date()
): boolean {
  if (!awardedBadges || !subject) return true;
  const recentForSubject = awardedBadges.find(
    b =>
      b.badgeType === "progress_star" &&
      b.subject === subject &&
      isWithinCooldown(b.awardedAt, BADGE_CRITERIA.progressStar.cooldownPerSubjectDays, now)
  );
  return !recentForSubject;
}

/**
 * Check if Mastery Badge can be awarded for this subject (30-day cooldown)
 */
function canAwardMasteryBadgeForSubject(
  subject: string,
  awardedBadges: StudentBadgeContext["awardedBadges"],
  now: Date = new Date()
): boolean {
  if (!awardedBadges) return true;
  const recentForSubject = awardedBadges.find(
    b =>
      b.badgeType === "mastery_badge" &&
      b.subject === subject &&
      isWithinCooldown(b.awardedAt, BADGE_CRITERIA.masteryBadge.cooldownPerSubjectDays, now)
  );
  return !recentForSubject;
}

/**
 * Check if Focus Badge can be awarded (14-day cooldown per student)
 */
function canAwardFocusBadge(
  awardedBadges: StudentBadgeContext["awardedBadges"],
  now: Date = new Date()
): boolean {
  if (!awardedBadges) return true;
  const recentFocus = awardedBadges.find(
    b =>
      b.badgeType === "persistence" &&
      isWithinCooldown(b.awardedAt, BADGE_CRITERIA.focusBadge.cooldownDays, now)
  );
  return !recentFocus;
}

// ============================================
// Badge Criteria Evaluators
// ============================================

/**
 * Evaluate Progress Star eligibility (assignment-level improvement)
 *
 * Criteria:
 * - 2+ attempts on same assignment
 * - +20 points improvement
 * - Final score >= 60%
 * - Within last 30 days
 */
export function evaluateProgressStar(
  context: StudentBadgeContext,
  now: Date = new Date()
): BadgeSuggestion | null {
  const { currentAttempt, previousAttempts, awardedBadges, studentId, studentName } = context;

  if (!currentAttempt || !previousAttempts || previousAttempts.length === 0) {
    return null;
  }

  const criteria = BADGE_CRITERIA.progressStar;

  // Find attempts for the same assignment
  const sameAssignmentAttempts = previousAttempts.filter(
    a => a.assignmentId === currentAttempt.assignmentId
  );

  if (sameAssignmentAttempts.length === 0) {
    return null; // Need at least 1 previous attempt
  }

  // Find the earliest previous attempt for comparison
  const earliestAttempt = sameAssignmentAttempts.reduce((earliest, current) =>
    new Date(current.completedAt) < new Date(earliest.completedAt) ? current : earliest
  );

  const improvement = currentAttempt.score - earliestAttempt.score;
  const daysSinceEarliest =
    (now.getTime() - new Date(earliestAttempt.completedAt).getTime()) / (1000 * 60 * 60 * 24);

  // Check all criteria
  if (improvement < criteria.minImprovement) return null;
  if (currentAttempt.score < criteria.minFinalScore) return null;
  if (daysSinceEarliest > criteria.maxDaysSinceImprovement) return null;

  // Check cooldowns
  if (!canAwardProgressStarForAssignment(currentAttempt.assignmentId, awardedBadges)) {
    return null;
  }
  if (!canAwardProgressStarForSubject(currentAttempt.subject, awardedBadges, now)) {
    return null;
  }

  return {
    studentId,
    studentName,
    badgeType: "progress_star",
    subject: currentAttempt.subject,
    assignmentId: currentAttempt.assignmentId,
    assignmentTitle: currentAttempt.assignmentTitle,
    reason: `Improved +${Math.round(improvement)} points on ${currentAttempt.assignmentTitle}`,
    evidence: {
      previousScore: earliestAttempt.score,
      currentScore: currentAttempt.score,
      improvement,
      assignmentId: currentAttempt.assignmentId,
      assignmentTitle: currentAttempt.assignmentTitle,
    },
    priority: improvement >= 30 ? "high" : "medium",
  };
}

/**
 * Evaluate Mastery Badge eligibility (subject-level excellence)
 *
 * Criteria:
 * - 3+ assignments in subject
 * - 85%+ average score
 * - <=20% hint usage
 * - Work spans 2+ distinct days
 */
export function evaluateMasteryBadge(
  context: StudentBadgeContext,
  now: Date = new Date()
): BadgeSuggestion | null {
  const { subjectHistory, awardedBadges, studentId, studentName } = context;

  if (!subjectHistory || subjectHistory.length === 0) {
    return null;
  }

  const criteria = BADGE_CRITERIA.masteryBadge;
  const suggestions: BadgeSuggestion[] = [];

  for (const subjectData of subjectHistory) {
    const { subject, assignments } = subjectData;

    if (assignments.length < criteria.minAssignmentsInSubject) {
      continue;
    }

    // Calculate subject averages
    const avgScore =
      assignments.reduce((sum, a) => sum + a.score, 0) / assignments.length;
    const avgHintUsage =
      assignments.reduce((sum, a) => sum + a.hintUsageRate, 0) / assignments.length;

    // Count distinct days
    const distinctDays = new Set(
      assignments.map(a => new Date(a.completedAt).toDateString())
    ).size;

    // Check criteria
    if (avgScore < criteria.minSubjectAverageScore) continue;
    if (avgHintUsage > criteria.maxHintUsageRate) continue;
    if (distinctDays < criteria.minDistinctDays) continue;

    // Check cooldown
    if (!canAwardMasteryBadgeForSubject(subject, awardedBadges, now)) {
      continue;
    }

    suggestions.push({
      studentId,
      studentName,
      badgeType: "mastery_badge",
      subject,
      reason: `${Math.round(avgScore)}% average in ${subject} across ${assignments.length} lessons with low coach use`,
      evidence: {
        subjectAssignmentCount: assignments.length,
        subjectAverageScore: avgScore,
        subjectHintUsageRate: avgHintUsage,
        distinctDays,
        assignmentIds: assignments.map(a => a.assignmentId),
      },
      priority: avgScore >= 90 ? "high" : "medium",
    });
  }

  // Return highest priority suggestion if multiple subjects qualify
  if (suggestions.length === 0) return null;
  return suggestions.sort((a, b) => {
    if (a.priority === "high" && b.priority !== "high") return -1;
    if (b.priority === "high" && a.priority !== "high") return 1;
    return 0;
  })[0];
}

/**
 * Evaluate Focus Badge eligibility (persistence through difficulty)
 *
 * Criteria:
 * - Hint usage >= 60% of questions
 * - Completed the assignment
 * - Time spent >= 10 minutes (if available)
 * - Score >= 50%
 */
export function evaluateFocusBadge(
  context: StudentBadgeContext,
  now: Date = new Date()
): BadgeSuggestion | null {
  const { currentAttempt, awardedBadges, studentId, studentName } = context;

  if (!currentAttempt) {
    return null;
  }

  const criteria = BADGE_CRITERIA.focusBadge;

  // Check hint usage threshold
  if (currentAttempt.hintUsageRate < criteria.minHintUsageRate) {
    return null;
  }

  // Check minimum score
  if (currentAttempt.score < criteria.minScore) {
    return null;
  }

  // Check time spent (if available)
  // If time not available, we allow it based on hint usage + completion + score
  const hasTimeData = currentAttempt.timeSpentMinutes !== undefined;
  if (hasTimeData && currentAttempt.timeSpentMinutes! < criteria.minTimeSpentMinutes) {
    return null;
  }

  // Check cooldown
  if (!canAwardFocusBadge(awardedBadges, now)) {
    return null;
  }

  return {
    studentId,
    studentName,
    badgeType: "persistence",
    subject: currentAttempt.subject,
    assignmentId: currentAttempt.assignmentId,
    assignmentTitle: currentAttempt.assignmentTitle,
    reason: "Completed despite heavy coaching—great persistence",
    evidence: {
      hintUsageRate: currentAttempt.hintUsageRate,
      timeSpentMinutes: currentAttempt.timeSpentMinutes,
      questionCount: currentAttempt.questionCount,
      currentScore: currentAttempt.score,
      completedAt: currentAttempt.completedAt,
    },
    priority: currentAttempt.score >= 70 ? "high" : "medium",
  };
}

// ============================================
// Main Evaluation Function
// ============================================

/**
 * Evaluate all badge criteria for a student and return all eligible suggestions
 */
export function evaluateBadgeCriteria(
  context: StudentBadgeContext,
  now: Date = new Date()
): BadgeSuggestion[] {
  const suggestions: BadgeSuggestion[] = [];

  // Check Progress Star
  const progressStar = evaluateProgressStar(context, now);
  if (progressStar) {
    suggestions.push(progressStar);
  }

  // Check Mastery Badge
  const masteryBadge = evaluateMasteryBadge(context, now);
  if (masteryBadge) {
    suggestions.push(masteryBadge);
  }

  // Check Focus Badge
  const focusBadge = evaluateFocusBadge(context, now);
  if (focusBadge) {
    suggestions.push(focusBadge);
  }

  return suggestions;
}

/**
 * Get a display-friendly badge type name
 */
export function getBadgeDisplayName(badgeType: BadgeType): string {
  const names: Record<BadgeType, string> = {
    progress_star: "Progress Star",
    mastery_badge: "Mastery Badge",
    effort_award: "Effort Award",
    helper_badge: "Helper Badge",
    persistence: "Persistence",
    curiosity: "Curiosity Award",
    focus_badge: "Focus Badge",
    creativity_badge: "Creativity Badge",
    collaboration_badge: "Collaboration Badge",
    custom: "Custom Badge",
  };
  return names[badgeType] || badgeType;
}
