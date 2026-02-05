const API_BASE = "http://localhost:3001/api";

// Types (matching backend domain)
export interface Student {
  id: string;
  name: string;
  studentCode?: string;
  isDemo?: boolean;
  preferredName?: string;
  pronouns?: string;
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
  inputSource?: "typed" | "voice";
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
  status: "in_progress" | "paused" | "completed";
  currentPromptIndex?: number;
  educatorNotes?: string;

  // Pause state fields (for "Take a break" feature)
  pausedAt?: string;
  mode?: "voice" | "type";
  wasRecording?: boolean;
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

/**
 * Get all assignment records for a student with reviewState
 */
export interface StudentAssignmentRecord {
  id: string;
  lessonId: string;
  lessonTitle: string;
  subject?: string;
  totalQuestions: number;
  classId: string;
  studentId: string;
  assignedAt: string;
  dueDate?: string; // Optional due date (ISO string, date only)
  completedAt?: string;
  attempts: number;
  reviewState: ReviewState;
  lastActionAt?: string;
  todoIds?: string[];
  badgeIds?: string[];
  reviewedAt?: string;
  reviewedBy?: string;
}

export async function getStudentAssignments(studentId: string): Promise<{
  studentId: string;
  studentName: string;
  assignments: StudentAssignmentRecord[];
  count: number;
}> {
  return fetchJson(`${API_BASE}/students/${studentId}/assignments`);
}

/**
 * Login student by studentCode (primary login method)
 */
export async function loginWithCode(code: string): Promise<{ student: Student }> {
  return fetchJson(`${API_BASE}/students/login/${encodeURIComponent(code)}`);
}

/**
 * Create or find a student (demo mode only)
 */
export async function createOrFindStudent(
  name: string,
  isDemo?: boolean
): Promise<{ student: Student; isNew: boolean }> {
  return fetchJson(`${API_BASE}/students`, {
    method: "POST",
    body: JSON.stringify({ name, isDemo }),
  });
}

export interface StudentLessonSummary extends LessonSummary {
  attempts: number;
  assignedAt?: string;
  dueDate?: string; // Optional due date (ISO string, date only)
  className?: string;
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

// ============================================
// Student Badges & Notes
// ============================================

/**
 * Badge types available in the system
 */
export type StudentBadgeType =
  | "progress_star"
  | "mastery_badge"
  | "effort_award"
  | "helper_badge"
  | "persistence"
  | "curiosity"
  | "custom";

/**
 * Badge evidence for student-facing display
 */
export interface BadgeEvidence {
  previousScore?: number;
  currentScore?: number;
  improvement?: number;
  subjectAverageScore?: number;
  subjectAssignmentCount?: number;
  hintUsageRate?: number;
}

/**
 * Student-facing badge structure
 */
export interface StudentBadge {
  id: string;
  badgeType: StudentBadgeType;
  badgeTypeName: string;
  subject?: string;
  assignmentId?: string;
  assignmentTitle?: string;
  awardedAt: string;
  awardedBy?: string;
  reason?: string;
  evidence?: BadgeEvidence;
  celebratedAt?: string; // When the student was shown a celebration for this badge
}

/**
 * Response from GET /students/:id/badges
 */
export interface StudentBadgesResponse {
  studentId: string;
  studentName: string;
  badges: StudentBadge[];
  count: number;
}

/**
 * Student-facing note structure
 */
export interface StudentNote {
  id: string;
  createdAt: string;
  teacherName: string;
  subject?: string;
  assignmentId?: string;
  assignmentTitle?: string;
  attemptNumber?: number;
  noteText: string;
  source: "session" | "recommendation";
}

/**
 * Response from GET /students/:id/notes
 */
export interface StudentNotesResponse {
  studentId: string;
  studentName: string;
  notes: StudentNote[];
  count: number;
}

/**
 * Get badges awarded to a specific student.
 */
export async function getStudentBadges(studentId: string): Promise<StudentBadgesResponse> {
  return fetchJson(`${API_BASE}/students/${studentId}/badges`);
}

/**
 * Mark a badge as celebrated (shown to student).
 */
export async function markBadgeCelebrated(
  studentId: string,
  badgeId: string
): Promise<{ success: boolean; celebratedAt: string }> {
  return fetchJson(`${API_BASE}/students/${studentId}/badges/${badgeId}/mark-celebrated`, {
    method: "POST",
  });
}

/**
 * Get teacher notes for a specific student.
 */
export async function getStudentNotes(studentId: string): Promise<StudentNotesResponse> {
  return fetchJson(`${API_BASE}/students/${studentId}/notes`);
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

export async function deleteLesson(id: string): Promise<{ success: boolean; message: string }> {
  return fetchJson(`${API_BASE}/lessons/${id}`, {
    method: "DELETE",
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
/**
 * Fetch sessions with optional filters.
 * @param studentId - Filter by student ID
 * @param status - Filter by status ("in_progress", "completed", "paused")
 * @param audience - "student" for privacy-filtered data (no system notes), omit for full data
 */
export async function getSessions(
  studentId?: string,
  status?: string,
  audience?: "student" | "educator"
): Promise<Session[]> {
  const params = new URLSearchParams();
  if (studentId) params.set("studentId", studentId);
  if (status) params.set("status", status);
  if (audience) params.set("audience", audience);
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
  difficulty: string,
  options?: { focus?: string; subject?: string; gradeLevel?: string }
): Promise<Prompt> {
  return fetchJson(`${API_BASE}/lessons/generate-question`, {
    method: "POST",
    body: JSON.stringify({
      lessonContext,
      existingQuestions,
      difficulty,
      ...(options?.focus && { focus: options.focus }),
      ...(options?.subject && { subject: options.subject }),
      ...(options?.gradeLevel && { gradeLevel: options.gradeLevel }),
    }),
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

// Voice Settings Types
export type CoachVoiceMode = "default_coach_voice" | "teacher_voice";

export interface VoiceSettings {
  coachVoiceMode: CoachVoiceMode;
  teacherVoiceId?: string;
  teacherVoiceName?: string;
  consentGiven?: boolean;
  consentDate?: string;
}

export async function getVoiceSettings(): Promise<VoiceSettings> {
  return fetchJson(`${API_BASE}/voice/settings`);
}

export async function updateVoiceSettings(settings: Partial<VoiceSettings>): Promise<VoiceSettings> {
  return fetchJson(`${API_BASE}/voice/settings`, {
    method: "POST",
    body: JSON.stringify(settings),
  });
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
  gradeLevel?: string,
  enrichmentMode?: boolean
): Promise<CoachChatResponse> {
  return fetchJson(`${API_BASE}/coach/chat`, {
    method: "POST",
    body: JSON.stringify({
      studentName,
      topics,
      message,
      conversationHistory,
      gradeLevel,
      enrichmentMode,
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
  assignedAt?: string; // ISO date string of earliest assignment
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
 * TEACHER REVIEW STATE (teacher workflow)
 * =========================================
 * Each student-assignment pair has ONE teacher review state, DERIVED from underlying data:
 * - not_started: Student has not submitted work yet (no submission to review)
 * - pending_review: Student submitted, teacher hasn't reviewed
 * - reviewed: Teacher reviewed, no follow-up scheduled
 * - followup_scheduled: Teacher reviewed + at least one open follow-up
 * - resolved: All follow-ups completed/dismissed
 *
 * IMPORTANT: On teacher-facing UIs:
 * - "not_started" should display as "—" or be hidden (there's nothing to review)
 * - "pending_review" should display as "Needs review" (not "Not started" or "Awaiting review")
 */
export type ReviewState =
  | "not_started"
  | "pending_review"
  | "reviewed"
  | "followup_scheduled"
  | "resolved";

/**
 * TEACHER REVIEW labels - for teacher workflow status
 * These indicate what ACTION the teacher needs to take, not student progress
 */
export const REVIEW_STATE_LABELS: Record<ReviewState, string> = {
  not_started: "Not started",     // No submission to review
  pending_review: "Needs review", // CHANGED from "Awaiting review"
  reviewed: "Reviewed",
  followup_scheduled: "Follow-up scheduled",
  resolved: "Reviewed",
};

/**
 * UI configuration for review state badges
 */
export const REVIEW_STATE_CONFIG: Record<ReviewState, { bg: string; color: string; icon: string }> = {
  not_started: { bg: "#f1f5f9", color: "#94a3b8", icon: "" },   // Muted - nothing to do
  pending_review: { bg: "#fff7ed", color: "#ea580c", icon: "" }, // Orange - action needed
  reviewed: { bg: "#e8f5e9", color: "#166534", icon: "" },      // Green - done
  followup_scheduled: { bg: "#fef3c7", color: "#b45309", icon: "" }, // Amber - has follow-up
  resolved: { bg: "#e8f5e9", color: "#166534", icon: "" },      // Green - follow-ups complete
};

/**
 * STUDENT PROGRESS STATUS (student fact)
 * ======================================
 * Describes what the STUDENT has done, independent of teacher review.
 * Used for "Student Progress" column in tables.
 */
export type StudentProgressStatus =
  | "not_submitted"  // Student hasn't submitted anything yet
  | "in_progress"    // Student started but hasn't submitted (optional)
  | "submitted"      // Student has submitted
  | "resubmitted";   // Student resubmitted after reassignment

export const STUDENT_PROGRESS_LABELS: Record<StudentProgressStatus, string> = {
  not_submitted: "Not submitted",
  in_progress: "In progress",
  submitted: "Submitted",
  resubmitted: "Resubmitted",
};

export const STUDENT_PROGRESS_CONFIG: Record<StudentProgressStatus, { bg: string; color: string }> = {
  not_submitted: { bg: "#f1f5f9", color: "#64748b" },
  in_progress: { bg: "#e0f2fe", color: "#0369a1" },
  submitted: { bg: "#dcfce7", color: "#166534" },
  resubmitted: { bg: "#dbeafe", color: "#2563eb" },
};

/**
 * Derive student progress status from assignment data
 */
export function getStudentProgressStatus(
  completedAt?: string,
  attempts?: number
): StudentProgressStatus {
  if (!completedAt) {
    return "not_submitted";
  }
  if (attempts && attempts > 1) {
    return "resubmitted";
  }
  return "submitted";
}

/**
 * Derive teacher review status label for display
 * This is what should appear in "Teacher Review" columns
 */
export function getTeacherReviewLabel(reviewState: ReviewState): string {
  return REVIEW_STATE_LABELS[reviewState];
}

/**
 * Check if a review state indicates the submission has been seen by teacher
 */
export function isReviewedState(state: ReviewState): boolean {
  return state !== "not_started" && state !== "pending_review";
}

/**
 * Check if a review state has a follow-up
 */
export function hasFollowupState(state: ReviewState): boolean {
  return state === "followup_scheduled";
}

/**
 * Check if there's a submission that needs teacher attention
 */
export function needsTeacherReview(state: ReviewState): boolean {
  return state === "pending_review";
}

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
  teacherId?: string;
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
  dueDate?: string; // Optional due date (ISO string, date only)
  // Completion tracking
  completedAt?: string;
  attempts: number;
  // Review tracking (canonical)
  reviewState: ReviewState;
  lastActionAt?: string;
  todoIds?: string[];
  badgeIds?: string[];
  // Legacy review tracking (deprecated)
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
    body: JSON.stringify({
      ...input,
      teacherId: input.teacherId || "default-teacher",
    }),
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
  studentIds?: string[],
  dueDate?: string
): Promise<AssignLessonResponse> {
  return fetchJson(`${API_BASE}/lessons/${lessonId}/assign`, {
    method: "POST",
    body: JSON.stringify({ classId, studentIds, dueDate }),
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
  assignments: Record<string, {
    attempts: number;
    completedAt?: string;
    reviewedAt?: string;
    reviewState: ReviewState;
    lastActionAt?: string;
    todoIds?: string[];
    badgeIds?: string[];
    /** @deprecated Use reviewState instead */
    actionStatus?: StudentActionStatus;
    /** @deprecated Use lastActionAt instead */
    actionAt?: string;
  }>;
  classId?: string;
  className?: string;
  earliestAssignedAt?: string; // ISO date string of earliest assignment
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
): Promise<{ success: boolean; lessonId: string; studentId: string; reviewedAt: string; reviewState: ReviewState }> {
  return fetchJson(`${API_BASE}/lessons/${lessonId}/students/${studentId}/review`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

/**
 * Unmark a student's assignment as reviewed (reset to pending_review).
 * Used when teacher wants to undo the reviewed status.
 */
export async function unmarkStudentReviewed(
  lessonId: string,
  studentId: string
): Promise<{ success: boolean; lessonId: string; studentId: string; reviewState: ReviewState }> {
  return fetchJson(`${API_BASE}/lessons/${lessonId}/students/${studentId}/review-state`, {
    method: "POST",
    body: JSON.stringify({ reviewState: "pending_review" }),
  });
}

/**
 * Append a system note to the latest completed session for a student+assignment.
 * Used after an undo window expires to finalize review notes.
 */
export async function appendSystemNote(
  lessonId: string,
  studentId: string,
  note: string
): Promise<{ success: boolean }> {
  return fetchJson(`${API_BASE}/lessons/${lessonId}/students/${studentId}/append-note`, {
    method: "POST",
    body: JSON.stringify({ note }),
  });
}

/**
 * Push an assignment back to a student for another attempt.
 * Clears completion/review status and increments attempts counter.
 */
export async function pushAssignmentToStudent(
  lessonId: string,
  studentId: string
): Promise<{ success: boolean; lessonId: string; studentId: string; attempts: number; reviewState: ReviewState; message: string }> {
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
  previousReviewedAt?: string,
  previousReviewState?: ReviewState
): Promise<{ success: boolean; lessonId: string; studentId: string; attempts: number; completedAt?: string; reviewedAt?: string; reviewState?: ReviewState; message: string }> {
  return fetchJson(`${API_BASE}/lessons/${lessonId}/students/${studentId}/undo-reassignment`, {
    method: "POST",
    body: JSON.stringify({ previousCompletedAt, previousReviewedAt, previousReviewState }),
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

/**
 * Submit review actions for a student's assignment.
 * This is the main action endpoint for the student review page.
 *
 * Allows teachers to:
 * - Award Badge (with type and optional message)
 * - Create a teacher to-do
 * - Mark as reviewed (always happens)
 * - Resolve related recommendations (always happens)
 */
export interface SubmitReviewActionsRequest {
  awardBadgeType?: string;
  badgeMessage?: string;
  createTodo?: boolean;
  todoActionKey?: string;  // ChecklistActionKey like "check_in_1to1"
  todoCustomLabel?: string; // Custom to-do text when todoActionKey is "custom"
  recommendationId?: string; // Links created to-do back to the source recommendation
  teacherId?: string;
}

export interface SubmitReviewActionsResponse {
  success: boolean;
  lessonId: string;
  studentId: string;
  reviewedAt: string;
  reviewState: ReviewState;
  badge?: { id: string; type: string };
  todo?: { id: string; label: string };
  reviewed: boolean;
  resolvedRecommendations: number;
}

export async function submitReviewActions(
  lessonId: string,
  studentId: string,
  actions: SubmitReviewActionsRequest
): Promise<SubmitReviewActionsResponse> {
  return fetchJson(`${API_BASE}/lessons/${lessonId}/students/${studentId}/review-actions`, {
    method: "POST",
    body: JSON.stringify(actions),
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
// Recommendations API (Recommended Actions)
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
 * EXCLUDES: Acknowledge Progress, Extend Learning, Monitor, etc.
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
  studentId?: string;
  includeReviewed?: boolean;
  status?: "active" | "pending" | "resolved" | "reviewed" | "all";
}): Promise<RecommendationsResponse> {
  const params = new URLSearchParams();
  if (options?.limit) params.set("limit", options.limit.toString());
  if (options?.assignmentId) params.set("assignmentId", options.assignmentId);
  if (options?.studentId) params.set("studentId", options.studentId);
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
 * Reactivate a recommendation (return to active status).
 */
export async function reactivateRecommendation(
  id: string
): Promise<{ success: boolean; recommendation: Recommendation }> {
  return fetchJson(`${API_BASE}/recommendations/${id}/reactivate`, {
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
 * Award Badge to a student.
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
 * - award_badge: Award Badge
 * - add_note: Add a teacher note
 *
 * SOFT ACTIONS (logged but no system mutation):
 * - run_small_group_review: Schedule a group review session
 * - review_responses: Review student responses
 * - prepare_targeted_practice: Prepare targeted practice
 * - check_in_1to1: Schedule Check-In
 * - discuss_extension: Plan Extension Activity
 * - explore_peer_tutoring: Consider Peer Support
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
  | "acknowledge_progress"
  | "invite_coaching_session";

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
  requiresCoachingDetails?: boolean;
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
    label: "Award Badge",
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
    label: "Schedule Check-In",
    isSystemAction: false,
  },
  discuss_extension: {
    key: "discuss_extension",
    label: "Plan Extension Activity",
    isSystemAction: false,
  },
  explore_peer_tutoring: {
    key: "explore_peer_tutoring",
    label: "Consider Peer Support",
    isSystemAction: false,
  },
  acknowledge_progress: {
    key: "acknowledge_progress",
    label: "Acknowledge their progress",
    isSystemAction: false,
  },
  invite_coaching_session: {
    key: "invite_coaching_session",
    label: "Invite to coaching session",
    description: "Push a special coaching session invitation",
    isSystemAction: true,
    requiresCoachingDetails: true,
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
      actions.push("invite_coaching_session");
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
  // Coaching session details (for invite_coaching_session action)
  coachingTitle?: string;
  coachingNote?: string;
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

export type TeacherTodoStatus = "open" | "done" | "superseded";

/**
 * A teacher to-do item created from soft checklist actions.
 */
export type RecommendationCategory =
  | "Needs Support"
  | "Developing"
  | "Ready for Challenge"
  | "Celebrate Progress"
  | "Group Support"
  | "Monitor";

export interface TeacherTodo {
  id: string;
  teacherId: string;
  recommendationId: string;

  // Action details
  actionKey: ChecklistActionKey;
  label: string;
  category?: RecommendationCategory;

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
  supersededAt?: string;
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
 * A single todo with context for display
 */
export interface TodoWithContext {
  todo: TeacherTodo;
  contextLine: string; // e.g., "Math · Division Basics"
}

/**
 * Todos grouped by student for the To-Do panel
 */
export interface TodosByStudent {
  studentId: string;
  studentName: string;
  todos: TodoWithContext[];
}

/**
 * Format an assignment ID as a readable title.
 * Converts "exploring-the-ocean" to "Exploring the Ocean"
 */
function formatAssignmentId(id: string): string {
  return id
    .split("-")
    .map((word, index) => {
      // Capitalize first word and other important words
      if (index === 0 || !["the", "a", "an", "and", "or", "of", "in", "on", "at", "to", "for"].includes(word)) {
        return word.charAt(0).toUpperCase() + word.slice(1);
      }
      return word;
    })
    .join(" ");
}

/**
 * Build a context line from todo fields.
 * Format: "Subject · Assignment Title" (only includes fields that exist)
 */
export function buildTodoContextLine(todo: TeacherTodo): string {
  const parts: string[] = [];

  if (todo.subject) {
    parts.push(todo.subject);
  }

  // Use assignmentTitle if available, otherwise format assignmentId
  if (todo.assignmentTitle) {
    parts.push(todo.assignmentTitle);
  } else if (todo.assignmentId) {
    parts.push(formatAssignmentId(todo.assignmentId));
  }

  return parts.join(" · ");
}

/**
 * Group todos by student for the Teacher To-Do panel.
 * For todos with multiple studentIds, creates a separate entry for each student.
 */
export function groupTodosByStudent(todos: TeacherTodo[]): TodosByStudent[] {
  const studentMap = new Map<string, {
    studentId: string;
    studentName: string;
    todos: TodoWithContext[];
  }>();

  for (const todo of todos) {
    const contextLine = buildTodoContextLine(todo);

    // If todo has studentIds, create entry per student
    if (todo.studentIds && todo.studentIds.length > 0) {
      // Parse studentNames (comma-separated) to match with studentIds
      const names = todo.studentNames?.split(",").map(n => n.trim()) || [];

      for (let i = 0; i < todo.studentIds.length; i++) {
        const studentId = todo.studentIds[i];
        const studentName = names[i] || studentId;

        if (!studentMap.has(studentId)) {
          studentMap.set(studentId, {
            studentId,
            studentName,
            todos: [],
          });
        }

        studentMap.get(studentId)!.todos.push({
          todo,
          contextLine,
        });
      }
    } else if (todo.studentNames) {
      // Fallback: use studentNames as key if no studentIds
      const key = todo.studentNames;
      if (!studentMap.has(key)) {
        studentMap.set(key, {
          studentId: key,
          studentName: todo.studentNames,
          todos: [],
        });
      }
      studentMap.get(key)!.todos.push({
        todo,
        contextLine,
      });
    } else {
      // No student info - put under "General"
      const key = "__no_student__";
      if (!studentMap.has(key)) {
        studentMap.set(key, {
          studentId: key,
          studentName: "General",
          todos: [],
        });
      }
      studentMap.get(key)!.todos.push({
        todo,
        contextLine,
      });
    }
  }

  // Convert to array and sort by student name
  const result = Array.from(studentMap.values());
  result.sort((a, b) => {
    // Put "General" at the end
    if (a.studentName === "General") return 1;
    if (b.studentName === "General") return -1;
    return a.studentName.localeCompare(b.studentName);
  });

  return result;
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
 * @param id - The todo ID to delete
 * @param reactivateRecommendation - If true, returns the associated recommendation to active status
 */
export async function deleteTeacherTodo(
  id: string,
  reactivateRecommendation?: boolean
): Promise<{ success: boolean; reactivatedRecommendation?: boolean }> {
  const params = new URLSearchParams();
  if (reactivateRecommendation) {
    params.set("reactivateRecommendation", "true");
  }

  const queryString = params.toString();
  const url = queryString
    ? `${API_BASE}/teacher-todos/${id}?${queryString}`
    : `${API_BASE}/teacher-todos/${id}`;

  return fetchJson(url, {
    method: "DELETE",
  });
}

/**
 * Supersede a teacher todo (mark as inactive due to review reopen).
 * The todo is retained for historical record but excluded from active views.
 */
export async function supersedeTeacherTodo(
  id: string
): Promise<{ success: boolean; todo: TeacherTodo; totalOpen: number }> {
  return fetchJson(`${API_BASE}/teacher-todos/${id}/supersede`, {
    method: "POST",
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

// ============================================
// Coaching Invites Types (Teacher-Pushed Enrichment)
// ============================================

export type CoachingInviteStatus = "pending" | "started" | "completed" | "dismissed";
export type CoachingMode = "enrichment" | "support" | "general";

/**
 * AI guardrails for a coaching session
 */
export interface CoachingGuardrails {
  mode: CoachingMode;
  difficultyDelta: number;
  allowedTopics: string[];
  disallowed: string[];
}

/**
 * A teacher-pushed enrichment coaching session invitation
 */
export interface CoachingInvite {
  id: string;
  teacherId: string;
  studentId: string;
  classId?: string;
  subject: string;
  assignmentId?: string;
  assignmentTitle?: string;
  title: string;
  teacherNote?: string;
  guardrails: CoachingGuardrails;
  status: CoachingInviteStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  lastActivityAt?: string;
  dismissedAt?: string;
  sourceRecommendationId?: string;
  messageCount?: number;
}

/**
 * Response from coaching invites endpoints
 */
export interface CoachingInvitesResponse {
  invites: CoachingInvite[];
  counts: {
    pending: number;
    started: number;
    completed: number;
    dismissed: number;
    total: number;
  };
}

/**
 * Input for creating a coaching invite
 */
export interface CreateCoachingInviteInput {
  teacherId?: string;
  studentId: string;
  classId?: string;
  subject: string;
  assignmentId?: string;
  assignmentTitle?: string;
  title: string;
  teacherNote?: string;
  sourceRecommendationId?: string;
}

// ============================================
// Coaching Invites API Functions
// ============================================

/**
 * Create a new coaching invite (teacher action).
 */
export async function createCoachingInvite(
  input: CreateCoachingInviteInput
): Promise<{ success: boolean; invite: CoachingInvite }> {
  return fetchJson(`${API_BASE}/coaching-invites`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * Get coaching invites with optional filtering.
 */
export async function getCoachingInvites(options?: {
  teacherId?: string;
  studentId?: string;
  status?: CoachingInviteStatus;
}): Promise<CoachingInvitesResponse> {
  const params = new URLSearchParams();
  if (options?.teacherId) params.set("teacherId", options.teacherId);
  if (options?.studentId) params.set("studentId", options.studentId);
  if (options?.status) params.set("status", options.status);

  const queryString = params.toString();
  const url = queryString
    ? `${API_BASE}/coaching-invites?${queryString}`
    : `${API_BASE}/coaching-invites`;

  return fetchJson(url);
}

/**
 * Get a single coaching invite by ID.
 */
export async function getCoachingInvite(id: string): Promise<{ invite: CoachingInvite }> {
  return fetchJson(`${API_BASE}/coaching-invites/${id}`);
}

/**
 * Get coaching invites for a specific student.
 */
export async function getStudentCoachingInvites(
  studentId: string,
  status?: CoachingInviteStatus
): Promise<CoachingInvitesResponse> {
  const params = new URLSearchParams();
  if (status) params.set("status", status);

  const queryString = params.toString();
  const url = queryString
    ? `${API_BASE}/coaching-invites/student/${studentId}?${queryString}`
    : `${API_BASE}/coaching-invites/student/${studentId}`;

  return fetchJson(url);
}

/**
 * Mark a coaching invite as started (student action).
 */
export async function startCoachingInvite(
  inviteId: string
): Promise<{ success: boolean; invite: CoachingInvite }> {
  return fetchJson(`${API_BASE}/coaching-invites/${inviteId}/start`, {
    method: "POST",
  });
}

/**
 * Mark a coaching invite as completed (student action).
 */
export async function completeCoachingInvite(
  inviteId: string,
  messageCount?: number
): Promise<{ success: boolean; invite: CoachingInvite }> {
  return fetchJson(`${API_BASE}/coaching-invites/${inviteId}/complete`, {
    method: "POST",
    body: JSON.stringify({ messageCount }),
  });
}

/**
 * Dismiss a coaching invite (student action).
 */
export async function dismissCoachingInvite(
  inviteId: string
): Promise<{ success: boolean; invite: CoachingInvite }> {
  return fetchJson(`${API_BASE}/coaching-invites/${inviteId}/dismiss`, {
    method: "POST",
  });
}

/**
 * Update activity on a coaching invite.
 */
export async function updateCoachingInviteActivity(
  inviteId: string,
  messageCount?: number
): Promise<{ success: boolean; invite: CoachingInvite }> {
  return fetchJson(`${API_BASE}/coaching-invites/${inviteId}/activity`, {
    method: "POST",
    body: JSON.stringify({ messageCount }),
  });
}

// ============================================
// Profile Types and API (v1)
// ============================================

/**
 * Coach communication tone preference
 */
export type CoachTone = "supportive" | "direct" | "structured";

/**
 * Voice mode for coach
 */
export type CoachVoiceMode = "default_coach_voice" | "teacher_voice";

/**
 * Teacher voice configuration
 */
export interface TeacherVoiceConfig {
  provider: "elevenlabs" | "openai" | "none";
  voiceId?: string;
  voiceName?: string;
  consentGiven: boolean;
  consentDate?: string;
}

/**
 * Teacher Profile (educator view)
 */
export interface TeacherProfile {
  id: string;
  /** Internal/admin full name - not shown to students */
  fullName: string;
  /** What students see in the app (e.g., "Mrs. Blumen") */
  studentFacingName: string;
  /** Pronouns (shown to students) */
  pronouns?: string;
  coachTone: CoachTone;
  coachVoiceMode: CoachVoiceMode;
  teacherVoice?: TeacherVoiceConfig;
  createdAt: string;
  updatedAt: string;
}

/**
 * Teacher profile update payload
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
 * Student input preference
 */
export type InputPreference = "voice" | "typing" | "no_preference";

/**
 * Student pacing preference
 */
export type PacePreference = "take_my_time" | "keep_it_moving";

/**
 * Coach help style preference
 */
export type CoachHelpStyle = "hints_first" | "examples_first" | "ask_me_questions";

/**
 * Student accommodations (educator view includes notes)
 */
export interface StudentAccommodations {
  extraTime?: boolean;
  readAloud?: boolean;
  reducedDistractions?: boolean;
  notes?: string; // EDUCATOR ONLY - not in student view
}

/**
 * Student Profile (educator view - full)
 */
export interface StudentProfileFull {
  id: string;
  legalName: string;
  preferredName: string;
  pronouns?: string;
  classIds: string[];
  gradeLevel?: string;
  inputPreference: InputPreference;
  pacePreference: PacePreference;
  coachHelpStyle: CoachHelpStyle;
  accommodations?: StudentAccommodations;
  createdAt: string;
  updatedAt: string;
}

/**
 * Student Profile (student view - sanitized)
 * EXCLUDES: legalName, accommodations.notes
 */
export interface StudentProfilePublic {
  id: string;
  preferredName: string;
  pronouns?: string;
  inputPreference: InputPreference;
  pacePreference: PacePreference;
  coachHelpStyle: CoachHelpStyle;
  accommodations?: Omit<StudentAccommodations, "notes">;
}

/**
 * Student profile update payload (educator only)
 */
export interface StudentProfileUpdate {
  legalName?: string;
  preferredName?: string;
  pronouns?: string;
  gradeLevel?: string;
  inputPreference?: InputPreference;
  pacePreference?: PacePreference;
  coachHelpStyle?: CoachHelpStyle;
  accommodations?: StudentAccommodations;
}

// ============================================
// Profile API Functions
// ============================================

/**
 * Get the current teacher's profile
 */
export async function getTeacherProfile(): Promise<TeacherProfile> {
  return fetchJson(`${API_BASE}/educator/profile`);
}

/**
 * Update the current teacher's profile
 */
export async function updateTeacherProfile(
  updates: TeacherProfileUpdate
): Promise<TeacherProfile> {
  return fetchJson(`${API_BASE}/educator/profile`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

/**
 * Get a student's full profile (educator only)
 */
export async function getStudentProfileFull(
  studentId: string
): Promise<{
  profile: StudentProfileFull;
  student: { id: string; name: string; studentCode?: string; isDemo?: boolean };
}> {
  return fetchJson(`${API_BASE}/educator/students/${studentId}/profile`);
}

/**
 * Regenerate a student's login code (educator only)
 */
export async function regenerateStudentCode(
  studentId: string
): Promise<{ studentCode: string }> {
  return fetchJson(`${API_BASE}/students/${studentId}/regenerate-code`, {
    method: "POST",
  });
}

/**
 * Update a student's profile (educator only)
 */
export async function updateStudentProfile(
  studentId: string,
  updates: StudentProfileUpdate
): Promise<{ profile: StudentProfileFull }> {
  return fetchJson(`${API_BASE}/educator/students/${studentId}/profile`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

/**
 * Get a student's profile (student view - sanitized)
 * PRIVACY: Does not include legalName or accommodations.notes
 */
export async function getStudentProfilePublic(
  studentId: string
): Promise<StudentProfilePublic> {
  return fetchJson(`${API_BASE}/educator/student-profile/${studentId}`);
}

// ============================================
// Lesson Drafts API
// ============================================

/**
 * Lesson Draft - an in-progress lesson that hasn't been created yet
 */
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

/**
 * Input for creating or updating a lesson draft
 */
export interface LessonDraftInput {
  title?: string;
  subject?: string;
  gradeLevel?: string;
  questionCount?: number;
  description?: string;
  assignToClassId?: string;
}

/**
 * List all lesson drafts
 */
export async function getLessonDrafts(): Promise<{
  drafts: LessonDraft[];
  count: number;
}> {
  return fetchJson(`${API_BASE}/educator/lesson-drafts`);
}

/**
 * Get a specific lesson draft by ID
 */
export async function getLessonDraft(id: string): Promise<{ draft: LessonDraft }> {
  return fetchJson(`${API_BASE}/educator/lesson-drafts/${id}`);
}

/**
 * Create a new lesson draft
 */
export async function createLessonDraft(
  input: LessonDraftInput
): Promise<{ draft: LessonDraft }> {
  return fetchJson(`${API_BASE}/educator/lesson-drafts`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * Update an existing lesson draft
 */
export async function updateLessonDraft(
  id: string,
  updates: LessonDraftInput
): Promise<{ draft: LessonDraft }> {
  return fetchJson(`${API_BASE}/educator/lesson-drafts/${id}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

/**
 * Delete a lesson draft
 */
export async function deleteLessonDraft(
  id: string
): Promise<{ success: boolean; id: string }> {
  return fetchJson(`${API_BASE}/educator/lesson-drafts/${id}`, {
    method: "DELETE",
  });
}
