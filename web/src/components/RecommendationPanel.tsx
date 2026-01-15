/**
 * RecommendationPanel - "What Should I Do Next?" UI Component
 *
 * Displays actionable recommendations for educators with:
 * - Priority-based sorting and color coding
 * - Review/dismiss actions
 * - Feedback collection
 * - Audit trail ("Why am I seeing this?")
 */

import { useState } from "react";
import {
  type Recommendation,
  type RecommendationType,
  type FeedbackType,
} from "../services/api";

// ============================================
// Helper: Format Signals as Plain Text
// ============================================

function formatSignals(signals: Record<string, unknown>): string[] {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(signals)) {
    if (value === undefined || value === null) continue;

    switch (key) {
      case "score":
        lines.push(`Score: ${value}%`);
        break;
      case "previousScore":
        lines.push(`Previous score: ${value}%`);
        break;
      case "currentScore":
        lines.push(`Current score: ${value}%`);
        break;
      case "improvement":
        lines.push(`Improvement: +${value}%`);
        break;
      case "averageScore":
        lines.push(`Class average: ${Math.round(value as number)}%`);
        break;
      case "hintUsageRate":
        lines.push(`Hint usage: ${Math.round((value as number) * 100)}%`);
        break;
      case "coachIntent":
        if (value === "support-seeking") {
          lines.push("Coach pattern: Seeking support");
        } else if (value === "enrichment-seeking") {
          lines.push("Coach pattern: Seeking enrichment");
        } else if (value) {
          lines.push(`Coach pattern: ${value}`);
        }
        break;
      case "hasTeacherNote":
        lines.push(value ? "Has teacher note: Yes" : "Has teacher note: No");
        break;
      case "studentCount":
        lines.push(`Students in group: ${value}`);
        break;
      case "studentNames":
        lines.push(`Students: ${value}`);
        break;
      case "className":
        lines.push(`Class: ${value}`);
        break;
      case "completionRate":
        lines.push(`Completion rate: ${value}%`);
        break;
      case "completedCount":
        lines.push(`Completed: ${value} students`);
        break;
      case "daysSinceAssigned":
        lines.push(`Days since assigned: ${value}`);
        break;
      default:
        // Fallback for any other signals
        lines.push(`${key}: ${value}`);
    }
  }

  return lines;
}

// ============================================
// Color and Icon Mapping
// ============================================

const TYPE_CONFIG: Record<
  RecommendationType,
  { color: string; bgColor: string; icon: string; label: string }
> = {
  "individual-checkin": {
    color: "#c62828",
    bgColor: "#ffebee",
    icon: "🔴",
    label: "Check-in",
  },
  "small-group": {
    color: "#ef6c00",
    bgColor: "#fff3e0",
    icon: "🟠",
    label: "Group",
  },
  "assignment-adjustment": {
    color: "#f9a825",
    bgColor: "#fffde7",
    icon: "🟡",
    label: "Assignment",
  },
  enrichment: {
    color: "#2e7d32",
    bgColor: "#e8f5e9",
    icon: "🟢",
    label: "Enrichment",
  },
  celebrate: {
    color: "#1565c0",
    bgColor: "#e3f2fd",
    icon: "🎉",
    label: "Celebrate",
  },
};

// ============================================
// Recommendation Card Component
// ============================================

interface RecommendationCardProps {
  recommendation: Recommendation;
  onReview: (id: string) => void;
  onDismiss: (id: string) => void;
  onFeedback: (id: string, feedback: FeedbackType) => void;
}

