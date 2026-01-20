/**
 * Action Handlers
 *
 * Simple, direct methods for mutating domain objects.
 * These handlers provide the exact interface requested for teacher and student actions.
 *
 * All methods:
 * - Mutate the underlying data stores
 * - Ensure dashboard summaries update dynamically
 * - Maintain full audit trails via TeacherAction objects
 */

import { StudentStore } from "./studentStore";
import { SessionStore } from "./sessionStore";
import { InsightStore } from "./insightStore";
import { TeacherActionStore } from "./teacherActionStore";
import { AssignmentStudentStore } from "./assignmentStudentStore";
import { BadgeStore } from "./badgeStore";
import { ClassStore } from "./classStore";

import { Student } from "../domain/student";
import { Insight, InsightType, InsightPriority, InsightStatus } from "../domain/insight";
import { TeacherAction, TeacherActionType, Badge, BadgeType, getBadgeTypeName, isBadgeType, RECOMMENDATION_CONFIG } from "../domain/recommendation";
import { AssignmentStudent } from "../domain/studentAssignment";
import { loadLessonById } from "../loaders/lessonLoader";
import { DASHBOARD_CONFIG, calculateUnderstandingLevel, StudentUnderstandingLevel } from "../domain/dashboard";

// ============================================
// Store Instances
// ============================================

const studentStore = new StudentStore();
const sessionStore = new SessionStore();
const insightStore = new InsightStore();
const teacherActionStore = new TeacherActionStore();
const assignmentStudentStore = new AssignmentStudentStore();
const badgeStore = new BadgeStore();
const classStore = new ClassStore();

// ============================================
// ID Generation Helper
// ============================================

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// ============================================
// TEACHER ACTIONS
// ============================================

/**
 * Mark an insight as reviewed.
 * - Updates Insight.status to action_taken
 * - Creates a TeacherAction object linked to the Insight
 * - Removes the insight from dashboard pending list
 */
export function markInsightReviewed(insightId: string, teacherId: string): void {
  // Update insight status
  const insight = insightStore.markActionTaken(insightId, teacherId);
  if (!insight) {
    throw new Error(`Insight not found: ${insightId}`);
  }

  // Create teacher action record
  const action: TeacherAction = {
    id: generateId("ta"),
    insightId,
    teacherId,
    actionType: "mark_reviewed",
    createdAt: new Date(),
  };
  teacherActionStore.save(action);
}

/**
 * Push an assignment back to a student for retry.
 * - Creates a new AssignmentStudent attempt
 * - Tracks previous attempts
 * - Most recent attempt appears first in dashboard tables
 */
export function pushAssignmentBack(studentId: string, assignmentId: string): void {
  // Load existing record
  let record = assignmentStudentStore.load(studentId, assignmentId);

  if (!record) {
    // Create new record if none exists
    record = {
      studentId,
      assignmentId,
      attempts: 1,
      currentAttempt: 1,
    };
  } else {
    // Increment attempts and reset completion for retry
    record.attempts = (record.attempts || 0) + 1;
    record.currentAttempt = record.attempts;
    // Clear last completion to allow retry, but keep historical data
    record.lastCompletedAt = undefined;
    record.score = undefined;
  }

  assignmentStudentStore.save(record);

  // Create a monitoring insight for this reassignment
  const student = studentStore.load(studentId);
  const lesson = loadLessonById(assignmentId);

  const insight: Insight = {
    id: generateId("insight"),
    studentId,
    assignmentId,
    classId: student?.classes?.[0] || "",
    type: "check_in",
    priority: "medium",
    confidence: 1.0,
    summary: `Assignment "${lesson?.title || assignmentId}" pushed back for retry`,
    evidence: ["Teacher requested student retry assignment"],
    suggestedActions: ["Monitor student progress on retry"],
    status: "monitoring",
    createdAt: new Date(),
  };
  insightStore.save(insight);
}

