import readline from "readline";
import { Student } from "../domain/student";
import { Session } from "../domain/session";
import { StudentStore } from "../stores/studentStore";
import { SessionStore } from "../stores/sessionStore";
import { askMenu } from "./helpers";
import { displaySessionReplay } from "./sessionReplay";
import { runLessonBuilder } from "./lessonBuilder";
import {
  getClassAnalytics,
  getStudentAnalytics,
  formatDuration,
  getWeeklyActivity,
} from "../domain/analytics";

/**
 * Main educator dashboard
 */
export async function runEducatorDashboard(rl: readline.Interface): Promise<void> {
  const studentStore = new StudentStore();
  const sessionStore = new SessionStore();

  const students = studentStore.getAll();
  // Only show completed sessions (those with evaluation) in educator dashboard
  const allSessions = sessionStore.getAll().filter(s => s.status === "completed");

  console.log("\n" + "=".repeat(60));
  console.log("Educator Dashboard");
  console.log("=".repeat(60));

  // Class-wide stats
  displayClassStats(students, allSessions);

  // Student list with stats
  displayStudentList(students, allSessions);

  // Menu loop
  let running = true;
  while (running) {
    const choice = await askMenu(rl, [
      "View student details",
      "View lesson stats",
      "View class analytics",
      "Create new lesson",
      "Refresh dashboard",
      "Exit to main menu"
    ]);

    switch (choice) {
      case 1:
        await viewStudentDetails(rl, students, sessionStore);
        break;
      case 2:
        viewLessonStats(allSessions);
        break;
      case 3:
        viewClassAnalytics(students, allSessions);
        break;
      case 4:
        await runLessonBuilder(rl);
        break;
      case 5:
        // Refresh
        const refreshedStudents = studentStore.getAll();
        const refreshedSessions = sessionStore.getAll().filter(s => s.status === "completed");
        console.log("\n" + "=".repeat(60));
        console.log("Educator Dashboard (Refreshed)");
        console.log("=".repeat(60));
        displayClassStats(refreshedStudents, refreshedSessions);
        displayStudentList(refreshedStudents, refreshedSessions);
        break;
      case 6:
        running = false;
        break;
    }
  }
}

/**
 * Display class-wide statistics
 */
function displayClassStats(students: Student[], sessions: Session[]): void {
  console.log("\n📊 Class Overview:\n");

  if (students.length === 0) {
    console.log("   No students yet.\n");
    return;
  }

  const totalStudents = students.length;
  const totalSessions = sessions.length;
  const avgScore = sessions.length > 0
    ? Math.round(sessions.reduce((sum, s) => sum + (s.evaluation?.totalScore ?? 0), 0) / sessions.length)
    : 0;

  // Find struggling students (avg < 60)
  const strugglingCount = countStrugglingStudents(students, sessions);

  console.log(`   Total Students: ${totalStudents}`);
  console.log(`   Total Sessions: ${totalSessions}`);
  console.log(`   Class Average: ${avgScore}/100`);

  if (strugglingCount > 0) {
    console.log(`   ⚠️  Students needing help: ${strugglingCount}`);
  }
}

/**
 * Display list of students with their stats
 */
function displayStudentList(students: Student[], sessions: Session[]): void {
  console.log("\n👥 Students:\n");

  if (students.length === 0) {
    console.log("   No students enrolled yet.\n");
    return;
  }

  // Header
  console.log("   " + padRight("Name", 20) + padRight("Sessions", 10) + padRight("Avg Score", 12) + "Status");
  console.log("   " + "-".repeat(52));

  for (const student of students) {
    const studentSessions = sessions.filter(s => s.studentId === student.id);
    const sessionCount = studentSessions.length;

    if (sessionCount === 0) {
      console.log("   " + padRight(student.name, 20) + padRight("0", 10) + padRight("-", 12) + "New");
      continue;
    }

    const avgScore = Math.round(
      studentSessions.reduce((sum, s) => sum + (s.evaluation?.totalScore ?? 0), 0) / sessionCount
    );
    const trend = calculateTrend(studentSessions);
    const status = getStudentStatus(avgScore, trend);

    console.log(
      "   " +
      padRight(student.name, 20) +
      padRight(sessionCount.toString(), 10) +
      padRight(`${avgScore}/100`, 12) +
      status
    );
  }

  console.log("");
}

