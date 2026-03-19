#!/usr/bin/env npx ts-node
/**
 * Lesson stress tester.
 *
 * Simulates a variety of student behaviors against a lesson prompt and
 * runs each through the coaching replay + audit pipeline. Helps developers
 * verify that a prompt behaves correctly across edge cases before students
 * see it.
 *
 * Usage:
 *   npx ts-node src/tools/lessonStressTest.ts <lessonId> <promptId>
 *   npx ts-node src/tools/lessonStressTest.ts <lessonId> <promptId> --verbose
 *   npx ts-node src/tools/lessonStressTest.ts <lessonId> <promptId> --markdown report.md
 *
 * Dev-only utility — not imported by production code.
 */

import * as fs from "fs";
import * as path from "path";
import { loadLessonById } from "../loaders/lessonLoader";
import {
  runFixture,
  auditResult,
  renderMarkdownReport,
  type Fixture,
  type ExplanationFixture,
  type MathFixture,
  type ReplayResult,
  type AuditIssue,
} from "../domain/transcriptReplay";
import type { Prompt } from "../domain/prompt";
import type { Lesson } from "../domain/lesson";

// ============================================================================
// Types
// ============================================================================

export type PromptMode = "math" | "explanation";

interface TranscriptTurn {
  role: "coach" | "student";
  message: string;
}

export interface SimulatedCase {
  name: string;
  description: string;
  studentTurns: string[];
}

export interface CaseResult {
  name: string;
  description: string;
  verdict: "PASS" | "WARN" | "FAIL";
  issueCodes: string[];
  turnCount: number;
  satisfiedCount: number;
  totalRequired: number;
  replayResult: ReplayResult;
  issues: AuditIssue[];
}

export interface StressTestSummary {
  lessonId: string;
  lessonTitle: string;
  promptId: string;
  promptText: string;
  mode: PromptMode;
  cases: CaseResult[];
  counts: { pass: number; warn: number; fail: number };
}

// ============================================================================
// Mode detection
// ============================================================================

export function detectPromptMode(prompt: Prompt): PromptMode {
  const hasMath = !!prompt.mathProblem && !!prompt.assessment?.reasoningSteps?.length;
  const hasExplanation = !!prompt.assessment?.requiredEvidence && !!prompt.assessment?.referenceFacts;

  if (hasMath) return "math";
  if (hasExplanation) return "explanation";

  throw new Error(
    `Prompt "${prompt.id}" has neither math (mathProblem + reasoningSteps) ` +
    `nor explanation (requiredEvidence + referenceFacts) metadata. ` +
    `Cannot stress test unsupported prompts.`,
  );
}

// ============================================================================
// Math case generation
// ============================================================================

export function buildMathCases(prompt: Prompt): SimulatedCase[] {
  const steps = prompt.assessment!.reasoningSteps!;
  const math = prompt.mathProblem!;

  // perfect_reasoning: student answers each step correctly in order
  const perfectTurns = steps.map(s => s.expectedStatements[0]);

  // wrong_then_correct: wrong answer on first step, then correct all
  const wrongFirst = `${math.a + 99}`;
  const wrongThenCorrectTurns = [wrongFirst, ...steps.map(s => s.expectedStatements[0])];

  // uncertainty_escalation: "I don't know" twice
  const uncertaintyTurns = ["I don't know", "I still don't know"];

  // stall_no_progress: vague answers repeated (short)
  const stallTurns = ["I guess maybe", "not sure", "um I think so"];

  // long_stall: 6 turns of vague answers — exercises full escalation ladder
  const longStallTurns = [
    "I don't know",
    "I'm not sure",
    "um maybe",
    "I still don't know",
    "I'm confused",
    "I really don't know",
  ];

  // misconception_subtraction: subtract instead of add
  const misconceptionAnswer = Math.abs(math.a - (math.b ?? 0));
  const misconceptionTurns = [`${misconceptionAnswer}`, `I subtracted: ${math.a} - ${math.b ?? 0} = ${misconceptionAnswer}`];

  // hint_request: ask for a hint then solve
  const hintTurns = ["can you give me a hint?", ...steps.map(s => s.expectedStatements[0])];

  return [
    {
      name: "perfect_reasoning",
      description: "Student answers each step correctly in order",
      studentTurns: perfectTurns,
    },
    {
      name: "wrong_then_correct",
      description: "Student gives wrong answer first, then corrects through all steps",
      studentTurns: wrongThenCorrectTurns,
    },
    {
      name: "uncertainty_escalation",
      description: "Student says 'I don't know' repeatedly",
      studentTurns: uncertaintyTurns,
    },
    {
      name: "stall_no_progress",
      description: "Student gives vague, non-substantive answers",
      studentTurns: stallTurns,
    },
    {
      name: "misconception_subtraction",
      description: "Student subtracts instead of adding",
      studentTurns: misconceptionTurns,
    },
    {
      name: "hint_request",
      description: "Student asks for a hint, then solves correctly",
      studentTurns: hintTurns,
    },
    {
      name: "long_stall",
      description: "Student gives 6 vague/uncertain answers to exercise full escalation ladder",
      studentTurns: longStallTurns,
    },
  ];
}

