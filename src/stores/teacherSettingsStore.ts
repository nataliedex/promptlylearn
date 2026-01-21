import fs from "fs";
import path from "path";
import {
  TeacherThresholdSettings,
  DEFAULT_THRESHOLDS,
  getEffectiveThresholds,
} from "../domain/recommendation";

const DATA_FILE = path.join(__dirname, "../../data/teacher-settings.json");

/**
 * TeacherSettingsStore handles persistence for teacher-adjustable settings.
 *
 * Currently supports:
 * - Threshold settings for recommendation categories (Needs Support, Developing, etc.)
 *
 * Uses a single JSON file since settings are:
 * - Small in size
 * - Read frequently but written rarely
 * - Teacher-scoped (future: could support per-teacher settings)
 */

interface TeacherSettingsData {
  thresholds: Partial<TeacherThresholdSettings>;
  lastUpdated: string;
  updatedBy?: string; // teacherId
}

export class TeacherSettingsStore {
  constructor() {
    // Ensure the data directory exists
    const dataDir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }

  // ============================================
  // Threshold Settings
  // ============================================

  /**
   * Get the current threshold settings (merged with defaults)
   */
  getThresholds(): ReturnType<typeof getEffectiveThresholds> {
    const data = this.loadData();
    return getEffectiveThresholds(data.thresholds);
  }

  /**
   * Get the raw saved threshold settings (without merging defaults)
   */
  getRawThresholds(): Partial<TeacherThresholdSettings> {
    const data = this.loadData();
    return data.thresholds;
  }

  /**
   * Update threshold settings
   * Only updates the provided fields, preserving others
   */
  updateThresholds(
    updates: Partial<TeacherThresholdSettings>,
    teacherId?: string
  ): void {
    const data = this.loadData();

    // Validate thresholds before saving
    this.validateThresholds(updates);

    // Merge with existing settings
    data.thresholds = {
      ...data.thresholds,
      ...updates,
    };
    data.lastUpdated = new Date().toISOString();
    if (teacherId) {
      data.updatedBy = teacherId;
    }

    this.writeData(data);
  }

  /**
   * Reset all thresholds to defaults
   */
  resetThresholds(teacherId?: string): void {
    const data = this.loadData();
    data.thresholds = {};
    data.lastUpdated = new Date().toISOString();
    if (teacherId) {
      data.updatedBy = teacherId;
    }
    this.writeData(data);
  }

  /**
   * Get default threshold values (for display in UI)
   */
  getDefaults(): typeof DEFAULT_THRESHOLDS {
    return { ...DEFAULT_THRESHOLDS };
  }

  // ============================================
  // Validation
  // ============================================

  /**
   * Validate threshold values are within acceptable ranges
   */
  private validateThresholds(thresholds: Partial<TeacherThresholdSettings>): void {
    const errors: string[] = [];

    if (thresholds.needsSupportScore !== undefined) {
      if (thresholds.needsSupportScore < 0 || thresholds.needsSupportScore > 100) {
        errors.push("needsSupportScore must be between 0 and 100");
      }
    }

    if (thresholds.needsSupportHintThreshold !== undefined) {
      if (thresholds.needsSupportHintThreshold < 0 || thresholds.needsSupportHintThreshold > 1) {
        errors.push("needsSupportHintThreshold must be between 0 and 1");
      }
    }

    if (thresholds.developingUpper !== undefined) {
      if (thresholds.developingUpper < 0 || thresholds.developingUpper > 100) {
        errors.push("developingUpper must be between 0 and 100");
      }
    }

    if (thresholds.developingHintMin !== undefined) {
      if (thresholds.developingHintMin < 0 || thresholds.developingHintMin > 1) {
        errors.push("developingHintMin must be between 0 and 1");
      }
    }

    if (thresholds.developingHintMax !== undefined) {
      if (thresholds.developingHintMax < 0 || thresholds.developingHintMax > 1) {
        errors.push("developingHintMax must be between 0 and 1");
      }
    }

    if (thresholds.strongThreshold !== undefined) {
      if (thresholds.strongThreshold < 0 || thresholds.strongThreshold > 100) {
        errors.push("strongThreshold must be between 0 and 100");
      }
    }

    if (thresholds.escalationHelpRequests !== undefined) {
      if (thresholds.escalationHelpRequests < 1 || thresholds.escalationHelpRequests > 20) {
        errors.push("escalationHelpRequests must be between 1 and 20");
      }
    }

    // Cross-field validations
    const effective = getEffectiveThresholds(thresholds);

    if (effective.needsSupportScore >= effective.developingUpper) {
      errors.push("needsSupportScore must be less than developingUpper");
    }

    if (effective.developingHintMin > effective.developingHintMax) {
      errors.push("developingHintMin must be less than or equal to developingHintMax");
    }

    if (errors.length > 0) {
      throw new Error(`Invalid threshold settings: ${errors.join("; ")}`);
    }
  }

  // ============================================
  // File I/O
  // ============================================

  private loadData(): TeacherSettingsData {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const content = fs.readFileSync(DATA_FILE, "utf-8");
        return JSON.parse(content);
      }
    } catch (err) {
      console.error("Error loading teacher settings:", err);
    }

    // Return default structure if file doesn't exist or has errors
    return {
      thresholds: {},
      lastUpdated: new Date().toISOString(),
    };
  }

  private writeData(data: TeacherSettingsData): void {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  }
}

// Export singleton instance
export const teacherSettingsStore = new TeacherSettingsStore();
