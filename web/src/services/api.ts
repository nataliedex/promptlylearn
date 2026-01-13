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
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(error.error || `HTTP error ${response.status}`);
  }

  return response.json();
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

// Lessons
export async function getLessons(): Promise<LessonSummary[]> {
  return fetchJson(`${API_BASE}/lessons`);
}

export async function getLesson(id: string): Promise<Lesson> {
  return fetchJson(`${API_BASE}/lessons/${id}`);
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
  return fetchJson(`${API_BASE}/voice/speak`, {
    method: "POST",
    body: JSON.stringify({ text, voice }),
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
