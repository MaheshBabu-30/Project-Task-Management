import bcrypt from "bcrypt";
import { db } from "../../config/db.js";
import { users, sessions, otps } from "../../../drizzle/schema.js";
import { eq, and, desc } from "drizzle-orm";
import { generateToken, generateRefreshToken, verifyRefreshToken } from "../../utils/jwt.js";
import { AppError } from "../../utils/errors.js";
import { sendOtpEmail } from "../../utils/mail.service.js";

export const createSession = async (userId: number, refreshToken: string) => {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

  await db.insert(sessions).values({
    userId,
    refreshToken,
    expiresAt
  });
};

export const registerUser = async ({ name, email, password, role }: { name: string; email: string; password: string; role: string }) => {
  const existingUser = await db
    .select()
    .from(users)
    .where(eq(users.email, email));

  if (existingUser.length > 0) {
    throw new AppError("Email already exists", 409);
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const [newUser] = await db
    .insert(users)
    .values({
      name,
      email,
      password: hashedPassword,
      role
    })
    .returning({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role
    });

  if (!newUser) throw new AppError("Failed to create user", 500);

  const accessToken = generateToken({
    userId: newUser.id,
    role: newUser.role
  });

  const refreshToken = generateRefreshToken({ 
    userId: newUser.id 
  });

  await createSession(newUser.id, refreshToken);

  return { user: newUser, tokens: { accessToken, refreshToken } };
};

export const loginUser = async ({ email, password }: { email: string; password: string }) => {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email));

  if (!user) {
    throw new AppError("Invalid credentials", 401);
  }
  if (!user.isActive) {
    throw new AppError("Your account is inactive. Please contact admin.", 403);
  }

  if (!user.password) {
    throw new AppError("This account uses Email OTP login. Please request a code.", 401);
  }

  const isValid = await bcrypt.compare(password, user.password as string);

  if (!isValid) {
    throw new AppError("Invalid credentials", 401);
  }

  const accessToken = generateToken({
    userId: user.id,
    role: user.role
  });

  const refreshToken = generateRefreshToken({ 
    userId: user.id 
  });

  await createSession(user.id, refreshToken);

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    },
    tokens: { accessToken, refreshToken }
  };
};


export const refreshSession = async (token: string) => {
  try {
    const payload = verifyRefreshToken(token) as { userId: number };
    
    const [session] = await db
      .select()
      .from(sessions)
      .where(and( 
        eq(sessions.refreshToken, token),
        eq(sessions.userId, payload.userId)
      ));

    if (!session || session.expiresAt < new Date()) {
      if (session) await db.delete(sessions).where(eq(sessions.id, session.id));
      throw new AppError("Invalid or expired refresh token", 401);
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, payload.userId));

    if (!user) throw new AppError("User not found", 404);
    
    if (!user.isActive) {
      throw new AppError("Your account is deactivated. Please contact admin.", 403);
    }

    const accessToken = generateToken({ userId: user.id, role: user.role });
    const newRefreshToken = generateRefreshToken({ userId: user.id });

    // Rotate the token: delete old, create new
    await db.delete(sessions).where(eq(sessions.id, session.id));
    await createSession(user.id, newRefreshToken);

    return { tokens: { accessToken, refreshToken: newRefreshToken } };
  } catch (error) {
    throw new AppError(error instanceof AppError ? error.message : "Invalid or expired refresh token", 401);
  }
};

export const requestOtp = async (email: string) => {
  // 0. Check if user exists
  const [user] = await db.select().from(users).where(eq(users.email, email));
  if (!user) {
    throw new AppError("This email is not registered. Please register first.", 404);
  }

  // 1. Generate 6 digit code
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  
  // 2. Hash the code
  const otpHash = await bcrypt.hash(otp, 10);
  
  // 3. Set expiry (5 mins)
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + 5);

  // 4. Save to DB
  await db.insert(otps).values({
    email,
    otpHash,
    expiresAt
  });

  // 5. Send Email
  const sent = await sendOtpEmail(email, otp);
  if (!sent) throw new AppError("Failed to send verification email", 500);

  return { message: "Verification code sent to your email" };
};

export const verifyOtp = async (email: string, otp: string) => {
  // 1. Get the latest OTP for this email
  const [latestOtp] = await db
    .select()
    .from(otps)
    .where(eq(otps.email, email))
    .orderBy(desc(otps.createdAt))
    .limit(1);

  if (!latestOtp) throw new AppError("No verification code found. Please request a new one.", 400);

  // 2. Check expiry
  if (latestOtp.expiresAt < new Date()) {
    await db.delete(otps).where(eq(otps.id, latestOtp.id));
    throw new AppError("Verification code has expired. Please request a new one.", 400);
  }

  // 3. Verify math
  const isValid = await bcrypt.compare(otp, latestOtp.otpHash);
  if (!isValid) throw new AppError("Invalid verification code", 400);

  // 4. Cleanup OTP
  await db.delete(otps).where(eq(otps.email, email));

  // 5. Check if user exists
  const [user] = await db.select().from(users).where(eq(users.email, email));

  if (!user) throw new AppError("User account not found", 404);

  if (!user.isActive) {
    throw new AppError("Your account is deactivated. Please contact admin.", 403);
  }

  // 6. Generate standard tokens
  const accessToken = generateToken({ userId: user.id, role: user.role });
  const refreshToken = generateRefreshToken({ userId: user.id });

  await createSession(user.id, refreshToken);

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    },
    tokens: { accessToken, refreshToken }
  };
};

export const logoutUser = async (userId: number, refreshToken: string) => {
  await db.delete(sessions).where(
    and(
      eq(sessions.userId, userId),
      eq(sessions.refreshToken, refreshToken)
    )
  );
};
