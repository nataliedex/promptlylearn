import fs from "fs";
import path from "path";
import { TeacherAction, TeacherActionType } from "../domain/recommendation";

const DATA_FILE = path.join(__dirname, "../../data/teacher-actions.json");

/**
 * TeacherActionStore handles persistence for teacher actions on insights.
 *
 * Teacher actions are separate from insights to:
 * - Preserve complete history of teacher responses
 * - Enable analytics on teacher engagement patterns
 * - Support multiple actions per insight over time
 */

interface TeacherActionsData {
  actions: TeacherAction[];
  lastUpdated: string;
}

export class TeacherActionStore {
  constructor() {
    const dataDir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }

  // ============================================
  // Core CRUD Operations
  // ============================================

  /**
   * Save a new action
   */
  save(action: TeacherAction): void {
    const data = this.loadAll();
    const existingIndex = data.actions.findIndex((a) => a.id === action.id);

    if (existingIndex >= 0) {
      data.actions[existingIndex] = action;
    } else {
      data.actions.push(action);
    }

    this.writeData(data);
  }

  /**
   * Load a single action by ID
   */
  load(id: string): TeacherAction | null {
    const data = this.loadAll();
    return data.actions.find((a) => a.id === id) || null;
  }

  /**
   * Delete an action by ID
   */
  delete(id: string): boolean {
    const data = this.loadAll();
    const initialLength = data.actions.length;
    data.actions = data.actions.filter((a) => a.id !== id);

    if (data.actions.length < initialLength) {
      this.writeData(data);
      return true;
    }
    return false;
  }

  // ============================================
  // Query Methods
  // ============================================

  /**
   * Get all actions (for admin/debugging)
   */
  getAll(): TeacherAction[] {
    return this.loadAll().actions;
  }

  /**
   * Get actions for a specific insight
   */
  getByInsight(insightId: string): TeacherAction[] {
    const data = this.loadAll();
    return data.actions
      .filter((a) => a.insightId === insightId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /**
   * Get actions by a specific teacher
   */
  getByTeacher(teacherId: string): TeacherAction[] {
    const data = this.loadAll();
    return data.actions
      .filter((a) => a.teacherId === teacherId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /**
   * Get recent actions (for dashboard)
   */
  getRecent(limit: number = 10): TeacherAction[] {
    const data = this.loadAll();
    return data.actions
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }

  /**
   * Get actions by type
   */
  getByType(actionType: TeacherActionType): TeacherAction[] {
    const data = this.loadAll();
    return data.actions
      .filter((a) => a.actionType === actionType)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /**
   * Get actions from the last N days
   */
  getFromDays(days: number): TeacherAction[] {
    const data = this.loadAll();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    return data.actions
      .filter((a) => new Date(a.createdAt) >= cutoff)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /**
   * Get actions from today
   */
  getToday(): TeacherAction[] {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const data = this.loadAll();
    return data.actions
      .filter((a) => new Date(a.createdAt) >= today)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  // ============================================
  // Statistics
  // ============================================

  /**
   * Get action statistics for a teacher
   */
  getTeacherStats(teacherId: string): {
    totalActions: number;
    actionsToday: number;
    byType: Record<TeacherActionType, number>;
    averageActionsPerDay: number;
  } {
    const actions = this.getByTeacher(teacherId);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const actionsToday = actions.filter((a) => new Date(a.createdAt) >= today).length;

    const byType: Record<TeacherActionType, number> = {
      mark_reviewed: 0,
      add_note: 0,
      draft_message: 0,
      award_badge: 0,
      reassign: 0,
      schedule_checkin: 0,
      other: 0,
    };

    for (const action of actions) {
      byType[action.actionType]++;
    }

    // Calculate average actions per day (over last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentActions = actions.filter((a) => new Date(a.createdAt) >= thirtyDaysAgo);
    const averageActionsPerDay = recentActions.length / 30;

    return {
      totalActions: actions.length,
      actionsToday,
      byType,
      averageActionsPerDay: Math.round(averageActionsPerDay * 10) / 10,
    };
  }

  /**
   * Count actions for an insight
   */
  countByInsight(insightId: string): number {
    const data = this.loadAll();
    return data.actions.filter((a) => a.insightId === insightId).length;
  }

  /**
   * Check if an insight has been acted upon
   */
  hasAction(insightId: string): boolean {
    const data = this.loadAll();
    return data.actions.some((a) => a.insightId === insightId);
  }

  // ============================================
  // Maintenance Operations
  // ============================================

  /**
   * Archive old actions (older than N days)
   */
  archiveOld(daysOld: number = 90): number {
    const data = this.loadAll();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysOld);

    const initialLength = data.actions.length;
    data.actions = data.actions.filter((a) => new Date(a.createdAt) >= cutoff);

    const archived = initialLength - data.actions.length;
    if (archived > 0) {
      this.writeData(data);
    }

    return archived;
  }

  // ============================================
  // Private Helpers
  // ============================================

  private loadAll(): TeacherActionsData {
    if (!fs.existsSync(DATA_FILE)) {
      return { actions: [], lastUpdated: new Date().toISOString() };
    }

    try {
      const content = fs.readFileSync(DATA_FILE, "utf-8");
      return JSON.parse(content) as TeacherActionsData;
    } catch (err) {
      console.error("Error loading teacher actions:", err);
      return { actions: [], lastUpdated: new Date().toISOString() };
    }
  }

  private writeData(data: TeacherActionsData): void {
    data.lastUpdated = new Date().toISOString();
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  }
}

// Export singleton instance
export const teacherActionStore = new TeacherActionStore();
