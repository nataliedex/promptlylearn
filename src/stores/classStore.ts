/**
 * Class Store
 *
 * Persists classes as JSON files in /data/classes/
 * Follows the same pattern as other stores in this codebase.
 */

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  Class,
  ClassSummary,
  CreateClassInput,
  UpdateClassInput,
} from "../domain/class";

const DATA_DIR = path.join(__dirname, "../../data/classes");

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function getFilePath(classId: string): string {
  return path.join(DATA_DIR, `${classId}.json`);
}

/**
 * Generate URL-safe ID from class name
 */
function generateClassId(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 40);

  // Add short UUID suffix for uniqueness
  const suffix = randomUUID().substring(0, 8);
  return `${base}-${suffix}`;
}

export class ClassStore {
  /**
   * Create a new class
   */
  create(input: CreateClassInput): Class {
    ensureDataDir();

    const now = new Date().toISOString();
    const studentIds = input.studentIds || [];
    const classObj: Class = {
      id: generateClassId(input.name),
      name: input.name,
      teacherId: input.teacherId,
      students: studentIds,
      studentIds: studentIds, // Legacy alias
      description: input.description,
      gradeLevel: input.gradeLevel,
      schoolYear: input.schoolYear,
      period: input.period,
      subject: input.subject,
      subjects: input.subjects || [],
      createdAt: now,
    };

    fs.writeFileSync(getFilePath(classObj.id), JSON.stringify(classObj, null, 2), "utf-8");
    return classObj;
  }

