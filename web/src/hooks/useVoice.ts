import { useState, useRef, useCallback, useEffect } from "react";
import { checkVoiceStatus, transcribeAudio, textToSpeech, textToSpeechStream } from "../services/api";

export interface RecordingResult {
  text: string;
  audioBase64: string;
  audioFormat: string;
}

export interface UseVoiceReturn {
  isRecording: boolean;
  isTranscribing: boolean;
  isSpeaking: boolean;
  voiceAvailable: boolean;
  error: string | null;
  recordingDuration: number;
  timeToFirstAudio: number | null; // Latency metric (ms)
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<RecordingResult | null>;
  speak: (text: string) => Promise<boolean>;
  speakStream: (text: string) => Promise<boolean>; // Streaming version for lower latency
  stopSpeaking: () => void; // Barge-in / interrupt
  cancelRecording: () => void;
}

export function useVoice(): UseVoiceReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeToFirstAudio, setTimeToFirstAudio] = useState<number | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isSpeakingRef = useRef(false); // Use ref to track speaking state for blocking check
  const currentAudioRef = useRef<HTMLAudioElement | null>(null); // Track current audio element
  const abortControllerRef = useRef<AbortController | null>(null); // For cancelling streaming requests

  // Check if voice features are available on mount
  useEffect(() => {
    checkVoiceStatus()
      .then(({ available }) => setVoiceAvailable(available))
      .catch(() => setVoiceAvailable(false));

    // Cleanup on unmount
    return () => {
      // Stop any ongoing recording
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.stream?.getTracks().forEach((track) => track.stop());
        mediaRecorderRef.current = null;
      }
      // Stop any ongoing audio playback
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current = null;
      }
      // Clear timers
      if (recordingTimeoutRef.current) {
        clearTimeout(recordingTimeoutRef.current);
      }
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
      // Reset refs
      isSpeakingRef.current = false;
    };
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    audioChunksRef.current = [];
    setRecordingDuration(0);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Determine the best supported MIME type
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/mp4")
        ? "audio/mp4"
        : "";

      const options = mimeType ? { mimeType } : undefined;
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start(250); // Collect data every 250ms
      setIsRecording(true);

      // Track recording duration
      durationIntervalRef.current = setInterval(() => {
        setRecordingDuration((d) => d + 1);
      }, 1000);

      // Auto-stop after 30 seconds to prevent huge files
      recordingTimeoutRef.current = setTimeout(() => {
        if (mediaRecorderRef.current?.state === "recording") {
          console.log("Auto-stopping recording after 30 seconds");
        }
      }, 30000);
    } catch (err) {
      setError("Could not access microphone. Please allow microphone access.");
      console.error("Recording error:", err);
    }
  }, []);

  const stopRecording = useCallback(async (): Promise<RecordingResult | null> => {
    // Clear timers
    if (recordingTimeoutRef.current) {
      clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
    }
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }

    if (!mediaRecorderRef.current || !isRecording) {
      return null;
    }

    setIsRecording(false);
    setIsTranscribing(true);
    setError(null);

    return new Promise((resolve) => {
      const mediaRecorder = mediaRecorderRef.current!;

      mediaRecorder.onstop = async () => {
        // Stop all tracks
        mediaRecorder.stream.getTracks().forEach((track) => track.stop());

        if (audioChunksRef.current.length === 0) {
          setError("No audio recorded. Please try again.");
          setIsTranscribing(false);
          resolve(null);
          return;
        }

        const audioBlob = new Blob(audioChunksRef.current, {
          type: mediaRecorder.mimeType || "audio/webm",
        });

        console.log("Audio blob size:", audioBlob.size, "bytes, type:", audioBlob.type);

        if (audioBlob.size < 1000) {
          setError("Recording too short. Please speak for at least 1 second.");
          setIsTranscribing(false);
          resolve(null);
          return;
        }

        // Convert to base64
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64 = (reader.result as string).split(",")[1];
          const mimeType = mediaRecorder.mimeType || "audio/webm";
          const format = mimeType.includes("webm")
            ? "webm"
            : mimeType.includes("mp4")
            ? "mp4"
            : "webm";

          console.log("Sending audio for transcription, format:", format, "base64 length:", base64.length);

          try {
            const { text } = await transcribeAudio(base64, format);
            setIsTranscribing(false);
            // Return both the transcribed text and the original audio
            resolve({
              text,
              audioBase64: base64,
              audioFormat: format,
            });
          } catch (err: any) {
            console.error("Transcription error:", err);
            setError(err.message || "Failed to transcribe audio. Please try again.");
            setIsTranscribing(false);
            resolve(null);
          }
        };
        reader.readAsDataURL(audioBlob);
      };

      mediaRecorder.stop();
    });
  }, [isRecording]);

  const cancelRecording = useCallback(() => {
    // Clear timers
    if (recordingTimeoutRef.current) {
      clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
    }
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }

    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
      mediaRecorderRef.current = null;
      audioChunksRef.current = [];
      setIsRecording(false);
      setRecordingDuration(0);
    }
  }, [isRecording]);

  const speak = useCallback(async (text: string): Promise<boolean> => {
    console.log("speak() called, voiceAvailable:", voiceAvailable, "isSpeakingRef:", isSpeakingRef.current);

    // Use ref for the blocking check to avoid stale state issues
    if (!voiceAvailable) {
      console.log("Speak SKIPPED: voice not available");
      return false;
    }

    if (isSpeakingRef.current) {
      console.log("Speak SKIPPED: already speaking");
      return false;
    }

    // Validate text
    if (!text || typeof text !== "string" || text.trim().length === 0) {
      console.log("Speak SKIPPED: invalid text", { text, type: typeof text });
      return false;
    }

    isSpeakingRef.current = true;
    setIsSpeaking(true);
    setError(null);

    try {
      console.log("Speaking:", text.substring(0, 50) + "...");
      console.log("Full text length:", text.length);

      // Step 1: Get audio from TTS API
      let audio: string;
      let format: string;
      try {
        const result = await textToSpeech(text);
        audio = result.audio;
        format = result.format;
        console.log("TTS API response received, audio length:", audio?.length, "format:", format);
      } catch (apiErr: any) {
        console.error("TTS API error:", apiErr?.message, apiErr?.name);
        throw new Error("TTS API failed: " + (apiErr?.message || "Unknown error"));
      }

      // Step 2: Create and play audio
      // Clean up any previous audio element first
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current = null;
      }

      const audioBlob = new Blob(
        [Uint8Array.from(atob(audio), (c) => c.charCodeAt(0))],
        { type: `audio/${format}` }
      );
      const audioUrl = URL.createObjectURL(audioBlob);
      const audioElement = new Audio(audioUrl);
      currentAudioRef.current = audioElement;

      // Return a promise that resolves when audio finishes
      return new Promise<boolean>((resolve) => {
        audioElement.onended = () => {
          console.log("Speech ended successfully");
          currentAudioRef.current = null;
          isSpeakingRef.current = false;
          setIsSpeaking(false);
          URL.revokeObjectURL(audioUrl);
          resolve(true);
        };

        audioElement.onerror = (e) => {
          console.error("Audio playback error:", e);
          currentAudioRef.current = null;
          isSpeakingRef.current = false;
          setIsSpeaking(false);
          URL.revokeObjectURL(audioUrl);
          setError("Audio playback failed.");
          resolve(false);
        };

        audioElement.play().catch((playErr) => {
          console.error("Audio play() error:", playErr);
          currentAudioRef.current = null;
          isSpeakingRef.current = false;
          setIsSpeaking(false);
          URL.revokeObjectURL(audioUrl);
          setError("Failed to start audio playback.");
          resolve(false);
        });

        console.log("Audio playback initiated");
      });
    } catch (err: any) {
      console.error("Speak error details:", {
        message: err?.message,
        name: err?.name,
        stack: err?.stack,
        text: text?.substring(0, 100),
      });
      setError("Failed to play audio: " + (err?.message || "Unknown error"));
      isSpeakingRef.current = false;
      setIsSpeaking(false);
      return false;
    }
  }, [voiceAvailable]);

  /**
   * Streaming TTS - starts playback as soon as first audio chunk arrives.
   * Reduces perceived latency compared to buffered speak().
   */
  const speakStream = useCallback(async (text: string): Promise<boolean> => {
    const requestStart = performance.now();
    console.log("[speakStream] Starting, voiceAvailable:", voiceAvailable, "isSpeakingRef:", isSpeakingRef.current);

    if (!voiceAvailable) {
      console.log("[speakStream] SKIPPED: voice not available");
      return false;
    }

    if (isSpeakingRef.current) {
      console.log("[speakStream] SKIPPED: already speaking");
      return false;
    }

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      console.log("[speakStream] SKIPPED: invalid text");
      return false;
    }

    isSpeakingRef.current = true;
    setIsSpeaking(true);
    setError(null);
    setTimeToFirstAudio(null);

    // Create abort controller for barge-in support
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      console.log("[speakStream] Fetching audio stream...");

      const response = await textToSpeechStream(text, "nova", (timeMs) => {
        setTimeToFirstAudio(timeMs);
      });

      if (abortController.signal.aborted) {
        console.log("[speakStream] Aborted before playback");
        return false;
      }

      // Get the audio as a blob for playback
      // Note: For true streaming playback, we'd use MediaSource Extensions,
      // but MP3 isn't widely supported. This approach starts playback once
      // the full response is received but the streaming reduces server wait time.
      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audioElement = new Audio(audioUrl);
      currentAudioRef.current = audioElement;

      const playbackStart = performance.now();
      const totalLatency = playbackStart - requestStart;
      console.log(`[speakStream] Audio ready, total latency: ${totalLatency.toFixed(0)}ms`);

      return new Promise<boolean>((resolve) => {
        audioElement.onended = () => {
          console.log("[speakStream] Playback ended successfully");
          currentAudioRef.current = null;
          abortControllerRef.current = null;
          isSpeakingRef.current = false;
          setIsSpeaking(false);
          URL.revokeObjectURL(audioUrl);
          resolve(true);
        };

        audioElement.onerror = (e) => {
          console.error("[speakStream] Playback error:", e);
          currentAudioRef.current = null;
          abortControllerRef.current = null;
          isSpeakingRef.current = false;
          setIsSpeaking(false);
          URL.revokeObjectURL(audioUrl);
          setError("Audio playback failed.");
          resolve(false);
        };

        audioElement.play().catch((playErr) => {
          console.error("[speakStream] play() error:", playErr);
          currentAudioRef.current = null;
          abortControllerRef.current = null;
          isSpeakingRef.current = false;
          setIsSpeaking(false);
          URL.revokeObjectURL(audioUrl);
          setError("Failed to start audio playback.");
          resolve(false);
        });
      });
    } catch (err: any) {
      console.error("[speakStream] Error:", err?.message);
      setError("Failed to play audio: " + (err?.message || "Unknown error"));
      abortControllerRef.current = null;
      isSpeakingRef.current = false;
      setIsSpeaking(false);
      return false;
    }
  }, [voiceAvailable]);

  /**
   * Stop speaking / barge-in - interrupts current audio playback.
   * Allows user to interrupt the coach mid-speech.
   */
  const stopSpeaking = useCallback(() => {
    console.log("[stopSpeaking] Interrupt requested");

    // Abort any ongoing fetch
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Stop current audio playback
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.currentTime = 0;
      // Clean up the object URL if it exists
      if (currentAudioRef.current.src.startsWith("blob:")) {
        URL.revokeObjectURL(currentAudioRef.current.src);
      }
      currentAudioRef.current = null;
    }

    isSpeakingRef.current = false;
    setIsSpeaking(false);
    console.log("[stopSpeaking] Speech interrupted");
  }, []);

  return {
    isRecording,
    isTranscribing,
    isSpeaking,
    voiceAvailable,
    error,
    recordingDuration,
    timeToFirstAudio,
    startRecording,
    stopRecording,
    speak,
    speakStream,
    stopSpeaking,
    cancelRecording,
  };
}
