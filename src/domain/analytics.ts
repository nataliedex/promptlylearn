import { Session } from "./session";
import { Student } from "./student";
import { PromptResponse } from "./submission";

/**
 * Analytics module for generating insights from student sessions
 */

export interface SessionDurationStats {
  averageMinutes: number;
  fastestMinutes: number;
  slowestMinutes: number;
  totalSessions: number;
}

export interface CoachUsageStats {
  helpRequestCount: number;
  elaborationCount: number;
  moreExplorationCount: number;
  totalInteractions: number;
  avgTurnsPerInteraction: number;
  studentsUsingCoach: number;
  percentageUsingCoach: number;
}

export interface SkillBreakdown {
  understanding: { avg: number; trend: "up" | "down" | "steady" };
  reasoning: { avg: number; trend: "up" | "down" | "steady" };
  clarity: { avg: number; trend: "up" | "down" | "steady" };
}

export interface HintUsageStats {
  totalHintsUsed: number;
  totalResponses: number;
  hintUsageRate: number;
  avgScoreWithHint: number;
  avgScoreWithoutHint: number;
}

export interface InputMethodStats {
  voiceCount: number;
  typedCount: number;
  voicePercentage: number;
}

export interface StudentAnalytics {
  sessionDuration: SessionDurationStats | null;
  coachUsage: CoachUsageStats;
  hintUsage: HintUsageStats;
  inputMethods: InputMethodStats;
  engagementScore: number; // 0-100 composite score
}

export interface ClassAnalytics {
  sessionDuration: SessionDurationStats | null;
  coachUsage: CoachUsageStats;
  hintUsage: HintUsageStats;
  topPerformers: { name: string; avgScore: number }[];
  needsSupport: { name: string; avgScore: number; issue: string }[];
  lessonDifficulty: { title: string; avgScore: number; attempts: number }[];
}

/**
 * Calculate session duration statistics
 */
export function calculateSessionDuration(sessions: Session[]): SessionDurationStats | null {
  const completedSessions = sessions.filter(
    s => s.status === "completed" && s.startedAt && s.completedAt
  );

  if (completedSessions.length === 0) {
    return null;
  }

  const durations = completedSessions.map(s => {
    const start = new Date(s.startedAt).getTime();
    const end = new Date(s.completedAt!).getTime();
    return (end - start) / (1000 * 60); // minutes
  });

  return {
    averageMinutes: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
    fastestMinutes: Math.round(Math.min(...durations)),
    slowestMinutes: Math.round(Math.max(...durations)),
    totalSessions: completedSessions.length,
  };
}

/**
 * Calculate coach usage statistics from sessions
 */
export function calculateCoachUsage(
  sessions: Session[],
  totalStudents?: number
): CoachUsageStats {
  let helpRequestCount = 0;
  let elaborationCount = 0;
  let moreExplorationCount = 0;
  let totalTurns = 0;
  let totalInteractions = 0;
  const studentsWithCoach = new Set<string>();

  for (const session of sessions) {
    for (const response of session.submission.responses) {
      if (response.helpConversation && response.helpConversation.turns.length > 0) {
        helpRequestCount++;
        totalTurns += response.helpConversation.turns.length;
        totalInteractions++;
        studentsWithCoach.add(session.studentId);
      }
      if (response.elaborationConversation && response.elaborationConversation.turns.length > 0) {
        elaborationCount++;
        totalTurns += response.elaborationConversation.turns.length;
        totalInteractions++;
        studentsWithCoach.add(session.studentId);
      }
      if (response.moreConversation && response.moreConversation.turns.length > 0) {
        moreExplorationCount++;
        totalTurns += response.moreConversation.turns.length;
        totalInteractions++;
        studentsWithCoach.add(session.studentId);
      }
    }
  }

  const studentsUsingCoach = studentsWithCoach.size;
  const studentCount = totalStudents ?? studentsUsingCoach;

  return {
    helpRequestCount,
    elaborationCount,
    moreExplorationCount,
    totalInteractions,
    avgTurnsPerInteraction: totalInteractions > 0 ? Math.round(totalTurns / totalInteractions * 10) / 10 : 0,
    studentsUsingCoach,
    percentageUsingCoach: studentCount > 0 ? Math.round((studentsUsingCoach / studentCount) * 100) : 0,
  };
}

/**
 * Calculate hint usage statistics
 */
