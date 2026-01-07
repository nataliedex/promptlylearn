import { Evaluator } from "./evaluator";
import { Submission } from "./submission";
import { EvaluationResult } from "./evaluation";

export class FakeEvaluator implements Evaluator {
    evaluate(submission: Submission): EvaluationResult {
        return {
            totalScore: 80,
            feedback: "Good job! Keep thinking through each step.",
            criteriaScores: [
                {criterionId: "clarity", score: 25},
                {criterionId: "originality", score: 25},
                {criterionId: "reasoning", score: 30},
            ]
        };
    }
}