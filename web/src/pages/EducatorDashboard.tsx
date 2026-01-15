/**
 * Educator Dashboard - Lifecycle-Aware Triage Screen
 *
 * Design Philosophy:
 * - Answer: "Who needs my help, why, and what should I do next?"
 * - Teachers should not manage dashboards
 * - System surfaces what needs attention
 * - Everything else is quietly archived
 *
 * Lifecycle States:
 * - Active: Needs teacher attention or has incomplete work
 * - Resolved: All work complete, teacher has reviewed
 * - Archived: Auto-archived after resolution period (separate view)
 */

import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  getAssignmentDashboard,
  triggerAutoArchive,
  archiveAssignment,
  getClasses,
  getClass,
  getLessonAssignments,
  getStudents,
  getStudentCoachingInsights,
  getAssignedStudents,
  assignLessonToClass,
  getRecommendations,
  refreshRecommendations,
  markRecommendationReviewed,
  dismissRecommendation,
  submitRecommendationFeedback,
  type ComputedAssignmentState,
  type AssignmentDashboardData,
  type ClassSummary,
  type ClassWithStudents,
  type Student,
  type CoachingInsight,
  type Recommendation,
  type FeedbackType,
} from "../services/api";
import RecommendationPanel from "../components/RecommendationPanel";

// Type for assignments grouped by class
interface ClassAssignmentGroup {
  classId: string;
  className: string;
  assignments: ComputedAssignmentState[];
}

// Type for student coaching activity
interface StudentCoachingActivity {
  studentId: string;
  studentName: string;
  insight: CoachingInsight;
}

