import OpenAI from "openai";
import { Lesson } from "./lesson";
import { Prompt, PromptAssessment } from "./prompt";
import { getUniqueLessonId } from "../stores/lessonStore";

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

function getSystemPrompt(gradeLevel: string): string {
  return `You are an expert education curriculum designer creating lessons for ${gradeLevel} students.

Your lessons should:
- Use age-appropriate vocabulary and sentence structure for ${gradeLevel}
- Focus on comprehension, critical thinking, and explaining reasoning
- Include helpful hints that guide without giving away answers
- Ask "why" and "how" questions, not just "what" questions
- Create questions that encourage students to explain their thinking

IMPORTANT - Lesson Title Guidelines:
- Keep titles SHORT: 6-10 words maximum
- Be specific but concise (NOT generic like "Subtraction" or "Math")
- Avoid filler phrases like "Using Strategies", "An Introduction to", "Learning About"
- Write in natural teacher language that students can understand
- Examples of GOOD titles: "Subtracting Within 10", "Daily Life in Ancient Egypt", "How Plants Make Food"
- Examples of BAD titles: "Subtraction", "Ancient Egypt", "Learning About Subtraction Using Strategies"

You MUST respond with valid JSON matching this exact structure:
{
  "title": "Lesson Title",
  "description": "A brief, engaging description of what students will learn",
  "prompts": [
    {
      "id": "q1",
      "type": "explain",
      "input": "The question text that students will see and answer",
      "hints": ["First helpful hint", "Second helpful hint"]
    }
  ]
}

Important:
- Each prompt must have exactly 2 hints
- The "type" should always be "explain"
- Questions should ask students to explain their thinking, not just give answers
- Make hints helpful but don't give away the answer`;
}

function buildUserPrompt(params: LessonParams): string {
  const { mode, content, difficulty, questionCount } = params;

  switch (mode) {
    case "book-title":
      return `Create a reading comprehension lesson based on the book "${content}".

Focus on:
- Character motivations and feelings
- Important story events and their consequences
- Themes appropriate for 2nd graders
- Making predictions and inferences

Difficulty level: ${difficulty}
Generate exactly ${questionCount} questions with 2 hints each.

Remember: Ask questions that require students to explain their thinking, like "Why do you think..." or "How did you figure out..."`;

    case "book-excerpt":
      return `Create a reading comprehension lesson based on this passage:

---
${content}
---

Focus on:
- Understanding what happened in the passage
- Character feelings and motivations
- Making inferences from the text
- Connecting ideas

Difficulty level: ${difficulty}
Generate exactly ${questionCount} questions about this text with 2 hints each.

Remember: Ask questions that require students to explain their thinking.`;

    case "pasted-text":
      return `Create a comprehension lesson based on this text:

---
${content}
---

Generate questions that test:
- Understanding of the main ideas
- Ability to make inferences
- Critical thinking and reasoning
- Connecting information

Difficulty level: ${difficulty}
Generate exactly ${questionCount} questions with 2 hints each.

Remember: Ask questions that require students to explain their thinking.`;

    case "topic":
      return `Create an educational lesson about "${content}" for 2nd grade students.

Focus on:
- Explaining key concepts in age-appropriate ways
- Making connections to things students already know
- Real-world applications and examples
- Encouraging curiosity and exploration

IMPORTANT for the title:
- Keep it SHORT (6-10 words) but specific
- Don't just use the topic name - describe what students will learn
- Avoid filler phrases like "Using Strategies" or "Learning About"
- Example: Topic "Subtraction" with objective "practice subtracting within 10" → Title: "Subtracting Within 10"

Difficulty level: ${difficulty}
Generate exactly ${questionCount} questions with 2 hints each.

Remember: Ask questions that require students to explain their thinking, like "Why do you think..." or "How would you explain..."`;

    case "guided":
      return `Create an engaging lesson based on this educator's description:

"${content}"

Create an age-appropriate lesson for 2nd graders that addresses what the educator described.

IMPORTANT for the title:
- Keep it SHORT (6-10 words) but specific
- Describe what students will actually learn or do
- Avoid filler phrases like "Using Strategies" or "An Introduction to"

Difficulty level: ${difficulty}
Generate exactly ${questionCount} questions with 2 hints each.

Remember: Ask questions that require students to explain their thinking.`;

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

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: getSystemPrompt(gradeLevel) },
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
        hints: p.hints || []
      }))
    };

    return lesson;
  } catch (error) {
    console.error("\nError generating lesson:", error);
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

  const focusLine = options?.focus
    ? `\nTeacher's requested focus: ${options.focus}\n`
    : "";
  const subjectLine = options?.subject ? `Subject: ${options.subject}` : "";
  const gradeLine = options?.gradeLevel ? `Grade level: ${options.gradeLevel}` : "";
  const metaLines = [subjectLine, gradeLine].filter(Boolean).join("\n");

  const prompt = `You are adding one more question to an existing lesson.

Lesson context: ${lessonContext}
${metaLines ? `${metaLines}\n` : ""}Difficulty: ${difficulty}

Existing questions (don't repeat these):
${existingQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n")}
${focusLine}
Generate ONE new open-ended question that:
- Is different from the existing questions above
- Matches the tone, style, and difficulty level of those existing questions
- Fits the lesson context${options?.focus ? `\n- Focuses on: ${options.focus}` : ""}
- Asks students to explain their thinking in their own words (not yes/no or fill-in-the-blank)

Include exactly 2 helpful hints that guide the student toward a good answer without giving it away.

Respond with JSON:
{
  "input": "The question text",
  "hints": ["First helpful hint", "Second helpful hint"]
}`;

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are an expert elementary education curriculum designer. Respond only with valid JSON." },
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
      hints: generated.hints || []
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
  if (gradeNum <= 2) {
    return `=== GRADE LEVEL: K-2 (EARLY ELEMENTARY) ===

LANGUAGE RULES (MANDATORY):
- Use simple, concrete language a ${gradeNum === 0 ? "kindergartner" : `${gradeNum}nd grader`} would understand
- AVOID abstract academic terms: "decision-making", "problem-solving", "analysis", "evaluate", "demonstrate understanding"
- Focus on: identifying the concept, giving a real-life example, basic explanation in own words
- Success criteria must be simple and directly observable in student speech
- Use verbs like: "say", "name", "tell", "show", "give an example", "explain in own words"
- BAD criterion: "Demonstrates understanding of subtraction's role in decision-making"
- GOOD criterion: "Gives a real-life example of when you take something away"
- BAD criterion: "Articulates the relationship between addition and subtraction"
- GOOD criterion: "Says that subtraction means taking away or removing"`;
  }

  if (gradeNum <= 5) {
    return `=== GRADE LEVEL: 3-5 (UPPER ELEMENTARY) ===

LANGUAGE RULES:
- Include reasoning clarity — students should explain "why" and "how"
- May include subject vocabulary (e.g., "numerator", "habitat", "main idea")
- Still avoid overly abstract phrasing ("metacognitive awareness", "synthesize perspectives")
- Success criteria can include: comparing, explaining steps, giving reasons, using vocabulary
- Use verbs like: "explain why", "compare", "describe how", "use the word ___ correctly", "give a reason"`;
  }

  // Grade 6+
  return `=== GRADE LEVEL: 6+ (MIDDLE SCHOOL) ===

LANGUAGE RULES:
- Can include abstraction, strategy comparison, multi-step reasoning, generalization
- May reference academic skills: "analyze", "evaluate", "compare strategies", "generalize"
- Success criteria can include: identifying patterns, defending a position, connecting concepts
- Use verbs like: "analyze", "compare and contrast", "justify", "generalize", "evaluate"`;
}

