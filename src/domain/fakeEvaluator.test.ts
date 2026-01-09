import { FakeEvaluator } from "./fakeEvaluator";
import { Submission } from "./submission";
import { Lesson } from "./lesson";

describe("FakeEvaluator", () => {
  let evaluator: FakeEvaluator;
  let mockLesson: Lesson;

  beforeEach(() => {
    evaluator = new FakeEvaluator();
    mockLesson = {
      id: "test-lesson",
      title: "Test Lesson",
      description: "A test lesson",
      difficulty: "beginner",
      prompts: [
        { id: "p1", type: "explain", input: "Question 1", hints: [] },
        { id: "p2", type: "explain", input: "Question 2", hints: [] }
      ]
    };
  });

  it("should give base score of 30 per prompt without hints", async () => {
    const submission: Submission = {
      assignmentId: "test-lesson",
      studentId: "student-1",
      responses: [
        { promptId: "p1", response: "Answer 1", hintUsed: false },
        { promptId: "p2", response: "Answer 2", hintUsed: false }
      ],
      submittedAt: new Date()
    };

    const result = await evaluator.evaluate(submission, mockLesson);

    expect(result.totalScore).toBe(60);
    expect(result.criteriaScores[0].score).toBe(30);
    expect(result.criteriaScores[1].score).toBe(30);
  });

  it("should deduct 5 points when hint is used", async () => {
    const submission: Submission = {
      assignmentId: "test-lesson",
      studentId: "student-1",
      responses: [
        { promptId: "p1", response: "Answer 1", hintUsed: true }
      ],
      submittedAt: new Date()
    };

    const result = await evaluator.evaluate(submission, mockLesson);

    expect(result.criteriaScores[0].score).toBe(25);
    expect(result.criteriaScores[0].comment).toContain("Hint was used");
  });

  it("should add 5 bonus points for reflection", async () => {
    const submission: Submission = {
      assignmentId: "test-lesson",
      studentId: "student-1",
      responses: [
        { promptId: "p1", response: "Answer 1", hintUsed: false, reflection: "I thought about it this way..." }
      ],
      submittedAt: new Date()
    };

    const result = await evaluator.evaluate(submission, mockLesson);

    // 30 base + 5 reflection = 35, but capped at 30
    expect(result.criteriaScores[0].score).toBe(30);
    expect(result.criteriaScores[0].comment).toContain("Nice reasoning");
  });

  it("should cap total score at 100", async () => {
    const submission: Submission = {
      assignmentId: "test-lesson",
      studentId: "student-1",
      responses: [
        { promptId: "p1", response: "Answer 1", hintUsed: false },
        { promptId: "p2", response: "Answer 2", hintUsed: false },
        { promptId: "p3", response: "Answer 3", hintUsed: false },
        { promptId: "p4", response: "Answer 4", hintUsed: false }
      ],
      submittedAt: new Date()
    };

    const result = await evaluator.evaluate(submission, mockLesson);

    expect(result.totalScore).toBe(100); // 4 * 30 = 120, capped at 100
  });

  it("should return feedback message", async () => {
    const submission: Submission = {
      assignmentId: "test-lesson",
      studentId: "student-1",
      responses: [
        { promptId: "p1", response: "Answer 1", hintUsed: false }
      ],
      submittedAt: new Date()
    };

    const result = await evaluator.evaluate(submission, mockLesson);

    expect(result.feedback).toBeDefined();
    expect(result.feedback.length).toBeGreaterThan(0);
  });
});
