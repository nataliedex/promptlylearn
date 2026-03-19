/**
 * Tests for the conversation-level strategy escalation controller.
 *
 * Covers:
 * - Escalation after repeated uncertain states
 * - Escalation after repeated no-progress turns
 * - Repeated same target triggers escalation
 * - Progress resets/lowers escalation
 * - Low time forces wrap_support
 * - Frustration accelerates escalation
 * - Math move mapping
 * - Explanation move mapping
 * - Transcript-style multi-turn scenarios
 */

import {
  determineConversationStrategy,
  detectProgress,
  inferStrategyFromMove,
  mathMoveForStrategy,
  explanationMoveForStrategy,
  escalateOne,
  shouldUpgradeMove,
  type StrategyInput,
  type Strategy,
} from "./conversationStrategy";

// ── Test helpers ─────────────────────────────────────────────────────────

function baseInput(overrides: Partial<StrategyInput> = {}): StrategyInput {
  return {
    mode: "math",
    currentState: "partial",
    priorStudentStates: [],
    priorCoachMoves: [],
    satisfiedProgressBefore: 0,
    satisfiedProgressAfter: 0,
    noProgressStreak: 0,
    uncertainStreak: 0,
    repeatedTargetCount: 0,
    timeRemainingSec: 60,
    attemptCount: 2,
    maxAttempts: 5,
    latestMoveType: "STEP_PROBE_DIRECT",
    latestWrapDecision: null,
    ...overrides,
  };
}

// ============================================================================
// Strategy ladder helpers
// ============================================================================

describe("escalateOne", () => {
  it("moves probe → probe_simpler", () => {
    expect(escalateOne("probe")).toBe("probe_simpler");
  });

  it("moves hint → demonstrate_step", () => {
    expect(escalateOne("hint")).toBe("demonstrate_step");
  });

  it("caps at wrap_support", () => {
    expect(escalateOne("wrap_support")).toBe("wrap_support");
  });
});

// ============================================================================
// inferStrategyFromMove
// ============================================================================

describe("inferStrategyFromMove", () => {
  it("maps math probe moves to probe", () => {
    expect(inferStrategyFromMove("STEP_PROBE_DIRECT", "math")).toBe("probe");
    expect(inferStrategyFromMove("STEP_ACKNOWLEDGE_AND_PROBE", "math")).toBe("probe");
  });

  it("maps STEP_PROBE_SIMPLER to probe_simpler", () => {
    expect(inferStrategyFromMove("STEP_PROBE_SIMPLER", "math")).toBe("probe_simpler");
  });

  it("maps STEP_HINT to hint", () => {
    expect(inferStrategyFromMove("STEP_HINT", "math")).toBe("hint");
  });

  it("maps STEP_DEMONSTRATE_STEP to demonstrate_step", () => {
    expect(inferStrategyFromMove("STEP_DEMONSTRATE_STEP", "math")).toBe("demonstrate_step");
  });

  it("maps WRAP_NEEDS_SUPPORT to wrap_support", () => {
    expect(inferStrategyFromMove("WRAP_NEEDS_SUPPORT", "math")).toBe("wrap_support");
  });

  it("maps explanation moves correctly", () => {
    expect(inferStrategyFromMove("EVIDENCE_PROBE", "explanation")).toBe("probe");
    expect(inferStrategyFromMove("ENCOURAGEMENT_PROBE", "explanation")).toBe("probe_simpler");
    expect(inferStrategyFromMove("HINT", "explanation")).toBe("hint");
    expect(inferStrategyFromMove("MODEL_AND_ASK", "explanation")).toBe("demonstrate_step");
    expect(inferStrategyFromMove("WRAP_SUPPORT", "explanation")).toBe("wrap_support");
  });

  it("falls back to probe for unknown moves", () => {
    expect(inferStrategyFromMove("UNKNOWN_MOVE", "math")).toBe("probe");
  });
});

// ============================================================================
// Strategy → move type mapping
// ============================================================================

describe("mathMoveForStrategy", () => {
  it("maps each strategy to a math move", () => {
    expect(mathMoveForStrategy("probe")).toBe("STEP_PROBE_DIRECT");
    expect(mathMoveForStrategy("probe_simpler")).toBe("STEP_PROBE_SIMPLER");
    expect(mathMoveForStrategy("hint")).toBe("STEP_HINT");
    expect(mathMoveForStrategy("demonstrate_step")).toBe("STEP_DEMONSTRATE_STEP");
    expect(mathMoveForStrategy("guided_completion")).toBe("STEP_MODEL_INSTRUCTION");
    expect(mathMoveForStrategy("wrap_support")).toBe("WRAP_NEEDS_SUPPORT");
  });
});

