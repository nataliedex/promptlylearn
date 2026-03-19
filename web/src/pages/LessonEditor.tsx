/**
 * LessonEditor - Edit existing lessons
 *
 * Allows educators to view and modify:
 * - Lesson title and description
 * - Individual questions
 * - Hints for each question
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, Link, useNavigate, useLocation } from "react-router-dom";
import EducatorAppHeader from "../components/EducatorAppHeader";
import { getLesson, saveLesson, generateQuestion, generateAssessment, generateQuestionPackage, getLessonAssignments, deleteLesson, type Lesson, type Prompt, type PromptAssessment, type EvaluationFocusArea, type LessonAssignmentSummary, type QuestionPackage } from "../services/api";
import { useToast } from "../components/Toast";
import { recordQuestionsEdited, recordHintPatterns } from "../utils/teacherPreferences";

// ── Question hash for staleness detection ──────────────────────────────────

/** Deterministic hash of normalized question text. */
function questionHash(text: string): string {
  const normalized = text.trim().replace(/\s+/g, " ").toLowerCase();
  // Simple djb2 hash — fast, deterministic, no crypto deps
  let hash = 5381;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) + hash + normalized.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

// ── Block metadata for staleness & lock tracking ───────────────────────────

interface BlockMeta {
  source: "ai" | "teacher";
  locked: boolean;
  basedOnQuestionHash: string;
}

interface QuestionMeta {
  hints: BlockMeta;
  objective: BlockMeta;
  criteria: BlockMeta;
  misconceptions: BlockMeta;
  expectedConcepts: BlockMeta;
  requiredExamples: BlockMeta;
  validVocabulary: BlockMeta;
  scoringLevels: BlockMeta;
}

function defaultBlockMeta(hash: string, source: "ai" | "teacher" = "ai"): BlockMeta {
  return { source, locked: false, basedOnQuestionHash: hash };
}

function defaultQuestionMeta(hash: string): QuestionMeta {
  return {
    hints: defaultBlockMeta(hash),
    objective: defaultBlockMeta(hash),
    criteria: defaultBlockMeta(hash),
    misconceptions: defaultBlockMeta(hash),
    expectedConcepts: defaultBlockMeta(hash),
    requiredExamples: defaultBlockMeta(hash),
    validVocabulary: defaultBlockMeta(hash),
    scoringLevels: defaultBlockMeta(hash),
  };
}

