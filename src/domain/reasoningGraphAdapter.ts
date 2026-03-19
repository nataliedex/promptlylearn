/**
 * Reasoning Graph Adapter
 *
 * Maps existing math ReasoningStep[] + MathProblem into the generalized
 * ReasoningGraph model. This preserves backward compatibility: current
 * addition/subtraction content still works through the new engine,
 * and future non-math lessons can use ReasoningGraph directly.
 *
 * Pure functions, no LLM calls.
 */

import type { ReasoningStep, ReasoningStepKind } from "./prompt";
import type { MathProblem } from "./mathProblem";
import type {
  ReasoningGraph,
  ReasoningNode,
  ReasoningNodeType,
  MisconceptionPattern,
  NodeMisconceptionCategory,
} from "./reasoningGraph";

// ============================================================================
// Step kind → node type mapping
// ============================================================================

const KIND_TO_NODE_TYPE: Record<ReasoningStepKind, ReasoningNodeType> = {
  identify_ones: "identify_part",
  ones_sum: "compute_value",
  regroup: "compute_value",
  identify_tens: "identify_part",
  tens_sum: "compute_value",
  combine: "combine_parts",
  identify_borrow: "identify_part",
  borrow: "compute_value",
  subtract_ones: "compute_value",
  subtract_tens: "compute_value",
  identify_groups: "identify_part",
  skip_count: "compute_value",
  final_answer: "state_final_answer",
  generic: "generic",
};

// ============================================================================
// Priority tier assignment
// ============================================================================

/** Combine/final_answer steps get higher tier so foundational steps probe first. */
function priorityTierForKind(kind: ReasoningStepKind): number {
  switch (kind) {
    case "combine":
    case "final_answer":
      return 1;
    default:
      return 0;
  }
}

// ============================================================================
// Math misconception patterns (adapted from deterministicRemediation)
// ============================================================================

function buildMathMisconceptions(
  step: ReasoningStep,
  mathProblem: MathProblem,
): MisconceptionPattern[] {
  const patterns: MisconceptionPattern[] = [];

  // Operation confusion misconceptions
  if (mathProblem.skill === "two_digit_addition") {
    patterns.push({
      category: "WRONG_OPERATION",
      matchPatterns: [
        /\b(?:take\s+away|taking\s+away|subtract(?:ed|ing)?|minus|took|less|took\s+off|take\s+off)\b/i,
        /\d+\s*-\s*\d+\s*=\s*\d+/,
      ],
      description: "Student used subtraction language on an addition problem.",
      redirectTemplate: `We're adding in this problem, not subtracting. {probe}`,
    });
  }

  if (mathProblem.skill === "two_digit_subtraction") {
    patterns.push({
      category: "WRONG_OPERATION",
      matchPatterns: [
        /\b(?:add(?:ed|ing)?|plus|put\s+together|putting\s+together)\b/i,
      ],
      description: "Student used addition language on a subtraction problem.",
      redirectTemplate: `We're subtracting in this problem, not adding. {probe}`,
    });
  }

  if (mathProblem.skill !== "basic_multiplication") {
    patterns.push({
      category: "WRONG_OPERATION",
      matchPatterns: [
        /\b(?:times|multiply|multipli(?:ed|cation)|groups?\s+of)\b/i,
      ],
      description: "Student used multiplication on an add/subtract problem.",
      redirectTemplate: `We're ${mathProblem.skill === "two_digit_subtraction" ? "subtracting" : "adding"} in this problem, not multiplying. {probe}`,
    });
  }

  // Place-value confusion: ones-only
  if (mathProblem.b !== undefined && mathProblem.skill === "two_digit_addition") {
    const onesSum = (mathProblem.a % 10) + (mathProblem.b % 10);
    if (onesSum !== mathProblem.correctAnswer) {
      patterns.push({
        category: "PARTIAL_COMPUTATION",
        matchPatterns: [new RegExp(`\\b${onesSum}\\b`)],
        absentKeywords: [String(mathProblem.correctAnswer)],
        description: "Student only handled the ones, ignored tens.",
        redirectTemplate: step.kind === "tens_sum" || step.kind === "identify_tens"
          ? `You found the ones part. Now let's add the tens. {probe}`
          : `That's just part of the answer. {probe}`,
      });
    }
  }

  return patterns;
}

// ============================================================================
// Evidence builder from expectedStatements
// ============================================================================

function buildEvidence(step: ReasoningStep) {
  const evidence: {
    exactStatements?: string[];
    patterns?: RegExp[];
    requiredKeywords?: string[];
  } = {};

  if (step.expectedStatements.length > 0) {
    evidence.exactStatements = step.expectedStatements;

    // For statements with numbers (e.g., "1 + 4 = 5"), create patterns
    // that match all numbers being present (same logic as isStepSatisfied)
    const patterns: RegExp[] = [];
    for (const stmt of step.expectedStatements) {
      const nums = stmt.match(/\d+/g);
      if (nums && nums.length >= 2) {
        // Build a pattern requiring all numbers with word boundaries
        const parts = nums.map(n => `(?=.*\\b${n}\\b)`);
        patterns.push(new RegExp(parts.join(""), "i"));
      }
    }
    if (patterns.length > 0) {
      evidence.patterns = patterns;
    }
  }

  return evidence;
}

