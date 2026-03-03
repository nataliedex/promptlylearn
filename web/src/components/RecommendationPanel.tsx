/**
 * RecommendationPanel - Recommended Actions UI Component
 *
 * Core Principle: Recommended Actions only shows items that require educator attention.
 * If no action is needed, nothing appears.
 *
 * This surface answers one question: "Where should I look next?"
 *
 * Card structure (individual):
 * 1. Category badge + Timestamp (right-aligned, e.g., "Today", "Yesterday", "3d ago")
 * 2. Student name as primary headline (just the name, no "may benefit" language)
 * 3. Context line: "{assignmentTitle} · {subject}" - NO status pills
 * 4. Why sentence - single specific sentence with concrete numbers (score, hint %, etc.)
 *    - NO Dismiss button (removed from UI)
 *
 * Card structure (group - when students share the same reason):
 * 1. Category badge + Timestamp (right-aligned)
 * 2. "X students need follow-up" as title
 * 3. Student names list (up to 4, then "and N more")
 * 4. Context line: "{assignmentTitle} · {subject}"
 * 5. Why sentence: MUST start with "Shared issue:" prefix
 *    - NO Dismiss button (removed from UI)
 *
 * Why sentence rules (always include concrete numbers when available):
 * - CHECK IN: "Used hints on X% of questions and scored Y%—may be relying on support prompts."
 * - DEVELOPING: "Scored X% with hints on Y%—inconsistent independence; consider targeted practice."
 * - EXTEND LEARNING: "Scored X% with minimal hints (Y%)—ready for extension activities."
 * - Group cards: "Shared issue: low scores (below 50%)—consider a small-group reteach."
 *
 * Timestamp source priority:
 * 1. signals.completedAt
 * 2. signals.submittedAt
 * 3. triggerData.generatedAt
 * 4. recommendation.createdAt
 *
 * Interaction:
 * - Entire card is clickable → navigates to relevant review context
 * - Passes navigation state for proper back button behavior
 * - No buttons, no checkboxes, no action controls
 *
 * Supports both legacy Recommendation objects and new DerivedInsight objects.
 */

import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  type Recommendation,
  type FeedbackType,
  type DerivedInsight,
  type DerivedInsightType,
} from "../services/api";
import {
  getCategoryKey,
  getCategoryConfig,
  getInsightDisplayConfig,
} from "../utils/recommendationConfig";

// Navigation state passed to student review page
export interface RecommendationNavigationState {
  from: "recommended-actions";
  returnTo: string;
  scrollTo: string;
  recommendationId: string;
  recommendationType: string;
  categoryLabel: string;
  // DerivedInsight fields for consistent display
  insightTitle?: string;
  insightWhy?: string;
  highlightQuestionId?: string;
  // Reason metadata for Shared Issues grouping on AssignmentReview
  reasonKey?: string;
  reasonLabel?: string;
  reasonDetails?: string;
  // DEPRECATED: Group context - kept for backward compatibility
  isGroupRecommendation?: boolean;
  groupStudentIds?: string[];
  groupStudentNames?: string[];
}

// ============================================
// Helper: Normalize Signals from Recommendation
// ============================================

interface NormalizedSignals {
  scorePercent: number | null;         // Always 0-100 or null
  hintPercent: number | null;          // Always 0-100 or null
  previousScorePercent: number | null; // For improvement tracking
  currentScorePercent: number | null;  // For improvement tracking
  improvement: number | null;          // Score delta
  attempts: number | null;             // Retry count
  hintsUsed: number | null;            // Raw hint count
  movedOn: boolean;                    // Coach moved on signal
  misconception: boolean;              // Misconception detected
  misconceptionLabel: string | null;   // Specific misconception
  completedAt: string | null;          // Timestamp
  // Debug info
  _debug: {
    scoreSource: string | null;
    hintSource: string | null;
    rawScore: unknown;
    rawHint: unknown;
  };
}

/**
 * Safely extract and normalize signal values from recommendation triggerData.
 *
 * Handles:
 * - Multiple key names (score, currentScore, totalScore, evaluationScore, averageScore)
 * - Both 0-1 and 0-100 ranges (auto-detects and normalizes to 0-100)
 * - 0 as a valid value (does not fail on falsy checks)
 * - Missing/undefined values (returns null, not undefined)
 *
 * @param rec The recommendation to extract signals from
 * @returns Normalized signal values with nulls for missing data
 */
