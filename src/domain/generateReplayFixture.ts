#!/usr/bin/env npx ts-node
/**
 * Fixture generator for transcriptReplay.
 *
 * Converts saved session data + lesson metadata into replayable fixture JSON
 * compatible with `transcriptReplay.ts --audit`.
 *
 * Usage:
 *   # From a saved session file (auto-detects lesson/prompt):
 *   npx ts-node src/domain/generateReplayFixture.ts --from-session data/sessions/abc123.json
 *
 *   # From a raw transcript JSON + lesson/prompt IDs:
 *   npx ts-node src/domain/generateReplayFixture.ts transcript.json --lesson lesson-123 --prompt q1
 *
 *   # Specify output path:
 *   npx ts-node src/domain/generateReplayFixture.ts --from-session session.json -o fixture.json
 *
 *   # Generate fixtures for all prompts in a session (multi-prompt lessons):
 *   npx ts-node src/domain/generateReplayFixture.ts --from-session session.json --all
 *
 * Raw transcript JSON format:
 *   [
 *     { "role": "coach", "message": "..." },
 *     { "role": "student", "message": "..." },
 *     ...
 *   ]
 *
 * Dev-only utility — not imported by production code.
 */

import * as fs from "fs";
import * as path from "path";
import { loadLessonById } from "../loaders/lessonLoader";
import { isPlaceholderTranscript } from "./generateSessionReview";
import type { Lesson } from "./lesson";
import type { Prompt } from "./prompt";
import type { MathProblem } from "./mathProblem";

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

// ============================================================================
// Fixture building
// ============================================================================

function buildFixture(
  prompt: Prompt,
  transcript: TranscriptTurn[],
  lesson: Lesson,
): object {
  const turns = transcript.map(t => ({
    role: t.role,
    message: t.message,
  }));

  const hasMath = !!prompt.mathProblem && !!prompt.assessment?.reasoningSteps?.length;
  const hasExplanation = !!prompt.assessment?.requiredEvidence && !!prompt.assessment?.referenceFacts;

  // Prefer math mode when mathProblem + reasoningSteps are present
  if (hasMath) {
    return buildMathFixture(prompt, turns, lesson);
  }

  if (hasExplanation) {
    return buildExplanationFixture(prompt, turns, lesson);
  }

  // Fallback: try to infer mode from available metadata
  if (prompt.mathProblem) {
    fail(
      `Prompt "${prompt.id}" has mathProblem but no reasoningSteps.\n` +
        `  Math fixtures require assessment.reasoningSteps on the prompt.\n` +
        `  Add reasoningSteps to the lesson or use a different prompt.`,
    );
  }

  fail(
    `Prompt "${prompt.id}" lacks required metadata for fixture generation.\n` +
      `  Explanation fixtures need: assessment.requiredEvidence + assessment.referenceFacts\n` +
      `  Math fixtures need: mathProblem + assessment.reasoningSteps\n` +
      `  Available fields: ${describePromptFields(prompt)}`,
  );
}

