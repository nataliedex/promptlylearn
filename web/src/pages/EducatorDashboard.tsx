import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getStudents, getSessions, getClassAnalytics, getLessons, type Student, type Session, type LessonSummary } from "../services/api";

export default function EducatorDashboard() {
  const navigate = useNavigate();
  const [students, setStudents] = useState<Student[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [lessons, setLessons] = useState<LessonSummary[]>([]);
  const [classAnalytics, setClassAnalytics] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const [studentsData, sessionsData, analyticsData, lessonsData] = await Promise.all([
          getStudents(),
          getSessions(undefined, "completed"),
          getClassAnalytics(),
          getLessons(),
        ]);
        setStudents(studentsData);
        setSessions(sessionsData);
        setClassAnalytics(analyticsData);
        setLessons(lessonsData);
      } catch (err) {
        console.error("Failed to load educator dashboard:", err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  if (loading) {
    return (
      <div className="loading">
        <div className="loading-spinner"></div>
        <p>Loading dashboard...</p>
      </div>
    );
  }

  const getStudentSessions = (studentId: string) =>
    sessions.filter((s) => s.studentId === studentId);

  const getStudentAvgScore = (studentId: string) => {
    const studentSessions = getStudentSessions(studentId);
    if (studentSessions.length === 0) return 0;
    return Math.round(
      studentSessions.reduce((sum, s) => sum + (s.evaluation?.totalScore ?? 0), 0) /
        studentSessions.length
    );
  };

  return (
    <div className="container">
      <Link to="/" className="back-btn">
        ← Back to Home
      </Link>

      <div className="header">
        <h1>Educator Dashboard</h1>
        <p>Monitor student progress and performance</p>
        <button
          className="btn btn-primary"
          onClick={() => navigate("/educator/create-lesson")}
          style={{ marginTop: "16px" }}
        >
          + Create New Lesson
        </button>
      </div>

      {/* Class Stats */}
      <div className="stats-grid">
        <div className="card stat-card">
          <div className="value">{students.length}</div>
          <div className="label">Total Students</div>
        </div>
        <div className="card stat-card">
          <div className="value">{sessions.length}</div>
          <div className="label">Sessions Completed</div>
        </div>
        <div className="card stat-card">
          <div className="value">
            {sessions.length > 0
              ? Math.round(
                  sessions.reduce(
                    (sum, s) => sum + (s.evaluation?.totalScore ?? 0),
                    0
                  ) / sessions.length
                )
              : 0}
          </div>
          <div className="label">Class Average</div>
        </div>
      </div>

      {/* Coach & Hint Usage */}
      {classAnalytics && (
        <div className="card">
          <h3 style={{ marginBottom: "16px" }}>📊 Class Analytics</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "16px" }}>
            <div>
              <p style={{ color: "#666", fontSize: "0.9rem" }}>Students Using Coach</p>
              <p style={{ fontSize: "1.2rem", fontWeight: 600 }}>
                {classAnalytics.coachUsage?.studentsUsingCoach ?? 0} /{" "}
                {students.length} ({classAnalytics.coachUsage?.percentageUsingCoach ?? 0}%)
              </p>
            </div>
            <div>
              <p style={{ color: "#666", fontSize: "0.9rem" }}>Hint Usage Rate</p>
              <p style={{ fontSize: "1.2rem", fontWeight: 600 }}>
                {classAnalytics.hintUsage?.hintUsageRate ?? 0}%
              </p>
            </div>
            <div>
              <p style={{ color: "#666", fontSize: "0.9rem" }}>Help Requests</p>
              <p style={{ fontSize: "1.2rem", fontWeight: 600 }}>
                {classAnalytics.coachUsage?.helpRequestCount ?? 0}
              </p>
            </div>
            <div>
              <p style={{ color: "#666", fontSize: "0.9rem" }}>Avg Session Time</p>
              <p style={{ fontSize: "1.2rem", fontWeight: 600 }}>
                {classAnalytics.sessionDuration?.averageMinutes ?? "-"} min
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Standards Coverage */}
      {(() => {
        const allStandards = lessons.flatMap(l => l.standards || []);
        const uniqueStandards = [...new Set(allStandards)].sort();
        const standardsByStrand: Record<string, string[]> = {};

        uniqueStandards.forEach(code => {
          const strand = code.split('.')[0]; // e.g., "RL" from "RL.2.1"
          if (!standardsByStrand[strand]) {
            standardsByStrand[strand] = [];
          }
          standardsByStrand[strand].push(code);
        });

        const strandNames: Record<string, string> = {
          RL: "Reading Literature",
          RI: "Reading Informational",
          RF: "Reading Foundational",
          W: "Writing",
          SL: "Speaking & Listening",
          L: "Language",
        };

        if (uniqueStandards.length === 0) return null;

        return (
          <div className="card">
            <h3 style={{ marginBottom: "16px" }}>📋 Ohio Learning Standards Coverage</h3>
            <p style={{ color: "#666", marginBottom: "16px", fontSize: "0.9rem" }}>
              {uniqueStandards.length} standards covered across {lessons.filter(l => l.standards && l.standards.length > 0).length} lessons
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {Object.entries(standardsByStrand).map(([strand, codes]) => (
                <div key={strand}>
                  <p style={{ fontWeight: 600, marginBottom: "8px", color: "#1565c0" }}>
                    {strandNames[strand] || strand} ({codes.length})
                  </p>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    {codes.map(code => (
                      <span
                        key={code}
                        style={{
                          background: "#e3f2fd",
                          color: "#1565c0",
                          padding: "4px 8px",
                          borderRadius: "4px",
                          fontSize: "0.8rem",
                          fontWeight: 500,
                        }}
                      >
                        {code}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Two-column layout for performers/support on desktop */}
      <div className="two-column">
        {/* Top Performers */}
        {classAnalytics?.topPerformers?.length > 0 && (
          <div className="card">
            <h3 style={{ marginBottom: "16px" }}>⭐ Top Performers</h3>
            {classAnalytics.topPerformers.map((student: any) => (
              <div
                key={student.name}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "8px 0",
                  borderBottom: "1px solid #eee",
                }}
              >
                <span>{student.name}</span>
                <span style={{ fontWeight: 600, color: "#667eea" }}>
                  {student.avgScore}/100
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Needs Support */}
        {classAnalytics?.needsSupport?.length > 0 && (
          <div className="card" style={{ borderLeft: "4px solid #ff9800" }}>
            <h3 style={{ marginBottom: "16px" }}>⚠️ Needs Support</h3>
            {classAnalytics.needsSupport.map((student: any) => (
              <div
                key={student.name}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "8px 0",
                  borderBottom: "1px solid #eee",
                }}
              >
                <div>
                  <span>{student.name}</span>
                  <span
                    style={{ marginLeft: "8px", color: "#666", fontSize: "0.9rem" }}
                  >
                    - {student.issue}
                  </span>
                </div>
                <span style={{ fontWeight: 600, color: "#ff9800" }}>
                  {student.avgScore}/100
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Student List */}
      <div className="card">
        <h3 style={{ marginBottom: "16px" }}>👥 All Students</h3>
        {students.length === 0 ? (
          <p style={{ color: "#666" }}>No students yet.</p>
        ) : (
          <div className="table-wrapper">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #eee" }}>
                <th style={{ textAlign: "left", padding: "12px 0" }}>Name</th>
                <th style={{ textAlign: "center", padding: "12px 0" }}>Sessions</th>
                <th style={{ textAlign: "center", padding: "12px 0" }}>Avg Score</th>
                <th style={{ textAlign: "right", padding: "12px 0" }}>Joined</th>
              </tr>
            </thead>
            <tbody>
              {students.map((student) => {
                const sessionCount = getStudentSessions(student.id).length;
                const avgScore = getStudentAvgScore(student.id);

                return (
                  <tr key={student.id} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{ padding: "12px 0" }}>{student.name}</td>
                    <td style={{ textAlign: "center", padding: "12px 0" }}>
                      {sessionCount}
                    </td>
                    <td style={{ textAlign: "center", padding: "12px 0" }}>
                      {sessionCount > 0 ? (
                        <span
                          style={{
                            color: avgScore >= 70 ? "#4caf50" : avgScore >= 50 ? "#ff9800" : "#f44336",
                            fontWeight: 600,
                          }}
                        >
                          {avgScore}
                        </span>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td style={{ textAlign: "right", padding: "12px 0", color: "#666" }}>
                      {new Date(student.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {/* Lesson Difficulty */}
      {classAnalytics?.lessonDifficulty?.length > 0 && (
        <div className="card">
          <h3 style={{ marginBottom: "16px" }}>📚 Lesson Difficulty</h3>
          {classAnalytics.lessonDifficulty.slice(0, 5).map((lesson: any) => (
            <div
              key={lesson.title}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "8px 0",
                borderBottom: "1px solid #eee",
              }}
            >
              <div>
                <span
                  style={{
                    marginRight: "8px",
                  }}
                >
                  {lesson.avgScore < 50 ? "🔴" : lesson.avgScore < 70 ? "🟡" : "🟢"}
                </span>
                <span>{lesson.title}</span>
              </div>
              <div style={{ textAlign: "right" }}>
                <span style={{ fontWeight: 600 }}>{lesson.avgScore}/100</span>
                <span style={{ color: "#666", marginLeft: "8px" }}>
                  ({lesson.attempts} attempts)
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
