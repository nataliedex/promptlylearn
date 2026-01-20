/**
 * Teacher Action Service
 *
 * Consolidates all teacher actions for the educator workflow:
 * - Mark insight as reviewed
 * - Push assignment back to student
 * - Add note to student
 * - Award badge
 *
 * All actions:
 * - Update the appropriate domain objects (Insight, AssignmentStudent, Badge)
 * - Create TeacherAction records for audit trail
 * - Ensure dashboard summaries reflect current state
 */

import { StudentStore } from "../stores/studentStore";
import { InsightStore } from "../stores/insightStore";
import { TeacherActionStore } from "../stores/teacherActionStore";
import { AssignmentStudentStore } from "../stores/assignmentStudentStore";
import { BadgeStore } from "../stores/badgeStore";
import { Student } from "../domain/student";
import { Insight, InsightStatus, InsightType, InsightPriority } from "../domain/insight";
import { TeacherAction, TeacherActionType, Badge, BadgeType, getBadgeTypeName, isBadgeType } from "../domain/recommendation";
import { AssignmentStudent } from "../domain/studentAssignment";

// ============================================
// Result Types
// ============================================

export interface ActionResult {
  success: boolean;
  error?: string;
  teacherActionId?: string;
}

export interface MarkReviewedResult extends ActionResult {
  insightUpdated: boolean;
  newStatus: InsightStatus;
}

export interface PushBackResult extends ActionResult {
  newAttemptNumber: number;
  assignmentUpdated: boolean;
}

export interface AddNoteResult extends ActionResult {
  noteAdded: boolean;
  studentUpdated: boolean;
}

export interface AwardBadgeResult extends ActionResult {
  badgeId?: string;
  badgeType: BadgeType;
}

// ============================================
// Input Types
// ============================================

export interface MarkReviewedInput {
  insightId: string;
  teacherId: string;
  status?: InsightStatus; // Default: action_taken
  note?: string;
}

export interface PushBackInput {
  studentId: string;
  assignmentId: string;
  teacherId: string;
  message?: string; // Optional message to student
  reason?: string; // Teacher's reason for pushing back
}

export interface AddNoteInput {
  studentId: string;
  teacherId: string;
  note: string;
  assignmentId?: string; // Optional: note can be assignment-specific
  insightId?: string; // Optional: note can be linked to an insight
}

export interface AwardBadgeInput {
  studentId: string;
  teacherId: string;
  badgeType: string; // Badge type ID
  message?: string; // Optional message for the student
  assignmentId?: string; // Optional: badge can be assignment-specific
  insightId?: string; // Optional: badge can be linked to an insight
}

// ============================================
// Main Service Class
// ============================================

export class TeacherActionService {
  private studentStore: StudentStore;
  private insightStore: InsightStore;
  private teacherActionStore: TeacherActionStore;
  private assignmentStudentStore: AssignmentStudentStore;
  private badgeStore: BadgeStore;

  constructor() {
    this.studentStore = new StudentStore();
    this.insightStore = new InsightStore();
    this.teacherActionStore = new TeacherActionStore();
    this.assignmentStudentStore = new AssignmentStudentStore();
    this.badgeStore = new BadgeStore();
  }

  // ============================================
  // 1. Mark Insight as Reviewed
  // ============================================

  /**
   * Mark an insight as reviewed.
   * - Updates Insight.status to action_taken (or specified status)
   * - Creates a TeacherAction record linked to the Insight
   * - Insight is removed from pending dashboard
   */
  markInsightReviewed(input: MarkReviewedInput): MarkReviewedResult {
    const { insightId, teacherId, status = "action_taken", note } = input;

    // Load the insight
    const insight = this.insightStore.load(insightId);
    if (!insight) {
      return {
        success: false,
        error: `Insight not found: ${insightId}`,
        insightUpdated: false,
        newStatus: "pending_review",
      };
    }

    // Update insight status
    const updatedInsight = this.insightStore.updateStatus(insightId, status, teacherId);
    if (!updatedInsight) {
      return {
        success: false,
        error: "Failed to update insight status",
        insightUpdated: false,
        newStatus: insight.status,
      };
    }

    // Create teacher action record
    const teacherAction: TeacherAction = {
      id: `ta-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      insightId,
      teacherId,
      actionType: "mark_reviewed",
      note,
      createdAt: new Date(),
    };
    this.teacherActionStore.save(teacherAction);

    return {
      success: true,
      teacherActionId: teacherAction.id,
      insightUpdated: true,
      newStatus: status,
    };
  }

  /**
   * Dismiss an insight without taking action
   */
  dismissInsight(insightId: string, teacherId: string, reason?: string): MarkReviewedResult {
    return this.markInsightReviewed({
      insightId,
      teacherId,
      status: "dismissed",
      note: reason || "Dismissed without action",
    });
  }

  /**
   * Set insight to monitoring status
   */
  monitorInsight(insightId: string, teacherId: string, note?: string): MarkReviewedResult {
    return this.markInsightReviewed({
      insightId,
      teacherId,
      status: "monitoring",
      note,
    });
  }

  // ============================================
  // 2. Push Assignment Back to Student
  // ============================================

  /**
   * Push an assignment back to a student for retry.
   * - Updates AssignmentStudent to allow a new attempt
   * - Tracks previous attempts
   * - Creates a TeacherAction record
   * - Creates a check_in insight for tracking
   */
  pushAssignmentBack(input: PushBackInput): PushBackResult {
    const { studentId, assignmentId, teacherId, message, reason } = input;

    // Load current assignment record
    let record = this.assignmentStudentStore.load(studentId, assignmentId);

    if (!record) {
      // Create a new record if none exists
      record = {
        studentId,
        assignmentId,
        attempts: 0,
        currentAttempt: 0,
      };
    }

    // Increment attempts to allow retry
    const previousAttempts = record.attempts;
    record.attempts = previousAttempts + 1;
    record.currentAttempt = record.attempts;

    // Clear completion status to allow retry
    // Keep historical data (firstCompletedAt, highestScore) for tracking
    record.lastCompletedAt = undefined;
    record.score = undefined;

    // Save updated record
    this.assignmentStudentStore.save(record);

    // Create or update an insight for this reassignment
    const insightId = this.createReassignmentInsight(studentId, assignmentId, teacherId, reason);

    // Create teacher action record
    const teacherAction: TeacherAction = {
      id: `ta-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      insightId,
      teacherId,
      actionType: "reassign",
      note: reason,
      messageToStudent: message,
      createdAt: new Date(),
    };
    this.teacherActionStore.save(teacherAction);

    return {
      success: true,
      teacherActionId: teacherAction.id,
      newAttemptNumber: record.attempts,
      assignmentUpdated: true,
    };
  }

