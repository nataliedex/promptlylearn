import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate, Link, useSearchParams } from "react-router-dom";
import {
  getStudent,
  getStudentLessons,
  getSessions,
  createSession,
  getStudentBadges,
  getStudentNotes,
  getLessons,
  getLesson,
  markBadgeCelebrated,
  getStudentCoachingInvites,
  type Student,
  type StudentLessonSummary,
  type Session,
  type StudentBadge,
  type StudentNote,
  type LessonSummary,
  type Lesson,
  type Prompt,
  type CoachingInvite,
} from "../services/api";
import BadgeDetailModal from "../components/BadgeDetailModal";
import BadgeCelebrationOverlay from "../components/BadgeCelebrationOverlay";

type SessionMode = "voice" | "type";

// Badge display names and icons
const BADGE_DISPLAY: Record<string, { name: string; icon: string }> = {
  progress_star: { name: "Progress Star", icon: "⭐" },
  mastery_badge: { name: "Mastery Badge", icon: "🏆" },
  effort_award: { name: "Effort Award", icon: "💪" },
  helper_badge: { name: "Helper Badge", icon: "🤝" },
  persistence: { name: "Focus Badge", icon: "🎯" },
  curiosity: { name: "Curiosity Award", icon: "🔍" },
  custom: { name: "Special Badge", icon: "🌟" },
};

// Subject grouping type
interface SubjectGroup {
  subject: string;
  sessions: Session[];
  badges: StudentBadge[];
  notes: StudentNote[];
  latestCompletedAt: string;
}

