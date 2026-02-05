import { useState, useEffect } from "react";
import {
  getStudentProfileFull,
  updateStudentProfile,
  regenerateStudentCode,
  type StudentProfileFull,
  type InputPreference,
  type PacePreference,
  type CoachHelpStyle,
} from "../services/api";

interface StudentProfileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSave?: () => void;
  studentId: string;
  studentName: string;
}

/**
 * Student Profile Drawer (Educator View)
 *
 * Allows educators to view and edit student profile settings including:
 * - Preferred name (students cannot edit this themselves)
 * - Pronouns
 * - Learning preferences
 * - Accommodations
 */
export default function StudentProfileDrawer({
  isOpen,
  onClose,
  onSave,
  studentId,
  studentName,
}: StudentProfileDrawerProps) {
  const [profile, setProfile] = useState<StudentProfileFull | null>(null);
  const [studentCode, setStudentCode] = useState<string | undefined>();
  const [isDemo, setIsDemo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Form state
  const [legalName, setLegalName] = useState("");
  const [preferredName, setPreferredName] = useState("");
  const [pronouns, setPronouns] = useState("");
  const [gradeLevel, setGradeLevel] = useState("");
  const [inputPreference, setInputPreference] = useState<InputPreference>("no_preference");
  const [pacePreference, setPacePreference] = useState<PacePreference>("take_my_time");
  const [coachHelpStyle, setCoachHelpStyle] = useState<CoachHelpStyle>("hints_first");
  const [extraTime, setExtraTime] = useState(false);
  const [readAloud, setReadAloud] = useState(false);
  const [reducedDistractions, setReducedDistractions] = useState(false);
  const [accommodationNotes, setAccommodationNotes] = useState("");

  useEffect(() => {
    if (isOpen && studentId) {
      loadProfile();
    }
  }, [isOpen, studentId]);

  const loadProfile = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const data = await getStudentProfileFull(studentId);
      setProfile(data.profile);
      setStudentCode(data.student.studentCode);
      setIsDemo(data.student.isDemo || false);
      setLegalName(data.profile.legalName || "");
      setPreferredName(data.profile.preferredName || "");
      setPronouns(data.profile.pronouns || "");
      setGradeLevel(data.profile.gradeLevel || "");
      setInputPreference(data.profile.inputPreference || "no_preference");
      setPacePreference(data.profile.pacePreference || "take_my_time");
      setCoachHelpStyle(data.profile.coachHelpStyle || "hints_first");
      setExtraTime(data.profile.accommodations?.extraTime || false);
      setReadAloud(data.profile.accommodations?.readAloud || false);
      setReducedDistractions(data.profile.accommodations?.reducedDistractions || false);
      setAccommodationNotes(data.profile.accommodations?.notes || "");
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
      const result = await updateStudentProfile(studentId, {
        legalName: legalName.trim() || undefined,
        preferredName: preferredName.trim() || undefined,
        pronouns: pronouns.trim() || undefined,
        gradeLevel: gradeLevel.trim() || undefined,
        inputPreference,
        pacePreference,
        coachHelpStyle,
        accommodations: {
          extraTime,
          readAloud,
          reducedDistractions,
          notes: accommodationNotes.trim() || undefined,
        },
      });
      setProfile(result.profile);
      setSaving(false);
      onSave?.();
      onClose();
    } catch (err) {
      console.error("Failed to save profile:", err);
      setMessage({ type: "error", text: "Failed to save profile" });
      setSaving(false);
    }
  };

  const handleRegenerateCode = async () => {
    setShowRegenerateConfirm(false);
    setRegenerating(true);
    setMessage(null);

    try {
      const result = await regenerateStudentCode(studentId);
      setStudentCode(result.studentCode);
      setMessage({ type: "success", text: "New code generated" });
    } catch (err) {
      console.error("Failed to regenerate code:", err);
      setMessage({ type: "error", text: "Failed to regenerate code" });
    } finally {
      setRegenerating(false);
    }
  };

  if (!isOpen) return null;

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

      {/* Drawer */}
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(450px, 90vw)",
          background: "var(--surface-card)",
          boxShadow: "-4px 0 20px rgba(0,0,0,0.15)",
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
          <div>
            <h2 style={{ margin: 0, fontSize: "1.1rem" }}>Student Profile</h2>
            <p style={{ margin: "4px 0 0 0", fontSize: "0.85rem", color: "var(--text-secondary)" }}>
              {studentName}
            </p>
          </div>
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
        <div style={{ flex: 1, overflow: "auto", padding: "16px 20px" }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: "40px 0" }}>
              <div className="loading-spinner" style={{ margin: "0 auto 12px auto" }}></div>
              <p style={{ color: "var(--text-muted)" }}>Loading profile...</p>
            </div>
          ) : (
            <>
              {message && (
                <div
                  style={{
                    padding: "10px 12px",
                    marginBottom: "16px",
                    borderRadius: "8px",
                    fontSize: "0.85rem",
                    background: message.type === "success" ? "var(--status-success-bg)" : "var(--status-error-bg)",
                    color: message.type === "success" ? "var(--status-success-text)" : "var(--status-error-text)",
                  }}
                >
                  {message.text}
                </div>
              )}

              {/* Student Code */}
              {!isDemo && (
                <section style={{ marginBottom: "20px" }}>
                  <h3 style={{ margin: "0 0 12px 0", fontSize: "0.95rem", color: "var(--text-primary)" }}>
                    Student Login Code
                  </h3>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      padding: "12px",
                      background: "var(--surface-muted)",
                      borderRadius: "8px",
                    }}
                  >
                    <code
                      style={{
                        fontSize: "1.3rem",
                        fontWeight: 600,
                        letterSpacing: "3px",
                        color: "var(--text-primary)",
                        flex: 1,
                      }}
                    >
                      {studentCode || "—"}
                    </code>
                    <button
                      type="button"
                      onClick={() => setShowRegenerateConfirm(true)}
                      disabled={regenerating || showRegenerateConfirm}
                      style={{
                        padding: "6px 12px",
                        fontSize: "0.8rem",
                        background: "var(--surface-card)",
                        border: "1px solid var(--border-subtle)",
                        borderRadius: "6px",
                        cursor: regenerating || showRegenerateConfirm ? "not-allowed" : "pointer",
                        color: "var(--text-secondary)",
                      }}
                    >
                      {regenerating ? "Generating..." : "Regenerate"}
                    </button>
                  </div>

                  {/* Regenerate confirmation */}
                  {showRegenerateConfirm && (
                    <div
                      style={{
                        marginTop: "10px",
                        padding: "12px",
                        background: "var(--status-warning-bg)",
                        borderRadius: "8px",
                        border: "1px solid var(--status-warning-text)",
                      }}
                    >
                      <p style={{ margin: "0 0 10px 0", fontSize: "0.85rem", color: "var(--text-primary)" }}>
                        Generate a new login code? The student will need the new code to log in.
                      </p>
                      <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                        <button
                          type="button"
                          onClick={() => setShowRegenerateConfirm(false)}
                          style={{
                            padding: "6px 14px",
                            fontSize: "0.8rem",
                            background: "var(--surface-card)",
                            border: "1px solid var(--border-subtle)",
                            borderRadius: "6px",
                            cursor: "pointer",
                            color: "var(--text-secondary)",
                          }}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleRegenerateCode}
                          style={{
                            padding: "6px 14px",
                            fontSize: "0.8rem",
                            background: "var(--status-warning-text)",
                            border: "none",
                            borderRadius: "6px",
                            cursor: "pointer",
                            color: "white",
                            fontWeight: 500,
                          }}
                        >
                          Confirm
                        </button>
                      </div>
                    </div>
                  )}

                  <p style={{ margin: "6px 0 0 0", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    Students use this code to log in
                  </p>
                </section>
              )}

              {isDemo && (
                <section style={{ marginBottom: "20px" }}>
                  <div
                    style={{
                      padding: "10px 14px",
                      background: "var(--status-info-bg)",
                      color: "var(--status-info-text)",
                      borderRadius: "8px",
                      fontSize: "0.85rem",
                    }}
                  >
                    Demo student — no login code required
                  </div>
                </section>
              )}

              {/* Basic Info */}
              <section style={{ marginBottom: "20px" }}>
                <h3 style={{ margin: "0 0 12px 0", fontSize: "0.95rem", color: "var(--text-primary)" }}>
                  Basic Information
                </h3>

                <div style={{ marginBottom: "12px" }}>
                  <label style={{ display: "block", marginBottom: "4px", fontSize: "0.85rem", fontWeight: 500 }}>
                    Full Name
                  </label>
                  <input
                    type="text"
                    value={legalName}
                    onChange={(e) => setLegalName(e.target.value)}
                    placeholder="Student's full/legal name"
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid var(--border-subtle)",
                      fontSize: "0.9rem",
                    }}
                  />
                </div>

                <div style={{ marginBottom: "12px" }}>
                  <label style={{ display: "block", marginBottom: "4px", fontSize: "0.85rem", fontWeight: 500 }}>
                    Preferred Name
                  </label>
                  <input
                    type="text"
                    value={preferredName}
                    onChange={(e) => setPreferredName(e.target.value)}
                    placeholder="How the coach addresses this student"
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid var(--border-subtle)",
                      fontSize: "0.9rem",
                    }}
                  />
                  <p style={{ margin: "2px 0 0 0", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    Students cannot edit this themselves
                  </p>
                </div>

                <div style={{ marginBottom: "12px" }}>
                  <label style={{ display: "block", marginBottom: "4px", fontSize: "0.85rem", fontWeight: 500 }}>
                    Pronouns (optional)
                  </label>
                  <input
                    type="text"
                    value={pronouns}
                    onChange={(e) => setPronouns(e.target.value)}
                    placeholder="e.g., she/her, he/him, they/them"
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid var(--border-subtle)",
                      fontSize: "0.9rem",
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", marginBottom: "4px", fontSize: "0.85rem", fontWeight: 500 }}>
                    Grade Level
                  </label>
                  <input
                    type="text"
                    value={gradeLevel}
                    onChange={(e) => setGradeLevel(e.target.value)}
                    placeholder="e.g., 3rd, 4th"
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid var(--border-subtle)",
                      fontSize: "0.9rem",
                    }}
                  />
                </div>
              </section>

              {/* Learning Preferences */}
              <section style={{ marginBottom: "20px" }}>
                <h3 style={{ margin: "0 0 12px 0", fontSize: "0.95rem", color: "var(--text-primary)" }}>
                  Learning Preferences
                </h3>

                <div style={{ marginBottom: "12px" }}>
                  <label style={{ display: "block", marginBottom: "4px", fontSize: "0.85rem", fontWeight: 500 }}>
                    Input Preference
                  </label>
                  <select
                    value={inputPreference}
                    onChange={(e) => setInputPreference(e.target.value as InputPreference)}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid var(--border-subtle)",
                      fontSize: "0.9rem",
                    }}
                  >
                    <option value="no_preference">No preference</option>
                    <option value="voice">Prefers voice</option>
                    <option value="typing">Prefers typing</option>
                  </select>
                </div>

                <div style={{ marginBottom: "12px" }}>
                  <label style={{ display: "block", marginBottom: "4px", fontSize: "0.85rem", fontWeight: 500 }}>
                    Pacing
                  </label>
                  <select
                    value={pacePreference}
                    onChange={(e) => setPacePreference(e.target.value as PacePreference)}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid var(--border-subtle)",
                      fontSize: "0.9rem",
                    }}
                  >
                    <option value="take_my_time">Take my time</option>
                    <option value="keep_it_moving">Keep it moving</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: "block", marginBottom: "4px", fontSize: "0.85rem", fontWeight: 500 }}>
                    Coach Help Style
                  </label>
                  <select
                    value={coachHelpStyle}
                    onChange={(e) => setCoachHelpStyle(e.target.value as CoachHelpStyle)}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid var(--border-subtle)",
                      fontSize: "0.9rem",
                    }}
                  >
                    <option value="hints_first">Hints first</option>
                    <option value="examples_first">Examples first</option>
                    <option value="ask_me_questions">Ask me questions</option>
                  </select>
                </div>
              </section>

              {/* Accommodations */}
              <section style={{ marginBottom: "20px" }}>
                <h3 style={{ margin: "0 0 12px 0", fontSize: "0.95rem", color: "var(--text-primary)" }}>
                  Accommodations
                </h3>

                <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "12px" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.9rem" }}>
                    <input
                      type="checkbox"
                      checked={extraTime}
                      onChange={(e) => setExtraTime(e.target.checked)}
                    />
                    Extra time
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.9rem" }}>
                    <input
                      type="checkbox"
                      checked={readAloud}
                      onChange={(e) => setReadAloud(e.target.checked)}
                    />
                    Read aloud support
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.9rem" }}>
                    <input
                      type="checkbox"
                      checked={reducedDistractions}
                      onChange={(e) => setReducedDistractions(e.target.checked)}
                    />
                    Reduced distractions
                  </label>
                </div>

                <div>
                  <label style={{ display: "block", marginBottom: "4px", fontSize: "0.85rem", fontWeight: 500 }}>
                    Private Notes
                  </label>
                  <textarea
                    value={accommodationNotes}
                    onChange={(e) => setAccommodationNotes(e.target.value)}
                    placeholder="Internal notes about accommodations (not shown to student)"
                    rows={3}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid var(--border-subtle)",
                      fontSize: "0.9rem",
                      resize: "vertical",
                    }}
                  />
                  <p style={{ margin: "2px 0 0 0", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    This is only visible to educators
                  </p>
                </div>
              </section>
            </>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "12px 20px",
            borderTop: "1px solid var(--border-subtle)",
            display: "flex",
            gap: "12px",
          }}
        >
          <button
            className="btn btn-secondary"
            onClick={onClose}
            style={{ flex: 1 }}
          >
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving || loading}
            style={{ flex: 1 }}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </>
  );
}
