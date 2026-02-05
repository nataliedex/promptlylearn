/**
 * Assignment Lifecycle Service
 *
 * Computes assignment lifecycle state and generates teacher summaries.
 *
 * Philosophy:
 * - Teachers should not manage dashboards
 * - State is computed from actual data, not manually set
 * - Summaries help teachers recall without re-reading everything
 */

import { Lesson } from "./lesson";
import { Session } from "./session";
import { PromptResponse } from "./submission";

// ============================================
// Types
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

  // Computed lifecycle
  lifecycleState: AssignmentLifecycleState;
  activeReasons: ActiveReason[];

  // Stats
  totalStudents: number;
  completedCount: number;
  inProgressCount: number;
  distribution: {
    strong: number;
    developing: number;
    needsSupport: number;
  };

  // Student details
  studentStatuses: StudentStatus[];
  studentsNeedingSupport: number;

  // For resolved check
  allStudentsComplete: boolean;
  allFlaggedReviewed: boolean;

  // Assignment metadata
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

// ============================================
// Configuration
// ============================================

const CONFIG = {
  // Score thresholds for understanding levels
  strongThreshold: 70,
  developingThreshold: 40,

  // What qualifies as "needs support"
  needsSupportThreshold: 40,
  significantCoachUsageRatio: 0.5,

  // Recent activity window (hours)
  recentActivityWindowHours: 48,
};

// ============================================
// Understanding Level Calculation
// ============================================

function deriveUnderstanding(score: number): "strong" | "developing" | "needs-support" {
  if (score >= CONFIG.strongThreshold) return "strong";
  if (score >= CONFIG.developingThreshold) return "developing";
  return "needs-support";
}

// ============================================
// Compute Assignment State
// ============================================

/**
 * Compute the current state of an assignment based on session data.
 *
 * This is the core logic that determines what teachers see.
 * The state is derived from actual data - not manually tracked.
 */
export function computeAssignmentState(
  lesson: Lesson,
  sessions: Session[],
  allStudentIds: string[],
  stateRecord?: {
    teacherViewedAt?: string;
    teacherViewCount: number;
    lifecycleState?: AssignmentLifecycleState;
    archivedAt?: string;
  }
): ComputedAssignmentState {
  // Build student statuses
  const studentStatuses: StudentStatus[] = [];
  let completedCount = 0;
  let inProgressCount = 0;
  let strong = 0;
  let developing = 0;
  let needsSupport = 0;

  // Filter sessions for this lesson and group by student (take most recent)
  const lessonSessions = sessions.filter((s) => s.lessonId === lesson.id);
  const sessionsByStudent = new Map<string, Session[]>();

  for (const session of lessonSessions) {
    const existing = sessionsByStudent.get(session.studentId) || [];
    existing.push(session);
    sessionsByStudent.set(session.studentId, existing);
  }

  // Get the most recent session for each student
  const latestSessionByStudent = new Map<string, Session>();
  sessionsByStudent.forEach((studentSessions, studentId) => {
    const sorted = studentSessions.sort((a, b) => {
      const dateA = new Date(a.completedAt || a.startedAt).getTime();
      const dateB = new Date(b.completedAt || b.startedAt).getTime();
      return dateB - dateA; // Most recent first
    });
    latestSessionByStudent.set(studentId, sorted[0]);
  });

  // Process each student's most recent session
  const sessionStudentIds = new Set<string>();

  for (const [studentId, session] of latestSessionByStudent) {
    sessionStudentIds.add(studentId);

    const score = session.evaluation?.totalScore ?? 0;
    const understanding = deriveUnderstanding(score);
    const isComplete = session.status === "completed";
    const hintsUsed = session.submission.responses.filter((r: PromptResponse) => r.hintUsed).length;
    const hintRatio = hintsUsed / Math.max(session.submission.responses.length, 1);
    const hasTeacherNote = !!session.educatorNotes;

    // Determine if needs support
    const flaggedNeedsSupport =
      understanding === "needs-support" ||
      hintRatio > CONFIG.significantCoachUsageRatio;

    // Check if improved after help
    const improvedAfterHelp = hintsUsed > 0 && score >= CONFIG.developingThreshold;

    studentStatuses.push({
      studentId: session.studentId,
      studentName: session.studentName,
      isComplete,
      understanding,
      needsSupport: flaggedNeedsSupport,
      hasTeacherNote,
      hintsUsed,
      score,
      improvedAfterHelp,
    });

    if (isComplete) {
      completedCount++;
    } else {
      inProgressCount++;
    }
    if (understanding === "strong") strong++;
    else if (understanding === "developing") developing++;
    else needsSupport++;
  }

  // Add students who haven't started
  for (const studentId of allStudentIds) {
    if (!sessionStudentIds.has(studentId)) {
      studentStatuses.push({
        studentId,
        studentName: "Unknown", // Would need to look up
        isComplete: false,
        understanding: "needs-support",
        needsSupport: false, // Not flagged until they start
        hasTeacherNote: false,
        hintsUsed: 0,
        score: 0,
        improvedAfterHelp: false,
      });
    }
  }

  // Compute derived values
  const totalStudents = allStudentIds.length;
  const studentsNeedingSupport = studentStatuses.filter((s) => s.needsSupport).length;
  const allStudentsComplete = completedCount >= totalStudents;
  const allFlaggedReviewed = studentStatuses
    .filter((s) => s.needsSupport)
    .every((s) => s.hasTeacherNote);

  // Determine active reasons
  const activeReasons: ActiveReason[] = [];

  if (studentsNeedingSupport > 0) {
    activeReasons.push("students-need-support");
  }

  if (!allStudentsComplete && completedCount < totalStudents) {
    activeReasons.push("incomplete-work");
  }

  if (!stateRecord?.teacherViewedAt) {
    activeReasons.push("not-reviewed");
  }

  // Check for recent activity
  if (sessions.length > 0) {
    const mostRecentSession = sessions
      .filter((s) => s.lessonId === lesson.id)
      .sort((a, b) => {
        const dateA = new Date(a.completedAt || a.startedAt).getTime();
        const dateB = new Date(b.completedAt || b.startedAt).getTime();
        return dateB - dateA;
      })[0];

    if (mostRecentSession) {
      const sessionDate = new Date(mostRecentSession.completedAt || mostRecentSession.startedAt);
      const hoursSince = (Date.now() - sessionDate.getTime()) / (1000 * 60 * 60);
      if (hoursSince < CONFIG.recentActivityWindowHours) {
        activeReasons.push("recent-activity");
      }
    }
  }

  // Determine lifecycle state
  let lifecycleState: AssignmentLifecycleState = "active";

  // Check if already archived (preserve that state)
  if (stateRecord?.lifecycleState === "archived" && stateRecord?.archivedAt) {
    lifecycleState = "archived";
  }
  // Check if should be resolved
  else if (activeReasons.length === 0) {
    // No active reasons = can be resolved
    // But only if there's been some activity
    if (completedCount > 0 || stateRecord?.teacherViewedAt) {
      lifecycleState = "resolved";
    }
  }

  return {
    assignmentId: lesson.id,
    title: lesson.title,
    lifecycleState,
    activeReasons,
    totalStudents,
    completedCount,
    inProgressCount,
    distribution: { strong, developing, needsSupport },
    studentStatuses,
    studentsNeedingSupport,
    allStudentsComplete,
    allFlaggedReviewed,
  };
}

