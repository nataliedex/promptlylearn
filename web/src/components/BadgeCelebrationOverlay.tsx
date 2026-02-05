import { useEffect, useState } from "react";
import type { StudentBadge } from "../services/api";

interface BadgeCelebrationOverlayProps {
  badge: StudentBadge;
  onViewBadge: () => void;
  onDismiss: () => void;
}

// Badge display configuration
const BADGE_CONFIG: Record<string, { icon: string; color: string }> = {
  progress_star: { icon: "⭐", color: "#ffc107" },
  mastery_badge: { icon: "🏆", color: "#ff9800" },
  effort_award: { icon: "💪", color: "#4caf50" },
  helper_badge: { icon: "🤝", color: "#2196f3" },
  persistence: { icon: "🎯", color: "#9c27b0" },
  curiosity: { icon: "🔍", color: "#00bcd4" },
  custom: { icon: "🌟", color: "#e91e63" },
};

// Confetti piece component
function ConfettiPiece({ delay, left, color }: { delay: number; left: number; color: string }) {
  return (
    <div
      style={{
        position: "absolute",
        top: "-10px",
        left: `${left}%`,
        width: "10px",
        height: "10px",
        backgroundColor: color,
        borderRadius: Math.random() > 0.5 ? "50%" : "2px",
        animation: `confetti-fall 2s ease-out ${delay}s forwards`,
        opacity: 0,
        transform: `rotate(${Math.random() * 360}deg)`,
      }}
    />
  );
}

export default function BadgeCelebrationOverlay({
  badge,
  onViewBadge,
  onDismiss,
}: BadgeCelebrationOverlayProps) {
  const [visible, setVisible] = useState(true);
  const [fadeOut, setFadeOut] = useState(false);
  const config = BADGE_CONFIG[badge.badgeType] || BADGE_CONFIG.custom;

  // Auto-dismiss after 3 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      setFadeOut(true);
      setTimeout(onDismiss, 300); // Wait for fade animation
    }, 3000);

    return () => clearTimeout(timer);
  }, [onDismiss]);

  // Handle keyboard escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleDismiss();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleDismiss = () => {
    setFadeOut(true);
    setTimeout(onDismiss, 300);
  };

  const handleViewBadge = () => {
    setFadeOut(true);
    setTimeout(onViewBadge, 300);
  };

  if (!visible) return null;

  // Generate confetti pieces
  const confettiColors = ["#ffc107", "#ff9800", "#4caf50", "#2196f3", "#9c27b0", "#e91e63", "#00bcd4"];
  const confettiPieces = Array.from({ length: 50 }, (_, i) => ({
    id: i,
    delay: Math.random() * 0.5,
    left: Math.random() * 100,
    color: confettiColors[Math.floor(Math.random() * confettiColors.length)],
  }));

  return (
    <>
      {/* Confetti animation keyframes */}
      <style>
        {`
          @keyframes confetti-fall {
            0% {
              opacity: 1;
              transform: translateY(0) rotate(0deg);
            }
            100% {
              opacity: 0;
              transform: translateY(100vh) rotate(720deg);
            }
          }
          @keyframes badge-bounce {
            0%, 100% {
              transform: scale(1);
            }
            50% {
              transform: scale(1.1);
            }
          }
          @keyframes sparkle {
            0%, 100% {
              opacity: 0;
              transform: scale(0);
            }
            50% {
              opacity: 1;
              transform: scale(1);
            }
          }
        `}
      </style>

      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(0, 0, 0, 0.4)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 2000,
          opacity: fadeOut ? 0 : 1,
          transition: "opacity 0.3s ease-out",
          overflow: "hidden",
        }}
        onClick={handleDismiss}
      >
        {/* Confetti */}
        {confettiPieces.map((piece) => (
          <ConfettiPiece
            key={piece.id}
            delay={piece.delay}
            left={piece.left}
            color={piece.color}
          />
        ))}

        {/* Celebration Card */}
        <div
          style={{
            background: "white",
            borderRadius: "20px",
            padding: "32px",
            maxWidth: "340px",
            width: "90%",
            textAlign: "center",
            position: "relative",
            boxShadow: "0 10px 40px rgba(0,0,0,0.2)",
            animation: "badge-bounce 0.5s ease-out",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Close button */}
          <button
            onClick={handleDismiss}
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

          {/* Sparkle decorations */}
          <div style={{ position: "absolute", top: "20px", left: "20px", fontSize: "1.5rem", animation: "sparkle 1s ease-in-out infinite" }}>✨</div>
          <div style={{ position: "absolute", top: "40px", right: "40px", fontSize: "1rem", animation: "sparkle 1s ease-in-out 0.3s infinite" }}>✨</div>
          <div style={{ position: "absolute", bottom: "60px", left: "30px", fontSize: "1.2rem", animation: "sparkle 1s ease-in-out 0.6s infinite" }}>✨</div>

          {/* Badge Icon */}
          <div
            style={{
              fontSize: "4rem",
              marginBottom: "16px",
              filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.1))",
              animation: "badge-bounce 0.6s ease-out 0.2s",
            }}
          >
            {config.icon}
          </div>

          {/* Title */}
          <h2
            style={{
              margin: "0 0 8px 0",
              color: "#333",
              fontSize: "1.5rem",
              fontWeight: 600,
            }}
          >
            You earned a new badge!
          </h2>

          {/* Badge Name */}
          <p
            style={{
              margin: "0 0 4px 0",
              color: config.color,
              fontSize: "1.2rem",
              fontWeight: 600,
            }}
          >
            {badge.badgeTypeName}
          </p>

          {/* Subject */}
          {badge.subject && (
            <p
              style={{
                margin: "0 0 20px 0",
                color: "#666",
                fontSize: "0.95rem",
              }}
            >
              in {badge.subject}
            </p>
          )}

          {/* View Badge Button */}
          <button
            onClick={handleViewBadge}
            style={{
              background: `linear-gradient(135deg, ${config.color}, ${config.color}dd)`,
              color: "white",
              border: "none",
              borderRadius: "12px",
              padding: "14px 28px",
              fontSize: "1rem",
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              margin: "0 auto",
              boxShadow: `0 4px 12px ${config.color}40`,
              transition: "transform 0.2s, box-shadow 0.2s",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.transform = "translateY(-2px)";
              e.currentTarget.style.boxShadow = `0 6px 16px ${config.color}50`;
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = `0 4px 12px ${config.color}40`;
            }}
          >
            <span>🎉</span> View Badge
          </button>
        </div>
      </div>
    </>
  );
}
