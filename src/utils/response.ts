import type { Context } from "hono";

export const successResponse = (c: Context, data: unknown, status: any = 200) => {
  return c.json(
    {
      success: true,
      data
    },
    status
  );
};
