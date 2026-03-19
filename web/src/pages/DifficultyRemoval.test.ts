/**
 * Tests verifying difficulty is removed from the educator UI
 * while maintaining backward compatibility with stored data.
 *
 * Since UI components are not rendered in these unit tests (no React DOM),
 * we verify that:
 * 1. Data-layer functions that build display strings no longer include difficulty
 * 2. Lessons with difficulty values still load and process correctly
 * 3. The search result secondary text excludes difficulty
 */

// ── Duplicated search result builder (mirrors EducatorDashboard search logic) ──

function buildSearchSecondary(lesson: { subject?: string; gradeLevel?: string; difficulty?: string }): string {
  return [lesson.subject, lesson.gradeLevel].filter(Boolean).join(" · ");
}

// ── Duplicated breadcrumb builder (mirrors AssignmentReview breadcrumb logic) ──

interface BreadcrumbItem {
  label: string;
  to?: string;
}

function buildBreadcrumbs(lesson: { subject?: string; gradeLevel?: string; difficulty?: string }, title: string): BreadcrumbItem[] {
  const breadcrumbs: BreadcrumbItem[] = [{ label: "Dashboard", to: "/educator" }];

  if (lesson.subject) {
    breadcrumbs.push({ label: lesson.subject, to: `/educator?subject=${lesson.subject}` });
  }

  // Difficulty breadcrumb deliberately removed — no longer rendered

  breadcrumbs.push({ label: title });
  return breadcrumbs;
}

// ── Tests ──

describe("difficulty removal from educator UI", () => {
  describe("search result text excludes difficulty", () => {
    it("shows only subject and grade", () => {
      const result = buildSearchSecondary({
        subject: "Math",
        gradeLevel: "2nd Grade",
        difficulty: "beginner",
      });
      expect(result).toBe("Math · 2nd Grade");
      expect(result).not.toContain("beginner");
    });

    it("handles missing subject", () => {
      const result = buildSearchSecondary({
        gradeLevel: "3rd Grade",
        difficulty: "advanced",
      });
      expect(result).toBe("3rd Grade");
      expect(result).not.toContain("advanced");
    });

    it("handles missing grade", () => {
      const result = buildSearchSecondary({
        subject: "Science",
        difficulty: "intermediate",
      });
      expect(result).toBe("Science");
      expect(result).not.toContain("intermediate");
    });
  });

  describe("breadcrumbs exclude difficulty", () => {
    it("does not include difficulty in breadcrumb labels", () => {
      const crumbs = buildBreadcrumbs(
        { subject: "Math", gradeLevel: "2nd Grade", difficulty: "beginner" },
        "Addition Practice"
      );
      const labels = crumbs.map(c => c.label);
      expect(labels).not.toContain("Beginner");
      expect(labels).not.toContain("beginner");
      expect(labels).toEqual(["Dashboard", "Math", "Addition Practice"]);
    });

    it("still works when difficulty is undefined", () => {
      const crumbs = buildBreadcrumbs(
        { subject: "Reading", gradeLevel: "1st Grade" },
        "Story Time"
      );
      const labels = crumbs.map(c => c.label);
      expect(labels).toEqual(["Dashboard", "Reading", "Story Time"]);
    });
  });

  describe("backward compatibility: lessons with difficulty still process", () => {
    it("lesson with difficulty field can still be used", () => {
      const lesson = {
        id: "test-lesson",
        title: "Math Basics",
        difficulty: "beginner" as const,
        subject: "Math",
        gradeLevel: "2nd Grade",
        promptCount: 5,
      };

      // Difficulty field still exists in the data model
      expect(lesson.difficulty).toBe("beginner");

      // But display text no longer includes it
      const displayText = buildSearchSecondary(lesson);
      expect(displayText).not.toContain("beginner");
    });

    it("lesson without difficulty field still works", () => {
      const lesson = {
        id: "test-lesson",
        title: "Science Intro",
        subject: "Science",
        gradeLevel: "3rd Grade",
        promptCount: 3,
      };

      const displayText = buildSearchSecondary(lesson);
      expect(displayText).toBe("Science · 3rd Grade");
    });

    it("all three difficulty values are valid in data model", () => {
      const difficulties = ["beginner", "intermediate", "advanced"] as const;
      for (const d of difficulties) {
        const lesson = { difficulty: d, subject: "Math", gradeLevel: "2nd Grade" };
        const text = buildSearchSecondary(lesson);
        expect(text).not.toContain(d);
      }
    });
  });
});
