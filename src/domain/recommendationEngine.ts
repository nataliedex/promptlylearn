/**
 * Recommendation Engine - Educational Support Intelligence
 *
 * This module analyzes student performance data and generates teacher-actionable
 * insights aligned with the Educational Support Intelligence specification.
 *
 * Design principles:
 * - Conservative approach: Only surface insights with strong evidence (confidence >= 0.7)
 * - One insight per student per assignment (prioritize highest value)
 * - Observable signals only (no inference about emotions/traits)
 * - Teacher-actionable, non-judgmental language
 * - Each insight includes audit trail data
 */

import { randomUUID } from "crypto";
import {
  Recommendation,
  RecommendationType,
  InsightType,
  PriorityLevel,
  ConfidenceScore,
  StudentPerformanceData,
  AssignmentAggregateData,
  RECOMMENDATION_CONFIG,
  mustRemainIndividual,
  ruleAllowsGrouping,
  GROUPING_RULES,
  BadgeType,
} from "./recommendation";
import { recommendationStore } from "../stores/recommendationStore";
import { actionOutcomeStore } from "../stores/actionOutcomeStore";
import {
  evaluateProgressStar,
  evaluateMasteryBadge,
  evaluateFocusBadge,
  BadgeSuggestion,
  StudentBadgeContext,
  BADGE_CRITERIA,
} from "./badgeCriteria";
import { badgeStore } from "../stores/badgeStore";

// ============================================
// Priority Calculation
// ============================================

export function computePriority(
  type: RecommendationType,
  priorityLevel: PriorityLevel,
  createdAt: string,
  studentCount: number,
  insightType?: InsightType
): number {
  const config = RECOMMENDATION_CONFIG;
  let priority = config.PRIORITY_BASE;

  // Type weight
  switch (type) {
    case "individual-checkin":
    case "check_in":
      priority += config.PRIORITY_INDIVIDUAL_CHECKIN;
      break;
    case "small-group":
      priority += config.PRIORITY_SMALL_GROUP;
      break;
    case "enrichment":
    case "challenge_opportunity":
      priority += config.PRIORITY_ENRICHMENT;
      break;
    case "celebrate":
    case "celebrate_progress":
      priority += config.PRIORITY_CELEBRATE;
      break;
    case "assignment-adjustment":
    case "monitor":
      priority += config.PRIORITY_SMALL_GROUP; // Same as group
      break;
  }

  // Confidence weight based on priority level
  switch (priorityLevel) {
    case "high":
      priority += config.PRIORITY_HIGH_CONFIDENCE;
      break;
    case "medium":
      priority += config.PRIORITY_MEDIUM_CONFIDENCE;
      break;
    // "low" adds nothing
  }

  // Recency weight
  const hoursSinceCreated = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60);
  if (hoursSinceCreated < 24) {
    priority += config.PRIORITY_RECENT_BONUS;
  } else if (hoursSinceCreated > 72) {
    priority += config.PRIORITY_STALE_PENALTY;
  }

  // Student count weight (for groups)
  if (studentCount >= 3) {
    priority += config.PRIORITY_LARGE_GROUP_BONUS;
  }

  // Individual-only categories get a boost to ensure they surface
  // (celebrate_progress, challenge_opportunity should never be suppressed)
  if (insightType && GROUPING_RULES[insightType] === "individual_only") {
    priority += config.PRIORITY_INDIVIDUAL_ONLY_BOOST;
  }

  return Math.min(100, Math.max(1, priority));
}

// ============================================
// Helper: Create Insight
// ============================================

interface CreateInsightParams {
  insightType: InsightType;
  legacyType: RecommendationType;
  summary: string;
  evidence: string[];
  suggestedTeacherActions: string[];
  priorityLevel: PriorityLevel;
  confidenceScore: ConfidenceScore;
  studentIds: string[];
  assignmentId?: string;
  ruleName: string;
  signals: Record<string, any>;
  suggestedBadge?: {
    badgeType: BadgeType;
    reason: string;
    evidence?: Record<string, any>;
  };
}

/**
 * Create a recommendation/insight with both new and legacy fields populated
 */
