import OpenAI from "openai";
import { Lesson } from "./lesson";
import { Prompt, PromptAssessment, ConceptAnchor } from "./prompt";
import { getUniqueLessonId } from "../stores/lessonStore";
import { validateRubricForGrade, detectVagueMathCriteria } from "./rubricValidation";
import {
  serializeBlueprintsForPrompt,
  buildBlueprintAssessmentConstraints,
  getGradeBand,
  GRADE_COGNITIVE_VERBS,
  isMathComputationTopic,
  GradeBand,
} from "./blueprints";
import { MathProblem } from "./mathProblem";
import { generateMathProblemSet, detectMathSkill, buildMathReferenceFacts, buildDeterministicMathRubric } from "./mathProblemGenerator";
import { promptRequiresMathExplanation } from "./videoCoachGuardrails";

export type CreationMode = "book-title" | "book-excerpt" | "pasted-text" | "topic" | "guided";

export interface LessonParams {
  mode: CreationMode;
  content: string; // book title, excerpt, pasted text, or topic
  difficulty: "beginner" | "intermediate" | "advanced";
  questionCount: number;
  gradeLevel?: string;
}

let openaiClient: OpenAI | null = null;

function getClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }
  return openaiClient;
}

function getSystemPrompt(gradeLevel: string, gradeNum: number, subject?: string, topic?: string): string {
  const blueprintList = serializeBlueprintsForPrompt(gradeNum, subject, topic);

  return `You are an expert education curriculum designer creating lessons for ${gradeLevel} students.

=== BLUEPRINT-BASED QUESTION SYSTEM ===

Do NOT generate questions freely. Instead, select the best blueprint from the approved library and fill it with the lesson topic.

${blueprintList}

=== SPOKEN RESPONSE DESIGN ===

Questions must be answerable in 5-15 seconds of speech.
- No multi-step reasoning chains
- Prefer clear structures: "Name two X and tell one thing about each"
- The student should know exactly what to name, describe, or compare

=== LESSON TITLE GUIDELINES ===

- Keep titles SHORT: 6-10 words maximum
- Be specific but concise (NOT generic like "Subtraction" or "Math")
- Avoid filler phrases like "Using Strategies", "An Introduction to", "Learning About"
- Write in natural teacher language that students can understand
- Examples of GOOD titles: "Subtracting Within 10", "Daily Life in Ancient Egypt", "How Plants Make Food"
- Examples of BAD titles: "Subtraction", "Ancient Egypt", "Learning About Subtraction Using Strategies"

=== OUTPUT FORMAT ===

You MUST respond with valid JSON matching this exact structure:
{
  "title": "Lesson Title",
  "description": "A brief, engaging description of what students will learn",
  "prompts": [
    {
      "id": "q1",
      "type": "explain",
      "blueprintId": "the_blueprint_id_used",
      "filledSlots": { "slotName": "value" },
      "input": "The filled-in question text from the blueprint",
      "hints": ["First helpful hint", "Second helpful hint"]
    }
  ]
}

Important:
- Each prompt must use one of the approved blueprints listed above
- Each prompt must have exactly 2 hints
- The "type" should always be "explain"
- The "input" must follow the blueprint template with slots filled in
- Make hints helpful but don't give away the answer
- Use a different blueprint for each question when possible`;
}

function buildUserPrompt(params: LessonParams): string {
  const { mode, content, difficulty, questionCount } = params;
  const gradeLevel = params.gradeLevel || "2nd grade";

  const blueprintMandate = `\nIMPORTANT: Select the best blueprint from the approved list for each question. Fill the blueprint slots with topic-specific content. Use a different blueprint for each question when possible.

Difficulty level: ${difficulty}
Generate exactly ${questionCount} questions with 2 hints each.

Each question must follow a blueprint template and produce an answer that can be spoken in 5-15 seconds.`;

  switch (mode) {
    case "book-title":
      return `Create a reading comprehension lesson based on the book "${content}" for ${gradeLevel} students.

Focus on:
- Characters, events, and themes from the book
- Age-appropriate comprehension
${blueprintMandate}`;

    case "book-excerpt":
      return `Create a reading comprehension lesson based on this passage for ${gradeLevel} students:

---
${content}
---

Focus on:
- Understanding what happened in the passage
- Characters, ideas, and connections
${blueprintMandate}`;

    case "pasted-text":
      return `Create a comprehension lesson based on this text for ${gradeLevel} students:

---
${content}
---

Focus on:
- Understanding of the main ideas
- Connections and inferences
${blueprintMandate}`;

    case "topic":
      return `Create an educational lesson about "${content}" for ${gradeLevel} students.

Focus on:
- Key concepts presented in age-appropriate ways
- Concrete, real-world connections
${blueprintMandate}`;

    case "guided":
      return `Create an engaging lesson based on this educator's description for ${gradeLevel} students:

"${content}"
${blueprintMandate}`;

    default:
      throw new Error(`Unknown creation mode: ${mode}`);
  }
}

interface GeneratedLesson {
  title: string;
  description: string;
  prompts: {
    id: string;
    type: string;
    blueprintId?: string;
    filledSlots?: Record<string, string>;
    input: string;
    hints: string[];
  }[];
}

/**
 * Generate a lesson using AI based on the provided parameters
 */
