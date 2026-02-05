import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import type { StudentBadge } from "../services/api";

interface BadgeDetailModalProps {
  badge: StudentBadge;
  studentId: string;
  onClose: () => void;
}

// Badge display configuration
const BADGE_CONFIG: Record<string, {
  icon: string;
  name: string;
  color: string;
  defaultReason: string;
  encouragement: string;
}> = {
  progress_star: {
    icon: "",
    name: "Progress Star",
    color: "#ffc107",
    defaultReason: "You worked hard and improved your score on this assignment!",
    encouragement: "Your hard work is paying off. Keep practicing!",
  },
  mastery_badge: {
    icon: "",
    name: "Mastery Badge",
    color: "#ff9800",
    defaultReason: "You showed great understanding across multiple lessons in this subject!",
    encouragement: "You really know your stuff. Amazing work!",
  },
  effort_award: {
    icon: "",
    name: "Effort Award",
    color: "#4caf50",
    defaultReason: "You put in great effort on your work!",
    encouragement: "Effort is what matters most. Keep it up!",
  },
  helper_badge: {
    icon: "",
    name: "Helper Badge",
    color: "#2196f3",
    defaultReason: "You helped others learn!",
    encouragement: "Helping others is a wonderful skill!",
  },
  persistence: {
    icon: "",
    name: "Focus Badge",
    color: "#9c27b0",
    defaultReason: "You didn't give up, even when it was challenging!",
    encouragement: "Sticking with hard things is how we grow!",
  },
  curiosity: {
    icon: "",
    name: "Curiosity Award",
    color: "#00bcd4",
    defaultReason: "You asked great questions and explored new ideas!",
    encouragement: "Curious minds discover amazing things!",
  },
  custom: {
    icon: "",
    name: "Special Badge",
    color: "#e91e63",
    defaultReason: "Your teacher gave you this special recognition!",
    encouragement: "You're doing great things!",
  },
};

/**
 * Format evidence into kid-friendly bullet points
 */
function formatEvidence(badge: StudentBadge): string[] {
  const points: string[] = [];
  const evidence = badge.evidence;

  if (!evidence) return points;

  // Progress Star evidence
  if (badge.badgeType === "progress_star") {
    if (evidence.previousScore !== undefined && evidence.currentScore !== undefined) {
      points.push(`Your score went from ${Math.round(evidence.previousScore)}% to ${Math.round(evidence.currentScore)}%`);
    }
    if (evidence.improvement !== undefined) {
      points.push(`That's ${Math.round(evidence.improvement)} points better!`);
    }
  }

  // Mastery Badge evidence
  if (badge.badgeType === "mastery_badge") {
    if (evidence.subjectAverageScore !== undefined) {
      points.push(`You averaged ${Math.round(evidence.subjectAverageScore)}% in ${badge.subject || "this subject"}`);
    }
    if (evidence.subjectAssignmentCount !== undefined) {
      points.push(`Across ${evidence.subjectAssignmentCount} different lessons`);
    }
    if (evidence.hintUsageRate !== undefined && evidence.hintUsageRate <= 0.2) {
      points.push("With very little help from the coach!");
    }
  }

  // Focus Badge (persistence) evidence
  if (badge.badgeType === "persistence") {
    if (evidence.hintUsageRate !== undefined) {
      points.push("You used the coach to help you learn");
    }
    if (evidence.currentScore !== undefined) {
      points.push(`And still scored ${Math.round(evidence.currentScore)}%`);
    }
    points.push("Great job sticking with it!");
  }

  return points;
}

