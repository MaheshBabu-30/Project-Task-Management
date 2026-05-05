import { Hono } from "hono";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { roleMiddleware } from "../../middlewares/role.middleware.js";
import { exportHandler, importHandler } from "./data-transfer.controller.js";
import type { AppEnv } from "../../types/hono.types.js";

const router = new Hono<AppEnv>();

router.use(authMiddleware);

// ─── Unified Export ───────────────────────────────────────────────────────────
router.get("/export", roleMiddleware(["admin", "superadmin"]), exportHandler);

// ─── Unified Import ───────────────────────────────────────────────────────────
router.post("/import", roleMiddleware(["admin", "superadmin"]), importHandler);

export default router;
