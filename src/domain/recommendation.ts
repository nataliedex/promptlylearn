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

export type RecommendationType =
  | "individual-checkin" // Single student needs attention
  | "small-group" // 2+ students share a pattern
  | "assignment-adjustment" // Assignment-level issue
  | "enrichment" // Student ready for challenge
  | "celebrate"; // Positive reinforcement opportunity

export type ConfidenceLevel = "low" | "medium" | "high";

export type RecommendationStatus = "active" | "reviewed" | "dismissed";

export type FeedbackType = "helpful" | "not-helpful";

// ============================================
// Main Recommendation Interface
// ============================================

export interface Recommendation {
  id: string;
  type: RecommendationType;

  // Display content
  title: string; // e.g., "Check in with Alex"
  reason: string; // e.g., "Scored 32% on Math Quiz with heavy hint usage"
  suggestedAction: string; // e.g., "Review their responses and consider a brief conversation"

  // Metadata
  confidence: ConfidenceLevel;
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
  type: RecommendationType;
  description: string;
  baseConfidence: ConfidenceLevel;
  // The actual detection logic is implemented in recommendationEngine.ts
}

// Predefined rules for reference
export const DETECTION_RULES: DetectionRule[] = [
  {
    name: "struggling-student",
    type: "individual-checkin",
    description: "Student scored below threshold or used heavy coaching support",
    baseConfidence: "high",
  },
  {
    name: "group-struggle",
    type: "small-group",
    description: "Multiple students in same class struggling with same assignment",
    baseConfidence: "high",
  },
  {
    name: "ready-for-challenge",
    type: "enrichment",
    description: "Student excelling with minimal help, may benefit from extension",
    baseConfidence: "medium",
  },
  {
    name: "assignment-difficulty",
    type: "assignment-adjustment",
    description: "Majority of class struggling, assignment may need adjustment",
    baseConfidence: "medium",
  },
  {
    name: "notable-improvement",
    type: "celebrate",
    description: "Student showed significant score improvement",
    baseConfidence: "medium",
  },
];

// ============================================
// Configuration Constants
// ============================================

export const RECOMMENDATION_CONFIG = {
  // Score thresholds
  STRUGGLING_THRESHOLD: 40, // Score below this = struggling
  EXCELLING_THRESHOLD: 90, // Score above this = excelling
  DEVELOPING_THRESHOLD: 70, // Score below this = developing

  // Hint usage thresholds
  HEAVY_HINT_USAGE: 0.6, // Using hints on >60% of questions
  MINIMAL_HINT_USAGE: 0.1, // Using hints on <10% of questions

  // Group thresholds
  MIN_GROUP_SIZE: 2, // Minimum students for group recommendation

  // Improvement thresholds
  SIGNIFICANT_IMPROVEMENT: 20, // Points improvement to trigger celebrate

  // Display limits
  MAX_ACTIVE_RECOMMENDATIONS: 5, // Max shown at once
  PRUNE_AFTER_DAYS: 30, // Remove old reviewed recommendations after this many days

  // Priority weights
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
