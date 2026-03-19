/**
 * Shared transcript summarization utilities.
 *
 * cleanStudentUtterance — strips filler, normalizes whitespace
 * summarizeStudentTranscript — produces 2-4 sentence natural paragraph from student turns
 */

// ── Constants ───────────────────────────────────────────────────────────────

const FILLER_ONLY =
  /^(?:um+|uh+|hmm+|like|well|so|yeah|yep|ok|okay|i\s+don'?t\s+know|idk|no\s+speech\s+detected|i\s+guess|i'?m\s+not\s+sure)[.!?,\s]*$/i;

const FILLER_WORDS =
  /\b(?:um+|uh+|hmm+|like|well|so|yeah|yep|ok|okay|basically|you know|i think|i guess|right)\b/gi;

const STOP_WORDS = new Set([
  "that", "this", "what", "when", "where", "which", "there", "their",
  "about", "would", "could", "should", "because", "think", "really",
  "going", "something", "things", "other", "still", "maybe", "just",
  "know", "have", "they", "them", "with", "from", "been", "were",
  "some", "than", "then", "also", "very", "much", "more", "into",
  "does", "didn", "don", "isn", "wasn", "aren", "can", "will",
]);

// ── Helpers ─────────────────────────────────────────────────────────────────

export interface TranscriptTurn {
  role: "coach" | "student";
  message: string;
}

/**
 * Strip filler words, collapse whitespace, trim punctuation debris.
 * Returns empty string if the utterance is entirely filler.
 */
export function cleanStudentUtterance(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return "";
  if (FILLER_ONLY.test(trimmed)) return "";

  let cleaned = trimmed
    .replace(FILLER_WORDS, " ")   // strip inline fillers
    .replace(/\s+/g, " ")         // collapse whitespace
    .replace(/^[\s,;—–-]+/, "")   // leading punctuation debris
    .replace(/[\s,;—–-]+$/, "")   // trailing punctuation debris
    .trim();

  // Capitalize first letter
  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  // Ensure it ends with proper punctuation
  if (cleaned.length > 0 && !/[.!?]$/.test(cleaned)) {
    cleaned += ".";
  }

  return cleaned;
}

/**
 * Extract content words (non-filler, non-stop, >3 chars) from text.
 */
export function extractContentWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOP_WORDS.has(w));
}

// ── Topic Detection ─────────────────────────────────────────────────────────

interface TopicMatch {
  label: string;
  keywords: string[];
  template: string;
}

/**
 * Known topic patterns for clean rewriting.
 * Each entry matches content words and produces a clean sentence.
 */
const TOPIC_PATTERNS: TopicMatch[] = [
  {
    label: "warmth/heat",
    keywords: ["warm", "warmth", "heat", "temperature", "hot"],
    template: "the sun provides warmth and heat",
  },
  {
    label: "light/sunlight",
    keywords: ["light", "sunlight", "bright", "shine", "glow", "energy"],
    template: "the sun gives off light and energy",
  },
  {
    label: "orbit/gravity",
    keywords: ["orbit", "gravity", "pull", "spin", "revolve", "revolution"],
    template: "gravity from the sun keeps the planets in orbit",
  },
  {
    label: "distance/planets",
    keywords: ["distance", "closer", "farther", "mercury", "venus", "mars", "jupiter", "neptune"],
    template: "the distance from the sun affects what each planet is like",
  },
  {
    label: "plants/photosynthesis",
    keywords: ["plant", "plants", "grow", "photosynthesis", "food", "oxygen"],
    template: "the sun helps plants grow",
  },
  {
    label: "seasons/day-night",
    keywords: ["season", "seasons", "winter", "summer", "day", "night", "rotation"],
    template: "the sun's position affects seasons and the cycle of day and night",
  },
  {
    label: "star",
    keywords: ["star", "burning", "fuel", "hydrogen", "giant"],
    template: "the sun is a star",
  },
  {
    label: "water/weather",
    keywords: ["water", "rain", "evaporation", "weather", "clouds", "cycle"],
    template: "the sun drives the water cycle and weather",
  },
  {
    label: "life/living",
    keywords: ["life", "living", "alive", "survival", "earth", "animals"],
    template: "the sun is essential for life on Earth",
  },
  {
    label: "disappear/dark",
    keywords: ["disappear", "gone", "dark", "freeze", "frozen", "cold", "without"],
    template: "without the sun, everything would be cold and dark",
  },
];

