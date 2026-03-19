#!/usr/bin/env npx ts-node
/**
 * Transcript replay & batch audit tool.
 *
 * Two modes:
 *   replay  — verbose per-turn output (default for a single file)
 *   audit   — compact per-fixture result + aggregate summary
 *
 * Usage:
 *   npx ts-node src/domain/transcriptReplay.ts                          # built-in demo (replay)
 *   npx ts-node src/domain/transcriptReplay.ts fixture.json             # single file replay
 *   npx ts-node src/domain/transcriptReplay.ts --audit fixture.json     # single file audit
 *   npx ts-node src/domain/transcriptReplay.ts --audit fixtures/        # batch audit directory
 *
 * Audit checks (flagged as issues):
 *   1. REPEATED_OPENING  — consecutive coach turns share the same first 4 words
 *   2. TARGET_STUCK      — same target probed 3+ times without progress
 *   3. OVERLONG          — response exceeds word limit for its move type
 *   4. PREMATURE_WRAP    — wrap decision when criteria/steps still missing
 *   5. SUMMARY_MISMATCH  — teacher summary status contradicts transcript evidence
 *
 * Severity:
 *   high   — REPEATED_OPENING, PREMATURE_WRAP, SUMMARY_MISMATCH, EXPECTATION_MISMATCH
 *   medium — TARGET_STUCK, OVERLONG
 *
 * Exit code 1 if any fixture has a high-severity issue or EXPECTATION_MISMATCH.
 *
 * Golden fixture expectations (optional metadata):
 *   "expectedVerdict": "PASS" | "WARN" | "FAIL"  — compared against actual verdict
 *   "expectedIssueCodes": ["OVERLONG", ...]       — actual codes must match exactly
 *
 * Fixture format (JSON):
 *   {
 *     "mode": "explanation" | "math",
 *     // explanation fields:
 *     "promptInput": "...",
 *     "requiredEvidence": { minEntities, entityLabel, attributeLabel, ... },
 *     "referenceFacts": { "Entity": ["attr1", "attr2"], ... },
 *     "successCriteria": ["..."],
 *     "hints": ["..."],           // optional
 *     // math fields:
 *     "mathProblem": { skill, a, b, expression, correctAnswer, ... },
 *     "reasoningSteps": [ { id, label, expectedStatements, probe, kind }, ... ],
 *     // shared:
 *     "transcript": [
 *       { "role": "coach", "message": "..." },
 *       { "role": "student", "message": "..." },
 *       ...
 *     ]
 *   }
 *
 * Test-only utility — not imported by production code.
 */

import * as fs from "fs";
import * as path from "path";

import {
  classifyExplanationState,
  accumulateExplanationEvidence,
  getExplanationRemediationMove,
  shouldWrapExplanation,
  buildExplanationTeacherSummary,
  type AccumulatedExplanationEvidence,
} from "./explanationRemediation";
import {
  getDeterministicRemediationMove,
  buildInstructionalRecap,
  applyMathStrategyEscalation,
  type MathEscalationContext,
} from "./deterministicRemediation";
import {
  accumulateReasoningStepEvidence,
} from "./mathAnswerValidator";
import { validate } from "./deterministicValidator";
import {
  inferStrategyFromMove,
  determineConversationStrategy,
  buildExplanationStrategyInput,
  type ConversationStrategyDecision,
  type Strategy,
} from "./conversationStrategy";
import type { RequiredEvidence, ReasoningStep } from "./prompt";
import type { MathProblem } from "./mathProblem";

// ============================================================================
// Types
// ============================================================================

interface TranscriptTurn {
  role: "coach" | "student";
  message: string;
}

/** Optional metadata for golden-fixture regression expectations. */
interface FixtureMetadata {
  id?: string;
  tags?: string[];
  expectedVerdict?: "PASS" | "WARN" | "FAIL";
  expectedIssueCodes?: string[];
  notes?: string;
}

interface ExplanationFixture extends FixtureMetadata {
  mode: "explanation";
  name?: string;
  promptInput: string;
  requiredEvidence: RequiredEvidence;
  referenceFacts: Record<string, string[]>;
  successCriteria: string[];
  hints?: string[];
  transcript: TranscriptTurn[];
}

interface MathFixture extends FixtureMetadata {
  mode: "math";
  name?: string;
  mathProblem: MathProblem;
  reasoningSteps: ReasoningStep[];
  transcript: TranscriptTurn[];
}

type Fixture = ExplanationFixture | MathFixture;

// ============================================================================
// Issue types
// ============================================================================

type IssueSeverity = "high" | "medium";

type IssueCode =
  | "REPEATED_OPENING"
  | "TARGET_STUCK"
  | "OVERLONG"
  | "PREMATURE_WRAP"
  | "SUMMARY_MISMATCH"
  | "EXPECTATION_MISMATCH";

interface AuditIssue {
  code: IssueCode;
  severity: IssueSeverity;
  turn?: number;
  detail: string;
}

const ISSUE_SEVERITY: Record<IssueCode, IssueSeverity> = {
  REPEATED_OPENING: "high",
  PREMATURE_WRAP: "high",
  SUMMARY_MISMATCH: "high",
  EXPECTATION_MISMATCH: "high",
  TARGET_STUCK: "medium",
  OVERLONG: "medium",
};

// ============================================================================
// Word-count limits (mirrors transcriptAudit.test.ts)
// ============================================================================

const WORD_LIMITS: Record<string, number> = {
  // Explanation moves
  EVIDENCE_PROBE: 25,
  SPECIFICITY_PROBE: 25,
  ENCOURAGEMENT_PROBE: 25,
  CLARIFICATION: 25,
  HINT: 30,
  MODEL_AND_ASK: 30,
  FACTUAL_CORRECTION: 30,
  WRAP_MASTERY: 10,
  WRAP_SUPPORT: 10,
  // Math moves
  STEP_PROBE_DIRECT: 30,
  STEP_PROBE_SIMPLER: 25,
  STEP_HINT: 35,
  STEP_MISCONCEPTION_REDIRECT: 30,
  STEP_COMBINE_PROMPT: 25,
  STEP_ACKNOWLEDGE_AND_PROBE: 30,
  STEP_MODEL_INSTRUCTION: 30,
  STEP_COMPUTATION_CORRECTION: 35,
  STEP_CONCEPT_EXPLANATION: 35,
  STEP_DEMONSTRATE_STEP: 35,
  WRAP_SUCCESS: 10,
  WRAP_NEEDS_SUPPORT: 50,
};

