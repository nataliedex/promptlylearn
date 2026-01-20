/**
 * RecommendationPanel - "What Should I Do Next?" UI Component
 *
 * Displays actionable recommendations for educators with:
 * - Priority-based sorting and color coding
 * - Review/dismiss actions
 * - Teacher action buttons (reassign, award badge, add note)
 * - Feedback collection
 * - Audit trail ("Why am I seeing this?")
 */

import { useState, useEffect, useMemo } from "react";
import {
  type Recommendation,
  type InsightType,
  type FeedbackType,
  type BadgeTypeInfo,
  getBadgeTypes,
  reassignToStudent,
  awardBadgeToStudent,
  addTeacherNoteToRecommendation,
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
// Color and Icon Mapping for New Insight Types
// ============================================

const INSIGHT_CONFIG: Record<
  InsightType,
  { color: string; bgColor: string; icon: string; label: string }
> = {
  check_in: {
    color: "#c62828",
    bgColor: "#ffebee",
    icon: "💬",
    label: "Check-in",
  },
  challenge_opportunity: {
    color: "#2e7d32",
    bgColor: "#e8f5e9",
    icon: "🚀",
    label: "Challenge",
  },
  celebrate_progress: {
    color: "#1565c0",
    bgColor: "#e3f2fd",
    icon: "🎉",
    label: "Celebrate",
  },
  monitor: {
    color: "#f9a825",
    bgColor: "#fffde7",
    icon: "👁️",
    label: "Monitor",
  },
};

// Legacy type config for backward compatibility
const LEGACY_TYPE_CONFIG: Record<
  string,
  { color: string; bgColor: string; icon: string; label: string }
> = {
  "individual-checkin": {
    color: "#c62828",
    bgColor: "#ffebee",
    icon: "💬",
    label: "Check-in",
  },
  "small-group": {
    color: "#ef6c00",
    bgColor: "#fff3e0",
    icon: "👥",
    label: "Group",
  },
  "assignment-adjustment": {
    color: "#f9a825",
    bgColor: "#fffde7",
    icon: "👁️",
    label: "Assignment",
  },
  enrichment: {
    color: "#2e7d32",
    bgColor: "#e8f5e9",
    icon: "🚀",
    label: "Enrichment",
  },
  celebrate: {
    color: "#1565c0",
    bgColor: "#e3f2fd",
    icon: "🎉",
    label: "Celebrate",
  },
};

/**
 * Get config for a recommendation, preferring new insight type
 */
function getConfig(rec: Recommendation) {
  // Use new insight type if available
  if (rec.insightType && INSIGHT_CONFIG[rec.insightType]) {
    return INSIGHT_CONFIG[rec.insightType];
  }
  // Fall back to legacy type
  return LEGACY_TYPE_CONFIG[rec.type] || INSIGHT_CONFIG.check_in;
}

/**
 * Get available actions based on insight type
 */
function getAvailableActions(rec: Recommendation): Array<{
  id: string;
  label: string;
  icon: string;
  color: string;
  bgColor: string;
}> {
  const actions: Array<{
    id: string;
    label: string;
    icon: string;
    color: string;
    bgColor: string;
  }> = [];

  // Use string type to allow both new and legacy type values
  const insightType: string = rec.insightType || rec.type;

  // Check-in and struggling students can be reassigned
  if (
    (insightType === "check_in" || insightType === "individual-checkin") &&
    rec.assignmentId &&
    rec.studentIds.length > 0
  ) {
    actions.push({
      id: "reassign",
      label: "Reassign",
      icon: "🔄",
      color: "#ef6c00",
      bgColor: "#fff3e0",
    });
  }

  // All types can have notes added
  actions.push({
    id: "add-note",
    label: "Add Note",
    icon: "📝",
    color: "#5c6bc0",
    bgColor: "#e8eaf6",
  });

  // Celebrate progress and challenge opportunity can award badges
  if (
    insightType === "celebrate_progress" ||
    insightType === "celebrate" ||
    insightType === "challenge_opportunity" ||
    insightType === "enrichment"
  ) {
    actions.push({
      id: "award-badge",
      label: "Award Badge",
      icon: "🏆",
      color: "#7b1fa2",
      bgColor: "#f3e5f5",
    });
  }

  return actions;
}

// ============================================
// Badge Selection Modal
// ============================================

interface BadgeSelectionModalProps {
  studentName: string;
  badgeTypes: BadgeTypeInfo[];
  onSelect: (badgeType: string, message: string) => void;
  onCancel: () => void;
}

function BadgeSelectionModal({
  studentName,
  badgeTypes,
  onSelect,
  onCancel,
}: BadgeSelectionModalProps) {
  const [selectedBadge, setSelectedBadge] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: "white",
          borderRadius: "12px",
          padding: "24px",
          maxWidth: "450px",
          width: "90%",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: "0 0 8px 0", color: "#333" }}>Award Badge</h3>
        <p style={{ margin: "0 0 16px 0", color: "#666" }}>
          Select a badge to award to <strong>{studentName}</strong>
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "16px" }}>
          {badgeTypes.map((badge) => (
            <button
              key={badge.id}
              onClick={() => setSelectedBadge(badge.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                padding: "12px",
                border: selectedBadge === badge.id ? "2px solid #7b1fa2" : "1px solid #ddd",
                borderRadius: "8px",
                background: selectedBadge === badge.id ? "#f3e5f5" : "white",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <span style={{ fontSize: "1.5rem" }}>{badge.icon}</span>
              <div>
                <div style={{ fontWeight: 600, color: "#333" }}>{badge.name}</div>
                <div style={{ fontSize: "0.85rem", color: "#666" }}>{badge.description}</div>
              </div>
            </button>
          ))}
        </div>

        <div style={{ marginBottom: "16px" }}>
          <label style={{ display: "block", marginBottom: "4px", color: "#666", fontSize: "0.9rem" }}>
            Message to student (optional):
          </label>
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Great work on this assignment!"
            style={{
              width: "100%",
              padding: "8px 12px",
              border: "1px solid #ddd",
              borderRadius: "6px",
              fontSize: "0.95rem",
            }}
          />
        </div>

        {/* Preview */}
        {selectedBadge && (
          <div
            style={{
              padding: "12px",
              background: "#f8f9fa",
              borderRadius: "8px",
              marginBottom: "16px",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: "0.85rem", color: "#666", marginBottom: "4px" }}>Preview:</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
              <span style={{ fontSize: "2rem" }}>
                {badgeTypes.find((b) => b.id === selectedBadge)?.icon}
              </span>
              <div>
                <div style={{ fontWeight: 600, color: "#7b1fa2" }}>
                  {badgeTypes.find((b) => b.id === selectedBadge)?.name}
                </div>
                {message && <div style={{ fontSize: "0.85rem", color: "#666" }}>"{message}"</div>}
              </div>
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: "12px" }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1,
              padding: "10px",
              background: "transparent",
              color: "#666",
              border: "1px solid #ddd",
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "0.95rem",
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => selectedBadge && onSelect(selectedBadge, message)}
            disabled={!selectedBadge}
            style={{
              flex: 1,
              padding: "10px",
              background: selectedBadge ? "#7b1fa2" : "#ccc",
              color: "white",
              border: "none",
              borderRadius: "6px",
              cursor: selectedBadge ? "pointer" : "not-allowed",
              fontSize: "0.95rem",
              fontWeight: 500,
            }}
          >
            Award Badge
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Add Note Modal
// ============================================

interface AddNoteModalProps {
  studentName: string;
  onSubmit: (note: string) => void;
  onCancel: () => void;
}

function AddNoteModal({ studentName, onSubmit, onCancel }: AddNoteModalProps) {
  const [note, setNote] = useState("");

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: "white",
          borderRadius: "12px",
          padding: "24px",
          maxWidth: "450px",
          width: "90%",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: "0 0 8px 0", color: "#333" }}>Add Teacher Note</h3>
        <p style={{ margin: "0 0 16px 0", color: "#666" }}>
          Add a note about <strong>{studentName}</strong>
        </p>

        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Enter your note here..."
          rows={4}
          style={{
            width: "100%",
            padding: "12px",
            border: "1px solid #ddd",
            borderRadius: "6px",
            fontSize: "0.95rem",
            resize: "vertical",
            marginBottom: "16px",
          }}
        />

        <div style={{ display: "flex", gap: "12px" }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1,
              padding: "10px",
              background: "transparent",
              color: "#666",
              border: "1px solid #ddd",
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "0.95rem",
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => note.trim() && onSubmit(note.trim())}
            disabled={!note.trim()}
            style={{
              flex: 1,
              padding: "10px",
              background: note.trim() ? "#5c6bc0" : "#ccc",
              color: "white",
              border: "none",
              borderRadius: "6px",
              cursor: note.trim() ? "pointer" : "not-allowed",
              fontSize: "0.95rem",
              fontWeight: 500,
            }}
          >
            Save Note
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Confirmation Modal
// ============================================

interface ConfirmationModalProps {
  title: string;
  message: string;
  confirmLabel: string;
  confirmColor: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmationModal({
  title,
  message,
  confirmLabel,
  confirmColor,
  onConfirm,
  onCancel,
}: ConfirmationModalProps) {
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: "white",
          borderRadius: "12px",
          padding: "24px",
          maxWidth: "400px",
          width: "90%",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: "0 0 8px 0", color: "#333" }}>{title}</h3>
        <p style={{ margin: "0 0 20px 0", color: "#666" }}>{message}</p>

        <div style={{ display: "flex", gap: "12px" }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1,
              padding: "10px",
              background: "transparent",
              color: "#666",
              border: "1px solid #ddd",
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "0.95rem",
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              flex: 1,
              padding: "10px",
              background: confirmColor,
              color: "white",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "0.95rem",
              fontWeight: 500,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Recommendation Card Component
// ============================================

interface RecommendationCardProps {
  recommendation: Recommendation;
  badgeTypes: BadgeTypeInfo[];
  studentMap: Map<string, string>;
  onReview: (id: string) => void;
  onDismiss: (id: string) => void;
  onFeedback: (id: string, feedback: FeedbackType) => void;
  onAction: (id: string, action: string, result: unknown) => void;
}

function RecommendationCard({
  recommendation,
  badgeTypes,
  studentMap,
  onReview,
  onDismiss,
  onFeedback,
  onAction,
}: RecommendationCardProps) {
  const [showAudit, setShowAudit] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showBadgeModal, setShowBadgeModal] = useState(false);
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [showReassignConfirm, setShowReassignConfirm] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const config = getConfig(recommendation);
  const isReviewed = recommendation.status === "reviewed";
  const availableActions = getAvailableActions(recommendation);

  // Use new format fields if available, fall back to legacy
  const displayTitle = recommendation.summary || recommendation.title;
  const displayEvidence = recommendation.evidence?.length ? recommendation.evidence : [recommendation.reason];
  const displayActions = recommendation.suggestedTeacherActions?.length
    ? recommendation.suggestedTeacherActions
    : [recommendation.suggestedAction];

  // Get student name - first try studentMap lookup, then signals, then fallback to ID
  const getStudentDisplayName = (): string => {
    // For single student, look up in map first
    if (recommendation.studentIds.length === 1) {
      const nameFromMap = studentMap.get(recommendation.studentIds[0]);
      if (nameFromMap) return nameFromMap;
    }
    // Try signals
    if (recommendation.triggerData.signals.studentName) {
      return recommendation.triggerData.signals.studentName as string;
    }
    if (recommendation.triggerData.signals.studentNames) {
      return recommendation.triggerData.signals.studentNames as string;
    }
    // For multiple students, try to build names from map
    if (recommendation.studentIds.length > 1) {
      const names = recommendation.studentIds
        .map(id => studentMap.get(id))
        .filter(Boolean);
      if (names.length > 0) return names.join(", ");
    }
    // Fallback
    return recommendation.studentIds.length === 1
      ? `Student ${recommendation.studentIds[0].slice(0, 6)}`
      : "Selected students";
  };
  const studentName = getStudentDisplayName();

  const handleReassign = async () => {
    if (!recommendation.assignmentId || recommendation.studentIds.length === 0) return;

    setActionLoading("reassign");
    try {
      // Reassign for the first student (in multi-student scenarios, could loop)
      const result = await reassignToStudent(
        recommendation.id,
        recommendation.studentIds[0],
        recommendation.assignmentId
      );
      onAction(recommendation.id, "reassign", result);
    } catch (error) {
      console.error("Failed to reassign:", error);
    } finally {
      setActionLoading(null);
      setShowReassignConfirm(false);
    }
  };

  const handleAwardBadge = async (badgeType: string, message: string) => {
    if (recommendation.studentIds.length === 0) return;

    setActionLoading("award-badge");
    try {
      const result = await awardBadgeToStudent(
        recommendation.id,
        recommendation.studentIds[0],
        badgeType,
        message,
        recommendation.assignmentId
      );
      onAction(recommendation.id, "award-badge", result);
    } catch (error) {
      console.error("Failed to award badge:", error);
    } finally {
      setActionLoading(null);
      setShowBadgeModal(false);
    }
  };

  const handleAddNote = async (note: string) => {
    setActionLoading("add-note");
    try {
      const result = await addTeacherNoteToRecommendation(recommendation.id, note);
      onAction(recommendation.id, "add-note", result);
    } catch (error) {
      console.error("Failed to add note:", error);
    } finally {
      setActionLoading(null);
      setShowNoteModal(false);
    }
  };

  return (
    <>
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
              <span
                style={{
                  fontSize: "0.7rem",
                  fontWeight: 600,
                  color: config.color,
                  background: config.bgColor,
                  padding: "2px 8px",
                  borderRadius: "4px",
                  border: `1px solid ${config.color}`,
                  textTransform: "uppercase",
                }}
              >
                {config.label}
              </span>
              {recommendation.priorityLevel === "high" && (
                <span
                  style={{
                    fontSize: "0.7rem",
                    fontWeight: 600,
                    color: "#c62828",
                    background: "#ffebee",
                    padding: "2px 8px",
                    borderRadius: "4px",
                  }}
                >
                  High Priority
                </span>
              )}
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
            <h3 style={{ margin: "8px 0 0 0", color: "#333", fontSize: "1.1rem" }}>
              {displayTitle}
            </h3>
          </div>
        </div>

        {/* Evidence */}
        <div style={{ marginTop: "12px", paddingLeft: "36px" }}>
          <ul style={{ margin: 0, paddingLeft: "16px", color: "#555", fontSize: "0.9rem" }}>
            {displayEvidence.map((item, i) => (
              <li key={i} style={{ marginBottom: "4px" }}>{item}</li>
            ))}
          </ul>
        </div>

        {/* Suggested Actions */}
        <div
          style={{
            marginTop: "12px",
            paddingLeft: "36px",
            background: "#f8f9fa",
            borderRadius: "4px",
            padding: "12px",
          }}
        >
          <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "#667eea", marginBottom: "8px" }}>
            Suggested actions:
          </div>
          <ul style={{ margin: 0, paddingLeft: "16px", color: "#555", fontSize: "0.9rem" }}>
            {displayActions.map((action, i) => (
              <li key={i} style={{ marginBottom: "4px" }}>{action}</li>
            ))}
          </ul>
        </div>

        {/* Action Buttons - NEW */}
        {!isReviewed && availableActions.length > 0 && (
          <div
            style={{
              marginTop: "12px",
              paddingLeft: "36px",
              display: "flex",
              flexWrap: "wrap",
              gap: "8px",
            }}
          >
            {availableActions.map((action) => (
              <button
                key={action.id}
                onClick={() => {
                  if (action.id === "reassign") setShowReassignConfirm(true);
                  else if (action.id === "award-badge") setShowBadgeModal(true);
                  else if (action.id === "add-note") setShowNoteModal(true);
                }}
                disabled={actionLoading !== null}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 14px",
                  fontSize: "0.85rem",
                  fontWeight: 500,
                  background: action.bgColor,
                  color: action.color,
                  border: `1px solid ${action.color}`,
                  borderRadius: "6px",
                  cursor: actionLoading ? "wait" : "pointer",
                  opacity: actionLoading && actionLoading !== action.id ? 0.6 : 1,
                  transition: "all 0.2s",
                }}
              >
                <span>{action.icon}</span>
                {actionLoading === action.id ? "..." : action.label}
              </button>
            ))}
          </div>
        )}

        {/* Primary Actions (Mark Reviewed, Dismiss) */}
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
              <strong>Insight type:</strong>{" "}
              {(recommendation.insightType || recommendation.type)
                .split(/[-_]/)
                .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                .join(" ")}
            </div>
            <div style={{ marginBottom: "8px" }}>
              <strong>Confidence:</strong>{" "}
              {recommendation.confidenceScore
                ? `${Math.round(recommendation.confidenceScore * 100)}%`
                : recommendation.confidence?.charAt(0).toUpperCase() + recommendation.confidence?.slice(1)}
            </div>
            <div style={{ marginBottom: "8px" }}>
              <strong>Priority:</strong>{" "}
              {(recommendation.priorityLevel || recommendation.confidence)?.charAt(0).toUpperCase() +
                (recommendation.priorityLevel || recommendation.confidence)?.slice(1)}
            </div>
            <div style={{ marginBottom: "8px" }}>
              <strong>Detection rule:</strong>{" "}
              {recommendation.triggerData.ruleName
                .split(/[-_]/)
                .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                .join(" ")}
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

      {/* Modals */}
      {showBadgeModal && (
        <BadgeSelectionModal
          studentName={studentName}
          badgeTypes={badgeTypes}
          onSelect={handleAwardBadge}
          onCancel={() => setShowBadgeModal(false)}
        />
      )}

      {showNoteModal && (
        <AddNoteModal
          studentName={studentName}
          onSubmit={handleAddNote}
          onCancel={() => setShowNoteModal(false)}
        />
      )}

      {showReassignConfirm && (
        <ConfirmationModal
          title="Reassign Assignment"
          message={`This will push the assignment back to ${studentName} for another attempt. They will be able to retry the assignment.`}
          confirmLabel="Reassign"
          confirmColor="#ef6c00"
          onConfirm={handleReassign}
          onCancel={() => setShowReassignConfirm(false)}
        />
      )}
    </>
  );
}

