/**
 * Blueprint-based question generation system.
 *
 * Instead of free-form LLM question generation, questions are produced by
 * selecting an approved blueprint and filling topic-specific slots.
 * This ensures questions are short, spoken-response-friendly, and produce
 * deterministically evaluable answers.
 */

// ============================================================================
// Types
// ============================================================================

export type BlueprintId =
  | "identify_one_property"
  | "two_examples"
  | "compare_two_objects"
  | "category_example"
  | "describe_object"
  | "similarities"
  | "choose_category"
  | "odd_one_out"
  | "pattern_completion"
  | "real_world_example"
  | "math_solve_and_explain"
  | "math_solve_first_step"
  | "math_regrouping_focus"
  | "math_error_check"
  | "math_word_problem"
  | "math_compare_method";

export type GradeBand = "K-2" | "3-4" | "5-6";

export interface BlueprintSlot {
  name: string;
  description: string;
}

export interface EvidenceStructureHint {
  /** Expected number of named entities in the answer */
  expectedEntityCount: number;
  /** Whether each entity needs a paired attribute */
  requiresPairing: boolean;
  /** Description of what counts as "complete" evidence */
  completenessRule: string;
}

export interface Blueprint {
  id: BlueprintId;
  name: string;
  template: string;
  slots: BlueprintSlot[];
  cognitiveVerb: string;
  gradeBands: GradeBand[];
  evidenceStructure: EvidenceStructureHint;
}

// ============================================================================
// Blueprint Library — the 10 approved question templates
// ============================================================================

