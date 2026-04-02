import type { Context } from "hono";
import { setCookie, getCookie } from "hono/cookie";
import { googleProvider } from "./oauth.js";
import { env } from "../config/env.js";
import { AppError } from "../utils/errors.js";
import { findOrCreateOAuthUser } from "./auth.service.oauth.js";
import { successResponse } from "../utils/response.js";
import { generateState, generateCodeVerifier, generateCodeChallenge } from "./oauth_helpers.js";

export const googleAuth = async (c: Context) => {
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  const url = googleProvider.generateAuthUrl({
    access_type: 'offline',
    scope: ['profile', 'email'],
    state: state,
    prompt: 'select_account',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256' as any,
  });

  const cookieOptions = { 
    path: "/", 
    secure: process.env.NODE_ENV === "production", 
    httpOnly: true, 
    maxAge: 60 * 10,
    sameSite: "Lax" as const
  };

  setCookie(c, "google_oauth_state", state, cookieOptions);
  setCookie(c, "google_oauth_code_verifier", codeVerifier, cookieOptions);

  return c.redirect(url);
};

export const googleCallback = async (c: Context) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const storedState = getCookie(c, "google_oauth_state");
  const storedCodeVerifier = getCookie(c, "google_oauth_code_verifier");

  if (!code || !state || !storedState || !storedCodeVerifier || state !== storedState) {
    throw new AppError("Invalid OAuth state or code", 400);
  }

  // Exchange code for tokens using official SDK
  const { tokens } = await googleProvider.getToken({
    code,
    codeVerifier: storedCodeVerifier,
  });

  googleProvider.setCredentials(tokens);

  // Verify ID Token to extract user info securely
  const ticket = await googleProvider.verifyIdToken({
    idToken: tokens.id_token as string,
    audience: process.env.GOOGLE_CLIENT_ID as string,
  });

  const payload = ticket.getPayload();
  if (!payload || !payload.email || !payload.sub) {
    throw new AppError("Failed to extract user info from Google", 500);
  }

  const result = await findOrCreateOAuthUser({
    email: payload.email,
    name: payload.name || "Google User",
    provider: "GOOGLE",
    providerId: payload.sub
  });

  return successResponse(c, result);
};
