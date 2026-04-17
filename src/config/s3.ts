import { S3Client } from "@aws-sdk/client-s3";
import { env } from "./env.js";

if (!env.B2_ENDPOINT || !env.B2_ACCESS_KEY_ID || !env.B2_SECRET_ACCESS_KEY) {
  throw new Error("Missing required B2/S3 environment variables: B2_ENDPOINT, B2_ACCESS_KEY_ID, B2_SECRET_ACCESS_KEY");
}

// Initialize the S3 client for Backblaze B2
export const s3Client = new S3Client({
  endpoint: env.B2_ENDPOINT,
  region: env.B2_REGION || "us-east-005",
  credentials: {
    accessKeyId: env.B2_ACCESS_KEY_ID,
    secretAccessKey: env.B2_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true, // Required for some S3-compatible providers like B2
});

export const B2_BUCKET_NAME = env.B2_BUCKET_NAME;
