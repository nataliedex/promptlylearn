import fs from "fs";
import path from "path";
import {
  TeacherProfile,
  TeacherProfileUpdate,
  createTeacherProfile,
  updateTeacherProfile,
} from "../domain/teacherProfile";

const DATA_DIR = path.join(__dirname, "../../data/profiles");
const TEACHER_PROFILES_FILE = path.join(DATA_DIR, "teachers.json");

/**
 * TeacherProfileStore - manages teacher profile persistence
 *
 * For v1, we store all teacher profiles in a single JSON file.
 * In production, this would be a database table.
 */
export class TeacherProfileStore {
  private profiles: Map<string, TeacherProfile> = new Map();

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
    if (fs.existsSync(TEACHER_PROFILES_FILE)) {
      try {
        const data = fs.readFileSync(TEACHER_PROFILES_FILE, "utf-8");
        const parsed = JSON.parse(data) as TeacherProfile[];
        this.profiles = new Map(parsed.map((p) => [p.id, p]));
      } catch (err) {
        console.error("Failed to load teacher profiles:", err);
        this.profiles = new Map();
      }
    }
  }

  private saveProfiles(): void {
    const data = Array.from(this.profiles.values());
    fs.writeFileSync(TEACHER_PROFILES_FILE, JSON.stringify(data, null, 2));
  }

  /**
   * Get a teacher profile by ID
   */
  get(id: string): TeacherProfile | null {
    return this.profiles.get(id) || null;
  }

  /**
   * Get or create a teacher profile
   * Used when a teacher first accesses profile settings
   */
  getOrCreate(id: string, fullName: string, displayName: string): TeacherProfile {
    let profile = this.profiles.get(id);
    if (!profile) {
      profile = createTeacherProfile(id, fullName, displayName);
      this.profiles.set(id, profile);
      this.saveProfiles();
    }
    return profile;
  }

  /**
   * Update a teacher profile
   */
  update(id: string, updates: TeacherProfileUpdate): TeacherProfile | null {
    const existing = this.profiles.get(id);
    if (!existing) {
      return null;
    }

    const updated = updateTeacherProfile(existing, updates);
    this.profiles.set(id, updated);
    this.saveProfiles();
    return updated;
  }

  /**
   * Save a complete teacher profile
   */
  save(profile: TeacherProfile): void {
    this.profiles.set(profile.id, profile);
    this.saveProfiles();
  }

  /**
   * Get all teacher profiles (admin use)
   */
  getAll(): TeacherProfile[] {
    return Array.from(this.profiles.values());
  }

  /**
   * Delete a teacher profile
   */
  delete(id: string): boolean {
    const deleted = this.profiles.delete(id);
    if (deleted) {
      this.saveProfiles();
    }
    return deleted;
  }
}

// Singleton instance
export const teacherProfileStore = new TeacherProfileStore();