function getWordLimit(moveType: string): number {
  return WORD_LIMITS[moveType] ?? 40;
}

/** Threshold: same target probed this many times without progress = TARGET_STUCK. */
const TARGET_STUCK_THRESHOLD = 3;

// ============================================================================
// Formatting helpers
// ============================================================================

const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

function divider(label: string): string {
  const pad = Math.max(0, 60 - label.length - 4);
  return `${DIM}${"─".repeat(2)} ${RESET}${BOLD}${label}${RESET}${DIM} ${"─".repeat(pad)}${RESET}`;
}

function wc(text: string): number {
  return text.split(/\s+/).filter(w => w.length > 0).length;
}

function indent(text: string, prefix = "  "): string {
  return text.split("\n").map(line => prefix + line).join("\n");
}

const REPLAY_UNCERTAIN_PATTERNS = [
  /\bi\s+(?:still\s+|really\s+)?(?:don'?t|do\s*not)\s+know\b/i,
  /\bno\s*idea\b/i,
  /\bi'?m\s+(?:not\s+sure|confused|stuck|lost)\b/i,
  /\bwhat\s+(?:do\s+you\s+mean|does\s+that\s+mean)\b/i,
  /\bmaybe\b/i,
  /\bnot sure\b/i,
  /\bum\b/i,
  /\bi\s+guess\b/i,
];

function countUncertainStreakFromTranscript(
  transcript: TranscriptTurn[],
): number {
  let count = 0;
  for (let i = transcript.length - 1; i >= 0; i--) {
    if (transcript[i].role !== "student") continue;
    if (REPLAY_UNCERTAIN_PATTERNS.some(p => p.test(transcript[i].message))) {
      count++;
    } else {
      break;
    }
  }
  return count;
}

function severityColor(s: IssueSeverity): string {
  return s === "high" ? RED : YELLOW;
}

// ============================================================================
// Per-turn record (shared between replay and audit)
// ============================================================================

interface TurnRecord {
  turnNum: number;
  studentMessage: string;
  state: string;
  moveType: string;
  responseText: string;
  words: number;
  target: string | null;
  wrapAction: string;
  wrapReason?: string;
  explanation?: string;
  // Strategy escalation metadata
  strategyLevel?: string;
  noProgressStreak?: number;
  uncertainStreak?: number;
  escalationReason?: string;
  // Explanation-only detail
  entitiesMatched?: string[];
  pairsExtracted?: string[];
  accumulated?: string[];
  noProgress?: number;
  incorrectPairs?: string[];
  // Math-only detail
  satisfiedSteps?: string[];
  missingSteps?: string[];
  completion?: number;
  extractedAnswer?: number | null;
  answerCorrect?: boolean;
}

interface ReplayResult {
  fixture: Fixture;
  fixtureName: string;
  turns: TurnRecord[];
  summaryStatus: string;
  summaryRendered: string;
  summaryObservations: string[];
  // Evidence for audit checks
  coachTexts: string[];
  /** Did the student actually provide evidence by end? */
  hasEvidence: boolean;
  /** Explanation: number of satisfied entities. Math: number of satisfied steps. */
  satisfiedCount: number;
  totalRequired: number;
}

// ============================================================================
// Replay: explanation
// ============================================================================

function runExplanation(fixture: ExplanationFixture): ReplayResult {
  const turns: TurnRecord[] = [];
  const coachTexts: string[] = [];
  let accumulation: AccumulatedExplanationEvidence | null = null;
  let turnNum = 0;
  let prevSatisfiedCount = 0;

  for (let i = 0; i < fixture.transcript.length; i++) {
    const turn = fixture.transcript[i];
    if (turn.role !== "student") continue;

    turnNum++;
    const v = validate(turn.message, fixture.requiredEvidence, fixture.referenceFacts);
    accumulation = accumulateExplanationEvidence(
      v, turn.message, accumulation,
      fixture.requiredEvidence, fixture.referenceFacts, fixture.successCriteria,
    );
    const state = classifyExplanationState(turn.message, v, accumulation);
    // Build conversation history for variant-pool same-opening guard
    const convHistory = fixture.transcript.slice(0, i + 1).map(t => ({ role: t.role, message: t.message }));
    // Append prior coach texts so getExplanationRemediationMove can see the last coach message
    const historyWithCoach: Array<{ role: string; message: string }> = [];
    for (let h = 0; h < convHistory.length; h++) {
      historyWithCoach.push(convHistory[h]);
      if (h < coachTexts.length) {
        historyWithCoach.push({ role: "coach", message: coachTexts[h] });
      }
    }
    const move = getExplanationRemediationMove(
      state, accumulation, v,
      fixture.requiredEvidence, fixture.referenceFacts, fixture.successCriteria,
      fixture.promptInput, fixture.hints, historyWithCoach,
    );
    const wrap = shouldWrapExplanation(state, accumulation, 60, turnNum, 5);

    const responseText = move?.text ?? "";
    coachTexts.push(responseText);

    // Compute strategy metadata for explanation
    const currentUncertainStreak = countUncertainStreakFromTranscript(fixture.transcript.slice(0, i + 1));
    const currentSatisfied = new Set(accumulation.allPairs.map(p => p.entity)).size;
    const noProgressStreakVal = currentSatisfied > prevSatisfiedCount ? 0 : accumulation.consecutiveNoProgressTurns;

    // Build strategy input to get escalation info
    const history = fixture.transcript.slice(0, i).map(t => ({ role: t.role, message: t.message }));
    const explStrategyCtx = {
      conversationHistory: history,
      satisfiedCriteriaBefore: prevSatisfiedCount,
      satisfiedCriteriaAfter: currentSatisfied,
      consecutiveNoProgressTurns: accumulation.consecutiveNoProgressTurns,
      currentState: state,
      latestMoveType: move?.type ?? "NONE",
      targetCriterion: move?.targetCriterion ?? null,
      timeRemainingSec: null,
      attemptCount: turnNum,
      maxAttempts: 5,
    };
    const stratInput = buildExplanationStrategyInput(explStrategyCtx);
    const stratDecision = determineConversationStrategy(stratInput);

    turns.push({
      turnNum,
      studentMessage: turn.message,
      state,
      moveType: move?.type ?? "NONE",
      responseText,
      words: wc(responseText),
      target: move?.targetCriterion ?? null,
      wrapAction: wrap.action,
      wrapReason: wrap.reason,
      explanation: move?.explanation,
      strategyLevel: stratDecision.strategy,
      noProgressStreak: noProgressStreakVal,
      uncertainStreak: currentUncertainStreak,
      escalationReason: stratDecision.reason !== "no_escalation_needed" ? stratDecision.reason : undefined,
      entitiesMatched: v.matchedEntities,
      pairsExtracted: v.extractedPairs.map(p => `${p.entity}→${p.attribute}`),
      accumulated: accumulation.allPairs.map(p => `${p.entity}→${p.attribute}`),
      noProgress: accumulation.consecutiveNoProgressTurns,
      incorrectPairs: v.incorrectPairs.map(p => `${p.entity}≠${p.claimed}`),
    });

    prevSatisfiedCount = currentSatisfied;
  }

  const summary = accumulation
    ? buildExplanationTeacherSummary(
        accumulation, fixture.requiredEvidence, fixture.referenceFacts,
        fixture.successCriteria, fixture.promptInput,
      )
    : { status: "no_evidence" as const, renderedSummary: "", keyObservations: [] as string[] };

  const satisfiedCount = accumulation?.allPairs
    ? new Set(accumulation.allPairs.map(p => p.entity)).size
    : 0;

  return {
    fixture,
    fixtureName: fixture.name ?? fixture.promptInput.slice(0, 50),
    turns,
    summaryStatus: summary.status,
    summaryRendered: summary.renderedSummary,
    summaryObservations: summary.keyObservations,
    coachTexts,
    hasEvidence: satisfiedCount > 0,
    satisfiedCount,
    totalRequired: fixture.requiredEvidence.minEntities,
  };
}

// ============================================================================
// Replay: math
// ============================================================================

function runMath(fixture: MathFixture): ReplayResult {
  const turns: TurnRecord[] = [];
  const coachTexts: string[] = [];
  let turnNum = 0;
  let lastAcc: { satisfiedStepIds: string[]; missingStepIds: string[]; answerCorrect: boolean } | null = null;
  let prevSatisfiedCount = 0;

  for (let i = 0; i < fixture.transcript.length; i++) {
    const turn = fixture.transcript[i];
    if (turn.role !== "student") continue;

    turnNum++;
    const history = fixture.transcript.slice(0, i).map(t => ({
      role: t.role,
      message: t.message,
    }));

    const acc = accumulateReasoningStepEvidence(
      fixture.reasoningSteps, history,
      turn.message, fixture.mathProblem.correctAnswer,
    );
    lastAcc = acc;

    const localMove = getDeterministicRemediationMove(
      fixture.reasoningSteps, acc,
      turn.message, fixture.mathProblem, history,
    );

    // Apply strategy escalation
    let finalMove = localMove;
    let decision: ConversationStrategyDecision | null = null;
    if (localMove && localMove.type !== "WRAP_SUCCESS" && localMove.type !== "WRAP_NEEDS_SUPPORT") {
      const ctx: MathEscalationContext = {
        reasoningSteps: fixture.reasoningSteps,
        stepAccumulation: acc,
        mathProblem: fixture.mathProblem,
        conversationHistory: history,
        timeRemainingSec: null,
        attemptCount: turnNum,
        maxAttempts: 10,
      };
      const result = applyMathStrategyEscalation(localMove, ctx);
      finalMove = result.move;
      decision = result.decision;
    }

    const wrapped = acc.answerCorrect && acc.missingStepIds.length === 0;
    const responseText = finalMove?.text ?? "";
    coachTexts.push(responseText);

    // Compute streaks for metadata
    const currentUncertainStreak = countUncertainStreakFromTranscript(fixture.transcript.slice(0, i + 1));
    const newSatisfied = acc.satisfiedStepIds.length;
    const noProgressStreak = newSatisfied > prevSatisfiedCount ? 0 : currentUncertainStreak;

    turns.push({
      turnNum,
      studentMessage: turn.message,
      state: finalMove?.studentState ?? "unknown",
      moveType: finalMove?.type ?? "NONE",
      responseText,
      words: wc(responseText),
      target: finalMove?.targetStepId ?? null,
      wrapAction: wrapped ? "wrap_success" : "continue",
      explanation: finalMove?.explanation,
      strategyLevel: decision?.strategy ?? inferStrategyFromMove(finalMove?.type ?? "NONE", "math"),
      noProgressStreak,
      uncertainStreak: currentUncertainStreak,
      escalationReason: decision && decision.reason !== "no_escalation_needed" ? decision.reason : undefined,
      satisfiedSteps: acc.satisfiedStepIds,
      missingSteps: acc.missingStepIds,
      completion: acc.completionRatio,
      extractedAnswer: acc.extractedAnswer,
      answerCorrect: acc.answerCorrect,
    });

    prevSatisfiedCount = newSatisfied;
  }

  const recap = buildInstructionalRecap(fixture.reasoningSteps, fixture.mathProblem, null);

  return {
    fixture,
    fixtureName: fixture.name ?? fixture.mathProblem.expression,
    turns,
    summaryStatus: lastAcc?.answerCorrect ? "mastery" : "needs_support",
    summaryRendered: recap,
    summaryObservations: lastAcc
      ? [
          `${lastAcc.satisfiedStepIds.length}/${fixture.reasoningSteps.length} steps satisfied`,
          `Answer ${lastAcc.answerCorrect ? "correct" : "incorrect"}`,
        ]
      : [],
    coachTexts,
    hasEvidence: (lastAcc?.satisfiedStepIds.length ?? 0) > 0,
    satisfiedCount: lastAcc?.satisfiedStepIds.length ?? 0,
    totalRequired: fixture.reasoningSteps.length,
  };
}

// ============================================================================
// Audit checks
// ============================================================================

function auditResult(result: ReplayResult): AuditIssue[] {
  const issues: AuditIssue[] = [];

  // 1. REPEATED_OPENING — consecutive coach texts share first 4 words
  for (let i = 1; i < result.coachTexts.length; i++) {
    const prev = result.coachTexts[i - 1].split(/\s+/).slice(0, 4).join(" ").toLowerCase();
    const curr = result.coachTexts[i].split(/\s+/).slice(0, 4).join(" ").toLowerCase();
    if (prev.length > 0 && prev === curr) {
      issues.push({
        code: "REPEATED_OPENING",
        severity: ISSUE_SEVERITY.REPEATED_OPENING,
        turn: result.turns[i]?.turnNum,
        detail: `Turns ${result.turns[i - 1]?.turnNum} and ${result.turns[i]?.turnNum} both open with "${prev}"`,
      });
    }
  }

  // 2. TARGET_STUCK — same target probed N+ times in a row without progress
  //    Suppressed when strategy escalation is visibly advancing (move types change)
  const targetRuns: Array<{ target: string; count: number; startTurn: number; endTurn: number }> = [];
  for (const t of result.turns) {
    const tgt = t.target ?? "(none)";
    const last = targetRuns[targetRuns.length - 1];
    if (last && last.target === tgt) {
      last.count++;
      last.endTurn = t.turnNum;
    } else {
      targetRuns.push({ target: tgt, count: 1, startTurn: t.turnNum, endTurn: t.turnNum });
    }
  }
  for (const run of targetRuns) {
    if (run.target !== "(none)" && run.count >= TARGET_STUCK_THRESHOLD) {
      // Check if strategy escalated within this run (move types changed)
      const runTurns = result.turns.filter(
        t => t.target === run.target && t.turnNum >= run.startTurn && t.turnNum <= run.endTurn,
      );
      const moveTypes = new Set(runTurns.map(t => t.moveType));
      const hasEscalation = moveTypes.size > 1 || runTurns.some(t => t.escalationReason);

      if (hasEscalation) {
        // Strategy is working — suppress the warning
        continue;
      }

      issues.push({
        code: "TARGET_STUCK",
        severity: ISSUE_SEVERITY.TARGET_STUCK,
        turn: run.startTurn,
        detail: `Target "${run.target}" probed ${run.count} consecutive times starting at turn ${run.startTurn}`,
      });
    }
  }

  // 3. OVERLONG — response exceeds word limit for its move type
  for (const t of result.turns) {
    if (t.moveType === "NONE") continue;
    const limit = getWordLimit(t.moveType);
    if (t.words > limit) {
      issues.push({
        code: "OVERLONG",
        severity: ISSUE_SEVERITY.OVERLONG,
        turn: t.turnNum,
        detail: `${t.moveType} at turn ${t.turnNum}: ${t.words} words (limit ${limit})`,
      });
    }
  }

  // 4. PREMATURE_WRAP — wrap issued when criteria/steps remain unsatisfied
  for (const t of result.turns) {
    const isWrap = t.wrapAction === "wrap_mastery" || t.wrapAction === "wrap_success";
    if (!isWrap) continue;
    if (result.satisfiedCount < result.totalRequired) {
      issues.push({
        code: "PREMATURE_WRAP",
        severity: ISSUE_SEVERITY.PREMATURE_WRAP,
        turn: t.turnNum,
        detail: `Wrapped at turn ${t.turnNum} with ${result.satisfiedCount}/${result.totalRequired} satisfied`,
      });
    }
  }

  // 5. SUMMARY_MISMATCH — summary status contradicts transcript evidence
  const isMode = result.fixture.mode;
  if (isMode === "explanation") {
    // mastery summary but < minEntities satisfied
    if (result.summaryStatus === "mastery" && result.satisfiedCount < result.totalRequired) {
      issues.push({
        code: "SUMMARY_MISMATCH",
        severity: ISSUE_SEVERITY.SUMMARY_MISMATCH,
        detail: `Summary says "mastery" but only ${result.satisfiedCount}/${result.totalRequired} entities satisfied`,
      });
    }
    // no_evidence summary but student did provide evidence
    if (result.summaryStatus === "no_evidence" && result.hasEvidence) {
      issues.push({
        code: "SUMMARY_MISMATCH",
        severity: ISSUE_SEVERITY.SUMMARY_MISMATCH,
        detail: `Summary says "no_evidence" but ${result.satisfiedCount} entities were satisfied`,
      });
    }
  } else {
    // mastery summary but not all steps satisfied
    if (result.summaryStatus === "mastery" && result.satisfiedCount < result.totalRequired) {
      issues.push({
        code: "SUMMARY_MISMATCH",
        severity: ISSUE_SEVERITY.SUMMARY_MISMATCH,
        detail: `Summary says "mastery" but only ${result.satisfiedCount}/${result.totalRequired} steps satisfied`,
      });
    }
    // needs_support summary but all steps satisfied
    if (result.summaryStatus === "needs_support" && result.satisfiedCount >= result.totalRequired) {
      issues.push({
        code: "SUMMARY_MISMATCH",
        severity: ISSUE_SEVERITY.SUMMARY_MISMATCH,
        detail: `Summary says "needs_support" but all ${result.totalRequired} steps satisfied`,
      });
    }
  }

  return issues;
}

// ============================================================================
// Expectation checking (golden-fixture regression)
// ============================================================================

/**
 * Compare actual audit results against fixture metadata expectations.
 * Returns additional EXPECTATION_MISMATCH issues for any divergence.
 * Returns empty array when fixture has no expectations (backward compatible).
 */
function checkExpectations(
  fixture: Fixture,
  actualIssues: AuditIssue[],
): AuditIssue[] {
  const mismatches: AuditIssue[] = [];

  // Check expectedVerdict
  if (fixture.expectedVerdict != null) {
    const high = actualIssues.filter(i => i.severity === "high").length;
    const med = actualIssues.filter(i => i.severity === "medium").length;
    const actualVerdict = high > 0 ? "FAIL" : med > 0 ? "WARN" : "PASS";

    if (actualVerdict !== fixture.expectedVerdict) {
      mismatches.push({
        code: "EXPECTATION_MISMATCH",
        severity: ISSUE_SEVERITY.EXPECTATION_MISMATCH,
        detail: `Expected verdict ${fixture.expectedVerdict} but got ${actualVerdict}`,
      });
    }
  }

  // Check expectedIssueCodes
  if (fixture.expectedIssueCodes != null) {
    const actualCodes = new Set(actualIssues.map(i => i.code));

    // Every expected code must appear in actual
    for (const expected of fixture.expectedIssueCodes) {
      if (!actualCodes.has(expected as IssueCode)) {
        mismatches.push({
          code: "EXPECTATION_MISMATCH",
          severity: ISSUE_SEVERITY.EXPECTATION_MISMATCH,
          detail: `Expected issue code ${expected} not found in actual issues`,
        });
      }
    }

    // Any actual code not in expected set is also a mismatch
    const expectedSet = new Set(fixture.expectedIssueCodes);
    for (const actual of actualCodes) {
      if (actual !== "EXPECTATION_MISMATCH" && !expectedSet.has(actual)) {
        mismatches.push({
          code: "EXPECTATION_MISMATCH",
          severity: ISSUE_SEVERITY.EXPECTATION_MISMATCH,
          detail: `Unexpected issue code ${actual} not in expectedIssueCodes`,
        });
      }
    }
  }

  return mismatches;
}

// ============================================================================
// Verbose replay printer (original behavior)
// ============================================================================

function printReplayExplanation(result: ReplayResult): void {
  const fixture = result.fixture as ExplanationFixture;
  console.log(divider("EXPLANATION REPLAY"));
  console.log(`${DIM}Prompt:${RESET} ${fixture.promptInput}`);
  console.log(`${DIM}Entities:${RESET} ${Object.keys(fixture.referenceFacts).join(", ")}`);
  console.log(
    `${DIM}Evidence bar:${RESET} ${fixture.requiredEvidence.minEntities} ${fixture.requiredEvidence.entityLabel}, ` +
      `${fixture.requiredEvidence.minAttributeTypes ?? 1} ${fixture.requiredEvidence.attributeLabel} types`,
  );
  console.log();

  let transcriptIdx = 0;
  let turnIdx = 0;
  for (const entry of fixture.transcript) {
    if (entry.role === "coach") {
      console.log(`${DIM}[coach]${RESET} ${entry.message}`);
      console.log();
      continue;
    }
    const t = result.turns[turnIdx++];
    if (!t) continue;
    console.log(divider(`Student turn ${t.turnNum}`));
    console.log(`${CYAN}[student]${RESET} ${t.studentMessage}`);
    console.log();
    console.log(`  ${DIM}entities matched:${RESET}  ${t.entitiesMatched?.join(", ") || "(none)"}`);
    console.log(`  ${DIM}pairs extracted:${RESET}  ${t.pairsExtracted?.join(", ") || "(none)"}`);
    if (t.incorrectPairs && t.incorrectPairs.length > 0) {
      console.log(`  ${YELLOW}factual errors:${RESET}   ${t.incorrectPairs.join(", ")}`);
    }
    console.log(`  ${DIM}accumulated:${RESET}      ${t.accumulated?.join(", ") || "(none)"}`);
    console.log(`  ${DIM}no-progress:${RESET}      ${t.noProgress ?? 0} consecutive`);
    console.log(`  ${GREEN}state:${RESET}            ${t.state}`);
    if (t.moveType !== "NONE") {
      console.log(`  ${GREEN}move:${RESET}             ${t.moveType}`);
      console.log(`  ${GREEN}response:${RESET}         "${t.responseText}" ${DIM}(${t.words} words)${RESET}`);
      if (t.target) console.log(`  ${DIM}target:${RESET}           ${t.target}`);
      if (t.explanation) console.log(`  ${DIM}explanation:${RESET}      ${t.explanation}`);
    } else {
      console.log(`  ${YELLOW}move:${RESET}             (null)`);
    }
    console.log(`  ${GREEN}wrap:${RESET}             ${t.wrapAction}${t.wrapReason ? ` — ${t.wrapReason}` : ""}`);
    if (t.strategyLevel) console.log(`  ${DIM}strategy:${RESET}         ${t.strategyLevel}${t.escalationReason ? ` (${t.escalationReason})` : ""}`);
    if ((t.uncertainStreak ?? 0) > 0) console.log(`  ${DIM}uncertain-streak:${RESET} ${t.uncertainStreak}`);
    console.log();
  }

  console.log(divider("Teacher summary"));
  console.log(`  ${GREEN}status:${RESET}       ${result.summaryStatus}`);
  console.log(`  ${DIM}observations:${RESET}`);
  for (const obs of result.summaryObservations) console.log(`    - ${obs}`);
  console.log(`  ${DIM}rendered:${RESET}`);
  console.log(indent(result.summaryRendered, "    "));
  console.log();
}

function printReplayMath(result: ReplayResult): void {
  const fixture = result.fixture as MathFixture;
  console.log(divider("MATH REPLAY"));
  console.log(`${DIM}Problem:${RESET} ${fixture.mathProblem.expression}`);
  console.log(`${DIM}Steps:${RESET}   ${fixture.reasoningSteps.map(s => `${s.id}(${s.kind})`).join(" → ")}`);
  console.log();

  let turnIdx = 0;
  for (const entry of fixture.transcript) {
    if (entry.role === "coach") {
      console.log(`${DIM}[coach]${RESET} ${entry.message}`);
      console.log();
      continue;
    }
    const t = result.turns[turnIdx++];
    if (!t) continue;
    console.log(divider(`Student turn ${t.turnNum}`));
    console.log(`${CYAN}[student]${RESET} ${t.studentMessage}`);
    console.log();
    console.log(`  ${DIM}satisfied:${RESET}    ${t.satisfiedSteps?.join(", ") || "(none)"}`);
    console.log(`  ${DIM}missing:${RESET}      ${t.missingSteps?.join(", ") || "(none)"}`);
    console.log(`  ${DIM}completion:${RESET}   ${((t.completion ?? 0) * 100).toFixed(0)}%`);
    console.log(`  ${DIM}answer:${RESET}       extracted=${t.extractedAnswer}, correct=${t.answerCorrect}`);
    if (t.moveType !== "NONE") {
      console.log(`  ${GREEN}state:${RESET}        ${t.state}`);
      console.log(`  ${GREEN}move:${RESET}         ${t.moveType}`);
      console.log(`  ${GREEN}response:${RESET}     "${t.responseText}" ${DIM}(${t.words} words)${RESET}`);
      if (t.target) console.log(`  ${DIM}target:${RESET}       ${t.target}`);
      if (t.explanation) console.log(`  ${DIM}explanation:${RESET}  ${t.explanation}`);
    } else {
      console.log(`  ${YELLOW}move:${RESET}         (null)`);
    }
    console.log(`  ${GREEN}wrap:${RESET}         ${t.wrapAction}`);
    if (t.strategyLevel) console.log(`  ${DIM}strategy:${RESET}     ${t.strategyLevel}${t.escalationReason ? ` (${t.escalationReason})` : ""}`);
    if ((t.uncertainStreak ?? 0) > 0) console.log(`  ${DIM}uncertain:${RESET}    streak=${t.uncertainStreak}, no-progress=${t.noProgressStreak ?? 0}`);
    console.log();
  }

  console.log(divider("Instructional recap"));
  console.log(indent(result.summaryRendered, "  "));
  console.log();
}

// ============================================================================
// Audit printer (compact)
// ============================================================================

function printAuditLine(result: ReplayResult, issues: AuditIssue[]): void {
  const nTurns = result.turns.length;
  const high = issues.filter(i => i.severity === "high").length;
  const med = issues.filter(i => i.severity === "medium").length;

  const icon = high > 0 ? `${RED}FAIL${RESET}` : med > 0 ? `${YELLOW}WARN${RESET}` : `${GREEN}PASS${RESET}`;
  const mode = result.fixture.mode === "explanation" ? "expl" : "math";

  console.log(
    `  ${icon}  ${DIM}[${mode}]${RESET} ${result.fixtureName} ` +
      `${DIM}(${nTurns} turns, ${result.satisfiedCount}/${result.totalRequired} satisfied, ` +
      `summary=${result.summaryStatus})${RESET}`,
  );

  for (const issue of issues) {
    const col = severityColor(issue.severity);
    const turnLabel = issue.turn != null ? ` turn ${issue.turn}` : "";
    console.log(`         ${col}${issue.severity.toUpperCase()} ${issue.code}${turnLabel}:${RESET} ${issue.detail}`);
  }
}

function printAggregateSummary(
  allResults: Array<{ result: ReplayResult; issues: AuditIssue[] }>,
): void {
  console.log();
  console.log(divider("Aggregate summary"));

  const total = allResults.length;
  const withHigh = allResults.filter(r => r.issues.some(i => i.severity === "high")).length;
  const withMed = allResults.filter(r =>
    r.issues.some(i => i.severity === "medium") && !r.issues.some(i => i.severity === "high"),
  ).length;
  const clean = total - withHigh - withMed;

  console.log(`  ${DIM}Fixtures:${RESET}  ${total}`);
  console.log(`  ${GREEN}Pass:${RESET}      ${clean}`);
  if (withMed > 0) console.log(`  ${YELLOW}Warn:${RESET}      ${withMed}`);
  if (withHigh > 0) console.log(`  ${RED}Fail:${RESET}      ${withHigh}`);

  // Issue breakdown
  const issueCounts: Record<string, number> = {};
  for (const r of allResults) {
    for (const i of r.issues) {
      issueCounts[i.code] = (issueCounts[i.code] ?? 0) + 1;
    }
  }
  if (Object.keys(issueCounts).length > 0) {
    console.log();
    console.log(`  ${DIM}Issues by type:${RESET}`);
    for (const [code, count] of Object.entries(issueCounts).sort((a, b) => b[1] - a[1])) {
      const sev = ISSUE_SEVERITY[code as IssueCode];
      const col = severityColor(sev);
      console.log(`    ${col}${code}${RESET}: ${count}`);
    }
  }

  console.log();
}

// ============================================================================
// Markdown report renderer
// ============================================================================

/**
 * Render a full markdown audit report. Exported for testing.
 */
export function renderMarkdownReport(
  allResults: Array<{ result: ReplayResult; issues: AuditIssue[] }>,
): string {
  const lines: string[] = [];
  const w = (s: string) => lines.push(s);

  w("# Transcript Audit Report");
  w("");

  // ── Per-fixture sections ──────────────────────────────────────────────
  for (const { result, issues } of allResults) {
    const high = issues.filter(i => i.severity === "high").length;
    const med = issues.filter(i => i.severity === "medium").length;
    const verdict = high > 0 ? "FAIL" : med > 0 ? "WARN" : "PASS";
    const mode = result.fixture.mode;
    const lastTurn = result.turns[result.turns.length - 1];
    const finalWrap = lastTurn?.wrapAction ?? "none";

    w(`## ${result.fixtureName}`);
    w("");
    w(`| Field | Value |`);
    w(`| --- | --- |`);
    w(`| Mode | ${mode} |`);
    w(`| Result | **${verdict}** |`);
    w(`| Turns | ${result.turns.length} |`);
    w(`| Satisfied | ${result.satisfiedCount}/${result.totalRequired} |`);
    w(`| Final wrap | ${finalWrap} |`);
    w(`| Summary status | ${result.summaryStatus} |`);
    w("");

    // Issues
    if (issues.length > 0) {
      w("### Issues");
      w("");
      w("| Severity | Code | Turn | Detail |");
      w("| --- | --- | --- | --- |");
      for (const issue of issues) {
        const turnCol = issue.turn != null ? String(issue.turn) : "—";
        w(`| ${issue.severity} | ${issue.code} | ${turnCol} | ${issue.detail} |`);
      }
      w("");
    }

    // Per-turn table
    w("### Turns");
    w("");
    w("| # | Student utterance | State | Move | Strategy | Escalation | Words | Wrap |");
    w("| --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const t of result.turns) {
      const utterance = truncate(t.studentMessage, 40);
      const strategy = t.strategyLevel ?? "—";
      const escalation = t.escalationReason ?? "—";
      w(`| ${t.turnNum} | ${escMd(utterance)} | ${t.state} | ${t.moveType} | ${strategy} | ${escalation} | ${t.words} | ${t.wrapAction} |`);
    }
    w("");
  }

  // ── Aggregate summary ─────────────────────────────────────────────────
  w("## Aggregate Summary");
  w("");

  const total = allResults.length;
  const withHigh = allResults.filter(r => r.issues.some(i => i.severity === "high")).length;
  const withMed = allResults.filter(r =>
    r.issues.some(i => i.severity === "medium") && !r.issues.some(i => i.severity === "high"),
  ).length;
  const clean = total - withHigh - withMed;

  w("| Metric | Count |");
  w("| --- | --- |");
  w(`| Fixtures | ${total} |`);
  w(`| Pass | ${clean} |`);
  w(`| Warn | ${withMed} |`);
  w(`| Fail | ${withHigh} |`);
  w("");

  // Issue frequency
  const issueCounts: Record<string, number> = {};
  for (const r of allResults) {
    for (const i of r.issues) {
      issueCounts[i.code] = (issueCounts[i.code] ?? 0) + 1;
    }
  }
  if (Object.keys(issueCounts).length > 0) {
    w("### Issues by Type");
    w("");
    w("| Code | Severity | Count |");
    w("| --- | --- | --- |");
    for (const [code, count] of Object.entries(issueCounts).sort((a, b) => b[1] - a[1])) {
      const sev = ISSUE_SEVERITY[code as IssueCode];
      w(`| ${code} | ${sev} | ${count} |`);
    }
    w("");
  }

  return lines.join("\n");
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "…";
}

function escMd(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

// Also export types and helpers needed for testing
export type { ReplayResult, AuditIssue, TurnRecord, Fixture, ExplanationFixture, MathFixture, FixtureMetadata, IssueCode, IssueSeverity };
export { auditResult, checkExpectations, runFixture, DEMO_EXPLANATION, DEMO_MATH, ISSUE_SEVERITY };

// ============================================================================
// File / directory loading
// ============================================================================

function loadFixture(filePath: string): Fixture {
  const raw = fs.readFileSync(filePath, "utf-8");
  const fixture: Fixture = JSON.parse(raw);
  if (!fixture.mode || (fixture.mode !== "explanation" && fixture.mode !== "math")) {
    throw new Error(`Invalid fixture mode in ${filePath}: ${(fixture as any).mode}`);
  }
  // Default name to filename if not set
  if (!fixture.name) {
    fixture.name = path.basename(filePath, ".json");
  }
  return fixture;
}

function loadFixtures(target: string): Fixture[] {
  const resolved = path.resolve(target);
  const stat = fs.statSync(resolved);

  if (stat.isFile()) {
    return [loadFixture(resolved)];
  }

  if (stat.isDirectory()) {
    return loadFixturesFromDir(resolved);
  }

  throw new Error(`${resolved} is not a file or directory`);
}

/** Recursively collect .json fixtures from a directory tree. */
function loadFixturesFromDir(dir: string): Fixture[] {
  const fixtures: Fixture[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      fixtures.push(...loadFixturesFromDir(full));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      fixtures.push(loadFixture(full));
    }
  }

  if (fixtures.length === 0) {
    throw new Error(`No .json files found in ${dir}`);
  }

  return fixtures;
}

// ============================================================================
// Run a single fixture
// ============================================================================

function runFixture(fixture: Fixture): ReplayResult {
  if (fixture.mode === "explanation") {
    return runExplanation(fixture);
  }
  return runMath(fixture);
}

// ============================================================================
// Built-in demo fixtures
// ============================================================================

const DEMO_EXPLANATION: ExplanationFixture = {
  mode: "explanation",
  name: "planets: claim → partial → mastery",
  promptInput:
    "What are planets made of? Give examples of different planets and their materials.",
  requiredEvidence: {
    minEntities: 2,
    entityLabel: "planets",
    attributeLabel: "materials",
    minAttributeTypes: 2,
    requirePairing: true,
  },
  referenceFacts: {
    Mercury: ["rock", "metal"],
    Venus: ["rock"],
    Earth: ["rock", "metal"],
    Mars: ["rock"],
    Jupiter: ["gas"],
    Saturn: ["gas"],
    Uranus: ["ice", "gas"],
    Neptune: ["ice", "gas"],
  },
  successCriteria: [
    "States that planets are made of different materials such as rock, gas, or ice.",
    "Names at least two specific planets.",
    "Describes what each named planet is made of.",
  ],
  hints: ["Think about what you know about Earth and other planets."],
  transcript: [
    { role: "coach", message: "What are planets made of?" },
    { role: "student", message: "they are made of different stuff" },
    { role: "coach", message: "Tell me about Mercury. What is it made of?" },
    { role: "student", message: "Mercury is made of rock" },
    { role: "coach", message: "What about another planet?" },
    { role: "student", message: "Jupiter is made of gas" },
  ],
};

const DEMO_MATH: MathFixture = {
  mode: "math",
  name: "11+14: smooth walkthrough",
  mathProblem: {
    skill: "two_digit_addition",
    a: 11,
    b: 14,
    expression: "11 + 14",
    correctAnswer: 25,
    requiresRegrouping: false,
    expectedStrategyTags: ["add ones", "add tens", "combine"],
  } as MathProblem,
  reasoningSteps: [
    {
      id: "step_ones",
      label: "Add the ones",
      expectedStatements: ["1 + 4 = 5"],
      probe: "What do you get when you add 1 and 4?",
      kind: "ones_sum" as const,
    },
    {
      id: "step_tens",
      label: "Add the tens",
      expectedStatements: ["10 + 10 = 20"],
      probe: "What do you get when you add 10 and 10?",
      kind: "tens_sum" as const,
    },
    {
      id: "step_combine",
      label: "Combine",
      expectedStatements: ["20 + 5 = 25"],
      probe: "What do you get when you put 20 and 5 together?",
      kind: "combine" as const,
    },
  ],
  transcript: [
    { role: "coach", message: "Let's solve 11 + 14. Can you break it into tens and ones?" },
    { role: "student", message: "1 + 4 = 5" },
    { role: "coach", message: "Good! Now what about the tens?" },
    { role: "student", message: "10 + 10 = 20" },
    { role: "coach", message: "Now put them together." },
    { role: "student", message: "20 + 5 = 25" },
  ],
};

// ============================================================================
// Main
// ============================================================================

function main(): void {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`Usage:
  npx ts-node src/domain/transcriptReplay.ts                        # built-in demo (replay)
  npx ts-node src/domain/transcriptReplay.ts fixture.json           # single file replay
  npx ts-node src/domain/transcriptReplay.ts --audit fixture.json   # single file audit
  npx ts-node src/domain/transcriptReplay.ts --audit fixtures/      # batch audit directory
  npx ts-node src/domain/transcriptReplay.ts --audit fixtures/ --markdown report.md

Options:
  --audit           Compact audit mode with issue detection and aggregate summary.
                    Exit code 1 if any high-severity issue is found.
  --verbose         In audit mode, also print full replay output per fixture.
  --markdown <path> Write a markdown audit report to the given file.

Audit checks:
  REPEATED_OPENING    (high)   Consecutive coach turns share same opening phrase
  PREMATURE_WRAP      (high)   Wrap decision when criteria/steps still missing
  SUMMARY_MISMATCH    (high)   Teacher summary contradicts transcript evidence
  EXPECTATION_MISMATCH (high)  Actual verdict/issues differ from fixture expectations
  TARGET_STUCK        (medium) Same target probed ${TARGET_STUCK_THRESHOLD}+ times without progress
  OVERLONG            (medium) Response exceeds word limit for its move type

Golden fixture metadata (optional):
  "expectedVerdict": "PASS" | "WARN" | "FAIL"
  "expectedIssueCodes": ["OVERLONG", ...]`);
    process.exit(0);
  }

  const auditMode = args.includes("--audit");
  const verbose = args.includes("--verbose");

  // Parse --markdown <path>
  let markdownPath: string | null = null;
  const mdIdx = args.indexOf("--markdown");
  if (mdIdx !== -1) {
    markdownPath = args[mdIdx + 1] ?? null;
    if (!markdownPath || markdownPath.startsWith("--")) {
      console.error(`${RED}Error:${RESET} --markdown requires a file path argument.`);
      process.exit(1);
    }
  }

  const targets = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--markdown");

  // No target: run built-in demos
  if (targets.length === 0) {
    if (auditMode) {
      const fixtures = [DEMO_EXPLANATION, DEMO_MATH] as Fixture[];
      runAuditBatch(fixtures, verbose, markdownPath);
    } else {
      const r1 = runExplanation(DEMO_EXPLANATION);
      printReplayExplanation(r1);
      console.log();
      const r2 = runMath(DEMO_MATH);
      printReplayMath(r2);
    }
    return;
  }

  // Load fixtures from targets
  const fixtures: Fixture[] = [];
  for (const target of targets) {
    try {
      fixtures.push(...loadFixtures(target));
    } catch (err: any) {
      console.error(`${RED}Error loading ${target}:${RESET} ${err.message}`);
      process.exit(1);
    }
  }

  if (auditMode) {
    runAuditBatch(fixtures, verbose, markdownPath);
  } else {
    // Replay mode: verbose output for each fixture
    for (const fixture of fixtures) {
      const result = runFixture(fixture);
      if (fixture.mode === "explanation") {
        printReplayExplanation(result);
      } else {
        printReplayMath(result);
      }
      if (fixtures.length > 1) console.log("\n");
    }
  }
}

