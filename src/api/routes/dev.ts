/**
 * Development-Only API Routes
 *
 * These endpoints are only available when NODE_ENV !== "production".
 * Used for seeding demo data and resetting the application state.
 */

import { Router } from "express";
import { seedDataService } from "../../services/seedDataService";

const router = Router();

// Middleware to block in production
router.use((req, res, next) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(403).json({ error: "Dev endpoints not available in production" });
  }
  next();
});

// ============================================
// GET /api/dev/status
// Check if dev mode is available
// ============================================

router.get("/status", (req, res) => {
  res.json({
    devMode: true,
    nodeEnv: process.env.NODE_ENV || "development",
  });
});

// ============================================
// POST /api/dev/seed
// Generate all seed data
// ============================================

router.post("/seed", async (req, res) => {
  try {
    console.log("Starting seed data generation...");
    const result = await seedDataService.seedAll();
    console.log("Seed complete:", result.summary);
    res.json({
      success: true,
      message: result.summary,
      counts: result.counts,
    });
  } catch (error) {
    console.error("Seed failed:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// ============================================
// POST /api/dev/reset-demo
// Clear only demo/seeded data (preserves user data)
// ============================================

router.post("/reset-demo", async (req, res) => {
  try {
    console.log("Clearing demo data only...");
    await seedDataService.clearDemoData();
    console.log("Demo data cleared");
    res.json({
      success: true,
      message: "Demo data cleared (your data is preserved)",
    });
  } catch (error) {
    console.error("Reset demo failed:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// ============================================
// POST /api/dev/reset-all
// Clear ALL data files (destructive!)
// ============================================

router.post("/reset-all", async (req, res) => {
  try {
    console.log("Starting FULL data reset...");
    await seedDataService.clearAllData();
    console.log("All data cleared");
    res.json({
      success: true,
      message: "ALL data cleared (everything deleted)",
    });
  } catch (error) {
    console.error("Reset all failed:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;
