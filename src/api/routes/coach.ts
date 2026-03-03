import { Router } from "express";
import OpenAI from "openai";
import { getAllLessons } from "../../loaders/lessonLoader";
import { Prompt, PromptAssessment } from "../../domain/prompt";
import { CoachActionTag } from "../../domain/coachAnalytics";
import {
  resolvePostEvaluation,
  containsEndingLanguage,
  containsCorrectLanguage,
  buildRetryPrompt,
  buildProbeFromQuestion,
  enforceAllGuardrails,
  enforceQuestionContinueInvariant,
  resolvePromptScope,
  generatePromptScope,
  buildSafeProbe,
  CORRECT_THRESHOLD,
} from "../../domain/videoCoachGuardrails";
import type { PromptScope } from "../../domain/prompt";

const router = Router();

// Temporary debug flag - set to true to log answer verification
const DEBUG_ANSWER_VERIFICATION = true;

let openaiClient: OpenAI | null = null;

// ============================================
// ANSWER EXTRACTION AND VERIFICATION
// ============================================

interface VerificationResult {
  extractedAnswer: number | null;
  expectedAnswer: number | null;
  isVerified: boolean; // true if we have high confidence in correctness
  confidence: "high" | "medium" | "low";
  method: "arithmetic" | "pattern" | "none";
}

/**
 * Extract the final numeric answer from a student's response.
 * Handles speech patterns like "um", "five", repeated numbers, etc.
 */
function extractFinalAnswer(studentAnswer: string): number | null {
  // Normalize: lowercase, remove fillers
  let normalized = studentAnswer.toLowerCase();

  // Remove common speech fillers
  const fillers = [
    /\bum+\b/g, /\buh+\b/g, /\blike\b/g, /\byou know\b/g, /\bwell\b/g,
    /\bso\b/g, /\bbasically\b/g, /\bi think\b/g, /\bmaybe\b/g,
  ];
  for (const filler of fillers) {
    normalized = normalized.replace(filler, " ");
  }

  // Word-to-number mapping
  const wordNumbers: Record<string, number> = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
    sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  };

  // Replace word numbers with digits
  for (const [word, num] of Object.entries(wordNumbers)) {
    normalized = normalized.replace(new RegExp(`\\b${word}\\b`, "g"), String(num));
  }

  // Look for explicit answer patterns first (highest priority)
  const answerPatterns = [
    /(?:the answer is|answer is|it'?s|that'?s|equals?|=)\s*(\d+)/i,
    /(\d+)\s*(?:is the answer|is my answer|apples?|left|remaining|total)/i,
    /(?:she|he|they|it)\s*(?:has|have|got)\s*(\d+)/i,
    /(?:there are|there'?s)\s*(\d+)/i,
  ];

  for (const pattern of answerPatterns) {
    const match = normalized.match(pattern);
    if (match) {
      return parseInt(match[1], 10);
    }
  }

  // Extract all numbers from the response
  const numbers = normalized.match(/\d+/g);
  if (!numbers || numbers.length === 0) {
    return null;
  }

  // If only one number mentioned, that's likely the answer
  if (numbers.length === 1) {
    return parseInt(numbers[0], 10);
  }

  // Multiple numbers: prefer the last one (often the conclusion)
  // But filter out numbers that appear in the original problem context
  return parseInt(numbers[numbers.length - 1], 10);
}

/**
 * Parse simple arithmetic word problems to extract operation and operands.
 * Returns null if the question doesn't match known patterns.
 */
function parseArithmeticProblem(question: string): {
  operation: "add" | "subtract" | "multiply" | "divide";
  operands: number[];
  expectedAnswer: number;
} | null {
  const q = question.toLowerCase();

  // Word-to-number mapping
  const wordNumbers: Record<string, number> = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
    sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  };

  // Replace word numbers
  let normalized = q;
  for (const [word, num] of Object.entries(wordNumbers)) {
    normalized = normalized.replace(new RegExp(`\\b${word}\\b`, "g"), String(num));
  }

  // Subtraction patterns: "had X, gave away Y", "had X, ate Y", "had X, lost Y"
  const subtractPatterns = [
    /(?:had|has|have|started with|began with)\s*(\d+).*?(?:gave away|gave|lost|ate|used|spent|removed|took away)\s*(\d+)/i,
    /(\d+).*?(?:minus|subtract|take away|-)\s*(\d+)/i,
    /(?:from|of)\s*(\d+).*?(?:take|remove|subtract)\s*(\d+)/i,
  ];

  for (const pattern of subtractPatterns) {
    const match = normalized.match(pattern);
    if (match) {
      const a = parseInt(match[1], 10);
      const b = parseInt(match[2], 10);
      return {
        operation: "subtract",
        operands: [a, b],
        expectedAnswer: a - b,
      };
    }
  }

  // Addition patterns: "had X, got Y more", "had X and Y"
  const addPatterns = [
    /(?:had|has|have)\s*(\d+).*?(?:got|found|received|added|more|another)\s*(\d+)/i,
    /(\d+).*?(?:plus|add|\+|and)\s*(\d+)/i,
    /(\d+)\s*(?:apples?|books?|toys?|items?).*?(?:and|plus)\s*(\d+)/i,
  ];

  for (const pattern of addPatterns) {
    const match = normalized.match(pattern);
    if (match) {
      const a = parseInt(match[1], 10);
      const b = parseInt(match[2], 10);
      return {
        operation: "add",
        operands: [a, b],
        expectedAnswer: a + b,
      };
    }
  }

  // Multiplication patterns: "X groups of Y", "X times Y"
  const multiplyPatterns = [
    /(\d+)\s*(?:groups? of|sets? of|times|×|x)\s*(\d+)/i,
    /(\d+)\s*(?:rows?|columns?)\s*(?:of|with)\s*(\d+)/i,
  ];

  for (const pattern of multiplyPatterns) {
    const match = normalized.match(pattern);
    if (match) {
      const a = parseInt(match[1], 10);
      const b = parseInt(match[2], 10);
      return {
        operation: "multiply",
        operands: [a, b],
        expectedAnswer: a * b,
      };
    }
  }

  // Division patterns: "X shared among Y", "X divided by Y"
  const dividePatterns = [
    /(\d+)\s*(?:shared among|divided by|split between|÷|\/)\s*(\d+)/i,
    /(\d+).*?(?:shared equally|divided equally).*?(\d+)\s*(?:people|friends|groups?)/i,
  ];

  for (const pattern of dividePatterns) {
    const match = normalized.match(pattern);
    if (match) {
      const a = parseInt(match[1], 10);
      const b = parseInt(match[2], 10);
      if (b !== 0) {
        return {
          operation: "divide",
          operands: [a, b],
          expectedAnswer: Math.floor(a / b),
        };
      }
    }
  }

  return null;
}

/**
 * Verify a student's answer against a question using deterministic arithmetic.
 * Returns verification result with confidence level.
 */
/**
 * Only arithmetic prompts should use the deterministic short-circuit.
 * Non-math prompts (science, ELA, open-ended) always go through the LLM
 * so the coach can probe for deeper understanding via Path B.
 */
function allowDeterministicShortCircuit(promptInput: string): boolean {
  return parseArithmeticProblem(promptInput) !== null;
}

// ============================================
// CONVERSATION REPAIR + MODE SWITCH LAYER
// Runs BEFORE Path A/B/C/D selection
// ============================================

interface CompletenessCheck {
  requiresMultipleItems: boolean;
  requiredCount: number;
  requiresDescriptions: boolean;
  isComplete: boolean;
  itemCount: number;
  describedCount: number;
}

/**
 * Detect if a question requires N items (optionally with descriptions)
 * and whether the student's answer meets that requirement.
 */
function checkAnswerCompleteness(question: string, answer: string): CompletenessCheck | null {
  const q = question.toLowerCase();

  // Detect quantity requirements
  const quantityWords: Record<string, number> = {
    two: 2, three: 3, four: 4, five: 5,
    "2": 2, "3": 3, "4": 4, "5": 5,
  };

  let requiredCount = 0;
  for (const [word, num] of Object.entries(quantityWords)) {
    if (new RegExp(`\\b${word}\\b`).test(q)) {
      requiredCount = num;
      break;
    }
  }
  if (requiredCount === 0) return null;

  // Detect description requirement
  const requiresDescriptions = /describ|explain each|tell about each|what .* like/i.test(q);

  // Count items in answer — split by commas, "and", periods, newlines
  const items = answer
    .split(/[,.\n]|\band\b/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);

  // Count "described" items (4+ words suggests more than a bare label)
  const describedCount = items.filter((item) => item.split(/\s+/).length >= 4).length;

  const isComplete =
    items.length >= requiredCount &&
    (!requiresDescriptions || describedCount >= requiredCount);

  if (DEBUG_ANSWER_VERIFICATION) {
    console.log(
      "[coach-completeness] requiredCount=" + requiredCount +
      " requiresDescriptions=" + requiresDescriptions +
      " itemCount=" + items.length +
      " describedCount=" + describedCount +
      " isComplete=" + isComplete
    );
  }

  return {
    requiresMultipleItems: true,
    requiredCount,
    requiresDescriptions,
    isComplete,
    itemCount: items.length,
    describedCount,
  };
}

type RepairIntent = "dissatisfaction" | "desire_to_continue" | "off_task_engagement" | null;

/**
 * Detect student meta/affect signals that require conversation repair
 * rather than normal Path A/B/C/D processing.
 */
