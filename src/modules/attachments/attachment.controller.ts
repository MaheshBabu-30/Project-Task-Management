import { parse } from "valibot";
import type { AppContext } from "../../types/hono.types.js";
import { createAttachmentSchema, attachmentQuerySchema } from "./attachment.schema.js";
import { uuidSchema } from "../../helpers/validators.js";
import { getAttachments, linkAttachment, removeAttachment, getAttachmentById } from "./attachment.service.js";
import { generatePresignedDownloadUrl } from "../uploads/upload.service.js";
import { successResponse } from "../../utils/response.js";
import { buildPagination } from "../../helpers/pagination.js";

export const listAttachments = async (c: AppContext) => {
  const user = c.get("user");
  const taskId = parse(uuidSchema("Task ID"), c.req.param("taskId"));
  const rawQuery = c.req.query();

  const query = parse(attachmentQuerySchema, {
    ...rawQuery,
    page: rawQuery.page ? Number(rawQuery.page) : undefined,
    limit: rawQuery.limit ? Number(rawQuery.limit) : undefined,
  });

  const { data, totalRecords } = await getAttachments(taskId, user, query);

  const pagination = buildPagination({
    page: query.page ?? 1,
    limit: query.limit ?? 20,
    totalRecords,
  });

  return successResponse(c, { attachments: data, pagination });
};

export const addAttachment = async (c: AppContext) => {
  const user = c.get("user");
  const taskId = parse(uuidSchema("Task ID"), c.req.param("taskId"));
  const body = await c.req.json();
  const data = parse(createAttachmentSchema, body);

  const attachment = await linkAttachment(taskId, data, user);
  return successResponse(c, attachment, 201);
};

export const deleteAttachment = async (c: AppContext) => {
  const user = c.get("user");
  const attachmentId = parse(uuidSchema("Attachment ID"), c.req.param("attachmentId"));

  const result = await removeAttachment(attachmentId, user);
  return successResponse(c, result);
};

export const getAttachmentDownloadUrl = async (c: AppContext) => {
  const user = c.get("user");
  const taskId = parse(uuidSchema("Task ID"), c.req.param("taskId"));
  const attachmentId = parse(uuidSchema("Attachment ID"), c.req.param("attachmentId"));

  const attachment = await getAttachmentById(attachmentId, taskId, user);
  const result = await generatePresignedDownloadUrl(attachment.s3Key);

  return successResponse(c, result);
};
