/**
 * Derived Insight Store
 *
 * Deterministic derivation of teacher insights from AssignmentAttemptAnalytics.
 * Computed on-read (not persisted separately) for simplicity.
 */

import {
  DerivedInsight,
  GroupInsight,
  InsightType,
  InsightSeverity,
  InsightEvidence,
  SuggestedInsightAction,
  createInsightId,
  sortInsightsByPriority,
} from "../domain/derivedInsight";
import {
  AssignmentAttemptAnalytics,
  QuestionAttemptAnalytics,
} from "../domain/coachAnalytics";
import { getAssignmentAnalytics } from "./coachAnalyticsStore";
import { getResolvedInsightIds } from "./insightResolutionStore";

// ============================================
// Constants
// ============================================

const MAX_INSIGHTS_PER_ATTEMPT = 3;

// ============================================
// Misconception Type Labels (for readable "why" text)
// ============================================

const MISCONCEPTION_LABELS: Record<string, string> = {
  concept_confusion: "confusion between related concepts",
  procedure_error: "a procedural error",
  vocabulary_misread: "vocabulary misunderstanding",
  units_or_scale_error: "units or scale confusion",
  cause_effect_reversal: "cause-effect reversal",
  overgeneralization: "overgeneralization",
  misapplied_rule: "a misapplied rule",
};

// ============================================
// Stagnation Reason Labels
// ============================================

const STAGNATION_LABELS: Record<string, string> = {
  repeating_same_answer: "repeated similar responses",
  no_new_information: "limited new progress",
  off_topic: "off-topic responses",
  cannot_start: "difficulty starting",
  silent_or_minimal: "minimal responses",
};

// ============================================
// Main Derivation Function
// ============================================

