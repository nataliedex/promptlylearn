/**
 * Recommendation System - Types and Interfaces
 *
 * This module defines the data structures for the "What Should I Do Next?"
 * teacher recommendation system. Recommendations are generated from observable
 * student data and presented as actionable teaching signals.
 */

// ============================================
// Core Types
// ============================================

/**
 * Insight types aligned with Educational Support Intelligence specification:
 * - challenge_opportunity: Student shows readiness for extension/deeper learning
 * - celebrate_progress: Notable improvement or achievement worth recognizing
 * - check_in: Student may benefit from teacher conversation or support
 * - monitor: Situation worth watching but no immediate action needed
 */
export type InsightType =
  | "challenge_opportunity" // Ready for extension or peer tutoring
  | "celebrate_progress" // Notable improvement to recognize
  | "check_in" // May need teacher support or conversation
  | "monitor"; // Worth watching, no immediate action

// Legacy type alias for backward compatibility
export type RecommendationType = InsightType | "individual-checkin" | "small-group" | "assignment-adjustment" | "enrichment" | "celebrate";

export type PriorityLevel = "high" | "medium" | "low";

// Confidence score range: 0.7 to 1.0 (only surface high-confidence insights)
export type ConfidenceScore = number; // 0.7 - 1.0

export type RecommendationStatus = "active" | "reviewed" | "dismissed" | "pending" | "resolved";

// Re-export resolution types for convenience
export type { ResolutionStatus } from "./actionOutcome";

export type FeedbackType = "helpful" | "not-helpful";

// ============================================
// Main Recommendation Interface
// ============================================

/**
 * Recommendation/Insight structure aligned with Educational Support Intelligence spec.
 *
 * Key principles:
 * - Only surface insights with strong evidence (confidence >= 0.7)
 * - ONE insight per student per assignment (prioritize highest value)
 * - Teacher-actionable, non-judgmental language
 * - Include observable evidence, not inferred emotions
 */
export interface Recommendation {
  id: string;

  // New insight type (primary classification)
  insightType: InsightType;
  // Legacy type for backward compatibility
  type: RecommendationType;

  // Core content (new specification format)
  summary: string; // Brief, teacher-actionable summary
  evidence: string[]; // Observable data points supporting this insight
  suggestedTeacherActions: string[]; // Specific actions teacher can take

  // Legacy display content (for backward compatibility)
  title: string; // e.g., "Check in with Alex"
  reason: string; // e.g., "Scored 32% on Math Quiz with heavy hint usage"
  suggestedAction: string; // e.g., "Review their responses and consider a brief conversation"

  // Metadata (new specification)
  priorityLevel: PriorityLevel; // high/medium/low
  confidenceScore: ConfidenceScore; // 0.7 - 1.0

  // Legacy metadata (for backward compatibility)
  confidence: PriorityLevel; // Maps to priorityLevel
  priority: number; // 1-100, higher = more urgent

  // Context - what triggered this recommendation
  studentIds: string[]; // Students this applies to
  assignmentId?: string; // Related assignment (if any)
  triggerData: TriggerData; // Raw data for auditability ("Why am I seeing this?")

  // State management
  status: RecommendationStatus;
  createdAt: string; // ISO timestamp
  reviewedAt?: string; // When marked as reviewed
  reviewedBy?: string; // Who reviewed (future: multi-teacher support)
  feedback?: FeedbackType; // Teacher feedback on recommendation quality
  feedbackNote?: string; // Optional note with feedback

  // Resolution tracking (for action outcome system)
  outcomeId?: string;           // Link to ActionOutcome
  resolutionStatus?: import("./actionOutcome").ResolutionStatus;
  resolvedAt?: string;          // When resolution status was set

  // Checklist action tracking
  submittedActions?: {
    actionKey: string;
    label: string;
    submittedAt: string;
    submittedBy: string;
  }[];

  // Badge suggestion (if applicable)
  suggestedBadge?: {
    badgeType: BadgeType;
    reason: string;
    evidence?: Record<string, any>;
  };
}

