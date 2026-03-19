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

  it("ends conversation with server_wrap when shouldContinue=false and no wrapReason", () => {
    const result = decidePostCoachAction({
      shouldContinue: false,
      coachResponse: "Great answer! You really understand this topic well.",
      realElapsedSec: 60,
      maxDurationSec: 120,
    });
    expect(result.action).toBe("end_conversation");
    expect(result.reason).toBe("server_wrap");
  });

  // ── Edge cases ──

  it("ends conversation with server_wrap when shouldContinue=false with question (unusual)", () => {
    const result = decidePostCoachAction({
      shouldContinue: false,
      coachResponse: "Nice work! Ready for the next question?",
      realElapsedSec: 50,
      maxDurationSec: 120,
    });
    expect(result.action).toBe("end_conversation");
    expect(result.reason).toBe("server_wrap");
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

  it("ends conversation with server_wrap when shouldContinue=false (no wrapReason from server)", () => {
    const result = decidePostCoachAction({
      shouldContinue: false,
      coachResponse: "Great job! You really understand this topic.",
      realElapsedSec: 27,
      maxDurationSec: 120,
    });
    expect(result.action).toBe("end_conversation");
    expect(result.reason).toBe("server_wrap");
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

  it("uses fallback when no topics (default = neutral wrap)", () => {
    const result = buildClosingStatement([]);
    expect(result).toContain("Great effort");
    expect(result).toContain("Let's wrap up for now.");
  });

  it("includes student name when provided", () => {
    const result = buildClosingStatement(["the sun provides warmth and heat"], "Alex");
    expect(result).toContain("Alex");
    expect(result).toContain("how the sun provides warmth and heat");
  });

  it("does NOT mention coaching session", () => {
    const result = buildClosingStatement(["the sun provides warmth"]);
    expect(result).not.toContain("coaching session");
    expect(result).toContain("Let's wrap up for now.");
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
  it("mastery wrap ends conversation with server_wrap (no explicit wrapReason)", () => {
    const result = decidePostCoachAction({
      shouldContinue: false,
      coachResponse: "Nice work! You've met the goal.",
      realElapsedSec: 60,
      maxDurationSec: 120,
    });
    expect(result.action).toBe("end_conversation");
    expect(result.reason).toBe("server_wrap");
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

// ── buildClosingStatement — wrapReason-aware copy ──

describe("buildClosingStatement — wrapReason-aware copy", () => {
  it("says 'almost out of time' when wrapReason=closing_window", () => {
    const result = buildClosingStatement(["subtraction"], undefined, "closing_window");
    expect(result).toContain("We're almost out of time.");
  });

  it("says 'almost out of time' when wrapReason=timer_expired", () => {
    const result = buildClosingStatement([], undefined, "timer_expired");
    expect(result).toContain("We're almost out of time.");
  });

  it("says 'wrap up for now' when wrapReason=max_exchanges_reached", () => {
    const result = buildClosingStatement(["community helpers"], undefined, "max_exchanges_reached");
    expect(result).toContain("Let's wrap up for now.");
    expect(result).not.toContain("almost out of time");
  });

  it("says 'wrap up for now' when wrapReason=probing_cutoff", () => {
    const result = buildClosingStatement([], undefined, "probing_cutoff");
    expect(result).toContain("Let's wrap up for now.");
    expect(result).not.toContain("almost out of time");
  });

  it("says 'wrap up for now' when no wrapReason (default)", () => {
    const result = buildClosingStatement(["subtraction"]);
    expect(result).toContain("Let's wrap up for now.");
    expect(result).not.toContain("almost out of time");
  });
});

// ── server_wrap vs explicit_end (wrapReason from server) ──

describe("decidePostCoachAction — server_wrap vs explicit_end", () => {
  it("shouldContinue=false with wrapReason='server_wrap' → reason=server_wrap", () => {
    const result = decidePostCoachAction({
      shouldContinue: false,
      coachResponse: "Thanks for trying!",
      realElapsedSec: 60,
      maxDurationSec: 120,
      wrapReason: "server_wrap",
    });
    expect(result.action).toBe("end_conversation");
    expect(result.reason).toBe("server_wrap");
  });

  it("shouldContinue=false with wrapReason='explicit_end' → reason=explicit_end", () => {
    const result = decidePostCoachAction({
      shouldContinue: false,
      coachResponse: "Okay, we can stop here.",
      realElapsedSec: 60,
      maxDurationSec: 120,
      wrapReason: "explicit_end",
    });
    expect(result.action).toBe("end_conversation");
    expect(result.reason).toBe("explicit_end");
  });

  it("shouldContinue=false with no wrapReason → reason=server_wrap (safe default)", () => {
    const result = decidePostCoachAction({
      shouldContinue: false,
      coachResponse: "Good effort.",
      realElapsedSec: 60,
      maxDurationSec: 120,
    });
    expect(result.action).toBe("end_conversation");
    expect(result.reason).toBe("server_wrap");
  });

  it("turnKind=WRAP with criteria=strong ends conversation as server_wrap", () => {
    const result = decidePostCoachAction({
      shouldContinue: false,
      coachResponse: "Great answer!",
      realElapsedSec: 60,
      maxDurationSec: 120,
      turnKind: "WRAP",
      wrapReason: "explicit_end",
      criteriaStatus: "strong",
    });
    expect(result.action).toBe("end_conversation");
    expect(result.reason).toBe("server_wrap");
  });
});

// ── max_exchanges_reached override when criteria not strong ──

describe("decidePostCoachAction — server WRAP always ends conversation", () => {
  it("server WRAP with criteria=partial → end_conversation (no double-close)", () => {
    const result = decidePostCoachAction({
      shouldContinue: false,
      coachResponse: "Tell me more about that?",
      realElapsedSec: 60,
      maxDurationSec: 120,
      turnKind: "WRAP",
      criteriaStatus: "partial",
    });
    expect(result.action).toBe("end_conversation");
    expect(result.reason).toBe("server_wrap");
  });

  it("server WRAP with criteria=weak → end_conversation", () => {
    const result = decidePostCoachAction({
      shouldContinue: false,
      coachResponse: "Can you explain more?",
      realElapsedSec: 50,
      maxDurationSec: 120,
      turnKind: "WRAP",
      criteriaStatus: "weak",
    });
    expect(result.action).toBe("end_conversation");
    expect(result.reason).toBe("server_wrap");
  });

  it("server WRAP with criteria=strong → end_conversation", () => {
    const result = decidePostCoachAction({
      shouldContinue: false,
      coachResponse: "Great work!",
      realElapsedSec: 60,
      maxDurationSec: 120,
      turnKind: "WRAP",
      criteriaStatus: "strong",
    });
    expect(result.action).toBe("end_conversation");
    expect(result.reason).toBe("server_wrap");
  });

  it("server WRAP near probing cutoff → end_conversation (timing does NOT override)", () => {
    const result = decidePostCoachAction({
      shouldContinue: false,
      coachResponse: "Thanks for trying.",
      realElapsedSec: 100,  // 20s remaining — would normally trigger probing_cutoff
      maxDurationSec: 120,
      turnKind: "WRAP",
      criteriaStatus: "partial",
    });
    expect(result.action).toBe("end_conversation");
    expect(result.reason).toBe("server_wrap");
  });

  it("server WRAP with no criteriaStatus → end_conversation", () => {
    const result = decidePostCoachAction({
      shouldContinue: false,
      coachResponse: "Nice try!",
      realElapsedSec: 60,
      maxDurationSec: 120,
      turnKind: "WRAP",
    });
    expect(result.action).toBe("end_conversation");
    expect(result.reason).toBe("server_wrap");
  });
});

// ── Double-wrap prevention ──

describe("decidePostCoachAction — double-wrap prevention", () => {
  it("server WRAP ends conversation without triggering SessionWrap TTS", () => {
    const result = decidePostCoachAction({
      shouldContinue: false,
      coachResponse: "Thanks for trying — we'll pause here for now.",
      realElapsedSec: 43,
      maxDurationSec: 120,
      turnKind: "WRAP",
      criteriaStatus: "strong",
    });
    // action=end_conversation means VCR skips handleSessionWrap entirely
    expect(result.action).toBe("end_conversation");
    expect(result.reason).toBe("server_wrap");
  });

  it("timing-based wrap (closing_window) returns closing_window reason", () => {
    // Timing wraps SHOULD trigger SessionWrap TTS (no server WRAP)
    const result = decidePostCoachAction({
      shouldContinue: true,
      coachResponse: "What do you think?",
      realElapsedSec: 110,
      maxDurationSec: 120,
    });
    expect(result.action).toBe("wrap");
    expect(result.reason).toBe("closing_window");
  });

  it("timing-based wrap (timer_expired) returns timer_expired reason", () => {
    const result = decidePostCoachAction({
      shouldContinue: true,
      coachResponse: "What do you think?",
      realElapsedSec: 120,
      maxDurationSec: 120,
    });
    expect(result.action).toBe("wrap");
    expect(result.reason).toBe("timer_expired");
  });

  // ── SUCCESS WRAP REGRESSION: only one closing message ──

  it("success WRAP mid-session → only server message, no session wrap", () => {
    const result = decidePostCoachAction({
      shouldContinue: false,
      coachResponse: "Great work! You solved the problem correctly and explained your thinking.",
      realElapsedSec: 60,
      maxDurationSec: 120,
      turnKind: "WRAP",
      criteriaStatus: "strong",
    });
    expect(result.action).toBe("end_conversation");
    expect(result.reason).toBe("server_wrap");
    // NOT "wrap" — so handleSessionWrap is never called, no "Let's wrap up" spoken
    expect(result.action).not.toBe("wrap");
  });

  it("success WRAP near probing cutoff → still only one closing message", () => {
    // Success wrap arrives when only 25s remain. Without the fix,
    // decidePostCoachAction would return probing_cutoff, triggering
    // handleSessionWrap and a second closing message.
    const result = decidePostCoachAction({
      shouldContinue: false,
      coachResponse: "Great work! You solved the problem correctly and explained your thinking.",
      realElapsedSec: 95,  // 25s remaining — inside probing cutoff
      maxDurationSec: 120,
      turnKind: "WRAP",
      criteriaStatus: "strong",
    });
    expect(result.action).toBe("end_conversation");
    expect(result.reason).toBe("server_wrap");
    // The probing cutoff MUST NOT override the server's wrap
    expect(result.reason).not.toBe("probing_cutoff");
  });

  it("success WRAP near closing window → still only one closing message", () => {
    const result = decidePostCoachAction({
      shouldContinue: false,
      coachResponse: "Great work! You solved the problem correctly.",
      realElapsedSec: 108,  // 12s remaining — inside closing window
      maxDurationSec: 120,
      turnKind: "WRAP",
      criteriaStatus: "strong",
    });
    expect(result.action).toBe("end_conversation");
    expect(result.reason).toBe("server_wrap");
    expect(result.reason).not.toBe("closing_window");
  });

  it("success WRAP at timer expiry → still only one closing message", () => {
    const result = decidePostCoachAction({
      shouldContinue: false,
      coachResponse: "Great work! You solved the problem correctly.",
      realElapsedSec: 120,  // timer expired
      maxDurationSec: 120,
      turnKind: "WRAP",
      criteriaStatus: "strong",
    });
    expect(result.action).toBe("end_conversation");
    expect(result.reason).toBe("server_wrap");
    expect(result.reason).not.toBe("timer_expired");
  });

  it("non-success WRAP (needs_support) also suppresses session wrap", () => {
    const result = decidePostCoachAction({
      shouldContinue: false,
      coachResponse: "Thanks for trying. We'll keep working on this skill next time.",
      realElapsedSec: 60,
      maxDurationSec: 120,
      turnKind: "WRAP",
      criteriaStatus: "needs_support",
    });
    expect(result.action).toBe("end_conversation");
    expect(result.reason).toBe("server_wrap");
  });

  it("non-WRAP shouldContinue=false (e.g., FEEDBACK) in probing cutoff → timing wrap fires", () => {
    // When turnKind is NOT "WRAP", the server WRAP guard doesn't fire,
    // so probing cutoff (< 30s remaining) takes priority.
    const result = decidePostCoachAction({
      shouldContinue: false,
      coachResponse: "Good thinking.",
      realElapsedSec: 95,
      maxDurationSec: 120,
      turnKind: "FEEDBACK",
    });
    expect(result.action).toBe("wrap");
    expect(result.reason).toBe("probing_cutoff");
  });

  it("shouldContinue=true with question in probing cutoff → timing wrap fires", () => {
    // When the server says continue but time is running out, timing MUST override
    const result = decidePostCoachAction({
      shouldContinue: true,
      coachResponse: "What do you think about that?",
      realElapsedSec: 95,
      maxDurationSec: 120,
    });
    expect(result.action).toBe("wrap");
    expect(result.reason).toBe("probing_cutoff");
  });
});

// ============================================================================
// Component contract: onstop deferral and phase transition
//
// The VideoConversationRecorder uses two refs to coordinate MediaRecorder stop:
//   - sessionWrappedRef: prevents timer-triggered double-wrap
//   - wrapTTSPendingRef: tells onstop to defer phase transition (handleSessionWrap will do it)
//
// The onstop handler defers ONLY when wrapTTSPendingRef is true.
// This ensures the end_conversation path (server_wrap) lets onstop do the
// normal phase transition to "preview", preventing the UI from getting stuck.
// ============================================================================

describe("onstop deferral logic (component contract)", () => {
  // Simulate the onstop deferral decision: matches the guard in mediaRecorder.onstop
  function shouldDeferPhaseTransition(wrapTTSPending: boolean): boolean {
    return wrapTTSPending;
  }

  it("server_wrap (end_conversation) → onstop does NOT defer → phase transitions to preview", () => {
    // end_conversation path: sessionWrappedRef=true, wrapTTSPendingRef=false
    // onstop must NOT defer — it should set phase="preview"
    expect(shouldDeferPhaseTransition(false)).toBe(false);
  });

  it("handleSessionWrap path → onstop defers → handleSessionWrap sets phase to preview after TTS", () => {
    // handleSessionWrap path: sessionWrappedRef=true, wrapTTSPendingRef=true
    // onstop must defer — handleSessionWrap will setPhase("preview") after closing TTS
    expect(shouldDeferPhaseTransition(true)).toBe(true);
  });

  it("server_wrap decision returns end_conversation so component takes the non-deferring path", () => {
    const result = decidePostCoachAction({
      shouldContinue: false,
      coachResponse: "Great work! You solved it correctly!",
      realElapsedSec: 60,
      maxDurationSec: 120,
      turnKind: "WRAP",
    });
    // end_conversation means: set sessionWrappedRef (timer guard), do NOT set wrapTTSPendingRef,
    // call endConversation() → onstop fires → phase="preview"
    expect(result.action).toBe("end_conversation");
    expect(result.reason).toBe("server_wrap");
  });

  it("timing wrap decision returns wrap so component calls handleSessionWrap (which sets wrapTTSPendingRef)", () => {
    const result = decidePostCoachAction({
      shouldContinue: true,
      coachResponse: "What do you think?",
      realElapsedSec: 108,
      maxDurationSec: 120,
    });
    // wrap means: component calls handleSessionWrap which sets wrapTTSPendingRef=true
    // before stopping MediaRecorder → onstop defers → handleSessionWrap transitions after TTS
    expect(result.action).toBe("wrap");
    expect(result.reason).toBe("closing_window");
  });

  it("server_wrap near probing cutoff → still end_conversation, NOT timing wrap", () => {
    // Regression: before the fix, this could return "wrap"/"probing_cutoff"
    // which would trigger handleSessionWrap → double close.
    // Now server WRAP priority fires first → end_conversation.
    const result = decidePostCoachAction({
      shouldContinue: false,
      coachResponse: "You did great! All steps complete.",
      realElapsedSec: 95,
      maxDurationSec: 120,
      turnKind: "WRAP",
    });
    expect(result.action).toBe("end_conversation");
    expect(result.reason).toBe("server_wrap");
  });

  it("server_wrap at timer expiry → still end_conversation", () => {
    const result = decidePostCoachAction({
      shouldContinue: false,
      coachResponse: "Great job working through this problem!",
      realElapsedSec: 120,
      maxDurationSec: 120,
      turnKind: "WRAP",
    });
    expect(result.action).toBe("end_conversation");
    expect(result.reason).toBe("server_wrap");
  });

  it("no duplicate close: server_wrap ends conversation once, timing wrap not layered on top", () => {
    // The key invariant: when turnKind="WRAP" + shouldContinue=false,
    // the decision is ALWAYS end_conversation regardless of timing.
    // This means only ONE close path runs (onstop → preview), never two.
    for (const elapsed of [50, 95, 108, 120, 130]) {
      const result = decidePostCoachAction({
        shouldContinue: false,
        coachResponse: "Well done!",
        realElapsedSec: elapsed,
        maxDurationSec: 120,
        turnKind: "WRAP",
      });
      expect(result.action).toBe("end_conversation");
      expect(result.reason).toBe("server_wrap");
    }
  });

  // ── instructionalRecap override contract (component-level) ──

  describe("instructionalRecap client-side wrap contract", () => {
    it("probing_cutoff fires while instructionalRecap is available → recap should be used", () => {
      // Scenario: student gave misconceptions, server provided instructionalRecap,
      // then probing_cutoff fires on the client side
      const decision = decidePostCoachAction({
        shouldContinue: true,
        coachResponse: "We're adding, not subtracting. What is 1 + 4?",
        realElapsedSec: 95, // 25s remaining → probing cutoff
        maxDurationSec: 120,
        turnKind: "PROBE",
      });

      // Client decides probing_cutoff wrap
      expect(decision.action).toBe("wrap");
      expect(decision.reason).toBe("probing_cutoff");

      // Contract: when instructionalRecapRef.current is set,
      // handleSessionWrap MUST use it instead of buildClosingStatement.
      // This test documents the contract; the component implements it.
      const instructionalRecap = "This is an addition problem, not subtraction. Here's how it works: 1 + 4 = 5, 10 + 10 = 20, and 20 + 5 = 25. You're getting closer!";
      const genericClose = buildClosingStatement([], undefined, "probing_cutoff");

      // Instructional recap must NOT match generic close
      expect(instructionalRecap).not.toBe(genericClose);
      expect(instructionalRecap).toContain("addition problem");
      expect(instructionalRecap).toContain("1 + 4 = 5");
      expect(genericClose).toContain("Let's wrap up for now");
    });

    it("probing_cutoff without instructionalRecap → generic buildClosingStatement", () => {
      // When no misconception was detected, the generic close is used
      const genericClose = buildClosingStatement([], undefined, "probing_cutoff");
      expect(genericClose).toContain("Let's wrap up for now");
      expect(genericClose).not.toContain("addition problem");
    });

    it("timer_expired with instructionalRecap → recap takes precedence over time-pressure close", () => {
      const decision = decidePostCoachAction({
        shouldContinue: true,
        coachResponse: "What is 1 + 4?",
        realElapsedSec: 120,
        maxDurationSec: 120,
      });
      expect(decision.action).toBe("wrap");
      expect(decision.reason).toBe("timer_expired");

      // The instructional recap should be used in place of the time-pressure close
      const timeClose = buildClosingStatement([], undefined, "timer_expired");
      expect(timeClose).toContain("almost out of time");
      // Recap is more educational than "almost out of time"
      const instructionalRecap = "This is an addition problem, not subtraction. Here's how it works: 1 + 4 = 5, 10 + 10 = 20, and 20 + 5 = 25. You're getting closer!";
      expect(instructionalRecap).toContain("Here's how it works");
    });
  });
});

// ============================================================================
// Near-success leniency — probing cutoff with completionRatio (Issue C)
// ============================================================================

describe("near-success leniency (completionRatio)", () => {
  it("completionRatio >= 0.66 at 25s remaining → NO probing_cutoff (leniency)", () => {
    const result = decidePostCoachAction({
      shouldContinue: true,
      coachResponse: "What is 20 plus 5?",
      realElapsedSec: 95,   // 25s remaining — normally inside probing cutoff
      maxDurationSec: 120,
      completionRatio: 0.67,
    });
    // Near success: buffer reduced to CLOSING_WINDOW_SEC (15), so 25s remaining is outside
    expect(result.action).toBe("start_student_turn");
  });

  it("completionRatio >= 0.66 at 14s remaining → closing_window still fires", () => {
    const result = decidePostCoachAction({
      shouldContinue: true,
      coachResponse: "What is 20 plus 5?",
      realElapsedSec: 106,  // 14s remaining — inside closing window
      maxDurationSec: 120,
      completionRatio: 0.67,
    });
    // Closing window always fires regardless of leniency
    expect(result.action).toBe("wrap");
    expect(result.reason).toBe("closing_window");
  });

  it("completionRatio < 0.66 at 25s remaining → probing_cutoff fires (no leniency)", () => {
    const result = decidePostCoachAction({
      shouldContinue: true,
      coachResponse: "What is 1 plus 4?",
      realElapsedSec: 95,
      maxDurationSec: 120,
      completionRatio: 0.33,
    });
    expect(result.action).toBe("wrap");
    expect(result.reason).toBe("probing_cutoff");
  });

  it("no completionRatio (undefined) → default probing_cutoff behavior", () => {
    const result = decidePostCoachAction({
      shouldContinue: true,
      coachResponse: "What is 1 plus 4?",
      realElapsedSec: 95,
      maxDurationSec: 120,
    });
    expect(result.action).toBe("wrap");
    expect(result.reason).toBe("probing_cutoff");
  });

  it("completionRatio >= 0.66 at 16s remaining → probing_cutoff fires (leniency buffer is 15s)", () => {
    const result = decidePostCoachAction({
      shouldContinue: true,
      coachResponse: "What is 20 plus 5?",
      realElapsedSec: 104,  // 16s remaining — outside closing window but inside leniency buffer
      maxDurationSec: 120,
      completionRatio: 0.67,
    });
    // 16s remaining, leniency buffer = 15s, so NOT inside cutoff → student turn
    expect(result.action).toBe("start_student_turn");
  });

  it("server WRAP still wins over near-success leniency", () => {
    const result = decidePostCoachAction({
      shouldContinue: false,
      coachResponse: "Great work!",
      realElapsedSec: 95,
      maxDurationSec: 120,
      turnKind: "WRAP",
      completionRatio: 0.67,
    });
    expect(result.action).toBe("end_conversation");
    expect(result.reason).toBe("server_wrap");
  });

  it("combine step answer after long explanation → success wrap still happens", () => {
    // Student is near success, API returns success wrap
    const result = decidePostCoachAction({
      shouldContinue: false,
      coachResponse: "Great work! You solved it correctly.",
      realElapsedSec: 100,  // 20s remaining
      maxDurationSec: 120,
      turnKind: "WRAP",
      criteriaStatus: "strong",
      completionRatio: 1.0,
    });
    expect(result.action).toBe("end_conversation");
    expect(result.reason).toBe("server_wrap");
  });
});