export function deriveInsightsFromAttempt(
  analytics: AssignmentAttemptAnalytics
): DerivedInsight[] {
  const insights: DerivedInsight[] = [];
  const now = new Date().toISOString();

  const baseRoute = `/educator/assignment/${analytics.assignmentId}/student/${analytics.studentId}`;

  // Track if we have high-severity support needs (blocks positive insights)
  let hasHighSeveritySupportNeed = false;

  // ============================================
  // 1. MOVE_ON_EVENT (high priority, per question)
  // ============================================
  for (const q of analytics.questionAnalytics) {
    if (q.moveOnTriggered) {
      const stagnationLabel = q.stagnationReason
        ? STAGNATION_LABELS[q.stagnationReason] || q.stagnationReason
        : "limited progress";

      const insight: DerivedInsight = {
        id: createInsightId(analytics.attemptId, "MOVE_ON_EVENT", q.questionId),
        attemptId: analytics.attemptId,
        assignmentId: analytics.assignmentId,
        studentId: analytics.studentId,
        classId: analytics.classId,
        createdAt: now,
        type: "MOVE_ON_EVENT",
        severity: "high",
        scope: "question",
        questionId: q.questionId,
        title: "Moved on from a question",
        why: `The coach moved on after ${stagnationLabel}. Consider a brief follow-up on this concept.`,
        evidence: buildEvidence(q),
        suggestedActions: ["ADD_TODO", "INVITE_SUPPORT_SESSION", "REASSIGN_WITH_HINTS"],
        navigationTargets: {
          route: baseRoute,
          state: {
            scrollToSection: "question-review",
            highlightQuestionId: q.questionId,
          },
        },
      };
      insights.push(insight);
      hasHighSeveritySupportNeed = true;
    }
  }

  // ============================================
  // 2. MISCONCEPTION_FLAG (per question)
  // ============================================
  for (const q of analytics.questionAnalytics) {
    if (
      q.misconceptionDetected &&
      (q.misconceptionConfidence === "medium" || q.misconceptionConfidence === "high")
    ) {
      const misconceptionLabel = q.misconceptionType
        ? MISCONCEPTION_LABELS[q.misconceptionType] || q.misconceptionType
        : "a potential misconception";

      const severity: InsightSeverity =
        q.misconceptionConfidence === "high" ? "high" : "medium";

      if (severity === "high") {
        hasHighSeveritySupportNeed = true;
      }

      const insight: DerivedInsight = {
        id: createInsightId(analytics.attemptId, "MISCONCEPTION_FLAG", q.questionId),
        attemptId: analytics.attemptId,
        assignmentId: analytics.assignmentId,
        studentId: analytics.studentId,
        classId: analytics.classId,
        createdAt: now,
        type: "MISCONCEPTION_FLAG",
        severity,
        scope: "question",
        questionId: q.questionId,
        title: "Possible misconception",
        why: `Response suggests ${misconceptionLabel}. A targeted follow-up may help clarify understanding.`,
        evidence: buildEvidence(q),
        suggestedActions: ["ADD_TODO", "INVITE_SUPPORT_SESSION", "REASSIGN_WITH_HINTS"],
        navigationTargets: {
          route: baseRoute,
          state: {
            scrollToSection: "question-review",
            highlightQuestionId: q.questionId,
          },
        },
      };
      insights.push(insight);
    }
  }

  // ============================================
  // 3. NEEDS_SUPPORT (assignment level)
  // ============================================
  const needsSupport = checkNeedsSupport(analytics);
  if (needsSupport) {
    const severity: InsightSeverity =
      analytics.totals.moveOnsCount >= 1 || analytics.totals.misconceptionsCount >= 1
        ? "high"
        : "medium";

    if (severity === "high") {
      hasHighSeveritySupportNeed = true;
    }

    const insight: DerivedInsight = {
      id: createInsightId(analytics.attemptId, "NEEDS_SUPPORT"),
      attemptId: analytics.attemptId,
      assignmentId: analytics.assignmentId,
      studentId: analytics.studentId,
      classId: analytics.classId,
      createdAt: now,
      type: "NEEDS_SUPPORT",
      severity,
      scope: "assignment",
      title: "Needs support on this assignment",
      why: buildNeedsSupportWhy(analytics),
      evidence: {
        timeSpentMs: analytics.totals.totalTimeMs,
        hintCount: analytics.totals.totalHints,
        probeCount: analytics.totals.totalProbes,
        reframeCount: analytics.totals.totalReframes,
        moveOnTriggered: analytics.totals.moveOnsCount > 0,
      },
      suggestedActions: ["ADD_TODO", "INVITE_SUPPORT_SESSION", "REASSIGN_WITH_HINTS"],
      navigationTargets: {
        route: baseRoute,
        state: {
          scrollToSection: "overview",
        },
      },
    };
    insights.push(insight);
  }

  // ============================================
  // 4. CHECK_IN (assignment level)
  // ============================================
  const needsCheckIn = checkNeedsCheckIn(analytics);
  if (needsCheckIn && !needsSupport) {
    const insight: DerivedInsight = {
      id: createInsightId(analytics.attemptId, "CHECK_IN"),
      attemptId: analytics.attemptId,
      assignmentId: analytics.assignmentId,
      studentId: analytics.studentId,
      classId: analytics.classId,
      createdAt: now,
      type: "CHECK_IN",
      severity: "medium",
      scope: "assignment",
      title: "Check in recommended",
      why: "Progress shows developing understanding. A brief check-in could reinforce learning.",
      evidence: {
        timeSpentMs: analytics.totals.totalTimeMs,
        hintCount: analytics.totals.totalHints,
        probeCount: analytics.totals.totalProbes,
      },
      suggestedActions: ["ADD_TODO"],
      navigationTargets: {
        route: baseRoute,
        state: {
          scrollToSection: "overview",
        },
      },
    };
    insights.push(insight);
  }

  // ============================================
  // 5-7. Positive insights (blocked by high-severity support needs)
  // ============================================
  if (!hasHighSeveritySupportNeed) {
    // 5. EXTEND_LEARNING
    const extendLearning = checkExtendLearning(analytics);
    if (extendLearning) {
      const insight: DerivedInsight = {
        id: createInsightId(analytics.attemptId, "EXTEND_LEARNING"),
        attemptId: analytics.attemptId,
        assignmentId: analytics.assignmentId,
        studentId: analytics.studentId,
        classId: analytics.classId,
        createdAt: now,
        type: "EXTEND_LEARNING",
        severity: "low",
        scope: "assignment",
        title: "Extend learning",
        why: "Strong performance with minimal support suggests readiness for deeper exploration.",
        evidence: {
          timeSpentMs: analytics.totals.totalTimeMs,
          hintCount: analytics.totals.totalHints,
        },
        suggestedActions: ["INVITE_ENRICHMENT_SESSION", "AWARD_BADGE"],
        navigationTargets: {
          route: baseRoute,
          state: {
            scrollToSection: "overview",
          },
        },
      };
      insights.push(insight);
    }

    // 6. CHALLENGE_OPPORTUNITY
    const challengeOpportunity = checkChallengeOpportunity(analytics);
    if (challengeOpportunity && !extendLearning) {
      const insight: DerivedInsight = {
        id: createInsightId(analytics.attemptId, "CHALLENGE_OPPORTUNITY"),
        attemptId: analytics.attemptId,
        assignmentId: analytics.assignmentId,
        studentId: analytics.studentId,
        classId: analytics.classId,
        createdAt: now,
        type: "CHALLENGE_OPPORTUNITY",
        severity: "low",
        scope: "assignment",
        title: "Challenge opportunity",
        why: "Quick mastery with high accuracy indicates potential for more challenging material.",
        evidence: {
          timeSpentMs: analytics.totals.totalTimeMs,
          hintCount: analytics.totals.totalHints,
        },
        suggestedActions: ["INVITE_ENRICHMENT_SESSION", "AWARD_BADGE"],
        navigationTargets: {
          route: baseRoute,
          state: {
            scrollToSection: "overview",
          },
        },
      };
      insights.push(insight);
    }

    // 7. CELEBRATE_PROGRESS
    const celebrateProgress = checkCelebrateProgress(analytics);
    if (celebrateProgress && !extendLearning && !challengeOpportunity) {
      const insight: DerivedInsight = {
        id: createInsightId(analytics.attemptId, "CELEBRATE_PROGRESS"),
        attemptId: analytics.attemptId,
        assignmentId: analytics.assignmentId,
        studentId: analytics.studentId,
        classId: analytics.classId,
        createdAt: now,
        type: "CELEBRATE_PROGRESS",
        severity: "low",
        scope: "assignment",
        title: "Progress worth noting",
        why: "Showed persistence through difficulty and improved over the session.",
        evidence: {
          timeSpentMs: analytics.totals.totalTimeMs,
          hintCount: analytics.totals.totalHints,
          probeCount: analytics.totals.totalProbes,
          reframeCount: analytics.totals.totalReframes,
        },
        suggestedActions: ["AWARD_BADGE"],
        navigationTargets: {
          route: baseRoute,
          state: {
            scrollToSection: "overview",
          },
        },
      };
      insights.push(insight);
    }
  }

  // Sort by priority and limit to max insights
  const sorted = sortInsightsByPriority(insights);
  return sorted.slice(0, MAX_INSIGHTS_PER_ATTEMPT);
}

