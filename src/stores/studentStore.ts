import fs from "fs";
import path from "path";
import { Student } from "../domain/student";

const DATA_DIR = path.join(__dirname, "../../data/students");

// Characters for student codes (uppercase letters + digits, excluding confusable chars)
// Excludes: 0, O, I, L, 1 to avoid confusion
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

/**
 * StudentStore handles saving and loading students.
 * Students log in using a unique studentCode.
 */
export class StudentStore {
  constructor() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  /**
   * Generate a unique student code (e.g., "ABC123")
   * Ensures no duplicates exist
   */
  generateUniqueCode(): string {
    const existingCodes = new Set(
      this.getAll()
        .map(s => s.studentCode?.toUpperCase())
        .filter(Boolean)
    );

    let attempts = 0;
    const maxAttempts = 100;

    while (attempts < maxAttempts) {
      let code = "";
      for (let i = 0; i < CODE_LENGTH; i++) {
        code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      }

      if (!existingCodes.has(code)) {
        return code;
      }
      attempts++;
    }

    // Fallback: use timestamp-based code
    return `S${Date.now().toString(36).toUpperCase().slice(-5)}`;
  }

  /**
   * Save a student to disk
   */
  save(student: Student): void {
    const filePath = path.join(DATA_DIR, `${student.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(student, null, 2));
  }

  /**
   * Find a student by studentCode (case-insensitive)
   */
  findByCode(code: string): Student | null {
    const normalizedCode = code.trim().toUpperCase();
    const students = this.getAll();

    return students.find(s =>
      s.studentCode?.toUpperCase() === normalizedCode
    ) || null;
  }

  /**
   * Find a student by name (case-insensitive)
   * Returns the first match, or null if not found
   */
  findByName(name: string): Student | null {
    const normalizedName = name.trim().toLowerCase();
    const students = this.getAll();

    return students.find(s =>
      s.name.toLowerCase() === normalizedName
    ) || null;
  }

  /**
   * Regenerate a student's code
   * Returns the new code, or null if student not found
   */
  regenerateCode(studentId: string): string | null {
    const student = this.load(studentId);
    if (!student) {
      return null;
    }

    const newCode = this.generateUniqueCode();
    student.studentCode = newCode;
    this.save(student);
    return newCode;
  }

  /**
   * Load a student by ID
   */
  load(studentId: string): Student | null {
    const filePath = path.join(DATA_DIR, `${studentId}.json`);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const data = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(data) as Student;
  }

  /**
   * Get all students
   */
  getAll(): Student[] {
    if (!fs.existsSync(DATA_DIR)) {
      return [];
    }

    const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith(".json"));
    const students: Student[] = [];

    for (const file of files) {
      try {
        const filePath = path.join(DATA_DIR, file);
        const data = fs.readFileSync(filePath, "utf-8");
        students.push(JSON.parse(data) as Student);
      } catch {
        // Skip invalid files
      }
    }

    return students;
  }
}
