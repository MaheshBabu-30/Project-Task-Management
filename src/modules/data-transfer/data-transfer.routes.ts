import { Hono } from "hono";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { roleMiddleware } from "../../middlewares/role.middleware.js";
import {
  exportProjectTasksHandler,
  exportFullProjectHandler,
  exportOrgMembersHandler,
  importProjectTasksHandler,
  importProjectHandler,
} from "./data-transfer.controller.js";
import type { AppEnv } from "../../types/hono.types.js";

const router = new Hono<AppEnv>();

router.use(authMiddleware);

// ─── Project Exports ──────────────────────────────────────────────────────────
router.get("/projects/:id/tasks/export", roleMiddleware(["admin", "superadmin"]), exportProjectTasksHandler);
router.get("/projects/:id/export", roleMiddleware(["admin", "superadmin"]), exportFullProjectHandler);

// ─── Org Exports ──────────────────────────────────────────────────────────────
router.get("/orgs/:id/members/export", roleMiddleware(["admin", "superadmin"]), exportOrgMembersHandler);

// ─── Project Imports ──────────────────────────────────────────────────────────
router.post("/projects/:id/tasks/import", roleMiddleware(["admin", "superadmin"]), importProjectTasksHandler);

// ─── Org Imports ──────────────────────────────────────────────────────────────
router.post("/orgs/:id/projects/import", roleMiddleware(["admin", "superadmin"]), importProjectHandler);

export default router;
