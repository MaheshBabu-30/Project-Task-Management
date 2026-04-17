import bcrypt from "bcrypt";
import { createHash, createHmac, randomInt } from "crypto";
import { db } from "../../config/db.js";
import { users, sessions, otps, orgMembers, organizations } from "../../../drizzle/schema.js";
import { eq, and, desc, isNull } from "drizzle-orm";
import { generateToken, generateRefreshToken, verifyRefreshToken } from "../../utils/jwt.js";
import { AppError } from "../../exceptions/AppError.js";
import { sendOtpEmail } from "../../utils/mail.service.js";
import { env } from "../../config/env.js";

// ─── Helper: Build Token Payload with orgId ───────────────────────────────────

const buildTokenPayload = async (user: { id: string; role: "superadmin" | "admin" | "developer"; status: "active" | "inactive" }) => {
  let orgId: string | undefined;
  let orgName: string | undefined;

  if (user.role !== "superadmin") {
    const [membership] = await db
      .select({ orgId: orgMembers.orgId, orgName: organizations.name })
      .from(orgMembers)
      .innerJoin(organizations, eq(orgMembers.orgId, organizations.id))
      .where(and(eq(orgMembers.userId, user.id), isNull(organizations.deletedAt)))
      .limit(1);

    orgId = membership?.orgId;
    orgName = membership?.orgName;
  }

  return { userId: user.id, role: user.role, status: user.status, ...(orgId ? { orgId } : {}), ...(orgName ? { orgName } : {}) };
};

// ─── Session Management ───────────────────────────────────────────────────────

export const createSession = async (userId: string, refreshToken: string) => {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  // Store hash of refresh token, not plain text
  const tokenHash = createHash("sha256").update(refreshToken).digest("hex");
  await db.insert(sessions).values({ userId, refreshToken: tokenHash, expiresAt });
};

// ─── Login with Password ──────────────────────────────────────────────────────

export const loginUser = async ({ email, password }: { email: string; password: string }) => {
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.email, email), isNull(users.deletedAt)));

  if (!user) throw new AppError("Invalid credentials", 401);
  if (user.status === "inactive") throw new AppError("Your account is inactive. Please contact admin.", 403);
  if (!user.passwordHash) throw new AppError("This account uses OTP login. Please request a code.", 401);

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) throw new AppError("Invalid credentials", 401);

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

  const payload = await buildTokenPayload(user);
  const accessToken = generateToken(payload);
  const refreshToken = generateRefreshToken(payload);
  await createSession(user.id, refreshToken);

  return {
    user: { id: user.id, name: user.name, email: user.email, role: user.role, orgId: payload.orgId, orgName: payload.orgName },
    tokens: { accessToken, refreshToken },
  };
};

// ─── Refresh Session ──────────────────────────────────────────────────────────

export const refreshSession = async (token: string) => {
  try {
    const payload = verifyRefreshToken(token);

    // Hash incoming token to match stored hash
    const tokenHash = createHash("sha256").update(token).digest("hex");

    const [session] = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.refreshToken, tokenHash), eq(sessions.userId, payload.userId)));

    if (!session || session.expiresAt < new Date()) {
      if (session) await db.delete(sessions).where(eq(sessions.id, session.id));
      throw new AppError("Invalid or expired refresh token", 401);
    }

    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, payload.userId), isNull(users.deletedAt)));

    if (!user) throw new AppError("User not found", 404);
    if (user.status === "inactive") throw new AppError("Your account is deactivated.", 403);

    // Rotate refresh token — issue a new one and replace the stored hash
    const newPayload = await buildTokenPayload(user);
    const accessToken = generateToken(newPayload);
    const newRefreshToken = generateRefreshToken(newPayload);

    const newTokenHash = createHash("sha256").update(newRefreshToken).digest("hex");
    await db.update(sessions).set({ refreshToken: newTokenHash }).where(eq(sessions.id, session.id));

    return { tokens: { accessToken, refreshToken: newRefreshToken } };
  } catch (error) {
    throw new AppError(error instanceof AppError ? error.message : "Invalid or expired refresh token", 401);
  }
};

// ─── Request OTP ──────────────────────────────────────────────────────────────

export const requestOtp = async (email: string) => {
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.email, email), isNull(users.deletedAt)));

  if (!user) throw new AppError("This email is not registered.", 404);

  // Cryptographically secure 6-digit OTP
  const otp = randomInt(100000, 1000000).toString();

  // HMAC-SHA256 hash — fast, correct tool for short-lived codes
  const otpSecret = env.OTP_SECRET;
  if (!otpSecret) throw new AppError("OTP_SECRET is not configured", 500);
  const otpHash = createHmac("sha256", otpSecret).update(otp).digest("hex");

  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + 5);

  await db.insert(otps).values({ email, otpHash, expiresAt });

  const sent = await sendOtpEmail(email, otp);
  if (!sent) throw new AppError("Failed to send verification email", 500);

  return { message: "Verification code sent to your email" };
};

// ─── Verify OTP ───────────────────────────────────────────────────────────────

export const verifyOtp = async (email: string, otp: string) => {
  const [latestOtp] = await db
    .select()
    .from(otps)
    .where(eq(otps.email, email))
    .orderBy(desc(otps.createdAt))
    .limit(1);

  if (!latestOtp) throw new AppError("No verification code found. Please request a new one.", 400);

  if (latestOtp.expiresAt < new Date()) {
    await db.delete(otps).where(eq(otps.id, latestOtp.id));
    throw new AppError("Verification code has expired. Please request a new one.", 400);
  }

  // Recompute HMAC and compare
  const otpSecret = env.OTP_SECRET;
  if (!otpSecret) throw new AppError("OTP_SECRET is not configured", 500);
  const incoming = createHmac("sha256", otpSecret).update(otp).digest("hex");
  const isValid = incoming === latestOtp.otpHash;

  if (!isValid) throw new AppError("Invalid verification code", 400);

  // Atomic delete by specific ID — prevents concurrent requests from consuming the same OTP
  const deleted = await db.delete(otps).where(eq(otps.id, latestOtp.id)).returning({ id: otps.id });
  if (deleted.length === 0) throw new AppError("Verification code already used. Please request a new one.", 400);

  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.email, email), isNull(users.deletedAt)));

  if (!user) throw new AppError("User account not found", 404);
  if (user.status === "inactive") throw new AppError("Your account is deactivated. Please contact admin.", 403);

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

  const payload = await buildTokenPayload(user);
  const accessToken = generateToken(payload);
  const refreshToken = generateRefreshToken(payload);
  await createSession(user.id, refreshToken);

  return {
    user: { id: user.id, name: user.name, email: user.email, role: user.role, orgId: payload.orgId, orgName: payload.orgName },
    tokens: { accessToken, refreshToken },
  };
};

// ─── Logout ───────────────────────────────────────────────────────────────────

export const logoutUser = async (userId: string, refreshToken: string) => {
  const tokenHash = createHash("sha256").update(refreshToken).digest("hex");
  await db.delete(sessions).where(
    and(eq(sessions.userId, userId), eq(sessions.refreshToken, tokenHash))
  );
};
