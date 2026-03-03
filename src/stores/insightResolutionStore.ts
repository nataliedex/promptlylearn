/**
 * Insight Resolution Store
 *
 * Tracks which derived insights have been resolved/dismissed by teachers.
 * Insights are computed on-read, so we only need to track resolutions.
 */

import * as fs from "fs";
import * as path from "path";

const DATA_DIR = path.join(process.cwd(), "data", "insight-resolutions");

// ============================================
// Resolution Status
// ============================================

export type InsightResolutionStatus = "resolved" | "dismissed";

export interface InsightResolution {
  insightId: string;
  assignmentId: string;
  studentId: string;
  attemptId: string;
  status: InsightResolutionStatus;
  resolvedAt: string;
  resolvedBy?: string; // teacher ID
  reason?: string; // "mark_reviewed" | "todo_created" | "manual_dismiss"
}

// ============================================
// Store Operations
// ============================================

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function getFilePath(assignmentId: string): string {
  return path.join(DATA_DIR, `${assignmentId}.json`);
}

/**
 * Load all resolutions for an assignment.
 */
export function loadResolutions(assignmentId: string): InsightResolution[] {
  ensureDataDir();
  const filePath = getFilePath(assignmentId);

  if (!fs.existsSync(filePath)) {
    return [];
  }

  try {
    const data = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error loading insight resolutions for ${assignmentId}:`, error);
    return [];
  }
}

/**
 * Save resolutions for an assignment.
 */
function saveResolutions(assignmentId: string, resolutions: InsightResolution[]): void {
  ensureDataDir();
  const filePath = getFilePath(assignmentId);
  fs.writeFileSync(filePath, JSON.stringify(resolutions, null, 2));
}

/**
 * Mark an insight as resolved.
 */
export function resolveInsight(
  insightId: string,
  assignmentId: string,
  studentId: string,
  attemptId: string,
  status: InsightResolutionStatus = "resolved",
  reason?: string,
  resolvedBy?: string
): InsightResolution {
  const resolutions = loadResolutions(assignmentId);

  // Check if already resolved
  const existingIndex = resolutions.findIndex((r) => r.insightId === insightId);

  const resolution: InsightResolution = {
    insightId,
    assignmentId,
    studentId,
    attemptId,
    status,
    resolvedAt: new Date().toISOString(),
    resolvedBy,
    reason,
  };

  if (existingIndex >= 0) {
    resolutions[existingIndex] = resolution;
  } else {
    resolutions.push(resolution);
  }

  saveResolutions(assignmentId, resolutions);
  return resolution;
}

/**
 * Mark all insights for a student-assignment as resolved.
 */
export function resolveAllInsightsForStudent(
  assignmentId: string,
  studentId: string,
  reason: string,
  resolvedBy?: string
): number {
  const resolutions = loadResolutions(assignmentId);

  // We don't know which insights exist, but we can mark any that we add
  // For now, we'll create a special "all" resolution marker
  const allResolution: InsightResolution = {
    insightId: `${studentId}:all`,
    assignmentId,
    studentId,
    attemptId: "*",
    status: "resolved",
    resolvedAt: new Date().toISOString(),
    resolvedBy,
    reason,
  };

  const existingIndex = resolutions.findIndex(
    (r) => r.insightId === `${studentId}:all`
  );

  if (existingIndex >= 0) {
    resolutions[existingIndex] = allResolution;
  } else {
    resolutions.push(allResolution);
  }

  saveResolutions(assignmentId, resolutions);
  return 1;
}

/**
 * Check if an insight is resolved.
 */
export function isInsightResolved(
  insightId: string,
  assignmentId: string,
  studentId: string
): boolean {
  const resolutions = loadResolutions(assignmentId);

  // Check for specific insight resolution
  const specificResolution = resolutions.find((r) => r.insightId === insightId);
  if (specificResolution) {
    return true;
  }

  // Check for "all insights for student" resolution
  const allResolution = resolutions.find(
    (r) => r.insightId === `${studentId}:all`
  );
  return !!allResolution;
}

/**
 * Get resolved insight IDs for a student-assignment.
 */
export function getResolvedInsightIds(
  assignmentId: string,
  studentId: string
): string[] {
  const resolutions = loadResolutions(assignmentId);

  // Check for "all" resolution
  const hasAllResolution = resolutions.some(
    (r) => r.insightId === `${studentId}:all`
  );

  if (hasAllResolution) {
    return ["*"]; // Special marker meaning all are resolved
  }

  return resolutions
    .filter((r) => r.studentId === studentId)
    .map((r) => r.insightId);
}

/**
 * Remove resolution (reactivate insight) - used when reopening for review.
 */
export function removeResolution(
  insightId: string,
  assignmentId: string
): boolean {
  const resolutions = loadResolutions(assignmentId);
  const newResolutions = resolutions.filter((r) => r.insightId !== insightId);

  if (newResolutions.length !== resolutions.length) {
    saveResolutions(assignmentId, newResolutions);
    return true;
  }
  return false;
}

/**
 * Remove all resolutions for a student (used when reopening for review).
 */
export function removeAllResolutionsForStudent(
  assignmentId: string,
  studentId: string
): number {
  const resolutions = loadResolutions(assignmentId);
  const newResolutions = resolutions.filter((r) => r.studentId !== studentId);
  const removedCount = resolutions.length - newResolutions.length;

  if (removedCount > 0) {
    saveResolutions(assignmentId, newResolutions);
  }

  return removedCount;
}
