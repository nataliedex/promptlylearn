import fs from "fs";
import path from "path";
import { AssignmentStudent } from "../domain/studentAssignment";

const DATA_FILE = path.join(__dirname, "../../data/assignment-students.json");

/**
 * AssignmentStudentStore handles persistence for per-student assignment progress.
 *
 * This store tracks:
 * - Number of attempts per student per assignment
 * - Scores and completion status
 * - Time spent and support used
 */

interface AssignmentStudentsData {
  records: AssignmentStudent[];
  lastUpdated: string;
}

export class AssignmentStudentStore {
  constructor() {
    const dataDir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }

  // ============================================
  // Core CRUD Operations
  // ============================================

  /**
   * Save or update a record
   */
  save(record: AssignmentStudent): void {
    const data = this.loadAll();
    const existingIndex = data.records.findIndex(
      (r) => r.studentId === record.studentId && r.assignmentId === record.assignmentId
    );

    if (existingIndex >= 0) {
      data.records[existingIndex] = record;
    } else {
      data.records.push(record);
    }

    this.writeData(data);
  }

  /**
   * Load a record by student and assignment
   */
  load(studentId: string, assignmentId: string): AssignmentStudent | null {
    const data = this.loadAll();
    return data.records.find(
      (r) => r.studentId === studentId && r.assignmentId === assignmentId
    ) || null;
  }

  /**
   * Delete a record
   */
  delete(studentId: string, assignmentId: string): boolean {
    const data = this.loadAll();
    const initialLength = data.records.length;
    data.records = data.records.filter(
      (r) => !(r.studentId === studentId && r.assignmentId === assignmentId)
    );

    if (data.records.length < initialLength) {
      this.writeData(data);
      return true;
    }
    return false;
  }

  // ============================================
  // Query Methods
  // ============================================

  /**
   * Get all records (for admin/debugging)
   */
  getAll(): AssignmentStudent[] {
    return this.loadAll().records;
  }

  /**
   * Get all records for a student
   */
  getByStudent(studentId: string): AssignmentStudent[] {
    const data = this.loadAll();
    return data.records.filter((r) => r.studentId === studentId);
  }

  /**
   * Get all records for an assignment
   */
  getByAssignment(assignmentId: string): AssignmentStudent[] {
    const data = this.loadAll();
    return data.records.filter((r) => r.assignmentId === assignmentId);
  }

  /**
   * Get completed records for an assignment
   */
  getCompletedByAssignment(assignmentId: string): AssignmentStudent[] {
    const data = this.loadAll();
    return data.records.filter(
      (r) => r.assignmentId === assignmentId && r.lastCompletedAt !== undefined
    );
  }

  /**
   * Get in-progress records for an assignment
   */
  getInProgressByAssignment(assignmentId: string): AssignmentStudent[] {
    const data = this.loadAll();
    return data.records.filter(
      (r) => r.assignmentId === assignmentId && r.startedAt !== undefined && r.lastCompletedAt === undefined
    );
  }

  // ============================================
  // Progress Tracking
  // ============================================

  /**
   * Record a new attempt start
   */
  startAttempt(studentId: string, assignmentId: string): AssignmentStudent {
    let record = this.load(studentId, assignmentId);

    if (!record) {
      record = {
        studentId,
        assignmentId,
        attempts: 1,
        currentAttempt: 1,
        startedAt: new Date(),
      };
    } else {
      record.attempts++;
      record.currentAttempt = record.attempts;
      if (!record.startedAt) {
        record.startedAt = new Date();
      }
    }

    this.save(record);
    return record;
  }

  /**
   * Record attempt completion with score
   */
  completeAttempt(
    studentId: string,
    assignmentId: string,
    score: number,
    timeSpent?: number
  ): AssignmentStudent {
    let record = this.load(studentId, assignmentId);

    if (!record) {
      record = {
        studentId,
        assignmentId,
        attempts: 1,
        currentAttempt: 1,
        score,
        highestScore: score,
        lastCompletedAt: new Date(),
        firstCompletedAt: new Date(),
      };
    } else {
      record.score = score;
      record.highestScore = Math.max(record.highestScore || 0, score);
      record.lastCompletedAt = new Date();
      if (!record.firstCompletedAt) {
        record.firstCompletedAt = new Date();
      }
    }

    if (timeSpent !== undefined) {
      record.totalTimeSpent = (record.totalTimeSpent || 0) + timeSpent;
    }

    this.save(record);
    return record;
  }

