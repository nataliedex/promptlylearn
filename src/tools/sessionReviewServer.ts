#!/usr/bin/env npx ts-node
/**
 * Dev-only session review browser.
 *
 * A tiny local web UI served with Express that lets developers:
 * - Browse all saved sessions with metadata
 * - View per-prompt transcript, replay analysis, and audit verdicts
 * - Filter by verdict (PASS/WARN/FAIL), mode (math/explanation), promotion status
 * - One-click: generate fixture JSON, markdown review, dry-run promotion
 *
 * Usage:
 *   npx ts-node src/tools/sessionReviewServer.ts
 *   npx ts-node src/tools/sessionReviewServer.ts --port 3002
 *
 * NOT imported by production code.
 */

import express, { Request, Response } from "express";
import { SessionStore } from "../stores/sessionStore";
import { loadLessonById } from "../loaders/lessonLoader";
import {
  buildSessionReview,
  renderSessionReview,
  type SessionFile,
  type SessionReview,
  type PromptAnalysis,
} from "../domain/generateSessionReview";
import {
  promoteSession,
  renderPromotionReport,
} from "../domain/promoteSessionToGolden";
import { getAllLessons } from "../loaders/lessonLoader";
import {
  detectPromptMode,
  runStressTest,
  runCase,
  buildCases,
  buildTranscript,
  buildFixtureFromTranscript,
  renderStressTestMarkdown,
  type StressTestSummary,
  type CaseResult,
} from "./lessonStressTest";
import type { Session } from "../domain/session";
import type { Lesson } from "../domain/lesson";
import type { Prompt } from "../domain/prompt";

// ============================================================================
// Config
// ============================================================================

const DEFAULT_PORT = 3002;

// ============================================================================
// Session → SessionFile adapter
// ============================================================================

/**
 * Convert a Session (from SessionStore) into the SessionFile shape
 * expected by generateSessionReview. Maps help/more/elaboration
 * conversations and draftState.conversationHistory into flat
 * conversationTurns arrays per response.
 */
export function sessionToSessionFile(session: Session): SessionFile {
  const responses = (session.submission?.responses ?? []).map(r => {
    // Prefer stored conversationTurns (captured from live video sessions)
    if (r.conversationTurns && r.conversationTurns.length > 0) {
      return {
        promptId: r.promptId,
        conversationTurns: r.conversationTurns.map(t => ({
          role: t.role,
          message: t.message,
          ...(t.timestampSec != null ? { timestampSec: t.timestampSec } : {}),
        })),
        inputSource: r.inputSource,
        deferredByCoach: r.deferredByCoach,
      };
    }

    // Fallback: build conversationTurns from structured conversation fields
    const turns: Array<{ role: "coach" | "student"; message: string }> = [];

    // helpConversation turns (during-question coaching)
    if (r.helpConversation?.turns) {
      for (const t of r.helpConversation.turns) {
        turns.push({ role: t.role, message: t.message });
      }
    }

    // moreConversation turns (post-answer exploration)
    if (r.moreConversation?.turns) {
      for (const t of r.moreConversation.turns) {
        turns.push({ role: t.role, message: t.message });
      }
    }

    // elaborationConversation turns
    if (r.elaborationConversation?.turns) {
      for (const t of r.elaborationConversation.turns) {
        turns.push({ role: t.role, message: t.message });
      }
    }

    // If no structured conversations, try building from the response text
    if (turns.length === 0 && r.response) {
      turns.push({ role: "student", message: r.response });
    }

    return {
      promptId: r.promptId,
      conversationTurns: turns,
      inputSource: r.inputSource,
      deferredByCoach: r.deferredByCoach,
    };
  });

  return {
    id: session.id,
    lessonId: session.lessonId,
    lessonTitle: session.lessonTitle,
    studentName: session.studentName,
    submission: { responses },
    evaluation: session.evaluation ? {
      totalScore: session.evaluation.totalScore,
      criteriaScores: session.evaluation.criteriaScores,
    } : undefined,
  };
}

// ============================================================================
// Review cache (avoids re-running replay on every page load)
// ============================================================================

interface CachedReview {
  review: SessionReview;
  session: Session;
  lesson: Lesson | null;
  timestamp: number;
}

const reviewCache = new Map<string, CachedReview>();
const CACHE_TTL_MS = 60_000; // 1 minute

export function clearReviewCache(): void {
  reviewCache.clear();
}

interface ReviewResult {
  cached: CachedReview;
  cacheHit: boolean;
}

function getSessionReview(
  store: SessionStore,
  sessionId: string,
  promptFilter?: string,
  skipCache = false,
): ReviewResult | null {
  const cacheKey = `${sessionId}:${promptFilter ?? "all"}`;
  const cached = reviewCache.get(cacheKey);
  if (!skipCache && cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return { cached, cacheHit: true };
  }

  const session = store.load(sessionId);
  if (!session) return null;

  const lesson = loadLessonById(session.lessonId);
  if (!lesson) {
    // Return a minimal review with no prompts
    const entry: CachedReview = {
      review: {
        sessionId: session.id,
        lessonId: session.lessonId,
        lessonTitle: session.lessonTitle ?? null,
        studentName: session.studentName ?? null,
        timestamp: new Date().toISOString(),
        prompts: [],
      },
      session,
      lesson: null,
      timestamp: Date.now(),
    };
    reviewCache.set(cacheKey, entry);
    return { cached: entry, cacheHit: false };
  }

  const sessionFile = sessionToSessionFile(session);
  const review = buildSessionReview(sessionFile, lesson, promptFilter);
  const entry: CachedReview = { review, session, lesson, timestamp: Date.now() };
  reviewCache.set(cacheKey, entry);
  return { cached: entry, cacheHit: false };
}

// ============================================================================
// HTML helpers
// ============================================================================

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function verdictBadge(verdict: string | null): string {
  if (!verdict) return `<span class="badge badge-muted">—</span>`;
  const cls =
    verdict === "PASS" ? "badge-pass" :
    verdict === "WARN" ? "badge-warn" :
    verdict === "FAIL" ? "badge-fail" : "badge-muted";
  return `<span class="badge ${cls}">${escHtml(verdict)}</span>`;
}

