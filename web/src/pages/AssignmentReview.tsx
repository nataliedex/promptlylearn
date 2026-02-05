/**
 * Assignment Review - Primary Working Screen
 *
 * Design Philosophy:
 * - Clear hierarchy: Status → Action → Work → Reference
 * - Teachers see assignment content in 1 click
 * - Review flagged students first by default
 * - After review, students disappear from "Needs Review"
 * - Page shows completion when all flagged students are addressed
 */

import { useState, useEffect, useRef, useMemo } from "react";
import { useParams, Link, useNavigate, useLocation } from "react-router-dom";
import EducatorHeader from "../components/EducatorHeader";
import { useToast } from "../components/Toast";
import {
  getLesson,
  getSessions,
  getStudents,
  getAssignedStudents,
  recordAssignmentView,
  markStudentAction,
  getAssignmentReviewStatus,
  getRecommendations,
  getTeacherTodos,
  getStudentProgressStatus,
  unassignLessonFromClass,
  saveLesson,
  deleteLesson,
  generateQuestion,
  STUDENT_PROGRESS_LABELS,
  STUDENT_PROGRESS_CONFIG,
  type Lesson,
  type Prompt,
  type Student,
  type StudentActionStatus,
  type AssignmentReviewStatus,
  type Recommendation,
  type TeacherTodo,
  type ReviewState,
  type StudentProgressStatus,
} from "../services/api";
import {
  buildAssignmentReview,
  getUnderstandingLabel,
  getUnderstandingColor,
  getUnderstandingBgColor,
  getCoachSupportLabel,
} from "../utils/teacherDashboardUtils";
import { getCategoryConfig } from "../utils/recommendationConfig";
import type {
  AssignmentReviewData,
  StudentAssignmentRow,
} from "../types/teacherDashboard";
import AssignmentPreviewPanel from "../components/AssignmentPreviewPanel";
import InsightsDrawer from "../components/InsightsDrawer";

// ============================================
// Priority Sorting for Review
// ============================================

const UNDERSTANDING_PRIORITY: Record<string, number> = {
  "needs-support": 1,
  developing: 2,
  strong: 3,
};

const COACH_SUPPORT_PRIORITY: Record<string, number> = {
  significant: 1,
  some: 2,
  minimal: 3,
};

function sortByReviewPriority(students: StudentAssignmentRow[]): StudentAssignmentRow[] {
  return [...students].sort((a, b) => {
    // First: Understanding level (needs-support first)
    const understandingA = UNDERSTANDING_PRIORITY[a.understanding] ?? 99;
    const understandingB = UNDERSTANDING_PRIORITY[b.understanding] ?? 99;
    if (understandingA !== understandingB) return understandingA - understandingB;

    // Second: Coach support (significant first)
    const coachA = COACH_SUPPORT_PRIORITY[a.coachSupport] ?? 99;
    const coachB = COACH_SUPPORT_PRIORITY[b.coachSupport] ?? 99;
    if (coachA !== coachB) return coachA - coachB;

    // Third: Alphabetical
    return a.studentName.localeCompare(b.studentName);
  });
}

// ============================================
// ============================================
// Sorting Types (must be before component for SortableHeader)
// ============================================

type SortColumn = "student" | "progress" | "understanding" | "coachSupport" | "attempts" | "teacherStatus" | "insights";
type SortDirection = "asc" | "desc";

// ============================================
// Main Component
// ============================================

