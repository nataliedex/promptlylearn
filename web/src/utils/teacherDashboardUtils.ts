/**
 * Teacher Dashboard Utility Functions
 *
 * These functions transform raw session data into teacher-friendly insights.
 * The goal is to surface "who needs help and why" - not to rank or judge students.
 */

import type { Session, PromptResponse, Lesson, LessonSummary, Student } from "../services/api";
import type {
  UnderstandingLevel,
  CoachSupportLevel,
  QuestionOutcome,
  AttentionReason,
  QuestionSummary,
  LearningJourneyInsights,
  StudentNeedingAttention,
  AssignmentSummaryCard,
  EducatorDashboardData,
  StudentAssignmentRow,
  AssignmentReviewData,
  StudentDrilldownData,
} from "../types/teacherDashboard";

// ============================================
// Understanding Level Calculation
// ============================================

/**
 * Derive understanding level from score.
 * Uses generous thresholds focused on growth, not perfection.
 */
export function deriveUnderstanding(score: number): UnderstandingLevel {
  if (score >= 70) return "strong";
  if (score >= 40) return "developing";
  return "needs-support";
}

/**
 * Derive understanding from question outcomes (more nuanced).
 */
export function deriveUnderstandingFromQuestions(
  questions: QuestionSummary[]
): UnderstandingLevel {
  if (questions.length === 0) return "needs-support";

  const demonstrated = questions.filter(
    (q) => q.outcome === "demonstrated"
  ).length;
  const developing = questions.filter(
    (q) => q.outcome === "developing" || q.outcome === "not-attempted"
  ).length;

  const demonstratedRatio = demonstrated / questions.length;
  const developingRatio = developing / questions.length;

  if (demonstratedRatio >= 0.7) return "strong";
  if (developingRatio > 0.5) return "needs-support";
  return "developing";
}

// ============================================
// Coach Support Level Calculation
// ============================================

/**
 * Derive coach support level from hint usage.
 */
export function deriveCoachSupport(
  hintsUsed: number,
  questionCount: number
): CoachSupportLevel {
  if (questionCount === 0) return "minimal";

  const hintRatio = hintsUsed / questionCount;

  if (hintRatio < 0.2) return "minimal";
  if (hintRatio > 0.5) return "significant";
  return "some";
}

// ============================================
// Question Outcome Calculation
// ============================================

/**
 * Determine the outcome of a question response.
 */
export function calculateQuestionOutcome(
  response: PromptResponse,
  score?: number
): QuestionOutcome {
  // No response = not attempted
  if (!response.response || response.response.trim().length === 0) {
    return "not-attempted";
  }

  // Use score if available, otherwise estimate
  const effectiveScore = score ?? (response.hintUsed ? 60 : 75);

  // Strong response without much help
  if (effectiveScore >= 70 && !response.hintUsed) {
    return "demonstrated";
  }

  // Got there with support
  if (effectiveScore >= 50) {
    return "with-support";
  }

  // Still developing
  return "developing";
}

// ============================================
// Attention Reasons Calculation
// ============================================

/**
 * Determine if student needs teacher attention and why.
 */
export function determineAttentionNeeded(
  understanding: UnderstandingLevel,
  coachSupport: CoachSupportLevel,
  isComplete: boolean,
  questions: QuestionSummary[]
): { needsReview: boolean; reasons: AttentionReason[] } {
  const reasons: AttentionReason[] = [];

  if (!isComplete && questions.length > 0) {
    reasons.push("incomplete");
  }

  if (understanding === "needs-support") {
    reasons.push("struggling-throughout");
  }

  if (coachSupport === "significant") {
    reasons.push("significant-coach-support");
  }

  // Check for inconsistency
  const hasStrong = questions.some((q) => q.outcome === "demonstrated");
  const hasStruggling = questions.some((q) => q.outcome === "developing");
  if (hasStrong && hasStruggling && questions.length >= 3) {
    reasons.push("inconsistent-understanding");
  }

  // Positive signal
  const recovered = questions.filter((q) => q.improvedAfterHelp).length;
  if (recovered >= 2) {
    reasons.push("improved-with-support");
  }

  // Only flag if there are concerning reasons
  const concerningReasons = reasons.filter((r) => r !== "improved-with-support");

  return {
    needsReview: concerningReasons.length > 0,
    reasons,
  };
}

