/**
 * Shared recommendation configuration and utilities
 *
 * This file provides a single source of truth for recommendation
 * category styling across all surfaces:
 * - Educator Dashboard (RecommendationPanel)
 * - Assignment Review (InsightsDrawer)
 * - Student Review Page (InsightsSection)
 *
 * CANONICAL MAPPING: All insight types are mapped here with:
 * - Display config (label, color, bgColor)
 * - Priority (blocking vs non_blocking for review gating)
 */

import type { Recommendation, DerivedInsightType } from "../services/api";

// ============================================
// Priority Types for Review Gating
// ============================================

export type InsightPriority = "blocking" | "non_blocking";

// ============================================
// Canonical DerivedInsight Configuration
// Single source of truth for insight type display and priority
// ============================================

export interface InsightDisplayConfig {
  label: string;
  color: string;
  bgColor: string;
  priority: InsightPriority;
  description: string;
}

/**
 * CANONICAL INSIGHT CONFIG
 * This is the single source of truth for all DerivedInsight types.
 * - "blocking" priority: Mark Reviewed requires educator action
 * - "non_blocking" priority: Mark Reviewed allowed with confirmation
 */
export const INSIGHT_DISPLAY_CONFIG: Record<DerivedInsightType, InsightDisplayConfig> = {
  // BLOCKING: These require educator action before Mark Reviewed
  NEEDS_SUPPORT: {
    label: "NEEDS SUPPORT",
    color: "#dc2626",
    bgColor: "#fef2f2",
    priority: "blocking",
    description: "Student may need additional help",
  },
  MISCONCEPTION_FLAG: {
    label: "MISCONCEPTION",
    color: "#ea580c",
    bgColor: "#fff7ed",
    priority: "blocking",
    description: "Potential misconception identified",
  },
  MOVE_ON_EVENT: {
    label: "MOVED ON",
    color: "#dc2626",
    bgColor: "#fef2f2",
    priority: "blocking",
    description: "Student moved on without demonstrating understanding",
  },

  // NON-BLOCKING: Allow review with optional follow-up
  CHECK_IN: {
    label: "CHECK IN",
    color: "#d97706",
    bgColor: "#fffbeb",
    priority: "non_blocking",
    description: "Consider checking in with student",
  },
  EXTEND_LEARNING: {
    label: "EXTEND LEARNING",
    color: "#059669",
    bgColor: "#ecfdf5",
    priority: "non_blocking",
    description: "Student may be ready for more challenge",
  },
  CHALLENGE_OPPORTUNITY: {
    label: "CHALLENGE OPPORTUNITY",
    color: "#7c3aed",
    bgColor: "#f5f3ff",
    priority: "non_blocking",
    description: "Student shows readiness for extension",
  },
  CELEBRATE_PROGRESS: {
    label: "CELEBRATE PROGRESS",
    color: "#0891b2",
    bgColor: "#ecfeff",
    priority: "non_blocking",
    description: "Notable improvement worth recognizing",
  },
  GROUP_SUPPORT_CANDIDATE: {
    label: "GROUP REVIEW",
    color: "#7c3aed",
    bgColor: "#f5f3ff",
    priority: "non_blocking",
    description: "May benefit from group discussion",
  },
};

/**
 * Get display config for a DerivedInsight type
 */
export function getInsightDisplayConfig(type: DerivedInsightType): InsightDisplayConfig {
  return INSIGHT_DISPLAY_CONFIG[type] || {
    label: "INSIGHT",
    color: "#64748b",
    bgColor: "#f8fafc",
    priority: "non_blocking" as InsightPriority,
    description: "Teacher attention suggested",
  };
}

/**
 * Check if an insight type has blocking priority (requires action before review)
 */
export function isBlockingInsight(type: DerivedInsightType): boolean {
  const config = INSIGHT_DISPLAY_CONFIG[type];
  return config?.priority === "blocking";
}

/**
 * Get all blocking insight types
 */
