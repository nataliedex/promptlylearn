/**
 * Node Remediation Tests
 *
 * 8 test categories:
 * 1. Existing math behavior still works (via adapter)
 * 2. Node adapter from old math reasoningSteps works
 * 3. Already-satisfied node not re-probed
 * 4. Unordered node satisfaction works
 * 5. Hints align to exact missing node
 * 6. Misconception redirect is concrete and node-specific
 * 7. Concept-explanation example works
 * 8. Non-math example works (science)
 */

import {
  evaluateNodeEvidence,
  accumulateNodeEvidence,
  classifyNodeStudentState,
  detectNodeMisconception,
  getNextMissingNode,
  getNodeRemediationMove,
  shouldUseNodeRemediation,
} from "./nodeRemediation";
import { mathStepsToReasoningGraph } from "./reasoningGraphAdapter";
import {
  MATH_ADDITION_GRAPH,
  VOCABULARY_VARIABLE_GRAPH,
  SCIENCE_ICE_MELTING_GRAPH,
} from "./exampleReasoningGraphs";
import type { ReasoningStep } from "./prompt";
import type { MathProblem } from "./mathProblem";
import type { ReasoningGraph, NodeAccumulation } from "./reasoningGraph";

// ============================================================================
// Test fixtures
// ============================================================================

const MATH_STEPS_11_14: ReasoningStep[] = [
  {
    id: "step_1",
    label: "Add the ones",
    expectedStatements: ["1 + 4 = 5"],
    probe: "What do you get when you add 1 and 4?",
    kind: "ones_sum",
  },
  {
    id: "step_2",
    label: "Add the tens",
    expectedStatements: ["10 + 10 = 20"],
    probe: "What do you get when you add 10 and 10?",
    kind: "tens_sum",
  },
  {
    id: "step_3",
    label: "Put them together",
    expectedStatements: ["20 + 5 = 25"],
    probe: "What do you get when you put 20 and 5 together?",
    kind: "combine",
  },
];

const MATH_PROBLEM_11_14: MathProblem = {
  skill: "two_digit_addition",
  a: 11,
  b: 14,
  expression: "11 + 14",
  correctAnswer: 25,
  requiresRegrouping: false,
  expectedStrategyTags: ["add ones", "add tens"],
  commonWrongAnswers: [{ answer: 15, misconception: "added only ones digits" }],
};

// ============================================================================
// 1. Existing math behavior still works (via hand-built graph)
// ============================================================================

describe("1. Existing math behavior via graph", () => {
  const graph = MATH_ADDITION_GRAPH;

  test("all nodes satisfied + conclusion → WRAP_SUCCESS", () => {
    const acc: NodeAccumulation = {
      satisfiedNodeIds: ["ones_sum", "tens_sum", "combine"],
      missingNodeIds: [],
      newlySatisfiedNodeIds: [],
      completionRatio: 1,
      conclusionReached: true,
    };
    const move = getNodeRemediationMove(graph, acc, "25");
    expect(move?.type).toBe("WRAP_SUCCESS");
  });

  test("wrong answer with no nodes satisfied → NODE_PROBE_DIRECT for first node", () => {
    const acc: NodeAccumulation = {
      satisfiedNodeIds: [],
      missingNodeIds: ["ones_sum", "tens_sum", "combine"],
      newlySatisfiedNodeIds: [],
      completionRatio: 0,
      conclusionReached: false,
    };
    const move = getNodeRemediationMove(graph, acc, "I think it's 30");
    expect(move?.type).toBe("NODE_PROBE_DIRECT");
    expect(move?.targetNodeId).toBe("ones_sum");
  });

  test("partial progress → NODE_ACKNOWLEDGE_AND_PROBE", () => {
    const acc: NodeAccumulation = {
      satisfiedNodeIds: ["ones_sum"],
      missingNodeIds: ["tens_sum", "combine"],
      newlySatisfiedNodeIds: ["ones_sum"],
      completionRatio: 1 / 3,
      conclusionReached: false,
    };
    const move = getNodeRemediationMove(graph, acc, "1 + 4 = 5");
    expect(move?.type).toBe("NODE_ACKNOWLEDGE_AND_PROBE");
    expect(move?.targetNodeId).toBe("tens_sum");
    expect(move?.text).toMatch(/^Good\./);
  });
});

// ============================================================================
// 2. Node adapter from old math reasoningSteps
// ============================================================================

