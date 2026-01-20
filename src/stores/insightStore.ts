import fs from "fs";
import path from "path";
import {
  Insight,
  InsightStatus,
  InsightType,
  InsightPriority,
  InsightFilter,
  InsightSortOptions,
  InsightListResponse,
  StudentInsightSummary,
  ClassInsightSummary,
  InsightDashboard,
  INSIGHT_CONFIG,
} from "../domain/insight";

const DATA_FILE = path.join(__dirname, "../../data/insights.json");

/**
 * InsightStore handles persistence for AI-generated insights.
 *
 * Key features:
 * - Flexible filtering and sorting
 * - Status workflow management
 * - Dashboard aggregation
 * - Duplicate detection
 */

interface InsightsData {
  insights: Insight[];
  lastUpdated: string;
}

export class InsightStore {
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
   * Save a new insight or update existing one
   */
  save(insight: Insight): void {
    const data = this.loadAll();
    const existingIndex = data.insights.findIndex((i) => i.id === insight.id);

    if (existingIndex >= 0) {
      data.insights[existingIndex] = insight;
    } else {
      data.insights.push(insight);
    }

    this.writeData(data);
  }

  /**
   * Save multiple insights at once
   */
  saveMany(insights: Insight[]): void {
    const data = this.loadAll();

    for (const insight of insights) {
      const existingIndex = data.insights.findIndex((i) => i.id === insight.id);
      if (existingIndex >= 0) {
        data.insights[existingIndex] = insight;
      } else {
        data.insights.push(insight);
      }
    }

    this.writeData(data);
  }

  /**
   * Load a single insight by ID
   */
  load(id: string): Insight | null {
    const data = this.loadAll();
    return data.insights.find((i) => i.id === id) || null;
  }

  /**
   * Delete an insight by ID
   */
  delete(id: string): boolean {
    const data = this.loadAll();
    const initialLength = data.insights.length;
    data.insights = data.insights.filter((i) => i.id !== id);

    if (data.insights.length < initialLength) {
      this.writeData(data);
      return true;
    }
    return false;
  }

  // ============================================
  // Query Methods
  // ============================================

  /**
   * Get all insights (for admin/debugging)
   */
  getAll(): Insight[] {
    return this.loadAll().insights;
  }

  /**
   * Get pending insights (requiring teacher attention)
   */
  getPending(): Insight[] {
    const data = this.loadAll();
    return this.sortByPriority(
      data.insights.filter((i) => i.status === "pending_review")
    );
  }

  /**
   * Get pending insights, limited to N
   */
  getPendingLimit(limit: number = INSIGHT_CONFIG.MAX_DASHBOARD_INSIGHTS): Insight[] {
    return this.getPending().slice(0, limit);
  }

  /**
   * Get insights by status
   */
  getByStatus(status: InsightStatus): Insight[] {
    const data = this.loadAll();
    return this.sortByPriority(data.insights.filter((i) => i.status === status));
  }

  /**
   * Get insights for a specific student
   */
  getByStudent(studentId: string, includeResolved: boolean = false): Insight[] {
    const data = this.loadAll();
    return this.sortByPriority(
      data.insights.filter((i) => {
        if (i.studentId !== studentId) return false;
        if (!includeResolved && i.status !== "pending_review" && i.status !== "monitoring") {
          return false;
        }
        return true;
      })
    );
  }

  /**
   * Get insights for a specific class
   */
  getByClass(classId: string, includeResolved: boolean = false): Insight[] {
    const data = this.loadAll();
    return this.sortByPriority(
      data.insights.filter((i) => {
        if (i.classId !== classId) return false;
        if (!includeResolved && i.status !== "pending_review" && i.status !== "monitoring") {
          return false;
        }
        return true;
      })
    );
  }

  /**
   * Get insights for a specific assignment
   */
  getByAssignment(assignmentId: string): Insight[] {
    const data = this.loadAll();
    return this.sortByPriority(
      data.insights.filter((i) => i.assignmentId === assignmentId)
    );
  }

  /**
   * Get insights by type
   */
  getByType(type: InsightType): Insight[] {
    const data = this.loadAll();
    return this.sortByPriority(data.insights.filter((i) => i.type === type));
  }