// ============================================
// Main Panel Component
// ============================================

interface StudentInfo {
  id: string;
  name: string;
}

interface RecommendationPanelProps {
  recommendations: Recommendation[];
  students?: StudentInfo[];
  onReview: (id: string) => void;
  onDismiss: (id: string) => void;
  onFeedback: (id: string, feedback: FeedbackType) => void;
  onRefresh: () => void;
  loading?: boolean;
}

export default function RecommendationPanel({
  recommendations,
  students = [],
  onReview,
  onDismiss,
  onFeedback,
  onRefresh,
  loading = false,
}: RecommendationPanelProps) {
  const [showReviewed, setShowReviewed] = useState(false);
  const [badgeTypes, setBadgeTypes] = useState<BadgeTypeInfo[]>([]);

  // Load badge types on mount
  useEffect(() => {
    getBadgeTypes()
      .then((data) => setBadgeTypes(data.badgeTypes))
      .catch((err) => console.error("Failed to load badge types:", err));
  }, []);

  // Build student lookup map
  const studentMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const student of students) {
      map.set(student.id, student.name);
    }
    return map;
  }, [students]);

  const activeRecs = recommendations.filter((r) => r.status === "active");
  const reviewedRecs = recommendations.filter((r) => r.status === "reviewed");

  // Handler for when an action is taken (updates recommendation status)
  const handleAction = (id: string, action: string, result: unknown) => {
    console.log(`Action ${action} completed for ${id}:`, result);
    // The recommendation should now be marked as reviewed by the API
    // Trigger a refresh to update the UI
    onRefresh();
  };

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
          badgeTypes={badgeTypes}
          studentMap={studentMap}
          onReview={onReview}
          onDismiss={onDismiss}
          onFeedback={onFeedback}
          onAction={handleAction}
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
                  badgeTypes={badgeTypes}
                  studentMap={studentMap}
                  onReview={onReview}
                  onDismiss={onDismiss}
                  onFeedback={onFeedback}
                  onAction={handleAction}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
