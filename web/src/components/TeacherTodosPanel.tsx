/**
 * TeacherTodosPanel - Collapsible Panel for Teacher To-Do Items
 *
 * Displays soft action items (e.g., "Run small group review", "Check in 1-on-1")
 * that teachers have committed to from the recommendation checklist.
 *
 * Features:
 * - Collapsed by default to keep dashboard calm
 * - Shows count badge
 * - Teachers can check items off as complete
 * - Grouped by student for easy scanning
 * - Link to printable to-do sheet
 */

import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "./Toast";
import {
  type TeacherTodo,
  type TeacherTodoCounts,
  type TodosByStudent,
  type RecommendationCategory,
  completeTeacherTodo,
  reopenTeacherTodo,
  deleteTeacherTodo,
  groupTodosByStudent,
} from "../services/api";

// ============================================
// Priority Ordering
// ============================================

const CATEGORY_PRIORITY: Record<RecommendationCategory, number> = {
  "Needs Support": 1,
  "Group Support": 2,
  "Developing": 3,
  "Monitor": 4,
  "Ready for Challenge": 5,
  "Celebrate Progress": 6,
};

/**
 * Map backend category values to display labels.
 * Updates terminology to match Recommended Actions panel.
 */
const CATEGORY_DISPLAY_LABELS: Record<string, string> = {
  "Celebrate Progress": "Acknowledge Progress",
  "Ready for Challenge": "Extend Learning",
};

function getCategoryDisplayLabel(category: string): string {
  return CATEGORY_DISPLAY_LABELS[category] || category;
}

/**
 * Get the highest priority category from a student's todos.
 * Lower number = higher priority.
 */
function getStudentPriority(group: TodosByStudent): number {
  let highestPriority = 999;
  for (const { todo } of group.todos) {
    if (todo.category) {
      const priority = CATEGORY_PRIORITY[todo.category] ?? 999;
      if (priority < highestPriority) {
        highestPriority = priority;
      }
    }
  }
  return highestPriority;
}

/**
 * Sort student groups by priority (Needs Support first).
 */
function sortByPriority(groups: TodosByStudent[]): TodosByStudent[] {
  return [...groups].sort((a, b) => {
    const priorityA = getStudentPriority(a);
    const priorityB = getStudentPriority(b);
    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }
    // Same priority: sort alphabetically by name
    return a.studentName.localeCompare(b.studentName);
  });
}

// ============================================
// Types
// ============================================

interface TeacherTodosPanelProps {
  todos: TeacherTodo[];
  counts: TeacherTodoCounts;
  onUpdate?: () => void;
  onRefresh?: () => void; // Alias for onUpdate
  defaultExpanded?: boolean;
  /** When true, renders without the card/collapsible wrapper (for use in drawer) */
  embedded?: boolean;
}

// ============================================
// Main Component
// ============================================