/**
 * View details for a specific student
 */
async function viewStudentDetails(
  rl: readline.Interface,
  students: Student[],
  sessionStore: SessionStore
): Promise<void> {
  if (students.length === 0) {
    console.log("\nNo students to view.\n");
    return;
  }

  console.log("\nSelect a student:\n");
  const options = students.map(s => s.name);
  const choice = await askMenu(rl, [...options, "Back"]);

  if (choice === options.length + 1) {
    return;
  }

  const student = students[choice - 1];
  // Only show completed sessions
  const sessions = sessionStore.getCompletedByStudentId(student.id);
  const inProgressCount = sessionStore.getInProgressByStudentId(student.id).length;

  console.log("\n" + "=".repeat(50));
  console.log(`Student Details: ${student.name}`);
  console.log("=".repeat(50));

  const joinDate = new Date(student.createdAt).toLocaleDateString();
  console.log(`\n   Joined: ${joinDate}`);
  console.log(`   Student ID: ${student.id}`);
  console.log(`   Sessions completed: ${sessions.length}`);
  if (inProgressCount > 0) {
    console.log(`   Sessions in progress: ${inProgressCount}`);
  }

  if (sessions.length === 0) {
    console.log("\n   No sessions completed yet.\n");
    return;
  }

  const avgScore = Math.round(
    sessions.reduce((sum, s) => sum + (s.evaluation?.totalScore ?? 0), 0) / sessions.length
  );
  const bestScore = Math.max(...sessions.map(s => s.evaluation?.totalScore ?? 0));
  const trend = calculateTrend(sessions);

  console.log(`   Average score: ${avgScore}/100`);
  console.log(`   Best score: ${bestScore}/100`);
  console.log(`   Trend: ${trend}`);

  // Student Analytics
  const studentAnalytics = getStudentAnalytics(sessions);
  console.log(`   Engagement score: ${studentAnalytics.engagementScore}/100`);

  if (studentAnalytics.sessionDuration) {
    console.log(`   Avg session time: ${formatDuration(studentAnalytics.sessionDuration.averageMinutes)}`);
  }

  // Coach usage for this student
  if (studentAnalytics.coachUsage.totalInteractions > 0) {
    console.log(`   Coach interactions: ${studentAnalytics.coachUsage.totalInteractions}`);
  }

  // Input method preference
  if (studentAnalytics.inputMethods.voiceCount > 0) {
    console.log(`   Voice input usage: ${studentAnalytics.inputMethods.voicePercentage}%`);
  }

  // Lessons attempted
  const lessonMap = new Map<string, number[]>();
  for (const session of sessions) {
    const scores = lessonMap.get(session.lessonTitle) || [];
    scores.push(session.evaluation?.totalScore ?? 0);
    lessonMap.set(session.lessonTitle, scores);
  }

  console.log("\n   Lessons attempted:");
  for (const [lessonTitle, scores] of lessonMap) {
    const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    const best = Math.max(...scores);
    console.log(`     - ${lessonTitle}: ${scores.length} attempt(s), avg ${avg}, best ${best}`);
  }

  // Recent sessions
  console.log("\n   Recent sessions:");
  const recent = sessions.slice(0, 5);
  for (const session of recent) {
    const date = session.completedAt ? new Date(session.completedAt).toLocaleDateString() : "Unknown";
    // Check if any responses have audio
    const hasAudio = session.submission.responses.some(r => r.audioPath);
    const audioIcon = hasAudio ? " 🎤" : "";
    console.log(`     ${date} - ${session.lessonTitle}: ${session.evaluation?.totalScore ?? 0}/100${audioIcon}`);
  }

  // Offer to review a specific session
  console.log("");
  const reviewChoice = await askMenu(rl, [
    "Review a session (with audio playback)",
    "Back to dashboard"
  ]);

  if (reviewChoice === 1 && sessions.length > 0) {
    await reviewStudentSession(rl, sessions);
  }
}

/**
 * Let educator review a specific student session with audio playback
 */
