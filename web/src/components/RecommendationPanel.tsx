/**
 * RecommendationPanel - Recommended Actions UI Component
 *
 * Core Principle: Recommended Actions only shows items that require educator attention.
 * If no action is needed, nothing appears.
 *
 * This surface answers one question: "Where should I look next?"
 *
 * Card structure:
 * - Category badge (EXTEND LEARNING, NEEDS SUPPORT, CHECK IN)
 * - Title: "{Student name} may benefit from {focus area}"
 * - Supporting evidence (max 3 bullets)
 * - Scope context (Assignment name, Class name)
 * - Dismiss (subtle text action)
 *
 * Interaction:
 * - Entire card is clickable → navigates to relevant review context
 * - Passes navigation state for proper back button behavior
 * - No buttons, no checkboxes, no action controls
 */

import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { type Recommendation, type FeedbackType } from "../services/api";
import { getCategoryKey, getCategoryConfig } from "../utils/recommendationConfig";

// Navigation state passed to student review page
export interface RecommendationNavigationState {
  from: "recommended-actions";
  returnTo: string;
  scrollTo: string;
  recommendationId: string;
  recommendationType: string;
  categoryLabel: string;
}

// ============================================
// Recommendation Card Component
// ============================================

interface RecommendationCardProps {
  recommendation: Recommendation;
  studentMap: Map<string, string>;
  onDismiss: (id: string) => void;
}

function RecommendationCard({
  recommendation,
  studentMap,
  onDismiss,
}: RecommendationCardProps) {
  const navigate = useNavigate();
  const config = getCategoryConfig(recommendation);
  const categoryKey = getCategoryKey(recommendation);

  // Get student name for display
  const getStudentDisplayName = (): string => {
    if (recommendation.studentIds.length === 1) {
      const nameFromMap = studentMap.get(recommendation.studentIds[0]);
      if (nameFromMap) return nameFromMap;
    }
    if (recommendation.triggerData.signals.studentName) {
      return recommendation.triggerData.signals.studentName as string;
    }
    if (recommendation.triggerData.signals.studentNames) {
      return recommendation.triggerData.signals.studentNames as string;
    }
    if (recommendation.studentIds.length > 1) {
      const names = recommendation.studentIds
        .map((id) => studentMap.get(id))
        .filter(Boolean);
      if (names.length > 0) return names.join(", ");
    }
    return recommendation.studentIds.length === 1
      ? "This student"
      : `${recommendation.studentIds.length} students`;
  };

  const studentName = getStudentDisplayName();

  // Build focus area from recommendation data
  const getFocusArea = (): string => {
    if (recommendation.summary) {
      const match = recommendation.summary.match(/may benefit from (.+)/i);
      if (match) return match[1];
    }

    switch (categoryKey) {
      case "challenge-opportunity":
      case "celebrate-progress":
        return "enrichment activities";
      case "needs-support":
      case "group-review":
        return "additional support";
      case "check-in-suggested":
      case "developing":
        return "a check-in";
      default:
        return "teacher attention";
    }
  };

  // Build title
  const displayTitle = `${studentName} may benefit from ${getFocusArea()}`;

  // Get supporting evidence (max 3 bullets)
  const evidenceBullets = useMemo(() => {
    const bullets: string[] = [];

    if (recommendation.evidence?.length) {
      bullets.push(...recommendation.evidence.slice(0, 3));
    } else if (recommendation.reason) {
      bullets.push(recommendation.reason);
    }

    return bullets.slice(0, 3);
  }, [recommendation.evidence, recommendation.reason]);

  // Build scope context
  const scopeParts = useMemo(() => {
    const parts: string[] = [];
    const signals = recommendation.triggerData.signals;

    if (signals.assignmentTitle) {
      parts.push(`Assignment: ${signals.assignmentTitle as string}`);
    }
    if (signals.className) {
      parts.push(signals.className as string);
    }

    return parts;
  }, [recommendation.triggerData.signals]);

  // Handle card click - navigate with state for back button
  const handleCardClick = () => {
    const navigationState: RecommendationNavigationState = {
      from: "recommended-actions",
      returnTo: "/educator",
      scrollTo: "recommended-actions",
      recommendationId: recommendation.id,
      recommendationType: categoryKey,
      categoryLabel: config.label,
    };

    if (recommendation.assignmentId && recommendation.studentIds.length > 0) {
      navigate(
        `/educator/assignment/${recommendation.assignmentId}/student/${recommendation.studentIds[0]}`,
        { state: navigationState }
      );
    } else if (recommendation.studentIds.length > 0) {
      navigate(`/educator/student/${recommendation.studentIds[0]}`, {
        state: navigationState,
      });
    } else if (recommendation.assignmentId) {
      navigate(`/educator/assignment/${recommendation.assignmentId}`, {
        state: navigationState,
      });
    }
  };

  // Handle dismiss click - stop propagation so card doesn't navigate
  const handleDismissClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDismiss(recommendation.id);
  };

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleCardClick();
    }
  };

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={handleCardClick}
      onKeyDown={handleKeyDown}
      aria-label={`${config.label}: ${displayTitle}. Click to review.`}
      style={{
        background: "white",
        borderLeft: `3px solid ${config.color}`,
        borderRadius: "6px",
        padding: "16px 18px",
        marginBottom: "12px",
        cursor: "pointer",
        transition: "all 0.15s ease",
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        outline: "none",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.08)";
        e.currentTarget.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.04)";
        e.currentTarget.style.transform = "translateY(0)";
      }}
      onFocus={(e) => {
        e.currentTarget.style.boxShadow = "0 0 0 2px var(--accent-primary, #7c8fce)";
      }}
      onBlur={(e) => {
        e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.04)";
      }}
    >
      {/* Category badge */}
      <div style={{ marginBottom: "8px" }}>
        <span
          style={{
            fontSize: "0.65rem",
            fontWeight: 600,
            color: config.color,
            background: config.bgColor,
            padding: "3px 10px",
            borderRadius: "3px",
            letterSpacing: "0.05em",
          }}
        >
          {config.label}
        </span>
      </div>

      {/* Title */}
      <h3
        style={{
          margin: "0 0 10px 0",
          color: "#2d3748",
          fontSize: "1rem",
          fontWeight: 600,
          lineHeight: 1.4,
        }}
      >
        {displayTitle}
      </h3>

      {/* Supporting evidence */}
      {evidenceBullets.length > 0 && (
        <ul
          style={{
            margin: "0 0 10px 0",
            paddingLeft: "18px",
            color: "#64748b",
            fontSize: "0.85rem",
            lineHeight: 1.5,
          }}
        >
          {evidenceBullets.map((bullet, i) => (
            <li key={i} style={{ marginBottom: "2px" }}>
              {bullet}
            </li>
          ))}
        </ul>
      )}

      {/* Scope context */}
      {scopeParts.length > 0 && (
        <div
          style={{
            fontSize: "0.8rem",
            color: "#94a3b8",
            marginBottom: "12px",
          }}
        >
          {scopeParts.join(" · ")}
        </div>
      )}

      {/* Footer with dismiss */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          onClick={handleDismissClick}
          aria-label="Dismiss this recommendation"
          style={{
            padding: "4px 8px",
            fontSize: "0.75rem",
            background: "transparent",
            color: "#94a3b8",
            border: "none",
            cursor: "pointer",
            fontWeight: 500,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "#64748b";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "#94a3b8";
          }}
        >
          Dismiss
        </button>
      </div>
    </article>
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
  onDismiss: (id: string) => void;
  onFeedback?: (id: string, feedback: FeedbackType) => void;
  onRefresh?: () => void;
}

