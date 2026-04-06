import { Hono } from "hono";
import { getUsersList, toggleUserStatus } from "./user.controller.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { roleMiddleware } from "../../middlewares/role.middleware.js";

const router = new Hono();

router.use(authMiddleware);
router.use(roleMiddleware(["ADMIN"]));

router.get("/", getUsersList);
router.patch("/:id/status", toggleUserStatus);

export default router;
