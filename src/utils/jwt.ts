import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export const generateToken = (payload: object) => {
  return jwt.sign(payload, env.JWT_SECRET as string, {
    expiresIn: env.JWT_EXPIRES_IN as any
  });
};

export const verifyToken = (token: string) => {
  return jwt.verify(token, env.JWT_SECRET as string);
};

export const generateRefreshToken = (payload: object) => {
  return jwt.sign(payload, env.REFRESH_TOKEN_SECRET as string, {
    expiresIn: env.REFRESH_TOKEN_EXPIRES_IN as any
  });
};

export const verifyRefreshToken = (token: string) => {
  return jwt.verify(token, env.REFRESH_TOKEN_SECRET as string);
};
