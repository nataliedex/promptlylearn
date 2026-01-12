import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  getStudent,
  getLessons,
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
        const [studentData, lessonsData, sessionsData] = await Promise.all([
          getStudent(studentId!),
          getLessons(),
          getSessions(studentId, "completed"),
        ]);
        setStudent(studentData);
        setLessons(lessonsData);
        setSessions(sessionsData);
      } catch (err) {
        console.error("Failed to load dashboard:", err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [studentId]);

  const handleStartLesson = async (lesson: LessonSummary) => {
    if (!student) return;

    try {
      const session = await createSession({
        studentId: student.id,
        studentName: student.name,
        lessonId: lesson.id,
        lessonTitle: lesson.title,
      });
      navigate(`/student/${student.id}/lesson/${lesson.id}?session=${session.id}`);
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
        <p>Choose a lesson to start learning</p>
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
      <h2 style={{ color: "white", marginBottom: "16px" }}>Available Lessons</h2>
      <div className="lesson-grid">
        {lessons.map((lesson) => (
          <div
            key={lesson.id}
            className="card lesson-card"
            onClick={() => handleStartLesson(lesson)}
          >
            <h3>{lesson.title}</h3>
            <p>{lesson.description}</p>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <span className={`difficulty-badge difficulty-${lesson.difficulty}`}>
                {lesson.difficulty}
              </span>
              <span style={{ color: "#666", fontSize: "0.9rem" }}>
                {lesson.promptCount} questions
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Recent Sessions */}
      {sessions.length > 0 && (
        <>
          <h2 style={{ color: "white", marginTop: "32px", marginBottom: "16px" }}>
            Recent Sessions
          </h2>
          {sessions.slice(0, 5).map((session) => (
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
        </>
      )}
    </div>
  );
}
