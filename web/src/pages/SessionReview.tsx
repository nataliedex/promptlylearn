import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import EducatorHeader from "../components/EducatorHeader";
import {
  getSession,
  getLesson,
  getStudent,
  updateSession,
  textToSpeech,
  type Session,
  type Lesson,
} from "../services/api";

export default function SessionReview() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [session, setSession] = useState<Session | null>(null);
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [studentFullName, setStudentFullName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const [speakingType, setSpeakingType] = useState<"question" | "response" | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Educator notes state
  const [sessionNotes, setSessionNotes] = useState("");
  const [responseNotes, setResponseNotes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!sessionId) return;

    async function loadData() {
      try {
        const sessionData = await getSession(sessionId!);
        setSession(sessionData);

        // Initialize notes state from session data
        setSessionNotes(sessionData.educatorNotes || "");
        const notesMap: Record<string, string> = {};
        sessionData.submission.responses.forEach((r) => {
          if (r.educatorNote) {
            notesMap[r.promptId] = r.educatorNote;
          }
        });
        setResponseNotes(notesMap);

        const lessonData = await getLesson(sessionData.lessonId);
        setLesson(lessonData);

        // Fetch student's full name for educator display
        try {
          const studentData = await getStudent(sessionData.studentId);
          setStudentFullName(studentData.name);
        } catch {
          // Fallback to session's stored name if student fetch fails
          setStudentFullName(sessionData.studentName);
        }
      } catch (err) {
        console.error("Failed to load session:", err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [sessionId]);

  // Play audio using TTS (for questions)
  const playTTSAudio = async (text: string, index: number, type: "question" | "response") => {
    // Stop any currently playing audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    // If clicking the same button that's playing, just stop
    if (playingIndex === index && speakingType === type) {
      setPlayingIndex(null);
      setSpeakingType(null);
      return;
    }

    setPlayingIndex(index);
    setSpeakingType(type);

    try {
      const { audio, format } = await textToSpeech(text);

      const audioBlob = new Blob(
        [Uint8Array.from(atob(audio), (c) => c.charCodeAt(0))],
        { type: `audio/${format}` }
      );
      const audioUrl = URL.createObjectURL(audioBlob);
      const audioElement = new Audio(audioUrl);
      audioRef.current = audioElement;

      audioElement.onended = () => {
        setPlayingIndex(null);
        setSpeakingType(null);
        URL.revokeObjectURL(audioUrl);
        audioRef.current = null;
      };

      audioElement.onerror = () => {
        setPlayingIndex(null);
        setSpeakingType(null);
        URL.revokeObjectURL(audioUrl);
        audioRef.current = null;
      };

      await audioElement.play();
    } catch (err) {
      console.error("Failed to play audio:", err);
      setPlayingIndex(null);
      setSpeakingType(null);
    }
  };

  // Play stored student audio recording
  const playStoredAudio = (audioBase64: string, audioFormat: string, index: number) => {
    // Stop any currently playing audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    // If clicking the same button that's playing, just stop
    if (playingIndex === index && speakingType === "response") {
      setPlayingIndex(null);
      setSpeakingType(null);
      return;
    }

    setPlayingIndex(index);
    setSpeakingType("response");

    try {
      const audioBlob = new Blob(
        [Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0))],
        { type: `audio/${audioFormat}` }
      );
      const audioUrl = URL.createObjectURL(audioBlob);
      const audioElement = new Audio(audioUrl);
      audioRef.current = audioElement;

      audioElement.onended = () => {
        setPlayingIndex(null);
        setSpeakingType(null);
        URL.revokeObjectURL(audioUrl);
        audioRef.current = null;
      };

      audioElement.onerror = () => {
        console.error("Failed to play stored audio");
        setPlayingIndex(null);
        setSpeakingType(null);
        URL.revokeObjectURL(audioUrl);
        audioRef.current = null;
      };

      audioElement.play();
    } catch (err) {
      console.error("Failed to play stored audio:", err);
      setPlayingIndex(null);
      setSpeakingType(null);
    }
  };

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      // Clear any pending save timeout
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // Auto-save notes with debounce
  const saveNotes = useCallback(async () => {
    if (!session || !sessionId) return;

    setSaving(true);
    try {
      // Update responses with educator notes
      const updatedResponses = session.submission.responses.map((r) => ({
        ...r,
        educatorNote: responseNotes[r.promptId] || undefined,
      }));

      await updateSession(sessionId, {
        educatorNotes: sessionNotes || undefined,
        submission: {
          ...session.submission,
          responses: updatedResponses,
        },
      });

      setLastSaved(new Date());
    } catch (err) {
      console.error("Failed to save notes:", err);
    } finally {
      setSaving(false);
    }
  }, [session, sessionId, sessionNotes, responseNotes]);

  // Debounced save - triggers 1 second after last change
  const debouncedSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      saveNotes();
    }, 1000);
  }, [saveNotes]);

  // Handle session notes change
  const handleSessionNotesChange = (value: string) => {
    setSessionNotes(value);
    debouncedSave();
  };

  // Handle response note change
  const handleResponseNoteChange = (promptId: string, value: string) => {
    setResponseNotes((prev) => ({
      ...prev,
      [promptId]: value,
    }));
    debouncedSave();
  };

  if (loading) {
    return (
      <div className="loading">
        <div className="loading-spinner"></div>
        <p>Loading session...</p>
      </div>
    );
  }

  if (!session || !lesson) {
    return (
      <div className="container">
        <EducatorHeader breadcrumbs={[{ label: "Session not found" }]} />
        <div className="card">
          <p>Session not found.</p>
          <Link to="/educator" className="btn btn-primary" style={{ marginTop: "16px" }}>
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  const getPromptById = (promptId: string) => {
    return lesson.prompts.find((p) => p.id === promptId);
  };

  return (
    <div className="container">
      <EducatorHeader
        breadcrumbs={[
          { label: studentFullName || session.studentName || "Student", to: `/educator/student/${session.studentId}` },
          { label: session.lessonTitle || "Session" },
        ]}
      />

      <div className="header">
        <h1>{session.lessonTitle}</h1>
        <p>
          {studentFullName || session.studentName} • {new Date(session.completedAt || session.startedAt).toLocaleDateString()}
        </p>
      </div>

      {/* Session Score */}
      <div className="card" style={{ textAlign: "center", padding: "24px" }}>
        <div
          style={{
            fontSize: "3rem",
            fontWeight: 700,
            color:
              (session.evaluation?.totalScore ?? 0) >= 70
                ? "#4caf50"
                : (session.evaluation?.totalScore ?? 0) >= 50
                ? "#ff9800"
                : "#f44336",
          }}
        >
          {session.evaluation?.totalScore ?? 0}/100
        </div>
        <p style={{ color: "#666", marginTop: "8px" }}>Overall Score</p>
        {session.evaluation?.feedback && (
          <p style={{ marginTop: "16px", fontStyle: "italic", color: "#555" }}>
            "{session.evaluation.feedback}"
          </p>
        )}
      </div>

      {/* Educator Notes for Overall Session */}
      <div className="card" style={{ marginTop: "24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
          <h3 style={{ margin: 0 }}>Educator Notes</h3>
          {saving && <span style={{ color: "#666", fontSize: "0.85rem" }}>Saving...</span>}
          {!saving && lastSaved && (
            <span style={{ color: "#4caf50", fontSize: "0.85rem" }}>
              Saved {lastSaved.toLocaleTimeString()}
            </span>
          )}
        </div>
        <textarea
          value={sessionNotes}
          onChange={(e) => handleSessionNotesChange(e.target.value)}
          placeholder="Add notes about this session (feedback for the student, areas to focus on, etc.)..."
          style={{
            width: "100%",
            minHeight: "100px",
            padding: "12px",
            borderRadius: "8px",
            border: "2px solid #e0e0e0",
            fontSize: "1rem",
            fontFamily: "inherit",
            resize: "vertical",
            boxSizing: "border-box",
          }}
        />
      </div>

      {/* Transcript */}
      <h2 style={{ color: "white", marginBottom: "16px", marginTop: "32px" }}>
        Session Transcript
      </h2>

      {session.submission.responses.map((response, index) => {
        const prompt = getPromptById(response.promptId);
        const criteriaScore = session.evaluation?.criteriaScores?.find(
          (c) => c.criterionId === response.promptId
        );

        return (
          <div key={response.promptId} className="card" style={{ marginBottom: "16px" }}>
            {/* Question */}
            <div style={{ marginBottom: "16px" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
                <span
                  style={{
                    background: "#667eea",
                    color: "white",
                    padding: "4px 10px",
                    borderRadius: "12px",
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    flexShrink: 0,
                  }}
                >
                  Q{index + 1}
                </span>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontWeight: 500, lineHeight: 1.5 }}>
                    {prompt?.input || "Question not found"}
                  </p>
                </div>
                <button
                  onClick={() => playTTSAudio(prompt?.input || "", index, "question")}
                  style={{
                    background: playingIndex === index && speakingType === "question" ? "#667eea" : "#f0f0f0",
                    color: playingIndex === index && speakingType === "question" ? "white" : "#333",
                    border: "none",
                    borderRadius: "50%",
                    width: "36px",
                    height: "36px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                  title="Listen to question"
                >
                  {playingIndex === index && speakingType === "question" ? "Stop" : "Play"}
                </button>
              </div>
            </div>

            {/* Student Response */}
            <div
              style={{
                background: "#f5f5f5",
                borderRadius: "12px",
                padding: "16px",
                marginBottom: "12px",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
                <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "#666" }}>Student</span>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontSize: "0.85rem", color: "#666", marginBottom: "4px" }}>
                    Student's Response
                  </p>
                  <p style={{ margin: 0, lineHeight: 1.6 }}>{response.response}</p>
                  <div style={{ display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" }}>
                    {response.audioBase64 && (
                      <span
                        style={{
                          display: "inline-block",
                          background: "#e8f5e9",
                          color: "#2e7d32",
                          padding: "2px 8px",
                          borderRadius: "4px",
                          fontSize: "0.8rem",
                        }}
                      >
                        Voice recording
                      </span>
                    )}
                    {response.hintUsed && (
                      <span
                        style={{
                          display: "inline-block",
                          background: "#fff3e0",
                          color: "#ef6c00",
                          padding: "2px 8px",
                          borderRadius: "4px",
                          fontSize: "0.8rem",
                        }}
                      >
                        Used hint
                      </span>
                    )}
                  </div>
                </div>
                {/* Play button - uses stored audio if available, otherwise TTS */}
                {response.audioBase64 && response.audioFormat ? (
                  <button
                    onClick={() => playStoredAudio(response.audioBase64!, response.audioFormat!, index)}
                    style={{
                      background: playingIndex === index && speakingType === "response" ? "#667eea" : "#e8f5e9",
                      color: playingIndex === index && speakingType === "response" ? "white" : "#2e7d32",
                      border: "none",
                      borderRadius: "50%",
                      width: "36px",
                      height: "36px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                    title="Listen to student's voice recording"
                  >
                    {playingIndex === index && speakingType === "response" ? "Stop" : "Play"}
                  </button>
                ) : (
                  <button
                    onClick={() => playTTSAudio(response.response, index, "response")}
                    style={{
                      background: playingIndex === index && speakingType === "response" ? "#667eea" : "#f0f0f0",
                      color: playingIndex === index && speakingType === "response" ? "white" : "#333",
                      border: "none",
                      borderRadius: "50%",
                      width: "36px",
                      height: "36px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                    title="Listen to response (text-to-speech)"
                  >
                    {playingIndex === index && speakingType === "response" ? "Stop" : "Play"}
                  </button>
                )}
              </div>
            </div>

            {/* Score for this question */}
            {criteriaScore && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "8px 12px",
                  background:
                    criteriaScore.score >= 70
                      ? "#e8f5e9"
                      : criteriaScore.score >= 50
                      ? "#fff3e0"
                      : "#ffebee",
                  borderRadius: "8px",
                }}
              >
                <span style={{ fontSize: "1rem" }}>
                  {criteriaScore.score >= 70 ? "Good" : criteriaScore.score >= 50 ? "OK" : "Review"}
                </span>
                <span
                  style={{
                    fontWeight: 600,
                    color:
                      criteriaScore.score >= 70
                        ? "#2e7d32"
                        : criteriaScore.score >= 50
                        ? "#ef6c00"
                        : "#c62828",
                  }}
                >
                  Score: {criteriaScore.score}/100
                </span>
                {criteriaScore.comment && (
                  <span style={{ color: "#666", marginLeft: "8px" }}>
                    - {criteriaScore.comment}
                  </span>
                )}
              </div>
            )}

            {/* Reflection if present */}
            {response.reflection && (
              <div
                style={{
                  marginTop: "12px",
                  padding: "12px",
                  background: "#e3f2fd",
                  borderRadius: "8px",
                }}
              >
                <p style={{ margin: 0, fontSize: "0.85rem", color: "#1565c0", marginBottom: "4px" }}>
                  Student's Reflection
                </p>
                <p style={{ margin: 0, color: "#333" }}>{response.reflection}</p>
              </div>
            )}

            {/* Educator note for this response */}
            <div style={{ marginTop: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                <span style={{ fontSize: "0.85rem", color: "#666" }}>Your note for this response:</span>
              </div>
              <textarea
                value={responseNotes[response.promptId] || ""}
                onChange={(e) => handleResponseNoteChange(response.promptId, e.target.value)}
                placeholder="Add a note about this specific response..."
                style={{
                  width: "100%",
                  minHeight: "60px",
                  padding: "10px",
                  borderRadius: "8px",
                  border: "1px solid #e0e0e0",
                  fontSize: "0.9rem",
                  fontFamily: "inherit",
                  resize: "vertical",
                  boxSizing: "border-box",
                  background: "#fafafa",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
