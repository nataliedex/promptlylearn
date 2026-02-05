import { useState, useEffect } from "react";
import { getStudentProfilePublic, type StudentProfilePublic } from "../services/api";

interface StudentProfileViewProps {
  isOpen: boolean;
  onClose: () => void;
  studentId: string;
  studentFullName: string;
  studentCode?: string;
}

/**
 * Student Profile View (Student-Facing, Read-Only)
 *
 * Shows the student their profile information.
 * PRIVACY: Only shows sanitized data (no legalName, no accommodation notes).
 * Students CANNOT edit their preferred name - only educators can.
 */
export default function StudentProfileView({
  isOpen,
  onClose,
  studentId,
  studentFullName,
  studentCode,
}: StudentProfileViewProps) {
  const [profile, setProfile] = useState<StudentProfilePublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && studentId) {
      loadProfile();
    }
  }, [isOpen, studentId]);

  const loadProfile = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getStudentProfilePublic(studentId);
      setProfile(data);
    } catch (err) {
      console.error("Failed to load profile:", err);
      setError("Could not load your profile");
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const inputPrefLabel = {
    voice: "Voice",
    typing: "Typing",
    no_preference: "No preference",
  };

  const paceLabel = {
    take_my_time: "Take my time",
    keep_it_moving: "Keep it moving",
  };

  const helpStyleLabel = {
    hints_first: "Hints first",
    examples_first: "Examples first",
    ask_me_questions: "Ask me questions",
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.3)",
          zIndex: 1000,
        }}
      />

      {/* Modal */}
      <div
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(400px, 90vw)",
          maxHeight: "80vh",
          background: "var(--surface-card)",
          borderRadius: "12px",
          boxShadow: "0 8px 30px rgba(0,0,0,0.2)",
          zIndex: 1001,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--border-subtle)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "1.1rem" }}>Your Profile</h2>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: "1.5rem",
              cursor: "pointer",
              color: "var(--text-muted)",
              padding: "4px",
            }}
          >
            x
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: "auto", padding: "20px" }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: "30px 0" }}>
              <div className="loading-spinner" style={{ margin: "0 auto 12px auto" }}></div>
              <p style={{ color: "var(--text-muted)" }}>Loading...</p>
            </div>
          ) : error ? (
            <div style={{ textAlign: "center", padding: "30px 0", color: "var(--status-error-text)" }}>
              {error}
            </div>
          ) : profile ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {/* Name Info */}
              <div
                style={{
                  padding: "16px",
                  background: "var(--surface-accent-tint)",
                  borderRadius: "10px",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.9rem" }}>
                    <span style={{ color: "var(--text-secondary)" }}>Full Name</span>
                    <span style={{ fontWeight: 500 }}>{studentFullName}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.9rem" }}>
                    <span style={{ color: "var(--text-secondary)" }}>Preferred Name</span>
                    <span style={{ fontWeight: 500 }}>{profile.preferredName || "—"}</span>
                  </div>
                  {profile.pronouns && (
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.9rem" }}>
                      <span style={{ color: "var(--text-secondary)" }}>Pronouns</span>
                      <span style={{ fontWeight: 500 }}>{profile.pronouns}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Login Code */}
              {studentCode && (
                <div
                  style={{
                    padding: "12px 16px",
                    background: "var(--surface-muted)",
                    borderRadius: "8px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>Your login code</span>
                  <code
                    style={{
                      fontSize: "1.1rem",
                      fontWeight: 600,
                      letterSpacing: "2px",
                      color: "var(--text-primary)",
                    }}
                  >
                    {studentCode}
                  </code>
                </div>
              )}

              {/* Preferences */}
              <div>
                <h3 style={{ margin: "0 0 10px 0", fontSize: "0.9rem", color: "var(--text-muted)" }}>
                  Your Preferences
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.9rem" }}>
                    <span style={{ color: "var(--text-secondary)" }}>Input method</span>
                    <span style={{ fontWeight: 500 }}>{inputPrefLabel[profile.inputPreference]}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.9rem" }}>
                    <span style={{ color: "var(--text-secondary)" }}>Pacing</span>
                    <span style={{ fontWeight: 500 }}>{paceLabel[profile.pacePreference]}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.9rem" }}>
                    <span style={{ color: "var(--text-secondary)" }}>Help style</span>
                    <span style={{ fontWeight: 500 }}>{helpStyleLabel[profile.coachHelpStyle]}</span>
                  </div>
                </div>
              </div>

              {/* Note about editing */}
              <p style={{ margin: "8px 0 0 0", fontSize: "0.8rem", color: "var(--text-muted)", textAlign: "center" }}>
                Your teacher can update your profile settings
              </p>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "12px 20px",
            borderTop: "1px solid var(--border-subtle)",
          }}
        >
          <button
            className="btn btn-primary"
            onClick={onClose}
            style={{ width: "100%" }}
          >
            Done
          </button>
        </div>
      </div>
    </>
  );
}