export interface TopicMatchResult extends TopicMatch {
  /** "strong" = 2+ keyword hits, "weak" = exactly 1 hit */
  strength: "strong" | "weak";
}

/**
 * Detect which topics the student discussed based on content words.
 * Returns matched topics in order of first appearance, with match strength.
 */
export function detectTopics(contentWords: string[]): TopicMatchResult[] {
  const wordSet = new Set(contentWords);
  const matched: TopicMatchResult[] = [];

  for (const pattern of TOPIC_PATTERNS) {
    const hitCount = pattern.keywords.filter(kw => wordSet.has(kw)).length;
    if (hitCount > 0) {
      matched.push({
        ...pattern,
        strength: hitCount >= 2 ? "strong" : "weak",
      });
    }
  }

  return matched;
}

// ── Math Strategy Detection ──────────────────────────────────────────────────

export interface MathStrategyResult {
  type: "break-apart" | "tens-then-ones";
  summary: string;
  verified: boolean;
}

const BREAK_APART_PATTERNS = [
  /break\s*(?:up|apart|down|it)/i,
  /split\s*(?:up|apart|it|the|into|\d)/i,
  /tens\s+and\s+(?:the\s+)?ones/i,
];

const TENS_ONES_PATTERNS = [
  /add(?:ed)?\s+(?:the\s+)?tens/i,
  /then\s+(?:add(?:ed)?\s+)?(?:the\s+)?ones/i,
  /tens\s+first/i,
];

const VERIFICATION_PATTERNS = [
  /backwards/i,
  /check(?:ed|ing)?\s+(?:my|the|your|our|it)?\s*(?:answer|work)/i,
  /check(?:ed|ing)?.*subtract/i,
  /subtract(?:ed|ing)?.*(?:check|verify|prove)/i,
];

/**
 * Detect common elementary math strategies in student speech.
 * Works on the full cleaned text (numbers preserved).
 * Returns null if no recognizable strategy is found.
 */
export function detectMathStrategy(text: string): MathStrategyResult | null {
  const lower = text.toLowerCase();
  const numbers = (text.match(/\d+/g) || []).map(Number);
  if (numbers.length === 0) return null;

  // Find the likely answer: prefer "get/got" (explicit answer statement), else last number
  const getMatch = lower.match(/(?:get|got)\s+(\d+)/);
  const answer = getMatch ? parseInt(getMatch[1]) : numbers[numbers.length - 1];

  const verified = VERIFICATION_PATTERNS.some(p => p.test(lower));

  // 1. Break-apart strategy
  if (BREAK_APART_PATTERNS.some(p => p.test(lower))) {
    // Try to extract the number being decomposed: "break up 25 into..."
    const brokenMatch = lower.match(
      /(?:break|split)\s*(?:up|apart|down|it)?\s+(?:that\s+|the\s+)?(\d+)/
    );
    const brokenNum = brokenMatch ? parseInt(brokenMatch[1]) : null;

    let summary: string;
    if (brokenNum && answer !== brokenNum) {
      summary = `Used a break-apart strategy, splitting ${brokenNum} into smaller parts to solve the problem and reached ${answer}.`;
    } else if (answer) {
      summary = `Used a break-apart strategy to solve the problem and reached ${answer}.`;
    } else {
      summary = "Used a break-apart strategy, splitting a number into smaller parts to solve the problem.";
    }

    if (verified) summary += " The answer was also checked using subtraction.";
    return { type: "break-apart", summary, verified };
  }

  // 2. Tens-then-ones strategy
  if (TENS_ONES_PATTERNS.some(p => p.test(lower))) {
    let summary = answer
      ? `Added the tens first, then the ones, and reached ${answer}.`
      : "Added the tens first and then the ones to solve the problem.";

    if (verified) summary += " The answer was also checked using subtraction.";
    return { type: "tens-then-ones", summary, verified };
  }

  return null;
}