/**
 * Add a teacher note to an insight.
 * - Updates the TeacherAction.note
 * - Creates TeacherAction if none exists
 * - Note is reflected in educator and student summaries
 */
export function addTeacherNote(insightId: string, note: string, teacherId: string = "educator"): void {
  // Check if insight exists
  const insight = insightStore.load(insightId);
  if (!insight) {
    throw new Error(`Insight not found: ${insightId}`);
  }

  // Check for existing action on this insight
  const existingActions = teacherActionStore.getByInsight(insightId);

  if (existingActions.length > 0) {
    // Update existing action with note
    const lastAction = existingActions[0]; // Most recent
    const updatedAction: TeacherAction = {
      ...lastAction,
      note: lastAction.note ? `${lastAction.note}\n\n[${new Date().toISOString().split("T")[0]}] ${note}` : note,
    };
    teacherActionStore.save(updatedAction);
  } else {
    // Create new action with note
    const action: TeacherAction = {
      id: generateId("ta"),
      insightId,
      teacherId,
      actionType: "add_note",
      note,
      createdAt: new Date(),
    };
    teacherActionStore.save(action);
  }

  // Also update the student's notes if this is about a specific student
  if (insight.studentId) {
    const student = studentStore.load(insight.studentId);
    if (student) {
      const timestamp = new Date().toISOString().split("T")[0];
      student.notes = student.notes
        ? `${student.notes}\n\n[${timestamp}] ${note}`
        : `[${timestamp}] ${note}`;
      studentStore.save(student);
    }
  }
}

/**
 * Award a badge to a student.
 * - Creates a Badge object linked to the student
 * - Optionally links to assignmentId
 * - Adds badge to student's record
 */
export function awardBadge(
  studentId: string,
  badgeType: string,
  assignmentId?: string,
  teacherId: string = "educator",
  message?: string
): Badge {
  // Validate student exists
  const student = studentStore.load(studentId);
  if (!student) {
    throw new Error(`Student not found: ${studentId}`);
  }

  // Validate/default badge type
  const validBadgeType: BadgeType = isBadgeType(badgeType) ? badgeType : "progress_star";

  // Create badge
  const badge: Badge = {
    id: generateId("badge"),
    studentId,
    awardedBy: teacherId,
    type: validBadgeType,
    message,
    assignmentId,
    issuedAt: new Date(),
  };
  badgeStore.save(badge);

  // Create teacher action for audit trail
  const action: TeacherAction = {
    id: generateId("ta"),
    insightId: "", // Will create insight below
    teacherId,
    actionType: "award_badge",
    note: `Awarded ${getBadgeTypeName(validBadgeType)} badge${message ? `: ${message}` : ""}`,
    createdAt: new Date(),
  };

  // Create celebrate_progress insight
  const insight: Insight = {
    id: generateId("insight"),
    studentId,
    assignmentId,
    classId: student.classes?.[0] || "",
    type: "celebrate_progress",
    priority: "low",
    confidence: 1.0,
    summary: `${student.name} awarded ${getBadgeTypeName(validBadgeType)} badge`,
    evidence: [`Badge awarded by ${teacherId}`],
    suggestedActions: [],
    status: "action_taken",
    createdAt: new Date(),
    reviewedAt: new Date(),
    reviewedBy: teacherId,
  };
  insightStore.save(insight);

  action.insightId = insight.id;
  teacherActionStore.save(action);

  return badge;
}

// ============================================
// STUDENT ACTIONS
// ============================================

/**
 * Complete an assignment.
 * - Updates AssignmentStudent.attempts, lastCompletedAt, score
 * - Triggers insight generation for flagged areas
 */
