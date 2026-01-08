import OpenAI from "openai";
import { Evaluator } from "./evaluator";
import { Submission, PromptResponse } from "./submission";
import { EvaluationResult } from "./evaluation";
import { Lesson } from "./lesson";
import { Prompt } from "./prompt";

/**
 * LLMEvaluator uses OpenAI's GPT to assess student understanding.
 *
 * Scoring criteria:
 * - understanding (0-40): Does the response show genuine understanding?
 * - reasoning (0-30): Quality of reflection/explanation of thought process
 * - clarity (0-30): Is the response clear and well-articulated?
 */
export class LLMEvaluator implements Evaluator {
  private client: OpenAI;
  private model: string;

  constructor(apiKey?: string, model: string = "gpt-4o-mini") {
    this.client = new OpenAI({
      apiKey: apiKey || process.env.OPENAI_API_KEY
    });
    this.model = model;
  }

  async evaluate(submission: Submission, lesson: Lesson): Promise<EvaluationResult> {
    const criteriaScores: { criterionId: string; score: number; comment?: string }[] = [];
    let totalScore = 0;
    const feedbackParts: string[] = [];

    // Evaluate each response
    for (const response of submission.responses) {
      const prompt = lesson.prompts.find(p => p.id === response.promptId);
      if (!prompt) continue;

      const score = await this.evaluateResponse(prompt, response);
      criteriaScores.push(score);
      totalScore += score.score;
      if (score.comment) {
        feedbackParts.push(score.comment);
      }
    }

    // Cap at 100
    if (totalScore > 100) totalScore = 100;

    return {
      totalScore,
      feedback: feedbackParts.join(" ") || "Review your responses and keep practicing!",
      criteriaScores
    };
  }

  private async evaluateResponse(
    prompt: Prompt,
    response: PromptResponse
  ): Promise<{ criterionId: string; score: number; comment?: string }> {
    const systemPrompt = `You are an educational evaluator assessing student understanding.
Your job is to evaluate whether the student genuinely understands the concept, not just whether they gave a "correct" answer.

Scoring criteria (total 100 points split across all prompts, but score this single response out of 50):
- understanding (0-25): Does the response show genuine understanding of the concept? Look for:
  - Original explanations in their own words
  - Correct use of concepts
  - Ability to connect ideas
  - RED FLAG: Copy/pasted or memorized-sounding answers without real comprehension

- reasoning (0-15): Quality of their reflection/thought process:
  - Did they explain HOW they arrived at their answer?
  - Do they show metacognition (awareness of their own thinking)?
  - Did they use hints? (slight penalty, but good reasoning can offset it)

- clarity (0-10): Is the response clear and well-articulated?
  - Organized thoughts
  - Clear communication
  - Appropriate level of detail

Return your evaluation as JSON with this exact format:
{
  "understanding": <0-25>,
  "reasoning": <0-15>,
  "clarity": <0-10>,
  "total": <sum of above, 0-50>,
  "comment": "<brief, encouraging feedback for the student>"
}

Be encouraging but honest. The goal is to help the student learn.`;

    const userPrompt = `Evaluate this student response:

PROMPT GIVEN TO STUDENT:
Type: ${prompt.type}
Question: ${prompt.input}

STUDENT'S RESPONSE:
${response.response}

STUDENT'S REFLECTION (their explanation of their thinking):
${response.reflection || "(No reflection provided)"}

HINT USED: ${response.hintUsed ? "Yes" : "No"}

Evaluate and return JSON:`;

    try {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.3, // Lower temperature for more consistent scoring
        response_format: { type: "json_object" }
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        throw new Error("No response from LLM");
      }

      const result = JSON.parse(content);

      return {
        criterionId: response.promptId,
        score: Math.min(50, Math.max(0, result.total || 0)),
        comment: result.comment || undefined
      };
    } catch (error) {
      console.error(`Error evaluating response ${response.promptId}:`, error);
      // Fallback to a neutral score if LLM fails
      return {
        criterionId: response.promptId,
        score: 25, // Middle score as fallback
        comment: "Unable to evaluate this response automatically. Please review with an instructor."
      };
    }
  }
}
