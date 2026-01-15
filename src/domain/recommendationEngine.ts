/**
 * Recommendation Engine - Detection Rules and Logic
 *
 * This module contains the rule-based detection logic that analyzes
 * student performance data and generates actionable recommendations.
 *
 * Design principles:
 * - Rule-based for auditability and predictability
 * - Observable signals only (no inference about emotions/traits)
 * - Each recommendation includes audit trail data
 */

import { randomUUID } from "crypto";
import {
  Recommendation,
  RecommendationType,
  ConfidenceLevel,
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
  confidence: ConfidenceLevel,
  createdAt: string,
  studentCount: number
): number {
  const config = RECOMMENDATION_CONFIG;
  let priority = config.PRIORITY_BASE;

  // Type weight
  switch (type) {
    case "individual-checkin":
      priority += config.PRIORITY_INDIVIDUAL_CHECKIN;
      break;
    case "small-group":
      priority += config.PRIORITY_SMALL_GROUP;
      break;
    case "enrichment":
      priority += config.PRIORITY_ENRICHMENT;
      break;
    case "celebrate":
      priority += config.PRIORITY_CELEBRATE;
      break;
    case "assignment-adjustment":
      priority += config.PRIORITY_SMALL_GROUP; // Same as group
      break;
  }

  // Confidence weight
  switch (confidence) {
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
// Rule 1: Struggling Student (Individual Check-in)
// ============================================

function detectStrugglingStudents(students: StudentPerformanceData[]): Recommendation[] {
  const recommendations: Recommendation[] = [];
  const config = RECOMMENDATION_CONFIG;

  for (const student of students) {
    // Skip if teacher already left a note
    if (student.hasTeacherNote) continue;

    let triggered = false;
    let confidence: ConfidenceLevel = "medium";
    const signals: Record<string, any> = {
      score: student.score,
      hintUsageRate: student.hintUsageRate,
      coachIntent: student.coachIntent,
      hasTeacherNote: student.hasTeacherNote,
    };

    // Condition 1: Very low score
    if (student.score < config.STRUGGLING_THRESHOLD) {
      triggered = true;
      confidence = "high";
    }

    // Condition 2: Heavy hint usage with below-developing score
    if (
      student.hintUsageRate > config.HEAVY_HINT_USAGE &&
      student.score < config.DEVELOPING_THRESHOLD
    ) {
      triggered = true;
      confidence = "high";
    }

    // Condition 3: Support-seeking coach pattern with below-developing score
    if (student.coachIntent === "support-seeking" && student.score < 50) {
      triggered = true;
      if (confidence !== "high") confidence = "medium";
    }

    if (triggered) {
      // Check for duplicate
      if (recommendationStore.exists("struggling-student", [student.studentId], student.assignmentId)) {
        continue;
      }

      // Build context strings
      let hintContext = "";
      if (student.hintUsageRate > config.HEAVY_HINT_USAGE) {
        hintContext = ` with heavy hint usage (${Math.round(student.hintUsageRate * 100)}%)`;
      }

      let coachContext = "";
      if (student.coachIntent === "support-seeking") {
        coachContext = " and support-seeking coach interactions";
      }

      const now = new Date().toISOString();
      const rec: Recommendation = {
        id: randomUUID(),
        type: "individual-checkin",
        title: `Check in with ${student.studentName}`,
        reason: `Scored ${student.score}% on ${student.assignmentTitle}${hintContext}${coachContext}`,
        suggestedAction: "Review their responses and consider a brief conversation",
        confidence,
        priority: computePriority("individual-checkin", confidence, now, 1),
        studentIds: [student.studentId],
        assignmentId: student.assignmentId,
        triggerData: {
          ruleName: "struggling-student",
          signals,
          generatedAt: now,
        },
        status: "active",
        createdAt: now,
      };

      recommendations.push(rec);
    }
  }

  return recommendations;
}

// ============================================
// Rule 2: Small Group Intervention
// ============================================

function detectGroupStruggle(
  students: StudentPerformanceData[],
  aggregates: AssignmentAggregateData[]
): Recommendation[] {
  const recommendations: Recommendation[] = [];
  const config = RECOMMENDATION_CONFIG;

  for (const agg of aggregates) {
    // Need at least MIN_GROUP_SIZE students struggling
    if (agg.studentsNeedingSupport.length < config.MIN_GROUP_SIZE) continue;

    // Get student names for the struggling students
    const strugglingStudents = students.filter(
      (s) =>
        agg.studentsNeedingSupport.includes(s.studentId) && s.assignmentId === agg.assignmentId
    );

    if (strugglingStudents.length < config.MIN_GROUP_SIZE) continue;

    // Check for duplicate
    if (
      recommendationStore.exists("group-struggle", agg.studentsNeedingSupport, agg.assignmentId)
    ) {
      continue;
    }

    const studentNames = strugglingStudents.map((s) => s.studentName).join(", ");
    const avgScore = Math.round(
      strugglingStudents.reduce((sum, s) => sum + s.score, 0) / strugglingStudents.length
    );

    const now = new Date().toISOString();
    const rec: Recommendation = {
      id: randomUUID(),
      type: "small-group",
      title: `${strugglingStudents.length} students need support on ${agg.assignmentTitle}`,
      reason: `${studentNames} averaged ${avgScore}% on this assignment`,
      suggestedAction: "Consider a small group review session on this topic",
      confidence: "high",
      priority: computePriority("small-group", "high", now, strugglingStudents.length),
      studentIds: agg.studentsNeedingSupport,
      assignmentId: agg.assignmentId,
      triggerData: {
        ruleName: "group-struggle",
        signals: {
          studentCount: strugglingStudents.length,
          studentNames,
          averageScore: avgScore,
          className: agg.className,
        },
        generatedAt: now,
      },
      status: "active",
      createdAt: now,
    };

    recommendations.push(rec);
  }

  return recommendations;
}

// ============================================
// Rule 3: Enrichment Opportunity
// ============================================

function detectEnrichmentOpportunities(students: StudentPerformanceData[]): Recommendation[] {
  const recommendations: Recommendation[] = [];
  const config = RECOMMENDATION_CONFIG;

  for (const student of students) {
    let triggered = false;
    let confidence: ConfidenceLevel = "medium";

    // Condition: High score with minimal hints
    if (
      student.score >= config.EXCELLING_THRESHOLD &&
      student.hintUsageRate < config.MINIMAL_HINT_USAGE
    ) {
      triggered = true;

      // Boost confidence if also enrichment-seeking
      if (student.coachIntent === "enrichment-seeking") {
        confidence = "high";
      }
    }

    if (triggered) {
      // Check for duplicate
      if (
        recommendationStore.exists("ready-for-challenge", [student.studentId], student.assignmentId)
      ) {
        continue;
      }

      let coachContext = "";
      if (student.coachIntent === "enrichment-seeking") {
        coachContext = " and is actively seeking deeper learning";
      }

      const now = new Date().toISOString();
      const rec: Recommendation = {
        id: randomUUID(),
        type: "enrichment",
        title: `Challenge opportunity for ${student.studentName}`,
        reason: `Scored ${student.score}% with minimal help, showing mastery${coachContext}`,
        suggestedAction: "Consider offering extension activities or peer tutoring role",
        confidence,
        priority: computePriority("enrichment", confidence, now, 1),
        studentIds: [student.studentId],
        assignmentId: student.assignmentId,
        triggerData: {
          ruleName: "ready-for-challenge",
          signals: {
            score: student.score,
            hintUsageRate: student.hintUsageRate,
            coachIntent: student.coachIntent,
          },
          generatedAt: now,
        },
        status: "active",
        createdAt: now,
      };

      recommendations.push(rec);
    }
  }

  return recommendations;
}

// ============================================
// Rule 4: Notable Improvement (Celebrate)
// ============================================

function detectNotableImprovement(students: StudentPerformanceData[]): Recommendation[] {
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

      const now = new Date().toISOString();
      const rec: Recommendation = {
        id: randomUUID(),
        type: "celebrate",
        title: `Celebrate ${student.studentName}'s progress!`,
        reason: `Improved from ${student.previousScore}% to ${student.score}% on ${student.assignmentTitle}`,
        suggestedAction: "A quick recognition could reinforce their effort",
        confidence: "medium",
        priority: computePriority("celebrate", "medium", now, 1),
        studentIds: [student.studentId],
        assignmentId: student.assignmentId,
        triggerData: {
          ruleName: "notable-improvement",
          signals: {
            previousScore: student.previousScore,
            currentScore: student.score,
            improvement,
          },
          generatedAt: now,
        },
        status: "active",
        createdAt: now,
      };

      recommendations.push(rec);
    }
  }

  return recommendations;
}

