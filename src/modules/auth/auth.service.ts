import bcrypt from "bcrypt";
import { createHash, createHmac, randomInt } from "crypto";
import { db } from "../../config/db.js";
import { users, sessions, otps, orgMembers, organizations } from "../../db/schema.js";
import { eq, and, desc, isNull } from "drizzle-orm";
import { generateToken, generateRefreshToken, verifyRefreshToken } from "../../utils/jwt.js";
import {
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  InternalServerException,
} from "../../exceptions/index.js";
import { sendOtpEmail } from "../../utils/mail.service.js";
import { env } from "../../config/env.js";
import {
  INVALID_CREDENTIALS,
  ACCOUNT_INACTIVE,
  ACCOUNT_DEACTIVATED,
  ACCOUNT_DEACTIVATED_SHORT,
  OTP_LOGIN_REQUIRED,
  INVALID_REFRESH_TOKEN,
  USER_NOT_FOUND,
  EMAIL_NOT_REGISTERED,
  OTP_SECRET_NOT_CONFIGURED,
  EMAIL_SEND_FAILED,
  OTP_SENT,
  OTP_NOT_FOUND,
  OTP_EXPIRED,
  OTP_TOO_MANY_ATTEMPTS,
  OTP_INVALID,
  OTP_ALREADY_USED,
  USER_ACCOUNT_NOT_FOUND,
} from "../../constants/appMessages.js";

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

  // orgName is intentionally excluded from the JWT — it can change and tokens
  // are long-lived, so stale names in tokens cause subtle bugs.
  const tokenPayload = { userId: user.id, role: user.role, status: user.status, ...(orgId ? { orgId } : {}) };
  return { tokenPayload, orgName };
};

// ─── Session Management ───────────────────────────────────────────────────────

export const createSession = async (userId: string, refreshToken: string) => {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  const tokenHash = createHash("sha256").update(refreshToken).digest("hex");
  await db.insert(sessions).values({ userId, refreshToken: tokenHash, expiresAt });
};

// ─── Login with Password ──────────────────────────────────────────────────────

export const loginUser = async ({ email, password }: { email: string; password: string }) => {
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.email, email), isNull(users.deletedAt)));

  if (!user) throw new UnauthorizedException(INVALID_CREDENTIALS);
  if (user.status === "inactive") throw new ForbiddenException(ACCOUNT_INACTIVE);
  if (!user.passwordHash) throw new UnauthorizedException(OTP_LOGIN_REQUIRED);

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) throw new UnauthorizedException(INVALID_CREDENTIALS);

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

  const { tokenPayload, orgName } = await buildTokenPayload(user);
  const accessToken = generateToken(tokenPayload);
  const refreshToken = generateRefreshToken(tokenPayload);
  await createSession(user.id, refreshToken);

  return {
    user: { id: user.id, name: user.name, email: user.email, role: user.role, orgId: tokenPayload.orgId, orgName },
    tokens: { accessToken, refreshToken },
  };
};

// ─── Refresh Session ──────────────────────────────────────────────────────────

export const refreshSession = async (token: string) => {
  let payload;
  try {
    payload = verifyRefreshToken(token);
  } catch {
    throw new UnauthorizedException(INVALID_REFRESH_TOKEN);
  }

  const tokenHash = createHash("sha256").update(token).digest("hex");

  const [session] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.refreshToken, tokenHash), eq(sessions.userId, payload.userId)));

  if (!session || session.expiresAt < new Date()) {
    if (session) await db.delete(sessions).where(eq(sessions.id, session.id));
    throw new UnauthorizedException(INVALID_REFRESH_TOKEN);
  }

  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, payload.userId), isNull(users.deletedAt)));

  if (!user) throw new NotFoundException(USER_NOT_FOUND);
  if (user.status === "inactive") throw new ForbiddenException(ACCOUNT_DEACTIVATED_SHORT);

  const { tokenPayload: newPayload } = await buildTokenPayload(user);
  const accessToken = generateToken(newPayload);
  const newRefreshToken = generateRefreshToken(newPayload);

  const newTokenHash = createHash("sha256").update(newRefreshToken).digest("hex");
  await db.update(sessions).set({ refreshToken: newTokenHash }).where(eq(sessions.id, session.id));

  return { tokens: { accessToken, refreshToken: newRefreshToken } };
};

// ─── Request OTP ──────────────────────────────────────────────────────────────

export const requestOtp = async (email: string) => {
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.email, email), isNull(users.deletedAt)));

  if (!user) throw new NotFoundException(EMAIL_NOT_REGISTERED);

  const otp = randomInt(100000, 1000000).toString();

  const otpSecret = env.OTP_SECRET;
  if (!otpSecret) throw new InternalServerException(OTP_SECRET_NOT_CONFIGURED);
  const otpHash = createHmac("sha256", otpSecret).update(otp).digest("hex");

  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + 5);

  await db.insert(otps).values({ email, userId: user.id, otpHash, expiresAt });

  const sent = await sendOtpEmail(email, otp);
  if (!sent) throw new InternalServerException(EMAIL_SEND_FAILED);

  return { message: OTP_SENT };
};

// ─── OTP Attempt Tracking (in-memory) ────────────────────────────────────────
// Tracks failed attempts per OTP record ID. Cleared when the OTP is consumed or invalidated.

const otpAttempts = new Map<string, number>();
const MAX_OTP_ATTEMPTS = 5;

// ─── Verify OTP ───────────────────────────────────────────────────────────────

export const verifyOtp = async (email: string, otp: string) => {
  const [latestOtp] = await db
    .select()
    .from(otps)
    .where(eq(otps.email, email))
    .orderBy(desc(otps.createdAt))
    .limit(1);

  if (!latestOtp) throw new BadRequestException(OTP_NOT_FOUND);

  if (latestOtp.expiresAt < new Date()) {
    await db.delete(otps).where(eq(otps.id, latestOtp.id));
    otpAttempts.delete(latestOtp.id);
    throw new BadRequestException(OTP_EXPIRED);
  }

  const attempts = (otpAttempts.get(latestOtp.id) ?? 0) + 1;
  if (attempts > MAX_OTP_ATTEMPTS) {
    await db.delete(otps).where(eq(otps.id, latestOtp.id));
    otpAttempts.delete(latestOtp.id);
    throw new BadRequestException(OTP_TOO_MANY_ATTEMPTS);
  }

  const otpSecret = env.OTP_SECRET;
  if (!otpSecret) throw new InternalServerException(OTP_SECRET_NOT_CONFIGURED);
  const incoming = createHmac("sha256", otpSecret).update(otp).digest("hex");
  const isValid = incoming === latestOtp.otpHash;

  if (!isValid) {
    otpAttempts.set(latestOtp.id, attempts);
    throw new BadRequestException(OTP_INVALID);
  }

  const deleted = await db.delete(otps).where(eq(otps.id, latestOtp.id)).returning({ id: otps.id });
  if (deleted.length === 0) throw new BadRequestException(OTP_ALREADY_USED);
  otpAttempts.delete(latestOtp.id);

  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.email, email), isNull(users.deletedAt)));

  if (!user) throw new NotFoundException(USER_ACCOUNT_NOT_FOUND);
  if (user.status === "inactive") throw new ForbiddenException(ACCOUNT_DEACTIVATED);

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

  const { tokenPayload, orgName } = await buildTokenPayload(user);
  const accessToken = generateToken(tokenPayload);
  const refreshToken = generateRefreshToken(tokenPayload);
  await createSession(user.id, refreshToken);

  return {
    user: { id: user.id, name: user.name, email: user.email, role: user.role, orgId: tokenPayload.orgId, orgName },
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
