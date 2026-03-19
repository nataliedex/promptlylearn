/**
 * Student Details - Enhanced View
 *
 * Design Philosophy:
 * - Summary tiles for quick understanding of student progress
 * - Open assignments (needs attention) vs completed & reviewed
 * - Coaching insights showing support-seeking vs enrichment-seeking patterns
 */

import { useState, useEffect, useMemo } from "react";
import { useParams, Link, useNavigate, useLocation } from "react-router-dom";
import EducatorAppHeader from "../components/EducatorAppHeader";
import StudentProfileDrawer from "../components/StudentProfileDrawer";
import {
  getStudent,
  getSessions,
  getLessons,
  getStudentCoachingInsights,
  getStudentAssignments,
  getRecommendations,
  dismissRecommendation,
  submitRecommendationFeedback,
  getBadgeTypes,
  submitChecklistActions,
  createCoachingInvite,
  getChecklistActionsForCategory,
  getTeacherTodos,
  completeTeacherTodo,
  getStudentProfileFull,
  CHECKLIST_ACTIONS,
  type Student,
  type CoachingInsight,
  type Recommendation,
  type BadgeTypeInfo,
  type FeedbackType,
  type ChecklistActionKey,
  type TeacherTodo,
  type ReviewState,
  type StudentProfileFull,
} from "../services/api";
import {
  deriveUnderstanding,
  deriveCoachSupport,
  getUnderstandingLabel,
  getUnderstandingColor,
  getUnderstandingBgColor,
} from "../utils/teacherDashboardUtils";
import type { UnderstandingLevel, CoachSupportLevel } from "../types/teacherDashboard";

interface StudentAssignment {
  lessonId: string;
  lessonTitle: string;
  subject?: string;
  isComplete: boolean;
  questionsAnswered: number;
  totalQuestions: number;
  understanding: UnderstandingLevel;
  coachSupport: CoachSupportLevel;
  completedAt?: string;
  assignedAt?: string;
  dueDate?: string;
  hasTeacherNote: boolean;
  reviewState: ReviewState;
  attempts: number;
  lastWorkedAt?: string;
}