export function getBlockingInsightTypes(): DerivedInsightType[] {
  return (Object.keys(INSIGHT_DISPLAY_CONFIG) as DerivedInsightType[]).filter(
    (type) => INSIGHT_DISPLAY_CONFIG[type].priority === "blocking"
  );
}

// ============================================
// Legacy Category Configuration (for Recommendation objects)
// ============================================

export interface CategoryConfig {
  color: string;
  bgColor: string;
  icon: string;
  label: string;
  isGroupable: boolean;
  priority: InsightPriority;
  subLabel?: string;
}

/**
 * CATEGORY_CONFIG: Display configuration for legacy Recommendation objects
 *
 * IMPORTANT: "NEEDS SUPPORT" label is RESERVED for blocking DerivedInsights ONLY.
 * Score/hint-based recommendations use "CHECK IN" or "DEVELOPING" labels instead.
 *
 * All Recommendation-based categories are NON-BLOCKING.
 * Only DerivedInsight types (NEEDS_SUPPORT, MISCONCEPTION_FLAG, MOVE_ON_EVENT) can block.
 */
export const CATEGORY_CONFIG: Record<string, CategoryConfig> = {
  // EXTEND LEARNING - for students ready for more challenge (non-blocking)
  "celebrate-progress": {
    color: "#166534",
    bgColor: "#f0fdf4",
    icon: "",
    label: "CELEBRATE PROGRESS",
    isGroupable: false,
    priority: "non_blocking",
  },
  "challenge-opportunity": {
    color: "#166534",
    bgColor: "#f0fdf4",
    icon: "",
    label: "EXTEND LEARNING",
    isGroupable: false,
    priority: "non_blocking",
  },

  // CHECK IN - for students who might benefit from teacher attention (non-blocking)
  // This includes score/hint-based "needs-support" recommendations
  "check-in-suggested": {
    color: "#d97706",
    bgColor: "#fffbeb",
    icon: "",
    label: "CHECK IN",
    isGroupable: true,
    priority: "non_blocking",
  },
  "developing": {
    color: "#7c3aed",
    bgColor: "#f5f3ff",
    icon: "",
    label: "DEVELOPING",
    isGroupable: false,
    priority: "non_blocking",
  },
  "administrative": {
    color: "#64748b",
    bgColor: "#f8fafc",
    icon: "",
    label: "FOLLOW UP",
    isGroupable: true,
    priority: "non_blocking",
  },

  // GROUP REVIEW - aggregated check-in needs (non-blocking)
  "group-review": {
    color: "#7c3aed",
    bgColor: "#f5f3ff",
    icon: "",
    label: "GROUP REVIEW",
    isGroupable: true,
    priority: "non_blocking",
  },
};

// Fallback config for unknown categories
export const DEFAULT_CONFIG: CategoryConfig = {
  color: "#64748b",
  bgColor: "#f8fafc",
  icon: "",
  label: "REVIEW",
  isGroupable: false,
  priority: "non_blocking",
};

// ============================================
// Category Key Determination
// ============================================

/**
 * Determine the display category based on insight type and rule name
 *
 * IMPORTANT: Score/hint-based recommendations (ruleName: "needs-support") now map to
 * "check-in-suggested" category, NOT "needs-support". The "NEEDS SUPPORT" label is
 * RESERVED for blocking DerivedInsights only (NEEDS_SUPPORT, MISCONCEPTION_FLAG, MOVE_ON_EVENT).
 */
