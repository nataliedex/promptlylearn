/**
 * Archived Lessons Page
 *
 * View archived assignments with auto-generated teacher summaries.
 * The summary becomes the "cover page" of archived lessons -
 * helping teachers recall what happened without re-reading everything.
 */

import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  getArchivedAssignments,
  restoreAssignment,
  type ArchivedAssignment,
  type TeacherSummary,
} from "../services/api";

export default function ArchivedLessons() {
  const [assignments, setAssignments] = useState<ArchivedAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadData = async () => {
    try {
      const archived = await getArchivedAssignments();
      setAssignments(archived);
    } catch (err) {
      console.error("Failed to load archived assignments:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleRestoreAssignment = async (assignmentId: string, title: string) => {
    if (!confirm(`Restore "${title}"? It will appear in your active assignments.`)) {
      return;
    }

    try {
      await restoreAssignment(assignmentId);
      await loadData();
    } catch (err) {
      console.error("Failed to restore assignment:", err);
      alert("Failed to restore assignment. Please try again.");
    }
  };

  if (loading) {
    return (
      <div className="loading">
        <div className="loading-spinner"></div>
        <p>Loading archived assignments...</p>
      </div>
    );
  }

  return (
    <div className="container">
      <Link to="/educator" className="back-btn">
        ← Back to Dashboard
      </Link>

      <div className="header">
        <h1>Archived Assignments</h1>
        <p>
          {assignments.length} assignment{assignments.length !== 1 ? "s" : ""} in archive
        </p>
      </div>

      {assignments.length === 0 ? (
        <div className="card">
          <div style={{ textAlign: "center", padding: "48px" }}>
            <div style={{ fontSize: "3rem", marginBottom: "16px", opacity: 0.5 }}>📦</div>
            <h2 style={{ color: "#666", marginBottom: "8px" }}>No archived assignments</h2>
            <p style={{ color: "#999" }}>
              Resolved assignments are automatically archived after 7 days of inactivity.
              <br />
              You can also manually archive from the dashboard.
            </p>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {assignments.map((assignment) => (
            <ArchivedAssignmentCard
              key={assignment.assignmentId}
              assignment={assignment}
              isExpanded={expandedId === assignment.assignmentId}
              onToggle={() =>
                setExpandedId(
                  expandedId === assignment.assignmentId ? null : assignment.assignmentId
                )
              }
              onRestore={() =>
                handleRestoreAssignment(assignment.assignmentId, assignment.title)
              }
            />
          ))}
        </div>
      )}

      {/* Info box */}
      <div
        className="card"
        style={{
          marginTop: "32px",
          background: "#e3f2fd",
          borderLeft: "4px solid #1976d2",
        }}
      >
        <p style={{ margin: 0, color: "#1565c0", fontSize: "0.9rem" }}>
          Archived assignments include an auto-generated summary of class performance.
          <br />
          Restore an assignment to make it active again - all session data is preserved.
        </p>
      </div>
    </div>
  );
}

// ============================================
// Archived Assignment Card
// ============================================

interface ArchivedAssignmentCardProps {
  assignment: ArchivedAssignment;
  isExpanded: boolean;
  onToggle: () => void;
  onRestore: () => void;
}

function ArchivedAssignmentCard({
  assignment,
  isExpanded,
  onToggle,
  onRestore,
}: ArchivedAssignmentCardProps) {
  const { title, archivedAt, teacherSummary, totalStudents, averageScore, completionRate } =
    assignment;

  return (
    <div className="card">
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: "16px",
        }}
      >
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: 0, color: "#667eea" }}>{title}</h3>
          <div
            style={{
              display: "flex",
              gap: "16px",
              marginTop: "8px",
              flexWrap: "wrap",
              color: "#666",
              fontSize: "0.9rem",
            }}
          >
            <span>{totalStudents} students</span>
            <span>{averageScore}% avg score</span>
            <span>{completionRate}% completion</span>
            {archivedAt && (
              <span style={{ color: "#999" }}>
                Archived {new Date(archivedAt).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
          {teacherSummary && (
            <button
              onClick={onToggle}
              style={{
                background: "transparent",
                border: "1px solid #ddd",
                cursor: "pointer",
                padding: "8px 16px",
                borderRadius: "4px",
                color: "#666",
                fontSize: "0.9rem",
              }}
            >
              {isExpanded ? "Hide Summary" : "View Summary"}
            </button>
          )}
          <button className="btn btn-primary" onClick={onRestore}>
            Restore
          </button>
        </div>
      </div>

      {/* Expandable Summary */}
      {isExpanded && teacherSummary && (
        <div style={{ marginTop: "24px", paddingTop: "24px", borderTop: "1px solid #eee" }}>
          <TeacherSummaryView summary={teacherSummary} />
        </div>
      )}
    </div>
  );
}

// ============================================
// Teacher Summary View
// ============================================

interface TeacherSummaryViewProps {
  summary: TeacherSummary;
}

function TeacherSummaryView({ summary }: TeacherSummaryViewProps) {
  const { classPerformance, insights, coachUsage, studentHighlights, teacherEngagement } = summary;

  return (
    <div>
      <h4 style={{ margin: 0, marginBottom: "16px", color: "#333" }}>
        Assignment Summary
      </h4>

      {/* Class Performance */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
          gap: "12px",
          marginBottom: "24px",
        }}
      >
        <StatBox label="Total Students" value={classPerformance.totalStudents} />
        <StatBox
          label="Strong"
          value={classPerformance.strongCount}
          color="#4caf50"
        />
        <StatBox
          label="Developing"
          value={classPerformance.developingCount}
          color="#ff9800"
        />
        <StatBox
          label="Needs Support"
          value={classPerformance.needsSupportCount}
          color="#f44336"
        />
        <StatBox label="Avg Score" value={`${classPerformance.averageScore}%`} />
        <StatBox label="Completion" value={`${classPerformance.completionRate}%`} />
      </div>

      {/* Learning Insights */}
      {(insights.commonStrengths.length > 0 || insights.commonChallenges.length > 0) && (
        <div style={{ marginBottom: "24px" }}>
          <h5 style={{ margin: 0, marginBottom: "12px", color: "#666" }}>
            Learning Insights
          </h5>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            {insights.commonStrengths.length > 0 && (
              <div>
                <p style={{ margin: 0, marginBottom: "8px", fontSize: "0.85rem", color: "#2e7d32", fontWeight: 600 }}>
                  Strengths
                </p>
                <ul style={{ margin: 0, paddingLeft: "20px", color: "#666", fontSize: "0.9rem" }}>
                  {insights.commonStrengths.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
            {insights.commonChallenges.length > 0 && (
              <div>
                <p style={{ margin: 0, marginBottom: "8px", fontSize: "0.85rem", color: "#d32f2f", fontWeight: 600 }}>
                  Challenges
                </p>
                <ul style={{ margin: 0, paddingLeft: "20px", color: "#666", fontSize: "0.9rem" }}>
                  {insights.commonChallenges.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Coach Usage */}
      {coachUsage.studentsWhoUsedHints > 0 && (
        <div style={{ marginBottom: "24px" }}>
          <h5 style={{ margin: 0, marginBottom: "12px", color: "#666" }}>
            Coach Usage
          </h5>
          <p style={{ margin: 0, color: "#666", fontSize: "0.9rem" }}>
            {coachUsage.studentsWhoUsedHints} students used hints
            ({coachUsage.averageHintsPerStudent} hints per student on average)
          </p>
          {coachUsage.questionsNeedingMoreScaffolding.length > 0 && (
            <div style={{ marginTop: "8px" }}>
              <p style={{ margin: 0, fontSize: "0.85rem", color: "#ed6c02" }}>
                Questions that may need more scaffolding:
              </p>
              <ul style={{ margin: 0, paddingLeft: "20px", color: "#666", fontSize: "0.85rem" }}>
                {coachUsage.questionsNeedingMoreScaffolding.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Student Highlights */}
      {(studentHighlights.improvedSignificantly.length > 0 ||
        studentHighlights.mayNeedFollowUp.length > 0 ||
        studentHighlights.exceededExpectations.length > 0) && (
        <div style={{ marginBottom: "24px" }}>
          <h5 style={{ margin: 0, marginBottom: "12px", color: "#666" }}>
            Student Highlights
          </h5>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "16px" }}>
            {studentHighlights.exceededExpectations.length > 0 && (
              <HighlightGroup
                label="Exceeded Expectations"
                students={studentHighlights.exceededExpectations}
                color="#4caf50"
              />
            )}
            {studentHighlights.improvedSignificantly.length > 0 && (
              <HighlightGroup
                label="Improved with Help"
                students={studentHighlights.improvedSignificantly}
                color="#2196f3"
              />
            )}
            {studentHighlights.mayNeedFollowUp.length > 0 && (
              <HighlightGroup
                label="May Need Follow-up"
                students={studentHighlights.mayNeedFollowUp}
                color="#ff9800"
              />
            )}
          </div>
        </div>
      )}

      {/* Teacher Engagement */}
      <div
        style={{
          padding: "12px 16px",
          background: "#f5f5f5",
          borderRadius: "8px",
          fontSize: "0.85rem",
          color: "#666",
        }}
      >
        <span style={{ marginRight: "16px" }}>
          Notes written: {teacherEngagement.totalNotesWritten}
        </span>
        <span style={{ marginRight: "16px" }}>
          Students with notes: {teacherEngagement.studentsWithNotes}
        </span>
        {teacherEngagement.reviewedAllFlagged && (
          <span style={{ color: "#4caf50" }}>✓ All flagged students reviewed</span>
        )}
      </div>
    </div>
  );
}

// ============================================
// Helper Components
// ============================================

interface StatBoxProps {
  label: string;
  value: number | string;
  color?: string;
}

function StatBox({ label, value, color }: StatBoxProps) {
  return (
    <div
      style={{
        padding: "12px",
        background: "#f5f5f5",
        borderRadius: "8px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize: "1.5rem",
          fontWeight: 600,
          color: color || "#333",
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: "0.75rem", color: "#666", marginTop: "4px" }}>
        {label}
      </div>
    </div>
  );
}

interface HighlightGroupProps {
  label: string;
  students: string[];
  color: string;
}

function HighlightGroup({ label, students, color }: HighlightGroupProps) {
  return (
    <div>
      <p style={{ margin: 0, marginBottom: "4px", fontSize: "0.8rem", color, fontWeight: 600 }}>
        {label}
      </p>
      <p style={{ margin: 0, fontSize: "0.85rem", color: "#666" }}>
        {students.join(", ")}
      </p>
    </div>
  );
}
