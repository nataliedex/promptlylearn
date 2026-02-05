/**
 * CoachingInviteStore - Persistence layer for Coaching Session Invites
 *
 * Stores teacher-pushed enrichment coaching invites.
 * Follows the same pattern as other stores (JSON file persistence).
 */

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  CoachingInvite,
  CoachingInviteStatus,
  CreateCoachingInviteInput,
  UpdateCoachingInviteInput,
  createEnrichmentGuardrails,
} from "../domain/coachingInvite";

const DATA_FILE = path.join(__dirname, "../../data/coaching-invites.json");

interface CoachingInviteData {
  invites: CoachingInvite[];
  lastUpdated: string;
}

export class CoachingInviteStore {
  constructor() {
    // Ensure data directory exists
    const dataDir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }

  // ============================================
  // CRUD Operations
  // ============================================

  /**
   * Create a new coaching invite
   */
  create(input: CreateCoachingInviteInput): CoachingInvite {
    const data = this.loadData();
    const now = new Date().toISOString();

    // Create guardrails based on subject and title
    const guardrails = createEnrichmentGuardrails(
      input.subject,
      input.title,
      input.assignmentTitle
    );

    const invite: CoachingInvite = {
      id: randomUUID(),
      teacherId: input.teacherId,
      studentId: input.studentId,
      classId: input.classId,
      subject: input.subject,
      assignmentId: input.assignmentId,
      assignmentTitle: input.assignmentTitle,
      title: input.title,
      teacherNote: input.teacherNote,
      guardrails,
      status: "pending",
      createdAt: now,
      sourceRecommendationId: input.sourceRecommendationId,
    };

    data.invites.push(invite);
    this.writeData(data);

    return invite;
  }

  /**
   * Load an invite by ID
   */
  load(id: string): CoachingInvite | null {
    const data = this.loadData();
    return data.invites.find((inv) => inv.id === id) || null;
  }

  /**
   * Get all invites
   */
  getAll(): CoachingInvite[] {
    const data = this.loadData();
    return data.invites;
  }

  /**
   * Get invites by student
   */
  getByStudent(studentId: string, status?: CoachingInviteStatus): CoachingInvite[] {
    const data = this.loadData();
    return data.invites.filter((inv) => {
      if (inv.studentId !== studentId) return false;
      if (status && inv.status !== status) return false;
      return true;
    });
  }

  /**
   * Get invites by teacher
   */
  getByTeacher(teacherId: string, status?: CoachingInviteStatus): CoachingInvite[] {
    const data = this.loadData();
    return data.invites.filter((inv) => {
      if (inv.teacherId !== teacherId) return false;
      if (status && inv.status !== status) return false;
      return true;
    });
  }

  /**
   * Get invites by status
   */
  getByStatus(status: CoachingInviteStatus): CoachingInvite[] {
    const data = this.loadData();
    return data.invites.filter((inv) => inv.status === status);
  }

  /**
   * Get pending invites for a student (for badge count)
   */
  getPendingForStudent(studentId: string): CoachingInvite[] {
    return this.getByStudent(studentId, "pending");
  }

  /**
   * Get invites for a specific student + assignment
   */
  getByStudentAssignment(studentId: string, assignmentId: string): CoachingInvite[] {
    const data = this.loadData();
    return data.invites.filter(
      (inv) => inv.studentId === studentId && inv.assignmentId === assignmentId
    );
  }

  /**
   * Update an invite
   */
  update(id: string, updates: UpdateCoachingInviteInput): CoachingInvite | null {
    const data = this.loadData();
    const invite = data.invites.find((inv) => inv.id === id);

    if (!invite) return null;

    // Apply updates
    if (updates.status !== undefined) invite.status = updates.status;
    if (updates.startedAt !== undefined) invite.startedAt = updates.startedAt;
    if (updates.completedAt !== undefined) invite.completedAt = updates.completedAt;
    if (updates.lastActivityAt !== undefined) invite.lastActivityAt = updates.lastActivityAt;
    if (updates.dismissedAt !== undefined) invite.dismissedAt = updates.dismissedAt;
    if (updates.messageCount !== undefined) invite.messageCount = updates.messageCount;

    this.writeData(data);
    return invite;
  }

  /**
   * Mark an invite as started
   */
  markStarted(id: string): CoachingInvite | null {
    const now = new Date().toISOString();
    return this.update(id, {
      status: "started",
      startedAt: now,
      lastActivityAt: now,
    });
  }

  /**
   * Mark an invite as completed
   */
  markCompleted(id: string, messageCount?: number): CoachingInvite | null {
    const now = new Date().toISOString();
    return this.update(id, {
      status: "completed",
      completedAt: now,
      lastActivityAt: now,
      messageCount,
    });
  }

  /**
   * Mark an invite as dismissed
   */
  markDismissed(id: string): CoachingInvite | null {
    const now = new Date().toISOString();
    return this.update(id, {
      status: "dismissed",
      dismissedAt: now,
    });
  }

  /**
   * Update last activity timestamp
   */
  updateActivity(id: string, messageCount?: number): CoachingInvite | null {
    const now = new Date().toISOString();
    return this.update(id, {
      lastActivityAt: now,
      messageCount,
    });
  }

  /**
   * Delete an invite (admin use only)
   */
  delete(id: string): boolean {
    const data = this.loadData();
    const index = data.invites.findIndex((inv) => inv.id === id);

    if (index === -1) return false;

    data.invites.splice(index, 1);
    this.writeData(data);
    return true;
  }

  /**
   * Get counts by status
   */
  getCounts(studentId?: string): {
    pending: number;
    started: number;
    completed: number;
    dismissed: number;
    total: number;
  } {
    const data = this.loadData();
    let invites = data.invites;

    if (studentId) {
      invites = invites.filter((inv) => inv.studentId === studentId);
    }

    return {
      pending: invites.filter((inv) => inv.status === "pending").length,
      started: invites.filter((inv) => inv.status === "started").length,
      completed: invites.filter((inv) => inv.status === "completed").length,
      dismissed: invites.filter((inv) => inv.status === "dismissed").length,
      total: invites.length,
    };
  }

  // ============================================
  // File I/O
  // ============================================

  private loadData(): CoachingInviteData {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const content = fs.readFileSync(DATA_FILE, "utf-8");
        return JSON.parse(content);
      }
    } catch (err) {
      console.error("Error loading coaching invites:", err);
    }

    return {
      invites: [],
      lastUpdated: new Date().toISOString(),
    };
  }

  private writeData(data: CoachingInviteData): void {
    data.lastUpdated = new Date().toISOString();
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  }
}

// Export singleton instance
export const coachingInviteStore = new CoachingInviteStore();
