#!/usr/bin/env npx ts-node
/**
 * Session review packet generator.
 *
 * Generates a single markdown report from a saved session JSON, showing
 * end-to-end what happened for each prompt attempt: metadata, transcript,
 * deterministic replay analysis, audit verdict, and promotion recommendation.
 *
 * Usage:
 *   npx ts-node src/domain/generateSessionReview.ts --from-session data/sessions/abc123.json
 *   npx ts-node src/domain/generateSessionReview.ts --from-session session.json --prompt q1
 *   npx ts-node src/domain/generateSessionReview.ts --from-session session.json -o review.md
 *
 * Dev-only utility — not imported by production code.
 */

import * as fs from "fs";
import * as path from "path";
import { loadLessonById } from "../loaders/lessonLoader";
import {
  runFixture,
  auditResult,
  type Fixture,
  type ExplanationFixture,
  type MathFixture,
  type ReplayResult,
  type AuditIssue,
  type TurnRecord,
} from "./transcriptReplay";
import type { Lesson } from "./lesson";
import type { Prompt } from "./prompt";

// ============================================================================
// Types
// ============================================================================

interface TranscriptTurn {
  role: "coach" | "student";
  message: string;
  timestampSec?: number;
}

interface SessionFile {
  id: string;
  lessonId: string;
  lessonTitle?: string;
  studentName?: string;
  submission?: {
    responses?: Array<{
      promptId: string;
      conversationTurns?: TranscriptTurn[];
      inputSource?: string;
      deferredByCoach?: boolean;
    }>;
  };
  evaluation?: {
    totalScore: number;
    criteriaScores?: Array<{
      criterionId: string;
      score: number;
    }>;
  };
}

type DetectedMode = "math" | "explanation" | "unsupported";

type TranscriptSource = "captured speech" | "placeholder only" | "unavailable";

type ReplayFidelity =
  | "Replay matches live outcome"
  | "Replay differs from live outcome"
  | "Replay unavailable";

interface PromptAnalysis {
  promptId: string;
  promptText: string;
  mode: DetectedMode;
  deterministicPipeline: boolean;
  turns: TranscriptTurn[];
  replayResult: ReplayResult | null;
  issues: AuditIssue[] | null;
  verdict: "PASS" | "WARN" | "FAIL" | null;
  promotion: PromotionRecommendation;
  placeholderSkipped?: boolean;
  transcriptSource: TranscriptSource;
  replayFidelity: ReplayFidelity;
  journeySummary: string;
}

type PromotionRecommendation =
  | "Promote to golden fixture"
  | "Good debugging example"
  | "No promotion needed";

interface SessionReview {
  sessionId: string;
  lessonId: string;
  lessonTitle: string | null;
  studentName: string | null;
  timestamp: string;
  prompts: PromptAnalysis[];
}

// ============================================================================
// Mode detection
// ============================================================================

function detectMode(prompt: Prompt): DetectedMode {
  const hasMath = !!prompt.mathProblem && !!prompt.assessment?.reasoningSteps?.length;
  const hasExplanation = !!prompt.assessment?.requiredEvidence && !!prompt.assessment?.referenceFacts;

  if (hasMath) return "math";
  if (hasExplanation) return "explanation";
  return "unsupported";
}

function usesDeterministicPipeline(prompt: Prompt, mode: DetectedMode): boolean {
  if (mode === "math") return !!prompt.assessment?.reasoningSteps?.length;
  if (mode === "explanation") {
    return !!prompt.assessment?.requiredEvidence
      && !!prompt.assessment?.referenceFacts
      && !!prompt.assessment?.successCriteria?.length;
  }
  return false;
}

function deriveTranscriptSource(transcript: TranscriptTurn[]): TranscriptSource {
  if (transcript.length === 0) return "unavailable";
  if (isPlaceholderTranscript(transcript)) return "placeholder only";
  return "captured speech";
}

// ============================================================================
// Replay fidelity comparison
// ============================================================================

interface LiveOutcome {
  liveScore?: number;        // from evaluation.criteriaScores
  deferredByCoach?: boolean; // from PromptResponse
}

