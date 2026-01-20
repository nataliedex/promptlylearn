/**
 * Dashboard Integration Service
 *
 * Integrates all action services with dashboard services to ensure
 * that actions automatically reflect in dashboard summaries.
 *
 * This is the main entry point for:
 * - Teacher actions (mark reviewed, push back, add note, award badge)
 * - Student actions (complete assignment, ask coach, retry)
 * - Dashboard generation (educator, assignment, student)
 *
 * All methods return both the action result AND updated dashboard data.
 */

import { TeacherActionService, teacherActionService } from "./teacherActionService";
import { StudentActionService, studentActionService } from "./studentActionService";
import { EducatorDashboardService, educatorDashboardService } from "./educatorDashboardService";
import { AssignmentDashboardService, assignmentDashboardService } from "./assignmentDashboardService";
import { StudentDashboardService, studentDashboardService } from "./studentDashboardService";
import { WorkflowService, workflowService } from "./workflowService";

import {
  MarkReviewedInput,
  PushBackInput,
  AddNoteInput,
  AwardBadgeInput,
  MarkReviewedResult,
  PushBackResult,
  AddNoteResult,
  AwardBadgeResult,
} from "./teacherActionService";

import {
  CompleteAssignmentInput,
  AskCoachInput,
  RetryAssignmentInput,
  CompleteAssignmentResult,
  AskCoachResult,
  RetryAssignmentResult,
} from "./studentActionService";

import { EducatorDashboardSummary, AssignmentDashboardSummary, StudentDashboardSummary, ActionableItem } from "../domain/dashboard";
import { Insight } from "../domain/insight";
import { TeacherAction, Badge } from "../domain/recommendation";

// ============================================
// Integrated Result Types
// ============================================

export interface TeacherActionWithDashboard<T> {
  actionResult: T;
  educatorDashboard?: EducatorDashboardSummary;
  assignmentDashboard?: AssignmentDashboardSummary;
  studentDashboard?: StudentDashboardSummary;
}

export interface StudentActionWithDashboard<T> {
  actionResult: T;
  studentDashboard?: StudentDashboardSummary;
  assignmentDashboard?: AssignmentDashboardSummary;
}

// ============================================
// Main Integration Class
// ============================================

export class DashboardIntegration {
  private teacherService: TeacherActionService;
  private studentService: StudentActionService;
  private educatorDashboard: EducatorDashboardService;
  private assignmentDashboard: AssignmentDashboardService;
  private studentDashboardService: StudentDashboardService;
  private workflowService: WorkflowService;

  constructor() {
    this.teacherService = teacherActionService;
    this.studentService = studentActionService;
    this.educatorDashboard = educatorDashboardService;
    this.assignmentDashboard = assignmentDashboardService;
    this.studentDashboardService = studentDashboardService;
    this.workflowService = workflowService;
  }

  // ============================================
  // Teacher Actions with Dashboard Updates
  // ============================================

  /**
   * Mark an insight as reviewed and return updated dashboards
   */
  markInsightReviewed(
    input: MarkReviewedInput,
    options?: { includeEducatorDashboard?: boolean; includeStudentDashboard?: boolean }
  ): TeacherActionWithDashboard<MarkReviewedResult> {
    const actionResult = this.teacherService.markInsightReviewed(input);

    const result: TeacherActionWithDashboard<MarkReviewedResult> = { actionResult };

    if (options?.includeEducatorDashboard !== false) {
      result.educatorDashboard = this.educatorDashboard.generateDashboardSummary();
    }

    return result;
  }

  /**
   * Push assignment back to student and return updated dashboards
   */
  pushAssignmentBack(
    input: PushBackInput,
    options?: { includeAssignmentDashboard?: boolean; includeStudentDashboard?: boolean }
  ): TeacherActionWithDashboard<PushBackResult> {
    const actionResult = this.teacherService.pushAssignmentBack(input);

    const result: TeacherActionWithDashboard<PushBackResult> = { actionResult };

    if (options?.includeAssignmentDashboard !== false && actionResult.success) {
      result.assignmentDashboard = this.assignmentDashboard.generateAssignmentDashboard(input.assignmentId) || undefined;
    }

    if (options?.includeStudentDashboard && actionResult.success) {
      result.studentDashboard = this.studentDashboardService.generateStudentDashboard(input.studentId) || undefined;
    }

    return result;
  }