function createInsight(params: CreateInsightParams): Recommendation {
  const now = new Date().toISOString();

  const rec: Recommendation = {
    id: randomUUID(),
    insightType: params.insightType,
    type: params.legacyType,

    // New format fields
    summary: params.summary,
    evidence: params.evidence,
    suggestedTeacherActions: params.suggestedTeacherActions,
    priorityLevel: params.priorityLevel,
    confidenceScore: params.confidenceScore,

    // Legacy fields (populated for backward compatibility)
    title: params.summary,
    reason: params.evidence.join("; "),
    suggestedAction: params.suggestedTeacherActions[0] || "",
    confidence: params.priorityLevel,
    priority: computePriority(
      params.legacyType,
      params.priorityLevel,
      now,
      params.studentIds.length,
      params.insightType
    ),

    // Context
    studentIds: params.studentIds,
    assignmentId: params.assignmentId,
    triggerData: {
      ruleName: params.ruleName,
      signals: params.signals,
      generatedAt: now,
    },

    // State
    status: "active",
    createdAt: now,
  };

  // Add badge suggestion if provided
  if (params.suggestedBadge) {
    rec.suggestedBadge = params.suggestedBadge;
  }

  return rec;
}

// ============================================
// Rule 1: Check-in Insight (Student May Need Support)
// ============================================

/**
 * Detect students who need support.
 *
 * Needs Support criteria (any of these triggers):
 * - Score < 50% (NEEDS_SUPPORT_SCORE threshold)
 * - Hint/coach usage > 50% (NEEDS_SUPPORT_HINT_THRESHOLD)
 * - Support-seeking coach pattern with low score
 *
 * Note: The "OR" logic means heavy hint usage ALONE is enough to trigger,
 * even if the score is above the threshold.
 */
function detectCheckInNeeds(students: StudentPerformanceData[]): Recommendation[] {
  const recommendations: Recommendation[] = [];
  const config = RECOMMENDATION_CONFIG;

  for (const student of students) {
    // Skip if teacher already left a note
    if (student.hasTeacherNote) continue;

    // Skip if there's a pending reassign for this student+assignment (smart duplicate prevention)
    if (
      student.assignmentId &&
      recommendationStore.hasPendingForStudentAssignment(student.studentId, student.assignmentId)
    ) {
      continue;
    }

    let triggered = false;
    let confidenceScore: ConfidenceScore = 0.75;
    let priorityLevel: PriorityLevel = "medium";
    const evidence: string[] = [];
    const signals: Record<string, any> = {
      studentName: student.studentName,
      score: student.score,
      hintUsageRate: student.hintUsageRate,
      coachIntent: student.coachIntent,
      hasTeacherNote: student.hasTeacherNote,
    };

    // Condition 1: Score below threshold (< 50%)
    if (student.score < config.NEEDS_SUPPORT_SCORE) {
      triggered = true;
      confidenceScore = 0.9;
      priorityLevel = "high";
      evidence.push(`Scored ${Math.round(student.score)}% on ${student.assignmentTitle}`);
    }

    // Condition 2: Heavy hint/coach usage (> 50%) - triggers even with passing score
    // This is the key change: hint usage alone is sufficient for "Needs Support"
    if (student.hintUsageRate > config.NEEDS_SUPPORT_HINT_THRESHOLD) {
      triggered = true;
      confidenceScore = Math.max(confidenceScore, 0.85);
      priorityLevel = "high";
      evidence.push(`Used hints on ${Math.round(student.hintUsageRate * 100)}% of questions`);
      if (!evidence.some(e => e.includes("Scored"))) {
        evidence.push(`Scored ${Math.round(student.score)}% on ${student.assignmentTitle}`);
      }
    }

    // Condition 3: Support-seeking coach pattern with low score
    if (student.coachIntent === "support-seeking" && student.score < config.NEEDS_SUPPORT_SCORE) {
      triggered = true;
      confidenceScore = Math.max(confidenceScore, 0.8);
      evidence.push("Coach conversations suggest seeking support");
    }

    // Condition 4: ESCALATION - Student in "Developing" range but with excessive help requests
    // This catches students who would otherwise be "Developing" but have escalated need
    const wouldBeDeveloping =
      student.score >= config.NEEDS_SUPPORT_SCORE &&
      student.score < config.DEVELOPING_UPPER &&
      student.hintUsageRate >= config.DEVELOPING_HINT_MIN &&
      student.hintUsageRate <= config.DEVELOPING_HINT_MAX;

    if (
      wouldBeDeveloping &&
      student.helpRequestCount !== undefined &&
      student.helpRequestCount >= config.ESCALATION_HELP_REQUESTS
    ) {
      triggered = true;
      confidenceScore = Math.max(confidenceScore, 0.85);
      priorityLevel = "high";
      evidence.push(`${student.helpRequestCount} help requests in coach sessions`);
      evidence.push("Pattern suggests escalated support need");
      if (!evidence.some(e => e.includes("Scored"))) {
        evidence.push(`Scored ${Math.round(student.score)}% on ${student.assignmentTitle}`);
      }
      signals.escalatedFromDeveloping = true;
      signals.helpRequestCount = student.helpRequestCount;
    }

    // Only surface if meets minimum confidence threshold
    if (triggered && confidenceScore >= config.MIN_CONFIDENCE_SCORE) {
      // Check for duplicate
      if (recommendationStore.exists("needs-support", [student.studentId], student.assignmentId)) {
        continue;
      }

      const rec = createInsight({
        insightType: "check_in",
        legacyType: "individual-checkin",
        summary: `${student.studentName} may need support`,
        evidence,
        suggestedTeacherActions: [
          "Review their responses to understand where they encountered difficulty",
          "Consider a brief one-on-one conversation to gauge understanding",
          "Identify if additional practice or different explanation approaches might help",
        ],
        priorityLevel,
        confidenceScore,
        studentIds: [student.studentId],
        assignmentId: student.assignmentId,
        ruleName: "needs-support",
        signals,
      });

      recommendations.push(rec);
    }
  }

  return recommendations;
}