/**
 * Compare replay summaryStatus against live outcome.
 *
 * Live score → mastery bucket: score ≥ 70 → "mastery", otherwise "needs_support"
 * deferredByCoach → always "needs_support"
 *
 * Returns "Replay unavailable" when no replay ran,
 * "Replay matches live outcome" / "Replay differs from live outcome" otherwise.
 */
function compareReplayToLive(
  replayResult: ReplayResult | null,
  live: LiveOutcome | null,
): ReplayFidelity {
  if (!replayResult) return "Replay unavailable";
  if (!live) return "Replay unavailable";

  const hasLiveData = live.liveScore != null || live.deferredByCoach != null;
  if (!hasLiveData) return "Replay unavailable";

  // Derive live mastery bucket
  let liveMastery: boolean;
  if (live.deferredByCoach) {
    liveMastery = false;
  } else if (live.liveScore != null) {
    liveMastery = live.liveScore >= 70;
  } else {
    return "Replay unavailable";
  }

  // Derive replay mastery bucket
  const replayMastery = replayResult.summaryStatus === "mastery";

  return liveMastery === replayMastery
    ? "Replay matches live outcome"
    : "Replay differs from live outcome";
}

// ============================================================================
// Fixture building (reuses logic from generateReplayFixture.ts)
// ============================================================================

function buildFixture(
  prompt: Prompt,
  transcript: TranscriptTurn[],
  mode: "math" | "explanation",
): Fixture {
  const turns = transcript.map(t => ({ role: t.role, message: t.message }));

  if (mode === "math") {
    return {
      mode: "math",
      name: `${prompt.id}: ${prompt.mathProblem!.expression}`,
      mathProblem: prompt.mathProblem!,
      reasoningSteps: prompt.assessment!.reasoningSteps!,
      transcript: turns,
    } as MathFixture;
  }

  return {
    mode: "explanation",
    name: `${prompt.id}`,
    promptInput: prompt.input,
    requiredEvidence: prompt.assessment!.requiredEvidence!,
    referenceFacts: prompt.assessment!.referenceFacts!,
    successCriteria: prompt.assessment?.successCriteria ?? [],
    hints: prompt.hints,
    transcript: turns,
  } as ExplanationFixture;
}

// ============================================================================
// Promotion recommendation
// ============================================================================

export function recommendPromotion(
  mode: DetectedMode,
  verdict: "PASS" | "WARN" | "FAIL" | null,
  issues: AuditIssue[] | null,
  turns: TranscriptTurn[],
  existingTurnCount: number,
): PromotionRecommendation {
  // Can't promote unsupported or non-replayed prompts
  if (mode === "unsupported" || verdict === null) return "No promotion needed";

  const studentTurns = turns.filter(t => t.role === "student").length;

  // Trivial: fewer than 2 student turns
  if (studentTurns < 2) return "No promotion needed";

  // Short and clean: not interesting enough
  if (studentTurns === 2 && verdict === "PASS" && existingTurnCount >= 3) {
    return "No promotion needed";
  }

  // WARN or FAIL → debugging example
  if (verdict === "WARN" || verdict === "FAIL") return "Good debugging example";

  // Has unusual recovery patterns (error correction, meta-question, hint request)
  if (issues && issues.length > 0) return "Good debugging example";

  // Clean PASS with enough substance → promote
  if (verdict === "PASS" && studentTurns >= 2) return "Promote to golden fixture";

  return "No promotion needed";
}

// ============================================================================
// Placeholder transcript detection
// ============================================================================

const PLACEHOLDER_RE = /^\[Video conversation:.*\]$/;

function isPlaceholderTranscript(transcript: TranscriptTurn[]): boolean {
  if (transcript.length === 0) return true;

  const studentTurns = transcript.filter(t => t.role === "student");
  if (studentTurns.length === 0) return true;

  return studentTurns.every(t => PLACEHOLDER_RE.test(t.message.trim()));
}

// ============================================================================
// Analyze a single prompt response
// ============================================================================