export default function EducatorDashboard() {
  const navigate = useNavigate();
  const [dashboardData, setDashboardData] = useState<AssignmentDashboardData | null>(null);
  const [classes, setClasses] = useState<ClassSummary[]>([]);
  const [allStudents, setAllStudents] = useState<Student[]>([]);
  const [assignmentClassMap, setAssignmentClassMap] = useState<Map<string, string[]>>(new Map());
  const [coachingActivity, setCoachingActivity] = useState<StudentCoachingActivity[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add Student Modal state
  const [addStudentModal, setAddStudentModal] = useState<{
    isOpen: boolean;
    assignmentId: string;
    assignmentTitle: string;
  } | null>(null);

  const loadData = async () => {
    try {
      setError(null);

      // Trigger auto-archive check on dashboard load
      await triggerAutoArchive().catch(() => {
        // Silently fail - not critical
        console.log("Auto-archive check skipped");
      });

      const [dashData, classesData, studentsData] = await Promise.all([
        getAssignmentDashboard(),
        getClasses(),
        getStudents(),
      ]);

      setDashboardData(dashData);
      setClasses(classesData);
      setAllStudents(studentsData);

      // Load class associations for each assignment
      const allAssignments = [...dashData.active, ...dashData.resolved];
      const classMap = new Map<string, string[]>();

      await Promise.all(
        allAssignments.map(async (assignment) => {
          try {
            const summary = await getLessonAssignments(assignment.assignmentId);
            const classIds = summary.assignmentsByClass.map(c => c.classId);
            classMap.set(assignment.assignmentId, classIds);
          } catch {
            // Assignment may not have class associations
            classMap.set(assignment.assignmentId, []);
          }
        })
      );

      setAssignmentClassMap(classMap);

      // Load coaching insights for all students
      const coachingActivities: StudentCoachingActivity[] = [];
      await Promise.all(
        studentsData.map(async (student: Student) => {
          try {
            const insight = await getStudentCoachingInsights(student.id);
            if (insight.totalCoachRequests > 0) {
              coachingActivities.push({
                studentId: student.id,
                studentName: student.name,
                insight,
              });
            }
          } catch {
            // No coaching data for this student
          }
        })
      );

      // Sort by recency and support-seeking first
      coachingActivities.sort((a, b) => {
        // Support-seeking students first
        if (a.insight.intentLabel === "support-seeking" && b.insight.intentLabel !== "support-seeking") return -1;
        if (b.insight.intentLabel === "support-seeking" && a.insight.intentLabel !== "support-seeking") return 1;
        // Then by recency
        const aTime = a.insight.lastCoachSessionAt ? new Date(a.insight.lastCoachSessionAt).getTime() : 0;
        const bTime = b.insight.lastCoachSessionAt ? new Date(b.insight.lastCoachSessionAt).getTime() : 0;
        return bTime - aTime;
      });

      setCoachingActivity(coachingActivities);

      // Load recommendations (refresh to get latest)
      try {
        await refreshRecommendations();
        const recsData = await getRecommendations({ includeReviewed: true, limit: 10 });
        setRecommendations(recsData.recommendations);
      } catch (recErr) {
        console.log("Recommendations not available:", recErr);
        // Not critical - dashboard still works without recommendations
      }
    } catch (err) {
      console.error("Failed to load educator dashboard:", err);
      setError("Failed to load dashboard data. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleArchiveAssignment = async (assignmentId: string, title: string) => {
    if (!confirm(`Archive "${title}"? A summary will be generated and you can restore it later.`)) {
      return;
    }

    try {
      await archiveAssignment(assignmentId);
      await loadData();
    } catch (err) {
      console.error("Failed to archive assignment:", err);
      alert("Failed to archive assignment. Please try again.");
    }
  };

  // Recommendation handlers
  const handleReviewRecommendation = async (id: string) => {
    try {
      await markRecommendationReviewed(id);
      setRecommendations((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status: "reviewed" as const, reviewedAt: new Date().toISOString() } : r))
      );
    } catch (err) {
      console.error("Failed to mark recommendation reviewed:", err);
    }
  };

  const handleDismissRecommendation = async (id: string) => {
    try {
      await dismissRecommendation(id);
      setRecommendations((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      console.error("Failed to dismiss recommendation:", err);
    }
  };

  const handleRecommendationFeedback = async (id: string, feedback: FeedbackType) => {
    try {
      await submitRecommendationFeedback(id, feedback);
      setRecommendations((prev) =>
        prev.map((r) => (r.id === id ? { ...r, feedback } : r))
      );
    } catch (err) {
      console.error("Failed to submit recommendation feedback:", err);
    }
  };

  const handleRefreshRecommendations = async () => {
    setRecommendationsLoading(true);
    try {
      await refreshRecommendations();
      const recsData = await getRecommendations({ includeReviewed: true, limit: 10 });
      setRecommendations(recsData.recommendations);
    } catch (err) {
      console.error("Failed to refresh recommendations:", err);
    } finally {
      setRecommendationsLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="loading">
        <div className="loading-spinner"></div>
        <p>Loading dashboard...</p>
      </div>
    );
  }

  if (error || !dashboardData) {
    return (
      <div className="container">
        <div className="card">
          <p style={{ color: "#d32f2f" }}>{error || "Failed to load dashboard data."}</p>
          <button className="btn btn-primary" onClick={loadData} style={{ marginTop: "16px" }}>
            Try Again
          </button>
        </div>
      </div>
    );
  }

  const { active, resolved, archivedCount } = dashboardData;

  // Extract students needing attention from active assignments
  const studentsNeedingAttention = active.flatMap(assignment =>
    assignment.studentStatuses
      .filter(s => s.needsSupport && !s.hasTeacherNote)
      .map(s => ({
        studentId: s.studentId,
        studentName: s.studentName,
        assignmentId: assignment.assignmentId,
        assignmentTitle: assignment.title,
        reason: getReasonDescription(s, assignment),
        hasTeacherNote: s.hasTeacherNote,
      }))
  );

  // Group assignments by class
  const groupAssignmentsByClass = (assignments: ComputedAssignmentState[]): ClassAssignmentGroup[] => {
    const classGroups = new Map<string, ComputedAssignmentState[]>();
    const unassigned: ComputedAssignmentState[] = [];

    for (const assignment of assignments) {
      const classIds = assignmentClassMap.get(assignment.assignmentId) || [];
      if (classIds.length === 0) {
        unassigned.push(assignment);
      } else {
        // Add to each class it's assigned to
        for (const classId of classIds) {
          if (!classGroups.has(classId)) {
            classGroups.set(classId, []);
          }
          classGroups.get(classId)!.push(assignment);
        }
      }
    }

    // Build result with class names
    const result: ClassAssignmentGroup[] = [];

    for (const cls of classes) {
      const clsAssignments = classGroups.get(cls.id);
      if (clsAssignments && clsAssignments.length > 0) {
        result.push({
          classId: cls.id,
          className: cls.name,
          assignments: clsAssignments,
        });
      }
    }

    // Add unassigned at the end if any
    if (unassigned.length > 0) {
      result.push({
        classId: "unassigned",
        className: "Unassigned Lessons",
        assignments: unassigned,
      });
    }

    return result;
  };

  const activeByClass = groupAssignmentsByClass(active);
  const resolvedByClass = groupAssignmentsByClass(resolved);

  return (
    <div className="container">
      <Link to="/" className="back-btn">
        ← Back to Home
      </Link>

      <div className="header">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "16px" }}>
          <div>
            <h1>Educator Dashboard</h1>
            <p>Your class at a glance</p>
          </div>
          <div style={{ display: "flex", gap: "12px" }}>
            <button
              className="btn btn-secondary"
              onClick={() => navigate("/educator/classes")}
            >
              My Classes
            </button>
            <button
              className="btn btn-primary"
              onClick={() => navigate("/educator/create-lesson")}
            >
              + Create Lesson
            </button>
          </div>
        </div>
      </div>

      {/* What Should I Do Next? - Recommendations */}
      <RecommendationPanel
        recommendations={recommendations}
        onReview={handleReviewRecommendation}
        onDismiss={handleDismissRecommendation}
        onFeedback={handleRecommendationFeedback}
        onRefresh={handleRefreshRecommendations}
        loading={recommendationsLoading}
      />

      {/* Primary: Students Needing Attention */}
      {studentsNeedingAttention.length > 0 ? (
        <NeedsAttentionSection
          students={studentsNeedingAttention}
          onNavigate={(studentId, assignmentId) =>
            navigate(`/educator/assignment/${assignmentId}/student/${studentId}`)
          }
        />
      ) : (
        <div
          className="card"
          style={{
            background: "#e8f5e9",
            borderLeft: "4px solid #4caf50",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ fontSize: "1.5rem" }}>✓</span>
            <div>
              <h3 style={{ margin: 0, color: "#2e7d32" }}>All students on track</h3>
              <p style={{ margin: 0, color: "#666", marginTop: "4px" }}>
                No students are flagged for review right now.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Coaching Activity - Students using Ask Coach */}
      {coachingActivity.length > 0 && (
        <CoachingActivitySection
          activities={coachingActivity}
          onNavigate={(studentId) => navigate(`/educator/student/${studentId}`)}
        />
      )}

      {/* Active Assignments by Class */}
      {activeByClass.length > 0 && (
        <>
          <h2 style={{ color: "white", marginTop: "32px", marginBottom: "16px" }}>
            Active Assignments
          </h2>
          {activeByClass.map((group) => (
            <div key={group.classId} style={{ marginBottom: "24px" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  marginBottom: "12px",
                  cursor: group.classId !== "unassigned" ? "pointer" : "default",
                }}
                onClick={() => group.classId !== "unassigned" && navigate(`/educator/class/${group.classId}`)}
              >
                <h3 style={{ margin: 0, color: "rgba(255,255,255,0.9)", fontSize: "1.1rem" }}>
                  {group.className}
                </h3>
                <span style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.9rem" }}>
                  ({group.assignments.length} assignment{group.assignments.length !== 1 ? "s" : ""})
                </span>
                {group.classId !== "unassigned" && (
                  <span style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.85rem" }}>→</span>
                )}
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
                  gap: "16px",
                }}
              >
                {group.assignments.map((assignment) => (
                  <AssignmentCard
                    key={`${group.classId}-${assignment.assignmentId}`}
                    assignment={assignment}
                    onNavigate={() => navigate(`/educator/assignment/${assignment.assignmentId}`)}
                    onArchive={() => handleArchiveAssignment(assignment.assignmentId, assignment.title)}
                    onAddStudent={() => setAddStudentModal({
                      isOpen: true,
                      assignmentId: assignment.assignmentId,
                      assignmentTitle: assignment.title,
                    })}
                  />
                ))}
              </div>
            </div>
          ))}
        </>
      )}

      {/* Resolved Assignments by Class (De-emphasized) */}
      {resolvedByClass.length > 0 && (
        <>
          <h2 style={{ color: "rgba(255,255,255,0.6)", marginTop: "32px", marginBottom: "8px", fontSize: "1.1rem" }}>
            Resolved ({resolved.length})
          </h2>
          <p style={{ color: "rgba(255,255,255,0.4)", margin: 0, marginBottom: "16px", fontSize: "0.9rem" }}>
            These will auto-archive after 7 days of inactivity
          </p>
          {resolvedByClass.map((group) => (
            <div key={group.classId} style={{ marginBottom: "16px" }}>
              <h4 style={{ margin: "0 0 8px 0", color: "rgba(255,255,255,0.5)", fontSize: "0.95rem" }}>
                {group.className}
              </h4>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                  gap: "12px",
                }}
              >
                {group.assignments.map((assignment) => (
                  <ResolvedAssignmentCard
                    key={`${group.classId}-${assignment.assignmentId}`}
                    assignment={assignment}
                    onNavigate={() => navigate(`/educator/assignment/${assignment.assignmentId}`)}
                    onArchive={() => handleArchiveAssignment(assignment.assignmentId, assignment.title)}
                  />
                ))}
              </div>
            </div>
          ))}
        </>
      )}

      {/* No Assignments State */}
      {active.length === 0 && resolved.length === 0 && (
        <div className="card" style={{ marginTop: "32px" }}>
          <p style={{ color: "#666", textAlign: "center", padding: "24px" }}>
            No assignments yet.{" "}
            <button
              onClick={() => navigate("/educator/create-lesson")}
              style={{
                background: "none",
                border: "none",
                color: "#667eea",
                cursor: "pointer",
                textDecoration: "underline",
              }}
            >
              Create your first lesson
            </button>
          </p>
        </div>
      )}

      {/* Footer: Quick Access */}
      <div
        style={{
          marginTop: "48px",
          paddingTop: "24px",
          borderTop: "1px solid rgba(255,255,255,0.1)",
          display: "flex",
          gap: "16px",
          flexWrap: "wrap",
        }}
      >
        <button
          className="btn btn-secondary"
          onClick={() => navigate("/educator/archived")}
          style={{ marginLeft: "auto" }}
        >
          Archived ({archivedCount})
        </button>
      </div>

      {/* Add Student Modal */}
      {addStudentModal && (
        <AddStudentModal
          assignmentId={addStudentModal.assignmentId}
          assignmentTitle={addStudentModal.assignmentTitle}
          classes={classes}
          allStudents={allStudents}
          onClose={() => setAddStudentModal(null)}
          onSuccess={() => {
            setAddStudentModal(null);
            loadData();
          }}
        />
      )}
    </div>
  );
}

