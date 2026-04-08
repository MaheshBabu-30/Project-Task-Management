import { parse } from "valibot";
import type { Context } from "hono";
import { registerSchema, loginSchema, requestOtpSchema, verifyOtpSchema } from "./auth.schema.js";
import { registerUser, loginUser, refreshSession, requestOtp, verifyOtp, logoutUser } from "./auth.service.js";
import { successResponse } from "../../utils/response.js";
import { AppError } from "../../utils/errors.js";

export const logoutUserAccount = async (c: Context) => {
  const user = c.get("user");
  const { refreshToken } = await c.req.json();

  if (!refreshToken) {
    throw new AppError("Refresh token is required", 400);
  }

  await logoutUser(user.userId, refreshToken);

  return successResponse(c, { message: "Successfully logged out" });
};


export const registerUserAccount = async (c: Context) => {
  const body = await c.req.json();
  const data = parse(registerSchema, body);

  const result = await registerUser(data as any);

  return successResponse(c, result, 201);
};

export const loginUserAccount = async (c: Context) => {
  const body = await c.req.json();

  const data = parse(loginSchema, body);

  const result = await loginUser(data);

  return successResponse(c, result);
};


export const refreshUserSession = async (c: Context) => {
  const { refreshToken } = await c.req.json();
  
  if (!refreshToken) {
    throw new AppError("Refresh token is required", 400);
  }

  const result = await refreshSession(refreshToken);

  return successResponse(c, result);
};

export const requestLoginOtp = async (c: Context) => {
  const body = await c.req.json();
  const data = parse(requestOtpSchema, body);
  
  const result = await requestOtp(data.email);
  return successResponse(c, result);
};

export const verifyLoginOtp = async (c: Context) => {
  const body = await c.req.json();
  const data = parse(verifyOtpSchema, body);
  
  const result = await verifyOtp(data.email, data.otp);
  return successResponse(c, result);
};
