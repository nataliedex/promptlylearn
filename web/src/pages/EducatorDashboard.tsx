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
  archiveLesson,
  getClasses,
  getClass,
  getLessonAssignments,
  getLessons,
  getStudents,
  getStudentCoachingInsights,
  getAssignedStudents,
  assignLessonToClass,
  getRecommendations,
  refreshRecommendations,
  dismissRecommendation,
  submitRecommendationFeedback,
  getUnassignedLessons,
  updateLessonSubject,
  getTeacherTodos,
  getTeacherTodoCounts,
  getDashboardAttentionState,
  type ComputedAssignmentState,
  type AssignmentDashboardData,
  type ClassSummary,
  type ClassWithStudents,
  type Student,
  type CoachingInsight,
  type Recommendation,
  type FeedbackType,
  type LessonSummary,
  type TeacherTodo,
  type TeacherTodoCounts,
  type StudentAttentionStatus,
  type DashboardAttentionState,
} from "../services/api";
import RecommendationPanel from "../components/RecommendationPanel";
import TeacherTodosPanel from "../components/TeacherTodosPanel";
import PendingRecommendationsPanel from "../components/PendingRecommendationsPanel";
import ArchivedRecommendationsPanel from "../components/ArchivedRecommendationsPanel";
import { useToast } from "../components/Toast";

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
  const { showError } = useToast();
  const [dashboardData, setDashboardData] = useState<AssignmentDashboardData | null>(null);
  const [classes, setClasses] = useState<ClassSummary[]>([]);
  const [allStudents, setAllStudents] = useState<Student[]>([]);
  const [assignmentClassMap, setAssignmentClassMap] = useState<Map<string, string[]>>(new Map());
  const [coachingActivity, setCoachingActivity] = useState<StudentCoachingActivity[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [pendingRecommendations, setPendingRecommendations] = useState<Recommendation[]>([]);
  const [dismissedRecommendations, setDismissedRecommendations] = useState<Recommendation[]>([]);
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);
  const [teacherTodos, setTeacherTodos] = useState<TeacherTodo[]>([]);
  const [todoCounts, setTodoCounts] = useState<TeacherTodoCounts>({ total: 0, open: 0, done: 0 });
  const [attentionState, setAttentionState] = useState<DashboardAttentionState | null>(null);
  const [unassignedLessons, setUnassignedLessons] = useState<LessonSummary[]>([]);
  const [lessonSubjects, setLessonSubjects] = useState<Map<string, string | undefined>>(new Map());
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

      const [dashData, classesData, studentsData, unassignedData, allLessonsData] = await Promise.all([
        getAssignmentDashboard(),
        getClasses(),
        getStudents(),
        getUnassignedLessons(),
        getLessons(),
      ]);

      setDashboardData(dashData);
      setClasses(classesData);
      setAllStudents(studentsData);
      setUnassignedLessons(unassignedData);

      // Build lesson subjects map
      const subjectsMap = new Map<string, string | undefined>();
      allLessonsData.forEach(lesson => {
        subjectsMap.set(lesson.id, lesson.subject);
      });
      setLessonSubjects(subjectsMap);

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
        // Load active recommendations for "What Should I Do Next?"
        const recsData = await getRecommendations({ status: "active", limit: 10 });
        setRecommendations(recsData.recommendations);

        // Load pending recommendations separately for the collapsed panel
        const pendingData = await getRecommendations({ status: "pending", limit: 20 });
        setPendingRecommendations(pendingData.recommendations);

        // Load dismissed recommendations for the archived panel
        const dismissedData = await getRecommendations({ status: "dismissed", limit: 20 });
        setDismissedRecommendations(dismissedData.recommendations);
      } catch (recErr) {
        console.log("Recommendations not available:", recErr);
        // Not critical - dashboard still works without recommendations
      }

      // Load teacher todos
      try {
        const [todosData, countsData] = await Promise.all([
          getTeacherTodos({ status: "open" }),
          getTeacherTodoCounts(),
        ]);
        setTeacherTodos(todosData.todos);
        setTodoCounts(countsData);
      } catch (todoErr) {
        console.log("Teacher todos not available:", todoErr);
        // Not critical - dashboard still works without todos
      }

      // Load attention state (single source of truth for "needs attention")
      try {
        const attention = await getDashboardAttentionState();
        setAttentionState(attention);
      } catch (attErr) {
        console.log("Attention state not available:", attErr);
        // Not critical - can fall back to session-based calculation
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
      showError("Failed to archive assignment. Please try again.");
    }
  };

  const handleArchiveUnassignedLesson = async (lessonId: string, title: string) => {
    if (!confirm(`Archive "${title}"? You can restore it later from the archived lessons.`)) {
      return;
    }

    try {
      await archiveLesson(lessonId);
      await loadData();
    } catch (err) {
      console.error("Failed to archive lesson:", err);
      showError("Failed to archive lesson. Please try again.");
    }
  };

  // Recommendation handlers
  const handleDismissRecommendation = async (id: string) => {
    try {
      const result = await dismissRecommendation(id);
      // Remove from active recommendations
      setRecommendations((prev) => prev.filter((r) => r.id !== id));
      // Add to dismissed (archived) with updated status
      if (result.recommendation) {
        setDismissedRecommendations((prev) => [result.recommendation, ...prev]);
      }
      // Refresh attention state (cascading update)
      const attention = await getDashboardAttentionState();
      setAttentionState(attention);
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
      // Refresh active recommendations
      const recsData = await getRecommendations({ status: "active", limit: 10 });
      setRecommendations(recsData.recommendations);

      // Also refresh pending
      const pendingData = await getRecommendations({ status: "pending", limit: 20 });
      setPendingRecommendations(pendingData.recommendations);

      // And refresh dismissed (archived)
      const dismissedData = await getRecommendations({ status: "dismissed", limit: 20 });
      setDismissedRecommendations(dismissedData.recommendations);

      // And refresh todos (in case actions created new ones)
      const [todosData, countsData] = await Promise.all([
        getTeacherTodos({ status: "open" }),
        getTeacherTodoCounts(),
      ]);
      setTeacherTodos(todosData.todos);
      setTodoCounts(countsData);

      // Refresh attention state (single source of truth for "needs attention")
      const attention = await getDashboardAttentionState();
      setAttentionState(attention);
    } catch (err) {
      console.error("Failed to refresh recommendations:", err);
    } finally {
      setRecommendationsLoading(false);
    }
  };

  const handleRefreshTodos = async () => {
    try {
      const [todosData, countsData] = await Promise.all([
        getTeacherTodos({ status: "open" }),
        getTeacherTodoCounts(),
      ]);
      setTeacherTodos(todosData.todos);
      setTodoCounts(countsData);
    } catch (err) {
      console.error("Failed to refresh todos:", err);
    }
  };

  const handleAssignmentSubjectChange = async (lessonId: string, subject: string | null) => {
    try {
      await updateLessonSubject(lessonId, subject);
      setLessonSubjects(prev => {
        const next = new Map(prev);
        next.set(lessonId, subject || undefined);
        return next;
      });
    } catch (err) {
      console.error("Failed to update lesson subject:", err);
      showError("Failed to update subject. Please try again.");
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

  // Use attention state (single source of truth) for students needing attention
  // This is derived from recommendations with status "active"
  const studentsNeedingAttention: StudentAttentionStatus[] = attentionState?.studentsNeedingAttention || [];

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

      {/* What Should I Do Next? - Active Recommendations */}
      <RecommendationPanel
        recommendations={recommendations}
        students={allStudents}
        onDismiss={handleDismissRecommendation}
        onFeedback={handleRecommendationFeedback}
        onRefresh={handleRefreshRecommendations}
        loading={recommendationsLoading}
      />

      {/* Pending Recommendations - Awaiting student action (collapsed) */}
      <PendingRecommendationsPanel
        recommendations={pendingRecommendations}
        onNavigate={(studentId, assignmentId) =>
          assignmentId
            ? navigate(`/educator/assignment/${assignmentId}/student/${studentId}`)
            : navigate(`/educator/student/${studentId}`)
        }
      />

      {/* Teacher To-Dos - Soft actions from checklists (collapsed) */}
      <TeacherTodosPanel
        todos={teacherTodos}
        counts={todoCounts}
        onUpdate={handleRefreshTodos}
      />

      {/* Archived - Dismissed recommendations (collapsed) */}
      <ArchivedRecommendationsPanel
        recommendations={dismissedRecommendations}
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
                No students need immediate attention or check-ins right now.
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

      {/* Unassigned Lessons */}
      {unassignedLessons.length > 0 && (
        <UnassignedLessonsSection
          lessons={unassignedLessons}
          availableSubjects={[...new Set(classes.flatMap(c => c.subjects || []))]}
          onAssign={(lessonId) => navigate(`/educator/assign-lesson?lessonId=${lessonId}`)}
          onArchive={handleArchiveUnassignedLesson}
          onSubjectChange={async (lessonId, subject) => {
            try {
              await updateLessonSubject(lessonId, subject);
              setUnassignedLessons(prev =>
                prev.map(l => l.id === lessonId ? { ...l, subject: subject || undefined } : l)
              );
            } catch (err) {
              console.error("Failed to update lesson subject:", err);
              showError("Failed to update subject. Please try again.");
            }
          }}
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
                {group.assignments.map((assignment) => {
                  // Get attention count from attention state (single source of truth)
                  const assignmentSummary = attentionState?.assignmentSummaries.find(
                    (s) => s.assignmentId === assignment.assignmentId
                  );
                  return (
                    <AssignmentCard
                      key={`${group.classId}-${assignment.assignmentId}`}
                      assignment={assignment}
                      subject={lessonSubjects.get(assignment.assignmentId)}
                      availableSubjects={[...new Set(classes.flatMap(c => c.subjects || []))]}
                      attentionCount={assignmentSummary?.needingAttentionCount}
                      onNavigate={() => navigate(`/educator/assignment/${assignment.assignmentId}`)}
                      onArchive={() => handleArchiveAssignment(assignment.assignmentId, assignment.title)}
                      onAddStudent={() => setAddStudentModal({
                        isOpen: true,
                        assignmentId: assignment.assignmentId,
                        assignmentTitle: assignment.title,
                      })}
                      onSubjectChange={(subject) => handleAssignmentSubjectChange(assignment.assignmentId, subject)}
                    />
                  );
                })}
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
// Needs Attention Section
// ============================================

interface NeedsAttentionSectionProps {
  students: StudentAttentionStatus[];
  onNavigate: (studentId: string, assignmentId: string) => void;
}

function NeedsAttentionSection({ students, onNavigate }: NeedsAttentionSectionProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Group by student to avoid showing same student multiple times
  const uniqueStudents = students.reduce((acc, student) => {
    if (!acc.find((s) => s.studentId === student.studentId)) {
      acc.push(student);
    }
    return acc;
  }, [] as StudentAttentionStatus[]);

  // Show max 5 on dashboard, or all if expanded
  const displayStudents = isExpanded ? uniqueStudents : uniqueStudents.slice(0, 5);
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
          {uniqueStudents.length} student{uniqueStudents.length !== 1 ? "s" : ""} need attention today
        </h3>
        <p style={{ margin: 0, color: "#666", marginTop: "4px" }}>
          Students who may need a check-in or additional support
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
              {student.assignmentTitle && (
                <span style={{ color: "#666", fontSize: "0.9rem" }}>{student.assignmentTitle}</span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              {student.attentionReason && (
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
                  {student.attentionReason}
                </span>
              )}
              <span style={{ color: "#ff9800" }}>→</span>
            </div>
          </div>
        ))}
      </div>

      {hasMore && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          style={{
            display: "block",
            width: "100%",
            marginTop: "12px",
            padding: "8px 16px",
            background: "transparent",
            border: "1px solid #ffcc80",
            borderRadius: "6px",
            color: "#e65100",
            fontSize: "0.9rem",
            cursor: "pointer",
            transition: "background 0.2s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "#fff8e1";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
        >
          {isExpanded
            ? "Show less"
            : `Show ${uniqueStudents.length - 5} more student${uniqueStudents.length - 5 !== 1 ? "s" : ""}`}
        </button>
      )}
    </div>
  );
}

// ============================================
// Assignment Card (Active)
// ============================================

interface AssignmentCardProps {
  assignment: ComputedAssignmentState;
  subject?: string;
  availableSubjects: string[];
  attentionCount?: number;  // From attention state - overrides session-based count
  onNavigate: () => void;
  onArchive: () => void;
  onAddStudent: () => void;
  onSubjectChange: (subject: string | null) => Promise<void>;
}

function AssignmentCard({ assignment, subject, availableSubjects, attentionCount, onNavigate, onArchive, onAddStudent, onSubjectChange }: AssignmentCardProps) {
  const { title, totalStudents, completedCount, inProgressCount, distribution, studentsNeedingSupport, studentStatuses, assignmentId } = assignment;

  // Use attention state count if available (single source of truth), otherwise fall back to session-based count
  const effectiveNeedingAttention = attentionCount !== undefined ? attentionCount : studentsNeedingSupport;
  const [editingSubject, setEditingSubject] = useState(false);
  const [subjectValue, setSubjectValue] = useState(subject || "");
  const [originalValue, setOriginalValue] = useState(subject || "");

  const handleStartEditSubject = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingSubject(true);
    setSubjectValue(subject || "");
    setOriginalValue(subject || "");
  };

  const handleSaveSubject = async () => {
    const newValue = subjectValue.trim() || null;
    const oldValue = originalValue.trim() || null;

    if (newValue !== oldValue) {
      await onSubjectChange(newValue);
    }
    setEditingSubject(false);
  };

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
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: 0, color: "#667eea" }}>{title}</h3>
          {/* Subject Badge */}
          <div style={{ marginTop: "4px" }} onClick={(e) => e.stopPropagation()}>
            {editingSubject ? (
              <input
                type="text"
                list={`subjects-${assignmentId}`}
                value={subjectValue}
                onChange={(e) => setSubjectValue(e.target.value)}
                placeholder="Enter subject..."
                style={{
                  padding: "2px 6px",
                  border: "1px solid #667eea",
                  borderRadius: "4px",
                  fontSize: "0.8rem",
                  width: "120px",
                }}
                autoFocus
                onBlur={handleSaveSubject}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.currentTarget.blur();
                  } else if (e.key === "Escape") {
                    setSubjectValue(originalValue);
                    setEditingSubject(false);
                  }
                }}
              />
            ) : (
              <button
                onClick={handleStartEditSubject}
                style={{
                  padding: "2px 8px",
                  background: subject ? "#f0f0ff" : "transparent",
                  color: subject ? "#667eea" : "#999",
                  border: "1px dashed #c5cae9",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontSize: "0.75rem",
                  transition: "all 0.2s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "#667eea";
                  e.currentTarget.style.background = "#f0f0ff";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "#c5cae9";
                  e.currentTarget.style.background = subject ? "#f0f0ff" : "transparent";
                }}
                title={subject ? "Click to change subject" : "Click to assign a subject"}
              >
                {subject || "+ Subject"}
              </button>
            )}
            <datalist id={`subjects-${assignmentId}`}>
              {availableSubjects.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
        </div>
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
        {inProgressCount > 0 && (
          <span style={{ marginLeft: "12px" }}>
            <span style={{ fontWeight: 600 }}>{inProgressCount}</span>/{totalStudents} in progress
          </span>
        )}
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

      {/* Needs Attention indicator - uses attention state (single source of truth) */}
      {effectiveNeedingAttention > 0 && (
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
          {effectiveNeedingAttention} student{effectiveNeedingAttention !== 1 ? "s" : ""} may need attention
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
  const [isExpanded, setIsExpanded] = useState(false);

  // Show support-seeking students prominently
  const supportSeeking = activities.filter((a) => a.insight.intentLabel === "support-seeking");
  const others = activities.filter((a) => a.insight.intentLabel !== "support-seeking");

  // When collapsed: show max 5 total (support-seeking first)
  // When expanded: show all
  const sortedActivities = [...supportSeeking, ...others];
  const displayActivities = isExpanded
    ? sortedActivities
    : [...supportSeeking.slice(0, 3), ...others.slice(0, Math.max(0, 5 - Math.min(3, supportSeeking.length)))];
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
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          style={{
            display: "block",
            width: "100%",
            marginTop: "12px",
            padding: "8px 16px",
            background: "transparent",
            border: "1px solid #ce93d8",
            borderRadius: "6px",
            color: "#7b1fa2",
            fontSize: "0.9rem",
            cursor: "pointer",
            transition: "background 0.2s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "#f3e5f5";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
        >
          {isExpanded
            ? "Show less"
            : `Show ${activities.length - 5} more student${activities.length - 5 !== 1 ? "s" : ""}`}
        </button>
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
  const { showError } = useToast();
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
      showError("Failed to add students. Please try again.");
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

// ============================================
// Unassigned Lessons Section
// ============================================

interface UnassignedLessonsSectionProps {
  lessons: LessonSummary[];
  availableSubjects: string[];
  onAssign: (lessonId: string) => void;
  onArchive: (lessonId: string, title: string) => void;
  onSubjectChange: (lessonId: string, subject: string | null) => Promise<void>;
}

function UnassignedLessonsSection({ lessons, availableSubjects, onAssign, onArchive, onSubjectChange }: UnassignedLessonsSectionProps) {
  const [editingSubject, setEditingSubject] = useState<string | null>(null);
  const [subjectValue, setSubjectValue] = useState("");
  const [originalValue, setOriginalValue] = useState("");

  const handleStartEditSubject = (lessonId: string, currentSubject?: string) => {
    setEditingSubject(lessonId);
    setSubjectValue(currentSubject || "");
    setOriginalValue(currentSubject || "");
  };

  const handleSaveSubject = async (lessonId: string) => {
    const newValue = subjectValue.trim() || null;
    const oldValue = originalValue.trim() || null;

    // Only save if value actually changed
    if (newValue !== oldValue) {
      await onSubjectChange(lessonId, newValue);
    }
    setEditingSubject(null);
    setSubjectValue("");
    setOriginalValue("");
  };

  return (
    <div
      className="card"
      style={{
        marginTop: "16px",
        background: "#e3f2fd",
        borderLeft: "4px solid #2196f3",
      }}
    >
      <div style={{ marginBottom: "16px" }}>
        <h3 style={{ margin: 0, color: "#1565c0" }}>
          Unassigned Lessons ({lessons.length})
        </h3>
        <p style={{ margin: 0, color: "#666", marginTop: "4px" }}>
          Lessons created but not yet assigned to any class
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {lessons.map((lesson) => (
          <div
            key={lesson.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 16px",
              background: "white",
              borderRadius: "8px",
              flexWrap: "wrap",
              gap: "8px",
            }}
          >
            <div style={{ flex: 1, minWidth: "200px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                <span style={{ fontWeight: 600, color: "#333" }}>{lesson.title}</span>
                <span
                  style={{
                    fontSize: "0.75rem",
                    padding: "2px 8px",
                    borderRadius: "4px",
                    background: lesson.difficulty === "beginner" ? "#e8f5e9" :
                               lesson.difficulty === "intermediate" ? "#fff3e0" : "#ffebee",
                    color: lesson.difficulty === "beginner" ? "#2e7d32" :
                           lesson.difficulty === "intermediate" ? "#ed6c02" : "#d32f2f",
                  }}
                >
                  {lesson.difficulty}
                </span>
              </div>
              <p style={{ margin: 0, marginTop: "4px", color: "#666", fontSize: "0.85rem" }}>
                {lesson.promptCount} question{lesson.promptCount !== 1 ? "s" : ""}
                {lesson.gradeLevel && ` • ${lesson.gradeLevel}`}
              </p>
            </div>

            {/* Subject Assignment */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              {editingSubject === lesson.id ? (
                <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <input
                    type="text"
                    list={`subjects-${lesson.id}`}
                    value={subjectValue}
                    onChange={(e) => setSubjectValue(e.target.value)}
                    placeholder="Enter subject..."
                    style={{
                      padding: "4px 8px",
                      border: "1px solid #2196f3",
                      borderRadius: "4px",
                      fontSize: "0.85rem",
                      width: "140px",
                    }}
                    autoFocus
                    onBlur={() => handleSaveSubject(lesson.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.currentTarget.blur();
                      } else if (e.key === "Escape") {
                        setSubjectValue(originalValue);
                        setEditingSubject(null);
                      }
                    }}
                  />
                  <datalist id={`subjects-${lesson.id}`}>
                    {availableSubjects.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </div>
              ) : (
                <button
                  onClick={() => handleStartEditSubject(lesson.id, lesson.subject)}
                  style={{
                    padding: "4px 10px",
                    background: lesson.subject ? "#e3f2fd" : "transparent",
                    color: lesson.subject ? "#1565c0" : "#999",
                    border: "1px dashed #90caf9",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "0.8rem",
                    transition: "all 0.2s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "#2196f3";
                    e.currentTarget.style.background = "#e3f2fd";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "#90caf9";
                    e.currentTarget.style.background = lesson.subject ? "#e3f2fd" : "transparent";
                  }}
                  title={lesson.subject ? "Click to change subject" : "Click to assign a subject"}
                >
                  {lesson.subject || "+ Subject"}
                </button>
              )}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <button
                onClick={() => onAssign(lesson.id)}
                style={{
                  padding: "6px 12px",
                  background: "#2196f3",
                  color: "white",
                  border: "none",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                  fontWeight: 500,
                  transition: "background 0.2s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#1976d2";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "#2196f3";
                }}
              >
                Assign
              </button>
              <button
                onClick={() => onArchive(lesson.id, lesson.title)}
                style={{
                  padding: "6px 12px",
                  background: "transparent",
                  color: "#999",
                  border: "1px solid #ddd",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                  transition: "color 0.2s, border-color 0.2s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "#666";
                  e.currentTarget.style.borderColor = "#bbb";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "#999";
                  e.currentTarget.style.borderColor = "#ddd";
                }}
              >
                Archive
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
