/**
 * Student Action Service
 *
 * Handles all student actions in the learning workflow:
 * - Complete assignment (with AI evaluation and insight generation)
 * - Ask coach (support vs enrichment tracking)
 * - Retry assignment (when reassigned by teacher)
 *
 * All actions:
 * - Update AssignmentStudent records
 * - Generate Insight objects for teacher review
 * - Track coach usage patterns
 */

import { StudentStore } from "../stores/studentStore";
import { SessionStore } from "../stores/sessionStore";
import { InsightStore } from "../stores/insightStore";
import { AssignmentStudentStore } from "../stores/assignmentStudentStore";
import { Student } from "../domain/student";
import { Session } from "../domain/session";
import { Insight, InsightType, InsightPriority, InsightStatus } from "../domain/insight";
import { AssignmentStudent } from "../domain/studentAssignment";
import { loadLessonById } from "../loaders/lessonLoader";
import { Lesson } from "../domain/lesson";
import { RECOMMENDATION_CONFIG } from "../domain/recommendation";
import {
  DASHBOARD_CONFIG,
  calculateUnderstandingLevel,
  StudentUnderstandingLevel,
} from "../domain/dashboard";

// ============================================
// Result Types
// ============================================

export interface CompleteAssignmentResult {
  success: boolean;
  error?: string;
  assignmentRecord: AssignmentStudent | null;
  insightsGenerated: Insight[];
  understandingLevel: StudentUnderstandingLevel;
  score: number;
  attemptNumber: number;
  isImprovement: boolean;
  improvementAmount: number;
}

export interface AskCoachResult {
  success: boolean;
  error?: string;
  sessionRecorded: boolean;
  coachIntent: "support" | "enrichment" | "mixed";
  insightGenerated: boolean;
  insightId?: string;
}

export interface RetryAssignmentResult {
  success: boolean;
  error?: string;
  newAttemptNumber: number;
  previousScore?: number;
  previousAttempts: number;
}

// ============================================
// Input Types
// ============================================

export interface CompleteAssignmentInput {
  studentId: string;
  assignmentId: string;
  score: number;
  timeSpentSeconds?: number;
  hintsUsed?: number;
  coachSessionsUsed?: number;
  responses?: {
    promptId: string;
    hintUsed: boolean;
    coachUsed: boolean;
  }[];
}

export interface AskCoachInput {
  studentId: string;
  assignmentId: string;
  coachIntent: "support" | "enrichment"; // What kind of help did the student seek?
  promptId?: string; // Which prompt were they working on?
  conversationTurns?: number; // How many back-and-forth exchanges?
}

export interface RetryAssignmentInput {
  studentId: string;
  assignmentId: string;
}

// ============================================
// Insight Generation Config
// ============================================

const INSIGHT_GENERATION_CONFIG = {
  // Score thresholds
  STRUGGLING_THRESHOLD: RECOMMENDATION_CONFIG.STRUGGLING_THRESHOLD, // 40
  DEVELOPING_THRESHOLD: RECOMMENDATION_CONFIG.DEVELOPING_THRESHOLD, // 70
  EXCELLING_THRESHOLD: RECOMMENDATION_CONFIG.EXCELLING_THRESHOLD, // 90

  // Hint usage thresholds
  HEAVY_HINT_USAGE: RECOMMENDATION_CONFIG.HEAVY_HINT_USAGE, // 0.6
  MINIMAL_HINT_USAGE: RECOMMENDATION_CONFIG.MINIMAL_HINT_USAGE, // 0.1

  // Improvement threshold
  SIGNIFICANT_IMPROVEMENT: RECOMMENDATION_CONFIG.SIGNIFICANT_IMPROVEMENT, // 20

  // Coach usage threshold
  HEAVY_COACH_USAGE: 5, // 5+ coach sessions = heavy usage
};

// ============================================
// Main Service Class
// ============================================

export class StudentActionService {
  private studentStore: StudentStore;
  private sessionStore: SessionStore;
  private insightStore: InsightStore;
  private assignmentStudentStore: AssignmentStudentStore;

  constructor() {
    this.studentStore = new StudentStore();
    this.sessionStore = new SessionStore();
    this.insightStore = new InsightStore();
    this.assignmentStudentStore = new AssignmentStudentStore();
  }

  // ============================================
  // 1. Complete Assignment
  // ============================================

