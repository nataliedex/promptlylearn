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
    const gradeLevel = lesson.gradeLevel || "2nd grade"; // Default for backwards compatibility

    // Evaluate each response
    for (const response of submission.responses) {
      const prompt = lesson.prompts.find(p => p.id === response.promptId);
      if (!prompt) continue;

      const score = await this.evaluateResponse(prompt, response, gradeLevel);
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
    response: PromptResponse,
    gradeLevel: string
  ): Promise<{ criterionId: string; score: number; comment?: string }> {
    const systemPrompt = `You are a warm, encouraging coach giving feedback to a ${gradeLevel} student.

Your job is to evaluate whether the student genuinely understands the concept and provide age-appropriate feedback.

Scoring criteria (score this response out of 50):
- understanding (0-25): Does the response show genuine understanding?
- reasoning (0-15): Did they explain their thinking?
- clarity (0-10): Is the response clear?

CRITICAL - Your feedback comment MUST be:
- Written for the student's grade level (use age-appropriate language)
- Short (1-2 simple sentences)
- Warm and encouraging, like a kind teacher
- Use simple words they would understand
- Celebrate what they did well FIRST
- If something needs work, phrase it as an encouraging question or gentle suggestion

GOOD feedback examples:
- "Great job thinking about how Sam felt! You really understood the story."
- "You explained your thinking so well! I love how you used the clues from the story."
- "Nice work! What do you think happened next?"
- "You're on the right track! Can you tell me more about why you think that?"

BAD feedback (NEVER say things like):
- "Your response lacks detail" (too academic)
- "Try to elaborate on..." (too formal)
- "Your response is quite brief" (discouraging)
- "Include specific clues to strengthen your explanation" (too complex)

Return your evaluation as JSON:
{
  "understanding": <0-25>,
  "reasoning": <0-15>,
  "clarity": <0-10>,
  "total": <sum of above, 0-50>,
  "comment": "<warm, simple feedback appropriate for the student's grade level>"
}`;

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
