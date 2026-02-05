/**
 * Teacher Profile Domain Model (v1)
 *
 * Stores teacher preferences for display name, coach behavior, and voice settings.
 * Used to personalize student experience and coach interactions.
 */

/**
 * Coach communication tone preference
 */
export type CoachTone = "supportive" | "direct" | "structured";

/**
 * Voice mode for coach - whether to use default coach voice or teacher's cloned voice
 */
export type CoachVoiceMode = "default_coach_voice" | "teacher_voice";

/**
 * Teacher voice configuration for voice cloning
 */
export interface TeacherVoiceConfig {
  provider: "elevenlabs" | "openai" | "none";
  voiceId?: string;
  voiceName?: string;
  consentGiven: boolean;
  consentDate?: string;
}

/**
 * Teacher Profile - stores teacher preferences and settings
 */
export interface TeacherProfile {
  id: string;
  /** Internal/admin full name - not shown to students */
  fullName: string;
  /** What students see in the app (e.g., "Mrs. Blumen") */
  studentFacingName: string;
  /** Pronouns (e.g., "she/her", "he/him", "they/them") - shown to students */
  pronouns?: string;
  /** Coach communication tone */
  coachTone: CoachTone;
  /** Whether coach uses default voice or teacher's cloned voice */
  coachVoiceMode: CoachVoiceMode;
  /** Voice cloning configuration (if teacher_voice mode) */
  teacherVoice?: TeacherVoiceConfig;
  /** ISO timestamp when profile was created */
  createdAt: string;
  /** ISO timestamp when profile was last updated */
  updatedAt: string;
}

/**
 * Create a new teacher profile with defaults
 */
export function createTeacherProfile(
  id: string,
  fullName: string,
  studentFacingName: string
): TeacherProfile {
  const now = new Date().toISOString();
  return {
    id,
    fullName,
    studentFacingName,
    coachTone: "supportive",
    coachVoiceMode: "default_coach_voice",
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Fields that can be updated by the teacher
 */
export interface TeacherProfileUpdate {
  fullName?: string;
  studentFacingName?: string;
  pronouns?: string;
  coachTone?: CoachTone;
  coachVoiceMode?: CoachVoiceMode;
  teacherVoice?: TeacherVoiceConfig;
}

/**
 * Apply updates to a teacher profile
 */
export function updateTeacherProfile(
  profile: TeacherProfile,
  updates: TeacherProfileUpdate
): TeacherProfile {
  return {
    ...profile,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
}
