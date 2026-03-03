import {
  computeVideoCoachAction,
  resolvePostEvaluation,
  deriveVideoOutcome,
  isLowConfidenceResponse,
  parseHintResponse,
  isHintRequest,
  isNoSpeech,
  isFrustrationSignal,
  isSubstantiveAnswer,
  isRestateQuestionRequest,
  containsEndingLanguage,
  containsCorrectLanguage,
  buildRetryPrompt,
  classifyStudentUtterance,
  CORRECT_THRESHOLD,
  VideoCoachState,
} from "./videoCoachStateMachine";

// Helper to build a default state
function makeState(overrides: Partial<VideoCoachState> = {}): VideoCoachState {
  return {
    latestStudentResponse: "",
    attemptCount: 0,
    hintOfferPending: false,
    hintIndex: 0,
    hintDeclineCount: 0,
    hintsAvailable: ["Think about what happens when you add the numbers together."],
    maxAttempts: 3,
    questionText: "What is 2 + 4?",
    followUpCount: 0,
    ...overrides,
  };
}

// ============================================================================
// computeVideoCoachAction
// ============================================================================

describe("computeVideoCoachAction", () => {
  test("1. 'I don't know' first attempt, hints available → OFFER_HINT, shouldContinue=true", () => {
    const action = computeVideoCoachAction(
      makeState({ latestStudentResponse: "I don't know" })
    );
    expect(action.type).toBe("OFFER_HINT");
    expect(action.shouldContinue).toBe(true);
    expect(action.response).toContain("hint");
    expect(action.stateUpdates.hintOfferPending).toBe(true);
  });

  test("2. Hint accepted → DELIVER_HINT with re-prompt text, shouldContinue=true", () => {
    const action = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "Yes please",
        hintOfferPending: true,
        hintIndex: 0,
      })
    );
    expect(action.type).toBe("DELIVER_HINT");
    expect(action.shouldContinue).toBe(true);
    expect(action.response).toContain("Here's a hint:");
    expect(action.response).toContain("can you try answering the question again?");
    expect(action.stateUpdates.hintUsed).toBe(true);
    expect(action.stateUpdates.hintIndex).toBe(1);
  });

  test("3. Low confidence, hints exhausted, attempts remain → ASK_RETRY, shouldContinue=true", () => {
    const action = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "idk",
        attemptCount: 1,
        hintIndex: 1, // all hints used
        hintsAvailable: ["hint1"],
        maxAttempts: 3,
      })
    );
    expect(action.type).toBe("ASK_RETRY");
    expect(action.shouldContinue).toBe(true);
    expect(action.response).toContain("try");
  });

  test("4. Low confidence, max attempts → MARK_DEVELOPING, shouldContinue=false", () => {
    const action = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "I don't know",
        attemptCount: 2,
        hintIndex: 1,
        hintsAvailable: ["hint1"],
        maxAttempts: 3,
      })
    );
    expect(action.type).toBe("MARK_DEVELOPING");
    expect(action.shouldContinue).toBe(false);
    expect(action.endReason).toBe("max-attempts");
  });

  test("5. Never completes on first failed attempt (attemptCount=0 → never MARK_DEVELOPING)", () => {
    const action = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "I don't know",
        attemptCount: 0,
        hintIndex: 1,
        hintsAvailable: ["hint1"], // hints exhausted
        hintDeclineCount: 2, // max declines reached
        maxAttempts: 3,
      })
    );
    // Should ASK_RETRY, not MARK_DEVELOPING
    expect(action.type).toBe("ASK_RETRY");
    expect(action.shouldContinue).toBe(true);
    expect(action.type).not.toBe("MARK_DEVELOPING");
  });

  test("6. Substantive response → EVALUATE_ANSWER", () => {
    const action = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "I think the answer is 6 because 2 plus 4 equals 6",
      })
    );
    expect(action.type).toBe("EVALUATE_ANSWER");
    expect(action.shouldContinue).toBe(true);
  });

  test("7. Hint declined once → RETRY_AFTER_DECLINE", () => {
    const action = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "No thanks",
        hintOfferPending: true,
        hintDeclineCount: 0,
      })
    );
    expect(action.type).toBe("RETRY_AFTER_DECLINE");
    expect(action.shouldContinue).toBe(true);
    expect(action.stateUpdates.hintDeclineCount).toBe(1);
    expect(action.stateUpdates.hintOfferPending).toBe(true);
  });

  test("8. Hint declined twice, attemptCount >= 2 → END_AFTER_DECLINE", () => {
    const action = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "No",
        hintOfferPending: true,
        hintDeclineCount: 1,
        attemptCount: 2,
      })
    );
    expect(action.type).toBe("END_AFTER_DECLINE");
    expect(action.shouldContinue).toBe(false);
    expect(action.endReason).toBe("declined-hints");
    expect(action.stateUpdates.hintDeclineCount).toBe(2);
  });

  test("9. Unclear hint response → falls through to low-confidence check", () => {
    const action = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "hmm",
        hintOfferPending: true,
        hintDeclineCount: 0,
      })
    );
    // "hmm" is short and unclear, so after clearing hintOfferPending it should
    // detect low confidence and OFFER_HINT again
    expect(action.type).toBe("OFFER_HINT");
    expect(action.shouldContinue).toBe(true);
  });

  test("10. BUG REPRO: 'I don't know' on attempt 0, no hints → ASK_RETRY (NOT end)", () => {
    const action = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "I don't know",
        attemptCount: 0,
        hintsAvailable: [], // no hints available
        maxAttempts: 3,
      })
    );
    expect(action.type).toBe("ASK_RETRY");
    expect(action.shouldContinue).toBe(true);
    // This is the critical bug fix: should NOT be MARK_DEVELOPING or end
    expect(action.type).not.toBe("MARK_DEVELOPING");
    expect(action.shouldContinue).not.toBe(false);
  });

  // --- attemptCount: only actual answers increment, hint meta-conversation does not ---

  test("11. OFFER_HINT does NOT increment attemptCount", () => {
    const action = computeVideoCoachAction(
      makeState({ latestStudentResponse: "I don't know", attemptCount: 0 })
    );
    expect(action.type).toBe("OFFER_HINT");
    expect(action.stateUpdates.attemptCount).toBe(0);
  });

  test("12. DELIVER_HINT does NOT increment attemptCount", () => {
    const action = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "Yes please",
        hintOfferPending: true,
        attemptCount: 0,
      })
    );
    expect(action.type).toBe("DELIVER_HINT");
    expect(action.stateUpdates.attemptCount).toBe(0);
  });

  test("13. RETRY_AFTER_DECLINE does NOT increment attemptCount", () => {
    const action = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "No thanks",
        hintOfferPending: true,
        hintDeclineCount: 0,
        attemptCount: 0,
      })
    );
    expect(action.type).toBe("RETRY_AFTER_DECLINE");
    expect(action.stateUpdates.attemptCount).toBe(0);
  });

  test("14. END_AFTER_DECLINE does NOT increment attemptCount", () => {
    const action = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "No",
        hintOfferPending: true,
        hintDeclineCount: 1,
        attemptCount: 2, // must be >= MIN_ATTEMPTS_BEFORE_FAIL for END_AFTER_DECLINE
      })
    );
    expect(action.type).toBe("END_AFTER_DECLINE");
    expect(action.stateUpdates.attemptCount).toBe(2);
  });

  test("15. EVALUATE_ANSWER DOES increment attemptCount", () => {
    const action = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "I think the answer is 6 because 2 plus 4 equals 6",
        attemptCount: 0,
      })
    );
    expect(action.type).toBe("EVALUATE_ANSWER");
    expect(action.stateUpdates.attemptCount).toBe(1);
  });

  test("16. ASK_RETRY DOES increment attemptCount", () => {
    const action = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "idk",
        attemptCount: 0,
        hintsAvailable: [], // no hints
        maxAttempts: 3,
      })
    );
    expect(action.type).toBe("ASK_RETRY");
    expect(action.stateUpdates.attemptCount).toBe(1);
  });

  test("17. Full hint flow: attempt count stays 0 through offer→accept→deliver", () => {
    // Step 1: "I don't know" → OFFER_HINT
    const step1 = computeVideoCoachAction(
      makeState({ latestStudentResponse: "I don't know", attemptCount: 0 })
    );
    expect(step1.type).toBe("OFFER_HINT");
    expect(step1.stateUpdates.attemptCount).toBe(0);

    // Step 2: "yes" → DELIVER_HINT
    const step2 = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "yes",
        attemptCount: step1.stateUpdates.attemptCount,
        hintOfferPending: step1.stateUpdates.hintOfferPending,
        hintIndex: step1.stateUpdates.hintIndex,
        hintDeclineCount: step1.stateUpdates.hintDeclineCount,
      })
    );
    expect(step2.type).toBe("DELIVER_HINT");
    expect(step2.stateUpdates.attemptCount).toBe(0);

    // Step 3: Substantive answer → EVALUATE_ANSWER (NOW it increments)
    const step3 = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "I think the answer is 6",
        attemptCount: step2.stateUpdates.attemptCount,
        hintOfferPending: step2.stateUpdates.hintOfferPending,
        hintIndex: step2.stateUpdates.hintIndex,
        hintDeclineCount: step2.stateUpdates.hintDeclineCount,
      })
    );
    expect(step3.type).toBe("EVALUATE_ANSWER");
    expect(step3.stateUpdates.attemptCount).toBe(1);
  });
});

