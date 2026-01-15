import fs from "fs";
import path from "path";
import {
  Recommendation,
  RecommendationStatus,
  FeedbackType,
  RECOMMENDATION_CONFIG,
} from "../domain/recommendation";

const DATA_FILE = path.join(__dirname, "../../data/recommendations.json");

/**
 * RecommendationStore handles persistence for teacher recommendations.
 *
 * Uses a consolidated JSON file since recommendations are:
 * - Queried as a group (active recommendations)
 * - Limited in number (typically <20 active at any time)
 * - Need efficient filtering by status
 */

interface RecommendationsData {
  recommendations: Recommendation[];
  lastUpdated: string;
}

export class RecommendationStore {
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
   * Save a new recommendation or update existing one
   */
  save(recommendation: Recommendation): void {
    const data = this.loadAll();
    const existingIndex = data.recommendations.findIndex((r) => r.id === recommendation.id);

    if (existingIndex >= 0) {
      data.recommendations[existingIndex] = recommendation;
    } else {
      data.recommendations.push(recommendation);
    }

    this.writeData(data);
  }

  /**
   * Save multiple recommendations at once (for batch operations)
   */
  saveMany(recommendations: Recommendation[]): void {
    const data = this.loadAll();

    for (const rec of recommendations) {
      const existingIndex = data.recommendations.findIndex((r) => r.id === rec.id);
      if (existingIndex >= 0) {
        data.recommendations[existingIndex] = rec;
      } else {
        data.recommendations.push(rec);
      }
    }

    this.writeData(data);
  }

  /**
   * Load a single recommendation by ID
   */
  load(id: string): Recommendation | null {
    const data = this.loadAll();
    return data.recommendations.find((r) => r.id === id) || null;
  }

  /**
   * Delete a recommendation by ID
   */
  delete(id: string): boolean {
    const data = this.loadAll();
    const initialLength = data.recommendations.length;
    data.recommendations = data.recommendations.filter((r) => r.id !== id);

    if (data.recommendations.length < initialLength) {
      this.writeData(data);
      return true;
    }
    return false;
  }

  // ============================================
  // Query Methods
  // ============================================

