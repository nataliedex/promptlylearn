import fs from "fs";
import path from "path";
import { Badge, BadgeType, BADGE_TYPES } from "../domain/recommendation";

const DATA_FILE = path.join(__dirname, "../../data/badges.json");

/**
 * BadgeStore handles persistence for student badges.
 *
 * Badges are used to celebrate student progress and achievements.
 * They can be awarded:
 * - In response to "celebrate_progress" insights
 * - Independently by teachers
 */

interface BadgesData {
  badges: Badge[];
  lastUpdated: string;
}

export class BadgeStore {
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
   * Save a new badge or update existing one
   */
  save(badge: Badge): void {
    const data = this.loadAll();
    const existingIndex = data.badges.findIndex((b) => b.id === badge.id);

    if (existingIndex >= 0) {
      data.badges[existingIndex] = badge;
    } else {
      data.badges.push(badge);
    }

    this.writeData(data);
  }

  /**
   * Load a single badge by ID
   */
  load(id: string): Badge | null {
    const data = this.loadAll();
    return data.badges.find((b) => b.id === id) || null;
  }

  /**
   * Delete a badge by ID
   */
  delete(id: string): boolean {
    const data = this.loadAll();
    const initialLength = data.badges.length;
    data.badges = data.badges.filter((b) => b.id !== id);

    if (data.badges.length < initialLength) {
      this.writeData(data);
      return true;
    }
    return false;
  }

  // ============================================
  // Query Methods
  // ============================================

  /**
   * Get all badges (for admin/debugging)
   */
  getAll(): Badge[] {
    return this.loadAll().badges;
  }

  /**
   * Get badges for a specific student
   */
  getByStudent(studentId: string): Badge[] {
    const data = this.loadAll();
    return data.badges
      .filter((b) => b.studentId === studentId)
      .sort((a, b) => new Date(b.issuedAt).getTime() - new Date(a.issuedAt).getTime());
  }

  /**
   * Get badges awarded by a specific teacher
   */
  getByTeacher(teacherId: string): Badge[] {
    const data = this.loadAll();
    return data.badges
      .filter((b) => b.awardedBy === teacherId)
      .sort((a, b) => new Date(b.issuedAt).getTime() - new Date(a.issuedAt).getTime());
  }

  /**
   * Get badges for a specific assignment
   */
  getByAssignment(assignmentId: string): Badge[] {
    const data = this.loadAll();
    return data.badges
      .filter((b) => b.assignmentId === assignmentId)
      .sort((a, b) => new Date(b.issuedAt).getTime() - new Date(a.issuedAt).getTime());
  }

  /**
   * Get badges by type
   */
  getByType(type: BadgeType): Badge[] {
    const data = this.loadAll();
    return data.badges
      .filter((b) => b.type === type)
      .sort((a, b) => new Date(b.issuedAt).getTime() - new Date(a.issuedAt).getTime());
  }

  /**
   * Get badges linked to a specific insight
   */
  getByInsight(insightId: string): Badge[] {
    const data = this.loadAll();
    return data.badges.filter((b) => b.insightId === insightId);
  }

  /**
   * Get recent badges (for dashboard)
   */
  getRecent(limit: number = 10): Badge[] {
    const data = this.loadAll();
    return data.badges
      .sort((a, b) => new Date(b.issuedAt).getTime() - new Date(a.issuedAt).getTime())
      .slice(0, limit);
  }

  /**
   * Get badges from the last N days
   */
  getFromDays(days: number): Badge[] {
    const data = this.loadAll();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    return data.badges
      .filter((b) => new Date(b.issuedAt) >= cutoff)
      .sort((a, b) => new Date(b.issuedAt).getTime() - new Date(a.issuedAt).getTime());
  }

  // ============================================
  // Statistics
  // ============================================

  /**
   * Count badges for a student
   */
  countByStudent(studentId: string): number {
    const data = this.loadAll();
    return data.badges.filter((b) => b.studentId === studentId).length;
  }