export default function AssignmentReview() {
  const { lessonId } = useParams<{ lessonId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const tableRef = useRef<HTMLDivElement>(null);
  const { showSuccess, showError } = useToast();


  // Class context: prefer API data, fall back to navigation state
  const navigationState = location.state as {
    fromClass?: string;
    className?: string;
  } | null;
  const [classId, setClassId] = useState<string | undefined>(navigationState?.fromClass);
  const [className, setClassName] = useState<string | undefined>(navigationState?.className);

  // Format date as "Assigned Jan 12"
  const formatAssignedDate = (isoDate: string | undefined): string | null => {
    if (!isoDate) return null;
    const date = new Date(isoDate);
    const month = date.toLocaleDateString("en-US", { month: "short" });
    const day = date.getDate();
    return `Assigned ${month} ${day}`;
  };

  const [reviewData, setReviewData] = useState<AssignmentReviewData | null>(null);
  const [reviewStatus, setReviewStatus] = useState<AssignmentReviewStatus | null>(null);
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"needs-review" | "all">("all");
  const [showPreview, setShowPreview] = useState(false);

  // Recommendations and Teacher Todos state
  const [recommendationsByStudent, setRecommendationsByStudent] = useState<Map<string, Recommendation[]>>(new Map());
  const [todosByStudent, setTodosByStudent] = useState<Map<string, TeacherTodo[]>>(new Map());
  const [drawerStudent, setDrawerStudent] = useState<{ id: string; name: string } | null>(null);

  // Actions state
  const [showUnassignConfirm, setShowUnassignConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [unassigning, setUnassigning] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Edit Lesson modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingLesson, setEditingLesson] = useState<Lesson | null>(null);
  const [savingLesson, setSavingLesson] = useState(false);

  // Sorting state
  const [sortColumn, setSortColumn] = useState<SortColumn>("student");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  const loadData = async () => {
    if (!lessonId) {
      setLoading(false);
      return;
    }

    try {
      recordAssignmentView(lessonId).catch(() => {});

      const [lessonData, sessions, assignedData, allStudents, status, recsResponse, todosResponse] = await Promise.all([
        getLesson(lessonId),
        getSessions(undefined, "completed"),
        getAssignedStudents(lessonId),
        getStudents(),
        getAssignmentReviewStatus(lessonId).catch(() => null),
        getRecommendations({ assignmentId: lessonId, status: "active" }).catch(() => ({ recommendations: [], stats: {} })),
        getTeacherTodos({ status: "open" }).catch(() => ({ todos: [] })),
      ]);

      // Group recommendations by studentId
      const recsMap = new Map<string, Recommendation[]>();
      for (const rec of recsResponse.recommendations) {
        for (const studentId of rec.studentIds) {
          if (!recsMap.has(studentId)) {
            recsMap.set(studentId, []);
          }
          recsMap.get(studentId)!.push(rec);
        }
      }
      setRecommendationsByStudent(recsMap);

      // Group teacher todos by studentId (filter by this assignment)
      const todosMap = new Map<string, TeacherTodo[]>();
      for (const todo of todosResponse.todos) {
        // Only include todos for this assignment
        if (todo.assignmentId === lessonId && todo.studentIds) {
          for (const studentId of todo.studentIds) {
            if (!todosMap.has(studentId)) {
              todosMap.set(studentId, []);
            }
            todosMap.get(studentId)!.push(todo);
          }
        }
      }
      setTodosByStudent(todosMap);

      const lessonSessions = sessions.filter((s) => s.lessonId === lessonId);
      const assignedStudentIds = assignedData.studentIds;

      const studentNames: Record<string, string> = {};
      allStudents.forEach((s: Student) => {
        if (assignedStudentIds.includes(s.id)) {
          studentNames[s.id] = s.name;
        }
      });

      const data = buildAssignmentReview(
        lessonId,
        (lessonData as Lesson).title,
        lessonSessions,
        lessonData as Lesson,
        assignedStudentIds,
        studentNames,
        assignedData.assignments
      );

      // Add earliest assigned date
      if (assignedData.earliestAssignedAt) {
        data.assignedAt = assignedData.earliestAssignedAt;
      }

      // Capture class context from API (overrides navigation state if available)
      if (assignedData.classId) setClassId(assignedData.classId);
      if (assignedData.className) setClassName(assignedData.className);

      setLesson(lessonData as Lesson);
      setReviewData(data);
      setReviewStatus(status);
    } catch (err) {
      console.error("AssignmentReview: Failed to load assignment data:", err);
      setError(err instanceof Error ? err.message : "Failed to load assignment data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [lessonId]);

  // Calculate derived data - ALL useMemo hooks must be before any early returns
  // Students awaiting review: completed but teacher hasn't reviewed yet
  const pendingReviewStudents = useMemo(() => {
    if (!reviewData) return [];
    return sortByReviewPriority(
      // Use reviewState as single source of truth: only "pending_review" students need attention
      reviewData.students.filter((s) => s.reviewState === "pending_review")
    );
  }, [reviewData]);

  // Students with open follow-ups scheduled
  const followupScheduledStudents = useMemo(() => {
    if (!reviewData) return [];
    return reviewData.students.filter((s) => s.reviewState === "followup_scheduled");
  }, [reviewData]);

  // For backwards compatibility with existing UI references
  const unaddressedStudents = pendingReviewStudents;

  const firstUnaddressed = pendingReviewStudents[0];

  // Helper to get sort value for a student
  const getSortValue = (student: StudentAssignmentRow, column: SortColumn): string | number => {
    switch (column) {
      case "student":
        return student.studentName.toLowerCase();
      case "progress":
        // Sort by completion status, then by questions answered
        if (student.isComplete) return 1000 + student.questionsAnswered;
        if (student.questionsAnswered > 0) return student.questionsAnswered;
        return -1; // Not started
      case "understanding":
        // Map understanding levels to numbers
        const understandingOrder: Record<string, number> = {
          "strong": 3,
          "developing": 2,
          "emerging": 1,
          "needs-support": 0,
        };
        return understandingOrder[student.understanding] ?? -1;
      case "coachSupport":
        // Map coach support levels to numbers
        const coachOrder: Record<string, number> = {
          "significant": 2,
          "moderate": 1,
          "minimal": 0,
        };
        return coachOrder[student.coachSupport] ?? -1;
      case "attempts":
        return student.attempts;
      case "teacherStatus":
        // Sort by reviewState (single source of truth)
        const reviewStateOrder: Record<ReviewState, number> = {
          "resolved": 5,
          "followup_scheduled": 4,
          "reviewed": 3,
          "pending_review": 2,
          "not_started": 1,
        };
        return reviewStateOrder[student.reviewState] ?? 0;
      case "insights":
        // Sort by number of insights + todos
        const recs = recommendationsByStudent.get(student.studentId) || [];
        const todos = todosByStudent.get(student.studentId) || [];
        return recs.filter(r => r.status === "active").length + todos.filter(t => t.status === "open").length;
      default:
        return 0;
    }
  };

  // Get students for current tab with sorting
  const displayedStudents = useMemo(() => {
    if (!reviewData) return [];

    let students: StudentAssignmentRow[];
    if (activeTab === "needs-review") {
      students = [...unaddressedStudents];
    } else {
      students = [...reviewData.students];
    }

    // Apply sorting
    students.sort((a, b) => {
      const aVal = getSortValue(a, sortColumn);
      const bVal = getSortValue(b, sortColumn);

      let comparison = 0;
      if (typeof aVal === "string" && typeof bVal === "string") {
        comparison = aVal.localeCompare(bVal);
      } else {
        comparison = (aVal as number) - (bVal as number);
      }

      return sortDirection === "asc" ? comparison : -comparison;
    });

    return students;
  }, [activeTab, reviewData, unaddressedStudents, sortColumn, sortDirection, recommendationsByStudent, todosByStudent]);

  // Check if any student has started work (used for guarding destructive actions)
  const anyStudentStarted = useMemo(() => {
    if (!reviewData) return false;
    return reviewData.students.some((s) => s.questionsAnswered > 0);
  }, [reviewData]);

  // Handle move back to unassigned
  const handleUnassign = async () => {
    if (!lessonId || !classId) return;
    setUnassigning(true);
    try {
      await unassignLessonFromClass(lessonId, classId);
      showSuccess("Lesson moved back to unassigned.");
      navigate("/educator");
    } catch (err) {
      console.error("Failed to unassign:", err);
      showError("Failed to unassign lesson");
    } finally {
      setUnassigning(false);
      setShowUnassignConfirm(false);
    }
  };

  // Handle delete assignment
  const handleDelete = async () => {
    if (!lessonId) return;
    setDeleting(true);
    try {
      await deleteLesson(lessonId);
      showSuccess("Assignment deleted.");
      navigate("/educator");
    } catch (err) {
      console.error("Failed to delete assignment:", err);
      showError("Failed to delete assignment");
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  // Handle opening Edit Lesson modal
  const handleOpenEditModal = () => {
    if (lesson) {
      setEditingLesson({ ...lesson, prompts: lesson.prompts.map(p => ({ ...p })) });
      setShowEditModal(true);
    }
  };

  // Handle saving lesson edits
  const handleSaveLesson = async () => {
    if (!editingLesson) return;
    setSavingLesson(true);
    try {
      await saveLesson(editingLesson);
      setLesson(editingLesson);
      // Update review data title if changed
      if (reviewData && editingLesson.title !== reviewData.title) {
        setReviewData({ ...reviewData, title: editingLesson.title });
      }
      setShowEditModal(false);
      showSuccess("Lesson saved.");
    } catch (err) {
      console.error("Failed to save lesson:", err);
      showError("Failed to save lesson");
    } finally {
      setSavingLesson(false);
    }
  };

  // Handle marking a student action (reserved for future use)
  const _handleMarkAction = async (studentId: string, action: StudentActionStatus) => {
    if (!lessonId || !reviewData) return;

    try {
      await markStudentAction(lessonId, studentId, action);

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

      const newStatus = await getAssignmentReviewStatus(lessonId);
      setReviewStatus(newStatus);

      if (action === "reviewed") {
        navigate(`/educator/assignment/${lessonId}/student/${studentId}`);
      }
    } catch (err) {
      console.error("Failed to mark action:", err);
    }
  };

  // Handle "View Flagged Students" - switch tab and scroll
  const handleViewAllFlagged = () => {
    setActiveTab("needs-review");
    setTimeout(() => {
      tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  };

  // Loading state
  if (loading) {
    return (
      <div className="loading">
        <div className="loading-spinner"></div>
        <p>Loading assignment data...</p>
      </div>
    );
  }

  // Breadcrumbs: Home / {Assignment Title}
  // Class context is shown elsewhere on the page, not in the breadcrumb trail.
  const breadcrumbs = [
    { label: reviewData?.title || "Assignment" },
  ];

  // Error state
  if (error) {
    return (
      <div className="container">
        <EducatorHeader breadcrumbs={breadcrumbs} />
        <div className="card" style={{ background: "#ffebee", borderLeft: "4px solid #d32f2f" }}>
          <h3 style={{ color: "#d32f2f", margin: "0 0 8px 0" }}>Error Loading Assignment</h3>
          <p style={{ color: "#666", margin: 0 }}>{error}</p>
          <button
            onClick={() => {
              setError(null);
              setLoading(true);
              loadData();
            }}
            className="btn btn-primary"
            style={{ marginTop: "16px" }}
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // Not found state
  if (!reviewData) {
    return (
      <div className="container">
        <EducatorHeader breadcrumbs={breadcrumbs} />
        <div className="card">
          <p>Assignment not found.</p>
          <Link to="/educator" className="btn btn-primary" style={{ marginTop: "16px" }}>
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  // No students assigned state
  if (reviewData.students.length === 0) {
    return (
      <div className="container">
        <EducatorHeader breadcrumbs={breadcrumbs} />

        <div className="header">
          <div>
            <h1>{reviewData.title}</h1>
            {reviewData.assignedAt && (
              <p style={{ color: "rgba(255,255,255,0.7)", margin: "4px 0 0 0", fontSize: "0.9rem" }}>
                {formatAssignedDate(reviewData.assignedAt)}
              </p>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
              onClick={handleOpenEditModal}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                background: "rgba(255, 255, 255, 0.95)",
                border: "none",
                padding: "8px 14px",
                font: "inherit",
                color: "#4a5568",
                cursor: "pointer",
                borderRadius: "6px",
                fontSize: "0.9rem",
                boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                fontWeight: 500,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#ffffff";
                e.currentTarget.style.boxShadow = "0 2px 4px rgba(0,0,0,0.15)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(255, 255, 255, 0.95)";
                e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.1)";
              }}
            >
              Edit Lesson
            </button>
            <ViewAssignmentToggle
              questionCount={reviewData.questionCount}
              showPreview={showPreview}
              onToggle={() => setShowPreview(!showPreview)}
            />
          </div>
        </div>

        {showPreview && lesson && (
          <AssignmentPreviewPanel lesson={lesson} onClose={() => setShowPreview(false)} />
        )}

        <div className="card" style={{ textAlign: "center", padding: "48px" }}>
          <h3 style={{ margin: 0, marginBottom: "8px" }}>No students assigned yet</h3>
          <p style={{ color: "#666", margin: 0 }}>
            Students will appear here once they are assigned to this lesson.
          </p>
        </div>
      </div>
    );
  }

  const { stats, distribution } = reviewData;

  // Calculate state-based banner conditions
  const pendingReviewCount = pendingReviewStudents.length;
  const followupCount = followupScheduledStudents.length;
  const hasNoCompletions = stats.completed === 0;
  // All students reviewed means none are pending_review and at least one has completed
  const isFullyReviewed = pendingReviewCount === 0 && stats.completed > 0;

  return (
    <div className="container">
      <EducatorHeader breadcrumbs={breadcrumbs} />

      {/* Header */}
      <div className="header">
        <div>
          <h1>{reviewData.title}</h1>
          {reviewData.assignedAt && (
            <p style={{ color: "rgba(255,255,255,0.7)", margin: "4px 0 0 0", fontSize: "0.9rem" }}>
              {formatAssignedDate(reviewData.assignedAt)}
            </p>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            onClick={handleOpenEditModal}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              background: "rgba(255, 255, 255, 0.95)",
              border: "none",
              padding: "8px 14px",
              font: "inherit",
              color: "#4a5568",
              cursor: "pointer",
              borderRadius: "6px",
              transition: "background 0.15s, box-shadow 0.15s",
              fontSize: "0.9rem",
              boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
              fontWeight: 500,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#ffffff";
              e.currentTarget.style.boxShadow = "0 2px 4px rgba(0,0,0,0.15)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.95)";
              e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.1)";
            }}
          >
            Edit Lesson
          </button>
          <ViewAssignmentToggle
            questionCount={reviewData.questionCount}
            showPreview={showPreview}
            onToggle={() => setShowPreview(!showPreview)}
          />
          {/* Actions dropdown for lifecycle operations */}
          {classId && (
            <AssignmentActions
              anyStudentStarted={anyStudentStarted}
              anyStudentSubmitted={reviewData.students.some(s => s.isComplete)}
              onUnassign={() => setShowUnassignConfirm(true)}
              onDelete={() => setShowDeleteConfirm(true)}
            />
          )}
        </div>
      </div>

      {/* Move back to Unassigned Confirmation Modal */}
      {showUnassignConfirm && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(45, 55, 72, 0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setShowUnassignConfirm(false)}
        >
          <div
            className="card"
            style={{
              maxWidth: "440px",
              width: "90%",
              position: "relative",
              boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 12px 0", color: "var(--text-primary)" }}>Move back to Unassigned?</h3>
            <p style={{ color: "var(--text-secondary)", margin: "0 0 8px 0", fontSize: "0.9rem", lineHeight: 1.5 }}>
              This will remove <strong>{reviewData.title}</strong> from{" "}
              <strong>{className || "this class"}</strong>. The lesson content will be preserved and can be reassigned later.
            </p>
            <p style={{ color: "#b45309", margin: "0 0 20px 0", fontSize: "0.85rem", fontWeight: 500 }}>
              Student assignment records will be removed.
            </p>
            <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
              <button
                onClick={() => setShowUnassignConfirm(false)}
                style={{
                  padding: "8px 16px",
                  background: "transparent",
                  color: "var(--text-secondary)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleUnassign}
                disabled={unassigning}
                style={{
                  padding: "8px 16px",
                  background: unassigning ? "#e2e8f0" : "#b45309",
                  color: unassigning ? "#64748b" : "white",
                  border: "none",
                  borderRadius: "6px",
                  cursor: unassigning ? "not-allowed" : "pointer",
                  fontSize: "0.875rem",
                  fontWeight: 600,
                }}
              >
                {unassigning ? "Moving..." : "Move to Unassigned"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Assignment Confirmation Modal */}
      {showDeleteConfirm && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(45, 55, 72, 0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setShowDeleteConfirm(false)}
        >
          <div
            className="card"
            style={{
              maxWidth: "440px",
              width: "90%",
              position: "relative",
              boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 12px 0", color: "var(--text-primary)" }}>Delete this assignment?</h3>
            <p style={{ color: "var(--text-secondary)", margin: "0 0 20px 0", fontSize: "0.9rem", lineHeight: 1.5 }}>
              This cannot be undone.
            </p>
            <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                style={{
                  padding: "8px 16px",
                  background: "transparent",
                  color: "var(--text-secondary)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                style={{
                  padding: "8px 16px",
                  background: deleting ? "#e2e8f0" : "var(--status-danger)",
                  color: deleting ? "#64748b" : "white",
                  border: "none",
                  borderRadius: "6px",
                  cursor: deleting ? "not-allowed" : "pointer",
                  fontSize: "0.875rem",
                  fontWeight: 600,
                }}
              >
                {deleting ? "Deleting..." : "Delete Assignment"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Lesson Modal */}
      {showEditModal && editingLesson && (
        <EditLessonModal
          lesson={editingLesson}
          onChange={setEditingLesson}
          onSave={handleSaveLesson}
          onClose={() => setShowEditModal(false)}
          saving={savingLesson}
          hasStudentSubmissions={reviewData.students.some(s => s.isComplete)}
        />
      )}

      {/* Assignment Preview Panel */}
      {showPreview && lesson && (
        <AssignmentPreviewPanel lesson={lesson} onClose={() => setShowPreview(false)} />
      )}

      {/* Status Tiles - Contextual summary, de-emphasized */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "8px",
          marginBottom: showPreview ? "12px" : "20px",
          opacity: showPreview ? 0.5 : 0.9,
          transition: "opacity 0.2s, margin-bottom 0.2s",
        }}
      >
        <StatusTile
          value={`${stats.completed}/${reviewData.students.length}`}
          label="Completed"
          sublabel={stats.inProgress > 0 ? `${stats.inProgress} in progress` : undefined}
        />
        <StatusTile
          value={distribution.strong}
          label="Strong"
          color="#43a047"
        />
        <StatusTile
          value={distribution.developing}
          label="Developing"
          color="#fb8c00"
        />
        <StatusTile
          value={distribution.needsSupport}
          label="Needs Support"
          color="#e53935"
        />
      </div>

      {/* Action Banner - Uses derived state counts */}
      {hasNoCompletions ? (
        // No submissions yet
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "16px 20px",
            background: "#fafafa",
            border: "1px solid #e8e8e8",
            borderLeft: "4px solid #9ca3af",
            borderRadius: "8px",
            marginBottom: "24px",
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 500, color: "#555", fontSize: "1rem" }}>No submissions yet</div>
            <div style={{ fontSize: "0.85rem", color: "#888", marginTop: "4px" }}>
              {stats.inProgress > 0 ? `${stats.inProgress} in progress` : "Waiting for students to start"}
            </div>
          </div>
        </div>
      ) : pendingReviewCount > 0 ? (
        // X submission(s) awaiting review
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "16px 20px",
            background: "#fff7ed",
            border: "1px solid #fed7aa",
            borderLeft: "4px solid #ea580c",
            borderRadius: "8px",
            marginBottom: "24px",
            flexWrap: "wrap",
            gap: "12px",
          }}
        >
          <div style={{ flex: 1, minWidth: "200px" }}>
            <div style={{ fontWeight: 600, color: "#c2410c", marginBottom: "4px", fontSize: "1rem" }}>
              {pendingReviewCount} submission{pendingReviewCount !== 1 ? "s" : ""} awaiting review
            </div>
            <div style={{ fontSize: "0.85rem", color: "#666", lineHeight: 1.4 }}>
              {distribution.needsSupport > 0 && distribution.developing > 0 ? (
                <>
                  {distribution.needsSupport} struggling with concepts · {distribution.developing} still developing understanding
                </>
              ) : distribution.needsSupport > 0 ? (
                <>Students are struggling and may need direct support</>
              ) : distribution.developing > 0 ? (
                <>Students are making progress but haven't fully demonstrated understanding</>
              ) : (
                <>Review their work and provide feedback</>
              )}
            </div>
          </div>
          <div style={{ flexShrink: 0 }}>
            <button
              onClick={handleViewAllFlagged}
              style={{
                padding: "10px 18px",
                background: "#667eea",
                color: "white",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: "0.9rem",
              }}
            >
              View Flagged Students
            </button>
          </div>
        </div>
      ) : isFullyReviewed ? (
        // All reviewed - show different message based on follow-ups
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "16px 20px",
            background: followupCount > 0 ? "#fef3c7" : "#f0fdf4",
            border: `1px solid ${followupCount > 0 ? "#fcd34d" : "#bbf7d0"}`,
            borderLeft: `4px solid ${followupCount > 0 ? "#f59e0b" : "#22c55e"}`,
            borderRadius: "8px",
            marginBottom: "24px",
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, color: followupCount > 0 ? "#b45309" : "#166534", fontSize: "1rem" }}>
              {followupCount > 0
                ? `All reviewed · ${followupCount} follow-up${followupCount !== 1 ? "s" : ""} scheduled`
                : "All submissions reviewed"}
            </div>
            <div style={{ fontSize: "0.85rem", color: "#666", marginTop: "4px" }}>
              {stats.completed} submission{stats.completed !== 1 ? "s" : ""} reviewed
            </div>
          </div>
          <button
            onClick={() => setActiveTab("all")}
            style={{
              padding: "8px 14px",
              background: "transparent",
              color: followupCount > 0 ? "#b45309" : "#166534",
              border: `1px solid ${followupCount > 0 ? "#fcd34d" : "#86efac"}`,
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "0.85rem",
              fontWeight: 500,
            }}
          >
            View All Submissions
          </button>
        </div>
      ) : null}

      {/* Tabs */}
      <div
        ref={tableRef}
        style={{
          display: "flex",
          gap: "4px",
          marginBottom: "0",
          background: "#f1f5f9",
          padding: "6px 6px 0 6px",
          borderRadius: "10px 10px 0 0",
          border: "1px solid #e2e8f0",
          borderBottom: "none",
        }}
      >
        <TabButton
          label={`Needs Review (${pendingReviewCount})`}
          active={activeTab === "needs-review"}
          onClick={() => setActiveTab("needs-review")}
          hasItems={pendingReviewCount > 0}
        />
        <TabButton
          label={`All Submissions (${reviewData.students.length})`}
          active={activeTab === "all"}
          onClick={() => setActiveTab("all")}
        />
      </div>

      {/* Student Table */}
      <div
        className="card"
        style={{ padding: "0", overflow: "hidden" }}
      >
        {displayedStudents.length === 0 ? (
          <div style={{ padding: "32px 24px", textAlign: "center" }}>
            {activeTab === "needs-review" ? (
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "12px 20px",
                  background: "#f0fdf4",
                  borderRadius: "8px",
                  border: "1px solid #bbf7d0",
                }}
              >
                <span style={{ color: "#16a34a", fontSize: "0.9rem", fontWeight: 600 }}>Done</span>
                <span style={{ color: "#166534", fontSize: "0.9rem" }}>
                  No students currently need review for this assignment.
                </span>
                <button
                  onClick={() => setActiveTab("all")}
                  style={{
                    marginLeft: "8px",
                    padding: "6px 12px",
                    background: "transparent",
                    color: "#166534",
                    border: "1px solid #86efac",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "0.85rem",
                    fontWeight: 500,
                  }}
                >
                  View All Submissions
                </button>
              </div>
            ) : (
              <p style={{ color: "#888", margin: 0 }}>No submissions to display.</p>
            )}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f8f9fa", borderBottom: "1px solid #e8e8e8" }}>
                <SortableHeader
                  label="Student"
                  column="student"
                  currentColumn={sortColumn}
                  currentDirection={sortDirection}
                  onSort={handleSort}
                  align="left"
                />
                <SortableHeader
                  label="Student Progress"
                  column="progress"
                  currentColumn={sortColumn}
                  currentDirection={sortDirection}
                  onSort={handleSort}
                />
                <SortableHeader
                  label="Understanding"
                  column="understanding"
                  currentColumn={sortColumn}
                  currentDirection={sortDirection}
                  onSort={handleSort}
                />
                <SortableHeader
                  label="Coach Support"
                  column="coachSupport"
                  currentColumn={sortColumn}
                  currentDirection={sortDirection}
                  onSort={handleSort}
                />
                <SortableHeader
                  label="Attempts"
                  column="attempts"
                  currentColumn={sortColumn}
                  currentDirection={sortDirection}
                  onSort={handleSort}
                />
                <SortableHeader
                  label="Teacher Status"
                  column="teacherStatus"
                  currentColumn={sortColumn}
                  currentDirection={sortDirection}
                  onSort={handleSort}
                />
                <SortableHeader
                  label="Insights"
                  column="insights"
                  currentColumn={sortColumn}
                  currentDirection={sortDirection}
                  onSort={handleSort}
                />
                <th style={{ textAlign: "center", padding: "10px 16px", fontWeight: 500, color: "#888", fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {displayedStudents.map((student) => (
                <StudentRow
                  key={student.studentId}
                  student={student}
                  onReview={(showInsights) => {
                    const baseUrl = `/educator/assignment/${lessonId}/student/${student.studentId}`;
                    const url = showInsights ? `${baseUrl}?showInsights=true` : baseUrl;
                    navigate(url, {
                      state: { fromAssignment: lessonId, assignmentTitle: reviewData.title }
                    });
                  }}
                  onViewStudent={() => navigate(`/educator/student/${student.studentId}`, {
                    state: { fromAssignment: lessonId, assignmentTitle: reviewData.title }
                  })}
                  showReviewButton={activeTab === "needs-review"}
                  recommendations={recommendationsByStudent.get(student.studentId) || []}
                  todos={todosByStudent.get(student.studentId) || []}
                  onInsightsClick={() => setDrawerStudent({ id: student.studentId, name: student.studentName })}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Insights Drawer */}
      {drawerStudent && (
        <InsightsDrawer
          isOpen={!!drawerStudent}
          onClose={() => setDrawerStudent(null)}
          studentId={drawerStudent.id}
          studentName={drawerStudent.name}
          recommendations={recommendationsByStudent.get(drawerStudent.id) || []}
          todos={todosByStudent.get(drawerStudent.id) || []}
          onRecommendationResolved={(recId) => {
            // Update local state
            setRecommendationsByStudent((prev) => {
              const next = new Map(prev);
              const studentRecs = next.get(drawerStudent.id) || [];
              next.set(drawerStudent.id, studentRecs.filter((r) => r.id !== recId));
              return next;
            });
          }}
          onTodoCompleted={(todoId) => {
            // Update local state to mark todo as done
            setTodosByStudent((prev) => {
              const next = new Map(prev);
              const studentTodos = next.get(drawerStudent.id) || [];
              next.set(
                drawerStudent.id,
                studentTodos.map((t) => (t.id === todoId ? { ...t, status: "done" as const } : t))
              );
              return next;
            });
          }}
        />
      )}
    </div>
  );
}

// ============================================
// View Assignment Toggle
// ============================================

function ViewAssignmentToggle({
  questionCount,
  showPreview,
  onToggle,
}: {
  questionCount: number;
  showPreview: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "8px",
        background: "rgba(255, 255, 255, 0.95)",
        border: "none",
        padding: "8px 14px",
        font: "inherit",
        color: "#4a5568",
        cursor: "pointer",
        borderRadius: "6px",
        transition: "background 0.15s, box-shadow 0.15s",
        fontSize: "0.9rem",
        boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "#ffffff";
        e.currentTarget.style.boxShadow = "0 2px 4px rgba(0,0,0,0.15)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "rgba(255, 255, 255, 0.95)";
        e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.1)";
      }}
    >
      <span style={{ fontWeight: 500 }}>
        {questionCount} question{questionCount !== 1 ? "s" : ""}
      </span>
      <span style={{ color: "#a0aec0" }}>·</span>
      <span style={{ color: "#667eea", fontWeight: 500 }}>
        {showPreview ? "Hide questions" : "Review Questions"}
      </span>
      <span style={{ color: "#667eea", fontSize: "0.75rem" }}>
        {showPreview ? "▲" : "▼"}
      </span>
    </button>
  );
}

// ============================================
// Assignment Actions (guarded destructive actions)
// ============================================

function AssignmentActions({
  anyStudentStarted,
  anyStudentSubmitted,
  onUnassign,
  onDelete,
}: {
  anyStudentStarted: boolean;
  anyStudentSubmitted: boolean;
  onUnassign: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(255, 255, 255, 0.95)",
          border: "none",
          padding: "8px 10px",
          font: "inherit",
          color: "#4a5568",
          cursor: "pointer",
          borderRadius: "6px",
          transition: "background 0.15s, box-shadow 0.15s",
          fontSize: "1rem",
          boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          lineHeight: 1,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "#ffffff";
          e.currentTarget.style.boxShadow = "0 2px 4px rgba(0,0,0,0.15)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "rgba(255, 255, 255, 0.95)";
          e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.1)";
        }}
        title="Assignment actions"
      >
        ⋯
      </button>
      {open && (
        <>
          <div
            style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 999 }}
            onClick={() => setOpen(false)}
          />
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              right: 0,
              background: "white",
              borderRadius: "8px",
              boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
              border: "1px solid #e2e8f0",
              minWidth: "240px",
              zIndex: 1000,
              overflow: "hidden",
            }}
          >
            {/* Move back to Unassigned */}
            {anyStudentStarted ? (
              <div
                style={{
                  padding: "10px 16px",
                  fontSize: "0.85rem",
                  color: "#94a3b8",
                  cursor: "not-allowed",
                  borderBottom: "1px solid #f1f5f9",
                }}
                title="Cannot unassign while students have started working"
              >
                <div style={{ fontWeight: 500, marginBottom: "2px" }}>Move back to Unassigned</div>
                <div style={{ fontSize: "0.78rem" }}>Unavailable — students have started</div>
              </div>
            ) : (
              <button
                onClick={() => {
                  setOpen(false);
                  onUnassign();
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 16px",
                  background: "transparent",
                  color: "#475569",
                  border: "none",
                  borderBottom: "1px solid #f1f5f9",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                  fontWeight: 500,
                  transition: "background 0.1s",
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "#f8fafc"}
                onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              >
                Move back to Unassigned
              </button>
            )}

            {/* Delete Assignment */}
            {anyStudentSubmitted ? (
              <div
                style={{
                  padding: "10px 16px",
                  fontSize: "0.85rem",
                  color: "#94a3b8",
                  cursor: "not-allowed",
                }}
              >
                <div style={{ fontWeight: 500, marginBottom: "2px" }}>Delete Assignment</div>
                <div style={{ fontSize: "0.78rem" }}>This assignment can't be deleted after students have submitted work.</div>
              </div>
            ) : (
              <button
                onClick={() => {
                  setOpen(false);
                  onDelete();
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 16px",
                  background: "transparent",
                  color: "var(--status-danger)",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                  fontWeight: 500,
                  transition: "background 0.1s",
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "#fef2f2"}
                onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              >
                Delete Assignment
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ============================================
// Edit Lesson Modal
// ============================================

function EditLessonModal({
  lesson,
  onChange,
  onSave,
  onClose,
  saving,
  hasStudentSubmissions,
}: {
  lesson: Lesson;
  onChange: (lesson: Lesson) => void;
  onSave: () => void;
  onClose: () => void;
  saving: boolean;
  hasStudentSubmissions: boolean;
}) {
  const { showSuccess, showError } = useToast();
  const [confirmDeleteIndex, setConfirmDeleteIndex] = useState<number | null>(null);

  // AI question generation state (mirrors LessonEditor flow)
  const [showAddQuestionPanel, setShowAddQuestionPanel] = useState(false);
  const [generatingQuestion, setGeneratingQuestion] = useState(false);
  const [generatedQuestion, setGeneratedQuestion] = useState<Prompt | null>(null);
  const [questionFocus, setQuestionFocus] = useState("");

  const updatePrompt = (index: number, updates: Partial<Prompt>) => {
    const newPrompts = lesson.prompts.map((p, i) =>
      i === index ? { ...p, ...updates } : p
    );
    onChange({ ...lesson, prompts: newPrompts });
  };

  const removeQuestion = (index: number) => {
    onChange({ ...lesson, prompts: lesson.prompts.filter((_, i) => i !== index) });
    setConfirmDeleteIndex(null);
  };

  const updateHint = (promptIndex: number, hintIndex: number, value: string) => {
    const newPrompts = lesson.prompts.map((p, i) => {
      if (i !== promptIndex) return p;
      const newHints = [...p.hints];
      newHints[hintIndex] = value;
      return { ...p, hints: newHints };
    });
    onChange({ ...lesson, prompts: newPrompts });
  };

  const addHint = (promptIndex: number) => {
    const newPrompts = lesson.prompts.map((p, i) => {
      if (i !== promptIndex) return p;
      return { ...p, hints: [...p.hints, ""] };
    });
    onChange({ ...lesson, prompts: newPrompts });
  };

  const removeHint = (promptIndex: number, hintIndex: number) => {
    const newPrompts = lesson.prompts.map((p, i) => {
      if (i !== promptIndex) return p;
      return { ...p, hints: p.hints.filter((_, hi) => hi !== hintIndex) };
    });
    onChange({ ...lesson, prompts: newPrompts });
  };

  // AI question generation handlers (same flow as LessonEditor)
  const handleGenerateQuestion = async () => {
    setGeneratingQuestion(true);
    try {
      const existingQuestions = lesson.prompts.map((p) => p.input);
      const lessonContext = `${lesson.title}: ${lesson.description}`;
      const newQuestion = await generateQuestion(
        lessonContext,
        existingQuestions,
        lesson.difficulty,
        {
          focus: questionFocus.trim() || undefined,
          subject: lesson.subject || undefined,
          gradeLevel: lesson.gradeLevel || undefined,
        }
      );
      setGeneratedQuestion(newQuestion);
    } catch (err) {
      console.error("Failed to generate question:", err);
      showError("Failed to generate question");
    } finally {
      setGeneratingQuestion(false);
    }
  };

  const handleAddGeneratedQuestion = () => {
    if (!generatedQuestion) return;
    onChange({ ...lesson, prompts: [...lesson.prompts, generatedQuestion] });
    setGeneratedQuestion(null);
    setShowAddQuestionPanel(false);
    setQuestionFocus("");
    showSuccess("Question added");
  };

  const updateGeneratedQuestion = (updates: Partial<Prompt>) => {
    if (!generatedQuestion) return;
    setGeneratedQuestion({ ...generatedQuestion, ...updates });
  };

  const updateGeneratedHint = (hintIndex: number, value: string) => {
    if (!generatedQuestion) return;
    setGeneratedQuestion({
      ...generatedQuestion,
      hints: generatedQuestion.hints.map((h, i) => (i === hintIndex ? value : h)),
    });
  };

  const addGeneratedHint = () => {
    if (!generatedQuestion) return;
    setGeneratedQuestion({
      ...generatedQuestion,
      hints: [...generatedQuestion.hints, ""],
    });
  };

  const removeGeneratedHint = (hintIndex: number) => {
    if (!generatedQuestion) return;
    setGeneratedQuestion({
      ...generatedQuestion,
      hints: generatedQuestion.hints.filter((_, i) => i !== hintIndex),
    });
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(45, 55, 72, 0.5)",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        zIndex: 1000,
        overflowY: "auto",
        padding: "40px 16px",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "white",
          borderRadius: "12px",
          maxWidth: "720px",
          width: "100%",
          boxShadow: "0 12px 40px rgba(0,0,0,0.15)",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "16px 24px",
            borderBottom: "1px solid #e2e8f0",
            background: "#f8fafc",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "1.1rem", color: "#1e293b" }}>Edit Lesson</h2>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <button
              onClick={onSave}
              disabled={saving}
              style={{
                padding: "7px 16px",
                background: saving ? "#e2e8f0" : "#667eea",
                color: saving ? "#64748b" : "white",
                border: "none",
                borderRadius: "6px",
                cursor: saving ? "not-allowed" : "pointer",
                fontSize: "0.85rem",
                fontWeight: 600,
              }}
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
            <button
              onClick={onClose}
              style={{
                background: "none",
                border: "none",
                fontSize: "1.3rem",
                color: "#94a3b8",
                cursor: "pointer",
                padding: "4px 8px",
                lineHeight: 1,
                borderRadius: "4px",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "#475569";
                e.currentTarget.style.background = "#e2e8f0";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "#94a3b8";
                e.currentTarget.style.background = "none";
              }}
            >
              ×
            </button>
          </div>
        </div>

        {/* Submissions warning banner */}
        {hasStudentSubmissions && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "10px 24px",
              background: "#fffbeb",
              borderBottom: "1px solid #fde68a",
              fontSize: "0.83rem",
              color: "#92400e",
            }}
          >
            <span style={{ fontWeight: 600 }}>Note:</span>
            <span>This assignment already has student responses. Changes may affect grading.</span>
          </div>
        )}

        {/* Modal Body */}
        <div style={{ padding: "24px", maxHeight: "calc(100vh - 200px)", overflowY: "auto" }}>
          {/* Title */}
          <div style={{ marginBottom: "16px" }}>
            <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#475569", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.03em" }}>
              Title
            </label>
            <input
              type="text"
              value={lesson.title}
              onChange={(e) => onChange({ ...lesson, title: e.target.value })}
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid #e2e8f0",
                borderRadius: "6px",
                fontSize: "0.95rem",
                color: "#1e293b",
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* Description */}
          <div style={{ marginBottom: "24px" }}>
            <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#475569", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.03em" }}>
              Description
            </label>
            <textarea
              value={lesson.description}
              onChange={(e) => onChange({ ...lesson, description: e.target.value })}
              rows={2}
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid #e2e8f0",
                borderRadius: "6px",
                fontSize: "0.9rem",
                color: "#1e293b",
                resize: "vertical",
                boxSizing: "border-box",
                fontFamily: "inherit",
              }}
            />
          </div>

          {/* Questions */}
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#475569", marginBottom: "12px", textTransform: "uppercase", letterSpacing: "0.03em" }}>
              Questions ({lesson.prompts.length})
            </label>
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {lesson.prompts.map((prompt, index) => (
                <div
                  key={prompt.id}
                  style={{
                    border: "1px solid #e2e8f0",
                    borderRadius: "8px",
                    overflow: "hidden",
                    position: "relative",
                  }}
                >
                  {/* Delete question button */}
                  {lesson.prompts.length > 1 && (
                    <button
                      onClick={() => setConfirmDeleteIndex(index)}
                      style={{
                        position: "absolute",
                        top: "8px",
                        right: "8px",
                        background: "none",
                        border: "none",
                        color: "#cbd5e1",
                        cursor: "pointer",
                        fontSize: "0.85rem",
                        padding: "2px 6px",
                        lineHeight: 1,
                        borderRadius: "4px",
                        zIndex: 1,
                        transition: "color 0.1s, background 0.1s",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = "#ef4444";
                        e.currentTarget.style.background = "#fef2f2";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = "#cbd5e1";
                        e.currentTarget.style.background = "none";
                      }}
                      title="Remove question"
                    >
                      ✕
                    </button>
                  )}

                  {/* Delete confirmation inline */}
                  {confirmDeleteIndex === index && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "8px 16px",
                        background: "#fef2f2",
                        borderBottom: "1px solid #fecaca",
                        fontSize: "0.83rem",
                      }}
                    >
                      <span style={{ color: "#991b1b", fontWeight: 500 }}>Remove this question?</span>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <button
                          onClick={() => setConfirmDeleteIndex(null)}
                          style={{
                            padding: "4px 10px",
                            background: "transparent",
                            color: "#64748b",
                            border: "1px solid #e2e8f0",
                            borderRadius: "4px",
                            cursor: "pointer",
                            fontSize: "0.8rem",
                            fontWeight: 500,
                          }}
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => removeQuestion(index)}
                          style={{
                            padding: "4px 10px",
                            background: "#ef4444",
                            color: "white",
                            border: "none",
                            borderRadius: "4px",
                            cursor: "pointer",
                            fontSize: "0.8rem",
                            fontWeight: 600,
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Question header */}
                  <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", padding: "12px 16px", paddingRight: "36px" }}>
                    <span
                      style={{
                        flexShrink: 0,
                        width: "24px",
                        height: "24px",
                        borderRadius: "50%",
                        background: "#667eea",
                        color: "white",
                        fontSize: "0.8rem",
                        fontWeight: 600,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        marginTop: "8px",
                      }}
                    >
                      {index + 1}
                    </span>
                    <textarea
                      value={prompt.input}
                      onChange={(e) => updatePrompt(index, { input: e.target.value })}
                      rows={2}
                      style={{
                        flex: 1,
                        padding: "8px 10px",
                        border: "1px solid #e2e8f0",
                        borderRadius: "6px",
                        fontSize: "0.9rem",
                        color: "#1e293b",
                        resize: "vertical",
                        fontFamily: "inherit",
                        lineHeight: 1.5,
                      }}
                    />
                  </div>

                  {/* Hints */}
                  <div style={{ padding: "0 16px 12px 50px" }}>
                    <div style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: 500, marginBottom: "6px" }}>
                      Hints ({prompt.hints.length})
                    </div>
                    {prompt.hints.map((hint, hintIndex) => (
                      <div key={hintIndex} style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                        <input
                          type="text"
                          value={hint}
                          onChange={(e) => updateHint(index, hintIndex, e.target.value)}
                          style={{
                            flex: 1,
                            padding: "6px 8px",
                            border: "1px solid #e2e8f0",
                            borderRadius: "4px",
                            fontSize: "0.85rem",
                            color: "#475569",
                          }}
                        />
                        <button
                          onClick={() => removeHint(index, hintIndex)}
                          style={{
                            background: "none",
                            border: "none",
                            color: "#94a3b8",
                            cursor: "pointer",
                            fontSize: "1rem",
                            padding: "2px 4px",
                            lineHeight: 1,
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.color = "#ef4444"}
                          onMouseLeave={(e) => e.currentTarget.style.color = "#94a3b8"}
                          title="Remove hint"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => addHint(index)}
                      style={{
                        background: "none",
                        border: "none",
                        color: "#667eea",
                        cursor: "pointer",
                        fontSize: "0.8rem",
                        padding: "4px 0",
                        fontWeight: 500,
                      }}
                    >
                      + Add hint
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Add Question section */}
            {!showAddQuestionPanel ? (
              <button
                onClick={() => {
                  setShowAddQuestionPanel(true);
                  setGeneratedQuestion(null);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
                  width: "100%",
                  padding: "14px",
                  marginTop: "16px",
                  background: "#f8fafc",
                  border: "2px dashed #e2e8f0",
                  borderRadius: "8px",
                  cursor: "pointer",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                  color: "#667eea",
                  transition: "border-color 0.15s, background 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "#667eea";
                  e.currentTarget.style.background = "#f0f0ff";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "#e2e8f0";
                  e.currentTarget.style.background = "#f8fafc";
                }}
              >
                + Add Question
              </button>
            ) : (
              <div
                style={{
                  marginTop: "16px",
                  border: "1px solid #e2e8f0",
                  borderRadius: "8px",
                  overflow: "hidden",
                  background: "#fafbfc",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "12px 16px",
                    borderBottom: "1px solid #e2e8f0",
                  }}
                >
                  <h3 style={{ margin: 0, fontSize: "0.95rem", color: "#1e293b" }}>Add Question</h3>
                  <button
                    onClick={() => {
                      setShowAddQuestionPanel(false);
                      setGeneratedQuestion(null);
                      setQuestionFocus("");
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      fontSize: "1.1rem",
                      color: "#94a3b8",
                      cursor: "pointer",
                      padding: "2px 6px",
                      lineHeight: 1,
                    }}
                  >
                    ×
                  </button>
                </div>

                <div style={{ padding: "16px" }}>
                  {!generatedQuestion ? (
                    <div style={{ padding: "4px 0 16px 0" }}>
                      {/* Optional focus input */}
                      <div style={{ marginBottom: "16px" }}>
                        <label style={{ display: "block", fontSize: "0.83rem", fontWeight: 500, color: "#475569", marginBottom: "5px" }}>
                          What should this question focus on?
                        </label>
                        <input
                          type="text"
                          value={questionFocus}
                          onChange={(e) => setQuestionFocus(e.target.value)}
                          placeholder="e.g., daily life, religion, cause and effect, compare past vs present"
                          style={{
                            width: "100%",
                            padding: "8px 10px",
                            border: "1px solid #e2e8f0",
                            borderRadius: "6px",
                            fontSize: "0.875rem",
                            color: "#1e293b",
                            boxSizing: "border-box",
                          }}
                        />
                        <p style={{ margin: "4px 0 0 0", fontSize: "0.78rem", color: "#94a3b8" }}>
                          Optional — leave blank to let the AI choose
                        </p>
                      </div>

                      <div style={{ textAlign: "center" }}>
                        <button
                          onClick={handleGenerateQuestion}
                          disabled={generatingQuestion}
                          style={{
                            padding: "10px 20px",
                            background: generatingQuestion ? "#e2e8f0" : "#667eea",
                            color: generatingQuestion ? "#64748b" : "white",
                            border: "none",
                            borderRadius: "6px",
                            cursor: generatingQuestion ? "not-allowed" : "pointer",
                            fontSize: "0.875rem",
                            fontWeight: 600,
                          }}
                        >
                          {generatingQuestion ? (
                            <>
                              <span className="loading-spinner" style={{ width: "14px", height: "14px", marginRight: "8px", display: "inline-block" }}></span>
                              Generating...
                            </>
                          ) : (
                            "Generate Question with AI"
                          )}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      {/* Generated question text */}
                      <div style={{ marginBottom: "12px" }}>
                        <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, color: "#64748b", marginBottom: "6px" }}>
                          Question Text
                        </label>
                        <textarea
                          value={generatedQuestion.input}
                          onChange={(e) => updateGeneratedQuestion({ input: e.target.value })}
                          rows={3}
                          style={{
                            width: "100%",
                            padding: "8px 10px",
                            border: "1px solid #e2e8f0",
                            borderRadius: "6px",
                            fontSize: "0.9rem",
                            color: "#1e293b",
                            resize: "vertical",
                            fontFamily: "inherit",
                            boxSizing: "border-box",
                          }}
                        />
                      </div>

                      {/* Generated hints */}
                      <div style={{ marginBottom: "16px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                          <label style={{ fontSize: "0.8rem", fontWeight: 500, color: "#64748b" }}>
                            Hints ({generatedQuestion.hints.length})
                          </label>
                          <button
                            onClick={addGeneratedHint}
                            style={{
                              padding: "3px 8px",
                              background: "#667eea",
                              color: "white",
                              border: "none",
                              borderRadius: "4px",
                              cursor: "pointer",
                              fontSize: "0.75rem",
                            }}
                          >
                            + Add Hint
                          </button>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                          {generatedQuestion.hints.map((hint, hintIndex) => (
                            <div
                              key={hintIndex}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "6px",
                              }}
                            >
                              <span style={{ fontSize: "0.75rem", color: "#94a3b8", fontWeight: 600, minWidth: "18px" }}>
                                {hintIndex + 1}.
                              </span>
                              <input
                                type="text"
                                value={hint}
                                onChange={(e) => updateGeneratedHint(hintIndex, e.target.value)}
                                style={{
                                  flex: 1,
                                  padding: "6px 8px",
                                  border: "1px solid #e2e8f0",
                                  borderRadius: "4px",
                                  fontSize: "0.85rem",
                                  color: "#475569",
                                }}
                              />
                              <button
                                onClick={() => removeGeneratedHint(hintIndex)}
                                style={{
                                  background: "none",
                                  border: "none",
                                  color: "#94a3b8",
                                  cursor: "pointer",
                                  fontSize: "0.85rem",
                                  padding: "2px 4px",
                                  lineHeight: 1,
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.color = "#ef4444"}
                                onMouseLeave={(e) => e.currentTarget.style.color = "#94a3b8"}
                                title="Remove hint"
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Actions */}
                      <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                        <button
                          onClick={handleGenerateQuestion}
                          disabled={generatingQuestion}
                          style={{
                            padding: "8px 14px",
                            background: "transparent",
                            color: "#64748b",
                            border: "1px solid #e2e8f0",
                            borderRadius: "6px",
                            cursor: generatingQuestion ? "not-allowed" : "pointer",
                            fontSize: "0.85rem",
                            fontWeight: 500,
                          }}
                        >
                          {generatingQuestion ? "Generating..." : "Regenerate"}
                        </button>
                        <button
                          onClick={handleAddGeneratedQuestion}
                          style={{
                            padding: "8px 16px",
                            background: "#667eea",
                            color: "white",
                            border: "none",
                            borderRadius: "6px",
                            cursor: "pointer",
                            fontSize: "0.85rem",
                            fontWeight: 600,
                          }}
                        >
                          Add to Lesson
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Status Tile Component (Contextual, de-emphasized)
// ============================================

function StatusTile({
  value,
  label,
  sublabel,
  color,
}: {
  value: string | number;
  label: string;
  sublabel?: string;
  color?: string;
}) {
  return (
    <div
      style={{
        background: "#fafafa",
        border: "1px solid #f0f0f0",
        borderRadius: "8px",
        padding: "10px 12px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize: "1.25rem",
          fontWeight: 600,
          color: color || "#555",
          lineHeight: 1.2,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: "0.75rem", color: "#999", marginTop: "3px", textTransform: "uppercase", letterSpacing: "0.02em" }}>
        {label}
      </div>
      {sublabel && (
        <div style={{ fontSize: "0.7rem", color: "#bbb", marginTop: "2px" }}>
          {sublabel}
        </div>
      )}
    </div>
  );
}

// ============================================
// Tab Button Component
// ============================================

function TabButton({
  label,
  active,
  onClick,
  hasItems = true,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  hasItems?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "12px 20px",
        background: active ? "#ffffff" : "#f8fafc",
        border: active ? "1px solid #e2e8f0" : "1px solid transparent",
        borderBottom: active ? "2px solid #667eea" : "2px solid #e2e8f0",
        cursor: "pointer",
        fontWeight: active ? 600 : 500,
        color: active ? "#1e293b" : hasItems ? "#475569" : "#94a3b8",
        fontSize: "0.9rem",
        marginBottom: "-1px",
        transition: "all 0.15s ease",
        borderRadius: "8px 8px 0 0",
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.background = "#f1f5f9";
          e.currentTarget.style.color = "#334155";
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.background = "#f8fafc";
          e.currentTarget.style.color = hasItems ? "#475569" : "#94a3b8";
        }
      }}
    >
      {label}
    </button>
  );
}

// ============================================
// Student Row Component
// ============================================

// ============================================
// Sortable Table Header
// ============================================

function SortableHeader({
  label,
  column,
  currentColumn,
  currentDirection,
  onSort,
  align = "center",
}: {
  label: string;
  column: SortColumn;
  currentColumn: SortColumn;
  currentDirection: SortDirection;
  onSort: (column: SortColumn) => void;
  align?: "left" | "center";
}) {
  const isActive = currentColumn === column;

  return (
    <th
      onClick={() => onSort(column)}
      style={{
        textAlign: align,
        padding: align === "left" ? "10px 16px" : "10px 8px",
        fontWeight: 500,
        color: isActive ? "#667eea" : "#888",
        fontSize: "0.8rem",
        textTransform: "uppercase",
        letterSpacing: "0.03em",
        cursor: "pointer",
        userSelect: "none",
        transition: "color 0.15s",
      }}
      onMouseEnter={(e) => {
        if (!isActive) e.currentTarget.style.color = "#666";
      }}
      onMouseLeave={(e) => {
        if (!isActive) e.currentTarget.style.color = "#888";
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
        {label}
        <span
          style={{
            display: "inline-flex",
            flexDirection: "column",
            fontSize: "0.6rem",
            lineHeight: 1,
            opacity: isActive ? 1 : 0.4,
          }}
        >
          <span style={{ color: isActive && currentDirection === "asc" ? "#667eea" : "#ccc" }}>▲</span>
          <span style={{ color: isActive && currentDirection === "desc" ? "#667eea" : "#ccc", marginTop: "-2px" }}>▼</span>
        </span>
      </span>
    </th>
  );
}

// ============================================
// Student Row
// ============================================

interface StudentRowProps {
  student: StudentAssignmentRow;
  onReview: (showInsights?: boolean) => void;
  onViewStudent: () => void;
  showReviewButton: boolean;
  recommendations: Recommendation[];
  todos: TeacherTodo[];
  onInsightsClick: () => void;
}

function StudentRow({ student, onReview, onViewStudent, showReviewButton, recommendations, todos, onInsightsClick }: StudentRowProps) {
  const hasStarted = student.questionsAnswered > 0;
  // Use reviewState as single source of truth
  const needsAction = student.needsReview && student.reviewState === "pending_review";
  const activeInsights = recommendations.filter(r => r.status === "active");
  const resolvedInsights = recommendations.filter(r => r.status === "resolved" || r.status === "reviewed");
  // Exclude superseded todos — they are historical only
  const nonSupersededTodos = todos.filter(t => t.status !== "superseded");
  const openTodos = nonSupersededTodos.filter(t => t.status === "open");
  const completedTodos = nonSupersededTodos.filter(t => t.status === "done");

  // Has any activity to show
  const hasInsights = activeInsights.length > 0;
  const hasTodos = openTodos.length > 0;
  const hasCompletedActions = resolvedInsights.length > 0 || completedTodos.length > 0;
  const hasBadgeAwarded = resolvedInsights.some(r => r.submittedActions?.some(a => a.actionKey === "award_badge"));
  const hasAnyActivity = hasInsights || hasTodos || hasCompletedActions;

  // Get the top category for display (first active recommendation's category)
  const topCategory = hasInsights ? getCategoryConfig(activeInsights[0]) : null;

  // Calculate teacher status from reviewState (single source of truth)
  const teacherStatus = getTeacherStatus(
    hasStarted,
    student.reviewState,
    student.hasTeacherNote
  );

  return (
    <tr
      style={{
        borderBottom: "1px solid #f0f0f0",
        background: needsAction && showReviewButton ? "#fffbf5" : "transparent",
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = needsAction && showReviewButton ? "#fff8f0" : "#fafafa";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = needsAction && showReviewButton ? "#fffbf5" : "transparent";
      }}
    >
      {/* Student Name */}
      <td style={{ padding: "12px 16px" }}>
        <span
          onClick={onViewStudent}
          style={{ fontWeight: 500, color: "#667eea", cursor: "pointer" }}
        >
          {student.studentName}
        </span>
      </td>

      {/* Student Progress */}
      <td style={{ textAlign: "center", padding: "12px 8px" }}>
        <StudentProgressBadge
          isComplete={student.isComplete}
          attempts={student.attempts}
          hasStarted={hasStarted}
          questionsAnswered={student.questionsAnswered}
          totalQuestions={student.totalQuestions}
        />
      </td>

      {/* Understanding Level */}
      <td style={{ textAlign: "center", padding: "12px 8px" }}>
        {hasStarted ? (
          <span
            style={{
              display: "inline-block",
              padding: "4px 10px",
              borderRadius: "12px",
              fontSize: "0.78rem",
              fontWeight: 500,
              background: getUnderstandingBgColor(student.understanding),
              color: getUnderstandingColor(student.understanding),
            }}
          >
            {getUnderstandingLabel(student.understanding)}
          </span>
        ) : (
          <span style={{ color: "#ccc" }}>—</span>
        )}
      </td>

      {/* Coach Support */}
      <td style={{ textAlign: "center", padding: "12px 8px" }}>
        {hasStarted ? (
          <span
            style={{
              fontSize: "0.85rem",
              color: student.coachSupport === "significant" ? "#e65100" : "#888",
            }}
          >
            {getCoachSupportLabel(student.coachSupport)}
          </span>
        ) : (
          <span style={{ color: "#ccc" }}>—</span>
        )}
      </td>

      {/* Attempts */}
      <td style={{ textAlign: "center", padding: "12px 8px" }}>
        {student.attempts > 1 ? (
          <span
            style={{
              display: "inline-block",
              padding: "3px 8px",
              borderRadius: "10px",
              fontSize: "0.78rem",
              fontWeight: 500,
              background: "#e3f2fd",
              color: "#1565c0",
            }}
          >
            {student.attempts}
          </span>
        ) : (
          <span style={{ color: "#888", fontSize: "0.85rem" }}>{student.attempts}</span>
        )}
      </td>

      {/* Teacher Status */}
      <td style={{ textAlign: "center", padding: "12px 8px" }}>
        <TeacherStatusBadge status={teacherStatus} />
      </td>

      {/* Insights */}
      <td style={{ textAlign: "center", padding: "12px 8px" }}>
        {hasAnyActivity ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "4px",
            }}
          >
            {/* AI Insight chip */}
            {hasInsights && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onInsightsClick();
                }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "5px",
                  padding: "3px 8px",
                  borderRadius: "10px",
                  fontSize: "0.72rem",
                  fontWeight: 500,
                  background: topCategory?.bgColor || "#f5f5f5",
                  color: topCategory?.color || "#666",
                  border: `1px solid ${topCategory?.color || "#ccc"}`,
                  cursor: "pointer",
                  transition: "transform 0.1s",
                  whiteSpace: "nowrap",
                }}
                onMouseEnter={(e) => e.currentTarget.style.transform = "scale(1.03)"}
                onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1)"}
                title={topCategory?.label || "Insight"}
              >
                <span>{topCategory?.icon}</span>
                <span>{topCategory?.label}</span>
              </button>
            )}

            {/* Open follow-ups chip */}
            {hasTodos && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onInsightsClick();
                }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  padding: "3px 8px",
                  borderRadius: "10px",
                  fontSize: "0.72rem",
                  fontWeight: 500,
                  background: "#fef3c7",
                  color: "#92400e",
                  border: "1px solid #fcd34d",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
                title={`${openTodos.length} open follow-up${openTodos.length !== 1 ? "s" : ""}`}
              >
                <span>{openTodos.length} follow-up{openTodos.length !== 1 ? "s" : ""}</span>
              </button>
            )}

            {/* Badge awarded chip (persists after action) */}
            {hasBadgeAwarded && !hasInsights && !hasTodos && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  padding: "3px 8px",
                  borderRadius: "10px",
                  fontSize: "0.72rem",
                  fontWeight: 500,
                  background: "#fae8ff",
                  color: "#86198f",
                  border: "1px solid #e879f9",
                  whiteSpace: "nowrap",
                }}
              >
                <span>Badge awarded</span>
              </span>
            )}

            {/* Completed/Reviewed state when no active items */}
            {!hasInsights && !hasTodos && hasCompletedActions && !hasBadgeAwarded && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  padding: "3px 8px",
                  borderRadius: "10px",
                  fontSize: "0.72rem",
                  fontWeight: 500,
                  background: "#ecfdf5",
                  color: "#047857",
                  border: "1px solid #6ee7b7",
                  whiteSpace: "nowrap",
                }}
              >
                <span>Action taken</span>
              </span>
            )}
          </div>
        ) : (
          <span style={{ color: "#ccc" }}>—</span>
        )}
      </td>

      {/* Action */}
      <td style={{ textAlign: "center", padding: "12px 16px" }}>
        {hasStarted ? (
          <button
            onClick={() => onReview(hasInsights)}
            style={{
              padding: "6px 12px",
              background: needsAction ? "#667eea" : "transparent",
              color: needsAction ? "white" : "#64748b",
              border: needsAction ? "none" : "1px solid #e2e8f0",
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "0.8rem",
              fontWeight: needsAction ? 600 : 500,
            }}
            onMouseEnter={(e) => {
              if (!needsAction) {
                e.currentTarget.style.color = "#667eea";
                e.currentTarget.style.background = "#f5f5ff";
                e.currentTarget.style.borderColor = "#667eea";
              }
            }}
            onMouseLeave={(e) => {
              if (!needsAction) {
                e.currentTarget.style.color = "#64748b";
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.borderColor = "#e2e8f0";
              }
            }}
          >
            {needsAction ? "Review" : "View"}
          </button>
        ) : (
          <span style={{ color: "#ccc", fontSize: "0.85rem" }}>—</span>
        )}
      </td>
    </tr>
  );
}

