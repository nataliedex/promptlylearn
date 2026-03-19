import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";

import studentsRouter from "./routes/students";
import sessionsRouter from "./routes/sessions";
import lessonsRouter from "./routes/lessons";
import classesRouter from "./routes/classes";
import assignmentsRouter from "./routes/assignments";
import evaluateRouter from "./routes/evaluate";
import analyticsRouter from "./routes/analytics";
import voiceRouter from "./routes/voice";
import coachRouter from "./routes/coach";
import coachSessionsRouter from "./routes/coachSessions";
import recommendationsRouter from "./routes/recommendations";
import teacherTodosRouter from "./routes/teacherTodos";
import attentionRouter from "./routes/attention";
import coachingInvitesRouter from "./routes/coachingInvites";
import educatorProfileRouter from "./routes/educatorProfile";
import lessonDraftsRouter from "./routes/lessonDrafts";
import uploadsRouter from "./routes/uploads";
import coachAnalyticsRouter from "./routes/coachAnalytics";
import devRouter from "./routes/dev";
import { getUploadsBaseDir } from "../services/videoStorage";
import { SessionStore } from "../stores/sessionStore";

dotenv.config();

// ============================================
// Process-level error handlers — prevent silent crashes
// ============================================
process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught exception:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] Unhandled promise rejection:", reason);
});

const app = express();
const PORT = process.env.API_PORT || 3001;

// Middleware
app.use(cors({
  origin: ["http://localhost:5173", "http://localhost:3000"],
  credentials: true,
}));
app.use(express.json({ limit: "10mb" }));

// Routes
app.use("/api/students", studentsRouter);
app.use("/api/sessions", sessionsRouter);
app.use("/api/lessons", lessonsRouter);
app.use("/api/classes", classesRouter);
app.use("/api/assignments", assignmentsRouter);
app.use("/api/evaluate", evaluateRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/voice", voiceRouter);
app.use("/api/coach", coachRouter);
app.use("/api/coach-sessions", coachSessionsRouter);
app.use("/api/recommendations", recommendationsRouter);
app.use("/api/teacher-todos", teacherTodosRouter);
app.use("/api/attention", attentionRouter);
app.use("/api/coaching-invites", coachingInvitesRouter);
app.use("/api/educator", educatorProfileRouter);
app.use("/api/educator/lesson-drafts", lessonDraftsRouter);
app.use("/api/educator", coachAnalyticsRouter);
app.use("/api/uploads", uploadsRouter);

// Static file serving for uploaded videos
// Serves files from /uploads/videos/* with security checks
app.use("/uploads/videos", (req, res, next) => {
  // Prevent directory traversal by checking for .. in path
  if (req.path.includes("..")) {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}, express.static(getUploadsBaseDir(), {
  // Set appropriate headers for video files
  setHeaders: (res, filePath) => {
    // Allow video to be played in browser
    res.set("Accept-Ranges", "bytes");
    // Cache for 1 hour (local dev only; adjust for production)
    res.set("Cache-Control", "public, max-age=3600");
  },
}));

// Dev-only routes (seed data, reset)
if (process.env.NODE_ENV !== "production") {
  app.use("/api/dev", devRouter);
}

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Config endpoint (public settings for frontend)
app.get("/api/config", (req, res) => {
  res.json({
    demoLoginEnabled: process.env.ENABLE_DEMO_LOGIN === "true",
  });
});

// Global Express error handler — catches errors that escape route try/catch blocks
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[EXPRESS] Unhandled route error:", err);
  if (!res.headersSent) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);

  // Clean up expired draft states on startup
  try {
    const sessionStore = new SessionStore();
    sessionStore.cleanExpiredDrafts();
  } catch (err) {
    console.error("Failed to clean expired drafts:", err);
  }
});

export default app;
