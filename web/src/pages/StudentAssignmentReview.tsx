/**
 * Student Assignment Review (Drilldown)
 *
 * Design Philosophy:
 * - Teacher notes are primary, always visible at top
 * - Questions collapsed by default to reduce cognitive load
 * - Learning journey insights before raw transcripts
 * - Expand only what you need
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, Link, useLocation } from "react-router-dom";
import {
  getLesson,
  getSessions,
  getStudent,
  updateSession,
  getStudentAssignment,
  markStudentReviewed,
  unmarkStudentReviewed,
  appendSystemNote,
  pushAssignmentToStudent,
  submitReviewActions,
  getBadgeTypes,
  createCoachingInvite,
  getRecommendations,
  dismissRecommendation,
  markRecommendationReviewed,
  getTeacherTodo,
  deleteTeacherTodo,
  completeTeacherTodo,
  reopenTeacherTodo,
  supersedeTeacherTodo,
  reactivateRecommendation,
  type Session,
  type Lesson,
  type Student,
  type StudentAssignment,
  type BadgeTypeInfo,
  type ReviewState,
  type Recommendation,
  type TeacherTodo,
  type DerivedInsight,
  type TeacherWorkflowStatus,
  CHECKLIST_ACTIONS,
  REVIEW_STATE_LABELS,
  WORKFLOW_STATUS_LABELS,
  WORKFLOW_STATUS_COLORS,
  isAttentionNowRecommendation,
  getStudentAssignmentDerivedInsights,
  computeTeacherWorkflowStatus,
  resolveAllInsightsForStudent,
  reactivateInsightsForStudent,
} from "../services/api";
import Drawer from "../components/Drawer";
import EducatorAppHeader from "../components/EducatorAppHeader";
import { useToast } from "../components/Toast";
import {
  buildStudentDrilldown,
  getUnderstandingLabel,
  getUnderstandingColor,
  getUnderstandingBgColor,
  getCoachSupportLabel,
  getQuestionOutcomeLabel,
  calculateQuestionOutcome,
} from "../utils/teacherDashboardUtils";
import { getCategoryConfig } from "../utils/recommendationConfig";
import type { StudentDrilldownData, QuestionOutcome } from "../types/teacherDashboard";

// Type for a conversation turn in video transcript
interface ConversationTurn {
  role: "coach" | "student";
  message: string;
  timestampSec: number;
}

// Type for a single attempt at a question
interface QuestionAttempt {
  sessionId: string;
  attemptNumber: number;
  sessionDate: string;
  response: string;
  outcome: QuestionOutcome;
  usedHint: boolean;
  hasVoiceRecording: boolean;
  audioBase64?: string;
  audioFormat?: string;
  hasVideoRecording: boolean;
  videoUrl?: string;
  videoDurationSec?: number;
  videoCreatedAt?: string;
  conversationTurns?: ConversationTurn[];
  score?: number;
  educatorNote?: string;
  // Stagnation deferral tracking (informational for teachers)
  deferredByCoach?: boolean;
  deferralMetadata?: {
    reason: "stagnation";
    pattern?: string; // "repeated-error" | "persistent-uncertainty" | "no-progress"
    attemptCount?: number;
    deferredAt?: string;
  };
}

// Type for a question with all attempts across sessions
interface QuestionWithAttempts {
  questionId: string;
  questionNumber: number;
  questionText: string;
  totalHintsAvailable: number;
  attempts: QuestionAttempt[];
}

// ============================================
// Recommendation Logic (per schema)
// ============================================

// Human-readable labels for recommendation types
const RECOMMENDATION_TYPE_LABELS: Record<string, string> = {
  // From insightType (actual backend values)
  "challenge_opportunity": "Extend learning",
  "celebrate_progress": "Celebrate progress",
  "check_in": "Needs support",
  "monitor": "Monitor",
  // Legacy/alternate forms
  "extend_learning": "Extend learning",
  "needs_support": "Needs support",
  "challenge-opportunity": "Extend learning",
  "celebrate-progress": "Celebrate progress",
  "needs-support": "Needs support",
  "group-review": "Group review",
  "check-in-suggested": "Needs support",
  "developing": "Needs support",
  "individual-checkin": "Needs support",
  "small-group": "Group review",
  "enrichment": "Extend learning",
  "celebrate": "Celebrate progress",
  "ready-for-challenge": "Extend learning",
  "notable-improvement": "Celebrate progress",
  "persistence": "Celebrate progress",
  "watch-progress": "Monitor",
};

/**
 * Checks if a recommendation is actionable.
 * A recommendation is actionable if:
 * 1. Status is "active"
 * 2. Has a recognized insight type/category
 */
function isRecommendationActionable(recommendation: Recommendation | null): boolean {
  if (!recommendation) return false;
  if (recommendation.status !== "active") return false;

  // Check that we have a recognized category to derive actions from
  const category =
    recommendation.insightType ||
    recommendation.triggerData?.ruleName ||
    (recommendation as any).type ||
    "";

  // TEMP debugging log (do not remove)
  console.log("isRecommendationActionable - status:", recommendation.status, "category:", category);

  // Category must exist for us to derive actions
  return !!category;
}

/**
 * Gets the human-readable type label for a recommendation.
 * Checks multiple possible sources for the type.
 */
function getRecommendationTypeLabel(recommendation: Recommendation): string {
  // Try various sources for the recommendation type
  const recType =
    recommendation.insightType ||
    recommendation.type ||
    (recommendation.triggerData?.signals?.recommendationType as string) ||
    "";

  return RECOMMENDATION_TYPE_LABELS[recType] || RECOMMENDATION_TYPE_LABELS[recType.toLowerCase()] || "Review";
}

/**
 * Derives UI action types from recommendation based on insight type and data.
 *
 * Actions are derived from:
 * 1. insightType/ruleName → category → default actions
 * 2. suggestedBadge presence → include "badge" action
 *
 * UI action types: "badge" | "todo" | "coaching"
 */
function getSuggestedActions(recommendation: Recommendation): string[] {
  const actions: string[] = [];

  // Get the category from insight type or rule name
  const category: string =
    recommendation.insightType ||
    recommendation.triggerData?.ruleName ||
    (recommendation as any).type ||
    "";

  // Category-based action mapping (aligned with backend getChecklistActionsForCategory)
  switch (category) {
    case "challenge_opportunity":
    case "enrichment":
    case "ready-for-challenge":
      // High performers: badge, coaching (extension), todo for follow-up
      actions.push("badge", "coaching", "todo");
      break;

    case "celebrate_progress":
    case "celebrate":
    case "notable-improvement":
    case "persistence":
      // Celebration: primarily badge
      actions.push("badge", "todo");
      break;

    case "check_in":
    case "individual-checkin":
    case "needs-support":
    case "developing":
    case "check-in-suggested":
      // Support needed: todo for follow-up, coaching for intervention
      actions.push("todo", "coaching");
      break;

    case "monitor":
    case "watch-progress":
      // Monitoring: just todo for tracking
      actions.push("todo");
      break;

    default:
      // Fallback: offer all actions
      actions.push("badge", "todo", "coaching");
  }

  // If there's a specific badge suggestion, ensure badge is first
  if ((recommendation as any).suggestedBadge) {
    const badgeIndex = actions.indexOf("badge");
    if (badgeIndex > 0) {
      actions.splice(badgeIndex, 1);
      actions.unshift("badge");
    } else if (badgeIndex === -1) {
      actions.unshift("badge");
    }
  }

  // TEMP debugging log (do not remove)
  console.log("getSuggestedActions - category:", category, "actions:", actions, "hasBadge:", !!(recommendation as any).suggestedBadge);

  return actions;
}

/**
 * Gets raw action strings from recommendation for debugging.
 * These are human-readable descriptions, not action types.
 */
function getSuggestedActionsRaw(recommendation: Recommendation | null): string[] {
  if (!recommendation) return [];
  return recommendation.suggestedTeacherActions || [];
}

/**
 * Determines if a recommendation is for support/intervention (vs enrichment).
 * Used to show appropriate coaching session labels.
 */
function isRecommendationForSupport(recommendation: Recommendation | null): boolean {
  if (!recommendation) return false;

  const category =
    recommendation.insightType ||
    recommendation.triggerData?.ruleName ||
    (recommendation as any).type ||
    "";

  const supportTypes = [
    "check_in",
    "individual-checkin",
    "needs-support",
    "developing",
    "check-in-suggested",
    "group-support",
    "small-group",
  ];

  return supportTypes.includes(category);
}

// ============================================
// Session Focus Suggestion Engine
// ============================================

interface SuggestedSessionFocus {
  /** 2–4 actionable bullets for the callout box */
  bullets: string[];
  /** Short "Based on:" signals (e.g., "Q1 Still Developing + hint used") */
  basedOn: string[];
  /** Clean text for auto-filling the Session focus textarea */
  autofillText: string;
}

interface AnalyzedQuestion {
  question: QuestionWithAttempts;
  outcome: QuestionOutcome;
  usedHint: boolean;
  response: string;
  score: number | undefined;
  /** Lower = weaker. developing=0, not-attempted=1, with-support=2, demonstrated=3 */
  rank: number;
}

const OUTCOME_RANK: Record<QuestionOutcome, number> = {
  "developing": 0,
  "not-attempted": 1,
  "with-support": 2,
  "demonstrated": 3,
};

const OUTCOME_LABELS: Record<QuestionOutcome, string> = {
  "developing": "Still Developing",
  "not-attempted": "Not Attempted",
  "with-support": "Succeeded with Support",
  "demonstrated": "Demonstrated Understanding",
};

function analyzeQuestions(questions: QuestionWithAttempts[]): AnalyzedQuestion[] {
  return questions.map((q) => {
    const latest = q.attempts[q.attempts.length - 1];
    if (!latest) {
      return { question: q, outcome: "not-attempted" as QuestionOutcome, usedHint: false, response: "", score: undefined, rank: 1 };
    }
    return {
      question: q,
      outcome: latest.outcome,
      usedHint: latest.usedHint,
      response: latest.response,
      score: latest.score,
      rank: OUTCOME_RANK[latest.outcome] ?? 1,
    };
  });
}

/**
 * Detect skill gaps from the student's responses.
 * Returns actionable coaching bullets and signals.
 */
function getSuggestedSessionFocus(questions: QuestionWithAttempts[]): SuggestedSessionFocus {
  const empty: SuggestedSessionFocus = { bullets: [], basedOn: [], autofillText: "" };
  if (questions.length === 0) return empty;

  const analyzed = analyzeQuestions(questions);
  const weak = analyzed.filter((a) => a.rank <= 1); // developing or not-attempted
  const supported = analyzed.filter((a) => a.outcome === "with-support");
  const hintHeavy = analyzed.filter((a) => a.usedHint && a.rank < 3);

  // Pick the top 1–2 focus questions (weakest first, then supported-with-hints)
  const focusQuestions: AnalyzedQuestion[] = [];
  for (const q of [...weak, ...supported.filter((s) => s.usedHint)]) {
    if (focusQuestions.length >= 2) break;
    if (!focusQuestions.some((f) => f.question.questionId === q.question.questionId)) {
      focusQuestions.push(q);
    }
  }
  // If nothing weak at all, pick the first supported question
  if (focusQuestions.length === 0 && supported.length > 0) {
    focusQuestions.push(supported[0]);
  }
  // Last resort: first question
  if (focusQuestions.length === 0 && analyzed.length > 0) {
    focusQuestions.push(analyzed[0]);
  }

  // --- Build "Based on" signals ---
  const basedOn: string[] = focusQuestions.map((fq) => {
    const label = OUTCOME_LABELS[fq.outcome];
    const hint = fq.usedHint ? " + hint used" : "";
    return `Q${fq.question.questionNumber} ${label}${hint}`;
  });

  // --- Detect skill patterns across focus questions ---
  const bullets: string[] = [];

  // 1. Short / thin responses → reasoning depth
  const hasShortResponse = focusQuestions.some((fq) => {
    const words = fq.response.trim().split(/\s+/).length;
    return words > 0 && words < 12;
  });
  if (hasShortResponse) {
    bullets.push("Practice explaining your thinking using 2 reasons or examples.");
  }

  // 2. Topic-specific bullet referencing the weakest question
  if (focusQuestions.length > 0) {
    const primary = focusQuestions[0];
    const topic = extractTopicPhrase(primary.question.questionText);
    if (primary.outcome === "developing") {
      bullets.push(`Work on ${topic} — try answering in your own words first.`);
    } else if (primary.outcome === "with-support") {
      bullets.push(`Focus on ${topic} without relying on hints.`);
    } else if (primary.outcome === "not-attempted") {
      bullets.push(`Try ${topic} together during the session.`);
    }
  }

  // 3. Second weak question if present
  if (focusQuestions.length > 1) {
    const secondary = focusQuestions[1];
    const topic = extractTopicPhrase(secondary.question.questionText);
    bullets.push(`Also practice ${topic}.`);
  }

  // 4. Hint dependence (if multiple questions used hints)
  if (hintHeavy.length >= 2) {
    bullets.push("Try answering before checking hints — build confidence first.");
  } else if (hintHeavy.length === 1 && !bullets.some((b) => b.includes("hint"))) {
    bullets.push("Practice answering without hints, then check after.");
  }

  // 5. Sentence completeness (if short responses detected but not already addressed)
  if (hasShortResponse && !bullets.some((b) => b.includes("sentence"))) {
    bullets.push("Turn short answers into complete sentences.");
  }

  // 6. If everything is strong, offer a lighter suggestion
  if (focusQuestions.length > 0 && focusQuestions.every((fq) => fq.rank >= 3)) {
    return {
      bullets: ["Review strong answers and celebrate progress.", "Try explaining answers to a partner for extra practice."],
      basedOn: ["All questions demonstrated understanding"],
      autofillText: "Review strong answers and try explaining to a partner for extra practice.",
    };
  }

  // Cap at 4 bullets
  const finalBullets = bullets.slice(0, 4);

  // Build autofill text: a clean sentence/list version
  const autofillText = finalBullets
    .map((b) => b.replace(/\.$/, ""))
    .join(". ") + ".";

  return { bullets: finalBullets, basedOn, autofillText };
}