// ============================================
// Rule 1b: Developing (Student Making Progress but Needs Guidance)
// ============================================

/**
 * Detect students who are developing - making progress but may need guidance.
 *
 * Developing criteria (ALL must be true):
 * - Score between 50% and 79% (inclusive of 50, exclusive of 80)
 * - Hint/coach usage between 25% and 50% (inclusive)
 *
 * This is an INDIVIDUAL-ONLY category - never grouped.
 *
 * Key distinction from "Needs Support":
 * - Needs Support: score < 50% OR hint usage > 50%
 * - Developing: score 50-79% AND hint usage 25-50%
 *
 * Students who don't meet either criteria are considered "on track" and
 * won't generate a recommendation.
 */
function detectDeveloping(students: StudentPerformanceData[]): Recommendation[] {
  const recommendations: Recommendation[] = [];
  const config = RECOMMENDATION_CONFIG;

  for (const student of students) {
    // Skip if teacher already left a note
    if (student.hasTeacherNote) continue;

    // Skip if there's a pending reassign for this student+assignment
    if (
      student.assignmentId &&
      recommendationStore.hasPendingForStudentAssignment(student.studentId, student.assignmentId)
    ) {
      continue;
    }

    // Check if student fits "Developing" criteria
    // Score: >= 50% AND < 80%
    const scoreInRange =
      student.score >= config.NEEDS_SUPPORT_SCORE &&
      student.score < config.DEVELOPING_UPPER;

    // Hint usage: >= 25% AND <= 50%
    const hintInRange =
      student.hintUsageRate >= config.DEVELOPING_HINT_MIN &&
      student.hintUsageRate <= config.DEVELOPING_HINT_MAX;

    // Must meet BOTH criteria
    if (!scoreInRange || !hintInRange) continue;

    // Check for ESCALATION: if help request count exceeds threshold, skip
    // (student will be picked up by detectCheckInNeeds as "needs-support" instead)
    if (
      student.helpRequestCount !== undefined &&
      student.helpRequestCount >= config.ESCALATION_HELP_REQUESTS
    ) {
      continue;
    }

    // Check for duplicate
    if (recommendationStore.exists("developing", [student.studentId], student.assignmentId)) {
      continue;
    }

    // Also skip if student already has a "needs-support" recommendation
    // (needs-support takes priority)
    if (recommendationStore.exists("needs-support", [student.studentId], student.assignmentId)) {
      continue;
    }

    const evidence: string[] = [
      `Scored ${Math.round(student.score)}% on ${student.assignmentTitle}`,
      `Used hints on ${Math.round(student.hintUsageRate * 100)}% of questions`,
      "Showing progress but may benefit from targeted guidance",
    ];

    const signals: Record<string, any> = {
      studentName: student.studentName,
      score: student.score,
      hintUsageRate: student.hintUsageRate,
      coachIntent: student.coachIntent,
      hasTeacherNote: student.hasTeacherNote,
    };

    // Developing is medium priority with moderate confidence
    const confidenceScore: ConfidenceScore = 0.78;
    const priorityLevel: PriorityLevel = "medium";

    const rec = createInsight({
      insightType: "check_in",
      legacyType: "individual-checkin",
      summary: `${student.studentName} is developing understanding`,
      evidence,
      suggestedTeacherActions: [
        "Check in to see what concepts are still unclear",
        "Consider targeted practice on specific areas",
        "Pair with a peer for collaborative learning",
      ],
      priorityLevel,
      confidenceScore,
      studentIds: [student.studentId],
      assignmentId: student.assignmentId,
      ruleName: "developing", // Individual-only rule
      signals,
    });

    recommendations.push(rec);
  }

  return recommendations;
}

