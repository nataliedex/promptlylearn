/**
 * Example Reasoning Graphs
 *
 * Three concrete examples demonstrating the generalized reasoning graph
 * model across different subjects:
 *
 * 1. Two-digit addition (11 + 14 = 25) — math
 * 2. Concept explanation ("What does 'variable' mean?") — vocabulary
 * 3. Science cause-and-effect ("Why does ice melt?") — science
 *
 * These serve as both documentation and test fixtures.
 */

import type { ReasoningGraph } from "./reasoningGraph";

// ============================================================================
// 1. Math: Two-digit addition (11 + 14 = 25)
// ============================================================================

export const MATH_ADDITION_GRAPH: ReasoningGraph = {
  id: "math-11+14",
  subject: "math",
  description: "Explain how to solve 11 + 14",
  expectedConclusion: "25",
  nodes: [
    {
      id: "ones_sum",
      type: "compute_value",
      label: "Add the ones",
      evidence: {
        exactStatements: ["1 + 4 = 5"],
        patterns: [/(?=.*\b1\b)(?=.*\b4\b)(?=.*\b5\b)/i],
      },
      remediation: {
        directProbe: "What do you get when you add 1 and 4?",
        simplerProbe: "Let's do just the ones. What is 1 + 4?",
        hint: "Hint: Start with the ones. What is 1 plus 4?",
      },
      misconceptions: [
        {
          category: "WRONG_OPERATION",
          matchPatterns: [
            /\b(?:subtract(?:ed|ing)?|minus|take\s+away)\b/i,
          ],
          description: "Used subtraction on an addition problem.",
          redirectTemplate: "We're adding in this problem, not subtracting. {probe}",
        },
      ],
      priorityTier: 0,
    },
    {
      id: "tens_sum",
      type: "compute_value",
      label: "Add the tens",
      evidence: {
        exactStatements: ["10 + 10 = 20", "1 + 1 = 2"],
        patterns: [
          /(?=.*\b10\b)(?=.*\b10\b)(?=.*\b20\b)/i,
          /(?=.*\b1\b)(?=.*\b1\b)(?=.*\b2\b)/i,
        ],
        requiredKeywords: ["20"],
      },
      remediation: {
        directProbe: "What do you get when you add 10 and 10?",
        simplerProbe: "Let's do just the tens. What is 10 + 10?",
        hint: "Hint: Now the tens. What is 10 plus 10?",
      },
      misconceptions: [],
      priorityTier: 0,
    },
    {
      id: "combine",
      type: "combine_parts",
      label: "Put them together",
      evidence: {
        exactStatements: ["20 + 5 = 25"],
        patterns: [/(?=.*\b20\b)(?=.*\b5\b)(?=.*\b25\b)/i],
        requiredKeywords: ["25"],
      },
      remediation: {
        directProbe: "What do you get when you put 20 and 5 together?",
        combinePrompt: "Now put them together. What is 20 plus 5?",
        hint: "Hint: You have 20 and 5. Put them together. What is 20 plus 5?",
      },
      prerequisites: ["ones_sum", "tens_sum"],
      priorityTier: 1,
    },
  ],
};

// ============================================================================
// 2. Vocabulary: "What does 'variable' mean?"
// ============================================================================

export const VOCABULARY_VARIABLE_GRAPH: ReasoningGraph = {
  id: "vocab-variable",
  subject: "vocabulary",
  description: "Explain what a variable means in math",
  expectedConclusion: "A variable is a letter that stands for a number.",
  nodes: [
    {
      id: "define_term",
      type: "define_term",
      label: "Define variable",
      evidence: {
        requiredKeywords: ["letter", "number"],
        keywordBank: {
          words: ["letter", "symbol", "stands for", "represents", "placeholder", "number", "value", "unknown"],
          minCount: 2,
        },
      },
      remediation: {
        directProbe: "What is a variable? What does it look like and what does it stand for?",
        simplerProbe: "In math, you sometimes see letters like x or n. What do those letters mean?",
        hint: "Hint: Think about when you see a letter like x in a math problem. What does that letter do?",
      },
      misconceptions: [
        {
          category: "RECITES_WITHOUT_EXPLAINING",
          requiredKeywords: ["variable"],
          absentKeywords: ["letter", "symbol", "stands for", "represents", "number", "value", "unknown", "placeholder"],
          description: "Repeated the word 'variable' without explaining what it means.",
          redirectTemplate: "You said the word 'variable' — now tell me what it actually means. {probe}",
        },
        {
          category: "CONFUSES_RELATED_TERM",
          matchPatterns: [/\b(?:equation|expression|formula)\b/i],
          absentKeywords: ["letter", "symbol", "stands for", "represents"],
          description: "Confused variable with a related math term.",
          redirectTemplate: "That's a different math idea. A variable is simpler than that. {probe}",
        },
      ],
      priorityTier: 0,
    },
    {
      id: "give_example",
      type: "give_example",
      label: "Give an example",
      evidence: {
        patterns: [
          /\b[xynab]\s*(?:=|equals|could\s+be|might\s+be|is)\s*\d/i,
          /\blike\s+[xynab]\b/i,
          /\bfor\s+example\b/i,
        ],
        keywordBank: {
          words: ["x", "y", "n", "a", "b", "example", "like", "such as"],
          minCount: 1,
        },
      },
      remediation: {
        directProbe: "Can you give me an example of a variable?",
        simplerProbe: "Can you name a letter that could be a variable?",
        hint: "Hint: Letters like x, y, or n are common variables. Can you use one in a sentence?",
      },
      priorityTier: 1,
    },
  ],
};