// ============================================
// Audit Trail / Trigger Data
// ============================================

export interface TriggerData {
  ruleName: string; // Which detection rule triggered this
  signals: Record<string, any>; // Raw signal values that matched
  generatedAt: string; // When the detection ran
}

// ============================================
// Detection Rule Definitions
// ============================================

export interface DetectionRule {
  name: string;
  insightType: InsightType;
  type: RecommendationType; // Legacy
  description: string;
  baseConfidenceScore: ConfidenceScore;
  basePriority: PriorityLevel;
  // The actual detection logic is implemented in recommendationEngine.ts
}

/**
 * Detection rules aligned with Educational Support Intelligence specification.
 *
 * Insight type mapping:
 * - check_in: Student needs teacher support (struggling, heavy hint usage)
 * - challenge_opportunity: Ready for extension activities
 * - celebrate_progress: Notable improvement worth recognizing
 * - monitor: Worth watching but no immediate action needed
 */
export const DETECTION_RULES: DetectionRule[] = [
  {
    name: "needs-support",
    insightType: "check_in",
    type: "individual-checkin",
    description: "Student showing signs they may benefit from teacher support",
    baseConfidenceScore: 0.85,
    basePriority: "high",
  },
  {
    name: "group-support",
    insightType: "check_in",
    type: "small-group",
    description: "Multiple students showing similar support needs",
    baseConfidenceScore: 0.9,
    basePriority: "high",
  },
  {
    name: "ready-for-challenge",
    insightType: "challenge_opportunity",
    type: "enrichment",
    description: "Student demonstrating mastery, ready for extension",
    baseConfidenceScore: 0.8,
    basePriority: "medium",
  },
  {
    name: "notable-improvement",
    insightType: "celebrate_progress",
    type: "celebrate",
    description: "Student showed significant score improvement",
    baseConfidenceScore: 0.85,
    basePriority: "medium",
  },
  {
    name: "persistence",
    insightType: "celebrate_progress",
    type: "celebrate",
    description: "Student showed great persistence through difficulty (heavy hint usage but completed)",
    baseConfidenceScore: 0.8,
    basePriority: "medium",
  },
  {
    name: "watch-progress",
    insightType: "monitor",
    type: "assignment-adjustment",
    description: "Situation worth monitoring but no immediate action needed",
    baseConfidenceScore: 0.75,
    basePriority: "low",
  },
];

// ============================================
// Configuration Constants
// ============================================

/**
 * Grouping scope defines whether a recommendation type can be grouped
 * or must always remain individual (student-scoped).
 */
export type GroupingScope = "individual_only" | "groupable";

/**
 * Grouping rules for each insight type.
 *
 * GROUPABLE categories (collective action makes sense):
 * - check_in with "needs-support" rule → can form "Needs Support" groups
 * - monitor → assignment-level, inherently grouped/aggregate
 *
 * INDIVIDUAL_ONLY categories (must remain student-scoped):
 * - celebrate_progress → personal recognition, never grouped
 * - challenge_opportunity → individual enrichment path
 * - check_in with "developing" pattern → individual guidance needed
 *
 * Note: The "small-group" legacy type is explicitly for grouped needs-support.
 */
export const GROUPING_RULES: Record<InsightType, GroupingScope> = {
  check_in: "groupable",           // Can be grouped for shared skill gaps (Needs Support)
  monitor: "groupable",            // Assignment-level, inherently aggregate
  celebrate_progress: "individual_only",  // Personal recognition - NEVER grouped
  challenge_opportunity: "individual_only", // Individual enrichment - NEVER grouped
};

/**
 * Detection rules that should NEVER be grouped, even if their insight type
 * would normally allow grouping. These represent individual student needs.
 */
export const INDIVIDUAL_ONLY_RULES: string[] = [
  "developing",           // Developing students need individual attention
  "check-in-suggested",   // Explicit check-in request is individual
];

/**
 * Detection rules that ARE allowed to form groups.
 * Only these rules can create multi-student recommendations.
 */