// ============================================================================
// resolvePostEvaluation
// ============================================================================

describe("resolvePostEvaluation", () => {
  test("1. score >= 80, followUpCount=0 → shouldContinue=true, probeFirst=true (probe before advancing)", () => {
    const result = resolvePostEvaluation(
      { score: 85, isCorrect: true, shouldContinue: false },
      1,
      3,
      0
    );
    expect(result.shouldContinue).toBe(true);
    expect(result.probeFirst).toBe(true);
  });

  test("1b. score >= 80, followUpCount=1 → shouldContinue=false, probeFirst=false (already probed)", () => {
    const result = resolvePostEvaluation(
      { score: 85, isCorrect: true, shouldContinue: false },
      1,
      3,
      1
    );
    expect(result.shouldContinue).toBe(false);
    expect(result.probeFirst).toBe(false);
  });

  test("2. score < 80, attemptCount=0 → shouldContinue=true (first attempt guardrail)", () => {
    const result = resolvePostEvaluation(
      { score: 40, isCorrect: false, shouldContinue: false },
      0,
      3,
      0
    );
    expect(result.shouldContinue).toBe(true);
    expect(result.probeFirst).toBe(false);
  });

  test("3. score < 80, attemptCount=2, max=3 → shouldContinue=false (max reached)", () => {
    const result = resolvePostEvaluation(
      { score: 50, isCorrect: false, shouldContinue: true },
      2,
      3,
      0
    );
    expect(result.shouldContinue).toBe(false);
    expect(result.probeFirst).toBe(false);
  });

  test("4. score < 80, attemptCount=1, max=3 → shouldContinue=true (keep trying)", () => {
    const result = resolvePostEvaluation(
      { score: 60, isCorrect: false, shouldContinue: false },
      1,
      3,
      0
    );
    expect(result.shouldContinue).toBe(true);
    expect(result.probeFirst).toBe(false);
  });

  test("score exactly at threshold, followUpCount=0 → probeFirst=true", () => {
    const result = resolvePostEvaluation(
      { score: CORRECT_THRESHOLD, isCorrect: true, shouldContinue: true },
      0,
      3,
      0
    );
    expect(result.shouldContinue).toBe(true);
    expect(result.probeFirst).toBe(true);
  });

  test("score exactly at threshold, followUpCount=1 → shouldContinue=false", () => {
    const result = resolvePostEvaluation(
      { score: CORRECT_THRESHOLD, isCorrect: true, shouldContinue: true },
      0,
      3,
      1
    );
    expect(result.shouldContinue).toBe(false);
    expect(result.probeFirst).toBe(false);
  });
});

// ============================================================================
// deriveVideoOutcome
// ============================================================================

describe("deriveVideoOutcome", () => {
  test("1. score=90, no hints → { score: 90, isCorrect: true } (→ 'demonstrated')", () => {
    const outcome = deriveVideoOutcome({
      lastScore: 90,
      hintUsed: false,
    });
    expect(outcome.score).toBe(90);
    expect(outcome.isCorrect).toBe(true);
    expect(outcome.endReason).toBeUndefined();
  });

  test("2. score=85, hints used → { score: 85, isCorrect: true } (→ 'with-support')", () => {
    const outcome = deriveVideoOutcome({
      lastScore: 85,
      hintUsed: true,
    });
    expect(outcome.score).toBe(85);
    expect(outcome.isCorrect).toBe(true);
  });

  test("3. score=60 → { score: 60, isCorrect: false } (→ 'developing')", () => {
    const outcome = deriveVideoOutcome({
      lastScore: 60,
      hintUsed: false,
    });
    expect(outcome.score).toBe(60);
    expect(outcome.isCorrect).toBe(false);
  });

  test("4. endReason='max-attempts' → { score: undefined, isCorrect: false } (→ 'needs-review')", () => {
    const outcome = deriveVideoOutcome({
      lastScore: undefined,
      hintUsed: false,
      endReason: "max-attempts",
    });
    expect(outcome.score).toBeUndefined();
    expect(outcome.isCorrect).toBe(false);
    expect(outcome.endReason).toBe("max-attempts");
  });

  test("5. endReason='declined-hints' → { score: undefined, isCorrect: false } (→ 'needs-review')", () => {
    const outcome = deriveVideoOutcome({
      lastScore: undefined,
      hintUsed: false,
      endReason: "declined-hints",
    });
    expect(outcome.score).toBeUndefined();
    expect(outcome.isCorrect).toBe(false);
    expect(outcome.endReason).toBe("declined-hints");
  });

  test("6. no score, no endReason → { score: undefined, isCorrect: false } (→ 'needs-review')", () => {
    const outcome = deriveVideoOutcome({
      lastScore: undefined,
      hintUsed: false,
    });
    expect(outcome.score).toBeUndefined();
    expect(outcome.isCorrect).toBe(false);
    expect(outcome.endReason).toBe("no-score");
  });

  test("endReason='max-attempts' takes priority even if lastScore is defined", () => {
    const outcome = deriveVideoOutcome({
      lastScore: 50,
      hintUsed: false,
      endReason: "max-attempts",
    });
    // endReason takes priority — no score propagated
    expect(outcome.score).toBeUndefined();
    expect(outcome.isCorrect).toBe(false);
  });
});

// ============================================================================
// isLowConfidenceResponse
// ============================================================================

describe("isLowConfidenceResponse", () => {
  test("'I don't know' → true", () => {
    expect(isLowConfidenceResponse("I don't know")).toBe(true);
  });

  test("'idk' → true", () => {
    expect(isLowConfidenceResponse("idk")).toBe(true);
  });

  test("empty string → true", () => {
    expect(isLowConfidenceResponse("")).toBe(true);
  });

  test("very short non-answer → true", () => {
    expect(isLowConfidenceResponse("hmm")).toBe(true);
  });

  test("'I think the answer is 6 because...' → false", () => {
    expect(
      isLowConfidenceResponse("I think the answer is 6 because you add them")
    ).toBe(false);
  });

  test("'42' → false (valid short numeric answer)", () => {
    expect(isLowConfidenceResponse("42")).toBe(false);
  });

  test("'yes' → false (valid short answer)", () => {
    expect(isLowConfidenceResponse("yes")).toBe(false);
  });

  test("'no' → false (valid short answer)", () => {
    expect(isLowConfidenceResponse("no")).toBe(false);
  });

  test("'um' → true", () => {
    expect(isLowConfidenceResponse("um")).toBe(true);
  });

  test("'I'm not sure' → true", () => {
    expect(isLowConfidenceResponse("I'm not sure")).toBe(true);
  });

  test("'no speech detected' → true", () => {
    expect(isLowConfidenceResponse("no speech detected")).toBe(true);
  });

  test("'?' → true", () => {
    expect(isLowConfidenceResponse("?")).toBe(true);
  });
});

