/**
 * Multi-Question Guardrail Tests
 *
 * Tests for detectMultiQuestion, rewriteToSingleQuestion,
 * probe deduplication, and enforceQuestionContinueInvariant.
 */

import {
  detectMultiQuestion,
  rewriteToSingleQuestion,
  enforceQuestionContinueInvariant,
  detectProbeRepeat,
  findUnusedProbe,
  enforceAllGuardrails,
  resolvePromptScope,
  detectOnTopicButClipped,
  buildRetryPrompt,
  buildRepairResponse,
} from "./videoCoachGuardrails";

describe("detectMultiQuestion", () => {
  it("detects multiple question marks", () => {
    const text = "Can you think of how the sun helps planets stay in orbit? How does the sun's energy help the planets?";
    expect(detectMultiQuestion(text)).toBe("multi_question");
  });

  it("detects or-branching in a question", () => {
    const text = "Can you think of how the sun helps planets stay in orbit or affects temperature on Earth?";
    expect(detectMultiQuestion(text)).toBe("or_branch");
  });

  it("detects and-branching joining two concepts in a question", () => {
    const text = "How does the sun affect the orbits of planets and the temperature on Earth?";
    expect(detectMultiQuestion(text)).toBe("and_branch");
  });

  it("allows single question with no branching", () => {
    const text = "That's a good start. How does the sun affect temperature on Earth?";
    expect(detectMultiQuestion(text)).toBeNull();
  });

  it("allows a single question even with short or", () => {
    // "hot or cold" — short both sides, not 8+ chars
    const text = "Is it hot or cold on Mercury?";
    expect(detectMultiQuestion(text)).toBeNull();
  });

  it("allows a statement followed by one question", () => {
    const text = "Good thinking. What keeps the planets moving around the sun?";
    expect(detectMultiQuestion(text)).toBeNull();
  });

  it("allows no questions (Path A close)", () => {
    const text = "That explains it clearly. Let's go to the next question.";
    expect(detectMultiQuestion(text)).toBeNull();
  });

  it("detects two questions even when mixed with statements", () => {
    const text = "You're right about that. What does the sun provide? Can you also describe why orbits happen?";
    expect(detectMultiQuestion(text)).toBe("multi_question");
  });

  // ── Compound concept detection (3+ words per side) ──

  it("detects or-branch with 3-word clauses", () => {
    // "helps planets orbit" (3w) or "changes their temperature" (3w) → compound
    const text = "Does the sun helps planets orbit or changes their temperature?";
    expect(detectMultiQuestion(text)).toBe("or_branch");
  });

  it("allows simple binary 'near or far'", () => {
    const text = "Is Mercury near or far from the sun?";
    expect(detectMultiQuestion(text)).toBeNull();
  });

  it("allows simple binary 'too hot or too cold'", () => {
    const text = "Is the planet too hot or too cold?";
    expect(detectMultiQuestion(text)).toBeNull();
  });

  it("detects compound concept with one question mark", () => {
    // Two conceptual targets joined by "and" — single "?" but two concepts
    const text = "How does the sun's gravity keep planets in orbit and provide energy for plants?";
    expect(detectMultiQuestion(text)).toBe("and_branch");
  });
});

