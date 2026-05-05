import { Hono } from "hono";
import { listComments, addComment, editComment, removeComment } from "./comment.controller.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { roleMiddleware } from "../../middlewares/role.middleware.js";
import type { AppEnv } from "../../types/hono.types.js";

const router = new Hono<AppEnv>({ strict: false });

router.use(authMiddleware);

// Routes are mounted under /api/tasks/:taskId/comments
router.get("/", listComments);
router.post("/", roleMiddleware(["admin", "developer"]), addComment);
router.patch("/:commentId", roleMiddleware(["admin", "developer"]), editComment);
router.delete("/:commentId", roleMiddleware(["admin", "developer"]), removeComment);

export default router;
