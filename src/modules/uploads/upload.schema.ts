import { object, string, picklist, pipe, minLength, maxLength, optional } from "valibot";

const ALLOWED_UPLOAD_MIME_TYPES = [
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml",
  "application/pdf",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain", "text/csv",
  "application/zip", "application/x-zip-compressed",
] as const;

export const getPresignedUrlSchema = object({
  fileName: pipe(string(), minLength(1, "fileName is required"), maxLength(255, "fileName must be at most 255 characters")),
  contentType: picklist(ALLOWED_UPLOAD_MIME_TYPES, "Unsupported content type"),
  folder: optional(picklist(["avatars", "logos", "attachments"])),
});
