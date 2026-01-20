/**
 * Dashboard Domain Types
 *
 * This module defines the data structures for educator dashboards:
 * - Educator Dashboard (class-wide overview)
 * - Assignment Dashboard (per-assignment student view)
 * - Student Dashboard (per-student detail view)
 * - "What Should I Do Next?" actionable items
 *
 * All types are designed to be data-driven and connected to the domain layer.
 */

import { InsightType, InsightPriority, InsightStatus } from "./insight";
import { TeacherActionType } from "./recommendation";

// ============================================
// Student Status Types
// ============================================

/**
 * Student understanding level based on performance thresholds
 */
export type StudentUnderstandingLevel =
  | "strong" // >= 80% score, minimal hints
  | "developing" // 60-79% score, or moderate hint usage
  | "needs_support"; // < 60% score, or heavy hint usage

/**
 * Coach usage intent classification
 */
export type CoachUsageIntent =
  | "support_seeking" // Using coach for help with difficulties
  | "enrichment_seeking" // Using coach to explore deeper
  | "mixed"; // Both types of usage

/**
 * Review status for teacher workflow
 */
export type ReviewStatus =
  | "pending" // Not yet reviewed
  | "reviewed" // Reviewed, no further action needed
  | "monitoring" // Being actively monitored
  | "action_taken"; // Teacher took specific action

// ============================================
// Dashboard Configuration
// ============================================

export const DASHBOARD_CONFIG = {
  // Understanding level thresholds
  STRONG_THRESHOLD: 80, // Score >= 80% = strong
  DEVELOPING_THRESHOLD: 60, // Score 60-79% = developing
  // Below 60% = needs_support

  // Hint usage thresholds for classification
  MINIMAL_HINT_RATE: 0.2, // <= 20% = minimal
  MODERATE_HINT_RATE: 0.5, // 20-50% = moderate
  // > 50% = heavy

  // Coach usage thresholds
  ENRICHMENT_COACH_THRESHOLD: 3, // 3+ "more" explorations = enrichment seeking

  // Auto-archive settings
  AUTO_ARCHIVE_WHEN_ALL_REVIEWED: true,

  // Display limits
  MAX_ACTIONABLE_ITEMS: 10,
  MAX_RECENT_ACTIVITIES: 20,
};

// ============================================
// Educator Dashboard Types
// ============================================

/**
 * Summary of students needing attention across all assignments
 */
export interface StudentsNeedingAttentionSummary {
  total: number;
  developing: number;
  needsSupport: number;
  students: StudentAttentionItem[];
}

/**
 * Individual student in the attention summary
 */
export interface StudentAttentionItem {
  studentId: string;
  studentName: string;
  classIds: string[];
  classNames: string[];
  understandingLevel: StudentUnderstandingLevel;
  activeAssignmentCount: number;
  pendingInsightCount: number;
  lastActivityAt?: Date;
  primaryConcern?: string; // Brief description of main issue
}

/**
 * Assignment summary for educator dashboard
 */
export interface AssignmentSummaryItem {
  assignmentId: string;
  assignmentTitle: string;
  subject?: string;
  assignedAt: Date;
  totalStudents: number;
  completed: number;
  inProgress: number;
  notStarted: number;
  developing: number;
  needsSupport: number;
  totalNeedingAttention: number;
  isArchived: boolean;
  archivedAt?: Date;
  archiveSummary?: AssignmentArchiveSummary;
}

/**
 * Summary saved when assignment is archived
 */
export interface AssignmentArchiveSummary {
  totalStudents: number;
  averageScore: number;
  completionRate: number;
  studentsReviewed: number;
  insightsGenerated: number;
  actionssTaken: number;
  archivedAt: Date;
  archivedBy?: string;
}

/**
 * Main educator dashboard summary
 */
export interface EducatorDashboardSummary {
  // Overview stats
  totalStudents: number;
  totalActiveAssignments: number;
  totalArchivedAssignments: number;

  // Attention summary
  studentsNeedingAttention: StudentsNeedingAttentionSummary;

  // Active assignments with stats
  activeAssignments: AssignmentSummaryItem[];

  // Archived assignments (for reference)
  archivedAssignments: AssignmentSummaryItem[];

  // "What Should I Do Next?" items
  actionableItems: ActionableItem[];
  actionableItemCount: number;

  // Recent activity
  recentTeacherActions: RecentActivityItem[];

  // Generated timestamp
  generatedAt: Date;
}

// ============================================
// Assignment Dashboard Types
// ============================================

/**
 * Student row in assignment dashboard table
 */
export interface AssignmentStudentRow {
  studentId: string;
  studentName: string;
  classId: string;
  className: string;

  // Progress
  progress: StudentAssignmentProgress;

  // Understanding
  understandingLevel: StudentUnderstandingLevel;
  score?: number;
  highestScore?: number;

  // Coach support
  coachUsage: StudentCoachUsage;

  // Attempts
  attempts: number;
  lastAttemptAt?: Date;

