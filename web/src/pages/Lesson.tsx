import { useState, useEffect } from "react";
import { useParams, useNavigate, useSearchParams, Link } from "react-router-dom";
import {
  getLesson,
  getSession,
  updateSession,
  evaluateResponse,
  type Lesson as LessonType,
  type Session,
  type PromptResponse,
} from "../services/api";
import { useVoice } from "../hooks/useVoice";

export default function Lesson() {
  const { studentId, lessonId } = useParams<{ studentId: string; lessonId: string }>();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session");
  const navigate = useNavigate();

  const [lesson, setLesson] = useState<LessonType | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [showHint, setShowHint] = useState(false);
  const [hintIndex, setHintIndex] = useState(0);
  const [feedback, setFeedback] = useState<{ score: number; comment: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const {
    isRecording,
    isTranscribing,
    isSpeaking,
    voiceAvailable,
    error: voiceError,
    recordingDuration,
    startRecording,
    stopRecording,
    speak,
    cancelRecording,
  } = useVoice();

  useEffect(() => {
    async function loadData() {
      if (!lessonId || !sessionId) return;

      try {
        const [lessonData, sessionData] = await Promise.all([
          getLesson(lessonId),
          getSession(sessionId),
        ]);
        setLesson(lessonData);
        setSession(sessionData);
        setCurrentIndex(sessionData.currentPromptIndex || 0);
      } catch (err) {
        console.error("Failed to load lesson:", err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [lessonId, sessionId]);

  const currentPrompt = lesson?.prompts[currentIndex];

  // Speak the question when it loads
  useEffect(() => {
    if (currentPrompt && voiceAvailable && !feedback) {
      speak(currentPrompt.input);
    }
  }, [currentPrompt?.id, voiceAvailable]);

  // Speak feedback when it arrives
  useEffect(() => {
    if (feedback && voiceAvailable) {
      speak(feedback.comment);
    }
  }, [feedback, voiceAvailable]);

  const handleVoiceInput = async () => {
    if (isRecording) {
      const text = await stopRecording();
      if (text) {
        setAnswer(text);
      }
    } else {
      await startRecording();
    }
  };

  const handleShowHint = () => {
    if (!currentPrompt) return;
    if (!showHint) {
      setShowHint(true);
    } else if (hintIndex < currentPrompt.hints.length - 1) {
      setHintIndex(hintIndex + 1);
    }
  };

  const handleSubmit = async () => {
    if (!answer.trim() || !currentPrompt || !session || !lessonId) return;

    setSubmitting(true);
    setFeedback(null);

    try {
      const response: PromptResponse = {
        promptId: currentPrompt.id,
        response: answer.trim(),
        hintUsed: showHint,
      };

      // Evaluate the response
      const result = await evaluateResponse(response, lessonId);
      setFeedback({ score: result.score, comment: result.comment });

      // Update session
      const updatedResponses = [...session.submission.responses, response];
      const isComplete = currentIndex >= lesson!.prompts.length - 1;

      await updateSession(session.id, {
        submission: {
          ...session.submission,
          responses: updatedResponses,
        },
        currentPromptIndex: currentIndex + 1,
        status: isComplete ? "completed" : "in_progress",
        completedAt: isComplete ? new Date().toISOString() : undefined,
        evaluation: isComplete
          ? {
              totalScore: Math.round(
                updatedResponses.reduce((sum, r, i) => {
                  // Simple scoring placeholder
                  return sum + result.score;
                }, 0) / updatedResponses.length * 2
              ),
              feedback: "Great work completing the lesson!",
              criteriaScores: updatedResponses.map((r) => ({
                criterionId: r.promptId,
                score: result.score,
              })),
            }
          : undefined,
      });

      setSession((prev) =>
        prev
          ? {
              ...prev,
              submission: { ...prev.submission, responses: updatedResponses },
            }
          : null
      );
    } catch (err) {
      console.error("Failed to submit:", err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleNext = () => {
    if (!lesson) return;

    if (currentIndex < lesson.prompts.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setAnswer("");
      setShowHint(false);
      setHintIndex(0);
      setFeedback(null);
    } else {
      // Lesson complete
      navigate(`/student/${studentId}/progress`);
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

  if (!lesson || !currentPrompt) {
    return (
      <div className="container">
        <div className="card">
          <p>Lesson not found.</p>
          <Link to={`/student/${studentId}`} className="btn btn-primary">
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  const progress = ((currentIndex + 1) / lesson.prompts.length) * 100;

  return (
    <div className="container">
      <Link to={`/student/${studentId}`} className="back-btn">
        ← Exit Lesson
      </Link>

      <div className="header">
        <h1>{lesson.title}</h1>
        <p>
          Question {currentIndex + 1} of {lesson.prompts.length}
        </p>
      </div>

      {/* Progress bar */}
      <div className="card" style={{ padding: "12px 24px" }}>
        <div className="progress-bar">
          <div className="progress-bar-fill" style={{ width: `${progress}%` }}></div>
        </div>
      </div>

      {/* Question */}
      <div className="card question-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
          <h2 style={{ flex: 1 }}>{currentPrompt.input}</h2>
          {voiceAvailable && (
            <button
              className="btn btn-secondary"
              onClick={() => speak(currentPrompt.input)}
              disabled={isSpeaking}
              style={{ padding: "8px 12px", flexShrink: 0 }}
              title="Read question aloud"
            >
              {isSpeaking ? "🔊" : "🔈"}
            </button>
          )}
        </div>

        {!feedback ? (
          <>
            <div className="question-input">
              <textarea
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder={isRecording ? "🎤 Listening..." : isTranscribing ? "⏳ Transcribing..." : "Type your answer here or use the microphone..."}
                disabled={submitting || isRecording || isTranscribing}
              />
              {voiceAvailable && (
                <>
                  <button
                    className={`btn ${isRecording ? "btn-primary" : "btn-secondary"}`}
                    onClick={handleVoiceInput}
                    disabled={submitting || isTranscribing}
                    style={{
                      marginTop: "8px",
                      width: "100%",
                      background: isRecording ? "#f44336" : undefined,
                    }}
                  >
                    {isRecording
                      ? `🛑 Stop Recording (${recordingDuration}s)`
                      : isTranscribing
                      ? "⏳ Transcribing..."
                      : "🎤 Use Voice Input"}
                  </button>
                  {voiceError && (
                    <p style={{ color: "#f44336", fontSize: "0.9rem", marginTop: "8px" }}>
                      {voiceError}
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Hints */}
            {showHint && currentPrompt.hints.length > 0 && (
              <div className="hint-section">
                <h4>💡 Hint</h4>
                {currentPrompt.hints.slice(0, hintIndex + 1).map((hint, i) => (
                  <p key={i} style={{ marginBottom: "8px" }}>
                    {hint}
                  </p>
                ))}
              </div>
            )}

            <div className="nav-buttons">
              <button
                className="btn btn-secondary"
                onClick={handleShowHint}
                disabled={
                  submitting ||
                  (showHint && hintIndex >= currentPrompt.hints.length - 1)
                }
              >
                {showHint ? "More Hints" : "Need a Hint?"}
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSubmit}
                disabled={!answer.trim() || submitting}
              >
                {submitting ? "Checking..." : "Submit Answer"}
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Feedback */}
            <div
              className={`card feedback-card ${
                feedback.score >= 35 ? "success" : "needs-work"
              }`}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div className="score-display">{feedback.score}/50</div>
                {voiceAvailable && (
                  <button
                    className="btn btn-secondary"
                    onClick={() => speak(feedback.comment)}
                    disabled={isSpeaking}
                    style={{ padding: "8px 12px" }}
                    title="Read feedback aloud"
                  >
                    {isSpeaking ? "🔊" : "🔈"}
                  </button>
                )}
              </div>
              <p>{feedback.comment}</p>
            </div>

            <div className="nav-buttons">
              <button className="btn btn-primary" onClick={handleNext}>
                {currentIndex < lesson.prompts.length - 1
                  ? "Next Question →"
                  : "Finish Lesson 🎉"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
