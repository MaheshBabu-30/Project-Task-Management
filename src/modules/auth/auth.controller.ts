import { parse } from "valibot";
import type { AppContext } from "../../types/hono.types.js";
import { loginSchema, requestOtpSchema, verifyOtpSchema, changePasswordSchema, forgotPasswordSchema, resetPasswordSchema } from "./auth.schema.js";
import { loginUser, refreshSession, requestOtp, verifyOtp, logoutUser, changePassword, forgotPassword, resetPassword } from "./auth.service.js";
import { successResponse } from "../../utils/response.js";
import { BadRequestException } from "../../exceptions/index.js";
import { createAuditLog } from "../audit-logs/audit-log.service.js";

export const logoutUserAccount = async (c: AppContext) => {
  const user = c.get("user");
  const { refreshToken } = await c.req.json();

  if (!refreshToken) {
    throw new BadRequestException("Refresh token is required");
  }

  await logoutUser(user.userId, refreshToken);

  createAuditLog({
    actorId: user.userId,
    orgId: user.orgId,
    action: "auth.logout",
    entityType: "user",
    entityId: user.userId,
    ipAddress: c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip"),
  }).catch(() => {});

  return successResponse(c, { message: "Successfully logged out" });
};

export const loginUserAccount = async (c: AppContext) => {
  const body = await c.req.json();

  const data = parse(loginSchema, body);

  const result = await loginUser(data);

  createAuditLog({
    actorId: result.user.id,
    orgId: result.user.orgId,
    action: "auth.login",
    entityType: "user",
    entityId: result.user.id,
    after: { name: result.user.name, email: result.user.email, role: result.user.role },
    ipAddress: c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip"),
  }).catch(() => {});

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

export const changePasswordHandler = async (c: AppContext) => {
  const user = c.get("user");
  const body = await c.req.json();
  const { currentPassword, newPassword } = parse(changePasswordSchema, body);
  const result = await changePassword(user.userId, currentPassword, newPassword);
  return successResponse(c, result);
};

export const forgotPasswordHandler = async (c: AppContext) => {
  const body = await c.req.json();
  const { email } = parse(forgotPasswordSchema, body);
  const result = await forgotPassword(email);
  return successResponse(c, result);
};

export const resetPasswordHandler = async (c: AppContext) => {
  const body = await c.req.json();
  const { email, otp, newPassword } = parse(resetPasswordSchema, body);
  const result = await resetPassword(email, otp, newPassword);
  return successResponse(c, result);
};
