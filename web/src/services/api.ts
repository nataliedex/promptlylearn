const API_BASE = "http://localhost:3001/api";

// Types (matching backend domain)
export interface Student {
  id: string;
  name: string;
  createdAt: string;
}

export interface LessonSummary {
  id: string;
  title: string;
  description: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  gradeLevel?: string;
  promptCount: number;
  standards?: string[];
}

export interface Prompt {
  id: string;
  type: string;
  input: string;
  hints: string[];
  standards?: string[];
}

export interface Lesson {
  id: string;
  title: string;
  description: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  gradeLevel?: string;
  prompts: Prompt[];
  standards?: string[];
}

export interface Standard {
  code: string;
  description: string;
  strand: string;
  strandName: string;
}

export interface GradeStandards {
  grade: string;
  gradeName: string;
  standards: Standard[];
}

export interface PromptResponse {
  promptId: string;
  response: string;
  reflection?: string;
  hintUsed: boolean;
  audioBase64?: string;
  audioFormat?: string;
  educatorNote?: string;
}

export interface Session {
  id: string;
  studentId: string;
  studentName: string;
  lessonId: string;
  lessonTitle: string;
  submission: {
    assignmentId: string;
    studentId: string;
    responses: PromptResponse[];
    submittedAt: string;
  };
  evaluation?: {
    totalScore: number;
    feedback: string;
    criteriaScores: { criterionId: string; score: number; comment?: string }[];
  };
  startedAt: string;
  completedAt?: string;
  status: "in_progress" | "completed";
  currentPromptIndex?: number;
  educatorNotes?: string;
}

export interface EvaluationResult {
  score: number;
  comment: string;
  totalScore: number;
}

export interface StudentAnalytics {
  sessionCount: number;
  avgScore: number;
  bestScore: number;
  engagementScore: number;
  sessionDuration: {
    averageMinutes: number;
    fastestMinutes: number;
    slowestMinutes: number;
  } | null;
  coachUsage: {
    helpRequestCount: number;
    totalInteractions: number;
  };
  hintUsage: {
    hintUsageRate: number;
  };
  inputMethods: {
    voicePercentage: number;
  };
  weeklyActivity: { week: string; sessions: number; avgScore: number }[];
}

// API Functions

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  console.log(`fetchJson: ${options?.method || "GET"} ${url}`);
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });

    console.log(`fetchJson response status: ${response.status}`);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Unknown error" }));
      throw new Error(error.error || `HTTP error ${response.status}`);
    }

    return response.json();
  } catch (err: any) {
    console.error(`fetchJson error for ${url}:`, err?.message, err?.name);
    throw err;
  }
}

// Students
export async function getStudents(): Promise<Student[]> {
  return fetchJson(`${API_BASE}/students`);
}

export async function getStudent(id: string): Promise<Student> {
  return fetchJson(`${API_BASE}/students/${id}`);
}