export const GROUPABLE_RULES: string[] = [
  "needs-support",    // Students struggling with same skill/assignment
  "group-support",    // Explicit group detection
  "watch-progress",   // Assignment-level monitoring
];

/**
 * Default thresholds for categorizing student performance.
 * These can be overridden by teacher settings.
 */
export const DEFAULT_THRESHOLDS = {
  // Needs Support: score < this OR hint usage > NEEDS_SUPPORT_HINT_THRESHOLD
  NEEDS_SUPPORT_SCORE: 50,
  NEEDS_SUPPORT_HINT_THRESHOLD: 0.5, // 50% hint/coach usage triggers needs support

  // Developing: score between NEEDS_SUPPORT_SCORE and DEVELOPING_UPPER
  // AND hint usage between DEVELOPING_HINT_MIN and DEVELOPING_HINT_MAX
  DEVELOPING_UPPER: 80, // Score below this but >= NEEDS_SUPPORT is developing
  DEVELOPING_HINT_MIN: 0.25, // 25% minimum hint usage for developing
  DEVELOPING_HINT_MAX: 0.5, // 50% maximum hint usage for developing

  // Strong/Challenge/Celebrate: score >= this
  STRONG_THRESHOLD: 80,

  // Escalation: if developing student has this many help requests, escalate to needs support
  ESCALATION_HELP_REQUESTS: 3,
};

export const RECOMMENDATION_CONFIG = {
  // Confidence threshold - only surface insights with strong evidence
  MIN_CONFIDENCE_SCORE: 0.7, // Minimum confidence to surface an insight

  // Score thresholds (using defaults, can be overridden by teacher settings)
  NEEDS_SUPPORT_SCORE: DEFAULT_THRESHOLDS.NEEDS_SUPPORT_SCORE,
  NEEDS_SUPPORT_HINT_THRESHOLD: DEFAULT_THRESHOLDS.NEEDS_SUPPORT_HINT_THRESHOLD,
  DEVELOPING_UPPER: DEFAULT_THRESHOLDS.DEVELOPING_UPPER,
  DEVELOPING_HINT_MIN: DEFAULT_THRESHOLDS.DEVELOPING_HINT_MIN,
  DEVELOPING_HINT_MAX: DEFAULT_THRESHOLDS.DEVELOPING_HINT_MAX,
  STRONG_THRESHOLD: DEFAULT_THRESHOLDS.STRONG_THRESHOLD,
  ESCALATION_HELP_REQUESTS: DEFAULT_THRESHOLDS.ESCALATION_HELP_REQUESTS,

  // Legacy thresholds (kept for backward compatibility)
  STRUGGLING_THRESHOLD: DEFAULT_THRESHOLDS.NEEDS_SUPPORT_SCORE,
  EXCELLING_THRESHOLD: DEFAULT_THRESHOLDS.STRONG_THRESHOLD,
  DEVELOPING_THRESHOLD: DEFAULT_THRESHOLDS.DEVELOPING_UPPER,
  HEAVY_HINT_USAGE: DEFAULT_THRESHOLDS.NEEDS_SUPPORT_HINT_THRESHOLD,
  MINIMAL_HINT_USAGE: 0.1, // Using hints on <10% of questions

  // Group thresholds
  MIN_GROUP_SIZE: 2, // Minimum students for group insight

  // Improvement thresholds
  SIGNIFICANT_IMPROVEMENT: 20, // Points improvement to trigger celebrate_progress

  // Display limits
  MAX_ACTIVE_RECOMMENDATIONS: 10, // Increased to allow more concurrent recommendations
  MAX_GROUPED_RECOMMENDATIONS: 3, // Max grouped items to prevent crowding
  PRUNE_AFTER_DAYS: 30, // Remove old reviewed recommendations after this many days

  // Priority weights
  PRIORITY_BASE: 50,
  PRIORITY_NEEDS_SUPPORT: 25,      // Urgent - needs immediate attention
  PRIORITY_DEVELOPING: 10,         // Informational - monitoring recommended
  PRIORITY_INDIVIDUAL_CHECKIN: 20,
  PRIORITY_SMALL_GROUP: 15,
  PRIORITY_ENRICHMENT: 5,
  PRIORITY_CELEBRATE: 10,
  PRIORITY_HIGH_CONFIDENCE: 15,
  PRIORITY_MEDIUM_CONFIDENCE: 5,
  PRIORITY_RECENT_BONUS: 10, // Within 24 hours
  PRIORITY_STALE_PENALTY: -10, // Over 72 hours
  PRIORITY_LARGE_GROUP_BONUS: 5,

  // Individual-only categories get a priority boost to ensure they surface
  PRIORITY_INDIVIDUAL_ONLY_BOOST: 5,

  // Insight priority order (for one-insight-per-student-per-assignment)
  // Higher index = higher priority when choosing between insights
  // NOTE: This only applies within GROUPABLE categories
  INSIGHT_PRIORITY_ORDER: [
    "monitor", // Lowest priority - just watching
    "developing", // Informational - monitoring recommended
    "celebrate_progress", // Good to know but less urgent
    "challenge_opportunity", // Positive action opportunity
    "check_in", // Highest priority - student may need help (needs support)
  ],
};

