/**
 * Tests for calculateQuestionOutcome function
 *
 * These tests verify:
 * 1. The fix for the scoring bug where nonsense answers were shown as
 *    "Demonstrated Understanding" due to missing scores defaulting to 80.
 * 2. The fix for "with-support" requiring BOTH hint usage AND high score.
 *
 * Outcome logic:
 * - "demonstrated": score >= 80 AND no hint used
 * - "with-support": score >= 80 AND hint was used
 * - "developing": score < 80 (regardless of hint usage)
 * - "needs-review": has response but no score
 * - "not-attempted": empty response
 */

import {
  calculateQuestionOutcome,
  wasHintUsed,
  buildJourneySummary,
  getStepLabel,
  deriveCoachSupport,
  deriveCoachSupportFromHints,
  extractCoachSignals,
  buildInsightPhrase,
} from "./teacherDashboardUtils";
import type { PromptResponse } from "../services/api";
import type { QuestionSummary, LearningJourneyInsights, UnderstandingLevel, CoachSupportLevel } from "../types/teacherDashboard";

// Helper to create a minimal PromptResponse
function createResponse(
  response: string,
  hintUsed = false,
  hintCountUsed?: number,
  conversationTurns?: Array<{ role: "coach" | "student"; message: string; timestampSec: number }>
): PromptResponse {
  return {
    promptId: "test-prompt",
    response,
    hintUsed,
    hintCountUsed,
    conversationTurns,
  };
}

describe("wasHintUsed", () => {
  it("returns true when hintUsed is true", () => {
    const response = createResponse("answer", true);
    expect(wasHintUsed(response)).toBe(true);
  });

  it("returns true when hintCountUsed > 0", () => {
    const response = createResponse("answer", false, 1);
    expect(wasHintUsed(response)).toBe(true);
  });

  it("returns true when both hintUsed and hintCountUsed are set", () => {
    const response = createResponse("answer", true, 2);
    expect(wasHintUsed(response)).toBe(true);
  });

  it("returns false when no hints used", () => {
    const response = createResponse("answer", false, 0);
    expect(wasHintUsed(response)).toBe(false);
  });

  it("returns false when hintCountUsed is undefined", () => {
    const response = createResponse("answer", false);
    expect(wasHintUsed(response)).toBe(false);
  });
});

