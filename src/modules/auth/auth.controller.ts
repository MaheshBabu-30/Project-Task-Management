import { parse } from "valibot";
import type { AppContext } from "../../types/hono.types.js";
import { loginSchema, requestOtpSchema, verifyOtpSchema } from "./auth.schema.js";
import { loginUser, refreshSession, requestOtp, verifyOtp, logoutUser } from "./auth.service.js";
import { successResponse } from "../../utils/response.js";
import { BadRequestException } from "../../exceptions/index.js";

export const logoutUserAccount = async (c: AppContext) => {
  const user = c.get("user");
  const { refreshToken } = await c.req.json();

  if (!refreshToken) {
    throw new BadRequestException("Refresh token is required");
  }

  await logoutUser(user.userId, refreshToken);

  return successResponse(c, { message: "Successfully logged out" });
};

export const loginUserAccount = async (c: AppContext) => {
  const body = await c.req.json();

  const data = parse(loginSchema, body);

  const result = await loginUser(data);

  return successResponse(c, result);
};


export const refreshUserSession = async (c: AppContext) => {
  const { refreshToken } = await c.req.json();
  
  if (!refreshToken) {
    throw new BadRequestException("Refresh token is required");
  }

  const result = await refreshSession(refreshToken);

  return successResponse(c, result);
};

export const requestLoginOtp = async (c: AppContext) => {
  const body = await c.req.json();
  const data = parse(requestOtpSchema, body);
  
  const result = await requestOtp(data.email);
  return successResponse(c, result);
};

export const verifyLoginOtp = async (c: AppContext) => {
  const body = await c.req.json();
  const data = parse(verifyOtpSchema, body);
  
  const result = await verifyOtp(data.email, data.otp);
  return successResponse(c, result);
};
