/**
 * Coach Analytics Store
 *
 * Persistence layer for coach analytics data.
 * Stores analytics alongside student assignment attempts.
 */

import * as fs from "fs";
import * as path from "path";
import {
  AssignmentAttemptAnalytics,
  QuestionAttemptAnalytics,
  ConversationTurnAnalytics,
  CoachActionTag,
  ConfidenceLevel,
  MisconceptionType,
  StagnationReason,
  MoveOnTrigger,
  SupportLevel,
  QuestionOutcomeTag,
  OverallSupportLevel,
  OverallOutcome,
  SystemRecommendationCandidate,
  TeacherFacingInsight,
  COACH_ANALYTICS_SCHEMA_VERSION,
} from "../domain/coachAnalytics";

// ============================================
// Storage Configuration
// ============================================

const DATA_DIR = path.join(process.cwd(), "data", "analytics");

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function getAnalyticsPath(assignmentId: string, studentId: string, attemptId: string): string {
  return path.join(DATA_DIR, `${assignmentId}_${studentId}_${attemptId}.json`);
}

// ============================================
// CRUD Operations
// ============================================

/**
 * Save assignment attempt analytics to disk.
 */
export function saveAnalytics(analytics: AssignmentAttemptAnalytics): void {
  ensureDataDir();
  const filePath = getAnalyticsPath(analytics.assignmentId, analytics.studentId, analytics.attemptId);
  fs.writeFileSync(filePath, JSON.stringify(analytics, null, 2));
}

/**
 * Load analytics for a specific assignment attempt.
 */
export function loadAnalytics(
  assignmentId: string,
  studentId: string,
  attemptId: string
): AssignmentAttemptAnalytics | null {
  const filePath = getAnalyticsPath(assignmentId, studentId, attemptId);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const content = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(content);
}

/**
 * Get all analytics for a student's assignment (all attempts).
 */
export function getStudentAssignmentAnalytics(
  assignmentId: string,
  studentId: string
): AssignmentAttemptAnalytics[] {
  ensureDataDir();
  const prefix = `${assignmentId}_${studentId}_`;
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.startsWith(prefix) && f.endsWith(".json"));
  return files.map((f) => {
    const content = fs.readFileSync(path.join(DATA_DIR, f), "utf-8");
    return JSON.parse(content);
  });
}

/**
 * Get all analytics for an assignment (all students, all attempts).
 */
export function getAssignmentAnalytics(assignmentId: string): AssignmentAttemptAnalytics[] {
  ensureDataDir();
  const prefix = `${assignmentId}_`;
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.startsWith(prefix) && f.endsWith(".json"));
  return files.map((f) => {
    const content = fs.readFileSync(path.join(DATA_DIR, f), "utf-8");
    return JSON.parse(content);
  });
}

// ============================================
// Filler Word Detection (DO NOT PENALIZE)
// ============================================

const FILLER_WORDS = [
  "um",
  "uh",
  "er",
  "ah",
  "like",
  "you know",
  "i mean",
  "well",
  "so",
  "basically",
  "actually",
  "literally",
  "right",
  "okay",
];

/**
 * Count filler words in text.
 * NOTE: This is informational only - DO NOT use as a negative score.
 */
export function countFillerWords(text: string): number {
  const lower = text.toLowerCase();
  let count = 0;
  for (const filler of FILLER_WORDS) {
    const regex = new RegExp(`\\b${filler}\\b`, "gi");
    const matches = lower.match(regex);
    if (matches) {
      count += matches.length;
    }
  }
  return count;
}

/**
 * Remove filler words from text for analysis purposes.
 * Original transcript should always be preserved separately.
 */
export function cleanFillerWords(text: string): string {
  let cleaned = text;
  for (const filler of FILLER_WORDS) {
    const regex = new RegExp(`\\b${filler}\\b`, "gi");
    cleaned = cleaned.replace(regex, "");
  }
  // Clean up extra spaces
  return cleaned.replace(/\s+/g, " ").trim();
}

// ============================================
// Confidence Signal Detection
// ============================================

const UNCERTAINTY_PHRASES = [
  "i'm not sure",
  "i don't know",
  "i think",
  "maybe",
  "i guess",
  "probably",
  "might be",
  "could be",
  "not certain",
  "i believe",
  "possibly",
];

const CERTAINTY_PHRASES = [
  "i know",
  "definitely",
  "the answer is",
  "it is",
  "for sure",
  "absolutely",
  "certainly",
  "obviously",
  "clearly",
];

/**
 * Detect confidence signals from text content.
 * Based on explicit phrases, NOT filler words.
 */
