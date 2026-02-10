/**
 * Educator Dashboard - Lifecycle-Aware Triage Screen
 *
 * Design Philosophy:
 * - Answer: "Who needs my help, why, and what should I do next?"
 * - Teachers should not manage dashboards
 * - System surfaces what needs attention
 * - Everything else is quietly archived
 *
 * Lifecycle States:
 * - Active: Needs teacher attention or has incomplete work
 * - Resolved: All work complete, teacher has reviewed
 * - Archived: Auto-archived after resolution period (separate view)
 */

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useNavigate, useSearchParams, useLocation } from "react-router-dom";
import {
  getAssignmentDashboard,
  triggerAutoArchive,
  archiveAssignment,
  archiveLesson,
  deleteLesson,
  archiveClass,
  deleteClass,
  getClasses,
  getClass,
  createClass,
  bulkAddStudentsToClass,
  removeStudentFromClass,
  getLessonAssignments,
  getLessons,
  getStudents,
  getStudentCoachingInsights,
  getAssignedStudents,
  assignLessonToClass,
  getRecommendations,
  refreshRecommendations,
  dismissRecommendation,
  submitRecommendationFeedback,
  getUnassignedLessons,
  updateLessonSubject,
  getTeacherTodos,
  getTeacherTodoCounts,
  getDashboardAttentionState,
  getCoachingInvites,
  dismissCoachingInvite,
  generateLesson,
  saveLesson,
  getTeacherProfile,
  getLessonDrafts,
  createLessonDraft,
  updateLessonDraft,
  deleteLessonDraft,
  type ComputedAssignmentState,
  type AssignmentDashboardData,
  type ClassSummary,
  type ClassWithStudents,
  type Student,
  type CoachingInsight,
  type Recommendation,
  type FeedbackType,
  type LessonSummary,
  type TeacherTodo,
  type TeacherTodoCounts,
  type StudentAttentionStatus,
  type DashboardAttentionState,
  type Lesson,
  type CoachingInvite,
  type TeacherProfile,
  type LessonDraft,
  getDevStatus,
  seedDemoData,
  resetDemoData,
  resetAllData,
} from "../services/api";
import RecommendationPanel from "../components/RecommendationPanel";
import TeacherTodosPanel from "../components/TeacherTodosPanel";
import Drawer from "../components/Drawer";
import EducatorAppHeader from "../components/EducatorAppHeader";
import TeacherProfileDrawer from "../components/TeacherProfileDrawer";
import {
  getLastUsedSettings,
  saveLastUsedSettings,
  recordLessonCreated,
  buildGenerationContext,
  getSuggestedQuestionCount,
} from "../utils/teacherPreferences";
import { useToast } from "../components/Toast";

// Drawer type enum
type DrawerType = "todos" | "coach" | "assignments" | "unassigned" | "classes" | "create-lesson" | "assign-lesson" | null;

// Type for assignments grouped by class
interface ClassAssignmentGroup {
  classId: string;
  className: string;
  assignments: ComputedAssignmentState[];
}

// Type for student coaching activity
interface StudentCoachingActivity {
  studentId: string;
  studentName: string;
  insight: CoachingInsight;
}

