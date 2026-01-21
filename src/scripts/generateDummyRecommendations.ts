/**
 * Generate dummy recommendations for testing the "What Should I Do Next?" panel
 *
 * Grouping Rules:
 * - GROUPABLE: Needs Support, Administrative/Monitor, Group Review
 * - INDIVIDUAL ONLY: Celebrate Progress, Challenge Opportunity, Check-in Suggested, Developing
 *
 * Run with: npx ts-node src/scripts/generateDummyRecommendations.ts
 */

import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import {
  Recommendation,
  InsightType,
  PriorityLevel,
  ConfidenceScore,
  GROUPING_RULES,
  RECOMMENDATION_CONFIG,
} from "../domain/recommendation";

const DATA_FILE = path.join(__dirname, "../../data/recommendations.json");

function createRecommendation(params: {
  insightType: InsightType;
  legacyType: string;
  summary: string;
  evidence: string[];
  suggestedTeacherActions: string[];
  priorityLevel: PriorityLevel;
  confidenceScore: ConfidenceScore;
  studentIds: string[];
  studentName: string;
  assignmentId: string;
  assignmentTitle: string;
  ruleName: string;
  signals: Record<string, any>;
}): Recommendation {
  const now = new Date().toISOString();

  // Compute priority
  let priority = 50;
  if (params.legacyType === "individual-checkin" || params.insightType === "check_in") priority += 20;
  if (params.legacyType === "small-group") priority += 25;
  if (params.priorityLevel === "high") priority += 15;
  if (params.priorityLevel === "medium") priority += 5;

  return {
    id: randomUUID(),
    insightType: params.insightType,
    type: params.legacyType as any,
    summary: params.summary,
    evidence: params.evidence,
    suggestedTeacherActions: params.suggestedTeacherActions,
    title: params.summary,
    reason: params.evidence.join("; "),
    suggestedAction: params.suggestedTeacherActions[0] || "",
    priorityLevel: params.priorityLevel,
    confidenceScore: params.confidenceScore,
    confidence: params.priorityLevel,
    priority,
    studentIds: params.studentIds,
    assignmentId: params.assignmentId,
    triggerData: {
      ruleName: params.ruleName,
      signals: {
        ...params.signals,
        studentName: params.studentName,
      },
      generatedAt: now,
    },
    status: "active",
    createdAt: now,
  };
}

