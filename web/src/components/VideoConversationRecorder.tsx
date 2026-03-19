/**
 * VideoConversationRecorder Component
 *
 * Records a truly interactive video conversation between student and coach.
 * Uses Web Speech API to transcribe student speech in real-time, then
 * generates contextual coach responses based on what the student said.
 *
 * Flow per question:
 * 1. Coach speaks the question (TTS)
 * 2. Student responds (speech recognition captures transcript)
 * 3. Silence detection auto-detects when student stops speaking (1.1s silence)
 * 4. Transcript sent to coach API → generates contextual follow-up
 * 5. Coach speaks follow-up (TTS)
 * 6. Repeat until max turns or coach ends conversation
 *
 * State Flow:
 *   IDLE → REQUESTING → READY → COACH_SPEAKING ⇄ STUDENT_TURN ⇄ PROCESSING
 *                                     ↓
 *                            SESSION_EXPIRING (flag, not a phase)
 *                                     ↓
 *                               SESSION_WRAP (phase)
 *                                     ↓
 *                             SESSION_COMPLETE (preview phase)
 *                               ↙        ↓           ↘
 *                        SUBMIT    KEEP_COACHING    RE_RECORD
 *                     (onStopRec)  (onKeepCoaching)  (handleReRecord)
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { summarizeStudentTranscript, extractContentWords, detectTopics, hasForeignKeyword, buildEvidenceSummary, formatEvidenceSummary, buildMathStepSummary } from "../utils/summarizeTranscript";
import { decidePostCoachAction, buildClosingStatement, CLOSING_WINDOW_SEC, WRAP_BUFFER_SEC, type VideoTurnKind, type WrapReason } from "../domain/wrapDecision";
import { containsMathContent, isInterrogativeMathAnswer } from "../domain/videoCoachStateMachine";


export interface ConversationTurn {
  role: "coach" | "student";
  message: string;
  timestamp: number; // seconds into recording
}

export interface VideoConversationRecorderProps {
  /** Maximum recording duration in seconds (default: 120 = 2 minutes) */
  maxDuration?: number;
  /** Maximum coach turns before ending (default: 5) */
  maxCoachTurns?: number;
  /** The question text to display */
  question: string;
  /** Grade level for coach context */
  gradeLevel?: string;
  /** Called when recording starts */
  onStartRecording?: () => void;
  /** Called when recording stops with the blob, duration, and transcript */
  onStopRecording: (videoBlob: Blob, durationSec: number, turns: ConversationTurn[]) => void;
  /** Called on error */
  onError?: (error: string) => void;
  /** Called to switch to typing mode */
  onSwitchToTyping: () => void;
  /** TTS speak function from useVoice hook */
  speak: (text: string) => Promise<boolean>;
  /** Streaming TTS function — lower time-to-first-audio, auto-falls back to blob */
  speakStream?: (text: string) => Promise<boolean>;
  /** Pre-warm AudioContext on user gesture to satisfy autoplay policy */
  preWarmAudio?: () => void;
  /** Which TTS path was used on last speak call */
  lastSpeakPath?: "streaming" | "blob-fallback" | "blob" | "none";
  /** Error name from last speak failure (e.g. "NotAllowedError") */
  lastSpeakError?: string | null;
  /** Whether TTS is currently speaking */
  isSpeaking: boolean;
  /** Function to generate coach response based on transcript */
  generateCoachResponse: (
    question: string,
    transcript: ConversationTurn[],
    gradeLevel?: string,
    timeRemainingSec?: number
  ) => Promise<{ response: string; shouldContinue: boolean; turnKind?: VideoTurnKind; wrapReason?: string; criteriaStatus?: string; serverSummary?: string; instructionalRecap?: string; completionRatio?: number }>;
  /** Whether the component is submitting */
  isSubmitting?: boolean;
  /** Called when student wants to continue coaching on this topic after session ends */
  onKeepCoaching?: (context: {
    transcript: ConversationTurn[];
    question: string;
    durationSec: number;
    coachTurns: number;
  }) => void;
  /** Whether this is the final question in the lesson (gates "Keep Coaching" visibility) */
  isFinalQuestion?: boolean;
  /** Success criteria from the prompt assessment rubric (for evidence-based summary) */
  successCriteria?: string[];
  /** Called when conversation turns update (for parent draft persistence) */
  onConversationUpdate?: (turns: ConversationTurn[]) => void;
  /** Initial conversation turns to restore from a saved draft */
  initialConversationTurns?: ConversationTurn[];
  /** Called when recording finishes and blob is ready (for draft upload) */
  onDraftVideoReady?: (data: { videoBlob: Blob; durationSec: number; turns: ConversationTurn[]; summary: string | null }) => void;
  /** Mount directly into preview phase (for resume from saved draft) */
  initialPhase?: "preview";
  /** Restored recorded duration (for preview resume) */
  initialRecordedDuration?: number;
  /** Restored video URL served by backend (for preview resume) */
  initialVideoUrl?: string;
  /** Restored session summary text (for preview resume) */
  initialSessionSummary?: string;
  /** Pre-uploaded draft video metadata — reused on submit to avoid re-upload */
  draftVideoMetadata?: { url: string; mimeType: string; durationSec: number; sizeBytes: number; createdAt: string; kind: string };
  /** Called when student re-records, so parent can delete draft video */
  onReRecordDraft?: () => void;
  /** Server-computed teacher summary (from step accumulation — most accurate for math) */
  serverSummary?: string;
  /** Override silence duration (ms) — from student pacing preference */
  silenceDurationMs?: number;
  /** Override min speech before silence triggers (ms) — from student pacing preference */
  minSpeechBeforeSilenceMs?: number;
}

type RecordingPhase =
  | "idle"           // Before starting
  | "requesting"     // Requesting camera permission
  | "ready"          // Camera ready, waiting to start
  | "coach_speaking" // Coach is speaking
  | "student_turn"   // Student's turn to speak (speech recognition active)
  | "processing"     // Processing student response, generating coach reply
  | "session_wrap"   // Time expired — speaking wrap-up message, then auto-transition to preview
  | "preview"        // Recording stopped, previewing
  | "error";         // Error state

// Check for Web Speech API support
const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
const speechRecognitionSupported = !!SpeechRecognition;

// Silence detection constants
const SILENCE_THRESHOLD = 0.015;       // RMS below this = silence
const SPEECH_START_THRESHOLD = 0.025;  // RMS above this = speech started
const SILENCE_DURATION_MS = 1100;      // 1.1s sustained silence = end of turn
const TRAILING_BUFFER_MS = 400;        // Wait 400ms after silence detected before stopping
const MAX_TURN_DURATION_S = 75;        // Safety cap per turn (75s)
const MIN_SPEECH_BEFORE_SILENCE_MS = 1500; // Must speak at least 1.5s before silence can trigger
const SESSION_WRAP_THRESHOLD_S = 10;       // Begin graceful wrap when this many seconds remain
const SESSION_WRAP_MESSAGE = "It looks like we ran out of time. I really enjoyed thinking through this with you.";