function modeBadge(mode: string): string {
  const cls =
    mode === "math" ? "badge-math" :
    mode === "explanation" ? "badge-explanation" : "badge-muted";
  return `<span class="badge ${cls}">${escHtml(mode)}</span>`;
}

function promotionBadge(promo: string): string {
  if (promo === "Promote to golden fixture") return `<span class="badge badge-promote">promote</span>`;
  if (promo === "Good debugging example") return `<span class="badge badge-debug">debug</span>`;
  return `<span class="badge badge-muted">skip</span>`;
}

function fidelityBadge(fidelity: string): string {
  if (fidelity === "Replay matches live outcome") return `<span class="badge badge-pass">matches</span>`;
  if (fidelity === "Replay differs from live outcome") return `<span class="badge badge-warn">differs</span>`;
  return `<span class="badge badge-muted">unavailable</span>`;
}

function chip(label: string, value: string, cls: string = ""): string {
  return `<span class="chip ${cls}" title="${escHtml(label)}: ${escHtml(value)}">${escHtml(label)}: <strong>${escHtml(value)}</strong></span>`;
}

// ============================================================================
// Page layout
// ============================================================================

function pageLayout(title: string, content: string, nav?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(title)} — Session Review Browser</title>
<style>
  :root {
    --bg: #f8f9fa; --card: #fff; --border: #dee2e6; --text: #212529;
    --muted: #6c757d; --pass: #28a745; --warn: #ffc107; --fail: #dc3545;
    --math-bg: #e3f2fd; --expl-bg: #e8f5e9; --promote-bg: #d4edda;
    --debug-bg: #fff3cd; --muted-bg: #e9ecef;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: var(--bg); color: var(--text); line-height: 1.5; padding: 1rem; }
  h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
  h2 { font-size: 1.25rem; margin: 1rem 0 0.5rem; }
  h3 { font-size: 1.1rem; margin: 0.75rem 0 0.25rem; }
  a { color: #0366d6; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .nav { background: #343a40; color: #fff; padding: 0.5rem 1rem; margin: -1rem -1rem 1rem;
    display: flex; align-items: center; gap: 1rem; }
  .nav a { color: #adb5bd; }
  .nav a:hover { color: #fff; }
  .nav .brand { font-weight: 600; color: #fff; font-size: 1.1rem; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 6px;
    padding: 1rem; margin-bottom: 1rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  th, td { padding: 0.4rem 0.6rem; text-align: left; border-bottom: 1px solid var(--border); }
  th { background: #f1f3f5; font-weight: 600; white-space: nowrap; }
  tr:hover td { background: #f8f9fa; }
  .badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 3px;
    font-size: 0.8rem; font-weight: 600; }
  .badge-pass { background: #d4edda; color: #155724; }
  .badge-warn { background: #fff3cd; color: #856404; }
  .badge-fail { background: #f8d7da; color: #721c24; }
  .badge-math { background: var(--math-bg); color: #0d47a1; }
  .badge-explanation { background: var(--expl-bg); color: #1b5e20; }
  .badge-promote { background: var(--promote-bg); color: #155724; }
  .badge-debug { background: var(--debug-bg); color: #856404; }
  .badge-muted { background: var(--muted-bg); color: var(--muted); }
  .chip { display: inline-block; padding: 0.1rem 0.4rem; border-radius: 3px;
    font-size: 0.75rem; background: #e9ecef; margin: 0.1rem; }
  .chip-state { background: #e3f2fd; }
  .chip-move { background: #f3e5f5; }
  .chip-wrap { background: #fff3e0; }
  .chip-target { background: #e8f5e9; }
  .transcript-turn { margin: 0.4rem 0; padding: 0.4rem 0.6rem; border-radius: 4px; }
  .turn-coach { background: #e3f2fd; border-left: 3px solid #1976d2; }
  .turn-student { background: #f3e5f5; border-left: 3px solid #7b1fa2; }
  .turn-label { font-weight: 600; font-size: 0.85rem; }
  .filters { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 1rem; align-items: center; }
  .filters label { font-size: 0.85rem; font-weight: 600; }
  .filters select, .filters input { font-size: 0.85rem; padding: 0.25rem 0.5rem;
    border: 1px solid var(--border); border-radius: 4px; }
  .actions { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
  .btn { display: inline-block; padding: 0.35rem 0.75rem; border-radius: 4px;
    font-size: 0.85rem; font-weight: 500; border: 1px solid var(--border);
    background: var(--card); cursor: pointer; text-decoration: none; color: var(--text); }
  .btn:hover { background: #e9ecef; text-decoration: none; }
  .btn-primary { background: #0366d6; color: #fff; border-color: #0366d6; }
  .btn-primary:hover { background: #0256b9; }
  .empty { color: var(--muted); font-style: italic; padding: 2rem; text-align: center; }
  pre { background: #f1f3f5; padding: 0.75rem; border-radius: 4px; overflow-x: auto;
    font-size: 0.85rem; white-space: pre-wrap; }
  .meta-grid { display: grid; grid-template-columns: auto 1fr; gap: 0.25rem 1rem;
    font-size: 0.9rem; }
  .meta-grid dt { font-weight: 600; color: var(--muted); }
  .replay-table { font-size: 0.8rem; }
  .replay-table td { vertical-align: top; }
  .truncate { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  details { margin-bottom: 0.5rem; }
  details summary { cursor: pointer; padding: 0.4rem 0; font-weight: 600; font-size: 0.95rem; }
  details summary:hover { color: #0366d6; }
  details[open] summary { margin-bottom: 0.5rem; }
  .summary-bar { display: flex; gap: 1.5rem; padding: 0.75rem 1rem; background: #f1f3f5;
    border-radius: 6px; margin-bottom: 1rem; font-size: 0.95rem; font-weight: 600; }
  .summary-bar .pass { color: var(--pass); }
  .summary-bar .warn { color: #856404; }
  .summary-bar .fail { color: var(--fail); }
  .issue-freq td, .issue-freq th { padding: 0.3rem 0.6rem; }
</style>
</head>
<body>
<div class="nav">
  <span class="brand">Session Review Browser</span>
  <a href="/">Sessions</a>
  <a href="/stress">Stress Test</a>
  ${nav ?? ""}
</div>
${content}
</body>
</html>`;
}

// ============================================================================
// Routes
// ============================================================================

export function createApp(): express.Application {
  const app = express();
  const store = new SessionStore();

  // ── Session list ──────────────────────────────────────────────────────
  app.get("/", (req: Request, res: Response) => {
    const verdictFilter = (req.query.verdict as string) || "";
    const modeFilter = (req.query.mode as string) || "";
    const promotionFilter = (req.query.promotion as string) || "";
    const searchQuery = (req.query.q as string) || "";

    const sessions = store.getAll();

    // Build review summaries for each session (lightweight scan)
    interface SessionSummary {
      id: string;
      studentName: string;
      lessonId: string;
      lessonTitle: string;
      status: string;
      startedAt: string;
      promptCount: number;
      modes: string[];
      verdicts: (string | null)[];
      promotions: string[];
    }

    const summaries: SessionSummary[] = [];

    for (const session of sessions) {
      const listResult = getSessionReview(store, session.id);
      if (!listResult) continue;

      const review = listResult.cached.review;

      const modes: string[] = [...new Set(review.prompts.map(p => p.mode))];
      const verdicts: string[] = [...new Set(review.prompts.map(p => p.verdict as string ?? ""))];
      const promotions: string[] = [...new Set(review.prompts.map(p => p.promotion as string))];

      // Apply filters
      if (verdictFilter && !verdicts.includes(verdictFilter)) continue;
      if (modeFilter && !modes.includes(modeFilter)) continue;
      if (promotionFilter) {
        const promoMap: Record<string, string> = {
          promote: "Promote to golden fixture",
          debug: "Good debugging example",
          skip: "No promotion needed",
        };
        if (!promotions.includes(promoMap[promotionFilter] ?? promotionFilter)) continue;
      }
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const haystack = [
          session.id, session.studentName, session.lessonTitle, session.lessonId,
        ].join(" ").toLowerCase();
        if (!haystack.includes(q)) continue;
      }

      summaries.push({
        id: session.id,
        studentName: session.studentName ?? "—",
        lessonId: session.lessonId,
        lessonTitle: session.lessonTitle ?? "—",
        status: session.status,
        startedAt: session.startedAt
          ? new Date(session.startedAt).toLocaleDateString()
          : "—",
        promptCount: review.prompts.length,
        modes,
        verdicts,
        promotions,
      });
    }

    // Build HTML
    const filterBar = `
      <form class="filters" method="get" action="/">
        <label>Verdict:</label>
        <select name="verdict">
          <option value="">All</option>
          <option value="PASS" ${verdictFilter === "PASS" ? "selected" : ""}>PASS</option>
          <option value="WARN" ${verdictFilter === "WARN" ? "selected" : ""}>WARN</option>
          <option value="FAIL" ${verdictFilter === "FAIL" ? "selected" : ""}>FAIL</option>
        </select>
        <label>Mode:</label>
        <select name="mode">
          <option value="">All</option>
          <option value="math" ${modeFilter === "math" ? "selected" : ""}>math</option>
          <option value="explanation" ${modeFilter === "explanation" ? "selected" : ""}>explanation</option>
          <option value="unsupported" ${modeFilter === "unsupported" ? "selected" : ""}>unsupported</option>
        </select>
        <label>Promotion:</label>
        <select name="promotion">
          <option value="">All</option>
          <option value="promote" ${promotionFilter === "promote" ? "selected" : ""}>Promote</option>
          <option value="debug" ${promotionFilter === "debug" ? "selected" : ""}>Debug</option>
          <option value="skip" ${promotionFilter === "skip" ? "selected" : ""}>Skip</option>
        </select>
        <label>Search:</label>
        <input type="text" name="q" value="${escHtml(searchQuery)}" placeholder="name, lesson, id…">
        <button class="btn btn-primary" type="submit">Filter</button>
        <a class="btn" href="/">Clear</a>
      </form>`;

    let tableRows = "";
    if (summaries.length === 0) {
      tableRows = `<tr><td colspan="7" class="empty">No sessions match the current filters.</td></tr>`;
    } else {
      for (const s of summaries) {
        const verdictCells = s.verdicts.map(v => verdictBadge(v)).join(" ");
        const modeCells = s.modes.map(m => modeBadge(m)).join(" ");
        const promoCells = s.promotions.map(p => promotionBadge(p)).join(" ");
        tableRows += `
          <tr>
            <td><a href="/session/${escHtml(s.id)}">${escHtml(s.id.slice(0, 8))}…</a></td>
            <td>${escHtml(s.studentName)}</td>
            <td title="${escHtml(s.lessonId)}">${escHtml(s.lessonTitle)}</td>
            <td>${s.promptCount}</td>
            <td>${modeCells}</td>
            <td>${verdictCells}</td>
            <td>${promoCells}</td>
            <td>${escHtml(s.startedAt)}</td>
          </tr>`;
      }
    }

    const html = `
      <h1>Sessions (${summaries.length})</h1>
      ${filterBar}
      <div class="card">
        <table>
          <thead>
            <tr>
              <th>ID</th><th>Student</th><th>Lesson</th><th>Prompts</th>
              <th>Mode</th><th>Verdict</th><th>Promotion</th><th>Date</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>`;

    res.send(pageLayout("Sessions", html));
  });

  // ── Session detail ────────────────────────────────────────────────────
  app.get("/session/:id", (req: Request, res: Response) => {
    const sessionId = req.params.id as string;
    const promptFilter = (req.query.prompt as string) || undefined;
    const skipCache = req.query.refresh === "1";
    const result = getSessionReview(store, sessionId, promptFilter, skipCache);

    if (!result) {
      res.status(404).send(pageLayout("Not Found", `<p class="empty">Session not found: ${escHtml(sessionId)}</p>`));
      return;
    }

    const { cached, cacheHit } = result;
    const { review, session } = cached;
    const nav = `<a href="/session/${escHtml(session.id)}">← ${escHtml(session.id.slice(0, 8))}…</a>`;

    // Metadata section
    let html = `
      <h1>Session: ${escHtml(session.id.slice(0, 12))}…</h1>
      <div class="card">
        <h2>Metadata</h2>
        <dl class="meta-grid">
          <dt>Session ID</dt><dd>${escHtml(session.id)}</dd>
          <dt>Student</dt><dd>${escHtml(session.studentName ?? "—")}</dd>
          <dt>Lesson</dt><dd>${escHtml(session.lessonTitle ?? "—")} <span class="badge badge-muted">${escHtml(session.lessonId)}</span></dd>
          <dt>Status</dt><dd>${escHtml(session.status)}</dd>
          <dt>Started</dt><dd>${session.startedAt ? new Date(session.startedAt).toLocaleString() : "—"}</dd>
          <dt>Mode</dt><dd>${escHtml(session.mode ?? "—")}</dd>
          <dt>Prompts analyzed</dt><dd>${review.prompts.length}</dd>
          <dt>Generated at</dt><dd>${new Date(cached.timestamp).toLocaleString()}</dd>
          <dt>Cache</dt><dd><span class="badge ${cacheHit ? "badge-muted" : "badge-pass"}">${cacheHit ? "HIT" : "MISS"}</span>${cacheHit ? ` <a href="?refresh=1${promptFilter ? `&prompt=${escHtml(promptFilter)}` : ""}">↻ force refresh</a>` : ""}</dd>
        </dl>
      </div>`;

    // Actions bar
    html += `
      <div class="card">
        <h2>Actions</h2>
        <div class="actions">
          <a class="btn btn-primary" href="/session/${escHtml(session.id)}/markdown" target="_blank">Generate Markdown Review</a>
          <a class="btn" href="/session/${escHtml(session.id)}/dry-run">Dry-run Promotion</a>
          <a class="btn" href="/session/${escHtml(session.id)}/fixture-json" target="_blank">Generate Fixture JSON</a>
        </div>
      </div>`;

    // Prompt overview table
    if (review.prompts.length > 0) {
      html += `
        <div class="card">
          <h2>Prompt Overview</h2>
          <table>
            <thead><tr><th>Prompt</th><th>Mode</th><th>Deterministic</th><th>Verdict</th><th>Turns</th><th>Journey</th><th>Promotion</th></tr></thead>
            <tbody>`;
      for (const p of review.prompts) {
        html += `<tr>
          <td><a href="#prompt-${escHtml(p.promptId)}">${escHtml(p.promptId)}</a></td>
          <td>${modeBadge(p.mode)}</td>
          <td>${p.deterministicPipeline ? "yes" : "no"}</td>
          <td>${verdictBadge(p.verdict)}</td>
          <td>${p.turns.length}</td>
          <td>${escHtml(p.journeySummary)}</td>
          <td>${promotionBadge(p.promotion)}</td>
        </tr>`;
      }
      html += `</tbody></table></div>`;

      // Per-prompt detail sections
      for (const pa of review.prompts) {
        html += renderPromptDetail(pa);
      }
    } else {
      html += `<div class="card"><p class="empty">No prompts with conversation data found in this session.</p></div>`;
    }

    res.send(pageLayout(`Session ${session.id.slice(0, 8)}`, html, nav));
  });

  // ── Markdown review (plain text) ──────────────────────────────────────
  app.get("/session/:id/markdown", (req: Request, res: Response) => {
    const skipCache = req.query.refresh === "1";
    const result = getSessionReview(store, req.params.id as string, undefined, skipCache);
    if (!result) { res.status(404).send("Session not found"); return; }

    const md = renderSessionReview(result.cached.review);
    res.type("text/plain; charset=utf-8").send(md);
  });

  // ── Fixture JSON (for all qualifying prompts) ─────────────────────────
  app.get("/session/:id/fixture-json", (req: Request, res: Response) => {
    const skipCache = req.query.refresh === "1";
    const result = getSessionReview(store, req.params.id as string, undefined, skipCache);
    if (!result || !result.cached.lesson) {
      res.status(404).send("Session or lesson not found");
      return;
    }

    const sessionFile = sessionToSessionFile(result.cached.session);
    const summary = promoteSession(
      sessionFile,
      result.cached.lesson,
      { force: false, dryRun: true, destDir: "fixtures/golden/" },
    );

    res.type("application/json").send(JSON.stringify(summary, null, 2));
  });

  // ── Dry-run promotion (rendered HTML) ─────────────────────────────────
  app.get("/session/:id/dry-run", (req: Request, res: Response) => {
    const skipCache = req.query.refresh === "1";
    const result = getSessionReview(store, req.params.id as string, undefined, skipCache);
    if (!result || !result.cached.lesson) {
      res.status(404).send(pageLayout("Error", `<p class="empty">Session or lesson not found.</p>`));
      return;
    }

    const sessionFile = sessionToSessionFile(result.cached.session);
    const summary = promoteSession(
      sessionFile,
      result.cached.lesson,
      { force: false, dryRun: true, destDir: "fixtures/golden/" },
    );

    const md = renderPromotionReport(summary);
    const nav = `<a href="/session/${escHtml(result.cached.session.id)}">← Back to session</a>`;

    let html = `<h1>Dry-run Promotion Report</h1><div class="card"><pre>${escHtml(md)}</pre></div>`;

    // Results table
    if (summary.results.length > 0) {
      html += `<div class="card"><h2>Results</h2><table>
        <thead><tr><th>Prompt</th><th>Mode</th><th>Verdict</th><th>Turns</th><th>Status</th><th>Reason</th></tr></thead>
        <tbody>`;
      for (const r of summary.results) {
        const statusBadge =
          r.outcome.status === "would_write" ? `<span class="badge badge-promote">would write</span>` :
          r.outcome.status === "skipped" ? `<span class="badge badge-muted">skipped</span>` :
          `<span class="badge">${escHtml(r.outcome.status)}</span>`;
        html += `<tr>
          <td>${escHtml(r.promptId)}</td>
          <td>${modeBadge(r.mode)}</td>
          <td>${verdictBadge(r.verdict)}</td>
          <td>${r.studentTurns}</td>
          <td>${statusBadge}</td>
          <td>${escHtml(r.outcome.reason)}</td>
        </tr>`;
      }
      html += `</tbody></table></div>`;
    }

    res.send(pageLayout("Dry-run Promotion", html, nav));
  });

  // ========================================================================
  // Stress test routes
  // ========================================================================

  // ── Stress test selector page ───────────────────────────────────────────
  app.get("/stress", (req: Request, res: Response) => {
    const selectedLesson = (req.query.lesson as string) || "";
    const selectedPrompt = (req.query.prompt as string) || "";

    const lessons = getAllLessons();

    // Build lesson options
    let lessonOptions = `<option value="">— select lesson —</option>`;
    for (const l of lessons) {
      const sel = l.id === selectedLesson ? "selected" : "";
      lessonOptions += `<option value="${escHtml(l.id)}" ${sel}>${escHtml(l.title)} (${escHtml(l.id)})</option>`;
    }

    // Build prompt options for selected lesson
    let promptOptions = `<option value="">— select prompt —</option>`;
    let promptRows = "";
    const lesson = selectedLesson ? lessons.find(l => l.id === selectedLesson) : null;
    if (lesson) {
      for (const p of lesson.prompts) {
        const sel = p.id === selectedPrompt ? "selected" : "";
        let modeLabel = "unsupported";
        try { modeLabel = detectPromptMode(p); } catch { /* unsupported */ }
        promptOptions += `<option value="${escHtml(p.id)}" ${sel}>${escHtml(p.id)} — ${escHtml(p.input.slice(0, 60))} [${modeLabel}]</option>`;

        promptRows += `<tr>
          <td><a href="/stress/run?lesson=${escHtml(lesson.id)}&prompt=${escHtml(p.id)}">${escHtml(p.id)}</a></td>
          <td class="truncate" title="${escHtml(p.input)}">${escHtml(p.input.slice(0, 80))}</td>
          <td>${modeBadge(modeLabel)}</td>
          <td>${p.assessment?.reasoningSteps?.length || p.assessment?.requiredEvidence ? "yes" : "no"}</td>
        </tr>`;
      }
    }

    const runUrl = selectedLesson && selectedPrompt
      ? `/stress/run?lesson=${encodeURIComponent(selectedLesson)}&prompt=${encodeURIComponent(selectedPrompt)}`
      : "";

    let html = `
      <h1>Prompt Stress Tester</h1>
      <div class="card">
        <form class="filters" method="get" action="/stress">
          <label>Lesson:</label>
          <select name="lesson" onchange="this.form.submit()">
            ${lessonOptions}
          </select>
          <label>Prompt:</label>
          <select name="prompt">
            ${promptOptions}
          </select>
          ${runUrl
            ? `<a class="btn btn-primary" href="${escHtml(runUrl)}">Run Stress Test</a>`
            : `<button class="btn btn-primary" type="submit">Select</button>`
          }
        </form>
      </div>`;

    if (lesson) {
      html += `
        <div class="card">
          <h2>Prompts in "${escHtml(lesson.title)}"</h2>
          <table>
            <thead><tr><th>Prompt ID</th><th>Input</th><th>Mode</th><th>Deterministic</th></tr></thead>
            <tbody>${promptRows || `<tr><td colspan="4" class="empty">No prompts in this lesson.</td></tr>`}</tbody>
          </table>
        </div>`;
    } else if (lessons.length === 0) {
      html += `<div class="card"><p class="empty">No lessons found.</p></div>`;
    }

    res.send(pageLayout("Stress Test", html));
  });

  // ── Run stress test ─────────────────────────────────────────────────────
  app.get("/stress/run", (req: Request, res: Response) => {
    const lessonId = req.query.lesson as string;
    const promptId = req.query.prompt as string;

    if (!lessonId || !promptId) {
      res.status(400).send(pageLayout("Error",
        `<p class="empty">Both <code>lesson</code> and <code>prompt</code> query params are required.</p>
         <p style="text-align:center"><a class="btn" href="/stress">Back to selector</a></p>`));
      return;
    }

    const lesson = loadLessonById(lessonId);
    if (!lesson) {
      res.status(404).send(pageLayout("Not Found",
        `<p class="empty">Lesson "${escHtml(lessonId)}" not found.</p>
         <p style="text-align:center"><a class="btn" href="/stress">Back to selector</a></p>`));
      return;
    }

    const prompt = lesson.prompts.find(p => p.id === promptId);
    if (!prompt) {
      res.status(404).send(pageLayout("Not Found",
        `<p class="empty">Prompt "${escHtml(promptId)}" not found in lesson "${escHtml(lessonId)}".</p>
         <p style="text-align:center"><a class="btn" href="/stress?lesson=${encodeURIComponent(lessonId)}">Back to lesson</a></p>`));
      return;
    }

    // Detect mode — handle unsupported gracefully
    let mode: string;
    try {
      mode = detectPromptMode(prompt);
    } catch {
      res.status(400).send(pageLayout("Unsupported Prompt",
        `<div class="card">
          <h2>Cannot stress test this prompt</h2>
          <p>Prompt "${escHtml(promptId)}" has neither math nor explanation metadata.</p>
          <p>Stress testing requires <code>mathProblem</code> + <code>reasoningSteps</code> (math) or
             <code>requiredEvidence</code> + <code>referenceFacts</code> (explanation).</p>
          <p><a class="btn" href="/stress?lesson=${encodeURIComponent(lessonId)}">Back to lesson</a></p>
        </div>`));
      return;
    }

    // Run the stress test
    const summary = runStressTest(lesson, promptId);

    const nav = `<a href="/stress?lesson=${encodeURIComponent(lessonId)}">← Back to lesson</a>`;

    let html = renderStressResultHtml(summary, lessonId, promptId, prompt);
    res.send(pageLayout(`Stress: ${promptId}`, html, nav));
  });

  // ── Stress test markdown download ───────────────────────────────────────
  app.get("/stress/markdown", (req: Request, res: Response) => {
    const lessonId = req.query.lesson as string;
    const promptId = req.query.prompt as string;

    if (!lessonId || !promptId) {
      res.status(400).send("Both lesson and prompt query params required");
      return;
    }

    const lesson = loadLessonById(lessonId);
    if (!lesson) {
      res.status(404).send("Lesson not found");
      return;
    }

    try {
      const summary = runStressTest(lesson, promptId);
      const md = renderStressTestMarkdown(summary);
      res.type("text/plain; charset=utf-8").send(md);
    } catch (err: any) {
      res.status(400).send(err.message ?? "Stress test failed");
    }
  });

  // ── Case fixture JSON ──────────────────────────────────────────────────
  app.get("/stress/case-fixture", (req: Request, res: Response) => {
    const lessonId = req.query.lesson as string;
    const promptId = req.query.prompt as string;
    const caseName = req.query.case as string;

    if (!lessonId || !promptId || !caseName) {
      res.status(400).send("lesson, prompt, and case query params required");
      return;
    }

    const lesson = loadLessonById(lessonId);
    if (!lesson) {
      res.status(404).send("Lesson not found");
      return;
    }

    const prompt = lesson.prompts.find(p => p.id === promptId);
    if (!prompt) {
      res.status(404).send("Prompt not found");
      return;
    }

    try {
      const mode = detectPromptMode(prompt);
      const cases = buildCases(prompt, mode);
      const simCase = cases.find(c => c.name === caseName);
      if (!simCase) {
        res.status(404).send(`Case "${caseName}" not found`);
        return;
      }

      const transcript = buildTranscript(simCase.studentTurns, prompt, mode);
      const fixture = buildFixtureFromTranscript(transcript, prompt, mode);
      res.type("application/json").send(JSON.stringify(fixture, null, 2));
    } catch (err: any) {
      res.status(400).send(err.message ?? "Failed to generate fixture");
    }
  });

  return app;
}

// ============================================================================
// Stress test result HTML rendering
// ============================================================================

function renderStressResultHtml(
  summary: StressTestSummary,
  lessonId: string,
  promptId: string,
  prompt: Prompt,
): string {
  let html = "";

  // ── 1. Prompt metadata ──────────────────────────────────────────────
  html += `
    <h1>Stress Test: ${escHtml(promptId)}</h1>
    <div class="card">
      <h2>Prompt Metadata</h2>
      <dl class="meta-grid">
        <dt>Lesson ID</dt><dd>${escHtml(summary.lessonId)}</dd>
        <dt>Lesson title</dt><dd>${escHtml(summary.lessonTitle)}</dd>
        <dt>Prompt ID</dt><dd>${escHtml(summary.promptId)}</dd>
        <dt>Prompt text</dt><dd>${escHtml(summary.promptText)}</dd>
        <dt>Mode</dt><dd>${modeBadge(summary.mode)}</dd>
        <dt>Deterministic pipeline</dt><dd>yes</dd>
        <dt>Cases</dt><dd>${summary.cases.length}</dd>
      </dl>
    </div>`;

  // ── Actions bar ─────────────────────────────────────────────────────
  const mdUrl = `/stress/markdown?lesson=${encodeURIComponent(lessonId)}&prompt=${encodeURIComponent(promptId)}`;
  html += `
    <div class="card">
      <h2>Actions</h2>
      <div class="actions">
        <a class="btn btn-primary" href="${escHtml(mdUrl)}" target="_blank">Download Markdown Report</a>
        <a class="btn" href="/stress?lesson=${encodeURIComponent(lessonId)}&prompt=${encodeURIComponent(promptId)}">Back to selector</a>
      </div>
    </div>`;

  // ── 2. Aggregate summary bar ────────────────────────────────────────
  html += `
    <div class="summary-bar">
      <span class="pass">PASS: ${summary.counts.pass}</span>
      <span class="warn">WARN: ${summary.counts.warn}</span>
      <span class="fail">FAIL: ${summary.counts.fail}</span>
      <span>Total: ${summary.cases.length}</span>
    </div>`;

  // ── 3. Case overview table ──────────────────────────────────────────
  html += `
    <div class="card">
      <h2>Case Overview</h2>
      <table>
        <thead><tr>
          <th>Case</th><th>Verdict</th><th>Issues</th><th>Turns</th>
          <th>Final Wrap</th><th>Summary Status</th><th>Fixture</th>
        </tr></thead>
        <tbody>`;

  for (const c of summary.cases) {
    const issueStr = c.issueCodes.length > 0 ? c.issueCodes.join(", ") : "—";
    const lastTurn = c.replayResult.turns[c.replayResult.turns.length - 1];
    const finalWrap = lastTurn?.wrapAction ?? "none";
    const fixtureUrl = `/stress/case-fixture?lesson=${encodeURIComponent(lessonId)}&prompt=${encodeURIComponent(promptId)}&case=${encodeURIComponent(c.name)}`;

    html += `<tr>
      <td><a href="#case-${escHtml(c.name)}">${escHtml(c.name)}</a></td>
      <td>${verdictBadge(c.verdict)}</td>
      <td>${escHtml(issueStr)}</td>
      <td>${c.turnCount}</td>
      <td>${chip("wrap", finalWrap, "chip-wrap")}</td>
      <td>${escHtml(c.replayResult.summaryStatus)}</td>
      <td><a class="btn" href="${escHtml(fixtureUrl)}" target="_blank">JSON</a></td>
    </tr>`;
  }
  html += `</tbody></table></div>`;

  // ── 4. Issue frequency table ────────────────────────────────────────
  const issueCounts: Record<string, number> = {};
  for (const c of summary.cases) {
    for (const code of c.issueCodes) {
      issueCounts[code] = (issueCounts[code] ?? 0) + 1;
    }
  }
  if (Object.keys(issueCounts).length > 0) {
    html += `
      <div class="card">
        <h2>Issue Frequency</h2>
        <table class="issue-freq">
          <thead><tr><th>Code</th><th>Count</th></tr></thead>
          <tbody>`;
    for (const [code, count] of Object.entries(issueCounts).sort((a, b) => b[1] - a[1])) {
      html += `<tr><td>${escHtml(code)}</td><td>${count}</td></tr>`;
    }
    html += `</tbody></table></div>`;
  }

  // ── 5. Expandable case detail panels ────────────────────────────────
  for (const c of summary.cases) {
    html += renderStressCaseDetail(c, lessonId, promptId, summary.mode);
  }

  return html;
}

function renderStressCaseDetail(
  c: CaseResult,
  lessonId: string,
  promptId: string,
  mode: string,
): string {
  const fixtureUrl = `/stress/case-fixture?lesson=${encodeURIComponent(lessonId)}&prompt=${encodeURIComponent(promptId)}&case=${encodeURIComponent(c.name)}`;

  let html = `
    <div class="card" id="case-${escHtml(c.name)}">
      <details>
        <summary>${escHtml(c.name)} ${verdictBadge(c.verdict)} — ${c.turnCount} turns, ${c.satisfiedCount}/${c.totalRequired} satisfied</summary>

        <p><em>${escHtml(c.description)}</em></p>

        <div class="actions" style="margin-bottom:0.75rem">
          <a class="btn" href="${escHtml(fixtureUrl)}" target="_blank">Download Fixture JSON</a>
        </div>`;

  // Transcript
  html += `<h3>Transcript</h3>`;
  const allTurns = c.replayResult.fixture.transcript ?? [];
  if (allTurns.length === 0) {
    html += `<p class="empty">No transcript turns.</p>`;
  } else {
    for (const t of allTurns) {
      const cls = t.role === "coach" ? "turn-coach" : "turn-student";
      const label = t.role === "coach" ? "Coach" : "Student";
      html += `<div class="transcript-turn ${cls}">
        <span class="turn-label">${label}</span> ${escHtml(t.message)}
      </div>`;
    }
  }

  // Replay table
  html += `<h3>Replay Analysis</h3>`;
  html += `<table class="replay-table"><thead><tr>
    <th>#</th><th>Utterance</th><th>State</th><th>Move</th><th>Strategy</th><th>Words</th><th>Wrap</th>
  </tr></thead><tbody>`;
  for (const t of c.replayResult.turns) {
    const utterance = t.studentMessage.length > 60
      ? t.studentMessage.slice(0, 59) + "…" : t.studentMessage;
    const stratLabel = t.strategyLevel ?? "—";
    const escalationTitle = t.escalationReason ? ` title="${escHtml(t.escalationReason)}"` : "";
    html += `<tr>
      <td>${t.turnNum}</td>
      <td class="truncate" title="${escHtml(t.studentMessage)}">${escHtml(utterance)}</td>
      <td>${chip("state", t.state, "chip-state")}</td>
      <td>${chip("move", t.moveType, "chip-move")}</td>
      <td${escalationTitle}>${chip("strategy", stratLabel, t.escalationReason ? "chip-state" : "")}</td>
      <td>${t.words}</td>
      <td>${chip("wrap", t.wrapAction, "chip-wrap")}</td>
    </tr>`;
  }
  html += `</tbody></table>`;

  // Audit issues
  if (c.issues.length > 0) {
    html += `<h3>Audit Issues (${c.issues.length})</h3>`;
    html += `<table><thead><tr><th>Severity</th><th>Code</th><th>Turn</th><th>Detail</th></tr></thead><tbody>`;
    for (const issue of c.issues) {
      const sevBadge = issue.severity === "high"
        ? `<span class="badge badge-fail">high</span>`
        : `<span class="badge badge-warn">medium</span>`;
      html += `<tr><td>${sevBadge}</td><td>${escHtml(issue.code)}</td>
        <td>${issue.turn ?? "—"}</td><td>${escHtml(issue.detail)}</td></tr>`;
    }
    html += `</tbody></table>`;
  }

  // Final outcome
  html += `<h3>Final Outcome</h3>`;
  const lastTurn = c.replayResult.turns[c.replayResult.turns.length - 1];
  html += `<dl class="meta-grid">
    <dt>Final wrap</dt><dd>${escHtml(lastTurn?.wrapAction ?? "none")}</dd>
    <dt>Summary status</dt><dd>${escHtml(c.replayResult.summaryStatus)}</dd>
    <dt>Satisfied</dt><dd>${c.satisfiedCount}/${c.totalRequired}</dd>
    <dt>Verdict</dt><dd>${verdictBadge(c.verdict)}</dd>
  </dl>`;

  if (c.replayResult.summaryRendered) {
    html += `<h3>Teacher Summary / Recap</h3>`;
    html += `<pre>${escHtml(c.replayResult.summaryRendered)}</pre>`;
  }

  html += `</details></div>`;
  return html;
}

// ============================================================================
// Per-prompt detail rendering (session review)
// ============================================================================

function renderPromptDetail(pa: PromptAnalysis): string {
  let html = `
    <div class="card" id="prompt-${escHtml(pa.promptId)}">
      <h2>Prompt: ${escHtml(pa.promptId)}</h2>
      <dl class="meta-grid">
        <dt>Text</dt><dd>${escHtml(pa.promptText)}</dd>
        <dt>Mode</dt><dd>${modeBadge(pa.mode)}</dd>
        <dt>Deterministic</dt><dd>${pa.deterministicPipeline ? "yes" : "no"}</dd>
        <dt>Transcript source</dt><dd>${escHtml(pa.transcriptSource)}</dd>
        <dt>Replay fidelity</dt><dd>${fidelityBadge(pa.replayFidelity)}</dd>
        <dt>Journey</dt><dd>${escHtml(pa.journeySummary)}</dd>
        <dt>Verdict</dt><dd>${verdictBadge(pa.verdict)}</dd>
        <dt>Promotion</dt><dd>${promotionBadge(pa.promotion)}</dd>
      </dl>`;

  // Transcript
  html += `<h3>Transcript (${pa.turns.length} turns)</h3>`;
  if (pa.turns.length === 0) {
    html += `<p class="empty">No conversation turns.</p>`;
  } else {
    for (const t of pa.turns) {
      const cls = t.role === "coach" ? "turn-coach" : "turn-student";
      const label = t.role === "coach" ? "Coach" : "Student";
      const ts = t.timestampSec != null ? ` <span class="badge badge-muted">${t.timestampSec}s</span>` : "";
      html += `<div class="transcript-turn ${cls}">
        <span class="turn-label">${label}${ts}</span> ${escHtml(t.message)}
      </div>`;
    }
  }

  // Replay analysis with per-turn chips
  if (pa.replayResult) {
    html += `<h3>Replay Analysis</h3>`;
    html += `<table class="replay-table"><thead><tr>
      <th>#</th><th>Utterance</th><th>State</th><th>Move</th><th>Strategy</th><th>Words</th><th>Wrap</th>
    </tr></thead><tbody>`;

    for (const t of pa.replayResult.turns) {
      const utterance = t.studentMessage.length > 60
        ? t.studentMessage.slice(0, 59) + "…"
        : t.studentMessage;
      const stratLabel = (t as any).strategyLevel ?? "—";
      const escalationTitle = (t as any).escalationReason ? ` title="${escHtml((t as any).escalationReason)}"` : "";
      html += `<tr>
        <td>${t.turnNum}</td>
        <td class="truncate" title="${escHtml(t.studentMessage)}">${escHtml(utterance)}</td>
        <td>${chip("state", t.state, "chip-state")}</td>
        <td>${chip("move", t.moveType, "chip-move")}</td>
        <td${escalationTitle}>${chip("strategy", stratLabel, (t as any).escalationReason ? "chip-state" : "")}</td>
        <td>${t.words}</td>
        <td>${chip("wrap", t.wrapAction, "chip-wrap")}</td>
      </tr>`;
    }
    html += `</tbody></table>`;

    // Turn details
    html += `<h3>Turn Details</h3>`;
    for (const t of pa.replayResult.turns) {
      html += `<div style="margin-bottom:0.5rem">`;
      html += `<strong>Turn ${t.turnNum}:</strong> "${escHtml(t.studentMessage.slice(0, 80))}"<br>`;

      if (pa.mode === "explanation") {
        html += `${chip("entities", (t.entitiesMatched ?? []).join(", ") || "(none)")} `;
        html += `${chip("pairs", (t.pairsExtracted ?? []).join(", ") || "(none)")} `;
        html += `${chip("accumulated", (t.accumulated ?? []).join(", ") || "(none)")} `;
        html += `${chip("no-progress", String(t.noProgress ?? 0))} `;
        if (t.incorrectPairs && t.incorrectPairs.length > 0) {
          html += `${chip("errors", t.incorrectPairs.join(", "), "chip-state")} `;
        }
      } else if (pa.mode === "math") {
        html += `${chip("satisfied", (t.satisfiedSteps ?? []).join(", ") || "(none)")} `;
        html += `${chip("missing", (t.missingSteps ?? []).join(", ") || "(none)")} `;
        html += `${chip("completion", ((t.completion ?? 0) * 100).toFixed(0) + "%")} `;
        html += `${chip("answer", String(t.extractedAnswer ?? "—"))} `;
        html += `${chip("correct", String(t.answerCorrect ?? "—"))} `;
      }

      html += `<br>${chip("state", t.state, "chip-state")} `;
      html += `${chip("move", t.moveType, "chip-move")} `;
      html += `${chip("wrap", t.wrapAction + (t.wrapReason ? ` (${t.wrapReason})` : ""), "chip-wrap")} `;
      html += `</div>`;
    }

    // Final outcome
    html += `<h3>Final Outcome</h3>`;
    const lastTurn = pa.replayResult.turns[pa.replayResult.turns.length - 1];
    html += `<dl class="meta-grid">
      <dt>Final wrap</dt><dd>${escHtml(lastTurn?.wrapAction ?? "none")}</dd>
      <dt>Summary status</dt><dd>${escHtml(pa.replayResult.summaryStatus)}</dd>
      <dt>Satisfied</dt><dd>${pa.replayResult.satisfiedCount}/${pa.replayResult.totalRequired}</dd>
      <dt>Verdict</dt><dd>${verdictBadge(pa.verdict)}</dd>
    </dl>`;

    // Audit issues
    if (pa.issues && pa.issues.length > 0) {
      html += `<h3>Audit Issues (${pa.issues.length})</h3>`;
      html += `<table><thead><tr><th>Severity</th><th>Code</th><th>Turn</th><th>Detail</th></tr></thead><tbody>`;
      for (const issue of pa.issues) {
        const sevBadge = issue.severity === "high"
          ? `<span class="badge badge-fail">high</span>`
          : `<span class="badge badge-warn">medium</span>`;
        html += `<tr><td>${sevBadge}</td><td>${escHtml(issue.code)}</td>
          <td>${issue.turn ?? "—"}</td><td>${escHtml(issue.detail)}</td></tr>`;
      }
      html += `</tbody></table>`;
    }
  } else if (pa.placeholderSkipped) {
    html += `<h3>Replay Analysis</h3>`;
    html += `<p class="empty">Replay unavailable — video transcript not captured.</p>`;
  } else {
    html += `<h3>Replay Analysis</h3>`;
    html += `<p class="empty">Deterministic replay not available for this prompt mode.</p>`;
  }

  // Promotion recommendation
  html += `<h3>Promotion Recommendation</h3>`;
  html += `<p>${promotionBadge(pa.promotion)} <strong>${escHtml(pa.promotion)}</strong></p>`;

  html += `</div>`;
  return html;
}

// ============================================================================
// CLI
// ============================================================================

function main(): void {
  const args = process.argv.slice(2);
  let port = DEFAULT_PORT;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port" && args[i + 1]) {
      port = parseInt(args[++i], 10);
    }
  }

  const app = createApp();
  app.listen(port, () => {
    console.log(`\n  Session Review Browser running at http://localhost:${port}\n`);
  });
}

if (require.main === module) {
  main();
}
