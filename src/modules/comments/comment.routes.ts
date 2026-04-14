import { Hono } from "hono";
import { listComments, addComment, editComment, removeComment } from "./comment.controller.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";

const router = new Hono({ strict: false });

router.use(authMiddleware);

// Routes are mounted under /api/tasks/:taskId/comments
router.get("/", listComments);
router.post("/", addComment);
router.patch("/:commentId", editComment);
router.delete("/:commentId", removeComment);

export default router;
