/**
 * ArchivedRecommendationsPanel - Collapsible Panel for Dismissed Recommendations
 *
 * Displays recommendations that were dismissed by the teacher.
 * Collapsed by default to keep the dashboard calm.
 */

import { useState } from "react";
import { type Recommendation } from "../services/api";

// ============================================
// Types
// ============================================

interface ArchivedRecommendationsPanelProps {
  recommendations: Recommendation[];
  defaultExpanded?: boolean;
}

// ============================================
// Main Component
// ============================================

export default function ArchivedRecommendationsPanel({
  recommendations,
  defaultExpanded = false,
}: ArchivedRecommendationsPanelProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  // Filter to dismissed only
  const dismissedRecs = recommendations.filter((r) => r.status === "dismissed");

  // Don't show panel if no dismissed items
  if (dismissedRecs.length === 0) {
    return null;
  }

  return (
    <div
      className="card"
      style={{
        marginTop: "16px",
        background: "#f5f5f5",
        borderLeft: "4px solid #9e9e9e",
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
            color: "#9e9e9e",
          }}
        >
          ▶
        </span>
        <h3 style={{ margin: 0, color: "#757575" }}>
          Archived
        </h3>
        <span
          style={{
            background: "#9e9e9e",
            color: "white",
            padding: "2px 8px",
            borderRadius: "12px",
            fontSize: "0.85rem",
            fontWeight: 600,
          }}
        >
          {dismissedRecs.length}
        </span>
      </button>

      {/* Expanded Content */}
      {expanded && (
        <div style={{ marginTop: "16px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {dismissedRecs.map((rec) => (
              <ArchivedItem key={rec.id} recommendation={rec} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// Archived Item Component
// ============================================

interface ArchivedItemProps {
  recommendation: Recommendation;
}

function ArchivedItem({ recommendation }: ArchivedItemProps) {
  // Get student name from signals
  const studentName =
    (recommendation.triggerData.signals.studentName as string) ||
    (recommendation.triggerData.signals.studentNames as string) ||
    (recommendation.studentIds.length === 1
      ? `Student ${recommendation.studentIds[0].slice(0, 6)}`
      : `${recommendation.studentIds.length} students`);

  // Format dismissed date
  const dismissedDate = recommendation.reviewedAt
    ? new Date(recommendation.reviewedAt).toLocaleDateString()
    : null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "12px",
        padding: "12px",
        background: "white",
        borderRadius: "8px",
        opacity: 0.8,
      }}
    >
      {/* Content */}
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 500, color: "#666" }}>
          {recommendation.title || studentName}
        </div>

        <div
          style={{
            marginTop: "4px",
            fontSize: "0.85rem",
            color: "#999",
          }}
        >
          {recommendation.reason}
        </div>

        {dismissedDate && (
          <div
            style={{
              marginTop: "4px",
              fontSize: "0.8rem",
              color: "#bbb",
            }}
          >
            Dismissed {dismissedDate}
          </div>
        )}
      </div>
    </div>
  );
}
