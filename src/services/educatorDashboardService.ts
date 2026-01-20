/**
 * Educator Dashboard Service
 *
 * Generates data-driven summaries for the educator dashboard including:
 * - Students needing attention (developing/struggling)
 * - Active assignments with completion stats
 * - Archived assignments
 * - Actionable items from insights
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
import { Class } from "../domain/class";
import { Session } from "../domain/session";
import { Insight } from "../domain/insight";
import { TeacherAction } from "../domain/recommendation";
import { AssignmentStudent } from "../domain/studentAssignment";
import { getAllLessons } from "../loaders/lessonLoader";
import { Lesson } from "../domain/lesson";
import {
  EducatorDashboardSummary,
  StudentsNeedingAttentionSummary,
  StudentAttentionItem,
  AssignmentSummaryItem,
  AssignmentArchiveSummary,
  ActionableItem,
  RecentActivityItem,
  StudentUnderstandingLevel,
  DASHBOARD_CONFIG,
  calculateUnderstandingLevel,
  needsAttention,
  insightTypeToActionType,
  getUrgencyLevel,
} from "../domain/dashboard";

// ============================================
// Archived Assignments Storage
// ============================================

// In-memory storage for archived assignments (would be persisted in production)
const archivedAssignments: Map<string, AssignmentArchiveSummary> = new Map();

// ============================================
// Main Service Class
// ============================================

export class EducatorDashboardService {
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
   * Generate complete educator dashboard summary
   */
  generateDashboardSummary(): EducatorDashboardSummary {
    const students = this.studentStore.getAll();
    const lessons = getAllLessons();
    const pendingInsights = this.insightStore.getPending();

    // Build student attention summary
    const studentsNeedingAttention = this.buildStudentsNeedingAttentionSummary(students);

    // Build assignment summaries
    const { activeAssignments, archivedAssignmentsList } = this.buildAssignmentSummaries(lessons, students);

    // Build actionable items from insights
    const actionableItems = this.buildActionableItems(pendingInsights, students, lessons);

    // Get recent teacher actions
    const recentTeacherActions = this.buildRecentActivityItems();

    return {
      totalStudents: students.length,
      totalActiveAssignments: activeAssignments.length,
      totalArchivedAssignments: archivedAssignmentsList.length,
      studentsNeedingAttention,
      activeAssignments,
      archivedAssignments: archivedAssignmentsList,
      actionableItems: actionableItems.slice(0, DASHBOARD_CONFIG.MAX_ACTIONABLE_ITEMS),
      actionableItemCount: actionableItems.length,
      recentTeacherActions: recentTeacherActions.slice(0, DASHBOARD_CONFIG.MAX_RECENT_ACTIVITIES),
      generatedAt: new Date(),
    };
  }

  // ============================================
  // Students Needing Attention
  // ============================================

  /**
   * Build summary of students needing attention
   */
  private buildStudentsNeedingAttentionSummary(students: Student[]): StudentsNeedingAttentionSummary {
    const attentionItems: StudentAttentionItem[] = [];
    let developingCount = 0;
    let needsSupportCount = 0;

    for (const student of students) {
      const studentData = this.getStudentAttentionData(student);

      if (needsAttention(studentData.understandingLevel)) {
        attentionItems.push(studentData);

        if (studentData.understandingLevel === "developing") {
          developingCount++;
        } else if (studentData.understandingLevel === "needs_support") {
          needsSupportCount++;
        }
      }
    }

    // Sort by urgency: needs_support first, then by pending insight count
    attentionItems.sort((a, b) => {
      if (a.understandingLevel === "needs_support" && b.understandingLevel !== "needs_support") {
        return -1;
      }
      if (b.understandingLevel === "needs_support" && a.understandingLevel !== "needs_support") {
        return 1;
      }
      return b.pendingInsightCount - a.pendingInsightCount;
    });

    return {
      total: attentionItems.length,
      developing: developingCount,
      needsSupport: needsSupportCount,
      students: attentionItems,
    };
  }

  /**
   * Get attention data for a single student
   */
  private getStudentAttentionData(student: Student): StudentAttentionItem {
    // Get completed sessions for this student
    const sessions = this.sessionStore.getCompletedByStudentId(student.id);

    // Get assignment records
    const assignmentRecords = this.assignmentStudentStore.getByStudent(student.id);

    // Get pending insights
    const pendingInsights = this.insightStore.getByStudent(student.id, false);

    // Calculate overall understanding level
    const understandingLevel = this.calculateOverallUnderstandingLevel(sessions, assignmentRecords);

    // Get class info
    const classIds = student.classes || [];
    const classNames = classIds
      .map((id) => {
        const cls = this.classStore.load(id);
        return cls?.name || "Unknown";
      })
      .filter((name) => name !== "Unknown");

    // Get active assignment count
    const activeAssignmentCount = assignmentRecords.filter(
      (ar) => ar.startedAt && !ar.lastCompletedAt
    ).length;

    // Determine last activity
    const lastSession = sessions[0]; // Sorted by most recent
    const lastActivityAt = lastSession?.completedAt ? new Date(lastSession.completedAt) : undefined;

    // Determine primary concern
    let primaryConcern: string | undefined;
    if (pendingInsights.length > 0) {
      const highPriorityInsight = pendingInsights.find((i) => i.priority === "high");
      primaryConcern = highPriorityInsight?.summary || pendingInsights[0].summary;
    } else if (understandingLevel === "needs_support") {
      const avgScore = this.calculateAverageScore(sessions);
      primaryConcern = `Average score: ${avgScore}%`;
    }

    return {
      studentId: student.id,
      studentName: student.name,
      classIds,
      classNames,
      understandingLevel,
      activeAssignmentCount,
      pendingInsightCount: pendingInsights.length,
      lastActivityAt,
      primaryConcern,
    };
  }

  /**
   * Calculate overall understanding level for a student
   */
  private calculateOverallUnderstandingLevel(
    sessions: Session[],
    assignmentRecords: AssignmentStudent[]
  ): StudentUnderstandingLevel {
    if (sessions.length === 0) {
      return "developing"; // New student, no data
    }

    // Calculate average score
    const avgScore = this.calculateAverageScore(sessions);

    // Calculate hint usage rate from assignment records
    const totalHints = assignmentRecords.reduce((sum, ar) => sum + (ar.hintsUsed || 0), 0);
    const totalQuestions = sessions.reduce((sum, s) => sum + s.submission.responses.length, 0);
    const hintUsageRate = totalQuestions > 0 ? totalHints / totalQuestions : 0;

    return calculateUnderstandingLevel(avgScore, hintUsageRate);
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
  // Assignment Summaries
  // ============================================

  /**
   * Build assignment summaries for active and archived assignments
   */
  private buildAssignmentSummaries(
    lessons: Lesson[],
    students: Student[]
  ): { activeAssignments: AssignmentSummaryItem[]; archivedAssignmentsList: AssignmentSummaryItem[] } {
    const activeAssignments: AssignmentSummaryItem[] = [];
    const archivedAssignmentsList: AssignmentSummaryItem[] = [];

    for (const lesson of lessons) {
      const summary = this.buildSingleAssignmentSummary(lesson, students);

      if (summary.isArchived) {
        archivedAssignmentsList.push(summary);
      } else {
        activeAssignments.push(summary);
      }
    }

    // Sort active by total needing attention (most urgent first)
    activeAssignments.sort((a, b) => b.totalNeedingAttention - a.totalNeedingAttention);

    // Sort archived by archive date (most recent first)
    archivedAssignmentsList.sort((a, b) => {
      const aDate = a.archivedAt?.getTime() || 0;
      const bDate = b.archivedAt?.getTime() || 0;
      return bDate - aDate;
    });

    return { activeAssignments, archivedAssignmentsList };
  }

  /**
   * Build summary for a single assignment
   */
  private buildSingleAssignmentSummary(lesson: Lesson, students: Student[]): AssignmentSummaryItem {
    const assignmentRecords = this.assignmentStudentStore.getByAssignment(lesson.id);
    const sessions = this.sessionStore.getAll().filter((s) => s.lessonId === lesson.id);

    // Calculate stats
    let completed = 0;
    let inProgress = 0;
    let notStarted = 0;
    let developing = 0;
    let needsSupport = 0;

    // Track which students have records
    const studentsWithRecords = new Set<string>();

    for (const record of assignmentRecords) {
      studentsWithRecords.add(record.studentId);

      if (record.lastCompletedAt) {
        completed++;

        // Calculate understanding level
        const hintUsageRate = this.calculateHintUsageRate(record, lesson);
        const level = calculateUnderstandingLevel(record.score, hintUsageRate);

        if (level === "developing") developing++;
        else if (level === "needs_support") needsSupport++;
      } else if (record.startedAt) {
        inProgress++;
      }
    }

    // Count students who haven't started
    const totalStudents = students.length; // Simplified: all students can access all lessons
    notStarted = Math.max(0, totalStudents - completed - inProgress);

    const totalNeedingAttention = developing + needsSupport;

    // Check if archived
    const archiveSummary = archivedAssignments.get(lesson.id);
    const isArchived = archiveSummary !== undefined;

    // Find earliest assignment date from records
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
      assignedAt,
      totalStudents,
      completed,
      inProgress,
      notStarted,
      developing,
      needsSupport,
      totalNeedingAttention,
      isArchived,
      archivedAt: archiveSummary?.archivedAt,
      archiveSummary,
    };
  }

  /**
   * Calculate hint usage rate for an assignment record
   */
  private calculateHintUsageRate(record: AssignmentStudent, lesson: Lesson): number {
    const totalQuestions = lesson.prompts.length;
    if (totalQuestions === 0) return 0;
    return (record.hintsUsed || 0) / totalQuestions;
  }

  // ============================================
  // Actionable Items
  // ============================================

  /**
   * Build actionable items from pending insights
   */
  private buildActionableItems(
    pendingInsights: Insight[],
    students: Student[],
    lessons: Lesson[]
  ): ActionableItem[] {
    const items: ActionableItem[] = [];
    const studentMap = new Map(students.map((s) => [s.id, s]));
    const lessonMap = new Map(lessons.map((l) => [l.id, l]));

    for (const insight of pendingInsights) {
      const student = studentMap.get(insight.studentId);
      const lesson = insight.assignmentId ? lessonMap.get(insight.assignmentId) : undefined;

      if (!student) continue;

      // Get class info
      const classId = insight.classId || (student.classes?.[0]);
      let className: string | undefined;
      if (classId) {
        const cls = this.classStore.load(classId);
        className = cls?.name;
      }

      const item: ActionableItem = {
        id: `action-${insight.id}`,
        studentId: student.id,
        studentName: student.name,
        assignmentId: insight.assignmentId,
        assignmentTitle: lesson?.title,
        classId,
        className,
        insightId: insight.id,
        insightType: insight.type,
        actionType: insightTypeToActionType(insight.type),
        title: this.getActionTitle(insight),
        description: insight.summary,
        evidence: insight.evidence,
        suggestedActions: insight.suggestedActions,
        priority: insight.priority,
        urgency: getUrgencyLevel(insight.type, insight.priority),
        status: "pending",
        createdAt: new Date(insight.createdAt),
      };

      items.push(item);
    }

    // Sort by urgency and priority
    items.sort((a, b) => {
      const urgencyOrder = { immediate: 0, soon: 1, when_available: 2 };
      const priorityOrder = { high: 0, medium: 1, low: 2 };

      const urgencyDiff = urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
      if (urgencyDiff !== 0) return urgencyDiff;

      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });

    return items;
  }

  /**
   * Get action title based on insight type
   */
  private getActionTitle(insight: Insight): string {
    const titles: Record<string, string> = {
      check_in: "Check in with student",
      challenge_opportunity: "Challenge opportunity",
      celebrate_progress: "Celebrate progress",
      monitor: "Monitor progress",
    };
    return titles[insight.type] || "Review insight";
  }

  // ============================================
  // Recent Activity
  // ============================================

  /**
   * Build recent activity items
   */
  private buildRecentActivityItems(): RecentActivityItem[] {
    const items: RecentActivityItem[] = [];

    // Get recent teacher actions
    const recentActions = this.teacherActionStore.getRecent(20);

    for (const action of recentActions) {
      const insight = this.insightStore.load(action.insightId);
      const student = insight ? this.studentStore.load(insight.studentId) : null;

      items.push({
        id: action.id,
        type: "teacher_action",
        actorName: action.teacherId === "educator" ? "Educator" : action.teacherId,
        targetName: student?.name || "Unknown",
        description: this.getActionDescription(action),
        timestamp: new Date(action.createdAt),
        relatedIds: {
          studentId: insight?.studentId,
          insightId: action.insightId,
          actionId: action.id,
        },
      });
    }

    // Sort by timestamp (most recent first)
    items.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return items;
  }

  /**
   * Get description for teacher action
   */
  private getActionDescription(action: TeacherAction): string {
    const descriptions: Record<string, string> = {
      mark_reviewed: "Marked insight as reviewed",
      add_note: "Added a note",
      draft_message: "Drafted a message",
      award_badge: "Awarded a badge",
      reassign: "Reassigned work",
      schedule_checkin: "Scheduled a check-in",
      other: "Took action",
    };
    return descriptions[action.actionType] || "Took action";
  }

  // ============================================
  // Archive Management
  // ============================================

  /**
   * Check if an assignment can be archived
   */
  canArchiveAssignment(assignmentId: string): { canArchive: boolean; blockers: string[] } {
    const blockers: string[] = [];

    // Get all students with records for this assignment
    const records = this.assignmentStudentStore.getByAssignment(assignmentId);

    // Get pending insights for this assignment
    const allInsights = this.insightStore.getAll();
    const pendingInsights = allInsights.filter(
      (i) => i.assignmentId === assignmentId && i.status === "pending_review"
    );

    if (pendingInsights.length > 0) {
      blockers.push(`${pendingInsights.length} pending insight(s) need review`);
    }

    // Check for unreviewed students needing attention
    const lessons = getAllLessons();
    const lesson = lessons.find((l) => l.id === assignmentId);

    if (lesson) {
      for (const record of records) {
        if (record.lastCompletedAt) {
          const hintUsageRate = this.calculateHintUsageRate(record, lesson);
          const level = calculateUnderstandingLevel(record.score, hintUsageRate);

          if (needsAttention(level)) {
            // Check if this student has been reviewed via insights
            const studentInsights = allInsights.filter(
              (i) =>
                i.studentId === record.studentId &&
                i.assignmentId === assignmentId &&
                (i.status === "action_taken" || i.status === "dismissed")
            );

            if (studentInsights.length === 0) {
              blockers.push(`Student needs review but has no resolved insights`);
              break;
            }
          }
        }
      }
    }

    return {
      canArchive: blockers.length === 0,
      blockers,
    };
  }

  /**
   * Archive an assignment
   */
  archiveAssignment(assignmentId: string, archivedBy?: string): AssignmentArchiveSummary | null {
    const { canArchive, blockers } = this.canArchiveAssignment(assignmentId);

    if (!canArchive) {
      console.warn("Cannot archive assignment:", blockers);
      return null;
    }

    const records = this.assignmentStudentStore.getByAssignment(assignmentId);
    const completedRecords = records.filter((r) => r.lastCompletedAt);

    // Calculate summary stats
    const totalStudents = records.length;
    const scores = completedRecords
      .filter((r) => r.score !== undefined)
      .map((r) => r.score!);
    const averageScore = scores.length > 0
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : 0;
    const completionRate = totalStudents > 0
      ? Math.round((completedRecords.length / totalStudents) * 100)
      : 0;

    // Count insights and actions
    const allInsights = this.insightStore.getAll();
    const assignmentInsights = allInsights.filter((i) => i.assignmentId === assignmentId);
    const allActions = this.teacherActionStore.getAll();
    const assignmentActions = allActions.filter((a) =>
      assignmentInsights.some((i) => i.id === a.insightId)
    );

    const summary: AssignmentArchiveSummary = {
      totalStudents,
      averageScore,
      completionRate,
      studentsReviewed: completedRecords.length,
      insightsGenerated: assignmentInsights.length,
      actionssTaken: assignmentActions.length,
      archivedAt: new Date(),
      archivedBy,
    };

    archivedAssignments.set(assignmentId, summary);

    return summary;
  }

  /**
   * Check if all flagged students are reviewed and auto-archive if enabled
   */
  checkAndAutoArchive(): string[] {
    if (!DASHBOARD_CONFIG.AUTO_ARCHIVE_WHEN_ALL_REVIEWED) {
      return [];
    }

    const archivedIds: string[] = [];
    const lessons = getAllLessons();

    for (const lesson of lessons) {
      if (archivedAssignments.has(lesson.id)) continue;

      const { canArchive } = this.canArchiveAssignment(lesson.id);
      if (canArchive) {
        const summary = this.archiveAssignment(lesson.id, "auto");
        if (summary) {
          archivedIds.push(lesson.id);
        }
      }
    }

    return archivedIds;
  }
}

// ============================================
// Export singleton instance
// ============================================

export const educatorDashboardService = new EducatorDashboardService();