export function completeAssignment(
  studentId: string,
  assignmentId: string,
  answers: { promptId: string; response: string; hintUsed?: boolean }[],
  score?: number
): AssignmentStudent {
  // Validate student and lesson exist
  const student = studentStore.load(studentId);
  if (!student) {
    throw new Error(`Student not found: ${studentId}`);
  }

  const lesson = loadLessonById(assignmentId);
  if (!lesson) {
    throw new Error(`Assignment not found: ${assignmentId}`);
  }

  // Calculate score if not provided (simple: % of answers provided)
  const calculatedScore = score ?? Math.round((answers.filter(a => a.response.length > 0).length / lesson.prompts.length) * 100);

  // Count hints used
  const hintsUsed = answers.filter(a => a.hintUsed).length;
  const hintUsageRate = lesson.prompts.length > 0 ? hintsUsed / lesson.prompts.length : 0;

  // Load existing record to check for improvement
  const existingRecord = assignmentStudentStore.load(studentId, assignmentId);
  const previousScore = existingRecord?.highestScore || existingRecord?.score;

  // Complete the attempt
  const record = assignmentStudentStore.completeAttempt(studentId, assignmentId, calculatedScore);

  // Record hint usage
  if (hintsUsed > 0) {
    assignmentStudentStore.recordHintUsage(studentId, assignmentId, hintsUsed);
  }

  // Generate insights based on performance
  generateInsightsFromCompletion(
    student,
    lesson,
    record,
    calculatedScore,
    hintsUsed,
    hintUsageRate,
    previousScore
  );

  // Reload to get updated record
  return assignmentStudentStore.load(studentId, assignmentId)!;
}

/**
 * Generate insights from assignment completion
 */
function generateInsightsFromCompletion(
  student: Student,
  lesson: { id: string; title: string; subject?: string; prompts: any[] },
  record: AssignmentStudent,
  score: number,
  hintsUsed: number,
  hintUsageRate: number,
  previousScore?: number
): void {
  const classId = student.classes?.[0] || "";
  const isImprovement = previousScore !== undefined && score > previousScore;
  const improvementAmount = previousScore !== undefined ? score - previousScore : 0;

  // Check for existing insights to avoid duplicates
  const existingCheckIn = insightStore.findExisting(student.id, lesson.id, "check_in");
  const existingCelebrate = insightStore.findExisting(student.id, lesson.id, "celebrate_progress");
  const existingChallenge = insightStore.findExisting(student.id, lesson.id, "challenge_opportunity");

  // 1. Check-in needed: Low score or heavy hint usage
  if (
    (score < RECOMMENDATION_CONFIG.STRUGGLING_THRESHOLD ||
      (hintUsageRate > RECOMMENDATION_CONFIG.HEAVY_HINT_USAGE && score < RECOMMENDATION_CONFIG.DEVELOPING_THRESHOLD)) &&
    !existingCheckIn
  ) {
    const evidence: string[] = [];
    if (score < RECOMMENDATION_CONFIG.STRUGGLING_THRESHOLD) {
      evidence.push(`Score of ${score}% is below expected threshold`);
    }
    if (hintUsageRate > RECOMMENDATION_CONFIG.HEAVY_HINT_USAGE) {
      evidence.push(`Used hints on ${Math.round(hintUsageRate * 100)}% of questions`);
    }

    const insight: Insight = {
      id: generateId("insight"),
      studentId: student.id,
      assignmentId: lesson.id,
      classId,
      subject: lesson.subject,
      type: "check_in",
      priority: score < 30 ? "high" : "medium",
      confidence: 0.85,
      summary: `${student.name} may need support on "${lesson.title}"`,
      evidence,
      suggestedActions: [
        "Have a brief conversation to understand any difficulties",
        "Review specific questions where hints were used",
        "Consider providing additional practice materials",
      ],
      status: "pending_review",
      createdAt: new Date(),
    };
    insightStore.save(insight);
  }

  // 2. Celebrate progress: Significant improvement
  if (
    isImprovement &&
    improvementAmount >= RECOMMENDATION_CONFIG.SIGNIFICANT_IMPROVEMENT &&
    !existingCelebrate
  ) {
    const insight: Insight = {
      id: generateId("insight"),
      studentId: student.id,
      assignmentId: lesson.id,
      classId,
      subject: lesson.subject,
      type: "celebrate_progress",
      priority: improvementAmount >= 30 ? "high" : "medium",
      confidence: 0.9,
      summary: `${student.name} showed significant improvement on "${lesson.title}"`,
      evidence: [
        `Score improved by ${improvementAmount} points`,
        `New score: ${score}%`,
        `Previous best: ${score - improvementAmount}%`,
      ],
      suggestedActions: [
        "Recognize the improvement with positive feedback",
        "Consider awarding a badge",
        "Discuss what strategies helped them improve",
      ],
      status: "pending_review",
      createdAt: new Date(),
    };
    insightStore.save(insight);
  }

  // 3. Challenge opportunity: High score with minimal hints
  if (
    score >= RECOMMENDATION_CONFIG.EXCELLING_THRESHOLD &&
    hintUsageRate <= RECOMMENDATION_CONFIG.MINIMAL_HINT_USAGE &&
    !existingChallenge
  ) {
    const insight: Insight = {
      id: generateId("insight"),
      studentId: student.id,
      assignmentId: lesson.id,
      classId,
      subject: lesson.subject,
      type: "challenge_opportunity",
      priority: "medium",
      confidence: 0.85,
      summary: `${student.name} excelled on "${lesson.title}" - ready for challenge`,
      evidence: [
        `Scored ${score}% with minimal support`,
        `Used hints on only ${Math.round(hintUsageRate * 100)}% of questions`,
        record.attempts === 1 ? "Completed on first attempt" : `Completed in ${record.attempts} attempts`,
      ],
      suggestedActions: [
        "Offer extension or enrichment activities",
        "Consider peer tutoring opportunities",
        "Assign more challenging content",
      ],
      status: "pending_review",
      createdAt: new Date(),
    };
    insightStore.save(insight);
  }
}

