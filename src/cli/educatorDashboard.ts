import readline from "readline";
import { Student } from "../domain/student";
import { Session } from "../domain/session";
import { StudentStore } from "../stores/studentStore";
import { SessionStore } from "../stores/sessionStore";
import { InsightStore } from "../stores/insightStore";
import { TeacherActionStore } from "../stores/teacherActionStore";
import { Insight, InsightType, InsightStatus, getInsightTypeLabel, getPriorityLabel } from "../domain/insight";
import { TeacherAction, TeacherActionType } from "../domain/recommendation";
import { askMenu } from "./helpers";
import { displaySessionReplay } from "./sessionReplay";
import { runLessonBuilder } from "./lessonBuilder";
import {
  getClassAnalytics,
  getStudentAnalytics,
  formatDuration,
  getWeeklyActivity,
} from "../domain/analytics";
import {
  markInsightReviewed,
  addTeacherNote,
  pushAssignmentBack,
  awardBadge,
} from "../domain/actionHandlers";

// ============================================
// ID Generation
// ============================================

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

// ============================================
// Main Dashboard
// ============================================

/**
 * Main educator dashboard
 */
export async function runEducatorDashboard(rl: readline.Interface): Promise<void> {
  const studentStore = new StudentStore();
  const sessionStore = new SessionStore();
  const insightStore = new InsightStore();

  const students = studentStore.getAll();
  // Only show completed sessions (those with evaluation) in educator dashboard
  const allSessions = sessionStore.getAll().filter((s) => s.status === "completed");

  console.log("\n" + "=".repeat(60));
  console.log("Educator Dashboard");
  console.log("=".repeat(60));

  // Class-wide stats
  displayClassStats(students, allSessions);

  // Show pending insights count
  const pendingInsights = insightStore.getPending();
  if (pendingInsights.length > 0) {
    console.log(`\n🔔 You have ${pendingInsights.length} pending insight${pendingInsights.length > 1 ? "s" : ""} to review.`);
  }

  // Student list with stats
  displayStudentList(students, allSessions);

  // Menu loop
  let running = true;
  while (running) {
    const choice = await askMenu(rl, [
      "View student details",
      "View lesson stats",
      "View class analytics",
      `Review insights${pendingInsights.length > 0 ? ` (${pendingInsights.length} pending)` : ""}`,
      "Create new lesson",
      "Refresh dashboard",
      "Exit to main menu",
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
        await reviewInsights(rl);
        break;
      case 5:
        await runLessonBuilder(rl);
        break;
      case 6:
        // Refresh
        const refreshedStudents = studentStore.getAll();
        const refreshedSessions = sessionStore.getAll().filter((s) => s.status === "completed");
        const refreshedPendingInsights = insightStore.getPending();
        console.log("\n" + "=".repeat(60));
        console.log("Educator Dashboard (Refreshed)");
        console.log("=".repeat(60));
        displayClassStats(refreshedStudents, refreshedSessions);
        if (refreshedPendingInsights.length > 0) {
          console.log(`\n🔔 You have ${refreshedPendingInsights.length} pending insight${refreshedPendingInsights.length > 1 ? "s" : ""} to review.`);
        }
        displayStudentList(refreshedStudents, refreshedSessions);
        break;
      case 7:
        running = false;
        break;
    }
  }
}

// ============================================
// Insight Review
// ============================================

/**
 * Review and act on pending insights
 */
async function reviewInsights(rl: readline.Interface): Promise<void> {
  const insightStore = new InsightStore();
  const studentStore = new StudentStore();

  const pendingInsights = insightStore.getPending();

  if (pendingInsights.length === 0) {
    console.log("\n✅ No pending insights to review!\n");
    return;
  }

  console.log("\n" + "=".repeat(60));
  console.log("Review Insights - What Should I Do Next?");
  console.log("=".repeat(60));

  // Group insights by type for overview
  const byType: Record<InsightType, Insight[]> = {
    check_in: [],
    challenge_opportunity: [],
    celebrate_progress: [],
    monitor: [],
  };

  for (const insight of pendingInsights) {
    byType[insight.type].push(insight);
  }

  // Show summary
  console.log("\nPending Insights Summary:");
  if (byType.check_in.length > 0) {
    console.log(`  🔴 Check In: ${byType.check_in.length} student${byType.check_in.length > 1 ? "s" : ""} need support`);
  }
  if (byType.challenge_opportunity.length > 0) {
    console.log(`  🚀 Challenge: ${byType.challenge_opportunity.length} student${byType.challenge_opportunity.length > 1 ? "s" : ""} ready for more`);
  }
  if (byType.celebrate_progress.length > 0) {
    console.log(`  🎉 Celebrate: ${byType.celebrate_progress.length} achievement${byType.celebrate_progress.length > 1 ? "s" : ""} to recognize`);
  }
  if (byType.monitor.length > 0) {
    console.log(`  👀 Monitor: ${byType.monitor.length} situation${byType.monitor.length > 1 ? "s" : ""} to watch`);
  }

  // Build options list
  const options: string[] = [];
  const insightList: Insight[] = [];

  // Add check_in first (highest priority)
  for (const insight of byType.check_in) {
    const student = studentStore.load(insight.studentId);
    const studentName = student?.name || "Unknown";
    options.push(`🔴 [Check In] ${studentName}: ${insight.summary}`);
    insightList.push(insight);
  }

  // Add challenge_opportunity
  for (const insight of byType.challenge_opportunity) {
    const student = studentStore.load(insight.studentId);
    const studentName = student?.name || "Unknown";
    options.push(`🚀 [Challenge] ${studentName}: ${insight.summary}`);
    insightList.push(insight);
  }

  // Add celebrate_progress
  for (const insight of byType.celebrate_progress) {
    const student = studentStore.load(insight.studentId);
    const studentName = student?.name || "Unknown";
    options.push(`🎉 [Celebrate] ${studentName}: ${insight.summary}`);
    insightList.push(insight);
  }

  // Add monitor
  for (const insight of byType.monitor) {
    const student = studentStore.load(insight.studentId);
    const studentName = student?.name || "Unknown";
    options.push(`👀 [Monitor] ${studentName}: ${insight.summary}`);
    insightList.push(insight);
  }

  options.push("Back to dashboard");

  console.log("\nSelect an insight to review:\n");
  const choice = await askMenu(rl, options);

  if (choice <= insightList.length) {
    await reviewSingleInsight(rl, insightList[choice - 1]);
  }
}

/**
 * Review and act on a single insight
 */
async function reviewSingleInsight(rl: readline.Interface, insight: Insight): Promise<void> {
  const insightStore = new InsightStore();
  const studentStore = new StudentStore();
  const teacherActionStore = new TeacherActionStore();

  const student = studentStore.load(insight.studentId);
  const studentName = student?.name || "Unknown Student";

  console.log("\n" + "=".repeat(50));
  console.log(`Insight: ${getInsightTypeLabel(insight.type)}`);
  console.log("=".repeat(50));

  console.log(`\nStudent: ${studentName}`);
  console.log(`Priority: ${getPriorityLabel(insight.priority)}`);
  console.log(`Confidence: ${Math.round(insight.confidence * 100)}%`);
  console.log(`\nSummary: ${insight.summary}`);

  console.log("\nEvidence:");
  for (const item of insight.evidence) {
    console.log(`  • ${item}`);
  }

  console.log("\nSuggested Actions:");
  for (const action of insight.suggestedActions) {
    console.log(`  → ${action}`);
  }

  console.log("");

  // Action menu - includes push back and award badge options
  const menuOptions = [
    "Mark as reviewed",
    "Add a note",
    "Draft a message to student",
    ...(insight.assignmentId ? ["Reassign to student"] : []),
    "Award badge",
    "Start monitoring",
    "Dismiss",
    "Back (no action)",
  ];

  const actionChoice = await askMenu(rl, menuOptions);
  const hasAssignment = !!insight.assignmentId;

  // Map choice to action based on whether assignment option is present
  let action: string;
  if (hasAssignment) {
    const actions = ["mark_reviewed", "add_note", "draft_message", "push_back", "award_badge", "monitor", "dismiss", "back"];
    action = actions[actionChoice - 1];
  } else {
    const actions = ["mark_reviewed", "add_note", "draft_message", "award_badge", "monitor", "dismiss", "back"];
    action = actions[actionChoice - 1];
  }

  const teacherId = "educator"; // Would be actual teacher ID in multi-teacher setup

  switch (action) {
    case "mark_reviewed":
      // Use action handler to mark as reviewed
      try {
        markInsightReviewed(insight.id, teacherId);
        console.log("\n✅ Marked as reviewed.");
      } catch (error) {
        console.log(`\n❌ Error: ${(error as Error).message}`);
      }
      break;

    case "add_note":
      // Use action handler to add note
      const note = await askForText(rl, "Enter your note:");
      if (note) {
        try {
          addTeacherNote(insight.id, note, teacherId);
          console.log("\n📝 Note added.");
        } catch (error) {
          console.log(`\n❌ Error: ${(error as Error).message}`);
        }
      }
      break;

    case "draft_message":
      // Draft message to student (keep manual for now as it's a unique action type)
      const message = await askForText(rl, "Enter message to student:");
      if (message) {
        const teacherAction: TeacherAction = {
          id: generateId(),
          insightId: insight.id,
          teacherId,
          actionType: "draft_message",
          messageToStudent: message,
          createdAt: new Date(),
        };
        teacherActionStore.save(teacherAction);
        insightStore.updateStatus(insight.id, "action_taken", teacherId);
        console.log("\n✉️ Message drafted.");
      }
      break;

    case "push_back":
      // Use action handler to push assignment back
      if (insight.assignmentId) {
        try {
          pushAssignmentBack(insight.studentId, insight.assignmentId);
          insightStore.updateStatus(insight.id, "action_taken", teacherId);
          console.log("\n🔄 Assignment reassigned to student for retry.");
        } catch (error) {
          console.log(`\n❌ Error: ${(error as Error).message}`);
        }
      }
      break;

    case "award_badge":
      // Use action handler to award badge
      console.log("\nSelect badge type:\n");
      const badgeChoice = await askMenu(rl, [
        "⭐ Progress Star - Great effort",
        "🏆 Mastery Badge - Demonstrated understanding",
        "🎯 Focus Badge - Stayed on task",
        "💡 Creativity Badge - Showed creative thinking",
        "🤝 Collaboration Badge - Helped others",
        "Cancel",
      ]);

      if (badgeChoice < 6) {
        const badgeTypes = ["progress_star", "mastery_badge", "focus_badge", "creativity_badge", "collaboration_badge"];
        const selectedBadgeType = badgeTypes[badgeChoice - 1];
        const badgeMessage = await askForText(rl, "Add a message for the student (optional):");

        try {
          awardBadge(insight.studentId, selectedBadgeType, insight.assignmentId, teacherId, badgeMessage || undefined);
          insightStore.updateStatus(insight.id, "action_taken", teacherId);
          console.log("\n🏅 Badge awarded!");
        } catch (error) {
          console.log(`\n❌ Error: ${(error as Error).message}`);
        }
      }
      break;

    case "monitor":
      // Update insight to monitoring status
      insightStore.updateStatus(insight.id, "monitoring", teacherId);
      const monitorAction: TeacherAction = {
        id: generateId(),
        insightId: insight.id,
        teacherId,
        actionType: "mark_reviewed",
        note: "Set to monitoring",
        createdAt: new Date(),
      };
      teacherActionStore.save(monitorAction);
      console.log("\n👀 Added to monitoring list.");
      break;

    case "dismiss":
      // Update insight to dismissed status
      insightStore.updateStatus(insight.id, "dismissed", teacherId);
      const dismissAction: TeacherAction = {
        id: generateId(),
        insightId: insight.id,
        teacherId,
        actionType: "mark_reviewed",
        note: "Dismissed",
        createdAt: new Date(),
      };
      teacherActionStore.save(dismissAction);
      console.log("\n🗑️ Insight dismissed.");
      break;

    case "back":
      // Back - no action
      return;
  }
}

/**
 * Ask for text input
 */
async function askForText(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    console.log(`\n${prompt}`);
    rl.question("> ", (answer) => {
      resolve(answer.trim());
    });
  });
}