export default function StudentDashboard() {
  const { studentId } = useParams<{ studentId: string }>();
  const navigate = useNavigate();

  const [student, setStudent] = useState<Student | null>(null);
  const [lessons, setLessons] = useState<StudentLessonSummary[]>([]);
  const [allLessons, setAllLessons] = useState<LessonSummary[]>([]); // All lessons for subject lookup
  const [sessions, setSessions] = useState<Session[]>([]);
  const [badges, setBadges] = useState<StudentBadge[]>([]);
  const [notes, setNotes] = useState<StudentNote[]>([]);
  const [coachingInvites, setCoachingInvites] = useState<CoachingInvite[]>([]);
  const [loading, setLoading] = useState(true);

  // Ask Coach modal state
  const [showCoachModal, setShowCoachModal] = useState(false);
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);

  // Completed Work section collapsed state
  const [completedExpanded, setCompletedExpanded] = useState(false);
  // Track which individual assignments are expanded (by lessonId)
  const [expandedAssignments, setExpandedAssignments] = useState<Set<string>>(new Set());
  // Track which subjects are expanded
  const [expandedSubjects, setExpandedSubjects] = useState<Set<string>>(new Set());
  // Track which subject note views are expanded
  const [expandedSubjectNotes, setExpandedSubjectNotes] = useState<Set<string>>(new Set());
  // Track badge tooltip/modal state
  const [selectedBadge, setSelectedBadge] = useState<StudentBadge | null>(null);

  // Lesson prompts cache for displaying student responses
  const [lessonPrompts, setLessonPrompts] = useState<Map<string, Prompt[]>>(new Map());
  const [loadingLessonPrompts, setLoadingLessonPrompts] = useState<Set<string>>(new Set());

  // Track which sessions are expanded to show "My Answers"
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());

  // Badge navigation highlighting
  const [searchParams, setSearchParams] = useSearchParams();
  const [highlightedSessionId, setHighlightedSessionId] = useState<string | null>(null);
  const [highlightBadge, setHighlightBadge] = useState<StudentBadge | null>(null);

  // Badge celebration state
  const [celebrationBadge, setCelebrationBadge] = useState<StudentBadge | null>(null);
  const celebrationChecked = useRef(false); // Prevent multiple celebration checks per mount

  // Refs for scrolling
  const sessionRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    if (!studentId) return;

    async function loadData() {
      try {
        const [studentData, studentLessonsData, sessionsData, badgesData, notesData, allLessonsData, invitesData] = await Promise.all([
          getStudent(studentId!),
          getStudentLessons(studentId!),
          getSessions(studentId, "completed"),
          getStudentBadges(studentId!).catch(() => ({ badges: [] as StudentBadge[], count: 0, studentId: "", studentName: "" })),
          getStudentNotes(studentId!).catch(() => ({ notes: [] as StudentNote[], count: 0, studentId: "", studentName: "" })),
          getLessons().catch(() => [] as LessonSummary[]), // Fetch all lessons for subject lookup
          getStudentCoachingInvites(studentId!, "pending").catch(() => ({ invites: [] as CoachingInvite[], counts: { pending: 0, started: 0, completed: 0, dismissed: 0, total: 0 } })),
        ]);
        setStudent(studentData);
        setAllLessons(allLessonsData);

        // Deduplicate coaching invites by title + assignmentId, keeping the most recent
        const uniqueInvites = invitesData.invites.reduce((acc: CoachingInvite[], invite) => {
          const key = `${invite.title}|${invite.assignmentId || ""}`;
          const existingIndex = acc.findIndex(
            (i) => `${i.title}|${i.assignmentId || ""}` === key
          );
          if (existingIndex === -1) {
            acc.push(invite);
          } else {
            // Keep the more recent one
            if (new Date(invite.createdAt) > new Date(acc[existingIndex].createdAt)) {
              acc[existingIndex] = invite;
            }
          }
          return acc;
        }, []);
        setCoachingInvites(uniqueInvites);

        // Sort lessons: by assigned date (oldest first), then by subject (alphabetical)
        const sortedLessons = [...studentLessonsData.lessons].sort((a, b) => {
          // First sort by assigned date (oldest first)
          const dateA = a.assignedAt ? new Date(a.assignedAt).getTime() : 0;
          const dateB = b.assignedAt ? new Date(b.assignedAt).getTime() : 0;
          if (dateA !== dateB) return dateA - dateB;

          // Then sort by subject alphabetically (no subject goes last)
          const subjectA = a.subject || "";
          const subjectB = b.subject || "";
          if (subjectA && !subjectB) return -1;
          if (!subjectA && subjectB) return 1;
          return subjectA.localeCompare(subjectB);
        });
        setLessons(sortedLessons);
        setSessions(sessionsData);
        setBadges(badgesData.badges);
        setNotes(notesData.notes);
      } catch (err) {
        console.error("Failed to load dashboard:", err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [studentId]);

  // Handle URL params for badge navigation (runs after data loads)
  useEffect(() => {
    if (loading || sessions.length === 0) return;

    const highlightAssignmentId = searchParams.get("highlightAssignmentId");
    const highlightSessionId = searchParams.get("highlightSessionId");
    const badgeId = searchParams.get("badgeId");

    if (highlightAssignmentId || highlightSessionId || badgeId) {
      // Auto-expand Completed Work
      setCompletedExpanded(true);

      // Find the badge for evidence display
      if (badgeId) {
        const badge = badges.find((b) => b.id === badgeId);
        if (badge) {
          setHighlightBadge(badge);
        }
      }

      // Find the session to highlight
      let targetSession: Session | undefined;
      if (highlightSessionId) {
        targetSession = sessions.find((s) => s.id === highlightSessionId);
      } else if (highlightAssignmentId) {
        // Find most recent session for this assignment
        targetSession = sessions.find((s) => s.lessonId === highlightAssignmentId);
      }

      if (targetSession) {
        setHighlightedSessionId(targetSession.id);

        // Find the subject for this session
        const lessonSubjectMap = new Map<string, string>();
        allLessons.forEach((l) => {
          if (l.subject) lessonSubjectMap.set(l.id, l.subject);
        });
        const subject = lessonSubjectMap.get(targetSession.lessonId) || "Other";

        // Expand the subject
        setExpandedSubjects((prev) => new Set(prev).add(subject));

        // Expand the assignment
        setExpandedAssignments((prev) => new Set(prev).add(targetSession!.lessonId));

        // Expand the session to show answers
        setExpandedSessions((prev) => new Set(prev).add(targetSession!.id));

        // Load prompts for this lesson
        loadLessonPrompts(targetSession.lessonId);

        // Scroll to the session after a brief delay for rendering
        setTimeout(() => {
          const ref = sessionRefs.current.get(targetSession!.id);
          if (ref) {
            ref.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }, 300);
      }

      // Clear URL params after handling (but keep on page for refresh)
      // We don't clear them so refreshing the page works
    }
  }, [loading, sessions, badges, allLessons, searchParams]);

  // Check for uncelebrated badges and show celebration (runs once after data loads)
  useEffect(() => {
    if (loading || celebrationChecked.current) return;
    celebrationChecked.current = true;

    // Find uncelebrated badges (celebratedAt is null/undefined)
    const uncelebratedBadges = badges.filter((b) => !b.celebratedAt);

    if (uncelebratedBadges.length > 0) {
      // Select the most recent badge (highest awardedAt)
      const mostRecentBadge = uncelebratedBadges.reduce((latest, badge) =>
        new Date(badge.awardedAt) > new Date(latest.awardedAt) ? badge : latest
      );

      // Show celebration for this badge
      setCelebrationBadge(mostRecentBadge);

      // Mark badge as celebrated (fire and forget)
      if (studentId) {
        markBadgeCelebrated(studentId, mostRecentBadge.id).catch((err) => {
          console.error("Failed to mark badge as celebrated:", err);
        });

        // Update local state to mark as celebrated
        setBadges((prev) =>
          prev.map((b) =>
            b.id === mostRecentBadge.id
              ? { ...b, celebratedAt: new Date().toISOString() }
              : b
          )
        );
      }
    }
  }, [loading, badges, studentId]);

  // Load lesson prompts for displaying question text
  const loadLessonPrompts = async (lessonId: string) => {
    if (lessonPrompts.has(lessonId) || loadingLessonPrompts.has(lessonId)) return;

    setLoadingLessonPrompts((prev) => new Set(prev).add(lessonId));
    try {
      const lesson = await getLesson(lessonId);
      setLessonPrompts((prev) => new Map(prev).set(lessonId, lesson.prompts));
    } catch (err) {
      console.error("Failed to load lesson prompts:", err);
    } finally {
      setLoadingLessonPrompts((prev) => {
        const next = new Set(prev);
        next.delete(lessonId);
        return next;
      });
    }
  };

  // Toggle session expansion (show/hide "My Answers")
  const toggleSessionExpanded = (sessionId: string, lessonId: string) => {
    setExpandedSessions((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
        // Load prompts when expanding
        loadLessonPrompts(lessonId);
      }
      return next;
    });
  };

  const handleStartLesson = async (lesson: StudentLessonSummary, mode: "voice" | "type") => {
    if (!student) return;

    try {
      const session = await createSession({
        studentId: student.id,
        studentName: student.name,
        lessonId: lesson.id,
        lessonTitle: lesson.title,
      });
      navigate(`/student/${student.id}/lesson/${lesson.id}?session=${session.id}&mode=${mode}`);
    } catch (err) {
      console.error("Failed to start lesson:", err);
    }
  };

  // Get available topics from current lessons and completed sessions, grouped by subject
  const getTopicsBySubject = (): Map<string, { title: string; lessonId?: string }[]> => {
    const subjectMap = new Map<string, { title: string; lessonId?: string }[]>();

    // Add current assignment titles with their subjects
    lessons.forEach((l) => {
      const subject = l.subject || "Other";
      const existing = subjectMap.get(subject) || [];
      // Avoid duplicates
      if (!existing.some((t) => t.title === l.title)) {
        existing.push({ title: l.title, lessonId: l.id });
        subjectMap.set(subject, existing);
      }
    });

    // Add completed session lesson titles
    sessions.forEach((s) => {
      // Look up subject from allLessons
      const lessonInfo = allLessons.find((l) => l.id === s.lessonId);
      const subject = lessonInfo?.subject || "Other";
      const existing = subjectMap.get(subject) || [];
      // Avoid duplicates
      if (!existing.some((t) => t.title === s.lessonTitle)) {
        existing.push({ title: s.lessonTitle, lessonId: s.lessonId });
        subjectMap.set(subject, existing);
      }
    });

    // Sort subjects alphabetically, but put "Other" last
    const sortedMap = new Map<string, { title: string; lessonId?: string }[]>();
    const subjects = Array.from(subjectMap.keys()).sort((a, b) => {
      if (a === "Other") return 1;
      if (b === "Other") return -1;
      return a.localeCompare(b);
    });
    subjects.forEach((subject) => {
      sortedMap.set(subject, subjectMap.get(subject)!);
    });

    return sortedMap;
  };

  // Get flat list of available topics (for backward compatibility)
  const getAvailableTopics = (): string[] => {
    const topics: string[] = [];
    getTopicsBySubject().forEach((items) => {
      items.forEach((item) => {
        if (!topics.includes(item.title)) {
          topics.push(item.title);
        }
      });
    });
    return topics;
  };

  const handleTopicToggle = (topic: string) => {
    setSelectedTopics((prev) =>
      prev.includes(topic)
        ? prev.filter((t) => t !== topic)
        : [...prev, topic]
    );
  };

  const handleStartCoachSession = (mode: SessionMode) => {
    const topicsParam = encodeURIComponent(JSON.stringify(selectedTopics));
    // Get gradeLevel from selected lessons (use first selected topic's grade level)
    const selectedLesson = lessons.find((l) => selectedTopics.includes(l.title));
    const gradeLevel = selectedLesson?.gradeLevel || "";
    navigate(`/student/${studentId}/coach?mode=${mode}&topics=${topicsParam}&gradeLevel=${encodeURIComponent(gradeLevel)}`);
    setShowCoachModal(false);
    setSelectedTopics([]);
  };

  const toggleAssignmentExpanded = (lessonId: string) => {
    setExpandedAssignments((prev) => {
      const next = new Set(prev);
      if (next.has(lessonId)) {
        next.delete(lessonId);
      } else {
        next.add(lessonId);
      }
      return next;
    });
  };

  const toggleSubjectExpanded = (subject: string) => {
    setExpandedSubjects((prev) => {
      const next = new Set(prev);
      if (next.has(subject)) {
        next.delete(subject);
      } else {
        next.add(subject);
      }
      return next;
    });
  };

  const toggleSubjectNotes = (subject: string) => {
    setExpandedSubjectNotes((prev) => {
      const next = new Set(prev);
      if (next.has(subject)) {
        next.delete(subject);
      } else {
        next.add(subject);
      }
      return next;
    });
  };

  // Group sessions by subject with badges and notes
  const getSubjectGroups = (): SubjectGroup[] => {
    // Build a map of lessonId to subject from ALL lessons (not just active assignments)
    const lessonSubjectMap = new Map<string, string>();
    allLessons.forEach((l) => {
      if (l.subject) lessonSubjectMap.set(l.id, l.subject);
    });

    // Group sessions by subject
    const subjectSessionMap = new Map<string, Session[]>();
    sessions.forEach((session) => {
      const subject = lessonSubjectMap.get(session.lessonId) || "Other";
      const existing = subjectSessionMap.get(subject) || [];
      existing.push(session);
      subjectSessionMap.set(subject, existing);
    });

    // Group badges by subject
    const subjectBadgeMap = new Map<string, StudentBadge[]>();
    badges.forEach((badge) => {
      const subject = badge.subject || "Other";
      const existing = subjectBadgeMap.get(subject) || [];
      existing.push(badge);
      subjectBadgeMap.set(subject, existing);
    });

    // Group notes by subject
    const subjectNoteMap = new Map<string, StudentNote[]>();
    notes.forEach((note) => {
      const subject = note.subject || "Other";
      const existing = subjectNoteMap.get(subject) || [];
      existing.push(note);
      subjectNoteMap.set(subject, existing);
    });

    // Build subject groups
    const allSubjects = new Set([
      ...subjectSessionMap.keys(),
      ...subjectBadgeMap.keys(),
      ...subjectNoteMap.keys(),
    ]);

    const groups: SubjectGroup[] = Array.from(allSubjects).map((subject) => {
      const subjectSessions = subjectSessionMap.get(subject) || [];
      // Sort sessions within subject by date (newest first)
      subjectSessions.sort((a, b) => {
        const dateA = new Date(a.completedAt || a.startedAt).getTime();
        const dateB = new Date(b.completedAt || b.startedAt).getTime();
        return dateB - dateA;
      });

      const subjectBadges = (subjectBadgeMap.get(subject) || []).sort(
        (a, b) => new Date(b.awardedAt).getTime() - new Date(a.awardedAt).getTime()
      );

      const subjectNotes = (subjectNoteMap.get(subject) || []).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      const latestCompletedAt = subjectSessions.length > 0
        ? subjectSessions[0].completedAt || subjectSessions[0].startedAt
        : "";

      return {
        subject,
        sessions: subjectSessions,
        badges: subjectBadges,
        notes: subjectNotes,
        latestCompletedAt: typeof latestCompletedAt === "string" ? latestCompletedAt : "",
      };
    });

    // Sort groups by most recent activity (latest completion date), "Other" goes last
    groups.sort((a, b) => {
      if (a.subject === "Other") return 1;
      if (b.subject === "Other") return -1;
      if (!a.latestCompletedAt && !b.latestCompletedAt) return a.subject.localeCompare(b.subject);
      if (!a.latestCompletedAt) return 1;
      if (!b.latestCompletedAt) return -1;
      return new Date(b.latestCompletedAt).getTime() - new Date(a.latestCompletedAt).getTime();
    });

    return groups;
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

  const subjectGroups = getSubjectGroups();

  return (
    <>
      {/* Animations for badge indicators */}
      <style>
        {`
          @keyframes sparkle {
            0%, 100% {
              opacity: 0.3;
              transform: scale(0.8);
            }
            50% {
              opacity: 1;
              transform: scale(1.2);
            }
          }
          @keyframes pulse {
            0%, 100% {
              transform: scale(1);
              box-shadow: 0 2px 4px rgba(0,0,0,0.2);
            }
            50% {
              transform: scale(1.1);
              box-shadow: 0 4px 8px rgba(46,125,50,0.4);
            }
          }
        `}
      </style>

      <div className="container">
        <Link to="/" className="back-btn">
        ← Back
      </Link>

      <div className="header">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1>Hi, {student.name}!</h1>
            <p>{lessons.length > 0 ? "Ready to learn? Pick an assignment below!" : "Welcome back!"}</p>
          </div>
          <button
            className={`btn btn-coach${coachingInvites.length > 0 ? " btn-coach--has-invite" : ""}`}
            onClick={() => setShowCoachModal(true)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "14px 24px",
              fontSize: "1rem",
              position: "relative",
            }}
          >
            <span style={{ fontSize: "1.2rem", opacity: 0.9 }}>💬</span>
            <span style={{ fontWeight: 600 }}>Ask Coach</span>
            {/* Coaching invite badge */}
            {coachingInvites.length > 0 && (
              <span
                style={{
                  position: "absolute",
                  top: "-8px",
                  right: "-8px",
                  background: "linear-gradient(135deg, var(--status-success-text), var(--status-success))",
                  color: "white",
                  borderRadius: "12px",
                  padding: "3px 10px",
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  minWidth: "20px",
                  textAlign: "center",
                  boxShadow: "0 2px 6px rgba(34, 197, 94, 0.3)",
                  animation: "pulse 2s ease-in-out infinite",
                }}
              >
                {coachingInvites.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Ask Coach Modal */}
      {showCoachModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(45, 55, 72, 0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setShowCoachModal(false)}
        >
          <div
            className="card"
            style={{ maxWidth: "480px", width: "90%", maxHeight: "80vh", overflow: "auto", position: "relative", boxShadow: "0 8px 32px rgba(0,0,0,0.12)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={() => {
                setShowCoachModal(false);
                setSelectedTopics([]);
              }}
              style={{
                position: "absolute",
                top: "12px",
                right: "12px",
                background: "none",
                border: "none",
                fontSize: "1.25rem",
                color: "var(--text-muted)",
                cursor: "pointer",
                padding: "4px 8px",
                lineHeight: 1,
              }}
            >
              ×
            </button>
            <h2 style={{ marginTop: 0, marginBottom: "8px", color: "var(--text-primary)", fontWeight: 600 }}>Ask Coach</h2>
            <p style={{ color: "var(--text-secondary)", marginBottom: "20px", fontSize: "0.9rem" }}>
              Select topics you want to explore with your coach.
            </p>

            {/* Teacher Coaching Invitations */}
            {coachingInvites.length > 0 && (
              <div
                style={{
                  marginBottom: "24px",
                  padding: "16px",
                  background: "var(--status-success-bg)",
                  borderRadius: "8px",
                  borderLeft: "3px solid var(--status-success)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                  <h4 style={{ margin: 0, color: "var(--status-success-text)", fontWeight: 600, fontSize: "0.95rem" }}>
                    Special Invitation{coachingInvites.length > 1 ? "s" : ""} from Your Teacher
                  </h4>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {coachingInvites.map((invite) => (
                    <div
                      key={invite.id}
                      style={{
                        background: "white",
                        borderRadius: "6px",
                        padding: "12px",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div style={{ flex: 1 }}>
                          <h5 style={{ margin: "0 0 4px 0", color: "var(--text-primary)", fontWeight: 600, fontSize: "0.9rem" }}>{invite.title}</h5>
                          <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                            {invite.subject}
                            {invite.assignmentTitle && ` • ${invite.assignmentTitle}`}
                          </p>
                          {invite.teacherNote && (
                            <p
                              style={{
                                margin: "8px 0 0 0",
                                padding: "8px 10px",
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
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
                        <button
                          className="btn btn-primary"
                          onClick={() => {
                            navigate(`/student/${studentId}/coach?inviteId=${invite.id}&mode=voice`);
                            setShowCoachModal(false);
                          }}
                          style={{
                            flex: 1,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "6px",
                            padding: "9px",
                            fontSize: "0.85rem",
                            background: "var(--status-success-text)",
                          }}
                        >
                          <span>🎤</span> Start Voice
                        </button>
                        <button
                          className="btn btn-secondary"
                          onClick={() => {
                            navigate(`/student/${studentId}/coach?inviteId=${invite.id}&mode=type`);
                            setShowCoachModal(false);
                          }}
                          style={{
                            flex: 1,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "6px",
                            padding: "10px",
                            fontSize: "0.9rem",
                          }}
                        >
                          <span>⌨️</span> Start Typing
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Divider if there are both invites and regular topics */}
            {coachingInvites.length > 0 && getAvailableTopics().length > 0 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  marginBottom: "16px",
                  color: "var(--text-muted)",
                  fontSize: "0.8rem",
                }}
              >
                <div style={{ flex: 1, height: "1px", background: "var(--border-subtle)" }} />
                <span>or explore on your own</span>
                <div style={{ flex: 1, height: "1px", background: "var(--border-subtle)" }} />
              </div>
            )}

            {/* Topic Selection - Grouped by Subject */}
            <div style={{ marginBottom: "24px" }}>
              <h4 style={{ margin: "0 0 12px 0", color: "var(--text-primary)", fontSize: "0.95rem", fontWeight: 600 }}>Choose Topics</h4>
              {getAvailableTopics().length === 0 ? (
                <p style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
                  No topics available yet. Complete some assignments first!
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  {Array.from(getTopicsBySubject().entries()).map(([subject, topics]) => (
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
                            fontSize: "0.8rem",
                            fontWeight: 600,
                            color: "var(--accent-primary)",
                          }}
                        >
                          {subject}
                        </span>
                        <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                          ({topics.length} {topics.length === 1 ? "topic" : "topics"})
                        </span>
                      </div>
                      {/* Topics in this subject */}
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        {topics.map((topic) => (
                          <label
                            key={topic.title}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "12px",
                              padding: "10px 12px",
                              background: selectedTopics.includes(topic.title) ? "var(--surface-accent-tint)" : "var(--surface-muted)",
                              borderRadius: "6px",
                              cursor: "pointer",
                              border: selectedTopics.includes(topic.title) ? "1.5px solid var(--accent-primary)" : "1.5px solid transparent",
                              marginLeft: "8px",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={selectedTopics.includes(topic.title)}
                              onChange={() => handleTopicToggle(topic.title)}
                              style={{ width: "16px", height: "16px" }}
                            />
                            <span style={{ fontWeight: 500, fontSize: "0.9rem", color: "var(--text-primary)" }}>{topic.title}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Mode Selection Buttons */}
            {selectedTopics.length === 0 && (
              <p style={{ color: "var(--text-muted)", textAlign: "center", marginBottom: "12px", fontSize: "0.85rem" }}>
                Please select at least one topic to start
              </p>
            )}
            <div style={{ display: "flex", gap: "12px" }}>
              <button
                className="btn btn-primary"
                onClick={() => handleStartCoachSession("voice")}
                disabled={selectedTopics.length === 0}
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                  padding: "14px",
                  opacity: selectedTopics.length === 0 ? 0.5 : 1,
                }}
              >
                <span style={{ fontSize: "1.2rem" }}>🎤</span>
                Voice Chat
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => handleStartCoachSession("type")}
                disabled={selectedTopics.length === 0}
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                  padding: "14px",
                  opacity: selectedTopics.length === 0 ? 0.5 : 1,
                }}
              >
                <span style={{ fontSize: "1.2rem" }}>⌨️</span>
                Type Chat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Badge Detail Modal */}
      {selectedBadge && (
        <BadgeDetailModal
          badge={selectedBadge}
          studentId={studentId!}
          onClose={() => setSelectedBadge(null)}
        />
      )}

      {/* Badge Celebration Overlay */}
      {celebrationBadge && (
        <BadgeCelebrationOverlay
          badge={celebrationBadge}
          onViewBadge={() => {
            setSelectedBadge(celebrationBadge);
            setCelebrationBadge(null);
          }}
          onDismiss={() => setCelebrationBadge(null)}
        />
      )}

      {/* Lessons */}
      <h2 style={{ color: "white", marginBottom: "16px" }}>Your Assignments</h2>
      {lessons.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "48px" }}>
          <div style={{ fontSize: "3rem", marginBottom: "16px" }}>📚</div>
          <h3 style={{ margin: 0, marginBottom: "8px" }}>No assignments yet!</h3>
          <p style={{ color: "var(--text-secondary)", margin: 0 }}>
            Your teacher will assign lessons for you to work on.
          </p>
          <p style={{ color: "var(--text-secondary)", margin: 0, marginTop: "8px" }}>
            Check back soon!
          </p>
        </div>
      ) : (
        <div className="lesson-grid">
          {lessons.map((lesson) => (
            <div key={lesson.id} className="card lesson-card" style={{ cursor: "default" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <h3 style={{ margin: 0 }}>{lesson.title}</h3>
                {lesson.attempts > 1 && (
                  <span
                    style={{
                      background: "var(--status-info-bg)",
                      color: "var(--status-info-text)",
                      padding: "4px 8px",
                      borderRadius: "12px",
                      fontSize: "0.75rem",
                      fontWeight: 600,
                    }}
                  >
                    Attempt #{lesson.attempts}
                  </span>
                )}
              </div>
              <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
                {lesson.subject && (
                  <span
                    style={{
                      background: "var(--surface-accent-tint)",
                      color: "var(--accent-primary)",
                      padding: "4px 10px",
                      borderRadius: "12px",
                      fontSize: "0.8rem",
                      fontWeight: 500,
                    }}
                  >
                    {lesson.subject}
                  </span>
                )}
                {lesson.assignedAt && (
                  <span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
                    Assigned {new Date(lesson.assignedAt).toLocaleDateString()}
                  </span>
                )}
              </div>
              <div style={{ display: "flex", gap: "12px" }}>
                <button
                  className="btn btn-primary"
                  onClick={() => handleStartLesson(lesson, "voice")}
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "8px",
                    padding: "12px 16px",
                  }}
                >
                  <span style={{ fontSize: "1.2rem" }}>🎤</span>
                  <span>Voice</span>
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => handleStartLesson(lesson, "type")}
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "8px",
                    padding: "12px 16px",
                  }}
                >
                  <span style={{ fontSize: "1.2rem" }}>⌨️</span>
                  <span>Type</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Completed Work - grouped by subject */}
      {sessions.length > 0 && (
        <>
          <button
            onClick={() => setCompletedExpanded(!completedExpanded)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              background: "none",
              border: "none",
              color: "white",
              cursor: "pointer",
              padding: "0",
              marginTop: "32px",
              marginBottom: "16px",
              fontSize: "1.5rem",
              fontWeight: 600,
            }}
          >
            <span
              style={{
                display: "inline-block",
                transition: "transform 0.2s",
                transform: completedExpanded ? "rotate(90deg)" : "rotate(0deg)",
              }}
            >
              ▶
            </span>
            Completed Work ({sessions.length})
          </button>
          {completedExpanded && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {subjectGroups.map((group) => {
                // Only show subjects with sessions
                if (group.sessions.length === 0) return null;

                const isSubjectExpanded = expandedSubjects.has(group.subject);
                const isNotesExpanded = expandedSubjectNotes.has(group.subject);

                // Group sessions by lessonId within subject
                const sessionsByLesson = new Map<string, Session[]>();
                group.sessions.forEach((session) => {
                  const existing = sessionsByLesson.get(session.lessonId) || [];
                  existing.push(session);
                  sessionsByLesson.set(session.lessonId, existing);
                });

                return (
                  <div key={group.subject} className="card" style={{ padding: 0, overflow: "hidden" }}>
                    {/* Subject Header */}
                    <button
                      onClick={() => toggleSubjectExpanded(group.subject)}
                      style={{
                        width: "100%",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "16px 20px",
                        background: "var(--surface-muted)",
                        border: "none",
                        borderBottom: isSubjectExpanded ? "1px solid var(--border-muted)" : "none",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                          <h3 style={{ margin: 0, color: "var(--text-primary)", fontSize: "1.1rem" }}>
                            {group.subject}
                          </h3>
                          {/* Badge chips */}
                          {group.badges.length > 0 && (
                            <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                              {group.badges.slice(0, 3).map((badge) => {
                                const isNew = !badge.celebratedAt;
                                return (
                                  <button
                                    key={badge.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedBadge(badge);
                                      // Mark as celebrated when viewed
                                      if (isNew && studentId) {
                                        markBadgeCelebrated(studentId, badge.id).catch(console.error);
                                        setBadges((prev) =>
                                          prev.map((b) =>
                                            b.id === badge.id
                                              ? { ...b, celebratedAt: new Date().toISOString() }
                                              : b
                                          )
                                        );
                                      }
                                    }}
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: "4px",
                                      padding: "2px 8px",
                                      background: isNew ? "var(--status-warning-bg)" : "var(--status-warning-bg)",
                                      border: isNew ? "2px solid var(--status-warning)" : "1px solid var(--status-warning)",
                                      borderRadius: "12px",
                                      fontSize: "0.75rem",
                                      cursor: "pointer",
                                      color: "var(--status-warning-text)",
                                      position: "relative",
                                    }}
                                    title={badge.badgeTypeName}
                                  >
                                    {/* New badge sparkle indicator */}
                                    {isNew && (
                                      <span
                                        style={{
                                          position: "absolute",
                                          top: "-4px",
                                          right: "-4px",
                                          fontSize: "0.6rem",
                                          animation: "sparkle 1s ease-in-out infinite",
                                        }}
                                      >
                                        ✨
                                      </span>
                                    )}
                                    <span>{BADGE_DISPLAY[badge.badgeType]?.icon || "🌟"}</span>
                                    <span>{BADGE_DISPLAY[badge.badgeType]?.name || badge.badgeTypeName}</span>
                                  </button>
                                );
                              })}
                              {group.badges.length > 3 && (
                                <span
                                  style={{
                                    padding: "2px 8px",
                                    background: "var(--surface-accent)",
                                    borderRadius: "12px",
                                    fontSize: "0.75rem",
                                    color: "var(--text-secondary)",
                                  }}
                                >
                                  +{group.badges.length - 3} more
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                        <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", margin: "4px 0 0 0" }}>
                          {group.sessions.length} {group.sessions.length === 1 ? "assignment" : "assignments"} completed
                        </p>
                      </div>
                      <span
                        style={{
                          color: "var(--text-muted)",
                          fontSize: "0.9rem",
                          transition: "transform 0.2s",
                          transform: isSubjectExpanded ? "rotate(90deg)" : "rotate(0deg)",
                        }}
                      >
                        ▶
                      </span>
                    </button>

                    {/* Subject Content */}
                    {isSubjectExpanded && (
                      <div style={{ padding: "16px 20px" }}>
                        {/* Teacher Notes Section */}
                        {group.notes.length > 0 && (
                          <div style={{ marginBottom: "16px" }}>
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                                marginBottom: "8px",
                              }}
                            >
                              <span style={{ fontSize: "1rem" }}>📝</span>
                              <h4 style={{ margin: 0, color: "var(--text-primary)", fontSize: "0.95rem" }}>
                                Teacher Notes
                              </h4>
                            </div>
                            {/* Show most recent note(s) */}
                            {group.notes.slice(0, isNotesExpanded ? undefined : 2).map((note) => (
                              <div
                                key={note.id}
                                style={{
                                  padding: "10px 12px",
                                  background: "var(--status-success-bg)",
                                  borderRadius: "8px",
                                  borderLeft: "3px solid var(--status-success)",
                                  marginBottom: "8px",
                                }}
                              >
                                <p style={{ margin: 0, color: "var(--text-primary)", fontSize: "0.9rem" }}>
                                  {note.noteText}
                                </p>
                                <p style={{ margin: "4px 0 0 0", color: "var(--text-muted)", fontSize: "0.8rem" }}>
                                  {note.assignmentTitle && `On ${note.assignmentTitle}`}
                                  {note.attemptNumber && ` (Attempt ${note.attemptNumber})`}
                                  {" • "}
                                  {new Date(note.createdAt).toLocaleDateString()}
                                </p>
                              </div>
                            ))}
                            {group.notes.length > 2 && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleSubjectNotes(group.subject);
                                }}
                                style={{
                                  background: "none",
                                  border: "none",
                                  color: "var(--accent-primary)",
                                  cursor: "pointer",
                                  fontSize: "0.85rem",
                                  padding: "4px 0",
                                }}
                              >
                                {isNotesExpanded
                                  ? "Show less"
                                  : `View all ${group.notes.length} notes`}
                              </button>
                            )}
                          </div>
                        )}

                        {/* Assignments in this subject */}
                        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                          {Array.from(sessionsByLesson.entries()).map(([lessonId, lessonSessions]) => {
                            const latestSession = lessonSessions[0];
                            const totalAttempts = lessonSessions.length;
                            const isExpanded = expandedAssignments.has(lessonId);

                            return (
                              <div
                                key={lessonId}
                                style={{
                                  border: "1px solid var(--border-muted)",
                                  borderRadius: "8px",
                                  overflow: "hidden",
                                }}
                              >
                                {/* Assignment header */}
                                <button
                                  onClick={() => toggleAssignmentExpanded(lessonId)}
                                  style={{
                                    width: "100%",
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    padding: "12px 16px",
                                    background: "var(--surface-card)",
                                    border: "none",
                                    cursor: "pointer",
                                    textAlign: "left",
                                  }}
                                >
                                  <div style={{ flex: 1 }}>
                                    <h4 style={{ margin: 0, color: "var(--accent-primary)", fontSize: "0.95rem" }}>
                                      {latestSession.lessonTitle}
                                    </h4>
                                    <p style={{ color: "var(--text-secondary)", fontSize: "0.8rem", margin: "2px 0 0 0" }}>
                                      {totalAttempts > 1
                                        ? `${totalAttempts} attempts • Last completed ${new Date(latestSession.completedAt || latestSession.startedAt).toLocaleDateString()}`
                                        : `Completed ${new Date(latestSession.completedAt || latestSession.startedAt).toLocaleDateString()}`}
                                    </p>
                                  </div>
                                  <span
                                    style={{
                                      color: "var(--text-muted)",
                                      fontSize: "0.8rem",
                                      transition: "transform 0.2s",
                                      transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                                    }}
                                  >
                                    ▶
                                  </span>
                                </button>

                                {/* Assignment attempts (expanded) */}
                                {isExpanded && (
                                  <div style={{ padding: "0 16px 12px 16px", display: "flex", flexDirection: "column", gap: "8px" }}>
                                    {lessonSessions.map((session, index) => {
                                      const attemptNumber = totalAttempts - index;
                                      const hasNotes = !!session.educatorNotes;
                                      const isHighlighted = session.id === highlightedSessionId;
                                      const isSessionExpanded = expandedSessions.has(session.id);
                                      const prompts = lessonPrompts.get(session.lessonId) || [];
                                      const isLoadingPrompts = loadingLessonPrompts.has(session.lessonId);

                                      return (
                                        <div
                                          key={session.id}
                                          ref={(el) => {
                                            if (el) sessionRefs.current.set(session.id, el);
                                          }}
                                          style={{
                                            padding: "12px",
                                            background: isHighlighted ? "var(--status-warning-bg)" : (hasNotes ? "var(--status-success-bg)" : "var(--surface-muted)"),
                                            borderRadius: "8px",
                                            borderLeft: isHighlighted ? "4px solid var(--status-warning)" : (hasNotes ? "4px solid var(--status-success)" : "4px solid var(--border-muted)"),
                                            boxShadow: isHighlighted ? "0 2px 8px rgba(255,193,7,0.3)" : "none",
                                          }}
                                        >
                                          {/* Badge Evidence Callout (only shown when navigated from badge) */}
                                          {isHighlighted && highlightBadge && (
                                            <div
                                              style={{
                                                background: "linear-gradient(135deg, var(--status-warning-bg), var(--status-warning))",
                                                borderRadius: "8px",
                                                padding: "12px",
                                                marginBottom: "12px",
                                                border: "1px solid var(--status-warning)",
                                              }}
                                            >
                                              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                                                <span style={{ fontSize: "1.2rem" }}>🏅</span>
                                                <h4 style={{ margin: 0, color: "var(--status-warning-text)", fontSize: "0.95rem" }}>
                                                  Badge Evidence
                                                </h4>
                                              </div>
                                              <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "0.9rem" }}>
                                                This work is linked to your{" "}
                                                <strong>{BADGE_DISPLAY[highlightBadge.badgeType]?.name || highlightBadge.badgeTypeName}</strong>
                                                {highlightBadge.subject && ` in ${highlightBadge.subject}`}.
                                              </p>
                                              {highlightBadge.reason && (
                                                <p style={{ margin: "8px 0 0 0", color: "var(--text-secondary)", fontSize: "0.85rem", fontStyle: "italic" }}>
                                                  "{highlightBadge.reason}"
                                                </p>
                                              )}
                                              {highlightBadge.evidence && (
                                                <ul style={{ margin: "8px 0 0 0", paddingLeft: "20px", color: "var(--text-secondary)", fontSize: "0.85rem" }}>
                                                  {highlightBadge.evidence.previousScore !== undefined && highlightBadge.evidence.currentScore !== undefined && (
                                                    <li>Improved from {Math.round(highlightBadge.evidence.previousScore)}% to {Math.round(highlightBadge.evidence.currentScore)}%</li>
                                                  )}
                                                  {highlightBadge.evidence.subjectAverageScore !== undefined && (
                                                    <li>Average {Math.round(highlightBadge.evidence.subjectAverageScore)}%{highlightBadge.evidence.subjectAssignmentCount && ` across ${highlightBadge.evidence.subjectAssignmentCount} lessons`}</li>
                                                  )}
                                                </ul>
                                              )}
                                            </div>
                                          )}

                                          {/* Attempt header */}
                                          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                                            {totalAttempts > 1 && (
                                              <span
                                                style={{
                                                  fontSize: "0.7rem",
                                                  fontWeight: 600,
                                                  color: "var(--accent-primary)",
                                                  background: "var(--surface-accent-tint)",
                                                  padding: "2px 6px",
                                                  borderRadius: "4px",
                                                }}
                                              >
                                                Attempt {attemptNumber}
                                              </span>
                                            )}
                                            <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                                              {new Date(session.completedAt || session.startedAt).toLocaleDateString()}
                                            </span>
                                            {session.submission?.responses?.[0]?.inputSource && (
                                              <span
                                                style={{
                                                  fontSize: "0.7rem",
                                                  color: "var(--text-secondary)",
                                                  background: "var(--border-subtle)",
                                                  padding: "2px 6px",
                                                  borderRadius: "4px",
                                                }}
                                              >
                                                {session.submission.responses[0].inputSource === "voice" ? "🎤 Voice" : "⌨️ Typed"}
                                              </span>
                                            )}
                                            <span style={{ fontSize: "0.75rem", marginLeft: "auto" }}>
                                              {hasNotes ? "📝" : "⏳"}
                                            </span>
                                          </div>

                                          {/* Teacher feedback */}
                                          <div style={{ marginBottom: "8px" }}>
                                            <p
                                              style={{
                                                margin: 0,
                                                fontSize: "0.85rem",
                                                color: hasNotes ? "var(--text-primary)" : "var(--text-muted)",
                                                fontStyle: hasNotes ? "normal" : "italic",
                                              }}
                                            >
                                              <strong style={{ color: "var(--status-success)" }}>Teacher feedback:</strong>{" "}
                                              {session.educatorNotes || "Not reviewed yet"}
                                            </p>
                                          </div>

                                          {/* "See my answers" toggle */}
                                          <button
                                            onClick={() => toggleSessionExpanded(session.id, session.lessonId)}
                                            style={{
                                              background: "none",
                                              border: "none",
                                              color: "var(--accent-primary)",
                                              cursor: "pointer",
                                              fontSize: "0.85rem",
                                              padding: "4px 0",
                                              display: "flex",
                                              alignItems: "center",
                                              gap: "4px",
                                            }}
                                          >
                                            <span
                                              style={{
                                                display: "inline-block",
                                                transition: "transform 0.2s",
                                                transform: isSessionExpanded ? "rotate(90deg)" : "rotate(0deg)",
                                                fontSize: "0.7rem",
                                              }}
                                            >
                                              ▶
                                            </span>
                                            {isSessionExpanded ? "Hide my answers" : "See my answers"}
                                          </button>

                                          {/* My Answers Section */}
                                          {isSessionExpanded && (
                                            <div
                                              style={{
                                                marginTop: "12px",
                                                paddingTop: "12px",
                                                borderTop: "1px solid var(--border-subtle)",
                                              }}
                                            >
                                              <h5
                                                style={{
                                                  margin: "0 0 12px 0",
                                                  color: "var(--text-primary)",
                                                  fontSize: "0.9rem",
                                                  display: "flex",
                                                  alignItems: "center",
                                                  gap: "6px",
                                                }}
                                              >
                                                <span>✏️</span> My Answers
                                              </h5>

                                              {isLoadingPrompts ? (
                                                <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", fontStyle: "italic" }}>
                                                  Loading your answers...
                                                </p>
                                              ) : session.submission?.responses?.length > 0 ? (
                                                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                                                  {session.submission.responses.map((response, respIndex) => {
                                                    const prompt = prompts.find((p) => p.id === response.promptId);
                                                    const questionText = prompt?.input || `Question ${respIndex + 1}`;

                                                    return (
                                                      <div
                                                        key={response.promptId}
                                                        style={{
                                                          background: "var(--surface-card)",
                                                          borderRadius: "6px",
                                                          padding: "10px",
                                                          border: "1px solid var(--border-subtle)",
                                                        }}
                                                      >
                                                        {/* Question */}
                                                        <p
                                                          style={{
                                                            margin: "0 0 8px 0",
                                                            color: "var(--text-secondary)",
                                                            fontSize: "0.85rem",
                                                            fontWeight: 500,
                                                          }}
                                                        >
                                                          {questionText}
                                                        </p>

                                                        {/* Response */}
                                                        <div
                                                          style={{
                                                            background: "var(--status-info-bg)",
                                                            borderRadius: "4px",
                                                            padding: "8px",
                                                            borderLeft: "3px solid var(--accent-primary)",
                                                          }}
                                                        >
                                                          {response.inputSource === "voice" ? (
                                                            response.response ? (
                                                              <p style={{ margin: 0, color: "var(--text-primary)", fontSize: "0.85rem" }}>
                                                                <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>🎤</span>{" "}
                                                                {response.response}
                                                              </p>
                                                            ) : (
                                                              <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.85rem", fontStyle: "italic" }}>
                                                                <span>🎤</span> Voice response recorded
                                                              </p>
                                                            )
                                                          ) : (
                                                            <p style={{ margin: 0, color: "var(--text-primary)", fontSize: "0.85rem" }}>
                                                              {response.response || <em style={{ color: "var(--text-muted)" }}>No response recorded</em>}
                                                            </p>
                                                          )}
                                                        </div>

                                                        {/* Hint indicator */}
                                                        {response.hintUsed && (
                                                          <p style={{ margin: "6px 0 0 0", color: "var(--text-muted)", fontSize: "0.75rem" }}>
                                                            💡 Used a hint
                                                          </p>
                                                        )}
                                                      </div>
                                                    );
                                                  })}
                                                </div>
                                              ) : (
                                                <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", fontStyle: "italic" }}>
                                                  No responses recorded for this attempt.
                                                </p>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
    </>
  );
}
