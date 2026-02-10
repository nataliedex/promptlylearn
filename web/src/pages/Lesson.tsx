import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate, useSearchParams, Link } from "react-router-dom";
import {
  getLesson,
  getSession,
  updateSession,
  getCoachFeedback,
  continueCoachConversation,
  markAssignmentCompleted,
  uploadVideo,
  type Lesson as LessonType,
  type Session,
  type PromptResponse,
  type ConversationMessage,
  type CoachFeedbackResponse,
  type VideoResponse,
} from "../services/api";
import { useVoice } from "../hooks/useVoice";
import ModeToggle from "../components/ModeToggle";
import VideoRecorder from "../components/VideoRecorder";
import VideoConversationRecorder, { type ConversationTurn } from "../components/VideoConversationRecorder";
import Header from "../components/Header";

type LessonMode = "voice" | "type" | "video";
type VoiceState = "idle" | "speaking" | "listening" | "processing";
type VideoState = "permission_prompt" | "ready" | "recording" | "preview" | "uploading";

export default function Lesson() {
  const { studentId, lessonId } = useParams<{ studentId: string; lessonId: string }>();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session");
  const initialMode = (searchParams.get("mode") as LessonMode) || "type";
  const navigate = useNavigate();

  // Mode state - can be toggled during the lesson
  const [mode, setMode] = useState<LessonMode>(initialMode);

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

  // Video recording state
  const [showVideoRecorder, setShowVideoRecorder] = useState(false);
  const [videoUploading, setVideoUploading] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);

  // Video mode conversational flow state
  const [videoModeStarted, setVideoModeStarted] = useState(false);
  const [coachAskedQuestion, setCoachAskedQuestion] = useState(false);
  const [coachIsSpeaking, setCoachIsSpeaking] = useState(false);

  // Voice mode state
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceStarted, setVoiceStarted] = useState(false);
  const [lessonStarted, setLessonStarted] = useState(false); // User must click to start (browser autoplay policy)
  const [isResuming, setIsResuming] = useState(false); // Track if resuming from a paused session
  const isProcessingRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
    stopSpeaking,
    cancelRecording,
  } = useVoice();

  // Update voice state based on hook states
  useEffect(() => {
    if (isSpeaking) setVoiceState("speaking");
    else if (isRecording) setVoiceState("listening");
    else if (isTranscribing) setVoiceState("processing");
    else if (!isProcessingRef.current) setVoiceState("idle");
  }, [isSpeaking, isRecording, isTranscribing]);

  // Auto-scroll conversation to bottom when new messages appear
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversationHistory]);

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

        // Detect if this is a resumed session (was paused)
        if (sessionData.status === "paused") {
          setIsResuming(true);
          // Restore mode from when paused
          if (sessionData.mode) {
            setMode(sessionData.mode);
          }
          // Update session status back to in_progress
          await updateSession(sessionId, { status: "in_progress" });
          setSession((prev) => prev ? { ...prev, status: "in_progress" } : null);
        }
      } catch (err) {
        console.error("Failed to load lesson:", err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [lessonId, sessionId]);

  const currentPrompt = lesson?.prompts[currentIndex];

  // Determine if this is the last question in the lesson (for completion UI)
  const isLastQuestion = lesson ? currentIndex >= lesson.prompts.length - 1 : false;

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

  // Handler for toggling between voice and text mode
  const handleModeToggle = (newMode: LessonMode) => {
    if (newMode === mode) return;

    // Cancel any ongoing voice activity when switching to text mode
    if (newMode === "type" && isRecording) {
      cancelRecording();
    }

    setMode(newMode);

    // If switching to voice mode and we're ready, start voice flow
    if (newMode === "voice" && lessonStarted && currentPrompt && voiceAvailable && !feedback) {
      setVoiceStarted(false); // Reset so the effect triggers
    }
  };

  const startVoiceFlow = async () => {
    if (!currentPrompt || isProcessingRef.current) return;
    isProcessingRef.current = true;
    setVoiceState("speaking");

    console.log("=== START VOICE FLOW ===");

    // If resuming from a paused session, speak a friendly welcome back message first
    if (isResuming) {
      console.log("Resuming session - speaking welcome back...");
      const welcomeBack = "Welcome back! Let's keep going where we left off.";
      await speak(welcomeBack);
      await new Promise((r) => setTimeout(r, 300));
      setIsResuming(false); // Clear the resuming flag after welcome
    }

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

  // Video submission handler (for type mode's secondary video option)
  const handleVideoSubmit = async (videoBlob: Blob, durationSec: number) => {
    if (!currentPrompt || !session || !lessonId || !studentId) return;

    setVideoUploading(true);
    setVideoError(null);

    try {
      // Upload the video and get metadata
      const videoMetadata: VideoResponse = await uploadVideo(
        videoBlob,
        studentId,
        session.submission.assignmentId,
        currentPrompt.id,
        durationSec,
        "answer"
      );

      // Get coach feedback (using a placeholder response since video can't be transcribed yet)
      const coachResponse = await getCoachFeedback(
        lessonId,
        currentPrompt.id,
        "[Video response submitted]",
        lesson?.gradeLevel
      );

      setFeedback(coachResponse);
      setConversationHistory([
        { role: "coach", message: coachResponse.feedback },
      ]);

      // Update session with video response
      const response: PromptResponse = {
        promptId: currentPrompt.id,
        response: "[Video response]",
        hintUsed: showHint,
        inputSource: "video",
        video: videoMetadata,
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

      setShowVideoRecorder(false);
    } catch (err) {
      console.error("Failed to submit video:", err);
      setVideoError(err instanceof Error ? err.message : "Failed to upload video. Please try again.");
    } finally {
      setVideoUploading(false);
    }
  };

  // Video conversation submission handler (for video mode's conversation flow)
  const handleVideoConversationSubmit = async (
    videoBlob: Blob,
    durationSec: number,
    turns: ConversationTurn[]
  ) => {
    console.log("[Lesson] handleVideoConversationSubmit called", {
      hasBLob: !!videoBlob,
      blobSize: videoBlob?.size,
      durationSec,
      turnsCount: turns.length,
      currentPrompt: !!currentPrompt,
      session: !!session,
      lessonId,
      studentId,
    });

    // Set loading state BEFORE the guard clause so user sees feedback
    setVideoUploading(true);
    setVideoError(null);

    if (!currentPrompt || !session || !lessonId || !studentId) {
      console.error("[Lesson] Missing required data for video submission");
      setVideoError("Missing required data. Please try again.");
      setVideoUploading(false);
      return;
    }

    try {
      console.log("[Lesson] Uploading video conversation...", {
        studentId,
        assignmentId: session.submission.assignmentId,
        promptId: currentPrompt.id,
        durationSec,
        kind: "coach_convo",
      });
      // Upload the video and get metadata (use "coach_convo" for conversation videos to get 120s limit)
      const videoMetadata: VideoResponse = await uploadVideo(
        videoBlob,
        studentId,
        session.submission.assignmentId,
        currentPrompt.id,
        durationSec,
        "coach_convo"
      );
      console.log("[Lesson] Video uploaded successfully:", videoMetadata);

      // Build a summary of the conversation for session storage
      const coachTurns = turns.filter(t => t.role === "coach").length;
      const conversationSummary = `[Video conversation: ${coachTurns} coach prompts, ${durationSec}s duration]`;

      // Use deterministic closure message - no LLM call needed
      // The real conversation already happened during the video recording
      const closureResponse = {
        feedback: "Your response has been submitted.",
        score: 80, // Default positive score for completing the conversation
        isCorrect: true,
        encouragement: "Got it.",
        shouldContinue: false, // No more coach interaction after submission
      };

      setFeedback(closureResponse);
      setConversationHistory([]);

      // Update session with video response (include conversation metadata)
      const response: PromptResponse = {
        promptId: currentPrompt.id,
        response: conversationSummary,
        hintUsed: showHint,
        inputSource: "video",
        video: videoMetadata,
        // Store conversation turns in the response for teacher review
        conversationTurns: turns.map(t => ({
          role: t.role,
          message: t.message,
          timestampSec: t.timestamp,
        })),
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

      // Reset video mode state
      setVideoModeStarted(false);
      setCoachAskedQuestion(false);
    } catch (err) {
      console.error("Failed to submit video conversation:", err);
      setVideoError(err instanceof Error ? err.message : "Failed to upload video. Please try again.");
    } finally {
      setVideoUploading(false);
    }
  };

  // Video mode: Start the conversational flow by having coach ask the question
  const handleStartVideoQuestion = async () => {
    if (!currentPrompt) return;

    setVideoModeStarted(true);
    setCoachIsSpeaking(true);

    // Coach speaks the question aloud
    await speak(currentPrompt.input);

    setCoachIsSpeaking(false);
    setCoachAskedQuestion(true);
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
    if (!lesson || !session || !studentId || !lessonId) return;

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

      // Mark the assignment as completed (removes from student's active assignments)
      try {
        await markAssignmentCompleted(lessonId, studentId);
      } catch (err) {
        // Non-critical - log but don't block navigation
        console.log("Failed to mark assignment completed:", err);
      }

      // Navigate with justCompleted param for completion animation
      navigate(`/student/${studentId}?justCompleted=${lessonId}`);
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
      // Reset video mode state for next question
      setCoachAskedQuestion(false);
      setVideoError(null);
    }
  };

  // Voice mode: Skip current voice activity and advance to next question
  const handleSkipToNext = async () => {
    // Stop any active audio playback (coach speaking)
    if (isSpeaking) {
      stopSpeaking();
    }

    // Stop any active recording without transcribing
    if (isRecording) {
      cancelRecording();
    }

    // Reset voice state
    setVoiceState("idle");
    isProcessingRef.current = false;

    // Advance to next question
    await handleNext();
  };

  // Take a break: Pause the lesson and save state for later resumption
  const handleTakeBreak = async () => {
    if (!session || !studentId) return;

    // Stop any active audio playback (coach speaking)
    if (isSpeaking) {
      stopSpeaking();
    }

    // Stop any active recording without transcribing
    if (isRecording) {
      cancelRecording();
    }

    // Reset voice state immediately
    setVoiceState("idle");
    isProcessingRef.current = false;

    try {
      // Save session state as paused
      await updateSession(session.id, {
        status: "paused",
        currentPromptIndex: currentIndex,
        mode: mode,
        wasRecording: isRecording,
        pausedAt: new Date().toISOString(),
      });

      // Navigate back to dashboard
      navigate(`/student/${studentId}`);
    } catch (err) {
      console.error("Failed to pause session:", err);
      // Navigate anyway to avoid blocking the student
      navigate(`/student/${studentId}`);
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
        <Header
          mode="context"
          userType="student"
          homeLink={`/student/${studentId}`}
          breadcrumbs={[{ label: "Lesson not found" }]}
        />
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
        <Header
          mode="session"
          userType="student"
          backLink={`/student/${studentId}`}
          backLabel="Exit"
          title={lesson.title}
          progress={{ current: currentIndex + 1, total: lesson.prompts.length }}
          primaryActions={
            voiceAvailable ? (
              <ModeToggle
                mode={mode}
                onToggle={handleModeToggle}
                disabled={voiceState === "processing" || submitting}
              />
            ) : undefined
          }
        />

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
                <div
                  style={{
                    width: "48px",
                    height: "48px",
                    borderRadius: "50%",
                    background: "#667eea",
                    margin: "0 auto 16px",
                    animation: "pulse 1.5s infinite",
                  }}
                />
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
                    width: "64px",
                    height: "64px",
                    borderRadius: "50%",
                    background: "#4caf50",
                    margin: "0 auto 16px",
                    animation: "pulse 1.5s infinite",
                  }}
                />
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
                <span style={{ fontSize: "2rem" }}>{feedback.isCorrect ? "" : ""}</span>
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

          {/* Skip/Next button - visible during voice activity */}
          {lessonStarted && (voiceState === "speaking" || voiceState === "listening" || voiceState === "processing") && (
            <button
              className="btn btn-secondary"
              onClick={handleSkipToNext}
              style={{
                marginTop: "24px",
                padding: "12px 24px",
                fontSize: "1rem",
                opacity: 0.9,
              }}
            >
              {currentIndex < lesson.prompts.length - 1 ? "Skip to Next Question →" : "Finish Lesson"}
            </button>
          )}

          {/* Continue button - visible when follow-up is expected but student wants to skip */}
          {lessonStarted && feedback && feedback.shouldContinue && voiceState === "idle" && (
            <button
              className="btn btn-secondary"
              onClick={handleNext}
              style={{
                marginTop: "24px",
                padding: "12px 24px",
                fontSize: "1rem",
              }}
            >
              {currentIndex < lesson.prompts.length - 1 ? "Continue to Next Question →" : "Finish Lesson"}
            </button>
          )}

          {/* Next button (shows when conversation is done) */}
          {lessonStarted && feedback && !feedback.shouldContinue && voiceState === "idle" && (
            <button
              className="btn btn-primary"
              onClick={handleNext}
              style={{ marginTop: "24px", padding: "16px 32px", fontSize: "1.1rem" }}
            >
              {currentIndex < lesson.prompts.length - 1 ? "Next Question →" : "Finish Lesson"}
            </button>
          )}
        </div>

        {/* Take a break button - visible during active lesson, hidden on final question completion */}
        {lessonStarted && !(isLastQuestion && feedback && !feedback.shouldContinue) && (
          <div style={{ marginTop: "16px", textAlign: "center" }}>
            <button
              onClick={handleTakeBreak}
              style={{
                padding: "14px 28px",
                fontSize: "1rem",
                fontWeight: 600,
                background: "#1a1a2e",
                color: "#ffffff",
                border: "none",
                borderRadius: "10px",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "10px",
                boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                transition: "background 0.2s, transform 0.1s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#2d2d44";
                e.currentTarget.style.transform = "translateY(-1px)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "#1a1a2e";
                e.currentTarget.style.transform = "translateY(0)";
              }}
            >
              Take a break
            </button>
            <p style={{ marginTop: "8px", fontSize: "0.85rem", color: "#888" }}>
              Your progress is saved. Come back anytime!
            </p>
          </div>
        )}

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

  // Generate coach response for video conversation based on transcript
  const generateVideoCoachResponse = async (
    question: string,
    transcript: Array<{ role: "coach" | "student"; message: string; timestamp: number }>,
    videoGradeLevel?: string
  ): Promise<{ response: string; shouldContinue: boolean }> => {
    if (!lessonId || !currentPrompt) {
      return { response: "Can you tell me more about your thinking?", shouldContinue: true };
    }

    try {
      // Get the student's responses from transcript
      const studentResponses = transcript.filter(t => t.role === "student");
      const latestStudentResponse = studentResponses[studentResponses.length - 1]?.message || "";

      // Convert transcript to ConversationMessage format for the API
      const conversationHistory: ConversationMessage[] = transcript.map(t => ({
        role: t.role === "coach" ? "coach" : "student",
        message: t.message,
      }));

      // Call the coach API
      const coachResponse = await continueCoachConversation(
        lessonId,
        currentPrompt.id,
        studentResponses[0]?.message || "", // original answer
        latestStudentResponse,
        conversationHistory,
        videoGradeLevel || lesson?.gradeLevel
      );

      // Combine feedback and follow-up question for the response
      const response = coachResponse.followUpQuestion
        ? `${coachResponse.feedback} ${coachResponse.followUpQuestion}`
        : coachResponse.feedback;

      return {
        response,
        shouldContinue: coachResponse.shouldContinue ?? false,
      };
    } catch (err) {
      console.error("Failed to generate coach response:", err);
      // Return a generic encouraging response on error
      return {
        response: "That's interesting! Can you tell me a bit more about why you think that?",
        shouldContinue: true,
      };
    }
  };

  // Video mode UI - continuous conversation recording per question
  if (mode === "video") {

    return (
      <div className="container">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
          <Link to={`/student/${studentId}`} className="back-btn" style={{ margin: 0 }}>
            ← Exit Lesson
          </Link>
        </div>

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

        {/* Video conversation card */}
        <div className="card">
          {!feedback ? (
            <VideoConversationRecorder
              maxDuration={120}
              maxCoachTurns={3}
              question={currentPrompt.input}
              gradeLevel={lesson?.gradeLevel}
              onStartRecording={() => {
                setVideoModeStarted(true);
              }}
              onStopRecording={handleVideoConversationSubmit}
              onError={(error) => {
                setVideoError(error);
              }}
              onSwitchToTyping={() => {
                setMode("type");
                setVideoModeStarted(false);
                setCoachAskedQuestion(false);
              }}
              speak={speak}
              isSpeaking={isSpeaking}
              generateCoachResponse={generateVideoCoachResponse}
              isSubmitting={videoUploading}
            />
          ) : (
            <>
              {/* Closure screen after video conversation submission */}
              <div style={{ textAlign: "center", padding: "24px 16px" }}>
                {/* Success indicator */}
                <div
                  style={{
                    width: "64px",
                    height: "64px",
                    borderRadius: "50%",
                    background: "#e8f5e9",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    margin: "0 auto 16px",
                  }}
                >
                  <span style={{ fontSize: "2rem" }}>🎉</span>
                </div>

                {/* Title */}
                <h3 style={{ margin: "0 0 8px 0", color: "#2e7d32", fontSize: "1.3rem" }}>
                  {isLastQuestion ? "Lesson complete!" : "Response submitted"}
                </h3>

                {/* Subtitle */}
                <p style={{ margin: "0 0 16px 0", color: "#666", fontSize: "0.95rem" }}>
                  Your teacher will review your video.
                </p>

                {/* Closure message */}
                <div
                  style={{
                    padding: "12px 20px",
                    background: "#f5f5f5",
                    borderRadius: "12px",
                    display: "inline-block",
                    marginBottom: "24px",
                  }}
                >
                  <p style={{ margin: 0, color: "#333", fontSize: "0.9rem" }}>
                    {isLastQuestion
                      ? "You've completed this lesson. Your teacher will review your responses."
                      : "Your response has been submitted."}
                  </p>
                </div>
              </div>

              <div className="nav-buttons">
                <button className="btn btn-primary" onClick={handleNext}>
                  {currentIndex < lesson.prompts.length - 1 ? "Next Question →" : "Finish Lesson"}
                </button>
              </div>
            </>
          )}
        </div>

        {/* Take a break button - only show when not in active recording and not on final question completion */}
        {!videoModeStarted && !isLastQuestion && (
          <div style={{ marginTop: "16px", textAlign: "center" }}>
            <button
              onClick={handleTakeBreak}
              style={{
                padding: "14px 28px",
                fontSize: "1rem",
                fontWeight: 600,
                background: "#1a1a2e",
                color: "#ffffff",
                border: "none",
                borderRadius: "10px",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "10px",
                boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                transition: "background 0.2s, transform 0.1s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#2d2d44";
                e.currentTarget.style.transform = "translateY(-1px)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "#1a1a2e";
                e.currentTarget.style.transform = "translateY(0)";
              }}
            >
              Take a break
            </button>
            <p style={{ marginTop: "8px", fontSize: "0.85rem", color: "#888" }}>
              Your progress is saved. Come back anytime!
            </p>
          </div>
        )}
      </div>
    );
  }

  // Type mode UI (original)
  return (
    <div className="container">
      <Header
        mode="session"
        userType="student"
        backLink={`/student/${studentId}`}
        backLabel="Exit"
        title={lesson.title}
        progress={{ current: currentIndex + 1, total: lesson.prompts.length }}
        primaryActions={
          voiceAvailable ? (
            <ModeToggle
              mode={mode}
              onToggle={handleModeToggle}
              disabled={submitting || isConversing}
            />
          ) : undefined
        }
      />

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
            {/* Video Recorder - shown when recording video */}
            {showVideoRecorder ? (
              <div style={{ marginTop: "16px" }}>
                <VideoRecorder
                  maxDuration={60}
                  onSubmit={handleVideoSubmit}
                  onCancel={() => {
                    setShowVideoRecorder(false);
                    setVideoError(null);
                  }}
                  isSubmitting={videoUploading}
                  error={videoError}
                />
              </div>
            ) : (
              <>
                {/* Text input area */}
                <div className="question-input">
                  <textarea
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    placeholder="Type your answer here..."
                    disabled={submitting}
                  />
                </div>

                {/* Video option */}
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                  margin: "12px 0",
                  padding: "12px",
                  background: "#f8f9fa",
                  borderRadius: "8px",
                }}>
                  <span style={{ color: "#6b7280", fontSize: "0.9rem" }}>Or</span>
                  <button
                    onClick={() => setShowVideoRecorder(true)}
                    disabled={submitting}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "8px",
                      padding: "8px 16px",
                      fontSize: "0.9rem",
                      fontWeight: 500,
                      background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                      color: "white",
                      border: "none",
                      borderRadius: "8px",
                      cursor: submitting ? "not-allowed" : "pointer",
                      opacity: submitting ? 0.5 : 1,
                    }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M23 7l-7 5 7 5V7z" />
                      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                    </svg>
                    Record Video Response
                  </button>
                </div>

                {/* Hints */}
                {showHint && currentPrompt.hints.length > 0 && (
                  <div className="hint-section">
                    <h4>Hint</h4>
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
            )}
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
                <span style={{ fontSize: "1.5rem" }}>{feedback.isCorrect ? "" : ""}</span>
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
                      {msg.role === "coach" && <span style={{ marginRight: "8px", fontWeight: 600 }}>Coach:</span>}
                      {msg.message}
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
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
                {currentIndex < lesson.prompts.length - 1 ? "Next Question →" : "Finish Lesson"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