export default function StudentDetails() {
  const { studentId } = useParams<{ studentId: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  // Navigation context for breadcrumbs
  const navigationState = location.state as {
    fromClass?: string;
    className?: string;
    fromAssignment?: string;
    assignmentTitle?: string;
  } | null;

  const fromAssignmentId = navigationState?.fromAssignment;
  const fromAssignmentTitle = navigationState?.assignmentTitle;

  const [student, setStudent] = useState<Student | null>(null);
  const [studentProfile, setStudentProfile] = useState<StudentProfileFull | null>(null);
  const [studentCode, setStudentCode] = useState<string | undefined>();
  const [assignments, setAssignments] = useState<StudentAssignment[]>([]);
  const [coachingInsights, setCoachingInsights] = useState<CoachingInsight | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [badgeTypes, setBadgeTypes] = useState<BadgeTypeInfo[]>([]);
  const [studentTodos, setStudentTodos] = useState<TeacherTodo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showProfileDrawer, setShowProfileDrawer] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!studentId) return;

    async function loadData() {
      try {
        const [studentData, sessions, lessons, insights, recsResponse, badgesResponse, todosResponse, assignmentsResponse, profileResponse] = await Promise.all([
          getStudent(studentId!),
          getSessions(studentId),
          getLessons(),
          getStudentCoachingInsights(studentId!),
          getRecommendations({ studentId: studentId!, status: "active" }),
          getBadgeTypes(),
          getTeacherTodos({ studentId: studentId!, status: "open" }),
          getStudentAssignments(studentId!),
          getStudentProfileFull(studentId!),
        ]);

        setStudent(studentData);
        setStudentProfile(profileResponse.profile);
        setStudentCode(profileResponse.student.studentCode);
        setCoachingInsights(insights);
        setRecommendations(recsResponse.recommendations);
        setBadgeTypes(badgesResponse.badgeTypes);
        setStudentTodos(todosResponse.todos);

        // Build a map of lessons by id for quick lookup
        const lessonMap = new Map(lessons.map(l => [l.id, l]));

        // Build assignment list — ONLY for lessons that have a StudentAssignment record.
        // This prevents unassigned lessons from leaking into the student view.
        const assignmentList: StudentAssignment[] = [];

        for (const assignmentRecord of assignmentsResponse.assignments) {
          const lesson = lessonMap.get(assignmentRecord.lessonId);
          if (!lesson) continue; // Lesson file may have been deleted

          const session = sessions.find((s) => s.lessonId === lesson.id);

          if (session) {
            // Student has attempted this assignment
            const score = session.evaluation?.totalScore ?? 0;
            const understanding = deriveUnderstanding(score);
            const coachSupport = deriveCoachSupport(session.submission.responses);

            assignmentList.push({
              lessonId: lesson.id,
              lessonTitle: lesson.title,
              subject: lesson.subject,
              isComplete: session.status === "completed",
              questionsAnswered: session.submission.responses.length,
              totalQuestions: lesson.promptCount,
              understanding,
              coachSupport,
              completedAt: session.completedAt,
              assignedAt: assignmentRecord.assignedAt,
              dueDate: assignmentRecord.dueDate,
              hasTeacherNote: !!session.educatorNotes,
              reviewState: assignmentRecord.reviewState || (session.completedAt ? "pending_review" : "not_started"),
              attempts: assignmentRecord.attempts || 1,
              lastWorkedAt: session.completedAt || session.startedAt || assignmentRecord.assignedAt,
            });
          } else {
            // No session found — use assignment record's own completion data as fallback
            const isCompletedByRecord = !!assignmentRecord.completedAt;
            assignmentList.push({
              lessonId: lesson.id,
              lessonTitle: lesson.title,
              subject: lesson.subject,
              isComplete: isCompletedByRecord,
              questionsAnswered: isCompletedByRecord ? lesson.promptCount : 0,
              totalQuestions: lesson.promptCount,
              understanding: isCompletedByRecord ? "developing" : "needs-support",
              coachSupport: "minimal",
              completedAt: assignmentRecord.completedAt,
              assignedAt: assignmentRecord.assignedAt,
              dueDate: assignmentRecord.dueDate,
              hasTeacherNote: false,
              reviewState: assignmentRecord.reviewState || (isCompletedByRecord ? "pending_review" : "not_started"),
              attempts: assignmentRecord.attempts || (isCompletedByRecord ? 1 : 0),
              lastWorkedAt: assignmentRecord.completedAt || undefined,
            });
          }
        }

        setAssignments(assignmentList);
      } catch (err) {
        console.error("Failed to load student details:", err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [studentId, refreshKey]);

  // Reload recommendations
  const reloadRecommendations = async () => {
    if (!studentId) return;
    try {
      const recsResponse = await getRecommendations({ studentId, status: "active" });
      setRecommendations(recsResponse.recommendations);
    } catch (err) {
      console.error("Failed to reload recommendations:", err);
    }
  };

  // Handle dismiss recommendation
  const handleDismissRecommendation = async (recId: string) => {
    try {
      await dismissRecommendation(recId);
      await reloadRecommendations();
    } catch (err) {
      console.error("Failed to dismiss recommendation:", err);
    }
  };

  // Handle feedback
  const handleRecommendationFeedback = async (recId: string, feedback: FeedbackType) => {
    try {
      await submitRecommendationFeedback(recId, feedback);
      await reloadRecommendations();
    } catch (err) {
      console.error("Failed to submit feedback:", err);
    }
  };

  // Reload student todos
  const reloadStudentTodos = async () => {
    if (!studentId) return;
    try {
      const todosResponse = await getTeacherTodos({ studentId, status: "open" });
      setStudentTodos(todosResponse.todos);
    } catch (err) {
      console.error("Failed to reload student todos:", err);
    }
  };

  // Handle completing a todo (also resolves the associated recommendation)
  const handleCompleteTodo = async (todoId: string) => {
    try {
      await completeTeacherTodo(todoId);
      // Reload both todos and recommendations since completing a todo resolves the recommendation
      await Promise.all([reloadStudentTodos(), reloadRecommendations()]);
    } catch (err) {
      console.error("Failed to complete todo:", err);
    }
  };

  // Filter student todos to max 3 open items for this student
  const filteredStudentTodos = useMemo(() => {
    return studentTodos
      .filter((todo) => {
        // Only open todos
        if (todo.status !== "open") return false;
        // Must be for this student
        if (!todo.studentIds?.includes(studentId!)) return false;
        return true;
      })
      .slice(0, 3); // Max 3 items
  }, [studentTodos, studentId]);

  // Define allowed categories for student-scoped recommendations (actionable only)
  // Excludes: Acknowledge Progress (informational), reviewed, administrative
  const ALLOWED_CATEGORIES = ["needs-support", "check-in-suggested", "challenge-opportunity"];

  // Helper function to get category key from recommendation
  const getCategoryKey = (rec: Recommendation): string => {
    const ruleName = rec.triggerData?.ruleName || "";
    const insightType: string = rec.insightType || rec.type;

    switch (ruleName) {
      case "notable-improvement":
        return "celebrate-progress";
      case "ready-for-challenge":
        return "challenge-opportunity";
      case "check-in-suggested":
        return "check-in-suggested";
      case "needs-support":
        return "needs-support";
      case "developing":
        return "developing";
      case "group-support":
        return "group-review";
      case "watch-progress":
        return "administrative";
    }

    switch (insightType) {
      case "celebrate_progress":
      case "celebrate":
        return "celebrate-progress";
      case "challenge_opportunity":
      case "enrichment":
        return "challenge-opportunity";
      case "monitor":
      case "assignment-adjustment":
        return "administrative";
      case "check_in":
      case "individual-checkin":
        return "needs-support";
      case "small-group":
        return "group-review";
    }

    return "needs-support";
  };

  // Filter and sort recommendations for this student
  const filteredRecommendations = useMemo(() => {
    return recommendations
      .filter((rec) => {
        // Only active, not reviewed
        if (rec.status !== "active") return false;
        // Must include this student
        if (!rec.studentIds.includes(studentId!)) return false;
        // Must be in allowed categories
        const category = getCategoryKey(rec);
        return ALLOWED_CATEGORIES.includes(category);
      })
      .sort((a, b) => {
        // Sort by priority: high > medium > low
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        return (priorityOrder[a.priorityLevel] || 2) - (priorityOrder[b.priorityLevel] || 2);
      })
      .slice(0, 2); // Max 2 items
  }, [recommendations, studentId]);

  // Check if there are additional recommendations at assignment level
  const hasAdditionalAssignmentRecommendations = useMemo(() => {
    const total = recommendations.filter((rec) => {
      if (rec.status !== "active") return false;
      if (!rec.studentIds.includes(studentId!)) return false;
      const category = getCategoryKey(rec);
      return ALLOWED_CATEGORIES.includes(category);
    }).length;
    return total > 2;
  }, [recommendations, studentId]);

  // Compute student learning snapshot (must be before early returns)
  const snapshot = useMemo(() => computeStudentSnapshot(assignments), [assignments]);

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
        <EducatorAppHeader
          mode="slim"
          breadcrumbs={[
            ...(fromAssignmentTitle ? [{ label: fromAssignmentTitle, to: `/educator/assignment/${fromAssignmentId}` }] : []),
            { label: "Student not found" },
          ]}
        />
        <div className="card">
          <p>Student not found.</p>
          <Link to="/educator" className="btn btn-primary" style={{ marginTop: "16px" }}>
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <EducatorAppHeader
        mode="slim"
        breadcrumbs={[
          ...(fromAssignmentTitle ? [{ label: fromAssignmentTitle, to: `/educator/assignment/${fromAssignmentId}` }] : []),
          { label: student.name },
        ]}
        primaryActions={
          <button
            onClick={() => setShowProfileDrawer(true)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 12px",
              fontSize: "0.8rem",
              background: "transparent",
              color: "var(--text-secondary)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "6px",
              cursor: "pointer",
              fontWeight: 500,
              whiteSpace: "nowrap",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--surface-accent)";
              e.currentTarget.style.color = "var(--text-primary)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "var(--text-secondary)";
            }}
          >
            Edit Profile
          </button>
        }
      />

      {/* Contextual back link (only when navigated from an assignment) */}
      {fromAssignmentTitle && fromAssignmentId && (
        <Link
          to={`/educator/assignment/${fromAssignmentId}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            fontSize: "0.85rem",
            color: "var(--text-secondary)",
            textDecoration: "none",
            marginBottom: "12px",
            transition: "color 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "var(--text-primary)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "var(--text-secondary)";
          }}
        >
          <span style={{ fontSize: "0.8rem" }}>←</span>
          Back to {fromAssignmentTitle}
        </Link>
      )}

      {/* Header */}
      <div className="header">
        <h1 style={{ marginBottom: "4px" }}>{student.name}</h1>
        {studentProfile?.preferredName && studentProfile.preferredName !== student.name && (
          <p style={{ margin: "0 0 4px 0", fontSize: "0.95rem", color: "var(--text-secondary)" }}>
            Goes by <strong>{studentProfile.preferredName}</strong>
            {studentProfile.pronouns && ` (${studentProfile.pronouns})`}
          </p>
        )}
        {!studentProfile?.preferredName && studentProfile?.pronouns && (
          <p style={{ margin: "0 0 4px 0", fontSize: "0.95rem", color: "var(--text-secondary)" }}>
            {studentProfile.pronouns}
          </p>
        )}
        <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--text-muted)" }}>
          {studentCode && <span>ID: {studentCode} · </span>}
          Joined {new Date(student.createdAt).toLocaleDateString()}
        </p>
      </div>

      {/* Learning Preferences */}
      {studentProfile && (
        <div
          style={{
            display: "flex",
            gap: "12px",
            flexWrap: "wrap",
            marginBottom: "16px",
            padding: "12px 16px",
            background: "#f8fafc",
            borderRadius: "8px",
            border: "1px solid #e2e8f0",
          }}
        >
          {studentProfile.gradeLevel && (
            <div style={{ fontSize: "0.85rem", color: "#64748b" }}>
              <span style={{ fontWeight: 500, color: "#475569" }}>Grade:</span> {studentProfile.gradeLevel}
            </div>
          )}
          {studentProfile.inputPreference && studentProfile.inputPreference !== "no_preference" && (
            <div style={{ fontSize: "0.85rem", color: "#64748b" }}>
              <span style={{ fontWeight: 500, color: "#475569" }}>Input:</span>{" "}
              {studentProfile.inputPreference === "typing" ? "Typing" : studentProfile.inputPreference === "voice" ? "Voice" : "No preference"}
            </div>
          )}
          {studentProfile.pacePreference && (
            <div style={{ fontSize: "0.85rem", color: "#64748b" }}>
              <span style={{ fontWeight: 500, color: "#475569" }}>Pace:</span>{" "}
              {studentProfile.pacePreference === "take_my_time" ? "Takes their time" : "Works quickly"}
            </div>
          )}
          {studentProfile.coachHelpStyle && (
            <div style={{ fontSize: "0.85rem", color: "#64748b" }}>
              <span style={{ fontWeight: 500, color: "#475569" }}>Coach style:</span>{" "}
              {studentProfile.coachHelpStyle === "hints_first" ? "Hints first" : studentProfile.coachHelpStyle === "direct_help" ? "Direct help" : "Encouraging"}
            </div>
          )}
          {studentProfile.accommodations && (studentProfile.accommodations.extraTime || studentProfile.accommodations.readAloud || studentProfile.accommodations.reducedDistractions) && (
            <div style={{ fontSize: "0.85rem", color: "#64748b" }}>
              <span style={{ fontWeight: 500, color: "#475569" }}>Accommodations:</span>{" "}
              {[
                studentProfile.accommodations.extraTime && "Extra time",
                studentProfile.accommodations.readAloud && "Read aloud",
                studentProfile.accommodations.reducedDistractions && "Reduced distractions",
              ].filter(Boolean).join(", ")}
            </div>
          )}
        </div>
      )}

      {/* Student Learning Snapshot */}
      <StudentLearningSnapshot snapshot={snapshot} />

      {/* Student-Scoped Recommendations */}
      <StudentRecommendationsSection
        recommendations={filteredRecommendations}
        studentName={student.name}
        badgeTypes={badgeTypes}
        hasMoreOnAssignments={hasAdditionalAssignmentRecommendations}
        todos={filteredStudentTodos}
        onDismiss={handleDismissRecommendation}
        onFeedback={handleRecommendationFeedback}
        onActionComplete={reloadRecommendations}
        onCompleteTodo={handleCompleteTodo}
      />

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
            <span style={{ fontSize: "0.85rem", fontWeight: 600, color: coachingInsights.intentLabel === "support-seeking" ? "#e65100" : coachingInsights.intentLabel === "enrichment-seeking" ? "#2e7d32" : "#666" }}>
              {coachingInsights.intentLabel === "support-seeking" ? "Support" :
               coachingInsights.intentLabel === "enrichment-seeking" ? "Enrichment" : "Mixed"}
            </span>
            <div>
              <h3 style={{ margin: 0, color: "#333" }}>Coaching Insights</h3>
              <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--text-secondary)" }}>
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
            <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--text-secondary)" }}>
              Recent topics: {coachingInsights.recentTopics.join(", ")}
            </p>
          )}
          {coachingInsights.lastCoachSessionAt && (
            <p style={{ margin: "4px 0 0 0", fontSize: "0.85rem", color: "var(--text-muted)" }}>
              Last session: {new Date(coachingInsights.lastCoachSessionAt).toLocaleDateString()}
            </p>
          )}
        </div>
      )}

      {/* Recent Work Table */}
      <div style={{ marginTop: "32px", marginBottom: "24px" }}>
        <h3 style={{ margin: "0 0 12px 0", color: "var(--text-primary)", fontSize: "1rem", fontWeight: 600 }}>
          Recent Work
        </h3>

        {assignments.length === 0 ? (
          <div className="card" style={{ textAlign: "center", padding: "32px" }}>
            <p style={{ color: "var(--text-secondary)", margin: 0 }}>No assignments yet.</p>
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f8f9fa", borderBottom: "1px solid #e8e8e8" }}>
                  <th style={{ textAlign: "left", padding: "10px 16px", fontWeight: 500, color: "var(--text-muted)", fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                    Assignment
                  </th>
                  <th style={{ textAlign: "center", padding: "10px 12px", fontWeight: 500, color: "var(--text-muted)", fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                    Status
                  </th>
                  <th style={{ textAlign: "center", padding: "10px 12px", fontWeight: 500, color: "var(--text-muted)", fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                    Understanding
                  </th>
                  <th style={{ textAlign: "center", padding: "10px 12px", fontWeight: 500, color: "var(--text-muted)", fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                    Attempts
                  </th>
                  <th style={{ textAlign: "center", padding: "10px 12px", fontWeight: 500, color: "var(--text-muted)", fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                    Last Worked
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...assignments]
                  .sort((a, b) => {
                    // Needs review first, then in progress, then not started, then reviewed
                    const statusOrder: Record<ReviewState, number> = {
                      pending_review: 0,
                      not_started: 1,
                      reviewed: 2,
                      followup_scheduled: 3,
                      resolved: 4,
                    };
                    const aOrder = a.questionsAnswered > 0 && !a.isComplete ? 0.5 : (statusOrder[a.reviewState] ?? 5);
                    const bOrder = b.questionsAnswered > 0 && !b.isComplete ? 0.5 : (statusOrder[b.reviewState] ?? 5);
                    if (aOrder !== bOrder) return aOrder - bOrder;
                    // Then by most recent
                    const aDate = a.lastWorkedAt ? new Date(a.lastWorkedAt).getTime() : 0;
                    const bDate = b.lastWorkedAt ? new Date(b.lastWorkedAt).getTime() : 0;
                    return bDate - aDate;
                  })
                  .map((assignment) => {
                    const statusLabel = assignment.isComplete && assignment.reviewState === "pending_review"
                      ? "Needs review"
                      : !assignment.isComplete && assignment.questionsAnswered > 0
                      ? "In progress"
                      : assignment.questionsAnswered === 0
                      ? "Not started"
                      : assignment.reviewState === "reviewed" || assignment.reviewState === "resolved"
                      ? "Completed"
                      : assignment.reviewState === "followup_scheduled"
                      ? "Follow-up"
                      : "Completed";

                    const statusColor = statusLabel === "Needs review"
                      ? { bg: "#fef3c7", color: "#92400e" }
                      : statusLabel === "In progress"
                      ? { bg: "#e0f2fe", color: "#0369a1" }
                      : statusLabel === "Not started"
                      ? { bg: "#f5f5f5", color: "#64748b" }
                      : statusLabel === "Follow-up"
                      ? { bg: "#fef3c7", color: "#92400e" }
                      : { bg: "#e8f5e9", color: "#166534" };

                    return (
                      <tr
                        key={assignment.lessonId}
                        onClick={() =>
                          navigate(`/educator/assignment/${assignment.lessonId}/student/${studentId}`, {
                            state: { fromStudent: studentId, studentName: student.name },
                          })
                        }
                        style={{ borderBottom: "1px solid #f1f5f9", cursor: "pointer" }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "#f8fafc"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                      >
                        <td style={{ padding: "12px 16px" }}>
                          <div style={{ fontWeight: 600, fontSize: "0.9rem", color: "#1e293b" }}>{assignment.lessonTitle}</div>
                        </td>
                        <td style={{ padding: "12px", textAlign: "center" }}>
                          <span style={{
                            padding: "3px 10px",
                            borderRadius: "10px",
                            fontSize: "0.78rem",
                            fontWeight: 500,
                            background: statusColor.bg,
                            color: statusColor.color,
                            whiteSpace: "nowrap",
                          }}>
                            {statusLabel}
                          </span>
                        </td>
                        <td style={{ padding: "12px", textAlign: "center" }}>
                          {assignment.questionsAnswered > 0 ? (
                            <span style={{
                              padding: "3px 10px",
                              borderRadius: "10px",
                              fontSize: "0.78rem",
                              fontWeight: 500,
                              background: getUnderstandingBgColor(assignment.understanding),
                              color: getUnderstandingColor(assignment.understanding),
                              whiteSpace: "nowrap",
                            }}>
                              {getUnderstandingLabel(assignment.understanding)}
                            </span>
                          ) : (
                            <span style={{ color: "#94a3b8", fontSize: "0.82rem" }}>—</span>
                          )}
                        </td>
                        <td style={{ padding: "12px", textAlign: "center", fontSize: "0.85rem", color: "#475569" }}>
                          {assignment.attempts || "—"}
                        </td>
                        <td style={{ padding: "12px", textAlign: "center", fontSize: "0.82rem", color: "#64748b", whiteSpace: "nowrap" }}>
                          {assignment.lastWorkedAt
                            ? new Date(assignment.lastWorkedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Student Profile Drawer */}
      <StudentProfileDrawer
        isOpen={showProfileDrawer}
        onClose={() => setShowProfileDrawer(false)}
        onSave={() => setRefreshKey((k) => k + 1)}
        studentId={studentId!}
        studentName={student.name}
      />
    </div>
  );
}

// ============================================
// Assignment Row Component (matches EducatorDashboard pattern)
// ============================================

type StudentAssignmentPriority = "needs-attention" | "in-progress" | "awaiting-submissions" | "reviewed";

interface StudentAssignmentRowProps {
  assignment: StudentAssignment;
  priority: StudentAssignmentPriority;
  onNavigate: () => void;
}

function StudentAssignmentRow({ assignment, priority, onNavigate }: StudentAssignmentRowProps) {
  const getDotColor = () => {
    switch (priority) {
      case "needs-attention":
        return "#f59e0b"; // Orange
      case "awaiting-submissions":
        return "#94a3b8"; // Gray
      case "in-progress":
      case "reviewed":
        return "#10b981"; // Green
    }
  };

  const getCTA = () => {
    switch (priority) {
      case "needs-attention":
      case "in-progress":
        return "Review";
      case "awaiting-submissions":
      case "reviewed":
        return "View";
    }
  };

  const getDotTitle = () => {
    switch (priority) {
      case "needs-attention":
        return "Needs attention";
      case "awaiting-submissions":
        return "Awaiting submissions";
      case "in-progress":
        return "In progress";
      case "reviewed":
        return "Reviewed";
    }
  };

  // Build secondary text: subject + progress/date + understanding
  const parts: string[] = [];
  if (assignment.subject) parts.push(assignment.subject);
  if (assignment.isComplete) {
    if (assignment.completedAt) {
      const d = new Date(assignment.completedAt);
      parts.push(`Completed ${d.toLocaleDateString("en-US", { month: "short" })} ${d.getDate()}`);
    } else {
      parts.push("Completed");
    }
  } else if (assignment.questionsAnswered > 0) {
    parts.push(`${assignment.questionsAnswered}/${assignment.totalQuestions} questions`);
  } else if (assignment.assignedAt) {
    const d = new Date(assignment.assignedAt);
    parts.push(`Assigned ${d.toLocaleDateString("en-US", { month: "short" })} ${d.getDate()}`);
  } else {
    parts.push(`${assignment.totalQuestions} questions`);
  }
  if (assignment.questionsAnswered > 0) {
    parts.push(getUnderstandingLabel(assignment.understanding));
  }
  const secondaryText = parts.join(" · ");

  return (
    <div
      onClick={onNavigate}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "16px",
        padding: "16px 20px",
        background: "#ffffff",
        borderBottom: "1px solid rgba(0, 0, 0, 0.06)",
        cursor: "pointer",
        transition: "background 0.15s",
        height: "64px",
        boxSizing: "border-box",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "#ffffff";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "#ffffff";
      }}
    >
      {/* Status dot */}
      <div
        title={getDotTitle()}
        style={{
          width: "10px",
          height: "10px",
          borderRadius: "50%",
          background: getDotColor(),
          flexShrink: 0,
        }}
      />

      {/* Title and metadata stacked */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: "1rem",
            fontWeight: 600,
            color: "#1e293b",
            lineHeight: 1.3,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {assignment.lessonTitle}
        </div>
        <div
          style={{
            fontSize: "0.85rem",
            color: "#64748b",
            marginTop: "2px",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {secondaryText}
        </div>
      </div>

      {/* Single primary action */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onNavigate();
        }}
        style={{
          flex: "0 0 auto",
          padding: "8px 20px",
          background: priority === "needs-attention" ? "#3d5a80" : "transparent",
          color: priority === "needs-attention" ? "white" : "#3d5a80",
          border: priority === "needs-attention" ? "none" : "1px solid #cbd5e1",
          borderRadius: "6px",
          fontSize: "0.875rem",
          fontWeight: 500,
          cursor: "pointer",
          whiteSpace: "nowrap",
          transition: "all 0.15s",
        }}
        onMouseEnter={(e) => {
          if (priority !== "needs-attention") {
            e.currentTarget.style.background = "#f8fafc";
            e.currentTarget.style.borderColor = "#3d5a80";
          }
        }}
        onMouseLeave={(e) => {
          if (priority !== "needs-attention") {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.borderColor = "#cbd5e1";
          }
        }}
      >
        {getCTA()}
      </button>
    </div>
  );
}

// ============================================
// Student Learning Snapshot
// ============================================

type OverallLevel = "strong" | "developing" | "needs-support" | "no-data";
type TrendLevel = "improving" | "steady" | "declining" | "inconsistent" | "no-data";
type SupportLevel = "none" | "check-in" | "follow-up" | "no-data";
type WorkStatusLevel = "on-track" | "pending" | "at-risk" | "no-data";

interface StudentSnapshot {
  overall: OverallLevel;
  trend: TrendLevel;
  supportNeeded: SupportLevel;
  workStatus: WorkStatusLevel;
  workStatusDetail: string;
  openCount: number;
  strengths: string;
  watchAreas: string;
  momentum: string;
}

// ============================================
// Next Steps Engine
// ============================================

type NextStepPriority = "low" | "medium" | "high";

interface NextStep {
  label: string;
  message: string;
  priority: NextStepPriority;
}

function getNextStep(snapshot: StudentSnapshot): NextStep {
  // HIGH: overdue work
  if (snapshot.workStatus === "at-risk") {
    return {
      label: "Immediate check-in",
      message: "Overdue work is piling up — prioritize this student",
      priority: "high",
    };
  }

  // MEDIUM: struggling student
  if (snapshot.overall === "needs-support") {
    return {
      label: "Provide support",
      message: "Student is struggling — schedule 1:1 support",
      priority: "medium",
    };
  }

  // MEDIUM: too many open assignments
  if (snapshot.workStatus === "pending" && snapshot.openCount >= 3) {
    return {
      label: "Check-in recommended",
      message: `${snapshot.openCount} assignments still open — check engagement`,
      priority: "medium",
    };
  }

  // LOW: strong but has pending work
  if (snapshot.overall === "strong" && snapshot.workStatus === "pending") {
    return {
      label: "Light check-in",
      message: "Strong performance — keep assignments moving",
      priority: "low",
    };
  }

  // DEFAULT
  return {
    label: "No action needed",
    message: "On track",
    priority: "low",
  };
}

/**
 * Compute a narrative snapshot from student assignment data.
 * Uses rule-based logic to derive strengths, watch areas, and momentum.
 * Groups by subject (not assignment title) for cleaner output.
 */
function computeStudentSnapshot(assignments: StudentAssignment[]): StudentSnapshot {
  // Filter to completed assignments (isComplete only — do NOT require reviewState === "reviewed")
  const completed = assignments.filter((a) => a.isComplete);

  // Also track assignments with any activity (for strengths/watch areas)
  const withActivity = assignments.filter((a) => a.questionsAnswered > 0 || a.isComplete);

  // Sort completed by date (most recent first), fallback to lastWorkedAt
  const recentCompleted = [...completed]
    .sort((a, b) => {
      const dateA = new Date(a.completedAt || a.lastWorkedAt || 0).getTime();
      const dateB = new Date(b.completedAt || b.lastWorkedAt || 0).getTime();
      return dateB - dateA;
    })
    .slice(0, 5); // Last 5 completed

  // Debug logging — temporary
  console.log("[snapshot] total assignments:", assignments.length);
  console.log("[snapshot] completed (isComplete):", completed.length);
  console.log("[snapshot] recentCompleted:", recentCompleted.map(a => ({
    title: a.lessonTitle,
    isComplete: a.isComplete,
    understanding: a.understanding,
    completedAt: a.completedAt,
    reviewState: a.reviewState,
  })));

  // ============================================
  // Group by Subject (not lesson title)
  // ============================================
  const bySubject: Record<string, StudentAssignment[]> = {};
  withActivity.forEach((a) => {
    // Use subject if available, otherwise fall back to a generic label
    const key = a.subject || "General";
    if (!bySubject[key]) bySubject[key] = [];
    bySubject[key].push(a);
  });

  // ============================================
  // Compute Strengths
  // ============================================
  const strengthSubjects: string[] = [];

  // Find subjects where student is consistently strong or has good outcomes with low coach support
  Object.entries(bySubject).forEach(([subject, assigns]) => {
    const strongAssigns = assigns.filter((a) => a.understanding === "strong");
    const lowCoachGoodOutcome = assigns.filter(
      (a) => (a.understanding === "strong" || a.understanding === "developing") &&
             (a.coachSupport === "none" || a.coachSupport === "minimal")
    );

    if (strongAssigns.length >= 1 && strongAssigns.length === assigns.length) {
      // Consistently strong in this subject
      if (!strengthSubjects.includes(subject)) {
        strengthSubjects.push(subject);
      }
    } else if (lowCoachGoodOutcome.length >= 2) {
      // Good outcomes with low coach support
      if (!strengthSubjects.includes(subject)) {
        strengthSubjects.push(subject);
      }
    }
  });

  // Check for consistent completion pattern
  const hasConsistentCompletion = completed.length >= 3;

  // Build strengths string with specific, actionable language
  let strengths: string;
  if (strengthSubjects.length === 0 && !hasConsistentCompletion) {
    if (withActivity.length === 0) {
      strengths = "No completed work yet.";
    } else if (withActivity.length === 1) {
      const a = withActivity[0];
      if (a.understanding === "strong") {
        strengths = `Strong on ${a.subject || a.lessonTitle} — need more data to confirm.`;
      } else {
        strengths = "One assignment completed — more needed to identify strengths.";
      }
    } else {
      strengths = "No clear strengths yet — mixed across assignments.";
    }
  } else {
    const phrases: string[] = [];
    // Add subjects with count context
    strengthSubjects.slice(0, 2).forEach((subject) => {
      const count = bySubject[subject]?.length || 0;
      phrases.push(count > 1 ? `${subject} (${count} assignments)` : subject);
    });

    if (hasConsistentCompletion && phrases.length < 2) {
      phrases.push(`finishes assignments consistently (${completed.length} completed)`);
    }

    const extraCount = Math.max(0, strengthSubjects.length - 2);
    strengths = phrases.join(", ");
    if (extraCount > 0) {
      strengths += ` +${extraCount} more`;
    }
  }

  // ============================================
  // Compute Watch Areas
  // ============================================
  const watchSubjects: string[] = [];

  // Find subjects where student needs support repeatedly
  Object.entries(bySubject).forEach(([subject, assigns]) => {
    const needsSupport = assigns.filter((a) => a.understanding === "needs-support");
    const developingHighCoach = assigns.filter(
      (a) => a.understanding === "developing" &&
             (a.coachSupport === "moderate" || a.coachSupport === "high")
    );

    if (needsSupport.length >= 1) {
      if (!watchSubjects.includes(subject)) {
        watchSubjects.push(subject);
      }
    } else if (developingHighCoach.length >= 1) {
      if (!watchSubjects.includes(subject)) {
        watchSubjects.push(subject);
      }
    }
  });

  // Check for recent regression (last 2 assignments worse than prior 2)
  let hasRecentRegression = false;
  if (recentCompleted.length >= 4) {
    const recent2 = recentCompleted.slice(0, 2);
    const prior2 = recentCompleted.slice(2, 4);

    const scoreMap: Record<string, number> = { "strong": 3, "developing": 2, "needs-support": 1 };
    const recentAvg = recent2.reduce((sum, a) => sum + (scoreMap[a.understanding] || 0), 0) / 2;
    const priorAvg = prior2.reduce((sum, a) => sum + (scoreMap[a.understanding] || 0), 0) / 2;

    if (recentAvg < priorAvg - 0.5) {
      hasRecentRegression = true;
    }
  }

  // Build watch areas string with specific, actionable language
  let watchAreas: string;
  if (watchSubjects.length === 0 && !hasRecentRegression) {
    if (withActivity.length === 0) {
      watchAreas = "No data yet.";
    } else {
      watchAreas = "Nothing flagged — performing at or above expectations.";
    }
  } else {
    const phrases: string[] = [];

    watchSubjects.slice(0, 2).forEach((subject) => {
      const assigns = bySubject[subject] || [];
      const needsSupport = assigns.filter((a) => a.understanding === "needs-support");
      const highCoach = assigns.filter((a) => a.coachSupport === "high" || a.coachSupport === "moderate");

      if (needsSupport.length > 0) {
        phrases.push(`${subject} — scored "needs support" on ${needsSupport.length} assignment${needsSupport.length > 1 ? "s" : ""}`);
      } else if (highCoach.length > 0) {
        phrases.push(`${subject} — needed significant coaching support`);
      } else {
        phrases.push(subject);
      }
    });

    if (hasRecentRegression && phrases.length < 2) {
      phrases.push("recent scores are lower than earlier work — may need a check-in");
    }

    const extraCount = Math.max(0, watchSubjects.length - 2);
    watchAreas = phrases.join("; ");
    if (extraCount > 0) {
      watchAreas += ` (+${extraCount} more)`;
    }
  }

  // ============================================
  // Compute Learning Trend (formerly Momentum)
  // ============================================
  let momentum: string;

  if (completed.length === 0) {
    momentum = "No completed assignments yet.";
  } else if (recentCompleted.length < 2) {
    const a = recentCompleted[0];
    momentum = `1 completed (${getUnderstandingLabel(a.understanding).toLowerCase()}) — need 2+ for trend.`;
  } else {
    const scoreMap: Record<string, number> = { "strong": 3, "developing": 2, "needs-support": 1 };
    const scores = recentCompleted.map((a) => scoreMap[a.understanding] || 0);

    if (scores.every((s) => s === 3)) {
      momentum = `Strong across last ${scores.length} — ready for more challenge.`;
    } else if (scores.length >= 2) {
      const midpoint = Math.floor(scores.length / 2);
      const recentHalf = scores.slice(0, midpoint);
      const olderHalf = scores.slice(midpoint);

      const recentAvg = recentHalf.reduce((a, b) => a + b, 0) / recentHalf.length;
      const olderAvg = olderHalf.reduce((a, b) => a + b, 0) / olderHalf.length;

      if (recentAvg > olderAvg + 0.3) {
        momentum = "Recent work is stronger than earlier assignments.";
      } else if (recentAvg < olderAvg - 0.3) {
        momentum = "Recent scores dropping — consider a check-in.";
      } else {
        const hasStrong = scores.includes(3);
        const hasNeedsSupport = scores.includes(1);

        if (hasStrong && hasNeedsSupport) {
          momentum = "Mixed — strong on some topics, needs support on others.";
        } else if (scores.every((s) => s >= 2)) {
          momentum = "Steady — developing with some coaching support.";
        } else {
          momentum = "Mixed results across recent assignments.";
        }
      }
    } else {
      momentum = `${completed.length} completed — more data needed.`;
    }
  }

  // ============================================
  // Scorecard: Overall
  // ============================================
  // Based on last 3–5 completed assignments
  let overall: OverallLevel;
  if (recentCompleted.length === 0) {
    overall = "no-data";
  } else {
    const scoreMap: Record<string, number> = { "strong": 3, "developing": 2, "needs-support": 1 };
    const avg = recentCompleted.reduce((sum, a) => sum + (scoreMap[a.understanding] || 0), 0) / recentCompleted.length;
    if (avg >= 2.5) overall = "strong";
    else if (avg >= 1.5) overall = "developing";
    else overall = "needs-support";
  }

  // ============================================
  // Scorecard: Trend
  // ============================================
  let trend: TrendLevel;
  if (recentCompleted.length < 2) {
    trend = "no-data";
  } else {
    const scoreMap: Record<string, number> = { "strong": 3, "developing": 2, "needs-support": 1 };
    const scores = recentCompleted.map((a) => scoreMap[a.understanding] || 0);
    const midpoint = Math.floor(scores.length / 2);
    const recentHalf = scores.slice(0, midpoint);
    const olderHalf = scores.slice(midpoint);
    const recentAvg = recentHalf.reduce((a, b) => a + b, 0) / recentHalf.length;
    const olderAvg = olderHalf.reduce((a, b) => a + b, 0) / olderHalf.length;

    if (recentAvg > olderAvg + 0.3) trend = "improving";
    else if (recentAvg < olderAvg - 0.3) trend = "declining";
    else {
      const hasStrong = scores.includes(3);
      const hasNeedsSupport = scores.includes(1);
      trend = (hasStrong && hasNeedsSupport) ? "inconsistent" : "steady";
    }
  }

  // ============================================
  // Scorecard: Support Needed
  // ============================================
  let supportNeeded: SupportLevel;
  if (withActivity.length === 0) {
    supportNeeded = "no-data";
  } else {
    const needsSupportCount = recentCompleted.filter((a) => a.understanding === "needs-support").length;
    const highCoachCount = recentCompleted.filter((a) => a.coachSupport === "high" || a.coachSupport === "moderate").length;

    if (needsSupportCount >= 2 || (needsSupportCount >= 1 && trend === "declining")) {
      supportNeeded = "follow-up";
    } else if (needsSupportCount >= 1 || highCoachCount >= 2 || trend === "declining" || trend === "inconsistent") {
      supportNeeded = "check-in";
    } else {
      supportNeeded = "none";
    }
  }

  // ============================================
  // Scorecard: Work Status
  // ============================================
  const openAssignments = assignments.filter((a) => !a.isComplete);
  const now = new Date();
  const overdueAssignments = openAssignments.filter((a) => {
    if (!a.dueDate) return false;
    return new Date(a.dueDate + "T23:59:59") < now;
  });

  let workStatus: WorkStatusLevel;
  let workStatusDetail: string;

  if (assignments.length === 0) {
    workStatus = "no-data";
    workStatusDetail = "No assignments yet.";
  } else if (overdueAssignments.length > 0) {
    workStatus = "at-risk";
    workStatusDetail = `${overdueAssignments.length} overdue, ${completed.length} completed`;
  } else if (openAssignments.length > 0 && completed.length === 0) {
    workStatus = "pending";
    workStatusDetail = `${openAssignments.length} not started`;
  } else if (openAssignments.length > 0) {
    workStatus = "pending";
    workStatusDetail = `${completed.length} completed, ${openAssignments.length} open`;
  } else {
    workStatus = "on-track";
    workStatusDetail = `${completed.length} completed, none open`;
  }

  return { overall, trend, supportNeeded, workStatus, workStatusDetail, openCount: openAssignments.length, strengths, watchAreas, momentum };
}

// ============================================
// Student Learning Snapshot Component
// ============================================

interface StudentLearningSnapshotProps {
  snapshot: StudentSnapshot;
}

// Scorecard display config — colored text + icon on neutral background
interface SignalConfig { icon: string; label: string; color: string }

const OVERALL_CONFIG: Record<OverallLevel, SignalConfig> = {
  "strong":        { icon: "●", label: "Strong",        color: "#166534" },
  "developing":    { icon: "●", label: "Developing",    color: "#92400e" },
  "needs-support": { icon: "●", label: "Needs Support", color: "#991b1b" },
  "no-data":       { icon: "–", label: "No data",       color: "#9ca3af" },
};

const TREND_CONFIG: Record<TrendLevel, SignalConfig> = {
  "improving":    { icon: "↗", label: "Improving",    color: "#166534" },
  "steady":       { icon: "→", label: "Steady",       color: "#475569" },
  "declining":    { icon: "↘", label: "Declining",    color: "#991b1b" },
  "inconsistent": { icon: "↕", label: "Inconsistent", color: "#92400e" },
  "no-data":      { icon: "–", label: "No data",      color: "#9ca3af" },
};

const NEXT_STEP_PRIORITY_CONFIG: Record<NextStepPriority, { icon: string; color: string }> = {
  "high":   { icon: "!", color: "#991b1b" },
  "medium": { icon: "◐", color: "#92400e" },
  "low":    { icon: "✓", color: "#166534" },
};

const WORK_STATUS_CONFIG: Record<WorkStatusLevel, SignalConfig> = {
  "on-track": { icon: "✓", label: "On track",  color: "#166534" },
  "pending":  { icon: "◐", label: "Pending",   color: "#92400e" },
  "at-risk":  { icon: "!", label: "At risk",    color: "#991b1b" },
  "no-data":  { icon: "–", label: "No data",    color: "#9ca3af" },
};

function StudentLearningSnapshot({ snapshot }: StudentLearningSnapshotProps) {
  // Shared row style using CSS grid for consistent alignment
  const rowStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "100px 1fr",
    gap: "12px",
    alignItems: "start",
  };

  // Shared content text style
  const contentStyle: React.CSSProperties = {
    fontSize: "0.85rem",
    color: "#374151",
    lineHeight: 1.45,
    whiteSpace: "normal",
    wordBreak: "break-word",
  };

  // Shared label style base
  const labelBaseStyle: React.CSSProperties = {
    fontSize: "0.75rem",
    fontWeight: 600,
    padding: "4px 10px",
    borderRadius: "4px",
    textAlign: "center",
    whiteSpace: "nowrap",
  };

  const nextStep = getNextStep(snapshot);
  const nsPri = NEXT_STEP_PRIORITY_CONFIG[nextStep.priority];

  const statusSignals: { title: string; config: SignalConfig; detail?: string }[] = [
    { title: "Overall", config: OVERALL_CONFIG[snapshot.overall] },
    { title: "Trend", config: TREND_CONFIG[snapshot.trend] },
    { title: "Work Status", config: WORK_STATUS_CONFIG[snapshot.workStatus], detail: snapshot.workStatusDetail },
  ];

  const actionBtnStyle: React.CSSProperties = {
    padding: "5px 12px",
    fontSize: "0.78rem",
    fontWeight: 500,
    background: "white",
    color: "#475569",
    border: "1px solid #d1d5db",
    borderRadius: "6px",
    cursor: "pointer",
    transition: "background 0.15s",
  };

  return (
    <div
      className="card"
      style={{
        background: "#fafafa",
        borderLeft: "3px solid #64748b",
        padding: "20px 24px",
      }}
    >
      <h3
        style={{
          margin: "0 0 14px 0",
          color: "#1f2937",
          fontSize: "1rem",
          fontWeight: 600,
        }}
      >
        Student Snapshot
      </h3>

      {/* Scorecard row */}
      <div
        style={{
          display: "flex",
          gap: "10px",
          marginBottom: "16px",
          flexWrap: "wrap",
        }}
      >
        {statusSignals.map((s) => (
          <div
            key={s.title}
            style={{
              flex: "1 1 0",
              minWidth: "110px",
              background: "#ffffff",
              border: "1px solid #e5e7eb",
              borderRadius: "8px",
              padding: "10px 12px",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: "0.65rem", fontWeight: 500, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px" }}>
              {s.title}
            </div>
            <div style={{ fontSize: "0.85rem", fontWeight: 600, color: s.config.color }}>
              {s.config.icon} {s.config.label}
            </div>
            {s.detail && (
              <div style={{ fontSize: "0.7rem", color: "#9ca3af", marginTop: "3px" }}>
                {s.detail}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Next Steps */}
      <div
        style={{
          background: "#ffffff",
          border: "1px solid #e5e7eb",
          borderRadius: "8px",
          padding: "12px 16px",
          marginBottom: "16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: nextStep.priority !== "low" || nextStep.label !== "No action needed" ? "10px" : "0" }}>
          <span style={{ fontSize: "0.65rem", fontWeight: 500, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Next Step
          </span>
          <span style={{ fontSize: "0.85rem", fontWeight: 600, color: nsPri.color }}>
            {nsPri.icon} {nextStep.label}
          </span>
        </div>
        {(nextStep.priority !== "low" || nextStep.label !== "No action needed") && (
          <div style={{ fontSize: "0.82rem", color: "#6b7280", marginBottom: "10px" }}>
            {nextStep.message}
          </div>
        )}
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button
            style={actionBtnStyle}
            onClick={() => console.log("[next-step] Check in")}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#f3f4f6"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "white"; }}
          >
            Check in
          </button>
          <button
            style={actionBtnStyle}
            onClick={() => console.log("[next-step] Assign practice")}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#f3f4f6"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "white"; }}
          >
            Assign practice
          </button>
          <button
            style={actionBtnStyle}
            onClick={() => console.log("[next-step] Mark for follow-up")}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#f3f4f6"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "white"; }}
          >
            Mark for follow-up
          </button>
        </div>
      </div>

      {/* Detail rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {/* Strong in */}
        <div style={rowStyle}>
          <span style={{ ...labelBaseStyle, color: "#166534", background: "#f0fdf4" }}>
            Strong in
          </span>
          <span style={contentStyle}>
            {snapshot.strengths}
          </span>
        </div>

        {/* Watch */}
        <div style={rowStyle}>
          <span style={{ ...labelBaseStyle, color: "#78716c", background: "#f5f5f4" }}>
            Watch
          </span>
          <span style={contentStyle}>
            {snapshot.watchAreas}
          </span>
        </div>

        {/* Trend */}
        <div style={rowStyle}>
          <span style={{ ...labelBaseStyle, color: "#475569", background: "#f1f5f9" }}>
            Trend
          </span>
          <span style={contentStyle}>
            {snapshot.momentum}
          </span>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Student Recommendations Section Component
// ============================================

// Category configuration for display
const CATEGORY_CONFIG: Record<string, { color: string; bgColor: string; icon: string; label: string }> = {
  "celebrate-progress": {
    color: "#3b82f6",
    bgColor: "#eff6ff",
    icon: "★",
    label: "Acknowledge Progress",
  },
  "challenge-opportunity": {
    color: "#166534",
    bgColor: "#f0fdf4",
    icon: "↑",
    label: "Extend Learning",
  },
  "check-in-suggested": {
    color: "#7c3aed",
    bgColor: "#f5f3ff",
    icon: "→",
    label: "Check-in Suggested",
  },
  "needs-support": {
    color: "#dc2626",
    bgColor: "#fef2f2",
    icon: "!",
    label: "Needs Support",
  },
};

const DEFAULT_CONFIG = {
  color: "#64748b",
  bgColor: "#f8fafc",
  icon: "·",
  label: "Recommendation",
};

interface StudentRecommendationsSectionProps {
  recommendations: Recommendation[];
  studentName: string;
  badgeTypes: BadgeTypeInfo[];
  hasMoreOnAssignments: boolean;
  todos: TeacherTodo[];
  onDismiss: (id: string) => void;
  onFeedback: (id: string, feedback: FeedbackType) => void;
  onActionComplete: () => void;
  onCompleteTodo: (todoId: string) => void;
}

function StudentRecommendationsSection({
  recommendations,
  studentName,
  badgeTypes,
  hasMoreOnAssignments,
  todos,
  onDismiss,
  onFeedback,
  onActionComplete,
  onCompleteTodo,
}: StudentRecommendationsSectionProps) {
  const hasTodos = todos.length > 0;
  const hasRecommendations = recommendations.length > 0;

  // Empty state - no todos and no recommendations
  if (!hasTodos && !hasRecommendations) {
    return (
      <div
        className="card"
        style={{
          marginTop: "24px",
          background: "#fafafa",
          borderLeft: "3px solid #64748b",
        }}
      >
        <h3 style={{ margin: "0 0 8px 0", color: "#1f2937", fontSize: "1rem", fontWeight: 600 }}>
          Next Steps
        </h3>
        <p style={{ margin: 0, color: "#64748b", fontSize: "0.875rem", lineHeight: 1.5 }}>
          This student is progressing steadily. No action needed right now.
        </p>
      </div>
    );
  }

  return (
    <div
      className="card"
      style={{
        marginTop: "24px",
        background: "#fafafa",
        borderLeft: "3px solid #64748b",
      }}
    >
      <h3 style={{ margin: "0 0 16px 0", color: "#1f2937", fontSize: "1rem", fontWeight: 600 }}>
        Next Steps
      </h3>

      {/* Student To-Dos Subsection */}
      {hasTodos && (
        <div style={{ marginBottom: hasRecommendations ? "20px" : "0" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "12px",
            }}
          >
            <span
              style={{
                fontSize: "0.7rem",
                fontWeight: 600,
                color: "#475569",
                background: "#f1f5f9",
                padding: "3px 10px",
                borderRadius: "4px",
                textTransform: "uppercase",
                letterSpacing: "0.03em",
              }}
            >
              To-Dos
            </span>
            <span style={{ fontSize: "0.8rem", color: "#64748b" }}>
              Planned follow-ups for this student
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {todos.map((todo) => (
              <StudentTodoCard
                key={todo.id}
                todo={todo}
                onComplete={onCompleteTodo}
              />
            ))}
          </div>
        </div>
      )}

      {/* Recommendations */}
      {hasRecommendations && (
        <>
          {hasTodos && (
            <div
              style={{
                borderTop: "1px solid #e2e8f0",
                paddingTop: "16px",
                marginTop: "4px",
              }}
            />
          )}
          {recommendations.map((rec) => (
            <StudentRecommendationCard
              key={rec.id}
              recommendation={rec}
              studentName={studentName}
              badgeTypes={badgeTypes}
              onDismiss={onDismiss}
              onFeedback={onFeedback}
              onActionComplete={onActionComplete}
            />
          ))}
        </>
      )}

      {hasMoreOnAssignments && (
        <p style={{ margin: "12px 0 0 0", color: "#64748b", fontSize: "0.8rem", fontStyle: "italic" }}>
          Additional recommendations available on assignment pages.
        </p>
      )}
    </div>
  );
}

// ============================================
// Student To-Do Card Component
// ============================================

/**
 * Map backend category values to display labels.
 * Updates terminology to match Recommended Actions panel.
 */
const TODO_CATEGORY_DISPLAY_LABELS: Record<string, string> = {
  "Celebrate Progress": "Acknowledge Progress",
  "Ready for Challenge": "Extend Learning",
};

function getTodoCategoryDisplayLabel(category: string): string {
  return TODO_CATEGORY_DISPLAY_LABELS[category] || category;
}

interface StudentTodoCardProps {
  todo: TeacherTodo;
  onComplete: (todoId: string) => void;
}

function StudentTodoCard({ todo, onComplete }: StudentTodoCardProps) {
  const navigate = useNavigate();
  const { studentId } = useParams<{ studentId: string }>();
  const [isCompleting, setIsCompleting] = useState(false);

  const handleComplete = async () => {
    setIsCompleting(true);
    try {
      await onComplete(todo.id);
    } finally {
      setIsCompleting(false);
    }
  };

  // Build context line
  const contextParts: string[] = [];
  if (todo.subject) contextParts.push(todo.subject);
  if (todo.assignmentTitle) contextParts.push(todo.assignmentTitle);
  const contextLine = contextParts.join(" · ");

  // Navigate to StudentAssignmentReview when card is clicked
  const canNavigate = !!todo.assignmentId && !!studentId;
  const handleCardClick = () => {
    if (canNavigate) {
      navigate(`/educator/assignment/${todo.assignmentId}/student/${studentId}`);
    }
  };

  return (
    <div
      onClick={handleCardClick}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "10px",
        padding: "10px 12px",
        background: "white",
        borderRadius: "6px",
        borderLeft: "3px solid #64748b",
        boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
        cursor: canNavigate ? "pointer" : "default",
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => {
        if (canNavigate) e.currentTarget.style.background = "#f8f9fb";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "white";
      }}
    >
      <button
        onClick={(e) => { e.stopPropagation(); handleComplete(); }}
        disabled={isCompleting}
        style={{
          width: "18px",
          height: "18px",
          minWidth: "18px",
          borderRadius: "4px",
          border: "2px solid #64748b",
          background: isCompleting ? "#64748b" : "transparent",
          cursor: isCompleting ? "wait" : "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginTop: "2px",
          transition: "all 0.15s ease",
        }}
        title="Mark as complete"
      >
        {isCompleting && (
          <span style={{ color: "white", fontSize: "8px", fontWeight: "bold" }}>OK</span>
        )}
      </button>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: "0.9rem", color: "#1f2937", fontWeight: 500, lineHeight: 1.4 }}>
            {todo.label}
          </span>
          {todo.category && (
            <span
              style={{
                fontSize: "0.7rem",
                color: "#64748b",
                background: "#f1f5f9",
                padding: "2px 6px",
                borderRadius: "4px",
                fontWeight: 500,
              }}
            >
              {getTodoCategoryDisplayLabel(todo.category)}
            </span>
          )}
        </div>
        {contextLine && (
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "3px" }}>
            {contextLine}
          </div>
        )}
      </div>

      {/* Navigation indicator */}
      {canNavigate && (
        <span style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginTop: "2px", flexShrink: 0 }}>→</span>
      )}
    </div>
  );
}

// ============================================
// Student Recommendation Card (Compact)
// ============================================

interface StudentRecommendationCardProps {
  recommendation: Recommendation;
  studentName: string;
  badgeTypes: BadgeTypeInfo[];
  onDismiss: (id: string) => void;
  onFeedback: (id: string, feedback: FeedbackType) => void;
  onActionComplete: () => void;
}

function StudentRecommendationCard({
  recommendation,
  studentName: _studentName,
  badgeTypes,
  onDismiss,
  onFeedback: _onFeedback,
  onActionComplete,
}: StudentRecommendationCardProps) {
  const [showAudit, setShowAudit] = useState(false);
  const [selectedActions, setSelectedActions] = useState<Set<ChecklistActionKey>>(new Set());
  const [noteText, setNoteText] = useState("");
  const [selectedBadgeType, setSelectedBadgeType] = useState<string>("");
  const [badgeMessage, setBadgeMessage] = useState("");
  const [coachingTitle, setCoachingTitle] = useState("");
  const [coachingNote, setCoachingNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Get category key for this recommendation
  const getCategoryKeyLocal = (rec: Recommendation): string => {
    const ruleName = rec.triggerData?.ruleName || "";
    const insightType: string = rec.insightType || rec.type;

    switch (ruleName) {
      case "notable-improvement": return "celebrate-progress";
      case "ready-for-challenge": return "challenge-opportunity";
      case "check-in-suggested": return "check-in-suggested";
      case "needs-support": return "needs-support";
    }

    switch (insightType) {
      case "celebrate_progress":
      case "celebrate":
        return "celebrate-progress";
      case "challenge_opportunity":
      case "enrichment":
        return "challenge-opportunity";
    }

    return "needs-support";
  };

  const categoryKey = getCategoryKeyLocal(recommendation);
  const config = CATEGORY_CONFIG[categoryKey] || DEFAULT_CONFIG;

  // Get available checklist actions for this category
  const checklistActionKeys = useMemo(() => {
    return getChecklistActionsForCategory(categoryKey, {
      hasAssignmentId: !!recommendation.assignmentId,
      isGrouped: recommendation.studentIds.length > 1,
      studentCount: recommendation.studentIds.length,
    });
  }, [categoryKey, recommendation.assignmentId, recommendation.studentIds.length]);

  // Check if submit is valid
  const canSubmit = selectedActions.size > 0 && !isSubmitting;
  const needsBadgeType = selectedActions.has("award_badge") && !selectedBadgeType;
  const needsNoteText = selectedActions.has("add_note") && !noteText.trim();
  const needsCoachingTitle = selectedActions.has("invite_coaching_session") && !coachingTitle.trim();
  const isSubmitDisabled = !canSubmit || needsBadgeType || needsNoteText || needsCoachingTitle;

  const toggleAction = (actionKey: ChecklistActionKey) => {
    const isAdding = !selectedActions.has(actionKey);
    setSelectedActions((prev) => {
      const next = new Set(prev);
      if (next.has(actionKey)) {
        next.delete(actionKey);
      } else {
        next.add(actionKey);
      }
      return next;
    });

    if (actionKey === "invite_coaching_session" && isAdding) {
      const assignmentTitle = recommendation.triggerData.signals.assignmentTitle as string;
      if (assignmentTitle) {
        setCoachingTitle(`Advanced discussions about ${assignmentTitle}`);
      }
    }
  };

  const handleChecklistSubmit = async () => {
    if (isSubmitDisabled) return;

    setIsSubmitting(true);
    try {
      if (selectedActions.has("invite_coaching_session") && recommendation.studentIds.length > 0) {
        await createCoachingInvite({
          studentId: recommendation.studentIds[0],
          subject: (recommendation.triggerData.signals.subject as string) || "General",
          assignmentId: recommendation.assignmentId,
          assignmentTitle: (recommendation.triggerData.signals.assignmentTitle as string) || undefined,
          title: coachingTitle.trim(),
          teacherNote: coachingNote.trim() || undefined,
          sourceRecommendationId: recommendation.id,
        });
      }

      await submitChecklistActions(recommendation.id, {
        selectedActionKeys: Array.from(selectedActions),
        noteText: selectedActions.has("add_note") ? noteText : undefined,
        badgeType: selectedActions.has("award_badge") ? selectedBadgeType : undefined,
        badgeMessage: selectedActions.has("award_badge") && badgeMessage ? badgeMessage : undefined,
        coachingTitle: selectedActions.has("invite_coaching_session") ? coachingTitle : undefined,
        coachingNote: selectedActions.has("invite_coaching_session") ? coachingNote : undefined,
      });

      // Clear form state
      setSelectedActions(new Set());
      setNoteText("");
      setSelectedBadgeType("");
      setBadgeMessage("");
      setCoachingTitle("");
      setCoachingNote("");

      // Notify parent to refresh
      onActionComplete();
    } catch (error) {
      console.error("Failed to submit checklist actions:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const displayTitle = recommendation.summary || recommendation.title;
  const displayEvidence = recommendation.evidence?.length ? recommendation.evidence : [recommendation.reason];

  return (
    <div
      style={{
        background: "white",
        borderLeft: `3px solid ${config.color}`,
        borderRadius: "6px",
        padding: "14px 16px",
        marginBottom: "12px",
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
        <span style={{ fontSize: "0.875rem", color: config.color, fontWeight: 600, marginTop: "2px" }}>
          {config.icon}
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px", flexWrap: "wrap" }}>
            <span
              style={{
                fontSize: "0.65rem",
                fontWeight: 600,
                color: config.color,
                background: config.bgColor,
                padding: "2px 8px",
                borderRadius: "3px",
                textTransform: "uppercase",
                letterSpacing: "0.03em",
              }}
            >
              {config.label}
            </span>
            {recommendation.priorityLevel === "high" && (
              <span
                style={{
                  fontSize: "0.65rem",
                  fontWeight: 500,
                  color: "#dc2626",
                  background: "#fef2f2",
                  padding: "2px 8px",
                  borderRadius: "3px",
                }}
              >
                High Priority
              </span>
            )}
          </div>
          <h4 style={{ margin: "6px 0 0 0", color: "#2d3748", fontSize: "0.95rem", fontWeight: 600 }}>
            {displayTitle}
          </h4>
        </div>
      </div>

      {/* Evidence */}
      <div style={{ marginTop: "10px", paddingLeft: "24px" }}>
        <ul style={{ margin: 0, paddingLeft: "16px", color: "#64748b", fontSize: "0.85rem", lineHeight: 1.6 }}>
          {displayEvidence.map((item, i) => (
            <li key={i} style={{ marginBottom: "3px" }}>{item}</li>
          ))}
        </ul>
      </div>

      {/* Checklist Actions */}
      <div
        style={{
          marginTop: "12px",
          marginLeft: "24px",
          background: "#f8fafc",
          borderRadius: "6px",
          padding: "12px",
        }}
      >
        <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "#3d5a80", marginBottom: "8px" }}>
          Select actions to take:
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {checklistActionKeys.map((actionKey) => {
            const actionConfig = CHECKLIST_ACTIONS[actionKey];
            const isChecked = selectedActions.has(actionKey);

            return (
              <div key={actionKey}>
                <label
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "8px",
                    cursor: "pointer",
                    fontSize: "0.85rem",
                    color: "#333",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleAction(actionKey)}
                    style={{ marginTop: "2px", cursor: "pointer", width: "15px", height: "15px" }}
                  />
                  <span>{actionConfig.label}</span>
                </label>

                {/* Badge selector inline */}
                {actionKey === "award_badge" && isChecked && (
                  <div
                    style={{
                      marginTop: "8px",
                      marginLeft: "23px",
                      padding: "10px",
                      background: "#fff",
                      border: "1px solid #e2e8f0",
                      borderRadius: "6px",
                    }}
                  >
                    <div style={{ marginBottom: "8px" }}>
                      <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 500, marginBottom: "4px", color: "#2d3748" }}>
                        Badge type <span style={{ color: "#dc2626" }}>*</span>
                      </label>
                      <select
                        value={selectedBadgeType}
                        onChange={(e) => setSelectedBadgeType(e.target.value)}
                        style={{
                          width: "100%",
                          padding: "6px 8px",
                          fontSize: "0.8rem",
                          border: "1px solid #e2e8f0",
                          borderRadius: "6px",
                        }}
                      >
                        <option value="">Select a badge...</option>
                        {badgeTypes.map((bt) => (
                          <option key={bt.id} value={bt.id}>
                            {bt.icon} {bt.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 500, marginBottom: "4px", color: "#64748b" }}>
                        Message (optional)
                      </label>
                      <input
                        type="text"
                        value={badgeMessage}
                        onChange={(e) => setBadgeMessage(e.target.value)}
                        placeholder="Great work!"
                        style={{
                          width: "100%",
                          padding: "6px 8px",
                          fontSize: "0.8rem",
                          border: "1px solid #e2e8f0",
                          borderRadius: "6px",
                          boxSizing: "border-box",
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Note input inline */}
                {actionKey === "add_note" && isChecked && (
                  <div
                    style={{
                      marginTop: "8px",
                      marginLeft: "23px",
                      padding: "10px",
                      background: "#fff",
                      border: "1px solid #e2e8f0",
                      borderRadius: "6px",
                    }}
                  >
                    <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 500, marginBottom: "4px", color: "#2d3748" }}>
                      Note <span style={{ color: "#dc2626" }}>*</span>
                    </label>
                    <textarea
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      placeholder="Add your notes here..."
                      rows={2}
                      style={{
                        width: "100%",
                        padding: "6px 8px",
                        fontSize: "0.8rem",
                        border: "1px solid #e2e8f0",
                        borderRadius: "6px",
                        resize: "vertical",
                        boxSizing: "border-box",
                        fontFamily: "inherit",
                      }}
                    />
                  </div>
                )}

                {/* Coaching session form inline */}
                {actionKey === "invite_coaching_session" && isChecked && (
                  <div
                    style={{
                      marginTop: "8px",
                      marginLeft: "23px",
                      padding: "10px",
                      background: "#fff",
                      border: "1px solid #e2e8f0",
                      borderRadius: "6px",
                      borderLeft: "3px solid #166534",
                    }}
                  >
                    <div style={{ marginBottom: "10px" }}>
                      <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 500, marginBottom: "4px", color: "#2d3748" }}>
                        Session title <span style={{ color: "#dc2626" }}>*</span>
                      </label>
                      <input
                        type="text"
                        value={coachingTitle}
                        onChange={(e) => setCoachingTitle(e.target.value)}
                        placeholder="e.g., Advanced discussions about Problem Solving"
                        style={{
                          width: "100%",
                          padding: "6px 8px",
                          fontSize: "0.8rem",
                          border: "1px solid #e2e8f0",
                          borderRadius: "6px",
                          boxSizing: "border-box",
                        }}
                      />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 500, marginBottom: "4px", color: "#64748b" }}>
                        Personal note (optional)
                      </label>
                      <textarea
                        value={coachingNote}
                        onChange={(e) => setCoachingNote(e.target.value)}
                        placeholder="e.g., Great work so far!"
                        rows={2}
                        style={{
                          width: "100%",
                          padding: "6px 8px",
                          fontSize: "0.8rem",
                          border: "1px solid #e2e8f0",
                          borderRadius: "6px",
                          resize: "vertical",
                          boxSizing: "border-box",
                          fontFamily: "inherit",
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Submit button */}
          {selectedActions.size > 0 && (
            <div style={{ marginTop: "10px", display: "flex", alignItems: "center", gap: "10px" }}>
              <button
                onClick={handleChecklistSubmit}
                disabled={isSubmitDisabled}
                style={{
                  padding: "7px 14px",
                  fontSize: "0.8rem",
                  fontWeight: 600,
                  background: isSubmitDisabled ? "#e2e8f0" : "linear-gradient(135deg, #3d5a80 0%, #4a6b8a 100%)",
                  color: isSubmitDisabled ? "var(--text-muted)" : "white",
                  border: "none",
                  borderRadius: "6px",
                  cursor: isSubmitDisabled ? "not-allowed" : "pointer",
                }}
              >
                {isSubmitting ? "Submitting..." : `Submit ${selectedActions.size} action${selectedActions.size > 1 ? "s" : ""}`}
              </button>
              {(needsBadgeType || needsNoteText || needsCoachingTitle) && (
                <span style={{ fontSize: "0.75rem", color: "#dc2626" }}>
                  {needsBadgeType && "Select badge. "}
                  {needsNoteText && "Enter note. "}
                  {needsCoachingTitle && "Enter title."}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Secondary Actions */}
      <div
        style={{
          marginTop: "10px",
          marginLeft: "24px",
          display: "flex",
          alignItems: "center",
          gap: "8px",
        }}
      >
        <button
          onClick={() => onDismiss(recommendation.id)}
          style={{
            padding: "4px 10px",
            fontSize: "0.75rem",
            background: "transparent",
            color: "#64748b",
            border: "1px solid #e2e8f0",
            borderRadius: "6px",
            cursor: "pointer",
            fontWeight: 500,
          }}
        >
          Dismiss
        </button>

        <button
          onClick={() => setShowAudit(!showAudit)}
          style={{
            padding: "4px 10px",
            fontSize: "0.75rem",
            background: "transparent",
            color: "var(--text-muted)",
            border: "none",
            cursor: "pointer",
            marginLeft: "auto",
          }}
        >
          {showAudit ? "Hide details" : "Why am I seeing this?"}
        </button>
      </div>

      {/* Audit Trail */}
      {showAudit && (
        <div
          style={{
            marginTop: "10px",
            marginLeft: "24px",
            background: "#f8fafc",
            borderRadius: "6px",
            padding: "12px",
            fontSize: "0.75rem",
            color: "#64748b",
          }}
        >
          <div style={{ marginBottom: "6px" }}>
            <strong>Confidence:</strong> {Math.round((recommendation.confidenceScore || 0.7) * 100)}%
          </div>
          <div style={{ marginBottom: "6px" }}>
            <strong>Priority:</strong> {recommendation.priorityLevel}
          </div>
          <div>
            <strong>Generated:</strong> {new Date(recommendation.triggerData.generatedAt).toLocaleString()}
          </div>
        </div>
      )}
    </div>
  );
}
