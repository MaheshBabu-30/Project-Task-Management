import { object, string, picklist, pipe, minLength, maxLength, check, regex } from "valibot";

const IMAGE_MIME_TYPES = [
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml",
] as const;

const ALL_ALLOWED_MIME_TYPES = [
  ...IMAGE_MIME_TYPES,
  "application/pdf",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain", "text/csv",
  "application/zip", "application/x-zip-compressed",
] as const;

export const getPresignedUrlSchema = pipe(
  object({
    fileName: pipe(string(), minLength(1, "fileName is required"), maxLength(255, "fileName must be at most 255 characters")),
    contentType: picklist(ALL_ALLOWED_MIME_TYPES, "Unsupported content type"),
    folder: picklist(["avatars", "logos", "attachments"], "folder must be avatars, logos, or attachments"),
  }),
  check(
    (val) => {
      if (val.folder === "avatars" || val.folder === "logos") {
        return (IMAGE_MIME_TYPES as readonly string[]).includes(val.contentType);
      }
      return true;
    },
    "Only image files (jpeg, png, gif, webp, svg) are allowed for avatars and logos"
  )
);

// S3 keys look like: orgId/folder/timestamp-userId-filename
const S3_KEY_PATTERN = /^[a-zA-Z0-9_\-/.]+$/;

export const getDownloadUrlSchema = object({
  key: pipe(
    string(),
    minLength(1, "key is required"),
    maxLength(500, "key too long"),
    regex(S3_KEY_PATTERN, "Invalid key format")
  ),
});
