import { Hono } from "hono";
import { getUploadUrl } from "./upload.controller.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import type { AppEnv } from "../../types/hono.types.js";

const router = new Hono<AppEnv>();

router.use(authMiddleware);

// Request a pre-signed URL for direct upload
router.post("/presigned-url", getUploadUrl);

export default router;
