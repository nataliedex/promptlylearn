export interface RubricCriterion {
    id: string;
    description: string;
    maxScore: number;
  }
  
  export interface EvaluationResult {
    totalScore: number; // 0–100
    feedback: string;
    criteriaScores: {
      criterionId: string;
      score: number;
      comment?: string;
    }[];
  }