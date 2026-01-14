/**
 * A CoachSession represents a freeform "Ask Coach" conversation
 * where a student explores topics with the AI coach outside of
 * a structured lesson.
 */

export interface CoachMessage {
  role: "student" | "coach";
  message: string;
  timestamp: string;
}

export type IntentLabel = "support-seeking" | "enrichment-seeking" | "mixed";

export interface CoachSession {
  id: string;
  studentId: string;
  studentName: string;
  topics: string[];              // Lesson titles the student selected
  messages: CoachMessage[];
  mode: "voice" | "type";
  startedAt: string;
  endedAt?: string;

  // Intent scoring (computed on save)
  supportScore: number;          // Sum of support-seeking phrase matches
  enrichmentScore: number;       // Sum of enrichment-seeking phrase matches
  intentLabel: IntentLabel;
}

// Phrase lists for intent detection
export const SUPPORT_PHRASES = [
  "i don't understand",
  "can you explain",
  "what did i do wrong",
  "i'm confused about",
  "i don't get it",
  "help me with",
  "i'm stuck",
  "why doesn't this work",
  "i need help",
  "can you help me",
];

export const ENRICHMENT_PHRASES = [
  "can you give me another example",
  "can we go deeper",
  "what happens if",
  "is there a harder version",
  "can you challenge me",
  "tell me more",
  "i want to learn about",
  "what about",
  "can you show me more",
  "i'm curious about",
];

/**
 * Detect intent from a single message
 * Returns the score delta: positive for support, negative for enrichment
 */
export function detectMessageIntent(message: string): { support: number; enrichment: number } {
  const lowerMessage = message.toLowerCase();
  let support = 0;
  let enrichment = 0;

  for (const phrase of SUPPORT_PHRASES) {
    if (lowerMessage.includes(phrase)) {
      support += 2;
    }
  }

  for (const phrase of ENRICHMENT_PHRASES) {
    if (lowerMessage.includes(phrase)) {
      enrichment += 2;
    }
  }

  return { support, enrichment };
}

/**
 * Compute the overall intent label based on scores
 */
export function computeIntentLabel(supportScore: number, enrichmentScore: number): IntentLabel {
  if (supportScore > enrichmentScore + 2) {
    return "support-seeking";
  }
  if (enrichmentScore > supportScore + 2) {
    return "enrichment-seeking";
  }
  return "mixed";
}

/**
 * Compute intent scores for an entire conversation
 */
export function computeSessionIntent(messages: CoachMessage[]): {
  supportScore: number;
  enrichmentScore: number;
  intentLabel: IntentLabel;
} {
  let supportScore = 0;
  let enrichmentScore = 0;

  for (const msg of messages) {
    if (msg.role === "student") {
      const { support, enrichment } = detectMessageIntent(msg.message);
      supportScore += support;
      enrichmentScore += enrichment;
    }
  }

  return {
    supportScore,
    enrichmentScore,
    intentLabel: computeIntentLabel(supportScore, enrichmentScore),
  };
}
