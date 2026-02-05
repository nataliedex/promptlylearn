import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Drawer from "./Drawer";
import {
  getTeacherProfile,
  updateTeacherProfile,
  type TeacherProfile,
  type CoachTone,
} from "../services/api";

interface TeacherProfileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onProfileUpdated?: (profile: TeacherProfile) => void;
}

/**
 * Teacher Profile Drawer
 *
 * Right-side drawer for editing teacher profile settings.
 * Includes display information and coach behavior preferences.
 */
export default function TeacherProfileDrawer({
  isOpen,
  onClose,
  onProfileUpdated,
}: TeacherProfileDrawerProps) {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<TeacherProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Form state
  const [fullName, setFullName] = useState("");
  const [studentFacingName, setStudentFacingName] = useState("");
  const [pronouns, setPronouns] = useState("");
  const [coachTone, setCoachTone] = useState<CoachTone>("supportive");

  useEffect(() => {
    if (isOpen) {
      loadProfile();
    }
  }, [isOpen]);

  const loadProfile = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const data = await getTeacherProfile();
      setProfile(data);
      setFullName(data.fullName || "");
      setStudentFacingName(data.studentFacingName || "");
      setPronouns(data.pronouns || "");
      setCoachTone(data.coachTone || "supportive");
    } catch (err) {
      console.error("Failed to load profile:", err);
      setMessage({ type: "error", text: "Failed to load profile" });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);

    try {
      const updated = await updateTeacherProfile({
        fullName: fullName.trim() || undefined,
        studentFacingName: studentFacingName.trim() || undefined,
        pronouns: pronouns.trim() || undefined,
        coachTone,
      });
      setProfile(updated);
      onProfileUpdated?.(updated);
      // Close drawer after successful save
      onClose();
    } catch (err) {
      console.error("Failed to save profile:", err);
      setMessage({ type: "error", text: "Failed to save profile" });
    } finally {
      setSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: "8px",
    border: "1px solid #e2e8f0",
    fontSize: "0.9rem",
    background: "#fff",
    color: "#2d3748",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    marginBottom: "6px",
    fontWeight: 500,
    fontSize: "0.85rem",
    color: "#4a5568",
  };

  const helperStyle: React.CSSProperties = {
    margin: "4px 0 0 0",
    fontSize: "0.75rem",
    color: "#94a3b8",
  };

  const sectionStyle: React.CSSProperties = {
    background: "#f8fafc",
    borderRadius: "10px",
    padding: "16px",
    marginBottom: "16px",
  };

  return (
    <Drawer isOpen={isOpen} onClose={onClose} title="Profile & Settings">
      {loading ? (
        <div style={{ textAlign: "center", padding: "40px 0" }}>
          <div
            className="loading-spinner"
            style={{
              width: "32px",
              height: "32px",
              border: "3px solid #e2e8f0",
              borderTopColor: "#667eea",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
              margin: "0 auto 12px auto",
            }}
          />
          <p style={{ color: "#94a3b8", margin: 0 }}>Loading profile...</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      ) : (
        <>
          {message && (
            <div
              style={{
                padding: "10px 14px",
                marginBottom: "16px",
                borderRadius: "8px",
                background: message.type === "success" ? "#dcfce7" : "#fee2e2",
                color: message.type === "success" ? "#166534" : "#991b1b",
                fontSize: "0.85rem",
              }}
            >
              {message.text}
            </div>
          )}

          {/* Sign Out */}
          <button
            onClick={() => {
              onClose();
              navigate("/");
            }}
            style={{
              width: "100%",
              padding: "10px 16px",
              marginBottom: "16px",
              background: "transparent",
              color: "#64748b",
              border: "1px solid #e2e8f0",
              borderRadius: "8px",
              fontSize: "0.85rem",
              fontWeight: 500,
              cursor: "pointer",
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#f8fafc";
              e.currentTarget.style.borderColor = "#cbd5e1";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.borderColor = "#e2e8f0";
            }}
          >
            Sign Out
          </button>

          {/* Display Information */}
          <div style={sectionStyle}>
            <h3 style={{ margin: "0 0 14px 0", fontSize: "0.95rem", fontWeight: 600, color: "#2d3748" }}>
              Display Information
            </h3>

            <div style={{ marginBottom: "14px" }}>
              <label style={labelStyle}>Full name (internal)</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g., Natalie Blumen"
                style={inputStyle}
              />
              <p style={helperStyle}>Used for your account. Not shown to students.</p>
            </div>

            <div style={{ marginBottom: "14px" }}>
              <label style={labelStyle}>Name shown to students</label>
              <input
                type="text"
                value={studentFacingName}
                onChange={(e) => setStudentFacingName(e.target.value)}
                placeholder="e.g., Mrs. Blumen"
                style={inputStyle}
              />
              <p style={helperStyle}>This is what students will see in the app.</p>
            </div>

            <div>
              <label style={labelStyle}>Pronouns (optional)</label>
              <input
                type="text"
                value={pronouns}
                onChange={(e) => setPronouns(e.target.value)}
                placeholder="e.g., she/her"
                style={inputStyle}
              />
            </div>
          </div>

          {/* Coach Behavior */}
          <div style={sectionStyle}>
            <h3 style={{ margin: "0 0 14px 0", fontSize: "0.95rem", fontWeight: 600, color: "#2d3748" }}>
              Coach Behavior
            </h3>

            <div>
              <label style={{ ...labelStyle, marginBottom: "10px" }}>Coach Tone</label>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {[
                  { value: "supportive", label: "Supportive", desc: "Warm, encouraging, patient" },
                  { value: "direct", label: "Direct", desc: "Clear, concise, to-the-point" },
                  { value: "structured", label: "Structured", desc: "Step-by-step, methodical" },
                ].map((option) => (
                  <label
                    key={option.value}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "10px",
                      padding: "10px 12px",
                      borderRadius: "8px",
                      border:
                        coachTone === option.value
                          ? "2px solid #667eea"
                          : "1px solid #e2e8f0",
                      background: coachTone === option.value ? "#f0f4ff" : "#fff",
                      cursor: "pointer",
                      transition: "all 0.15s",
                    }}
                  >
                    <input
                      type="radio"
                      name="coachTone"
                      value={option.value}
                      checked={coachTone === option.value}
                      onChange={() => setCoachTone(option.value as CoachTone)}
                      style={{ marginTop: "2px" }}
                    />
                    <div>
                      <span style={{ fontWeight: 500, color: "#2d3748", fontSize: "0.9rem" }}>
                        {option.label}
                      </span>
                      <p style={{ margin: "2px 0 0 0", fontSize: "0.75rem", color: "#94a3b8" }}>
                        {option.desc}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Save Button */}
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              width: "100%",
              padding: "12px 20px",
              background: saving ? "#94a3b8" : "#667eea",
              color: "#fff",
              border: "none",
              borderRadius: "8px",
              fontSize: "0.9rem",
              fontWeight: 600,
              cursor: saving ? "not-allowed" : "pointer",
              transition: "background 0.15s",
            }}
            onMouseEnter={(e) => {
              if (!saving) e.currentTarget.style.background = "#5a67d8";
            }}
            onMouseLeave={(e) => {
              if (!saving) e.currentTarget.style.background = "#667eea";
            }}
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </>
      )}
    </Drawer>
  );
}