  /**
   * Record assignment completion and generate insights.
   * - Updates AssignmentStudent with attempts, score, completion time
   * - Triggers AI evaluation → generates Insight objects for flagged areas
   * - Tracks improvement from previous attempts
   */
  completeAssignment(input: CompleteAssignmentInput): CompleteAssignmentResult {
    const {
      studentId,
      assignmentId,
      score,
      timeSpentSeconds,
      hintsUsed = 0,
      coachSessionsUsed = 0,
      responses = [],
    } = input;

    // Verify student exists
    const student = this.studentStore.load(studentId);
    if (!student) {
      return {
        success: false,
        error: `Student not found: ${studentId}`,
        assignmentRecord: null,
        insightsGenerated: [],
        understandingLevel: "developing",
        score: 0,
        attemptNumber: 0,
        isImprovement: false,
        improvementAmount: 0,
      };
    }

    // Verify lesson exists
    const lesson = loadLessonById(assignmentId);
    if (!lesson) {
      return {
        success: false,
        error: `Assignment/Lesson not found: ${assignmentId}`,
        assignmentRecord: null,
        insightsGenerated: [],
        understandingLevel: "developing",
        score: 0,
        attemptNumber: 0,
        isImprovement: false,
        improvementAmount: 0,
      };
    }

    // Load existing record to check for improvement
    const existingRecord = this.assignmentStudentStore.load(studentId, assignmentId);
    const previousScore = existingRecord?.highestScore || existingRecord?.score;
    const previousAttempts = existingRecord?.attempts || 0;

    // Complete the attempt
    const record = this.assignmentStudentStore.completeAttempt(
      studentId,
      assignmentId,
      score,
      timeSpentSeconds
    );

    // Record hint usage
    if (hintsUsed > 0) {
      this.assignmentStudentStore.recordHintUsage(studentId, assignmentId, hintsUsed);
    }

    // Record coach sessions
    for (let i = 0; i < coachSessionsUsed; i++) {
      this.assignmentStudentStore.recordCoachSession(studentId, assignmentId);
    }

    // Reload to get updated values
    const updatedRecord = this.assignmentStudentStore.load(studentId, assignmentId)!;

    // Calculate understanding level
    const totalQuestions = lesson.prompts.length;
    const hintUsageRate = totalQuestions > 0 ? hintsUsed / totalQuestions : 0;
    const understandingLevel = calculateUnderstandingLevel(score, hintUsageRate);

    // Calculate improvement
    const isImprovement = previousScore !== undefined && score > previousScore;
    const improvementAmount = previousScore !== undefined ? score - previousScore : 0;

    // Generate insights based on performance
    const insightsGenerated = this.generateInsightsFromCompletion(
      student,
      lesson,
      updatedRecord,
      score,
      hintsUsed,
      coachSessionsUsed,
      hintUsageRate,
      understandingLevel,
      isImprovement,
      improvementAmount
    );

    return {
      success: true,
      assignmentRecord: updatedRecord,
      insightsGenerated,
      understandingLevel,
      score,
      attemptNumber: updatedRecord.attempts,
      isImprovement,
      improvementAmount,
    };
  }

  /**
   * Generate insights based on assignment completion
   */
  private generateInsightsFromCompletion(
    student: Student,
    lesson: Lesson,
    record: AssignmentStudent,
    score: number,
    hintsUsed: number,
    coachSessionsUsed: number,
    hintUsageRate: number,
    understandingLevel: StudentUnderstandingLevel,
    isImprovement: boolean,
    improvementAmount: number
  ): Insight[] {
    const insights: Insight[] = [];
    const classId = student.classes?.[0] || "";

    // Check for existing insight to avoid duplicates
    const existingInsight = this.insightStore.findExisting(student.id, lesson.id, "check_in");

    // 1. Check-in needed: Low score or heavy hint usage
    if (
      (score < INSIGHT_GENERATION_CONFIG.STRUGGLING_THRESHOLD ||
        (hintUsageRate > INSIGHT_GENERATION_CONFIG.HEAVY_HINT_USAGE && score < INSIGHT_GENERATION_CONFIG.DEVELOPING_THRESHOLD)) &&
      !existingInsight
    ) {
      const evidence: string[] = [];
      if (score < INSIGHT_GENERATION_CONFIG.STRUGGLING_THRESHOLD) {
        evidence.push(`Score of ${score}% is below expected threshold`);
      }
      if (hintUsageRate > INSIGHT_GENERATION_CONFIG.HEAVY_HINT_USAGE) {
        evidence.push(`Used hints on ${Math.round(hintUsageRate * 100)}% of questions`);
      }
      if (coachSessionsUsed >= INSIGHT_GENERATION_CONFIG.HEAVY_COACH_USAGE) {
        evidence.push(`${coachSessionsUsed} coach sessions used`);
      }

      const insight: Insight = {
        id: `insight-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        studentId: student.id,
        assignmentId: lesson.id,
        classId,
        subject: lesson.subject,
        type: "check_in",
        priority: score < 30 ? "high" : "medium",
        confidence: 0.85,
        summary: `${student.name} may need support on "${lesson.title}"`,
        evidence,
        suggestedActions: [
          "Have a brief conversation to understand any difficulties",
          "Review specific questions where hints were used",
          "Consider providing additional practice materials",
        ],
        status: "pending_review",
        createdAt: new Date(),
      };
      this.insightStore.save(insight);
      insights.push(insight);
    }

    // 2. Celebrate progress: Significant improvement
    if (
      isImprovement &&
      improvementAmount >= INSIGHT_GENERATION_CONFIG.SIGNIFICANT_IMPROVEMENT
    ) {
      const existingCelebrate = this.insightStore.findExisting(student.id, lesson.id, "celebrate_progress");
      if (!existingCelebrate) {
        const insight: Insight = {
          id: `insight-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          studentId: student.id,
          assignmentId: lesson.id,
          classId,
          subject: lesson.subject,
          type: "celebrate_progress",
          priority: improvementAmount >= 30 ? "high" : "medium",
          confidence: 0.9,
          summary: `${student.name} showed significant improvement on "${lesson.title}"`,
          evidence: [
            `Score improved by ${improvementAmount} points`,
            `New score: ${score}%`,
            `Previous best: ${score - improvementAmount}%`,
          ],
          suggestedActions: [
            "Recognize the improvement with positive feedback",
            "Consider awarding a badge",
            "Discuss what strategies helped them improve",
          ],
          status: "pending_review",
          createdAt: new Date(),
        };
        this.insightStore.save(insight);
        insights.push(insight);
      }
    }

