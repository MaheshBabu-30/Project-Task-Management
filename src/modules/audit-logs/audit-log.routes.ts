import { Hono } from "hono";
import { listAuditLogs } from "./audit-log.controller.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { roleMiddleware } from "../../middlewares/role.middleware.js";
import type { AppEnv } from "../../types/hono.types.js";

const router = new Hono<AppEnv>();

router.use(authMiddleware);

// Superadmin sees all; Admin sees their org only (scoped in service)
router.get("/", roleMiddleware(["superadmin", "admin"]), listAuditLogs);

export default router;
