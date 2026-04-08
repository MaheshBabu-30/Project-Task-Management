import { Hono } from "hono";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import {
  createOrg,
  listOrgs,
  getOrgDetails,
  assignAdmin,
  addDeveloper,
  removeMember,
  registerAdmin,
  registerDeveloper,
} from "./org.controller.js";

const router = new Hono();

router.use(authMiddleware);

// SUPERADMIN: Create organization
router.post("/", createOrg);

// SUPERADMIN: List all organizations
router.get("/", listOrgs);

// SUPERADMIN + ADMIN (own org): Get org details with members
router.get("/:id", getOrgDetails);

// SUPERADMIN: Assign an admin user to an org
router.post("/:id/admin", assignAdmin);

// SUPERADMIN: Create a new user account and assign as admin
router.post("/:id/register-admin", registerAdmin);

// ADMIN: Add a developer to their org
router.post("/:id/developers", addDeveloper);

// ADMIN: Create a new developer account and assign to org
router.post("/:id/register-developer", registerDeveloper);

// SUPERADMIN + ADMIN: Remove a member from an org
router.delete("/:id/members/:userId", removeMember);

export default router;