/**
 * Ask the coach a question.
 * - Determines if question is support-seeking or enrichment-seeking
 * - Creates an Insight linked to student and assignment
 */
export function askCoach(
  studentId: string,
  question: string,
  assignmentId?: string
): Insight {
  // Validate student exists
  const student = studentStore.load(studentId);
  if (!student) {
    throw new Error(`Student not found: ${studentId}`);
  }

  // Record coach session
  if (assignmentId) {
    assignmentStudentStore.recordCoachSession(studentId, assignmentId);
  }

  // Determine intent based on question content
  const lowerQuestion = question.toLowerCase();
  const isSupport =
    lowerQuestion.includes("help") ||
    lowerQuestion.includes("don't understand") ||
    lowerQuestion.includes("confused") ||
    lowerQuestion.includes("stuck") ||
    lowerQuestion.includes("can't") ||
    lowerQuestion.includes("how do") ||
    lowerQuestion.includes("what is");

  const isEnrichment =
    lowerQuestion.includes("more") ||
    lowerQuestion.includes("tell me about") ||
    lowerQuestion.includes("why") ||
    lowerQuestion.includes("curious") ||
    lowerQuestion.includes("interesting") ||
    lowerQuestion.includes("explore");

  let coachIntent: "support" | "enrichment" | "mixed" = "mixed";
  if (isSupport && !isEnrichment) coachIntent = "support";
  if (isEnrichment && !isSupport) coachIntent = "enrichment";

  const lesson = assignmentId ? loadLessonById(assignmentId) : null;

  // Create insight based on intent
  const insightType: InsightType = coachIntent === "enrichment" ? "challenge_opportunity" : "check_in";
  const priority: InsightPriority = coachIntent === "support" ? "medium" : "low";

  const insight: Insight = {
    id: generateId("insight"),
    studentId,
    assignmentId,
    classId: student.classes?.[0] || "",
    subject: lesson?.subject,
    type: insightType,
    priority,
    confidence: 0.75,
    summary: coachIntent === "support"
      ? `${student.name} asked for help${lesson ? ` on "${lesson.title}"` : ""}`
      : `${student.name} is exploring deeper${lesson ? ` on "${lesson.title}"` : ""}`,
    evidence: [
      `Coach question: "${question.substring(0, 100)}${question.length > 100 ? "..." : ""}"`,
      `Intent detected: ${coachIntent}-seeking`,
    ],
    suggestedActions: coachIntent === "support"
      ? ["Check in to see if student needs additional help", "Review coach conversation if available"]
      : ["Encourage curiosity", "Consider offering extension activities"],
    status: "pending_review",
    createdAt: new Date(),
  };

  insightStore.save(insight);
  return insight;
}