function normalizeSignals(rec: Recommendation): NormalizedSignals {
  const signals = rec.triggerData?.signals || {};

  // Helper: Extract number from multiple possible keys
  const getNumber = (keys: string[]): { value: number | null; source: string | null; raw: unknown } => {
    for (const key of keys) {
      const raw = signals[key];
      if (typeof raw === "number" && !isNaN(raw)) {
        return { value: raw, source: key, raw };
      }
    }
    return { value: null, source: null, raw: undefined };
  };

  // Helper: Normalize a value to 0-100 percentage
  // If value is <= 1 and not null, assume it's 0-1 and multiply by 100
  const toPercent = (value: number | null): number | null => {
    if (value === null) return null;
    // If value is between 0 and 1 (exclusive of 1.01), treat as decimal
    // Otherwise treat as already percentage
    if (value >= 0 && value <= 1.01) {
      return Math.round(value * 100);
    }
    return Math.round(value);
  };

  // Extract score (try multiple key names)
  const scoreKeys = ["score", "currentScore", "totalScore", "evaluationScore", "averageScore"];
  const scoreResult = getNumber(scoreKeys);
  // Score is already 0-100 in the backend, but handle edge cases
  let scorePercent = scoreResult.value;
  if (scorePercent !== null && scorePercent <= 1.01 && scorePercent >= 0) {
    // Edge case: if score looks like a decimal (0.0-1.0), convert
    // But 0 and 1 are ambiguous - assume 0-100 if > 1
    if (scorePercent > 0 && scorePercent < 1) {
      scorePercent = Math.round(scorePercent * 100);
    }
  } else if (scorePercent !== null) {
    scorePercent = Math.round(scorePercent);
  }

  // Extract hint usage rate (try multiple key names)
  const hintKeys = ["hintUsageRate", "hintUsage", "hintsUsedPercent", "hintRate"];
  const hintResult = getNumber(hintKeys);
  // Hint rate is 0-1 in backend, normalize to 0-100
  const hintPercent = toPercent(hintResult.value);

  // Previous/current scores for improvement tracking
  const prevScoreResult = getNumber(["previousScore"]);
  const currScoreResult = getNumber(["currentScore", "score"]);
  const improvementResult = getNumber(["improvement"]);

  // Attempts and hints used
  const attemptsResult = getNumber(["attempts", "attemptCount"]);
  const hintsUsedResult = getNumber(["hintsUsed", "hintCount"]);

  // Boolean signals
  const movedOn = signals.movedOn === true || signals.coachMovedOn === true;
  const misconception = signals.misconception === true;

  // Misconception label
  const misconceptionLabel =
    (typeof signals.misconceptionConcept === "string" ? signals.misconceptionConcept : null) ||
    (typeof signals.misconceptionLabel === "string" ? signals.misconceptionLabel : null);

  // Timestamp
  const completedAt =
    (typeof signals.completedAt === "string" ? signals.completedAt : null) ||
    (typeof signals.submittedAt === "string" ? signals.submittedAt : null);

  return {
    scorePercent,
    hintPercent,
    previousScorePercent: prevScoreResult.value !== null ? Math.round(prevScoreResult.value) : null,
    currentScorePercent: currScoreResult.value !== null ? Math.round(currScoreResult.value) : null,
    improvement: improvementResult.value !== null ? Math.round(improvementResult.value) : null,
    attempts: attemptsResult.value,
    hintsUsed: hintsUsedResult.value !== null ? Math.round(hintsUsedResult.value) : null,
    movedOn,
    misconception,
    misconceptionLabel,
    completedAt,
    _debug: {
      scoreSource: scoreResult.source,
      hintSource: hintResult.source,
      rawScore: scoreResult.raw,
      rawHint: hintResult.raw,
    },
  };
}

// ============================================
// Helper: Build Why Sentence (Individual Cards)
// ============================================

// Fallback tracking for quality monitoring
let _whySentenceFallbackCount = 0;
let _whySentenceTotalCount = 0;

/**
 * Builds a plain-English, trigger-specific "why" sentence for an INDIVIDUAL recommendation.
 *
 * HARD RULES (NON-NEGOTIABLE):
 * - BANNED PHRASES: "needs review", "details aren't available", "performance patterns",
 *   "flagged", "may benefit", "review assignment responses", "assess understanding"
 * - ALWAYS prefer concrete numbers (score %, hint %)
 * - ALWAYS include a clear teacher action
 * - If score + hint data exist → they MUST appear
 * - Fallback ONLY when scorePercent AND hintPercent are BOTH null AND no other signal
 *
 * APPROVED TEMPLATES:
 * - Coach moved on: "Coach moved on after multiple attempts (scored X% with hints on Y%) — check for a misconception before continuing."
 * - Low score (<50%): "Scored X% with hints on Y% — prioritize a quick 1:1 check-in."
 * - High hint usage (>=80%): "Used hints on Y% of questions (scored X%) — practice solving one problem without hints."
 * - Developing (50-79%): "Scored X% with hints on Y% — accuracy improving; reinforce independent practice."
 * - Ready for challenge: "Scored X% with low hint use (Y%) — ready for extension."
 * - Notable improvement: "Improved from A% to B% — acknowledge growth and reinforce the strategy used."
 * - Persistence: "Multiple attempts with X hints — check for a specific blocker."
 */
