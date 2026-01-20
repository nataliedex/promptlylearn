/**
 * Assignment Dashboard Service
 *
 * Generates data-driven summaries for the assignment dashboard including:
 * - Student table with progress, understanding, coach usage
 * - Review status tracking
 * - Available actions per student (push back, mark reviewed, add notes, badges)
 * - Filtered views (needing attention, completed, in progress)
 *
 * All data is derived from the domain layer stores.
 */

import { StudentStore } from "../stores/studentStore";
import { SessionStore } from "../stores/sessionStore";
import { InsightStore } from "../stores/insightStore";
import { TeacherActionStore } from "../stores/teacherActionStore";
import { AssignmentStudentStore } from "../stores/assignmentStudentStore";
import { BadgeStore } from "../stores/badgeStore";
import { ClassStore } from "../stores/classStore";
import { Student } from "../domain/student";
import { Session } from "../domain/session";
import { Insight, InsightStatus } from "../domain/insight";
import { TeacherAction, TeacherActionType, Badge, BADGE_TYPES, getBadgeTypeName, isBadgeType } from "../domain/recommendation";
import { AssignmentStudent } from "../domain/studentAssignment";
import { loadLessonById } from "../loaders/lessonLoader";
import { Lesson } from "../domain/lesson";
import {
  AssignmentDashboardSummary,
  AssignmentStudentRow,
  StudentAssignmentProgress,
  StudentCoachUsage,
  AssignmentInsightSummary,
  AvailableAction,
  ReviewStatus,
  StudentUnderstandingLevel,
  CoachUsageIntent,
  DASHBOARD_CONFIG,
  calculateUnderstandingLevel,
  calculateCoachUsageIntent,
  needsAttention,
} from "../domain/dashboard";

// ============================================
// Review Status Storage (in-memory)
// ============================================

// Track review status per student-assignment pair
const reviewStatusMap: Map<string, { status: ReviewStatus; reviewedAt?: Date; reviewedBy?: string }> = new Map();

function getReviewKey(studentId: string, assignmentId: string): string {
  return `${studentId}:${assignmentId}`;
}

// ============================================
// Main Service Class
// ============================================

export class AssignmentDashboardService {
  private studentStore: StudentStore;
  private sessionStore: SessionStore;
  private insightStore: InsightStore;
  private teacherActionStore: TeacherActionStore;
  private assignmentStudentStore: AssignmentStudentStore;
  private badgeStore: BadgeStore;
  private classStore: ClassStore;

  constructor() {
    this.studentStore = new StudentStore();
    this.sessionStore = new SessionStore();
    this.insightStore = new InsightStore();
    this.teacherActionStore = new TeacherActionStore();
    this.assignmentStudentStore = new AssignmentStudentStore();
    this.badgeStore = new BadgeStore();
    this.classStore = new ClassStore();
  }

  // ============================================
  // Main Dashboard Summary
  // ============================================