describe("calculateQuestionOutcome", () => {
  describe("BUG FIX: nonsense responses should NOT show as Demonstrated Understanding", () => {
    it("should return needs-review for nonsense weather response without score", () => {
      const response = createResponse("I don't know rainbows butterflies and umbrellas");
      const outcome = calculateQuestionOutcome(response, undefined);
      expect(outcome).toBe("needs-review");
      expect(outcome).not.toBe("demonstrated");
    });

    it("should return needs-review for time machine response without score", () => {
      const response = createResponse("I don't know you could use a time machine");
      const outcome = calculateQuestionOutcome(response, undefined);
      expect(outcome).toBe("needs-review");
      expect(outcome).not.toBe("demonstrated");
    });
  });

  describe("core outcome logic", () => {
    it("score 85 + no hint => demonstrated", () => {
      const response = createResponse("Sunny, rainy, and snowy are three types of weather.", false);
      const outcome = calculateQuestionOutcome(response, 85);
      expect(outcome).toBe("demonstrated");
    });

    it("score 85 + hintUsed => with-support", () => {
      const response = createResponse("After the hint, I know: sunny, rainy, snowy", true);
      const outcome = calculateQuestionOutcome(response, 85);
      expect(outcome).toBe("with-support");
    });

    it("score 60 + hintUsed => developing (not with-support, didn't succeed)", () => {
      const response = createResponse("Maybe sunny and rainy?", true);
      const outcome = calculateQuestionOutcome(response, 60);
      expect(outcome).toBe("developing");
      expect(outcome).not.toBe("with-support");
    });

    it("score 60 + no hint => developing", () => {
      const response = createResponse("Maybe sunny and rainy?", false);
      const outcome = calculateQuestionOutcome(response, 60);
      expect(outcome).toBe("developing");
    });

    it("score undefined => needs-review", () => {
      const response = createResponse("Some response");
      const outcome = calculateQuestionOutcome(response, undefined);
      expect(outcome).toBe("needs-review");
    });

    it("empty response => not-attempted", () => {
      const response = createResponse("");
      const outcome = calculateQuestionOutcome(response, undefined);
      expect(outcome).toBe("not-attempted");
    });

    it("should return developing for low score", () => {
      const response = createResponse("I don't know what weather is", false);
      const outcome = calculateQuestionOutcome(response, 30);
      expect(outcome).toBe("developing");
    });
  });

  describe("with-support requires BOTH hint AND high score", () => {
    it("high score (80) + hint => with-support", () => {
      const response = createResponse("Got it with help", true);
      const outcome = calculateQuestionOutcome(response, 80);
      expect(outcome).toBe("with-support");
    });

    it("high score (80) + no hint => demonstrated", () => {
      const response = createResponse("Got it alone", false);
      const outcome = calculateQuestionOutcome(response, 80);
      expect(outcome).toBe("demonstrated");
    });

    it("low score (79) + hint => developing (not with-support)", () => {
      const response = createResponse("Almost got it with help", true);
      const outcome = calculateQuestionOutcome(response, 79);
      expect(outcome).toBe("developing");
    });

    it("low score (50) + hint => developing (old bug: was with-support)", () => {
      const response = createResponse("Partial answer with hint", true);
      const outcome = calculateQuestionOutcome(response, 50);
      expect(outcome).toBe("developing");
      expect(outcome).not.toBe("with-support");
    });
  });

  describe("hintCountUsed support (talk/video mode)", () => {
    it("high score + hintCountUsed=1 (talk mode) => with-support", () => {
      const response = createResponse("Got it after hint in talk mode", false, 1);
      const outcome = calculateQuestionOutcome(response, 85);
      expect(outcome).toBe("with-support");
    });

    it("high score + hintCountUsed=2 (multiple hints) => with-support", () => {
      const response = createResponse("Got it after two hints", false, 2);
      const outcome = calculateQuestionOutcome(response, 85);
      expect(outcome).toBe("with-support");
    });

    it("high score + hintCountUsed=0 => demonstrated", () => {
      const response = createResponse("Got it alone", false, 0);
      const outcome = calculateQuestionOutcome(response, 85);
      expect(outcome).toBe("demonstrated");
    });
  });

  describe("empty responses", () => {
    it("should return not-attempted for empty response", () => {
      const response = createResponse("");
      const outcome = calculateQuestionOutcome(response, undefined);
      expect(outcome).toBe("not-attempted");
    });

    it("should return not-attempted for whitespace-only response", () => {
      const response = createResponse("   ");
      const outcome = calculateQuestionOutcome(response, undefined);
      expect(outcome).toBe("not-attempted");
    });
  });

  describe("edge cases for needs-review", () => {
    it("should return needs-review when score is null", () => {
      const response = createResponse("Some response");
      const outcome = calculateQuestionOutcome(response, null as unknown as number);
      expect(outcome).toBe("needs-review");
    });

    it("should NOT return needs-review when score is 0 (valid low score)", () => {
      const response = createResponse("Completely wrong answer");
      const outcome = calculateQuestionOutcome(response, 0);
      expect(outcome).toBe("developing");
      expect(outcome).not.toBe("needs-review");
    });
  });
});

// ============================================
// deriveCoachSupport (multi-signal)
// ============================================

