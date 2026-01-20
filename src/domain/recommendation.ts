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

export type RecommendationStatus = "active" | "reviewed" | "dismissed";

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

export const RECOMMENDATION_CONFIG = {
  // Confidence threshold - only surface insights with strong evidence
  MIN_CONFIDENCE_SCORE: 0.7, // Minimum confidence to surface an insight

  // Score thresholds
  STRUGGLING_THRESHOLD: 40, // Score below this = check_in insight
  EXCELLING_THRESHOLD: 90, // Score above this = challenge_opportunity
  DEVELOPING_THRESHOLD: 70, // Score below this = developing

  // Hint usage thresholds
  HEAVY_HINT_USAGE: 0.6, // Using hints on >60% of questions
  MINIMAL_HINT_USAGE: 0.1, // Using hints on <10% of questions

  // Group thresholds
  MIN_GROUP_SIZE: 2, // Minimum students for group insight

  // Improvement thresholds
  SIGNIFICANT_IMPROVEMENT: 20, // Points improvement to trigger celebrate_progress

  // Display limits
  MAX_ACTIVE_RECOMMENDATIONS: 5, // Max shown at once
  PRUNE_AFTER_DAYS: 30, // Remove old reviewed recommendations after this many days

  // Priority weights (legacy)
  PRIORITY_BASE: 50,
  PRIORITY_INDIVIDUAL_CHECKIN: 20,
  PRIORITY_SMALL_GROUP: 25,
  PRIORITY_ENRICHMENT: 5,
  PRIORITY_CELEBRATE: 0,
  PRIORITY_HIGH_CONFIDENCE: 15,
  PRIORITY_MEDIUM_CONFIDENCE: 5,
  PRIORITY_RECENT_BONUS: 10, // Within 24 hours
  PRIORITY_STALE_PENALTY: -10, // Over 72 hours
  PRIORITY_LARGE_GROUP_BONUS: 10, // 3+ students

  // Insight priority order (for one-insight-per-student-per-assignment)
  // Higher index = higher priority when choosing between insights
  INSIGHT_PRIORITY_ORDER: [
    "monitor", // Lowest priority - just watching
    "celebrate_progress", // Good to know but less urgent
    "challenge_opportunity", // Positive action opportunity
    "check_in", // Highest priority - student may need help
  ],
};

// ============================================
// API Response Types
// ============================================

export interface RecommendationsResponse {
  recommendations: Recommendation[];
  stats: RecommendationStats;
}

export interface RecommendationStats {
  totalActive: number;
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