// ============================================
// Helper Functions
// ============================================

function getReasonDescription(
  student: { understanding: string; hintsUsed: number; score: number },
  assignment: ComputedAssignmentState
): string {
  if (student.understanding === "needs-support") {
    return "Needs support with understanding";
  }
  if (student.hintsUsed > assignment.totalStudents * 0.5) {
    return "Used significant coach help";
  }
  if (student.score < 40) {
    return "Low score on assignment";
  }
  return "May need follow-up";
}

// ============================================
// Needs Attention Section
// ============================================

interface StudentAttentionItem {
  studentId: string;
  studentName: string;
  assignmentId: string;
  assignmentTitle: string;
  reason: string;
  hasTeacherNote: boolean;
}

interface NeedsAttentionSectionProps {
  students: StudentAttentionItem[];
  onNavigate: (studentId: string, assignmentId: string) => void;
}

function NeedsAttentionSection({ students, onNavigate }: NeedsAttentionSectionProps) {
  // Group by student to avoid showing same student multiple times
  const uniqueStudents = students.reduce((acc, student) => {
    if (!acc.find((s) => s.studentId === student.studentId)) {
      acc.push(student);
    }
    return acc;
  }, [] as StudentAttentionItem[]);

  // Show max 5 on dashboard
  const displayStudents = uniqueStudents.slice(0, 5);
  const hasMore = uniqueStudents.length > 5;

  return (
    <div
      className="card"
      style={{
        background: "#fff3e0",
        borderLeft: "4px solid #ff9800",
      }}
    >
      <div style={{ marginBottom: "16px" }}>
        <h3 style={{ margin: 0, color: "#e65100" }}>
          {uniqueStudents.length} student{uniqueStudents.length !== 1 ? "s" : ""} may need your attention
        </h3>
        <p style={{ margin: 0, color: "#666", marginTop: "4px" }}>
          Click on a student to review their work and add notes
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {displayStudents.map((student) => (
          <div
            key={`${student.studentId}-${student.assignmentId}`}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 16px",
              background: "white",
              borderRadius: "8px",
              cursor: "pointer",
              transition: "transform 0.1s, box-shadow 0.1s",
            }}
            onClick={() => onNavigate(student.studentId, student.assignmentId)}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateX(4px)";
              e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.1)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateX(0)";
              e.currentTarget.style.boxShadow = "none";
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
              <span style={{ fontWeight: 600, color: "#333" }}>{student.studentName}</span>
              <span style={{ color: "#666", fontSize: "0.9rem" }}>{student.assignmentTitle}</span>
              {student.hasTeacherNote && (
                <span title="Has your notes" style={{ fontSize: "0.85rem" }}>📝</span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <span
                style={{
                  fontSize: "0.85rem",
                  color: "#e65100",
                  maxWidth: "200px",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {student.reason}
              </span>
              <span style={{ color: "#ff9800" }}>→</span>
            </div>
          </div>
        ))}
      </div>

      {hasMore && (
        <p style={{ margin: 0, marginTop: "12px", color: "#666", fontSize: "0.9rem", textAlign: "center" }}>
          +{uniqueStudents.length - 5} more students across assignments
        </p>
      )}
    </div>
  );
}

// ============================================
// Assignment Card (Active)
// ============================================

interface AssignmentCardProps {
  assignment: ComputedAssignmentState;
  onNavigate: () => void;
  onArchive: () => void;
  onAddStudent: () => void;
}

function AssignmentCard({ assignment, onNavigate, onArchive, onAddStudent }: AssignmentCardProps) {
  const { title, totalStudents, completedCount, distribution, studentsNeedingSupport, studentStatuses } = assignment;

  const hasActivity = completedCount > 0;

  // Check if all students needing support have been reviewed (have teacher notes)
  const needsSupportStudents = studentStatuses.filter((s) => s.needsSupport);
  const allNeedsSupportReviewed =
    needsSupportStudents.length > 0 &&
    needsSupportStudents.every((s) => s.hasTeacherNote);
  const isFullyReviewed = hasActivity && (studentsNeedingSupport === 0 || allNeedsSupportReviewed);

  return (
    <div
      className="card"
      style={{
        cursor: "pointer",
        transition: "transform 0.2s, box-shadow 0.2s",
        position: "relative",
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
      {/* Header: Title and Action Buttons */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <h3 style={{ margin: 0, color: "#667eea", flex: 1 }}>{title}</h3>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAddStudent();
            }}
            title="Add student to this assignment"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: "4px 8px",
              borderRadius: "4px",
              color: "#667eea",
              fontSize: "0.85rem",
              transition: "color 0.2s, background 0.2s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#f0f0ff";
              e.currentTarget.style.color = "#5563d6";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "#667eea";
            }}
          >
            + Add Student
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onArchive();
            }}
            title="Archive this assignment"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: "4px 8px",
              borderRadius: "4px",
              color: "#999",
              fontSize: "0.85rem",
              transition: "color 0.2s, background 0.2s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#f5f5f5";
              e.currentTarget.style.color = "#666";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "#999";
            }}
          >
            Archive
          </button>
          <span style={{ color: "#667eea", fontSize: "1.2rem" }}>→</span>
        </div>
      </div>

      {/* Completion Status */}
      <p style={{ margin: 0, marginTop: "12px", color: "#666" }}>
        <span style={{ fontWeight: 600 }}>{completedCount}</span>/{totalStudents} completed
      </p>

      {/* Understanding Distribution Table (only if there's activity) */}
      {hasActivity && (
        <div
          style={{
            marginTop: "16px",
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "8px",
            textAlign: "center",
          }}
        >
          <div
            style={{
              padding: "8px",
              background: "#e8f5e9",
              borderRadius: "8px",
            }}
          >
            <div style={{ fontSize: "1.25rem", fontWeight: 600, color: "#2e7d32" }}>
              {distribution.strong}
            </div>
            <div style={{ fontSize: "0.75rem", color: "#2e7d32" }}>Strong</div>
          </div>
          <div
            style={{
              padding: "8px",
              background: "#fff3e0",
              borderRadius: "8px",
            }}
          >
            <div style={{ fontSize: "1.25rem", fontWeight: 600, color: "#ed6c02" }}>
              {distribution.developing}
            </div>
            <div style={{ fontSize: "0.75rem", color: "#ed6c02" }}>Developing</div>
          </div>
          <div
            style={{
              padding: "8px",
              background: "#ffebee",
              borderRadius: "8px",
            }}
          >
            <div style={{ fontSize: "1.25rem", fontWeight: 600, color: "#d32f2f" }}>
              {distribution.needsSupport}
            </div>
            <div style={{ fontSize: "0.75rem", color: "#d32f2f" }}>Need Support</div>
          </div>
        </div>
      )}

      {/* Not Started indicator */}
      {completedCount === 0 && (
        <p style={{ margin: 0, marginTop: "12px", color: "#999", fontSize: "0.9rem" }}>
          No students have completed yet
        </p>
      )}

      {/* Reviewed Status */}
      {isFullyReviewed && (
        <div
          style={{
            marginTop: "12px",
            padding: "6px 12px",
            background: "#e8f5e9",
            borderRadius: "8px",
            fontSize: "0.85rem",
            color: "#2e7d32",
            fontWeight: 500,
          }}
        >
          ✓ Reviewed
        </div>
      )}

      {/* Needs Attention indicator - only show if not reviewed */}
      {studentsNeedingSupport > 0 && !isFullyReviewed && (
        <div
          style={{
            marginTop: "12px",
            padding: "6px 12px",
            background: "#fff3e0",
            borderRadius: "8px",
            fontSize: "0.85rem",
            color: "#e65100",
          }}
        >
          {studentsNeedingSupport} student{studentsNeedingSupport !== 1 ? "s" : ""} may need attention
        </div>
      )}
    </div>
  );
}