/**
 * Teacher-adjustable settings interface
 */
export interface TeacherThresholdSettings {
  needsSupportScore: number;      // Default: 50
  needsSupportHintThreshold: number; // Default: 0.5 (50%)
  developingUpper: number;        // Default: 80
  developingHintMin: number;      // Default: 0.25 (25%)
  developingHintMax: number;      // Default: 0.5 (50%)
  strongThreshold: number;        // Default: 80
  escalationHelpRequests: number; // Default: 3
}

/**
 * Get effective thresholds (combining defaults with teacher overrides)
 */
export function getEffectiveThresholds(teacherSettings?: Partial<TeacherThresholdSettings>) {
  return {
    needsSupportScore: teacherSettings?.needsSupportScore ?? DEFAULT_THRESHOLDS.NEEDS_SUPPORT_SCORE,
    needsSupportHintThreshold: teacherSettings?.needsSupportHintThreshold ?? DEFAULT_THRESHOLDS.NEEDS_SUPPORT_HINT_THRESHOLD,
    developingUpper: teacherSettings?.developingUpper ?? DEFAULT_THRESHOLDS.DEVELOPING_UPPER,
    developingHintMin: teacherSettings?.developingHintMin ?? DEFAULT_THRESHOLDS.DEVELOPING_HINT_MIN,
    developingHintMax: teacherSettings?.developingHintMax ?? DEFAULT_THRESHOLDS.DEVELOPING_HINT_MAX,
    strongThreshold: teacherSettings?.strongThreshold ?? DEFAULT_THRESHOLDS.STRONG_THRESHOLD,
    escalationHelpRequests: teacherSettings?.escalationHelpRequests ?? DEFAULT_THRESHOLDS.ESCALATION_HELP_REQUESTS,
  };
}

// ============================================
// Grouping Helper Functions
// ============================================

/**
 * Check if an insight type can be grouped
 */
export function canBeGrouped(insightType: InsightType): boolean {
  return GROUPING_RULES[insightType] === "groupable";
}

/**
 * Check if a specific rule allows grouping
 */
export function ruleAllowsGrouping(ruleName: string): boolean {
  // If explicitly in individual-only list, cannot group
  if (INDIVIDUAL_ONLY_RULES.includes(ruleName)) {
    return false;
  }
  // If explicitly in groupable list, can group
  return GROUPABLE_RULES.includes(ruleName);
}

/**
 * Check if a recommendation must remain individual (never grouped)
 */
export function mustRemainIndividual(insightType: InsightType, ruleName: string): boolean {
  // Check insight type first
  if (GROUPING_RULES[insightType] === "individual_only") {
    return true;
  }
  // Check rule-level override
  if (INDIVIDUAL_ONLY_RULES.includes(ruleName)) {
    return true;
  }
  return false;
}

