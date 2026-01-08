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
  evaluation: EvaluationResult;
  startedAt: Date;
  completedAt: Date;
}