// ============================================
// Class Statistics
// ============================================

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
  const avgScore =
    sessions.length > 0
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
    const studentSessions = sessions.filter((s) => s.studentId === student.id);
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

// ============================================
// Student Details
// ============================================

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
  const options = students.map((s) => s.name);
  const choice = await askMenu(rl, [...options, "Back"]);

  if (choice === options.length + 1) {
    return;
  }

  const student = students[choice - 1];
  // Only show completed sessions
  const sessions = sessionStore.getCompletedByStudentId(student.id);
  const inProgressCount = sessionStore.getInProgressByStudentId(student.id).length;

  // Get insights for this student
  const insightStore = new InsightStore();
  const studentInsights = insightStore.getByStudent(student.id, false);

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
  if (studentInsights.length > 0) {
    console.log(`   Pending insights: ${studentInsights.length}`);
  }

  if (sessions.length === 0) {
    console.log("\n   No sessions completed yet.\n");
    return;
  }

  const avgScore = Math.round(
    sessions.reduce((sum, s) => sum + (s.evaluation?.totalScore ?? 0), 0) / sessions.length
  );
  const bestScore = Math.max(...sessions.map((s) => s.evaluation?.totalScore ?? 0));
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

  // Show pending insights for this student
  if (studentInsights.length > 0) {
    console.log("\n   Pending insights:");
    for (const insight of studentInsights) {
      const icon = insight.type === "check_in" ? "🔴" : insight.type === "challenge_opportunity" ? "🚀" : insight.type === "celebrate_progress" ? "🎉" : "👀";
      console.log(`     ${icon} ${insight.summary}`);
    }
  }

  // Recent sessions
  console.log("\n   Recent sessions:");
  const recent = sessions.slice(0, 5);
  for (const session of recent) {
    const date = session.completedAt ? new Date(session.completedAt).toLocaleDateString() : "Unknown";
    // Check if any responses have audio
    const hasAudio = session.submission.responses.some((r) => r.audioPath);
    const audioIcon = hasAudio ? " 🎤" : "";
    console.log(`     ${date} - ${session.lessonTitle}: ${session.evaluation?.totalScore ?? 0}/100${audioIcon}`);
  }

  // Offer to review a specific session or view insights
  console.log("");
  const reviewOptions = [
    "Review a session (with audio playback)",
    ...(studentInsights.length > 0 ? ["Review student insights"] : []),
    "Back to dashboard",
  ];
  const reviewChoice = await askMenu(rl, reviewOptions);

  if (reviewChoice === 1 && sessions.length > 0) {
    await reviewStudentSession(rl, sessions);
  } else if (reviewChoice === 2 && studentInsights.length > 0) {
    // Review first insight for this student
    await reviewSingleInsight(rl, studentInsights[0]);
  }
}