export default function EducatorDashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { showError, showSuccess } = useToast();

  // Check for scroll restoration state (from back navigation)
  const scrollTarget = (location.state as { scrollTo?: string } | null)?.scrollTo;
  const [dashboardData, setDashboardData] = useState<AssignmentDashboardData | null>(null);
  const [classes, setClasses] = useState<ClassSummary[]>([]);
  const [allStudents, setAllStudents] = useState<Student[]>([]);
  const [assignmentClassMap, setAssignmentClassMap] = useState<Map<string, string[]>>(new Map());
  const [coachingActivity, setCoachingActivity] = useState<StudentCoachingActivity[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [_dismissedRecommendations, setDismissedRecommendations] = useState<Recommendation[]>([]);
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);
  const [teacherTodos, setTeacherTodos] = useState<TeacherTodo[]>([]);
  const [todoCounts, setTodoCounts] = useState<TeacherTodoCounts>({ total: 0, open: 0, done: 0 });
  const [attentionState, setAttentionState] = useState<DashboardAttentionState | null>(null);
  const [unassignedLessons, setUnassignedLessons] = useState<LessonSummary[]>([]);
  const [lessonDrafts, setLessonDrafts] = useState<LessonDraft[]>([]);
  const [editingDraft, setEditingDraft] = useState<LessonDraft | null>(null);
  const [assigningLesson, setAssigningLesson] = useState<LessonSummary | null>(null);
  const [coachingInvites, setCoachingInvites] = useState<CoachingInvite[]>([]);
  const [lessonMetadata, setLessonMetadata] = useState<Map<string, { subject?: string; gradeLevel?: string; difficulty?: string }>>(new Map());
  const [teacherProfile, setTeacherProfile] = useState<TeacherProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Global search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [selectedResultIndex, setSelectedResultIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchResultsRef = useRef<HTMLDivElement>(null);
  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null);

  // Add Student Modal state
  const [addStudentModal, setAddStudentModal] = useState<{
    isOpen: boolean;
    assignmentId: string;
    assignmentTitle: string;
  } | null>(null);

  // Drawer state - initialize from URL param if present
  const initialDrawer = searchParams.get("drawer") as DrawerType;
  const [openDrawer, setOpenDrawer] = useState<DrawerType>(initialDrawer);

  // Profile drawer state (separate from main drawer)
  const [profileDrawerOpen, setProfileDrawerOpen] = useState(false);

  // Dev mode state (seed/reset data)
  const [devModeAvailable, setDevModeAvailable] = useState(false);
  const [showDevPanel, setShowDevPanel] = useState(false);
  const [devAction, setDevAction] = useState<"seed" | "reset-demo" | "reset-all" | null>(null);
  const [devLoading, setDevLoading] = useState(false);

  // Assignment drawer filters - initialize from URL params
  const [assignmentFilters, setAssignmentFilters] = useState<{
    subject?: string;
    gradeLevel?: string;
    difficulty?: string;
  }>({
    subject: searchParams.get("subject") || undefined,
    gradeLevel: searchParams.get("grade") || undefined,
    difficulty: searchParams.get("difficulty") || undefined,
  });

  // Store initial section param to scroll to after loading
  const initialSection = useRef(searchParams.get("section"));

  // ============================================
  // Global Search Logic
  // ============================================

  // Normalize string for matching: lowercase, trim, collapse whitespace
  const normalizeForSearch = useCallback((str: string): string => {
    return str.toLowerCase().trim().replace(/\s+/g, " ");
  }, []);

  // Check if a string matches the search query
  const matchesSearch = useCallback((text: string, query: string): boolean => {
    if (!query) return false;
    const normalizedText = normalizeForSearch(text);
    const normalizedQuery = normalizeForSearch(query);
    return normalizedText.includes(normalizedQuery);
  }, [normalizeForSearch]);

  // Search result types
  interface SearchResult {
    type: "student" | "assignment" | "class" | "lesson";
    id: string;
    primary: string; // Main label (name/title)
    secondary?: string; // Secondary info (class, subject, etc.)
    route: string; // Navigation route
  }

  // Compute search results based on query
  const searchResults = useMemo((): SearchResult[] => {
    if (!searchQuery.trim() || searchQuery.length < 2) return [];

    const results: SearchResult[] = [];
    const query = searchQuery.trim();

    // Search students (up to 5)
    const studentMatches = allStudents
      .filter((s) => {
        const nameMatch = matchesSearch(s.name, query);
        const preferredMatch = s.preferredName ? matchesSearch(s.preferredName, query) : false;
        return nameMatch || preferredMatch;
      })
      .slice(0, 5)
      .map((s): SearchResult => {
        // Find which class(es) this student belongs to
        const studentClasses = classes.filter((c) =>
          dashboardData?.active.some((a) =>
            a.studentStatuses.some((ss) => ss.studentId === s.id)
          ) || dashboardData?.resolved.some((a) =>
            a.studentStatuses.some((ss) => ss.studentId === s.id)
          )
        );
        const className = studentClasses.length > 0 ? studentClasses[0].name : undefined;
        return {
          type: "student",
          id: s.id,
          primary: s.preferredName || s.name,
          secondary: className,
          route: `/educator/student/${s.id}`,
        };
      });
    results.push(...studentMatches);

    // Search assignments (up to 5)
    const allAssignments = [...(dashboardData?.active || []), ...(dashboardData?.resolved || [])];
    const assignmentMatches = allAssignments
      .filter((a) => matchesSearch(a.title, query))
      .slice(0, 5)
      .map((a): SearchResult => {
        const metadata = lessonMetadata.get(a.assignmentId);
        const classIds = assignmentClassMap.get(a.assignmentId) || [];
        const assignedClass = classes.find((c) => classIds.includes(c.id));
        return {
          type: "assignment",
          id: a.assignmentId,
          primary: a.title,
          secondary: [assignedClass?.name, metadata?.subject].filter(Boolean).join(" · ") || undefined,
          route: `/educator/assignment/${a.assignmentId}`,
        };
      });
    results.push(...assignmentMatches);

    // Search classes (up to 5)
    const classMatches = classes
      .filter((c) => !c.archivedAt && matchesSearch(c.name, query))
      .slice(0, 5)
      .map((c): SearchResult => ({
        type: "class",
        id: c.id,
        primary: c.name,
        secondary: [c.gradeLevel, c.subject, `${c.studentCount} students`].filter(Boolean).join(" · "),
        route: `/educator/class/${c.id}`,
      }));
    results.push(...classMatches);

    // Search lessons (unassigned + get titles from assignments)
    const lessonMatches = unassignedLessons
      .filter((l) => {
        const titleMatch = matchesSearch(l.title, query);
        const subjectMatch = l.subject ? matchesSearch(l.subject, query) : false;
        return titleMatch || subjectMatch;
      })
      .slice(0, 5)
      .map((l): SearchResult => ({
        type: "lesson",
        id: l.id,
        primary: l.title,
        secondary: [l.subject, l.gradeLevel, l.difficulty].filter(Boolean).join(" · "),
        route: `/educator/lesson/${l.id}/edit`,
      }));
    results.push(...lessonMatches);

    return results;
  }, [searchQuery, allStudents, dashboardData, classes, unassignedLessons, assignmentClassMap, lessonMetadata, matchesSearch]);

  // Group results by type for display
  const groupedResults = useMemo(() => {
    const groups: { type: string; label: string; items: SearchResult[] }[] = [];

    const students = searchResults.filter((r) => r.type === "student");
    const assignments = searchResults.filter((r) => r.type === "assignment");
    const classResults = searchResults.filter((r) => r.type === "class");
    const lessons = searchResults.filter((r) => r.type === "lesson");

    if (students.length > 0) groups.push({ type: "student", label: "Students", items: students });
    if (assignments.length > 0) groups.push({ type: "assignment", label: "Assignments", items: assignments });
    if (classResults.length > 0) groups.push({ type: "class", label: "Classes", items: classResults });
    if (lessons.length > 0) groups.push({ type: "lesson", label: "Lessons", items: lessons });

    return groups;
  }, [searchResults]);

  // Flat list of all results for keyboard navigation
  const flatResults = useMemo(() => {
    return groupedResults.flatMap((g) => g.items);
  }, [groupedResults]);

  // Handle search result selection
  const handleSelectResult = useCallback((result: SearchResult) => {
    setSearchQuery("");
    setSearchFocused(false);
    setSelectedResultIndex(-1);
    navigate(result.route);
  }, [navigate]);

  // Handle keyboard navigation in search
  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!searchFocused || flatResults.length === 0) {
      if (e.key === "Escape") {
        setSearchFocused(false);
        searchInputRef.current?.blur();
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedResultIndex((prev) =>
          prev < flatResults.length - 1 ? prev + 1 : 0
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedResultIndex((prev) =>
          prev > 0 ? prev - 1 : flatResults.length - 1
        );
        break;
      case "Enter":
        e.preventDefault();
        if (selectedResultIndex >= 0 && selectedResultIndex < flatResults.length) {
          handleSelectResult(flatResults[selectedResultIndex]);
        }
        break;
      case "Escape":
        e.preventDefault();
        setSearchFocused(false);
        setSearchQuery("");
        setSelectedResultIndex(-1);
        searchInputRef.current?.blur();
        break;
    }
  }, [searchFocused, flatResults, selectedResultIndex, handleSelectResult]);

  // Handle search input change with debounce
  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);
    setSelectedResultIndex(-1);

    // Clear previous debounce
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    // Debounce the search (though results are computed via useMemo, this helps with rapid typing)
    searchDebounceRef.current = setTimeout(() => {
      // Results are already computed via useMemo based on searchQuery
    }, 250);
  }, []);

  // Close search results when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        searchInputRef.current &&
        !searchInputRef.current.contains(e.target as Node) &&
        searchResultsRef.current &&
        !searchResultsRef.current.contains(e.target as Node)
      ) {
        setSearchFocused(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Clear URL params after reading them
  useEffect(() => {
    const hasDrawer = searchParams.get("drawer");
    const hasSection = searchParams.get("section");
    const hasSubject = searchParams.get("subject");
    const hasGrade = searchParams.get("grade");
    const hasDifficulty = searchParams.get("difficulty");

    if (hasDrawer || hasSection || hasSubject || hasGrade || hasDifficulty) {
      const newParams = new URLSearchParams(searchParams);
      newParams.delete("drawer");
      newParams.delete("section");
      newParams.delete("subject");
      newParams.delete("grade");
      newParams.delete("difficulty");
      setSearchParams(newParams, { replace: true });
    }
  }, []);

  // Open assignments drawer when navigating with section=assignments
  useEffect(() => {
    if (!loading && initialSection.current === "assignments") {
      // Small delay to ensure content is rendered
      setTimeout(() => {
        setOpenDrawer("assignments");
      }, 150);
      // Clear the ref so we don't open again on subsequent re-renders
      initialSection.current = null;
    }
  }, [loading]);

  // Scroll restoration from navigation state (e.g., returning from Recommended Actions)
  useEffect(() => {
    if (!loading && scrollTarget) {
      setTimeout(() => {
        const element = document.getElementById(scrollTarget);
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        // Clear the state to prevent repeated scrolling
        window.history.replaceState({}, document.title);
      }, 200);
    }
  }, [loading, scrollTarget]);

  const loadData = async () => {
    try {
      setError(null);

      // Check if dev mode is available
      const devStatus = await getDevStatus();
      setDevModeAvailable(devStatus.devMode);

      // Trigger auto-archive check on dashboard load
      await triggerAutoArchive().catch(() => {
        // Silently fail - not critical
        console.log("Auto-archive check skipped");
      });

      const [dashData, classesData, studentsData, unassignedData, allLessonsData, draftsData] = await Promise.all([
        getAssignmentDashboard(),
        getClasses(),
        getStudents(),
        getUnassignedLessons(),
        getLessons(),
        getLessonDrafts(),
      ]);

      setDashboardData(dashData);
      setClasses(classesData);
      setAllStudents(studentsData);
      setUnassignedLessons(unassignedData);
      setLessonDrafts(draftsData.drafts);

      // Build lesson metadata map (subject, gradeLevel, difficulty)
      const metadataMap = new Map<string, { subject?: string; gradeLevel?: string; difficulty?: string }>();
      allLessonsData.forEach(lesson => {
        metadataMap.set(lesson.id, {
          subject: lesson.subject,
          gradeLevel: lesson.gradeLevel,
          difficulty: lesson.difficulty,
        });
      });
      setLessonMetadata(metadataMap);

      // Load class associations for each assignment
      const allAssignments = [...dashData.active, ...dashData.resolved];
      const classMap = new Map<string, string[]>();

      await Promise.all(
        allAssignments.map(async (assignment) => {
          try {
            const summary = await getLessonAssignments(assignment.assignmentId);
            const classIds = summary.assignmentsByClass.map(c => c.classId);
            classMap.set(assignment.assignmentId, classIds);
          } catch {
            // Assignment may not have class associations
            classMap.set(assignment.assignmentId, []);
          }
        })
      );

      setAssignmentClassMap(classMap);

      // Load coaching insights for all students
      const coachingActivities: StudentCoachingActivity[] = [];
      await Promise.all(
        studentsData.map(async (student: Student) => {
          try {
            const insight = await getStudentCoachingInsights(student.id);
            if (insight.totalCoachRequests > 0) {
              coachingActivities.push({
                studentId: student.id,
                studentName: student.name,
                insight,
              });
            }
          } catch {
            // No coaching data for this student
          }
        })
      );

      // Sort by recency and support-seeking first
      coachingActivities.sort((a, b) => {
        // Support-seeking students first
        if (a.insight.intentLabel === "support-seeking" && b.insight.intentLabel !== "support-seeking") return -1;
        if (b.insight.intentLabel === "support-seeking" && a.insight.intentLabel !== "support-seeking") return 1;
        // Then by recency
        const aTime = a.insight.lastCoachSessionAt ? new Date(a.insight.lastCoachSessionAt).getTime() : 0;
        const bTime = b.insight.lastCoachSessionAt ? new Date(b.insight.lastCoachSessionAt).getTime() : 0;
        return bTime - aTime;
      });

      setCoachingActivity(coachingActivities);

      // Load recommendations (refresh to get latest)
      try {
        await refreshRecommendations();
        // Load active recommendations for Recommended Actions panel
        const recsData = await getRecommendations({ status: "active", limit: 10 });
        setRecommendations(recsData.recommendations);

        // Load dismissed recommendations for the archived panel
        const dismissedData = await getRecommendations({ status: "dismissed", limit: 20 });
        setDismissedRecommendations(dismissedData.recommendations);
      } catch (recErr) {
        console.log("Recommendations not available:", recErr);
        // Not critical - dashboard still works without recommendations
      }

      // Load teacher todos
      try {
        const [todosData, countsData] = await Promise.all([
          getTeacherTodos({ status: "open" }),
          getTeacherTodoCounts(),
        ]);
        setTeacherTodos(todosData.todos);
        setTodoCounts(countsData);
      } catch (todoErr) {
        console.log("Teacher todos not available:", todoErr);
        // Not critical - dashboard still works without todos
      }

      // Load attention state (single source of truth for "needs attention")
      try {
        const attention = await getDashboardAttentionState();
        setAttentionState(attention);
      } catch (attErr) {
        console.log("Attention state not available:", attErr);
        // Not critical - can fall back to session-based calculation
      }

      // Load coaching invites (teacher-assigned sessions)
      try {
        const invitesData = await getCoachingInvites();
        const statusOrder: Record<string, number> = { pending: 0, started: 1, completed: 2 };
        const filtered = invitesData.invites
          .filter((inv) => inv.status !== "dismissed")
          .sort((a, b) => (statusOrder[a.status] ?? 3) - (statusOrder[b.status] ?? 3));
        setCoachingInvites(filtered);
      } catch (invErr) {
        console.log("Coaching invites not available:", invErr);
      }

      // Load teacher profile for header display
      try {
        const profile = await getTeacherProfile();
        setTeacherProfile(profile);
      } catch (profileErr) {
        console.log("Teacher profile not available:", profileErr);
      }
    } catch (err) {
      console.error("Failed to load educator dashboard:", err);
      setError("Failed to load dashboard data. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Auto-refresh recommendations every 60 seconds
  useEffect(() => {
    const intervalId = setInterval(() => {
      // Only auto-refresh if not already loading
      if (!recommendationsLoading) {
        handleRefreshRecommendations();
      }
    }, 60000); // 60 seconds

    return () => clearInterval(intervalId);
  }, [recommendationsLoading]);

  const _handleArchiveAssignment = async (assignmentId: string, title: string) => {
    if (!confirm(`Archive "${title}"? A summary will be generated and you can restore it later.`)) {
      return;
    }

    try {
      await archiveAssignment(assignmentId);
      await loadData();
    } catch (err) {
      console.error("Failed to archive assignment:", err);
      showError("Failed to archive assignment. Please try again.");
    }
  };

  const handleArchiveUnassignedLesson = async (lessonId: string, title: string) => {
    try {
      await archiveLesson(lessonId);
      await loadData();
      showSuccess(`"${title}" has been archived.`);
    } catch (err) {
      console.error("Failed to archive lesson:", err);
      showError("Failed to archive lesson. Please try again.");
    }
  };

  const handleDeleteUnassignedLesson = async (lessonId: string, title: string) => {
    try {
      await deleteLesson(lessonId);
      await loadData();
      showSuccess(`"${title}" has been deleted.`);
    } catch (err) {
      console.error("Failed to delete lesson:", err);
      showError("Failed to delete lesson. Please try again.");
    }
  };

  // Class management handlers
  const reloadClasses = async () => {
    try {
      const classesData = await getClasses();
      setClasses(classesData);
    } catch (err) {
      console.error("Failed to reload classes:", err);
    }
  };

  const _handleArchiveClass = async (classId: string, className: string) => {
    try {
      await archiveClass(classId);
      await reloadClasses();
      showSuccess(`"${className}" has been archived.`);
    } catch (err) {
      console.error("Failed to archive class:", err);
      showError("Failed to archive class. Please try again.");
    }
  };

  const _handleDeleteClass = async (classId: string, className: string) => {
    try {
      await deleteClass(classId);
      await reloadClasses();
      showSuccess(`"${className}" has been removed.`);
    } catch (err) {
      console.error("Failed to delete class:", err);
      showError("Failed to remove class. Please try again.");
    }
  };

  // Recommendation handlers
  const handleDismissRecommendation = async (id: string) => {
    try {
      const result = await dismissRecommendation(id);
      // Remove from active recommendations
      setRecommendations((prev) => prev.filter((r) => r.id !== id));
      // Add to dismissed (archived) with updated status
      if (result.recommendation) {
        setDismissedRecommendations((prev) => [result.recommendation, ...prev]);
      }
      // Refresh attention state (cascading update)
      const attention = await getDashboardAttentionState();
      setAttentionState(attention);
    } catch (err) {
      console.error("Failed to dismiss recommendation:", err);
    }
  };

  const handleRecommendationFeedback = async (id: string, feedback: FeedbackType) => {
    try {
      await submitRecommendationFeedback(id, feedback);
      setRecommendations((prev) =>
        prev.map((r) => (r.id === id ? { ...r, feedback } : r))
      );
    } catch (err) {
      console.error("Failed to submit recommendation feedback:", err);
    }
  };

  const handleRefreshRecommendations = async () => {
    setRecommendationsLoading(true);
    try {
      await refreshRecommendations();
      // Refresh active recommendations
      const recsData = await getRecommendations({ status: "active", limit: 10 });
      setRecommendations(recsData.recommendations);

      // And refresh dismissed (archived)
      const dismissedData = await getRecommendations({ status: "dismissed", limit: 20 });
      setDismissedRecommendations(dismissedData.recommendations);

      // And refresh todos (in case actions created new ones)
      const [todosData, countsData] = await Promise.all([
        getTeacherTodos({ status: "open" }),
        getTeacherTodoCounts(),
      ]);
      setTeacherTodos(todosData.todos);
      setTodoCounts(countsData);

      // Refresh attention state (single source of truth for "needs attention")
      const attention = await getDashboardAttentionState();
      setAttentionState(attention);
    } catch (err) {
      console.error("Failed to refresh recommendations:", err);
    } finally {
      setRecommendationsLoading(false);
    }
  };

  const handleRefreshTodos = async () => {
    try {
      const [todosData, countsData] = await Promise.all([
        getTeacherTodos({ status: "open" }),
        getTeacherTodoCounts(),
      ]);
      setTeacherTodos(todosData.todos);
      setTodoCounts(countsData);
    } catch (err) {
      console.error("Failed to refresh todos:", err);
    }
  };

  const _handleAssignmentSubjectChange = async (lessonId: string, subject: string | null) => {
    try {
      await updateLessonSubject(lessonId, subject);
      setLessonMetadata(prev => {
        const next = new Map(prev);
        const existing = prev.get(lessonId) || {};
        next.set(lessonId, { ...existing, subject: subject || undefined });
        return next;
      });
    } catch (err) {
      console.error("Failed to update lesson subject:", err);
      showError("Failed to update subject. Please try again.");
    }
  };

  // Dev-only: Seed demo data
  const handleSeedData = async () => {
    setDevLoading(true);
    try {
      const result = await seedDemoData();
      if (result.success) {
        showSuccess(result.message);
        // Reload the page to show new data
        setTimeout(() => window.location.reload(), 500);
      } else {
        showError(result.error || "Seed failed");
      }
    } catch (err) {
      console.error("Seed failed:", err);
      showError("Failed to seed data");
    } finally {
      setDevLoading(false);
      setDevAction(null);
      setShowDevPanel(false);
    }
  };

  // Dev-only: Remove demo data (preserves user data)
  const handleResetDemoData = async () => {
    setDevLoading(true);
    try {
      const result = await resetDemoData();
      if (result.success) {
        showSuccess(result.message);
        setTimeout(() => window.location.reload(), 500);
      } else {
        showError(result.error || "Reset failed");
      }
    } catch (err) {
      console.error("Reset demo failed:", err);
      showError("Failed to remove demo data");
    } finally {
      setDevLoading(false);
      setDevAction(null);
      setShowDevPanel(false);
    }
  };

  // Dev-only: Reset ALL data (destructive)
  const handleResetAllData = async () => {
    setDevLoading(true);
    try {
      const result = await resetAllData();
      if (result.success) {
        showSuccess(result.message);
        setTimeout(() => window.location.reload(), 500);
      } else {
        showError(result.error || "Reset failed");
      }
    } catch (err) {
      console.error("Reset all failed:", err);
      showError("Failed to reset all data");
    } finally {
      setDevLoading(false);
      setDevAction(null);
      setShowDevPanel(false);
    }
  };

  if (loading) {
    return (
      <div className="loading">
        <div className="loading-spinner"></div>
        <p>Loading dashboard...</p>
      </div>
    );
  }

  if (error || !dashboardData) {
    return (
      <div className="container">
        <div className="card">
          <p style={{ color: "var(--status-danger)" }}>{error || "Failed to load dashboard data."}</p>
          <button className="btn btn-primary" onClick={loadData} style={{ marginTop: "16px" }}>
            Try Again
          </button>
        </div>
      </div>
    );
  }

  const { active, resolved, archivedCount } = dashboardData;

  // Use attention state (single source of truth) for students needing attention
  // This is derived from recommendations with status "active"
  const studentsNeedingAttention: StudentAttentionStatus[] = attentionState?.studentsNeedingAttention || [];

  // Group assignments by class
  const groupAssignmentsByClass = (assignments: ComputedAssignmentState[]): ClassAssignmentGroup[] => {
    const classGroups = new Map<string, ComputedAssignmentState[]>();
    const unassigned: ComputedAssignmentState[] = [];

    for (const assignment of assignments) {
      const classIds = assignmentClassMap.get(assignment.assignmentId) || [];
      if (classIds.length === 0) {
        unassigned.push(assignment);
      } else {
        // Add to each class it's assigned to
        for (const classId of classIds) {
          if (!classGroups.has(classId)) {
            classGroups.set(classId, []);
          }
          classGroups.get(classId)!.push(assignment);
        }
      }
    }

    // Build result with class names
    const result: ClassAssignmentGroup[] = [];

    for (const cls of classes) {
      const clsAssignments = classGroups.get(cls.id);
      if (clsAssignments && clsAssignments.length > 0) {
        result.push({
          classId: cls.id,
          className: cls.name,
          assignments: clsAssignments,
        });
      }
    }

    // Add unassigned at the end if any
    if (unassigned.length > 0) {
      result.push({
        classId: "unassigned",
        className: "Unassigned Lessons",
        assignments: unassigned,
      });
    }

    return result;
  };

  const activeByClass = groupAssignmentsByClass(active);
  const resolvedByClass = groupAssignmentsByClass(resolved);

  // Priority-based grouping for the new list layout
  const prioritizeAssignments = (): {
    needsAttention: PrioritizedAssignment[];
    inProgress: PrioritizedAssignment[];
    awaitingSubmissions: PrioritizedAssignment[];
    reviewed: PrioritizedAssignment[];
  } => {
    const needsAttention: PrioritizedAssignment[] = [];
    const inProgress: PrioritizedAssignment[] = [];
    const awaitingSubmissions: PrioritizedAssignment[] = [];
    const reviewed: PrioritizedAssignment[] = [];

    // Process all active assignments
    for (const group of activeByClass) {
      for (const assignment of group.assignments) {
        // Get attention data
        const assignmentSummary = attentionState?.assignmentSummaries.find(
          (s) => s.assignmentId === assignment.assignmentId
        );
        const attentionCount = assignmentSummary?.needingAttentionCount || assignment.studentsNeedingSupport;

        // Get open todo count for this assignment
        const openTodosForAssignment = teacherTodos.filter(
          (t) => t.assignmentId === assignment.assignmentId && t.status === "open"
        ).length;

        // Check if all completed submissions have been reviewed
        const completedStudents = assignment.studentStatuses.filter(s => s.isComplete);
        const hasCompletedSubmissions = completedStudents.length > 0;
        const allCompletedReviewed = hasCompletedSubmissions &&
          completedStudents.every(s => s.hasTeacherNote);

        // Calculate unreviewed count
        const unreviewed = completedStudents.filter(s => !s.hasTeacherNote).length;

        // Get lesson metadata for filtering
        const metadata = lessonMetadata.get(assignment.assignmentId);

        const prioritizedItem: PrioritizedAssignment = {
          assignment,
          className: group.className,
          classId: group.classId,
          priority: "awaiting-submissions", // Default, will be overwritten
          attentionCount,
          openTodoCount: openTodosForAssignment,
          unreviewed,
          subject: metadata?.subject,
          gradeLevel: metadata?.gradeLevel,
          difficulty: metadata?.difficulty,
        };

        // Determine priority bucket
        const hasActivity = assignment.completedCount > 0 || assignment.inProgressCount > 0;
        const hasAttention = attentionCount > 0 || openTodosForAssignment > 0;

        if (hasAttention) {
          prioritizedItem.priority = "needs-attention";
          needsAttention.push(prioritizedItem);
        } else if (!hasActivity) {
          // No submissions yet
          prioritizedItem.priority = "awaiting-submissions";
          awaitingSubmissions.push(prioritizedItem);
        } else if (!allCompletedReviewed || !assignment.allFlaggedReviewed) {
          // Has submissions but not all reviewed, OR has outstanding flagged items
          prioritizedItem.priority = "in-progress";
          inProgress.push(prioritizedItem);
        } else {
          // All conditions met: has submissions, all reviewed, no outstanding flagged items
          prioritizedItem.priority = "reviewed";
          reviewed.push(prioritizedItem);
        }
      }
    }

    // Process resolved assignments
    for (const group of resolvedByClass) {
      for (const assignment of group.assignments) {
        // Get lesson metadata for filtering
        const metadata = lessonMetadata.get(assignment.assignmentId);

        const prioritizedItem: PrioritizedAssignment = {
          assignment,
          className: group.className,
          classId: group.classId,
          priority: "reviewed",
          attentionCount: 0,
          openTodoCount: 0,
          unreviewed: 0,
          subject: metadata?.subject,
          gradeLevel: metadata?.gradeLevel,
          difficulty: metadata?.difficulty,
        };
        reviewed.push(prioritizedItem);
      }
    }

    // Sort each bucket by attention count (descending) then by title
    const sortByUrgency = (a: PrioritizedAssignment, b: PrioritizedAssignment) => {
      // First by attention count (descending)
      if (b.attentionCount !== a.attentionCount) {
        return b.attentionCount - a.attentionCount;
      }
      // Then by open todos (descending)
      if (b.openTodoCount !== a.openTodoCount) {
        return b.openTodoCount - a.openTodoCount;
      }
      // Then alphabetically by title
      return a.assignment.title.localeCompare(b.assignment.title);
    };

    needsAttention.sort(sortByUrgency);
    inProgress.sort(sortByUrgency);
    awaitingSubmissions.sort((a, b) => a.assignment.title.localeCompare(b.assignment.title));
    reviewed.sort((a, b) => a.assignment.title.localeCompare(b.assignment.title));

    return { needsAttention, inProgress, awaitingSubmissions, reviewed };
  };

  const prioritizedGroups = prioritizeAssignments();

  return (
    <div className="container">
      <EducatorAppHeader
        mode="full"
        teacherName={teacherProfile?.studentFacingName}
        onOpenProfile={() => setProfileDrawerOpen(true)}
        onOpenClasses={() => setOpenDrawer("classes")}
        onOpenCreateLesson={() => setOpenDrawer("create-lesson")}
        searchSlot={
          <div style={{ position: "relative", width: "220px", minWidth: "160px" }}>
            <div style={{ position: "relative" }}>
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={handleSearchChange}
                onFocus={() => setSearchFocused(true)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search..."
                style={{
                  width: "100%",
                  padding: "5px 28px 5px 26px",
                  fontSize: "0.78rem",
                  border: "1px solid rgba(255,255,255,0.18)",
                  borderRadius: "6px",
                  background: "rgba(255,255,255,0.08)",
                  color: "rgba(255,255,255,0.9)",
                  outline: "none",
                  transition: "border-color 0.2s, box-shadow 0.2s, background 0.2s",
                  boxShadow: searchFocused ? "0 0 0 2px rgba(255,255,255,0.1)" : "none",
                  borderColor: searchFocused ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.18)",
                }}
                onMouseEnter={(e) => {
                  if (!searchFocused) {
                    e.currentTarget.style.background = "rgba(255,255,255,0.12)";
                    e.currentTarget.style.borderColor = "rgba(255,255,255,0.22)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!searchFocused) {
                    e.currentTarget.style.background = "rgba(255,255,255,0.08)";
                    e.currentTarget.style.borderColor = "rgba(255,255,255,0.18)";
                  }
                }}
              />
              {/* Search icon */}
              <svg
                style={{
                  position: "absolute",
                  left: "8px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: "12px",
                  height: "12px",
                  color: "rgba(255,255,255,0.5)",
                  pointerEvents: "none",
                }}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <circle cx="11" cy="11" r="8" strokeWidth="2" />
                <path d="M21 21l-4.35-4.35" strokeWidth="2" strokeLinecap="round" />
              </svg>
              {/* Clear button */}
              {searchQuery && (
                <button
                  onClick={() => {
                    setSearchQuery("");
                    setSelectedResultIndex(-1);
                    searchInputRef.current?.focus();
                  }}
                  style={{
                    position: "absolute",
                    right: "4px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    padding: "2px",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    color: "rgba(255,255,255,0.5)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: "4px",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(255,255,255,0.15)";
                    e.currentTarget.style.color = "rgba(255,255,255,0.8)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.color = "rgba(255,255,255,0.5)";
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>

            {/* Search Results Dropdown */}
            {searchFocused && searchQuery.length >= 2 && (
              <div
                ref={searchResultsRef}
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  right: 0,
                  marginTop: "4px",
                  background: "var(--surface-card)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "8px",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
                  maxHeight: "360px",
                  overflowY: "auto",
                  zIndex: 1000,
                  minWidth: "320px",
                }}
              >
                {groupedResults.length === 0 ? (
                  <div
                    style={{
                      padding: "20px 16px",
                      textAlign: "center",
                      color: "var(--text-muted)",
                      fontSize: "0.85rem",
                    }}
                  >
                    No results found
                  </div>
                ) : (
                  groupedResults.map((group) => (
                    <div key={group.type}>
                      {/* Group header */}
                      <div
                        style={{
                          padding: "6px 12px",
                          fontSize: "0.65rem",
                          fontWeight: 600,
                          color: "var(--text-muted)",
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                          background: "var(--surface-muted)",
                          borderBottom: "1px solid var(--border-subtle)",
                        }}
                      >
                        {group.label}
                      </div>
                      {/* Group items */}
                      {group.items.map((result) => {
                        const flatIndex = flatResults.indexOf(result);
                        const isSelected = flatIndex === selectedResultIndex;
                        return (
                          <button
                            key={`${result.type}-${result.id}`}
                            onClick={() => handleSelectResult(result)}
                            onMouseEnter={() => setSelectedResultIndex(flatIndex)}
                            style={{
                              width: "100%",
                              padding: "8px 12px",
                              border: "none",
                              background: isSelected ? "var(--surface-accent)" : "transparent",
                              cursor: "pointer",
                              textAlign: "left",
                              display: "flex",
                              alignItems: "center",
                              gap: "10px",
                              transition: "background 0.1s",
                            }}
                          >
                            {/* Type icon */}
                            <span
                              style={{
                                width: "24px",
                                height: "24px",
                                borderRadius: "5px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: "0.7rem",
                                fontWeight: 600,
                                flexShrink: 0,
                                background:
                                  result.type === "student" ? "var(--status-info-bg)" :
                                  result.type === "assignment" ? "var(--status-success-bg)" :
                                  result.type === "class" ? "var(--status-warning-bg)" :
                                  "var(--status-violet-bg)",
                                color:
                                  result.type === "student" ? "var(--status-info-text)" :
                                  result.type === "assignment" ? "var(--status-success-text)" :
                                  result.type === "class" ? "var(--status-warning-text)" :
                                  "var(--status-violet-text)",
                              }}
                            >
                              {result.type === "student" && (
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                                  <circle cx="12" cy="7" r="4" />
                                </svg>
                              )}
                              {result.type === "assignment" && (
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                  <polyline points="14 2 14 8 20 8" />
                                  <line x1="16" y1="13" x2="8" y2="13" />
                                  <line x1="16" y1="17" x2="8" y2="17" />
                                </svg>
                              )}
                              {result.type === "class" && (
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                                  <circle cx="9" cy="7" r="4" />
                                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                                </svg>
                              )}
                              {result.type === "lesson" && (
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                                </svg>
                              )}
                            </span>
                            {/* Result text */}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div
                                style={{
                                  fontSize: "0.85rem",
                                  fontWeight: 500,
                                  color: "var(--text-primary)",
                                  whiteSpace: "nowrap",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                }}
                              >
                                {result.primary}
                              </div>
                              {result.secondary && (
                                <div
                                  style={{
                                    fontSize: "0.7rem",
                                    color: "var(--text-muted)",
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                  }}
                                >
                                  {result.secondary}
                                </div>
                              )}
                            </div>
                            {/* Arrow icon */}
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="var(--text-muted)"
                              strokeWidth="2"
                              style={{ flexShrink: 0, opacity: isSelected ? 1 : 0.5 }}
                            >
                              <polyline points="9 18 15 12 9 6" />
                            </svg>
                          </button>
                        );
                      })}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        }
      />

      {/* Dev-only controls */}
      {devModeAvailable && (
        <div style={{ position: "relative", marginBottom: "12px" }}>
          <button
            onClick={() => setShowDevPanel(!showDevPanel)}
            style={{
              padding: "4px 10px",
              background: "#4a5568",
              color: "#e2e8f0",
              border: "1px solid #718096",
              borderRadius: "4px",
              fontSize: "0.72rem",
              fontWeight: 500,
              cursor: "pointer",
              fontFamily: "monospace",
            }}
          >
            [DEV]
          </button>

          {/* Dev panel dropdown */}
          {showDevPanel && !devAction && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                marginTop: "4px",
                background: "#2d3748",
                border: "1px solid #4a5568",
                borderRadius: "6px",
                padding: "8px",
                zIndex: 1000,
                minWidth: "180px",
                boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
              }}
            >
              <div style={{ fontSize: "0.72rem", color: "#a0aec0", marginBottom: "8px", fontFamily: "monospace" }}>
                Development Tools
              </div>
              <button
                onClick={() => setDevAction("seed")}
                style={{
                  width: "100%",
                  padding: "6px 10px",
                  background: "#3182ce",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  fontSize: "0.78rem",
                  fontWeight: 500,
                  cursor: "pointer",
                  marginBottom: "6px",
                  textAlign: "left",
                }}
              >
                Seed demo data
              </button>
              <button
                onClick={() => setDevAction("reset-demo")}
                style={{
                  width: "100%",
                  padding: "6px 10px",
                  background: "#dd6b20",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  fontSize: "0.78rem",
                  fontWeight: 500,
                  cursor: "pointer",
                  marginBottom: "6px",
                  textAlign: "left",
                }}
              >
                Remove demo data
              </button>
              <button
                onClick={() => setDevAction("reset-all")}
                style={{
                  width: "100%",
                  padding: "6px 10px",
                  background: "#e53e3e",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  fontSize: "0.78rem",
                  fontWeight: 500,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                ⚠️ Reset ALL data
              </button>
              <button
                onClick={() => setShowDevPanel(false)}
                style={{
                  width: "100%",
                  padding: "4px 10px",
                  background: "transparent",
                  color: "#a0aec0",
                  border: "none",
                  fontSize: "0.72rem",
                  cursor: "pointer",
                  marginTop: "4px",
                  textAlign: "center",
                }}
              >
                Close
              </button>
            </div>
          )}

          {/* Confirmation panel */}
          {devAction && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                marginTop: "4px",
                background:
                  devAction === "reset-all"
                    ? "#742a2a"
                    : devAction === "reset-demo"
                      ? "#7b341e"
                      : "#2a4365",
                border: `1px solid ${devAction === "reset-all" ? "#e53e3e" : devAction === "reset-demo" ? "#dd6b20" : "#3182ce"}`,
                borderRadius: "6px",
                padding: "12px",
                zIndex: 1000,
                minWidth: "280px",
                boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
              }}
            >
              <div style={{ fontWeight: 600, fontSize: "0.85rem", color: "white", marginBottom: "6px" }}>
                {devAction === "seed"
                  ? "Seed demo data?"
                  : devAction === "reset-demo"
                    ? "Remove demo data?"
                    : "⚠️ Reset ALL data?"}
              </div>
              <div style={{ fontSize: "0.78rem", color: "#e2e8f0", marginBottom: "12px", lineHeight: 1.4 }}>
                {devAction === "seed"
                  ? "This will generate realistic test data including students, classes, lessons, assignments, and recommendations."
                  : devAction === "reset-demo"
                    ? "This will remove only seeded demo data (students, classes, lessons with 'demo-' prefix). Your own data will be preserved."
                    : "This will permanently delete ALL data including your own work. This action cannot be undone!"}
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  onClick={
                    devAction === "seed"
                      ? handleSeedData
                      : devAction === "reset-demo"
                        ? handleResetDemoData
                        : handleResetAllData
                  }
                  disabled={devLoading}
                  style={{
                    padding: "6px 12px",
                    background:
                      devAction === "reset-all"
                        ? "#e53e3e"
                        : devAction === "reset-demo"
                          ? "#dd6b20"
                          : "#3182ce",
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    fontSize: "0.78rem",
                    fontWeight: 600,
                    cursor: devLoading ? "not-allowed" : "pointer",
                    opacity: devLoading ? 0.7 : 1,
                  }}
                >
                  {devLoading
                    ? "Working..."
                    : devAction === "seed"
                      ? "Seed data"
                      : devAction === "reset-demo"
                        ? "Remove demo data"
                        : "Delete everything"}
                </button>
                <button
                  onClick={() => {
                    setDevAction(null);
                    setShowDevPanel(false);
                  }}
                  disabled={devLoading}
                  style={{
                    padding: "6px 12px",
                    background: "transparent",
                    color: "#e2e8f0",
                    border: "1px solid #4a5568",
                    borderRadius: "4px",
                    fontSize: "0.78rem",
                    cursor: devLoading ? "not-allowed" : "pointer",
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="header">
        {/* Row 1: Primary Header - Title + Actions */}
        <div style={{ marginBottom: "16px" }}>
          <h1>Your Teaching Hub</h1>
          <p>Student progress, patterns, and recommended actions</p>
        </div>

        {/* Row 2: System Status Indicators */}
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {/* To-Dos Pill */}
          <button
            onClick={() => setOpenDrawer("todos")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 12px",
              background: todoCounts.open > 0 ? "rgba(33,150,243,0.12)" : "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: "20px",
              color: "rgba(255,255,255,0.9)",
              fontSize: "0.8rem",
              cursor: "pointer",
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.15)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = todoCounts.open > 0 ? "rgba(33,150,243,0.12)" : "rgba(255,255,255,0.08)";
            }}
          >
            <span>To-Dos</span>
            <span
              style={{
                background: todoCounts.open > 0 ? "var(--status-info)" : "rgba(255,255,255,0.25)",
                color: todoCounts.open > 0 ? "white" : "rgba(255,255,255,0.7)",
                padding: "2px 7px",
                borderRadius: "10px",
                fontSize: "0.7rem",
                fontWeight: 600,
              }}
            >
              {todoCounts.open}
            </span>
          </button>

          {/* Coach Pill */}
          <button
            onClick={() => setOpenDrawer("coach")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 12px",
              background: coachingActivity.length > 0 || coachingInvites.some(i => i.status !== "completed") ? "rgba(156,39,176,0.12)" : "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: "20px",
              color: "rgba(255,255,255,0.9)",
              fontSize: "0.8rem",
              cursor: "pointer",
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.15)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = coachingActivity.length > 0 || coachingInvites.some(i => i.status !== "completed") ? "rgba(156,39,176,0.12)" : "rgba(255,255,255,0.08)";
            }}
          >
            <span>Coach</span>
            <span
              style={{
                background: coachingActivity.length > 0 || coachingInvites.some(i => i.status !== "completed") ? "var(--accent-secondary)" : "rgba(255,255,255,0.25)",
                color: coachingActivity.length > 0 || coachingInvites.some(i => i.status !== "completed") ? "white" : "rgba(255,255,255,0.7)",
                padding: "2px 7px",
                borderRadius: "10px",
                fontSize: "0.7rem",
                fontWeight: 600,
              }}
            >
              {coachingActivity.length + coachingInvites.filter(i => i.status !== "completed").length}
            </span>
          </button>

          {/* Assignments Pill */}
          {(active.length > 0 || resolved.length > 0) && (
            <button
              onClick={() => setOpenDrawer("assignments")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 12px",
                background: prioritizedGroups.needsAttention.length > 0 ? "rgba(239,68,68,0.15)" : "rgba(255,255,255,0.08)",
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: "20px",
                color: "rgba(255,255,255,0.9)",
                fontSize: "0.8rem",
                cursor: "pointer",
                transition: "all 0.2s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.15)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = prioritizedGroups.needsAttention.length > 0 ? "rgba(239,68,68,0.15)" : "rgba(255,255,255,0.08)";
              }}
            >
              <span>Assignments</span>
              <span
                style={{
                  background: prioritizedGroups.needsAttention.length > 0 ? "var(--status-danger)" : "rgba(255,255,255,0.25)",
                  color: prioritizedGroups.needsAttention.length > 0 ? "white" : "rgba(255,255,255,0.7)",
                  padding: "2px 7px",
                  borderRadius: "10px",
                  fontSize: "0.7rem",
                  fontWeight: 600,
                }}
              >
                {active.length + resolved.length}
              </span>
            </button>
          )}

          {/* Unassigned Lessons Pill */}
          {unassignedLessons.length > 0 && (
            <button
              onClick={() => setOpenDrawer("unassigned")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 12px",
                background: "rgba(33,150,243,0.12)",
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: "20px",
                color: "rgba(255,255,255,0.9)",
                fontSize: "0.8rem",
                cursor: "pointer",
                transition: "all 0.2s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.15)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(33,150,243,0.12)";
              }}
            >
              <span>Unassigned</span>
              <span
                style={{
                  background: "var(--status-info)",
                  color: "white",
                  padding: "2px 7px",
                  borderRadius: "10px",
                  fontSize: "0.7rem",
                  fontWeight: 600,
                }}
              >
                {unassignedLessons.length}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Recommended Actions - Active Recommendations (Primary) */}
      <RecommendationPanel
        recommendations={recommendations}
        students={allStudents}
        onDismiss={handleDismissRecommendation}
        onFeedback={handleRecommendationFeedback}
        onRefresh={handleRefreshRecommendations}
      />

      {/* Primary: Students Needing Attention */}
      {studentsNeedingAttention.length > 0 ? (
        <NeedsAttentionSection
          students={studentsNeedingAttention}
          onNavigate={(studentId, assignmentId) =>
            navigate(`/educator/assignment/${assignmentId}/student/${studentId}`)
          }
        />
      ) : (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "14px 18px",
            background: "rgba(255, 255, 255, 0.95)",
            borderRadius: "10px",
            color: "var(--status-success-text)",
            fontSize: "0.9rem",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          }}
        >
          <span style={{ fontWeight: 500 }}>All students on track — no one needs attention right now</span>
        </div>
      )}



      {/* Add Student Modal */}
      {addStudentModal && (
        <AddStudentModal
          assignmentId={addStudentModal.assignmentId}
          assignmentTitle={addStudentModal.assignmentTitle}
          classes={classes}
          allStudents={allStudents}
          onClose={() => setAddStudentModal(null)}
          onSuccess={() => {
            setAddStudentModal(null);
            loadData();
          }}
        />
      )}

      {/* Teacher To-Dos Drawer */}
      <Drawer
        isOpen={openDrawer === "todos"}
        onClose={() => setOpenDrawer(null)}
        title="Teacher To-Dos"
        width="520px"
        headerActions={
          <button
            onClick={() => navigate("/educator/todos/print")}
            style={{
              padding: "4px 10px",
              background: "transparent",
              color: "var(--accent-primary)",
              border: "1px solid var(--accent-primary)",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "0.8rem",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            Print
          </button>
        }
      >
        <TeacherTodosPanel
          todos={teacherTodos}
          counts={todoCounts}
          onRefresh={async () => {
            // Refresh both todos and recommendations (in case todo was moved back)
            await Promise.all([handleRefreshTodos(), handleRefreshRecommendations()]);
          }}
          embedded={true}
        />
      </Drawer>

      {/* Coach Activity Drawer */}
      <Drawer
        isOpen={openDrawer === "coach"}
        onClose={() => setOpenDrawer(null)}
        title="Coach Activity"
        width="520px"
      >
        <CoachingActivityDrawerContent
          activities={coachingActivity}
          coachingInvites={coachingInvites}
          allStudents={allStudents}
          onNavigate={(studentId) => {
            setOpenDrawer(null);
            navigate(`/educator/student/${studentId}`);
          }}
          onDismissInvite={async (inviteId) => {
            try {
              await dismissCoachingInvite(inviteId);
              setCoachingInvites((prev) => prev.filter((inv) => inv.id !== inviteId));
              showSuccess("Session removed.");
            } catch {
              showError("Failed to remove session. Please try again.");
            }
          }}
        />
      </Drawer>

      {/* Assignments Drawer */}
      <Drawer
        isOpen={openDrawer === "assignments"}
        onClose={() => setOpenDrawer(null)}
        title="Assignments"
        width="560px"
      >
        <AssignmentsDrawerContent
          prioritizedGroups={prioritizedGroups}
          onNavigate={(assignmentId, classId, className) => {
            setOpenDrawer(null);
            navigate(`/educator/assignment/${assignmentId}`, {
              state: { fromClass: classId, className }
            });
          }}
          archivedCount={archivedCount}
          onViewArchived={() => {
            setOpenDrawer(null);
            navigate("/educator/archived");
          }}
          filters={assignmentFilters}
          onClearFilters={() => setAssignmentFilters({})}
          onUpdateFilters={setAssignmentFilters}
        />
      </Drawer>

      {/* Unassigned Lessons Drawer */}
      <Drawer
        isOpen={openDrawer === "unassigned"}
        onClose={() => setOpenDrawer(null)}
        title="Unassigned Lessons"
        width="520px"
      >
        <UnassignedLessonsDrawerContent
          lessons={unassignedLessons}
          drafts={lessonDrafts}
          availableSubjects={[...new Set(classes.flatMap(c => c.subjects || []))]}
          onAssign={(lessonId) => {
            const lesson = unassignedLessons.find(l => l.id === lessonId);
            if (lesson) {
              setAssigningLesson(lesson);
              setOpenDrawer("assign-lesson");
            }
          }}
          onEdit={(lessonId) => {
            setOpenDrawer(null);
            navigate(`/educator/lesson/${lessonId}/edit`);
          }}
          onArchive={handleArchiveUnassignedLesson}
          onDelete={handleDeleteUnassignedLesson}
          onSubjectChange={async (lessonId, subject) => {
            try {
              await updateLessonSubject(lessonId, subject);
              setUnassignedLessons(prev =>
                prev.map(l => l.id === lessonId ? { ...l, subject: subject || undefined } : l)
              );
            } catch (err) {
              console.error("Failed to update lesson subject:", err);
              showError("Failed to update subject. Please try again.");
            }
          }}
          onContinueDraft={(draft) => {
            setEditingDraft(draft);
            setOpenDrawer("create-lesson");
          }}
          onDeleteDraft={async (draftId) => {
            try {
              await deleteLessonDraft(draftId);
              setLessonDrafts(prev => prev.filter(d => d.id !== draftId));
              showSuccess("Draft deleted");
            } catch (err) {
              console.error("Failed to delete draft:", err);
              showError("Failed to delete draft. Please try again.");
            }
          }}
        />
      </Drawer>

      {/* My Classes Drawer */}
      <Drawer
        isOpen={openDrawer === "classes"}
        onClose={() => setOpenDrawer(null)}
        title="My Classes"
        width="520px"
      >
        <ClassesDrawerContent
          classes={classes}
          onClassesChange={reloadClasses}
          onNavigateToClass={(classId) => {
            setOpenDrawer(null);
            navigate(`/educator/class/${classId}`);
          }}
          onNavigateToStudent={(studentId, classId, className) => {
            setOpenDrawer(null);
            navigate(`/educator/student/${studentId}`, {
              state: { fromClass: classId, className, fromDrawer: "classes" }
            });
          }}
        />
      </Drawer>

      {/* Create Lesson Drawer */}
      <Drawer
        isOpen={openDrawer === "create-lesson"}
        onClose={() => {
          setOpenDrawer(null);
          setEditingDraft(null);
        }}
        title={editingDraft ? "Continue Draft" : "Create Lesson"}
        width="520px"
      >
        <CreateLessonDrawerContent
          onClose={() => {
            setOpenDrawer(null);
            setEditingDraft(null);
          }}
          onLessonCreated={(lessonId: string) => {
            setOpenDrawer(null);
            setEditingDraft(null);
            // Reload drafts in case one was deleted
            getLessonDrafts().then(data => setLessonDrafts(data.drafts)).catch(console.error);
            navigate(`/educator/lesson/${lessonId}/edit`, { state: { justCreated: true } });
          }}
          classes={classes}
          editingDraft={editingDraft}
          onDraftSaved={() => {
            // Reload drafts when saved
            getLessonDrafts().then(data => setLessonDrafts(data.drafts)).catch(console.error);
          }}
        />
      </Drawer>

      {/* Assign Lesson Drawer */}
      <Drawer
        isOpen={openDrawer === "assign-lesson"}
        onClose={() => {
          setOpenDrawer("unassigned");
          setAssigningLesson(null);
        }}
        title={assigningLesson ? `Assign: ${assigningLesson.title}` : "Assign Lesson"}
        width="520px"
      >
        {assigningLesson && (
          <AssignLessonDrawerContent
            lesson={assigningLesson}
            classes={classes}
            onCancel={() => {
              setOpenDrawer("unassigned");
              setAssigningLesson(null);
            }}
            onAssigned={() => {
              // Reload unassigned lessons
              getUnassignedLessons().then(data => setUnassignedLessons(data)).catch(console.error);
              setOpenDrawer(null);
              setAssigningLesson(null);
            }}
          />
        )}
      </Drawer>

      {/* Teacher Profile Drawer */}
      <TeacherProfileDrawer
        isOpen={profileDrawerOpen}
        onClose={() => setProfileDrawerOpen(false)}
        onProfileUpdated={(updated) => setTeacherProfile(updated)}
      />
    </div>
  );
}

// ============================================
// Needs Attention Section
// ============================================

interface NeedsAttentionSectionProps {
  students: StudentAttentionStatus[];
  onNavigate: (studentId: string, assignmentId: string) => void;
}

function NeedsAttentionSection({ students, onNavigate }: NeedsAttentionSectionProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Group by student to avoid showing same student multiple times
  const uniqueStudents = students.reduce((acc, student) => {
    if (!acc.find((s) => s.studentId === student.studentId)) {
      acc.push(student);
    }
    return acc;
  }, [] as StudentAttentionStatus[]);

  // Show max 5 on dashboard, or all if expanded
  const displayStudents = isExpanded ? uniqueStudents : uniqueStudents.slice(0, 5);
  const hasMore = uniqueStudents.length > 5;

  return (
    <div
      className="card"
      style={{
        background: "var(--status-pending-bg)",
        borderLeft: "4px solid var(--status-pending)",
      }}
    >
      <div style={{ marginBottom: "16px" }}>
        <h3 style={{ margin: 0, color: "var(--status-pending-text)" }}>
          {uniqueStudents.length} student{uniqueStudents.length !== 1 ? "s" : ""} need attention today
        </h3>
        <p style={{ margin: 0, color: "#666", marginTop: "4px" }}>
          Students who may need a check-in or additional support
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {displayStudents.map((student) => (
          <div
            key={`${student.studentId}-${student.assignmentId}`}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 16px",
              background: "white",
              borderRadius: "8px",
              cursor: "pointer",
              transition: "transform 0.1s, box-shadow 0.1s",
            }}
            onClick={() => onNavigate(student.studentId, student.assignmentId)}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateX(4px)";
              e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.1)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateX(0)";
              e.currentTarget.style.boxShadow = "none";
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "16px", minWidth: 0, flex: 1 }}>
              <span style={{ fontWeight: 600, color: "#333", flexShrink: 0 }}>{student.studentName}</span>
              {student.assignmentTitle && (
                <span style={{
                  color: "#666",
                  fontSize: "0.9rem",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  minWidth: 0,
                }}>{student.assignmentTitle}</span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", flexShrink: 0 }}>
              {student.attentionReason && (
                <span
                  style={{
                    fontSize: "0.85rem",
                    color: "var(--status-pending-text)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {student.attentionReason}
                </span>
              )}
              <span style={{ color: "var(--status-pending)" }}>→</span>
            </div>
          </div>
        ))}
      </div>

      {hasMore && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          style={{
            display: "block",
            width: "100%",
            marginTop: "12px",
            padding: "8px 16px",
            background: "transparent",
            border: "1px solid var(--status-warning)",
            borderRadius: "6px",
            color: "var(--status-pending-text)",
            fontSize: "0.9rem",
            cursor: "pointer",
            transition: "background 0.2s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--status-warning-bg)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
        >
          {isExpanded
            ? "Show less"
            : `Show ${uniqueStudents.length - 5} more student${uniqueStudents.length - 5 !== 1 ? "s" : ""}`}
        </button>
      )}
    </div>
  );
}

// ============================================
// Priority-Based Assignment List
// ============================================

type AssignmentPriority = "needs-attention" | "in-progress" | "awaiting-submissions" | "reviewed";

interface PrioritizedAssignment {
  assignment: ComputedAssignmentState;
  className: string;
  classId: string;
  priority: AssignmentPriority;
  attentionCount: number;
  openTodoCount: number;
  unreviewed: number;
  // Lesson metadata for filtering
  subject?: string;
  gradeLevel?: string;
  difficulty?: string;
}

interface AssignmentListRowProps {
  item: PrioritizedAssignment;
  onNavigate: () => void;
}

function AssignmentListRow({ item, onNavigate }: AssignmentListRowProps) {
  const { assignment, className, priority } = item;
  const { title, assignedAt } = assignment;

  // Status dot color only - no text labels
  // Orange = needs attention, Gray = awaiting, Green = on track/reviewed
  const getDotColor = () => {
    switch (priority) {
      case "needs-attention":
        return "#f59e0b"; // Orange
      case "awaiting-submissions":
        return "#94a3b8"; // Gray
      case "in-progress":
      case "reviewed":
        return "#10b981"; // Green (on track)
    }
  };

  // Single, simple CTA
  const getCTA = () => {
    switch (priority) {
      case "needs-attention":
        return "Review";
      case "in-progress":
        return "Review";
      case "awaiting-submissions":
        return "View";
      case "reviewed":
        return "View";
    }
  };

  // Format date as "Assigned Jan 12"
  const formatAssignedDate = (isoDate: string | undefined): string | null => {
    if (!isoDate) return null;
    const date = new Date(isoDate);
    const month = date.toLocaleDateString("en-US", { month: "short" });
    const day = date.getDate();
    return `Assigned ${month} ${day}`;
  };

  const assignedDateText = formatAssignedDate(assignedAt);

  return (
    <div
      onClick={onNavigate}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "16px",
        padding: "16px 20px",
        background: "rgba(255, 255, 255, 0.95)",
        borderBottom: "1px solid rgba(0, 0, 0, 0.06)",
        cursor: "pointer",
        transition: "background 0.15s",
        height: "64px",
        boxSizing: "border-box",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(255, 255, 255, 1)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "rgba(255, 255, 255, 0.95)";
      }}
    >
      {/* Status dot - visual indicator only */}
      <div
        title={priority === "needs-attention" ? "Needs attention" : priority === "awaiting-submissions" ? "Awaiting submissions" : "On track"}
        style={{
          width: "10px",
          height: "10px",
          borderRadius: "50%",
          background: getDotColor(),
          flexShrink: 0,
        }}
      />

      {/* Title and metadata stacked */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Assignment title (primary) */}
        <div
          style={{
            fontSize: "1rem",
            fontWeight: 600,
            color: "#1e293b",
            lineHeight: 1.3,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {title}
        </div>
        {/* Class name + assigned date (secondary) */}
        <div
          style={{
            fontSize: "0.85rem",
            color: "#64748b",
            marginTop: "2px",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {className}{assignedDateText && ` · ${assignedDateText}`}
        </div>
      </div>

      {/* Single primary action */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onNavigate();
        }}
        style={{
          flex: "0 0 auto",
          padding: "8px 20px",
          background: priority === "needs-attention" ? "#667eea" : "transparent",
          color: priority === "needs-attention" ? "white" : "#667eea",
          border: priority === "needs-attention" ? "none" : "1px solid #cbd5e1",
          borderRadius: "6px",
          fontSize: "0.875rem",
          fontWeight: 500,
          cursor: "pointer",
          whiteSpace: "nowrap",
          transition: "all 0.15s",
        }}
        onMouseEnter={(e) => {
          if (priority !== "needs-attention") {
            e.currentTarget.style.background = "#f8fafc";
            e.currentTarget.style.borderColor = "#667eea";
          }
        }}
        onMouseLeave={(e) => {
          if (priority !== "needs-attention") {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.borderColor = "#cbd5e1";
          }
        }}
      >
        {getCTA()}
      </button>
    </div>
  );
}

interface AssignmentListSectionProps {
  title: string;
  items: PrioritizedAssignment[];
  onNavigate: (assignmentId: string, classId: string, className: string) => void;
  isCollapsible?: boolean;
  defaultExpanded?: boolean;
}

function _AssignmentListSection({
  title,
  items,
  onNavigate,
  isCollapsible = false,
  defaultExpanded = true,
}: AssignmentListSectionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  if (items.length === 0) return null;

  return (
    <div style={{ marginBottom: "24px" }}>
      {/* Section header */}
      <div
        onClick={isCollapsible ? () => setIsExpanded(!isExpanded) : undefined}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          marginBottom: "8px",
          cursor: isCollapsible ? "pointer" : "default",
        }}
      >
        {isCollapsible && (
          <span
            style={{
              color: "rgba(255,255,255,0.6)",
              fontSize: "0.8rem",
              transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform 0.2s",
            }}
          >
            ▶
          </span>
        )}
        <h3
          style={{
            margin: 0,
            color: "rgba(255,255,255,0.9)",
            fontSize: "1rem",
            fontWeight: 600,
          }}
        >
          {title}
        </h3>
        <span
          style={{
            color: "rgba(255,255,255,0.5)",
            fontSize: "0.85rem",
          }}
        >
          ({items.length})
        </span>
      </div>

      {/* List container */}
      {(!isCollapsible || isExpanded) && (
        <div
          style={{
            borderRadius: "12px",
            overflow: "hidden",
            boxShadow: "0 1px 3px rgba(0, 0, 0, 0.08)",
          }}
        >
          {items.map((item) => (
            <AssignmentListRow
              key={`${item.classId}-${item.assignment.assignmentId}`}
              item={item}
              onNavigate={() => onNavigate(item.assignment.assignmentId, item.classId, item.className)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================
// Coaching Activity Section
// ============================================

interface CoachingActivitySectionProps {
  activities: StudentCoachingActivity[];
  onNavigate: (studentId: string) => void;
}

function _CoachingActivitySection({ activities, onNavigate }: CoachingActivitySectionProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Show support-seeking students prominently
  const supportSeeking = activities.filter((a) => a.insight.intentLabel === "support-seeking");
  const others = activities.filter((a) => a.insight.intentLabel !== "support-seeking");

  // When collapsed: show max 5 total (support-seeking first)
  // When expanded: show all
  const sortedActivities = [...supportSeeking, ...others];
  const displayActivities = isExpanded
    ? sortedActivities
    : [...supportSeeking.slice(0, 3), ...others.slice(0, Math.max(0, 5 - Math.min(3, supportSeeking.length)))];
  const hasMore = activities.length > 5;

  return (
    <div
      className="card"
      style={{
        marginTop: "16px",
        background: "var(--status-violet-bg)",
        borderLeft: "4px solid var(--accent-secondary)",
      }}
    >
      <div style={{ marginBottom: "16px" }}>
        <h3 style={{ margin: 0, color: "var(--accent-secondary)" }}>
          Coach Activity
        </h3>
        <p style={{ margin: 0, color: "#666", marginTop: "4px" }}>
          Students who have been using Ask Coach
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {displayActivities.map((activity) => (
          <div
            key={activity.studentId}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 16px",
              background: "white",
              borderRadius: "8px",
              cursor: "pointer",
              transition: "transform 0.1s, box-shadow 0.1s",
            }}
            onClick={() => onNavigate(activity.studentId)}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateX(4px)";
              e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.1)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateX(0)";
              e.currentTarget.style.boxShadow = "none";
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div>
                <span style={{ fontWeight: 600, color: "#333" }}>{activity.studentName}</span>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <span
                style={{
                  fontSize: "0.85rem",
                  fontWeight: 500,
                  padding: "2px 8px",
                  borderRadius: "4px",
                  background:
                    activity.insight.intentLabel === "support-seeking"
                      ? "var(--status-pending-bg)"
                      : activity.insight.intentLabel === "enrichment-seeking"
                      ? "var(--status-success-bg)"
                      : "var(--surface-muted)",
                  color:
                    activity.insight.intentLabel === "support-seeking"
                      ? "var(--status-pending-text)"
                      : activity.insight.intentLabel === "enrichment-seeking"
                      ? "var(--status-success-text)"
                      : "#666",
                }}
              >
                {activity.insight.intentLabel === "support-seeking"
                  ? "Support-Seeking"
                  : activity.insight.intentLabel === "enrichment-seeking"
                  ? "Enrichment-Seeking"
                  : "Mixed"}
              </span>
              <span style={{ color: "var(--accent-secondary)" }}>→</span>
            </div>
          </div>
        ))}
      </div>

      {hasMore && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          style={{
            display: "block",
            width: "100%",
            marginTop: "12px",
            padding: "8px 16px",
            background: "transparent",
            border: "1px solid var(--accent-secondary)",
            borderRadius: "6px",
            color: "var(--accent-secondary)",
            fontSize: "0.9rem",
            cursor: "pointer",
            transition: "background 0.2s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--status-violet-bg)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
        >
          {isExpanded
            ? "Show less"
            : `Show ${activities.length - 5} more student${activities.length - 5 !== 1 ? "s" : ""}`}
        </button>
      )}

      {displayActivities.length > 0 && displayActivities.some((a) => a.insight.recentTopics.length > 0) && (
        <div style={{ marginTop: "12px", fontSize: "0.85rem", color: "#666" }}>
          Recent topics: {[...new Set(displayActivities.flatMap((a) => a.insight.recentTopics))].slice(0, 5).join(", ")}
        </div>
      )}
    </div>
  );
}

// ============================================
// Add Student Modal
// ============================================

interface AddStudentModalProps {
  assignmentId: string;
  assignmentTitle: string;
  classes: ClassSummary[];
  allStudents: Student[];
  onClose: () => void;
  onSuccess: () => void;
}

function AddStudentModal({
  assignmentId,
  assignmentTitle,
  classes,
  onClose,
  onSuccess,
}: AddStudentModalProps) {
  const { showError } = useToast();
  const [selectedStudents, setSelectedStudents] = useState<Set<string>>(new Set());
  const [assignedStudentIds, setAssignedStudentIds] = useState<Set<string>>(new Set());
  const [classesWithStudents, setClassesWithStudents] = useState<ClassWithStudents[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Load already assigned students and full class data
  useEffect(() => {
    async function loadData() {
      try {
        const [assignedData, ...classDataList] = await Promise.all([
          getAssignedStudents(assignmentId),
          ...classes.map((c) => getClass(c.id)),
        ]);
        setAssignedStudentIds(new Set(assignedData.studentIds));
        setClassesWithStudents(classDataList);
      } catch (err) {
        console.error("Failed to load data:", err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [assignmentId, classes]);

  const handleToggleStudent = (studentId: string) => {
    setSelectedStudents((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) {
        next.delete(studentId);
      } else {
        next.add(studentId);
      }
      return next;
    });
  };

  const handleSave = async () => {
    if (selectedStudents.size === 0) return;

    setSaving(true);
    try {
      // Group selected students by class
      const studentsByClass = new Map<string, string[]>();

      for (const studentId of selectedStudents) {
        // Find which class this student belongs to
        for (const cls of classesWithStudents) {
          if (cls.students.some((s) => s.id === studentId)) {
            if (!studentsByClass.has(cls.id)) {
              studentsByClass.set(cls.id, []);
            }
            studentsByClass.get(cls.id)!.push(studentId);
            break;
          }
        }
      }

      // Assign students to the lesson by class
      for (const [classId, studentIds] of studentsByClass) {
        await assignLessonToClass(assignmentId, classId, studentIds);
      }

      onSuccess();
    } catch (err) {
      console.error("Failed to add students:", err);
      showError("Failed to add students. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // Get unassigned students grouped by class
  const unassignedByClass = classesWithStudents.map((cls) => ({
    ...cls,
    unassignedStudents: cls.students.filter((s) => !assignedStudentIds.has(s.id)),
  })).filter((cls) => cls.unassignedStudents.length > 0);

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "white",
          borderRadius: "8px",
          padding: "24px",
          maxWidth: "500px",
          width: "90%",
          maxHeight: "80vh",
          overflow: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <h2 style={{ margin: 0, color: "#333" }}>Add Students</h2>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: "1.5rem",
              cursor: "pointer",
              color: "#999",
            }}
          >
            ×
          </button>
        </div>

        <p style={{ color: "#666", marginBottom: "16px" }}>
          Add students to <strong>{assignmentTitle}</strong>
        </p>

        {loading ? (
          <p style={{ color: "#666" }}>Loading...</p>
        ) : unassignedByClass.length === 0 ? (
          <p style={{ color: "#666" }}>All students are already assigned to this lesson.</p>
        ) : (
          <>
            {unassignedByClass.map((cls) => (
              <div key={cls.id} style={{ marginBottom: "16px" }}>
                <h4 style={{ margin: "0 0 8px 0", color: "var(--accent-primary)" }}>{cls.name}</h4>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {cls.unassignedStudents.map((student) => (
                    <label
                      key={student.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "8px 12px",
                        background: selectedStudents.has(student.id) ? "var(--surface-accent-tint)" : "var(--surface-muted)",
                        borderRadius: "8px",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedStudents.has(student.id)}
                        onChange={() => handleToggleStudent(student.id)}
                      />
                      <span>{student.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}

        <div style={{ display: "flex", gap: "12px", marginTop: "24px" }}>
          <button
            onClick={onClose}
            className="btn btn-secondary"
            style={{ flex: 1 }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="btn btn-primary"
            style={{ flex: 1 }}
            disabled={selectedStudents.size === 0 || saving}
          >
            {saving ? "Adding..." : `Add ${selectedStudents.size} Student${selectedStudents.size !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Unassigned Lessons Section
// ============================================

interface UnassignedLessonsSectionProps {
  lessons: LessonSummary[];
  availableSubjects: string[];
  onAssign: (lessonId: string) => void;
  onArchive: (lessonId: string, title: string) => void;
  onSubjectChange: (lessonId: string, subject: string | null) => Promise<void>;
}

function _UnassignedLessonsSection({ lessons, availableSubjects, onAssign, onArchive, onSubjectChange }: UnassignedLessonsSectionProps) {
  const [editingSubject, setEditingSubject] = useState<string | null>(null);
  const [subjectValue, setSubjectValue] = useState("");
  const [originalValue, setOriginalValue] = useState("");

  const handleStartEditSubject = (lessonId: string, currentSubject?: string) => {
    setEditingSubject(lessonId);
    setSubjectValue(currentSubject || "");
    setOriginalValue(currentSubject || "");
  };

  const handleSaveSubject = async (lessonId: string) => {
    const newValue = subjectValue.trim() || null;
    const oldValue = originalValue.trim() || null;

    // Only save if value actually changed
    if (newValue !== oldValue) {
      await onSubjectChange(lessonId, newValue);
    }
    setEditingSubject(null);
    setSubjectValue("");
    setOriginalValue("");
  };

  return (
    <div
      className="card"
      style={{
        marginTop: "16px",
        background: "var(--status-info-bg)",
        borderLeft: "4px solid var(--status-info)",
      }}
    >
      <div style={{ marginBottom: "16px" }}>
        <h3 style={{ margin: 0, color: "var(--status-info-text)" }}>
          Unassigned Lessons ({lessons.length})
        </h3>
        <p style={{ margin: 0, color: "#666", marginTop: "4px" }}>
          Lessons created but not yet assigned to any class
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {lessons.map((lesson) => (
          <div
            key={lesson.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 16px",
              background: "white",
              borderRadius: "8px",
              flexWrap: "wrap",
              gap: "8px",
            }}
          >
            <div style={{ flex: 1, minWidth: "200px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                <span style={{ fontWeight: 600, color: "#333" }}>{lesson.title}</span>
                <span
                  style={{
                    fontSize: "0.75rem",
                    padding: "2px 8px",
                    borderRadius: "4px",
                    background: lesson.difficulty === "beginner" ? "var(--status-success-bg)" :
                               lesson.difficulty === "intermediate" ? "var(--status-pending-bg)" : "var(--status-danger-bg)",
                    color: lesson.difficulty === "beginner" ? "var(--status-success-text)" :
                           lesson.difficulty === "intermediate" ? "var(--status-warning-text)" : "var(--status-danger)",
                  }}
                >
                  {lesson.difficulty}
                </span>
              </div>
              <p style={{ margin: 0, marginTop: "4px", color: "#666", fontSize: "0.85rem" }}>
                {lesson.promptCount} question{lesson.promptCount !== 1 ? "s" : ""}
                {lesson.gradeLevel && ` • ${lesson.gradeLevel}`}
              </p>
            </div>

            {/* Subject Assignment */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              {editingSubject === lesson.id ? (
                <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <input
                    type="text"
                    list={`subjects-${lesson.id}`}
                    value={subjectValue}
                    onChange={(e) => setSubjectValue(e.target.value)}
                    placeholder="Enter subject..."
                    style={{
                      padding: "4px 8px",
                      border: "1px solid var(--status-info)",
                      borderRadius: "4px",
                      fontSize: "0.85rem",
                      width: "140px",
                    }}
                    autoFocus
                    onBlur={() => handleSaveSubject(lesson.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.currentTarget.blur();
                      } else if (e.key === "Escape") {
                        setSubjectValue(originalValue);
                        setEditingSubject(null);
                      }
                    }}
                  />
                  <datalist id={`subjects-${lesson.id}`}>
                    {availableSubjects.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </div>
              ) : (
                <button
                  onClick={() => handleStartEditSubject(lesson.id, lesson.subject)}
                  style={{
                    padding: "4px 10px",
                    background: lesson.subject ? "var(--status-info-bg)" : "transparent",
                    color: lesson.subject ? "var(--status-info-text)" : "#999",
                    border: "1px dashed var(--status-info)",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "0.8rem",
                    transition: "all 0.2s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "var(--status-info)";
                    e.currentTarget.style.background = "var(--status-info-bg)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--status-info)";
                    e.currentTarget.style.background = lesson.subject ? "var(--status-info-bg)" : "transparent";
                  }}
                  title={lesson.subject ? "Click to change subject" : "Click to assign a subject"}
                >
                  {lesson.subject || "+ Subject"}
                </button>
              )}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <button
                onClick={() => onAssign(lesson.id)}
                style={{
                  padding: "6px 12px",
                  background: "var(--status-info)",
                  color: "white",
                  border: "none",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                  fontWeight: 500,
                  transition: "background 0.2s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--status-info-text)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "var(--status-info)";
                }}
              >
                Assign
              </button>
              <button
                onClick={() => onArchive(lesson.id, lesson.title)}
                style={{
                  padding: "6px 12px",
                  background: "transparent",
                  color: "#999",
                  border: "1px solid #ddd",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                  transition: "color 0.2s, border-color 0.2s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "#666";
                  e.currentTarget.style.borderColor = "#bbb";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "#999";
                  e.currentTarget.style.borderColor = "#ddd";
                }}
              >
                Archive
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================
// Unassigned Lessons Drawer Content (Embedded)
// ============================================

interface UnassignedLessonsDrawerContentProps {
  lessons: LessonSummary[];
  drafts: LessonDraft[];
  availableSubjects: string[];
  onAssign: (lessonId: string) => void;
  onEdit: (lessonId: string) => void;
  onArchive: (lessonId: string, title: string) => void;
  onDelete: (lessonId: string, title: string) => void;
  onSubjectChange: (lessonId: string, subject: string | null) => Promise<void>;
  onContinueDraft: (draft: LessonDraft) => void;
  onDeleteDraft: (draftId: string) => void;
}

function UnassignedLessonsDrawerContent({
  lessons,
  drafts,
  availableSubjects,
  onAssign,
  onEdit,
  onArchive,
  onDelete,
  onSubjectChange,
  onContinueDraft,
  onDeleteDraft,
}: UnassignedLessonsDrawerContentProps) {
  const [editingSubject, setEditingSubject] = useState<string | null>(null);
  const [subjectValue, setSubjectValue] = useState("");
  const [originalValue, setOriginalValue] = useState("");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmDeleteDraft, setConfirmDeleteDraft] = useState<string | null>(null);

  useEffect(() => {
    const handleClickOutside = () => setOpenMenuId(null);
    if (openMenuId) {
      document.addEventListener("click", handleClickOutside);
      return () => document.removeEventListener("click", handleClickOutside);
    }
  }, [openMenuId]);

  const handleStartEditSubject = (lessonId: string, currentSubject?: string) => {
    setEditingSubject(lessonId);
    setSubjectValue(currentSubject || "");
    setOriginalValue(currentSubject || "");
  };

  const handleSaveSubject = async (lessonId: string) => {
    const newValue = subjectValue.trim() || null;
    const oldValue = originalValue.trim() || null;

    if (newValue !== oldValue) {
      await onSubjectChange(lessonId, newValue);
    }
    setEditingSubject(null);
    setSubjectValue("");
    setOriginalValue("");
  };

  if (lessons.length === 0 && drafts.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "32px 16px", color: "#666" }}>
        {/* Empty state indicator */}
        <p style={{ margin: 0, fontWeight: 500 }}>No unassigned lessons or drafts</p>
        <p style={{ margin: "8px 0 0 0", fontSize: "0.9rem" }}>
          Create a lesson to get started.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Drafts Section */}
      {drafts.length > 0 && (
        <div style={{ marginBottom: lessons.length > 0 ? "24px" : 0 }}>
          <h4 style={{ margin: "0 0 12px 0", fontSize: "0.9rem", fontWeight: 600, color: "#64748b" }}>
            Drafts ({drafts.length})
          </h4>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {drafts.map((draft) => (
              <div
                key={draft.id}
                style={{
                  padding: "14px 16px",
                  background: "var(--status-pending-bg)",
                  borderRadius: "8px",
                  border: "1px solid var(--status-pending-text)",
                  borderLeftWidth: "3px",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, color: "#374151" }}>
                      {draft.title || "Untitled lesson"}
                    </div>
                    <div style={{ fontSize: "0.8rem", color: "#64748b", marginTop: "4px" }}>
                      {[draft.subject, draft.gradeLevel ? `Grade ${draft.gradeLevel}` : null]
                        .filter(Boolean)
                        .join(" · ") || "No subject set"}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "#94a3b8", marginTop: "4px" }}>
                      Last edited {new Date(draft.updatedAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
                    <button
                      onClick={() => onContinueDraft(draft)}
                      style={{
                        padding: "6px 12px",
                        fontSize: "0.8rem",
                        background: "var(--accent-primary)",
                        color: "white",
                        border: "none",
                        borderRadius: "6px",
                        cursor: "pointer",
                      }}
                    >
                      Continue
                    </button>
                    {confirmDeleteDraft === draft.id ? (
                      <div style={{ display: "flex", gap: "4px" }}>
                        <button
                          onClick={() => {
                            onDeleteDraft(draft.id);
                            setConfirmDeleteDraft(null);
                          }}
                          style={{
                            padding: "6px 10px",
                            fontSize: "0.75rem",
                            background: "var(--status-danger)",
                            color: "white",
                            border: "none",
                            borderRadius: "4px",
                            cursor: "pointer",
                          }}
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => setConfirmDeleteDraft(null)}
                          style={{
                            padding: "6px 10px",
                            fontSize: "0.75rem",
                            background: "#e5e7eb",
                            color: "#374151",
                            border: "none",
                            borderRadius: "4px",
                            cursor: "pointer",
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteDraft(draft.id)}
                        style={{
                          padding: "6px 10px",
                          fontSize: "0.8rem",
                          background: "transparent",
                          color: "#94a3b8",
                          border: "1px solid #e5e7eb",
                          borderRadius: "6px",
                          cursor: "pointer",
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ready to Assign Section */}
      {lessons.length > 0 && (
        <>
          <h4 style={{ margin: "0 0 12px 0", fontSize: "0.9rem", fontWeight: 600, color: "#64748b" }}>
            Ready to Assign ({lessons.length})
          </h4>

      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {lessons.map((lesson) => (
          <div
            key={lesson.id}
            style={{
              padding: "14px 16px",
              background: "var(--surface-muted)",
              borderRadius: "8px",
              border: "1px solid var(--border-muted)",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                  <button
                    onClick={() => onEdit(lesson.id)}
                    style={{
                      fontWeight: 600,
                      color: "var(--accent-primary)",
                      background: "none",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      fontSize: "inherit",
                      textAlign: "left",
                      textDecoration: "underline",
                      textDecorationStyle: "dotted",
                      textUnderlineOffset: "2px",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.textDecorationStyle = "solid")}
                    onMouseLeave={(e) => (e.currentTarget.style.textDecorationStyle = "dotted")}
                    title="Click to view and edit questions"
                  >
                    {lesson.title}
                  </button>
                  <span
                    style={{
                      fontSize: "0.7rem",
                      padding: "2px 6px",
                      borderRadius: "4px",
                      background: lesson.difficulty === "beginner" ? "var(--status-success-bg)" :
                                 lesson.difficulty === "intermediate" ? "var(--status-pending-bg)" : "var(--status-danger-bg)",
                      color: lesson.difficulty === "beginner" ? "var(--status-success-text)" :
                             lesson.difficulty === "intermediate" ? "var(--status-warning-text)" : "var(--status-danger)",
                    }}
                  >
                    {lesson.difficulty}
                  </span>
                </div>
                <p style={{ margin: "4px 0 0 0", color: "#888", fontSize: "0.85rem" }}>
                  {lesson.promptCount} question{lesson.promptCount !== 1 ? "s" : ""}
                  {lesson.gradeLevel && ` · ${lesson.gradeLevel}`}
                </p>
              </div>
            </div>

            {/* Actions Row */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "12px", flexWrap: "wrap" }}>
              {/* Subject */}
              {editingSubject === lesson.id ? (
                <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <input
                    type="text"
                    list={`drawer-subjects-${lesson.id}`}
                    value={subjectValue}
                    onChange={(e) => setSubjectValue(e.target.value)}
                    placeholder="Enter subject..."
                    style={{
                      padding: "4px 8px",
                      border: "1px solid var(--status-info)",
                      borderRadius: "4px",
                      fontSize: "0.8rem",
                      width: "120px",
                    }}
                    autoFocus
                    onBlur={() => handleSaveSubject(lesson.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.currentTarget.blur();
                      } else if (e.key === "Escape") {
                        setSubjectValue(originalValue);
                        setEditingSubject(null);
                      }
                    }}
                  />
                  <datalist id={`drawer-subjects-${lesson.id}`}>
                    {availableSubjects.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </div>
              ) : (
                <button
                  onClick={() => handleStartEditSubject(lesson.id, lesson.subject)}
                  style={{
                    padding: "4px 8px",
                    background: lesson.subject ? "var(--status-info-bg)" : "transparent",
                    color: lesson.subject ? "var(--status-info-text)" : "#999",
                    border: "1px dashed var(--status-info)",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "0.75rem",
                  }}
                >
                  {lesson.subject || "+ Subject"}
                </button>
              )}

              <div style={{ flex: 1 }} />

              {/* Overflow Menu */}
              <div style={{ position: "relative" }}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenMenuId(openMenuId === lesson.id ? null : lesson.id);
                    setConfirmDelete(null);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "28px",
                    height: "28px",
                    padding: 0,
                    background: openMenuId === lesson.id ? "#f0f0f0" : "transparent",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    color: "#999",
                    fontSize: "1rem",
                  }}
                  title="Lesson options"
                >
                  ⋯
                </button>

                {openMenuId === lesson.id && (
                  <div
                    style={{
                      position: "absolute",
                      top: "100%",
                      right: 0,
                      marginTop: "4px",
                      background: "white",
                      borderRadius: "8px",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                      border: "1px solid #e0e0e0",
                      zIndex: 100,
                      minWidth: "160px",
                      overflow: "hidden",
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {confirmDelete === lesson.id ? (
                      <div style={{ padding: "12px" }}>
                        <p style={{ margin: "0 0 12px 0", fontSize: "0.85rem", color: "#333" }}>
                          Delete <strong>{lesson.title}</strong>? This cannot be undone.
                        </p>
                        <div style={{ display: "flex", gap: "8px" }}>
                          <button
                            onClick={() => setConfirmDelete(null)}
                            style={{ flex: 1, padding: "6px 12px", fontSize: "0.8rem", background: "#f5f5f5", border: "1px solid #ddd", borderRadius: "4px", cursor: "pointer" }}
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => {
                              setOpenMenuId(null);
                              setConfirmDelete(null);
                              onDelete(lesson.id, lesson.title);
                            }}
                            style={{ flex: 1, padding: "6px 12px", fontSize: "0.8rem", fontWeight: 500, background: "#dc2626", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => {
                            setOpenMenuId(null);
                            onArchive(lesson.id, lesson.title);
                          }}
                          style={{ display: "block", width: "100%", padding: "10px 14px", textAlign: "left", fontSize: "0.85rem", color: "#333", background: "transparent", border: "none", cursor: "pointer" }}
                          onMouseEnter={(e) => e.currentTarget.style.background = "#f5f5f5"}
                          onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                        >
                          Archive lesson
                        </button>
                        <button
                          onClick={() => setConfirmDelete(lesson.id)}
                          style={{ display: "block", width: "100%", padding: "10px 14px", textAlign: "left", fontSize: "0.85rem", color: "#dc2626", background: "transparent", border: "none", borderTop: "1px solid #f0f0f0", cursor: "pointer" }}
                          onMouseEnter={(e) => e.currentTarget.style.background = "#fef2f2"}
                          onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                        >
                          Delete lesson
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              <button
                onClick={() => onAssign(lesson.id)}
                style={{
                  padding: "6px 14px",
                  background: "var(--status-info)",
                  color: "white",
                  border: "none",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                  fontWeight: 500,
                }}
              >
                Assign →
              </button>
            </div>
          </div>
        ))}
      </div>
        </>
      )}
    </div>
  );
}

// ============================================
// Assignments Drawer Content
// ============================================

// Canonical values for grade/subject/difficulty normalization
const CANONICAL_GRADES = [
  "Kindergarten",
  "1st grade",
  "2nd grade",
  "3rd grade",
  "4th grade",
  "5th grade",
  "6th grade",
  "7th grade",
  "8th grade",
];

const CANONICAL_SUBJECTS = ["Math", "Science", "Language Arts", "Social Studies"];

const CANONICAL_DIFFICULTIES = ["beginner", "intermediate", "advanced"];

// Normalize grade to canonical format
// Handles: "Grade 1", "1", "1st Grade", "1st grade", "First Grade" → "1st grade"
function normalizeGrade(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const lower = input.toLowerCase().trim();

  // Handle kindergarten
  if (lower === "k" || lower === "kindergarten" || lower === "kinder") {
    return "Kindergarten";
  }

  // Extract numeric part
  const match = lower.match(/(\d+)/);
  if (!match) return input; // Return as-is if no number found

  const num = parseInt(match[1], 10);
  if (num < 1 || num > 8) return input; // Out of range

  const suffix = num === 1 ? "st" : num === 2 ? "nd" : num === 3 ? "rd" : "th";
  return `${num}${suffix} grade`;
}

// Normalize subject to canonical format
// Handles: "Math 1", "math", "MATH", "Mathematics" → "Math"
// Handles: "ELA", "English", "Reading" → "Language Arts"
function normalizeSubject(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const lower = input.toLowerCase().trim();

  // Math variations
  if (lower.startsWith("math") || lower === "mathematics") {
    return "Math";
  }

  // Science variations
  if (lower.startsWith("science")) {
    return "Science";
  }

  // Language Arts variations
  if (
    lower.startsWith("language") ||
    lower === "ela" ||
    lower === "english" ||
    lower === "reading" ||
    lower === "writing"
  ) {
    return "Language Arts";
  }

  // Social Studies variations
  if (lower.startsWith("social") || lower === "history" || lower === "geography") {
    return "Social Studies";
  }

  // Return original if no match (capitalize first letter)
  return input.charAt(0).toUpperCase() + input.slice(1);
}

// Normalize difficulty to canonical format
function normalizeDifficulty(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const lower = input.toLowerCase().trim();
  if (CANONICAL_DIFFICULTIES.includes(lower)) {
    return lower;
  }
  return input;
}

interface AssignmentFilters {
  classId?: string;
  subject?: string;
  gradeLevel?: string;
  difficulty?: string;
}

interface AssignmentsDrawerContentProps {
  prioritizedGroups: {
    needsAttention: PrioritizedAssignment[];
    inProgress: PrioritizedAssignment[];
    awaitingSubmissions: PrioritizedAssignment[];
    reviewed: PrioritizedAssignment[];
  };
  onNavigate: (assignmentId: string, classId: string, className: string) => void;
  archivedCount: number;
  onViewArchived: () => void;
  filters: AssignmentFilters;
  onClearFilters: () => void;
  onUpdateFilters: (filters: AssignmentFilters) => void;
}

function AssignmentsDrawerContent({ prioritizedGroups, onNavigate, archivedCount, onViewArchived, filters, onClearFilters, onUpdateFilters }: AssignmentsDrawerContentProps) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    needsAttention: true,
    inProgress: true,
    awaitingSubmissions: true,
    reviewed: false,
    archived: false,
  });

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const formatDate = (isoDate?: string): string => {
    if (!isoDate) return "";
    const date = new Date(isoDate);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  // Check if any filters are active
  const hasActiveFilters = filters.classId || filters.subject || filters.gradeLevel || filters.difficulty;

  // Collect all assignments for extracting filter options (memoized for stable reference)
  const allAssignments = useMemo(() => [
    ...prioritizedGroups.needsAttention,
    ...prioritizedGroups.inProgress,
    ...prioritizedGroups.awaitingSubmissions,
    ...prioritizedGroups.reviewed,
  ], [
    prioritizedGroups.needsAttention,
    prioritizedGroups.inProgress,
    prioritizedGroups.awaitingSubmissions,
    prioritizedGroups.reviewed,
  ]);

  // Build a list of unique classes from assignments
  const allClasses = useMemo(() => {
    const classMap = new Map<string, string>(); // classId -> className
    allAssignments.forEach(item => {
      if (item.classId && item.className) {
        classMap.set(item.classId, item.className);
      }
    });
    // Return sorted by class name
    return Array.from(classMap.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allAssignments]);

  // Build a set of normalized grades that exist in the data (optionally filtered by class)
  const gradesInData = useMemo(() => {
    const normalized = new Set<string>();
    allAssignments.forEach(item => {
      // If class filter is set, only include grades for that class
      if (filters.classId && item.classId !== filters.classId) return;
      const norm = normalizeGrade(item.gradeLevel);
      if (norm) normalized.add(norm);
    });
    return normalized;
  }, [allAssignments, filters.classId]);

  // Build a set of normalized subjects that exist in the data (optionally filtered by class)
  const _subjectsInData = useMemo(() => {
    const normalized = new Set<string>();
    allAssignments.forEach(item => {
      // If class filter is set, only include subjects for that class
      if (filters.classId && item.classId !== filters.classId) return;
      const norm = normalizeSubject(item.subject);
      if (norm) normalized.add(norm);
    });
    return normalized;
  }, [allAssignments, filters.classId]);

  // Filter canonical grades to only those present in data
  const allGrades = useMemo(() => {
    return CANONICAL_GRADES.filter(grade => gradesInData.has(grade));
  }, [gradesInData]);

  // Filter canonical subjects to only those present in data for the selected class+grade
  const availableSubjects = useMemo(() => {
    const normalizedFilterGrade = normalizeGrade(filters.gradeLevel);
    const subjectsForSelection = new Set<string>();

    allAssignments.forEach(item => {
      // If class filter is set, only include subjects for that class
      if (filters.classId && item.classId !== filters.classId) return;
      const normGrade = normalizeGrade(item.gradeLevel);
      const normSubject = normalizeSubject(item.subject);
      if (normSubject) {
        // If grade filter is set, only include subjects for that grade
        if (!normalizedFilterGrade || normGrade === normalizedFilterGrade) {
          subjectsForSelection.add(normSubject);
        }
      }
    });

    // Return canonical subjects that are present in filtered data
    return CANONICAL_SUBJECTS.filter(subject => subjectsForSelection.has(subject));
  }, [allAssignments, filters.classId, filters.gradeLevel]);

  // Filter difficulties to only those present in data for the selected class+grade+subject
  const availableDifficulties = useMemo(() => {
    const normalizedFilterGrade = normalizeGrade(filters.gradeLevel);
    const normalizedFilterSubject = normalizeSubject(filters.subject);
    const difficultiesForSelection = new Set<string>();

    allAssignments.forEach(item => {
      // If class filter is set, only include difficulties for that class
      if (filters.classId && item.classId !== filters.classId) return;
      const normGrade = normalizeGrade(item.gradeLevel);
      const normSubject = normalizeSubject(item.subject);
      const normDifficulty = normalizeDifficulty(item.difficulty);

      if (normDifficulty) {
        const matchesGrade = !normalizedFilterGrade || normGrade === normalizedFilterGrade;
        const matchesSubject = !normalizedFilterSubject || normSubject === normalizedFilterSubject;
        if (matchesGrade && matchesSubject) {
          difficultiesForSelection.add(normDifficulty);
        }
      }
    });

    // Return canonical difficulties that are present in filtered data
    return CANONICAL_DIFFICULTIES.filter(diff => difficultiesForSelection.has(diff));
  }, [allAssignments, filters.classId, filters.gradeLevel, filters.subject]);

  // Handle filter changes with cascading logic (using normalized values)
  // Hierarchy: Class → Grade → Subject → Skill

  const handleClassChange = (classId: string) => {
    if (!classId) {
      // Clear all filters when class is cleared
      onUpdateFilters({});
    } else {
      // Changing class clears all downstream filters (grade, subject, difficulty)
      onUpdateFilters({ classId });
    }
  };

  const handleGradeChange = (gradeLevel: string) => {
    if (!gradeLevel) {
      // Clear grade and downstream filters, keep class
      onUpdateFilters({ classId: filters.classId });
    } else {
      const normalizedGrade = normalizeGrade(gradeLevel);

      // Check if current subject is still valid for new grade (within selected class)
      const subjectsForGrade = new Set<string>();
      allAssignments.forEach(item => {
        if (filters.classId && item.classId !== filters.classId) return;
        if (normalizeGrade(item.gradeLevel) === normalizedGrade) {
          const normSubject = normalizeSubject(item.subject);
          if (normSubject) subjectsForGrade.add(normSubject);
        }
      });

      const normalizedCurrentSubject = normalizeSubject(filters.subject);
      const newSubject = normalizedCurrentSubject && subjectsForGrade.has(normalizedCurrentSubject)
        ? normalizedCurrentSubject
        : undefined;

      // Check if current difficulty is still valid
      let newDifficulty = filters.difficulty;
      if (newSubject) {
        const difficultiesForGradeSubject = new Set<string>();
        allAssignments.forEach(item => {
          if (filters.classId && item.classId !== filters.classId) return;
          if (
            normalizeGrade(item.gradeLevel) === normalizedGrade &&
            normalizeSubject(item.subject) === newSubject
          ) {
            const normDiff = normalizeDifficulty(item.difficulty);
            if (normDiff) difficultiesForGradeSubject.add(normDiff);
          }
        });
        if (newDifficulty && !difficultiesForGradeSubject.has(newDifficulty)) {
          newDifficulty = undefined;
        }
      } else {
        newDifficulty = undefined;
      }

      onUpdateFilters({ classId: filters.classId, gradeLevel: normalizedGrade, subject: newSubject, difficulty: newDifficulty });
    }
  };

  const handleSubjectChange = (subject: string) => {
    if (!subject) {
      // Clear subject and difficulty, keep class and grade
      onUpdateFilters({ classId: filters.classId, gradeLevel: filters.gradeLevel });
    } else {
      const normalizedSubject = normalizeSubject(subject);

      // Check if current difficulty is still valid for new subject (within selected class)
      const normalizedFilterGrade = normalizeGrade(filters.gradeLevel);
      const difficultiesForSubject = new Set<string>();
      allAssignments.forEach(item => {
        if (filters.classId && item.classId !== filters.classId) return;
        const normGrade = normalizeGrade(item.gradeLevel);
        const normSubject = normalizeSubject(item.subject);
        const matchesGrade = !normalizedFilterGrade || normGrade === normalizedFilterGrade;
        if (matchesGrade && normSubject === normalizedSubject && item.difficulty) {
          const normDiff = normalizeDifficulty(item.difficulty);
          if (normDiff) difficultiesForSubject.add(normDiff);
        }
      });
      const newDifficulty = filters.difficulty && difficultiesForSubject.has(filters.difficulty)
        ? filters.difficulty
        : undefined;

      onUpdateFilters({ classId: filters.classId, gradeLevel: filters.gradeLevel, subject: normalizedSubject, difficulty: newDifficulty });
    }
  };

  const handleDifficultyChange = (difficulty: string) => {
    const normalizedDifficulty = normalizeDifficulty(difficulty);
    onUpdateFilters({
      classId: filters.classId,
      gradeLevel: filters.gradeLevel,
      subject: filters.subject,
      difficulty: normalizedDifficulty || undefined,
    });
  };

  // Filter function for assignments (using normalized comparisons)
  const filterAssignment = (item: PrioritizedAssignment): boolean => {
    // Class filter
    if (filters.classId && item.classId !== filters.classId) return false;

    const normalizedFilterGrade = normalizeGrade(filters.gradeLevel);
    const normalizedFilterSubject = normalizeSubject(filters.subject);
    const normalizedFilterDifficulty = normalizeDifficulty(filters.difficulty);

    const normalizedItemGrade = normalizeGrade(item.gradeLevel);
    const normalizedItemSubject = normalizeSubject(item.subject);
    const normalizedItemDifficulty = normalizeDifficulty(item.difficulty);

    if (normalizedFilterSubject && normalizedItemSubject !== normalizedFilterSubject) return false;
    if (normalizedFilterGrade && normalizedItemGrade !== normalizedFilterGrade) return false;
    if (normalizedFilterDifficulty && normalizedItemDifficulty !== normalizedFilterDifficulty) return false;
    return true;
  };

  // Apply filters to each group
  const filteredGroups = {
    needsAttention: prioritizedGroups.needsAttention.filter(filterAssignment),
    inProgress: prioritizedGroups.inProgress.filter(filterAssignment),
    awaitingSubmissions: prioritizedGroups.awaitingSubmissions.filter(filterAssignment),
    reviewed: prioritizedGroups.reviewed.filter(filterAssignment),
  };

  const totalCount =
    prioritizedGroups.needsAttention.length +
    prioritizedGroups.inProgress.length +
    prioritizedGroups.awaitingSubmissions.length +
    prioritizedGroups.reviewed.length;

  const filteredCount =
    filteredGroups.needsAttention.length +
    filteredGroups.inProgress.length +
    filteredGroups.awaitingSubmissions.length +
    filteredGroups.reviewed.length;

  if (totalCount === 0) {
    return (
      <div style={{ textAlign: "center", padding: "32px 16px", color: "#666" }}>
        <p style={{ margin: 0, fontWeight: 500 }}>No assignments yet</p>
        <p style={{ margin: "8px 0 0 0", fontSize: "0.9rem" }}>
          Create and assign a lesson to get started.
        </p>
      </div>
    );
  }

  // Format grade level for display (uses normalization)
  const formatGradeLabel = (gradeLevel: string): string => {
    return normalizeGrade(gradeLevel) || gradeLevel;
  };

  // Build filter chips with hierarchical removal behavior
  // Order: Class → Grade → Subject → Skill
  // Removing a chip also removes downstream filters
  interface FilterChip {
    key: "classId" | "gradeLevel" | "subject" | "difficulty";
    label: string;
    onRemove: () => void;
  }

  // Get class name for display in filter chip
  const getClassNameById = (classId: string): string => {
    const foundClass = allClasses.find(c => c.id === classId);
    return foundClass?.name || classId;
  };

  const buildFilterChips = (): FilterChip[] => {
    const chips: FilterChip[] = [];

    // 1. Class (removing clears all downstream: grade, subject, skill)
    if (filters.classId) {
      chips.push({
        key: "classId",
        label: getClassNameById(filters.classId),
        onRemove: () => onUpdateFilters({}), // Clear all filters
      });
    }

    // 2. Grade (removing clears subject and skill too, keeps class)
    if (filters.gradeLevel) {
      chips.push({
        key: "gradeLevel",
        label: formatGradeLabel(filters.gradeLevel),
        onRemove: () => onUpdateFilters({ classId: filters.classId }), // Keep class, clear downstream
      });
    }

    // 3. Subject (removing clears skill too, keeps class and grade)
    if (filters.subject) {
      chips.push({
        key: "subject",
        label: filters.subject,
        onRemove: () => onUpdateFilters({ classId: filters.classId, gradeLevel: filters.gradeLevel }), // Keep class and grade
      });
    }

    // 4. Skill (removing only clears skill, keeps class, grade, and subject)
    if (filters.difficulty) {
      chips.push({
        key: "difficulty",
        label: filters.difficulty.charAt(0).toUpperCase() + filters.difficulty.slice(1),
        onRemove: () => onUpdateFilters({ classId: filters.classId, gradeLevel: filters.gradeLevel, subject: filters.subject }),
      });
    }

    return chips;
  };

  const filterChips = buildFilterChips();

  // Determine if we should show subject on cards (when no subject filter is applied)
  const showSubjectOnCards = !filters.subject;

  const renderSection = (
    title: string,
    sectionKey: string,
    items: PrioritizedAssignment[],
    actionLabel: string,
    accentColor: string,
    accentBg: string
  ) => {
    if (items.length === 0) return null;

    const isExpanded = expandedSections[sectionKey];

    return (
      <div style={{ marginBottom: "16px" }}>
        {/* Section Header */}
        <button
          onClick={() => toggleSection(sectionKey)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
            padding: "10px 12px",
            background: accentBg,
            border: "none",
            borderRadius: "8px",
            cursor: "pointer",
            marginBottom: isExpanded ? "10px" : 0,
          }}
        >
          <span style={{ fontWeight: 600, fontSize: "0.85rem", color: accentColor }}>
            {title}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{
              background: accentColor,
              color: "white",
              padding: "2px 8px",
              borderRadius: "10px",
              fontSize: "0.7rem",
              fontWeight: 600,
            }}>
              {items.length}
            </span>
            <span style={{ color: "#666", fontSize: "0.8rem" }}>
              {isExpanded ? "▼" : "▶"}
            </span>
          </span>
        </button>

        {/* Section Items */}
        {isExpanded && (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {items.map((item) => (
              <div
                key={`${item.assignment.assignmentId}-${item.classId}`}
                style={{
                  padding: "12px 14px",
                  background: "var(--surface-muted)",
                  borderRadius: "8px",
                  border: "1px solid var(--border-muted)",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: "#374151", fontSize: "0.9rem" }}>
                      {item.assignment.title}
                    </div>
                    <div style={{ fontSize: "0.8rem", color: "#64748b", marginTop: "4px" }}>
                      {item.className}
                      {showSubjectOnCards && item.subject && (
                        <span style={{ color: "#94a3b8" }}> · {item.subject}</span>
                      )}
                    </div>
                    {item.assignment.assignedAt && (
                      <div style={{ fontSize: "0.75rem", color: "#94a3b8", marginTop: "4px" }}>
                        Assigned {formatDate(item.assignment.assignedAt)}
                      </div>
                    )}
                    {/* Status indicators */}
                    {(item.attentionCount > 0 || item.unreviewed > 0) && (
                      <div style={{ display: "flex", gap: "8px", marginTop: "6px", flexWrap: "wrap" }}>
                        {item.attentionCount > 0 && (
                          <span style={{
                            fontSize: "0.7rem",
                            padding: "2px 6px",
                            background: "var(--status-danger-bg)",
                            color: "var(--status-danger)",
                            borderRadius: "4px",
                          }}>
                            {item.attentionCount} need{item.attentionCount === 1 ? "s" : ""} attention
                          </span>
                        )}
                        {item.unreviewed > 0 && (
                          <span style={{
                            fontSize: "0.7rem",
                            padding: "2px 6px",
                            background: "var(--status-pending-bg)",
                            color: "var(--status-pending-text)",
                            borderRadius: "4px",
                          }}>
                            {item.unreviewed} to review
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => onNavigate(item.assignment.assignmentId, item.classId, item.className)}
                    style={{
                      padding: "6px 14px",
                      fontSize: "0.8rem",
                      background: actionLabel === "Review" ? "var(--accent-primary)" : "var(--surface-elevated)",
                      color: actionLabel === "Review" ? "white" : "#374151",
                      border: actionLabel === "Review" ? "none" : "1px solid var(--border-muted)",
                      borderRadius: "6px",
                      cursor: "pointer",
                      fontWeight: 500,
                      flexShrink: 0,
                    }}
                  >
                    {actionLabel}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      {/* Filter chip row */}
      {hasActiveFilters && (
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          flexWrap: "wrap",
          padding: "12px 0",
          marginBottom: "8px",
          borderBottom: "1px solid var(--border-muted)",
        }}>
          <span style={{ fontSize: "0.8rem", color: "#6b7280" }}>Filtered by:</span>
          {filterChips.map((chip) => (
            <span
              key={chip.key}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "0.75rem",
                padding: "4px 8px 4px 10px",
                background: "var(--accent-primary)",
                color: "white",
                borderRadius: "12px",
                fontWeight: 500,
              }}
            >
              {chip.label}
              <button
                onClick={chip.onRemove}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "16px",
                  height: "16px",
                  padding: 0,
                  background: "rgba(255,255,255,0.25)",
                  border: "none",
                  borderRadius: "50%",
                  color: "white",
                  fontSize: "0.7rem",
                  cursor: "pointer",
                  lineHeight: 1,
                }}
                title={`Remove ${chip.label} filter`}
              >
                ×
              </button>
            </span>
          ))}
          {filterChips.length > 1 && (
            <button
              onClick={onClearFilters}
              style={{
                fontSize: "0.75rem",
                padding: "4px 10px",
                background: "transparent",
                color: "var(--accent-primary)",
                border: "1px solid var(--accent-primary)",
                borderRadius: "12px",
                cursor: "pointer",
                fontWeight: 500,
              }}
            >
              Clear all
            </button>
          )}
        </div>
      )}

      {/* Filter dropdowns */}
      <div style={{
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        padding: "12px 0",
        marginBottom: "12px",
        borderBottom: "1px solid var(--border-muted)",
      }}>
        {/* Row 1: Class dropdown - full width, only show if multiple classes exist */}
        {allClasses.length > 1 && (
          <select
            value={filters.classId || ""}
            onChange={(e) => handleClassChange(e.target.value)}
            style={{
              width: "100%",
              padding: "8px 12px",
              fontSize: "0.8rem",
              border: "1px solid var(--border-muted)",
              borderRadius: "6px",
              background: "var(--surface-elevated)",
              color: filters.classId ? "#374151" : "#9ca3af",
              cursor: "pointer",
            }}
          >
            <option value="">All classes</option>
            {allClasses.map((cls) => (
              <option key={cls.id} value={cls.id}>
                {cls.name}
              </option>
            ))}
          </select>
        )}

        {/* Row 2: Grade, Subject, Level dropdowns - equal width, wraps on narrow screens */}
        <div style={{
          display: "flex",
          gap: "8px",
          flexWrap: "wrap",
        }}>
          {/* Grade dropdown */}
          <select
            value={filters.gradeLevel || ""}
            onChange={(e) => handleGradeChange(e.target.value)}
            style={{
              flex: "1 1 0",
              minWidth: "100px",
              padding: "8px 12px",
              fontSize: "0.8rem",
              border: "1px solid var(--border-muted)",
              borderRadius: "6px",
              background: "var(--surface-elevated)",
              color: filters.gradeLevel ? "#374151" : "#9ca3af",
              cursor: "pointer",
            }}
          >
            <option value="">All grades</option>
            {allGrades.map((grade) => (
              <option key={grade} value={grade}>
                {formatGradeLabel(grade)}
              </option>
            ))}
          </select>

          {/* Subject dropdown */}
          <select
            value={filters.subject || ""}
            onChange={(e) => handleSubjectChange(e.target.value)}
            style={{
              flex: "1 1 0",
              minWidth: "100px",
              padding: "8px 12px",
              fontSize: "0.8rem",
              border: "1px solid var(--border-muted)",
              borderRadius: "6px",
              background: "var(--surface-elevated)",
              color: filters.subject ? "#374151" : "#9ca3af",
              cursor: "pointer",
            }}
            disabled={availableSubjects.length === 0}
          >
            <option value="">All subjects</option>
            {availableSubjects.map((subject) => (
              <option key={subject} value={subject}>
                {subject}
              </option>
            ))}
          </select>

          {/* Skill level dropdown */}
          <select
            value={filters.difficulty || ""}
            onChange={(e) => handleDifficultyChange(e.target.value)}
            style={{
              flex: "1 1 0",
              minWidth: "100px",
              padding: "8px 12px",
              fontSize: "0.8rem",
              border: "1px solid var(--border-muted)",
              borderRadius: "6px",
              background: "var(--surface-elevated)",
              color: filters.difficulty ? "#374151" : "#9ca3af",
              cursor: "pointer",
            }}
            disabled={availableDifficulties.length === 0}
          >
            <option value="">All levels</option>
            {availableDifficulties.map((difficulty) => (
              <option key={difficulty} value={difficulty}>
                {difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Empty state when filters have no matches */}
      {hasActiveFilters && filteredCount === 0 && (
        <div style={{ textAlign: "center", padding: "32px 16px", color: "#666" }}>
          <p style={{ margin: 0, fontWeight: 500 }}>No matching assignments</p>
          <p style={{ margin: "8px 0 0 0", fontSize: "0.9rem" }}>
            Try adjusting your filters or{" "}
            <button
              onClick={onClearFilters}
              style={{
                background: "none",
                border: "none",
                color: "var(--accent-primary)",
                cursor: "pointer",
                textDecoration: "underline",
                padding: 0,
                fontSize: "inherit",
              }}
            >
              clear all filters
            </button>
            .
          </p>
        </div>
      )}

      {renderSection(
        "Needs Attention",
        "needsAttention",
        filteredGroups.needsAttention,
        "Review",
        "var(--status-danger)",
        "var(--status-danger-bg)"
      )}
      {renderSection(
        "In Progress",
        "inProgress",
        filteredGroups.inProgress,
        "Review",
        "var(--status-info-text)",
        "var(--status-info-bg)"
      )}
      {renderSection(
        "Awaiting Submissions",
        "awaitingSubmissions",
        filteredGroups.awaitingSubmissions,
        "View",
        "var(--status-pending-text)",
        "var(--status-pending-bg)"
      )}
      {renderSection(
        "Reviewed",
        "reviewed",
        filteredGroups.reviewed,
        "View",
        "var(--status-success-text)",
        "var(--status-success-bg)"
      )}

      {/* Archived Section */}
      {archivedCount > 0 && (
        <div style={{ marginTop: "16px", borderTop: "1px solid var(--border-muted)", paddingTop: "16px" }}>
          <button
            onClick={() => toggleSection("archived")}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              width: "100%",
              padding: "10px 12px",
              background: "var(--surface-muted)",
              border: "none",
              borderRadius: "8px",
              cursor: "pointer",
              marginBottom: expandedSections.archived ? "10px" : 0,
            }}
          >
            <span style={{ fontWeight: 600, fontSize: "0.85rem", color: "#6b7280" }}>
              Archived
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{
                background: "#9ca3af",
                color: "white",
                padding: "2px 8px",
                borderRadius: "10px",
                fontSize: "0.7rem",
                fontWeight: 600,
              }}>
                {archivedCount}
              </span>
              <span style={{ color: "#666", fontSize: "0.8rem" }}>
                {expandedSections.archived ? "▼" : "▶"}
              </span>
            </span>
          </button>
          {expandedSections.archived && (
            <div style={{ padding: "8px 0" }}>
              <button
                onClick={onViewArchived}
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  background: "var(--surface-elevated)",
                  border: "1px solid var(--border-muted)",
                  borderRadius: "8px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  color: "#374151",
                  fontSize: "0.9rem",
                }}
              >
                <span>View archived assignments</span>
                <span style={{ color: "#9ca3af" }}>→</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================
// Coaching Activity Drawer Content
// ============================================

interface CoachingActivityDrawerContentProps {
  activities: StudentCoachingActivity[];
  coachingInvites: CoachingInvite[];
  allStudents: Student[];
  onNavigate?: (studentId: string) => void;
  onDismissInvite?: (inviteId: string) => void;
}

function CoachingActivityDrawerContent({ activities, coachingInvites, allStudents, onNavigate, onDismissInvite }: CoachingActivityDrawerContentProps) {
  // Inline confirmation state for dismissing an invite
  const [confirmDismissId, setConfirmDismissId] = useState<string | null>(null);

  // Student name lookup for coaching invites
  const studentNameMap = new Map(allStudents.map((s) => [s.id, s.name]));

  const getInviteStatusDisplay = (status: string) => {
    switch (status) {
      case "pending":    return { label: "Not started",  color: "var(--status-pending-text)", bg: "var(--status-pending-bg)" };
      case "started":    return { label: "In progress",  color: "var(--status-info-text)",    bg: "var(--status-info-bg)" };
      case "completed":  return { label: "Completed",    color: "var(--status-success-text)", bg: "var(--status-success-bg)" };
      default:           return { label: status,          color: "var(--text-secondary)",      bg: "var(--surface-muted)" };
    }
  };

  // Categorize by intent
  const supportSeeking = activities.filter((a) => a.insight.intentLabel === "support-seeking");
  const enrichmentSeeking = activities.filter((a) => a.insight.intentLabel === "enrichment-seeking");
  const mixed = activities.filter((a) => a.insight.intentLabel === "mixed");

  // Helper: Format request count calmly (cap at 10+)
  const formatRequestCount = (count: number): string => {
    if (count <= 9) {
      return `${count} request${count !== 1 ? "s" : ""}`;
    }
    return "10+ requests";
  };

  // Helper: Format date for recency
  const formatLastActive = (dateStr: string): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  };

  // Helper: Truncate topics gracefully
  const formatTopics = (topics: string[]): string => {
    if (topics.length === 0) return "";
    const display = topics.slice(0, 2);
    const text = display.join(", ");
    if (text.length > 50) {
      return text.slice(0, 47) + "...";
    }
    if (topics.length > 2) {
      return text + "...";
    }
    return text;
  };

  if (activities.length === 0 && coachingInvites.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "32px 16px", color: "#666" }}>
        <p style={{ margin: 0 }}>No coaching activity yet</p>
        <p style={{ margin: "8px 0 0 0", fontSize: "0.9rem" }}>
          When students use Ask Coach or you assign coaching sessions, activity will appear here.
        </p>
      </div>
    );
  }

  const renderActivityGroup = (
    title: string,
    items: StudentCoachingActivity[],
    icon: string,
    accentColor: string,
    bgColor: string
  ) => {
    if (items.length === 0) return null;

    return (
      <div style={{ marginBottom: "24px" }}>
        {/* Category Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginBottom: "10px",
            padding: "6px 10px",
            background: bgColor,
            borderRadius: "6px",
          }}
        >
          <span style={{ fontSize: "1rem" }}>{icon}</span>
          <span style={{ fontWeight: 500, fontSize: "0.9rem", color: accentColor }}>{title}</span>
          <span
            style={{
              marginLeft: "auto",
              fontSize: "0.8rem",
              color: accentColor,
              opacity: 0.8,
            }}
          >
            {items.length} student{items.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Student List - Non-clickable by default */}
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {items.map((activity) => (
            <div
              key={activity.studentId}
              style={{
                padding: "10px 14px",
                background: "var(--surface-elevated)",
                borderRadius: "8px",
                border: "1px solid var(--border-subtle)",
              }}
            >
              {/* Top row: Name and optional View link */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 500, color: "#333", fontSize: "0.9rem" }}>
                  {activity.studentName}
                </span>
                {onNavigate && (
                  <button
                    onClick={() => onNavigate(activity.studentId)}
                    style={{
                      background: "none",
                      border: "none",
                      padding: "2px 6px",
                      fontSize: "0.75rem",
                      color: "#888",
                      cursor: "pointer",
                      borderRadius: "4px",
                      transition: "color 0.15s, background 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = "var(--accent-primary)";
                      e.currentTarget.style.background = "var(--surface-accent-tint)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = "#888";
                      e.currentTarget.style.background = "none";
                    }}
                  >
                    View
                  </button>
                )}
              </div>

              {/* Info row: Request count and last active */}
              <div style={{ marginTop: "4px", fontSize: "0.8rem", color: "#777" }}>
                {formatRequestCount(activity.insight.totalCoachRequests)}
                {activity.insight.lastCoachSessionAt && (
                  <span style={{ marginLeft: "8px", color: "#999" }}>
                    • Last: {formatLastActive(activity.insight.lastCoachSessionAt)}
                  </span>
                )}
              </div>

              {/* Topics row */}
              {activity.insight.recentTopics.length > 0 && (
                <div
                  style={{
                    marginTop: "4px",
                    fontSize: "0.75rem",
                    color: "#999",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  Topics: {formatTopics(activity.insight.recentTopics)}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div>
      {/* Framing subtitle */}
      <p
        style={{
          margin: "0 0 20px 0",
          fontSize: "0.85rem",
          color: "#888",
          lineHeight: 1.4,
        }}
      >
        A quick pulse on how students are using Ask Coach
      </p>

      {/* Categories */}
      {renderActivityGroup("Support-Seeking", supportSeeking, "", "var(--status-pending-text)", "var(--status-pending-bg)")}
      {renderActivityGroup("Enrichment-Seeking", enrichmentSeeking, "", "var(--status-success-text)", "var(--status-success-bg)")}
      {mixed.length > 0 && renderActivityGroup("General Usage", mixed, "", "var(--text-secondary)", "var(--surface-muted)")}

      {/* Teacher-Assigned Sessions */}
      {coachingInvites.length > 0 && (
        <div style={{ marginBottom: "24px" }}>
          {/* Category Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "10px",
              padding: "6px 10px",
              background: "var(--status-violet-bg)",
              borderRadius: "6px",
            }}
          >
            <span style={{ fontWeight: 500, fontSize: "0.9rem", color: "var(--status-violet-text)" }}>Teacher-Assigned Sessions</span>
            <span
              style={{
                marginLeft: "auto",
                fontSize: "0.8rem",
                color: "var(--status-violet-text)",
                opacity: 0.8,
              }}
            >
              {coachingInvites.length} session{coachingInvites.length !== 1 ? "s" : ""}
            </span>
          </div>

          {/* Invite List */}
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {coachingInvites.map((invite) => {
              const statusDisplay = getInviteStatusDisplay(invite.status);
              const isConfirming = confirmDismissId === invite.id;
              return (
                <div
                  key={invite.id}
                  style={{
                    padding: "10px 14px",
                    background: "var(--surface-elevated)",
                    borderRadius: "8px",
                    border: isConfirming ? "1px solid #fca5a5" : "1px solid var(--border-subtle)",
                  }}
                >
                  {isConfirming ? (
                    /* Inline confirmation */
                    <div>
                      <p style={{ margin: "0 0 4px 0", fontSize: "0.85rem", fontWeight: 500, color: "#333" }}>
                        Remove session?
                      </p>
                      <p style={{ margin: "0 0 10px 0", fontSize: "0.8rem", color: "#666", lineHeight: 1.4 }}>
                        This will remove the session invitation for this student. The student will no longer see it.
                      </p>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <button
                          onClick={() => setConfirmDismissId(null)}
                          style={{
                            flex: 1,
                            padding: "6px 12px",
                            fontSize: "0.8rem",
                            background: "#f5f5f5",
                            border: "1px solid #ddd",
                            borderRadius: "4px",
                            cursor: "pointer",
                          }}
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => {
                            setConfirmDismissId(null);
                            onDismissInvite?.(invite.id);
                          }}
                          style={{
                            flex: 1,
                            padding: "6px 12px",
                            fontSize: "0.8rem",
                            fontWeight: 500,
                            background: "#dc2626",
                            color: "white",
                            border: "none",
                            borderRadius: "4px",
                            cursor: "pointer",
                          }}
                        >
                          Remove session
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* Top row: Student name + View / X buttons */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontWeight: 500, color: "#333", fontSize: "0.9rem" }}>
                          {studentNameMap.get(invite.studentId) || invite.studentId}
                        </span>
                        <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
                          {onNavigate && (
                            <button
                              onClick={() => onNavigate(invite.studentId)}
                              style={{
                                background: "none",
                                border: "none",
                                padding: "2px 6px",
                                fontSize: "0.75rem",
                                color: "#888",
                                cursor: "pointer",
                                borderRadius: "4px",
                                transition: "color 0.15s, background 0.15s",
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.color = "var(--accent-primary)";
                                e.currentTarget.style.background = "var(--surface-accent-tint)";
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.color = "#888";
                                e.currentTarget.style.background = "none";
                              }}
                            >
                              View
                            </button>
                          )}
                          {onDismissInvite && (
                            <button
                              onClick={() => setConfirmDismissId(invite.id)}
                              title="Remove session"
                              style={{
                                background: "none",
                                border: "none",
                                padding: "2px 5px",
                                fontSize: "0.75rem",
                                color: "#bbb",
                                cursor: "pointer",
                                borderRadius: "4px",
                                lineHeight: 1,
                                transition: "color 0.15s, background 0.15s",
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.color = "#dc2626";
                                e.currentTarget.style.background = "#fef2f2";
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.color = "#bbb";
                                e.currentTarget.style.background = "none";
                              }}
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Bottom row: Title + Status badge */}
                      <div style={{ marginTop: "4px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: "0.8rem", color: "#777" }}>
                          {invite.title || invite.assignmentTitle || "Coaching session"}
                        </span>
                        <span
                          style={{
                            fontSize: "0.7rem",
                            fontWeight: 500,
                            padding: "2px 8px",
                            borderRadius: "10px",
                            color: statusDisplay.color,
                            background: statusDisplay.bg,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {statusDisplay.label}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// Classes Drawer Content - Full Navigation Hub
// ============================================

type ClassesDrawerView = "list" | "create" | { type: "detail"; classId: string };

interface ClassesDrawerContentProps {
  classes: ClassSummary[];
  onClassesChange: () => Promise<void>;
  onNavigateToClass: (classId: string) => void;
  onNavigateToStudent: (studentId: string, classId: string, className: string) => void;
}

function ClassesDrawerContent({
  classes,
  onClassesChange,
  onNavigateToClass,
  onNavigateToStudent,
}: ClassesDrawerContentProps) {
  const { showError, showSuccess } = useToast();
  const [view, setView] = useState<ClassesDrawerView>("list");
  const [classDetail, setClassDetail] = useState<ClassWithStudents | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Load class detail when viewing a class
  const loadClassDetail = async (classId: string) => {
    setLoadingDetail(true);
    try {
      const data = await getClass(classId);
      setClassDetail(data);
    } catch (err) {
      console.error("Failed to load class:", err);
      showError("Failed to load class details.");
      setView("list");
    } finally {
      setLoadingDetail(false);
    }
  };

  // Handle viewing a class inline
  const handleViewClass = (classId: string) => {
    setView({ type: "detail", classId });
    loadClassDetail(classId);
  };

  // Handle back navigation
  const handleBack = () => {
    setView("list");
    setClassDetail(null);
  };

  // Handle archive class
  const handleArchiveClass = async (classId: string, className: string) => {
    try {
      await archiveClass(classId);
      await onClassesChange();
      showSuccess(`"${className}" has been archived.`);
      if (typeof view === "object" && view.classId === classId) {
        setView("list");
      }
    } catch (err) {
      console.error("Failed to archive class:", err);
      showError("Failed to archive class.");
    }
  };

  // Handle delete class
  const handleDeleteClass = async (classId: string, className: string) => {
    try {
      await deleteClass(classId);
      await onClassesChange();
      showSuccess(`"${className}" has been removed.`);
      if (typeof view === "object" && view.classId === classId) {
        setView("list");
      }
    } catch (err) {
      console.error("Failed to delete class:", err);
      showError("Failed to remove class.");
    }
  };

  // Handle class created — show detail inline
  const handleClassCreated = async (newClassId: string) => {
    await onClassesChange();
    showSuccess("Class created");
    handleViewClass(newClassId);
  };

  // Render based on current view
  if (view === "create") {
    return (
      <CreateClassView
        onBack={handleBack}
        onClassCreated={handleClassCreated}
      />
    );
  }

  if (typeof view === "object" && view.type === "detail") {
    return (
      <ClassDetailDrawerView
        classData={classDetail}
        loading={loadingDetail}
        onBack={handleBack}
        onArchive={handleArchiveClass}
        onDelete={handleDeleteClass}
        onRefresh={() => loadClassDetail(view.classId)}
        onNavigateToStudent={onNavigateToStudent}
        onNavigateToClass={onNavigateToClass}
      />
    );
  }

  // List view
  return (
    <ClassListView
      classes={classes}
      onViewClass={handleViewClass}
      onCreateClass={() => setView("create")}
      onArchiveClass={handleArchiveClass}
      onDeleteClass={handleDeleteClass}
    />
  );
}

// ============================================
// Class List View (within drawer)
// ============================================

interface ClassListViewProps {
  classes: ClassSummary[];
  onViewClass: (classId: string) => void;
  onCreateClass: () => void;
  onArchiveClass: (classId: string, className: string) => void;
  onDeleteClass: (classId: string, className: string) => void;
}

function ClassListView({
  classes,
  onViewClass,
  onCreateClass,
  onArchiveClass,
  onDeleteClass,
}: ClassListViewProps) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    const handleClickOutside = () => setOpenMenuId(null);
    if (openMenuId) {
      document.addEventListener("click", handleClickOutside);
      return () => document.removeEventListener("click", handleClickOutside);
    }
  }, [openMenuId]);

  if (classes.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "32px 16px", color: "#666" }}>
        {/* Empty state indicator */}
        <p style={{ margin: 0, fontWeight: 500 }}>No classes yet</p>
        <p style={{ margin: "8px 0 16px 0", fontSize: "0.9rem" }}>
          Create a class to organize your students and assignments.
        </p>
        <button onClick={onCreateClass} className="btn btn-primary" style={{ padding: "10px 20px" }}>
          + Create Class
        </button>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <p style={{ margin: 0, fontSize: "0.85rem", color: "#888" }}>
          Quick access to your classes
        </p>
        <button
          onClick={onCreateClass}
          style={{
            padding: "6px 12px",
            fontSize: "0.8rem",
            fontWeight: 500,
            color: "var(--accent-primary)",
            background: "transparent",
            border: "1px solid var(--accent-primary)",
            borderRadius: "6px",
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--accent-primary)";
            e.currentTarget.style.color = "white";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "var(--accent-primary)";
          }}
        >
          + Add Class
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {classes.map((cls) => (
          <div
            key={cls.id}
            style={{
              position: "relative",
              padding: "14px 16px",
              background: "white",
              borderRadius: "8px",
              border: "1px solid var(--border-subtle)",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => e.currentTarget.style.borderColor = "var(--accent-primary)"}
            onMouseLeave={(e) => {
              if (openMenuId !== cls.id) e.currentTarget.style.borderColor = "var(--border-subtle)";
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div
                style={{ flex: 1, display: "flex", alignItems: "center", cursor: "pointer" }}
                onClick={() => onViewClass(cls.id)}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: "#333", fontSize: "0.95rem" }}>{cls.name}</div>
                  <div style={{ marginTop: "4px", fontSize: "0.8rem", color: "#888" }}>
                    {cls.gradeLevel && <span style={{ marginRight: "8px" }}>{cls.gradeLevel}</span>}
                    {cls.studentCount} student{cls.studentCount !== 1 ? "s" : ""}
                    {cls.subjects && cls.subjects.length > 0 && (
                      <span style={{ marginLeft: "8px", color: "#aaa" }}>
                        • {cls.subjects.slice(0, 2).join(", ")}
                        {cls.subjects.length > 2 && ` +${cls.subjects.length - 2}`}
                      </span>
                    )}
                  </div>
                </div>
                <span style={{ color: "var(--accent-primary)", fontSize: "1rem", marginRight: "8px" }}>→</span>
              </div>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenMenuId(openMenuId === cls.id ? null : cls.id);
                  setConfirmDelete(null);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "28px",
                  height: "28px",
                  padding: 0,
                  background: openMenuId === cls.id ? "#f0f0f0" : "transparent",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                  color: "#999",
                  fontSize: "1rem",
                }}
                title="Class options"
              >
                ⋯
              </button>
            </div>

            {openMenuId === cls.id && (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  right: "8px",
                  marginTop: "4px",
                  background: "white",
                  borderRadius: "8px",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                  border: "1px solid #e0e0e0",
                  zIndex: 100,
                  minWidth: "160px",
                  overflow: "hidden",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {confirmDelete === cls.id ? (
                  <div style={{ padding: "12px" }}>
                    <p style={{ margin: "0 0 12px 0", fontSize: "0.85rem", color: "#333" }}>
                      Remove <strong>{cls.name}</strong>? This cannot be undone.
                    </p>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button
                        onClick={() => setConfirmDelete(null)}
                        style={{ flex: 1, padding: "6px 12px", fontSize: "0.8rem", background: "#f5f5f5", border: "1px solid #ddd", borderRadius: "4px", cursor: "pointer" }}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => {
                          setOpenMenuId(null);
                          setConfirmDelete(null);
                          onDeleteClass(cls.id, cls.name);
                        }}
                        style={{ flex: 1, padding: "6px 12px", fontSize: "0.8rem", fontWeight: 500, background: "#dc2626", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        setOpenMenuId(null);
                        onArchiveClass(cls.id, cls.name);
                      }}
                      style={{ display: "block", width: "100%", padding: "10px 14px", textAlign: "left", fontSize: "0.85rem", color: "#333", background: "transparent", border: "none", cursor: "pointer" }}
                      onMouseEnter={(e) => e.currentTarget.style.background = "#f5f5f5"}
                      onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                    >
                      Archive class
                    </button>
                    <button
                      onClick={() => setConfirmDelete(cls.id)}
                      style={{ display: "block", width: "100%", padding: "10px 14px", textAlign: "left", fontSize: "0.85rem", color: "#dc2626", background: "transparent", border: "none", borderTop: "1px solid #f0f0f0", cursor: "pointer" }}
                      onMouseEnter={(e) => e.currentTarget.style.background = "#fef2f2"}
                      onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                    >
                      Remove class
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================
// Create Class View (within drawer)
// ============================================

interface CreateClassViewProps {
  onBack: () => void;
  onClassCreated: (classId: string) => void;
}

function CreateClassView({ onBack, onClassCreated }: CreateClassViewProps) {
  const { showError } = useToast();
  const [name, setName] = useState("");
  const [gradeLevel, setGradeLevel] = useState("");
  const [period, setPeriod] = useState("");
  const [sectionLabel, setSectionLabel] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsCreating(true);
    try {
      const newClass = await createClass({
        name: name.trim(),
        gradeLevel: gradeLevel.trim() || undefined,
        period: period.trim() || undefined,
        sectionLabel: sectionLabel.trim() || undefined,
      });
      onClassCreated(newClass.id);
    } catch (err) {
      console.error("Failed to create class:", err);
      showError("Failed to create class. Please try again.");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div>
      {/* Back navigation */}
      <button
        onClick={onBack}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "0",
          marginBottom: "16px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: "#64748b",
          fontSize: "0.85rem",
        }}
      >
        ← Back to classes
      </button>

      <h3 style={{ margin: "0 0 20px 0", fontSize: "1.1rem", fontWeight: 600, color: "#1f2937" }}>
        Create New Class
      </h3>

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: "16px" }}>
          <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#374151", marginBottom: "6px" }}>
            Class Name <span style={{ color: "#dc2626" }}>*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Mrs. Smith's 2nd Grade"
            autoFocus
            style={{
              width: "100%",
              padding: "10px 12px",
              fontSize: "0.9rem",
              border: "1px solid #e2e8f0",
              borderRadius: "6px",
              boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{ marginBottom: "16px" }}>
          <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#374151", marginBottom: "6px" }}>
            Grade Level
          </label>
          <select
            value={gradeLevel}
            onChange={(e) => setGradeLevel(e.target.value)}
            style={{
              width: "100%",
              padding: "10px 12px",
              fontSize: "0.9rem",
              border: "1px solid #e2e8f0",
              borderRadius: "6px",
              background: "white",
              boxSizing: "border-box",
            }}
          >
            <option value="">Select grade level...</option>
            <option value="Pre-K">Pre-K</option>
            <option value="Kindergarten">Kindergarten</option>
            <option value="1st Grade">1st Grade</option>
            <option value="2nd Grade">2nd Grade</option>
            <option value="3rd Grade">3rd Grade</option>
            <option value="4th Grade">4th Grade</option>
            <option value="5th Grade">5th Grade</option>
            <option value="6th Grade">6th Grade</option>
            <option value="7th Grade">7th Grade</option>
            <option value="8th Grade">8th Grade</option>
            <option value="9th Grade">9th Grade</option>
            <option value="10th Grade">10th Grade</option>
            <option value="11th Grade">11th Grade</option>
            <option value="12th Grade">12th Grade</option>
          </select>
        </div>

        <div style={{ marginBottom: "16px" }}>
          <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#374151", marginBottom: "6px" }}>
            Period <span style={{ fontWeight: 400, color: "#94a3b8" }}>(optional)</span>
          </label>
          <input
            type="text"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            placeholder="e.g., Period 3, Morning, Block A"
            style={{
              width: "100%",
              padding: "10px 12px",
              fontSize: "0.9rem",
              border: "1px solid #e2e8f0",
              borderRadius: "6px",
              boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{ marginBottom: "16px" }}>
          <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#374151", marginBottom: "6px" }}>
            Section <span style={{ fontWeight: 400, color: "#94a3b8" }}>(optional)</span>
          </label>
          <input
            type="text"
            value={sectionLabel}
            onChange={(e) => setSectionLabel(e.target.value)}
            placeholder="e.g., A, B, AM, PM, 1, 2"
            style={{
              width: "100%",
              padding: "10px 12px",
              fontSize: "0.9rem",
              border: "1px solid #e2e8f0",
              borderRadius: "6px",
              boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{ display: "flex", gap: "10px", marginTop: "24px" }}>
          <button
            type="button"
            onClick={onBack}
            style={{
              flex: 1,
              padding: "10px 16px",
              fontSize: "0.85rem",
              fontWeight: 500,
              background: "white",
              color: "#374151",
              border: "1px solid #e2e8f0",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim() || isCreating}
            style={{
              flex: 1,
              padding: "10px 16px",
              fontSize: "0.85rem",
              fontWeight: 600,
              background: !name.trim() || isCreating ? "#e2e8f0" : "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
              color: !name.trim() || isCreating ? "#94a3b8" : "white",
              border: "none",
              borderRadius: "6px",
              cursor: !name.trim() || isCreating ? "not-allowed" : "pointer",
            }}
          >
            {isCreating ? "Creating..." : "Create & Add Students"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ============================================
// Class Detail View (within drawer)
// ============================================

interface ClassDetailDrawerViewProps {
  classData: ClassWithStudents | null;
  loading: boolean;
  onBack: () => void;
  onArchive: (classId: string, className: string) => void;
  onDelete: (classId: string, className: string) => void;
  onRefresh: () => void;
  onNavigateToStudent: (studentId: string, classId: string, className: string) => void;
  onNavigateToClass: (classId: string) => void;
}

function ClassDetailDrawerView({
  classData,
  loading,
  onBack,
  onArchive,
  onDelete,
  onRefresh,
  onNavigateToStudent,
  onNavigateToClass,
}: ClassDetailDrawerViewProps) {
  const { showError, showSuccess } = useToast();
  const [showAddStudents, setShowAddStudents] = useState(false);
  const [studentNames, setStudentNames] = useState("");
  const [addingStudents, setAddingStudents] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    const handleClickOutside = () => setShowMenu(false);
    if (showMenu) {
      document.addEventListener("click", handleClickOutside);
      return () => document.removeEventListener("click", handleClickOutside);
    }
  }, [showMenu]);

  const handleAddStudents = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!classData || !studentNames.trim()) return;

    setAddingStudents(true);
    try {
      const result = await bulkAddStudentsToClass(classData.id, studentNames);
      showSuccess(`Added ${result.created + result.existing} student${result.created + result.existing !== 1 ? "s" : ""}`);
      setStudentNames("");
      setShowAddStudents(false);
      onRefresh();
    } catch (err) {
      console.error("Failed to add students:", err);
      showError("Failed to add students.");
    } finally {
      setAddingStudents(false);
    }
  };

  const handleRemoveStudent = async (studentId: string, studentName: string) => {
    if (!classData) return;
    if (!confirm(`Remove ${studentName} from this class?`)) return;

    try {
      await removeStudentFromClass(classData.id, studentId);
      showSuccess(`${studentName} removed from class.`);
      onRefresh();
    } catch (err) {
      console.error("Failed to remove student:", err);
      showError("Failed to remove student.");
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: "48px 16px" }}>
        <div className="loading-spinner" style={{ margin: "0 auto 16px" }}></div>
        <p style={{ color: "#64748b" }}>Loading class...</p>
      </div>
    );
  }

  if (!classData) {
    return (
      <div style={{ textAlign: "center", padding: "32px 16px" }}>
        <p style={{ color: "#64748b" }}>Class not found.</p>
        <button onClick={onBack} className="btn btn-secondary" style={{ marginTop: "16px" }}>
          ← Back to classes
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header with back and menu */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
        <button
          onClick={onBack}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            padding: "0",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "#64748b",
            fontSize: "0.85rem",
          }}
        >
          ← Back to classes
        </button>

        <div style={{ position: "relative" }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(!showMenu);
              setConfirmDelete(false);
            }}
            style={{
              padding: "4px 8px",
              background: showMenu ? "#f0f0f0" : "transparent",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              color: "#666",
              fontSize: "1rem",
            }}
          >
            ⋯
          </button>

          {showMenu && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                right: 0,
                marginTop: "4px",
                background: "white",
                borderRadius: "8px",
                boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                border: "1px solid #e0e0e0",
                zIndex: 100,
                minWidth: "160px",
                overflow: "hidden",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {confirmDelete ? (
                <div style={{ padding: "12px" }}>
                  <p style={{ margin: "0 0 12px 0", fontSize: "0.85rem", color: "#333" }}>
                    Remove this class? This cannot be undone.
                  </p>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      onClick={() => setConfirmDelete(false)}
                      style={{ flex: 1, padding: "6px 12px", fontSize: "0.8rem", background: "#f5f5f5", border: "1px solid #ddd", borderRadius: "4px", cursor: "pointer" }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => onDelete(classData.id, classData.name)}
                      style={{ flex: 1, padding: "6px 12px", fontSize: "0.8rem", fontWeight: 500, background: "#dc2626", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    onClick={() => {
                      setShowMenu(false);
                      onArchive(classData.id, classData.name);
                    }}
                    style={{ display: "block", width: "100%", padding: "10px 14px", textAlign: "left", fontSize: "0.85rem", color: "#333", background: "transparent", border: "none", cursor: "pointer" }}
                    onMouseEnter={(e) => e.currentTarget.style.background = "#f5f5f5"}
                    onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                  >
                    Archive class
                  </button>
                  <button
                    onClick={() => setConfirmDelete(true)}
                    style={{ display: "block", width: "100%", padding: "10px 14px", textAlign: "left", fontSize: "0.85rem", color: "#dc2626", background: "transparent", border: "none", borderTop: "1px solid #f0f0f0", cursor: "pointer" }}
                    onMouseEnter={(e) => e.currentTarget.style.background = "#fef2f2"}
                    onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                  >
                    Remove class
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Class info + Open class page link */}
      <div style={{ marginBottom: "20px" }}>
        <h3 style={{ margin: "0 0 4px 0", fontSize: "1.2rem", fontWeight: 600, color: "#1f2937" }}>
          {classData.name}
        </h3>
        <div style={{ fontSize: "0.85rem", color: "#64748b" }}>
          {classData.gradeLevel && <span style={{ marginRight: "12px" }}>{classData.gradeLevel}</span>}
          {classData.period && <span>{classData.period}</span>}
        </div>
        <button
          onClick={() => onNavigateToClass(classData.id)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            marginTop: "10px",
            padding: "5px 12px",
            fontSize: "0.8rem",
            fontWeight: 500,
            color: "var(--accent-primary)",
            background: "transparent",
            border: "1px solid var(--accent-primary)",
            borderRadius: "6px",
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--accent-primary)";
            e.currentTarget.style.color = "white";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "var(--accent-primary)";
          }}
        >
          Open class page <span style={{ fontSize: "0.85rem" }}>→</span>
        </button>
      </div>

      {/* Students section */}
      <div style={{ flex: 1, overflow: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
          <h4 style={{ margin: 0, fontSize: "0.9rem", fontWeight: 600, color: "#374151" }}>
            Students ({classData.students.length})
          </h4>
          <button
            onClick={() => setShowAddStudents(!showAddStudents)}
            style={{
              padding: "4px 10px",
              fontSize: "0.75rem",
              fontWeight: 500,
              color: "var(--accent-primary)",
              background: "transparent",
              border: "1px solid var(--accent-primary)",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            + Add
          </button>
        </div>

        {/* Add students form */}
        {showAddStudents && (
          <form onSubmit={handleAddStudents} style={{ marginBottom: "16px", padding: "12px", background: "#f8fafc", borderRadius: "8px" }}>
            <textarea
              value={studentNames}
              onChange={(e) => setStudentNames(e.target.value)}
              placeholder="Enter student names (comma or newline separated)"
              rows={3}
              autoFocus
              style={{
                width: "100%",
                padding: "10px",
                fontSize: "0.85rem",
                border: "1px solid #e2e8f0",
                borderRadius: "6px",
                resize: "vertical",
                fontFamily: "inherit",
                boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
              <button
                type="button"
                onClick={() => { setShowAddStudents(false); setStudentNames(""); }}
                style={{ flex: 1, padding: "8px", fontSize: "0.8rem", background: "white", border: "1px solid #e2e8f0", borderRadius: "4px", cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!studentNames.trim() || addingStudents}
                style={{
                  flex: 1,
                  padding: "8px",
                  fontSize: "0.8rem",
                  fontWeight: 500,
                  background: !studentNames.trim() || addingStudents ? "#e2e8f0" : "var(--accent-primary)",
                  color: !studentNames.trim() || addingStudents ? "#94a3b8" : "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: !studentNames.trim() || addingStudents ? "not-allowed" : "pointer",
                }}
              >
                {addingStudents ? "Adding..." : "Add Students"}
              </button>
            </div>
          </form>
        )}

        {/* Student list */}
        {classData.students.length === 0 ? (
          <div style={{ textAlign: "center", padding: "24px", background: "#f8fafc", borderRadius: "8px" }}>
            <p style={{ margin: 0, color: "#64748b", fontSize: "0.85rem" }}>
              No students yet. Add students to begin tracking progress.
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {classData.students.map((student) => (
              <div
                key={student.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 12px",
                  background: "white",
                  borderRadius: "6px",
                  border: "1px solid #f1f5f9",
                }}
              >
                <span
                  style={{ fontWeight: 500, color: "#333", fontSize: "0.9rem", cursor: "pointer" }}
                  onClick={() => onNavigateToStudent(student.id, classData.id, classData.name)}
                >
                  {student.name}
                </span>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    onClick={() => onNavigateToStudent(student.id, classData.id, classData.name)}
                    style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--accent-primary)", fontSize: "0.75rem" }}
                  >
                    View
                  </button>
                  <button
                    onClick={() => handleRemoveStudent(student.id, student.name)}
                    style={{ background: "transparent", border: "none", cursor: "pointer", color: "#999", fontSize: "0.75rem" }}
                    onMouseEnter={(e) => e.currentTarget.style.color = "#dc2626"}
                    onMouseLeave={(e) => e.currentTarget.style.color = "#999"}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// Create Lesson Drawer Content
// ============================================

interface CreateLessonDrawerContentProps {
  onClose: () => void;
  onLessonCreated: (lessonId: string) => void;
  classes: ClassSummary[];
  editingDraft?: LessonDraft | null;
  onDraftSaved?: () => void;
}

function CreateLessonDrawerContent({
  onClose,
  onLessonCreated,
  classes,
  editingDraft,
  onDraftSaved,
}: CreateLessonDrawerContentProps) {
  const { showError, showSuccess } = useToast();

  // Get teacher preferences for defaults
  const lastSettings = getLastUsedSettings();
  const suggestedQuestionCount = getSuggestedQuestionCount();

  // Form state - use draft values if editing, otherwise use last settings
  const [title, setTitle] = useState(editingDraft?.title || "");
  const [subject, setSubject] = useState(editingDraft?.subject || lastSettings.subject || "");
  const [gradeLevel, setGradeLevel] = useState(editingDraft?.gradeLevel || lastSettings.gradeLevel || "");
  const [difficulty, setDifficulty] = useState<"beginner" | "intermediate" | "advanced">("intermediate");
  const [questionCount, setQuestionCount] = useState(editingDraft?.questionCount || suggestedQuestionCount);
  const [description, setDescription] = useState(editingDraft?.description || "");
  const [assignToClassId, setAssignToClassId] = useState(editingDraft?.assignToClassId || "");
  const [isCreating, setIsCreating] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(editingDraft?.id || null);

  // Validation - only title and subject are required
  const isValid = title.trim() && subject;

  // Handle create lesson with AI generation
  const handleCreateLesson = async () => {
    if (!title.trim()) {
      showError("Please enter a lesson topic.");
      return;
    }
    if (!subject) {
      showError("Please select a subject.");
      return;
    }

    setIsCreating(true);
    try {
      // Build content for AI generation
      const contentParts = [title.trim()];
      if (description.trim()) {
        contentParts.push(description.trim());
      }

      // Get teacher preferences context for personalized generation
      const teacherContext = buildGenerationContext();
      if (teacherContext) {
        contentParts.push(`Teacher style notes: ${teacherContext}`);
      }

      // Generate lesson with AI
      const generatedLesson = await generateLesson({
        mode: "topic",
        content: contentParts.join(". "),
        difficulty,
        questionCount,
        gradeLevel: gradeLevel || undefined,
      });

      // Update the generated lesson with our metadata
      // Use the AI-generated title (based on topic + learning objectives)
      const lessonToSave: Lesson = {
        ...generatedLesson,
        id: `lesson-${Date.now()}`,
        // Keep the AI-generated title - it's more specific and student-friendly
        description: description.trim() || generatedLesson.description,
        subject: subject,
        gradeLevel: gradeLevel || undefined,
        difficulty,
      };

      // Save the lesson
      const { lesson: savedLesson } = await saveLesson(lessonToSave);

      // Record lesson creation for preference learning
      recordLessonCreated(questionCount);

      // Save last used settings for next time
      saveLastUsedSettings({
        questionCount,
        subject,
        gradeLevel: gradeLevel || undefined,
      });

      // Assign to class if selected
      if (assignToClassId) {
        try {
          await assignLessonToClass(savedLesson.id, assignToClassId);
          const selectedClass = classes.find(c => c.id === assignToClassId);
          showSuccess(`Lesson created and assigned to ${selectedClass?.name || "class"}`);
        } catch (assignErr) {
          console.error("Failed to assign lesson:", assignErr);
          // Still continue - lesson was created successfully
          showSuccess("Lesson created. Assignment failed - you can assign it later.");
        }
      }

      // Delete the draft if we were editing one
      if (currentDraftId) {
        try {
          await deleteLessonDraft(currentDraftId);
        } catch (err) {
          console.error("Failed to delete draft:", err);
          // Non-critical error, continue
        }
      }

      onLessonCreated(savedLesson.id);
    } catch (err) {
      console.error("Failed to create lesson:", err);
      showError("Failed to create lesson. Please try again.");
      setIsCreating(false);
    }
  };

  // Handle save draft to server
  const handleSaveDraft = async () => {
    if (!title && !subject && !description) {
      showError("Please add some content before saving a draft.");
      return;
    }

    setIsSavingDraft(true);
    try {
      const draftInput = {
        title,
        subject,
        gradeLevel,
        questionCount,
        description,
        assignToClassId: assignToClassId || undefined,
      };

      if (currentDraftId) {
        // Update existing draft
        await updateLessonDraft(currentDraftId, draftInput);
        showSuccess("Draft updated");
      } else {
        // Create new draft
        const { draft } = await createLessonDraft(draftInput);
        setCurrentDraftId(draft.id);
        showSuccess("Draft saved");
      }

      onDraftSaved?.();
      onClose();
    } catch (err) {
      console.error("Failed to save draft:", err);
      showError("Failed to save draft. Please try again.");
    } finally {
      setIsSavingDraft(false);
    }
  };

  // Common subjects for dropdown
  const commonSubjects = ["Reading", "Math", "Science", "Writing", "Social Studies", "Art"];

  // Grade levels
  const gradeLevels = [
    { value: "K", label: "Kindergarten" },
    { value: "1", label: "1st Grade" },
    { value: "2", label: "2nd Grade" },
    { value: "3", label: "3rd Grade" },
    { value: "4", label: "4th Grade" },
    { value: "5", label: "5th Grade" },
    { value: "6", label: "6th Grade" },
    { value: "7", label: "7th Grade" },
    { value: "8", label: "8th Grade" },
  ];

  const hasContent = title || subject || description;

  // Creating state UI
  if (isCreating) {
    return (
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        padding: "40px 20px",
        textAlign: "center",
      }}>
        <div style={{
          width: "48px",
          height: "48px",
          border: "3px solid #e2e8f0",
          borderTopColor: "var(--accent-primary)",
          borderRadius: "50%",
          animation: "spin 1s linear infinite",
          marginBottom: "20px",
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <p style={{
          fontSize: "1rem",
          fontWeight: 600,
          color: "#374151",
          margin: "0 0 8px 0",
        }}>
          Creating your lesson...
        </p>
        <p style={{
          fontSize: "0.85rem",
          color: "#64748b",
          margin: 0,
        }}>
          Generating {questionCount} question{questionCount !== 1 ? "s" : ""} with hints
          {assignToClassId && (
            <>
              <br />
              <span style={{ marginTop: "4px", display: "inline-block" }}>
                Then assigning to {classes.find(c => c.id === assignToClassId)?.name || "class"}
              </span>
            </>
          )}
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Form Content */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {/* Topic */}
        <div style={{ marginBottom: "20px" }}>
          <label
            style={{
              display: "block",
              fontSize: "0.8rem",
              fontWeight: 600,
              color: "#374151",
              marginBottom: "6px",
            }}
          >
            Lesson Topic <span style={{ color: "#dc2626" }}>*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., Subtraction, Ancient Egypt, Ocean Animals"
            autoFocus
            style={{
              width: "100%",
              padding: "12px 14px",
              fontSize: "0.95rem",
              border: "1px solid #e2e8f0",
              borderRadius: "8px",
              boxSizing: "border-box",
              transition: "border-color 0.15s ease",
            }}
            onFocus={(e) => e.currentTarget.style.borderColor = "var(--accent-primary)"}
            onBlur={(e) => e.currentTarget.style.borderColor = "#e2e8f0"}
          />
        </div>

        {/* Subject & Grade Row */}
        <div style={{ display: "flex", gap: "12px", marginBottom: "20px" }}>
          <div style={{ flex: 1 }}>
            <label
              style={{
                display: "block",
                fontSize: "0.8rem",
                fontWeight: 600,
                color: "#374151",
                marginBottom: "6px",
              }}
            >
              Subject <span style={{ color: "#dc2626" }}>*</span>
            </label>
            <select
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              style={{
                width: "100%",
                padding: "12px 14px",
                fontSize: "0.9rem",
                border: "1px solid #e2e8f0",
                borderRadius: "8px",
                background: "white",
                cursor: "pointer",
              }}
            >
              <option value="">Select...</option>
              {commonSubjects.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
              <option value="Other">Other</option>
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label
              style={{
                display: "block",
                fontSize: "0.8rem",
                fontWeight: 600,
                color: "#374151",
                marginBottom: "6px",
              }}
            >
              Grade Level <span style={{ fontWeight: 400, color: "#94a3b8" }}>(optional)</span>
            </label>
            <select
              value={gradeLevel}
              onChange={(e) => setGradeLevel(e.target.value)}
              style={{
                width: "100%",
                padding: "12px 14px",
                fontSize: "0.9rem",
                border: "1px solid #e2e8f0",
                borderRadius: "8px",
                background: "white",
                cursor: "pointer",
              }}
            >
              <option value="">Select...</option>
              {gradeLevels.map((g) => (
                <option key={g.value} value={g.value}>{g.label}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label
              style={{
                display: "block",
                fontSize: "0.8rem",
                fontWeight: 600,
                color: "#374151",
                marginBottom: "6px",
              }}
            >
              Difficulty
            </label>
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as "beginner" | "intermediate" | "advanced")}
              style={{
                width: "100%",
                padding: "12px 14px",
                fontSize: "0.9rem",
                border: "1px solid #e2e8f0",
                borderRadius: "8px",
                background: "white",
                cursor: "pointer",
              }}
            >
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
          </div>
        </div>

        {/* Description */}
        <div style={{ marginBottom: "20px" }}>
          <label
            style={{
              display: "block",
              fontSize: "0.8rem",
              fontWeight: 600,
              color: "#374151",
              marginBottom: "6px",
            }}
          >
            What will students learn? <span style={{ fontWeight: 400, color: "#94a3b8" }}>(optional)</span>
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add context to help generate better questions..."
            rows={2}
            style={{
              width: "100%",
              padding: "12px 14px",
              fontSize: "0.9rem",
              border: "1px solid #e2e8f0",
              borderRadius: "8px",
              resize: "vertical",
              fontFamily: "inherit",
              boxSizing: "border-box",
              transition: "border-color 0.15s ease",
            }}
            onFocus={(e) => e.currentTarget.style.borderColor = "var(--accent-primary)"}
            onBlur={(e) => e.currentTarget.style.borderColor = "#e2e8f0"}
          />
        </div>

        {/* Question Count Slider */}
        <div style={{ marginBottom: "20px" }}>
          <label
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: "0.8rem",
              fontWeight: 600,
              color: "#374151",
              marginBottom: "10px",
            }}
          >
            <span>Number of questions</span>
            <span style={{
              fontSize: "0.9rem",
              fontWeight: 700,
              color: "var(--accent-primary)",
              background: "#f0f4ff",
              padding: "4px 10px",
              borderRadius: "12px",
            }}>
              {questionCount} question{questionCount !== 1 ? "s" : ""}
            </span>
          </label>
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
          }}>
            <span style={{ fontSize: "0.75rem", color: "#94a3b8", minWidth: "16px" }}>1</span>
            <input
              type="range"
              min={1}
              max={10}
              value={questionCount}
              onChange={(e) => setQuestionCount(parseInt(e.target.value, 10))}
              style={{
                flex: 1,
                height: "6px",
                borderRadius: "3px",
                background: `linear-gradient(to right, var(--accent-primary) 0%, var(--accent-primary) ${((questionCount - 1) / 9) * 100}%, #e2e8f0 ${((questionCount - 1) / 9) * 100}%, #e2e8f0 100%)`,
                appearance: "none",
                cursor: "pointer",
              }}
            />
            <span style={{ fontSize: "0.75rem", color: "#94a3b8", minWidth: "16px" }}>10</span>
          </div>
        </div>

        {/* Assign to Class (optional) */}
        {classes.length > 0 && (
          <div style={{ marginBottom: "20px" }}>
            <label
              style={{
                display: "block",
                fontSize: "0.8rem",
                fontWeight: 600,
                color: "#374151",
                marginBottom: "6px",
              }}
            >
              Assign to class <span style={{ fontWeight: 400, color: "#94a3b8" }}>(optional)</span>
            </label>
            <select
              value={assignToClassId}
              onChange={(e) => setAssignToClassId(e.target.value)}
              style={{
                width: "100%",
                padding: "12px 14px",
                fontSize: "0.9rem",
                border: "1px solid #e2e8f0",
                borderRadius: "8px",
                background: "white",
                cursor: "pointer",
              }}
            >
              <option value="">Don't assign yet</option>
              {classes.map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {cls.name}{cls.gradeLevel ? ` (${cls.gradeLevel})` : ""} — {cls.studentCount} student{cls.studentCount !== 1 ? "s" : ""}
                </option>
              ))}
            </select>
            {assignToClassId && (
              <p style={{
                margin: "6px 0 0 0",
                fontSize: "0.75rem",
                color: "#64748b",
              }}>
                All students in this class will receive the lesson.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div
        style={{
          borderTop: "1px solid #e2e8f0",
          paddingTop: "20px",
          marginTop: "auto",
        }}
      >
        {/* Reassurance microcopy - above button */}
        <p
          style={{
            margin: "0 0 16px 0",
            fontSize: "0.8rem",
            color: "#64748b",
            textAlign: "center",
            lineHeight: 1.5,
            background: "#f8fafc",
            padding: "10px 14px",
            borderRadius: "8px",
          }}
        >
          Questions and hints will be generated automatically. You can edit everything after.
        </p>

        {/* Primary CTA */}
        <button
          onClick={handleCreateLesson}
          disabled={!isValid}
          style={{
            width: "100%",
            padding: "14px 20px",
            fontSize: "0.95rem",
            fontWeight: 600,
            background: !isValid
              ? "#e2e8f0"
              : "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
            color: !isValid ? "#94a3b8" : "white",
            border: "none",
            borderRadius: "8px",
            cursor: !isValid ? "not-allowed" : "pointer",
            transition: "all 0.15s ease",
          }}
        >
          Create Lesson
        </button>

        {/* Secondary actions */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "16px",
            marginTop: "16px",
            paddingTop: "16px",
            borderTop: "1px solid #f1f5f9",
          }}
        >
          <button
            onClick={handleSaveDraft}
            disabled={!hasContent || isSavingDraft}
            style={{
              padding: "8px 16px",
              fontSize: "0.8rem",
              color: hasContent && !isSavingDraft ? "#64748b" : "#cbd5e1",
              background: "transparent",
              border: "none",
              cursor: hasContent && !isSavingDraft ? "pointer" : "not-allowed",
            }}
          >
            {isSavingDraft ? "Saving..." : currentDraftId ? "Update Draft" : "Save Draft"}
          </button>
          <button
            onClick={onClose}
            style={{
              padding: "8px 16px",
              fontSize: "0.8rem",
              color: "#64748b",
              background: "transparent",
              border: "none",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      </div>

      {/* Draft indicator */}
      {editingDraft && (
        <div
          style={{
            marginTop: "12px",
            fontSize: "0.7rem",
            color: "#cbd5e1",
            textAlign: "center",
          }}
        >
          Editing draft from {new Date(editingDraft.updatedAt).toLocaleDateString()}
        </div>
      )}
    </div>
  );
}

// ============================================
// Assign Lesson Drawer Content
// ============================================

interface AssignLessonDrawerContentProps {
  lesson: LessonSummary;
  classes: ClassSummary[];
  onCancel: () => void;
  onAssigned: () => void;
}

function AssignLessonDrawerContent({
  lesson,
  classes,
  onCancel,
  onAssigned,
}: AssignLessonDrawerContentProps) {
  const { showSuccess, showError } = useToast();

  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const [selectedClass, setSelectedClass] = useState<ClassWithStudents | null>(null);
  const [assignMode, setAssignMode] = useState<"all" | "select">("all");
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());
  const [dueDate, setDueDate] = useState<string>("");
  const [assigning, setAssigning] = useState(false);
  const [loadingClass, setLoadingClass] = useState(false);

  // Load class details when class selection changes
  const handleClassChange = async (newClassId: string) => {
    setSelectedClassId(newClassId);
    setSelectedStudentIds(new Set());
    setSelectedClass(null);

    if (newClassId) {
      setLoadingClass(true);
      try {
        const classData = await getClass(newClassId);
        setSelectedClass(classData);
      } catch (err) {
        console.error("Failed to load class:", err);
        showError("Failed to load class details");
      } finally {
        setLoadingClass(false);
      }
    }
  };

  const classStudents = selectedClass?.students || [];

  const handleAssign = async () => {
    if (!selectedClassId) return;

    setAssigning(true);
    try {
      const studentIds = assignMode === "select"
        ? Array.from(selectedStudentIds)
        : undefined;

      const result = await assignLessonToClass(
        lesson.id,
        selectedClassId,
        studentIds,
        dueDate || undefined
      );

      showSuccess(`Assigned to ${result.assignedCount} student${result.assignedCount !== 1 ? "s" : ""} in ${result.className}`);
      onAssigned();
    } catch (err) {
      console.error("Failed to assign lesson:", err);
      showError("Failed to assign lesson. Please try again.");
      setAssigning(false);
    }
  };

  const toggleStudent = (studentId: string) => {
    const newSelected = new Set(selectedStudentIds);
    if (newSelected.has(studentId)) {
      newSelected.delete(studentId);
    } else {
      newSelected.add(studentId);
    }
    setSelectedStudentIds(newSelected);
  };

  const selectAllStudents = () => {
    setSelectedStudentIds(new Set(classStudents.map((s) => s.id)));
  };

  const deselectAllStudents = () => {
    setSelectedStudentIds(new Set());
  };

  const canAssign =
    selectedClassId &&
    classStudents.length > 0 &&
    (assignMode === "all" || selectedStudentIds.size > 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Scrollable content */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {/* Lesson info */}
        <div
          style={{
            padding: "12px 16px",
            background: "var(--status-info-bg)",
            borderRadius: "8px",
            marginBottom: "20px",
          }}
        >
          <div style={{ fontWeight: 600, color: "var(--status-info-text)" }}>
            {lesson.title}
          </div>
          <div style={{ fontSize: "0.85rem", color: "#64748b", marginTop: "4px" }}>
            {lesson.promptCount} question{lesson.promptCount !== 1 ? "s" : ""}
            {lesson.subject && ` · ${lesson.subject}`}
          </div>
        </div>

        {/* Step 1: Select Class */}
        <div style={{ marginBottom: "20px" }}>
          <label
            style={{
              display: "block",
              fontSize: "0.85rem",
              fontWeight: 600,
              color: "#374151",
              marginBottom: "8px",
            }}
          >
            1. Select Class
          </label>

          {classes.length === 0 ? (
            <div style={{ padding: "16px", background: "#f9fafb", borderRadius: "8px", textAlign: "center" }}>
              <p style={{ color: "#666", margin: "0 0 12px 0", fontSize: "0.9rem" }}>
                No classes yet. Create a class first to assign lessons.
              </p>
            </div>
          ) : (
            <select
              value={selectedClassId}
              onChange={(e) => handleClassChange(e.target.value)}
              style={{
                width: "100%",
                padding: "12px 14px",
                fontSize: "0.9rem",
                borderRadius: "8px",
                border: "1px solid #e2e8f0",
                background: "white",
              }}
            >
              <option value="">Select a class...</option>
              {classes.map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {cls.name} ({cls.studentCount} students)
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Loading class indicator */}
        {loadingClass && (
          <div style={{ textAlign: "center", padding: "16px", color: "#64748b" }}>
            Loading class details...
          </div>
        )}

        {/* Step 2: Choose Students */}
        {selectedClass && classStudents.length > 0 && (
          <div style={{ marginBottom: "20px" }}>
            <label
              style={{
                display: "block",
                fontSize: "0.85rem",
                fontWeight: 600,
                color: "#374151",
                marginBottom: "8px",
              }}
            >
              2. Choose Students
            </label>

            <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
              <button
                onClick={() => setAssignMode("all")}
                style={{
                  flex: 1,
                  padding: "10px 12px",
                  fontSize: "0.85rem",
                  background: assignMode === "all" ? "var(--accent-primary)" : "#f1f5f9",
                  color: assignMode === "all" ? "white" : "#374151",
                  border: "none",
                  borderRadius: "6px",
                  cursor: "pointer",
                }}
              >
                All Students ({classStudents.length})
              </button>
              <button
                onClick={() => setAssignMode("select")}
                style={{
                  flex: 1,
                  padding: "10px 12px",
                  fontSize: "0.85rem",
                  background: assignMode === "select" ? "var(--accent-primary)" : "#f1f5f9",
                  color: assignMode === "select" ? "white" : "#374151",
                  border: "none",
                  borderRadius: "6px",
                  cursor: "pointer",
                }}
              >
                Select Students
              </button>
            </div>

            {assignMode === "select" && (
              <div>
                <div style={{ display: "flex", gap: "12px", marginBottom: "8px" }}>
                  <button
                    onClick={selectAllStudents}
                    style={{
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--accent-primary)",
                      fontSize: "0.8rem",
                    }}
                  >
                    Select All
                  </button>
                  <button
                    onClick={deselectAllStudents}
                    style={{
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--accent-primary)",
                      fontSize: "0.8rem",
                    }}
                  >
                    Deselect All
                  </button>
                  <span style={{ color: "#64748b", fontSize: "0.8rem" }}>
                    {selectedStudentIds.size} selected
                  </span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "200px", overflow: "auto" }}>
                  {classStudents.map((student) => (
                    <label
                      key={student.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        padding: "10px 12px",
                        background: selectedStudentIds.has(student.id) ? "#e8f5e9" : "#f9fafb",
                        borderRadius: "6px",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedStudentIds.has(student.id)}
                        onChange={() => toggleStudent(student.id)}
                        style={{ width: "16px", height: "16px" }}
                      />
                      <span style={{ fontSize: "0.9rem" }}>{student.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Empty class warning */}
        {selectedClass && classStudents.length === 0 && (
          <div
            style={{
              padding: "12px 16px",
              background: "#fff3e0",
              borderRadius: "8px",
              borderLeft: "3px solid #ff9800",
              marginBottom: "20px",
            }}
          >
            <p style={{ margin: 0, color: "#e65100", fontSize: "0.9rem" }}>
              This class has no students. Add students before assigning lessons.
            </p>
          </div>
        )}

        {/* Step 3: Due Date (Optional) */}
        {selectedClass && classStudents.length > 0 && (
          <div style={{ marginBottom: "20px" }}>
            <label
              style={{
                display: "block",
                fontSize: "0.85rem",
                fontWeight: 600,
                color: "#374151",
                marginBottom: "8px",
              }}
            >
              3. Due Date <span style={{ fontWeight: 400, color: "#94a3b8" }}>(optional)</span>
            </label>

            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                min={new Date().toISOString().split("T")[0]}
                style={{
                  padding: "10px 12px",
                  fontSize: "0.9rem",
                  borderRadius: "6px",
                  border: "1px solid #e2e8f0",
                  width: "180px",
                }}
              />
              {dueDate && (
                <button
                  onClick={() => setDueDate("")}
                  style={{
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    color: "#64748b",
                    fontSize: "0.85rem",
                  }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer with actions */}
      <div
        style={{
          padding: "16px 0 0 0",
          borderTop: "1px solid #e2e8f0",
          display: "flex",
          gap: "12px",
        }}
      >
        <button
          onClick={onCancel}
          style={{
            flex: 1,
            padding: "12px",
            fontSize: "0.9rem",
            background: "#f1f5f9",
            color: "#374151",
            border: "none",
            borderRadius: "8px",
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
        <button
          onClick={handleAssign}
          disabled={!canAssign || assigning}
          style={{
            flex: 1,
            padding: "12px",
            fontSize: "0.9rem",
            background: canAssign && !assigning ? "var(--accent-primary)" : "#e2e8f0",
            color: canAssign && !assigning ? "white" : "#94a3b8",
            border: "none",
            borderRadius: "8px",
            cursor: canAssign && !assigning ? "pointer" : "not-allowed",
          }}
        >
          {assigning ? "Assigning..." : "Assign Lesson"}
        </button>
      </div>
    </div>
  );
}
