/**
 * useVoiceConversation — Conversational voice hook for Ask Coach
 *
 * Provides real-time speech recognition (Web Speech API), automatic
 * silence-based end-of-turn, and turn state management. Delegates
 * TTS playback to the existing useVoice hook.
 *
 * Ported from VideoConversationRecorder's voice logic, minus video/assignment concerns.
 */

import { useState, useRef, useCallback, useEffect } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

export type ConversationPhase = "idle" | "listening" | "processing" | "coach_speaking";

export interface UseVoiceConversationConfig {
  /** TTS function (streaming preferred). From useVoice. */
  speak: (text: string) => Promise<boolean>;
  /** Stop TTS playback. From useVoice. */
  stopSpeaking: () => void;
  /** Called when student's turn ends with a transcript. */
  onTurnEnd: (transcript: string) => void;
  /** Called when 2 consecutive no-speech retries. Component should suggest typing. */
  onNoSpeechLimit?: () => void;
  /** Whether voice features are available. From useVoice. */
  voiceAvailable: boolean;
}

export interface UseVoiceConversationReturn {
  phase: ConversationPhase;
  currentTranscript: string;
  micLevel: number;
  isListening: boolean;
  startListening: () => void;
  stopListening: () => string;
  speakAndListen: (text: string) => Promise<void>;
  speakOnly: (text: string) => Promise<void>;
  cancel: () => void;
  autoListen: boolean;
  setAutoListen: (v: boolean) => void;
  speechRecognitionSupported: boolean;
}

// ── Constants (adapted from VideoConversationRecorder) ───────────────────────

/** RMS below this = silence */
const SILENCE_THRESHOLD = 0.015;
/** RMS above this = speech detected */
const SPEECH_START_THRESHOLD = 0.025;
/** Sustained silence duration to trigger end-of-turn (slightly longer than video's 1100ms for coaching pauses) */
const SILENCE_DURATION_MS = 1200;
/** Wait after silence detected before processing */
const TRAILING_BUFFER_MS = 400;
/** Must speak at least this long before silence can end turn */
const MIN_SPEECH_BEFORE_SILENCE_MS = 1500;
/** Safety cap per student turn */
const MAX_TURN_DURATION_S = 45;
/** Ignore silence detection for this long after listening starts */
const GRACE_PERIOD_MS = 800;

// ── Silence detection pure function (exported for testing) ───────────────────

export type SilenceEvaluation =
  | "in_grace"
  | "speech_active"
  | "silence_started"
  | "silence_detected"
  | "waiting";

export function evaluateSilenceState(params: {
  rms: number;
  speechDetected: boolean;
  speechStartTime: number | null;
  silenceStartTime: number | null;
  graceEndTime: number;
  now: number;
}): SilenceEvaluation {
  const { rms, speechDetected, speechStartTime, silenceStartTime, graceEndTime, now } = params;

  if (now < graceEndTime) {
    return "in_grace";
  }

  if (rms > SPEECH_START_THRESHOLD) {
    return "speech_active";
  }

  if (rms < SILENCE_THRESHOLD) {
    if (
      speechDetected &&
      speechStartTime !== null &&
      (now - speechStartTime) >= MIN_SPEECH_BEFORE_SILENCE_MS
    ) {
      if (silenceStartTime === null) {
        return "silence_started";
      }
      if ((now - silenceStartTime) >= SILENCE_DURATION_MS) {
        return "silence_detected";
      }
    }
  }

  return "waiting";
}

// ── Web Speech API check ─────────────────────────────────────────────────────

const SpeechRecognitionAPI =
  typeof window !== "undefined"
    ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    : null;
const speechRecognitionSupported = !!SpeechRecognitionAPI;

// ── Hook ─────────────────────────────────────────────────────────────────────

