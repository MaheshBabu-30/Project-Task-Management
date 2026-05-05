import { Hono } from "hono";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { roleMiddleware } from "../../middlewares/role.middleware.js";
import {
  createOrg,
  listOrgs,
  getOrgDetails,
  assignAdmin,
  addDeveloper,
  removeMember,
  deleteOrg,
} from "./org.controller.js";
import type { AppEnv } from "../../types/hono.types.js";

const router = new Hono<AppEnv>();

router.use(authMiddleware);

router.post("/", roleMiddleware(["superadmin"]), createOrg);
router.get("/", roleMiddleware(["superadmin"]), listOrgs);
router.get("/:id", roleMiddleware(["superadmin", "admin", "developer"]), getOrgDetails);
router.post("/:id/admin", roleMiddleware(["superadmin"]), assignAdmin);
router.post("/:id/developers", roleMiddleware(["admin"]), addDeveloper);
router.delete("/:id", roleMiddleware(["superadmin"]), deleteOrg);
router.delete("/:id/members/:userId", roleMiddleware(["admin"]), removeMember);

export default router;