function buildMathFixture(
  prompt: Prompt,
  turns: Array<{ role: string; message: string }>,
  lesson: Lesson,
): object {
  const steps = prompt.assessment!.reasoningSteps!;
  const math = prompt.mathProblem!;

  return {
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
      ...(math.commonWrongAnswers ? { commonWrongAnswers: math.commonWrongAnswers } : {}),
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

function buildExplanationFixture(
  prompt: Prompt,
  turns: Array<{ role: string; message: string }>,
  lesson: Lesson,
): object {
  const evidence = prompt.assessment!.requiredEvidence!;
  const facts = prompt.assessment!.referenceFacts!;
  const criteria = prompt.assessment?.successCriteria ?? [];

  return {
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

// ============================================================================
// Prompt field inspector (for error messages)
// ============================================================================

function describePromptFields(prompt: Prompt): string {
  const fields: string[] = [];
  if (prompt.input) fields.push("input");
  if (prompt.hints?.length) fields.push("hints");
  if (prompt.mathProblem) fields.push("mathProblem");
  if (prompt.assessment) {
    const a = prompt.assessment;
    if (a.requiredEvidence) fields.push("assessment.requiredEvidence");
    if (a.referenceFacts) fields.push("assessment.referenceFacts");
    if (a.reasoningSteps?.length) fields.push("assessment.reasoningSteps");
    if (a.successCriteria?.length) fields.push("assessment.successCriteria");
    if (a.learningObjective) fields.push("assessment.learningObjective");
  }
  if (prompt.scope) fields.push("scope");
  if (prompt.conceptAnchor) fields.push("conceptAnchor");
  return fields.join(", ") || "(none)";
}

// ============================================================================
// Session parsing
// ============================================================================

function loadSession(filePath: string): SessionFile {
  const raw = fs.readFileSync(filePath, "utf-8");
  const session: SessionFile = JSON.parse(raw);

  if (!session.lessonId) {
    fail(`Session file is missing lessonId: ${filePath}`);
  }

  return session;
}

function getResponsesWithTurns(
  session: SessionFile,
  promptId?: string,
): Array<{ promptId: string; turns: TranscriptTurn[] }> {
  const responses = session.submission?.responses ?? [];
  const withTurns = responses
    .filter(r => r.conversationTurns && r.conversationTurns.length > 0)
    .filter(r => !promptId || r.promptId === promptId)
    .map(r => ({
      promptId: r.promptId,
      turns: r.conversationTurns!,
    }));

  if (withTurns.length === 0) {
    if (promptId) {
      fail(
        `No conversation turns found for prompt "${promptId}" in session ${session.id}.\n` +
          `  Available prompts with turns: ${responses.filter(r => r.conversationTurns?.length).map(r => r.promptId).join(", ") || "(none)"}`,
      );
    }
    fail(
      `No conversation turns found in session ${session.id}.\n` +
        `  The session may not have video/voice mode responses.`,
    );
  }

  return withTurns;
}

// ============================================================================
// Output
// ============================================================================

function writeFixture(fixture: object, outputPath: string | null, label: string): void {
  const json = JSON.stringify(fixture, null, 2) + "\n";

  if (outputPath) {
    fs.writeFileSync(outputPath, json, "utf-8");
    console.log(`  Written: ${outputPath}`);
  } else {
    console.log(`\n--- ${label} ---`);
    process.stdout.write(json);
  }
}

// ============================================================================
// Error handling
// ============================================================================

function fail(message: string): never {
  console.error(`\x1b[31mError:\x1b[0m ${message}`);
  process.exit(1);
}

// ============================================================================
// CLI
// ============================================================================

interface CliArgs {
  fromSession: string | null;
  transcriptFile: string | null;
  lessonId: string | null;
  promptId: string | null;
  outputPath: string | null;
  all: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`Usage:
  npx ts-node src/domain/generateReplayFixture.ts --from-session <session.json> [options]
  npx ts-node src/domain/generateReplayFixture.ts <transcript.json> --lesson <id> --prompt <id> [options]

Options:
  --from-session <path>  Load transcript from a saved session file
  --lesson <id>          Lesson ID (required for raw transcript mode)
  --prompt <id>          Prompt ID within the lesson (default: first prompt with turns)
  -o <path>              Output file path (default: stdout)
  --all                  Generate fixtures for all prompts with turns (session mode)

Examples:
  npx ts-node src/domain/generateReplayFixture.ts --from-session data/sessions/abc123.json
  npx ts-node src/domain/generateReplayFixture.ts --from-session session.json -o fixture.json
  npx ts-node src/domain/generateReplayFixture.ts --from-session session.json --all -o fixtures/
  npx ts-node src/domain/generateReplayFixture.ts transcript.json --lesson lesson-123 --prompt q1`);
    process.exit(0);
  }

  const result: CliArgs = {
    fromSession: null,
    transcriptFile: null,
    lessonId: null,
    promptId: null,
    outputPath: null,
    all: args.includes("--all"),
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--from-session":
        result.fromSession = args[++i];
        break;
      case "--lesson":
        result.lessonId = args[++i];
        break;
      case "--prompt":
        result.promptId = args[++i];
        break;
      case "-o":
        result.outputPath = args[++i];
        break;
      case "--all":
        break; // already handled
      default:
        if (!arg.startsWith("-") && !result.transcriptFile) {
          result.transcriptFile = arg;
        }
    }
  }

  if (!result.fromSession && !result.transcriptFile) {
    fail("Provide --from-session <path> or a transcript JSON file.\nRun with --help for usage.");
  }

  return result;
}

// ============================================================================
// Main
// ============================================================================

function main(): void {
  const cli = parseArgs();

  if (cli.fromSession) {
    runFromSession(cli);
  } else {
    runFromTranscript(cli);
  }
}

function runFromSession(cli: CliArgs): void {
  const session = loadSession(cli.fromSession!);
  const lesson = loadLessonById(session.lessonId);
  if (!lesson) {
    fail(
      `Lesson "${session.lessonId}" not found.\n` +
        `  Make sure the lesson JSON exists in src/data/lessons/.`,
    );
  }

  const responses = getResponsesWithTurns(session, cli.promptId ?? undefined);

  if (!cli.all && !cli.promptId) {
    // Default: use first prompt with turns
    const first = responses[0];
    if (isPlaceholderTranscript(first.turns)) {
      fail(
        `Transcript for prompt "${first.promptId}" is a video placeholder — no real speech captured.\n` +
          `  Fixture generation requires actual conversation turns.`,
      );
    }
    const prompt = lesson.prompts.find(p => p.id === first.promptId);
    if (!prompt) {
      fail(`Prompt "${first.promptId}" not found in lesson "${lesson.id}".`);
    }
    const fixture = buildFixture(prompt, first.turns, lesson);
    const outPath = cli.outputPath;
    writeFixture(fixture, outPath, `${session.id} / ${first.promptId}`);
    printSummary(session, prompt, first.turns);
    return;
  }

  if (cli.all) {
    // Generate one fixture per prompt with turns
    const outDir = cli.outputPath;
    if (outDir && !fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    let generated = 0;
    for (const resp of responses) {
      const prompt = lesson.prompts.find(p => p.id === resp.promptId);
      if (!prompt) {
        console.warn(`  Skipping prompt "${resp.promptId}" — not found in lesson.`);
        continue;
      }
      if (isPlaceholderTranscript(resp.turns)) {
        console.warn(`  Skipping prompt "${resp.promptId}" — video placeholder transcript.`);
        continue;
      }
      try {
        const fixture = buildFixture(prompt, resp.turns, lesson);
        const fileName = `${session.lessonId}_${resp.promptId}.json`;
        const filePath = outDir ? path.join(outDir, fileName) : null;
        writeFixture(fixture, filePath, `${session.id} / ${resp.promptId}`);
        generated++;
      } catch (err: any) {
        console.warn(`  Skipping prompt "${resp.promptId}": ${err.message}`);
      }
    }
    console.log(`\nGenerated ${generated} fixture(s).`);
    return;
  }

  // Specific prompt ID requested
  const match = responses.find(r => r.promptId === cli.promptId);
  if (!match) {
    fail(`No conversation turns for prompt "${cli.promptId}".`);
  }
  if (isPlaceholderTranscript(match.turns)) {
    fail(
      `Transcript for prompt "${cli.promptId}" is a video placeholder — no real speech captured.\n` +
        `  Fixture generation requires actual conversation turns.`,
    );
  }
  const prompt = lesson.prompts.find(p => p.id === cli.promptId);
  if (!prompt) {
    fail(`Prompt "${cli.promptId}" not found in lesson "${lesson.id}".`);
  }
  const fixture = buildFixture(prompt, match.turns, lesson);
  writeFixture(fixture, cli.outputPath, `${session.id} / ${cli.promptId}`);
  printSummary(session, prompt, match.turns);
}

function runFromTranscript(cli: CliArgs): void {
  if (!cli.lessonId) {
    fail("--lesson <id> is required when using a raw transcript file.");
  }

  const lesson = loadLessonById(cli.lessonId);
  if (!lesson) {
    fail(`Lesson "${cli.lessonId}" not found.`);
  }

  // Load transcript
  const raw = fs.readFileSync(path.resolve(cli.transcriptFile!), "utf-8");
  const parsed = JSON.parse(raw);

  // Support both bare array and { transcript: [...] }
  const turns: TranscriptTurn[] = Array.isArray(parsed) ? parsed : parsed.transcript;
  if (!Array.isArray(turns) || turns.length === 0) {
    fail("Transcript file must contain an array of { role, message } turns.");
  }

  // Find prompt
  const promptId = cli.promptId ?? lesson.prompts[0]?.id;
  if (!promptId) {
    fail(`Lesson "${lesson.id}" has no prompts.`);
  }
  const prompt = lesson.prompts.find(p => p.id === promptId);
  if (!prompt) {
    fail(`Prompt "${promptId}" not found in lesson "${lesson.id}".`);
  }

  const fixture = buildFixture(prompt, turns, lesson);
  writeFixture(fixture, cli.outputPath, `${lesson.id} / ${promptId}`);
  printSummary(null, prompt, turns);
}

function printSummary(
  session: SessionFile | null,
  prompt: Prompt,
  turns: TranscriptTurn[],
): void {
  const studentTurns = turns.filter(t => t.role === "student").length;
  const coachTurns = turns.filter(t => t.role === "coach").length;
  const hasMath = !!prompt.mathProblem;

  console.log();
  console.log(`  Mode:       ${hasMath ? "math" : "explanation"}`);
  if (session) {
    console.log(`  Session:    ${session.id}`);
    if (session.studentName) console.log(`  Student:    ${session.studentName}`);
  }
  console.log(`  Prompt:     ${prompt.id} — "${prompt.input.slice(0, 60)}${prompt.input.length > 60 ? "..." : ""}"`);
  console.log(`  Turns:      ${turns.length} total (${coachTurns} coach, ${studentTurns} student)`);
  if (hasMath) {
    console.log(`  Expression: ${prompt.mathProblem!.expression} = ${prompt.mathProblem!.correctAnswer}`);
    console.log(`  Steps:      ${prompt.assessment?.reasoningSteps?.length ?? 0}`);
  } else {
    const ev = prompt.assessment?.requiredEvidence;
    if (ev) {
      console.log(`  Evidence:   ${ev.minEntities} ${ev.entityLabel}, ${ev.minAttributeTypes ?? 1} ${ev.attributeLabel} types`);
    }
    console.log(`  Facts:      ${Object.keys(prompt.assessment?.referenceFacts ?? {}).length} entities`);
    console.log(`  Criteria:   ${prompt.assessment?.successCriteria?.length ?? 0}`);
  }
}

main();
