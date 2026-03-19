/**
 * Tests for assignment lifecycle bucketing logic.
 *
 * Verifies that in-progress students (started but not submitted) do NOT
 * trigger "needs support" flags, and that bucketing works correctly.
 */

import { computeAssignmentState } from "./assignmentLifecycle";
import { Lesson } from "./lesson";
import { Session } from "./session";

// ── Test Fixtures ───────────────────────────────────────────────────────────

function makeLessonFixture(id = "lesson-1"): Lesson {
  return {
    id,
    title: "Test Lesson",
    description: "A test lesson",
    difficulty: "beginner",
    prompts: [
      { id: "p1", input: "What is 2+2?", type: "explain", hints: ["Think about counting"] },
      { id: "p2", input: "Why is the sky blue?", type: "explain", hints: ["Think about light"] },
    ],
  };
}

function makeSession(overrides: Partial<Session> & { studentId: string; lessonId: string }): Session {
  return {
    id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    studentName: overrides.studentName || "Student",
    lessonTitle: "Test Lesson",
    submission: {
      assignmentId: overrides.lessonId,
      studentId: overrides.studentId,
      responses: [],
      submittedAt: new Date(),
    },
    startedAt: new Date(),
    status: "in_progress",
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("computeAssignmentState", () => {
  const lesson = makeLessonFixture();

  describe("in-progress students should NOT trigger needsSupport", () => {
    it("student with in-progress session (no evaluation) has needsSupport=false", () => {
      const sessions: Session[] = [
        makeSession({
          studentId: "s1",
          studentName: "Alice",
          lessonId: lesson.id,
          status: "in_progress",
          // No evaluation — score defaults to 0
        }),
      ];

      const state = computeAssignmentState(lesson, sessions, ["s1"]);

      // The student is in progress
      expect(state.inProgressCount).toBe(1);
      expect(state.completedCount).toBe(0);

      // Critical: in-progress student should NOT be flagged as needing support
      expect(state.studentsNeedingSupport).toBe(0);
      const aliceStatus = state.studentStatuses.find((s) => s.studentId === "s1");
      expect(aliceStatus?.needsSupport).toBe(false);
      expect(aliceStatus?.isComplete).toBe(false);
    });

    it("multiple in-progress students produce studentsNeedingSupport=0", () => {
      const sessions: Session[] = [
        makeSession({ studentId: "s1", studentName: "Alice", lessonId: lesson.id, status: "in_progress" }),
        makeSession({ studentId: "s2", studentName: "Bob", lessonId: lesson.id, status: "in_progress" }),
        makeSession({ studentId: "s3", studentName: "Charlie", lessonId: lesson.id, status: "in_progress" }),
      ];

      const state = computeAssignmentState(lesson, sessions, ["s1", "s2", "s3"]);

      expect(state.inProgressCount).toBe(3);
      expect(state.completedCount).toBe(0);
      expect(state.studentsNeedingSupport).toBe(0);
    });

    it("only completed students with low scores trigger needsSupport", () => {
      const sessions: Session[] = [
        // Completed with low score → needs support
        makeSession({
          studentId: "s1",
          studentName: "Alice",
          lessonId: lesson.id,
          status: "completed",
          completedAt: new Date(),
          evaluation: { totalScore: 20, criteriaScores: [], feedback: "" },
        }),
        // In-progress (no eval) → should NOT need support
        makeSession({
          studentId: "s2",
          studentName: "Bob",
          lessonId: lesson.id,
          status: "in_progress",
        }),
      ];

      const state = computeAssignmentState(lesson, sessions, ["s1", "s2"]);

      expect(state.completedCount).toBe(1);
      expect(state.inProgressCount).toBe(1);
      // Only Alice (completed, score 20) should be flagged
      expect(state.studentsNeedingSupport).toBe(1);

      const aliceStatus = state.studentStatuses.find((s) => s.studentId === "s1");
      expect(aliceStatus?.needsSupport).toBe(true);

      const bobStatus = state.studentStatuses.find((s) => s.studentId === "s2");
      expect(bobStatus?.needsSupport).toBe(false);
    });
  });

  describe("completed students", () => {
    it("completed student with high score does NOT need support", () => {
      const sessions: Session[] = [
        makeSession({
          studentId: "s1",
          studentName: "Alice",
          lessonId: lesson.id,
          status: "completed",
          completedAt: new Date(),
          evaluation: { totalScore: 85, criteriaScores: [], feedback: "Great job!" },
        }),
      ];

      const state = computeAssignmentState(lesson, sessions, ["s1"]);

      expect(state.studentsNeedingSupport).toBe(0);
      expect(state.studentStatuses[0].needsSupport).toBe(false);
      expect(state.studentStatuses[0].understanding).toBe("strong");
    });

    it("completed student with high hint usage triggers needsSupport", () => {
      const sessions: Session[] = [
        makeSession({
          studentId: "s1",
          studentName: "Alice",
          lessonId: lesson.id,
          status: "completed",
          completedAt: new Date(),
          evaluation: { totalScore: 60, criteriaScores: [], feedback: "OK" },
          submission: {
            assignmentId: lesson.id,
            studentId: "s1",
            responses: [
              { promptId: "p1", response: "4", hintUsed: true },
              { promptId: "p2", response: "Light scatters", hintUsed: true },
            ],
            submittedAt: new Date(),
          },
        }),
      ];

      const state = computeAssignmentState(lesson, sessions, ["s1"]);

      // 100% hint usage > 50% threshold → needs support even though score is 60
      expect(state.studentsNeedingSupport).toBe(1);
      expect(state.studentStatuses[0].needsSupport).toBe(true);
    });
  });

  describe("students with no session", () => {
    it("students who haven't started are NOT flagged as needing support", () => {
      const state = computeAssignmentState(lesson, [], ["s1", "s2"]);

      expect(state.totalStudents).toBe(2);
      expect(state.completedCount).toBe(0);
      expect(state.inProgressCount).toBe(0);
      expect(state.studentsNeedingSupport).toBe(0);

      // All students should have needsSupport=false
      for (const status of state.studentStatuses) {
        expect(status.needsSupport).toBe(false);
      }
    });
  });

  describe("lifecycle state", () => {
    it("assignment with only in-progress students stays active", () => {
      const sessions: Session[] = [
        makeSession({ studentId: "s1", studentName: "Alice", lessonId: lesson.id, status: "in_progress" }),
      ];

      const state = computeAssignmentState(lesson, sessions, ["s1"]);

      expect(state.lifecycleState).toBe("active");
      // Should have "incomplete-work" reason, NOT "students-need-support"
      expect(state.activeReasons).toContain("incomplete-work");
      expect(state.activeReasons).not.toContain("students-need-support");
    });
  });
});