describe("2. Adapter: math steps → reasoning graph", () => {
  test("converts 3 steps to 3 nodes with correct types", () => {
    const graph = mathStepsToReasoningGraph(MATH_STEPS_11_14, MATH_PROBLEM_11_14);
    expect(graph.nodes).toHaveLength(3);
    expect(graph.nodes[0].type).toBe("compute_value");
    expect(graph.nodes[1].type).toBe("compute_value");
    expect(graph.nodes[2].type).toBe("combine_parts");
    expect(graph.subject).toBe("math");
  });

  test("combine step has prerequisites on foundational steps", () => {
    const graph = mathStepsToReasoningGraph(MATH_STEPS_11_14, MATH_PROBLEM_11_14);
    const combineNode = graph.nodes.find(n => n.id === "step_3");
    expect(combineNode?.prerequisites).toEqual(["step_1", "step_2"]);
  });

  test("foundational steps have priority tier 0, combine has tier 1", () => {
    const graph = mathStepsToReasoningGraph(MATH_STEPS_11_14, MATH_PROBLEM_11_14);
    expect(graph.nodes[0].priorityTier).toBe(0);
    expect(graph.nodes[1].priorityTier).toBe(0);
    expect(graph.nodes[2].priorityTier).toBe(1);
  });

  test("adapted graph preserves probe text", () => {
    const graph = mathStepsToReasoningGraph(MATH_STEPS_11_14, MATH_PROBLEM_11_14);
    expect(graph.nodes[0].remediation.directProbe).toBe(
      "What do you get when you add 1 and 4?"
    );
  });

  test("adapted graph includes misconception patterns for addition", () => {
    const graph = mathStepsToReasoningGraph(MATH_STEPS_11_14, MATH_PROBLEM_11_14);
    const node = graph.nodes[0];
    expect(node.misconceptions?.length).toBeGreaterThan(0);
    const wrongOp = node.misconceptions?.find(m => m.category === "WRONG_OPERATION");
    expect(wrongOp).toBeDefined();
    expect(wrongOp?.redirectTemplate).toContain("adding");
  });
});

// ============================================================================
// 3. Already-satisfied node not re-probed
// ============================================================================

describe("3. Already-satisfied node not re-probed", () => {
  test("satisfied node is skipped, probes next missing", () => {
    const graph = MATH_ADDITION_GRAPH;
    const acc: NodeAccumulation = {
      satisfiedNodeIds: ["ones_sum"],
      missingNodeIds: ["tens_sum", "combine"],
      newlySatisfiedNodeIds: [],
      completionRatio: 1 / 3,
      conclusionReached: false,
    };
    const move = getNodeRemediationMove(graph, acc, "I don't know");
    expect(move?.targetNodeId).toBe("tens_sum");
    expect(move?.targetNodeId).not.toBe("ones_sum");
  });

  test("accumulation correctly tracks prior evidence", () => {
    const graph = MATH_ADDITION_GRAPH;
    const history = [
      { role: "student", message: "1 plus 4 is 5" },
      { role: "coach", message: "Good. What about the tens?" },
    ];
    const acc = accumulateNodeEvidence(graph, history, "um I don't know");
    expect(acc.satisfiedNodeIds).toContain("ones_sum");
    expect(acc.missingNodeIds).toContain("tens_sum");
    expect(acc.newlySatisfiedNodeIds).toHaveLength(0); // ones was prior
  });
});

// ============================================================================
// 4. Unordered node satisfaction
// ============================================================================

describe("4. Unordered node satisfaction", () => {
  test("student can satisfy tens before ones", () => {
    const graph = MATH_ADDITION_GRAPH;
    const history: Array<{ role: string; message: string }> = [];
    const acc = accumulateNodeEvidence(graph, history, "10 plus 10 is 20");
    expect(acc.satisfiedNodeIds).toContain("tens_sum");
    expect(acc.missingNodeIds).toContain("ones_sum");
  });

  test("vocabulary nodes can be satisfied in any order", () => {
    const graph = VOCABULARY_VARIABLE_GRAPH;
    // Satisfy example first
    const acc = accumulateNodeEvidence(graph, [], "like x equals 5");
    expect(acc.satisfiedNodeIds).toContain("give_example");
  });
});

// ============================================================================
// 5. Hints align to exact missing node
// ============================================================================