// ── Number word normalization (client-side mirror) ───────────────────────────

const NUMBER_WORDS: Record<string, string> = {
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5",
  six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
  eleven: "11", twelve: "12", thirteen: "13", fourteen: "14", fifteen: "15",
  sixteen: "16", seventeen: "17", eighteen: "18", nineteen: "19",
  twenty: "20", thirty: "30", forty: "40", fifty: "50",
};

function normalizeNumberWordsForSummary(text: string): string {
  let result = text.toLowerCase();
  // Compound first: "twenty five" → "25"
  result = result.replace(
    /\b(twenty|thirty|forty|fifty)\s+(one|two|three|four|five|six|seven|eight|nine)\b/gi,
    (_, tens, ones) => String(Number(NUMBER_WORDS[tens.toLowerCase()] || "0") + Number(NUMBER_WORDS[ones.toLowerCase()] || "0"))
  );
  // Single words
  for (const [word, digit] of Object.entries(NUMBER_WORDS)) {
    result = result.replace(new RegExp(`\\b${word}\\b`, "gi"), digit);
  }
  return result;
}

/**
 * Build a math step evidence summary from arithmetic equations in student speech.
 * Extracts "A + B = C" or "A - B = C" patterns and builds a concrete narrative.
 * Returns null if no equations are found.
 */
export function buildMathStepSummary(text: string): string | null {
  // Normalize number words first
  const normalized = normalizeNumberWordsForSummary(text);
  // Find equations: "1 + 4 = 5", "10 + 10 = 20", etc.
  const rawEquations = normalized.match(/\d+\s*[+\-×x]\s*\d+\s*=\s*\d+/g);
  if (!rawEquations || rawEquations.length === 0) return null;

  // Deduplicate equations (same step demonstrated across multiple turns)
  const steps = [...new Set(rawEquations.map(eq => eq.replace(/\s+/g, " ").trim()))];

  // Find the final answer: prefer explicit "the answer is/should be 25" patterns,
  // then the largest result from any equation. Never use a sub-step result (like 5)
  // when a larger final answer exists.
  const explicitAnswer = normalized.match(/(?:answer\s+(?:is|should\s+be)|the\s+answer\s+is|that(?:'?s| is)|it(?:'?s| is))\s+(\d+)/i);
  let finalAnswer: number | null = explicitAnswer ? parseInt(explicitAnswer[1]) : null;

  // If no explicit answer statement, infer from the largest equation result
  // (the combine/final step produces the largest number).
  if (!finalAnswer) {
    const equationResults = steps.map(eq => {
      const m = eq.match(/=\s*(\d+)$/);
      return m ? parseInt(m[1]) : 0;
    });
    const maxResult = Math.max(...equationResults);
    // Only use as final answer if it's larger than all sub-step results
    // (i.e., it's plausibly the combined answer, not a partial step)
    if (equationResults.filter(r => r === maxResult).length === 1 && maxResult > 9) {
      finalAnswer = maxResult;
    }
  }

  if (steps.length === 1 && finalAnswer) {
    return `The student explained that ${steps[0]} and reached the final answer ${finalAnswer}.`;
  }
  if (steps.length === 1) {
    return `The student explained that ${steps[0]}.`;
  }
  if (finalAnswer) {
    const stepList = steps.slice(0, -1).join(", ");
    const lastStep = steps[steps.length - 1];
    return `The student explained that ${stepList} and ${lastStep} to reach ${finalAnswer}.`;
  }
  const stepList = steps.slice(0, -1).join(", ");
  return `The student explained that ${stepList}, and ${steps[steps.length - 1]}.`;
}