// ============================================================================
// Explanation case generation
// ============================================================================

export function buildExplanationCases(prompt: Prompt): SimulatedCase[] {
  const facts = prompt.assessment!.referenceFacts!;
  const entities = Object.keys(facts);

  // mastery_fast: immediately provide all required evidence
  const masteryTurns = entities
    .slice(0, prompt.assessment!.requiredEvidence!.minEntities)
    .map(entity => {
      const attrs = facts[entity];
      return `${entity} is made of ${attrs.join(" and ")}`;
    });

  // claim_only_stall: vague claims with no specific evidence
  const claimTurns = [
    "I think there are different kinds",
    "They are all different",
    "Some are one thing and some are another",
  ];

  // factual_error_then_correction: incorrect claim, then fix
  const firstEntity = entities[0];
  const wrongAttr = "chocolate"; // obviously wrong
  const correctAttrs = facts[firstEntity];
  const secondEntity = entities.length > 1 ? entities[1] : entities[0];
  const secondAttrs = facts[secondEntity];
  const errorTurns = [
    `${firstEntity} is made of ${wrongAttr}`,
    `Actually, ${firstEntity} is made of ${correctAttrs[0]}`,
    `${secondEntity} is made of ${secondAttrs[0]}`,
  ];

  // uncertainty_recovery: unsure at first, then answers
  const uncertaintyTurns = [
    "I'm not sure about this",
    ...masteryTurns,
  ];

  // meta_question: asks about the question itself
  const metaTurns = [
    "What do you mean by that?",
    ...masteryTurns,
  ];

  return [
    {
      name: "mastery_fast",
      description: "Student immediately provides all required evidence",
      studentTurns: masteryTurns,
    },
    {
      name: "claim_only_stall",
      description: "Student gives vague claims with no specific evidence",
      studentTurns: claimTurns,
    },
    {
      name: "factual_error_then_correction",
      description: "Student makes incorrect claim and later corrects it",
      studentTurns: errorTurns,
    },
    {
      name: "uncertainty_recovery",
      description: "Student initially unsure, then provides evidence",
      studentTurns: uncertaintyTurns,
    },
    {
      name: "meta_question",
      description: "Student asks for clarification before answering",
      studentTurns: metaTurns,
    },
    {
      name: "long_stall",
      description: "Student gives 6 vague/uncertain answers to exercise full escalation ladder",
      studentTurns: [
        "I don't know",
        "I'm not sure",
        "um maybe",
        "I still don't know",
        "I'm confused",
        "I really don't know",
      ],
    },
  ];
}

// ============================================================================
// Build cases for any prompt
// ============================================================================

