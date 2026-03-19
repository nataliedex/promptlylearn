import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate, useSearchParams, Link } from "react-router-dom";
import {
  getLesson,
  getSession,
  updateSession,
  getCoachFeedback,
  continueCoachConversation,
  getVideoCoachTurn,
  markAssignmentCompleted,
  uploadVideo,
  getStudentProfilePublic,
  type Lesson as LessonType,
  type Session,
  type PromptResponse,
  type ConversationMessage,
  type CoachFeedbackResponse,
  type VideoResponse,
  type PacePreference,
  type CoachHelpStyle,
} from "../services/api";
import { buildStudentLessonConfig, type StudentLessonConfig } from "../domain/studentLessonConfig";
import { useVoice } from "../hooks/useVoice";
import { useAutoSave, getLocalStorageDraft, clearDraftEverywhere } from "../hooks/useAutoSave";
import { useToast } from "../components/Toast";
import ModeToggle from "../components/ModeToggle";
import VideoRecorder from "../components/VideoRecorder";
import VideoConversationRecorder, { type ConversationTurn } from "../components/VideoConversationRecorder";
import Header from "../components/Header";
import {
  computeVideoCoachAction,
  deriveVideoOutcome,
  shouldApplyMasteryStop,
  type VideoEndReason,
} from "../domain/videoCoachStateMachine";

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

  // Video/Voice hint state (separate from typed mode hint state)
  const [videoHintUsed, setVideoHintUsed] = useState(false);
  const [videoHintIndex, setVideoHintIndex] = useState(0);
  const [videoHintDeclineCount, setVideoHintDeclineCount] = useState(0);
  const [videoHintOfferPending, setVideoHintOfferPending] = useState(false);

  // Video state machine tracking
  const [videoAttemptCount, setVideoAttemptCount] = useState(0);
  const [videoFollowUpCount, setVideoFollowUpCount] = useState(0);
  const [lastLLMScore, setLastLLMScore] = useState<number | undefined>(undefined);
  const [videoEndReason, setVideoEndReason] = useState<VideoEndReason | undefined>(undefined);

  // Draft video state for preview resume
  const [draftVideoMeta, setDraftVideoMeta] = useState<VideoResponse | null>(null);
  const [resumeVideoPreview, setResumeVideoPreview] = useState(false);
  const [resumeSessionSummary, setResumeSessionSummary] = useState<string | undefined>(undefined);

  // Refs that mirror state for stale-closure safety:
  // generateVideoCoachResponse is captured by VCR's silence-detection setTimeout,
  // which means it can close over stale state. These refs are updated synchronously
  // so the callback always reads fresh values.
  const videoAttemptCountRef = useRef(0);
  const videoFollowUpCountRef = useRef(0);
  const videoHintOfferPendingRef = useRef(false);
  const videoHintIndexRef = useRef(0);
  const videoHintDeclineCountRef = useRef(0);

  // Latest server-computed teacher summary (built from step accumulation — most accurate)
  const latestServerSummaryRef = useRef<string | undefined>(undefined);

  // Student lesson config (pacing + coach style)
  const [lessonConfig, setLessonConfig] = useState<StudentLessonConfig>(buildStudentLessonConfig());

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
    speakStream,
    stopSpeaking,
    cancelRecording,
    preWarmAudio,
    lastSpeakPath,
    lastSpeakError,
  } = useVoice();

  // Auto-save hook
  const { showToast } = useToast();
  const { updateSnapshot, saveDraft } = useAutoSave({
    sessionId,
    enabled: !!session && session.status !== "completed",
  });

  // Resume modal state
  const [showResumeModal, setShowResumeModal] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<Session["draftState"] | null>(null);

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

  // Keep auto-save snapshot in sync with current state
  useEffect(() => {
    updateSnapshot({
      answer,
      followUpAnswer,
      conversationHistory,
      feedback,
      showHint,
      hintIndex,
      currentIndex,
      mode,
      videoAttemptCount,
      videoFollowUpCount,
      videoHintUsed: videoHintUsed,
      videoHintIndex,
      videoPhase: resumeVideoPreview ? "preview" : undefined,
      videoRecordedDuration: draftVideoMeta?.durationSec,
      videoSessionSummary: resumeSessionSummary,
      videoBlobKey: draftVideoMeta?.url,
    });
  }, [
    answer, followUpAnswer, conversationHistory, feedback,
    showHint, hintIndex, currentIndex, mode,
    videoAttemptCount, videoFollowUpCount, videoHintUsed, videoHintIndex,
    resumeVideoPreview, draftVideoMeta, resumeSessionSummary,
    updateSnapshot,
  ]);

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

        // Load student profile for pacing + coach style config (non-blocking)
        if (studentId) {
          getStudentProfilePublic(studentId)
            .then((profile) => {
              setLessonConfig(buildStudentLessonConfig(
                profile.pacePreference as PacePreference | undefined,
                profile.coachHelpStyle as CoachHelpStyle | undefined,
              ));
            })
            .catch(() => { /* Use defaults */ });
        }
        setCurrentIndex(sessionData.currentPromptIndex || 0);

        // Check for resumable draft regardless of session status
        // (Dashboard may show Resume based on localStorage even if server is still "in_progress")
        if (sessionData.status !== "completed") {
          const serverDraft = sessionData.draftState;
          const lsDraft = getLocalStorageDraft(sessionId);
          // Pick the most recent draft
          let draft = serverDraft;
          if (lsDraft?.draftState) {
            if (!draft || (lsDraft.draftState.savedAt > (draft.savedAt || ""))) {
              draft = lsDraft.draftState;
            }
          }

          if (draft) {
            console.log(`[DraftAttempt] loadData found draft sessionId=${sessionId} status=${sessionData.status} serverDraft=${!!serverDraft} lsDraft=${!!lsDraft}`);
            setIsResuming(true);
            // Restore mode from session or draft
            if (sessionData.mode) {
              setMode(sessionData.mode);
            } else if (lsDraft?.mode) {
              setMode(lsDraft.mode as "voice" | "type" | "video");
            }
            setPendingDraft(draft);
            setShowResumeModal(true);
          } else if (sessionData.status === "paused") {
            // Paused but no draft — resume normally
            console.log(`[DraftAttempt] loadData paused but no draft, resuming sessionId=${sessionId}`);
            await updateSession(sessionId, { status: "in_progress" });
            setSession((prev) => prev ? { ...prev, status: "in_progress" } : null);
          }
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
        hintCountUsed: showHint ? hintIndex + 1 : undefined, // hintIndex is 0-based, so +1 for count
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
        draftState: undefined, // Clear draft — answer is now persisted
      });

      // Clear any localStorage draft too
      if (sessionId) clearDraftEverywhere(sessionId);

      setSession((prev) =>
        prev
          ? { ...prev, submission: { ...prev.submission, responses: updatedResponses }, draftState: undefined }
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
      let videoMetadata: VideoResponse;

      // Reuse draft video metadata if available (resume submit — no re-upload needed)
      if (draftVideoMeta && videoBlob.size === 0) {
        console.log("[Lesson] Reusing draft video metadata (no re-upload)", draftVideoMeta.url);
        videoMetadata = draftVideoMeta;
      } else {
        console.log("[Lesson] Uploading video conversation...", {
          studentId,
          assignmentId: session.submission.assignmentId,
          promptId: currentPrompt.id,
          durationSec,
          kind: "coach_convo",
        });
        // Upload the video and get metadata (use "coach_convo" for conversation videos to get 120s limit)
        videoMetadata = await uploadVideo(
          videoBlob,
          studentId,
          session.submission.assignmentId,
          currentPrompt.id,
          durationSec,
          "coach_convo"
        );
      }
      console.log("[Lesson] Video metadata ready:", videoMetadata);

      // Build a summary of the conversation for session storage
      const coachTurns = turns.filter(t => t.role === "coach").length;
      const conversationSummary = `[Video conversation: ${coachTurns} coach prompts, ${durationSec}s duration]`;

      // Derive outcome from state machine — no fabricated scores
      const outcome = deriveVideoOutcome({
        lastScore: lastLLMScore,
        hintUsed: videoHintUsed,
        endReason: videoEndReason,
      });

      if (process.env.NODE_ENV === "development") {
        console.log("[VideoSM] deriveVideoOutcome result", outcome);
        if (outcome.score === undefined) {
          console.log("[VideoSM] Storing needs-review due to missing score");
        }
      }

      const closureResponse = {
        feedback: "Your response has been submitted.",
        score: outcome.score ?? 0, // 0 for display only; session uses real score
        isCorrect: outcome.isCorrect,
        encouragement: outcome.isCorrect ? "Good work." : "Keep practicing.",
        shouldContinue: false,
      };

      setFeedback(closureResponse);
      setConversationHistory([]);

      // DEV LOGGING: Hint persistence
      if (process.env.NODE_ENV === "development") {
        console.log("[TalkHint] persisting video response", {
          promptId: currentPrompt.id,
          studentId,
          sessionId: session.id,
          hintUsed: videoHintUsed,
          hintCountUsed: videoHintIndex,
        });
      }

      // Update session with video response (include conversation metadata)
      const response: PromptResponse = {
        promptId: currentPrompt.id,
        response: conversationSummary,
        hintUsed: videoHintUsed,
        hintCountUsed: videoHintIndex > 0 ? videoHintIndex : undefined, // Only persist if hints were used
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
        draftState: undefined, // Clear draft — answer is now persisted
      });

      // Clear any localStorage draft too
      if (sessionId) clearDraftEverywhere(sessionId);

      setSession((prev) =>
        prev
          ? { ...prev, submission: { ...prev.submission, responses: updatedResponses }, draftState: undefined }
          : null
      );

      // Reset video mode state
      setVideoModeStarted(false);
      setCoachAskedQuestion(false);
      setDraftVideoMeta(null);
      setResumeVideoPreview(false);
      setResumeSessionSummary(undefined);
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
        draftState: undefined, // Clear any draft on completion
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

      // Clear any localStorage draft
      if (sessionId) clearDraftEverywhere(sessionId);

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
      // Reset video/voice hint state for next question
      setVideoHintUsed(false);
      setVideoHintIndex(0);
      setVideoHintDeclineCount(0);
      setVideoHintOfferPending(false);
      setVideoAttemptCount(0);
      setVideoFollowUpCount(0);
      setLastLLMScore(undefined);
      setVideoEndReason(undefined);
      // Reset refs too (stale-closure safety)
      videoAttemptCountRef.current = 0;
      videoFollowUpCountRef.current = 0;
      videoHintOfferPendingRef.current = false;
      videoHintIndexRef.current = 0;
      videoHintDeclineCountRef.current = 0;
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

  // Sync VCR conversation turns to Lesson.tsx conversationHistory for auto-save
  const handleVideoConversationUpdate = useCallback((turns: ConversationTurn[]) => {
    setConversationHistory(turns.map(t => ({
      role: t.role as "student" | "coach",
      message: t.message,
    })));
  }, []);

  // Called when VCR finishes recording — upload blob as draft video and persist metadata
  const handleDraftVideoReady = useCallback(async (data: {
    videoBlob: Blob; durationSec: number; turns: ConversationTurn[]; summary: string | null;
  }) => {
    if (!session || !studentId || !currentPrompt) return;
    try {
      console.log("[Lesson] Uploading draft video...", { size: data.videoBlob.size, duration: data.durationSec });
      const meta = await uploadVideo(
        data.videoBlob,
        studentId,
        session.submission.assignmentId,
        currentPrompt.id,
        data.durationSec,
        "coach_convo"
      );
      setDraftVideoMeta(meta);
      console.log("[Lesson] Draft video uploaded, saving metadata to session", meta.url);

      // Persist preview state to session draft so resume knows to show preview
      await updateSession(session.id, {
        draftState: {
          conversationHistory: data.turns.map(t => ({ role: t.role as "student" | "coach", message: t.message })),
          vcrPhase: "preview",
          recordedDuration: data.durationSec,
          videoDraft: meta,
          sessionSummary: data.summary || undefined,
          videoAttemptCount: videoAttemptCount || undefined,
          videoFollowUpCount: videoFollowUpCount || undefined,
          videoHintUsed: videoHintUsed || undefined,
          videoHintIndex: videoHintIndex || undefined,
          savedAt: new Date().toISOString(),
        },
        status: "paused",
        currentPromptIndex: currentIndex,
        mode: "video",
        pausedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error("[Lesson] Draft video upload failed:", err);
      // Non-fatal — student can still submit from preview, it'll upload fresh
    }
  }, [session, studentId, currentPrompt, currentIndex, videoAttemptCount, videoFollowUpCount, videoHintUsed, videoHintIndex]);

  // Called when student re-records — delete draft video and clear draft state
  const handleReRecordDraft = useCallback(async () => {
    setDraftVideoMeta(null);
    setResumeVideoPreview(false);
    setResumeSessionSummary(undefined);
    if (session?.id) {
      try {
        await updateSession(session.id, { draftState: undefined });
      } catch { /* non-fatal */ }
    }
  }, [session?.id]);

  // Exit with auto-save: save draft and mark session as paused, then navigate to dashboard
  const handleExitWithSave = async () => {
    if (!studentId) return;

    // Stop audio/recording (same cleanup as handleTakeBreak)
    if (isSpeaking) stopSpeaking();
    if (isRecording) cancelRecording();
    setVoiceState("idle");
    isProcessingRef.current = false;

    // Save draft (writes draft state to server or localStorage)
    const savedToServerDraft = await saveDraft(false);

    // ALWAYS pause the server session — regardless of whether saveDraft succeeded.
    // saveDraft's server endpoint sets status="paused", but if it failed or only
    // wrote to localStorage, the session may still be "in_progress" on the server.
    // The dashboard checks session.status === "paused" to show Resume.
    if (sessionId) {
      try {
        await updateSession(sessionId, {
          status: "paused",
          currentPromptIndex: currentIndex,
          mode: mode,
          pausedAt: new Date().toISOString(),
        });
        console.log(`[DraftAttempt] paused sessionId=${sessionId} status=paused savedToServerDraft=${savedToServerDraft}`);
      } catch {
        console.warn(`[DraftAttempt] paused sessionId=${sessionId} updateSession failed, savedToServerDraft=${savedToServerDraft}`);
        if (!savedToServerDraft) {
          showToast("Your progress was saved locally. It will sync when you reconnect.", "info");
        }
      }
    }

    navigate(`/student/${studentId}`);
  };

  // Resume from draft: restore all state from the saved draft
  const handleResumeFromDraft = async () => {
    if (!pendingDraft || !sessionId) return;

    console.log(`[DraftAttempt] loaded key=session:${sessionId} promptIndex=${currentIndex} mode=${mode} coachTurnCount=${pendingDraft.conversationHistory?.length || 0} vcrPhase=${pendingDraft.vcrPhase || "none"}`);

    // Restore state from draft
    if (pendingDraft.answer) setAnswer(pendingDraft.answer);
    if (pendingDraft.followUpAnswer) setFollowUpAnswer(pendingDraft.followUpAnswer);
    if (pendingDraft.conversationHistory) {
      setConversationHistory(
        pendingDraft.conversationHistory as ConversationMessage[]
      );
    }
    if (pendingDraft.feedback) {
      setFeedback(pendingDraft.feedback as CoachFeedbackResponse);
    }
    if (pendingDraft.showHint) {
      setShowHint(true);
      setHintIndex(pendingDraft.hintIndex || 0);
    }
    if (pendingDraft.videoAttemptCount) {
      setVideoAttemptCount(pendingDraft.videoAttemptCount);
      videoAttemptCountRef.current = pendingDraft.videoAttemptCount;
    }
    if (pendingDraft.videoFollowUpCount) {
      setVideoFollowUpCount(pendingDraft.videoFollowUpCount);
      videoFollowUpCountRef.current = pendingDraft.videoFollowUpCount;
    }
    if (pendingDraft.videoHintUsed) {
      setVideoHintUsed(true);
    }
    if (pendingDraft.videoHintIndex) {
      setVideoHintIndex(pendingDraft.videoHintIndex);
      videoHintIndexRef.current = pendingDraft.videoHintIndex;
    }

    // Video preview resume: restore draft video metadata and mount VCR in preview
    if (pendingDraft.vcrPhase === "preview" && pendingDraft.videoDraft) {
      console.log(`[DraftAttempt] resuming into video preview, draftUrl=${pendingDraft.videoDraft.url}`);
      setDraftVideoMeta(pendingDraft.videoDraft as VideoResponse);
      setResumeVideoPreview(true);
      setResumeSessionSummary(pendingDraft.sessionSummary);
    }

    // Clear draft and resume session (but keep draftState cleared — we've extracted what we need)
    clearDraftEverywhere(sessionId);
    await updateSession(sessionId, { status: "in_progress", draftState: undefined });
    setSession((prev) => prev ? { ...prev, status: "in_progress", draftState: undefined } : null);
    setShowResumeModal(false);
    setPendingDraft(null);
  };

  // Start fresh: discard draft and resume at current question with clean state
  const handleStartFresh = async () => {
    if (!sessionId) return;

    console.log(`[DraftAttempt] cleared key=session:${sessionId} (start fresh)`);
    clearDraftEverywhere(sessionId);
    await updateSession(sessionId, { status: "in_progress", draftState: undefined });
    setSession((prev) => prev ? { ...prev, status: "in_progress", draftState: undefined } : null);
    setShowResumeModal(false);
    setPendingDraft(null);
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

  // Resume modal: shown when returning to a paused session with draft data
  if (showResumeModal) {
    return (
      <div className="container" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>
        <div style={{
          background: "var(--bg-primary, white)",
          borderRadius: "12px",
          padding: "32px",
          maxWidth: "420px",
          width: "100%",
          textAlign: "center",
          boxShadow: "0 4px 24px rgba(0,0,0,0.12)",
        }}>
          <h2 style={{ marginBottom: "8px", fontSize: "1.25rem" }}>Welcome back!</h2>
          <p style={{ color: "var(--text-secondary, #666)", marginBottom: "24px", fontSize: "0.95rem" }}>
            You have unsaved work on question {currentIndex + 1}. Would you like to continue where you left off?
          </p>
          <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
            <button
              className="btn btn-secondary"
              onClick={handleStartFresh}
              style={{ padding: "10px 20px" }}
            >
              Start Fresh
            </button>
            <button
              className="btn btn-primary"
              onClick={handleResumeFromDraft}
              style={{ padding: "10px 20px" }}
            >
              Resume
            </button>
          </div>
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
          onBack={handleExitWithSave}
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
              <p style={{ color: "var(--text-secondary)", marginBottom: "32px" }}>
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
                    background: "#3d5a80",
                    margin: "0 auto 16px",
                    animation: "pulse 1.5s infinite",
                  }}
                />
                <p style={{ fontSize: "1.2rem", color: "#3d5a80" }}>Coach is speaking...</p>
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
                <p style={{ fontSize: "1rem", color: "var(--text-secondary)", marginTop: "8px" }}>
                  Tap anywhere when done speaking
                </p>
              </div>
            )}

            {voiceState === "processing" && (
              <div className="voice-indicator processing">
                <div className="loading-spinner" style={{ margin: "0 auto 16px" }}></div>
                <p style={{ fontSize: "1.2rem", color: "var(--text-secondary)" }}>
                  {isTranscribing ? "Transcribing..." : "Thinking..."}
                </p>
              </div>
            )}

            {voiceState === "idle" && !feedback && (
              <div className="voice-indicator idle">
                <p style={{ fontSize: "1rem", color: "var(--text-secondary)" }}>Starting voice interaction...</p>
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
                background: "#1e293b",
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
                e.currentTarget.style.background = "#334155";
                e.currentTarget.style.transform = "translateY(-1px)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "#1e293b";
                e.currentTarget.style.transform = "translateY(0)";
              }}
            >
              Take a break
            </button>
            <p style={{ marginTop: "8px", fontSize: "0.85rem", color: "var(--text-muted)" }}>
              You can take a break anytime.
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
    videoGradeLevel?: string,
    timeRemainingSec?: number
  ): Promise<{ response: string; shouldContinue: boolean; turnKind?: string; wrapReason?: string; criteriaStatus?: string; instructionalRecap?: string; completionRatio?: number }> => {
    if (!lessonId || !currentPrompt) {
      return { response: "Can you tell me more about your thinking?", shouldContinue: true };
    }

    const studentResponses = transcript.filter(t => t.role === "student");
    const latestStudentResponse = studentResponses[studentResponses.length - 1]?.message || "";

    const hints = currentPrompt.hints || [];

    // Extract the last coach question from transcript for context-aware validation
    const coachTurnsForContext = transcript.filter(t => t.role === "coach" && t.message.includes("?"));
    const lastCoachQ = coachTurnsForContext.length > 0
      ? coachTurnsForContext[coachTurnsForContext.length - 1].message
      : undefined;

    // Extract activeMathQuestion: the last coach sub-question that contains numbers
    // and is a genuine math question (not a hint offer or retry prompt).
    // This survives no-speech retries and hint offers so context-aware validation
    // still works after procedural interruptions.
    const PROCEDURAL_PREFIXES = /didn't catch|would you like a hint|want to give it|try again|try answering/i;
    const mathCoachQuestions = transcript.filter(t =>
      t.role === "coach" &&
      t.message.includes("?") &&
      /\d/.test(t.message) &&
      !PROCEDURAL_PREFIXES.test(t.message)
    );
    const activeMathQ = mathCoachQuestions.length > 0
      ? mathCoachQuestions[mathCoachQuestions.length - 1].message
      : undefined;

    // Build state for the state machine — read from REFS (not React state)
    // to avoid stale closures when VCR calls this via setTimeout
    const smState = {
      latestStudentResponse,
      attemptCount: videoAttemptCountRef.current,
      hintOfferPending: videoHintOfferPendingRef.current,
      hintIndex: videoHintIndexRef.current,
      hintDeclineCount: videoHintDeclineCountRef.current,
      hintsAvailable: hints,
      maxAttempts: 3,
      questionText: currentPrompt.input,
      followUpCount: videoFollowUpCountRef.current,
      lastCoachQuestion: lastCoachQ,
      activeMathQuestion: activeMathQ,
      // Backend derives reasoningSteps from mathProblem at runtime (backfill).
      // Frontend must match: if mathProblem exists, backend WILL have reasoning steps.
      hasReasoningSteps: !!(currentPrompt.assessment?.reasoningSteps?.length) || !!currentPrompt.mathProblem,
    };

    if (process.env.NODE_ENV === "development") {
      console.log("[VideoSM] generateVideoCoachResponse input state", smState);
    }

    const action = computeVideoCoachAction(smState);

    // Capture locally BEFORE setState — React batches updates,
    // so videoAttemptCount would be stale during resolvePostEvaluation.
    const nextAttemptCount = action.stateUpdates.attemptCount;

    if (process.env.NODE_ENV === "development") {
      console.log(
        "[VideoFlow] SM action=" + action.type +
        " utteranceIntent=" + (action.utteranceIntent ?? "N/A") +
        " evaluationSkipped=" + (action.type !== "EVALUATE_ANSWER") +
        " shouldContinue=" + action.shouldContinue +
        " attemptCount(" + videoAttemptCountRef.current + "->" + nextAttemptCount + ")" +
        " hintOfferPending(" + videoHintOfferPendingRef.current + "->" + action.stateUpdates.hintOfferPending + ")" +
        " coachTurnCount=N/A(Lesson.tsx)"
      );
    }

    // Apply state updates from the state machine
    // Update REFS first (synchronous — survives stale closures)
    videoAttemptCountRef.current = nextAttemptCount;
    videoHintOfferPendingRef.current = action.stateUpdates.hintOfferPending;
    videoHintIndexRef.current = action.stateUpdates.hintIndex;
    videoHintDeclineCountRef.current = action.stateUpdates.hintDeclineCount;
    // Then update React state (for UI rendering)
    setVideoAttemptCount(nextAttemptCount);
    setVideoHintOfferPending(action.stateUpdates.hintOfferPending);
    setVideoHintIndex(action.stateUpdates.hintIndex);
    setVideoHintDeclineCount(action.stateUpdates.hintDeclineCount);
    if (action.stateUpdates.hintUsed) {
      setVideoHintUsed(true);
    }

    // Track end reason for outcome derivation
    if (action.endReason) {
      setVideoEndReason(action.endReason);
      console.log("[VideoSM] Ending due to:", action.endReason);
    }

    // EVALUATE_ANSWER: single combined endpoint (parallel LLM calls + server guardrails)
    if (action.type === "EVALUATE_ANSWER") {
      try {
        // Exclude the current student turn from conversationHistory — it's
        // already sent as `studentResponse`. Including it would double-count
        // the utterance in off-topic detection, step accumulation, etc.
        const historyWithoutCurrent = transcript.slice(0, -1);
        const conversationHistoryForApi: ConversationMessage[] = historyWithoutCurrent.map(t => ({
          role: t.role === "coach" ? "coach" : "student",
          message: t.message,
        }));

        // Extract ALL coach questions for probe dedup (full history)
        const coachTurns = transcript.filter(t => t.role === "coach" && t.message.includes("?"));
        const allCoachQuestions = coachTurns.map(t => t.message);
        const lastCoachQ = allCoachQuestions.length > 0 ? allCoachQuestions[allCoachQuestions.length - 1] : undefined;

        const result = await getVideoCoachTurn({
          lessonId,
          promptId: currentPrompt.id,
          studentAnswer: studentResponses[0]?.message || "",
          studentResponse: latestStudentResponse,
          conversationHistory: conversationHistoryForApi,
          gradeLevel: videoGradeLevel || lesson?.gradeLevel,
          attemptCount: nextAttemptCount,
          maxAttempts: 3,
          followUpCount: videoFollowUpCount,
          lastCoachQuestion: lastCoachQ,
          askedCoachQuestions: allCoachQuestions,
          timeRemainingSec,
          coachHelpStyle: lessonConfig.coachHelpStyle,
        });

        // Store the real LLM score
        setLastLLMScore(result.score);

        // Store the server-computed teacher summary (built from step accumulation)
        if (result.teacherSummary?.renderedSummary) {
          latestServerSummaryRef.current = result.teacherSummary.renderedSummary;
        }

        if (process.env.NODE_ENV === "development") {
          console.log(
            "[VideoFlow] video-turn:" +
            " score=" + result.score +
            " shouldContinue=" + result.shouldContinue +
            " probeFirst=" + result.probeFirst +
            " turnKind=" + (result.turnKind ?? "unknown") +
            " attemptCount=" + nextAttemptCount +
            " timeRemainingSec=" + timeRemainingSec
          );
        }

        if (result.probeFirst) {
          videoFollowUpCountRef.current += 1;
          setVideoFollowUpCount(videoFollowUpCountRef.current);
        }

        // MASTERY STOP: If the student already demonstrated mastery, don't probe further
        const masteryOverride = shouldApplyMasteryStop({
          score: result.score,
          turnKind: result.turnKind,
          attemptCount: nextAttemptCount,
          questionText: currentPrompt.input,
        });

        if (masteryOverride) {
          return {
            response: result.response,
            shouldContinue: masteryOverride.shouldContinue,
            turnKind: masteryOverride.turnKind,
            wrapReason: "server_wrap",
            criteriaStatus: result.criteriaStatus,
            serverSummary: latestServerSummaryRef.current,
            instructionalRecap: result.instructionalRecap,
            completionRatio: result.completionRatio,
          };
        }

        // CLIENT-SIDE SAFETY NET: If the server response contains a question
        // but shouldContinue=false, override to true. This prevents the session
        // from ending right after the coach asks a question.
        let finalShouldContinue = result.shouldContinue;
        if (result.response.includes("?") && !result.shouldContinue) {
          console.log(
            "[contract-violation] question + shouldContinue=false — overriding to continue |",
            "response:", result.response.slice(0, 80)
          );
          finalShouldContinue = true;
        }

        return {
          response: result.response,
          shouldContinue: finalShouldContinue,
          turnKind: result.turnKind,
          wrapReason: result.wrapReason,
          criteriaStatus: result.criteriaStatus,
          serverSummary: latestServerSummaryRef.current,
          instructionalRecap: result.instructionalRecap,
          completionRatio: result.completionRatio,
        };
      } catch (err) {
        console.error("[VideoSM] Failed to evaluate answer:", err);
        return {
          response: "That's interesting! Can you tell me a bit more about why you think that?",
          shouldContinue: true,
          turnKind: "PROBE" as const,
        };
      }
    }

    // All other actions: return pre-built response
    // CLIENT-SIDE SAFETY NET: same invariant check
    const smResponse = action.response!;
    let smContinue = action.shouldContinue;
    if (smResponse.includes("?") && !smContinue) {
      console.log(
        "[contract-violation] SM response has question + shouldContinue=false — overriding |",
        "response:", smResponse.slice(0, 80)
      );
      smContinue = true;
    }
    return {
      response: smResponse,
      shouldContinue: smContinue,
      turnKind: smContinue ? "PROBE" as const : "WRAP" as const,
    };
  };

  // Video mode UI - continuous conversation recording per question
  if (mode === "video") {

    return (
      <div className="container">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
          <button onClick={handleExitWithSave} className="back-btn" style={{ margin: 0, background: "none", border: "none", cursor: "pointer", font: "inherit", color: "inherit" }}>
            ← Exit Lesson
          </button>
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
              maxDuration={lessonConfig.timing.maxDurationSec}
              silenceDurationMs={lessonConfig.timing.silenceDurationMs}
              minSpeechBeforeSilenceMs={lessonConfig.timing.minSpeechBeforeSilenceMs}
              maxCoachTurns={5}
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
              speakStream={speakStream}
              preWarmAudio={preWarmAudio}
              lastSpeakPath={lastSpeakPath}
              lastSpeakError={lastSpeakError}
              isSpeaking={isSpeaking}
              generateCoachResponse={generateVideoCoachResponse}
              isSubmitting={videoUploading}
              isFinalQuestion={isLastQuestion}
              successCriteria={currentPrompt.assessment?.successCriteria}
              onConversationUpdate={handleVideoConversationUpdate}
              initialConversationTurns={
                conversationHistory.length > 0
                  ? conversationHistory.map((msg, i) => ({
                      role: msg.role,
                      message: msg.message,
                      timestamp: i,
                    }))
                  : undefined
              }
              onDraftVideoReady={handleDraftVideoReady}
              onReRecordDraft={handleReRecordDraft}
              initialPhase={resumeVideoPreview ? "preview" : undefined}
              initialRecordedDuration={resumeVideoPreview && draftVideoMeta ? draftVideoMeta.durationSec : undefined}
              initialVideoUrl={resumeVideoPreview && draftVideoMeta ? draftVideoMeta.url : undefined}
              initialSessionSummary={resumeSessionSummary}
              draftVideoMetadata={draftVideoMeta || undefined}
              serverSummary={latestServerSummaryRef.current}
              onKeepCoaching={(context) => {
                // Video submit is fire-and-forget from VideoConversationRecorder
                // Navigate to CoachSession with assignment context
                navigate(
                  `/student/${studentId}/coach?topics=${encodeURIComponent(
                    JSON.stringify([lesson.title, currentPrompt.input.slice(0, 50)])
                  )}&gradeLevel=${encodeURIComponent(lesson?.gradeLevel || "")}`,
                  {
                    state: {
                      fromAssignment: true,
                      transcript: context.transcript,
                      question: context.question,
                      lessonTitle: lesson.title,
                      durationSec: context.durationSec,
                      coachTurns: context.coachTurns,
                      lastScore: lastLLMScore,
                    },
                  }
                );
              }}
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
                <p style={{ margin: "0 0 16px 0", color: "var(--text-secondary)", fontSize: "0.95rem" }}>
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
                background: "#1e293b",
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
                e.currentTarget.style.background = "#334155";
                e.currentTarget.style.transform = "translateY(-1px)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "#1e293b";
                e.currentTarget.style.transform = "translateY(0)";
              }}
            >
              Take a break
            </button>
            <p style={{ marginTop: "8px", fontSize: "0.85rem", color: "var(--text-muted)" }}>
              You can take a break anytime.
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
        onBack={handleExitWithSave}
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
                      background: "#3d5a80",
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
                  <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--text-secondary)" }}>
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
                        background: msg.role === "student" ? "#3d5a80" : "#f5f5f5",
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
