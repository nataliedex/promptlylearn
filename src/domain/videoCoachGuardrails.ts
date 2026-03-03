/**
 * Video Coach Guardrails (Server-Side)
 *
 * Pure deterministic functions ported from web/src/domain/videoCoachStateMachine.ts
 * for use in the combined /api/coach/video-turn endpoint. Keeps guardrail logic
 * server-side so the client doesn't need two round trips.
 */

import { PromptScope } from "./prompt";
import OpenAI from "openai";

export const CORRECT_THRESHOLD = 80;
export const MIN_ATTEMPTS_BEFORE_FAIL = 2;

const DEBUG_GUARDRAILS = true;

/**
 * Applied after getCoachFeedback returns a score.
 * Enforces the hard guardrail: never end on first failed attempt.
 * Returns probeFirst=true when the answer is correct but the coach should
 * ask one Socratic follow-up before advancing to the next question.
 *
 * When criteriaStatus is provided (assessment rubric present), mastery
 * decisions use criteria evaluation instead of score alone:
 * - "strong" (all criteria met): skip probeFirst, allow direct close
 * - "developing"/"needs_support": continue probing for missing criteria
 */
export function resolvePostEvaluation(
  evalResult: { score: number; isCorrect: boolean; shouldContinue: boolean },
  attemptCount: number,
  maxAttempts: number,
  followUpCount: number = 0,
  criteriaStatus?: "strong" | "developing" | "needs_support",
  timeRemainingSec?: number,
): { shouldContinue: boolean; probeFirst: boolean } {
  // CRITERIA-AWARE PATH: When all criteria are met, student has demonstrated
  // mastery — end cleanly. Students submit first; coaching happens after via Ask Coach.
  if (criteriaStatus === "strong" && evalResult.score >= CORRECT_THRESHOLD) {
    if (DEBUG_GUARDRAILS) {
      console.log(`[resolvePostEval] criteriaStatus=strong — mastery achieved, ending`);
    }
    return { shouldContinue: false, probeFirst: false };
  }

  // Correct answer: allow one probe before ending
  if (evalResult.score >= CORRECT_THRESHOLD) {
    // If criteria exist and some are missing, probe for them specifically
    if (criteriaStatus === "developing" && followUpCount === 0) {
      if (DEBUG_GUARDRAILS) {
        console.log("[resolvePostEval] criteriaStatus=developing, score correct — probing for missing criteria");
      }
      return { shouldContinue: true, probeFirst: true };
    }
    if (followUpCount === 0) {
      return { shouldContinue: true, probeFirst: true };
    }
    return { shouldContinue: false, probeFirst: false };
  }

  // HARD GUARDRAIL: Incorrect on first attempt -> NEVER end
  if (attemptCount < MIN_ATTEMPTS_BEFORE_FAIL) {
    return { shouldContinue: true, probeFirst: false };
  }

  // Incorrect and max attempts reached: end
  if (attemptCount + 1 >= maxAttempts) {
    return { shouldContinue: false, probeFirst: false };
  }

  // Incorrect, not first, not max: continue
  return { shouldContinue: true, probeFirst: false };
}

/**
 * Detect LLM wording that implies ending the conversation.
 * Used to override coach text when shouldContinue=true.
 * IMPORTANT: Must include ALL transition patterns — a gap here caused
 * the "move on + hint" contradiction bug.
 */
export function containsEndingLanguage(text: string): boolean {
  const endingPatterns = [
    /let'?s\s+move\s+on/i,
    /let'?s\s+go\s+to\s+the\s+next/i,
    /let'?s\s+continue/i,
    /you'?ve\s+completed/i,
    /revisit\s+(this\s+)?later/i,
    /we'?re\s+done/i,
    /moving\s+on\s+to\s+the\s+next/i,
    /move\s+on\s+to\s+the\s+next/i,
    /on\s+to\s+the\s+next/i,
    /next\s+question/i,
    /we'?ll\s+move\s+on/i,
    /that'?s\s+(?:okay|ok|alright)[!.]?\s*let'?s\s+move/i,
    /that\s+wraps\s+up/i,
  ];
  return endingPatterns.some((p) => p.test(text));
}

/**
 * Detect LLM wording that incorrectly praises the student as correct.
 * Used to override coach text when score < CORRECT_THRESHOLD.
 */
export function containsCorrectLanguage(text: string): boolean {
  const correctPatterns = [
    /\bcorrect\b/i,
    /\bgreat\s+job\b/i,
    /\byou\s+got\s+it\b/i,
    /\bexactly\b/i,
    /\bperfect\b/i,
    /\bthat'?s\s+right\b/i,
    /\bwell\s+done\b/i,
    /\bnice\s+work\b/i,
    /\bexcellent\b/i,
    /\bnailed\s+it\b/i,
    /\bspot\s+on\b/i,
  ];
  return correctPatterns.some((p) => p.test(text));
}

/**
 * Detect if a student response is on-topic but clipped/garbled.
 * Returns true when the student said something relevant (1+ content words
 * overlapping scope keywords) but didn't say enough (< 5 total content words).
 * In this case, Clarify mode is more appropriate than "try a different angle."
 */
export function detectOnTopicButClipped(
  studentResponse: string,
  resolvedScope: PromptScope | null
): boolean {
  if (!resolvedScope || !studentResponse) return false;

  const words = studentResponse
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !FRUSTRATION_FILLER.has(w));

  if (words.length === 0 || words.length >= 5) return false;

  const scopeWords = new Set(resolvedScope.allowedKeywords.map((k) => k.toLowerCase()));
  const hasOverlap = words.some((w) => scopeWords.has(w));
  return hasOverlap;
}

/**
 * Build a deterministic retry prompt based on the question text.
 * Uses attemptCount to vary the prompt — NEVER repeats the same line.
 *
 * If studentResponse + resolvedScope are provided, detects on-topic-but-clipped
 * responses and uses Clarify mode instead of redirect.
 */
export function buildRetryPrompt(
  questionText: string,
  attemptCount: number = 0,
  studentResponse?: string,
  resolvedScope?: PromptScope | null
): string {
  const lower = questionText.toLowerCase();

  if (/\bthree\b/.test(lower) || /\bat\s+least\s+three\b/.test(lower)) {
    const threeVariants = [
      "Try naming three examples. What can you think of?",
      "Can you think of even one example to start with?",
      "What's one thing you can think of that relates to this?",
    ];
    return threeVariants[attemptCount % threeVariants.length];
  }

  // Clarify mode: student was on-topic but clipped/garbled
  const scope = resolvedScope !== undefined ? resolvedScope : resolvePromptScope(questionText);
  if (studentResponse && detectOnTopicButClipped(studentResponse, scope)) {
    const clarifyVariants = [
      "I caught some of what you were saying. Can you say that one more time?",
      "Sounds like you have an idea about this. What's the main point you're trying to make?",
      "I heard a little bit of that. Can you finish this thought for me?",
    ];
    return clarifyVariants[attemptCount % clarifyVariants.length];
  }

  // Standard retry (no "different angle" — that's only for stagnation)
  const variants = [
    "Tell me one example first. What comes to mind?",
    "Let's start simpler — what's one thing you know about this topic?",
    "Think about what you already know. What's the first thing that comes to mind?",
  ];
  return variants[attemptCount % variants.length];
}

// ============================================
// FRUSTRATION / STAGNATION DETECTION & REPAIR
// ============================================

/** Content-word extraction for frustration remainder check. */
const FRUSTRATION_FILLER = new Set([
  "um","uh","hmm","like","well","so","yeah","yep","ok","okay",
  "basically","right","just","really","very","the","a","an","is","are",
  "was","were","it","its","i","my","me","you","your","this","that",
  "and","or","but","to","of","in","on","for","with","do","dont",
  "does","doesnt","did","didnt","have","has","had","not","no",
  "know","because","think","about","answer",
]);

