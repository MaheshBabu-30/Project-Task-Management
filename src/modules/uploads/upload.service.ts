import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3Client, B2_BUCKET_NAME } from "../../config/s3.js";
import { AppError } from "../../utils/errors.js";

/**
 * Generates a pre-signed URL for a client to upload a file directly to Backblaze B2.
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

  // Sanitize filename and create a unique key
  const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, "_");
  const timestamp = Date.now();
  
  // Format: org_id/folder/timestamp-userId-filename
  const key = `${orgId}/${folder}/${timestamp}-${userId}-${sanitizedFileName}`;

  try {
    const command = new PutObjectCommand({
      Bucket: B2_BUCKET_NAME,
      Key: key,
      ContentType: contentType,
    });

    // Valid for 10 minutes
    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 600 });

    // The final public URL (assuming the bucket is public or reachable via a B2 download URL/CDN)
    // For B2, the download URL format is usually: 
    // https://f000.backblazeb2.com/file/bucket-name/key
    const publicUrl = `${process.env.B2_DOWNLOAD_URL || ""}/file/${B2_BUCKET_NAME}/${key}`;

    return {
      presignedUrl,
      publicUrl,
      key,
    };
  } catch (error) {
    console.error("S3 Presigned URL error:", error);
    throw new AppError("Failed to generate upload URL", 500);
  }
};
