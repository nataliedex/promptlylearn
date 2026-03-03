/**
 * Video Upload API Routes
 *
 * Handles video file uploads for student responses.
 * Files are stored on the local filesystem for MVP.
 */

import { Router, Request, Response } from "express";
import multer from "multer";
import {
  saveVideo,
  validateVideoFile,
  MAX_VIDEO_SIZE_BYTES,
  ALLOWED_VIDEO_TYPES,
} from "../../services/videoStorage";

const router = Router();

// Configure multer for memory storage (we'll handle disk storage ourselves)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_VIDEO_SIZE_BYTES,
  },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_VIDEO_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid video type: ${file.mimetype}. Allowed types: ${ALLOWED_VIDEO_TYPES.join(", ")}`));
    }
  },
});

/**
 * POST /api/uploads/video
 *
 * Upload a video file for a student response.
 *
 * Form data fields:
 * - video: The video file (required)
 * - studentId: Student ID (required)
 * - assignmentId: Assignment ID (required)
 * - questionId: Question/Prompt ID (required)
 * - kind: "answer" or "coach_convo" (optional, defaults to "answer")
 * - durationSec: Video duration in seconds (required)
 *
 * Returns: VideoResponse metadata
 */
router.post("/video", (req: Request, res: Response, next) => {
  // Wrap multer to catch its errors properly
  upload.single("video")(req, res, (err) => {
    if (err) {
      console.error("[Upload] Multer error:", err);
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({
            error: `File too large. Maximum size is ${MAX_VIDEO_SIZE_BYTES / 1024 / 1024}MB`,
          });
        }
        return res.status(400).json({ error: `Upload error: ${err.message}` });
      }
      return res.status(400).json({ error: err.message || "Upload failed" });
    }
    next();
  });
}, async (req: Request, res: Response) => {
  try {
    console.log("[Upload] Processing video upload request");

    // Validate file exists
    if (!req.file) {
      console.log("[Upload] No file in request");
      return res.status(400).json({ error: "No video file provided" });
    }

    console.log("[Upload] File received:", {
      size: req.file.size,
      mimetype: req.file.mimetype,
      originalname: req.file.originalname,
    });

    // Extract and validate form fields
    const { studentId, assignmentId, questionId, kind, durationSec } = req.body;

    console.log("[Upload] Form fields:", { studentId, assignmentId, questionId, kind, durationSec });

    if (!studentId) {
      return res.status(400).json({ error: "studentId is required" });
    }
    if (!assignmentId) {
      return res.status(400).json({ error: "assignmentId is required" });
    }
    if (!questionId) {
      return res.status(400).json({ error: "questionId is required" });
    }
    if (!durationSec) {
      return res.status(400).json({ error: "durationSec is required" });
    }

    const duration = parseFloat(durationSec);
    if (isNaN(duration) || duration <= 0) {
      return res.status(400).json({ error: "durationSec must be a positive number" });
    }

    const videoKind = kind === "coach_convo" ? "coach_convo" : "answer";

    // Validate video before saving
    console.log("[Upload] Validating video file...");
    const validation = validateVideoFile(
      req.file.buffer,
      req.file.mimetype,
      duration,
      videoKind
    );

    if (!validation.valid) {
      console.log("[Upload] Validation failed:", validation.error);
      return res.status(400).json({ error: validation.error });
    }

    // Save the video and get metadata
    console.log("[Upload] Saving video file...");
    const videoMetadata = await saveVideo(
      req.file.buffer,
      req.file.mimetype,
      duration,
      videoKind,
      studentId,
      assignmentId,
      questionId
    );

    console.log("[Upload] Video saved successfully:", videoMetadata.url);

    // Return the video metadata
    res.status(201).json(videoMetadata);
  } catch (error) {
    console.error("[Upload] Video upload error:", error);

    // Handle validation errors
    if (error instanceof Error) {
      return res.status(400).json({ error: error.message });
    }

    res.status(500).json({ error: "Failed to upload video" });
  }
});

export default router;
