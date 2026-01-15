/**
 * Assignment Review - Primary Working Screen
 *
 * Design Philosophy:
 * - This is where teachers spend most of their time
 * - Show understanding levels, not raw scores
 * - Make "needs attention" prominent and actionable
 * - Teacher can take action directly from this page
 * - Assignment feels "done" when all flagged students are addressed
 */

import { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  getLesson,
  getSessions,
  getStudents,
  getAssignedStudents,
  recordAssignmentView,
  markStudentAction,
  getAssignmentReviewStatus,
  type Lesson,
  type Student,
  type StudentActionStatus,
  type AssignmentReviewStatus,
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
  const [reviewStatus, setReviewStatus] = useState<AssignmentReviewStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "needs-review" | "addressed" | UnderstandingLevel>("all");

  const loadData = async () => {
    if (!lessonId) return;

    try {
      // Record teacher view (important for lifecycle transitions)
      recordAssignmentView(lessonId).catch((err) => {
        console.log("Failed to record view (non-critical):", err);
      });

      // First get assigned students for this lesson
      const [lesson, sessions, assignedData, allStudents, status] = await Promise.all([
        getLesson(lessonId),
        getSessions(undefined, "completed"),
        getAssignedStudents(lessonId),
        getStudents(),
        getAssignmentReviewStatus(lessonId).catch(() => null),
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
        lessonId,
        (lesson as Lesson).title,
        lessonSessions,
        lesson as Lesson,
        assignedStudentIds,
        studentNames,
        assignedData.assignments // Pass assignment details with attempts and actionStatus
      );

      setReviewData(data);
      setReviewStatus(status);
    } catch (err) {
      console.error("Failed to load assignment data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [lessonId]);

  // Handle marking a student action
  const handleMarkAction = async (studentId: string, action: StudentActionStatus) => {
    if (!lessonId || !reviewData) return;

    try {
      await markStudentAction(lessonId, studentId, action);

      // Update local state optimistically
      setReviewData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          students: prev.students.map((s) =>
            s.studentId === studentId
              ? { ...s, actionStatus: action, actionAt: new Date().toISOString() }
              : s
          ),
        };
      });

      // Refresh status
      const newStatus = await getAssignmentReviewStatus(lessonId);
      setReviewStatus(newStatus);

      // If action is "reviewed", navigate to student details
      if (action === "reviewed") {
        navigate(`/educator/assignment/${lessonId}/student/${studentId}`);
      }
    } catch (err) {
      console.error("Failed to mark action:", err);
    }
  };

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

  // Calculate unaddressed students (need review but no action taken)
  const unaddressedStudents = reviewData.students.filter(
    (s) => s.needsReview && !s.actionStatus
  );

  // Calculate breakdown for needs attention strip
  const strugglingCount = unaddressedStudents.filter(
    (s) => s.understanding === "needs-support"
  ).length;
  const developingWithCoachCount = unaddressedStudents.filter(
    (s) => s.understanding === "developing" && s.coachSupport === "significant"
  ).length;

  // Check if assignment is fully reviewed
  const isFullyReviewed = reviewStatus?.isFullyReviewed || false;

  // Apply filter
  const filteredStudents = reviewData.students.filter((student) => {
    if (filter === "all") return true;
    if (filter === "needs-review") return student.needsReview && !student.actionStatus;
    if (filter === "addressed") return !!student.actionStatus;
    return student.understanding === filter;
  });

  const { stats, distribution } = reviewData;

  // Get first unaddressed student for "Review First" button
  const firstUnaddressed = unaddressedStudents[0];

  return (
    <div className="container">
      <Link to="/educator" className="back-btn">
        ← Back to Dashboard
      </Link>

      <div className="header">
        <h1>{reviewData.title}</h1>
        <p>{reviewData.questionCount} questions</p>
      </div>

      {/* Assignment Fully Reviewed Banner */}
      {isFullyReviewed && stats.completed > 0 && (
        <div
          className="card"
          style={{
            background: "#e8f5e9",
            borderLeft: "4px solid #4caf50",
            marginBottom: "16px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ fontSize: "1.5rem" }}>✓</span>
            <div>
              <h3 style={{ margin: 0, color: "#2e7d32" }}>Assignment Fully Reviewed</h3>
              <p style={{ margin: 0, marginTop: "4px", color: "#666", fontSize: "0.9rem" }}>
                {reviewStatus?.actionBreakdown.reviewed || 0} reviewed
                {reviewStatus?.actionBreakdown.reassigned ? ` • ${reviewStatus.actionBreakdown.reassigned} reassigned` : ""}
                {reviewStatus?.actionBreakdown.noActionNeeded ? ` • ${reviewStatus.actionBreakdown.noActionNeeded} no action needed` : ""}
              </p>
            </div>
          </div>
        </div>
      )}

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

      {/* Needs Attention Strip - Only show if there are unaddressed students */}
      {unaddressedStudents.length > 0 && (
        <div
          className="card"
          style={{
            background: "#fff3e0",
            borderLeft: "4px solid #ff9800",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "16px" }}>
            <div>
              <h3 style={{ margin: 0, marginBottom: "4px", color: "#e65100" }}>
                Needs Attention ({unaddressedStudents.length} student{unaddressedStudents.length !== 1 ? "s" : ""})
              </h3>
              <p style={{ margin: 0, color: "#666", fontSize: "0.9rem" }}>
                {strugglingCount > 0 && `${strugglingCount} struggling`}
                {strugglingCount > 0 && developingWithCoachCount > 0 && ", "}
                {developingWithCoachCount > 0 && `${developingWithCoachCount} developing w/ heavy coach support`}
              </p>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              {firstUnaddressed && (
                <button
                  onClick={() => navigate(`/educator/assignment/${lessonId}/student/${firstUnaddressed.studentId}`)}
                  style={{
                    padding: "8px 16px",
                    background: "#ff9800",
                    color: "white",
                    border: "none",
                    borderRadius: "8px",
                    cursor: "pointer",
                    fontWeight: 500,
                  }}
                >
                  Review First Student
                </button>
              )}
              <button
                onClick={() => setFilter(filter === "needs-review" ? "all" : "needs-review")}
                style={{
                  padding: "8px 16px",
                  background: filter === "needs-review" ? "#e65100" : "transparent",
                  color: filter === "needs-review" ? "white" : "#e65100",
                  border: `1px solid ${filter === "needs-review" ? "#e65100" : "#ff9800"}`,
                  borderRadius: "8px",
                  cursor: "pointer",
                  fontWeight: 500,
                }}
              >
                {filter === "needs-review" ? "Show All" : "View All Flagged"}
              </button>
            </div>
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
        {unaddressedStudents.length > 0 && (
          <FilterButton
            label={`Needs Review (${unaddressedStudents.length})`}
            active={filter === "needs-review"}
            onClick={() => setFilter("needs-review")}
            variant="warning"
          />
        )}
        {reviewStatus && reviewStatus.addressed > 0 && (
          <FilterButton
            label={`Addressed (${reviewStatus.addressed})`}
            active={filter === "addressed"}
            onClick={() => setFilter("addressed")}
            variant="success"
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
                  <th style={{ textAlign: "center", padding: "12px 8px" }}>Attempts</th>
                  <th style={{ textAlign: "center", padding: "12px 8px" }}>Action</th>
                  <th style={{ textAlign: "right", padding: "12px 8px" }}></th>
                </tr>
              </thead>
              <tbody>
                {filteredStudents.map((student) => (
                  <StudentRow
                    key={student.studentId}
                    student={student}
                    lessonId={lessonId!}
                    onNavigate={() =>
                      navigate(`/educator/assignment/${lessonId}/student/${student.studentId}`)
                    }
                    onMarkAction={handleMarkAction}
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
  variant?: "default" | "warning" | "success";
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

  const getStyles = () => {
    if (active) {
      switch (variant) {
        case "warning":
          return { background: "#ff9800", color: "white" };
        case "success":
          return { background: "#4caf50", color: "white" };
        default:
          return { background: "#667eea", color: "white" };
      }
    }
    switch (variant) {
      case "warning":
        return { background: "#fff3e0", color: "#e65100" };
      case "success":
        return { background: "#e8f5e9", color: "#2e7d32" };
      default:
        return { background: "#f5f5f5", color: "#666" };
    }
  };

  return (
    <button
      style={{
        ...baseStyle,
        ...getStyles(),
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
  lessonId: string;
  onNavigate: () => void;
  onMarkAction: (studentId: string, action: StudentActionStatus) => void;
}

function StudentRow({ student, lessonId, onNavigate, onMarkAction }: StudentRowProps) {
  const [showActionMenu, setShowActionMenu] = useState(false);
  const hasStarted = student.questionsAnswered > 0;
  const needsAction = student.needsReview && !student.actionStatus;

  return (
    <tr
      style={{
        borderBottom: "1px solid #eee",
        background: needsAction ? "#fffbf5" : "transparent",
        transition: "background 0.2s",
      }}
      onMouseEnter={(e) => {
        if (!needsAction) e.currentTarget.style.background = "#f5f5f5";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = needsAction ? "#fffbf5" : "transparent";
      }}
    >
      {/* Student Name */}
      <td style={{ padding: "12px 8px", cursor: "pointer" }} onClick={onNavigate}>
        <span style={{ fontWeight: 500, color: "#667eea" }}>{student.studentName}</span>
        {student.hasTeacherNote && (
          <span style={{ marginLeft: "8px", fontSize: "0.8rem" }} title="Has your notes">
            📝
          </span>
        )}
      </td>

      {/* Progress */}
      <td style={{ textAlign: "center", padding: "12px 8px", cursor: "pointer" }} onClick={onNavigate}>
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
      <td style={{ textAlign: "center", padding: "12px 8px", cursor: "pointer" }} onClick={onNavigate}>
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
      <td style={{ textAlign: "center", padding: "12px 8px", cursor: "pointer" }} onClick={onNavigate}>
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

      {/* Attempts */}
      <td style={{ textAlign: "center", padding: "12px 8px", cursor: "pointer" }} onClick={onNavigate}>
        {student.attempts > 1 ? (
          <span
            style={{
              display: "inline-block",
              padding: "4px 10px",
              borderRadius: "12px",
              fontSize: "0.85rem",
              fontWeight: 500,
              background: "#e3f2fd",
              color: "#1565c0",
            }}
          >
            {student.attempts}
          </span>
        ) : (
          <span style={{ color: "#666" }}>{student.attempts}</span>
        )}
      </td>

      {/* Action Status */}
      <td style={{ textAlign: "center", padding: "12px 8px", position: "relative" }}>
        {student.actionStatus ? (
          <ActionStatusBadge status={student.actionStatus} />
        ) : student.needsReview ? (
          <div style={{ position: "relative", display: "inline-block" }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowActionMenu(!showActionMenu);
              }}
              style={{
                padding: "4px 12px",
                borderRadius: "8px",
                fontSize: "0.8rem",
                fontWeight: 500,
                background: "#fff3e0",
                color: "#e65100",
                border: "1px solid #ffcc80",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              Needs review
              <span style={{ fontSize: "0.7rem" }}>▼</span>
            </button>
            {showActionMenu && (
              <ActionMenu
                onAction={(action) => {
                  setShowActionMenu(false);
                  onMarkAction(student.studentId, action);
                }}
                onClose={() => setShowActionMenu(false)}
              />
            )}
          </div>
        ) : hasStarted ? (
          <span style={{ color: "#999", fontSize: "0.85rem" }}>No action needed</span>
        ) : (
          <span style={{ color: "#999" }}>—</span>
        )}
      </td>

      {/* Navigate Arrow */}
      <td style={{ textAlign: "right", padding: "12px 8px", cursor: "pointer" }} onClick={onNavigate}>
        <span style={{ color: "#667eea" }}>→</span>
      </td>
    </tr>
  );
}

// ============================================
// Action Status Badge
// ============================================

function ActionStatusBadge({ status }: { status: StudentActionStatus }) {
  const config = {
    reviewed: { bg: "#e8f5e9", color: "#2e7d32", label: "Reviewed" },
    reassigned: { bg: "#e3f2fd", color: "#1565c0", label: "Reassigned" },
    "no-action-needed": { bg: "#f5f5f5", color: "#666", label: "No action needed" },
  };

  const { bg, color, label } = config[status];

  return (
    <span
      style={{
        display: "inline-block",
        padding: "4px 8px",
        borderRadius: "8px",
        fontSize: "0.8rem",
        background: bg,
        color: color,
      }}
    >
      {label}
    </span>
  );
}

// ============================================
// Action Menu Dropdown
// ============================================

interface ActionMenuProps {
  onAction: (action: StudentActionStatus) => void;
  onClose: () => void;
}

function ActionMenu({ onAction, onClose }: ActionMenuProps) {
  return (
    <>
      {/* Backdrop to close menu */}
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 99,
        }}
        onClick={onClose}
      />
      <div
        style={{
          position: "absolute",
          top: "100%",
          left: "50%",
          transform: "translateX(-50%)",
          marginTop: "4px",
          background: "white",
          borderRadius: "8px",
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          zIndex: 100,
          minWidth: "160px",
          overflow: "hidden",
        }}
      >
        <button
          onClick={() => onAction("reviewed")}
          style={{
            display: "block",
            width: "100%",
            padding: "10px 16px",
            textAlign: "left",
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: "0.9rem",
            color: "#333",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "#f5f5f5")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
        >
          Mark Reviewed
        </button>
        <button
          onClick={() => onAction("reassigned")}
          style={{
            display: "block",
            width: "100%",
            padding: "10px 16px",
            textAlign: "left",
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: "0.9rem",
            color: "#333",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "#f5f5f5")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
        >
          Reassign to Student
        </button>
        <button
          onClick={() => onAction("no-action-needed")}
          style={{
            display: "block",
            width: "100%",
            padding: "10px 16px",
            textAlign: "left",
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: "0.9rem",
            color: "#666",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "#f5f5f5")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
        >
          No Action Needed
        </button>
      </div>
    </>
  );
}
