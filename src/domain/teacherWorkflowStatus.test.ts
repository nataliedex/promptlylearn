/**
 * Teacher Workflow Status Tests
 *
 * Acceptance tests for the unified teacher workflow status computation.
 */

import {
  computeTeacherWorkflowStatus,
  computeAssignmentWorkflowRollup,
  areAllReviewsComplete,
  getAssignmentStatusLabel,
  WorkflowStatusInputs,
  StudentWorkflowData,
} from "./teacherWorkflowStatus";
import { DerivedInsight } from "./derivedInsight";

// Helper to create a minimal DerivedInsight for testing
function createInsight(
  type: DerivedInsight["type"],
  severity: DerivedInsight["severity"] = "medium",
  suggestedActions: DerivedInsight["suggestedActions"] = ["ADD_TODO"]
): DerivedInsight {
  return {
    id: `test-${type}-${Date.now()}`,
    attemptId: "attempt-1",
    assignmentId: "assignment-1",
    studentId: "student-1",
    classId: "class-1",
    createdAt: new Date().toISOString(),
    type,
    severity,
    scope: "assignment",
    title: `Test ${type}`,
    why: "Test reason",
    evidence: {},
    suggestedActions,
    navigationTargets: { route: "/test", state: {} },
  };
}

describe("computeTeacherWorkflowStatus", () => {
  // Test 1: Submitted + pending_review + actionable needs_support insight -> ACTION_REQUIRED
  test("returns ACTION_REQUIRED when pending_review with needs_support insight", () => {
    const inputs: WorkflowStatusInputs = {
      reviewState: "pending_review",
      hasSubmission: true,
      derivedInsights: [createInsight("NEEDS_SUPPORT", "high")],
      openTodosCount: 0,
    };

    expect(computeTeacherWorkflowStatus(inputs)).toBe("ACTION_REQUIRED");
  });

  // Test 2: Submitted + pending_review + no actionable insights -> NEEDS_REVIEW
  test("returns NEEDS_REVIEW when pending_review with no actionable insights", () => {
    const inputs: WorkflowStatusInputs = {
      reviewState: "pending_review",
      hasSubmission: true,
      derivedInsights: [],
      openTodosCount: 0,
    };

    expect(computeTeacherWorkflowStatus(inputs)).toBe("NEEDS_REVIEW");
  });

  // Test 3: Reviewed + open todo -> FOLLOW_UP_SCHEDULED
  test("returns FOLLOW_UP_SCHEDULED when reviewed with open todos", () => {
    const inputs: WorkflowStatusInputs = {
      reviewState: "reviewed",
      hasSubmission: true,
      derivedInsights: [],
      openTodosCount: 1,
    };

    expect(computeTeacherWorkflowStatus(inputs)).toBe("FOLLOW_UP_SCHEDULED");
  });

  // Test 4: Reviewed + no todos -> RESOLVED
  test("returns RESOLVED when reviewed with no open todos", () => {
    const inputs: WorkflowStatusInputs = {
      reviewState: "reviewed",
      hasSubmission: true,
      derivedInsights: [],
      openTodosCount: 0,
    };

    expect(computeTeacherWorkflowStatus(inputs)).toBe("RESOLVED");
  });

  // Test 5: Not submitted + no todos + no insights -> NO_ACTION
  test('returns NO_ACTION when no submission, no todos, no insights', () => {
    const inputs: WorkflowStatusInputs = {
      reviewState: null,
      hasSubmission: false,
      derivedInsights: [],
      openTodosCount: 0,
    };

    expect(computeTeacherWorkflowStatus(inputs)).toBe("NO_ACTION");
  });

  // Additional edge cases
  test("returns ACTION_REQUIRED for MOVE_ON_EVENT insight", () => {
    const inputs: WorkflowStatusInputs = {
      reviewState: "pending_review",
      hasSubmission: true,
      derivedInsights: [createInsight("MOVE_ON_EVENT", "high")],
      openTodosCount: 0,
    };

    expect(computeTeacherWorkflowStatus(inputs)).toBe("ACTION_REQUIRED");
  });

  test("returns ACTION_REQUIRED for MISCONCEPTION_FLAG insight", () => {
    const inputs: WorkflowStatusInputs = {
      reviewState: "pending_review",
      hasSubmission: true,
      derivedInsights: [createInsight("MISCONCEPTION_FLAG", "medium")],
      openTodosCount: 0,
    };

    expect(computeTeacherWorkflowStatus(inputs)).toBe("ACTION_REQUIRED");
  });

  test("returns NEEDS_REVIEW for low-severity CELEBRATE_PROGRESS insight", () => {
    const inputs: WorkflowStatusInputs = {
      reviewState: "pending_review",
      hasSubmission: true,
      derivedInsights: [createInsight("CELEBRATE_PROGRESS", "low")],
      openTodosCount: 0,
    };

    // Low severity positive insight doesn't upgrade to ACTION_REQUIRED
    expect(computeTeacherWorkflowStatus(inputs)).toBe("NEEDS_REVIEW");
  });

  test("returns RESOLVED even with low-severity insights when reviewed", () => {
    const inputs: WorkflowStatusInputs = {
      reviewState: "reviewed",
      hasSubmission: true,
      derivedInsights: [createInsight("CELEBRATE_PROGRESS", "low")],
      openTodosCount: 0,
    };

    expect(computeTeacherWorkflowStatus(inputs)).toBe("RESOLVED");
  });

  test("returns NEEDS_REVIEW when hasSubmission but reviewState is not_started", () => {
    const inputs: WorkflowStatusInputs = {
      reviewState: "not_started",
      hasSubmission: true,
      derivedInsights: [],
      openTodosCount: 0,
    };

    expect(computeTeacherWorkflowStatus(inputs)).toBe("NEEDS_REVIEW");
  });
});

