import { Evaluator } from "./evaluator";
import { PromptResponse, Submission } from "./submission";
import { EvaluationResult } from "./evaluation";
import { Lesson } from "./lesson";

/**
 * FakeEvaluator provides simple rule-based scoring for testing.
 * Use LLMEvaluator for real assessment of understanding.
 */
export class FakeEvaluator implements Evaluator {
  async evaluate(submission: Submission, lesson: Lesson): Promise<EvaluationResult> {
    let totalScore = 0;
    const criteriaScores: { criterionId: string; score: number; comment?: string }[] = [];

    submission.responses.forEach((resp: PromptResponse) => {
      // Base score per prompt
      let score = 30; // each prompt max 30 points
      let comment = "";

      if (resp.hintUsed) {
        score -= 5; // deduct points if hint used
        comment = "Hint was used, try to work independently next time.";
      } else {
        comment = "Good job!";
      }

      // Add reasoning bonus if reflection provided
      if (resp.reflection && resp.reflection.trim().length > 0) {
        score += 5; // extra points for reasoning
        comment += " Nice reasoning!";
      }

      // Clamp score to 0-30
      if (score > 30) score = 30;
      if (score < 0) score = 0;

      totalScore += score;
      criteriaScores.push({
        criterionId: resp.promptId,
        score,
        comment
      });
    });

    // Cap total score at 100
    if (totalScore > 100) totalScore = 100;

    return {
      totalScore,
      feedback: "Keep practicing! Review hints and reasoning to improve.",
      criteriaScores
    };
  }
}