// ============================================
// Group Insights (assignment-level rollup)
// ============================================

export function deriveGroupInsights(assignmentId: string): GroupInsight[] {
  const allAnalytics = getAssignmentAnalytics(assignmentId);
  if (allAnalytics.length === 0) {
    return [];
  }

  const insights: GroupInsight[] = [];
  const now = new Date().toISOString();

  // Get all individual insights
  const studentInsightsMap = new Map<string, DerivedInsight[]>();
  for (const analytics of allAnalytics) {
    const studentInsights = deriveInsightsFromAttempt(analytics);
    const existing = studentInsightsMap.get(analytics.studentId) || [];
    studentInsightsMap.set(analytics.studentId, [...existing, ...studentInsights]);
  }

  // Count students with support needs
  const studentsNeedingSupport: string[] = [];
  const misconceptionsByType = new Map<string, string[]>();
  const moveOnsByQuestion = new Map<string, string[]>();

  for (const [studentId, insights] of studentInsightsMap) {
    for (const insight of insights) {
      if (insight.type === "NEEDS_SUPPORT" || insight.type === "MOVE_ON_EVENT") {
        if (!studentsNeedingSupport.includes(studentId)) {
          studentsNeedingSupport.push(studentId);
        }
      }

      if (insight.type === "MOVE_ON_EVENT" && insight.questionId) {
        const students = moveOnsByQuestion.get(insight.questionId) || [];
        if (!students.includes(studentId)) {
          students.push(studentId);
          moveOnsByQuestion.set(insight.questionId, students);
        }
      }

      if (insight.type === "MISCONCEPTION_FLAG" && insight.evidence.misconceptionType) {
        const students = misconceptionsByType.get(insight.evidence.misconceptionType) || [];
        if (!students.includes(studentId)) {
          students.push(studentId);
          misconceptionsByType.set(insight.evidence.misconceptionType, students);
        }
      }
    }
  }

  // Check for common misconceptions (3+ students)
  for (const [misconceptionType, studentIds] of misconceptionsByType) {
    if (studentIds.length >= 3) {
      const label = MISCONCEPTION_LABELS[misconceptionType] || misconceptionType;
      insights.push({
        id: `${assignmentId}:GROUP:misconception:${misconceptionType}`,
        assignmentId,
        classId: allAnalytics[0]?.classId || "",
        createdAt: now,
        type: "GROUP_SUPPORT_CANDIDATE",
        severity: "high",
        title: "Group review candidate",
        why: `${studentIds.length} students showed ${label}. A group review may be beneficial.`,
        affectedStudentIds: studentIds,
        commonMisconceptionType: misconceptionType,
        suggestedActions: ["ADD_TODO"],
        navigationTargets: {
          route: `/educator/assignment/${assignmentId}`,
          state: {},
        },
      });
    }
  }

  // Check for common question struggles (3+ students moved on)
  for (const [questionId, studentIds] of moveOnsByQuestion) {
    if (studentIds.length >= 3) {
      insights.push({
        id: `${assignmentId}:GROUP:question:${questionId}`,
        assignmentId,
        classId: allAnalytics[0]?.classId || "",
        createdAt: now,
        type: "GROUP_SUPPORT_CANDIDATE",
        severity: "high",
        title: "Group review candidate",
        why: `${studentIds.length} students needed to move on from the same question. Consider revisiting this concept.`,
        affectedStudentIds: studentIds,
        commonQuestionId: questionId,
        suggestedActions: ["ADD_TODO"],
        navigationTargets: {
          route: `/educator/assignment/${assignmentId}`,
          state: {
            highlightQuestionId: questionId,
          },
        },
      });
    }
  }

  // General support need group (3+ students need support)
  if (
    studentsNeedingSupport.length >= 3 &&
    insights.length === 0 // Only if we don't have a more specific group insight
  ) {
    insights.push({
      id: `${assignmentId}:GROUP:general`,
      assignmentId,
      classId: allAnalytics[0]?.classId || "",
      createdAt: now,
      type: "GROUP_SUPPORT_CANDIDATE",
      severity: "medium",
      title: "Group review candidate",
      why: `${studentsNeedingSupport.length} students showed difficulty with this assignment. A class review may help.`,
      affectedStudentIds: studentsNeedingSupport,
      suggestedActions: ["ADD_TODO"],
      navigationTargets: {
        route: `/educator/assignment/${assignmentId}`,
        state: {},
      },
    });
  }

  return insights;
}