// ============================================================================
// 3. Science: "Why does ice melt?"
// ============================================================================

export const SCIENCE_ICE_MELTING_GRAPH: ReasoningGraph = {
  id: "science-ice-melting",
  subject: "science",
  description: "Explain why ice melts when it gets warm",
  expectedConclusion: "Heat causes ice to change from a solid to a liquid.",
  nodes: [
    {
      id: "identify_cause",
      type: "explain_cause_effect",
      label: "Identify the cause (heat)",
      evidence: {
        keywordBank: {
          words: ["heat", "warm", "hot", "temperature", "sun", "energy", "warmer"],
          minCount: 1,
        },
      },
      remediation: {
        directProbe: "What causes ice to melt? What needs to happen to the ice?",
        simplerProbe: "Think about when you leave ice outside on a sunny day. What makes it change?",
        hint: "Hint: Think about temperature. Is it something getting warmer or colder?",
      },
      misconceptions: [
        {
          category: "CAUSE_EFFECT_REVERSED",
          matchPatterns: [/\bice\s+(?:makes?|causes?|creates?)\s+(?:heat|warm)/i],
          description: "Reversed cause and effect — said ice causes heat.",
          redirectTemplate: "It's actually the other way around. {probe}",
        },
      ],
      priorityTier: 0,
    },
    {
      id: "describe_change",
      type: "describe_process_step",
      label: "Describe what happens (solid to liquid)",
      evidence: {
        keywordBank: {
          words: ["solid", "liquid", "water", "melts", "changes", "turns into", "becomes"],
          minCount: 2,
        },
        patterns: [
          /\b(?:solid|ice)\s+(?:to|into|becomes?)\s+(?:liquid|water)\b/i,
          /\bturns?\s+into\s+water\b/i,
          /\bmelts?\s+into\s+water\b/i,
        ],
      },
      remediation: {
        directProbe: "When ice melts, what does it turn into? What kind of change is that?",
        simplerProbe: "What do you see when ice melts? What does it become?",
        hint: "Hint: Ice is a solid. When it melts, it changes to a different form. What form?",
      },
      misconceptions: [
        {
          category: "STEPS_OUT_OF_ORDER",
          matchPatterns: [/\b(?:gas|steam|evaporat)/i],
          absentKeywords: ["liquid", "water", "melts"],
          description: "Skipped to evaporation without describing melting first.",
          redirectTemplate: "That's a later step. First, let's talk about what happens right when the ice gets warm. {probe}",
        },
      ],
      priorityTier: 0,
    },
    {
      id: "explain_why",
      type: "explain_why",
      label: "Explain why (heat gives energy to molecules)",
      evidence: {
        keywordBank: {
          words: ["energy", "molecules", "particles", "move", "faster", "break apart", "vibrate", "bonds"],
          minCount: 2,
        },
        patterns: [
          /\b(?:molecules?|particles?)\s+(?:move|vibrat|speed|go)\s+(?:faster|more|around)\b/i,
        ],
      },
      remediation: {
        directProbe: "Why does heat make ice turn into water? What happens inside the ice?",
        simplerProbe: "Think about the tiny pieces (molecules) inside the ice. What does heat do to them?",
        hint: "Hint: Heat gives energy to the tiny molecules in the ice. What do they start doing?",
      },
      priorityTier: 1,
    },
  ],
};
