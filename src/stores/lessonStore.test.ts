import fs from "fs";
import path from "path";
import {
  generateLessonId,
  lessonExists,
  getUniqueLessonId,
  saveLesson,
  deleteLesson,
} from "./lessonStore";
import { Lesson } from "../domain/lesson";

// Mock fs module
jest.mock("fs");

const mockFs = fs as jest.Mocked<typeof fs>;

describe("lessonStore", () => {
  const LESSONS_DIR = path.join(__dirname, "../data/lessons");

  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.existsSync.mockReturnValue(true);
  });

  describe("generateLessonId", () => {
    it("converts title to lowercase URL-safe ID", () => {
      expect(generateLessonId("Hello World")).toBe("hello-world");
    });

    it("replaces special characters with hyphens", () => {
      expect(generateLessonId("Math: Addition & Subtraction!")).toBe(
        "math-addition-subtraction"
      );
    });

    it("removes leading and trailing hyphens", () => {
      expect(generateLessonId("---Hello---")).toBe("hello");
    });

    it("collapses multiple hyphens into one", () => {
      expect(generateLessonId("Hello   World")).toBe("hello-world");
    });

    it("truncates to 50 characters", () => {
      const longTitle =
        "This is a very long lesson title that exceeds fifty characters in length";
      const result = generateLessonId(longTitle);
      expect(result.length).toBeLessThanOrEqual(50);
    });

    it("handles empty string", () => {
      expect(generateLessonId("")).toBe("");
    });

    it("handles numbers in title", () => {
      expect(generateLessonId("Chapter 1: The Beginning")).toBe(
        "chapter-1-the-beginning"
      );
    });
  });

  describe("lessonExists", () => {
    it("returns true when lesson file exists", () => {
      mockFs.existsSync.mockReturnValue(true);

      expect(lessonExists("my-lesson")).toBe(true);
      expect(mockFs.existsSync).toHaveBeenCalledWith(
        path.join(LESSONS_DIR, "my-lesson.json")
      );
    });

    it("returns false when lesson file does not exist", () => {
      mockFs.existsSync.mockReturnValue(false);

      expect(lessonExists("nonexistent")).toBe(false);
    });
  });

  describe("getUniqueLessonId", () => {
    it("returns base ID when it does not exist", () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = getUniqueLessonId("My Lesson");

      expect(result).toBe("my-lesson");
    });

    it("appends number when base ID exists", () => {
      mockFs.existsSync
        .mockReturnValueOnce(true) // my-lesson exists
        .mockReturnValueOnce(false); // my-lesson-2 does not exist

      const result = getUniqueLessonId("My Lesson");

      expect(result).toBe("my-lesson-2");
    });

    it("increments number until unique ID found", () => {
      mockFs.existsSync
        .mockReturnValueOnce(true) // my-lesson exists
        .mockReturnValueOnce(true) // my-lesson-2 exists
        .mockReturnValueOnce(true) // my-lesson-3 exists
        .mockReturnValueOnce(false); // my-lesson-4 does not exist

      const result = getUniqueLessonId("My Lesson");

      expect(result).toBe("my-lesson-4");
    });
  });

  describe("saveLesson", () => {
    const lesson: Lesson = {
      id: "test-lesson",
      title: "Test Lesson",
      description: "A test lesson",
      prompts: [],
      difficulty: "beginner",
    };

    it("creates lessons directory if it does not exist", () => {
      mockFs.existsSync.mockReturnValue(false);

      saveLesson(lesson);

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(LESSONS_DIR, {
        recursive: true,
      });
    });

    it("saves lesson to correct file path", () => {
      mockFs.existsSync.mockReturnValue(true);

      saveLesson(lesson);

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        path.join(LESSONS_DIR, "test-lesson.json"),
        JSON.stringify(lesson, null, 2),
        "utf-8"
      );
    });

    it("returns the file path", () => {
      mockFs.existsSync.mockReturnValue(true);

      const result = saveLesson(lesson);

      expect(result).toBe(path.join(LESSONS_DIR, "test-lesson.json"));
    });
  });

  describe("deleteLesson", () => {
    it("deletes lesson file and returns true when file exists", () => {
      mockFs.existsSync.mockReturnValue(true);

      const result = deleteLesson("my-lesson");

      expect(result).toBe(true);
      expect(mockFs.unlinkSync).toHaveBeenCalledWith(
        path.join(LESSONS_DIR, "my-lesson.json")
      );
    });

    it("returns false when file does not exist", () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = deleteLesson("nonexistent");

      expect(result).toBe(false);
      expect(mockFs.unlinkSync).not.toHaveBeenCalled();
    });
  });
});
