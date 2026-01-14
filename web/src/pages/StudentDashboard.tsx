import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  getStudent,
  getStudentLessons,
  getSessions,
  createSession,
  type Student,
  type LessonSummary,
  type Session,
} from "../services/api";

export default function StudentDashboard() {
  const { studentId } = useParams<{ studentId: string }>();
  const navigate = useNavigate();

  const [student, setStudent] = useState<Student | null>(null);
  const [lessons, setLessons] = useState<LessonSummary[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!studentId) return;

    async function loadData() {
      try {
        const [studentData, studentLessonsData, sessionsData] = await Promise.all([
          getStudent(studentId!),
          getStudentLessons(studentId!),
          getSessions(studentId, "completed"),
        ]);
        setStudent(studentData);
        setLessons(studentLessonsData.lessons);
        setSessions(sessionsData);
      } catch (err) {
        console.error("Failed to load dashboard:", err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [studentId]);

  const handleStartLesson = async (lesson: LessonSummary, mode: "voice" | "type") => {
    if (!student) return;

    try {
      const session = await createSession({
        studentId: student.id,
        studentName: student.name,
        lessonId: lesson.id,
        lessonTitle: lesson.title,
      });
      navigate(`/student/${student.id}/lesson/${lesson.id}?session=${session.id}&mode=${mode}`);
    } catch (err) {
      console.error("Failed to start lesson:", err);
    }
  };

  if (loading) {
    return (
      <div className="loading">
        <div className="loading-spinner"></div>
        <p>Loading...</p>
      </div>
    );
  }

  if (!student) {
    return (
      <div className="container">
        <div className="card">
          <p>Student not found.</p>
          <Link to="/" className="btn btn-primary" style={{ marginTop: "16px" }}>
            Go Home
          </Link>
        </div>
      </div>
    );
  }

  const avgScore =
    sessions.length > 0
      ? Math.round(
          sessions.reduce((sum, s) => sum + (s.evaluation?.totalScore ?? 0), 0) /
            sessions.length
        )
      : 0;

  return (
    <div className="container">
      <Link to="/" className="back-btn">
        ← Back
      </Link>

      <div className="header">
        <h1>Hi, {student.name}!</h1>
        <p>{lessons.length > 0 ? "Ready to learn? Pick an assignment below!" : "Welcome back!"}</p>
      </div>

      {/* Stats */}
      <div className="stats-grid">
        <div className="card stat-card">
          <div className="value">{sessions.length}</div>
          <div className="label">Lessons Completed</div>
        </div>
        <div className="card stat-card">
          <div className="value">{avgScore}</div>
          <div className="label">Average Score</div>
        </div>
        <div
          className="card stat-card"
          style={{ cursor: "pointer" }}
          onClick={() => navigate(`/student/${student.id}/progress`)}
        >
          <div className="value">📊</div>
          <div className="label">View Progress</div>
        </div>
      </div>

      {/* Lessons */}
      <h2 style={{ color: "white", marginBottom: "16px" }}>Your Assignments</h2>
      {lessons.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "48px" }}>
          <div style={{ fontSize: "3rem", marginBottom: "16px" }}>📚</div>
          <h3 style={{ margin: 0, marginBottom: "8px" }}>No assignments yet!</h3>
          <p style={{ color: "#666", margin: 0 }}>
            Your teacher will assign lessons for you to work on.
          </p>
          <p style={{ color: "#666", margin: 0, marginTop: "8px" }}>
            Check back soon!
          </p>
        </div>
      ) : (
        <div className="lesson-grid">
          {lessons.map((lesson) => (
            <div key={lesson.id} className="card lesson-card" style={{ cursor: "default" }}>
              <h3>{lesson.title}</h3>
              <p>{lesson.description}</p>
              <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "16px" }}>
                <span className={`difficulty-badge difficulty-${lesson.difficulty}`}>
                  {lesson.difficulty}
                </span>
                <span style={{ color: "#666", fontSize: "0.9rem" }}>
                  {lesson.promptCount} questions
                </span>
              </div>
              <div style={{ display: "flex", gap: "12px" }}>
                <button
                  className="btn btn-primary"
                  onClick={() => handleStartLesson(lesson, "voice")}
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "8px",
                    padding: "12px 16px",
                  }}
                >
                  <span style={{ fontSize: "1.2rem" }}>🎤</span>
                  <span>Voice</span>
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => handleStartLesson(lesson, "type")}
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "8px",
                    padding: "12px 16px",
                  }}
                >
                  <span style={{ fontSize: "1.2rem" }}>⌨️</span>
                  <span>Type</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recent Sessions */}
      {sessions.length > 0 && (
        <>
          <h2 style={{ color: "white", marginTop: "32px", marginBottom: "16px" }}>
            Recent Sessions
          </h2>
          <div className="session-list">
            {sessions.slice(0, 6).map((session) => (
              <div key={session.id} className="card">
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <div>
                    <strong>{session.lessonTitle}</strong>
                    <p style={{ color: "#666", fontSize: "0.9rem" }}>
                      {new Date(session.completedAt || session.startedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="score-display" style={{ fontSize: "1.5rem" }}>
                      {session.evaluation?.totalScore ?? 0}/100
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