    // 3. Challenge opportunity: High score with minimal hints
    if (
      score >= INSIGHT_GENERATION_CONFIG.EXCELLING_THRESHOLD &&
      hintUsageRate <= INSIGHT_GENERATION_CONFIG.MINIMAL_HINT_USAGE
    ) {
      const existingChallenge = this.insightStore.findExisting(student.id, lesson.id, "challenge_opportunity");
      if (!existingChallenge) {
        const insight: Insight = {
          id: `insight-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          studentId: student.id,
          assignmentId: lesson.id,
          classId,
          subject: lesson.subject,
          type: "challenge_opportunity",
          priority: "medium",
          confidence: 0.85,
          summary: `${student.name} excelled on "${lesson.title}" - ready for challenge`,
          evidence: [
            `Scored ${score}% with minimal support`,
            `Used hints on only ${Math.round(hintUsageRate * 100)}% of questions`,
            record.attempts === 1 ? "Completed on first attempt" : `Completed in ${record.attempts} attempts`,
          ],
          suggestedActions: [
            "Offer extension or enrichment activities",
            "Consider peer tutoring opportunities",
            "Assign more challenging content",
          ],
          status: "pending_review",
          createdAt: new Date(),
        };
        this.insightStore.save(insight);
        insights.push(insight);
      }
    }

    // 4. Monitor: Multiple attempts with modest improvement
    if (
      record.attempts > 2 &&
      score >= INSIGHT_GENERATION_CONFIG.STRUGGLING_THRESHOLD &&
      score < INSIGHT_GENERATION_CONFIG.DEVELOPING_THRESHOLD &&
      !existingInsight
    ) {
      const insight: Insight = {
        id: `insight-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        studentId: student.id,
        assignmentId: lesson.id,
        classId,
        subject: lesson.subject,
        type: "monitor",
        priority: "low",
        confidence: 0.75,
        summary: `${student.name} is making steady progress on "${lesson.title}"`,
        evidence: [
          `${record.attempts} attempts completed`,
          `Current score: ${score}%`,
          isImprovement ? `Improved by ${improvementAmount} points` : "Score similar to previous attempt",
        ],
        suggestedActions: [
          "Continue to monitor progress",
          "Check in if score doesn't improve",
        ],
        status: "pending_review",
        createdAt: new Date(),
      };
      this.insightStore.save(insight);
      insights.push(insight);
    }

    return insights;
  }

  // ============================================
  // 2. Ask Coach
  // ============================================