export function detectConfidenceSignals(text: string): {
  selfReportedConfidence: ConfidenceLevel;
  uncertaintyPhrasesDetected: boolean;
  certaintyPhrasesDetected: boolean;
} {
  const lower = text.toLowerCase();

  const uncertaintyDetected = UNCERTAINTY_PHRASES.some((phrase) => lower.includes(phrase));
  const certaintyDetected = CERTAINTY_PHRASES.some((phrase) => lower.includes(phrase));

  let selfReportedConfidence: ConfidenceLevel = "unknown";
  if (certaintyDetected && !uncertaintyDetected) {
    selfReportedConfidence = "high";
  } else if (uncertaintyDetected && !certaintyDetected) {
    selfReportedConfidence = "low";
  } else if (uncertaintyDetected && certaintyDetected) {
    selfReportedConfidence = "medium";
  }

  return {
    selfReportedConfidence,
    uncertaintyPhrasesDetected: uncertaintyDetected,
    certaintyPhrasesDetected: certaintyDetected,
  };
}

// ============================================
// Coach Action Tag Inference
// ============================================

/**
 * Infer coach action tag from response content and coaching path.
 */
export function inferCoachActionTag(
  coachResponse: string,
  shouldContinue: boolean,
  isCorrect: boolean,
  deferredByCoach?: boolean,
  followUpQuestion?: string
): CoachActionTag {
  const lower = coachResponse.toLowerCase();

  // Check for move-on signals
  if (deferredByCoach) {
    return "move_on_stagnation";
  }

  if (lower.includes("move on") || lower.includes("next question") || lower.includes("let's continue")) {
    return "move_on_stagnation";
  }

  // Check for affirmation without continuation
  if (!shouldContinue && isCorrect) {
    return "affirm_move_on";
  }

  // Check for hint patterns
  if (lower.includes("hint") || lower.includes("think about") || lower.includes("consider")) {
    return "hint";
  }

  // Check for reframe patterns
  if (lower.includes("let me put it") || lower.includes("another way") || lower.includes("simpler")) {
    return "reframe_question";
  }

  // Check for misconception correction
  if (lower.includes("not quite") || lower.includes("check that") || lower.includes("are you sure")) {
    return "correct_misconception";
  }

  // Check for example requests
  if (lower.includes("example") || lower.includes("can you show")) {
    return "ask_for_example";
  }

  // Check for explanation requests
  if (lower.includes("explain") || lower.includes("why") || lower.includes("how did you")) {
    return "ask_for_explanation";
  }

  // Check for encouragement
  if (lower.includes("good") || lower.includes("that's right") || lower.includes("correct")) {
    if (shouldContinue) {
      return "probe";
    }
    return "affirm_move_on";
  }

  // Default to probe if there's a follow-up question
  if (followUpQuestion && followUpQuestion.length > 0) {
    return "probe";
  }

  return "check_understanding";
}

// ============================================
// Question Outcome Derivation
// ============================================

/**
 * Derive question outcome tag from analytics.
 */
export function deriveQuestionOutcome(analytics: QuestionAttemptAnalytics): QuestionOutcomeTag {
  if (analytics.moveOnTriggered) {
    return "moved_on";
  }

  if (analytics.correctnessEstimate === "correct") {
    if (analytics.hintCount === 0 && analytics.probeCount <= 1) {
      return "mastery_fast";
    }
    if (analytics.hintCount > 0) {
      return "mastery_after_hint";
    }
    return "mastery_after_probe";
  }

  if (analytics.correctnessEstimate === "partially_correct") {
    return "partial_understanding";
  }

  return "needs_support";
}

/**
 * Derive support level used from analytics.
 */
export function deriveSupportLevel(analytics: QuestionAttemptAnalytics): SupportLevel {
  const totalSupport = analytics.hintCount + analytics.probeCount + analytics.reframeCount;

  if (totalSupport === 0) {
    return "none";
  }
  if (totalSupport === 1 && analytics.hintCount === 0) {
    return "light_probe";
  }
  if (analytics.hintCount === 1 && analytics.reframeCount === 0) {
    return "hinted";
  }
  if (analytics.reframeCount > 0 || totalSupport <= 3) {
    return "guided";
  }
  return "heavy_support";
}

// ============================================
// Assignment-Level Derivations
// ============================================

/**
 * Calculate totals from question analytics.
 */