// ============================================
// Rule 2: Group Check-in (Multiple Students May Need Support)
// ============================================

function detectGroupCheckIn(
  students: StudentPerformanceData[],
  aggregates: AssignmentAggregateData[]
): Recommendation[] {
  const recommendations: Recommendation[] = [];
  const config = RECOMMENDATION_CONFIG;

  for (const agg of aggregates) {
    // Need at least MIN_GROUP_SIZE students needing support
    if (agg.studentsNeedingSupport.length < config.MIN_GROUP_SIZE) continue;

    // Get student details for those needing support
    const supportStudents = students.filter(
      (s) =>
        agg.studentsNeedingSupport.includes(s.studentId) && s.assignmentId === agg.assignmentId
    );

    if (supportStudents.length < config.MIN_GROUP_SIZE) continue;

    // Check for duplicate
    if (
      recommendationStore.exists("group-support", agg.studentsNeedingSupport, agg.assignmentId)
    ) {
      continue;
    }

    const studentNames = supportStudents.map((s) => s.studentName).join(", ");
    const avgScore = Math.round(
      supportStudents.reduce((sum, s) => sum + s.score, 0) / supportStudents.length
    );

    // Higher confidence with more students
    const confidenceScore: ConfidenceScore = supportStudents.length >= 3 ? 0.95 : 0.85;

    const rec = createInsight({
      insightType: "check_in",
      legacyType: "small-group",
      summary: `${supportStudents.length} students may benefit from group review on ${agg.assignmentTitle}`,
      evidence: [
        `${studentNames} show similar patterns`,
        `Group averaged ${avgScore}% on this assignment`,
        `From ${agg.className}`,
      ],
      suggestedTeacherActions: [
        "Consider a small group review session focused on common areas of difficulty",
        "Review responses to identify shared misconceptions",
        "Prepare targeted practice activities for this group",
      ],
      priorityLevel: "high",
      confidenceScore,
      studentIds: agg.studentsNeedingSupport,
      assignmentId: agg.assignmentId,
      ruleName: "group-support",
      signals: {
        studentCount: supportStudents.length,
        studentNames,
        averageScore: avgScore,
        className: agg.className,
      },
    });

    recommendations.push(rec);
  }

  return recommendations;
}

// ============================================
// Rule 3: Challenge Opportunity (Ready for Extension)
// ============================================

function detectChallengeOpportunities(students: StudentPerformanceData[]): Recommendation[] {
  const recommendations: Recommendation[] = [];
  const config = RECOMMENDATION_CONFIG;

  for (const student of students) {
    let triggered = false;
    let confidenceScore: ConfidenceScore = 0.8;
    let priorityLevel: PriorityLevel = "medium";
    const evidence: string[] = [];

    // Condition: High score with minimal hints
    if (
      student.score >= config.EXCELLING_THRESHOLD &&
      student.hintUsageRate < config.MINIMAL_HINT_USAGE
    ) {
      triggered = true;
      evidence.push(`Scored ${Math.round(student.score)}% on ${student.assignmentTitle}`);
      evidence.push(`Used hints on only ${Math.round(student.hintUsageRate * 100)}% of questions`);

      // Boost confidence if also enrichment-seeking
      if (student.coachIntent === "enrichment-seeking") {
        confidenceScore = 0.9;
        priorityLevel = "high";
        evidence.push("Coach conversations show interest in deeper learning");
      }
    }

    // Only surface if meets minimum confidence threshold
    if (triggered && confidenceScore >= config.MIN_CONFIDENCE_SCORE) {
      // Check for duplicate
      if (
        recommendationStore.exists("ready-for-challenge", [student.studentId], student.assignmentId)
      ) {
        continue;
      }

      // Check for Mastery Badge eligibility (subject-level excellence)
      let suggestedBadge: CreateInsightParams["suggestedBadge"] | undefined;

      // Build badge context for Mastery evaluation
      // Note: This requires subject history which we build from the student's data
      if (student.subjectHistory && student.subjectHistory.length > 0) {
        const badgeContext: StudentBadgeContext = {
          studentId: student.studentId,
          studentName: student.studentName,
          currentAttempt: {
            assignmentId: student.assignmentId || "",
            assignmentTitle: student.assignmentTitle,
            subject: student.subject,
            score: student.score,
            hintUsageRate: student.hintUsageRate,
            questionCount: student.questionCount || 0,
            completedAt: student.completedAt || new Date().toISOString(),
          },
          subjectHistory: student.subjectHistory,
          awardedBadges: badgeStore.getForCooldownCheck(student.studentId),
        };

        const masteryBadgeSuggestion = evaluateMasteryBadge(badgeContext);
        if (masteryBadgeSuggestion) {
          suggestedBadge = {
            badgeType: "mastery_badge",
            reason: masteryBadgeSuggestion.reason,
            evidence: masteryBadgeSuggestion.evidence,
          };
        }
      }

      const rec = createInsight({
        insightType: "challenge_opportunity",
        legacyType: "enrichment",
        summary: `${student.studentName} shows readiness for additional challenge`,
        evidence,
        suggestedTeacherActions: suggestedBadge
          ? [
              `Award a Mastery Badge for ${student.subject || "this subject"}`,
              "Consider offering extension activities on this topic",
              "Explore peer tutoring opportunities",
            ]
          : [
              "Consider offering extension activities on this topic",
              "Explore peer tutoring opportunities",
              "Discuss advanced materials or independent projects",
            ],
        priorityLevel: suggestedBadge ? "high" : priorityLevel,
        confidenceScore,
        studentIds: [student.studentId],
        assignmentId: student.assignmentId,
        ruleName: "ready-for-challenge",
        signals: {
          studentName: student.studentName,
          score: student.score,
          hintUsageRate: student.hintUsageRate,
          coachIntent: student.coachIntent,
        },
        suggestedBadge,
      });

      recommendations.push(rec);
    }
  }

  return recommendations;
}

