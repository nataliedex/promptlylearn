/**
 * Tests for LessonEditor question-package staleness & lock logic.
 *
 * These test the pure utility functions extracted at the top of LessonEditor.tsx.
 * Since they're module-private, we duplicate the small helpers here for testing.
 */

// ── questionHash — deterministic hash of normalized question text ──────────

function questionHash(text: string): string {
  const normalized = text.trim().replace(/\s+/g, " ").toLowerCase();
  let hash = 5381;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) + hash + normalized.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

describe("questionHash", () => {
  it("produces a stable hash for the same input", () => {
    const h1 = questionHash("How would you subtract 8, 3, and 2?");
    const h2 = questionHash("How would you subtract 8, 3, and 2?");
    expect(h1).toBe(h2);
  });

  it("normalizes whitespace", () => {
    const h1 = questionHash("How would   you subtract   8?");
    const h2 = questionHash("How would you subtract 8?");
    expect(h1).toBe(h2);
  });

  it("is case insensitive", () => {
    const h1 = questionHash("Hello World");
    const h2 = questionHash("hello world");
    expect(h1).toBe(h2);
  });

  it("trims leading/trailing whitespace", () => {
    const h1 = questionHash("  hello  ");
    const h2 = questionHash("hello");
    expect(h1).toBe(h2);
  });

  it("produces different hashes for different inputs", () => {
    const h1 = questionHash("What is 5 + 3?");
    const h2 = questionHash("What is 5 - 3?");
    expect(h1).not.toBe(h2);
  });

  it("returns a non-empty string", () => {
    expect(questionHash("test").length).toBeGreaterThan(0);
  });
});

// ── Block metadata staleness detection ────────────────────────────────────

interface BlockMeta {
  source: "ai" | "teacher";
  locked: boolean;
  basedOnQuestionHash: string;
}

function isBlockStale(meta: BlockMeta, currentHash: string): boolean {
  return meta.basedOnQuestionHash !== currentHash;
}

describe("staleness detection", () => {
  it("block is NOT stale when hash matches", () => {
    const hash = questionHash("How do you subtract?");
    const meta: BlockMeta = { source: "ai", locked: false, basedOnQuestionHash: hash };
    expect(isBlockStale(meta, hash)).toBe(false);
  });

  it("block IS stale when hash differs", () => {
    const oldHash = questionHash("How do you subtract?");
    const newHash = questionHash("How do you add?");
    const meta: BlockMeta = { source: "ai", locked: false, basedOnQuestionHash: oldHash };
    expect(isBlockStale(meta, newHash)).toBe(true);
  });

  it("locked block is still detected as stale (staleness is independent of lock)", () => {
    const oldHash = questionHash("Original question");
    const newHash = questionHash("Changed question");
    const meta: BlockMeta = { source: "teacher", locked: true, basedOnQuestionHash: oldHash };
    expect(isBlockStale(meta, newHash)).toBe(true);
  });
});

// ── Lock behavior: locked blocks should not be overwritten ────────────────

describe("lock behavior", () => {
  interface QuestionMeta {
    hints: BlockMeta;
    objective: BlockMeta;
    criteria: BlockMeta;
    misconceptions: BlockMeta;
  }

  type SectionKey = keyof QuestionMeta;

  function applyPackage(
    meta: QuestionMeta,
    regenerate: { hints: boolean; mastery: boolean },
    newHash: string
  ): { updatedSections: SectionKey[]; skippedSections: SectionKey[] } {
    const updated: SectionKey[] = [];
    const skipped: SectionKey[] = [];

    if (regenerate.hints) {
      if (!meta.hints.locked) updated.push("hints");
      else skipped.push("hints");
    }
    if (regenerate.mastery) {
      for (const section of ["objective", "criteria", "misconceptions"] as SectionKey[]) {
        if (!meta[section].locked) updated.push(section);
        else skipped.push(section);
      }
    }

    return { updatedSections: updated, skippedSections: skipped };
  }

  it("updates all unlocked sections", () => {
    const hash = questionHash("test");
    const meta: QuestionMeta = {
      hints: { source: "ai", locked: false, basedOnQuestionHash: hash },
      objective: { source: "ai", locked: false, basedOnQuestionHash: hash },
      criteria: { source: "ai", locked: false, basedOnQuestionHash: hash },
      misconceptions: { source: "ai", locked: false, basedOnQuestionHash: hash },
    };

    const result = applyPackage(meta, { hints: true, mastery: true }, "newhash");
    expect(result.updatedSections).toEqual(["hints", "objective", "criteria", "misconceptions"]);
    expect(result.skippedSections).toEqual([]);
  });

  it("skips locked hints", () => {
    const hash = questionHash("test");
    const meta: QuestionMeta = {
      hints: { source: "teacher", locked: true, basedOnQuestionHash: hash },
      objective: { source: "ai", locked: false, basedOnQuestionHash: hash },
      criteria: { source: "ai", locked: false, basedOnQuestionHash: hash },
      misconceptions: { source: "ai", locked: false, basedOnQuestionHash: hash },
    };

    const result = applyPackage(meta, { hints: true, mastery: true }, "newhash");
    expect(result.updatedSections).toEqual(["objective", "criteria", "misconceptions"]);
    expect(result.skippedSections).toEqual(["hints"]);
  });

  it("skips locked criteria while updating other mastery fields", () => {
    const hash = questionHash("test");
    const meta: QuestionMeta = {
      hints: { source: "ai", locked: false, basedOnQuestionHash: hash },
      objective: { source: "ai", locked: false, basedOnQuestionHash: hash },
      criteria: { source: "teacher", locked: true, basedOnQuestionHash: hash },
      misconceptions: { source: "ai", locked: false, basedOnQuestionHash: hash },
    };

    const result = applyPackage(meta, { hints: true, mastery: true }, "newhash");
    expect(result.updatedSections).toEqual(["hints", "objective", "misconceptions"]);
    expect(result.skippedSections).toEqual(["criteria"]);
  });

  it("skips all locked sections", () => {
    const hash = questionHash("test");
    const meta: QuestionMeta = {
      hints: { source: "teacher", locked: true, basedOnQuestionHash: hash },
      objective: { source: "teacher", locked: true, basedOnQuestionHash: hash },
      criteria: { source: "teacher", locked: true, basedOnQuestionHash: hash },
      misconceptions: { source: "teacher", locked: true, basedOnQuestionHash: hash },
    };

    const result = applyPackage(meta, { hints: true, mastery: true }, "newhash");
    expect(result.updatedSections).toEqual([]);
    expect(result.skippedSections).toEqual(["hints", "objective", "criteria", "misconceptions"]);
  });

  it("only processes hints when mastery=false", () => {
    const hash = questionHash("test");
    const meta: QuestionMeta = {
      hints: { source: "ai", locked: false, basedOnQuestionHash: hash },
      objective: { source: "ai", locked: false, basedOnQuestionHash: hash },
      criteria: { source: "ai", locked: false, basedOnQuestionHash: hash },
      misconceptions: { source: "ai", locked: false, basedOnQuestionHash: hash },
    };

    const result = applyPackage(meta, { hints: true, mastery: false }, "newhash");
    expect(result.updatedSections).toEqual(["hints"]);
  });
});
