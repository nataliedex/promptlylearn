import { Router } from "express";
import { StudentStore } from "../../stores/studentStore";
import { SessionStore } from "../../stores/sessionStore";
import {
  getStudentAnalytics,
  getClassAnalytics,
  getWeeklyActivity,
} from "../../domain/analytics";

const router = Router();
const studentStore = new StudentStore();
const sessionStore = new SessionStore();

// GET /api/analytics/student/:id - Get analytics for a specific student
router.get("/student/:id", (req, res) => {
  try {
    const sessions = sessionStore.getCompletedByStudentId(req.params.id);
    const analytics = getStudentAnalytics(sessions);

    // Add additional computed fields
    const scores = sessions.map(s => s.evaluation?.totalScore ?? 0);
    const avgScore = scores.length > 0
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : 0;
    const bestScore = scores.length > 0 ? Math.max(...scores) : 0;

    res.json({
      ...analytics,
      sessionCount: sessions.length,
      avgScore,
      bestScore,
      weeklyActivity: getWeeklyActivity(sessions, 4),
    });
  } catch (error) {
    console.error("Error fetching student analytics:", error);
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});

// GET /api/analytics/class - Get class-wide analytics
router.get("/class", (req, res) => {
  try {
    const students = studentStore.getAll();
    const sessions = sessionStore.getAll().filter(s => s.status === "completed");
    const analytics = getClassAnalytics(students, sessions);

    res.json({
      ...analytics,
      studentCount: students.length,
      totalSessions: sessions.length,
    });
  } catch (error) {
    console.error("Error fetching class analytics:", error);
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});

export default router;