export async function createOrFindStudent(name: string): Promise<{ student: Student; isNew: boolean }> {
  return fetchJson(`${API_BASE}/students`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export interface StudentLessonsResponse {
  studentId: string;
  studentName: string;
  lessons: LessonSummary[];
  count: number;
}

/**
 * Get lessons assigned to a specific student.
 */
export async function getStudentLessons(studentId: string): Promise<StudentLessonsResponse> {
  return fetchJson(`${API_BASE}/students/${studentId}/lessons`);
}

// Lessons
export async function getLessons(): Promise<LessonSummary[]> {
  return fetchJson(`${API_BASE}/lessons`);
}

export async function getLesson(id: string): Promise<Lesson> {
  return fetchJson(`${API_BASE}/lessons/${id}`);
}

export interface ArchivedLessonSummary extends LessonSummary {
  archivedAt?: string;
}

export async function getArchivedLessons(): Promise<ArchivedLessonSummary[]> {
  return fetchJson(`${API_BASE}/lessons/archived/list`);
}

export async function archiveLesson(id: string): Promise<{ success: boolean; message: string }> {
  return fetchJson(`${API_BASE}/lessons/${id}/archive`, {
    method: "POST",
  });
}

export async function unarchiveLesson(id: string): Promise<{ success: boolean; message: string }> {
  return fetchJson(`${API_BASE}/lessons/${id}/unarchive`, {
    method: "POST",
  });
}

// Sessions
export async function getSessions(studentId?: string, status?: string): Promise<Session[]> {
  const params = new URLSearchParams();
  if (studentId) params.set("studentId", studentId);
  if (status) params.set("status", status);
  const query = params.toString();
  return fetchJson(`${API_BASE}/sessions${query ? `?${query}` : ""}`);
}

export async function getSession(id: string): Promise<Session> {
  return fetchJson(`${API_BASE}/sessions/${id}`);
}

export async function createSession(data: {
  studentId: string;
  studentName: string;
  lessonId: string;
  lessonTitle: string;
}): Promise<Session> {
  return fetchJson(`${API_BASE}/sessions`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateSession(id: string, data: Partial<Session>): Promise<Session> {
  return fetchJson(`${API_BASE}/sessions/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

// Evaluation
export async function evaluateResponse(
  response: PromptResponse,
  lessonId: string
): Promise<EvaluationResult> {
  return fetchJson(`${API_BASE}/evaluate/response`, {
    method: "POST",
    body: JSON.stringify({ response, lessonId }),
  });
}

// Analytics
export async function getStudentAnalytics(studentId: string): Promise<StudentAnalytics> {
  return fetchJson(`${API_BASE}/analytics/student/${studentId}`);
}

export async function getClassAnalytics(): Promise<any> {
  return fetchJson(`${API_BASE}/analytics/class`);
}

// Lesson Generation Types
export type CreationMode = "book-title" | "book-excerpt" | "pasted-text" | "topic" | "guided";

export interface LessonParams {
  mode: CreationMode;
  content: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  questionCount: number;
  gradeLevel?: string;
}

// Lesson Generation
export async function generateLesson(params: LessonParams): Promise<Lesson> {
  return fetchJson(`${API_BASE}/lessons/generate`, {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function generateQuestion(
  lessonContext: string,
  existingQuestions: string[],
  difficulty: string
): Promise<Prompt> {
  return fetchJson(`${API_BASE}/lessons/generate-question`, {
    method: "POST",
    body: JSON.stringify({ lessonContext, existingQuestions, difficulty }),
  });
}

export async function saveLesson(lesson: Lesson): Promise<{ lesson: Lesson; filePath: string }> {
  return fetchJson(`${API_BASE}/lessons`, {
    method: "POST",
    body: JSON.stringify(lesson),
  });
}

// Voice Features
export async function checkVoiceStatus(): Promise<{ available: boolean }> {
  return fetchJson(`${API_BASE}/voice/status`);
}

export async function transcribeAudio(audioBase64: string, format: string = "webm"): Promise<{ text: string }> {
  return fetchJson(`${API_BASE}/voice/transcribe`, {
    method: "POST",
    body: JSON.stringify({ audio: audioBase64, format }),
  });
}

export async function textToSpeech(text: string, voice: string = "nova"): Promise<{ audio: string; format: string }> {
  console.log("TTS API call starting, text length:", text?.length);

  // Retry logic for transient network failures
  let lastError: any;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      console.log(`TTS API attempt ${attempt}...`);
      const result = await fetchJson<{ audio: string; format: string }>(`${API_BASE}/voice/speak`, {
        method: "POST",
        body: JSON.stringify({ text, voice }),
      });
      console.log("TTS API call succeeded");
      return result;
    } catch (err: any) {
      console.error(`TTS API attempt ${attempt} failed:`, {
        message: err?.message,
        name: err?.name,
        textLength: text?.length,
      });
      lastError = err;
      if (attempt < 2) {
        // Wait before retry
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }
  throw lastError;
}

// Standards
export async function getStandardsForGrade(gradeLevel: string): Promise<GradeStandards> {
  return fetchJson(`${API_BASE}/standards/${encodeURIComponent(gradeLevel)}`);
}

export async function getReadingStandards(gradeLevel: string): Promise<Standard[]> {
  return fetchJson(`${API_BASE}/standards/${encodeURIComponent(gradeLevel)}/reading`);
}

// Coach Types
export interface ConversationMessage {
  role: "student" | "coach";
  message: string;
}

export interface CoachFeedbackResponse {
  feedback: string;
  score: number;
  isCorrect: boolean;
  followUpQuestion?: string;
  encouragement: string;
  shouldContinue: boolean;
}

export interface CoachContinueResponse {
  feedback: string;
  followUpQuestion?: string;
  encouragement: string;
  shouldContinue: boolean;
}

// Coach API Functions
export async function getCoachFeedback(
  lessonId: string,
  promptId: string,
  studentAnswer: string,
  gradeLevel?: string
): Promise<CoachFeedbackResponse> {
  return fetchJson(`${API_BASE}/coach/feedback`, {
    method: "POST",
    body: JSON.stringify({ lessonId, promptId, studentAnswer, gradeLevel }),
  });
}

export async function continueCoachConversation(
  lessonId: string,
  promptId: string,
  studentAnswer: string,
  studentResponse: string,
  conversationHistory: ConversationMessage[],
  gradeLevel?: string
): Promise<CoachContinueResponse> {
  return fetchJson(`${API_BASE}/coach/continue`, {
    method: "POST",
    body: JSON.stringify({
      lessonId,
      promptId,
      studentAnswer,
      studentResponse,
      conversationHistory,
      gradeLevel,
    }),
  });
}

// ============================================
// Assignment Lifecycle Types
// ============================================

export type AssignmentLifecycleState = "active" | "resolved" | "archived";

export type ActiveReason =
  | "students-need-support"
  | "incomplete-work"
  | "not-reviewed"
  | "pending-feedback"
  | "recent-activity";

export interface StudentStatus {
  studentId: string;
  studentName: string;
  isComplete: boolean;
  understanding: "strong" | "developing" | "needs-support";
  needsSupport: boolean;
  hasTeacherNote: boolean;
  hintsUsed: number;
  score: number;
  improvedAfterHelp: boolean;
}

export interface ComputedAssignmentState {
  assignmentId: string;
  title: string;
  lifecycleState: AssignmentLifecycleState;
  activeReasons: ActiveReason[];
  totalStudents: number;
  completedCount: number;
  distribution: {
    strong: number;
    developing: number;
    needsSupport: number;
  };
  studentStatuses: StudentStatus[];
  studentsNeedingSupport: number;
  allStudentsComplete: boolean;
  allFlaggedReviewed: boolean;
}

export interface TeacherSummary {
  generatedAt: string;
  classPerformance: {
    totalStudents: number;
    strongCount: number;
    developingCount: number;
    needsSupportCount: number;
    averageScore: number;
    completionRate: number;
  };
  insights: {
    commonStrengths: string[];
    commonChallenges: string[];
    skillsMastered: string[];
    skillsNeedingReinforcement: string[];
  };
  coachUsage: {
    averageHintsPerStudent: number;
    studentsWhoUsedHints: number;
    mostEffectiveHints: string[];
    questionsNeedingMoreScaffolding: string[];
  };
  studentHighlights: {
    improvedSignificantly: string[];
    mayNeedFollowUp: string[];
    exceededExpectations: string[];
  };
  teacherEngagement: {
    totalNotesWritten: number;
    studentsWithNotes: number;
    reviewedAllFlagged: boolean;
  };
}

export interface AssignmentDashboardData {
  active: ComputedAssignmentState[];
  resolved: ComputedAssignmentState[];
  archivedCount: number;
}

export interface ArchivedAssignment {
  assignmentId: string;
  title: string;
  archivedAt?: string;
  teacherSummary?: TeacherSummary;
  totalStudents: number;
  averageScore: number;
  completionRate: number;
}

export interface AssignmentStateRecord {
  assignmentId: string;
  lifecycleState: AssignmentLifecycleState;
  activeReasons: ActiveReason[];
  createdAt: string;
  resolvedAt?: string;
  archivedAt?: string;
  lastActivityAt: string;
  teacherViewedAt?: string;
  teacherViewCount: number;
  teacherSummary?: TeacherSummary;
}

// ============================================
// Assignment Lifecycle API Functions
// ============================================

/**
 * Get assignment dashboard data grouped by lifecycle state.
 */
export async function getAssignmentDashboard(): Promise<AssignmentDashboardData> {
  return fetchJson(`${API_BASE}/assignments/dashboard`);
}

/**
 * Get computed state for a single assignment.
 */
export async function getAssignmentState(assignmentId: string): Promise<ComputedAssignmentState & { stateRecord: AssignmentStateRecord }> {
  return fetchJson(`${API_BASE}/assignments/${assignmentId}`);
}

/**
 * Record that a teacher viewed an assignment.
 * This is critical for lifecycle transitions.
 */
export async function recordAssignmentView(assignmentId: string): Promise<AssignmentStateRecord> {
  return fetchJson(`${API_BASE}/assignments/${assignmentId}/view`, {
    method: "POST",
  });
}

/**
 * Manually resolve an assignment.
 */
export async function resolveAssignment(assignmentId: string): Promise<AssignmentStateRecord> {
  return fetchJson(`${API_BASE}/assignments/${assignmentId}/resolve`, {
    method: "POST",
  });
}

/**
 * Archive an assignment with a generated summary.
 */
export async function archiveAssignment(assignmentId: string): Promise<AssignmentStateRecord> {
  return fetchJson(`${API_BASE}/assignments/${assignmentId}/archive`, {
    method: "POST",
  });
}

/**
 * Restore an archived assignment to active state.
 */
export async function restoreAssignment(assignmentId: string): Promise<AssignmentStateRecord> {
  return fetchJson(`${API_BASE}/assignments/${assignmentId}/restore`, {
    method: "POST",
  });
}

/**
 * Trigger auto-archive check.
 * Called periodically (e.g., on dashboard load).
 */
export async function triggerAutoArchive(): Promise<{ checked: number; archived: string[] }> {
  return fetchJson(`${API_BASE}/assignments/auto-archive`, {
    method: "POST",
  });
}

/**
 * Get all archived assignments with summaries.
 */
export async function getArchivedAssignments(): Promise<ArchivedAssignment[]> {
  return fetchJson(`${API_BASE}/assignments/archived/list`);
}

// ============================================
// Class / Section Types
// ============================================

export interface Class {
  id: string;
  name: string;
  description?: string;
  gradeLevel?: string;
  schoolYear?: string;
  period?: string;
  subject?: string;
  studentIds: string[];
  teacherId?: string;
  createdAt: string;
  updatedAt?: string;
  archivedAt?: string;
}

export interface ClassSummary {
  id: string;
  name: string;
  gradeLevel?: string;
  schoolYear?: string;
  period?: string;
  subject?: string;
  studentCount: number;
  createdAt: string;
  archivedAt?: string;
}

export interface ClassWithStudents extends Class {
  students: Student[];
}

export interface CreateClassInput {
  name: string;
  description?: string;
  gradeLevel?: string;
  schoolYear?: string;
  period?: string;
  subject?: string;
  studentIds?: string[];
}

export interface UpdateClassInput {
  name?: string;
  description?: string;
  gradeLevel?: string;
  schoolYear?: string;
  period?: string;
  subject?: string;
}

export interface StudentAssignment {
  id: string;
  lessonId: string;
  classId: string;
  studentId: string;
  assignedAt: string;
  assignedBy?: string;
}

export interface LessonAssignmentSummary {
  lessonId: string;
  totalAssigned: number;
  assignmentsByClass: {
    classId: string;
    className: string;
    studentCount: number;
    assignedAt: string;
  }[];
}

export interface AssignLessonResponse {
  success: boolean;
  lessonId: string;
  classId: string;
  className: string;
  assignedCount: number;
  totalInClass: number;
  assignments: StudentAssignment[];
}

export interface BulkAddStudentsResponse {
  class: Class;
  created: number;
  existing: number;
  students: Student[];
}

// ============================================
// Class / Section API Functions
// ============================================

/**
 * Get all classes (excludes archived by default).
 */
export async function getClasses(includeArchived: boolean = false): Promise<ClassSummary[]> {
  const params = includeArchived ? "?includeArchived=true" : "";
  return fetchJson(`${API_BASE}/classes${params}`);
}

/**
 * Get archived classes only.
 */
export async function getArchivedClasses(): Promise<Class[]> {
  return fetchJson(`${API_BASE}/classes/archived`);
}

/**
 * Get a class by ID with full student details.
 */
export async function getClass(classId: string): Promise<ClassWithStudents> {
  return fetchJson(`${API_BASE}/classes/${classId}`);
}

/**
 * Create a new class.
 */
export async function createClass(input: CreateClassInput): Promise<Class> {
  return fetchJson(`${API_BASE}/classes`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * Update a class.
 */
export async function updateClass(classId: string, input: UpdateClassInput): Promise<Class> {
  return fetchJson(`${API_BASE}/classes/${classId}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

/**
 * Archive a class (soft delete).
 */
export async function archiveClass(classId: string): Promise<Class> {
  return fetchJson(`${API_BASE}/classes/${classId}/archive`, {
    method: "POST",
  });
}

/**
 * Restore an archived class.
 */
export async function restoreClass(classId: string): Promise<Class> {
  return fetchJson(`${API_BASE}/classes/${classId}/restore`, {
    method: "POST",
  });
}

/**
 * Permanently delete a class.
 */
export async function deleteClass(classId: string): Promise<{ success: boolean }> {
  return fetchJson(`${API_BASE}/classes/${classId}`, {
    method: "DELETE",
  });
}

/**
 * Add students to a class by their IDs.
 */
export async function addStudentsToClass(classId: string, studentIds: string[]): Promise<Class> {
  return fetchJson(`${API_BASE}/classes/${classId}/students`, {
    method: "POST",
    body: JSON.stringify({ studentIds }),
  });
}

/**
 * Bulk add students by name (creates students if they don't exist).
 * Supports comma or newline separated names.
 */
export async function bulkAddStudentsToClass(classId: string, names: string): Promise<BulkAddStudentsResponse> {
  return fetchJson(`${API_BASE}/classes/${classId}/students/bulk`, {
    method: "POST",
    body: JSON.stringify({ names }),
  });
}

/**
 * Remove a student from a class.
 */
export async function removeStudentFromClass(classId: string, studentId: string): Promise<Class> {
  return fetchJson(`${API_BASE}/classes/${classId}/students/${studentId}`, {
    method: "DELETE",
  });
}

// ============================================
// Lesson Assignment API Functions
// ============================================

/**
 * Get assignment summary for a lesson.
 */
export async function getLessonAssignments(lessonId: string): Promise<LessonAssignmentSummary> {
  return fetchJson(`${API_BASE}/lessons/${lessonId}/assignments`);
}

/**
 * Assign a lesson to a class (all students or specific students).
 */
export async function assignLessonToClass(
  lessonId: string,
  classId: string,
  studentIds?: string[]
): Promise<AssignLessonResponse> {
  return fetchJson(`${API_BASE}/lessons/${lessonId}/assign`, {
    method: "POST",
    body: JSON.stringify({ classId, studentIds }),
  });
}

/**
 * Remove all assignments for a lesson from a specific class.
 */
export async function unassignLessonFromClass(
  lessonId: string,
  classId: string
): Promise<{ success: boolean; lessonId: string; classId: string; removedCount: number }> {
  return fetchJson(`${API_BASE}/lessons/${lessonId}/assign/${classId}`, {
    method: "DELETE",
  });
}

/**
 * Get assigned student IDs for a lesson.
 */
export async function getAssignedStudents(
  lessonId: string
): Promise<{ lessonId: string; hasAssignments: boolean; studentIds: string[]; count: number }> {
  return fetchJson(`${API_BASE}/lessons/${lessonId}/assigned-students`);
}