  /**
   * Generate complete assignment dashboard summary
   */
  generateAssignmentDashboard(assignmentId: string): AssignmentDashboardSummary | null {
    const lesson = loadLessonById(assignmentId);
    if (!lesson) {
      return null;
    }

    // Get all students who have records for this assignment
    const assignmentRecords = this.assignmentStudentStore.getByAssignment(assignmentId);
    const studentIds = new Set(assignmentRecords.map((r) => r.studentId));

    // Also include all students (they could potentially start this assignment)
    const allStudents = this.studentStore.getAll();
    for (const student of allStudents) {
      studentIds.add(student.id);
    }

    // Build student rows
    const studentRows: AssignmentStudentRow[] = [];
    let completed = 0;
    let inProgress = 0;
    let notStarted = 0;
    let strong = 0;
    let developing = 0;
    let needsSupportCount = 0;
    let reviewed = 0;
    let pendingReview = 0;
    const scores: number[] = [];

    for (const studentId of studentIds) {
      const student = this.studentStore.load(studentId);
      if (!student) continue;

      const row = this.buildStudentRow(student, lesson, assignmentRecords);
      studentRows.push(row);

      // Update counts
      if (row.progress.status === "completed") {
        completed++;
        if (row.score !== undefined) scores.push(row.score);
      } else if (row.progress.status === "in_progress") {
        inProgress++;
      } else {
        notStarted++;
      }

      if (row.understandingLevel === "strong") strong++;
      else if (row.understandingLevel === "developing") developing++;
      else if (row.understandingLevel === "needs_support") needsSupportCount++;

      if (row.reviewStatus === "reviewed" || row.reviewStatus === "action_taken") {
        reviewed++;
      } else {
        pendingReview++;
      }
    }

    // Calculate score statistics
    const averageScore = scores.length > 0
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : 0;
    const highestScore = scores.length > 0 ? Math.max(...scores) : 0;
    const lowestScore = scores.length > 0 ? Math.min(...scores) : 0;

    // Sort students: needs_support first, then developing, then by name
    studentRows.sort((a, b) => {
      const levelOrder = { needs_support: 0, developing: 1, strong: 2 };
      const levelDiff = levelOrder[a.understandingLevel] - levelOrder[b.understandingLevel];
      if (levelDiff !== 0) return levelDiff;
      return a.studentName.localeCompare(b.studentName);
    });

    // Build filtered views
    const studentsNeedingAttention = studentRows.filter((r) => needsAttention(r.understandingLevel));
    const studentsCompleted = studentRows.filter((r) => r.progress.status === "completed");
    const studentsInProgress = studentRows.filter((r) => r.progress.status === "in_progress");

    // Determine if can archive
    const { canArchive, blockers } = this.canArchive(assignmentId, studentRows);

    // Find earliest assignment date
    const assignedDates = assignmentRecords
      .filter((r) => r.startedAt)
      .map((r) => new Date(r.startedAt!));
    const assignedAt = assignedDates.length > 0
      ? new Date(Math.min(...assignedDates.map((d) => d.getTime())))
      : new Date();

    return {
      assignmentId: lesson.id,
      assignmentTitle: lesson.title,
      subject: lesson.subject,
      difficulty: lesson.difficulty,
      assignedAt,
      totalStudents: studentRows.length,
      completed,
      inProgress,
      notStarted,
      averageScore,
      highestScore,
      lowestScore,
      strong,
      developing,
      needsSupport: needsSupportCount,
      reviewed,
      pendingReview,
      students: studentRows,
      studentsNeedingAttention,
      studentsCompleted,
      studentsInProgress,
      canArchive,
      archiveBlockers: blockers.length > 0 ? blockers : undefined,
      generatedAt: new Date(),
    };
  }

  // ============================================
  // Student Row Building
  // ============================================

  /**
   * Build a student row for the assignment table
   */
  private buildStudentRow(
    student: Student,
    lesson: Lesson,
    allRecords: AssignmentStudent[]
  ): AssignmentStudentRow {
    // Find this student's record
    const record = allRecords.find((r) => r.studentId === student.id);

    // Get sessions for this student + assignment
    const sessions = this.sessionStore
      .getCompletedByStudentId(student.id)
      .filter((s) => s.lessonId === lesson.id);

    // Get class info
    const classId = student.classes?.[0] || "";
    let className = "Unassigned";
    if (classId) {
      const cls = this.classStore.load(classId);
      className = cls?.name || "Unknown";
    }

    // Build progress
    const progress = this.buildProgress(record, lesson, sessions);

    // Build coach usage
    const coachUsage = this.buildCoachUsage(record, sessions);

    // Calculate understanding level
    const hintUsageRate = coachUsage.hintUsageRate;
    const score = record?.highestScore ?? record?.score;
    const understandingLevel = calculateUnderstandingLevel(score, hintUsageRate);

    // Get review status
    const reviewKey = getReviewKey(student.id, lesson.id);
    const reviewData = reviewStatusMap.get(reviewKey) || { status: "pending" as ReviewStatus };

    // Get pending insights
    const pendingInsights = this.getPendingInsightsForStudent(student.id, lesson.id);

    // Build available actions
    const availableActions = this.buildAvailableActions(
      student,
      lesson,
      record,
      understandingLevel,
      reviewData.status,
      pendingInsights.length > 0
    );

    return {
      studentId: student.id,
      studentName: student.name,
      classId,
      className,
      progress,
      understandingLevel,
      score,
      highestScore: record?.highestScore,
      coachUsage,
      attempts: record?.attempts || 0,
      lastAttemptAt: record?.lastCompletedAt ? new Date(record.lastCompletedAt) : undefined,
      reviewStatus: reviewData.status,
      reviewedAt: reviewData.reviewedAt,
      reviewedBy: reviewData.reviewedBy,
      pendingInsights,
      availableActions,
    };
  }