// ============================================
// API Response Types
// ============================================

export interface RecommendationsResponse {
  recommendations: Recommendation[];
  stats: RecommendationStats;
}

export interface RecommendationStats {
  totalActive: number;
  totalPending: number;
  totalResolved: number;
  reviewedToday: number;
  feedbackRate: number; // Percentage of reviewed that have feedback
}

export interface RefreshResponse {
  generated: number;
  pruned: number;
}

// ============================================
// Input Types for Engine
// ============================================

export interface StudentPerformanceData {
  studentId: string;
  studentName: string;
  assignmentId: string;
  assignmentTitle: string;
  classId?: string;
  score: number;
  hintUsageRate: number; // 0-1, percentage of questions with hints
  coachIntent?: "support-seeking" | "enrichment-seeking" | "mixed";
  hasTeacherNote: boolean;
  completedAt?: string;
  previousScore?: number; // For improvement detection
  previousCompletedAt?: string; // When the previous attempt was completed
  helpRequestCount?: number; // For escalation: number of help requests in coach sessions

  // Badge-related fields
  subject?: string; // Subject for mastery badge evaluation
  timeSpentMinutes?: number; // For focus badge evaluation
  questionCount?: number; // Number of questions in the assignment
  subjectHistory?: { // For mastery badge - subject-level history
    subject: string;
    assignments: {
      assignmentId: string;
      assignmentTitle: string;
      score: number;
      hintUsageRate: number;
      completedAt: string;
    }[];
  }[];
}

export interface AssignmentAggregateData {
  assignmentId: string;
  assignmentTitle: string;
  classId: string;
  className: string;
  studentCount: number;
  completedCount: number;
  averageScore: number;
  studentsNeedingSupport: string[]; // Student IDs
  daysSinceAssigned: number;
}

// ============================================
// Teacher Action Types
// ============================================

/**
 * Teacher Action Type - What the teacher did in response to an insight
 *
 * - mark_reviewed: Simply acknowledged the insight
 * - add_note: Added a note about the student
 * - draft_message: Created a message for the student
 * - other: Custom action with note
 */
export type TeacherActionType =
  | "mark_reviewed"
  | "add_note"
  | "draft_message"
  | "award_badge"
  | "reassign"
  | "schedule_checkin"
  | "other";

/**
 * Teacher Action - Records what teacher did in response to an insight
 *
 * Separate from the insight itself to preserve history and enable
 * tracking of teacher engagement patterns.
 */
export interface TeacherAction {
  id: string;
  insightId: string; // Which insight this action responds to
  teacherId: string;
  actionType: TeacherActionType;

  // Action details
  note?: string; // Teacher's private note
  messageToStudent?: string; // Message drafted for student

  createdAt: Date;
}

/**
 * Input for creating a teacher action
 */
export interface CreateTeacherActionInput {
  insightId: string;
  teacherId: string;
  actionType: TeacherActionType;
  note?: string;
  messageToStudent?: string;
}

// ============================================
// Badge Types
// ============================================

/**
 * Badge - Recognition awarded to students
 *
 * Used primarily for "celebrate_progress" insights but can be
 * awarded independently by teachers.
 */
export interface Badge {
  id: string;
  studentId: string;
  awardedBy: string; // teacherId
  type: BadgeType; // Badge type (e.g., "progress_star", "mastery_badge", custom)
  message?: string; // Optional message from teacher
  assignmentId?: string; // Optional: which assignment earned this
  insightId?: string; // Optional: which insight triggered this badge
  issuedAt: Date;
  // Evidence for student-facing display (from badge criteria evaluation)
  evidence?: {
    previousScore?: number;
    currentScore?: number;
    improvement?: number;
    subjectAverageScore?: number;
    subjectAssignmentCount?: number;
    hintUsageRate?: number;
  };
  // When the student was shown a celebration for this badge (null = not yet celebrated)
  celebratedAt?: string;
}