function buildWhySentence(rec: Recommendation): string {
  const ruleName = rec.triggerData?.ruleName || "";
  const normalized = normalizeSignals(rec);

  const {
    scorePercent: scorePct,
    hintPercent: hintPct,
    previousScorePercent: previousScore,
    currentScorePercent: currentScore,
    improvement,
    attempts,
    hintsUsed,
    movedOn,
  } = normalized;

  _whySentenceTotalCount++;
  let templateBranch = "unknown";

  // DEV LOGGING: Log signal extraction for debugging
  if (process.env.NODE_ENV === "development") {
    console.log(`[WhySentence] rec=${rec.id?.slice(0, 8)} rule=${ruleName}`, {
      scorePct,
      hintPct,
      scoreSource: normalized._debug.scoreSource,
      hintSource: normalized._debug.hintSource,
    });
  }

  let result: string;

  // =============================================
  // PRIORITY 1: Coach moved on (most urgent)
  // =============================================
  if (movedOn) {
    templateBranch = "coach_moved_on";
    if (scorePct !== null && hintPct !== null) {
      result = `Coach moved on after multiple attempts (scored ${scorePct}% with hints on ${hintPct}%) — check for a misconception before continuing.`;
    } else if (scorePct !== null) {
      result = `Coach moved on after multiple attempts (scored ${scorePct}%) — check for a misconception before continuing.`;
    } else if (hintPct !== null) {
      result = `Coach moved on after multiple attempts (hints on ${hintPct}%) — check for a misconception before continuing.`;
    } else {
      result = `Coach moved on after multiple attempts — check for a misconception before continuing.`;
    }
  }
  // =============================================
  // PRIORITY 2: High hint usage (>=80%)
  // =============================================
  else if (hintPct !== null && hintPct >= 80) {
    templateBranch = "high_hints";
    if (scorePct !== null) {
      result = `Used hints on ${hintPct}% of questions (scored ${scorePct}%) — practice solving one problem without hints.`;
    } else {
      result = `Used hints on ${hintPct}% of questions — practice solving one problem without hints.`;
    }
  }
  // =============================================
  // PRIORITY 3: Low score (<50%)
  // =============================================
  else if (scorePct !== null && scorePct < 50) {
    templateBranch = "low_score";
    if (hintPct !== null) {
      result = `Scored ${scorePct}% with hints on ${hintPct}% — prioritize a quick 1:1 check-in.`;
    } else {
      result = `Scored ${scorePct}% — prioritize a quick 1:1 check-in.`;
    }
  }
  // =============================================
  // PRIORITY 4: Notable improvement (celebrate)
  // =============================================
  else if (ruleName === "notable-improvement" || ruleName === "celebrate-progress") {
    templateBranch = "notable_improvement";
    if (previousScore !== null && currentScore !== null) {
      result = `Improved from ${previousScore}% to ${currentScore}% — acknowledge growth and reinforce the strategy used.`;
    } else if (improvement !== null && scorePct !== null) {
      result = `Improved by ${improvement} points to ${scorePct}% — acknowledge growth and reinforce the strategy used.`;
    } else if (scorePct !== null) {
      result = `Now at ${scorePct}% (up from before) — acknowledge growth and reinforce the strategy used.`;
    } else {
      // Has improvement signal but no numbers - still actionable
      result = `Showed improvement on this assignment — acknowledge growth and reinforce the strategy used.`;
    }
  }
  // =============================================
  // PRIORITY 5: Persistence
  // =============================================
  else if (ruleName === "persistence") {
    templateBranch = "persistence";
    if (attempts !== null && hintsUsed !== null) {
      result = `Multiple attempts (${attempts}) with ${hintsUsed} hints used — check for a specific blocker.`;
    } else if (hintsUsed !== null) {
      result = `Multiple attempts with ${hintsUsed} hints used — check for a specific blocker.`;
    } else if (hintPct !== null && scorePct !== null) {
      result = `Persisted through difficulty (scored ${scorePct}% with ${hintPct}% hints) — acknowledge the effort.`;
    } else if (scorePct !== null) {
      result = `Persisted through difficulty (scored ${scorePct}%) — acknowledge the effort.`;
    } else {
      result = `Showed persistence through difficulty — acknowledge the effort.`;
    }
  }
  // =============================================
  // PRIORITY 6: Ready for challenge (high score + low hints)
  // =============================================
  else if (
    ruleName === "ready-for-challenge" ||
    ruleName === "challenge-opportunity" ||
    ruleName === "seed_extend_learning" ||
    (scorePct !== null && scorePct >= 80 && (hintPct === null || hintPct <= 20))
  ) {
    templateBranch = "ready_for_challenge";
    if (scorePct !== null && hintPct !== null) {
      result = `Scored ${scorePct}% with low hint use (${hintPct}%) — ready for extension.`;
    } else if (scorePct !== null) {
      result = `Scored ${scorePct}% — ready for extension.`;
    } else {
      // Strong performance without specific numbers - still valid
      result = `Strong performance on this assignment — ready for extension.`;
    }
  }
  // =============================================
  // PRIORITY 7: Developing (50-79% with some hints)
  // =============================================
  else if (scorePct !== null && scorePct >= 50 && scorePct < 80) {
    templateBranch = "developing";
    if (hintPct !== null) {
      result = `Scored ${scorePct}% with hints on ${hintPct}% — accuracy improving; reinforce independent practice.`;
    } else {
      result = `Scored ${scorePct}% — accuracy improving; reinforce independent practice.`;
    }
  }
  // =============================================
  // PRIORITY 8: Have score data (catch-all with numbers)
  // =============================================
  else if (scorePct !== null) {
    templateBranch = "score_only";
    if (hintPct !== null) {
      result = `Scored ${scorePct}% with hints on ${hintPct}% — open the assignment to see specific responses.`;
    } else {
      result = `Scored ${scorePct}% — open the assignment to see specific responses.`;
    }
  }
  // =============================================
  // PRIORITY 9: Have hint data only
  // =============================================
  else if (hintPct !== null) {
    templateBranch = "hints_only";
    result = `Used hints on ${hintPct}% of questions — open the assignment to see specific responses.`;
  }
  // =============================================
  // FALLBACK: No numeric data at all
  // =============================================
  else {
    templateBranch = "fallback";
    _whySentenceFallbackCount++;
    result = `Recent submission requires review — open the assignment to see responses.`;

    // DEV WARNING for missing signals
    if (process.env.NODE_ENV === "development") {
      console.warn(`[WhySentence] Missing numeric signals for rec=${rec.id?.slice(0, 8)} rule=${ruleName}`);

      // Check fallback rate periodically
      if (_whySentenceTotalCount >= 5 && _whySentenceFallbackCount / _whySentenceTotalCount > 0.2) {
        console.warn(
          `[WhyQuality] High fallback rate detected: ${_whySentenceFallbackCount}/${_whySentenceTotalCount} ` +
          `(${Math.round(_whySentenceFallbackCount / _whySentenceTotalCount * 100)}%) — investigate signal population.`
        );
      }
    }
  }

  // DEV LOGGING: Which template was selected
  if (process.env.NODE_ENV === "development") {
    console.log(`[WhySentence] Template: ${templateBranch}`);
  }

  return result;
}

