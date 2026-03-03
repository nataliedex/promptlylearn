/**
 * Recommendations API Routes
 *
 * Endpoints for the "What Should I Do Next?" teacher recommendation system.
 */

import { Router } from "express";
import { recommendationStore, RecommendationStore } from "../../stores/recommendationStore";
import { actionOutcomeStore } from "../../stores/actionOutcomeStore";
import {
  refreshRecommendations,
  generateRecommendations,
} from "../../domain/recommendationEngine";
import {
  StudentPerformanceData,
  AssignmentAggregateData,
  RECOMMENDATION_CONFIG,
  FeedbackType,
  BadgeType,
  BADGE_TYPES,
  isBadgeType,
  getBadgeTypeName,
  RecommendationStatus,
  ChecklistActionKey,
  CHECKLIST_ACTIONS,
  isValidChecklistActionKey,
  ChecklistActionEntry,
  SubmitChecklistRequest,
  SubmitChecklistResponse,
} from "../../domain/recommendation";
import { SessionStore } from "../../stores/sessionStore";
import { StudentStore } from "../../stores/studentStore";
import { ClassStore } from "../../stores/classStore";
import { StudentAssignmentStore } from "../../stores/studentAssignmentStore";
import { CoachSessionStore } from "../../stores/coachSessionStore";
import { getAllLessons } from "../../loaders/lessonLoader";
import {
  pushAssignmentBack,
  awardBadge,
  addTeacherNote,
} from "../../stores/actionHandlers";
import { teacherSettingsStore } from "../../stores/teacherSettingsStore";
import { teacherTodoStore } from "../../stores/teacherTodoStore";
import { TeacherTodo, RecommendationCategory } from "../../domain/teacherTodo";

// ============================================
// Assignment State Filtering (AUTHORITATIVE RULE)
// ============================================

/**
 * AUTHORITATIVE PRODUCT RULE:
 *
 * Recommended Actions shows ONLY recommendations that:
 * 1. Have a valid assignmentId
 * 2. Successfully map to at least one existing StudentAssignment
 * 3. Have at least one student where reviewState === "pending_review"
 *
 * Everything else is filtered out. No safety keeps. No ambiguous states.
 * If it is not actionable, it does not belong in Recommended Actions.
 *
 * "pending_review" is the ONLY actionable state.
 * All other states are filtered out:
 * - "not_started" (student hasn't submitted)
 * - "reviewed" (teacher already reviewed)
 * - "resolved" (completed with action)
 * - "followup_scheduled" (has pending follow-up)
 * - null/undefined (unknown state)
 * - missing assignment record
 * - missing assignmentId
 */
const ACTIONABLE_REVIEW_STATE = "pending_review";

/**
 * Filter decision result with detailed reason for logging and auto-resolution
 */
interface FilterDecision {
  keep: boolean;
  reason:
    | "has_pending_review"
    | "no_assignment_id"
    | "no_valid_assignments"
    | "all_non_pending";
  shouldAutoResolve: boolean;
}

/**
 * AUTHORITATIVE: Determine if a recommendation should be shown.
 *
 * Returns keep: true ONLY IF:
 * - rec.assignmentId exists AND
 * - At least one StudentAssignment record is found AND
 * - At least one has reviewState === "pending_review"
 *
 * Returns keep: false for ALL other cases (no safety keeps).
 */
function shouldKeepRecommendation(
  rec: ReturnType<typeof recommendationStore.getActive>[0],
  store: StudentAssignmentStore
): FilterDecision {
  // STRICT: No assignmentId → FILTER OUT
  if (!rec.assignmentId) {
    return {
      keep: false,
      reason: "no_assignment_id",
      shouldAutoResolve: true,
    };
  }

  let foundAnyAssignment = false;

  // Check each student in the recommendation
  for (const studentId of rec.studentIds) {
    const assignment = store.getAssignment(rec.assignmentId, studentId);

    if (!assignment) {
      // No assignment record found for this student - continue checking others
      continue;
    }

    foundAnyAssignment = true;

    // ONLY pending_review is actionable
    if (assignment.reviewState === ACTIONABLE_REVIEW_STATE) {
      return {
        keep: true,
        reason: "has_pending_review",
        shouldAutoResolve: false,
      };
    }
  }

  // STRICT: No valid assignment records found → FILTER OUT
  if (!foundAnyAssignment) {
    return {
      keep: false,
      reason: "no_valid_assignments",
      shouldAutoResolve: true,
    };
  }

  // All assignments exist but none are pending_review → FILTER OUT
  return {
    keep: false,
    reason: "all_non_pending",
    shouldAutoResolve: true,
  };
}

/**
 * AUTHORITATIVE: Filter recommendations to show ONLY actionable work.
 *
 * PRODUCT RULE: Recommended Actions is strictly
 * "Work that requires teacher action right now."
 *
 * It is NOT:
 * - A historical feed
 * - A general awareness list
 * - A soft suggestion panel
 *
 * Auto-resolves stale recommendations to prevent them from reappearing.
 */