export const BLUEPRINTS: Blueprint[] = [
  {
    id: "identify_one_property",
    name: "Identify One Property",
    template: "What is [object] mostly made of? Name one material found in [object].",
    slots: [{ name: "object", description: "A specific object or entity to examine" }],
    cognitiveVerb: "identify",
    gradeBands: ["K-2", "3-4", "5-6"],
    evidenceStructure: {
      expectedEntityCount: 1,
      requiresPairing: true,
      completenessRule: "Names one correct property or material of the object.",
    },
  },
  {
    id: "two_examples",
    name: "Two Examples",
    template: "Name two [category]. Tell one thing about each.",
    slots: [{ name: "category", description: "A category of things (e.g., planets, animals, states of matter)" }],
    cognitiveVerb: "name",
    gradeBands: ["K-2", "3-4", "5-6"],
    evidenceStructure: {
      expectedEntityCount: 2,
      requiresPairing: true,
      completenessRule: "Names two examples and gives one correct attribute for each.",
    },
  },
  {
    id: "compare_two_objects",
    name: "Compare Two Objects",
    template: "How are [object1] and [object2] different? Tell one thing about each.",
    slots: [
      { name: "object1", description: "First object to compare" },
      { name: "object2", description: "Second object to compare" },
    ],
    cognitiveVerb: "compare",
    gradeBands: ["3-4", "5-6"],
    evidenceStructure: {
      expectedEntityCount: 2,
      requiresPairing: true,
      completenessRule: "States one difference for each of the two objects.",
    },
  },
  {
    id: "category_example",
    name: "Category Example",
    template: "Some [category] are [type1] and some are [type2]. Name one example of each.",
    slots: [
      { name: "category", description: "A broad category (e.g., planets, animals)" },
      { name: "type1", description: "First subcategory or type" },
      { name: "type2", description: "Second subcategory or type" },
    ],
    cognitiveVerb: "name",
    gradeBands: ["K-2", "3-4", "5-6"],
    evidenceStructure: {
      expectedEntityCount: 2,
      requiresPairing: true,
      completenessRule: "Names one correct example for each of the two types.",
    },
  },
  {
    id: "describe_object",
    name: "Describe an Object",
    template: "Describe what [object] is made of. Name one material found there.",
    slots: [{ name: "object", description: "A specific object or place to describe" }],
    cognitiveVerb: "describe",
    gradeBands: ["3-4", "5-6"],
    evidenceStructure: {
      expectedEntityCount: 1,
      requiresPairing: true,
      completenessRule: "Describes the object and names one correct material.",
    },
  },
  {
    id: "similarities",
    name: "Similarities",
    template: "What do [object1] and [object2] have in common? Tell one thing they both share.",
    slots: [
      { name: "object1", description: "First object" },
      { name: "object2", description: "Second object" },
    ],
    cognitiveVerb: "compare",
    gradeBands: ["3-4", "5-6"],
    evidenceStructure: {
      expectedEntityCount: 2,
      requiresPairing: false,
      completenessRule: "Names one correct shared property of both objects.",
    },
  },
  {
    id: "choose_category",
    name: "Choose Category",
    template: "Is [object] a [type1] or a [type2]? Tell why.",
    slots: [
      { name: "object", description: "The object to classify" },
      { name: "type1", description: "First possible category" },
      { name: "type2", description: "Second possible category" },
    ],
    cognitiveVerb: "identify",
    gradeBands: ["K-2", "3-4", "5-6"],
    evidenceStructure: {
      expectedEntityCount: 1,
      requiresPairing: true,
      completenessRule: "Chooses the correct category and gives one supporting reason.",
    },
  },
  {
    id: "odd_one_out",
    name: "Odd One Out",
    template: "Which is different: [A], [B], or [C]? Tell why.",
    slots: [
      { name: "A", description: "First item" },
      { name: "B", description: "Second item" },
      { name: "C", description: "Third item" },
    ],
    cognitiveVerb: "identify",
    gradeBands: ["K-2", "3-4", "5-6"],
    evidenceStructure: {
      expectedEntityCount: 1,
      requiresPairing: false,
      completenessRule: "Identifies the odd one out and gives one correct reason.",
    },
  },
  {
    id: "pattern_completion",
    name: "Pattern Completion",
    template: "[A] and [B] share something in common. Name another object that fits.",
    slots: [
      { name: "A", description: "First example in the pattern" },
      { name: "B", description: "Second example in the pattern" },
    ],
    cognitiveVerb: "name",
    gradeBands: ["K-2", "3-4", "5-6"],
    evidenceStructure: {
      expectedEntityCount: 1,
      requiresPairing: false,
      completenessRule: "Names a third object that correctly shares the common property.",
    },
  },
  {
    id: "real_world_example",
    name: "Real World Example",
    template: "Give an example of [concept]. Explain how it shows the idea.",
    slots: [{ name: "concept", description: "An abstract concept or principle" }],
    cognitiveVerb: "explain",
    gradeBands: ["5-6"],
    evidenceStructure: {
      expectedEntityCount: 1,
      requiresPairing: true,
      completenessRule: "Gives one real-world example and explains the connection to the concept.",
    },
  },
];

// ============================================================================
// Math computation blueprint library
// ============================================================================

/**
 * Math-specific blueprints for computation topics (addition, subtraction,
 * multiplication, division, place value). These replace the general
 * example/listing blueprints when the subject is math computation.
 */
