import { Hono } from "hono";
import { listAttachments, addAttachment, deleteAttachment, getAttachmentDownloadUrl } from "./attachment.controller.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { roleMiddleware } from "../../middlewares/role.middleware.js";
import type { AppEnv } from "../../types/hono.types.js";

const router = new Hono<AppEnv>({ strict: false });

router.use(authMiddleware);

// Routes are mounted under /api/tasks/:taskId/attachments
router.get("/", listAttachments);
router.post("/", roleMiddleware(["admin", "developer"]), addAttachment);
router.get("/:attachmentId/url", getAttachmentDownloadUrl);
router.delete("/:attachmentId", roleMiddleware(["admin", "developer"]), deleteAttachment);

export default router;
