/**
 * Class Details Page
 *
 * View a class, manage students, and see assigned lessons.
 * Primary entry point for managing a specific class.
 */

import { useState, useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  getClass,
  updateClass,
  bulkAddStudentsToClass,
  removeStudentFromClass,
  type ClassWithStudents,
  type UpdateClassInput,
} from "../services/api";

export default function ClassDetails() {
  const { classId } = useParams<{ classId: string }>();
  const navigate = useNavigate();
  const [classData, setClassData] = useState<ClassWithStudents | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit mode state
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<UpdateClassInput>({});

  // Add students state
  const [showAddStudents, setShowAddStudents] = useState(false);
  const [studentNames, setStudentNames] = useState("");
  const [addingStudents, setAddingStudents] = useState(false);
  const [addResult, setAddResult] = useState<{ created: number; existing: number } | null>(null);

  const loadClass = async () => {
    if (!classId) return;

    try {
      setError(null);
      const data = await getClass(classId);
      setClassData(data);
      setEditForm({
        name: data.name,
        gradeLevel: data.gradeLevel,
        period: data.period,
        description: data.description,
      });
    } catch (err) {
      console.error("Failed to load class:", err);
      setError("Failed to load class. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadClass();
  }, [classId]);

  const handleUpdateClass = async () => {
    if (!classId) return;

    try {
      await updateClass(classId, editForm);
      await loadClass();
      setIsEditing(false);
    } catch (err) {
      console.error("Failed to update class:", err);
      alert("Failed to update class. Please try again.");
    }
  };

  const handleAddStudents = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!classId || !studentNames.trim()) return;

    setAddingStudents(true);
    setAddResult(null);
    try {
      const result = await bulkAddStudentsToClass(classId, studentNames);
      setAddResult({ created: result.created, existing: result.existing });
      setStudentNames("");
      await loadClass();
    } catch (err) {
      console.error("Failed to add students:", err);
      alert("Failed to add students. Please try again.");
    } finally {
      setAddingStudents(false);
    }
  };

  const handleRemoveStudent = async (studentId: string, studentName: string) => {
    if (!classId) return;
    if (!confirm(`Remove ${studentName} from this class?`)) return;

    try {
      await removeStudentFromClass(classId, studentId);
      await loadClass();
    } catch (err) {
      console.error("Failed to remove student:", err);
      alert("Failed to remove student. Please try again.");
    }
  };

  if (loading) {
    return (
      <div className="loading">
        <div className="loading-spinner"></div>
        <p>Loading class...</p>
      </div>
    );
  }

  if (error || !classData) {
    return (
      <div className="container">
        <Link to="/educator/classes" className="back-btn">
          ← Back to Classes
        </Link>
        <div className="card">
          <p style={{ color: "#d32f2f" }}>{error || "Class not found."}</p>
          <button className="btn btn-primary" onClick={loadClass} style={{ marginTop: "16px" }}>
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <Link to="/educator/classes" className="back-btn">
        ← Back to Classes
      </Link>

      {/* Class Header */}
      <div className="card" style={{ marginBottom: "24px" }}>
        {isEditing ? (
          <div>
            <h2 style={{ margin: 0, marginBottom: "16px" }}>Edit Class</h2>
            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", marginBottom: "4px", fontWeight: 600 }}>
                Class Name
              </label>
              <input
                type="text"
                value={editForm.name || ""}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                style={{
                  width: "100%",
                  padding: "12px",
                  fontSize: "1rem",
                  borderRadius: "8px",
                  border: "2px solid #e0e0e0",
                }}
              />
            </div>
            <div style={{ display: "flex", gap: "16px", marginBottom: "16px" }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", marginBottom: "4px", fontWeight: 600 }}>
                  Grade Level
                </label>
                <input
                  type="text"
                  value={editForm.gradeLevel || ""}
                  onChange={(e) => setEditForm({ ...editForm, gradeLevel: e.target.value })}
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
                  Period
                </label>
                <input
                  type="text"
                  value={editForm.period || ""}
                  onChange={(e) => setEditForm({ ...editForm, period: e.target.value })}
                  placeholder="e.g., Period 3"
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
              <button className="btn btn-secondary" onClick={() => setIsEditing(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleUpdateClass}>
                Save Changes
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <h1 style={{ margin: 0, color: "#667eea" }}>{classData.name}</h1>
                <div style={{ display: "flex", gap: "16px", marginTop: "8px", flexWrap: "wrap" }}>
                  {classData.gradeLevel && (
                    <span style={{ color: "#666" }}>{classData.gradeLevel}</span>
                  )}
                  {classData.period && (
                    <span style={{ color: "#666" }}>{classData.period}</span>
                  )}
                </div>
              </div>
              <button
                className="btn btn-secondary"
                onClick={() => setIsEditing(true)}
              >
                Edit
              </button>
            </div>
            {classData.description && (
              <p style={{ marginTop: "12px", color: "#666" }}>{classData.description}</p>
            )}
          </div>
        )}
      </div>

      {/* Students Section */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <h2 style={{ color: "white", margin: 0 }}>
          Students ({classData.students.length})
        </h2>
        <button
          className="btn btn-primary"
          onClick={() => setShowAddStudents(!showAddStudents)}
        >
          + Add Students
        </button>
      </div>

      {/* Add Students Form */}
      {showAddStudents && (
        <div className="card" style={{ marginBottom: "16px" }}>
          <h3 style={{ margin: 0, marginBottom: "12px" }}>Add Students</h3>
          <p style={{ color: "#666", marginBottom: "12px" }}>
            Enter student names separated by commas or one per line.
            New students will be automatically created.
          </p>
          <form onSubmit={handleAddStudents}>
            <textarea
              value={studentNames}
              onChange={(e) => setStudentNames(e.target.value)}
              placeholder="John Smith, Jane Doe, Alex Johnson&#10;or&#10;John Smith&#10;Jane Doe&#10;Alex Johnson"
              rows={4}
              style={{
                width: "100%",
                padding: "12px",
                fontSize: "1rem",
                borderRadius: "8px",
                border: "2px solid #e0e0e0",
                resize: "vertical",
                fontFamily: "inherit",
              }}
              autoFocus
            />
            {addResult && (
              <div style={{ marginTop: "12px", padding: "12px", background: "#e8f5e9", borderRadius: "8px" }}>
                <span style={{ color: "#2e7d32" }}>
                  Added {addResult.created + addResult.existing} students
                  {addResult.created > 0 && ` (${addResult.created} new)`}
                </span>
              </div>
            )}
            <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end", marginTop: "12px" }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setShowAddStudents(false);
                  setStudentNames("");
                  setAddResult(null);
                }}
              >
                Done
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!studentNames.trim() || addingStudents}
              >
                {addingStudents ? "Adding..." : "Add Students"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Students List */}
      {classData.students.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "48px" }}>
          <p style={{ color: "#666", marginBottom: "16px" }}>
            No students in this class yet. Add some students to get started!
          </p>
          <button
            className="btn btn-primary"
            onClick={() => setShowAddStudents(true)}
          >
            + Add Students
          </button>
        </div>
      ) : (
        <div className="card">
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {classData.students.map((student) => (
              <div
                key={student.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "12px 16px",
                  background: "#f5f5f5",
                  borderRadius: "8px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <span style={{ fontWeight: 600, color: "#333" }}>{student.name}</span>
                  {student.notes && (
                    <span
                      title={student.notes}
                      style={{
                        fontSize: "0.8rem",
                        padding: "2px 8px",
                        background: "#e3f2fd",
                        color: "#1976d2",
                        borderRadius: "12px",
                      }}
                    >
                      Notes
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    onClick={() => navigate(`/educator/student/${student.id}`)}
                    style={{
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      color: "#667eea",
                      fontSize: "0.85rem",
                    }}
                  >
                    View
                  </button>
                  <button
                    onClick={() => handleRemoveStudent(student.id, student.name)}
                    style={{
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      color: "#999",
                      fontSize: "0.85rem",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = "#d32f2f";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = "#999";
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions Footer */}
      <div
        style={{
          marginTop: "48px",
          paddingTop: "24px",
          borderTop: "1px solid rgba(255,255,255,0.1)",
          display: "flex",
          gap: "16px",
          flexWrap: "wrap",
        }}
      >
        <button
          className="btn btn-primary"
          onClick={() => navigate(`/educator/class/${classId}/assign-lesson`)}
        >
          Assign Lesson to Class
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => navigate("/educator")}
        >
          Back to Dashboard
        </button>
      </div>
    </div>
  );
}