// ============================================
// Generate Teacher Summary
// ============================================

/**
 * Generate a comprehensive teacher summary for archiving.
 *
 * This summary becomes the "cover page" of archived assignments.
 * It helps teachers recall what happened without re-reading everything.
 */
export function generateTeacherSummary(
  lesson: Lesson,
  sessions: Session[],
  studentStatuses: StudentStatus[],
  stateRecord: { teacherViewCount: number }
): TeacherSummary {
  // Class performance
  const completedStudents = studentStatuses.filter((s) => s.isComplete);
  const scores = completedStudents.map((s) => s.score);
  const averageScore = scores.length > 0
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : 0;

  const classPerformance = {
    totalStudents: studentStatuses.length,
    strongCount: studentStatuses.filter((s) => s.understanding === "strong").length,
    developingCount: studentStatuses.filter((s) => s.understanding === "developing").length,
    needsSupportCount: studentStatuses.filter((s) => s.understanding === "needs-support").length,
    averageScore,
    completionRate: Math.round((completedStudents.length / Math.max(studentStatuses.length, 1)) * 100),
  };

  // Coach usage
  const studentsWhoUsedHints = studentStatuses.filter((s) => s.hintsUsed > 0).length;
  const totalHints = studentStatuses.reduce((sum, s) => sum + s.hintsUsed, 0);
  const averageHintsPerStudent = studentStatuses.length > 0
    ? Math.round((totalHints / studentStatuses.length) * 10) / 10
    : 0;

  // Analyze questions for scaffolding effectiveness
  const questionStats = analyzeQuestionPerformance(lesson, sessions);

  const coachUsage = {
    averageHintsPerStudent,
    studentsWhoUsedHints,
    mostEffectiveHints: questionStats.effectiveHints,
    questionsNeedingMoreScaffolding: questionStats.needsMoreScaffolding,
  };

  // Student highlights
  const improvedSignificantly = studentStatuses
    .filter((s) => s.improvedAfterHelp && s.understanding !== "needs-support")
    .map((s) => s.studentName);

  const mayNeedFollowUp = studentStatuses
    .filter((s) => s.understanding === "needs-support" || (s.needsSupport && !s.hasTeacherNote))
    .map((s) => s.studentName);

  const exceededExpectations = studentStatuses
    .filter((s) => s.understanding === "strong" && s.hintsUsed === 0)
    .map((s) => s.studentName);

  const studentHighlights = {
    improvedSignificantly,
    mayNeedFollowUp,
    exceededExpectations,
  };

  // Teacher engagement
  const studentsWithNotes = studentStatuses.filter((s) => s.hasTeacherNote).length;
  const totalNotesWritten = studentsWithNotes; // Simplified - could count per-question notes
  const flaggedStudents = studentStatuses.filter((s) => s.needsSupport);
  const reviewedAllFlagged = flaggedStudents.every((s) => s.hasTeacherNote);

  const teacherEngagement = {
    totalNotesWritten,
    studentsWithNotes,
    reviewedAllFlagged,
  };

  // Learning insights (derived from question analysis)
  const insights = {
    commonStrengths: questionStats.commonStrengths,
    commonChallenges: questionStats.commonChallenges,
    skillsMastered: questionStats.skillsMastered,
    skillsNeedingReinforcement: questionStats.skillsNeedingReinforcement,
  };

  return {
    generatedAt: new Date().toISOString(),
    classPerformance,
    insights,
    coachUsage,
    studentHighlights,
    teacherEngagement,
  };
}

