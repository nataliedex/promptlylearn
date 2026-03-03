/**
 * Mode Toggle - Switch between voice and text mode
 *
 * Voice-first design: Talk is recommended and visually emphasized
 * Type is available as a fallback option
 */

interface ModeToggleProps {
  mode: "voice" | "type";
  onToggle: (mode: "voice" | "type") => void;
  disabled?: boolean;
  showHeader?: boolean; // Show "How would you like to practice?" header
  compact?: boolean; // Use compact inline style (for header toggle)
}

export default function ModeToggle({
  mode,
  onToggle,
  disabled,
  showHeader = false,
  compact = false,
}: ModeToggleProps) {
  if (compact) {
    // Compact inline toggle for header
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "6px 12px",
          background: "#ffffff",
          borderRadius: "20px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
        }}
      >
        <button
          onClick={() => onToggle("voice")}
          disabled={disabled}
          style={{
            padding: "6px 14px",
            border: "none",
            borderRadius: "14px",
            background: mode === "voice" ? "#3d5a80" : "transparent",
            color: mode === "voice" ? "white" : "#666",
            cursor: disabled ? "not-allowed" : "pointer",
            fontWeight: mode === "voice" ? 600 : 400,
            fontSize: "0.85rem",
            transition: "all 0.2s",
            opacity: disabled ? 0.6 : 1,
          }}
        >
          Talk
        </button>
        <button
          onClick={() => onToggle("type")}
          disabled={disabled}
          style={{
            padding: "6px 14px",
            border: "none",
            borderRadius: "14px",
            background: mode === "type" ? "#3d5a80" : "transparent",
            color: mode === "type" ? "white" : "#666",
            cursor: disabled ? "not-allowed" : "pointer",
            fontWeight: mode === "type" ? 600 : 400,
            fontSize: "0.85rem",
            transition: "all 0.2s",
            opacity: disabled ? 0.6 : 1,
          }}
        >
          Type
        </button>
      </div>
    );
  }

  // Full mode toggle with optional header and descriptions
  return (
    <div style={{ textAlign: "center" }}>
      {showHeader && (
        <p
          style={{
            margin: "0 0 12px 0",
            fontSize: "0.9rem",
            fontWeight: 500,
            color: "#475569",
          }}
        >
          How would you like to practice?
        </p>
      )}
      <div
        style={{
          display: "flex",
          gap: "12px",
          justifyContent: "center",
        }}
      >
        {/* Talk (recommended) - Primary option */}
        <button
          onClick={() => onToggle("voice")}
          disabled={disabled}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "4px",
            padding: "14px 20px",
            border: mode === "voice" ? "2px solid #3d5a80" : "2px solid #e2e8f0",
            borderRadius: "12px",
            background: mode === "voice" ? "#eef2ff" : "#ffffff",
            cursor: disabled ? "not-allowed" : "pointer",
            transition: "all 0.2s",
            opacity: disabled ? 0.6 : 1,
            minWidth: "140px",
          }}
        >
          <span
            style={{
              fontWeight: 600,
              fontSize: "0.95rem",
              color: mode === "voice" ? "#2c4a6e" : "#334155",
            }}
          >
            Talk
            <span
              style={{
                marginLeft: "6px",
                fontSize: "0.7rem",
                fontWeight: 500,
                color: "#3d5a80",
                background: "#e0e7ff",
                padding: "2px 6px",
                borderRadius: "4px",
                verticalAlign: "middle",
              }}
            >
              recommended
            </span>
          </span>
          <span
            style={{
              fontSize: "0.75rem",
              color: "#64748b",
              fontWeight: 400,
            }}
          >
            Practice out loud with your coach
          </span>
        </button>

        {/* Type - Secondary option */}
        <button
          onClick={() => onToggle("type")}
          disabled={disabled}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "4px",
            padding: "14px 20px",
            border: mode === "type" ? "2px solid #3d5a80" : "2px solid #e2e8f0",
            borderRadius: "12px",
            background: mode === "type" ? "#f0f4ff" : "#ffffff",
            cursor: disabled ? "not-allowed" : "pointer",
            transition: "all 0.2s",
            opacity: disabled ? 0.6 : 1,
            minWidth: "140px",
          }}
        >
          <span
            style={{
              fontWeight: 600,
              fontSize: "0.95rem",
              color: mode === "type" ? "#2c4a6e" : "#334155",
            }}
          >
            Type
          </span>
          <span
            style={{
              fontSize: "0.75rem",
              color: "#64748b",
              fontWeight: 400,
            }}
          >
            Type your messages instead
          </span>
        </button>
      </div>
    </div>
  );
}