/**
 * Retry an assignment.
 * - Increments AssignmentStudent.attempts
 * - Resets statuses for dashboard updates
 */
export function retryAssignment(studentId: string, assignmentId: string): AssignmentStudent {
  // Start a new attempt
  const record = assignmentStudentStore.startAttempt(studentId, assignmentId);
  return record;
}

// ============================================
// DASHBOARD HELPERS
// ============================================

/**
 * Get pending insights count (for dashboard badges)
 */
export function getPendingInsightsCount(): number {
  return insightStore.getPending().length;
}

/**
 * Get pending insights for a student
 */
export function getStudentPendingInsights(studentId: string): Insight[] {
  return insightStore.getByStudent(studentId, false);
}

/**
 * Get pending insights for an assignment
 */
export function getAssignmentPendingInsights(assignmentId: string): Insight[] {
  return insightStore.getByAssignment(assignmentId).filter(i => i.status === "pending_review");
}

/**
 * Get student's badges
 */
export function getStudentBadges(studentId: string): Badge[] {
  return badgeStore.getByStudent(studentId);
}

/**
 * Get student's assignment record
 */
export function getAssignmentRecord(studentId: string, assignmentId: string): AssignmentStudent | null {
  return assignmentStudentStore.load(studentId, assignmentId);
}

/**
 * Get all assignment records for a student
 */
export function getStudentAssignments(studentId: string): AssignmentStudent[] {
  return assignmentStudentStore.getByStudent(studentId);
}

/**
 * Get teacher actions for an insight
 */
export function getInsightActions(insightId: string): TeacherAction[] {
  return teacherActionStore.getByInsight(insightId);
}

/**
 * Get recent teacher actions
 */
export function getRecentTeacherActions(limit: number = 20): TeacherAction[] {
  return teacherActionStore.getRecent(limit);
}

/**
 * Calculate understanding level for a student on an assignment
 */
export function getStudentUnderstanding(studentId: string, assignmentId: string): StudentUnderstandingLevel {
  const record = assignmentStudentStore.load(studentId, assignmentId);
  const lesson = loadLessonById(assignmentId);

  if (!record || !lesson) return "developing";

  const hintUsageRate = lesson.prompts.length > 0
    ? (record.hintsUsed || 0) / lesson.prompts.length
    : 0;

  return calculateUnderstandingLevel(record.score, hintUsageRate);
}

// ============================================
// BULK OPERATIONS
// ============================================

/**
 * Mark all pending insights for an assignment as reviewed
 */
export function markAllAssignmentInsightsReviewed(assignmentId: string, teacherId: string): number {
  const insights = getAssignmentPendingInsights(assignmentId);
  let count = 0;

  for (const insight of insights) {
    try {
      markInsightReviewed(insight.id, teacherId);
      count++;
    } catch {
      // Skip if error
    }
  }

  return count;
}

/**
 * Mark all pending insights for a student as reviewed
 */
export function markAllStudentInsightsReviewed(studentId: string, teacherId: string): number {
  const insights = getStudentPendingInsights(studentId);
  let count = 0;

  for (const insight of insights) {
    try {
      markInsightReviewed(insight.id, teacherId);
      count++;
    } catch {
      // Skip if error
    }
  }

  return count;
}
