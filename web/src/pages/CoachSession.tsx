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
  getCoachingInvite,
  startCoachingInvite,
  completeCoachingInvite,
  updateCoachingInviteActivity,
  type Student,
  type ConversationMessage,
  type CoachMessage,
  type CoachingInvite,
} from "../services/api";
import { useVoice } from "../hooks/useVoice";
import ModeToggle from "../components/ModeToggle";
import { buildCoachIntro, getCoachName } from "../utils/coachIntro";
import Header from "../components/Header";

type SessionMode = "voice" | "type";
type VoiceState = "idle" | "speaking" | "listening" | "processing";

export default function CoachSession() {
  const { studentId } = useParams<{ studentId: string }>();
  const [searchParams] = useSearchParams();
  const initialMode = (searchParams.get("mode") as SessionMode) || "type";
  const topicsParam = searchParams.get("topics");
  const inviteId = searchParams.get("inviteId");
  const topics = topicsParam ? JSON.parse(decodeURIComponent(topicsParam)) : [];
  const gradeLevel = searchParams.get("gradeLevel") ? decodeURIComponent(searchParams.get("gradeLevel")!) : undefined;

  // Mode state - can be toggled during the session
  const [mode, setMode] = useState<SessionMode>(initialMode);

  const [student, setStudent] = useState<Student | null>(null);
  const [coachingInvite, setCoachingInvite] = useState<CoachingInvite | null>(null);
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
          topics: coachingInvite ? [coachingInvite.title, coachingInvite.subject] : topics,
          messages: messagesWithTimestamps,
          mode,
          startedAt: sessionStartedAt,
          endedAt: new Date().toISOString(),
        }).catch((err) => console.error("Failed to save coach session on unmount:", err));

        // Mark coaching invite as completed if navigating away
        if (coachingInvite && messagesWithTimestamps.length > 1) {
          completeCoachingInvite(coachingInvite.id, messagesWithTimestamps.length).catch((err) =>
            console.error("Failed to complete coaching invite on unmount:", err)
          );
        }
      }
    };
  }, [sessionStartedAt, messagesWithTimestamps, student, topics, mode, coachingInvite]);

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

  // Load student data and coaching invite (if present)
  useEffect(() => {
    async function loadData() {
      if (!studentId) return;

      try {
        const studentData = await getStudent(studentId);
        setStudent(studentData);

        // Load coaching invite if inviteId is present
        if (inviteId) {
          try {
            const inviteResponse = await getCoachingInvite(inviteId);
            setCoachingInvite(inviteResponse.invite);
          } catch (err) {
            console.error("Failed to load coaching invite:", err);
          }
        }
      } catch (err) {
        console.error("Failed to load student:", err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [studentId, inviteId]);

  // Start session with greeting
  const handleStartSession = async () => {
    setSessionStarted(true);
    const now = new Date().toISOString();
    setSessionStartedAt(now);

    // Mark coaching invite as started if present
    if (coachingInvite) {
      try {
        const result = await startCoachingInvite(coachingInvite.id);
        setCoachingInvite(result.invite);
      } catch (err) {
        console.error("Failed to mark coaching invite as started:", err);
      }
    }

    // Build greeting using the coach intro helper
    let greeting: string;
    if (coachingInvite) {
      // Teacher-invited session (support or enrichment)
      const sessionType = coachingInvite.guardrails?.mode === "support" ? "support"
        : coachingInvite.guardrails?.mode === "enrichment" ? "enrichment"
        : "general";
      greeting = buildCoachIntro({
        studentName: student?.name || "",
        preferredName: student?.preferredName,
        pronouns: student?.pronouns,
        assignmentTitle: coachingInvite.assignmentTitle || coachingInvite.title,
        sessionFocus: coachingInvite.teacherNote,
        sessionType,
      });
    } else if (topics.length > 0) {
      const firstName = getCoachName(student?.name || "", student?.preferredName);
      greeting = `Hey ${firstName}! Welcome back. I'm excited to chat with you about ${topics.join(" and ")}. What would you like to explore or ask about?`;
    } else {
      const firstName = getCoachName(student?.name || "", student?.preferredName);
      greeting = `Hey ${firstName}! Welcome back. I'm here to help you learn today. What's on your mind?`;
    }

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
      // Use coaching invite topics if available
      const sessionTopics = coachingInvite
        ? [coachingInvite.title, coachingInvite.subject, ...(coachingInvite.assignmentTitle ? [coachingInvite.assignmentTitle] : [])]
        : topics;

      const response = await sendCoachChat(
        getCoachName(student.name, student.preferredName),
        sessionTopics,
        msgToSend,
        updatedHistory,
        gradeLevel,
        !!coachingInvite // Enable enrichment mode if this is an invited session
      );

      const coachTimestamp = new Date().toISOString();

      // Add coach response to history
      setConversationHistory((prev) => [
        ...prev,
        { role: "coach", message: response.response },
      ]);

      // Track coach response with timestamp
      setMessagesWithTimestamps((prev) => {
        const newMessages: CoachMessage[] = [
          ...prev,
          { role: "coach" as const, message: response.response, timestamp: coachTimestamp },
        ];

        // Update coaching invite activity with message count
        if (coachingInvite) {
          updateCoachingInviteActivity(coachingInvite.id, newMessages.length).catch((err) =>
            console.error("Failed to update coaching invite activity:", err)
          );
        }

        return newMessages;
      });

      if (!response.shouldContinue) {
        setSessionEnded(true);
        // Mark coaching invite as completed
        if (coachingInvite) {
          completeCoachingInvite(coachingInvite.id, messagesWithTimestamps.length + 2).catch((err) =>
            console.error("Failed to complete coaching invite:", err)
          );
        }
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
    const isEnrichmentSession = !!coachingInvite;

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
          <h1>{isEnrichmentSession ? "Special Coaching Session" : "Ask Coach"}</h1>
          <p>{isEnrichmentSession ? "An enrichment session from your teacher" : "Have a conversation about your learning"}</p>
        </div>

        {/* Teacher Invite Banner (Enrichment Mode) */}
        {coachingInvite && (
          <div
            className="card"
            style={{
              background: "linear-gradient(135deg, #e8f5e9, #c8e6c9)",
              border: "2px solid #4caf50",
              marginBottom: "16px",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: "16px" }}>
              <div
                style={{
                  fontSize: "2.5rem",
                  background: "#4caf50",
                  borderRadius: "50%",
                  width: "56px",
                  height: "56px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {/* Enrichment indicator */}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                  <span
                    style={{
                      fontSize: "0.7rem",
                      fontWeight: 600,
                      color: "#166534",
                      background: "#fff",
                      padding: "2px 8px",
                      borderRadius: "4px",
                      textTransform: "uppercase",
                    }}
                  >
                    Enrichment Session
                  </span>
                </div>
                <h3 style={{ margin: "8px 0", color: "#1b5e20" }}>
                  {coachingInvite.title}
                </h3>
                <p style={{ margin: "0 0 8px 0", color: "#166534", fontSize: "0.9rem" }}>
                  {coachingInvite.subject}
                  {coachingInvite.assignmentTitle && ` • ${coachingInvite.assignmentTitle}`}
                </p>
                {coachingInvite.teacherNote && (
                  <div
                    style={{
                      background: "rgba(255,255,255,0.8)",
                      padding: "12px",
                      borderRadius: "8px",
                      borderLeft: "4px solid #4caf50",
                      marginTop: "12px",
                    }}
                  >
                    <p style={{ margin: 0, color: "#333", fontStyle: "italic", fontSize: "0.9rem" }}>
                      "{coachingInvite.teacherNote}"
                    </p>
                    <p style={{ margin: "4px 0 0 0", color: "#666", fontSize: "0.8rem" }}>
                      — Your Teacher
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div
          className="card"
          style={{
            textAlign: "center",
            padding: "48px",
            background: isEnrichmentSession ? "linear-gradient(135deg, #f1f8e9, #dcedc8)" : undefined,
            border: isEnrichmentSession ? "2px solid #8bc34a" : undefined,
          }}
        >
          {/* Session mode indicator */}
          <h2 style={{ marginBottom: "16px" }}>
            {isEnrichmentSession
              ? "Ready for a Challenge?"
              : topics.length > 0
              ? `Let's talk about ${topics.join(" and ")}`
              : "Ready to chat?"}
          </h2>
          <p style={{ color: "#666", marginBottom: "32px" }}>
            {isEnrichmentSession
              ? "This is a special enrichment session! We'll explore deeper challenges and go beyond the basics."
              : mode === "voice"
              ? "Click start to begin a voice conversation with your coach."
              : "Click start to begin chatting with your coach."}
          </p>
          <button
            className="btn btn-primary"
            onClick={handleStartSession}
            style={{
              padding: "16px 48px",
              fontSize: "1.2rem",
              background: isEnrichmentSession ? "#166534" : undefined,
            }}
          >
            {isEnrichmentSession ? "Start Enrichment Session" : "Start Conversation"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <Header
        mode="session"
        userType="student"
        backLink={`/student/${studentId}`}
        backLabel="Dashboard"
        title={coachingInvite ? "Enrichment Session" : "Ask Coach"}
        primaryActions={
          voiceAvailable ? (
            <ModeToggle
              mode={mode}
              onToggle={handleModeToggle}
              disabled={voiceState === "processing" || isProcessing}
            />
          ) : undefined
        }
      />

      <div className="header">
        <h1>{coachingInvite ? "Enrichment Session" : "Ask Coach"}</h1>
        {coachingInvite ? (
          <p style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <span
              style={{
                background: "#4caf50",
                color: "white",
                padding: "2px 8px",
                borderRadius: "4px",
                fontSize: "0.75rem",
                fontWeight: 600,
              }}
            >
              ENRICHMENT
            </span>
            {coachingInvite.title}
          </p>
        ) : topics.length > 0 ? (
          <p>Discussing: {topics.join(", ")}</p>
        ) : null}
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
          <div style={{ fontSize: "1.1rem", marginBottom: "8px", fontWeight: 500, color: "#666" }}>
            {voiceState === "speaking" && "Speaking"}
            {voiceState === "listening" && ""}
            {voiceState === "processing" && "Processing"}
            {voiceState === "idle" && "Ready"}
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
                  background: msg.role === "student" ? "#7c8fce" : "#f5f5f5",
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
                borderRadius: "8px",
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
                {isRecording ? "Stop" : "Voice"}
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
