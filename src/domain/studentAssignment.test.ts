import {
  ReviewState,
  REVIEW_STATE_LABELS,
  getReviewStateLabel,
  deriveReviewState,
} from "./studentAssignment";

describe("ReviewState labels", () => {
  const ALL_STATES: ReviewState[] = [
    "not_started",
    "pending_review",
    "reviewed",
    "followup_scheduled",
    "resolved",
  ];

  it("has a label for every ReviewState value", () => {
    for (const state of ALL_STATES) {
      expect(REVIEW_STATE_LABELS[state]).toBeDefined();
    }
  });

  it("never uses a bare dash as a label", () => {
    for (const state of ALL_STATES) {
      const label = REVIEW_STATE_LABELS[state];
      expect(label).not.toBe("—");
      expect(label).not.toBe("-");
      expect(label.trim().length).toBeGreaterThan(0);
    }
  });

  it("getReviewStateLabel returns the label for known states", () => {
    expect(getReviewStateLabel("not_started")).toBe("Not started");
    expect(getReviewStateLabel("pending_review")).toBe("Awaiting review");
    expect(getReviewStateLabel("reviewed")).toBe("Reviewed");
    expect(getReviewStateLabel("followup_scheduled")).toBe("Follow-up scheduled");
    expect(getReviewStateLabel("resolved")).toBe("Reviewed");
  });

  it("getReviewStateLabel falls back to the raw state for unknown values", () => {
    // Cast to bypass TypeScript for the defensive fallback test
    expect(getReviewStateLabel("bogus_state" as ReviewState)).toBe("bogus_state");
  });
});

describe("deriveReviewState", () => {
  it("returns not_started when student has not completed", () => {
    expect(deriveReviewState(false, false, 0, 0, false)).toBe("not_started");
  });

  it("returns pending_review when completed but not reviewed", () => {
    expect(deriveReviewState(true, false, 0, 0, false)).toBe("pending_review");
  });

  it("returns reviewed when reviewed without follow-ups", () => {
    expect(deriveReviewState(true, true, 0, 0, false)).toBe("reviewed");
  });

  it("returns followup_scheduled when there are open todos", () => {
    expect(deriveReviewState(true, true, 2, 0, false)).toBe("followup_scheduled");
  });

  it("returns resolved when all todos are completed", () => {
    expect(deriveReviewState(true, true, 0, 1, false)).toBe("resolved");
  });

  it("returns resolved when badge or note was added", () => {
    expect(deriveReviewState(true, true, 0, 0, true)).toBe("resolved");
  });
});