/**
 * Predefined badge types
 */
export const BADGE_TYPES = {
  progress_star: "Progress Star",
  mastery_badge: "Mastery Badge",
  effort_award: "Effort Award",
  helper_badge: "Helper Badge",
  persistence: "Persistence",
  curiosity: "Curiosity Award",
  focus_badge: "Focus Badge",
  creativity_badge: "Creativity Badge",
  collaboration_badge: "Collaboration Badge",
  custom: "Custom Badge",
} as const;

export type BadgeType = keyof typeof BADGE_TYPES;

/**
 * Input for creating a badge
 */
export interface CreateBadgeInput {
  studentId: string;
  awardedBy: string;
  type: string;
  message?: string;
  assignmentId?: string;
}

/**
 * Check if a string is a valid badge type
 */
export function isBadgeType(value: string): value is BadgeType {
  return value in BADGE_TYPES;
}

/**
 * Get display name for a badge type
 */
export function getBadgeTypeName(type: string): string {
  if (isBadgeType(type)) {
    return BADGE_TYPES[type];
  }
  return type; // Return as-is for custom types
}

// ============================================
// Checklist Action System
// ============================================

/**
 * Stable action keys for the checklist system.
 * These are used in both frontend and backend to identify actions.
 *
 * SYSTEM ACTIONS (execute backend logic):
 * - assign_practice: Assign practice to student(s) - creates pending state
 * - reassign_student: Reassign assignment to student - creates pending state
 * - award_badge: Award a badge to student - requires badgeType
 * - add_note: Add a teacher note - requires noteText
 *
 * SOFT ACTIONS (logged but no system mutation):
 * - run_small_group_review: Teacher plans to run a group review session
 * - review_responses: Teacher plans to review student responses
 * - prepare_targeted_practice: Teacher plans to prepare targeted practice materials
 * - check_in_1to1: Teacher plans a 1-on-1 check-in conversation
 * - discuss_extension: Teacher plans to discuss extension activities
 * - explore_peer_tutoring: Teacher plans to explore peer tutoring
 * - acknowledge_progress: Teacher plans to acknowledge student progress
 */
export type ChecklistActionKey =
  // System actions (execute backend logic)
  | "assign_practice"
  | "reassign_student"
  | "award_badge"
  | "add_note"
  // Soft actions (logged only)
  | "run_small_group_review"
  | "review_responses"
  | "prepare_targeted_practice"
  | "check_in_1to1"
  | "discuss_extension"
  | "explore_peer_tutoring"
  | "acknowledge_progress";

/**
 * Configuration for each checklist action
 */
export interface ChecklistActionConfig {
  key: ChecklistActionKey;
  label: string;
  description?: string;
  isSystemAction: boolean;  // true = executes backend logic, false = soft/logged only
  requiresBadgeType?: boolean;
  requiresNoteText?: boolean;
  createsPendingState?: boolean;  // true = recommendation becomes "pending" after
}

/**
 * All available checklist actions with their configurations
 */
export const CHECKLIST_ACTIONS: Record<ChecklistActionKey, ChecklistActionConfig> = {
  // System actions
  assign_practice: {
    key: "assign_practice",
    label: "Assign additional practice",
    description: "Push practice assignment to selected student(s)",
    isSystemAction: true,
    createsPendingState: true,
  },
  reassign_student: {
    key: "reassign_student",
    label: "Reassign for another attempt",
    description: "Allow student to retry the assignment",
    isSystemAction: true,
    createsPendingState: true,
  },
  award_badge: {
    key: "award_badge",
    label: "Award a badge",
    description: "Recognize student achievement with a badge",
    isSystemAction: true,
    requiresBadgeType: true,
  },
  add_note: {
    key: "add_note",
    label: "Add a teacher note",
    description: "Record a private note about this student",
    isSystemAction: true,
    requiresNoteText: true,
  },

  // Soft actions (logged only)
  run_small_group_review: {
    key: "run_small_group_review",
    label: "Schedule a small group review session",
    isSystemAction: false,
  },
  review_responses: {
    key: "review_responses",
    label: "Review their responses",
    isSystemAction: false,
  },
  prepare_targeted_practice: {
    key: "prepare_targeted_practice",
    label: "Prepare targeted practice activities",
    isSystemAction: false,
  },
  check_in_1to1: {
    key: "check_in_1to1",
    label: "Have a 1-on-1 conversation",
    isSystemAction: false,
  },
  discuss_extension: {
    key: "discuss_extension",
    label: "Discuss extension activities",
    isSystemAction: false,
  },
  explore_peer_tutoring: {
    key: "explore_peer_tutoring",
    label: "Explore peer tutoring opportunities",
    isSystemAction: false,
  },
  acknowledge_progress: {
    key: "acknowledge_progress",
    label: "Acknowledge their progress",
    isSystemAction: false,
  },
};

