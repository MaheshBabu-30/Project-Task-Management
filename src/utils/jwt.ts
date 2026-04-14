import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

// ─── Token Payload Types ──────────────────────────────────────────────────────

export interface TokenPayload {
  userId: string;
  role: "superadmin" | "admin" | "developer";
  status: "active" | "inactive";
  orgId?: string; // Present for admin and developer, absent for superadmin
}

// ─── Access Token ─────────────────────────────────────────────────────────────

export const generateToken = (payload: TokenPayload): string => {
  return jwt.sign(payload, env.JWT_SECRET as string, {
    expiresIn: env.JWT_EXPIRES_IN as any,
  });
};

export const verifyToken = (token: string): TokenPayload => {
  return jwt.verify(token, env.JWT_SECRET as string) as TokenPayload;
};

// ─── Refresh Token ────────────────────────────────────────────────────────────

export const generateRefreshToken = (payload: TokenPayload): string => {
  return jwt.sign(payload, env.REFRESH_TOKEN_SECRET as string, {
    expiresIn: env.REFRESH_TOKEN_EXPIRES_IN as any,
  });
};

export const verifyRefreshToken = (token: string): TokenPayload => {
  return jwt.verify(token, env.REFRESH_TOKEN_SECRET as string) as TokenPayload;
};