async function reviewStudentSession(
  rl: readline.Interface,
  sessions: Session[]
): Promise<void> {
  console.log("\nSelect a session to review:\n");

  const options = sessions.map(s => {
    const date = s.completedAt ? new Date(s.completedAt).toLocaleDateString() : "Unknown";
    const hasAudio = s.submission.responses.some(r => r.audioPath);
    const audioIcon = hasAudio ? " 🎤" : "";
    return `${date} - ${s.lessonTitle} (${s.evaluation?.totalScore ?? 0}/100)${audioIcon}`;
  });

  const choice = await askMenu(rl, [...options, "Back"]);

  if (choice <= sessions.length) {
    const session = sessions[choice - 1];
    await displaySessionReplay(rl, session, true); // isEducator = true for audio playback
  }
}

/**
 * View statistics by lesson
 */
function viewLessonStats(sessions: Session[]): void {
  console.log("\n" + "=".repeat(50));
  console.log("Lesson Statistics");
  console.log("=".repeat(50));

  if (sessions.length === 0) {
    console.log("\n   No sessions completed yet.\n");
    return;
  }

  // Group by lesson
  const lessonMap = new Map<string, Session[]>();
  for (const session of sessions) {
    const lessonSessions = lessonMap.get(session.lessonTitle) || [];
    lessonSessions.push(session);
    lessonMap.set(session.lessonTitle, lessonSessions);
  }

  console.log("\n   " + padRight("Lesson", 30) + padRight("Attempts", 10) + padRight("Avg Score", 12) + "Difficulty");
  console.log("   " + "-".repeat(62));

  // Sort by number of attempts (most popular first)
  const sorted = [...lessonMap.entries()].sort((a, b) => b[1].length - a[1].length);

  for (const [lessonTitle, lessonSessions] of sorted) {
    const attempts = lessonSessions.length;
    const avgScore = Math.round(
      lessonSessions.reduce((sum, s) => sum + (s.evaluation?.totalScore ?? 0), 0) / attempts
    );

    // Determine difficulty indicator based on average score
    let difficulty = "Normal";
    if (avgScore < 50) {
      difficulty = "🔴 Hard";
    } else if (avgScore < 70) {
      difficulty = "🟡 Medium";
    } else {
      difficulty = "🟢 Easy";
    }

    console.log(
      "   " +
      padRight(lessonTitle, 30) +
      padRight(attempts.toString(), 10) +
      padRight(`${avgScore}/100`, 12) +
      difficulty
    );
  }

  console.log("");
}

/**
 * Calculate trend based on recent sessions
 */
function calculateTrend(sessions: Session[]): string {
  if (sessions.length < 2) return "➡️ New";

  const recent = sessions.slice(0, Math.min(3, sessions.length));
  const recentAvg = recent.reduce((a, s) => a + (s.evaluation?.totalScore ?? 0), 0) / recent.length;

  if (sessions.length < 4) {
    const first = sessions[sessions.length - 1].evaluation?.totalScore ?? 0;
    const diff = recentAvg - first;
    if (diff > 10) return "📈 Improving";
    if (diff < -10) return "📉 Declining";
    return "➡️ Steady";
  }

  const older = sessions.slice(3, Math.min(6, sessions.length));
  const olderAvg = older.reduce((a, s) => a + (s.evaluation?.totalScore ?? 0), 0) / older.length;
  const diff = recentAvg - olderAvg;

  if (diff > 10) return "📈 Improving";
  if (diff < -10) return "📉 Declining";
  return "➡️ Steady";
}

/**
 * Get status string for a student
 */
function getStudentStatus(avgScore: number, trend: string): string {
  if (avgScore < 50 || trend.includes("Declining")) {
    return "⚠️ Needs help";
  }
  if (avgScore >= 80 && trend.includes("Improving")) {
    return "⭐ Excellent";
  }
  if (avgScore >= 70) {
    return "✅ On track";
  }
  return "📝 Progressing";
}

/**
 * Count students who are struggling
 */
function countStrugglingStudents(students: Student[], sessions: Session[]): number {
  let count = 0;
  for (const student of students) {
    const studentSessions = sessions.filter(s => s.studentId === student.id);
    if (studentSessions.length === 0) continue;

    const avgScore = studentSessions.reduce((sum, s) => sum + (s.evaluation?.totalScore ?? 0), 0) / studentSessions.length;
    if (avgScore < 60) {
      count++;
    }
  }
  return count;
}

/**
 * Pad string to the right
 */