describe("5. Hints align to exact missing node", () => {
  test("hint request targets first missing node", () => {
    const graph = MATH_ADDITION_GRAPH;
    const acc: NodeAccumulation = {
      satisfiedNodeIds: [],
      missingNodeIds: ["ones_sum", "tens_sum", "combine"],
      newlySatisfiedNodeIds: [],
      completionRatio: 0,
      conclusionReached: false,
    };
    const move = getNodeRemediationMove(graph, acc, "can I get a hint?");
    expect(move?.type).toBe("NODE_HINT");
    expect(move?.targetNodeId).toBe("ones_sum");
    expect(move?.text).toContain("ones");
  });

  test("hint with ones done targets tens", () => {
    const graph = MATH_ADDITION_GRAPH;
    const acc: NodeAccumulation = {
      satisfiedNodeIds: ["ones_sum"],
      missingNodeIds: ["tens_sum", "combine"],
      newlySatisfiedNodeIds: [],
      completionRatio: 1 / 3,
      conclusionReached: false,
    };
    const move = getNodeRemediationMove(graph, acc, "help");
    expect(move?.type).toBe("NODE_HINT");
    expect(move?.targetNodeId).toBe("tens_sum");
  });

  test("vocabulary hint uses node-specific text", () => {
    const graph = VOCABULARY_VARIABLE_GRAPH;
    const acc: NodeAccumulation = {
      satisfiedNodeIds: [],
      missingNodeIds: ["define_term", "give_example"],
      newlySatisfiedNodeIds: [],
      completionRatio: 0,
      conclusionReached: false,
    };
    const move = getNodeRemediationMove(graph, acc, "give me a hint");
    expect(move?.type).toBe("NODE_HINT");
    expect(move?.targetNodeId).toBe("define_term");
    expect(move?.text).toContain("letter");
  });
});

// ============================================================================
// 6. Misconception redirect is concrete and node-specific
// ============================================================================

describe("6. Misconception redirect", () => {
  test("subtraction language on addition → WRONG_OPERATION redirect", () => {
    const graph = MATH_ADDITION_GRAPH;
    const acc: NodeAccumulation = {
      satisfiedNodeIds: [],
      missingNodeIds: ["ones_sum", "tens_sum", "combine"],
      newlySatisfiedNodeIds: [],
      completionRatio: 0,
      conclusionReached: false,
    };
    const move = getNodeRemediationMove(graph, acc, "I subtracted and got 3");
    expect(move?.type).toBe("NODE_MISCONCEPTION_REDIRECT");
    expect(move?.text).toContain("adding");
    expect(move?.text).toContain("not subtracting");
  });

  test("vocabulary: recites without explaining → redirect", () => {
    const graph = VOCABULARY_VARIABLE_GRAPH;
    const acc: NodeAccumulation = {
      satisfiedNodeIds: [],
      missingNodeIds: ["define_term", "give_example"],
      newlySatisfiedNodeIds: [],
      completionRatio: 0,
      conclusionReached: false,
    };
    const move = getNodeRemediationMove(graph, acc, "a variable is a variable");
    expect(move?.type).toBe("NODE_MISCONCEPTION_REDIRECT");
    expect(move?.misconceptionCategory).toBe("RECITES_WITHOUT_EXPLAINING");
  });

  test("science: cause-effect reversed → redirect", () => {
    const graph = SCIENCE_ICE_MELTING_GRAPH;
    const acc: NodeAccumulation = {
      satisfiedNodeIds: [],
      missingNodeIds: ["identify_cause", "describe_change", "explain_why"],
      newlySatisfiedNodeIds: [],
      completionRatio: 0,
      conclusionReached: false,
    };
    const move = getNodeRemediationMove(graph, acc, "ice makes heat");
    expect(move?.type).toBe("NODE_MISCONCEPTION_REDIRECT");
    expect(move?.misconceptionCategory).toBe("CAUSE_EFFECT_REVERSED");
    expect(move?.text).toContain("other way around");
  });
});

// ============================================================================
// 7. Concept-explanation example works
// ============================================================================