  // Review status
  reviewStatus: ReviewStatus;
  reviewedAt?: Date;
  reviewedBy?: string;

  // Related insights
  pendingInsights: AssignmentInsightSummary[];

  // Actions available
  availableActions: AvailableAction[];
}

/**
 * Student progress on an assignment
 */
export interface StudentAssignmentProgress {
  status: "not_started" | "in_progress" | "completed";
  completedAt?: Date;
  percentComplete: number; // 0-100
  questionsAnswered: number;
  totalQuestions: number;
}

/**
 * Student's coach usage summary
 */
export interface StudentCoachUsage {
  intent: CoachUsageIntent;
  helpRequests: number;
  elaborations: number;
  moreExplorations: number;
  totalInteractions: number;
  hintsUsed: number;
  hintUsageRate: number; // 0-1
}

/**
 * Insight summary for assignment context
 */
export interface AssignmentInsightSummary {
  insightId: string;
  type: InsightType;
  priority: InsightPriority;
  summary: string;
  createdAt: Date;
}

/**
 * Available action for a student in assignment view
 */
export interface AvailableAction {
  actionType: "push_to_student" | "mark_reviewed" | "add_note" | "send_message" | "award_badge" | "dismiss";
  label: string;
  description: string;
  isRecommended: boolean;
}

/**
 * Assignment dashboard summary
 */
export interface AssignmentDashboardSummary {
  // Assignment info
  assignmentId: string;
  assignmentTitle: string;
  subject?: string;
  difficulty?: string;
  assignedAt: Date;

  // Overall stats
  totalStudents: number;
  completed: number;
  inProgress: number;
  notStarted: number;
  averageScore: number;
  highestScore: number;
  lowestScore: number;

  // Understanding breakdown
  strong: number;
  developing: number;
  needsSupport: number;

  // Review progress
  reviewed: number;
  pendingReview: number;

  // Student table
  students: AssignmentStudentRow[];

  // Filtered views
  studentsNeedingAttention: AssignmentStudentRow[];
  studentsCompleted: AssignmentStudentRow[];
  studentsInProgress: AssignmentStudentRow[];

  // Can be archived
  canArchive: boolean;
  archiveBlockers?: string[]; // Reasons why can't archive

  generatedAt: Date;
}

// ============================================
// "What Should I Do Next?" Workflow Types
// ============================================

/**
 * Actionable item for teacher workflow
 */
export interface ActionableItem {
  id: string;

  // Context
  studentId: string;
  studentName: string;
  assignmentId?: string;
  assignmentTitle?: string;
  classId?: string;
  className?: string;

  // Insight reference
  insightId?: string;
  insightType: InsightType;

  // Action details
  actionType: SuggestedActionType;
  title: string;
  description: string;
  evidence: string[];
  suggestedActions: string[];

  // Priority
  priority: InsightPriority;
  urgency: "immediate" | "soon" | "when_available";

  // Status
  status: ActionableItemStatus;

  // Timestamps
  createdAt: Date;
  expiresAt?: Date;
}

/**
 * Suggested action types
 */
export type SuggestedActionType =
  | "check_in" // Schedule conversation with student
  | "challenge" // Offer enrichment/extension
  | "celebrate" // Recognize achievement
  | "reassign" // Push assignment back
  | "monitor" // Keep watching
  | "support_group"; // Group students needing similar support

/**
 * Actionable item status
 */
export type ActionableItemStatus =
  | "pending" // Not yet acted upon
  | "approved" // Teacher approved the suggestion
  | "modified" // Teacher modified and executed
  | "dismissed" // Teacher dismissed without action
  | "completed" // Action was completed
  | "expired"; // Item expired without action

/**
 * Input for taking action on an actionable item
 */
export interface TakeActionInput {
  itemId: string;
  action: "approve" | "modify" | "dismiss";
  teacherId: string;

  // For modifications
  modifiedActionType?: TeacherActionType;
  note?: string;
  messageToStudent?: string;

  // For badges
  awardBadge?: boolean;
  badgeType?: string;
  badgeMessage?: string;
}

/**
 * Result of taking action
 */
export interface TakeActionResult {
  success: boolean;
  error?: string;
  teacherActionId?: string;
  badgeId?: string;
  insightUpdated: boolean;
  itemStatus: ActionableItemStatus;
}

// ============================================
// Student Dashboard Types
// ============================================

/**
 * Student dashboard summary (educator view)
 */
export interface StudentDashboardSummary {
  // Student info
  studentId: string;
  studentName: string;
  classIds: string[];
  classNames: string[];
  createdAt: Date;
  notes?: string;

  // Overall status
  overallStatus: StudentUnderstandingLevel;
  statusDescription: string;

  // Performance stats
  totalAssignments: number;
  completedAssignments: number;
  averageScore: number;
  highestScore: number;
  trend: "improving" | "steady" | "declining";

  // Coach usage
  coachUsage: StudentCoachUsage;
  coachUsageIntent: CoachUsageIntent;