export async function generateLesson(params: LessonParams): Promise<Lesson | null> {
  const client = getClient();

  if (!client) {
    console.log("\n(Lesson generation requires OPENAI_API_KEY)");
    return null;
  }

  const gradeLevel = params.gradeLevel || "2nd grade";
  const gradeNum = parseGradeNumber(gradeLevel);

  // Deterministic math path: generate the numeric problem in code,
  // then ask the LLM only for wording, hints, and blueprint selection
  const mathSkill = detectMathSkill(params.content);
  if (isMathComputationTopic(undefined, params.content) && mathSkill) {
    const gradeBand = getGradeBand(gradeNum);
    return generateDeterministicMathLesson(client, params, mathSkill, gradeBand, gradeLevel);
  }

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: getSystemPrompt(gradeLevel, gradeNum, undefined, params.content) },
        { role: "user", content: buildUserPrompt(params) }
      ],
      temperature: 0.7,
      response_format: { type: "json_object" }
    });

    const content = completion.choices[0]?.message?.content;

    if (!content) {
      console.log("\nNo response from AI. Please try again.");
      return null;
    }

    const generated: GeneratedLesson = JSON.parse(content);

    // Validate the response
    if (!generated.title || !generated.description || !generated.prompts) {
      console.log("\nAI response was incomplete. Please try again.");
      return null;
    }

    // Build the lesson with a unique ID
    const lesson: Lesson = {
      id: getUniqueLessonId(generated.title),
      title: generated.title,
      description: generated.description,
      difficulty: params.difficulty,
      gradeLevel,
      prompts: generated.prompts.map((p, index): Prompt => ({
        id: p.id || `q${index + 1}`,
        type: "explain",
        input: p.input,
        hints: p.hints || [],
        blueprintId: p.blueprintId,
        filledSlots: p.filledSlots,
      }))
    };

    return lesson;
  } catch (error) {
    console.error("\nError generating lesson:", error);
    return null;
  }
}

// ============================================================================
// Deterministic math lesson generation
// ============================================================================

function buildDeterministicMathSystemPrompt(gradeLevel: string): string {
  return `You are an expert education curriculum designer creating a math lesson for ${gradeLevel} students.

You are given pre-computed math expressions with their correct answers.
Your job is ONLY to:
1. Generate a short lesson title (6-10 words) and description
2. For each expression, write an age-appropriate question that asks the student to solve it and explain their thinking
3. For each question, write exactly 2 hints that guide without giving away the answer
4. Select the best math blueprint ID for each question

You must NOT change the math expression or the correct answer. Use the exact expression provided.

Blueprint IDs to choose from:
- math_solve_and_explain: "Solve [expression]. Tell how you got your answer."
- math_regrouping_focus: "Solve [expression]. Tell what you did when adding the ones."
- math_compare_method: "Solve [expression]. Explain how you solved it."

For regrouping problems, prefer math_regrouping_focus or math_solve_and_explain.
For non-regrouping problems, prefer math_solve_and_explain or math_compare_method.

IMPORTANT: The question text MUST contain one of these explanation phrases:
- "Tell how you got your answer"
- "Tell what you did when..."
- "Explain what you did when..."
- "Explain how you solved it"
- "Explain why you need to regroup"
Do NOT use vague phrasing like "What is the first step you used?" because the scoring system requires specific explanation keywords.

Respond with JSON.`;
}

function buildDeterministicMathUserPrompt(
  problems: MathProblem[],
  params: LessonParams,
): string {
  const problemList = problems
    .map(
      (p, i) =>
        `Problem ${i + 1}: expression="${p.expression}", correctAnswer=${p.correctAnswer}, ` +
        `requiresRegrouping=${p.requiresRegrouping}, skill="${p.skill}"` +
        (p.targetPlace ? `, targetPlace="${p.targetPlace}"` : ""),
    )
    .join("\n");

  return `Create a ${params.difficulty} difficulty lesson about "${params.content}" for ${params.gradeLevel || "2nd grade"} students.

Pre-computed problems (DO NOT change expressions or answers):
${problemList}

Output JSON:
{
  "title": "Short lesson title (6-10 words)",
  "description": "Brief engaging description",
  "prompts": [
    {
      "blueprintId": "math_solve_and_explain",
      "input": "Age-appropriate question using the exact expression",
      "hints": ["Hint 1", "Hint 2"]
    }
  ]
}`;
}

async function generateDeterministicMathLesson(
  client: OpenAI,
  params: LessonParams,
  skill: import("./mathProblem").MathProblemSkill,
  gradeBand: GradeBand,
  gradeLevel: string,
): Promise<Lesson | null> {
  const problems = generateMathProblemSet(skill, gradeBand, params.questionCount);
  if (problems.length === 0) return null;

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: buildDeterministicMathSystemPrompt(gradeLevel) },
        { role: "user", content: buildDeterministicMathUserPrompt(problems, params) },
      ],
      temperature: 0.6,
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) return null;

    const generated: GeneratedLesson = JSON.parse(content);
    if (!generated.title || !generated.prompts) return null;

    const lesson: Lesson = {
      id: `lesson-${Date.now()}`,
      title: generated.title,
      description: generated.description || params.content,
      difficulty: params.difficulty,
      gradeLevel,
      subject: "Math",
      prompts: problems.map((problem, i): Prompt => {
        const llmPrompt = generated.prompts[i] || {};
        // Ensure question text contains explanation keywords for scoring alignment
        const rawInput = llmPrompt.input || `Solve ${problem.expression}. Tell how you got your answer.`;
        const finalInput = promptRequiresMathExplanation(rawInput)
          ? rawInput
          : `${rawInput.replace(/[.!?]\s*$/, "")}. Tell how you got your answer.`;
        // Build deterministic rubric from the math problem
        const rubric = buildDeterministicMathRubric(problem);
        return {
          id: `q${i + 1}`,
          type: "explain",
          input: finalInput,
          hints: llmPrompt.hints || [],
          blueprintId: llmPrompt.blueprintId || "math_solve_and_explain",
          filledSlots: { expression: problem.expression },
          mathProblem: problem,
          assessment: {
            learningObjective: rubric.learningObjective,
            expectedReasoningSteps: rubric.expectedReasoningSteps,
            reasoningSteps: rubric.reasoningSteps,
            expectedConcepts: rubric.expectedConcepts,
            successCriteria: rubric.successCriteria,
            misconceptions: rubric.misconceptions,
            scoringLevels: rubric.scoringLevels,
            referenceFacts: rubric.referenceFacts,
            requiredExamples: rubric.requiredExamples,
            validVocabulary: rubric.validVocabulary,
          },
          allowedProbes: rubric.allowedProbes,
          retryQuestions: rubric.retryQuestions,
        };
      }),
    };

    return lesson;
  } catch (error) {
    console.error("\nError generating deterministic math lesson:", error);
    return null;
  }
}

