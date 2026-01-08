import fs from "fs";
import path from "path";
import { Session } from "../domain/session";

const DATA_DIR = path.join(__dirname, "../../data/sessions");

/**
 * SessionStore handles saving and loading sessions to/from JSON files.
 * Each session is saved as a separate file: {sessionId}.json
 *
 * File-based storage keeps things simple for now.
 * Can be replaced with a database later without changing the interface.
 */
export class SessionStore {
  constructor() {
    // Ensure the sessions directory exists
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  /**
   * Save a session to disk
   */
  save(session: Session): void {
    const filePath = path.join(DATA_DIR, `${session.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2));
  }

  /**
   * Load a session by ID
   */
  load(sessionId: string): Session | null {
    const filePath = path.join(DATA_DIR, `${sessionId}.json`);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const data = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(data) as Session;
  }

  /**
   * Get all sessions for a specific student
   */
  getByStudentId(studentId: string): Session[] {
    const files = this.listSessionFiles();
    const sessions: Session[] = [];

    for (const file of files) {
      const session = this.loadFromFile(file);
      if (session && session.studentId === studentId) {
        sessions.push(session);
      }
    }

    return sessions.sort((a, b) =>
      new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
    );
  }

  /**
   * Get all sessions
   */
  getAll(): Session[] {
    const files = this.listSessionFiles();
    const sessions: Session[] = [];

    for (const file of files) {
      const session = this.loadFromFile(file);
      if (session) {
        sessions.push(session);
      }
    }

    return sessions.sort((a, b) =>
      new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
    );
  }

  private listSessionFiles(): string[] {
    if (!fs.existsSync(DATA_DIR)) {
      return [];
    }
    return fs.readdirSync(DATA_DIR).filter(f => f.endsWith(".json"));
  }

  private loadFromFile(filename: string): Session | null {
    try {
      const filePath = path.join(DATA_DIR, filename);
      const data = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(data) as Session;
    } catch {
      return null;
    }
  }
}
