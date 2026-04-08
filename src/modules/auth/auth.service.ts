import bcrypt from "bcrypt";
import { db } from "../../config/db.js";
import { users, sessions, otps, orgMembers } from "../../../drizzle/schema.js";
import { eq, and, desc, isNull } from "drizzle-orm";
import { generateToken, generateRefreshToken, verifyRefreshToken } from "../../utils/jwt.js";
import { AppError } from "../../utils/errors.js";
import { sendOtpEmail } from "../../utils/mail.service.js";

// ─── Helper: Build Token Payload with orgId ───────────────────────────────────

const buildTokenPayload = async (user: { id: string; role: "superadmin" | "admin" | "developer" }) => {
  let orgId: string | undefined;

  // Superadmin has no org, admin and developer are scoped to one
  if (user.role !== "superadmin") {
    const [membership] = await db
      .select({ orgId: orgMembers.orgId })
      .from(orgMembers)
      .where(eq(orgMembers.userId, user.id))
      .limit(1);

    orgId = membership?.orgId;
  }

  return { userId: user.id, role: user.role, ...(orgId ? { orgId } : {}) };
};

// ─── Session Management ───────────────────────────────────────────────────────

export const createSession = async (userId: string, refreshToken: string) => {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

  await db.insert(sessions).values({ userId, refreshToken, expiresAt });
};

// ─── Register User ────────────────────────────────────────────────────────────

export const registerUser = async ({
  name,
  email,
  password,
  role,
}: {
  name: string;
  email: string;
  password: string;
  role: "superadmin" | "admin" | "developer";
}) => {
  const [existing] = await db.select().from(users).where(eq(users.email, email));
  if (existing) throw new AppError("Email already exists", 409);

  const passwordHash = await bcrypt.hash(password, 10);

  const [newUser] = await db
    .insert(users)
    .values({ name, email, passwordHash, role })
    .returning({ id: users.id, name: users.name, email: users.email, role: users.role });

  if (!newUser) throw new AppError("Failed to create user", 500);

  const payload = await buildTokenPayload(newUser);
  const accessToken = generateToken(payload);
  const refreshToken = generateRefreshToken(payload);
  await createSession(newUser.id, refreshToken);

  return { user: newUser, tokens: { accessToken, refreshToken } };
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

  // Update last login
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

  const payload = await buildTokenPayload(user);
  const accessToken = generateToken(payload);
  const refreshToken = generateRefreshToken(payload);
  await createSession(user.id, refreshToken);

  return {
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    tokens: { accessToken, refreshToken },
  };
};

// ─── Refresh Session ──────────────────────────────────────────────────────────

export const refreshSession = async (token: string) => {
  try {
    const payload = verifyRefreshToken(token);

    const [session] = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.refreshToken, token), eq(sessions.userId, payload.userId)));

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

    const newPayload = await buildTokenPayload(user);
    const accessToken = generateToken(newPayload);
    const newRefreshToken = generateRefreshToken(newPayload);

    // Rotate token
    await db.delete(sessions).where(eq(sessions.id, session.id));
    await createSession(user.id, newRefreshToken);

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

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const otpHash = await bcrypt.hash(otp, 10);
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

  const isValid = await bcrypt.compare(otp, latestOtp.otpHash);
  if (!isValid) throw new AppError("Invalid verification code", 400);

  await db.delete(otps).where(eq(otps.email, email));

  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.email, email), isNull(users.deletedAt)));

  if (!user) throw new AppError("User account not found", 404);
  if (user.status === "inactive") throw new AppError("Your account is deactivated. Please contact admin.", 403);

  // Update last login
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

  const payload = await buildTokenPayload(user);
  const accessToken = generateToken(payload);
  const refreshToken = generateRefreshToken(payload);
  await createSession(user.id, refreshToken);

  return {
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    tokens: { accessToken, refreshToken },
  };
};

// ─── Logout ───────────────────────────────────────────────────────────────────

export const logoutUser = async (userId: string, refreshToken: string) => {
  await db.delete(sessions).where(
    and(eq(sessions.userId, userId), eq(sessions.refreshToken, refreshToken))
  );
};
