import { Submission } from "./submission";
import { EvaluationResult } from "./evaluation";

export interface Evaluator {
  evaluate(submission: Submission): EvaluationResult;
}