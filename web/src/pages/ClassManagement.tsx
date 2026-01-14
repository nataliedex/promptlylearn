/**
 * Class Management Page
 *
 * Create and manage classes/sections.
 * Teachers organize students by classes before assigning lessons.
 */

import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  getClasses,
  createClass,
  archiveClass,
  type ClassSummary,
  type CreateClassInput,
} from "../services/api";

export default function ClassManagement() {
  const navigate = useNavigate();
  const [classes, setClasses] = useState<ClassSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating] = useState(false);

  // Form state
  const [formData, setFormData] = useState<CreateClassInput>({
    name: "",
    gradeLevel: "",
    period: "",
  });

  const loadClasses = async () => {
    try {
      setError(null);
      const data = await getClasses();
      setClasses(data);
    } catch (err) {
      console.error("Failed to load classes:", err);
      setError("Failed to load classes. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadClasses();
  }, []);

  const handleCreateClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      return;
    }

    setCreating(true);
    try {
      const newClass = await createClass({
        name: formData.name.trim(),
        gradeLevel: formData.gradeLevel?.trim() || undefined,
        period: formData.period?.trim() || undefined,
      });

      // Navigate to the new class to add students
      navigate(`/educator/class/${newClass.id}`);
    } catch (err) {
      console.error("Failed to create class:", err);
      setError("Failed to create class. Please try again.");
    } finally {
      setCreating(false);
    }
  };

  const handleArchiveClass = async (classId: string, className: string) => {
    if (!confirm(`Archive "${className}"? You can restore it later from the archived view.`)) {
      return;
    }

    try {
      await archiveClass(classId);
      await loadClasses();
    } catch (err) {
      console.error("Failed to archive class:", err);
      alert("Failed to archive class. Please try again.");
    }
  };

  if (loading) {
    return (
      <div className="loading">
        <div className="loading-spinner"></div>
        <p>Loading classes...</p>
      </div>
    );
  }

  return (
    <div className="container">
      <Link to="/educator" className="back-btn">
        ← Back to Dashboard
      </Link>

      <div className="header">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "16px" }}>
          <div>
            <h1>My Classes</h1>
            <p>Organize your students into classes and sections</p>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => setShowCreateForm(true)}
          >
            + Create Class
          </button>
        </div>
      </div>

      {error && (
        <div className="card" style={{ background: "#ffebee", borderLeft: "4px solid #d32f2f", marginBottom: "16px" }}>
          <p style={{ margin: 0, color: "#d32f2f" }}>{error}</p>
        </div>
      )}

      {/* Create Class Form */}
      {showCreateForm && (
        <div className="card" style={{ marginBottom: "24px" }}>
          <h3 style={{ margin: 0, marginBottom: "16px" }}>Create New Class</h3>
          <form onSubmit={handleCreateClass}>
            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", marginBottom: "4px", fontWeight: 600 }}>
                Class Name <span style={{ color: "#d32f2f" }}>*</span>
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Mrs. Smith's 2nd Grade"
                style={{
                  width: "100%",
                  padding: "12px",
                  fontSize: "1rem",
                  borderRadius: "8px",
                  border: "2px solid #e0e0e0",
                }}
                autoFocus
              />
            </div>

            <div style={{ display: "flex", gap: "16px", marginBottom: "16px" }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", marginBottom: "4px", fontWeight: 600 }}>
                  Grade Level (optional)
                </label>
                <input
                  type="text"
                  value={formData.gradeLevel}
                  onChange={(e) => setFormData({ ...formData, gradeLevel: e.target.value })}
                  placeholder="e.g., 2nd Grade"
                  style={{
                    width: "100%",
                    padding: "12px",
                    fontSize: "1rem",
                    borderRadius: "8px",
                    border: "2px solid #e0e0e0",
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", marginBottom: "4px", fontWeight: 600 }}>
                  Period (optional)
                </label>
                <input
                  type="text"
                  value={formData.period}
                  onChange={(e) => setFormData({ ...formData, period: e.target.value })}
                  placeholder="e.g., Period 3, Morning"
                  style={{
                    width: "100%",
                    padding: "12px",
                    fontSize: "1rem",
                    borderRadius: "8px",
                    border: "2px solid #e0e0e0",
                  }}
                />
              </div>
            </div>

            <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setShowCreateForm(false);
                  setFormData({ name: "", gradeLevel: "", period: "" });
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!formData.name.trim() || creating}
              >
                {creating ? "Creating..." : "Create & Add Students"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Classes List */}
      {classes.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "48px" }}>
          <p style={{ color: "#666", marginBottom: "16px" }}>
            No classes yet. Create your first class to get started!
          </p>
          <button
            className="btn btn-primary"
            onClick={() => setShowCreateForm(true)}
          >
            + Create Class
          </button>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
            gap: "16px",
          }}
        >
          {classes.map((cls) => (
            <ClassCard
              key={cls.id}
              classData={cls}
              onNavigate={() => navigate(`/educator/class/${cls.id}`)}
              onArchive={() => handleArchiveClass(cls.id, cls.name)}
            />
          ))}
        </div>
      )}

      {/* Footer */}
      <div
        style={{
          marginTop: "48px",
          paddingTop: "24px",
          borderTop: "1px solid rgba(255,255,255,0.1)",
        }}
      >
        <button
          className="btn btn-secondary"
          onClick={() => navigate("/educator/classes/archived")}
        >
          View Archived Classes
        </button>
      </div>
    </div>
  );
}

// ============================================
// Class Card Component
// ============================================

interface ClassCardProps {
  classData: ClassSummary;
  onNavigate: () => void;
  onArchive: () => void;
}

function ClassCard({ classData, onNavigate, onArchive }: ClassCardProps) {
  const { name, gradeLevel, period, studentCount, createdAt } = classData;

  return (
    <div
      className="card"
      style={{
        cursor: "pointer",
        transition: "transform 0.2s, box-shadow 0.2s",
      }}
      onClick={onNavigate}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "";
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: 0, color: "#667eea" }}>{name}</h3>
          <div style={{ display: "flex", gap: "12px", marginTop: "8px", flexWrap: "wrap" }}>
            {gradeLevel && (
              <span style={{ fontSize: "0.85rem", color: "#666" }}>
                {gradeLevel}
              </span>
            )}
            {period && (
              <span style={{ fontSize: "0.85rem", color: "#666" }}>
                {period}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onArchive();
            }}
            title="Archive this class"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: "4px 8px",
              borderRadius: "4px",
              color: "#999",
              fontSize: "0.85rem",
              transition: "color 0.2s, background 0.2s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#f5f5f5";
              e.currentTarget.style.color = "#666";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "#999";
            }}
          >
            Archive
          </button>
          <span style={{ color: "#667eea", fontSize: "1.2rem" }}>→</span>
        </div>
      </div>

      <div style={{ marginTop: "16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span
            style={{
              padding: "4px 12px",
              background: studentCount > 0 ? "#e8f5e9" : "#fff3e0",
              color: studentCount > 0 ? "#2e7d32" : "#e65100",
              borderRadius: "16px",
              fontSize: "0.85rem",
              fontWeight: 600,
            }}
          >
            {studentCount} student{studentCount !== 1 ? "s" : ""}
          </span>
        </div>
        <span style={{ fontSize: "0.8rem", color: "#999" }}>
          Created {new Date(createdAt).toLocaleDateString()}
        </span>
      </div>
    </div>
  );
}
