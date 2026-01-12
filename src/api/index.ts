import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import studentsRouter from "./routes/students";
import sessionsRouter from "./routes/sessions";
import lessonsRouter from "./routes/lessons";
import evaluateRouter from "./routes/evaluate";
import analyticsRouter from "./routes/analytics";

dotenv.config();

const app = express();
const PORT = process.env.API_PORT || 3001;

// Middleware
app.use(cors({
  origin: ["http://localhost:5173", "http://localhost:3000"],
  credentials: true,
}));
app.use(express.json());

// Routes
app.use("/api/students", studentsRouter);
app.use("/api/sessions", sessionsRouter);
app.use("/api/lessons", lessonsRouter);
app.use("/api/evaluate", evaluateRouter);
app.use("/api/analytics", analyticsRouter);

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
});

export default app;