/**
 * Generate a single additional question for an existing lesson
 */
export async function generateSingleQuestion(
  lessonContext: string,
  existingQuestions: string[],
  difficulty: string,
  options?: { focus?: string; subject?: string; gradeLevel?: string }
): Promise<Prompt | null> {
  const client = getClient();

  if (!client) {
    return null;
  }

  // Deterministic math path: generate the problem in code, ask LLM for wording only
  const mathSkill = detectMathSkill(lessonContext);
  if (mathSkill && isMathComputationTopic(options?.subject, lessonContext)) {
    const gradeNum = parseGradeNumber(options?.gradeLevel);
    const gradeBand = getGradeBand(gradeNum);
    const { generateMathProblem } = await import("./mathProblemGenerator");
    const problem = generateMathProblem(mathSkill, gradeBand);

    try {
      const completion = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: buildDeterministicMathSystemPrompt(options?.gradeLevel || "2nd grade"),
          },
          {
            role: "user",
            content: `Write ONE question for: expression="${problem.expression}", correctAnswer=${problem.correctAnswer}, requiresRegrouping=${problem.requiresRegrouping}, skill="${problem.skill}"${problem.targetPlace ? `, targetPlace="${problem.targetPlace}"` : ""}

Existing questions (don't repeat): ${existingQuestions.join("; ")}

Output JSON: { "blueprintId": "...", "input": "...", "hints": ["...", "..."] }`,
          },
        ],
        temperature: 0.6,
        response_format: { type: "json_object" },
      });

      const content = completion.choices[0]?.message?.content;
      if (content) {
        const generated = JSON.parse(content);
        const rawInput = generated.input || `Solve ${problem.expression}. Tell how you got your answer.`;
        const finalInput = promptRequiresMathExplanation(rawInput)
          ? rawInput
          : `${rawInput.replace(/[.!?]\s*$/, "")}. Tell how you got your answer.`;
        const rubric = buildDeterministicMathRubric(problem);
        return {
          id: `q${existingQuestions.length + 1}`,
          type: "explain",
          input: finalInput,
          hints: generated.hints || [],
          blueprintId: generated.blueprintId || "math_solve_and_explain",
          filledSlots: { expression: problem.expression },
          mathProblem: problem,
          assessment: {
            learningObjective: rubric.learningObjective,
            expectedReasoningSteps: rubric.expectedReasoningSteps,
            reasoningSteps: rubric.reasoningSteps,
            expectedConcepts: rubric.expectedConcepts,
            successCriteria: rubric.successCriteria,
            misconceptions: rubric.misconceptions,
            scoringLevels: rubric.scoringLevels,
            referenceFacts: rubric.referenceFacts,
            requiredExamples: rubric.requiredExamples,
            validVocabulary: rubric.validVocabulary,
          },
          allowedProbes: rubric.allowedProbes,
          retryQuestions: rubric.retryQuestions,
        };
      }
    } catch (error) {
      console.error("Error generating deterministic math question:", error);
    }

    // Fallback: return with default wording if LLM fails
    const fallbackRubric = buildDeterministicMathRubric(problem);
    return {
      id: `q${existingQuestions.length + 1}`,
      type: "explain",
      input: `Solve ${problem.expression}. Tell how you got your answer.`,
      hints: [
        "Look at each place value carefully.",
        problem.requiresRegrouping
          ? "Remember to check if you need to regroup."
          : "Start with the ones place.",
      ],
      blueprintId: "math_solve_and_explain",
      filledSlots: { expression: problem.expression },
      mathProblem: problem,
      assessment: {
        learningObjective: fallbackRubric.learningObjective,
        expectedReasoningSteps: fallbackRubric.expectedReasoningSteps,
        reasoningSteps: fallbackRubric.reasoningSteps,
        expectedConcepts: fallbackRubric.expectedConcepts,
        successCriteria: fallbackRubric.successCriteria,
        misconceptions: fallbackRubric.misconceptions,
        scoringLevels: fallbackRubric.scoringLevels,
        referenceFacts: fallbackRubric.referenceFacts,
        requiredExamples: fallbackRubric.requiredExamples,
        validVocabulary: fallbackRubric.validVocabulary,
      },
      allowedProbes: fallbackRubric.allowedProbes,
      retryQuestions: fallbackRubric.retryQuestions,
    };
  }

  const gradeNum = parseGradeNumber(options?.gradeLevel);
  const blueprintList = serializeBlueprintsForPrompt(gradeNum, options?.subject, lessonContext);
  const focusLine = options?.focus
    ? `\nTeacher's requested focus: ${options.focus}\n`
    : "";
  const subjectLine = options?.subject ? `Subject: ${options.subject}` : "";
  const gradeLine = options?.gradeLevel ? `Grade level: ${options.gradeLevel}` : "";
  const metaLines = [subjectLine, gradeLine].filter(Boolean).join("\n");

  const prompt = `You are adding one more question to an existing lesson.

${blueprintList}

SPOKEN RESPONSE DESIGN:
- Questions must be answerable in 5-15 seconds of speech
- No multi-step reasoning

Lesson context: ${lessonContext}
${metaLines ? `${metaLines}\n` : ""}Difficulty: ${difficulty}

Existing questions (don't repeat these):
${existingQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n")}
${focusLine}
Generate ONE new question that:
- Uses one of the approved blueprints listed above
- Is different from the existing questions above
- Uses a different blueprint than existing questions when possible
- Fits the lesson context${options?.focus ? `\n- Focuses on: ${options.focus}` : ""}

Include exactly 2 helpful hints that guide the student toward a good answer without giving it away.

Respond with JSON:
{
  "blueprintId": "the_blueprint_id_used",
  "filledSlots": { "slotName": "value" },
  "input": "The filled-in question text from the blueprint",
  "hints": ["First helpful hint", "Second helpful hint"]
}`;

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are an expert elementary education curriculum designer. You MUST select a question from the approved blueprint list. Respond only with valid JSON." },
        { role: "user", content: prompt }
      ],
      temperature: 0.7,
      response_format: { type: "json_object" }
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) return null;

    const generated = JSON.parse(content);

    return {
      id: `q${existingQuestions.length + 1}`,
      type: "explain",
      input: generated.input,
      hints: generated.hints || [],
      blueprintId: generated.blueprintId,
      filledSlots: generated.filledSlots,
    };
  } catch (error) {
    console.error("Error generating question:", error);
    return null;
  }
}