describe("7. Concept explanation: vocabulary graph", () => {
  test("full correct answer satisfies define_term node", () => {
    const graph = VOCABULARY_VARIABLE_GRAPH;
    const acc = accumulateNodeEvidence(
      graph, [], "a variable is a letter that stands for a number"
    );
    expect(acc.satisfiedNodeIds).toContain("define_term");
  });

  test("partial answer with keyword bank satisfies define_term", () => {
    const graph = VOCABULARY_VARIABLE_GRAPH;
    const acc = accumulateNodeEvidence(
      graph, [], "it's a symbol that represents an unknown value"
    );
    expect(acc.satisfiedNodeIds).toContain("define_term");
  });

  test("confused related term triggers misconception", () => {
    const graph = VOCABULARY_VARIABLE_GRAPH;
    const node = graph.nodes[0]; // define_term
    const result = detectNodeMisconception("it's an equation", node);
    expect(result?.category).toBe("CONFUSES_RELATED_TERM");
  });

  test("uncertain student gets simpler probe", () => {
    const graph = VOCABULARY_VARIABLE_GRAPH;
    const acc: NodeAccumulation = {
      satisfiedNodeIds: [],
      missingNodeIds: ["define_term", "give_example"],
      newlySatisfiedNodeIds: [],
      completionRatio: 0,
      conclusionReached: false,
    };
    const move = getNodeRemediationMove(graph, acc, "I don't know");
    expect(move?.type).toBe("NODE_PROBE_SIMPLER");
    expect(move?.targetNodeId).toBe("define_term");
    expect(move?.text).toContain("letters like x");
  });

  test("define_term satisfied → probes give_example next", () => {
    const graph = VOCABULARY_VARIABLE_GRAPH;
    const acc: NodeAccumulation = {
      satisfiedNodeIds: ["define_term"],
      missingNodeIds: ["give_example"],
      newlySatisfiedNodeIds: ["define_term"],
      completionRatio: 0.5,
      conclusionReached: false,
    };
    const move = getNodeRemediationMove(graph, acc, "a variable is a letter for a number");
    expect(move?.type).toBe("NODE_ACKNOWLEDGE_AND_PROBE");
    expect(move?.targetNodeId).toBe("give_example");
  });
});

// ============================================================================
// 8. Non-math example works (science)
// ============================================================================

describe("8. Science graph: ice melting", () => {
  test("mentioning heat satisfies identify_cause node", () => {
    const graph = SCIENCE_ICE_MELTING_GRAPH;
    const acc = accumulateNodeEvidence(graph, [], "heat makes the ice melt");
    expect(acc.satisfiedNodeIds).toContain("identify_cause");
  });

  test("describing solid to liquid satisfies describe_change", () => {
    const graph = SCIENCE_ICE_MELTING_GRAPH;
    const acc = accumulateNodeEvidence(
      graph, [], "it turns into water because it melts"
    );
    expect(acc.satisfiedNodeIds).toContain("describe_change");
  });

  test("mentioning molecules moving faster satisfies explain_why", () => {
    const graph = SCIENCE_ICE_MELTING_GRAPH;
    const acc = accumulateNodeEvidence(
      graph, [], "the molecules move faster because of the energy"
    );
    expect(acc.satisfiedNodeIds).toContain("explain_why");
  });

  test("all three nodes → WRAP_SUCCESS", () => {
    const graph = SCIENCE_ICE_MELTING_GRAPH;
    const history = [
      { role: "student", message: "heat makes the ice warm" },
      { role: "coach", message: "Good. What does the ice become?" },
      { role: "student", message: "it turns into liquid water" },
      { role: "coach", message: "Why does that happen?" },
    ];
    const acc = accumulateNodeEvidence(
      graph, history, "the molecules get energy and move faster so they break apart"
    );
    expect(acc.missingNodeIds).toHaveLength(0);
    const move = getNodeRemediationMove(graph, acc, "done");
    expect(move?.type).toBe("WRAP_SUCCESS");
  });

  test("skipping to evaporation triggers STEPS_OUT_OF_ORDER", () => {
    const graph = SCIENCE_ICE_MELTING_GRAPH;
    const acc: NodeAccumulation = {
      satisfiedNodeIds: ["identify_cause"],
      missingNodeIds: ["describe_change", "explain_why"],
      newlySatisfiedNodeIds: [],
      completionRatio: 1 / 3,
      conclusionReached: false,
    };
    const move = getNodeRemediationMove(graph, acc, "it evaporates into gas");
    expect(move?.type).toBe("NODE_MISCONCEPTION_REDIRECT");
    expect(move?.misconceptionCategory).toBe("STEPS_OUT_OF_ORDER");
    expect(move?.text).toContain("later step");
  });

  test("multi-turn accumulation preserves prior evidence", () => {
    const graph = SCIENCE_ICE_MELTING_GRAPH;
    const history = [
      { role: "student", message: "heat makes it warm" },
      { role: "coach", message: "Good. What happens to the ice?" },
    ];
    const acc = accumulateNodeEvidence(graph, history, "I'm not sure");
    expect(acc.satisfiedNodeIds).toContain("identify_cause");
    expect(acc.missingNodeIds).toContain("describe_change");
    // Current turn doesn't satisfy anything new
    expect(acc.newlySatisfiedNodeIds).toHaveLength(0);
  });
});

