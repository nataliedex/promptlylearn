import fs from "fs";
import path from "path";
import { StudentStore } from "./studentStore";
import { Student } from "../domain/student";

// Mock fs module
jest.mock("fs");

const mockFs = jest.mocked(fs);

describe("StudentStore", () => {
  const DATA_DIR = path.join(__dirname, "../../data/students");

  beforeEach(() => {
    jest.clearAllMocks();
    // Default: directory exists
    mockFs.existsSync.mockReturnValue(true);
  });

  describe("constructor", () => {
    it("creates data directory if it does not exist", () => {
      mockFs.existsSync.mockReturnValue(false);

      new StudentStore();

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(DATA_DIR, { recursive: true });
    });

    it("does not create directory if it already exists", () => {
      mockFs.existsSync.mockReturnValue(true);

      new StudentStore();

      expect(mockFs.mkdirSync).not.toHaveBeenCalled();
    });
  });

  describe("save", () => {
    it("saves student to correct file path", () => {
      const store = new StudentStore();
      const student: Student = {
        id: "student-123",
        name: "Alice",
        classes: [],
        assignments: [],
        createdAt: new Date("2024-01-15"),
      };

      store.save(student);

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        path.join(DATA_DIR, "student-123.json"),
        JSON.stringify(student, null, 2)
      );
    });
  });

  describe("load", () => {
    it("returns student when file exists", () => {
      const store = new StudentStore();
      const studentData = {
        id: "student-123",
        name: "Alice",
        createdAt: "2024-01-15T00:00:00.000Z",
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(studentData));

      const result = store.load("student-123");

      expect(result).toEqual(studentData);
      expect(mockFs.readFileSync).toHaveBeenCalledWith(
        path.join(DATA_DIR, "student-123.json"),
        "utf-8"
      );
    });

    it("returns null when file does not exist", () => {
      // Constructor check returns true, load check returns false
      mockFs.existsSync
        .mockReturnValueOnce(true)  // constructor
        .mockReturnValueOnce(false); // load check

      const store = new StudentStore();
      const result = store.load("nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("findByName", () => {
    it("finds student by exact name match (case-insensitive)", () => {
      const store = new StudentStore();

      mockFs.readdirSync.mockReturnValue(["1.json", "2.json"] as any);
      mockFs.readFileSync
        .mockReturnValueOnce(JSON.stringify({ id: "1", name: "Alice", createdAt: "2024-01-01" }))
        .mockReturnValueOnce(JSON.stringify({ id: "2", name: "Bob", createdAt: "2024-01-01" }));

      const result = store.findByName("alice");

      expect(result?.id).toBe("1");
      expect(result?.name).toBe("Alice");
    });

    it("finds student with trimmed input", () => {
      const store = new StudentStore();

      mockFs.readdirSync.mockReturnValue(["1.json"] as any);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ id: "1", name: "Alice", createdAt: "2024-01-01" }));

      const result = store.findByName("  Alice  ");

      expect(result?.name).toBe("Alice");
    });

    it("returns null when no student matches", () => {
      const store = new StudentStore();

      mockFs.readdirSync.mockReturnValue(["1.json"] as any);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ id: "1", name: "Alice", createdAt: "2024-01-01" }));

      const result = store.findByName("Charlie");

      expect(result).toBeNull();
    });
  });

  describe("getAll", () => {
    it("returns all students from directory", () => {
      const store = new StudentStore();

      mockFs.readdirSync.mockReturnValue(["1.json", "2.json"] as any);
      mockFs.readFileSync
        .mockReturnValueOnce(JSON.stringify({ id: "1", name: "Alice", createdAt: "2024-01-01" }))
        .mockReturnValueOnce(JSON.stringify({ id: "2", name: "Bob", createdAt: "2024-01-01" }));

      const result = store.getAll();

      expect(result).toHaveLength(2);
      expect(result.map(s => s.name)).toContain("Alice");
      expect(result.map(s => s.name)).toContain("Bob");
    });

    it("returns empty array when directory does not exist", () => {
      mockFs.existsSync
        .mockReturnValueOnce(true)  // constructor
        .mockReturnValueOnce(false); // getAll check

      const store = new StudentStore();
      const result = store.getAll();

      expect(result).toEqual([]);
    });

    it("filters out non-JSON files", () => {
      const store = new StudentStore();

      mockFs.readdirSync.mockReturnValue([
        "1.json",
        ".DS_Store",
        "readme.txt",
      ] as any);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ id: "1", name: "Alice", createdAt: "2024-01-01" }));

      const result = store.getAll();

      expect(result).toHaveLength(1);
    });

    it("skips invalid JSON files gracefully", () => {
      const store = new StudentStore();

      mockFs.readdirSync.mockReturnValue(["1.json", "2.json"] as any);
      mockFs.readFileSync
        .mockReturnValueOnce(JSON.stringify({ id: "1", name: "Alice", createdAt: "2024-01-01" }))
        .mockImplementationOnce(() => {
          throw new Error("Invalid JSON");
        });

      const result = store.getAll();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Alice");
    });
  });
});
