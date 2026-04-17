import type { Context } from "hono";
import type { IRespWithData } from "../types/app.types.js";
import { HttpStatus, type HttpStatusCode } from "../constants/httpStatus.js";

export const successResponse = <T>(
  c: Context,
  data: T,
  status: HttpStatusCode = HttpStatus.OK
): Response => {
  const body: IRespWithData<T> = {
    success: true,
    statusCode: status,
    data,
  };
  return c.json(body, status as Parameters<typeof c.json>[1]);
};