// ============================================
// Teacher Status Badge
// ============================================

// Map ReviewState to display format (with dashes for CSS compatibility)
type TeacherStatusValue =
  | "not-started"
  | "pending-review"
  | "reviewed"
  | "followup-scheduled"
  | "resolved";

interface TeacherStatusInfo {
  primary: TeacherStatusValue;
  hasNote?: boolean;
}

/**
 * Get teacher status from reviewState (single source of truth)
 * The reviewState from the backend is now the canonical source.
 * Always returns a status — every row should render a real pill.
 */
function getTeacherStatus(
  hasStarted: boolean,
  reviewState: ReviewState,
  hasTeacherNote: boolean
): TeacherStatusInfo {
  // Map ReviewState to display format
  const stateMap: Record<ReviewState, TeacherStatusValue> = {
    "not_started": "not-started",
    "pending_review": "pending-review",
    "reviewed": "reviewed",
    "followup_scheduled": "followup-scheduled",
    "resolved": "resolved",
  };

  const mapped = stateMap[reviewState];
  if (!mapped) {
    if (process.env.NODE_ENV === "development") {
      console.warn(`Unknown reviewState: "${reviewState}" for student (hasStarted=${hasStarted})`);
    }
    // Treat any unknown value as not-started
    return { primary: "not-started", hasNote: hasTeacherNote };
  }

  return {
    primary: mapped,
    hasNote: hasTeacherNote,
  };
}

