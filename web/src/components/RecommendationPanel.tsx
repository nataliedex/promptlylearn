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
  type FeedbackType,
  type BadgeTypeInfo,
  type RecommendationStats,
  type ChecklistActionKey,
  type SubmitChecklistResponse,
  getBadgeTypes,
  reassignToStudent,
  awardBadgeToStudent,
  addTeacherNoteToRecommendation,
  submitChecklistActions,
  CHECKLIST_ACTIONS,
  getChecklistActionsForCategory,
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
        lines.push(`Score: ${Math.round(value as number)}%`);
        break;
      case "previousScore":
        lines.push(`Previous score: ${Math.round(value as number)}%`);
        break;
      case "currentScore":
        lines.push(`Current score: ${Math.round(value as number)}%`);
        break;
      case "improvement":
        lines.push(`Improvement: +${Math.round(value as number)}%`);
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
        lines.push(`Completion rate: ${Math.round(value as number)}%`);
        break;
      case "completedCount":
        lines.push(`Completed: ${value} students`);
        break;
      case "daysSinceAssigned":
        lines.push(`Days since assigned: ${value}`);
        break;
      case "helpRequestCount":
        lines.push(`Help requests: ${value}`);
        break;
      case "escalatedFromDeveloping":
        if (value) {
          lines.push("⚠️ Escalated from Developing due to repeated help requests");
        }
        break;
      default:
        // Fallback for any other signals
        lines.push(`${key}: ${value}`);
    }
  }

  return lines;
}

// ============================================
// Category Configuration
// ============================================

/**
 * Display categories for the "What Should I Do Next?" panel
 *
 * Categories are determined by a combination of insight type AND rule name:
 * - INDIVIDUAL-ONLY: Celebrate Progress, Challenge Opportunity, Check-in Suggested, Developing
 * - GROUPABLE: Needs Support, Group Review, Administrative/Monitor
 */

interface CategoryConfig {
  color: string;
  bgColor: string;
  icon: string;
  label: string;
  isGroupable: boolean;
  subLabel?: string;  // Optional secondary descriptor shown below category tag
}

const CATEGORY_CONFIG: Record<string, CategoryConfig> = {
  // INDIVIDUAL-ONLY CATEGORIES (never grouped)
  "celebrate-progress": {
    color: "#1565c0",
    bgColor: "#e3f2fd",
    icon: "🎉",
    label: "Celebrate Progress",
    isGroupable: false,
  },
  "challenge-opportunity": {
    color: "#2e7d32",
    bgColor: "#e8f5e9",
    icon: "🚀",
    label: "Challenge Opportunity",
    isGroupable: false,
  },
  "check-in-suggested": {
    color: "#7b1fa2",
    bgColor: "#f3e5f5",
    icon: "💬",
    label: "Check-in Suggested",
    isGroupable: false,
  },
  "developing": {
    color: "#00838f",
    bgColor: "#e0f7fa",
    icon: "📈",
    label: "Developing",
    isGroupable: false,
    subLabel: "Making progress • Monitoring recommended",
  },

  // GROUPABLE CATEGORIES (can have multiple students)
  "needs-support": {
    color: "#c62828",
    bgColor: "#ffebee",
    icon: "🆘",
    label: "Needs Support",
    isGroupable: true,
    subLabel: "Action recommended",
  },
  "group-review": {
    color: "#ef6c00",
    bgColor: "#fff3e0",
    icon: "👥",
    label: "Group Review",
    isGroupable: true,
  },
  "administrative": {
    color: "#f9a825",
    bgColor: "#fffde7",
    icon: "📋",
    label: "Administrative",
    isGroupable: true,
  },
};

// Fallback config for unknown categories
const DEFAULT_CONFIG: CategoryConfig = {
  color: "#666",
  bgColor: "#f5f5f5",
  icon: "📌",
  label: "Recommendation",
  isGroupable: false,
};