// Alias for backward compatibility
const getRecommendationExplanation = buildWhySentence;

// ============================================
// Helper: Build Why Sentence (Group Cards / Shared Issues)
// ============================================

/**
 * Builds a "Shared issue:" or "Shared strength:" prefixed explanation for GROUP recommendations.
 *
 * HONESTY RULES (we only claim what we can prove):
 * - We group by: low score, high hint usage, or ready-for-challenge on SAME assignment
 * - We do NOT detect: same missed question, same concept, same misconception
 * - Therefore we CANNOT claim: "confusion about the same concept", "similar patterns"
 *
 * ALLOWED TEMPLATES (based on what we actually know):
 * - Low score: "Shared issue: X students scored below 50% — small-group reteach recommended."
 * - High hints: "Shared issue: high hint usage across X students (avg Y%) — practice solving without hints together."
 * - Developing: "Shared issue: X students scored between 60–75% — reinforce the core skill in a small group."
 * - Ready for challenge: "Shared strength: X students scored above 90% — consider extension activities together."
 * - Fallback: "Shared issue: multiple students require review — open submissions to identify patterns."
 *
 * BANNED CLAIMS: "misconception", "same concept", "confusion", "similar patterns"
 */
function buildGroupWhySentence(rec: Recommendation): string {
  const ruleName = rec.triggerData?.ruleName || "";
  const normalized = normalizeSignals(rec);
  const studentCount = rec.studentIds?.length || 0;

  const {
    scorePercent: scorePct,
    hintPercent: hintPct,
  } = normalized;

  // DEV LOGGING: Log signal extraction for debugging
  if (process.env.NODE_ENV === "development") {
    console.log(`[GroupWhySentence] rec=${rec.id?.slice(0, 8)} rule=${ruleName} students=${studentCount}`, {
      scorePct,
      hintPct,
      scoreSource: normalized._debug.scoreSource,
      hintSource: normalized._debug.hintSource,
    });
  }

  // =============================================
  // PRIORITY 1: Low scores (<50%) — most common grouping reason
  // =============================================
  if (scorePct !== null && scorePct < 50) {
    if (hintPct !== null) {
      return `Shared issue: ${studentCount} students scored below 50% (avg ${scorePct}%, ${hintPct}% hint usage) — small-group reteach recommended.`;
    }
    return `Shared issue: ${studentCount} students scored below 50% — small-group reteach recommended.`;
  }

  // =============================================
  // PRIORITY 2: High hint usage (>=70%)
  // =============================================
  if (hintPct !== null && hintPct >= 70) {
    if (scorePct !== null) {
      return `Shared issue: high hint usage across ${studentCount} students (avg ${hintPct}%, scored ${scorePct}%) — practice solving without hints together.`;
    }
    return `Shared issue: high hint usage across ${studentCount} students (avg ${hintPct}%) — practice solving without hints together.`;
  }

  // =============================================
  // PRIORITY 3: Ready for challenge (high performers)
  // =============================================
  if (
    ruleName === "ready-for-challenge" ||
    ruleName === "challenge-opportunity" ||
    ruleName === "seed_extend_learning" ||
    (scorePct !== null && scorePct >= 90)
  ) {
    if (scorePct !== null) {
      return `Shared strength: ${studentCount} students scored above 90% — consider extension activities together.`;
    }
    return `Shared strength: ${studentCount} students showed strong performance — consider extension activities together.`;
  }

  // =============================================
  // PRIORITY 4: Developing (60-75% range)
  // =============================================
  if (scorePct !== null && scorePct >= 60 && scorePct < 75) {
    if (hintPct !== null) {
      return `Shared issue: ${studentCount} students scored ${scorePct}% (avg ${hintPct}% hints) — reinforce the core skill in a small group.`;
    }
    return `Shared issue: ${studentCount} students scored between 60–75% — reinforce the core skill in a small group.`;
  }

  // =============================================
  // PRIORITY 5: Have some score data
  // =============================================
  if (scorePct !== null) {
    if (hintPct !== null) {
      return `Shared issue: ${studentCount} students averaged ${scorePct}% (${hintPct}% hint usage) — small-group review recommended.`;
    }
    return `Shared issue: ${studentCount} students averaged ${scorePct}% — small-group review recommended.`;
  }

  // =============================================
  // PRIORITY 6: Have hint data only
  // =============================================
  if (hintPct !== null) {
    return `Shared issue: ${studentCount} students averaged ${hintPct}% hint usage — practice solving without hints together.`;
  }

  // =============================================
  // FALLBACK: No concrete data — be honest
  // =============================================
  if (process.env.NODE_ENV === "development") {
    console.warn(`[GroupWhySentence] Fallback used for rec=${rec.id?.slice(0, 8)} — no score or hint data`);
  }
  return `Shared issue: ${studentCount} students require review — open submissions to identify patterns.`;
}