// ============================================
// Get All Insights for Assignment (all students)
// ============================================

export function getAssignmentDerivedInsights(assignmentId: string): DerivedInsight[] {
  const allAnalytics = getAssignmentAnalytics(assignmentId);
  const allInsights: DerivedInsight[] = [];

  for (const analytics of allAnalytics) {
    const insights = deriveInsightsFromAttempt(analytics);
    allInsights.push(...insights);
  }

  return sortInsightsByPriority(allInsights);
}

// ============================================
// Get Insights for Specific Student Assignment
// ============================================

export function getStudentAssignmentDerivedInsights(
  assignmentId: string,
  studentId: string,
  includeResolved: boolean = false
): DerivedInsight[] {
  const allAnalytics = getAssignmentAnalytics(assignmentId);
  const studentAnalytics = allAnalytics.filter((a) => a.studentId === studentId);

  if (studentAnalytics.length === 0) {
    return [];
  }

  // Use the most recent attempt
  const latestAttempt = studentAnalytics.sort(
    (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
  )[0];

  const insights = deriveInsightsFromAttempt(latestAttempt);

  // Filter out resolved insights unless explicitly requested
  if (!includeResolved) {
    const resolvedIds = getResolvedInsightIds(assignmentId, studentId);

    // If all are resolved, return empty
    if (resolvedIds.includes("*")) {
      return [];
    }

    return insights.filter((insight) => !resolvedIds.includes(insight.id));
  }

  return insights;
}

// ============================================
// Helper: Build Evidence Object
// ============================================

function buildEvidence(q: QuestionAttemptAnalytics): InsightEvidence {
  return {
    timeSpentMs: q.timeSpentMs,
    hintCount: q.hintCount,
    probeCount: q.probeCount,
    reframeCount: q.reframeCount,
    moveOnTriggered: q.moveOnTriggered,
    misconceptionType: q.misconceptionType || undefined,
    correctnessEstimate: q.correctnessEstimate,
    confidenceEstimate: q.confidenceEstimate,
    supportLevelUsed: q.supportLevelUsed,
    studentTurnCount: q.studentTurnCount,
    questionIndex: q.questionIndex,
    outcomeTag: q.outcomeTag,
    stagnationReason: q.stagnationReason || undefined,
  };
}

// ============================================
// Helper: Check NEEDS_SUPPORT
// ============================================

function checkNeedsSupport(analytics: AssignmentAttemptAnalytics): boolean {
  // Condition 1: overallOutcome is "needs_support"
  if (analytics.overallOutcome === "needs_support") {
    return true;
  }

  // Condition 2: moveOnsCount >= 1
  if (analytics.totals.moveOnsCount >= 1) {
    return true;
  }

  // Condition 3: 2+ questions with incorrect/unknown AND guided/heavy_support
  let heavySupportIncorrectCount = 0;
  for (const q of analytics.questionAnalytics) {
    const isIncorrectOrUnknown =
      q.correctnessEstimate === "incorrect" || q.correctnessEstimate === "unknown";
    const isHeavySupport =
      q.supportLevelUsed === "guided" || q.supportLevelUsed === "heavy_support";

    if (isIncorrectOrUnknown && isHeavySupport) {
      heavySupportIncorrectCount++;
    }
  }

  return heavySupportIncorrectCount >= 2;
}

// ============================================
// Helper: Build NEEDS_SUPPORT "why" text
// ============================================

function buildNeedsSupportWhy(analytics: AssignmentAttemptAnalytics): string {
  const reasons: string[] = [];

  if (analytics.totals.moveOnsCount >= 1) {
    reasons.push(
      `moved on from ${analytics.totals.moveOnsCount} question${analytics.totals.moveOnsCount > 1 ? "s" : ""}`
    );
  }

  if (analytics.totals.misconceptionsCount >= 1) {
    reasons.push(
      `showed ${analytics.totals.misconceptionsCount} potential misconception${analytics.totals.misconceptionsCount > 1 ? "s" : ""}`
    );
  }

  if (analytics.overallSupportLevel === "high") {
    reasons.push("required significant support");
  }

  if (reasons.length === 0) {
    return "Multiple indicators suggest additional support would be helpful.";
  }

  const reasonText = reasons.join(" and ");
  return `Student ${reasonText}. A follow-up conversation could help address gaps.`;
}

// ============================================
// Helper: Check CHECK_IN
// ============================================

function checkNeedsCheckIn(analytics: AssignmentAttemptAnalytics): boolean {
  // Trigger if developing/mixed outcome, no move-ons, low/no misconceptions
  const isDevelopingOrMixed =
    analytics.overallOutcome === "developing" || analytics.overallOutcome === "mixed";

  const noMoveOns = analytics.totals.moveOnsCount === 0;
  const lowMisconceptions = analytics.totals.misconceptionsCount <= 1;

  return isDevelopingOrMixed && noMoveOns && lowMisconceptions;
}

// ============================================
// Helper: Check EXTEND_LEARNING
// ============================================

function checkExtendLearning(analytics: AssignmentAttemptAnalytics): boolean {
  if (analytics.questionAnalytics.length === 0) {
    return false;
  }

  // Count correct questions
  const correctCount = analytics.questionAnalytics.filter(
    (q) => q.correctnessEstimate === "correct" || q.correctnessEstimate === "partially_correct"
  ).length;

  const correctRatio = correctCount / analytics.questionAnalytics.length;

  // Check if mostly correct (>= 70%)
  if (correctRatio < 0.7) {
    return false;
  }

  // Check low hint usage (average < 1 hint per question)
  const avgHints = analytics.totals.totalHints / analytics.questionAnalytics.length;
  if (avgHints > 1) {
    return false;
  }

  // Check confidence is not low
  const lowConfidenceCount = analytics.questionAnalytics.filter(
    (q) => q.confidenceEstimate === "low"
  ).length;
  const lowConfidenceRatio = lowConfidenceCount / analytics.questionAnalytics.length;
  if (lowConfidenceRatio > 0.3) {
    return false;
  }

  return true;
}

// ============================================
// Helper: Check CHALLENGE_OPPORTUNITY
// ============================================

function checkChallengeOpportunity(analytics: AssignmentAttemptAnalytics): boolean {
  if (analytics.questionAnalytics.length === 0) {
    return false;
  }

  // Look for mastery_fast patterns
  const masteryFastCount = analytics.questionAnalytics.filter(
    (q) => q.outcomeTag === "mastery_fast"
  ).length;

  const masteryFastRatio = masteryFastCount / analytics.questionAnalytics.length;

  // >= 50% mastery_fast questions
  if (masteryFastRatio < 0.5) {
    return false;
  }

  // Very low hint usage (average < 0.5 hints per question)
  const avgHints = analytics.totals.totalHints / analytics.questionAnalytics.length;
  if (avgHints > 0.5) {
    return false;
  }

  // No move-ons
  if (analytics.totals.moveOnsCount > 0) {
    return false;
  }

  return true;
}

// ============================================
// Helper: Check CELEBRATE_PROGRESS
// ============================================

function checkCelebrateProgress(analytics: AssignmentAttemptAnalytics): boolean {
  if (analytics.questionAnalytics.length < 2) {
    return false;
  }

  // Pattern 1: Early incorrect then later correct with reduced support
  // Look for improvement trajectory
  let earlyStruggle = false;
  let laterSuccess = false;

  const halfPoint = Math.floor(analytics.questionAnalytics.length / 2);

  for (let i = 0; i < halfPoint; i++) {
    const q = analytics.questionAnalytics[i];
    if (
      q.correctnessEstimate === "incorrect" ||
      q.supportLevelUsed === "guided" ||
      q.supportLevelUsed === "heavy_support"
    ) {
      earlyStruggle = true;
      break;
    }
  }

  for (let i = halfPoint; i < analytics.questionAnalytics.length; i++) {
    const q = analytics.questionAnalytics[i];
    if (
      (q.correctnessEstimate === "correct" || q.correctnessEstimate === "partially_correct") &&
      (q.supportLevelUsed === "none" || q.supportLevelUsed === "light_probe")
    ) {
      laterSuccess = true;
      break;
    }
  }

  if (earlyStruggle && laterSuccess) {
    return true;
  }

  // Pattern 2: High probes/reframes but ends in mastery
  const highEffortCount = analytics.questionAnalytics.filter(
    (q) =>
      (q.probeCount >= 2 || q.reframeCount >= 1) &&
      (q.outcomeTag === "mastery_after_hint" || q.outcomeTag === "mastery_after_probe")
  ).length;

  if (highEffortCount >= 2) {
    return true;
  }

  return false;
}