  /**
   * Flexible filter query
   */
  query(filter: InsightFilter, sort?: InsightSortOptions, page: number = 1, pageSize: number = 20): InsightListResponse {
    const data = this.loadAll();
    let results = data.insights;

    // Apply filters
    if (filter.studentId) {
      results = results.filter((i) => i.studentId === filter.studentId);
    }
    if (filter.classId) {
      results = results.filter((i) => i.classId === filter.classId);
    }
    if (filter.assignmentId) {
      results = results.filter((i) => i.assignmentId === filter.assignmentId);
    }
    if (filter.subject) {
      results = results.filter((i) => i.subject === filter.subject);
    }
    if (filter.type) {
      results = results.filter((i) => i.type === filter.type);
    }
    if (filter.types && filter.types.length > 0) {
      results = results.filter((i) => filter.types!.includes(i.type));
    }
    if (filter.priority) {
      results = results.filter((i) => i.priority === filter.priority);
    }
    if (filter.priorities && filter.priorities.length > 0) {
      results = results.filter((i) => filter.priorities!.includes(i.priority));
    }
    if (filter.status) {
      results = results.filter((i) => i.status === filter.status);
    }
    if (filter.statuses && filter.statuses.length > 0) {
      results = results.filter((i) => filter.statuses!.includes(i.status));
    }
    if (filter.minConfidence !== undefined) {
      results = results.filter((i) => i.confidence >= filter.minConfidence!);
    }
    if (filter.createdAfter) {
      results = results.filter((i) => new Date(i.createdAt) >= filter.createdAfter!);
    }
    if (filter.createdBefore) {
      results = results.filter((i) => new Date(i.createdAt) <= filter.createdBefore!);
    }
    if (filter.reviewedBy) {
      results = results.filter((i) => i.reviewedBy === filter.reviewedBy);
    }

    // Apply sorting
    if (sort) {
      results = this.sortInsights(results, sort);
    } else {
      results = this.sortByPriority(results);
    }

    // Apply pagination
    const total = results.length;
    const startIndex = (page - 1) * pageSize;
    const paginatedResults = results.slice(startIndex, startIndex + pageSize);

    return {
      insights: paginatedResults,
      total,
      page,
      pageSize,
      hasMore: startIndex + pageSize < total,
    };
  }

  // ============================================
  // Status Workflow
  // ============================================

  /**
   * Mark an insight as having action taken
   */
  markActionTaken(id: string, reviewedBy: string): Insight | null {
    const insight = this.load(id);
    if (!insight) return null;

    insight.status = "action_taken";
    insight.reviewedAt = new Date();
    insight.reviewedBy = reviewedBy;

    this.save(insight);
    return insight;
  }

  /**
   * Dismiss an insight
   */
  dismiss(id: string, reviewedBy: string): Insight | null {
    const insight = this.load(id);
    if (!insight) return null;

    insight.status = "dismissed";
    insight.reviewedAt = new Date();
    insight.reviewedBy = reviewedBy;

    this.save(insight);
    return insight;
  }

  /**
   * Set an insight to monitoring status
   */
  setMonitoring(id: string, reviewedBy: string): Insight | null {
    const insight = this.load(id);
    if (!insight) return null;

    insight.status = "monitoring";
    insight.reviewedAt = new Date();
    insight.reviewedBy = reviewedBy;

    this.save(insight);
    return insight;
  }

  /**
   * Update insight status
   */
  updateStatus(id: string, status: InsightStatus, reviewedBy?: string): Insight | null {
    const insight = this.load(id);
    if (!insight) return null;

    insight.status = status;
    if (status !== "pending_review") {
      insight.reviewedAt = new Date();
      if (reviewedBy) {
        insight.reviewedBy = reviewedBy;
      }
    }

    this.save(insight);
    return insight;
  }

  // ============================================
  // Duplicate Detection
  // ============================================

  /**
   * Check if a similar insight already exists
   * Prevents duplicate insights for same student + assignment + type
   */
  exists(studentId: string, assignmentId: string | undefined, type: InsightType): boolean {
    const data = this.loadAll();

    return data.insights.some((i) => {
      // Only check pending/monitoring insights
      if (i.status !== "pending_review" && i.status !== "monitoring") return false;
      if (i.studentId !== studentId) return false;
      if (i.assignmentId !== assignmentId) return false;
      if (i.type !== type) return false;
      return true;
    });
  }