function filterByAssignmentState(
  recommendations: ReturnType<typeof recommendationStore.getActive>,
  store: StudentAssignmentStore,
  enableLogging: boolean = process.env.NODE_ENV === "development"
): ReturnType<typeof recommendationStore.getActive> {
  let keptCount = 0;
  let filteredCount = 0;
  const autoResolvedIds: string[] = [];

  const result = recommendations.filter((rec) => {
    const decision = shouldKeepRecommendation(rec, store);

    if (enableLogging) {
      // Build detailed assignment state info for logging
      const assignmentStates = rec.studentIds.map((studentId) => {
        const assignment = rec.assignmentId
          ? store.getAssignment(rec.assignmentId, studentId)
          : null;
        return {
          studentId,
          foundAssignment: !!assignment,
          reviewState: assignment?.reviewState ?? null,
          isPendingReview: assignment?.reviewState === ACTIONABLE_REVIEW_STATE,
        };
      });

      console.log("[RecommendationFilter]", {
        recommendationId: rec.id,
        assignmentId: rec.assignmentId,
        ruleName: rec.triggerData?.ruleName,
        insightType: rec.insightType,
        status: rec.status,
        studentIds: rec.studentIds,
        assignmentStates,
        decision: decision.keep ? "KEEP" : "FILTER_OUT",
        reason: decision.reason,
      });

      // DEFENSIVE: Contract violation check
      if (decision.keep) {
        const hasPendingReview = assignmentStates.some((s) => s.isPendingReview);
        if (!hasPendingReview) {
          console.error(
            "[RecommendationFilter] CONTRACT VIOLATION: Recommendation kept without pending_review!",
            {
              recommendationId: rec.id,
              assignmentId: rec.assignmentId,
              assignmentStates,
            }
          );
        }
      }
    }

    if (decision.keep) {
      keptCount++;
    } else {
      filteredCount++;

      // AUTO-RESOLVE: Mark stale recommendations as resolved to prevent reappearing
      if (decision.shouldAutoResolve && rec.status === "active") {
        try {
          recommendationStore.markResolved(
            rec.id,
            "system-cleanup",
            "completed" // ResolutionStatus
          );
          autoResolvedIds.push(rec.id);
          if (enableLogging) {
            console.log(
              `[RecommendationFilter] Auto-resolved stale recommendation: ${rec.id} (reason: ${decision.reason})`
            );
          }
        } catch (err) {
          console.error(
            `[RecommendationFilter] Failed to auto-resolve ${rec.id}:`,
            err
          );
        }
      }
    }

    return decision.keep;
  });

  if (enableLogging) {
    console.log(
      `[RecommendationFilter] Summary: ${keptCount} kept, ${filteredCount} filtered, ${autoResolvedIds.length} auto-resolved (${recommendations.length} → ${result.length})`
    );
  }

  return result;
}

// ============================================
// Helper Functions
// ============================================

/**
 * Map recommendation rule name to human-readable category
 */
function getRuleCategory(ruleName: string): RecommendationCategory {
  switch (ruleName) {
    case "needs-support":
      return "Needs Support";
    case "developing":
      return "Developing";
    case "group-support":
      return "Group Support";
    case "ready-for-challenge":
      return "Ready for Challenge";
    case "notable-improvement":
      return "Celebrate Progress";
    case "watch-progress":
      return "Monitor";
    default:
      return "Needs Support"; // Default fallback
  }
}

// ============================================
// ReasonKey Computation (for Shared Issues grouping)
// ============================================

/**
 * Compute reason metadata for grouping recommendations on AssignmentReview.
 *
 * PRODUCT GOAL: Enable "Shared Issues" section on AssignmentReview that groups
 * students who share the same underlying issue. Dashboard shows individual cards.
 *
 * reasonKey format: `assignmentId::ruleName::subReason`
 * - assignmentId: The assignment this recommendation relates to
 * - ruleName: The detection rule (e.g., "needs-support", "developing")
 * - subReason: Finer-grained categorization based on trigger signals
 *
 * @returns { reasonKey, reasonLabel, reasonDetails }
 */
function computeReasonMetadata(rec: ReturnType<typeof recommendationStore.getActive>[0]): {
  reasonKey: string;
  reasonLabel: string;
  reasonDetails: string;
} {
  const assignmentId = rec.assignmentId || "unknown";
  const ruleName = rec.triggerData?.ruleName || "unknown";
  const signals = rec.triggerData?.signals || {};

  // Determine sub-reason based on rule and signals
  let subReason = "general";
  let reasonLabel = "";
  let reasonDetails = "";

  switch (ruleName) {
    case "needs-support": {
      // Sub-categorize by primary trigger: low score vs high hint usage
      const score = typeof signals.score === "number" ? signals.score : null;
      const hintRate = typeof signals.hintUsageRate === "number" ? signals.hintUsageRate : null;

      if (score !== null && score < 50) {
        subReason = "low_score";
        reasonLabel = "Needs Support: Low Score";
        reasonDetails = `Score ${score}% - may need additional instruction`;
      } else if (hintRate !== null && hintRate > 0.5) {
        subReason = "high_hints";
        reasonLabel = "Needs Support: Heavy Hint Usage";
        reasonDetails = `Used hints on ${Math.round(hintRate * 100)}% of questions`;
      } else {
        subReason = "general";
        reasonLabel = "Needs Support";
        reasonDetails = "Student may benefit from check-in";
      }
      break;
    }

    case "developing": {
      // Developing students: moderate performance with some scaffolding needs
      const score = typeof signals.score === "number" ? signals.score : null;
      subReason = "developing_range";
      reasonLabel = "Developing";
      reasonDetails = score !== null
        ? `Score ${score}% - progressing but may benefit from targeted practice`
        : "Making progress with some support needs";
      break;
    }

    case "group-support": {
      // Group support: multiple students with same issue
      const studentCount = typeof signals.studentCount === "number" ? signals.studentCount : rec.studentIds.length;
      subReason = "group_needs_support";
      reasonLabel = "Group Needs Support";
      reasonDetails = `${studentCount} students showing similar support needs`;
      break;
    }

    case "ready-for-challenge": {
      // Strong performance: ready for extension
      const score = typeof signals.score === "number" ? signals.score : null;
      subReason = "strong_performance";
      reasonLabel = "Ready for Challenge";
      reasonDetails = score !== null
        ? `Score ${score}% - ready for extension activities`
        : "Demonstrating mastery, ready for enrichment";
      break;
    }

    case "notable-improvement": {
      // Celebrate progress: significant score improvement
      const improvement = typeof signals.improvement === "number" ? signals.improvement : null;
      const previousScore = typeof signals.previousScore === "number" ? signals.previousScore : null;
      const currentScore = typeof signals.currentScore === "number" ? signals.currentScore : null;
      subReason = "improvement";
      reasonLabel = "Celebrate Progress";
      if (improvement !== null && previousScore !== null && currentScore !== null) {
        reasonDetails = `Improved from ${previousScore}% to ${currentScore}% (+${improvement} points)`;
      } else {
        reasonDetails = "Showed significant improvement";
      }
      break;
    }

    case "persistence": {
      // Persistence: completed despite challenges
      subReason = "persistence";
      reasonLabel = "Celebrate Persistence";
      reasonDetails = "Showed great persistence through difficulty";
      break;
    }

    case "watch-progress": {
      // Monitor: worth watching
      subReason = "monitor";
      reasonLabel = "Monitor";
      reasonDetails = "Situation worth monitoring";
      break;
    }

    default: {
      // Fallback for unknown rules
      subReason = "general";
      reasonLabel = ruleName.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
      reasonDetails = rec.reason || "Recommended for review";
    }
  }

  const reasonKey = `${assignmentId}::${ruleName}::${subReason}`;

  return { reasonKey, reasonLabel, reasonDetails };
}