// ============================================
// Display Helpers
// ============================================

/**
 * Get human-readable label for understanding level.
 */
export function getUnderstandingLabel(level: UnderstandingLevel): string {
  switch (level) {
    case "strong":
      return "Strong";
    case "developing":
      return "Developing";
    case "needs-support":
      return "Needs Support";
  }
}

/**
 * Get color for understanding level.
 */
export function getUnderstandingColor(level: UnderstandingLevel): string {
  switch (level) {
    case "strong":
      return "#2e7d32";
    case "developing":
      return "#ed6c02";
    case "needs-support":
      return "#d32f2f";
  }
}

/**
 * Get background color for understanding level.
 */
export function getUnderstandingBgColor(level: UnderstandingLevel): string {
  switch (level) {
    case "strong":
      return "#e8f5e9";
    case "developing":
      return "#fff3e0";
    case "needs-support":
      return "#ffebee";
  }
}

/**
 * Get human-readable label for coach support level.
 */
export function getCoachSupportLabel(level: CoachSupportLevel): string {
  switch (level) {
    case "minimal":
      return "Minimal";
    case "some":
      return "Some";
    case "significant":
      return "Significant";
  }
}

/**
 * Get human-readable label for question outcome.
 */
export function getQuestionOutcomeLabel(outcome: QuestionOutcome): string {
  switch (outcome) {
    case "demonstrated":
      return "Demonstrated Understanding";
    case "with-support":
      return "Succeeded with Support";
    case "developing":
      return "Still Developing";
    case "not-attempted":
      return "Not Attempted";
  }
}

/**
 * Get display info for attention reason.
 */
export function getAttentionReasonDisplay(
  reason: AttentionReason
): { label: string; isPositive: boolean } {
  switch (reason) {
    case "significant-coach-support":
      return { label: "Needed significant coach support", isPositive: false };
    case "inconsistent-understanding":
      return { label: "Inconsistent understanding", isPositive: false };
    case "incomplete":
      return { label: "Assignment incomplete", isPositive: false };
    case "struggling-throughout":
      return { label: "Had difficulty throughout", isPositive: false };
    case "improved-with-support":
      return { label: "Improved after getting help", isPositive: true };
  }
}

// ============================================
// Data Builders
// ============================================

/**
 * Build a question summary from response data.
 */
export function buildQuestionSummary(
  response: PromptResponse,
  index: number,
  prompt: { id: string; input: string; hints: string[] },
  score?: number
): QuestionSummary {
  const outcome = calculateQuestionOutcome(response, score);
  const usedHint = response.hintUsed ?? false;

  return {
    questionId: response.promptId,
    questionNumber: index + 1,
    questionText: prompt.input,
    outcome,
    usedHint,
    hintCount: usedHint ? 1 : 0,
    totalHintsAvailable: prompt.hints.length,
    improvedAfterHelp: usedHint && (outcome === "with-support" || outcome === "demonstrated"),
    studentResponse: response.response,
    hasVoiceRecording: !!response.audioBase64,
    audioBase64: response.audioBase64,
    audioFormat: response.audioFormat,
    teacherNote: response.educatorNote,
  };
}

/**
 * Build learning journey insights from questions.
 */
