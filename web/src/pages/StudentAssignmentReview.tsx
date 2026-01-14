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
  type Session,
  type Lesson,
  type Student,
} from "../services/api";
import {
  buildStudentDrilldown,
  getUnderstandingLabel,
  getUnderstandingColor,
  getUnderstandingBgColor,
  getCoachSupportLabel,
  getQuestionOutcomeLabel,
  getAttentionReasonDisplay,
} from "../utils/teacherDashboardUtils";
import type { StudentDrilldownData, QuestionSummary } from "../types/teacherDashboard";

export default function StudentAssignmentReview() {
  const { lessonId, studentId } = useParams<{ lessonId: string; studentId: string }>();

  const [drilldown, setDrilldown] = useState<StudentDrilldownData | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [student, setStudent] = useState<Student | null>(null);
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [loading, setLoading] = useState(true);

  // Notes state
  const [teacherNote, setTeacherNote] = useState("");
  const [questionNotes, setQuestionNotes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Expanded questions
  const [expandedQuestions, setExpandedQuestions] = useState<Set<string>>(new Set());

  // Audio playback
  const [playingQuestionId, setPlayingQuestionId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!lessonId || !studentId) return;

    async function loadData() {
      try {
        const [lessonData, sessions, studentData] = await Promise.all([
          getLesson(lessonId!),
          getSessions(studentId, "completed"),
          getStudent(studentId!),
        ]);

        // Find session for this lesson
        const lessonSession = sessions.find((s) => s.lessonId === lessonId);

        if (lessonSession) {
          setSession(lessonSession);
          setTeacherNote(lessonSession.educatorNotes || "");

          // Initialize question notes
          const notesMap: Record<string, string> = {};
          lessonSession.submission.responses.forEach((r) => {
            if (r.educatorNote) {
              notesMap[r.promptId] = r.educatorNote;
            }
          });
          setQuestionNotes(notesMap);

          // Build drilldown data
          const data = buildStudentDrilldown(lessonSession, lessonData as Lesson);
          setDrilldown(data);
        }

        setLesson(lessonData as Lesson);
        setStudent(studentData);
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

  // Auto-save notes
  const saveNotes = useCallback(async () => {
    if (!session) return;

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

      setLastSaved(new Date());
    } catch (err) {
      console.error("Failed to save notes:", err);
    } finally {
      setSaving(false);
    }
  }, [session, teacherNote, questionNotes]);

  const debouncedSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      saveNotes();
    }, 1000);
  }, [saveNotes]);

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
    if (drilldown) {
      setExpandedQuestions(new Set(drilldown.questions.map((q) => q.questionId)));
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

  const allExpanded = expandedQuestions.size === drilldown.questions.length;

  return (
    <div className="container">
      <Link to={`/educator/assignment/${lessonId}`} className="back-btn">
        ← Back to Assignment
      </Link>

      <div className="header">
        <h1>{student.name}</h1>
        <p>
          {lesson.title} •{" "}
          {drilldown.completedAt
            ? new Date(drilldown.completedAt).toLocaleDateString()
            : "In Progress"}
        </p>
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
            {drilldown.questionsAnswered}/{drilldown.questions.length} questions answered
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

      {/* Questions (collapsed by default) */}
      {drilldown.questions.map((question) => (
        <QuestionCard
          key={question.questionId}
          question={question}
          expanded={expandedQuestions.has(question.questionId)}
          onToggle={() => toggleQuestion(question.questionId)}
          note={questionNotes[question.questionId] || ""}
          onNoteChange={(value) => {
            setQuestionNotes((prev) => ({ ...prev, [question.questionId]: value }));
            debouncedSave();
          }}
          isPlaying={playingQuestionId === question.questionId}
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
// Question Card Component
// ============================================

interface QuestionCardProps {
  question: QuestionSummary;
  expanded: boolean;
  onToggle: () => void;
  note: string;
  onNoteChange: (value: string) => void;
  isPlaying: boolean;
  onPlayAudio: (audioBase64: string, audioFormat: string, questionId: string) => void;
}

function QuestionCard({
  question,
  expanded,
  onToggle,
  note,
  onNoteChange,
  isPlaying,
  onPlayAudio,
}: QuestionCardProps) {
  // Outcome colors
  const outcomeColors: Record<string, { bg: string; color: string }> = {
    demonstrated: { bg: "#e8f5e9", color: "#2e7d32" },
    "with-support": { bg: "#e3f2fd", color: "#1565c0" },
    developing: { bg: "#fff3e0", color: "#e65100" },
    "not-attempted": { bg: "#f5f5f5", color: "#666" },
  };

  const { bg, color } = outcomeColors[question.outcome] || outcomeColors["not-attempted"];

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
          {question.usedHint && (
            <span style={{ fontSize: "0.8rem" }} title="Used hint">💡</span>
          )}
          {question.hasVoiceRecording && (
            <span style={{ fontSize: "0.8rem" }} title="Voice recording">🎤</span>
          )}
          {question.teacherNote && (
            <span style={{ fontSize: "0.8rem" }} title="Has your note">📝</span>
          )}

          {/* Outcome badge */}
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
            {getQuestionOutcomeLabel(question.outcome)}
          </span>

          {/* Expand/collapse arrow */}
          <span style={{ color: "#666", fontSize: "1.2rem" }}>
            {expanded ? "▼" : "▶"}
          </span>
        </div>
      </div>

      {/* Expanded Content */}
      {expanded && (
        <div style={{ marginTop: "16px", paddingTop: "16px", borderTop: "1px solid #eee" }}>
          {/* Student Response */}
          {question.studentResponse ? (
            <div
              style={{
                background: "#f5f5f5",
                borderRadius: "12px",
                padding: "16px",
                marginBottom: "12px",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
                <span style={{ fontSize: "1.2rem" }}>👤</span>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontSize: "0.85rem", color: "#666", marginBottom: "4px" }}>
                    Student's Response
                  </p>
                  <p style={{ margin: 0, lineHeight: 1.6 }}>{question.studentResponse}</p>
                </div>
                {question.hasVoiceRecording && question.audioBase64 && question.audioFormat && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onPlayAudio(question.audioBase64!, question.audioFormat!, question.questionId);
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
          ) : (
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
          )}

          {/* Coach Support Used */}
          {question.usedHint && (
            <div
              style={{
                background: "#f3e5f5",
                borderRadius: "8px",
                padding: "12px",
                marginBottom: "12px",
              }}
            >
              <p style={{ margin: 0, fontSize: "0.85rem", color: "#7b1fa2", fontWeight: 500 }}>
                Coach Support Used
              </p>
              <div style={{ marginTop: "8px", display: "flex", gap: "16px", fontSize: "0.9rem", color: "#666" }}>
                <span>💡 {question.hintCount}/{question.totalHintsAvailable} hints</span>
                {question.improvedAfterHelp && (
                  <span style={{ color: "#2e7d32" }}>✓ Improved after help</span>
                )}
              </div>
            </div>
          )}

          {/* Teacher Note for this question */}
          <div style={{ marginTop: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
              <span style={{ fontSize: "0.85rem", color: "#666" }}>✏️ Your note for Q{question.questionNumber}:</span>
            </div>
            <textarea
              value={note}
              onChange={(e) => onNoteChange(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              placeholder="Add a note about this response..."
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