/**
 * Parse a grade-level string to a numeric value for tiered rubric rules.
 * "K" → 0, "1st" → 1, "2nd" → 2, ..., "8th" → 8
 * Falls back to 2 if unparseable (safe default for elementary).
 */
function parseGradeNumber(gradeLevel?: string): number {
  if (!gradeLevel) return 2;
  const normalized = gradeLevel.toLowerCase().trim();
  if (normalized === "k" || normalized === "kindergarten") return 0;
  const match = normalized.match(/^(\d+)/);
  if (match) return parseInt(match[1], 10);
  // Try "2nd grade", "grade 3" patterns
  const gradeMatch = normalized.match(/grade\s*(\d+)/);
  if (gradeMatch) return parseInt(gradeMatch[1], 10);
  return 2; // Safe elementary default
}

/**
 * Build grade-tiered rubric guidelines for the assessment prompt.
 */
function buildGradeGuidelines(gradeNum: number): string {
  if (gradeNum <= 1) {
    return `=== GRADE LEVEL: K-1 (EARLY ELEMENTARY) ===

LANGUAGE RULES (MANDATORY):
- Use simple, concrete language a ${gradeNum === 0 ? "kindergartner" : "1st grader"} would understand
- Success criteria must be simple observable actions (1 sentence each, max)
- Focus on: naming the concept, giving a concrete example, basic explanation in own words
- Use verbs like: "says", "names", "tells", "shows", "gives an example"

GOOD criteria examples:
- "Says what subtraction means"
- "Gives one example of when you take something away"
- "Names the shape correctly"

BAD criteria examples (DO NOT USE):
- "Demonstrates understanding of subtraction's role in problem-solving" (too abstract)
- "Articulates the relationship between addition and subtraction" (too academic)
- "Applies the concept to novel situations" (too advanced)

FORBIDDEN TERMS (never use these for K-1):
- "decision-making", "problem-solving", "analysis", "evaluate", "demonstrate understanding"
- "associative property", "distributive property", "commutative property"
- "algebraic thinking", "number theory", "proof", "theorem"
- "articulate", "synthesize", "metacognitive"

MATH ACCURACY RULE:
- Subtraction and division are NOT commutative — never say "order doesn't matter" for these operations
- Only addition and multiplication are commutative`;
  }

  if (gradeNum <= 3) {
    return `=== GRADE LEVEL: 2-3 (LOWER ELEMENTARY) ===

LANGUAGE RULES (MANDATORY):
- Use simple language with basic reasoning — students can explain "why" with concrete examples
- Success criteria should focus on: giving reasons, real-world connections, using grade vocabulary
- Use verbs like: "explains why", "gives an example", "tells how", "shows with an example"

GOOD criteria examples:
- "Explains why you regroup when adding"
- "Gives a real-life example of subtraction"
- "Uses the correct place value words (tens, ones)"

BAD criteria examples (DO NOT USE):
- "Applies the associative property to multi-digit operations" (too advanced)
- "Demonstrates problem-solving strategies" (too abstract)
- "Synthesizes multiple approaches" (too academic)

FORBIDDEN TERMS (never use these for grade 2-3):
- "associative property", "distributive property", "commutative property"
- "algebraic thinking", "algebraic reasoning", "number theory"
- "proof", "theorem", "metacognitive", "synthesize"

MATH ACCURACY RULE:
- Subtraction and division are NOT commutative — never say "order doesn't matter" for these operations
- Only addition and multiplication are commutative`;
  }

  if (gradeNum <= 5) {
    return `=== GRADE LEVEL: 4-5 (UPPER ELEMENTARY) ===

LANGUAGE RULES:
- Include reasoning clarity — students should explain "why" and "how"
- May include subject vocabulary (e.g., "numerator", "habitat", "main idea")
- Success criteria can include: comparing strategies, explaining steps, giving reasons, using vocabulary
- Use verbs like: "explain why", "compare", "describe how", "use the word ___ correctly", "give a reason"

GOOD criteria examples:
- "Compares two strategies for dividing"
- "Uses the word 'equivalent' correctly"
- "Explains the steps to solve a multi-step problem"

BAD criteria examples (DO NOT USE):
- "Synthesizes multiple mathematical principles" (too abstract)
- "Constructs a formal proof" (too advanced)

FORBIDDEN TERMS (never use these for grade 4-5):
- "formal proof", "axiomatic", "set theory"
- "synthesizes multiple principles"

MATH ACCURACY RULE:
- Subtraction and division are NOT commutative — never say "order doesn't matter" for these operations`;
  }

  // Grade 6+
  return `=== GRADE LEVEL: 6+ (MIDDLE SCHOOL) ===

LANGUAGE RULES:
- Can include abstraction, strategy comparison, multi-step reasoning, generalization
- May reference academic skills: "analyze", "evaluate", "compare strategies", "generalize"
- Success criteria can include: identifying patterns, defending a position, connecting concepts
- Use verbs like: "analyze", "compare and contrast", "justify", "generalize", "evaluate"

MATH ACCURACY RULE:
- Subtraction and division are NOT commutative — never say "order doesn't matter" for these operations`;
}

/**
 * Generate assessment & mastery metadata for a single question.
 *
 * Implements grade-tiered rubric rules:
 * - K-2: Simple, concrete, observable
 * - 3-5: Reasoning clarity, subject vocabulary
 * - 6+: Abstraction, strategy comparison, generalization
 */