/**
 * Determine the display category based on insight type and rule name
 */
function getCategoryKey(rec: Recommendation): string {
  const ruleName = rec.triggerData?.ruleName || "";
  // Type union allows both new InsightType and legacy RecommendationType values
  const insightType: string = rec.insightType || rec.type;
  const isGrouped = rec.studentIds.length > 1;

  // Check rule name first for more specific categorization
  switch (ruleName) {
    case "notable-improvement":
      return "celebrate-progress";
    case "ready-for-challenge":
      return "challenge-opportunity";
    case "check-in-suggested":
      return "check-in-suggested";
    case "developing":
      return "developing";
    case "group-support":
      return "group-review";
    case "needs-support":
      // If grouped, show as Group Review; if single, show as Needs Support
      return isGrouped ? "group-review" : "needs-support";
    case "watch-progress":
      return "administrative";
  }

  // Fall back to insight type
  switch (insightType) {
    case "celebrate_progress":
    case "celebrate":
      return "celebrate-progress";
    case "challenge_opportunity":
    case "enrichment":
      return "challenge-opportunity";
    case "monitor":
    case "assignment-adjustment":
      return "administrative";
    case "check_in":
    case "individual-checkin":
      // Determine based on grouping
      if (isGrouped) return "group-review";
      return "needs-support";
    case "small-group":
      return "group-review";
  }

  return "needs-support"; // Default fallback
}

/**
 * Get display configuration for a recommendation
 */
function getCategoryConfig(rec: Recommendation): CategoryConfig {
  const key = getCategoryKey(rec);
  return CATEGORY_CONFIG[key] || DEFAULT_CONFIG;
}

// Legacy compatibility - keep old function signature
function getConfig(rec: Recommendation) {
  return getCategoryConfig(rec);
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
  onDismiss: (id: string) => void;
  onFeedback: (id: string, feedback: FeedbackType) => void;
  onAction: (id: string, action: string, result: unknown) => void;
}