// ============================================
// Deduplication: One Recommendation per (studentId, assignmentId)
// ============================================

/**
 * RULE PRIORITY for deduplication (highest = most urgent, pick first):
 *
 * 1. Coach moved on / move-on signals - student gave up or coach escalated
 * 2. Misconception detected - specific learning gap identified
 * 3. needs-support - low score or high hints, needs immediate attention
 * 4. developing - making progress but needs guidance
 * 5. persistence - completed despite difficulty (celebrate but lower urgency)
 * 6. notable-improvement / celebrate-progress - positive, lower urgency
 * 7. ready-for-challenge / extend learning - enrichment opportunity
 * 8. watch-progress / monitor - passive observation
 *
 * Tiebreaker: more recent completedAt, then stable sort by rec.id
 */
const RULE_PRIORITY: Record<string, number> = {
  // Highest priority (most urgent)
  "coach-moved-on": 100,
  "move-on": 100,
  // Misconception
  "misconception": 90,
  "misconception-detected": 90,
  // Needs support
  "needs-support": 80,
  "seed_needs_support": 80,
  "seed_group_support": 80,
  "check-in-suggested": 75,
  // Developing
  "developing": 60,
  // Persistence
  "persistence": 50,
  // Celebrate
  "notable-improvement": 40,
  "celebrate-progress": 40,
  // Extend learning
  "ready-for-challenge": 30,
  "challenge-opportunity": 30,
  "seed_extend_learning": 30,
  // Monitor (lowest)
  "watch-progress": 10,
  "monitor": 10,
};

/**
 * Get priority score for a recommendation based on rule and signals.
 * Higher = more urgent = should be kept when deduping.
 */
function getDedupeScore(rec: ReturnType<typeof recommendationStore.getActive>[0]): number {
  const ruleName = rec.triggerData?.ruleName || "";
  const signals = rec.triggerData?.signals || {};

  // Start with rule-based priority
  let score = RULE_PRIORITY[ruleName] ?? 20; // Default to 20 if unknown rule

  // Boost for specific signals that indicate urgency
  if (signals.movedOn === true || signals.coachMovedOn === true) {
    score = Math.max(score, 100); // Escalate to top priority
  }
  if (signals.misconception === true) {
    score = Math.max(score, 90);
  }

  // Boost for very low scores (more urgent)
  const rawScore = typeof signals.score === "number" ? signals.score : null;
  if (rawScore !== null && rawScore < 30) {
    score += 15; // Very low score boost
  } else if (rawScore !== null && rawScore < 50) {
    score += 5; // Low score boost
  }

  // Boost for very high hint usage
  const hintRate = typeof signals.hintUsageRate === "number" ? signals.hintUsageRate : null;
  if (hintRate !== null && hintRate > 0.8) {
    score += 10; // High hint usage boost
  }

  return score;
}

/**
 * Dedupe recommendations so each (studentId, assignmentId) appears at most once.
 *
 * For individual recommendations (studentIds.length === 1), group by studentId+assignmentId
 * and keep only the highest-priority one.
 *
 * @param recommendations - Array of recommendations (should already be filtered to individuals)
 * @param enableLogging - Log dedupe decisions in dev mode
 * @returns Deduplicated array
 */
function dedupeByStudentAssignment(
  recommendations: ReturnType<typeof recommendationStore.getActive>,
  enableLogging: boolean = false
): ReturnType<typeof recommendationStore.getActive> {
  // Group by (studentId, assignmentId)
  const groups = new Map<string, typeof recommendations>();

  for (const rec of recommendations) {
    // Only dedupe individual recommendations (group recs should be filtered out before this)
    if (rec.studentIds.length !== 1) continue;

    const studentId = rec.studentIds[0];
    const assignmentId = rec.assignmentId || "no-assignment";
    const key = `${studentId}::${assignmentId}`;

    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(rec);
  }

  // For each group, pick the highest priority recommendation
  const result: typeof recommendations = [];
  let dedupeCount = 0;

  for (const [key, recs] of groups) {
    if (recs.length === 1) {
      result.push(recs[0]);
      continue;
    }

    // Multiple recs for same student+assignment - need to pick one
    dedupeCount += recs.length - 1;

    // Sort by: dedupeScore DESC, then completedAt DESC, then id ASC (stable)
    recs.sort((a, b) => {
      const scoreA = getDedupeScore(a);
      const scoreB = getDedupeScore(b);
      if (scoreA !== scoreB) return scoreB - scoreA; // Higher score first

      // Tiebreaker: more recent completedAt
      const dateA = a.triggerData?.signals?.completedAt;
      const dateB = b.triggerData?.signals?.completedAt;
      if (dateA && dateB) {
        const timeA = new Date(dateA as string).getTime();
        const timeB = new Date(dateB as string).getTime();
        if (timeA !== timeB) return timeB - timeA; // More recent first
      }

      // Final tiebreaker: stable sort by id
      return (a.id || "").localeCompare(b.id || "");
    });

    const winner = recs[0];
    result.push(winner);

    if (enableLogging) {
      const [studentId, assignmentId] = key.split("::");
      const studentName = winner.triggerData?.signals?.studentName || studentId;
      console.log(
        `[Dedupe] ${studentName} + ${assignmentId.slice(0, 8)}...: kept "${winner.triggerData?.ruleName}" (score=${getDedupeScore(winner)}), dropped ${recs.length - 1} others:`,
        recs.slice(1).map((r) => `"${r.triggerData?.ruleName}" (score=${getDedupeScore(r)})`)
      );
    }
  }

  if (enableLogging && dedupeCount > 0) {
    console.log(`[Dedupe] Removed ${dedupeCount} duplicate recommendations (same student+assignment)`);
  }

  return result;
}