function analyzePrompt(
  prompt: Prompt,
  transcript: TranscriptTurn[],
  liveOutcome?: LiveOutcome | null,
): PromptAnalysis {
  const mode = detectMode(prompt);
  const deterministicPipeline = usesDeterministicPipeline(prompt, mode);

  const transcriptSource = deriveTranscriptSource(transcript);
  const live = liveOutcome ?? null;

  if (mode === "unsupported" || !deterministicPipeline) {
    const promotion = recommendPromotion(mode, null, null, transcript, 0);
    const pa: PromptAnalysis = {
      promptId: prompt.id,
      promptText: prompt.input,
      mode,
      deterministicPipeline,
      turns: transcript,
      replayResult: null,
      issues: null,
      verdict: null,
      promotion,
      transcriptSource,
      replayFidelity: "Replay unavailable",
      journeySummary: "",
    };
    pa.journeySummary = buildStudentJourneySummary(pa);
    return pa;
  }

  // Skip replay for video placeholder transcripts
  if (isPlaceholderTranscript(transcript)) {
    const pa: PromptAnalysis = {
      promptId: prompt.id,
      promptText: prompt.input,
      mode,
      deterministicPipeline,
      turns: transcript,
      replayResult: null,
      issues: null,
      verdict: null,
      promotion: "No promotion needed",
      placeholderSkipped: true,
      transcriptSource,
      replayFidelity: "Replay unavailable",
      journeySummary: "",
    };
    pa.journeySummary = buildStudentJourneySummary(pa);
    return pa;
  }

  const fixture = buildFixture(prompt, transcript, mode);
  const result = runFixture(fixture);
  const issues = auditResult(result);

  const high = issues.filter(i => i.severity === "high").length;
  const med = issues.filter(i => i.severity === "medium").length;
  const verdict: "PASS" | "WARN" | "FAIL" = high > 0 ? "FAIL" : med > 0 ? "WARN" : "PASS";

  const promotion = recommendPromotion(mode, verdict, issues, transcript, result.turns.length);
  const replayFidelity = compareReplayToLive(result, live);

  const pa: PromptAnalysis = {
    promptId: prompt.id,
    promptText: prompt.input,
    mode,
    deterministicPipeline,
    turns: transcript,
    replayResult: result,
    issues,
    verdict,
    promotion,
    transcriptSource,
    replayFidelity,
    journeySummary: "",
  };
  pa.journeySummary = buildStudentJourneySummary(pa);
  return pa;
}

// ============================================================================
// Build full session review
// ============================================================================

function buildSessionReview(
  session: SessionFile,
  lesson: Lesson,
  promptFilter?: string,
): SessionReview {
  const responses = session.submission?.responses ?? [];
  const filtered = promptFilter
    ? responses.filter(r => r.promptId === promptFilter)
    : responses;

  const prompts: PromptAnalysis[] = [];

  for (const resp of filtered) {
    const prompt = lesson.prompts.find(p => p.id === resp.promptId);
    if (!prompt) continue;

    const transcript = resp.conversationTurns ?? [];
    if (transcript.length === 0) continue;

    // Extract live outcome for replay fidelity comparison
    const liveScore = session.evaluation?.criteriaScores?.find(
      c => c.criterionId === resp.promptId,
    )?.score;
    const liveOutcome: LiveOutcome = {
      liveScore,
      deferredByCoach: resp.deferredByCoach,
    };

    prompts.push(analyzePrompt(prompt, transcript, liveOutcome));
  }

  return {
    sessionId: session.id,
    lessonId: session.lessonId,
    lessonTitle: session.lessonTitle ?? lesson.title ?? null,
    studentName: session.studentName ?? null,
    timestamp: new Date().toISOString(),
    prompts,
  };
}

// ============================================================================
// Markdown rendering
// ============================================================================

