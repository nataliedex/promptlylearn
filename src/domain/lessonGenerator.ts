import OpenAI from "openai";
import { Lesson } from "./lesson";
import { Prompt } from "./prompt";
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
- Use age-appropriate vocabulary and sentence structure
- Focus on comprehension, critical thinking, and explaining reasoning
- Include helpful hints that guide without giving away answers
- Ask "why" and "how" questions, not just "what" questions
- Create questions that encourage students to explain their thinking

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

Difficulty level: ${difficulty}
Generate exactly ${questionCount} questions with 2 hints each.

Remember: Ask questions that require students to explain their thinking, like "Why do you think..." or "How would you explain..."`;

    case "guided":
      return `Create an engaging lesson based on this educator's description:

"${content}"

Create an age-appropriate lesson for 2nd graders that addresses what the educator described.

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
  difficulty: string
): Promise<Prompt | null> {
  const client = getClient();

  if (!client) {
    return null;
  }

  const prompt = `You are adding one more question to an existing lesson.

Lesson context: ${lessonContext}

Existing questions (don't repeat these):
${existingQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n")}

Generate ONE new question that:
- Is different from the existing questions
- Fits the lesson context
- Is appropriate for 2nd graders
- Asks students to explain their thinking

Difficulty: ${difficulty}

Respond with JSON:
{
  "input": "The question text",
  "hints": ["First hint", "Second hint"]
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
