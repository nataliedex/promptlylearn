/**
 * Generalized Reasoning Graph Model
 *
 * Subject-agnostic types for representing structured reasoning as a graph of
 * typed nodes. Each node represents one piece of reasoning the student must
 * demonstrate. The runtime coaching system walks the graph, determines which
 * nodes are satisfied from transcript evidence, identifies the next missing
 * node, and selects a deterministic remediation move.
 *
 * This replaces nothing — existing math `ReasoningStep` content maps into
 * this model via the adapter in `reasoningGraphAdapter.ts`.
 *
 * Pure types, no runtime logic.
 */

// ============================================================================
// Node types — the reusable taxonomy of reasoning actions
// ============================================================================

/**
 * Typed reasoning node categories. Each node in a graph has exactly one type
 * that determines how evidence is evaluated and how remediation is templated.
 *
 * Initial set covers math, science, history, ELA, and vocabulary/concept
 * explanation. Extend as needed — adding a type here is safe because the
 * remediation engine falls back to `probe` text for unknown types.
 */
export type ReasoningNodeType =
  // ── Math / computation ──
  | "identify_part"          // "What are the ones digits?"
  | "compute_value"          // "What is 1 + 4?"
  | "combine_parts"          // "Put 20 and 5 together"
  | "state_final_answer"     // "The answer is 25"
  // ── Concept / vocabulary explanation ──
  | "define_term"            // "A variable is a letter that stands for a number"
  | "explain_rule"           // "The commutative property says order doesn't matter"
  | "give_example"           // "For example, 3 + 5 = 5 + 3"
  | "explain_why"            // "This matters because..."
  // ── Science ──
  | "describe_process_step"  // "First, the water evaporates"
  | "explain_cause_effect"   // "Heat causes the water to evaporate"
  // ── History / social studies ──
  | "identify_cause"         // "The colonists were angry about taxes"
  | "identify_effect"        // "So they decided to protest"
  | "sequence_event"         // "This happened after the Stamp Act"
  // ── ELA / reading ──
  | "state_claim"            // "I think the character is brave"
  | "cite_text_evidence"     // "In the story it says..."
  | "interpret_meaning"      // "This means that..."
  | "compare_concepts"       // "X is like Y because..."
  // ── Generic fallback ──
  | "generic";               // Catch-all for unlisted types

// ============================================================================
// Misconception categories — subject-aware
// ============================================================================

/**
 * Misconception categories that can be detected deterministically from
 * student responses. Each category maps to a specific redirect template.
 *
 * Categories are grouped by subject. The runtime misconception detector
 * checks applicable categories based on the node type and graph metadata.
 */
export type NodeMisconceptionCategory =
  // ── Math ──
  | "WRONG_OPERATION"             // Used subtraction when should add, etc.
  | "PARTIAL_COMPUTATION"         // Only computed one part (ones but not tens)
  | "KNOWN_WRONG_ANSWER"          // Matches a pre-cataloged wrong answer
  // ── Concept explanation ──
  | "RECITES_WITHOUT_EXPLAINING"  // Repeated the term but didn't explain meaning
  | "CONFUSES_RELATED_TERM"       // Used a related but wrong term
  // ── Science ──
  | "STEPS_OUT_OF_ORDER"          // Described process steps in wrong sequence
  | "CAUSE_EFFECT_REVERSED"       // Swapped cause and effect
  // ── ELA ──
  | "CLAIM_WITHOUT_EVIDENCE"      // Stated opinion but cited no text
  | "EVIDENCE_WITHOUT_CLAIM"      // Cited text but made no interpretive claim
  // ── Generic ──
  | "GENERIC_WRONG";              // Wrong but no identifiable category

// ============================================================================
// Misconception pattern — declarative detection rule
// ============================================================================

/**
 * A declarative misconception detection pattern attached to a node.
 * The remediation engine evaluates these patterns against the student's
 * response to determine the misconception category.
 */
export interface MisconceptionPattern {
  /** The misconception category this pattern detects. */
  category: NodeMisconceptionCategory;
  /** Regex patterns that indicate this misconception. */
  matchPatterns?: RegExp[];
  /** If the student's response contains ALL of these keywords. */
  requiredKeywords?: string[];
  /** If the student's response contains NONE of these keywords. */
  absentKeywords?: string[];
  /** Human-readable description for logging / teacher summary. */
  description: string;
  /** The redirect template: sentence 1 = correction, sentence 2 = {probe}. */
  redirectTemplate: string;
}

// ============================================================================
// Evidence matching — how we know a node is satisfied
// ============================================================================

/**
 * How to evaluate whether a student's spoken response satisfies a node.
 * Multiple matchers can be provided — any match satisfies the node.
 */
export interface EvidenceMatcher {
  /** Exact string matches (case-insensitive, after normalization). */
  exactStatements?: string[];
  /** Regex patterns — if any matches, node is satisfied. */
  patterns?: RegExp[];
  /** Required keywords — ALL must be present. */
  requiredKeywords?: string[];
  /** Minimum keyword count from a keyword bank (for partial matching). */
  keywordBank?: { words: string[]; minCount: number };
}

