import { loadLesson, getAllLessons } from "./lessonLoader";

describe("lessonLoader", () => {
  describe("loadLesson", () => {
    it("should load a valid lesson file", () => {
      const lesson = loadLesson("intro-prompts.json");

      expect(lesson).toBeDefined();
      expect(lesson.id).toBeDefined();
      expect(lesson.title).toBeDefined();
      expect(lesson.prompts).toBeInstanceOf(Array);
      expect(lesson.prompts.length).toBeGreaterThan(0);
    });

    it("should throw error for non-existent file", () => {
      expect(() => loadLesson("non-existent.json")).toThrow();
    });
  });

  describe("getAllLessons", () => {
    it("should return an array of lessons", () => {
      const lessons = getAllLessons();

      expect(lessons).toBeInstanceOf(Array);
      expect(lessons.length).toBeGreaterThan(0);
    });

    it("should sort lessons by difficulty (beginner first)", () => {
      const lessons = getAllLessons();

      // Find first beginner and first intermediate
      const beginnerIndex = lessons.findIndex(l => l.difficulty === "beginner");
      const intermediateIndex = lessons.findIndex(l => l.difficulty === "intermediate");

      if (beginnerIndex !== -1 && intermediateIndex !== -1) {
        expect(beginnerIndex).toBeLessThan(intermediateIndex);
      }
    });

    it("should have required fields on each lesson", () => {
      const lessons = getAllLessons();

      lessons.forEach(lesson => {
        expect(lesson.id).toBeDefined();
        expect(lesson.title).toBeDefined();
        expect(lesson.description).toBeDefined();
        expect(lesson.difficulty).toBeDefined();
        expect(lesson.prompts).toBeInstanceOf(Array);
      });
    });
  });
});