type SectionKey = keyof QuestionMeta;

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

  // Block metadata per question (tracks staleness + locks)
  const [questionMetas, setQuestionMetas] = useState<Record<string, QuestionMeta>>({});

  // Undo stack for regenerate operations
  const undoRef = useRef<{ questionId: string; prompt: Prompt; meta: QuestionMeta } | null>(null);

  /** Get or create metadata for a question */
  const getQuestionMeta = useCallback((promptId: string, input: string): QuestionMeta => {
    return questionMetas[promptId] || defaultQuestionMeta(questionHash(input));
  }, [questionMetas]);

  /** Update metadata for a specific question's block */
  const updateBlockMeta = useCallback((promptId: string, section: SectionKey, updates: Partial<BlockMeta>) => {
    setQuestionMetas(prev => {
      const current = prev[promptId];
      if (!current) return prev;
      return { ...prev, [promptId]: { ...current, [section]: { ...current[section], ...updates } } };
    });
  }, []);

  /** Check if any question has stale (out-of-date) blocks */
  const hasStaleBlocks = useCallback((): boolean => {
    if (!lesson) return false;
    return lesson.prompts.some(p => {
      const meta = questionMetas[p.id];
      if (!meta) return false;
      const hash = questionHash(p.input);
      return (
        meta.hints.basedOnQuestionHash !== hash ||
        meta.objective.basedOnQuestionHash !== hash ||
        meta.criteria.basedOnQuestionHash !== hash ||
        meta.misconceptions.basedOnQuestionHash !== hash
      );
    });
  }, [lesson, questionMetas]);

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
        const metas: Record<string, QuestionMeta> = {};
        data.prompts.forEach((p: Prompt) => {
          originals.set(p.id, p.input);
          metas[p.id] = defaultQuestionMeta(questionHash(p.input));
        });
        originalQuestionsRef.current = originals;
        setQuestionMetas(metas);
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
      // Backend reconciles all math prompts and returns the aligned lesson.
      // Teacher-authored question text is the source of truth — the backend
      // rebuilds mathProblem, hints, rubric, probes, etc. from the expression
      // in the visible text. We apply the reconciled lesson back to state so
      // the UI reflects the aligned data without extra clicks.
      const result = await saveLesson(lesson);
      const reconciledLesson = result.lesson;

      // Apply reconciled lesson back to state
      setLesson(reconciledLesson);

      // Refresh metadata hashes: after reconciliation, all dependent sections
      // are now aligned to the current question text, so mark them fresh.
      setQuestionMetas(prev => {
        const updated = { ...prev };
        reconciledLesson.prompts.forEach((p: Prompt) => {
          const hash = questionHash(p.input);
          const existing = updated[p.id];
          if (existing) {
            // Preserve lock state and teacher source, but update hashes
            // for non-locked sections (they were just reconciled by the backend)
            updated[p.id] = {
              hints: existing.hints.locked
                ? existing.hints
                : { ...existing.hints, basedOnQuestionHash: hash },
              objective: existing.objective.locked
                ? existing.objective
                : { ...existing.objective, basedOnQuestionHash: hash },
              criteria: existing.criteria.locked
                ? existing.criteria
                : { ...existing.criteria, basedOnQuestionHash: hash },
              misconceptions: existing.misconceptions.locked
                ? existing.misconceptions
                : { ...existing.misconceptions, basedOnQuestionHash: hash },
              expectedConcepts: existing.expectedConcepts.locked
                ? existing.expectedConcepts
                : { ...existing.expectedConcepts, basedOnQuestionHash: hash },
              requiredExamples: existing.requiredExamples.locked
                ? existing.requiredExamples
                : { ...existing.requiredExamples, basedOnQuestionHash: hash },
              validVocabulary: existing.validVocabulary.locked
                ? existing.validVocabulary
                : { ...existing.validVocabulary, basedOnQuestionHash: hash },
              scoringLevels: existing.scoringLevels.locked
                ? existing.scoringLevels
                : { ...existing.scoringLevels, basedOnQuestionHash: hash },
            };
          } else {
            updated[p.id] = defaultQuestionMeta(hash);
          }
        });
        return updated;
      });

      setHasChanges(false);
      showSuccess("Lesson saved successfully");

      // Record edit patterns for preference learning (only if there were edits)
      if (editedQuestionIds.size > 0 && isNewlyCreated) {
        const originalQuestions: string[] = [];
        const editedQuestions: string[] = [];

        reconciledLesson.prompts.forEach((p: Prompt) => {
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
      const hintsPerQuestion = reconciledLesson.prompts.map((p: Prompt) => p.hints.length);
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

  // Per-question regenerating state
  const [regeneratingQuestionId, setRegeneratingQuestionId] = useState<string | null>(null);

  const handleRegeneratePackage = async (
    questionId: string,
    regenerate: { question: boolean; hints: boolean; mastery: boolean }
  ) => {
    if (!lesson) return;
    const prompt = lesson.prompts.find(p => p.id === questionId);
    if (!prompt) return;

    const meta = getQuestionMeta(questionId, prompt.input);

    // Save undo snapshot
    undoRef.current = { questionId, prompt: { ...prompt }, meta: { ...meta } };

    setRegeneratingQuestionId(questionId);
    try {
      const pkg = await generateQuestionPackage({
        questionText: prompt.input,
        lessonContext: `${lesson.title}: ${lesson.description}`,
        gradeLevel: lesson.gradeLevel,
        subject: lesson.subject,
        difficulty: lesson.difficulty,
        lessonDescription: lesson.description,
        existingQuestions: lesson.prompts.filter(p => p.id !== questionId).map(p => p.input),
        regenerate,
      });

      const newHash = questionHash(pkg.questionText);
      const updates: Partial<Prompt> = {};
      const metaUpdates: Partial<QuestionMeta> = {};

      // Apply question text
      if (regenerate.question) {
        updates.input = pkg.questionText;
      }

      // Apply hints (only if not locked)
      if (regenerate.hints && !meta.hints.locked && pkg.hints.length > 0) {
        updates.hints = pkg.hints;
        metaUpdates.hints = { source: "ai", locked: false, basedOnQuestionHash: newHash };
      }

      // Apply mastery fields (only if not locked)
      const assessmentUpdates: Partial<PromptAssessment> = {};
      if (regenerate.mastery) {
        if (!meta.objective.locked && pkg.learningObjective) {
          assessmentUpdates.learningObjective = pkg.learningObjective;
          metaUpdates.objective = { source: "ai", locked: false, basedOnQuestionHash: newHash };
        }
        if (!meta.criteria.locked && pkg.successCriteria) {
          assessmentUpdates.successCriteria = pkg.successCriteria;
          metaUpdates.criteria = { source: "ai", locked: false, basedOnQuestionHash: newHash };
        }
        if (!meta.misconceptions.locked && pkg.misconceptions) {
          assessmentUpdates.misconceptions = pkg.misconceptions;
          metaUpdates.misconceptions = { source: "ai", locked: false, basedOnQuestionHash: newHash };
        }
        if (pkg.evaluationFocus) {
          assessmentUpdates.evaluationFocus = pkg.evaluationFocus as EvaluationFocusArea[];
        }
      }

      if (Object.keys(assessmentUpdates).length > 0) {
        updates.assessment = { ...(prompt.assessment || {}), ...assessmentUpdates };
      }

      // Apply updates
      updateQuestion(questionId, updates);

      // Update metas
      setQuestionMetas(prev => ({
        ...prev,
        [questionId]: {
          ...getQuestionMeta(questionId, prompt.input),
          ...metaUpdates,
          // If question regenerated, update all non-locked hashes
          ...(regenerate.question ? {
            hints: metaUpdates.hints || { ...meta.hints, basedOnQuestionHash: meta.hints.locked ? meta.hints.basedOnQuestionHash : newHash },
            objective: metaUpdates.objective || { ...meta.objective, basedOnQuestionHash: meta.objective.locked ? meta.objective.basedOnQuestionHash : newHash },
            criteria: metaUpdates.criteria || { ...meta.criteria, basedOnQuestionHash: meta.criteria.locked ? meta.criteria.basedOnQuestionHash : newHash },
            misconceptions: metaUpdates.misconceptions || { ...meta.misconceptions, basedOnQuestionHash: meta.misconceptions.locked ? meta.misconceptions.basedOnQuestionHash : newHash },
          } : {}),
        },
      }));

      const lockedSections = [
        meta.hints.locked && regenerate.hints ? "hints" : null,
        meta.objective.locked && regenerate.mastery ? "objective" : null,
        meta.criteria.locked && regenerate.mastery ? "criteria" : null,
        meta.misconceptions.locked && regenerate.mastery ? "misconceptions" : null,
      ].filter(Boolean);

      const msg = regenerate.question
        ? "Question regenerated — hints & mastery updated"
        : "Hints & mastery updated";
      showSuccess(lockedSections.length > 0
        ? `${msg} (${lockedSections.join(", ")} locked — kept unchanged)`
        : msg
      );
    } catch (err) {
      console.error("Failed to regenerate:", err);
      showError("Failed to regenerate. Please try again.");
    } finally {
      setRegeneratingQuestionId(null);
    }
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
        <EducatorAppHeader mode="focus" title="Lesson not found" backLink="/educator" />
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
      <EducatorAppHeader
        mode="focus"
        title={assignmentSummary && assignmentSummary.totalAssigned > 0 ? "Edit Lesson" : lesson.title}
        backLink={assignmentSummary && assignmentSummary.totalAssigned > 0 ? `/educator/assignment/${lessonId}` : "/educator"}
        backLabel={assignmentSummary && assignmentSummary.totalAssigned > 0 ? lesson.title : "Home"}
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
                border: "2px solid #d1d5db",
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
                e.currentTarget.style.background = "rgba(0,0,0,0.04)";
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
              <span className="edit-icon" style={{ marginLeft: "8px", fontSize: "0.8rem", color: "var(--text-muted)", opacity: 0, transition: "opacity 0.15s" }}>✎</span>
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
                  border: "1px solid #d1d5db",
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
                  background: lesson.subject ? "rgba(0,0,0,0.06)" : "rgba(0,0,0,0.04)",
                  color: lesson.subject ? "#1e293b" : "var(--text-muted)",
                  borderRadius: "4px",
                  border: "none",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(0,0,0,0.08)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = lesson.subject ? "rgba(0,0,0,0.06)" : "rgba(0,0,0,0.04)";
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
                  border: "1px solid #d1d5db",
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
                  background: lesson.gradeLevel ? "rgba(0,0,0,0.06)" : "rgba(0,0,0,0.04)",
                  color: lesson.gradeLevel ? "#1e293b" : "var(--text-muted)",
                  borderRadius: "4px",
                  border: "none",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(0,0,0,0.08)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = lesson.gradeLevel ? "rgba(0,0,0,0.06)" : "rgba(0,0,0,0.04)";
                }}
                title="Click to edit grade level"
              >
                {lesson.gradeLevel || "+ Grade"}<span style={{ opacity: 0, marginLeft: "4px", transition: "opacity 0.15s" }}>✎</span>
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
              background: hasChanges ? "#ffffff" : "#e5e7eb",
              color: hasChanges ? "#4a5568" : "#64748b",
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
                e.currentTarget.style.background = "#ffffff";
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
                background: "#ffffff",
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
                e.currentTarget.style.background = "#ffffff";
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
                  background: "#ffffff",
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
                  e.currentTarget.style.background = "#ffffff";
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
                  background: "transparent",
                  color: "#dc2626",
                  border: "1px solid #fca5a5",
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
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "#dc2626";
                  e.currentTarget.style.borderColor = "#fca5a5";
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
            <span style={{ fontSize: "0.75rem", fontWeight: 500, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Questions
            </span>
            <span style={{
              fontSize: "0.75rem",
              fontWeight: 600,
              color: "#1e293b",
              background: "rgba(0,0,0,0.06)",
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
              background: "#ffffff",
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
              e.currentTarget.style.background = "#ffffff";
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
              lesson={lesson}
              meta={getQuestionMeta(prompt.id, prompt.input)}
              onToggle={() =>
                setExpandedQuestion(expandedQuestion === prompt.id ? null : prompt.id)
              }
              onUpdateQuestion={(updates) => updateQuestion(prompt.id, updates)}
              onUpdateHint={(hintIndex, newHint) => {
                updateHint(prompt.id, hintIndex, newHint);
                updateBlockMeta(prompt.id, "hints", { source: "teacher", locked: true });
              }}
              onAddHint={() => addHint(prompt.id)}
              onRemoveHint={(hintIndex) => removeHint(prompt.id, hintIndex)}
              onRemove={() => removeQuestion(prompt.id)}
              onBlockMetaUpdate={(section, updates) => updateBlockMeta(prompt.id, section, updates)}
              onRegeneratePackage={(regenerate) => handleRegeneratePackage(prompt.id, regenerate)}
              regeneratingPackage={regeneratingQuestionId === prompt.id}
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
                  color: deleting ? "var(--text-muted)" : "white",
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

      {/* Unsaved changes warning + stale fields notice */}
      {(hasChanges || hasStaleBlocks()) && (
        <div
          style={{
            position: "fixed",
            bottom: "20px",
            right: "20px",
            padding: "12px 20px",
            background: "white",
            border: `1px solid ${hasStaleBlocks() ? "#fbbf24" : "var(--border-subtle)"}`,
            borderRadius: "8px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            display: "flex",
            alignItems: "center",
            gap: "12px",
            flexWrap: "wrap",
            maxWidth: "420px",
          }}
        >
          {hasStaleBlocks() && (
            <span style={{ color: "#92400e", fontSize: "0.8rem", display: "flex", alignItems: "center", gap: "4px" }}>
              <span style={{ fontSize: "0.9rem" }}>⚠</span> Some fields are out of date
            </span>
          )}
          {hasChanges && (
            <>
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
            </>
          )}
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
  lesson: Lesson | null;
  meta: QuestionMeta;
  onToggle: () => void;
  onUpdateQuestion: (updates: Partial<Prompt>) => void;
  onUpdateHint: (hintIndex: number, newHint: string) => void;
  onAddHint: () => void;
  onRemoveHint: (hintIndex: number) => void;
  onRemove: () => void;
  onBlockMetaUpdate: (section: SectionKey, updates: Partial<BlockMeta>) => void;
  onRegeneratePackage: (regenerate: { question: boolean; hints: boolean; mastery: boolean }) => Promise<void>;
  regeneratingPackage: boolean;
}

function QuestionEditor({
  prompt,
  index,
  isExpanded,
  isAIGenerated,
  lesson,
  meta,
  onToggle,
  onUpdateQuestion,
  onUpdateHint,
  onAddHint,
  onRemoveHint,
  onRemove,
  onBlockMetaUpdate,
  onRegeneratePackage,
  regeneratingPackage,
}: QuestionEditorProps) {
  const [editingInput, setEditingInput] = useState(false);

  const currentHash = questionHash(prompt.input);

  // Derive staleness per section
  const hintsStale = meta.hints.basedOnQuestionHash !== currentHash;
  const masteryStale = (
    meta.objective.basedOnQuestionHash !== currentHash ||
    meta.criteria.basedOnQuestionHash !== currentHash ||
    meta.misconceptions.basedOnQuestionHash !== currentHash
  );
  const anyStale = hintsStale || masteryStale;

  // Track the question text at last assessment generation to detect outdated state
  const lastGeneratedInputRef = useRef<string | null>(
    prompt.assessment?.learningObjective ? prompt.input : null
  );

  // Derive whether assessment is outdated (question changed since generation)
  const isOutdated = masteryStale || (
    lastGeneratedInputRef.current !== null &&
    lastGeneratedInputRef.current !== prompt.input &&
    hasAssessmentContent(prompt.assessment)
  );

  const handleQuestionEdit = (value: string) => {
    onUpdateQuestion({ input: value });
  };

  /** Lock toggle for a section */
  const toggleLock = (section: SectionKey) => {
    onBlockMetaUpdate(section, { locked: !meta[section].locked });
  };

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
            {anyStale && (
              <span style={{
                fontSize: "0.65rem", fontWeight: 500, color: "#d97706",
                background: "#fef3c7", padding: "1px 7px", borderRadius: "3px",
              }}>
                Needs update
              </span>
            )}
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
          {/* Collapsed preview: objective + focus tags */}
          {!isExpanded && prompt.assessment?.learningObjective && (
            <div style={{ marginTop: "6px", display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <span style={{
                fontSize: "0.75rem",
                color: "var(--text-muted)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: "350px",
              }}>
                Objective: {prompt.assessment.learningObjective}
              </span>
              {prompt.assessment.evaluationFocus?.map((f) => (
                <span
                  key={f}
                  style={{
                    fontSize: "0.65rem",
                    padding: "1px 6px",
                    background: "#ede9fe",
                    color: "#6d28d9",
                    borderRadius: "3px",
                    fontWeight: 500,
                    textTransform: "capitalize",
                  }}
                >
                  {f}
                </span>
              ))}
            </div>
          )}
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
          {/* Edit Question + Regenerate Question button */}
          <div style={{ marginTop: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <label style={{ fontSize: "0.85rem", fontWeight: 500, color: "var(--text-muted)" }}>
                Question Text
              </label>
              <button
                onClick={() => onRegeneratePackage({ question: true, hints: true, mastery: true })}
                disabled={regeneratingPackage}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  padding: "3px 10px",
                  background: "transparent",
                  color: "#8b5cf6",
                  border: "1px solid #c4b5fd",
                  borderRadius: "5px",
                  cursor: regeneratingPackage ? "not-allowed" : "pointer",
                  fontSize: "0.75rem",
                  fontWeight: 500,
                  opacity: regeneratingPackage ? 0.6 : 1,
                  transition: "all 0.15s",
                }}
                onMouseEnter={(e) => { if (!regeneratingPackage) e.currentTarget.style.background = "#f3e8ff"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                title="Generate a new question with fresh hints and mastery criteria"
              >
                {regeneratingPackage ? "Regenerating..." : "↻ Regenerate Question"}
              </button>
            </div>
            {editingInput ? (
              <textarea
                value={prompt.input}
                onChange={(e) => handleQuestionEdit(e.target.value)}
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

          {/* Stale banner + "Update hints & mastery" button */}
          {anyStale && !regeneratingPackage && (
            <div style={{
              marginTop: "12px",
              padding: "10px 14px",
              background: "#fef3c7",
              border: "1px solid #fbbf24",
              borderRadius: "8px",
              display: "flex",
              alignItems: "center",
              gap: "10px",
              flexWrap: "wrap",
            }}>
              <div style={{ flex: 1, minWidth: "180px" }}>
                <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "#92400e" }}>
                  Fields out of date
                </div>
                <div style={{ fontSize: "0.75rem", color: "#a16207", marginTop: "2px" }}>
                  {[hintsStale && "Hints", masteryStale && "Mastery"].filter(Boolean).join(" & ")} may not match the current question.
                </div>
              </div>
              <button
                onClick={() => onRegeneratePackage({ question: false, hints: hintsStale, mastery: masteryStale })}
                style={{
                  padding: "6px 14px",
                  background: "#d97706",
                  color: "white",
                  border: "none",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontSize: "0.8rem",
                  fontWeight: 500,
                  whiteSpace: "nowrap",
                }}
              >
                Update hints & mastery
              </button>
            </div>
          )}

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
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <label style={{ fontSize: "0.85rem", fontWeight: 500, color: "var(--text-muted)" }}>
                  Hints ({prompt.hints.length})
                </label>
                {hintsStale && (
                  <span style={{
                    fontSize: "0.65rem", fontWeight: 500, color: "#d97706",
                    background: "#fef3c7", padding: "1px 6px", borderRadius: "3px",
                  }}>
                    Out of date
                  </span>
                )}
                <LockButton locked={meta.hints.locked} onToggle={() => toggleLock("hints")} />
              </div>
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

          {/* Assessment & Mastery Settings — with lock icons */}
          <AssessmentPanel
            assessment={prompt.assessment}
            questionText={prompt.input}
            lesson={lesson}
            isOutdated={isOutdated}
            meta={meta}
            onUpdate={(assessment) => onUpdateQuestion({ assessment })}
            onGenerated={(inputAtGeneration) => {
              lastGeneratedInputRef.current = inputAtGeneration;
            }}
            onBlockMetaUpdate={onBlockMetaUpdate}
          />

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
// Assessment & Mastery Settings Panel
// ============================================

/** Check whether assessment has any populated content. */
function hasAssessmentContent(assessment?: PromptAssessment): boolean {
  if (!assessment) return false;
  return !!(
    assessment.learningObjective ||
    (assessment.expectedConcepts && assessment.expectedConcepts.length > 0) ||
    assessment.requiredExamples ||
    (assessment.validVocabulary && assessment.validVocabulary.length > 0) ||
    (assessment.misconceptions && assessment.misconceptions.length > 0) ||
    assessment.scoringLevels ||
    (assessment.successCriteria && assessment.successCriteria.length > 0) ||
    (assessment.evaluationFocus && assessment.evaluationFocus.length > 0)
  );
}

type AssessmentStatus = "draft" | "generating" | "ready" | "edited" | "error" | "outdated";

const STATUS_BADGE: Record<AssessmentStatus, { label: string; color: string; bg: string }> = {
  draft:      { label: "Draft",      color: "#64748b", bg: "#f1f5f9" },
  generating: { label: "Generating", color: "#8b5cf6", bg: "#f3e8ff" },
  ready:      { label: "Ready",      color: "#16a34a", bg: "#dcfce7" },
  edited:     { label: "Reviewed",   color: "#0369a1", bg: "#e0f2fe" },
  error:      { label: "Error",      color: "#dc2626", bg: "#fee2e2" },
  outdated:   { label: "Outdated",   color: "#d97706", bg: "#fef3c7" },
};

const EVALUATION_FOCUS_OPTIONS: { value: EvaluationFocusArea; label: string; description: string }[] = [
  { value: "understanding", label: "Understanding", description: "Shows grasp of core concepts" },
  { value: "reasoning", label: "Reasoning", description: "Explains why or how" },
  { value: "evidence", label: "Evidence", description: "Uses details or examples" },
  { value: "clarity", label: "Clarity", description: "Communicates ideas clearly" },
  { value: "creativity", label: "Creativity", description: "Shows original thinking" },
];

interface AssessmentPanelProps {
  assessment?: PromptAssessment;
  questionText: string;
  lesson: Lesson | null;
  isOutdated: boolean;
  meta: QuestionMeta;
  onUpdate: (assessment: PromptAssessment) => void;
  /** Called after AI generation succeeds with the question text at generation time. */
  onGenerated: (inputAtGeneration: string) => void;
  onBlockMetaUpdate: (section: SectionKey, updates: Partial<BlockMeta>) => void;
}

function AssessmentPanel({ assessment, questionText, lesson, isOutdated, meta, onUpdate, onGenerated, onBlockMetaUpdate }: AssessmentPanelProps) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(false);
  const [teacherEdited, setTeacherEdited] = useState(false);
  const hasAutoGeneratedRef = useRef(false);

  const current: PromptAssessment = assessment || {};
  const hasContent = hasAssessmentContent(assessment);

  // Derive status
  let status: AssessmentStatus = "draft";
  if (generating) status = "generating";
  else if (error) status = "error";
  else if (isOutdated) status = "outdated";
  else if (teacherEdited) status = "edited";
  else if (hasContent) status = "ready";

  const badge = STATUS_BADGE[status];

  const updateField = <K extends keyof PromptAssessment>(key: K, value: PromptAssessment[K]) => {
    setTeacherEdited(true);
    onUpdate({ ...current, [key]: value });
    // Auto-lock the section when teacher edits
    const sectionMap: Record<string, SectionKey> = {
      learningObjective: "objective",
      successCriteria: "criteria",
      misconceptions: "misconceptions",
      expectedConcepts: "expectedConcepts",
      requiredExamples: "requiredExamples",
      validVocabulary: "validVocabulary",
      scoringLevels: "scoringLevels",
    };
    const section = sectionMap[key];
    if (section) {
      onBlockMetaUpdate(section, { source: "teacher", locked: true });
    }
  };

  const doGenerate = async () => {
    if (!lesson) return;
    setGenerating(true);
    setError(false);
    try {
      const generated = await generateAssessment(
        questionText,
        `${lesson.title}: ${lesson.description}`,
        {
          subject: lesson.subject,
          gradeLevel: lesson.gradeLevel,
          difficulty: lesson.difficulty,
          lessonDescription: lesson.description,
        }
      );
      onUpdate({ ...current, ...generated });
      onGenerated(questionText);
      setTeacherEdited(false);
    } catch (err) {
      console.error("Failed to generate assessment:", err);
      setError(true);
    } finally {
      setGenerating(false);
    }
  };

  const handleRegenerate = () => {
    if (teacherEdited && !window.confirm("Regenerating will overwrite your edits. Continue?")) {
      return;
    }
    doGenerate();
  };

  // Auto-generate on first mount if assessment is empty
  useEffect(() => {
    if (hasAutoGeneratedRef.current) return;
    if (hasContent) return; // already has data
    if (generating) return;
    if (!lesson) return;
    if (!questionText.trim()) return;
    hasAutoGeneratedRef.current = true;
    doGenerate();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{
      marginTop: "16px",
      padding: "16px",
      background: "var(--surface-elevated)",
      border: "1px solid var(--border-muted)",
      borderRadius: "8px",
    }}>
      {/* Header row: title + status badge + regenerate */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        marginBottom: generating ? "12px" : hasContent || error ? "12px" : "0",
      }}>
        <span style={{ fontSize: "0.85rem", fontWeight: 500, color: "var(--text-secondary)" }}>
          Assessment & Mastery
        </span>
        <span style={{
          fontSize: "0.65rem",
          fontWeight: 500,
          color: badge.color,
          background: badge.bg,
          padding: "1px 7px",
          borderRadius: "4px",
        }}>
          {badge.label}
        </span>
        <span style={{ flex: 1 }} />
        {/* Regenerate / Update criteria button */}
        {!generating && (
          <button
            onClick={handleRegenerate}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              padding: "3px 10px",
              background: "transparent",
              color: isOutdated ? "#d97706" : "#8b5cf6",
              border: `1px solid ${isOutdated ? "#fbbf24" : "#c4b5fd"}`,
              borderRadius: "5px",
              cursor: "pointer",
              fontSize: "0.75rem",
              fontWeight: 500,
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = isOutdated ? "#fef3c7" : "#f3e8ff";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
            title={isOutdated ? "Question text changed — update assessment criteria" : "Regenerate assessment with AI"}
          >
            ↻ {isOutdated ? "Update criteria" : "Regenerate"}
          </button>
        )}
      </div>

      {/* Generating skeleton */}
      {generating && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {[120, 200, 160].map((w, i) => (
            <div key={i} style={{
              height: "14px",
              width: `${w}px`,
              maxWidth: "100%",
              background: "linear-gradient(90deg, var(--border-muted) 25%, var(--surface-accent) 50%, var(--border-muted) 75%)",
              backgroundSize: "200% 100%",
              animation: "shimmer 1.5s infinite",
              borderRadius: "4px",
            }} />
          ))}
          <style>{`@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
          <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Generating assessment...</span>
        </div>
      )}

      {/* Error state with retry */}
      {error && !generating && (
        <div style={{
          padding: "10px 12px",
          background: "#fee2e2",
          borderRadius: "6px",
          fontSize: "0.8rem",
          color: "#dc2626",
          display: "flex",
          alignItems: "center",
          gap: "8px",
        }}>
          <span>Failed to generate assessment.</span>
          <button
            onClick={doGenerate}
            style={{
              padding: "2px 8px",
              background: "transparent",
              color: "#dc2626",
              border: "1px solid #fca5a5",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "0.75rem",
              fontWeight: 500,
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Fields — shown when not generating */}
      {!generating && (hasContent || (!error && status === "draft")) && (
        <div>
          {/* Outdated banner */}
          {isOutdated && (
            <div style={{
              padding: "8px 12px",
              background: "#fef3c7",
              borderRadius: "6px",
              fontSize: "0.8rem",
              color: "#92400e",
              marginBottom: "12px",
            }}>
              Question text has changed since these criteria were generated. Click "Update criteria" to refresh.
            </div>
          )}

          {/* Learning Objective */}
          <div style={{ marginBottom: "14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
              <label style={{ fontSize: "0.8rem", fontWeight: 500, color: "var(--text-muted)" }}>
                Learning Objective
              </label>
              <LockButton locked={meta.objective.locked} onToggle={() => onBlockMetaUpdate("objective", { locked: !meta.objective.locked })} />
            </div>
            <textarea
              value={current.learningObjective || ""}
              onChange={(e) => updateField("learningObjective", e.target.value || undefined)}
              placeholder="What should the student understand or be able to do?"
              rows={2}
              style={{
                width: "100%",
                padding: "8px 10px",
                border: "1px solid var(--border-subtle)",
                borderRadius: "6px",
                fontSize: "0.85rem",
                resize: "vertical",
                fontFamily: "inherit",
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* Expected Concepts */}
          <div style={{ marginBottom: "14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <label style={{ fontSize: "0.8rem", fontWeight: 500, color: "var(--text-muted)" }}>
                  Expected Concepts
                </label>
                <LockButton locked={meta.expectedConcepts.locked} onToggle={() => onBlockMetaUpdate("expectedConcepts", { locked: !meta.expectedConcepts.locked })} />
              </div>
              <button
                onClick={() => updateField("expectedConcepts", [...(current.expectedConcepts || []), ""])}
                style={{
                  padding: "2px 8px",
                  background: "var(--accent-primary)",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontSize: "0.75rem",
                }}
              >
                + Add
              </button>
            </div>
            <BulletListEditor
              items={current.expectedConcepts || []}
              placeholder="e.g., Planets can be made of different materials"
              onChange={(items) => updateField("expectedConcepts", items.length > 0 ? items : undefined)}
            />
          </div>

          {/* Required Examples */}
          <div style={{ marginBottom: "14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
              <label style={{ fontSize: "0.8rem", fontWeight: 500, color: "var(--text-muted)" }}>
                Required Examples
              </label>
              <LockButton locked={meta.requiredExamples.locked} onToggle={() => onBlockMetaUpdate("requiredExamples", { locked: !meta.requiredExamples.locked })} />
            </div>
            <textarea
              value={current.requiredExamples || ""}
              onChange={(e) => updateField("requiredExamples", e.target.value || undefined)}
              placeholder="e.g., Student must name at least two planets and describe what they are made of"
              rows={2}
              style={{
                width: "100%",
                padding: "8px 10px",
                border: "1px solid var(--border-subtle)",
                borderRadius: "6px",
                fontSize: "0.85rem",
                resize: "vertical",
                fontFamily: "inherit",
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* Valid Vocabulary */}
          <div style={{ marginBottom: "14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <label style={{ fontSize: "0.8rem", fontWeight: 500, color: "var(--text-muted)" }}>
                  Valid Vocabulary
                </label>
                <LockButton locked={meta.validVocabulary.locked} onToggle={() => onBlockMetaUpdate("validVocabulary", { locked: !meta.validVocabulary.locked })} />
              </div>
              <button
                onClick={() => updateField("validVocabulary", [...(current.validVocabulary || []), ""])}
                style={{
                  padding: "2px 8px",
                  background: "var(--accent-primary)",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontSize: "0.75rem",
                }}
              >
                + Add
              </button>
            </div>
            <BulletListEditor
              items={current.validVocabulary || []}
              placeholder="e.g., rocky planet, gas giant, ice giant"
              onChange={(items) => updateField("validVocabulary", items.length > 0 ? items : undefined)}
            />
          </div>

          {/* Success Criteria (auto-derived, editable override) */}
          <div style={{ marginBottom: "14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <label style={{ fontSize: "0.8rem", fontWeight: 500, color: "var(--text-muted)" }}>
                  Success Criteria
                </label>
                <LockButton locked={meta.criteria.locked} onToggle={() => onBlockMetaUpdate("criteria", { locked: !meta.criteria.locked })} />
              </div>
              <button
                onClick={() => updateField("successCriteria", [...(current.successCriteria || []), ""])}
                style={{
                  padding: "2px 8px",
                  background: "var(--accent-primary)",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontSize: "0.75rem",
                }}
              >
                + Add
              </button>
            </div>
            <BulletListEditor
              items={current.successCriteria || []}
              placeholder="e.g., Names at least 2 specific effects"
              onChange={(items) => updateField("successCriteria", items.length > 0 ? items : undefined)}
            />
          </div>

          {/* Misconceptions */}
          <div style={{ marginBottom: "14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <label style={{ fontSize: "0.8rem", fontWeight: 500, color: "var(--text-muted)" }}>
                  Common Misconceptions
                </label>
                <LockButton locked={meta.misconceptions.locked} onToggle={() => onBlockMetaUpdate("misconceptions", { locked: !meta.misconceptions.locked })} />
              </div>
              <button
                onClick={() => updateField("misconceptions", [...(current.misconceptions || []), ""])}
                style={{
                  padding: "2px 8px",
                  background: "var(--accent-primary)",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontSize: "0.75rem",
                }}
              >
                + Add
              </button>
            </div>
            <BulletListEditor
              items={current.misconceptions || []}
              placeholder="e.g., Thinks the sun moves around the Earth"
              onChange={(items) => updateField("misconceptions", items.length > 0 ? items : undefined)}
            />
          </div>

          {/* Scoring Levels */}
          <div style={{ marginBottom: "14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
              <label style={{ fontSize: "0.8rem", fontWeight: 500, color: "var(--text-muted)" }}>
                Scoring Levels
              </label>
              <LockButton locked={meta.scoringLevels.locked} onToggle={() => onBlockMetaUpdate("scoringLevels", { locked: !meta.scoringLevels.locked })} />
            </div>
            {(["strong", "developing", "needsSupport"] as const).map((level) => {
              const labels = { strong: "Strong", developing: "Developing", needsSupport: "Needs Support" };
              const colors = { strong: "#16a34a", developing: "#d97706", needsSupport: "#dc2626" };
              return (
                <div key={level} style={{ marginBottom: level === "needsSupport" ? "0" : "8px" }}>
                  <label style={{
                    display: "block",
                    fontSize: "0.75rem",
                    fontWeight: 500,
                    color: colors[level],
                    marginBottom: "2px",
                  }}>
                    {labels[level]}
                  </label>
                  <textarea
                    value={current.scoringLevels?.[level] || ""}
                    onChange={(e) => {
                      const updated = {
                        strong: current.scoringLevels?.strong || "",
                        developing: current.scoringLevels?.developing || "",
                        needsSupport: current.scoringLevels?.needsSupport || "",
                        [level]: e.target.value,
                      };
                      updateField("scoringLevels", updated.strong || updated.developing || updated.needsSupport ? updated : undefined);
                    }}
                    placeholder={
                      level === "strong"
                        ? "e.g., Names 2 planets and correctly describes their materials"
                        : level === "developing"
                        ? "e.g., Names planets but one description is incorrect OR only 1 example"
                        : "e.g., Incorrect materials, unrelated content, or no examples"
                    }
                    rows={1}
                    style={{
                      width: "100%",
                      padding: "6px 10px",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: "6px",
                      fontSize: "0.82rem",
                      resize: "vertical",
                      fontFamily: "inherit",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              );
            })}
          </div>

          {/* Evaluation Focus */}
          <div>
            <label style={{
              display: "block",
              fontSize: "0.8rem",
              fontWeight: 500,
              color: "var(--text-muted)",
              marginBottom: "6px",
            }}>
              Evaluation Focus
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              {EVALUATION_FOCUS_OPTIONS.map((opt) => {
                const checked = (current.evaluationFocus || []).includes(opt.value);
                return (
                  <label
                    key={opt.value}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "6px 10px",
                      background: checked ? "#ede9fe" : "var(--surface-elevated)",
                      border: `1px solid ${checked ? "#8b5cf6" : "var(--border-muted)"}`,
                      borderRadius: "6px",
                      cursor: "pointer",
                      fontSize: "0.8rem",
                      color: checked ? "#6d28d9" : "var(--text-secondary)",
                      fontWeight: checked ? 500 : 400,
                      transition: "all 0.15s",
                    }}
                    title={opt.description}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        const currentFocus = current.evaluationFocus || [];
                        const updated = checked
                          ? currentFocus.filter((f) => f !== opt.value)
                          : [...currentFocus, opt.value];
                        updateField("evaluationFocus", updated.length > 0 ? updated : undefined);
                      }}
                      style={{ display: "none" }}
                    />
                    <span style={{
                      width: "14px",
                      height: "14px",
                      borderRadius: "3px",
                      border: `1.5px solid ${checked ? "#8b5cf6" : "var(--border-muted)"}`,
                      background: checked ? "#8b5cf6" : "transparent",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}>
                      {checked && (
                        <span style={{ color: "white", fontSize: "0.6rem", fontWeight: 700 }}>✓</span>
                      )}
                    </span>
                    {opt.label}
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// Bullet List Editor (for success criteria / misconceptions)
// ============================================

interface BulletListEditorProps {
  items: string[];
  placeholder: string;
  onChange: (items: string[]) => void;
}

function BulletListEditor({ items, placeholder, onChange }: BulletListEditorProps) {
  if (items.length === 0) {
    return (
      <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--text-muted)", fontStyle: "italic" }}>
        None yet. Click "+ Add" to add one.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      {items.map((item, i) => (
        <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "6px" }}>
          <span style={{
            flexShrink: 0,
            marginTop: "8px",
            width: "5px",
            height: "5px",
            borderRadius: "50%",
            background: "var(--text-muted)",
          }} />
          <input
            type="text"
            value={item}
            onChange={(e) => {
              const updated = [...items];
              updated[i] = e.target.value;
              onChange(updated);
            }}
            placeholder={placeholder}
            style={{
              flex: 1,
              padding: "6px 8px",
              border: "1px solid var(--border-subtle)",
              borderRadius: "4px",
              fontSize: "0.8rem",
              boxSizing: "border-box",
            }}
          />
          <button
            onClick={() => onChange(items.filter((_, idx) => idx !== i))}
            style={{
              padding: "4px 6px",
              background: "transparent",
              color: "var(--text-muted)",
              border: "none",
              cursor: "pointer",
              fontSize: "0.75rem",
              borderRadius: "4px",
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--status-danger)";
              e.currentTarget.style.background = "var(--status-danger-bg)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--text-muted)";
              e.currentTarget.style.background = "transparent";
            }}
            title="Remove"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

// ============================================
// Lock Button Component
// ============================================

function LockButton({ locked, onToggle }: { locked: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      title={locked ? "Locked — regeneration won't overwrite this section. Click to unlock." : "Unlocked — regeneration will update this section. Click to lock."}
      style={{
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: "1px 3px",
        fontSize: "0.7rem",
        color: locked ? "#d97706" : "var(--text-muted)",
        opacity: locked ? 1 : 0.5,
        transition: "all 0.15s",
        borderRadius: "3px",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.background = locked ? "#fef3c7" : "var(--surface-accent)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.opacity = locked ? "1" : "0.5"; e.currentTarget.style.background = "none"; }}
    >
      {locked ? "🔒" : "🔓"}
    </button>
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
