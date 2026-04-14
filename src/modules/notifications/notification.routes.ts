import { Hono } from "hono";
import { listNotifications, markOneRead, markAllRead } from "./notification.controller.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";

const router = new Hono();

router.use(authMiddleware);

router.get("/", listNotifications);
router.patch("/:id/read", markOneRead);
router.post("/read-all", markAllRead);

export default router;
