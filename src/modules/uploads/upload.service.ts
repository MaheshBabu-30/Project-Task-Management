import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3Client, B2_BUCKET_NAME } from "../../config/s3.js";
import { InternalServerException } from "../../exceptions/index.js";
import { BUCKET_NOT_CONFIGURED, UPLOAD_URL_FAILED, DOWNLOAD_URL_FAILED } from "../../constants/appMessages.js";

export const generatePresignedUploadUrl = async (params: {
  orgId: string;
  userId: string;
  fileName: string;
  contentType: string;
  folder: string;
}) => {
  const { orgId, userId, fileName, folder } = params;

  if (!B2_BUCKET_NAME) throw new InternalServerException(BUCKET_NOT_CONFIGURED);

  const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const timestamp = Date.now();
  const key = `${orgId}/${folder}/${timestamp}-${userId}-${sanitizedFileName}`;

  try {
    const command = new PutObjectCommand({
      Bucket: B2_BUCKET_NAME,
      Key: key,
    });

    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 600 });
    return { presignedUrl, key };
  } catch (error) {
    console.error("S3 Presigned upload URL error:", error);
    throw new InternalServerException(UPLOAD_URL_FAILED);
  }
};

export const generatePresignedDownloadUrl = async (s3Key: string) => {
  if (!B2_BUCKET_NAME) throw new InternalServerException(BUCKET_NOT_CONFIGURED);

  try {
    const command = new GetObjectCommand({
      Bucket: B2_BUCKET_NAME,
      Key: s3Key,
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    return { url, expiresIn: 3600 };
  } catch (error) {
    console.error("S3 Presigned download URL error:", error);
    throw new InternalServerException(DOWNLOAD_URL_FAILED);
  }
};
