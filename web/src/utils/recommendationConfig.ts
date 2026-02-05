/**
 * Shared recommendation configuration and utilities
 *
 * This file provides a single source of truth for recommendation
 * category styling across all surfaces:
 * - Educator Dashboard (RecommendationPanel)
 * - Assignment Review (InsightsDrawer)
 * - Student Review Page (InsightsSection)
 */

import type { Recommendation } from "../services/api";

// ============================================
// Category Configuration
// ============================================

export interface CategoryConfig {
  color: string;
  bgColor: string;
  icon: string;
  label: string;
  isGroupable: boolean;
  subLabel?: string;
}

export const CATEGORY_CONFIG: Record<string, CategoryConfig> = {
  // EXTEND LEARNING - for students ready for more challenge
  "celebrate-progress": {
    color: "#166534",
    bgColor: "#f0fdf4",
    icon: "",
    label: "EXTEND LEARNING",
    isGroupable: false,
  },
  "challenge-opportunity": {
    color: "#166534",
    bgColor: "#f0fdf4",
    icon: "",
    label: "EXTEND LEARNING",
    isGroupable: false,
  },

  // NEEDS SUPPORT - for students who might benefit from teacher attention
  "check-in-suggested": {
    color: "#7c3aed",
    bgColor: "#f5f3ff",
    icon: "",
    label: "NEEDS SUPPORT",
    isGroupable: false,
  },
  "developing": {
    color: "#7c3aed",
    bgColor: "#f5f3ff",
    icon: "",
    label: "NEEDS SUPPORT",
    isGroupable: false,
  },
  "administrative": {
    color: "#7c3aed",
    bgColor: "#f5f3ff",
    icon: "",
    label: "NEEDS SUPPORT",
    isGroupable: true,
  },

  // NEEDS SUPPORT - for students who may be struggling
  "needs-support": {
    color: "#dc2626",
    bgColor: "#fef2f2",
    icon: "",
    label: "NEEDS SUPPORT",
    isGroupable: true,
  },
  "group-review": {
    color: "#dc2626",
    bgColor: "#fef2f2",
    icon: "",
    label: "NEEDS SUPPORT",
    isGroupable: true,
  },
};

// Fallback config for unknown categories
export const DEFAULT_CONFIG: CategoryConfig = {
  color: "#64748b",
  bgColor: "#f8fafc",
  icon: "",
  label: "CHECK IN",
  isGroupable: false,
};

// ============================================
// Category Key Determination
// ============================================

/**
 * Determine the display category based on insight type and rule name
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
      // If grouped, show as Group Review; if single, show as Needs Support
      return isGrouped ? "group-review" : "needs-support";
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
      // Determine based on grouping
      if (isGrouped) return "group-review";
      return "needs-support";
    case "small-group":
      return "group-review";
  }

  return "needs-support"; // Default fallback
}

/**
 * Get display configuration for a recommendation
 */
export function getCategoryConfig(rec: Recommendation): CategoryConfig {
  const key = getCategoryKey(rec);
  return CATEGORY_CONFIG[key] || DEFAULT_CONFIG;
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