describe("deriveCoachSupport", () => {
  it("returns 'none' for empty responses", () => {
    expect(deriveCoachSupport([])).toBe("none");
  });

  it("returns 'none' for clean independent solve (no coach turns, no hints)", () => {
    const responses = [
      createResponse("answer 1"),
      createResponse("answer 2"),
    ];
    expect(deriveCoachSupport(responses)).toBe("none");
  });

  it("returns 'minimal' for a light nudge (1-2 coach turns, no hints)", () => {
    const responses = [
      createResponse("answer 1", false, 0, [
        { role: "coach", message: "Can you tell me more?", timestampSec: 1 },
        { role: "student", message: "Yes, it's because...", timestampSec: 2 },
      ]),
      createResponse("answer 2"),
    ];
    expect(deriveCoachSupport(responses)).toBe("minimal");
  });

  it("returns 'moderate' for misconception redirect / repeated probes (3+ coach turns)", () => {
    const responses = [
      createResponse("answer 1", false, 0, [
        { role: "coach", message: "What do you get when you add the ones?", timestampSec: 1 },
        { role: "student", message: "I think 5", timestampSec: 2 },
        { role: "coach", message: "Let's think again about 2 + 2", timestampSec: 3 },
        { role: "student", message: "Oh, 4!", timestampSec: 4 },
        { role: "coach", message: "Now what about the tens?", timestampSec: 5 },
        { role: "student", message: "60", timestampSec: 6 },
      ]),
    ];
    expect(deriveCoachSupport(responses)).toBe("moderate");
  });

  it("returns 'moderate' when hints used on < half of questions", () => {
    const responses = [
      createResponse("answer 1", true), // hint on Q1
      createResponse("answer 2"),
      createResponse("answer 3"),
    ];
    expect(deriveCoachSupport(responses)).toBe("moderate");
  });

  it("returns 'high' when hints used on 50%+ of questions", () => {
    const responses = [
      createResponse("answer 1", true),
      createResponse("answer 2", true),
      createResponse("answer 3"),
    ];
    // 2/3 ≈ 67% hints
    expect(deriveCoachSupport(responses)).toBe("high");
  });

  it("returns 'high' for 5+ coach turns on a single question (guided completion)", () => {
    const turns: Array<{ role: "coach" | "student"; message: string; timestampSec: number }> = [];
    for (let i = 0; i < 5; i++) {
      turns.push({ role: "coach", message: `Probe ${i}`, timestampSec: i * 2 });
      turns.push({ role: "student", message: `Answer ${i}`, timestampSec: i * 2 + 1 });
    }
    const responses = [
      createResponse("final answer", false, 0, turns),
    ];
    expect(deriveCoachSupport(responses)).toBe("high");
  });

  it("returns 'moderate' when coach engaged on multiple questions (2+ questions with coach turns)", () => {
    const responses = [
      createResponse("answer 1", false, 0, [
        { role: "coach", message: "Tell me more", timestampSec: 1 },
        { role: "student", message: "Because...", timestampSec: 2 },
      ]),
      createResponse("answer 2", false, 0, [
        { role: "coach", message: "What about this?", timestampSec: 1 },
        { role: "student", message: "I think...", timestampSec: 2 },
      ]),
    ];
    expect(deriveCoachSupport(responses)).toBe("moderate");
  });
});

// ============================================
// deriveCoachSupportFromHints (legacy)
// ============================================

describe("deriveCoachSupportFromHints", () => {
  it("returns 'none' for 0 questions", () => {
    expect(deriveCoachSupportFromHints(0, 0)).toBe("none");
  });

  it("returns 'none' for 0 hints", () => {
    expect(deriveCoachSupportFromHints(0, 5)).toBe("none");
  });

  it("returns 'minimal' for low hint ratio (< 0.2)", () => {
    expect(deriveCoachSupportFromHints(1, 10)).toBe("minimal");
  });

  it("returns 'moderate' for moderate hint ratio (0.2-0.49)", () => {
    expect(deriveCoachSupportFromHints(2, 5)).toBe("moderate");
  });

  it("returns 'high' for high hint ratio (>= 0.5)", () => {
    expect(deriveCoachSupportFromHints(3, 5)).toBe("high");
  });
});

// ============================================
// extractCoachSignals
// ============================================