  /**
   * Build student progress on assignment
   */
  private buildProgress(
    record: AssignmentStudent | undefined,
    lesson: Lesson,
    sessions: Session[]
  ): StudentAssignmentProgress {
    const totalQuestions = lesson.prompts.length;

    if (!record) {
      return {
        status: "not_started",
        percentComplete: 0,
        questionsAnswered: 0,
        totalQuestions,
      };
    }

    if (record.lastCompletedAt) {
      return {
        status: "completed",
        completedAt: new Date(record.lastCompletedAt),
        percentComplete: 100,
        questionsAnswered: totalQuestions,
        totalQuestions,
      };
    }

    if (record.startedAt) {
      // Estimate progress from last session
      const lastSession = sessions[0];
      const questionsAnswered = lastSession?.submission?.responses?.length || 0;
      const percentComplete = totalQuestions > 0
        ? Math.round((questionsAnswered / totalQuestions) * 100)
        : 0;

      return {
        status: "in_progress",
        percentComplete,
        questionsAnswered,
        totalQuestions,
      };
    }

    return {
      status: "not_started",
      percentComplete: 0,
      questionsAnswered: 0,
      totalQuestions,
    };
  }

  /**
   * Build coach usage summary
   */
  private buildCoachUsage(
    record: AssignmentStudent | undefined,
    sessions: Session[]
  ): StudentCoachUsage {
    if (!record && sessions.length === 0) {
      return {
        intent: "mixed",
        helpRequests: 0,
        elaborations: 0,
        moreExplorations: 0,
        totalInteractions: 0,
        hintsUsed: 0,
        hintUsageRate: 0,
      };
    }

    // Count coach interactions from sessions
    let helpRequests = 0;
    let elaborations = 0;
    let moreExplorations = 0;
    let totalHints = record?.hintsUsed || 0;

    for (const session of sessions) {
      for (const response of session.submission.responses) {
        // Count hints used in this response
        if (response.hintUsed) {
          totalHints++;
        }

        // Count help conversations
        if (response.helpConversation) {
          helpRequests += response.helpConversation.turns.filter((t) => t.role === "student").length;
        }

        // Count elaboration conversations
        if (response.elaborationConversation) {
          elaborations += response.elaborationConversation.turns.filter((t) => t.role === "student").length;
        }

        // Count more exploration conversations
        if (response.moreConversation) {
          moreExplorations += response.moreConversation.turns.filter((t) => t.role === "student").length;
        }
      }
    }

    const totalInteractions = helpRequests + elaborations + moreExplorations;
    const totalQuestions = sessions.reduce((sum, s) => sum + s.submission.responses.length, 0);
    const hintUsageRate = totalQuestions > 0 ? totalHints / totalQuestions : 0;

    const intent = calculateCoachUsageIntent(helpRequests, moreExplorations);

    return {
      intent,
      helpRequests,
      elaborations,
      moreExplorations,
      totalInteractions,
      hintsUsed: totalHints,
      hintUsageRate,
    };
  }

  /**
   * Get pending insights for a student on this assignment
   */
  private getPendingInsightsForStudent(studentId: string, assignmentId: string): AssignmentInsightSummary[] {
    const insights = this.insightStore.getByStudent(studentId, false);
    const assignmentInsights = insights.filter((i) => i.assignmentId === assignmentId);

    return assignmentInsights.map((i) => ({
      insightId: i.id,
      type: i.type,
      priority: i.priority,
      summary: i.summary,
      createdAt: new Date(i.createdAt),
    }));
  }