export function buildLearningInsights(
  questions: QuestionSummary[]
): LearningJourneyInsights {
  if (questions.length === 0) {
    return {
      startedStrong: false,
      improvedOverTime: false,
      struggledConsistently: false,
      recoveredWithSupport: false,
    };
  }

  const firstHalf = questions.slice(0, Math.ceil(questions.length / 2));
  const secondHalf = questions.slice(Math.ceil(questions.length / 2));

  const firstHalfStrong = firstHalf.filter(
    (q) => q.outcome === "demonstrated"
  ).length;
  const secondHalfStrong = secondHalf.filter(
    (q) => q.outcome === "demonstrated"
  ).length;

  const startedStrong = firstHalfStrong > firstHalf.length / 2;
  const improvedOverTime = secondHalf.length > 0 && secondHalfStrong > firstHalfStrong;
  const struggledConsistently = questions.every(
    (q) => q.outcome === "developing" || q.outcome === "not-attempted"
  );
  const recoveredWithSupport = questions.some((q) => q.improvedAfterHelp);

  return {
    startedStrong,
    improvedOverTime,
    struggledConsistently,
    recoveredWithSupport,
  };
}

/**
 * Build a student assignment row from session data.
 */
export function buildStudentRow(
  session: Session,
  lesson: Lesson
): StudentAssignmentRow {
  const questionsAnswered = session.submission.responses.length;
  const totalQuestions = lesson.prompts.length;
  const isComplete = session.status === "completed";

  // Build question summaries
  const questions = session.submission.responses.map((response, index) => {
    const prompt = lesson.prompts.find((p) => p.id === response.promptId);
    const criteriaScore = session.evaluation?.criteriaScores?.find(
      (c) => c.criterionId === response.promptId
    );
    return buildQuestionSummary(
      response,
      index,
      prompt || { id: response.promptId, input: "", hints: [] },
      criteriaScore?.score
    );
  });

  // Derive understanding from score
  const score = session.evaluation?.totalScore ?? 0;
  const understanding = deriveUnderstanding(score);

  // Derive coach support
  const hintsUsed = session.submission.responses.filter((r) => r.hintUsed).length;
  const coachSupport = deriveCoachSupport(hintsUsed, questionsAnswered);

  // Determine attention needed
  const { needsReview, reasons } = determineAttentionNeeded(
    understanding,
    coachSupport,
    isComplete,
    questions
  );

  return {
    studentId: session.studentId,
    studentName: session.studentName,
    isComplete,
    questionsAnswered,
    totalQuestions,
    understanding,
    coachSupport,
    needsReview,
    attentionReasons: reasons,
    hasTeacherNote: !!session.educatorNotes,
    sessionId: session.id,
  };
}

/**
 * Build full student drilldown data from session.
 */
export function buildStudentDrilldown(
  session: Session,
  lesson: Lesson
): StudentDrilldownData {
  // Build question summaries
  const questions = session.submission.responses.map((response, index) => {
    const prompt = lesson.prompts.find((p) => p.id === response.promptId);
    const criteriaScore = session.evaluation?.criteriaScores?.find(
      (c) => c.criterionId === response.promptId
    );
    return buildQuestionSummary(
      response,
      index,
      prompt || { id: response.promptId, input: "", hints: [] },
      criteriaScore?.score
    );
  });

  // Derive understanding
  const score = session.evaluation?.totalScore ?? 0;
  const understanding = deriveUnderstanding(score);

  // Derive coach support
  const hintsUsed = session.submission.responses.filter((r) => r.hintUsed).length;
  const coachSupport = deriveCoachSupport(hintsUsed, questions.length);

  // Determine attention needed
  const { needsReview, reasons } = determineAttentionNeeded(
    understanding,
    coachSupport,
    session.status === "completed",
    questions
  );

  // Build insights
  const insights = buildLearningInsights(questions);

  // Calculate time spent
  let timeSpentMinutes: number | undefined;
  if (session.completedAt && session.startedAt) {
    const start = new Date(session.startedAt).getTime();
    const end = new Date(session.completedAt).getTime();
    timeSpentMinutes = Math.round((end - start) / 60000);
  }

  return {
    studentId: session.studentId,
    studentName: session.studentName,
    assignmentId: lesson.id,
    assignmentTitle: lesson.title,
    completedAt: session.completedAt,
    isComplete: session.status === "completed",
    understanding,
    coachSupport,
    needsReview,
    attentionReasons: reasons,
    insights,
    questions,
    teacherNote: session.educatorNotes || "",
    sessionId: session.id,
    timeSpentMinutes,
  };
}