/**
 * Generate assessment & mastery metadata for a single question.
 *
 * Implements grade-tiered rubric rules:
 * - K-2: Simple, concrete, observable
 * - 3-5: Reasoning clarity, subject vocabulary
 * - 6+: Abstraction, strategy comparison, generalization
 */
export async function generateAssessmentData(
  questionText: string,
  lessonContext: string,
  options?: {
    subject?: string;
    gradeLevel?: string;
    difficulty?: string;
    lessonDescription?: string;
  }
): Promise<PromptAssessment | null> {
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

=== UNIVERSAL RULES (ALL GRADE LEVELS) ===

1. learningObjective: One concise sentence starting with a verb. Must match the grade level's language tier.
2. successCriteria: 3-5 bullets. Each must be:
   - Directly aligned to the wording of the question prompt (do NOT introduce requirements not implied in the prompt)
   - Measurable and observable in student speech (a coach listening can determine yes/no)
   - Concise (one clear expectation per bullet)
3. misconceptions: 1-3 realistic wrong ideas students at THIS grade level actually hold about this topic.
   - Must be specific to the content, not generic ("doesn't understand" is not a misconception)
4. evaluationFocus: Pick 1-3 from: "understanding", "reasoning", "evidence", "clarity", "creativity"
   - Match to what the prompt actually asks for
   - K-2 prompts rarely need "reasoning" or "evidence" — prefer "understanding" and "clarity"
   - Only include "creativity" if the prompt explicitly invites creative thinking

=== CRITICAL CONSTRAINT ===

Do NOT inflate the rubric beyond what the question asks. If the prompt says "What is subtraction?", do NOT add criteria about "real-world applications" or "multiple strategies" unless the prompt mentions those.

Respond ONLY with valid JSON.`;

  const userPrompt = `Generate assessment metadata for this question:

${metaLines ? `${metaLines}\n` : ""}Lesson context: ${lessonContext}

Question: "${questionText}"

Output JSON:
{
  "learningObjective": "One sentence: what the student should understand or demonstrate",
  "successCriteria": ["3-5 observable indicators, aligned to the prompt"],
  "misconceptions": ["1-3 realistic wrong ideas for this grade level"],
  "evaluationFocus": ["pick 1-3 from: understanding, reasoning, evidence, clarity, creativity"]
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

    // Validate and clamp successCriteria to 3-5
    let criteria = generated.successCriteria;
    if (Array.isArray(criteria)) {
      if (criteria.length > 5) criteria = criteria.slice(0, 5);
      if (criteria.length < 1) criteria = undefined;
    }

    // Validate evaluationFocus values
    const validFocus = ["understanding", "reasoning", "evidence", "clarity", "creativity"];
    let focus = generated.evaluationFocus;
    if (Array.isArray(focus)) {
      focus = focus.filter((f: string) => validFocus.includes(f));
      if (focus.length === 0) focus = undefined;
    }

    return {
      learningObjective: generated.learningObjective || undefined,
      successCriteria: criteria?.length ? criteria : undefined,
      misconceptions: generated.misconceptions?.length ? generated.misconceptions : undefined,
      evaluationFocus: focus?.length ? focus : undefined,
    };
  } catch (error) {
    console.error("Error generating assessment data:", error);
    return null;
  }
}
