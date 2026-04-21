import { S3Client } from "@aws-sdk/client-s3";
import { env } from "./env.js";

// Initialize the S3 client for Backblaze B2.
// Credentials are optional at startup — upload endpoints return a 500 if
// B2_BUCKET_NAME or credentials are absent when actually called.
export const s3Client = new S3Client({
  endpoint: env.B2_ENDPOINT,
  region: env.B2_REGION || "us-east-005",
  credentials: {
    accessKeyId: env.B2_ACCESS_KEY_ID ?? "",
    secretAccessKey: env.B2_SECRET_ACCESS_KEY ?? "",
  },
  forcePathStyle: true, // Required for some S3-compatible providers like B2
  requestChecksumCalculation: "WHEN_REQUIRED", // Disable auto CRC32 checksums — not supported by B2
});

export const B2_BUCKET_NAME = env.B2_BUCKET_NAME;