function RecommendationCard({
  recommendation,
  onReview,
  onDismiss,
  onFeedback,
}: RecommendationCardProps) {
  const [showAudit, setShowAudit] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);

  const config = TYPE_CONFIG[recommendation.type];
  const isReviewed = recommendation.status === "reviewed";

  return (
    <div
      style={{
        background: isReviewed ? "#f5f5f5" : config.bgColor,
        border: `1px solid ${isReviewed ? "#e0e0e0" : config.color}`,
        borderLeft: `4px solid ${config.color}`,
        borderRadius: "8px",
        padding: "16px",
        marginBottom: "12px",
        opacity: isReviewed ? 0.7 : 1,
        transition: "all 0.2s",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
        <span style={{ fontSize: "1.5rem" }}>{config.icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
            <h3 style={{ margin: 0, color: config.color, fontSize: "1.1rem" }}>
              {recommendation.title}
            </h3>
            {isReviewed && (
              <span
                style={{
                  fontSize: "0.75rem",
                  background: "#e0e0e0",
                  color: "#666",
                  padding: "2px 8px",
                  borderRadius: "4px",
                }}
              >
                Reviewed
              </span>
            )}
          </div>
          <p style={{ margin: 0, color: "#555", fontSize: "0.95rem" }}>{recommendation.reason}</p>
        </div>
      </div>

      {/* Suggested Action */}
      <div
        style={{
          marginTop: "12px",
          paddingLeft: "36px",
          display: "flex",
          alignItems: "center",
          gap: "8px",
        }}
      >
        <span style={{ color: "#667eea", fontSize: "0.9rem" }}>→</span>
        <span style={{ color: "#667eea", fontSize: "0.9rem", fontWeight: 500 }}>
          {recommendation.suggestedAction}
        </span>
      </div>

      {/* Actions */}
      <div
        style={{
          marginTop: "12px",
          paddingLeft: "36px",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          flexWrap: "wrap",
        }}
      >
        {!isReviewed && (
          <>
            <button
              onClick={() => onReview(recommendation.id)}
              style={{
                padding: "6px 12px",
                fontSize: "0.85rem",
                background: config.color,
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              Mark Reviewed
            </button>
            <button
              onClick={() => onDismiss(recommendation.id)}
              style={{
                padding: "6px 12px",
                fontSize: "0.85rem",
                background: "transparent",
                color: "#666",
                border: "1px solid #ccc",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              Dismiss
            </button>
          </>
        )}

        {isReviewed && !recommendation.feedback && (
          <button
            onClick={() => setShowFeedback(!showFeedback)}
            style={{
              padding: "6px 12px",
              fontSize: "0.85rem",
              background: "transparent",
              color: "#667eea",
              border: "1px solid #667eea",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            Was this helpful?
          </button>
        )}

        {recommendation.feedback && (
          <span
            style={{
              fontSize: "0.85rem",
              color: recommendation.feedback === "helpful" ? "#2e7d32" : "#c62828",
            }}
          >
            {recommendation.feedback === "helpful" ? "✓ Marked helpful" : "✗ Not helpful"}
          </span>
        )}

        <button
          onClick={() => setShowAudit(!showAudit)}
          style={{
            padding: "6px 12px",
            fontSize: "0.85rem",
            background: "transparent",
            color: "#999",
            border: "none",
            cursor: "pointer",
            marginLeft: "auto",
          }}
        >
          {showAudit ? "Hide details" : "Why am I seeing this?"}
        </button>
      </div>

      {/* Feedback Buttons */}
      {showFeedback && !recommendation.feedback && (
        <div
          style={{
            marginTop: "12px",
            paddingLeft: "36px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <span style={{ fontSize: "0.85rem", color: "#666" }}>Was this recommendation helpful?</span>
          <button
            onClick={() => {
              onFeedback(recommendation.id, "helpful");
              setShowFeedback(false);
            }}
            style={{
              padding: "4px 12px",
              fontSize: "0.85rem",
              background: "#e8f5e9",
              color: "#2e7d32",
              border: "1px solid #2e7d32",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            Yes
          </button>
          <button
            onClick={() => {
              onFeedback(recommendation.id, "not-helpful");
              setShowFeedback(false);
            }}
            style={{
              padding: "4px 12px",
              fontSize: "0.85rem",
              background: "#ffebee",
              color: "#c62828",
              border: "1px solid #c62828",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            No
          </button>
        </div>
      )}

      {/* Audit Trail */}
      {showAudit && (
        <div
          style={{
            marginTop: "12px",
            paddingLeft: "36px",
            background: "#f5f5f5",
            borderRadius: "4px",
            padding: "12px",
            fontSize: "0.85rem",
            color: "#666",
          }}
        >
          <div style={{ marginBottom: "8px" }}>
            <strong>Detection rule:</strong>{" "}
            {recommendation.triggerData.ruleName
              .split("-")
              .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
              .join(" ")}
          </div>
          <div style={{ marginBottom: "8px" }}>
            <strong>Confidence:</strong>{" "}
            {recommendation.confidence.charAt(0).toUpperCase() + recommendation.confidence.slice(1)}
          </div>
          <div style={{ marginBottom: "8px" }}>
            <strong>Generated:</strong>{" "}
            {new Date(recommendation.triggerData.generatedAt).toLocaleString()}
          </div>
          <div>
            <strong>What triggered this:</strong>
            <ul
              style={{
                margin: "8px 0 0 0",
                paddingLeft: "20px",
                listStyle: "disc",
              }}
            >
              {formatSignals(recommendation.triggerData.signals).map((line, i) => (
                <li key={i} style={{ marginBottom: "4px" }}>{line}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// Main Panel Component
// ============================================

interface RecommendationPanelProps {
  recommendations: Recommendation[];
  onReview: (id: string) => void;
  onDismiss: (id: string) => void;
  onFeedback: (id: string, feedback: FeedbackType) => void;
  onRefresh: () => void;
  loading?: boolean;
}

export default function RecommendationPanel({
  recommendations,
  onReview,
  onDismiss,
  onFeedback,
  onRefresh,
  loading = false,
}: RecommendationPanelProps) {
  const [showReviewed, setShowReviewed] = useState(false);

  const activeRecs = recommendations.filter((r) => r.status === "active");
  const reviewedRecs = recommendations.filter((r) => r.status === "reviewed");

  // Nothing to show
  if (activeRecs.length === 0 && reviewedRecs.length === 0) {
    return (
      <div
        className="card"
        style={{
          marginBottom: "24px",
          background: "#f8f9fa",
          borderLeft: "4px solid #667eea",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2 style={{ margin: 0, color: "#333", fontSize: "1.2rem" }}>What Should I Do Next?</h2>
            <p style={{ margin: "8px 0 0 0", color: "#666" }}>
              No recommendations right now. Your students are doing great!
            </p>
          </div>
          <button
            onClick={onRefresh}
            disabled={loading}
            style={{
              padding: "8px 16px",
              background: "#667eea",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: loading ? "wait" : "pointer",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="card"
      style={{
        marginBottom: "24px",
        background: "#f8f9fa",
        borderLeft: "4px solid #667eea",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "16px",
        }}
      >
        <div>
          <h2 style={{ margin: 0, color: "#333", fontSize: "1.2rem" }}>What Should I Do Next?</h2>
          <p style={{ margin: "4px 0 0 0", color: "#666", fontSize: "0.9rem" }}>
            {activeRecs.length} recommendation{activeRecs.length !== 1 ? "s" : ""} based on student
            activity
          </p>
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          style={{
            padding: "8px 16px",
            background: "#667eea",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: loading ? "wait" : "pointer",
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {/* Active Recommendations */}
      {activeRecs.map((rec) => (
        <RecommendationCard
          key={rec.id}
          recommendation={rec}
          onReview={onReview}
          onDismiss={onDismiss}
          onFeedback={onFeedback}
        />
      ))}

      {/* Show Reviewed Toggle */}
      {reviewedRecs.length > 0 && (
        <>
          <button
            onClick={() => setShowReviewed(!showReviewed)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginTop: "16px",
              padding: "8px 0",
              background: "none",
              border: "none",
              color: "#666",
              fontSize: "0.9rem",
              cursor: "pointer",
              width: "100%",
              textAlign: "left",
            }}
          >
            <span
              style={{
                transform: showReviewed ? "rotate(90deg)" : "rotate(0deg)",
                transition: "transform 0.2s",
              }}
            >
              ▶
            </span>
            Show reviewed ({reviewedRecs.length})
          </button>

          {showReviewed && (
            <div style={{ marginTop: "12px" }}>
              {reviewedRecs.map((rec) => (
                <RecommendationCard
                  key={rec.id}
                  recommendation={rec}
                  onReview={onReview}
                  onDismiss={onDismiss}
                  onFeedback={onFeedback}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