  /**
   * Record when a student uses the AI coach.
   * - Tracks whether usage is support-seeking or enrichment-seeking
   * - Creates Insight for teacher review if support-heavy usage
   */
  askCoach(input: AskCoachInput): AskCoachResult {
    const { studentId, assignmentId, coachIntent, promptId, conversationTurns = 1 } = input;

    // Verify student exists
    const student = this.studentStore.load(studentId);
    if (!student) {
      return {
        success: false,
        error: `Student not found: ${studentId}`,
        sessionRecorded: false,
        coachIntent,
        insightGenerated: false,
      };
    }

    // Record coach session
    this.assignmentStudentStore.recordCoachSession(studentId, assignmentId);

    // Get updated record to check total coach usage
    const record = this.assignmentStudentStore.load(studentId, assignmentId);
    const totalCoachSessions = record?.coachSessionCount || 1;

    // Determine if we should generate an insight
    let insightGenerated = false;
    let insightId: string | undefined;

    // Generate insight if heavy support-seeking usage
    if (
      coachIntent === "support" &&
      totalCoachSessions >= INSIGHT_GENERATION_CONFIG.HEAVY_COACH_USAGE
    ) {
      // Check for existing insight
      const existing = this.insightStore.findExisting(studentId, assignmentId, "check_in");
      if (!existing) {
        const lesson = loadLessonById(assignmentId);
        const classId = student.classes?.[0] || "";

        const insight: Insight = {
          id: `insight-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          studentId,
          assignmentId,
          classId,
          subject: lesson?.subject,
          type: "check_in",
          priority: "medium",
          confidence: 0.8,
          summary: `${student.name} is frequently using coach support on "${lesson?.title || assignmentId}"`,
          evidence: [
            `${totalCoachSessions} coach sessions used`,
            `Pattern: ${coachIntent}-seeking behavior`,
            "May benefit from additional teacher support",
          ],
          suggestedActions: [
            "Check in to understand what concepts are challenging",
            "Review coach conversation logs if available",
            "Consider providing targeted instruction",
          ],
          status: "pending_review",
          createdAt: new Date(),
        };
        this.insightStore.save(insight);
        insightGenerated = true;
        insightId = insight.id;
      }
    }

    // Generate challenge insight if enrichment-seeking
    if (
      coachIntent === "enrichment" &&
      totalCoachSessions >= 3
    ) {
      const existing = this.insightStore.findExisting(studentId, assignmentId, "challenge_opportunity");
      if (!existing) {
        const lesson = loadLessonById(assignmentId);
        const classId = student.classes?.[0] || "";

        const insight: Insight = {
          id: `insight-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          studentId,
          assignmentId,
          classId,
          subject: lesson?.subject,
          type: "challenge_opportunity",
          priority: "low",
          confidence: 0.75,
          summary: `${student.name} is actively exploring deeper content`,
          evidence: [
            `${totalCoachSessions} coach sessions seeking more information`,
            "Pattern: enrichment-seeking behavior",
            "Shows curiosity and engagement",
          ],
          suggestedActions: [
            "Recognize their curiosity",
            "Offer additional challenge materials",
            "Consider peer tutoring opportunities",
          ],
          status: "pending_review",
          createdAt: new Date(),
        };
        this.insightStore.save(insight);
        insightGenerated = true;
        insightId = insight.id;
      }
    }

    return {
      success: true,
      sessionRecorded: true,
      coachIntent,
      insightGenerated,
      insightId,
    };
  }

  // ============================================
  // 3. Retry Assignment
  // ============================================

  /**
   * Start a retry of an assignment (when reassigned by teacher).
   * - Increments AssignmentStudent.attempts
   * - Resets necessary statuses for dashboard updates
   */
  retryAssignment(input: RetryAssignmentInput): RetryAssignmentResult {
    const { studentId, assignmentId } = input;

    // Load existing record
    let record = this.assignmentStudentStore.load(studentId, assignmentId);

    const previousAttempts = record?.attempts || 0;
    const previousScore = record?.highestScore || record?.score;

    // Start new attempt
    record = this.assignmentStudentStore.startAttempt(studentId, assignmentId);

    return {
      success: true,
      newAttemptNumber: record.attempts,
      previousScore,
      previousAttempts,
    };
  }

  /**
   * Check if a student can retry an assignment
   * (Teacher must have pushed it back)
   */
  canRetry(studentId: string, assignmentId: string): boolean {
    const record = this.assignmentStudentStore.load(studentId, assignmentId);

    // Can retry if:
    // 1. No record exists (never started)
    // 2. currentAttempt > attempts (teacher pushed back)
    // 3. No completion record for current attempt
    if (!record) return true;
    if (record.currentAttempt && record.currentAttempt > record.attempts) return true;
    if (!record.lastCompletedAt) return true;

    return false;
  }

  // ============================================
  // Query Methods
  // ============================================

  /**
   * Get student's assignment progress
   */
  getStudentProgress(studentId: string): {
    totalAssignments: number;
    completedCount: number;
    averageScore?: number;
    totalAttempts: number;
  } {
    return this.assignmentStudentStore.getStudentProgress(studentId);
  }

  /**
   * Get pending insights for a student
   */
  getStudentInsights(studentId: string): Insight[] {
    return this.insightStore.getByStudent(studentId, false);
  }

  /**
   * Get assignment record for a student
   */
  getAssignmentRecord(studentId: string, assignmentId: string): AssignmentStudent | null {
    return this.assignmentStudentStore.load(studentId, assignmentId);
  }
}

// ============================================
// Export singleton instance
// ============================================

export const studentActionService = new StudentActionService();
