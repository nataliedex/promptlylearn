/**
 * Generalized Node Remediation Engine
 *
 * Subject-agnostic deterministic remediation for reasoning graphs.
 * Given a ReasoningGraph, NodeAccumulation, and student response,
 * selects the next coaching move from a fixed menu of move types.
 *
 * Every non-success turn is explainable as:
 *   "We asked about node X because node X is the next missing node
 *    and the student state was Y."
 *
 * Pure functions, no LLM calls.
 */

import type {
  ReasoningGraph,
  ReasoningNode,
  NodeAccumulation,
  NodeRemediationMove,
  NodeRemediationMoveType,
  StudentState,
  NodeMisconceptionCategory,
  MisconceptionPattern,
  EvidenceMatcher,
} from "./reasoningGraph";

// ============================================================================
// Shared detection patterns (reused from deterministicRemediation)
// ============================================================================

/** Patterns that indicate the student explicitly asked for a hint. */
const HINT_REQUEST = /\b(?:hint|help|clue|i need help|can you help|give me a hint|can i (?:have|get) a hint)\b/i;

/** Patterns that indicate uncertainty / "I don't know". */
const UNCERTAINTY_PATTERNS = [
  /\bi\s*don'?t\s*know\b/i,
  /\bno\s*idea\b/i,
  /\bi'?m\s*(?:not\s*sure|confused|stuck|lost)\b/i,
  /\bi\s*(?:can'?t|cannot)\s*(?:do|figure|solve|get)\b/i,
  /\bi\s*give\s*up\b/i,
  /^\s*(?:i\s*don'?t\s*know|idk|no|nope|um+|uh+)\s*[.!?]*\s*$/i,
];

/** No speech detected patterns. */
const NO_SPEECH = /^\s*$|no\s*speech\s*detected/i;

// ============================================================================
// Evidence evaluation
// ============================================================================

/**
 * Check if a student response satisfies a node's evidence requirements.
 * Returns true if ANY matcher succeeds.
 */
export function evaluateNodeEvidence(
  node: ReasoningNode,
  studentResponse: string,
  _conversationContext?: string[],
): boolean {
  const ev = node.evidence;
  const normalized = studentResponse.trim().toLowerCase();

  // Exact statement match
  if (ev.exactStatements?.length) {
    for (const stmt of ev.exactStatements) {
      if (normalized.includes(stmt.toLowerCase())) {
        return true;
      }
    }
  }

  // Regex pattern match
  if (ev.patterns?.length) {
    for (const pattern of ev.patterns) {
      if (pattern.test(normalized)) {
        return true;
      }
    }
  }

  // Required keywords: ALL must be present
  if (ev.requiredKeywords?.length) {
    const allPresent = ev.requiredKeywords.every(kw =>
      normalized.includes(kw.toLowerCase()),
    );
    if (allPresent) return true;
  }

  // Keyword bank: at least minCount from the bank
  if (ev.keywordBank) {
    const { words, minCount } = ev.keywordBank;
    const matchCount = words.filter(w =>
      normalized.includes(w.toLowerCase()),
    ).length;
    if (matchCount >= minCount) return true;
  }

  return false;
}

// ============================================================================
// Node accumulation across conversation
// ============================================================================

/**
 * Accumulate node evidence across the full conversation history.
 *
 * Evaluates each node's evidence matcher against every student utterance
 * in the conversation (including the current response). Tracks which
 * nodes are newly satisfied in the current turn.
 *
 * @param graph - The reasoning graph for this question
 * @param conversationHistory - Prior student/coach turns
 * @param currentResponse - The student's current response
 * @param conclusionReached - Whether the expected conclusion was reached
 *                            (caller determines this, since it may need
 *                            domain-specific logic like numeric comparison)
 */
export function accumulateNodeEvidence(
  graph: ReasoningGraph,
  conversationHistory: Array<{ role: string; message: string }>,
  currentResponse: string,
  conclusionReached: boolean = false,
): NodeAccumulation {
  const requiredNodes = graph.nodes.filter(n => n.required !== false);

  // Collect all student utterances (prior + current)
  const priorStudentMessages = conversationHistory
    .filter(h => h.role === "student")
    .map(h => h.message);

  // Check which nodes were satisfied BEFORE this turn
  const previouslySatisfied = new Set<string>();
  for (const node of requiredNodes) {
    for (const msg of priorStudentMessages) {
      if (evaluateNodeEvidence(node, msg)) {
        previouslySatisfied.add(node.id);
        break;
      }
    }
  }

  // Check which nodes are satisfied INCLUDING this turn
  const allSatisfied = new Set(previouslySatisfied);
  for (const node of requiredNodes) {
    if (!allSatisfied.has(node.id)) {
      if (evaluateNodeEvidence(node, currentResponse)) {
        allSatisfied.add(node.id);
      }
    }
  }

  // Determine newly satisfied
  const newlySatisfied = new Set<string>();
  for (const id of allSatisfied) {
    if (!previouslySatisfied.has(id)) {
      newlySatisfied.add(id);
    }
  }

  const satisfiedNodeIds = [...allSatisfied];
  const missingNodeIds = requiredNodes
    .filter(n => !allSatisfied.has(n.id))
    .map(n => n.id);

  return {
    satisfiedNodeIds,
    missingNodeIds,
    newlySatisfiedNodeIds: [...newlySatisfied],
    completionRatio: requiredNodes.length > 0
      ? satisfiedNodeIds.length / requiredNodes.length
      : 1,
    conclusionReached,
  };
}

// ============================================================================
// Student state classification (generalized)
// ============================================================================

/**
 * Classify the student's current response into a remediation state.
 * Generalized from math-specific classifyStudentState.
 */
export function classifyNodeStudentState(
  studentResponse: string,
  accumulation: NodeAccumulation,
): StudentState {
  const trimmed = studentResponse.trim();

  // No speech
  if (NO_SPEECH.test(trimmed)) return "uncertain";

  // Explicit hint request
  if (HINT_REQUEST.test(trimmed)) return "hint_request";

  // Uncertainty patterns
  if (UNCERTAINTY_PATTERNS.some(p => p.test(trimmed))) return "uncertain";

  // Newly satisfied nodes → partial progress
  if (accumulation.newlySatisfiedNodeIds.length > 0 && accumulation.missingNodeIds.length > 0) {
    return "partial";
  }

  // Conclusion reached but missing node explanations
  if (accumulation.conclusionReached && accumulation.missingNodeIds.length > 0) {
    return "correct_incomplete";
  }

  // Student said something but no evidence matched and no conclusion
  if (accumulation.missingNodeIds.length > 0) {
    return "wrong";
  }

  return "correct_incomplete";
}

// ============================================================================
// Misconception detection (generalized)
// ============================================================================

/**
 * Detect misconception category for the current response against a node.
 * Evaluates the node's misconception patterns in order.
 */
export function detectNodeMisconception(
  studentResponse: string,
  node: ReasoningNode,
): { category: NodeMisconceptionCategory; pattern: MisconceptionPattern } | null {
  if (!node.misconceptions?.length) return null;

  const normalized = studentResponse.trim().toLowerCase();

  for (const mp of node.misconceptions) {
    let matched = false;

    // Check regex patterns
    if (mp.matchPatterns?.length) {
      matched = mp.matchPatterns.some(p => p.test(normalized));
    }

    // Check required keywords (ALL must be present)
    if (!matched && mp.requiredKeywords?.length) {
      matched = mp.requiredKeywords.every(kw =>
        normalized.includes(kw.toLowerCase()),
      );
    }

    // Check absent keywords (NONE should be present)
    if (matched && mp.absentKeywords?.length) {
      const hasAbsent = mp.absentKeywords.some(kw =>
        normalized.includes(kw.toLowerCase()),
      );
      if (hasAbsent) matched = false;
    }

    if (matched) {
      return { category: mp.category, pattern: mp };
    }
  }

  return null;
}

// ============================================================================
// Next missing node selection
// ============================================================================

/**
 * Get the next missing node to target.
 *
 * Respects prerequisites: a node is only eligible if all its prerequisites
 * are satisfied. Within eligible nodes, picks by priority tier (lower first),
 * then by original order in the graph.
 *
 * Synthesis/combine/final nodes (higher tier) are probed after foundational
 * nodes, matching the math behavior where ones/tens come before combine.
 */
export function getNextMissingNode(
  graph: ReasoningGraph,
  accumulation: NodeAccumulation,
): ReasoningNode | null {
  const missingSet = new Set(accumulation.missingNodeIds);
  const satisfiedSet = new Set(accumulation.satisfiedNodeIds);

  const missingNodes = graph.nodes.filter(n => missingSet.has(n.id));
  if (missingNodes.length === 0) return null;

  // Filter to nodes whose prerequisites are all satisfied
  const eligible = missingNodes.filter(n => {
    if (!n.prerequisites?.length) return true;
    return n.prerequisites.every(prereq => satisfiedSet.has(prereq));
  });

  if (eligible.length === 0) {
    // All missing nodes have unsatisfied prerequisites — pick the first
    // prerequisite-free missing node, or just the first missing node
    return missingNodes[0];
  }

  // Sort by priority tier (lower first), then by original order
  const nodeOrder = new Map(graph.nodes.map((n, i) => [n.id, i]));
  eligible.sort((a, b) => {
    const tierA = a.priorityTier ?? 0;
    const tierB = b.priorityTier ?? 0;
    if (tierA !== tierB) return tierA - tierB;
    return (nodeOrder.get(a.id) ?? 0) - (nodeOrder.get(b.id) ?? 0);
  });

  return eligible[0];
}

// ============================================================================
// Main remediation selector
// ============================================================================

/**
 * Select the deterministic remediation move for the current turn.
 *
 * @param graph - The reasoning graph
 * @param accumulation - Current node accumulation state
 * @param studentResponse - The student's current response
 * @returns A deterministic remediation move, or null if no graph/nodes
 */
export function getNodeRemediationMove(
  graph: ReasoningGraph,
  accumulation: NodeAccumulation,
  studentResponse: string,
): NodeRemediationMove | null {
  if (!graph.nodes.length) return null;

  // 1. WRAP SUCCESS: all required nodes satisfied + conclusion reached
  if (accumulation.missingNodeIds.length === 0 && accumulation.conclusionReached) {
    return {
      type: "WRAP_SUCCESS",
      text: "",
      targetNodeId: null,
      targetNodeType: null,
      studentState: "success",
      explanation: "All required reasoning nodes satisfied and conclusion reached.",
    };
  }

  // Even if conclusion reached, if all nodes are satisfied without it, wrap
  if (accumulation.missingNodeIds.length === 0) {
    return {
      type: "WRAP_SUCCESS",
      text: "",
      targetNodeId: null,
      targetNodeType: null,
      studentState: "success",
      explanation: "All required reasoning nodes satisfied.",
    };
  }

  // 2. Classify student state
  const studentState = classifyNodeStudentState(studentResponse, accumulation);

  // 3. Find next missing node
  const missingNode = getNextMissingNode(graph, accumulation);
  if (!missingNode) return null;

  // 4. Check for misconception on the missing node
  if (studentState === "wrong" || studentState === "misconception") {
    const misconception = detectNodeMisconception(studentResponse, missingNode);
    if (misconception) {
      const probe = missingNode.remediation.directProbe;
      // Use the misconception's redirect template with the probe substituted
      const text = misconception.pattern.redirectTemplate.replace("{probe}", probe);

      return {
        type: "NODE_MISCONCEPTION_REDIRECT",
        text,
        targetNodeId: missingNode.id,
        targetNodeType: missingNode.type,
        studentState: "misconception",
        misconceptionCategory: misconception.category,
        explanation: `Student showed misconception: ${misconception.pattern.description}. Node "${missingNode.label}" (${missingNode.id}) is the target. Used category-specific redirect.`,
      };
    }
  }

  // 5. Build move for student state
  return buildNodeMove(studentState, missingNode, graph, accumulation);
}

/**
 * Build a remediation move for a given student state and target node.
 */
function buildNodeMove(
  studentState: StudentState,
  node: ReasoningNode,
  graph: ReasoningGraph,
  accumulation: NodeAccumulation,
): NodeRemediationMove {
  const r = node.remediation;
  const isSynthesis = node.type === "combine_parts" || node.type === "state_final_answer";

  switch (studentState) {
    case "hint_request": {
      const text = r.hint || `Hint: ${r.directProbe}`;
      return {
        type: "NODE_HINT",
        text,
        targetNodeId: node.id,
        targetNodeType: node.type,
        studentState,
        explanation: `Student asked for a hint. Node "${node.label}" (${node.id}) is the next missing node. Gave node-specific hint.`,
      };
    }

    case "uncertain": {
      const text = r.simplerProbe || `Let's try this part. ${r.directProbe}`;
      return {
        type: "NODE_PROBE_SIMPLER",
        text,
        targetNodeId: node.id,
        targetNodeType: node.type,
        studentState,
        explanation: `Student is uncertain. Node "${node.label}" (${node.id}) is the next missing node. Used simpler probe.`,
      };
    }

    case "wrong": {
      if (isSynthesis && r.combinePrompt) {
        return {
          type: "NODE_COMBINE_PROMPT",
          text: r.combinePrompt,
          targetNodeId: node.id,
          targetNodeType: node.type,
          studentState,
          explanation: `Student gave wrong answer. Node "${node.label}" (${node.id}) is the synthesis node. Prompted to combine.`,
        };
      }
      return {
        type: "NODE_PROBE_DIRECT",
        text: r.directProbe,
        targetNodeId: node.id,
        targetNodeType: node.type,
        studentState,
        explanation: `Student gave wrong/irrelevant response. Node "${node.label}" (${node.id}) is the next missing node. Asked directly.`,
      };
    }

    case "partial": {
      if (isSynthesis && r.combinePrompt) {
        return {
          type: "NODE_COMBINE_PROMPT",
          text: `Good. ${r.combinePrompt}`,
          targetNodeId: node.id,
          targetNodeType: node.type,
          studentState,
          explanation: `Student satisfied some nodes. Node "${node.label}" (${node.id}) is the synthesis node. Acknowledged and prompted to combine.`,
        };
      }
      return {
        type: "NODE_ACKNOWLEDGE_AND_PROBE",
        text: `Good. ${r.directProbe}`,
        targetNodeId: node.id,
        targetNodeType: node.type,
        studentState,
        explanation: `Student satisfied some nodes. Node "${node.label}" (${node.id}) is the next missing node. Acknowledged and probed.`,
      };
    }

    case "correct_incomplete": {
      return {
        type: "NODE_PROBE_DIRECT",
        text: r.directProbe,
        targetNodeId: node.id,
        targetNodeType: node.type,
        studentState,
        explanation: `Conclusion reached but missing node explanation. Node "${node.label}" (${node.id}) is the next missing node. Probed directly.`,
      };
    }

    case "misconception": {
      // Fallback — misconceptions should be caught above
      return {
        type: "NODE_MISCONCEPTION_REDIRECT",
        text: `Not quite. ${r.directProbe}`,
        targetNodeId: node.id,
        targetNodeType: node.type,
        studentState,
        explanation: `Student showed misconception. Node "${node.label}" (${node.id}) is the next missing node. Redirected.`,
      };
    }
  }
}

// ============================================================================
// Integration helper
// ============================================================================

/**
 * Check whether node-based remediation should be used for this turn.
 */
export function shouldUseNodeRemediation(
  graph: ReasoningGraph | null | undefined,
  accumulation: NodeAccumulation | null | undefined,
): boolean {
  if (!graph?.nodes?.length) return false;
  if (!accumulation) return false;
  return true;
}
