export interface EvaluationResult {
    score: number; //0-100
    feedback: string;
    strengths?: string[];
    improvements?: string[];
}