describe("extractCoachSignals", () => {
  it("returns zero signals for empty responses", () => {
    const signals = extractCoachSignals([]);
    expect(signals.totalCoachTurns).toBe(0);
    expect(signals.hintsUsed).toBe(0);
    expect(signals.questionCount).toBe(0);
  });

  it("counts coach and student turns across multiple questions", () => {
    const responses = [
      createResponse("a", false, 0, [
        { role: "coach", message: "Q", timestampSec: 1 },
        { role: "student", message: "A", timestampSec: 2 },
      ]),
      createResponse("b", false, 0, [
        { role: "coach", message: "Q", timestampSec: 1 },
        { role: "student", message: "A", timestampSec: 2 },
        { role: "coach", message: "Q2", timestampSec: 3 },
        { role: "student", message: "A2", timestampSec: 4 },
      ]),
    ];
    const signals = extractCoachSignals(responses);
    expect(signals.totalCoachTurns).toBe(3);
    expect(signals.totalStudentTurns).toBe(3);
    expect(signals.questionsWithCoachTurns).toBe(2);
    expect(signals.maxCoachTurnsOnOneQuestion).toBe(2);
  });

  it("counts hints correctly", () => {
    const responses = [
      createResponse("a", true),
      createResponse("b", false, 2),
      createResponse("c"),
    ];
    const signals = extractCoachSignals(responses);
    expect(signals.hintsUsed).toBe(2);
  });
});

// ============================================
// buildInsightPhrase
// ============================================