const router = Router();
const sessionStore = new SessionStore();
const studentStore = new StudentStore();
const classStore = new ClassStore();
const studentAssignmentStore = new StudentAssignmentStore();
const coachSessionStore = new CoachSessionStore();

// ============================================
// Data Gathering Helpers
// ============================================

/**
 * Gather student performance data from sessions and related sources
 */
function gatherStudentPerformanceData(): StudentPerformanceData[] {
  const students: StudentPerformanceData[] = [];
  const allSessions = sessionStore.getAll();
  const allStudents = studentStore.getAll();
  const lessons = getAllLessons();

  // Group sessions by student+assignment to get latest attempt
  const sessionsByKey = new Map<string, typeof allSessions>();
  for (const session of allSessions) {
    if (session.status !== "completed") continue;

    const key = `${session.studentId}-${session.lessonId}`;
    const existing = sessionsByKey.get(key) || [];
    existing.push(session);
    sessionsByKey.set(key, existing);
  }

  // Process each student+assignment combination
  for (const [key, sessions] of sessionsByKey) {
    // Sort by completion date, newest first
    sessions.sort((a, b) => {
      const aDate = new Date(a.completedAt || a.startedAt).getTime();
      const bDate = new Date(b.completedAt || b.startedAt).getTime();
      return bDate - aDate;
    });

    const latestSession = sessions[0];
    const previousSession = sessions[1];

    const student = allStudents.find((s) => s.id === latestSession.studentId);
    const lesson = lessons.find((l) => l.id === latestSession.lessonId);
    if (!student || !lesson) continue;

    // Calculate hint usage rate
    const responses = latestSession.submission?.responses || [];
    const hintsUsed = responses.filter((r) => r.hintUsed).length;
    const hintUsageRate = responses.length > 0 ? hintsUsed / responses.length : 0;

    // Get coach intent from coach sessions
    const coachInsights = coachSessionStore.getInsightsForStudent(student.id);
    const coachIntent = coachInsights?.intentLabel;

    // Check for teacher note
    const hasTeacherNote = !!latestSession.educatorNotes;

    // Get previous score if available (rounded to whole number)
    const previousScore = previousSession?.evaluation?.totalScore !== undefined
      ? Math.round(previousSession.evaluation.totalScore)
      : undefined;

    students.push({
      studentId: student.id,
      studentName: student.name,
      assignmentId: lesson.id,
      assignmentTitle: lesson.title,
      score: Math.round(latestSession.evaluation?.totalScore || 0),
      hintUsageRate,
      coachIntent,
      hasTeacherNote,
      completedAt: latestSession.completedAt?.toISOString?.() || latestSession.completedAt as unknown as string,
      previousScore,
    });
  }

  return students;
}

/**
 * Gather assignment aggregate data
 */
function gatherAssignmentAggregates(): AssignmentAggregateData[] {
  const aggregates: AssignmentAggregateData[] = [];
  const lessons = getAllLessons();
  const classes = classStore.getAll();
  const allSessions = sessionStore.getAll();

  for (const lesson of lessons) {
    for (const cls of classes) {
      // Get students in this class assigned to this lesson
      const assignedStudentIds = studentAssignmentStore.getAssignedStudentIds(lesson.id);
      const classStudentIds = cls.studentIds || [];
      const relevantStudentIds = assignedStudentIds.filter((id) => classStudentIds.includes(id));

      if (relevantStudentIds.length === 0) continue;

      // Get completed sessions for this lesson+class
      const completedSessions = allSessions.filter(
        (s) =>
          s.lessonId === lesson.id &&
          relevantStudentIds.includes(s.studentId) &&
          s.status === "completed"
      );

      // Group by student to get latest
      const latestByStudent = new Map<string, typeof completedSessions[0]>();
      for (const session of completedSessions) {
        const existing = latestByStudent.get(session.studentId);
        if (
          !existing ||
          new Date(session.completedAt || session.startedAt) >
            new Date(existing.completedAt || existing.startedAt)
        ) {
          latestByStudent.set(session.studentId, session);
        }
      }

      const latestSessions = Array.from(latestByStudent.values());
      const completedCount = latestSessions.length;
      const scores = latestSessions.map((s) => s.evaluation?.totalScore || 0);
      const averageScore =
        scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

      // Find students needing support
      const studentsNeedingSupport = latestSessions
        .filter((s) => (s.evaluation?.totalScore || 0) < RECOMMENDATION_CONFIG.STRUGGLING_THRESHOLD)
        .map((s) => s.studentId);

      // Calculate days since assigned (approximate - use first assignment date)
      const assignments = studentAssignmentStore.getAssignmentsByClass(lesson.id);
      const classAssignment = assignments.find((a) => a.classId === cls.id);
      const daysSinceAssigned = classAssignment
        ? Math.floor(
            (Date.now() - new Date(classAssignment.assignedAt).getTime()) / (1000 * 60 * 60 * 24)
          )
        : 0;

      aggregates.push({
        assignmentId: lesson.id,
        assignmentTitle: lesson.title,
        classId: cls.id,
        className: cls.name,
        studentCount: relevantStudentIds.length,
        completedCount,
        averageScore,
        studentsNeedingSupport,
        daysSinceAssigned,
      });
    }
  }

  return aggregates;
}

// ============================================
// API Endpoints
// ============================================

/**
 * GET /api/recommendations
 * Returns recommendations sorted by priority with optional status filtering
 *
 * Query params:
 * - status: "active" | "pending" | "resolved" | "all" (default: "active")
 * - limit: number (default: MAX_ACTIVE_RECOMMENDATIONS)
 * - assignmentId: string (optional filter)
 * - studentId: string (optional filter - matches recommendations containing this student)
 * - includeReviewed: "true" (legacy, same as status=all)
 */
