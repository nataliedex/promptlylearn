/**
 * Assign Lesson Page
 *
 * Assign a lesson to a class or specific students.
 * Can be reached from:
 * - Class details page (class pre-selected)
 * - Lesson builder (lesson pre-selected)
 * - Direct navigation
 */

import { useState, useEffect } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import EducatorHeader from "../components/EducatorHeader";
import {
  getLessons,
  getClasses,
  getClass,
  assignLessonToClass,
  getLessonAssignments,
  type LessonSummary,
  type ClassSummary,
  type ClassWithStudents,
  type LessonAssignmentSummary,
} from "../services/api";
import { useToast } from "../components/Toast";

export default function AssignLesson() {
  const { classId } = useParams<{ classId: string }>();
  const [searchParams] = useSearchParams();
  const lessonIdParam = searchParams.get("lessonId");
  const navigate = useNavigate();
  const { showSuccess, showError } = useToast();

  const [lessons, setLessons] = useState<LessonSummary[]>([]);
  const [classes, setClasses] = useState<ClassSummary[]>([]);
  const [selectedClass, setSelectedClass] = useState<ClassWithStudents | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [selectedLessonId, setSelectedLessonId] = useState<string>(lessonIdParam || "");
  const [selectedClassId, setSelectedClassId] = useState<string>(classId || "");
  const [assignMode, setAssignMode] = useState<"all" | "select">("all");
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());
  const [dueDate, setDueDate] = useState<string>(""); // Optional due date (YYYY-MM-DD)
  const [assigning, setAssigning] = useState(false);
  const [assignmentSummary, setAssignmentSummary] = useState<LessonAssignmentSummary | null>(null);

  const loadData = async () => {
    try {
      setError(null);
      const [lessonsData, classesData] = await Promise.all([
        getLessons(),
        getClasses(),
      ]);
      setLessons(lessonsData);
      setClasses(classesData);

      // If class ID is provided, load the full class with students
      if (classId) {
        const classData = await getClass(classId);
        setSelectedClass(classData);
        setSelectedClassId(classId);
      }

      // If lesson ID is provided, load its existing assignments
      if (lessonIdParam) {
        const summary = await getLessonAssignments(lessonIdParam);
        setAssignmentSummary(summary);
      }
    } catch (err) {
      console.error("Failed to load data:", err);
      setError("Failed to load data. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [classId, lessonIdParam]);

  // Load class details when class selection changes
  const handleClassChange = async (newClassId: string) => {
    setSelectedClassId(newClassId);
    setSelectedStudentIds(new Set());

    if (newClassId) {
      try {
        const classData = await getClass(newClassId);
        setSelectedClass(classData);
      } catch (err) {
        console.error("Failed to load class:", err);
      }
    } else {
      setSelectedClass(null);
    }
  };

  // Get all students in the selected class
  const getClassStudents = () => {
    if (!selectedClass) return [];
    return selectedClass.students;
  };

  const classStudents = getClassStudents();

  // Load assignment summary when lesson selection changes
  const handleLessonChange = async (newLessonId: string) => {
    setSelectedLessonId(newLessonId);

    if (newLessonId) {
      try {
        const summary = await getLessonAssignments(newLessonId);
        setAssignmentSummary(summary);
      } catch (err) {
        console.error("Failed to load assignments:", err);
        setAssignmentSummary(null);
      }
    } else {
      setAssignmentSummary(null);
    }
  };

  const handleAssign = async () => {
    if (!selectedLessonId || !selectedClassId) return;

    setAssigning(true);
    try {
      // Determine which students to assign
      const studentIds = assignMode === "select"
        ? Array.from(selectedStudentIds)
        : undefined; // undefined = all students in class

      const result = await assignLessonToClass(
        selectedLessonId,
        selectedClassId,
        studentIds,
        dueDate || undefined
      );

      // Show success and navigate
      showSuccess(`Successfully assigned lesson to ${result.assignedCount} student${result.assignedCount !== 1 ? "s" : ""} in ${result.className}`);

      // Navigate based on context
      if (classId) {
        navigate(`/educator/class/${classId}`);
      } else if (lessonIdParam) {
        navigate("/educator");
      } else {
        navigate("/educator");
      }
    } catch (err) {
      console.error("Failed to assign lesson:", err);
      showError("Failed to assign lesson. Please try again.");
    } finally {
      setAssigning(false);
    }
  };

  const toggleStudent = (studentId: string) => {
    const newSelected = new Set(selectedStudentIds);
    if (newSelected.has(studentId)) {
      newSelected.delete(studentId);
    } else {
      newSelected.add(studentId);
    }
    setSelectedStudentIds(newSelected);
  };

  const selectAllStudents = () => {
    setSelectedStudentIds(new Set(classStudents.map((s) => s.id)));
  };

  const deselectAllStudents = () => {
    setSelectedStudentIds(new Set());
  };

  if (loading) {
    return (
      <div className="loading">
        <div className="loading-spinner"></div>
        <p>Loading...</p>
      </div>
    );
  }

  const selectedLesson = lessons.find((l) => l.id === selectedLessonId);
  const canAssign =
    selectedLessonId &&
    selectedClassId &&
    classStudents.length > 0 &&
    (assignMode === "all" || selectedStudentIds.size > 0);

  return (
    <div className="container">
      <EducatorHeader
        breadcrumbs={[
          ...(selectedClass ? [{ label: selectedClass.name, to: `/educator/class/${selectedClassId}` }] : []),
          { label: "Assign Lesson" },
        ]}
      />

      <div className="header">
        <h1>Assign Lesson</h1>
        <p>Choose a lesson and class to create assignments</p>
      </div>

      {error && (
        <div className="card" style={{ background: "#ffebee", borderLeft: "4px solid #d32f2f", marginBottom: "16px" }}>
          <p style={{ margin: 0, color: "#d32f2f" }}>{error}</p>
        </div>
      )}

      {/* Step 1: Select Lesson */}
      <div className="card" style={{ marginBottom: "16px" }}>
        <h3 style={{ margin: 0, marginBottom: "16px" }}>1. Select Lesson</h3>

        {lessonIdParam && selectedLesson ? (
          <div
            style={{
              padding: "16px",
              background: "#e8f5e9",
              borderRadius: "8px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <span style={{ fontWeight: 600, color: "#2e7d32" }}>{selectedLesson.title}</span>
              <span style={{ marginLeft: "12px", color: "#666", fontSize: "0.9rem" }}>
                {selectedLesson.promptCount} questions
              </span>
            </div>
            <button
              onClick={() => setSelectedLessonId("")}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "#666",
                fontSize: "0.85rem",
              }}
            >
              Change
            </button>
          </div>
        ) : (
          <select
            value={selectedLessonId}
            onChange={(e) => handleLessonChange(e.target.value)}
            style={{
              width: "100%",
              padding: "12px",
              fontSize: "1rem",
              borderRadius: "8px",
              border: "2px solid #e0e0e0",
            }}
          >
            <option value="">Select a lesson...</option>
            {lessons.map((lesson) => (
              <option key={lesson.id} value={lesson.id}>
                {lesson.title} ({lesson.promptCount} questions)
              </option>
            ))}
          </select>
        )}

        {/* Show existing assignments for this lesson */}
        {assignmentSummary && assignmentSummary.totalAssigned > 0 && (
          <div style={{ marginTop: "12px", padding: "12px", background: "#fff3e0", borderRadius: "8px" }}>
            <span style={{ color: "#e65100", fontSize: "0.9rem" }}>
              Already assigned to {assignmentSummary.totalAssigned} student
              {assignmentSummary.totalAssigned !== 1 ? "s" : ""} in{" "}
              {assignmentSummary.assignmentsByClass.length} class
              {assignmentSummary.assignmentsByClass.length !== 1 ? "es" : ""}
            </span>
          </div>
        )}
      </div>

      {/* Step 2: Select Class */}
      <div className="card" style={{ marginBottom: "16px" }}>
        <h3 style={{ margin: 0, marginBottom: "16px" }}>2. Select Class</h3>

        {classId && selectedClass ? (
          <div
            style={{
              padding: "16px",
              background: "#e8f5e9",
              borderRadius: "8px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <span style={{ fontWeight: 600, color: "#2e7d32" }}>{selectedClass.name}</span>
              <span style={{ marginLeft: "12px", color: "#666", fontSize: "0.9rem" }}>
                {selectedClass.students.length} students
              </span>
            </div>
          </div>
        ) : (
          <>
            {classes.length === 0 ? (
              <div style={{ textAlign: "center", padding: "24px" }}>
                <p style={{ color: "#666", marginBottom: "16px" }}>
                  No classes yet. Create a class first to assign lessons.
                </p>
                <button
                  className="btn btn-primary"
                  onClick={() => navigate("/educator?drawer=classes")}
                >
                  Create Class
                </button>
              </div>
            ) : (
              <select
                value={selectedClassId}
                onChange={(e) => handleClassChange(e.target.value)}
                style={{
                  width: "100%",
                  padding: "12px",
                  fontSize: "1rem",
                  borderRadius: "8px",
                  border: "2px solid #e0e0e0",
                }}
              >
                <option value="">Select a class...</option>
                {classes.map((cls) => (
                  <option key={cls.id} value={cls.id}>
                    {cls.name} ({cls.studentCount} students)
                  </option>
                ))}
              </select>
            )}
          </>
        )}
      </div>

      {/* Step 3: Choose Students */}
      {selectedClass && classStudents.length > 0 && (
        <div className="card" style={{ marginBottom: "16px" }}>
          <h3 style={{ margin: 0, marginBottom: "16px" }}>3. Choose Students</h3>

          <div style={{ display: "flex", gap: "12px", marginBottom: "16px" }}>
            <button
              className={`btn ${assignMode === "all" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setAssignMode("all")}
            >
              All Students ({classStudents.length})
            </button>
            <button
              className={`btn ${assignMode === "select" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setAssignMode("select")}
            >
              Select Students
            </button>
          </div>

          {assignMode === "select" && (
            <div>
              <div style={{ display: "flex", gap: "12px", marginBottom: "12px" }}>
                <button
                  onClick={selectAllStudents}
                  style={{
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    color: "#667eea",
                    fontSize: "0.9rem",
                  }}
                >
                  Select All
                </button>
                <button
                  onClick={deselectAllStudents}
                  style={{
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    color: "#667eea",
                    fontSize: "0.9rem",
                  }}
                >
                  Deselect All
                </button>
                <span style={{ color: "#666", fontSize: "0.9rem" }}>
                  {selectedStudentIds.size} selected
                </span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {classStudents.map((student) => (
                  <label
                    key={student.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      padding: "12px 16px",
                      background: selectedStudentIds.has(student.id) ? "#e8f5e9" : "#f5f5f5",
                      borderRadius: "8px",
                      cursor: "pointer",
                      transition: "background 0.2s",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedStudentIds.has(student.id)}
                      onChange={() => toggleStudent(student.id)}
                      style={{ width: "18px", height: "18px" }}
                    />
                    <span style={{ fontWeight: 500 }}>{student.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Empty class warning */}
      {selectedClass && selectedClass.students.length === 0 && (
        <div className="card" style={{ background: "#fff3e0", borderLeft: "4px solid #ff9800", marginBottom: "16px" }}>
          <p style={{ margin: 0, color: "#e65100" }}>
            This class has no students. Add students to the class before assigning lessons.
          </p>
          <button
            className="btn btn-primary"
            onClick={() => navigate(`/educator/class/${selectedClassId}`)}
            style={{ marginTop: "12px" }}
          >
            Add Students
          </button>
        </div>
      )}

      {/* Step 4: Due Date (Optional) */}
      {selectedClass && classStudents.length > 0 && (
        <div className="card" style={{ marginBottom: "16px" }}>
          <h3 style={{ margin: 0, marginBottom: "8px" }}>4. Due Date (Optional)</h3>
          <p style={{ color: "#666", fontSize: "0.9rem", marginBottom: "16px" }}>
            Set a due date for this assignment, or leave blank for no deadline.
          </p>

          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            min={new Date().toISOString().split("T")[0]}
            style={{
              padding: "12px",
              fontSize: "1rem",
              borderRadius: "8px",
              border: "2px solid #e0e0e0",
              width: "200px",
            }}
          />

          {dueDate && (
            <button
              onClick={() => setDueDate("")}
              style={{
                marginLeft: "12px",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "#666",
                fontSize: "0.9rem",
              }}
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Action Buttons */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", marginTop: "24px" }}>
        <button
          onClick={() => {
            if (classId) {
              navigate(`/educator/class/${classId}`);
            } else {
              navigate("/educator");
            }
          }}
          style={{
            padding: "14px 28px",
            fontSize: "1rem",
            background: "rgba(255, 255, 255, 0.18)",
            color: "white",
            border: "1px solid rgba(255, 255, 255, 0.45)",
            borderRadius: "8px",
            cursor: "pointer",
            fontWeight: 500,
            transition: "background 0.2s, border-color 0.2s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255, 255, 255, 0.28)";
            e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.6)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(255, 255, 255, 0.18)";
            e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.45)";
          }}
        >
          Cancel
        </button>
        <button
          className="btn btn-primary"
          onClick={handleAssign}
          disabled={!canAssign || assigning}
          style={{
            padding: "14px 28px",
            fontSize: "1rem",
            opacity: canAssign ? 1 : 0.5,
          }}
        >
          {assigning ? "Assigning..." : "Assign Lesson"}
        </button>
      </div>
    </div>
  );
}