// ============================================================================
// parseHintResponse
// ============================================================================

describe("parseHintResponse", () => {
  test("'yes' → accept", () => {
    expect(parseHintResponse("yes")).toBe("accept");
  });

  test("'yeah' → accept", () => {
    expect(parseHintResponse("yeah")).toBe("accept");
  });

  test("'sure' → accept", () => {
    expect(parseHintResponse("sure")).toBe("accept");
  });

  test("'no' → decline", () => {
    expect(parseHintResponse("no")).toBe("decline");
  });

  test("'nah' → decline", () => {
    expect(parseHintResponse("nah")).toBe("decline");
  });

  test("'let me try' → decline", () => {
    expect(parseHintResponse("let me try")).toBe("decline");
  });

  test("'I think the answer is 5' → unclear", () => {
    expect(parseHintResponse("I think the answer is 5")).toBe("unclear");
  });

  test("'please' → accept", () => {
    expect(parseHintResponse("please")).toBe("accept");
  });

  test("'how many hints do you have' → inquire", () => {
    expect(parseHintResponse("how many hints do you have")).toBe("inquire");
  });

  test("'what hints do you have' → inquire", () => {
    expect(parseHintResponse("what hints do you have")).toBe("inquire");
  });

  test("'do you have any hints' → inquire", () => {
    expect(parseHintResponse("do you have any hints")).toBe("inquire");
  });

  test("'tell me the hints' → inquire", () => {
    expect(parseHintResponse("tell me the hints")).toBe("inquire");
  });

  test("'can I get a hint first' → inquire", () => {
    expect(parseHintResponse("can I get a hint first")).toBe("inquire");
  });

  test("'are there hints' → inquire", () => {
    expect(parseHintResponse("are there hints")).toBe("inquire");
  });
});

// ============================================================================
// isHintRequest
// ============================================================================

describe("isHintRequest", () => {
  test("'hint' → true", () => {
    expect(isHintRequest("hint")).toBe(true);
  });

  test("'another hint' → true", () => {
    expect(isHintRequest("another hint")).toBe(true);
  });

  test("'more hints' → true", () => {
    expect(isHintRequest("more hints")).toBe(true);
  });

  test("'do you have any more hints' → true", () => {
    expect(isHintRequest("do you have any more hints")).toBe(true);
  });

  test("'can I have a hint' → true", () => {
    expect(isHintRequest("can I have a hint")).toBe(true);
  });

  test("'can you give me another hint' → true", () => {
    expect(isHintRequest("can you give me another hint")).toBe(true);
  });

  test("'help me' → true", () => {
    expect(isHintRequest("help me")).toBe(true);
  });

  test("'give me a clue' → true", () => {
    expect(isHintRequest("give me a clue")).toBe(true);
  });

  test("'I think the answer is 6' → false", () => {
    expect(isHintRequest("I think the answer is 6")).toBe(false);
  });

  test("'I don't know' → false (low confidence, not hint request)", () => {
    expect(isHintRequest("I don't know")).toBe(false);
  });

  test("'yes' → false", () => {
    expect(isHintRequest("yes")).toBe(false);
  });

  test("'how many hints do you have' → true", () => {
    expect(isHintRequest("how many hints do you have")).toBe(true);
  });

  test("'hints' (plural) → true", () => {
    expect(isHintRequest("hints")).toBe(true);
  });

  test("'give me hints' → true", () => {
    expect(isHintRequest("give me hints")).toBe(true);
  });
});

// ============================================================================
// isNoSpeech
// ============================================================================

describe("isNoSpeech", () => {
  test("'(no speech detected)' → true", () => {
    expect(isNoSpeech("(no speech detected)")).toBe(true);
  });

  test("'no speech detected' → true", () => {
    expect(isNoSpeech("no speech detected")).toBe(true);
  });

  test("empty string → true", () => {
    expect(isNoSpeech("")).toBe(true);
  });

  test("'I don't know' → false", () => {
    expect(isNoSpeech("I don't know")).toBe(false);
  });

  test("'hello' → false", () => {
    expect(isNoSpeech("hello")).toBe(false);
  });
});

// ============================================================================
// containsEndingLanguage
// ============================================================================

describe("containsEndingLanguage", () => {
  test("'Let's move on to the next question' → true", () => {
    expect(containsEndingLanguage("Let's move on to the next question")).toBe(true);
  });

  test("'You've completed this section' → true", () => {
    expect(containsEndingLanguage("You've completed this section")).toBe(true);
  });

  test("'You can revisit this later' → true", () => {
    expect(containsEndingLanguage("You can revisit this later")).toBe(true);
  });

  test("'We're done with this question' → true", () => {
    expect(containsEndingLanguage("We're done with this question")).toBe(true);
  });

  test("'That's a great try! Can you think of another reason?' → false", () => {
    expect(containsEndingLanguage("That's a great try! Can you think of another reason?")).toBe(false);
  });

  test("'Not quite — try again!' → false", () => {
    expect(containsEndingLanguage("Not quite — try again!")).toBe(false);
  });
});

// ============================================================================
// computeVideoCoachAction — hint requests and no-speech
// ============================================================================

describe("computeVideoCoachAction — hint requests", () => {
  test("'do you have any more hints' after hint delivery → DELIVER_HINT if hints remain", () => {
    const action = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "do you have any more hints",
        hintIndex: 1,
        hintsAvailable: ["hint1", "hint2"],
        attemptCount: 0,
      })
    );
    expect(action.type).toBe("DELIVER_HINT");
    expect(action.shouldContinue).toBe(true);
    expect(action.response).toContain("Here's a hint:");
    expect(action.response).toContain("can you try answering the question again?");
    expect(action.stateUpdates.hintUsed).toBe(true);
    expect(action.stateUpdates.hintIndex).toBe(2);
    expect(action.stateUpdates.attemptCount).toBe(0); // no increment
  });

  test("'more hints' when no hints remain → ASK_RETRY (not evaluation)", () => {
    const action = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "more hints please",
        hintIndex: 1,
        hintsAvailable: ["hint1"], // all used
        attemptCount: 0,
      })
    );
    expect(action.type).toBe("ASK_RETRY");
    expect(action.shouldContinue).toBe(true);
    expect(action.response).toContain("don't have more hints");
    expect(action.stateUpdates.attemptCount).toBe(0); // no increment
  });

  test("hint request does NOT trigger EVALUATE_ANSWER", () => {
    const action = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "can I have another hint",
        hintIndex: 0,
        hintsAvailable: ["hint1"],
        attemptCount: 0,
      })
    );
    expect(action.type).not.toBe("EVALUATE_ANSWER");
  });
});

