import { Hono } from "hono";
import { getUsersList, toggleUserStatus, updateMe, getUserDetails, createNewUser } from "./user.controller.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { roleMiddleware } from "../../middlewares/role.middleware.js";

const router = new Hono();

router.use(authMiddleware);

// Superadmin creates admin/developer; Admin creates developer only
router.post("/", roleMiddleware(["superadmin", "admin"]), createNewUser);

// All users can see details within their scope
router.get("/", getUsersList);
router.get("/:id", getUserDetails);

// Users can update their own profile
router.patch("/me", updateMe);

// Only admins can toggle developer status
router.patch("/:id/status", roleMiddleware(["admin", "superadmin"]), toggleUserStatus);

export default router;