  /**
   * Get all active recommendations, sorted by priority (highest first)
   */
  getActive(): Recommendation[] {
    const data = this.loadAll();
    return data.recommendations
      .filter((r) => r.status === "active")
      .sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get active recommendations, limited to N
   */
  getActiveLimit(limit: number = RECOMMENDATION_CONFIG.MAX_ACTIVE_RECOMMENDATIONS): Recommendation[] {
    return this.getActive().slice(0, limit);
  }

  /**
   * Get recommendations by status
   */
  getByStatus(status: RecommendationStatus): Recommendation[] {
    const data = this.loadAll();
    return data.recommendations
      .filter((r) => r.status === status)
      .sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get recommendations for a specific assignment
   */
  getByAssignment(assignmentId: string): Recommendation[] {
    const data = this.loadAll();
    return data.recommendations
      .filter((r) => r.assignmentId === assignmentId)
      .sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get recommendations involving a specific student
   */
  getByStudent(studentId: string): Recommendation[] {
    const data = this.loadAll();
    return data.recommendations
      .filter((r) => r.studentIds.includes(studentId))
      .sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get recommendations from the last N days
   */
  getRecent(days: number): Recommendation[] {
    const data = this.loadAll();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    return data.recommendations
      .filter((r) => new Date(r.createdAt) >= cutoff)
      .sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get all recommendations (for admin/debugging)
   */
  getAll(): Recommendation[] {
    return this.loadAll().recommendations;
  }

  // ============================================
  // State Mutations
  // ============================================

  /**
   * Mark a recommendation as reviewed
   */
  markReviewed(id: string, reviewedBy?: string): Recommendation | null {
    const rec = this.load(id);
    if (!rec) return null;

    rec.status = "reviewed";
    rec.reviewedAt = new Date().toISOString();
    if (reviewedBy) {
      rec.reviewedBy = reviewedBy;
    }

    this.save(rec);
    return rec;
  }

  /**
   * Dismiss a recommendation (teacher chose to ignore)
   */
  dismiss(id: string): Recommendation | null {
    const rec = this.load(id);
    if (!rec) return null;

    rec.status = "dismissed";
    rec.reviewedAt = new Date().toISOString();

    this.save(rec);
    return rec;
  }

  /**
   * Add feedback to a recommendation
   */
  addFeedback(id: string, feedback: FeedbackType, note?: string): Recommendation | null {
    const rec = this.load(id);
    if (!rec) return null;

    rec.feedback = feedback;
    if (note) {
      rec.feedbackNote = note;
    }

    this.save(rec);
    return rec;
  }

  // ============================================
  // Maintenance Operations
  // ============================================

  /**
   * Remove old reviewed/dismissed recommendations to keep the file lean
   * Returns count of pruned recommendations
   */
  pruneOld(daysOld: number = RECOMMENDATION_CONFIG.PRUNE_AFTER_DAYS): number {
    const data = this.loadAll();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysOld);

    const initialLength = data.recommendations.length;
    data.recommendations = data.recommendations.filter((r) => {
      // Keep active recommendations
      if (r.status === "active") return true;

      // For reviewed/dismissed, check age
      const reviewedDate = r.reviewedAt ? new Date(r.reviewedAt) : new Date(r.createdAt);
      return reviewedDate >= cutoff;
    });

    const pruned = initialLength - data.recommendations.length;
    if (pruned > 0) {
      this.writeData(data);
    }

    return pruned;
  }

  /**
   * Clear all active recommendations (for refresh)
   * Returns count of cleared
   */
  clearActive(): number {
    const data = this.loadAll();
    const initialActive = data.recommendations.filter((r) => r.status === "active").length;

    data.recommendations = data.recommendations.filter((r) => r.status !== "active");
    this.writeData(data);

    return initialActive;
  }

  /**
   * Check if a recommendation already exists (to avoid duplicates)
   * Matches on rule name + student IDs + assignment ID
   */
  exists(ruleName: string, studentIds: string[], assignmentId?: string): boolean {
    const data = this.loadAll();
    const sortedStudentIds = [...studentIds].sort().join(",");

    return data.recommendations.some((r) => {
      if (r.status !== "active") return false;
      if (r.triggerData.ruleName !== ruleName) return false;
      if (r.assignmentId !== assignmentId) return false;

      const recStudentIds = [...r.studentIds].sort().join(",");
      return recStudentIds === sortedStudentIds;
    });
  }

  // ============================================
  // Statistics
  // ============================================

  /**
   * Get recommendation statistics for dashboard
   */
  getStats(): { totalActive: number; reviewedToday: number; feedbackRate: number } {
    const data = this.loadAll();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const active = data.recommendations.filter((r) => r.status === "active");
    const reviewedToday = data.recommendations.filter((r) => {
      if (r.status !== "reviewed" || !r.reviewedAt) return false;
      return new Date(r.reviewedAt) >= today;
    });

    const reviewed = data.recommendations.filter((r) => r.status === "reviewed");
    const withFeedback = reviewed.filter((r) => r.feedback);
    const feedbackRate = reviewed.length > 0 ? (withFeedback.length / reviewed.length) * 100 : 0;

    return {
      totalActive: active.length,
      reviewedToday: reviewedToday.length,
      feedbackRate: Math.round(feedbackRate),
    };
  }

  // ============================================
  // Private Helpers
  // ============================================

  private loadAll(): RecommendationsData {
    if (!fs.existsSync(DATA_FILE)) {
      return { recommendations: [], lastUpdated: new Date().toISOString() };
    }

    try {
      const content = fs.readFileSync(DATA_FILE, "utf-8");
      return JSON.parse(content) as RecommendationsData;
    } catch (err) {
      console.error("Error loading recommendations:", err);
      return { recommendations: [], lastUpdated: new Date().toISOString() };
    }
  }

  private writeData(data: RecommendationsData): void {
    data.lastUpdated = new Date().toISOString();
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  }
}

// Export singleton instance
export const recommendationStore = new RecommendationStore();