describe("computeVideoCoachAction — no speech detected", () => {
  test("'(no speech detected)' with hints → OFFER_HINT, no attempt increment", () => {
    const action = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "(no speech detected)",
        attemptCount: 0,
        hintIndex: 0,
        hintsAvailable: ["hint1"],
      })
    );
    expect(action.type).toBe("OFFER_HINT");
    expect(action.shouldContinue).toBe(true);
    expect(action.response).toContain("didn't catch that");
    expect(action.stateUpdates.attemptCount).toBe(0);
  });

  test("'(no speech detected)' without hints → ASK_RETRY, no attempt increment", () => {
    const action = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "(no speech detected)",
        attemptCount: 0,
        hintsAvailable: [],
      })
    );
    expect(action.type).toBe("ASK_RETRY");
    expect(action.shouldContinue).toBe(true);
    expect(action.response).toContain("didn't catch that");
    expect(action.stateUpdates.attemptCount).toBe(0);
  });

  test("empty string → same as no speech, no attempt increment", () => {
    const action = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "",
        attemptCount: 1,
        hintsAvailable: [],
      })
    );
    expect(action.shouldContinue).toBe(true);
    expect(action.stateUpdates.attemptCount).toBe(1); // unchanged
  });

  test("'(no speech detected)' never ends the conversation", () => {
    const action = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "(no speech detected)",
        attemptCount: 2,
        maxAttempts: 3,
        hintsAvailable: [],
      })
    );
    expect(action.shouldContinue).toBe(true);
    expect(action.type).not.toBe("MARK_DEVELOPING");
    expect(action.type).not.toBe("END_AFTER_DECLINE");
  });
});

// ============================================================================
// isRestateQuestionRequest
// ============================================================================

describe("isRestateQuestionRequest", () => {
  test("'what was the question' → true", () => {
    expect(isRestateQuestionRequest("what was the question")).toBe(true);
  });

  test("'can you repeat the question' → true", () => {
    expect(isRestateQuestionRequest("can you repeat the question")).toBe(true);
  });

  test("'say the question again' → true", () => {
    expect(isRestateQuestionRequest("say the question again")).toBe(true);
  });

  test("'restate the question' → true", () => {
    expect(isRestateQuestionRequest("restate the question")).toBe(true);
  });

  test("'what did you ask' → true", () => {
    expect(isRestateQuestionRequest("what did you ask")).toBe(true);
  });

  test("'read it again' → true", () => {
    expect(isRestateQuestionRequest("read it again")).toBe(true);
  });

  test("'i forgot the question' → true", () => {
    expect(isRestateQuestionRequest("i forgot the question")).toBe(true);
  });

  test("'I think the answer is 6' → false", () => {
    expect(isRestateQuestionRequest("I think the answer is 6")).toBe(false);
  });

  test("'yes' → false", () => {
    expect(isRestateQuestionRequest("yes")).toBe(false);
  });

  test("'I don't know' → false", () => {
    expect(isRestateQuestionRequest("I don't know")).toBe(false);
  });
});

// ============================================================================
// computeVideoCoachAction — hint inquiry (hintOfferPending + "how many hints")
// ============================================================================

describe("computeVideoCoachAction — hint inquiry", () => {
  test("'how many hints do you have' during hint offer → HINT_INQUIRY_RESPONSE, shouldContinue=true", () => {
    const action = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "how many hints do you have",
        hintOfferPending: true,
        hintIndex: 0,
        hintsAvailable: ["hint1", "hint2"],
        attemptCount: 0,
      })
    );
    expect(action.type).toBe("HINT_INQUIRY_RESPONSE");
    expect(action.shouldContinue).toBe(true);
    expect(action.response).toContain("2 hints");
    expect(action.stateUpdates.hintOfferPending).toBe(true);
    expect(action.stateUpdates.attemptCount).toBe(0);
  });

  test("hint inquiry with 1 remaining hint → singular 'hint'", () => {
    const action = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "do you have any hints",
        hintOfferPending: true,
        hintIndex: 0,
        hintsAvailable: ["hint1"],
        attemptCount: 0,
      })
    );
    expect(action.type).toBe("HINT_INQUIRY_RESPONSE");
    expect(action.response).toContain("1 hint");
    expect(action.response).not.toContain("1 hints");
  });

  test("hint inquiry with no remaining hints → tells student no hints", () => {
    const action = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "what hints do you have",
        hintOfferPending: true,
        hintIndex: 1,
        hintsAvailable: ["hint1"],
        attemptCount: 0,
      })
    );
    expect(action.type).toBe("HINT_INQUIRY_RESPONSE");
    expect(action.response).toContain("don't have any more hints");
    expect(action.stateUpdates.hintOfferPending).toBe(false);
  });

  test("hint inquiry does NOT increment attemptCount", () => {
    const action = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "tell me the hints",
        hintOfferPending: true,
        hintIndex: 0,
        hintsAvailable: ["hint1"],
        attemptCount: 1,
      })
    );
    expect(action.stateUpdates.attemptCount).toBe(1);
  });
});

// ============================================================================
// computeVideoCoachAction — restate question
// ============================================================================

describe("computeVideoCoachAction — restate question", () => {
  test("'what was the question' → REPEAT_QUESTION with question text", () => {
    const action = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "what was the question",
        questionText: "What is 2 + 4?",
      })
    );
    expect(action.type).toBe("REPEAT_QUESTION");
    expect(action.shouldContinue).toBe(true);
    expect(action.response).toContain("What is 2 + 4?");
    expect(action.stateUpdates.attemptCount).toBe(0);
  });

  test("restate question preserves hintOfferPending=true", () => {
    const action = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "can you repeat the question",
        hintOfferPending: true,
        questionText: "What is 2 + 4?",
      })
    );
    // "can you repeat the question" → parseHintResponse returns "unclear" → falls through
    // → isNoSpeech false → isRestateQuestionRequest true → REPEAT_QUESTION
    expect(action.type).toBe("REPEAT_QUESTION");
    expect(action.stateUpdates.hintOfferPending).toBe(true);
  });

  test("restate question preserves hintOfferPending=false", () => {
    const action = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "what did you ask",
        hintOfferPending: false,
      })
    );
    expect(action.type).toBe("REPEAT_QUESTION");
    expect(action.stateUpdates.hintOfferPending).toBe(false);
  });
});

// ============================================================================
// computeVideoCoachAction — attemptCount=0 guardrails
// ============================================================================

describe("computeVideoCoachAction — attemptCount=0 guardrails", () => {
  test("END_AFTER_DECLINE blocked when attemptCount=0 → ASK_RETRY instead", () => {
    const action = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "No",
        hintOfferPending: true,
        hintDeclineCount: 1,
        attemptCount: 0,
      })
    );
    // Would normally be END_AFTER_DECLINE, but guardrail blocks it
    expect(action.type).toBe("ASK_RETRY");
    expect(action.shouldContinue).toBe(true);
    expect(action.stateUpdates.attemptCount).toBe(0);
  });

  test("END_AFTER_DECLINE allowed when attemptCount >= 2", () => {
    const action = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "No",
        hintOfferPending: true,
        hintDeclineCount: 1,
        attemptCount: 2,
      })
    );
    expect(action.type).toBe("END_AFTER_DECLINE");
    expect(action.shouldContinue).toBe(false);
  });

  test("MARK_DEVELOPING blocked when attemptCount=0, maxAttempts=1 → ASK_RETRY", () => {
    const action = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "I don't know",
        attemptCount: 0,
        hintsAvailable: [],
        maxAttempts: 1, // edge case: very low maxAttempts
      })
    );
    expect(action.type).toBe("ASK_RETRY");
    expect(action.shouldContinue).toBe(true);
  });

  test("'I still don't know' on first real attempt → shouldContinue=true", () => {
    // After one hint was delivered, student still doesn't know
    const action = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "I still don't know",
        attemptCount: 0,
        hintIndex: 1,
        hintsAvailable: ["hint1"],
        hintDeclineCount: 2,
        maxAttempts: 3,
      })
    );
    expect(action.shouldContinue).toBe(true);
    expect(action.type).not.toBe("MARK_DEVELOPING");
    expect(action.type).not.toBe("END_AFTER_DECLINE");
  });
});

