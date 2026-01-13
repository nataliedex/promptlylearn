import { useState, useEffect } from "react";
import { useParams, useNavigate, useSearchParams, Link } from "react-router-dom";
import {
  getLesson,
  getSession,
  updateSession,
  getCoachFeedback,
  continueCoachConversation,
  type Lesson as LessonType,
  type Session,
  type PromptResponse,
  type ConversationMessage,
  type CoachFeedbackResponse,
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
  const [feedback, setFeedback] = useState<CoachFeedbackResponse | null>(null);
  const [conversationHistory, setConversationHistory] = useState<ConversationMessage[]>([]);
  const [followUpAnswer, setFollowUpAnswer] = useState("");
  const [isConversing, setIsConversing] = useState(false);
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
    setConversationHistory([]);

    try {
      // Get conversational coach feedback
      const coachResponse = await getCoachFeedback(
        lessonId,
        currentPrompt.id,
        answer.trim(),
        lesson?.gradeLevel
      );

      setFeedback(coachResponse);

      // Initialize conversation history with the feedback
      if (coachResponse.followUpQuestion) {
        setConversationHistory([
          { role: "coach", message: `${coachResponse.feedback} ${coachResponse.followUpQuestion}` },
        ]);
      }

      // Update session with response
      const response: PromptResponse = {
        promptId: currentPrompt.id,
        response: answer.trim(),
        hintUsed: showHint,
      };

      const updatedResponses = [...session.submission.responses, response];

      await updateSession(session.id, {
        submission: {
          ...session.submission,
          responses: updatedResponses,
        },
        currentPromptIndex: currentIndex,
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

  const handleFollowUpSubmit = async () => {
    if (!followUpAnswer.trim() || !currentPrompt || !lessonId || !feedback) return;

    setIsConversing(true);

    try {
      // Add student's response to history
      const newHistory: ConversationMessage[] = [
        ...conversationHistory,
        { role: "student", message: followUpAnswer.trim() },
      ];

      // Get coach's response
      const coachResponse = await continueCoachConversation(
        lessonId,
        currentPrompt.id,
        answer,
        followUpAnswer.trim(),
        newHistory,
        lesson?.gradeLevel
      );

      // Add coach response to history
      const coachMessage = coachResponse.followUpQuestion
        ? `${coachResponse.feedback} ${coachResponse.followUpQuestion}`
        : coachResponse.feedback;

      newHistory.push({ role: "coach", message: coachMessage });
      setConversationHistory(newHistory);

      // Update feedback state to track if conversation should continue
      setFeedback((prev) =>
        prev
          ? {
              ...prev,
              shouldContinue: coachResponse.shouldContinue,
              followUpQuestion: coachResponse.followUpQuestion,
            }
          : null
      );

      setFollowUpAnswer("");
    } catch (err) {
      console.error("Failed to continue conversation:", err);
    } finally {
      setIsConversing(false);
    }
  };

  const handleNext = async () => {
    if (!lesson || !session) return;

    const isComplete = currentIndex >= lesson.prompts.length - 1;

    if (isComplete) {
      // Update session as completed
      await updateSession(session.id, {
        currentPromptIndex: currentIndex + 1,
        status: "completed",
        completedAt: new Date().toISOString(),
        evaluation: {
          totalScore: Math.round(
            session.submission.responses.reduce((sum, r) => sum + (feedback?.score || 50), 0) /
              Math.max(session.submission.responses.length, 1)
          ),
          feedback: "Great work completing the lesson!",
          criteriaScores: session.submission.responses.map((r) => ({
            criterionId: r.promptId,
            score: feedback?.score || 50,
          })),
        },
      });
      navigate(`/student/${studentId}/progress`);
    } else {
      // Move to next question
      await updateSession(session.id, {
        currentPromptIndex: currentIndex + 1,
      });
      setCurrentIndex(currentIndex + 1);
      setAnswer("");
      setShowHint(false);
      setHintIndex(0);
      setFeedback(null);
      setConversationHistory([]);
      setFollowUpAnswer("");
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
            {/* Coach Conversation */}
            <div className="coach-conversation" style={{ marginTop: "16px" }}>
              {/* Score indicator */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  marginBottom: "16px",
                  padding: "12px",
                  background: feedback.isCorrect ? "#e8f5e9" : "#fff3e0",
                  borderRadius: "8px",
                }}
              >
                <span style={{ fontSize: "1.5rem" }}>{feedback.isCorrect ? "✨" : "💭"}</span>
                <div>
                  <p style={{ margin: 0, fontWeight: 600, color: feedback.isCorrect ? "#2e7d32" : "#ef6c00" }}>
                    {feedback.encouragement}
                  </p>
                  <p style={{ margin: 0, fontSize: "0.85rem", color: "#666" }}>
                    Score: {feedback.score}/100
                  </p>
                </div>
              </div>

              {/* Conversation history */}
              <div
                style={{
                  maxHeight: "300px",
                  overflowY: "auto",
                  marginBottom: "16px",
                }}
              >
                {conversationHistory.map((msg, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      justifyContent: msg.role === "student" ? "flex-end" : "flex-start",
                      marginBottom: "12px",
                    }}
                  >
                    <div
                      style={{
                        maxWidth: "85%",
                        padding: "12px 16px",
                        borderRadius: msg.role === "student" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                        background: msg.role === "student" ? "#667eea" : "#f5f5f5",
                        color: msg.role === "student" ? "white" : "#333",
                      }}
                    >
                      {msg.role === "coach" && (
                        <span style={{ marginRight: "8px" }}>🤖</span>
                      )}
                      {msg.message}
                    </div>
                  </div>
                ))}
              </div>

              {/* Follow-up input */}
              {feedback.shouldContinue && feedback.followUpQuestion && (
                <div style={{ marginBottom: "16px" }}>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <input
                      type="text"
                      value={followUpAnswer}
                      onChange={(e) => setFollowUpAnswer(e.target.value)}
                      placeholder="Type your response..."
                      disabled={isConversing}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && followUpAnswer.trim()) {
                          handleFollowUpSubmit();
                        }
                      }}
                      style={{
                        flex: 1,
                        padding: "12px 16px",
                        borderRadius: "24px",
                        border: "2px solid #e0e0e0",
                        fontSize: "1rem",
                      }}
                    />
                    <button
                      className="btn btn-primary"
                      onClick={handleFollowUpSubmit}
                      disabled={!followUpAnswer.trim() || isConversing}
                      style={{ borderRadius: "24px", padding: "12px 20px" }}
                    >
                      {isConversing ? "..." : "Send"}
                    </button>
                  </div>
                  {voiceAvailable && (
                    <button
                      className={`btn ${isRecording ? "btn-primary" : "btn-secondary"}`}
                      onClick={async () => {
                        if (isRecording) {
                          const text = await stopRecording();
                          if (text) setFollowUpAnswer(text);
                        } else {
                          await startRecording();
                        }
                      }}
                      disabled={isConversing || isTranscribing}
                      style={{
                        marginTop: "8px",
                        width: "100%",
                        background: isRecording ? "#f44336" : undefined,
                      }}
                    >
                      {isRecording
                        ? `🛑 Stop (${recordingDuration}s)`
                        : isTranscribing
                        ? "⏳ Transcribing..."
                        : "🎤 Use Voice"}
                    </button>
                  )}
                </div>
              )}

              {/* Speak last coach message */}
              {voiceAvailable && conversationHistory.length > 0 && (
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    const lastCoachMsg = [...conversationHistory].reverse().find((m) => m.role === "coach");
                    if (lastCoachMsg) speak(lastCoachMsg.message);
                  }}
                  disabled={isSpeaking}
                  style={{ marginBottom: "16px", width: "100%" }}
                >
                  {isSpeaking ? "🔊 Speaking..." : "🔈 Read Coach Response"}
                </button>
              )}
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