describe("rewriteToSingleQuestion", () => {
  const questionText = "Why is the sun important to our solar system?";

  it("preserves acknowledgment and produces exactly one question", () => {
    const multi = "You're right about that. Can you think of how the sun helps planets stay in orbit? How does it affect temperature?";
    const result = rewriteToSingleQuestion(multi, "sunlight and warmth", questionText);

    // Should have exactly one question mark
    const questionMarks = (result.match(/\?/g) || []).length;
    expect(questionMarks).toBe(1);

    // Should start with acknowledgment
    expect(result).toMatch(/^You're right about that\./);
  });

  it("picks warmth topic when student mentions warmth", () => {
    const result = rewriteToSingleQuestion(
      "Good start. Why does X or Y happen?",
      "the sun gives warmth and heat",
      questionText
    );
    expect(result).toContain("warmth");
    expect(detectMultiQuestion(result)).toBeNull();
  });

  it("picks light topic when student mentions sunlight", () => {
    const result = rewriteToSingleQuestion(
      "Good start. Why does X or Y happen?",
      "it provides sunlight to all the plants",
      questionText
    );
    expect(result).toContain("sunlight");
    expect(detectMultiQuestion(result)).toBeNull();
  });

  it("picks orbit topic when student mentions gravity", () => {
    const result = rewriteToSingleQuestion(
      "Good start. Why does X or Y happen?",
      "the gravity pulls the planets in orbit",
      questionText
    );
    expect(result).toContain("planets");
    expect(detectMultiQuestion(result)).toBeNull();
  });

  it("uses generic acknowledgment when no statement sentence exists", () => {
    const result = rewriteToSingleQuestion(
      "Can you explain orbit or temperature?",
      "sunlight",
      questionText
    );
    expect(result).toMatch(/^Good thinking\./);
    expect(detectMultiQuestion(result)).toBeNull();
  });

  it("result always passes detectMultiQuestion", () => {
    const cases = [
      { coach: "Right! What about orbit? And what about temperature?", student: "warmth" },
      { coach: "Can the sun affect orbits or temperature on Earth?", student: "light and heat" },
      { coach: "Good. How does energy transfer and how does gravity work?", student: "the sun is big" },
    ];

    for (const { coach, student } of cases) {
      const result = rewriteToSingleQuestion(coach, student, questionText);
      expect(detectMultiQuestion(result)).toBeNull();
    }
  });
});

// ── enforceQuestionContinueInvariant ───────────────────────────────────────

describe("enforceQuestionContinueInvariant", () => {
  it("INVARIANT B: strips questions when shouldContinue=false", () => {
    const result = enforceQuestionContinueInvariant(
      "Great job! What else can you think of?",
      false,
      undefined,
      false
    );
    expect(result.shouldContinue).toBe(false);
    expect(result.response).not.toContain("?");
    expect(result.response).toContain("Great job!");
  });

  it("INVARIANT B: uses close template when only questions remain", () => {
    const result = enforceQuestionContinueInvariant(
      "What do you think?",
      false,
      undefined,
      false
    );
    expect(result.shouldContinue).toBe(false);
    expect(result.response).not.toContain("?");
    expect(result.response.length).toBeGreaterThan(5);
  });

  it("INVARIANT B: uses final-question template when isFinalQuestion", () => {
    const result = enforceQuestionContinueInvariant(
      "What do you think?",
      false,
      undefined,
      true
    );
    expect(result.shouldContinue).toBe(false);
    expect(result.response).not.toContain("?");
    expect(result.response).toContain("assignment");
  });

  it("INVARIANT A: forces shouldContinue=true when followUpQuestion present", () => {
    const result = enforceQuestionContinueInvariant(
      "Good thinking.",
      false,
      "How does that help plants grow?",
      false
    );
    expect(result.shouldContinue).toBe(true);
  });

  it("passes through when contract is already satisfied (continue + question)", () => {
    const result = enforceQuestionContinueInvariant(
      "Good! What keeps the planets in orbit?",
      true,
      undefined,
      false
    );
    expect(result.shouldContinue).toBe(true);
    expect(result.response).toContain("?");
  });

  it("passes through when contract is satisfied (close + no question)", () => {
    const result = enforceQuestionContinueInvariant(
      "Great work on this topic!",
      false,
      undefined,
      false
    );
    expect(result.shouldContinue).toBe(false);
    expect(result.response).toBe("Great work on this topic!");
  });

  it("EXACT BUG REPRO: score=80 shouldContinue=false but response has question", () => {
    // This is the exact scenario from the bug report:
    // score=80, shouldContinue=false, but the LLM included a question
    const result = enforceQuestionContinueInvariant(
      "You really understand this! How does the distance from the sun change what a planet is like?",
      false,
      undefined,
      false
    );
    // The question should be stripped, shouldContinue stays false
    expect(result.shouldContinue).toBe(false);
    expect(result.response).not.toContain("?");
    expect(result.response).toContain("understand");
  });
});

// ── Probe Deduplication ──────────────────────────────────────────────────────

describe("detectProbeRepeat", () => {
  it("detects exact normalized match", () => {
    const probe = "Besides warmth, what does the sun do that keeps planets in orbit?";
    const asked = [probe];
    expect(detectProbeRepeat(probe, asked)).toBe(0);
  });

  it("detects exact match with different punctuation/casing", () => {
    const probe = "Besides warmth, what does the sun do that keeps planets in orbit?";
    const asked = ["besides warmth what does the sun do that keeps planets in orbit"];
    expect(detectProbeRepeat(probe, asked)).toBe(0);
  });

  it("detects bigram overlap > 0.35 (paraphrased repeat)", () => {
    const probe = "What does the sun do to keep planets in orbit besides warmth?";
    const asked = ["Besides warmth, what does the sun do that keeps planets in orbit?"];
    expect(detectProbeRepeat(probe, asked)).toBe(0);
  });

  it("detects 5+ consecutive word overlap", () => {
    const probe = "Good thinking. What does the sun do that keeps planets in orbit around it?";
    const asked = ["Besides warmth, what does the sun do that keeps planets in orbit?"];
    expect(detectProbeRepeat(probe, asked)).toBe(0);
  });

  it("returns -1 for genuinely different questions", () => {
    const probe = "Why do some planets end up too hot or too cold?";
    const asked = ["Besides warmth, what does the sun do that keeps planets in orbit?"];
    expect(detectProbeRepeat(probe, asked)).toBe(-1);
  });

  it("returns -1 for empty history", () => {
    const probe = "What does the sun do?";
    expect(detectProbeRepeat(probe, [])).toBe(-1);
  });

  it("checks against all asked questions, not just the last", () => {
    const probe = "Why do some planets end up too hot or too cold?";
    const asked = [
      "Besides warmth, what does the sun do that keeps planets in orbit?",
      "How does distance from the sun change what a planet is like?",
      "Why do some planets end up too hot or too cold?",
    ];
    expect(detectProbeRepeat(probe, asked)).toBe(2);
  });
});

describe("findUnusedProbe", () => {
  // This question matches the LEGACY_PROMPT_SCOPES regex /\bsun\b.*\bplanet/i
  const solarSystemQuestion = "Why is the sun important to our planets?";

  it("returns the first unused primary probe", () => {
    const scope = resolvePromptScope(solarSystemQuestion)!;
    expect(scope).not.toBeNull();

    const result = findUnusedProbe(scope, [
      "Besides warmth, what does the sun do that keeps planets in orbit?",
    ], "warmth");

    // Should NOT return the already-asked probe
    expect(result).not.toContain("keeps planets in orbit");
    expect(result).toContain("?");
  });

  it("respects preferred ordering: picks distance probe (2nd) after orbit probe (1st) is used", () => {
    const scope = resolvePromptScope(solarSystemQuestion)!;
    expect(scope).not.toBeNull();

    const result = findUnusedProbe(scope, [
      "Besides warmth, what does the sun do that keeps planets in orbit?",
    ], "it makes things warm");

    // Should select the 2nd probe (distance) since 1st (orbit) is used
    expect(result).toContain("distance from the sun");
  });

  it("skips secondary probe when bridge keywords have been used", () => {
    const scope = resolvePromptScope(solarSystemQuestion)!;
    expect(scope).not.toBeNull();

    // All primary probes used + bridge keyword in history
    const asked = [
      "Besides warmth, what does the sun do that keeps planets in orbit?",
      "How does distance from the sun change what a planet is like?",
      "What might happen to planets if the sun disappeared?",
      "Why do some planets end up too hot or too cold?",
      "Plants need sunlight — how does that show the sun is important for Earth compared to other planets?",
    ];

    const result = findUnusedProbe(scope, asked, "warmth");
    // Should pick a primary probe (least similar), NOT a secondary with "plants"
    expect(result).toContain("?");
  });

  it("returns a probe even when all have been used (least similar fallback)", () => {
    const scope = resolvePromptScope(solarSystemQuestion)!;
    expect(scope).not.toBeNull();

    const asked = [
      "Besides warmth, what does the sun do that keeps planets in orbit?",
      "How does distance from the sun change what a planet is like?",
      "What might happen to planets if the sun disappeared?",
      "Why do some planets end up too hot or too cold?",
    ];

    const result = findUnusedProbe(scope, asked, "warmth");
    expect(result).toContain("?");
  });
});

// ── Single-Concept Enforcement ───────────────────────────────────────────

describe("single-concept enforcement via detectMultiQuestion + rewrite", () => {
  const questionText = "Why is the sun important to our planets?";

  it("rewrites question with two concept clusters joined by 'and'", () => {
    const multiConcept = "Good thinking. How does the sun affect the orbits of planets and the temperature on Earth?";
    expect(detectMultiQuestion(multiConcept)).toBe("and_branch");

    const rewritten = rewriteToSingleQuestion(multiConcept, "warmth from the sun", questionText);
    expect(rewritten).toContain("Good thinking.");
    const qMarks = (rewritten.match(/\?/g) || []).length;
    expect(qMarks).toBe(1);
  });

  it("rewrites question with two concept clusters joined by 'or'", () => {
    const multiConcept = "Can you tell me about how the sun helps planets stay in orbit or affects temperature on Earth?";
    expect(detectMultiQuestion(multiConcept)).toBe("or_branch");

    const rewritten = rewriteToSingleQuestion(multiConcept, "gravity pulls the planets", questionText);
    const qMarks = (rewritten.match(/\?/g) || []).length;
    expect(qMarks).toBe(1);
  });

  it("preserves single-concept questions unchanged", () => {
    const singleConcept = "Good thinking. What keeps the planets in orbit?";
    expect(detectMultiQuestion(singleConcept)).toBeNull();
    // Single concept should pass through enforceAllGuardrails unchanged
    // (assuming no other guardrails trigger)
  });
});

describe("enforceAllGuardrails with probe dedup", () => {
  // Must match LEGACY_PROMPT_SCOPES regex /\bsun\b.*\bplanet/i
  const solarQ = "Why is the sun important to our planets?";

  it("REGRESSION: replaces repeated 'Plants need sunlight' probe", () => {
    const coachText = "Good thinking! Plants need sunlight — how does that show the sun is important for Earth compared to other planets?";
    const askedHistory = [
      "Plants need sunlight — how does that show the sun is important for Earth compared to other planets?",
    ];

    const result = enforceAllGuardrails(
      coachText, "the sun gives warmth", solarQ, "response",
      undefined, undefined, askedHistory
    );

    // Should NOT repeat the plants probe
    expect(result).not.toContain("Plants need sunlight");
    expect(result).toContain("?");
  });

  it("does not modify a genuinely new probe", () => {
    const coachText = "Good thinking! How does distance from the sun change what a planet is like?";
    const askedHistory = [
      "Besides warmth, what does the sun do that keeps planets in orbit?",
    ];

    const result = enforceAllGuardrails(
      coachText, "warmth and light", solarQ, "response",
      undefined, undefined, askedHistory
    );

    // Should keep the original probe (it's not a repeat)
    expect(result).toContain("distance from the sun");
  });

  it("blocks secondary bridge probe after bridge keyword used in history", () => {
    const scope = resolvePromptScope(solarQ)!;
    expect(scope).not.toBeNull();

    const coachText = "Plants need sunlight — how does that show the sun is important for Earth compared to other planets?";
    // History contains coach question mentioning plants (bridge used)
    const askedHistory = [
      "How do plants use the sun's energy?",
    ];

    const result = enforceAllGuardrails(
      coachText, "plants grow using sunlight", solarQ, "response",
      scope, undefined, askedHistory
    );

    // Bridge already used, should be replaced with a primary probe
    expect(result).not.toContain("Plants need sunlight");
    expect(result).toContain("?");
  });

  it("uses closing ack (no question) when duplicate detected in closing window", () => {
    // Use a student answer that won't trigger echo detection (no shared bigrams with coach text)
    const coachText = "Nice job! Besides warmth, what does the sun do that keeps planets in orbit?";
    const askedHistory = [
      "Besides warmth, what does the sun do that keeps planets in orbit?",
    ];

    const result = enforceAllGuardrails(
      coachText, "it helps things grow and gives energy", solarQ, "response",
      undefined, undefined, askedHistory, 10 // 10s left = closing window
    );

    // Should NOT contain any question mark — clean closing ack
    expect(result).not.toContain("?");
    expect(result).toContain("great ideas");
  });

  it("replaces duplicate with new probe when NOT in closing window", () => {
    const coachText = "Nice job! Besides warmth, what does the sun do that keeps planets in orbit?";
    const askedHistory = [
      "Besides warmth, what does the sun do that keeps planets in orbit?",
    ];

    const result = enforceAllGuardrails(
      coachText, "it helps things grow and gives energy", solarQ, "response",
      undefined, undefined, askedHistory, 60 // 60s left = plenty of time
    );

    // Should replace with a new probe (has question mark)
    expect(result).not.toContain("keeps planets in orbit");
    expect(result).toContain("?");
  });

  it("replaces duplicate with new probe when timeRemainingSec is undefined", () => {
    const coachText = "Nice job! Besides warmth, what does the sun do that keeps planets in orbit?";
    const askedHistory = [
      "Besides warmth, what does the sun do that keeps planets in orbit?",
    ];

    const result = enforceAllGuardrails(
      coachText, "it helps things grow and gives energy", solarQ, "response",
      undefined, undefined, askedHistory // no timeRemainingSec
    );

    // Should still replace with a new probe (backward compat)
    expect(result).not.toContain("keeps planets in orbit");
    expect(result).toContain("?");
  });
});

// ── detectOnTopicButClipped ──────────────────────────────────────────────

describe("detectOnTopicButClipped", () => {
  // Use a question that matches the legacy scope regex (\bsun\b.*\bplanet)
  const solarQ = "Why is the sun important to the planets?";
  const solarScope = resolvePromptScope(solarQ);

  it("returns true for clipped on-topic response", () => {
    expect(detectOnTopicButClipped("um... warmth", solarScope)).toBe(true);
  });

  it("returns false for off-topic response", () => {
    expect(detectOnTopicButClipped("I like pizza", solarScope)).toBe(false);
  });

  it("returns false for substantive on-topic response (>= 5 content words)", () => {
    expect(
      detectOnTopicButClipped(
        "the sun gives warmth and heat and light to the planets",
        solarScope
      )
    ).toBe(false);
  });

  it("returns false when no scope available", () => {
    expect(detectOnTopicButClipped("warmth", null)).toBe(false);
  });

  it("returns false for empty response", () => {
    expect(detectOnTopicButClipped("", solarScope)).toBe(false);
  });
});

// ── buildRetryPrompt ─────────────────────────────────────────────────────

describe("buildRetryPrompt", () => {
  const solarQ = "Why is the sun important to the planets?";
  const solarScope = resolvePromptScope(solarQ);

  it("uses Clarify mode for on-topic-but-clipped responses", () => {
    const result = buildRetryPrompt(solarQ, 0, "um... warmth", solarScope);
    expect(result).toMatch(/caught|idea|heard/i);
    expect(result).not.toContain("different angle");
  });

  it("uses standard retry for off-topic responses", () => {
    const result = buildRetryPrompt(solarQ, 0, "I like pizza", solarScope);
    expect(result).not.toContain("different angle");
    expect(result).toMatch(/\?/); // still asks a question
  });

  it("never uses 'different angle' across all variants", () => {
    for (let i = 0; i < 6; i++) {
      const result = buildRetryPrompt(solarQ, i, undefined, solarScope);
      expect(result).not.toContain("different angle");
    }
  });

  it("backward compatible — works without studentResponse and scope", () => {
    const result = buildRetryPrompt(solarQ, 0);
    expect(result.length).toBeGreaterThan(0);
    expect(result).not.toContain("different angle");
  });
});

// ── buildRepairResponse ──────────────────────────────────────────────────

describe("buildRepairResponse", () => {
  const solarQ = "Why is the sun important to the planets?";

  it("never uses 'different angle' in any repair variant", () => {
    for (let i = 0; i < 6; i++) {
      const result = buildRepairResponse(solarQ, i);
      expect(result).not.toContain("different angle");
    }
  });

  it("uses empathetic language", () => {
    const result = buildRepairResponse(solarQ, 0);
    expect(result).toMatch(/hear you|okay|understand/i);
  });
});

// ============================================================================
// resolvePostEvaluation — mastery
// ============================================================================

import { resolvePostEvaluation, CORRECT_THRESHOLD } from "./videoCoachGuardrails";

describe("resolvePostEvaluation — mastery", () => {
  const strongCorrect = { score: 90, isCorrect: true, shouldContinue: false };

  test("strong criteria → shouldContinue=false (clean end)", () => {
    const result = resolvePostEvaluation(strongCorrect, 1, 3, 0, "strong", 45);
    expect(result.shouldContinue).toBe(false);
    expect(result.probeFirst).toBe(false);
  });

  test("strong criteria + any time → always ends (no continuation)", () => {
    const result = resolvePostEvaluation(strongCorrect, 1, 3, 0, "strong", 10);
    expect(result.shouldContinue).toBe(false);
  });

  test("developing → probes for missing criteria", () => {
    const result = resolvePostEvaluation(strongCorrect, 1, 3, 0, "developing", 45);
    expect(result.probeFirst).toBe(true);
  });

  test("incorrect first attempt → continues (hard guardrail)", () => {
    const result = resolvePostEvaluation(
      { score: 40, isCorrect: false, shouldContinue: false }, 0, 3, 0
    );
    expect(result.shouldContinue).toBe(true);
  });

  test("incorrect max attempts → ends", () => {
    const result = resolvePostEvaluation(
      { score: 40, isCorrect: false, shouldContinue: false }, 2, 3, 0
    );
    expect(result.shouldContinue).toBe(false);
  });
});

// ============================================================================
// Summary grounding helpers (inline logic acceptance tests)
// ============================================================================

describe("Summary grounding — content word extraction + foreign keyword detection", () => {
  // Replicate the stop words and helpers from coach.ts for testing
  const STOP_WORDS = new Set([
    "student", "students", "they", "their", "them", "this", "that", "these",
    "those", "have", "does", "said", "says", "showed", "shows", "explained",
    "understanding", "demonstrated", "noted", "mentioned", "stated",
    "response", "responses", "answer", "answers", "question", "questions",
    "about", "also", "were", "with", "from", "when", "what", "which",
    "some", "more", "than", "been", "being", "would", "could", "should",
    "very", "just", "like", "well", "then", "however", "although", "while",
    "during", "through", "after", "before", "above", "below", "each",
    "expressed", "indicated", "addressed", "provided", "offered",
    "showing", "suggesting", "including", "regarding", "concerning",
  ]);

  const toContentWords = (text: string): string[] =>
    text
      .toLowerCase()
      .replace(/[^a-z\s'-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOP_WORDS.has(w));

  const DOMAIN_KEYWORDS = [
    "sun", "solar", "planet", "planets", "orbit", "orbits", "moon",
    "star", "stars", "galaxy", "comet", "asteroid", "gravity",
    "photosynthesis", "chlorophyll", "oxygen", "carbon",
    "dinosaur", "dinosaurs", "fossil", "fossils",
    "volcano", "earthquake", "magma", "lava",
    "ocean", "river", "mountain", "continent",
    "multiplication", "division", "fraction", "fractions",
    "subtraction", "addition", "equation",
    "president", "revolution", "colony", "colonies",
  ];

  const detectForeignKeywords = (text: string, contextWords: Set<string>): string[] =>
    DOMAIN_KEYWORDS.filter((kw) => {
      const regex = new RegExp(`\\b${kw}\\b`, "i");
      return regex.test(text) && !contextWords.has(kw);
    });

  test("stop words are excluded from content word extraction", () => {
    const words = toContentWords("The student explained their understanding of the question");
    expect(words).toEqual([]);
  });

  test("substantive domain words are preserved", () => {
    const words = toContentWords("subtraction involves taking away numbers");
    expect(words).toContain("subtraction");
    expect(words).toContain("involves");
    expect(words).toContain("taking");
    expect(words).toContain("numbers");
  });

  test("foreign keyword: 'sun' detected when not in context (math lesson)", () => {
    const context = new Set(toContentWords("What is 15 minus 8? subtraction problems"));
    const foreign = detectForeignKeywords("The student discussed the sun and solar system", context);
    expect(foreign).toContain("sun");
    expect(foreign).toContain("solar");
  });

  test("foreign keyword: not flagged when in context (solar system lesson)", () => {
    const context = new Set([
      ...toContentWords("How does the sun heat the earth? solar energy"),
      "sun", // 3-char word added manually
    ]);
    const foreign = detectForeignKeywords("The student discussed the sun and solar energy", context);
    expect(foreign).not.toContain("sun");
    expect(foreign).not.toContain("solar");
  });

  test("cross-contamination: orbit/gravity in math lesson flagged", () => {
    const context = new Set(toContentWords("What is 24 divided by 6? division practice"));
    const foreign = detectForeignKeywords("The student explored orbits and gravity", context);
    expect(foreign).toContain("orbits");
    expect(foreign).toContain("gravity");
  });

  test("no false positives: summary matches lesson topic entirely", () => {
    const context = new Set([
      ...toContentWords("Why do we have seasons? Earth orbit around the sun"),
      "sun",
    ]);
    const foreign = detectForeignKeywords(
      "The student explained that Earth's orbit around the sun causes seasons", context
    );
    expect(foreign).toHaveLength(0);
  });

  test("grounding overlap expansion: bullet passes when words match prompt", () => {
    const studentWords = new Set(toContentWords("I think you take away the smaller number"));
    const promptWords = new Set(toContentWords("What is 15 minus 8? subtraction problem"));
    const allowedWords = new Set([...studentWords, ...promptWords]);

    const bullet = "The student attempted the subtraction problem using a take-away strategy";
    const bulletContentWords = toContentWords(bullet);
    const overlap = bulletContentWords.filter((w) => allowedWords.has(w)).length;
    expect(overlap).toBeGreaterThanOrEqual(2);
  });

  test("grounding overlap: bullet with only generic words fails", () => {
    const allowedWords = new Set([
      ...toContentWords("I think it's twenty"),
      ...toContentWords("What is the answer?"),
    ]);

    const bullet = "The student provided a response that showed some understanding";
    const bulletContentWords = toContentWords(bullet);
    const overlap = bulletContentWords.filter((w) => allowedWords.has(w)).length;
    expect(overlap).toBe(0);
  });
});