/** Result from assessment generation: assessment data + coaching probes + concept anchor. */
export interface AssessmentResult {
  assessment: PromptAssessment;
  allowedProbes: string[];
  retryQuestions: string[];
  conceptAnchor?: ConceptAnchor;
}

export async function generateAssessmentData(
  questionText: string,
  lessonContext: string,
  options?: {
    subject?: string;
    gradeLevel?: string;
    difficulty?: string;
    lessonDescription?: string;
    blueprintId?: string;
    filledSlots?: Record<string, string>;
  }
): Promise<AssessmentResult | null> {
  const client = getClient();
  if (!client) return null;

  const gradeNum = parseGradeNumber(options?.gradeLevel);
  const gradeGuidelines = buildGradeGuidelines(gradeNum);

  const metaLines = [
    options?.subject ? `Subject: ${options.subject}` : "",
    options?.gradeLevel ? `Grade level: ${options.gradeLevel}` : "",
    options?.difficulty ? `Difficulty: ${options.difficulty}` : "",
    options?.lessonDescription ? `Lesson description: ${options.lessonDescription}` : "",
  ].filter(Boolean).join("\n");

  const systemPrompt = `You are an expert K-8 curriculum assessment designer specializing in developmentally appropriate rubrics.

Your rubrics will be used by an AI coach to evaluate student video responses in real-time. Criteria must be observable in spoken student answers — not written work, not tests.

${gradeGuidelines}

=== UNIVERSAL RUBRIC TEMPLATE (ALL GRADE LEVELS) ===

Every rubric MUST include these sections:

1. learningObjective: One concise sentence.
   Format: "Explain how to [specific skill] by [specific method]."

2. expectedReasoningSteps: ORDERED list of atomic reasoning steps.
   - Must represent the exact reasoning path the student should demonstrate.
   - Coaching uses these to identify the NEXT missing step.
   - Each step = one checkable action.

3. expectedConcepts: 2-4 teacher-readable concepts, still concrete.
   - Each must be directly aligned to the wording of the question prompt.
   - A distinct, testable idea (a coach listening can determine yes/no).
   - For math, include actual numbers where relevant.

4. requiredExamples: One sentence describing the minimum evidence needed for mastery.
   - Must define WHAT and HOW MANY examples are required.

5. validVocabulary: 5-10 domain vocabulary words or short phrases.
   - Must be age-appropriate for the grade level.

6. successCriteria: ATOMIC, specific, observable.
   - ONE fact or step per criterion.
   - Each criterion must contain only one checkable idea.
   - NEVER use vague criteria like "Explains how to add two-digit numbers" or "Shows understanding."
   - ALWAYS use specific criteria like "States that 4 + 2 = 6" or "Names the ones digits as 4 and 2."

7. misconceptions: 1-3 concrete, likely wrong ideas.
   - Must be specific to the content, not generic.
   - For math, include common wrong answers with likely reasoning errors.
   - GOOD: "Says 34 because the ones were not added correctly"
   - BAD: "Doesn't understand addition"

8. scoringLevels: Three rule-based proficiency tiers:
   - strong: ALL core required evidence demonstrated. Reference actual criteria.
   - developing: Partial but meaningful progress. Name the specific gap.
   - needsSupport: Incorrect, unrelated, or missing core reasoning.

9. evaluationFocus: Pick 1-3 from: "understanding", "reasoning", "evidence", "clarity", "creativity"

10. allowedProbes: 3-5 follow-up questions TIED TO MISSING REASONING STEPS.
    - Each probe must target ONE specific missing step from expectedReasoningSteps.
    - NEVER use generic probes like "Tell me more" or "What else do you know?"
    - GOOD: "What do you get when you add 4 and 2?"
    - BAD: "Can you explain further?"

11. retryQuestions: 2-3 more supportive versions of allowedProbes for stuck students.
    - GOOD: "Can you start with the ones digits, 4 and 2?"
    - BAD: "Think harder about the problem."

12. requiredEvidence (OPTIONAL — only when the question asks for named examples with attributes):
    - minEntities, entityLabel, attributeLabel, minAttributeTypes, requirePairing

13. referenceFacts: Factual ground truth for deterministic validation.
    - For math: include operand place values and correct answer.
    - For science/ELA: map entities to acceptable attributes.

14. conceptAnchor: Hidden concept anchoring data.
    - anchorSentence, coreConcepts, allowedEntities, allowedAttributes, offTopicConcepts

=== CORE DESIGN RULES ===

RULE 1: RUBRIC MUST MATCH THE QUESTION
- The rubric must NEVER require more than the question asks for.
- If the rubric requires 2 examples, the question must explicitly ask for 2.
- Do NOT inflate the rubric beyond what the question asks.

RULE 2: SUCCESS CRITERIA MUST BE ATOMIC
- Each criterion = ONE checkable idea.
- BAD: "Explains how to add two-digit numbers" (not specific)
- GOOD: "States that 4 + 2 = 6" (one checkable fact)

RULE 3: REASONING STEPS MUST BE ORDERED
- Steps must reflect the exact reasoning path.
- Coaching identifies the next missing step and asks about it.

RULE 4: FOLLOW-UP PROBES MUST MAP TO MISSING STEPS
- Each probe targets one specific missing reasoning step.

=== MATH-SPECIFIC REQUIREMENTS ===

For elementary math explanation prompts:
A. Include ACTUAL NUMBERS from the problem in expectedReasoningSteps, expectedConcepts, successCriteria, misconceptions, and scoringLevels.
B. NEVER use generic math language when the problem has specific numbers.
   BAD: "Explains how to add the ones together"
   GOOD: "Explains that 4 + 2 = 6"
C. Success criteria must explicitly name the final correct answer.
   GOOD: "States that the final answer is 36"
D. Misconceptions must include likely wrong outputs with reasoning.
   GOOD: "Says 34 because the ones were not added correctly"
E. Follow-up probes must map to the exact missing step with numbers.
   GOOD: "What do you get when you add 4 and 2?"

${options?.blueprintId ? buildBlueprintAssessmentConstraints(options.blueprintId, options.filledSlots) : ""}
=== BANNED VAGUE PHRASES (NEVER USE IN CRITERIA) ===

Success criteria, expected concepts, and scoring levels must describe observable evidence.

NEVER use these vague phrases:
- "clear understanding" / "demonstrates understanding" / "shows understanding"
- "strong explanation" / "good explanation" / "explains clearly"
- "demonstrates knowledge" / "shows knowledge"
- "uses correct vocabulary" (instead: name the specific words)
- "provides a clear step-by-step" (instead: name the specific steps)
- "all key concepts" / "key ideas" (instead: list the actual concepts)
- "explains how to add the ones" (instead: "explains that 4 + 2 = 6")
- "explains how to add the tens" (instead: "explains that 20 + 10 = 30")
- "includes all steps" / "shows all work"
- "explains regrouping" (instead: "explains that carrying 1 ten from 14...")

GOOD criteria (observable):
- "Says that Earth is made of rock and metal."
- "Names at least two planets."
- "States that 4 + 2 = 6."
- "States that the final answer is 36."

BAD criteria (vague):
- "Explains what planets are made of." (what specifically?)
- "Explains how to add two-digit numbers." (which numbers?)
- "Shows understanding of addition." (how would you observe this?)

Respond ONLY with valid JSON.`;

  const userPrompt = `Generate assessment metadata for this question:

${metaLines ? `${metaLines}\n` : ""}Lesson context: ${lessonContext}

Question: "${questionText}"

Output JSON:
{
  "learningObjective": "Explain how to [specific skill] by [specific method].",
  "expectedReasoningSteps": ["Step 1: atomic reasoning step", "Step 2: next step", "...ordered steps"],
  "expectedConcepts": ["2-4 concrete key ideas with actual numbers/specifics"],
  "successCriteria": ["Atomic criterion 1 (one checkable fact)", "Atomic criterion 2"],
  "requiredExamples": "One sentence: minimum evidence needed for mastery (what and how many examples)",
  "validVocabulary": ["5-10 domain vocabulary words or phrases"],
  "misconceptions": ["Concrete wrong answer with reasoning (e.g., 'Says 34 because...')"],
  "scoringLevels": {
    "strong": "References actual criteria: 'Explains that X, states that Y, and gives answer Z.'",
    "developing": "Names specific gap: 'Gives correct answer but misses step X.'",
    "needsSupport": "Incorrect, unrelated, or missing core reasoning."
  },
  "evaluationFocus": ["pick 1-3 from: understanding, reasoning, evidence, clarity, creativity"],
  "requiredEvidence": "(OPTIONAL) { \"minEntities\": 2, \"entityLabel\": \"entity type\", \"attributeLabel\": \"attribute type\", \"minAttributeTypes\": 2, \"requirePairing\": true }",
  "referenceFacts": "{ \"key\": [\"fact1\", \"fact2\"] } — ground truth for validation",
  "allowedProbes": ["3-5 follow-up questions tied to specific missing reasoning steps"],
  "retryQuestions": ["2-3 supportive retry questions for stuck students"],
  "conceptAnchor": {
    "anchorSentence": "One sentence: what this question is about",
    "coreConcepts": ["2-5 short concept phrases"],
    "allowedEntities": ["specific objects/nouns for this question"],
    "allowedAttributes": ["specific properties/materials/categories"],
    "offTopicConcepts": ["3-8 nearby but out-of-scope concepts to avoid"]
  }
}`;

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.4,
      response_format: { type: "json_object" }
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) return null;

    const generated = JSON.parse(content);

    // Validate expectedReasoningSteps (ordered list)
    let expectedReasoningSteps = generated.expectedReasoningSteps;
    if (Array.isArray(expectedReasoningSteps)) {
      expectedReasoningSteps = expectedReasoningSteps
        .filter((s: unknown) => typeof s === "string" && (s as string).trim())
        .map((s: string) => s.trim());
      if (expectedReasoningSteps.length < 1) expectedReasoningSteps = undefined;
    } else {
      expectedReasoningSteps = undefined;
    }

    // Validate and clamp expectedConcepts to 2-4
    let expectedConcepts = generated.expectedConcepts;
    if (Array.isArray(expectedConcepts)) {
      if (expectedConcepts.length > 4) expectedConcepts = expectedConcepts.slice(0, 4);
      if (expectedConcepts.length < 1) expectedConcepts = undefined;
    } else {
      expectedConcepts = undefined;
    }

    // Validate requiredExamples
    const requiredExamples = typeof generated.requiredExamples === "string" && generated.requiredExamples.trim()
      ? generated.requiredExamples.trim()
      : undefined;

    // Validate and clamp validVocabulary to 3-10
    let validVocabulary = generated.validVocabulary;
    if (Array.isArray(validVocabulary)) {
      validVocabulary = validVocabulary.filter((v: unknown) => typeof v === "string" && v.trim());
      if (validVocabulary.length > 10) validVocabulary = validVocabulary.slice(0, 10);
      if (validVocabulary.length < 1) validVocabulary = undefined;
    } else {
      validVocabulary = undefined;
    }

    // Validate scoringLevels
    let scoringLevels = generated.scoringLevels;
    if (
      scoringLevels &&
      typeof scoringLevels === "object" &&
      typeof scoringLevels.strong === "string" && scoringLevels.strong.trim() &&
      typeof scoringLevels.developing === "string" && scoringLevels.developing.trim() &&
      typeof scoringLevels.needsSupport === "string" && scoringLevels.needsSupport.trim()
    ) {
      scoringLevels = {
        strong: scoringLevels.strong.trim(),
        developing: scoringLevels.developing.trim(),
        needsSupport: scoringLevels.needsSupport.trim(),
      };
    } else {
      scoringLevels = undefined;
    }

    // Auto-derive successCriteria from expectedConcepts + requiredExamples
    let criteria = generated.successCriteria;
    if (Array.isArray(criteria)) {
      if (criteria.length > 5) criteria = criteria.slice(0, 5);
      if (criteria.length < 1) criteria = undefined;
    }
    if (!criteria?.length) {
      const derived: string[] = [];
      if (expectedConcepts?.length) derived.push(...expectedConcepts);
      if (requiredExamples) derived.push(requiredExamples);
      if (derived.length > 0) criteria = derived;
    }

    // Validate evaluationFocus values
    const validFocus = ["understanding", "reasoning", "evidence", "clarity", "creativity"];
    let focus = generated.evaluationFocus;
    if (Array.isArray(focus)) {
      focus = focus.filter((f: string) => validFocus.includes(f));
      if (focus.length === 0) focus = undefined;
    }

    // Validate requiredEvidence (optional)
    let requiredEvidence = generated.requiredEvidence;
    if (requiredEvidence && typeof requiredEvidence === "object" && !Array.isArray(requiredEvidence)) {
      if (
        typeof requiredEvidence.minEntities !== "number" || requiredEvidence.minEntities < 1 ||
        typeof requiredEvidence.entityLabel !== "string" || !requiredEvidence.entityLabel.trim() ||
        typeof requiredEvidence.attributeLabel !== "string" || !requiredEvidence.attributeLabel.trim()
      ) {
        requiredEvidence = undefined;
      } else {
        requiredEvidence = {
          minEntities: Math.min(requiredEvidence.minEntities, 5),
          entityLabel: requiredEvidence.entityLabel.trim(),
          attributeLabel: requiredEvidence.attributeLabel.trim(),
          ...(typeof requiredEvidence.minAttributeTypes === "number"
            ? { minAttributeTypes: Math.min(requiredEvidence.minAttributeTypes, 5) }
            : {}),
          requirePairing: requiredEvidence.requirePairing !== false,
        };
      }
    } else {
      requiredEvidence = undefined;
    }

    // Validate referenceFacts (optional)
    let referenceFacts = generated.referenceFacts;
    if (referenceFacts && typeof referenceFacts === "object" && !Array.isArray(referenceFacts)) {
      const cleaned: Record<string, string[]> = {};
      for (const [key, val] of Object.entries(referenceFacts)) {
        if (Array.isArray(val) && val.every((v: unknown) => typeof v === "string")) {
          cleaned[key] = val as string[];
        }
      }
      referenceFacts = Object.keys(cleaned).length > 0 ? cleaned : undefined;
    } else {
      referenceFacts = undefined;
    }

    // requiredEvidence without referenceFacts is useless — drop both if either is missing
    if (requiredEvidence && !referenceFacts) requiredEvidence = undefined;
    if (referenceFacts && !requiredEvidence) referenceFacts = undefined;

    // Validate allowedProbes (3-5 short probe questions)
    let allowedProbes: string[] = [];
    if (Array.isArray(generated.allowedProbes)) {
      allowedProbes = generated.allowedProbes
        .filter((p: unknown) => typeof p === "string" && (p as string).trim())
        .map((p: string) => p.trim())
        .slice(0, 5);
    }

    // Validate retryQuestions (2-3 retry questions)
    let retryQuestions: string[] = [];
    if (Array.isArray(generated.retryQuestions)) {
      retryQuestions = generated.retryQuestions
        .filter((q: unknown) => typeof q === "string" && (q as string).trim())
        .map((q: string) => q.trim())
        .slice(0, 3);
    }

    // Validate conceptAnchor (hidden concept anchoring data)
    let conceptAnchor: ConceptAnchor | undefined;
    if (generated.conceptAnchor && typeof generated.conceptAnchor === "object") {
      const raw = generated.conceptAnchor;
      const anchorSentence = typeof raw.anchorSentence === "string" ? raw.anchorSentence.trim() : "";
      const coreConcepts = Array.isArray(raw.coreConcepts)
        ? raw.coreConcepts.filter((c: unknown) => typeof c === "string" && (c as string).trim()).map((c: string) => c.trim().toLowerCase()).slice(0, 5)
        : [];
      const allowedEntities = Array.isArray(raw.allowedEntities)
        ? raw.allowedEntities.filter((e: unknown) => typeof e === "string" && (e as string).trim()).map((e: string) => e.trim().toLowerCase()).slice(0, 10)
        : [];
      const allowedAttributes = Array.isArray(raw.allowedAttributes)
        ? raw.allowedAttributes.filter((a: unknown) => typeof a === "string" && (a as string).trim()).map((a: string) => a.trim().toLowerCase()).slice(0, 15)
        : [];
      const offTopicConcepts = Array.isArray(raw.offTopicConcepts)
        ? raw.offTopicConcepts.filter((o: unknown) => typeof o === "string" && (o as string).trim()).map((o: string) => o.trim().toLowerCase()).slice(0, 8)
        : [];

      if (anchorSentence && coreConcepts.length >= 2 && allowedEntities.length >= 1) {
        conceptAnchor = { anchorSentence, coreConcepts, allowedEntities, allowedAttributes, offTopicConcepts };
      }
    }

    const rawAssessment: PromptAssessment = {
      learningObjective: generated.learningObjective || undefined,
      expectedReasoningSteps: expectedReasoningSteps?.length ? expectedReasoningSteps : undefined,
      expectedConcepts: expectedConcepts?.length ? expectedConcepts : undefined,
      requiredExamples,
      validVocabulary: validVocabulary?.length ? validVocabulary : undefined,
      misconceptions: generated.misconceptions?.length ? generated.misconceptions : undefined,
      scoringLevels,
      successCriteria: criteria?.length ? criteria : undefined,
      evaluationFocus: focus?.length ? focus : undefined,
      requiredEvidence,
      referenceFacts,
    };

    // Post-generation grade-appropriateness validation
    const { assessment: validated, flagged, wasModified } = validateRubricForGrade(
      rawAssessment,
      options?.gradeLevel
    );

    if (wasModified && flagged.length > 0) {
      console.log(`[rubric-validation] Fixed ${flagged.length} grade-inappropriate term(s) for ${options?.gradeLevel || "unknown grade"}:`);
      flagged.forEach(f => console.log(`  - ${f.field}: "${f.term}" — ${f.reason}`));
    }

    // Math-specific vague criteria validation: reject generic math language
    const isMathQuestion = options?.subject?.toLowerCase() === "math" ||
      /\d+\s*[+\-×x*]\s*\d+/.test(questionText);
    if (isMathQuestion) {
      if (validated.successCriteria) {
        validated.successCriteria = validated.successCriteria.filter(c => {
          const vague = detectVagueMathCriteria(c);
          if (vague) {
            console.log(`[rubric-validation] Removed vague math criterion: "${c}" (matched: "${vague}")`);
          }
          return !vague;
        });
        if (validated.successCriteria.length === 0) validated.successCriteria = undefined;
      }
      if (validated.expectedConcepts) {
        validated.expectedConcepts = validated.expectedConcepts.filter(c => {
          const vague = detectVagueMathCriteria(c);
          if (vague) {
            console.log(`[rubric-validation] Removed vague math concept: "${c}" (matched: "${vague}")`);
          }
          return !vague;
        });
        if (validated.expectedConcepts.length === 0) validated.expectedConcepts = undefined;
      }
    }

    return { assessment: validated, allowedProbes, retryQuestions, conceptAnchor };
  } catch (error) {
    console.error("Error generating assessment data:", error);
    return null;
  }
}

