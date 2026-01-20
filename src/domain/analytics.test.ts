import {
  calculateSessionDuration,
  calculateCoachUsage,
  calculateHintUsage,
  calculateInputMethods,
  calculateEngagementScore,
  formatDuration,
  getWeeklyActivity,
  getStudentAnalytics,
  getClassAnalytics,
} from "./analytics";
import { Session } from "./session";
import { Student } from "./student";

describe("analytics", () => {
  const createSession = (overrides: Partial<Session> = {}): Session => ({
    id: "session-1",
    studentId: "student-1",
    studentName: "Alice",
    lessonId: "lesson-1",
    lessonTitle: "Test Lesson",
    submission: {
      assignmentId: "a1",
      studentId: "student-1",
      responses: [],
      submittedAt: new Date(),
    },
    startedAt: new Date("2024-01-15T10:00:00Z"),
    status: "in_progress",
    ...overrides,
  });

  describe("calculateSessionDuration", () => {
    it("returns null for empty sessions", () => {
      expect(calculateSessionDuration([])).toBeNull();
    });

    it("returns null for sessions without completion time", () => {
      const sessions = [createSession({ status: "in_progress" })];
      expect(calculateSessionDuration(sessions)).toBeNull();
    });

    it("calculates duration for completed sessions", () => {
      const sessions = [
        createSession({
          status: "completed",
          startedAt: new Date("2024-01-15T10:00:00Z"),
          completedAt: new Date("2024-01-15T10:30:00Z"),
        }),
        createSession({
          id: "session-2",
          status: "completed",
          startedAt: new Date("2024-01-15T11:00:00Z"),
          completedAt: new Date("2024-01-15T11:20:00Z"),
        }),
      ];

      const result = calculateSessionDuration(sessions);

      expect(result).not.toBeNull();
      expect(result?.averageMinutes).toBe(25); // (30 + 20) / 2
      expect(result?.fastestMinutes).toBe(20);
      expect(result?.slowestMinutes).toBe(30);
      expect(result?.totalSessions).toBe(2);
    });
  });

  describe("calculateCoachUsage", () => {
    it("returns zeros for sessions without coach interactions", () => {
      const sessions = [createSession()];
      const result = calculateCoachUsage(sessions);

      expect(result.helpRequestCount).toBe(0);
      expect(result.elaborationCount).toBe(0);
      expect(result.moreExplorationCount).toBe(0);
      expect(result.totalInteractions).toBe(0);
    });

    it("counts coach interactions correctly", () => {
      const sessions = [
        createSession({
          submission: {
            assignmentId: "a1",
            studentId: "student-1",
            submittedAt: new Date(),
            responses: [
              {
                promptId: "q1",
                response: "Answer",
                hintUsed: false,
                helpConversation: {
                  mode: "help",
                  turns: [
                    { role: "student", message: "Help me" },
                    { role: "coach", message: "Sure!" },
                  ],
                },
              },
              {
                promptId: "q2",
                response: "Answer 2",
                hintUsed: false,
                moreConversation: {
                  mode: "more",
                  turns: [
                    { role: "student", message: "Tell me more" },
                    { role: "coach", message: "Here's more..." },
                  ],
                },
              },
            ],
          },
        }),
      ];

      const result = calculateCoachUsage(sessions, 1);

      expect(result.helpRequestCount).toBe(1);
      expect(result.moreExplorationCount).toBe(1);
      expect(result.totalInteractions).toBe(2);
      expect(result.avgTurnsPerInteraction).toBe(2);
      expect(result.studentsUsingCoach).toBe(1);
      expect(result.percentageUsingCoach).toBe(100);
    });
  });

  describe("calculateHintUsage", () => {
    it("returns zeros for empty sessions", () => {
      const result = calculateHintUsage([]);
      expect(result.totalHintsUsed).toBe(0);
      expect(result.totalResponses).toBe(0);
      expect(result.hintUsageRate).toBe(0);
    });

    it("calculates hint usage rate correctly", () => {
      const sessions = [
        createSession({
          status: "completed",
          evaluation: {
            totalScore: 80,
            feedback: "Good",
            criteriaScores: [
              { criterionId: "q1", score: 40 },
              { criterionId: "q2", score: 40 },
            ],
          },
          submission: {
            assignmentId: "a1",
            studentId: "student-1",
            submittedAt: new Date(),
            responses: [
              { promptId: "q1", response: "Answer 1", hintUsed: true },
              { promptId: "q2", response: "Answer 2", hintUsed: false },
            ],
          },
        }),
      ];

      const result = calculateHintUsage(sessions);

      expect(result.totalHintsUsed).toBe(1);
      expect(result.totalResponses).toBe(2);
      expect(result.hintUsageRate).toBe(50);
      expect(result.avgScoreWithHint).toBe(40);
      expect(result.avgScoreWithoutHint).toBe(40);
    });
  });

  describe("calculateInputMethods", () => {
    it("returns zeros for empty sessions", () => {
      const result = calculateInputMethods([]);
      expect(result.voiceCount).toBe(0);
      expect(result.typedCount).toBe(0);
      expect(result.voicePercentage).toBe(0);
    });

    it("counts input methods correctly", () => {
      const sessions = [
        createSession({
          submission: {
            assignmentId: "a1",
            studentId: "student-1",
            submittedAt: new Date(),
            responses: [
              { promptId: "q1", response: "Answer 1", hintUsed: false, inputSource: "voice" },
              { promptId: "q2", response: "Answer 2", hintUsed: false, inputSource: "typed" },
              { promptId: "q3", response: "Answer 3", hintUsed: false }, // defaults to typed
            ],
          },
        }),
      ];

      const result = calculateInputMethods(sessions);

      expect(result.voiceCount).toBe(1);
      expect(result.typedCount).toBe(2);
      expect(result.voicePercentage).toBe(33);
    });
  });

  describe("calculateEngagementScore", () => {
    it("returns 0 for empty sessions", () => {
      expect(calculateEngagementScore([])).toBe(0);
    });

    it("returns base score for minimal engagement", () => {
      const sessions = [createSession({ status: "in_progress" })];
      const score = calculateEngagementScore(sessions);
      expect(score).toBeGreaterThanOrEqual(50);
    });

    it("increases score for completed sessions", () => {
      const completedSessions = [
        createSession({ status: "completed" }),
        createSession({ id: "s2", status: "completed" }),
      ];
      const inProgressSessions = [
        createSession({ status: "in_progress" }),
        createSession({ id: "s2", status: "in_progress" }),
      ];

      const completedScore = calculateEngagementScore(completedSessions);
      const inProgressScore = calculateEngagementScore(inProgressSessions);

      expect(completedScore).toBeGreaterThan(inProgressScore);
    });
  });

  describe("formatDuration", () => {
    it("formats less than 1 minute", () => {
      expect(formatDuration(0.5)).toBe("< 1 min");
    });

    it("formats minutes", () => {
      expect(formatDuration(15)).toBe("15 min");
      expect(formatDuration(45)).toBe("45 min");
    });

    it("formats hours and minutes", () => {
      expect(formatDuration(90)).toBe("1h 30m");
      expect(formatDuration(120)).toBe("2h");
      expect(formatDuration(135)).toBe("2h 15m");
    });
  });

  describe("getWeeklyActivity", () => {
    it("returns correct number of weeks", () => {
      const result = getWeeklyActivity([], 4);
      expect(result).toHaveLength(4);
    });

    it("labels weeks correctly", () => {
      const result = getWeeklyActivity([], 4);
      expect(result[0].week).toBe("Week 1");
      expect(result[3].week).toBe("Week 4");
    });

    it("counts sessions in correct weeks", () => {
      const now = new Date();
      const lastWeek = new Date(now);
      lastWeek.setDate(lastWeek.getDate() - 3); // 3 days ago

      const sessions = [
        createSession({
          status: "completed",
          completedAt: lastWeek,
          evaluation: { totalScore: 80, feedback: "", criteriaScores: [] },
        }),
      ];

      const result = getWeeklyActivity(sessions, 4);
      const lastWeekData = result[result.length - 1]; // Most recent week

      expect(lastWeekData.sessions).toBe(1);
      expect(lastWeekData.avgScore).toBe(80);
    });
  });

  describe("getStudentAnalytics", () => {
    it("returns complete analytics object", () => {
      const sessions = [
        createSession({
          status: "completed",
          startedAt: new Date("2024-01-15T10:00:00Z"),
          completedAt: new Date("2024-01-15T10:30:00Z"),
          evaluation: { totalScore: 80, feedback: "", criteriaScores: [] },
        }),
      ];

      const result = getStudentAnalytics(sessions);

      expect(result).toHaveProperty("sessionDuration");
      expect(result).toHaveProperty("coachUsage");
      expect(result).toHaveProperty("hintUsage");
      expect(result).toHaveProperty("inputMethods");
      expect(result).toHaveProperty("engagementScore");
    });
  });

  describe("getClassAnalytics", () => {
    it("returns complete class analytics", () => {
      const students: Student[] = [
        { id: "s1", name: "Alice", classes: [], assignments: [], createdAt: new Date() },
        { id: "s2", name: "Bob", classes: [], assignments: [], createdAt: new Date() },
      ];

      const sessions = [
        createSession({
          studentId: "s1",
          studentName: "Alice",
          status: "completed",
          evaluation: { totalScore: 90, feedback: "", criteriaScores: [] },
        }),
        createSession({
          id: "s2",
          studentId: "s2",
          studentName: "Bob",
          status: "completed",
          evaluation: { totalScore: 45, feedback: "", criteriaScores: [] },
        }),
      ];

      const result = getClassAnalytics(students, sessions);

      expect(result).toHaveProperty("sessionDuration");
      expect(result).toHaveProperty("coachUsage");
      expect(result).toHaveProperty("hintUsage");
      expect(result).toHaveProperty("topPerformers");
      expect(result).toHaveProperty("needsSupport");
      expect(result).toHaveProperty("lessonDifficulty");

      // Alice should be a top performer (90 >= 80)
      expect(result.topPerformers.some(s => s.name === "Alice")).toBe(true);

      // Bob should need support (45 < 60)
      expect(result.needsSupport.some(s => s.name === "Bob")).toBe(true);
    });
  });
});
