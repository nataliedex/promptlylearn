import { useState, useEffect, useRef } from "react";
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

type LessonMode = "voice" | "type";
type VoiceState = "idle" | "speaking" | "listening" | "processing";

export default function Lesson() {
  const { studentId, lessonId } = useParams<{ studentId: string; lessonId: string }>();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session");
  const mode = (searchParams.get("mode") as LessonMode) || "type";
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

  // Voice mode state
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceStarted, setVoiceStarted] = useState(false);
  const [lessonStarted, setLessonStarted] = useState(false); // User must click to start (browser autoplay policy)
  const isProcessingRef = useRef(false);

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
  } = useVoice();

  // Update voice state based on hook states
  useEffect(() => {
    if (isSpeaking) setVoiceState("speaking");
    else if (isRecording) setVoiceState("listening");
    else if (isTranscribing) setVoiceState("processing");
    else if (!isProcessingRef.current) setVoiceState("idle");
  }, [isSpeaking, isRecording, isTranscribing]);

  // Load lesson data
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

  // Voice mode: Start the question flow when prompt loads (after user clicks Start)
  useEffect(() => {
    if (mode === "voice" && currentPrompt && voiceAvailable && !feedback && !voiceStarted && lessonStarted) {
      setVoiceStarted(true);
      startVoiceFlow();
    }
  }, [currentPrompt?.id, voiceAvailable, mode, feedback, voiceStarted, lessonStarted]);

  // Handler for the Start Lesson button (provides user interaction for browser autoplay policy)
  const handleStartLesson = () => {
    setLessonStarted(true);
  };

  const startVoiceFlow = async () => {
    if (!currentPrompt || isProcessingRef.current) return;
    isProcessingRef.current = true;
    setVoiceState("speaking");

    console.log("=== START VOICE FLOW ===");
    console.log("Speaking QUESTION:", currentPrompt.input.substring(0, 50) + "...");

    // Speak the question - wait for it to complete
    const speechSuccess = await speak(currentPrompt.input);
    console.log("QUESTION speech completed, success:", speechSuccess);

    // Only start recording after speech finishes
    if (speechSuccess) {
      // Wait a moment then start recording
      await new Promise((r) => setTimeout(r, 500));
      console.log("Starting recording...");
      setVoiceState("listening");
      await startRecording();
    } else {
      console.log("Speech failed, not starting recording");
      setVoiceState("idle");
    }

    isProcessingRef.current = false;
  };

  // Speak coach feedback and optionally start recording for follow-up
  const speakFeedbackAndContinue = async (coachFeedback: string, followUpQuestion?: string, shouldContinue?: boolean) => {
    console.log("=== SPEAK FEEDBACK START ===");
    console.log("coachFeedback:", coachFeedback);
    console.log("followUpQuestion:", followUpQuestion);
    console.log("shouldContinue:", shouldContinue);

    // Validate inputs
    if (!coachFeedback || typeof coachFeedback !== "string") {
      console.error("Invalid coachFeedback:", coachFeedback);
      setVoiceState("idle");
      isProcessingRef.current = false;
      return;
    }

    setVoiceState("speaking");

    // Speak feedback and follow-up question
    const message = followUpQuestion
      ? `${coachFeedback} ${followUpQuestion}`
      : coachFeedback;

    console.log("Speaking FEEDBACK message:", message.substring(0, 100) + "...");
    console.log("Message length:", message.length);

    const speechSuccess = await speak(message);
    console.log("FEEDBACK speech completed, success:", speechSuccess);

    // If there's a follow-up question and speech worked, start recording for response
    if (shouldContinue && followUpQuestion && speechSuccess) {
      await new Promise((r) => setTimeout(r, 500));
      console.log("Starting recording for follow-up...");
      setVoiceState("listening");
      await startRecording();
      isProcessingRef.current = false;
    } else {
      setVoiceState("idle");
      isProcessingRef.current = false;
    }
  };

  // Voice mode: Handle tap to stop and submit
  const handleVoiceTap = async () => {
    if (isRecording) {
      setVoiceState("processing");
      isProcessingRef.current = true;

      const result = await stopRecording();

      if (result) {
        if (!feedback) {
          // This is the main answer
          setAnswer(result.text);
          await submitAnswer(result.text, result.audioBase64, result.audioFormat);
        } else {
          // This is a follow-up response (don't save audio for follow-ups)
          setFollowUpAnswer(result.text);
          await submitFollowUp(result.text);
        }
      } else {
        // No text transcribed, restart recording
        await new Promise((r) => setTimeout(r, 500));
        setVoiceState("listening");
        await startRecording();
        isProcessingRef.current = false;
      }
    }
  };

  const submitAnswer = async (answerText: string, audioBase64?: string, audioFormat?: string) => {
    if (!answerText.trim() || !currentPrompt || !session || !lessonId) {
      isProcessingRef.current = false;
      return;
    }

    setSubmitting(true);
    setVoiceState("processing");

    try {
      const coachResponse = await getCoachFeedback(
        lessonId,
        currentPrompt.id,
        answerText.trim(),
        lesson?.gradeLevel
      );

      setFeedback(coachResponse);

      if (coachResponse.followUpQuestion) {
        setConversationHistory([
          { role: "coach", message: `${coachResponse.feedback} ${coachResponse.followUpQuestion}` },
        ]);
      } else {
        setConversationHistory([
          { role: "coach", message: coachResponse.feedback },
        ]);
      }

      // Update session - include audio data if available (voice mode)
      const response: PromptResponse = {
        promptId: currentPrompt.id,
        response: answerText.trim(),
        hintUsed: showHint,
        ...(audioBase64 && { audioBase64 }),
        ...(audioFormat && { audioFormat }),
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
          ? { ...prev, submission: { ...prev.submission, responses: updatedResponses } }
          : null
      );

      setSubmitting(false);

      // In voice mode, speak the feedback and continue the conversation
      if (mode === "voice") {
        // Add a small delay to ensure all state has settled
        await new Promise((r) => setTimeout(r, 300));
        await speakFeedbackAndContinue(
          coachResponse.feedback,
          coachResponse.followUpQuestion,
          coachResponse.shouldContinue
        );
      } else {
        isProcessingRef.current = false;
      }
    } catch (err) {
      console.error("Failed to submit:", err);
      setSubmitting(false);
      isProcessingRef.current = false;
    }
  };

  const submitFollowUp = async (responseText: string) => {
    if (!responseText.trim() || !currentPrompt || !lessonId || !feedback) {
      isProcessingRef.current = false;
      return;
    }

    setIsConversing(true);
    setVoiceState("processing");

    try {
      const newHistory: ConversationMessage[] = [
        ...conversationHistory,
        { role: "student", message: responseText.trim() },
      ];

      const coachResponse = await continueCoachConversation(
        lessonId,
        currentPrompt.id,
        answer,
        responseText.trim(),
        newHistory,
        lesson?.gradeLevel
      );

      const coachMessage = coachResponse.followUpQuestion
        ? `${coachResponse.feedback} ${coachResponse.followUpQuestion}`
        : coachResponse.feedback;

      newHistory.push({ role: "coach", message: coachMessage });
      setConversationHistory(newHistory);

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
      setIsConversing(false);

      // In voice mode, speak the response and maybe continue recording
      if (mode === "voice") {
        await speakFeedbackAndContinue(
          coachResponse.feedback,
          coachResponse.followUpQuestion,
          coachResponse.shouldContinue
        );
      } else {
        isProcessingRef.current = false;
      }
    } catch (err) {
      console.error("Failed to continue conversation:", err);
      setIsConversing(false);
      isProcessingRef.current = false;
    }
  };

  // Type mode handlers
  const handleShowHint = () => {
    if (!currentPrompt) return;
    if (!showHint) {
      setShowHint(true);
    } else if (hintIndex < currentPrompt.hints.length - 1) {
      setHintIndex(hintIndex + 1);
    }
  };

  const handleSubmit = async () => {
    await submitAnswer(answer);
  };

  const handleFollowUpSubmit = async () => {
    await submitFollowUp(followUpAnswer);
  };

  const handleNext = async () => {
    if (!lesson || !session) return;

    const isComplete = currentIndex >= lesson.prompts.length - 1;

    if (isComplete) {
      await updateSession(session.id, {
        currentPromptIndex: currentIndex + 1,
        status: "completed",
        completedAt: new Date().toISOString(),
        evaluation: {
          totalScore: Math.round(
            session.submission.responses.reduce((sum) => sum + (feedback?.score || 50), 0) /
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
      setVoiceStarted(false);
      isProcessingRef.current = false;
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
  const isVoiceMode = mode === "voice";

  // Voice mode UI
  if (isVoiceMode) {
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

        {/* Voice interaction card */}
        <div
          className="card"
          style={{
            textAlign: "center",
            padding: "32px",
            minHeight: "400px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
          onClick={voiceState === "listening" ? handleVoiceTap : undefined}
        >
          {/* Start Lesson Button - shown before lesson begins */}
          {!lessonStarted && (
            <div>
              <div style={{ fontSize: "4rem", marginBottom: "24px" }}>🎤</div>
              <h2 style={{ marginBottom: "16px" }}>Ready for Voice Lesson</h2>
              <p style={{ color: "#666", marginBottom: "32px" }}>
                The coach will read each question aloud, then listen for your answer.
              </p>
              <button
                className="btn btn-primary"
                onClick={handleStartLesson}
                style={{
                  padding: "20px 48px",
                  fontSize: "1.3rem",
                  borderRadius: "12px",
                }}
              >
                Start Lesson
              </button>
            </div>
          )}

          {/* Question display - shown after lesson starts */}
          {lessonStarted && !feedback && (
            <div style={{ marginBottom: "32px" }}>
              <h2 style={{ fontSize: "1.3rem", lineHeight: 1.5 }}>{currentPrompt.input}</h2>
            </div>
          )}

          {/* Voice state indicator */}
          {lessonStarted && (
          <div style={{ marginBottom: "24px" }}>
            {voiceState === "speaking" && (
              <div className="voice-indicator speaking">
                <div style={{ fontSize: "4rem", marginBottom: "16px" }}>🔊</div>
                <p style={{ fontSize: "1.2rem", color: "#667eea" }}>Coach is speaking...</p>
              </div>
            )}

            {voiceState === "listening" && (
              <div
                className="voice-indicator listening"
                style={{ cursor: "pointer" }}
              >
                <div
                  style={{
                    fontSize: "5rem",
                    marginBottom: "16px",
                    animation: "pulse 1.5s infinite",
                  }}
                >
                  🎤
                </div>
                <p style={{ fontSize: "1.2rem", color: "#4caf50", fontWeight: 600 }}>
                  Listening... ({recordingDuration}s)
                </p>
                <p style={{ fontSize: "1rem", color: "#666", marginTop: "8px" }}>
                  Tap anywhere when done speaking
                </p>
              </div>
            )}

            {voiceState === "processing" && (
              <div className="voice-indicator processing">
                <div className="loading-spinner" style={{ margin: "0 auto 16px" }}></div>
                <p style={{ fontSize: "1.2rem", color: "#666" }}>
                  {isTranscribing ? "Transcribing..." : "Thinking..."}
                </p>
              </div>
            )}

            {voiceState === "idle" && !feedback && (
              <div className="voice-indicator idle">
                <p style={{ fontSize: "1rem", color: "#666" }}>Starting voice interaction...</p>
              </div>
            )}
          </div>
          )}

          {/* Feedback display in voice mode - just the encouragement bubble, no transcript */}
          {lessonStarted && feedback && voiceState === "idle" && (
            <div style={{ marginBottom: "24px" }}>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "16px 32px",
                  background: feedback.isCorrect ? "#e8f5e9" : "#fff3e0",
                  borderRadius: "24px",
                }}
              >
                <span style={{ fontSize: "2rem" }}>{feedback.isCorrect ? "✨" : "💭"}</span>
                <span style={{ fontWeight: 600, fontSize: "1.2rem", color: feedback.isCorrect ? "#2e7d32" : "#ef6c00" }}>
                  {feedback.encouragement}
                </span>
              </div>
            </div>
          )}

          {/* Voice error */}
          {lessonStarted && voiceError && (
            <p style={{ color: "#f44336", marginTop: "16px" }}>{voiceError}</p>
          )}

          {/* Next button (shows when conversation is done) */}
          {lessonStarted && feedback && !feedback.shouldContinue && voiceState === "idle" && (
            <button
              className="btn btn-primary"
              onClick={handleNext}
              style={{ marginTop: "24px", padding: "16px 32px", fontSize: "1.1rem" }}
            >
              {currentIndex < lesson.prompts.length - 1 ? "Next Question →" : "Finish Lesson 🎉"}
            </button>
          )}
        </div>

        {/* CSS for pulse animation */}
        <style>{`
          @keyframes pulse {
            0%, 100% { transform: scale(1); opacity: 1; }
            50% { transform: scale(1.1); opacity: 0.8; }
          }
        `}</style>
      </div>
    );
  }

  // Type mode UI (original)
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
        <h2>{currentPrompt.input}</h2>

        {!feedback ? (
          <>
            <div className="question-input">
              <textarea
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Type your answer here..."
                disabled={submitting}
              />
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
                disabled={submitting || (showHint && hintIndex >= currentPrompt.hints.length - 1)}
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
              <div style={{ maxHeight: "300px", overflowY: "auto", marginBottom: "16px" }}>
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
                      {msg.role === "coach" && <span style={{ marginRight: "8px" }}>🤖</span>}
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
                </div>
              )}
            </div>

            <div className="nav-buttons">
              <button className="btn btn-primary" onClick={handleNext}>
                {currentIndex < lesson.prompts.length - 1 ? "Next Question →" : "Finish Lesson 🎉"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