interface TeacherStatusStyle {
  bg: string;
  color: string;
  label: string;
  icon: string;
}

const TEACHER_STATUS_CONFIG: Record<TeacherStatusValue, TeacherStatusStyle> = {
  "not-started": { bg: "#f1f5f9", color: "#94a3b8", label: "Not started", icon: "" },
  "pending-review": { bg: "#fff7ed", color: "#ea580c", label: "Needs review", icon: "" },
  "reviewed": { bg: "#e8f5e9", color: "#166534", label: "Reviewed", icon: "" },
  "followup-scheduled": { bg: "#fef3c7", color: "#b45309", label: "Follow-up scheduled", icon: "" },
  "resolved": { bg: "#e8f5e9", color: "#166534", label: "Reviewed", icon: "" },
};

/** Type-safe label lookup — never returns undefined or "—" */
function getTeacherStatusLabel(value: TeacherStatusValue): string {
  return TEACHER_STATUS_CONFIG[value].label;
}

/** Type-safe style lookup for rendering status pills */
function getTeacherStatusStyle(value: TeacherStatusValue): TeacherStatusStyle {
  return TEACHER_STATUS_CONFIG[value];
}

function TeacherStatusBadge({ status }: { status: TeacherStatusInfo }) {
  const { bg, color, label, icon } = getTeacherStatusStyle(status.primary);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "4px", justifyContent: "center" }}>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
          padding: "4px 10px",
          borderRadius: "6px",
          fontSize: "0.78rem",
          background: bg,
          color: color,
          fontWeight: 500,
        }}
      >
        {icon && <span>{icon}</span>}
        {label}
      </span>
      {status.hasNote && (
        <span style={{ fontSize: "0.7rem", color: "#64748b", fontStyle: "italic" }} title="Has teacher notes">noted</span>
      )}
    </div>
  );
}