export function renderSessionReview(review: SessionReview): string {
  const lines: string[] = [];
  const w = (s: string) => lines.push(s);

  // ── Section 1: Session metadata ──
  w("# Session Review Packet");
  w("");
  w("## Session Metadata");
  w("");
  w("| Field | Value |");
  w("| --- | --- |");
  w(`| Session ID | ${review.sessionId} |`);
  w(`| Lesson ID | ${review.lessonId} |`);
  if (review.lessonTitle) w(`| Lesson title | ${review.lessonTitle} |`);
  if (review.studentName) w(`| Student | ${review.studentName} |`);
  w(`| Prompts included | ${review.prompts.map(p => p.promptId).join(", ") || "(none)"} |`);
  w(`| Generated | ${review.timestamp} |`);
  w("");

  if (review.prompts.length === 0) {
    w("*No prompts with conversation data found in this session.*");
    w("");
    return lines.join("\n");
  }

  // ── Section 2: Prompt overview ──
  w("## Prompt Overview");
  w("");
  w("| Prompt ID | Mode | Deterministic | Verdict | Promotion |");
  w("| --- | --- | --- | --- | --- |");
  for (const p of review.prompts) {
    const verdictStr = p.verdict ?? "—";
    const detStr = p.deterministicPipeline ? "yes" : "no";
    w(`| ${p.promptId} | ${p.mode} | ${detStr} | ${verdictStr} | ${p.promotion} |`);
  }
  w("");

  // ── Per-prompt sections ──
  for (const pa of review.prompts) {
    w(`## Prompt: ${pa.promptId}`);
    w("");
    w(`**Text:** ${escMd(truncate(pa.promptText, 120))}`);
    w(`**Mode:** ${pa.mode}`);
    w(`**Deterministic pipeline:** ${pa.deterministicPipeline ? "yes" : "no"}`);
    w(`**Transcript source:** ${pa.transcriptSource}`);
    w(`**Replay fidelity:** ${pa.replayFidelity}`);
    w(`**Journey:** ${pa.journeySummary}`);
    w("");

    // ── Section 3: Transcript ──
    w("### Transcript");
    w("");
    if (pa.turns.length === 0) {
      w("*No conversation turns.*");
    } else {
      for (const t of pa.turns) {
        const ts = t.timestampSec != null ? ` *(${t.timestampSec}s)*` : "";
        const speaker = t.role === "coach" ? "**Coach:**" : "**Student:**";
        w(`${speaker} ${escMd(t.message)}${ts}`);
        w("");
      }
    }

    // ── Section 4: Deterministic replay analysis ──
    if (pa.placeholderSkipped) {
      w("### Replay Analysis");
      w("");
      w("*Replay unavailable — video transcript not captured.*");
      w("");
    } else if (pa.replayResult) {
      w("### Replay Analysis");
      w("");
      w("| # | Student utterance | State | Move | Target | Response | Words | Wrap |");
      w("| --- | --- | --- | --- | --- | --- | --- | --- |");
      for (const t of pa.replayResult.turns) {
        const utterance = truncate(t.studentMessage, 40);
        const response = truncate(t.responseText, 40);
        const target = t.target ?? "—";
        w(`| ${t.turnNum} | ${escMd(utterance)} | ${t.state} | ${t.moveType} | ${escMd(target)} | ${escMd(response)} | ${t.words} | ${t.wrapAction} |`);
      }
      w("");

      // Evidence/step detail per turn
      w("#### Turn Details");
      w("");
      for (const t of pa.replayResult.turns) {
        w(`**Turn ${t.turnNum}:** "${escMd(truncate(t.studentMessage, 60))}"`);
        w("");
        if (pa.mode === "explanation") {
          w(`- Entities matched: ${t.entitiesMatched?.join(", ") || "(none)"}`);
          w(`- Pairs extracted: ${t.pairsExtracted?.join(", ") || "(none)"}`);
          w(`- Accumulated: ${t.accumulated?.join(", ") || "(none)"}`);
          if (t.incorrectPairs && t.incorrectPairs.length > 0) {
            w(`- Factual errors: ${t.incorrectPairs.join(", ")}`);
          }
          w(`- No-progress streak: ${t.noProgress ?? 0}`);
        } else if (pa.mode === "math") {
          w(`- Satisfied steps: ${t.satisfiedSteps?.join(", ") || "(none)"}`);
          w(`- Missing steps: ${t.missingSteps?.join(", ") || "(none)"}`);
          w(`- Completion: ${((t.completion ?? 0) * 100).toFixed(0)}%`);
          w(`- Extracted answer: ${t.extractedAnswer ?? "—"}`);
          w(`- Answer correct: ${t.answerCorrect ?? "—"}`);
        }
        w(`- State: ${t.state}`);
        w(`- Move: ${t.moveType}${t.target ? ` → ${t.target}` : ""}`);
        w(`- Wrap: ${t.wrapAction}${t.wrapReason ? ` (${t.wrapReason})` : ""}`);
        w("");
      }
    } else if (pa.mode === "unsupported") {
      w("### Replay Analysis");
      w("");
      w("*Deterministic replay not available for this prompt mode.*");
      w("");
    }

    // ── Section 5: Final outcome ──
    w("### Final Outcome");
    w("");
    if (pa.placeholderSkipped) {
      w("*Replay unavailable — video transcript not captured.*");
      w("");
    } else if (pa.replayResult) {
      const lastTurn = pa.replayResult.turns[pa.replayResult.turns.length - 1];
      w("| Field | Value |");
      w("| --- | --- |");
      w(`| Final wrap | ${lastTurn?.wrapAction ?? "none"} |`);
      w(`| Summary status | ${pa.replayResult.summaryStatus} |`);
      w(`| Satisfied | ${pa.replayResult.satisfiedCount}/${pa.replayResult.totalRequired} |`);
      w(`| Verdict | **${pa.verdict}** |`);
      w("");

      if (pa.replayResult.summaryRendered) {
        w("**Teacher summary:**");
        w("");
        w(`> ${escMd(pa.replayResult.summaryRendered).split("\n").join("\n> ")}`);
        w("");
      }

      if (pa.issues && pa.issues.length > 0) {
        w("**Audit issues:**");
        w("");
        w("| Severity | Code | Turn | Detail |");
        w("| --- | --- | --- | --- |");
        for (const issue of pa.issues) {
          const turnCol = issue.turn != null ? String(issue.turn) : "—";
          w(`| ${issue.severity} | ${issue.code} | ${turnCol} | ${escMd(issue.detail)} |`);
        }
        w("");
      }
    } else {
      w("*No deterministic analysis available.*");
      w("");
    }

    // ── Section 6: Promotion recommendation ──
    w("### Promotion Recommendation");
    w("");
    w(`**${pa.promotion}**`);
    w("");
    if (pa.promotion === "Promote to golden fixture") {
      w("This transcript is clean, representative, and passed audit. ");
      w("Use `generateReplayFixture.ts` to convert it to a fixture.");
      w("");
    } else if (pa.promotion === "Good debugging example") {
      w("This transcript shows unusual behavior worth preserving for debugging.");
      w("");
    }

    w("---");
    w("");
  }

  return lines.join("\n");
}