// ============================================
// Resolved Assignment Card (De-emphasized)
// ============================================

interface ResolvedAssignmentCardProps {
  assignment: ComputedAssignmentState;
  onNavigate: () => void;
  onArchive: () => void;
}

function ResolvedAssignmentCard({ assignment, onNavigate, onArchive }: ResolvedAssignmentCardProps) {
  const { title, totalStudents, completedCount, distribution } = assignment;

  return (
    <div
      className="card"
      style={{
        cursor: "pointer",
        transition: "transform 0.2s, box-shadow 0.2s",
        background: "rgba(255,255,255,0.7)",
        opacity: 0.8,
      }}
      onClick={onNavigate}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.opacity = "1";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.opacity = "0.8";
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h4 style={{ margin: 0, color: "#667eea" }}>{title}</h4>
          <p style={{ margin: 0, marginTop: "4px", color: "#666", fontSize: "0.85rem" }}>
            {completedCount}/{totalStudents} completed
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onArchive();
            }}
            title="Archive now"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: "4px 8px",
              borderRadius: "4px",
              color: "#999",
              fontSize: "0.8rem",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "#666";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "#999";
            }}
          >
            Archive now
          </button>
          <span style={{ color: "#4caf50", fontSize: "0.85rem" }}>✓ Resolved</span>
        </div>
      </div>

      {/* Compact distribution */}
      <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
        {distribution.strong > 0 && (
          <span style={{ fontSize: "0.8rem", color: "#2e7d32" }}>
            {distribution.strong} Strong
          </span>
        )}
        {distribution.developing > 0 && (
          <span style={{ fontSize: "0.8rem", color: "#ed6c02" }}>
            {distribution.developing} Developing
          </span>
        )}
        {distribution.needsSupport > 0 && (
          <span style={{ fontSize: "0.8rem", color: "#d32f2f" }}>
            {distribution.needsSupport} Need Support
          </span>
        )}
      </div>
    </div>
  );
}