// ============================================================================
// Main adapter
// ============================================================================

/**
 * Convert math ReasoningStep[] + MathProblem into a ReasoningGraph.
 *
 * The resulting graph can be consumed by the generalized node remediation
 * engine (nodeRemediation.ts) while producing equivalent behavior to
 * the math-specific deterministicRemediation.ts.
 */
export function mathStepsToReasoningGraph(
  reasoningSteps: ReasoningStep[],
  mathProblem: MathProblem,
): ReasoningGraph {
  const nodes: ReasoningNode[] = reasoningSteps.map((step, index) => {
    const nodeType = KIND_TO_NODE_TYPE[step.kind] ?? "generic";
    const tier = priorityTierForKind(step.kind);

    // Build prerequisites: combine/final_answer depend on foundational steps
    const prerequisites: string[] = [];
    if (step.kind === "combine" || step.kind === "final_answer") {
      // All prior non-combine steps are prerequisites
      for (let i = 0; i < index; i++) {
        const prior = reasoningSteps[i];
        if (prior.kind !== "combine" && prior.kind !== "final_answer") {
          prerequisites.push(prior.id);
        }
      }
    }

    // Build remediation templates
    const operands = extractOperandsFromStep(step, mathProblem);
    const directProbe = step.probe;
    const simplerProbe = buildAdaptedSimplerProbe(step, operands);
    const hint = buildAdaptedHint(step, operands);
    const combinePrompt = (step.kind === "combine" || step.kind === "final_answer") && operands
      ? `Now put them together. What is ${operands.left} plus ${operands.right}?`
      : undefined;

    const node: ReasoningNode = {
      id: step.id,
      type: nodeType,
      label: step.label,
      evidence: buildEvidence(step),
      remediation: {
        directProbe,
        simplerProbe,
        hint,
        combinePrompt,
      },
      misconceptions: buildMathMisconceptions(step, mathProblem),
      priorityTier: tier,
    };

    if (prerequisites.length > 0) {
      node.prerequisites = prerequisites;
    }

    return node;
  });

  return {
    id: `math-${mathProblem.expression.replace(/\s+/g, "")}`,
    subject: "math",
    description: `Explain how to solve ${mathProblem.expression}`,
    nodes,
    expectedConclusion: String(mathProblem.correctAnswer),
  };
}

// ============================================================================
// Helper: extract operands from step expectedStatements
// ============================================================================

interface StepOperands {
  left: string;
  right: string;
  result: string;
  operation: "add" | "subtract";
}

function extractOperandsFromStep(
  step: ReasoningStep,
  _mathProblem: MathProblem,
): StepOperands | null {
  const stmt = step.expectedStatements[0];
  if (!stmt) return null;

  const match = stmt.match(/(\d+)\s*([+\-])\s*(\d+)\s*=\s*(\d+)/);
  if (match) {
    return {
      left: match[1],
      right: match[3],
      result: match[4],
      operation: match[2] === "+" ? "add" : "subtract",
    };
  }
  return null;
}

function buildAdaptedSimplerProbe(
  step: ReasoningStep,
  operands: StepOperands | null,
): string {
  if (!operands) {
    return `Let's try just this part. ${step.probe || `What is the ${step.label.toLowerCase()}?`}`;
  }

  const kindLabel = step.kind.includes("ones") ? "ones"
    : step.kind.includes("tens") ? "tens"
    : "next part";
  return `Let's do just the ${kindLabel}. What is ${operands.left} ${operands.operation === "add" ? "+" : "-"} ${operands.right}?`;
}

function buildAdaptedHint(
  step: ReasoningStep,
  operands: StepOperands | null,
): string {
  if (!operands) {
    return `Hint: Try this part: ${step.label.toLowerCase()}.`;
  }

  const verb = operands.operation === "add" ? "plus" : "minus";

  switch (step.kind) {
    case "ones_sum":
    case "identify_ones":
      return `Hint: Start with the ones. What is ${operands.left} ${verb} ${operands.right}?`;
    case "tens_sum":
    case "identify_tens":
      return `Hint: Now the tens. What is ${operands.left} ${verb} ${operands.right}?`;
    case "combine":
    case "final_answer":
      return `Hint: You have ${operands.left} and ${operands.right}. Put them together. What is ${operands.left} ${verb} ${operands.right}?`;
    case "regroup":
      return `Hint: ${operands.left} ${verb} ${operands.right} is ${operands.result}. That's more than 9, so you carry the 1 to the tens.`;
    case "borrow":
    case "identify_borrow":
      return `Hint: ${operands.left} is smaller than ${operands.right}, so you need to borrow from the tens.`;
    case "subtract_ones":
      return `Hint: Subtract the ones. What is ${operands.left} ${verb} ${operands.right}?`;
    case "subtract_tens":
      return `Hint: Now subtract the tens. What is ${operands.left} ${verb} ${operands.right}?`;
    default:
      return `Hint: What is ${operands.left} ${verb} ${operands.right}?`;
  }
}
