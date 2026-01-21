/**
 * TeacherTodosPrint - Printable Teacher To-Do Sheet
 *
 * A clean, print-optimized page showing all open teacher to-dos
 * organized by class > subject > assignment.
 *
 * Features:
 * - Print-optimized layout (no navigation, minimal styling)
 * - Grouped by class, then subject, then assignment
 * - Checkbox format for easy printing
 * - Date header
 * - Print button triggers browser print dialog
 */

import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  getTeacherTodos,
  type TeacherTodo,
  type TodosByClass,
} from "../services/api";

export default function TeacherTodosPrint() {
  const [todos, setTodos] = useState<TeacherTodo[]>([]);
  const [groupedTodos, setGroupedTodos] = useState<TodosByClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadTodos() {
      try {
        const data = await getTeacherTodos({ status: "open", grouped: true });
        setTodos(data.todos);
        setGroupedTodos(data.grouped || []);
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

          .class-section {
            margin-bottom: 32px;
          }

          .class-header {
            font-size: 18px;
            font-weight: bold;
            color: #333;
            border-bottom: 1px solid #ddd;
            padding-bottom: 8px;
            margin-bottom: 16px;
          }

          .subject-section {
            margin-bottom: 20px;
            margin-left: 16px;
          }

          .subject-header {
            font-size: 14px;
            font-weight: 600;
            color: #666;
            margin-bottom: 12px;
          }

          .assignment-section {
            margin-bottom: 16px;
            margin-left: 16px;
          }

          .assignment-header {
            font-size: 13px;
            color: #888;
            margin-bottom: 8px;
            font-style: italic;
          }

          .todo-item {
            display: flex;
            align-items: flex-start;
            margin-bottom: 12px;
            page-break-inside: avoid;
          }

          .todo-checkbox {
            width: 16px;
            height: 16px;
            border: 2px solid #333;
            border-radius: 2px;
            margin-right: 12px;
            margin-top: 2px;
            flex-shrink: 0;
          }

          .todo-content {
            flex: 1;
          }

          .todo-label {
            font-size: 14px;
            color: #333;
            margin-bottom: 2px;
          }

          .todo-students {
            font-size: 12px;
            color: #666;
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

          {/* Content */}
          {todos.length === 0 ? (
            <div className="empty-state">
              <p>No to-do items pending.</p>
              <p style={{ marginTop: "8px" }}>
                To-do items are created when you select soft actions from recommendation checklists.
              </p>
            </div>
          ) : groupedTodos.length > 0 ? (
            // Grouped view
            groupedTodos.map((classGroup) => (
              <div key={classGroup.classId || "general"} className="class-section">
                <h2 className="class-header">{classGroup.className}</h2>

                {classGroup.subjects.map((subjectGroup, sIdx) => (
                  <div key={sIdx} className="subject-section">
                    {subjectGroup.subject && (
                      <h3 className="subject-header">{subjectGroup.subject}</h3>
                    )}

                    {subjectGroup.assignments.map((assignmentGroup, aIdx) => (
                      <div key={aIdx} className="assignment-section">
                        {assignmentGroup.assignmentTitle && (
                          <div className="assignment-header">
                            {assignmentGroup.assignmentTitle}
                          </div>
                        )}

                        {assignmentGroup.todos.map((todo) => (
                          <div key={todo.id} className="todo-item">
                            <div className="todo-checkbox" />
                            <div className="todo-content">
                              <div className="todo-label">{todo.label}</div>
                              {todo.studentNames && (
                                <div className="todo-students">
                                  Students: {todo.studentNames}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))
          ) : (
            // Flat view (fallback)
            <div className="class-section">
              {todos.map((todo) => (
                <div key={todo.id} className="todo-item">
                  <div className="todo-checkbox" />
                  <div className="todo-content">
                    <div className="todo-label">{todo.label}</div>
                    <div className="todo-students">
                      {[
                        todo.className,
                        todo.assignmentTitle,
                        todo.studentNames && `Students: ${todo.studentNames}`,
                      ]
                        .filter(Boolean)
                        .join(" • ")}
                    </div>
                  </div>
                </div>
              ))}
            </div>
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