export function calculateTotals(questionAnalytics: QuestionAttemptAnalytics[]): {
  totalTimeMs: number;
  totalStudentTurns: number;
  totalCoachTurns: number;
  totalHints: number;
  totalProbes: number;
  totalReframes: number;
  misconceptionsCount: number;
  moveOnsCount: number;
} {
  return questionAnalytics.reduce(
    (acc, q) => ({
      totalTimeMs: acc.totalTimeMs + q.timeSpentMs,
      totalStudentTurns: acc.totalStudentTurns + q.studentTurnCount,
      totalCoachTurns: acc.totalCoachTurns + q.coachTurnCount,
      totalHints: acc.totalHints + q.hintCount,
      totalProbes: acc.totalProbes + q.probeCount,
      totalReframes: acc.totalReframes + q.reframeCount,
      misconceptionsCount: acc.misconceptionsCount + (q.misconceptionDetected ? 1 : 0),
      moveOnsCount: acc.moveOnsCount + (q.moveOnTriggered ? 1 : 0),
    }),
    {
      totalTimeMs: 0,
      totalStudentTurns: 0,
      totalCoachTurns: 0,
      totalHints: 0,
      totalProbes: 0,
      totalReframes: 0,
      misconceptionsCount: 0,
      moveOnsCount: 0,
    }
  );
}

/**
 * Derive overall support level from totals and question count.
 */
export function deriveOverallSupportLevel(
  totals: ReturnType<typeof calculateTotals>,
  questionCount: number
): OverallSupportLevel {
  const avgSupport = (totals.totalHints + totals.totalProbes + totals.totalReframes) / Math.max(questionCount, 1);

  if (avgSupport === 0) return "none";
  if (avgSupport < 1) return "light";
  if (avgSupport < 2) return "moderate";
  return "high";
}

/**
 * Derive overall outcome from question analytics.
 */
export function deriveOverallOutcome(questionAnalytics: QuestionAttemptAnalytics[]): OverallOutcome {
  if (questionAnalytics.length === 0) return "developing";

  const outcomes = questionAnalytics.map((q) => q.outcomeTag);
  const masteryCount = outcomes.filter((o) => o.startsWith("mastery")).length;
  const movedOnCount = outcomes.filter((o) => o === "moved_on").length;
  const needsSupportCount = outcomes.filter((o) => o === "needs_support").length;

  const masteryRate = masteryCount / questionAnalytics.length;
  const movedOnRate = movedOnCount / questionAnalytics.length;

  if (masteryRate >= 0.8) return "strong";
  if (movedOnRate >= 0.5 || needsSupportCount >= questionAnalytics.length / 2) return "needs_support";
  if (masteryRate >= 0.5) return "developing";
  return "mixed";
}

// ============================================
// System Recommendation Generation
// ============================================

/**
 * Generate system recommendation candidates from analytics.
 */
export function generateRecommendationCandidates(
  analytics: AssignmentAttemptAnalytics
): SystemRecommendationCandidate[] {
  const candidates: SystemRecommendationCandidate[] = [];
  const { totals, questionAnalytics, overallOutcome } = analytics;

  // High performance with low support
  if (overallOutcome === "strong" && totals.totalHints === 0) {
    candidates.push({
      type: "challenge_opportunity",
      reason: "Demonstrated strong understanding with minimal support.",
      suggestedActions: ["award_badge"],
      confidence: "high",
      sourceSignals: ["low_hint_high_accuracy"],
    });
  }

  // Needs support
  if (overallOutcome === "needs_support") {
    candidates.push({
      type: "needs_support",
      reason: "Multiple questions required significant coaching support.",
      suggestedActions: ["add_todo", "invite_support_session"],
      confidence: "medium",
      sourceSignals: ["high_support_needed"],
    });
  }

  // Stagnation detected
  if (totals.moveOnsCount > 0) {
    candidates.push({
      type: "check_in",
      reason: `Coach moved on from ${totals.moveOnsCount} question(s) due to stagnation.`,
      suggestedActions: ["add_todo"],
      confidence: "high",
      sourceSignals: ["move_on_stagnation"],
    });
  }

  // Misconceptions detected
  if (totals.misconceptionsCount > 0) {
    const misconceptionTypes = questionAnalytics
      .filter((q) => q.misconceptionDetected && q.misconceptionType)
      .map((q) => q.misconceptionType);

    candidates.push({
      type: "check_in",
      reason: `Misconception detected in ${totals.misconceptionsCount} question(s).`,
      suggestedActions: ["add_todo"],
      confidence: "medium",
      sourceSignals: ["misconception_detected", ...misconceptionTypes.filter(Boolean) as string[]],
    });
  }

  // Progress celebration
  if (overallOutcome === "developing" && totals.totalHints > 0) {
    const masteryAfterHint = questionAnalytics.filter((q) => q.outcomeTag === "mastery_after_hint").length;
    if (masteryAfterHint > 0) {
      candidates.push({
        type: "celebrate_progress",
        reason: `Made progress with coaching support on ${masteryAfterHint} question(s).`,
        suggestedActions: [],
        confidence: "medium",
        sourceSignals: ["progress_with_support"],
      });
    }
  }

  return candidates;
}

// ============================================
// Teacher-Facing Insight Derivation
// ============================================

/**
 * Derive teacher-facing insight from assignment analytics.
 * Deterministic and auditable - no LLM calls.
 */