  /**
   * Add note to student and return updated dashboards
   */
  addNoteToStudent(
    input: AddNoteInput,
    options?: { includeStudentDashboard?: boolean }
  ): TeacherActionWithDashboard<AddNoteResult> {
    const actionResult = this.teacherService.addNoteToStudent(input);

    const result: TeacherActionWithDashboard<AddNoteResult> = { actionResult };

    if (options?.includeStudentDashboard !== false && actionResult.success) {
      result.studentDashboard = this.studentDashboardService.generateStudentDashboard(input.studentId) || undefined;
    }

    return result;
  }

  /**
   * Award badge to student and return updated dashboards
   */
  awardBadge(
    input: AwardBadgeInput,
    options?: { includeStudentDashboard?: boolean; includeEducatorDashboard?: boolean }
  ): TeacherActionWithDashboard<AwardBadgeResult> {
    const actionResult = this.teacherService.awardBadge(input);

    const result: TeacherActionWithDashboard<AwardBadgeResult> = { actionResult };

    if (options?.includeStudentDashboard !== false && actionResult.success) {
      result.studentDashboard = this.studentDashboardService.generateStudentDashboard(input.studentId) || undefined;
    }

    if (options?.includeEducatorDashboard) {
      result.educatorDashboard = this.educatorDashboard.generateDashboardSummary();
    }

    return result;
  }

  /**
   * Schedule check-in with student
   */
  scheduleCheckin(
    studentId: string,
    teacherId: string,
    insightId?: string,
    note?: string
  ): TeacherActionWithDashboard<{ success: boolean; teacherActionId?: string }> {
    const actionResult = this.teacherService.scheduleCheckin(studentId, teacherId, insightId, note);

    return {
      actionResult,
      educatorDashboard: this.educatorDashboard.generateDashboardSummary(),
    };
  }

  // ============================================
  // Student Actions with Dashboard Updates
  // ============================================

  /**
   * Complete assignment and return updated dashboards
   */
  completeAssignment(
    input: CompleteAssignmentInput,
    options?: { includeStudentDashboard?: boolean; includeAssignmentDashboard?: boolean }
  ): StudentActionWithDashboard<CompleteAssignmentResult> {
    const actionResult = this.studentService.completeAssignment(input);

    const result: StudentActionWithDashboard<CompleteAssignmentResult> = { actionResult };

    if (options?.includeStudentDashboard !== false && actionResult.success) {
      result.studentDashboard = this.studentDashboardService.generateStudentDashboard(input.studentId) || undefined;
    }

    if (options?.includeAssignmentDashboard && actionResult.success) {
      result.assignmentDashboard = this.assignmentDashboard.generateAssignmentDashboard(input.assignmentId) || undefined;
    }

    return result;
  }

  /**
   * Record coach interaction and return updated dashboards
   */
  askCoach(
    input: AskCoachInput,
    options?: { includeStudentDashboard?: boolean }
  ): StudentActionWithDashboard<AskCoachResult> {
    const actionResult = this.studentService.askCoach(input);

    const result: StudentActionWithDashboard<AskCoachResult> = { actionResult };

    if (options?.includeStudentDashboard && actionResult.success) {
      result.studentDashboard = this.studentDashboardService.generateStudentDashboard(input.studentId) || undefined;
    }

    return result;
  }

  /**
   * Retry assignment and return updated dashboards
   */
  retryAssignment(
    input: RetryAssignmentInput,
    options?: { includeStudentDashboard?: boolean; includeAssignmentDashboard?: boolean }
  ): StudentActionWithDashboard<RetryAssignmentResult> {
    const actionResult = this.studentService.retryAssignment(input);

    const result: StudentActionWithDashboard<RetryAssignmentResult> = { actionResult };

    if (options?.includeStudentDashboard !== false && actionResult.success) {
      result.studentDashboard = this.studentDashboardService.generateStudentDashboard(input.studentId) || undefined;
    }

    if (options?.includeAssignmentDashboard && actionResult.success) {
      result.assignmentDashboard = this.assignmentDashboard.generateAssignmentDashboard(input.assignmentId) || undefined;
    }

    return result;
  }