// ============================================================================
// Additional: shouldUseNodeRemediation guard
// ============================================================================

describe("shouldUseNodeRemediation", () => {
  test("returns true with valid graph and accumulation", () => {
    expect(shouldUseNodeRemediation(MATH_ADDITION_GRAPH, {
      satisfiedNodeIds: [],
      missingNodeIds: ["ones_sum"],
      newlySatisfiedNodeIds: [],
      completionRatio: 0,
      conclusionReached: false,
    })).toBe(true);
  });

  test("returns false with null graph", () => {
    expect(shouldUseNodeRemediation(null, {
      satisfiedNodeIds: [],
      missingNodeIds: [],
      newlySatisfiedNodeIds: [],
      completionRatio: 0,
      conclusionReached: false,
    })).toBe(false);
  });

  test("returns false with empty nodes", () => {
    const empty: ReasoningGraph = { ...MATH_ADDITION_GRAPH, nodes: [] };
    expect(shouldUseNodeRemediation(empty, {
      satisfiedNodeIds: [],
      missingNodeIds: [],
      newlySatisfiedNodeIds: [],
      completionRatio: 0,
      conclusionReached: false,
    })).toBe(false);
  });

  test("returns false with null accumulation", () => {
    expect(shouldUseNodeRemediation(MATH_ADDITION_GRAPH, null)).toBe(false);
  });
});

// ============================================================================
// Additional: evaluateNodeEvidence edge cases
// ============================================================================

describe("evaluateNodeEvidence", () => {
  test("keyword bank with minCount threshold", () => {
    const node = VOCABULARY_VARIABLE_GRAPH.nodes[0]; // define_term
    // 2 keywords from bank (meets minCount of 2) → true
    expect(evaluateNodeEvidence(node, "it's a symbol that represents something")).toBe(true);
    // requiredKeywords: both "letter" AND "number" present → true
    expect(evaluateNodeEvidence(node, "a letter for a number")).toBe(true);
    // Only 1 keyword from bank (below minCount of 2) and missing "number" → false
    expect(evaluateNodeEvidence(node, "it's a letter")).toBe(false);
  });

  test("exact statement match is case-insensitive", () => {
    const node = MATH_ADDITION_GRAPH.nodes[0]; // ones_sum
    expect(evaluateNodeEvidence(node, "1 + 4 = 5")).toBe(true);
    expect(evaluateNodeEvidence(node, "1 + 4 = 5  ")).toBe(true);
  });

  test("empty response returns false", () => {
    const node = MATH_ADDITION_GRAPH.nodes[0];
    expect(evaluateNodeEvidence(node, "")).toBe(false);
    expect(evaluateNodeEvidence(node, "  ")).toBe(false);
  });
});

// ============================================================================
// Additional: getNextMissingNode with prerequisites
// ============================================================================

describe("getNextMissingNode respects prerequisites", () => {
  test("combine node not eligible until prereqs satisfied", () => {
    const graph = MATH_ADDITION_GRAPH;
    const acc: NodeAccumulation = {
      satisfiedNodeIds: [],
      missingNodeIds: ["ones_sum", "tens_sum", "combine"],
      newlySatisfiedNodeIds: [],
      completionRatio: 0,
      conclusionReached: false,
    };
    const next = getNextMissingNode(graph, acc);
    expect(next?.id).toBe("ones_sum"); // Not combine
  });

  test("combine node eligible after prereqs satisfied", () => {
    const graph = MATH_ADDITION_GRAPH;
    const acc: NodeAccumulation = {
      satisfiedNodeIds: ["ones_sum", "tens_sum"],
      missingNodeIds: ["combine"],
      newlySatisfiedNodeIds: [],
      completionRatio: 2 / 3,
      conclusionReached: false,
    };
    const next = getNextMissingNode(graph, acc);
    expect(next?.id).toBe("combine");
  });
});
