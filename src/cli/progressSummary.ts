import { Student } from "../domain/student";
import { Session } from "../domain/session";
import { SessionStore } from "../stores/sessionStore";

/**
 * Display a progress summary for a student
 */
export function showProgressSummary(student: Student): void {
  const sessionStore = new SessionStore();
  // Only include completed sessions with evaluation
  const sessions = sessionStore.getCompletedByStudentId(student.id);

  console.log("\n" + "=".repeat(50));
  console.log(`Progress Summary for ${student.name}`);
  console.log("=".repeat(50));

  // Check for in-progress lessons
  const inProgress = sessionStore.getInProgressByStudentId(student.id);
  if (inProgress.length > 0) {
    console.log(`\n⏳ You have ${inProgress.length} lesson(s) in progress.`);
  }

  if (sessions.length === 0) {
    console.log("\nNo sessions completed yet. Start a lesson to begin learning!\n");
    return;
  }

  // Overall stats
  const scores = sessions.map(s => s.evaluation?.totalScore ?? 0);
  const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const bestScore = Math.max(...scores);
  const latestScore = scores[0]; // Sessions are sorted newest first

  console.log("\n📊 Overall Stats:");
  console.log(`   Sessions completed: ${sessions.length}`);
  console.log(`   Average score: ${avgScore}/100`);
  console.log(`   Best score: ${bestScore}/100`);
  console.log(`   Latest score: ${latestScore}/100`);

  // Trend analysis
  if (sessions.length >= 2) {
    const trend = calculateTrend(sessions);
    console.log(`   Trend: ${trend}`);
  }

  // Per-lesson breakdown
  const lessonMap = groupByLesson(sessions);
  console.log("\n📚 Per-Lesson Breakdown:");

  for (const [lessonTitle, lessonSessions] of Object.entries(lessonMap)) {
    const lessonScores = lessonSessions.map(s => s.evaluation?.totalScore ?? 0);
    const lessonAvg = Math.round(lessonScores.reduce((a, b) => a + b, 0) / lessonScores.length);
    const lessonBest = Math.max(...lessonScores);

    console.log(`\n   ${lessonTitle}`);
    console.log(`     Attempts: ${lessonSessions.length}`);
    console.log(`     Average: ${lessonAvg}/100`);
    console.log(`     Best: ${lessonBest}/100`);
  }

  // Recent sessions
  console.log("\n📅 Recent Sessions:");
  const recentSessions = sessions.slice(0, 5);
  for (const session of recentSessions) {
    const date = session.completedAt ? new Date(session.completedAt).toLocaleDateString() : "Unknown";
    console.log(`   ${date} - ${session.lessonTitle}: ${session.evaluation?.totalScore ?? 0}/100`);
  }

  // Insights
  console.log("\n💡 Insights:");
  const insights = generateInsights(sessions);
  for (const insight of insights) {
    console.log(`   • ${insight}`);
  }

  console.log("\n" + "=".repeat(50) + "\n");
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
