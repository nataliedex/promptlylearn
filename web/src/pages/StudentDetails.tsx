/**
 * Student Details - Enhanced View
 *
 * Design Philosophy:
 * - Summary tiles for quick understanding at a glance
 * - Open assignments (needs attention) vs completed & reviewed
 * - Coaching insights showing support-seeking vs enrichment-seeking patterns
 */

import { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  getStudent,
  getSessions,
  getLessons,
  getStudentCoachingInsights,
  type Student,
  type LessonSummary,
  type CoachingInsight,
} from "../services/api";
import {
  deriveUnderstanding,
  deriveCoachSupport,
  getUnderstandingLabel,
  getUnderstandingColor,
  getUnderstandingBgColor,
  getCoachSupportLabel,
} from "../utils/teacherDashboardUtils";
import type { UnderstandingLevel, CoachSupportLevel } from "../types/teacherDashboard";

interface StudentAssignment {
  lessonId: string;
  lessonTitle: string;
  isComplete: boolean;
  questionsAnswered: number;
  totalQuestions: number;
  understanding: UnderstandingLevel;
  coachSupport: CoachSupportLevel;
  completedAt?: string;
  hasTeacherNote: boolean;
}

export default function StudentDetails() {
  const { studentId } = useParams<{ studentId: string }>();
  const navigate = useNavigate();
  const [student, setStudent] = useState<Student | null>(null);
  const [assignments, setAssignments] = useState<StudentAssignment[]>([]);
  const [coachingInsights, setCoachingInsights] = useState<CoachingInsight | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCompleted, setShowCompleted] = useState(false);

  useEffect(() => {
    if (!studentId) return;

    async function loadData() {
      try {
        const [studentData, sessions, lessons, insights] = await Promise.all([
          getStudent(studentId!),
          getSessions(studentId, "completed"),
          getLessons(),
          getStudentCoachingInsights(studentId!),
        ]);

        setStudent(studentData);
        setCoachingInsights(insights);

        // Build assignment list
        const assignmentList: StudentAssignment[] = [];

        lessons.forEach((lesson: LessonSummary) => {
          const session = sessions.find((s) => s.lessonId === lesson.id);

          if (session) {
            // Student has attempted this assignment
            const score = session.evaluation?.totalScore ?? 0;
            const understanding = deriveUnderstanding(score);
            const hintsUsed = session.submission.responses.filter((r) => r.hintUsed).length;
            const coachSupport = deriveCoachSupport(hintsUsed, session.submission.responses.length);

            assignmentList.push({
              lessonId: lesson.id,
              lessonTitle: lesson.title,
              isComplete: session.status === "completed",
              questionsAnswered: session.submission.responses.length,
              totalQuestions: lesson.promptCount,
              understanding,
              coachSupport,
              completedAt: session.completedAt,
              hasTeacherNote: !!session.educatorNotes,
            });
          } else {
            // Student hasn't started this assignment
            assignmentList.push({
              lessonId: lesson.id,
              lessonTitle: lesson.title,
              isComplete: false,
              questionsAnswered: 0,
              totalQuestions: lesson.promptCount,
              understanding: "needs-support",
              coachSupport: "minimal",
              hasTeacherNote: false,
            });
          }
        });

        setAssignments(assignmentList);
      } catch (err) {
        console.error("Failed to load student details:", err);
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
        <p>Loading student details...</p>
      </div>
    );
  }

  if (!student) {
    return (
      <div className="container">
        <div className="card">
          <p>Student not found.</p>
          <Link to="/educator" className="btn btn-primary" style={{ marginTop: "16px" }}>
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  // Categorize assignments
  const completedWithNote = assignments.filter((a) => a.isComplete && a.hasTeacherNote);
  const completedWithoutNote = assignments.filter((a) => a.isComplete && !a.hasTeacherNote);
  const inProgressAssignments = assignments.filter((a) => !a.isComplete && a.questionsAnswered > 0);
  const notStartedAssignments = assignments.filter((a) => a.questionsAnswered === 0);

  // Open = needs attention: in progress, completed without review, not started
  const openAssignments = [...completedWithoutNote, ...inProgressAssignments];
  const reviewedAssignments = completedWithNote;

  // Summary tile counts
  const strongCount = assignments.filter((a) => a.questionsAnswered > 0 && a.understanding === "strong").length;
  const developingCount = assignments.filter((a) => a.questionsAnswered > 0 && a.understanding === "developing").length;
  const needsHelpCount = assignments.filter((a) => a.questionsAnswered > 0 && a.understanding === "needs-support").length;

  return (
    <div className="container">
      <Link to="/educator" className="back-btn">
        ← Back to Dashboard
      </Link>

      {/* Header */}
      <div className="header">
        <h1>{student.name}</h1>
        <p>Joined {new Date(student.createdAt).toLocaleDateString()}</p>
      </div>

      {/* Summary Tiles */}
      <div className="stats-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <div className="card stat-card" style={{ borderLeft: "4px solid #4caf50" }}>
          <div className="value" style={{ color: "#4caf50" }}>{strongCount}</div>
          <div className="label">Strong</div>
        </div>
        <div className="card stat-card" style={{ borderLeft: "4px solid #ff9800" }}>
          <div className="value" style={{ color: "#ff9800" }}>{developingCount}</div>
          <div className="label">Developing</div>
        </div>
        <div className="card stat-card" style={{ borderLeft: "4px solid #f44336" }}>
          <div className="value" style={{ color: "#f44336" }}>{needsHelpCount}</div>
          <div className="label">Needs Help</div>
        </div>
      </div>

      {/* Coaching Insights */}
      {coachingInsights && coachingInsights.totalCoachRequests > 0 && (
        <div
          className="card"
          style={{
            marginTop: "16px",
            background: coachingInsights.intentLabel === "support-seeking"
              ? "#fff3e0"
              : coachingInsights.intentLabel === "enrichment-seeking"
              ? "#e8f5e9"
              : "#f5f5f5",
            borderLeft: `4px solid ${
              coachingInsights.intentLabel === "support-seeking"
                ? "#ff9800"
                : coachingInsights.intentLabel === "enrichment-seeking"
                ? "#4caf50"
                : "#9e9e9e"
            }`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
            <span style={{ fontSize: "1.5rem" }}>
              {coachingInsights.intentLabel === "support-seeking" ? "🆘" :
               coachingInsights.intentLabel === "enrichment-seeking" ? "🚀" : "💬"}
            </span>
            <div>
              <h3 style={{ margin: 0, color: "#333" }}>Coaching Insights</h3>
              <p style={{ margin: 0, fontSize: "0.9rem", color: "#666" }}>
                <span style={{
                  fontWeight: 500,
                  color: coachingInsights.intentLabel === "support-seeking"
                    ? "#e65100"
                    : coachingInsights.intentLabel === "enrichment-seeking"
                    ? "#2e7d32"
                    : "#666"
                }}>
                  {coachingInsights.intentLabel === "support-seeking"
                    ? "Support-Seeking"
                    : coachingInsights.intentLabel === "enrichment-seeking"
                    ? "Enrichment-Seeking"
                    : "Mixed"}
                </span>
              </p>
            </div>
          </div>
          {coachingInsights.recentTopics.length > 0 && (
            <p style={{ margin: 0, fontSize: "0.9rem", color: "#666" }}>
              Recent topics: {coachingInsights.recentTopics.join(", ")}
            </p>
          )}
          {coachingInsights.lastCoachSessionAt && (
            <p style={{ margin: "4px 0 0 0", fontSize: "0.85rem", color: "#999" }}>
              Last session: {new Date(coachingInsights.lastCoachSessionAt).toLocaleDateString()}
            </p>
          )}
        </div>
      )}

      {/* Open Assignments (Needs Attention) */}
      {openAssignments.length > 0 && (
        <>
          <h2 style={{ color: "white", marginTop: "32px", marginBottom: "16px" }}>
            Open Assignments
            <span style={{ fontSize: "0.9rem", fontWeight: "normal", marginLeft: "8px", color: "#aaa" }}>
              ({openAssignments.length})
            </span>
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {openAssignments.map((assignment) => (
              <AssignmentCard
                key={assignment.lessonId}
                assignment={assignment}
                studentId={studentId!}
                onNavigate={() =>
                  navigate(`/educator/assignment/${assignment.lessonId}/student/${studentId}`)
                }
                showAwaitingReview={assignment.isComplete && !assignment.hasTeacherNote}
              />
            ))}
          </div>
        </>
      )}

      {/* Not Started Assignments */}
      {notStartedAssignments.length > 0 && (
        <>
          <h2 style={{ color: "white", marginTop: "32px", marginBottom: "16px" }}>
            Not Started
            <span style={{ fontSize: "0.9rem", fontWeight: "normal", marginLeft: "8px", color: "#aaa" }}>
              ({notStartedAssignments.length})
            </span>
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {notStartedAssignments.map((assignment) => (
              <div
                key={assignment.lessonId}
                className="card"
                style={{ opacity: 0.7 }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <h3 style={{ margin: 0, color: "#667eea" }}>{assignment.lessonTitle}</h3>
                    <p style={{ margin: 0, marginTop: "4px", color: "#999", fontSize: "0.9rem" }}>
                      {assignment.totalQuestions} questions
                    </p>
                  </div>
                  <span style={{ color: "#999" }}>Not started</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Completed & Reviewed (Collapsible) */}
      {reviewedAssignments.length > 0 && (
        <>
          <button
            onClick={() => setShowCompleted(!showCompleted)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginTop: "32px",
              padding: "12px 16px",
              background: "rgba(255,255,255,0.1)",
              border: "none",
              borderRadius: "8px",
              color: "#aaa",
              fontSize: "1rem",
              cursor: "pointer",
              width: "100%",
              textAlign: "left",
            }}
          >
            <span style={{
              transform: showCompleted ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform 0.2s",
            }}>
              ▶
            </span>
            Completed & Reviewed ({reviewedAssignments.length})
          </button>

          {showCompleted && (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "12px" }}>
              {reviewedAssignments.map((assignment) => (
                <AssignmentCard
                  key={assignment.lessonId}
                  assignment={assignment}
                  studentId={studentId!}
                  onNavigate={() =>
                    navigate(`/educator/assignment/${assignment.lessonId}/student/${studentId}`)
                  }
                  isReviewed
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Empty State */}
      {assignments.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: "32px", marginTop: "16px" }}>
          <p style={{ color: "#666" }}>No assignments found for this student.</p>
        </div>
      )}
    </div>
  );
}

// ============================================
// Assignment Card Component
// ============================================

interface AssignmentCardProps {
  assignment: StudentAssignment;
  studentId: string;
  onNavigate: () => void;
  showAwaitingReview?: boolean;
  isReviewed?: boolean;
}

function AssignmentCard({ assignment, onNavigate, showAwaitingReview, isReviewed }: AssignmentCardProps) {
  return (
    <div
      className="card"
      style={{
        cursor: "pointer",
        transition: "transform 0.2s, box-shadow 0.2s",
        background: isReviewed ? "#f9f9f9" : undefined,
        opacity: isReviewed ? 0.8 : 1,
      }}
      onClick={onNavigate}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateX(4px)";
        e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.1)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateX(0)";
        e.currentTarget.style.boxShadow = "";
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
            <h3 style={{ margin: 0, color: "#667eea" }}>{assignment.lessonTitle}</h3>
            {assignment.hasTeacherNote && (
              <span title="Has your notes" style={{ fontSize: "0.85rem" }}>📝</span>
            )}
            {isReviewed && (
              <span
                style={{
                  display: "inline-block",
                  padding: "2px 8px",
                  borderRadius: "4px",
                  fontSize: "0.75rem",
                  fontWeight: 500,
                  background: "#e8f5e9",
                  color: "#2e7d32",
                }}
              >
                ✓ Reviewed
              </span>
            )}
            {showAwaitingReview && (
              <span
                style={{
                  display: "inline-block",
                  padding: "2px 8px",
                  borderRadius: "4px",
                  fontSize: "0.75rem",
                  fontWeight: 500,
                  background: "#fff3e0",
                  color: "#e65100",
                }}
              >
                Awaiting Review
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
            {/* Understanding badge */}
            {assignment.questionsAnswered > 0 && (
              <span
                style={{
                  display: "inline-block",
                  padding: "4px 10px",
                  borderRadius: "12px",
                  fontSize: "0.85rem",
                  fontWeight: 500,
                  background: getUnderstandingBgColor(assignment.understanding),
                  color: getUnderstandingColor(assignment.understanding),
                }}
              >
                {getUnderstandingLabel(assignment.understanding)}
              </span>
            )}
            {/* Progress */}
            <span style={{ color: "#666", fontSize: "0.9rem" }}>
              {assignment.isComplete
                ? `Completed ${assignment.completedAt ? new Date(assignment.completedAt).toLocaleDateString() : ""}`
                : `${assignment.questionsAnswered}/${assignment.totalQuestions} questions`}
            </span>
            {/* Coach support */}
            {assignment.questionsAnswered > 0 && (
              <span style={{ color: "#666", fontSize: "0.9rem" }}>
                Coach: {getCoachSupportLabel(assignment.coachSupport)}
              </span>
            )}
          </div>
        </div>
        <span style={{ color: "#667eea", fontSize: "1.2rem" }}>→</span>
      </div>
    </div>
  );
}