export default function useVoiceConversation(
  config: UseVoiceConversationConfig
): UseVoiceConversationReturn {
  const { speak, stopSpeaking, onTurnEnd, onNoSpeechLimit, voiceAvailable } = config;

  // State
  const [phase, setPhase] = useState<ConversationPhase>("idle");
  const [currentTranscript, setCurrentTranscript] = useState("");
  const [micLevel, setMicLevel] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const [autoListen, setAutoListen] = useState(true);

  // Refs — speech recognition
  const recognitionRef = useRef<any>(null);
  const finalTranscriptRef = useRef("");

  // Refs — silence detection
  const silenceAudioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const silenceDetectionFrameRef = useRef<number | null>(null);
  const silenceStartRef = useRef<number | null>(null);
  const speechDetectedRef = useRef(false);
  const speechStartTimeRef = useRef<number | null>(null);
  const listeningGraceEndRef = useRef(0);

  // Refs — turn management
  const isDoneSpeakingRef = useRef(false);
  const noSpeechRetryRef = useRef(0);
  const turnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const phaseRef = useRef<ConversationPhase>("idle");
  const cancelledRef = useRef(false);

  // Keep phaseRef in sync with state
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Stable refs for callbacks (avoid stale closures)
  const onTurnEndRef = useRef(onTurnEnd);
  const onNoSpeechLimitRef = useRef(onNoSpeechLimit);
  const speakRef = useRef(speak);
  const stopSpeakingRef = useRef(stopSpeaking);
  useEffect(() => { onTurnEndRef.current = onTurnEnd; }, [onTurnEnd]);
  useEffect(() => { onNoSpeechLimitRef.current = onNoSpeechLimit; }, [onNoSpeechLimit]);
  useEffect(() => { speakRef.current = speak; }, [speak]);
  useEffect(() => { stopSpeakingRef.current = stopSpeaking; }, [stopSpeaking]);

  // ── Internal helpers ────────────────────────────────────────────────────

  const stopSilenceMonitor = useCallback(() => {
    if (silenceDetectionFrameRef.current !== null) {
      cancelAnimationFrame(silenceDetectionFrameRef.current);
      silenceDetectionFrameRef.current = null;
    }
    // Close the silence detection AudioContext (separate from TTS)
    if (silenceAudioContextRef.current) {
      try {
        silenceAudioContextRef.current.close();
      } catch (e) {}
      silenceAudioContextRef.current = null;
      analyserRef.current = null;
    }
  }, []);

  const stopRecognition = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {}
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  const stopMicStream = useCallback(() => {
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(track => track.stop());
      micStreamRef.current = null;
    }
  }, []);

  const clearTurnTimer = useCallback(() => {
    if (turnTimerRef.current !== null) {
      clearTimeout(turnTimerRef.current);
      turnTimerRef.current = null;
    }
  }, []);

  // ── Init speech recognition ─────────────────────────────────────────────

  const initSpeechRecognition = useCallback(() => {
    if (!SpeechRecognitionAPI) return null;

    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event: any) => {
      if (cancelledRef.current) return;
      let transcript = "";
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      finalTranscriptRef.current = transcript;
      setCurrentTranscript(transcript);
    };

    recognition.onerror = (event: any) => {
      console.log("[VoiceConv] Speech recognition error:", event.error);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    return recognition;
  }, []);

  // ── Setup silence detection ─────────────────────────────────────────────

  const setupSilenceDetection = useCallback((stream: MediaStream) => {
    try {
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);
      silenceAudioContextRef.current = audioContext;
      analyserRef.current = analyser;
    } catch (e) {
      console.log("[VoiceConv] Could not set up silence detection:", e);
    }
  }, []);

  // ── Handle done speaking (end of student turn) ──────────────────────────

  const handleDoneSpeaking = useCallback(async () => {
    if (isDoneSpeakingRef.current) return;
    isDoneSpeakingRef.current = true;

    // Stop monitoring
    stopSilenceMonitor();
    clearTurnTimer();
    stopRecognition();

    // Wait for final transcript to flush
    if (!finalTranscriptRef.current.trim()) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    if (!finalTranscriptRef.current.trim() && speechDetectedRef.current) {
      await new Promise(resolve => setTimeout(resolve, 1200));
    }

    const transcript = finalTranscriptRef.current.trim();
    setCurrentTranscript("");

    if (cancelledRef.current) return;

    // Empty transcript handling
    if (!transcript) {
      const now = Date.now();
      const pastGrace = now >= listeningGraceEndRef.current;

      if (!pastGrace) {
        // Still in grace period — restart silently
        await new Promise(resolve => setTimeout(resolve, 400));
        if (!cancelledRef.current) {
          isDoneSpeakingRef.current = false;
          startListeningInternal();
        }
        return;
      }

      noSpeechRetryRef.current += 1;
      console.log("[VoiceConv] No speech detected, retry #" + noSpeechRetryRef.current);

      if (noSpeechRetryRef.current >= 2) {
        console.log("[VoiceConv] No-speech limit reached");
        stopMicStream();
        setPhase("idle");
        setMicLevel(0);
        onNoSpeechLimitRef.current?.();
        return;
      }

      // Gentle re-prompt
      setPhase("coach_speaking");
      const reprompt = "I didn't quite catch that. Take your time and try again!";
      await speakRef.current(reprompt);

      if (cancelledRef.current) return;

      await new Promise(resolve => setTimeout(resolve, 400));
      if (!cancelledRef.current) {
        isDoneSpeakingRef.current = false;
        startListeningInternal();
      }
      return;
    }

    // Got real speech — reset retry counter
    noSpeechRetryRef.current = 0;
    stopMicStream();
    setPhase("processing");
    onTurnEndRef.current(transcript);
  }, [stopSilenceMonitor, clearTurnTimer, stopRecognition, stopMicStream]);

  // ── Start silence monitor ───────────────────────────────────────────────

  const startSilenceMonitor = useCallback(() => {
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

      const now = Date.now();
      const state = evaluateSilenceState({
        rms,
        speechDetected: speechDetectedRef.current,
        speechStartTime: speechStartTimeRef.current,
        silenceStartTime: silenceStartRef.current,
        graceEndTime: listeningGraceEndRef.current,
        now,
      });

      switch (state) {
        case "speech_active":
          speechDetectedRef.current = true;
          if (!speechStartTimeRef.current) {
            speechStartTimeRef.current = now;
          }
          silenceStartRef.current = null;
          break;
        case "silence_started":
          silenceStartRef.current = now;
          break;
        case "silence_detected":
          console.log("[VoiceConv] Silence detected, ending student turn");
          setTimeout(() => handleDoneSpeaking(), TRAILING_BUFFER_MS);
          return; // Stop the loop
        // "in_grace" and "waiting" — do nothing
      }

      silenceDetectionFrameRef.current = requestAnimationFrame(checkLevel);
    };

    checkLevel();
  }, [handleDoneSpeaking]);

  // ── Start listening (internal, reusable for retries) ────────────────────

  const startListeningInternal = useCallback(async () => {
    cancelledRef.current = false;
    setPhase("listening");
    setCurrentTranscript("");
    setMicLevel(0);

    // Reset refs
    isDoneSpeakingRef.current = false;
    speechDetectedRef.current = false;
    silenceStartRef.current = null;
    speechStartTimeRef.current = null;
    finalTranscriptRef.current = "";
    listeningGraceEndRef.current = Date.now() + GRACE_PERIOD_MS;

    // Get mic stream if we don't have one
    if (!micStreamRef.current) {
      try {
        micStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
        console.error("[VoiceConv] Microphone permission denied:", e);
        setPhase("idle");
        return;
      }
    }

    // Start speech recognition
    if (speechRecognitionSupported) {
      recognitionRef.current = initSpeechRecognition();
      if (recognitionRef.current) {
        try {
          recognitionRef.current.start();
        } catch (e) {
          console.log("[VoiceConv] Could not start recognition:", e);
        }
      }
    }

    // Setup and start silence detection
    setupSilenceDetection(micStreamRef.current);
    startSilenceMonitor();

    // Max turn safety timer
    clearTurnTimer();
    turnTimerRef.current = setTimeout(() => {
      console.log("[VoiceConv] Max turn duration reached");
      handleDoneSpeaking();
    }, MAX_TURN_DURATION_S * 1000);
  }, [initSpeechRecognition, setupSilenceDetection, startSilenceMonitor, handleDoneSpeaking, clearTurnTimer]);

  // ── Public API ──────────────────────────────────────────────────────────

  const startListening = useCallback(() => {
    if (!voiceAvailable) return;
    startListeningInternal();
  }, [voiceAvailable, startListeningInternal]);

  const stopListening = useCallback((): string => {
    isDoneSpeakingRef.current = true;
    stopSilenceMonitor();
    clearTurnTimer();
    stopRecognition();
    stopMicStream();

    const transcript = finalTranscriptRef.current.trim();
    setCurrentTranscript("");
    setMicLevel(0);

    if (transcript) {
      setPhase("processing");
      onTurnEndRef.current(transcript);
    } else {
      setPhase("idle");
    }

    return transcript;
  }, [stopSilenceMonitor, clearTurnTimer, stopRecognition, stopMicStream]);

  const speakAndListen = useCallback(async (text: string) => {
    setPhase("coach_speaking");
    setCurrentTranscript("");
    setMicLevel(0);

    await speakRef.current(text);

    if (cancelledRef.current) return;

    if (autoListen) {
      await new Promise(resolve => setTimeout(resolve, 400));
      if (!cancelledRef.current) {
        startListeningInternal();
      }
    } else {
      setPhase("idle");
    }
  }, [autoListen, startListeningInternal]);

  const speakOnly = useCallback(async (text: string) => {
    setPhase("coach_speaking");
    setCurrentTranscript("");
    setMicLevel(0);

    await speakRef.current(text);

    if (!cancelledRef.current) {
      setPhase("idle");
    }
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    stopSilenceMonitor();
    clearTurnTimer();
    stopRecognition();
    stopMicStream();
    stopSpeakingRef.current();
    setPhase("idle");
    setCurrentTranscript("");
    setMicLevel(0);
    noSpeechRetryRef.current = 0;
  }, [stopSilenceMonitor, clearTurnTimer, stopRecognition, stopMicStream]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      stopSilenceMonitor();
      clearTurnTimer();
      stopRecognition();
      stopMicStream();
    };
  }, [stopSilenceMonitor, clearTurnTimer, stopRecognition, stopMicStream]);

  return {
    phase,
    currentTranscript,
    micLevel,
    isListening,
    startListening,
    stopListening,
    speakAndListen,
    speakOnly,
    cancel,
    autoListen,
    setAutoListen,
    speechRecognitionSupported,
  };
}

// Re-export constants for testing
export {
  SILENCE_THRESHOLD,
  SPEECH_START_THRESHOLD,
  SILENCE_DURATION_MS,
  TRAILING_BUFFER_MS,
  MIN_SPEECH_BEFORE_SILENCE_MS,
  MAX_TURN_DURATION_S,
  GRACE_PERIOD_MS,
};