  /**
   * Find existing insight for deduplication
   */
  findExisting(studentId: string, assignmentId: string | undefined, type: InsightType): Insight | null {
    const data = this.loadAll();

    return data.insights.find((i) => {
      if (i.status !== "pending_review" && i.status !== "monitoring") return false;
      if (i.studentId !== studentId) return false;
      if (i.assignmentId !== assignmentId) return false;
      if (i.type !== type) return false;
      return true;
    }) || null;
  }

  // ============================================
  // Aggregation Methods
  // ============================================

  /**
   * Get summary for a student
   */
  getStudentSummary(studentId: string, studentName: string): StudentInsightSummary {
    const insights = this.getByStudent(studentId, true);

    const byType: Record<InsightType, number> = {
      challenge_opportunity: 0,
      celebrate_progress: 0,
      check_in: 0,
      monitor: 0,
    };

    const byPriority: Record<InsightPriority, number> = {
      low: 0,
      medium: 0,
      high: 0,
    };

    let pendingCount = 0;
    let lastInsightAt: Date | undefined;

    for (const insight of insights) {
      byType[insight.type]++;
      byPriority[insight.priority]++;

      if (insight.status === "pending_review") {
        pendingCount++;
      }

      const createdAt = new Date(insight.createdAt);
      if (!lastInsightAt || createdAt > lastInsightAt) {
        lastInsightAt = createdAt;
      }
    }

    return {
      studentId,
      studentName,
      totalInsights: insights.length,
      pendingCount,
      byType,
      byPriority,
      lastInsightAt,
      badgesEarned: 0, // Will be filled by badge store
    };
  }

  /**
   * Get summary for a class
   */
  getClassSummary(classId: string, className: string, totalStudents: number): ClassInsightSummary {
    const insights = this.getByClass(classId, true);

    const byType: Record<InsightType, number> = {
      challenge_opportunity: 0,
      celebrate_progress: 0,
      check_in: 0,
      monitor: 0,
    };

    let pendingCount = 0;
    const studentIds = new Set<string>();
    let lastInsightAt: Date | undefined;

    for (const insight of insights) {
      byType[insight.type]++;
      studentIds.add(insight.studentId);

      if (insight.status === "pending_review") {
        pendingCount++;
      }

      const createdAt = new Date(insight.createdAt);
      if (!lastInsightAt || createdAt > lastInsightAt) {
        lastInsightAt = createdAt;
      }
    }

    return {
      classId,
      className,
      totalInsights: insights.length,
      pendingCount,
      byType,
      studentsWithInsights: studentIds.size,
      totalStudents,
      lastInsightAt,
    };
  }

  /**
   * Build dashboard data
   */
  buildDashboard(studentNames: Map<string, string>): InsightDashboard {
    const pending = this.getPending();

    const byType = {
      check_in: 0,
      challenge_opportunity: 0,
      celebrate_progress: 0,
      monitor: 0,
    };

    const byPriority = {
      high: 0,
      medium: 0,
      low: 0,
    };

    const studentInsightMap = new Map<string, { count: number; highestPriority: InsightPriority; primaryType: InsightType }>();

    for (const insight of pending) {
      byType[insight.type]++;
      byPriority[insight.priority]++;

      const existing = studentInsightMap.get(insight.studentId);
      if (!existing) {
        studentInsightMap.set(insight.studentId, {
          count: 1,
          highestPriority: insight.priority,
          primaryType: insight.type,
        });
      } else {
        existing.count++;
        if (this.comparePriority(insight.priority, existing.highestPriority) > 0) {
          existing.highestPriority = insight.priority;
        }
        if (this.compareType(insight.type, existing.primaryType) > 0) {
          existing.primaryType = insight.type;
        }
      }
    }

    const studentsNeedingAttention = Array.from(studentInsightMap.entries())
      .map(([studentId, data]) => ({
        studentId,
        studentName: studentNames.get(studentId) || "Unknown",
        insightCount: data.count,
        highestPriority: data.highestPriority,
        primaryType: data.primaryType,
      }))
      .sort((a, b) => this.comparePriority(b.highestPriority, a.highestPriority));

    const celebrationOpportunities = pending.filter((i) => i.type === "celebrate_progress");

    return {
      pendingInsights: pending.slice(0, INSIGHT_CONFIG.MAX_DASHBOARD_INSIGHTS),
      pendingCount: pending.length,
      byType,
      byPriority,
      studentsNeedingAttention,
      recentActions: [], // Will be filled by TeacherActionStore
      celebrationOpportunities,
      generatedAt: new Date(),
    };
  }