  /**
   * Create an insight for tracking reassignment
   */
  private createReassignmentInsight(
    studentId: string,
    assignmentId: string,
    teacherId: string,
    reason?: string
  ): string {
    // Check if there's already a pending insight for this reassignment
    const existing = this.insightStore.findExisting(studentId, assignmentId, "check_in");
    if (existing) {
      return existing.id;
    }

    // Get student's class for the insight
    const student = this.studentStore.load(studentId);
    const classId = student?.classes?.[0] || "";

    const insight: Insight = {
      id: `insight-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      studentId,
      assignmentId,
      classId,
      type: "check_in",
      priority: "medium",
      confidence: 1.0,
      summary: `Assignment reassigned for retry${reason ? `: ${reason}` : ""}`,
      evidence: ["Teacher requested student retry assignment"],
      suggestedActions: ["Monitor student progress on retry attempt"],
      status: "monitoring",
      createdAt: new Date(),
      reviewedAt: new Date(),
      reviewedBy: teacherId,
    };

    this.insightStore.save(insight);
    return insight.id;
  }

  // ============================================
  // 3. Add Note to Student
  // ============================================

  /**
   * Add a note to a student.
   * - Updates Student.notes field
   * - Creates a TeacherAction record
   * - Optionally links to an insight or assignment
   */
  addNoteToStudent(input: AddNoteInput): AddNoteResult {
    const { studentId, teacherId, note, assignmentId, insightId } = input;

    // Load student
    const student = this.studentStore.load(studentId);
    if (!student) {
      return {
        success: false,
        error: `Student not found: ${studentId}`,
        noteAdded: false,
        studentUpdated: false,
      };
    }

    // Append note to student's notes (with timestamp)
    const timestamp = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    const formattedNote = `[${timestamp}] ${note}`;
    student.notes = student.notes
      ? `${student.notes}\n\n${formattedNote}`
      : formattedNote;

    // Save updated student
    this.studentStore.save(student);

    // Get or create an insight to link the action to
    let targetInsightId = insightId;
    if (!targetInsightId) {
      // Check for existing insight or create a monitor one
      const existing = this.insightStore.getByStudent(studentId, false)[0];
      if (existing) {
        targetInsightId = existing.id;
      } else {
        // Create a monitor insight for this note
        const newInsight: Insight = {
          id: `insight-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          studentId,
          assignmentId,
          classId: student.classes?.[0] || "",
          type: "monitor",
          priority: "low",
          confidence: 1.0,
          summary: "Teacher added note",
          evidence: [],
          suggestedActions: [],
          status: "action_taken",
          createdAt: new Date(),
          reviewedAt: new Date(),
          reviewedBy: teacherId,
        };
        this.insightStore.save(newInsight);
        targetInsightId = newInsight.id;
      }
    }

    // Create teacher action record
    const teacherAction: TeacherAction = {
      id: `ta-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      insightId: targetInsightId,
      teacherId,
      actionType: "add_note",
      note,
      createdAt: new Date(),
    };
    this.teacherActionStore.save(teacherAction);

    return {
      success: true,
      teacherActionId: teacherAction.id,
      noteAdded: true,
      studentUpdated: true,
    };
  }

  // ============================================
  // 4. Award Badge
  // ============================================

  /**
   * Award a badge to a student.
   * - Creates a Badge object linked to studentId
   * - Optionally links to assignmentId and/or insightId
   * - Creates a TeacherAction record
   */
  awardBadge(input: AwardBadgeInput): AwardBadgeResult {
    const { studentId, teacherId, badgeType, message, assignmentId, insightId } = input;

    // Validate badge type
    const validBadgeType: BadgeType = isBadgeType(badgeType) ? badgeType : "progress_star";

    // Verify student exists
    const student = this.studentStore.load(studentId);
    if (!student) {
      return {
        success: false,
        error: `Student not found: ${studentId}`,
        badgeType: validBadgeType,
      };
    }

    // Create badge
    const badge: Badge = {
      id: `badge-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      studentId,
      awardedBy: teacherId,
      type: validBadgeType,
      message,
      assignmentId,
      insightId,
      issuedAt: new Date(),
    };
    this.badgeStore.save(badge);

    // Get or create an insight to link the action to
    let targetInsightId = insightId;
    if (!targetInsightId) {
      // Create a celebrate_progress insight
      const newInsight: Insight = {
        id: `insight-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        studentId,
        assignmentId,
        classId: student.classes?.[0] || "",
        type: "celebrate_progress",
        priority: "low",
        confidence: 1.0,
        summary: `Awarded ${getBadgeTypeName(validBadgeType)} badge`,
        evidence: [`Teacher ${teacherId} awarded badge`],
        suggestedActions: [],
        status: "action_taken",
        createdAt: new Date(),
        reviewedAt: new Date(),
        reviewedBy: teacherId,
      };
      this.insightStore.save(newInsight);
      targetInsightId = newInsight.id;
    } else {
      // Mark the insight as action_taken
      this.insightStore.updateStatus(insightId!, "action_taken", teacherId);
    }

    // Create teacher action record
    const teacherAction: TeacherAction = {
      id: `ta-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      insightId: targetInsightId,
      teacherId,
      actionType: "award_badge",
      note: `Awarded ${getBadgeTypeName(validBadgeType)} badge${message ? `: ${message}` : ""}`,
      createdAt: new Date(),
    };
    this.teacherActionStore.save(teacherAction);

    return {
      success: true,
      teacherActionId: teacherAction.id,
      badgeId: badge.id,
      badgeType: validBadgeType,
    };
  }

  // ============================================
  // 5. Schedule Check-in (Future Feature)
  // ============================================

  /**
   * Schedule a check-in with a student
   * (Creates an action record for future implementation)
   */
  scheduleCheckin(
    studentId: string,
    teacherId: string,
    insightId?: string,
    note?: string
  ): ActionResult {
    // Get or create insight
    let targetInsightId = insightId;
    if (!targetInsightId) {
      const student = this.studentStore.load(studentId);
      const newInsight: Insight = {
        id: `insight-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        studentId,
        classId: student?.classes?.[0] || "",
        type: "check_in",
        priority: "medium",
        confidence: 1.0,
        summary: "Check-in scheduled by teacher",
        evidence: [],
        suggestedActions: ["Have conversation with student"],
        status: "monitoring",
        createdAt: new Date(),
        reviewedAt: new Date(),
        reviewedBy: teacherId,
      };
      this.insightStore.save(newInsight);
      targetInsightId = newInsight.id;
    } else {
      this.insightStore.updateStatus(insightId!, "monitoring", teacherId);
    }

    // Create teacher action
    const teacherAction: TeacherAction = {
      id: `ta-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      insightId: targetInsightId,
      teacherId,
      actionType: "schedule_checkin",
      note,
      createdAt: new Date(),
    };
    this.teacherActionStore.save(teacherAction);

    return {
      success: true,
      teacherActionId: teacherAction.id,
    };
  }

  // ============================================
  // Bulk Operations
  // ============================================

  /**
   * Mark all pending insights as reviewed for an assignment
   */
  markAllInsightsReviewed(assignmentId: string, teacherId: string): number {
    const insights = this.insightStore.getByAssignment(assignmentId);
    const pending = insights.filter((i) => i.status === "pending_review");

    let count = 0;
    for (const insight of pending) {
      const result = this.markInsightReviewed({
        insightId: insight.id,
        teacherId,
      });
      if (result.success) count++;
    }

    return count;
  }

  /**
   * Dismiss all pending insights for a student
   */
  dismissAllStudentInsights(studentId: string, teacherId: string, reason?: string): number {
    const insights = this.insightStore.getByStudent(studentId, false);

    let count = 0;
    for (const insight of insights) {
      if (insight.status === "pending_review") {
        const result = this.dismissInsight(insight.id, teacherId, reason);
        if (result.success) count++;
      }
    }

    return count;
  }

  // ============================================
  // Query Methods
  // ============================================

  /**
   * Get all actions for a teacher
   */
  getTeacherActions(teacherId: string): TeacherAction[] {
    return this.teacherActionStore.getByTeacher(teacherId);
  }

  /**
   * Get recent actions
   */
  getRecentActions(limit: number = 20): TeacherAction[] {
    return this.teacherActionStore.getRecent(limit);
  }

  /**
   * Get actions for an insight
   */
  getInsightActions(insightId: string): TeacherAction[] {
    return this.teacherActionStore.getByInsight(insightId);
  }
}

// ============================================
// Export singleton instance
// ============================================

export const teacherActionService = new TeacherActionService();