router.get("/", (req, res) => {
  try {
    const { limit, assignmentId, studentId, includeReviewed, status } = req.query;

    let recommendations: ReturnType<typeof recommendationStore.getActive>;

    // Handle status filtering
    const statusFilter = status as RecommendationStatus | "all" | undefined;

    if (statusFilter === "all" || includeReviewed === "true") {
      // Return all recommendations
      recommendations = recommendationStore.getAll();
    } else if (statusFilter === "pending") {
      recommendations = recommendationStore.getByStatus("pending");
    } else if (statusFilter === "resolved") {
      recommendations = recommendationStore.getByStatus("resolved");
    } else if (statusFilter === "reviewed") {
      recommendations = recommendationStore.getByStatus("reviewed");
    } else if (statusFilter === "dismissed") {
      recommendations = recommendationStore.getByStatus("dismissed");
    } else {
      // Default: active only
      recommendations = recommendationStore.getActive();
    }

    // Filter by assignment if specified
    if (assignmentId && typeof assignmentId === "string") {
      recommendations = recommendations.filter((r) => r.assignmentId === assignmentId);
    }

    // Filter by student if specified (matches any recommendation that includes this student)
    if (studentId && typeof studentId === "string") {
      recommendations = recommendations.filter((r) => r.studentIds.includes(studentId));
    }

    // KEY FIX: Filter to show only recommendations with pending_review assignments
    // PRODUCT RULE: Recommended Actions shows only assignments awaiting teacher review
    // (reviewState === "pending_review"), not those already reviewed/resolved/scheduled
    if (statusFilter !== "all" && statusFilter !== "resolved") {
      recommendations = filterByAssignmentState(recommendations, studentAssignmentStore);
    }

    // ============================================
    // DASHBOARD-SPECIFIC FILTERING (for active/default status)
    // ============================================
    const isDashboardView = !statusFilter || statusFilter === "active";
    const enableDevLogging = process.env.NODE_ENV === "development";

    if (isDashboardView) {
      // RULE 1: Filter out GROUP recommendations (studentIds.length > 1)
      // Groups belong on Assignment page Shared Issues, not dashboard feed
      const beforeGroupFilter = recommendations.length;
      recommendations = recommendations.filter((rec) => rec.studentIds.length === 1);

      if (enableDevLogging && beforeGroupFilter !== recommendations.length) {
        console.log(
          `[Recommendations] Filtered out ${beforeGroupFilter - recommendations.length} group recommendations (dashboard shows individuals only)`
        );
      }

      // RULE 2: Dedupe by (studentId, assignmentId)
      // For same student+assignment, keep only the highest-priority recommendation
      // Priority order (highest to lowest):
      //   1. coachMovedOn / move-on signals (most urgent)
      //   2. misconception detected
      //   3. needs-support (low score / high hints)
      //   4. developing
      //   5. persistence
      //   6. celebrate progress / notable-improvement
      //   7. ready-for-challenge / extend learning
      recommendations = dedupeByStudentAssignment(recommendations, enableDevLogging);
    }

    // Sort by priority
    recommendations.sort((a, b) => b.priority - a.priority);

    // Apply limit
    const maxLimit = limit ? parseInt(limit as string, 10) : RECOMMENDATION_CONFIG.MAX_ACTIVE_RECOMMENDATIONS;
    recommendations = recommendations.slice(0, maxLimit);

    // Build lesson title lookup for enrichment (avoid per-rec queries)
    const lessons = getAllLessons();
    const lessonTitleMap = new Map(lessons.map((l) => [l.id, { title: l.title, subject: l.subject }]));

    // Add reason metadata AND ensure assignmentTitle is present
    const enrichedRecommendations = recommendations.map((rec) => {
      const { reasonKey, reasonLabel, reasonDetails } = computeReasonMetadata(rec);

      // Ensure assignmentTitle is in signals (for seeded/legacy recs that don't have it)
      let enrichedTriggerData = rec.triggerData;
      const signals = rec.triggerData?.signals || {};
      if (!signals.assignmentTitle && rec.assignmentId) {
        const lessonInfo = lessonTitleMap.get(rec.assignmentId);
        if (lessonInfo) {
          enrichedTriggerData = {
            ...rec.triggerData,
            signals: {
              ...signals,
              assignmentTitle: lessonInfo.title,
              subject: lessonInfo.subject,
            },
          };
        }
      }

      return {
        ...rec,
        triggerData: enrichedTriggerData,
        reasonKey,
        reasonLabel,
        reasonDetails,
      };
    });

    const stats = recommendationStore.getStats();

    res.json({
      recommendations: enrichedRecommendations,
      stats,
    });
  } catch (error) {
    console.error("Error fetching recommendations:", error);
    res.status(500).json({ error: "Failed to fetch recommendations" });
  }
});

/**
 * POST /api/recommendations/refresh
 * Regenerate recommendations from current data
 */
router.post("/refresh", (req, res) => {
  try {
    const students = gatherStudentPerformanceData();
    const aggregates = gatherAssignmentAggregates();

    const result = refreshRecommendations(students, aggregates, false);

    res.json({
      generated: result.generated,
      pruned: result.pruned,
      studentDataPoints: students.length,
      aggregateDataPoints: aggregates.length,
    });
  } catch (error) {
    console.error("Error refreshing recommendations:", error);
    res.status(500).json({ error: "Failed to refresh recommendations" });
  }
});

/**
 * POST /api/recommendations/:id/review
 * Mark a recommendation as reviewed
 */
router.post("/:id/review", (req, res) => {
  try {
    const { id } = req.params;
    const { reviewedBy } = req.body;

    const recommendation = recommendationStore.markReviewed(id, reviewedBy);

    if (!recommendation) {
      return res.status(404).json({ error: "Recommendation not found" });
    }

    res.json({ success: true, recommendation });
  } catch (error) {
    console.error("Error marking recommendation reviewed:", error);
    res.status(500).json({ error: "Failed to mark recommendation reviewed" });
  }
});

/**
 * POST /api/recommendations/:id/dismiss
 * Dismiss a recommendation (teacher chose to ignore)
 */
router.post("/:id/dismiss", (req, res) => {
  try {
    const { id } = req.params;

    const recommendation = recommendationStore.dismiss(id);

    if (!recommendation) {
      return res.status(404).json({ error: "Recommendation not found" });
    }

    res.json({ success: true, recommendation });
  } catch (error) {
    console.error("Error dismissing recommendation:", error);
    res.status(500).json({ error: "Failed to dismiss recommendation" });
  }
});

