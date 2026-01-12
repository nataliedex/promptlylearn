import fs from "fs";
import path from "path";

export interface Standard {
  code: string;
  description: string;
  strand: string;
  strandName: string;
}

export interface GradeStandards {
  grade: string;
  gradeName: string;
  standards: Standard[];
}

export interface StandardsData {
  source: string;
  version: string;
  url: string;
  grades: {
    [key: string]: {
      name: string;
      strands: {
        [key: string]: {
          name: string;
          standards: { [key: string]: string };
        };
      };
    };
  };
}

// Map grade level strings to grade keys
const GRADE_MAP: { [key: string]: string } = {
  "kindergarten": "K",
  "k": "K",
  "1st grade": "1",
  "1st": "1",
  "first grade": "1",
  "2nd grade": "2",
  "2nd": "2",
  "second grade": "2",
  "3rd grade": "3",
  "3rd": "3",
  "third grade": "3",
  "4th grade": "4",
  "4th": "4",
  "fourth grade": "4",
  "5th grade": "5",
  "5th": "5",
  "fifth grade": "5",
  "middle school": "5", // Use 5th grade standards as baseline
  "high school": "5",   // Use 5th grade standards as baseline
};

let standardsCache: StandardsData | null = null;

/**
 * Load the Ohio ELA standards from the JSON file
 */
export function loadStandards(): StandardsData {
  if (standardsCache) {
    return standardsCache;
  }

  const standardsPath = path.join(__dirname, "../data/standards/ohio-ela-k5.json");

  if (!fs.existsSync(standardsPath)) {
    console.warn("Standards file not found:", standardsPath);
    return {
      source: "Ohio Learning Standards",
      version: "2017",
      url: "",
      grades: {},
    };
  }

  const data = fs.readFileSync(standardsPath, "utf-8");
  standardsCache = JSON.parse(data);
  return standardsCache!;
}

/**
 * Get the grade key from a grade level string
 */
export function normalizeGradeLevel(gradeLevel: string): string {
  const normalized = gradeLevel.toLowerCase().trim();
  return GRADE_MAP[normalized] || "2"; // Default to 2nd grade
}

/**
 * Get all standards for a specific grade level
 */
export function getStandardsForGrade(gradeLevel: string): GradeStandards | null {
  const standards = loadStandards();
  const gradeKey = normalizeGradeLevel(gradeLevel);
  const gradeData = standards.grades[gradeKey];

  if (!gradeData) {
    return null;
  }

  const allStandards: Standard[] = [];

  for (const [strandCode, strand] of Object.entries(gradeData.strands)) {
    for (const [code, description] of Object.entries(strand.standards)) {
      allStandards.push({
        code,
        description,
        strand: strandCode,
        strandName: strand.name,
      });
    }
  }

  return {
    grade: gradeKey,
    gradeName: gradeData.name,
    standards: allStandards,
  };
}

/**
 * Get standards for a specific strand (RL, RI, W, SL, L, RF)
 */
export function getStandardsByStrand(gradeLevel: string, strand: string): Standard[] {
  const gradeStandards = getStandardsForGrade(gradeLevel);
  if (!gradeStandards) return [];

  return gradeStandards.standards.filter(
    (s) => s.strand.toUpperCase() === strand.toUpperCase()
  );
}

/**
 * Get reading-focused standards (RL and RI) for a grade level
 */
export function getReadingStandards(gradeLevel: string): Standard[] {
  const gradeStandards = getStandardsForGrade(gradeLevel);
  if (!gradeStandards) return [];

  return gradeStandards.standards.filter(
    (s) => s.strand === "RL" || s.strand === "RI"
  );
}

/**
 * Get writing-focused standards for a grade level
 */
export function getWritingStandards(gradeLevel: string): Standard[] {
  return getStandardsByStrand(gradeLevel, "W");
}

/**
 * Get speaking and listening standards for a grade level
 */
export function getSpeakingListeningStandards(gradeLevel: string): Standard[] {
  return getStandardsByStrand(gradeLevel, "SL");
}

/**
 * Format standards for inclusion in an AI prompt
 */
export function formatStandardsForPrompt(standards: Standard[], maxStandards: number = 10): string {
  const selected = standards.slice(0, maxStandards);

  return selected
    .map((s) => `- ${s.code}: ${s.description}`)
    .join("\n");
}

/**
 * Get relevant standards for a lesson based on content type
 */
export function getRelevantStandards(
  gradeLevel: string,
  contentType: "reading" | "writing" | "speaking" | "all" = "reading"
): Standard[] {
  switch (contentType) {
    case "reading":
      return getReadingStandards(gradeLevel);
    case "writing":
      return getWritingStandards(gradeLevel);
    case "speaking":
      return getSpeakingListeningStandards(gradeLevel);
    case "all":
    default:
      const gradeStandards = getStandardsForGrade(gradeLevel);
      return gradeStandards?.standards || [];
  }
}

/**
 * Suggest which standards a question might address based on keywords
 */
export function suggestStandardsForQuestion(
  question: string,
  gradeLevel: string
): Standard[] {
  const allStandards = getStandardsForGrade(gradeLevel)?.standards || [];
  const questionLower = question.toLowerCase();

  const suggestions: Standard[] = [];

  // Keywords that map to different standard types
  const keywordMap: { [key: string]: string[] } = {
    RL: ["story", "character", "setting", "plot", "theme", "moral", "lesson", "poem", "drama", "fiction", "tale", "fable"],
    RI: ["main idea", "details", "information", "text", "author", "facts", "nonfiction", "article", "explain"],
    W: ["write", "opinion", "explain", "describe", "narrative", "story writing"],
    SL: ["discuss", "tell", "describe", "explain your thinking", "share", "present"],
    L: ["word", "meaning", "vocabulary", "phrase"],
  };

  for (const [strand, keywords] of Object.entries(keywordMap)) {
    const hasKeyword = keywords.some((kw) => questionLower.includes(kw));
    if (hasKeyword) {
      const strandStandards = allStandards.filter((s) => s.strand === strand);
      suggestions.push(...strandStandards.slice(0, 3)); // Add up to 3 standards per matched strand
    }
  }

  // Remove duplicates and limit to 5
  const unique = suggestions.filter(
    (s, i, arr) => arr.findIndex((x) => x.code === s.code) === i
  );

  return unique.slice(0, 5);
}
