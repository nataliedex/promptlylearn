/**
 * Teacher Preferences - Implicit Learning System
 *
 * Stores inferred preferences per teacher to personalize AI generation.
 * No UI is exposed - this operates invisibly in the background.
 *
 * Future-proofing: Data is structured to later support named templates,
 * sharing across grade teams, etc.
 */

const PREFERENCES_KEY = "teacher-preferences";
const LAST_SETTINGS_KEY = "lesson-creation-last-settings";

export interface TeacherPreferences {
  // Lesson creation defaults
  typicalQuestionCount: number;
  lastUsedQuestionCount: number;

  // Question characteristics
  avgHintsPerQuestion: number;
  avgQuestionLength: "short" | "medium" | "long";
  commonVerbs: string[];

  // Editing behavior
  editFrequency: "rarely" | "sometimes" | "often";
  totalLessonsCreated: number;
  totalQuestionsEdited: number;
  totalQuestionsGenerated: number;

  // Question style preferences
  includesReflectionQuestions: boolean;
  includesExtensionQuestions: boolean;

  // Metadata
  lastUpdated: string;
  version: number;
}

export interface LastUsedSettings {
  questionCount: number;
  subject?: string;
  gradeLevel?: string;
  difficulty?: string;
  updatedAt: string;
}

const DEFAULT_PREFERENCES: TeacherPreferences = {
  typicalQuestionCount: 4,
  lastUsedQuestionCount: 4,
  avgHintsPerQuestion: 2,
  avgQuestionLength: "medium",
  commonVerbs: ["explain", "describe", "why"],
  editFrequency: "sometimes",
  totalLessonsCreated: 0,
  totalQuestionsEdited: 0,
  totalQuestionsGenerated: 0,
  includesReflectionQuestions: false,
  includesExtensionQuestions: false,
  lastUpdated: new Date().toISOString(),
  version: 1,
};

const DEFAULT_LAST_SETTINGS: LastUsedSettings = {
  questionCount: 4,
  updatedAt: new Date().toISOString(),
};

/**
 * Get teacher preferences from localStorage
 */
export function getTeacherPreferences(): TeacherPreferences {
  try {
    const stored = localStorage.getItem(PREFERENCES_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...DEFAULT_PREFERENCES, ...parsed };
    }
  } catch (e) {
    console.error("Failed to load teacher preferences:", e);
  }
  return DEFAULT_PREFERENCES;
}

/**
 * Save teacher preferences to localStorage
 */
export function saveTeacherPreferences(prefs: Partial<TeacherPreferences>): void {
  try {
    const current = getTeacherPreferences();
    const updated = {
      ...current,
      ...prefs,
      lastUpdated: new Date().toISOString(),
    };
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(updated));
  } catch (e) {
    console.error("Failed to save teacher preferences:", e);
  }
}

/**
 * Get last used settings for lesson creation
 */
export function getLastUsedSettings(): LastUsedSettings {
  try {
    const stored = localStorage.getItem(LAST_SETTINGS_KEY);
    if (stored) {
      return { ...DEFAULT_LAST_SETTINGS, ...JSON.parse(stored) };
    }
  } catch (e) {
    console.error("Failed to load last settings:", e);
  }
  return DEFAULT_LAST_SETTINGS;
}

/**
 * Save last used settings
 */
