/**
 * Video Coach State Machine
 *
 * Pure deterministic logic for video coaching decisions.
 * No React or API dependencies — all side effects happen in Lesson.tsx.
 *
 * Fixes three root-cause bugs:
 * 1. Hardcoded score/outcome (score: 80, isCorrect: true regardless of reality)
 * 2. No attempt tracking (first "I don't know" could end the assignment)
 * 3. Wrong API endpoint (continueCoachConversation has no score; getCoachFeedback does)
 */

// ---------------------------------------------------------------------------
// Constants (aligned with teacherDashboardUtils.ts:92)
// ---------------------------------------------------------------------------

export const CORRECT_THRESHOLD = 80;
export const MIN_ATTEMPTS_BEFORE_FAIL = 2;
export const MAX_HINT_DECLINES = 2;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VideoCoachState {
  latestStudentResponse: string;
  attemptCount: number;        // actual answer attempts so far (starts 0, excludes hint meta-conversation)
  hintOfferPending: boolean;
  hintIndex: number;           // hints delivered so far
  hintDeclineCount: number;
  hintsAvailable: string[];    // hint texts from the prompt
  maxAttempts: number;         // typically 3
  questionText: string;        // the question being asked, for restate-question support
  followUpCount: number;       // how many probing follow-ups coach has done on this question
  lastCoachQuestion?: string;  // the most recent coach sub-question (for context-aware short-answer validation)
  activeMathQuestion?: string; // the last semantic math sub-question (survives no-speech retry and hint offers)
  hasReasoningSteps?: boolean; // true when the prompt has deterministic reasoning steps (math) — bypasses generic hint flow
}

export type VideoCoachActionType =
  | "OFFER_HINT"              // low confidence + hints available → offer hint
  | "DELIVER_HINT"            // student accepted hint → deliver + re-prompt
  | "HINT_INQUIRY_RESPONSE"   // student asked about hints → tell count, keep offer pending
  | "RETRY_AFTER_DECLINE"     // first decline → offer one more chance
  | "END_AFTER_DECLINE"       // second decline → end (needs-review, no score)
  | "REPEAT_QUESTION"         // student asked to restate the question
  | "FRUSTRATION_REPAIR"      // frustration/disengagement → empathetic redirect (not an attempt)
  | "META_RESPONSE"           // meta-conversational utterance → clarify/redirect (not an attempt)
  | "END_SESSION"             // student explicitly wants to stop → wrap session
  | "ASK_RETRY"               // hints exhausted, attempts remain → try again
  | "MARK_DEVELOPING"         // max attempts reached → end (needs-review, no score)
  | "EVALUATE_ANSWER";        // substantive response → call LLM for scoring

export type UtteranceIntent =
  | "CONTENT_ANSWER"
  | "META_CONVERSATION"
  | "CONFUSION"
  | "END_INTENT"
  | "SILENCE";

export type VideoEndReason = "max-attempts" | "declined-hints" | "no-score" | "student-ended";

export interface VideoCoachAction {
  type: VideoCoachActionType;
  response?: string;            // pre-built coach response (non-LLM actions)
  shouldContinue: boolean;
  endReason?: VideoEndReason;   // set when shouldContinue=false
  utteranceIntent?: UtteranceIntent; // classification of student utterance
  stateUpdates: {
    attemptCount: number;
    hintOfferPending: boolean;
    hintIndex: number;
    hintDeclineCount: number;
    hintUsed: boolean;
    followUpCount: number;
  };
}

export interface VideoOutcomeInputs {
  lastScore: number | undefined;
  hintUsed: boolean;
  endReason?: VideoEndReason;
}

// ---------------------------------------------------------------------------
// Helpers (moved from Lesson.tsx:1030-1070)
// ---------------------------------------------------------------------------

/** Detect low-confidence responses that should trigger hint offer. */
/**
 * Detect whether a response is an interrogative candidate answer — a question
 * containing a number or number word.  e.g. "Is it three?", "Could it be 3?",
 * "So is it 25?".  These are genuine academic attempts with uncertainty, NOT
 * low-confidence / off-topic / conversational filler.
 *
 * Also handles STT-noisy variants without trailing "?" by detecting common
 * interrogative frames: "is it <num>", "could it be <num>", "is the answer <num>",
 * "oh is it <num>", etc.
 */
const INTERROGATIVE_FRAME = /\b(?:is\s+it|is\s+the\s+answer|could\s+it\s+be|would\s+it\s+be|so\s+is\s+it)\b/i;

export function isInterrogativeMathAnswer(response: string): boolean {
  const trimmed = response.trim();
  const normalized = normalizeNumberWordsClient(trimmed);
  const hasNumber = /\d/.test(normalized);
  if (!hasNumber) return false;
  // Explicit question mark — any number + "?" is interrogative
  if (trimmed.endsWith("?")) return true;
  // STT often drops "?". Detect interrogative frames with a number.
  return INTERROGATIVE_FRAME.test(trimmed);
}

export function isLowConfidenceResponse(response: string): boolean {
  const lowConfidencePatterns = [
    /^i\s*don'?t\s*know/i,
    /^idk/i,
    /^i\s*have\s*no\s*idea/i,
    /^not\s*sure/i,
    /^i'?m\s*not\s*sure/i,
    /^i\s*don'?t\s*understand/i,
    /^i\s*can'?t\s*(think|remember)/i,
    /^\s*\?\s*$/,
    /^no\s*speech\s*detected/i,
    /^um+\s*$/i,
    /^uh+\s*$/i,
  ];

  const trimmed = response.trim().toLowerCase();

  // Interrogative candidate answers ("Is it 3?", "Could it be five?") are
  // genuine academic attempts — never classify as low-confidence.
  if (isInterrogativeMathAnswer(response)) {
    return false;
  }

  // Very short response (< 10 chars) unless it's a valid answer like "yes" or a number
  if (trimmed.length < 10 && !/^(yes|no|maybe|\d+|[a-z])$/i.test(trimmed)) {
    return true;
  }

  return lowConfidencePatterns.some((pattern) => pattern.test(trimmed));
}

// ---------------------------------------------------------------------------
// Context-aware short-answer validation
// ---------------------------------------------------------------------------

