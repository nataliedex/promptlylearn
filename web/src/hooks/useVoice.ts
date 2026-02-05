import { useState, useRef, useCallback, useEffect } from "react";
import { checkVoiceStatus, transcribeAudio, textToSpeech } from "../services/api";

// PCM audio configuration from server (OpenAI TTS PCM format)
const PCM_SAMPLE_RATE = 24000; // Source sample rate from OpenAI
const PCM_CHANNELS = 1;

// Streaming playback configuration
const LATENCY_BUFFER_S = 0.08; // 80ms buffer to prevent underruns

// API base URL
const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000";

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
  speakStream: (text: string) => Promise<boolean>; // True streaming version - NO blob URLs
  stopSpeaking: () => void; // Barge-in / interrupt
  cancelRecording: () => void;
}

/**
 * Convert 16-bit signed little-endian PCM bytes to Float32 samples.
 * Input: Uint8Array of raw PCM bytes (2 bytes per sample, little-endian)
 * Output: Float32Array with values in range [-1, 1]
 */
function pcmBytesToFloat32(pcmBytes: Uint8Array): Float32Array {
  // Each sample is 2 bytes (16-bit)
  const numSamples = Math.floor(pcmBytes.length / 2);
  const float32 = new Float32Array(numSamples);

  // Create a DataView to read little-endian int16 values
  const dataView = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength);

  for (let i = 0; i < numSamples; i++) {
    // Read 16-bit signed little-endian value
    const int16 = dataView.getInt16(i * 2, true); // true = little-endian
    // Convert to float in range [-1, 1]
    float32[i] = int16 / 32768;
  }

  return float32;
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
  const isSpeakingRef = useRef(false);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null); // For non-streaming speak()
  const abortControllerRef = useRef<AbortController | null>(null);

  // Web Audio API refs for streaming playback (NO blob URLs)
  const audioContextRef = useRef<AudioContext | null>(null);
  const scheduledSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const nextPlayTimeRef = useRef<number>(0);
  const streamingActiveRef = useRef(false);
  const leftoverBytesRef = useRef<Uint8Array | null>(null); // Buffer for partial samples

  // Check if voice features are available on mount
  useEffect(() => {
    checkVoiceStatus()
      .then(({ available }) => setVoiceAvailable(available))
      .catch(() => setVoiceAvailable(false));

    // Cleanup on unmount
    return () => {
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.stream?.getTracks().forEach((track) => track.stop());
        mediaRecorderRef.current = null;
      }
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current = null;
      }
      // Stop any scheduled audio and close AudioContext on unmount
      stopScheduledAudio();
      closeAudioContext();
      if (recordingTimeoutRef.current) {
        clearTimeout(recordingTimeoutRef.current);
      }
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
      isSpeakingRef.current = false;
    };
  }, []);

  /**
   * Get or create the shared AudioContext (reused for lifetime of page)
   */
  const getAudioContext = (): AudioContext => {
    if (!audioContextRef.current || audioContextRef.current.state === "closed") {
      audioContextRef.current = new AudioContext();
    }
    // Resume if suspended (browsers suspend AudioContext until user interaction)
    if (audioContextRef.current.state === "suspended") {
      audioContextRef.current.resume().catch(() => {});
    }
    return audioContextRef.current;
  };

  /**
   * Stop and disconnect all scheduled sources, clear scheduling state.
   * Does NOT close the AudioContext (reused across calls).
   */
  const stopScheduledAudio = () => {
    // Stop and disconnect all scheduled sources
    scheduledSourcesRef.current.forEach((source) => {
      try {
        source.stop();
        source.disconnect();
      } catch {
        // Ignore errors from already stopped sources
      }
    });
    scheduledSourcesRef.current = [];

    streamingActiveRef.current = false;
    nextPlayTimeRef.current = 0;
    leftoverBytesRef.current = null;
  };

  /**
   * Close the AudioContext (only on unmount/unload)
   */
  const closeAudioContext = () => {
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
  };

  const startRecording = useCallback(async () => {
    setError(null);
    audioChunksRef.current = [];
    setRecordingDuration(0);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

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

      mediaRecorder.start(250);
      setIsRecording(true);

      durationIntervalRef.current = setInterval(() => {
        setRecordingDuration((d) => d + 1);
      }, 1000);

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
            resolve({
              text,
              audioBase64: base64,
              audioFormat: format,
            });
          } catch (err: unknown) {
            console.error("Transcription error:", err);
            const errorMessage = err instanceof Error ? err.message : "Failed to transcribe audio. Please try again.";
            setError(errorMessage);
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

  /**
   * Non-streaming speak - uses blob URL (for backwards compatibility)
   */
  const speak = useCallback(async (text: string): Promise<boolean> => {
    console.log("speak() called, voiceAvailable:", voiceAvailable, "isSpeakingRef:", isSpeakingRef.current);

    if (!voiceAvailable) {
      console.log("Speak SKIPPED: voice not available");
      return false;
    }

    if (isSpeakingRef.current) {
      console.log("Speak SKIPPED: already speaking");
      return false;
    }

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      console.log("Speak SKIPPED: invalid text", { text, type: typeof text });
      return false;
    }

    isSpeakingRef.current = true;
    setIsSpeaking(true);
    setError(null);

    try {
      console.log("Speaking:", text.substring(0, 50) + "...");

      let audio: string;
      let format: string;
      try {
        const result = await textToSpeech(text);
        audio = result.audio;
        format = result.format;
        console.log("TTS API response received, audio length:", audio?.length, "format:", format);
      } catch (apiErr: unknown) {
        const errorMessage = apiErr instanceof Error ? apiErr.message : "Unknown error";
        console.error("TTS API error:", errorMessage);
        throw new Error("TTS API failed: " + errorMessage);
      }

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
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      console.error("Speak error:", errorMessage);
      setError("Failed to play audio: " + errorMessage);
      isSpeakingRef.current = false;
      setIsSpeaking(false);
      return false;
    }
  }, [voiceAvailable]);

  /**
   * Internal stop function (no useCallback dependencies)
   * Aborts fetch, stops/disconnects scheduled sources, clears state.
   * Does NOT close AudioContext (reused across calls).
   */
  const stopSpeakingInternal = () => {
    console.log("[stopSpeaking] Interrupt requested");

    // Stop streaming loop
    streamingActiveRef.current = false;

    // Abort fetch immediately
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Stop/disconnect scheduled sources, clear scheduling state (keep AudioContext)
    stopScheduledAudio();

    // Stop non-streaming audio
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.currentTime = 0;
      if (currentAudioRef.current.src.startsWith("blob:")) {
        URL.revokeObjectURL(currentAudioRef.current.src);
      }
      currentAudioRef.current = null;
    }

    isSpeakingRef.current = false;
    setIsSpeaking(false);
    console.log("[stopSpeaking] Speech interrupted");
  };

  /**
   * True streaming TTS - plays raw PCM audio as chunks arrive.
   * Uses Web Audio API directly - NO blob URLs.
   * Audio starts playing while the network request is still streaming.
   */
  const speakStream = useCallback(async (text: string): Promise<boolean> => {
    const requestStart = performance.now();
    console.log("[speakStream] Starting, voiceAvailable:", voiceAvailable, "isSpeakingRef:", isSpeakingRef.current);

    if (!voiceAvailable) {
      console.log("[speakStream] SKIPPED: voice not available");
      return false;
    }

    // Cancel any prior playback before starting new one (no overlap)
    if (isSpeakingRef.current || streamingActiveRef.current) {
      console.log("[speakStream] Cancelling prior playback");
      stopSpeakingInternal();
    }

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      console.log("[speakStream] SKIPPED: invalid text");
      return false;
    }

    isSpeakingRef.current = true;
    streamingActiveRef.current = true;
    setIsSpeaking(true);
    setError(null);
    setTimeToFirstAudio(null);

    // Create abort controller for barge-in support
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // Get or create shared AudioContext (reused for lifetime of page)
    const audioContext = getAudioContext();

    // Initialize scheduling state
    scheduledSourcesRef.current = [];
    leftoverBytesRef.current = null;
    // Ensure nextPlayTime never schedules in the past
    nextPlayTimeRef.current = Math.max(nextPlayTimeRef.current, audioContext.currentTime + LATENCY_BUFFER_S);

    let firstChunkScheduled = false;
    let totalBytesReceived = 0;

    try {
      console.log("[speakStream] Fetching PCM audio stream...");

      const response = await fetch(`${API_BASE}/api/voice/speak/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice: "nova" }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`TTS request failed: ${response.status}`);
      }

      // Log server timing headers (dev metrics)
      const apiTimeMs = response.headers.get("X-TTS-Api-Time-Ms");
      const firstChunkMs = response.headers.get("X-Time-To-First-Chunk-Ms");
      console.log("[speakStream] Server headers - X-TTS-Api-Time-Ms:", apiTimeMs, "X-Time-To-First-Chunk-Ms:", firstChunkMs);

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body reader");
      }

      // Process PCM chunks as they arrive
      while (streamingActiveRef.current) {
        const { done, value } = await reader.read();

        if (done) {
          console.log("[speakStream] Stream complete, total bytes:", totalBytesReceived);
          break;
        }

        if (!value || value.length === 0) continue;

        totalBytesReceived += value.length;

        // Handle leftover bytes from previous chunk (for 16-bit alignment)
        let pcmBytes: Uint8Array;
        if (leftoverBytesRef.current) {
          // Combine leftover byte with new data
          pcmBytes = new Uint8Array(leftoverBytesRef.current.length + value.length);
          pcmBytes.set(leftoverBytesRef.current, 0);
          pcmBytes.set(value, leftoverBytesRef.current.length);
          leftoverBytesRef.current = null;
        } else {
          pcmBytes = value;
        }

        // Handle odd byte count (save leftover for next chunk)
        if (pcmBytes.length % 2 !== 0) {
          leftoverBytesRef.current = new Uint8Array([pcmBytes[pcmBytes.length - 1]]);
          pcmBytes = pcmBytes.slice(0, pcmBytes.length - 1);
        }

        if (pcmBytes.length === 0) continue;

        // Convert PCM bytes to Float32 samples
        const float32Samples = pcmBytesToFloat32(pcmBytes);

        // Create AudioBuffer at source sample rate - browser will resample to context rate
        const audioBuffer = audioContext.createBuffer(
          PCM_CHANNELS,
          float32Samples.length,
          PCM_SAMPLE_RATE
        );
        audioBuffer.copyToChannel(float32Samples, 0);

        // Create source node and schedule playback
        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContext.destination);

        // Ensure nextPlayTime never schedules in the past
        nextPlayTimeRef.current = Math.max(nextPlayTimeRef.current, audioContext.currentTime + LATENCY_BUFFER_S);
        const startTime = nextPlayTimeRef.current;
        source.start(startTime);

        // Update next play time for seamless continuation
        nextPlayTimeRef.current = startTime + audioBuffer.duration;

        // Track source for cleanup
        scheduledSourcesRef.current.push(source);

        // Log time to first audio output on first chunk
        if (!firstChunkScheduled) {
          const timeToFirstAudioMs = performance.now() - requestStart;
          setTimeToFirstAudio(timeToFirstAudioMs);
          console.log(`[speakStream] Time to first audio output: ${timeToFirstAudioMs.toFixed(0)}ms (scheduled at ${startTime.toFixed(3)}s)`);
          firstChunkScheduled = true;
        }
      }

      // Wait for all scheduled audio to finish playing
      if (streamingActiveRef.current && audioContext.state !== "closed") {
        const remainingTime = Math.max(0, nextPlayTimeRef.current - audioContext.currentTime);
        if (remainingTime > 0) {
          console.log(`[speakStream] Waiting ${(remainingTime * 1000).toFixed(0)}ms for playback to complete`);
          await new Promise((resolve) => setTimeout(resolve, remainingTime * 1000 + 50));
        }
      }

      const totalTime = performance.now() - requestStart;
      console.log(`[speakStream] Complete in ${totalTime.toFixed(0)}ms`);

      // Clear scheduling state (keep AudioContext for reuse)
      stopScheduledAudio();
      abortControllerRef.current = null;
      isSpeakingRef.current = false;
      setIsSpeaking(false);
      return true;

    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        console.log("[speakStream] Aborted by user");
      } else {
        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        console.error("[speakStream] Error:", errorMessage);
        setError("Failed to play audio: " + errorMessage);
      }

      // Clear scheduling state (keep AudioContext for reuse)
      stopScheduledAudio();
      abortControllerRef.current = null;
      isSpeakingRef.current = false;
      setIsSpeaking(false);
      return false;
    }
  }, [voiceAvailable]);

  /**
   * Stop speaking / barge-in - interrupts current audio playback instantly.
   * Aborts network request, stops all scheduled audio, cleans up resources.
   */
  const stopSpeaking = useCallback(() => {
    stopSpeakingInternal();
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