describe("explanationMoveForStrategy", () => {
  it("maps each strategy to an explanation move", () => {
    expect(explanationMoveForStrategy("probe")).toBe("EVIDENCE_PROBE");
    expect(explanationMoveForStrategy("probe_simpler")).toBe("ENCOURAGEMENT_PROBE");
    expect(explanationMoveForStrategy("hint")).toBe("HINT");
    expect(explanationMoveForStrategy("demonstrate_step")).toBe("MODEL_AND_ASK");
    expect(explanationMoveForStrategy("guided_completion")).toBe("MODEL_AND_ASK");
    expect(explanationMoveForStrategy("wrap_support")).toBe("WRAP_SUPPORT");
  });
});

// ============================================================================
// detectProgress
// ============================================================================

describe("detectProgress", () => {
  it("detects new step satisfaction", () => {
    expect(detectProgress(baseInput({
      satisfiedProgressBefore: 1,
      satisfiedProgressAfter: 2,
    }))).toBe(true);
  });

  it("detects state advancement from uncertain to partial", () => {
    expect(detectProgress(baseInput({
      currentState: "partial",
      priorStudentStates: ["uncertain"],
    }))).toBe(true);
  });

  it("detects error correction", () => {
    expect(detectProgress(baseInput({
      currentState: "partial_evidence",
      priorStudentStates: ["factual_error"],
    }))).toBe(true);
  });

  it("returns false when no progress", () => {
    expect(detectProgress(baseInput({
      satisfiedProgressBefore: 1,
      satisfiedProgressAfter: 1,
      currentState: "uncertain",
      priorStudentStates: ["uncertain"],
    }))).toBe(false);
  });

  it("returns false with no prior states", () => {
    expect(detectProgress(baseInput())).toBe(false);
  });
});

// ============================================================================
// determineConversationStrategy — core rules
// ============================================================================