  /**
   * Load a class by ID
   */
  load(classId: string): Class | null {
    const filePath = getFilePath(classId);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const classObj = JSON.parse(raw);
      // Backward compatibility: ensure subjects array exists
      if (!classObj.subjects) {
        classObj.subjects = [];
      }
      return classObj;
    } catch {
      return null;
    }
  }

  /**
   * Update a class
   */
  update(classId: string, input: UpdateClassInput): Class | null {
    const existing = this.load(classId);
    if (!existing) {
      return null;
    }

    const updated: Class = {
      ...existing,
      ...input,
      updatedAt: new Date().toISOString(),
    };

    fs.writeFileSync(getFilePath(classId), JSON.stringify(updated, null, 2), "utf-8");
    return updated;
  }

  /**
   * Delete a class permanently
   */
  delete(classId: string): boolean {
    const filePath = getFilePath(classId);
    if (!fs.existsSync(filePath)) {
      return false;
    }

    fs.unlinkSync(filePath);
    return true;
  }

  /**
   * Archive a class (soft delete)
   */
  archive(classId: string): Class | null {
    const existing = this.load(classId);
    if (!existing) {
      return null;
    }

    existing.archivedAt = new Date().toISOString();
    fs.writeFileSync(getFilePath(classId), JSON.stringify(existing, null, 2), "utf-8");
    return existing;
  }

  /**
   * Restore an archived class
   */
  restore(classId: string): Class | null {
    const existing = this.load(classId);
    if (!existing) {
      return null;
    }

    delete existing.archivedAt;
    existing.updatedAt = new Date().toISOString();
    fs.writeFileSync(getFilePath(classId), JSON.stringify(existing, null, 2), "utf-8");
    return existing;
  }

  /**
   * Get all classes (optionally including archived)
   */
  getAll(includeArchived: boolean = false): Class[] {
    ensureDataDir();

    const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));
    const classes: Class[] = [];

    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(DATA_DIR, file), "utf-8");
        const classObj: Class = JSON.parse(raw);

        if (includeArchived || !classObj.archivedAt) {
          classes.push(classObj);
        }
      } catch {
        // Skip corrupted files
      }
    }

    // Sort by creation date (newest first)
    return classes.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  /**
   * Get class summaries (without full student lists)
   */
  getAllSummaries(includeArchived: boolean = false): ClassSummary[] {
    const classes = this.getAll(includeArchived);
    return classes.map((c) => ({
      id: c.id,
      name: c.name,
      gradeLevel: c.gradeLevel,
      schoolYear: c.schoolYear,
      period: c.period,
      subject: c.subject,
      subjects: c.subjects || [],
      studentCount: c.studentIds.length,
      createdAt: c.createdAt,
      archivedAt: c.archivedAt,
    }));
  }

  /**
   * Get only archived classes
   */
  getArchived(): Class[] {
    ensureDataDir();

    const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));
    const classes: Class[] = [];

    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(DATA_DIR, file), "utf-8");
        const classObj: Class = JSON.parse(raw);

        if (classObj.archivedAt) {
          classes.push(classObj);
        }
      } catch {
        // Skip corrupted files
      }
    }

    return classes.sort(
      (a, b) => new Date(b.archivedAt!).getTime() - new Date(a.archivedAt!).getTime()
    );
  }

  /**
   * Add students to a class
   */
  addStudents(classId: string, studentIds: string[]): Class | null {
    const existing = this.load(classId);
    if (!existing) {
      return null;
    }

    // Add only new student IDs (avoid duplicates)
    const newStudentIds = studentIds.filter((id) => !existing.studentIds.includes(id));
    existing.studentIds = [...existing.studentIds, ...newStudentIds];
    existing.updatedAt = new Date().toISOString();

    fs.writeFileSync(getFilePath(classId), JSON.stringify(existing, null, 2), "utf-8");
    return existing;
  }

  /**
   * Remove a student from a class
   */
  removeStudent(classId: string, studentId: string): Class | null {
    const existing = this.load(classId);
    if (!existing) {
      return null;
    }

    existing.studentIds = existing.studentIds.filter((id) => id !== studentId);
    existing.updatedAt = new Date().toISOString();

    fs.writeFileSync(getFilePath(classId), JSON.stringify(existing, null, 2), "utf-8");
    return existing;
  }

  /**
   * Find classes that contain a specific student
   */
  findByStudent(studentId: string): Class[] {
    return this.getAll().filter((c) => c.studentIds.includes(studentId));
  }

  // ============================================
  // Subject Participation Management
  // ============================================

  /**
   * Update the subjects list for a class
   */
  updateSubjects(classId: string, subjects: string[]): Class | null {
    const existing = this.load(classId);
    if (!existing) {
      return null;
    }

    existing.subjects = subjects;
    existing.updatedAt = new Date().toISOString();

    // Clean up exclusions for removed subjects
    if (existing.subjectExclusions) {
      const subjectSet = new Set(subjects);
      for (const key of Object.keys(existing.subjectExclusions)) {
        if (!subjectSet.has(key)) {
          delete existing.subjectExclusions[key];
        }
      }
    }

    fs.writeFileSync(getFilePath(classId), JSON.stringify(existing, null, 2), "utf-8");
    return existing;
  }

  /**
   * Add a subject to a class
   */
  addSubject(classId: string, subject: string): Class | null {
    const existing = this.load(classId);
    if (!existing) {
      return null;
    }

    // Don't add duplicates
    if (!existing.subjects.includes(subject)) {
      existing.subjects.push(subject);
      existing.updatedAt = new Date().toISOString();
      fs.writeFileSync(getFilePath(classId), JSON.stringify(existing, null, 2), "utf-8");
    }

    return existing;
  }

  /**
   * Remove a subject from a class
   */
  removeSubject(classId: string, subject: string): Class | null {
    const existing = this.load(classId);
    if (!existing) {
      return null;
    }

    existing.subjects = existing.subjects.filter((s) => s !== subject);

    // Clean up exclusions for removed subject
    if (existing.subjectExclusions && existing.subjectExclusions[subject]) {
      delete existing.subjectExclusions[subject];
    }

    existing.updatedAt = new Date().toISOString();
    fs.writeFileSync(getFilePath(classId), JSON.stringify(existing, null, 2), "utf-8");
    return existing;
  }

  /**
   * Set whether a student is excluded from a subject
   * excluded = true means student does NOT participate
   * excluded = false means student DOES participate (removes from exclusion list)
   */
  setStudentSubjectExclusion(
    classId: string,
    studentId: string,
    subject: string,
    excluded: boolean
  ): Class | null {
    const existing = this.load(classId);
    if (!existing) {
      return null;
    }

    // Ensure subject exists
    if (!existing.subjects.includes(subject)) {
      return null;
    }

    // Initialize subjectExclusions if needed
    if (!existing.subjectExclusions) {
      existing.subjectExclusions = {};
    }

    // Initialize exclusion array for subject if needed
    if (!existing.subjectExclusions[subject]) {
      existing.subjectExclusions[subject] = [];
    }

    const exclusionList = existing.subjectExclusions[subject];
    const isCurrentlyExcluded = exclusionList.includes(studentId);

    if (excluded && !isCurrentlyExcluded) {
      // Add to exclusion list
      exclusionList.push(studentId);
    } else if (!excluded && isCurrentlyExcluded) {
      // Remove from exclusion list
      existing.subjectExclusions[subject] = exclusionList.filter((id) => id !== studentId);
    }

    // Clean up empty exclusion arrays
    if (existing.subjectExclusions[subject].length === 0) {
      delete existing.subjectExclusions[subject];
    }

    existing.updatedAt = new Date().toISOString();
    fs.writeFileSync(getFilePath(classId), JSON.stringify(existing, null, 2), "utf-8");
    return existing;
  }

  /**
   * Get students who participate in a specific subject
   * Returns studentIds filtered to exclude those in the subjectExclusions list
   */
  getStudentsForSubject(classId: string, subject: string): string[] {
    const classObj = this.load(classId);
    if (!classObj) {
      return [];
    }

    const excludedIds = classObj.subjectExclusions?.[subject] || [];
    return classObj.studentIds.filter((id) => !excludedIds.includes(id));
  }

  /**
   * Check if a student participates in a subject
   */
  studentParticipatesInSubject(classId: string, studentId: string, subject: string): boolean {
    const classObj = this.load(classId);
    if (!classObj) {
      return false;
    }

    const excludedIds = classObj.subjectExclusions?.[subject] || [];
    return !excludedIds.includes(studentId);
  }
}
