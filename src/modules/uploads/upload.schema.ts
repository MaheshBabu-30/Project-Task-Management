import { object, string, picklist, pipe, minLength, optional } from "valibot";

export const getPresignedUrlSchema = object({
  fileName: pipe(string(), minLength(1, "fileName is required")),
  contentType: pipe(string(), minLength(1, "contentType is required")),
  folder: optional(picklist(["avatars", "logos", "attachments"])),
});
