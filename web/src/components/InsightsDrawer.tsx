/**
 * InsightsDrawer - Slide-out drawer for assignment table insights
 *
 * Shows all recommendations for a selected student in the assignment review table.
 * Uses the shared Drawer component and InsightCard for consistent UI.
 *
 * Sections:
 * 1. Active Insights - AI-generated recommendations that need action
 * 2. Scheduled Follow-ups - Open teacher todos for this student/assignment
 * 3. Action History - Resolved recommendations and completed todos
 */

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Drawer from "./Drawer";
import InsightCard from "./InsightCard";
import {
  type Recommendation,
  type TeacherTodo,
  dismissRecommendation,
  completeTeacherTodo,
} from "../services/api";
import { getCategoryConfig } from "../utils/recommendationConfig";

interface InsightsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  studentId: string;
  studentName: string;
  recommendations: Recommendation[];
  todos?: TeacherTodo[];
  onRecommendationResolved: (recommendationId: string) => void;
  onTodoCompleted?: (todoId: string) => void;
}

export default function InsightsDrawer({
  isOpen,
  onClose,
  studentId: _studentId, // Currently unused but kept for future API calls
  studentName,
  recommendations,
  todos = [],
  onRecommendationResolved,
  onTodoCompleted,
}: InsightsDrawerProps) {
  const navigate = useNavigate();
  const [localRecommendations, setLocalRecommendations] = useState<Recommendation[]>(recommendations);
  const [localTodos, setLocalTodos] = useState<TeacherTodo[]>(todos);
  const [drawerError, setDrawerError] = useState<string | null>(null);

  // Handle card click - navigate to student review
  const handleNavigate = (rec: Recommendation) => {
    onClose(); // Close the drawer first
    if (rec.assignmentId && rec.studentIds.length > 0) {
      navigate(`/educator/assignment/${rec.assignmentId}/student/${rec.studentIds[0]}`);
    } else if (rec.studentIds.length > 0) {
      navigate(`/educator/student/${rec.studentIds[0]}`);
    }
  };

  // Sync local recommendations when props change
  useEffect(() => {
    setLocalRecommendations(recommendations);
  }, [recommendations]);

  // Sync local todos when props change
  useEffect(() => {
    setLocalTodos(todos);
  }, [todos]);

  // Handle dismiss
  const handleDismiss = async (recommendationId: string) => {
    try {
      await dismissRecommendation(recommendationId);
      // Remove from local state
      setLocalRecommendations((prev) => prev.filter((r) => r.id !== recommendationId));
      // Notify parent
      onRecommendationResolved(recommendationId);
    } catch (err) {
      console.error("Failed to dismiss recommendation:", err);
    }
  };

  // Handle todo completion
  const handleTodoComplete = async (todoId: string) => {
    try {
      await completeTeacherTodo(todoId);
      // Update local state to mark as done
      setLocalTodos((prev) =>
        prev.map((t) => (t.id === todoId ? { ...t, status: "done" as const } : t))
      );
      // Notify parent
      onTodoCompleted?.(todoId);
    } catch (err) {
      console.error("Failed to complete todo:", err);
      setDrawerError("Failed to complete todo");
    }
  };

  // Categorize recommendations
  const activeRecs = localRecommendations.filter((r) => r.status === "active");
  const resolvedRecs = localRecommendations.filter((r) => r.status === "resolved" || r.status === "reviewed");

  // Categorize todos (use localTodos for local state management)
  // Explicitly exclude superseded todos — they are historical only
  const activeTodos = localTodos.filter((t) => t.status !== "superseded");
  const openTodos = activeTodos.filter((t) => t.status === "open");
  const completedTodos = activeTodos.filter((t) => t.status === "done");

  // Check for badge awards in resolved recommendations
  const badgeAwards = resolvedRecs.filter((r) =>
    r.submittedActions?.some((a) => a.actionKey === "award_badge")
  );

  const activeCount = activeRecs.length;
  const hasScheduledActions = openTodos.length > 0;
  const hasHistory = resolvedRecs.length > 0 || completedTodos.length > 0;
  const hasAnyContent = activeCount > 0 || hasScheduledActions || hasHistory;

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title={`Insights for ${studentName}`}
      width="460px"
      headerActions={
        activeCount > 0 ? (
          <span
            style={{
              fontSize: "0.8rem",
              color: "#64748b",
              background: "#f1f5f9",
              padding: "4px 10px",
              borderRadius: "12px",
            }}
          >
            {activeCount} {activeCount === 1 ? "insight" : "insights"}
          </span>
        ) : undefined
      }
    >
      {!hasAnyContent ? (
        <div
          style={{
            textAlign: "center",
            padding: "48px 24px",
            color: "#64748b",
          }}
        >
          <div
            style={{
              fontSize: "2.5rem",
              marginBottom: "12px",
              opacity: 0.5,
            }}
          >
            ✓
          </div>
          <p style={{ margin: 0, fontSize: "0.95rem" }}>
            No insights for this student.
          </p>
          <p style={{ margin: "8px 0 0 0", fontSize: "0.85rem", color: "#94a3b8" }}>
            No AI recommendations or scheduled follow-ups.
          </p>
        </div>
      ) : (
        <div>
          {/* Error display */}
          {drawerError && (
            <div
              style={{
                marginBottom: "12px",
                padding: "10px 14px",
                background: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: "6px",
                color: "#dc2626",
                fontSize: "0.85rem",
              }}
            >
              {drawerError}
              <button
                onClick={() => setDrawerError(null)}
                style={{
                  marginLeft: "8px",
                  background: "none",
                  border: "none",
                  color: "#dc2626",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                ×
              </button>
            </div>
          )}

          {/* Section 1: Active Insights */}
          {activeRecs.length > 0 && (
            <div style={{ marginBottom: "24px" }}>
              <SectionHeader
                title="AI Insights"
                subtitle="Recommendations based on student work"
                icon="💡"
              />
              {activeRecs.map((rec) => (
                <InsightCard
                  key={rec.id}
                  recommendation={rec}
                  studentName={studentName}
                  onDismiss={handleDismiss}
                  onNavigate={() => handleNavigate(rec)}
                  compact
                />
              ))}
            </div>
          )}

          {/* Section 2: Scheduled Follow-ups (Open Todos) */}
          {openTodos.length > 0 && (
            <div style={{ marginBottom: "24px" }}>
              <SectionHeader
                title="Scheduled Follow-ups"
                subtitle="Actions you've planned for this student"
                icon="📋"
              />
              {openTodos.map((todo) => (
                <TodoCard key={todo.id} todo={todo} status="open" onComplete={handleTodoComplete} />
              ))}
            </div>
          )}

          {/* Section 3: Action History */}
          {hasHistory && (
            <div style={{ marginBottom: "16px" }}>
              <SectionHeader
                title="Action History"
                subtitle="Completed actions and resolved insights"
                icon="✓"
                collapsed
              />

              {/* Badge awards get special treatment */}
              {badgeAwards.map((rec) => (
                <HistoryCard
                  key={rec.id}
                  type="badge"
                  title="Badge Awarded"
                  detail={getBadgeDetail(rec)}
                  timestamp={rec.submittedAt || rec.createdAt}
                />
              ))}

              {/* Completed todos */}
              {completedTodos.map((todo) => (
                <TodoCard key={todo.id} todo={todo} status="done" />
              ))}

              {/* Other resolved recommendations */}
              {resolvedRecs
                .filter((r) => !badgeAwards.includes(r))
                .map((rec) => (
                  <HistoryCard
                    key={rec.id}
                    type="action"
                    title={getActionTitle(rec)}
                    detail={getActionDetail(rec)}
                    timestamp={rec.submittedAt || rec.createdAt}
                    category={getCategoryConfig(rec)}
                  />
                ))}
            </div>
          )}

          {/* Empty state when only history exists */}
          {activeRecs.length === 0 && openTodos.length === 0 && hasHistory && (
            <div
              style={{
                textAlign: "center",
                padding: "24px",
                background: "#f0fdf4",
                borderRadius: "8px",
                marginTop: "16px",
              }}
            >
              <span style={{ color: "#16a34a", fontSize: "1.2rem" }}>✓</span>
              <p style={{ margin: "8px 0 0 0", fontSize: "0.85rem", color: "#166534" }}>
                All insights have been addressed
              </p>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

// ============================================
// Helper Components
// ============================================

function SectionHeader({
  title,
  subtitle,
  icon,
  collapsed,
}: {
  title: string;
  subtitle: string;
  icon: string;
  collapsed?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "10px",
        marginBottom: "12px",
        paddingBottom: "8px",
        borderBottom: "1px solid #f1f5f9",
        opacity: collapsed ? 0.7 : 1,
      }}
    >
      <span style={{ fontSize: "1.1rem" }}>{icon}</span>
      <div>
        <div style={{ fontWeight: 600, fontSize: "0.9rem", color: "#1e293b" }}>
          {title}
        </div>
        <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "2px" }}>
          {subtitle}
        </div>
      </div>
    </div>
  );
}

function TodoCard({
  todo,
  status,
  onComplete,
}: {
  todo: TeacherTodo;
  status: "open" | "done";
  onComplete?: (todoId: string) => void;
}) {
  const isDone = status === "done";
  const [isCompleting, setIsCompleting] = useState(false);

  // Build context string from available fields
  const contextParts: string[] = [];
  if (todo.assignmentTitle) contextParts.push(todo.assignmentTitle);
  if (todo.studentNames) contextParts.push(todo.studentNames);
  const contextString = contextParts.join(" · ");

  const handleCheckboxClick = async () => {
    if (isDone || isCompleting) return;
    setIsCompleting(true);
    try {
      await onComplete?.(todo.id);
    } finally {
      setIsCompleting(false);
    }
  };

  return (
    <div
      style={{
        padding: "12px 14px",
        background: isDone ? "#f8fafc" : "#fffbeb",
        border: `1px solid ${isDone ? "#e2e8f0" : "#fcd34d"}`,
        borderRadius: "8px",
        marginBottom: "8px",
        opacity: isDone ? 0.8 : 1,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "10px",
        }}
      >
        {/* Checkbox */}
        <button
          onClick={handleCheckboxClick}
          disabled={isDone || isCompleting}
          style={{
            width: "20px",
            height: "20px",
            borderRadius: "4px",
            border: isDone ? "none" : "2px solid #d97706",
            background: isDone ? "#10b981" : isCompleting ? "#fcd34d" : "white",
            cursor: isDone ? "default" : "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            marginTop: "1px",
            transition: "all 0.15s ease",
          }}
          title={isDone ? "Completed" : "Mark as complete"}
        >
          {isDone && <span style={{ color: "white", fontSize: "12px", fontWeight: "bold" }}>✓</span>}
          {isCompleting && <span style={{ fontSize: "10px" }}>...</span>}
        </button>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontWeight: 500,
              fontSize: "0.85rem",
              color: isDone ? "#64748b" : "#92400e",
              textDecoration: isDone ? "line-through" : "none",
            }}
          >
            {todo.label}
          </div>
          {contextString && (
            <div
              style={{
                fontSize: "0.75rem",
                color: "#94a3b8",
                marginTop: "4px",
              }}
            >
              {contextString}
            </div>
          )}
          {todo.category && (
            <div
              style={{
                display: "inline-block",
                fontSize: "0.68rem",
                color: "#6b7280",
                background: "#f3f4f6",
                padding: "2px 6px",
                borderRadius: "4px",
                marginTop: "6px",
              }}
            >
              {todo.category}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function HistoryCard({
  type,
  title,
  detail,
  timestamp,
  category,
}: {
  type: "badge" | "action";
  title: string;
  detail?: string;
  timestamp?: string;
  category?: { icon: string; color: string; bgColor: string } | null;
}) {
  const isBadge = type === "badge";

  return (
    <div
      style={{
        padding: "10px 12px",
        background: isBadge ? "#fdf4ff" : "#f8fafc",
        border: `1px solid ${isBadge ? "#e879f9" : "#e2e8f0"}`,
        borderRadius: "6px",
        marginBottom: "6px",
        opacity: 0.9,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        {category ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "20px",
              height: "20px",
              borderRadius: "4px",
              background: category.bgColor,
              color: category.color,
              fontSize: "0.7rem",
            }}
          >
            {category.icon}
          </span>
        ) : (
          <span style={{ fontSize: "0.9rem" }}>{isBadge ? "⭐" : "✓"}</span>
        )}
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontWeight: 500,
              fontSize: "0.8rem",
              color: isBadge ? "#86198f" : "#475569",
            }}
          >
            {title}
          </div>
          {detail && (
            <div style={{ fontSize: "0.72rem", color: "#94a3b8", marginTop: "2px" }}>
              {detail}
            </div>
          )}
        </div>
        {timestamp && (
          <div style={{ fontSize: "0.68rem", color: "#cbd5e1" }}>
            {formatRelativeTime(timestamp)}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// Helper Functions
// ============================================

function getBadgeDetail(rec: Recommendation): string | undefined {
  const badgeAction = rec.submittedActions?.find((a) => a.actionKey === "award_badge");
  if (badgeAction?.badgeType) {
    return `${formatBadgeType(badgeAction.badgeType)}`;
  }
  return undefined;
}

function getActionTitle(rec: Recommendation): string {
  if (rec.submittedActions && rec.submittedActions.length > 0) {
    const actions = rec.submittedActions.map((a) => formatActionKey(a.actionKey));
    return actions.join(", ");
  }
  return "Insight addressed";
}

function getActionDetail(rec: Recommendation): string | undefined {
  const noteAction = rec.submittedActions?.find((a) => a.note);
  if (noteAction?.note) {
    return noteAction.note;
  }
  return rec.summary;
}

function formatActionKey(key: string): string {
  const labels: Record<string, string> = {
    review_work: "Reviewed work",
    small_group: "Small group planned",
    reteach: "Reteach scheduled",
    one_on_one: "1:1 conference",
    add_note: "Note added",
    award_badge: "Badge awarded",
    reassign: "Reassigned",
    share_family: "Shared with family",
  };
  return labels[key] || key;
}

function formatBadgeType(type: string): string {
  const labels: Record<string, string> = {
    progress_star: "Progress Star",
    mastery_badge: "Mastery Badge",
    effort_award: "Effort Award",
    persistence: "Persistence Badge",
    focus_badge: "Focus Badge",
    creativity_badge: "Creativity Badge",
    collaboration_badge: "Collaboration Badge",
    curiosity: "Curiosity Award",
    helper_badge: "Helper Badge",
    custom: "Custom Badge",
  };
  return labels[type] || type;
}

function formatRelativeTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
