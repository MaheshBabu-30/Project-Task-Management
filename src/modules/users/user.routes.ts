import { Hono } from "hono";
import { getUsersList, toggleUserStatus, getMe, updateMe, getUserDetails, createNewUser } from "./user.controller.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { roleMiddleware } from "../../middlewares/role.middleware.js";
import type { AppEnv } from "../../types/hono.types.js";

const router = new Hono<AppEnv>();

router.use(authMiddleware);

// Superadmin creates admin only; Admin creates developer only
router.post("/", roleMiddleware(["superadmin", "admin"]), createNewUser);

// Users can get and update their own profile — must be before /:id to avoid route conflict
router.get("/me", getMe);
router.patch("/me", updateMe);

// All users can see details within their scope
router.get("/", getUsersList);
router.get("/:id", getUserDetails);

// Superadmin can toggle admin status; admin can toggle developer status
router.patch("/:id/status", roleMiddleware(["superadmin", "admin"]), toggleUserStatus);

export default router;
