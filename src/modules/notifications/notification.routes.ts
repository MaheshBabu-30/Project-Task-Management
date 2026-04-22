import { Hono } from "hono";
import { listNotifications, markOneRead, markAllRead } from "./notification.controller.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import type { AppEnv } from "../../types/hono.types.js";

const router = new Hono<AppEnv>();

router.use(authMiddleware);

router.get("/", listNotifications);
router.patch("/read-all", markAllRead);
router.patch("/:id/read", markOneRead);

export default router;