export default function BadgeDetailModal({ badge, studentId, onClose }: BadgeDetailModalProps) {
  const navigate = useNavigate();
  const config = BADGE_CONFIG[badge.badgeType] || BADGE_CONFIG.custom;
  const evidencePoints = formatEvidence(badge);

  // Handle keyboard escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Handle clicking on the backdrop to close
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // Navigate to completed work with highlighting
  const handleViewWork = () => {
    // Build query params for highlighting
    const params = new URLSearchParams();
    params.set("badgeId", badge.id);

    if (badge.assignmentId) {
      params.set("highlightAssignmentId", badge.assignmentId);
    }

    // Navigate to student dashboard with highlighting params
    navigate(`/student/${studentId}?${params.toString()}`);
    onClose();
  };

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
      onClick={handleBackdropClick}
    >
      <div
        className="card"
        style={{
          maxWidth: "420px",
          width: "90%",
          maxHeight: "85vh",
          overflow: "auto",
          position: "relative",
          padding: "24px",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: "absolute",
            top: "12px",
            right: "12px",
            background: "none",
            border: "none",
            fontSize: "1.5rem",
            color: "#999",
            cursor: "pointer",
            padding: "4px 8px",
            lineHeight: 1,
          }}
          aria-label="Close"
        >
          ×
        </button>

        {/* Badge Icon & Name */}
        <div style={{ textAlign: "center", marginBottom: "20px" }}>
          <div
            style={{
              fontSize: "4rem",
              marginBottom: "8px",
              filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.1))",
            }}
          >
            {config.icon}
          </div>
          <h2
            style={{
              margin: "0 0 4px 0",
              color: config.color,
              fontSize: "1.5rem",
            }}
          >
            {badge.badgeTypeName || config.name}
          </h2>
          {/* Subject & Date */}
          <p style={{ margin: 0, color: "#666", fontSize: "0.9rem" }}>
            {badge.subject && <span>{badge.subject} • </span>}
            {new Date(badge.awardedAt).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        </div>

        {/* Why you earned it */}
        <div
          style={{
            background: "#f8f9fa",
            borderRadius: "12px",
            padding: "16px",
            marginBottom: "16px",
          }}
        >
          <h3
            style={{
              margin: "0 0 8px 0",
              fontSize: "1rem",
              color: "#333",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            Why you earned it
          </h3>
          <p
            style={{
              margin: 0,
              color: "#555",
              fontSize: "0.95rem",
              lineHeight: 1.5,
            }}
          >
            {badge.reason || config.defaultReason}
          </p>
        </div>

        {/* Evidence (if available) */}
        {evidencePoints.length > 0 && (
          <div
            style={{
              background: "#e8f5e9",
              borderRadius: "12px",
              padding: "16px",
              marginBottom: "16px",
            }}
          >
            <h3
              style={{
                margin: "0 0 8px 0",
                fontSize: "1rem",
                color: "#333",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              Here's what you did
            </h3>
            <ul
              style={{
                margin: 0,
                paddingLeft: "20px",
                color: "#555",
                fontSize: "0.95rem",
                lineHeight: 1.6,
              }}
            >
              {evidencePoints.map((point, index) => (
                <li key={index}>{point}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Linked Work (if assignment or subject exists) */}
        {(badge.assignmentId || badge.subject) && (
          <div
            style={{
              background: "#e3f2fd",
              borderRadius: "12px",
              padding: "16px",
              marginBottom: "16px",
            }}
          >
            <h3
              style={{
                margin: "0 0 8px 0",
                fontSize: "1rem",
                color: "#333",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              Linked work
            </h3>
            {badge.assignmentTitle ? (
              <p
                style={{
                  margin: "0 0 8px 0",
                  color: "#555",
                  fontSize: "0.95rem",
                }}
              >
                {badge.assignmentTitle}
              </p>
            ) : badge.subject ? (
              <p
                style={{
                  margin: "0 0 8px 0",
                  color: "#555",
                  fontSize: "0.95rem",
                }}
              >
                Your work in {badge.subject}
              </p>
            ) : null}
            <button
              onClick={handleViewWork}
              style={{
                background: "#7c8fce",
                color: "white",
                border: "none",
                borderRadius: "8px",
                padding: "8px 16px",
                fontSize: "0.9rem",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <span>📖</span> View my work
            </button>
          </div>
        )}

        {/* Encouragement */}
        <div
          style={{
            textAlign: "center",
            padding: "12px",
            background: `linear-gradient(135deg, ${config.color}15, ${config.color}05)`,
            borderRadius: "12px",
            border: `1px solid ${config.color}30`,
          }}
        >
          <p
            style={{
              margin: 0,
              color: "#333",
              fontSize: "1rem",
              fontWeight: 500,
            }}
          >
            {config.encouragement}
          </p>
        </div>
      </div>
    </div>
  );
}
