import { Hono } from "hono";
import { listAttachments, addAttachment, deleteAttachment, getAttachmentDownloadUrl } from "./attachment.controller.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import type { AppEnv } from "../../types/hono.types.js";

const router = new Hono<AppEnv>({ strict: false });

router.use(authMiddleware);

// Routes are mounted under /api/tasks/:taskId/attachments
router.get("/", listAttachments);
router.post("/", addAttachment);
router.get("/:attachmentId/url", getAttachmentDownloadUrl);
router.delete("/:attachmentId", deleteAttachment);

export default router;
