import { Submission } from "./submission";
import { EvaluationResult } from "./evaluation";

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

  // Pause state fields (for "Take a break" feature)
  pausedAt?: Date; // When the student paused
  mode?: "voice" | "type"; // Mode when paused (for resume)
  wasRecording?: boolean; // Whether student was mid-response when paused
}