export function buildCases(prompt: Prompt, mode: PromptMode): SimulatedCase[] {
  return mode === "math" ? buildMathCases(prompt) : buildExplanationCases(prompt);
}

// ============================================================================
// Construct transcript fixture from simulated student turns
// ============================================================================

export function buildTranscript(
  studentTurns: string[],
  prompt: Prompt,
  mode: PromptMode,
): TranscriptTurn[] {
  // Interleave: coach question → student answer → coach response → student answer …
  const transcript: TranscriptTurn[] = [];

  // First coach turn is the prompt question
  transcript.push({ role: "coach", message: prompt.input });

  for (let i = 0; i < studentTurns.length; i++) {
    transcript.push({ role: "student", message: studentTurns[i] });

    // Run replay up to this point to generate the coach response
    const fixture = buildFixtureFromTranscript(transcript, prompt, mode);
    const result = runFixture(fixture);
    const lastTurn = result.turns[result.turns.length - 1];

    // Add coach response if there are more student turns coming
    if (i < studentTurns.length - 1 && lastTurn?.responseText) {
      transcript.push({ role: "coach", message: lastTurn.responseText });
    }
  }

  return transcript;
}

export function buildFixtureFromTranscript(
  transcript: TranscriptTurn[],
  prompt: Prompt,
  mode: PromptMode,
): Fixture {
  if (mode === "math") {
    return {
      mode: "math",
      name: `stress-test: ${prompt.mathProblem!.expression}`,
      mathProblem: prompt.mathProblem!,
      reasoningSteps: prompt.assessment!.reasoningSteps!,
      transcript,
    } as MathFixture;
  }

  return {
    mode: "explanation",
    name: `stress-test: ${prompt.id}`,
    promptInput: prompt.input,
    requiredEvidence: prompt.assessment!.requiredEvidence!,
    referenceFacts: prompt.assessment!.referenceFacts!,
    successCriteria: prompt.assessment?.successCriteria ?? [],
    hints: prompt.hints,
    transcript,
  } as ExplanationFixture;
}

// ============================================================================
// Run a single case
// ============================================================================

export function runCase(
  simCase: SimulatedCase,
  prompt: Prompt,
  mode: PromptMode,
): CaseResult {
  const transcript = buildTranscript(simCase.studentTurns, prompt, mode);
  const fixture = buildFixtureFromTranscript(transcript, prompt, mode);
  const result = runFixture(fixture);
  const issues = auditResult(result);

  const high = issues.filter(i => i.severity === "high").length;
  const med = issues.filter(i => i.severity === "medium").length;
  const verdict: "PASS" | "WARN" | "FAIL" = high > 0 ? "FAIL" : med > 0 ? "WARN" : "PASS";

  return {
    name: simCase.name,
    description: simCase.description,
    verdict,
    issueCodes: issues.map(i => i.code),
    turnCount: result.turns.length,
    satisfiedCount: result.satisfiedCount,
    totalRequired: result.totalRequired,
    replayResult: result,
    issues,
  };
}

// ============================================================================
// Run all cases for a prompt
// ============================================================================

export function runStressTest(
  lesson: Lesson,
  promptId: string,
): StressTestSummary {
  const prompt = lesson.prompts.find(p => p.id === promptId);
  if (!prompt) {
    throw new Error(`Prompt "${promptId}" not found in lesson "${lesson.id}"`);
  }

  const mode = detectPromptMode(prompt);
  const simCases = buildCases(prompt, mode);
  const cases: CaseResult[] = [];

  for (const sc of simCases) {
    cases.push(runCase(sc, prompt, mode));
  }

  const counts = {
    pass: cases.filter(c => c.verdict === "PASS").length,
    warn: cases.filter(c => c.verdict === "WARN").length,
    fail: cases.filter(c => c.verdict === "FAIL").length,
  };

  return {
    lessonId: lesson.id,
    lessonTitle: lesson.title,
    promptId: prompt.id,
    promptText: prompt.input,
    mode,
    cases,
    counts,
  };
}