  /**
   * Build available actions for a student
   */
  private buildAvailableActions(
    student: Student,
    lesson: Lesson,
    record: AssignmentStudent | undefined,
    understandingLevel: StudentUnderstandingLevel,
    reviewStatus: ReviewStatus,
    hasPendingInsights: boolean
  ): AvailableAction[] {
    const actions: AvailableAction[] = [];

    // Mark reviewed (if not already reviewed and completed)
    if (record?.lastCompletedAt && reviewStatus === "pending") {
      actions.push({
        actionType: "mark_reviewed",
        label: "Mark Reviewed",
        description: "Mark this student's work as reviewed",
        isRecommended: !hasPendingInsights,
      });
    }

    // Add note
    actions.push({
      actionType: "add_note",
      label: "Add Note",
      description: "Add a private note about this student",
      isRecommended: false,
    });

    // Push back / Reassign (if completed but needs support)
    if (record?.lastCompletedAt && understandingLevel === "needs_support") {
      actions.push({
        actionType: "push_to_student",
        label: "Reassign",
        description: "Push assignment back to student for another attempt",
        isRecommended: true,
      });
    }

    // Award badge (if completed with strong understanding)
    if (record?.lastCompletedAt && understandingLevel === "strong") {
      actions.push({
        actionType: "award_badge",
        label: "Award Badge",
        description: "Recognize this student's excellent work",
        isRecommended: true,
      });
    }

    // Send message
    actions.push({
      actionType: "send_message",
      label: "Send Message",
      description: "Draft a message to this student",
      isRecommended: hasPendingInsights,
    });

    // Dismiss (if has pending insights)
    if (hasPendingInsights) {
      actions.push({
        actionType: "dismiss",
        label: "Dismiss",
        description: "Dismiss pending insights without action",
        isRecommended: false,
      });
    }

    return actions;
  }

  // ============================================
  // Teacher Actions
  // ============================================

  /**
   * Mark a student's work as reviewed
   */
  markAsReviewed(
    studentId: string,
    assignmentId: string,
    teacherId: string,
    note?: string
  ): TeacherAction {
    // Update review status
    const reviewKey = getReviewKey(studentId, assignmentId);
    reviewStatusMap.set(reviewKey, {
      status: "reviewed",
      reviewedAt: new Date(),
      reviewedBy: teacherId,
    });

    // Find related insights and mark them
    const insights = this.insightStore.getByStudent(studentId, false);
    const assignmentInsights = insights.filter((i) => i.assignmentId === assignmentId);

    // Create a teacher action for the first insight (or create one if none exist)
    let targetInsightId = assignmentInsights[0]?.id;

    // If no insights exist, we still record the review action
    if (!targetInsightId) {
      // Generate an insight to link the action to
      const insight: Insight = {
        id: `insight-${Date.now()}`,
        studentId,
        assignmentId,
        classId: "", // Default empty class ID
        type: "monitor",
        priority: "low",
        confidence: 1.0,
        summary: "Review completed",
        evidence: [],
        suggestedActions: [],
        status: "action_taken" as InsightStatus,
        createdAt: new Date(),
      };
      this.insightStore.save(insight);
      targetInsightId = insight.id;
    } else {
      // Update the insight status
      this.insightStore.updateStatus(targetInsightId, "action_taken");
    }

    // Create teacher action
    const action: TeacherAction = {
      id: `action-${Date.now()}`,
      insightId: targetInsightId,
      teacherId,
      actionType: "mark_reviewed" as TeacherActionType,
      note,
      createdAt: new Date(),
    };
    this.teacherActionStore.save(action);

    return action;
  }