// ============================================================================
// Integration: full multi-step flows through the state machine
// ============================================================================

describe("integration — full flow: hint inquiry keeps conversation alive", () => {
  test("'I don't know' → hint offer → 'how many hints' → shouldContinue=true + hintOfferPending=true", () => {
    const hints = ["Think about adding the numbers.", "Try counting on your fingers."];

    // Step 1: Student says "I don't know"
    const step1 = computeVideoCoachAction(
      makeState({ latestStudentResponse: "I don't know", attemptCount: 0, hintsAvailable: hints })
    );
    expect(step1.type).toBe("OFFER_HINT");
    expect(step1.shouldContinue).toBe(true);
    expect(step1.stateUpdates.hintOfferPending).toBe(true);
    expect(step1.stateUpdates.attemptCount).toBe(0);

    // Step 2: Student asks "how many hints do you have"
    // VideoConversationRecorder would call startStudentTurn() because shouldContinue=true.
    // Student speaks, clicks Done Speaking, handleDoneSpeaking runs again.
    const step2 = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "how many hints do you have",
        attemptCount: step1.stateUpdates.attemptCount,
        hintOfferPending: step1.stateUpdates.hintOfferPending,
        hintIndex: step1.stateUpdates.hintIndex,
        hintDeclineCount: step1.stateUpdates.hintDeclineCount,
        hintsAvailable: hints,
      })
    );
    expect(step2.type).toBe("HINT_INQUIRY_RESPONSE");
    expect(step2.shouldContinue).toBe(true);
    // awaitingStudent would be true: VideoConversationRecorder calls startStudentTurn()
    // when shouldContinue=true, setting phase="student_turn" → UI shows mic + "Done Speaking"
    expect(step2.stateUpdates.hintOfferPending).toBe(true); // still offering
    expect(step2.stateUpdates.attemptCount).toBe(0); // no increment — meta-conversation
    expect(step2.response).toContain("2 hints");

    // Step 3: Student says "yes" (accepts hint)
    const step3 = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "yes",
        attemptCount: step2.stateUpdates.attemptCount,
        hintOfferPending: step2.stateUpdates.hintOfferPending,
        hintIndex: step2.stateUpdates.hintIndex,
        hintDeclineCount: step2.stateUpdates.hintDeclineCount,
        hintsAvailable: hints,
      })
    );
    expect(step3.type).toBe("DELIVER_HINT");
    expect(step3.shouldContinue).toBe(true);
    expect(step3.stateUpdates.hintUsed).toBe(true);
    expect(step3.stateUpdates.hintIndex).toBe(1);
    expect(step3.stateUpdates.attemptCount).toBe(0); // still no answer attempt
  });

  test("'I don't know' → hint offer → decline → decline → guardrail forces retry at attemptCount=0", () => {
    // Step 1: "I don't know" → OFFER_HINT
    const step1 = computeVideoCoachAction(
      makeState({ latestStudentResponse: "I don't know", attemptCount: 0 })
    );
    expect(step1.type).toBe("OFFER_HINT");

    // Step 2: "no" → RETRY_AFTER_DECLINE (first decline)
    const step2 = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "no",
        attemptCount: step1.stateUpdates.attemptCount,
        hintOfferPending: step1.stateUpdates.hintOfferPending,
        hintIndex: step1.stateUpdates.hintIndex,
        hintDeclineCount: step1.stateUpdates.hintDeclineCount,
      })
    );
    expect(step2.type).toBe("RETRY_AFTER_DECLINE");
    expect(step2.shouldContinue).toBe(true);

    // Step 3: "no" again → would be END_AFTER_DECLINE but guardrail blocks it
    const step3 = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "no",
        attemptCount: step2.stateUpdates.attemptCount,
        hintOfferPending: step2.stateUpdates.hintOfferPending,
        hintIndex: step2.stateUpdates.hintIndex,
        hintDeclineCount: step2.stateUpdates.hintDeclineCount,
      })
    );
    // Guardrail: attemptCount=0 < MIN_ATTEMPTS_BEFORE_FAIL=2 → ASK_RETRY
    expect(step3.type).toBe("ASK_RETRY");
    expect(step3.shouldContinue).toBe(true);
    expect(step3.stateUpdates.attemptCount).toBe(0); // no actual answer attempt yet

    // Step 4: Student finally gives an answer → EVALUATE_ANSWER (first actual attempt)
    const step4 = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "I think the answer is 6",
        attemptCount: step3.stateUpdates.attemptCount,
        hintOfferPending: step3.stateUpdates.hintOfferPending,
        hintIndex: step3.stateUpdates.hintIndex,
        hintDeclineCount: step3.stateUpdates.hintDeclineCount,
      })
    );
    expect(step4.type).toBe("EVALUATE_ANSWER");
    expect(step4.stateUpdates.attemptCount).toBe(1); // NOW it increments
  });

  test("restate question mid-hint-offer → question restated → hint offer still pending", () => {
    // Step 1: "I don't know" → OFFER_HINT
    const step1 = computeVideoCoachAction(
      makeState({ latestStudentResponse: "I don't know", attemptCount: 0 })
    );
    expect(step1.type).toBe("OFFER_HINT");

    // Step 2: "what was the question" → REPEAT_QUESTION with hintOfferPending preserved
    const step2 = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "what was the question",
        attemptCount: step1.stateUpdates.attemptCount,
        hintOfferPending: step1.stateUpdates.hintOfferPending,
        hintIndex: step1.stateUpdates.hintIndex,
        hintDeclineCount: step1.stateUpdates.hintDeclineCount,
        questionText: "What is 2 + 4?",
      })
    );
    expect(step2.type).toBe("REPEAT_QUESTION");
    expect(step2.shouldContinue).toBe(true);
    expect(step2.response).toContain("What is 2 + 4?");
    expect(step2.stateUpdates.hintOfferPending).toBe(true); // preserved

    // Step 3: "yes" → DELIVER_HINT (hint offer was still pending!)
    const step3 = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "yes",
        attemptCount: step2.stateUpdates.attemptCount,
        hintOfferPending: step2.stateUpdates.hintOfferPending,
        hintIndex: step2.stateUpdates.hintIndex,
        hintDeclineCount: step2.stateUpdates.hintDeclineCount,
      })
    );
    expect(step3.type).toBe("DELIVER_HINT");
    expect(step3.shouldContinue).toBe(true);
  });
});

// ============================================================================
// STT error variants — "hinds" and "hands" as misheard "hints"
// ============================================================================

describe("isHintRequest — STT error variants", () => {
  test("'hinds' → true (STT misheard 'hints')", () => {
    expect(isHintRequest("hinds")).toBe(true);
  });

  test("'hands' → true (STT misheard 'hints')", () => {
    expect(isHintRequest("hands")).toBe(true);
  });

  test("'hind' → true (STT misheard 'hint')", () => {
    expect(isHintRequest("hind")).toBe(true);
  });

  test("'more hinds please' → true", () => {
    expect(isHintRequest("more hinds please")).toBe(true);
  });

  test("'give me a hand' → true (STT misheard 'give me a hint')", () => {
    expect(isHintRequest("give me a hand")).toBe(true);
  });

  test("'can I have another hind' → true", () => {
    expect(isHintRequest("can I have another hind")).toBe(true);
  });

  test("'do you have any more hands' → true", () => {
    expect(isHintRequest("do you have any more hands")).toBe(true);
  });

  test("'how many hinds' → true", () => {
    expect(isHintRequest("how many hinds")).toBe(true);
  });
});