  // ============================================
  // Dashboard Generation
  // ============================================

  /**
   * Get educator dashboard summary
   */
  getEducatorDashboard(): EducatorDashboardSummary {
    return this.educatorDashboard.generateDashboardSummary();
  }

  /**
   * Get assignment dashboard summary
   */
  getAssignmentDashboard(assignmentId: string): AssignmentDashboardSummary | null {
    return this.assignmentDashboard.generateAssignmentDashboard(assignmentId);
  }

  /**
   * Get student dashboard summary
   */
  getStudentDashboard(studentId: string): StudentDashboardSummary | null {
    return this.studentDashboardService.generateStudentDashboard(studentId);
  }

  /**
   * Get actionable items ("What Should I Do Next?")
   */
  getActionableItems(limit?: number): ActionableItem[] {
    return this.workflowService.getActionableItems(limit);
  }

  /**
   * Get actionable items for a specific student
   */
  getStudentActionableItems(studentId: string): ActionableItem[] {
    return this.workflowService.getStudentActionableItems(studentId);
  }

  /**
   * Get actionable items for a specific assignment
   */
  getAssignmentActionableItems(assignmentId: string): ActionableItem[] {
    return this.workflowService.getAssignmentActionableItems(assignmentId);
  }

  // ============================================
  // Workflow Actions
  // ============================================

  /**
   * Take action on a "What Should I Do Next?" item
   */
  takeWorkflowAction(input: {
    itemId: string;
    action: "approve" | "modify" | "dismiss";
    teacherId: string;
    note?: string;
    messageToStudent?: string;
    awardBadge?: boolean;
    badgeType?: string;
    badgeMessage?: string;
  }): {
    success: boolean;
    error?: string;
    updatedDashboard: EducatorDashboardSummary;
  } {
    const result = this.workflowService.takeAction(input);

    return {
      success: result.success,
      error: result.error,
      updatedDashboard: this.educatorDashboard.generateDashboardSummary(),
    };
  }

  // ============================================
  // Bulk Operations
  // ============================================

  /**
   * Mark all insights for an assignment as reviewed
   */
  markAllAssignmentInsightsReviewed(
    assignmentId: string,
    teacherId: string
  ): {
    count: number;
    assignmentDashboard: AssignmentDashboardSummary | null;
  } {
    const count = this.teacherService.markAllInsightsReviewed(assignmentId, teacherId);

    return {
      count,
      assignmentDashboard: this.assignmentDashboard.generateAssignmentDashboard(assignmentId),
    };
  }

  /**
   * Dismiss all insights for a student
   */
  dismissAllStudentInsights(
    studentId: string,
    teacherId: string,
    reason?: string
  ): {
    count: number;
    studentDashboard: StudentDashboardSummary | null;
  } {
    const count = this.teacherService.dismissAllStudentInsights(studentId, teacherId, reason);

    return {
      count,
      studentDashboard: this.studentDashboardService.generateStudentDashboard(studentId),
    };
  }

  // ============================================
  // Stats and Analytics
  // ============================================

  /**
   * Get workflow statistics
   */
  getWorkflowStats(): {
    pending: number;
    approved: number;
    dismissed: number;
    expired: number;
    byUrgency: { immediate: number; soon: number; when_available: number };
    byType: Record<string, number>;
  } {
    return this.workflowService.getWorkflowStats();
  }

  /**
   * Get class comparison for a student
   */
  getStudentClassComparison(studentId: string): {
    studentAverage: number;
    classAverage: number;
    percentile: number;
  } | null {
    return this.studentDashboardService.getClassComparison(studentId);
  }

  /**
   * Get subject strengths for a student
   */
  getStudentSubjectStrengths(studentId: string): {
    strongest: { subject: string; averageScore: number }[];
    weakest: { subject: string; averageScore: number }[];
  } {
    return this.studentDashboardService.getSubjectStrengths(studentId);
  }
}

// ============================================
// Export singleton instance
// ============================================

export const dashboardIntegration = new DashboardIntegration();