export default function RecommendationPanel({
  recommendations,
  students = [],
  onDismiss,
}: RecommendationPanelProps) {
  // Build student lookup map
  const studentMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const student of students) {
      map.set(student.id, student.name);
    }
    return map;
  }, [students]);

  // Filter to only active recommendations that require attention
  // Never show "0 students" recommendations
  const actionableRecs = recommendations.filter(
    (r) => r.status === "active" && r.studentIds.length > 0
  );

  // If nothing actionable, render nothing
  // Silence is better than noise
  if (actionableRecs.length === 0) {
    return null;
  }

  return (
    <section
      id="recommended-actions"
      aria-labelledby="recommended-actions-heading"
      style={{
        marginBottom: "24px",
      }}
    >
      {/* Header - uses white text for purple background */}
      <div style={{ marginBottom: "16px" }}>
        <h2
          id="recommended-actions-heading"
          style={{
            margin: 0,
            color: "var(--text-on-dark, rgba(255, 255, 255, 0.95))",
            fontSize: "1.125rem",
            fontWeight: 600,
          }}
        >
          Recommended Actions
        </h2>
        <p
          style={{
            margin: "4px 0 0 0",
            color: "var(--text-on-dark-muted, rgba(255, 255, 255, 0.7))",
            fontSize: "0.85rem",
          }}
        >
          Students who may benefit from your attention
        </p>
      </div>

      {/* Recommendations List */}
      {actionableRecs.map((rec) => (
        <RecommendationCard
          key={rec.id}
          recommendation={rec}
          studentMap={studentMap}
          onDismiss={onDismiss}
        />
      ))}
    </section>
  );
}