describe("parseHintResponse — STT error variants", () => {
  test("'hind please' → accept (STT misheard 'hint please')", () => {
    expect(parseHintResponse("hind please")).toBe("accept");
  });

  test("'hand' → accept (STT misheard 'hint')", () => {
    expect(parseHintResponse("hand")).toBe("accept");
  });

  test("'give me a hind' → accept", () => {
    expect(parseHintResponse("give me a hind")).toBe("accept");
  });

  test("'how many hinds do you have' → inquire", () => {
    expect(parseHintResponse("how many hinds do you have")).toBe("inquire");
  });

  test("'do you have any hands' → inquire (STT misheard 'hints')", () => {
    expect(parseHintResponse("do you have any hands")).toBe("inquire");
  });

  test("'what hands do you have' → inquire", () => {
    expect(parseHintResponse("what hands do you have")).toBe("inquire");
  });

  test("'are there hinds' → inquire", () => {
    expect(parseHintResponse("are there hinds")).toBe("inquire");
  });
});

// ============================================================================
// buildRetryPrompt
// ============================================================================

describe("buildRetryPrompt", () => {
  test("question with 'three' → 'Try naming three examples...'", () => {
    const result = buildRetryPrompt("Name three animals that live in the ocean.");
    expect(result).toContain("three examples");
  });

  test("question with 'at least three' → 'Try naming three examples...'", () => {
    const result = buildRetryPrompt("List at least three reasons why plants need sunlight.");
    expect(result).toContain("three examples");
  });

  test("question without 'three' → 'Tell me one example first...'", () => {
    const result = buildRetryPrompt("Why do birds fly south for the winter?");
    expect(result).toContain("one example first");
  });

  test("question with 'three' in different case → matches", () => {
    const result = buildRetryPrompt("Give me THREE ways to save water.");
    expect(result).toContain("three examples");
  });
});

// ============================================================================
// containsCorrectLanguage
// ============================================================================

describe("containsCorrectLanguage", () => {
  test("'That's correct!' → true", () => {
    expect(containsCorrectLanguage("That's correct!")).toBe(true);
  });

  test("'Great job!' → true", () => {
    expect(containsCorrectLanguage("Great job!")).toBe(true);
  });

  test("'You got it!' → true", () => {
    expect(containsCorrectLanguage("You got it!")).toBe(true);
  });

  test("'That's right!' → true", () => {
    expect(containsCorrectLanguage("That's right!")).toBe(true);
  });

  test("'Well done!' → true", () => {
    expect(containsCorrectLanguage("Well done!")).toBe(true);
  });

  test("'Perfect!' → true", () => {
    expect(containsCorrectLanguage("Perfect!")).toBe(true);
  });

  test("'Not quite — try again' → false", () => {
    expect(containsCorrectLanguage("Not quite — try again")).toBe(false);
  });

  test("'Can you tell me more?' → false", () => {
    expect(containsCorrectLanguage("Can you tell me more?")).toBe(false);
  });

  test("'Think about it a different way' → false", () => {
    expect(containsCorrectLanguage("Think about it a different way")).toBe(false);
  });

  test("'Excellent! You nailed it!' → true (multiple matches)", () => {
    expect(containsCorrectLanguage("Excellent! You nailed it!")).toBe(true);
  });

  test("'Nice work!' → true", () => {
    expect(containsCorrectLanguage("Nice work!")).toBe(true);
  });

  test("'Exactly!' → true (standalone)", () => {
    expect(containsCorrectLanguage("Exactly!")).toBe(true);
  });

  test("'Exactly right!' → true", () => {
    expect(containsCorrectLanguage("Exactly right!")).toBe(true);
  });
});

// ============================================================================
// Integration: multiple hint inquiries should NOT increase attemptCount
// ============================================================================

describe("integration — hint inquiries, restates, and no-speech do NOT increase attemptCount", () => {
  test("3x hint inquiry + 1x restate question → attemptCount stays 0", () => {
    const hints = ["Hint A", "Hint B"];

    // Step 1: "I don't know" → OFFER_HINT
    const step1 = computeVideoCoachAction(
      makeState({ latestStudentResponse: "I don't know", attemptCount: 0, hintsAvailable: hints })
    );
    expect(step1.type).toBe("OFFER_HINT");
    expect(step1.stateUpdates.attemptCount).toBe(0);

    // Step 2: "how many hints do you have" → HINT_INQUIRY_RESPONSE
    const step2 = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "how many hints do you have",
        attemptCount: step1.stateUpdates.attemptCount,
        hintOfferPending: step1.stateUpdates.hintOfferPending,
        hintIndex: step1.stateUpdates.hintIndex,
        hintDeclineCount: step1.stateUpdates.hintDeclineCount,
        hintsAvailable: hints,
      })
    );
    expect(step2.type).toBe("HINT_INQUIRY_RESPONSE");
    expect(step2.stateUpdates.attemptCount).toBe(0);

    // Step 3: "what kind of hinds are they" (STT variant) → HINT_INQUIRY_RESPONSE
    const step3 = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "what kind of hinds are they",
        attemptCount: step2.stateUpdates.attemptCount,
        hintOfferPending: step2.stateUpdates.hintOfferPending,
        hintIndex: step2.stateUpdates.hintIndex,
        hintDeclineCount: step2.stateUpdates.hintDeclineCount,
        hintsAvailable: hints,
      })
    );
    expect(step3.type).toBe("HINT_INQUIRY_RESPONSE");
    expect(step3.stateUpdates.attemptCount).toBe(0);

    // Step 4: "what was the question" → REPEAT_QUESTION
    const step4 = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "what was the question",
        attemptCount: step3.stateUpdates.attemptCount,
        hintOfferPending: step3.stateUpdates.hintOfferPending,
        hintIndex: step3.stateUpdates.hintIndex,
        hintDeclineCount: step3.stateUpdates.hintDeclineCount,
        hintsAvailable: hints,
        questionText: "What is 2 + 4?",
      })
    );
    expect(step4.type).toBe("REPEAT_QUESTION");
    expect(step4.stateUpdates.attemptCount).toBe(0);

    // Step 5: "are there hands" (STT variant) → HINT_INQUIRY_RESPONSE (hintOfferPending preserved)
    const step5 = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "are there hands",
        attemptCount: step4.stateUpdates.attemptCount,
        hintOfferPending: step4.stateUpdates.hintOfferPending,
        hintIndex: step4.stateUpdates.hintIndex,
        hintDeclineCount: step4.stateUpdates.hintDeclineCount,
        hintsAvailable: hints,
      })
    );
    expect(step5.type).toBe("HINT_INQUIRY_RESPONSE");
    expect(step5.stateUpdates.attemptCount).toBe(0);

    // Step 6: finally give a real answer → EVALUATE_ANSWER (now increments)
    const step6 = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "I think the answer is 6 because 2 plus 4 equals 6",
        attemptCount: step5.stateUpdates.attemptCount,
        hintOfferPending: step5.stateUpdates.hintOfferPending,
        hintIndex: step5.stateUpdates.hintIndex,
        hintDeclineCount: step5.stateUpdates.hintDeclineCount,
        hintsAvailable: hints,
      })
    );
    expect(step6.type).toBe("EVALUATE_ANSWER");
    expect(step6.stateUpdates.attemptCount).toBe(1); // NOW it increments
  });

  test("no-speech does not count as attempt", () => {
    // no-speech → ASK_RETRY with no attempt increment
    const step1 = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "(no speech detected)",
        attemptCount: 1,
        hintsAvailable: [],
      })
    );
    expect(step1.stateUpdates.attemptCount).toBe(1); // unchanged

    // second no-speech → still no increment
    const step2 = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "",
        attemptCount: step1.stateUpdates.attemptCount,
        hintsAvailable: [],
      })
    );
    expect(step2.stateUpdates.attemptCount).toBe(1); // still unchanged
  });
});

// ============================================================================
// BUG A — correctness guard: score < 80 + "correct" language → override
// ============================================================================