// ============================================================================
// Remediation templates — per-node coaching text
// ============================================================================

/**
 * Pre-authored remediation text for a specific node.
 * The coaching engine selects from these based on student state.
 */
export interface NodeRemediationTemplates {
  /** Direct probe: "What do you get when you add 1 and 4?" */
  directProbe: string;
  /** Simpler probe for uncertain students: "Let's start with just the ones." */
  simplerProbe?: string;
  /** Hint aligned to exact success criteria: "Hint: What is 1 plus 4?" */
  hint?: string;
  /** Combine/synthesis prompt: "Now put them together." */
  combinePrompt?: string;
}

// ============================================================================
// ReasoningNode — one atomic piece of reasoning
// ============================================================================

/**
 * A single reasoning node in a graph. Represents one thing the student
 * must demonstrate understanding of.
 */
export interface ReasoningNode {
  /** Unique identifier within the graph. */
  id: string;
  /** The type of reasoning this node represents. */
  type: ReasoningNodeType;
  /** Human-readable label: "Add the ones", "Define 'variable'". */
  label: string;
  /** How to determine if this node is satisfied from transcript. */
  evidence: EvidenceMatcher;
  /** Pre-authored remediation templates for this node. */
  remediation: NodeRemediationTemplates;
  /** Misconception patterns specific to this node. */
  misconceptions?: MisconceptionPattern[];
  /** IDs of nodes that must be satisfied before this one is probed. */
  prerequisites?: string[];
  /** Whether this node is required for WRAP_SUCCESS (default: true). */
  required?: boolean;
  /** Priority tier for ordering: lower = probe first (default: 0). */
  priorityTier?: number;
}

// ============================================================================
// ReasoningGraph — the full question structure
// ============================================================================

/**
 * A complete reasoning graph for one question/prompt.
 * Contains the nodes, completion rules, and metadata.
 */
export interface ReasoningGraph {
  /** Unique identifier (typically matches the prompt ID). */
  id: string;
  /** The subject area for this graph. */
  subject: "math" | "science" | "history" | "ela" | "vocabulary" | "general";
  /** Human-readable description of what the student should explain. */
  description: string;
  /** The reasoning nodes the student must demonstrate. */
  nodes: ReasoningNode[];
  /** IDs of node groups that can be completed in any order. */
  unorderedGroups?: string[][];
  /**
   * The expected final claim/answer (for wrap messaging).
   * For math: "25". For concepts: "A variable is a letter that stands for a number."
   */
  expectedConclusion?: string;
}

// ============================================================================
// Node evidence accumulation — runtime state
// ============================================================================

/**
 * Tracks which nodes have been satisfied across the conversation.
 * Analogous to `ReasoningStepAccumulation` but generalized.
 */
export interface NodeAccumulation {
  /** IDs of nodes satisfied across all turns. */
  satisfiedNodeIds: string[];
  /** IDs of required nodes not yet satisfied. */
  missingNodeIds: string[];
  /** IDs of nodes newly satisfied in the current turn. */
  newlySatisfiedNodeIds: string[];
  /** Fraction of required nodes satisfied (0–1). */
  completionRatio: number;
  /** Whether the expected conclusion has been stated. */
  conclusionReached: boolean;
}

// ============================================================================
// Node remediation move — the output of the remediation engine
// ============================================================================

/**
 * Remediation move types — the fixed menu of deterministic responses.
 * Generalized from the math-specific `RemediationMoveType`.
 */
export type NodeRemediationMoveType =
  | "NODE_PROBE_DIRECT"           // Direct probe for missing node
  | "NODE_PROBE_SIMPLER"          // Simpler probe for uncertain student
  | "NODE_HINT"                   // Hint aligned to node evidence criteria
  | "NODE_MISCONCEPTION_REDIRECT" // Misconception correction + redirect
  | "NODE_COMBINE_PROMPT"         // Synthesis / combine parts prompt
  | "NODE_ACKNOWLEDGE_AND_PROBE"  // Acknowledge progress, probe next
  | "WRAP_SUCCESS"                // All required nodes satisfied
  | "WRAP_NEEDS_SUPPORT";         // Max attempts, no progress

/**
 * A fully resolved remediation move from the node engine.
 */
export interface NodeRemediationMove {
  /** The move type. */
  type: NodeRemediationMoveType;
  /** The full coach response text. */
  text: string;
  /** The node this move targets (null for WRAP moves). */
  targetNodeId: string | null;
  /** The node type this move targets (null for WRAP moves). */
  targetNodeType: ReasoningNodeType | null;
  /** The student state that triggered this move. */
  studentState: StudentState | "success";
  /** Specific misconception category when applicable. */
  misconceptionCategory?: NodeMisconceptionCategory;
  /** Human-readable explanation for auditability. */
  explanation: string;
}

/**
 * Classified student state for the current turn.
 * Reuses the same categories as math remediation.
 */
export type StudentState =
  | "wrong"
  | "misconception"
  | "uncertain"
  | "partial"
  | "hint_request"
  | "correct_incomplete";
