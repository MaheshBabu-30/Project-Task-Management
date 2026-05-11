import { Hono } from "hono";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { roleMiddleware } from "../../middlewares/role.middleware.js";
import { exportHandler, importHandler, importCallbackHandler, importStatusHandler } from "./data-transfer.controller.js";
import type { AppEnv } from "../../types/hono.types.js";

const router = new Hono<AppEnv>();

// ─── Unified Export ───────────────────────────────────────────────────────────
router.get("/export", authMiddleware, roleMiddleware(["admin", "superadmin"]), exportHandler);

// ─── Unified Import (sync for all types except tasks; tasks → QStash async) ──
router.post("/import", authMiddleware, roleMiddleware(["admin", "superadmin"]), importHandler);

// ─── QStash Callback (no auth — verified via QStash signature) ───────────────
router.post("/import/callback", importCallbackHandler);

// ─── Import Job Status ────────────────────────────────────────────────────────
router.get("/import/status/:jobId", authMiddleware, roleMiddleware(["admin", "superadmin"]), importStatusHandler);

export default router;