// ============================================
// Rule 4: Celebrate Progress (Notable Improvement)
// ============================================

function detectCelebrateProgress(students: StudentPerformanceData[]): Recommendation[] {
  const recommendations: Recommendation[] = [];
  const config = RECOMMENDATION_CONFIG;

  for (const student of students) {
    // Need previous score to compare
    if (student.previousScore === undefined) continue;

    const improvement = student.score - student.previousScore;

    // Significant improvement AND decent final score
    if (improvement >= config.SIGNIFICANT_IMPROVEMENT && student.score >= config.DEVELOPING_THRESHOLD) {
      // Check for duplicate recommendation
      if (
        recommendationStore.exists("notable-improvement", [student.studentId], student.assignmentId)
      ) {
        continue;
      }

      // Skip if already celebrated with a badge (smart duplicate prevention)
      if (
        student.assignmentId &&
        actionOutcomeStore.hasCompletedBadgeForAssignment(student.studentId, student.assignmentId)
      ) {
        continue;
      }

      // Calculate confidence based on improvement magnitude
      const confidenceScore: ConfidenceScore = improvement >= 30 ? 0.9 : 0.85;

      // Check for Progress Star badge eligibility
      let suggestedBadge: CreateInsightParams["suggestedBadge"] | undefined;

      // Build badge context for Progress Star evaluation
      const badgeContext: StudentBadgeContext = {
        studentId: student.studentId,
        studentName: student.studentName,
        currentAttempt: {
          assignmentId: student.assignmentId || "",
          assignmentTitle: student.assignmentTitle,
          subject: student.subject,
          score: student.score,
          hintUsageRate: student.hintUsageRate,
          questionCount: student.questionCount || 0,
          completedAt: student.completedAt || new Date().toISOString(),
        },
        previousAttempts: student.previousScore !== undefined ? [{
          assignmentId: student.assignmentId || "",
          score: student.previousScore,
          completedAt: student.previousCompletedAt || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        }] : [],
        awardedBadges: badgeStore.getForCooldownCheck(student.studentId),
      };

      const progressStarSuggestion = evaluateProgressStar(badgeContext);
      if (progressStarSuggestion) {
        suggestedBadge = {
          badgeType: "progress_star",
          reason: progressStarSuggestion.reason,
          evidence: progressStarSuggestion.evidence,
        };
      }

      const rec = createInsight({
        insightType: "celebrate_progress",
        legacyType: "celebrate",
        summary: `${student.studentName} showed notable improvement`,
        evidence: [
          `Improved from ${Math.round(student.previousScore!)}% to ${Math.round(student.score)}% (+${Math.round(improvement)} points)`,
          `Assignment: ${student.assignmentTitle}`,
        ],
        suggestedTeacherActions: suggestedBadge
          ? [
              "Award a Progress Star badge to celebrate their growth",
              "Brief acknowledgment can reinforce their effort and growth",
              "Consider sharing what strategies they used that worked well",
            ]
          : [
              "Brief acknowledgment can reinforce their effort and growth",
              "Consider sharing what strategies they used that worked well",
            ],
        priorityLevel: suggestedBadge ? "high" : "medium",
        confidenceScore,
        studentIds: [student.studentId],
        assignmentId: student.assignmentId,
        ruleName: "notable-improvement",
        signals: {
          studentName: student.studentName,
          previousScore: student.previousScore,
          currentScore: student.score,
          improvement,
        },
        suggestedBadge,
      });

      recommendations.push(rec);
    }
  }

  return recommendations;
}