// Alias for backward compatibility
const getGroupExplanation = buildGroupWhySentence;

/**
 * Format timestamp as relative label: "Today", "Yesterday", "3d ago", etc.
 * Returns null if no timestamp available.
 */
function formatRelativeTimestamp(rec: Recommendation): string | null {
  const signals = rec.triggerData?.signals || {};

  // Try multiple timestamp sources in order of preference
  const timestamp =
    (signals.completedAt as string | undefined) ||
    (signals.submittedAt as string | undefined) ||
    (rec.triggerData?.generatedAt as string | undefined) ||
    rec.createdAt;

  if (!timestamp) return null;

  try {
    const date = new Date(timestamp);
    const now = new Date();

    // Reset to start of day for comparison
    const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const nowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const diffDays = Math.floor((nowStart.getTime() - dateStart.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;

    // Fallback to date format for older items
    const sameYear = date.getFullYear() === now.getFullYear();
    const options: Intl.DateTimeFormatOptions = sameYear
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" };
    return date.toLocaleDateString("en-US", options);
  } catch {
    return null;
  }
}

// ============================================
// Recommendation Card Component
// ============================================

interface RecommendationCardProps {
  recommendation: Recommendation;
  studentMap: Map<string, string>;
  onDismiss: (id: string) => void;
}

function RecommendationCard({
  recommendation,
  studentMap,
  onDismiss,
}: RecommendationCardProps) {
  const navigate = useNavigate();
  const config = getCategoryConfig(recommendation);
  const categoryKey = getCategoryKey(recommendation);

  // Extract original recommendation ID (strip __studentId suffix if present)
  const originalRecommendationId = recommendation.id.includes("__")
    ? recommendation.id.split("__")[0]
    : recommendation.id;

  // All cards are now single-student (groups are split in parent)
  const studentId = recommendation.studentIds[0];
  const signals = recommendation.triggerData?.signals || {};

  // Get student name for display
  const studentName = studentMap.get(studentId)
    || (signals.studentName as string)
    || "Student";

  // Get assignment info - show actual name, NOT "Assignment" literal
  // Confirmed property path: signals.assignmentTitle (enriched by backend)
  const assignmentTitle = (signals.assignmentTitle as string)
    || (signals.lessonTitle as string)
    || null;

  // Get subject/grade if available
  const subject = (signals.subject as string) || null;

  // Build context line: "{Title} · {Subject}" (NO date - date shown separately)
  const contextParts: string[] = [];
  if (assignmentTitle) contextParts.push(assignmentTitle);
  if (subject) contextParts.push(subject);
  const contextLine = contextParts.join(" · ");

  // Get relative timestamp for display
  const timestamp = formatRelativeTimestamp(recommendation);

  // Get specific explanation (score is ONLY in this sentence)
  const explanation = getRecommendationExplanation(recommendation);

  // Log warning if title couldn't be resolved
  if (process.env.NODE_ENV === "development" && !assignmentTitle) {
    console.warn("[RecommendationCard] Missing assignmentTitle:", {
      recommendationId: recommendation.id,
      assignmentId: recommendation.assignmentId,
      ruleName: recommendation.triggerData?.ruleName,
    });
  }

  // Handle card click - navigate to student's review
  const handleCardClick = () => {
    const navigationState: RecommendationNavigationState = {
      from: "recommended-actions",
      returnTo: "/educator",
      scrollTo: "recommended-actions",
      recommendationId: originalRecommendationId,
      recommendationType: categoryKey,
      categoryLabel: config.label,
    };

    if (recommendation.assignmentId && studentId) {
      navigate(
        `/educator/assignment/${recommendation.assignmentId}/student/${studentId}`,
        { state: navigationState }
      );
    } else if (studentId) {
      navigate(`/educator/student/${studentId}`, { state: navigationState });
    } else if (recommendation.assignmentId) {
      navigate(`/educator/assignment/${recommendation.assignmentId}`, { state: navigationState });
    }
  };

  // Handle keyboard
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleCardClick();
    }
  };

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={handleCardClick}
      onKeyDown={handleKeyDown}
      aria-label={`${config.label}: ${studentName}. ${explanation} Click to review.`}
      style={{
        background: "white",
        borderLeft: `3px solid ${config.color}`,
        borderRadius: "6px",
        padding: "14px 16px",
        marginBottom: "10px",
        cursor: "pointer",
        transition: "all 0.15s ease",
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        outline: "none",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.08)";
        e.currentTarget.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.04)";
        e.currentTarget.style.transform = "translateY(0)";
      }}
      onFocus={(e) => {
        e.currentTarget.style.boxShadow = "0 0 0 2px var(--accent-primary, #3d5a80)";
      }}
      onBlur={(e) => {
        e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.04)";
      }}
    >
      {/* Row 1: Category badge + Timestamp (right-aligned) */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
        <span
          style={{
            fontSize: "0.6rem",
            fontWeight: 600,
            color: config.color,
            background: config.bgColor,
            padding: "2px 8px",
            borderRadius: "3px",
            letterSpacing: "0.05em",
            textTransform: "uppercase",
          }}
        >
          {config.label}
        </span>
        {timestamp && (
          <span
            style={{
              fontSize: "0.7rem",
              color: "var(--text-muted)",
              fontWeight: 400,
            }}
          >
            {timestamp}
          </span>
        )}
      </div>

      {/* Row 2: Student Name (Title) */}
      <h3
        style={{
          margin: "0 0 6px 0",
          color: "#1e293b",
          fontSize: "0.95rem",
          fontWeight: 600,
          lineHeight: 1.3,
        }}
      >
        {studentName}
      </h3>

      {/* Row 3: Context line: "{Title} · {Subject} · {Date}" */}
      {contextLine ? (
        <div
          style={{
            fontSize: "0.8rem",
            color: "#64748b",
            marginBottom: "8px",
          }}
        >
          {contextLine}
        </div>
      ) : (
        <div
          style={{
            fontSize: "0.8rem",
            color: "var(--text-muted)",
            marginBottom: "8px",
            fontStyle: "italic",
          }}
        >
          Unknown Assignment
        </div>
      )}

      {/* Row 4: Why sentence (score appears ONLY here) */}
      <p
        style={{
          margin: 0,
          color: "#64748b",
          fontSize: "0.8rem",
          lineHeight: 1.4,
        }}
      >
        {explanation}
      </p>
    </article>
  );
}

