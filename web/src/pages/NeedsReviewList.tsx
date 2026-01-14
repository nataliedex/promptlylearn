/**
 * Needs Review List
 *
 * Purpose: Focused view of students who may need teacher attention
 *
 * Design principles:
 * - These are suggestions, not mandates
 * - Clear reasons why each student is flagged
 * - Easy navigation to detailed student view
 * - Positive framing (opportunity to help, not problems)
 */

import { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  getLesson,
  getSessions,
  getStudents,
  getAssignedStudents,
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
import type { StudentAssignmentRow } from "../types/teacherDashboard";

export default function NeedsReviewList() {
  const { lessonId } = useParams<{ lessonId: string }>();
  const navigate = useNavigate();

  const [students, setStudents] = useState<StudentAssignmentRow[]>([]);
  const [assignmentTitle, setAssignmentTitle] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!lessonId) return;

    async function loadData() {
      try {
        const [lesson, sessions, assignedData, allStudents] = await Promise.all([
          getLesson(lessonId!),
          getSessions(undefined, "completed"),
          getAssignedStudents(lessonId!),
          getStudents(),
        ]);

        // Filter sessions for this lesson
        const lessonSessions = sessions.filter((s) => s.lessonId === lessonId);

        // Only use assigned student IDs
        const assignedStudentIds = assignedData.studentIds;

        // Build student name lookup for assigned students only
        const studentNames: Record<string, string> = {};
        allStudents.forEach((s: Student) => {
          if (assignedStudentIds.includes(s.id)) {
            studentNames[s.id] = s.name;
          }
        });

        // Build review data using only assigned students
        const reviewData = buildAssignmentReview(
          lessonId!,
          (lesson as Lesson).title,
          lessonSessions,
          lesson as Lesson,
          assignedStudentIds,
          studentNames,
          assignedData.assignments // Pass assignment details with attempts
        );

        setAssignmentTitle(reviewData.title);
        setStudents(reviewData.students.filter((s) => s.needsReview));
      } catch (err) {
        console.error("Failed to load review data:", err);
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
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="container">
      <Link to={`/educator/assignment/${lessonId}`} className="back-btn">
        ← Back to Assignment Overview
      </Link>

      <div className="header">
        <h1>Students Who May Need Support</h1>
        <p>{assignmentTitle}</p>
      </div>

      {/* Helpful context */}
      <div
        className="card"
        style={{
          background: "#e3f2fd",
          borderLeft: "4px solid #1976d2",
          marginBottom: "24px",
        }}
      >
        <p style={{ margin: 0, color: "#1565c0" }}>
          These students showed patterns that might benefit from your attention.
          The AI coach helped them, but your insight as their teacher can make
          a bigger difference.
        </p>
      </div>

      {students.length === 0 ? (
        <div className="card">
          <div style={{ textAlign: "center", padding: "32px" }}>
            <div style={{ fontSize: "3rem", marginBottom: "16px" }}>✓</div>
            <h2 style={{ marginBottom: "8px", color: "#2e7d32" }}>
              No students flagged for review
            </h2>
            <p style={{ color: "#666" }}>
              All students appear to be progressing well on this assignment.
            </p>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {students.map((student) => (
            <StudentReviewCard
              key={student.studentId}
              student={student}
              onNavigate={() =>
                navigate(`/educator/assignment/${lessonId}/student/${student.studentId}`)
              }
            />
          ))}
        </div>
      )}

      {/* Quick actions */}
      {students.length > 0 && (
        <div style={{ marginTop: "32px", textAlign: "center" }}>
          <p style={{ color: "#666", marginBottom: "16px" }}>
            Click on any student to see their detailed work and add notes.
          </p>
        </div>
      )}
    </div>
  );
}

// ============================================
// Student Review Card Component
// ============================================

interface StudentReviewCardProps {
  student: StudentAssignmentRow;
  onNavigate: () => void;
}

function StudentReviewCard({ student, onNavigate }: StudentReviewCardProps) {
  // Group reasons by type
  const concerningReasons = student.attentionReasons.filter(
    (r) => r !== "improved-with-support"
  );
  const positiveReasons = student.attentionReasons.filter(
    (r) => r === "improved-with-support"
  );

  return (
    <div
      className="card"
      style={{
        cursor: "pointer",
        transition: "transform 0.2s, box-shadow 0.2s",
      }}
      onClick={onNavigate}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "";
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        {/* Left: Student info */}
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
            <h3 style={{ margin: 0, color: "#667eea" }}>{student.studentName}</h3>
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
          </div>

          {/* Progress info */}
          <div style={{ display: "flex", gap: "24px", marginBottom: "12px", color: "#666", fontSize: "0.9rem" }}>
            <span>
              <strong>Progress:</strong>{" "}
              {student.isComplete ? (
                <span style={{ color: "#2e7d32" }}>Complete</span>
              ) : (
                `${student.questionsAnswered}/${student.totalQuestions} questions`
              )}
            </span>
            <span>
              <strong>Coach Support:</strong> {getCoachSupportLabel(student.coachSupport)}
            </span>
          </div>

          {/* Review reasons */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {concerningReasons.map((reason) => {
              const { label } = getAttentionReasonDisplay(reason);
              return (
                <span
                  key={reason}
                  style={{
                    display: "inline-block",
                    padding: "4px 10px",
                    borderRadius: "8px",
                    fontSize: "0.8rem",
                    background: "#fff3e0",
                    color: "#e65100",
                  }}
                >
                  {label}
                </span>
              );
            })}
            {positiveReasons.map((reason) => {
              const { label } = getAttentionReasonDisplay(reason);
              return (
                <span
                  key={reason}
                  style={{
                    display: "inline-block",
                    padding: "4px 10px",
                    borderRadius: "8px",
                    fontSize: "0.8rem",
                    background: "#e8f5e9",
                    color: "#2e7d32",
                  }}
                >
                  {label}
                </span>
              );
            })}
          </div>
        </div>

        {/* Right: Arrow */}
        <div style={{ display: "flex", alignItems: "center", paddingLeft: "16px" }}>
          <span style={{ fontSize: "1.5rem", color: "#667eea" }}>→</span>
        </div>
      </div>

      {/* Teacher note preview if exists */}
      {student.hasTeacherNote && (
        <div
          style={{
            marginTop: "12px",
            padding: "8px 12px",
            background: "#f5f5f5",
            borderRadius: "8px",
            fontSize: "0.85rem",
            color: "#666",
          }}
        >
          <span style={{ marginRight: "8px" }}>📝</span>
          Has teacher notes
        </div>
      )}
    </div>
  );
}
