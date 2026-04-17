import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3Client, B2_BUCKET_NAME } from "../../config/s3.js";
import { AppError } from "../../exceptions/AppError.js";

/**
 * Generates a pre-signed URL for a client to upload a file directly to Backblaze B2.
 * Returns the upload URL and the s3Key — client must save the key and register
 * it via POST /api/tasks/:id/attachments after upload completes.
 */
export const generatePresignedUploadUrl = async (params: {
  orgId: string;
  userId: string;
  fileName: string;
  contentType: string;
  folder?: string;
}) => {
  const { orgId, userId, fileName, contentType, folder = "attachments" } = params;

  if (!B2_BUCKET_NAME) {
    throw new AppError("B2_BUCKET_NAME is not configured", 500);
  }

  const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, "_");
  const timestamp = Date.now();
  const key = `${orgId}/${folder}/${timestamp}-${userId}-${sanitizedFileName}`;

  try {
    const command = new PutObjectCommand({
      Bucket: B2_BUCKET_NAME,
      Key: key,
      ContentType: contentType,
    });

    // Upload URL valid for 10 minutes
    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 600 });

    return { presignedUrl, key };
  } catch (error) {
    console.error("S3 Presigned upload URL error:", error);
    throw new AppError("Failed to generate upload URL", 500);
  }
};

/**
 * Generates a pre-signed download URL for a private bucket object.
 * Valid for 1 hour — frontend uses this to let the user view or download the file.
 */
export const generatePresignedDownloadUrl = async (s3Key: string) => {
  if (!B2_BUCKET_NAME) {
    throw new AppError("B2_BUCKET_NAME is not configured", 500);
  }

  try {
    const command = new GetObjectCommand({
      Bucket: B2_BUCKET_NAME,
      Key: s3Key,
    });

    // Download URL valid for 1 hour
    const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

    return { url, expiresIn: 3600 };
  } catch (error) {
    console.error("S3 Presigned download URL error:", error);
    throw new AppError("Failed to generate download URL", 500);
  }
};
