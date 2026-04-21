import { Hono } from "hono";
import { getUploadUrl, getDownloadUrl } from "./upload.controller.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import type { AppEnv } from "../../types/hono.types.js";

const router = new Hono<AppEnv>();

router.use(authMiddleware);

// Request a presigned URL for direct upload to B2
router.post("/presigned-url", getUploadUrl);

// Request a presigned download URL for a private B2 file
router.get("/download-url", getDownloadUrl);

export default router;
