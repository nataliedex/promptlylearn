import { decidePostCoachAction, buildClosingStatement, CLOSING_WINDOW_SEC, NO_NEW_QUESTION_SEC, WRAP_BUFFER_SEC, isInNoNewQuestionWindow } from "./wrapDecision";

describe("decidePostCoachAction", () => {
  // ── HARD RULE: coach asked a question + shouldContinue=true → student turn ──

  it("REGRESSION: starts student turn when coach asks follow-up with shouldContinue=true", () => {
    const result = decidePostCoachAction({
      shouldContinue: true,
      coachResponse: "That's interesting! What do you think happens to the temperature as you get farther from the sun?",
      realElapsedSec: 27,
      maxDurationSec: 120,
    });
    expect(result.action).toBe("start_student_turn");
    expect(result.reason).toContain("HARD_RULE");
  });

  it("starts student turn when coach asks question mid-session", () => {
    const result = decidePostCoachAction({
      shouldContinue: true,
      coachResponse: "Good thinking! Can you tell me more about why gravity matters?",
      realElapsedSec: 45,
      maxDurationSec: 120,
    });
    expect(result.action).toBe("start_student_turn");
  });

  it("starts student turn when shouldContinue=true even without question", () => {
    const result = decidePostCoachAction({
      shouldContinue: true,
      coachResponse: "That's a great point. Tell me more about that.",
      realElapsedSec: 30,
      maxDurationSec: 120,
    });
    expect(result.action).toBe("start_student_turn");
  });

  // ── Timer expired always wraps ──

  it("wraps when timer expired even if coach asked a question", () => {
    const result = decidePostCoachAction({
      shouldContinue: true,
      coachResponse: "What do you think about that?",
      realElapsedSec: 120,
      maxDurationSec: 120,
    });
    expect(result.action).toBe("wrap");
    expect(result.reason).toBe("timer_expired");
  });

  it("wraps when timer expired with shouldContinue=false", () => {
    const result = decidePostCoachAction({
      shouldContinue: false,
      coachResponse: "Great job! Let's move on.",
      realElapsedSec: 125,
      maxDurationSec: 120,
    });
    expect(result.action).toBe("wrap");
    expect(result.reason).toBe("timer_expired");
  });

  // ── Closing window (< 15s remaining) ──

  it("wraps when inside closing window (< 15s remaining) even with shouldContinue=true", () => {
    const result = decidePostCoachAction({
      shouldContinue: true,
      coachResponse: "Good thinking! What else do you know?",
      realElapsedSec: 108,    // 12s remaining in a 120s session
      maxDurationSec: 120,
    });
    expect(result.action).toBe("wrap");
    expect(result.reason).toBe("closing_window");
  });

  it("wraps at exactly 14s remaining (inside closing window)", () => {
    const result = decidePostCoachAction({
      shouldContinue: true,
      coachResponse: "What do you think?",
      realElapsedSec: 106,   // 14s remaining
      maxDurationSec: 120,
    });
    expect(result.action).toBe("wrap");
    expect(result.reason).toBe("closing_window");
  });

  it("wraps at 15s remaining (inside probing cutoff of 30s)", () => {
    const result = decidePostCoachAction({
      shouldContinue: true,
      coachResponse: "What do you think?",
      realElapsedSec: 105,   // 15s remaining — inside probing cutoff (< 30s)
      maxDurationSec: 120,
    });
    expect(result.action).toBe("wrap");
    // Could be closing_window or probing_cutoff depending on which check fires first
    // Closing window fires first (< 15s), but 15s is the boundary — not inside closing window.
    // So probing_cutoff fires.
    expect(result.reason).toBe("probing_cutoff");
  });

  it("wraps in closing window for short session (60s)", () => {
    const result = decidePostCoachAction({
      shouldContinue: true,
      coachResponse: "Tell me more about that?",
      realElapsedSec: 50,    // 10s remaining
      maxDurationSec: 60,
    });
    expect(result.action).toBe("wrap");
    expect(result.reason).toBe("closing_window");
  });

  // ── Explicit end (shouldContinue=false, no question) ──

  it("ends conversation when shouldContinue=false and no question", () => {
    const result = decidePostCoachAction({
      shouldContinue: false,
      coachResponse: "Great answer! You really understand this topic well.",
      realElapsedSec: 60,
      maxDurationSec: 120,
    });
    expect(result.action).toBe("end_conversation");
    expect(result.reason).toBe("explicit_end");
  });

  // ── Edge cases ──

  it("ends conversation when shouldContinue=false even with question (unusual)", () => {
    const result = decidePostCoachAction({
      shouldContinue: false,
      coachResponse: "Nice work! Ready for the next question?",
      realElapsedSec: 50,
      maxDurationSec: 120,
    });
    expect(result.action).toBe("end_conversation");
    expect(result.reason).toBe("explicit_end");
  });

  it("does NOT wrap at 0:27 into a 2:00 session with shouldContinue=true", () => {
    const result = decidePostCoachAction({
      shouldContinue: true,
      coachResponse: "You mentioned the sun gives warmth. How does that help plants grow?",
      realElapsedSec: 27,
      maxDurationSec: 120,
    });
    expect(result.action).toBe("start_student_turn");
    expect(result.action).not.toBe("wrap");
    expect(result.action).not.toBe("end_conversation");
  });

  it("starts student turn with short maxDuration when time remains", () => {
    const result = decidePostCoachAction({
      shouldContinue: true,
      coachResponse: "What else can you tell me?",
      realElapsedSec: 30,
      maxDurationSec: 60,
    });
    expect(result.action).toBe("start_student_turn");
  });

  it("wraps at exact boundary (elapsed === maxDuration)", () => {
    const result = decidePostCoachAction({
      shouldContinue: true,
      coachResponse: "What do you think?",
      realElapsedSec: 60,
      maxDurationSec: 60,
    });
    expect(result.action).toBe("wrap");
    expect(result.reason).toBe("timer_expired");
  });

  it("ends conversation when shouldContinue=false and response has no question (clean close after server invariant)", () => {
    const result = decidePostCoachAction({
      shouldContinue: false,
      coachResponse: "Great job! You really understand this topic.",
      realElapsedSec: 27,
      maxDurationSec: 120,
    });
    expect(result.action).toBe("end_conversation");
    expect(result.reason).toBe("explicit_end");
  });
});

