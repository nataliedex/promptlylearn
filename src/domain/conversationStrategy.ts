/**
 * Conversation-level strategy escalation controller.
 *
 * Sits above individual remediation move selectors (deterministicRemediation,
 * explanationRemediation) and detects when the student is stalled. When stalled,
 * it returns a higher-level strategy that the caller uses to upgrade the local
 * move — e.g. from a probe to a hint, or from a hint to a demonstration.
 *
 * Pure functions — no LLM calls, no side effects, no lesson-specific hacks.
 */

// ============================================================================
// Types
// ============================================================================

/** The six-rung strategy ladder, from least to most supportive. */
export type Strategy =
  | "probe"
  | "probe_simpler"
  | "hint"
  | "demonstrate_step"
  | "guided_completion"
  | "wrap_support";

/** The full ordered ladder for numeric comparison. */
const LADDER: Strategy[] = [
  "probe",
  "probe_simpler",
  "hint",
  "demonstrate_step",
  "guided_completion",
  "wrap_support",
];

/** The result of a strategy decision. */
export interface ConversationStrategyDecision {
  /** The recommended strategy level. */
  strategy: Strategy;
  /** Human-readable explanation for why this strategy was chosen. */
  reason: string;
  /** True if the strategy was raised above what the local move would produce. */
  escalated: boolean;
}

/** Input signals for the strategy controller. */
export interface StrategyInput {
  /** "math" or "explanation" */
  mode: "math" | "explanation";
  /** Current student state classification. */
  currentState: string;
  /** Ordered list of prior student state classifications (oldest first). */
  priorStudentStates: string[];
  /** Ordered list of prior coach move types (oldest first). */
  priorCoachMoves: string[];
  /** Number of satisfied criteria/steps BEFORE this turn. */
  satisfiedProgressBefore: number;
  /** Number of satisfied criteria/steps AFTER this turn. */
  satisfiedProgressAfter: number;
  /** Consecutive turns with zero new progress. */
  noProgressStreak: number;
  /** Consecutive uncertain student turns. */
  uncertainStreak: number;
  /** How many times the same target (step/criterion) has been probed. */
  repeatedTargetCount: number;
  /** Seconds remaining in the session (null = unlimited). */
  timeRemainingSec: number | null;
  /** Current attempt number (1-based). */
  attemptCount: number;
  /** Maximum allowed attempts. */
  maxAttempts: number;
  /** The move type that the local remediation selected. */
  latestMoveType: string;
  /** The latest wrap decision from the pipeline (null = no wrap). */
  latestWrapDecision: string | null;
}

// ============================================================================
// Ladder helpers
// ============================================================================

function ladderIndex(s: Strategy): number {
  return LADDER.indexOf(s);
}

/** Return whichever strategy is higher on the ladder (more supportive). */
function maxStrategy(a: Strategy, b: Strategy): Strategy {
  return ladderIndex(a) >= ladderIndex(b) ? a : b;
}

/** Bump a strategy one rung up the ladder (capped at wrap_support). */
export function escalateOne(s: Strategy): Strategy {
  const idx = ladderIndex(s);
  return idx < LADDER.length - 1 ? LADDER[idx + 1] : s;
}

// ============================================================================
// Frustration / disengagement detection
// ============================================================================

const FRUSTRATED_STATES = new Set([
  "frustrated",
  "av_delivery_complaint",
]);

function isFrustrated(state: string): boolean {
  return FRUSTRATED_STATES.has(state);
}

function countFrustrationEvents(priorStates: string[]): number {
  return priorStates.filter(s => FRUSTRATED_STATES.has(s)).length;
}

// ============================================================================
// Progress detection
// ============================================================================

/**
 * Detect whether the student made progress this turn.
 *
 * Progress = any of:
 *   - new step/criterion satisfied
 *   - student advanced from uncertain/no_evidence to partial/claim_only/complete
 *   - factual error corrected (currentState not "factual_error" when prior was)
 */
