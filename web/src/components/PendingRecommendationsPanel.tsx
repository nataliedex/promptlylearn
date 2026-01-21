/**
 * PendingRecommendationsPanel - Collapsible Panel for Pending Recommendations
 *
 * Displays recommendations where system actions (like reassign) have been
 * executed but students haven't completed the follow-up action yet.
 *
 * Features:
 * - Collapsed by default to keep dashboard calm
 * - Shows "Awaiting student action" indicator
 * - Links to student/assignment for follow-up
 */

import { useState } from "react";
import { type Recommendation } from "../services/api";

// ============================================
// Types
// ============================================

interface PendingRecommendationsPanelProps {
  recommendations: Recommendation[];
  onNavigate?: (studentId: string, assignmentId?: string) => void;
  defaultExpanded?: boolean;
}

// ============================================
// Main Component
// ============================================

export default function PendingRecommendationsPanel({
  recommendations,
  onNavigate,
  defaultExpanded = false,
}: PendingRecommendationsPanelProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  // Filter to pending only
  const pendingRecs = recommendations.filter((r) => r.status === "pending");

  // Don't show panel if no pending items
  if (pendingRecs.length === 0) {
    return null;
  }

  return (
    <div
      className="card"
      style={{
        marginTop: "16px",
        background: "#fff3e0",
        borderLeft: "4px solid #ef6c00",
      }}
    >
      {/* Header - Always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          width: "100%",
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span
          style={{
            transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 0.2s",
            color: "#ef6c00",
          }}
        >
          ▶
        </span>
        <h3 style={{ margin: 0, color: "#ef6c00" }}>
          Pending
        </h3>
        <span
          style={{
            background: "#ef6c00",
            color: "white",
            padding: "2px 8px",
            borderRadius: "12px",
            fontSize: "0.85rem",
            fontWeight: 600,
          }}
        >
          {pendingRecs.length}
        </span>
        <span
          style={{
            fontSize: "0.85rem",
            color: "#666",
          }}
        >
          Awaiting student action
        </span>
      </button>

      {/* Expanded Content */}
      {expanded && (
        <div style={{ marginTop: "16px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {pendingRecs.map((rec) => (
              <PendingItem
                key={rec.id}
                recommendation={rec}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// Pending Item Component
// ============================================

interface PendingItemProps {
  recommendation: Recommendation;
  onNavigate?: (studentId: string, assignmentId?: string) => void;
}

function PendingItem({ recommendation, onNavigate }: PendingItemProps) {
  // Get student name from signals
  const studentName =
    (recommendation.triggerData.signals.studentName as string) ||
    (recommendation.triggerData.signals.studentNames as string) ||
    (recommendation.studentIds.length === 1
      ? `Student ${recommendation.studentIds[0].slice(0, 6)}`
      : `${recommendation.studentIds.length} students`);

  // Get submitted actions (what teacher did)
  const submittedActions = recommendation.submittedActions || [];
  const systemActions = submittedActions.filter((a) =>
    ["assign_practice", "reassign_student"].includes(a.actionKey)
  );

  const handleClick = () => {
    if (onNavigate && recommendation.studentIds.length > 0) {
      onNavigate(recommendation.studentIds[0], recommendation.assignmentId);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "12px",
        padding: "12px",
        background: "white",
        borderRadius: "8px",
        cursor: onNavigate ? "pointer" : "default",
        transition: "transform 0.1s, box-shadow 0.1s",
      }}
      onClick={handleClick}
      onMouseEnter={(e) => {
        if (onNavigate) {
          e.currentTarget.style.transform = "translateX(4px)";
          e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.1)";
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateX(0)";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      {/* Icon */}
      <span style={{ fontSize: "1.25rem" }}>⏳</span>

      {/* Content */}
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 500, color: "#333" }}>
          {studentName}
        </div>

        {/* What was done */}
        {systemActions.length > 0 && (
          <div
            style={{
              marginTop: "4px",
              fontSize: "0.85rem",
              color: "#666",
            }}
          >
            {systemActions.map((action) => (
              <span key={action.actionKey} style={{ marginRight: "8px" }}>
                {action.actionKey === "reassign_student" && "📤 Reassigned"}
                {action.actionKey === "assign_practice" && "📚 Practice assigned"}
              </span>
            ))}
            {systemActions[0]?.submittedAt && (
              <span style={{ color: "#999" }}>
                on {new Date(systemActions[0].submittedAt).toLocaleDateString()}
              </span>
            )}
          </div>
        )}

        {/* Assignment context */}
        {recommendation.triggerData.signals.assignmentTitle && (
          <div
            style={{
              marginTop: "4px",
              fontSize: "0.85rem",
              color: "#999",
            }}
          >
            {recommendation.triggerData.signals.assignmentTitle as string}
          </div>
        )}
      </div>

      {/* Arrow */}
      {onNavigate && (
        <span style={{ color: "#ef6c00", fontSize: "1rem" }}>→</span>
      )}
    </div>
  );
}
