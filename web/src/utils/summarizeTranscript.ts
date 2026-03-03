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
 */
export function summarizeStudentTranscript(turns: TranscriptTurn[], questionText?: string): string {
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

  if (contentWords.length < 3) {
    // Very thin content — brief acknowledgment
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
    // Content words exist but no safe topic matched — generic summary
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

/**
 * Map student speech against successCriteria to produce deterministic
 * evidence-based bullets. Each criterion is checked for keyword overlap
 * with student utterances.
 */
export function buildEvidenceSummary(
  turns: TranscriptTurn[],
  successCriteria: string[],
): EvidenceBullet[] {
  const studentTurns = turns.filter(t => t.role === "student" && t.message.trim().length > 0);
  const cleanedTurns = studentTurns
    .map(t => cleanStudentUtterance(t.message))
    .filter(s => s.length > 0);

  return successCriteria.map(criterion => {
    const criterionWords = extractContentWords(criterion);
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
 */
export function formatEvidenceSummary(bullets: EvidenceBullet[]): string {
  const met = bullets.filter(b => b.status === "met");
  const partial = bullets.filter(b => b.status === "partial");

  const parts: string[] = [];

  if (met.length > 0) {
    const items = met.map(b => b.criterion.toLowerCase()).slice(0, 2);
    parts.push(`Demonstrated understanding of ${items.join(" and ")}`);
  }

  if (partial.length > 0) {
    const items = partial.map(b => b.criterion.toLowerCase()).slice(0, 2);
    parts.push(`Began exploring ${items.join(" and ")}`);
  }

  if (parts.length === 0) {
    return "Some initial thinking was shared. There's a good foundation to build on next time.";
  }

  return parts.join(". ") + ".";
}