describe("buildClosingStatement", () => {
  it("includes student topics with 'how' connector", () => {
    const result = buildClosingStatement([
      "the sun provides warmth and heat",
      "gravity from the sun keeps the planets in orbit",
    ]);
    expect(result).toContain("how the sun provides warmth and heat");
    expect(result).toContain("how gravity from the sun keeps the planets in orbit");
  });

  it("handles single topic", () => {
    const result = buildClosingStatement(["the sun provides warmth and heat"]);
    expect(result).toContain("how the sun provides warmth and heat");
  });

  it("uses fallback when no topics", () => {
    const result = buildClosingStatement([]);
    expect(result).toContain("Great effort");
    expect(result).toContain("We're almost out of time");
  });

  it("includes student name when provided", () => {
    const result = buildClosingStatement(["the sun provides warmth and heat"], "Alex");
    expect(result).toContain("Alex");
    expect(result).toContain("how the sun provides warmth and heat");
  });

  it("does NOT mention coaching session", () => {
    const result = buildClosingStatement(["the sun provides warmth"]);
    expect(result).not.toContain("coaching session");
    expect(result).toContain("We're almost out of time.");
  });

  it("does NOT mention coaching session (no topics)", () => {
    const result = buildClosingStatement([]);
    expect(result).not.toContain("coaching session");
  });
});

describe("CLOSING_WINDOW_SEC", () => {
  it("is 15 seconds", () => {
    expect(CLOSING_WINDOW_SEC).toBe(15);
  });
});

describe("NO_NEW_QUESTION_SEC", () => {
  it("is 25 seconds", () => {
    expect(NO_NEW_QUESTION_SEC).toBe(25);
  });
});

describe("WRAP_BUFFER_SEC", () => {
  it("is 30 seconds", () => {
    expect(WRAP_BUFFER_SEC).toBe(30);
  });
});