export default function TeacherTodosPanel({
  todos,
  counts,
  onUpdate,
  onRefresh,
  defaultExpanded = false,
  embedded = false,
}: TeacherTodosPanelProps) {
  const navigate = useNavigate();
  const { showSuccess, showError } = useToast();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  // Use onRefresh as alias for onUpdate
  const handleUpdate = onUpdate || onRefresh;

  // Only show open todos in the main list
  const openTodos = todos.filter((t) => t.status === "open");

  // Group open todos by student and sort by priority
  const groupedByStudent = useMemo(
    () => sortByPriority(groupTodosByStudent(openTodos)),
    [openTodos]
  );

  // Handle marking a todo as complete (with toast undo)
  const handleComplete = async (id: string) => {
    setLoadingId(id);
    try {
      await completeTeacherTodo(id);
      // Refresh list immediately so the completed todo disappears
      handleUpdate?.();
      // Show toast with undo
      showSuccess("Follow-up marked complete.", {
        duration: 5000,
        action: {
          label: "Undo",
          onClick: async () => {
            try {
              await reopenTeacherTodo(id);
              handleUpdate?.();
              showSuccess("Follow-up reopened.");
            } catch (err) {
              console.error("Failed to undo completion:", err);
              showError("Failed to undo");
            }
          },
        },
      });
    } catch (err) {
      console.error("Failed to complete todo:", err);
      showError("Failed to complete follow-up");
    } finally {
      setLoadingId(null);
    }
  };

  // Handle reopening a completed todo (for already-done items, not undo)
  const handleReopen = async (id: string) => {
    setLoadingId(id);
    try {
      await reopenTeacherTodo(id);
      handleUpdate?.();
    } catch (err) {
      console.error("Failed to reopen todo:", err);
    } finally {
      setLoadingId(null);
    }
  };

  // Handle removing a todo and returning it to recommendations
  const handleRemoveToRecommendations = async (id: string) => {
    setLoadingId(id);
    setMenuOpenId(null);
    try {
      await deleteTeacherTodo(id, true); // true = reactivate recommendation
      handleUpdate?.();
    } catch (err) {
      console.error("Failed to remove todo:", err);
    } finally {
      setLoadingId(null);
    }
  };

  // Embedded mode for drawer - render content directly without collapsible wrapper
  if (embedded) {
    if (openTodos.length === 0) {
      return (
        <div style={{ textAlign: "center", padding: "32px 16px", color: "#666" }}>
          <span style={{ fontSize: "1rem", display: "block", marginBottom: "12px", fontWeight: 600, color: "#16a34a" }}>Done</span>
          <p style={{ margin: 0, fontWeight: 500 }}>All to-dos completed</p>
          <p style={{ margin: "8px 0 0 0", fontSize: "0.9rem" }}>
            No pending actions at this time.
          </p>
        </div>
      );
    }

    return (
      <div>
        {/* Subtitle */}
        {openTodos.length > 0 && (
          <p style={{ margin: "0 0 16px 0", color: "#666", fontSize: "0.9rem" }}>
            {counts.open} task{counts.open !== 1 ? "s" : ""} to complete
          </p>
        )}

        {/* Todo list - grouped by student */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
          {groupedByStudent.map((studentGroup, index) => (
            <StudentTodoGroup
              key={studentGroup.studentId}
              group={studentGroup}
              loadingId={loadingId}
              onComplete={handleComplete}
              onReopen={handleReopen}
              onRemoveToRecommendations={handleRemoveToRecommendations}
              menuOpenId={menuOpenId}
              setMenuOpenId={setMenuOpenId}
              isFirst={index === 0}
            />
          ))}
        </div>
      </div>
    );
  }

  // Don't show panel if no todos (non-embedded mode)
  if (counts.total === 0) {
    return null;
  }

  return (
    <div
      className="card"
      style={{
        marginTop: "16px",
        background: "#f5f5f5",
        borderLeft: "4px solid #7c8fce",
      }}
    >
      {/* Header - Always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span
            style={{
              transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform 0.2s",
              color: "#7c8fce",
            }}
          >
            ▶
          </span>
          <h3 style={{ margin: 0, color: "#7c8fce" }}>
            Teacher To-Dos
          </h3>
          <span
            style={{
              background: counts.open > 0 ? "#7c8fce" : "#9e9e9e",
              color: "white",
              padding: "2px 8px",
              borderRadius: "12px",
              fontSize: "0.85rem",
              fontWeight: 600,
            }}
          >
            {counts.open}
          </span>
        </div>

        {/* Print button - always visible */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            navigate("/educator/todos/print");
          }}
          style={{
            padding: "4px 12px",
            background: "transparent",
            color: "#7c8fce",
            border: "1px solid #7c8fce",
            borderRadius: "4px",
            cursor: "pointer",
            fontSize: "0.85rem",
            display: "flex",
            alignItems: "center",
            gap: "4px",
          }}
        >
          Print Sheet
        </button>
      </button>

      {/* Expanded Content */}
      {expanded && (
        <div style={{ marginTop: "16px" }}>
          {openTodos.length === 0 ? (
            <p style={{ color: "#666", fontStyle: "italic", margin: 0 }}>
              All to-dos completed. No pending actions.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
              {groupedByStudent.map((studentGroup, index) => (
                <StudentTodoGroup
                  key={studentGroup.studentId}
                  group={studentGroup}
                  loadingId={loadingId}
                  onComplete={handleComplete}
                  onReopen={handleReopen}
                  onRemoveToRecommendations={handleRemoveToRecommendations}
                  menuOpenId={menuOpenId}
                  setMenuOpenId={setMenuOpenId}
                  isFirst={index === 0}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================
// Student Group Component
// ============================================

interface StudentTodoGroupProps {
  group: TodosByStudent;
  loadingId: string | null;
  onComplete: (id: string) => void;
  onReopen: (id: string) => void;
  onRemoveToRecommendations: (id: string) => void;
  menuOpenId: string | null;
  setMenuOpenId: (id: string | null) => void;
  isFirst: boolean;
}

function StudentTodoGroup({
  group,
  loadingId,
  onComplete,
  onReopen,
  onRemoveToRecommendations,
  menuOpenId,
  setMenuOpenId,
  isFirst,
}: StudentTodoGroupProps) {
  const navigate = useNavigate();

  return (
    <div
      style={{
        paddingTop: isFirst ? 0 : "12px",
        marginTop: isFirst ? 0 : "12px",
        borderTop: isFirst ? "none" : "1px solid #e0e0e0",
      }}
    >
      {/* Student Header - strongest visual element */}
      <div
        style={{
          fontWeight: 600,
          marginBottom: "6px",
          fontSize: "0.95rem",
        }}
      >
        <a
          href={`/educator/student/${group.studentId}`}
          onClick={(e) => {
            e.preventDefault();
            navigate(`/educator/student/${group.studentId}`);
          }}
          style={{
            color: "#222",
            textDecoration: "none",
            borderBottom: "1px solid transparent",
            transition: "border-color 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderBottomColor = "#7c8fce";
            e.currentTarget.style.color = "#7c8fce";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderBottomColor = "transparent";
            e.currentTarget.style.color = "#222";
          }}
        >
          {group.studentName}
        </a>
      </div>

      {/* Student's Todos - tighter spacing within group */}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        {group.todos.map(({ todo, contextLine }) => (
          <TodoItem
            key={todo.id}
            todo={todo}
            contextLine={contextLine}
            studentId={group.studentId}
            loading={loadingId === todo.id}
            onComplete={() => onComplete(todo.id)}
            onReopen={() => onReopen(todo.id)}
            onRemoveToRecommendations={() => onRemoveToRecommendations(todo.id)}
            menuOpen={menuOpenId === todo.id}
            setMenuOpen={(open) => setMenuOpenId(open ? todo.id : null)}
          />
        ))}
      </div>
    </div>
  );
}

// ============================================
// Todo Item Component
// ============================================

interface TodoItemProps {
  todo: TeacherTodo;
  contextLine: string;
  studentId: string;
  loading: boolean;
  onComplete: () => void;
  onReopen: () => void;
  onRemoveToRecommendations: () => void;
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
}

function TodoItem({
  todo,
  contextLine,
  studentId,
  loading,
  onComplete,
  onReopen,
  onRemoveToRecommendations,
  menuOpen,
  setMenuOpen,
}: TodoItemProps) {
  const navigate = useNavigate();
  const isDone = todo.status === "done";

  // Navigate to StudentAssignmentReview when row is clicked
  const canNavigate = !!todo.assignmentId && !!studentId;
  const handleRowClick = () => {
    if (canNavigate) {
      navigate(`/educator/assignment/${todo.assignmentId}/student/${studentId}`);
    }
  };

  return (
    <div
      onClick={handleRowClick}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "8px",
        padding: "8px 10px",
        background: "white",
        borderRadius: "4px",
        opacity: isDone ? 0.6 : 1,
        position: "relative",
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
      {/* Checkbox */}
      <input
        type="checkbox"
        checked={isDone}
        onChange={isDone ? onReopen : onComplete}
        disabled={loading}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "14px",
          height: "14px",
          marginTop: "3px",
          cursor: loading ? "wait" : "pointer",
          accentColor: "#7c8fce",
          flexShrink: 0,
        }}
      />

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Context line (Subject · Assignment) - EMPHASIZED */}
        {contextLine && (
          <div
            style={{
              fontSize: "0.85rem",
              color: isDone ? "#999" : "#333",
              fontWeight: 500,
              textDecoration: isDone ? "line-through" : "none",
            }}
          >
            {contextLine}
          </div>
        )}

        {/* Action label + category - DE-EMPHASIZED */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            flexWrap: "wrap",
            marginTop: contextLine ? "2px" : 0,
          }}
        >
          <span
            style={{
              color: isDone ? "#aaa" : "#666",
              textDecoration: isDone ? "line-through" : "none",
              fontWeight: 400,
              fontSize: "0.8rem",
            }}
          >
            {todo.label}
          </span>
          {todo.category && (
            <span
              style={{
                fontSize: "0.7rem",
                color: "#777",
                background: "#ebebeb",
                padding: "1px 5px",
                borderRadius: "3px",
              }}
            >
              {getCategoryDisplayLabel(todo.category)}
            </span>
          )}
        </div>

        {/* Completion timestamp */}
        {isDone && todo.doneAt && (
          <div style={{ marginTop: "3px", fontSize: "0.7rem", color: "#aaa" }}>
            Completed {new Date(todo.doneAt).toLocaleDateString()}
          </div>
        )}
      </div>

      {/* Navigation indicator */}
      {canNavigate && !menuOpen && (
        <span
          style={{
            color: "#bbb",
            fontSize: "0.75rem",
            flexShrink: 0,
            marginTop: "3px",
            marginRight: isDone ? 0 : "-2px",
          }}
        >
          →
        </span>
      )}

      {/* More menu (three dots) - only for open todos */}
      {!isDone && (
        <div style={{ position: "relative", flexShrink: 0 }}>
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
            disabled={loading}
            style={{
              background: "transparent",
              border: "none",
              padding: "4px 6px",
              cursor: loading ? "wait" : "pointer",
              color: "#999",
              fontSize: "1rem",
              lineHeight: 1,
              borderRadius: "4px",
            }}
            title="More options"
          >
            ⋯
          </button>

          {/* Dropdown menu */}
          {menuOpen && (
            <>
              {/* Backdrop to close menu when clicking outside */}
              <div
                onClick={() => setMenuOpen(false)}
                style={{
                  position: "fixed",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  zIndex: 99,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  right: 0,
                  marginTop: "4px",
                  background: "white",
                  border: "1px solid #e0e0e0",
                  borderRadius: "6px",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                  zIndex: 100,
                  minWidth: "180px",
                }}
              >
                <button
                  onClick={(e) => { e.stopPropagation(); onRemoveToRecommendations(); }}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "10px 14px",
                    background: "transparent",
                    border: "none",
                    textAlign: "left",
                    cursor: "pointer",
                    fontSize: "0.85rem",
                    color: "#333",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#f5f5f5")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  Move back to Recommendations
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
