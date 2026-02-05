/**
 * Ask Coach Drawer - Conversational AI coach in a slide-over drawer
 *
 * Students can ask questions and explore topics from their assignments
 * without leaving their current context. The drawer overlays the current page
 * so students feel supported rather than navigated away.
 */

import { useState, useEffect, useRef, useCallback } from "react";
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
import ModeToggle from "./ModeToggle";
import { buildCoachIntro, getCoachName } from "../utils/coachIntro";

type SessionMode = "voice" | "type";
type VoiceState = "idle" | "speaking" | "listening" | "processing";

interface AskCoachDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  studentId: string;
  // Session configuration (optional - if not provided, shows topic selection)
  topics?: string[];
  inviteId?: string;
  gradeLevel?: string;
  initialMode?: SessionMode;
  // Callback to change topics (returns to topic selection)
  onChangeTopics?: () => void;
}

export default function AskCoachDrawer({
  isOpen,
  onClose,
  studentId,
  topics: initialTopics = [],
  inviteId,
  gradeLevel,
  initialMode = "type",
  onChangeTopics,
}: AskCoachDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);

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

  // Topics for the session
  const [topics] = useState<string[]>(initialTopics);

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
    stopSpeaking,
    cancelRecording,
  } = useVoice();

  // Handle ESC key to close
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleEndSession();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  // Focus drawer when it opens
  useEffect(() => {
    if (isOpen && drawerRef.current) {
      drawerRef.current.focus();
    }
  }, [isOpen]);

  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

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
        topics: coachingInvite ? [coachingInvite.title, coachingInvite.subject] : topics,
        messages: messagesWithTimestamps,
        mode,
        startedAt: sessionStartedAt,
        endedAt: new Date().toISOString(),
      });
      console.log("Coach session saved successfully");
    } catch (err) {
      console.error("Failed to save coach session:", err);
      sessionSavedRef.current = false;
    }
  }, [student, sessionStartedAt, messagesWithTimestamps, topics, mode, coachingInvite]);

  // Save session when it ends
  useEffect(() => {
    if (sessionEnded) {
      saveSession();
    }
  }, [sessionEnded, saveSession]);

  // Handle cleanup when drawer closes
  const handleEndSession = useCallback(() => {
    // Stop any ongoing voice activity
    if (isSpeaking) {
      stopSpeaking();
    }
    if (isRecording) {
      cancelRecording();
    }

    // Save session if it was started
    if (sessionStartedAt && messagesWithTimestamps.length > 0 && !sessionSavedRef.current) {
      saveCoachSession({
        studentId: student?.id || "",
        studentName: student?.name || "",
        topics: coachingInvite ? [coachingInvite.title, coachingInvite.subject] : topics,
        messages: messagesWithTimestamps,
        mode,
        startedAt: sessionStartedAt,
        endedAt: new Date().toISOString(),
      }).catch((err) => console.error("Failed to save coach session on close:", err));

      // Mark coaching invite as completed
      if (coachingInvite && messagesWithTimestamps.length > 1) {
        completeCoachingInvite(coachingInvite.id, messagesWithTimestamps.length).catch((err) =>
          console.error("Failed to complete coaching invite on close:", err)
        );
      }
    }

    onClose();
  }, [
    isSpeaking,
    isRecording,
    stopSpeaking,
    cancelRecording,
    sessionStartedAt,
    messagesWithTimestamps,
    student,
    coachingInvite,
    topics,
    mode,
    onClose,
  ]);

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
    if (!isOpen || !studentId) return;

    async function loadData() {
      setLoading(true);
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
  }, [isOpen, studentId, inviteId]);

  // Reset state when drawer opens
  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setConversationHistory([]);
      setMessagesWithTimestamps([]);
      setSessionStarted(false);
      setSessionEnded(false);
      setSessionStartedAt(null);
      sessionSavedRef.current = false;
      setVoiceState("idle");
      setMessage("");
      isProcessingRef.current = false;
    }
  }, [isOpen, initialMode]);

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
    const firstName = getCoachName(student?.name || "", student?.preferredName);

    if (coachingInvite) {
      const sessionType =
        coachingInvite.guardrails?.mode === "support"
          ? "support"
          : coachingInvite.guardrails?.mode === "enrichment"
          ? "enrichment"
          : "general";
      greeting = buildCoachIntro({
        studentName: student?.name || "",
        preferredName: student?.preferredName,
        pronouns: student?.pronouns,
        assignmentTitle: coachingInvite.assignmentTitle || coachingInvite.title,
        sessionFocus: coachingInvite.teacherNote,
        sessionType,
      });
    } else if (topics.length === 1) {
      // Single topic - direct and specific
      greeting = `Hi ${firstName}! Let's talk about ${topics[0]}. What part would you like help with?`;
    } else if (topics.length > 1) {
      // Multiple topics - acknowledge all, invite them to pick where to start
      greeting = `Hi ${firstName}! Today we can talk about ${topics.slice(0, -1).join(", ")} and ${topics[topics.length - 1]}. What should we start with?`;
    } else {
      // No topics selected - generic opener (edge case)
      greeting = `Hi ${firstName}! I'm here to help you learn. What's on your mind?`;
    }

    setConversationHistory([{ role: "coach", message: greeting }]);
    setMessagesWithTimestamps([{ role: "coach", message: greeting, timestamp: now }]);

    if (mode === "voice" && voiceAvailable) {
      await speak(greeting);
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

    const updatedHistory: ConversationMessage[] = [
      ...conversationHistory,
      { role: "student", message: msgToSend },
    ];
    setConversationHistory(updatedHistory);

    setMessagesWithTimestamps((prev) => [
      ...prev,
      { role: "student", message: msgToSend, timestamp: studentTimestamp },
    ]);

    try {
      const sessionTopics = coachingInvite
        ? [coachingInvite.title, coachingInvite.subject, ...(coachingInvite.assignmentTitle ? [coachingInvite.assignmentTitle] : [])]
        : topics;

      const response = await sendCoachChat(
        getCoachName(student.name, student.preferredName),
        sessionTopics,
        msgToSend,
        updatedHistory,
        gradeLevel,
        !!coachingInvite
      );

      const coachTimestamp = new Date().toISOString();

      setConversationHistory((prev) => [
        ...prev,
        { role: "coach", message: response.response },
      ]);

      setMessagesWithTimestamps((prev) => {
        const newMessages = [
          ...prev,
          { role: "coach", message: response.response, timestamp: coachTimestamp },
        ];

        if (coachingInvite) {
          updateCoachingInviteActivity(coachingInvite.id, newMessages.length).catch((err) =>
            console.error("Failed to update coaching invite activity:", err)
          );
        }

        return newMessages;
      });

      if (!response.shouldContinue) {
        setSessionEnded(true);
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

    if (newMode === "type" && isRecording) {
      cancelRecording();
    }

    setMode(newMode);

    if (newMode === "voice" && sessionStarted && voiceAvailable && !sessionEnded && !isProcessing) {
      setTimeout(async () => {
        setVoiceState("listening");
        await startRecording();
      }, 300);
    }
  };

  // Get voice state display info
  const getVoiceStateDisplay = () => {
    switch (voiceState) {
      case "speaking":
        return {
          icon: "",
          label: "Coach is talking...",
          background: "linear-gradient(135deg, #e3f2fd, #bbdefb)",
          color: "#1565c0",
        };
      case "listening":
        return {
          icon: "",
          label: `I'm listening... ${recordingDuration}s`,
          background: "linear-gradient(135deg, #e8f5e9, #c8e6c9)",
          color: "#2e7d32",
        };
      case "processing":
        return {
          icon: "",
          label: isTranscribing ? "Processing your words..." : "Thinking...",
          background: "linear-gradient(135deg, #fff3e0, #ffe0b2)",
          color: "#e65100",
        };
      case "idle":
      default:
        return {
          icon: "",
          label: sessionEnded ? "Great conversation!" : "What would you like help with?",
          background: "linear-gradient(135deg, #f5f5f5, #eeeeee)",
          color: "#616161",
        };
    }
  };

  if (!isOpen) return null;

  const voiceStateDisplay = getVoiceStateDisplay();

  return (
    <>
      {/* Backdrop - dimmed overlay showing underlying content */}
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(45, 55, 72, 0.4)",
          zIndex: 1000,
          animation: "fadeIn 0.2s ease-out",
        }}
        onClick={handleEndSession}
      />

      {/* Drawer Panel */}
      <div
        ref={drawerRef}
        tabIndex={-1}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "440px",
          maxWidth: "95vw",
          background: "#ffffff",
          boxShadow: "-8px 0 32px rgba(0, 0, 0, 0.12)",
          zIndex: 1001,
          display: "flex",
          flexDirection: "column",
          animation: "slideIn 0.25s ease-out",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Animation styles */}
        <style>
          {`
            @keyframes fadeIn {
              from { opacity: 0; }
              to { opacity: 1; }
            }
            @keyframes slideIn {
              from { transform: translateX(100%); }
              to { transform: translateX(0); }
            }
            @keyframes pulse {
              0%, 100% { transform: scale(1); opacity: 1; }
              50% { transform: scale(1.05); opacity: 0.9; }
            }
          `}
        </style>

        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "16px 20px",
            borderBottom: "1px solid #f1f5f9",
            background: "#fafafa",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "#667eea" }}>Coach</span>
            <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600, color: "#2d3748" }}>
              {coachingInvite ? "Coaching Session" : "Ask Coach"}
            </h2>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            {voiceAvailable && sessionStarted && !sessionEnded && (
              <ModeToggle
                mode={mode}
                onToggle={handleModeToggle}
                disabled={voiceState === "processing" || isProcessing}
              />
            )}
            <button
              onClick={handleEndSession}
              aria-label="Close drawer"
              style={{
                background: "none",
                border: "none",
                fontSize: "1.25rem",
                color: "#94a3b8",
                cursor: "pointer",
                padding: "4px 8px",
                lineHeight: 1,
                borderRadius: "4px",
              }}
            >
              ×
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div
          style={{
            flex: 1,
            overflow: "auto",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {loading ? (
            <div style={{ padding: "48px", textAlign: "center" }}>
              <div className="loading-spinner" style={{ margin: "0 auto 16px" }}></div>
              <p style={{ color: "#666" }}>Loading...</p>
            </div>
          ) : !student ? (
            <div style={{ padding: "48px", textAlign: "center" }}>
              <p style={{ color: "#666" }}>Student not found.</p>
            </div>
          ) : !sessionStarted ? (
            /* Pre-session: Start screen */
            <div style={{ padding: "24px", textAlign: "center" }}>
              {/* Coaching Invite Banner */}
              {coachingInvite && (
                <div
                  style={{
                    background: "linear-gradient(135deg, #e8f5e9, #c8e6c9)",
                    border: "2px solid #4caf50",
                    borderRadius: "12px",
                    padding: "16px",
                    marginBottom: "20px",
                    textAlign: "left",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                    <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "#166534" }}>Session</span>
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
                      From Your Teacher
                    </span>
                  </div>
                  <h3 style={{ margin: "0 0 4px 0", color: "#1b5e20", fontSize: "1rem" }}>
                    {coachingInvite.title}
                  </h3>
                  <p style={{ margin: 0, color: "#166534", fontSize: "0.85rem" }}>
                    {coachingInvite.subject}
                    {coachingInvite.assignmentTitle && ` • ${coachingInvite.assignmentTitle}`}
                  </p>
                  {coachingInvite.teacherNote && (
                    <div
                      style={{
                        background: "rgba(255,255,255,0.8)",
                        padding: "10px",
                        borderRadius: "6px",
                        borderLeft: "3px solid #4caf50",
                        marginTop: "12px",
                      }}
                    >
                      <p style={{ margin: 0, color: "#333", fontStyle: "italic", fontSize: "0.85rem" }}>
                        "{coachingInvite.teacherNote}"
                      </p>
                    </div>
                  )}
                </div>
              )}

              <div style={{ fontSize: "1.2rem", marginBottom: "16px", fontWeight: 600, color: "#667eea" }}>
                {coachingInvite ? "Session Ready" : mode === "voice" ? "Voice Mode" : "Chat Mode"}
              </div>
              <h3 style={{ margin: "0 0 8px 0", color: "#333" }}>
                {coachingInvite
                  ? "Ready for your session?"
                  : topics.length > 0
                  ? `Let's explore ${topics.join(" and ")}`
                  : "Ready to chat?"}
              </h3>
              <p style={{ color: "#666", marginBottom: "24px", fontSize: "0.9rem" }}>
                {mode === "voice"
                  ? "Click start to begin a voice conversation."
                  : "Click start to begin chatting."}
              </p>

              {/* Mode toggle before starting */}
              {voiceAvailable && (
                <div style={{ marginBottom: "16px" }}>
                  <ModeToggle mode={mode} onToggle={handleModeToggle} />
                </div>
              )}

              <button
                className="btn btn-primary"
                onClick={handleStartSession}
                style={{
                  padding: "14px 36px",
                  fontSize: "1.05rem",
                  background: coachingInvite ? "#166534" : undefined,
                }}
              >
                Start Session
              </button>
            </div>
          ) : (
            /* Active Session */
            <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
              {/* Voice State Indicator Card - always visible in voice mode */}
              {mode === "voice" && (
                <div
                  style={{
                    margin: "16px 16px 0 16px",
                    padding: "20px",
                    borderRadius: "12px",
                    background: voiceStateDisplay.background,
                    textAlign: "center",
                    cursor: voiceState === "listening" ? "pointer" : "default",
                    transition: "all 0.3s ease",
                  }}
                  onClick={voiceState === "listening" ? handleVoiceTap : undefined}
                >
                  <div
                    style={{
                      fontSize: "2.5rem",
                      marginBottom: "8px",
                      animation: voiceState === "listening" ? "pulse 1.5s infinite" : "none",
                    }}
                  >
                    {voiceStateDisplay.icon}
                  </div>
                  <p
                    style={{
                      margin: 0,
                      fontWeight: 600,
                      color: voiceStateDisplay.color,
                      fontSize: "1rem",
                    }}
                  >
                    {voiceStateDisplay.label}
                  </p>
                  {voiceState === "listening" && (
                    <p style={{ margin: "8px 0 0 0", fontSize: "0.85rem", color: "#666" }}>
                      Tap here when done speaking
                    </p>
                  )}
                </div>
              )}

              {/* Topic Context Header - shows what we're talking about */}
              {topics.length > 0 && (
                <TopicContextHeader
                  topics={topics}
                  onChangeTopics={onChangeTopics}
                />
              )}

              {/* Conversation History */}
              <div
                style={{
                  flex: 1,
                  overflow: "auto",
                  padding: "16px",
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
                        maxWidth: "85%",
                        padding: "12px 16px",
                        borderRadius: msg.role === "student" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                        background: msg.role === "student" ? "#667eea" : "#f5f5f5",
                        color: msg.role === "student" ? "white" : "#333",
                      }}
                    >
                      {msg.role === "coach" && (
                        <span style={{ marginRight: "6px", fontWeight: 600, fontSize: "0.8rem", color: "#666" }}>Coach:</span>
                      )}
                      <span style={{ fontSize: "0.95rem", lineHeight: 1.5 }}>{msg.message}</span>
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
                      <span style={{ marginRight: "6px", fontWeight: 600, fontSize: "0.8rem", color: "#666" }}>Coach:</span>
                      Thinking...
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input Area (Type Mode) */}
              {mode === "type" && !sessionEnded && (
                <form onSubmit={handleSubmit} style={{ padding: "0 16px 16px 16px" }}>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <input
                      type="text"
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="Type your message..."
                      disabled={isProcessing}
                      style={{
                        flex: 1,
                        padding: "12px 16px",
                        borderRadius: "24px",
                        border: "2px solid #e0e0e0",
                        fontSize: "0.95rem",
                        outline: "none",
                      }}
                    />
                    {voiceAvailable && (
                      <button
                        type="button"
                        onClick={handleVoiceInput}
                        disabled={isProcessing}
                        style={{
                          padding: "12px",
                          borderRadius: "50%",
                          border: "none",
                          background: isRecording ? "#f44336" : "#f5f5f5",
                          color: isRecording ? "white" : "#333",
                          cursor: "pointer",
                          fontSize: "1.1rem",
                        }}
                      >
                        {isRecording ? "Stop" : "Voice"}
                      </button>
                    )}
                    <button
                      type="submit"
                      disabled={isProcessing || !message.trim()}
                      className="btn btn-primary"
                      style={{ padding: "12px 20px", borderRadius: "24px" }}
                    >
                      Send
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>

        {/* Sticky Footer - End Coach Session button */}
        {sessionStarted && (
          <div
            style={{
              padding: "16px 20px",
              borderTop: "1px solid #f1f5f9",
              background: "#ffffff",
              flexShrink: 0,
            }}
          >
            {/* Session ended state */}
            {sessionEnded ? (
              <div style={{ textAlign: "center" }}>
                <p style={{ margin: "0 0 12px 0", color: "#4caf50", fontWeight: 500 }}>
                  Great conversation!
                </p>
                <button
                  className="btn btn-primary"
                  onClick={handleEndSession}
                  style={{
                    width: "100%",
                    padding: "14px",
                    fontSize: "1rem",
                  }}
                >
                  Close
                </button>
              </div>
            ) : (
              /* Active session - End button always visible */
              <button
                onClick={handleEndSession}
                style={{
                  width: "100%",
                  padding: "14px",
                  fontSize: "1rem",
                  fontWeight: 600,
                  background: "#1a1a2e",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "8px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                  transition: "background 0.2s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#2d2d44")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "#1a1a2e")}
              >
                <span>✕</span>
                End Coach Session
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// ============================================
// Topic Context Header Component
// Shows selected topics during active chat
// ============================================

interface TopicContextHeaderProps {
  topics: string[];
  onChangeTopics?: () => void;
}

function TopicContextHeader({ topics, onChangeTopics }: TopicContextHeaderProps) {
  const [expanded, setExpanded] = useState(false);

  if (topics.length === 0) return null;

  // Show first 2 topics, then "+N more" if there are more
  const visibleTopics = expanded ? topics : topics.slice(0, 2);
  const hiddenCount = topics.length - 2;
  const hasMore = hiddenCount > 0 && !expanded;

  return (
    <div
      style={{
        padding: "10px 16px",
        background: "#f8fafc",
        borderBottom: "1px solid #e2e8f0",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", flex: 1 }}>
          <span
            style={{
              fontSize: "0.75rem",
              fontWeight: 600,
              color: "#64748b",
              textTransform: "uppercase",
              letterSpacing: "0.03em",
              flexShrink: 0,
            }}
          >
            Talking about:
          </span>
          {visibleTopics.map((topic, index) => (
            <span
              key={index}
              style={{
                display: "inline-block",
                padding: "3px 10px",
                background: "#e0e7ff",
                color: "#4338ca",
                borderRadius: "12px",
                fontSize: "0.8rem",
                fontWeight: 500,
                whiteSpace: "nowrap",
              }}
            >
              {topic}
            </span>
          ))}
          {hasMore && (
            <button
              onClick={() => setExpanded(true)}
              style={{
                padding: "3px 8px",
                background: "transparent",
                color: "#64748b",
                border: "1px solid #cbd5e1",
                borderRadius: "12px",
                fontSize: "0.75rem",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              +{hiddenCount} more
            </button>
          )}
          {expanded && topics.length > 2 && (
            <button
              onClick={() => setExpanded(false)}
              style={{
                padding: "3px 8px",
                background: "transparent",
                color: "#64748b",
                border: "none",
                fontSize: "0.75rem",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              Show less
            </button>
          )}
        </div>
        {onChangeTopics && (
          <button
            onClick={onChangeTopics}
            style={{
              padding: "4px 10px",
              background: "transparent",
              color: "#667eea",
              border: "none",
              fontSize: "0.75rem",
              fontWeight: 500,
              cursor: "pointer",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
            onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
          >
            Change topics
          </button>
        )}
      </div>
    </div>
  );
}
