/**
 * InsightCard - Insight display component for student review contexts
 *
 * Used in:
 * - InsightsDrawer (assignment table view)
 * - StudentAssignmentReview (student review page)
 *
 * Displays insight context to help teachers understand where to focus attention.
 * No action-taking capabilities - those happen through normal review workflow.
 *
 * Card structure:
 * - Category badge (EXTEND LEARNING, NEEDS SUPPORT, CHECK IN)
 * - Title: "{Student name} may benefit from {focus area}"
 * - Supporting evidence (max 3 bullets)
 * - Scope context (Assignment name, Class name)
 * - Dismiss (subtle text action)
 *
 * Interaction:
 * - Card is clickable when onNavigate is provided
 * - Dismiss stops propagation to prevent navigation
 */

import { useMemo } from "react";
import type { Recommendation } from "../services/api";
import { getCategoryKey, getCategoryConfig } from "../utils/recommendationConfig";

interface InsightCardProps {
  recommendation: Recommendation;
  studentName?: string;
  onDismiss?: (recommendationId: string) => void;
  onNavigate?: () => void;
  compact?: boolean;
}

export default function InsightCard({
  recommendation,
  studentName,
  onDismiss,
  onNavigate,
  compact = false,
}: InsightCardProps) {
  const config = getCategoryConfig(recommendation);

  // Status checks
  const isResolved = recommendation.status === "resolved";
  const isReviewed = recommendation.status === "reviewed";
  const isDimmed = isResolved || isReviewed;
  const isActive = !isDimmed;
  const isClickable = !!onNavigate && isActive;

  // Get student display name
  const getStudentDisplayName = (): string => {
    if (studentName) return studentName;
    if (recommendation.triggerData.signals.studentName) {
      return recommendation.triggerData.signals.studentName as string;
    }
    if (recommendation.triggerData.signals.studentNames) {
      return recommendation.triggerData.signals.studentNames as string;
    }
    return recommendation.studentIds.length === 1
      ? "This student"
      : `${recommendation.studentIds.length} students`;
  };

  const displayStudentName = getStudentDisplayName();

  // Build focus area from recommendation data
  const getFocusArea = (): string => {
    if (recommendation.summary) {
      const match = recommendation.summary.match(/may benefit from (.+)/i);
      if (match) return match[1];
    }

    const categoryKey = getCategoryKey(recommendation);
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
  const displayTitle = `${displayStudentName} may benefit from ${getFocusArea()}`;

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

  // Handle card click
  const handleCardClick = () => {
    if (isClickable) {
      onNavigate?.();
    }
  };

  // Handle dismiss click - stop propagation so card doesn't navigate
  const handleDismissClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDismiss?.(recommendation.id);
  };

  return (
    <div
      onClick={handleCardClick}
      style={{
        background: isDimmed ? "#f8fafc" : "white",
        borderLeft: `3px solid ${config.color}`,
        borderRadius: "6px",
        padding: compact ? "12px 14px" : "16px 18px",
        marginBottom: "12px",
        opacity: isDimmed ? 0.7 : 1,
        cursor: isClickable ? "pointer" : "default",
        transition: "all 0.15s ease",
        boxShadow: isDimmed ? "none" : "0 1px 3px rgba(0,0,0,0.04)",
      }}
      onMouseEnter={(e) => {
        if (isClickable) {
          e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.08)";
          e.currentTarget.style.transform = "translateY(-1px)";
        }
      }}
      onMouseLeave={(e) => {
        if (isClickable) {
          e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.04)";
          e.currentTarget.style.transform = "translateY(0)";
        }
      }}
    >
      {/* Category badge row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          marginBottom: "8px",
          flexWrap: "wrap",
        }}
      >
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

        {/* Status badges for resolved/reviewed */}
        {isResolved && (
          <span
            style={{
              fontSize: "0.65rem",
              fontWeight: 500,
              background: "#f0fdf4",
              color: "#166534",
              padding: "3px 8px",
              borderRadius: "3px",
            }}
          >
            Resolved
          </span>
        )}
        {isReviewed && !isResolved && (
          <span
            style={{
              fontSize: "0.65rem",
              fontWeight: 500,
              background: "#f1f5f9",
              color: "#64748b",
              padding: "3px 8px",
              borderRadius: "3px",
            }}
          >
            Reviewed
          </span>
        )}
      </div>

      {/* Title */}
      <h3
        style={{
          margin: "0 0 10px 0",
          color: "#2d3748",
          fontSize: compact ? "0.9rem" : "1rem",
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
            fontSize: compact ? "0.8rem" : "0.85rem",
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
            marginBottom: isActive && onDismiss ? "10px" : "0",
          }}
        >
          {scopeParts.join(" · ")}
        </div>
      )}

      {/* Dismiss action - only for active insights */}
      {isActive && onDismiss && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={handleDismissClick}
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
      )}
    </div>
  );
}
