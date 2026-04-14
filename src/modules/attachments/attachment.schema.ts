import { object, string, number, pipe, minLength, maxLength, minValue, maxValue } from "valibot";

export const createAttachmentSchema = object({
  s3Key: pipe(string(), minLength(1, "S3 key is required"), maxLength(500, "S3 key too long")),
  fileName: pipe(string(), minLength(1, "File name is required"), maxLength(255, "File name too long")),
  mimeType: pipe(string(), minLength(1, "MIME type is required"), maxLength(100, "MIME type too long")),
  fileSize: pipe(number(), minValue(1, "File size must be > 0"), maxValue(10_485_760, "File size must not exceed 10MB")),
});
