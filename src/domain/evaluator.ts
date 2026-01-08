import { Submission } from "./submission";
import { EvaluationResult } from "./evaluation";
import { Lesson } from "./lesson";

export interface Evaluator {
  /**
   * Evaluate a student's submission.
   * Takes the lesson for context (to know what prompts were asked).
   * Returns a promise since real evaluators may call external APIs.
   */
  evaluate(submission: Submission, lesson: Lesson): Promise<EvaluationResult>;
}
