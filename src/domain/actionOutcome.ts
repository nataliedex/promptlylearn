/**
 * Action Outcome - Tracks what happens after a teacher acts on a recommendation
 *
 * This enables smart follow-ups and prevents duplicate recommendations
 * by tracking the resolution status of teacher actions.
 */

export type ActionType = "reassign" | "award_badge" | "add_note" | "dismiss" | "mark_reviewed";

export type ResolutionStatus =
  | "completed"           // Action finished, no follow-up needed
  | "pending"             // Awaiting student action (e.g., after reassign)
  | "follow_up_needed";   // Teacher should check again

export interface ActionOutcome {
  id: string;
  recommendationId: string;
  actionType: ActionType;
  actedBy: string;              // teacherId
  actedAt: string;              // ISO timestamp
  affectedStudentIds: string[]; // Students affected
  affectedAssignmentId?: string;
  resolutionStatus: ResolutionStatus;
  metadata?: {
    badgeType?: string;
    badgeMessage?: string;
    noteText?: string;
    /**
     * Note visibility - determines who can see this note
     * - "student": Visible to the student (teacher-to-student message)
     * - "educator": Only visible to educators (internal notes, system tracking)
     * Default: "educator" for backward compatibility
     */
    noteVisibility?: "student" | "educator";
    previousScore?: number;     // For tracking improvement after reassign
  };
}

export interface CreateActionOutcomeInput {
  recommendationId: string;
  actionType: ActionType;
  actedBy: string;
  affectedStudentIds: string[];
  affectedAssignmentId?: string;
  resolutionStatus: ResolutionStatus;
  metadata?: ActionOutcome["metadata"];
}