function detectRepairIntent(response: string): RepairIntent {
  // Dissatisfaction / frustration
  const dissatisfactionPatterns = [
    /i don'?t like/i,
    /this is (boring|stupid|dumb|bad|going bad|awful|terrible)/i,
    /i'?m (confused|frustrated|annoyed|bored|upset|mad)/i,
    /this (sucks|stinks)/i,
    /i hate this/i,
    /this is(n'?t| not) (fun|working|helping|going well)/i,
    /can we (stop|quit|do something else)/i,
    /i don'?t (want to|wanna) (do this|answer|keep going)/i,
    /the way this is going/i,
  ];
  for (const p of dissatisfactionPatterns) {
    if (p.test(response)) return "dissatisfaction";
  }

  // Desire to continue on topic
  const continuePatterns = [
    /can('?t| we)? (talk|chat|discuss) more/i,
    /i want to keep (talking|going|chatting)/i,
    /can we (talk|chat|continue|keep going|stay on)/i,
    /i want to (learn|know|hear) more/i,
    /let'?s keep (talking|going|chatting)/i,
    /don'?t (move on|go to the next|stop|change)/i,
    /more about (the |this )?/i,
    /tell me more about/i,
  ];
  for (const p of continuePatterns) {
    if (p.test(response)) return "desire_to_continue";
  }

  // Off-task but still engaged
  const offTaskPatterns = [
    /can we (play|do) (a game|something fun|something else)/i,
    /i'?d rather (do|talk about) something/i,
    /what if (we|instead)/i,
    /this is (funny|silly|weird|random)/i,
  ];
  for (const p of offTaskPatterns) {
    if (p.test(response)) return "off_task_engagement";
  }

  return null;
}

/**
 * Build system prompt context for incomplete answers and repair intents.
 * Injected BEFORE the main coaching instructions.
 */
function buildPreLLMContext(
  completeness: CompletenessCheck | null,
  repairIntent: RepairIntent,
  question: string,
  attemptNumber: number // 1 = first answer, 2+ = follow-up
): string {
  let context = "";

  // Incomplete answer gate
  if (completeness && !completeness.isComplete) {
    const missing = [];
    if (completeness.itemCount < completeness.requiredCount) {
      missing.push(
        `only ${completeness.itemCount} of ${completeness.requiredCount} items provided`
      );
    }
    if (completeness.requiresDescriptions && completeness.describedCount < completeness.requiredCount) {
      missing.push(
        `only ${completeness.describedCount} of ${completeness.requiredCount} items have descriptions`
      );
    }
    context += `
=== INCOMPLETE ANSWER GATE (MANDATORY — overrides Path A) ===

The question requires ${completeness.requiredCount} items${completeness.requiresDescriptions ? " with descriptions" : ""}.
Student's answer: ${missing.join("; ")}.
This answer is INCOMPLETE. You MUST use Path B (shouldContinue=true).
Do NOT use Path A. Do NOT close the turn.
Ask ONE targeted question for the missing item or description.
${attemptNumber >= 2 ? "This is the student's second attempt — you may give one example to help." : "Do NOT give examples yourself yet — let the student try first."}

`;
  }

  // Repair intent
  if (repairIntent) {
    const guidance: Record<string, string> = {
      dissatisfaction: `The student is expressing dissatisfaction or frustration.
Do NOT ignore this. Do NOT respond with "Let's go to the next question."
Acknowledge their feeling briefly (1 sentence), then ask ONE re-engagement question.
Example: "Got it — what would make this feel better: more back-and-forth, or an example to start with?"
Set coachActionTag to "repair".`,
      desire_to_continue: `The student explicitly wants to keep talking about this topic.
Do NOT move on. Do NOT say "Let's go to the next question."
Offer a choice: continue on the current question, or switch to a free chat about the topic.
Example: "We can keep going on this question, or switch to a quick chat about the topic. Which sounds better?"
Set coachActionTag to "mode_switch_offer".
Include "suggestedNext": "chat" in your JSON response.`,
      off_task_engagement: `The student is off-task but still engaged (joking, negotiating, etc.).
Do NOT shut them down. Briefly acknowledge, then gently redirect with a question.
Example: "Fair enough. Let's try one more thing — what does a windy day feel like?"
Set coachActionTag to "repair".`,
    };

    context += `
=== REPAIR INTENT DETECTED (MANDATORY — handle BEFORE Path selection) ===

${guidance[repairIntent]}
shouldContinue MUST be true. followUpQuestion MUST contain a question.

`;
  }

  return context;
}

function verifyAnswer(question: string, studentAnswer: string): VerificationResult {
  const extractedAnswer = extractFinalAnswer(studentAnswer);
  const parsed = parseArithmeticProblem(question);

  if (DEBUG_ANSWER_VERIFICATION) {
    console.log("[coach-verify] extractedFinalAnswer:", extractedAnswer);
    console.log("[coach-verify] expectedAnswer:", parsed?.expectedAnswer ?? "N/A");
    console.log("[coach-verify] parsedOperation:", parsed?.operation ?? "none");
  }

  // If we can't extract an answer, can't verify
  if (extractedAnswer === null) {
    if (DEBUG_ANSWER_VERIFICATION) {
      console.log("[coach-verify] evaluationConfidence: low (no answer extracted)");
    }
    return {
      extractedAnswer: null,
      expectedAnswer: parsed?.expectedAnswer ?? null,
      isVerified: false,
      confidence: "low",
      method: "none",
    };
  }

  // If we parsed the arithmetic problem, use deterministic verification
  if (parsed) {
    const isCorrect = extractedAnswer === parsed.expectedAnswer;
    if (DEBUG_ANSWER_VERIFICATION) {
      console.log("[coach-verify] evaluationConfidence:", isCorrect ? "high (verified match)" : "high (verified mismatch)");
    }
    return {
      extractedAnswer,
      expectedAnswer: parsed.expectedAnswer,
      isVerified: isCorrect,
      confidence: "high",
      method: "arithmetic",
    };
  }

  // No arithmetic parsing possible - use pattern matching only
  if (DEBUG_ANSWER_VERIFICATION) {
    console.log("[coach-verify] evaluationConfidence: medium (no arithmetic verification)");
  }
  return {
    extractedAnswer,
    expectedAnswer: null,
    isVerified: false,
    confidence: "medium",
    method: "pattern",
  };
}

function getClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openaiClient;
}

interface ConversationMessage {
  role: "student" | "coach";
  message: string;
}

interface CoachRequest {
  lessonId: string;
  promptId: string;
  studentAnswer: string;
  gradeLevel?: string;
  conversationHistory?: ConversationMessage[];
}

/** Criteria evaluation result — tracks student progress against assessment rubric. */
interface CriteriaEvaluation {
  metCriteria: string[];            // Success criteria the student has demonstrated
  missingCriteria: string[];        // Success criteria not yet demonstrated
  misconceptionsDetected: string[]; // Specific misconceptions observed in transcript
  overallStatus: "strong" | "developing" | "needs_support";
}

interface CoachResponse {
  feedback: string;
  score: number;
  isCorrect: boolean;
  followUpQuestion?: string;
  encouragement: string;
  shouldContinue: boolean;
  // Criteria-based evaluation (when assessment metadata is available)
  criteriaEvaluation?: CriteriaEvaluation;
  // Analytics tracking
  coachActionTag?: CoachActionTag; // Classification for analytics
  // Stagnation deferral tracking
  deferredByCoach?: boolean; // True when coach moves on due to stagnation
  deferralReason?: "stagnation"; // Reason for deferral
  deferralContext?: {
    turnCount?: number; // Number of turns before deferral
    pattern?: string; // e.g., "repeated-error", "persistent-uncertainty", "no-progress"
  };
  // Mode switch support
  suggestedNext?: "chat" | "assignment"; // Suggests switching to chat mode when student requests it
}

// POST /api/coach/feedback - Get initial feedback and follow-up question
router.post("/feedback", async (req, res) => {
  try {
    const { lessonId, promptId, studentAnswer, gradeLevel = "2nd grade" } = req.body as CoachRequest;

    if (!lessonId || !promptId || !studentAnswer) {
      return res.status(400).json({
        error: "lessonId, promptId, and studentAnswer are required",
      });
    }

    const client = getClient();
    if (!client) {
      return res.json({
        feedback: "Great effort! Keep thinking about this.",
        score: 50,
        isCorrect: true,
        encouragement: "Nice work!",
        shouldContinue: false,
      });
    }

    // Find the lesson and prompt
    const lessons = getAllLessons();
    const lesson = lessons.find((l) => l.id === lessonId);
    if (!lesson) {
      return res.status(404).json({ error: "Lesson not found" });
    }

    const promptIndex = lesson.prompts.findIndex((p) => p.id === promptId);
    if (promptIndex === -1) {
      return res.status(404).json({ error: "Prompt not found" });
    }
    const prompt = lesson.prompts[promptIndex];
    const isFinalQuestion = promptIndex === lesson.prompts.length - 1;

    const response = await generateCoachFeedback(
      client,
      prompt,
      studentAnswer,
      gradeLevel,
      lesson.title,
      isFinalQuestion
    );

    res.json(response);
  } catch (error) {
    console.error("Error generating coach feedback:", error);
    res.status(500).json({ error: "Failed to generate feedback" });
  }
});

// POST /api/coach/continue - Continue the conversation
router.post("/continue", async (req, res) => {
  try {
    const {
      lessonId,
      promptId,
      studentAnswer,
      gradeLevel = "2nd grade",
      conversationHistory = [],
    } = req.body as CoachRequest & { studentResponse: string };

    const { studentResponse } = req.body;

    if (!lessonId || !promptId || !studentResponse) {
      return res.status(400).json({
        error: "lessonId, promptId, and studentResponse are required",
      });
    }

    const client = getClient();
    if (!client) {
      return res.json({
        feedback: "Great thinking!",
        shouldContinue: false,
      });
    }

    // Find the lesson and prompt
    const lessons = getAllLessons();
    const lesson = lessons.find((l) => l.id === lessonId);
    if (!lesson) {
      return res.status(404).json({ error: "Lesson not found" });
    }

    const promptIndex = lesson.prompts.findIndex((p) => p.id === promptId);
    if (promptIndex === -1) {
      return res.status(404).json({ error: "Prompt not found" });
    }
    const prompt = lesson.prompts[promptIndex];
    const isFinalQuestion = promptIndex === lesson.prompts.length - 1;

    const response = await continueConversation(
      client,
      prompt,
      studentAnswer,
      studentResponse,
      conversationHistory,
      gradeLevel,
      isFinalQuestion
    );

    res.json(response);
  } catch (error) {
    console.error("Error continuing conversation:", error);
    res.status(500).json({ error: "Failed to continue conversation" });
  }
});

// ============================================
// ASSESSMENT CONTEXT BUILDER
// Formats assessment metadata into a system prompt block
// so the coach can evaluate against rubric criteria.
// ============================================

function buildAssessmentContext(assessment?: PromptAssessment): string {
  if (!assessment) return "";

  const hasObjective = !!assessment.learningObjective;
  const hasCriteria = assessment.successCriteria && assessment.successCriteria.length > 0;
  const hasMisconceptions = assessment.misconceptions && assessment.misconceptions.length > 0;
  const hasFocus = assessment.evaluationFocus && assessment.evaluationFocus.length > 0;

  if (!hasObjective && !hasCriteria) return "";

  let block = `\n=== ASSESSMENT RUBRIC (MANDATORY) ===\n\n`;

  if (hasObjective) {
    block += `Learning Objective: ${assessment.learningObjective}\n\n`;
  }

  if (hasCriteria) {
    block += `Success Criteria (evaluate the transcript against EACH):\n`;
    assessment.successCriteria!.forEach((c, i) => {
      block += `  ${i + 1}. ${c}\n`;
    });
    block += `\n`;
  }

  if (hasMisconceptions) {
    block += `Known Misconceptions (watch for these specifically):\n`;
    assessment.misconceptions!.forEach((m, i) => {
      block += `  ${i + 1}. ${m}\n`;
    });
    block += `\n`;
  }

  if (hasFocus) {
    block += `Evaluation Focus: ${assessment.evaluationFocus!.join(", ")}\n\n`;
  }

  block += `=== CRITERIA-BASED EVALUATION (MANDATORY when rubric is present) ===

Before generating your response, evaluate the student's transcript against each success criterion above.

1) Determine:
   - metCriteria: which success criteria the student has clearly demonstrated (cite evidence)
   - missingCriteria: which success criteria are NOT yet demonstrated
   - misconceptionsDetected: which known misconceptions (if any) appeared in the transcript
   - overallStatus: "strong" (all criteria met), "developing" (some met), or "needs_support" (none/few met)

2) If ALL success criteria are met (overallStatus = "strong"):
   - Acknowledge specifically: cite what the student said that demonstrates mastery
   - Inform them they have met the goal
   - Offer an OPTIONAL continuation: "We can stop here — or if you'd like, we can explore this more deeply."
   - Do NOT ask a new required question
   - Do NOT introduce unrelated probing questions
   - Set shouldContinue = false (student may choose to continue)

3) If SOME criteria are missing (overallStatus = "developing"):
   - Ask ONE targeted question addressing the highest-priority missing criterion
   - Do not ask generic meta-questions — be specific to the missing criterion
   - Keep the question aligned to the learning objective

4) If student needs support (overallStatus = "needs_support"):
   - Use Mode D (Redirect) or Mode E (Support) as appropriate
   - Target the most foundational missing criterion first

HARD CONSTRAINTS:
- No random probing — every follow-up must target a specific missing criterion
- No regression to simpler questions unless misconceptionsDetected indicates confusion
- No new required questions once all criteria are met
- Offer student agency when mastery is achieved

`;

  return block;
}

/** Build the criteriaEvaluation JSON schema fragment for system prompts. */
function buildCriteriaOutputSchema(assessment?: PromptAssessment): string {
  if (!assessment?.successCriteria?.length) return "";
  return `,
  "criteriaEvaluation": {
    "metCriteria": ["<success criteria demonstrated by student>"],
    "missingCriteria": ["<success criteria NOT yet demonstrated>"],
    "misconceptionsDetected": ["<known misconceptions observed, or empty array>"],
    "overallStatus": "<strong|developing|needs_support>"
  }`;
}

async function generateCoachFeedback(
  client: OpenAI,
  prompt: Prompt,
  studentAnswer: string,
  gradeLevel: string,
  lessonTitle: string,
  isFinalQuestion: boolean = false,
  promptScope?: PromptScope | null
): Promise<CoachResponse> {
  // ============================================
  // ANSWER VERIFICATION (run before LLM call)
  // ============================================
  const verification = verifyAnswer(prompt.input, studentAnswer);

  // ============================================
  // DETERMINISTIC SHORT-CIRCUIT FOR VERIFIED CORRECT (ARITHMETIC ONLY)
  // Only arithmetic prompts bypass the LLM. Non-math prompts always go
  // through the LLM so the coach can probe for deeper understanding.
  // ============================================
  if (verification.confidence === "high" && verification.isVerified && allowDeterministicShortCircuit(prompt.input)) {
    if (DEBUG_ANSWER_VERIFICATION) {
      console.log("[coach-verify] SHORT-CIRCUIT: Returning deterministic Path A response (arithmetic)");
    }

    const feedback = isFinalQuestion
      ? "That's right. You've completed this assignment."
      : "That's right. Let's go to the next question.";

    return {
      feedback,
      score: 90,
      isCorrect: true,
      followUpQuestion: "",
      encouragement: "Good.",
      shouldContinue: false,
      coachActionTag: "affirm_move_on",
    };
  }

  if (verification.confidence === "high" && verification.isVerified && !allowDeterministicShortCircuit(prompt.input)) {
    if (DEBUG_ANSWER_VERIFICATION) {
      console.log("[coach-verify] Non-math verified correct — sending to LLM for Path B probing");
    }
  }

  // Theme-label short-circuit removed — minimal answers now go to LLM for
  // Path B (probe) treatment under the conversational tutoring model.

  // Build verification context for the prompt (only for mismatch cases now)
  let verificationContext = "";
  if (verification.confidence === "high" && !verification.isVerified && verification.expectedAnswer !== null) {
    verificationContext = `
=== ANSWER VERIFICATION (informational) ===

VERIFIED MISMATCH: The student's extracted answer (${verification.extractedAnswer}) does not match the expected answer (${verification.expectedAnswer}).
You may use Path C to guide correction, but be specific about the discrepancy.

`;
  }

  // ============================================
  // CONVERSATION REPAIR + COMPLETENESS LAYER (pre-LLM)
  // ============================================
  const completeness = checkAnswerCompleteness(prompt.input, studentAnswer);
  const repairIntent = detectRepairIntent(studentAnswer);
  const preLLMContext = buildPreLLMContext(completeness, repairIntent, prompt.input, 1);
  const preserveIntent = repairIntent !== null || (completeness !== null && !completeness.isComplete);

  if (DEBUG_ANSWER_VERIFICATION && preserveIntent) {
    console.log("[coach-repair] preserveIntent=true repairIntent=" + repairIntent +
      " completenessOK=" + (completeness?.isComplete ?? "n/a"));
  }

  // ============================================
  // TOPIC SCOPE CONTEXT (for LLM awareness)
  // ============================================
  const resolvedScope = promptScope !== undefined ? promptScope : resolvePromptScope(prompt.input, prompt.scope);
  let scopeContext = "";
  if (resolvedScope) {
    scopeContext = `
=== TOPIC SCOPE (MANDATORY) ===

This question's allowed scope: ${resolvedScope.allowedKeywords.join(", ")}.
OFF-LIMITS topics: ${resolvedScope.offScopeKeywords.join(", ")}.
If the student mentions an off-scope term, acknowledge briefly then redirect to the allowed scope.
Do NOT ask for steps/details of off-scope processes.

`;
  }

  // ============================================
  // ASSESSMENT CONTEXT (criteria-based evaluation)
  // ============================================
  const assessmentContext = buildAssessmentContext(prompt.assessment);

  // ============================================
  // FOUR-PATH TURN DECISION FRAMEWORK
  // ============================================
  const systemPrompt = `You are a learning coach helping a student (${gradeLevel}) think clearly and explain their reasoning.

Lesson: "${lessonTitle}"
Question: "${prompt.input}"
${prompt.hints?.length ? `Hints available: ${prompt.hints.join("; ")}` : ""}
${isFinalQuestion ? `\n*** THIS IS THE FINAL QUESTION IN THE ASSIGNMENT ***\n` : ""}
${verificationContext}${preLLMContext}${scopeContext}${assessmentContext}=== ROLE ===

You are a conversational tutor assessing holistic understanding — not a grader checking correctness.
Your goal: understand what the student knows and deepen it through short, focused dialogue.
${prompt.assessment?.successCriteria?.length ? `When assessment rubric is present, evaluate the transcript against each success criterion BEFORE choosing your response mode.` : ""}

=== FALSE-NEGATIVE PREVENTION ===

Do NOT imply wrongness unless HIGH CONFIDENCE. For numeric answers:
- Extract the final answer ("the answer is X", last number as conclusion)
- If it matches expected, treat as CORRECT regardless of fillers or messy steps
- When uncertain: ask neutral question ("What answer did you get?") — never "try again"

=== MISCONCEPTION DETECTION ===

Check for: operation confusion, reversal errors, counting errors, surface-feature focus, everyday language misuse.
If detected: ask ONE corrective question challenging the faulty mental model. Do NOT explain the answer.
Examples: "Are you adding or taking away?" / "Does the water disappear, or change form?"

=== CONFIDENCE DETECTION ===

IGNORE fillers (um, uh, like, well, so) — these are NOT uncertainty.
Uncertainty signals: hedging ("I think", "maybe"), explicit doubt ("I'm not sure"), validation seeking ("right?", "is it...?"), rapid self-corrections.
Declarative answer + fillers = MEDIUM-TO-HIGH confidence.

Adjust by confidence + correctness:
- HIGH + incorrect → Challenge directly: "You said 14. Are you adding or subtracting?"
- MEDIUM + incorrect → Guide: "What operation does 'take away' mean?"
- LOW + incorrect → Simplify: "What's the first number in the problem?"
- CORRECT + uncertain → Confirm and move on. No probing.
- CORRECT + confident → Mode C (Affirm+Bridge) if detailed, Mode A (Reflect+Probe) if minimal.

=== CLARIFY-AND-CLOSE ===

Only force early close when:
a) Student explicitly says "I don't know" and refuses to attempt → restate key idea, close
b) After 2 student attempts with no improvement → close and move on
c) Clear disengagement or stagnation (identical phrasing, random guessing)

Mild hedging ("I think", "maybe") does NOT trigger close. Allow ONE probe even with mild uncertainty.
Strong uncertainty ("I don't know", "I give up", "I can't") → close immediately, restate key idea.

=== PROBING LIMITS ===

- ONE probe per turn, max 2 turns per question unless productive struggle continues
- Only strong uncertainty forces close after a probe (not mild hedging)
- After TWO student attempts with no improvement, close and move on

=== TRANSITIONS ===

Normal progression: "Let's go to the next question." / "Let's continue."
Stagnation move-on: "We'll move on for now. You can come back to this later." (set deferredByCoach=true)
NEVER say: "That's enough for now."
${isFinalQuestion ? `
This is the FINAL QUESTION. Use completion language only:
- "You've completed this assignment." / "That wraps up this lesson."
- Do NOT say "next question" or "let's move on."
- Optionally invite coaching: "You can explore this topic more in a coaching session."
` : ""}
=== EDGE CASES ===

Handle calmly without labeling:
- Confident + incorrect → Challenge: "Check that idea — are you adding or taking away?"
- Verbose + low substance → Narrow: "Focus on just this part."
- Hesitant + correct → Affirm briefly. If answer is minimal, still probe (Mode A).
- Guessing/random → Ground: "Let's slow down. Think about this specific part."
- Stagnation → Move on: "We'll move on for now. You can come back to this later."
- Partially correct + uncertain → Allow probe if mild hedging. Close only on strong uncertainty.
- Partially correct + confident → "That part makes sense. What about…?"

=== PRODUCTIVE STRUGGLE VS MOVE-ON ===

PRODUCTIVE (continue): Responses evolve, student integrates feedback, reasoning improves.
→ ONE focused follow-up. Narrow scope if needed.

UNPRODUCTIVE (move on): Same idea repeated, stagnation despite prompts, random guessing.
→ "We'll move on for now. You can come back to this later." Set deferredByCoach=true.
→ Do NOT apologize, over-explain, or frame as failure.

=== ANSWER DEPTH (determines Mode C vs Mode A) ===

DETAILED: includes explanation, reasoning, examples, or description.
MINIMAL: bare list, single word/phrase, label without elaboration.

RULE: Correct MINIMAL answers ALWAYS trigger Mode A (Reflect+Probe) — never Mode C.
Mode C (Affirm+Bridge) is ONLY for answers that already include reasoning or description.

=== CONVERSATIONAL TURN FORMAT (choose ONE mode) ===

MODE A — REFLECT + PROBE
When: Student gave an on-topic answer that can be deepened.
  1. Reflect: Paraphrase the student's core IDEA in your own words (1 sentence). Reference the MEANING, not the words.
  2. Probe: ONE targeted follow-up question.
Example: Student says "gravity pulls them" →
  "So there's a force holding the planets in place. What would happen without it?"
BAD: "You said gravity pulls them. Why?" (echoes words)
BAD: "Great job! What else?" (generic praise, no meaning)

IMPORTANT — Match probe to concept type:
- Observable phenomena (weather, animals, objects): "What would you see/hear/feel?" or "What does that look like?"
- Abstract processes (photosynthesis, gravity, evaporation, math reasoning): "What are the steps?" / "What goes in and comes out?" / "How would you know it happened?" — NEVER ask "what does that look/feel like" for invisible processes.
- Opinion/affect: "What makes you feel that way?"

Choose ONE probing dimension per turn:
- Mechanism: "Why does that happen?" / "What are the steps?"
- Evidence: "How would you know?" / "What goes in and comes out?"
- Example: "What's an example of that?"
- Description: "What would you notice?" (observable only)
- Contrast: "How is that different from ___?"
- Vocabulary: "What does that word mean?"
- Transfer: "Would that still work if ___?"
Do NOT repeat the original question or use vague prompts ("tell me more").

MODE B — CLARIFY + PROBE
When: Student response is clipped, garbled, or incomplete but on-topic.
  1. Show you caught the gist (1 sentence).
  2. Ask to restate or complete a sentence stem.
Example: Student says "too hot or too cold" →
  "I heard something about temperature — what would that mean for living things?"
Do NOT use "try a different angle" — that is only for true stagnation (repeated failures with no progress).

MODE C — AFFIRM + BRIDGE
When: Answer is DETAILED (includes explanation or example) AND correct, or transitioning to a new concept.
  1. Briefly affirm (1 sentence, no over-praise).
  2. Bridge to next idea with ONE question, or close if done.
Example: "That makes sense about warmth. What keeps the planets orbiting the sun?"
You MUST NOT imply missing detail and then close without a question.

MODE D — REDIRECT
When: Incorrect but shows effort or partial understanding.
Response varies by confidence:
- HIGH: Challenge directly. "Check that idea — are you adding or taking away?"
- MEDIUM: Guide. "What operation does 'take away' mean?"
- LOW: Simplify. "What's the first number in the problem?"
Do NOT explain the answer. ONE question max.

MODE E — SUPPORT
When: Student is stuck, says "I don't know," or off-topic.
Response: Normalize + ONE concrete starting point.
"That's okay. What's the first piece of information given?"

=== TONE ===

- 1–2 sentences max. ONE question max (none for Mode C close).
- No robotic phrasing ("Correct." alone). No over-praise. No meta-language ("This demonstrates mastery").
- Speak like a thoughtful tutor: direct, warm, concise. Use contractions naturally.
- Vary acknowledgments: "Good start." / "That works." / "Makes sense." / "Got it."

=== SINGLE-QUESTION RULE (HARD CONSTRAINT) ===

Each coach turn must contain EXACTLY ONE question (or zero for Mode C close). NEVER two or more.
- Pick ONE concept to probe. Do NOT combine concepts with "or" or "and".
- Do NOT ask a follow-up question in the same turn as another question.
- BAD: "Can you think of how the sun helps planets stay in orbit or affects temperature on Earth?"
- BAD: "How does the sun's energy help the planets? What role does gravity play?"
- GOOD: "How does the sun affect temperature on Earth?"
- GOOD: "What keeps the planets in their orbits?"
If you want to explore multiple concepts, pick the ONE most relevant to what the student said.

=== ANTI-PARROTING (MANDATORY) ===

NEVER repeat the student's words back to them. Specifically:
- NEVER use "You mentioned...", "You said...", "When you said...", "You told me..."
- NEVER quote or echo more than 3 consecutive words from the student's answer
- Instead: respond directly to the IDEA, not the words. Acknowledge understanding without restating.
BAD: "You mentioned photosynthesis uses sunlight. Can you describe what that looks like?"
GOOD: "Right — what has to happen first for that process to work?"
BAD: "You said the water evaporates because of the sun."
GOOD: "What evidence would you look for to know evaporation happened?"

=== OUTPUT CONSTRAINTS ===

When shouldContinue is FALSE:
- No probing language ("but…", "can you add…", "what about…", "tell me more…")
- followUpQuestion MUST be empty string ""
- Clean close: confirm + transition

When shouldContinue is TRUE:
- followUpQuestion MUST contain ONE clear question
- No transition language ("Let's move on", "next question")

VIOLATION: Minimal list + close without probe is INVALID. Minimal answers MUST trigger Mode A (Reflect+Probe).

Respond in JSON:
{
  "score": <0-100 internal>,
  "isCorrect": <true if score >= 70>,
  "feedback": "<1-2 sentences>",
  "followUpQuestion": "<ONE question for A/B/D/E, empty string for C>",
  "encouragement": "<brief: 'Good start.' / 'That works.' / 'Makes sense.' / 'Got it.'>",
  "shouldContinue": <false for C, true for A/B/D/E>,
  "turnMode": <"reflect_probe"|"clarify_probe"|"affirm_bridge"|"redirect"|"support"|"close">,
  "coachActionTag": <"affirm_move_on"|"probe"|"hint"|"correct_misconception"|"ask_for_explanation"|"reframe_question"|"reduce_complexity"|"encourage"|"move_on_stagnation"|"check_understanding"|"repair"|"mode_switch_offer">,
  "deferredByCoach": <true only if stagnation move-on>,
  "deferralReason": <"stagnation" if deferred>,
  "deferralContext": <{"pattern": "repeated-error"|"persistent-uncertainty"|"no-progress"} if deferred>,
  "suggestedNext": <"chat" if student asks to keep talking about topic, otherwise omit>${buildCriteriaOutputSchema(prompt.assessment)}
}`;

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Student's answer: "${studentAnswer}"` },
      ],
      temperature: 0.2, // Low temperature to reduce constraint violations
      max_tokens: 300,
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response from AI");
    }

    const parsed = JSON.parse(content) as CoachResponse;

    // ============================================
    // POST-PARSE ENFORCEMENT LAYER
    // Ensure hard constraints are never violated
    // ============================================
    return enforceCoachResponseConstraints(parsed, isFinalQuestion, {
      preserveIntent,
      studentAnswer,
      questionText: prompt.input,
      resolvedScope,
    });
  } catch (error) {
    console.error("AI feedback error:", error);
    return {
      feedback: "I see your thinking. Can you walk me through your reasoning?",
      score: 50,
      isCorrect: false,
      followUpQuestion: "What led you to that answer?",
      encouragement: "Okay.",
      shouldContinue: true,
    };
  }
}