/**
 * Build a simple numeric summary when numbers are present but no named strategy.
 * Returns null if fewer than 2 numbers found.
 */
export function buildNumbersSummary(text: string): string | null {
  const numbers = (text.match(/\d+/g) || []).map(Number);
  if (numbers.length < 2) return null;

  const getMatch = text.toLowerCase().match(/(?:get|got)\s+(\d+)/);
  const answer = getMatch ? parseInt(getMatch[1]) : numbers[numbers.length - 1];

  return `Worked through the problem using specific numbers and reached ${answer}.`;
}

// ── Foreign keyword filter ──────────────────────────────────────────────────

/**
 * Domain-specific nouns that signal cross-topic contamination when they appear
 * in a summary template but NOT in the question text or student speech.
 */
const FOREIGN_KEYWORDS = [
  "sun", "solar", "planet", "planets", "orbit", "orbits", "moon",
  "star", "stars", "galaxy", "gravity",
  "photosynthesis", "chlorophyll", "oxygen", "carbon",
  "dinosaur", "dinosaurs", "fossil", "fossils",
  "volcano", "earthquake", "magma", "lava",
  "ocean", "river", "mountain", "continent",
  "multiplication", "division", "fraction", "fractions",
  "subtraction", "addition", "equation",
  "president", "revolution", "colony", "colonies",
];

/**
 * Returns true if `text` contains a FOREIGN_KEYWORD that is absent from `contextText`.
 * Both are compared case-insensitively with word boundaries.
 */
export function hasForeignKeyword(text: string, contextText: string): boolean {
  const ctxLower = contextText.toLowerCase();
  for (const kw of FOREIGN_KEYWORDS) {
    const regex = new RegExp(`\\b${kw}\\b`, "i");
    if (regex.test(text) && !regex.test(ctxLower)) {
      return true;
    }
  }
  return false;
}

// ── Main ────────────────────────────────────────────────────────────────────

const EMPTY_FALLBACK =
  "We didn't get to hear your ideas this time. You can try again or continue with a coach.";

/**
 * Produce a 2-4 sentence paragraph summarizing the student's contributions.
 *
 * Rules:
 *  - 2-4 complete grammatical sentences as a single natural paragraph
 *  - Vary sentence openers — never "You… You… You…" pattern
 *  - Use hedged language for weak matches ("briefly mentioned" / "hinted at")
 *  - Never reuse the student's raw broken phrasing
 *  - Never output raw "...", filler words, or run-on sentences
 *  - Never mention "coaching session"
 *  - Only fall back to generic when truly empty/filler-only
 *  - Must only reflect what was actually said; do not invent facts
 *  - Never introduce domain concepts absent from the question or transcript
 *
 * @param questionText — the question prompt; used to filter out cross-topic templates
 * @param successCriteria — optional rubric criteria; used for evidence-based summary when
 *   topic patterns don't match (non-solar-system subjects)
 */