// ============================================
// Group Recommendation Card Component
// ============================================

interface GroupRecommendationCardProps {
  recommendation: Recommendation;
  studentMap: Map<string, string>;
  onDismiss: (id: string) => void;
}

/**
 * Group card for recommendations where multiple students share the same reason.
 * Shows "X students" as title with a list of names below.
 */
function GroupRecommendationCard({
  recommendation,
  studentMap,
  onDismiss,
}: GroupRecommendationCardProps) {
  const navigate = useNavigate();
  const config = getCategoryConfig(recommendation);
  const categoryKey = getCategoryKey(recommendation);
  const signals = recommendation.triggerData?.signals || {};

  // Get student names
  const studentNames = recommendation.studentIds
    .map((id) => studentMap.get(id) || "Student")
    .filter(Boolean);
  const studentCount = studentNames.length;

  // Build names display: up to 4 names, then "and N more"
  const maxNamesToShow = 4;
  const displayedNames = studentNames.slice(0, maxNamesToShow);
  const remainingCount = studentCount - maxNamesToShow;
  const namesDisplay = remainingCount > 0
    ? `${displayedNames.join(", ")} and ${remainingCount} more`
    : displayedNames.join(", ");

  // Get assignment info - confirmed property path: signals.assignmentTitle
  const assignmentTitle = (signals.assignmentTitle as string)
    || (signals.lessonTitle as string)
    || null;

  // Get subject if available
  const subject = (signals.subject as string) || (signals.className as string) || null;

  // Build context line: "{Title} · {Subject}" (NO date - date shown separately)
  const contextParts: string[] = [];
  if (assignmentTitle) contextParts.push(assignmentTitle);
  if (subject) contextParts.push(subject);
  const contextLine = contextParts.join(" · ");

  // Get relative timestamp for display
  const timestamp = formatRelativeTimestamp(recommendation);

  // Get group-specific explanation (starts with "Shared issue:")
  const explanation = getGroupExplanation(recommendation);

  // Build group title
  const categoryVerb = categoryKey === "check-in" ? "need follow-up"
    : categoryKey === "developing" ? "are developing"
    : categoryKey === "extend-learning" ? "are ready for extension"
    : "need attention";
  const groupTitle = `${studentCount} students ${categoryVerb}`;

  // Log warning if title couldn't be resolved
  if (process.env.NODE_ENV === "development" && !assignmentTitle) {
    console.warn("[GroupRecommendationCard] Missing assignmentTitle:", {
      recommendationId: recommendation.id,
      assignmentId: recommendation.assignmentId,
      ruleName: recommendation.triggerData?.ruleName,
    });
  }

  // Handle card click - navigate to assignment review (where shared issues are shown)
  const handleCardClick = () => {
    const navigationState: RecommendationNavigationState = {
      from: "recommended-actions",
      returnTo: "/educator",
      scrollTo: "recommended-actions",
      recommendationId: recommendation.id,
      recommendationType: categoryKey,
      categoryLabel: config.label,
      isGroupRecommendation: true,
      groupStudentIds: recommendation.studentIds,
      groupStudentNames: studentNames,
      reasonKey: recommendation.reasonKey,
    };

    if (recommendation.assignmentId) {
      navigate(`/educator/assignment/${recommendation.assignmentId}`, { state: navigationState });
    }
  };

  // Handle keyboard
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleCardClick();
    }
  };

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={handleCardClick}
      onKeyDown={handleKeyDown}
      aria-label={`${config.label}: ${groupTitle}. ${explanation} Click to review.`}
      style={{
        background: "white",
        borderLeft: `3px solid ${config.color}`,
        borderRadius: "6px",
        padding: "14px 16px",
        marginBottom: "10px",
        cursor: "pointer",
        transition: "all 0.15s ease",
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        outline: "none",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.08)";
        e.currentTarget.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.04)";
        e.currentTarget.style.transform = "translateY(0)";
      }}
      onFocus={(e) => {
        e.currentTarget.style.boxShadow = "0 0 0 2px var(--accent-primary, #3d5a80)";
      }}
      onBlur={(e) => {
        e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.04)";
      }}
    >
      {/* Row 1: Category badge + Timestamp (right-aligned) */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
        <span
          style={{
            fontSize: "0.6rem",
            fontWeight: 600,
            color: config.color,
            background: config.bgColor,
            padding: "2px 8px",
            borderRadius: "3px",
            letterSpacing: "0.05em",
            textTransform: "uppercase",
          }}
        >
          {config.label}
        </span>
        {timestamp && (
          <span
            style={{
              fontSize: "0.7rem",
              color: "var(--text-muted)",
              fontWeight: 400,
            }}
          >
            {timestamp}
          </span>
        )}
      </div>

      {/* Row 2: Group Title (X students...) */}
      <h3
        style={{
          margin: "0 0 4px 0",
          color: "#1e293b",
          fontSize: "0.95rem",
          fontWeight: 600,
          lineHeight: 1.3,
        }}
      >
        {groupTitle}
      </h3>

      {/* Row 3: Student names list */}
      <div
        style={{
          fontSize: "0.8rem",
          color: "#475569",
          marginBottom: "6px",
        }}
      >
        {namesDisplay}
      </div>

      {/* Row 4: Assignment name + subject (NO date - shown in header) */}
      <div
        style={{
          fontSize: "0.8rem",
          color: "#64748b",
          marginBottom: "8px",
        }}
      >
        {contextLine || <span style={{ fontStyle: "italic", color: "var(--text-muted)" }}>Unknown Assignment</span>}
      </div>

      {/* Row 5: Why sentence with "Shared issue:" prefix */}
      <p
        style={{
          margin: 0,
          color: "#64748b",
          fontSize: "0.8rem",
          lineHeight: 1.4,
        }}
      >
        {explanation}
      </p>
    </article>
  );
}

