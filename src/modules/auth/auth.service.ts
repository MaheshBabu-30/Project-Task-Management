import bcrypt from "bcrypt";
import { createHash, createHmac, randomInt } from "crypto";
import { db } from "../../config/db.js";
import { users, sessions, otps, orgMembers, organizations } from "../../db/schema/index.js";
import { eq, and, desc, isNull, sql, lt } from "drizzle-orm";
import { generateToken, generateRefreshToken, verifyRefreshToken } from "../../utils/jwt.js";
import {
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  InternalServerException,
} from "../../exceptions/index.js";
import { sendOtpEmail, sendPasswordResetEmail } from "../../utils/mail.service.js";
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
  INCORRECT_CURRENT_PASSWORD,
  SAME_PASSWORD,
  CHANGE_PASSWORD_SUCCESS,
  PASSWORD_RESET_OTP_SENT,
  RESET_PASSWORD_SUCCESS,
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

  // Prune expired sessions for this user on every login to prevent table bloat
  await db.delete(sessions).where(and(eq(sessions.userId, user.id), lt(sessions.expiresAt, new Date())));

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

  await db.insert(otps).values({ email, userId: user.id, otpHash, purpose: "login", expiresAt });

  const sent = await sendOtpEmail(email, otp);
  if (!sent) throw new InternalServerException(EMAIL_SEND_FAILED);

  return { message: OTP_SENT };
};

// ─── Verify OTP ───────────────────────────────────────────────────────────────

const MAX_OTP_ATTEMPTS = 5;

export const verifyOtp = async (email: string, otp: string) => {
  const [latestOtp] = await db
    .select()
    .from(otps)
    .where(and(eq(otps.email, email), eq(otps.purpose, "login")))
    .orderBy(desc(otps.createdAt))
    .limit(1);

  if (!latestOtp) throw new BadRequestException(OTP_NOT_FOUND);

  if (latestOtp.expiresAt < new Date()) {
    await db.delete(otps).where(eq(otps.id, latestOtp.id));
    throw new BadRequestException(OTP_EXPIRED);
  }

  // Increment attempt counter in DB before checking — survives server restarts
  const [updated] = await db
    .update(otps)
    .set({ attempts: sql`${otps.attempts} + 1` })
    .where(eq(otps.id, latestOtp.id))
    .returning({ attempts: otps.attempts });

  const attempts = updated?.attempts ?? MAX_OTP_ATTEMPTS + 1;

  if (attempts > MAX_OTP_ATTEMPTS) {
    await db.delete(otps).where(eq(otps.id, latestOtp.id));
    throw new BadRequestException(OTP_TOO_MANY_ATTEMPTS);
  }

  const otpSecret = env.OTP_SECRET;
  if (!otpSecret) throw new InternalServerException(OTP_SECRET_NOT_CONFIGURED);
  const incoming = createHmac("sha256", otpSecret).update(otp).digest("hex");
  const isValid = incoming === latestOtp.otpHash;

  if (!isValid) {
    throw new BadRequestException(OTP_INVALID);
  }

  const deleted = await db.delete(otps).where(eq(otps.id, latestOtp.id)).returning({ id: otps.id });
  if (deleted.length === 0) throw new BadRequestException(OTP_ALREADY_USED);

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

// ─── Change Password ──────────────────────────────────────────────────────────

export const changePassword = async (userId: string, currentPassword: string, newPassword: string) => {
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)));

  if (!user) throw new NotFoundException(USER_NOT_FOUND);
  if (!user.passwordHash) throw new BadRequestException("This account uses OTP login and has no password set");

  const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!isValid) throw new BadRequestException(INCORRECT_CURRENT_PASSWORD);

  const isSame = await bcrypt.compare(newPassword, user.passwordHash);
  if (isSame) throw new BadRequestException(SAME_PASSWORD);

  const newHash = await bcrypt.hash(newPassword, 10);

  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash: newHash, updatedAt: new Date() }).where(eq(users.id, userId));
    await tx.delete(sessions).where(eq(sessions.userId, userId));
  });

  return { message: CHANGE_PASSWORD_SUCCESS };
};

// ─── Forgot Password (send OTP) ───────────────────────────────────────────────

export const forgotPassword = async (email: string) => {
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.email, email), isNull(users.deletedAt)));

  if (!user) throw new NotFoundException(EMAIL_NOT_REGISTERED);
  if (user.status === "inactive") throw new ForbiddenException(ACCOUNT_DEACTIVATED);

  const otp = randomInt(100000, 1000000).toString();
  const otpSecret = env.OTP_SECRET;
  if (!otpSecret) throw new InternalServerException(OTP_SECRET_NOT_CONFIGURED);
  const otpHash = createHmac("sha256", otpSecret).update(otp).digest("hex");

  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + 5);

  await db.insert(otps).values({ email, userId: user.id, otpHash, purpose: "reset", expiresAt });

  const sent = await sendPasswordResetEmail(email, otp);
  if (!sent) throw new InternalServerException(EMAIL_SEND_FAILED);

  return { message: PASSWORD_RESET_OTP_SENT };
};

// ─── Reset Password (verify OTP + set new password) ───────────────────────────

export const resetPassword = async (email: string, otp: string, newPassword: string) => {
  const [latestOtp] = await db
    .select()
    .from(otps)
    .where(and(eq(otps.email, email), eq(otps.purpose, "reset")))
    .orderBy(desc(otps.createdAt))
    .limit(1);

  if (!latestOtp) throw new BadRequestException(OTP_NOT_FOUND);

  if (latestOtp.expiresAt < new Date()) {
    await db.delete(otps).where(eq(otps.id, latestOtp.id));
    throw new BadRequestException(OTP_EXPIRED);
  }

  const [updated] = await db
    .update(otps)
    .set({ attempts: sql`${otps.attempts} + 1` })
    .where(eq(otps.id, latestOtp.id))
    .returning({ attempts: otps.attempts });

  const attempts = updated?.attempts ?? MAX_OTP_ATTEMPTS + 1;

  if (attempts > MAX_OTP_ATTEMPTS) {
    await db.delete(otps).where(eq(otps.id, latestOtp.id));
    throw new BadRequestException(OTP_TOO_MANY_ATTEMPTS);
  }

  const otpSecret = env.OTP_SECRET;
  if (!otpSecret) throw new InternalServerException(OTP_SECRET_NOT_CONFIGURED);
  const incoming = createHmac("sha256", otpSecret).update(otp).digest("hex");
  if (incoming !== latestOtp.otpHash) throw new BadRequestException(OTP_INVALID);

  const deleted = await db.delete(otps).where(eq(otps.id, latestOtp.id)).returning({ id: otps.id });
  if (deleted.length === 0) throw new BadRequestException(OTP_ALREADY_USED);

  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.email, email), isNull(users.deletedAt)));

  if (!user) throw new NotFoundException(USER_ACCOUNT_NOT_FOUND);
  if (user.status === "inactive") throw new ForbiddenException(ACCOUNT_DEACTIVATED);

  const newHash = await bcrypt.hash(newPassword, 10);

  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash: newHash, updatedAt: new Date() }).where(eq(users.id, user.id));
    await tx.delete(sessions).where(eq(sessions.userId, user.id));
  });

  return { message: RESET_PASSWORD_SUCCESS };
};

// ─── Logout ───────────────────────────────────────────────────────────────────

export const logoutUser = async (userId: string, refreshToken: string) => {
  const tokenHash = createHash("sha256").update(refreshToken).digest("hex");
  await db.delete(sessions).where(
    and(eq(sessions.userId, userId), eq(sessions.refreshToken, tokenHash))
  );
};
