import { Prompt } from "./prompt";

export interface PromptResponse {
    promptId: string;
    response: string;
    reflection?: string; //optional student reasoning
}

export interface Submission {
    assignmentId: string;
    studentId: string; 
    responses: PromptResponse[];
    submittedAt: Date;
}