// ============================================================================
// Generate Question Package — question + hints + assessment in one call
// ============================================================================

export interface QuestionPackageInput {
  questionText: string;
  lessonContext: string;
  gradeLevel?: string;
  subject?: string;
  difficulty?: string;
  lessonDescription?: string;
  existingQuestions?: string[];
  blueprintId?: string;
  filledSlots?: Record<string, string>;
  regenerate: {
    question: boolean;
    hints: boolean;
    mastery: boolean;
  };
}

export interface QuestionPackage {
  questionText: string;
  hints: string[];
  learningObjective?: string;
  successCriteria?: string[];
  misconceptions?: string[];
  evaluationFocus?: string[];
  allowedProbes?: string[];
  retryQuestions?: string[];
  conceptAnchor?: ConceptAnchor;
}

/**
 * Generate a complete "question package" — question text, hints, and assessment.
 * Composes existing generation functions. Selectively regenerates fields based
 * on the `regenerate` flags.
 */
export async function generateQuestionPackage(
  input: QuestionPackageInput
): Promise<QuestionPackage | null> {
  const client = getClient();
  if (!client) return null;

  let questionText = input.questionText;
  let hints: string[] = [];

  let blueprintId = input.blueprintId;
  let filledSlots = input.filledSlots;

  // --- Regenerate question text (+ hints come free with a new question) ---
  if (input.regenerate.question) {
    const newPrompt = await generateSingleQuestion(
      input.lessonContext,
      input.existingQuestions || [],
      input.difficulty || "intermediate",
      {
        subject: input.subject,
        gradeLevel: input.gradeLevel,
      }
    );
    if (!newPrompt) return null;
    questionText = newPrompt.input;
    hints = newPrompt.hints || [];
    blueprintId = newPrompt.blueprintId;
    filledSlots = newPrompt.filledSlots;
  }

  // --- Regenerate hints only (when question didn't change but hints need refresh) ---
  if (!input.regenerate.question && input.regenerate.hints) {
    const generated = await generateHintsForQuestion(client, questionText, input);
    if (generated) hints = generated;
  }

  // If we didn't regenerate hints at all, return empty (caller keeps existing)
  if (!input.regenerate.question && !input.regenerate.hints) {
    hints = [];
  }

  // --- Regenerate assessment/mastery ---
  let assessmentResult: AssessmentResult | null = null;
  if (input.regenerate.mastery) {
    assessmentResult = await generateAssessmentData(
      questionText,
      input.lessonContext,
      {
        subject: input.subject,
        gradeLevel: input.gradeLevel,
        difficulty: input.difficulty,
        lessonDescription: input.lessonDescription,
        blueprintId,
        filledSlots,
      }
    );
  }

  return {
    questionText,
    hints,
    learningObjective: assessmentResult?.assessment.learningObjective,
    successCriteria: assessmentResult?.assessment.successCriteria,
    misconceptions: assessmentResult?.assessment.misconceptions,
    evaluationFocus: assessmentResult?.assessment.evaluationFocus,
    allowedProbes: assessmentResult?.allowedProbes,
    retryQuestions: assessmentResult?.retryQuestions,
    conceptAnchor: assessmentResult?.conceptAnchor,
  };
}