  // Assignments - completed first, then open
  completedAssignmentsList: StudentAssignmentSummary[];
  openAssignmentsList: StudentAssignmentSummary[];

  // Insights
  pendingInsights: AssignmentInsightSummary[];
  resolvedInsightsCount: number;

  // Badges
  badges: StudentBadgeSummary[];
  totalBadges: number;

  // Recent activity
  recentActivity: StudentActivityItem[];

  generatedAt: Date;
}

/**
 * Assignment summary for student view
 */
export interface StudentAssignmentSummary {
  assignmentId: string;
  assignmentTitle: string;
  subject?: string;
  status: "not_started" | "in_progress" | "completed";
  score?: number;
  highestScore?: number;
  attempts: number;
  lastActivityAt?: Date;
  reviewStatus: ReviewStatus;
}

/**
 * Badge summary for student
 */
export interface StudentBadgeSummary {
  badgeId: string;
  type: string;
  typeName: string;
  message?: string;
  assignmentId?: string;
  assignmentTitle?: string;
  issuedAt: Date;
}

/**
 * Recent activity item for student
 */
export interface StudentActivityItem {
  type: "assignment_started" | "assignment_completed" | "badge_earned" | "insight_generated" | "teacher_action";
  description: string;
  timestamp: Date;
  relatedId?: string;
}

// ============================================
// Recent Activity Types
// ============================================

/**
 * Recent activity item for dashboard
 */
export interface RecentActivityItem {
  id: string;
  type: "teacher_action" | "insight_generated" | "assignment_completed" | "badge_awarded";
  actorName: string; // Teacher name or "System"
  targetName: string; // Student name
  description: string;
  timestamp: Date;
  relatedIds: {
    studentId?: string;
    assignmentId?: string;
    insightId?: string;
    actionId?: string;
    badgeId?: string;
  };
}

// ============================================
// Helper Functions
// ============================================

/**
 * Calculate understanding level from score and hint usage
 */
export function calculateUnderstandingLevel(
  score: number | undefined,
  hintUsageRate: number
): StudentUnderstandingLevel {
  if (score === undefined) {
    return "developing"; // No score yet, assume developing
  }

  // Heavy hint usage overrides score for classification
  if (hintUsageRate > DASHBOARD_CONFIG.MODERATE_HINT_RATE) {
    return score >= DASHBOARD_CONFIG.STRONG_THRESHOLD ? "developing" : "needs_support";
  }

  if (score >= DASHBOARD_CONFIG.STRONG_THRESHOLD) {
    return "strong";
  } else if (score >= DASHBOARD_CONFIG.DEVELOPING_THRESHOLD) {
    return "developing";
  } else {
    return "needs_support";
  }
}

/**
 * Calculate coach usage intent from interaction counts
 */
export function calculateCoachUsageIntent(
  helpRequests: number,
  moreExplorations: number
): CoachUsageIntent {
  if (helpRequests === 0 && moreExplorations === 0) {
    return "mixed"; // No coach usage
  }

  if (moreExplorations >= DASHBOARD_CONFIG.ENRICHMENT_COACH_THRESHOLD && helpRequests === 0) {
    return "enrichment_seeking";
  }

  if (helpRequests > 0 && moreExplorations === 0) {
    return "support_seeking";
  }

  return "mixed";
}

/**
 * Determine if a student needs attention based on understanding level
 */
export function needsAttention(level: StudentUnderstandingLevel): boolean {
  return level === "developing" || level === "needs_support";
}

/**
 * Get display label for understanding level
 */
export function getUnderstandingLevelLabel(level: StudentUnderstandingLevel): string {
  const labels: Record<StudentUnderstandingLevel, string> = {
    strong: "Strong",
    developing: "Developing",
    needs_support: "Needs Support",
  };
  return labels[level];
}

/**
 * Get display label for coach usage intent
 */
export function getCoachUsageIntentLabel(intent: CoachUsageIntent): string {
  const labels: Record<CoachUsageIntent, string> = {
    support_seeking: "Support Seeking",
    enrichment_seeking: "Enrichment Seeking",
    mixed: "Mixed Usage",
  };
  return labels[intent];
}

/**
 * Get urgency level for an insight type and priority
 */
export function getUrgencyLevel(
  insightType: InsightType,
  priority: InsightPriority
): "immediate" | "soon" | "when_available" {
  if (insightType === "check_in" && priority === "high") {
    return "immediate";
  }
  if (insightType === "check_in" || priority === "high") {
    return "soon";
  }
  return "when_available";
}

/**
 * Map insight type to suggested action type
 */
export function insightTypeToActionType(insightType: InsightType): SuggestedActionType {
  const mapping: Record<InsightType, SuggestedActionType> = {
    check_in: "check_in",
    challenge_opportunity: "challenge",
    celebrate_progress: "celebrate",
    monitor: "monitor",
  };
  return mapping[insightType];
}