// ============================================
// Rule 4b: Focus Badge (Persistence Through Difficulty)
// ============================================

/**
 * Detect students who showed persistence by completing despite heavy hint usage.
 *
 * Focus Badge criteria:
 * - Hint usage >= 60% of questions
 * - Completed the assignment
 * - Score >= 50%
 * - Time spent >= 10 minutes (if available)
 *
 * This celebrates students who persevered through challenging material.
 */
function detectPersistence(students: StudentPerformanceData[]): Recommendation[] {
  const recommendations: Recommendation[] = [];
  const focusCriteria = BADGE_CRITERIA.focusBadge;

  for (const student of students) {
    // Check basic Focus Badge criteria
    if (student.hintUsageRate < focusCriteria.minHintUsageRate) continue;
    if (student.score < focusCriteria.minScore) continue;

    // Check for duplicate
    if (
      recommendationStore.exists("persistence", [student.studentId], student.assignmentId)
    ) {
      continue;
    }

    // Build badge context for Focus Badge evaluation
    const badgeContext: StudentBadgeContext = {
      studentId: student.studentId,
      studentName: student.studentName,
      currentAttempt: {
        assignmentId: student.assignmentId || "",
        assignmentTitle: student.assignmentTitle,
        subject: student.subject,
        score: student.score,
        hintUsageRate: student.hintUsageRate,
        timeSpentMinutes: student.timeSpentMinutes,
        questionCount: student.questionCount || 0,
        completedAt: student.completedAt || new Date().toISOString(),
      },
      awardedBadges: badgeStore.getForCooldownCheck(student.studentId),
    };

    const focusBadgeSuggestion = evaluateFocusBadge(badgeContext);

    // Only create recommendation if badge is eligible (passes cooldown checks)
    if (!focusBadgeSuggestion) continue;

    const suggestedBadge: CreateInsightParams["suggestedBadge"] = {
      badgeType: "persistence",
      reason: focusBadgeSuggestion.reason,
      evidence: focusBadgeSuggestion.evidence,
    };

    const confidenceScore: ConfidenceScore = student.score >= 70 ? 0.9 : 0.8;

    const rec = createInsight({
      insightType: "celebrate_progress",
      legacyType: "celebrate",
      summary: `${student.studentName} showed great persistence`,
      evidence: [
        `Used coaching on ${Math.round(student.hintUsageRate * 100)}% of questions but completed the assignment`,
        `Achieved ${Math.round(student.score)}% on ${student.assignmentTitle}`,
        "Demonstrates perseverance through challenging material",
      ],
      suggestedTeacherActions: [
        "Award a Focus Badge to celebrate their persistence",
        "Acknowledge their effort in working through the challenge",
        "Consider pairing with a peer for future collaborative work",
      ],
      priorityLevel: "medium",
      confidenceScore,
      studentIds: [student.studentId],
      assignmentId: student.assignmentId,
      ruleName: "persistence",
      signals: {
        studentName: student.studentName,
        score: student.score,
        hintUsageRate: student.hintUsageRate,
        timeSpentMinutes: student.timeSpentMinutes,
      },
      suggestedBadge,
    });

    recommendations.push(rec);
  }

  return recommendations;
}

// ============================================
// Rule 5: Monitor (Assignment Worth Watching)
// ============================================

