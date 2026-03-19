import { Submission } from "./submission";
import { EvaluationResult } from "./evaluation";

/**
 * Ephemeral UI state auto-saved when a student navigates away mid-question.
 * Stored on the Session and cleared on answer submission or lesson completion.
 */
export interface DraftState {
  // Type mode: current answer and follow-up text
  answer?: string;
  followUpAnswer?: string;
  // Conversation state on current question
  conversationHistory?: Array<{ role: "student" | "coach"; message: string }>;
  // Feedback already received (for restoring the feedback+conversation view)
  feedback?: {
    feedback: string;
    score: number;
    isCorrect: boolean;
    followUpQuestion?: string;
    encouragement: string;
    shouldContinue: boolean;
  };
  // Hint state
  showHint?: boolean;
  hintIndex?: number;
  // Video mode metadata (not the video itself — conversation restarts on resume)
  videoAttemptCount?: number;
  videoFollowUpCount?: number;
  videoHintUsed?: boolean;
  videoHintIndex?: number;
  // Video preview state (for resuming into the preview screen after recording)
  vcrPhase?: string;
  recordedDuration?: number;
  videoDraft?: {
    url: string;
    mimeType: string;
    durationSec: number;
    sizeBytes: number;
    createdAt: string;
    kind: string;
  };
  sessionSummary?: string;
  // Timestamp for 7-day TTL
  savedAt: string;
}

/**
 * A Session represents a single attempt by a student to complete a lesson.
 * It captures everything about that attempt: who, what, when, and how they did.
 */
export interface Session {
  id: string;
  studentId: string;
  studentName: string;
  lessonId: string;
  lessonTitle: string;
  submission: Submission;
  evaluation?: EvaluationResult; // Optional for in-progress sessions
  startedAt: Date;
  completedAt?: Date; // Optional for in-progress/paused sessions
  status: "in_progress" | "paused" | "completed";
  currentPromptIndex?: number; // Track progress for resuming
  educatorNotes?: string; // Educator's notes about this session

  // Pause state fields (for "Take a break" feature and auto-save)
  pausedAt?: Date; // When the student paused
  mode?: "voice" | "type" | "video"; // Mode when paused (for resume)
  wasRecording?: boolean; // Whether student was mid-response when paused
  draftState?: DraftState; // Auto-saved UI state for resume
}
