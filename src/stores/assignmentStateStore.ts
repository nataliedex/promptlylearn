/**
 * Assignment State Store
 *
 * Tracks assignment lifecycle state separately from lesson content.
 * This enables auto-archiving without modifying the original lesson files.
 *
 * Philosophy:
 * - Teachers should not manage dashboards
 * - System surfaces what needs attention
 * - Everything else is quietly archived
 */

import fs from "fs";
import path from "path";

const DATA_DIR = path.join(__dirname, "../../data");
const STATE_FILE = path.join(DATA_DIR, "assignment-states.json");

// ============================================
// Types (mirrored from frontend for consistency)
// ============================================

export type AssignmentLifecycleState = "active" | "resolved" | "archived";

export type ActiveReason =
  | "students-need-support"
  | "incomplete-work"
  | "not-reviewed"
  | "pending-feedback"
  | "recent-activity";

export interface TeacherSummary {
  generatedAt: string;
  classPerformance: {
    totalStudents: number;
    strongCount: number;
    developingCount: number;
    needsSupportCount: number;
    averageScore: number;
    completionRate: number;
  };
  insights: {
    commonStrengths: string[];
    commonChallenges: string[];
    skillsMastered: string[];
    skillsNeedingReinforcement: string[];
  };
  coachUsage: {
    averageHintsPerStudent: number;
    studentsWhoUsedHints: number;
    mostEffectiveHints: string[];
    questionsNeedingMoreScaffolding: string[];
  };
  studentHighlights: {
    improvedSignificantly: string[];
    mayNeedFollowUp: string[];
    exceededExpectations: string[];
  };
  teacherEngagement: {
    totalNotesWritten: number;
    studentsWithNotes: number;
    reviewedAllFlagged: boolean;
  };
}

export interface AssignmentStateRecord {
  assignmentId: string;
  lifecycleState: AssignmentLifecycleState;
  activeReasons: ActiveReason[];

  // Timestamps
  createdAt: string;
  resolvedAt?: string;
  archivedAt?: string;
  lastActivityAt: string;

  // Teacher engagement
  teacherViewedAt?: string;
  teacherViewCount: number;

  // Summary (populated before archiving)
  teacherSummary?: TeacherSummary;
}

interface AssignmentStateData {
  states: Record<string, AssignmentStateRecord>;
  lastAutoArchiveCheck: string;
}

// ============================================
// Storage Functions
// ============================================

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadStateData(): AssignmentStateData {
  ensureDataDir();

  if (fs.existsSync(STATE_FILE)) {
    try {
      const raw = fs.readFileSync(STATE_FILE, "utf-8");
      return JSON.parse(raw);
    } catch {
      // Corrupted file, start fresh
    }
  }

  return {
    states: {},
    lastAutoArchiveCheck: new Date().toISOString(),
  };
}

function saveStateData(data: AssignmentStateData): void {
  ensureDataDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2), "utf-8");
}

// ============================================
// State Management Functions
// ============================================

/**
 * Get the state record for an assignment.
 * Creates a new "active" record if none exists.
 */
export function getAssignmentState(assignmentId: string): AssignmentStateRecord {
  const data = loadStateData();

  if (!data.states[assignmentId]) {
    // Create new state record
    const now = new Date().toISOString();
    data.states[assignmentId] = {
      assignmentId,
      lifecycleState: "active",
      activeReasons: ["not-reviewed"],
      createdAt: now,
      lastActivityAt: now,
      teacherViewCount: 0,
    };
    saveStateData(data);
  }

  return data.states[assignmentId];
}

/**
 * Get all assignment states.
 */
export function getAllAssignmentStates(): AssignmentStateRecord[] {
  const data = loadStateData();
  return Object.values(data.states);
}

/**
 * Update the lifecycle state of an assignment.
 */
export function updateAssignmentState(
  assignmentId: string,
  updates: Partial<AssignmentStateRecord>
): AssignmentStateRecord {
  const data = loadStateData();

  if (!data.states[assignmentId]) {
    // Initialize if doesn't exist
    getAssignmentState(assignmentId);
  }

  data.states[assignmentId] = {
    ...data.states[assignmentId],
    ...updates,
    lastActivityAt: new Date().toISOString(),
  };

  saveStateData(data);
  return data.states[assignmentId];
}

/**
 * Record that a teacher viewed an assignment review.
 * This is critical for lifecycle transitions.
 */