/**
 * Let educator review a specific student session with audio playback
 */
async function reviewStudentSession(rl: readline.Interface, sessions: Session[]): Promise<void> {
  console.log("\nSelect a session to review:\n");

  const options = sessions.map((s) => {
    const date = s.completedAt ? new Date(s.completedAt).toLocaleDateString() : "Unknown";
    const hasAudio = s.submission.responses.some((r) => r.audioPath);
    const audioIcon = hasAudio ? " 🎤" : "";
    return `${date} - ${s.lessonTitle} (${s.evaluation?.totalScore ?? 0}/100)${audioIcon}`;
  });

  const choice = await askMenu(rl, [...options, "Back"]);

  if (choice <= sessions.length) {
    const session = sessions[choice - 1];
    await displaySessionReplay(rl, session, true); // isEducator = true for audio playback
  }
}

// ============================================
// Lesson Statistics
// ============================================

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

  console.log(
    "\n   " + padRight("Lesson", 30) + padRight("Attempts", 10) + padRight("Avg Score", 12) + "Difficulty"
  );
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

// ============================================
// Class Analytics
// ============================================

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
  console.log(
    `   Students using coach: ${analytics.coachUsage.studentsUsingCoach}/${students.length} (${analytics.coachUsage.percentageUsingCoach}%)`
  );
  console.log(`   Help requests: ${analytics.coachUsage.helpRequestCount}`);
  console.log(`   Elaboration conversations: ${analytics.coachUsage.elaborationCount}`);
  console.log(`   "Tell me more" explorations: ${analytics.coachUsage.moreExplorationCount}`);
  if (analytics.coachUsage.totalInteractions > 0) {
    console.log(`   Avg turns per conversation: ${analytics.coachUsage.avgTurnsPerInteraction}`);
  }

  // Hint Usage
  console.log("\n💡 Hint Usage:");
  console.log(
    `   Hint usage rate: ${analytics.hintUsage.hintUsageRate}% (${analytics.hintUsage.totalHintsUsed}/${analytics.hintUsage.totalResponses})`
  );
  if (
    analytics.hintUsage.totalHintsUsed > 0 &&
    analytics.hintUsage.totalResponses - analytics.hintUsage.totalHintsUsed > 0
  ) {
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
    console.log("   " + padRight(week.week, 10) + padRight(week.sessions.toString(), 12) + scoreDisplay);
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

// ============================================
// Helper Functions
// ============================================

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
    const studentSessions = sessions.filter((s) => s.studentId === student.id);
    if (studentSessions.length === 0) continue;

    const avgScore =
      studentSessions.reduce((sum, s) => sum + (s.evaluation?.totalScore ?? 0), 0) / studentSessions.length;
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
