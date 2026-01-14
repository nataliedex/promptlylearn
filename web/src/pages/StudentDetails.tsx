/**
 * Student Details - All Assignments View
 *
 * Design Philosophy:
 * - Show a student's work across all assignments
 * - Focus on learning journey, not statistics
 * - Easy navigation to specific assignment reviews
 */

import { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  getStudent,
  getSessions,
  getLessons,
  type Student,
  type Session,
  type Lesson,
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!studentId) return;

    async function loadData() {
      try {
        const [studentData, sessions, lessons] = await Promise.all([
          getStudent(studentId!),
          getSessions(studentId, "completed"),
          getLessons(),
        ]);

        setStudent(studentData);

        // Build assignment list
        const assignmentList: StudentAssignment[] = [];

        (lessons as Lesson[]).forEach((lesson) => {
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
              totalQuestions: lesson.prompts.length,
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
              totalQuestions: lesson.prompts.length,
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

  const completedAssignments = assignments.filter((a) => a.isComplete);
  const inProgressAssignments = assignments.filter((a) => !a.isComplete && a.questionsAnswered > 0);
  const notStartedAssignments = assignments.filter((a) => a.questionsAnswered === 0);

  return (
    <div className="container">
      <Link to="/educator" className="back-btn">
        ← Back to Dashboard
      </Link>

      <div className="header">
        <h1>{student.name}</h1>
        <p>Joined {new Date(student.createdAt).toLocaleDateString()}</p>
      </div>

      {/* Quick Summary */}
      <div className="stats-grid">
        <div className="card stat-card">
          <div className="value">{completedAssignments.length}</div>
          <div className="label">Completed</div>
        </div>
        <div className="card stat-card">
          <div className="value">{inProgressAssignments.length}</div>
          <div className="label">In Progress</div>
        </div>
        <div className="card stat-card">
          <div className="value">{notStartedAssignments.length}</div>
          <div className="label">Not Started</div>
        </div>
      </div>

      {/* Completed Assignments */}
      {completedAssignments.length > 0 && (
        <>
          <h2 style={{ color: "white", marginTop: "32px", marginBottom: "16px" }}>
            Completed Assignments
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {completedAssignments.map((assignment) => (
              <AssignmentCard
                key={assignment.lessonId}
                assignment={assignment}
                studentId={studentId!}
                onNavigate={() =>
                  navigate(`/educator/assignment/${assignment.lessonId}/student/${studentId}`)
                }
              />
            ))}
          </div>
        </>
      )}

      {/* In Progress Assignments */}
      {inProgressAssignments.length > 0 && (
        <>
          <h2 style={{ color: "white", marginTop: "32px", marginBottom: "16px" }}>
            In Progress
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {inProgressAssignments.map((assignment) => (
              <AssignmentCard
                key={assignment.lessonId}
                assignment={assignment}
                studentId={studentId!}
                onNavigate={() =>
                  navigate(`/educator/assignment/${assignment.lessonId}/student/${studentId}`)
                }
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
}

function AssignmentCard({ assignment, onNavigate }: AssignmentCardProps) {
  return (
    <div
      className="card"
      style={{
        cursor: "pointer",
        transition: "transform 0.2s, box-shadow 0.2s",
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