  // ============================================
  // Maintenance Operations
  // ============================================

  /**
   * Archive old resolved insights
   */
  archiveOld(daysOld: number = INSIGHT_CONFIG.AUTO_ARCHIVE_DAYS): number {
    const data = this.loadAll();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysOld);

    const initialLength = data.insights.length;
    data.insights = data.insights.filter((i) => {
      // Keep pending and monitoring insights
      if (i.status === "pending_review" || i.status === "monitoring") return true;

      // For resolved, check age
      const reviewedDate = i.reviewedAt ? new Date(i.reviewedAt) : new Date(i.createdAt);
      return reviewedDate >= cutoff;
    });

    const archived = initialLength - data.insights.length;
    if (archived > 0) {
      this.writeData(data);
    }

    return archived;
  }

  /**
   * Clear all pending insights (for refresh)
   */
  clearPending(): number {
    const data = this.loadAll();
    const initialPending = data.insights.filter((i) => i.status === "pending_review").length;

    data.insights = data.insights.filter((i) => i.status !== "pending_review");
    this.writeData(data);

    return initialPending;
  }

  // ============================================
  // Private Helpers
  // ============================================

  private loadAll(): InsightsData {
    if (!fs.existsSync(DATA_FILE)) {
      return { insights: [], lastUpdated: new Date().toISOString() };
    }

    try {
      const content = fs.readFileSync(DATA_FILE, "utf-8");
      return JSON.parse(content) as InsightsData;
    } catch (err) {
      console.error("Error loading insights:", err);
      return { insights: [], lastUpdated: new Date().toISOString() };
    }
  }

  private writeData(data: InsightsData): void {
    data.lastUpdated = new Date().toISOString();
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  }

  private sortByPriority(insights: Insight[]): Insight[] {
    const typeOrder = INSIGHT_CONFIG.TYPE_PRIORITY_ORDER;
    const priorityOrder: Record<InsightPriority, number> = { low: 0, medium: 1, high: 2 };

    return [...insights].sort((a, b) => {
      // First sort by priority
      const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
      if (priorityDiff !== 0) return priorityDiff;

      // Then by type
      const typeDiff = typeOrder.indexOf(b.type) - typeOrder.indexOf(a.type);
      if (typeDiff !== 0) return typeDiff;

      // Then by confidence
      return b.confidence - a.confidence;
    });
  }

  private sortInsights(insights: Insight[], sort: InsightSortOptions): Insight[] {
    const multiplier = sort.direction === "asc" ? 1 : -1;

    return [...insights].sort((a, b) => {
      switch (sort.field) {
        case "createdAt":
          return multiplier * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        case "priority":
          const priorityOrder: Record<InsightPriority, number> = { low: 0, medium: 1, high: 2 };
          return multiplier * (priorityOrder[a.priority] - priorityOrder[b.priority]);
        case "confidence":
          return multiplier * (a.confidence - b.confidence);
        case "type":
          const typeOrder = INSIGHT_CONFIG.TYPE_PRIORITY_ORDER;
          return multiplier * (typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type));
        default:
          return 0;
      }
    });
  }

  private comparePriority(a: InsightPriority, b: InsightPriority): number {
    const order: Record<InsightPriority, number> = { low: 0, medium: 1, high: 2 };
    return order[a] - order[b];
  }

  private compareType(a: InsightType, b: InsightType): number {
    const order = INSIGHT_CONFIG.TYPE_PRIORITY_ORDER;
    return order.indexOf(a) - order.indexOf(b);
  }
}

// Export singleton instance
export const insightStore = new InsightStore();