function RecommendationCard({
  recommendation,
  badgeTypes,
  studentMap,
  onDismiss,
  onFeedback,
  onAction,
}: RecommendationCardProps) {
  const [showAudit, setShowAudit] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showBadgeModal, setShowBadgeModal] = useState(false);
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [showReassignConfirm, setShowReassignConfirm] = useState(false);
  const [showAssignPracticeConfirm, setShowAssignPracticeConfirm] = useState(false);
  // Note: modalActionLoading was used for button-based modals, now checklist uses isSubmitting
  const [_modalActionLoading, setModalActionLoading] = useState<string | null>(null);

  // Checklist state
  const [selectedActions, setSelectedActions] = useState<Set<ChecklistActionKey>>(new Set());
  const [noteText, setNoteText] = useState("");
  const [selectedBadgeType, setSelectedBadgeType] = useState<string>("");
  const [badgeMessage, setBadgeMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const config = getConfig(recommendation);
  const isReviewed = recommendation.status === "reviewed";
  const isResolved = recommendation.status === "resolved";
  const isPending = recommendation.status === "pending";
  const isActionable = !isReviewed && !isResolved && !isPending;

  // Get category key for checklist actions
  const categoryKey = getCategoryKey(recommendation);

  // Get available checklist actions for this category
  const checklistActionKeys = useMemo(() => {
    return getChecklistActionsForCategory(categoryKey, {
      hasAssignmentId: !!recommendation.assignmentId,
      isGrouped: recommendation.studentIds.length > 1,
      studentCount: recommendation.studentIds.length,
    });
  }, [categoryKey, recommendation.assignmentId, recommendation.studentIds.length]);

  // Check if submit is valid
  const canSubmit = selectedActions.size > 0 && !isSubmitting;
  const needsBadgeType = selectedActions.has("award_badge") && !selectedBadgeType;
  const needsNoteText = selectedActions.has("add_note") && !noteText.trim();
  const isSubmitDisabled = !canSubmit || needsBadgeType || needsNoteText;

  // Toggle a checklist action
  const toggleAction = (actionKey: ChecklistActionKey) => {
    setSelectedActions(prev => {
      const next = new Set(prev);
      if (next.has(actionKey)) {
        next.delete(actionKey);
      } else {
        next.add(actionKey);
      }
      return next;
    });
  };

  // Handle checklist submission
  const handleChecklistSubmit = async () => {
    if (isSubmitDisabled) return;

    setIsSubmitting(true);
    try {
      const result: SubmitChecklistResponse = await submitChecklistActions(recommendation.id, {
        selectedActionKeys: Array.from(selectedActions),
        noteText: selectedActions.has("add_note") ? noteText : undefined,
        badgeType: selectedActions.has("award_badge") ? selectedBadgeType : undefined,
        badgeMessage: selectedActions.has("award_badge") && badgeMessage ? badgeMessage : undefined,
      });

      // Notify parent of the action
      onAction(recommendation.id, "checklist-submit", result);

      // Clear form state
      setSelectedActions(new Set());
      setNoteText("");
      setSelectedBadgeType("");
      setBadgeMessage("");
    } catch (error) {
      console.error("Failed to submit checklist actions:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

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

    setModalActionLoading("reassign");
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
      setModalActionLoading(null);
      setShowReassignConfirm(false);
    }
  };

  const handleAwardBadge = async (badgeType: string, message: string) => {
    if (recommendation.studentIds.length === 0) return;

    setModalActionLoading("award-badge");
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
      setModalActionLoading(null);
      setShowBadgeModal(false);
    }
  };

  const handleAddNote = async (note: string) => {
    setModalActionLoading("add-note");
    try {
      const result = await addTeacherNoteToRecommendation(recommendation.id, note);
      onAction(recommendation.id, "add-note", result);
    } catch (error) {
      console.error("Failed to add note:", error);
    } finally {
      setModalActionLoading(null);
      setShowNoteModal(false);
    }
  };

  const handleAssignPractice = async () => {
    // For now, this marks the recommendation as reviewed
    // In a full implementation, this would open an assignment picker
    setModalActionLoading("assign-practice");
    try {
      // Mark as reviewed (placeholder for actual assignment logic)
      onAction(recommendation.id, "assign-practice", {
        studentIds: recommendation.studentIds,
        assignmentId: recommendation.assignmentId,
      });
    } catch (error) {
      console.error("Failed to assign practice:", error);
    } finally {
      setModalActionLoading(null);
      setShowAssignPracticeConfirm(false);
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
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px", flexWrap: "wrap" }}>
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
              {config.subLabel && (
                <span
                  style={{
                    fontSize: "0.7rem",
                    color: "#666",
                    fontStyle: "italic",
                  }}
                >
                  {config.subLabel}
                </span>
              )}
              {/* Group indicator for multi-student recommendations */}
              {recommendation.studentIds.length > 1 && (
                <span
                  style={{
                    fontSize: "0.7rem",
                    fontWeight: 600,
                    color: "#5c6bc0",
                    background: "#e8eaf6",
                    padding: "2px 8px",
                    borderRadius: "4px",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <span style={{ fontSize: "0.8rem" }}>👥</span>
                  {recommendation.studentIds.length} students
                </span>
              )}
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
              {recommendation.status === "pending" && (
                <span
                  style={{
                    fontSize: "0.7rem",
                    fontWeight: 600,
                    color: "#ef6c00",
                    background: "#fff3e0",
                    padding: "2px 8px",
                    borderRadius: "4px",
                    border: "1px solid #ef6c00",
                  }}
                >
                  Awaiting student action
                </span>
              )}
              {recommendation.status === "resolved" && (
                <span
                  style={{
                    fontSize: "0.75rem",
                    background: "#e8f5e9",
                    color: "#2e7d32",
                    padding: "2px 8px",
                    borderRadius: "4px",
                  }}
                >
                  Resolved
                </span>
              )}
              {isReviewed && recommendation.status === "reviewed" && (
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

        {/* Suggested Actions Checklist */}
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
            {isActionable ? "Select actions to take:" : "Suggested actions:"}
          </div>

          {/* Show checklist for actionable recommendations */}
          {isActionable ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {checklistActionKeys.map((actionKey) => {
                const actionConfig = CHECKLIST_ACTIONS[actionKey];
                const isChecked = selectedActions.has(actionKey);

                return (
                  <div key={actionKey}>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "8px",
                        cursor: "pointer",
                        fontSize: "0.9rem",
                        color: "#333",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleAction(actionKey)}
                        style={{
                          marginTop: "2px",
                          cursor: "pointer",
                          width: "16px",
                          height: "16px",
                        }}
                      />
                      <span>
                        {actionConfig.label}
                        {actionConfig.isSystemAction && (
                          <span
                            style={{
                              marginLeft: "6px",
                              fontSize: "0.75rem",
                              color: "#667eea",
                              background: "#e8eaf6",
                              padding: "1px 6px",
                              borderRadius: "3px",
                            }}
                          >
                            System action
                          </span>
                        )}
                      </span>
                    </label>

                    {/* Show badge selector inline when award_badge is checked */}
                    {actionKey === "award_badge" && isChecked && (
                      <div
                        style={{
                          marginTop: "8px",
                          marginLeft: "24px",
                          padding: "12px",
                          background: "#fff",
                          border: "1px solid #e0e0e0",
                          borderRadius: "4px",
                        }}
                      >
                        <div style={{ marginBottom: "8px" }}>
                          <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 500, marginBottom: "4px" }}>
                            Badge type: <span style={{ color: "#c62828" }}>*</span>
                          </label>
                          <select
                            value={selectedBadgeType}
                            onChange={(e) => setSelectedBadgeType(e.target.value)}
                            style={{
                              width: "100%",
                              padding: "8px",
                              fontSize: "0.9rem",
                              border: "1px solid #ccc",
                              borderRadius: "4px",
                            }}
                          >
                            <option value="">Select a badge...</option>
                            {badgeTypes.map((bt) => (
                              <option key={bt.id} value={bt.id}>
                                {bt.icon} {bt.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 500, marginBottom: "4px" }}>
                            Message (optional):
                          </label>
                          <input
                            type="text"
                            value={badgeMessage}
                            onChange={(e) => setBadgeMessage(e.target.value)}
                            placeholder="Great work on this assignment!"
                            style={{
                              width: "100%",
                              padding: "8px",
                              fontSize: "0.9rem",
                              border: "1px solid #ccc",
                              borderRadius: "4px",
                              boxSizing: "border-box",
                            }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Show note input inline when add_note is checked */}
                    {actionKey === "add_note" && isChecked && (
                      <div
                        style={{
                          marginTop: "8px",
                          marginLeft: "24px",
                          padding: "12px",
                          background: "#fff",
                          border: "1px solid #e0e0e0",
                          borderRadius: "4px",
                        }}
                      >
                        <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 500, marginBottom: "4px" }}>
                          Note: <span style={{ color: "#c62828" }}>*</span>
                        </label>
                        <textarea
                          value={noteText}
                          onChange={(e) => setNoteText(e.target.value)}
                          placeholder="Add your notes here..."
                          rows={3}
                          style={{
                            width: "100%",
                            padding: "8px",
                            fontSize: "0.9rem",
                            border: "1px solid #ccc",
                            borderRadius: "4px",
                            resize: "vertical",
                            boxSizing: "border-box",
                          }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Submit button */}
              {selectedActions.size > 0 && (
                <div style={{ marginTop: "12px", display: "flex", alignItems: "center", gap: "12px" }}>
                  <button
                    onClick={handleChecklistSubmit}
                    disabled={isSubmitDisabled}
                    style={{
                      padding: "10px 20px",
                      fontSize: "0.9rem",
                      fontWeight: 600,
                      background: isSubmitDisabled ? "#ccc" : "#667eea",
                      color: "white",
                      border: "none",
                      borderRadius: "6px",
                      cursor: isSubmitDisabled ? "not-allowed" : "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    {isSubmitting ? (
                      <>Submitting...</>
                    ) : (
                      <>
                        Submit {selectedActions.size} action{selectedActions.size > 1 ? "s" : ""}
                      </>
                    )}
                  </button>
                  {(needsBadgeType || needsNoteText) && (
                    <span style={{ fontSize: "0.85rem", color: "#c62828" }}>
                      {needsBadgeType && "Please select a badge type. "}
                      {needsNoteText && "Please enter a note."}
                    </span>
                  )}
                </div>
              )}
            </div>
          ) : (
            /* Show read-only list for non-actionable states */
            <ul style={{ margin: 0, paddingLeft: "16px", color: "#555", fontSize: "0.9rem" }}>
              {displayActions.map((action, i) => (
                <li key={i} style={{ marginBottom: "4px" }}>{action}</li>
              ))}
            </ul>
          )}
        </div>

        {/* Secondary Actions (Dismiss only - checklist submission is primary review path) */}
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
          {/* Dismiss button - only show for active recommendations */}
          {isActionable && (
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
          )}

          {/* Feedback prompt - show after actions submitted (resolved/pending) or reviewed */}
          {(isResolved || isPending || isReviewed) && !recommendation.feedback && (
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

            {/* Teacher selected actions section */}
            {recommendation.submittedActions && recommendation.submittedActions.length > 0 && (
              <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid #e0e0e0" }}>
                <strong>Teacher actions taken:</strong>
                <ul
                  style={{
                    margin: "8px 0 0 0",
                    paddingLeft: "20px",
                    listStyle: "none",
                  }}
                >
                  {recommendation.submittedActions.map((action, i) => (
                    <li key={i} style={{ marginBottom: "4px", display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ color: "#2e7d32" }}>✓</span>
                      <span>{action.label}</span>
                      <span style={{ fontSize: "0.8rem", color: "#999" }}>
                        ({new Date(action.submittedAt).toLocaleDateString()})
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
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

      {showAssignPracticeConfirm && (
        <ConfirmationModal
          title="Assign Practice"
          message={`This will assign additional practice to ${recommendation.studentIds.length} student${recommendation.studentIds.length > 1 ? "s" : ""} (${studentName}). You can select the practice material after confirming.`}
          confirmLabel="Assign Practice"
          confirmColor="#1565c0"
          onConfirm={handleAssignPractice}
          onCancel={() => setShowAssignPracticeConfirm(false)}
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

export type RecommendationFilter = "active" | "pending" | "resolved";

interface RecommendationPanelProps {
  recommendations: Recommendation[];
  students?: StudentInfo[];
  stats?: RecommendationStats;
  onDismiss: (id: string) => void;
  onFeedback: (id: string, feedback: FeedbackType) => void;
  onRefresh: () => void;
  onFilterChange?: (filter: RecommendationFilter) => void;
  loading?: boolean;
  currentFilter?: RecommendationFilter;
}

export default function RecommendationPanel({
  recommendations,
  students = [],
  stats,
  onDismiss,
  onFeedback,
  onRefresh,
  onFilterChange,
  loading = false,
  currentFilter = "active",
}: RecommendationPanelProps) {
  const [showReviewed, setShowReviewed] = useState(false);
  const [badgeTypes, setBadgeTypes] = useState<BadgeTypeInfo[]>([]);
  const [filter, setFilter] = useState<RecommendationFilter>(currentFilter);

  // Load badge types on mount
  useEffect(() => {
    getBadgeTypes()
      .then((data) => setBadgeTypes(data.badgeTypes))
      .catch((err) => console.error("Failed to load badge types:", err));
  }, []);

  // Sync external filter changes
  useEffect(() => {
    setFilter(currentFilter);
  }, [currentFilter]);

  // Handle filter change
  const handleFilterChange = (newFilter: RecommendationFilter) => {
    setFilter(newFilter);
    onFilterChange?.(newFilter);
  };

  // Build student lookup map
  const studentMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const student of students) {
      map.set(student.id, student.name);
    }
    return map;
  }, [students]);

  // For backward compatibility: filter locally when no external filtering
  const activeRecs = recommendations.filter((r) => r.status === "active");
  const reviewedRecs = recommendations.filter((r) => r.status === "reviewed");
  const hasFilterTabs = !!(stats || onFilterChange);

  // Handler for when an action is taken (updates recommendation status)
  const handleAction = (id: string, action: string, result: unknown) => {
    console.log(`Action ${action} completed for ${id}:`, result);
    // The recommendation should now be marked as reviewed by the API
    // Trigger a refresh to update the UI
    onRefresh();
  };

  // Get message for empty state based on current filter
  const getEmptyMessage = () => {
    if (!hasFilterTabs) {
      return "No recommendations right now. Your students are doing great!";
    }
    switch (filter) {
      case "pending":
        return "No pending recommendations. Students haven't been reassigned recently.";
      case "resolved":
        return "No resolved recommendations yet. Actions you take will appear here.";
      default:
        return "No active recommendations right now. Your students are doing great!";
    }
  };

  // Nothing to show (and no filter tabs)
  if (!hasFilterTabs && activeRecs.length === 0 && reviewedRecs.length === 0) {
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
              {getEmptyMessage()}
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
            {recommendations.length} recommendation{recommendations.length !== 1 ? "s" : ""} based on student
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

      {/* Filter Tabs */}
      {(stats || onFilterChange) && (
        <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
          <button
            onClick={() => handleFilterChange("active")}
            style={{
              padding: "6px 12px",
              fontSize: "0.85rem",
              fontWeight: filter === "active" ? 600 : 400,
              background: filter === "active" ? "#667eea" : "transparent",
              color: filter === "active" ? "white" : "#666",
              border: filter === "active" ? "none" : "1px solid #ddd",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            Active {stats ? `(${stats.totalActive})` : ""}
          </button>
          <button
            onClick={() => handleFilterChange("pending")}
            style={{
              padding: "6px 12px",
              fontSize: "0.85rem",
              fontWeight: filter === "pending" ? 600 : 400,
              background: filter === "pending" ? "#ef6c00" : "transparent",
              color: filter === "pending" ? "white" : "#666",
              border: filter === "pending" ? "none" : "1px solid #ddd",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            Pending {stats ? `(${stats.totalPending})` : ""}
          </button>
          <button
            onClick={() => handleFilterChange("resolved")}
            style={{
              padding: "6px 12px",
              fontSize: "0.85rem",
              fontWeight: filter === "resolved" ? 600 : 400,
              background: filter === "resolved" ? "#2e7d32" : "transparent",
              color: filter === "resolved" ? "white" : "#666",
              border: filter === "resolved" ? "none" : "1px solid #ddd",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            Resolved {stats ? `(${stats.totalResolved})` : ""}
          </button>
        </div>
      )}

      {/* Recommendations List */}
      {recommendations.length > 0 ? (
        recommendations.map((rec) => (
          <RecommendationCard
            key={rec.id}
            recommendation={rec}
            badgeTypes={badgeTypes}
            studentMap={studentMap}
            onDismiss={onDismiss}
            onFeedback={onFeedback}
            onAction={handleAction}
          />
        ))
      ) : (
        <p style={{ color: "#666", fontStyle: "italic", textAlign: "center", padding: "20px" }}>
          {getEmptyMessage()}
        </p>
      )}

      {/* Show Reviewed Toggle - only when filter tabs are not present */}
      {!hasFilterTabs && reviewedRecs.length > 0 && (
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