  /**
   * Add a note for a student on an assignment
   */
  addNote(
    studentId: string,
    assignmentId: string,
    teacherId: string,
    note: string
  ): TeacherAction {
    // Find or create an insight to attach the note to
    const insights = this.insightStore.getByStudent(studentId, false);
    let targetInsightId = insights.find((i) => i.assignmentId === assignmentId)?.id;

    if (!targetInsightId) {
      const insight: Insight = {
        id: `insight-${Date.now()}`,
        studentId,
        assignmentId,
        classId: "", // Default empty class ID
        type: "monitor",
        priority: "low",
        confidence: 1.0,
        summary: "Teacher note added",
        evidence: [],
        suggestedActions: [],
        status: "pending_review" as InsightStatus,
        createdAt: new Date(),
      };
      this.insightStore.save(insight);
      targetInsightId = insight.id;
    }

    const action: TeacherAction = {
      id: `action-${Date.now()}`,
      insightId: targetInsightId,
      teacherId,
      actionType: "add_note" as TeacherActionType,
      note,
      createdAt: new Date(),
    };
    this.teacherActionStore.save(action);

    return action;
  }

  /**
   * Reassign work to a student (push back for retry)
   */
  reassignToStudent(
    studentId: string,
    assignmentId: string,
    teacherId: string,
    message?: string
  ): TeacherAction {
    // Reset the student's assignment record to allow retry
    const record = this.assignmentStudentStore.load(studentId, assignmentId);
    if (record) {
      // Keep history but allow new attempt
      record.currentAttempt = (record.currentAttempt || record.attempts || 0) + 1;
      this.assignmentStudentStore.save(record);
    }

    // Update review status to monitoring
    const reviewKey = getReviewKey(studentId, assignmentId);
    reviewStatusMap.set(reviewKey, {
      status: "monitoring",
      reviewedAt: new Date(),
      reviewedBy: teacherId,
    });

    // Find or create insight
    const insights = this.insightStore.getByStudent(studentId, false);
    let targetInsightId = insights.find((i) => i.assignmentId === assignmentId)?.id;

    if (!targetInsightId) {
      const insight: Insight = {
        id: `insight-${Date.now()}`,
        studentId,
        assignmentId,
        classId: "", // Default empty class ID
        type: "check_in",
        priority: "medium",
        confidence: 1.0,
        summary: "Assignment reassigned for retry",
        evidence: ["Teacher requested student retry assignment"],
        suggestedActions: ["Monitor student progress on retry"],
        status: "action_taken" as InsightStatus,
        createdAt: new Date(),
      };
      this.insightStore.save(insight);
      targetInsightId = insight.id;
    } else {
      this.insightStore.updateStatus(targetInsightId, "action_taken");
    }

    const action: TeacherAction = {
      id: `action-${Date.now()}`,
      insightId: targetInsightId,
      teacherId,
      actionType: "reassign" as TeacherActionType,
      note: message,
      messageToStudent: message,
      createdAt: new Date(),
    };
    this.teacherActionStore.save(action);

    return action;
  }

  /**
   * Award a badge to a student
   */
  awardBadge(
    studentId: string,
    assignmentId: string,
    teacherId: string,
    badgeType: string,
    message?: string
  ): { action: TeacherAction; badge: Badge } {
    // Create the badge - use the validated badge type or default to progress_star
    const validBadgeType = isBadgeType(badgeType) ? badgeType : "progress_star";
    const badgeTypeName = getBadgeTypeName(validBadgeType);

    const badge: Badge = {
      id: `badge-${Date.now()}`,
      studentId,
      awardedBy: teacherId,
      type: validBadgeType,
      message,
      assignmentId,
      issuedAt: new Date(),
    };
    this.badgeStore.save(badge);

    // Find or create insight
    const insights = this.insightStore.getByStudent(studentId, false);
    let targetInsightId = insights.find((i) => i.assignmentId === assignmentId)?.id;

    if (!targetInsightId) {
      const insight: Insight = {
        id: `insight-${Date.now()}`,
        studentId,
        assignmentId,
        classId: "", // Default empty class ID
        type: "celebrate_progress",
        priority: "low",
        confidence: 1.0,
        summary: "Badge awarded",
        evidence: [`Awarded ${badgeTypeName} badge`],
        suggestedActions: [],
        status: "action_taken" as InsightStatus,
        createdAt: new Date(),
      };
      this.insightStore.save(insight);
      targetInsightId = insight.id;
    } else {
      this.insightStore.updateStatus(targetInsightId, "action_taken");
    }

    const action: TeacherAction = {
      id: `action-${Date.now()}`,
      insightId: targetInsightId,
      teacherId,
      actionType: "award_badge" as TeacherActionType,
      note: `Awarded ${badgeTypeName} badge${message ? `: ${message}` : ""}`,
      createdAt: new Date(),
    };
    this.teacherActionStore.save(action);

    // Update review status
    const reviewKey = getReviewKey(studentId, assignmentId);
    reviewStatusMap.set(reviewKey, {
      status: "action_taken",
      reviewedAt: new Date(),
      reviewedBy: teacherId,
    });

    return { action, badge };
  }