/**
 * Get checklist actions available for a given recommendation category
 */
export function getChecklistActionsForCategory(
  categoryKey: string,
  options: {
    hasAssignmentId: boolean;
    isGrouped: boolean;
    studentCount: number;
  }
): ChecklistActionKey[] {
  const actions: ChecklistActionKey[] = [];

  switch (categoryKey) {
    case "needs-support":
      if (options.isGrouped) {
        // Grouped needs support
        actions.push("assign_practice");
        actions.push("run_small_group_review");
        actions.push("review_responses");
        actions.push("prepare_targeted_practice");
      } else {
        // Individual needs support
        if (options.hasAssignmentId) {
          actions.push("reassign_student");
        }
        actions.push("review_responses");
        actions.push("check_in_1to1");
        actions.push("add_note");
      }
      break;

    case "group-review":
      actions.push("assign_practice");
      actions.push("run_small_group_review");
      actions.push("review_responses");
      actions.push("prepare_targeted_practice");
      break;

    case "developing":
      actions.push("check_in_1to1");
      actions.push("prepare_targeted_practice");
      actions.push("add_note");
      break;

    case "check-in-suggested":
      actions.push("check_in_1to1");
      if (options.hasAssignmentId) {
        actions.push("reassign_student");
      }
      actions.push("add_note");
      break;

    case "celebrate-progress":
      // Only award badge option for celebration - message is optional
      actions.push("award_badge");
      break;

    case "challenge-opportunity":
      actions.push("discuss_extension");
      actions.push("explore_peer_tutoring");
      actions.push("award_badge");
      actions.push("add_note");
      break;

    case "administrative":
      actions.push("review_responses");
      actions.push("add_note");
      break;

    default:
      // Fallback - basic actions
      actions.push("review_responses");
      actions.push("add_note");
  }

  return actions;
}

/**
 * Check if an action key is valid
 */
export function isValidChecklistActionKey(key: string): key is ChecklistActionKey {
  return key in CHECKLIST_ACTIONS;
}

/**
 * Request payload for submitting checklist actions
 */
export interface SubmitChecklistRequest {
  selectedActionKeys: ChecklistActionKey[];
  noteText?: string;      // Required if add_note is selected
  badgeType?: string;     // Required if award_badge is selected
  badgeMessage?: string;  // Optional message with badge
}

/**
 * A single recorded checklist action entry
 */
export interface ChecklistActionEntry {
  id: string;
  recommendationId: string;
  actionKey: ChecklistActionKey;
  label: string;
  isSystemAction: boolean;
  executedAt: string;
  executedBy: string;  // teacherId
  metadata?: {
    noteText?: string;
    badgeType?: string;
    badgeMessage?: string;
    affectedStudentIds?: string[];
    affectedAssignmentId?: string;
  };
}

/**
 * Response from submitting checklist actions
 */
export interface SubmitChecklistResponse {
  success: boolean;
  recommendation: Recommendation;
  actionEntries: ChecklistActionEntry[];
  systemActionsExecuted: ChecklistActionKey[];
  newStatus: RecommendationStatus;
}
