import { parse } from "valibot";
import type { Context } from "hono";
import { getPresignedUrlSchema } from "./upload.schema.js";
import { generatePresignedUploadUrl } from "./upload.service.js";
import { successResponse } from "../../utils/response.js";
import { ForbiddenException } from "../../exceptions/index.js";
import { NO_ORG_ASSIGNED } from "../../constants/appMessages.js";

export const getUploadUrl = async (c: Context) => {
  const user = c.get("user");
  const body = await c.req.json();
  const data = parse(getPresignedUrlSchema, body);

  if (!user.orgId && user.role !== "superadmin") {
    throw new ForbiddenException(NO_ORG_ASSIGNED);
  }

  const result = await generatePresignedUploadUrl({
    orgId: user.orgId || "global", // Superadmin uploads go to /global
    userId: user.userId,
    ...data,
  });

  return successResponse(c, result);
};
