/**
 * AssignmentPreviewPanel - Read-only view of assignment content
 *
 * Displays the lesson content (questions and hints) so teachers can
 * review what students are working on while reviewing their work.
 *
 * Features:
 * - Lesson metadata (title, description, subject, grade, difficulty)
 * - Standards chips
 * - All questions in order
 * - Hints (collapsed by default)
 * - Read-only - no editing controls
 */

import { useState } from "react";
import type { Lesson } from "../services/api";

interface AssignmentPreviewPanelProps {
  lesson: Lesson;
  onClose: () => void;
}

export default function AssignmentPreviewPanel({ lesson, onClose }: AssignmentPreviewPanelProps) {
  return (
    <div
      style={{
        background: "#fafafa",
        border: "1px solid #e0e0e0",
        borderRadius: "12px",
        marginBottom: "24px",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          padding: "16px 20px",
          borderBottom: "1px solid #e0e0e0",
          background: "#f5f5f5",
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
            <h3 style={{ margin: 0, fontSize: "1.1rem", color: "#333" }}>
              Assignment Content
            </h3>
            {/* Metadata badges */}
            {lesson.subject && (
              <span
                style={{
                  fontSize: "0.75rem",
                  padding: "3px 8px",
                  background: "#e3f2fd",
                  color: "#1565c0",
                  borderRadius: "4px",
                  fontWeight: 500,
                }}
              >
                {lesson.subject}
              </span>
            )}
            {lesson.gradeLevel && (
              <span
                style={{
                  fontSize: "0.75rem",
                  padding: "3px 8px",
                  background: "#f3e5f5",
                  color: "#7b1fa2",
                  borderRadius: "4px",
                  fontWeight: 500,
                }}
              >
                {lesson.gradeLevel}
              </span>
            )}
            <span
              style={{
                fontSize: "0.75rem",
                padding: "3px 8px",
                background:
                  lesson.difficulty === "beginner"
                    ? "#e8f5e9"
                    : lesson.difficulty === "intermediate"
                    ? "#fff3e0"
                    : "#ffebee",
                color:
                  lesson.difficulty === "beginner"
                    ? "#2e7d32"
                    : lesson.difficulty === "intermediate"
                    ? "#ed6c02"
                    : "#d32f2f",
                borderRadius: "4px",
                fontWeight: 500,
                textTransform: "capitalize",
              }}
            >
              {lesson.difficulty}
            </span>
          </div>

          {/* Description */}
          {lesson.description && (
            <p style={{ margin: "8px 0 0 0", fontSize: "0.9rem", color: "#666" }}>
              {lesson.description}
            </p>
          )}

          {/* Standards */}
          {lesson.standards && lesson.standards.length > 0 && (
            <div style={{ marginTop: "8px", display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {lesson.standards.map((standard, idx) => (
                <span
                  key={idx}
                  style={{
                    fontSize: "0.7rem",
                    padding: "2px 6px",
                    background: "#fff",
                    border: "1px solid #ddd",
                    borderRadius: "4px",
                    color: "#666",
                  }}
                >
                  {standard}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Close button */}
        <div style={{ marginLeft: "16px" }}>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: "1.2rem",
              color: "#999",
              cursor: "pointer",
              padding: "4px 8px",
              lineHeight: 1,
              borderRadius: "4px",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "#666";
              e.currentTarget.style.background = "#eee";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "#999";
              e.currentTarget.style.background = "none";
            }}
            aria-label="Close preview"
          >
            ×
          </button>
        </div>
      </div>

      {/* Questions List */}
      <div style={{ padding: "16px 20px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {lesson.prompts.map((prompt, index) => (
            <QuestionCard key={prompt.id} prompt={prompt} index={index} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================
// Question Card Component
// ============================================

interface QuestionCardProps {
  prompt: {
    id: string;
    type: string;
    input: string;
    hints: string[];
    standards?: string[];
  };
  index: number;
}

function QuestionCard({ prompt, index }: QuestionCardProps) {
  const [showHints, setShowHints] = useState(false);

  return (
    <div
      style={{
        background: "#fff",
        borderRadius: "8px",
        border: "1px solid #e8e8e8",
        overflow: "hidden",
      }}
    >
      {/* Question Header */}
      <div
        style={{
          padding: "12px 16px",
          display: "flex",
          alignItems: "flex-start",
          gap: "12px",
        }}
      >
        {/* Question number */}
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
          }}
        >
          {index + 1}
        </span>

        {/* Question content */}
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontSize: "0.95rem", color: "#333", lineHeight: 1.5 }}>
            {prompt.input}
          </p>

          {/* Question metadata */}
          <div
            style={{
              marginTop: "8px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              flexWrap: "wrap",
            }}
          >
            {/* Question type */}
            <span
              style={{
                fontSize: "0.7rem",
                padding: "2px 6px",
                background: "#f5f5f5",
                color: "#888",
                borderRadius: "4px",
                textTransform: "capitalize",
              }}
            >
              {prompt.type}
            </span>

            {/* Question standards */}
            {prompt.standards?.map((std, idx) => (
              <span
                key={idx}
                style={{
                  fontSize: "0.7rem",
                  padding: "2px 6px",
                  background: "#fff8e1",
                  color: "#f57c00",
                  borderRadius: "4px",
                }}
              >
                {std}
              </span>
            ))}

            {/* Hints toggle */}
            {prompt.hints.length > 0 && (
              <button
                onClick={() => setShowHints(!showHints)}
                style={{
                  background: "none",
                  border: "none",
                  padding: "2px 6px",
                  fontSize: "0.75rem",
                  color: "#667eea",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <span>{showHints ? "▼" : "▶"}</span>
                {prompt.hints.length} hint{prompt.hints.length !== 1 ? "s" : ""}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Hints (collapsed by default) */}
      {showHints && prompt.hints.length > 0 && (
        <div
          style={{
            padding: "12px 16px",
            paddingLeft: "52px",
            background: "#fafafa",
            borderTop: "1px solid #f0f0f0",
          }}
        >
          <div style={{ fontSize: "0.75rem", color: "#888", marginBottom: "8px", fontWeight: 500 }}>
            Hints:
          </div>
          <ol
            style={{
              margin: 0,
              paddingLeft: "16px",
              display: "flex",
              flexDirection: "column",
              gap: "4px",
            }}
          >
            {prompt.hints.map((hint, idx) => (
              <li key={idx} style={{ fontSize: "0.85rem", color: "#555" }}>
                {hint}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