describe("correctness guard pipeline", () => {
  test("score=70, coachText='That's correct!' → containsCorrectLanguage=true, text must be overridden", () => {
    const coachText = "That's correct! Great job explaining your thinking.";
    const evalResult = { score: 70, isCorrect: false, shouldContinue: false };

    // Step 1: containsCorrectLanguage detects false praise
    expect(containsCorrectLanguage(coachText)).toBe(true);

    // Step 2: resolvePostEvaluation at attempt 1, max=3 → shouldContinue=true (keep trying)
    const resolved = resolvePostEvaluation(evalResult, 1, 3);
    expect(resolved.shouldContinue).toBe(true);

    // Pipeline: score < 80 && containsCorrectLanguage → Lesson.tsx overrides to:
    // "Not quite yet — give it another try. What do you think the answer is?"
  });

  test("score=70, max attempts reached → shouldContinue=false, correctness guard uses ending text", () => {
    const coachText = "You got it! Well done.";
    const evalResult = { score: 70, isCorrect: false, shouldContinue: false };

    expect(containsCorrectLanguage(coachText)).toBe(true);

    // At attempt 2, max=3: attemptCount + 1 >= maxAttempts → shouldContinue=false
    const resolved = resolvePostEvaluation(evalResult, 2, 3);
    expect(resolved.shouldContinue).toBe(false);

    // Pipeline: score < 80 && containsCorrectLanguage && !shouldContinue → Lesson.tsx overrides to:
    // "Thanks for trying — we're going to move on for now."
  });

  test("score=85, coachText='That's correct!' → NO override (score >= 80 is genuinely correct)", () => {
    const coachText = "That's correct! Great job!";
    const evalResult = { score: 85, isCorrect: true, shouldContinue: false };

    expect(containsCorrectLanguage(coachText)).toBe(true);
    // But score >= 80 → guard does NOT fire (score < 80 is false)
    expect(evalResult.score < 80).toBe(false);
  });

  test("score=70, coachText='Not quite — try again' → no override needed (no correct language)", () => {
    const coachText = "Not quite — try again with a different approach.";
    expect(containsCorrectLanguage(coachText)).toBe(false);
    // Guard does not fire — wording already appropriate
  });

  test("'Nice work on that!' with score=60 → detected as false praise", () => {
    expect(containsCorrectLanguage("Nice work on that!")).toBe(true);
    // score=60 < 80 → guard fires
  });
});

// ============================================================================
// BUG B — stale attemptCount: resolvePostEvaluation must use updated value
// ============================================================================

describe("stale attemptCount guard", () => {
  test("EVALUATE_ANSWER increments count — resolvePostEvaluation must use new value, not stale", () => {
    // Simulate: videoAttemptCount=1, student gives substantive answer
    const action = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "I think the answer is 6 because 2 plus 4 equals 6",
        attemptCount: 1,
        maxAttempts: 3,
      })
    );
    expect(action.type).toBe("EVALUATE_ANSWER");

    // State machine increments: 1 → 2
    const nextAttemptCount = action.stateUpdates.attemptCount;
    expect(nextAttemptCount).toBe(2);

    // With nextAttemptCount=2, score < 80, max=3: 2+1 >= 3 → should END
    const resolved = resolvePostEvaluation(
      { score: 50, isCorrect: false, shouldContinue: true },
      nextAttemptCount, // correct: 2
      3
    );
    expect(resolved.shouldContinue).toBe(false);

    // If stale value (1) were used instead, it would INCORRECTLY continue
    const staleResolved = resolvePostEvaluation(
      { score: 50, isCorrect: false, shouldContinue: true },
      1, // stale — the bug
      3
    );
    expect(staleResolved.shouldContinue).toBe(true); // wrong decision!
  });

  test("first attempt guardrail still works with updated count", () => {
    // attemptCount=0, student gives answer → EVALUATE_ANSWER, count becomes 1
    const action = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "I think the answer is 6",
        attemptCount: 0,
        maxAttempts: 3,
      })
    );
    const nextAttemptCount = action.stateUpdates.attemptCount;
    expect(nextAttemptCount).toBe(1);

    // score < 80, nextAttemptCount=1, MIN_ATTEMPTS_BEFORE_FAIL=2 → should CONTINUE (guardrail)
    const resolved = resolvePostEvaluation(
      { score: 40, isCorrect: false, shouldContinue: false },
      nextAttemptCount,
      3
    );
    expect(resolved.shouldContinue).toBe(true);
  });
});

// ============================================================================
// ROBUSTNESS — STT "hands" → hint path, not EVALUATE_ANSWER
// ============================================================================

describe("computeVideoCoachAction — STT 'hands' routes to hint path", () => {
  test("'do you have any more hands' → DELIVER_HINT, not EVALUATE_ANSWER, no attempt increment", () => {
    const action = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "do you have any more hands",
        hintIndex: 0,
        hintsAvailable: ["Think about adding the numbers."],
        attemptCount: 1,
      })
    );
    expect(action.type).toBe("DELIVER_HINT");
    expect(action.type).not.toBe("EVALUATE_ANSWER");
    expect(action.stateUpdates.attemptCount).toBe(1); // unchanged
    expect(action.shouldContinue).toBe(true);
  });

  test("'any more hands' when hints exhausted → ASK_RETRY, not EVALUATE_ANSWER", () => {
    const action = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "any more hands",
        hintIndex: 1,
        hintsAvailable: ["hint1"], // exhausted
        attemptCount: 0,
      })
    );
    expect(action.type).toBe("ASK_RETRY");
    expect(action.type).not.toBe("EVALUATE_ANSWER");
    expect(action.stateUpdates.attemptCount).toBe(0); // unchanged
  });

  test("'more hinds please' → DELIVER_HINT, no attempt increment", () => {
    const action = computeVideoCoachAction(
      makeState({
        latestStudentResponse: "more hinds please",
        hintIndex: 0,
        hintsAvailable: ["hint1", "hint2"],
        attemptCount: 2,
      })
    );
    expect(action.type).toBe("DELIVER_HINT");
    expect(action.stateUpdates.attemptCount).toBe(2); // unchanged
  });
});

// ── isFrustrationSignal — substantive remainder bypass ─────────────────────

describe("isFrustrationSignal", () => {
  it("detects pure frustration: 'this is stupid'", () => {
    expect(isFrustrationSignal("this is stupid")).toBe(true);
  });

  it("detects pure frustration: 'I don't know'", () => {
    expect(isFrustrationSignal("I don't know")).toBe(true);
  });

  it("detects pure frustration: 'I don't really know'", () => {
    expect(isFrustrationSignal("I don't really know")).toBe(true);
  });

  it("detects pure frustration: 'ugh whatever'", () => {
    expect(isFrustrationSignal("ugh whatever")).toBe(true);
  });

  it("detects pure frustration: 'I give up'", () => {
    expect(isFrustrationSignal("I give up")).toBe(true);
  });

  it("does NOT treat exploratory 'I don't know' + substantive content as frustration", () => {
    // EXACT BUG REPRO: student says they don't know but then gives real reasoning
    expect(isFrustrationSignal(
      "I don't really know the answer to that because I know the planets closer to the Sun are rocky and the outer ones are gas"
    )).toBe(false);
  });

  it("does NOT trigger when frustration phrase is followed by >= 5 content words", () => {
    expect(isFrustrationSignal(
      "I don't know but the sun gives warmth and light to the planets"
    )).toBe(false);
  });

  it("does NOT trigger for 'this is boring' + substantive content", () => {
    expect(isFrustrationSignal(
      "this is boring but gravity from the sun keeps the planets in orbit around it"
    )).toBe(false);
  });

  it("DOES trigger when frustration phrase has no substantive follow-up", () => {
    expect(isFrustrationSignal("I don't really know I guess")).toBe(true);
  });

  it("DOES trigger for 'I don't care' with no content", () => {
    expect(isFrustrationSignal("I don't care about this")).toBe(true);
  });

  it("returns false for normal answers", () => {
    expect(isFrustrationSignal("The sun gives warmth and light to the planets")).toBe(false);
    expect(isFrustrationSignal("Gravity keeps the planets in orbit")).toBe(false);
  });

  it("returns false for short normal answers", () => {
    expect(isFrustrationSignal("it gives heat")).toBe(false);
  });
});

