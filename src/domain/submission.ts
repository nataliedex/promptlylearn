import { Prompt } from "./prompt";

export interface CoachTurn {
  role: "student" | "coach";
  message: string;
}

export interface CoachConversation {
  mode: "help" | "more";
  turns: CoachTurn[];
}

export interface PromptResponse {
  promptId: string;
  response: string;
  reflection?: string; // optional student reasoning
  hintUsed: boolean;
  helpConversation?: CoachConversation; // conversation during question
  moreConversation?: CoachConversation; // exploration after answering
}

export interface Submission {
  assignmentId: string;
  studentId: string;
  responses: PromptResponse[];
  submittedAt: Date;
}
