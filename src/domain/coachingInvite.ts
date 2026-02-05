/**
 * CoachingInvite Domain Model
 *
 * Represents a teacher-pushed enrichment coaching session invitation.
 * High-performing students receive these as a personal invitation from
 * their teacher for deeper exploration of a topic.
 *
 * Key concepts:
 * - Teachers push invites from student review or Challenge Opportunity recommendations
 * - Students see a badge/highlight on Ask Coach
 * - Coach operates in "enrichment mode" with harder material and guardrails
 * - Distinct from normal assignments and regular Ask Coach usage
 */

// ============================================
// Types
// ============================================

export type CoachingInviteStatus = "pending" | "started" | "completed" | "dismissed";

export type CoachingMode = "enrichment" | "support" | "general";

/**
 * AI guardrails for the coaching session
 */
export interface CoachingGuardrails {
  /** The mode determines coaching behavior */
  mode: CoachingMode;

  /** Difficulty adjustment from baseline (+1 = harder, -1 = easier) */
  difficultyDelta: number;

  /** Topics the coach should focus on (derived from subject + title) */
  allowedTopics: string[];

  /** Behaviors the coach should avoid */
  disallowed: string[];
}

/**
 * CoachingInvite - A teacher-pushed enrichment session invitation
 */
export interface CoachingInvite {
  id: string;

  // Who created and who receives
  teacherId: string;
  studentId: string;
  classId?: string;

  // Context
  subject: string;
  assignmentId?: string;
  assignmentTitle?: string;

  // Session details
  title: string; // This is the guardrail seed, shown to student
  teacherNote?: string; // Optional message from teacher

  // AI guardrails
  guardrails: CoachingGuardrails;

  // Status tracking
  status: CoachingInviteStatus;
  createdAt: string; // ISO timestamp
  startedAt?: string; // ISO timestamp
  completedAt?: string; // ISO timestamp
  lastActivityAt?: string; // ISO timestamp
  dismissedAt?: string; // ISO timestamp

  // Optional: track recommendation this was created from
  sourceRecommendationId?: string;

  // Session stats (populated during/after session)
  messageCount?: number;
}

// ============================================
// Input Types
// ============================================

/**
 * Input for creating a coaching invite
 */
export interface CreateCoachingInviteInput {
  teacherId: string;
  studentId: string;
  classId?: string;
  subject: string;
  assignmentId?: string;
  assignmentTitle?: string;
  title: string;
  teacherNote?: string;
  sourceRecommendationId?: string;
}

/**
 * Input for updating a coaching invite
 */
export interface UpdateCoachingInviteInput {
  status?: CoachingInviteStatus;
  startedAt?: string;
  completedAt?: string;
  lastActivityAt?: string;
  dismissedAt?: string;
  messageCount?: number;
}

// ============================================
// API Response Types
// ============================================

export interface CoachingInviteResponse {
  invite: CoachingInvite;
}

export interface CoachingInvitesResponse {
  invites: CoachingInvite[];
  counts: {
    pending: number;
    started: number;
    completed: number;
    dismissed: number;
    total: number;
  };
}

// ============================================
// Guardrails Factory
// ============================================

/**
 * Default disallowed behaviors for enrichment mode
 */
const ENRICHMENT_DISALLOWED = [
  "giving direct answers without explanation",
  "doing the student's work for them",
  "providing test answers",
  "remedial scaffolding unless explicitly requested",
  "oversimplifying concepts",
];

/**
 * Create guardrails for an enrichment coaching session
 */
export function createEnrichmentGuardrails(
  subject: string,
  title: string,
  assignmentTitle?: string
): CoachingGuardrails {
  // Build allowed topics from subject, title, and assignment
  const allowedTopics: string[] = [subject];

  // Extract key concepts from title
  const titleWords = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 3);
  allowedTopics.push(...titleWords);

  // Add assignment context if available
  if (assignmentTitle) {
    allowedTopics.push(assignmentTitle);
  }

  return {
    mode: "enrichment",
    difficultyDelta: 1, // Harder than baseline
    allowedTopics: [...new Set(allowedTopics)], // Dedupe
    disallowed: ENRICHMENT_DISALLOWED,
  };
}

// ============================================
// System Prompt Builder
// ============================================

/**
 * Build the enrichment mode system prompt for the AI coach
 */
export function buildEnrichmentSystemPrompt(invite: CoachingInvite): string {
  const { title, subject, teacherNote, guardrails, assignmentTitle } = invite;

  const topicContext = assignmentTitle
    ? `related to "${assignmentTitle}" in ${subject}`
    : `in ${subject}`;

  const teacherContext = teacherNote
    ? `\n\nThe teacher included this note for context: "${teacherNote}"`
    : "";

  return `You are an enrichment coach for a high-performing student. Their teacher has invited them to a special coaching session titled "${title}" ${topicContext}.

This is an ENRICHMENT session, not remedial support. The student is excelling and ready for deeper challenges.

Your approach:
- Challenge the student with deeper "why" and "how" questions
- Encourage transfer and application to new contexts
- Explore edge cases and exceptions
- Ask thought-provoking follow-up questions
- Support curiosity and independent thinking
- Use harder material than typical grade-level content
- Celebrate sophisticated reasoning

Avoid:
${guardrails.disallowed.map((d) => `- ${d}`).join("\n")}

Stay focused on: ${guardrails.allowedTopics.join(", ")}

If the student asks about unrelated topics, gently redirect to the session focus.${teacherContext}

Begin by warmly welcoming the student to this special session and asking an engaging opening question about ${title}.`;
}
