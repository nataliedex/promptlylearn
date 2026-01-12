import { LessonParams } from "./lessonGenerator";

describe("lessonGenerator", () => {
  const originalEnv = process.env.OPENAI_API_KEY;

  afterEach(() => {
    process.env.OPENAI_API_KEY = originalEnv;
    jest.resetModules();
  });

  describe("generateLesson", () => {
    it("returns null when OPENAI_API_KEY is not set", async () => {
      delete process.env.OPENAI_API_KEY;
      jest.resetModules();

      const { generateLesson } = await import("./lessonGenerator");

      const params: LessonParams = {
        mode: "topic",
        content: "Plants",
        difficulty: "beginner",
        questionCount: 2,
      };

      const result = await generateLesson(params);
      expect(result).toBeNull();
    });
  });

  describe("generateSingleQuestion", () => {
    it("returns null when OPENAI_API_KEY is not set", async () => {
      delete process.env.OPENAI_API_KEY;
      jest.resetModules();

      const { generateSingleQuestion } = await import("./lessonGenerator");

      const result = await generateSingleQuestion("Context", [], "beginner");
      expect(result).toBeNull();
    });
  });

  describe("LessonParams validation", () => {
    it("supports all creation modes", () => {
      const modes: LessonParams["mode"][] = [
        "book-title",
        "book-excerpt",
        "pasted-text",
        "topic",
        "guided",
      ];

      for (const mode of modes) {
        const params: LessonParams = {
          mode,
          content: "Test content",
          difficulty: "beginner",
          questionCount: 2,
        };
        expect(params.mode).toBe(mode);
      }
    });

    it("supports all difficulty levels", () => {
      const difficulties: LessonParams["difficulty"][] = [
        "beginner",
        "intermediate",
        "advanced",
      ];

      for (const difficulty of difficulties) {
        const params: LessonParams = {
          mode: "topic",
          content: "Test",
          difficulty,
          questionCount: 2,
        };
        expect(params.difficulty).toBe(difficulty);
      }
    });

    it("accepts optional gradeLevel", () => {
      const params: LessonParams = {
        mode: "topic",
        content: "Test",
        difficulty: "beginner",
        questionCount: 2,
        gradeLevel: "3rd grade",
      };
      expect(params.gradeLevel).toBe("3rd grade");
    });
  });
});