/**
 * Post-parse enforcement layer for CoachResponse.
 * Ensures hard constraints are never violated regardless of LLM output.
 */
function enforceCoachResponseConstraints(
  response: CoachResponse,
  isFinalQuestion: boolean,
  options?: { preserveIntent?: boolean; studentAnswer?: string; questionText?: string; resolvedScope?: PromptScope | null }
): CoachResponse {
  const result = { ...response };

  // ============================================
  // UNIFIED GUARDRAILS: echo + steps + scope on EVERY text field
  // ============================================
  if (options?.studentAnswer && options?.questionText) {
    result.feedback = enforceAllGuardrails(
      result.feedback, options.studentAnswer, options.questionText, "feedback", options.resolvedScope
    );
    if (result.followUpQuestion) {
      result.followUpQuestion = enforceAllGuardrails(
        result.followUpQuestion, options.studentAnswer, options.questionText, "followUpQuestion", options.resolvedScope
      );
    }
  }

  // When preserveIntent is true (repair/completeness detected), skip the
  // safe-template rewrites that would clobber repair responses.
  if (options?.preserveIntent) {
    // If the LLM incorrectly closed despite repair/completeness context,
    // force the conversation open so the student can respond.
    if (!result.shouldContinue) {
      if (DEBUG_ANSWER_VERIFICATION) {
        console.log("[coach-enforce] preserveIntent: LLM returned shouldContinue=false, forcing true");
      }
      result.shouldContinue = true;
      // If LLM gave a closing template, replace with a neutral probe
      if (!result.followUpQuestion || result.followUpQuestion.trim() === "") {
        result.followUpQuestion = "Can you tell me more about that?";
      }
    }
    // Only ensure encouragement is present, don't touch feedback/shouldContinue
    if (!result.encouragement || result.encouragement.trim() === "") {
      result.encouragement = "Okay.";
    }
    if (!result.coachActionTag) {
      result.coachActionTag = "probe";
    }
    return result;
  }

  // Probing language patterns that indicate incompleteness
  const probingPatterns = [
    /\bbut\b/i,
    /\bmight\b/i,
    /\balso\b/i,
    /\blet'?s think\b/i,
    /\bcan you\b/i,
    /\bcould you\b/i,
    /\bwhat about\b/i,
    /\btell me more\b/i,
    /\byou could\b/i,
    /\byou might\b/i,
    /\bconsider\b/i,
    /\btry to\b/i,
    /\bthink about\b/i,
    /\bwhat if\b/i,
    /\bhow about\b/i,
    /\bwhat do you think\b/i,
    /\bcan you add\b/i,
    /\bwhat events?\b/i,
    /\bwhat else\b/i,
    /\bwhy do you think\b/i,
    /\bhow do you know\b/i,
  ];

  // Transition language that should not appear with shouldContinue: true
  const transitionPatterns = [
    /let'?s go to the next/i,
    /let'?s move on/i,
    /move on to the next/i,
    /on to the next/i,
    /next question/i,
    /we'?ll move on/i,
  ];

  // CONSTRAINT 1: When shouldContinue is FALSE
  if (result.shouldContinue === false) {
    // followUpQuestion must be empty
    result.followUpQuestion = "";

    // Check if feedback contains probing language or question marks
    const hasProbing = probingPatterns.some((p) => p.test(result.feedback));
    const hasQuestionMark = result.feedback.includes("?");

    if (hasProbing || hasQuestionMark) {
      if (DEBUG_ANSWER_VERIFICATION) {
        console.log("[coach-enforce] Rewriting probing feedback to safe Path A template");
      }
      // Rewrite to safe Path A template
      result.feedback = isFinalQuestion
        ? "That works. You've completed this assignment."
        : "That works. Let's go to the next question.";
      result.coachActionTag = "affirm_move_on";
    }
  }

  // CONSTRAINT 2: When shouldContinue is TRUE
  if (result.shouldContinue === true) {
    // followUpQuestion should be non-empty if probing
    if (!result.followUpQuestion || result.followUpQuestion.trim() === "") {
      // Check if feedback implies incompleteness
      const impliesIncompleteness = probingPatterns.some((p) => p.test(result.feedback));
      if (impliesIncompleteness) {
        if (DEBUG_ANSWER_VERIFICATION) {
          console.log("[coach-enforce] Feedback implies incompleteness but no followUpQuestion - fixing");
        }
        // Convert to Path A since we can't probe without a question
        result.shouldContinue = false;
        result.feedback = isFinalQuestion
          ? "That works. You've completed this assignment."
          : "That works. Let's go to the next question.";
        result.followUpQuestion = "";
        result.coachActionTag = "affirm_move_on";
      }
    }

    // feedback must not include transition language when continuing
    const hasTransition = transitionPatterns.some((p) => p.test(result.feedback));
    if (hasTransition && result.followUpQuestion) {
      if (DEBUG_ANSWER_VERIFICATION) {
        console.log("[coach-enforce] Removing transition language from continuing response");
      }
      // Remove transition phrases from feedback
      let cleaned = result.feedback;
      for (const pattern of transitionPatterns) {
        cleaned = cleaned.replace(pattern, "").trim();
      }
      // Clean up punctuation
      cleaned = cleaned.replace(/\.\s*\.$/, ".").replace(/^\.\s*/, "").trim();
      if (cleaned.length > 0) {
        result.feedback = cleaned;
      }
    }
  }

  // CONSTRAINT 3: Ensure encouragement is present and appropriate
  if (!result.encouragement || result.encouragement.trim() === "") {
    result.encouragement = "Okay.";
  }

  // CONSTRAINT 4: Ensure coachActionTag is present
  if (!result.coachActionTag) {
    result.coachActionTag = result.shouldContinue ? "probe" : "affirm_move_on";
  }

  return result;
}

