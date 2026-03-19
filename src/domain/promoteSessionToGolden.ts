#!/usr/bin/env npx ts-node
/**
 * Golden-fixture promotion tool.
 *
 * Takes a saved session JSON and promotes qualifying prompt transcripts
 * into fixtures/golden/ with full metadata, audit expectations, and
 * duplicate detection.
 *
 * Usage:
 *   npx ts-node src/domain/promoteSessionToGolden.ts --from-session data/sessions/abc.json
 *   npx ts-node src/domain/promoteSessionToGolden.ts --from-session s.json --prompt q1
 *   npx ts-node src/domain/promoteSessionToGolden.ts --from-session s.json --dest fixtures/golden/
 *   npx ts-node src/domain/promoteSessionToGolden.ts --from-session s.json --dry-run
 *   npx ts-node src/domain/promoteSessionToGolden.ts --from-session s.json --force
 *   npx ts-node src/domain/promoteSessionToGolden.ts --from-session s.json --markdown report.md
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
} from "./transcriptReplay";
import { isPlaceholderTranscript } from "./generateSessionReview";
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
    }>;
  };
}

type DetectedMode = "math" | "explanation" | "unsupported";

type SkipReason =
  | "unsupported_mode"
  | "too_few_turns"
  | "failed_audit"
  | "duplicate_found"
  | "placeholder_transcript";

type PromotionOutcome =
  | { status: "written"; filePath: string; reason: string }
  | { status: "would_write"; filePath: string; reason: string }
  | { status: "skipped"; reason: string; skipReason: SkipReason }
  | { status: "forced"; filePath: string; reason: string };

interface PromotionResult {
  promptId: string;
  mode: DetectedMode;
  verdict: "PASS" | "WARN" | "FAIL" | null;
  studentTurns: number;
  outcome: PromotionOutcome;
}

interface PromotionSummary {
  sessionId: string;
  lessonId: string;
  results: PromotionResult[];
  counts: {
    written: number;
    skipped: number;
    duplicate: number;
    unsupported: number;
    failedAudit: number;
  };
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

// ============================================================================
// Fixture building
// ============================================================================

function buildGoldenFixture(
  prompt: Prompt,
  transcript: TranscriptTurn[],
  lesson: Lesson,
  mode: "math" | "explanation",
  verdict: "PASS" | "WARN" | "FAIL",
  issueCodes: string[],
  id: string,
  tags: string[],
  notes: string,
): object {
  const turns = transcript.map(t => ({ role: t.role, message: t.message }));
  const metadata = {
    id,
    tags,
    expectedVerdict: verdict,
    expectedIssueCodes: issueCodes,
    notes,
  };

  if (mode === "math") {
    const math = prompt.mathProblem!;
    const steps = prompt.assessment!.reasoningSteps!;
    return {
      ...metadata,
      mode: "math",
      name: `${lesson.title} — ${prompt.id}: ${math.expression}`,
      mathProblem: {
        skill: math.skill,
        a: math.a,
        b: math.b,
        expression: math.expression,
        correctAnswer: math.correctAnswer,
        requiresRegrouping: math.requiresRegrouping,
        expectedStrategyTags: math.expectedStrategyTags,
        ...(math.commonWrongAnswers?.length ? { commonWrongAnswers: math.commonWrongAnswers } : {}),
      },
      reasoningSteps: steps.map(s => ({
        id: s.id,
        label: s.label,
        expectedStatements: s.expectedStatements,
        probe: s.probe,
        kind: s.kind,
      })),
      transcript: turns,
    };
  }

  const evidence = prompt.assessment!.requiredEvidence!;
  const facts = prompt.assessment!.referenceFacts!;
  const criteria = prompt.assessment?.successCriteria ?? [];
  return {
    ...metadata,
    mode: "explanation",
    name: `${lesson.title} — ${prompt.id}`,
    promptInput: prompt.input,
    requiredEvidence: {
      minEntities: evidence.minEntities,
      entityLabel: evidence.entityLabel,
      attributeLabel: evidence.attributeLabel,
      ...(evidence.minAttributeTypes != null ? { minAttributeTypes: evidence.minAttributeTypes } : {}),
      ...(evidence.requirePairing != null ? { requirePairing: evidence.requirePairing } : {}),
    },
    referenceFacts: facts,
    successCriteria: criteria,
    ...(prompt.hints?.length ? { hints: prompt.hints } : {}),
    transcript: turns,
  };
}

function buildReplayFixture(
  prompt: Prompt,
  transcript: TranscriptTurn[],
  mode: "math" | "explanation",
): Fixture {
  const turns = transcript.map(t => ({ role: t.role, message: t.message }));
  if (mode === "math") {
    return {
      mode: "math",
      mathProblem: prompt.mathProblem!,
      reasoningSteps: prompt.assessment!.reasoningSteps!,
      transcript: turns,
    } as MathFixture;
  }
  return {
    mode: "explanation",
    promptInput: prompt.input,
    requiredEvidence: prompt.assessment!.requiredEvidence!,
    referenceFacts: prompt.assessment!.referenceFacts!,
    successCriteria: prompt.assessment?.successCriteria ?? [],
    hints: prompt.hints,
    transcript: turns,
  } as ExplanationFixture;
}

// ============================================================================
// Category slug inference
// ============================================================================

export function inferCategorySlug(
  mode: DetectedMode,
  verdict: "PASS" | "WARN" | "FAIL",
  result: ReplayResult,
  issues: AuditIssue[],
): string {
  if (verdict === "FAIL") return "regression";
  if (verdict === "WARN") return "edge-case";

  // Infer from transcript behavior
  const turns = result.turns;
  const lastTurn = turns[turns.length - 1];
  const wrapAction = lastTurn?.wrapAction ?? "";

  if (wrapAction === "wrap_mastery" || wrapAction === "wrap_success") {
    // Check if there were errors or corrections along the way
    const hasErrors = turns.some(t =>
      t.state === "factual_error" || t.moveType === "FACTUAL_CORRECTION"
      || t.moveType === "STEP_MISCONCEPTION_REDIRECT",
    );
    if (hasErrors) return "error-correction";

    const hasUncertainty = turns.some(t =>
      t.state === "uncertain" || t.moveType === "STEP_PROBE_SIMPLER"
      || t.moveType === "ENCOURAGEMENT_PROBE",
    );
    if (hasUncertainty) return "uncertainty-recovery";

    const hasHint = turns.some(t =>
      t.moveType === "HINT" || t.moveType === "STEP_HINT",
    );
    if (hasHint) return "hint-to-mastery";

    return "clean-mastery";
  }

  if (wrapAction === "wrap_support" || wrapAction === "wrap_needs_support") {
    return "needs-support";
  }

  // Still probing at end
  if (result.satisfiedCount === 0) return "stall";
  return "partial";
}

// ============================================================================
// Filename generation
// ============================================================================

export function generateFilename(
  lessonId: string,
  promptId: string,
  categorySlug: string,
): string {
  const sanitize = (s: string) =>
    s.toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 30);

  return `${sanitize(lessonId)}_${sanitize(promptId)}_${categorySlug}.json`;
}

// ============================================================================
// Duplicate detection
// ============================================================================

interface ExistingFixtureSummary {
  filePath: string;
  id?: string;
  mode?: string;
  transcriptLength: number;
  firstStudentMessage: string | null;
  lastStudentMessage: string | null;
}

function loadExistingFixtures(destDir: string): ExistingFixtureSummary[] {
  const summaries: ExistingFixtureSummary[] = [];
  if (!fs.existsSync(destDir)) return summaries;

  function scanDir(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(full);
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        try {
          const raw = JSON.parse(fs.readFileSync(full, "utf-8"));
          const transcript: Array<{ role: string; message: string }> = raw.transcript ?? [];
          const studentMsgs = transcript.filter(t => t.role === "student");
          summaries.push({
            filePath: full,
            id: raw.id,
            mode: raw.mode,
            transcriptLength: transcript.length,
            firstStudentMessage: studentMsgs[0]?.message ?? null,
            lastStudentMessage: studentMsgs[studentMsgs.length - 1]?.message ?? null,
          });
        } catch {
          // Skip unparseable files
        }
      }
    }
  }

  scanDir(destDir);
  return summaries;
}

export function findDuplicate(
  lessonId: string,
  promptId: string,
  transcript: TranscriptTurn[],
  existing: ExistingFixtureSummary[],
): ExistingFixtureSummary | null {
  const studentMsgs = transcript.filter(t => t.role === "student");
  const firstMsg = studentMsgs[0]?.message ?? null;
  const lastMsg = studentMsgs[studentMsgs.length - 1]?.message ?? null;

  // Check for ID match (lessonId_promptId pattern, normalized)
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const idPrefix = normalize(`${lessonId}_${promptId}`);
  for (const ex of existing) {
    if (ex.id && normalize(ex.id).startsWith(idPrefix)) return ex;
  }

  // Check for highly similar transcript
  for (const ex of existing) {
    if (
      ex.transcriptLength === transcript.length &&
      ex.firstStudentMessage === firstMsg &&
      ex.lastStudentMessage === lastMsg
    ) {
      return ex;
    }
  }

  return null;
}

// ============================================================================
// Core promotion logic
// ============================================================================

export interface PromotionOptions {
  force: boolean;
  dryRun: boolean;
  destDir: string;
}

export function evaluatePromotion(
  prompt: Prompt,
  transcript: TranscriptTurn[],
  lesson: Lesson,
  existing: ExistingFixtureSummary[],
  options: PromotionOptions,
): PromotionResult {
  const mode = detectMode(prompt);
  const studentTurns = transcript.filter(t => t.role === "student").length;

  // Skip placeholder transcripts (video sessions without real speech)
  if (isPlaceholderTranscript(transcript)) {
    return {
      promptId: prompt.id,
      mode,
      verdict: null,
      studentTurns,
      outcome: {
        status: "skipped",
        reason: `Transcript is a video placeholder — no real speech captured`,
        skipReason: "placeholder_transcript",
      },
    };
  }

  // Skip unsupported
  if (mode === "unsupported") {
    return {
      promptId: prompt.id,
      mode,
      verdict: null,
      studentTurns,
      outcome: {
        status: "skipped",
        reason: `Prompt "${prompt.id}" lacks math or explanation metadata`,
        skipReason: "unsupported_mode",
      },
    };
  }

  // Skip too few turns
  if (studentTurns < 2) {
    return {
      promptId: prompt.id,
      mode,
      verdict: null,
      studentTurns,
      outcome: {
        status: "skipped",
        reason: `Only ${studentTurns} student turn(s) — need at least 2`,
        skipReason: "too_few_turns",
      },
    };
  }

  // Run replay + audit
  const fixture = buildReplayFixture(prompt, transcript, mode);
  const result = runFixture(fixture);
  const issues = auditResult(result);

  const high = issues.filter(i => i.severity === "high").length;
  const med = issues.filter(i => i.severity === "medium").length;
  const verdict: "PASS" | "WARN" | "FAIL" = high > 0 ? "FAIL" : med > 0 ? "WARN" : "PASS";

  // Skip WARN/FAIL unless forced
  if ((verdict === "WARN" || verdict === "FAIL") && !options.force) {
    return {
      promptId: prompt.id,
      mode,
      verdict,
      studentTurns,
      outcome: {
        status: "skipped",
        reason: `Verdict is ${verdict} (${issues.map(i => i.code).join(", ")}). Use --force to promote anyway`,
        skipReason: "failed_audit",
      },
    };
  }

  // Check for duplicates
  const dup = findDuplicate(lesson.id, prompt.id, transcript, existing);
  if (dup && !options.force) {
    return {
      promptId: prompt.id,
      mode,
      verdict,
      studentTurns,
      outcome: {
        status: "skipped",
        reason: `Similar existing fixture found: ${path.basename(dup.filePath)}`,
        skipReason: "duplicate_found",
      },
    };
  }

  // Build the golden fixture
  const categorySlug = inferCategorySlug(mode, verdict, result, issues);
  const filename = generateFilename(lesson.id, prompt.id, categorySlug);
  const id = filename.replace(/\.json$/, "");
  const tags = ["regression", categorySlug];
  const issueCodes = issues.map(i => i.code);

  const notes = verdict === "PASS"
    ? `Clean ${mode} session: ${studentTurns} student turns, ${categorySlug}.`
    : `${verdict} session (${issueCodes.join(", ")}): ${studentTurns} student turns.`;

  const goldenFixture = buildGoldenFixture(
    prompt, transcript, lesson, mode, verdict, issueCodes, id, tags, notes,
  );

  const subDir = mode === "math" ? "math" : "explanation";
  const filePath = path.join(options.destDir, subDir, filename);

  // Dry-run: don't write
  if (options.dryRun) {
    return {
      promptId: prompt.id,
      mode,
      verdict,
      studentTurns,
      outcome: {
        status: "would_write",
        filePath,
        reason: dup
          ? `Would overwrite duplicate (--force): ${path.basename(dup.filePath)}`
          : `Would write ${categorySlug} fixture`,
      },
    };
  }

  // Write the fixture
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(goldenFixture, null, 2) + "\n", "utf-8");

  return {
    promptId: prompt.id,
    mode,
    verdict,
    studentTurns,
    outcome: {
      status: dup ? "forced" : "written",
      filePath,
      reason: dup
        ? `Overwrote duplicate (--force): ${path.basename(dup.filePath)}`
        : `Promoted as ${categorySlug} fixture`,
    },
  };
}

// ============================================================================
// Batch promotion
// ============================================================================

export function promoteSession(
  session: SessionFile,
  lesson: Lesson,
  options: PromotionOptions,
  promptFilter?: string,
): PromotionSummary {
  const responses = session.submission?.responses ?? [];
  const filtered = promptFilter
    ? responses.filter(r => r.promptId === promptFilter)
    : responses;

  const existing = loadExistingFixtures(options.destDir);
  const results: PromotionResult[] = [];

  for (const resp of filtered) {
    const prompt = lesson.prompts.find(p => p.id === resp.promptId);
    if (!prompt) continue;

    const transcript = resp.conversationTurns ?? [];
    if (transcript.length === 0) continue;

    results.push(evaluatePromotion(prompt, transcript, lesson, existing, options));
  }

  const counts = {
    written: results.filter(r => r.outcome.status === "written" || r.outcome.status === "forced" || r.outcome.status === "would_write").length,
    skipped: results.filter(r => r.outcome.status === "skipped").length,
    duplicate: results.filter(r => r.outcome.status === "skipped" && r.outcome.skipReason === "duplicate_found").length,
    unsupported: results.filter(r => r.outcome.status === "skipped" && r.outcome.skipReason === "unsupported_mode").length,
    failedAudit: results.filter(r => r.outcome.status === "skipped" && r.outcome.skipReason === "failed_audit").length,
  };

  return { sessionId: session.id, lessonId: session.lessonId, results, counts };
}

// ============================================================================
// Markdown report
// ============================================================================

export function renderPromotionReport(summary: PromotionSummary): string {
  const lines: string[] = [];
  const w = (s: string) => lines.push(s);

  w("# Promotion Report");
  w("");
  w("| Field | Value |");
  w("| --- | --- |");
  w(`| Session | ${summary.sessionId} |`);
  w(`| Lesson | ${summary.lessonId} |`);
  w(`| Prompts evaluated | ${summary.results.length} |`);
  w(`| Written | ${summary.counts.written} |`);
  w(`| Skipped | ${summary.counts.skipped} |`);
  w(`| Duplicate | ${summary.counts.duplicate} |`);
  w(`| Unsupported | ${summary.counts.unsupported} |`);
  w(`| Failed audit | ${summary.counts.failedAudit} |`);
  w("");

  if (summary.results.length === 0) {
    w("*No prompts to evaluate.*");
    return lines.join("\n");
  }

  w("## Results");
  w("");
  w("| Prompt | Mode | Verdict | Turns | Status | Reason |");
  w("| --- | --- | --- | --- | --- | --- |");
  for (const r of summary.results) {
    const v = r.verdict ?? "—";
    const status = r.outcome.status;
    const reason = r.outcome.reason.replace(/\|/g, "\\|");
    w(`| ${r.promptId} | ${r.mode} | ${v} | ${r.studentTurns} | ${status} | ${reason} |`);
  }
  w("");

  return lines.join("\n");
}

// ============================================================================
// CLI
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

interface CliArgs {
  fromSession: string;
  promptId: string | null;
  destDir: string;
  force: boolean;
  dryRun: boolean;
  markdownPath: string | null;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`Usage:
  npx ts-node src/domain/promoteSessionToGolden.ts --from-session <session.json> [options]

Options:
  --from-session <path>  Session JSON file (required)
  --prompt <id>          Only promote a specific prompt ID
  --dest <dir>           Destination directory (default: fixtures/golden/)
  --force                Promote even on WARN/FAIL verdict or duplicate
  --dry-run              Print what would be written without writing
  --markdown <path>      Write a promotion report markdown file

Examples:
  npx ts-node src/domain/promoteSessionToGolden.ts --from-session data/sessions/abc.json
  npx ts-node src/domain/promoteSessionToGolden.ts --from-session s.json --dry-run
  npx ts-node src/domain/promoteSessionToGolden.ts --from-session s.json --force --prompt q1
  npx ts-node src/domain/promoteSessionToGolden.ts --from-session s.json --markdown report.md`);
    process.exit(0);
  }

  let fromSession: string | null = null;
  let promptId: string | null = null;
  let destDir = "fixtures/golden/";
  let force = false;
  let dryRun = false;
  let markdownPath: string | null = null;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--from-session": fromSession = args[++i]; break;
      case "--prompt": promptId = args[++i]; break;
      case "--dest": destDir = args[++i]; break;
      case "--force": force = true; break;
      case "--dry-run": dryRun = true; break;
      case "--markdown": markdownPath = args[++i]; break;
    }
  }

  if (!fromSession) {
    fail("--from-session <path> is required.\nRun with --help for usage.");
  }

  return { fromSession, promptId, destDir, force, dryRun, markdownPath };
}

function main(): void {
  const cli = parseArgs();

  const session = loadSession(cli.fromSession);
  const lesson = loadLessonById(session.lessonId);
  if (!lesson) {
    fail(`Lesson "${session.lessonId}" not found.`);
  }

  const summary = promoteSession(
    session,
    lesson,
    { force: cli.force, dryRun: cli.dryRun, destDir: cli.destDir },
    cli.promptId ?? undefined,
  );

  // Print summary to terminal
  const DIM = "\x1b[2m";
  const GREEN = "\x1b[32m";
  const YELLOW = "\x1b[33m";
  const RED = "\x1b[31m";
  const RESET = "\x1b[0m";

  console.log();
  for (const r of summary.results) {
    const icon =
      r.outcome.status === "written" || r.outcome.status === "forced" ? `${GREEN}WRITE${RESET}` :
      r.outcome.status === "would_write" ? `${YELLOW}DRY${RESET}` :
      `${DIM}SKIP${RESET}`;
    console.log(`  ${icon}  ${r.promptId} ${DIM}(${r.mode}, ${r.verdict ?? "—"}, ${r.studentTurns} turns)${RESET}`);
    console.log(`        ${r.outcome.reason}`);
    if ("filePath" in r.outcome) {
      console.log(`        → ${r.outcome.filePath}`);
    }
  }

  console.log();
  console.log(`  Written: ${summary.counts.written}  Skipped: ${summary.counts.skipped}  Duplicate: ${summary.counts.duplicate}  Unsupported: ${summary.counts.unsupported}  Failed audit: ${summary.counts.failedAudit}`);
  console.log();

  if (cli.markdownPath) {
    const md = renderPromotionReport(summary);
    const dir = path.dirname(cli.markdownPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(cli.markdownPath, md, "utf-8");
    console.log(`  Markdown report written to ${cli.markdownPath}`);
    console.log();
  }
}

if (require.main === module) {
  main();
}
