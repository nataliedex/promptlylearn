import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import {
  getStudent,
  getStudentAnalytics,
  type Student,
  type StudentAnalytics,
} from "../services/api";

export default function Progress() {
  const { studentId } = useParams<{ studentId: string }>();
  const [student, setStudent] = useState<Student | null>(null);
  const [analytics, setAnalytics] = useState<StudentAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!studentId) return;

    async function loadData() {
      try {
        const [studentData, analyticsData] = await Promise.all([
          getStudent(studentId!),
          getStudentAnalytics(studentId!),
        ]);
        setStudent(studentData);
        setAnalytics(analyticsData);
      } catch (err) {
        console.error("Failed to load progress:", err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [studentId]);

  if (loading) {
    return (
      <div className="loading">
        <div className="loading-spinner"></div>
        <p>Loading progress...</p>
      </div>
    );
  }

  if (!student || !analytics) {
    return (
      <div className="container">
        <div className="card">
          <p>Could not load progress data.</p>
          <Link to="/" className="btn btn-primary">
            Go Home
          </Link>
        </div>
      </div>
    );
  }

  const maxWeeklySessions = Math.max(
    ...analytics.weeklyActivity.map((w) => w.sessions),
    1
  );

  return (
    <div className="container">
      <Link to={`/student/${studentId}`} className="back-btn">
        ← Back to Dashboard
      </Link>

      <div className="header">
        <h1>Your Progress</h1>
        <p>Keep up the great work, {student.name}!</p>
      </div>

      {/* Stats Grid */}
      <div className="stats-grid">
        <div className="card stat-card">
          <div className="value">{analytics.sessionCount}</div>
          <div className="label">Lessons Completed</div>
        </div>
        <div className="card stat-card">
          <div className="value">{analytics.avgScore}</div>
          <div className="label">Average Score</div>
        </div>
        <div className="card stat-card">
          <div className="value">{analytics.bestScore}</div>
          <div className="label">Best Score</div>
        </div>
        <div className="card stat-card">
          <div className="value">{analytics.engagementScore}</div>
          <div className="label">Engagement</div>
        </div>
      </div>

      {/* Score Progress */}
      <div className="card">
        <h3 style={{ marginBottom: "16px" }}>Score Progress</h3>

        <div style={{ marginBottom: "16px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: "8px",
            }}
          >
            <span>Average Score</span>
            <span>{analytics.avgScore}/100</span>
          </div>
          <div className="progress-bar">
            <div
              className="progress-bar-fill"
              style={{ width: `${analytics.avgScore}%` }}
            ></div>
          </div>
        </div>

        <div style={{ marginBottom: "16px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: "8px",
            }}
          >
            <span>Best Score</span>
            <span>{analytics.bestScore}/100</span>
          </div>
          <div className="progress-bar">
            <div
              className="progress-bar-fill"
              style={{ width: `${analytics.bestScore}%` }}
            ></div>
          </div>
        </div>

        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: "8px",
            }}
          >
            <span>Engagement Score</span>
            <span>{analytics.engagementScore}/100</span>
          </div>
          <div className="progress-bar">
            <div
              className="progress-bar-fill"
              style={{ width: `${analytics.engagementScore}%` }}
            ></div>
          </div>
        </div>
      </div>

      {/* Weekly Activity */}
      <div className="card">
        <h3 style={{ marginBottom: "16px" }}>Weekly Activity</h3>
        <div className="weekly-chart">
          {analytics.weeklyActivity.map((week) => (
            <div key={week.week} className="week-row">
              <span className="week-label">{week.week}</span>
              <div className="week-bar">
                <div
                  className="week-bar-fill"
                  style={{
                    width: `${(week.sessions / maxWeeklySessions) * 100}%`,
                  }}
                ></div>
              </div>
              <span className="week-value">
                {week.sessions} session{week.sessions !== 1 ? "s" : ""}
                {week.sessions > 0 && ` (avg ${week.avgScore})`}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Stats Details */}
      {analytics.sessionDuration && (
        <div className="card">
          <h3 style={{ marginBottom: "16px" }}>Session Stats</h3>
          <p>
            ⏱️ Average session time:{" "}
            <strong>{analytics.sessionDuration.averageMinutes} min</strong>
          </p>
          <p>
            🚀 Fastest session:{" "}
            <strong>{analytics.sessionDuration.fastestMinutes} min</strong>
          </p>
          <p>
            💡 Hint usage rate:{" "}
            <strong>{analytics.hintUsage.hintUsageRate}%</strong>
          </p>
        </div>
      )}

      {/* Achievements placeholder */}
      <div className="card">
        <h3 style={{ marginBottom: "16px" }}>🏆 Achievements</h3>
        {analytics.sessionCount >= 5 && (
          <div className="achievement">
            <span className="achievement-icon">📖</span>
            <span>Getting Started - Completed 5+ lessons</span>
          </div>
        )}
        {analytics.avgScore >= 80 && (
          <div className="achievement">
            <span className="achievement-icon">⭐</span>
            <span>High Achiever - Average score 80+</span>
          </div>
        )}
        {analytics.engagementScore >= 70 && (
          <div className="achievement">
            <span className="achievement-icon">💪</span>
            <span>Super Engaged - Engagement score 70+</span>
          </div>
        )}
        {analytics.sessionCount === 0 && (
          <p style={{ color: "#666" }}>
            Complete lessons to earn achievements!
          </p>
        )}
      </div>

      <div className="nav-buttons">
        <Link
          to={`/student/${studentId}`}
          className="btn btn-primary"
          style={{ textAlign: "center", textDecoration: "none" }}
        >
          Start Another Lesson
        </Link>
      </div>
    </div>
  );
}