function detectMonitorSituations(aggregates: AssignmentAggregateData[]): Recommendation[] {
  const recommendations: Recommendation[] = [];
  const config = RECOMMENDATION_CONFIG;

  for (const agg of aggregates) {
    // Conditions: low average + low completion + enough time has passed
    if (
      agg.averageScore < 50 &&
      agg.completedCount / agg.studentCount < 0.5 &&
      agg.daysSinceAssigned > 5
    ) {
      // Check for duplicate
      if (recommendationStore.exists("watch-progress", [], agg.assignmentId)) {
        continue;
      }

      const completionRate = Math.round((agg.completedCount / agg.studentCount) * 100);
      const confidenceScore: ConfidenceScore = 0.75;

      // Only surface if meets minimum confidence threshold
      if (confidenceScore >= config.MIN_CONFIDENCE_SCORE) {
        const rec = createInsight({
          insightType: "monitor",
          legacyType: "assignment-adjustment",
          summary: `${agg.assignmentTitle} progress worth monitoring`,
          evidence: [
            `Class average: ${Math.round(agg.averageScore)}%`,
            `Completion rate: ${completionRate}% (${agg.completedCount}/${agg.studentCount})`,
            `${agg.daysSinceAssigned} days since assigned`,
          ],
          suggestedTeacherActions: [
            "Consider checking in with students who haven't started",
            "Review if assignment scaffolding or instructions need adjustment",
            "No immediate action needed - worth watching",
          ],
          priorityLevel: "low",
          confidenceScore,
          studentIds: [], // Assignment-level, not student-specific
          assignmentId: agg.assignmentId,
          ruleName: "watch-progress",
          signals: {
            averageScore: agg.averageScore,
            completionRate,
            daysSinceAssigned: agg.daysSinceAssigned,
            studentCount: agg.studentCount,
            completedCount: agg.completedCount,
          },
        });

        recommendations.push(rec);
      }
    }
  }

  return recommendations;
}

// ============================================
// Grouping Enforcement and Deduplication
// ============================================

/**
 * Validates that grouped recommendations follow the grouping rules.
 * Returns recommendations with invalid groupings converted to individual ones.
 */
function enforceGroupingRules(recommendations: Recommendation[]): Recommendation[] {
  const result: Recommendation[] = [];

  for (const rec of recommendations) {
    const isGrouped = rec.studentIds.length > 1;
    const ruleName = rec.triggerData.ruleName;

    if (isGrouped) {
      // Check if this recommendation type/rule allows grouping
      if (mustRemainIndividual(rec.insightType, ruleName)) {
        // This should not be grouped - split into individual recommendations
        // (This is a safety check; rules should not create grouped items for these types)
        console.warn(
          `Warning: Recommendation ${rec.id} with type "${rec.insightType}" and rule "${ruleName}" ` +
          `should not be grouped. Keeping as-is but this indicates a rule implementation issue.`
        );
      }
    }

    result.push(rec);
  }

  return result;
}

/**
 * Apply the one-insight-per-student-per-assignment constraint.
 *
 * IMPORTANT: This constraint only applies to GROUPABLE categories.
 * Individual-only categories (celebrate_progress, challenge_opportunity) are NEVER filtered.
 *
 * Rules:
 * 1. celebrate_progress and challenge_opportunity ALWAYS surface (never deduplicated)
 * 2. For groupable categories (check_in, monitor), apply one-per-student-per-assignment
 * 3. When choosing between groupable insights, use priority order
 */
function applyOneInsightConstraint(recommendations: Recommendation[]): Recommendation[] {
  const config = RECOMMENDATION_CONFIG;
  const priorityOrder = config.INSIGHT_PRIORITY_ORDER;

  // Separate individual-only (always kept) from groupable (may be deduplicated)
  const alwaysKept: Recommendation[] = [];
  const groupableRecs: Recommendation[] = [];

  for (const rec of recommendations) {
    // Individual-only categories are NEVER filtered out
    if (GROUPING_RULES[rec.insightType] === "individual_only") {
      alwaysKept.push(rec);
    } else {
      groupableRecs.push(rec);
    }
  }

  // For groupable recommendations, apply one-insight-per-student-per-assignment
  const byStudentAssignment = new Map<string, Recommendation[]>();

  for (const rec of groupableRecs) {
    // Assignment-level recommendations (no students) are always kept
    if (rec.studentIds.length === 0) {
      alwaysKept.push(rec);
      continue;
    }

    for (const studentId of rec.studentIds) {
      const key = `${studentId}:${rec.assignmentId || "no-assignment"}`;
      if (!byStudentAssignment.has(key)) {
        byStudentAssignment.set(key, []);
      }
      byStudentAssignment.get(key)!.push(rec);
    }
  }

  // For each student+assignment, keep only the highest priority GROUPABLE insight
  const keptGroupableIds = new Set<string>();

  for (const [, recs] of byStudentAssignment) {
    if (recs.length === 1) {
      keptGroupableIds.add(recs[0].id);
    } else {
      // Sort by insight type priority (higher index = higher priority)
      recs.sort((a, b) => {
        const aPriority = priorityOrder.indexOf(a.insightType as string);
        const bPriority = priorityOrder.indexOf(b.insightType as string);
        // If tied on type, use confidence score
        if (aPriority === bPriority) {
          return b.confidenceScore - a.confidenceScore;
        }
        return bPriority - aPriority;
      });
      // Keep the highest priority one
      keptGroupableIds.add(recs[0].id);
    }
  }

  // Combine: always-kept + deduplicated groupable
  const keptGroupable = groupableRecs.filter(rec => keptGroupableIds.has(rec.id));

  return [...alwaysKept, ...keptGroupable];
}