export function detectProgress(input: StrategyInput): boolean {
  if (input.satisfiedProgressAfter > input.satisfiedProgressBefore) return true;

  const priorState = input.priorStudentStates.length > 0
    ? input.priorStudentStates[input.priorStudentStates.length - 1]
    : null;

  if (!priorState) return false;

  // Advancement from stalled → productive
  const stalledStates = new Set(["uncertain", "no_evidence", "hint_request"]);
  const productiveStates = new Set([
    "partial", "partial_evidence", "claim_only", "complete",
    "correct_incomplete", "alternate_setup",
  ]);
  if (stalledStates.has(priorState) && productiveStates.has(input.currentState)) {
    return true;
  }

  // Error correction
  if (priorState === "factual_error" && input.currentState !== "factual_error") {
    return true;
  }

  return false;
}

// ============================================================================
// Local move → implied strategy mapping
// ============================================================================

const MATH_MOVE_TO_STRATEGY: Record<string, Strategy> = {
  STEP_PROBE_DIRECT: "probe",
  STEP_ACKNOWLEDGE_AND_PROBE: "probe",
  STEP_COMBINE_PROMPT: "probe",
  STEP_PROBE_SIMPLER: "probe_simpler",
  STEP_HINT: "hint",
  STEP_MISCONCEPTION_REDIRECT: "hint",
  STEP_COMPUTATION_CORRECTION: "hint",
  STEP_CONCEPT_EXPLANATION: "hint",
  STEP_DEMONSTRATE_STEP: "demonstrate_step",
  STEP_MODEL_INSTRUCTION: "demonstrate_step",
  WRAP_SUCCESS: "probe",           // not really escalation
  WRAP_NEEDS_SUPPORT: "wrap_support",
};

const EXPLANATION_MOVE_TO_STRATEGY: Record<string, Strategy> = {
  EVIDENCE_PROBE: "probe",
  SPECIFICITY_PROBE: "probe",
  ENCOURAGEMENT_PROBE: "probe_simpler",
  CLARIFICATION: "probe",
  FACTUAL_CORRECTION: "hint",
  HINT: "hint",
  MODEL_AND_ASK: "demonstrate_step",
  WRAP_MASTERY: "probe",
  WRAP_SUPPORT: "wrap_support",
};

/**
 * Infer the strategy level implied by a local move type.
 */
export function inferStrategyFromMove(
  moveType: string,
  mode: "math" | "explanation",
): Strategy {
  const map = mode === "math" ? MATH_MOVE_TO_STRATEGY : EXPLANATION_MOVE_TO_STRATEGY;
  return map[moveType] ?? "probe";
}

// ============================================================================
// Strategy → move type mapping (for upgrading)
// ============================================================================

/** Map a strategy back to the most appropriate math move type. */
export function mathMoveForStrategy(strategy: Strategy): string {
  switch (strategy) {
    case "probe": return "STEP_PROBE_DIRECT";
    case "probe_simpler": return "STEP_PROBE_SIMPLER";
    case "hint": return "STEP_HINT";
    case "demonstrate_step": return "STEP_DEMONSTRATE_STEP";
    case "guided_completion": return "STEP_MODEL_INSTRUCTION";
    case "wrap_support": return "WRAP_NEEDS_SUPPORT";
  }
}

/** Map a strategy back to the most appropriate explanation move type. */
export function explanationMoveForStrategy(strategy: Strategy): string {
  switch (strategy) {
    case "probe": return "EVIDENCE_PROBE";
    case "probe_simpler": return "ENCOURAGEMENT_PROBE";
    case "hint": return "HINT";
    case "demonstrate_step": return "MODEL_AND_ASK";
    case "guided_completion": return "MODEL_AND_ASK";
    case "wrap_support": return "WRAP_SUPPORT";
  }
}

// ============================================================================
// Main entry point
// ============================================================================

/**
 * Determine the conversation-level strategy for the current turn.
 *
 * Rules are evaluated in priority order — first match wins.
 * The caller compares the returned strategy against the local move's
 * implied strategy and upgrades if the conversation strategy is higher.
 */
