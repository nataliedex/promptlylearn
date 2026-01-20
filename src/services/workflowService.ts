/**
 * Workflow Service - "What Should I Do Next?"
 *
 * Manages the teacher workflow for acting on AI-generated insights:
 * - Generates prioritized actionable items
 * - Handles approve/modify/dismiss actions
 * - Links TeacherAction records to Insights
 * - Tracks action status and completion
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
import { Insight, InsightStatus } from "../domain/insight";
import { TeacherAction, TeacherActionType, Badge, BADGE_TYPES, getBadgeTypeName, isBadgeType, BadgeType } from "../domain/recommendation";
import { getAllLessons, loadLessonById } from "../loaders/lessonLoader";
import { Lesson } from "../domain/lesson";
import {
  ActionableItem,
  ActionableItemStatus,
  SuggestedActionType,
  TakeActionInput,
  TakeActionResult,
  DASHBOARD_CONFIG,
  insightTypeToActionType,
  getUrgencyLevel,
} from "../domain/dashboard";

// ============================================
// Actionable Item Status Storage (in-memory)
// ============================================

// Track status of actionable items
const actionableItemStatusMap: Map<string, ActionableItemStatus> = new Map();

// ============================================
// Main Service Class
// ============================================

export class WorkflowService {
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
  // Actionable Items Generation
  // ============================================

  /**
   * Get all actionable items for the "What Should I Do Next?" view
   */
  getActionableItems(limit?: number): ActionableItem[] {
    const pendingInsights = this.insightStore.getPending();
    const students = this.studentStore.getAll();
    const lessons = getAllLessons();

    const items = this.buildActionableItems(pendingInsights, students, lessons);

    // Apply limit
    const maxItems = limit || DASHBOARD_CONFIG.MAX_ACTIONABLE_ITEMS;
    return items.slice(0, maxItems);
  }

  /**
   * Get actionable items for a specific student
   */
  getStudentActionableItems(studentId: string): ActionableItem[] {
    const insights = this.insightStore.getByStudent(studentId, false);
    const student = this.studentStore.load(studentId);
    const lessons = getAllLessons();

    if (!student) return [];

    return this.buildActionableItems(insights, [student], lessons);
  }

  /**
   * Get actionable items for a specific assignment
   */
  getAssignmentActionableItems(assignmentId: string): ActionableItem[] {
    const allInsights = this.insightStore.getPending();
    const assignmentInsights = allInsights.filter((i) => i.assignmentId === assignmentId);
    const students = this.studentStore.getAll();
    const lessons = getAllLessons();

    return this.buildActionableItems(assignmentInsights, students, lessons);
  }

  /**
   * Get a single actionable item by ID
   */
  getActionableItem(itemId: string): ActionableItem | null {
    // Extract insight ID from item ID (format: action-{insightId})
    const insightId = itemId.replace("action-", "");
    const insight = this.insightStore.load(insightId);

    if (!insight) return null;

    const student = this.studentStore.load(insight.studentId);
    if (!student) return null;

    const lesson = insight.assignmentId ? loadLessonById(insight.assignmentId) : undefined;
    const lessons = lesson ? [lesson] : [];
    const items = this.buildActionableItems([insight], [student], lessons);

    return items[0] || null;
  }

  /**
   * Build actionable items from insights
   */
  private buildActionableItems(
    insights: Insight[],
    students: Student[],
    lessons: Lesson[]
  ): ActionableItem[] {
    const items: ActionableItem[] = [];
    const studentMap = new Map(students.map((s) => [s.id, s]));
    const lessonMap = new Map(lessons.map((l) => [l.id, l]));

    for (const insight of insights) {
      const student = studentMap.get(insight.studentId);
      if (!student) continue;

      const lesson = insight.assignmentId ? lessonMap.get(insight.assignmentId) : undefined;

      // Get class info
      const classId = insight.classId || student.classes?.[0];
      let className: string | undefined;
      if (classId) {
        const cls = this.classStore.load(classId);
        className = cls?.name;
      }

      // Get stored status or default to pending
      const itemId = `action-${insight.id}`;
      const storedStatus = actionableItemStatusMap.get(itemId);
      let status: ActionableItemStatus = storedStatus || "pending";

      // Override with insight status if insight has been acted on
      if (insight.status === "action_taken") {
        status = "completed";
      } else if (insight.status === "dismissed") {
        status = "dismissed";
      }

      const item: ActionableItem = {
        id: itemId,
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
        status,
        createdAt: new Date(insight.createdAt),
        expiresAt: this.calculateExpiryDate(insight),
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

    // Filter to only pending items by default
    return items.filter((i) => i.status === "pending");
  }

  /**
   * Get action title based on insight type
   */
  private getActionTitle(insight: Insight): string {
    const titles: Record<string, string> = {
      check_in: "Check in with student",
      challenge_opportunity: "Offer extension challenge",
      celebrate_progress: "Celebrate student progress",
      monitor: "Monitor student progress",
    };
    return titles[insight.type] || "Review insight";
  }

  /**
   * Calculate expiry date for an actionable item
   */
  private calculateExpiryDate(insight: Insight): Date | undefined {
    // High priority items expire in 7 days, others in 14 days
    const daysUntilExpiry = insight.priority === "high" ? 7 : 14;
    const createdAt = new Date(insight.createdAt);
    const expiresAt = new Date(createdAt);
    expiresAt.setDate(expiresAt.getDate() + daysUntilExpiry);
    return expiresAt;
  }

  // ============================================
  // Taking Actions
  // ============================================

  /**
   * Take action on an actionable item
   */
  takeAction(input: TakeActionInput): TakeActionResult {
    const item = this.getActionableItem(input.itemId);

    if (!item) {
      return {
        success: false,
        error: "Actionable item not found",
        insightUpdated: false,
        itemStatus: "pending",
      };
    }

    if (!item.insightId) {
      return {
        success: false,
        error: "No insight associated with this item",
        insightUpdated: false,
        itemStatus: "pending",
      };
    }

    try {
      let result: TakeActionResult;

      switch (input.action) {
        case "approve":
          result = this.approveAction(item, input);
          break;
        case "modify":
          result = this.modifyAction(item, input);
          break;
        case "dismiss":
          result = this.dismissAction(item, input);
          break;
        default:
          return {
            success: false,
            error: "Invalid action type",
            insightUpdated: false,
            itemStatus: "pending",
          };
      }

      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        insightUpdated: false,
        itemStatus: "pending",
      };
    }
  }

  /**
   * Approve an actionable item (execute suggested action)
   */
  private approveAction(item: ActionableItem, input: TakeActionInput): TakeActionResult {
    // Determine action type to execute
    const actionType = this.mapSuggestedToTeacherAction(item.actionType);

    // Create teacher action
    const teacherAction: TeacherAction = {
      id: `action-${Date.now()}`,
      insightId: item.insightId!,
      teacherId: input.teacherId,
      actionType,
      note: input.note,
      messageToStudent: input.messageToStudent,
      createdAt: new Date(),
    };

    // Handle badge if requested and appropriate
    let badge: Badge | undefined;
    if (input.awardBadge && item.actionType === "celebrate") {
      badge = this.createBadge(item, input);
      teacherAction.note = `${teacherAction.note || ""} [Badge: ${badge.id}]`.trim();
    }

    // Save teacher action
    this.teacherActionStore.save(teacherAction);

    // Update insight status
    this.insightStore.updateStatus(item.insightId!, "action_taken");

    // Update item status
    actionableItemStatusMap.set(item.id, "approved");

    return {
      success: true,
      teacherActionId: teacherAction.id,
      badgeId: badge?.id,
      insightUpdated: true,
      itemStatus: "approved",
    };
  }

  /**
   * Modify and execute an actionable item with custom action
   */
  private modifyAction(item: ActionableItem, input: TakeActionInput): TakeActionResult {
    // Use the modified action type if provided, otherwise use default
    const actionType = input.modifiedActionType || this.mapSuggestedToTeacherAction(item.actionType);

    // Create teacher action
    const teacherAction: TeacherAction = {
      id: `action-${Date.now()}`,
      insightId: item.insightId!,
      teacherId: input.teacherId,
      actionType,
      note: input.note,
      messageToStudent: input.messageToStudent,
      createdAt: new Date(),
    };

    // Handle badge if requested
    let badge: Badge | undefined;
    if (input.awardBadge) {
      badge = this.createBadge(item, input);
      teacherAction.note = `${teacherAction.note || ""} [Badge: ${badge.id}]`.trim();
    }

    // Save teacher action
    this.teacherActionStore.save(teacherAction);

    // Update insight status
    this.insightStore.updateStatus(item.insightId!, "action_taken");

    // Update item status
    actionableItemStatusMap.set(item.id, "modified");

    return {
      success: true,
      teacherActionId: teacherAction.id,
      badgeId: badge?.id,
      insightUpdated: true,
      itemStatus: "modified",
    };
  }

  /**
   * Dismiss an actionable item without executing action
   */
  private dismissAction(item: ActionableItem, input: TakeActionInput): TakeActionResult {
    // Create teacher action to record the dismissal
    const teacherAction: TeacherAction = {
      id: `action-${Date.now()}`,
      insightId: item.insightId!,
      teacherId: input.teacherId,
      actionType: "mark_reviewed",
      note: input.note || "Dismissed without action",
      createdAt: new Date(),
    };

    // Save teacher action
    this.teacherActionStore.save(teacherAction);

    // Update insight status
    this.insightStore.updateStatus(item.insightId!, "dismissed");

    // Update item status
    actionableItemStatusMap.set(item.id, "dismissed");

    return {
      success: true,
      teacherActionId: teacherAction.id,
      insightUpdated: true,
      itemStatus: "dismissed",
    };
  }

  /**
   * Map suggested action type to teacher action type
   */
  private mapSuggestedToTeacherAction(suggestedType: SuggestedActionType): TeacherActionType {
    const mapping: Record<SuggestedActionType, TeacherActionType> = {
      check_in: "schedule_checkin",
      challenge: "draft_message",
      celebrate: "award_badge",
      reassign: "reassign",
      monitor: "add_note",
      support_group: "add_note",
    };
    return mapping[suggestedType] || "mark_reviewed";
  }

  /**
   * Create a badge for the student
   */
  private createBadge(item: ActionableItem, input: TakeActionInput): Badge {
    // Validate and default the badge type
    const badgeTypeId = input.badgeType || "progress_star";
    const validBadgeType: BadgeType = isBadgeType(badgeTypeId) ? badgeTypeId : "progress_star";

    const badge: Badge = {
      id: `badge-${Date.now()}`,
      studentId: item.studentId,
      awardedBy: input.teacherId,
      type: validBadgeType,
      message: input.badgeMessage,
      assignmentId: item.assignmentId,
      insightId: item.insightId,
      issuedAt: new Date(),
    };

    this.badgeStore.save(badge);
    return badge;
  }

  // ============================================
  // Bulk Operations
  // ============================================

  /**
   * Mark multiple items as expired
   */
  expireOldItems(): number {
    const items = this.getActionableItems(1000); // Get all items
    const now = new Date();
    let expiredCount = 0;

    for (const item of items) {
      if (item.expiresAt && new Date(item.expiresAt) < now) {
        actionableItemStatusMap.set(item.id, "expired");
        if (item.insightId) {
          this.insightStore.updateStatus(item.insightId, "expired" as InsightStatus);
        }
        expiredCount++;
      }
    }

    return expiredCount;
  }

  /**
   * Dismiss all items for a student
   */
  dismissAllForStudent(studentId: string, teacherId: string, reason?: string): number {
    const items = this.getStudentActionableItems(studentId);
    let dismissedCount = 0;

    for (const item of items) {
      const result = this.takeAction({
        itemId: item.id,
        action: "dismiss",
        teacherId,
        note: reason || "Bulk dismissed",
      });

      if (result.success) dismissedCount++;
    }

    return dismissedCount;
  }

  /**
   * Approve all items for an assignment
   */
  approveAllForAssignment(assignmentId: string, teacherId: string): number {
    const items = this.getAssignmentActionableItems(assignmentId);
    let approvedCount = 0;

    for (const item of items) {
      const result = this.takeAction({
        itemId: item.id,
        action: "approve",
        teacherId,
      });

      if (result.success) approvedCount++;
    }

    return approvedCount;
  }

  // ============================================
  // Statistics
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
    const pendingInsights = this.insightStore.getPending();
    const allInsights = this.insightStore.getAll();
    const students = this.studentStore.getAll();
    const lessons = getAllLessons();

    // Build all items to get current status
    const allItems = this.buildActionableItems(allInsights, students, lessons);

    let pending = 0;
    let approved = 0;
    let dismissed = 0;
    let expired = 0;
    const byUrgency = { immediate: 0, soon: 0, when_available: 0 };
    const byType: Record<string, number> = {};

    for (const item of allItems) {
      // Count by status
      switch (item.status) {
        case "pending":
          pending++;
          break;
        case "approved":
        case "modified":
        case "completed":
          approved++;
          break;
        case "dismissed":
          dismissed++;
          break;
        case "expired":
          expired++;
          break;
      }

      // Count by urgency (only pending items)
      if (item.status === "pending") {
        byUrgency[item.urgency]++;
      }

      // Count by type
      byType[item.insightType] = (byType[item.insightType] || 0) + 1;
    }

    return {
      pending,
      approved,
      dismissed,
      expired,
      byUrgency,
      byType,
    };
  }
}

// ============================================
// Export singleton instance
// ============================================

export const workflowService = new WorkflowService();