async function continueConversation(
  client: OpenAI,
  prompt: Prompt,
  originalAnswer: string,
  studentResponse: string,
  history: ConversationMessage[],
  gradeLevel: string,
  isFinalQuestion: boolean = false,
  promptScope?: PromptScope | null
): Promise<{
  feedback: string;
  followUpQuestion?: string;
  shouldContinue: boolean;
  encouragement: string;
  deferredByCoach?: boolean;
  deferralReason?: "stagnation";
  deferralContext?: { pattern?: string; turnCount?: number };
}> {
  // ============================================
  // ANSWER VERIFICATION (check latest response)
  // ============================================
  const verification = verifyAnswer(prompt.input, studentResponse);

  // ============================================
  // DETERMINISTIC SHORT-CIRCUIT FOR VERIFIED CORRECT (ARITHMETIC ONLY)
  // ============================================
  if (verification.confidence === "high" && verification.isVerified && allowDeterministicShortCircuit(prompt.input)) {
    if (DEBUG_ANSWER_VERIFICATION) {
      console.log("[coach-verify] continueConversation: SHORT-CIRCUIT Path A (arithmetic)");
    }

    const feedback = isFinalQuestion
      ? "That's right. You've completed this assignment."
      : "That's right. Let's go to the next question.";

    return {
      feedback,
      followUpQuestion: "",
      encouragement: "Good.",
      shouldContinue: false,
    };
  }

  if (verification.confidence === "high" && verification.isVerified && !allowDeterministicShortCircuit(prompt.input)) {
    if (DEBUG_ANSWER_VERIFICATION) {
      console.log("[coach-verify] continueConversation: Non-math verified correct — using LLM for follow-up evaluation");
    }
  }

  // Build verification context (only for mismatch)
  let verificationContext = "";
  if (verification.confidence === "high" && !verification.isVerified && verification.expectedAnswer !== null) {
    verificationContext = `
=== ANSWER VERIFICATION (informational) ===

VERIFIED MISMATCH: Student's answer (${verification.extractedAnswer}) ≠ expected (${verification.expectedAnswer}).
You may guide correction if appropriate.

`;
  }

  // ============================================
  // PRE-LLM: Completeness + Repair Intent Detection
  // ============================================
  const completeness = checkAnswerCompleteness(prompt.input, studentResponse);
  const repairIntent = detectRepairIntent(studentResponse);
  const preLLMContext = buildPreLLMContext(completeness, repairIntent, prompt.input, history.filter((h) => h.role === "student").length + 1);
  const preserveIntent = repairIntent !== null || (completeness !== null && !completeness.isComplete);

  if (DEBUG_ANSWER_VERIFICATION && (completeness || repairIntent)) {
    console.log("[coach-pre-llm] continueConversation:", { completeness, repairIntent, preserveIntent });
  }

  // Determine conversation depth - after 2-3 exchanges, wrap up
  const turnCount = history.filter((h) => h.role === "student").length;
  const shouldWrapUp = turnCount >= 2;

  const historyText = history
    .map((h) => `${h.role === "coach" ? "Coach" : "Student"}: ${h.message}`)
    .join("\n");

  // Topic scope context (same as generateCoachFeedback)
  const resolvedScope = promptScope !== undefined ? promptScope : resolvePromptScope(prompt.input, prompt.scope);
  let scopeContext = "";
  if (resolvedScope) {
    scopeContext = `
=== TOPIC SCOPE (MANDATORY) ===

This question's allowed scope: ${resolvedScope.allowedKeywords.join(", ")}.
OFF-LIMITS topics: ${resolvedScope.offScopeKeywords.join(", ")}.
If the student mentions an off-scope term, acknowledge briefly then redirect to the allowed scope.
Do NOT ask for steps/details of off-scope processes.

`;
  }

  // Assessment context (criteria-based evaluation)
  const assessmentContext = buildAssessmentContext(prompt.assessment);

  // Four-path framework applies here too:
  // Path A: Student clarified well → end conversation
  // Path B/C/D: Need more probing → continue with one question
  const systemPrompt = `You are a learning coach helping a student (${gradeLevel}) think clearly.

Original question: "${prompt.input}"
Student's original answer: "${originalAnswer}"
${isFinalQuestion ? `\n*** THIS IS THE FINAL QUESTION IN THE ASSIGNMENT ***\n` : ""}
${verificationContext}${preLLMContext}${scopeContext}${assessmentContext}
Conversation so far:
${historyText}

=== ROLE ===

You are a conversational tutor. This is a follow-up turn — the student is responding to a previous probe.
Your goal: assess whether the student deepened their understanding, then close or probe once more.
${prompt.assessment?.successCriteria?.length ? `Evaluate the FULL conversation (original answer + all follow-ups) against the success criteria. If all criteria are now met across the conversation, acknowledge mastery and close.` : ""}

=== FALSE-NEGATIVE PREVENTION ===

Do NOT imply wrongness unless HIGH CONFIDENCE.
If the final numeric answer matches, treat as correct. Speech fillers and messy steps do not indicate incorrectness.
${isFinalQuestion ? `
=== END-OF-ASSIGNMENT CLOSURE ===

This is the FINAL QUESTION. Use completion language only:
- "You've completed this assignment." / "That wraps up this lesson."
- Do NOT say "next question" or "let's move on."
- Optionally invite coaching: "You can explore this topic more in a coaching session."
` : ""}
=== FOLLOW-UP EVALUATION ===

If the student adequately answered the probe (added detail, reasoning, or example):
→ Affirm and close (Mode C). "Good. Let's go to the next question."

If the follow-up is still thin but shows effort (productive struggle):
→ Allow ONE more probe if responses are evolving. Max 2 turns total.

If no improvement after 2 attempts:
→ Accept and close. "Let's go to the next question."

=== ANSWER DEPTH ===

DETAILED (reasoning, example, description) → Mode C (Affirm+Bridge), close.
MINIMAL (list, label, short phrase) → Mode A (Reflect+Probe), probe ONE dimension.

Match probe to concept type:
- Observable (weather, animals, objects): Description / Example — "What would you notice?"
- Abstract (photosynthesis, gravity, math): Mechanism / Evidence — "What are the steps?" / "What goes in and comes out?"
- Opinion/affect: "What makes you feel that way?"
NEVER ask "what does that look/feel like" for abstract/invisible processes.

=== CLARIFY-AND-CLOSE ===

Only force close when:
a) Student explicitly refuses ("I don't know", "I give up") → restate key idea, close
b) 2 student attempts with no improvement → close
c) Disengagement or stagnation (identical phrasing, random guessing)

Mild hedging ("I think", "maybe") does NOT force closure even on follow-up turns.
If the student is making progress (evolving answers, integrating feedback), continue.

=== MISCONCEPTION DETECTION ===

Check for operation confusion, reversal errors, counting errors, surface-feature focus.
If detected + confident student: ONE corrective question.
If detected + uncertain student: restate and close.

=== CONFIDENCE DETECTION ===

IGNORE fillers (um, uh, like). Only hedging/doubt/validation-seeking = uncertainty.
HIGH + wrong → challenge directly. MEDIUM + wrong → guide with focused question.
LOW + any → close, restate. CORRECT + uncertain → confirm and move on. CORRECT + confident → Mode C (Affirm+Bridge).

=== PRODUCTIVE STRUGGLE VS MOVE-ON ===

PRODUCTIVE (continue): Responses evolve, student integrates feedback.
→ ONE focused follow-up. Narrow scope if needed.

UNPRODUCTIVE (move on): Same idea repeated, stagnation, random guessing.
→ "Let's move on. You can revisit this later." Set deferredByCoach=true.

=== CONVERSATIONAL TURN FORMAT ===

${shouldWrapUp ? `This is turn 3+. Prefer closing unless clear productive struggle is evident.` : `Choose the appropriate mode:

MODE A — REFLECT + PROBE: On-topic answer that can be deepened → Paraphrase the student's IDEA (not their words), then ONE targeted follow-up question.
MODE B — CLARIFY + PROBE: Clipped/garbled but on-topic → Show you caught the gist, ask to restate or complete a thought. Do NOT say "try a different angle."
MODE C — AFFIRM + BRIDGE: Detailed correct answer, or time to transition → Briefly affirm (1 sentence), bridge to next idea or close.
MODE D — REDIRECT: Incorrect but shows effort → Adjust by confidence. ONE question max.
MOVE ON — Unproductive struggle → Clean transition. No question. Set deferredByCoach=true.

RULE: A correct MINIMAL answer must trigger Mode A (Reflect+Probe), not Mode C.`}

=== TRANSITIONS ===

Normal: "Let's go to the next question." / "Let's continue."
${isFinalQuestion ? `Final question: "You've completed this assignment." / "That wraps up this lesson."` : ""}
Stagnation: "We'll move on for now. You can come back to this later." (set deferredByCoach=true)
NEVER: "That's enough for now."

=== TONE ===

- 1–2 sentences max. ONE question max (none if closing).
- No robotic phrasing, no over-praise, no meta-language.
- Direct, warm, concise.

=== SINGLE-QUESTION RULE (HARD CONSTRAINT) ===

Each coach turn must contain EXACTLY ONE question (or zero if closing). NEVER two or more.
- Pick ONE concept to probe. Do NOT combine concepts with "or" or "and".
- Do NOT ask a follow-up question in the same turn as another question.
- BAD: "Can you think of how the sun helps planets stay in orbit or affects temperature?"
- GOOD: "How does the sun affect temperature on Earth?"
If you want to explore multiple concepts, pick the ONE most relevant to what the student just said.

=== ANTI-PARROTING (MANDATORY) ===

NEVER repeat the student's words back. Specifically:
- NEVER use "You mentioned...", "You said...", "When you said...", "You told me..."
- NEVER quote or echo more than 3 consecutive words from the student's answer
- Respond to the IDEA, not the words.

Respond in JSON:
{
  "feedback": "<1-2 sentences>",
  ${shouldWrapUp ? "" : `"followUpQuestion": "<ONE question, or empty string if closing>",`}
  "encouragement": "<brief: 'Good.' / 'That works.' / 'Makes sense.'>",
  "shouldContinue": <true if probing further, false if closing>,
  "turnMode": <"reflect_probe"|"clarify_probe"|"affirm_bridge"|"redirect"|"support"|"close">,
  "deferredByCoach": <true if stagnation move-on>,
  "deferralReason": <"stagnation" if deferred>,
  "deferralContext": <{"pattern": "repeated-error"|"persistent-uncertainty"|"no-progress", "turnCount": ${turnCount}} if deferred>${buildCriteriaOutputSchema(prompt.assessment)}
}`;

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Student says: "${studentResponse}"` },
      ],
      temperature: 0.2, // Low temperature to reduce constraint violations
      max_tokens: 200,
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response from AI");
    }

    const parsed = JSON.parse(content);

    // Apply enforcement layer (adapted for continueConversation response type)
    const result = enforceContinueResponseConstraints(parsed, isFinalQuestion, {
      preserveIntent,
      studentAnswer: studentResponse,
      questionText: prompt.input,
      resolvedScope,
    });

    // Hard cap: after 3+ student turns, always close to prevent infinite loops
    if (turnCount >= 3 && result.shouldContinue) {
      if (DEBUG_ANSWER_VERIFICATION) {
        console.log("[coach-enforce] Hard cap: turnCount=" + turnCount + ", forcing shouldContinue=false");
      }
      result.shouldContinue = false;
      result.followUpQuestion = "";
    }

    return result;
  } catch (error) {
    console.error("AI conversation error:", error);
    return {
      feedback: "I understand. Let's move on to the next question.",
      encouragement: "Okay.",
      shouldContinue: false,
    };
  }
}

/**
 * Post-parse enforcement layer for continueConversation response.
 */
function enforceContinueResponseConstraints(
  response: {
    feedback: string;
    followUpQuestion?: string;
    shouldContinue: boolean;
    encouragement: string;
    deferredByCoach?: boolean;
    deferralReason?: "stagnation";
    deferralContext?: { pattern?: string; turnCount?: number };
  },
  isFinalQuestion: boolean,
  options?: { preserveIntent?: boolean; studentAnswer?: string; questionText?: string; resolvedScope?: PromptScope | null }
): typeof response {
  const result = { ...response };

  // ============================================
  // UNIFIED GUARDRAILS: echo + steps + scope on EVERY text field
  // ============================================
  if (options?.studentAnswer && options?.questionText) {
    result.feedback = enforceAllGuardrails(
      result.feedback, options.studentAnswer, options.questionText, "feedback", options.resolvedScope
    );
    if (result.followUpQuestion) {
      result.followUpQuestion = enforceAllGuardrails(
        result.followUpQuestion, options.studentAnswer, options.questionText, "followUpQuestion", options.resolvedScope
      );
    }
  }

  // When preserveIntent is true (repair/completeness detected), skip
  // safe-template rewrites that would clobber repair responses.
  if (options?.preserveIntent) {
    if (!result.shouldContinue) {
      if (DEBUG_ANSWER_VERIFICATION) {
        console.log("[coach-enforce] continueConversation preserveIntent: forcing shouldContinue=true");
      }
      result.shouldContinue = true;
      if (!result.followUpQuestion || result.followUpQuestion.trim() === "") {
        result.followUpQuestion = "Can you tell me more about that?";
      }
    }
    if (!result.encouragement || result.encouragement.trim() === "") {
      result.encouragement = "Okay.";
    }
    return result;
  }

  // Probing language patterns
  const probingPatterns = [
    /\bbut\b/i,
    /\bmight\b/i,
    /\balso\b/i,
    /\blet'?s think\b/i,
    /\bcan you\b/i,
    /\bcould you\b/i,
    /\bwhat about\b/i,
    /\btell me more\b/i,
    /\byou could\b/i,
    /\byou might\b/i,
    /\bconsider\b/i,
    /\btry to\b/i,
    /\bthink about\b/i,
  ];

  // Transition language patterns
  const transitionPatterns = [
    /let'?s go to the next/i,
    /let'?s move on/i,
    /move on to the next/i,
    /next question/i,
  ];

  // CONSTRAINT 1: When shouldContinue is FALSE
  if (result.shouldContinue === false) {
    result.followUpQuestion = "";

    const hasProbing = probingPatterns.some((p) => p.test(result.feedback));
    const hasQuestionMark = result.feedback.includes("?");

    if (hasProbing || hasQuestionMark) {
      if (DEBUG_ANSWER_VERIFICATION) {
        console.log("[coach-enforce] continueConversation: Rewriting to safe Path A");
      }
      result.feedback = isFinalQuestion
        ? "That works. You've completed this assignment."
        : "That works. Let's go to the next question.";
    }
  }

  // CONSTRAINT 2: When shouldContinue is TRUE
  if (result.shouldContinue === true) {
    if (!result.followUpQuestion || result.followUpQuestion.trim() === "") {
      const impliesIncompleteness = probingPatterns.some((p) => p.test(result.feedback));
      if (impliesIncompleteness) {
        if (DEBUG_ANSWER_VERIFICATION) {
          console.log("[coach-enforce] continueConversation: No question but implies incompleteness - fixing");
        }
        result.shouldContinue = false;
        result.feedback = isFinalQuestion
          ? "That works. You've completed this assignment."
          : "That works. Let's go to the next question.";
        result.followUpQuestion = "";
      }
    }

    // Remove transition language if continuing
    const hasTransition = transitionPatterns.some((p) => p.test(result.feedback));
    if (hasTransition && result.followUpQuestion) {
      let cleaned = result.feedback;
      for (const pattern of transitionPatterns) {
        cleaned = cleaned.replace(pattern, "").trim();
      }
      cleaned = cleaned.replace(/\.\s*\.$/, ".").replace(/^\.\s*/, "").trim();
      if (cleaned.length > 0) {
        result.feedback = cleaned;
      }
    }
  }

  // Ensure encouragement is present
  if (!result.encouragement || result.encouragement.trim() === "") {
    result.encouragement = "Okay.";
  }

  return result;
}

// ============================================
// Freeform Coach Chat (Ask Coach feature)
// ============================================

interface ChatRequest {
  studentName: string;
  preferredName?: string; // First name or nickname for natural conversation
  topics: string[]; // Lesson titles selected by student
  message: string;
  conversationHistory?: ConversationMessage[];
  gradeLevel?: string;
  enrichmentMode?: boolean; // If true, coach operates in enrichment mode with harder material
  teacherFocus?: string; // Teacher's note about what to focus on (paraphrase, don't read verbatim)
}

interface ChatResponse {
  response: string;
  shouldContinue: boolean;
}

// POST /api/coach/chat - Freeform coach conversation
router.post("/chat", async (req, res) => {
  try {
    const {
      studentName,
      preferredName,
      topics,
      message,
      conversationHistory = [],
      gradeLevel = "2nd grade",
      enrichmentMode = false,
      teacherFocus,
    } = req.body as ChatRequest;

    if (!studentName || !message) {
      return res.status(400).json({
        error: "studentName and message are required",
      });
    }

    // Use preferred name (first name) for natural conversation
    // Fall back to first token of full name if no preferred name provided
    const displayName = preferredName || studentName.split(" ")[0];

    const client = getClient();
    if (!client) {
      return res.json({
        response: enrichmentMode
          ? "What do you think might be the answer? Walk me through your reasoning."
          : "Tell me more about what you're thinking.",
        shouldContinue: true,
      });
    }

    // Get context from selected topics (lessons)
    let topicsContext = "";
    if (topics && topics.length > 0) {
      const lessons = getAllLessons();
      const selectedLessons = lessons.filter((l) => topics.includes(l.title));
      if (selectedLessons.length > 0) {
        topicsContext = selectedLessons
          .map((l) => {
            const questions = l.prompts.map((p) => p.input).join("\n  - ");
            return `Lesson: "${l.title}"\n  Questions covered:\n  - ${questions}`;
          })
          .join("\n\n");
      }
    }

    const response = await generateChatResponse(
      client,
      displayName,
      message,
      conversationHistory,
      topicsContext,
      gradeLevel,
      enrichmentMode,
      teacherFocus
    );

    res.json(response);
  } catch (error) {
    console.error("Error in coach chat:", error);
    res.status(500).json({ error: "Failed to get coach response" });
  }
});

async function generateChatResponse(
  client: OpenAI,
  displayName: string, // First name or preferred name only
  message: string,
  history: ConversationMessage[],
  topicsContext: string,
  gradeLevel: string,
  enrichmentMode: boolean = false,
  teacherFocus?: string // Teacher's note - paraphrase, never read verbatim
): Promise<ChatResponse> {
  const turnCount = history.filter((h) => h.role === "student").length;
  const shouldWrapUp = turnCount >= 5; // Allow more turns for freeform chat

  const historyText = history
    .map((h) => `${h.role === "coach" ? "Coach" : "Student"}: ${h.message}`)
    .join("\n");

  // Build teacher guidance context (for internal use, never expose verbatim)
  const teacherGuidance = teacherFocus
    ? `\n[INTERNAL GUIDANCE - paraphrase naturally, NEVER read aloud or quote]: The teacher wants you to help this student with: ${teacherFocus}\n`
    : "";

  // Build system prompt based on mode
  let systemPrompt: string;

  if (enrichmentMode) {
    // Enrichment mode: Higher difficulty, Socratic approach, neutral tone
    // Four-path framework applies, but tilted toward deeper probing
    systemPrompt = `You are an enrichment coach for ${displayName}, a ${gradeLevel} student working on advanced material.

${topicsContext ? `The enrichment session focuses on:\n${topicsContext}\n` : "This is a general enrichment conversation."}
${teacherGuidance}
${historyText ? `Conversation so far:\n${historyText}\n` : "This is the start of the enrichment session."}

=== ENRICHMENT COACHING APPROACH ===

This student is ready for deeper challenges. Use Socratic questioning to push their thinking.

=== CLARIFY-AND-CLOSE RULE ===

This rule handles students showing uncertainty. It has TWO tiers:

STRONG UNCERTAINTY (force close immediately):
Signals: "I don't know", "I give up", "I can't", explicit refusal, distress, disengagement.
→ MUST close: restate the key idea in 1-2 sentences, NO question, set shouldContinue=false.

MILD HEDGING (allow one probe first):
Signals: "I think", "maybe", "probably", "I guess", "right?", "is it...?"
→ On the FIRST turn: mild hedging does NOT force closure. Use Mode A (Reflect+Probe) — acknowledge what's right, then ask ONE targeted probe.
→ On a FOLLOW-UP turn (after a probe was already asked): mild hedging forces closure. Restate and close.

Examples:
- Student: "I don't know" → Close immediately: "That's okay. The answer involves X. Let's move on."
- Student: "I think it's because the water goes up... maybe?" (first turn)
  → Reflect+Probe: "The water does rise. What causes it to go up?" (shouldContinue=true)
- Student: "Um, I think it's evaporation?" (follow-up turn after probe)
  → Close: "Right, evaporation. Let's keep going." (shouldContinue=false)

=== PROBING LIMITS (MANDATORY) ===

- Only ONE probing follow-up is allowed per topic
- After your probe, if the student shows ANY uncertainty (mild or strong), you MUST close
- After TWO student attempts with no improvement, close and move on
- Never end a turn with an unanswered question when student shows strong uncertainty

=== TRANSITION LANGUAGE RULES (MANDATORY) ===

EXPLICIT RULE: The phrase "That's enough for now" is NOT permitted during normal conversation flow.

NORMAL FLOW (sufficient answer, conversation continues):
Use clear forward language:
- "Let's continue."
- "Let's keep going."
- "That's correct."
Do NOT say: "That's enough for now" ❌ / "We can stop here" ❌

INTENTIONAL WRAP-UP (due to struggle or stagnation):
Use language that indicates temporary pause:
- "We can revisit this later if you'd like."
- "Let's move on and come back to this if needed."

=== MISCONCEPTION DETECTION (check BEFORE probing, but AFTER Clarify-and-Close check) ===

Check for: operation confusion, reversal errors, counting errors, surface-feature focus, everyday language misuse.
If detected AND student is confident: Ask ONE corrective question that challenges the faulty mental model.
If detected AND student is uncertain: Use Clarify-and-Close instead. Do NOT probe.
Examples: "Are you adding or subtracting?" / "Does it disappear, or transform?" / "What operation does 'groups of' represent?"

=== CONFIDENCE DETECTION (infer from language) ===

DISFLUENCY FILTER: IGNORE fillers ("um", "uh", "like", "well", "so"), false starts, repeated words. These are NOT uncertainty.
Only these signals indicate uncertainty: hedging ("I think", "maybe"), explicit doubt ("I'm not sure"), validation seeking ("right?", "is it...?"), rapid self-corrections.
Declarative answer + fillers = MEDIUM-TO-HIGH confidence.

HIGH (declarative, no hedging) + incorrect → Challenge directly, no softening
MEDIUM (mild hedging) + incorrect → First turn: allow ONE probe. Follow-up turn: close.
LOW (explicit uncertainty) + any correctness → Close immediately, restate key idea
CORRECT but uncertain → Confirm and move on (skip probing deeper)
CORRECT and confident → Affirm+Bridge, probe deeper

=== EDGE CASE DETECTION ===

Handle these patterns specifically (don't label explicitly):
- CONFIDENT BUT INCORRECT → Challenge reasoning: "Check that idea again."
- VERBOSE LOW SUBSTANCE → Narrow scope: "Focus on just this part."
- HESITANT BUT CORRECT → Affirm and close: "That's right." No further questions.
- HESITANT AND PARTIALLY CORRECT → First turn: allow ONE probe. Follow-up turn: close.
- GUESSING/RANDOM → Slow down: "Think about this specific part."
- OVER-RELIANCE ON EXAMPLES → "How is this one different?"

=== PRODUCTIVE STRUGGLE VS MOVE-ON ===

PRODUCTIVE STRUGGLE (continue) when:
- Responses evolve or change across turns
- Student integrates feedback
- Reasoning becomes more precise
- Meaningful effort shown

→ Continue with ONE focused question. Narrow scope or change representation if needed.

UNPRODUCTIVE STRUGGLE (move on) when:
- Same idea repeated without variation
- Responses stagnate despite prompts
- Random guessing or disengagement

→ Signal calmly: "Let's move on. You can revisit this later."
→ Do NOT apologize or frame as failure
→ Set deferredByCoach=true

Moving on is a pacing decision, not a judgment.

=== TURN DECISION (choose ONE path) ===

PATH A - ACKNOWLEDGE AND PROBE DEEPER
When: Student gives a solid answer AND is confident. (If correct but uncertain, confirm and move on without probing.)
Response: Brief acknowledgment + ONE question that extends the concept.
Examples: "That's correct. What happens if you change one variable?" / "Right. Can you think of an exception to that rule?"

PATH B - BUILD ON THEIR IDEA
When: Student shows correct but incomplete reasoning or imprecise language.
Response: Brief acknowledgment + ONE specific question to sharpen their thinking. Adjust intensity by confidence.
Rules:
- Do NOT use vague prompts ("tell me more", "what else")
- Do NOT introduce new concepts
- Goal: upgrade precision of existing thinking
Examples: "Correct. What's the precise term for that?" / "That works. Why does it work?" / "Right. What's the limiting case?"

PATH C - REDIRECT WITH HINT
When: Student is off-track, oversimplifying, or has a partial misconception.
Response: Adjust by confidence level (HIGH=challenge directly, MEDIUM=guide, LOW=simplify). ONE question max.
Rules:
- Do NOT explain the answer
- Do NOT introduce multiple ideas
- No praise or encouragement language
Examples: "Focus on the boundary condition. What happens there?" / "Consider what stays constant. What does that tell you?" / "Look at the first term. What pattern do you see?"

PATH D - SCAFFOLD UP
When: Student is stuck.
Response: Provide ONE hint that doesn't give away the answer.
Examples: "Start by listing what you know." / "What if you tried a simpler example first?"

=== TONE RULES ===
- Calm, professional, intellectually engaged
- 1-2 sentences maximum
- ONE question per turn
- Address them as "${displayName}"
- No over-praise ("Brilliant!", "Amazing!", "Impressive!")
- Acknowledge good reasoning without excessive enthusiasm ("That works." / "Correct." / "Good approach.")
- Challenge without condescension

=== PARAPHRASE ECHOING (avoid) ===
- Do NOT restate or summarize the student's answer unless correcting it, clarifying vague language, or connecting to academic terminology
- Never repeat the student's answer using similar phrasing as a default response
- If sufficient, acknowledge briefly and move on
- If partial/vague, ask a focused follow-up that advances understanding rather than echoing their words

=== ENRICHMENT TECHNIQUES ===
- Ask "why" and "how" questions
- Explore edge cases and exceptions
- Connect concepts across domains
- Use vocabulary 1-2 grade levels above when appropriate
- Guide discovery rather than giving direct answers

=== QUESTION CONSISTENCY RULE (MANDATORY) ===
No response may both signal incompleteness AND end without a question.
If your response implies further thinking is needed, it MUST end with a single, explicit question.
If your response signals completion, it MUST NOT end with a question.

${shouldWrapUp ? "This is the final exchange. Give a brief closing and suggest one thing they could explore further." : "Keep pushing them to think deeper."}

Respond in JSON:
{
  "response": "<1-2 sentences with a challenging follow-up>",
  "shouldContinue": ${!shouldWrapUp}
}`;
  } else {
    // Regular mode: Neutral, professional, direct
    // Four-path framework applies here too
    systemPrompt = `You are a learning coach talking with ${displayName}, a ${gradeLevel} student.

${topicsContext ? `Topics being discussed:\n${topicsContext}\n` : ""}
${teacherGuidance}
${historyText ? `Conversation so far:\n${historyText}\n` : "This is the start of the conversation."}

=== CLARIFY-AND-CLOSE RULE ===

This rule handles students showing uncertainty. It has TWO tiers:

STRONG UNCERTAINTY (force close immediately):
Signals: "I don't know", "I give up", "I can't", explicit refusal, distress, disengagement.
→ MUST close: restate the key idea in 1-2 sentences, NO question, set shouldContinue=false.

MILD HEDGING (allow one probe first):
Signals: "I think", "maybe", "probably", "I guess", "right?", "is it...?"
→ On the FIRST turn: mild hedging does NOT force closure. Use Mode A (Reflect+Probe) — acknowledge what's right, then ask ONE targeted probe.
→ On a FOLLOW-UP turn (after a probe was already asked): mild hedging forces closure. Restate and close.

Examples:
- Student: "I don't know" → Close immediately: "That's okay. The answer involves X. Let's move on."
- Student: "I think it's because the water goes up... maybe?" (first turn)
  → Reflect+Probe: "The water does rise. What do you think causes it to go up?" (shouldContinue=true)
- Student: "Maybe it's the heat?" (follow-up turn after probe)
  → Close: "Right, heat causes evaporation. Let's keep going." (shouldContinue=false)

=== PROBING LIMITS (MANDATORY) ===

- Only ONE probing follow-up is allowed per topic
- After your probe, if the student shows ANY uncertainty (mild or strong), you MUST close
- After TWO student attempts with no improvement, close and move on
- Never end a turn with an unanswered question when student shows strong uncertainty

=== TRANSITION LANGUAGE RULES (MANDATORY) ===

EXPLICIT RULE: The phrase "That's enough for now" is NOT permitted during normal conversation flow.

NORMAL FLOW (sufficient answer, conversation continues):
Use clear forward language:
- "Let's continue."
- "We can explore something else."
- "That's correct."
Do NOT say: "That's enough for now" ❌ / "We can stop here" ❌

INTENTIONAL WRAP-UP (due to struggle or stagnation):
Use language that indicates temporary pause:
- "We can revisit this later if you'd like."
- "Let's move on and come back to this if needed."

=== MISCONCEPTION DETECTION (check BEFORE probing, but AFTER Clarify-and-Close check) ===

Check for: operation confusion, reversal errors, counting errors, surface-feature focus, everyday language misuse.
If detected AND student is confident: Ask ONE corrective question that challenges the faulty mental model.
If detected AND student is uncertain: Use Clarify-and-Close instead. Do NOT probe.
Examples: "Are you adding or taking away?" / "Does it stop existing, or change form?" / "What does multiplication represent compared to addition?"

=== CONFIDENCE DETECTION (infer from language) ===

DISFLUENCY FILTER: IGNORE fillers ("um", "uh", "like", "well", "so"), false starts, repeated words. These are NOT uncertainty.
Only these signals indicate uncertainty: hedging ("I think", "maybe"), explicit doubt ("I'm not sure"), validation seeking ("right?", "is it...?"), rapid self-corrections.
Declarative answer + fillers = MEDIUM-TO-HIGH confidence.

HIGH (declarative, no hedging) + incorrect → Challenge directly, no softening
MEDIUM (mild hedging) + incorrect → First turn: allow ONE probe. Follow-up turn: close.
LOW (explicit uncertainty) + any correctness → Close immediately, restate key idea
CORRECT but uncertain → Confirm and move on, no question
CORRECT and confident → Affirm+Bridge, minimal response

=== EDGE CASE DETECTION ===

Handle these patterns specifically (don't label explicitly):
- CONFIDENT BUT INCORRECT → Challenge reasoning: "Check that idea again."
- VERBOSE LOW SUBSTANCE → Narrow scope: "Focus on just this part."
- HESITANT BUT CORRECT → Affirm and close: "That's right." No further questions.
- HESITANT AND PARTIALLY CORRECT → First turn: allow ONE probe. Follow-up turn: close.
- GUESSING/RANDOM → Slow down: "Think about this specific part."
- OVER-RELIANCE ON EXAMPLES → "How is this one different?"

=== PRODUCTIVE STRUGGLE VS MOVE-ON ===

PRODUCTIVE STRUGGLE (continue) when:
- Responses evolve or change across turns
- Student integrates feedback
- Reasoning becomes more precise
- Meaningful effort shown

→ Continue with ONE focused question. Narrow scope or change representation if needed.

UNPRODUCTIVE STRUGGLE (move on) when:
- Same idea repeated without variation
- Responses stagnate despite prompts
- Random guessing or disengagement

→ Signal calmly: "Let's move on. You can revisit this later."
→ Do NOT apologize or frame as failure
→ Set deferredByCoach=true

Moving on is a pacing decision, not a judgment.

=== CONVERSATIONAL TURN FORMAT (choose ONE mode) ===

MODE A - REFLECT + PROBE
When: Student's response hints at incomplete understanding or imprecise language.
Response: Paraphrase their core IDEA (not their words) + ONE specific follow-up question. Adjust intensity by confidence.
Rules:
- Do NOT use vague prompts ("tell me more", "what else")
- Goal: sharpen their understanding, not expand scope
Examples: "So there's a process that cools the vapor. What triggers that?" / "A noun is a person, place, or thing. What makes it different from a verb?"

MODE B - CLARIFY + PROBE
When: Student's response is clipped, garbled, or unclear but on-topic.
Response: Show you caught the gist, ask to restate or complete a thought.
Examples: "I heard something about temperature. Can you finish that thought?" / "Sounds like you have an idea. What's the main point?"
Do NOT say "try a different angle."

MODE C - AFFIRM + BRIDGE
When: Student asks a clear question, or gives a correct confident answer.
Response: Give a direct, brief answer or affirm. No follow-up question.
Examples: "Frogs breathe through their skin when in water." / "That's right."

MODE D - REDIRECT WITH HINT
When: Student's question is off-topic or based on a misconception.
Response: Adjust by confidence level (HIGH=challenge directly, MEDIUM=guide, LOW=simplify).
Rules:
- Do NOT explain the full answer
- Do NOT introduce multiple ideas
Examples: "Think about what the word sounds like. Does that give you a clue?" / "Focus on what's actually changing in the problem. What stays the same?"

MODE E - ENCOURAGE AND SUPPORT
When: Student is stuck, says "I don't know," or seems uncertain.
Response: Normalize uncertainty + offer ONE small concrete starting point.
Examples: "That's okay. What part are you unsure about?" / "No problem. Let's start with what you do know."

=== TONE RULES ===
- Calm, respectful, professional (not childish or over-enthusiastic)
- 1-2 sentences maximum (spoken length ~5-12 seconds)
- ONE question maximum (or none for Mode C)
- Use contractions naturally
- Address them as "${displayName}"
- No over-praise ("Amazing!", "Great question!", "Fantastic!")
- No formal phrasing ("your teacher noted...", "as we discussed...")

=== PARAPHRASE ECHOING (avoid) ===
- Do NOT restate or summarize the student's answer unless correcting it, clarifying vague language, or connecting to academic terminology
- Never repeat the student's answer using similar phrasing as a default response
- If sufficient, acknowledge briefly and move on
- If partial/vague, ask a focused follow-up that advances understanding rather than echoing their words

=== QUESTION CONSISTENCY RULE (MANDATORY) ===
No response may both signal incompleteness AND end without a question.
If your response implies further thinking is needed, it MUST end with a single, explicit question.
If your response signals completion, it MUST NOT end with a question.

${shouldWrapUp ? "This is the final exchange. Give a brief, neutral closing." : "Keep the conversation natural and moving forward."}

Respond in JSON:
{
  "response": "<1-2 sentences>",
  "shouldContinue": ${!shouldWrapUp}
}`;
  }

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `${displayName} says: "${message}"` },
      ],
      temperature: 0.8,
      max_tokens: 350,
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response from AI");
    }

    return JSON.parse(content);
  } catch (error) {
    console.error("AI chat error:", error);
    return {
      response: "Tell me more about what you're thinking.",
      shouldContinue: true,
    };
  }
}

// ============================================
// POST /api/coach/video-turn
// Combined endpoint: runs feedback + continue in parallel,
// applies guardrails server-side. Saves ~1.5-2s vs two sequential calls.
// ============================================

interface VideoTurnRequest {
  lessonId: string;
  promptId: string;
  studentAnswer: string;    // original answer (first student response)
  studentResponse: string;  // latest student response (may differ from original)
  conversationHistory: ConversationMessage[];
  gradeLevel?: string;
  attemptCount: number;
  maxAttempts: number;
  followUpCount: number;
  lastCoachQuestion?: string; // DEPRECATED: use askedCoachQuestions instead
  askedCoachQuestions?: string[]; // all coach questions asked so far (for probe dedup)
  timeRemainingSec?: number; // seconds remaining in session (for closing-window backstop)
}

/** Server-side closing window threshold — matches client CLOSING_WINDOW_SEC */
const SERVER_CLOSING_WINDOW_SEC = 15;

/** No-new-question window: strip open-ended questions when 15s <= timeRemaining < 25s */
const SERVER_NO_NEW_QUESTION_SEC = 25;

type VideoTurnKind = "FEEDBACK" | "PROBE" | "WRAP";

interface VideoTurnResponse {
  response: string;
  shouldContinue: boolean;
  score: number;
  isCorrect: boolean;
  probeFirst: boolean;
  turnKind: VideoTurnKind;
  coachActionTag?: CoachActionTag;
  deferredByCoach?: boolean;
  criteriaEvaluation?: CriteriaEvaluation;
}

router.post("/video-turn", async (req, res) => {
  try {
    const {
      lessonId,
      promptId,
      studentAnswer,
      studentResponse,
      conversationHistory = [],
      gradeLevel = "2nd grade",
      attemptCount,
      maxAttempts,
      followUpCount,
      lastCoachQuestion,
      askedCoachQuestions,
      timeRemainingSec,
    } = req.body as VideoTurnRequest;

    if (!lessonId || !promptId || !studentResponse) {
      return res.status(400).json({
        error: "lessonId, promptId, and studentResponse are required",
      });
    }

    const client = getClient();
    if (!client) {
      return res.json({
        response: "Great effort! Keep thinking about this.",
        shouldContinue: false,
        score: 50,
        isCorrect: false,
        probeFirst: false,
        turnKind: "WRAP",
      } as VideoTurnResponse);
    }

    // Find the lesson and prompt
    const lessons = getAllLessons();
    const lesson = lessons.find((l) => l.id === lessonId);
    if (!lesson) {
      return res.status(404).json({ error: "Lesson not found" });
    }

    const promptIndex = lesson.prompts.findIndex((p) => p.id === promptId);
    if (promptIndex === -1) {
      return res.status(404).json({ error: "Prompt not found" });
    }
    const prompt = lesson.prompts[promptIndex];
    const isFinalQuestion = promptIndex === lesson.prompts.length - 1;

    // Resolve scope ONCE for this prompt — threaded to all guardrail calls.
    // Priority: prompt.scope (authored) > cached (LLM-generated) > legacy regex
    const scope = resolvePromptScope(prompt.input, prompt.scope);

    // If no scope exists yet, kick off async LLM generation for next time.
    // This is fire-and-forget — current request uses heuristic fallback.
    if (!scope && client) {
      generatePromptScope(client, prompt.input, gradeLevel).catch(() => {});
    }

    // THE KEY OPTIMIZATION: run both LLM calls in parallel (~1.5-2s saved)
    const [feedbackResult, wordingResult] = await Promise.all([
      generateCoachFeedback(
        client,
        prompt,
        studentResponse,
        gradeLevel,
        lesson.title,
        isFinalQuestion,
        scope
      ),
      continueConversation(
        client,
        prompt,
        studentAnswer,
        studentResponse,
        conversationHistory,
        gradeLevel,
        isFinalQuestion,
        scope
      ),
    ]);

    // Extract criteria evaluation from LLM result (if assessment rubric was present)
    const criteriaEval = feedbackResult.criteriaEvaluation;

    // Apply post-evaluation guardrail (criteria-aware)
    const resolved = resolvePostEvaluation(
      feedbackResult,
      attemptCount,
      maxAttempts,
      followUpCount,
      criteriaEval?.overallStatus,
      timeRemainingSec,
    );

    // MASTERY WRAP: Student demonstrated mastery — end with submit instruction.
    const isStrongMastery = criteriaEval?.overallStatus === "strong" && feedbackResult.score >= CORRECT_THRESHOLD;
    if (isStrongMastery && !resolved.shouldContinue && !resolved.probeFirst) {
      const feedbackPrefix = wordingResult.feedback.length <= 60 && !wordingResult.feedback.includes("?")
        ? wordingResult.feedback.replace(/[.!]\s*$/, "")
        : "Nice work";
      const masteryResponse = `${feedbackPrefix}! You've met the goal. Please click Submit Response.`;
      console.log(`[mastery-wrap] criteriaStatus=strong — deterministic wrap`);
      return res.json({
        response: masteryResponse,
        shouldContinue: false,
        score: feedbackResult.score,
        isCorrect: feedbackResult.isCorrect,
        probeFirst: false,
        turnKind: "WRAP",
        coachActionTag: feedbackResult.coachActionTag,
        deferredByCoach: false,
        criteriaEvaluation: criteriaEval,
      } as VideoTurnResponse);
    }

    // Build final response text from wording result
    let response = wordingResult.followUpQuestion
      ? `${wordingResult.feedback} ${wordingResult.followUpQuestion}`
      : wordingResult.feedback;

    // If probeFirst: correct answer but coach should ask one Socratic follow-up
    if (resolved.probeFirst) {
      // If the LLM didn't include a probe (constraint violation), use deterministic fallback
      if (!response.includes("?")) {
        response = buildProbeFromQuestion(prompt.input, studentResponse, scope);
      }

      // Strip any "let's move on" language since we're continuing
      if (containsEndingLanguage(response)) {
        response = buildProbeFromQuestion(prompt.input, studentResponse, scope);
      }

      // Unified guardrails: echo + steps + scope + probe dedup
      response = enforceAllGuardrails(response, studentResponse, prompt.input, "probeFirst", scope, lastCoachQuestion, askedCoachQuestions, timeRemainingSec);

      return res.json({
        response,
        shouldContinue: true,
        score: feedbackResult.score,
        isCorrect: feedbackResult.isCorrect,
        probeFirst: true,
        turnKind: "PROBE",
        coachActionTag: feedbackResult.coachActionTag,
        deferredByCoach: false,
        criteriaEvaluation: criteriaEval,
      } as VideoTurnResponse);
    }

    // GUARDRAIL: If we're continuing but the LLM wording implies ending,
    // override with a deterministic retry prompt
    if (resolved.shouldContinue && containsEndingLanguage(response)) {
      response = buildRetryPrompt(prompt.input, attemptCount, studentResponse, scope);
    }

    // GUARDRAIL: If score < 80 but wording says "correct"/"great job"/etc,
    // override to avoid confusing the student
    if (feedbackResult.score < CORRECT_THRESHOLD && containsCorrectLanguage(response)) {
      if (resolved.shouldContinue) {
        response = "Not quite yet — give it another try. What do you think the answer is?";
      } else {
        response = "Thanks for trying — we're going to move on for now.";
      }
    }

    // UNIFIED GUARDRAILS: echo + steps + scope + probe dedup on combined response
    response = enforceAllGuardrails(response, studentResponse, prompt.input, "response", scope, lastCoachQuestion, askedCoachQuestions, timeRemainingSec);

    // NO-NEW-QUESTION WINDOW (15s <= timeRemaining < 25s):
    // Strip open-ended questions to wind down, force shouldContinue=false.
    let finalShouldContinue = resolved.shouldContinue;
    if (
      timeRemainingSec !== undefined &&
      timeRemainingSec >= SERVER_CLOSING_WINDOW_SEC &&
      timeRemainingSec < SERVER_NO_NEW_QUESTION_SEC
    ) {
      console.log(`[no-new-question] timeRemaining=${timeRemainingSec}s — stripping new questions`);
      if (response.includes("?")) {
        const sentences = response.split(/(?<=[.!?])\s+/);
        const nonQuestions = sentences.filter(s => !s.includes("?"));
        response = nonQuestions.length > 0
          ? nonQuestions.join(" ").trim()
          : "Good thinking on this!";
      }
      finalShouldContinue = false;
    }

    // CLOSING-WINDOW BACKSTOP: if client reports < 15s remaining,
    // force shouldContinue=false and strip any probing questions.
    if (
      timeRemainingSec !== undefined &&
      timeRemainingSec < SERVER_CLOSING_WINDOW_SEC
    ) {
      console.log(`[closing-window] Server backstop: timeRemaining=${timeRemainingSec}s < ${SERVER_CLOSING_WINDOW_SEC}s — forcing close`);
      finalShouldContinue = false;
      const sentences = response.split(/(?<=[.!?])\s+/);
      const nonQuestions = sentences.filter(s => !s.includes("?"));
      if (nonQuestions.length > 0) {
        response = nonQuestions.join(" ").trim();
      } else {
        response = "Great thinking on this topic!";
      }
    }

    // FINAL INVARIANT: enforce question ↔ shouldContinue contract.
    let finalResponse = response;
    const contract = enforceQuestionContinueInvariant(
      response,
      finalShouldContinue,
      undefined,
      isFinalQuestion
    );
    finalResponse = contract.response;
    finalShouldContinue = contract.shouldContinue;

    // Compute turnKind
    let turnKind: VideoTurnKind = "FEEDBACK";
    if (finalShouldContinue && finalResponse.includes("?")) {
      turnKind = "PROBE";
    } else if (!finalShouldContinue) {
      turnKind = "WRAP";
    }

    console.log(`[video-turn] turnKind=${turnKind} shouldContinue=${finalShouldContinue} timeRemaining=${timeRemainingSec}s criteriaStatus=${criteriaEval?.overallStatus ?? "none"}`);

    return res.json({
      response: finalResponse,
      shouldContinue: finalShouldContinue,
      score: feedbackResult.score,
      isCorrect: feedbackResult.isCorrect,
      probeFirst: false,
      turnKind,
      coachActionTag: feedbackResult.coachActionTag,
      deferredByCoach: wordingResult.deferredByCoach || false,
      criteriaEvaluation: criteriaEval,
    } as VideoTurnResponse);
  } catch (error) {
    console.error("Error in video-turn:", error);
    res.status(500).json({ error: "Failed to process video turn" });
  }
});