export function determineConversationStrategy(
  input: StrategyInput,
): ConversationStrategyDecision {
  const localStrategy = inferStrategyFromMove(input.latestMoveType, input.mode);
  const madeProgress = detectProgress(input);

  // ── A. Time pressure ──────────────────────────────────────────────────
  if (input.timeRemainingSec !== null && input.timeRemainingSec < 15) {
    return {
      strategy: "wrap_support",
      reason: "time_remaining_below_15s",
      escalated: localStrategy !== "wrap_support",
    };
  }

  // ── B. Frustration / disengagement ────────────────────────────────────
  if (isFrustrated(input.currentState)) {
    const priorFrustration = countFrustrationEvents(input.priorStudentStates);
    if (priorFrustration >= 1 || (input.timeRemainingSec !== null && input.timeRemainingSec < 30)) {
      return {
        strategy: "wrap_support",
        reason: "repeated_frustration_or_low_time",
        escalated: localStrategy !== "wrap_support",
      };
    }
    const target = maxStrategy("hint", localStrategy);
    return {
      strategy: target,
      reason: "first_frustration_escalate_to_hint",
      escalated: ladderIndex(target) > ladderIndex(localStrategy),
    };
  }

  // ── E. No progress streak ≥ 4 → guided completion (checked before D) ──
  if (input.noProgressStreak >= 4) {
    const target = maxStrategy("guided_completion", localStrategy);
    return {
      strategy: target,
      reason: "no_progress_streak_4_plus",
      escalated: ladderIndex(target) > ladderIndex(localStrategy),
    };
  }

  // ── C/D. Uncertainty or no-progress streak → demonstrate or hint ──────
  if (input.uncertainStreak >= 3 || input.noProgressStreak >= 3) {
    const target = maxStrategy("demonstrate_step", localStrategy);
    return {
      strategy: target,
      reason: input.uncertainStreak >= 3
        ? "uncertainty_streak_3_plus"
        : "no_progress_streak_3_plus",
      escalated: ladderIndex(target) > ladderIndex(localStrategy),
    };
  }
  if (input.uncertainStreak >= 2) {
    const target = maxStrategy("hint", localStrategy);
    return {
      strategy: target,
      reason: "uncertainty_streak_2",
      escalated: ladderIndex(target) > ladderIndex(localStrategy),
    };
  }

  // ── F. Same target repeated ≥ 3 → escalate one above local ───────────
  if (input.repeatedTargetCount >= 3) {
    const target = escalateOne(localStrategy);
    return {
      strategy: target,
      reason: "repeated_target_3_plus",
      escalated: ladderIndex(target) > ladderIndex(localStrategy),
    };
  }

  // ── G. Progress detected → reset toward probe/probe_simpler ───────────
  if (madeProgress) {
    const reset: Strategy = input.currentState === "uncertain" ? "probe_simpler" : "probe";
    return {
      strategy: reset,
      reason: "progress_detected_reset",
      escalated: false,
    };
  }

  // ── Default: no escalation, use the local move's implied strategy ─────
  return {
    strategy: localStrategy,
    reason: "no_escalation_needed",
    escalated: false,
  };
}

// ============================================================================
// Integration helper: should we upgrade the local move?
// ============================================================================

/**
 * Compare the strategy decision against the local move and decide
 * whether to upgrade. Returns null if no upgrade is needed.
 */
export function shouldUpgradeMove(
  decision: ConversationStrategyDecision,
  localMoveType: string,
  mode: "math" | "explanation",
): string | null {
  if (!decision.escalated) return null;

  const localLevel = ladderIndex(inferStrategyFromMove(localMoveType, mode));
  const targetLevel = ladderIndex(decision.strategy);

  if (targetLevel <= localLevel) return null;

  return mode === "math"
    ? mathMoveForStrategy(decision.strategy)
    : explanationMoveForStrategy(decision.strategy);
}

// ============================================================================
// Context builders — extract StrategyInput from runtime state
// ============================================================================

/** Signals available from the math pipeline at the point of move selection. */
export interface MathStrategyContext {
  conversationHistory: Array<{ role: string; message: string }>;
  satisfiedStepsBefore: number;
  satisfiedStepsAfter: number;
  currentStudentState: string;
  latestMoveType: string;
  targetStepId: string | null;
  timeRemainingSec: number | null;
  attemptCount: number;
  maxAttempts: number;
}

/** Signals available from the explanation pipeline at the point of move selection. */
export interface ExplanationStrategyContext {
  conversationHistory: Array<{ role: string; message: string }>;
  satisfiedCriteriaBefore: number;
  satisfiedCriteriaAfter: number;
  consecutiveNoProgressTurns: number;
  currentState: string;
  latestMoveType: string;
  targetCriterion: string | null;
  timeRemainingSec: number | null;
  attemptCount: number;
  maxAttempts: number;
}

