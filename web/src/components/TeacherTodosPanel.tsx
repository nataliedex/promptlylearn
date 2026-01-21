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
 * - Link to printable to-do sheet
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  type TeacherTodo,
  type TeacherTodoCounts,
  completeTeacherTodo,
  reopenTeacherTodo,
} from "../services/api";

// ============================================
// Types
// ============================================

interface TeacherTodosPanelProps {
  todos: TeacherTodo[];
  counts: TeacherTodoCounts;
  onUpdate: () => void;
  defaultExpanded?: boolean;
}

// ============================================
// Main Component
// ============================================

export default function TeacherTodosPanel({
  todos,
  counts,
  onUpdate,
  defaultExpanded = false,
}: TeacherTodosPanelProps) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  // Only show open todos in the main list
  const openTodos = todos.filter((t) => t.status === "open");

  // Handle marking a todo as complete
  const handleComplete = async (id: string) => {
    setLoadingId(id);
    try {
      await completeTeacherTodo(id);
      onUpdate();
    } catch (err) {
      console.error("Failed to complete todo:", err);
    } finally {
      setLoadingId(null);
    }
  };

  // Handle reopening a completed todo
  const handleReopen = async (id: string) => {
    setLoadingId(id);
    try {
      await reopenTeacherTodo(id);
      onUpdate();
    } catch (err) {
      console.error("Failed to reopen todo:", err);
    } finally {
      setLoadingId(null);
    }
  };

  // Don't show panel if no todos
  if (counts.total === 0) {
    return null;
  }

  return (
    <div
      className="card"
      style={{
        marginTop: "16px",
        background: "#f5f5f5",
        borderLeft: "4px solid #5c6bc0",
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
              color: "#5c6bc0",
            }}
          >
            ▶
          </span>
          <h3 style={{ margin: 0, color: "#5c6bc0" }}>
            Teacher To-Dos
          </h3>
          <span
            style={{
              background: counts.open > 0 ? "#5c6bc0" : "#9e9e9e",
              color: "white",
              padding: "2px 8px",
              borderRadius: "12px",
              fontSize: "0.85rem",
              fontWeight: 600,
            }}
          >
            {counts.open}
          </span>
          {counts.done > 0 && (
            <span
              style={{
                color: "#9e9e9e",
                fontSize: "0.85rem",
              }}
            >
              ({counts.done} completed)
            </span>
          )}
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
            color: "#5c6bc0",
            border: "1px solid #5c6bc0",
            borderRadius: "4px",
            cursor: "pointer",
            fontSize: "0.85rem",
            display: "flex",
            alignItems: "center",
            gap: "4px",
          }}
        >
          <span>🖨️</span>
          Print Sheet
        </button>
      </button>

      {/* Expanded Content */}
      {expanded && (
        <div style={{ marginTop: "16px" }}>
          {openTodos.length === 0 ? (
            <p style={{ color: "#666", fontStyle: "italic", margin: 0 }}>
              All to-dos completed! Great job.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {openTodos.map((todo) => (
                <TodoItem
                  key={todo.id}
                  todo={todo}
                  loading={loadingId === todo.id}
                  onComplete={() => handleComplete(todo.id)}
                  onReopen={() => handleReopen(todo.id)}
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
// Todo Item Component
// ============================================

interface TodoItemProps {
  todo: TeacherTodo;
  loading: boolean;
  onComplete: () => void;
  onReopen: () => void;
}

function TodoItem({ todo, loading, onComplete, onReopen }: TodoItemProps) {
  const isDone = todo.status === "done";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "12px",
        padding: "12px",
        background: "white",
        borderRadius: "8px",
        opacity: isDone ? 0.7 : 1,
      }}
    >
      {/* Checkbox */}
      <input
        type="checkbox"
        checked={isDone}
        onChange={isDone ? onReopen : onComplete}
        disabled={loading}
        style={{
          width: "18px",
          height: "18px",
          marginTop: "2px",
          cursor: loading ? "wait" : "pointer",
          accentColor: "#5c6bc0",
        }}
      />

      {/* Content */}
      <div style={{ flex: 1 }}>
        <div
          style={{
            color: isDone ? "#999" : "#333",
            textDecoration: isDone ? "line-through" : "none",
            fontWeight: 500,
          }}
        >
          {todo.label}
        </div>

        {/* Context info */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "8px",
            marginTop: "4px",
            fontSize: "0.85rem",
            color: "#666",
          }}
        >
          {todo.studentNames && (
            <span>
              <span style={{ color: "#999" }}>Students:</span> {todo.studentNames}
            </span>
          )}
          {todo.assignmentTitle && (
            <span>
              <span style={{ color: "#999" }}>Assignment:</span> {todo.assignmentTitle}
            </span>
          )}
          {todo.className && (
            <span>
              <span style={{ color: "#999" }}>Class:</span> {todo.className}
            </span>
          )}
        </div>

        {/* Completion timestamp */}
        {isDone && todo.doneAt && (
          <div style={{ marginTop: "4px", fontSize: "0.8rem", color: "#9e9e9e" }}>
            Completed {new Date(todo.doneAt).toLocaleDateString()}
          </div>
        )}
      </div>
    </div>
  );
}