describe("buildInsightPhrase", () => {
  const NO_INSIGHTS: LearningJourneyInsights = {
    startedStrong: false,
    improvedOverTime: false,
    struggledConsistently: false,
    recoveredWithSupport: false,
  };

  function makeQ(outcome: "demonstrated" | "with-support" | "developing" | "needs-review" | "not-attempted"): QuestionSummary {
    return {
      questionId: "q1",
      questionNumber: 1,
      questionText: "Test",
      outcome,
      usedHint: false,
      hintCount: 0,
      totalHintsAvailable: 2,
      improvedAfterHelp: false,
      studentResponse: "response",
      hasVoiceRecording: false,
    };
  }

  it("returns empty string for not-started student (no questions, not complete)", () => {
    expect(buildInsightPhrase("needs-support", "none", NO_INSIGHTS, [], false)).toBe("");
  });

  it("returns 'No data to review' for complete with no questions", () => {
    expect(buildInsightPhrase("needs-support", "none", NO_INSIGHTS, [], true)).toBe("No data to review");
  });

  // === Strong understanding scenarios ===

  it("strong + independent (all demonstrated, no coach) → non-empty with 'mastered'", () => {
    const qs = [makeQ("demonstrated"), makeQ("demonstrated")];
    const result = buildInsightPhrase("strong", "none", NO_INSIGHTS, qs, true);
    expect(result).toContain("mastered this independently");
    expect(result.length).toBeGreaterThan(0);
  });

  it("strong + minimal coach → non-empty", () => {
    const qs = [makeQ("demonstrated"), makeQ("developing")];
    const result = buildInsightPhrase("strong", "minimal", NO_INSIGHTS, qs, true);
    expect(result.length).toBeGreaterThan(0);
  });

  it("strong + moderate coach → non-empty with 'retention'", () => {
    const qs = [makeQ("demonstrated"), makeQ("with-support")];
    const result = buildInsightPhrase("strong", "moderate", NO_INSIGHTS, qs, true);
    expect(result).toContain("retention");
    expect(result.length).toBeGreaterThan(0);
  });

  it("strong + high coach → non-empty with 'retention'", () => {
    const qs = [makeQ("demonstrated"), makeQ("with-support")];
    const result = buildInsightPhrase("strong", "high", NO_INSIGHTS, qs, true);
    expect(result).toContain("retention");
  });

  it("strong + recovered → 'check if understanding sticks'", () => {
    const qs = [makeQ("demonstrated"), makeQ("with-support")];
    const insights = { ...NO_INSIGHTS, recoveredWithSupport: true };
    const result = buildInsightPhrase("strong", "high", insights, qs, true);
    expect(result).toContain("understanding sticks");
  });

  // === Developing understanding scenarios ===

  it("developing + improved → non-empty with 'growth'", () => {
    const insights = { ...NO_INSIGHTS, improvedOverTime: true };
    const qs = [makeQ("developing"), makeQ("demonstrated")];
    const result = buildInsightPhrase("developing", "moderate", insights, qs, true);
    expect(result).toContain("growth");
    expect(result.length).toBeGreaterThan(0);
  });

  it("developing + high coach → non-empty with 're-teaching'", () => {
    const qs = [makeQ("developing"), makeQ("developing")];
    const result = buildInsightPhrase("developing", "high", NO_INSIGHTS, qs, true);
    expect(result).toContain("re-teaching");
    expect(result.length).toBeGreaterThan(0);
  });

  it("developing + moderate coach + complete → non-empty", () => {
    const qs = [makeQ("developing")];
    const result = buildInsightPhrase("developing", "moderate", NO_INSIGHTS, qs, true);
    expect(result.length).toBeGreaterThan(0);
  });

  it("developing + none coach + incomplete → 'finish'", () => {
    const qs = [makeQ("developing")];
    const result = buildInsightPhrase("developing", "none", NO_INSIGHTS, qs, false);
    expect(result).toContain("finish");
  });

  it("developing + none coach + complete → 'guided practice'", () => {
    const qs = [makeQ("developing")];
    const result = buildInsightPhrase("developing", "none", NO_INSIGHTS, qs, true);
    expect(result).toContain("guided practice");
  });

  // === Needs-support scenarios ===

  it("needs-support + struggled consistently → '1:1'", () => {
    const insights = { ...NO_INSIGHTS, struggledConsistently: true };
    const qs = [makeQ("developing"), makeQ("developing")];
    const result = buildInsightPhrase("needs-support", "high", insights, qs, true);
    expect(result).toContain("1:1");
    expect(result.length).toBeGreaterThan(0);
  });

  it("needs-support + complete → non-empty", () => {
    const qs = [makeQ("developing")];
    const result = buildInsightPhrase("needs-support", "none", NO_INSIGHTS, qs, true);
    expect(result.length).toBeGreaterThan(0);
  });

  // === Mixed / edge cases ===

  it("inconsistency phrase for mixed results (3+ questions)", () => {
    const qs = [makeQ("demonstrated"), makeQ("developing"), makeQ("developing")];
    const result = buildInsightPhrase("developing", "moderate", NO_INSIGHTS, qs, true);
    expect(result).toContain("Inconsistent");
  });

  it("manual review phrase when needs-review questions exist", () => {
    const qs = [makeQ("needs-review"), makeQ("demonstrated")];
    const result = buildInsightPhrase("developing", "none", NO_INSIGHTS, qs, true);
    expect(result).toContain("manual review");
  });

  // === Sanity: started submissions NEVER produce empty insight ===

  describe("non-empty guarantee for started submissions", () => {
    const levels: UnderstandingLevel[] = ["strong", "developing", "needs-support"];
    const supports: CoachSupportLevel[] = ["none", "minimal", "moderate", "high"];

    for (const level of levels) {
      for (const support of supports) {
        it(`${level} + ${support} + complete → non-empty`, () => {
          const qs = [makeQ("demonstrated"), makeQ("developing")];
          const result = buildInsightPhrase(level, support, NO_INSIGHTS, qs, true);
          expect(result.length).toBeGreaterThan(0);
        });

        it(`${level} + ${support} + incomplete → non-empty`, () => {
          const qs = [makeQ("developing")];
          const result = buildInsightPhrase(level, support, NO_INSIGHTS, qs, false);
          expect(result.length).toBeGreaterThan(0);
        });
      }
    }
  });
});

// ============================================
// buildJourneySummary
// ============================================