  /**
   * Get badge statistics for a student
   */
  getStudentStats(studentId: string): {
    totalBadges: number;
    byType: Record<BadgeType, number>;
    recentBadges: Badge[];
    firstBadgeAt?: Date;
    lastBadgeAt?: Date;
  } {
    const badges = this.getByStudent(studentId);

    const byType: Record<BadgeType, number> = {
      progress_star: 0,
      mastery_badge: 0,
      effort_award: 0,
      helper_badge: 0,
      persistence: 0,
      curiosity: 0,
      focus_badge: 0,
      creativity_badge: 0,
      collaboration_badge: 0,
      custom: 0,
    };

    let firstBadgeAt: Date | undefined;
    let lastBadgeAt: Date | undefined;

    for (const badge of badges) {
      byType[badge.type]++;

      const issuedAt = new Date(badge.issuedAt);
      if (!firstBadgeAt || issuedAt < firstBadgeAt) {
        firstBadgeAt = issuedAt;
      }
      if (!lastBadgeAt || issuedAt > lastBadgeAt) {
        lastBadgeAt = issuedAt;
      }
    }

    return {
      totalBadges: badges.length,
      byType,
      recentBadges: badges.slice(0, 5),
      firstBadgeAt,
      lastBadgeAt,
    };
  }

  /**
   * Get class badge leaderboard
   */
  getClassLeaderboard(studentIds: string[]): {
    studentId: string;
    badgeCount: number;
  }[] {
    const data = this.loadAll();
    const countMap = new Map<string, number>();

    for (const studentId of studentIds) {
      countMap.set(studentId, 0);
    }

    for (const badge of data.badges) {
      if (studentIds.includes(badge.studentId)) {
        countMap.set(badge.studentId, (countMap.get(badge.studentId) || 0) + 1);
      }
    }

    return Array.from(countMap.entries())
      .map(([studentId, badgeCount]) => ({ studentId, badgeCount }))
      .sort((a, b) => b.badgeCount - a.badgeCount);
  }

  /**
   * Get badge type distribution for a class
   */
  getClassBadgeDistribution(studentIds: string[]): Record<BadgeType, number> {
    const data = this.loadAll();
    const distribution: Record<BadgeType, number> = {
      progress_star: 0,
      mastery_badge: 0,
      effort_award: 0,
      helper_badge: 0,
      persistence: 0,
      curiosity: 0,
      focus_badge: 0,
      creativity_badge: 0,
      collaboration_badge: 0,
      custom: 0,
    };

    for (const badge of data.badges) {
      if (studentIds.includes(badge.studentId)) {
        distribution[badge.type]++;
      }
    }

    return distribution;
  }

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Get display name for a badge type
   */
  getBadgeTypeName(type: BadgeType): string {
    return BADGE_TYPES[type];
  }

  /**
   * Check if a student has a specific badge type
   */
  hasType(studentId: string, type: BadgeType): boolean {
    const data = this.loadAll();
    return data.badges.some((b) => b.studentId === studentId && b.type === type);
  }

  /**
   * Check if a badge already exists for a specific insight
   * (to prevent duplicate badges)
   */
  existsForInsight(insightId: string): boolean {
    const data = this.loadAll();
    return data.badges.some((b) => b.insightId === insightId);
  }

  /**
   * Get badges for a student formatted for cooldown checks
   * Used by badge criteria evaluator
   */
  getForCooldownCheck(studentId: string): {
    badgeType: BadgeType;
    subject?: string;
    assignmentId?: string;
    awardedAt: string;
  }[] {
    const badges = this.getByStudent(studentId);
    return badges.map(b => ({
      badgeType: b.type,
      subject: undefined, // Subject not stored on badge currently
      assignmentId: b.assignmentId,
      awardedAt: typeof b.issuedAt === "string" ? b.issuedAt : b.issuedAt.toISOString(),
    }));
  }

  // ============================================
  // Private Helpers
  // ============================================

  private loadAll(): BadgesData {
    if (!fs.existsSync(DATA_FILE)) {
      return { badges: [], lastUpdated: new Date().toISOString() };
    }

    try {
      const content = fs.readFileSync(DATA_FILE, "utf-8");
      return JSON.parse(content) as BadgesData;
    } catch (err) {
      console.error("Error loading badges:", err);
      return { badges: [], lastUpdated: new Date().toISOString() };
    }
  }

  private writeData(data: BadgesData): void {
    data.lastUpdated = new Date().toISOString();
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  }
}

// Export singleton instance
export const badgeStore = new BadgeStore();
