// @ts-nocheck
import { db } from "../config/db.js";
import { users } from "../../drizzle/schema.js";
import { eq } from "drizzle-orm";
import { generateToken, generateRefreshToken } from "../utils/jwt.js";
import { AppError } from "../utils/errors.js";
import { createSession } from "../modules/auth/auth.service.js";

export const findOrCreateOAuthUser = async ({ 
  email, 
  name, 
  provider, 
  providerId
}: { 
  email: string; 
  name: string; 
  provider: string; 
  providerId: string; 
}) => {
  const [existingUser] = await db
    .select()
    .from(users)
    .where(eq(users.email, email));

  if (existingUser) {
    if (existingUser.authProvider !== provider) {
      throw new AppError(`Email already registered via ${existingUser.authProvider}`, 400);
    }
    
    const accessToken = generateToken({ userId: existingUser.id, role: existingUser.role });
    const refreshToken = generateRefreshToken({ userId: existingUser.id });

    await createSession(existingUser.id, refreshToken);
    
    return {
      user: existingUser,
      tokens: { accessToken, refreshToken }
    };
  }

  const [newUser] = await db
    .insert(users)
    .values({
      name,
      email,
      authProvider: provider,
      providerId: providerId,
      role: "DEVELOPER"
    })
    .returning();

  if (!newUser) throw new AppError("Failed to create OAuth user", 500);

  const accessToken = generateToken({ userId: newUser.id, role: newUser.role });
  const refreshToken = generateRefreshToken({ userId: newUser.id });

  await createSession(newUser.id, refreshToken);

  return {
    user: newUser,
    tokens: { accessToken, refreshToken }
  };
};
