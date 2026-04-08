import { Hono } from "hono";
import { getUploadUrl } from "./upload.controller.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";

const router = new Hono();

router.use(authMiddleware);

// Request a pre-signed URL for direct upload
router.post("/presigned-url", getUploadUrl);

export default router;
