import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  getStudent,
  getStudentLessons,
  getSessions,
  createSession,
  type Student,
  type StudentLessonSummary,
  type Session,
} from "../services/api";

type SessionMode = "voice" | "type";

export default function StudentDashboard() {
  const { studentId } = useParams<{ studentId: string }>();
  const navigate = useNavigate();

  const [student, setStudent] = useState<Student | null>(null);
  const [lessons, setLessons] = useState<StudentLessonSummary[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  // Ask Coach modal state
  const [showCoachModal, setShowCoachModal] = useState(false);
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);

  // Completed Work section collapsed state
  const [completedExpanded, setCompletedExpanded] = useState(false);
  // Track which individual assignments are expanded (by lessonId)
  const [expandedAssignments, setExpandedAssignments] = useState<Set<string>>(new Set());

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

        // Sort lessons: by assigned date (oldest first), then by subject (alphabetical)
        const sortedLessons = [...studentLessonsData.lessons].sort((a, b) => {
          // First sort by assigned date (oldest first)
          const dateA = a.assignedAt ? new Date(a.assignedAt).getTime() : 0;
          const dateB = b.assignedAt ? new Date(b.assignedAt).getTime() : 0;
          if (dateA !== dateB) return dateA - dateB;

          // Then sort by subject alphabetically (no subject goes last)
          const subjectA = a.subject || "";
          const subjectB = b.subject || "";
          if (subjectA && !subjectB) return -1;
          if (!subjectA && subjectB) return 1;
          return subjectA.localeCompare(subjectB);
        });
        setLessons(sortedLessons);
        setSessions(sessionsData);
      } catch (err) {
        console.error("Failed to load dashboard:", err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [studentId]);

  const handleStartLesson = async (lesson: StudentLessonSummary, mode: "voice" | "type") => {
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

  // Get available topics from current lessons and completed sessions
  const getAvailableTopics = (): string[] => {
    const topicSet = new Set<string>();
    // Add current assignment titles
    lessons.forEach((l) => topicSet.add(l.title));
    // Add completed session lesson titles
    sessions.forEach((s) => topicSet.add(s.lessonTitle));
    return Array.from(topicSet);
  };

  const handleTopicToggle = (topic: string) => {
    setSelectedTopics((prev) =>
      prev.includes(topic)
        ? prev.filter((t) => t !== topic)
        : [...prev, topic]
    );
  };

  const handleStartCoachSession = (mode: SessionMode) => {
    const topicsParam = encodeURIComponent(JSON.stringify(selectedTopics));
    // Get gradeLevel from selected lessons (use first selected topic's grade level)
    const selectedLesson = lessons.find((l) => selectedTopics.includes(l.title));
    const gradeLevel = selectedLesson?.gradeLevel || "";
    navigate(`/student/${studentId}/coach?mode=${mode}&topics=${topicsParam}&gradeLevel=${encodeURIComponent(gradeLevel)}`);
    setShowCoachModal(false);
    setSelectedTopics([]);
  };

  const toggleAssignmentExpanded = (lessonId: string) => {
    setExpandedAssignments((prev) => {
      const next = new Set(prev);
      if (next.has(lessonId)) {
        next.delete(lessonId);
      } else {
        next.add(lessonId);
      }
      return next;
    });
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

  return (
    <div className="container">
      <Link to="/" className="back-btn">
        ← Back
      </Link>

      <div className="header">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1>Hi, {student.name}!</h1>
            <p>{lessons.length > 0 ? "Ready to learn? Pick an assignment below!" : "Welcome back!"}</p>
          </div>
          <button
            className="btn btn-secondary"
            onClick={() => setShowCoachModal(true)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "12px 20px",
              fontSize: "1rem",
            }}
          >
            <span style={{ fontSize: "1.3rem" }}>💬</span>
            Ask Coach
          </button>
        </div>
      </div>

      {/* Ask Coach Modal */}
      {showCoachModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setShowCoachModal(false)}
        >
          <div
            className="card"
            style={{ maxWidth: "480px", width: "90%", maxHeight: "80vh", overflow: "auto", position: "relative" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={() => {
                setShowCoachModal(false);
                setSelectedTopics([]);
              }}
              style={{
                position: "absolute",
                top: "12px",
                right: "12px",
                background: "none",
                border: "none",
                fontSize: "1.5rem",
                color: "#999",
                cursor: "pointer",
                padding: "4px 8px",
                lineHeight: 1,
              }}
            >
              ×
            </button>
            <h2 style={{ marginTop: 0, marginBottom: "8px" }}>Ask Coach</h2>
            <p style={{ color: "#666", marginBottom: "20px" }}>
              Select topics you want to explore with your coach.
            </p>

            {/* Topic Selection */}
            <div style={{ marginBottom: "24px" }}>
              <h4 style={{ margin: "0 0 12px 0", color: "#333" }}>Choose Topics</h4>
              {getAvailableTopics().length === 0 ? (
                <p style={{ color: "#999", fontStyle: "italic" }}>
                  No topics available yet. Complete some assignments first!
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {getAvailableTopics().map((topic) => (
                    <label
                      key={topic}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        padding: "12px",
                        background: selectedTopics.includes(topic) ? "#e3f2fd" : "#f5f5f5",
                        borderRadius: "8px",
                        cursor: "pointer",
                        border: selectedTopics.includes(topic) ? "2px solid #667eea" : "2px solid transparent",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedTopics.includes(topic)}
                        onChange={() => handleTopicToggle(topic)}
                        style={{ width: "18px", height: "18px" }}
                      />
                      <span style={{ fontWeight: 500 }}>{topic}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Mode Selection Buttons */}
            {selectedTopics.length === 0 && (
              <p style={{ color: "#999", fontStyle: "italic", textAlign: "center", marginBottom: "12px" }}>
                Please select at least one topic to start
              </p>
            )}
            <div style={{ display: "flex", gap: "12px" }}>
              <button
                className="btn btn-primary"
                onClick={() => handleStartCoachSession("voice")}
                disabled={selectedTopics.length === 0}
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                  padding: "14px",
                  opacity: selectedTopics.length === 0 ? 0.5 : 1,
                }}
              >
                <span style={{ fontSize: "1.2rem" }}>🎤</span>
                Voice Chat
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => handleStartCoachSession("type")}
                disabled={selectedTopics.length === 0}
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                  padding: "14px",
                  opacity: selectedTopics.length === 0 ? 0.5 : 1,
                }}
              >
                <span style={{ fontSize: "1.2rem" }}>⌨️</span>
                Type Chat
              </button>
            </div>
          </div>
        </div>
      )}

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
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <h3 style={{ margin: 0 }}>{lesson.title}</h3>
                {lesson.attempts > 1 && (
                  <span
                    style={{
                      background: "#e3f2fd",
                      color: "#1565c0",
                      padding: "4px 8px",
                      borderRadius: "12px",
                      fontSize: "0.75rem",
                      fontWeight: 600,
                    }}
                  >
                    Attempt #{lesson.attempts}
                  </span>
                )}
              </div>
              <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
                {lesson.subject && (
                  <span
                    style={{
                      background: "#f0f0ff",
                      color: "#667eea",
                      padding: "4px 10px",
                      borderRadius: "12px",
                      fontSize: "0.8rem",
                      fontWeight: 500,
                    }}
                  >
                    {lesson.subject}
                  </span>
                )}
                {lesson.assignedAt && (
                  <span style={{ color: "#888", fontSize: "0.85rem" }}>
                    Assigned {new Date(lesson.assignedAt).toLocaleDateString()}
                  </span>
                )}
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

      {/* Completed Work - grouped by assignment */}
      {sessions.length > 0 && (
        <>
          <button
            onClick={() => setCompletedExpanded(!completedExpanded)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              background: "none",
              border: "none",
              color: "white",
              cursor: "pointer",
              padding: "0",
              marginTop: "32px",
              marginBottom: "16px",
              fontSize: "1.5rem",
              fontWeight: 600,
            }}
          >
            <span
              style={{
                display: "inline-block",
                transition: "transform 0.2s",
                transform: completedExpanded ? "rotate(90deg)" : "rotate(0deg)",
              }}
            >
              ▶
            </span>
            Completed Work ({sessions.length})
          </button>
          {completedExpanded && (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {(() => {
              // Group sessions by lessonId
              const sessionsByLesson = new Map<string, Session[]>();
              sessions.forEach((session) => {
                const existing = sessionsByLesson.get(session.lessonId) || [];
                existing.push(session);
                sessionsByLesson.set(session.lessonId, existing);
              });

              // Sort sessions within each group by date (newest first)
              sessionsByLesson.forEach((lessonSessions) => {
                lessonSessions.sort((a, b) => {
                  const dateA = new Date(a.completedAt || a.startedAt).getTime();
                  const dateB = new Date(b.completedAt || b.startedAt).getTime();
                  return dateB - dateA;
                });
              });

              return Array.from(sessionsByLesson.entries()).map(([lessonId, lessonSessions]) => {
                const latestSession = lessonSessions[0];
                const totalAttempts = lessonSessions.length;
                const isExpanded = expandedAssignments.has(lessonId);

                return (
                  <div key={lessonId} className="card" style={{ padding: 0, overflow: "hidden" }}>
                    {/* Clickable header - always visible */}
                    <button
                      onClick={() => toggleAssignmentExpanded(lessonId)}
                      style={{
                        width: "100%",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "16px 20px",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <h3 style={{ margin: 0, color: "#667eea" }}>{latestSession.lessonTitle}</h3>
                        <p style={{ color: "#666", fontSize: "0.85rem", margin: "4px 0 0 0" }}>
                          {totalAttempts > 1
                            ? `${totalAttempts} attempts • Last completed ${new Date(latestSession.completedAt || latestSession.startedAt).toLocaleDateString()}`
                            : `Completed ${new Date(latestSession.completedAt || latestSession.startedAt).toLocaleDateString()}`}
                        </p>
                      </div>
                      <span
                        style={{
                          color: "#999",
                          fontSize: "0.9rem",
                          transition: "transform 0.2s",
                          transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                        }}
                      >
                        ▶
                      </span>
                    </button>

                    {/* Expandable content - Teacher Feedback by Attempt */}
                    {isExpanded && (
                      <div style={{ padding: "0 20px 16px 20px", display: "flex", flexDirection: "column", gap: "8px" }}>
                        {lessonSessions.map((session, index) => {
                          const attemptNumber = totalAttempts - index;
                          const hasNotes = !!session.educatorNotes;

                          return (
                            <div
                              key={session.id}
                              style={{
                                padding: "12px",
                                background: hasNotes ? "#e8f5e9" : "#f5f5f5",
                                borderRadius: "8px",
                                borderLeft: hasNotes ? "3px solid #4caf50" : "3px solid #ccc",
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                                {totalAttempts > 1 && (
                                  <span
                                    style={{
                                      fontSize: "0.75rem",
                                      fontWeight: 600,
                                      color: "#667eea",
                                      background: "#e8eaf6",
                                      padding: "2px 6px",
                                      borderRadius: "4px",
                                    }}
                                  >
                                    Attempt {attemptNumber}
                                  </span>
                                )}
                                <span style={{ fontSize: "0.75rem", color: "#999" }}>
                                  {new Date(session.completedAt || session.startedAt).toLocaleDateString()}
                                </span>
                                <span style={{ fontSize: "0.8rem", marginLeft: "auto" }}>
                                  {hasNotes ? "📝" : "⏳"}
                                </span>
                              </div>
                              <p
                                style={{
                                  margin: 0,
                                  fontSize: "0.9rem",
                                  color: hasNotes ? "#333" : "#999",
                                  fontStyle: hasNotes ? "normal" : "italic",
                                }}
                              >
                                {session.educatorNotes || "Not reviewed yet"}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              });
            })()}
          </div>
          )}
        </>
      )}
    </div>
  );
}