export function summarizeStudentTranscript(turns: TranscriptTurn[], questionText?: string, successCriteria?: string[]): string {
  const studentTurns = turns.filter(
    t => t.role === "student" && t.message.trim().length > 0,
  );

  if (studentTurns.length === 0) return EMPTY_FALLBACK;

  // Clean all student turns and filter out empty results
  const cleaned = studentTurns
    .map(t => cleanStudentUtterance(t.message))
    .filter(s => s.length > 0);

  if (cleaned.length === 0) return EMPTY_FALLBACK;

  // Extract content words from ALL cleaned turns
  const allText = cleaned.join(" ");
  const contentWords = extractContentWords(allText);

  // Count distinct numbers as content for math problems (extractContentWords strips numbers).
  // Normalize number words ("five" → "5") before counting so spoken math answers count.
  const normalizedForCount = normalizeNumberWordsForSummary(allText);
  const distinctNumbers = new Set(normalizedForCount.match(/\d+/g) || []).size;
  if (contentWords.length + distinctNumbers < 3) {
    // Very thin content — but still try math step summary before giving up
    const thinStepSummary = buildMathStepSummary(allText);
    if (thinStepSummary) return thinStepSummary;
    return "Some initial thoughts were shared on this topic. There's a good starting point to build on.";
  }

  // Detect topics mentioned by the student
  let topics = detectTopics(contentWords);

  // FOREIGN KEYWORD FILTER: reject topics whose template introduces concepts
  // absent from the question text AND student speech.
  // Context = question + all student speech — if a template mentions "sun" but
  // neither the question nor the student ever said "sun", it's contamination.
  if (questionText) {
    const contextText = [questionText, allText].join(" ");
    topics = topics.filter(t => !hasForeignKeyword(t.template, contextText));
  }

  if (topics.length === 0) {
    // Content words exist but no safe topic matched.

    // 1. Math strategy detection (highest priority — works on full text with numbers)
    const strategy = detectMathStrategy(allText);
    if (strategy) return strategy.summary;

    // 2. Math step evidence — extracts concrete equations from student speech
    //    (e.g., "1 + 4 = 5, 10 + 10 = 20"). Higher priority than keyword-based criteria.
    const stepSummary = buildMathStepSummary(allText);
    if (stepSummary) return stepSummary;

    // 3. Evidence-based summary when criteria are available (non-solar-system subjects).
    if (successCriteria && successCriteria.length > 0) {
      const bullets = buildEvidenceSummary(turns, successCriteria);
      const result = formatEvidenceSummary(bullets);
      if (result.length > 0) return result;
    }

    // 4. Numbers-only summary (student used numbers but no named strategy)
    const numbersSummary = buildNumbersSummary(allText);
    if (numbersSummary) return numbersSummary;

    // 4. Generic fallback
    if (cleaned.length >= 2) {
      return `This response shared ideas across ${cleaned.length} exchanges, building understanding of the topic.`;
    }
    return "Some thinking was shared on this topic, making a good start at exploring the key ideas.";
  }

  // Build a natural paragraph with varied sentence structure.
  // Strong matches: "covered" / "explored". Weak: "briefly mentioned" / "hinted at".
  return buildNaturalParagraph(topics, cleaned.length);
}

/** Helper: render a topic reference using hedged or confident language. */
function topicPhrase(t: TopicMatchResult, verb: "cover" | "explore" | "touch"): string {
  if (t.strength === "weak") {
    // Hedged language for single-keyword matches
    return verb === "cover"
      ? `briefly mentioned ${t.template}`
      : `hinted at the idea that ${t.template}`;
  }
  switch (verb) {
    case "cover": return `covered how ${t.template}`;
    case "explore": return `explored how ${t.template}`;
    case "touch": return `touched on how ${t.template}`;
  }
}

/** Build a natural-sounding paragraph from detected topics. */
function buildNaturalParagraph(topics: TopicMatchResult[], turnCount: number): string {
  if (topics.length === 1) {
    const main = topicPhrase(topics[0], "cover");
    return turnCount > 1
      ? `This response ${main}, building on the idea across multiple exchanges.`
      : `This response ${main}, showing a clear starting point for understanding the topic.`;
  }

  if (topics.length === 2) {
    const t1 = topicPhrase(topics[0], "cover");
    const t2 = topicPhrase(topics[1], "explore");
    return `This response ${t1} and also ${t2}.`;
  }

  if (topics.length === 3) {
    const t1 = topicPhrase(topics[0], "cover");
    const t2 = topicPhrase(topics[1], "touch");
    const t3 = topicPhrase(topics[2], "explore");
    return `This response ${t1}. It also ${t2}, connecting that to ${t3}.`;
  }

  // 4+ topics
  const t1 = topicPhrase(topics[0], "cover");
  const t2 = topicPhrase(topics[1], "explore");
  const t3 = topicPhrase(topics[2], "touch");
  const t4 = topicPhrase(topics[3], "cover");
  return `This response covered several ideas: ${topics[0].strength === "weak" ? "it " + t1 : t1}, ${t2}, and ${t3}. There was also a mention of how ${topics[3].template}.`;
}

