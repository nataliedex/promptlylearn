/**
 * Student Domain Model
 *
 * Simple by design - students do NOT need logins at this stage.
 * A student can belong to one or more classes.
 */

export interface Student {
  id: string;
  name: string;

  // Optional private notes for teacher (IEP, ESL, accommodations, etc.)
  // This is teacher-only information, never shown to students
  notes?: string;

  createdAt: Date;
}