/**
 * Generate fresh hints for an existing question text.
 */
async function generateHintsForQuestion(
  client: OpenAI,
  questionText: string,
  input: QuestionPackageInput
): Promise<string[] | null> {
  const metaLines = [
    input.subject ? `Subject: ${input.subject}` : "",
    input.gradeLevel ? `Grade level: ${input.gradeLevel}` : "",
    input.difficulty ? `Difficulty: ${input.difficulty}` : "",
  ].filter(Boolean).join("\n");

  const prompt = `Generate exactly 2 helpful hints for this student question.

${metaLines ? `${metaLines}\n` : ""}Lesson context: ${input.lessonContext}

Question: "${questionText}"

Hints should:
- Guide the student toward a good answer without giving it away
- Be age-appropriate for ${input.gradeLevel || "elementary"} students
- Progress from a gentle nudge to more specific guidance

Respond with JSON:
{ "hints": ["First helpful hint", "Second helpful hint"] }`;

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are an expert elementary education curriculum designer. Respond only with valid JSON." },
        { role: "user", content: prompt }
      ],
      temperature: 0.6,
      response_format: { type: "json_object" }
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) return null;

    const generated = JSON.parse(content);
    return generated.hints || null;
  } catch (error) {
    console.error("Error generating hints:", error);
    return null;
  }
}