// ============================================
// Coaching Activity Section
// ============================================

interface CoachingActivitySectionProps {
  activities: StudentCoachingActivity[];
  onNavigate: (studentId: string) => void;
}

function CoachingActivitySection({ activities, onNavigate }: CoachingActivitySectionProps) {
  // Show support-seeking students prominently
  const supportSeeking = activities.filter((a) => a.insight.intentLabel === "support-seeking");
  const others = activities.filter((a) => a.insight.intentLabel !== "support-seeking");

  // Show max 5 total
  const displaySupport = supportSeeking.slice(0, 3);
  const displayOthers = others.slice(0, Math.max(0, 5 - displaySupport.length));
  const displayActivities = [...displaySupport, ...displayOthers];
  const hasMore = activities.length > 5;

  return (
    <div
      className="card"
      style={{
        marginTop: "16px",
        background: "#f3e5f5",
        borderLeft: "4px solid #9c27b0",
      }}
    >
      <div style={{ marginBottom: "16px" }}>
        <h3 style={{ margin: 0, color: "#7b1fa2" }}>
          Coach Activity
        </h3>
        <p style={{ margin: 0, color: "#666", marginTop: "4px" }}>
          Students who have been using Ask Coach
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {displayActivities.map((activity) => (
          <div
            key={activity.studentId}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 16px",
              background: "white",
              borderRadius: "8px",
              cursor: "pointer",
              transition: "transform 0.1s, box-shadow 0.1s",
            }}
            onClick={() => onNavigate(activity.studentId)}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateX(4px)";
              e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.1)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateX(0)";
              e.currentTarget.style.boxShadow = "none";
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <span style={{ fontSize: "1.2rem" }}>
                {activity.insight.intentLabel === "support-seeking"
                  ? "🆘"
                  : activity.insight.intentLabel === "enrichment-seeking"
                  ? "🚀"
                  : "💬"}
              </span>
              <div>
                <span style={{ fontWeight: 600, color: "#333" }}>{activity.studentName}</span>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <span
                style={{
                  fontSize: "0.85rem",
                  fontWeight: 500,
                  padding: "2px 8px",
                  borderRadius: "4px",
                  background:
                    activity.insight.intentLabel === "support-seeking"
                      ? "#fff3e0"
                      : activity.insight.intentLabel === "enrichment-seeking"
                      ? "#e8f5e9"
                      : "#f5f5f5",
                  color:
                    activity.insight.intentLabel === "support-seeking"
                      ? "#e65100"
                      : activity.insight.intentLabel === "enrichment-seeking"
                      ? "#2e7d32"
                      : "#666",
                }}
              >
                {activity.insight.intentLabel === "support-seeking"
                  ? "Support-Seeking"
                  : activity.insight.intentLabel === "enrichment-seeking"
                  ? "Enrichment-Seeking"
                  : "Mixed"}
              </span>
              <span style={{ color: "#9c27b0" }}>→</span>
            </div>
          </div>
        ))}
      </div>

      {hasMore && (
        <p style={{ margin: 0, marginTop: "12px", color: "#666", fontSize: "0.9rem", textAlign: "center" }}>
          +{activities.length - 5} more students with coach activity
        </p>
      )}

      {displayActivities.length > 0 && displayActivities.some((a) => a.insight.recentTopics.length > 0) && (
        <div style={{ marginTop: "12px", fontSize: "0.85rem", color: "#666" }}>
          Recent topics: {[...new Set(displayActivities.flatMap((a) => a.insight.recentTopics))].slice(0, 5).join(", ")}
        </div>
      )}
    </div>
  );
}

