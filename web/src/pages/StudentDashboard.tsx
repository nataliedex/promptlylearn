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
  getStudentAssignments,
  type Student,
  type StudentLessonSummary,
  type Session,
  type StudentBadge,
  type StudentNote,
  type LessonSummary,
  type Prompt,
  type CoachingInvite,
  type StudentAssignmentRecord,
  type ReviewState,
} from "../services/api";
import BadgeDetailModal from "../components/BadgeDetailModal";
import BadgeCelebrationOverlay from "../components/BadgeCelebrationOverlay";
import AskCoachDrawer from "../components/AskCoachDrawer";
import AskCoachTopicDrawer from "../components/AskCoachTopicDrawer";
import StudentProfileView from "../components/StudentProfileView";
import Header from "../components/Header";

type SessionMode = "video" | "type";

/**
 * DESIGN RULE: No emojis in UI.
 * Use clean text labels and subtle visual indicators (colors, borders) instead.
 * This applies to all student-facing and educator-facing views.
 */

// Badge display names (no emoji icons - use colored indicators instead)
const BADGE_DISPLAY: Record<string, { name: string; color: string }> = {
  progress_star: { name: "Progress Star", color: "#ffc107" },
  mastery_badge: { name: "Mastery Badge", color: "#ff9800" },
  effort_award: { name: "Effort Award", color: "#4caf50" },
  helper_badge: { name: "Helper Badge", color: "#2196f3" },
  persistence: { name: "Focus Badge", color: "#9c27b0" },
  curiosity: { name: "Curiosity Award", color: "#00bcd4" },
  custom: { name: "Special Badge", color: "#e91e63" },
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
  const [pausedSessions, setPausedSessions] = useState<Session[]>([]); // Paused lessons for resume
  const [badges, setBadges] = useState<StudentBadge[]>([]);
  const [notes, setNotes] = useState<StudentNote[]>([]);
  const [coachingInvites, setCoachingInvites] = useState<CoachingInvite[]>([]);
  const [studentAssignments, setStudentAssignments] = useState<StudentAssignmentRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Ask Coach topic drawer state
  const [showCoachTopicDrawer, setShowCoachTopicDrawer] = useState(false);

  // Ask Coach drawer state
  const [showCoachDrawer, setShowCoachDrawer] = useState(false);
  const [drawerInviteId, setDrawerInviteId] = useState<string | undefined>();
  const [drawerMode, setDrawerMode] = useState<SessionMode>("type");
  const [drawerTopics, setDrawerTopics] = useState<string[]>([]);
  const [drawerGradeLevel, setDrawerGradeLevel] = useState<string | undefined>();

  // Completed Work section collapsed state
  const [completedExpanded, setCompletedExpanded] = useState(false);
  // Track which individual assignments are expanded (by lessonId)
  const [expandedAssignments, setExpandedAssignments] = useState<Set<string>>(new Set());
  // Track which subjects are expanded
  const [expandedSubjects, setExpandedSubjects] = useState<Set<string>>(new Set());
  // Track badge tooltip/modal state
  const [selectedBadge, setSelectedBadge] = useState<StudentBadge | null>(null);

  // Student profile view state
  const [showProfileView, setShowProfileView] = useState(false);

  // Lesson prompts cache for displaying student responses
  const [lessonPrompts, setLessonPrompts] = useState<Map<string, Prompt[]>>(new Map());
  const [loadingLessonPrompts, setLoadingLessonPrompts] = useState<Set<string>>(new Set());

  // Track which sessions are expanded to show "My Answers"
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());
  // Track which video transcripts are expanded (key: `${sessionId}-${promptId}`)
  const [expandedTranscripts, setExpandedTranscripts] = useState<Set<string>>(new Set());

  // Badge navigation highlighting
  const [searchParams] = useSearchParams();
  const [highlightedSessionId, setHighlightedSessionId] = useState<string | null>(null);
  const [highlightBadge, setHighlightBadge] = useState<StudentBadge | null>(null);

  // Badge celebration state
  const [celebrationBadge, setCelebrationBadge] = useState<StudentBadge | null>(null);
  const celebrationChecked = useRef(false); // Prevent multiple celebration checks per mount

  // Just-completed lesson animation state
  const [justCompletedLesson, setJustCompletedLesson] = useState<StudentLessonSummary | null>(null);
  const [completionAnimationPhase, setCompletionAnimationPhase] = useState<"success" | "animating-out" | null>(null);
  // Track which lesson ID to hide from the active list during/after animation
  const [hiddenLessonId, setHiddenLessonId] = useState<string | null>(null);

  // Single ref to track if completion animation has been triggered this session (prevents ALL retriggering)
  const completionAnimationTriggered = useRef(false);

  // Refs for completion animation timers (stored here so they survive effect re-runs)
  const animationTimerRefs = useRef<{ animateOut: NodeJS.Timeout | null; remove: NodeJS.Timeout | null }>({
    animateOut: null,
    remove: null,
  });

  // Check for prefers-reduced-motion
  const prefersReducedMotion = useRef(
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );

  // Refs for scrolling
  const sessionRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    if (!studentId) return;

    async function loadData() {
      try {
        const [studentData, studentLessonsData, sessionsData, pausedSessionsData, badgesData, notesData, allLessonsData, invitesData, assignmentsData] = await Promise.all([
          getStudent(studentId!),
          getStudentLessons(studentId!),
          getSessions(studentId, "completed", "student"), // PRIVACY: Use student audience for filtered data
          getSessions(studentId, "paused", "student").catch(() => [] as Session[]), // Fetch paused sessions for resume
          getStudentBadges(studentId!).catch(() => ({ badges: [] as StudentBadge[], count: 0, studentId: "", studentName: "" })),
          getStudentNotes(studentId!).catch(() => ({ notes: [] as StudentNote[], count: 0, studentId: "", studentName: "" })),
          getLessons().catch(() => [] as LessonSummary[]), // Fetch all lessons for subject lookup
          getStudentCoachingInvites(studentId!, "pending").catch(() => ({ invites: [] as CoachingInvite[], counts: { pending: 0, started: 0, completed: 0, dismissed: 0, total: 0 } })),
          getStudentAssignments(studentId!).catch(() => ({ studentId: "", studentName: "", assignments: [] as StudentAssignmentRecord[], count: 0 })),
        ]);
        setStudent(studentData);
        setAllLessons(allLessonsData);
        setPausedSessions(pausedSessionsData);

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
        setStudentAssignments(assignmentsData.assignments);
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

  // Function to run the completion animation - called once and handles entire timer chain
  const runCompletionAnimation = (justCompletedId: string, lessonInfo: LessonSummary) => {
    // Clear the URL param IMMEDIATELY (replace, don't push to history)
    const currentParams = new URLSearchParams(window.location.search);
    currentParams.delete("justCompleted");
    window.history.replaceState({}, "", `${window.location.pathname}${currentParams.toString() ? `?${currentParams.toString()}` : ""}`);

    // IMMEDIATELY hide the lesson from the active list (prevents duplicate display)
    setHiddenLessonId(justCompletedId);

    // Create a synthetic StudentLessonSummary for display
    const syntheticLesson: StudentLessonSummary = {
      id: lessonInfo.id,
      title: lessonInfo.title,
      subject: lessonInfo.subject || undefined,
      promptCount: lessonInfo.promptCount,
      attempts: 1,
      className: undefined,
      assignedAt: undefined,
      dueDate: undefined,
    };

    // If user prefers reduced motion, skip animation and just expand completed section
    if (prefersReducedMotion.current) {
      setLessons((prev) => prev.filter((l) => l.id !== justCompletedId));
      setCompletedExpanded(true);
      setHiddenLessonId(null);
      return;
    }

    // Start the animation sequence
    setJustCompletedLesson(syntheticLesson);
    setCompletionAnimationPhase("success");

    // Store timers in refs so they survive effect re-runs
    animationTimerRefs.current.animateOut = setTimeout(() => {
      setCompletionAnimationPhase("animating-out");
      setCompletedExpanded(true);
    }, 700);

    animationTimerRefs.current.remove = setTimeout(() => {
      setJustCompletedLesson(null);
      setCompletionAnimationPhase(null);
      setLessons((prev) => prev.filter((l) => l.id !== justCompletedId));
      setHiddenLessonId(null);
    }, 1200);
  };

  // Detect completion and trigger animation (effect only detects, doesn't manage timers)
  useEffect(() => {
    if (loading) return;

    const justCompletedId = searchParams.get("justCompleted");
    if (!justCompletedId) return;

    // CRITICAL: Only trigger animation ONCE per page load
    if (completionAnimationTriggered.current) return;
    completionAnimationTriggered.current = true;

    // Find the lesson in allLessons to get its info
    const lessonInfo = allLessons.find((l) => l.id === justCompletedId);
    if (!lessonInfo) {
      completionAnimationTriggered.current = false;
      return;
    }

    // Run the animation (this handles the entire timer chain independently)
    runCompletionAnimation(justCompletedId, lessonInfo);

    // NO cleanup here - timers are managed by refs and cleaned up only on unmount
  }, [loading, allLessons, searchParams]);

  // Cleanup timers only on component unmount
  useEffect(() => {
    return () => {
      if (animationTimerRefs.current.animateOut) {
        clearTimeout(animationTimerRefs.current.animateOut);
      }
      if (animationTimerRefs.current.remove) {
        clearTimeout(animationTimerRefs.current.remove);
      }
    };
  }, []);

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

  const handleStartLesson = async (lesson: StudentLessonSummary, mode: "video" | "type") => {
    if (!student) return;

    try {
      // Check if there's a paused session for this lesson
      const existingPausedSession = pausedSessions.find((s) => s.lessonId === lesson.id);

      if (existingPausedSession) {
        // Resume the paused session
        navigate(`/student/${student.id}/lesson/${lesson.id}?session=${existingPausedSession.id}&mode=${mode}`);
      } else {
        // Create a new session
        const session = await createSession({
          studentId: student.id,
          studentName: student.preferredName || student.name,
          lessonId: lesson.id,
          lessonTitle: lesson.title,
        });
        navigate(`/student/${student.id}/lesson/${lesson.id}?session=${session.id}&mode=${mode}`);
      }
    } catch (err) {
      console.error("Failed to start lesson:", err);
    }
  };

  // Check if a lesson has a paused session
  const hasPausedSession = (lessonId: string): boolean => {
    return pausedSessions.some((s) => s.lessonId === lessonId);
  };

  // Get the paused session for a lesson
  const getPausedSession = (lessonId: string): Session | undefined => {
    return pausedSessions.find((s) => s.lessonId === lessonId);
  };

  // Callback from AskCoachTopicDrawer when starting a session with selected topics
  const handleStartCoachSession = (topics: string[], mode: SessionMode, gradeLevel: string) => {
    setDrawerMode(mode);
    setDrawerTopics(topics);
    setDrawerGradeLevel(gradeLevel);
    setDrawerInviteId(undefined);
    setShowCoachDrawer(true);
    setShowCoachTopicDrawer(false);
  };

  // Open drawer for a coaching invite (from topic drawer)
  const handleOpenCoachInvite = (inviteId: string, mode: SessionMode) => {
    setDrawerMode(mode);
    setDrawerInviteId(inviteId);
    setDrawerTopics([]);
    setDrawerGradeLevel(undefined);
    setShowCoachDrawer(true);
    setShowCoachTopicDrawer(false);
  };

  // Callback from AskCoachDrawer to change topics - closes coach drawer, opens topic drawer
  const handleChangeTopics = () => {
    setShowCoachDrawer(false);
    setDrawerInviteId(undefined);
    setDrawerTopics([]);
    setDrawerGradeLevel(undefined);
    setShowCoachTopicDrawer(true);
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

  // Toggle transcript expansion for video conversations
  const toggleTranscriptExpanded = (sessionId: string, promptId: string) => {
    const key = `${sessionId}-${promptId}`;
    setExpandedTranscripts((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
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

  // Build a map of lessonId -> reviewState for quick lookup
  const reviewStateByLesson = new Map<string, ReviewState>();
  studentAssignments.forEach((a) => {
    reviewStateByLesson.set(a.lessonId, a.reviewState);
  });

  /**
   * Get the feedback status display for a session.
   * Returns { label, hasNote, isReviewed } based on reviewState and educatorNotes.
   * - Not reviewed: subtle gray, "Not reviewed yet"
   * - Reviewed without note: subtle gray, "Reviewed · No note"
   * - Reviewed with note: colored (green), "Reviewed · Note from teacher"
   */
  const getFeedbackStatus = (session: Session): { label: string; hasNote: boolean; isReviewed: boolean } => {
    const reviewState = reviewStateByLesson.get(session.lessonId);
    const hasNote = !!session.educatorNotes;

    // Check if teacher has reviewed (reviewState is not pending_review or not_started)
    const isReviewed = reviewState && reviewState !== "pending_review" && reviewState !== "not_started";

    if (!isReviewed) {
      return { label: "Not reviewed yet", hasNote: false, isReviewed: false };
    }

    if (hasNote) {
      return { label: "Reviewed · Note from teacher", hasNote: true, isReviewed: true };
    }

    return { label: "Reviewed · No note", hasNote: false, isReviewed: true };
  };

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
          @keyframes badgePulse {
            0%, 100% {
              transform: scale(1);
              box-shadow: 0 2px 4px rgba(0,0,0,0.2);
            }
            50% {
              transform: scale(1.1);
              box-shadow: 0 4px 8px rgba(46,125,50,0.4);
            }
          }
          /* Slide-down animation for transitioning completed card to Completed Work section */
          @keyframes slideDownFade {
            0% {
              opacity: 1;
              transform: translateY(0) scale(1);
            }
            100% {
              opacity: 0;
              transform: translateY(80px) scale(0.95);
            }
          }
          .lesson-card-completing {
            animation: slideDownFade 0.5s ease-out forwards;
          }
          /* Success state is static - no animation, just styling */
          .lesson-card-completed-success {
            box-shadow: 0 4px 16px rgba(34, 197, 94, 0.3);
          }
          @media (prefers-reduced-motion: reduce) {
            .lesson-card-completing {
              animation: none;
              opacity: 0;
            }
          }
        `}
      </style>

      <div className="container">
        <Header
          mode="dashboard"
          userType="student"
          userName={student.preferredName || student.name}
          homeLink="/"
          title={`Welcome, ${student.preferredName || student.name}!`}
        />

      <div className="header" style={{ position: "relative" }}>
        {/* Ask Coach button - positioned top-right as utility action */}
        <button
          className={`btn btn-coach${coachingInvites.length > 0 ? " btn-coach--has-invite" : ""}`}
          onClick={() => setShowCoachTopicDrawer(true)}
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "14px 24px",
            fontSize: "1rem",
          }}
        >
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
                animation: "badgePulse 2s ease-in-out infinite",
              }}
            >
              {coachingInvites.length}
            </span>
          )}
        </button>

        {/* Centered greeting hero */}
        <div
          style={{
            textAlign: "center",
            paddingTop: "8px",
            paddingBottom: "8px",
          }}
        >
          <h1
            onClick={() => setShowProfileView(true)}
            style={{
              cursor: "pointer",
              transition: "opacity 0.15s",
              marginBottom: "6px",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.8"; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
            title="View your profile"
          >
            Hi, {student.preferredName || student.name}!
          </h1>
          <p
            style={{
              margin: 0,
              color: "rgba(255, 255, 255, 0.9)",
              fontSize: "1.05rem",
              fontWeight: 400,
              letterSpacing: "0.01em",
            }}
          >
            {lessons.length > 0 ? "Ready to learn? Pick an assignment below!" : "Welcome back!"}
          </p>
        </div>
      </div>

      {/* Ask Coach Topic Drawer (Step 1: Topic selection) */}
      <AskCoachTopicDrawer
        isOpen={showCoachTopicDrawer}
        onClose={() => setShowCoachTopicDrawer(false)}
        studentId={studentId!}
        lessons={lessons}
        completedSessions={sessions}
        coachingInvites={coachingInvites}
        onStartInvite={handleOpenCoachInvite}
        onStartSession={handleStartCoachSession}
      />

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

      {/* Student Profile View */}
      <StudentProfileView
        isOpen={showProfileView}
        onClose={() => setShowProfileView(false)}
        studentId={studentId!}
        studentFullName={student.name}
        studentCode={student.studentCode}
      />

      {/* Lessons */}
      <h2 style={{ color: "white", marginBottom: "16px" }}>Your Assignments</h2>
      {lessons.length === 0 && !justCompletedLesson ? (
        <div className="card" style={{ textAlign: "center", padding: "48px" }}>
          <h3 style={{ margin: 0, marginBottom: "8px" }}>No assignments yet</h3>
          <p style={{ color: "var(--text-secondary)", margin: 0 }}>
            Your teacher will assign lessons for you to work on.
          </p>
          <p style={{ color: "var(--text-secondary)", margin: 0, marginTop: "8px" }}>
            Check back soon!
          </p>
        </div>
      ) : (
        <div className="lesson-grid">
          {/* Just-completed lesson with success animation */}
          {justCompletedLesson && (
            <div
              key={`completed-${justCompletedLesson.id}`}
              className={`card lesson-card ${
                completionAnimationPhase === "animating-out"
                  ? "lesson-card-completing"
                  : completionAnimationPhase === "success"
                    ? "lesson-card-completed-success"
                    : ""
              }`}
              style={{
                cursor: "default",
                border: "2px solid var(--status-success)",
                background: "linear-gradient(135deg, var(--status-success-bg) 0%, var(--surface-card) 100%)",
                position: "relative",
                overflow: "hidden",
              }}
            >
              {/* Success checkmark overlay */}
              <div
                style={{
                  position: "absolute",
                  top: "12px",
                  right: "12px",
                  width: "32px",
                  height: "32px",
                  borderRadius: "50%",
                  background: "var(--status-success)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 2px 8px rgba(34, 197, 94, 0.4)",
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>

              {/* Title row */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "6px", paddingRight: "44px" }}>
                <h3 style={{ margin: 0, color: "var(--text-primary)", fontSize: "1.15rem", fontWeight: 600, lineHeight: 1.3 }}>
                  {justCompletedLesson.title}
                </h3>
              </div>

              {/* Subject */}
              {justCompletedLesson.subject && (
                <div style={{ marginBottom: "12px" }}>
                  <p style={{ margin: 0, color: "var(--accent-primary)", fontSize: "0.8rem", fontWeight: 500 }}>
                    {justCompletedLesson.subject}
                  </p>
                </div>
              )}

              {/* Completed message */}
              <div
                style={{
                  padding: "12px 16px",
                  background: "var(--status-success-bg)",
                  borderRadius: "8px",
                  borderLeft: "3px solid var(--status-success)",
                }}
              >
                <p style={{ margin: 0, color: "var(--status-success-text)", fontWeight: 600, fontSize: "0.95rem" }}>
                  Completed!
                </p>
                <p style={{ margin: "4px 0 0 0", color: "var(--text-secondary)", fontSize: "0.85rem" }}>
                  Your work has been saved.
                </p>
              </div>
            </div>
          )}

          {lessons
            .filter((lesson) => lesson.id !== hiddenLessonId) // Exclude lesson being animated out
            .map((lesson) => {
            // Estimate time based on question count
            const questionCount = lesson.promptCount || 0;
            const estimatedTime =
              questionCount <= 3 ? "About 5 minutes" :
              questionCount <= 5 ? "About 10 minutes" :
              "About 15 minutes";

            // Compute status banner content
            const isPaused = hasPausedSession(lesson.id);
            const pausedSession = isPaused ? getPausedSession(lesson.id) : null;
            const progress = pausedSession?.currentPromptIndex || 0;

            let dueDateInfo: { isPastDue: boolean; formattedDate: string } | null = null;
            if (lesson.dueDate) {
              const dueDate = new Date(lesson.dueDate + "T23:59:59");
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              dueDateInfo = {
                isPastDue: dueDate < today,
                formattedDate: new Date(lesson.dueDate).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                }),
              };
            }

            return (
              <div key={lesson.id} className="card lesson-card" style={{ cursor: "default" }}>
                {/* === HEADER SECTION === */}
                <div>
                  {/* Title row with attempt/resume badge */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "6px" }}>
                    <h3 style={{ margin: 0, color: "var(--text-primary)", fontSize: "1.15rem", fontWeight: 600, lineHeight: 1.3 }}>
                      {lesson.title}
                    </h3>
                    <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                      {isPaused && (
                        <span
                          style={{
                            background: "var(--status-warning-bg)",
                            color: "var(--status-warning-text)",
                            padding: "3px 8px",
                            borderRadius: "10px",
                            fontSize: "0.7rem",
                            fontWeight: 600,
                            whiteSpace: "nowrap",
                          }}
                        >
                          Resume
                        </span>
                      )}
                      {lesson.attempts > 1 && (
                        <span
                          style={{
                            background: "var(--status-info-bg)",
                            color: "var(--status-info-text)",
                            padding: "3px 8px",
                            borderRadius: "10px",
                            fontSize: "0.7rem",
                            fontWeight: 600,
                            whiteSpace: "nowrap",
                          }}
                        >
                          Try #{lesson.attempts}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Class name and subject - secondary text */}
                  <div style={{ marginBottom: "12px", minHeight: "40px" }}>
                    {lesson.className && (
                      <p style={{ margin: "0 0 2px 0", color: "var(--text-secondary)", fontSize: "0.85rem" }}>
                        {lesson.className}
                      </p>
                    )}
                    {lesson.subject && (
                      <p style={{ margin: 0, color: "var(--accent-primary)", fontSize: "0.8rem", fontWeight: 500 }}>
                        {lesson.subject}
                      </p>
                    )}
                  </div>
                </div>

                {/* === META SECTION === */}
                <div
                  style={{
                    display: "flex",
                    gap: "16px",
                    alignItems: "center",
                    marginBottom: "12px",
                    color: "var(--text-muted)",
                    fontSize: "0.8rem",
                  }}
                >
                  <span>
                    {questionCount} {questionCount === 1 ? "question" : "questions"}
                  </span>
                  <span style={{ color: "var(--text-muted)" }}>·</span>
                  <span>{estimatedTime}</span>
                </div>

                {/* === STATUS SECTION (reserved space for due date OR resume banner) === */}
                <div style={{ minHeight: "52px", marginBottom: "12px" }}>
                  {/* Priority: Resume banner > Due date */}
                  {isPaused ? (
                    <div
                      style={{
                        padding: "10px 12px",
                        background: "var(--status-warning-bg)",
                        borderRadius: "8px",
                        borderLeft: "3px solid var(--status-warning)",
                      }}
                    >
                      <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--status-warning-text)" }}>
                        <strong>You're on question {progress + 1}</strong> — pick up where you left off!
                      </p>
                    </div>
                  ) : dueDateInfo ? (
                    <div
                      style={{
                        padding: "10px 12px",
                        background: dueDateInfo.isPastDue ? "var(--status-error-bg)" : "var(--surface-muted)",
                        borderRadius: "8px",
                        borderLeft: dueDateInfo.isPastDue ? "3px solid var(--status-error)" : "3px solid var(--border-muted)",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "0.85rem",
                          fontWeight: 500,
                          color: dueDateInfo.isPastDue ? "var(--status-error-text)" : "var(--text-secondary)",
                        }}
                      >
                        {dueDateInfo.isPastDue ? "Past due" : `Due ${dueDateInfo.formattedDate}`}
                      </span>
                    </div>
                  ) : null}
                </div>

                {/* === SPACER (pushes actions to bottom) === */}
                <div style={{ flex: 1 }} />

                {/* === ACTION SECTION === */}
                <div style={{ display: "flex", gap: "12px", marginTop: "auto" }}>
                  <button
                    className="btn btn-primary"
                    onClick={() => handleStartLesson(lesson, "video")}
                    style={{
                      flex: 1,
                      padding: "12px 16px",
                    }}
                  >
                    {isPaused ? "Resume video" : "Start video"}
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => handleStartLesson(lesson, "type")}
                    style={{
                      flex: 1,
                      padding: "12px 16px",
                    }}
                  >
                    {isPaused ? "Resume typing" : "Start typing"}
                  </button>
                </div>
              </div>
            );
          })}
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

                // Group sessions by lessonId within subject
                const sessionsByLesson = new Map<string, Session[]>();
                group.sessions.forEach((session) => {
                  const existing = sessionsByLesson.get(session.lessonId) || [];
                  existing.push(session);
                  sessionsByLesson.set(session.lessonId, existing);
                });

                // Count unique assignments, badges, and notes for this subject
                const uniqueAssignments = sessionsByLesson.size;
                const subjectBadgeCount = group.badges.length;
                const subjectNoteCount = group.notes.length;

                // Build metadata parts
                const metadataParts: string[] = [];
                metadataParts.push(`${uniqueAssignments} ${uniqueAssignments === 1 ? "assignment" : "assignments"}`);
                if (subjectNoteCount > 0) {
                  metadataParts.push(`${subjectNoteCount} ${subjectNoteCount === 1 ? "note" : "notes"}`);
                }
                if (subjectBadgeCount > 0) {
                  metadataParts.push(`${subjectBadgeCount} ${subjectBadgeCount === 1 ? "badge" : "badges"}`);
                }

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
                        borderLeft: "3px solid var(--accent-primary)",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <h3 style={{ margin: 0, color: "var(--text-primary)", fontSize: "1.1rem" }}>
                          {group.subject}
                        </h3>
                        <p style={{ color: "var(--text-secondary)", fontSize: "0.8rem", margin: "4px 0 0 0" }}>
                          {metadataParts.join(" · ")}
                        </p>
                      </div>
                      <span
                        style={{
                          color: "var(--accent-primary)",
                          fontSize: "0.85rem",
                          transition: "transform 0.2s",
                          transform: isSubjectExpanded ? "rotate(90deg)" : "rotate(0deg)",
                          opacity: 0.7,
                        }}
                      >
                        ▶
                      </span>
                    </button>

                    {/* Subject Content */}
                    {isSubjectExpanded && (
                      <div style={{ padding: "16px 20px" }}>
                        {/* Assignments in this subject */}
                        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                          {Array.from(sessionsByLesson.entries()).map(([lessonId, lessonSessions]) => {
                            const latestSession = lessonSessions[0];
                            const totalAttempts = lessonSessions.length;
                            const isExpanded = expandedAssignments.has(lessonId);
                            const feedbackStatus = getFeedbackStatus(latestSession);
                            // Get badges for this specific assignment
                            const assignmentBadges = badges.filter((b) => b.assignmentId === lessonId);

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
                                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                                      <h4 style={{ margin: 0, color: "var(--accent-primary)", fontSize: "0.95rem" }}>
                                        {latestSession.lessonTitle}
                                      </h4>
                                      {/* Feedback status badge */}
                                      <span
                                        style={{
                                          fontSize: "0.7rem",
                                          padding: "2px 8px",
                                          borderRadius: "10px",
                                          fontWeight: 500,
                                          background: feedbackStatus.isReviewed
                                            ? (feedbackStatus.hasNote ? "var(--status-success-bg)" : "var(--surface-accent)")
                                            : "var(--surface-muted)",
                                          color: feedbackStatus.isReviewed
                                            ? (feedbackStatus.hasNote ? "var(--status-success-text)" : "var(--text-secondary)")
                                            : "var(--text-muted)",
                                        }}
                                      >
                                        {feedbackStatus.label}
                                      </span>
                                      {/* Badges earned for this assignment */}
                                      {assignmentBadges.map((badge) => {
                                        const isNew = !badge.celebratedAt;
                                        return (
                                          <button
                                            key={badge.id}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setSelectedBadge(badge);
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
                                              background: "var(--status-warning-bg)",
                                              border: isNew ? "2px solid var(--status-warning)" : "1px solid var(--status-warning)",
                                              borderRadius: "12px",
                                              fontSize: "0.7rem",
                                              cursor: "pointer",
                                              color: "var(--status-warning-text)",
                                              position: "relative",
                                            }}
                                            title={badge.badgeTypeName}
                                          >
                                            {isNew && (
                                              <span
                                                style={{
                                                  position: "absolute",
                                                  top: "-2px",
                                                  right: "-2px",
                                                  width: "8px",
                                                  height: "8px",
                                                  background: "var(--status-success)",
                                                  borderRadius: "50%",
                                                  border: "2px solid white",
                                                }}
                                              />
                                            )}
                                            <span
                                              style={{
                                                width: "8px",
                                                height: "8px",
                                                borderRadius: "50%",
                                                background: BADGE_DISPLAY[badge.badgeType]?.color || "#e91e63",
                                                flexShrink: 0,
                                              }}
                                            />
                                            <span>{BADGE_DISPLAY[badge.badgeType]?.name || badge.badgeTypeName}</span>
                                          </button>
                                        );
                                      })}
                                    </div>
                                    <p style={{ color: "var(--text-secondary)", fontSize: "0.8rem", margin: "4px 0 0 0" }}>
                                      {totalAttempts > 1
                                        ? `${totalAttempts} attempts · Last completed ${new Date(latestSession.completedAt || latestSession.startedAt).toLocaleDateString()}`
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
                                      const sessionFeedback = getFeedbackStatus(session);
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
                                            background: isHighlighted
                                              ? "var(--status-warning-bg)"
                                              : sessionFeedback.hasNote
                                              ? "var(--status-success-bg)"
                                              : "var(--surface-muted)",
                                            borderRadius: "8px",
                                            borderLeft: isHighlighted
                                              ? "4px solid var(--status-warning)"
                                              : sessionFeedback.hasNote
                                              ? "4px solid var(--status-success)"
                                              : "4px solid var(--border-muted)",
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
                                              <h4 style={{ margin: "0 0 8px 0", color: "var(--status-warning-text)", fontSize: "0.95rem" }}>
                                                Badge Evidence
                                              </h4>
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
                                                {session.submission.responses[0].inputSource === "voice" ? "Voice" : "Typed"}
                                              </span>
                                            )}
                                            <span
                                              style={{
                                                fontSize: "0.7rem",
                                                marginLeft: "auto",
                                                padding: "2px 6px",
                                                borderRadius: "8px",
                                                background: sessionFeedback.isReviewed
                                                  ? (sessionFeedback.hasNote ? "var(--status-success-bg)" : "var(--surface-accent)")
                                                  : "transparent",
                                                color: sessionFeedback.isReviewed
                                                  ? (sessionFeedback.hasNote ? "var(--status-success-text)" : "var(--text-secondary)")
                                                  : "var(--text-muted)",
                                              }}
                                            >
                                              {sessionFeedback.label}
                                            </span>
                                          </div>

                                          {/* Teacher feedback - only show if reviewed */}
                                          {sessionFeedback.isReviewed && (
                                            <div style={{ marginBottom: "8px" }}>
                                              {sessionFeedback.hasNote ? (
                                                <div
                                                  style={{
                                                    padding: "10px 12px",
                                                    background: "var(--status-success-bg)",
                                                    borderRadius: "8px",
                                                    borderLeft: "3px solid var(--status-success)",
                                                  }}
                                                >
                                                  <p
                                                    style={{
                                                      margin: "0 0 4px 0",
                                                      fontSize: "0.75rem",
                                                      fontWeight: 600,
                                                      color: "var(--status-success-text)",
                                                    }}
                                                  >
                                                    Note from your teacher
                                                  </p>
                                                  <p
                                                    style={{
                                                      margin: 0,
                                                      fontSize: "0.85rem",
                                                      color: "var(--text-primary)",
                                                    }}
                                                  >
                                                    {session.educatorNotes}
                                                  </p>
                                                </div>
                                              ) : (
                                                <p
                                                  style={{
                                                    margin: 0,
                                                    fontSize: "0.8rem",
                                                    color: "var(--text-muted)",
                                                  }}
                                                >
                                                  Reviewed — no note
                                                </p>
                                              )}
                                            </div>
                                          )}

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
                                                }}
                                              >
                                                My Answers
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

                                                        {/* Response - Video conversation with transcript OR text/voice */}
                                                        {response.conversationTurns && response.conversationTurns.length > 0 ? (
                                                          // Video conversation with transcript
                                                          (() => {
                                                            const transcriptKey = `${session.id}-${response.promptId}`;
                                                            const isTranscriptExpanded = expandedTranscripts.has(transcriptKey);
                                                            const turns = response.conversationTurns!;
                                                            const coachPromptCount = turns.filter((t) => t.role === "coach").length;
                                                            const previewTurns = turns.slice(0, 2);
                                                            const hasMoreTurns = turns.length > 2;
                                                            const turnsToShow = isTranscriptExpanded ? turns : previewTurns;

                                                            return (
                                                              <div
                                                                style={{
                                                                  background: "var(--surface-muted)",
                                                                  borderRadius: "6px",
                                                                  padding: "10px",
                                                                  border: "1px solid var(--border-subtle)",
                                                                }}
                                                              >
                                                                {/* Video conversation label */}
                                                                <div
                                                                  style={{
                                                                    display: "flex",
                                                                    alignItems: "center",
                                                                    gap: "8px",
                                                                    marginBottom: "10px",
                                                                  }}
                                                                >
                                                                  <span
                                                                    style={{
                                                                      background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                                                                      color: "white",
                                                                      padding: "3px 8px",
                                                                      borderRadius: "10px",
                                                                      fontSize: "0.7rem",
                                                                      fontWeight: 500,
                                                                    }}
                                                                  >
                                                                    Video conversation
                                                                  </span>
                                                                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                                                                    {coachPromptCount} coach prompt{coachPromptCount !== 1 ? "s" : ""}
                                                                  </span>
                                                                </div>

                                                                {/* Transcript turns */}
                                                                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                                                                  {turnsToShow.map((turn, turnIdx) => (
                                                                    <div
                                                                      key={turnIdx}
                                                                      style={{
                                                                        display: "flex",
                                                                        gap: "8px",
                                                                        alignItems: "flex-start",
                                                                      }}
                                                                    >
                                                                      <span
                                                                        style={{
                                                                          fontSize: "0.7rem",
                                                                          fontWeight: 600,
                                                                          color: turn.role === "coach" ? "#667eea" : "var(--status-success-text)",
                                                                          minWidth: "40px",
                                                                          flexShrink: 0,
                                                                        }}
                                                                      >
                                                                        {turn.role === "coach" ? "Coach" : "You"}
                                                                      </span>
                                                                      <p
                                                                        style={{
                                                                          margin: 0,
                                                                          fontSize: "0.8rem",
                                                                          lineHeight: 1.4,
                                                                          color: "var(--text-primary)",
                                                                          flex: 1,
                                                                        }}
                                                                      >
                                                                        {turn.message}
                                                                      </p>
                                                                    </div>
                                                                  ))}
                                                                </div>

                                                                {/* Show more/less toggle */}
                                                                {hasMoreTurns && (
                                                                  <button
                                                                    onClick={(e) => {
                                                                      e.stopPropagation();
                                                                      toggleTranscriptExpanded(session.id, response.promptId);
                                                                    }}
                                                                    style={{
                                                                      background: "transparent",
                                                                      border: "none",
                                                                      color: "var(--accent-primary)",
                                                                      fontSize: "0.75rem",
                                                                      fontWeight: 500,
                                                                      cursor: "pointer",
                                                                      padding: "6px 0 0 0",
                                                                      display: "flex",
                                                                      alignItems: "center",
                                                                      gap: "4px",
                                                                    }}
                                                                  >
                                                                    <span
                                                                      style={{
                                                                        display: "inline-block",
                                                                        transition: "transform 0.2s",
                                                                        transform: isTranscriptExpanded ? "rotate(90deg)" : "rotate(0deg)",
                                                                        fontSize: "0.6rem",
                                                                      }}
                                                                    >
                                                                      ▶
                                                                    </span>
                                                                    {isTranscriptExpanded
                                                                      ? "Show less"
                                                                      : `Show full transcript (${turns.length - 2} more)`}
                                                                  </button>
                                                                )}
                                                              </div>
                                                            );
                                                          })()
                                                        ) : (
                                                          // Standard text/voice response
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
                                                                  <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>(Voice)</span>{" "}
                                                                  {response.response}
                                                                </p>
                                                              ) : (
                                                                <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.85rem", fontStyle: "italic" }}>
                                                                  Voice response recorded
                                                                </p>
                                                              )
                                                            ) : response.inputSource === "video" ? (
                                                              // Video without transcript (older format)
                                                              <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.85rem", fontStyle: "italic" }}>
                                                                Video conversation recorded
                                                                {response.video?.durationSec && ` (${Math.round(response.video.durationSec)}s)`}
                                                              </p>
                                                            ) : (
                                                              <p style={{ margin: 0, color: "var(--text-primary)", fontSize: "0.85rem" }}>
                                                                {response.response || <em style={{ color: "var(--text-muted)" }}>No response recorded</em>}
                                                              </p>
                                                            )}
                                                          </div>
                                                        )}

                                                        {/* Hint indicator */}
                                                        {response.hintUsed && (
                                                          <p style={{ margin: "6px 0 0 0", color: "var(--text-muted)", fontSize: "0.75rem" }}>
                                                            Used a hint
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

      {/* Ask Coach Drawer */}
      <AskCoachDrawer
        isOpen={showCoachDrawer}
        onClose={() => {
          setShowCoachDrawer(false);
          setDrawerInviteId(undefined);
          setDrawerTopics([]);
          setDrawerGradeLevel(undefined);
        }}
        studentId={studentId!}
        topics={drawerTopics}
        inviteId={drawerInviteId}
        gradeLevel={drawerGradeLevel}
        initialMode={drawerMode}
        onChangeTopics={handleChangeTopics}
      />
    </div>
    </>
  );
}
