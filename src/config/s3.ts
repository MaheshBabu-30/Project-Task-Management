import { S3Client } from "@aws-sdk/client-s3";
import "dotenv/config";

const {
  B2_ENDPOINT,
  B2_REGION,
  B2_ACCESS_KEY_ID,
  B2_SECRET_ACCESS_KEY,
} = process.env;

// Initialize the S3 client for Backblaze B2
export const s3Client = new S3Client({
  endpoint: B2_ENDPOINT, // e.g., https://s3.us-east-005.backblazeb2.com
  region: B2_REGION || "us-east-005",
  credentials: {
    accessKeyId: B2_ACCESS_KEY_ID as string,
    secretAccessKey: B2_SECRET_ACCESS_KEY as string,
  },
  forcePathStyle: true, // Required for some S3-compatible providers like B2
});

export const B2_BUCKET_NAME = process.env.B2_BUCKET_NAME;
