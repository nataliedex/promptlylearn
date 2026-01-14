/**
 * Assignment Lifecycle Types
 *
 * Philosophy: Teachers should not manage dashboards.
 * The system surfaces what needs attention and quietly archives the rest.
 *
 * Lifecycle: Active → Resolved → Archived (auto)
 */

// ============================================
// Core Lifecycle States
// ============================================

/**
 * Assignment lifecycle states.
 *
 * - active: Requires teacher attention or has incomplete work
 * - resolved: All work complete, teacher has reviewed, can be auto-archived
 * - archived: Automatically archived after resolution period
 */
export type AssignmentLifecycleState = "active" | "resolved" | "archived";

/**
 * Why an assignment is in its current state.
 * Helps teachers understand what's happening without digging.
 */
export type ActiveReason =
  | "students-need-support"      // At least one student flagged
  | "incomplete-work"            // Students haven't finished
  | "not-reviewed"               // Teacher hasn't viewed the review
  | "pending-feedback"           // Teacher notes not acknowledged
  | "recent-activity";           // New submissions in last 48 hours

export type ResolvedReason =
  | "all-complete"               // All students finished
  | "all-reviewed"               // Teacher reviewed all flagged students
  | "no-flags";                  // No students need support

// ============================================
// Student Assignment Status
// ============================================

/**
 * Individual student status within an assignment.
 * Drives the "needs attention" signals.
 */
export interface StudentAssignmentStatus {
  studentId: string;
  studentName: string;

  // Completion
  isComplete: boolean;
  questionsAnswered: number;
  totalQuestions: number;
  completedAt?: string;

  // Understanding (derived from score)
  understanding: "strong" | "developing" | "needs-support";

  // Flags
  needsSupport: boolean;           // Flagged for teacher attention
  hasTeacherNote: boolean;         // Teacher left a note
  teacherReviewedAt?: string;      // When teacher viewed this student's work

  // Coach interaction
  coachHintsUsed: number;
  improvedAfterHelp: boolean;
}

// ============================================
// Assignment State
// ============================================

/**
 * Full assignment state including lifecycle tracking.
 * This is the "source of truth" for dashboard display.
 */
export interface AssignmentState {
  assignmentId: string;
  title: string;
  questionCount: number;

  // Lifecycle
  lifecycleState: AssignmentLifecycleState;
  activeReasons: ActiveReason[];      // Why it's active (empty if not active)
  resolvedAt?: string;                // When it became resolved
  archivedAt?: string;                // When auto-archived

  // Teacher engagement
  teacherViewedAt?: string;           // Last time teacher opened assignment review
  teacherViewCount: number;           // How many times teacher has viewed

  // Student summary
  totalStudents: number;
  completedCount: number;
  inProgressCount: number;
  notStartedCount: number;

  // Understanding distribution
  distribution: {
    strong: number;
    developing: number;
    needsSupport: number;
  };

  // Flags
  studentsNeedingSupport: number;     // Count of flagged students
  studentStatuses: StudentAssignmentStatus[];

  // Summary (populated before archiving)
  teacherSummary?: TeacherSummary;
}

// ============================================
// Teacher Summary (Auto-generated before archiving)
// ============================================

/**
 * Auto-generated summary stored with archived assignments.
 * This becomes the "cover page" of archived lessons.
 *
 * Generated when: Assignment transitions from Resolved → Archived
 * Purpose: Teachers can quickly recall what happened without re-reading everything
 */
export interface TeacherSummary {
  generatedAt: string;

  // Class performance snapshot
  classPerformance: {
    totalStudents: number;
    strongCount: number;
    developingCount: number;
    needsSupportCount: number;
    averageScore: number;
    completionRate: number;            // % of students who completed
  };

  // Learning insights
  insights: {
    commonStrengths: string[];         // Skills most students demonstrated
    commonChallenges: string[];        // Areas where students struggled
    skillsMastered: string[];          // Topics with high success rate
    skillsNeedingReinforcement: string[]; // Topics to revisit
  };

  // Coach usage patterns
  coachUsage: {
    averageHintsPerStudent: number;
    studentsWhoUsedHints: number;
    mostEffectiveHints: string[];      // Hints that led to improvement
    questionsNeedingMoreScaffolding: string[]; // Questions where hints didn't help
  };

  // Student highlights
  studentHighlights: {
    improvedSignificantly: string[];   // Students who recovered well
    mayNeedFollowUp: string[];         // Students to watch in future assignments
    exceededExpectations: string[];    // Students who did better than usual
  };

  // Teacher activity
  teacherEngagement: {
    totalNotesWritten: number;
    studentsWithNotes: number;
    reviewedAllFlagged: boolean;
  };
}

// ============================================
// Lifecycle Transition Rules
// ============================================

/**
 * Configuration for lifecycle transitions.
 * These can be adjusted based on teacher feedback.
 */
export interface LifecycleConfig {
  // How long to wait before auto-archiving resolved assignments
  daysBeforeAutoArchive: number;       // Default: 7

  // How long to show "recent activity" badge
  recentActivityWindowHours: number;   // Default: 48

  // Minimum completion rate to consider "all complete"
  completionThreshold: number;         // Default: 1.0 (100%)

  // Whether to require teacher view before resolving
  requireTeacherView: boolean;         // Default: true
}

export const DEFAULT_LIFECYCLE_CONFIG: LifecycleConfig = {
  daysBeforeAutoArchive: 7,
  recentActivityWindowHours: 48,
  completionThreshold: 1.0,
  requireTeacherView: true,
};

// ============================================
// Dashboard View Types
// ============================================

/**
 * What the dashboard displays, grouped by lifecycle state.
 */
export interface DashboardAssignments {
  // Primary focus: Assignments needing attention
  active: AssignmentState[];

  // De-emphasized: Completed but not yet archived
  resolved: AssignmentState[];

  // Hidden from main view (accessible via "Archived" page)
  archivedCount: number;
}

/**
 * Summary for the archived lessons page.
 */
export interface ArchivedAssignmentSummary {
  assignmentId: string;
  title: string;
  archivedAt: string;
  teacherSummary: TeacherSummary;

  // Quick stats for the card
  totalStudents: number;
  averageScore: number;
  completionRate: number;
}