/**
 * POST /api/recommendations/:id/reactivate
 * Return a recommendation to active status (e.g., from pending or reviewed)
 */
router.post("/:id/reactivate", (req, res) => {
  try {
    const { id } = req.params;

    const recommendation = recommendationStore.reactivate(id);

    if (!recommendation) {
      return res.status(404).json({ error: "Recommendation not found" });
    }

    res.json({ success: true, recommendation });
  } catch (error) {
    console.error("Error reactivating recommendation:", error);
    res.status(500).json({ error: "Failed to reactivate recommendation" });
  }
});

/**
 * POST /api/recommendations/:id/feedback
 * Submit feedback on recommendation quality
 */
router.post("/:id/feedback", (req, res) => {
  try {
    const { id } = req.params;
    const { feedback, note } = req.body;

    if (!feedback || !["helpful", "not-helpful"].includes(feedback)) {
      return res.status(400).json({ error: "Invalid feedback value" });
    }

    const recommendation = recommendationStore.addFeedback(id, feedback as FeedbackType, note);

    if (!recommendation) {
      return res.status(404).json({ error: "Recommendation not found" });
    }

    res.json({ success: true, recommendation });
  } catch (error) {
    console.error("Error submitting feedback:", error);
    res.status(500).json({ error: "Failed to submit feedback" });
  }
});

/**
 * GET /api/recommendations/badge-types
 * Get available badge types
 * NOTE: This route must come BEFORE /:id to avoid being captured by the param route
 */
router.get("/badge-types", (req, res) => {
  try {
    const badgeTypes = [
      { id: "progress_star", name: "Progress Star", icon: "⭐", description: "Great effort and progress" },
      { id: "mastery_badge", name: "Mastery Badge", icon: "🏆", description: "Demonstrated understanding" },
      { id: "focus_badge", name: "Focus Badge", icon: "🎯", description: "Stayed on task" },
      { id: "creativity_badge", name: "Creativity Badge", icon: "💡", description: "Showed creative thinking" },
      { id: "collaboration_badge", name: "Collaboration Badge", icon: "🤝", description: "Helped others" },
    ];

    res.json({ badgeTypes });
  } catch (error) {
    console.error("Error fetching badge types:", error);
    res.status(500).json({ error: "Failed to fetch badge types" });
  }
});

/**
 * GET /api/recommendations/:id
 * Get a single recommendation by ID
 */
router.get("/:id", (req, res) => {
  try {
    const recommendation = recommendationStore.load(req.params.id);

    if (!recommendation) {
      return res.status(404).json({ error: "Recommendation not found" });
    }

    res.json(recommendation);
  } catch (error) {
    console.error("Error fetching recommendation:", error);
    res.status(500).json({ error: "Failed to fetch recommendation" });
  }
});

// ============================================
// Teacher Action Endpoints
// ============================================

/**
 * POST /api/recommendations/:id/actions/reassign
 * Push assignment back to student for retry
 */
router.post("/:id/actions/reassign", (req, res) => {
  try {
    const { id } = req.params;
    const { studentId, assignmentId, teacherId = "educator" } = req.body;

    if (!studentId || !assignmentId) {
      return res.status(400).json({ error: "studentId and assignmentId are required" });
    }

    // Get recommendation for previous score tracking
    const recommendation = recommendationStore.load(id);
    const previousScore = recommendation?.triggerData?.signals?.score;

    // Push assignment back
    pushAssignmentBack(studentId, assignmentId);

    // Create outcome with pending status (awaiting student retry)
    const outcome = actionOutcomeStore.save({
      recommendationId: id,
      actionType: "reassign",
      actedBy: teacherId,
      affectedStudentIds: [studentId],
      affectedAssignmentId: assignmentId,
      resolutionStatus: "pending",
      metadata: {
        previousScore: typeof previousScore === "number" ? previousScore : undefined,
      },
    });

    // Mark the recommendation as pending
    recommendationStore.markPending(id, outcome.id);

    res.json({
      success: true,
      action: "reassign",
      studentId,
      assignmentId,
      outcomeId: outcome.id,
      resolutionStatus: "pending",
    });
  } catch (error) {
    console.error("Error reassigning assignment:", error);
    res.status(500).json({ error: "Failed to reassign assignment" });
  }
});

/**
 * POST /api/recommendations/:id/actions/award-badge
 * Award a badge to student
 */
router.post("/:id/actions/award-badge", (req, res) => {
  try {
    const { id } = req.params;
    const { studentId, badgeType, message, assignmentId, teacherId = "educator" } = req.body;

    if (!studentId || !badgeType) {
      return res.status(400).json({ error: "studentId and badgeType are required" });
    }

    // Validate badge type
    if (!isBadgeType(badgeType)) {
      return res.status(400).json({
        error: `Invalid badge type: ${badgeType}. Valid types: ${Object.keys(BADGE_TYPES).join(", ")}`,
      });
    }

    // Award badge
    const badge = awardBadge(studentId, badgeType, assignmentId, teacherId, message);

    // Create outcome with completed status (no follow-up needed)
    const outcome = actionOutcomeStore.save({
      recommendationId: id,
      actionType: "award_badge",
      actedBy: teacherId,
      affectedStudentIds: [studentId],
      affectedAssignmentId: assignmentId,
      resolutionStatus: "completed",
      metadata: {
        badgeType,
        badgeMessage: message,
      },
    });

    // Mark the recommendation as resolved
    recommendationStore.markResolved(id, outcome.id, "completed");

    res.json({
      success: true,
      action: "award-badge",
      badge: {
        id: badge.id,
        type: badge.type,
        typeName: getBadgeTypeName(badge.type),
        message: badge.message,
      },
      outcomeId: outcome.id,
      resolutionStatus: "completed",
    });
  } catch (error) {
    console.error("Error awarding badge:", error);
    res.status(500).json({ error: "Failed to award badge" });
  }
});

/**
 * POST /api/recommendations/:id/actions/add-note
 * Add a teacher note to the insight
 */