export function deriveTeacherInsight(analytics: AssignmentAttemptAnalytics): TeacherFacingInsight {
  const { overallOutcome, totals, questionAnalytics } = analytics;

  let whyText = "";
  let categoryChip = "";
  const suggestedQuickActions: string[] = [];

  switch (overallOutcome) {
    case "strong":
      whyText = "Demonstrated clear understanding across questions with minimal coaching support.";
      categoryChip = "Strong Performance";
      if (totals.totalHints === 0) {
        suggestedQuickActions.push("Consider enrichment opportunity");
      }
      break;

    case "developing":
      whyText = "Made progress with some coaching support. Understanding is emerging.";
      categoryChip = "Developing";
      suggestedQuickActions.push("Review responses");
      break;

    case "needs_support":
      whyText = "Required significant coaching support. May benefit from additional instruction.";
      categoryChip = "Needs Support";
      suggestedQuickActions.push("Schedule check-in", "Review misconceptions");
      break;

    case "mixed":
      whyText = "Performance varied across questions. Some areas strong, others need attention.";
      categoryChip = "Mixed Results";
      suggestedQuickActions.push("Review specific questions");
      break;
  }

  // Add specific insights
  if (totals.moveOnsCount > 0) {
    whyText += ` Coach moved on from ${totals.moveOnsCount} question(s) due to stagnation.`;
    suggestedQuickActions.push("Review deferred questions");
  }

  if (totals.misconceptionsCount > 0) {
    const types = [...new Set(questionAnalytics.filter((q) => q.misconceptionType).map((q) => q.misconceptionType))];
    if (types.length > 0) {
      whyText += ` Misconception patterns: ${types.join(", ")}.`;
    }
  }

  return {
    whyText: whyText.trim(),
    categoryChip,
    suggestedQuickActions,
  };
}

// ============================================
// Analytics Summary for Dashboard
// ============================================

export interface AnalyticsSummary {
  totalAttempts: number;
  strongCount: number;
  developingCount: number;
  needsSupportCount: number;
  mixedCount: number;
  totalMoveOns: number;
  totalMisconceptions: number;
  avgTimeMs: number;
  avgSupportLevel: string;
}

/**
 * Generate summary statistics for an assignment (all students).
 */
export function getAnalyticsSummary(assignmentId: string): AnalyticsSummary {
  const allAnalytics = getAssignmentAnalytics(assignmentId);

  if (allAnalytics.length === 0) {
    return {
      totalAttempts: 0,
      strongCount: 0,
      developingCount: 0,
      needsSupportCount: 0,
      mixedCount: 0,
      totalMoveOns: 0,
      totalMisconceptions: 0,
      avgTimeMs: 0,
      avgSupportLevel: "none",
    };
  }

  const summary = allAnalytics.reduce(
    (acc, a) => ({
      totalAttempts: acc.totalAttempts + 1,
      strongCount: acc.strongCount + (a.overallOutcome === "strong" ? 1 : 0),
      developingCount: acc.developingCount + (a.overallOutcome === "developing" ? 1 : 0),
      needsSupportCount: acc.needsSupportCount + (a.overallOutcome === "needs_support" ? 1 : 0),
      mixedCount: acc.mixedCount + (a.overallOutcome === "mixed" ? 1 : 0),
      totalMoveOns: acc.totalMoveOns + a.totals.moveOnsCount,
      totalMisconceptions: acc.totalMisconceptions + a.totals.misconceptionsCount,
      totalTimeMs: acc.totalTimeMs + a.totals.totalTimeMs,
      supportLevels: [...acc.supportLevels, a.overallSupportLevel],
    }),
    {
      totalAttempts: 0,
      strongCount: 0,
      developingCount: 0,
      needsSupportCount: 0,
      mixedCount: 0,
      totalMoveOns: 0,
      totalMisconceptions: 0,
      totalTimeMs: 0,
      supportLevels: [] as string[],
    }
  );

  // Calculate average support level
  const supportCounts = { none: 0, light: 0, moderate: 0, high: 0 };
  for (const level of summary.supportLevels) {
    if (level in supportCounts) {
      supportCounts[level as keyof typeof supportCounts]++;
    }
  }
  const avgSupportLevel = Object.entries(supportCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "none";

  return {
    totalAttempts: summary.totalAttempts,
    strongCount: summary.strongCount,
    developingCount: summary.developingCount,
    needsSupportCount: summary.needsSupportCount,
    mixedCount: summary.mixedCount,
    totalMoveOns: summary.totalMoveOns,
    totalMisconceptions: summary.totalMisconceptions,
    avgTimeMs: Math.round(summary.totalTimeMs / summary.totalAttempts),
    avgSupportLevel,
  };
}
