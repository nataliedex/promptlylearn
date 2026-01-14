/**
 * Assignment Review - Primary Working Screen
 *
 * Design Philosophy:
 * - This is where teachers spend most of their time
 * - Show understanding levels, not raw scores
 * - Make "needs attention" prominent but not alarming
 * - Teacher notes visible at a glance
 */

import { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  getLesson,
  getSessions,
  getStudents,
  getAssignedStudents,
  recordAssignmentView,
  type Lesson,
  type Student,
} from "../services/api";
import {
  buildAssignmentReview,
  getUnderstandingLabel,
  getUnderstandingColor,
  getUnderstandingBgColor,
  getCoachSupportLabel,
  getAttentionReasonDisplay,
} from "../utils/teacherDashboardUtils";
import type {
  AssignmentReviewData,
  StudentAssignmentRow,
  UnderstandingLevel,
} from "../types/teacherDashboard";

export default function AssignmentReview() {
  const { lessonId } = useParams<{ lessonId: string }>();
  const navigate = useNavigate();

  const [reviewData, setReviewData] = useState<AssignmentReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "needs-review" | UnderstandingLevel>("all");

  useEffect(() => {
    if (!lessonId) return;

    async function loadData() {
      try {
        // Record teacher view (important for lifecycle transitions)
        recordAssignmentView(lessonId!).catch((err) => {
          console.log("Failed to record view (non-critical):", err);
        });

        // First get assigned students for this lesson
        const [lesson, sessions, assignedData, allStudents] = await Promise.all([
          getLesson(lessonId!),
          getSessions(undefined, "completed"),
          getAssignedStudents(lessonId!),
          getStudents(),
        ]);

        // Filter sessions for this lesson
        const lessonSessions = sessions.filter((s) => s.lessonId === lessonId);

        // Only use assigned student IDs (not all students)
        const assignedStudentIds = assignedData.studentIds;

        // Build student name lookup from all students but only for assigned ones
        const studentNames: Record<string, string> = {};
        allStudents.forEach((s: Student) => {
          if (assignedStudentIds.includes(s.id)) {
            studentNames[s.id] = s.name;
          }
        });

        // Build review data using only assigned students
        const data = buildAssignmentReview(
          lessonId!,
          (lesson as Lesson).title,
          lessonSessions,
          lesson as Lesson,
          assignedStudentIds,
          studentNames
        );

        setReviewData(data);
      } catch (err) {
        console.error("Failed to load assignment data:", err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [lessonId]);

  if (loading) {
    return (
      <div className="loading">
        <div className="loading-spinner"></div>
        <p>Loading assignment data...</p>
      </div>
    );
  }

  if (!reviewData) {
    return (
      <div className="container">
        <div className="card">
          <p>Assignment not found.</p>
          <Link to="/educator" className="btn btn-primary" style={{ marginTop: "16px" }}>
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  // Show message if no students are assigned
  if (reviewData.students.length === 0) {
    return (
      <div className="container">
        <Link to="/educator" className="back-btn">
          ← Back to Dashboard
        </Link>

        <div className="header">
          <h1>{reviewData.title}</h1>
          <p>{reviewData.questionCount} questions</p>
        </div>

        <div className="card" style={{ textAlign: "center", padding: "48px" }}>
          <div style={{ fontSize: "3rem", marginBottom: "16px" }}>📋</div>
          <h3 style={{ margin: 0, marginBottom: "8px" }}>No students assigned</h3>
          <p style={{ color: "#666", margin: 0, marginBottom: "24px" }}>
            Assign this lesson to a class to start tracking student progress.
          </p>
          <Link
            to={`/educator/assign-lesson?lessonId=${lessonId}`}
            className="btn btn-primary"
          >
            Assign to a Class
          </Link>
        </div>
      </div>
    );
  }

  // Apply filter
  const filteredStudents = reviewData.students.filter((student) => {
    if (filter === "all") return true;
    if (filter === "needs-review") return student.needsReview;
    return student.understanding === filter;
  });

  const { stats, distribution } = reviewData;

  return (
    <div className="container">
      <Link to="/educator" className="back-btn">
        ← Back to Dashboard
      </Link>

      <div className="header">
        <h1>{reviewData.title}</h1>
        <p>{reviewData.questionCount} questions</p>
      </div>

      {/* Summary Stats */}
      <div className="stats-grid">
        <div className="card stat-card">
          <div className="value">
            {stats.completed}/{reviewData.students.length}
          </div>
          <div className="label">Completed</div>
          {stats.inProgress > 0 && (
            <div style={{ fontSize: "0.85rem", color: "#666", marginTop: "4px" }}>
              {stats.inProgress} in progress
            </div>
          )}
        </div>

        <div
          className="card stat-card"
          style={{ cursor: distribution.strong > 0 ? "pointer" : "default" }}
          onClick={() => distribution.strong > 0 && setFilter(filter === "strong" ? "all" : "strong")}
        >
          <div className="value" style={{ color: "#2e7d32" }}>
            {distribution.strong}
          </div>
          <div className="label">Strong</div>
        </div>

        <div
          className="card stat-card"
          style={{ cursor: distribution.developing > 0 ? "pointer" : "default" }}
          onClick={() => distribution.developing > 0 && setFilter(filter === "developing" ? "all" : "developing")}
        >
          <div className="value" style={{ color: "#ed6c02" }}>
            {distribution.developing}
          </div>
          <div className="label">Developing</div>
        </div>

        <div
          className="card stat-card"
          style={{ cursor: distribution.needsSupport > 0 ? "pointer" : "default" }}
          onClick={() => distribution.needsSupport > 0 && setFilter(filter === "needs-support" ? "all" : "needs-support")}
        >
          <div className="value" style={{ color: "#d32f2f" }}>
            {distribution.needsSupport}
          </div>
          <div className="label">Needs Support</div>
        </div>
      </div>

      {/* Needs Attention Alert */}
      {stats.needingAttention > 0 && (
        <div
          className="card"
          style={{
            background: "#fff3e0",
            borderLeft: "4px solid #ff9800",
            cursor: "pointer",
          }}
          onClick={() => setFilter(filter === "needs-review" ? "all" : "needs-review")}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h3 style={{ margin: 0, marginBottom: "4px", color: "#e65100" }}>
                {stats.needingAttention} student{stats.needingAttention !== 1 ? "s" : ""} may need your attention
              </h3>
              <p style={{ margin: 0, color: "#666", fontSize: "0.9rem" }}>
                Click to filter, or review individual students below
              </p>
            </div>
            <span style={{ fontSize: "1.5rem", color: "#ff9800" }}>
              {filter === "needs-review" ? "✓" : "→"}
            </span>
          </div>
        </div>
      )}

      {/* Filter Controls */}
      <div style={{ display: "flex", gap: "8px", marginTop: "24px", marginBottom: "16px", flexWrap: "wrap" }}>
        <FilterButton
          label={`All Students (${reviewData.students.length})`}
          active={filter === "all"}
          onClick={() => setFilter("all")}
        />
        {stats.needingAttention > 0 && (
          <FilterButton
            label={`Needs Review (${stats.needingAttention})`}
            active={filter === "needs-review"}
            onClick={() => setFilter("needs-review")}
            variant="warning"
          />
        )}
      </div>

      {/* Student Table */}
      <div className="card">
        <h3 style={{ marginBottom: "16px" }}>Student Progress</h3>

        {filteredStudents.length === 0 ? (
          <p style={{ color: "#666" }}>No students match the current filter.</p>
        ) : (
          <div className="table-wrapper">
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #eee" }}>
                  <th style={{ textAlign: "left", padding: "12px 8px" }}>Student</th>
                  <th style={{ textAlign: "center", padding: "12px 8px" }}>Progress</th>
                  <th style={{ textAlign: "center", padding: "12px 8px" }}>Understanding</th>
                  <th style={{ textAlign: "center", padding: "12px 8px" }}>Coach Support</th>
                  <th style={{ textAlign: "center", padding: "12px 8px" }}>Review</th>
                  <th style={{ textAlign: "right", padding: "12px 8px" }}></th>
                </tr>
              </thead>
              <tbody>
                {filteredStudents.map((student) => (
                  <StudentRow
                    key={student.studentId}
                    student={student}
                    onNavigate={() =>
                      navigate(`/educator/assignment/${lessonId}/student/${student.studentId}`)
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// Filter Button Component
// ============================================

interface FilterButtonProps {
  label: string;
  active: boolean;
  onClick: () => void;
  variant?: "default" | "warning";
}

function FilterButton({ label, active, onClick, variant = "default" }: FilterButtonProps) {
  const baseStyle = {
    padding: "8px 16px",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: 500,
    transition: "all 0.2s",
  };

  const activeStyle = variant === "warning"
    ? { background: "#ff9800", color: "white" }
    : { background: "#667eea", color: "white" };

  const inactiveStyle = variant === "warning"
    ? { background: "#fff3e0", color: "#e65100" }
    : { background: "#f5f5f5", color: "#666" };

  return (
    <button
      style={{
        ...baseStyle,
        ...(active ? activeStyle : inactiveStyle),
      }}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

// ============================================
// Student Row Component
// ============================================

interface StudentRowProps {
  student: StudentAssignmentRow;
  onNavigate: () => void;
}

function StudentRow({ student, onNavigate }: StudentRowProps) {
  const hasStarted = student.questionsAnswered > 0;

  return (
    <tr
      style={{
        borderBottom: "1px solid #eee",
        cursor: "pointer",
        transition: "background 0.2s",
      }}
      onClick={onNavigate}
      onMouseEnter={(e) => (e.currentTarget.style.background = "#f5f5f5")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {/* Student Name */}
      <td style={{ padding: "12px 8px" }}>
        <span style={{ fontWeight: 500, color: "#667eea" }}>{student.studentName}</span>
        {student.hasTeacherNote && (
          <span style={{ marginLeft: "8px", fontSize: "0.8rem" }} title="Has your notes">
            📝
          </span>
        )}
      </td>

      {/* Progress */}
      <td style={{ textAlign: "center", padding: "12px 8px" }}>
        {student.isComplete ? (
          <span style={{ color: "#2e7d32" }}>✓ Complete</span>
        ) : hasStarted ? (
          <span style={{ color: "#666" }}>
            {student.questionsAnswered}/{student.totalQuestions}
          </span>
        ) : (
          <span style={{ color: "#999" }}>Not started</span>
        )}
      </td>

      {/* Understanding Level */}
      <td style={{ textAlign: "center", padding: "12px 8px" }}>
        {hasStarted ? (
          <span
            style={{
              display: "inline-block",
              padding: "4px 10px",
              borderRadius: "12px",
              fontSize: "0.85rem",
              fontWeight: 500,
              background: getUnderstandingBgColor(student.understanding),
              color: getUnderstandingColor(student.understanding),
            }}
          >
            {getUnderstandingLabel(student.understanding)}
          </span>
        ) : (
          <span style={{ color: "#999" }}>—</span>
        )}
      </td>

      {/* Coach Support */}
      <td style={{ textAlign: "center", padding: "12px 8px" }}>
        {hasStarted ? (
          <span
            style={{
              fontSize: "0.85rem",
              color: student.coachSupport === "significant" ? "#e65100" : "#666",
            }}
          >
            {getCoachSupportLabel(student.coachSupport)}
          </span>
        ) : (
          <span style={{ color: "#999" }}>—</span>
        )}
      </td>

      {/* Needs Review */}
      <td style={{ textAlign: "center", padding: "12px 8px" }}>
        {student.needsReview ? (
          <span
            style={{
              display: "inline-block",
              padding: "4px 8px",
              borderRadius: "8px",
              fontSize: "0.8rem",
              background: "#fff3e0",
              color: "#e65100",
            }}
            title={student.attentionReasons.map((r) => getAttentionReasonDisplay(r).label).join(", ")}
          >
            Review
          </span>
        ) : (
          <span style={{ color: "#999" }}>—</span>
        )}
      </td>

      {/* Action */}
      <td style={{ textAlign: "right", padding: "12px 8px" }}>
        <span style={{ color: "#667eea" }}>→</span>
      </td>
    </tr>
  );
}
