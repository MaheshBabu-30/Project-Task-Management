import { parse } from "valibot";
import type { Context } from "hono";
import { registerSchema, loginSchema } from "./auth.schema.js";
import { registerUser, loginUser, refreshSession } from "./auth.service.js";
import { successResponse } from "../../utils/response.js";
import { AppError } from "../../utils/errors.js";

export const register = async (c: Context) => {
  const body = await c.req.json();

  const data = parse(registerSchema, body);

  const result = await registerUser(data);

  return successResponse(c, result, 201);
};

export const login = async (c: Context) => {
  const body = await c.req.json();

  const data = parse(loginSchema, body);

  const result = await loginUser(data);

  return successResponse(c, result);
};


export const refresh = async (c: Context) => {
  const { refreshToken } = await c.req.json();
  
  if (!refreshToken) {
    throw new AppError("Refresh token is required", 400);
  }

  const result = await refreshSession(refreshToken);

  return successResponse(c, result);
};
