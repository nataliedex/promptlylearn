/**
 * LessonEditor - Edit existing lessons
 *
 * Allows educators to view and modify:
 * - Lesson title and description
 * - Individual questions
 * - Hints for each question
 */

import { useState, useEffect, useRef } from "react";
import { useParams, Link, useNavigate, useLocation } from "react-router-dom";
import EducatorHeader from "../components/EducatorHeader";
import { getLesson, saveLesson, generateQuestion, getLessonAssignments, deleteLesson, type Lesson, type Prompt, type LessonAssignmentSummary } from "../services/api";
import { useToast } from "../components/Toast";
import { recordQuestionsEdited, recordHintPatterns } from "../utils/teacherPreferences";

// Available options for editing
const DIFFICULTY_OPTIONS = ["beginner", "intermediate", "advanced"] as const;
const GRADE_OPTIONS = ["K", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"];
const SUBJECT_OPTIONS = ["Math", "Reading", "Science", "Writing", "Social Studies", "Art", "Music", "Other"];

export default function LessonEditor() {
  const { lessonId } = useParams<{ lessonId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { showSuccess, showError } = useToast();

  // Check if we just created this lesson (to show AI badges)
  const navigationState = location.state as { justCreated?: boolean; fromAssignment?: boolean } | null;
  const isNewlyCreated = navigationState?.justCreated ?? false;

  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [assignmentSummary, setAssignmentSummary] = useState<LessonAssignmentSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Track which questions have been edited (to remove AI badge)
  const [editedQuestionIds, setEditedQuestionIds] = useState<Set<string>>(new Set());

  // Store original questions for preference learning
  const originalQuestionsRef = useRef<Map<string, string>>(new Map());

  // Editing state
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [editingSubject, setEditingSubject] = useState(false);
  const [editingGrade, setEditingGrade] = useState(false);
  const [editingDifficulty, setEditingDifficulty] = useState(false);
  const [expandedQuestion, setExpandedQuestion] = useState<string | null>(null);

  // Question generation modal state
  const [showAddQuestionModal, setShowAddQuestionModal] = useState(false);
  const [generatingQuestion, setGeneratingQuestion] = useState(false);
  const [generatedQuestion, setGeneratedQuestion] = useState<Prompt | null>(null);
  const [questionFocus, setQuestionFocus] = useState("");

  // Delete confirmation state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!lessonId) return;

    const loadLesson = async () => {
      try {
        const [data, assignments] = await Promise.all([
          getLesson(lessonId),
          getLessonAssignments(lessonId).catch(() => null),
        ]);
        setLesson(data);
        setAssignmentSummary(assignments);
        // Store original question text for preference learning
        const originals = new Map<string, string>();
        data.prompts.forEach((p: Prompt) => {
          originals.set(p.id, p.input);
        });
        originalQuestionsRef.current = originals;
      } catch (err) {
        console.error("Failed to load lesson:", err);
        showError("Failed to load lesson");
      } finally {
        setLoading(false);
      }
    };

    loadLesson();
  }, [lessonId]);

  const handleSave = async () => {
    if (!lesson) return;

    setSaving(true);
    try {
      await saveLesson(lesson);
      setHasChanges(false);
      showSuccess("Lesson saved successfully");

      // Record edit patterns for preference learning (only if there were edits)
      if (editedQuestionIds.size > 0 && isNewlyCreated) {
        const originalQuestions: string[] = [];
        const editedQuestions: string[] = [];

        lesson.prompts.forEach((p) => {
          if (editedQuestionIds.has(p.id)) {
            const original = originalQuestionsRef.current.get(p.id);
            if (original) {
              originalQuestions.push(original);
              editedQuestions.push(p.input);
            }
          }
        });

        if (editedQuestions.length > 0) {
          recordQuestionsEdited(editedQuestions.length, originalQuestions, editedQuestions);
        }
      }

      // Record hint patterns
      const hintsPerQuestion = lesson.prompts.map((p) => p.hints.length);
      if (hintsPerQuestion.length > 0) {
        recordHintPatterns(hintsPerQuestion);
      }
    } catch (err) {
      console.error("Failed to save lesson:", err);
      showError("Failed to save lesson");
    } finally {
      setSaving(false);
    }
  };

  const updateLesson = (updates: Partial<Lesson>) => {
    if (!lesson) return;
    setLesson({ ...lesson, ...updates });
    setHasChanges(true);
  };

  const updateQuestion = (questionId: string, updates: Partial<Prompt>) => {
    if (!lesson) return;
    setLesson({
      ...lesson,
      prompts: lesson.prompts.map((p) =>
        p.id === questionId ? { ...p, ...updates } : p
      ),
    });
    setHasChanges(true);
    // Mark question as edited (removes AI badge)
    if (updates.input !== undefined) {
      setEditedQuestionIds((prev) => new Set(prev).add(questionId));
    }
  };

  const updateHint = (questionId: string, hintIndex: number, newHint: string) => {
    if (!lesson) return;
    setLesson({
      ...lesson,
      prompts: lesson.prompts.map((p) =>
        p.id === questionId
          ? { ...p, hints: p.hints.map((h, i) => (i === hintIndex ? newHint : h)) }
          : p
      ),
    });
    setHasChanges(true);
  };

  const addHint = (questionId: string) => {
    if (!lesson) return;
    setLesson({
      ...lesson,
      prompts: lesson.prompts.map((p) =>
        p.id === questionId ? { ...p, hints: [...p.hints, ""] } : p
      ),
    });
    setHasChanges(true);
  };

  const removeHint = (questionId: string, hintIndex: number) => {
    if (!lesson) return;
    setLesson({
      ...lesson,
      prompts: lesson.prompts.map((p) =>
        p.id === questionId
          ? { ...p, hints: p.hints.filter((_, i) => i !== hintIndex) }
          : p
      ),
    });
    setHasChanges(true);
  };

  const handleGenerateQuestion = async () => {
    if (!lesson) return;

    setGeneratingQuestion(true);
    try {
      const existingQuestions = lesson.prompts.map((p) => p.input);
      const lessonContext = `${lesson.title}: ${lesson.description}`;
      const newQuestion = await generateQuestion(
        lessonContext,
        existingQuestions,
        lesson.difficulty,
        {
          focus: questionFocus.trim() || undefined,
          subject: lesson.subject || undefined,
          gradeLevel: lesson.gradeLevel || undefined,
        }
      );
      setGeneratedQuestion(newQuestion);
    } catch (err) {
      console.error("Failed to generate question:", err);
      showError("Failed to generate question");
    } finally {
      setGeneratingQuestion(false);
    }
  };

  const handleAddGeneratedQuestion = () => {
    if (!lesson || !generatedQuestion) return;
    setLesson({
      ...lesson,
      prompts: [...lesson.prompts, generatedQuestion],
    });
    setHasChanges(true);
    setGeneratedQuestion(null);
    setShowAddQuestionModal(false);
    setQuestionFocus("");
    showSuccess("Question added");
  };

  const updateGeneratedQuestion = (updates: Partial<Prompt>) => {
    if (!generatedQuestion) return;
    setGeneratedQuestion({ ...generatedQuestion, ...updates });
  };

  const updateGeneratedHint = (hintIndex: number, newHint: string) => {
    if (!generatedQuestion) return;
    setGeneratedQuestion({
      ...generatedQuestion,
      hints: generatedQuestion.hints.map((h, i) => (i === hintIndex ? newHint : h)),
    });
  };

  const removeGeneratedHint = (hintIndex: number) => {
    if (!generatedQuestion) return;
    setGeneratedQuestion({
      ...generatedQuestion,
      hints: generatedQuestion.hints.filter((_, i) => i !== hintIndex),
    });
  };

  const addGeneratedHint = () => {
    if (!generatedQuestion) return;
    setGeneratedQuestion({
      ...generatedQuestion,
      hints: [...generatedQuestion.hints, ""],
    });
  };

  const removeQuestion = (questionId: string) => {
    if (!lesson) return;
    setLesson({
      ...lesson,
      prompts: lesson.prompts.filter((p) => p.id !== questionId),
    });
    setHasChanges(true);
  };

  const handleDelete = async () => {
    if (!lessonId) return;
    setDeleting(true);
    try {
      await deleteLesson(lessonId);
      showSuccess("Lesson deleted");
      navigate("/educator");
    } catch (err) {
      console.error("Failed to delete lesson:", err);
      showError("Failed to delete lesson");
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  if (loading) {
    return (
      <div className="loading">
        <div className="loading-spinner"></div>
        <p>Loading lesson...</p>
      </div>
    );
  }

  if (!lesson) {
    return (
      <div className="container">
        <EducatorHeader breadcrumbs={[{ label: "Lesson not found" }]} />
        <div className="card">
          <p>Lesson not found.</p>
          <Link to="/educator" className="btn btn-primary" style={{ marginTop: "16px" }}>
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <EducatorHeader
        breadcrumbs={[
          ...(assignmentSummary && assignmentSummary.totalAssigned > 0
            ? [{ label: lesson.title, to: `/educator/assignment/${lessonId}` }]
            : []),
          { label: assignmentSummary && assignmentSummary.totalAssigned > 0 ? "Edit Lesson" : lesson.title },
        ]}
      />

      {/* Success banner for newly created lessons */}
      {isNewlyCreated && lesson.prompts.length > 0 && (
        <div
          className="card"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "14px 18px",
            background: "linear-gradient(135deg, #f0fdf4 0%, #ecfeff 100%)",
            border: "1px solid #bbf7d0",
          }}
        >
          <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "#166534" }}>Ready</span>
          <div>
            <p style={{ margin: 0, fontWeight: 500, color: "#166534", fontSize: "0.95rem" }}>
              Lesson ready for review
            </p>
            <p style={{ margin: "4px 0 0 0", color: "#15803d", fontSize: "0.85rem" }}>
              {lesson.prompts.length} question{lesson.prompts.length !== 1 ? "s" : ""} generated. Review, edit, or add more below.
            </p>
          </div>
        </div>
      )}

      {/* Header - uses .header class for white-on-gradient text, matching AssignmentReview */}
      <div
        className="header"
        style={{
          textAlign: "left",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "20px",
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, maxWidth: "600px" }}>
          {editingTitle ? (
            <input
              type="text"
              value={lesson.title}
              onChange={(e) => updateLesson({ title: e.target.value })}
              onBlur={() => setEditingTitle(false)}
              onKeyDown={(e) => e.key === "Enter" && setEditingTitle(false)}
              autoFocus
              style={{
                fontSize: "1.375rem",
                fontWeight: 600,
                border: "2px solid rgba(255,255,255,0.6)",
                borderRadius: "6px",
                padding: "8px 12px",
                width: "100%",
                color: "var(--text-primary)",
                background: "white",
                lineHeight: 1.4,
              }}
            />
          ) : (
            <h1
              onClick={() => setEditingTitle(true)}
              className="lesson-title-editable"
              style={{
                margin: 0,
                cursor: "pointer",
                padding: "4px 0",
                borderRadius: "4px",
                transition: "background 0.15s",
                lineHeight: 1.4,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical" as const,
                overflow: "hidden",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.1)";
                const icon = e.currentTarget.querySelector('.edit-icon') as HTMLElement;
                if (icon) icon.style.opacity = "1";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                const icon = e.currentTarget.querySelector('.edit-icon') as HTMLElement;
                if (icon) icon.style.opacity = "0";
              }}
              title="Click to edit title"
            >
              {lesson.title}
              <span className="edit-icon" style={{ marginLeft: "8px", fontSize: "0.8rem", color: "rgba(255,255,255,0.5)", opacity: 0, transition: "opacity 0.15s" }}>✎</span>
            </h1>
          )}

          {/* Metadata chips - styled for dark gradient background */}
          <div style={{ display: "flex", gap: "6px", marginTop: "12px", flexWrap: "wrap", alignItems: "center" }}>
            {/* Subject - Editable */}
            {editingSubject ? (
              <select
                value={lesson.subject || ""}
                onChange={(e) => {
                  updateLesson({ subject: e.target.value || undefined });
                  setEditingSubject(false);
                }}
                onBlur={() => setEditingSubject(false)}
                autoFocus
                style={{
                  fontSize: "0.75rem",
                  padding: "3px 8px",
                  border: "1px solid rgba(255,255,255,0.4)",
                  borderRadius: "4px",
                  background: "white",
                  color: "var(--text-primary)",
                }}
              >
                <option value="">No subject</option>
                {SUBJECT_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            ) : (
              <button
                onClick={() => setEditingSubject(true)}
                style={{
                  fontSize: "0.75rem",
                  padding: "3px 10px",
                  background: lesson.subject ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.1)",
                  color: lesson.subject ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.5)",
                  borderRadius: "4px",
                  border: "none",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.3)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = lesson.subject ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.1)";
                }}
                title="Click to edit subject"
              >
                {lesson.subject || "+ Subject"}<span style={{ opacity: 0, marginLeft: "4px", transition: "opacity 0.15s" }}>✎</span>
              </button>
            )}

            {/* Grade Level - Editable */}
            {editingGrade ? (
              <select
                value={lesson.gradeLevel || ""}
                onChange={(e) => {
                  updateLesson({ gradeLevel: e.target.value || undefined });
                  setEditingGrade(false);
                }}
                onBlur={() => setEditingGrade(false)}
                autoFocus
                style={{
                  fontSize: "0.75rem",
                  padding: "3px 8px",
                  border: "1px solid rgba(255,255,255,0.4)",
                  borderRadius: "4px",
                  background: "white",
                  color: "var(--text-primary)",
                }}
              >
                <option value="">No grade</option>
                {GRADE_OPTIONS.map((g) => (
                  <option key={g} value={g}>{g} Grade</option>
                ))}
              </select>
            ) : (
              <button
                onClick={() => setEditingGrade(true)}
                style={{
                  fontSize: "0.75rem",
                  padding: "3px 10px",
                  background: lesson.gradeLevel ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.1)",
                  color: lesson.gradeLevel ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.5)",
                  borderRadius: "4px",
                  border: "none",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.3)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = lesson.gradeLevel ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.1)";
                }}
                title="Click to edit grade level"
              >
                {lesson.gradeLevel || "+ Grade"}<span style={{ opacity: 0, marginLeft: "4px", transition: "opacity 0.15s" }}>✎</span>
              </button>
            )}

            {/* Difficulty - Editable */}
            {editingDifficulty ? (
              <select
                value={lesson.difficulty}
                onChange={(e) => {
                  updateLesson({ difficulty: e.target.value as Lesson["difficulty"] });
                  setEditingDifficulty(false);
                }}
                onBlur={() => setEditingDifficulty(false)}
                autoFocus
                style={{
                  fontSize: "0.75rem",
                  padding: "3px 8px",
                  border: "1px solid rgba(255,255,255,0.4)",
                  borderRadius: "4px",
                  background: "white",
                  color: "var(--text-primary)",
                  textTransform: "capitalize",
                }}
              >
                {DIFFICULTY_OPTIONS.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            ) : (
              <button
                onClick={() => setEditingDifficulty(true)}
                style={{
                  fontSize: "0.75rem",
                  padding: "3px 10px",
                  background: "rgba(255,255,255,0.2)",
                  color: "rgba(255,255,255,0.9)",
                  borderRadius: "4px",
                  textTransform: "capitalize",
                  border: "none",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.3)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.2)";
                }}
                title="Click to edit difficulty"
              >
                {lesson.difficulty}<span style={{ opacity: 0, marginLeft: "4px", transition: "opacity 0.15s" }}>✎</span>
              </button>
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <button
            onClick={handleSave}
            disabled={saving || !hasChanges}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 14px",
              fontSize: "0.9rem",
              fontWeight: 500,
              background: hasChanges ? "rgba(255, 255, 255, 0.95)" : "rgba(255, 255, 255, 0.4)",
              color: hasChanges ? "#4a5568" : "rgba(255,255,255,0.7)",
              border: "none",
              borderRadius: "6px",
              cursor: hasChanges ? "pointer" : "not-allowed",
              transition: "all 0.15s",
              boxShadow: hasChanges ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
            }}
            onMouseEnter={(e) => {
              if (hasChanges) {
                e.currentTarget.style.background = "#ffffff";
                e.currentTarget.style.boxShadow = "0 2px 4px rgba(0,0,0,0.15)";
              }
            }}
            onMouseLeave={(e) => {
              if (hasChanges) {
                e.currentTarget.style.background = "rgba(255, 255, 255, 0.95)";
                e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.1)";
              }
            }}
          >
            {saving ? "Saving..." : hasChanges ? "Save Changes" : "Saved"}
          </button>
          {assignmentSummary && assignmentSummary.totalAssigned > 0 ? (
            <button
              onClick={() => navigate(`/educator/assignment/${lessonId}`)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 14px",
                fontSize: "0.9rem",
                fontWeight: 500,
                background: "rgba(255, 255, 255, 0.95)",
                color: "#4a5568",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                transition: "background 0.15s, box-shadow 0.15s",
                boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#ffffff";
                e.currentTarget.style.boxShadow = "0 2px 4px rgba(0,0,0,0.15)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(255, 255, 255, 0.95)";
                e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.1)";
              }}
            >
              View Assignment →
            </button>
          ) : (
            <>
              <button
                onClick={() => navigate(`/educator/assign-lesson?lessonId=${lessonId}`)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 14px",
                  fontSize: "0.9rem",
                  fontWeight: 500,
                  background: "rgba(255, 255, 255, 0.95)",
                  color: "#4a5568",
                  border: "none",
                  borderRadius: "6px",
                  cursor: "pointer",
                  transition: "background 0.15s, box-shadow 0.15s",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#ffffff";
                  e.currentTarget.style.boxShadow = "0 2px 4px rgba(0,0,0,0.15)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.95)";
                  e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.1)";
                }}
              >
                Assign to Class →
              </button>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 14px",
                  fontSize: "0.9rem",
                  fontWeight: 500,
                  background: "rgba(255, 255, 255, 0.15)",
                  color: "rgba(255, 255, 255, 0.8)",
                  border: "1px solid rgba(255, 255, 255, 0.3)",
                  borderRadius: "6px",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(239, 68, 68, 0.9)";
                  e.currentTarget.style.color = "white";
                  e.currentTarget.style.borderColor = "transparent";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.15)";
                  e.currentTarget.style.color = "rgba(255, 255, 255, 0.8)";
                  e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.3)";
                }}
                title="Delete lesson"
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>

      {/* Assignment Status Indicator */}
      {assignmentSummary && assignmentSummary.totalAssigned > 0 && (
        <div
          className="card"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "12px 16px",
            marginBottom: "24px",
            fontSize: "0.85rem",
            color: "var(--text-secondary)",
          }}
        >
          <span style={{ color: "var(--status-success-text)", fontWeight: 500 }}>Assigned</span>
          <span style={{ color: "var(--text-muted)" }}>·</span>
          {assignmentSummary.assignmentsByClass.map((cls, i) => (
            <span key={cls.classId}>
              {i > 0 && <span style={{ color: "var(--text-muted)", margin: "0 4px" }}>·</span>}
              <Link
                to={`/educator/class/${cls.classId}`}
                style={{ color: "var(--accent-primary)", textDecoration: "none", fontWeight: 500 }}
                onMouseEnter={(e) => e.currentTarget.style.textDecoration = "underline"}
                onMouseLeave={(e) => e.currentTarget.style.textDecoration = "none"}
              >
                {cls.className}
              </Link>
              <span style={{ color: "var(--text-muted)", marginLeft: "4px" }}>
                ({cls.studentCount} student{cls.studentCount !== 1 ? "s" : ""})
              </span>
            </span>
          ))}
        </div>
      )}

      {/* Description */}
      <div className="card" style={{ marginBottom: "24px" }}>
        <div style={{ fontSize: "0.8rem", fontWeight: 500, color: "var(--text-muted)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.03em" }}>
          Description
        </div>
        {editingDescription ? (
          <textarea
            value={lesson.description}
            onChange={(e) => updateLesson({ description: e.target.value })}
            onBlur={() => setEditingDescription(false)}
            autoFocus
            rows={3}
            style={{
              width: "100%",
              padding: "10px",
              border: "1px solid var(--accent-primary)",
              borderRadius: "6px",
              fontSize: "0.9rem",
              resize: "vertical",
              fontFamily: "inherit",
              lineHeight: 1.6,
              boxSizing: "border-box",
            }}
          />
        ) : (
          <p
            onClick={() => setEditingDescription(true)}
            style={{
              margin: 0,
              cursor: "pointer",
              padding: "10px 12px",
              background: "var(--surface-muted)",
              borderRadius: "6px",
              color: lesson.description ? "var(--text-secondary)" : "var(--text-muted)",
              transition: "background 0.15s",
              fontSize: "0.9rem",
              lineHeight: 1.6,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--surface-accent)";
              const icon = e.currentTarget.querySelector('.desc-edit') as HTMLElement;
              if (icon) icon.style.opacity = "1";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "var(--surface-muted)";
              const icon = e.currentTarget.querySelector('.desc-edit') as HTMLElement;
              if (icon) icon.style.opacity = "0";
            }}
            title="Click to edit description"
          >
            {lesson.description || "Click to add a description..."}
            <span className="desc-edit" style={{ marginLeft: "8px", fontSize: "0.8rem", color: "var(--text-muted)", opacity: 0, transition: "opacity 0.15s" }}>✎</span>
          </p>
        )}
      </div>

      {/* Questions Section */}
      <div style={{ marginTop: "16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "0.75rem", fontWeight: 500, color: "rgba(255,255,255,0.7)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Questions
            </span>
            <span style={{
              fontSize: "0.75rem",
              fontWeight: 600,
              color: "white",
              background: "rgba(255,255,255,0.2)",
              padding: "2px 8px",
              borderRadius: "10px",
            }}>
              {lesson.prompts.length}
            </span>
          </div>
          <button
            onClick={() => {
              setShowAddQuestionModal(true);
              setGeneratedQuestion(null);
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 16px",
              fontSize: "0.85rem",
              fontWeight: 500,
              background: "rgba(255, 255, 255, 0.95)",
              color: "#4a5568",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              transition: "background 0.15s, box-shadow 0.15s",
              boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#ffffff";
              e.currentTarget.style.boxShadow = "0 2px 4px rgba(0,0,0,0.15)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.95)";
              e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.1)";
            }}
          >
            + Add Question
          </button>
        </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {lesson.prompts.map((prompt, index) => {
          const isAIGenerated = isNewlyCreated && !editedQuestionIds.has(prompt.id);
          return (
            <QuestionEditor
              key={prompt.id}
              prompt={prompt}
              index={index}
              isExpanded={expandedQuestion === prompt.id}
              isAIGenerated={isAIGenerated}
              onToggle={() =>
                setExpandedQuestion(expandedQuestion === prompt.id ? null : prompt.id)
              }
              onUpdateQuestion={(updates) => updateQuestion(prompt.id, updates)}
              onUpdateHint={(hintIndex, newHint) => updateHint(prompt.id, hintIndex, newHint)}
              onAddHint={() => addHint(prompt.id)}
              onRemoveHint={(hintIndex) => removeHint(prompt.id, hintIndex)}
              onRemove={() => removeQuestion(prompt.id)}
            />
          );
        })}
        {lesson.prompts.length === 0 && (
          <div className="card" style={{ textAlign: "center", padding: "48px", color: "var(--text-secondary)" }}>
            <div style={{ fontSize: "1rem", marginBottom: "12px", opacity: 0.7, fontWeight: 500 }}>No questions</div>
            <p style={{ margin: "0 0 16px 0", fontWeight: 500 }}>No questions yet</p>
            <button
              onClick={() => {
                setShowAddQuestionModal(true);
                setGeneratedQuestion(null);
              }}
              className="btn btn-primary"
              style={{
                padding: "10px 20px",
              }}
            >
              + Add Your First Question
            </button>
          </div>
        )}
      </div>
      </div>

      {/* Add Question Modal */}
      {showAddQuestionModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(45, 55, 72, 0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => { setShowAddQuestionModal(false); setQuestionFocus(""); }}
        >
          <div
            className="card"
            style={{
              maxWidth: "600px",
              width: "90%",
              maxHeight: "80vh",
              overflow: "auto",
              position: "relative",
              boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => { setShowAddQuestionModal(false); setQuestionFocus(""); }}
              style={{
                position: "absolute",
                top: "12px",
                right: "12px",
                background: "none",
                border: "none",
                fontSize: "1.25rem",
                color: "var(--text-muted)",
                cursor: "pointer",
                padding: "4px 8px",
                lineHeight: 1,
              }}
            >
              ×
            </button>

            <h2 style={{ margin: "0 0 8px 0", color: "var(--text-primary)", fontWeight: 600 }}>Add Question</h2>
            <p style={{ color: "var(--text-secondary)", marginBottom: "20px", fontSize: "0.9rem" }}>
              Generate a new question with AI, then review and modify before adding.
            </p>

            {!generatedQuestion ? (
              <div style={{ padding: "16px 24px 24px" }}>
                {/* Optional focus input */}
                <div style={{ marginBottom: "16px" }}>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 500, color: "var(--text-secondary)", marginBottom: "5px" }}>
                    What should this question focus on?
                  </label>
                  <input
                    type="text"
                    value={questionFocus}
                    onChange={(e) => setQuestionFocus(e.target.value)}
                    placeholder="e.g., daily life, religion, cause and effect, compare past vs present"
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: "6px",
                      fontSize: "0.875rem",
                      color: "var(--text-primary)",
                      boxSizing: "border-box",
                    }}
                  />
                  <p style={{ margin: "4px 0 0 0", fontSize: "0.78rem", color: "var(--text-muted)" }}>
                    Optional — leave blank to let the AI choose
                  </p>
                </div>

                <div style={{ textAlign: "center" }}>
                  <button
                    onClick={handleGenerateQuestion}
                    disabled={generatingQuestion}
                    className="btn btn-primary"
                    style={{ padding: "12px 24px" }}
                  >
                    {generatingQuestion ? (
                      <>
                        <span className="loading-spinner" style={{ width: "16px", height: "16px", marginRight: "8px", display: "inline-block" }}></span>
                        Generating...
                      </>
                    ) : (
                      "Generate Question with AI"
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                {/* Generated Question Preview */}
                <div style={{ marginBottom: "16px" }}>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 500, color: "var(--text-muted)", marginBottom: "6px" }}>
                    Question Text
                  </label>
                  <textarea
                    value={generatedQuestion.input}
                    onChange={(e) => updateGeneratedQuestion({ input: e.target.value })}
                    rows={3}
                    style={{
                      width: "100%",
                      padding: "10px",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: "6px",
                      fontSize: "0.95rem",
                      resize: "vertical",
                      fontFamily: "inherit",
                      boxSizing: "border-box",
                    }}
                  />
                </div>

                {/* Hints */}
                <div style={{ marginBottom: "16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                    <label style={{ fontSize: "0.85rem", fontWeight: 500, color: "var(--text-muted)" }}>
                      Hints ({generatedQuestion.hints.length})
                    </label>
                    <button
                      onClick={addGeneratedHint}
                      style={{
                        padding: "4px 10px",
                        background: "var(--accent-primary)",
                        color: "white",
                        border: "none",
                        borderRadius: "4px",
                        cursor: "pointer",
                        fontSize: "0.8rem",
                      }}
                    >
                      + Add Hint
                    </button>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {generatedQuestion.hints.map((hint, hintIndex) => (
                      <div
                        key={hintIndex}
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: "8px",
                          padding: "8px",
                          background: "var(--surface-muted)",
                          borderRadius: "6px",
                          border: "1px solid var(--border-subtle)",
                        }}
                      >
                        <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", fontWeight: 600, marginTop: "6px" }}>
                          {hintIndex + 1}.
                        </span>
                        <textarea
                          value={hint}
                          onChange={(e) => updateGeneratedHint(hintIndex, e.target.value)}
                          rows={2}
                          style={{
                            flex: 1,
                            padding: "6px 8px",
                            border: "1px solid var(--border-subtle)",
                            borderRadius: "4px",
                            fontSize: "0.85rem",
                            resize: "vertical",
                            fontFamily: "inherit",
                            boxSizing: "border-box",
                          }}
                        />
                        <button
                          onClick={() => removeGeneratedHint(hintIndex)}
                          style={{
                            padding: "4px 8px",
                            background: "transparent",
                            color: "var(--text-muted)",
                            border: "none",
                            cursor: "pointer",
                            fontSize: "0.8rem",
                          }}
                          title="Remove hint"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end", marginTop: "20px" }}>
                  <button
                    onClick={handleGenerateQuestion}
                    disabled={generatingQuestion}
                    style={{
                      padding: "10px 16px",
                      background: "transparent",
                      color: "var(--text-secondary)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: "6px",
                      cursor: "pointer",
                      fontSize: "0.875rem",
                      fontWeight: 500,
                    }}
                  >
                    {generatingQuestion ? "Generating..." : "Regenerate"}
                  </button>
                  <button
                    onClick={handleAddGeneratedQuestion}
                    className="btn btn-primary"
                    style={{ padding: "10px 20px" }}
                  >
                    Add to Lesson
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(45, 55, 72, 0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setShowDeleteConfirm(false)}
        >
          <div
            className="card"
            style={{
              maxWidth: "440px",
              width: "90%",
              position: "relative",
              boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 12px 0", color: "var(--text-primary)" }}>Delete this lesson?</h3>
            <p style={{ color: "var(--text-secondary)", margin: "0 0 20px 0", fontSize: "0.9rem", lineHeight: 1.5 }}>
              This will permanently delete <strong>{lesson.title}</strong>. This action cannot be undone.
            </p>
            <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                style={{
                  padding: "8px 16px",
                  background: "transparent",
                  color: "var(--text-secondary)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                style={{
                  padding: "8px 16px",
                  background: deleting ? "#e2e8f0" : "#dc2626",
                  color: deleting ? "#94a3b8" : "white",
                  border: "none",
                  borderRadius: "6px",
                  cursor: deleting ? "not-allowed" : "pointer",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                }}
              >
                {deleting ? "Deleting..." : "Delete Lesson"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unsaved changes warning */}
      {hasChanges && (
        <div
          style={{
            position: "fixed",
            bottom: "20px",
            right: "20px",
            padding: "12px 20px",
            background: "white",
            border: "1px solid var(--border-subtle)",
            borderRadius: "8px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            display: "flex",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <span style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>Unsaved changes</span>
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn btn-primary"
            style={{
              padding: "6px 14px",
              fontSize: "0.85rem",
            }}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================
// Question Editor Component
// ============================================

interface QuestionEditorProps {
  prompt: Prompt;
  index: number;
  isExpanded: boolean;
  isAIGenerated?: boolean;
  onToggle: () => void;
  onUpdateQuestion: (updates: Partial<Prompt>) => void;
  onUpdateHint: (hintIndex: number, newHint: string) => void;
  onAddHint: () => void;
  onRemoveHint: (hintIndex: number) => void;
  onRemove: () => void;
}

function QuestionEditor({
  prompt,
  index,
  isExpanded,
  isAIGenerated,
  onToggle,
  onUpdateQuestion,
  onUpdateHint,
  onAddHint,
  onRemoveHint,
  onRemove,
}: QuestionEditorProps) {
  const [editingInput, setEditingInput] = useState(false);

  return (
    <div
      className="card"
      style={{
        padding: 0,
        overflow: "hidden",
        border: isExpanded ? "2px solid var(--accent-primary)" : "1px solid var(--border-subtle)",
        transition: "border-color 0.15s",
      }}
    >
      {/* Question Header */}
      <div
        onClick={onToggle}
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "12px",
          padding: "16px",
          cursor: "pointer",
          background: isExpanded ? "var(--surface-accent-tint)" : "transparent",
          transition: "background 0.15s",
        }}
        onMouseEnter={(e) => {
          if (!isExpanded) e.currentTarget.style.background = "var(--surface-elevated)";
        }}
        onMouseLeave={(e) => {
          if (!isExpanded) e.currentTarget.style.background = "transparent";
        }}
      >
        {/* Question number */}
        <span
          style={{
            flexShrink: 0,
            width: "28px",
            height: "28px",
            borderRadius: "50%",
            background: "var(--accent-primary)",
            color: "white",
            fontSize: "0.85rem",
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {index + 1}
        </span>

        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, color: "var(--text-primary)", lineHeight: 1.5 }}>{prompt.input}</p>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              marginTop: "8px",
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
              {prompt.hints.length} hint{prompt.hints.length !== 1 ? "s" : ""}
            </span>
            {isAIGenerated && (
              <span
                style={{
                  fontSize: "0.7rem",
                  color: "#8b5cf6",
                  background: "#f3e8ff",
                  padding: "2px 8px",
                  borderRadius: "4px",
                  fontWeight: 500,
                }}
                title="This question was generated by AI. Click to edit."
              >
                AI generated
              </span>
            )}
          </div>
        </div>

        <span
          style={{
            color: "var(--accent-primary)",
            fontSize: "0.9rem",
            transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.2s",
            flexShrink: 0,
          }}
        >
          ▼
        </span>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div style={{ padding: "0 16px 16px 16px", borderTop: "1px solid var(--border-muted)" }}>
          {/* Edit Question */}
          <div style={{ marginTop: "16px" }}>
            <label
              style={{
                display: "block",
                fontSize: "0.85rem",
                fontWeight: 500,
                color: "var(--text-muted)",
                marginBottom: "6px",
              }}
            >
              Question Text
            </label>
            {editingInput ? (
              <textarea
                value={prompt.input}
                onChange={(e) => onUpdateQuestion({ input: e.target.value })}
                onBlur={() => setEditingInput(false)}
                autoFocus
                rows={3}
                style={{
                  width: "100%",
                  padding: "10px",
                  border: "2px solid var(--accent-primary)",
                  borderRadius: "8px",
                  fontSize: "0.95rem",
                  resize: "vertical",
                }}
              />
            ) : (
              <div
                onClick={() => setEditingInput(true)}
                style={{
                  padding: "10px",
                  background: "var(--surface-elevated)",
                  borderRadius: "8px",
                  cursor: "pointer",
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-accent)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-elevated)")}
              >
                {prompt.input}
                <span style={{ marginLeft: "8px", fontSize: "0.85rem", color: "var(--text-muted)" }}>✎</span>
              </div>
            )}
          </div>

          {/* Hints */}
          <div style={{ marginTop: "16px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "8px",
              }}
            >
              <label
                style={{
                  fontSize: "0.85rem",
                  fontWeight: 500,
                  color: "var(--text-muted)",
                }}
              >
                Hints ({prompt.hints.length})
              </label>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onAddHint();
                }}
                style={{
                  padding: "4px 10px",
                  background: "var(--accent-primary)",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontSize: "0.8rem",
                }}
              >
                + Add Hint
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {prompt.hints.map((hint, hintIndex) => (
                <HintEditor
                  key={hintIndex}
                  hint={hint}
                  index={hintIndex}
                  onUpdate={(newHint) => onUpdateHint(hintIndex, newHint)}
                  onRemove={() => onRemoveHint(hintIndex)}
                />
              ))}
              {prompt.hints.length === 0 && (
                <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", fontStyle: "italic", margin: 0 }}>
                  No hints yet. Add hints to help students when they get stuck.
                </p>
              )}
            </div>
          </div>

          {/* Delete Question */}
          <div style={{ marginTop: "20px", paddingTop: "16px", borderTop: "1px solid var(--border-muted)" }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm("Are you sure you want to delete this question?")) {
                  onRemove();
                }
              }}
              style={{
                padding: "6px 12px",
                background: "transparent",
                color: "var(--status-danger)",
                border: "1px solid var(--status-danger-border)",
                borderRadius: "6px",
                cursor: "pointer",
                fontSize: "0.85rem",
                fontWeight: 500,
              }}
            >
              Delete Question
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// Hint Editor Component
// ============================================

interface HintEditorProps {
  hint: string;
  index: number;
  onUpdate: (newHint: string) => void;
  onRemove: () => void;
}

function HintEditor({ hint, index, onUpdate, onRemove }: HintEditorProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(hint);

  const handleSave = () => {
    onUpdate(value);
    setEditing(false);
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "8px",
        padding: "10px 12px",
        background: "var(--surface-elevated)",
        borderRadius: "6px",
        border: "1px solid var(--border-muted)",
      }}
    >
      <span
        style={{
          flexShrink: 0,
          width: "20px",
          height: "20px",
          borderRadius: "50%",
          background: "var(--border-muted)",
          color: "var(--text-muted)",
          fontSize: "0.7rem",
          fontWeight: 600,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {index + 1}
      </span>

      <div style={{ flex: 1 }}>
        {editing ? (
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={handleSave}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSave();
              }
            }}
            autoFocus
            rows={2}
            style={{
              width: "100%",
              padding: "6px 8px",
              border: "1px solid var(--accent-primary)",
              borderRadius: "4px",
              fontSize: "0.9rem",
              resize: "vertical",
            }}
          />
        ) : (
          <p
            onClick={() => setEditing(true)}
            style={{
              margin: 0,
              fontSize: "0.9rem",
              color: hint ? "var(--text-primary)" : "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            {hint || "Click to add hint text..."}
            <span style={{ marginLeft: "6px", fontSize: "0.8rem", color: "var(--text-muted)" }}>✎</span>
          </p>
        )}
      </div>

      <button
        onClick={onRemove}
        style={{
          padding: "4px 8px",
          background: "transparent",
          color: "var(--text-muted)",
          border: "none",
          cursor: "pointer",
          fontSize: "0.8rem",
          borderRadius: "4px",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "var(--status-danger)";
          e.currentTarget.style.background = "var(--status-danger-bg)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "var(--text-muted)";
          e.currentTarget.style.background = "transparent";
        }}
        title="Remove hint"
      >
        ✕
      </button>
    </div>
  );
}
