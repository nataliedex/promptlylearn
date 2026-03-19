/**
 * Video Coach Guardrails (Server-Side)
 *
 * Pure deterministic functions ported from web/src/domain/videoCoachStateMachine.ts
 * for use in the combined /api/coach/video-turn endpoint. Keeps guardrail logic
 * server-side so the client doesn't need two round trips.
 */

import { PromptScope } from "./prompt";
import { MathProblem } from "./mathProblem";
import { MathValidationResult, MathBoundingDecision, normalizeNumberWords } from "./mathAnswerValidator";
import { detectConceptConfusion, type AnswerScope } from "./deterministicRemediation";
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
  mathMasteryOverride?: boolean,
  mathAnswerCorrect?: boolean,
): { shouldContinue: boolean; probeFirst: boolean } {
  // MATH MASTERY OVERRIDE: Deterministic math validation determined mastery
  // (correct answer + strategy). End immediately — overrides all heuristics.
  if (mathMasteryOverride) {
    if (DEBUG_GUARDRAILS) {
      console.log("[resolvePostEval] mathMasteryOverride=true — ending immediately");
    }
    return { shouldContinue: false, probeFirst: false };
  }

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

  // MATH ANSWER CORRECT BUT EXPLANATION MISSING:
  // Score < 80 because explanation is incomplete, but the math answer IS
  // deterministically correct. Do NOT treat as "incorrect at max attempts" —
  // continue probing for explanation. The student got it right; they just
  // need to explain HOW.
  if (mathAnswerCorrect && evalResult.score < CORRECT_THRESHOLD) {
    if (DEBUG_GUARDRAILS) {
      console.log(`[resolvePostEval] mathAnswerCorrect=true but score=${evalResult.score} < ${CORRECT_THRESHOLD} — probing for explanation (not wrapping)`);
    }
    return { shouldContinue: true, probeFirst: true };
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
 * Check whether deterministic math validation indicates mastery.
 * Returns true when the student answered correctly AND demonstrated
 * enough strategy for a "strong" bounding. Pure function.
 */
export function checkMathMastery(
  mathValidation: MathValidationResult,
  mathBounding: MathBoundingDecision,
): boolean {
  return mathValidation.status === "correct" && mathBounding.boundedStatus === "strong";
}

/**
 * Detect whether a math prompt requires the student to EXPLAIN their process,
 * not just give a numeric answer. When true, a correct number alone should NOT
 * short-circuit the evaluation — the full pipeline must run to assess explanation quality.
 */
export function promptRequiresMathExplanation(promptInput: string): boolean {
  const lower = promptInput.toLowerCase();
  return /\b(?:explain|tell\s+(?:what|how)\s+you\s+(?:did|got)|show\s+how|why|regroup|carry|describe|what\s+happens?\s+when|walk\s+(?:me\s+)?through|how\s+(?:did\s+you|you\s+got)|(?:first|next)\s+step|what\s+(?:did|do)\s+you\s+do|what\s+(?:is|was)\s+(?:the\s+)?(?:first|next)\s+step|step\s+you\s+used)\b/.test(lower);
}

/**
 * Build a performance-aware closing message based on evaluated outcome.
 * Replaces generic wrap language that can contradict the student's performance.
 *
 * Hard invariants:
 * - "strong" close NEVER contains "Thanks for trying"
 * - Non-"strong" close NEVER contains "met the goal" or "solved correctly"
 */
export function buildPerformanceAwareClose(
  status: "strong" | "developing" | "needs_support" | "not_enough_evidence",
  feedbackPrefix?: string,
): string {
  switch (status) {
    case "strong": {
      const prefix = feedbackPrefix || "Great work";
      return `${prefix}! You solved the problem correctly and explained your thinking.`;
    }
    case "developing":
      return "Nice start. You got part of it right, and we'll keep practicing this skill.";
    case "needs_support":
      return "Thanks for trying. We'll keep working on this skill next time.";
    case "not_enough_evidence":
      return "We didn't get enough math evidence this time, so we'll try again later.";
  }
}

// ============================================
// MATH STRATEGY PROBE BUILDER
// ============================================

/** Map from strategy tag to a targeted follow-up probe question. */
const MATH_STRATEGY_PROBES: Record<string, string> = {
  "add ones": "What did you do with the ones digits?",
  "carry": "Did you need to regroup? What happened with the extra ones?",
  "add tens": "What about the tens — how did you add those?",
  "check ones": "Can you start by looking at the ones place?",
  "borrow from tens": "The ones digit on top is smaller — what do you need to do?",
  "subtract ones": "After borrowing, what do you get when you subtract the ones?",
  "subtract tens": "Now look at the tens column — what happens there?",
  "multiply": "How would you multiply these numbers?",
  "skip count": "Can you count by that number to find the answer?",
  "groups of": "Can you think of this as groups? How many groups and how many in each?",
  "identify digit": "Which digit is in the {targetPlace} place?",
  "name ones place": "What is the ones place?",
  "name tens place": "What is the tens place?",
  "name hundreds place": "What is the hundreds place?",
};

/**
 * Build a strategy-anchored probe for a deterministic math problem.
 * Finds the first undemonstrated strategy from expectedStrategyTags
 * and returns a targeted question. Returns null when all strategies
 * are demonstrated (mastery — no more probing needed).
 *
 * For regrouping problems, prioritizes carry/borrow strategies.
 */
export function buildMathStrategyProbe(
  mathProblem: MathProblem,
  demonstratedStrategies: string[],
): string | null {
  const demonstrated = new Set(demonstratedStrategies.map(s => s.toLowerCase()));
  const missing = mathProblem.expectedStrategyTags.filter(
    tag => !demonstrated.has(tag.toLowerCase())
  );

  if (missing.length === 0) return null;

  // Prioritize carry/borrow strategies for regrouping problems
  if (mathProblem.requiresRegrouping) {
    const regroupTag = missing.find(t => t === "carry" || t === "borrow from tens");
    if (regroupTag) {
      return MATH_STRATEGY_PROBES[regroupTag] || `Can you explain how you handled the ${regroupTag}?`;
    }
  }

  // Return probe for first missing strategy
  const firstMissing = missing[0];
  let probe = MATH_STRATEGY_PROBES[firstMissing];
  if (probe && mathProblem.targetPlace) {
    probe = probe.replace("{targetPlace}", mathProblem.targetPlace);
  }
  return probe || `Can you explain how you handled the ${firstMissing} step?`;
}

/**
 * Build an operand-specific retry probe for a wrong math answer.
 * Uses the actual digits from the MathProblem to scaffold step-by-step
 * through the computation. For regrouping addition of 27+36:
 *   - "What is 7 + 6?" (add ones)
 *   - "7 + 6 makes 13. What do you do when the ones add up to more than 9?" (carry)
 *   - "Now look at the tens place. What is 2 + 3 (don't forget the carried 1)?" (add tens)
 *
 * Returns null when all strategies are already demonstrated.
 * Falls back to buildMathStrategyProbe for unsupported skills.
 */
export function buildMathRetryProbe(
  mathProblem: MathProblem,
  demonstratedStrategies: string[],
  matchedMisconception?: string,
): string | null {
  const demonstrated = new Set(demonstratedStrategies.map(s => s.toLowerCase()));

  if (mathProblem.skill === "two_digit_addition" && mathProblem.b !== undefined) {
    const onesA = mathProblem.a % 10;
    const onesB = mathProblem.b % 10;
    const onesSum = onesA + onesB;

    if (!demonstrated.has("add ones")) {
      return `Let's start with the ones place. What is ${onesA} + ${onesB}?`;
    }
    if (mathProblem.requiresRegrouping && !demonstrated.has("carry")) {
      return `${onesA} + ${onesB} makes ${onesSum}. What do you do when the ones add up to more than 9?`;
    }
    if (!demonstrated.has("add tens")) {
      const tensA = Math.floor(mathProblem.a / 10);
      const tensB = Math.floor(mathProblem.b / 10);
      const carryNote = mathProblem.requiresRegrouping ? " (don't forget the carried 1)" : "";
      return `Now look at the tens place. What is ${tensA} + ${tensB}${carryNote}?`;
    }
    return null;
  }

  if (mathProblem.skill === "two_digit_subtraction" && mathProblem.b !== undefined) {
    const onesA = mathProblem.a % 10;
    const onesB = mathProblem.b % 10;

    if (!demonstrated.has("check ones")) {
      return `Look at the ones place. Is ${onesA} big enough to subtract ${onesB}?`;
    }
    if (mathProblem.requiresRegrouping && !demonstrated.has("borrow from tens")) {
      return `${onesA} is less than ${onesB}, so we need to borrow. What happens when you borrow from the tens?`;
    }
    if (!demonstrated.has("subtract ones")) {
      const adjustedOnesA = mathProblem.requiresRegrouping ? onesA + 10 : onesA;
      return `What is ${adjustedOnesA} - ${onesB}?`;
    }
    if (!demonstrated.has("subtract tens")) {
      const tensA = Math.floor(mathProblem.a / 10);
      const tensB = Math.floor(mathProblem.b / 10);
      const adjustedTensA = mathProblem.requiresRegrouping ? tensA - 1 : tensA;
      return `Now the tens. What is ${adjustedTensA} - ${tensB}?`;
    }
    return null;
  }

  // For multiplication/place_value, fall back to existing generic probes
  return buildMathStrategyProbe(mathProblem, demonstratedStrategies);
}

// ============================================
// OFF-TOPIC DETECTION
// ============================================

/** Math vocabulary that indicates on-topic engagement. */
const MATH_VOCAB_PATTERN = /\b(?:add(?:ed|ing|s)?|plus|minus|subtract(?:ed|ing|s)?|tens?|ones?|carr(?:y|ied|ying)|borrow(?:ed|ing)?|times|equals?|multiply|multipli(?:ed|cation)|divid(?:e|ed|ing)|regroup(?:ed|ing)?|sum|total|answer|hundred(?:s)?|place|digit|number|leftover|left\s*over|together|first\s+step|next\s+step|start\s+with|put\s+together)\b/i;

/**
 * Check whether a student response is off-topic for the current question.
 * For math prompts: no digits AND no math vocabulary.
 * For non-math prompts: falls back to detectClearlyWrongAnswer.
 */
export function isOffTopicResponse(
  studentResponse: string,
  mathProblem?: MathProblem,
): boolean {
  const trimmed = studentResponse.trim();
  if (!trimmed) return true;

  if (mathProblem) {
    // Concept confusion questions ("What does that have to do with this problem?")
    // are NOT off-topic — the student is engaging with the coaching. Without this
    // carve-out, questions lacking digits and math vocab would be flagged off-topic,
    // triggering an early wrap instead of an instructional explanation.
    if (detectConceptConfusion(trimmed, mathProblem) !== null) {
      return false;
    }
    // Normalize number words ("five" → "5") before checking for digits
    const normalized = normalizeNumberWords(trimmed);
    const hasDigits = /\d/.test(normalized);
    const hasMathVocab = MATH_VOCAB_PATTERN.test(trimmed);
    return !hasDigits && !hasMathVocab;
  }

  return detectClearlyWrongAnswer(trimmed);
}

/**
 * Count the number of off-topic student turns in conversation history.
 */
export function countOffTopicTurns(
  conversationHistory: Array<{ role: string; message: string }>,
  mathProblem?: MathProblem,
): number {
  return conversationHistory
    .filter(h => h.role === "student")
    .filter(h => isOffTopicResponse(h.message, mathProblem))
    .length;
}

/**
 * Detect whether a student made progress after initially saying "I don't know"
 * and receiving a hint. If the last student turn in history was a "don't know"
 * variant and the current response contains math evidence, return true to
 * allow one more scaffolded follow-up before closing.
 */
export function detectHintFollowedByProgress(
  conversationHistory: Array<{ role: string; message: string }>,
  currentResponse: string,
  mathProblem?: MathProblem,
): boolean {
  if (!mathProblem) return false;

  // Find the last student turn in history
  const studentTurns = conversationHistory.filter(h => h.role === "student");
  if (studentTurns.length === 0) return false;

  const lastStudentTurn = studentTurns[studentTurns.length - 1];

  // Was the last student turn a "don't know" type?
  const isIDontKnow = /\b(?:i\s+don'?t\s+know|not\s+sure|no\s+idea|don'?t\s+understand|i\s+don'?t\s+get\s+it)\b/i.test(lastStudentTurn.message);
  if (!isIDontKnow) return false;

  // Current response has math evidence (digits or math vocabulary)?
  const hasProgress = !isOffTopicResponse(currentResponse, mathProblem);
  return hasProgress;
}

/**
 * Detect whether a student's answer contains strong procedural evidence
 * (step-by-step with numbers and intermediate results).
 * Used to skip unnecessary PROBE follow-ups when the student already
 * demonstrated their strategy clearly.
 */
export function hasProceduralEvidence(studentAnswer: string): boolean {
  const lower = studentAnswer.toLowerCase();
  const hasSteps = /first|then|next|after|start|step/i.test(lower);
  const hasNumbers = /\d/.test(lower);
  // Strategy keywords: breaking apart, splitting, decomposing
  const hasStrategy = /break\s*(?:up|apart|down)|split|tens\s+and\s+(?:the\s+)?ones/i.test(lower);
  // Intermediate sums: "34 + 20" or "34 + 20 = 54"
  const hasIntermediateSums = /\d+\s*[+\-×÷]\s*\d+/.test(lower);

  // Strong evidence: steps + numbers + (strategy OR intermediate math)
  return hasSteps && hasNumbers && (hasStrategy || hasIntermediateSums);
}

/**
 * Build a reflection question for procedural mastery.
 * Asks "why" instead of "what" when the student already showed the steps.
 */
export function buildProceduralReflection(questionText: string, studentAnswer: string): string {
  const lower = studentAnswer.toLowerCase();

  if (/break\s*(?:up|apart|down)|broke|split/i.test(lower)) {
    // Find what number they broke apart
    const brokenMatch = lower.match(/(?:break|split|broke)\s*(?:up|apart|down)?\s*(?:that\s+|the\s+)?(\d+)/);
    if (brokenMatch) {
      return `Nice work explaining your strategy! Why did breaking ${brokenMatch[1]} into parts help you solve the problem?`;
    }
    return "Nice work explaining your strategy! Why did breaking the number into parts help you solve it?";
  }

  if (/tens\s+and\s+(?:the\s+)?ones/i.test(lower) || /tens\s+first/i.test(lower)) {
    return "Nice work! Why does adding the tens first make this easier?";
  }

  return "Nice work explaining your steps! Why did you choose that approach?";
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
 * Detect LLM wording that prematurely declares the assignment complete.
 * Used to guard against completion language when rubric criteria aren't met.
 */
export function containsCompletionLanguage(text: string): boolean {
  const completionPatterns = [
    /completed\s+this\s+assignment/i,
    /you'?re\s+done/i,
    /that\s+works[.!]/i,
    /you'?ve\s+met\s+the\s+goal/i,
    /click\s+submit/i,
    /great\s+work\s+on\s+this\s+assignment/i,
    /good\s+effort.*let'?s\s+move\s+on/i,
    /that\s+wraps\s+up/i,
  ];
  return completionPatterns.some((p) => p.test(text));
}

// ============================================
// EXAMPLES/MATERIALS MASTERY GUARDRAIL
// ============================================

/** Planet names for matching in student responses. */
const PLANET_NAMES = /\b(mercury|venus|earth|mars|jupiter|saturn|uranus|neptune)\b/gi;

/** Materials that are valid for grade 2+ planet descriptions. */
const ROCKY_MATERIALS = /\b(rock|rocks|rocky|stone|metal|iron|dirt|soil|solid)\b/i;
const GAS_MATERIALS = /\b(gas|gases|gaseous|hydrogen|helium|atmosphere)\b/i;
const ICE_MATERIALS = /\b(ice|icy|frozen|cold|water)\b/i;

/**
 * Deterministic check for examples/materials mastery.
 * Returns "strong" if the student named 2+ distinct items (planets, animals, etc.)
 * AND provided a basic material/type for each. Returns null if the question
 * doesn't ask for examples/materials or the answer doesn't meet the bar.
 *
 * For grade 2, accepts simple terms like "rocks", "gas", "ice".
 */
export function evaluateExamplesMastery(
  questionText: string,
  studentTranscript: string,
  gradeLevel?: string,
): "strong" | null {
  const qLower = questionText.toLowerCase();

  // Only applies to questions asking for examples + materials
  const asksForExamples = /\bexamples?\b/i.test(qLower) || /\bdifferent\b/i.test(qLower);
  const asksForMaterials = /\bmaterials?\b/i.test(qLower) || /\bmade\s+of\b/i.test(qLower);
  if (!asksForExamples || !asksForMaterials) return null;

  const transcript = studentTranscript.toLowerCase();

  // Count distinct planets named
  const planetMatches = transcript.match(PLANET_NAMES);
  if (!planetMatches) return null;
  const distinctPlanets = new Set(planetMatches.map(p => p.toLowerCase()));
  if (distinctPlanets.size < 2) return null;

  // Check that the student provided material descriptions
  const hasRocky = ROCKY_MATERIALS.test(transcript);
  const hasGas = GAS_MATERIALS.test(transcript);
  const hasIce = ICE_MATERIALS.test(transcript);

  // Must describe at least 2 different material types (shows understanding of diversity)
  const materialTypes = [hasRocky, hasGas, hasIce].filter(Boolean).length;
  if (materialTypes < 2) return null;

  return "strong";
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

// ============================================
// WRONG-ANSWER DETECTION & RESPONSE
// ============================================

/**
 * Playful / nonsense nouns that are clearly invalid as science answers.
 * Kept intentionally small — only things a child might say as a joke or guess
 * that are obviously not real materials, planet names, or science terms.
 */
const SILLY_NOUNS_PATTERN = /\b(lollipops?|candy|candies|chocolate|pizza|unicorns?|rainbows?|toys?|cookies?|cakes?|spaghetti|noodles?|bubbles?|fair(?:y|ies)|dragons?|marshmallows?|glitter|sparkles?|jelly|cheese|chicken|broccoli|bananas?|ice\s*cream|poop|fart|boogers?|slime)\b/i;

/**
 * Vague praise phrases banned in wrong-answer responses.
 * Includes both prefix and mid-sentence patterns.
 */
const WRONG_ANSWER_PRAISE_PATTERN = /\b(good\s+(?:start|thinking|try|effort|thought|idea)|that'?s\s+(?:interesting|a\s+good\s+(?:start|thought))|i\s+see\s+(?:your|what\s+you'?re)\s+thinking|nice\s+(?:try|idea|thought)|that\s+works|interesting\s+idea)\b/i;

/**
 * Patterns indicating the LLM already produced proper correction language.
 * If present, we do NOT replace the response.
 */
const HAS_CORRECTION_PATTERN = /\bnot\s+quite\b|\bthat'?s\s+not\s+(?:right|correct)\b|\bincorrect\b|\bnot\s+(?:right|correct)\b|\bnot\s+(?:what|how)\s+planets?\b|\bnot\s+made\s+of\b/i;

/**
 * Valid domain content words — if the student's response contains ANY of these,
 * it is not purely nonsense (may still be wrong, but has real-domain vocabulary).
 */
const VALID_DOMAIN_CONTENT = /\b(?:rock(?:y|s)?|gas(?:eous|es)?|ice|icy|metal|iron|stone|solid|hydrogen|helium|frozen|silicon|mercury|venus|earth|mars|jupiter|saturn|uranus|neptune|planet|orbit|sun|star|gravity|atmosphere|core|surface|dust|soil)\b/i;

/**
 * Detect whether a student response is clearly wrong / nonsense content.
 *
 * Returns true when:
 *   - Response contains known silly nouns AND lacks valid domain vocabulary, OR
 *   - Response contains silly nouns in a "made of" construction (even alongside a valid planet name)
 *
 * Does NOT require a knowledge base — lightweight heuristic only.
 */
export function detectClearlyWrongAnswer(studentResponse: string): boolean {
  const lower = studentResponse.toLowerCase();

  const hasSilly = SILLY_NOUNS_PATTERN.test(lower);
  if (!hasSilly) return false;

  const hasValidContent = VALID_DOMAIN_CONTENT.test(lower);

  // Silly nouns with no valid domain content at all → clearly wrong
  if (!hasValidContent) return true;

  // Silly nouns in a "made of" construction → clearly wrong even with a valid planet name
  // e.g. "earth is made of lollipops" — Earth is valid but the claim is wrong
  if (/\bmade\s+of\b/i.test(lower)) return true;

  return false;
}

/**
 * Build a deterministic 3-sentence wrong-answer response:
 *   1. Brief correction
 *   2. Redirect to valid answer space
 *   3. One concrete retry question
 *
 * Uses scope-aligned probes when available; falls back to planets-specific
 * or generic retry questions.
 */
export function buildWrongAnswerResponse(
  questionText: string,
  studentResponse: string,
  scope: PromptScope | null,
): string {
  const lower = studentResponse.toLowerCase();

  // Extract the silly word for a specific correction
  const sillyMatch = lower.match(SILLY_NOUNS_PATTERN);
  const sillyWord = sillyMatch ? sillyMatch[0] : "that";

  // Detect question type for domain-appropriate language
  const isPlanetsQ = /\bplanet|made\s+of|material/i.test(questionText);

  // Sentence 1: Brief correction (kind but honest)
  const correction = isPlanetsQ
    ? `Not quite\u2014planets are not made of ${sillyWord}.`
    : `Not quite\u2014${sillyWord} isn't the right answer here.`;

  // Sentence 2: Redirect to valid answer space
  let redirect: string;
  if (isPlanetsQ) {
    redirect = "Try using real materials like rock, gas, or ice.";
  } else if (scope?.allowedKeywords?.length) {
    const kws = scope.allowedKeywords.slice(0, 3).join(", ");
    redirect = `Think about ${kws}.`;
  } else {
    redirect = "Try to think about what you know about this topic.";
  }

  // Sentence 3: One concrete retry question
  let retryQuestion: string;
  if (scope?.scopeAlignedProbes?.length) {
    retryQuestion = scope.scopeAlignedProbes[0];
  } else if (isPlanetsQ) {
    retryQuestion = "Can you name one planet and tell me what it's made of?";
  } else {
    retryQuestion = "What do you think the answer might be?";
  }

  return `${correction} ${redirect} ${retryQuestion}`;
}

/**
 * Check whether a coach response contains banned praise phrases for wrong answers.
 */
export function containsWrongAnswerPraise(response: string): boolean {
  return WRONG_ANSWER_PRAISE_PATTERN.test(response);
}

/**
 * Check whether a coach response already contains proper correction language.
 */
export function hasExplicitCorrection(response: string): boolean {
  return HAS_CORRECTION_PATTERN.test(response);
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
// STUDENT INTENT CLASSIFICATION (server-side)
// ============================================

export type StudentIntent = "content" | "meta_confusion" | "explicit_end";

/** Patterns indicating meta-conversational utterances (about the session, not the topic). */
const SERVER_META_PATTERNS: RegExp[] = [
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
  /\bthat'?s\s+not\s+what\s+we'?re\s+supposed\s+to\b/i,
];

/** Patterns indicating explicit intent to end the session. */
const SERVER_END_INTENT_PATTERNS: RegExp[] = [
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
const SERVER_CONFUSION_PATTERNS: RegExp[] = [
  /\bwhat\s+(?:do\s+you\s+mean|are\s+you\s+(saying|asking|talking\s+about))\b/i,
  /\bi\s+don'?t\s+(?:understand|get)\s+(?:the\s+)?question\b/i,
  /\bcan\s+you\s+(?:explain|rephrase|say)\s+(?:that|it|the\s+question)\b/i,
  /\bthat\s+doesn'?t\s+make\s+(?:sense|any\s+sense)\b/i,
  /\bwhat\s+(?:does\s+that\s+mean|do\s+you\s+want\s+me\s+to\s+(say|do))\b/i,
  /\bi'?m\s+confused\b/i,
  /\bhuh\s*\?/i,
];

/** Filler words excluded when counting topic-content words. */
const INTENT_FILLER = new Set([
  "um","uh","hmm","like","well","so","yeah","yep","ok","okay",
  "basically","right","just","really","very","the","a","an","is","are",
  "was","were","it","its","i","my","me","you","your","this","that",
  "and","or","but","to","of","in","on","for","with","do","don't",
  "does","doesn't","did","didn't","have","has","had","not","no",
  "dont","know","because","think","about","answer",
]);

/** Meta/session words that don't count as topic content. */
const INTENT_META_WORDS = new Set([
  "talk","talking","conversation","recording","score","question","questions",
  "time","done","stop","end","finish","finished","leave","going","gonna",
  "send","sending","robot","computer","person","teacher","parent",
  "long","many","more","next","over","listen","hear","repeat",
  "grade","class","subject","doing","happens","happen",
]);

/**
 * Count content words outside a pattern match that are NOT filler/meta words.
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
    .filter((w) => w.length > 0 && !INTENT_FILLER.has(w) && !INTENT_META_WORDS.has(w))
    .length;
}

/**
 * Classify a student's utterance intent for decision-engine purposes.
 * Returns "content", "meta_confusion", or "explicit_end".
 *
 * If a meta/confusion/end phrase is present but the utterance also contains
 * >= 4 topic-content words OUTSIDE the matched phrase, returns "content".
 */
export function classifyStudentIntent(response: string): StudentIntent {
  const trimmed = response.trim();
  if (!trimmed) return "content";

  const lower = trimmed.toLowerCase();

  // Explicit end — checked first because it's actionable
  for (const pattern of SERVER_END_INTENT_PATTERNS) {
    if (pattern.test(lower)) {
      if (countTopicWordsOutsideMatch(trimmed, pattern) >= 4) {
        return "content";
      }
      return "explicit_end";
    }
  }

  // Meta-conversation
  for (const pattern of SERVER_META_PATTERNS) {
    if (pattern.test(lower)) {
      if (countTopicWordsOutsideMatch(trimmed, pattern) >= 4) {
        return "content";
      }
      return "meta_confusion";
    }
  }

  // Confusion about the task
  for (const pattern of SERVER_CONFUSION_PATTERNS) {
    if (pattern.test(lower)) {
      if (countTopicWordsOutsideMatch(trimmed, pattern) >= 4) {
        return "content";
      }
      return "meta_confusion";
    }
  }

  return "content";
}

// ============================================
// CONCEPT TYPE CLASSIFICATION
// ============================================

export type ConceptType = "observable" | "abstract" | "procedural" | "opinion_repair";

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

  // Procedural: step-by-step math operations and algorithms.
  // Checked before abstract — subtraction/addition are procedural, not abstract.
  const proceduralPatterns = [
    /\bsubtract/i, /\baddition\b/i, /\badd(?:ing)?\s+\d/i,
    /\bsum\b/i, /\bdifference\b/i,
    /\bhow\s+would\s+you\b/i, /\bexplain\s+(?:your|the)\s+(?:thinking|steps)/i,
    /\bstep\s+by\s+step\b/i, /\bshow\s+(?:your|the)\s+work\b/i,
  ];
  if (proceduralPatterns.some((p) => p.test(combined))) {
    return "procedural";
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
 * Detect procedural language in coach output that's inappropriate for non-procedural questions.
 * Catches templates like "first step / what did you get" and "walk me through each step".
 * Broader than containsStepsQuestion — also catches implicit procedural framing.
 */
export function containsProceduralLanguage(text: string): boolean {
  return containsStepsQuestion(text) ||
    /\bfirst\s+step\b/i.test(text) ||
    /\bwhat\s+did\s+you\s+get\b/i.test(text) ||
    /\bwalk\s+(?:me|us)\s+through\s+each\s+step\b/i.test(text) ||
    /\bwhat\s+(?:number|answer)\s+did\s+you\s+(?:get|find)\b/i.test(text) ||
    /\bshow\s+(?:me\s+)?your\s+work\b/i.test(text);
}

/**
 * Check if the original PROMPT is explicitly procedural (asks for steps itself).
 */
export function isProceduralPrompt(questionText: string): boolean {
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

  // Priority 2: Examples/materials questions — rubric-aligned probes
  const qLower = questionText.toLowerCase();
  if (/\bexamples?\b|\bdifferent\b|\bmaterials?\b|\bmade\s+of\b/i.test(qLower)) {
    const namedPlanet = /\b(mercury|venus|earth|mars|jupiter|saturn|uranus|neptune)\b/i.test(studentAnswer.toLowerCase());
    if (!namedPlanet) {
      return "Which two planets will you use as examples, and what is each made of?";
    }
    return "For each planet you named, what is it made of?";
  }

  // Priority 3: Use concept-type probes (no "steps" for non-procedural)
  let conceptType = classifyConceptType(questionText, studentAnswer);
  // HARD BAN: never produce procedural probes for non-procedural prompts.
  // classifyConceptType may return "procedural" for broad patterns like
  // "how would you" even on science questions — override to "observable".
  if (conceptType === "procedural" && !isProceduralPrompt(questionText)) {
    conceptType = "observable";
  }
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
      const answerLower = studentAnswer.toLowerCase();
      const hasExample = /for example|like|such as|one time|instance/i.test(answerLower);
      const hasDescription = /looks? like|see|notice|watch/i.test(answerLower);

      // Ask for an example if student hasn't given one
      if (!hasExample) {
        return "Can you give me an example of that?";
      }
      // Ask for sensory detail if student hasn't described what it looks like
      if (!hasDescription) {
        return "What would you notice if you were watching it happen?";
      }
      // Ask about materials/tools when the question involves building or doing
      if (/build|make|create|experiment|test|try/i.test(questionText)) {
        return "What materials or tools would you need for that?";
      }
      return "Can you describe what that would look like?";
    }

    case "procedural": {
      const answerLower = studentAnswer.toLowerCase();
      // Evidence-based probe selection based on what's missing:
      const hasSteps = /first|then|next|after|start|step/i.test(answerLower);
      const hasReasoning = /because|since|so that|reason|why/i.test(answerLower);
      const hasNumbers = /\d/.test(answerLower);

      // Most complete → ask to verify
      if (hasNumbers && hasSteps) {
        return "Can you check your answer by working it backwards?";
      }
      // Has numbers but no steps → ask for step-by-step
      if (hasNumbers && !hasSteps) {
        return "Can you walk me through each step? What did you do first, and what number did you get?";
      }
      // Has steps but no reasoning → ask why
      if (hasSteps && !hasReasoning) {
        return "Why did you choose to do it in that order?";
      }
      return "What was your first step, and what did you get?";
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

  // Ultimate fallback — use "observable" since scope context is unknown
  return scope.scopeAlignedProbes[0] || buildConceptProbe(
    "observable", "", studentAnswer
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

  // 2. Procedural language ban on non-procedural prompts
  //    Catches "steps", "first step", "what did you get", "walk me through each step", etc.
  if (containsProceduralLanguage(result) && !isProceduralPrompt(questionText)) {
    if (DEBUG_GUARDRAILS) {
      console.log(`[guardrail] banned procedural language in ${fieldName} — rewriting`);
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
// DECISION ENGINE INVARIANTS
// ============================================

/**
 * Deterministic post-LLM guard that enforces decision-engine invariants.
 * Runs AFTER the LLM generates feedback but BEFORE enforceQuestionContinueInvariant.
 *
 * Invariants:
 * 1.  No premature completion when criteria not met
 * 1.5 Praise-only with shouldContinue=true must get a probe
 * 2.  Meta/confusion repair (force continue + rephrase)
 * 3.  Explicit end labeling (only from explicit_end intent)
 * 4.  Every probe must end with ?
 * 5.  No procedural language for non-procedural prompts
 * 6.  Wrong-answer guard (clearly wrong content + low score)
 */
// Praise-only pattern: response is just a short praise phrase with no actionable content
const PRAISE_ONLY_PATTERN = /^(good\s+thinking|great\s+job|nice\s+work|well\s+done|awesome|excellent|good\s+answer|great\s+thinking|that'?s\s+right|that'?s\s+correct|you\s+got\s+it|perfect|wonderful|fantastic)[.!]?\s*$/i;

export function isPraiseOnly(text: string): boolean {
  return PRAISE_ONLY_PATTERN.test(text.trim());
}

/**
 * Build a direct response to a student's meta/confusion question.
 * Instead of generic "No worries! Here's the question again:", answers
 * the student's actual concern based on their performance.
 */
export function buildMetaConfusionResponse(params: {
  studentResponse: string;
  score: number;
  criteriaStatus?: string;
  questionText: string;
  mathProblem?: MathProblem;
  mathValidation?: MathValidationResult;
  answerScope?: AnswerScope;
  scopeExpression?: string;
}): { response: string; shouldContinue: boolean } {
  const { studentResponse, score, criteriaStatus, questionText, mathProblem, mathValidation, answerScope, scopeExpression } = params;
  const lower = studentResponse.toLowerCase();

  // Correctness inquiry: "did I get it right?", "was I correct?", "is that right?"
  const isCorrectnessInquiry = /\bdid\s+i\b|\bwas\s+i\b|\bam\s+i\b|\bis\s+(?:that|it|my\s+answer)\s*(?:right|correct|wrong)\b|\bdid\s+i.*(?:get|answer)/i.test(lower);

  if (isCorrectnessInquiry) {
    if (mathProblem && mathValidation) {
      if (mathValidation.status === "correct") {
        const shouldWrap = criteriaStatus === "strong";
        if (shouldWrap) {
          return {
            response: `Yes, ${mathValidation.extractedAnswer} is correct! ${buildPerformanceAwareClose("strong")}`,
            shouldContinue: false,
          };
        }
        return {
          response: `Yes, ${mathValidation.extractedAnswer} is correct! Can you explain how you got that answer?`,
          shouldContinue: true,
        };
      }
      // Incorrect math answer — use step-scoped expression when answering a sub-step
      const expr = (answerScope && answerScope !== "WHOLE_PROBLEM" && scopeExpression)
        ? scopeExpression
        : mathProblem.expression;
      return {
        response: `Not quite — ${expr} isn't ${mathValidation.extractedAnswer ?? "what you said"}. Can you try again?`,
        shouldContinue: true,
      };
    }
    // Non-math: use score
    if (score >= CORRECT_THRESHOLD) {
      return {
        response: "Yes, you're on the right track! Can you tell me a bit more about how you got your answer?",
        shouldContinue: criteriaStatus !== "strong",
      };
    }
    return {
      response: `Not quite yet. Let me re-ask: ${questionText.length <= 100 ? questionText : questionText.slice(0, 100) + "...?"}`,
      shouldContinue: true,
    };
  }

  // Task confusion: "what am I supposed to do?", "what's the question?"
  const isTaskConfusion = /\bwhat\s+(?:am\s+i|do\s+i|should\s+i)\b|\bwhat'?s\s+the\s+question\b|\bi\s+don'?t\s+understand/i.test(lower);
  if (isTaskConfusion) {
    const shortQ = questionText.length <= 100
      ? questionText
      : questionText.slice(0, 100) + "...?";
    return {
      response: `No problem! Here's the question: ${shortQ}`,
      shouldContinue: true,
    };
  }

  // Generic meta: brief acknowledgment + retry
  const shortQ = questionText.length <= 100
    ? questionText
    : questionText.slice(0, 100) + "...?";
  return {
    response: `That's okay! Let's try this: ${shortQ}`,
    shouldContinue: true,
  };
}

export function enforceDecisionEngineInvariants(params: {
  response: string;
  shouldContinue: boolean;
  criteriaMet: boolean;
  studentIntent: StudentIntent;
  timeRemainingSec?: number;
  questionText: string;
  studentResponse: string;
  isFinalQuestion: boolean;
  resolvedScope?: PromptScope | null;
  missingCriteria?: string[];
  score?: number;
  criteriaStatus?: string;
  mathProblem?: MathProblem;
  mathValidation?: MathValidationResult;
  answerScope?: AnswerScope;
  scopeExpression?: string;
}): { response: string; shouldContinue: boolean; wrapReason: string | null } {
  let { response, shouldContinue } = params;
  const { criteriaMet, studentIntent, timeRemainingSec, questionText, studentResponse, isFinalQuestion, resolvedScope, missingCriteria, score, criteriaStatus, mathProblem, mathValidation, answerScope, scopeExpression } = params;
  let wrapReason: string | null = null;

  // INVARIANT 1: No premature completion when criteria not met
  if (!criteriaMet && containsCompletionLanguage(response)) {
    if (DEBUG_GUARDRAILS) {
      console.log("[decision-engine] INVARIANT_1: completion language with criteriaMet=false — stripping");
    }
    if (shouldContinue) {
      response = buildProbeFromQuestion(questionText, studentResponse, resolvedScope);
    } else {
      // Performance-aware close: match closing language to evaluated status
      const closeStatus = criteriaStatus === "developing" ? "developing"
        : criteriaStatus === "needs_support" ? "needs_support"
        : "needs_support";
      response = buildPerformanceAwareClose(closeStatus);
    }
  }

  // INVARIANT 1.5: Praise-only responses are invalid when shouldContinue=true.
  // A coach turn like "Good thinking." with no question leaves the student in dead air.
  // Replace with a targeted probe using the first missing criterion, or a deterministic fallback.
  if (shouldContinue && isPraiseOnly(response)) {
    if (DEBUG_GUARDRAILS) {
      console.log(`[decision-engine] INVARIANT_1.5: praise-only response with shouldContinue=true — replacing with probe`);
    }
    if (missingCriteria && missingCriteria.length > 0) {
      const firstMissing = missingCriteria[0];
      response = `Good start! Can you tell me more about ${firstMissing.toLowerCase()}?`;
    } else {
      response = ensureProbeHasQuestion(response, questionText, studentResponse, resolvedScope);
    }
  }

  // INVARIANT 2: Meta/confusion repair — answer the student's concern directly
  if (studentIntent === "meta_confusion" && (timeRemainingSec === undefined || timeRemainingSec >= 25)) {
    if (DEBUG_GUARDRAILS) {
      console.log("[decision-engine] INVARIANT_2: meta/confusion detected — building direct response");
    }
    if (mathProblem || mathValidation) {
      // Math-aware: use direct response based on validation results
      const metaResult = buildMetaConfusionResponse({
        studentResponse,
        score: score ?? 0,
        criteriaStatus,
        questionText,
        mathProblem,
        mathValidation,
        answerScope,
        scopeExpression,
      });
      response = metaResult.response;
      shouldContinue = metaResult.shouldContinue;
      wrapReason = shouldContinue ? null : "server_wrap";
    } else {
      // Non-math: gentle re-ask with original question
      response = `No worries! Here's the question again: ${questionText}`;
      shouldContinue = true;
      wrapReason = null;
    }
    return { response, shouldContinue, wrapReason };
  }

  // INVARIANT 6: Wrong-answer guard — clearly wrong content + low score
  // When a student gives a clearly nonsense answer (score < 25) and the LLM
  // still responds with vague praise, replace with a deterministic 3-sentence
  // correction that redirects toward valid answer space.
  if (
    score !== undefined &&
    score < 25 &&
    shouldContinue &&
    studentIntent === "content"
  ) {
    const isClearlyWrong = detectClearlyWrongAnswer(studentResponse);
    const hasBannedPraise = containsWrongAnswerPraise(response);
    const alreadyCorrected = hasExplicitCorrection(response);

    if (isClearlyWrong || (hasBannedPraise && !alreadyCorrected)) {
      if (DEBUG_GUARDRAILS) {
        console.log(
          `[decision-engine] INVARIANT_6: wrong-answer guard — ` +
          `clearlyWrong=${isClearlyWrong}, bannedPraise=${hasBannedPraise}, ` +
          `alreadyCorrected=${alreadyCorrected} — replacing response`
        );
      }
      response = buildWrongAnswerResponse(
        questionText,
        studentResponse,
        resolvedScope || null,
      );
    }
  }

  // INVARIANT 3: Explicit end labeling
  if (!shouldContinue) {
    if (studentIntent === "explicit_end") {
      wrapReason = "explicit_end";
    } else {
      wrapReason = "server_wrap";
    }
  }

  // INVARIANT 4: Every probe must end with a clear question.
  // If shouldContinue=true but no question mark, append a deterministic probe.
  if (shouldContinue && !response.includes("?")) {
    if (DEBUG_GUARDRAILS) {
      console.log("[decision-engine] INVARIANT_4: shouldContinue=true but no question — appending probe");
    }
    response = ensureProbeHasQuestion(response, questionText, studentResponse, resolvedScope);
  }

  // INVARIANT 5: No procedural language for non-procedural prompts.
  // Belt-and-suspenders: catches procedural templates injected by any prior
  // invariant (e.g., Invariant 1 or 4 calling buildProbeFromQuestion).
  if (containsProceduralLanguage(response) && !isProceduralPrompt(questionText)) {
    if (DEBUG_GUARDRAILS) {
      console.log("[decision-engine] INVARIANT_5: procedural language in non-procedural prompt — replacing");
    }
    // Preserve any short ack sentence before the procedural question
    const sentences = response.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
    const ack = sentences.find(s => !containsProceduralLanguage(s) && !s.includes("?"))?.trim();
    const safeProbe = buildSafeProbe(questionText, studentResponse, resolvedScope);
    response = ack && ack.length <= 80 ? `${ack} ${safeProbe}` : safeProbe;
  }

  return { response, shouldContinue, wrapReason };
}

// ============================================
// PROBE QUESTION ENFORCEMENT
// ============================================

/**
 * Ensure that a probe response contains a question mark.
 * If the text has no question, replaces it with a deterministic probe
 * that preserves any leading acknowledgment sentence.
 *
 * Used to guarantee every PROBE ends with a clear next-action question.
 */
export function ensureProbeHasQuestion(
  text: string,
  questionText: string,
  studentAnswer: string,
  scope?: PromptScope | null,
): string {
  if (text.includes("?")) return text;

  // Extract the first non-empty sentence as an acknowledgment prefix
  const sentences = text.split(/(?<=[.!])\s+/).filter(s => s.trim().length > 0);
  const ack = sentences.length > 0 ? sentences[0].trim() : "";
  const probe = buildProbeFromQuestion(questionText, studentAnswer, scope);

  // Combine: keep the ack if it's short and useful, then append the probe
  if (ack.length > 0 && ack.length <= 80) {
    return `${ack} ${probe}`;
  }
  return probe;
}

// ============================================
// SESSION SUMMARY VALIDATION (deterministic)
// ============================================

const META_UTTERANCE_PATTERN = /^(that'?s\s+not\s+what|i'?m\s+confused|what\s+do\s+you\s+mean|i\s+don'?t\s+understand|what\s+are\s+we\s+doing|huh\??|can\s+you\s+repeat|say\s+that\s+again)/i;

/**
 * Common meta prefixes that may precede actual content in a mixed utterance.
 * Example: "I didn't say anything, I just said earth is made of rock"
 *        → strip prefix → "earth is made of rock"
 */
const META_PREFIX_PATTERNS: RegExp[] = [
  /^i\s+didn'?t\s+say\s+(?:anything|that)[,.\s—–-]*/i,
  /^(?:i\s+just\s+said|what\s+i\s+said\s+was|what\s+i\s+meant\s+was)[,.\s—–-]*/i,
  /^that'?s\s+not\s+what\s+(?:i\s+said|i\s+meant|we'?re\s+supposed\s+to)[,.\s—–-]*/i,
  /^no\s*[,!.]\s*/i,
  /^(?:i\s+mean|i\s+meant)[,.\s—–-]*/i,
  /^i'?m\s+confused\s*[,.\s—–-]*(?:but\s+)?/i,
  /^(?:what\s+do\s+you\s+mean|what\s+are\s+you\s+(?:saying|asking))\s*[,.\s?—–-]*(?:but\s+|anyway\s+|so\s+)?/i,
  /^(?:i\s+don'?t\s+(?:understand|get)\s+(?:the\s+)?question)\s*[,.\s—–-]*(?:but\s+)?/i,
  /^huh\s*[?.!,\s]*(?:but\s+|anyway\s+|well\s+|so\s+)?/i,
  /^(?:can\s+you\s+repeat|say\s+that\s+again)\s*[,.\s?—–-]*(?:but\s+)?/i,
];

/** Domain nouns that indicate substantive content after a meta prefix. */
const DOMAIN_CONTENT_PATTERN = /\b(?:earth|mars|jupiter|saturn|venus|mercury|uranus|neptune|planet|rock|gas|ice|metal|hydrogen|helium|frozen|stone|solid|iron|silicon|water|sun|moon|star|gravity|energy|light|heat|plant|animal|number|add|subtract|multiply|divide)\b/i;

/**
 * Strip meta-conversation prefixes from a student utterance and return
 * the content portion if it contains substantive domain content.
 * Returns null if the utterance is purely meta with no extractable content.
 */
export function stripMetaPrefix(utterance: string): string | null {
  const trimmed = utterance.trim();

  for (const pattern of META_PREFIX_PATTERNS) {
    const match = pattern.exec(trimmed);
    if (match) {
      const remainder = trimmed.slice(match[0].length).trim();
      if (remainder.length > 0 && (
        DOMAIN_CONTENT_PATTERN.test(remainder) ||
        remainder.split(/\s+/).filter(w => w.length > 2).length >= 4
      )) {
        return remainder;
      }
    }
  }

  return null;
}

/**
 * Filter student utterances into content vs meta/confusion.
 * Meta utterances should not count as rubric evidence.
 *
 * For mixed utterances (meta prefix + content), extracts and keeps
 * the content portion. Example:
 *   "I'm confused but earth is made of rock" → keeps "earth is made of rock"
 */
export function filterMetaUtterances(utterances: string[]): {
  content: string[];
  metaCount: number;
} {
  const content: string[] = [];
  let metaCount = 0;

  for (const u of utterances) {
    const trimmed = u.trim();
    if (META_UTTERANCE_PATTERN.test(trimmed)) {
      // Meta-matching utterance — try to extract embedded content
      const extracted = stripMetaPrefix(trimmed);
      if (extracted) {
        content.push(extracted);
      } else {
        metaCount++;
      }
    } else {
      content.push(trimmed);
    }
  }

  return { content, metaCount };
}

const SUMMARY_PLANET_LIST = ["mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune"];
const SUMMARY_MATERIAL_TYPES = [
  { label: "rocky", pattern: /\b(?:rock(?:y|s)?|stone|solid|iron|metal|silicon)\b/i },
  { label: "gas", pattern: /\b(?:gas(?:eous|es)?|hydrogen|helium)\b/i },
  { label: "ice", pattern: /\b(?:ice|icy|frozen|methane|ammonia)\b/i },
];

/**
 * Extract deterministic evidence from student speech for rubric validation.
 * Returns concrete counts of planet names and material types.
 */
export function extractDeterministicEvidence(utterances: string[]): {
  namedPlanets: string[];
  namedMaterials: string[];
} {
  const allText = utterances.join(" ").toLowerCase();
  const namedPlanets = SUMMARY_PLANET_LIST.filter(p => new RegExp(`\\b${p}\\b`, "i").test(allText));
  const namedMaterials = SUMMARY_MATERIAL_TYPES.filter(m => m.pattern.test(allText)).map(m => m.label);
  return { namedPlanets, namedMaterials };
}

// ============================================
// PLANET-MATERIAL CORRECTNESS TRACKING
// ============================================

/** Acceptable material types for each planet (used for correctness validation). */
const ACCEPTABLE_PLANET_MATERIALS: Record<string, string[]> = {
  mercury: ["rock", "metal"],
  venus: ["rock"],
  earth: ["rock", "metal"],
  mars: ["rock"],
  jupiter: ["gas"],
  saturn: ["gas"],
  uranus: ["ice", "gas"],
  neptune: ["ice", "gas"],
};

/**
 * Extract incorrect material claims from student utterances.
 * Finds patterns like "planet is/are made of [word]" where the word is either
 * not a known material or is the wrong material type for that planet.
 */
export function extractIncorrectClaims(
  utterances: string[]
): Array<{ planet: string; claimed: string }> {
  const results: Array<{ planet: string; claimed: string }> = [];
  const seenPlanets = new Set<string>();
  const allText = utterances.join(" ");

  const claimRegex = new RegExp(
    `\\b(${SUMMARY_PLANET_LIST.join("|")})\\b[^.?!]{0,30}?\\bmade\\s+of\\s+(\\w+)`,
    "ig"
  );

  let match;
  while ((match = claimRegex.exec(allText)) !== null) {
    const planet = match[1].toLowerCase();
    const claimedWord = match[2].toLowerCase();
    if (seenPlanets.has(planet)) continue;
    seenPlanets.add(planet);

    // Check if this is a known valid material
    const isKnownMaterial = SUMMARY_MATERIAL_TYPES.some(m => m.pattern.test(claimedWord));
    if (isKnownMaterial) {
      // Known material — check if correct for this planet
      const acceptable = ACCEPTABLE_PLANET_MATERIALS[planet];
      const normalized = normalizeMaterial(claimedWord);
      if (acceptable && !acceptable.includes(normalized)) {
        results.push({ planet: capitalizePlanet(planet), claimed: claimedWord });
      }
    } else {
      // Completely invalid material (e.g. "lollipops")
      results.push({ planet: capitalizePlanet(planet), claimed: claimedWord });
    }
  }

  return results;
}

const PLANET_CLAIM_PATTERN = /\b(?:examples?\s+of\s+(?:at\s+least\s+)?(?:two|2|three|3|multiple|several|different)\s+planets?|(?:two|2|three|3|multiple|several)\s+(?:different\s+)?planets?)\b/i;
const MATERIAL_CLAIM_PATTERN = /\b(?:made\s+of|composed\s+of|materials?|what\s+(?:they|each|planets?)\s+(?:are|is)\s+made)\b/i;

/**
 * Validate summary bullets against deterministic evidence.
 * Replaces bullets that make rubric claims unsupported by transcript evidence.
 */
export function validateRubricClaims(
  bullets: string[],
  evidence: { namedPlanets: string[]; namedMaterials: string[] }
): string[] {
  return bullets.map(bullet => {
    // Check for planet-count claims that exceed actual evidence
    if (PLANET_CLAIM_PATTERN.test(bullet) && evidence.namedPlanets.length < 2) {
      if (evidence.namedPlanets.length === 1) {
        return `The student mentioned ${evidence.namedPlanets[0]} but did not provide a second planet example.`;
      }
      return `The student did not name specific planets in their response.`;
    }
    // Check for materials claims when no materials were mentioned
    if (MATERIAL_CLAIM_PATTERN.test(bullet) && /\b(?:describ|explain|identif)/i.test(bullet) && evidence.namedMaterials.length === 0) {
      return `The student did not describe what the planets are made of.`;
    }
    return bullet;
  });
}

/**
 * Build a deterministic overall sentence from criteriaEvaluation data.
 * Returns null if no criteriaEvaluation is available (let LLM output stand).
 */
export function buildDeterministicOverall(
  criteriaEvaluation: { overallStatus?: string; missingCriteria?: string[] } | undefined,
  hasSuccessCriteria: boolean
): string | null {
  if (!criteriaEvaluation?.overallStatus) return null;

  const status = criteriaEvaluation.overallStatus;
  const missing = criteriaEvaluation.missingCriteria || [];

  if (status === "strong") {
    return hasSuccessCriteria
      ? "The student met the rubric criteria for this question."
      : "The student demonstrated understanding of the topic.";
  }
  if (status === "partial") {
    const missingNote = missing.length > 0 ? ` Missing: ${missing.join("; ")}.` : "";
    return `The student partially addressed the rubric criteria.${missingNote}`;
  }
  if (status === "weak" || status === "off_topic") {
    const missingNote = missing.length > 0 ? ` Not addressed: ${missing.join("; ")}.` : "";
    return `The student's response did not meet the rubric criteria.${missingNote}`;
  }
  return null;
}

// ============================================
// DETERMINISTIC SUMMARY BUILDER
// ============================================

/**
 * Normalize a raw material word to a standard label.
 * "rocky"/"rocks"/"stone"/"solid"/"iron"/"silicon" → "rock"
 * "gas"/"gaseous"/"gases"/"hydrogen"/"helium" → "gas"
 * "ice"/"icy"/"frozen"/"methane"/"ammonia" → "ice"
 * "metal" → "metal"
 */
export function normalizeMaterial(raw: string): string {
  const lower = raw.toLowerCase();
  if (/^rock|^stone|^solid|^silicon/i.test(lower)) return "rock";
  if (/^iron/i.test(lower)) return "metal";
  if (/^metal/i.test(lower)) return "metal";
  if (/^gas|^hydrogen|^helium/i.test(lower)) return "gas";
  if (/^ic[ey]|^frozen|^methane|^ammonia/i.test(lower)) return "ice";
  return lower;
}

/** Capitalize a planet name: "earth" → "Earth". */
function capitalizePlanet(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}

// Proximity regex: "planet ... made of ... material" within the same clause.
// Allows up to 40 chars between planet and "made of", and up to 20 chars
// between "made of" and the material word.
const PLANET_RE = "(mercury|venus|earth|mars|jupiter|saturn|uranus|neptune)";
const MATERIAL_RE = "(rock|rocky|rocks|gas|gaseous|gases|ice|icy|metal|iron|stone|solid|hydrogen|helium|frozen)";
/**
 * Extract planet-material associations from student utterances.
 *
 * Two-pass approach:
 *   1. Proximity-based: find explicit "planet … made of … material" patterns.
 *   2. Segment fallback: split at "and" / "," and match planet + nearest material.
 *
 * Materials are normalized to standard labels (rock, gas, ice, metal).
 * Deduplicated by planet name. Returns at most 3 pairs.
 */
export function extractPlanetMaterialPairs(
  utterances: string[]
): Array<{ planet: string; material: string }> {
  const pairs: Array<{ planet: string; material: string }> = [];
  const seenPlanets = new Set<string>();

  const allText = utterances.join(" ");

  // Pass 1: proximity-based "made of" pairs (non-greedy to match closest pair)
  const pairRegex = new RegExp(
    `\\b${PLANET_RE}\\b[^.?!]{0,40}?\\bmade of\\b[^.?!]{0,20}?\\b${MATERIAL_RE}\\b`,
    "ig"
  );
  let match: RegExpExecArray | null;
  while ((match = pairRegex.exec(allText)) !== null) {
    const planet = match[1].toLowerCase();
    const rawMat = match[2];
    if (seenPlanets.has(planet)) continue;
    seenPlanets.add(planet);
    pairs.push({
      planet: capitalizePlanet(planet),
      material: normalizeMaterial(rawMat),
    });
  }

  // Pass 2: segment fallback for planets not yet paired
  for (const utt of utterances) {
    const lower = utt.toLowerCase();
    const segments = lower.split(/\band\b|,/).map(s => s.trim());

    for (const seg of segments) {
      for (const planet of SUMMARY_PLANET_LIST) {
        if (seenPlanets.has(planet)) continue;
        if (!new RegExp(`\\b${planet}\\b`, "i").test(seg)) continue;

        seenPlanets.add(planet);
        let material = "";
        for (const mat of SUMMARY_MATERIAL_TYPES) {
          const rawMatch = seg.match(mat.pattern);
          if (rawMatch) {
            material = normalizeMaterial(rawMatch[0]);
            break;
          }
        }
        pairs.push({
          planet: capitalizePlanet(planet),
          material,
        });
      }
    }
  }

  return pairs.slice(0, 3);
}

/**
 * Detect whether the student described different planet types.
 * Returns true if utterances mention both a rocky-type keyword AND
 * a gas/ice-type keyword — indicating the student understands there
 * are distinct categories of planets.
 */
export function detectTypeStatement(utterances: string[]): boolean {
  const allText = utterances.join(" ").toLowerCase();
  const hasRocky = /\b(?:rock(?:y|s)?|stone|solid|iron|metal)\b/i.test(allText);
  const hasGasOrIce = /\b(?:gas(?:eous|es)?|ice|icy|frozen)\b/i.test(allText);
  return hasRocky && hasGasOrIce;
}

export interface DeterministicSummaryResult {
  bullets: string[];
  overall: string;
}

/**
 * Build a fully deterministic, rubric-aware session summary.
 * No LLM call — every claim is grounded in extracted evidence.
 *
 * Call this when criteriaEvaluation.overallStatus is available.
 */
export function buildDeterministicSummary(params: {
  evidenceUtterances: string[];
  substantiveCount: number;
  metaTurnCount: number;
  questionText: string;
  criteriaEvaluation: { overallStatus?: string; missingCriteria?: string[] };
  successCriteria?: string[];
}): DeterministicSummaryResult {
  const {
    evidenceUtterances, substantiveCount, metaTurnCount,
    criteriaEvaluation, questionText,
  } = params;
  const status = criteriaEvaluation.overallStatus;
  const missing = criteriaEvaluation.missingCriteria || [];

  const evidence = extractDeterministicEvidence(evidenceUtterances);
  const pairs = extractPlanetMaterialPairs(evidenceUtterances);
  const describedDifferentTypes = detectTypeStatement(evidenceUtterances);
  const incorrectClaims = extractIncorrectClaims(evidenceUtterances);

  const bullets: string[] = [];
  let overall: string;

  // Helper: format a planet-material pair as "Planet—material"
  const fmtDash = (p: { planet: string; material: string }) =>
    p.material ? `${p.planet}\u2014${p.material}` : p.planet;

  // Check for progression: incorrect claims in early utterances, correct in later
  const hasProgression = incorrectClaims.length > 0 && pairs.some(p => p.material);

  if (status === "strong") {
    // ---- STRONG: met the goal ----
    const pairsWithMat = pairs.filter(p => p.material);
    if (pairsWithMat.length >= 2) {
      overall = "Met the goal: explained what planets are made of and gave named examples with materials.";
    } else if (evidence.namedPlanets.length >= 2) {
      overall = "Met the goal: named planet examples.";
    } else {
      overall = "Met the goal: answered the question.";
    }

    // Evidence bullet: planet examples with materials (up to 3, em-dash format)
    if (pairsWithMat.length >= 2) {
      bullets.push(`Examples given: ${pairsWithMat.slice(0, 3).map(fmtDash).join("; ")}.`);
    } else if (pairs.length >= 2) {
      // Planets named but no materials associated
      bullets.push(`Named planet examples: ${pairs.slice(0, 3).map(p => p.planet).join(", ")}.`);
    } else if (pairs.length === 1) {
      bullets.push(`Named ${fmtDash(pairs[0])} as an example.`);
    }

    // Progression note: initially incorrect then corrected
    if (hasProgression && bullets.length < 4) {
      const wrongNote = incorrectClaims.map(c => `${c.planet} as "${c.claimed}"`).join(", ");
      bullets.push(`Initially gave incorrect examples (${wrongNote}), then self-corrected.`);
    }

    // "Different planet types" bullet when both rocky and gas/ice detected
    if (describedDifferentTypes && bullets.length < 4) {
      const allText = evidenceUtterances.join(" ").toLowerCase();
      const typeLabel = /\b(?:gas(?:eous|es)?)\b/i.test(allText) ? "gas" : "ice";
      bullets.push(`Explained that some planets are rocky while others are ${typeLabel}/${typeLabel === "gas" ? "ice" : "gas"} giants.`);
    }

    // Student quote (first content utterance, truncated)
    if (evidenceUtterances.length > 0 && bullets.length < 4) {
      const quote = evidenceUtterances[0].slice(0, 100);
      const ellipsis = evidenceUtterances[0].length > 100 ? "..." : "";
      bullets.push(`The student said: "${quote}${ellipsis}"`);
    }

    // Turn count when there were multiple exchanges
    if (evidenceUtterances.length > 1 && bullets.length < 4) {
      bullets.push(
        `Gave ${evidenceUtterances.length} content responses during the conversation.`
      );
    }
  } else {
    // ---- PARTIAL / WEAK / OFF_TOPIC ----
    if (status === "partial") {
      overall = missing.length > 0
        ? `Partially met the goal. Missing: ${missing.join("; ")}.`
        : "Partially met the goal.";
    } else {
      overall = missing.length > 0
        ? `Did not meet the goal. Not addressed: ${missing.join("; ")}.`
        : "Did not meet the goal.";
    }

    // Incorrect claims bullet (e.g. "said Earth is made of lollipops")
    if (incorrectClaims.length > 0 && bullets.length < 4) {
      const claimNotes = incorrectClaims.map(c => {
        const correct = ACCEPTABLE_PLANET_MATERIALS[c.planet.toLowerCase()];
        const correctLabel = correct ? correct[0] : "unknown";
        return `said ${c.planet} is made of "${c.claimed}" (actually ${correctLabel})`;
      });
      bullets.push(`Incorrect claims: ${claimNotes.join("; ")}.`);
    }

    // Correct pairs found alongside incorrect ones → progression
    if (hasProgression && bullets.length < 4) {
      const correctPairs = pairs.filter(p => p.material);
      if (correctPairs.length > 0) {
        bullets.push(`Later corrected: ${correctPairs.map(fmtDash).join("; ")}.`);
      }
    }

    // Grounded student quote (only if no incorrect claims already shown)
    if (incorrectClaims.length === 0 && evidenceUtterances.length > 0 && bullets.length < 4) {
      const quote = evidenceUtterances[0].slice(0, 100);
      const ellipsis = evidenceUtterances[0].length > 100 ? "..." : "";
      bullets.push(`What the student said: "${quote}${ellipsis}"`);
    }

    // Still-needed bullet from missing criteria
    if (missing.length > 0 && bullets.length < 4) {
      bullets.push(`Still needed: ${missing.join("; ")}.`);
    }

    // Planet evidence if any (don't over-claim)
    if (incorrectClaims.length === 0 && pairs.length === 1 && bullets.length < 4) {
      bullets.push(
        `Named ${fmtDash(pairs[0])} but did not provide a second example.`
      );
    } else if (pairs.length === 0 && evidence.namedPlanets.length === 0 &&
               incorrectClaims.length === 0 && /\bplanet/i.test(questionText) && bullets.length < 4) {
      bullets.push("Did not name specific planets.");
    }
  }

  // Meta-turn context
  if (metaTurnCount > 0 && bullets.length < 4) {
    bullets.push(
      `${metaTurnCount} of the student's ${substantiveCount} responses ` +
      `were meta-comments or expressions of confusion.`
    );
  }

  // Ensure at least 2 bullets
  if (bullets.length < 2) {
    bullets.push(
      `The student provided ${evidenceUtterances.length} content ` +
      `response${evidenceUtterances.length !== 1 ? "s" : ""} during the conversation.`
    );
  }

  return {
    bullets: bullets.slice(0, 4),
    overall,
  };
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
  isFinalQuestion: boolean,
  criteriaStatus?: string,
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
      if (criteriaStatus) {
        // Performance-aware close: match closing language to evaluated status
        const closeStatus = criteriaStatus === "strong" ? "strong"
          : criteriaStatus === "developing" ? "developing"
          : "needs_support";
        cleaned = buildPerformanceAwareClose(closeStatus);
      } else if (isFinalQuestion) {
        cleaned = "Thanks for sharing your thinking on this question.";
      } else {
        cleaned = "Thanks for trying. Let's keep going.";
      }
    }

    // PRAISE-ONLY GUARD: If stripping questions left praise-only text
    // (e.g., "Good thinking.") but the student's answer was wrong/partial,
    // replace with neutral performance-aware close. Praise-only wraps are
    // misleading when the student hasn't demonstrated mastery.
    // Only fires when criteriaStatus is explicitly set (not undefined).
    if (isPraiseOnly(cleaned) && criteriaStatus && criteriaStatus !== "strong") {
      const praiseCloseStatus = criteriaStatus === "developing" ? "developing" : "needs_support";
      if (DEBUG_GUARDRAILS) console.log(`[coach-contract] PRAISE-ONLY-GUARD: "${cleaned}" replaced — criteriaStatus=${criteriaStatus}`);
      cleaned = buildPerformanceAwareClose(praiseCloseStatus);
    }

    if (DEBUG_GUARDRAILS) console.log(
      "[coach-contract] INVARIANT_B: shouldContinue=false, stripping questions |",
      { original: finalResponse.slice(0, 80), cleaned: cleaned.slice(0, 80) }
    );
    finalResponse = cleaned;
  }

  // PRAISE-ONLY GUARD (no-strip path): If shouldContinue=false and the response
  // is praise-only even without question stripping, replace with appropriate close.
  // Only fires when criteriaStatus is explicitly set (not undefined).
  if (!finalContinue && isPraiseOnly(finalResponse) && criteriaStatus && criteriaStatus !== "strong") {
    const praiseCloseStatus = criteriaStatus === "developing" ? "developing" : "needs_support";
    if (DEBUG_GUARDRAILS) console.log(`[coach-contract] PRAISE-ONLY-GUARD (no-strip): "${finalResponse}" replaced — criteriaStatus=${criteriaStatus}`);
    finalResponse = buildPerformanceAwareClose(praiseCloseStatus);
  }

  // INVARIANT A: If questions STILL exist in the response (survived stripping)
  // OR followUpQuestion is non-empty, shouldContinue MUST be true.
  const stillHasQuestion = /\?/.test(finalResponse) || hasFollowUp;
  if (stillHasQuestion && !finalContinue) {
    if (DEBUG_GUARDRAILS) console.log(
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
