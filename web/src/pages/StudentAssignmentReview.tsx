/**
 * Student Assignment Review (Drilldown)
 *
 * Design Philosophy:
 * - Teacher notes are primary, always visible at top
 * - Questions collapsed by default to reduce cognitive load
 * - Learning journey insights before raw transcripts
 * - Expand only what you need
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import {
  getLesson,
  getSessions,
  getStudent,
  updateSession,
  getStudentAssignment,
  markStudentReviewed,
  pushAssignmentToStudent,
  undoReassignment,
  type Session,
  type Lesson,
  type Student,
  type StudentAssignment,
} from "../services/api";
import { useToast } from "../components/Toast";
import {
  buildStudentDrilldown,
  getUnderstandingLabel,
  getUnderstandingColor,
  getUnderstandingBgColor,
  getCoachSupportLabel,
  getQuestionOutcomeLabel,
  getAttentionReasonDisplay,
  calculateQuestionOutcome,
} from "../utils/teacherDashboardUtils";
import type { StudentDrilldownData, QuestionOutcome } from "../types/teacherDashboard";

// Type for a single attempt at a question
interface QuestionAttempt {
  sessionId: string;
  attemptNumber: number;
  sessionDate: string;
  response: string;
  outcome: QuestionOutcome;
  usedHint: boolean;
  hasVoiceRecording: boolean;
  audioBase64?: string;
  audioFormat?: string;
  score?: number;
  educatorNote?: string;
}

// Type for a question with all attempts across sessions
interface QuestionWithAttempts {
  questionId: string;
  questionNumber: number;
  questionText: string;
  totalHintsAvailable: number;
  attempts: QuestionAttempt[];
}

export default function StudentAssignmentReview() {
  const { lessonId, studentId } = useParams<{ lessonId: string; studentId: string }>();
  const { showSuccess, showError } = useToast();

  const [drilldown, setDrilldown] = useState<StudentDrilldownData | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [questionsWithAttempts, setQuestionsWithAttempts] = useState<QuestionWithAttempts[]>([]);
  const [student, setStudent] = useState<Student | null>(null);
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [assignment, setAssignment] = useState<StudentAssignment | null>(null);
  const [loading, setLoading] = useState(true);

  // Notes state
  const [teacherNote, setTeacherNote] = useState("");
  const [questionNotes, setQuestionNotes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Action states
  const [isPushing, setIsPushing] = useState(false);
  const [isMarkingReviewed, setIsMarkingReviewed] = useState(false);
  const [isUndoing, setIsUndoing] = useState(false);

  // Track if we just reassigned (for showing undo button)
  const [justReassigned, setJustReassigned] = useState(false);
  const [previousState, setPreviousState] = useState<{
    completedAt?: string;
    reviewedAt?: string;
  } | null>(null);

  // Expanded questions
  const [expandedQuestions, setExpandedQuestions] = useState<Set<string>>(new Set());

  // Audio playback
  const [playingQuestionId, setPlayingQuestionId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!lessonId || !studentId) return;

    async function loadData() {
      try {
        const [lessonData, sessions, studentData, assignmentData] = await Promise.all([
          getLesson(lessonId!),
          getSessions(studentId), // Get all sessions (not just completed)
          getStudent(studentId!),
          getStudentAssignment(lessonId!, studentId!).catch(() => null),
        ]);

        setAssignment(assignmentData);
        const typedLesson = lessonData as Lesson;
        setLesson(typedLesson);
        setStudent(studentData);

        // Filter sessions for this lesson and sort by date (newest first)
        const lessonSessions = sessions
          .filter((s) => s.lessonId === lessonId)
          .sort((a, b) => {
            const dateA = new Date(a.completedAt || a.startedAt).getTime();
            const dateB = new Date(b.completedAt || b.startedAt).getTime();
            return dateB - dateA; // Newest first
          });

        // Use the most recent session for the drilldown summary
        const latestSession = lessonSessions[0];

        if (latestSession) {
          setSession(latestSession);
          setTeacherNote(latestSession.educatorNotes || "");

          // Initialize question notes from the latest session
          const notesMap: Record<string, string> = {};
          latestSession.submission.responses.forEach((r) => {
            if (r.educatorNote) {
              notesMap[r.promptId] = r.educatorNote;
            }
          });
          setQuestionNotes(notesMap);

          // Build drilldown data from latest session
          const data = buildStudentDrilldown(latestSession, typedLesson);
          setDrilldown(data);

          // Build questions with all attempts grouped by question
          const questionsMap = new Map<string, QuestionWithAttempts>();

          // Initialize from lesson prompts (in order)
          typedLesson.prompts.forEach((prompt, index) => {
            questionsMap.set(prompt.id, {
              questionId: prompt.id,
              questionNumber: index + 1,
              questionText: prompt.input,
              totalHintsAvailable: prompt.hints.length,
              attempts: [],
            });
          });

          // Add attempts from all sessions (already sorted newest first)
          lessonSessions.forEach((sess, sessionIndex) => {
            const attemptNumber = lessonSessions.length - sessionIndex; // Oldest = 1, newest = N
            const sessionDate = sess.completedAt || sess.startedAt;

            sess.submission.responses.forEach((response) => {
              const question = questionsMap.get(response.promptId);
              if (question) {
                const criteriaScore = sess.evaluation?.criteriaScores?.find(
                  (c) => c.criterionId === response.promptId
                );
                const outcome = calculateQuestionOutcome(response, criteriaScore?.score);

                question.attempts.push({
                  sessionId: sess.id,
                  attemptNumber,
                  sessionDate,
                  response: response.response,
                  outcome,
                  usedHint: response.hintUsed ?? false,
                  hasVoiceRecording: !!response.audioBase64,
                  audioBase64: response.audioBase64,
                  audioFormat: response.audioFormat,
                  score: criteriaScore?.score,
                  educatorNote: response.educatorNote,
                });
              }
            });
          });

          // Convert map to array (sorted by question number)
          const questionsArray = Array.from(questionsMap.values())
            .filter((q) => q.attempts.length > 0); // Only show questions with at least one attempt

          setQuestionsWithAttempts(questionsArray);
        }
      } catch (err) {
        console.error("Failed to load student data:", err);
      } finally {
        setLoading(false);
      }
    }

    loadData();

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, [lessonId, studentId]);

  // Auto-save notes (and auto-mark as reviewed when notes are saved)
  const saveNotes = useCallback(async () => {
    if (!session || !lessonId || !studentId) return;

    setSaving(true);
    try {
      const updatedResponses = session.submission.responses.map((r) => ({
        ...r,
        educatorNote: questionNotes[r.promptId] || undefined,
      }));

      await updateSession(session.id, {
        educatorNotes: teacherNote || undefined,
        submission: {
          ...session.submission,
          responses: updatedResponses,
        },
      });

      // Auto-mark as reviewed when teacher adds notes
      if ((teacherNote && teacherNote.trim()) && assignment && !assignment.reviewedAt) {
        try {
          await markStudentReviewed(lessonId, studentId);
          setAssignment((prev) => prev ? { ...prev, reviewedAt: new Date().toISOString() } : null);
        } catch (err) {
          console.log("Failed to mark as reviewed:", err);
        }
      }

      setLastSaved(new Date());
    } catch (err) {
      console.error("Failed to save notes:", err);
    } finally {
      setSaving(false);
    }
  }, [session, lessonId, studentId, teacherNote, questionNotes, assignment]);

  const debouncedSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      saveNotes();
    }, 1000);
  }, [saveNotes]);

  // Reassign assignment to student
  const handleReassignToStudent = async () => {
    if (!lessonId || !studentId || !assignment) return;

    // Save previous state for undo
    setPreviousState({
      completedAt: assignment.completedAt,
      reviewedAt: assignment.reviewedAt,
    });

    setIsPushing(true);
    try {
      const result = await pushAssignmentToStudent(lessonId, studentId);
      setAssignment((prev) => prev ? {
        ...prev,
        completedAt: undefined,
        reviewedAt: undefined,
        attempts: result.attempts,
      } : null);
      setJustReassigned(true);
      showSuccess(`Reassigned to student (Attempt #${result.attempts})`);
    } catch (err) {
      console.error("Failed to reassign:", err);
      showError("Failed to reassign to student");
      setPreviousState(null);
    } finally {
      setIsPushing(false);
    }
  };

  // Undo reassignment
  const handleUndoReassignment = async () => {
    if (!lessonId || !studentId || !previousState) return;

    setIsUndoing(true);
    try {
      const result = await undoReassignment(
        lessonId,
        studentId,
        previousState.completedAt,
        previousState.reviewedAt
      );
      setAssignment((prev) => prev ? {
        ...prev,
        completedAt: result.completedAt,
        reviewedAt: result.reviewedAt,
        attempts: result.attempts,
      } : null);
      setJustReassigned(false);
      setPreviousState(null);
      showSuccess("Reassignment undone");
    } catch (err) {
      console.error("Failed to undo reassignment:", err);
      showError("Failed to undo reassignment");
    } finally {
      setIsUndoing(false);
    }
  };

  // Mark as reviewed
  const handleMarkReviewed = async () => {
    if (!lessonId || !studentId) return;

    setIsMarkingReviewed(true);
    try {
      await markStudentReviewed(lessonId, studentId);
      setAssignment((prev) => prev ? { ...prev, reviewedAt: new Date().toISOString() } : null);
    } catch (err) {
      console.error("Failed to mark as reviewed:", err);
    } finally {
      setIsMarkingReviewed(false);
    }
  };

  // Toggle question expansion
  const toggleQuestion = (questionId: string) => {
    setExpandedQuestions((prev) => {
      const next = new Set(prev);
      if (next.has(questionId)) {
        next.delete(questionId);
      } else {
        next.add(questionId);
      }
      return next;
    });
  };

  // Expand all questions
  const expandAll = () => {
    if (questionsWithAttempts.length > 0) {
      setExpandedQuestions(new Set(questionsWithAttempts.map((q) => q.questionId)));
    }
  };

  // Collapse all questions
  const collapseAll = () => {
    setExpandedQuestions(new Set());
  };

  // Play audio
  const playAudio = async (audioBase64: string, audioFormat: string, questionId: string) => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    if (playingQuestionId === questionId) {
      setPlayingQuestionId(null);
      return;
    }

    setPlayingQuestionId(questionId);

    try {
      const audioBlob = new Blob(
        [Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0))],
        { type: `audio/${audioFormat}` }
      );
      const audioUrl = URL.createObjectURL(audioBlob);
      const audioElement = new Audio(audioUrl);
      audioRef.current = audioElement;

      audioElement.onended = () => {
        setPlayingQuestionId(null);
        URL.revokeObjectURL(audioUrl);
      };

      audioElement.onerror = () => {
        setPlayingQuestionId(null);
        URL.revokeObjectURL(audioUrl);
      };

      await audioElement.play();
    } catch (err) {
      console.error("Failed to play audio:", err);
      setPlayingQuestionId(null);
    }
  };

  if (loading) {
    return (
      <div className="loading">
        <div className="loading-spinner"></div>
        <p>Loading student work...</p>
      </div>
    );
  }

  if (!lesson || !student) {
    return (
      <div className="container">
        <div className="card">
          <p>Student or assignment not found.</p>
          <Link to="/educator" className="btn btn-primary" style={{ marginTop: "16px" }}>
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  // No session means student hasn't started
  if (!session || !drilldown) {
    return (
      <div className="container">
        <Link to={`/educator/assignment/${lessonId}`} className="back-btn">
          ← Back to Assignment
        </Link>

        <div className="header">
          <h1>{student.name}</h1>
          <p>{lesson.title}</p>
        </div>

        <div className="card" style={{ textAlign: "center", padding: "48px" }}>
          <div style={{ fontSize: "3rem", marginBottom: "16px" }}>📋</div>
          <h2>Not Started Yet</h2>
          <p style={{ color: "#666" }}>
            {student.name} hasn't started this assignment yet.
          </p>
        </div>
      </div>
    );
  }

  const allExpanded = questionsWithAttempts.length > 0 && expandedQuestions.size === questionsWithAttempts.length;

  return (
    <div className="container">
      <Link to={`/educator/assignment/${lessonId}`} className="back-btn">
        ← Back to Assignment
      </Link>

      <div className="header">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1>{student.name}</h1>
            <p>
              {lesson.title} •{" "}
              {drilldown.completedAt
                ? new Date(drilldown.completedAt).toLocaleDateString()
                : "In Progress"}
              {assignment && assignment.attempts > 1 && (
                <span style={{ marginLeft: "8px", color: "#1565c0" }}>
                  (Attempt #{assignment.attempts})
                </span>
              )}
            </p>
          </div>
          <div style={{ display: "flex", gap: "12px", flexShrink: 0 }}>
            {/* Reassign to Student / Undo Reassignment Button */}
            {assignment && (
              justReassigned ? (
                <button
                  onClick={handleUndoReassignment}
                  disabled={isUndoing}
                  className="btn btn-secondary"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "10px 16px",
                    background: "#fff3e0",
                    color: "#e65100",
                    border: "1px solid #ffcc80",
                  }}
                  title="Undo the reassignment"
                >
                  {isUndoing ? "Undoing..." : "Undo Reassignment"}
                </button>
              ) : (
                <button
                  onClick={handleReassignToStudent}
                  disabled={isPushing}
                  className="btn btn-secondary"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "10px 16px",
                  }}
                  title="Reassign to student for another attempt"
                >
                  {isPushing ? "Reassigning..." : "Reassign to Student"}
                </button>
              )
            )}
            {/* Mark as Reviewed Button */}
            {assignment && !assignment.reviewedAt && (
              <button
                onClick={handleMarkReviewed}
                disabled={isMarkingReviewed}
                className="btn btn-primary"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "10px 16px",
                }}
              >
                {isMarkingReviewed ? "Marking..." : "Mark as Reviewed"}
              </button>
            )}
            {/* Already Reviewed Badge */}
            {assignment && assignment.reviewedAt && (
              <span
                style={{
                  background: "#e8f5e9",
                  color: "#2e7d32",
                  padding: "10px 16px",
                  borderRadius: "8px",
                  fontWeight: 500,
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                Reviewed
              </span>
            )}
          </div>
        </div>
      </div>

      {/* PRIMARY: Teacher Notes */}
      <div className="card" style={{ borderLeft: "4px solid #667eea" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
          <h3 style={{ margin: 0 }}>Your Notes</h3>
          <div style={{ fontSize: "0.85rem", color: "#666" }}>
            {saving && "Saving..."}
            {!saving && lastSaved && `Saved ${lastSaved.toLocaleTimeString()}`}
          </div>
        </div>
        <textarea
          value={teacherNote}
          onChange={(e) => {
            setTeacherNote(e.target.value);
            debouncedSave();
          }}
          placeholder={`Add notes about ${student.name}'s work, follow-up actions, or observations...`}
          style={{
            width: "100%",
            minHeight: "100px",
            padding: "12px",
            borderRadius: "8px",
            border: "2px solid #e0e0e0",
            fontSize: "1rem",
            fontFamily: "inherit",
            resize: "vertical",
            boxSizing: "border-box",
          }}
        />
      </div>

      {/* Understanding Summary */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
          <span
            style={{
              display: "inline-block",
              padding: "8px 16px",
              borderRadius: "16px",
              fontSize: "1rem",
              fontWeight: 600,
              background: getUnderstandingBgColor(drilldown.understanding),
              color: getUnderstandingColor(drilldown.understanding),
            }}
          >
            {getUnderstandingLabel(drilldown.understanding)}
          </span>
          <span style={{ color: "#666" }}>
            {drilldown.questions.length}/{lesson.prompts.length} questions answered
          </span>
          <span style={{ color: "#666" }}>
            Coach support: {getCoachSupportLabel(drilldown.coachSupport)}
          </span>
          {drilldown.timeSpentMinutes && (
            <span style={{ color: "#666" }}>
              {drilldown.timeSpentMinutes} min spent
            </span>
          )}
        </div>

        {/* Learning Journey Insights */}
        {(drilldown.insights.startedStrong ||
          drilldown.insights.improvedOverTime ||
          drilldown.insights.recoveredWithSupport ||
          drilldown.insights.struggledConsistently) && (
          <div style={{ marginTop: "16px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {drilldown.insights.startedStrong && (
              <InsightBadge color="#2e7d32" bg="#e8f5e9">Started strong</InsightBadge>
            )}
            {drilldown.insights.improvedOverTime && (
              <InsightBadge color="#1565c0" bg="#e3f2fd">Improved over time</InsightBadge>
            )}
            {drilldown.insights.recoveredWithSupport && (
              <InsightBadge color="#7b1fa2" bg="#f3e5f5">Recovered with support</InsightBadge>
            )}
            {drilldown.insights.struggledConsistently && (
              <InsightBadge color="#c62828" bg="#ffebee">Needs consistent support</InsightBadge>
            )}
          </div>
        )}

        {/* Why Flagged */}
        {drilldown.needsReview && drilldown.attentionReasons.length > 0 && (
          <div
            style={{
              marginTop: "16px",
              padding: "12px",
              background: "#fff3e0",
              borderRadius: "8px",
            }}
          >
            <p style={{ margin: 0, fontWeight: 500, color: "#e65100", marginBottom: "8px" }}>
              Why this student was flagged:
            </p>
            <ul style={{ margin: 0, paddingLeft: "20px" }}>
              {drilldown.attentionReasons.map((reason, i) => {
                const { label, isPositive } = getAttentionReasonDisplay(reason);
                return (
                  <li key={i} style={{ color: isPositive ? "#2e7d32" : "#666" }}>
                    {label}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {/* Question Breakdown Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: "32px",
          marginBottom: "16px",
        }}
      >
        <h2 style={{ color: "white", margin: 0 }}>Question Breakdown</h2>
        <button
          onClick={allExpanded ? collapseAll : expandAll}
          style={{
            background: "rgba(255,255,255,0.1)",
            border: "none",
            color: "white",
            padding: "8px 16px",
            borderRadius: "8px",
            cursor: "pointer",
            fontSize: "0.9rem",
          }}
        >
          {allExpanded ? "Collapse All" : "Expand All"}
        </button>
      </div>

      {/* Questions (collapsed by default) - grouped by question with all attempts */}
      {questionsWithAttempts.map((question) => (
        <QuestionCardWithAttempts
          key={question.questionId}
          question={question}
          expanded={expandedQuestions.has(question.questionId)}
          onToggle={() => toggleQuestion(question.questionId)}
          note={questionNotes[question.questionId] || ""}
          onNoteChange={(value) => {
            setQuestionNotes((prev) => ({ ...prev, [question.questionId]: value }));
            debouncedSave();
          }}
          playingAttemptKey={playingQuestionId}
          onPlayAudio={playAudio}
        />
      ))}
    </div>
  );
}

// ============================================
// Helper Components
// ============================================

function InsightBadge({
  children,
  color,
  bg,
}: {
  children: React.ReactNode;
  color: string;
  bg: string;
}) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "6px 12px",
        borderRadius: "16px",
        fontSize: "0.85rem",
        fontWeight: 500,
        background: bg,
        color: color,
      }}
    >
      {children}
    </span>
  );
}

// ============================================
// Question Card With Attempts Component
// Shows all attempts for a question, newest first
// ============================================

interface QuestionCardWithAttemptsProps {
  question: QuestionWithAttempts;
  expanded: boolean;
  onToggle: () => void;
  note: string;
  onNoteChange: (value: string) => void;
  playingAttemptKey: string | null;
  onPlayAudio: (audioBase64: string, audioFormat: string, attemptKey: string) => void;
}

function QuestionCardWithAttempts({
  question,
  expanded,
  onToggle,
  note,
  onNoteChange,
  playingAttemptKey,
  onPlayAudio,
}: QuestionCardWithAttemptsProps) {
  // Outcome colors
  const outcomeColors: Record<string, { bg: string; color: string }> = {
    demonstrated: { bg: "#e8f5e9", color: "#2e7d32" },
    "with-support": { bg: "#e3f2fd", color: "#1565c0" },
    developing: { bg: "#fff3e0", color: "#e65100" },
    "not-attempted": { bg: "#f5f5f5", color: "#666" },
  };

  // Get the latest attempt for the header badge (attempts are sorted newest first)
  const latestAttempt = question.attempts[0];
  const { bg, color } = latestAttempt
    ? outcomeColors[latestAttempt.outcome] || outcomeColors["not-attempted"]
    : outcomeColors["not-attempted"];

  // Check if any attempt used hints or has voice recording
  const anyUsedHint = question.attempts.some((a) => a.usedHint);
  const anyHasVoice = question.attempts.some((a) => a.hasVoiceRecording);
  const hasNote = note && note.trim().length > 0;

  return (
    <div className="card" style={{ marginBottom: "12px" }}>
      {/* Collapsed Header (always visible) */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          cursor: "pointer",
        }}
        onClick={onToggle}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1 }}>
          <span
            style={{
              background: "#667eea",
              color: "white",
              padding: "4px 10px",
              borderRadius: "12px",
              fontSize: "0.85rem",
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            Q{question.questionNumber}
          </span>
          <span
            style={{
              color: "#333",
              fontSize: "0.95rem",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: expanded ? "normal" : "nowrap",
            }}
          >
            {question.questionText}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0, marginLeft: "12px" }}>
          {/* Status indicators */}
          {anyUsedHint && (
            <span style={{ fontSize: "0.8rem" }} title="Used hint">💡</span>
          )}
          {anyHasVoice && (
            <span style={{ fontSize: "0.8rem" }} title="Voice recording">🎤</span>
          )}
          {hasNote && (
            <span style={{ fontSize: "0.8rem" }} title="Has your note">📝</span>
          )}

          {/* Attempts count badge */}
          {question.attempts.length > 1 && (
            <span
              style={{
                display: "inline-block",
                padding: "4px 8px",
                borderRadius: "12px",
                fontSize: "0.75rem",
                fontWeight: 500,
                background: "#e3f2fd",
                color: "#1565c0",
              }}
            >
              {question.attempts.length} attempts
            </span>
          )}

          {/* Latest outcome badge */}
          {latestAttempt && (
            <span
              style={{
                display: "inline-block",
                padding: "4px 10px",
                borderRadius: "12px",
                fontSize: "0.8rem",
                fontWeight: 500,
                background: bg,
                color: color,
                whiteSpace: "nowrap",
              }}
            >
              {getQuestionOutcomeLabel(latestAttempt.outcome)}
            </span>
          )}

          {/* Expand/collapse arrow */}
          <span style={{ color: "#666", fontSize: "1.2rem" }}>
            {expanded ? "▼" : "▶"}
          </span>
        </div>
      </div>

      {/* Expanded Content - Show all attempts */}
      {expanded && (
        <div style={{ marginTop: "16px", paddingTop: "16px", borderTop: "1px solid #eee" }}>
          {question.attempts.length === 0 ? (
            <div
              style={{
                background: "#f5f5f5",
                borderRadius: "12px",
                padding: "16px",
                marginBottom: "12px",
                textAlign: "center",
                color: "#999",
              }}
            >
              No response recorded
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {/* Attempts shown newest first */}
              {question.attempts.map((attempt, index) => {
                const attemptKey = `${question.questionId}-${attempt.sessionId}`;
                const isPlaying = playingAttemptKey === attemptKey;
                const attemptOutcome = outcomeColors[attempt.outcome] || outcomeColors["not-attempted"];
                const isLatest = index === 0;

                return (
                  <div
                    key={attemptKey}
                    style={{
                      background: isLatest ? "#f5f5f5" : "#fafafa",
                      borderRadius: "12px",
                      padding: "16px",
                      border: isLatest ? "2px solid #667eea" : "1px solid #eee",
                    }}
                  >
                    {/* Attempt header */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span
                          style={{
                            fontSize: "0.8rem",
                            fontWeight: 600,
                            color: isLatest ? "#667eea" : "#666",
                          }}
                        >
                          {isLatest ? "Latest Attempt" : `Attempt #${attempt.attemptNumber}`}
                        </span>
                        <span style={{ fontSize: "0.8rem", color: "#999" }}>
                          {new Date(attempt.sessionDate).toLocaleDateString()}
                        </span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        {attempt.usedHint && (
                          <span style={{ fontSize: "0.75rem", color: "#7b1fa2" }}>💡 Hint used</span>
                        )}
                        <span
                          style={{
                            display: "inline-block",
                            padding: "2px 8px",
                            borderRadius: "8px",
                            fontSize: "0.75rem",
                            fontWeight: 500,
                            background: attemptOutcome.bg,
                            color: attemptOutcome.color,
                          }}
                        >
                          {getQuestionOutcomeLabel(attempt.outcome)}
                        </span>
                      </div>
                    </div>

                    {/* Student response */}
                    <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
                      <span style={{ fontSize: "1rem" }}>👤</span>
                      <div style={{ flex: 1 }}>
                        <p style={{ margin: 0, lineHeight: 1.6, fontSize: "0.95rem" }}>
                          {attempt.response || <span style={{ color: "#999", fontStyle: "italic" }}>No response</span>}
                        </p>
                      </div>
                      {attempt.hasVoiceRecording && attempt.audioBase64 && attempt.audioFormat && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onPlayAudio(attempt.audioBase64!, attempt.audioFormat!, attemptKey);
                          }}
                          style={{
                            background: isPlaying ? "#667eea" : "#e8f5e9",
                            color: isPlaying ? "white" : "#2e7d32",
                            border: "none",
                            borderRadius: "50%",
                            width: "36px",
                            height: "36px",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                          }}
                          title="Listen to student's voice"
                        >
                          {isPlaying ? "⏹" : "🎤"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Teacher Note for this question */}
          <div style={{ marginTop: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
              <span style={{ fontSize: "0.85rem", color: "#666" }}>✏️ Your note for Q{question.questionNumber}:</span>
            </div>
            <textarea
              value={note}
              onChange={(e) => onNoteChange(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              placeholder="Add a note about this question..."
              style={{
                width: "100%",
                minHeight: "60px",
                padding: "10px",
                borderRadius: "8px",
                border: "1px solid #e0e0e0",
                fontSize: "0.9rem",
                fontFamily: "inherit",
                resize: "vertical",
                boxSizing: "border-box",
                background: "#fafafa",
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