// ============================================================================
// Student journey summary
// ============================================================================

/**
 * Build a short human-readable phrase describing how the student reached their
 * result for a single prompt.
 *
 * Uses: number of replay turns, presence of uncertain/misconception states,
 * step progression pattern, and final outcome.
 */
function buildStudentJourneySummary(analysis: PromptAnalysis): string {
  if (analysis.placeholderSkipped) return "Replay unavailable";
  if (!analysis.replayResult) return "No replay data";

  const { turns, summaryStatus, satisfiedCount, totalRequired } = analysis.replayResult;
  if (turns.length === 0) return "No student turns";

  const states = turns.map(t => t.state);
  const lastTurn = turns[turns.length - 1];
  const reachedMastery = summaryStatus === "mastery"
    || lastTurn.wrapAction === "wrap_mastery";

  const hasUncertain = states.includes("uncertain");
  const hasMisconception = states.includes("misconception");
  const hasWrong = states.includes("wrong");
  const misconceptionCount = states.filter(s => s === "misconception").length;

  // Distinct step targets that were probed (tracks step progression)
  const stepsProbed = new Set(
    turns.filter(t => t.target).map(t => t.target!),
  );

  // 1-turn mastery
  if (turns.length === 1 && reachedMastery) {
    return "Solved independently";
  }

  // Quick success (2-3 turns, no struggles)
  if (turns.length <= 3 && reachedMastery && !hasMisconception && !hasWrong) {
    if (hasUncertain) return "Needed a nudge, then succeeded";
    return "Solved with minimal guidance";
  }

  // Reached mastery after more work
  if (reachedMastery) {
    if (hasUncertain && !hasMisconception && !hasWrong) {
      return "Needed help to get started, then succeeded";
    }
    if (hasMisconception && misconceptionCount === 1) {
      return "Overcame a misconception, then succeeded";
    }
    if (hasMisconception && misconceptionCount > 1) {
      return "Multiple misconceptions, but reached mastery";
    }
    if (hasWrong && !hasMisconception) {
      return "Wrong answer initially, then self-corrected";
    }
    // Generic mastery with effort
    return "Worked through steps to reach mastery";
  }

  // Did not reach mastery
  const partialCount = states.filter(s => s === "partial").length;
  const progress = totalRequired > 0
    ? satisfiedCount / totalRequired
    : 0;

  if (progress === 0) {
    if (hasUncertain && turns.length >= 3) return "Struggled throughout, no progress";
    if (hasMisconception) return "Persistent misconception, no progress";
    return "Did not make progress";
  }

  // Some progress but didn't finish
  if (hasMisconception) {
    // Identify which step kinds had misconceptions
    const misconceptionTargets = turns
      .filter(t => t.state === "misconception" && t.target)
      .map(t => t.target!);
    const uniqueTargets = [...new Set(misconceptionTargets)];
    if (uniqueTargets.length === 1) {
      // Readable step label from target ID
      const stepLabel = uniqueTargets[0].replace(/_/g, " ");
      return `Struggled with ${stepLabel}`;
    }
    return "Struggled with multiple steps";
  }

  if (partialCount > 0 && progress > 0) {
    if (progress >= 0.5) return "Multiple attempts, improving";
    return "Made some progress with help";
  }

  return "Incomplete attempt";
}