  /**
   * Record hint usage
   */
  recordHintUsage(studentId: string, assignmentId: string, hintsUsed: number): void {
    let record = this.load(studentId, assignmentId);

    if (!record) {
      record = {
        studentId,
        assignmentId,
        attempts: 0,
        currentAttempt: 0,
        hintsUsed,
      };
    } else {
      record.hintsUsed = (record.hintsUsed || 0) + hintsUsed;
    }

    this.save(record);
  }

  /**
   * Record coach session usage
   */
  recordCoachSession(studentId: string, assignmentId: string): void {
    let record = this.load(studentId, assignmentId);

    if (!record) {
      record = {
        studentId,
        assignmentId,
        attempts: 0,
        currentAttempt: 0,
        coachSessionCount: 1,
      };
    } else {
      record.coachSessionCount = (record.coachSessionCount || 0) + 1;
    }

    this.save(record);
  }

  // ============================================
  // Statistics
  // ============================================

  /**
   * Get assignment statistics
   */
  getAssignmentStats(assignmentId: string): {
    totalStudents: number;
    completedCount: number;
    inProgressCount: number;
    notStartedCount: number;
    averageScore?: number;
    averageAttempts: number;
    averageTimeSpent?: number;
    totalHintsUsed: number;
    totalCoachSessions: number;
  } {
    const records = this.getByAssignment(assignmentId);

    const completed = records.filter((r) => r.lastCompletedAt !== undefined);
    const inProgress = records.filter((r) => r.startedAt !== undefined && r.lastCompletedAt === undefined);

    const scores = completed.map((r) => r.score).filter((s): s is number => s !== undefined);
    const averageScore = scores.length > 0
      ? scores.reduce((sum, s) => sum + s, 0) / scores.length
      : undefined;

    const attempts = records.map((r) => r.attempts);
    const averageAttempts = attempts.length > 0
      ? attempts.reduce((sum, a) => sum + a, 0) / attempts.length
      : 0;

    const times = records.map((r) => r.totalTimeSpent).filter((t): t is number => t !== undefined);
    const averageTimeSpent = times.length > 0
      ? times.reduce((sum, t) => sum + t, 0) / times.length
      : undefined;

    const totalHintsUsed = records.reduce((sum, r) => sum + (r.hintsUsed || 0), 0);
    const totalCoachSessions = records.reduce((sum, r) => sum + (r.coachSessionCount || 0), 0);

    return {
      totalStudents: records.length,
      completedCount: completed.length,
      inProgressCount: inProgress.length,
      notStartedCount: 0, // Would need external data for this
      averageScore,
      averageAttempts,
      averageTimeSpent,
      totalHintsUsed,
      totalCoachSessions,
    };
  }

  /**
   * Get student progress across all assignments
   */
  getStudentProgress(studentId: string): {
    totalAssignments: number;
    completedCount: number;
    averageScore?: number;
    totalAttempts: number;
    totalTimeSpent?: number;
  } {
    const records = this.getByStudent(studentId);

    const completed = records.filter((r) => r.lastCompletedAt !== undefined);
    const scores = completed.map((r) => r.score).filter((s): s is number => s !== undefined);
    const averageScore = scores.length > 0
      ? scores.reduce((sum, s) => sum + s, 0) / scores.length
      : undefined;

    const totalAttempts = records.reduce((sum, r) => sum + r.attempts, 0);

    const times = records.map((r) => r.totalTimeSpent).filter((t): t is number => t !== undefined);
    const totalTimeSpent = times.length > 0
      ? times.reduce((sum, t) => sum + t, 0)
      : undefined;

    return {
      totalAssignments: records.length,
      completedCount: completed.length,
      averageScore,
      totalAttempts,
      totalTimeSpent,
    };
  }

  /**
   * Check if a student has completed an assignment
   */
  isCompleted(studentId: string, assignmentId: string): boolean {
    const record = this.load(studentId, assignmentId);
    return record?.lastCompletedAt !== undefined;
  }

  /**
   * Get number of attempts for a student on an assignment
   */
  getAttemptCount(studentId: string, assignmentId: string): number {
    const record = this.load(studentId, assignmentId);
    return record?.attempts || 0;
  }

  // ============================================
  // Private Helpers
  // ============================================

  private loadAll(): AssignmentStudentsData {
    if (!fs.existsSync(DATA_FILE)) {
      return { records: [], lastUpdated: new Date().toISOString() };
    }

    try {
      const content = fs.readFileSync(DATA_FILE, "utf-8");
      return JSON.parse(content) as AssignmentStudentsData;
    } catch (err) {
      console.error("Error loading assignment student records:", err);
      return { records: [], lastUpdated: new Date().toISOString() };
    }
  }

  private writeData(data: AssignmentStudentsData): void {
    data.lastUpdated = new Date().toISOString();
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  }
}

// Export singleton instance
export const assignmentStudentStore = new AssignmentStudentStore();
