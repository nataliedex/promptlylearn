import { Student } from "../domain/student";
import { Session } from "../domain/session";
import { SessionStore } from "../stores/sessionStore";
import {
  getStudentAnalytics,
  formatDuration,
  getWeeklyActivity,
  calculateHintUsage,
} from "../domain/analytics";

/**
 * Display a progress summary for a student
 */
export function showProgressSummary(student: Student): void {
  const sessionStore = new SessionStore();
  // Only include completed sessions with evaluation
  const sessions = sessionStore.getCompletedByStudentId(student.id);

  console.log("\n" + "═".repeat(50));
  console.log(`  Progress Summary for ${student.name}`);
  console.log("═".repeat(50));

  // Check for in-progress lessons
  const inProgress = sessionStore.getInProgressByStudentId(student.id);
  if (inProgress.length > 0) {
    console.log(`\n⏳ You have ${inProgress.length} lesson(s) in progress.`);
  }

  if (sessions.length === 0) {
    console.log("\n  No sessions completed yet. Start a lesson to begin learning!\n");
    return;
  }

  // Get analytics
  const analytics = getStudentAnalytics(sessions);

  // Overall stats with progress bar
  const scores = sessions.map(s => s.evaluation?.totalScore ?? 0);
  const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const bestScore = Math.max(...scores);
  const latestScore = scores[0]; // Sessions are sorted newest first

  console.log("\n📊 Your Progress:\n");
  console.log(`   Average Score: ${renderProgressBar(avgScore, 100, 20)} ${avgScore}/100`);
  console.log(`   Best Score:    ${renderProgressBar(bestScore, 100, 20)} ${bestScore}/100`);
  console.log(`   Latest Score:  ${renderProgressBar(latestScore, 100, 20)} ${latestScore}/100`);

  // Streak and engagement
  const streak = calculateStreak(sessions);
  console.log(`\n   🔥 Current streak: ${streak} day${streak !== 1 ? 's' : ''}`);
  console.log(`   ⭐ Engagement: ${renderProgressBar(analytics.engagementScore, 100, 15)} ${analytics.engagementScore}/100`);

  // Session duration
  if (analytics.sessionDuration) {
    console.log(`   ⏱️  Avg session time: ${formatDuration(analytics.sessionDuration.averageMinutes)}`);
  }

  // Trend analysis
  if (sessions.length >= 2) {
    const trend = calculateTrend(sessions);
    console.log(`   📈 Trend: ${trend}`);
  }

  // Weekly activity chart
  console.log("\n📅 Weekly Activity:\n");
  displayWeeklyChart(sessions);

  // Per-lesson breakdown with progress bars
  const lessonMap = groupByLesson(sessions);
  console.log("\n📚 Lessons:\n");

  for (const [lessonTitle, lessonSessions] of Object.entries(lessonMap)) {
    const lessonScores = lessonSessions.map(s => s.evaluation?.totalScore ?? 0);
    const lessonAvg = Math.round(lessonScores.reduce((a, b) => a + b, 0) / lessonScores.length);
    const lessonBest = Math.max(...lessonScores);
    const stars = getStarRating(lessonAvg);

    console.log(`   ${lessonTitle}`);
    console.log(`   ${renderProgressBar(lessonAvg, 100, 25)} ${lessonAvg}/100 ${stars}`);
    console.log(`   ${lessonSessions.length} attempt${lessonSessions.length !== 1 ? 's' : ''} · Best: ${lessonBest}/100\n`);
  }

  // Achievements
  const achievements = getAchievements(sessions, analytics);
  if (achievements.length > 0) {
    console.log("🏆 Achievements:\n");
    for (const achievement of achievements) {
      console.log(`   ${achievement}`);
    }
    console.log("");
  }

  // Insights
  console.log("💡 Tips:\n");
  const insights = generateInsights(sessions);
  for (const insight of insights) {
    console.log(`   • ${insight}`);
  }

  console.log("\n" + "═".repeat(50) + "\n");
}

/**
 * Render an ASCII progress bar
 */
function renderProgressBar(value: number, max: number, width: number): string {
  const percentage = Math.min(value / max, 1);
  const filled = Math.round(percentage * width);
  const empty = width - filled;

  const filledChar = "█";
  const emptyChar = "░";

  return `[${filledChar.repeat(filled)}${emptyChar.repeat(empty)}]`;
}

/**
 * Get star rating based on score
 */
function getStarRating(score: number): string {
  if (score >= 90) return "⭐⭐⭐";
  if (score >= 75) return "⭐⭐";
  if (score >= 60) return "⭐";
  return "";
}

/**
 * Calculate current streak (consecutive days with sessions)
 */
