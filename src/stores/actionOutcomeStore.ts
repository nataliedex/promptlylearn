import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  ActionOutcome,
  CreateActionOutcomeInput,
  ResolutionStatus,
} from "../domain/actionOutcome";

const DATA_FILE = path.join(__dirname, "../../data/action-outcomes.json");

/**
 * ActionOutcomeStore handles persistence for action outcomes.
 *
 * Action outcomes track what happens after a teacher acts on a recommendation,
 * enabling smart follow-ups and preventing duplicate recommendations.
 */

interface ActionOutcomesData {
  outcomes: ActionOutcome[];
  lastUpdated: string;
}

export class ActionOutcomeStore {
  constructor() {
    // Ensure the data directory exists
    const dataDir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }

  // ============================================
  // Core CRUD Operations
  // ============================================

  /**
   * Save a new action outcome
   */
  save(input: CreateActionOutcomeInput): ActionOutcome {
    const data = this.loadAll();

    const outcome: ActionOutcome = {
      id: randomUUID(),
      ...input,
      actedAt: new Date().toISOString(),
    };

    data.outcomes.push(outcome);
    this.writeData(data);

    return outcome;
  }

  /**
   * Load an action outcome by ID
   */
  load(id: string): ActionOutcome | null {
    const data = this.loadAll();
    return data.outcomes.find((o) => o.id === id) || null;
  }

  /**
   * Update an existing action outcome
   */
  update(id: string, updates: Partial<ActionOutcome>): ActionOutcome | null {
    const data = this.loadAll();
    const index = data.outcomes.findIndex((o) => o.id === id);

    if (index < 0) return null;

    data.outcomes[index] = { ...data.outcomes[index], ...updates };
    this.writeData(data);

    return data.outcomes[index];
  }

  /**
   * Delete an action outcome by ID
   */
  delete(id: string): boolean {
    const data = this.loadAll();
    const initialLength = data.outcomes.length;
    data.outcomes = data.outcomes.filter((o) => o.id !== id);

    if (data.outcomes.length < initialLength) {
      this.writeData(data);
      return true;
    }
    return false;
  }

  // ============================================
  // Query Methods
  // ============================================

  /**
   * Get outcome for a specific recommendation
   */
  getByRecommendation(recommendationId: string): ActionOutcome | null {
    const data = this.loadAll();
    return data.outcomes.find((o) => o.recommendationId === recommendationId) || null;
  }

  /**
   * Get all outcomes affecting a specific student
   */
  getByStudent(studentId: string): ActionOutcome[] {
    const data = this.loadAll();
    return data.outcomes.filter((o) => o.affectedStudentIds.includes(studentId));
  }

  /**
   * Get all pending outcomes (awaiting student action)
   */
  getPending(): ActionOutcome[] {
    const data = this.loadAll();
    return data.outcomes.filter((o) => o.resolutionStatus === "pending");
  }

  /**
   * Get outcomes by resolution status
   */
  getByResolution(status: ResolutionStatus): ActionOutcome[] {
    const data = this.loadAll();
    return data.outcomes.filter((o) => o.resolutionStatus === status);
  }

  /**
   * Get outcomes for a specific assignment
   */
  getByAssignment(assignmentId: string): ActionOutcome[] {
    const data = this.loadAll();
    return data.outcomes.filter((o) => o.affectedAssignmentId === assignmentId);
  }

  /**
   * Get all outcomes
   */
  getAll(): ActionOutcome[] {
    return this.loadAll().outcomes;
  }

  // ============================================
  // State Mutations
  // ============================================

  /**
   * Update the resolution status of an outcome
   */
  updateResolution(id: string, status: ResolutionStatus): ActionOutcome | null {
    return this.update(id, { resolutionStatus: status });
  }

  // ============================================
  // Smart Queries (for duplicate prevention)
  // ============================================

  /**
   * Check if there's a completed badge outcome for a student+assignment combo
   */
  hasCompletedBadgeForAssignment(studentId: string, assignmentId: string): boolean {
    const data = this.loadAll();
    return data.outcomes.some(
      (o) =>
        o.actionType === "award_badge" &&
        o.resolutionStatus === "completed" &&
        o.affectedStudentIds.includes(studentId) &&
        o.affectedAssignmentId === assignmentId
    );
  }

  /**
   * Check if there's a pending reassign outcome for a student+assignment combo
   */
  hasPendingReassignForAssignment(studentId: string, assignmentId: string): boolean {
    const data = this.loadAll();
    return data.outcomes.some(
      (o) =>
        o.actionType === "reassign" &&
        o.resolutionStatus === "pending" &&
        o.affectedStudentIds.includes(studentId) &&
        o.affectedAssignmentId === assignmentId
    );
  }

  /**
   * Get pending reassign outcomes for a student
   */
  getPendingReassignsForStudent(studentId: string): ActionOutcome[] {
    const data = this.loadAll();
    return data.outcomes.filter(
      (o) =>
        o.actionType === "reassign" &&
        o.resolutionStatus === "pending" &&
        o.affectedStudentIds.includes(studentId)
    );
  }

  // ============================================
  // Private Helpers
  // ============================================

  private loadAll(): ActionOutcomesData {
    if (!fs.existsSync(DATA_FILE)) {
      return { outcomes: [], lastUpdated: new Date().toISOString() };
    }

    try {
      const content = fs.readFileSync(DATA_FILE, "utf-8");
      return JSON.parse(content) as ActionOutcomesData;
    } catch (err) {
      console.error("Error loading action outcomes:", err);
      return { outcomes: [], lastUpdated: new Date().toISOString() };
    }
  }

  private writeData(data: ActionOutcomesData): void {
    data.lastUpdated = new Date().toISOString();
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  }
}

// Export singleton instance
export const actionOutcomeStore = new ActionOutcomeStore();
