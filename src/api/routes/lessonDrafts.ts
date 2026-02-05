import express from "express";
import { lessonDraftStore } from "../../stores/lessonDraftStore";
import { LessonDraftInput } from "../../domain/lessonDraft";

const router = express.Router();

/**
 * GET /api/educator/lesson-drafts
 * List all lesson drafts
 */
router.get("/", (_req, res) => {
  try {
    const drafts = lessonDraftStore.listDrafts();
    res.json({
      drafts,
      count: drafts.length,
    });
  } catch (error) {
    console.error("Error listing lesson drafts:", error);
    res.status(500).json({ error: "Failed to list lesson drafts" });
  }
});

/**
 * GET /api/educator/lesson-drafts/:id
 * Get a specific draft by ID
 */
router.get("/:id", (req, res) => {
  try {
    const { id } = req.params;
    const draft = lessonDraftStore.getDraftById(id);

    if (!draft) {
      return res.status(404).json({ error: "Draft not found" });
    }

    res.json({ draft });
  } catch (error) {
    console.error("Error getting lesson draft:", error);
    res.status(500).json({ error: "Failed to get lesson draft" });
  }
});

/**
 * POST /api/educator/lesson-drafts
 * Create a new lesson draft
 *
 * Body: LessonDraftInput
 */
router.post("/", (req, res) => {
  try {
    const input: LessonDraftInput = req.body;
    const draft = lessonDraftStore.createDraft(input);

    res.status(201).json({ draft });
  } catch (error) {
    console.error("Error creating lesson draft:", error);
    res.status(500).json({ error: "Failed to create lesson draft" });
  }
});

/**
 * PATCH /api/educator/lesson-drafts/:id
 * Update an existing lesson draft
 *
 * Body: LessonDraftInput (partial)
 */
router.patch("/:id", (req, res) => {
  try {
    const { id } = req.params;
    const updates: LessonDraftInput = req.body;

    const draft = lessonDraftStore.updateDraft(id, updates);

    if (!draft) {
      return res.status(404).json({ error: "Draft not found" });
    }

    res.json({ draft });
  } catch (error) {
    console.error("Error updating lesson draft:", error);
    res.status(500).json({ error: "Failed to update lesson draft" });
  }
});

/**
 * DELETE /api/educator/lesson-drafts/:id
 * Delete a lesson draft
 */
router.delete("/:id", (req, res) => {
  try {
    const { id } = req.params;
    const deleted = lessonDraftStore.deleteDraft(id);

    if (!deleted) {
      return res.status(404).json({ error: "Draft not found" });
    }

    res.json({ success: true, id });
  } catch (error) {
    console.error("Error deleting lesson draft:", error);
    res.status(500).json({ error: "Failed to delete lesson draft" });
  }
});

export default router;
