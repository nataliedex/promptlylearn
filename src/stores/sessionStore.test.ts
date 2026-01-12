import fs from "fs";
import path from "path";
import { SessionStore } from "./sessionStore";
import { Session } from "../domain/session";

// Mock fs module
jest.mock("fs");

const mockFs = jest.mocked(fs);

describe("SessionStore", () => {
  const DATA_DIR = path.join(__dirname, "../../data/sessions");

  const createSessionData = (overrides: Partial<Session> = {}) => ({
    id: "session-1",
    studentId: "student-1",
    studentName: "Alice",
    lessonId: "lesson-1",
    lessonTitle: "Test Lesson",
    submission: {
      assignmentId: "assignment-1",
      studentId: "student-1",
      responses: [],
      submittedAt: "2024-01-15T10:00:00.000Z",
    },
    startedAt: "2024-01-15T10:00:00.000Z",
    status: "in_progress",
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.existsSync.mockReturnValue(true);
  });

  describe("constructor", () => {
    it("creates data directory if it does not exist", () => {
      mockFs.existsSync.mockReturnValue(false);

      new SessionStore();

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(DATA_DIR, { recursive: true });
    });

    it("does not create directory if it already exists", () => {
      mockFs.existsSync.mockReturnValue(true);

      new SessionStore();

      expect(mockFs.mkdirSync).not.toHaveBeenCalled();
    });
  });

  describe("save", () => {
    it("saves session to correct file path", () => {
      const store = new SessionStore();
      const session = createSessionData({ id: "session-123" });

      store.save(session as any);

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        path.join(DATA_DIR, "session-123.json"),
        JSON.stringify(session, null, 2)
      );
    });
  });

  describe("load", () => {
    it("returns session when file exists", () => {
      const store = new SessionStore();
      const session = createSessionData();

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(session));

      const result = store.load("session-1");

      expect(result).toEqual(session);
    });

    it("returns null when file does not exist", () => {
      mockFs.existsSync
        .mockReturnValueOnce(true)  // constructor
        .mockReturnValueOnce(false); // load check

      const store = new SessionStore();
      const result = store.load("nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("delete", () => {
    it("deletes session file and returns true when file exists", () => {
      const store = new SessionStore();
      mockFs.existsSync.mockReturnValue(true);

      const result = store.delete("session-1");

      expect(result).toBe(true);
      expect(mockFs.unlinkSync).toHaveBeenCalledWith(
        path.join(DATA_DIR, "session-1.json")
      );
    });

    it("returns false when file does not exist", () => {
      mockFs.existsSync
        .mockReturnValueOnce(true)   // constructor
        .mockReturnValueOnce(false); // delete check

      const store = new SessionStore();
      const result = store.delete("nonexistent");

      expect(result).toBe(false);
      expect(mockFs.unlinkSync).not.toHaveBeenCalled();
    });
  });

  describe("getByStudentId", () => {
    it("returns sessions for the specified student sorted by date (newest first)", () => {
      const store = new SessionStore();
      const session1 = createSessionData({
        id: "s1",
        studentId: "student-1",
        startedAt: new Date("2024-01-10") as any,
      });
      const session2 = createSessionData({
        id: "s2",
        studentId: "student-1",
        startedAt: new Date("2024-01-15") as any,
      });
      const session3 = createSessionData({
        id: "s3",
        studentId: "student-2",
        startedAt: new Date("2024-01-12") as any,
      });

      mockFs.readdirSync.mockReturnValue(["s1.json", "s2.json", "s3.json"] as any);
      mockFs.readFileSync
        .mockReturnValueOnce(JSON.stringify(session1))
        .mockReturnValueOnce(JSON.stringify(session2))
        .mockReturnValueOnce(JSON.stringify(session3));

      const result = store.getByStudentId("student-1");

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("s2"); // Newer first
      expect(result[1].id).toBe("s1");
    });

    it("uses completedAt for sorting when available", () => {
      const store = new SessionStore();
      const session1 = createSessionData({
        id: "s1",
        studentId: "student-1",
        startedAt: new Date("2024-01-01") as any,
        completedAt: new Date("2024-01-20") as any,
        status: "completed",
      });
      const session2 = createSessionData({
        id: "s2",
        studentId: "student-1",
        startedAt: new Date("2024-01-15") as any,
        status: "in_progress",
      });

      mockFs.readdirSync.mockReturnValue(["s1.json", "s2.json"] as any);
      mockFs.readFileSync
        .mockReturnValueOnce(JSON.stringify(session1))
        .mockReturnValueOnce(JSON.stringify(session2));

      const result = store.getByStudentId("student-1");

      expect(result[0].id).toBe("s1"); // completedAt Jan 20 > startedAt Jan 15
    });
  });

  describe("getInProgressByStudentId", () => {
    it("returns only in-progress sessions for student", () => {
      const store = new SessionStore();
      const inProgress = createSessionData({
        id: "s1",
        studentId: "student-1",
        status: "in_progress",
      });
      const completed = createSessionData({
        id: "s2",
        studentId: "student-1",
        status: "completed",
      });

      mockFs.readdirSync.mockReturnValue(["s1.json", "s2.json"] as any);
      mockFs.readFileSync
        .mockReturnValueOnce(JSON.stringify(inProgress))
        .mockReturnValueOnce(JSON.stringify(completed));

      const result = store.getInProgressByStudentId("student-1");

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe("in_progress");
    });
  });

  describe("getCompletedByStudentId", () => {
    it("returns only completed sessions for student", () => {
      const store = new SessionStore();
      const inProgress = createSessionData({
        id: "s1",
        studentId: "student-1",
        status: "in_progress",
      });
      const completed = createSessionData({
        id: "s2",
        studentId: "student-1",
        status: "completed",
        completedAt: new Date() as any,
      });

      mockFs.readdirSync.mockReturnValue(["s1.json", "s2.json"] as any);
      mockFs.readFileSync
        .mockReturnValueOnce(JSON.stringify(inProgress))
        .mockReturnValueOnce(JSON.stringify(completed));

      const result = store.getCompletedByStudentId("student-1");

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe("completed");
    });
  });

  describe("getAll", () => {
    it("returns all sessions sorted by date", () => {
      const store = new SessionStore();
      const session1 = createSessionData({
        id: "s1",
        startedAt: new Date("2024-01-10") as any,
      });
      const session2 = createSessionData({
        id: "s2",
        startedAt: new Date("2024-01-15") as any,
      });

      mockFs.readdirSync.mockReturnValue(["s1.json", "s2.json"] as any);
      mockFs.readFileSync
        .mockReturnValueOnce(JSON.stringify(session1))
        .mockReturnValueOnce(JSON.stringify(session2));

      const result = store.getAll();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("s2"); // Newer first
    });

    it("returns empty array when directory does not exist", () => {
      mockFs.existsSync
        .mockReturnValueOnce(true)  // constructor
        .mockReturnValueOnce(false); // getAll -> listSessionFiles check

      const store = new SessionStore();
      const result = store.getAll();

      expect(result).toEqual([]);
    });

    it("skips invalid files gracefully", () => {
      const store = new SessionStore();
      const session = createSessionData();

      mockFs.readdirSync.mockReturnValue(["s1.json", "invalid.json"] as any);
      mockFs.readFileSync
        .mockReturnValueOnce(JSON.stringify(session))
        .mockImplementationOnce(() => {
          throw new Error("Invalid JSON");
        });

      const result = store.getAll();

      expect(result).toHaveLength(1);
    });
  });
});