describe("determineConversationStrategy", () => {
  // ── Rule A: Low time → wrap_support ────────────────────────────────────

  describe("time pressure", () => {
    it("forces wrap_support when time < 15s", () => {
      const decision = determineConversationStrategy(baseInput({
        timeRemainingSec: 10,
      }));
      expect(decision.strategy).toBe("wrap_support");
      expect(decision.reason).toBe("time_remaining_below_15s");
      expect(decision.escalated).toBe(true);
    });

    it("does NOT force wrap_support when time >= 15s", () => {
      const decision = determineConversationStrategy(baseInput({
        timeRemainingSec: 20,
      }));
      expect(decision.strategy).not.toBe("wrap_support");
    });

    it("ignores null time (unlimited)", () => {
      const decision = determineConversationStrategy(baseInput({
        timeRemainingSec: null,
      }));
      expect(decision.strategy).not.toBe("wrap_support");
    });
  });

  // ── Rule B: Frustration ───────────────────────────────────────────────

  describe("frustration", () => {
    it("first frustration escalates to at least hint", () => {
      const decision = determineConversationStrategy(baseInput({
        currentState: "frustrated",
        latestMoveType: "STEP_PROBE_DIRECT",
      }));
      expect(decision.strategy).toBe("hint");
      expect(decision.reason).toBe("first_frustration_escalate_to_hint");
    });

    it("repeated frustration → wrap_support", () => {
      const decision = determineConversationStrategy(baseInput({
        currentState: "frustrated",
        priorStudentStates: ["frustrated", "partial"],
      }));
      expect(decision.strategy).toBe("wrap_support");
      expect(decision.reason).toBe("repeated_frustration_or_low_time");
    });

    it("frustration + low time → wrap_support", () => {
      const decision = determineConversationStrategy(baseInput({
        currentState: "frustrated",
        timeRemainingSec: 25,
      }));
      expect(decision.strategy).toBe("wrap_support");
    });

    it("first frustration doesn't downgrade an existing hint", () => {
      const decision = determineConversationStrategy(baseInput({
        currentState: "frustrated",
        latestMoveType: "STEP_DEMONSTRATE_STEP",
      }));
      // Should keep demonstrate_step (higher than hint)
      expect(decision.strategy).toBe("demonstrate_step");
      expect(decision.escalated).toBe(false);
    });
  });

  // ── Rule C: Uncertainty streak ────────────────────────────────────────

  describe("uncertainty streak", () => {
    it("uncertainStreak=2 escalates to at least hint", () => {
      const decision = determineConversationStrategy(baseInput({
        uncertainStreak: 2,
        latestMoveType: "STEP_PROBE_SIMPLER",
      }));
      expect(decision.strategy).toBe("hint");
      expect(decision.escalated).toBe(true);
    });

    it("uncertainStreak=3 escalates to demonstrate_step", () => {
      const decision = determineConversationStrategy(baseInput({
        uncertainStreak: 3,
        latestMoveType: "STEP_PROBE_SIMPLER",
      }));
      expect(decision.strategy).toBe("demonstrate_step");
      expect(decision.escalated).toBe(true);
    });

    it("uncertainStreak=2 doesn't downgrade a hint", () => {
      const decision = determineConversationStrategy(baseInput({
        uncertainStreak: 2,
        latestMoveType: "STEP_HINT",
      }));
      expect(decision.strategy).toBe("hint");
      expect(decision.escalated).toBe(false);
    });
  });

  // ── Rule D: No-progress streak ────────────────────────────────────────

  describe("no-progress streak", () => {
    it("noProgressStreak=3 escalates to demonstrate_step", () => {
      const decision = determineConversationStrategy(baseInput({
        noProgressStreak: 3,
        latestMoveType: "STEP_HINT",
      }));
      expect(decision.strategy).toBe("demonstrate_step");
      expect(decision.escalated).toBe(true);
    });

    it("noProgressStreak=4 escalates to guided_completion", () => {
      const decision = determineConversationStrategy(baseInput({
        noProgressStreak: 4,
        latestMoveType: "STEP_PROBE_DIRECT",
      }));
      expect(decision.strategy).toBe("guided_completion");
      expect(decision.escalated).toBe(true);
    });
  });

  // ── Rule F: Repeated target ───────────────────────────────────────────

  describe("repeated target", () => {
    it("repeatedTargetCount=3 escalates one above local", () => {
      const decision = determineConversationStrategy(baseInput({
        repeatedTargetCount: 3,
        latestMoveType: "STEP_PROBE_DIRECT",
      }));
      expect(decision.strategy).toBe("probe_simpler");
      expect(decision.escalated).toBe(true);
    });

    it("repeatedTargetCount=3 on hint → demonstrate_step", () => {
      const decision = determineConversationStrategy(baseInput({
        repeatedTargetCount: 3,
        latestMoveType: "STEP_HINT",
      }));
      expect(decision.strategy).toBe("demonstrate_step");
      expect(decision.escalated).toBe(true);
    });
  });

  // ── Rule G: Progress resets escalation ────────────────────────────────

  describe("progress resets escalation", () => {
    it("progress resets to probe", () => {
      const decision = determineConversationStrategy(baseInput({
        satisfiedProgressBefore: 1,
        satisfiedProgressAfter: 2,
        latestMoveType: "STEP_HINT",
      }));
      expect(decision.strategy).toBe("probe");
      expect(decision.escalated).toBe(false);
    });

    it("progress during uncertain state resets to probe_simpler", () => {
      const decision = determineConversationStrategy(baseInput({
        currentState: "uncertain",
        priorStudentStates: ["no_evidence"],
        satisfiedProgressBefore: 0,
        satisfiedProgressAfter: 1,
        latestMoveType: "STEP_HINT",
      }));
      expect(decision.strategy).toBe("probe_simpler");
      expect(decision.escalated).toBe(false);
    });
  });

  // ── Default: no escalation ────────────────────────────────────────────

  describe("default", () => {
    it("returns local strategy when no escalation needed", () => {
      const decision = determineConversationStrategy(baseInput({
        latestMoveType: "STEP_PROBE_DIRECT",
      }));
      expect(decision.strategy).toBe("probe");
      expect(decision.escalated).toBe(false);
      expect(decision.reason).toBe("no_escalation_needed");
    });
  });
});

// ============================================================================
// shouldUpgradeMove
// ============================================================================

describe("shouldUpgradeMove", () => {
  it("returns null when not escalated", () => {
    const decision = determineConversationStrategy(baseInput());
    expect(shouldUpgradeMove(decision, "STEP_PROBE_DIRECT", "math")).toBeNull();
  });

  it("returns upgraded move type for math", () => {
    const decision = { strategy: "hint" as Strategy, reason: "test", escalated: true };
    expect(shouldUpgradeMove(decision, "STEP_PROBE_DIRECT", "math")).toBe("STEP_HINT");
  });

  it("returns upgraded move type for explanation", () => {
    const decision = { strategy: "demonstrate_step" as Strategy, reason: "test", escalated: true };
    expect(shouldUpgradeMove(decision, "EVIDENCE_PROBE", "explanation")).toBe("MODEL_AND_ASK");
  });

  it("returns null when target strategy is not above local", () => {
    const decision = { strategy: "probe" as Strategy, reason: "test", escalated: true };
    expect(shouldUpgradeMove(decision, "STEP_HINT", "math")).toBeNull();
  });
});

// ============================================================================
// Transcript-style multi-turn scenarios
// ============================================================================