/**
 * Build assignment review data from sessions.
 */
export function buildAssignmentReview(
  lessonId: string,
  lessonTitle: string,
  sessions: Session[],
  lesson: Lesson,
  allStudentIds: string[],
  allStudentNames: Record<string, string>
): AssignmentReviewData {
  // Build rows for students who have sessions
  const studentRows = sessions.map((session) => buildStudentRow(session, lesson));

  // Add "not started" entries for students without sessions
  const sessionStudentIds = new Set(sessions.map((s) => s.studentId));
  const notStartedRows: StudentAssignmentRow[] = allStudentIds
    .filter((id) => !sessionStudentIds.has(id))
    .map((id) => ({
      studentId: id,
      studentName: allStudentNames[id] || "Unknown",
      isComplete: false,
      questionsAnswered: 0,
      totalQuestions: lesson.prompts.length,
      understanding: "needs-support" as UnderstandingLevel,
      coachSupport: "minimal" as CoachSupportLevel,
      needsReview: false,
      attentionReasons: [],
      hasTeacherNote: false,
    }));

  const allRows = [...studentRows, ...notStartedRows];

  // Calculate stats
  const completed = allRows.filter((s) => s.isComplete).length;
  const inProgress = allRows.filter(
    (s) => !s.isComplete && s.questionsAnswered > 0
  ).length;
  const notStarted = allRows.filter((s) => s.questionsAnswered === 0).length;
  const needingAttention = allRows.filter((s) => s.needsReview).length;

  // Calculate distribution (only for students who have started)
  const startedRows = allRows.filter((s) => s.questionsAnswered > 0);
  const strong = startedRows.filter((s) => s.understanding === "strong").length;
  const developing = startedRows.filter((s) => s.understanding === "developing").length;
  const needsSupport = startedRows.filter((s) => s.understanding === "needs-support").length;

  return {
    assignmentId: lessonId,
    title: lessonTitle,
    questionCount: lesson.prompts.length,
    stats: {
      completed,
      inProgress,
      notStarted,
      needingAttention,
    },
    distribution: {
      strong,
      developing,
      needsSupport,
    },
    students: allRows,
  };
}

/**
 * Build the main dashboard data from full lessons (with prompts).
 */
export function buildDashboardData(
  students: Student[],
  sessions: Session[],
  lessons: Lesson[]
): EducatorDashboardData {
  // Build student name lookup
  const studentNames: Record<string, string> = {};
  students.forEach((s) => {
    studentNames[s.id] = s.name;
  });

  // Build assignment cards
  const assignments: AssignmentSummaryCard[] = lessons.map((lesson) => {
    const lessonSessions = sessions.filter((s) => s.lessonId === lesson.id);
    const reviewData = buildAssignmentReview(
      lesson.id,
      lesson.title,
      lessonSessions,
      lesson,
      students.map((s) => s.id),
      studentNames
    );

    return {
      assignmentId: lesson.id,
      title: lesson.title,
      totalStudents: students.length,
      completedCount: reviewData.stats.completed,
      inProgressCount: reviewData.stats.inProgress,
      notStartedCount: reviewData.stats.notStarted,
      distribution: reviewData.distribution,
      studentsNeedingAttention: reviewData.stats.needingAttention,
    };
  });

  // Gather all students needing attention across assignments
  const studentsNeedingAttention: StudentNeedingAttention[] = [];

  lessons.forEach((lesson) => {
    const lessonSessions = sessions.filter((s) => s.lessonId === lesson.id);

    lessonSessions.forEach((session) => {
      const row = buildStudentRow(session, lesson);

      if (row.needsReview) {
        // Get the most significant reason
        const concerningReasons = row.attentionReasons.filter(
          (r) => r !== "improved-with-support"
        );
        const primaryReason = concerningReasons[0] || row.attentionReasons[0];
        const { label } = getAttentionReasonDisplay(primaryReason);

        studentsNeedingAttention.push({
          studentId: session.studentId,
          studentName: session.studentName,
          assignmentId: lesson.id,
          assignmentTitle: lesson.title,
          reason: primaryReason,
          reasonDescription: label,
          hasTeacherNote: !!session.educatorNotes,
        });
      }
    });
  });

  return {
    studentsNeedingAttention,
    assignments,
    totalStudents: students.length,
  };
}

