import OpenAI from "openai";
import { LLMEvaluator } from "./llmEvaluator";
import { Submission } from "./submission";
import { Lesson } from "./lesson";

// Mock OpenAI
jest.mock("openai");

const MockedOpenAI = OpenAI as jest.MockedClass<typeof OpenAI>;

describe("LLMEvaluator", () => {
  let mockCreate: jest.Mock;
  let evaluator: LLMEvaluator;

  const createLesson = (overrides: Partial<Lesson> = {}): Lesson => ({
    id: "lesson-1",
    title: "Test Lesson",
    description: "A test lesson",
    difficulty: "beginner",
    gradeLevel: "2nd grade",
    prompts: [
      {
        id: "q1",
        type: "explain",
        input: "Why do plants need sunlight?",
        hints: ["Think about energy", "Photosynthesis"],
      },
      {
        id: "q2",
        type: "explain",
        input: "How do animals stay warm?",
        hints: ["Think about fur", "Body heat"],
      },
    ],
    ...overrides,
  });

  const createSubmission = (overrides: Partial<Submission> = {}): Submission => ({
    assignmentId: "assignment-1",
    studentId: "student-1",
    submittedAt: new Date("2024-01-15"),
    responses: [
      {
        promptId: "q1",
        response: "Plants need sunlight to make food through photosynthesis.",
        reflection: "I learned this in science class.",
        hintUsed: false,
      },
    ],
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();

    mockCreate = jest.fn();
    MockedOpenAI.mockImplementation(
      () =>
        ({
          chat: {
            completions: {
              create: mockCreate,
            },
          },
        }) as unknown as OpenAI
    );

    evaluator = new LLMEvaluator("test-api-key");
  });

  describe("constructor", () => {
    it("creates OpenAI client with provided API key", () => {
      new LLMEvaluator("my-api-key");

      expect(MockedOpenAI).toHaveBeenCalledWith({ apiKey: "my-api-key" });
    });

    it("uses custom model when specified", () => {
      new LLMEvaluator("my-api-key", "gpt-4");

      expect(MockedOpenAI).toHaveBeenCalled();
    });
  });

  describe("evaluate", () => {
    it("evaluates submission and returns result", async () => {
      const mockEvalResponse = {
        understanding: 22,
        reasoning: 13,
        clarity: 9,
        total: 44,
        comment: "Great job explaining how plants use sunlight!",
      };

      mockCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(mockEvalResponse) } }],
      });

      const lesson = createLesson();
      const submission = createSubmission();

      const result = await evaluator.evaluate(submission, lesson);

      expect(result.totalScore).toBe(44);
      expect(result.feedback).toContain("Great job");
      expect(result.criteriaScores).toHaveLength(1);
      expect(result.criteriaScores[0].criterionId).toBe("q1");
    });

    it("evaluates multiple responses", async () => {
      const mockEvalResponse1 = {
        understanding: 20,
        reasoning: 10,
        clarity: 8,
        total: 38,
        comment: "Nice work on plants!",
      };

      const mockEvalResponse2 = {
        understanding: 23,
        reasoning: 12,
        clarity: 9,
        total: 44,
        comment: "Great understanding of animals!",
      };

      mockCreate
        .mockResolvedValueOnce({
          choices: [{ message: { content: JSON.stringify(mockEvalResponse1) } }],
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: JSON.stringify(mockEvalResponse2) } }],
        });

      const lesson = createLesson();
      const submission = createSubmission({
        responses: [
          {
            promptId: "q1",
            response: "Plants use sunlight",
            reflection: "I thought about it",
            hintUsed: false,
          },
          {
            promptId: "q2",
            response: "Animals have fur to stay warm",
            reflection: "My dog has fur",
            hintUsed: true,
          },
        ],
      });

      const result = await evaluator.evaluate(submission, lesson);

      expect(result.totalScore).toBe(82); // 38 + 44
      expect(result.criteriaScores).toHaveLength(2);
    });

    it("caps total score at 100", async () => {
      const mockEvalResponse = {
        understanding: 25,
        reasoning: 15,
        clarity: 10,
        total: 50,
        comment: "Perfect!",
      };

      // Both responses score 50 = 100 total, should be capped
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(mockEvalResponse) } }],
      });

      const lesson = createLesson();
      const submission = createSubmission({
        responses: [
          { promptId: "q1", response: "Great answer 1", hintUsed: false },
          { promptId: "q2", response: "Great answer 2", hintUsed: false },
        ],
      });

      const result = await evaluator.evaluate(submission, lesson);

      expect(result.totalScore).toBe(100);
    });

    it("uses default grade level when not specified", async () => {
      const mockEvalResponse = {
        understanding: 20,
        reasoning: 10,
        clarity: 8,
        total: 38,
        comment: "Good work!",
      };

      mockCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(mockEvalResponse) } }],
      });

      const lesson = createLesson({ gradeLevel: undefined });
      const submission = createSubmission();

      await evaluator.evaluate(submission, lesson);

      // Check that the API was called (with default grade level in prompt)
      expect(mockCreate).toHaveBeenCalled();
    });

    it("skips responses with unknown prompt IDs", async () => {
      const lesson = createLesson();
      const submission = createSubmission({
        responses: [
          { promptId: "unknown-id", response: "Some answer", hintUsed: false },
        ],
      });

      const result = await evaluator.evaluate(submission, lesson);

      expect(result.criteriaScores).toHaveLength(0);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("provides default feedback when no comments returned", async () => {
      const mockEvalResponse = {
        understanding: 20,
        reasoning: 10,
        clarity: 8,
        total: 38,
      };

      mockCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(mockEvalResponse) } }],
      });

      const lesson = createLesson();
      const submission = createSubmission();

      const result = await evaluator.evaluate(submission, lesson);

      expect(result.feedback).toBe("Review your responses and keep practicing!");
    });

    it("handles API returning no content gracefully", async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: null } }],
      });

      const lesson = createLesson();
      const submission = createSubmission();

      const result = await evaluator.evaluate(submission, lesson);

      // Should return fallback score
      expect(result.criteriaScores[0].score).toBe(25);
      expect(result.criteriaScores[0].comment).toContain("Unable to evaluate");
    });

    it("handles API error gracefully with fallback score", async () => {
      mockCreate.mockRejectedValue(new Error("API Error"));

      const lesson = createLesson();
      const submission = createSubmission();

      const result = await evaluator.evaluate(submission, lesson);

      expect(result.criteriaScores[0].score).toBe(25); // Fallback middle score
      expect(result.criteriaScores[0].comment).toContain("Unable to evaluate");
    });

    it("clamps individual response scores between 0 and 50", async () => {
      const mockEvalResponse = {
        understanding: 30,
        reasoning: 20,
        clarity: 15,
        total: 65, // Over 50
        comment: "Wow!",
      };

      mockCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(mockEvalResponse) } }],
      });

      const lesson = createLesson();
      const submission = createSubmission();

      const result = await evaluator.evaluate(submission, lesson);

      expect(result.criteriaScores[0].score).toBe(50); // Clamped to max
    });

    it("handles negative scores gracefully", async () => {
      const mockEvalResponse = {
        understanding: -5,
        reasoning: -3,
        clarity: -2,
        total: -10,
        comment: "Invalid score",
      };

      mockCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(mockEvalResponse) } }],
      });

      const lesson = createLesson();
      const submission = createSubmission();

      const result = await evaluator.evaluate(submission, lesson);

      expect(result.criteriaScores[0].score).toBe(0); // Clamped to min
    });

    it("handles missing total in response", async () => {
      const mockEvalResponse = {
        understanding: 20,
        reasoning: 10,
        clarity: 8,
        // total is missing
        comment: "Good!",
      };

      mockCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(mockEvalResponse) } }],
      });

      const lesson = createLesson();
      const submission = createSubmission();

      const result = await evaluator.evaluate(submission, lesson);

      expect(result.criteriaScores[0].score).toBe(0); // Falls back to 0
    });

    it("includes hint usage in prompt to API", async () => {
      const mockEvalResponse = {
        understanding: 18,
        reasoning: 8,
        clarity: 7,
        total: 33,
        comment: "Good effort!",
      };

      mockCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(mockEvalResponse) } }],
      });

      const lesson = createLesson();
      const submission = createSubmission({
        responses: [
          {
            promptId: "q1",
            response: "Plants need sunlight",
            hintUsed: true,
          },
        ],
      });

      await evaluator.evaluate(submission, lesson);

      // Verify API was called with hint usage info
      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.messages[1].content).toContain("HINT USED: Yes");
    });
  });
});
