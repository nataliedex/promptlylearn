import { useState, useRef, useCallback, useEffect } from "react";
import { checkVoiceStatus, transcribeAudio, textToSpeech } from "../services/api";

export interface UseVoiceReturn {
  isRecording: boolean;
  isTranscribing: boolean;
  isSpeaking: boolean;
  voiceAvailable: boolean;
  error: string | null;
  recordingDuration: number;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<string | null>;
  speak: (text: string) => Promise<boolean>;
  cancelRecording: () => void;
}

export function useVoice(): UseVoiceReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isSpeakingRef = useRef(false); // Use ref to track speaking state for blocking check

  // Check if voice features are available on mount
  useEffect(() => {
    checkVoiceStatus()
      .then(({ available }) => setVoiceAvailable(available))
      .catch(() => setVoiceAvailable(false));
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

  const stopRecording = useCallback(async (): Promise<string | null> => {
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
            resolve(text);
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

    isSpeakingRef.current = true;
    setIsSpeaking(true);
    setError(null);

    return new Promise(async (resolve) => {
      try {
        console.log("Speaking:", text.substring(0, 50) + "...");
        const { audio, format } = await textToSpeech(text);
        console.log("Got TTS response, format:", format, "audio length:", audio?.length);

        // Create audio from base64
        const audioBlob = new Blob(
          [Uint8Array.from(atob(audio), (c) => c.charCodeAt(0))],
          { type: `audio/${format}` }
        );
        const audioUrl = URL.createObjectURL(audioBlob);
        const audioElement = new Audio(audioUrl);

        audioElement.onended = () => {
          console.log("Speech ended successfully");
          isSpeakingRef.current = false;
          setIsSpeaking(false);
          URL.revokeObjectURL(audioUrl);
          resolve(true);
        };

        audioElement.onerror = (e) => {
          console.error("Audio playback error:", e);
          isSpeakingRef.current = false;
          setIsSpeaking(false);
          URL.revokeObjectURL(audioUrl);
          setError("Audio playback failed.");
          resolve(false);
        };

        await audioElement.play();
        console.log("Audio playback started");
      } catch (err: any) {
        console.error("Speak error:", err?.message || err);
        setError("Failed to play audio: " + (err?.message || "Unknown error"));
        isSpeakingRef.current = false;
        setIsSpeaking(false);
        resolve(false);
      }
    });
  }, [voiceAvailable]);

  return {
    isRecording,
    isTranscribing,
    isSpeaking,
    voiceAvailable,
    error,
    recordingDuration,
    startRecording,
    stopRecording,
    speak,
    cancelRecording,
  };
}