function generateDummyRecommendations(): Recommendation[] {
  const recommendations: Recommendation[] = [];

  // ============================================
  // INDIVIDUAL-ONLY CATEGORIES (never grouped)
  // ============================================

  // 1. CELEBRATE PROGRESS - Individual only, never grouped
  recommendations.push(createRecommendation({
    insightType: "celebrate_progress",
    legacyType: "celebrate",
    summary: "Sofia showed notable improvement!",
    evidence: [
      "Improved from 45% to 82% (+37 points)",
      "Assignment: Math Word Problems",
      "Demonstrated strong growth in problem-solving"
    ],
    suggestedTeacherActions: [
      "Brief acknowledgment can reinforce their effort and growth",
      "Consider sharing what strategies they used that worked well",
      "Award a badge to celebrate their achievement"
    ],
    priorityLevel: "medium",
    confidenceScore: 0.95,
    studentIds: ["student-sofia-003"],
    studentName: "Sofia Rodriguez",
    assignmentId: "lesson-math-word-303",
    assignmentTitle: "Math Word Problems",
    ruleName: "notable-improvement",
    signals: {
      previousScore: 45,
      currentScore: 82,
      improvement: 37
    }
  }));

  // 2. CELEBRATE PROGRESS - Another individual celebration
  recommendations.push(createRecommendation({
    insightType: "celebrate_progress",
    legacyType: "celebrate",
    summary: "Oliver achieved a breakthrough!",
    evidence: [
      "Improved from 32% to 78% (+46 points)",
      "Assignment: Animal Facts",
      "Significant turnaround after struggling initially"
    ],
    suggestedTeacherActions: [
      "Recognize their persistence and growth",
      "Ask what helped them improve",
      "Consider awarding an Effort Award badge"
    ],
    priorityLevel: "high",
    confidenceScore: 0.93,
    studentIds: ["student-oliver-010"],
    studentName: "Oliver Williams",
    assignmentId: "lesson-animals-808",
    assignmentTitle: "Animal Facts",
    ruleName: "notable-improvement",
    signals: {
      previousScore: 32,
      currentScore: 78,
      improvement: 46
    }
  }));

  // 3. CHALLENGE OPPORTUNITY - Individual only, never grouped
  recommendations.push(createRecommendation({
    insightType: "challenge_opportunity",
    legacyType: "enrichment",
    summary: "Aiden shows readiness for additional challenge",
    evidence: [
      "Scored 96% on Science Explorers",
      "Used hints on only 5% of questions",
      "Coach conversations show interest in deeper learning"
    ],
    suggestedTeacherActions: [
      "Consider offering extension activities on this topic",
      "Explore peer tutoring opportunities",
      "Discuss advanced materials or independent projects"
    ],
    priorityLevel: "medium",
    confidenceScore: 0.88,
    studentIds: ["student-aiden-004"],
    studentName: "Aiden Park",
    assignmentId: "lesson-science-404",
    assignmentTitle: "Science Explorers",
    ruleName: "ready-for-challenge",
    signals: {
      score: 96,
      hintUsageRate: 0.05,
      coachIntent: "enrichment-seeking"
    }
  }));

  // 4. CHECK-IN SUGGESTED - Individual only (developing pattern)
  recommendations.push(createRecommendation({
    insightType: "check_in",
    legacyType: "individual-checkin",
    summary: "Lily might benefit from a conversation",
    evidence: [
      "Scored 52% on Story Writing",
      "Multiple coach sessions asking clarifying questions",
      "Pattern suggests uncertainty about expectations"
    ],
    suggestedTeacherActions: [
      "Have a quick chat to understand their thought process",
      "Clarify assignment expectations if needed",
      "Provide encouragement and specific feedback"
    ],
    priorityLevel: "medium",
    confidenceScore: 0.82,
    studentIds: ["student-lily-005"],
    studentName: "Lily Thompson",
    assignmentId: "lesson-writing-505",
    assignmentTitle: "Story Writing",
    ruleName: "check-in-suggested",  // Individual-only rule
    signals: {
      score: 52,
      hintUsageRate: 0.4,
      coachIntent: "support-seeking",
      hasTeacherNote: false
    }
  }));

  // 5. DEVELOPING - Individual only (moderate score 50-79%, hint usage 25-50%)
  // Key: This is an INFORMATIONAL category showing students making progress
  recommendations.push(createRecommendation({
    insightType: "check_in",
    legacyType: "individual-checkin",
    summary: "Marcus is developing understanding",
    evidence: [
      "Scored 62% on Reading Comprehension",
      "Used hints on 35% of questions",
      "Showing progress but may benefit from targeted guidance"
    ],
    suggestedTeacherActions: [
      "Check in to see what concepts are still unclear",
      "Consider targeted practice on specific areas",
      "Pair with a peer for collaborative learning"
    ],
    priorityLevel: "medium",
    confidenceScore: 0.78,
    studentIds: ["student-marcus-002"],
    studentName: "Marcus Chen",
    assignmentId: "lesson-reading-202",
    assignmentTitle: "Reading Comprehension",
    ruleName: "developing",  // Individual-only rule
    signals: {
      score: 62,               // 50-79% range
      hintUsageRate: 0.35,     // 25-50% range
      coachIntent: "mixed",
      hasTeacherNote: false
    }
  }));

  // 5b. ESCALATED FROM DEVELOPING - Student in developing range but with excessive help requests
  // This shows the escalation logic: developing student -> needs support after repeated help
  recommendations.push(createRecommendation({
    insightType: "check_in",
    legacyType: "individual-checkin",
    summary: "Taylor may need support",
    evidence: [
      "Scored 55% on Science Explorers",
      "Used hints on 40% of questions",
      "4 help requests in coach sessions",
      "Pattern suggests escalated support need"
    ],
    suggestedTeacherActions: [
      "Review their responses to understand where they encountered difficulty",
      "Consider a brief one-on-one conversation to gauge understanding",
      "Identify if additional practice or different explanation approaches might help"
    ],
    priorityLevel: "high",
    confidenceScore: 0.85,
    studentIds: ["student-taylor-011"],
    studentName: "Taylor Martinez",
    assignmentId: "lesson-science-808",
    assignmentTitle: "Science Explorers",
    ruleName: "needs-support",  // Escalated from developing
    signals: {
      score: 55,               // Would be developing range...
      hintUsageRate: 0.40,     // ...and developing hint range...
      helpRequestCount: 4,     // ...but escalated due to repeated help requests (>= 3)
      escalatedFromDeveloping: true,
      coachIntent: "support-seeking",
      hasTeacherNote: false
    }
  }));

  // ============================================
  // GROUPABLE CATEGORIES (can be grouped)
  // ============================================

  // 6. NEEDS SUPPORT - Individual (groupable type, but single student)
  recommendations.push(createRecommendation({
    insightType: "check_in",
    legacyType: "individual-checkin",
    summary: "Emma may benefit from a check-in",
    evidence: [
      "Scored 28% on Fractions Practice",
      "Used hints on 80% of questions",
      "Coach conversations suggest seeking support"
    ],
    suggestedTeacherActions: [
      "Review their responses to understand where they encountered difficulty",
      "Consider a brief one-on-one conversation to gauge understanding",
      "Identify if additional practice or different explanation approaches might help"
    ],
    priorityLevel: "high",
    confidenceScore: 0.92,
    studentIds: ["student-emma-001"],
    studentName: "Emma Johnson",
    assignmentId: "lesson-fractions-101",
    assignmentTitle: "Fractions Practice",
    ruleName: "needs-support",  // Groupable rule
    signals: {
      score: 28,
      hintUsageRate: 0.8,
      coachIntent: "support-seeking",
      hasTeacherNote: false
    }
  }));

  // 7. GROUP REVIEW / NEEDS SUPPORT - Grouped (multiple students, shared skill gap)
  recommendations.push(createRecommendation({
    insightType: "check_in",
    legacyType: "small-group",
    summary: "3 students may benefit from group review on Division Basics",
    evidence: [
      "Jake, Mia, and Noah show similar patterns",
      "Group averaged 38% on this assignment",
      "From Mrs. Smith's 3rd Grade Class"
    ],
    suggestedTeacherActions: [
      "Schedule a small group review session",
      "Focus on common areas of difficulty",
      "Prepare targeted practice activities"
    ],
    priorityLevel: "high",
    confidenceScore: 0.9,
    studentIds: ["student-jake-007", "student-mia-008", "student-noah-009"],
    studentName: "Jake, Mia, Noah",
    assignmentId: "lesson-division-707",
    assignmentTitle: "Division Basics",
    ruleName: "group-support",  // Groupable rule
    signals: {
      studentCount: 3,
      studentNames: "Jake, Mia, Noah",
      averageScore: 38,
      className: "Mrs. Smith's 3rd Grade"
    }
  }));

  // 8. ADMINISTRATIVE / MONITOR - Assignment-level (inherently aggregate)
  recommendations.push(createRecommendation({
    insightType: "monitor",
    legacyType: "assignment-adjustment",
    summary: "Time & Money assignment progress worth monitoring",
    evidence: [
      "Class average: 42%",
      "Completion rate: 35% (7/20 students)",
      "8 days since assigned"
    ],
    suggestedTeacherActions: [
      "Consider checking in with students who haven't started",
      "Review if assignment scaffolding or instructions need adjustment",
      "No immediate action needed - worth watching"
    ],
    priorityLevel: "low",
    confidenceScore: 0.75,
    studentIds: [],  // Assignment-level, no specific students
    studentName: "",
    assignmentId: "lesson-time-money-606",
    assignmentTitle: "Time & Money",
    ruleName: "watch-progress",  // Groupable rule
    signals: {
      averageScore: 42,
      completionRate: 35,
      daysSinceAssigned: 8,
      studentCount: 20,
      completedCount: 7
    }
  }));

  return recommendations;
}

