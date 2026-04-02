import bcrypt from "bcrypt";
import { db } from "../../config/db.js";
import { users, sessions } from "../../../drizzle/schema.js";
import { eq, and } from "drizzle-orm";
import { generateToken, generateRefreshToken, verifyRefreshToken } from "../../utils/jwt.js";
import { AppError } from "../../utils/errors.js";

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



  const isValid = await bcrypt.compare(password, user.password);

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