// ============================================
// DerivedInsight Card Component
// ============================================

interface DerivedInsightCardProps {
  insight: DerivedInsight;
  studentName: string;
  assignmentTitle?: string;
  className?: string;
  onDismiss?: (id: string) => void;
}

function DerivedInsightCard({
  insight,
  studentName,
  assignmentTitle,
  className,
  onDismiss,
}: DerivedInsightCardProps) {
  const navigate = useNavigate();
  const config = getInsightDisplayConfig(insight.type);

  // Build title based on insight type - concrete, action-oriented
  const getDisplayTitle = (): string => {
    switch (insight.type) {
      case "NEEDS_SUPPORT":
      case "MOVE_ON_EVENT":
      case "MISCONCEPTION_FLAG":
        return studentName; // Just the name - the "Why" provides detail
      case "CHECK_IN":
        return studentName;
      case "EXTEND_LEARNING":
      case "CHALLENGE_OPPORTUNITY":
        return studentName;
      case "CELEBRATE_PROGRESS":
        return studentName;
      default:
        return studentName;
    }
  };

  const displayTitle = getDisplayTitle();

  // Handle card click
  const handleCardClick = () => {
    const navigationState: RecommendationNavigationState = {
      from: "recommended-actions",
      returnTo: "/educator",
      scrollTo: "recommended-actions",
      recommendationId: insight.id,
      recommendationType: insight.type,
      categoryLabel: config.label,
      insightTitle: insight.title,
      insightWhy: insight.why,
      highlightQuestionId: insight.questionId,
    };

    navigate(insight.navigationTargets.route, { state: navigationState });
  };

  // Handle keyboard
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleCardClick();
    }
  };

  // Build scope context
  const scopeParts: string[] = [];
  if (assignmentTitle) scopeParts.push(`Assignment: ${assignmentTitle}`);
  if (className) scopeParts.push(className);

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={handleCardClick}
      onKeyDown={handleKeyDown}
      aria-label={`${config.label}: ${displayTitle}. Click to review.`}
      style={{
        background: "white",
        borderLeft: `3px solid ${config.color}`,
        borderRadius: "6px",
        padding: "16px 18px",
        marginBottom: "12px",
        cursor: "pointer",
        transition: "all 0.15s ease",
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        outline: "none",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.08)";
        e.currentTarget.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.04)";
        e.currentTarget.style.transform = "translateY(0)";
      }}
      onFocus={(e) => {
        e.currentTarget.style.boxShadow = "0 0 0 2px var(--accent-primary, #3d5a80)";
      }}
      onBlur={(e) => {
        e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.04)";
      }}
    >
      {/* Category badge */}
      <div style={{ marginBottom: "8px" }}>
        <span
          style={{
            fontSize: "0.65rem",
            fontWeight: 600,
            color: config.color,
            background: config.bgColor,
            padding: "3px 10px",
            borderRadius: "3px",
            letterSpacing: "0.05em",
          }}
        >
          {config.label}
        </span>
      </div>

      {/* Title */}
      <h3
        style={{
          margin: "0 0 10px 0",
          color: "#2d3748",
          fontSize: "1rem",
          fontWeight: 600,
          lineHeight: 1.4,
        }}
      >
        {displayTitle}
      </h3>

      {/* Why text (insight reason) */}
      <p
        style={{
          margin: "0 0 10px 0",
          color: "#64748b",
          fontSize: "0.85rem",
          lineHeight: 1.5,
        }}
      >
        {insight.why}
      </p>

      {/* Scope context */}
      {scopeParts.length > 0 && (
        <div
          style={{
            fontSize: "0.8rem",
            color: "var(--text-muted)",
          }}
        >
          {scopeParts.join(" · ")}
        </div>
      )}
    </article>
  );
}

