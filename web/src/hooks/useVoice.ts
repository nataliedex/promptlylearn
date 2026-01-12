import { useState, useRef, useCallback, useEffect } from "react";
import { checkVoiceStatus, transcribeAudio, textToSpeech } from "../services/api";

export interface UseVoiceReturn {
  isRecording: boolean;
  isTranscribing: boolean;
  isSpeaking: boolean;
  voiceAvailable: boolean;
  error: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<string | null>;
  speak: (text: string) => Promise<void>;
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
  const audioContextRef = useRef<AudioContext | null>(null);

  // Check if voice features are available on mount
  useEffect(() => {
    checkVoiceStatus()
      .then(({ available }) => setVoiceAvailable(available))
      .catch(() => setVoiceAvailable(false));
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    audioChunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Determine the best supported MIME type
      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/mp4")
        ? "audio/mp4"
        : "audio/wav";

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start(100); // Collect data every 100ms
      setIsRecording(true);
    } catch (err) {
      setError("Could not access microphone. Please allow microphone access.");
      console.error("Recording error:", err);
    }
  }, []);

  const stopRecording = useCallback(async (): Promise<string | null> => {
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

        const audioBlob = new Blob(audioChunksRef.current, {
          type: mediaRecorder.mimeType,
        });

        // Convert to base64
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64 = (reader.result as string).split(",")[1];
          const format = mediaRecorder.mimeType.includes("webm")
            ? "webm"
            : mediaRecorder.mimeType.includes("mp4")
            ? "mp4"
            : "wav";

          try {
            const { text } = await transcribeAudio(base64, format);
            setIsTranscribing(false);
            resolve(text);
          } catch (err) {
            setError("Failed to transcribe audio. Please try again.");
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
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
      mediaRecorderRef.current = null;
      audioChunksRef.current = [];
      setIsRecording(false);
    }
  }, [isRecording]);

  const speak = useCallback(async (text: string) => {
    if (!voiceAvailable || isSpeaking) return;

    setIsSpeaking(true);
    setError(null);

    try {
      const { audio, format } = await textToSpeech(text);

      // Create audio from base64
      const audioBlob = new Blob(
        [Uint8Array.from(atob(audio), (c) => c.charCodeAt(0))],
        { type: `audio/${format}` }
      );
      const audioUrl = URL.createObjectURL(audioBlob);
      const audioElement = new Audio(audioUrl);

      audioElement.onended = () => {
        setIsSpeaking(false);
        URL.revokeObjectURL(audioUrl);
      };

      audioElement.onerror = () => {
        setIsSpeaking(false);
        URL.revokeObjectURL(audioUrl);
      };

      await audioElement.play();
    } catch (err) {
      setError("Failed to play audio.");
      setIsSpeaking(false);
    }
  }, [voiceAvailable, isSpeaking]);

  return {
    isRecording,
    isTranscribing,
    isSpeaking,
    voiceAvailable,
    error,
    startRecording,
    stopRecording,
    speak,
    cancelRecording,
  };
}
