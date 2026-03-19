/**
 * AssignmentPreviewPanel - Read-only view of assignment content
 *
 * Displays the lesson content (questions, hints, and correctness criteria)
 * so teachers can review what students are working on while reviewing work.
 *
 * Features:
 * - Lesson metadata (title, description, subject, grade, difficulty)
 * - All questions in order
 * - Hints (collapsed by default)
 * - Correctness Criteria panel (learning objective, success criteria,
 *   evaluation focus, misconceptions) — visible when question is expanded
 * - Read-only - no editing controls
 * - Teacher-only: not used by any student-facing page
 */

import { useState } from "react";
import type { Lesson, Prompt, PromptAssessment } from "../services/api";

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
                  background: "#e8ecf0",
                  color: "#7b1fa2",
                  borderRadius: "4px",
                  fontWeight: 500,
                }}
              >
                {lesson.gradeLevel}
              </span>
            )}
          </div>

          {/* Description */}
          {lesson.description && (
            <p style={{ margin: "8px 0 0 0", fontSize: "0.9rem", color: "var(--text-secondary)" }}>
              {lesson.description}
            </p>
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
              color: "var(--text-muted)",
              cursor: "pointer",
              padding: "4px 8px",
              lineHeight: 1,
              borderRadius: "4px",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--text-secondary)";
              e.currentTarget.style.background = "#eee";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--text-muted)";
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

function QuestionCard({ prompt, index }: { prompt: Prompt; index: number }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      style={{
        background: "#fff",
        borderRadius: "8px",
        border: expanded ? "1px solid #c0cfe0" : "1px solid #e8e8e8",
        overflow: "hidden",
        transition: "border-color 0.15s",
      }}
    >
      {/* Question Header — clickable to expand */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          padding: "12px 16px",
          display: "flex",
          alignItems: "flex-start",
          gap: "12px",
          cursor: "pointer",
          transition: "background 0.15s",
        }}
        onMouseEnter={(e) => {
          if (!expanded) e.currentTarget.style.background = "#f9fafb";
        }}
        onMouseLeave={(e) => {
          if (!expanded) e.currentTarget.style.background = "transparent";
        }}
      >
        {/* Question number */}
        <span
          style={{
            flexShrink: 0,
            width: "24px",
            height: "24px",
            borderRadius: "50%",
            background: "#3d5a80",
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
                color: "var(--text-muted)",
                borderRadius: "4px",
                textTransform: "capitalize",
              }}
            >
              {prompt.type}
            </span>

            {/* Hints count */}
            {prompt.hints.length > 0 && (
              <span style={{ fontSize: "0.75rem", color: "#3d5a80" }}>
                {prompt.hints.length} hint{prompt.hints.length !== 1 ? "s" : ""}
              </span>
            )}

            {/* Criteria indicator when collapsed */}
            {!expanded && prompt.assessment?.learningObjective && (
              <span style={{
                fontSize: "0.65rem",
                padding: "1px 6px",
                background: "#dcfce7",
                color: "#16a34a",
                borderRadius: "3px",
                fontWeight: 500,
              }}>
                criteria
              </span>
            )}
          </div>
        </div>

        {/* Expand/collapse chevron */}
        <span
          style={{
            color: "#3d5a80",
            fontSize: "0.8rem",
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.2s",
            flexShrink: 0,
            marginTop: "4px",
          }}
        >
          ▼
        </span>
      </div>

      {/* Expanded content: hints + criteria */}
      {expanded && (
        <div style={{ borderTop: "1px solid #f0f0f0" }}>
          {/* Hints */}
          {prompt.hints.length > 0 && (
            <div
              style={{
                padding: "12px 16px",
                paddingLeft: "52px",
                background: "#fafafa",
              }}
            >
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "8px", fontWeight: 500 }}>
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
                  <li key={idx} style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                    {hint}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Correctness Criteria */}
          <CorrectnessCriteriaPanel assessment={prompt.assessment} />
        </div>
      )}
    </div>
  );
}

// ============================================
// Correctness Criteria Panel (read-only, teacher-only)
// ============================================

