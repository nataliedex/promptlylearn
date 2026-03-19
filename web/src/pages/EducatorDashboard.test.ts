/**
 * Tests for EducatorDashboard assignment bucketing (prioritizeAssignments) logic.
 *
 * Since prioritizeAssignments is a component-local function, we duplicate its
 * pure bucketing decision logic here for unit testing (same pattern as
 * LessonEditor.test.ts).
 */

// ── Duplicated bucketing decision function ──────────────────────────────────

type BucketPriority = "needs-attention" | "in-progress" | "awaiting-submissions" | "reviewed";

interface BucketInput {
  completedCount: number;
  inProgressCount: number;
  attentionCount: number;
  openTodoCount: number;
  allCompletedReviewed: boolean;
  allFlaggedReviewed: boolean;
}

function determineBucket(input: BucketInput): BucketPriority {
  const { completedCount, inProgressCount, attentionCount, openTodoCount, allCompletedReviewed, allFlaggedReviewed } = input;

  const hasCompletedWork = completedCount > 0;
  const hasStartedWork = inProgressCount > 0;
  // Student-based attention only counts when there are completed submissions
  const hasStudentAttention = attentionCount > 0 && hasCompletedWork;
  const hasAttention = hasStudentAttention || openTodoCount > 0;

  if (hasAttention) {
    return "needs-attention";
  } else if (!hasCompletedWork && !hasStartedWork) {
    return "awaiting-submissions";
  } else if (!hasCompletedWork && hasStartedWork) {
    return "in-progress";
  } else if (!allCompletedReviewed || !allFlaggedReviewed) {
    return "in-progress";
  } else {
    return "reviewed";
  }
}

// ── attentionCount resolution (mirrors line 926 fix: ?? instead of ||) ──────

function resolveAttentionCount(
  needingAttentionCount: number | undefined,
  studentsNeedingSupport: number
): number {
  return needingAttentionCount ?? studentsNeedingSupport;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("assignment bucketing", () => {
  describe("Awaiting Submissions", () => {
    it("no activity → awaiting-submissions", () => {
      expect(determineBucket({
        completedCount: 0,
        inProgressCount: 0,
        attentionCount: 0,
        openTodoCount: 0,
        allCompletedReviewed: false,
        allFlaggedReviewed: true,
      })).toBe("awaiting-submissions");
    });
  });

  describe("In Progress — started but not submitted", () => {
    it("students started but none completed → in-progress", () => {
      expect(determineBucket({
        completedCount: 0,
        inProgressCount: 3,
        attentionCount: 0,
        openTodoCount: 0,
        allCompletedReviewed: false,
        allFlaggedReviewed: true,
      })).toBe("in-progress");
    });

    it("BUG FIX: in-progress students with attentionCount > 0 but NO completions → in-progress (NOT needs-attention)", () => {
      // This was the original bug: attentionCount > 0 from lifecycle needsSupport
      // on in-progress students caused "Needs Attention" incorrectly
      expect(determineBucket({
        completedCount: 0,
        inProgressCount: 2,
        attentionCount: 1,  // Spurious attention from lifecycle
        openTodoCount: 0,
        allCompletedReviewed: false,
        allFlaggedReviewed: true,
      })).toBe("in-progress");
    });
  });

  describe("Needs Attention — requires completed work or teacher todos", () => {
    it("completed submissions + attention count → needs-attention", () => {
      expect(determineBucket({
        completedCount: 3,
        inProgressCount: 0,
        attentionCount: 1,
        openTodoCount: 0,
        allCompletedReviewed: false,
        allFlaggedReviewed: false,
      })).toBe("needs-attention");
    });

    it("open teacher todos → needs-attention (even without completions)", () => {
      // Teacher-created todos represent explicit intent, always count
      expect(determineBucket({
        completedCount: 0,
        inProgressCount: 2,
        attentionCount: 0,
        openTodoCount: 1,
        allCompletedReviewed: false,
        allFlaggedReviewed: true,
      })).toBe("needs-attention");
    });

    it("open teacher todos with no activity → needs-attention", () => {
      expect(determineBucket({
        completedCount: 0,
        inProgressCount: 0,
        attentionCount: 0,
        openTodoCount: 2,
        allCompletedReviewed: false,
        allFlaggedReviewed: true,
      })).toBe("needs-attention");
    });
  });

  describe("In Progress — completed but not reviewed", () => {
    it("completed but not reviewed → in-progress", () => {
      expect(determineBucket({
        completedCount: 5,
        inProgressCount: 0,
        attentionCount: 0,
        openTodoCount: 0,
        allCompletedReviewed: false,
        allFlaggedReviewed: true,
      })).toBe("in-progress");
    });

    it("flagged students not reviewed → in-progress", () => {
      expect(determineBucket({
        completedCount: 5,
        inProgressCount: 0,
        attentionCount: 0,
        openTodoCount: 0,
        allCompletedReviewed: true,
        allFlaggedReviewed: false,
      })).toBe("in-progress");
    });
  });

  describe("Reviewed", () => {
    it("all completed and reviewed → reviewed", () => {
      expect(determineBucket({
        completedCount: 5,
        inProgressCount: 0,
        attentionCount: 0,
        openTodoCount: 0,
        allCompletedReviewed: true,
        allFlaggedReviewed: true,
      })).toBe("reviewed");
    });
  });
});

describe("attentionCount resolution (|| vs ??)", () => {
  it("uses needingAttentionCount when available (even 0)", () => {
    // With ??:  0 ?? 5 = 0 (correct — attention system says 0)
    expect(resolveAttentionCount(0, 5)).toBe(0);
  });

  it("falls back to studentsNeedingSupport only when needingAttentionCount is undefined", () => {
    // With ??:  undefined ?? 3 = 3 (fallback — no attention data)
    expect(resolveAttentionCount(undefined, 3)).toBe(3);
  });

  it("BUG FIX: with ||, zero needingAttentionCount would incorrectly fall through", () => {
    // With ||:  0 || 5 = 5 (WRONG — attention system says 0 but gets overridden)
    // With ??:  0 ?? 5 = 0 (CORRECT)
    const withNullishCoalescing = resolveAttentionCount(0, 5);
    expect(withNullishCoalescing).toBe(0);
  });
});