// ============================================
// Student Progress Badge
// ============================================

interface StudentProgressBadgeProps {
  isComplete: boolean;
  attempts: number;
  hasStarted: boolean;
  questionsAnswered: number;
  totalQuestions: number;
}

function StudentProgressBadge({
  isComplete,
  attempts,
  hasStarted,
  questionsAnswered,
  totalQuestions,
}: StudentProgressBadgeProps) {
  // Derive student progress status
  const completedAt = isComplete ? "completed" : undefined;
  const progressStatus: StudentProgressStatus = getStudentProgressStatus(completedAt, attempts);
  const label = STUDENT_PROGRESS_LABELS[progressStatus];
  const { bg, color } = STUDENT_PROGRESS_CONFIG[progressStatus];

  // For in-progress students, show question count
  if (!isComplete && hasStarted) {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
          padding: "4px 10px",
          borderRadius: "6px",
          fontSize: "0.78rem",
          fontWeight: 500,
          background: STUDENT_PROGRESS_CONFIG.in_progress.bg,
          color: STUDENT_PROGRESS_CONFIG.in_progress.color,
        }}
      >
        {questionsAnswered}/{totalQuestions} answered
      </span>
    );
  }

  // For submitted/resubmitted, show the status badge
  if (isComplete) {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
          padding: "4px 10px",
          borderRadius: "6px",
          fontSize: "0.78rem",
          fontWeight: 500,
          background: bg,
          color: color,
        }}
      >
        {progressStatus === "resubmitted" && <span style={{ fontWeight: 600 }}>Re:</span>}
        {label}
      </span>
    );
  }

  // Not started - show muted label
  return (
    <span
      style={{
        fontSize: "0.85rem",
        color: "#9ca3af",
      }}
    >
      {label}
    </span>
  );
}

// ActionStatusBadge removed - Teacher Status now uses reviewState as single source of truth