function countContentWordsAfterMatch(text: string, matchEnd: number): number {
  const remainder = text.slice(matchEnd);
  return remainder
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !FRUSTRATION_FILLER.has(w))
    .length;
}

/**
 * Detect frustration, disengagement, or meta-complaints from the student.
 * These should NOT be scored as answers — they need empathetic repair.
 *
 * IMPORTANT: If a frustration phrase appears but the remainder of the
 * utterance contains >= 5 content words, the student is reasoning
 * through uncertainty (e.g., "I don't really know but the planets
 * closer to the sun are rocky"). This is NOT frustration.
 *
 * Examples of true frustration: "this is ridiculous", "you're not listening",
 * "I don't want to do this", "ugh", "whatever"
 */
export function detectFrustration(studentResponse: string): boolean {
  const lower = studentResponse.trim().toLowerCase();

  const frustrationPatterns: RegExp[] = [
    // Complaints about the question or task
    /\b(?:this\s+is\s+)?(?:ridiculous|stupid|dumb|boring|pointless|lame|terrible)\b/i,
    /\bwhat(?:'s|\s+is)\s+the\s+point\b/i,
    /\bi\s+(?:don'?t|do\s+not)\s+(?:want|care|like)\b/i,
    /\bi\s+(?:don'?t|do\s+not)\s+(?:really\s+)?know\b/i,
    /\bi\s+(?:hate|can'?t\s+do)\s+this\b/i,
    /\bthis\s+(?:doesn'?t|does\s+not)\s+make\s+sense\b/i,

    // Complaints about the coach
    /\byou'?re\s+not\s+listening\b/i,
    /\byou\s+(?:don'?t|never)\s+(?:listen|understand|hear)\b/i,
    /\bi\s+already\s+(?:said|told|answered)\b/i,
    /\byou\s+(?:already\s+)?asked\s+(?:me\s+)?(?:this|that)\b/i,
    /\bstop\s+(?:asking|repeating)\b/i,
    /\bsame\s+(?:question|thing)\b/i,

    // Disengagement signals
    /^(?:ugh+|arg+h?|blah+|whatever|idk|meh|nah)\b/i,
    /\bi\s+(?:give\s+up|quit|surrender)\b/i,
    /\bjust\s+(?:stop|move\s+on|skip)\b/i,
    /\bforget\s+(?:it|this)\b/i,
    /\bnever\s*mind\b/i,
  ];

  for (const pattern of frustrationPatterns) {
    const match = pattern.exec(lower);
    if (match) {
      const matchEnd = match.index + match[0].length;
      const substantiveAfter = countContentWordsAfterMatch(lower, matchEnd);
      const detected = substantiveAfter < 5;

      if (DEBUG_GUARDRAILS) {
        console.log("[frustration-check]", { detected, substantive: substantiveAfter, phrase: match[0] });
      }

      if (!detected) {
        return false;
      }
      return true;
    }
  }

  return false;
}

/**
 * Build an empathetic repair response for frustrated/disengaged students.
 * Varies by attempt count to avoid repeating the same repair.
 * Always redirects constructively — never repeats the original prompt verbatim.
 */
export function buildRepairResponse(questionText: string, attemptCount: number): string {
  // Use scope-aligned probes if available for a gentler redirect
  const scope = resolvePromptScope(questionText);

  const repairs = [
    // Repair 0: Acknowledge + gentle redirect
    scope
      ? `I hear you — let's try something easier. ${scope.scopeAlignedProbes[0]}`
      : "I hear you — let's try something easier. What's one thing you already know about this topic?",
    // Repair 1: Validate + simplify
    scope
      ? `That's okay, this can be tricky! Let me ask it differently: ${scope.scopeAlignedProbes[1 % scope.scopeAlignedProbes.length]}`
      : "That's okay, this can be tricky! Just tell me one thing you think might be true about this.",
    // Repair 2: Empathize + offer escape hatch
    "I understand — sometimes questions are tough. Would you like a hint, or should we move on?",
  ];

  return repairs[attemptCount % repairs.length];
}

// ============================================
// CONCEPT TYPE CLASSIFICATION
// ============================================

export type ConceptType = "observable" | "abstract" | "opinion_repair";

/**
 * Classify the concept being discussed as observable, abstract, or opinion/repair.
 *
 * Observable: things you can see, touch, hear, feel (weather, animals, physical objects)
 * Abstract: scientific processes, mechanisms, invisible forces, math reasoning
 * Opinion/repair: preferences, feelings, frustration, metacognitive
 *
 * NOTE: Only classifies as "abstract" for genuine processes/mechanisms.
 * "solar system" is NOT abstract — it's an observable/spatial topic.
 */
export function classifyConceptType(questionText: string, studentAnswer: string): ConceptType {
  const combined = `${questionText} ${studentAnswer}`.toLowerCase();

  // Opinion / affect / repair (check first — most specific intent)
  const opinionPatterns = [
    /\bfeel(?:s|ing)?\b/i, /\bopinion\b/i, /\bthink\s+about\b/i,
    /\bprefer/i, /\bfavorite\b/i, /\blike\s+(?:best|most|better)/i,
    /\bfrustrat/i, /\bbor(?:ed|ing)\b/i, /\bconfus/i,
    /i\s+don'?t\s+(?:like|want|care)/i,
    /\bwhat\s+(?:do\s+you|would\s+you)\s+(?:think|feel)/i,
  ];
  if (opinionPatterns.some((p) => p.test(combined))) {
    return "opinion_repair";
  }

  // Abstract processes and mechanisms — SPECIFIC terms only.
  // Removed overly broad patterns: /\bsystem\b/, /\bsteps?\b/,
  // /\bcause/i, /\beffect/i, /\bresult\b/ that matched non-abstract contexts.
  const abstractPatterns = [
    /photosynthes/i, /evaporat/i, /condens/i,
    /energy\s+(?:transfer|convert|transform)/i, /chemical\s+(?:reaction|change)/i,
    /digest/i, /metabol/i, /cell\s+divis/i, /mitosis/i, /meiosis/i,
    /electri(?:city|cal)/i, /magnet(?:ism|ic)/i, /friction/i, /erosion/i, /weathering/i,
    /water\s+cycle/i, /rock\s+cycle/i, /food\s+(?:chain|web)/i,
    /ecosystem/i, /adapt(?:ation)/i, /evolution/i,
    /multipl(?:y|ication)/i, /divis(?:ion|ible)/i, /fraction/i,
    /equation/i, /algorithm/i,
    /\bmechanism/i, /\bexplain\s+(?:how|why)\s+\w+\s+(?:work|happen)/i,
    /\btransform/i, /\bconvert/i,
  ];
  if (abstractPatterns.some((p) => p.test(combined))) {
    return "abstract";
  }

  // Observable: default for concrete, spatial, tangible topics
  // (includes solar system, weather, animals, physical objects)
  return "observable";
}

// ============================================
// TOPIC SCOPE GUARDRAILS
// ============================================

// Re-export PromptScope from domain/prompt for consumers that imported it from here
export type { PromptScope } from "./prompt";

/**
 * Legacy regex-based scope table. Used as fallback when:
 * - prompt.scope is not defined in the lesson JSON
 * - LLM-generated scope is not cached
 * - Heuristic fallback is not sufficient
 *
 * Will shrink over time as prompts get authored scope metadata.
 */
const LEGACY_PROMPT_SCOPES: Array<{ match: RegExp; scope: PromptScope }> = [
  {
    match: /\bsun\b.*\bplanet/i,
    scope: {
      allowedKeywords: [
        "sun", "planets", "solar system", "orbit", "gravity", "light",
        "heat", "warmth", "distance", "temperature", "seasons", "day",
        "night", "energy", "earth", "mercury", "venus", "mars", "jupiter",
        "saturn", "uranus", "neptune", "star", "rotation", "revolution",
      ],
      offScopeKeywords: [
        "photosynthesis steps", "chlorophyll", "calvin cycle", "stomata",
        "glucose production", "cell membrane", "mitochondria", "atp",
        "carbon fixation", "light reactions", "thylakoid",
        "weather patterns", "weather forecast", "cloud formation",
      ],
      // Combined list (backward compat — primary + secondary[0])
      scopeAlignedProbes: [
        "Besides warmth, what does the sun do that keeps planets in orbit?",
        "How does distance from the sun change what a planet is like?",
        "What might happen to planets if the sun disappeared?",
        "Why do some planets end up too hot or too cold?",
        "Plants need sunlight — how does that show the sun is important for Earth compared to other planets?",
      ],
      // Primary probes in PREFERRED ORDER (findUnusedProbe iterates sequentially):
      //   1. Gravity/orbits
      //   2. Distance → temperature
      //   3. Energy/light broadly (disappear scenario)
      //   4. Temperature extremes
      scopeAlignedProbesPrimary: [
        "Besides warmth, what does the sun do that keeps planets in orbit?",
        "How does distance from the sun change what a planet is like?",
        "What might happen to planets if the sun disappeared?",
        "Why do some planets end up too hot or too cold?",
      ],
      // Secondary (Earth-life bridge) — allowed AT MOST once, only if student leads into it
      scopeAlignedProbesSecondary: [
        "Plants need sunlight — how does that show the sun is important for Earth compared to other planets?",
      ],
      // Once any of these keywords appear in asked history, block secondary probes
      bridgeOnceKeywords: [
        "plants", "photosynthesis", "plants need sunlight", "growing",
        "plants grow", "sunlight for plants",
      ],
    },
  },
];

/** Match the legacy regex table against question text. */
function getLegacyPromptScope(questionText: string): PromptScope | null {
  for (const entry of LEGACY_PROMPT_SCOPES) {
    if (entry.match.test(questionText)) {
      return entry.scope;
    }
  }
  return null;
}

// ============================================
// IN-MEMORY SCOPE CACHE (keyed by prompt text)
// ============================================

const scopeCache = new Map<string, PromptScope>();

/** Normalize question text to a stable cache key. */
function scopeCacheKey(questionText: string): string {
  return questionText.trim().toLowerCase();
}

/** Get a cached scope (from LLM generation or heuristic). */
export function getCachedScope(questionText: string): PromptScope | null {
  return scopeCache.get(scopeCacheKey(questionText)) ?? null;
}

/** Store a scope in the cache. */
export function setCachedScope(questionText: string, scope: PromptScope): void {
  scopeCache.set(scopeCacheKey(questionText), scope);
}

// ============================================
// HEURISTIC SCOPE BUILDER (zero-latency fallback)
// ============================================

/**
 * Extract a basic scope from the prompt text using keyword heuristics.
 * Not as good as LLM-generated scope, but provides coverage for
 * every prompt with zero latency and no API cost.
 */
export function buildHeuristicScope(questionText: string): PromptScope {
  const lower = questionText.toLowerCase();
  const words = lower.replace(/[^\w\s]/g, "").split(/\s+/).filter(w => w.length > 2);

  // Remove stop words
  const stopWords = new Set([
    "the", "and", "for", "are", "but", "not", "you", "all", "can", "had",
    "her", "was", "one", "our", "out", "has", "have", "from", "they",
    "been", "said", "each", "which", "their", "will", "other", "about",
    "many", "then", "them", "these", "some", "would", "make", "like",
    "into", "could", "time", "very", "when", "come", "made", "after",
    "how", "what", "why", "think", "explain", "describe", "tell",
    "your", "does", "this", "that", "with", "important",
  ]);

  const contentWords = words.filter(w => !stopWords.has(w));

  // Extract 2-word phrases from the question
  const phrases: string[] = [];
  const questionWords = lower.replace(/[^\w\s]/g, "").split(/\s+/);
  for (let i = 0; i < questionWords.length - 1; i++) {
    const phrase = `${questionWords[i]} ${questionWords[i + 1]}`;
    if (!stopWords.has(questionWords[i]) || !stopWords.has(questionWords[i + 1])) {
      phrases.push(phrase);
    }
  }

  // allowedKeywords = content words + phrases from the question
  const allowedKeywords = [...new Set([...contentWords, ...phrases])].slice(0, 25);

  // Generic off-scope terms (common LLM drift patterns for educational topics)
  const genericOffScope = [
    "step by step", "steps of", "detailed mechanism",
    "molecular level", "chemical formula", "equation",
    "advanced physics", "calculus", "algebra",
    "college level", "graduate level",
  ];

  // Build generic probes from the question structure
  const probes = buildHeuristicProbes(questionText, contentWords);

  return {
    allowedKeywords,
    offScopeKeywords: genericOffScope,
    scopeAlignedProbes: probes,
    topicTags: contentWords.slice(0, 5),
  };
}

/** Generate 5 heuristic probes based on question structure and keywords. */
function buildHeuristicProbes(questionText: string, keywords: string[]): string[] {
  const kw = keywords.slice(0, 3).join(" and ");
  const topic = keywords[0] || "this topic";

  const templates = [
    `What's one thing you already know about ${topic}?`,
    `Can you give me an example that relates to ${kw}?`,
    `Why do you think ${topic} matters?`,
    `What would be different without ${topic}?`,
    `How would you explain ${topic} to a friend?`,
  ];

  return templates;
}

// ============================================
// LLM SCOPE GENERATION (high-quality, cached)
// ============================================

/**
 * Generate a high-quality PromptScope using an LLM call.
 * Results are cached in memory so this runs at most once per prompt.
 *
 * Call this at lesson-build time or on first request for a prompt.
 * Returns null if no OpenAI client is available.
 */
export async function generatePromptScope(
  client: OpenAI,
  questionText: string,
  gradeLevel: string = "elementary"
): Promise<PromptScope> {
  // Check cache first
  const cached = getCachedScope(questionText);
  if (cached) return cached;

  const systemPrompt = `You are an educational content expert. Given a student question, generate topic-scope metadata to keep a coaching conversation focused.

Return ONLY valid JSON with this exact structure:
{
  "allowedKeywords": ["keyword1", "keyword2", ...],
  "offScopeKeywords": ["drift_term1", "drift_term2", ...],
  "scopeAlignedProbes": ["Probe question 1?", "Probe question 2?", ...],
  "topicTags": ["tag1", "tag2", ...]
}

Rules:
- allowedKeywords (15-25): words/phrases the coach SHOULD discuss. Include the main topic, related concepts, and age-appropriate vocabulary for ${gradeLevel}.
- offScopeKeywords (10-20): common topics an LLM might drift into that are OFF-LIMITS. Think about what a chatbot would incorrectly deep-dive into.
- scopeAlignedProbes (5-8): Socratic follow-up questions that stay ON topic. These must be age-appropriate for ${gradeLevel}, end with "?", and help the student think deeper about the ACTUAL question.
- topicTags (3-5): short labels for the topic area.

Do NOT include markdown formatting, code fences, or explanation. Just the JSON object.`;

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Question: "${questionText}"` },
      ],
      temperature: 0.3,
      max_tokens: 800,
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) throw new Error("Empty LLM response");

    // Strip markdown fences if present
    const jsonStr = content.replace(/^```json?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
    const parsed = JSON.parse(jsonStr);

    // Validate structure
    const scope: PromptScope = {
      allowedKeywords: Array.isArray(parsed.allowedKeywords) ? parsed.allowedKeywords : [],
      offScopeKeywords: Array.isArray(parsed.offScopeKeywords) ? parsed.offScopeKeywords : [],
      scopeAlignedProbes: Array.isArray(parsed.scopeAlignedProbes) ? parsed.scopeAlignedProbes : [],
      topicTags: Array.isArray(parsed.topicTags) ? parsed.topicTags : undefined,
    };

    // Sanity check: must have at least some content
    if (scope.allowedKeywords.length < 3 || scope.scopeAlignedProbes.length < 2) {
      throw new Error("LLM scope too sparse");
    }

    // Cache it
    setCachedScope(questionText, scope);

    if (DEBUG_GUARDRAILS) {
      console.log(`[guardrail] LLM scope generated for "${questionText.slice(0, 50)}..." — ` +
        `${scope.allowedKeywords.length} allowed, ${scope.offScopeKeywords.length} off-scope, ` +
        `${scope.scopeAlignedProbes.length} probes`);
    }

    return scope;
  } catch (err) {
    console.error("[guardrail] LLM scope generation failed, using heuristic:", err);
    const fallback = buildHeuristicScope(questionText);
    setCachedScope(questionText, fallback);
    return fallback;
  }
}

// ============================================
// RESOLVED SCOPE (the main entry point)
// ============================================

/**
 * Resolve the scope for a prompt using the priority chain:
 *   1. prompt.scope (authored in lesson JSON) — highest priority
 *   2. In-memory cache (from prior LLM generation)
 *   3. Legacy regex table (hardcoded fallback)
 *   4. null (no scope — caller decides whether to use heuristic)
 *
 * This is synchronous. For LLM generation, call generatePromptScope()
 * separately (e.g., at lesson load or first request) then results will
 * be available here via the cache.
 */
export function resolvePromptScope(
  questionText: string,
  promptScope?: PromptScope
): PromptScope | null {
  // 1. Authored scope from lesson JSON
  if (promptScope) return promptScope;

  // 2. Cached scope (LLM-generated or heuristic)
  const cached = getCachedScope(questionText);
  if (cached) return cached;

  // 3. Legacy regex table
  return getLegacyPromptScope(questionText);
}

/**
 * @deprecated Use resolvePromptScope() instead. Kept for backward compatibility.
 */
export function getPromptScope(questionText: string): PromptScope | null {
  return resolvePromptScope(questionText);
}

/**
 * Detect if a question asks for "steps" — banned unless the prompt itself is procedural.
 * Returns true if the text asks for steps/step-by-step.
 */
export function containsStepsQuestion(text: string): boolean {
  return /\b(?:what\s+are\s+the\s+)?steps?\b/i.test(text) ||
    /\bstep[\s-]+by[\s-]+step\b/i.test(text);
}

/**
 * Check if the original PROMPT is explicitly procedural (asks for steps itself).
 */
function isProceduralPrompt(questionText: string): boolean {
  return /\b(?:explain\s+the\s+steps|describe\s+the\s+(?:steps|process|procedure)|what\s+are\s+the\s+steps|step[\s-]+by[\s-]+step)\b/i.test(questionText);
}

/**
 * Check whether coach text has drifted off the prompt's allowed scope.
 * Returns null if on-scope (or no scope defined), or a replacement probe if off-scope.
 *
 * @param resolvedScope - Pre-resolved scope (from resolvePromptScope). If not provided,
 *   falls back to resolvePromptScope(questionText) for backward compatibility.
 */
export function enforceTopicScope(
  coachText: string,
  questionText: string,
  studentAnswer: string,
  resolvedScope?: PromptScope | null
): string | null {
  const scope = resolvedScope !== undefined ? resolvedScope : resolvePromptScope(questionText);
  if (!scope) return null;

  const coachLower = coachText.toLowerCase();

  // Check for off-scope keywords in coach output
  const hasOffScope = scope.offScopeKeywords.some((kw) =>
    coachLower.includes(kw.toLowerCase())
  );

  // Check for "steps" question on a non-procedural prompt
  const hasBannedSteps = containsStepsQuestion(coachText) && !isProceduralPrompt(questionText);

  // Check if the follow-up question is about a biology mechanism
  const asksBiologyDeepDive = /\bhow\s+does\s+(?:photosynthesis|chlorophyll|the\s+plant)\s+(?:work|happen|function)/i.test(coachText);

  if (hasOffScope || hasBannedSteps || asksBiologyDeepDive) {
    // Pick a scope-aligned probe deterministically
    const idx = (questionText.length + studentAnswer.length) % scope.scopeAlignedProbes.length;
    const probe = scope.scopeAlignedProbes[idx];

    if (DEBUG_GUARDRAILS) {
      console.log(
        "[guardrail] Off-scope detected" +
        (hasOffScope ? " (keyword)" : "") +
        (hasBannedSteps ? " (steps-on-non-procedural)" : "") +
        (asksBiologyDeepDive ? " (bio-deep-dive)" : "") +
        " → replacing with: " + probe
      );
    }

    return probe;
  }

  return null;
}

// ============================================
// SAFE PROBE BUILDER (scope-aware replacement)
// ============================================

/**
 * Build a safe replacement probe. Scope-aware: if a prompt scope exists,
 * always uses scope-aligned probes. Never produces "steps" questions
 * for non-procedural prompts.
 *
 * This is THE function all rewrite paths should use for replacements.
 *
 * @param resolvedScope - Pre-resolved scope. If not provided, falls back to
 *   resolvePromptScope(questionText).
 */
export function buildSafeProbe(
  questionText: string,
  studentAnswer: string,
  resolvedScope?: PromptScope | null,
  askedCoachQuestions?: string[]
): string {
  // Priority 1: If a prompt scope exists, use scope-aligned probes
  const scope = resolvedScope !== undefined ? resolvedScope : resolvePromptScope(questionText);
  if (scope && scope.scopeAlignedProbes.length > 0) {
    // If we have asked history, use findUnusedProbe for dedup-aware selection
    if (askedCoachQuestions && askedCoachQuestions.length > 0) {
      return findUnusedProbe(scope, askedCoachQuestions, studentAnswer);
    }
    const idx = (questionText.length + studentAnswer.length) % scope.scopeAlignedProbes.length;
    return scope.scopeAlignedProbes[idx];
  }

  // Priority 2: Use concept-type probes (no "steps" for non-procedural)
  const conceptType = classifyConceptType(questionText, studentAnswer);
  return buildConceptProbe(conceptType, questionText, studentAnswer);
}

/**
 * Build a concept-appropriate Socratic probe.
 * NEVER generates "steps" questions — those are only valid for explicitly
 * procedural prompts, and scope-aligned probes handle those.
 */
export function buildConceptProbe(
  conceptType: ConceptType,
  questionText: string,
  studentAnswer: string
): string {
  switch (conceptType) {
    case "observable": {
      if (/describe|explain/i.test(questionText)) {
        return "What would you notice if you were watching it happen?";
      }
      return "Can you describe what that would look like?";
    }

    case "abstract": {
      // No "steps" probes — they derail non-procedural conversations.
      const mechanismProbes = [
        "What has to happen first for that to work?",
        "What goes in and what comes out?",
        "How would you know it happened if you couldn't see it?",
        "Why does that happen?",
      ];
      const idx = questionText.length % mechanismProbes.length;
      return mechanismProbes[idx];
    }

    case "opinion_repair": {
      return "What makes you feel that way about it?";
    }
  }
}

/**
 * Build a deterministic Socratic probe when the LLM fails to include one.
 * Scope-aware: always prefers scope-aligned probes when available.
 */
export function buildProbeFromQuestion(
  questionText: string,
  studentAnswer: string,
  resolvedScope?: PromptScope | null
): string {
  return buildSafeProbe(questionText, studentAnswer, resolvedScope);
}

// ============================================
// VERBATIM ECHO DETECTION AND REWRITING
// ============================================

/** Strip speech fillers and normalize text for comparison. */
function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    // Strip common speech fillers (expanded set)
    .replace(/\b(?:um+|uh+|like|you know|well|so|basically|i think|i guess|yeah|yep|ok|okay|right|and and|the the)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract word array from normalized text. */
function toWords(text: string): string[] {
  return normalizeForComparison(text).split(/\s+/).filter(w => w.length > 0);
}

/** Build set of all bigrams from a word array. */
function toBigrams(words: string[]): Set<string> {
  const bigrams = new Set<string>();
  for (let i = 0; i < words.length - 1; i++) {
    bigrams.add(`${words[i]} ${words[i + 1]}`);
  }
  return bigrams;
}

/**
 * Detect if coach text parrots the student's answer.
 *
 * Triggers on ANY of:
 *   1. Attribution phrases: "You mentioned", "You said", "When you said"
 *   2. Leading-wrapper echo: question starts with "How does"/"Why does"/etc
 *      and the next 12 words contain 3+ consecutive student words
 *   3. 4+ consecutive word overlap ANYWHERE (after filler normalization)
 *   4. Bigram overlap ratio > 0.30
 */
export function detectVerbatimEcho(coachText: string, studentAnswer: string): boolean {
  const coachNorm = normalizeForComparison(coachText);
  const studentNorm = normalizeForComparison(studentAnswer);
  const studentWords = studentNorm.split(/\s+/).filter(w => w.length > 0);
  const coachWords = coachNorm.split(/\s+/).filter(w => w.length > 0);

  // --- Pattern 1: Attribution phrases ---
  if (/\byou\s+(?:mentioned|said|stated|told\s+me)\b/i.test(coachText)) {
    if (DEBUG_GUARDRAILS) console.log("[guardrail] echo detected: attribution phrase");
    return true;
  }
  if (/\bwhen\s+you\s+said\b/i.test(coachText)) {
    if (DEBUG_GUARDRAILS) console.log("[guardrail] echo detected: 'when you said'");
    return true;
  }

  // --- Pattern 2: Leading-wrapper echo ---
  // "How does <student text> work", "Why does <student text> happen", etc.
  // Threshold: 3+ consecutive student words within first 12 words after the leader
  const leadingPatterns = [
    /^how\s+does\s+/i,
    /^why\s+does\s+/i,
    /^what\s+about\s+/i,
    /^can\s+you\s+explain\s+/i,
    /^so\s+/i,
    /^you\s+think\s+(?:that\s+)?/i,
    /^when\s+you\s+say\s+/i,
  ];
  for (const pattern of leadingPatterns) {
    const match = coachNorm.match(pattern);
    if (match) {
      const afterLeading = coachNorm.slice(match[0].length);
      const afterWords = afterLeading.split(/\s+/).filter(w => w.length > 0);
      const windowWords = afterWords.slice(0, 12); // first 12 words after leader

      if (studentWords.length >= 3 && windowWords.length >= 3) {
        // Check for any 3+ consecutive student words in this window
        const windowJoined = windowWords.join(" ");
        for (let i = 0; i <= studentWords.length - 3; i++) {
          const seq = studentWords.slice(i, i + 3).join(" ");
          if (windowJoined.includes(seq)) {
            if (DEBUG_GUARDRAILS) {
              console.log(`[guardrail] echo detected: leading-wrapper "${match[0].trim()}" + student seq "${seq}"`);
            }
            return true;
          }
        }
      }
    }
  }

  // --- Pattern 3: 4+ consecutive word overlap ANYWHERE ---
  if (studentWords.length >= 4) {
    const coachJoined = coachWords.join(" ");
    for (let i = 0; i <= studentWords.length - 4; i++) {
      const seq = studentWords.slice(i, i + 4).join(" ");
      if (coachJoined.includes(seq)) {
        if (DEBUG_GUARDRAILS) {
          console.log(`[guardrail] echo detected: 4-word overlap "${seq}"`);
        }
        return true;
      }
    }
  }

  // --- Pattern 4: Bigram overlap ratio > 0.30 ---
  if (studentWords.length >= 4) {
    const studentBigrams = toBigrams(studentWords);
    const coachBigrams = toBigrams(coachWords);
    if (studentBigrams.size > 0) {
      let overlapCount = 0;
      for (const bigram of studentBigrams) {
        if (coachBigrams.has(bigram)) {
          overlapCount++;
        }
      }
      const ratio = overlapCount / studentBigrams.size;
      if (ratio > 0.30) {
        if (DEBUG_GUARDRAILS) {
          console.log(`[guardrail] echo detected: bigram ratio ${(ratio * 100).toFixed(0)}%`);
        }
        return true;
      }
    }
  }

  return false;
}

/**
 * Rewrite a coach response that parrots the student.
 * Always falls back to buildSafeProbe (scope-aware).
 */
export function rewriteEchoingResponse(
  coachText: string,
  studentAnswer: string,
  questionText: string,
  resolvedScope?: PromptScope | null
): string {
  // Try to salvage the non-echoing part of the response
  let cleaned = coachText
    // Strip "You mentioned..." / "You said..." clauses
    .replace(/\byou\s+(?:mentioned|said|stated|told\s+me)\s+(?:that\s+)?[^.!?]*[.!?]?\s*/gi, "")
    .replace(/\bwhen\s+you\s+said\s+[^.!?]*[.!?]?\s*/gi, "")
    // Strip "How does <long text> work/happen" wrappers
    .replace(/^how\s+does\s+[^?]*\?/i, "")
    .replace(/^why\s+does\s+[^?]*\?/i, "")
    // Strip "So <long text>..." leading
    .replace(/^so\s+[^.!?]*[.!?]?\s*/i, "")
    .trim();

  // If the remainder is a clean, non-echoing question, keep it —
  // BUT also verify it passes scope and steps checks
  if (cleaned.length > 10 && cleaned.includes("?")) {
    if (!detectVerbatimEcho(cleaned, studentAnswer)) {
      // Also reject if it contains banned "steps" on non-procedural prompt
      if (!containsStepsQuestion(cleaned) || isProceduralPrompt(questionText)) {
        // Also reject if off-scope
        const scopeRewrite = enforceTopicScope(cleaned, questionText, studentAnswer, resolvedScope);
        if (!scopeRewrite) {
          return cleaned;
        }
      }
    }
  }

  // Replace entirely with a scope-aware safe probe
  if (DEBUG_GUARDRAILS) {
    console.log("[guardrail] echo rewrite → using buildSafeProbe");
  }
  return buildSafeProbe(questionText, studentAnswer, resolvedScope);
}

// ============================================
// MULTI-QUESTION / MULTI-TOPIC GUARDRAIL
// ============================================

/**
 * Detect if coach text contains multiple questions or "or"-branching between concepts.
 *
 * Triggers when:
 *  - More than one "?" in the text
 *  - An "or" joins two clause-like question targets (e.g. "orbit or temperature")
 *  - Two conceptual targets joined by "and" (e.g. "orbits and temperature")
 *
 * Returns null if no violation detected, or a descriptive tag if detected.
 */
export function detectMultiQuestion(coachText: string): "multi_question" | "or_branch" | "and_branch" | null {
  // Count question marks (ignore "?" inside quotes which are likely examples)
  const questionMarks = (coachText.match(/\?/g) || []).length;
  if (questionMarks > 1) {
    return "multi_question";
  }

  // Detect "or" branching between two clause-like targets within a question sentence.
  // Must have substantial phrases (3+ words) on BOTH sides of "or".
  // Exempt simple binaries where both words adjacent to "or" are short (≤4 chars),
  // e.g. "hot or cold", "near or far", "too hot or too cold".
  const sentences = coachText.split(/(?<=[.!?])\s+/);
  for (const sentence of sentences) {
    if (!sentence.includes("?")) continue;
    const orMatch = sentence.match(/(\b\w+(?:\s+\w+){2,})\s+or\s+(\w+(?:\s+\w+){2,}\b)/i);
    if (orMatch) {
      // Check for simple binary: words directly adjacent to "or" are both short
      const leftWords = orMatch[1].trim().split(/\s+/);
      const rightWords = orMatch[2].trim().split(/\s+/);
      const leftAdj = leftWords[leftWords.length - 1];
      const rightAdj = rightWords[0];
      if (leftAdj.length <= 4 && rightAdj.length <= 4) {
        // Simple binary like "hot or cold", "near or far" — allow
        continue;
      }
      return "or_branch";
    }
  }

  // Detect "and" joining two conceptual targets in a question
  for (const sentence of sentences) {
    if (!sentence.includes("?")) continue;
    const andMatch = sentence.match(/(.{8,}?)\s+and\s+(.{8,})/i);
    if (andMatch) {
      // Exclude natural conjunctions ("you and your", "read and write")
      const leftLastWord = (andMatch[1].trim().split(/\s+/).pop() || "").toLowerCase();
      const rightFirstWord = (andMatch[2].trim().split(/\s+/)[0] || "").toLowerCase();
      const simpleConjunctions = /^(you|we|they|he|she|it|read|write|add|subtract|think|try)$/;
      if (!simpleConjunctions.test(leftLastWord) && !simpleConjunctions.test(rightFirstWord)) {
        return "and_branch";
      }
    }
  }

  return null;
}

/**
 * Pick a single probe topic based on what the student actually said.
 * Scans studentAnswer for topic keywords and picks the most relevant one.
 */
function pickSingleTopic(studentAnswer: string): "warmth" | "light" | "orbit" | "general" {
  const lower = studentAnswer.toLowerCase();
  if (/\b(?:warm|warmth|hot|heat|temperature)\b/.test(lower)) return "warmth";
  if (/\b(?:light|sunlight|bright|shine|glow)\b/.test(lower)) return "light";
  if (/\b(?:orbit|gravity|spin|revolve|pull)\b/.test(lower)) return "orbit";
  return "general";
}

/**
 * Rewrite a multi-question/multi-topic response into a single focused probe.
 * Preserves the first non-question sentence as acknowledgment and replaces
 * all questions with a single targeted question based on the student's answer.
 */
export function rewriteToSingleQuestion(
  coachText: string,
  studentAnswer: string,
  questionText: string,
  resolvedScope?: PromptScope | null
): string {
  // Extract the first non-question sentence as acknowledgment
  const sentences = coachText.split(/(?<=[.!?])\s+/);
  let acknowledgment = "";
  for (const s of sentences) {
    if (!s.includes("?")) {
      acknowledgment = s.trim();
      break;
    }
  }
  if (!acknowledgment) {
    acknowledgment = "Good thinking.";
  }

  // Try scope-aligned probes first
  const scope = resolvedScope !== undefined ? resolvedScope : resolvePromptScope(questionText);
  if (scope && scope.scopeAlignedProbes.length > 0) {
    const idx = studentAnswer.length % scope.scopeAlignedProbes.length;
    return `${acknowledgment} ${scope.scopeAlignedProbes[idx]}`;
  }

  // Fall back to topic-based single question
  const topic = pickSingleTopic(studentAnswer);
  let probe: string;
  switch (topic) {
    case "warmth":
      probe = "How does the sun's warmth affect life on Earth?";
      break;
    case "light":
      probe = "What does sunlight make possible for living things?";
      break;
    case "orbit":
      probe = "What keeps the planets moving around the sun?";
      break;
    case "general":
      probe = buildConceptProbe(classifyConceptType(questionText, studentAnswer), questionText, studentAnswer);
      break;
  }

  return `${acknowledgment} ${probe}`;
}

// ============================================
// DUPLICATE QUESTION SUPPRESSION
// ============================================

/** Normalize text for similarity comparison: lowercase, strip punctuation, collapse whitespace. */
function normalizeQuestion(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract content words from text (>3 chars, no common stop words). */
function extractContentWords(text: string): string[] {
  const stopWords = new Set([
    "that", "this", "what", "when", "where", "which", "there", "their",
    "about", "would", "could", "should", "because", "think", "really",
    "going", "something", "things", "other", "still", "maybe", "just",
    "know", "have", "they", "them", "with", "from", "been", "were",
    "some", "than", "then", "also", "very", "much", "more", "into",
    "does", "your", "you", "can", "will", "the", "and", "for",
  ]);
  return normalizeQuestion(text)
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w));
}

/**
 * Detect if a coach question is a near-duplicate of the last coach question.
 *
 * Returns true when:
 *  - Normalized word overlap is >= 0.85 (Jaccard similarity), OR
 *  - 6+ consecutive content words appear in both
 *
 * Returns false if lastCoachQuestion is empty/undefined.
 */
export function detectDuplicateQuestion(coachText: string, lastCoachQuestion?: string): boolean {
  if (!lastCoachQuestion || !lastCoachQuestion.trim()) return false;

  // Extract the question portion(s) of the coach text
  const coachQuestionParts = coachText.split(/(?<=[.!?])\s+/).filter(s => s.includes("?"));
  if (coachQuestionParts.length === 0) return false;

  const currentQ = normalizeQuestion(coachQuestionParts.join(" "));
  const lastQ = normalizeQuestion(lastCoachQuestion);

  if (!currentQ || !lastQ) return false;

  // Check 1: Jaccard word similarity >= 0.85
  const currentWords = new Set(currentQ.split(/\s+/));
  const lastWords = new Set(lastQ.split(/\s+/));
  const intersection = new Set([...currentWords].filter(w => lastWords.has(w)));
  const union = new Set([...currentWords, ...lastWords]);
  const jaccard = union.size > 0 ? intersection.size / union.size : 0;
  if (jaccard >= 0.85) return true;

  // Check 2: 6+ consecutive content words shared
  const currentContent = extractContentWords(coachQuestionParts.join(" "));
  const lastContent = extractContentWords(lastCoachQuestion);
  if (currentContent.length >= 6 && lastContent.length >= 6) {
    const lastContentStr = lastContent.join(" ");
    for (let i = 0; i <= currentContent.length - 6; i++) {
      const window = currentContent.slice(i, i + 6).join(" ");
      if (lastContentStr.includes(window)) return true;
    }
  }

  return false;
}

/**
 * Check if a student response contains substantive content (not just filler/frustration).
 * Returns true if the student said >= 4 non-filler content words.
 */
export function isSubstantiveAnswer(studentText: string): boolean {
  const fillerPattern = /\b(?:um+|uh+|hmm+|like|well|so|yeah|yep|ok|okay|basically|you know|i think|i guess|right)\b/gi;
  const cleaned = studentText.replace(fillerPattern, "").replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
  const words = cleaned.split(/\s+/).filter(w => w.length > 2);
  return words.length >= 4;
}

// ============================================
// PROBE HISTORY TRACKING & DEDUPLICATION
// ============================================

/**
 * Compute bigram overlap ratio between two texts.
 * Returns a value between 0 and 1.
 */
function bigramOverlap(a: string, b: string): number {
  const wordsA = normalizeQuestion(a).split(/\s+/).filter(w => w.length > 0);
  const wordsB = normalizeQuestion(b).split(/\s+/).filter(w => w.length > 0);
  if (wordsA.length < 2 || wordsB.length < 2) return 0;
  const bigramsA = new Set<string>();
  for (let i = 0; i < wordsA.length - 1; i++) bigramsA.add(`${wordsA[i]} ${wordsA[i + 1]}`);
  const bigramsB = new Set<string>();
  for (let i = 0; i < wordsB.length - 1; i++) bigramsB.add(`${wordsB[i]} ${wordsB[i + 1]}`);
  if (bigramsA.size === 0 || bigramsB.size === 0) return 0;
  let overlap = 0;
  for (const bg of bigramsA) { if (bigramsB.has(bg)) overlap++; }
  return overlap / Math.min(bigramsA.size, bigramsB.size);
}

/**
 * Check if two texts share 5+ consecutive words (normalized).
 */
function hasConsecutiveWordOverlap(a: string, b: string, minWords: number = 5): boolean {
  const wordsA = normalizeQuestion(a).split(/\s+/).filter(w => w.length > 0);
  const wordsB = normalizeQuestion(b).split(/\s+/).filter(w => w.length > 0);
  if (wordsA.length < minWords || wordsB.length < minWords) return false;
  const bStr = wordsB.join(" ");
  for (let i = 0; i <= wordsA.length - minWords; i++) {
    const window = wordsA.slice(i, i + minWords).join(" ");
    if (bStr.includes(window)) return true;
  }
  return false;
}

/**
 * Detect if a probe is a repeat of ANY previously asked question.
 * Checks against the full askedCoachQuestions history.
 *
 * A probe is considered a repeat if against any prior question:
 *   - Exact normalized match, OR
 *   - Bigram overlap > 0.30, OR
 *   - 5+ consecutive word overlap
 *
 * Returns the index of the matching prior question, or -1 if not a repeat.
 */
export function detectProbeRepeat(
  probe: string,
  askedCoachQuestions: string[]
): number {
  if (!askedCoachQuestions || askedCoachQuestions.length === 0) return -1;

  // Extract question portions of the probe
  const probeSentences = probe.split(/(?<=[.!?])\s+/);
  const probeQParts = probeSentences.filter(s => s.includes("?"));
  const probeQ = probeQParts.length > 0 ? probeQParts.join(" ") : probe;
  const probeNorm = normalizeQuestion(probeQ);

  for (let i = 0; i < askedCoachQuestions.length; i++) {
    const prior = askedCoachQuestions[i];
    const priorNorm = normalizeQuestion(prior);

    // Exact normalized match
    if (probeNorm === priorNorm) {
      if (DEBUG_GUARDRAILS) console.log(`[guardrail] probe repeat: exact match with asked[${i}]`);
      return i;
    }

    // Bigram overlap > 0.30
    const overlap = bigramOverlap(probeQ, prior);
    if (overlap > 0.30) {
      if (DEBUG_GUARDRAILS) console.log(`[guardrail] probe repeat: bigram overlap ${(overlap * 100).toFixed(0)}% with asked[${i}]`);
      return i;
    }

    // 5+ consecutive word overlap
    if (hasConsecutiveWordOverlap(probeQ, prior, 5)) {
      if (DEBUG_GUARDRAILS) console.log(`[guardrail] probe repeat: 5+ consecutive words with asked[${i}]`);
      return i;
    }
  }

  return -1;
}

/**
 * Check if the bridge topic has already been used in the session.
 * Returns true if any asked question contains bridge-once keywords.
 */
function isBridgeUsed(
  askedCoachQuestions: string[],
  bridgeOnceKeywords: string[]
): boolean {
  if (!bridgeOnceKeywords || bridgeOnceKeywords.length === 0) return false;
  const allAsked = askedCoachQuestions.join(" ").toLowerCase();
  return bridgeOnceKeywords.some(kw => allAsked.includes(kw.toLowerCase()));
}

/**
 * Find an unused probe from the scope, respecting primary/secondary hierarchy
 * and bridge-once rules.
 *
 * Priority:
 *   1. Unused primary probes (in order)
 *   2. Unused secondary probes (only if bridge not yet used)
 *   3. Fallback: first primary probe (least bad option)
 *
 * @returns The selected probe string
 */
export function findUnusedProbe(
  scope: PromptScope,
  askedCoachQuestions: string[],
  studentAnswer: string
): string {
  const primary = scope.scopeAlignedProbesPrimary ?? [];
  const secondary = scope.scopeAlignedProbesSecondary ?? [];
  const allProbes = primary.length > 0 ? primary : scope.scopeAlignedProbes;

  // Try each primary probe and check if it's been asked
  for (const probe of allProbes) {
    if (detectProbeRepeat(probe, askedCoachQuestions) === -1) {
      if (DEBUG_GUARDRAILS) console.log(`[guardrail] findUnusedProbe: selected unused primary: "${probe.slice(0, 50)}..."`);
      return probe;
    }
  }

  // Try secondary probes if bridge hasn't been used
  const bridgeUsed = isBridgeUsed(askedCoachQuestions, scope.bridgeOnceKeywords ?? []);
  if (!bridgeUsed) {
    for (const probe of secondary) {
      if (detectProbeRepeat(probe, askedCoachQuestions) === -1) {
        if (DEBUG_GUARDRAILS) console.log(`[guardrail] findUnusedProbe: selected unused secondary (bridge): "${probe.slice(0, 50)}..."`);
        return probe;
      }
    }
  }

  // All probes used — pick the primary probe least similar to the most recent asked question
  if (allProbes.length > 0) {
    const lastAsked = askedCoachQuestions[askedCoachQuestions.length - 1] || "";
    let bestProbe = allProbes[0];
    let bestOverlap = 1;
    for (const probe of allProbes) {
      const overlap = bigramOverlap(probe, lastAsked);
      if (overlap < bestOverlap) {
        bestOverlap = overlap;
        bestProbe = probe;
      }
    }
    if (DEBUG_GUARDRAILS) console.log(`[guardrail] findUnusedProbe: all probes used, picking least-similar primary`);
    return bestProbe;
  }

  // Ultimate fallback
  return scope.scopeAlignedProbes[0] || buildConceptProbe(
    classifyConceptType("", studentAnswer), "", studentAnswer
  );
}

// ============================================
// UNIFIED GUARDRAIL: run all checks on any coach text
// ============================================

/**
 * Run ALL deterministic guardrails on a single piece of coach text.
 * Returns the text unchanged if clean, or a safe replacement if violated.
 *
 * Checks in order:
 *   1. Echo detection → rewrite
 *   2. "Steps" ban → rewrite
 *   3. Topic scope → rewrite
 *   4. Multi-question / multi-topic → rewrite to single question
 *   5. Probe repeat detection (against ALL asked questions) → rewrite to unused probe
 *   6. Bridge-once enforcement → block secondary probes after bridge used
 *
 * Use this on EVERY coach-facing text field (feedback, followUpQuestion,
 * combined response string).
 *
 * @param resolvedScope - Pre-resolved scope from resolvePromptScope().
 *   If not provided, falls back to resolvePromptScope(questionText).
 * @param askedCoachQuestions - All questions the coach has asked so far in this session.
 *   Used for probe repeat detection and bridge-once enforcement.
 *   Falls back to lastCoachQuestion (single string) for backward compatibility.
 * @param lastCoachQuestion - DEPRECATED: use askedCoachQuestions instead.
 *   Kept for backward compatibility.
 * @param timeRemainingSec - Seconds remaining in the session. When < 15s and a duplicate
 *   is detected, produces a closing acknowledgment instead of a replacement probe.
 */
export function enforceAllGuardrails(
  coachText: string,
  studentAnswer: string,
  questionText: string,
  fieldName: string, // for logging: "feedback", "followUpQuestion", "response"
  resolvedScope?: PromptScope | null,
  lastCoachQuestion?: string,
  askedCoachQuestions?: string[],
  timeRemainingSec?: number
): string {
  // Resolve scope once, thread through all sub-calls
  const scope = resolvedScope !== undefined ? resolvedScope : resolvePromptScope(questionText);

  // Build the asked history: prefer askedCoachQuestions, fall back to lastCoachQuestion
  const askedHistory = askedCoachQuestions && askedCoachQuestions.length > 0
    ? askedCoachQuestions
    : lastCoachQuestion ? [lastCoachQuestion] : [];

  let result = coachText;

  // 1. Echo detection
  if (detectVerbatimEcho(result, studentAnswer)) {
    if (DEBUG_GUARDRAILS) {
      console.log(`[guardrail] echo detected in ${fieldName} — rewriting`);
    }
    result = rewriteEchoingResponse(result, studentAnswer, questionText, scope);
  }

  // 2. "Steps" ban on non-procedural prompts
  if (containsStepsQuestion(result) && !isProceduralPrompt(questionText)) {
    if (DEBUG_GUARDRAILS) {
      console.log(`[guardrail] banned "steps" question in ${fieldName} — rewriting`);
    }
    result = buildSafeProbe(questionText, studentAnswer, scope);
  }

  // 3. Topic scope
  const scopeRewrite = enforceTopicScope(result, questionText, studentAnswer, scope);
  if (scopeRewrite) {
    if (DEBUG_GUARDRAILS) {
      console.log(`[guardrail] off-scope detected in ${fieldName} — rewriting`);
    }
    result = scopeRewrite;
  }

  // 4. Multi-question / multi-topic enforcement
  const multiQTag = detectMultiQuestion(result);
  if (multiQTag) {
    if (DEBUG_GUARDRAILS) {
      console.log(`[guardrail] ${multiQTag} detected in ${fieldName} — rewriting to single question`);
    }
    result = rewriteToSingleQuestion(result, studentAnswer, questionText, scope);
  }

  // 5. Probe repeat detection (against full asked history)
  const GUARDRAIL_CLOSING_WINDOW_SEC = 15;
  if (askedHistory.length > 0 && result.includes("?")) {
    const repeatIdx = detectProbeRepeat(result, askedHistory);
    if (repeatIdx >= 0) {
      const inClosingWindow = timeRemainingSec !== undefined && timeRemainingSec < GUARDRAIL_CLOSING_WINDOW_SEC;
      if (inClosingWindow) {
        // Closing window + duplicate → clean closing ack, no replacement probe
        if (DEBUG_GUARDRAILS) {
          console.log(`[guardrail] probe repeat in ${fieldName} + closing window (${timeRemainingSec}s left) — closing ack`);
        }
        const sentences = result.split(/(?<=[.!?])\s+/);
        const ack = sentences.find(s => !s.includes("?"))?.trim() || "Good thinking.";
        result = `${ack} You shared some great ideas on this topic!`;
      } else {
        if (DEBUG_GUARDRAILS) {
          console.log(`[guardrail] probe repeat detected in ${fieldName} (matches asked[${repeatIdx}]) — replacing with unused probe`);
        }
        const sentences = result.split(/(?<=[.!?])\s+/);
        const ack = sentences.find(s => !s.includes("?"))?.trim() || "Good thinking.";
        if (scope) {
          result = `${ack} ${findUnusedProbe(scope, askedHistory, studentAnswer)}`;
        } else {
          result = `${ack} ${buildSafeProbe(questionText, studentAnswer, scope)}`;
        }
      }
    }
  }

  // 6. Bridge-once enforcement: if the result contains a secondary/bridge probe
  //    but the bridge has already been used, replace with a primary probe
  if (scope && scope.scopeAlignedProbesSecondary && scope.bridgeOnceKeywords && askedHistory.length > 0) {
    const bridgeUsed = isBridgeUsed(askedHistory, scope.bridgeOnceKeywords);
    if (bridgeUsed) {
      const resultNorm = result.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
      const isSecondaryProbe = scope.scopeAlignedProbesSecondary.some(
        p => {
          // Check if the result contains the first 5+ words of the secondary probe
          const probeWords = p.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim().split(" ");
          const checkLen = Math.min(probeWords.length, 5);
          const prefix = probeWords.slice(0, checkLen).join(" ");
          return resultNorm.includes(prefix);
        }
      );
      if (isSecondaryProbe) {
        if (DEBUG_GUARDRAILS) {
          console.log(`[guardrail] bridge-once violation in ${fieldName} — replacing secondary with primary`);
        }
        const sentences = result.split(/(?<=[.!?])\s+/);
        const ack = sentences.find(s => !s.includes("?"))?.trim() || "Good thinking.";
        result = `${ack} ${findUnusedProbe(scope, askedHistory, studentAnswer)}`;
      }
    }
  }

  return result;
}

// ============================================
// SHOULDCONTINUE / QUESTION INVARIANT
// ============================================

/**
 * Enforce the hard invariant between coach text and shouldContinue:
 *
 * INVARIANT A: If coach text contains "?" OR followUpQuestion is non-empty,
 *              then shouldContinue MUST be true.
 *
 * INVARIANT B: If shouldContinue is false, coach text MUST NOT contain "?"
 *              — strip trailing questions and use a clean close template.
 *
 * Evaluation order: B first (try to strip questions to honor close intent),
 * then A (if questions survived stripping, override shouldContinue to true).
 *
 * Returns the corrected { response, shouldContinue } pair.
 */
export function enforceQuestionContinueInvariant(
  response: string,
  shouldContinue: boolean,
  followUpQuestion: string | undefined,
  isFinalQuestion: boolean
): { response: string; shouldContinue: boolean } {
  const hasFollowUp = !!followUpQuestion && followUpQuestion.trim().length > 0;
  let finalResponse = response;
  let finalContinue = shouldContinue;

  // INVARIANT B (first): If shouldContinue=false, strip any questions from the response
  // to produce a clean close. This preserves the "end session" intent.
  if (!finalContinue && /\?/.test(finalResponse)) {
    const sentences = finalResponse.split(/(?<=[.!?])\s+/);
    const nonQuestionSentences = sentences.filter(s => !s.includes("?"));
    let cleaned = nonQuestionSentences.join(" ").trim();

    if (!cleaned || cleaned.length < 5) {
      // Nothing left after stripping — use a clean close template
      cleaned = isFinalQuestion
        ? "Great work on this assignment!"
        : "Good effort! Let's move on to the next question.";
    }

    console.log(
      "[coach-contract] INVARIANT_B: shouldContinue=false, stripping questions |",
      { original: finalResponse.slice(0, 80), cleaned: cleaned.slice(0, 80) }
    );
    finalResponse = cleaned;
  }

  // INVARIANT A: If questions STILL exist in the response (survived stripping)
  // OR followUpQuestion is non-empty, shouldContinue MUST be true.
  const stillHasQuestion = /\?/.test(finalResponse) || hasFollowUp;
  if (stillHasQuestion && !finalContinue) {
    console.log(
      "[coach-contract] INVARIANT_A: question survived stripping → forcing shouldContinue=true |",
      { hasFollowUp, preview: finalResponse.slice(0, 80) }
    );
    finalContinue = true;
  }

  // Contract satisfied — log for observability
  if (DEBUG_GUARDRAILS) {
    console.log("[coach-contract]", {
      hasQuestion: stillHasQuestion,
      shouldContinue: finalContinue,
      coachTextPreview: finalResponse.slice(0, 80),
    });
  }

  return { response: finalResponse, shouldContinue: finalContinue };
}
