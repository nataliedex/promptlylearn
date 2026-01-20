/**
 * Mode Toggle - Switch between voice and text mode
 *
 * When text is on: shows complete dialogue
 * When voice is on: hides dialogue, uses spoken interaction
 */

interface ModeToggleProps {
  mode: "voice" | "type";
  onToggle: (mode: "voice" | "type") => void;
  disabled?: boolean;
}

export default function ModeToggle({ mode, onToggle, disabled }: ModeToggleProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "8px 16px",
        background: "rgba(255,255,255,0.9)",
        borderRadius: "24px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
      }}
    >
      <button
        onClick={() => onToggle("type")}
        disabled={disabled}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "8px 16px",
          border: "none",
          borderRadius: "16px",
          background: mode === "type" ? "#667eea" : "transparent",
          color: mode === "type" ? "white" : "#666",
          cursor: disabled ? "not-allowed" : "pointer",
          fontWeight: mode === "type" ? 600 : 400,
          fontSize: "0.9rem",
          transition: "all 0.2s",
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <span>💬</span>
        <span>Text</span>
      </button>
      <button
        onClick={() => onToggle("voice")}
        disabled={disabled}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "8px 16px",
          border: "none",
          borderRadius: "16px",
          background: mode === "voice" ? "#667eea" : "transparent",
          color: mode === "voice" ? "white" : "#666",
          cursor: disabled ? "not-allowed" : "pointer",
          fontWeight: mode === "voice" ? 600 : 400,
          fontSize: "0.9rem",
          transition: "all 0.2s",
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <span>🎤</span>
        <span>Voice</span>
      </button>
    </div>
  );
}
