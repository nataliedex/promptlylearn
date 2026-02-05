/**
 * Badge Context Builder Service
 *
 * Builds StudentBadgeContext from session, lesson, and badge data
 * for use by the badge criteria evaluator.
 */

import { SessionStore } from "../stores/sessionStore";
import { badgeStore } from "../stores/badgeStore";
import { getAllLessons, loadLessonById } from "../loaders/lessonLoader";
import { StudentBadgeContext } from "../domain/badgeCriteria";
import { Session } from "../domain/session";
import { Lesson } from "../domain/lesson";

// ============================================
// Helper Types
// ============================================

interface SessionWithLesson {
  session: Session;
  lesson: Lesson | null;
}

// ============================================
// Session Analysis Helpers
// ============================================

/**
 * Calculate hint usage rate from session responses
 */
function calculateHintUsageRate(session: Session): number {
  if (!session.submission?.responses || session.submission.responses.length === 0) {
    return 0;
  }
  const hintsUsed = session.submission.responses.filter(r => r.hintUsed).length;
  return hintsUsed / session.submission.responses.length;
}

/**
 * Calculate time spent in minutes from session timestamps
 */
function calculateTimeSpentMinutes(session: Session): number | undefined {
  if (!session.startedAt || !session.completedAt) {
    return undefined;
  }
  const start = new Date(session.startedAt);
  const end = new Date(session.completedAt);
  const diffMs = end.getTime() - start.getTime();
  return Math.round(diffMs / (1000 * 60));
}

/**
 * Get score from session evaluation
 */
function getSessionScore(session: Session): number {
  return session.evaluation?.totalScore ?? 0;
}

// ============================================
// Main Builder Functions
// ============================================

/**
 * Build badge context for a single student with a specific current session
 */
export function buildBadgeContext(
  studentId: string,
  studentName: string,
  currentSession: Session
): StudentBadgeContext {
  const sessionStore = new SessionStore();
  const lessons = getAllLessons();
  const lessonMap = new Map(lessons.map(l => [l.id, l]));

  // Get the current lesson
  const currentLesson = lessonMap.get(currentSession.lessonId);

  // Get all completed sessions for this student
  const allSessions = sessionStore.getCompletedByStudentId(studentId);

  // Build current attempt info
  const currentAttempt = currentSession.status === "completed"
    ? {
        assignmentId: currentSession.lessonId,
        assignmentTitle: currentSession.lessonTitle,
        subject: currentLesson?.subject,
        score: getSessionScore(currentSession),
        hintUsageRate: calculateHintUsageRate(currentSession),
        timeSpentMinutes: calculateTimeSpentMinutes(currentSession),
        questionCount: currentSession.submission?.responses?.length ?? 0,
        completedAt: currentSession.completedAt ?? new Date().toISOString(),
      }
    : undefined;

  // Build previous attempts for same assignment
  const previousAttempts = allSessions
    .filter(s => s.lessonId === currentSession.lessonId && s.id !== currentSession.id)
    .map(s => ({
      assignmentId: s.lessonId,
      score: getSessionScore(s),
      completedAt: s.completedAt ?? s.startedAt.toString(),
    }));

  // Build subject history for mastery evaluation
  const subjectHistory = buildSubjectHistory(allSessions, lessonMap);

  // Get awarded badges for cooldown checks
  const awardedBadges = badgeStore.getForCooldownCheck(studentId);

  return {
    studentId,
    studentName,
    currentAttempt,
    previousAttempts,
    subjectHistory,
    awardedBadges,
  };
}

/**
 * Build badge context for a student without a specific current session
 * (for mastery badge evaluation based on overall history)
 */
export function buildBadgeContextFromHistory(
  studentId: string,
  studentName: string
): StudentBadgeContext {
  const sessionStore = new SessionStore();
  const lessons = getAllLessons();
  const lessonMap = new Map(lessons.map(l => [l.id, l]));

  // Get all completed sessions for this student
  const allSessions = sessionStore.getCompletedByStudentId(studentId);

  // Build subject history for mastery evaluation
  const subjectHistory = buildSubjectHistory(allSessions, lessonMap);

  // Get awarded badges for cooldown checks
  const awardedBadges = badgeStore.getForCooldownCheck(studentId);

  return {
    studentId,
    studentName,
    currentAttempt: undefined,
    previousAttempts: undefined,
    subjectHistory,
    awardedBadges,
  };
}

/**
 * Build subject history from completed sessions
 */
function buildSubjectHistory(
  sessions: Session[],
  lessonMap: Map<string, Lesson>
): StudentBadgeContext["subjectHistory"] {
  const subjectData = new Map<
    string,
    {
      subject: string;
      assignments: {
        assignmentId: string;
        assignmentTitle: string;
        score: number;
        hintUsageRate: number;
        completedAt: string;
      }[];
    }
  >();

  for (const session of sessions) {
    const lesson = lessonMap.get(session.lessonId);
    if (!lesson?.subject) continue;

    const subject = lesson.subject;

    if (!subjectData.has(subject)) {
      subjectData.set(subject, {
        subject,
        assignments: [],
      });
    }

    subjectData.get(subject)!.assignments.push({
      assignmentId: session.lessonId,
      assignmentTitle: session.lessonTitle,
      score: getSessionScore(session),
      hintUsageRate: calculateHintUsageRate(session),
      completedAt: session.completedAt ?? session.startedAt.toString(),
    });
  }

  return Array.from(subjectData.values());
}

/**
 * Build badge context for multiple students at once
 * (for batch evaluation, e.g., nightly mastery check)
 */
export function buildBadgeContextsForStudents(
  students: { studentId: string; studentName: string }[]
): StudentBadgeContext[] {
  return students.map(({ studentId, studentName }) =>
    buildBadgeContextFromHistory(studentId, studentName)
  );
}

/**
 * Build badge context with a specific session as current
 * (for real-time evaluation when a session completes)
 */
export function buildBadgeContextForSession(session: Session): StudentBadgeContext {
  return buildBadgeContext(
    session.studentId,
    session.studentName,
    session
  );
}