// ============================================================================
// classifyStudentUtterance
// ============================================================================

describe("classifyStudentUtterance", () => {
  it("classifies empty input as SILENCE", () => {
    expect(classifyStudentUtterance("")).toBe("SILENCE");
    expect(classifyStudentUtterance("   ")).toBe("SILENCE");
    expect(classifyStudentUtterance("(no speech detected)")).toBe("SILENCE");
  });

  it("classifies meta-conversational utterances", () => {
    expect(classifyStudentUtterance("are we going to talk more or are you just sending the conversation there")).toBe("META_CONVERSATION");
    expect(classifyStudentUtterance("how long is this going to take")).toBe("META_CONVERSATION");
    expect(classifyStudentUtterance("what are we doing now")).toBe("META_CONVERSATION");
    expect(classifyStudentUtterance("are you a robot")).toBe("META_CONVERSATION");
    expect(classifyStudentUtterance("is this recording")).toBe("META_CONVERSATION");
    expect(classifyStudentUtterance("what was my score")).toBe("META_CONVERSATION");
  });

  it("classifies end-intent utterances", () => {
    expect(classifyStudentUtterance("I'm done")).toBe("END_INTENT");
    expect(classifyStudentUtterance("stop")).toBe("END_INTENT");
    expect(classifyStudentUtterance("I want to stop")).toBe("END_INTENT");
    expect(classifyStudentUtterance("can we end this")).toBe("END_INTENT");
    expect(classifyStudentUtterance("I don't want to talk anymore")).toBe("END_INTENT");
    expect(classifyStudentUtterance("no more questions")).toBe("END_INTENT");
  });

  it("classifies confusion utterances", () => {
    expect(classifyStudentUtterance("I don't understand the question")).toBe("CONFUSION");
    expect(classifyStudentUtterance("what do you mean")).toBe("CONFUSION");
    expect(classifyStudentUtterance("I'm confused")).toBe("CONFUSION");
    expect(classifyStudentUtterance("can you rephrase that")).toBe("CONFUSION");
    expect(classifyStudentUtterance("huh?")).toBe("CONFUSION");
  });

  it("classifies content answers", () => {
    expect(classifyStudentUtterance("The sun gives warmth and light to the planets")).toBe("CONTENT_ANSWER");
    expect(classifyStudentUtterance("I think the answer is seven")).toBe("CONTENT_ANSWER");
    expect(classifyStudentUtterance("gravity")).toBe("CONTENT_ANSWER");
  });

  it("treats meta phrase + substantive content as CONTENT_ANSWER", () => {
    // "are we done" is meta, but the utterance has enough content words
    expect(classifyStudentUtterance("are we done? I think the answer is that gravity pulls the planets toward the sun")).toBe("CONTENT_ANSWER");
  });

  it("treats end phrase + substantive content as CONTENT_ANSWER", () => {
    expect(classifyStudentUtterance("I'm done but I think it's because the sun provides heat and energy to plants")).toBe("CONTENT_ANSWER");
  });
});

// ============================================================================
// computeVideoCoachAction — utterance classification integration
// ============================================================================

describe("computeVideoCoachAction — utterance classification", () => {
  it("META: does NOT dispatch EVALUATE_ANSWER for meta-conversational utterance", () => {
    const state = makeState({
      latestStudentResponse: "are we going to talk more or are you just sending the conversation there",
    });
    const action = computeVideoCoachAction(state);
    expect(action.type).toBe("META_RESPONSE");
    expect(action.type).not.toBe("EVALUATE_ANSWER");
    expect(action.utteranceIntent).toBe("META_CONVERSATION");
    expect(action.shouldContinue).toBe(true);
  });

  it("META: does NOT increment attemptCount", () => {
    const state = makeState({
      latestStudentResponse: "how many questions are there",
      attemptCount: 1,
    });
    const action = computeVideoCoachAction(state);
    expect(action.type).toBe("META_RESPONSE");
    expect(action.stateUpdates.attemptCount).toBe(1); // unchanged
  });

  it("META: 'what was my score' is meta, not an answer", () => {
    const state = makeState({
      latestStudentResponse: "what was my score",
    });
    const action = computeVideoCoachAction(state);
    expect(action.type).toBe("META_RESPONSE");
    expect(action.stateUpdates.attemptCount).toBe(0); // unchanged
  });

  it("END: wraps session for 'I'm done'", () => {
    const state = makeState({
      latestStudentResponse: "I'm done",
    });
    const action = computeVideoCoachAction(state);
    expect(action.type).toBe("END_SESSION");
    expect(action.shouldContinue).toBe(false);
    expect(action.endReason).toBe("student-ended");
    expect(action.utteranceIntent).toBe("END_INTENT");
    expect(action.stateUpdates.attemptCount).toBe(0); // unchanged
  });

  it("END: wraps session for 'stop'", () => {
    const state = makeState({
      latestStudentResponse: "stop",
    });
    const action = computeVideoCoachAction(state);
    expect(action.type).toBe("END_SESSION");
    expect(action.shouldContinue).toBe(false);
  });

  it("CONFUSION: rephrases question for confused student", () => {
    const state = makeState({
      latestStudentResponse: "I don't understand the question",
      questionText: "What is 2 + 4?",
    });
    const action = computeVideoCoachAction(state);
    expect(action.type).toBe("META_RESPONSE");
    expect(action.utteranceIntent).toBe("CONFUSION");
    expect(action.response).toContain("What is 2 + 4?");
    expect(action.shouldContinue).toBe(true);
    expect(action.stateUpdates.attemptCount).toBe(0); // unchanged
  });

  it("CONTENT: substantive answer still dispatches EVALUATE_ANSWER", () => {
    const state = makeState({
      latestStudentResponse: "The sun gives warmth and light to the planets in our solar system",
    });
    const action = computeVideoCoachAction(state);
    expect(action.type).toBe("EVALUATE_ANSWER");
    expect(action.utteranceIntent).toBe("CONTENT_ANSWER");
    expect(action.stateUpdates.attemptCount).toBe(1); // incremented
  });

  it("CONTENT: meta phrase + substantive answer → EVALUATE_ANSWER", () => {
    const state = makeState({
      latestStudentResponse: "are we done? I think the answer is that gravity pulls the planets toward the sun",
    });
    const action = computeVideoCoachAction(state);
    expect(action.type).toBe("EVALUATE_ANSWER");
    expect(action.stateUpdates.attemptCount).toBe(1); // incremented
  });

  it("shouldContinue remains true for META_RESPONSE at any attemptCount", () => {
    const state = makeState({
      latestStudentResponse: "how long is this going to take",
      attemptCount: 2,
    });
    const action = computeVideoCoachAction(state);
    expect(action.type).toBe("META_RESPONSE");
    expect(action.shouldContinue).toBe(true);
    expect(action.stateUpdates.attemptCount).toBe(2); // unchanged
  });

  it("REGRESSION: exact user-reported utterance does NOT trigger EVALUATE_ANSWER", () => {
    // This is the exact log case from the bug report
    const state = makeState({
      latestStudentResponse: "are we going to talk more or are you just sending the conversation there",
      attemptCount: 0,
    });
    const action = computeVideoCoachAction(state);
    expect(action.type).not.toBe("EVALUATE_ANSWER");
    expect(action.stateUpdates.attemptCount).toBe(0); // NOT incremented
  });
});