router.post("/:id/actions/add-note", (req, res) => {
  try {
    const { id } = req.params;
    const { note, teacherId = "educator" } = req.body;

    if (!note) {
      return res.status(400).json({ error: "note is required" });
    }

    const recommendation = recommendationStore.load(id);
    if (!recommendation) {
      return res.status(404).json({ error: "Recommendation not found" });
    }

    // Add note to the insight (if insightId is available, otherwise create one)
    // For now we'll add note to all students in the recommendation
    for (const studentId of recommendation.studentIds) {
      try {
        // Create a simple note insight for each student
        addTeacherNote(`rec-${id}`, note, teacherId);
      } catch {
        // If insight doesn't exist, that's okay - note is still recorded
      }
    }

    // Create outcome with follow_up_needed status (teacher may want to revisit)
    const outcome = actionOutcomeStore.save({
      recommendationId: id,
      actionType: "add_note",
      actedBy: teacherId,
      affectedStudentIds: recommendation.studentIds,
      affectedAssignmentId: recommendation.assignmentId,
      resolutionStatus: "follow_up_needed",
      metadata: {
        noteText: note,
      },
    });

    // Mark the recommendation as resolved with follow_up_needed
    recommendationStore.markResolved(id, outcome.id, "follow_up_needed");

    res.json({
      success: true,
      action: "add-note",
      note,
      outcomeId: outcome.id,
      resolutionStatus: "follow_up_needed",
    });
  } catch (error) {
    console.error("Error adding note:", error);
    res.status(500).json({ error: "Failed to add note" });
  }
});

// ============================================
// Checklist Actions Endpoint
// ============================================

/**
 * POST /api/recommendations/:id/actions/submit-checklist
 * Submit selected checklist actions for a recommendation
 *
 * Request body:
 * - selectedActionKeys: string[] (stable action keys)
 * - noteText?: string (required if add_note is selected)
 * - badgeType?: string (required if award_badge is selected)
 * - badgeMessage?: string (optional message with badge)
 *
 * Response:
 * - success: boolean
 * - recommendation: Updated recommendation object
 * - actionEntries: Array of recorded action entries
 * - systemActionsExecuted: Array of system action keys that were executed
 * - newStatus: The new recommendation status
 */
router.post("/:id/actions/submit-checklist", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      selectedActionKeys,
      noteText,
      badgeType,
      badgeMessage,
      teacherId = "educator",
    } = req.body as SubmitChecklistRequest & { teacherId?: string };

    // Validate recommendation exists
    const recommendation = recommendationStore.load(id);
    if (!recommendation) {
      return res.status(404).json({ error: "Recommendation not found" });
    }

    // Validate selectedActionKeys is an array with at least one item
    if (!Array.isArray(selectedActionKeys) || selectedActionKeys.length === 0) {
      return res.status(400).json({
        error: "selectedActionKeys must be a non-empty array",
      });
    }

    // Validate all action keys
    const invalidKeys = selectedActionKeys.filter(key => !isValidChecklistActionKey(key));
    if (invalidKeys.length > 0) {
      return res.status(400).json({
        error: `Invalid action keys: ${invalidKeys.join(", ")}`,
        validKeys: Object.keys(CHECKLIST_ACTIONS),
      });
    }

    // Validate required fields for specific actions
    if (selectedActionKeys.includes("add_note") && !noteText) {
      return res.status(400).json({
        error: "noteText is required when add_note is selected",
      });
    }

    if (selectedActionKeys.includes("award_badge") && !badgeType) {
      return res.status(400).json({
        error: "badgeType is required when award_badge is selected",
      });
    }

    if (badgeType && !isBadgeType(badgeType)) {
      return res.status(400).json({
        error: `Invalid badge type: ${badgeType}`,
      });
    }

    const now = new Date().toISOString();
    const actionEntries: ChecklistActionEntry[] = [];
    const systemActionsExecuted: ChecklistActionKey[] = [];
    let createsPendingState = false;

    // Process each selected action
    for (const actionKey of selectedActionKeys as ChecklistActionKey[]) {
      const actionConfig = CHECKLIST_ACTIONS[actionKey];

      // Create action entry
      const entry: ChecklistActionEntry = {
        id: `${id}-${actionKey}-${Date.now()}`,
        recommendationId: id,
        actionKey,
        label: actionConfig.label,
        isSystemAction: actionConfig.isSystemAction,
        executedAt: now,
        executedBy: teacherId,
        metadata: {},
      };

      // Execute system actions
      if (actionConfig.isSystemAction) {
        switch (actionKey) {
          case "reassign_student":
            // Reassign to first student (single student recommendation)
            if (recommendation.studentIds.length > 0 && recommendation.assignmentId) {
              pushAssignmentBack(
                recommendation.studentIds[0],
                recommendation.assignmentId
              );
              entry.metadata = {
                affectedStudentIds: [recommendation.studentIds[0]],
                affectedAssignmentId: recommendation.assignmentId,
              };
              systemActionsExecuted.push(actionKey);
              createsPendingState = true;
            }
            break;

          case "assign_practice":
            // For grouped recommendations, this would push practice to all students
            // For now, mark as executed and create pending state
            if (recommendation.studentIds.length > 0 && recommendation.assignmentId) {
              // Push assignment back for all students in the group
              for (const studentId of recommendation.studentIds) {
                pushAssignmentBack(studentId, recommendation.assignmentId);
              }
              entry.metadata = {
                affectedStudentIds: recommendation.studentIds,
                affectedAssignmentId: recommendation.assignmentId,
              };
              systemActionsExecuted.push(actionKey);
              createsPendingState = true;
            }
            break;

          case "award_badge":
            // Award badge to first student
            if (recommendation.studentIds.length > 0 && badgeType) {
              awardBadge(
                recommendation.studentIds[0],
                badgeType as BadgeType,
                recommendation.assignmentId,
                teacherId,
                badgeMessage
              );
              entry.metadata = {
                badgeType,
                badgeMessage,
                affectedStudentIds: [recommendation.studentIds[0]],
              };
              systemActionsExecuted.push(actionKey);
            }
            break;

          case "add_note":
            if (noteText) {
              addTeacherNote(`rec-${id}`, noteText, teacherId);
              entry.metadata = {
                noteText,
                affectedStudentIds: recommendation.studentIds,
              };
              systemActionsExecuted.push(actionKey);
            }
            break;
        }
      }

      actionEntries.push(entry);
    }

    // ============================================
    // Create Teacher To-Dos for soft actions
    // ============================================
    const softActionEntries = actionEntries.filter(e => !e.isSystemAction);
    let createdTodos: TeacherTodo[] = [];

    if (softActionEntries.length > 0) {
      // Get context for the todos (student names, assignment title, class info)
      const studentNames = recommendation.triggerData.signals.studentName as string
        || recommendation.triggerData.signals.studentNames as string
        || recommendation.studentIds.join(", ");
      const assignmentTitle = recommendation.triggerData.signals.assignmentTitle as string
        || undefined;
      const className = recommendation.triggerData.signals.className as string
        || undefined;

      // Look up lesson to get subject
      let subject: string | undefined;
      if (recommendation.assignmentId) {
        const lessons = getAllLessons();
        const lesson = lessons.find(l => l.id === recommendation.assignmentId);
        if (lesson?.subject) {
          subject = lesson.subject;
        }
      }

      // Get category from recommendation rule
      const category = getRuleCategory(recommendation.triggerData.ruleName);

      // Create todos for each soft action
      const todoInputs = softActionEntries.map(entry => ({
        teacherId,
        recommendationId: id,
        actionKey: entry.actionKey,
        label: entry.label,
        category,
        assignmentId: recommendation.assignmentId,
        assignmentTitle,
        studentIds: recommendation.studentIds,
        studentNames,
        className,
        subject,
      }));

      createdTodos = teacherTodoStore.createMany(todoInputs);
    }

    // Determine new status
    // - If system actions were executed -> "pending" (awaiting student action)
    // - If only soft actions -> "resolved" (recommendation is handled, todos created)
    let newStatus: RecommendationStatus;
    if (createsPendingState) {
      newStatus = "pending";
    } else {
      newStatus = "resolved";
    }

    // Update the recommendation with submitted actions
    const submittedActions = actionEntries.map(entry => ({
      actionKey: entry.actionKey,
      label: entry.label,
      submittedAt: entry.executedAt,
      submittedBy: entry.executedBy,
    }));

    // Determine resolution status with proper typing
    const resolutionStatus = createsPendingState ? "pending" as const : "completed" as const;

    // Create action outcome
    const outcome = actionOutcomeStore.save({
      recommendationId: id,
      actionType: systemActionsExecuted.length > 0 ? systemActionsExecuted[0] as any : "mark_reviewed",
      actedBy: teacherId,
      affectedStudentIds: recommendation.studentIds,
      affectedAssignmentId: recommendation.assignmentId,
      resolutionStatus,
      metadata: {
        noteText,
        badgeType,
        badgeMessage,
      },
    });

    // Update recommendation status and store submitted actions
    const updatedRecommendation: typeof recommendation = {
      ...recommendation,
      status: newStatus,
      submittedActions: [
        ...(recommendation.submittedActions || []),
        ...submittedActions,
      ],
      outcomeId: outcome.id,
      resolutionStatus,
      resolvedAt: now,
      reviewedAt: now,
      reviewedBy: teacherId,
    };

    recommendationStore.save(updatedRecommendation);

    const response: SubmitChecklistResponse & { createdTodos?: TeacherTodo[] } = {
      success: true,
      recommendation: updatedRecommendation,
      actionEntries,
      systemActionsExecuted,
      newStatus,
      createdTodos: createdTodos.length > 0 ? createdTodos : undefined,
    };

    res.json(response);
  } catch (error) {
    console.error("Error submitting checklist actions:", error);
    res.status(500).json({ error: "Failed to submit checklist actions" });
  }
});