export function getCategoryKey(rec: Recommendation): string {
  const ruleName = rec.triggerData?.ruleName || "";
  // Type union allows both new InsightType and legacy RecommendationType values
  const insightType: string = rec.insightType || rec.type;
  const isGrouped = rec.studentIds.length > 1;

  // Check rule name first for more specific categorization
  switch (ruleName) {
    case "notable-improvement":
      return "celebrate-progress";
    case "ready-for-challenge":
      return "challenge-opportunity";
    case "check-in-suggested":
      return "check-in-suggested";
    case "developing":
      return "developing";
    case "group-support":
      return "group-review";
    case "needs-support":
      // Score/hint-based recommendations → CHECK IN (not "NEEDS SUPPORT")
      // "NEEDS SUPPORT" label is reserved for blocking DerivedInsights
      return isGrouped ? "group-review" : "check-in-suggested";
    case "watch-progress":
      return "administrative";
  }

  // Fall back to insight type
  switch (insightType) {
    case "celebrate_progress":
    case "celebrate":
      return "celebrate-progress";
    case "challenge_opportunity":
    case "enrichment":
      return "challenge-opportunity";
    case "monitor":
    case "assignment-adjustment":
      return "administrative";
    case "check_in":
    case "individual-checkin":
      // Score/hint based check-ins → CHECK IN category
      return isGrouped ? "group-review" : "check-in-suggested";
    case "small-group":
      return "group-review";
  }

  // Default fallback: CHECK IN (non-blocking)
  return "check-in-suggested";
}

/**
 * Get display configuration for a recommendation
 */
export function getCategoryConfig(rec: Recommendation): CategoryConfig {
  const key = getCategoryKey(rec);
  return CATEGORY_CONFIG[key] || DEFAULT_CONFIG;
}

/**
 * Check if a recommendation has blocking priority (requires action before review)
 *
 * ALWAYS returns false - Recommendations (score/hint-based) are NEVER blocking.
 * Only DerivedInsights can be blocking. Use isBlockingInsight() for DerivedInsight types.
 */
export function isBlockingRecommendation(_rec: Recommendation): boolean {
  // Recommendations are never blocking - only DerivedInsights can block
  return false;
}

/**
 * Get all blocking category keys
 *
 * Returns empty array - no Recommendation categories are blocking.
 * Blocking is determined by DerivedInsight types only.
 */
export function getBlockingCategoryKeys(): string[] {
  // No recommendation categories are blocking
  return [];
}

// ============================================
// Signal Formatting
// ============================================

/**
 * Format recommendation signals for display
 */
export function formatSignals(signals: Record<string, unknown>): string[] {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(signals)) {
    if (value === undefined || value === null) continue;

    switch (key) {
      case "score":
        lines.push(`Score: ${Math.round(value as number)}%`);
        break;
      case "previousScore":
        lines.push(`Previous score: ${Math.round(value as number)}%`);
        break;
      case "currentScore":
        lines.push(`Current score: ${Math.round(value as number)}%`);
        break;
      case "improvement":
        lines.push(`Improvement: +${Math.round(value as number)}%`);
        break;
      case "averageScore":
        lines.push(`Class average: ${Math.round(value as number)}%`);
        break;
      case "hintUsageRate":
        lines.push(`Hint usage: ${Math.round((value as number) * 100)}%`);
        break;
      case "coachIntent":
        if (value === "support-seeking") {
          lines.push("Coach pattern: Seeking support");
        } else if (value === "enrichment-seeking") {
          lines.push("Coach pattern: Seeking enrichment");
        } else if (value) {
          lines.push(`Coach pattern: ${value}`);
        }
        break;
      case "hasTeacherNote":
        lines.push(value ? "Has teacher note: Yes" : "Has teacher note: No");
        break;
      case "studentCount":
        lines.push(`Students in group: ${value}`);
        break;
      case "studentNames":
        lines.push(`Students: ${value}`);
        break;
      case "className":
        lines.push(`Class: ${value}`);
        break;
      case "completionRate":
        lines.push(`Completion rate: ${Math.round(value as number)}%`);
        break;
      case "completedCount":
        lines.push(`Completed: ${value} students`);
        break;
      case "daysSinceAssigned":
        lines.push(`Days since assigned: ${value}`);
        break;
      case "helpRequestCount":
        lines.push(`Help requests: ${value}`);
        break;
      case "escalatedFromDeveloping":
        if (value) {
          lines.push("Escalated from Developing due to repeated help requests");
        }
        break;
      default:
        // Skip unknown keys to avoid clutter
        break;
    }
  }

  return lines;
}
