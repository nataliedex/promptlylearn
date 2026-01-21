const API_BASE = "http://localhost:3001/api";

// Types (matching backend domain)
export interface Student {
  id: string;
  name: string;
  notes?: string;
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
  subject?: string;
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
  subject?: string;
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

export interface StudentLessonSummary extends LessonSummary {
  attempts: number;
  assignedAt?: string;
}

export interface StudentLessonsResponse {
  studentId: string;
  studentName: string;
  lessons: StudentLessonSummary[];
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

export async function getUnassignedLessons(): Promise<LessonSummary[]> {
  return fetchJson(`${API_BASE}/lessons/unassigned`);
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

export async function updateLessonSubject(
  lessonId: string,
  subject: string | null
): Promise<{ success: boolean; lesson: { id: string; title: string; subject?: string } }> {
  return fetchJson(`${API_BASE}/lessons/${lessonId}/subject`, {
    method: "PATCH",
    body: JSON.stringify({ subject }),
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

// Coach Chat (Freeform conversation)
export interface CoachChatResponse {
  response: string;
  shouldContinue: boolean;
}

export async function sendCoachChat(
  studentName: string,
  topics: string[],
  message: string,
  conversationHistory: ConversationMessage[],
  gradeLevel?: string
): Promise<CoachChatResponse> {
  return fetchJson(`${API_BASE}/coach/chat`, {
    method: "POST",
    body: JSON.stringify({
      studentName,
      topics,
      message,
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
  inProgressCount: number;
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
 * Action status for teacher workflow on student assignments.
 */
export type StudentActionStatus = "reviewed" | "reassigned" | "no-action-needed";

/**
 * Assignment review status summary.
 */
export interface AssignmentReviewStatus {
  totalAssigned: number;
  completed: number;
  addressed: number;
  unaddressed: number;
  actionBreakdown: {
    reviewed: number;
    reassigned: number;
    noActionNeeded: number;
  };
  isFullyReviewed: boolean;
}

/**
 * Mark an action taken on a student's assignment.
 * Used for teacher workflow (reviewed, reassigned, no-action-needed).
 */
export async function markStudentAction(
  assignmentId: string,
  studentId: string,
  action: StudentActionStatus
): Promise<{ success: boolean }> {
  return fetchJson(`${API_BASE}/assignments/${assignmentId}/students/${studentId}/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
}

/**
 * Get the review status for an assignment (how many students addressed).
 */
export async function getAssignmentReviewStatus(assignmentId: string): Promise<AssignmentReviewStatus> {
  return fetchJson(`${API_BASE}/assignments/${assignmentId}/status`);
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
  subjects?: string[];
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
  // Completion tracking
  completedAt?: string;
  attempts: number;
  // Review tracking
  reviewedAt?: string;
  reviewedBy?: string;
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
// Subject Management API Functions
// ============================================

/**
 * Update the subjects list for a class.
 */
export async function updateClassSubjects(classId: string, subjects: string[]): Promise<Class> {
  return fetchJson(`${API_BASE}/classes/${classId}/subjects`, {
    method: "PUT",
    body: JSON.stringify({ subjects }),
  });
}

/**
 * Add a subject to a class.
 */
export async function addClassSubject(classId: string, subject: string): Promise<Class> {
  return fetchJson(`${API_BASE}/classes/${classId}/subjects`, {
    method: "POST",
    body: JSON.stringify({ subject }),
  });
}

/**
 * Remove a subject from a class.
 */
export async function removeClassSubject(classId: string, subject: string): Promise<Class> {
  return fetchJson(`${API_BASE}/classes/${classId}/subjects/${encodeURIComponent(subject)}`, {
    method: "DELETE",
  });
}

/**
 * Set a student's participation in a subject.
 * excluded = true means student does NOT participate.
 */
export async function setStudentSubjectParticipation(
  classId: string,
  subject: string,
  studentId: string,
  excluded: boolean
): Promise<Class> {
  return fetchJson(`${API_BASE}/classes/${classId}/subjects/${encodeURIComponent(subject)}/participation`, {
    method: "PUT",
    body: JSON.stringify({ studentId, excluded }),
  });
}

/**
 * Get students who participate in a specific subject.
 */
export async function getStudentsForSubject(
  classId: string,
  subject: string
): Promise<{
  subject: string;
  totalStudents: number;
  participatingCount: number;
  students: { id: string; name: string }[];
}> {
  return fetchJson(`${API_BASE}/classes/${classId}/subjects/${encodeURIComponent(subject)}/students`);
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

export interface AssignedStudentsResponse {
  lessonId: string;
  hasAssignments: boolean;
  studentIds: string[];
  assignments: Record<string, { attempts: number; completedAt?: string; reviewedAt?: string }>;
  count: number;
}

/**
 * Get assigned student IDs for a lesson with assignment details.
 */
export async function getAssignedStudents(
  lessonId: string
): Promise<AssignedStudentsResponse> {
  return fetchJson(`${API_BASE}/lessons/${lessonId}/assigned-students`);
}

/**
 * Get assignment details for a specific student on a lesson.
 */
export async function getStudentAssignment(
  lessonId: string,
  studentId: string
): Promise<StudentAssignment> {
  return fetchJson(`${API_BASE}/lessons/${lessonId}/students/${studentId}/assignment`);
}

/**
 * Mark a student's assignment as reviewed by teacher.
 * This removes the student from "needs attention" summaries.
 */
export async function markStudentReviewed(
  lessonId: string,
  studentId: string
): Promise<{ success: boolean; lessonId: string; studentId: string; reviewedAt: string }> {
  return fetchJson(`${API_BASE}/lessons/${lessonId}/students/${studentId}/review`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

/**
 * Push an assignment back to a student for another attempt.
 * Clears completion/review status and increments attempts counter.
 */
export async function pushAssignmentToStudent(
  lessonId: string,
  studentId: string
): Promise<{ success: boolean; lessonId: string; studentId: string; attempts: number; message: string }> {
  return fetchJson(`${API_BASE}/lessons/${lessonId}/students/${studentId}/push`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

/**
 * Undo a reassignment by restoring previous state.
 */
export async function undoReassignment(
  lessonId: string,
  studentId: string,
  previousCompletedAt?: string,
  previousReviewedAt?: string
): Promise<{ success: boolean; lessonId: string; studentId: string; attempts: number; completedAt?: string; reviewedAt?: string; message: string }> {
  return fetchJson(`${API_BASE}/lessons/${lessonId}/students/${studentId}/undo-reassignment`, {
    method: "POST",
    body: JSON.stringify({ previousCompletedAt, previousReviewedAt }),
  });
}

/**
 * Mark a student's assignment as completed.
 * Called when a student finishes their session.
 */
export async function markAssignmentCompleted(
  lessonId: string,
  studentId: string
): Promise<{ success: boolean; lessonId: string; studentId: string; completedAt: string }> {
  return fetchJson(`${API_BASE}/lessons/${lessonId}/students/${studentId}/complete`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

// ============================================
// Coach Session Types (Ask Coach persistence)
// ============================================

export interface CoachMessage {
  role: "student" | "coach";
  message: string;
  timestamp: string;
}

export type IntentLabel = "support-seeking" | "enrichment-seeking" | "mixed";

export interface CoachSessionRecord {
  id: string;
  studentId: string;
  studentName: string;
  topics: string[];
  messages: CoachMessage[];
  mode: "voice" | "type";
  startedAt: string;
  endedAt?: string;
  supportScore: number;
  enrichmentScore: number;
  intentLabel: IntentLabel;
}

export interface CoachingInsight {
  totalCoachRequests: number;
  recentTopics: string[];
  intentLabel: IntentLabel;
  lastCoachSessionAt?: string;
}

// ============================================
// Coach Session API Functions
// ============================================

/**
 * Get all coach sessions for a student.
 */
export async function getStudentCoachSessions(
  studentId: string,
  limit?: number
): Promise<CoachSessionRecord[]> {
  const params = new URLSearchParams();
  params.set("studentId", studentId);
  if (limit) params.set("limit", limit.toString());
  return fetchJson(`${API_BASE}/coach-sessions?${params.toString()}`);
}

/**
 * Get a coach session by ID.
 */
export async function getCoachSession(sessionId: string): Promise<CoachSessionRecord> {
  return fetchJson(`${API_BASE}/coach-sessions/${sessionId}`);
}

/**
 * Save a new coach session.
 */
export async function saveCoachSession(data: {
  studentId: string;
  studentName: string;
  topics: string[];
  messages: CoachMessage[];
  mode: "voice" | "type";
  startedAt: string;
  endedAt?: string;
}): Promise<CoachSessionRecord> {
  return fetchJson(`${API_BASE}/coach-sessions`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Update an existing coach session (e.g., add messages, end session).
 */
export async function updateCoachSession(
  sessionId: string,
  data: Partial<CoachSessionRecord>
): Promise<CoachSessionRecord> {
  return fetchJson(`${API_BASE}/coach-sessions/${sessionId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

/**
 * Get coaching insights for a student (aggregated from all coach sessions).
 */
export async function getStudentCoachingInsights(studentId: string): Promise<CoachingInsight> {
  return fetchJson(`${API_BASE}/coach-sessions/insights/${studentId}`);
}

// ============================================
// Recommendations API ("What Should I Do Next?")
// ============================================

/**
 * Insight types aligned with Educational Support Intelligence specification:
 * - challenge_opportunity: Student shows readiness for extension/deeper learning
 * - celebrate_progress: Notable improvement or achievement worth recognizing
 * - check_in: Student may benefit from teacher conversation or support
 * - monitor: Situation worth watching but no immediate action needed
 */
export type InsightType =
  | "challenge_opportunity"
  | "celebrate_progress"
  | "check_in"
  | "monitor";

// Legacy type for backward compatibility
export type RecommendationType =
  | InsightType
  | "individual-checkin"
  | "small-group"
  | "assignment-adjustment"
  | "enrichment"
  | "celebrate";

export type PriorityLevel = "high" | "medium" | "low";
export type ConfidenceScore = number; // 0.7 - 1.0
export type RecommendationStatus = "active" | "reviewed" | "dismissed" | "pending" | "resolved";

export type ResolutionStatus = "completed" | "pending" | "follow_up_needed";
export type FeedbackType = "helpful" | "not-helpful";

export interface Recommendation {
  id: string;

  // New insight type (primary classification)
  insightType: InsightType;
  // Legacy type for backward compatibility
  type: RecommendationType;

  // Core content (new specification format)
  summary: string;
  evidence: string[];
  suggestedTeacherActions: string[];

  // Legacy display content (for backward compatibility)
  title: string;
  reason: string;
  suggestedAction: string;

  // Metadata (new specification)
  priorityLevel: PriorityLevel;
  confidenceScore: ConfidenceScore;

  // Legacy metadata (for backward compatibility)
  confidence: PriorityLevel;
  priority: number;

  // Context
  studentIds: string[];
  assignmentId?: string;
  triggerData: {
    ruleName: string;
    signals: Record<string, any>;
    generatedAt: string;
  };

  // State management
  status: RecommendationStatus;
  createdAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  feedback?: FeedbackType;
  feedbackNote?: string;

  // Resolution tracking (for action outcome system)
  outcomeId?: string;
  resolutionStatus?: ResolutionStatus;
  resolvedAt?: string;

  // Checklist action tracking
  submittedActions?: {
    actionKey: string;
    label: string;
    submittedAt: string;
    submittedBy: string;
  }[];
}

export interface RecommendationStats {
  totalActive: number;
  totalPending: number;
  totalResolved: number;
  reviewedToday: number;
  feedbackRate: number;
}

// ============================================
// Attention-Now Helper (Client-side)
// ============================================

/**
 * Rule names that indicate a student needs IMMEDIATE attention (intervention/check-in).
 */
const ATTENTION_NOW_RULE_NAMES = [
  "needs-support",
  "check-in-suggested",
  "group-support",
];

/**
 * Insight types that should NEVER be included in attention count.
 */
const EXCLUDED_ATTENTION_INSIGHT_TYPES = [
  "celebrate_progress",
  "challenge_opportunity",
  "monitor",
];

/**
 * Rule names that should NEVER be included in attention count.
 */
const EXCLUDED_ATTENTION_RULE_NAMES = [
  "notable-improvement",
  "ready-for-challenge",
  "watch-progress",
];

/**
 * Check if a recommendation requires immediate teacher attention.
 * This is the canonical filter for the "X students need attention today" section.
 *
 * EXCLUDES: Celebrate Progress, Challenge Opportunity, Monitor, etc.
 * INCLUDES: Needs Support, Check-in Suggested, elevated Developing
 *
 * @param rec - The recommendation to check
 * @returns true if this recommendation requires teacher attention NOW
 */
export function isAttentionNowRecommendation(rec: Recommendation): boolean {
  // Must have active status
  if (rec.status !== "active") {
    return false;
  }

  const ruleName = rec.triggerData?.ruleName || "";
  const insightType = rec.insightType;

  // EXCLUDE: Celebration and enrichment categories (by insight type)
  if (EXCLUDED_ATTENTION_INSIGHT_TYPES.includes(insightType)) {
    return false;
  }

  // EXCLUDE: Specific non-attention rule names
  if (EXCLUDED_ATTENTION_RULE_NAMES.includes(ruleName)) {
    return false;
  }

  // INCLUDE: Direct attention-requiring rules
  if (ATTENTION_NOW_RULE_NAMES.includes(ruleName)) {
    return true;
  }

  // CONDITIONAL: Developing is only included if elevated
  if (ruleName === "developing") {
    const signals = rec.triggerData?.signals || {};
    // Check for elevation indicators
    if (signals.isElevated === true || signals.escalatedFromDeveloping === true) {
      return true;
    }
    const hintUsageRate = signals.hintUsageRate as number | undefined;
    if (hintUsageRate !== undefined && hintUsageRate > 0.5) {
      return true;
    }
    const helpRequestCount = signals.helpRequestCount as number | undefined;
    if (helpRequestCount !== undefined && helpRequestCount >= 3) {
      return true;
    }
    return false;
  }

  // Fallback: check_in insight type with non-excluded rules
  if (insightType === "check_in") {
    return true;
  }

  return false;
}

export interface RecommendationsResponse {
  recommendations: Recommendation[];
  stats: RecommendationStats;
}

export interface RefreshRecommendationsResponse {
  generated: number;
  pruned: number;
  studentDataPoints: number;
  aggregateDataPoints: number;
}

/**
 * Get recommendations for the educator dashboard with optional status filtering.
 *
 * @param options.status - "active" | "pending" | "resolved" | "all" (default: "active")
 * @param options.limit - Max number of recommendations to return
 * @param options.assignmentId - Filter by assignment
 * @param options.includeReviewed - (legacy) If true, same as status="all"
 */
export async function getRecommendations(options?: {
  limit?: number;
  assignmentId?: string;
  includeReviewed?: boolean;
  status?: "active" | "pending" | "resolved" | "reviewed" | "all";
}): Promise<RecommendationsResponse> {
  const params = new URLSearchParams();
  if (options?.limit) params.set("limit", options.limit.toString());
  if (options?.assignmentId) params.set("assignmentId", options.assignmentId);
  if (options?.includeReviewed) params.set("includeReviewed", "true");
  if (options?.status) params.set("status", options.status);

  const queryString = params.toString();
  const url = queryString
    ? `${API_BASE}/recommendations?${queryString}`
    : `${API_BASE}/recommendations`;

  return fetchJson(url);
}

/**
 * Refresh recommendations by regenerating from current data.
 */
export async function refreshRecommendations(): Promise<RefreshRecommendationsResponse> {
  return fetchJson(`${API_BASE}/recommendations/refresh`, {
    method: "POST",
  });
}

/**
 * Mark a recommendation as reviewed.
 */
export async function markRecommendationReviewed(
  id: string,
  reviewedBy?: string
): Promise<{ success: boolean; recommendation: Recommendation }> {
  return fetchJson(`${API_BASE}/recommendations/${id}/review`, {
    method: "POST",
    body: JSON.stringify({ reviewedBy }),
  });
}

/**
 * Dismiss a recommendation.
 */
export async function dismissRecommendation(
  id: string
): Promise<{ success: boolean; recommendation: Recommendation }> {
  return fetchJson(`${API_BASE}/recommendations/${id}/dismiss`, {
    method: "POST",
  });
}

/**
 * Submit feedback on a recommendation.
 */
export async function submitRecommendationFeedback(
  id: string,
  feedback: FeedbackType,
  note?: string
): Promise<{ success: boolean; recommendation: Recommendation }> {
  return fetchJson(`${API_BASE}/recommendations/${id}/feedback`, {
    method: "POST",
    body: JSON.stringify({ feedback, note }),
  });
}

// ============================================
// Teacher Action API Functions
// ============================================

export interface BadgeTypeInfo {
  id: string;
  name: string;
  icon: string;
  description: string;
}

export interface ReassignResult {
  success: boolean;
  action: "reassign";
  studentId: string;
  assignmentId: string;
}

export interface AwardBadgeResult {
  success: boolean;
  action: "award-badge";
  badge: {
    id: string;
    type: string;
    typeName: string;
    message?: string;
  };
}

export interface AddNoteResult {
  success: boolean;
  action: "add-note";
  note: string;
}

/**
 * Get available badge types for awarding.
 */
export async function getBadgeTypes(): Promise<{ badgeTypes: BadgeTypeInfo[] }> {
  return fetchJson(`${API_BASE}/recommendations/badge-types`);
}

/**
 * Reassign/push back assignment to student for retry.
 * Marks the recommendation as reviewed.
 */
export async function reassignToStudent(
  recommendationId: string,
  studentId: string,
  assignmentId: string,
  teacherId?: string
): Promise<ReassignResult> {
  return fetchJson(`${API_BASE}/recommendations/${recommendationId}/actions/reassign`, {
    method: "POST",
    body: JSON.stringify({ studentId, assignmentId, teacherId }),
  });
}

/**
 * Award a badge to a student.
 * Marks the recommendation as reviewed.
 */
export async function awardBadgeToStudent(
  recommendationId: string,
  studentId: string,
  badgeType: string,
  message?: string,
  assignmentId?: string,
  teacherId?: string
): Promise<AwardBadgeResult> {
  return fetchJson(`${API_BASE}/recommendations/${recommendationId}/actions/award-badge`, {
    method: "POST",
    body: JSON.stringify({ studentId, badgeType, message, assignmentId, teacherId }),
  });
}

/**
 * Add a teacher note to the insight.
 * Marks the recommendation as reviewed.
 */
export async function addTeacherNoteToRecommendation(
  recommendationId: string,
  note: string,
  teacherId?: string
): Promise<AddNoteResult> {
  return fetchJson(`${API_BASE}/recommendations/${recommendationId}/actions/add-note`, {
    method: "POST",
    body: JSON.stringify({ note, teacherId }),
  });
}

// ============================================
// Checklist Action Types
// ============================================

/**
 * Stable action keys for the checklist system.
 *
 * SYSTEM ACTIONS (execute backend logic):
 * - assign_practice: Assign practice to student(s)
 * - reassign_student: Reassign assignment to student
 * - award_badge: Award a badge to student
 * - add_note: Add a teacher note
 *
 * SOFT ACTIONS (logged but no system mutation):
 * - run_small_group_review: Schedule a group review session
 * - review_responses: Review student responses
 * - prepare_targeted_practice: Prepare targeted practice
 * - check_in_1to1: Have a 1-on-1 conversation
 * - discuss_extension: Discuss extension activities
 * - explore_peer_tutoring: Explore peer tutoring
 * - acknowledge_progress: Acknowledge student progress
 */
export type ChecklistActionKey =
  | "assign_practice"
  | "reassign_student"
  | "award_badge"
  | "add_note"
  | "run_small_group_review"
  | "review_responses"
  | "prepare_targeted_practice"
  | "check_in_1to1"
  | "discuss_extension"
  | "explore_peer_tutoring"
  | "acknowledge_progress";

/**
 * Configuration for displaying checklist actions in the UI
 */
export interface ChecklistActionConfig {
  key: ChecklistActionKey;
  label: string;
  description?: string;
  isSystemAction: boolean;
  requiresBadgeType?: boolean;
  requiresNoteText?: boolean;
  createsPendingState?: boolean;
}

/**
 * All available checklist actions with their display configurations
 */
export const CHECKLIST_ACTIONS: Record<ChecklistActionKey, ChecklistActionConfig> = {
  // System actions
  assign_practice: {
    key: "assign_practice",
    label: "Assign additional practice",
    description: "Push practice assignment to selected student(s)",
    isSystemAction: true,
    createsPendingState: true,
  },
  reassign_student: {
    key: "reassign_student",
    label: "Reassign for another attempt",
    description: "Allow student to retry the assignment",
    isSystemAction: true,
    createsPendingState: true,
  },
  award_badge: {
    key: "award_badge",
    label: "Award a badge",
    description: "Recognize student achievement with a badge",
    isSystemAction: true,
    requiresBadgeType: true,
  },
  add_note: {
    key: "add_note",
    label: "Add a teacher note",
    description: "Record a private note about this student",
    isSystemAction: true,
    requiresNoteText: true,
  },
  // Soft actions
  run_small_group_review: {
    key: "run_small_group_review",
    label: "Schedule a small group review session",
    isSystemAction: false,
  },
  review_responses: {
    key: "review_responses",
    label: "Review their responses",
    isSystemAction: false,
  },
  prepare_targeted_practice: {
    key: "prepare_targeted_practice",
    label: "Prepare targeted practice activities",
    isSystemAction: false,
  },
  check_in_1to1: {
    key: "check_in_1to1",
    label: "Have a 1-on-1 conversation",
    isSystemAction: false,
  },
  discuss_extension: {
    key: "discuss_extension",
    label: "Discuss extension activities",
    isSystemAction: false,
  },
  explore_peer_tutoring: {
    key: "explore_peer_tutoring",
    label: "Explore peer tutoring opportunities",
    isSystemAction: false,
  },
  acknowledge_progress: {
    key: "acknowledge_progress",
    label: "Acknowledge their progress",
    isSystemAction: false,
  },
};

/**
 * Get checklist actions available for a given recommendation category
 */
export function getChecklistActionsForCategory(
  categoryKey: string,
  options: {
    hasAssignmentId: boolean;
    isGrouped: boolean;
    studentCount: number;
  }
): ChecklistActionKey[] {
  const actions: ChecklistActionKey[] = [];

  switch (categoryKey) {
    case "needs-support":
      if (options.isGrouped) {
        actions.push("assign_practice");
        actions.push("run_small_group_review");
        actions.push("review_responses");
        actions.push("prepare_targeted_practice");
      } else {
        if (options.hasAssignmentId) {
          actions.push("reassign_student");
        }
        actions.push("review_responses");
        actions.push("check_in_1to1");
        actions.push("add_note");
      }
      break;

    case "group-review":
      actions.push("assign_practice");
      actions.push("run_small_group_review");
      actions.push("review_responses");
      actions.push("prepare_targeted_practice");
      break;

    case "developing":
      actions.push("check_in_1to1");
      actions.push("prepare_targeted_practice");
      actions.push("add_note");
      break;

    case "check-in-suggested":
      actions.push("check_in_1to1");
      if (options.hasAssignmentId) {
        actions.push("reassign_student");
      }
      actions.push("add_note");
      break;

    case "celebrate-progress":
      // Only award badge option for celebration - message is optional
      actions.push("award_badge");
      break;

    case "challenge-opportunity":
      actions.push("discuss_extension");
      actions.push("explore_peer_tutoring");
      actions.push("award_badge");
      actions.push("add_note");
      break;

    case "administrative":
      actions.push("review_responses");
      actions.push("add_note");
      break;

    default:
      actions.push("review_responses");
      actions.push("add_note");
  }

  return actions;
}

/**
 * Request payload for submitting checklist actions
 */
export interface SubmitChecklistRequest {
  selectedActionKeys: ChecklistActionKey[];
  noteText?: string;
  badgeType?: string;
  badgeMessage?: string;
  teacherId?: string;
}

/**
 * A single recorded checklist action entry
 */
export interface ChecklistActionEntry {
  id: string;
  recommendationId: string;
  actionKey: ChecklistActionKey;
  label: string;
  isSystemAction: boolean;
  executedAt: string;
  executedBy: string;
  metadata?: {
    noteText?: string;
    badgeType?: string;
    badgeMessage?: string;
    affectedStudentIds?: string[];
    affectedAssignmentId?: string;
  };
}

/**
 * Response from submitting checklist actions
 */
export interface SubmitChecklistResponse {
  success: boolean;
  recommendation: Recommendation;
  actionEntries: ChecklistActionEntry[];
  systemActionsExecuted: ChecklistActionKey[];
  newStatus: RecommendationStatus;
}

/**
 * Submit selected checklist actions for a recommendation.
 * Executes system actions and logs all selected items.
 */
export async function submitChecklistActions(
  recommendationId: string,
  payload: SubmitChecklistRequest
): Promise<SubmitChecklistResponse> {
  return fetchJson(`${API_BASE}/recommendations/${recommendationId}/actions/submit-checklist`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ============================================
// Teacher To-Do Types
// ============================================

export type TeacherTodoStatus = "open" | "done";

/**
 * A teacher to-do item created from soft checklist actions.
 */
export interface TeacherTodo {
  id: string;
  teacherId: string;
  recommendationId: string;

  // Action details
  actionKey: ChecklistActionKey;
  label: string;

  // Context for display
  classId?: string;
  className?: string;
  subject?: string;
  assignmentId?: string;
  assignmentTitle?: string;
  studentIds?: string[];
  studentNames?: string;

  // Status tracking
  status: TeacherTodoStatus;
  createdAt: string;
  doneAt?: string;
}

/**
 * Todos grouped by class for display/printing
 */
export interface TodosByClass {
  classId: string | null;
  className: string;
  subjects: TodosBySubject[];
  todoCount: number;
}

/**
 * Todos grouped by subject within a class
 */
export interface TodosBySubject {
  subject: string | null;
  assignments: TodosByAssignment[];
  todoCount: number;
}

/**
 * Todos grouped by assignment within a subject
 */
export interface TodosByAssignment {
  assignmentId: string | null;
  assignmentTitle: string | null;
  todos: TeacherTodo[];
}

/**
 * Response from getting teacher todos
 */
export interface GetTeacherTodosResponse {
  todos: TeacherTodo[];
  count: number;
  openCount: number;
  doneCount: number;
  grouped?: TodosByClass[];
}

/**
 * Response from creating teacher todos
 */
export interface CreateTeacherTodosResponse {
  success: boolean;
  todos: TeacherTodo[];
  count: number;
  totalOpen: number;
}

/**
 * Teacher todo counts for badges/indicators
 */
export interface TeacherTodoCounts {
  total: number;
  open: number;
  done: number;
}

// ============================================
// Teacher To-Do API Functions
// ============================================

/**
 * Get teacher todos with optional filtering.
 */
export async function getTeacherTodos(options?: {
  status?: TeacherTodoStatus;
  teacherId?: string;
  classId?: string;
  grouped?: boolean;
}): Promise<GetTeacherTodosResponse> {
  const params = new URLSearchParams();
  if (options?.status) params.set("status", options.status);
  if (options?.teacherId) params.set("teacherId", options.teacherId);
  if (options?.classId) params.set("classId", options.classId);
  if (options?.grouped) params.set("grouped", "true");

  const queryString = params.toString();
  const url = queryString
    ? `${API_BASE}/teacher-todos?${queryString}`
    : `${API_BASE}/teacher-todos`;

  return fetchJson(url);
}

/**
 * Get a single teacher todo by ID.
 */
export async function getTeacherTodo(id: string): Promise<{ todo: TeacherTodo }> {
  return fetchJson(`${API_BASE}/teacher-todos/${id}`);
}

/**
 * Mark a teacher todo as complete.
 */
export async function completeTeacherTodo(
  id: string
): Promise<{ success: boolean; todo: TeacherTodo; totalOpen: number }> {
  return fetchJson(`${API_BASE}/teacher-todos/${id}/complete`, {
    method: "POST",
  });
}

/**
 * Reopen a completed teacher todo.
 */
export async function reopenTeacherTodo(
  id: string
): Promise<{ success: boolean; todo: TeacherTodo; totalOpen: number }> {
  return fetchJson(`${API_BASE}/teacher-todos/${id}/reopen`, {
    method: "POST",
  });
}

/**
 * Delete a teacher todo.
 */
export async function deleteTeacherTodo(id: string): Promise<{ success: boolean }> {
  return fetchJson(`${API_BASE}/teacher-todos/${id}`, {
    method: "DELETE",
  });
}

/**
 * Get teacher todo counts for badges/indicators.
 */
export async function getTeacherTodoCounts(teacherId?: string): Promise<TeacherTodoCounts> {
  const params = new URLSearchParams();
  if (teacherId) params.set("teacherId", teacherId);

  const queryString = params.toString();
  const url = queryString
    ? `${API_BASE}/teacher-todos/stats/counts?${queryString}`
    : `${API_BASE}/teacher-todos/stats/counts`;

  return fetchJson(url);
}

// ============================================
// Attention State Types
// ============================================

/**
 * Attention status for a single student on a specific assignment.
 * This is the single source of truth for "needs attention" state.
 */
export interface StudentAttentionStatus {
  studentId: string;
  studentName: string;
  assignmentId: string;
  assignmentTitle?: string;
  needsAttention: boolean;
  attentionReason?: string;
  activeRecommendationIds: string[];
  pendingRecommendationIds: string[];
  resolvedRecommendationIds: string[];
}

/**
 * Summary of attention state for an assignment/lesson
 */
export interface AssignmentAttentionSummary {
  assignmentId: string;
  assignmentTitle?: string;
  totalStudents: number;
  needingAttentionCount: number;
  pendingCount: number;
  resolvedCount: number;
  studentsNeedingAttention: StudentAttentionStatus[];
  studentsPending: StudentAttentionStatus[];
}

/**
 * Full attention state for dashboard
 */
export interface DashboardAttentionState {
  studentsNeedingAttention: StudentAttentionStatus[];
  totalNeedingAttention: number;
  assignmentSummaries: AssignmentAttentionSummary[];
  pendingCount: number;
}

/**
 * Attention counts for dashboard badges
 */
export interface AttentionCounts {
  totalNeedingAttention: number;
  pendingCount: number;
  byAssignment: Record<string, number>;
}

// ============================================
// Attention State API Functions
// ============================================

/**
 * Get full dashboard attention state.
 * This is the single source of truth for all "needs attention" UI.
 */
export async function getDashboardAttentionState(): Promise<DashboardAttentionState> {
  return fetchJson(`${API_BASE}/attention`);
}

/**
 * Get students needing attention with optional filtering.
 */
export async function getStudentsNeedingAttention(options?: {
  assignmentId?: string;
  classId?: string;
}): Promise<{ students: StudentAttentionStatus[]; count: number }> {
  const params = new URLSearchParams();
  if (options?.assignmentId) params.set("assignmentId", options.assignmentId);
  if (options?.classId) params.set("classId", options.classId);

  const queryString = params.toString();
  const url = queryString
    ? `${API_BASE}/attention/students?${queryString}`
    : `${API_BASE}/attention/students`;

  return fetchJson(url);
}

/**
 * Get attention summary for a specific assignment.
 */
export async function getAssignmentAttentionSummary(
  assignmentId: string
): Promise<AssignmentAttentionSummary> {
  return fetchJson(`${API_BASE}/attention/assignment/${assignmentId}`);
}

/**
 * Get attention counts for dashboard badges.
 */
export async function getAttentionCounts(): Promise<AttentionCounts> {
  return fetchJson(`${API_BASE}/attention/counts`);
}

/**
 * Check if a specific student needs attention.
 */
export async function checkStudentAttention(
  studentId: string,
  assignmentId?: string
): Promise<{
  studentId: string;
  needsAttention: boolean;
  activeRecommendationCount: number;
  pendingRecommendationCount: number;
  activeRecommendationIds: string[];
  pendingRecommendationIds: string[];
}> {
  const params = new URLSearchParams();
  if (assignmentId) params.set("assignmentId", assignmentId);

  const queryString = params.toString();
  const url = queryString
    ? `${API_BASE}/attention/student/${studentId}?${queryString}`
    : `${API_BASE}/attention/student/${studentId}`;

  return fetchJson(url);
}