/**
 * Build a simplified student row from session data (when full lesson not available).
 * Uses session data only without requiring full lesson prompts.
 */
function buildSimplifiedStudentRow(
  session: Session,
  promptCount: number
): { understanding: UnderstandingLevel; coachSupport: CoachSupportLevel; needsReview: boolean; reasons: AttentionReason[] } {
  const questionsAnswered = session.submission.responses.length;
  const isComplete = session.status === "completed";

  // Derive understanding from score
  const score = session.evaluation?.totalScore ?? 0;
  const understanding = deriveUnderstanding(score);

  // Derive coach support
  const hintsUsed = session.submission.responses.filter((r) => r.hintUsed).length;
  const coachSupport = deriveCoachSupport(hintsUsed, questionsAnswered);

  // Simplified attention check (without full question analysis)
  const reasons: AttentionReason[] = [];

  if (!isComplete && questionsAnswered > 0) {
    reasons.push("incomplete");
  }

  if (understanding === "needs-support") {
    reasons.push("struggling-throughout");
  }

  if (coachSupport === "significant") {
    reasons.push("significant-coach-support");
  }

  const needsReview = reasons.length > 0;

  return { understanding, coachSupport, needsReview, reasons };
}

/**
 * Build the main dashboard data from lesson summaries (without prompts).
 * This is a lighter version that doesn't require fetching full lesson details.
 */
export function buildDashboardDataFromSummaries(
  students: Student[],
  sessions: Session[],
  lessons: LessonSummary[]
): EducatorDashboardData {
  // Build assignment cards
  const assignments: AssignmentSummaryCard[] = lessons.map((lesson) => {
    const lessonSessions = sessions.filter((s) => s.lessonId === lesson.id);

    // Calculate completion stats
    const completedSessions = lessonSessions.filter((s) => s.status === "completed");
    const inProgressSessions = lessonSessions.filter((s) => s.status === "in_progress");
    const sessionStudentIds = new Set(lessonSessions.map((s) => s.studentId));

    // Calculate understanding distribution
    let strong = 0;
    let developing = 0;
    let needsSupport = 0;
    let needingAttention = 0;

    lessonSessions.forEach((session) => {
      const result = buildSimplifiedStudentRow(session, lesson.promptCount);

      if (result.understanding === "strong") strong++;
      else if (result.understanding === "developing") developing++;
      else needsSupport++;

      if (result.needsReview) needingAttention++;
    });

    return {
      assignmentId: lesson.id,
      title: lesson.title,
      totalStudents: students.length,
      completedCount: completedSessions.length,
      inProgressCount: inProgressSessions.length,
      notStartedCount: students.length - sessionStudentIds.size,
      distribution: {
        strong,
        developing,
        needsSupport,
      },
      studentsNeedingAttention: needingAttention,
    };
  });

  // Gather all students needing attention across assignments
  const studentsNeedingAttention: StudentNeedingAttention[] = [];

  lessons.forEach((lesson) => {
    const lessonSessions = sessions.filter((s) => s.lessonId === lesson.id);

    lessonSessions.forEach((session) => {
      const result = buildSimplifiedStudentRow(session, lesson.promptCount);

      if (result.needsReview) {
        const primaryReason = result.reasons[0];
        const { label } = getAttentionReasonDisplay(primaryReason);

        studentsNeedingAttention.push({
          studentId: session.studentId,
          studentName: session.studentName,
          assignmentId: lesson.id,
          assignmentTitle: lesson.title,
          reason: primaryReason,
          reasonDescription: label,
          hasTeacherNote: !!session.educatorNotes,
        });
      }
    });
  });

  return {
    studentsNeedingAttention,
    assignments,
    totalStudents: students.length,
  };
}