/** Map of English number words to digits. */
const WORD_TO_NUMBER: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90,
};

const TENS_WORDS = ["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const ONES_WORDS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/**
 * Normalize number words to digits in text.
 * "a five" → "a 5", "twenty five" → "25"
 */
export function normalizeNumberWordsClient(text: string): string {
  let normalized = text.toLowerCase();
  // Compound tens+ones first ("twenty five" → "25")
  for (const tens of TENS_WORDS) {
    for (const ones of ONES_WORDS) {
      const compound = new RegExp(`\\b${tens}[\\s-]+${ones}\\b`, "gi");
      const value = WORD_TO_NUMBER[tens] + WORD_TO_NUMBER[ones];
      normalized = normalized.replace(compound, String(value));
    }
  }
  // Single word numbers
  for (const [word, num] of Object.entries(WORD_TO_NUMBER)) {
    normalized = normalized.replace(new RegExp(`\\b${word}\\b`, "gi"), String(num));
  }
  return normalized;
}

/**
 * Check if a short student answer is a valid response to the current coach sub-question.
 *
 * When the coach asks a targeted sub-question like "What do you get when you add 1 and 4?",
 * a short answer like "a five" or "5" is a valid content answer, not low-confidence.
 *
 * Returns true if the answer contains a number (after word normalization) that appears
 * among or relates to the numbers in the coach question, OR uses math vocabulary
 * (carry, regroup, tens place, etc.) relevant to the question context.
 */
export function isShortAnswerValidForCoachQuestion(
  studentResponse: string,
  coachQuestion: string,
): boolean {
  if (!coachQuestion) return false;

  const normalizedStudent = normalizeNumberWordsClient(studentResponse);
  const normalizedCoach = normalizeNumberWordsClient(coachQuestion);

  // Extract all numbers from both texts
  const studentNums = normalizedStudent.match(/\b\d+\b/g) || [];
  const coachNums = normalizedCoach.match(/\b\d+\b/g) || [];

  // If the student provided a number and the coach asked a math sub-question, it's valid
  if (studentNums.length > 0 && coachNums.length > 0) {
    return true;
  }

  // Math vocabulary answers to math-context questions
  const mathVocab = /\b(?:carr(?:y|ied|ying)|regroup(?:ed|ing)?|tens?\s*(?:place|column)?|ones?\s*(?:place|column)?|borrow(?:ed|ing)?|extra\s+ten|left\s*over|add(?:ed)?|plus)\b/i;
  if (mathVocab.test(normalizedStudent) && coachNums.length > 0) {
    return true;
  }

  return false;
}

/**
 * Check if a student response contains math content (numbers, number words,
 * or equations) that should be treated as a content answer rather than
 * hint meta-conversation. Used to prevent hintOfferPending from swallowing
 * valid math answers like "five" or "No 1 + 4 = 5".
 */
export function containsMathContent(response: string): boolean {
  const normalized = normalizeNumberWordsClient(response);
  // Has digits (after number-word normalization)
  if (/\d/.test(normalized)) return true;
  // Has math vocabulary
  if (/\b(?:plus|minus|add|subtract|equals?|carry|regroup|tens?|ones?)\b/i.test(response)) return true;
  return false;
}

/** Parse whether student accepted, declined, or inquired about a hint offer. */
export function parseHintResponse(
  response: string
): "accept" | "decline" | "inquire" | "unclear" {
  const trimmed = response.trim().toLowerCase();
  const acceptPatterns = [
    /^yes/i,
    /^yeah/i,
    /^sure/i,
    /^ok/i,
    /^please/i,
    /^(hint|hind|hand)/i,
    /^give.*(hint|hind|hand)/i,
  ];
  const inquirePatterns = [
    /how\s+many\s+(hints?|hinds?|hands)/i,
    /what\s+(hints?|hinds?|hands)\s+(do|are)/i,
    /do\s+you\s+have\s+(any\s+)?(hints?|hinds?|hands)/i,
    /can\s+i\s+get\s+a\s+(hint|hind|hand)\s+first/i,
    /tell\s+me\s+(the|about)\s+(hints?|hinds?|hands)/i,
    /what\s+kind\s+of\s+(hints?|hinds?|hands)/i,
    /are\s+there\s+(hints?|hinds?|hands)/i,
  ];
  const declinePatterns = [
    /^no\b/i,
    /^nah/i,
    /^i'?ll\s*try/i,
    /^let\s*me\s*try/i,
    /^i\s*want\s*to\s*try/i,
  ];

  if (acceptPatterns.some((p) => p.test(trimmed))) return "accept";
  if (inquirePatterns.some((p) => p.test(trimmed))) return "inquire";
  if (declinePatterns.some((p) => p.test(trimmed))) return "decline";
  return "unclear";
}

/** Detect explicit requests for a hint (even outside the offer/accept flow).
 *  STT variants: "hinds"/"hands" are common misheard versions of "hints". */
export function isHintRequest(response: string): boolean {
  const trimmed = response.trim().toLowerCase();
  const hintPatterns = [
    /\b(hints?|hinds?|hands?)\b/i,
    /\bmore\s+(hints?|hinds?|hands?)\b/i,
    /\banother\s+(hint|hind|hand)\b/i,
    /\bgive\s+me\s+(a\s+)?(hints?|hinds?|hands?)\b/i,
    /\bcan\s+(i|you)\s+(have|give)\s+(a\s+|me\s+)?(another\s+)?(hints?|hinds?|hands?)\b/i,
    /\bhelp\s*me\b/i,
    /\bclue\b/i,
    /\bdo\s+you\s+have\s+(any\s+)?(more\s+)?(hints?|hinds?|hands?)\b/i,
    /\bhow\s+many\s+(hints?|hinds?|hands?)\b/i,
  ];
  return hintPatterns.some((p) => p.test(trimmed));
}

/** Detect "(no speech detected)" or equivalent empty capture. */
export function isNoSpeech(response: string): boolean {
  const trimmed = response.trim().toLowerCase();
  return (
    trimmed === "(no speech detected)" ||
    trimmed === "no speech detected" ||
    trimmed === ""
  );
}

/** Content-word extraction for frustration remainder check. */
const FRUSTRATION_FILLER = new Set([
  "um","uh","hmm","like","well","so","yeah","yep","ok","okay",
  "basically","right","just","really","very","the","a","an","is","are",
  "was","were","it","its","i","my","me","you","your","this","that",
  "and","or","but","to","of","in","on","for","with","do","don't",
  "does","doesn't","did","didn't","have","has","had","not","no",
  "dont","know","because","think","about","answer",
]);

function countContentWordsAfter(text: string, matchEnd: number): number {
  const remainder = text.slice(matchEnd);
  return remainder
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !FRUSTRATION_FILLER.has(w))
    .length;
}

