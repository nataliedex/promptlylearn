import fs from "fs";
import path from "path";
import { Student } from "../domain/student";

const DATA_DIR = path.join(__dirname, "../../data/students");

/**
 * StudentStore handles saving and loading students.
 * Students are looked up by name (case-insensitive) to link returning users.
 */
export class StudentStore {
  constructor() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  /**
   * Save a student to disk
   */
  save(student: Student): void {
    const filePath = path.join(DATA_DIR, `${student.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(student, null, 2));
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
