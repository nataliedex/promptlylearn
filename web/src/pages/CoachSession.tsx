/**
 * Coach Session - Freeform conversation with the AI coach
 *
 * Students can ask questions and explore topics from their assignments
 * in a conversational, Socratic dialogue with the coach.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import {
  getStudent,
  sendCoachChat,
  saveCoachSession,
  type Student,
  type ConversationMessage,
  type CoachMessage,
} from "../services/api";
import { useVoice } from "../hooks/useVoice";
import ModeToggle from "../components/ModeToggle";

type SessionMode = "voice" | "type";
type VoiceState = "idle" | "speaking" | "listening" | "processing";

export default function CoachSession() {
  const { studentId } = useParams<{ studentId: string }>();
  const [searchParams] = useSearchParams();
  const initialMode = (searchParams.get("mode") as SessionMode) || "type";
  const topicsParam = searchParams.get("topics");
  const topics = topicsParam ? JSON.parse(decodeURIComponent(topicsParam)) : [];
  const gradeLevel = searchParams.get("gradeLevel") ? decodeURIComponent(searchParams.get("gradeLevel")!) : undefined;

  // Mode state - can be toggled during the session
  const [mode, setMode] = useState<SessionMode>(initialMode);

  const [student, setStudent] = useState<Student | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [conversationHistory, setConversationHistory] = useState<ConversationMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [sessionStarted, setSessionStarted] = useState(false);

  // Session persistence state
  const [sessionStartedAt, setSessionStartedAt] = useState<string | null>(null);
  const [messagesWithTimestamps, setMessagesWithTimestamps] = useState<CoachMessage[]>([]);
  const sessionSavedRef = useRef(false);

  // Voice mode state
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const isProcessingRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const {
    isRecording,
    isTranscribing,
    isSpeaking,
    voiceAvailable,
    recordingDuration,
    startRecording,
    stopRecording,
    speak,
    cancelRecording,
  } = useVoice();

  // Save the coach session to the backend
  const saveSession = useCallback(async () => {
    if (sessionSavedRef.current || !student || !sessionStartedAt || messagesWithTimestamps.length === 0) {
      return;
    }

    sessionSavedRef.current = true;

    try {
      await saveCoachSession({
        studentId: student.id,
        studentName: student.name,
        topics,
        messages: messagesWithTimestamps,
        mode,
        startedAt: sessionStartedAt,
        endedAt: new Date().toISOString(),
      });
      console.log("Coach session saved successfully");
    } catch (err) {
      console.error("Failed to save coach session:", err);
      // Reset flag so we can try again
      sessionSavedRef.current = false;
    }
  }, [student, sessionStartedAt, messagesWithTimestamps, topics, mode]);

  // Save session when it ends
  useEffect(() => {
    if (sessionEnded) {
      saveSession();
    }
  }, [sessionEnded, saveSession]);

  // Save session when navigating away (cleanup)
  useEffect(() => {
    return () => {
      // Only save if session was started and has messages
      if (sessionStartedAt && messagesWithTimestamps.length > 0 && !sessionSavedRef.current) {
        // Fire and forget - we can't await in cleanup
        saveCoachSession({
          studentId: student?.id || "",
          studentName: student?.name || "",
          topics,
          messages: messagesWithTimestamps,
          mode,
          startedAt: sessionStartedAt,
          endedAt: new Date().toISOString(),
        }).catch((err) => console.error("Failed to save coach session on unmount:", err));
      }
    };
  }, [sessionStartedAt, messagesWithTimestamps, student, topics, mode]);

  // Update voice state based on hook states
  useEffect(() => {
    if (isSpeaking) setVoiceState("speaking");
    else if (isRecording) setVoiceState("listening");
    else if (isTranscribing) setVoiceState("processing");
    else if (!isProcessingRef.current) setVoiceState("idle");
  }, [isSpeaking, isRecording, isTranscribing]);

  // Scroll to bottom when conversation updates
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversationHistory]);

  // Load student data
  useEffect(() => {
    async function loadData() {
      if (!studentId) return;

      try {
        const studentData = await getStudent(studentId);
        setStudent(studentData);
      } catch (err) {
        console.error("Failed to load student:", err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [studentId]);

  // Start session with greeting
  const handleStartSession = async () => {
    setSessionStarted(true);
    const now = new Date().toISOString();
    setSessionStartedAt(now);

    const greeting = topics.length > 0
      ? `Hi ${student?.name}! I'm excited to chat with you about ${topics.join(" and ")}. What would you like to explore or ask about?`
      : `Hi ${student?.name}! I'm here to help you learn. What's on your mind today?`;

    setConversationHistory([{ role: "coach", message: greeting }]);
    setMessagesWithTimestamps([{ role: "coach", message: greeting, timestamp: now }]);

    if (mode === "voice" && voiceAvailable) {
      await speak(greeting);
      // Start listening after greeting
      await new Promise((r) => setTimeout(r, 500));
      setVoiceState("listening");
      await startRecording();
    }
  };

  // Send message to coach
  const handleSendMessage = async (userMessage?: string) => {
    const msgToSend = userMessage || message;
    if (!msgToSend.trim() || !student || isProcessing) return;

    setIsProcessing(true);
    isProcessingRef.current = true;
    setMessage("");

    const studentTimestamp = new Date().toISOString();

    // Add user message to history
    const updatedHistory: ConversationMessage[] = [
      ...conversationHistory,
      { role: "student", message: msgToSend },
    ];
    setConversationHistory(updatedHistory);

    // Track student message with timestamp
    setMessagesWithTimestamps((prev) => [
      ...prev,
      { role: "student", message: msgToSend, timestamp: studentTimestamp },
    ]);

    try {
      const response = await sendCoachChat(
        student.name,
        topics,
        msgToSend,
        updatedHistory,
        gradeLevel
      );

      const coachTimestamp = new Date().toISOString();

      // Add coach response to history
      setConversationHistory((prev) => [
        ...prev,
        { role: "coach", message: response.response },
      ]);

      // Track coach response with timestamp
      setMessagesWithTimestamps((prev) => [
        ...prev,
        { role: "coach", message: response.response, timestamp: coachTimestamp },
      ]);

      if (!response.shouldContinue) {
        setSessionEnded(true);
      }

      // In voice mode, speak the response and listen for next input
      if (mode === "voice" && voiceAvailable) {
        await speak(response.response);
        if (response.shouldContinue) {
          // Start listening for next input
          await new Promise((r) => setTimeout(r, 500));
          setVoiceState("listening");
          await startRecording();
        }
      }
    } catch (err) {
      console.error("Failed to send message:", err);
      setConversationHistory((prev) => [
        ...prev,
        { role: "coach", message: "Oops! I had trouble thinking about that. Can you try again?" },
      ]);
    } finally {
      setIsProcessing(false);
      isProcessingRef.current = false;
    }
  };

  // Handle form submit
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSendMessage();
  };

  // Handle voice input for type mode (uses microphone button)
  const handleVoiceInput = async () => {
    if (isRecording) {
      const result = await stopRecording();
      if (result?.text) {
        setMessage(result.text);
      }
    } else {
      await startRecording();
    }
  };

  // Handle tap to stop recording in voice mode
  const handleVoiceTap = async () => {
    if (isRecording) {
      setVoiceState("processing");
      isProcessingRef.current = true;

      const result = await stopRecording();

      if (result?.text) {
        await handleSendMessage(result.text);
      } else {
        // No text transcribed, restart recording
        await new Promise((r) => setTimeout(r, 500));
        setVoiceState("listening");
        await startRecording();
        isProcessingRef.current = false;
      }
    }
  };

  // Handler for toggling between voice and text mode
  const handleModeToggle = (newMode: SessionMode) => {
    if (newMode === mode) return;

    // Cancel any ongoing voice activity when switching to text mode
    if (newMode === "type" && isRecording) {
      cancelRecording();
    }

    setMode(newMode);

    // If switching to voice mode and session is active, start listening
    if (newMode === "voice" && sessionStarted && voiceAvailable && !sessionEnded && !isProcessing) {
      // Start listening for next input
      setTimeout(async () => {
        setVoiceState("listening");
        await startRecording();
      }, 300);
    }
  };

  if (loading) {
    return (
      <div className="loading">
        <div className="loading-spinner"></div>
        <p>Loading...</p>
      </div>
    );
  }

  if (!student) {
    return (
      <div className="container">
        <div className="card">
          <p>Student not found.</p>
          <Link to="/" className="btn btn-primary" style={{ marginTop: "16px" }}>
            Go Home
          </Link>
        </div>
      </div>
    );
  }

  // Pre-session: Start button
  if (!sessionStarted) {
    return (
      <div className="container">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
          <Link to={`/student/${studentId}`} className="back-btn" style={{ margin: 0 }}>
            ← Back to Dashboard
          </Link>
          {voiceAvailable && (
            <ModeToggle
              mode={mode}
              onToggle={handleModeToggle}
            />
          )}
        </div>

        <div className="header">
          <h1>Ask Coach</h1>
          <p>Have a conversation about your learning</p>
        </div>

        <div className="card" style={{ textAlign: "center", padding: "48px" }}>
          <div style={{ fontSize: "4rem", marginBottom: "24px" }}>
            {mode === "voice" ? "🎤" : "💬"}
          </div>
          <h2 style={{ marginBottom: "16px" }}>
            {topics.length > 0
              ? `Let's talk about ${topics.join(" and ")}`
              : "Ready to chat?"}
          </h2>
          <p style={{ color: "#666", marginBottom: "32px" }}>
            {mode === "voice"
              ? "Click start to begin a voice conversation with your coach."
              : "Click start to begin chatting with your coach."}
          </p>
          <button
            className="btn btn-primary"
            onClick={handleStartSession}
            style={{ padding: "16px 48px", fontSize: "1.2rem" }}
          >
            Start Conversation
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <Link to={`/student/${studentId}`} className="back-btn" style={{ margin: 0 }}>
          ← Back to Dashboard
        </Link>
        {voiceAvailable && (
          <ModeToggle
            mode={mode}
            onToggle={handleModeToggle}
            disabled={voiceState === "processing" || isProcessing}
          />
        )}
      </div>

      <div className="header">
        <h1>Ask Coach</h1>
        {topics.length > 0 && (
          <p>Discussing: {topics.join(", ")}</p>
        )}
      </div>

      {/* Voice State Indicator */}
      {mode === "voice" && (
        <div
          className="card"
          style={{
            textAlign: "center",
            padding: "24px",
            background:
              voiceState === "speaking"
                ? "#e3f2fd"
                : voiceState === "listening"
                ? "#e8f5e9"
                : voiceState === "processing"
                ? "#fff3e0"
                : "#f5f5f5",
            cursor: voiceState === "listening" ? "pointer" : "default",
          }}
          onClick={voiceState === "listening" ? handleVoiceTap : undefined}
        >
          <div style={{ fontSize: "3rem", marginBottom: "8px" }}>
            {voiceState === "speaking" && "🔊"}
            {voiceState === "listening" && "🎤"}
            {voiceState === "processing" && "🤔"}
            {voiceState === "idle" && "😊"}
          </div>
          <p style={{ margin: 0, fontWeight: 500, color: "#333" }}>
            {voiceState === "speaking" && "Coach is speaking..."}
            {voiceState === "listening" && `Listening... ${recordingDuration}s`}
            {voiceState === "processing" && "Thinking..."}
            {voiceState === "idle" && (sessionEnded ? "Conversation complete!" : "Ready")}
          </p>
          {voiceState === "listening" && (
            <p style={{ margin: "8px 0 0 0", fontSize: "0.9rem", color: "#666" }}>
              Tap anywhere when done speaking
            </p>
          )}
        </div>
      )}

      {/* Conversation History - only show in type mode */}
      {mode === "type" && (
        <div
          className="card"
          style={{
            maxHeight: "400px",
            overflowY: "auto",
            marginTop: "16px",
          }}
        >
          {conversationHistory.map((msg, index) => (
            <div
              key={index}
              style={{
                display: "flex",
                justifyContent: msg.role === "student" ? "flex-end" : "flex-start",
                marginBottom: "12px",
              }}
            >
              <div
                style={{
                  maxWidth: "80%",
                  padding: "12px 16px",
                  borderRadius: msg.role === "student" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                  background: msg.role === "student" ? "#667eea" : "#f5f5f5",
                  color: msg.role === "student" ? "white" : "#333",
                }}
              >
                <p style={{ margin: 0, fontSize: "0.95rem", lineHeight: 1.5 }}>
                  {msg.message}
                </p>
              </div>
            </div>
          ))}
          {isProcessing && (
            <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: "12px" }}>
              <div
                style={{
                  padding: "12px 16px",
                  borderRadius: "16px 16px 16px 4px",
                  background: "#f5f5f5",
                  color: "#999",
                }}
              >
                <p style={{ margin: 0 }}>Thinking...</p>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* Input Area (Type Mode or Session Ended) */}
      {mode === "type" && !sessionEnded && (
        <form onSubmit={handleSubmit} style={{ marginTop: "16px" }}>
          <div style={{ display: "flex", gap: "12px" }}>
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Type your message..."
              disabled={isProcessing}
              style={{
                flex: 1,
                padding: "16px",
                borderRadius: "12px",
                border: "2px solid #e0e0e0",
                fontSize: "1rem",
              }}
            />
            {voiceAvailable && (
              <button
                type="button"
                onClick={handleVoiceInput}
                disabled={isProcessing}
                className="btn btn-secondary"
                style={{
                  padding: "16px",
                  background: isRecording ? "#f44336" : undefined,
                  color: isRecording ? "white" : undefined,
                }}
              >
                {isRecording ? "⏹" : "🎤"}
              </button>
            )}
            <button
              type="submit"
              disabled={isProcessing || !message.trim()}
              className="btn btn-primary"
              style={{ padding: "16px 24px" }}
            >
              Send
            </button>
          </div>
        </form>
      )}

      {/* Exit Button - show when session is active */}
      {!sessionEnded && (
        <div style={{ marginTop: "16px", textAlign: "center" }}>
          <Link
            to={`/student/${studentId}`}
            className="btn btn-secondary"
            style={{ padding: "12px 32px" }}
          >
            End Conversation
          </Link>
        </div>
      )}

      {/* Session Ended */}
      {sessionEnded && (
        <div className="card" style={{ marginTop: "16px", textAlign: "center", padding: "24px" }}>
          <p style={{ margin: 0, color: "#666" }}>
            Great conversation!
          </p>
          <Link
            to={`/student/${studentId}`}
            className="btn btn-primary"
            style={{ marginTop: "16px" }}
          >
            Back to Dashboard
          </Link>
        </div>
      )}
    </div>
  );
}
