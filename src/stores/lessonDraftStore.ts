import fs from "fs";
import path from "path";
import {
  LessonDraft,
  LessonDraftInput,
  createLessonDraft,
  updateLessonDraft,
} from "../domain/lessonDraft";

const DATA_DIR = path.join(__dirname, "../../data/drafts");
const DRAFTS_FILE = path.join(DATA_DIR, "lesson-drafts.json");

/**
 * LessonDraftStore - manages lesson draft persistence
 *
 * Stores drafts in a single JSON file, similar to other stores in the app.
 */
export class LessonDraftStore {
  private drafts: Map<string, LessonDraft> = new Map();

  constructor() {
    this.ensureDataDir();
    this.loadDrafts();
  }

  private ensureDataDir(): void {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  private loadDrafts(): void {
    if (fs.existsSync(DRAFTS_FILE)) {
      try {
        const data = fs.readFileSync(DRAFTS_FILE, "utf-8");
        const parsed = JSON.parse(data) as LessonDraft[];
        this.drafts = new Map(parsed.map((d) => [d.id, d]));
      } catch (err) {
        console.error("Failed to load lesson drafts:", err);
        this.drafts = new Map();
      }
    }
  }

  private saveDrafts(): void {
    const data = Array.from(this.drafts.values());
    fs.writeFileSync(DRAFTS_FILE, JSON.stringify(data, null, 2));
  }

  /**
   * List all drafts, sorted by updatedAt (most recent first)
   */
  listDrafts(): LessonDraft[] {
    return Array.from(this.drafts.values()).sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  /**
   * Get a draft by ID
   */
  getDraftById(id: string): LessonDraft | null {
    return this.drafts.get(id) || null;
  }

  /**
   * Create a new draft
   */
  createDraft(input: LessonDraftInput): LessonDraft {
    const draft = createLessonDraft(input);
    this.drafts.set(draft.id, draft);
    this.saveDrafts();
    return draft;
  }

  /**
   * Update an existing draft
   */
  updateDraft(id: string, updates: LessonDraftInput): LessonDraft | null {
    const existing = this.drafts.get(id);
    if (!existing) {
      return null;
    }

    const updated = updateLessonDraft(existing, updates);
    this.drafts.set(id, updated);
    this.saveDrafts();
    return updated;
  }

  /**
   * Delete a draft
   */
  deleteDraft(id: string): boolean {
    const deleted = this.drafts.delete(id);
    if (deleted) {
      this.saveDrafts();
    }
    return deleted;
  }
}

// Singleton instance
export const lessonDraftStore = new LessonDraftStore();