export function calculateHintUsage(sessions: Session[]): HintUsageStats {
  let totalHintsUsed = 0;
  let totalResponses = 0;
  let scoreWithHint = 0;
  let countWithHint = 0;
  let scoreWithoutHint = 0;
  let countWithoutHint = 0;

  for (const session of sessions) {
    if (!session.evaluation) continue;

    for (const response of session.submission.responses) {
      totalResponses++;

      if (response.hintUsed) {
        totalHintsUsed++;
        // Find the score for this response
        const criteriaScore = session.evaluation.criteriaScores.find(
          c => c.criterionId === response.promptId
        );
        if (criteriaScore) {
          scoreWithHint += criteriaScore.score;
          countWithHint++;
        }
      } else {
        const criteriaScore = session.evaluation.criteriaScores.find(
          c => c.criterionId === response.promptId
        );
        if (criteriaScore) {
          scoreWithoutHint += criteriaScore.score;
          countWithoutHint++;
        }
      }
    }
  }

  return {
    totalHintsUsed,
    totalResponses,
    hintUsageRate: totalResponses > 0 ? Math.round((totalHintsUsed / totalResponses) * 100) : 0,
    avgScoreWithHint: countWithHint > 0 ? Math.round(scoreWithHint / countWithHint) : 0,
    avgScoreWithoutHint: countWithoutHint > 0 ? Math.round(scoreWithoutHint / countWithoutHint) : 0,
  };
}

/**
 * Calculate input method statistics (voice vs typed)
 */
export function calculateInputMethods(sessions: Session[]): InputMethodStats {
  let voiceCount = 0;
  let typedCount = 0;

  for (const session of sessions) {
    for (const response of session.submission.responses) {
      if (response.inputSource === "voice") {
        voiceCount++;
      } else {
        typedCount++;
      }
    }
  }

  const total = voiceCount + typedCount;
  return {
    voiceCount,
    typedCount,
    voicePercentage: total > 0 ? Math.round((voiceCount / total) * 100) : 0,
  };
}

/**
 * Calculate engagement score (0-100) based on various factors
 */
export function calculateEngagementScore(sessions: Session[]): number {
  if (sessions.length === 0) return 0;

  let score = 50; // Base score

  // Factor 1: Session completion consistency (+20 max)
  const completedCount = sessions.filter(s => s.status === "completed").length;
  const completionRate = completedCount / sessions.length;
  score += completionRate * 20;

  // Factor 2: Reflection participation (+15 max)
  let reflectionCount = 0;
  let totalResponses = 0;
  for (const session of sessions) {
    for (const response of session.submission.responses) {
      totalResponses++;
      if (response.reflection && response.reflection.length > 10) {
        reflectionCount++;
      }
    }
  }
  const reflectionRate = totalResponses > 0 ? reflectionCount / totalResponses : 0;
  score += reflectionRate * 15;

  // Factor 3: Coach interaction (+10 max)
  const coachUsage = calculateCoachUsage(sessions);
  if (coachUsage.totalInteractions > 0) {
    score += Math.min(10, coachUsage.totalInteractions * 2);
  }

  // Factor 4: Voice input usage bonus (+5 max)
  const inputMethods = calculateInputMethods(sessions);
  if (inputMethods.voicePercentage > 20) {
    score += 5;
  }

  return Math.min(100, Math.round(score));
}

/**
 * Get comprehensive analytics for a single student
 */
export function getStudentAnalytics(sessions: Session[]): StudentAnalytics {
  return {
    sessionDuration: calculateSessionDuration(sessions),
    coachUsage: calculateCoachUsage(sessions, 1),
    hintUsage: calculateHintUsage(sessions),
    inputMethods: calculateInputMethods(sessions),
    engagementScore: calculateEngagementScore(sessions),
  };
}

/**
 * Get class-wide analytics
 */
