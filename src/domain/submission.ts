import { Prompt } from "./prompt";

export interface CoachTurn {
  role: "student" | "coach";
  message: string;
}

export interface CoachConversation {
  mode: "help" | "more";
  turns: CoachTurn[];
  finalAnswer?: string; // The answer worked out during help conversation
}

export interface PromptResponse {
  promptId: string;
  response: string;
  reflection?: string; // optional student reasoning
  elaborations?: string[]; // additional details from coach follow-up questions
  hintUsed: boolean;
  inputSource?: "typed" | "voice"; // how the response was provided
  audioPath?: string; // path to saved audio recording (if voice input)
  audioBase64?: string; // base64 encoded audio data (for web playback)
  audioFormat?: string; // audio format (webm, mp4, etc.)
  reflectionAudioPath?: string; // path to reflection audio (if voice input)
  helpConversation?: CoachConversation; // conversation during question
  elaborationConversation?: CoachConversation; // coach helping elaborate after answering
  moreConversation?: CoachConversation; // exploration after answering
  educatorNote?: string; // educator's note about this specific response
}

export interface Submission {
  assignmentId: string;
  studentId: string;
  responses: PromptResponse[];
  submittedAt: Date;
}
