import fs from "fs";
import path from "path";
import { CoachSession } from "../domain/coachSession";

const DATA_DIR = path.join(__dirname, "../../data/coach-sessions");

/**
 * CoachSessionStore handles saving and loading coach sessions to/from JSON files.
 * Each session is saved as a separate file: {sessionId}.json
 *
 * Coach sessions are freeform "Ask Coach" conversations between
 * students and the AI coach, separate from lesson sessions.
 */
export class CoachSessionStore {
  constructor() {
    // Ensure the coach-sessions directory exists
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  /**
   * Save a coach session to disk
   */
  save(session: CoachSession): void {
    const filePath = path.join(DATA_DIR, `${session.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2));
  }

  /**
   * Load a coach session by ID
   */
  load(sessionId: string): CoachSession | null {
    const filePath = path.join(DATA_DIR, `${sessionId}.json`);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const data = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(data) as CoachSession;
  }

  /**
   * Get all coach sessions for a specific student
   */
  getByStudentId(studentId: string): CoachSession[] {
    const files = this.listSessionFiles();
    const sessions: CoachSession[] = [];

    for (const file of files) {
      const session = this.loadFromFile(file);
      if (session && session.studentId === studentId) {
        sessions.push(session);
      }
    }

    return sessions.sort((a, b) => {
      const aTime = new Date(a.endedAt || a.startedAt).getTime();
      const bTime = new Date(b.endedAt || b.startedAt).getTime();
      return bTime - aTime; // Most recent first
    });
  }

  /**
   * Get recent coach sessions for a student, limited to N
   */
  getRecentByStudentId(studentId: string, limit: number): CoachSession[] {
    return this.getByStudentId(studentId).slice(0, limit);
  }

  /**
   * Get all coach sessions
   */
  getAll(): CoachSession[] {
    const files = this.listSessionFiles();
    const sessions: CoachSession[] = [];

    for (const file of files) {
      const session = this.loadFromFile(file);
      if (session) {
        sessions.push(session);
      }
    }

    return sessions.sort((a, b) => {
      const aTime = new Date(a.endedAt || a.startedAt).getTime();
      const bTime = new Date(b.endedAt || b.startedAt).getTime();
      return bTime - aTime;
    });
  }

  /**
   * Delete a coach session by ID
   */
  delete(sessionId: string): boolean {
    const filePath = path.join(DATA_DIR, `${sessionId}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  }

  /**
   * Get aggregated coaching insights for a student
   */
  getInsightsForStudent(studentId: string): {
    totalCoachRequests: number;
    recentTopics: string[];
    intentLabel: "support-seeking" | "enrichment-seeking" | "mixed";
    lastCoachSessionAt?: string;
  } {
    const sessions = this.getByStudentId(studentId);

    if (sessions.length === 0) {
      return {
        totalCoachRequests: 0,
        recentTopics: [],
        intentLabel: "mixed",
      };
    }

    // Aggregate intent scores across all sessions
    let totalSupportScore = 0;
    let totalEnrichmentScore = 0;
    const topicsSet = new Set<string>();

    for (const session of sessions) {
      totalSupportScore += session.supportScore;
      totalEnrichmentScore += session.enrichmentScore;
      session.topics.forEach((t) => topicsSet.add(t));
    }

    // Compute overall intent label
    let intentLabel: "support-seeking" | "enrichment-seeking" | "mixed" = "mixed";
    if (totalSupportScore > totalEnrichmentScore + 2) {
      intentLabel = "support-seeking";
    } else if (totalEnrichmentScore > totalSupportScore + 2) {
      intentLabel = "enrichment-seeking";
    }

    // Get recent topics (from last 5 sessions)
    const recentTopics: string[] = [];
    for (const session of sessions.slice(0, 5)) {
      for (const topic of session.topics) {
        if (!recentTopics.includes(topic)) {
          recentTopics.push(topic);
        }
        if (recentTopics.length >= 5) break;
      }
      if (recentTopics.length >= 5) break;
    }

    return {
      totalCoachRequests: sessions.length,
      recentTopics,
      intentLabel,
      lastCoachSessionAt: sessions[0]?.endedAt || sessions[0]?.startedAt,
    };
  }

  private listSessionFiles(): string[] {
    if (!fs.existsSync(DATA_DIR)) {
      return [];
    }
    return fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));
  }

  private loadFromFile(filename: string): CoachSession | null {
    try {
      const filePath = path.join(DATA_DIR, filename);
      const data = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(data) as CoachSession;
    } catch {
      return null;
    }
  }
}