// ============================================
// POST /api/coach/session-summary
// Teacher-facing rubric-aligned summary for a single question response.
// Grounded entirely in the provided transcript — never fabricates.
// ============================================

interface SessionSummaryRequest {
  questionText: string;
  learningObjective?: string;
  successCriteria?: string[];
  conversationTurns: Array<{
    role: "coach" | "student";
    message: string;
    timestampSec?: number;
  }>;
}

interface SessionSummaryResponse {
  bullets: string[];
  overall: string;
  guardrailsVersion: string;
}

/** Bump this when changing grounding logic — logged client-side for verification. */
const SUMMARY_GUARDRAILS_VERSION = "grounding-v2";

router.post("/session-summary", async (req, res) => {
  try {
    const {
      questionText,
      learningObjective,
      successCriteria,
      conversationTurns,
    } = req.body as SessionSummaryRequest;

    if (!questionText || !conversationTurns || conversationTurns.length === 0) {
      return res.status(400).json({
        error: "questionText and conversationTurns are required",
      });
    }

    const client = getClient();
    if (!client) {
      return res.json({
        bullets: ["Student participated in a coaching conversation."],
        overall: "Unable to generate rubric-aligned summary (no AI key configured).",
        guardrailsVersion: SUMMARY_GUARDRAILS_VERSION,
      } as SessionSummaryResponse);
    }

    const result = await generateSessionSummary(
      client,
      questionText,
      conversationTurns,
      learningObjective,
      successCriteria
    );

    res.json(result);
  } catch (error) {
    console.error("Error generating session summary:", error);
    res.status(500).json({ error: "Failed to generate session summary" });
  }
});

