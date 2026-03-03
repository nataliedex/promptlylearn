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

import { calculateQuestionOutcome, wasHintUsed } from "./teacherDashboardUtils";
import type { PromptResponse } from "../services/api";

// Helper to create a minimal PromptResponse
function createResponse(
  response: string,
  hintUsed = false,
  hintCountUsed?: number
): PromptResponse {
  return {
    promptId: "test-prompt",
    response,
    hintUsed,
    hintCountUsed,
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
      // Q1: "What are three different types of weather? Describe each one."
      // Response: "I don't know rainbows butterflies and umbrellas"
      const response = createResponse("I don't know rainbows butterflies and umbrellas");

      // No score provided - this was the bug scenario
      const outcome = calculateQuestionOutcome(response, undefined);

      // BEFORE FIX: would return "demonstrated" (WRONG)
      // AFTER FIX: returns "needs-review" (CORRECT)
      expect(outcome).toBe("needs-review");
      expect(outcome).not.toBe("demonstrated");
    });

    it("should return needs-review for time machine response without score", () => {
      // Q2: "How can you predict what the weather might be tomorrow?"
      // Response: "I don't know you could use a time machine"
      const response = createResponse("I don't know you could use a time machine");

      // No score provided - this was the bug scenario
      const outcome = calculateQuestionOutcome(response, undefined);

      // BEFORE FIX: would return "demonstrated" (WRONG)
      // AFTER FIX: returns "needs-review" (CORRECT)
      expect(outcome).toBe("needs-review");
      expect(outcome).not.toBe("demonstrated");
    });
  });

  describe("core outcome logic", () => {
    // Test case a) score 85 + no hint => demonstrated
    it("score 85 + no hint => demonstrated", () => {
      const response = createResponse("Sunny, rainy, and snowy are three types of weather.", false);
      const outcome = calculateQuestionOutcome(response, 85);
      expect(outcome).toBe("demonstrated");
    });

    // Test case b) score 85 + hintUsed => with-support
    it("score 85 + hintUsed => with-support", () => {
      const response = createResponse("After the hint, I know: sunny, rainy, snowy", true);
      const outcome = calculateQuestionOutcome(response, 85);
      expect(outcome).toBe("with-support");
    });

    // Test case c) score 60 + hintUsed => developing (NOT with-support)
    it("score 60 + hintUsed => developing (not with-support, didn't succeed)", () => {
      const response = createResponse("Maybe sunny and rainy?", true);
      const outcome = calculateQuestionOutcome(response, 60);
      expect(outcome).toBe("developing");
      expect(outcome).not.toBe("with-support");
    });

    // Test case: score 60 + no hint => developing
    it("score 60 + no hint => developing", () => {
      const response = createResponse("Maybe sunny and rainy?", false);
      const outcome = calculateQuestionOutcome(response, 60);
      expect(outcome).toBe("developing");
    });

    // Test case d) score undefined => needs-review
    it("score undefined => needs-review", () => {
      const response = createResponse("Some response");
      const outcome = calculateQuestionOutcome(response, undefined);
      expect(outcome).toBe("needs-review");
    });

    // Test case e) empty response => not-attempted
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