export const MATH_BLUEPRINTS: Blueprint[] = [
  {
    id: "math_solve_and_explain",
    name: "Solve and Explain",
    template: "Solve [expression]. Tell how you got your answer.",
    slots: [{ name: "expression", description: "A math expression to solve (e.g., 34 + 27)" }],
    cognitiveVerb: "solve",
    gradeBands: ["K-2", "3-4", "5-6"],
    evidenceStructure: {
      expectedEntityCount: 1,
      requiresPairing: true,
      completenessRule: "Gives the correct answer and explains the strategy used.",
    },
  },
  {
    id: "math_solve_first_step",
    name: "Solve and Give First Step",
    template: "Solve [expression]. Tell the first step you used.",
    slots: [{ name: "expression", description: "A math expression to solve" }],
    cognitiveVerb: "solve",
    gradeBands: ["K-2", "3-4", "5-6"],
    evidenceStructure: {
      expectedEntityCount: 1,
      requiresPairing: true,
      completenessRule: "Gives the correct answer and names the first step of the strategy.",
    },
  },
  {
    id: "math_regrouping_focus",
    name: "Regrouping Focus",
    template: "Solve [expression]. Explain what you did when the ones added to 10 or more.",
    slots: [{ name: "expression", description: "An addition/subtraction expression requiring regrouping" }],
    cognitiveVerb: "explain",
    gradeBands: ["K-2", "3-4", "5-6"],
    evidenceStructure: {
      expectedEntityCount: 1,
      requiresPairing: true,
      completenessRule: "Gives the correct answer and explains the regrouping/carrying step.",
    },
  },
  {
    id: "math_error_check",
    name: "Error Check",
    template: "A student said [incorrect_answer] for [expression]. What is the correct answer, and what was the mistake?",
    slots: [
      { name: "expression", description: "A math expression" },
      { name: "incorrect_answer", description: "A plausible wrong answer" },
    ],
    cognitiveVerb: "identify",
    gradeBands: ["K-2", "3-4", "5-6"],
    evidenceStructure: {
      expectedEntityCount: 1,
      requiresPairing: true,
      completenessRule: "Gives the correct answer and identifies the error in the wrong answer.",
    },
  },
  {
    id: "math_word_problem",
    name: "Word Problem Solve",
    template: "[word_problem] Tell the number sentence and the answer.",
    slots: [{ name: "word_problem", description: "A short word problem (1-2 sentences)" }],
    cognitiveVerb: "solve",
    gradeBands: ["K-2", "3-4", "5-6"],
    evidenceStructure: {
      expectedEntityCount: 1,
      requiresPairing: true,
      completenessRule: "States the correct number sentence (e.g., 34 + 27 = 61) and gives the answer.",
    },
  },
  {
    id: "math_compare_method",
    name: "Compare One Method",
    template: "Solve [expression]. Tell one way you could solve it.",
    slots: [{ name: "expression", description: "A math expression to solve" }],
    cognitiveVerb: "describe",
    gradeBands: ["K-2", "3-4", "5-6"],
    evidenceStructure: {
      expectedEntityCount: 1,
      requiresPairing: true,
      completenessRule: "Gives the correct answer and describes one valid solution method.",
    },
  },
];

/** Combined library: all general + math blueprints. */
export const ALL_BLUEPRINTS: Blueprint[] = [...BLUEPRINTS, ...MATH_BLUEPRINTS];

// ============================================================================
// Math computation topic detection
// ============================================================================

/** Keywords that indicate a math computation topic. */
const MATH_COMPUTATION_KEYWORDS = [
  "addition", "subtraction", "multiplication", "division",
  "adding", "subtracting", "multiplying", "dividing",
  "add", "subtract", "multiply", "divide",
  "place value", "regrouping", "carrying", "borrowing",
  "digit", "2-digit", "3-digit", "two-digit", "three-digit",
  "sum", "difference", "product", "quotient",
  "arithmetic", "computation",
];

/**
 * Detect whether a topic/subject is an elementary math computation skill.
 * Used to route to the math blueprint library instead of the general one.
 */
export function isMathComputationTopic(subject?: string, topic?: string): boolean {
  if (!subject && !topic) return false;
  const combined = `${subject || ""} ${topic || ""}`.toLowerCase();
  return MATH_COMPUTATION_KEYWORDS.some(kw => combined.includes(kw));
}

// ============================================================================
// Grade-level cognitive verb constraints
// ============================================================================

export const GRADE_COGNITIVE_VERBS: Record<GradeBand, string[]> = {
  "K-2": ["identify", "name"],
  "3-4": ["describe", "give examples", "compare"],
  "5-6": ["explain", "compare causes"],
};

// ============================================================================
// Grade band helpers
// ============================================================================

export function getGradeBand(gradeNum: number): GradeBand {
  if (gradeNum <= 2) return "K-2";
  if (gradeNum <= 4) return "3-4";
  return "5-6";
}

export function getAvailableBlueprints(gradeNum: number, subject?: string, topic?: string): Blueprint[] {
  const band = getGradeBand(gradeNum);
  if (isMathComputationTopic(subject, topic)) {
    return MATH_BLUEPRINTS.filter(bp => bp.gradeBands.includes(band));
  }
  return BLUEPRINTS.filter(bp => bp.gradeBands.includes(band));
}

