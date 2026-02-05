/**
 * TeacherTodosPrint - Printable Teacher To-Do Sheet
 *
 * A clean, print-optimized page showing all open teacher to-dos
 * organized by student.
 *
 * Features:
 * - Print-optimized layout (no navigation, minimal styling)
 * - Grouped by student with context lines
 * - Checkbox format for easy printing
 * - Date header with total count
 * - Print button triggers browser print dialog
 */

import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  getTeacherTodos,
  type TeacherTodo,
  type TodosByStudent,
  type RecommendationCategory,
  groupTodosByStudent,
} from "../services/api";

// Priority ordering (same as panel)
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

function sortByPriority(groups: TodosByStudent[]): TodosByStudent[] {
  return [...groups].sort((a, b) => {
    const priorityA = getStudentPriority(a);
    const priorityB = getStudentPriority(b);
    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }
    return a.studentName.localeCompare(b.studentName);
  });
}

export default function TeacherTodosPrint() {
  const [todos, setTodos] = useState<TeacherTodo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Group todos by student and sort by priority
  const groupedByStudent = useMemo(
    () => sortByPriority(groupTodosByStudent(todos)),
    [todos]
  );

  useEffect(() => {
    async function loadTodos() {
      try {
        const data = await getTeacherTodos({ status: "open" });
        setTodos(data.todos);
      } catch (err) {
        console.error("Failed to load todos:", err);
        setError("Failed to load to-do items");
      } finally {
        setLoading(false);
      }
    }
    loadTodos();
  }, []);

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return (
      <div className="print-page">
        <p>Loading to-do items...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="print-page">
        <p style={{ color: "#d32f2f" }}>{error}</p>
        <Link to="/educator" style={{ color: "#667eea" }}>
          Back to Dashboard
        </Link>
      </div>
    );
  }

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <>
      {/* Print-specific styles */}
      <style>
        {`
          @media print {
            .no-print {
              display: none !important;
            }
            .print-page {
              padding: 0;
              margin: 0;
              background: white;
            }
            .print-container {
              max-width: none;
              padding: 0;
            }
            .todo-checkbox {
              width: 16px;
              height: 16px;
              border: 2px solid #333;
              margin-right: 12px;
            }
            body {
              background: white !important;
            }
            .app {
              background: white !important;
              min-height: auto !important;
            }
          }

          @media screen {
            .print-page {
              background: white;
              min-height: 100vh;
              padding: 24px;
            }
            .print-container {
              max-width: 800px;
              margin: 0 auto;
            }
          }

          .print-header {
            border-bottom: 2px solid #333;
            padding-bottom: 16px;
            margin-bottom: 24px;
          }

          .print-title {
            font-size: 24px;
            font-weight: bold;
            margin: 0;
            color: #333;
          }

          .print-date {
            font-size: 14px;
            color: #666;
            margin-top: 4px;
          }

          .student-section {
            padding-top: 16px;
            margin-top: 16px;
            border-top: 1px solid #ccc;
            page-break-inside: avoid;
          }

          .student-section:first-child {
            padding-top: 0;
            margin-top: 0;
            border-top: none;
          }

          .student-header {
            font-size: 15px;
            font-weight: bold;
            color: #222;
            margin-bottom: 8px;
          }

          .todo-item {
            display: flex;
            align-items: flex-start;
            margin-bottom: 6px;
            margin-left: 4px;
            page-break-inside: avoid;
          }

          .todo-checkbox {
            width: 12px;
            height: 12px;
            border: 1.5px solid #444;
            border-radius: 2px;
            margin-right: 8px;
            margin-top: 3px;
            flex-shrink: 0;
          }

          .todo-content {
            flex: 1;
          }

          .todo-context {
            font-size: 12px;
            color: #333;
            font-weight: 500;
          }

          .todo-action {
            font-size: 11px;
            color: #666;
            margin-top: 1px;
          }

          .todo-category {
            font-weight: normal;
            color: #888;
            font-size: 10px;
          }

          .empty-state {
            text-align: center;
            padding: 48px;
            color: #666;
          }

          .print-footer {
            margin-top: 32px;
            padding-top: 16px;
            border-top: 1px solid #ddd;
            font-size: 12px;
            color: #999;
            text-align: center;
          }
        `}
      </style>

      <div className="print-page">
        <div className="print-container">
          {/* Screen-only buttons */}
          <div
            className="no-print"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "24px",
              padding: "12px 16px",
              background: "#f5f5f5",
              borderRadius: "8px",
            }}
          >
            <Link
              to="/educator"
              style={{
                color: "#667eea",
                textDecoration: "none",
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              ← Back to Dashboard
            </Link>
            <button
              onClick={handlePrint}
              style={{
                padding: "8px 16px",
                background: "#667eea",
                color: "white",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                fontSize: "14px",
                fontWeight: 500,
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <span>🖨️</span>
              Print Sheet
            </button>
          </div>

          {/* Header */}
          <div className="print-header">
            <h1 className="print-title">Teacher To-Do Sheet</h1>
            <div className="print-date">{today}</div>
            <div className="print-date" style={{ marginTop: "4px" }}>
              {todos.length} item{todos.length !== 1 ? "s" : ""} pending
            </div>
          </div>

          {/* Content - Grouped by Student, sorted by priority */}
          {todos.length === 0 ? (
            <div className="empty-state">
              <p>No to-do items pending.</p>
              <p style={{ marginTop: "8px" }}>
                To-do items are created when you select soft actions from recommendation checklists.
              </p>
            </div>
          ) : (
            groupedByStudent.map((studentGroup) => (
              <div key={studentGroup.studentId} className="student-section">
                <div className="student-header">{studentGroup.studentName}</div>

                {studentGroup.todos.map(({ todo, contextLine }) => (
                  <div key={todo.id} className="todo-item">
                    <div className="todo-checkbox" />
                    <div className="todo-content">
                      {/* Context line - EMPHASIZED */}
                      {contextLine && (
                        <div className="todo-context">{contextLine}</div>
                      )}
                      {/* Action + category - DE-EMPHASIZED */}
                      <div className="todo-action">
                        {todo.label}
                        {todo.category && (
                          <span className="todo-category"> · {getCategoryDisplayLabel(todo.category)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}

          {/* Footer */}
          <div className="print-footer">
            Promptly Learn • Teacher To-Do Sheet • {today}
          </div>
        </div>
      </div>
    </>
  );
}