// ============================================
// Add Student Modal
// ============================================

interface AddStudentModalProps {
  assignmentId: string;
  assignmentTitle: string;
  classes: ClassSummary[];
  allStudents: Student[];
  onClose: () => void;
  onSuccess: () => void;
}

function AddStudentModal({
  assignmentId,
  assignmentTitle,
  classes,
  onClose,
  onSuccess,
}: AddStudentModalProps) {
  const [selectedStudents, setSelectedStudents] = useState<Set<string>>(new Set());
  const [assignedStudentIds, setAssignedStudentIds] = useState<Set<string>>(new Set());
  const [classesWithStudents, setClassesWithStudents] = useState<ClassWithStudents[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Load already assigned students and full class data
  useEffect(() => {
    async function loadData() {
      try {
        const [assignedData, ...classDataList] = await Promise.all([
          getAssignedStudents(assignmentId),
          ...classes.map((c) => getClass(c.id)),
        ]);
        setAssignedStudentIds(new Set(assignedData.studentIds));
        setClassesWithStudents(classDataList);
      } catch (err) {
        console.error("Failed to load data:", err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [assignmentId, classes]);

  const handleToggleStudent = (studentId: string) => {
    setSelectedStudents((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) {
        next.delete(studentId);
      } else {
        next.add(studentId);
      }
      return next;
    });
  };

  const handleSave = async () => {
    if (selectedStudents.size === 0) return;

    setSaving(true);
    try {
      // Group selected students by class
      const studentsByClass = new Map<string, string[]>();

      for (const studentId of selectedStudents) {
        // Find which class this student belongs to
        for (const cls of classesWithStudents) {
          if (cls.students.some((s) => s.id === studentId)) {
            if (!studentsByClass.has(cls.id)) {
              studentsByClass.set(cls.id, []);
            }
            studentsByClass.get(cls.id)!.push(studentId);
            break;
          }
        }
      }

      // Assign students to the lesson by class
      for (const [classId, studentIds] of studentsByClass) {
        await assignLessonToClass(assignmentId, classId, studentIds);
      }

      onSuccess();
    } catch (err) {
      console.error("Failed to add students:", err);
      alert("Failed to add students. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // Get unassigned students grouped by class
  const unassignedByClass = classesWithStudents.map((cls) => ({
    ...cls,
    unassignedStudents: cls.students.filter((s) => !assignedStudentIds.has(s.id)),
  })).filter((cls) => cls.unassignedStudents.length > 0);

  return (
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
      onClick={onClose}
    >
      <div
        style={{
          background: "white",
          borderRadius: "12px",
          padding: "24px",
          maxWidth: "500px",
          width: "90%",
          maxHeight: "80vh",
          overflow: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <h2 style={{ margin: 0, color: "#333" }}>Add Students</h2>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: "1.5rem",
              cursor: "pointer",
              color: "#999",
            }}
          >
            ×
          </button>
        </div>

        <p style={{ color: "#666", marginBottom: "16px" }}>
          Add students to <strong>{assignmentTitle}</strong>
        </p>

        {loading ? (
          <p style={{ color: "#666" }}>Loading...</p>
        ) : unassignedByClass.length === 0 ? (
          <p style={{ color: "#666" }}>All students are already assigned to this lesson.</p>
        ) : (
          <>
            {unassignedByClass.map((cls) => (
              <div key={cls.id} style={{ marginBottom: "16px" }}>
                <h4 style={{ margin: "0 0 8px 0", color: "#667eea" }}>{cls.name}</h4>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {cls.unassignedStudents.map((student) => (
                    <label
                      key={student.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "8px 12px",
                        background: selectedStudents.has(student.id) ? "#f0f0ff" : "#f5f5f5",
                        borderRadius: "8px",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedStudents.has(student.id)}
                        onChange={() => handleToggleStudent(student.id)}
                      />
                      <span>{student.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}

        <div style={{ display: "flex", gap: "12px", marginTop: "24px" }}>
          <button
            onClick={onClose}
            className="btn btn-secondary"
            style={{ flex: 1 }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="btn btn-primary"
            style={{ flex: 1 }}
            disabled={selectedStudents.size === 0 || saving}
          >
            {saving ? "Adding..." : `Add ${selectedStudents.size} Student${selectedStudents.size !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