  /**
   * Dismiss pending insights without action
   */
  dismissInsights(
    studentId: string,
    assignmentId: string,
    teacherId: string,
    reason?: string
  ): TeacherAction[] {
    const actions: TeacherAction[] = [];

    const insights = this.insightStore.getByStudent(studentId, false);
    const assignmentInsights = insights.filter((i) => i.assignmentId === assignmentId);

    for (const insight of assignmentInsights) {
      this.insightStore.updateStatus(insight.id, "dismissed");

      const action: TeacherAction = {
        id: `action-${Date.now()}-${insight.id}`,
        insightId: insight.id,
        teacherId,
        actionType: "mark_reviewed" as TeacherActionType,
        note: reason || "Dismissed without action",
        createdAt: new Date(),
      };
      this.teacherActionStore.save(action);
      actions.push(action);
    }

    // Update review status
    const reviewKey = getReviewKey(studentId, assignmentId);
    reviewStatusMap.set(reviewKey, {
      status: "reviewed",
      reviewedAt: new Date(),
      reviewedBy: teacherId,
    });

    return actions;
  }

  // ============================================
  // Archive Logic
  // ============================================

  /**
   * Check if assignment can be archived
   */
  private canArchive(
    assignmentId: string,
    studentRows: AssignmentStudentRow[]
  ): { canArchive: boolean; blockers: string[] } {
    const blockers: string[] = [];

    // Check for students needing attention who haven't been reviewed
    const unreviewed = studentRows.filter(
      (r) =>
        needsAttention(r.understandingLevel) &&
        r.reviewStatus === "pending" &&
        r.progress.status === "completed"
    );

    if (unreviewed.length > 0) {
      blockers.push(`${unreviewed.length} student(s) need attention and haven't been reviewed`);
    }

    // Check for pending insights
    const pendingInsightCount = studentRows.reduce(
      (sum, r) => sum + r.pendingInsights.length,
      0
    );

    if (pendingInsightCount > 0) {
      blockers.push(`${pendingInsightCount} pending insight(s) need review`);
    }

    return {
      canArchive: blockers.length === 0,
      blockers,
    };
  }

  // ============================================
  // Bulk Operations
  // ============================================

  /**
   * Mark all students as reviewed
   */
  markAllAsReviewed(assignmentId: string, teacherId: string): number {
    const dashboard = this.generateAssignmentDashboard(assignmentId);
    if (!dashboard) return 0;

    let count = 0;
    for (const student of dashboard.students) {
      if (student.reviewStatus === "pending" && student.progress.status === "completed") {
        this.markAsReviewed(student.studentId, assignmentId, teacherId);
        count++;
      }
    }

    return count;
  }

  /**
   * Dismiss all pending insights for an assignment
   */
  dismissAllInsights(assignmentId: string, teacherId: string, reason?: string): number {
    const dashboard = this.generateAssignmentDashboard(assignmentId);
    if (!dashboard) return 0;

    let count = 0;
    for (const student of dashboard.students) {
      if (student.pendingInsights.length > 0) {
        this.dismissInsights(student.studentId, assignmentId, teacherId, reason);
        count += student.pendingInsights.length;
      }
    }

    return count;
  }
}

// ============================================
// Export singleton instance
// ============================================

export const assignmentDashboardService = new AssignmentDashboardService();
