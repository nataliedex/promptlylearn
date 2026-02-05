/**
 * Student Profile Domain Model (v1)
 *
 * Stores student preferences and accommodations.
 * PRIVACY: Some fields are teacher-only and must never be sent to student clients.
 *
 * Key constraint: Students CANNOT edit their preferredName - only educators can.
 */

/**
 * Input preference for assignments
 */
export type InputPreference = "voice" | "typing" | "no_preference";

/**
 * Pacing preference for coach interactions
 */
export type PacePreference = "take_my_time" | "keep_it_moving";

/**
 * How the coach should provide help
 */
export type CoachHelpStyle = "hints_first" | "examples_first" | "ask_me_questions";

/**
 * Accommodations configuration
 * PRIVACY: The 'notes' field is TEACHER-ONLY and must never be sent to student clients
 */
export interface StudentAccommodations {
  extraTime?: boolean;
  readAloud?: boolean;
  reducedDistractions?: boolean;
  /** TEACHER-ONLY: Internal notes about accommodations - never expose to student */
  notes?: string;
}

/**
 * Student Profile - stores student preferences and accommodations
 */
export interface StudentProfile {
  id: string;
  /** Internal only - never expose to student client */
  legalName: string;
  /** Used everywhere in UI and coach - ONLY educators can change this */
  preferredName: string;
  /** Pronouns (e.g., "she/her", "he/him", "they/them") */
  pronouns?: string;
  /** Class enrollments (may be derived from existing enrollment data) */
  classIds: string[];
  /** Grade level (optional) */
  gradeLevel?: string;
  /** Preferred input method */
  inputPreference: InputPreference;
  /** Pacing preference */
  pacePreference: PacePreference;
  /** How coach should provide help */
  coachHelpStyle: CoachHelpStyle;
  /** Accommodations - contains teacher-only fields */
  accommodations?: StudentAccommodations;
  /** ISO timestamp when profile was created */
  createdAt: string;
  /** ISO timestamp when profile was last updated */
  updatedAt: string;
}

/**
 * Create a new student profile with defaults
 * @param id - Student ID
 * @param legalName - Legal name (internal only)
 * @param preferredName - Display name (defaults to first token of legalName)
 * @param classIds - Initial class enrollments
 */
export function createStudentProfile(
  id: string,
  legalName: string,
  preferredName?: string,
  classIds: string[] = []
): StudentProfile {
  const now = new Date().toISOString();
  // Default preferredName to first token of legalName if not provided
  const defaultPreferredName = preferredName || legalName.split(/\s+/)[0];

  return {
    id,
    legalName,
    preferredName: defaultPreferredName,
    classIds,
    inputPreference: "no_preference",
    pacePreference: "take_my_time",
    coachHelpStyle: "hints_first",
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Fields that educators can update on a student profile
 */
export interface StudentProfileEducatorUpdate {
  /** Educators can update the full/legal name (roster corrections) */
  legalName?: string;
  preferredName?: string;
  pronouns?: string;
  gradeLevel?: string;
  inputPreference?: InputPreference;
  pacePreference?: PacePreference;
  coachHelpStyle?: CoachHelpStyle;
  accommodations?: StudentAccommodations;
}

/**
 * Apply educator updates to a student profile
 */
export function updateStudentProfile(
  profile: StudentProfile,
  updates: StudentProfileEducatorUpdate
): StudentProfile {
  return {
    ...profile,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Student-safe profile view - EXCLUDES sensitive fields
 * This is what gets sent to student clients
 */
export interface StudentProfilePublic {
  id: string;
  preferredName: string;
  pronouns?: string;
  inputPreference: InputPreference;
  pacePreference: PacePreference;
  coachHelpStyle: CoachHelpStyle;
  /** Accommodations WITHOUT the notes field */
  accommodations?: Omit<StudentAccommodations, "notes">;
}

/**
 * Sanitize a student profile for student-facing API responses
 * REMOVES: legalName, accommodations.notes
 */
export function sanitizeProfileForStudent(profile: StudentProfile): StudentProfilePublic {
  const { legalName, accommodations, classIds, gradeLevel, createdAt, updatedAt, ...safeFields } = profile;

  // Remove notes from accommodations if present
  let safeAccommodations: Omit<StudentAccommodations, "notes"> | undefined;
  if (accommodations) {
    const { notes, ...rest } = accommodations;
    // Only include if there are non-note fields
    if (Object.keys(rest).length > 0) {
      safeAccommodations = rest;
    }
  }

  return {
    ...safeFields,
    accommodations: safeAccommodations,
  };
}

/**
 * Get the display name to use for a student
 * Falls back to first token of legalName if preferredName is empty
 */
export function getStudentDisplayName(profile: StudentProfile): string {
  if (profile.preferredName && profile.preferredName.trim()) {
    return profile.preferredName.trim();
  }
  // Fallback to first token of legalName
  return profile.legalName.split(/\s+/)[0];
}