// ============================================================================
// Markdown report
// ============================================================================

export function renderStressTestMarkdown(summary: StressTestSummary): string {
  const lines: string[] = [];
  const w = (s: string) => lines.push(s);

  w("# Lesson Stress Test Report");
  w("");

  // Lesson metadata
  w("## Lesson Metadata");
  w("");
  w("| Field | Value |");
  w("| --- | --- |");
  w(`| Lesson ID | ${summary.lessonId} |`);
  w(`| Lesson title | ${summary.lessonTitle} |`);
  w(`| Prompt ID | ${summary.promptId} |`);
  w(`| Prompt text | ${escMd(summary.promptText)} |`);
  w(`| Mode | ${summary.mode} |`);
  w(`| Cases run | ${summary.cases.length} |`);
  w("");

  // Case overview table
  w("## Case Overview");
  w("");
  w("| Case | Verdict | Issues | Turns | Satisfied |");
  w("| --- | --- | --- | --- | --- |");
  for (const c of summary.cases) {
    const issueStr = c.issueCodes.length > 0 ? c.issueCodes.join(", ") : "—";
    w(`| ${c.name} | **${c.verdict}** | ${issueStr} | ${c.turnCount} | ${c.satisfiedCount}/${c.totalRequired} |`);
  }
  w("");

  // Per-case replay detail
  for (const c of summary.cases) {
    w(`## Case: ${c.name}`);
    w("");
    w(`*${escMd(c.description)}*`);
    w("");
    w("| Field | Value |");
    w("| --- | --- |");
    w(`| Verdict | **${c.verdict}** |`);
    w(`| Turns | ${c.turnCount} |`);
    w(`| Satisfied | ${c.satisfiedCount}/${c.totalRequired} |`);
    w(`| Summary status | ${c.replayResult.summaryStatus} |`);
    w("");

    if (c.issues.length > 0) {
      w("### Issues");
      w("");
      w("| Severity | Code | Turn | Detail |");
      w("| --- | --- | --- | --- |");
      for (const issue of c.issues) {
        const turnCol = issue.turn != null ? String(issue.turn) : "—";
        w(`| ${issue.severity} | ${issue.code} | ${turnCol} | ${escMd(issue.detail)} |`);
      }
      w("");
    }

    // Turn table
    w("### Turns");
    w("");
    w("| # | Student utterance | State | Move | Strategy | Escalation | Words | Wrap |");
    w("| --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const t of c.replayResult.turns) {
      const utterance = t.studentMessage.length > 50
        ? t.studentMessage.slice(0, 49) + "…"
        : t.studentMessage;
      const strategy = t.strategyLevel ?? "—";
      const escalation = t.escalationReason ?? "—";
      w(`| ${t.turnNum} | ${escMd(utterance)} | ${t.state} | ${t.moveType} | ${strategy} | ${escalation} | ${t.words} | ${t.wrapAction} |`);
    }
    w("");
  }

  // Aggregate summary
  w("## Summary");
  w("");
  w("| Metric | Count |");
  w("| --- | --- |");
  w(`| PASS | ${summary.counts.pass} |`);
  w(`| WARN | ${summary.counts.warn} |`);
  w(`| FAIL | ${summary.counts.fail} |`);
  w(`| Total | ${summary.cases.length} |`);
  w("");

  return lines.join("\n");
}