/**
 * Extract a short topic phrase from a question for use in coaching bullets.
 * Turns "Explain why the ocean is important" → "explaining why the ocean is important".
 */
function extractTopicPhrase(questionText: string): string {
  // Clean up the question text
  let text = questionText.trim().replace(/\?$/, "").replace(/\.$/, "");

  // If it starts with a command verb, convert to gerund form for coaching language
  const verbMap: [RegExp, string][] = [
    [/^Explain\b/i, "explaining"],
    [/^Describe\b/i, "describing"],
    [/^Tell\b/i, "telling"],
    [/^Write\b/i, "writing about"],
    [/^List\b/i, "listing"],
    [/^Name\b/i, "naming"],
    [/^Show\b/i, "showing"],
    [/^Compare\b/i, "comparing"],
    [/^Identify\b/i, "identifying"],
    [/^Think about\b/i, "thinking about"],
    [/^What\b/i, "understanding what"],
    [/^Why\b/i, "understanding why"],
    [/^How\b/i, "understanding how"],
  ];

  for (const [pattern, replacement] of verbMap) {
    if (pattern.test(text)) {
      text = text.replace(pattern, replacement);
      break;
    }
  }

  // Truncate if too long
  if (text.length > 80) {
    text = text.slice(0, 77) + "...";
  }

  return text.charAt(0).toLowerCase() + text.slice(1);
}

