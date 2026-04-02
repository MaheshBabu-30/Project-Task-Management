import { OAuth2Client } from "google-auth-library";


export const googleProvider = new OAuth2Client(
  (process.env.GOOGLE_CLIENT_ID as string) || "",
  (process.env.GOOGLE_CLIENT_SECRET as string) || "",
  (process.env.GOOGLE_REDIRECT_URI as string) || ""
);