// ── History parsing helpers ─────────────────────────────────────────────

const UNCERTAIN_PATTERNS = [
  /\bi\s+(?:still\s+|really\s+)?(?:don'?t|do\s*not)\s+know\b/i,
  /\bno\s*idea\b/i,
  /\bi'?m\s+(?:not\s+sure|confused|stuck|lost)\b/i,
  /\bwhat\s+(?:do\s+you\s+mean|does\s+that\s+mean)\b/i,
];

function countUncertainStreak(history: Array<{ role: string; message: string }>): number {
  let count = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role !== "student") continue;
    if (UNCERTAIN_PATTERNS.some(p => p.test(history[i].message))) {
      count++;
    } else {
      break;
    }
  }
  return count;
}

function countRepeatedTarget(
  history: Array<{ role: string; message: string }>,
  currentTarget: string | null,
): number {
  if (!currentTarget) return 0;
  // Count consecutive coach turns mentioning the same target pattern
  let count = 1; // current turn
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role !== "coach") continue;
    // Simple heuristic: if consecutive coach messages target the same step
    // we only have the current target ID; count how many recent coach turns exist
    // without student progress (the noProgressStreak is a better signal here)
    count++;
    if (count >= 4) break;
  }
  return Math.min(count, 4);
}

function extractPriorStates(history: Array<{ role: string; message: string }>): string[] {
  const states: string[] = [];
  for (const entry of history) {
    if (entry.role !== "student") continue;
    if (UNCERTAIN_PATTERNS.some(p => p.test(entry.message))) {
      states.push("uncertain");
    } else if (/\bi\s+(?:give\s+up|quit|don'?t\s+(?:care|want))\b/i.test(entry.message)) {
      states.push("frustrated");
    } else {
      states.push("partial");
    }
  }
  return states;
}

function extractPriorMoves(history: Array<{ role: string; message: string }>): string[] {
  // We don't have move type info in plain history, return empty
  return [];
}

/**
 * Build StrategyInput from math pipeline context.
 */
export function buildMathStrategyInput(ctx: MathStrategyContext): StrategyInput {
  const priorStates = extractPriorStates(ctx.conversationHistory);
  return {
    mode: "math",
    currentState: ctx.currentStudentState,
    priorStudentStates: priorStates,
    priorCoachMoves: extractPriorMoves(ctx.conversationHistory),
    satisfiedProgressBefore: ctx.satisfiedStepsBefore,
    satisfiedProgressAfter: ctx.satisfiedStepsAfter,
    noProgressStreak: ctx.satisfiedStepsAfter === ctx.satisfiedStepsBefore
      ? countUncertainStreak(ctx.conversationHistory)
      : 0,
    uncertainStreak: countUncertainStreak(ctx.conversationHistory),
    repeatedTargetCount: countRepeatedTarget(ctx.conversationHistory, ctx.targetStepId),
    timeRemainingSec: ctx.timeRemainingSec,
    attemptCount: ctx.attemptCount,
    maxAttempts: ctx.maxAttempts,
    latestMoveType: ctx.latestMoveType,
    latestWrapDecision: null,
  };
}

/**
 * Build StrategyInput from explanation pipeline context.
 */
export function buildExplanationStrategyInput(ctx: ExplanationStrategyContext): StrategyInput {
  const priorStates = extractPriorStates(ctx.conversationHistory);
  return {
    mode: "explanation",
    currentState: ctx.currentState,
    priorStudentStates: priorStates,
    priorCoachMoves: extractPriorMoves(ctx.conversationHistory),
    satisfiedProgressBefore: ctx.satisfiedCriteriaBefore,
    satisfiedProgressAfter: ctx.satisfiedCriteriaAfter,
    noProgressStreak: ctx.consecutiveNoProgressTurns,
    uncertainStreak: countUncertainStreak(ctx.conversationHistory),
    repeatedTargetCount: countRepeatedTarget(ctx.conversationHistory, ctx.targetCriterion),
    timeRemainingSec: ctx.timeRemainingSec,
    attemptCount: ctx.attemptCount,
    maxAttempts: ctx.maxAttempts,
    latestMoveType: ctx.latestMoveType,
    latestWrapDecision: null,
  };
}
