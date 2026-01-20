/**
 * Student Dashboard Service
 *
 * Generates data-driven summaries for the student dashboard (educator view) including:
 * - Overall status and understanding level
 * - Completed and open assignments
 * - Coach usage and learning patterns
 * - Badges earned
 * - Recent activity timeline
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
import { Insight } from "../domain/insight";
import { AssignmentStudent } from "../domain/studentAssignment";
import { Badge, getBadgeTypeName } from "../domain/recommendation";
import { getAllLessons, loadLessonById } from "../loaders/lessonLoader";
import { Lesson } from "../domain/lesson";
import {
  StudentDashboardSummary,
  StudentAssignmentSummary,
  StudentBadgeSummary,
  StudentActivityItem,
  StudentCoachUsage,
  CoachUsageIntent,
  ReviewStatus,
  StudentUnderstandingLevel,
  AssignmentInsightSummary,
  DASHBOARD_CONFIG,
  calculateUnderstandingLevel,
  calculateCoachUsageIntent,
  getUnderstandingLevelLabel,
  getCoachUsageIntentLabel,
} from "../domain/dashboard";

// ============================================
// Review Status Storage (shared with assignment dashboard)
// ============================================

const reviewStatusMap: Map<string, { status: ReviewStatus; reviewedAt?: Date; reviewedBy?: string }> = new Map();

function getReviewKey(studentId: string, assignmentId: string): string {
  return `${studentId}:${assignmentId}`;
}

// ============================================
// Main Service Class
// ============================================

export class StudentDashboardService {
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
   * Generate complete student dashboard summary (educator view)
   */
  generateStudentDashboard(studentId: string): StudentDashboardSummary | null {
    const student = this.studentStore.load(studentId);
    if (!student) {
      return null;
    }

    // Get all sessions for this student
    const sessions = this.sessionStore.getCompletedByStudentId(studentId);

    // Get assignment records
    const assignmentRecords = this.assignmentStudentStore.getByStudent(studentId);

    // Get all lessons
    const lessons = getAllLessons();

    // Get class info
    const classIds = student.classes || [];
    const classNames = classIds
      .map((id) => {
        const cls = this.classStore.load(id);
        return cls?.name || "Unknown";
      })
      .filter((name) => name !== "Unknown");

    // Calculate overall status
    const overallStatus = this.calculateOverallStatus(sessions, assignmentRecords);
    const statusDescription = this.getStatusDescription(overallStatus, sessions);

    // Calculate performance stats
    const { averageScore, highestScore, trend } = this.calculatePerformanceStats(sessions);

    // Calculate coach usage
    const coachUsage = this.calculateOverallCoachUsage(sessions, assignmentRecords);

    // Build assignment lists
    const { completedAssignmentsList, openAssignmentsList } = this.buildAssignmentLists(
      student,
      assignmentRecords,
      sessions,
      lessons
    );

    // Get insights
    const pendingInsights = this.getPendingInsights(studentId);
    const resolvedInsightsCount = this.getResolvedInsightsCount(studentId);

    // Get badges
    const badges = this.getStudentBadges(studentId);

    // Build activity timeline
    const recentActivity = this.buildActivityTimeline(studentId, sessions);

    return {
      studentId: student.id,
      studentName: student.name,
      classIds,
      classNames,
      createdAt: student.createdAt ? new Date(student.createdAt) : new Date(),
      notes: student.notes,
      overallStatus,
      statusDescription,
      totalAssignments: completedAssignmentsList.length + openAssignmentsList.length,
      completedAssignments: completedAssignmentsList.length,
      averageScore,
      highestScore,
      trend,
      coachUsage,
      coachUsageIntent: coachUsage.intent,
      completedAssignmentsList,
      openAssignmentsList,
      pendingInsights,
      resolvedInsightsCount,
      badges,
      totalBadges: badges.length,
      recentActivity,
      generatedAt: new Date(),
    };
  }

  // ============================================
  // Status Calculation
  // ============================================

  /**
   * Calculate overall understanding status
   */
  private calculateOverallStatus(
    sessions: Session[],
    assignmentRecords: AssignmentStudent[]
  ): StudentUnderstandingLevel {
    if (sessions.length === 0) {
      return "developing"; // New student, no data
    }

    // Calculate average score from recent sessions (last 5)
    const recentSessions = sessions.slice(0, 5);
    const avgScore = this.calculateAverageScore(recentSessions);

    // Calculate hint usage rate
    const totalHints = assignmentRecords.reduce((sum, ar) => sum + (ar.hintsUsed || 0), 0);
    const totalQuestions = sessions.reduce((sum, s) => sum + s.submission.responses.length, 0);
    const hintUsageRate = totalQuestions > 0 ? totalHints / totalQuestions : 0;

    return calculateUnderstandingLevel(avgScore, hintUsageRate);
  }

  /**
   * Get descriptive text for status
   */
  private getStatusDescription(status: StudentUnderstandingLevel, sessions: Session[]): string {
    if (sessions.length === 0) {
      return "New student - no completed assignments yet";
    }

    const avgScore = this.calculateAverageScore(sessions);

    switch (status) {
      case "strong":
        return `Demonstrating strong understanding with ${avgScore}% average score`;
      case "developing":
        return `Making progress with ${avgScore}% average score - continue supporting`;
      case "needs_support":
        return `Needs additional support - ${avgScore}% average score`;
      default:
        return "Status being evaluated";
    }
  }

  // ============================================
  // Performance Statistics
  // ============================================

  /**
   * Calculate performance statistics
   */
  private calculatePerformanceStats(sessions: Session[]): {
    averageScore: number;
    highestScore: number;
    trend: "improving" | "steady" | "declining";
  } {
    if (sessions.length === 0) {
      return { averageScore: 0, highestScore: 0, trend: "steady" };
    }

    const scores = sessions
      .map((s) => s.evaluation?.totalScore)
      .filter((s): s is number => s !== undefined);

    const averageScore = scores.length > 0
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : 0;
    const highestScore = scores.length > 0 ? Math.max(...scores) : 0;

    // Calculate trend (compare recent to older)
    const trend = this.calculateTrend(scores);

    return { averageScore, highestScore, trend };
  }

  /**
   * Calculate score trend
   */
  private calculateTrend(scores: number[]): "improving" | "steady" | "declining" {
    if (scores.length < 2) return "steady";

    const midpoint = Math.floor(scores.length / 2);
    const recentScores = scores.slice(0, midpoint);
    const olderScores = scores.slice(midpoint);

    const recentAvg = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;
    const olderAvg = olderScores.reduce((a, b) => a + b, 0) / olderScores.length;

    const difference = recentAvg - olderAvg;

    if (difference >= 5) return "improving";
    if (difference <= -5) return "declining";
    return "steady";
  }

  /**
   * Calculate average score from sessions
   */
  private calculateAverageScore(sessions: Session[]): number {
    if (sessions.length === 0) return 0;
    const total = sessions.reduce((sum, s) => sum + (s.evaluation?.totalScore ?? 0), 0);
    return Math.round(total / sessions.length);
  }

  // ============================================
  // Coach Usage
  // ============================================

  /**
   * Calculate overall coach usage for student
   */
  private calculateOverallCoachUsage(
    sessions: Session[],
    assignmentRecords: AssignmentStudent[]
  ): StudentCoachUsage {
    let helpRequests = 0;
    let elaborations = 0;
    let moreExplorations = 0;
    let totalHints = 0;

    // Count from assignment records
    for (const record of assignmentRecords) {
      totalHints += record.hintsUsed || 0;
    }

    // Count coach interactions from sessions
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

  // ============================================
  // Assignment Lists
  // ============================================

  /**
   * Build completed and open assignment lists
   */
  private buildAssignmentLists(
    student: Student,
    assignmentRecords: AssignmentStudent[],
    sessions: Session[],
    lessons: Lesson[]
  ): {
    completedAssignmentsList: StudentAssignmentSummary[];
    openAssignmentsList: StudentAssignmentSummary[];
  } {
    const completedAssignmentsList: StudentAssignmentSummary[] = [];
    const openAssignmentsList: StudentAssignmentSummary[] = [];

    // Create a map of assignment IDs to records
    const recordMap = new Map(assignmentRecords.map((r) => [r.assignmentId, r]));

    for (const lesson of lessons) {
      const record = recordMap.get(lesson.id);
      const lessonSessions = sessions.filter((s) => s.lessonId === lesson.id);

      // Get review status
      const reviewKey = getReviewKey(student.id, lesson.id);
      const reviewData = reviewStatusMap.get(reviewKey);
      const reviewStatus: ReviewStatus = reviewData?.status || "pending";

      // Determine status
      let status: "not_started" | "in_progress" | "completed" = "not_started";
      if (record?.lastCompletedAt) {
        status = "completed";
      } else if (record?.startedAt) {
        status = "in_progress";
      }

      // Get scores
      const scores = lessonSessions
        .map((s) => s.evaluation?.totalScore)
        .filter((s): s is number => s !== undefined);

      const summary: StudentAssignmentSummary = {
        assignmentId: lesson.id,
        assignmentTitle: lesson.title,
        subject: lesson.subject,
        status,
        score: record?.score,
        highestScore: scores.length > 0 ? Math.max(...scores) : undefined,
        attempts: record?.attempts || 0,
        lastActivityAt: record?.lastCompletedAt
          ? new Date(record.lastCompletedAt)
          : record?.startedAt
          ? new Date(record.startedAt)
          : undefined,
        reviewStatus,
      };

      if (status === "completed") {
        completedAssignmentsList.push(summary);
      } else if (status === "in_progress" || status === "not_started") {
        openAssignmentsList.push(summary);
      }
    }

    // Sort completed by most recent first
    completedAssignmentsList.sort((a, b) => {
      const aTime = a.lastActivityAt?.getTime() || 0;
      const bTime = b.lastActivityAt?.getTime() || 0;
      return bTime - aTime;
    });

    // Sort open by status (in_progress first) then by title
    openAssignmentsList.sort((a, b) => {
      if (a.status === "in_progress" && b.status !== "in_progress") return -1;
      if (b.status === "in_progress" && a.status !== "in_progress") return 1;
      return a.assignmentTitle.localeCompare(b.assignmentTitle);
    });

    return { completedAssignmentsList, openAssignmentsList };
  }

  // ============================================
  // Insights
  // ============================================

  /**
   * Get pending insights for student
   */
  private getPendingInsights(studentId: string): AssignmentInsightSummary[] {
    const insights = this.insightStore.getByStudent(studentId, false);

    return insights.map((i) => ({
      insightId: i.id,
      type: i.type,
      priority: i.priority,
      summary: i.summary,
      createdAt: new Date(i.createdAt),
    }));
  }

  /**
   * Get count of resolved insights
   */
  private getResolvedInsightsCount(studentId: string): number {
    const allInsights = this.insightStore.getAll();
    return allInsights.filter(
      (i) =>
        i.studentId === studentId &&
        (i.status === "action_taken" || i.status === "dismissed")
    ).length;
  }

  // ============================================
  // Badges
  // ============================================

  /**
   * Get student's badges
   */
  private getStudentBadges(studentId: string): StudentBadgeSummary[] {
    const badges = this.badgeStore.getByStudent(studentId);

    return badges.map((badge) => {
      const lesson = badge.assignmentId ? loadLessonById(badge.assignmentId) : undefined;

      return {
        badgeId: badge.id,
        type: badge.type,
        typeName: getBadgeTypeName(badge.type),
        message: badge.message,
        assignmentId: badge.assignmentId,
        assignmentTitle: lesson?.title,
        issuedAt: new Date(badge.issuedAt),
      };
    });
  }

  // ============================================
  // Activity Timeline
  // ============================================

  /**
   * Build recent activity timeline
   */
  private buildActivityTimeline(studentId: string, sessions: Session[]): StudentActivityItem[] {
    const activities: StudentActivityItem[] = [];

    // Add assignment completions
    for (const session of sessions.slice(0, 10)) {
      if (session.completedAt) {
        const lesson = loadLessonById(session.lessonId);
        activities.push({
          type: "assignment_completed",
          description: `Completed "${lesson?.title || session.lessonId}" with ${session.evaluation?.totalScore || 0}%`,
          timestamp: new Date(session.completedAt),
          relatedId: session.id,
        });
      }
    }

    // Add badges earned
    const badges = this.badgeStore.getByStudent(studentId);
    for (const badge of badges) {
      activities.push({
        type: "badge_earned",
        description: `Earned ${getBadgeTypeName(badge.type)} badge`,
        timestamp: new Date(badge.issuedAt),
        relatedId: badge.id,
      });
    }

    // Add insights generated
    const allInsights = this.insightStore.getAll();
    const studentInsights = allInsights.filter((i) => i.studentId === studentId);
    for (const insight of studentInsights.slice(0, 10)) {
      activities.push({
        type: "insight_generated",
        description: insight.summary,
        timestamp: new Date(insight.createdAt),
        relatedId: insight.id,
      });
    }

    // Add teacher actions
    const teacherActions = this.teacherActionStore.getAll();
    const studentActions = teacherActions.filter((a) => {
      const insight = this.insightStore.load(a.insightId);
      return insight?.studentId === studentId;
    });
    for (const action of studentActions.slice(0, 10)) {
      activities.push({
        type: "teacher_action",
        description: this.getActionDescription(action.actionType),
        timestamp: new Date(action.createdAt),
        relatedId: action.id,
      });
    }

    // Sort by timestamp (most recent first)
    activities.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return activities.slice(0, DASHBOARD_CONFIG.MAX_RECENT_ACTIVITIES);
  }

  /**
   * Get description for action type
   */
  private getActionDescription(actionType: string): string {
    const descriptions: Record<string, string> = {
      mark_reviewed: "Work reviewed by teacher",
      add_note: "Teacher added a note",
      draft_message: "Teacher drafted a message",
      award_badge: "Badge awarded by teacher",
      reassign: "Assignment reassigned",
      schedule_checkin: "Check-in scheduled",
      other: "Teacher action taken",
    };
    return descriptions[actionType] || "Teacher action taken";
  }

  // ============================================
  // Comparison Methods
  // ============================================

  /**
   * Compare student to class average
   */
  getClassComparison(studentId: string): {
    studentAverage: number;
    classAverage: number;
    percentile: number;
  } | null {
    const student = this.studentStore.load(studentId);
    if (!student || !student.classes || student.classes.length === 0) {
      return null;
    }

    // Get student's average
    const studentSessions = this.sessionStore.getCompletedByStudentId(studentId);
    const studentAverage = this.calculateAverageScore(studentSessions);

    // Get classmates' averages
    const classId = student.classes[0];
    const cls = this.classStore.load(classId);
    if (!cls) return null;

    const classScores: number[] = [];
    for (const classmateId of cls.students || []) {
      const classmateSessions = this.sessionStore.getCompletedByStudentId(classmateId);
      if (classmateSessions.length > 0) {
        classScores.push(this.calculateAverageScore(classmateSessions));
      }
    }

    if (classScores.length === 0) {
      return null;
    }

    const classAverage = Math.round(
      classScores.reduce((a, b) => a + b, 0) / classScores.length
    );

    // Calculate percentile
    const belowCount = classScores.filter((s) => s < studentAverage).length;
    const percentile = Math.round((belowCount / classScores.length) * 100);

    return {
      studentAverage,
      classAverage,
      percentile,
    };
  }

  /**
   * Get student's strongest and weakest subjects
   */
  getSubjectStrengths(studentId: string): {
    strongest: { subject: string; averageScore: number }[];
    weakest: { subject: string; averageScore: number }[];
  } {
    const sessions = this.sessionStore.getCompletedByStudentId(studentId);
    const lessons = getAllLessons();
    const lessonMap = new Map(lessons.map((l) => [l.id, l]));

    // Group sessions by subject
    const subjectScores: Map<string, number[]> = new Map();

    for (const session of sessions) {
      const lesson = lessonMap.get(session.lessonId);
      const subject = lesson?.subject || "General";
      const score = session.evaluation?.totalScore;

      if (score !== undefined) {
        const scores = subjectScores.get(subject) || [];
        scores.push(score);
        subjectScores.set(subject, scores);
      }
    }

    // Calculate averages
    const subjectAverages: { subject: string; averageScore: number }[] = [];

    for (const [subject, scores] of subjectScores) {
      const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
      subjectAverages.push({ subject, averageScore: avg });
    }

    // Sort by score
    subjectAverages.sort((a, b) => b.averageScore - a.averageScore);

    return {
      strongest: subjectAverages.slice(0, 3),
      weakest: subjectAverages.slice(-3).reverse(),
    };
  }
}

// ============================================
// Export singleton instance
// ============================================

export const studentDashboardService = new StudentDashboardService();