describe("probing cutoff (WRAP_BUFFER_SEC)", () => {
  it("wraps at 25s remaining (inside probing cutoff)", () => {
    const result = decidePostCoachAction({
      shouldContinue: true,
      coachResponse: "What do you think about that?",
      realElapsedSec: 95,   // 25s remaining
      maxDurationSec: 120,
    });
    expect(result.action).toBe("wrap");
    expect(result.reason).toBe("probing_cutoff");
  });

  it("wraps at 20s remaining — probing cutoff overrides HARD RULE", () => {
    const result = decidePostCoachAction({
      shouldContinue: true,
      coachResponse: "How does that help plants grow?",
      realElapsedSec: 100,  // 20s remaining — question + shouldContinue but past cutoff
      maxDurationSec: 120,
    });
    expect(result.action).toBe("wrap");
    expect(result.reason).toBe("probing_cutoff");
  });

  it("does NOT trigger cutoff at exactly 30s remaining (boundary)", () => {
    const result = decidePostCoachAction({
      shouldContinue: true,
      coachResponse: "What else can you tell me?",
      realElapsedSec: 90,   // 30s remaining — boundary, NOT inside (< 30, not <=)
      maxDurationSec: 120,
    });
    expect(result.action).toBe("start_student_turn");
  });

  it("triggers cutoff at 29s remaining", () => {
    const result = decidePostCoachAction({
      shouldContinue: true,
      coachResponse: "What else can you tell me?",
      realElapsedSec: 91,   // 29s remaining
      maxDurationSec: 120,
    });
    expect(result.action).toBe("wrap");
    expect(result.reason).toBe("probing_cutoff");
  });

  it("wraps at 10s remaining for 60s session (probing cutoff)", () => {
    const result = decidePostCoachAction({
      shouldContinue: true,
      coachResponse: "Tell me more?",
      realElapsedSec: 50,   // 10s remaining in 60s session
      maxDurationSec: 60,
    });
    expect(result.action).toBe("wrap");
    // 10 < 15 → closing_window fires first (before probing cutoff)
    expect(result.reason).toBe("closing_window");
  });
});

describe("isInNoNewQuestionWindow", () => {
  it("returns true at 20s remaining (inside window)", () => {
    // 100 elapsed of 120 → 20s remaining
    expect(isInNoNewQuestionWindow(100, 120)).toBe(true);
  });

  it("returns true at 16s remaining (inside window, above closing)", () => {
    expect(isInNoNewQuestionWindow(104, 120)).toBe(true);
  });

  it("returns true at 10s remaining (also in closing window)", () => {
    expect(isInNoNewQuestionWindow(110, 120)).toBe(true);
  });

  it("returns false at 30s remaining (outside window)", () => {
    expect(isInNoNewQuestionWindow(90, 120)).toBe(false);
  });

  it("returns false at exactly 25s remaining (boundary, outside)", () => {
    expect(isInNoNewQuestionWindow(95, 120)).toBe(false);
  });

  it("returns false when timer expired", () => {
    expect(isInNoNewQuestionWindow(120, 120)).toBe(false);
  });
});

describe("mastery wrap behavior", () => {
  it("mastery wrap ends conversation (shouldContinue=false, no question)", () => {
    const result = decidePostCoachAction({
      shouldContinue: false,
      coachResponse: "Nice work! You've met the goal. Please click Submit Response.",
      realElapsedSec: 60,
      maxDurationSec: 120,
    });
    expect(result.action).toBe("end_conversation");
    expect(result.reason).toBe("explicit_end");
  });
});

// ── buildClosingStatement — foreign keyword safety ──────────────────────────

describe("buildClosingStatement — foreign keyword safety", () => {
  it("REGRESSION: 'sun' must NOT appear in wrap when topics are from subtraction lesson", () => {
    // If the foreign keyword filter works, these solar-system templates should
    // have been stripped BEFORE reaching buildClosingStatement. But as a
    // belt-and-suspenders check, verify the templates don't produce "sun" output
    // when given generic (non-solar) input.
    const genericTopics: string[] = []; // Empty = safe fallback
    const result = buildClosingStatement(genericTopics);
    expect(result).not.toMatch(/\bsun\b/i);
    expect(result).not.toMatch(/\bplanet/i);
    expect(result).not.toMatch(/\borbit/i);
  });

  it("includes topic phrases when topics are passed", () => {
    const result = buildClosingStatement(
      ["subtraction involves taking away numbers"],
    );
    expect(result).toContain("subtraction");
  });

  it("uses generic fallback when no topics provided", () => {
    const result = buildClosingStatement([]);
    expect(result).toContain("Great effort");
    expect(result).not.toMatch(/\bsun\b/i);
  });
});