function escMd(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

// ============================================================================
// CLI output
// ============================================================================

function printResults(summary: StressTestSummary, verbose: boolean): void {
  const GREEN = "\x1b[32m";
  const YELLOW = "\x1b[33m";
  const RED = "\x1b[31m";
  const DIM = "\x1b[2m";
  const BOLD = "\x1b[1m";
  const RESET = "\x1b[0m";

  console.log();
  console.log(`Lesson: ${summary.lessonId}`);
  console.log(`Prompt: ${summary.promptId}`);
  console.log(`Mode: ${summary.mode}`);
  console.log();
  console.log(`Running ${summary.cases.length} simulated students…`);
  console.log();

  const maxNameLen = Math.max(...summary.cases.map(c => c.name.length));

  for (const c of summary.cases) {
    const color = c.verdict === "PASS" ? GREEN : c.verdict === "WARN" ? YELLOW : RED;
    const issueStr = c.issueCodes.length > 0 ? ` ${DIM}(${c.issueCodes.join(", ")})${RESET}` : "";
    const paddedName = c.name.padEnd(maxNameLen);
    console.log(`CASE ${paddedName}   ${color}${BOLD}${c.verdict}${RESET}${issueStr}`);

    if (verbose) {
      console.log(`     ${DIM}${c.description}${RESET}`);
      console.log(`     ${DIM}Turns: ${c.turnCount}, Satisfied: ${c.satisfiedCount}/${c.totalRequired}${RESET}`);
      for (const t of c.replayResult.turns) {
        const stateColor = t.state === "correct" || t.state === "mastery" ? GREEN :
          t.state === "wrong" || t.state === "factual_error" ? RED : DIM;
        const stratLabel = t.strategyLevel ? ` [${t.strategyLevel}${t.escalationReason ? `←${t.escalationReason}` : ""}]` : "";
        console.log(`     ${DIM}#${t.turnNum}${RESET} "${t.studentMessage.slice(0, 60)}" → ${stateColor}${t.state}${RESET} / ${t.moveType} / ${t.wrapAction}${stratLabel}`);
      }
      console.log();
    }
  }

  console.log();
  console.log("Summary");
  console.log(`${GREEN}PASS${RESET}: ${summary.counts.pass}`);
  console.log(`${YELLOW}WARN${RESET}: ${summary.counts.warn}`);
  console.log(`${RED}FAIL${RESET}: ${summary.counts.fail}`);
  console.log();
}

// ============================================================================
// CLI
// ============================================================================

export interface CliArgs {
  lessonId: string;
  promptId: string;
  verbose: boolean;
  markdownPath: string | null;
}

export function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);

  if (args.includes("--help") || args.includes("-h") || args.length === 0) {
    console.log(`Usage:
  npx ts-node src/tools/lessonStressTest.ts <lessonId> <promptId> [options]

Options:
  --verbose          Show per-turn replay output
  --markdown <path>  Write a markdown report to the given path

Examples:
  npx ts-node src/tools/lessonStressTest.ts lesson-123 q1
  npx ts-node src/tools/lessonStressTest.ts lesson-123 q1 --verbose
  npx ts-node src/tools/lessonStressTest.ts lesson-123 q1 --markdown report.md`);
    process.exit(0);
  }

  let verbose = false;
  let markdownPath: string | null = null;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--verbose":
        verbose = true;
        break;
      case "--markdown":
        markdownPath = args[++i];
        break;
      default:
        if (!args[i].startsWith("--")) {
          positional.push(args[i]);
        }
        break;
    }
  }

  if (positional.length < 2) {
    fail("Expected: lessonStressTest.ts <lessonId> <promptId>\nRun with --help for usage.");
  }

  return {
    lessonId: positional[0],
    promptId: positional[1],
    verbose,
    markdownPath,
  };
}

function fail(message: string): never {
  console.error(`\x1b[31mError:\x1b[0m ${message}`);
  process.exit(1);
}

function main(): void {
  const cli = parseArgs(process.argv);

  const lesson = loadLessonById(cli.lessonId);
  if (!lesson) {
    fail(`Lesson "${cli.lessonId}" not found.`);
  }

  const summary = runStressTest(lesson, cli.promptId);
  printResults(summary, cli.verbose);

  if (cli.markdownPath) {
    const md = renderStressTestMarkdown(summary);
    const dir = path.dirname(cli.markdownPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(cli.markdownPath, md, "utf-8");
    console.log(`Markdown report written to ${cli.markdownPath}`);
    console.log();
  }
}

if (require.main === module) {
  main();
}