export function recordTeacherView(assignmentId: string): AssignmentStateRecord {
  const data = loadStateData();
  const state = getAssignmentState(assignmentId);

  state.teacherViewedAt = new Date().toISOString();
  state.teacherViewCount += 1;
  state.lastActivityAt = new Date().toISOString();

  // Remove "not-reviewed" from active reasons if present
  state.activeReasons = state.activeReasons.filter((r) => r !== "not-reviewed");

  data.states[assignmentId] = state;
  saveStateData(data);

  return state;
}

/**
 * Record new student activity on an assignment.
 */
export function recordStudentActivity(assignmentId: string): void {
  const data = loadStateData();
  const state = getAssignmentState(assignmentId);

  state.lastActivityAt = new Date().toISOString();

  // If it was resolved or archived, move back to active
  if (state.lifecycleState !== "active") {
    state.lifecycleState = "active";
    state.activeReasons = ["recent-activity"];
    state.resolvedAt = undefined;
    // Note: We don't clear archivedAt to preserve history
  }

  data.states[assignmentId] = state;
  saveStateData(data);
}

/**
 * Transition an assignment to resolved state.
 */
export function resolveAssignment(assignmentId: string): AssignmentStateRecord {
  const data = loadStateData();
  const state = getAssignmentState(assignmentId);

  state.lifecycleState = "resolved";
  state.activeReasons = [];
  state.resolvedAt = new Date().toISOString();
  state.lastActivityAt = new Date().toISOString();

  data.states[assignmentId] = state;
  saveStateData(data);

  return state;
}

/**
 * Archive an assignment with a teacher summary.
 */
export function archiveAssignmentWithSummary(
  assignmentId: string,
  summary: TeacherSummary
): AssignmentStateRecord {
  const data = loadStateData();
  const state = getAssignmentState(assignmentId);

  state.lifecycleState = "archived";
  state.archivedAt = new Date().toISOString();
  state.teacherSummary = summary;
  state.lastActivityAt = new Date().toISOString();

  data.states[assignmentId] = state;
  saveStateData(data);

  return state;
}

/**
 * Restore an archived assignment to active state.
 */
export function restoreAssignment(assignmentId: string): AssignmentStateRecord {
  const data = loadStateData();
  const state = getAssignmentState(assignmentId);

  state.lifecycleState = "active";
  state.activeReasons = ["recent-activity"];
  // Keep the summary for reference
  state.lastActivityAt = new Date().toISOString();

  data.states[assignmentId] = state;
  saveStateData(data);

  return state;
}

/**
 * Mark an assignment as "keep active" (manual override).
 * This prevents auto-archiving until manually resolved.
 */
export function keepAssignmentActive(assignmentId: string): AssignmentStateRecord {
  const data = loadStateData();
  const state = getAssignmentState(assignmentId);

  state.lifecycleState = "active";
  // Add a special reason that won't be auto-cleared
  if (!state.activeReasons.includes("pending-feedback")) {
    state.activeReasons.push("pending-feedback");
  }
  state.lastActivityAt = new Date().toISOString();

  data.states[assignmentId] = state;
  saveStateData(data);

  return state;
}

// ============================================
// Auto-Archive Check
// ============================================

const DAYS_BEFORE_AUTO_ARCHIVE = 7;

/**
 * Get assignments that are ready for auto-archiving.
 * Called periodically (e.g., on dashboard load or via cron).
 */
export function getAssignmentsReadyForArchive(): AssignmentStateRecord[] {
  const data = loadStateData();
  const now = new Date();
  const cutoffDate = new Date(now.getTime() - DAYS_BEFORE_AUTO_ARCHIVE * 24 * 60 * 60 * 1000);

  const ready: AssignmentStateRecord[] = [];

  for (const state of Object.values(data.states)) {
    if (state.lifecycleState === "resolved" && state.resolvedAt) {
      const resolvedDate = new Date(state.resolvedAt);
      if (resolvedDate < cutoffDate) {
        ready.push(state);
      }
    }
  }

  // Update last check time
  data.lastAutoArchiveCheck = now.toISOString();
  saveStateData(data);

  return ready;
}

/**
 * Delete state for an assignment (for cleanup).
 */
export function deleteAssignmentState(assignmentId: string): boolean {
  const data = loadStateData();

  if (data.states[assignmentId]) {
    delete data.states[assignmentId];
    saveStateData(data);
    return true;
  }

  return false;
}
