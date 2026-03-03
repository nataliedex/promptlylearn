/**
 * Video Storage Service
 *
 * Encapsulates video file storage operations.
 * Currently uses local filesystem storage.
 * Designed for easy migration to cloud storage (S3, R2, GCS) later.
 */

import fs from "fs";
import path from "path";
import { VideoResponse } from "../domain/submission";

// Base directory for video uploads (relative to project root)
const UPLOADS_BASE_DIR = path.join(__dirname, "../../uploads/videos");

// Maximum file size in bytes (50MB for 2-minute conversation videos)
export const MAX_VIDEO_SIZE_BYTES = 50 * 1024 * 1024;

// Allowed video MIME types
export const ALLOWED_VIDEO_TYPES = [
  "video/webm",
  "video/mp4",
  "video/quicktime",
  "video/x-matroska",
];

// Maximum duration limits in seconds
export const MAX_DURATION_ANSWER = 60; // 60 seconds for question answers
export const MAX_DURATION_COACH_CONVO = 120; // 120 seconds for coach conversations

/**
 * Ensure the uploads directory structure exists
 */
function ensureDirectoryExists(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Generate a unique filename for a video upload
 */
function generateFilename(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}.webm`;
}

/**
 * Build the storage path for a video file
 * Structure: uploads/videos/{studentId}/{assignmentId}/{questionId}/{filename}
 */
function buildStoragePath(
  studentId: string,
  assignmentId: string,
  questionId: string,
  filename: string
): string {
  // Sanitize path components to prevent directory traversal
  const sanitize = (str: string) => str.replace(/[^a-zA-Z0-9_-]/g, "_");

  return path.join(
    UPLOADS_BASE_DIR,
    sanitize(studentId),
    sanitize(assignmentId),
    sanitize(questionId),
    filename
  );
}

/**
 * Build the public URL for a video file
 */
function buildPublicUrl(
  studentId: string,
  assignmentId: string,
  questionId: string,
  filename: string
): string {
  // Sanitize path components
  const sanitize = (str: string) => str.replace(/[^a-zA-Z0-9_-]/g, "_");

  return `/uploads/videos/${sanitize(studentId)}/${sanitize(assignmentId)}/${sanitize(questionId)}/${filename}`;
}

/**
 * Validate video file
 */
export function validateVideoFile(
  buffer: Buffer,
  mimeType: string,
  durationSec: number,
  kind: "answer" | "coach_convo"
): { valid: boolean; error?: string } {
  // Check file size
  if (buffer.length > MAX_VIDEO_SIZE_BYTES) {
    return {
      valid: false,
      error: `Video file size (${Math.round(buffer.length / 1024 / 1024)}MB) exceeds maximum allowed (${MAX_VIDEO_SIZE_BYTES / 1024 / 1024}MB)`,
    };
  }

  // Check MIME type
  if (!ALLOWED_VIDEO_TYPES.includes(mimeType)) {
    return {
      valid: false,
      error: `Invalid video type: ${mimeType}. Allowed types: ${ALLOWED_VIDEO_TYPES.join(", ")}`,
    };
  }

  // Check duration
  const maxDuration = kind === "coach_convo" ? MAX_DURATION_COACH_CONVO : MAX_DURATION_ANSWER;
  if (durationSec > maxDuration) {
    return {
      valid: false,
      error: `Video duration (${durationSec}s) exceeds maximum allowed (${maxDuration}s) for ${kind}`,
    };
  }

  return { valid: true };
}

/**
 * Save a video file to storage
 * Returns the video metadata including the public URL
 */
export async function saveVideo(
  buffer: Buffer,
  mimeType: string,
  durationSec: number,
  kind: "answer" | "coach_convo",
  studentId: string,
  assignmentId: string,
  questionId: string
): Promise<VideoResponse> {
  // Validate the video
  const validation = validateVideoFile(buffer, mimeType, durationSec, kind);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // Generate filename and paths
  const filename = generateFilename();
  const storagePath = buildStoragePath(studentId, assignmentId, questionId, filename);
  const publicUrl = buildPublicUrl(studentId, assignmentId, questionId, filename);

  // Ensure directory exists
  ensureDirectoryExists(path.dirname(storagePath));

  // Write file to disk
  await fs.promises.writeFile(storagePath, buffer);

  // Return video metadata
  const metadata: VideoResponse = {
    url: publicUrl,
    mimeType,
    durationSec,
    sizeBytes: buffer.length,
    createdAt: new Date().toISOString(),
    kind,
  };

  return metadata;
}

/**
 * Delete a video file from storage
 */
export async function deleteVideo(url: string): Promise<boolean> {
  try {
    // Convert public URL to filesystem path
    const relativePath = url.replace(/^\/uploads\/videos\//, "");
    const absolutePath = path.join(UPLOADS_BASE_DIR, relativePath);

    // Validate path is within uploads directory (prevent directory traversal)
    const normalizedPath = path.normalize(absolutePath);
    if (!normalizedPath.startsWith(path.normalize(UPLOADS_BASE_DIR))) {
      throw new Error("Invalid video path");
    }

    if (fs.existsSync(absolutePath)) {
      await fs.promises.unlink(absolutePath);
      return true;
    }

    return false;
  } catch (error) {
    console.error("Failed to delete video:", error);
    return false;
  }
}

/**
 * Get the filesystem path for serving a video
 * Returns null if the path would escape the uploads directory
 */
export function getVideoFilePath(relativePath: string): string | null {
  // Remove leading slash and /uploads/videos prefix if present
  const cleanPath = relativePath
    .replace(/^\/+/, "")
    .replace(/^uploads\/videos\//, "");

  const absolutePath = path.join(UPLOADS_BASE_DIR, cleanPath);

  // Validate path is within uploads directory (prevent directory traversal)
  const normalizedPath = path.normalize(absolutePath);
  if (!normalizedPath.startsWith(path.normalize(UPLOADS_BASE_DIR))) {
    return null;
  }

  if (!fs.existsSync(absolutePath)) {
    return null;
  }

  return absolutePath;
}

/**
 * Get the base uploads directory path
 * Useful for setting up static file serving
 */
export function getUploadsBaseDir(): string {
  ensureDirectoryExists(UPLOADS_BASE_DIR);
  return UPLOADS_BASE_DIR;
}