// ============================================
// Rule 5: Assignment Difficulty Issue
// ============================================

function detectAssignmentIssues(aggregates: AssignmentAggregateData[]): Recommendation[] {
  const recommendations: Recommendation[] = [];

  for (const agg of aggregates) {
    // Conditions: low average + low completion + enough time has passed
    if (
      agg.averageScore < 50 &&
      agg.completedCount / agg.studentCount < 0.5 &&
      agg.daysSinceAssigned > 5
    ) {
      // Check for duplicate
      if (recommendationStore.exists("assignment-difficulty", [], agg.assignmentId)) {
        continue;
      }

      const completionRate = Math.round((agg.completedCount / agg.studentCount) * 100);

      const now = new Date().toISOString();
      const rec: Recommendation = {
        id: randomUUID(),
        type: "assignment-adjustment",
        title: `Review ${agg.assignmentTitle} difficulty`,
        reason: `Class average is ${Math.round(agg.averageScore)}% with ${completionRate}% completion after ${agg.daysSinceAssigned} days`,
        suggestedAction: "Consider adding scaffolding or breaking into smaller parts",
        confidence: "medium",
        priority: computePriority("assignment-adjustment", "medium", now, agg.studentCount),
        studentIds: [], // Assignment-level, not student-specific
        assignmentId: agg.assignmentId,
        triggerData: {
          ruleName: "assignment-difficulty",
          signals: {
            averageScore: agg.averageScore,
            completionRate,
            daysSinceAssigned: agg.daysSinceAssigned,
            studentCount: agg.studentCount,
            completedCount: agg.completedCount,
          },
          generatedAt: now,
        },
        status: "active",
        createdAt: now,
      };

      recommendations.push(rec);
    }
  }

  return recommendations;
}

// ============================================
// Main Engine Function
// ============================================

export interface GenerateRecommendationsResult {
  generated: Recommendation[];
  skippedDuplicates: number;
}

/**
 * Run all detection rules and generate recommendations
 *
 * @param students - Individual student performance data
 * @param aggregates - Assignment-level aggregate data
 * @returns Generated recommendations
 */
export function generateRecommendations(
  students: StudentPerformanceData[],
  aggregates: AssignmentAggregateData[]
): GenerateRecommendationsResult {
  const allRecommendations: Recommendation[] = [];

  // Run all detection rules
  const struggling = detectStrugglingStudents(students);
  const groups = detectGroupStruggle(students, aggregates);
  const enrichment = detectEnrichmentOpportunities(students);
  const improvements = detectNotableImprovement(students);
  const assignmentIssues = detectAssignmentIssues(aggregates);

  allRecommendations.push(
    ...struggling,
    ...groups,
    ...enrichment,
    ...improvements,
    ...assignmentIssues
  );

  // Save all new recommendations
  if (allRecommendations.length > 0) {
    recommendationStore.saveMany(allRecommendations);
  }

  return {
    generated: allRecommendations,
    skippedDuplicates: 0, // Duplicates are filtered within each rule
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
