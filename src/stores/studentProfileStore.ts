import fs from "fs";
import path from "path";
import {
  StudentProfile,
  StudentProfileEducatorUpdate,
  createStudentProfile,
  updateStudentProfile,
  getStudentDisplayName,
} from "../domain/studentProfile";

const DATA_DIR = path.join(__dirname, "../../data/profiles");
const STUDENT_PROFILES_FILE = path.join(DATA_DIR, "students.json");

/**
 * StudentProfileStore - manages student profile persistence
 *
 * PRIVACY: This store contains sensitive data (legalName, accommodations.notes)
 * that must NEVER be exposed to student clients. Use sanitizeProfileForStudent()
 * when returning data to student-facing endpoints.
 */
export class StudentProfileStore {
  private profiles: Map<string, StudentProfile> = new Map();

  constructor() {
    this.ensureDataDir();
    this.loadProfiles();
  }

  private ensureDataDir(): void {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  private loadProfiles(): void {
    if (fs.existsSync(STUDENT_PROFILES_FILE)) {
      try {
        const data = fs.readFileSync(STUDENT_PROFILES_FILE, "utf-8");
        const parsed = JSON.parse(data) as StudentProfile[];
        this.profiles = new Map(parsed.map((p) => [p.id, p]));
      } catch (err) {
        console.error("Failed to load student profiles:", err);
        this.profiles = new Map();
      }
    }
  }

  private saveProfiles(): void {
    const data = Array.from(this.profiles.values());
    fs.writeFileSync(STUDENT_PROFILES_FILE, JSON.stringify(data, null, 2));
  }

  /**
   * Get a student profile by ID (full profile - EDUCATOR ONLY)
   */
  get(id: string): StudentProfile | null {
    return this.profiles.get(id) || null;
  }

  /**
   * Get or create a student profile
   * Used when a student is first accessed or created
   * @param id - Student ID
   * @param legalName - Legal name from student record
   * @param classIds - Class enrollments
   */
  getOrCreate(id: string, legalName: string, classIds: string[] = []): StudentProfile {
    let profile = this.profiles.get(id);
    if (!profile) {
      profile = createStudentProfile(id, legalName, undefined, classIds);
      this.profiles.set(id, profile);
      this.saveProfiles();
    }
    return profile;
  }

  /**
   * Update a student profile (EDUCATOR ONLY)
   * Students cannot update their own profiles
   */
  update(id: string, updates: StudentProfileEducatorUpdate): StudentProfile | null {
    const existing = this.profiles.get(id);
    if (!existing) {
      return null;
    }

    const updated = updateStudentProfile(existing, updates);
    this.profiles.set(id, updated);
    this.saveProfiles();
    return updated;
  }

  /**
   * Save a complete student profile
   */
  save(profile: StudentProfile): void {
    this.profiles.set(profile.id, profile);
    this.saveProfiles();
  }

  /**
   * Get the display name for a student (safe for any context)
   * Uses preferredName, falls back to first token of legalName
   */
  getDisplayName(id: string): string | null {
    const profile = this.profiles.get(id);
    if (!profile) {
      return null;
    }
    return getStudentDisplayName(profile);
  }

  /**
   * Get all student profiles (admin/educator use)
   */
  getAll(): StudentProfile[] {
    return Array.from(this.profiles.values());
  }

  /**
   * Delete a student profile
   */
  delete(id: string): boolean {
    const deleted = this.profiles.delete(id);
    if (deleted) {
      this.saveProfiles();
    }
    return deleted;
  }

  /**
   * Sync class enrollments for a student
   * Called when class membership changes
   */
  syncClassIds(id: string, classIds: string[]): StudentProfile | null {
    const existing = this.profiles.get(id);
    if (!existing) {
      return null;
    }

    const updated: StudentProfile = {
      ...existing,
      classIds,
      updatedAt: new Date().toISOString(),
    };
    this.profiles.set(id, updated);
    this.saveProfiles();
    return updated;
  }
}

// Singleton instance
export const studentProfileStore = new StudentProfileStore();
