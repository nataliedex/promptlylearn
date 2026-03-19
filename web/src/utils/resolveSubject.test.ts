import { normalizeSubject, resolveSubject } from "./resolveSubject";

// ============================================================================
// normalizeSubject
// ============================================================================

describe("normalizeSubject", () => {
  test("maps lowercase 'math' to 'Math'", () => {
    expect(normalizeSubject("math")).toBe("Math");
  });

  test("maps 'MATH' to 'Math' (case-insensitive)", () => {
    expect(normalizeSubject("MATH")).toBe("Math");
  });

  test("maps 'science' to 'Science'", () => {
    expect(normalizeSubject("science")).toBe("Science");
  });

  test("maps 'ela' to 'English / Language Arts'", () => {
    expect(normalizeSubject("ela")).toBe("English / Language Arts");
  });

  test("maps 'english' to 'English / Language Arts'", () => {
    expect(normalizeSubject("english")).toBe("English / Language Arts");
  });

  test("maps 'language arts' to 'English / Language Arts'", () => {
    expect(normalizeSubject("language arts")).toBe("English / Language Arts");
  });

  test("maps 'English / Language Arts' to itself (already canonical)", () => {
    expect(normalizeSubject("English / Language Arts")).toBe("English / Language Arts");
  });

  test("maps 'social studies' to 'Social Studies'", () => {
    expect(normalizeSubject("social studies")).toBe("Social Studies");
  });

  test("maps 'reading' to 'Reading'", () => {
    expect(normalizeSubject("reading")).toBe("Reading");
  });

  test("maps 'writing' to 'Writing'", () => {
    expect(normalizeSubject("writing")).toBe("Writing");
  });

  test("preserves unknown subjects with trimming", () => {
    expect(normalizeSubject("  Art  ")).toBe("Art");
  });

  test("returns undefined for empty string", () => {
    expect(normalizeSubject("")).toBeUndefined();
  });

  test("returns undefined for whitespace-only", () => {
    expect(normalizeSubject("   ")).toBeUndefined();
  });

  test("returns undefined for undefined", () => {
    expect(normalizeSubject(undefined)).toBeUndefined();
  });

  test("returns undefined for null", () => {
    expect(normalizeSubject(null)).toBeUndefined();
  });
});

// ============================================================================
// resolveSubject — priority chain
// ============================================================================

describe("resolveSubject", () => {
  test("uses lessonSubject when present (highest priority)", () => {
    expect(resolveSubject({
      lessonSubject: "Math",
      sessionSubject: "Science",
      classSubject: "Reading",
    })).toBe("Math");
  });

  test("falls back to sessionSubject when lessonSubject missing", () => {
    expect(resolveSubject({
      lessonSubject: undefined,
      sessionSubject: "Science",
      classSubject: "Reading",
    })).toBe("Science");
  });

  test("falls back to classSubject when lesson and session missing", () => {
    expect(resolveSubject({
      classSubject: "Writing",
    })).toBe("Writing");
  });

  test("returns 'Other' when all sources missing", () => {
    expect(resolveSubject({})).toBe("Other");
  });

  test("returns 'Other' when all sources are empty strings", () => {
    expect(resolveSubject({
      lessonSubject: "",
      sessionSubject: "",
      classSubject: "",
    })).toBe("Other");
  });

  test("normalizes lessonSubject before returning", () => {
    expect(resolveSubject({ lessonSubject: "math" })).toBe("Math");
  });

  test("normalizes sessionSubject before returning", () => {
    expect(resolveSubject({ sessionSubject: "ela" })).toBe("English / Language Arts");
  });

  test("normalizes classSubject before returning", () => {
    expect(resolveSubject({ classSubject: "social studies" })).toBe("Social Studies");
  });

  test("skips empty lessonSubject and uses normalized sessionSubject", () => {
    expect(resolveSubject({
      lessonSubject: "  ",
      sessionSubject: "science",
    })).toBe("Science");
  });

  test("preserves non-canonical subjects", () => {
    expect(resolveSubject({ lessonSubject: "Music" })).toBe("Music");
  });
});