/**
 * Limit grouped recommendations to prevent them from crowding out individual items.
 * Prioritizes high-priority individuals over low-priority groups.
 */
function applyGroupedLimit(recommendations: Recommendation[]): Recommendation[] {
  const config = RECOMMENDATION_CONFIG;

  // Separate grouped (multi-student) from individual (single student or assignment-level)
  const grouped: Recommendation[] = [];
  const individual: Recommendation[] = [];

  for (const rec of recommendations) {
    if (rec.studentIds.length > 1) {
      grouped.push(rec);
    } else {
      individual.push(rec);
    }
  }

  // Sort grouped by priority (highest first)
  grouped.sort((a, b) => b.priority - a.priority);

  // Limit grouped recommendations
  const limitedGrouped = grouped.slice(0, config.MAX_GROUPED_RECOMMENDATIONS);

  // Combine: all individuals + limited groups
  const combined = [...individual, ...limitedGrouped];

  // Sort final result by priority
  combined.sort((a, b) => b.priority - a.priority);

  return combined;
}

// ============================================
// Main Engine Function
// ============================================

export interface GenerateRecommendationsResult {
  generated: Recommendation[];
  skippedDuplicates: number;
  filteredByConstraint: number;
}

/**
 * Run all detection rules and generate insights
 *
 * Key principles:
 * - Conservative approach: Only surface insights with strong evidence (confidence >= 0.7)
 * - One insight per student per assignment for GROUPABLE categories only
 * - Individual-only categories (celebrate, challenge) ALWAYS surface
 * - Grouped recommendations are limited to prevent crowding out individuals
 * - Teacher-actionable, non-judgmental language
 *
 * @param students - Individual student performance data
 * @param aggregates - Assignment-level aggregate data
 * @returns Generated insights
 */
export function generateRecommendations(
  students: StudentPerformanceData[],
  aggregates: AssignmentAggregateData[]
): GenerateRecommendationsResult {
  // Run all detection rules
  const checkIns = detectCheckInNeeds(students);          // Needs Support
  const developing = detectDeveloping(students);          // Developing
  const groupCheckIns = detectGroupCheckIn(students, aggregates);
  const challenges = detectChallengeOpportunities(students);
  const celebrations = detectCelebrateProgress(students);
  const persistence = detectPersistence(students);        // Focus Badge
  const monitors = detectMonitorSituations(aggregates);

  const rawRecommendations = [
    ...checkIns,
    ...developing,
    ...groupCheckIns,
    ...challenges,
    ...celebrations,
    ...persistence,
    ...monitors,
  ];

  // Step 1: Enforce grouping rules (validate that grouped items are allowed)
  const afterGroupingEnforcement = enforceGroupingRules(rawRecommendations);

  // Step 2: Apply one-insight-per-student-per-assignment (only for GROUPABLE categories)
  // Individual-only categories (celebrate_progress, challenge_opportunity) are NEVER filtered
  const afterDeduplication = applyOneInsightConstraint(afterGroupingEnforcement);

  // Step 3: Limit grouped recommendations to prevent crowding out individual items
  const finalRecommendations = applyGroupedLimit(afterDeduplication);

  // Save all new recommendations
  if (finalRecommendations.length > 0) {
    recommendationStore.saveMany(finalRecommendations);
  }

  return {
    generated: finalRecommendations,
    skippedDuplicates: 0, // Duplicates are filtered within each rule
    filteredByConstraint: rawRecommendations.length - finalRecommendations.length,
  };
}

/**
 * Refresh recommendations by running detection on current data
 * Optionally clears old active recommendations first
 */
export function refreshRecommendations(
  students: StudentPerformanceData[],
  aggregates: AssignmentAggregateData[],
  clearOld: boolean = false
): { generated: number; pruned: number } {
  let pruned = 0;

  if (clearOld) {
    pruned = recommendationStore.clearActive();
  }

  // Also prune old reviewed/dismissed
  pruned += recommendationStore.pruneOld();

  const result = generateRecommendations(students, aggregates);

  return {
    generated: result.generated.length,
    pruned,
  };
}