function runAuditBatch(fixtures: Fixture[], verbose: boolean, markdownPath: string | null): void {
  console.log(divider(`Audit: ${fixtures.length} fixture${fixtures.length === 1 ? "" : "s"}`));
  console.log();

  const allResults: Array<{ result: ReplayResult; issues: AuditIssue[] }> = [];

  for (const fixture of fixtures) {
    const result = runFixture(fixture);
    const issues = auditResult(result);
    const expectationIssues = checkExpectations(fixture, issues);
    issues.push(...expectationIssues);
    allResults.push({ result, issues });

    if (verbose) {
      if (fixture.mode === "explanation") {
        printReplayExplanation(result);
      } else {
        printReplayMath(result);
      }
    }

    printAuditLine(result, issues);
  }

  printAggregateSummary(allResults);

  if (markdownPath) {
    const md = renderMarkdownReport(allResults);
    fs.writeFileSync(markdownPath, md, "utf-8");
    console.log(`  Markdown report written to ${markdownPath}`);
    console.log();
  }

  const hasHighOrMismatch = allResults.some(r =>
    r.issues.some(i => i.severity === "high" || i.code === "EXPECTATION_MISMATCH"),
  );
  if (hasHighOrMismatch) {
    process.exit(1);
  }
}

// Only run CLI when executed directly (not when imported by tests)
if (require.main === module) {
  main();
}