export default function StudentAssignmentReview() {
  const { lessonId, studentId } = useParams<{ lessonId: string; studentId: string }>();
  const location = useLocation();
  const { showSuccess, showError } = useToast();

  // Navigation state for context (breadcrumbs, recommendation deep links)
  const navigationState = location.state as {
    fromStudent?: string;
    studentName?: string;
    fromAssignment?: string;
    assignmentTitle?: string;
    from?: "recommended-actions";
    returnTo?: string;
    scrollTo?: string;
    recommendationId?: string;
    recommendationType?: string;
    categoryLabel?: string;
    // DerivedInsight fields for consistent display
    insightTitle?: string;
    insightWhy?: string;
    highlightQuestionId?: string;
  } | null;

  const cameFromRecommendedActions = navigationState?.from === "recommended-actions";

  const [drilldown, setDrilldown] = useState<StudentDrilldownData | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [questionsWithAttempts, setQuestionsWithAttempts] = useState<QuestionWithAttempts[]>([]);
  const [student, setStudent] = useState<Student | null>(null);
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [assignment, setAssignment] = useState<StudentAssignment | null>(null);
  const [loading, setLoading] = useState(true);

  // Notes state
  const [teacherNote, setTeacherNote] = useState("");
  const [questionNotes, setQuestionNotes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Action states
  const [isMarkingReviewed, setIsMarkingReviewed] = useState(false);
  const [isUnmarkingReviewed, setIsUnmarkingReviewed] = useState(false);
  const [showReviewConfirmation, setShowReviewConfirmation] = useState(false);
  const [actionsHighlighted, setActionsHighlighted] = useState(false);

  // Actions section state
  const [awardBadgeChecked, setAwardBadgeChecked] = useState(false);
  const [selectedBadgeType, setSelectedBadgeType] = useState("");
  const [badgeMessage, setBadgeMessage] = useState("");
  const [createTodoChecked, setCreateTodoChecked] = useState(false);
  const [selectedTodoType, setSelectedTodoType] = useState("");
  const [customTodoText, setCustomTodoText] = useState("");
  const [reassignChecked, setReassignChecked] = useState(false);
  const [badgeTypes, setBadgeTypes] = useState<BadgeTypeInfo[]>([]);
  const [isSavingActions, setIsSavingActions] = useState(false);

  // Coaching session state
  const [pushCoachingChecked, setPushCoachingChecked] = useState(false);
  const [coachingTitle, setCoachingTitle] = useState("");
  const [coachingNote, setCoachingNote] = useState("");
  const [coachingFocus, setCoachingFocus] = useState("");
  const [showFocusReplaceConfirm, setShowFocusReplaceConfirm] = useState(false);

  // Active recommendation for this student+assignment (determines if Actions show)
  const [activeRecommendation, setActiveRecommendation] = useState<Recommendation | null>(null);
  const [recommendationLoading, setRecommendationLoading] = useState(true);

  // Derived insights from coach analytics
  const [derivedInsights, setDerivedInsights] = useState<DerivedInsight[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(true);

  // Expanded questions
  const [expandedQuestions, setExpandedQuestions] = useState<Set<string>>(new Set());

  // Auto-sizing textarea ref
  const notesTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Follow-up drawer state
  const [followupDrawerOpen, setFollowupDrawerOpen] = useState(false);
  const [followupTodo, setFollowupTodo] = useState<TeacherTodo | null>(null);
  const [followupLoading, setFollowupLoading] = useState(false);
  const [followupMenuOpen, setFollowupMenuOpen] = useState(false);
  const [isMovingBack, setIsMovingBack] = useState(false);
  const [followupCompleting, setFollowupCompleting] = useState(false);

  // Mark Reviewed undo timer (deferred note)
  const markReviewedNoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Audio playback
  const [playingQuestionId, setPlayingQuestionId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Video playback modal
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoQuestionNum, setVideoQuestionNum] = useState(0);
  const [videoTranscript, setVideoTranscript] = useState<ConversationTurn[] | null>(null);
  const [transcriptExpanded, setTranscriptExpanded] = useState(false);

  // Handle video view
  const handleViewVideo = (
    url: string,
    durationSec: number,
    questionNum: number,
    transcript?: ConversationTurn[]
  ) => {
    // Construct full URL (backend serves at /uploads/videos/*)
    const fullUrl = url.startsWith("http") ? url : `http://localhost:3001${url}`;
    setVideoUrl(fullUrl);
    setVideoDuration(durationSec);
    setVideoQuestionNum(questionNum);
    setVideoTranscript(transcript || null);
    setTranscriptExpanded(false); // Reset expansion state
    setVideoModalOpen(true);
  };

  useEffect(() => {
    if (!lessonId || !studentId) return;

    async function loadData() {
      try {
        const [lessonData, sessions, studentData, assignmentData] = await Promise.all([
          getLesson(lessonId!),
          getSessions(studentId), // Get all sessions (not just completed)
          getStudent(studentId!),
          getStudentAssignment(lessonId!, studentId!).catch(() => null),
        ]);

        setAssignment(assignmentData);
        const typedLesson = lessonData as Lesson;
        setLesson(typedLesson);
        setStudent(studentData);

        // Filter sessions for this lesson and sort by date (newest first)
        const lessonSessions = sessions
          .filter((s) => s.lessonId === lessonId)
          .sort((a, b) => {
            const dateA = new Date(a.completedAt || a.startedAt).getTime();
            const dateB = new Date(b.completedAt || b.startedAt).getTime();
            return dateB - dateA; // Newest first
          });

        // Use the most recent session for the drilldown summary
        const latestSession = lessonSessions[0];

        if (latestSession) {
          setSession(latestSession);
          setTeacherNote(latestSession.educatorNotes || "");

          // Initialize question notes from the latest session
          const notesMap: Record<string, string> = {};
          latestSession.submission.responses.forEach((r) => {
            if (r.educatorNote) {
              notesMap[r.promptId] = r.educatorNote;
            }
          });
          setQuestionNotes(notesMap);

          // Build drilldown data from latest session
          const data = buildStudentDrilldown(latestSession, typedLesson);
          setDrilldown(data);

          // Build questions with all attempts grouped by question
          const questionsMap = new Map<string, QuestionWithAttempts>();

          // Initialize from lesson prompts (in order)
          typedLesson.prompts.forEach((prompt, index) => {
            questionsMap.set(prompt.id, {
              questionId: prompt.id,
              questionNumber: index + 1,
              questionText: prompt.input,
              totalHintsAvailable: prompt.hints.length,
              attempts: [],
            });
          });

          // Add attempts from all sessions (already sorted newest first)
          lessonSessions.forEach((sess, sessionIndex) => {
            const attemptNumber = lessonSessions.length - sessionIndex; // Oldest = 1, newest = N
            const sessionDate = sess.completedAt || sess.startedAt;

            sess.submission.responses.forEach((response) => {
              const question = questionsMap.get(response.promptId);
              if (question) {
                const criteriaScore = sess.evaluation?.criteriaScores?.find(
                  (c) => c.criterionId === response.promptId
                );
                const outcome = calculateQuestionOutcome(response, criteriaScore?.score);

                question.attempts.push({
                  sessionId: sess.id,
                  attemptNumber,
                  sessionDate,
                  response: response.response,
                  outcome,
                  usedHint: response.hintUsed ?? false,
                  hasVoiceRecording: !!response.audioBase64,
                  audioBase64: response.audioBase64,
                  audioFormat: response.audioFormat,
                  hasVideoRecording: !!response.video,
                  videoUrl: response.video?.url,
                  videoDurationSec: response.video?.durationSec,
                  videoCreatedAt: response.video?.createdAt,
                  conversationTurns: response.conversationTurns,
                  score: criteriaScore?.score,
                  educatorNote: response.educatorNote,
                });
              }
            });
          });

          // Convert map to array (sorted by question number)
          const questionsArray = Array.from(questionsMap.values())
            .filter((q) => q.attempts.length > 0); // Only show questions with at least one attempt

          setQuestionsWithAttempts(questionsArray);
        }
      } catch (err) {
        console.error("Failed to load student data:", err);
      } finally {
        setLoading(false);
      }
    }

    loadData();

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, [lessonId, studentId]);

  // Load badge types for the actions section
  useEffect(() => {
    getBadgeTypes()
      .then((data) => setBadgeTypes(data.badgeTypes))
      .catch((err) => console.error("Failed to load badge types:", err));
  }, []);

  // Load active recommendation for this student+assignment
  // This determines whether to show the Actions section
  useEffect(() => {
    if (!lessonId || !studentId) {
      setRecommendationLoading(false);
      return;
    }

    setRecommendationLoading(true);
    getRecommendations({
      assignmentId: lessonId,
      studentId: studentId,
      status: "active",
    })
      .then((data) => {
        // Find the first actionable recommendation
        const actionableRec = data.recommendations.find(isRecommendationActionable) || null;

        // TEMP debugging logs (do not remove)
        console.log("activeRecommendation", actionableRec);
        console.log("suggestedActionsRaw", actionableRec ? getSuggestedActionsRaw(actionableRec) : []);
        console.log("actionable?", isRecommendationActionable(actionableRec));

        setActiveRecommendation(actionableRec);
      })
      .catch((err) => {
        console.error("Failed to load recommendations:", err);
        setActiveRecommendation(null);
      })
      .finally(() => {
        setRecommendationLoading(false);
      });
  }, [lessonId, studentId]);

  // Load derived insights from coach analytics
  useEffect(() => {
    if (!lessonId || !studentId) {
      setInsightsLoading(false);
      return;
    }

    setInsightsLoading(true);
    getStudentAssignmentDerivedInsights(lessonId, studentId)
      .then((data) => {
        setDerivedInsights(data.insights || []);
      })
      .catch((err) => {
        console.log("Derived insights not available:", err);
        setDerivedInsights([]);
      })
      .finally(() => {
        setInsightsLoading(false);
      });
  }, [lessonId, studentId]);

  // Auto-resize the notes textarea to fit content
  const resizeTextarea = useCallback(() => {
    const textarea = notesTextareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const maxHeight = 300;
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflow = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, []);

  // Resize when teacherNote changes (including initial load)
  useEffect(() => {
    resizeTextarea();
  }, [teacherNote, resizeTextarea]);

  // Handle follow-up badge click
  const handleFollowupClick = useCallback(async () => {
    if (!assignment?.todoIds?.length) return;
    setFollowupDrawerOpen(true);
    setFollowupLoading(true);
    try {
      const { todo } = await getTeacherTodo(assignment.todoIds[0]);
      // Guard: don't display superseded todos as active follow-ups
      if (todo.status === "superseded") {
        setFollowupTodo(null);
        return;
      }
      setFollowupTodo(todo);
    } catch (err) {
      console.error("Failed to load follow-up todo:", err);
    } finally {
      setFollowupLoading(false);
    }
  }, [assignment]);

  // Move follow-up back to Recommended Actions
  const handleMoveBackToRecommendations = useCallback(async () => {
    if (!followupTodo || !lessonId || !studentId) return;
    setIsMovingBack(true);
    try {
      await deleteTeacherTodo(followupTodo.id, true);
      // Update local assignment state: remove todo, revert to reviewed
      setAssignment((prev) => prev ? {
        ...prev,
        reviewState: "reviewed" as ReviewState,
        todoIds: (prev.todoIds || []).filter((id) => id !== followupTodo.id),
      } : null);
      // Reload recommendation since it was reactivated
      if (lessonId && studentId) {
        getRecommendations({ assignmentId: lessonId, studentId, status: "active" })
          .then((data) => {
            const actionableRec = data.recommendations.find(isRecommendationActionable) || null;
            setActiveRecommendation(actionableRec);
          })
          .catch(() => {});
      }
      setFollowupDrawerOpen(false);
      setFollowupTodo(null);
      setFollowupMenuOpen(false);
      showSuccess("Moved back to Recommended Actions");
    } catch (err) {
      console.error("Failed to move back:", err);
      showError("Failed to move back");
    } finally {
      setIsMovingBack(false);
    }
  }, [followupTodo, lessonId, studentId, showSuccess, showError]);

  // Handle completing a follow-up todo from the drawer
  const handleFollowupComplete = useCallback(async () => {
    if (!followupTodo || followupCompleting) return;
    setFollowupCompleting(true);
    try {
      await completeTeacherTodo(followupTodo.id);
      // Update local todo state to show as done
      setFollowupTodo((prev) => prev ? { ...prev, status: "done", doneAt: new Date().toISOString() } : null);
      // Update assignment review state: if all todos done, move to resolved
      setAssignment((prev) => {
        if (!prev) return prev;
        const remainingTodoIds = (prev.todoIds || []).filter((id) => id !== followupTodo.id);
        return {
          ...prev,
          reviewState: remainingTodoIds.length === 0 ? "resolved" as ReviewState : prev.reviewState,
          todoIds: remainingTodoIds,
        };
      });
      // Sync local teacher note with the system note appended by backend
      const dateStr = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
      const systemNote = `\n---\n[System · ${dateStr}]\nFollow-up completed: "${followupTodo.label}"`;
      setTeacherNote((prev) => (prev || "") + systemNote);
      // Show toast with undo
      const todoToUndo = followupTodo;
      showSuccess("Follow-up marked complete.", {
        duration: 5000,
        action: {
          label: "Undo",
          onClick: async () => {
            try {
              await reopenTeacherTodo(todoToUndo.id);
              setFollowupTodo((prev) => prev ? { ...prev, status: "open", doneAt: undefined } : null);
              setAssignment((prev) => {
                if (!prev) return prev;
                const todoIds = prev.todoIds || [];
                return {
                  ...prev,
                  reviewState: "followup_scheduled" as ReviewState,
                  todoIds: todoIds.includes(todoToUndo.id) ? todoIds : [...todoIds, todoToUndo.id],
                };
              });
              setTeacherNote((prev) => {
                if (!prev) return prev;
                const label = todoToUndo.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                const notePattern = new RegExp(`\\n---\\n\\[System · [^\\]]+\\]\\nFollow-up completed: "${label}"`);
                return prev.replace(notePattern, "") || "";
              });
              showSuccess("Follow-up reopened.");
            } catch (err) {
              console.error("Failed to undo completion:", err);
              showError("Failed to undo");
            }
          },
        },
      });
    } catch (err) {
      console.error("Failed to complete follow-up:", err);
      showError("Failed to complete follow-up");
    } finally {
      setFollowupCompleting(false);
    }
  }, [followupTodo, followupCompleting, showSuccess, showError]);

  // Auto-save notes
  const saveNotes = useCallback(async () => {
    if (!session || !lessonId || !studentId) return;

    setSaving(true);
    try {
      const updatedResponses = session.submission.responses.map((r) => ({
        ...r,
        educatorNote: questionNotes[r.promptId] || undefined,
      }));

      await updateSession(session.id, {
        educatorNotes: teacherNote || undefined,
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
  }, [session, lessonId, studentId, teacherNote, questionNotes]);

  const debouncedSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      saveNotes();
    }, 1000);
  }, [saveNotes]);

  // Mark as reviewed (with deferred note and undo toast)
  const handleMarkReviewed = async () => {
    if (!lessonId || !studentId) return;

    setIsMarkingReviewed(true);
    try {
      // Mark reviewed WITHOUT appending the note yet
      await markStudentReviewed(lessonId, studentId);
      setAssignment((prev) => prev ? {
        ...prev,
        reviewState: "reviewed" as ReviewState,
        reviewedAt: new Date().toISOString()
      } : null);

      // Build the system note text (but don't append yet)
      const dateStr = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
      const systemNote = `\n---\n[System · ${dateStr}]\nReviewed by teacher (no follow-up needed).`;

      // Start 8-second timer to append the note
      if (markReviewedNoteTimerRef.current) clearTimeout(markReviewedNoteTimerRef.current);
      markReviewedNoteTimerRef.current = setTimeout(async () => {
        try {
          await appendSystemNote(lessonId, studentId, systemNote);
          setTeacherNote((prev) => (prev || "") + systemNote);
        } catch (e) {
          console.error("Failed to append review note:", e);
        }
      }, 8000);

      // Show undo toast
      showSuccess("Marked reviewed.", {
        duration: 8000,
        action: {
          label: "Undo",
          onClick: async () => {
            // Cancel the deferred note
            if (markReviewedNoteTimerRef.current) {
              clearTimeout(markReviewedNoteTimerRef.current);
              markReviewedNoteTimerRef.current = null;
            }
            try {
              await unmarkStudentReviewed(lessonId, studentId);
              setAssignment((prev) => prev ? {
                ...prev,
                reviewState: "pending_review" as ReviewState,
                reviewedAt: undefined,
              } : null);
              showSuccess("Review reopened.");
            } catch (err) {
              console.error("Failed to undo mark reviewed:", err);
              showError("Failed to undo");
            }
          },
        },
      });
    } catch (err) {
      console.error("Failed to mark as reviewed:", err);
      showError("Failed to mark as reviewed");
    } finally {
      setIsMarkingReviewed(false);
    }
  };

  const handleMarkReviewedClick = () => {
    if (isActionRequired) {
      setShowReviewConfirmation(true);
    } else {
      handleMarkReviewed();
    }
  };

  const handleConfirmNoFollowUp = async () => {
    if (!lessonId || !studentId) return;

    setShowReviewConfirmation(false);

    // Resolve the active recommendation so it no longer drives ACTION_REQUIRED
    if (activeRecommendation) {
      try {
        await markRecommendationReviewed(activeRecommendation.id);
        setActiveRecommendation(null);
      } catch (err) {
        console.log("Failed to resolve recommendation:", err);
        // Non-blocking - continue even if this fails
      }
    }

    // Resolve all derived insights
    if (derivedInsights.length > 0) {
      try {
        await resolveAllInsightsForStudent(lessonId, studentId, "no_followup_needed");
        setDerivedInsights([]);
      } catch (err) {
        console.log("Failed to resolve insights:", err);
        // Non-blocking - continue even if this fails
      }
    }

    // Now mark as reviewed
    handleMarkReviewed();
  };

  const handleScrollToActions = () => {
    setShowReviewConfirmation(false);
    actionsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    // Add highlight animation to Actions section
    setActionsHighlighted(true);
    setTimeout(() => setActionsHighlighted(false), 1500);
  };

  const handleReopenForReview = async () => {
    if (!lessonId || !studentId) return;

    setIsUnmarkingReviewed(true);
    try {
      // 1. Set assignment back to pending_review
      await unmarkStudentReviewed(lessonId, studentId);

      // 2. Supersede any teacher to-dos linked to this assignment
      //    Superseded todos are retained for history but hidden from active views
      const todoIdsToSupersede = assignment?.todoIds || [];
      const supersededLabels: string[] = [];
      for (const todoId of todoIdsToSupersede) {
        try {
          const result = await supersedeTeacherTodo(todoId);
          if (result.todo?.label) {
            supersededLabels.push(result.todo.label);
          }
        } catch (e) {
          console.error("Failed to supersede todo:", todoId, e);
        }
      }

      // 3. Reactivate any resolved recommendations for this student+assignment
      try {
        const { recommendations: resolvedRecs } = await getRecommendations({
          assignmentId: lessonId,
          studentId,
          status: "resolved",
        });
        for (const rec of resolvedRecs) {
          try {
            await reactivateRecommendation(rec.id);
          } catch (e) {
            console.error("Failed to reactivate recommendation:", rec.id, e);
          }
        }
      } catch (e) {
        console.error("Failed to fetch resolved recommendations:", e);
      }

      // 3b. Reactivate any resolved derived insights
      try {
        await reactivateInsightsForStudent(lessonId, studentId);
        // Reload derived insights
        const { insights } = await getStudentAssignmentDerivedInsights(lessonId, studentId);
        setDerivedInsights(insights || []);
      } catch (e) {
        console.log("Failed to reactivate insights:", e);
      }

      // 4. Reload active recommendations so Actions section reappears
      try {
        const { recommendations: activeRecs } = await getRecommendations({
          assignmentId: lessonId,
          studentId,
          status: "active",
        });
        const actionableRec = activeRecs.find(isRecommendationActionable) || null;
        setActiveRecommendation(actionableRec);
      } catch (e) {
        console.error("Failed to reload recommendations:", e);
      }

      // 5. Close follow-up drawer and reset follow-up state
      setFollowupDrawerOpen(false);
      setFollowupTodo(null);
      setFollowupMenuOpen(false);

      // 6. Append system note documenting all side effects
      const dateStr = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
      const noteLines: string[] = [];
      noteLines.push("Review reopened by teacher");
      if (supersededLabels.length > 0) {
        const items = supersededLabels.map((l) => `"${l}"`).join(", ");
        noteLines.push(`Removed from active to-do list: ${items}`);
      }
      noteLines.push("Assignment returned to Awaiting Review");
      const systemNote = `\n---\n[System \u00b7 ${dateStr}]\n${noteLines.join("\n")}`;
      const updatedNote = (teacherNote || "") + systemNote;
      setTeacherNote(updatedNote);
      if (session) {
        try {
          await updateSession(session.id, { educatorNotes: updatedNote });
        } catch (e) {
          console.error("Failed to save reopen note:", e);
        }
      }

      // 7. Update local assignment state — clear reviewedAt and todoIds
      setAssignment((prev) => prev ? {
        ...prev,
        reviewState: "pending_review" as ReviewState,
        reviewedAt: undefined,
        todoIds: [],
      } : null);

      // 8. Reset action selections so they're fresh
      setAwardBadgeChecked(false);
      setSelectedBadgeType("");
      setBadgeMessage("");
      setCreateTodoChecked(false);
      setSelectedTodoType("");
      setCustomTodoText("");
      setPushCoachingChecked(false);
      setCoachingTitle("");
      setCoachingNote("");
      setCoachingFocus("");
      setShowFocusReplaceConfirm(false);

      showSuccess(supersededLabels.length > 0
        ? "Review reopened. Previous follow-ups removed."
        : "Review reopened."
      );
    } catch (err) {
      console.error("Failed to reopen for review:", err);
      showError("Failed to reopen for review");
    } finally {
      setIsUnmarkingReviewed(false);
    }
  };

  // Save review actions (badge, to-do, coaching session, mark reviewed)
  const handleSaveActions = async () => {
    if (!lessonId || !studentId) return;

    // Check if there's something to save
    const hasBadgeToAward = awardBadgeChecked && selectedBadgeType;
    const hasTodoToCreate = createTodoChecked && selectedTodoType && (selectedTodoType !== "custom" || customTodoText.trim());
    const hasCoachingToCreate = pushCoachingChecked && coachingTitle.trim();
    const hasReassign = reassignChecked;
    const hasNoteChange = teacherNote !== (session?.educatorNotes || "");

    if (!hasBadgeToAward && !hasTodoToCreate && !hasCoachingToCreate && !hasReassign && !hasNoteChange) {
      showError("Please select at least one action");
      return;
    }

    // Validate custom to-do text if selected
    if (createTodoChecked && selectedTodoType === "custom" && !customTodoText.trim()) {
      showError("Please enter your to-do text");
      return;
    }

    // Validate coaching session title if checked
    if (pushCoachingChecked && !coachingTitle.trim()) {
      showError("Please enter a title for the coaching session");
      return;
    }

    setIsSavingActions(true);
    try {
      // If there's a note change, save it first
      if (hasNoteChange) {
        await saveNotes();
      }

      // Create coaching invite if checked
      if (hasCoachingToCreate && lesson) {
        // Combine teacher note and session focus into a single field
        const noteParts: string[] = [];
        if (coachingNote.trim()) noteParts.push(coachingNote.trim());
        if (coachingFocus.trim()) noteParts.push(`Session focus: ${coachingFocus.trim()}`);

        await createCoachingInvite({
          studentId,
          subject: lesson.subject || "General",
          assignmentId: lessonId,
          assignmentTitle: lesson.title,
          title: coachingTitle.trim(),
          teacherNote: noteParts.length > 0 ? noteParts.join("\n\n") : undefined,
        });
      }

      // Submit the review actions (badge, todo, mark reviewed)
      const result = await submitReviewActions(lessonId, studentId, {
        awardBadgeType: hasBadgeToAward ? selectedBadgeType : undefined,
        badgeMessage: hasBadgeToAward ? badgeMessage : undefined,
        createTodo: !!hasTodoToCreate,
        todoActionKey: hasTodoToCreate ? selectedTodoType : undefined,
        todoCustomLabel: hasTodoToCreate && selectedTodoType === "custom" ? customTodoText.trim() : undefined,
        recommendationId: activeRecommendation?.id,
      });

      // Update assignment state with new reviewState and todoIds
      setAssignment((prev) => {
        if (!prev) return null;
        const updatedTodoIds = [...(prev.todoIds || [])];
        if (result.todo && !updatedTodoIds.includes(result.todo.id)) {
          updatedTodoIds.push(result.todo.id);
        }
        return {
          ...prev,
          reviewState: result.reviewState || "reviewed",
          reviewedAt: result.reviewedAt,
          todoIds: updatedTodoIds,
        };
      });

      // Mark recommendation as resolved (so it no longer appears as active)
      if (activeRecommendation) {
        try {
          await markRecommendationReviewed(activeRecommendation.id);
        } catch (err) {
          console.log("Failed to mark recommendation as reviewed:", err);
          // Non-blocking - continue even if this fails
        }
        // Clear active recommendation to hide callout and actions
        setActiveRecommendation(null);
      }

      // Resolve all derived insights for this student-assignment
      // This prevents the insights from showing again after actions are taken
      if (derivedInsights.length > 0) {
        try {
          const reason = hasTodoToCreate ? "todo_created" : "mark_reviewed";
          await resolveAllInsightsForStudent(lessonId, studentId, reason);
          // Clear insights from local state
          setDerivedInsights([]);
        } catch (err) {
          console.log("Failed to resolve insights:", err);
          // Non-blocking - continue even if this fails
        }
      }

      // Append system-generated notes for actions taken
      const actionDescriptions: string[] = [];
      if (result.badge) {
        const badgeName = badgeTypes.find((bt) => bt.id === selectedBadgeType)?.name || selectedBadgeType;
        actionDescriptions.push(`Awarded badge: ${badgeName}`);
      }
      if (result.todo) {
        const todoLabel = selectedTodoType === "custom"
          ? customTodoText.trim()
          : (CHECKLIST_ACTIONS[selectedTodoType as keyof typeof CHECKLIST_ACTIONS]?.label || selectedTodoType);
        actionDescriptions.push(`Added to Teacher To-Dos \u2014 "${todoLabel}"`);
      }
      if (hasCoachingToCreate) {
        const sessionType = isRecommendationForSupport(activeRecommendation) ? "support" : "enrichment";
        actionDescriptions.push(`Scheduled ${sessionType} session`);
      }

      if (actionDescriptions.length > 0) {
        const dateStr = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
        let systemNote: string;

        if (activeRecommendation) {
          // Action originated from a recommendation — include category and reason
          const category = getRecommendationTypeLabel(activeRecommendation);
          const reason = (activeRecommendation.reason || "").replace(/\.$/, "");
          const actionLines = actionDescriptions.map((d) => `Action taken: ${d}`).join("\n");
          systemNote = `\n---\n[System \u00b7 ${dateStr}]\n${category}: ${reason}\n${actionLines}`;
        } else {
          // Manual action — no recommendation context
          const actionLines = actionDescriptions.map((d) => `Action taken: ${d}`).join("\n");
          systemNote = `\n---\n[System \u00b7 ${dateStr}]\n${actionLines}`;
        }

        const updatedNote = (teacherNote || "") + systemNote;
        setTeacherNote(updatedNote);
        // Persist immediately
        if (session) {
          try {
            await updateSession(session.id, {
              educatorNotes: updatedNote,
            });
          } catch (err) {
            console.error("Failed to save system note:", err);
          }
        }
      }

      // Perform reassignment if checked (after other actions are saved)
      if (hasReassign) {
        try {
          const reassignResult = await pushAssignmentToStudent(lessonId, studentId);
          setAssignment((prev) => prev ? {
            ...prev,
            completedAt: undefined,
            reviewState: reassignResult.reviewState || "not_started",
            attempts: reassignResult.attempts,
          } : null);

          // Append reassignment system note
          const dateStr = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
          const reassignNote = `\n---\n[System \u00b7 ${dateStr}]\nAssignment reassigned by teacher.\nAssignment returned to awaiting review.`;
          const currentNote = teacherNote || "";
          // Avoid duplicate notes if the same reassign note already exists at the end
          if (!currentNote.endsWith(reassignNote)) {
            const updatedNote = currentNote + reassignNote;
            setTeacherNote(updatedNote);
            try {
              await appendSystemNote(lessonId, studentId, reassignNote);
            } catch (err) {
              console.error("Failed to append reassignment note:", err);
            }
          }

          showSuccess("Assignment reassigned.");
        } catch (err) {
          console.error("Failed to reassign:", err);
          showError("Failed to reassign assignment");
        }
      } else if (result.todo) {
        showSuccess("Follow-up added to your to-do list.");
      } else {
        showSuccess("Assignment marked as reviewed.");
      }

      // Reset action selections
      setAwardBadgeChecked(false);
      setSelectedBadgeType("");
      setBadgeMessage("");
      setCreateTodoChecked(false);
      setSelectedTodoType("");
      setCustomTodoText("");
      setReassignChecked(false);
      setPushCoachingChecked(false);
      setCoachingTitle("");
      setCoachingNote("");
      setCoachingFocus("");
      setShowFocusReplaceConfirm(false);
    } catch (err) {
      console.error("Failed to save actions:", err);
      showError("Failed to save actions");
    } finally {
      setIsSavingActions(false);
    }
  };

  // Check if save actions button should be enabled
  const canSaveActions = () => {
    const hasBadgeToAward = awardBadgeChecked && selectedBadgeType;
    const hasTodoToCreate = createTodoChecked && selectedTodoType && (selectedTodoType !== "custom" || customTodoText.trim());
    const hasCoachingToCreate = pushCoachingChecked && coachingTitle.trim();
    const hasNoteChange = teacherNote !== (session?.educatorNotes || "");
    return hasBadgeToAward || hasTodoToCreate || hasCoachingToCreate || reassignChecked || hasNoteChange;
  };

  // Reference for sections (for auto-scroll when coming from recommendations)
  const actionsSectionRef = useRef<HTMLDivElement>(null);
  const questionsSectionRef = useRef<HTMLDivElement>(null);


  // Toggle question expansion
  const toggleQuestion = (questionId: string) => {
    setExpandedQuestions((prev) => {
      const next = new Set(prev);
      if (next.has(questionId)) {
        next.delete(questionId);
      } else {
        next.add(questionId);
      }
      return next;
    });
  };

  // Expand all questions
  const expandAll = () => {
    if (questionsWithAttempts.length > 0) {
      setExpandedQuestions(new Set(questionsWithAttempts.map((q) => q.questionId)));
    }
  };

  // Collapse all questions
  const collapseAll = () => {
    setExpandedQuestions(new Set());
  };

  // Play audio
  const playAudio = async (audioBase64: string, audioFormat: string, questionId: string) => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    if (playingQuestionId === questionId) {
      setPlayingQuestionId(null);
      return;
    }

    setPlayingQuestionId(questionId);

    try {
      const audioBlob = new Blob(
        [Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0))],
        { type: `audio/${audioFormat}` }
      );
      const audioUrl = URL.createObjectURL(audioBlob);
      const audioElement = new Audio(audioUrl);
      audioRef.current = audioElement;

      audioElement.onended = () => {
        setPlayingQuestionId(null);
        URL.revokeObjectURL(audioUrl);
      };

      audioElement.onerror = () => {
        setPlayingQuestionId(null);
        URL.revokeObjectURL(audioUrl);
      };

      await audioElement.play();
    } catch (err) {
      console.error("Failed to play audio:", err);
      setPlayingQuestionId(null);
    }
  };

  // Determine if we have an actionable recommendation
  // This is the single source of truth for showing Actions/callout
  const hasActionableRecommendation = isRecommendationActionable(activeRecommendation);

  // Compute unified workflow status to determine if ACTION_REQUIRED
  const workflowStatus = computeTeacherWorkflowStatus({
    reviewState: assignment?.reviewState || "not_started",
    hasSubmission: !!session,
    derivedInsights: derivedInsights,
    openTodosCount: assignment?.todoIds?.length || 0,
  });
  const isActionRequired = workflowStatus === "ACTION_REQUIRED";

  // Get the suggested actions from the recommendation (mapped to UI action types)
  const suggestedActions = activeRecommendation ? getSuggestedActions(activeRecommendation) : [];

  // Scroll to actions section if coming from recommended actions
  // This useEffect must be before any early returns to satisfy React hooks rules
  useEffect(() => {
    if (!loading && !recommendationLoading && hasActionableRecommendation && cameFromRecommendedActions) {
      setTimeout(() => {
        actionsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 300);
    }
  }, [loading, recommendationLoading, hasActionableRecommendation, cameFromRecommendedActions]);

  // Auto-close the review confirmation panel if ACTION_REQUIRED status is resolved
  useEffect(() => {
    if (showReviewConfirmation && !isActionRequired) {
      setShowReviewConfirmation(false);
    }
  }, [showReviewConfirmation, isActionRequired]);

  if (loading) {
    return (
      <div className="loading">
        <div className="loading-spinner"></div>
        <p>Loading student work...</p>
      </div>
    );
  }

  if (!lesson || !student) {
    return (
      <div className="container">
        <EducatorAppHeader mode="slim" breadcrumbs={[{ label: "Not found" }]} />
        <div className="card">
          <p>Student or assignment not found.</p>
          <Link to="/educator" className="btn btn-primary" style={{ marginTop: "16px" }}>
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  // Navigation state for student profile links (assignment context)
  const studentProfileState = {
    fromAssignment: lessonId,
    assignmentTitle: lesson.title,
  };

  // Breadcrumbs: Home / {Assignment Title} / {Student Name}
  // Class context is shown elsewhere on the page, not in the breadcrumb trail.
  const breadcrumbs = [
    { label: lesson.title, to: `/educator/assignment/${lessonId}` },
    { label: student.name, to: `/educator/student/${studentId}`, state: studentProfileState },
  ];

  // No session means student hasn't started
  if (!session || !drilldown) {
    return (
      <div className="container">
        <EducatorAppHeader mode="slim" breadcrumbs={breadcrumbs} />

        {/* Assignment Context Banner */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "8px",
            padding: "10px 14px",
            background: "#f8f9fa",
            borderRadius: "8px",
            marginBottom: "16px",
            fontSize: "0.9rem",
          }}
        >
          <span style={{ color: "#666" }}>Reviewing:</span>
          <span style={{ fontWeight: 500, color: "#333" }}>{lesson.title}</span>
          {lesson.subject && (
            <span
              style={{
                padding: "2px 8px",
                background: "#e3f2fd",
                color: "#1565c0",
                borderRadius: "4px",
                fontSize: "0.8rem",
                fontWeight: 500,
              }}
            >
              {lesson.subject}
            </span>
          )}
        </div>

        <div className="header">
          <h1>
            <Link
              to={`/educator/student/${studentId}`}
              state={studentProfileState}
              style={{
                color: "inherit",
                textDecoration: "none",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
              onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}
            >
              {student.name}
            </Link>
          </h1>
        </div>

        <div className="card" style={{ textAlign: "center", padding: "48px" }}>
          <div style={{ fontSize: "1rem", marginBottom: "16px", fontWeight: 600, color: "#666" }}>Not started</div>
          <h2>Not Started Yet</h2>
          <p style={{ color: "#666" }}>
            {student.name} hasn't started this assignment yet.
          </p>
        </div>
      </div>
    );
  }

  const allExpanded = questionsWithAttempts.length > 0 && expandedQuestions.size === questionsWithAttempts.length;

  return (
    <div className="container">
      <EducatorAppHeader mode="slim" breadcrumbs={breadcrumbs} />

      {/* Unified Header Card */}
      <div
        className="card"
        style={{
          background: "white",
          padding: "20px 24px",
          marginBottom: "16px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px" }}>
          {/* Left: Assignment & Student Info */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Assignment Title - Primary */}
            <h1
              style={{
                margin: "0 0 4px 0",
                fontSize: "1.5rem",
                fontWeight: 600,
                color: "#1e293b",
                lineHeight: 1.2,
              }}
            >
              {lesson.title}
            </h1>
            {/* Student Name - Prominent Secondary (clickable → Student Profile) */}
            <h2
              style={{
                margin: "0 0 12px 0",
                fontSize: "1.1rem",
                fontWeight: 500,
                color: "#475569",
              }}
            >
              <Link
                to={`/educator/student/${studentId}`}
                state={studentProfileState}
                style={{
                  color: "inherit",
                  textDecoration: "none",
                  cursor: "pointer",
                  transition: "text-decoration 0.15s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
                onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}
              >
                {student.name}
              </Link>
            </h2>
            {/* Metadata row */}
            <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
              {lesson.subject && (
                <span
                  style={{
                    padding: "4px 10px",
                    background: "#e0f2fe",
                    color: "#0369a1",
                    borderRadius: "4px",
                    fontSize: "0.8rem",
                    fontWeight: 500,
                  }}
                >
                  {lesson.subject}
                </span>
              )}
              <span style={{ color: "#64748b", fontSize: "0.85rem" }}>
                {drilldown.completedAt
                  ? `Completed ${new Date(drilldown.completedAt).toLocaleDateString()}`
                  : "In Progress"}
              </span>
              {assignment && assignment.attempts > 1 && (
                <span style={{ color: "#0369a1", fontSize: "0.85rem", fontWeight: 500 }}>
                  Attempt #{assignment.attempts}
                </span>
              )}
            </div>
          </div>

          {/* Right: Status & Actions */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "10px", flexShrink: 0 }}>
            {/* Review Status Badge + Mark Reviewed */}
            {assignment && (
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <ReviewStateBadge
                  reviewState={assignment.reviewState}
                  hasSubmission={!!drilldown.completedAt}
                  derivedInsights={derivedInsights}
                  openTodosCount={assignment.todoIds?.length || 0}
                  onUnmark={assignment.reviewState && assignment.reviewState !== "not_started" && assignment.reviewState !== "pending_review" ? handleReopenForReview : undefined}
                  isUnmarking={isUnmarkingReviewed}
                  onFollowupClick={assignment.todoIds?.length ? handleFollowupClick : undefined}
                />
                {assignment.reviewState === "pending_review" && (
                  <button
                    onClick={handleMarkReviewedClick}
                    disabled={isMarkingReviewed}
                    style={{
                      padding: "10px 16px",
                      background: isMarkingReviewed ? "#e2e8f0" : "#667eea",
                      color: isMarkingReviewed ? "#64748b" : "white",
                      border: "none",
                      borderRadius: "8px",
                      cursor: isMarkingReviewed ? "not-allowed" : "pointer",
                      fontSize: "0.9rem",
                      fontWeight: 600,
                      opacity: isMarkingReviewed ? 0.7 : 1,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {isMarkingReviewed ? "Marking..." : "Mark Reviewed"}
                  </button>
                )}
              </div>
            )}

            {/* Inline confirmation panel for ACTION_REQUIRED status */}
            {showReviewConfirmation && assignment?.reviewState === "pending_review" && isActionRequired && (
              <div style={{
                background: "#fffbeb",
                border: "1px solid #f59e0b",
                borderRadius: "8px",
                padding: "12px 14px",
                maxWidth: "360px",
              }}>
                <div style={{ fontWeight: 600, fontSize: "0.85rem", color: "#92400e", marginBottom: "6px" }}>
                  Action recommended before reviewing
                </div>
                <div style={{ fontSize: "0.82rem", color: "#78350f", marginBottom: "10px", lineHeight: 1.4 }}>
                  This submission was flagged by the system. Choose an action, or confirm that no follow-up is needed.
                </div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                  <button
                    onClick={handleScrollToActions}
                    style={{
                      padding: "6px 12px",
                      background: "#667eea",
                      color: "white",
                      border: "none",
                      borderRadius: "6px",
                      cursor: "pointer",
                      fontSize: "0.82rem",
                      fontWeight: 600,
                    }}
                  >
                    Take an action
                  </button>
                  <button
                    onClick={handleConfirmNoFollowUp}
                    style={{
                      padding: "6px 12px",
                      background: "transparent",
                      color: "#78350f",
                      border: "1px solid #d97706",
                      borderRadius: "6px",
                      cursor: "pointer",
                      fontSize: "0.82rem",
                      fontWeight: 500,
                    }}
                  >
                    No follow-up needed
                  </button>
                  <button
                    onClick={() => setShowReviewConfirmation(false)}
                    style={{
                      padding: "6px 8px",
                      background: "transparent",
                      color: "#92400e",
                      border: "none",
                      cursor: "pointer",
                      fontSize: "0.82rem",
                      textDecoration: "underline",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Derived Insights from Coach Analytics */}
      {derivedInsights.length > 0 && (
        <div
          style={{
            marginBottom: "12px",
          }}
        >
          {derivedInsights.map((insight) => {
            const insightConfig = {
              NEEDS_SUPPORT: { color: "#dc2626", bgColor: "#fef2f2", label: "NEEDS SUPPORT" },
              CHECK_IN: { color: "#d97706", bgColor: "#fffbeb", label: "CHECK IN" },
              EXTEND_LEARNING: { color: "#059669", bgColor: "#ecfdf5", label: "EXTEND LEARNING" },
              CHALLENGE_OPPORTUNITY: { color: "#7c3aed", bgColor: "#f5f3ff", label: "CHALLENGE OPPORTUNITY" },
              CELEBRATE_PROGRESS: { color: "#0891b2", bgColor: "#ecfeff", label: "CELEBRATE PROGRESS" },
              GROUP_SUPPORT_CANDIDATE: { color: "#dc2626", bgColor: "#fef2f2", label: "GROUP REVIEW" },
              MOVE_ON_EVENT: { color: "#dc2626", bgColor: "#fef2f2", label: "MOVED ON" },
              MISCONCEPTION_FLAG: { color: "#ea580c", bgColor: "#fff7ed", label: "MISCONCEPTION" },
            }[insight.type] || { color: "#64748b", bgColor: "#f1f5f9", label: insight.type };

            const isHighlightedQuestion =
              navigationState?.highlightQuestionId === insight.questionId ||
              (navigationState?.insightTitle === insight.title);

            return (
              <div
                key={insight.id}
                className="card"
                style={{
                  background: "white",
                  borderLeft: `3px solid ${insightConfig.color}`,
                  padding: "14px 18px",
                  marginBottom: "8px",
                  boxShadow: isHighlightedQuestion ? `0 0 0 2px ${insightConfig.color}40` : undefined,
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
                  <div style={{ flex: 1 }}>
                    {/* Category badge */}
                    <span
                      style={{
                        display: "inline-block",
                        fontSize: "0.65rem",
                        fontWeight: 600,
                        color: insightConfig.color,
                        background: insightConfig.bgColor,
                        padding: "3px 10px",
                        borderRadius: "3px",
                        letterSpacing: "0.05em",
                        marginBottom: "8px",
                      }}
                    >
                      {insightConfig.label}
                    </span>

                    {/* Title */}
                    <h4
                      style={{
                        margin: "0 0 6px 0",
                        fontSize: "0.95rem",
                        fontWeight: 600,
                        color: "#1e293b",
                      }}
                    >
                      {insight.title}
                    </h4>

                    {/* Why text */}
                    <p
                      style={{
                        margin: 0,
                        fontSize: "0.85rem",
                        color: "#64748b",
                        lineHeight: 1.5,
                      }}
                    >
                      {insight.why}
                    </p>

                    {/* Question reference if scope is question */}
                    {insight.scope === "question" && insight.evidence.questionIndex !== undefined && (
                      <button
                        onClick={() => {
                          const questionId = insight.questionId;
                          if (questionId) {
                            setExpandedQuestions((prev) => new Set([...prev, questionId]));
                            setTimeout(() => {
                              document.getElementById(`question-${questionId}`)?.scrollIntoView({
                                behavior: "smooth",
                                block: "start",
                              });
                            }, 100);
                          }
                        }}
                        style={{
                          marginTop: "8px",
                          padding: "4px 10px",
                          fontSize: "0.8rem",
                          color: insightConfig.color,
                          background: "transparent",
                          border: `1px solid ${insightConfig.color}`,
                          borderRadius: "4px",
                          cursor: "pointer",
                        }}
                      >
                        View Question {(insight.evidence.questionIndex || 0) + 1}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Teacher Notes */}
      <div className="card" style={{ background: "white", border: "1px solid #e2e8f0", marginBottom: "12px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
          <h3 style={{ margin: 0, color: "#1e293b", fontSize: "1rem" }}>Notes</h3>
          <div style={{ fontSize: "0.8rem", color: "#94a3b8" }}>
            {saving && "Saving..."}
            {!saving && lastSaved && `Saved ${lastSaved.toLocaleTimeString()}`}
          </div>
        </div>
        <textarea
          ref={notesTextareaRef}
          value={teacherNote}
          onChange={(e) => {
            setTeacherNote(e.target.value);
            debouncedSave();
          }}
          placeholder={`Add notes about ${student.name}'s work...`}
          style={{
            width: "100%",
            minHeight: "80px",
            maxHeight: "300px",
            padding: "10px 12px",
            borderRadius: "6px",
            border: "1px solid #e2e8f0",
            fontSize: "0.9rem",
            fontFamily: "inherit",
            resize: "none",
            boxSizing: "border-box",
          }}
        />
      </div>

      {/* Recommendation Context - ONLY shown when there's an actionable recommendation */}
      {hasActionableRecommendation && activeRecommendation && (() => {
        const catConfig = getCategoryConfig(activeRecommendation);
        const isSoftened = assignment?.reviewState === "followup_scheduled" || assignment?.reviewState === "resolved";
        return (
          <RecommendationContext
            typeLabel={getRecommendationTypeLabel(activeRecommendation)}
            reason={activeRecommendation.reason}
            categoryColor={catConfig.color}
            categoryBgColor={catConfig.bgColor}
            softened={isSoftened}
            onDismiss={async () => {
              try {
                await dismissRecommendation(activeRecommendation.id);
                setActiveRecommendation(null);
                setShowReviewConfirmation(false);
                showSuccess("Dismissed");
              } catch (err) {
                console.error("Failed to dismiss:", err);
                showError("Failed to dismiss");
              }
            }}
          />
        );
      })()}

      {/* Actions Section - Always visible when assignment exists */}
      {assignment && (
        <div
          ref={actionsSectionRef}
          className="card"
          style={{
            background: "white",
            border: actionsHighlighted ? "2px solid #667eea" : "1px solid #e2e8f0",
            boxShadow: actionsHighlighted ? "0 0 0 3px rgba(102, 126, 234, 0.2)" : undefined,
            transition: "border-color 0.3s ease, box-shadow 0.3s ease",
          }}
        >
          <h3 style={{ margin: "0 0 12px 0", color: "#1e293b", fontSize: "1rem" }}>Actions</h3>

          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>

            {/* Recommended Actions - only when actionable recommendation exists */}
            {hasActionableRecommendation && activeRecommendation && suggestedActions.length > 0 && (
              <div>
                <h4 style={{ margin: "0 0 8px 0", color: "#64748b", fontSize: "0.85rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.03em" }}>
                  Recommended Actions
                </h4>
                <p style={{ margin: "0 0 10px 0", color: "#94a3b8", fontSize: "0.8rem" }}>
                  Based on this student's performance
                </p>

                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {/* Award Badge Option */}
                  {suggestedActions.includes("badge") && (
                  <div>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "8px",
                        cursor: "pointer",
                        fontSize: "0.95rem",
                        color: "#333",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={awardBadgeChecked}
                        onChange={(e) => setAwardBadgeChecked(e.target.checked)}
                        style={{
                          marginTop: "2px",
                          cursor: "pointer",
                          width: "16px",
                          height: "16px",
                        }}
                      />
                      <span>Award Badge</span>
                    </label>

                    {/* Badge selector (shows when checked) */}
                    {awardBadgeChecked && (
                      <div
                        style={{
                          marginTop: "8px",
                          marginLeft: "24px",
                          padding: "12px",
                          background: "#fff",
                          border: "1px solid #e0e0e0",
                          borderRadius: "6px",
                        }}
                      >
                        <div style={{ marginBottom: "8px" }}>
                          <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 500, marginBottom: "4px" }}>
                            Badge type: <span style={{ color: "#c62828" }}>*</span>
                          </label>
                          <select
                            value={selectedBadgeType}
                            onChange={(e) => setSelectedBadgeType(e.target.value)}
                            style={{
                              width: "100%",
                              padding: "8px",
                              fontSize: "0.9rem",
                              border: "1px solid #ccc",
                              borderRadius: "4px",
                            }}
                          >
                            <option value="">Select a badge...</option>
                            {badgeTypes.map((bt) => (
                              <option key={bt.id} value={bt.id}>
                                {bt.icon} {bt.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 500, marginBottom: "4px" }}>
                            Message (optional):
                          </label>
                          <input
                            type="text"
                            value={badgeMessage}
                            onChange={(e) => setBadgeMessage(e.target.value)}
                            placeholder={`Great work, ${student.preferredName || student.name}!`}
                            style={{
                              width: "100%",
                              padding: "8px",
                              fontSize: "0.9rem",
                              border: "1px solid #ccc",
                              borderRadius: "4px",
                              boxSizing: "border-box",
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                  )}

                  {/* Invite Coaching Option */}
                  {suggestedActions.includes("coaching") && (() => {
                    const isSupportSession = isRecommendationForSupport(activeRecommendation);
                    const sessionLabel = isSupportSession ? "Invite to support session" : "Invite to enrichment session";
                    const badgeLabel = isSupportSession ? "Support" : "Enrichment";
                    const badgeColor = isSupportSession ? "#7c3aed" : "#166534";
                    const badgeBgColor = isSupportSession ? "#f5f3ff" : "#e8f5e9";
                    const defaultTitle = isSupportSession
                      ? `Extra help with ${lesson?.title || "this topic"}`
                      : `Advanced discussions about ${lesson?.title || "this topic"}`;

                    return (
                  <div>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "8px",
                        cursor: "pointer",
                        fontSize: "0.95rem",
                        color: "#333",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={pushCoachingChecked}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setPushCoachingChecked(checked);
                          // Set default title when checking the box
                          if (checked && lesson?.title) {
                            setCoachingTitle(defaultTitle);
                          }
                        }}
                        style={{
                          marginTop: "2px",
                          cursor: "pointer",
                          width: "16px",
                          height: "16px",
                        }}
                      />
                      <span>
                        {sessionLabel}
                        <span
                          style={{
                            marginLeft: "6px",
                            fontSize: "0.75rem",
                            color: badgeColor,
                            background: badgeBgColor,
                            padding: "1px 6px",
                            borderRadius: "3px",
                          }}
                        >
                          {badgeLabel}
                        </span>
                      </span>
                    </label>

                    {/* Coaching session form (shows when checked) */}
                    {pushCoachingChecked && (
                      <div
                        style={{
                          marginTop: "8px",
                          marginLeft: "24px",
                          padding: "12px",
                          background: "#fff",
                          border: `1px solid ${isSupportSession ? "#ddd6fe" : "#c8e6c9"}`,
                          borderRadius: "6px",
                          borderLeft: `4px solid ${badgeColor}`,
                        }}
                      >
                        <div style={{ marginBottom: "12px" }}>
                          <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 500, marginBottom: "4px" }}>
                            Session title: <span style={{ color: "#c62828" }}>*</span>
                          </label>
                          <input
                            type="text"
                            value={coachingTitle}
                            onChange={(e) => setCoachingTitle(e.target.value)}
                            placeholder={isSupportSession
                              ? "e.g., Extra help with Division Strategies"
                              : "e.g., Advanced discussions about Division Strategies"}
                            style={{
                              width: "100%",
                              padding: "8px",
                              fontSize: "0.9rem",
                              border: "1px solid #ccc",
                              borderRadius: "4px",
                              boxSizing: "border-box",
                            }}
                          />
                          <p style={{ margin: "4px 0 0 0", fontSize: "0.8rem", color: "#666" }}>
                            This will appear as the invitation title for the student
                          </p>
                        </div>
                        <div>
                          <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 500, marginBottom: "4px" }}>
                            Personal note to student (optional):
                          </label>
                          <textarea
                            value={coachingNote}
                            onChange={(e) => setCoachingNote(e.target.value)}
                            placeholder={isSupportSession
                              ? `e.g., ${student.preferredName || student.name}, I'd like to help you practice some of these concepts...`
                              : `e.g., Great work on the basics, ${student.preferredName || student.name}! I think you're ready for some extra challenges...`}
                            style={{
                              width: "100%",
                              padding: "8px",
                              fontSize: "0.9rem",
                              border: "1px solid #ccc",
                              borderRadius: "4px",
                              boxSizing: "border-box",
                              minHeight: "60px",
                              resize: "vertical",
                            }}
                          />
                        </div>

                        {/* Suggested focus callout + Session focus field */}
                        {(() => {
                          const suggestion = getSuggestedSessionFocus(questionsWithAttempts);
                          const handleUseSuggested = () => {
                            if (coachingFocus.trim()) {
                              setShowFocusReplaceConfirm(true);
                            } else {
                              setCoachingFocus(suggestion.autofillText);
                            }
                          };
                          const handleConfirmReplace = () => {
                            setCoachingFocus(suggestion.autofillText);
                            setShowFocusReplaceConfirm(false);
                          };
                          return (
                        <div style={{ marginTop: "12px" }}>
                          {suggestion.bullets.length > 0 && (
                            <div
                              style={{
                                padding: "10px 12px",
                                background: "#f8fafc",
                                border: "1px solid #e2e8f0",
                                borderRadius: "6px",
                                marginBottom: "8px",
                              }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                                <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "#475569" }}>
                                  Suggested focus
                                </span>
                                <button
                                  type="button"
                                  onClick={handleUseSuggested}
                                  style={{
                                    background: "none",
                                    border: "none",
                                    color: "#667eea",
                                    fontSize: "0.78rem",
                                    fontWeight: 500,
                                    cursor: "pointer",
                                    padding: "0",
                                    textDecoration: "underline",
                                  }}
                                >
                                  Use suggested focus
                                </button>
                              </div>
                              <ul style={{ margin: "0", paddingLeft: "18px", fontSize: "0.82rem", color: "#334155", lineHeight: 1.55 }}>
                                {suggestion.bullets.map((bullet, i) => (
                                  <li key={i}>{bullet}</li>
                                ))}
                              </ul>
                              {suggestion.basedOn.length > 0 && (
                                <p style={{ margin: "6px 0 0 0", fontSize: "0.75rem", color: "#94a3b8" }}>
                                  Based on: {suggestion.basedOn.join(", ")}
                                </p>
                              )}

                              {/* Replace confirmation */}
                              {showFocusReplaceConfirm && (
                                <div
                                  style={{
                                    marginTop: "8px",
                                    padding: "8px 10px",
                                    background: "#fffbeb",
                                    border: "1px solid #fbbf24",
                                    borderRadius: "4px",
                                  }}
                                >
                                  <p style={{ margin: "0 0 2px 0", fontSize: "0.82rem", fontWeight: 600, color: "#92400e" }}>
                                    Replace current focus?
                                  </p>
                                  <p style={{ margin: "0 0 6px 0", fontSize: "0.78rem", color: "#78350f" }}>
                                    This will overwrite what you've typed in Session focus.
                                  </p>
                                  <div style={{ display: "flex", gap: "6px" }}>
                                    <button
                                      type="button"
                                      onClick={handleConfirmReplace}
                                      style={{
                                        padding: "4px 10px",
                                        background: "#667eea",
                                        color: "white",
                                        border: "none",
                                        borderRadius: "4px",
                                        cursor: "pointer",
                                        fontSize: "0.78rem",
                                        fontWeight: 600,
                                      }}
                                    >
                                      Replace
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setShowFocusReplaceConfirm(false)}
                                      style={{
                                        padding: "4px 10px",
                                        background: "transparent",
                                        color: "#78350f",
                                        border: "1px solid #d97706",
                                        borderRadius: "4px",
                                        cursor: "pointer",
                                        fontSize: "0.78rem",
                                        fontWeight: 500,
                                      }}
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                          <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 500, marginBottom: "4px" }}>
                            Session focus (optional):
                          </label>
                          <textarea
                            value={coachingFocus}
                            onChange={(e) => {
                              setCoachingFocus(e.target.value);
                              if (showFocusReplaceConfirm) setShowFocusReplaceConfirm(false);
                            }}
                            placeholder="e.g., Practice explaining your thinking with 2 reasons and an example"
                            style={{
                              width: "100%",
                              padding: "8px",
                              fontSize: "0.9rem",
                              border: "1px solid #ccc",
                              borderRadius: "4px",
                              boxSizing: "border-box",
                              minHeight: "48px",
                              resize: "vertical",
                            }}
                          />
                        </div>
                          );
                        })()}

                        {/* Preview */}
                        <div
                          style={{
                            marginTop: "12px",
                            padding: "10px",
                            background: badgeBgColor,
                            borderRadius: "4px",
                            fontSize: "0.85rem",
                          }}
                        >
                          <strong style={{ color: badgeColor }}>Preview:</strong>
                          <p style={{ margin: "4px 0 0 0", color: "#333" }}>
                            {student.name} will see an invitation to a {isSupportSession ? "support" : "special coaching"} session on "{coachingTitle || "..."}"
                            in {lesson?.subject || "their subject"}.
                          </p>
                          {coachingFocus.trim() && (
                            <p style={{ margin: "4px 0 0 0", color: "#333" }}>
                              We'll focus on: "{coachingFocus.trim()}"
                            </p>
                          )}
                          <p style={{ margin: "4px 0 0 0", color: "#666", fontSize: "0.8rem" }}>
                            {isSupportSession
                              ? "The session will focus on building understanding and practice."
                              : "The session will operate in enrichment mode with deeper challenges."}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* Divider between recommended and teacher actions (only when both sections show) */}
            {hasActionableRecommendation && activeRecommendation && suggestedActions.length > 0 && (
              <div style={{ borderTop: "1px solid #e2e8f0" }} />
            )}

            {/* Teacher Actions - always visible */}
            <div>
              <h4 style={{ margin: "0 0 8px 0", color: "#64748b", fontSize: "0.85rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.03em" }}>
                Teacher Actions
              </h4>

              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {/* Add Teacher To-Do Option */}
                <div>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "8px",
                      cursor: "pointer",
                      fontSize: "0.95rem",
                      color: "#333",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={createTodoChecked}
                      onChange={(e) => setCreateTodoChecked(e.target.checked)}
                      style={{
                        marginTop: "2px",
                        cursor: "pointer",
                        width: "16px",
                        height: "16px",
                      }}
                    />
                    <span>Add to Teacher To-Dos</span>
                  </label>

                  {/* To-do selector (shows when checked) */}
                  {createTodoChecked && (
                    <div
                      style={{
                        marginTop: "8px",
                        marginLeft: "24px",
                        padding: "12px",
                        background: "#fff",
                        border: "1px solid #e0e0e0",
                        borderRadius: "6px",
                      }}
                    >
                      <div style={{ marginBottom: "8px" }}>
                        <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 500, marginBottom: "4px" }}>
                          To-do type: <span style={{ color: "#c62828" }}>*</span>
                        </label>
                        <select
                          value={selectedTodoType}
                          onChange={(e) => {
                            setSelectedTodoType(e.target.value);
                            if (e.target.value !== "custom") setCustomTodoText("");
                          }}
                          style={{
                            width: "100%",
                            padding: "8px",
                            fontSize: "0.9rem",
                            border: "1px solid #ccc",
                            borderRadius: "4px",
                          }}
                        >
                          <option value="">Select a to-do...</option>
                          <option value="check_in_1to1">
                            {CHECKLIST_ACTIONS.check_in_1to1.label}
                          </option>
                          <option value="review_responses">
                            {CHECKLIST_ACTIONS.review_responses.label}
                          </option>
                          <option value="prepare_targeted_practice">
                            {CHECKLIST_ACTIONS.prepare_targeted_practice.label}
                          </option>
                          <option value="run_small_group_review">
                            {CHECKLIST_ACTIONS.run_small_group_review.label}
                          </option>
                          <option value="discuss_extension">
                            {CHECKLIST_ACTIONS.discuss_extension.label}
                          </option>
                          <option value="custom">Write your own...</option>
                        </select>
                      </div>

                      {/* Custom to-do text input */}
                      {selectedTodoType === "custom" && (
                        <div style={{ marginBottom: "8px" }}>
                          <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 500, marginBottom: "4px" }}>
                            To-do: <span style={{ color: "#c62828" }}>*</span>
                          </label>
                          <input
                            type="text"
                            value={customTodoText}
                            onChange={(e) => setCustomTodoText(e.target.value)}
                            placeholder="e.g., Follow up on reading comprehension strategies"
                            style={{
                              width: "100%",
                              padding: "8px",
                              fontSize: "0.9rem",
                              border: "1px solid #ccc",
                              borderRadius: "4px",
                              boxSizing: "border-box",
                            }}
                          />
                        </div>
                      )}

                      {/* Context preview */}
                      <div
                        style={{
                          fontSize: "0.85rem",
                          color: "#666",
                          background: "#f5f5f5",
                          padding: "8px",
                          borderRadius: "4px",
                          marginTop: "8px",
                        }}
                      >
                        <strong>Context:</strong> {student.name} · {lesson?.subject || "No subject"} · {lesson?.title}
                      </div>
                    </div>
                  )}
                </div>

                {/* Reassign Assignment Option */}
                <div>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "8px",
                      cursor: "pointer",
                      fontSize: "0.95rem",
                      color: "#333",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={reassignChecked}
                      onChange={(e) => setReassignChecked(e.target.checked)}
                      style={{
                        marginTop: "2px",
                        cursor: "pointer",
                        width: "16px",
                        height: "16px",
                      }}
                    />
                    <span>Reassign assignment</span>
                  </label>

                  {/* Confirmation detail (shows when checked) */}
                  {reassignChecked && (
                    <div
                      style={{
                        marginTop: "8px",
                        marginLeft: "24px",
                        padding: "12px",
                        background: "#fff7ed",
                        border: "1px solid #fed7aa",
                        borderRadius: "6px",
                        fontSize: "0.85rem",
                        color: "#92400e",
                      }}
                    >
                      <p style={{ margin: 0 }}>
                        This will send the assignment back to {student.name} for another attempt.
                        Their previous work will be saved.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Save Actions Button */}
          <div style={{ marginTop: "20px", display: "flex", alignItems: "center", gap: "12px" }}>
            <button
              onClick={handleSaveActions}
              disabled={!canSaveActions() || isSavingActions}
              style={{
                padding: "12px 24px",
                fontSize: "0.95rem",
                fontWeight: 600,
                background: canSaveActions() && !isSavingActions ? "#7c8fce" : "#ccc",
                color: "white",
                border: "none",
                borderRadius: "6px",
                cursor: canSaveActions() && !isSavingActions ? "pointer" : "not-allowed",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              {isSavingActions ? "Saving..." : "Save actions"}
            </button>
            {!canSaveActions() && (
              <span style={{ fontSize: "0.85rem", color: "#666" }}>
                Select an action or modify notes to enable
              </span>
            )}
          </div>
        </div>
      )}

      {/* Performance Summary - compact single row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          flexWrap: "wrap",
          padding: "12px 16px",
          background: "white",
          border: "1px solid #e2e8f0",
          borderRadius: "8px",
          marginTop: "12px",
        }}
      >
        <span
          style={{
            padding: "4px 12px",
            borderRadius: "12px",
            fontSize: "0.85rem",
            fontWeight: 600,
            background: getUnderstandingBgColor(drilldown.understanding),
            color: getUnderstandingColor(drilldown.understanding),
          }}
        >
          {getUnderstandingLabel(drilldown.understanding)}
        </span>
        <span style={{ color: "#64748b", fontSize: "0.8rem" }}>
          {drilldown.questions.length}/{lesson.prompts.length} questions
        </span>
        <span style={{ color: "#64748b", fontSize: "0.8rem" }}>
          Coach: {getCoachSupportLabel(drilldown.coachSupport)}
        </span>
        {drilldown.timeSpentMinutes && (
          <span style={{ color: "#64748b", fontSize: "0.8rem" }}>
            {drilldown.timeSpentMinutes} min
          </span>
        )}
        {/* Learning Journey Insights - inline chips */}
        {drilldown.insights.startedStrong && (
          <span style={{ padding: "2px 8px", background: "#e8f5e9", color: "#166534", borderRadius: "10px", fontSize: "0.75rem" }}>Started strong</span>
        )}
        {drilldown.insights.improvedOverTime && (
          <span style={{ padding: "2px 8px", background: "#e3f2fd", color: "#1565c0", borderRadius: "10px", fontSize: "0.75rem" }}>Improved</span>
        )}
        {drilldown.insights.recoveredWithSupport && (
          <span style={{ padding: "2px 8px", background: "#f3e5f5", color: "#9178a8", borderRadius: "10px", fontSize: "0.75rem" }}>Recovered</span>
        )}
        {drilldown.insights.struggledConsistently && (
          <span style={{ padding: "2px 8px", background: "#ffebee", color: "#c62828", borderRadius: "10px", fontSize: "0.75rem" }}>Struggling</span>
        )}
      </div>

      {/* Question Breakdown Header */}
      <div
        ref={questionsSectionRef}
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: "20px",
          marginBottom: "12px",
        }}
      >
        <h2 style={{ color: "white", margin: 0 }}>Question Breakdown</h2>
        <button
          onClick={allExpanded ? collapseAll : expandAll}
          style={{
            background: "rgba(255,255,255,0.1)",
            border: "none",
            color: "white",
            padding: "8px 16px",
            borderRadius: "8px",
            cursor: "pointer",
            fontSize: "0.9rem",
          }}
        >
          {allExpanded ? "Collapse All" : "Expand All"}
        </button>
      </div>

      {/* Questions (collapsed by default) - grouped by question with all attempts */}
      {questionsWithAttempts.map((question) => (
        <QuestionCardWithAttempts
          key={question.questionId}
          question={question}
          expanded={expandedQuestions.has(question.questionId)}
          onToggle={() => toggleQuestion(question.questionId)}
          note={questionNotes[question.questionId] || ""}
          onNoteChange={(value) => {
            setQuestionNotes((prev) => ({ ...prev, [question.questionId]: value }));
            debouncedSave();
          }}
          playingAttemptKey={playingQuestionId}
          onPlayAudio={playAudio}
          onViewVideo={handleViewVideo}
        />
      ))}

      {/* Follow-up Details Drawer */}
      <Drawer
        isOpen={followupDrawerOpen}
        onClose={() => { setFollowupDrawerOpen(false); setFollowupMenuOpen(false); }}
        title="Follow-up details"
        width="460px"
      >
        {followupLoading ? (
          <p style={{ color: "#64748b" }}>Loading...</p>
        ) : followupTodo ? (
          <div>
            {/* Section: Scheduled Follow-up */}
            <div style={{
              display: "flex", alignItems: "flex-start", gap: "10px",
              marginBottom: "12px", paddingBottom: "8px", borderBottom: "1px solid #f1f5f9",
            }}>
              <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "#64748b" }}>Follow-up</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: "0.9rem", color: "#1e293b" }}>Scheduled Follow-up</div>
                <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "2px" }}>Action planned for this student</div>
              </div>
            </div>

            {/* Todo card — primary focus, with inline overflow menu */}
            <div style={{
              padding: "12px 14px",
              background: followupTodo.status === "open" ? "#fffbeb" : "#f8fafc",
              border: `1px solid ${followupTodo.status === "open" ? "#fcd34d" : "#e2e8f0"}`,
              borderRadius: "8px",
              opacity: followupTodo.status === "done" ? 0.8 : 1,
            }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
                <button
                  onClick={followupTodo.status === "open" ? handleFollowupComplete : undefined}
                  disabled={followupCompleting || followupTodo.status === "done"}
                  style={{
                    width: "20px", height: "20px", borderRadius: "4px",
                    border: followupTodo.status === "open" ? "2px solid #d97706" : "none",
                    background: followupCompleting ? "#fcd34d" : followupTodo.status === "done" ? "#10b981" : "white",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0, marginTop: "1px", padding: 0,
                    cursor: followupTodo.status === "open" && !followupCompleting ? "pointer" : "default",
                    transition: "all 0.15s ease",
                  }}
                  title={followupTodo.status === "open" ? "Mark as complete" : "Completed"}
                >
                  {followupTodo.status === "done" && <span style={{ color: "white", fontSize: "9px", fontWeight: "bold" }}>Done</span>}
                  {followupCompleting && <span style={{ fontSize: "10px" }}>...</span>}
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontWeight: 500, fontSize: "0.85rem",
                    color: followupTodo.status === "done" ? "#64748b" : "#92400e",
                    textDecoration: followupTodo.status === "done" ? "line-through" : "none",
                  }}>
                    {followupTodo.label}
                  </div>
                  {followupTodo.assignmentTitle && (
                    <div style={{ fontSize: "0.75rem", color: "#94a3b8", marginTop: "4px" }}>
                      {followupTodo.subject ? `${followupTodo.subject} \u00b7 ` : ""}{followupTodo.assignmentTitle}
                    </div>
                  )}
                  {followupTodo.category && (
                    <div style={{
                      display: "inline-block", fontSize: "0.68rem", color: "#6b7280",
                      background: "#f3f4f6", padding: "2px 6px", borderRadius: "4px", marginTop: "6px",
                    }}>
                      {followupTodo.category}
                    </div>
                  )}
                </div>

                {/* Overflow menu on the card — matches TeacherTodosPanel TodoItem */}
                {followupTodo.status === "open" && (
                  <div style={{ position: "relative", flexShrink: 0 }}>
                    <button
                      onClick={() => setFollowupMenuOpen(!followupMenuOpen)}
                      disabled={isMovingBack}
                      style={{
                        background: "transparent", border: "none",
                        padding: "4px 6px", cursor: isMovingBack ? "wait" : "pointer",
                        color: "#999", fontSize: "1rem", lineHeight: 1, borderRadius: "4px",
                      }}
                      title="More options"
                    >
                      ⋯
                    </button>
                    {followupMenuOpen && (
                      <>
                        <div
                          onClick={() => setFollowupMenuOpen(false)}
                          style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }}
                        />
                        <div style={{
                          position: "absolute", top: "100%", right: 0, marginTop: "4px",
                          background: "white", border: "1px solid #e0e0e0", borderRadius: "6px",
                          boxShadow: "0 2px 8px rgba(0,0,0,0.15)", zIndex: 100, minWidth: "220px",
                        }}>
                          <button
                            onClick={handleMoveBackToRecommendations}
                            disabled={isMovingBack}
                            style={{
                              display: "block", width: "100%", padding: "10px 14px",
                              background: "transparent", border: "none", textAlign: "left",
                              cursor: isMovingBack ? "wait" : "pointer",
                              fontSize: "0.85rem", color: "#333",
                              opacity: isMovingBack ? 0.6 : 1,
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = "#f5f5f5"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                          >
                            {isMovingBack ? "Moving..." : "Move back to Recommended Actions"}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Inline metadata — visually secondary */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              marginTop: "12px", padding: "0 4px",
            }}>
              <span style={{ fontSize: "0.75rem", color: "#94a3b8" }}>
                Created {new Date(followupTodo.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "0.75rem", color: "#94a3b8" }}>
                <span style={{
                  display: "inline-block", width: "7px", height: "7px", borderRadius: "50%",
                  background: followupTodo.status === "open" ? "#f59e0b" : "#22c55e",
                }} />
                {followupTodo.status === "open" ? "Open" : "Completed"}
                {followupTodo.doneAt && (
                  <span> · {new Date(followupTodo.doneAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                )}
              </span>
            </div>
          </div>
        ) : (
          <div style={{ textAlign: "center", padding: "48px 24px", color: "#64748b" }}>
            <div style={{ fontSize: "1rem", marginBottom: "12px", opacity: 0.7, fontWeight: 500 }}>No data</div>
            <p style={{ margin: 0, fontSize: "0.95rem" }}>Could not load follow-up details.</p>
          </div>
        )}
      </Drawer>

      {/* Video Playback Drawer */}
      <Drawer
        isOpen={videoModalOpen}
        onClose={() => {
          setVideoModalOpen(false);
          setVideoUrl(null);
        }}
        title={`Video Response - Question ${videoQuestionNum}`}
        width="600px"
      >
        <div style={{ padding: "0 0 16px 0" }}>
          {videoUrl && (
            <>
              {/* Video player */}
              <div style={{
                width: "100%",
                aspectRatio: "16/9",
                background: "#1f2937",
                borderRadius: "8px",
                overflow: "hidden",
                marginBottom: "16px",
              }}>
                <video
                  src={videoUrl}
                  controls
                  autoPlay
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                  }}
                />
              </div>

              {/* Video info */}
              <div style={{
                display: "flex",
                gap: "16px",
                padding: "12px",
                background: "#f8fafc",
                borderRadius: "8px",
                fontSize: "0.85rem",
                color: "#64748b",
              }}>
                <div>
                  <span style={{ fontWeight: 600 }}>Duration:</span>{" "}
                  {Math.floor(videoDuration / 60)}:{(videoDuration % 60).toString().padStart(2, "0")}
                </div>
              </div>

              {/* Transcript section */}
              <div style={{ marginTop: "16px" }}>
                {videoTranscript && videoTranscript.length > 0 ? (
                  <>
                    {/* Toggle button */}
                    <button
                      onClick={() => setTranscriptExpanded(!transcriptExpanded)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "10px 14px",
                        background: "transparent",
                        border: "1px solid #e2e8f0",
                        borderRadius: "8px",
                        cursor: "pointer",
                        fontSize: "0.85rem",
                        fontWeight: 500,
                        color: "#475569",
                        width: "100%",
                        justifyContent: "space-between",
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                          <polyline points="14,2 14,8 20,8" />
                          <line x1="16" y1="13" x2="8" y2="13" />
                          <line x1="16" y1="17" x2="8" y2="17" />
                          <polyline points="10,9 9,9 8,9" />
                        </svg>
                        {transcriptExpanded ? "Hide transcript" : "Show transcript"}
                      </span>
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        style={{
                          transform: transcriptExpanded ? "rotate(180deg)" : "rotate(0deg)",
                          transition: "transform 0.2s",
                        }}
                      >
                        <polyline points="6,9 12,15 18,9" />
                      </svg>
                    </button>

                    {/* Transcript content */}
                    {transcriptExpanded && (
                      <div
                        style={{
                          marginTop: "12px",
                          maxHeight: "300px",
                          overflowY: "auto",
                          border: "1px solid #e2e8f0",
                          borderRadius: "8px",
                          padding: "12px",
                          background: "#fafafa",
                        }}
                      >
                        {videoTranscript.map((turn, i) => {
                          const mins = Math.floor(turn.timestampSec / 60);
                          const secs = turn.timestampSec % 60;
                          const timestamp = `${mins}:${secs.toString().padStart(2, "0")}`;
                          const isCoach = turn.role === "coach";

                          return (
                            <div
                              key={i}
                              style={{
                                marginBottom: i < videoTranscript.length - 1 ? "12px" : 0,
                                padding: "10px 12px",
                                background: isCoach ? "#ede9fe" : "#ecfdf5",
                                borderRadius: "8px",
                                borderLeft: `3px solid ${isCoach ? "#7c3aed" : "#10b981"}`,
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  alignItems: "center",
                                  marginBottom: "4px",
                                }}
                              >
                                <span
                                  style={{
                                    fontWeight: 600,
                                    fontSize: "0.75rem",
                                    color: isCoach ? "#5b21b6" : "#047857",
                                    textTransform: "uppercase",
                                  }}
                                >
                                  {isCoach ? "Coach" : "Student"}
                                </span>
                                <span
                                  style={{
                                    fontSize: "0.7rem",
                                    color: "#94a3b8",
                                    fontFamily: "monospace",
                                  }}
                                >
                                  {timestamp}
                                </span>
                              </div>
                              <p
                                style={{
                                  margin: 0,
                                  fontSize: "0.85rem",
                                  color: "#334155",
                                  lineHeight: 1.5,
                                }}
                              >
                                {turn.message}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                ) : (
                  /* Fallback when no transcript available */
                  <div
                    style={{
                      padding: "12px",
                      background: "#f8fafc",
                      borderRadius: "8px",
                      fontSize: "0.85rem",
                      color: "#94a3b8",
                      textAlign: "center",
                      fontStyle: "italic",
                    }}
                  >
                    Transcript unavailable for this video.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </Drawer>
    </div>
  );
}

// ============================================
// Helper Components
// ============================================

// Recommendation Context - compact display explaining why an action is recommended
// Only shown when there's an actionable recommendation
// Answers: "Why am I being asked to take action?"
function RecommendationContext({
  typeLabel,
  reason,
  categoryColor,
  categoryBgColor,
  softened,
  onDismiss,
}: {
  typeLabel: string;
  reason: string;
  categoryColor?: string;
  categoryBgColor?: string;
  softened?: boolean;
  onDismiss?: () => void;
}) {
  // Use category colors when provided, fall back to neutral
  const accentColor = categoryColor || "#64748b";
  const bgColor = categoryBgColor || "#f8fafc";
  // Softened state: mute the colors after action taken
  const opacity = softened ? 0.55 : 1;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
        padding: "10px 14px",
        background: bgColor,
        borderLeft: `3px solid ${accentColor}`,
        borderRadius: "6px",
        marginBottom: "12px",
        opacity,
        transition: "opacity 0.2s ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, flexWrap: "wrap" }}>
        {/* Type label chip — uses category color */}
        <span
          style={{
            padding: "3px 10px",
            background: categoryBgColor || "#e2e8f0",
            color: accentColor,
            borderRadius: "4px",
            fontSize: "0.8rem",
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
          {typeLabel}
        </span>
        {/* Reason text */}
        <span style={{ color: "#475569", fontSize: "0.85rem" }}>
          {reason}
        </span>
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          style={{
            padding: "4px 8px",
            background: "transparent",
            border: "none",
            color: "#94a3b8",
            fontSize: "0.75rem",
            cursor: "pointer",
            flexShrink: 0,
          }}
          title="Dismiss this recommendation"
        >
          ✕
        </button>
      )}
    </div>
  );
}

// Teacher Workflow Status Badge Component
// Uses unified workflow status for consistent display across all educator surfaces
// ============================================

function ReviewStateBadge({
  reviewState,
  hasSubmission = true,
  derivedInsights = [],
  openTodosCount = 0,
  onUnmark,
  isUnmarking,
  onFollowupClick,
}: {
  reviewState?: ReviewState;
  hasSubmission?: boolean;
  derivedInsights?: DerivedInsight[];
  openTodosCount?: number;
  onUnmark?: () => void;
  isUnmarking?: boolean;
  onFollowupClick?: () => void;
}) {
  // Compute unified workflow status
  const workflowStatus = computeTeacherWorkflowStatus({
    reviewState: reviewState as "pending_review" | "reviewed" | "not_started" | "followup_scheduled" | "resolved" | null,
    hasSubmission,
    derivedInsights,
    openTodosCount,
  });

  const { color, bgColor } = WORKFLOW_STATUS_COLORS[workflowStatus];
  const label = WORKFLOW_STATUS_LABELS[workflowStatus];

  // Clickable only when there are follow-ups to view
  const isClickable = workflowStatus === "FOLLOW_UP_SCHEDULED" && !!onFollowupClick;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <span
        onClick={isClickable ? onFollowupClick : undefined}
        style={{
          background: bgColor,
          color: color,
          padding: "10px 16px",
          borderRadius: "8px",
          fontWeight: 500,
          display: "flex",
          alignItems: "center",
          gap: "6px",
          cursor: isClickable ? "pointer" : "default",
          transition: isClickable ? "filter 0.15s" : undefined,
        }}
        onMouseEnter={isClickable ? (e) => { e.currentTarget.style.filter = "brightness(0.95)"; } : undefined}
        onMouseLeave={isClickable ? (e) => { e.currentTarget.style.filter = ""; } : undefined}
        title={isClickable ? "View follow-up details" : undefined}
      >
        {label}
      </span>
      {onUnmark && (
        <button
          onClick={onUnmark}
          disabled={isUnmarking}
          style={{
            background: "transparent",
            border: "1px solid #e2e8f0",
            borderRadius: "6px",
            padding: "8px 12px",
            fontSize: "0.85rem",
            color: "#64748b",
            cursor: isUnmarking ? "not-allowed" : "pointer",
            opacity: isUnmarking ? 0.6 : 1,
          }}
          title="Return to pending review state"
        >
          {isUnmarking ? "Reopening..." : "Reopen for Review"}
        </button>
      )}
    </div>
  );
}

// ============================================
// Video Conversation Display Component
// Shows transcript of coach ↔ student conversation
// ============================================

interface VideoConversationDisplayProps {
  conversationTurns: ConversationTurn[];
  durationSec: number;
  videoUrl?: string;
  questionNumber: number;
  onViewVideo: (videoUrl: string, durationSec: number, questionNum: number, transcript?: ConversationTurn[]) => void;
}

function VideoConversationDisplay({
  conversationTurns,
  durationSec,
  videoUrl,
  questionNumber,
  onViewVideo,
}: VideoConversationDisplayProps) {
  const [expanded, setExpanded] = useState(false);

  // Count coach prompts
  const coachPromptCount = conversationTurns.filter((t) => t.role === "coach").length;

  // Format duration
  const formatDuration = (sec: number) => {
    if (sec < 60) return `${Math.round(sec)}s`;
    const minutes = Math.floor(sec / 60);
    const seconds = Math.round(sec % 60);
    return `${minutes}m ${seconds}s`;
  };

  // Show first 2 turns by default when collapsed
  const previewTurns = conversationTurns.slice(0, 2);
  const hasMoreTurns = conversationTurns.length > 2;
  const turnsToShow = expanded ? conversationTurns : previewTurns;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {/* Metadata row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
            color: "white",
            padding: "4px 10px",
            borderRadius: "12px",
            fontSize: "0.75rem",
            fontWeight: 500,
          }}
        >
          Video conversation
        </span>
        <span style={{ fontSize: "0.8rem", color: "#666" }}>
          {coachPromptCount} coach prompt{coachPromptCount !== 1 ? "s" : ""} • {formatDuration(durationSec)}
        </span>
        {videoUrl && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onViewVideo(videoUrl, durationSec, questionNumber, conversationTurns);
            }}
            style={{
              background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
              color: "white",
              border: "none",
              borderRadius: "8px",
              padding: "6px 12px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "0.8rem",
              fontWeight: 500,
              marginLeft: "auto",
            }}
            title="Watch student's video response"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 7l-7 5 7 5V7z" />
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
            Watch video
          </button>
        )}
      </div>

      {/* Conversation transcript */}
      <div
        style={{
          background: "#f8f9fa",
          borderRadius: "8px",
          padding: "12px",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
        }}
      >
        {turnsToShow.map((turn, idx) => (
          <div
            key={idx}
            style={{
              display: "flex",
              gap: "10px",
              alignItems: "flex-start",
            }}
          >
            <span
              style={{
                fontSize: "0.75rem",
                fontWeight: 600,
                color: turn.role === "coach" ? "#667eea" : "#059669",
                minWidth: "52px",
                flexShrink: 0,
              }}
            >
              {turn.role === "coach" ? "Coach" : "Student"}
            </span>
            <p
              style={{
                margin: 0,
                fontSize: "0.85rem",
                lineHeight: 1.5,
                color: "#333",
                flex: 1,
              }}
            >
              {turn.message}
            </p>
          </div>
        ))}

        {/* Expand/collapse toggle */}
        {hasMoreTurns && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            style={{
              background: "transparent",
              border: "none",
              color: "#667eea",
              fontSize: "0.8rem",
              fontWeight: 500,
              cursor: "pointer",
              padding: "4px 0",
              textAlign: "left",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            {expanded ? (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="18 15 12 9 6 15" />
                </svg>
                Show less
              </>
            ) : (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
                View full transcript ({conversationTurns.length - 2} more)
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

// ============================================
// Question Card With Attempts Component
// Shows all attempts for a question, newest first
// ============================================

interface QuestionCardWithAttemptsProps {
  question: QuestionWithAttempts;
  expanded: boolean;
  onToggle: () => void;
  note: string;
  onNoteChange: (value: string) => void;
  playingAttemptKey: string | null;
  onPlayAudio: (audioBase64: string, audioFormat: string, attemptKey: string) => void;
  onViewVideo: (videoUrl: string, durationSec: number, questionNum: number, transcript?: ConversationTurn[]) => void;
}

function QuestionCardWithAttempts({
  question,
  expanded,
  onToggle,
  note,
  onNoteChange,
  playingAttemptKey,
  onPlayAudio,
  onViewVideo,
}: QuestionCardWithAttemptsProps) {
  // Outcome colors
  const outcomeColors: Record<string, { bg: string; color: string }> = {
    demonstrated: { bg: "#e8f5e9", color: "#166534" },
    "with-support": { bg: "#e3f2fd", color: "#1565c0" },
    developing: { bg: "#fff3e0", color: "#e65100" },
    "not-attempted": { bg: "#f5f5f5", color: "#666" },
  };

  // Get the latest attempt for the header badge (attempts are sorted newest first)
  const latestAttempt = question.attempts[0];
  const { bg, color } = latestAttempt
    ? outcomeColors[latestAttempt.outcome] || outcomeColors["not-attempted"]
    : outcomeColors["not-attempted"];

  // Check if any attempt used hints or has voice recording
  const anyUsedHint = question.attempts.some((a) => a.usedHint);
  const anyHasVoice = question.attempts.some((a) => a.hasVoiceRecording);
  const hasNote = note && note.trim().length > 0;

  return (
    <div className="card" style={{ marginBottom: "12px" }}>
      {/* Collapsed Header (always visible) */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          cursor: "pointer",
          gap: "12px",
        }}
        onClick={onToggle}
      >
        {/* Left side: Q# badge + question text */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "12px",
            flex: 1,
            minWidth: 0, // Critical: allows flex child to shrink below content size
          }}
        >
          <span
            style={{
              background: "#7c8fce",
              color: "white",
              padding: "4px 10px",
              borderRadius: "8px",
              fontSize: "0.85rem",
              fontWeight: 600,
              flexShrink: 0,
              marginTop: "2px", // Align with first line of text
            }}
          >
            Q{question.questionNumber}
          </span>
          <span
            style={{
              color: "#333",
              fontSize: "0.95rem",
              lineHeight: 1.5,
              whiteSpace: "normal",
              wordBreak: "break-word",
              minWidth: 0, // Allow text to shrink and wrap
            }}
          >
            {question.questionText}
          </span>
        </div>

        {/* Right side: status metadata (fixed width, vertically centered) */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            flexShrink: 0,
          }}
        >
          {/* Status indicators */}
          {anyUsedHint && (
            <span style={{ fontSize: "0.7rem", fontWeight: 500, color: "#9178a8" }} title="Used hint">Hint</span>
          )}
          {anyHasVoice && (
            <span style={{ fontSize: "0.7rem", fontWeight: 500, color: "#2e7d32" }} title="Voice recording">Voice</span>
          )}
          {hasNote && (
            <span style={{ fontSize: "0.7rem", fontWeight: 500, color: "#666" }} title="Has your note">Note</span>
          )}

          {/* Attempts count badge */}
          {question.attempts.length > 1 && (
            <span
              style={{
                display: "inline-block",
                padding: "4px 8px",
                borderRadius: "8px",
                fontSize: "0.75rem",
                fontWeight: 500,
                background: "#e3f2fd",
                color: "#1565c0",
              }}
            >
              {question.attempts.length} attempts
            </span>
          )}

          {/* Latest outcome badge */}
          {latestAttempt && (
            <span
              style={{
                display: "inline-block",
                padding: "4px 10px",
                borderRadius: "8px",
                fontSize: "0.8rem",
                fontWeight: 500,
                background: bg,
                color: color,
                whiteSpace: "nowrap",
              }}
            >
              {getQuestionOutcomeLabel(latestAttempt.outcome)}
            </span>
          )}

          {/* Deferred by coach badge (neutral, informational) */}
          {latestAttempt?.deferredByCoach && (
            <span
              style={{
                display: "inline-block",
                padding: "4px 10px",
                borderRadius: "8px",
                fontSize: "0.75rem",
                fontWeight: 500,
                background: "#f5f5f5",
                color: "#666",
                whiteSpace: "nowrap",
              }}
              title={`Deferred after ${latestAttempt.deferralMetadata?.attemptCount || "multiple"} coaching attempts`}
            >
              Deferred by coach
            </span>
          )}

          {/* Expand/collapse arrow */}
          <span style={{ color: "#666", fontSize: "1.2rem" }}>
            {expanded ? "▼" : "▶"}
          </span>
        </div>
      </div>

      {/* Expanded Content - Show all attempts */}
      {expanded && (
        <div style={{ marginTop: "16px", paddingTop: "16px", borderTop: "1px solid #eee" }}>
          {question.attempts.length === 0 ? (
            <div
              style={{
                background: "#f5f5f5",
                borderRadius: "8px",
                padding: "16px",
                marginBottom: "12px",
                textAlign: "center",
                color: "#999",
              }}
            >
              No response recorded
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {/* Attempts shown newest first */}
              {question.attempts.map((attempt, index) => {
                const attemptKey = `${question.questionId}-${attempt.sessionId}`;
                const isPlaying = playingAttemptKey === attemptKey;
                const attemptOutcome = outcomeColors[attempt.outcome] || outcomeColors["not-attempted"];
                const isLatest = index === 0;

                return (
                  <div
                    key={attemptKey}
                    style={{
                      background: isLatest ? "#f5f5f5" : "#fafafa",
                      borderRadius: "8px",
                      padding: "16px",
                      border: isLatest ? "2px solid #7c8fce" : "1px solid #eee",
                    }}
                  >
                    {/* Attempt header */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span
                          style={{
                            fontSize: "0.8rem",
                            fontWeight: 600,
                            color: isLatest ? "#7c8fce" : "#666",
                          }}
                        >
                          {isLatest ? "Latest Attempt" : `Attempt #${attempt.attemptNumber}`}
                        </span>
                        <span style={{ fontSize: "0.8rem", color: "#999" }}>
                          {new Date(attempt.sessionDate).toLocaleDateString()}
                        </span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        {attempt.usedHint && (
                          <span style={{ fontSize: "0.75rem", color: "#9178a8" }}>Hint used</span>
                        )}
                        <span
                          style={{
                            display: "inline-block",
                            padding: "2px 8px",
                            borderRadius: "8px",
                            fontSize: "0.75rem",
                            fontWeight: 500,
                            background: attemptOutcome.bg,
                            color: attemptOutcome.color,
                          }}
                        >
                          {getQuestionOutcomeLabel(attempt.outcome)}
                        </span>
                        {attempt.deferredByCoach && (
                          <span
                            style={{
                              display: "inline-block",
                              padding: "2px 8px",
                              borderRadius: "8px",
                              fontSize: "0.75rem",
                              fontWeight: 500,
                              background: "#f0f0f0",
                              color: "#666",
                            }}
                          >
                            Deferred
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Deferral metadata (informational, neutral) */}
                    {attempt.deferredByCoach && attempt.deferralMetadata && (
                      <div
                        style={{
                          background: "#fafafa",
                          borderRadius: "6px",
                          padding: "10px 12px",
                          marginBottom: "12px",
                          fontSize: "0.8rem",
                          color: "#666",
                          display: "flex",
                          alignItems: "center",
                          gap: "12px",
                        }}
                      >
                        <span style={{ fontWeight: 500 }}>Coach moved on</span>
                        {attempt.deferralMetadata.attemptCount && (
                          <span>• {attempt.deferralMetadata.attemptCount} coaching turns</span>
                        )}
                        {attempt.deferralMetadata.pattern && (
                          <span>• {attempt.deferralMetadata.pattern.replace(/-/g, " ")}</span>
                        )}
                        {attempt.deferralMetadata.deferredAt && (
                          <span>• {new Date(attempt.deferralMetadata.deferredAt).toLocaleTimeString()}</span>
                        )}
                      </div>
                    )}

                    {/* Student response - Video conversation or text */}
                    {attempt.hasVideoRecording && attempt.conversationTurns && attempt.conversationTurns.length > 0 ? (
                      <VideoConversationDisplay
                        conversationTurns={attempt.conversationTurns}
                        durationSec={attempt.videoDurationSec || 0}
                        videoUrl={attempt.videoUrl}
                        questionNumber={question.questionNumber}
                        onViewVideo={onViewVideo}
                      />
                    ) : (
                      <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
                        <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "#666" }}>Student</span>
                        <div style={{ flex: 1 }}>
                          <p style={{ margin: 0, lineHeight: 1.6, fontSize: "0.95rem" }}>
                            {attempt.response || <span style={{ color: "#999", fontStyle: "italic" }}>No response</span>}
                          </p>
                        </div>
                        {attempt.hasVoiceRecording && attempt.audioBase64 && attempt.audioFormat && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onPlayAudio(attempt.audioBase64!, attempt.audioFormat!, attemptKey);
                            }}
                            style={{
                              background: isPlaying ? "#7c8fce" : "#e8f5e9",
                              color: isPlaying ? "white" : "#166534",
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
                            title="Listen to student's voice"
                          >
                            {isPlaying ? "Stop" : "Play"}
                          </button>
                        )}
                        {attempt.hasVideoRecording && attempt.videoUrl && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onViewVideo(
                                attempt.videoUrl!,
                                attempt.videoDurationSec || 0,
                                question.questionNumber,
                                attempt.conversationTurns
                              );
                            }}
                            style={{
                              background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                              color: "white",
                              border: "none",
                              borderRadius: "8px",
                              padding: "6px 12px",
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              gap: "6px",
                              fontSize: "0.8rem",
                              fontWeight: 500,
                              flexShrink: 0,
                            }}
                            title="Watch student's video response"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M23 7l-7 5 7 5V7z" />
                              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                            </svg>
                            View Video
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Teacher Note for this question */}
          <div style={{ marginTop: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
              <span style={{ fontSize: "0.85rem", color: "#666" }}>Your note for Q{question.questionNumber}:</span>
            </div>
            <textarea
              value={note}
              onChange={(e) => onNoteChange(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              placeholder="Add a note about this question..."
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
      )}
    </div>
  );
}
