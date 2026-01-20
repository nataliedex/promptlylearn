/**
 * Services Index
 *
 * Export all services for easy access throughout the application.
 */

// Dashboard Services
export { educatorDashboardService, EducatorDashboardService } from "./educatorDashboardService";
export { assignmentDashboardService, AssignmentDashboardService } from "./assignmentDashboardService";
export { studentDashboardService, StudentDashboardService } from "./studentDashboardService";
export { workflowService, WorkflowService } from "./workflowService";

// Action Services
export { teacherActionService, TeacherActionService } from "./teacherActionService";
export type {
  ActionResult,
  MarkReviewedResult,
  PushBackResult,
  AddNoteResult,
  AwardBadgeResult,
  MarkReviewedInput,
  PushBackInput,
  AddNoteInput,
  AwardBadgeInput,
} from "./teacherActionService";

export { studentActionService, StudentActionService } from "./studentActionService";
export type {
  CompleteAssignmentResult,
  AskCoachResult,
  RetryAssignmentResult,
  CompleteAssignmentInput,
  AskCoachInput,
  RetryAssignmentInput,
} from "./studentActionService";

// Dashboard Integration Service (new)
export { dashboardIntegration, DashboardIntegration } from "./dashboardIntegration";

// Action Handlers (simple direct interface)
export {
  // Teacher Actions
  markInsightReviewed,
  pushAssignmentBack,
  addTeacherNote,
  awardBadge,
  // Student Actions
  completeAssignment,
  askCoach,
  retryAssignment,
  // Dashboard Helpers
  getPendingInsightsCount,
  getStudentPendingInsights,
  getAssignmentPendingInsights,
  getStudentBadges,
  getAssignmentRecord,
  getStudentAssignments,
  getInsightActions,
  getRecentTeacherActions,
  getStudentUnderstanding,
  // Bulk Operations
  markAllAssignmentInsightsReviewed,
  markAllStudentInsightsReviewed,
} from "../stores/actionHandlers";
