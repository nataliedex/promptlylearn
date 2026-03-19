import { Prompt } from "./prompt";

export interface CoachTurn {
  role: "student" | "coach";
  message: string;
  // Deferral tracking (set on coach turns when moving on due to stagnation)
  deferredByCoach?: boolean;
  deferralReason?: "stagnation";
  deferralContext?: {
    pattern?: string; // "repeated-error" | "persistent-uncertainty" | "no-progress"
    turnCount?: number;
  };
}

export interface CoachConversation {
  mode: "help" | "more";
  turns: CoachTurn[];
  finalAnswer?: string; // The answer worked out during help conversation
}

/**
 * Video response metadata.
 * The actual video file is stored on disk; only metadata is stored in JSON.
 */
export interface VideoResponse {
  url: string; // Public URL to the video file (served by backend)
  mimeType: string; // e.g., "video/webm"
  durationSec: number; // Duration in seconds
  sizeBytes: number; // File size in bytes
  createdAt: string; // ISO timestamp
  kind: "answer" | "coach_convo"; // Video type
}

export interface PromptResponse {
  promptId: string;
  response: string;
  reflection?: string; // optional student reasoning
  elaborations?: string[]; // additional details from coach follow-up questions
  hintUsed: boolean;
  hintCountUsed?: number; // how many hints were used (0 = none, 1 = first hint, etc.)
  inputSource?: "typed" | "voice" | "video"; // how the response was provided
  audioPath?: string; // path to saved audio recording (if voice input)
  audioBase64?: string; // base64 encoded audio data (for web playback)
  audioFormat?: string; // audio format (webm, mp4, etc.)
  reflectionAudioPath?: string; // path to reflection audio (if voice input)
  video?: VideoResponse; // video response metadata (if video input)
  helpConversation?: CoachConversation; // conversation during question
  elaborationConversation?: CoachConversation; // coach helping elaborate after answering
  moreConversation?: CoachConversation; // exploration after answering
  // Video conversation turns (ordered coach/student utterances from live session)
  conversationTurns?: Array<{
    role: "coach" | "student";
    message: string;
    timestampSec?: number;
  }>;
  educatorNote?: string; // educator's note about this specific response
  // Stagnation/deferral tracking (for teacher analytics)
  deferredByCoach?: boolean; // True if coach moved on due to stagnation
  deferralMetadata?: {
    reason: "stagnation";
    pattern?: string; // "repeated-error" | "persistent-uncertainty" | "no-progress"
    attemptCount?: number; // Number of coaching attempts before deferral
    deferredAt?: string; // ISO timestamp
  };
}

export interface Submission {
  assignmentId: string;
  studentId: string;
  responses: PromptResponse[];
  submittedAt: Date;
}
