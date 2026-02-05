/**
 * Lesson Draft Domain Model
 *
 * Represents an in-progress lesson that hasn't been fully created yet.
 * Drafts are saved server-side and can be continued later.
 */

import { randomUUID } from "crypto";

export interface LessonDraft {
  id: string;
  title: string;
  subject: string;
  gradeLevel: string;
  questionCount: number;
  description: string;
  assignToClassId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LessonDraftInput {
  title?: string;
  subject?: string;
  gradeLevel?: string;
  questionCount?: number;
  description?: string;
  assignToClassId?: string;
}

/**
 * Create a new lesson draft
 */
export function createLessonDraft(input: LessonDraftInput): LessonDraft {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    title: input.title || "",
    subject: input.subject || "",
    gradeLevel: input.gradeLevel || "",
    questionCount: input.questionCount || 5,
    description: input.description || "",
    assignToClassId: input.assignToClassId,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Update an existing lesson draft
 */
export function updateLessonDraft(
  draft: LessonDraft,
  updates: LessonDraftInput
): LessonDraft {
  return {
    ...draft,
    title: updates.title !== undefined ? updates.title : draft.title,
    subject: updates.subject !== undefined ? updates.subject : draft.subject,
    gradeLevel: updates.gradeLevel !== undefined ? updates.gradeLevel : draft.gradeLevel,
    questionCount: updates.questionCount !== undefined ? updates.questionCount : draft.questionCount,
    description: updates.description !== undefined ? updates.description : draft.description,
    assignToClassId: updates.assignToClassId !== undefined ? updates.assignToClassId : draft.assignToClassId,
    updatedAt: new Date().toISOString(),
  };
}