describe("computeAssignmentWorkflowRollup", () => {
  test("correctly counts students by status", () => {
    const students: StudentWorkflowData[] = [
      { studentId: "1", status: "NEEDS_REVIEW", hasSubmission: true },
      { studentId: "2", status: "ACTION_REQUIRED", hasSubmission: true },
      { studentId: "3", status: "FOLLOW_UP_SCHEDULED", hasSubmission: true },
      { studentId: "4", status: "RESOLVED", hasSubmission: true },
      { studentId: "5", status: "NO_ACTION", hasSubmission: false },
    ];

    const rollup = computeAssignmentWorkflowRollup(students);

    // ACTION_REQUIRED counts in both actionRequiredCount AND needsReviewCount
    expect(rollup.needsReviewCount).toBe(2); // 1 NEEDS_REVIEW + 1 ACTION_REQUIRED
    expect(rollup.actionRequiredCount).toBe(1);
    expect(rollup.followUpScheduledCount).toBe(1);
    expect(rollup.resolvedCount).toBe(1);
    expect(rollup.notSubmittedCount).toBe(1);
    expect(rollup.totalStudents).toBe(5);
  });
});

describe("areAllReviewsComplete", () => {
  // Test 6: Assignment rollup says "All students reviewed" only when both counts are 0
  test("returns true only when needsReviewCount and actionRequiredCount are 0", () => {
    const completeRollup = {
      needsReviewCount: 0,
      actionRequiredCount: 0,
      followUpScheduledCount: 2,
      resolvedCount: 3,
      notSubmittedCount: 0,
      totalStudents: 5,
    };

    expect(areAllReviewsComplete(completeRollup)).toBe(true);

    const incompleteRollup = {
      needsReviewCount: 1,
      actionRequiredCount: 0,
      followUpScheduledCount: 2,
      resolvedCount: 2,
      notSubmittedCount: 0,
      totalStudents: 5,
    };

    expect(areAllReviewsComplete(incompleteRollup)).toBe(false);

    const actionRequiredRollup = {
      needsReviewCount: 1,
      actionRequiredCount: 1,
      followUpScheduledCount: 0,
      resolvedCount: 3,
      notSubmittedCount: 0,
      totalStudents: 5,
    };

    expect(areAllReviewsComplete(actionRequiredRollup)).toBe(false);
  });
});

describe("getAssignmentStatusLabel", () => {
  test('returns "Needs attention" when actionRequiredCount > 0', () => {
    const rollup = {
      needsReviewCount: 2,
      actionRequiredCount: 1,
      followUpScheduledCount: 0,
      resolvedCount: 0,
      notSubmittedCount: 0,
      totalStudents: 3,
    };

    expect(getAssignmentStatusLabel(rollup)).toBe("Needs attention");
  });

  test('returns "Needs review" when needsReviewCount > 0 but no action required', () => {
    const rollup = {
      needsReviewCount: 2,
      actionRequiredCount: 0,
      followUpScheduledCount: 0,
      resolvedCount: 0,
      notSubmittedCount: 0,
      totalStudents: 2,
    };

    expect(getAssignmentStatusLabel(rollup)).toBe("Needs review");
  });

  test('returns "Follow-ups scheduled" when all reviewed but has follow-ups', () => {
    const rollup = {
      needsReviewCount: 0,
      actionRequiredCount: 0,
      followUpScheduledCount: 2,
      resolvedCount: 1,
      notSubmittedCount: 0,
      totalStudents: 3,
    };

    expect(getAssignmentStatusLabel(rollup)).toBe("Follow-ups scheduled");
  });

  test('returns "Reviewed" when all resolved', () => {
    const rollup = {
      needsReviewCount: 0,
      actionRequiredCount: 0,
      followUpScheduledCount: 0,
      resolvedCount: 3,
      notSubmittedCount: 0,
      totalStudents: 3,
    };

    expect(getAssignmentStatusLabel(rollup)).toBe("Reviewed");
  });

  test('returns "Awaiting submissions" when no submissions', () => {
    const rollup = {
      needsReviewCount: 0,
      actionRequiredCount: 0,
      followUpScheduledCount: 0,
      resolvedCount: 0,
      notSubmittedCount: 3,
      totalStudents: 3,
    };

    expect(getAssignmentStatusLabel(rollup)).toBe("Awaiting submissions");
  });
});