// ============================================================================
// Serialization for LLM prompts
// ============================================================================

/**
 * Format available blueprints as text for inclusion in the LLM system prompt.
 */
export function serializeBlueprintsForPrompt(gradeNum: number, subject?: string, topic?: string): string {
  const isMath = isMathComputationTopic(subject, topic);
  const available = getAvailableBlueprints(gradeNum, subject, topic);
  const band = getGradeBand(gradeNum);
  const allowedVerbs = GRADE_COGNITIVE_VERBS[band];

  let output = isMath
    ? `MATH COMPUTATION BLUEPRINTS (you MUST use one of these — do NOT use general listing/example blueprints for math computation):\n\n`
    : `APPROVED QUESTION BLUEPRINTS (you MUST use one of these):\n\n`;

  available.forEach((bp, i) => {
    const slotDesc = bp.slots.map(s => `[${s.name}]`).join(", ");
    output += `${i + 1}. ${bp.name} (id: "${bp.id}")\n`;
    output += `   Template: "${bp.template}"\n`;
    output += `   Slots to fill: ${slotDesc}\n`;
    output += `   Evidence required: ${bp.evidenceStructure.completenessRule}\n\n`;
  });

  output += `COGNITIVE VERB CONSTRAINTS for ${band}:\n`;
  if (isMath) {
    output += `- Allowed verbs: solve, explain, identify\n`;
    output += `- The student must SOLVE the problem, not just name or list examples\n`;
    output += `- Questions must require computation, not classification\n`;
  } else {
    output += `- Allowed verbs: ${allowedVerbs.join(", ")}\n`;
    if (band === "K-2") {
      output += `- NEVER use "explain why" or causal reasoning\n`;
      output += `- Keep questions at identify/name level only\n`;
    } else if (band === "3-4") {
      output += `- Avoid "explain why" unless the explanation is extremely simple\n`;
      output += `- Prefer "describe", "give examples", "compare"\n`;
    }
  }

  return output;
}

// ============================================================================
// Blueprint-specific assessment constraints
// ============================================================================

/**
 * Build rubric constraints that enforce alignment between the blueprint's
 * evidence structure and the generated assessment data.
 */
export function buildBlueprintAssessmentConstraints(
  blueprintId: string,
  filledSlots?: Record<string, string>,
): string {
  const blueprint = ALL_BLUEPRINTS.find(bp => bp.id === blueprintId);
  if (!blueprint) return "";

  const ev = blueprint.evidenceStructure;
  const slotValues = filledSlots || {};
  const slotSummary = blueprint.slots
    .map(s => `${s.name} = "${slotValues[s.name] || s.description}"`)
    .join(", ");

  let constraints = `BLUEPRINT CONSTRAINTS (MANDATORY):\n`;
  constraints += `This question uses the "${blueprint.name}" blueprint (${slotSummary}).\n\n`;

  constraints += `Evidence structure:\n`;
  constraints += `- The student must provide ${ev.expectedEntityCount} named item(s)\n`;
  if (ev.requiresPairing) {
    constraints += `- Each item must be paired with a correct attribute\n`;
  }
  constraints += `- Complete evidence: ${ev.completenessRule}\n\n`;

  constraints += `requiredEvidence MUST have:\n`;
  constraints += `- minEntities: ${ev.expectedEntityCount}\n`;
  if (ev.requiresPairing) {
    constraints += `- requirePairing: true\n`;
  }

  const isMathBp = blueprint.id.startsWith("math_");
  constraints += `\nscoring levels MUST follow this format:\n`;
  if (isMathBp) {
    constraints += `- strong: Gives the correct answer AND explains the strategy or first step\n`;
    constraints += `- developing: Partial strategy or arithmetic error (e.g., wrong sum but valid approach)\n`;
    constraints += `- needsSupport: Incorrect answer with no usable strategy\n`;
  } else {
    constraints += `- strong: All required evidence present and factually correct\n`;
    constraints += `- developing: Some evidence present but incomplete or partially incorrect\n`;
    constraints += `- needsSupport: Incorrect facts or unrelated answer\n`;
  }

  return constraints;
}
