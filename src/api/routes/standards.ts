import { Router } from "express";
import {
  loadStandards,
  getStandardsForGrade,
  getReadingStandards,
  getWritingStandards,
  getSpeakingListeningStandards,
  normalizeGradeLevel,
} from "../../domain/standards";

const router = Router();

// GET /api/standards - Get all standards metadata
router.get("/", (req, res) => {
  try {
    const standards = loadStandards();
    res.json({
      source: standards.source,
      version: standards.version,
      url: standards.url,
      grades: Object.keys(standards.grades),
    });
  } catch (error) {
    console.error("Error fetching standards:", error);
    res.status(500).json({ error: "Failed to fetch standards" });
  }
});

// GET /api/standards/:grade - Get all standards for a specific grade
router.get("/:grade", (req, res) => {
  try {
    const gradeStandards = getStandardsForGrade(req.params.grade);

    if (!gradeStandards) {
      return res.status(404).json({ error: "Grade not found" });
    }

    res.json(gradeStandards);
  } catch (error) {
    console.error("Error fetching grade standards:", error);
    res.status(500).json({ error: "Failed to fetch grade standards" });
  }
});

// GET /api/standards/:grade/reading - Get reading standards for a grade
router.get("/:grade/reading", (req, res) => {
  try {
    const standards = getReadingStandards(req.params.grade);
    res.json(standards);
  } catch (error) {
    console.error("Error fetching reading standards:", error);
    res.status(500).json({ error: "Failed to fetch reading standards" });
  }
});

// GET /api/standards/:grade/writing - Get writing standards for a grade
router.get("/:grade/writing", (req, res) => {
  try {
    const standards = getWritingStandards(req.params.grade);
    res.json(standards);
  } catch (error) {
    console.error("Error fetching writing standards:", error);
    res.status(500).json({ error: "Failed to fetch writing standards" });
  }
});

// GET /api/standards/:grade/speaking - Get speaking/listening standards for a grade
router.get("/:grade/speaking", (req, res) => {
  try {
    const standards = getSpeakingListeningStandards(req.params.grade);
    res.json(standards);
  } catch (error) {
    console.error("Error fetching speaking standards:", error);
    res.status(500).json({ error: "Failed to fetch speaking standards" });
  }
});

export default router;