function padRight(str: string, len: number): string {
  return str.padEnd(len);
}

/**
 * View detailed class analytics
 */
function viewClassAnalytics(students: Student[], sessions: Session[]): void {
  console.log("\n" + "=".repeat(60));
  console.log("Class Analytics");
  console.log("=".repeat(60));

  if (sessions.length === 0) {
    console.log("\n   No sessions completed yet.\n");
    return;
  }

  const analytics = getClassAnalytics(students, sessions);

  // Session Duration
  console.log("\n⏱️  Session Duration:");
  if (analytics.sessionDuration) {
    console.log(`   Average: ${formatDuration(analytics.sessionDuration.averageMinutes)}`);
    console.log(`   Fastest: ${formatDuration(analytics.sessionDuration.fastestMinutes)}`);
    console.log(`   Slowest: ${formatDuration(analytics.sessionDuration.slowestMinutes)}`);
  } else {
    console.log("   No duration data available.");
  }

  // Coach Usage
  console.log("\n🎓 Coach Usage:");
  console.log(`   Students using coach: ${analytics.coachUsage.studentsUsingCoach}/${students.length} (${analytics.coachUsage.percentageUsingCoach}%)`);
  console.log(`   Help requests: ${analytics.coachUsage.helpRequestCount}`);
  console.log(`   Elaboration conversations: ${analytics.coachUsage.elaborationCount}`);
  console.log(`   "Tell me more" explorations: ${analytics.coachUsage.moreExplorationCount}`);
  if (analytics.coachUsage.totalInteractions > 0) {
    console.log(`   Avg turns per conversation: ${analytics.coachUsage.avgTurnsPerInteraction}`);
  }

  // Hint Usage
  console.log("\n💡 Hint Usage:");
  console.log(`   Hint usage rate: ${analytics.hintUsage.hintUsageRate}% (${analytics.hintUsage.totalHintsUsed}/${analytics.hintUsage.totalResponses})`);
  if (analytics.hintUsage.totalHintsUsed > 0 && analytics.hintUsage.totalResponses - analytics.hintUsage.totalHintsUsed > 0) {
    console.log(`   Avg score with hint: ${analytics.hintUsage.avgScoreWithHint}/50`);
    console.log(`   Avg score without hint: ${analytics.hintUsage.avgScoreWithoutHint}/50`);
  }

  // Top Performers
  if (analytics.topPerformers.length > 0) {
    console.log("\n⭐ Top Performers:");
    for (const student of analytics.topPerformers) {
      console.log(`   ${student.name}: ${student.avgScore}/100`);
    }
  }

  // Students Needing Support
  if (analytics.needsSupport.length > 0) {
    console.log("\n⚠️  Students Needing Support:");
    for (const student of analytics.needsSupport) {
      console.log(`   ${student.name}: ${student.avgScore}/100 - ${student.issue}`);
    }
  }

  // Weekly Activity
  console.log("\n📅 Weekly Activity (Last 4 Weeks):");
  const weeklyActivity = getWeeklyActivity(sessions, 4);
  console.log("   " + padRight("Week", 10) + padRight("Sessions", 12) + "Avg Score");
  console.log("   " + "-".repeat(32));
  for (const week of weeklyActivity) {
    const scoreDisplay = week.sessions > 0 ? `${week.avgScore}/100` : "-";
    console.log(
      "   " +
      padRight(week.week, 10) +
      padRight(week.sessions.toString(), 12) +
      scoreDisplay
    );
  }

  // Lesson Difficulty (hardest first)
  if (analytics.lessonDifficulty.length > 0) {
    console.log("\n📚 Lesson Difficulty (Hardest First):");
    console.log("   " + padRight("Lesson", 30) + padRight("Avg Score", 12) + "Attempts");
    console.log("   " + "-".repeat(52));
    for (const lesson of analytics.lessonDifficulty.slice(0, 5)) {
      const indicator = lesson.avgScore < 50 ? "🔴" : lesson.avgScore < 70 ? "🟡" : "🟢";
      console.log(
        "   " +
        padRight(`${indicator} ${lesson.title}`.slice(0, 29), 30) +
        padRight(`${lesson.avgScore}/100`, 12) +
        lesson.attempts.toString()
      );
    }
  }

  console.log("");
}