export function getClassAnalytics(
  students: Student[],
  sessions: Session[]
): ClassAnalytics {
  const completedSessions = sessions.filter(s => s.status === "completed");

  // Top performers (avg >= 80)
  const studentScores = new Map<string, { name: string; scores: number[] }>();
  for (const session of completedSessions) {
    if (!session.evaluation) continue;
    const existing = studentScores.get(session.studentId) || {
      name: session.studentName,
      scores: [],
    };
    existing.scores.push(session.evaluation.totalScore);
    studentScores.set(session.studentId, existing);
  }

  const topPerformers: { name: string; avgScore: number }[] = [];
  const needsSupport: { name: string; avgScore: number; issue: string }[] = [];

  for (const [, data] of studentScores) {
    const avg = Math.round(data.scores.reduce((a, b) => a + b, 0) / data.scores.length);
    if (avg >= 80) {
      topPerformers.push({ name: data.name, avgScore: avg });
    } else if (avg < 60) {
      needsSupport.push({
        name: data.name,
        avgScore: avg,
        issue: avg < 40 ? "Struggling significantly" : "Below average",
      });
    }
  }

  // Sort top performers and needs support
  topPerformers.sort((a, b) => b.avgScore - a.avgScore);
  needsSupport.sort((a, b) => a.avgScore - b.avgScore);

  // Lesson difficulty
  const lessonStats = new Map<string, { scores: number[]; attempts: number }>();
  for (const session of completedSessions) {
    if (!session.evaluation) continue;
    const existing = lessonStats.get(session.lessonTitle) || { scores: [], attempts: 0 };
    existing.scores.push(session.evaluation.totalScore);
    existing.attempts++;
    lessonStats.set(session.lessonTitle, existing);
  }

  const lessonDifficulty = [...lessonStats.entries()]
    .map(([title, data]) => ({
      title,
      avgScore: Math.round(data.scores.reduce((a, b) => a + b, 0) / data.scores.length),
      attempts: data.attempts,
    }))
    .sort((a, b) => a.avgScore - b.avgScore); // Hardest first

  return {
    sessionDuration: calculateSessionDuration(completedSessions),
    coachUsage: calculateCoachUsage(completedSessions, students.length),
    hintUsage: calculateHintUsage(completedSessions),
    topPerformers: topPerformers.slice(0, 5),
    needsSupport: needsSupport.slice(0, 5),
    lessonDifficulty,
  };
}

/**
 * Format duration for display
 */
export function formatDuration(minutes: number): string {
  if (minutes < 1) {
    return "< 1 min";
  } else if (minutes < 60) {
    return `${Math.round(minutes)} min`;
  } else {
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
}

/**
 * Get question-level performance breakdown
 */
export function getQuestionPerformance(
  sessions: Session[]
): { promptId: string; question: string; avgScore: number; attempts: number; hintRate: number }[] {
  const questionStats = new Map<
    string,
    { question: string; scores: number[]; hints: number; attempts: number }
  >();

  for (const session of sessions) {
    if (!session.evaluation) continue;

    for (const response of session.submission.responses) {
      const criteriaScore = session.evaluation.criteriaScores.find(
        c => c.criterionId === response.promptId
      );
      if (!criteriaScore) continue;

      const existing = questionStats.get(response.promptId) || {
        question: response.promptId,
        scores: [],
        hints: 0,
        attempts: 0,
      };
      existing.scores.push(criteriaScore.score);
      existing.attempts++;
      if (response.hintUsed) {
        existing.hints++;
      }
      questionStats.set(response.promptId, existing);
    }
  }

  return [...questionStats.entries()].map(([promptId, data]) => ({
    promptId,
    question: data.question,
    avgScore: Math.round(data.scores.reduce((a, b) => a + b, 0) / data.scores.length),
    attempts: data.attempts,
    hintRate: Math.round((data.hints / data.attempts) * 100),
  }));
}

/**
 * Calculate weekly activity for trend visualization
 */
export function getWeeklyActivity(
  sessions: Session[],
  weeks: number = 4
): { week: string; sessions: number; avgScore: number }[] {
  const now = new Date();
  const result: { week: string; sessions: number; avgScore: number }[] = [];

  for (let i = weeks - 1; i >= 0; i--) {
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - (i + 1) * 7);
    const weekEnd = new Date(now);
    weekEnd.setDate(weekEnd.getDate() - i * 7);

    const weekSessions = sessions.filter(s => {
      const sessionDate = new Date(s.completedAt || s.startedAt);
      return sessionDate >= weekStart && sessionDate < weekEnd;
    });

    const scores = weekSessions
      .filter(s => s.evaluation)
      .map(s => s.evaluation!.totalScore);

    result.push({
      week: `Week ${weeks - i}`,
      sessions: weekSessions.length,
      avgScore: scores.length > 0
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : 0,
    });
  }

  return result;
}