describe("buildJourneySummary", () => {
  const NO_INSIGHTS: LearningJourneyInsights = {
    startedStrong: false,
    improvedOverTime: false,
    struggledConsistently: false,
    recoveredWithSupport: false,
  };

  function makeQ(outcome: "demonstrated" | "with-support" | "developing" | "needs-review" | "not-attempted"): QuestionSummary {
    return {
      questionId: "q1",
      questionNumber: 1,
      questionText: "Test",
      outcome,
      usedHint: false,
      hintCount: 0,
      totalHintsAvailable: 2,
      improvedAfterHelp: false,
      studentResponse: "response",
      hasVoiceRecording: false,
    };
  }

  it("returns 'Not started yet' for no questions and not complete", () => {
    expect(buildJourneySummary("needs-support", "none", NO_INSIGHTS, [], false)).toBe("Not started yet");
  });

  it("returns 'No responses recorded' for no questions but complete", () => {
    expect(buildJourneySummary("needs-support", "none", NO_INSIGHTS, [], true)).toBe("No responses recorded");
  });

  it("returns 'Solved independently' for all demonstrated + none coach", () => {
    const qs = [makeQ("demonstrated"), makeQ("demonstrated")];
    expect(buildJourneySummary("strong", "none", NO_INSIGHTS, qs, true)).toBe("Solved independently");
  });

  it("returns 'Solved independently' for all demonstrated + minimal coach", () => {
    const qs = [makeQ("demonstrated"), makeQ("demonstrated")];
    expect(buildJourneySummary("strong", "minimal", NO_INSIGHTS, qs, true)).toBe("Solved independently");
  });

  it("returns 'Got it right with some coaching' for all demonstrated + moderate coach", () => {
    const qs = [makeQ("demonstrated"), makeQ("demonstrated")];
    expect(buildJourneySummary("strong", "moderate", NO_INSIGHTS, qs, true)).toBe("Got it right with some coaching");
  });

  it("returns 'Solved with minimal guidance' for strong + minimal", () => {
    const qs = [makeQ("demonstrated"), makeQ("developing")];
    expect(buildJourneySummary("strong", "minimal", NO_INSIGHTS, qs, true)).toBe("Solved with minimal guidance");
  });

  it("returns 'Needed help to get started, then succeeded' for strong + recovered", () => {
    const qs = [makeQ("demonstrated"), makeQ("with-support")];
    const insights = { ...NO_INSIGHTS, recoveredWithSupport: true };
    expect(buildJourneySummary("strong", "moderate", insights, qs, true)).toBe("Needed help to get started, then succeeded");
  });

  it("returns 'Multiple attempts, improving' for developing + improved", () => {
    const qs = [makeQ("developing"), makeQ("demonstrated")];
    const insights = { ...NO_INSIGHTS, improvedOverTime: true };
    expect(buildJourneySummary("developing", "moderate", insights, qs, true)).toBe("Multiple attempts, improving");
  });

  it("returns 'Needed significant support throughout' for developing + high coach", () => {
    const qs = [makeQ("developing"), makeQ("with-support")];
    expect(buildJourneySummary("developing", "high", NO_INSIGHTS, qs, true)).toBe("Needed significant support throughout");
  });

  it("returns 'Struggled throughout' for needs-support + struggled consistently", () => {
    const qs = [makeQ("developing"), makeQ("developing")];
    const insights = { ...NO_INSIGHTS, struggledConsistently: true };
    expect(buildJourneySummary("needs-support", "high", insights, qs, true)).toBe("Struggled throughout — may need 1:1 time");
  });

  it("returns 'Still working on core concepts' as fallback for needs-support", () => {
    const qs = [makeQ("developing")];
    expect(buildJourneySummary("needs-support", "minimal", NO_INSIGHTS, qs, true)).toBe("Still working on core concepts");
  });

  it("returns 'Mixed results' for needs-support with mixed outcomes", () => {
    const qs = [makeQ("needs-review"), makeQ("developing")];
    expect(buildJourneySummary("needs-support", "moderate", NO_INSIGHTS, qs, true)).toBe("Mixed results — some concepts clicked, others didn't");
  });
});

// ============================================
// getStepLabel
// ============================================

describe("getStepLabel", () => {
  it("maps ones_sum to 'Adding ones'", () => {
    expect(getStepLabel("ones_sum")).toBe("Adding ones");
  });

  it("maps tens_sum to 'Adding tens'", () => {
    expect(getStepLabel("tens_sum")).toBe("Adding tens");
  });

  it("maps combine to 'Combining results'", () => {
    expect(getStepLabel("combine")).toBe("Combining results");
  });

  it("maps regroup to 'Regrouping'", () => {
    expect(getStepLabel("regroup")).toBe("Regrouping");
  });

  it("falls back to replacing underscores for unknown kinds", () => {
    expect(getStepLabel("some_new_step")).toBe("some new step");
  });
});
