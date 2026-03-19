/**
 * Tests verifying the Assignment Review page cleanup:
 * 1. Edit Lesson is inside AssignmentActions (overflow menu), not a standalone button
 * 2. "Submissions awaiting review" banner is removed
 * 3. ViewAssignmentToggle / "Review Questions" dropdown is removed
 * 4. EditLessonModal is removed (Edit navigates to LessonEditor page)
 * 5. AssignmentPreviewPanel is no longer rendered
 *
 * Since these are structural tests (no React DOM), we verify by reading
 * the source file and checking for presence/absence of key patterns.
 */

import * as fs from "fs";
import * as path from "path";

const SOURCE = fs.readFileSync(
  path.join(__dirname, "AssignmentReview.tsx"),
  "utf-8"
);

describe("Assignment Review cleanup", () => {
  describe("Edit Lesson moved into overflow menu", () => {
    it("AssignmentActions accepts onEditLesson prop", () => {
      expect(SOURCE).toContain("onEditLesson?: () => void");
    });

    it("renders Edit Lesson item inside AssignmentActions dropdown", () => {
      // The menu item text inside AssignmentActions
      expect(SOURCE).toContain("onEditLesson()");
    });

    it("no standalone Edit Lesson button in main header", () => {
      // The main header should use AssignmentActions, not a raw button with "Edit Lesson"
      // There should be no <button ... >Edit Lesson</button> outside AssignmentActions
      const lines = SOURCE.split("\n");
      const assignmentActionsStart = lines.findIndex(l => l.includes("function AssignmentActions("));
      const beforeActions = lines.slice(0, assignmentActionsStart).join("\n");

      // In the main render, Edit Lesson should NOT appear as a direct button label
      // (it appeared previously as a standalone button in the header)
      const mainRenderEditButtons = beforeActions.match(/>[\s\n]*Edit Lesson[\s\n]*<\/button>/g);
      expect(mainRenderEditButtons).toBeNull();
    });
  });

  describe("submissions awaiting review banner removed", () => {
    it("does not render 'awaiting review' banner text", () => {
      // The banner showed "X submission(s) awaiting review" — that JSX is removed
      expect(SOURCE).not.toContain("submissions awaiting review");
      expect(SOURCE).not.toContain("submission awaiting review");
    });

    it("does not contain 'View Flagged Students' button", () => {
      expect(SOURCE).not.toContain("View Flagged Students");
    });

    it("does not reference handleViewAllFlagged", () => {
      expect(SOURCE).not.toContain("handleViewAllFlagged");
    });
  });

  describe("Review Questions dropdown removed", () => {
    it("ViewAssignmentToggle component is removed", () => {
      expect(SOURCE).not.toContain("function ViewAssignmentToggle");
    });

    it("showPreview state is removed", () => {
      expect(SOURCE).not.toContain("showPreview");
    });

    it("Review Questions text is removed", () => {
      expect(SOURCE).not.toContain("Review Questions");
    });
  });

  describe("EditLessonModal removed — navigates to LessonEditor", () => {
    it("EditLessonModal component is removed", () => {
      expect(SOURCE).not.toContain("function EditLessonModal");
    });

    it("navigates to LessonEditor route", () => {
      expect(SOURCE).toContain("navigate(`/educator/lesson/${lessonId}/edit`)");
    });

    it("no saveLesson import", () => {
      expect(SOURCE).not.toContain("saveLesson");
    });

    it("no generateQuestion import", () => {
      expect(SOURCE).not.toContain("generateQuestion");
    });
  });

  describe("AssignmentPreviewPanel removed", () => {
    it("AssignmentPreviewPanel is not imported", () => {
      expect(SOURCE).not.toContain("AssignmentPreviewPanel");
    });
  });

  describe("layout remains clean", () => {
    it("Status Tiles still render", () => {
      expect(SOURCE).toContain("StatusTile");
    });

    it("Student table still renders", () => {
      expect(SOURCE).toContain("StudentRow");
    });

    it("InsightsDrawer still renders", () => {
      expect(SOURCE).toContain("InsightsDrawer");
    });

    it("tabs still render with Needs Review count", () => {
      expect(SOURCE).toContain("Needs Review");
      expect(SOURCE).toContain("All Submissions");
    });
  });
});