// ── Evidence-Based Summary ──────────────────────────────────────────────────

export interface EvidenceBullet {
  criterion: string;
  status: "met" | "partial" | "not_addressed";
  evidence?: string;
}

// ── Planet-Material Extraction (client-side mirror of server extractPlanetMaterialPairs) ──

const PLANETS = ["mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune"];

const MATERIAL_MAP: Record<string, string> = {
  rock: "rock", rocky: "rock", rocks: "rock", stone: "rock",
  gas: "gas", gases: "gas", gaseous: "gas",
  ice: "ice", icy: "ice", frozen: "ice",
  iron: "iron", metal: "iron",
  dust: "dust",
  hydrogen: "gas", helium: "gas",
  solid: "rock", liquid: "liquid",
  ring: "rings", rings: "rings",
};

export interface PlanetMaterialPair {
  planet: string;
  material: string;
}

/**
 * Extract planet→material pairs from student speech using proximity matching.
 * A material keyword within 25 chars of a planet name counts as a pair.
 */
export function extractPlanetMaterialPairs(text: string): PlanetMaterialPair[] {
  const lower = text.toLowerCase();
  const pairs: PlanetMaterialPair[] = [];
  const seen = new Set<string>();

  for (const planet of PLANETS) {
    const planetRegex = new RegExp(`\\b${planet}\\b`, "gi");
    let match;
    while ((match = planetRegex.exec(lower)) !== null) {
      const start = Math.max(0, match.index - 25);
      const end = Math.min(lower.length, match.index + planet.length + 25);
      const window = lower.slice(start, end);

      for (const [keyword, normalized] of Object.entries(MATERIAL_MAP)) {
        const kwRegex = new RegExp(`\\b${keyword}\\b`, "i");
        if (kwRegex.test(window) && !seen.has(`${planet}:${normalized}`)) {
          seen.add(`${planet}:${normalized}`);
          pairs.push({ planet: planet.charAt(0).toUpperCase() + planet.slice(1), material: normalized });
        }
      }
    }
  }

  return pairs;
}

/**
 * Check if student speech is all meta/confusion with no topic content.
 */