// ============================================
// Question Analysis Helper
// ============================================

interface QuestionAnalysis {
  commonStrengths: string[];
  commonChallenges: string[];
  skillsMastered: string[];
  skillsNeedingReinforcement: string[];
  effectiveHints: string[];
  needsMoreScaffolding: string[];
}

function analyzeQuestionPerformance(
  lesson: Lesson,
  sessions: Session[]
): QuestionAnalysis {
  // Track per-question performance
  const questionPerformance: Map<string, {
    attempts: number;
    successes: number;
    hintsUsed: number;
    improvedWithHint: number;
    questionText: string;
  }> = new Map();

  // Initialize with lesson prompts
  for (const prompt of lesson.prompts) {
    questionPerformance.set(prompt.id, {
      attempts: 0,
      successes: 0,
      hintsUsed: 0,
      improvedWithHint: 0,
      questionText: prompt.input.substring(0, 50) + (prompt.input.length > 50 ? "..." : ""),
    });
  }

  // Analyze sessions
  for (const session of sessions) {
    if (session.lessonId !== lesson.id) continue;

    for (const response of session.submission.responses) {
      const perf = questionPerformance.get(response.promptId);
      if (!perf) continue;

      perf.attempts++;

      // Check if successful (score >= 70 or understanding demonstrated)
      const criteriaScore = session.evaluation?.criteriaScores?.find(
        (c: { criterionId: string; score: number; comment?: string }) => c.criterionId === response.promptId
      );
      const score = criteriaScore?.score ?? 0;
      if (score >= 70) {
        perf.successes++;
      }

      if (response.hintUsed) {
        perf.hintsUsed++;
        // If they used a hint and still succeeded, hint was effective
        if (score >= 60) {
          perf.improvedWithHint++;
        }
      }
    }
  }

  // Analyze results
  const commonStrengths: string[] = [];
  const commonChallenges: string[] = [];
  const skillsMastered: string[] = [];
  const skillsNeedingReinforcement: string[] = [];
  const effectiveHints: string[] = [];
  const needsMoreScaffolding: string[] = [];

  for (const [questionId, perf] of questionPerformance) {
    if (perf.attempts === 0) continue;

    const successRate = perf.successes / perf.attempts;
    const hintUsageRate = perf.hintsUsed / perf.attempts;
    const hintEffectiveness = perf.hintsUsed > 0
      ? perf.improvedWithHint / perf.hintsUsed
      : 0;

    // High success rate = strength/mastered
    if (successRate >= 0.7) {
      commonStrengths.push(perf.questionText);
      if (successRate >= 0.85) {
        skillsMastered.push(perf.questionText);
      }
    }

    // Low success rate = challenge/needs reinforcement
    if (successRate < 0.5) {
      commonChallenges.push(perf.questionText);
      skillsNeedingReinforcement.push(perf.questionText);
    }

    // Hint effectiveness
    if (hintUsageRate > 0.3 && hintEffectiveness >= 0.6) {
      effectiveHints.push(perf.questionText);
    }

    if (hintUsageRate > 0.3 && hintEffectiveness < 0.4) {
      needsMoreScaffolding.push(perf.questionText);
    }
  }

  return {
    commonStrengths: commonStrengths.slice(0, 3),
    commonChallenges: commonChallenges.slice(0, 3),
    skillsMastered: skillsMastered.slice(0, 3),
    skillsNeedingReinforcement: skillsNeedingReinforcement.slice(0, 3),
    effectiveHints: effectiveHints.slice(0, 3),
    needsMoreScaffolding: needsMoreScaffolding.slice(0, 3),
  };
}

// ============================================
// Lifecycle Transition Helpers
// ============================================

/**
 * Check if an assignment should transition to resolved.
 */
export function shouldResolve(state: ComputedAssignmentState): boolean {
  return (
    state.lifecycleState === "active" &&
    state.activeReasons.length === 0 &&
    state.completedCount > 0
  );
}

/**
 * Check if a resolved assignment is ready for auto-archive.
 */
export function isReadyForAutoArchive(
  resolvedAt: string,
  daysThreshold: number = 7
): boolean {
  const resolvedDate = new Date(resolvedAt);
  const now = new Date();
  const daysSinceResolved = (now.getTime() - resolvedDate.getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceResolved >= daysThreshold;
}