// ============================================================================
// Helpers
// ============================================================================

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "…";
}

function escMd(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

// ============================================================================
// Session loading
// ============================================================================

function loadSession(filePath: string): SessionFile {
  const raw = fs.readFileSync(filePath, "utf-8");
  const session: SessionFile = JSON.parse(raw);
  if (!session.lessonId) {
    fail(`Session file is missing lessonId: ${filePath}`);
  }
  return session;
}

function fail(message: string): never {
  console.error(`\x1b[31mError:\x1b[0m ${message}`);
  process.exit(1);
}

// ============================================================================
// CLI
// ============================================================================

interface CliArgs {
  fromSession: string;
  promptId: string | null;
  outputPath: string | null;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`Usage:
  npx ts-node src/domain/generateSessionReview.ts --from-session <session.json> [options]

Options:
  --from-session <path>  Session JSON file to review (required)
  --prompt <id>          Only review a specific prompt ID
  -o <path>              Output file path (default: stdout)

Examples:
  npx ts-node src/domain/generateSessionReview.ts --from-session data/sessions/abc123.json
  npx ts-node src/domain/generateSessionReview.ts --from-session session.json --prompt q1 -o review.md`);
    process.exit(0);
  }

  let fromSession: string | null = null;
  let promptId: string | null = null;
  let outputPath: string | null = null;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--from-session":
        fromSession = args[++i];
        break;
      case "--prompt":
        promptId = args[++i];
        break;
      case "-o":
        outputPath = args[++i];
        break;
    }
  }

  if (!fromSession) {
    fail("--from-session <path> is required.\nRun with --help for usage.");
  }

  return { fromSession, promptId, outputPath };
}

function main(): void {
  const cli = parseArgs();

  const session = loadSession(cli.fromSession);
  const lesson = loadLessonById(session.lessonId);
  if (!lesson) {
    fail(`Lesson "${session.lessonId}" not found.`);
  }

  const review = buildSessionReview(session, lesson, cli.promptId ?? undefined);
  const md = renderSessionReview(review);

  if (cli.outputPath) {
    const dir = path.dirname(cli.outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(cli.outputPath, md, "utf-8");
    console.log(`Review written to ${cli.outputPath}`);
  } else {
    process.stdout.write(md);
  }
}

// Exports for testing
export {
  buildSessionReview,
  analyzePrompt,
  buildStudentJourneySummary,
  detectMode,
  usesDeterministicPipeline,
  isPlaceholderTranscript,
  compareReplayToLive,
};
export type {
  SessionReview,
  PromptAnalysis,
  SessionFile,
  TranscriptTurn,
  DetectedMode,
  TranscriptSource,
  ReplayFidelity,
  LiveOutcome,
};

if (require.main === module) {
  main();
}