export default function VideoConversationRecorder({
  maxDuration = 120,
  maxCoachTurns = 5,
  question,
  gradeLevel,
  onStartRecording,
  onStopRecording,
  onError,
  onSwitchToTyping,
  speak,
  speakStream,
  preWarmAudio,
  lastSpeakPath,
  lastSpeakError,
  isSpeaking,
  generateCoachResponse,
  isSubmitting = false,
  onKeepCoaching,
  isFinalQuestion = false,
  successCriteria,
  onConversationUpdate,
  initialConversationTurns,
  onDraftVideoReady,
  initialPhase,
  initialRecordedDuration,
  initialVideoUrl,
  initialSessionSummary,
  draftVideoMetadata,
  onReRecordDraft,
  serverSummary,
  silenceDurationMs: silenceDurationMsOverride,
  minSpeechBeforeSilenceMs: minSpeechBeforeSilenceMsOverride,
}: VideoConversationRecorderProps) {
  // Effective timing — props override module-level constants
  const effectiveSilenceDurationMs = silenceDurationMsOverride ?? SILENCE_DURATION_MS;
  const effectiveMinSpeechMs = minSpeechBeforeSilenceMsOverride ?? MIN_SPEECH_BEFORE_SILENCE_MS;

  const [phase, setPhase] = useState<RecordingPhase>(initialPhase || "idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [hidePreview, setHidePreview] = useState(false);
  const [conversationTurns, setConversationTurns] = useState<ConversationTurn[]>([]);
  const [coachTurnCount, setCoachTurnCount] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedDuration, setRecordedDuration] = useState(initialRecordedDuration || 0);
  const [currentTranscript, setCurrentTranscript] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [studentSpeechDuration, setStudentSpeechDuration] = useState(0);
  const [streamReady, setStreamReady] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [streamingCoachText, setStreamingCoachText] = useState("");
  const [sessionExpiringSoon, setSessionExpiringSoon] = useState(false);
  const [sessionWrapped, setSessionWrapped] = useState(false);
  const [sessionSummary, setSessionSummary] = useState<string | null>(initialSessionSummary || null);

  // Telemetry ref for timing pipeline stages
  const telemetryRef = useRef({ studentStop: 0, apiReturn: 0, firstAudio: 0, coachAudioEnd: 0, listeningStart: 0 });

  // Progressive text reveal cleanup
  const revealCleanupRef = useRef<(() => void) | null>(null);

  // Track last conversation turn role to prevent consecutive API coach turns
  const lastApiTurnRoleRef = useRef<"coach" | "student" | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const coachTurnCountRef = useRef(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const studentTurnStartRef = useRef<number>(0);
  const studentSpeechTimerRef = useRef<number | null>(null);
  const isRecordingRef = useRef(false);
  const conversationPanelRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  // Silence detection refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const silenceStartRef = useRef<number | null>(null);
  const speechDetectedRef = useRef(false);
  const silenceDetectionFrameRef = useRef<number | null>(null);
  const turnTimerRef = useRef<number | null>(null);
  const speechStartTimeRef = useRef<number | null>(null);
  const isDoneSpeakingRef = useRef(false);
  const finalTranscriptRef = useRef("");
  const conversationTurnsRef = useRef<ConversationTurn[]>([]);
  const noSpeechRetryRef = useRef(0); // Tracks consecutive empty-transcript retries
  const listeningGraceEndRef = useRef(0); // Timestamp when grace period ends
  const turnIdRef = useRef(0); // Incrementing turn ID for telemetry
  const coachSpeakingRef = useRef(false); // Lock to prevent overlapping TTS
  const sessionExpiringSoonRef = useRef(false); // Sync ref for async callbacks
  const sessionWrappedRef = useRef(false); // Prevent double wrap
  const wrapTTSPendingRef = useRef(false); // handleSessionWrap is driving phase transition (onstop should defer)
  const latestServerSummaryRef = useRef<string | undefined>(serverSummary); // Track server summary across closures
  const frozenTurnsRef = useRef<ConversationTurn[] | null>(null); // Snapshot of turns when recording stops (excludes wrap message)
  const lastCoachResponseRef = useRef<string>(""); // Dedup: prevent identical consecutive coach messages
  const instructionalRecapRef = useRef<string | undefined>(undefined); // Latest server-computed instructional recap for client-side wraps
  const completionRatioRef = useRef<number>(0); // Latest step completion ratio from server (0-1)
  const [needsUserAudioGesture, setNeedsUserAudioGesture] = useState(false);
  // Keep server summary ref in sync with prop (belt-and-suspenders for stale closures)
  if (serverSummary) latestServerSummaryRef.current = serverSummary;
  const pendingCoachAudioRef = useRef<{ text: string; shouldContinue: boolean; turnId: number; turnKind?: VideoTurnKind; wrapReason?: string; criteriaStatus?: string } | null>(null);

  const updateConversationTurns = useCallback((updater: ConversationTurn[] | ((prev: ConversationTurn[]) => ConversationTurn[])) => {
    setConversationTurns(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      const capped = next.length > 50 ? next.slice(next.length - 50) : next;
      conversationTurnsRef.current = capped;
      // Sync to parent for draft persistence
      onConversationUpdate?.(capped);
      return capped;
    });
  }, [onConversationUpdate]);

  // Helper: check if conversation turns already contain the initial question
  const hasInitialQuestionTurn = useCallback((turns: ConversationTurn[], questionText: string): boolean => {
    return turns.length > 0 && turns[0].role === "coach" && turns[0].message === questionText;
  }, []);

  // Restore conversation turns from a saved draft on mount
  useEffect(() => {
    if (initialConversationTurns && initialConversationTurns.length > 0) {
      const coachCount = initialConversationTurns.filter(t => t.role === "coach").length;
      const lastTurn = initialConversationTurns[initialConversationTurns.length - 1];
      const hasQ = hasInitialQuestionTurn(initialConversationTurns, question);
      console.log(`[ResumeDebug] restoredTurns=${initialConversationTurns.length} hasQuestionTurn=${hasQ} lastTurnRole=${lastTurn?.role ?? "none"} coachCount=${coachCount}`);
      // Use updateConversationTurns so parent autosave stays in sync
      updateConversationTurns(initialConversationTurns);
      setCoachTurnCount(coachCount);
      coachTurnCountRef.current = coachCount;
      // Set last turn role for double-coach guard
      if (lastTurn) lastApiTurnRoleRef.current = lastTurn.role as "coach" | "student";
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only on mount

  // Callback ref for live camera video elements.
  // Auto-attaches the media stream whenever a <video> element mounts (handles
  // the ready→recording phase transition where the DOM element changes).
  const liveVideoRefCallback = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    if (node && streamRef.current) {
      node.srcObject = streamRef.current;
      node.muted = true;
      node.play().catch(() => {});
    }
  }, []);

  /**
   * Reveal text word-by-word, synced to estimated speech duration.
   * @param intervalMs ms between words (default: calculated from word count for ~150 WPM)
   * Returns a cleanup function to cancel.
   */
  const revealTextProgressively = useCallback(
    (fullText: string, onUpdate: (partial: string) => void, onComplete: () => void, intervalMs?: number) => {
      const words = fullText.split(/\s+/);
      // Estimate speech duration: ~150 WPM = ~400ms/word
      const msPerWord = intervalMs || Math.max(200, Math.min(500, (words.length / 2.5) * 1000 / words.length));
      let index = 0;
      const interval = setInterval(() => {
        index++;
        if (index >= words.length) {
          clearInterval(interval);
          onUpdate(fullText);
          onComplete();
          return;
        }
        onUpdate(words.slice(0, index).join(" "));
      }, msPerWord);
      return () => clearInterval(interval);
    },
    []
  );

  /**
   * Build a 1–3 sentence natural-language summary of what the student said.
   * Heuristic-only — no API call. Always references concrete student phrases
   * when present. Only uses generic fallback for truly empty/filler-only content.
   */
  // summarizeStudentTranscript imported from ../utils/summarizeTranscript

  // Handle "Tap to play" fallback when autoplay is blocked
  const handleTapToPlay = async () => {
    const pending = pendingCoachAudioRef.current;
    if (!pending) return;

    setNeedsUserAudioGesture(false);
    pendingCoachAudioRef.current = null;

    console.log(`[Turn ${pending.turnId}] handleTapToPlay — user tapped, retrying speak()`);

    // User gesture provides autoplay permission — use non-streaming for reliability
    const played = await speak(pending.text);
    console.log(`[Turn ${pending.turnId}] handleTapToPlay — speak() returned: ${played}`);

    coachSpeakingRef.current = false;
    telemetryRef.current.coachAudioEnd = Date.now();

    if (!isRecordingRef.current) return;

    const realElapsedNow = Math.floor((Date.now() - startTimeRef.current) / 1000);
    const decision = decidePostCoachAction({
      shouldContinue: pending.shouldContinue,
      coachResponse: pending.text,
      realElapsedSec: realElapsedNow,
      maxDurationSec: maxDuration,
      turnKind: pending.turnKind,
      wrapReason: pending.wrapReason,
      criteriaStatus: pending.criteriaStatus,
    });

    console.log(`[Turn ${pending.turnId}] handleTapToPlay decision=${decision.action} turnKind=${pending.turnKind ?? "unknown"} (${decision.reason})`);

    if (decision.action === "start_student_turn") {
      noSpeechRetryRef.current = 0;
      await new Promise(resolve => setTimeout(resolve, 400));
      if (isRecordingRef.current) startStudentTurn();
    } else if (decision.action === "wrap") {
      console.log(`[Turn ${pending.turnId}] [WRAP_REASON=${decision.reason}]`);
      await handleSessionWrap(decision.reason);
    } else {
      console.log(`[Turn ${pending.turnId}] [WRAP_REASON=${decision.reason}]`);
      sessionWrappedRef.current = true;
      setSessionWrapped(true);
      endConversation();
    }
  };

  // Auto-scroll conversation panel (only if user is near bottom)
  useEffect(() => {
    const panel = conversationPanelRef.current;
    if (!panel) return;
    const isNearBottom = panel.scrollHeight - panel.scrollTop - panel.clientHeight < 80;
    if (isNearBottom) {
      panel.scrollTo({ top: panel.scrollHeight, behavior: "smooth" });
    }
  }, [conversationTurns, currentTranscript, streamingCoachText]);

  // Stop silence detection monitoring and clean up AudioContext
  const stopSilenceMonitor = useCallback(() => {
    if (silenceDetectionFrameRef.current) {
      cancelAnimationFrame(silenceDetectionFrameRef.current);
      silenceDetectionFrameRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    silenceStartRef.current = null;
    speechDetectedRef.current = false;
    speechStartTimeRef.current = null;
    setMicLevel(0);
  }, []);

  // Cleanup function
  const cleanup = useCallback(() => {
    console.log("[VideoConversation] Cleanup called");
    if (revealCleanupRef.current) {
      revealCleanupRef.current();
      revealCleanupRef.current = null;
    }
    stopSilenceMonitor();
    if (turnTimerRef.current) {
      clearTimeout(turnTimerRef.current);
      turnTimerRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (studentSpeechTimerRef.current) {
      clearInterval(studentSpeechTimerRef.current);
      studentSpeechTimerRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {}
      recognitionRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current = null;
    }
    chunksRef.current = [];
    isRecordingRef.current = false;
    setStreamReady(false);
  }, [stopSilenceMonitor]);

  // Cleanup on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  // Attach stream to video element when ready
  useEffect(() => {
    const attachStream = async () => {
      if (streamRef.current && videoRef.current && !hidePreview && streamReady) {
        console.log("[VideoConversation] Attaching stream to video element", {
          streamExists: !!streamRef.current,
          videoRefExists: !!videoRef.current,
          phase,
          hidePreview,
          streamReady,
        });
        videoRef.current.srcObject = streamRef.current;
        videoRef.current.muted = true;
        try {
          await videoRef.current.play();
          console.log("[VideoConversation] Video playing successfully");
        } catch (err) {
          console.log("[VideoConversation] Video play error:", err);
        }
      }
    };
    attachStream();
  }, [streamReady, phase, hidePreview]);

  // Request camera permission
  const requestPermission = async () => {
    setPhase("requesting");
    setError(null);
    console.log("[VideoConversation] Requesting camera permission");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      });

      console.log("[VideoConversation] Got media stream", { tracks: stream.getTracks().map(t => t.kind) });
      streamRef.current = stream;
      setStreamReady(true);

      // Attach immediately if video ref exists
      if (videoRef.current) {
        console.log("[VideoConversation] Attaching stream immediately");
        videoRef.current.srcObject = stream;
        videoRef.current.muted = true;
        await videoRef.current.play();
      }

      setPhase("ready");
    } catch (err) {
      console.error("[VideoConversation] Failed to get media devices:", err);

      let errorMsg = "Failed to access camera and microphone.";
      if (err instanceof DOMException) {
        if (err.name === "NotAllowedError") {
          errorMsg = "Camera and microphone permission denied.";
        } else if (err.name === "NotFoundError") {
          errorMsg = "No camera or microphone found.";
        } else if (err.name === "NotReadableError") {
          errorMsg = "Camera or microphone is in use by another app.";
        }
      }

      setError(errorMsg);
      setPhase("error");
      onError?.(errorMsg);
    }
  };

  // Initialize speech recognition
  const initSpeechRecognition = () => {
    if (!speechRecognitionSupported) {
      console.log("[VideoConversation] Speech recognition not supported");
      return null;
    }

    console.log("[VideoConversation] Initializing speech recognition");
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      console.log("[VideoConversation] Speech recognition started");
      setIsListening(true);
    };

    recognition.onresult = (event: any) => {
      // Ignore speech results after session wrap — recording is frozen
      if (sessionWrappedRef.current) return;

      let transcript = "";
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      console.log("[VideoConversation] Transcript:", transcript);
      finalTranscriptRef.current = transcript;
      setCurrentTranscript(transcript);
    };

    recognition.onerror = (event: any) => {
      console.log("[VideoConversation] Speech recognition error:", event.error);
      if (event.error === "not-allowed") {
        setError("Microphone permission denied for speech recognition.");
      }
    };

    recognition.onend = () => {
      console.log("[VideoConversation] Speech recognition ended");
      setIsListening(false);
    };

    return recognition;
  };

  // Set up Web Audio API for silence detection
  const setupSilenceDetection = () => {
    if (!streamRef.current) return;
    try {
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(streamRef.current);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
    } catch (e) {
      console.log("[VideoConversation] Could not set up silence detection:", e);
    }
  };

  // Start monitoring audio levels for silence detection
  const startSilenceMonitor = () => {
    if (!analyserRef.current) return;
    const analyser = analyserRef.current;
    const dataArray = new Float32Array(analyser.fftSize);

    const checkLevel = () => {
      analyser.getFloatTimeDomainData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sum / dataArray.length);
      setMicLevel(Math.min(rms * 10, 1));

      // Ignore all silence detection during the grace period after listening starts
      const now = Date.now();
      const inGracePeriod = now < listeningGraceEndRef.current;

      if (rms > SPEECH_START_THRESHOLD) {
        speechDetectedRef.current = true;
        if (!speechStartTimeRef.current) {
          speechStartTimeRef.current = now;
        }
        silenceStartRef.current = null;
      } else if (rms < SILENCE_THRESHOLD && !inGracePeriod) {
        if (
          speechDetectedRef.current &&
          speechStartTimeRef.current &&
          (now - speechStartTimeRef.current) >= effectiveMinSpeechMs
        ) {
          if (silenceStartRef.current === null) {
            silenceStartRef.current = now;
          } else if ((now - silenceStartRef.current) >= effectiveSilenceDurationMs) {
            console.log("[VideoConversation] Silence detected, ending student turn");
            setTimeout(() => handleDoneSpeaking(), TRAILING_BUFFER_MS);
            return; // Stop the loop
          }
        }
      }

      silenceDetectionFrameRef.current = requestAnimationFrame(checkLevel);
    };

    checkLevel();
  };

  // Start the conversation
  const startConversation = async () => {
    if (!streamRef.current) return;
    console.log("[VideoConversation] Starting conversation");

    // Pre-warm AudioContext on this user gesture to satisfy autoplay policy
    preWarmAudio?.();

    // Start video recording
    chunksRef.current = [];

    try {
      const fullMimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
        ? "video/webm;codecs=vp9,opus"
        : MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
        ? "video/webm;codecs=vp8,opus"
        : MediaRecorder.isTypeSupported("video/webm")
        ? "video/webm"
        : "video/mp4";

      const baseMimeType = fullMimeType.split(";")[0];
      console.log("[VideoConversation] Using mimeType:", fullMimeType);

      const mediaRecorder = new MediaRecorder(streamRef.current, {
        mimeType: fullMimeType,
        videoBitsPerSecond: 2500000,
      });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        console.log("[VideoConversation] MediaRecorder stopped");
        // Clamp duration to maxDuration — belt-and-suspenders against backend rejection
        const rawDuration = Math.max(1, Math.floor((Date.now() - startTimeRef.current) / 1000));
        const actualDuration = Math.min(rawDuration, maxDuration);
        const blob = new Blob(chunksRef.current, { type: baseMimeType });
        setRecordedBlob(blob);
        setRecordedDuration(actualDuration);

        // Use frozen turns (excludes wrap message) if available, otherwise live
        const turnsForSummary = frozenTurnsRef.current || conversationTurnsRef.current;
        // Build session summary: prefer server summary (from step accumulation),
        // then math step evidence, then criteria-based, then general.
        // Server summary is the most accurate for math because it uses validated
        // reasoning step accumulation rather than raw transcript extraction.
        const allStudentText = turnsForSummary
          .filter(t => t.role === "student")
          .map(t => t.message)
          .join(" ");
        let summary: string | null = latestServerSummaryRef.current || null;
        if (!summary) {
          summary = buildMathStepSummary(allStudentText);
        }
        if (!summary) {
          if (successCriteria && successCriteria.length > 0) {
            const bullets = buildEvidenceSummary(turnsForSummary, successCriteria);
            summary = formatEvidenceSummary(bullets, allStudentText);
          } else {
            summary = summarizeStudentTranscript(turnsForSummary, question, successCriteria);
          }
        }
        setSessionSummary(summary);

        // Notify parent so it can upload the draft video to the server
        onDraftVideoReady?.({ videoBlob: blob, durationSec: actualDuration, turns: turnsForSummary, summary });

        // During session wrap (handleSessionWrap), the wrap handler manages
        // phase transition and stream cleanup after the closing TTS finishes.
        // Only defer when wrapTTSPendingRef is set — NOT for server_wrap / end_conversation
        // where there's no follow-up TTS and onstop must handle the transition.
        if (wrapTTSPendingRef.current) {
          console.log("[VideoConversation] MediaRecorder stopped during wrap — blob saved, deferring phase transition");
          return;
        }

        setPhase("preview");
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }
        setStreamReady(false);
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start(1000);
      isRecordingRef.current = true;

      startTimeRef.current = Date.now();
      setElapsedTime(0);
      onStartRecording?.();

      // Start elapsed timer — single source of truth for wall-clock time
      timerRef.current = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
        setElapsedTime(elapsed);
        const remaining = maxDuration - elapsed;

        // Flag session as expiring soon at threshold
        if (remaining <= SESSION_WRAP_THRESHOLD_S && !sessionExpiringSoonRef.current) {
          sessionExpiringSoonRef.current = true;
          setSessionExpiringSoon(true);
          console.log(`[SessionWrap] Expiring soon — ${remaining}s remaining`);
        }

        // Graceful wrap instead of hard stop — only when timer actually expires
        if (elapsed >= maxDuration && !sessionWrappedRef.current) {
          console.log(`[WRAP_REASON=timer_expired] elapsed=${elapsed} maxDuration=${maxDuration}`);
          void handleSessionWrap("timer_expired");
        }
      }, 100);

      // RESUME PATH: If restored turns already contain the initial question,
      // skip speaking it and go directly to student turn.
      const existingTurns = conversationTurnsRef.current;
      const isResume = existingTurns.length > 0 && hasInitialQuestionTurn(existingTurns, question);

      if (isResume) {
        const existingCoachCount = existingTurns.filter(t => t.role === "coach").length;
        console.log(`[Resume] Skipping question TTS — restored ${existingTurns.length} turns, ${existingCoachCount} coach turns`);
        setCoachTurnCount(existingCoachCount);
        coachTurnCountRef.current = existingCoachCount;
        turnIdRef.current = existingCoachCount;
        setPhase("coach_speaking");

        // Brief "welcome back" — speak it but do NOT add as a conversation turn
        // (it's UI chrome, not part of the academic transcript)
        coachSpeakingRef.current = true;
        await speak("Welcome back! Let's pick up where we left off.");
        coachSpeakingRef.current = false;

        await new Promise(resolve => setTimeout(resolve, 400));
        if (isRecordingRef.current) {
          console.log("[Resume] startStudentTurn invoked");
          startStudentTurn();
        }
      } else {
        // FRESH PATH: speak the question and start from scratch
        setCoachTurnCount(1);
        coachTurnCountRef.current = 1;

        // Add coach's question as first turn
        const firstTurn: ConversationTurn = { role: "coach", message: question, timestamp: 0 };
        updateConversationTurns([firstTurn]);
        setPhase("coach_speaking");

        // Initial question is Turn 0
        turnIdRef.current = 0;
        coachSpeakingRef.current = true;
        console.log("[Turn 0] speak() invoked for initial question");
        const questionPlayed = await speak(question);
        console.log(`[Turn 0] speak() resolved: audioPlayed=${questionPlayed}`);
        coachSpeakingRef.current = false;

        if (!questionPlayed) {
          if (lastSpeakError === "NotAllowedError") {
            console.log("[Turn 0] AUDIO_FAILED: autoplay blocked — showing tap-to-play");
            pendingCoachAudioRef.current = { text: question, shouldContinue: true, turnId: 0 };
            setNeedsUserAudioGesture(true);
            return;
          }
          // Non-autoplay failure (API error etc.) — text is visible, proceed silently
          console.log("[Turn 0] AUDIO_FAILED on initial question (non-autoplay) — continuing with text only");
        }

        // Brief pause after coach finishes speaking before starting mic
        await new Promise(resolve => setTimeout(resolve, 400));

        // After speaking, start student's turn
        if (isRecordingRef.current) {
          console.log("[Turn 0] startStudentTurn invoked");
          startStudentTurn();
        }
      }

    } catch (err) {
      console.error("[VideoConversation] Failed to start recording:", err);
      setError("Failed to start recording.");
      setPhase("error");
    }
  };

  // Start student's turn (enable speech recognition + silence detection)
  const startStudentTurn = () => {
    telemetryRef.current.listeningStart = Date.now();
    const sinceCoachEnd = telemetryRef.current.coachAudioEnd > 0
      ? telemetryRef.current.listeningStart - telemetryRef.current.coachAudioEnd
      : 0;
    console.log("[Telemetry] listeningStart — " + sinceCoachEnd + "ms after coachAudioEnd");
    console.log("[VideoConversation] Starting student turn");
    setPhase("student_turn");
    setCurrentTranscript("");
    setStudentSpeechDuration(0);
    studentTurnStartRef.current = Date.now();

    // Set grace period: ignore silence detection for the first 800ms
    listeningGraceEndRef.current = Date.now() + 800;

    // Reset silence detection and transcript state
    isDoneSpeakingRef.current = false;
    speechDetectedRef.current = false;
    silenceStartRef.current = null;
    speechStartTimeRef.current = null;
    finalTranscriptRef.current = "";

    // Start speech duration timer
    studentSpeechTimerRef.current = window.setInterval(() => {
      const duration = Math.floor((Date.now() - studentTurnStartRef.current) / 1000);
      setStudentSpeechDuration(duration);
    }, 100);

    // Start speech recognition
    if (speechRecognitionSupported) {
      recognitionRef.current = initSpeechRecognition();
      if (recognitionRef.current) {
        try {
          recognitionRef.current.start();
        } catch (e) {
          console.log("[VideoConversation] Could not start recognition:", e);
        }
      }
    }

    // Start silence detection
    setupSilenceDetection();
    startSilenceMonitor();

    // Max turn safety timer
    if (turnTimerRef.current) clearTimeout(turnTimerRef.current);
    turnTimerRef.current = window.setTimeout(() => {
      console.log("[VideoConversation] Max turn duration reached, ending student turn");
      handleDoneSpeaking();
    }, MAX_TURN_DURATION_S * 1000);
  };

  // Student finished speaking - process their response
  const handleDoneSpeaking = async () => {
    // Guard against double-invocation (silence detection + manual button)
    if (isDoneSpeakingRef.current) return;
    isDoneSpeakingRef.current = true;

    // Stop silence detection and turn timer
    stopSilenceMonitor();
    if (turnTimerRef.current) {
      clearTimeout(turnTimerRef.current);
      turnTimerRef.current = null;
    }

    // Stop speech recognition — calling .stop() triggers a final onresult + onend,
    // which will flush any queued partial into finalTranscriptRef before onend fires.
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {}
    }
    setIsListening(false);

    // Stop speech timer
    if (studentSpeechTimerRef.current) {
      clearInterval(studentSpeechTimerRef.current);
      studentSpeechTimerRef.current = null;
    }

    // Wait briefly for the final onresult to flush after recognition.stop().
    // The browser fires onresult synchronously in most cases, but we give it
    // a short grace window to be safe.
    if (!finalTranscriptRef.current.trim()) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    // If still empty after first grace, give one more chance (up to 1.5s total)
    if (!finalTranscriptRef.current.trim() && speechDetectedRef.current) {
      console.log("[VideoFlow] Transcript empty but speech was detected — waiting for STT finalization");
      await new Promise(resolve => setTimeout(resolve, 1200));
    }

    // Read transcript from ref (always fresh), not from React state (may be stale in closures)
    const transcript = finalTranscriptRef.current.trim();

    const realElapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
    console.log(
      "[VideoFlow] studentSubmitted coachTurnCount=" + coachTurnCountRef.current +
      " realElapsed=" + realElapsed + " stateElapsed=" + elapsedTime +
      " finalTranscriptRef=\"" + (transcript || "(empty)").substring(0, 80) + "\"" +
      " currentTranscriptState=\"" + (currentTranscript || "(empty)").substring(0, 80) + "\""
    );

    const currentTime = Math.floor((Date.now() - startTimeRef.current) / 1000);

    // Handle empty transcript: re-prompt locally instead of hitting the API
    // Only count no-speech if we're genuinely in student_listening AND past the grace period
    if (!transcript) {
      const now = Date.now();
      const pastGrace = now >= listeningGraceEndRef.current;
      if (!pastGrace) {
        console.log("[VideoFlow] No speech but still in grace period — ignoring, restarting turn");
        await new Promise(resolve => setTimeout(resolve, 400));
        if (isRecordingRef.current) startStudentTurn();
        return;
      }

      noSpeechRetryRef.current += 1;
      console.log("[VideoFlow] No speech detected (post-grace), retry #" + noSpeechRetryRef.current);

      if (noSpeechRetryRef.current >= 2) {
        // After 2 failed attempts, end conversation gracefully
        console.log("[WRAP_REASON=no_speech_limit] 2 consecutive no-speech retries");
        const endMsg = "It seems like I'm having trouble hearing you. Let's try typing your answer instead!";
        const coachTurn: ConversationTurn = {
          role: "coach",
          message: endMsg,
          timestamp: currentTime,
        };
        updateConversationTurns(prev => [...prev, coachTurn]);
        setPhase("coach_speaking");
        const played = await speak(endMsg);
        console.log("[VideoFlow] no-speech-end speak() returned:", played);
        endConversation();
        return;
      }

      // Gentle re-prompt without API call
      const reprompt = "I didn't catch that\u2014can you say your answer again?";
      const coachTurn: ConversationTurn = {
        role: "coach",
        message: reprompt,
        timestamp: currentTime,
      };
      updateConversationTurns(prev => [...prev, coachTurn]);
      setPhase("coach_speaking");
      const repromptPlayed = await speak(reprompt);
      console.log("[VideoFlow] no-speech-retry speak() returned:", repromptPlayed);

      // Brief pause then restart student turn
      await new Promise(resolve => setTimeout(resolve, 400));
      if (isRecordingRef.current) {
        startStudentTurn();
      }
      return;
    }

    // Got real speech — reset no-speech retry counter
    noSpeechRetryRef.current = 0;

    // Filter filler-only transcripts — handle locally without API call
    const FILLER_ONLY = /^(um+|uh+|hmm+|like|well|so|yeah|ok(ay)?|huh|what|oh|ah+|mhm+)[.!?,\s]*$/i;
    if (FILLER_ONLY.test(transcript)) {
      console.log("[STT] filler_only_transcript -> local_retry (no API)", transcript);
      const fillerReprompt = "I didn't catch that\u2014can you say your answer again?";
      const fillerCoachTurn: ConversationTurn = {
        role: "coach",
        message: fillerReprompt,
        timestamp: currentTime,
      };
      updateConversationTurns(prev => [...prev, fillerCoachTurn]);
      setPhase("coach_speaking");
      await speak(fillerReprompt);
      await new Promise(resolve => setTimeout(resolve, 400));
      if (isRecordingRef.current) startStudentTurn();
      return;
    }

    // Add student turn to transcript
    lastApiTurnRoleRef.current = "student";
    const studentTurn: ConversationTurn = {
      role: "student",
      message: transcript,
      timestamp: currentTime,
    };
    // Read from ref (always fresh), not from React state (may be stale in closures)
    const currentTurns = conversationTurnsRef.current;
    const updatedTurns = [...currentTurns, studentTurn];
    updateConversationTurns(updatedTurns);
    setCurrentTranscript("");
    finalTranscriptRef.current = "";

    // Probing cutoff: if less than buffer remains, don't start another API call.
    // Near-success leniency: when student has completed most steps (completionRatio >= 0.66),
    // use CLOSING_WINDOW_SEC (15s) instead of WRAP_BUFFER_SEC (30s) to allow one final answer.
    const effectiveBuffer = completionRatioRef.current >= 0.66 ? CLOSING_WINDOW_SEC : WRAP_BUFFER_SEC;
    if (realElapsed + effectiveBuffer >= maxDuration) {
      console.log(
        "[WRAP_REASON=probing_cutoff] Probing cutoff reached (realElapsed=" +
          realElapsed + ", remaining=" + (maxDuration - realElapsed) +
          "s < " + effectiveBuffer + "s buffer, completionRatio=" + completionRatioRef.current.toFixed(2) + "), wrapping conversation"
      );
      await handleSessionWrap("probing_cutoff");
      return;
    }

    // Assign a unique turn ID for this entire pipeline
    turnIdRef.current += 1;
    const turnId = turnIdRef.current;
    console.log(`[Turn ${turnId}] submitStudentTurn start`);

    // Generate coach response based on transcript
    setPhase("processing");
    setStreamingCoachText("");
    telemetryRef.current.studentStop = Date.now();

    console.log(`[Turn ${turnId}] API request sent (transcript length=${transcript.length})`);

    try {
      const realElapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      const timeRemaining = Math.max(0, maxDuration - realElapsed);
      const coachResult = await generateCoachResponse(
        question,
        updatedTurns,
        gradeLevel,
        timeRemaining
      );
      let { response, shouldContinue } = coachResult;
      const { turnKind, wrapReason, criteriaStatus } = coachResult;

      // Capture the latest server summary (from step accumulation) — freshest value
      if (coachResult.serverSummary) {
        latestServerSummaryRef.current = coachResult.serverSummary;
      }

      // Capture the latest instructional recap (for client-side probing_cutoff wraps)
      if (coachResult.instructionalRecap) {
        instructionalRecapRef.current = coachResult.instructionalRecap;
      }

      // Track step completion ratio for near-success leniency
      const prevRatio = completionRatioRef.current;
      if (coachResult.completionRatio !== undefined) {
        completionRatioRef.current = coachResult.completionRatio;
      }
      console.log(
        `[Turn ${turnId}] completionRatio: raw=${coachResult.completionRatio ?? "undefined"}` +
        ` before=${prevRatio.toFixed(2)} after=${completionRatioRef.current.toFixed(2)}`,
      );

      // DEDUP: If the coach produced the exact same response as last turn,
      // decide whether to replace it. For math candidate answers and
      // interrogative attempts, KEEP the server's deterministic remediation
      // (misconception redirect, step probe, etc.) — it IS the right response
      // even when repeated. Only replace for non-math conversational turns.
      //
      // IMPORTANT: Use `transcript` (the local variable captured before the API
      // call) — NOT currentTranscript or finalTranscriptRef, which are cleared
      // at line 985-986 before the API response arrives.
      if (response === lastCoachResponseRef.current && shouldContinue) {
        const isMathAttempt = containsMathContent(transcript) || isInterrogativeMathAnswer(transcript);
        if (!isMathAttempt) {
          response = "I heard you! Would you like to keep exploring this, or are you ready to move on?";
          if (process.env.NODE_ENV === "development") {
            console.log(`[Turn ${turnId}] [DEDUP] Replaced duplicate coach response (non-math, transcript="${transcript.slice(0, 40)}")`);
          }
        } else if (process.env.NODE_ENV === "development") {
          console.log(`[Turn ${turnId}] [DEDUP-SKIP] Keeping duplicate remediation — student gave math candidate answer (transcript="${transcript.slice(0, 40)}")`);
        }
      }
      lastCoachResponseRef.current = response;

      // INVARIANT: If shouldContinue=true, the coach MUST ask a question (?).
      // The server already enforces this (Invariant 4 + safety net), but if it
      // somehow slips through, patch locally with a deterministic question rather
      // than forcing end (which produces a questionless statement).
      if (shouldContinue && !response.includes("?")) {
        console.error(`[Turn ${turnId}] [INVARIANT] shouldContinue=true but no "?" — server bug, patching locally`);
        response = response.trimEnd().replace(/[.!]$/, "") + ". Can you answer the question by giving two examples?";
      }

      telemetryRef.current.apiReturn = Date.now();
      const apiDuration = telemetryRef.current.apiReturn - telemetryRef.current.studentStop;
      console.log(`[Turn ${turnId}] API response received (coachText length=${response.length}, shouldContinue=${shouldContinue}, turnKind=${turnKind ?? "unknown"}, apiDuration=${apiDuration}ms)`);

      // Bail if session wrapped during API call — discard the stale response
      if (sessionWrappedRef.current) {
        console.log(`[Turn ${turnId}] BAIL: session wrapped during API — discarding response`);
        return;
      }

      if (!isRecordingRef.current) {
        console.log(`[Turn ${turnId}] BAIL: isRecording=false after API — recording stopped during async processing`);
        return;
      }

      // Closing-window check: if time drifted into the closing window during
      // the API round-trip, skip speaking the new response and wrap immediately.
      // EXCEPTION: If the API already returned a success wrap (shouldContinue=false),
      // let it play out — the student earned their success experience and should
      // hear the success message, not a generic "Great effort, let's wrap up."
      const postApiElapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      const postApiRemaining = maxDuration - postApiElapsed;
      const postApiBuffer = completionRatioRef.current >= 0.66 ? CLOSING_WINDOW_SEC : WRAP_BUFFER_SEC;
      if (postApiRemaining <= postApiBuffer && !sessionWrappedRef.current && shouldContinue) {
        console.log(`[Turn ${turnId}] Probing cutoff entered during API (remaining=${postApiRemaining}s, buffer=${postApiBuffer}s, completionRatio=${completionRatioRef.current.toFixed(2)}) — skipping TTS, wrapping`);
        coachSpeakingRef.current = false;
        await handleSessionWrap("probing_cutoff");
        return;
      }

      // Guard: prevent consecutive API coach turns without a student turn between them
      if (lastApiTurnRoleRef.current === "coach") {
        console.log(`[Flow] prevented_double_coach_turn -> start_student_turn`);
        coachSpeakingRef.current = false;
        await new Promise(resolve => setTimeout(resolve, 400));
        if (isRecordingRef.current) startStudentTurn();
        return;
      }
      lastApiTurnRoleRef.current = "coach";

      // Acquire TTS lock
      coachSpeakingRef.current = false;
      if (coachSpeakingRef.current) {
        console.log(`[Turn ${turnId}] WARNING: coachSpeakingRef already true — prior turn may be overlapping`);
      }
      coachSpeakingRef.current = true;

      const coachTime = Math.floor((Date.now() - startTimeRef.current) / 1000);

      // Add placeholder coach turn (will be revealed progressively)
      updateConversationTurns(prev => [...prev, { role: "coach", message: "", timestamp: coachTime }]);
      setCoachTurnCount(prev => prev + 1);
      coachTurnCountRef.current += 1;

      setPhase("coach_speaking");

      // Choose TTS method
      const useStreaming = !!speakStream;
      const speakFn = speakStream || speak;
      console.log(`[Turn ${turnId}] speak() invoked (streaming=${useStreaming}, textLength=${response.length})`);

      // Start delayed progressive text reveal concurrently with TTS.
      // The delay ensures audio is likely playing before text appears.
      const audioStartDelay = useStreaming ? 600 : 1200;
      let revealCancelled = false;
      const revealTimer = setTimeout(() => {
        if (revealCancelled) return;
        if (revealCleanupRef.current) revealCleanupRef.current();
        revealCleanupRef.current = revealTextProgressively(
          response,
          (partial) => setStreamingCoachText(partial),
          () => {
            setStreamingCoachText("");
            updateConversationTurns(prev => {
              const copy = [...prev];
              if (copy.length > 0 && copy[copy.length - 1].role === "coach") {
                copy[copy.length - 1] = { ...copy[copy.length - 1], message: response };
              }
              return copy;
            });
          }
        );
      }, audioStartDelay);

      // AWAIT speak — blocks until audio 'ended' or error
      const audioPlayed = await speakFn(response);

      console.log(`[Turn ${turnId}] speak() resolved: audioPlayed=${audioPlayed} path=${lastSpeakPath || "blob"}`);

      // Cancel progressive reveal, show full text
      revealCancelled = true;
      clearTimeout(revealTimer);
      if (revealCleanupRef.current) {
        revealCleanupRef.current();
        revealCleanupRef.current = null;
      }
      setStreamingCoachText("");
      updateConversationTurns(prev => {
        const copy = [...prev];
        if (copy.length > 0 && copy[copy.length - 1].role === "coach") {
          copy[copy.length - 1] = { ...copy[copy.length - 1], message: response };
        }
        return copy;
      });

      // Bail if session wrapped during TTS — don't start next turn
      if (sessionWrappedRef.current) {
        console.log(`[Turn ${turnId}] BAIL: session wrapped during TTS — not starting next turn`);
        coachSpeakingRef.current = false;
        return;
      }

      const coachAudioEnd = Date.now();
      telemetryRef.current.coachAudioEnd = coachAudioEnd;
      const totalDuration = coachAudioEnd - telemetryRef.current.studentStop;
      console.log(
        `[Turn ${turnId}] [Telemetry] STT→API: ${apiDuration}ms | API→speakEnd: ${coachAudioEnd - telemetryRef.current.apiReturn}ms | Total: ${totalDuration}ms`
      );

      // Release TTS lock
      coachSpeakingRef.current = false;

      // Handle audio failure
      if (!audioPlayed) {
        if (lastSpeakError === "NotAllowedError") {
          console.log(`[Turn ${turnId}] AUDIO_FAILED: autoplay blocked — showing tap-to-play`);
          pendingCoachAudioRef.current = { text: response, shouldContinue, turnId, turnKind, wrapReason, criteriaStatus };
          setNeedsUserAudioGesture(true);
          return;
        }
        // Non-autoplay failure — text is already visible, continue the flow
        console.log(`[Turn ${turnId}] AUDIO_FAILED: non-autoplay (path=${lastSpeakPath}, error=${lastSpeakError}) — continuing with text`);
      }

      console.log(`[Turn ${turnId}] audio 'ended' — coach finished speaking`);

      if (!isRecordingRef.current) {
        console.log(`[Turn ${turnId}] BAIL: isRecording=false after speak() — recording stopped during TTS`);
        return;
      }

      // ---------------------------------------------------------------
      // Decide next action — ordered, mutually exclusive wrap conditions
      // Uses extracted decidePostCoachAction for testability.
      // ---------------------------------------------------------------
      const realElapsedNow = Math.floor((Date.now() - startTimeRef.current) / 1000);
      const decision = decidePostCoachAction({
        shouldContinue,
        coachResponse: response,
        realElapsedSec: realElapsedNow,
        maxDurationSec: maxDuration,
        turnKind,
        wrapReason,
        criteriaStatus,
      });

      console.log(
        `[Turn ${turnId}] coachTurnComplete shouldContinue=${shouldContinue}` +
        ` hasQuestion=${response.includes("?")} realElapsed=${realElapsedNow}` +
        ` turnKind=${turnKind ?? "unknown"}` +
        ` coachTurnCount=${coachTurnCountRef.current}` +
        ` → decision=${decision.action} (${decision.reason})`
      );

      if (decision.action === "start_student_turn") {
        noSpeechRetryRef.current = 0; // reset no-speech counter on new coach turn
        await new Promise(resolve => setTimeout(resolve, 400));
        if (isRecordingRef.current) {
          console.log(`[Turn ${turnId}] startStudentTurn invoked`);
          startStudentTurn();
        }
      } else if (decision.action === "wrap") {
        console.log(`[Turn ${turnId}] [WRAP_REASON=${decision.reason}]`);
        await handleSessionWrap(decision.reason);
      } else {
        console.log(`[Turn ${turnId}] [WRAP_REASON=${decision.reason}]`);
        // Server already delivered the wrap message — set sessionWrapped
        // so the interval timer can't trigger a second handleSessionWrap.
        sessionWrappedRef.current = true;
        setSessionWrapped(true);
        endConversation();
      }
    } catch (err) {
      console.error(`[Turn ${turnId}] Failed to generate coach response:`, err);
      coachSpeakingRef.current = false;

      // Fallback: speak a generic prompt
      const fallbackResponse = "That's interesting! Can you tell me a bit more about your thinking?";
      const coachTime = Math.floor((Date.now() - startTimeRef.current) / 1000);
      const coachTurn: ConversationTurn = {
        role: "coach",
        message: fallbackResponse,
        timestamp: coachTime,
      };
      updateConversationTurns(prev => [...prev, coachTurn]);
      setCoachTurnCount(prev => prev + 1);
      coachTurnCountRef.current += 1;

      setPhase("coach_speaking");
      console.log(`[Turn ${turnId}] speak() invoked for fallback response`);
      const fallbackPlayed = await speak(fallbackResponse);
      console.log(`[Turn ${turnId}] fallback speak() returned: ${fallbackPlayed}`);

      // Bail if session wrapped during fallback TTS
      if (sessionWrappedRef.current) {
        console.log(`[Turn ${turnId}] BAIL: session wrapped during fallback TTS — not starting next turn`);
        coachSpeakingRef.current = false;
        return;
      }

      if (!fallbackPlayed) {
        if (lastSpeakError === "NotAllowedError") {
          console.log(`[Turn ${turnId}] AUDIO_FAILED on fallback: autoplay blocked — showing tap-to-play`);
          pendingCoachAudioRef.current = { text: fallbackResponse, shouldContinue: true, turnId };
          setNeedsUserAudioGesture(true);
          return;
        }
        console.log(`[Turn ${turnId}] AUDIO_FAILED on fallback (non-autoplay) — continuing with text`);
      }

      await new Promise(resolve => setTimeout(resolve, 400));
      if (isRecordingRef.current) {
        console.log(`[Turn ${turnId}] startStudentTurn invoked (after fallback)`);
        startStudentTurn();
      }
    }
  };

  // Graceful session wrap when time runs out.
  // Allows current TTS to finish, appends wrap message, speaks it, then ends.
  // Does NOT count as a failed attempt or incorrect answer.
  const handleSessionWrap = async (sessionWrapReason?: WrapReason) => {
    // Guard against double invocation
    if (sessionWrappedRef.current) return;
    sessionWrappedRef.current = true;
    setSessionWrapped(true);
    const wrapElapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
    console.log(`[SessionWrap] Initiating graceful wrap (elapsed=${wrapElapsed}s, maxDuration=${maxDuration}s)`);

    // Clear any pending coach state so stale responses don't flash
    pendingCoachAudioRef.current = null;
    setNeedsUserAudioGesture(false);
    setStreamingCoachText("");

    // Stop the main timer so it doesn't fire again
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // Stop listening / silence detection — no more student input
    stopSilenceMonitor();
    if (turnTimerRef.current) {
      clearTimeout(turnTimerRef.current);
      turnTimerRef.current = null;
    }
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch (e) {}
    }
    setIsListening(false);

    // If coach is currently speaking, wait for TTS to finish
    // (poll coachSpeakingRef at short intervals)
    if (coachSpeakingRef.current) {
      console.log("[SessionWrap] Coach is speaking — waiting for TTS to finish");
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (!coachSpeakingRef.current) {
            clearInterval(check);
            resolve();
          }
        }, 200);
        // Safety timeout: don't wait forever
        setTimeout(() => { clearInterval(check); resolve(); }, 8000);
      });
    }

    // ──── Freeze recording BEFORE wrap TTS ────
    // Stop MediaRecorder immediately so the closing statement is NOT
    // recorded into the uploaded video blob. This prevents duration > maxDuration.
    // Snapshot turns now — the wrap turn added below is display-only.
    frozenTurnsRef.current = [...conversationTurnsRef.current];
    isRecordingRef.current = false;
    // Signal onstop to defer phase transition — handleSessionWrap will do it
    // after the closing TTS finishes.
    wrapTTSPendingRef.current = true;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      console.log("[SessionWrap] Stopping MediaRecorder before wrap TTS");
      mediaRecorderRef.current.stop();
      // onstop fires asynchronously: creates blob + saves duration,
      // but skips phase transition (guarded by wrapTTSPendingRef)
    }

    // Transition to session_wrap phase
    setPhase("session_wrap");

    // INSTRUCTIONAL RECAP OVERRIDE: If the server detected a misconception
    // during the conversation and provided an instructional recap, use it
    // instead of the generic closing statement. This ensures probing_cutoff
    // and other client-side wraps include concrete solution modeling.
    let closingMessage: string;
    if (instructionalRecapRef.current) {
      closingMessage = instructionalRecapRef.current;
      if (process.env.NODE_ENV === "development") {
        console.log("[SessionWrap] wrapSource=instructionalRecap message=" + JSON.stringify(closingMessage.slice(0, 80)));
      }
    } else {
      // Build a personalized closing statement from student topics.
      // FOREIGN KEYWORD FILTER: reject topic templates that introduce domain
      // concepts absent from the question + student speech (prevents "sun" in
      // a subtraction lesson, etc.).
      const studentText = conversationTurnsRef.current
        .filter(t => t.role === "student" && t.message.trim())
        .map(t => t.message)
        .join(" ");
      const contextText = [question, studentText].join(" ");
      const allTopics = detectTopics(extractContentWords(studentText));
      const safeTopics = allTopics.filter(t => !hasForeignKeyword(t.template, contextText));
      if (process.env.NODE_ENV === "development" && safeTopics.length !== allTopics.length) {
        console.log("[SessionWrap] Filtered foreign topics:", allTopics.length - safeTopics.length, "removed");
      }
      closingMessage = buildClosingStatement(
        safeTopics.map(t => t.template),
        undefined, // studentName — not available here
        sessionWrapReason,
      );
      if (process.env.NODE_ENV === "development") {
        console.log("[SessionWrap] wrapSource=buildClosingStatement safeTopics=" + safeTopics.length +
          " message=" + JSON.stringify(closingMessage.slice(0, 80)));
      }
    }

    // Add wrap message to transcript (NOT as an answer attempt)
    const wrapTime = Math.floor((Date.now() - startTimeRef.current) / 1000);
    const wrapTurn: ConversationTurn = {
      role: "coach",
      message: closingMessage,
      timestamp: wrapTime,
    };
    updateConversationTurns(prev => [...prev, wrapTurn]);

    // Speak the wrap message (short TTS, don't await if it fails)
    try {
      coachSpeakingRef.current = true;
      setPhase("session_wrap");
      const speakFn = speakStream || speak;
      await speakFn(closingMessage);
    } catch (e) {
      console.log("[SessionWrap] Wrap TTS failed — text is visible, continuing");
    } finally {
      coachSpeakingRef.current = false;
    }

    // Wait a beat for visual pacing
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Finalize: clean up remaining resources (idempotent — most already stopped)
    endConversation();

    // Transition to preview and stop camera stream
    // (deferred from onstop because MediaRecorder was stopped early during wrap)
    setPhase("preview");
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setStreamReady(false);
  };

  // End the conversation and stop recording
  const endConversation = () => {
    console.log("[VideoConversation] Ending conversation");

    // Stop silence detection
    stopSilenceMonitor();
    if (turnTimerRef.current) {
      clearTimeout(turnTimerRef.current);
      turnTimerRef.current = null;
    }

    // Stop speech recognition
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {}
    }
    setIsListening(false);

    // Stop timers
    if (studentSpeechTimerRef.current) {
      clearInterval(studentSpeechTimerRef.current);
      studentSpeechTimerRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    isRecordingRef.current = false;

    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  };

  // Re-record (start over)
  const handleReRecord = async () => {
    console.log("[VideoConversation] Re-recording");
    // Notify parent to delete draft video from server
    onReRecordDraft?.();
    setRecordedBlob(null);
    setRecordedDuration(0);
    setElapsedTime(0);
    updateConversationTurns([]);
    setCoachTurnCount(0);
    coachTurnCountRef.current = 0;
    setCurrentTranscript("");
    setStudentSpeechDuration(0);
    setError(null);
    setSessionExpiringSoon(false);
    setSessionWrapped(false);
    setSessionSummary(null);
    sessionExpiringSoonRef.current = false;
    sessionWrappedRef.current = false;
    wrapTTSPendingRef.current = false;
    instructionalRecapRef.current = undefined;
    completionRatioRef.current = 0;
    frozenTurnsRef.current = null;
    noSpeechRetryRef.current = 0;

    await requestPermission();
  };

  // Submit the recording
  const handleSubmit = () => {
    const turnsForUpload = frozenTurnsRef.current || conversationTurns;
    console.log("[VideoConversation] handleSubmit called", {
      hasBlob: !!recordedBlob,
      hasDraftMeta: !!draftVideoMetadata,
      blobSize: recordedBlob?.size,
      recordedDuration,
      turnsCount: turnsForUpload.length,
      isSubmitting,
    });

    // If we have draft video metadata from a previous upload (resume flow),
    // pass a sentinel blob so parent can reuse the metadata without re-uploading.
    if (draftVideoMetadata && !recordedBlob && recordedDuration > 0) {
      console.log("[VideoConversation] Reusing draft video metadata (no re-upload)");
      const sentinel = new Blob([], { type: draftVideoMetadata.mimeType });
      onStopRecording(sentinel, recordedDuration, turnsForUpload);
      return;
    }

    if (recordedBlob && recordedDuration > 0) {
      console.log("[VideoConversation] Calling onStopRecording...");
      onStopRecording(recordedBlob, recordedDuration, turnsForUpload);
    } else {
      console.log("[VideoConversation] Cannot submit - missing blob or duration");
    }
  };

  // Format time as MM:SS
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const progressPercent = Math.min(100, (elapsedTime / maxDuration) * 100);
  const timeRemaining = Math.max(0, maxDuration - elapsedTime);
  const isRecording = phase === "coach_speaking" || phase === "student_turn" || phase === "processing" || phase === "session_wrap";

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      gap: "16px",
      padding: "20px",
      background: "#f8f9fa",
      borderRadius: "12px",
    }}>
      {/* Error state */}
      {phase === "error" && error && (
        <div style={{
          padding: "20px",
          background: "#fef2f2",
          border: "1px solid #fecaca",
          borderRadius: "8px",
          textAlign: "center",
        }}>
          <p style={{ margin: "0 0 16px 0", color: "#dc2626" }}>{error}</p>
          <button
            onClick={onSwitchToTyping}
            style={{
              padding: "10px 20px",
              fontSize: "0.9rem",
              background: "white",
              color: "#374151",
              border: "1px solid #d1d5db",
              borderRadius: "8px",
              cursor: "pointer",
            }}
          >
            Switch to typing instead
          </button>
        </div>
      )}

      {/* Idle state */}
      {phase === "idle" && (
        <div style={{ textAlign: "center", padding: "20px 0" }}>
          <div style={{
            width: "64px",
            height: "64px",
            borderRadius: "50%",
            background: "#3d5a80",
            margin: "0 auto 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <path d="M23 7l-7 5 7 5V7z" />
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
          </div>
          <h3 style={{ margin: "0 0 8px 0", fontSize: "1.1rem", color: "#333" }}>
            Video Conversation
          </h3>
          <p style={{ margin: "0 0 20px 0", color: "var(--text-secondary)", fontSize: "0.9rem" }}>
            Have a real conversation with your coach!<br />
            The coach will listen and respond to what you say.
          </p>
          {!speechRecognitionSupported && (
            <p style={{ margin: "0 0 16px 0", color: "#f59e0b", fontSize: "0.85rem" }}>
              Note: Speech recognition not available in this browser. Your speech won't be transcribed.
            </p>
          )}
          <button
            onClick={requestPermission}
            style={{
              padding: "14px 32px",
              fontSize: "1rem",
              fontWeight: 600,
              background: "#3d5a80",
              color: "white",
              border: "none",
              borderRadius: "10px",
              cursor: "pointer",
            }}
          >
            Get Ready
          </button>
          <p style={{ margin: "16px 0 0 0", fontSize: "0.8rem", color: "#9ca3af" }}>
            Max {formatTime(maxDuration)} • Up to {maxCoachTurns} exchanges
          </p>
          <div style={{ marginTop: "16px" }}>
            <button
              onClick={onSwitchToTyping}
              style={{
                padding: "8px 16px",
                fontSize: "0.85rem",
                background: "transparent",
                border: "1px solid #d1d5db",
                borderRadius: "8px",
                color: "#6b7280",
                cursor: "pointer",
              }}
            >
              Switch to typing instead
            </button>
          </div>
        </div>
      )}

      {/* Requesting permission */}
      {phase === "requesting" && (
        <div style={{ textAlign: "center", padding: "32px 0" }}>
          <div className="loading-spinner" style={{ margin: "0 auto 16px" }}></div>
          <p style={{ margin: 0, color: "var(--text-secondary)" }}>Setting up camera and microphone...</p>
        </div>
      )}

      {/* Ready to start */}
      {phase === "ready" && (
        <div>
          {/* Question preview */}
          <div style={{
            padding: "16px",
            background: "white",
            borderRadius: "8px",
            borderLeft: "4px solid #3d5a80",
            marginBottom: "16px",
          }}>
            <p style={{ margin: "0 0 4px 0", fontSize: "0.75rem", color: "#3d5a80", fontWeight: 600 }}>
              QUESTION
            </p>
            <p style={{ margin: 0, fontSize: "0.95rem", color: "#333", lineHeight: 1.5 }}>
              {question}
            </p>
          </div>

          {/* Camera preview */}
          {!hidePreview && (
            <div style={{
              width: "120px",
              height: "120px",
              borderRadius: "50%",
              overflow: "hidden",
              margin: "0 auto 16px",
              border: "3px solid #3d5a80",
              background: "#1f2937",
            }}>
              <video
                ref={liveVideoRefCallback}
                autoPlay
                playsInline
                muted
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  transform: "scaleX(-1)",
                }}
              />
            </div>
          )}

          <div style={{ textAlign: "center", marginBottom: "16px" }}>
            <button
              onClick={() => setHidePreview(!hidePreview)}
              style={{
                padding: "6px 12px",
                fontSize: "0.75rem",
                background: "transparent",
                border: "none",
                color: "#6b7280",
                cursor: "pointer",
                textDecoration: "underline",
              }}
            >
              {hidePreview ? "Show camera preview" : "Hide camera preview"}
            </button>
          </div>

          <div style={{ textAlign: "center" }}>
            <button
              onClick={startConversation}
              style={{
                padding: "16px 36px",
                fontSize: "1rem",
                fontWeight: 600,
                background: "#10b981",
                color: "white",
                border: "none",
                borderRadius: "10px",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "10px",
              }}
            >
              <span style={{
                width: "12px",
                height: "12px",
                borderRadius: "50%",
                background: "white",
              }} />
              Start Conversation
            </button>
          </div>
        </div>
      )}

      {/* Active recording */}
      {isRecording && (
        <div>
          {/* Recording status bar */}
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "12px",
          }}>
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "6px 14px",
              background: "#dc2626",
              borderRadius: "20px",
              color: "white",
              fontSize: "0.85rem",
              fontWeight: 600,
            }}>
              <span style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                background: "white",
                animation: "pulse 1s infinite",
              }} />
              REC
            </div>
            <div style={{
              padding: "6px 12px",
              background: sessionExpiringSoon ? "#dc2626" : "#374151",
              borderRadius: "8px",
              color: "white",
              fontSize: "0.85rem",
              fontFamily: "monospace",
              transition: "background 0.3s ease",
            }}>
              {sessionExpiringSoon
                ? `${timeRemaining}s left`
                : `${formatTime(elapsedTime)} / ${formatTime(maxDuration)}`
              }
            </div>
          </div>

          {/* Progress bar */}
          <div style={{
            height: "4px",
            background: "#e5e7eb",
            borderRadius: "2px",
            marginBottom: "16px",
            overflow: "hidden",
          }}>
            <div style={{
              height: "100%",
              width: `${progressPercent}%`,
              background: progressPercent > 80 ? "#ef4444" : "#3d5a80",
              transition: "width 0.1s linear",
            }} />
          </div>

          {/* Turn indicator */}
          <div style={{
            textAlign: "center",
            padding: "16px",
            marginBottom: "16px",
            borderRadius: "8px",
            background: phase === "coach_speaking" ? "#ede9fe" : phase === "processing" ? "#fef3c7" : "#ecfdf5",
          }}>
            {phase === "coach_speaking" && (
              needsUserAudioGesture ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
                  <span style={{ fontSize: "0.9rem", color: "#5b21b6" }}>
                    Audio couldn't start automatically.
                  </span>
                  <button
                    onClick={handleTapToPlay}
                    style={{
                      padding: "14px 28px",
                      fontSize: "1rem",
                      fontWeight: 600,
                      background: "#3d5a80",
                      color: "white",
                      border: "none",
                      borderRadius: "10px",
                      cursor: "pointer",
                    }}
                  >
                    Tap to play coach audio
                  </button>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                  <div style={{
                    width: "40px",
                    height: "40px",
                    borderRadius: "50%",
                    background: "#3d5a80",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    animation: "pulse 1.5s infinite",
                  }}>
                    <span style={{ fontSize: "1.2rem" }}>🎙️</span>
                  </div>
                  <span style={{ fontWeight: 600, color: "#5b21b6", fontSize: "1.1rem" }}>
                    Coach is speaking...
                  </span>
                </div>
              )
            )}

            {phase === "student_turn" && (
              <div>
                {/* Mic indicator */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", marginBottom: "12px" }}>
                  <div style={{
                    width: "40px",
                    height: "40px",
                    borderRadius: "50%",
                    background: "#10b981",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    animation: "pulse 1.5s infinite",
                  }}>
                    <span style={{ fontSize: "1.2rem" }}>🎤</span>
                  </div>
                  <span style={{ fontWeight: 600, color: "#047857", fontSize: "1.1rem" }}>
                    {speechDetectedRef.current ? "I hear you..." : "Listening..."}
                  </span>
                </div>

                {/* Mic level bar */}
                <div style={{
                  height: "4px",
                  background: "#e5e7eb",
                  borderRadius: "2px",
                  margin: "0 20px 12px",
                  overflow: "hidden",
                }}>
                  <div style={{
                    height: "100%",
                    width: `${micLevel * 100}%`,
                    background: "#10b981",
                    borderRadius: "2px",
                    transition: "width 0.05s ease-out",
                  }} />
                </div>

                {/* Live transcript */}
                {currentTranscript && (
                  <div style={{
                    padding: "10px",
                    background: "white",
                    borderRadius: "8px",
                    fontSize: "0.9rem",
                    color: "#333",
                    fontStyle: "italic",
                  }}>
                    "{currentTranscript}"
                  </div>
                )}
              </div>
            )}

            {phase === "processing" && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                <span style={{ fontWeight: 600, color: "#92400e", fontSize: "0.95rem" }}>
                  Coach
                </span>
                <span className="typing-dots">
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                </span>
              </div>
            )}

            {phase === "session_wrap" && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                <div style={{
                  width: "40px",
                  height: "40px",
                  borderRadius: "50%",
                  background: "#3d5a80",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}>
                  <span style={{ fontSize: "1.2rem" }}>👋</span>
                </div>
                <span style={{ fontWeight: 600, color: "#5b21b6", fontSize: "1.1rem" }}>
                  Wrapping up...
                </span>
              </div>
            )}
          </div>

          {/* Conversation panel */}
          <div
            ref={conversationPanelRef}
            style={{
              maxHeight: "50vh",
              overflowY: "auto",
              marginBottom: "16px",
              padding: "12px",
              background: "white",
              borderRadius: "8px",
              border: "1px solid #e5e7eb",
            }}
          >
            {conversationTurns.map((turn, i) => {
              // For the last coach turn, show streaming text if still revealing
              const isLastCoachTurn = turn.role === "coach" && i === conversationTurns.length - 1;
              const displayMessage = isLastCoachTurn && streamingCoachText
                ? streamingCoachText
                : turn.message;
              // Don't render empty placeholder turns
              if (!displayMessage && turn.role === "coach") return null;
              return (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    justifyContent: turn.role === "student" ? "flex-end" : "flex-start",
                    marginBottom: "8px",
                  }}
                >
                  <div style={{
                    maxWidth: "85%",
                    padding: "10px 14px",
                    borderRadius: turn.role === "student" ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
                    background: turn.role === "student" ? "#10b981" : "#3d5a80",
                    color: "white",
                    fontSize: "0.85rem",
                  }}>
                    {turn.role === "coach" && (
                      <span style={{ fontWeight: 600, marginRight: "6px" }}>Coach:</span>
                    )}
                    {displayMessage}
                  </div>
                </div>
              );
            })}
            {/* Typing indicator in conversation panel while processing */}
            {phase === "processing" && (
              <div style={{
                display: "flex",
                justifyContent: "flex-start",
                marginBottom: "8px",
              }}>
                <div style={{
                  padding: "10px 18px",
                  borderRadius: "12px 12px 12px 4px",
                  background: "#3d5a80",
                }}>
                  <span className="typing-dots">
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                  </span>
                </div>
              </div>
            )}
            {/* Show current transcript while speaking */}
            {phase === "student_turn" && currentTranscript && (
              <div style={{
                display: "flex",
                justifyContent: "flex-end",
                marginBottom: "8px",
              }}>
                <div style={{
                  maxWidth: "85%",
                  padding: "10px 14px",
                  borderRadius: "12px 12px 4px 12px",
                  background: "#86efac",
                  color: "#166534",
                  fontSize: "0.85rem",
                  fontStyle: "italic",
                }}>
                  {currentTranscript}...
                </div>
              </div>
            )}
          </div>

          {/* Small PiP camera preview */}
          {!hidePreview && (
            <div style={{
              position: "relative",
              width: "80px",
              height: "80px",
              borderRadius: "50%",
              overflow: "hidden",
              margin: "0 auto 12px",
              border: `3px solid ${phase === "student_turn" ? "#10b981" : "#dc2626"}`,
              background: "#1f2937",
            }}>
              <video
                ref={liveVideoRefCallback}
                autoPlay
                playsInline
                muted
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  transform: "scaleX(-1)",
                }}
              />
            </div>
          )}

          <div style={{ textAlign: "center", marginBottom: "12px" }}>
            <button
              onClick={() => setHidePreview(!hidePreview)}
              style={{
                padding: "4px 10px",
                fontSize: "0.7rem",
                background: "transparent",
                border: "none",
                color: "#6b7280",
                cursor: "pointer",
                textDecoration: "underline",
              }}
            >
              {hidePreview ? "Show preview" : "Hide preview"}
            </button>
          </div>

          {/* End conversation button (hidden during processing and session_wrap) */}
          {phase !== "processing" && phase !== "session_wrap" && (
            <div style={{ textAlign: "center" }}>
              <button
                onClick={endConversation}
                style={{
                  padding: "10px 20px",
                  fontSize: "0.85rem",
                  fontWeight: 500,
                  background: "#374151",
                  color: "white",
                  border: "none",
                  borderRadius: "8px",
                  cursor: "pointer",
                }}
              >
                End Conversation
              </button>
            </div>
          )}

          {/* Session expiring warning banner */}
          {sessionExpiringSoon && phase !== "session_wrap" && (
            <div style={{
              padding: "8px 16px",
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: "8px",
              textAlign: "center",
              fontSize: "0.85rem",
              color: "#dc2626",
              fontWeight: 500,
              animation: "pulse 1.5s infinite",
            }}>
              Time is almost up — wrapping up soon
            </div>
          )}
        </div>
      )}

      {/* Session Complete — preview phase */}
      {phase === "preview" && (recordedBlob || initialVideoUrl) && (
        <div>
          {/* Session Complete header */}
          <div style={{
            textAlign: "center",
            padding: "20px 16px 16px",
          }}>
            <div style={{
              width: "48px",
              height: "48px",
              borderRadius: "50%",
              background: "#dcfce7",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 12px",
              fontSize: "1.5rem",
              color: "#16a34a",
            }}>
              &#10003;
            </div>
            <h3 style={{ margin: "0 0 4px 0", fontSize: "1.15rem", color: "#166534" }}>
              Session Complete
            </h3>
          </div>

          {/* Session stats */}
          <div style={{
            display: "flex",
            justifyContent: "center",
            gap: "24px",
            marginBottom: "12px",
            fontSize: "0.85rem",
            color: "#6b7280",
          }}>
            <span>Duration: {formatTime(recordedDuration)}</span>
            <span>Coach exchanges: {coachTurnCount}</span>
          </div>

          {/* Summary — natural-language recap of student contributions */}
          {sessionSummary && (
            <p style={{
              fontSize: "0.85rem",
              color: "#4b5563",
              margin: "0 0 16px 0",
              padding: "0 8px",
              lineHeight: 1.5,
            }}>
              <span style={{ fontWeight: 600, color: "#6b7280" }}>Summary: </span>
              {sessionSummary}
            </p>
          )}

          {/* Transcript */}
          <div style={{
            maxHeight: "180px",
            overflowY: "auto",
            marginBottom: "16px",
            padding: "12px",
            background: "white",
            borderRadius: "8px",
            border: "1px solid #e5e7eb",
          }}>
            <p style={{ margin: "0 0 8px 0", fontSize: "0.75rem", color: "#6b7280", fontWeight: 600 }}>
              TRANSCRIPT
            </p>
            {conversationTurns.map((turn, i) => (
              <div key={i} style={{
                marginBottom: "8px",
                padding: "8px",
                borderRadius: "6px",
                background: turn.role === "coach" ? "#ede9fe" : "#ecfdf5",
              }}>
                <span style={{
                  fontWeight: 600,
                  color: turn.role === "coach" ? "#5b21b6" : "#047857",
                  fontSize: "0.75rem",
                }}>
                  {turn.role === "coach" ? "COACH" : "YOU"} ({formatTime(turn.timestamp)}):
                </span>
                <p style={{ margin: "4px 0 0 0", fontSize: "0.85rem", color: "#333" }}>
                  {turn.message}
                </p>
              </div>
            ))}
          </div>

          {/* Video preview (demoted below transcript) */}
          <div style={{
            width: "100%",
            maxWidth: "360px",
            margin: "0 auto 16px",
            borderRadius: "10px",
            overflow: "hidden",
            background: "#1f2937",
          }}>
            <video
              ref={previewVideoRef}
              src={recordedBlob ? URL.createObjectURL(recordedBlob) : initialVideoUrl}
              controls
              style={{ width: "100%", display: "block" }}
            />
          </div>

          {/* Action buttons — three-tier hierarchy */}
          <div style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "10px",
          }}>
            {/* Primary: Submit Assignment */}
            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              style={{
                padding: "14px 32px",
                fontSize: "0.95rem",
                fontWeight: 600,
                background: isSubmitting
                  ? "#9ca3af"
                  : "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                color: "white",
                border: "none",
                borderRadius: "10px",
                cursor: isSubmitting ? "not-allowed" : "pointer",
                width: "100%",
                maxWidth: "320px",
              }}
            >
              {isSubmitting ? "Uploading..." : "Submit Response"}
            </button>

            {/* Re-record (link style) */}
            <button
              onClick={handleReRecord}
              disabled={isSubmitting}
              style={{
                padding: "8px 16px",
                fontSize: "0.85rem",
                fontWeight: 400,
                background: "none",
                color: "#6b7280",
                border: "none",
                borderRadius: "6px",
                cursor: isSubmitting ? "not-allowed" : "pointer",
                opacity: isSubmitting ? 0.5 : 1,
                textDecoration: "underline",
              }}
            >
              Re-record
            </button>
          </div>
        </div>
      )}

      {/* CSS for animations */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        .typing-dots {
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }
        .typing-dot {
          display: inline-block;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: white;
          animation: typingDot 1.4s ease-in-out infinite;
        }
        .typing-dot:nth-child(2) {
          animation-delay: 0.2s;
        }
        .typing-dot:nth-child(3) {
          animation-delay: 0.4s;
        }
        @keyframes typingDot {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-6px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
