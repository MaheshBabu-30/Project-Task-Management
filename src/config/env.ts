import dotenv from "dotenv";

dotenv.config();

// ─── Validate required env vars at startup ────────────────────────────────────
const required = ["DATABASE_URL", "JWT_SECRET", "REFRESH_TOKEN_SECRET", "OTP_SECRET"] as const;

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

export const env = {
  PORT:                       process.env.PORT || 3000,
  DATABASE_URL:               process.env.DATABASE_URL as string,
  JWT_SECRET:                 process.env.JWT_SECRET as string,
  JWT_EXPIRES_IN:             process.env.JWT_EXPIRES_IN || "1h",
  REFRESH_TOKEN_SECRET:       process.env.REFRESH_TOKEN_SECRET as string,
  REFRESH_TOKEN_EXPIRES_IN:   process.env.REFRESH_TOKEN_EXPIRES_IN || "7d",
  BREVO_API_KEY:              process.env.BREVO_API_KEY,
  BREVO_SENDER_EMAIL:         process.env.BREVO_SENDER_EMAIL,
  ALLOWED_ORIGINS:            process.env.ALLOWED_ORIGINS || "*",
  OTP_SECRET:                 process.env.OTP_SECRET as string,
  B2_ENDPOINT:                    process.env.B2_ENDPOINT,
  B2_REGION:                      process.env.B2_REGION,
  B2_ACCESS_KEY_ID:               process.env.B2_ACCESS_KEY_ID,
  B2_SECRET_ACCESS_KEY:           process.env.B2_SECRET_ACCESS_KEY,
  B2_BUCKET_NAME:                 process.env.B2_BUCKET_NAME,
  QSTASH_TOKEN:                   process.env.QSTASH_TOKEN,
  QSTASH_CURRENT_SIGNING_KEY:     process.env.QSTASH_CURRENT_SIGNING_KEY,
  QSTASH_NEXT_SIGNING_KEY:        process.env.QSTASH_NEXT_SIGNING_KEY,
  APP_BASE_URL:                   process.env.APP_BASE_URL,
};
