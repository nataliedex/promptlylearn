/**
 * Subject resolution utility for the Ask Coach drawer.
 *
 * Normalizes subject strings to canonical labels and resolves the best
 * available subject from multiple data sources with a defined priority order.
 */

const CANONICAL: Record<string, string> = {
  math: "Math",
  mathematics: "Math",
  science: "Science",
  ela: "English / Language Arts",
  english: "English / Language Arts",
  "language arts": "English / Language Arts",
  "english / language arts": "English / Language Arts",
  "english/language arts": "English / Language Arts",
  reading: "Reading",
  writing: "Writing",
  "social studies": "Social Studies",
  "social-studies": "Social Studies",
};

/**
 * Normalize a raw subject string to a canonical label.
 * Returns undefined if the input is empty/whitespace-only.
 */
export function normalizeSubject(raw: string | undefined | null): string | undefined {
  if (!raw || !raw.trim()) return undefined;
  const key = raw.trim().toLowerCase();
  return CANONICAL[key] ?? raw.trim();
}

export interface SubjectSources {
  /** Subject from the lesson/assignment definition — highest priority */
  lessonSubject?: string;
  /** Subject stored on the session record */
  sessionSubject?: string;
  /** Subject from the class the assignment belongs to */
  classSubject?: string;
}

/**
 * Resolve the best available subject from multiple sources.
 *
 * Priority (highest → lowest):
 *   1. lessonSubject (assignment/lesson definition)
 *   2. sessionSubject
 *   3. classSubject
 *   4. "Other" (fallback)
 */
export function resolveSubject(sources: SubjectSources): string {
  const resolved =
    normalizeSubject(sources.lessonSubject) ??
    normalizeSubject(sources.sessionSubject) ??
    normalizeSubject(sources.classSubject);
  return resolved ?? "Other";
}
