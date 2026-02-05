/**
 * Class Details Page
 *
 * View a class, manage students, and see assigned lessons.
 * Primary entry point for managing a specific class.
 */

import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  getClass,
  updateClass,
  bulkAddStudentsToClass,
  removeStudentFromClass,
  addClassSubject,
  removeClassSubject,
  setStudentSubjectParticipation,
  type ClassWithStudents,
  type UpdateClassInput,
} from "../services/api";
import { useToast } from "../components/Toast";
import EducatorHeader from "../components/EducatorHeader";

export default function ClassDetails() {
  const { classId } = useParams<{ classId: string }>();
  const navigate = useNavigate();
  const { showError } = useToast();

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

  // Subject management state
  const [showAddSubject, setShowAddSubject] = useState(false);
  const [newSubjectName, setNewSubjectName] = useState("");
  const [addingSubject, setAddingSubject] = useState(false);

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
      showError("Failed to update class. Please try again.");
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
      showError("Failed to add students. Please try again.");
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
      showError("Failed to remove student. Please try again.");
    }
  };

  // Subject management handlers
  const handleAddSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!classId || !newSubjectName.trim()) return;

    setAddingSubject(true);
    try {
      await addClassSubject(classId, newSubjectName.trim());
      setNewSubjectName("");
      setShowAddSubject(false);
      await loadClass();
    } catch (err) {
      console.error("Failed to add subject:", err);
      showError("Failed to add subject. Please try again.");
    } finally {
      setAddingSubject(false);
    }
  };

  const handleRemoveSubject = async (subject: string) => {
    if (!classId) return;
    if (!confirm(`Remove "${subject}" from this class? This will not affect existing assignments.`)) return;

    try {
      await removeClassSubject(classId, subject);
      await loadClass();
    } catch (err) {
      console.error("Failed to remove subject:", err);
      showError("Failed to remove subject. Please try again.");
    }
  };

  const handleToggleParticipation = async (studentId: string, subject: string, currentlyExcluded: boolean) => {
    if (!classId) return;

    try {
      // Toggle: if currently excluded, we want to include (excluded=false)
      // if currently included (not excluded), we want to exclude (excluded=true)
      await setStudentSubjectParticipation(classId, subject, studentId, !currentlyExcluded);
      await loadClass();
    } catch (err) {
      console.error("Failed to update participation:", err);
      showError("Failed to update participation. Please try again.");
    }
  };

  // Helper to check if a student is excluded from a subject
  const isStudentExcluded = (studentId: string, subject: string): boolean => {
    return classData?.subjectExclusions?.[subject]?.includes(studentId) ?? false;
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
        <EducatorHeader />
        <div className="card">
          <p style={{ color: "#d32f2f" }}>{error || "Class not found."}</p>
          <button className="btn btn-primary" onClick={loadClass} style={{ marginTop: "16px" }}>
            Try Again
          </button>
        </div>
      </div>
    );
  }

  const hasSubjects = classData.subjects && classData.subjects.length > 0;
  const hasStudents = classData.students.length > 0;

  return (
    <div className="container">
      <EducatorHeader
        breadcrumbs={[{ label: classData.name }]}
      />

      {/* Class Header Card */}
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
                <div style={{ display: "flex", gap: "16px", marginTop: "8px", flexWrap: "wrap", alignItems: "center" }}>
                  {classData.gradeLevel && (
                    <span style={{ color: "#666" }}>{classData.gradeLevel}</span>
                  )}
                  {classData.period && (
                    <span style={{ color: "#666" }}>{classData.period}</span>
                  )}
                </div>
                {classData.description && (
                  <p style={{ marginTop: "8px", marginBottom: 0, color: "#666", fontSize: "0.9rem" }}>{classData.description}</p>
                )}
                <p style={{ marginTop: "8px", marginBottom: 0, color: "#999", fontSize: "0.85rem" }}>
                  Manage students and subject participation for this class.
                </p>
              </div>
              <button
                className="btn btn-secondary"
                onClick={() => setIsEditing(true)}
                style={{ flexShrink: 0 }}
              >
                Edit
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Roster & Participation — Single Combined Section */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "8px" }}>
        <h2 style={{ color: "white", margin: 0 }}>
          Roster & Participation
          <span style={{ fontSize: "0.85rem", fontWeight: "normal", marginLeft: "8px", color: "rgba(255,255,255,0.6)" }}>
            ({classData.students.length} student{classData.students.length !== 1 ? "s" : ""})
          </span>
        </h2>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            className="btn btn-secondary"
            onClick={() => { setShowAddSubject(!showAddSubject); if (showAddStudents) setShowAddStudents(false); }}
            style={{ fontSize: "0.85rem", padding: "6px 14px" }}
          >
            + Add Subject
          </button>
          <button
            className="btn btn-primary"
            onClick={() => { setShowAddStudents(!showAddStudents); if (showAddSubject) setShowAddSubject(false); }}
            style={{ fontSize: "0.85rem", padding: "6px 14px" }}
          >
            + Add Students
          </button>
        </div>
      </div>

      {/* Add Students Form (inline, collapsible) */}
      {showAddStudents && (
        <div className="card" style={{ marginBottom: "16px" }}>
          <h3 style={{ margin: 0, marginBottom: "12px" }}>Add Students</h3>
          <p style={{ color: "#666", marginBottom: "12px", fontSize: "0.9rem" }}>
            Enter student names separated by commas or one per line. New students will be created automatically.
          </p>
          <form onSubmit={handleAddStudents}>
            <textarea
              value={studentNames}
              onChange={(e) => setStudentNames(e.target.value)}
              placeholder="John Smith, Jane Doe, Alex Johnson&#10;or&#10;John Smith&#10;Jane Doe&#10;Alex Johnson"
              rows={3}
              style={{
                width: "100%",
                padding: "12px",
                fontSize: "1rem",
                borderRadius: "8px",
                border: "2px solid #e0e0e0",
                resize: "vertical",
                fontFamily: "inherit",
                boxSizing: "border-box",
              }}
              autoFocus
            />
            {addResult && (
              <div style={{ marginTop: "12px", padding: "10px 12px", background: "#e8f5e9", borderRadius: "8px" }}>
                <span style={{ color: "#2e7d32", fontSize: "0.9rem" }}>
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

      {/* Add Subject Form (inline, collapsible) */}
      {showAddSubject && (
        <div className="card" style={{ marginBottom: "16px" }}>
          <form onSubmit={handleAddSubject} style={{ display: "flex", gap: "12px", alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: "block", marginBottom: "4px", fontWeight: 600 }}>
                Subject Name
              </label>
              <input
                type="text"
                value={newSubjectName}
                onChange={(e) => setNewSubjectName(e.target.value)}
                placeholder="e.g., Reading, Math, Science"
                style={{
                  width: "100%",
                  padding: "12px",
                  fontSize: "1rem",
                  borderRadius: "8px",
                  border: "2px solid #e0e0e0",
                  boxSizing: "border-box",
                }}
                autoFocus
              />
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setShowAddSubject(false);
                setNewSubjectName("");
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!newSubjectName.trim() || addingSubject}
            >
              {addingSubject ? "Adding..." : "Add"}
            </button>
          </form>
        </div>
      )}

      {/* Empty state: no students at all */}
      {!hasStudents ? (
        <div className="card" style={{ textAlign: "center", padding: "48px" }}>
          <p style={{ color: "#666", marginBottom: "16px" }}>
            No students in this class yet. Add students to get started.
          </p>
          <button
            className="btn btn-primary"
            onClick={() => setShowAddStudents(true)}
          >
            + Add Students
          </button>
        </div>
      ) : (
        /* Unified Roster & Participation Grid */
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          {hasSubjects && (
            <p style={{ color: "#666", fontSize: "0.85rem", margin: 0, padding: "14px 16px 0 16px" }}>
              Toggle which subjects each student receives assignments for.
            </p>
          )}
          <div style={{ overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: hasSubjects ? "400px" : undefined }}>
              <thead>
                <tr>
                  <th
                    style={{
                      textAlign: "left",
                      padding: "12px 16px",
                      borderBottom: "2px solid #e0e0e0",
                      background: "#f5f5f5",
                      position: "sticky",
                      left: 0,
                      zIndex: 2,
                      minWidth: "180px",
                    }}
                  >
                    Student
                  </th>
                  {hasSubjects && classData.subjects.map((subject) => (
                    <th
                      key={subject}
                      style={{
                        textAlign: "center",
                        padding: "10px 12px",
                        borderBottom: "2px solid #e0e0e0",
                        background: "#f5f5f5",
                        minWidth: "100px",
                        fontSize: "0.85rem",
                        fontWeight: 600,
                      }}
                    >
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" }}>
                        <span>{subject}</span>
                        <button
                          onClick={() => handleRemoveSubject(subject)}
                          style={{
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            color: "#bbb",
                            fontSize: "0.65rem",
                            padding: "1px 4px",
                            lineHeight: 1.3,
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = "#d32f2f"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = "#bbb"; }}
                          title={`Remove ${subject}`}
                        >
                          ✕ remove
                        </button>
                      </div>
                    </th>
                  ))}
                  {/* Empty header for actions column */}
                  <th
                    style={{
                      width: "60px",
                      padding: "12px 8px",
                      borderBottom: "2px solid #e0e0e0",
                      background: "#f5f5f5",
                    }}
                  />
                </tr>
              </thead>
              <tbody>
                {classData.students.map((student, index) => {
                  const rowBg = index % 2 === 0 ? "white" : "#fafafa";
                  return (
                    <tr key={student.id} style={{ background: rowBg }}>
                      {/* Student name — clickable to view profile */}
                      <td
                        style={{
                          padding: "10px 16px",
                          borderBottom: "1px solid #eee",
                          position: "sticky",
                          left: 0,
                          background: rowBg,
                          zIndex: 1,
                        }}
                      >
                        <span
                          onClick={() => navigate(`/educator/student/${student.id}`, {
                            state: { fromClass: classId, className: classData.name },
                          })}
                          style={{
                            fontWeight: 500,
                            color: "#333",
                            cursor: "pointer",
                            textDecoration: "none",
                            transition: "color 0.15s",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.color = "#667eea";
                            e.currentTarget.style.textDecoration = "underline";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.color = "#333";
                            e.currentTarget.style.textDecoration = "none";
                          }}
                          role="link"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              navigate(`/educator/student/${student.id}`, {
                                state: { fromClass: classId, className: classData.name },
                              });
                            }
                          }}
                        >
                          {student.name}
                        </span>
                      </td>

                      {/* Subject participation checkboxes */}
                      {hasSubjects && classData.subjects.map((subject) => {
                        const excluded = isStudentExcluded(student.id, subject);
                        return (
                          <td
                            key={subject}
                            style={{
                              textAlign: "center",
                              padding: "10px 12px",
                              borderBottom: "1px solid #eee",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={!excluded}
                              onChange={() => handleToggleParticipation(student.id, subject, excluded)}
                              style={{
                                width: "18px",
                                height: "18px",
                                cursor: "pointer",
                                accentColor: "#667eea",
                              }}
                              title={excluded ? `Add ${student.name} to ${subject}` : `Remove ${student.name} from ${subject}`}
                            />
                          </td>
                        );
                      })}

                      {/* Remove action */}
                      <td
                        style={{
                          textAlign: "center",
                          padding: "10px 8px",
                          borderBottom: "1px solid #eee",
                        }}
                      >
                        <button
                          onClick={() => handleRemoveStudent(student.id, student.name)}
                          style={{
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            color: "#ccc",
                            fontSize: "0.75rem",
                            padding: "2px 6px",
                            borderRadius: "4px",
                            transition: "color 0.15s, background 0.15s",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.color = "#d32f2f";
                            e.currentTarget.style.background = "#fef2f2";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.color = "#ccc";
                            e.currentTarget.style.background = "none";
                          }}
                          title={`Remove ${student.name} from class`}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