function isAllMeta(turns: string[]): boolean {
  const META = /^(that'?s?\s+not\s+what|i'?m\s+confused|what\s+do\s+you|i\s+don'?t\s+(understand|know)|what\s+are\s+we|huh|can\s+you\s+repeat|say\s+that\s+again|did\s+you\s+ask|what\s+was\s+the\s+question)/i;
  return turns.length > 0 && turns.every(t => META.test(t.trim()) || t.trim().length < 5);
}

/**
 * Map student speech against successCriteria to produce deterministic
 * evidence-based bullets. Each criterion is checked for keyword overlap
 * with student utterances. Planet-material pairs are extracted for
 * criteria that involve examples/materials.
 */
export function buildEvidenceSummary(
  turns: TranscriptTurn[],
  successCriteria: string[],
): EvidenceBullet[] {
  const studentTurns = turns.filter(t => t.role === "student" && t.message.trim().length > 0);
  const cleanedTurns = studentTurns
    .map(t => cleanStudentUtterance(t.message))
    .filter(s => s.length > 0);

  // Check for all-meta/confusion (no real content)
  if (isAllMeta(cleanedTurns)) {
    return successCriteria.map(criterion => ({
      criterion,
      status: "not_addressed" as const,
      evidence: "Student expressed confusion rather than answering.",
    }));
  }

  // Extract planet-material pairs from all student speech
  const allStudentText = studentTurns.map(t => t.message).join(" ");
  const planetPairs = extractPlanetMaterialPairs(allStudentText);

  return successCriteria.map(criterion => {
    const criterionLower = criterion.toLowerCase();
    const criterionWords = extractContentWords(criterion);

    // Special path: if criterion involves examples/planets/materials,
    // use planet-material pairs as direct evidence
    const isPlanetCriterion = /\b(planets?|examples?|materials?|made\s+of)\b/i.test(criterionLower);
    if (isPlanetCriterion && planetPairs.length > 0) {
      const pairDescriptions = planetPairs.slice(0, 3).map(p => `${p.planet} (${p.material})`);
      if (planetPairs.length >= 2) {
        return {
          criterion,
          status: "met" as const,
          evidence: `Named ${pairDescriptions.join(", ")}`,
        };
      }
      if (planetPairs.length === 1) {
        return {
          criterion,
          status: "partial" as const,
          evidence: `Named ${pairDescriptions[0]} but only one example`,
        };
      }
    }

    if (criterionWords.length === 0) {
      return { criterion, status: "not_addressed" as const };
    }

    // Find the best matching student turn
    let bestTurn: string | undefined;
    let bestRatio = 0;

    for (const turn of cleanedTurns) {
      const turnWords = extractContentWords(turn);
      const overlap = criterionWords.filter(w => turnWords.includes(w));
      const ratio = overlap.length / criterionWords.length;
      if (ratio > bestRatio) {
        bestRatio = ratio;
        bestTurn = turn;
      }
    }

    if (bestRatio >= 0.5) {
      return {
        criterion,
        status: "met" as const,
        evidence: bestTurn!.length > 80 ? bestTurn!.slice(0, 77) + "..." : bestTurn!,
      };
    }

    if (bestRatio >= 0.2 && bestTurn) {
      return {
        criterion,
        status: "partial" as const,
        evidence: bestTurn.length > 80 ? bestTurn.slice(0, 77) + "..." : bestTurn,
      };
    }

    return { criterion, status: "not_addressed" as const };
  });
}

/**
 * Format evidence bullets into a human-readable summary string.
 * Includes planet-material pairs when present in the evidence.
 * When allStudentText is provided, tries math step evidence before generic fallback.
 */
export function formatEvidenceSummary(bullets: EvidenceBullet[], allStudentText?: string): string {
  const met = bullets.filter(b => b.status === "met");
  const partial = bullets.filter(b => b.status === "partial");
  const notAddressed = bullets.filter(b => b.status === "not_addressed");

  // All-meta path: try math step evidence before generic fallback
  if (notAddressed.length === bullets.length) {
    // Try concrete math step summary before giving up
    if (allStudentText) {
      const stepSummary = buildMathStepSummary(allStudentText);
      if (stepSummary) return stepSummary;
    }
    const hasConfusion = notAddressed.some(b => b.evidence?.includes("confusion"));
    if (hasConfusion) {
      return "The student attempted the question but expressed confusion rather than providing topic-relevant content.";
    }
    return "Some initial thinking was shared. There's a good foundation to build on next time.";
  }

  const parts: string[] = [];

  if (met.length > 0) {
    // Use specific evidence when available (e.g., planet-material pairs)
    const withEvidence = met.filter(b => b.evidence);
    if (withEvidence.length > 0 && withEvidence[0].evidence!.startsWith("Named ")) {
      parts.push(withEvidence[0].evidence!);
    } else {
      const items = met.map(b => b.criterion.toLowerCase()).slice(0, 2);
      parts.push(`Demonstrated understanding of ${items.join(" and ")}`);
    }
  }

  if (partial.length > 0) {
    const items = partial.map(b => b.criterion.toLowerCase()).slice(0, 2);
    parts.push(`Began exploring ${items.join(" and ")}`);
  }

  if (parts.length === 0) {
    // Try concrete math step summary before generic fallback
    if (allStudentText) {
      const stepSummary = buildMathStepSummary(allStudentText);
      if (stepSummary) return stepSummary;
    }
    return "Some initial thinking was shared. There's a good foundation to build on next time.";
  }

  return parts.join(". ") + ".";
}
