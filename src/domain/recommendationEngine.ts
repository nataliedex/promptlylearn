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
} from "./recommendation";
import { recommendationStore } from "../stores/recommendationStore";

// ============================================
// Priority Calculation
// ============================================

export function computePriority(
  type: RecommendationType,
  priorityLevel: PriorityLevel,
  createdAt: string,
  studentCount: number
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
}

/**
 * Create a recommendation/insight with both new and legacy fields populated
 */
function createInsight(params: CreateInsightParams): Recommendation {
  const now = new Date().toISOString();

  return {
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
    priority: computePriority(params.legacyType, params.priorityLevel, now, params.studentIds.length),

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
}

// ============================================
// Rule 1: Check-in Insight (Student May Need Support)
// ============================================

function detectCheckInNeeds(students: StudentPerformanceData[]): Recommendation[] {
  const recommendations: Recommendation[] = [];
  const config = RECOMMENDATION_CONFIG;

  for (const student of students) {
    // Skip if teacher already left a note
    if (student.hasTeacherNote) continue;

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

    // Condition 1: Very low score
    if (student.score < config.STRUGGLING_THRESHOLD) {
      triggered = true;
      confidenceScore = 0.9;
      priorityLevel = "high";
      evidence.push(`Scored ${student.score}% on ${student.assignmentTitle}`);
    }

    // Condition 2: Heavy hint usage with below-developing score
    if (
      student.hintUsageRate > config.HEAVY_HINT_USAGE &&
      student.score < config.DEVELOPING_THRESHOLD
    ) {
      triggered = true;
      confidenceScore = Math.max(confidenceScore, 0.85);
      priorityLevel = "high";
      evidence.push(`Used hints on ${Math.round(student.hintUsageRate * 100)}% of questions`);
      if (!evidence.some(e => e.includes("Scored"))) {
        evidence.push(`Scored ${student.score}% on ${student.assignmentTitle}`);
      }
    }

    // Condition 3: Support-seeking coach pattern with below-developing score
    if (student.coachIntent === "support-seeking" && student.score < 50) {
      triggered = true;
      confidenceScore = Math.max(confidenceScore, 0.8);
      evidence.push("Coach conversations suggest seeking support");
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
        summary: `${student.studentName} may benefit from a check-in`,
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
      evidence.push(`Scored ${student.score}% on ${student.assignmentTitle}`);
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

      const rec = createInsight({
        insightType: "challenge_opportunity",
        legacyType: "enrichment",
        summary: `${student.studentName} shows readiness for additional challenge`,
        evidence,
        suggestedTeacherActions: [
          "Consider offering extension activities on this topic",
          "Explore peer tutoring opportunities",
          "Discuss advanced materials or independent projects",
        ],
        priorityLevel,
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
      // Check for duplicate
      if (
        recommendationStore.exists("notable-improvement", [student.studentId], student.assignmentId)
      ) {
        continue;
      }

      // Calculate confidence based on improvement magnitude
      const confidenceScore: ConfidenceScore = improvement >= 30 ? 0.9 : 0.85;

      const rec = createInsight({
        insightType: "celebrate_progress",
        legacyType: "celebrate",
        summary: `${student.studentName} showed notable improvement`,
        evidence: [
          `Improved from ${student.previousScore}% to ${student.score}% (+${improvement} points)`,
          `Assignment: ${student.assignmentTitle}`,
        ],
        suggestedTeacherActions: [
          "Brief acknowledgment can reinforce their effort and growth",
          "Consider sharing what strategies they used that worked well",
        ],
        priorityLevel: "medium",
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
      });

      recommendations.push(rec);
    }
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
// One Insight Per Student Per Assignment
// ============================================

/**
 * Apply the one-insight-per-student-per-assignment constraint.
 * When multiple insights exist for the same student on the same assignment,
 * keep only the highest priority one.
 */
function applyOneInsightConstraint(recommendations: Recommendation[]): Recommendation[] {
  const config = RECOMMENDATION_CONFIG;
  const priorityOrder = config.INSIGHT_PRIORITY_ORDER;

  // Group by student+assignment
  const byStudentAssignment = new Map<string, Recommendation[]>();

  for (const rec of recommendations) {
    for (const studentId of rec.studentIds) {
      const key = `${studentId}:${rec.assignmentId || "no-assignment"}`;
      if (!byStudentAssignment.has(key)) {
        byStudentAssignment.set(key, []);
      }
      byStudentAssignment.get(key)!.push(rec);
    }
  }

  // For each student+assignment, keep only the highest priority insight
  const keptIds = new Set<string>();

  for (const [, recs] of byStudentAssignment) {
    if (recs.length === 1) {
      keptIds.add(recs[0].id);
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
      keptIds.add(recs[0].id);
    }
  }

  // Return only kept recommendations (plus any assignment-level ones with no students)
  return recommendations.filter(
    rec => keptIds.has(rec.id) || rec.studentIds.length === 0
  );
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
 * - One insight per student per assignment (prioritize highest value)
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
  const allRecommendations: Recommendation[] = [];

  // Run all detection rules
  const checkIns = detectCheckInNeeds(students);
  const groupCheckIns = detectGroupCheckIn(students, aggregates);
  const challenges = detectChallengeOpportunities(students);
  const celebrations = detectCelebrateProgress(students);
  const monitors = detectMonitorSituations(aggregates);

  const beforeConstraint = [
    ...checkIns,
    ...groupCheckIns,
    ...challenges,
    ...celebrations,
    ...monitors,
  ];

  // Apply one-insight-per-student-per-assignment constraint
  const afterConstraint = applyOneInsightConstraint(beforeConstraint);
  allRecommendations.push(...afterConstraint);

  // Save all new recommendations
  if (allRecommendations.length > 0) {
    recommendationStore.saveMany(allRecommendations);
  }

  return {
    generated: allRecommendations,
    skippedDuplicates: 0, // Duplicates are filtered within each rule
    filteredByConstraint: beforeConstraint.length - afterConstraint.length,
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