// ============================================
// Main Panel Component
// ============================================

interface StudentInfo {
  id: string;
  name: string;
}

interface AssignmentInfo {
  id: string;
  title: string;
}

interface ClassInfo {
  id: string;
  name: string;
}

interface RecommendationPanelProps {
  recommendations: Recommendation[];
  derivedInsights?: DerivedInsight[];
  students?: StudentInfo[];
  assignments?: AssignmentInfo[];
  classes?: ClassInfo[];
  onDismiss: (id: string) => void;
  onDismissInsight?: (id: string) => void;
  onFeedback?: (id: string, feedback: FeedbackType) => void;
  onRefresh?: () => void;
}

export default function RecommendationPanel({
  recommendations,
  derivedInsights = [],
  students = [],
  assignments = [],
  classes = [],
  onDismiss,
  onDismissInsight,
}: RecommendationPanelProps) {
  // Build lookup maps
  const studentMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const student of students) {
      map.set(student.id, student.name);
    }
    return map;
  }, [students]);

  const assignmentMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const assignment of assignments) {
      map.set(assignment.id, assignment.title);
    }
    return map;
  }, [assignments]);

  const classMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const cls of classes) {
      map.set(cls.id, cls.name);
    }
    return map;
  }, [classes]);

  // Filter to only active recommendations that require attention
  // Never show "0 students" recommendations
  const activeRecs = recommendations.filter(
    (r) => r.status === "active" && r.studentIds.length > 0
  );

  // DASHBOARD POLICY: Show ONLY individual student cards.
  // Group recommendations belong on the Assignment page "Shared Issues" section, not here.
  // The server already filters out group recs, but we add client-side filtering as defense-in-depth.
  const individualCards = useMemo(() => {
    return activeRecs.filter((rec) => {
      // Only show recommendations with exactly 1 student
      if (rec.studentIds.length !== 1) {
        if (process.env.NODE_ENV === "development") {
          console.warn(
            `[RecommendationPanel] Filtering out group recommendation (should not reach client):`,
            { id: rec.id, studentCount: rec.studentIds.length, ruleName: rec.triggerData?.ruleName }
          );
        }
        return false;
      }
      return true;
    });
  }, [activeRecs]);

  // Show panel if we have individual recommendations or derived insights
  const hasContent = individualCards.length > 0 || derivedInsights.length > 0;

  // If nothing actionable, render nothing
  // Silence is better than noise
  if (!hasContent) {
    return null;
  }

  return (
    <section
      id="recommended-actions"
      aria-labelledby="recommended-actions-heading"
      style={{
        marginBottom: "24px",
      }}
    >
      {/* Header - uses white text for purple background */}
      <div style={{ marginBottom: "16px" }}>
        <h2
          id="recommended-actions-heading"
          style={{
            margin: 0,
            color: "var(--text-primary)",
            fontSize: "1.125rem",
            fontWeight: 600,
          }}
        >
          Recommended Actions
        </h2>
        <p
          style={{
            margin: "4px 0 0 0",
            color: "var(--text-secondary)",
            fontSize: "0.85rem",
          }}
        >
          Recent work that needs a quick look
        </p>
      </div>

      {/* Derived Insights List (show first - from Coach Analytics) */}
      {derivedInsights.map((insight) => (
        <DerivedInsightCard
          key={insight.id}
          insight={insight}
          studentName={studentMap.get(insight.studentId) || "Student"}
          assignmentTitle={assignmentMap.get(insight.assignmentId)}
          className={classMap.get(insight.classId)}
          onDismiss={onDismissInsight}
        />
      ))}

      {/* Individual Recommendations Only (groups belong on Assignment page) */}
      {individualCards.map((rec) => (
        <RecommendationCard
          key={rec.id}
          recommendation={rec}
          studentMap={studentMap}
          onDismiss={onDismiss}
        />
      ))}
    </section>
  );
}