export function saveLastUsedSettings(settings: Partial<LastUsedSettings>): void {
  try {
    const current = getLastUsedSettings();
    const updated = {
      ...current,
      ...settings,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(LAST_SETTINGS_KEY, JSON.stringify(updated));
  } catch (e) {
    console.error("Failed to save last settings:", e);
  }
}

/**
 * Record that a lesson was created
 */
export function recordLessonCreated(questionCount: number): void {
  const prefs = getTeacherPreferences();

  // Update running averages
  const totalLessons = prefs.totalLessonsCreated + 1;
  const typicalCount = Math.round(
    (prefs.typicalQuestionCount * prefs.totalLessonsCreated + questionCount) / totalLessons
  );

  saveTeacherPreferences({
    totalLessonsCreated: totalLessons,
    totalQuestionsGenerated: prefs.totalQuestionsGenerated + questionCount,
    typicalQuestionCount: typicalCount,
    lastUsedQuestionCount: questionCount,
  });

  saveLastUsedSettings({ questionCount });
}

/**
 * Record that questions were edited
 */
export function recordQuestionsEdited(
  editedCount: number,
  originalQuestions: string[],
  editedQuestions: string[]
): void {
  const prefs = getTeacherPreferences();

  // Calculate average question length from edits
  const avgLength = editedQuestions.reduce((sum, q) => sum + q.length, 0) / editedQuestions.length;
  const lengthCategory: "short" | "medium" | "long" =
    avgLength < 80 ? "short" : avgLength < 150 ? "medium" : "long";

  // Extract common verbs from edited questions
  const verbPatterns = ["explain", "describe", "why", "how", "what", "compare", "analyze", "think"];
  const foundVerbs = verbPatterns.filter(verb =>
    editedQuestions.some(q => q.toLowerCase().includes(verb))
  );

  // Update edit frequency
  const totalEdited = prefs.totalQuestionsEdited + editedCount;
  const totalGenerated = prefs.totalQuestionsGenerated;
  const editRatio = totalGenerated > 0 ? totalEdited / totalGenerated : 0;
  const editFrequency: "rarely" | "sometimes" | "often" =
    editRatio < 0.2 ? "rarely" : editRatio < 0.5 ? "sometimes" : "often";

  saveTeacherPreferences({
    totalQuestionsEdited: totalEdited,
    avgQuestionLength: lengthCategory,
    commonVerbs: foundVerbs.length > 0 ? foundVerbs : prefs.commonVerbs,
    editFrequency,
  });
}

/**
 * Record hint usage patterns
 */
export function recordHintPatterns(hintsPerQuestion: number[]): void {
  if (hintsPerQuestion.length === 0) return;

  const prefs = getTeacherPreferences();
  const avgHints = hintsPerQuestion.reduce((a, b) => a + b, 0) / hintsPerQuestion.length;

  // Weighted average with existing
  const weight = Math.min(prefs.totalLessonsCreated, 5); // Cap influence of old data
  const newAvg = (prefs.avgHintsPerQuestion * weight + avgHints) / (weight + 1);

  saveTeacherPreferences({
    avgHintsPerQuestion: Math.round(newAvg * 10) / 10,
  });
}

/**
 * Build AI generation context from preferences
 */
export function buildGenerationContext(): string {
  const prefs = getTeacherPreferences();

  // Only include context if we have meaningful data
  if (prefs.totalLessonsCreated < 2) {
    return "";
  }

  const parts: string[] = [];

  // Question length preference
  if (prefs.avgQuestionLength === "short") {
    parts.push("Keep questions concise and direct.");
  } else if (prefs.avgQuestionLength === "long") {
    parts.push("Questions can be more detailed with context.");
  }

  // Verb preferences
  if (prefs.commonVerbs.length > 0) {
    const verbs = prefs.commonVerbs.slice(0, 3).join(", ");
    parts.push(`This teacher often uses verbs like: ${verbs}.`);
  }

  // Hint preferences
  if (prefs.avgHintsPerQuestion < 1.5) {
    parts.push("Include 1 hint per question.");
  } else if (prefs.avgHintsPerQuestion > 2.5) {
    parts.push("Include 2-3 hints per question for scaffolding.");
  } else {
    parts.push("Include 2 hints per question.");
  }

  // Edit frequency (if they edit often, we might generate more conservative content)
  if (prefs.editFrequency === "often") {
    parts.push("Generate straightforward questions that are easy to customize.");
  }

  return parts.join(" ");
}

/**
 * Get suggested question count for a new lesson
 */
export function getSuggestedQuestionCount(): number {
  const settings = getLastUsedSettings();
  const prefs = getTeacherPreferences();

  // Prefer last used, then typical, then default
  return settings.questionCount || prefs.typicalQuestionCount || 4;
}