/**
 * Detect frustration, disengagement, or meta-complaints.
 * These are NOT answer attempts — they need empathetic repair.
 *
 * IMPORTANT: If a frustration phrase appears but the remainder of the
 * utterance contains >= 5 content words, the student is reasoning
 * through uncertainty (e.g., "I don't really know but the planets
 * closer to the sun are rocky"). This is NOT frustration.
 */
export function isFrustrationSignal(response: string): boolean {
  const lower = response.trim().toLowerCase();
  const frustrationPatterns: RegExp[] = [
    /\b(?:this\s+is\s+)?(?:ridiculous|stupid|dumb|boring|pointless|lame|terrible)\b/i,
    /\bwhat(?:'s|\s+is)\s+the\s+point\b/i,
    /\bi\s+(?:don'?t|do\s+not)\s+(?:want|care|like)\b/i,
    /\bi\s+(?:don'?t|do\s+not)\s+(?:really\s+)?know\b/i,
    /\bi\s+(?:hate|can'?t\s+do)\s+this\b/i,
    /\bthis\s+(?:doesn'?t|does\s+not)\s+make\s+sense\b/i,
    /\byou'?re\s+not\s+listening\b/i,
    /\byou\s+(?:don'?t|never)\s+(?:listen|understand|hear)\b/i,
    /\bi\s+already\s+(?:said|told|answered)\b/i,
    /\byou\s+(?:already\s+)?asked\s+(?:me\s+)?(?:this|that)\b/i,
    /\bstop\s+(?:asking|repeating)\b/i,
    /\bsame\s+(?:question|thing)\b/i,
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
      const substantiveAfter = countContentWordsAfter(lower, matchEnd);
      const detected = substantiveAfter < 5;

      console.log("[frustration-check]", { detected, substantive: substantiveAfter, phrase: match[0] });

      if (!detected) {
        // Frustration phrase present but followed by substantive reasoning — not frustration
        return false;
      }
      return true;
    }
  }

  return false;
}

/**
 * Build an empathetic repair response. Varies by attempt count.
 * Never repeats the original prompt — always redirects constructively.
 */
function buildRepairResponse(questionText: string, attemptCount: number, hasHintsAvailable: boolean): string {
  const repairs = [
    "I hear you — let's try a different angle. What's one thing you already know about this topic?",
    "That's okay, this can be tricky! Just tell me one thing you think might be true about this.",
    hasHintsAvailable
      ? "I understand — sometimes questions are tough. Would you like a hint, or should we move on?"
      : "I understand — sometimes questions are tough. Want to give it one more try, or should we move on?",
  ];
  return repairs[attemptCount % repairs.length];
}

/**
 * Check if a student response contains a substantive answer (>= 4 content words),
 * even if it also contains frustration signals.
 * Example: "I think you asked that already — it's the distance from the Sun"
 * has frustration ("you asked that already") but also a real answer.
 */
export function isSubstantiveAnswer(studentText: string): boolean {
  const FILLER = new Set([
    "um","uh","uh","hmm","like","well","so","yeah","yep","ok","okay",
    "basically","right","just","really","very","the","a","an","is","are",
    "was","were","it","its","i","my","me","you","your","this","that",
    "and","or","but","to","of","in","on","for","with","do","don't",
    "does","doesn't","did","didn't","have","has","had","not","no",
  ]);
  const words = studentText
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !FILLER.has(w));
  return words.length >= 4;
}

// ---------------------------------------------------------------------------
// Utterance intent classification
// ---------------------------------------------------------------------------

/** Patterns indicating meta-conversational utterances (about the session, not the topic). */
const META_PATTERNS: RegExp[] = [
  /\bare\s+we\s+(going\s+to|gonna)\s+(talk|keep|continue|do)\b/i,
  /\bwhat\s+(are\s+we|happens)\s+(doing|now|next)\b/i,
  /\bwhat\s+do\s+(i|we)\s+do\s+now\b/i,
  /\bhow\s+(long|much\s+time|many\s+questions)\b/i,
  /\bis\s+(this|that|it)\s+(over|done|finished|the\s+end)\b/i,
  /\bare\s+you\s+(a\s+)?(robot|computer|ai|real|human|person)\b/i,
  /\bwho\s+are\s+you\b/i,
  /\bwhat\s+are\s+you\b/i,
  /\bcan\s+you\s+hear\s+me\b/i,
  /\bis\s+(this|it)\s+recording\b/i,
  /\bam\s+i\s+being\s+(recorded|filmed|watched)\b/i,
  /\bwhat\s+(is|was)\s+my\s+score\b/i,
  /\bhow\s+(am\s+i|did\s+i)\s+doing\b/i,
  /\bwhere\s+does\s+(this|the\s+conversation)\s+go\b/i,
  /\bsending\s+(the\s+)?conversation\b/i,
  /\bcan\s+i\s+(talk\s+to|see|ask)\s+(a|my|the)\s+(teacher|parent|person)\b/i,
  /\bwhat\s+(?:class|grade|subject)\s+is\s+this\b/i,
];

/** Patterns indicating explicit intent to end the session. */
const END_INTENT_PATTERNS: RegExp[] = [
  /\bi'?m\s+done\b/i,
  /\bi\s+want\s+to\s+(stop|quit|end|finish|leave|go)\b/i,
  /\blet'?s\s+(stop|end|finish|quit)\b/i,
  /\bcan\s+(we|i)\s+(stop|end|finish|leave|go)\b/i,
  /\bi\s+don'?t\s+want\s+to\s+(do|talk|answer|continue)\b/i,
  /\bno\s+more\s+(questions|talking)\b/i,
  /\bplease\s+stop\b/i,
  /^(stop|done|end|quit|bye|goodbye|finished)\s*[.!?]?$/i,
];

/** Patterns indicating confusion about the task (not about the topic content). */
const CONFUSION_PATTERNS: RegExp[] = [
  /\bwhat\s+(?:do\s+you\s+mean|are\s+you\s+(saying|asking|talking\s+about))\b/i,
  /\bi\s+don'?t\s+(?:understand|get)\s+(?:the\s+)?question\b/i,
  /\bcan\s+you\s+(?:explain|rephrase|say)\s+(?:that|it|the\s+question)\b/i,
  /\bthat\s+doesn'?t\s+make\s+(?:sense|any\s+sense)\b/i,
  /\bwhat\s+(?:does\s+that\s+mean|do\s+you\s+want\s+me\s+to\s+(say|do))\b/i,
  /\bi'?m\s+confused\b/i,
  /\bhuh\s*\?/i,
];

/** Words that are part of meta/session talk, not topic content. */
const META_SESSION_WORDS = new Set([
  "talk","talking","conversation","recording","score","question","questions",
  "time","done","stop","end","finish","finished","leave","going","gonna",
  "send","sending","robot","computer","person","teacher","parent",
  "long","many","more","next","over","listen","hear","repeat",
  "grade","class","subject","doing","happens","happen",
]);

/**
 * Count content words outside a pattern match that are NOT meta/session words.
 * Only topic-relevant words count toward the "has a real answer" threshold.
 */
function countTopicWordsOutsideMatch(text: string, pattern: RegExp): number {
  const match = pattern.exec(text.toLowerCase());
  if (!match) return 0;
  const before = text.slice(0, match.index);
  const after = text.slice(match.index + match[0].length);
  const remainder = (before + " " + after).trim();
  return remainder
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !FRUSTRATION_FILLER.has(w) && !META_SESSION_WORDS.has(w))
    .length;
}

/**
 * Classify a student utterance into an intent category.
 * This determines whether the utterance should be evaluated against the rubric.
 *
 * Priority:
 *   1. SILENCE — no speech / empty
 *   2. END_INTENT — student wants to stop
 *   3. META_CONVERSATION — about the session, not the topic
 *   4. CONFUSION — confused about the task/question
 *   5. CONTENT_ANSWER — default (send to evaluator)
 *
 * IMPORTANT: If a meta/confusion phrase is present but the utterance also
 * contains >= 4 content words OUTSIDE the matched phrase, treat as CONTENT_ANSWER.
 * Example: "Are we done? I think the answer is gravity" → CONTENT_ANSWER
 */
export function classifyStudentUtterance(response: string): UtteranceIntent {
  const trimmed = response.trim();
  if (!trimmed || trimmed.toLowerCase() === "(no speech detected)" || trimmed.toLowerCase() === "no speech detected") {
    return "SILENCE";
  }

  const lower = trimmed.toLowerCase();

  // END_INTENT — checked first because it's actionable (wraps session)
  for (const pattern of END_INTENT_PATTERNS) {
    if (pattern.test(lower)) {
      if (countTopicWordsOutsideMatch(trimmed, pattern) >= 4) {
        return "CONTENT_ANSWER";
      }
      return "END_INTENT";
    }
  }

  // META_CONVERSATION — about the session itself
  for (const pattern of META_PATTERNS) {
    if (pattern.test(lower)) {
      if (countTopicWordsOutsideMatch(trimmed, pattern) >= 4) {
        return "CONTENT_ANSWER";
      }
      return "META_CONVERSATION";
    }
  }

  // CONFUSION — confused about the task (not topic content)
  for (const pattern of CONFUSION_PATTERNS) {
    if (pattern.test(lower)) {
      if (countTopicWordsOutsideMatch(trimmed, pattern) >= 4) {
        return "CONTENT_ANSWER";
      }
      return "CONFUSION";
    }
  }

  return "CONTENT_ANSWER";
}

/** Detect requests to restate/repeat the question. */
export function isRestateQuestionRequest(response: string): boolean {
  const trimmed = response.trim().toLowerCase();
  const restatePatterns = [
    /\brestate\s+(the\s+)?question\b/i,
    /\brepeat\s+(the\s+)?question\b/i,
    /\bsay\s+(the\s+)?question\s+again\b/i,
    /\bwhat\s+(was|is)\s+the\s+question\b/i,
    /\bcan\s+you\s+(repeat|restate|say)\s+(the\s+)?question\b/i,
    /\btell\s+me\s+the\s+question\s+again\b/i,
    /\bread\s+(the\s+|it\s+)?again\b/i,
    /\bwhat\s+did\s+you\s+(ask|say)\b/i,
    /\bask\s+(me\s+)?(the\s+)?question\s+again\b/i,
    /\bi\s+forgot\s+the\s+question\b/i,
  ];
  return restatePatterns.some((p) => p.test(trimmed));
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
 * Build a deterministic retry prompt based on the question text.
 * Used when score < 80 and shouldContinue=true to replace generic LLM wording.
 */
export function buildRetryPrompt(questionText: string): string {
  const lower = questionText.toLowerCase();
  if (/\bthree\b/.test(lower) || /\bat\s+least\s+three\b/.test(lower)) {
    return "Try naming three examples. What can you think of?";
  }
  return "Tell me one example first. What comes to mind?";
}

/**
 * Build a deterministic Socratic probe when the LLM fails to include one.
 * Used as a fallback when probeFirst=true but the LLM response has no question.
 */
export function buildProbeFromQuestion(questionText: string, studentAnswer: string): string {
  const answerLower = studentAnswer.toLowerCase();
  const questionLower = questionText.toLowerCase();

  // Examples / materials questions — rubric-aligned probes for science topics.
  // Checked BEFORE procedural to prevent math probes leaking into conceptual questions.
  if (/\bexamples?\b|\bdifferent\b|\bmaterials?\b|\bmade\s+of\b/i.test(questionLower)) {
    const namedPlanet = /\b(mercury|venus|earth|mars|jupiter|saturn|uranus|neptune)\b/i.test(answerLower);
    if (!namedPlanet) {
      return "Nice start. Which two planets will you use as examples, and what is each made of?";
    }
    return "Good. For each planet you named, what is it made of?";
  }

  // Procedural / math questions — evidence-based probes.
  // Tightened to be math-specific to avoid false positives on science questions.
  const isProceduralMath =
    /\bsubtract|\baddition\b|\badd(?:ing)?\s+\d|\bsum\b|\bdifference\b|\bmultiply|\bdivide|\bproduct\b|\bquotient\b/i.test(questionLower) ||
    /\bshow\s+(?:your|the)\s+work\b|\bstep\s+by\s+step\b|\bsolve\b|\bcalculate\b/i.test(questionLower) ||
    /\d+\s*[+\-×÷xX*]\s*\d+/.test(questionLower);

  if (isProceduralMath) {
    const hasSteps = /first|then|next|after|start|step/i.test(answerLower);
    const hasNumbers = /\d/.test(answerLower);
    if (hasNumbers && !hasSteps) {
      return "Can you walk me through each step? What did you do first?";
    }
    if (hasSteps) {
      return "Why did you choose to do it in that order?";
    }
    return "Show me the first step you used to solve the math problem.";
  }

  // List-type answers: ask about one item
  const listItems = answerLower.split(/[,\s]+and\s+|\s*,\s*/).filter(s => s.trim().length > 2);
  if (listItems.length >= 2) {
    const item = listItems[0].trim();
    return `You mentioned ${item}. Can you tell me more about that?`;
  }

  // Question asks for description/explanation
  if (/describe|explain|why|how/i.test(questionText)) {
    return "Can you give me one example or detail about that?";
  }

  // Default Socratic probe
  return "Tell me a bit more about why you think that.";
}

/**
 * Detect LLM wording that incorrectly praises the student as correct.
 * Used to override coach text when score < CORRECT_THRESHOLD.
 */
export function containsCorrectLanguage(text: string): boolean {
  const lower = text.toLowerCase();
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
  return correctPatterns.some((p) => p.test(lower));
}

// ---------------------------------------------------------------------------
// Core decision function
// ---------------------------------------------------------------------------

/**
 * Compute the next video coach action based on current state.
 * Pure function — no side effects.
 */
export function computeVideoCoachAction(
  state: VideoCoachState
): VideoCoachAction {
  const {
    latestStudentResponse,
    attemptCount,
    hintOfferPending,
    hintIndex,
    hintDeclineCount,
    hintsAvailable,
    maxAttempts,
    questionText,
    followUpCount,
    lastCoachQuestion,
    activeMathQuestion,
    hasReasoningSteps,
  } = state;

  // Use activeMathQuestion (survives procedural messages) for context-aware validation,
  // falling back to lastCoachQuestion for non-math flows.
  const effectiveCoachQuestion = activeMathQuestion || lastCoachQuestion;

  const hasHintsAvailable = hintsAvailable.length > 0 && hintIndex < hintsAvailable.length;

  // Hint meta-conversation: does NOT increment attemptCount.
  // Accepting/declining/offering hints is not an answer attempt.
  const hintUpdates = {
    attemptCount,
    hintOfferPending: false,
    hintIndex,
    hintDeclineCount,
    hintUsed: false,
    followUpCount,
  };

  // Actual answer attempt: increments attemptCount.
  // Used for EVALUATE_ANSWER, ASK_RETRY, MARK_DEVELOPING.
  const answerUpdates = {
    attemptCount: attemptCount + 1,
    hintOfferPending: false,
    hintIndex,
    hintDeclineCount,
    hintUsed: false,
    followUpCount,
  };

  // -----------------------------------------------------------------------
  // STEP 1: If hint offer is pending, parse the student's response
  // MATH CONTENT BYPASS: If the student gives a valid math answer (e.g.,
  // "five", "1 + 4 = 5", "No 1 + 4 = 5") instead of responding to the
  // hint offer, treat it as a content answer — clear pending and fall through.
  // -----------------------------------------------------------------------
  if (hintOfferPending) {
    // REASONING-STEP BYPASS: If the prompt has deterministic reasoning steps,
    // clear hintOfferPending and fall through to EVALUATE_ANSWER — the backend's
    // deterministic remediation engine handles all hint/probe selection.
    if (hasReasoningSteps) {
      console.log("[VideoSM] hasReasoningSteps — clearing hintOfferPending, routing to backend");
      // Fall through: hintOfferPending will be cleared by stateUpdates below
    } else {
    // Check if this looks like math content rather than hint meta-conversation
    const hasMathContent = containsMathContent(latestStudentResponse);
    const mathContextValid = effectiveCoachQuestion
      ? isShortAnswerValidForCoachQuestion(latestStudentResponse, effectiveCoachQuestion)
      : false;

    if (hasMathContent && (mathContextValid || /\d+\s*[+\-×x]\s*\d+\s*=\s*\d+/.test(normalizeNumberWordsClient(latestStudentResponse)))) {
      console.log("[VideoSM] Hint offer pending but math content detected — treating as content answer");
      // Fall through to STEP 2+ with hintOfferPending cleared
    } else {
    const decision = parseHintResponse(latestStudentResponse);
    console.log("[VideoSM] Hint offer pending, decision:", decision);

    if (decision === "accept" && hasHintsAvailable) {
      // DELIVER_HINT — hint meta-conversation, no attempt increment
      const hint = hintsAvailable[hintIndex];
      console.log("[VideoSM] DELIVER_HINT, hintIndex:", hintIndex);
      return {
        type: "DELIVER_HINT",
        response: `Here's a hint: ${hint}. Now, can you try answering the question again?`,
        shouldContinue: true,
        stateUpdates: {
          ...hintUpdates,
          hintOfferPending: false,
          hintIndex: hintIndex + 1,
          hintUsed: true,
        },
      };
    }

    if (decision === "inquire") {
      // HINT_INQUIRY_RESPONSE — student asked about hints, tell count, keep offer pending
      const remaining = hintsAvailable.length - hintIndex;
      const response = remaining > 0
        ? `I have ${remaining} hint${remaining > 1 ? "s" : ""} I can share. Would you like one?`
        : "I don't have any more hints, but give it your best try — what do you think?";
      console.log("[VideoSM] HINT_INQUIRY_RESPONSE, remaining hints:", remaining);
      return {
        type: "HINT_INQUIRY_RESPONSE",
        response,
        shouldContinue: true,
        stateUpdates: {
          ...hintUpdates,
          hintOfferPending: remaining > 0, // keep offering if hints available
        },
      };
    }

    if (decision === "decline") {
      if (hintDeclineCount === 0) {
        // RETRY_AFTER_DECLINE — hint meta-conversation, no attempt increment
        console.log("[VideoSM] RETRY_AFTER_DECLINE (first decline)");
        return {
          type: "RETRY_AFTER_DECLINE",
          response:
            "Okay! Want to give it your best try, or would you like that hint after all?",
          shouldContinue: true,
          stateUpdates: {
            ...hintUpdates,
            hintOfferPending: true, // still waiting for hint decision
            hintDeclineCount: hintDeclineCount + 1,
          },
        };
      } else {
        // HARD GUARDRAIL: never end when student hasn't attempted an answer
        if (attemptCount < MIN_ATTEMPTS_BEFORE_FAIL) {
          console.log("[VideoSM] GUARDRAIL: blocking END_AFTER_DECLINE at attemptCount", attemptCount);
          return {
            type: "ASK_RETRY",
            response: "No problem! Give it your best try — what do you think the answer is?",
            shouldContinue: true,
            stateUpdates: {
              ...hintUpdates,
              hintDeclineCount: hintDeclineCount + 1,
            },
          };
        }
        // END_AFTER_DECLINE — hint meta-conversation, no attempt increment
        console.log("[VideoSM] END_AFTER_DECLINE (decline count:", hintDeclineCount + 1, ")");
        return {
          type: "END_AFTER_DECLINE",
          response: "No problem! Let's move on.",
          shouldContinue: false,
          endReason: "declined-hints",
          stateUpdates: {
            ...hintUpdates,
            hintDeclineCount: hintDeclineCount + 1,
          },
        };
      }
    }

    // "unclear" → clear pending flag, fall through to step 2
    console.log("[VideoSM] Unclear hint response, falling through");
    } // end else (non-math hint response)
    } // end else (!hasReasoningSteps)
  }

  // -----------------------------------------------------------------------
  // STEP 2: No speech detected — reprompt without counting as attempt
  // -----------------------------------------------------------------------
  if (isNoSpeech(latestStudentResponse)) {
    console.log("[VideoSM] No speech detected");
    if (hasHintsAvailable && !hasReasoningSteps && hintDeclineCount < MAX_HINT_DECLINES) {
      console.log("[VideoSM] OFFER_HINT (no speech, hints available)");
      return {
        type: "OFFER_HINT",
        response: "I didn't catch that — would you like a hint, or would you like to try again?",
        shouldContinue: true,
        stateUpdates: {
          ...hintUpdates,
          hintOfferPending: true,
        },
      };
    }
    console.log("[VideoSM] ASK_RETRY (no speech, no hints)");
    return {
      type: "ASK_RETRY",
      response: "I didn't catch that — can you try answering the question?",
      shouldContinue: true,
      stateUpdates: hintUpdates, // no attempt increment for no-speech
    };
  }

  // -----------------------------------------------------------------------
  // STEP 2.5: Restate question request
  // -----------------------------------------------------------------------
  if (isRestateQuestionRequest(latestStudentResponse)) {
    console.log("[VideoSM] REPEAT_QUESTION");
    return {
      type: "REPEAT_QUESTION",
      response: `Sure! The question is: ${state.questionText}. What do you think?`,
      shouldContinue: true,
      stateUpdates: {
        ...hintUpdates,
        hintOfferPending: hintOfferPending, // preserve current value
      },
    };
  }

  // -----------------------------------------------------------------------
  // STEP 3: Explicit hint request (even outside offer/accept flow)
  // -----------------------------------------------------------------------
  if (isHintRequest(latestStudentResponse)) {
    console.log("[VideoSM] Explicit hint request detected");
    // REASONING-STEP BYPASS: Route hint requests through backend deterministic
    // remediation — it produces step-specific, operand-aligned hints.
    if (hasReasoningSteps) {
      console.log("[VideoSM] EVALUATE_ANSWER (hint request → deterministic step hint)");
      return {
        type: "EVALUATE_ANSWER",
        shouldContinue: true,
        stateUpdates: hintUpdates, // no attempt increment — hint request is not an answer
      };
    }
    if (hasHintsAvailable) {
      const hint = hintsAvailable[hintIndex];
      console.log("[VideoSM] DELIVER_HINT (requested), hintIndex:", hintIndex);
      return {
        type: "DELIVER_HINT",
        response: `Here's a hint: ${hint}. Now, can you try answering the question again?`,
        shouldContinue: true,
        stateUpdates: {
          ...hintUpdates,
          hintIndex: hintIndex + 1,
          hintUsed: true,
        },
      };
    }
    console.log("[VideoSM] ASK_RETRY (no more hints)");
    return {
      type: "ASK_RETRY",
      response: "I don't have more hints, but give it your best try — what do you think?",
      shouldContinue: true,
      stateUpdates: hintUpdates, // no attempt increment for hint requests
    };
  }

  // -----------------------------------------------------------------------
  // STEP 3.5: Utterance intent classification
  // Meta-conversational, confusion, and end-intent utterances should NOT
  // be scored against the rubric or increment attemptCount.
  // Placed before low-confidence check because "I'm done" and
  // "I don't understand the question" would otherwise be caught as low-confidence.
  // -----------------------------------------------------------------------
  const utteranceIntent = classifyStudentUtterance(latestStudentResponse);
  console.log("[VideoSM] utteranceIntent=" + utteranceIntent + " evaluationSkipped=" + (utteranceIntent !== "CONTENT_ANSWER"));

  if (utteranceIntent === "END_INTENT") {
    console.log("[VideoSM] END_SESSION — student wants to stop");
    return {
      type: "END_SESSION",
      response: "Okay, no problem! Let's wrap up. You did a great job today.",
      shouldContinue: false,
      endReason: "student-ended",
      utteranceIntent,
      stateUpdates: hintUpdates, // no attempt increment
    };
  }

  if (utteranceIntent === "META_CONVERSATION") {
    console.log("[VideoSM] META_RESPONSE — meta-conversational, not scoring");
    return {
      type: "META_RESPONSE",
      response: "Great question! Right now we're working on this topic together. " +
        "Let's keep going — what do you think about the question?",
      shouldContinue: true,
      utteranceIntent,
      stateUpdates: hintUpdates, // no attempt increment
    };
  }

  if (utteranceIntent === "CONFUSION") {
    console.log("[VideoSM] META_RESPONSE — confusion about task, not scoring");
    return {
      type: "META_RESPONSE",
      response: "No worries! Let me put it another way. " + questionText +
        " Just tell me what you think in your own words.",
      shouldContinue: true,
      utteranceIntent,
      stateUpdates: hintUpdates, // no attempt increment
    };
  }

  // -----------------------------------------------------------------------
  // STEP 4: Low-confidence response
  // Context-aware bypass: if the coach asked a targeted sub-question and
  // the student's short answer is valid for that context, skip low-confidence.
  // -----------------------------------------------------------------------
  const contextValid = effectiveCoachQuestion
    ? isShortAnswerValidForCoachQuestion(latestStudentResponse, effectiveCoachQuestion)
    : false;

  if (contextValid) {
    console.log("[VideoSM] Short answer valid for coach question context — bypassing low-confidence check");
  }

  if (!contextValid && isLowConfidenceResponse(latestStudentResponse)) {
    console.log("[VideoSM] Low confidence detected");

    // REASONING-STEP BYPASS: Route "I don't know" through backend deterministic
    // remediation — it gives a simpler step probe for the next missing step.
    if (hasReasoningSteps) {
      console.log("[VideoSM] EVALUATE_ANSWER (low confidence → deterministic step probe)");
      return {
        type: "EVALUATE_ANSWER",
        shouldContinue: true,
        stateUpdates: hintUpdates, // no attempt increment — uncertainty is not an answer
      };
    }

    if (hasHintsAvailable && hintDeclineCount < MAX_HINT_DECLINES) {
      // OFFER_HINT — hint meta-conversation, no attempt increment
      console.log("[VideoSM] OFFER_HINT");
      return {
        type: "OFFER_HINT",
        response:
          "That's okay! Would you like a hint to help you think about this?",
        shouldContinue: true,
        stateUpdates: {
          ...hintUpdates,
          hintOfferPending: true,
        },
      };
    }

    if (attemptCount + 1 < maxAttempts) {
      // ASK_RETRY — actual failed attempt, increment attemptCount
      console.log("[VideoSM] ASK_RETRY (attempts:", attemptCount + 1, "/", maxAttempts, ")");
      return {
        type: "ASK_RETRY",
        response:
          "That's okay! Let's try thinking about it another way. Can you give it another try?",
        shouldContinue: true,
        stateUpdates: answerUpdates,
      };
    }

    // HARD GUARDRAIL: never end when student hasn't had enough real attempts
    if (attemptCount + 1 < MIN_ATTEMPTS_BEFORE_FAIL) {
      console.log("[VideoSM] GUARDRAIL: blocking MARK_DEVELOPING at attemptCount", attemptCount);
      return {
        type: "ASK_RETRY",
        response:
          "That's okay! Let's try thinking about it another way. Can you give it another try?",
        shouldContinue: true,
        stateUpdates: answerUpdates,
      };
    }

    // MARK_DEVELOPING — actual failed attempt, increment attemptCount
    console.log("[VideoSM] MARK_DEVELOPING (max attempts reached)");
    return {
      type: "MARK_DEVELOPING",
      response: "That's okay! Let's move on to the next question.",
      shouldContinue: false,
      endReason: "max-attempts",
      stateUpdates: answerUpdates,
    };
  }

  // -----------------------------------------------------------------------
  // STEP 4.5: Frustration / disengagement → empathetic repair (NOT an attempt)
  // If the student is frustrated BUT also gave a substantive answer (>= 4
  // content words), treat it as a real answer and fall through to EVALUATE.
  // Example: "I think you asked that already — it's the distance from the Sun"
  // -----------------------------------------------------------------------
  if (isFrustrationSignal(latestStudentResponse) && !isSubstantiveAnswer(latestStudentResponse)) {
    console.log("[VideoSM] FRUSTRATION_REPAIR detected (no substantive answer)");
    const repairResponse = buildRepairResponse(questionText, attemptCount, hasHintsAvailable);
    return {
      type: "FRUSTRATION_REPAIR",
      response: repairResponse,
      shouldContinue: true,
      stateUpdates: {
        ...hintUpdates, // no attempt increment — frustration is not an answer
        hintOfferPending: repairResponse.includes("hint"), // enable hint flow if offered
      },
    };
  }
  if (isFrustrationSignal(latestStudentResponse) && isSubstantiveAnswer(latestStudentResponse)) {
    console.log("[VideoSM] Frustration detected but substantive answer present — treating as answer");
  }

  // -----------------------------------------------------------------------
  // STEP 5: Substantive response → send to LLM for scoring
  // -----------------------------------------------------------------------
  // EVALUATE_ANSWER — actual answer attempt, increment attemptCount
  console.log("[VideoSM] EVALUATE_ANSWER");
  return {
    type: "EVALUATE_ANSWER",
    shouldContinue: true, // placeholder; real value comes from resolvePostEvaluation
    utteranceIntent: "CONTENT_ANSWER",
    stateUpdates: answerUpdates,
  };
}

// ---------------------------------------------------------------------------
// Post-evaluation guardrail
// ---------------------------------------------------------------------------

/**
 * Applied after getCoachFeedback returns a score.
 * Enforces the hard guardrail: never end on first failed attempt.
 * Returns probeFirst=true when the answer is correct but the coach should
 * ask one Socratic follow-up before advancing to the next question.
 */
export function resolvePostEvaluation(
  evalResult: { score: number; isCorrect: boolean; shouldContinue: boolean },
  attemptCount: number,
  maxAttempts: number,
  followUpCount: number = 0
): { shouldContinue: boolean; probeFirst: boolean } {
  // Correct answer: allow one probe before ending
  if (evalResult.score >= CORRECT_THRESHOLD) {
    if (followUpCount === 0) {
      console.log("[VideoSM] resolvePostEvaluation: correct but no probe yet, allowing follow-up");
      return { shouldContinue: true, probeFirst: true };
    }
    console.log("[VideoSM] resolvePostEvaluation: correct (score", evalResult.score, "), ending");
    return { shouldContinue: false, probeFirst: false };
  }

  // HARD GUARDRAIL: Incorrect on first attempt → NEVER end
  if (attemptCount < MIN_ATTEMPTS_BEFORE_FAIL) {
    console.log(
      "[VideoSM] resolvePostEvaluation: GUARDRAIL — blocking end on attempt",
      attemptCount,
      "(min:", MIN_ATTEMPTS_BEFORE_FAIL, ")"
    );
    return { shouldContinue: true, probeFirst: false };
  }

  // Incorrect and max attempts reached: end
  if (attemptCount + 1 >= maxAttempts) {
    console.log("[VideoSM] resolvePostEvaluation: max attempts reached, ending");
    return { shouldContinue: false, probeFirst: false };
  }

  // Incorrect, not first, not max: continue
  console.log("[VideoSM] resolvePostEvaluation: incorrect, keep trying");
  return { shouldContinue: true, probeFirst: false };
}

// ---------------------------------------------------------------------------
// Mastery stop rule — prevents unnecessary probing after strong answers
// ---------------------------------------------------------------------------

export const MASTERY_STOP_THRESHOLD = 85;
export const PROCEDURAL_MASTERY_THRESHOLD = 90;

/**
 * Detect procedural (step-by-step math/algorithm) questions client-side.
 * Mirrors the server-side classifyConceptType procedural branch.
 */
export function isProceduralQuestion(questionText: string): boolean {
  const lower = questionText.toLowerCase();
  const hasMathContext = /\d|add|subtract|multiply|divide|calculate|equation|expression/i.test(lower);
  return /\bsubtract\b/i.test(lower)
  || /\baddition\b/i.test(lower)
  || /\badd(?:ing)?\s+\d/i.test(lower)
  || /\bsum\b/i.test(lower)
  || /\bdifference\b/i.test(lower)
  || /\bsolve\s+(?:the\s+)?(?:problem|equation|expression)\b/i.test(lower)
  || (/\bsolve\b/i.test(lower) && /\d/.test(lower))
  || /\bshow\s+your\s+work\b/i.test(lower)
  || (/\bexplain\s+(?:your|the)\s+(?:thinking|steps)\b/i.test(lower) && hasMathContext)
  || /\bwhat\s+is\s+\d+\s*[+\-×÷xX*]\s*\d+/i.test(lower)
  || /\d+\s*[+\-×÷xX*]\s*\d+/.test(lower);
}

/**
 * Client-side mastery stop rule — applied AFTER receiving the API response.
 *
 * Prevents the coach from probing a student who already demonstrated mastery:
 * - score >= 85, CONTENT_ANSWER, turnKind is PROBE, attemptCount >= 1 → stop
 * - score >= 90, procedural question → stop even on first attempt (optional fast-track)
 *
 * Returns `null` if no override needed, or `{ shouldContinue, turnKind }` to apply.
 */
export function shouldApplyMasteryStop(params: {
  score: number;
  turnKind: string;
  attemptCount: number;
  questionText?: string;
  criteriaMet?: boolean;
  utteranceIntent?: "CONTENT_ANSWER" | "META" | "CONFUSION" | "STOP" | string;
}): { shouldContinue: false; turnKind: "WRAP" } | null {
  const { score, turnKind, attemptCount, questionText, criteriaMet, utteranceIntent } = params;

  if(!criteriaMet) return null;
  if(utteranceIntent !== "CONTENT_ANSWER") return null;
  

  // Fast-track: procedural question with very high score → skip probe entirely
  if (
    score >= PROCEDURAL_MASTERY_THRESHOLD &&
    turnKind === "PROBE" &&
    questionText &&
    isProceduralQuestion(questionText)
  ) {
    console.log(
      "[VideoSM] masteryStop: procedural fast-track (score",
      score,
      ", attemptCount",
      attemptCount,
      ") → WRAP"
    );
    return { shouldContinue: false, turnKind: "WRAP" };
  }

  // Standard mastery stop: strong score + already probed at least once
  if (
    score >= MASTERY_STOP_THRESHOLD &&
    turnKind === "PROBE" &&
    attemptCount >= 1
  ) {
    console.log(
      "[VideoSM] masteryStop: score",
      score,
      "attemptCount",
      attemptCount,
      "→ WRAP"
    );
    return { shouldContinue: false, turnKind: "WRAP" };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Outcome derivation (replaces hardcoded score: 80)
// ---------------------------------------------------------------------------

/**
 * Derive the final outcome for a video conversation submission.
 * No fabricated scores — if we don't have a real LLM score, persist undefined.
 *
 * Outcome mapping (aligned with calculateQuestionOutcome in teacherDashboardUtils.ts:120-153):
 * - score >= 80 AND !hintUsed → "demonstrated"
 * - score >= 80 AND hintUsed  → "with-support"
 * - score < 80                → "developing"
 * - score === undefined       → "needs-review"
 */
export function deriveVideoOutcome(inputs: VideoOutcomeInputs): {
  score: number | undefined;
  isCorrect: boolean;
  endReason?: VideoEndReason;
} {
  // Ended without LLM evaluation → no score, needs teacher review
  if (
    inputs.endReason === "max-attempts" ||
    inputs.endReason === "declined-hints"
  ) {
    console.log("[VideoSM] deriveVideoOutcome: no score (endReason:", inputs.endReason, ") → needs-review");
    return {
      score: undefined,
      isCorrect: false,
      endReason: inputs.endReason,
    };
  }

  // Have a real score from getCoachFeedback
  if (inputs.lastScore !== undefined) {
    const isCorrect = inputs.lastScore >= CORRECT_THRESHOLD;
    console.log("[VideoSM] deriveVideoOutcome: score", inputs.lastScore, "→", isCorrect ? "correct" : "incorrect");
    return {
      score: inputs.lastScore,
      isCorrect,
    };
  }

  // No score available (edge case) → needs teacher review
  console.log("[VideoSM] deriveVideoOutcome: no score, no endReason → needs-review");
  return { score: undefined, isCorrect: false, endReason: "no-score" };
}
