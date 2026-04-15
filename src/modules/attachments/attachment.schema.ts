import { object, string, number, pipe, minLength, maxLength, minValue, maxValue, regex, picklist } from "valibot";

const ALLOWED_MIME_TYPES = [
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml",
  "application/pdf",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain", "text/csv",
  "application/zip", "application/x-zip-compressed",
] as const;

export const createAttachmentSchema = object({
  s3Key: pipe(string(), minLength(1, "S3 key is required"), maxLength(500, "S3 key too long"), regex(/^[a-zA-Z0-9!_.*'()\-/]+$/, "S3 key contains invalid characters")),
  fileName: pipe(string(), minLength(1, "File name is required"), maxLength(255, "File name too long"), regex(/^[^<>:"/\\|?*\x00-\x1F]+$/, "File name contains invalid characters")),
  mimeType: picklist(ALLOWED_MIME_TYPES, "Unsupported file type"),
  fileSize: pipe(number(), minValue(1, "File size must be > 0"), maxValue(10_485_760, "File size must not exceed 10MB")),
});