/**
 * Generate a teacher-facing rubric-aligned summary for one question's transcript.
 *
 * Grounding contract:
 * 1. Every evidence bullet MUST reference a specific student utterance from the transcript.
 * 2. Concepts not present in student speech are NEVER mentioned.
 * 3. 2-4 evidence bullets, each citing what the student said.
 * 4. One rubric-aligned concluding sentence.
 * 5. Post-processing validates bullet content against actual student words.
 */
async function generateSessionSummary(
  client: OpenAI,
  questionText: string,
  turns: Array<{ role: "coach" | "student"; message: string; timestampSec?: number }>,
  learningObjective?: string,
  successCriteria?: string[]
): Promise<SessionSummaryResponse> {
  // Separate student utterances for grounding verification
  const studentUtterances = turns
    .filter((t) => t.role === "student")
    .map((t) => t.message.trim())
    .filter((m) => m.length > 0);

  // If no student speech at all, return honest fallback
  if (studentUtterances.length === 0) {
    return {
      bullets: ["The student did not provide any verbal response during this session."],
      overall: "No student speech was recorded — unable to evaluate against the rubric.",
      guardrailsVersion: SUMMARY_GUARDRAILS_VERSION,
    };
  }

  // Check if student said anything substantive (not just filler)
  const fillerPattern = /^(um+|uh+|hmm+|like|well|so|yeah|ok|okay|i don'?t know|idk|huh|what)[.!?,\s]*$/i;
  const substantiveUtterances = studentUtterances.filter((u) => !fillerPattern.test(u.trim()));

  if (substantiveUtterances.length === 0) {
    return {
      bullets: ["The student's responses consisted entirely of filler words or brief acknowledgments with no substantive content."],
      overall: "No rubric criteria could be evaluated — the student did not articulate any ideas about the topic.",
      guardrailsVersion: SUMMARY_GUARDRAILS_VERSION,
    };
  }

  // Format full transcript (coach + student) for context
  const transcript = turns
    .map((t) => `${t.role === "coach" ? "Coach" : "Student"}: ${t.message}`)
    .join("\n");

  // Format student-only utterances as a separate verification block
  const studentBlock = studentUtterances
    .map((u, i) => `  [S${i + 1}]: "${u}"`)
    .join("\n");

  // Build criteria context
  let criteriaBlock = "";
  if (learningObjective) {
    criteriaBlock += `\nLearning Objective: ${learningObjective}\n`;
  }
  if (successCriteria && successCriteria.length > 0) {
    criteriaBlock += `\nSuccess Criteria:\n${successCriteria.map((c, i) => `  ${i + 1}. ${c}`).join("\n")}\n`;
  }

  const systemPrompt = `You are writing a concise, evidence-based summary for a teacher reviewing a student's video response.

Question: "${questionText}"
${criteriaBlock}
=== FULL TRANSCRIPT ===

${transcript}

=== END TRANSCRIPT ===

=== STUDENT UTTERANCES (your ONLY evidence source) ===

${studentBlock}

=== END STUDENT UTTERANCES ===

=== GROUNDING RULES (MANDATORY — violations make the summary useless to the teacher) ===

RULE 1 — TRANSCRIPT ONLY: You may ONLY reference ideas that appear in the student utterances listed above. The student utterances are labeled [S1], [S2], etc. Every claim you make must trace back to one of these.

RULE 2 — NO FABRICATION: If a concept, term, or idea does NOT appear in the student's words above, you MUST NOT mention it. Do not infer, extrapolate, or assume knowledge the student did not demonstrate. If the student said nothing about a success criterion, say they did not address it — do not say they "partially" addressed it.

RULE 3 — CITE EVIDENCE: Each bullet must reference what the student specifically said. Use close paraphrase or short quotes from their actual words. Acceptable patterns:
  - 'The student stated "[close paraphrase]" [S2], showing...'
  - 'When prompted, the student explained that [specific idea from their words]'
  UNACCEPTABLE:
  - 'The student demonstrated understanding of the concept' (too vague, no evidence)
  - 'The student explored various aspects of the topic' (generic filler)

RULE 4 — BULLET COUNT: Include 2-4 evidence bullets. More bullets are appropriate when the student said substantive things across multiple turns. Fewer bullets when the student said little.

RULE 5 — OVERALL SENTENCE: End with exactly one sentence.${successCriteria?.length ? ` Map each success criterion to met/not-met based on the transcript evidence. Be specific — name which criteria were met and which were not addressed.` : ` Provide an honest assessment of what the student demonstrated.`}

RULE 6 — HONESTY: If the student gave minimal, unclear, or off-topic responses, say so directly. Teachers need accurate information, not inflated summaries. No over-praise, no condescension, no generic filler language.

=== OUTPUT FORMAT (JSON) ===

{
  "bullets": [
    "<evidence bullet citing specific student words>",
    "<evidence bullet citing specific student words>",
    "<optional 3rd bullet>",
    "<optional 4th bullet>"
  ],
  "overall": "<one sentence: rubric-aligned evaluation>"
}`;

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: "Generate the teacher-facing summary. Ground every bullet in the student utterances above." },
      ],
      temperature: 0.2, // Lower temperature for stricter grounding
      max_tokens: 400,
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response from AI");
    }

    const parsed = JSON.parse(content) as SessionSummaryResponse;

    // Validate structure
    if (!Array.isArray(parsed.bullets) || parsed.bullets.length === 0 || !parsed.overall) {
      throw new Error("Invalid summary structure");
    }

    // Clamp to 2-4 bullets
    if (parsed.bullets.length > 4) {
      parsed.bullets = parsed.bullets.slice(0, 4);
    }

    // Post-processing: verify grounding against actual student words.
    // Strip bullets that reference concepts NOT found in student speech.
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

    const studentContentWords = new Set(toContentWords(studentUtterances.join(" ")));

    // GROUNDING EXPANSION (Task 76): Allow overlap with question text and
    // learning objective — these are "on-topic" words the LLM may legitimately
    // reference even if the student didn't say the exact word.
    const promptWords = new Set(toContentWords(
      [questionText, learningObjective || ""].join(" ")
    ));
    const allowedWords = new Set([...studentContentWords, ...promptWords]);

    // FOREIGN TOPIC FILTER (Task 77): Domain keywords that signal hallucination
    // when they appear in a summary but NOT in the prompt, objective, or transcript.
    // These are concrete nouns from common elementary topics that the LLM tends
    // to confuse across sessions.
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
    // Build the set of all "in-context" words (student + prompt + objective)
    const allContextWords = new Set(toContentWords(
      [studentUtterances.join(" "), questionText, learningObjective || ""].join(" ")
    ));
    // Detect foreign keywords in LLM output
    const detectForeignKeywords = (text: string): string[] =>
      DOMAIN_KEYWORDS.filter((kw) => {
        const regex = new RegExp(`\\b${kw}\\b`, "i");
        return regex.test(text) && !allContextWords.has(kw);
      });

    const groundedBullets = parsed.bullets.filter((bullet) => {
      // FOREIGN TOPIC CHECK: reject bullets that mention off-topic domain keywords
      const foreign = detectForeignKeywords(bullet);
      if (foreign.length > 0) {
        console.log(`[summary-grounding] Rejected bullet with foreign keywords: [${foreign.join(", ")}]`);
        return false;
      }
      const bulletContentWords = toContentWords(bullet);
      if (bulletContentWords.length === 0) return true; // Purely structural bullet, keep
      // Require at least 2 substantive words OR ≥30% of the bullet's content words
      // to appear in student speech OR prompt/objective words
      const overlap = bulletContentWords.filter((w) => allowedWords.has(w)).length;
      const ratio = overlap / bulletContentWords.length;
      return overlap >= 2 || ratio >= 0.3;
    });

    // FOREIGN TOPIC CHECK on overall sentence — replace if contaminated
    const overallForeign = detectForeignKeywords(parsed.overall || "");
    if (overallForeign.length > 0) {
      console.log(`[summary-grounding] Overall sentence has foreign keywords: [${overallForeign.join(", ")}] — replacing`);
      parsed.overall = successCriteria?.length
        ? `Based on the transcript, the student addressed aspects of the rubric criteria.`
        : `The student provided ${substantiveUtterances.length} substantive response${substantiveUtterances.length !== 1 ? "s" : ""} during the session.`;
    }

    // If grounding filter removed bullets, use grounded ones (even if < 2).
    // Do NOT fall back to ungrounded originals — that defeats the purpose.
    if (groundedBullets.length > 0) {
      parsed.bullets = groundedBullets;
    } else {
      // Every bullet was ungrounded — the LLM hallucinated entirely.
      // Generate honest fallback from actual student content.
      const preview = substantiveUtterances[0].slice(0, 80);
      parsed.bullets = [
        `The student said: "${preview}${substantiveUtterances[0].length > 80 ? "..." : ""}"`,
        `${substantiveUtterances.length} substantive response${substantiveUtterances.length !== 1 ? "s were" : " was"} recorded during the session.`,
      ];
      parsed.overall = "The generated summary could not be grounded in the student's actual words. Review the transcript directly for an accurate assessment.";
    }

    // Validate the overall sentence against allowed words (student + prompt/objective)
    if (parsed.overall && groundedBullets.length > 0 && overallForeign.length === 0) {
      const overallContentWords = toContentWords(parsed.overall);
      const overallOverlap = overallContentWords.filter((w) => allowedWords.has(w)).length;
      // If the overall sentence introduces concepts not in student speech or prompt, flag it
      if (overallContentWords.length > 3 && overallOverlap === 0) {
        parsed.overall = successCriteria?.length
          ? `Based on the transcript, the student addressed ${groundedBullets.length} aspect${groundedBullets.length !== 1 ? "s" : ""} of the rubric criteria.`
          : `The student provided ${substantiveUtterances.length} substantive response${substantiveUtterances.length !== 1 ? "s" : ""} during the session.`;
      }
    }

    // Ensure at least 2 bullets
    if (parsed.bullets.length < 2) {
      parsed.bullets = parsed.bullets.slice(0, 1);
      parsed.bullets.push(
        `The student provided ${substantiveUtterances.length} substantive response${substantiveUtterances.length !== 1 ? "s" : ""} during the coaching conversation.`
      );
    }

    return { ...parsed, guardrailsVersion: SUMMARY_GUARDRAILS_VERSION };
  } catch (error) {
    console.error("Error generating session summary:", error);
    return {
      bullets: ["Student participated in a coaching conversation about this question."],
      overall: "Summary generation encountered an error. Review the transcript directly.",
      guardrailsVersion: SUMMARY_GUARDRAILS_VERSION,
    };
  }
}

export default router;