// ============================================
// Settings Endpoints
// ============================================

/**
 * GET /api/recommendations/settings/thresholds
 * Get current threshold settings (merged with defaults)
 */
router.get("/settings/thresholds", (req, res) => {
  try {
    const thresholds = teacherSettingsStore.getThresholds();
    const defaults = teacherSettingsStore.getDefaults();
    const rawSettings = teacherSettingsStore.getRawThresholds();

    res.json({
      current: thresholds,
      defaults,
      customized: rawSettings,
      isCustomized: Object.keys(rawSettings).length > 0,
    });
  } catch (error) {
    console.error("Error getting threshold settings:", error);
    res.status(500).json({ error: "Failed to get threshold settings" });
  }
});

/**
 * PUT /api/recommendations/settings/thresholds
 * Update threshold settings
 */
router.put("/settings/thresholds", (req, res) => {
  try {
    const { teacherId = "educator", ...thresholds } = req.body;

    // Validate that at least one threshold is provided
    const validKeys = [
      "needsSupportScore",
      "needsSupportHintThreshold",
      "developingUpper",
      "developingHintMin",
      "developingHintMax",
      "strongThreshold",
      "escalationHelpRequests",
    ];

    const updates: Record<string, number> = {};
    for (const key of validKeys) {
      if (thresholds[key] !== undefined) {
        updates[key] = thresholds[key];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        error: "No valid threshold settings provided",
        validKeys,
      });
    }

    teacherSettingsStore.updateThresholds(updates, teacherId);

    res.json({
      success: true,
      updated: updates,
      current: teacherSettingsStore.getThresholds(),
    });
  } catch (error) {
    console.error("Error updating threshold settings:", error);
    const message = error instanceof Error ? error.message : "Failed to update threshold settings";
    res.status(400).json({ error: message });
  }
});

/**
 * POST /api/recommendations/settings/thresholds/reset
 * Reset threshold settings to defaults
 */
router.post("/settings/thresholds/reset", (req, res) => {
  try {
    const { teacherId = "educator" } = req.body;

    teacherSettingsStore.resetThresholds(teacherId);

    res.json({
      success: true,
      message: "Threshold settings reset to defaults",
      current: teacherSettingsStore.getThresholds(),
    });
  } catch (error) {
    console.error("Error resetting threshold settings:", error);
    res.status(500).json({ error: "Failed to reset threshold settings" });
  }
});

export default router;