function calculateStreak(sessions: Session[]): number {
  if (sessions.length === 0) return 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Get unique dates of sessions
  const sessionDates = new Set<string>();
  for (const session of sessions) {
    const date = new Date(session.completedAt || session.startedAt);
    date.setHours(0, 0, 0, 0);
    sessionDates.add(date.toISOString());
  }

  let streak = 0;
  const checkDate = new Date(today);

  // Check if there's a session today or yesterday to start the streak
  const todayStr = today.toISOString();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString();

  if (!sessionDates.has(todayStr) && !sessionDates.has(yesterdayStr)) {
    return 0;
  }

  // Count consecutive days
  while (true) {
    const dateStr = checkDate.toISOString();
    if (sessionDates.has(dateStr)) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}

/**
 * Display weekly activity chart
 */
function displayWeeklyChart(sessions: Session[]): void {
  const weeklyData = getWeeklyActivity(sessions, 4);
  const maxSessions = Math.max(...weeklyData.map(w => w.sessions), 1);

  for (const week of weeklyData) {
    const barLength = Math.round((week.sessions / maxSessions) * 15);
    const bar = "▓".repeat(barLength) + "░".repeat(15 - barLength);
    const scoreDisplay = week.sessions > 0 ? `avg ${week.avgScore}` : "no activity";
    console.log(`   ${week.week}: ${bar} ${week.sessions} session${week.sessions !== 1 ? 's' : ''} (${scoreDisplay})`);
  }
}

/**
 * Get achievements based on performance
 */
function getAchievements(sessions: Session[], analytics: ReturnType<typeof getStudentAnalytics>): string[] {
  const achievements: string[] = [];

  // Session count achievements
  if (sessions.length >= 10) {
    achievements.push("🎯 Dedicated Learner - Completed 10+ sessions");
  } else if (sessions.length >= 5) {
    achievements.push("📖 Getting Started - Completed 5+ sessions");
  }

  // Score achievements
  const scores = sessions.map(s => s.evaluation?.totalScore ?? 0);
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  const perfectScores = scores.filter(s => s >= 95).length;

  if (perfectScores > 0) {
    achievements.push(`🌟 Excellence - ${perfectScores} near-perfect score${perfectScores > 1 ? 's' : ''}`);
  }

  if (avgScore >= 80) {
    achievements.push("⭐ High Achiever - Average score 80+");
  }

  // Engagement achievements
  if (analytics.engagementScore >= 80) {
    achievements.push("💪 Super Engaged - Engagement score 80+");
  }

  // Coach usage
  if (analytics.coachUsage.totalInteractions >= 5) {
    achievements.push("🎓 Curious Mind - Used coach 5+ times");
  }

  // Voice usage
  if (analytics.inputMethods.voicePercentage >= 50) {
    achievements.push("🎤 Voice Explorer - Uses voice input regularly");
  }

  // Streak
  const streak = calculateStreak(sessions);
  if (streak >= 7) {
    achievements.push("🔥 Week Warrior - 7+ day streak");
  } else if (streak >= 3) {
    achievements.push("🔥 On Fire - 3+ day streak");
  }

  return achievements;
}

/**
 * Calculate trend based on recent sessions
 */
function calculateTrend(sessions: Session[]): string {
  if (sessions.length < 2) return "Not enough data";

  // Compare average of last 3 sessions to previous 3
  const recent = sessions.slice(0, Math.min(3, sessions.length));
  const recentAvg = recent.reduce((a, s) => a + (s.evaluation?.totalScore ?? 0), 0) / recent.length;

  if (sessions.length < 4) {
    // Just compare first and last
    const first = sessions[sessions.length - 1].evaluation?.totalScore ?? 0;
    const last = sessions[0].evaluation?.totalScore ?? 0;
    const diff = last - first;

    if (diff > 10) return "📈 Improving significantly!";
    if (diff > 0) return "📈 Improving";
    if (diff < -10) return "📉 Declining - review previous material";
    if (diff < 0) return "📉 Slight decline";
    return "➡️ Steady";
  }

  const older = sessions.slice(3, Math.min(6, sessions.length));
  const olderAvg = older.reduce((a, s) => a + (s.evaluation?.totalScore ?? 0), 0) / older.length;
  const diff = recentAvg - olderAvg;

  if (diff > 10) return "📈 Improving significantly!";
  if (diff > 0) return "📈 Improving";
  if (diff < -10) return "📉 Declining - review previous material";
  if (diff < 0) return "📉 Slight decline";
  return "➡️ Steady";
}

/**
 * Group sessions by lesson
 */
function groupByLesson(sessions: Session[]): Record<string, Session[]> {
  const map: Record<string, Session[]> = {};

  for (const session of sessions) {
    const key = session.lessonTitle;
    if (!map[key]) {
      map[key] = [];
    }
    map[key].push(session);
  }

  return map;
}

/**
 * Generate insights based on session data
 */
function generateInsights(sessions: Session[]): string[] {
  const insights: string[] = [];

  if (sessions.length === 0) return insights;

  // Check hint usage
  const totalHints = sessions.reduce((count, session) => {
    return count + session.submission.responses.filter(r => r.hintUsed).length;
  }, 0);
  const totalPrompts = sessions.reduce((count, session) => {
    return count + session.submission.responses.length;
  }, 0);
  const hintRate = totalPrompts > 0 ? (totalHints / totalPrompts) * 100 : 0;

  if (hintRate > 50) {
    insights.push("You're using hints frequently. Try solving without hints first!");
  } else if (hintRate < 10 && sessions.length >= 3) {
    insights.push("Great independence! You rarely need hints.");
  }

  // Check reflection usage
  const totalReflections = sessions.reduce((count, session) => {
    return count + session.submission.responses.filter(r => r.reflection).length;
  }, 0);
  const reflectionRate = totalPrompts > 0 ? (totalReflections / totalPrompts) * 100 : 0;

  if (reflectionRate < 30) {
    insights.push("Adding reflections helps deepen understanding. Try explaining your reasoning!");
  } else if (reflectionRate > 70) {
    insights.push("Excellent habit of reflecting on your answers!");
  }

  // Score-based insights
  const avgScore = sessions.reduce((a, s) => a + (s.evaluation?.totalScore ?? 0), 0) / sessions.length;

  if (avgScore >= 80) {
    insights.push("Strong performance! Consider trying more advanced lessons.");
  } else if (avgScore < 50) {
    insights.push("Keep practicing! Review the feedback from each session.");
  }

  if (insights.length === 0) {
    insights.push("Keep up the good work!");
  }

  return insights;
}