describe("math multi-turn: repeated 'I don't know'", () => {
  it("escalates probe_simpler → hint → demonstrate_step over 3 uncertain turns", () => {
    // Turn 1: first uncertain
    const d1 = determineConversationStrategy(baseInput({
      uncertainStreak: 0,
      noProgressStreak: 0,
      latestMoveType: "STEP_PROBE_SIMPLER",
    }));
    // No escalation yet, local is probe_simpler
    expect(d1.strategy).toBe("probe_simpler");

    // Turn 2: second consecutive uncertain
    const d2 = determineConversationStrategy(baseInput({
      uncertainStreak: 2,
      noProgressStreak: 2,
      priorStudentStates: ["uncertain", "uncertain"],
      priorCoachMoves: ["STEP_PROBE_SIMPLER", "STEP_PROBE_SIMPLER"],
      latestMoveType: "STEP_PROBE_SIMPLER",
    }));
    expect(d2.strategy).toBe("hint");
    expect(d2.escalated).toBe(true);

    // Turn 3: third consecutive uncertain
    const d3 = determineConversationStrategy(baseInput({
      uncertainStreak: 3,
      noProgressStreak: 3,
      priorStudentStates: ["uncertain", "uncertain", "uncertain"],
      priorCoachMoves: ["STEP_PROBE_SIMPLER", "STEP_PROBE_SIMPLER", "STEP_HINT"],
      latestMoveType: "STEP_HINT",
    }));
    expect(d3.strategy).toBe("demonstrate_step");
    expect(d3.escalated).toBe(true);
  });
});

describe("math multi-turn: repeated vague answers don't stay stuck", () => {
  it("no-progress streak of 3 forces at least demonstrate_step", () => {
    const decision = determineConversationStrategy(baseInput({
      noProgressStreak: 3,
      repeatedTargetCount: 3,
      priorStudentStates: ["partial", "partial", "partial"],
      priorCoachMoves: ["STEP_PROBE_DIRECT", "STEP_PROBE_DIRECT", "STEP_PROBE_SIMPLER"],
      latestMoveType: "STEP_PROBE_SIMPLER",
    }));
    expect(decision.strategy).toBe("demonstrate_step");
  });
});

describe("math multi-turn: same target → demonstration or guided completion", () => {
  it("repeatedTargetCount=3 on probe → probe_simpler", () => {
    const d1 = determineConversationStrategy(baseInput({
      repeatedTargetCount: 3,
      latestMoveType: "STEP_PROBE_DIRECT",
    }));
    expect(d1.strategy).toBe("probe_simpler");
  });

  it("repeatedTargetCount=3 on demonstrate_step → guided_completion", () => {
    const d2 = determineConversationStrategy(baseInput({
      repeatedTargetCount: 3,
      latestMoveType: "STEP_DEMONSTRATE_STEP",
    }));
    expect(d2.strategy).toBe("guided_completion");
  });
});

describe("explanation multi-turn: claim-only escalation", () => {
  it("escalates specificity probe → hint → model after no-progress", () => {
    // Turn 1: claim only, no progress streak 0
    const d1 = determineConversationStrategy(baseInput({
      mode: "explanation",
      currentState: "claim_only",
      noProgressStreak: 0,
      latestMoveType: "SPECIFICITY_PROBE",
    }));
    expect(d1.strategy).toBe("probe");

    // Turn 2: claim only, no progress streak 2, uncertainty streak 2
    const d2 = determineConversationStrategy(baseInput({
      mode: "explanation",
      currentState: "claim_only",
      noProgressStreak: 2,
      uncertainStreak: 2,
      latestMoveType: "SPECIFICITY_PROBE",
    }));
    expect(d2.strategy).toBe("hint");
    expect(d2.escalated).toBe(true);

    // Turn 3: claim only, no progress streak 3
    const d3 = determineConversationStrategy(baseInput({
      mode: "explanation",
      currentState: "claim_only",
      noProgressStreak: 3,
      uncertainStreak: 3,
      latestMoveType: "HINT",
    }));
    expect(d3.strategy).toBe("demonstrate_step");
    expect(d3.escalated).toBe(true);
  });
});

describe("explanation multi-turn: no-evidence doesn't repeat forever", () => {
  it("no-progress streak 4 → guided_completion", () => {
    const decision = determineConversationStrategy(baseInput({
      mode: "explanation",
      currentState: "no_evidence",
      noProgressStreak: 4,
      latestMoveType: "ENCOURAGEMENT_PROBE",
    }));
    expect(decision.strategy).toBe("guided_completion");
    expect(decision.escalated).toBe(true);
  });
});

describe("explanation multi-turn: progress resets escalation", () => {
  it("resets to probe after student makes progress", () => {
    const decision = determineConversationStrategy(baseInput({
      mode: "explanation",
      currentState: "partial_evidence",
      priorStudentStates: ["claim_only"],
      satisfiedProgressBefore: 0,
      satisfiedProgressAfter: 1,
      noProgressStreak: 0,
      latestMoveType: "HINT",
    }));
    expect(decision.strategy).toBe("probe");
    expect(decision.escalated).toBe(false);
  });
});