function CorrectnessCriteriaPanel({ assessment }: { assessment?: PromptAssessment }) {
  const [showMisconceptions, setShowMisconceptions] = useState(false);

  const hasStructuredCriteria = assessment && (
    assessment.learningObjective ||
    (assessment.expectedConcepts && assessment.expectedConcepts.length > 0) ||
    assessment.requiredExamples ||
    (assessment.validVocabulary && assessment.validVocabulary.length > 0) ||
    assessment.scoringLevels
  );

  // Legacy check: old-format lessons may only have successCriteria
  const hasLegacyCriteria = assessment && !hasStructuredCriteria && (
    (assessment.successCriteria && assessment.successCriteria.length > 0) ||
    (assessment.evaluationFocus && assessment.evaluationFocus.length > 0)
  );

  // Graceful fallback for assignments without any criteria
  if (!hasStructuredCriteria && !hasLegacyCriteria) {
    return (
      <div style={{
        padding: "10px 16px",
        paddingLeft: "52px",
        background: "#f8f9fa",
        borderTop: "1px solid #f0f0f0",
      }}>
        <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", fontStyle: "italic" }}>
          Criteria not configured for this question
        </span>
      </div>
    );
  }

  const hasMisconceptions = assessment!.misconceptions && assessment!.misconceptions.length > 0;
  const sectionLabelStyle = { fontSize: "0.72rem", fontWeight: 500 as const, color: "#5a7a9e", marginBottom: "3px" };

  return (
    <div style={{
      padding: "12px 16px",
      paddingLeft: "52px",
      background: "#f0f7ff",
      borderTop: "1px solid #e0ecf5",
    }}>
      {/* Section header */}
      <div style={{
        fontSize: "0.75rem",
        fontWeight: 600,
        color: "#3d5a80",
        marginBottom: "2px",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
      }}>
        Correctness Criteria
      </div>
      <div style={{ fontSize: "0.7rem", color: "#7a8ea8", marginBottom: "10px" }}>
        Used for scoring and coach feedback
      </div>

      {/* 1. Learning Objective */}
      {assessment!.learningObjective && (
        <div style={{ marginBottom: "10px" }}>
          <div style={sectionLabelStyle}>Learning Objective</div>
          <p style={{ margin: 0, fontSize: "0.85rem", color: "#333", lineHeight: 1.5 }}>
            {assessment!.learningObjective}
          </p>
        </div>
      )}

      {/* 2. Expected Concepts */}
      {assessment!.expectedConcepts && assessment!.expectedConcepts.length > 0 && (
        <div style={{ marginBottom: "10px" }}>
          <div style={sectionLabelStyle}>Expected Concepts</div>
          <ul style={{ margin: 0, paddingLeft: "16px", display: "flex", flexDirection: "column", gap: "3px" }}>
            {assessment!.expectedConcepts.map((item, idx) => (
              <li key={idx} style={{ fontSize: "0.82rem", color: "#444", lineHeight: 1.4 }}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 3. Required Examples */}
      {assessment!.requiredExamples && (
        <div style={{ marginBottom: "10px" }}>
          <div style={sectionLabelStyle}>Required Examples</div>
          <p style={{ margin: 0, fontSize: "0.82rem", color: "#444", lineHeight: 1.4 }}>
            {assessment!.requiredExamples}
          </p>
        </div>
      )}

      {/* 4. Valid Vocabulary */}
      {assessment!.validVocabulary && assessment!.validVocabulary.length > 0 && (
        <div style={{ marginBottom: "10px" }}>
          <div style={sectionLabelStyle}>Valid Vocabulary</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
            {assessment!.validVocabulary.map((word, idx) => (
              <span key={idx} style={{
                fontSize: "0.75rem",
                padding: "2px 8px",
                background: "#e8f4f8",
                color: "#1a5276",
                borderRadius: "10px",
                fontWeight: 500,
              }}>
                {word}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 5. Common Misconceptions */}
      {hasMisconceptions && (
        <div style={{ marginBottom: assessment!.scoringLevels ? "10px" : "0" }}>
          <button
            onClick={() => setShowMisconceptions(!showMisconceptions)}
            style={{
              background: "none",
              border: "none",
              padding: "0",
              fontSize: "0.75rem",
              color: "#7a8ea8",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "4px",
              fontWeight: 500,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "#3d5a80"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "#7a8ea8"; }}
          >
            <span style={{
              display: "inline-block",
              transform: showMisconceptions ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform 0.15s",
              fontSize: "0.6rem",
            }}>
              ▶
            </span>
            Common Misconceptions ({assessment!.misconceptions!.length})
          </button>

          {showMisconceptions && (
            <ul style={{ margin: "6px 0 0 0", paddingLeft: "16px", display: "flex", flexDirection: "column", gap: "3px" }}>
              {assessment!.misconceptions!.map((item, idx) => (
                <li key={idx} style={{ fontSize: "0.82rem", color: "#666", lineHeight: 1.4, fontStyle: "italic" }}>
                  {item}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* 6. Scoring Levels */}
      {assessment!.scoringLevels && (
        <div>
          <div style={sectionLabelStyle}>Scoring Levels</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "4px" }}>
            {([
              { key: "strong" as const, label: "Strong", color: "#16a34a", bg: "#f0fdf4" },
              { key: "developing" as const, label: "Developing", color: "#d97706", bg: "#fffbeb" },
              { key: "needsSupport" as const, label: "Needs Support", color: "#dc2626", bg: "#fef2f2" },
            ] as const).map(({ key, label, color, bg }) => (
              <div key={key} style={{
                display: "flex",
                gap: "8px",
                alignItems: "baseline",
                padding: "4px 8px",
                background: bg,
                borderRadius: "6px",
              }}>
                <span style={{
                  fontSize: "0.7rem",
                  fontWeight: 600,
                  color,
                  minWidth: "90px",
                  flexShrink: 0,
                }}>
                  {label}
                </span>
                <span style={{ fontSize: "0.8rem", color: "#444", lineHeight: 1.4 }}>
                  {assessment!.scoringLevels![key]}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Legacy fallback: show successCriteria if no structured fields present */}
      {hasLegacyCriteria && assessment!.successCriteria && assessment!.successCriteria.length > 0 && (
        <div style={{ marginBottom: "10px" }}>
          <div style={sectionLabelStyle}>A strong response includes</div>
          <ul style={{ margin: 0, paddingLeft: "16px", display: "flex", flexDirection: "column", gap: "3px" }}>
            {assessment!.successCriteria.map((item, idx) => (
              <li key={idx} style={{ fontSize: "0.82rem", color: "#444", lineHeight: 1.4 }}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
