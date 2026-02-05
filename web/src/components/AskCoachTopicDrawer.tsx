/**
 * Ask Coach Topic Drawer - Two-step topic selection and session start flow
 *
 * Step 1: Topic selection (grouped by subject)
 * Step 2: Ready to chat confirmation with selected topics visible
 *
 * This replaces the previous modal-based topic selection.
 */

import { useState, useEffect, useRef } from "react";
// ModeToggle import kept for potential future use
import type { CoachingInvite, StudentLessonSummary, Session } from "../services/api";

type SessionMode = "voice" | "type";
type DrawerStep = "topics" | "ready";

interface TopicWithSubject {
  title: string;
  subject: string;
  lessonId?: string;
}

interface AskCoachTopicDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  studentId: string;
  // Data for topic selection
  lessons: StudentLessonSummary[];
  completedSessions: Session[];
  coachingInvites: CoachingInvite[];
  // Callback when starting a coaching invite (opens AskCoachDrawer)
  onStartInvite: (inviteId: string, mode: SessionMode) => void;
  // Callback when starting a session with selected topics (opens AskCoachDrawer)
  onStartSession: (topics: string[], mode: SessionMode, gradeLevel: string) => void;
}

export default function AskCoachTopicDrawer({
  isOpen,
  onClose,
  studentId,
  lessons,
  completedSessions,
  coachingInvites,
  onStartInvite,
  onStartSession,
}: AskCoachTopicDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);

  const [step, setStep] = useState<DrawerStep>("topics");
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [selectedMode, setSelectedMode] = useState<SessionMode>("voice");

  // Reset state when drawer opens
  useEffect(() => {
    if (isOpen) {
      setStep("topics");
      setSelectedTopics([]);
      setSelectedMode("voice");
    }
  }, [isOpen]);

  // Handle ESC key to close
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

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

  // Get available topics from lessons and completed sessions
  const getAvailableTopics = (): TopicWithSubject[] => {
    const topics: TopicWithSubject[] = [];
    const seen = new Set<string>();

    // Add current assignment titles
    lessons.forEach((l) => {
      if (!seen.has(l.title)) {
        topics.push({
          title: l.title,
          subject: l.subject || "Other",
          lessonId: l.id,
        });
        seen.add(l.title);
      }
    });

    // Add completed session titles
    completedSessions.forEach((s) => {
      if (!seen.has(s.lessonTitle)) {
        topics.push({
          title: s.lessonTitle,
          subject: "Completed",
          lessonId: s.lessonId,
        });
        seen.add(s.lessonTitle);
      }
    });

    return topics;
  };

  // Group topics by subject
  const getTopicsBySubject = (): Map<string, TopicWithSubject[]> => {
    const subjectMap = new Map<string, TopicWithSubject[]>();
    const topics = getAvailableTopics();

    topics.forEach((topic) => {
      const existing = subjectMap.get(topic.subject) || [];
      existing.push(topic);
      subjectMap.set(topic.subject, existing);
    });

    return subjectMap;
  };

  // Get subject for a selected topic
  const getSubjectForTopic = (topicTitle: string): string | undefined => {
    const topics = getAvailableTopics();
    return topics.find((t) => t.title === topicTitle)?.subject;
  };

  // Get unique subjects for selected topics
  const getSelectedSubjects = (): string[] => {
    const subjects = new Set<string>();
    selectedTopics.forEach((topic) => {
      const subject = getSubjectForTopic(topic);
      if (subject && subject !== "Completed" && subject !== "Other") {
        subjects.add(subject);
      }
    });
    return Array.from(subjects);
  };

  const handleTopicToggle = (topic: string) => {
    setSelectedTopics((prev) =>
      prev.includes(topic) ? prev.filter((t) => t !== topic) : [...prev, topic]
    );
  };

  const handleContinue = () => {
    if (selectedTopics.length > 0) {
      setStep("ready");
    }
  };

  const handleBack = () => {
    setStep("topics");
  };

  const handleStartSession = () => {
    // Get gradeLevel from first selected lesson
    const selectedLesson = lessons.find((l) => selectedTopics.includes(l.title));
    const gradeLevel = selectedLesson?.gradeLevel || "";

    // Use callback to open AskCoachDrawer
    onStartSession(selectedTopics, selectedMode, gradeLevel);
    onClose();
  };

  if (!isOpen) return null;

  const availableTopics = getAvailableTopics();
  const topicsBySubject = getTopicsBySubject();
  const selectedSubjects = getSelectedSubjects();

  return (
    <>
      {/* Backdrop */}
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
        onClick={onClose}
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
          width: "420px",
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
          `}
        </style>

        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "16px 20px",
            borderBottom: "1px solid var(--border-subtle)",
            background: "var(--surface-elevated)",
            flexShrink: 0,
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: "1.1rem",
              fontWeight: 600,
              color: "var(--text-primary)",
              letterSpacing: "-0.01em",
            }}
          >
            Ask Coach
          </h2>
          <button
            onClick={onClose}
            aria-label="Close drawer"
            style={{
              background: "none",
              border: "none",
              fontSize: "1.25rem",
              color: "var(--text-muted)",
              cursor: "pointer",
              padding: "4px 8px",
              lineHeight: 1,
              borderRadius: "4px",
              transition: "color 0.15s, background 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--text-secondary)";
              e.currentTarget.style.background = "var(--surface-muted)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--text-muted)";
              e.currentTarget.style.background = "none";
            }}
          >
            ×
          </button>
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
          {/* Teacher Coaching Invitations - Always shown at top */}
          {coachingInvites.length > 0 && (
            <div
              style={{
                margin: "16px 16px 0 16px",
                padding: "16px",
                background: "var(--status-success-bg)",
                borderRadius: "12px",
                borderLeft: "4px solid var(--status-success)",
              }}
            >
              <h4
                style={{
                  margin: "0 0 12px 0",
                  color: "var(--status-success-text)",
                  fontWeight: 600,
                  fontSize: "0.9rem",
                }}
              >
                Special Invitation{coachingInvites.length > 1 ? "s" : ""} from Your Teacher
              </h4>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {coachingInvites.map((invite) => (
                  <div
                    key={invite.id}
                    style={{
                      background: "white",
                      borderRadius: "8px",
                      padding: "12px",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                    }}
                  >
                    <h5
                      style={{
                        margin: "0 0 4px 0",
                        color: "var(--text-primary)",
                        fontWeight: 600,
                        fontSize: "0.9rem",
                      }}
                    >
                      {invite.title}
                    </h5>
                    <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                      {invite.subject}
                      {invite.assignmentTitle && ` • ${invite.assignmentTitle}`}
                    </p>
                    {invite.teacherNote && (
                      <p
                        style={{
                          margin: "8px 0 0 0",
                          padding: "8px",
                          background: "var(--surface-muted)",
                          borderRadius: "6px",
                          fontSize: "0.8rem",
                          color: "var(--text-secondary)",
                          fontStyle: "italic",
                        }}
                      >
                        "{invite.teacherNote}"
                      </p>
                    )}
                    <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
                      <button
                        className="btn btn-primary"
                        onClick={() => onStartInvite(invite.id, "voice")}
                        style={{
                          flex: 1,
                          padding: "8px",
                          fontSize: "0.85rem",
                          background: "var(--status-success-text)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: "6px",
                        }}
                      >
                        Voice
                      </button>
                      <button
                        className="btn btn-secondary"
                        onClick={() => onStartInvite(invite.id, "type")}
                        style={{
                          flex: 1,
                          padding: "8px",
                          fontSize: "0.85rem",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: "6px",
                        }}
                      >
                        Type
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Divider if there are both invites and topics */}
          {coachingInvites.length > 0 && availableTopics.length > 0 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                margin: "16px 16px 0 16px",
                color: "var(--text-muted)",
                fontSize: "0.8rem",
              }}
            >
              <div style={{ flex: 1, height: "1px", background: "var(--border-subtle)" }} />
              <span>or explore on your own</span>
              <div style={{ flex: 1, height: "1px", background: "var(--border-subtle)" }} />
            </div>
          )}

          {/* Step 1: Topic Selection */}
          {step === "topics" && (
            <div style={{ padding: "16px", flex: 1 }}>
              <h3
                style={{
                  margin: "0 0 16px 0",
                  fontSize: "1rem",
                  fontWeight: 600,
                  color: "var(--text-primary)",
                }}
              >
                Choose what you want help with
              </h3>

              {availableTopics.length === 0 ? (
                <div
                  style={{
                    padding: "32px 16px",
                    textAlign: "center",
                    color: "var(--text-muted)",
                  }}
                >
                  <p style={{ margin: 0, fontSize: "0.9rem" }}>
                    No topics available yet. Complete some assignments first!
                  </p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  {Array.from(topicsBySubject.entries()).map(([subject, topics]) => (
                    <div key={subject}>
                      {/* Subject Header */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          marginBottom: "8px",
                          paddingBottom: "4px",
                          borderBottom: "1px solid var(--border-subtle)",
                        }}
                      >
                        <span
                          style={{
                            fontSize: "0.85rem",
                            fontWeight: 600,
                            color: "var(--accent-primary)",
                          }}
                        >
                          {subject}
                        </span>
                        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                          ({topics.length})
                        </span>
                      </div>
                      {/* Topics */}
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        {topics.map((topic) => (
                          <label
                            key={topic.title}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "12px",
                              padding: "10px 12px",
                              background: selectedTopics.includes(topic.title)
                                ? "var(--surface-accent-tint)"
                                : "var(--surface-muted)",
                              borderRadius: "8px",
                              cursor: "pointer",
                              border: selectedTopics.includes(topic.title)
                                ? "2px solid var(--accent-primary)"
                                : "2px solid transparent",
                              transition: "all 0.15s ease",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={selectedTopics.includes(topic.title)}
                              onChange={() => handleTopicToggle(topic.title)}
                              style={{
                                width: "18px",
                                height: "18px",
                                accentColor: "var(--accent-primary)",
                              }}
                            />
                            <span
                              style={{
                                fontWeight: 500,
                                fontSize: "0.9rem",
                                color: "var(--text-primary)",
                              }}
                            >
                              {topic.title}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 2: Ready to Chat */}
          {step === "ready" && (
            <div style={{ padding: "16px", flex: 1 }}>
              <h3
                style={{
                  margin: "0 0 8px 0",
                  fontSize: "1.1rem",
                  fontWeight: 600,
                  color: "var(--text-primary)",
                }}
              >
                Ready to chat?
              </h3>

              {/* Selected topics display */}
              <div
                style={{
                  marginBottom: "20px",
                  padding: "16px",
                  background: "var(--surface-accent-tint)",
                  borderRadius: "12px",
                  border: "1px solid var(--accent-secondary)",
                }}
              >
                <p
                  style={{
                    margin: "0 0 8px 0",
                    fontSize: "0.85rem",
                    color: "var(--text-secondary)",
                    fontWeight: 500,
                  }}
                >
                  We'll talk about:
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {selectedTopics.map((topic) => (
                    <span
                      key={topic}
                      style={{
                        display: "inline-block",
                        padding: "6px 12px",
                        background: "var(--accent-primary)",
                        color: "white",
                        borderRadius: "16px",
                        fontSize: "0.85rem",
                        fontWeight: 500,
                      }}
                    >
                      {topic}
                    </span>
                  ))}
                </div>
                {selectedSubjects.length > 0 && (
                  <p
                    style={{
                      margin: "10px 0 0 0",
                      fontSize: "0.8rem",
                      color: "var(--text-muted)",
                    }}
                  >
                    Subject{selectedSubjects.length > 1 ? "s" : ""}: {selectedSubjects.join(", ")}
                  </p>
                )}
              </div>

              {/* Edit topics link */}
              <button
                onClick={handleBack}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--accent-primary)",
                  fontSize: "0.9rem",
                  cursor: "pointer",
                  padding: "0",
                  marginBottom: "24px",
                  textDecoration: "underline",
                  fontWeight: 500,
                }}
              >
                Edit topics
              </button>

              {/* Mode toggle */}
              <div
                style={{
                  marginBottom: "24px",
                  padding: "16px",
                  background: "var(--surface-muted)",
                  borderRadius: "12px",
                }}
              >
                <p
                  style={{
                    margin: "0 0 12px 0",
                    fontSize: "0.9rem",
                    color: "var(--text-primary)",
                    fontWeight: 500,
                  }}
                >
                  How do you want to chat?
                </p>
                <div style={{ display: "flex", gap: "12px" }}>
                  <button
                    onClick={() => setSelectedMode("voice")}
                    style={{
                      flex: 1,
                      padding: "14px",
                      border: selectedMode === "voice" ? "2px solid var(--accent-primary)" : "2px solid var(--border-subtle)",
                      borderRadius: "10px",
                      background: selectedMode === "voice" ? "var(--surface-accent-tint)" : "white",
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: "6px",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <span
                      style={{
                        fontWeight: 600,
                        fontSize: "0.95rem",
                        color: selectedMode === "voice" ? "var(--accent-primary)" : "var(--text-primary)",
                      }}
                    >
                      Voice
                    </span>
                    <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                      Talk with your coach
                    </span>
                  </button>
                  <button
                    onClick={() => setSelectedMode("type")}
                    style={{
                      flex: 1,
                      padding: "14px",
                      border: selectedMode === "type" ? "2px solid var(--accent-primary)" : "2px solid var(--border-subtle)",
                      borderRadius: "10px",
                      background: selectedMode === "type" ? "var(--surface-accent-tint)" : "white",
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: "6px",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <span
                      style={{
                        fontWeight: 600,
                        fontSize: "0.95rem",
                        color: selectedMode === "type" ? "var(--accent-primary)" : "var(--text-primary)",
                      }}
                    >
                      Type
                    </span>
                    <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                      Type your messages
                    </span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Sticky Footer */}
        <div
          style={{
            padding: "16px 20px",
            borderTop: "1px solid var(--border-subtle)",
            background: "var(--surface-elevated)",
            flexShrink: 0,
          }}
        >
          {step === "topics" && (
            <div style={{ display: "flex", gap: "12px" }}>
              <button
                className="btn btn-secondary"
                onClick={onClose}
                style={{
                  flex: 1,
                  padding: "12px",
                  fontSize: "0.95rem",
                }}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleContinue}
                disabled={selectedTopics.length === 0}
                style={{
                  flex: 1,
                  padding: "12px",
                  fontSize: "0.95rem",
                  opacity: selectedTopics.length === 0 ? 0.5 : 1,
                }}
              >
                Continue
              </button>
            </div>
          )}
          {step === "ready" && (
            <button
              className="btn btn-primary"
              onClick={handleStartSession}
              style={{
                width: "100%",
                padding: "14px",
                fontSize: "1rem",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
              }}
            >
              Start Session
            </button>
          )}
        </div>
      </div>
    </>
  );
}