// Main execution
function main() {
  const recommendations = generateDummyRecommendations();

  // Ensure data directory exists
  const dataDir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Load existing data or create new
  let data: { recommendations: Recommendation[]; lastUpdated: string } = {
    recommendations: [],
    lastUpdated: new Date().toISOString()
  };

  if (fs.existsSync(DATA_FILE)) {
    try {
      const content = fs.readFileSync(DATA_FILE, "utf-8");
      data = JSON.parse(content);
    } catch (err) {
      console.error("Error reading existing data:", err);
    }
  }

  // Clear existing active recommendations and add new ones
  data.recommendations = data.recommendations.filter(r => r.status !== "active");
  data.recommendations.push(...recommendations);
  data.lastUpdated = new Date().toISOString();

  // Write to file
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

  console.log(`Generated ${recommendations.length} dummy recommendations:\n`);
  console.log("INDIVIDUAL-ONLY CATEGORIES (never grouped):");
  console.log("  - 2x Celebrate Progress (Sofia +37pts, Oliver +46pts)");
  console.log("  - 1x Challenge Opportunity (Aiden - 96% on Science)");
  console.log("  - 1x Check-in Suggested (Lily - coach pattern)");
  console.log("  - 1x Developing (Marcus - 62%, 35% hints)");
  console.log("\nGROUPABLE CATEGORIES:");
  console.log("  - 1x Needs Support (Emma - 28% on Fractions) [single student]");
  console.log("  - 1x Needs Support ESCALATED (Taylor - 55%, 4 help requests) [from developing]");
  console.log("  - 1x Group Review (Jake, Mia, Noah) [multiple students]");
  console.log("  - 1x Administrative/Monitor (Time & Money) [assignment-level]");
  console.log("\nThreshold criteria:");
  console.log("  - Needs Support: score < 50% OR hint usage > 50%");
  console.log("  - Developing: score 50-79% AND hint usage 25-50%");
  console.log("  - Escalation: Developing + 3+ help requests -> Needs Support");
  console.log(`\nData saved to: ${DATA_FILE}`);
}

main();
