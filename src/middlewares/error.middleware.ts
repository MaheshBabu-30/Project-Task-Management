import { ValiError } from "valibot";
import type { ErrorHandler } from "hono";
import { AppError, isStatusError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

/**
 * Global error handler
 * This is the LAST safety net of the application
 */
export const errorHandler: ErrorHandler = (err, c) => {
  logger.error("Unhandled error", err, "errorHandler");

  /* ----------------------------------
     422 – Validation Errors (Valibot)
  ---------------------------------- */
  if (err instanceof ValiError) {
    const seen = new Set<string>();
    const errors = err.issues
      .map(issue => ({
        field: String(issue.path?.[0]?.key ?? "unknown"),
        message: issue.message,
      }))
      .filter(({ field }) => {
        if (seen.has(field)) return false;
        seen.add(field);
        return true;
      });

    return c.json({ success: false, statusCode: 422, errors }, 422);
  }

  /* ----------------------------------
     Custom application errors
  ---------------------------------- */
  if (err instanceof AppError) {
    return c.json(
      { success: false, statusCode: err.status, message: err.message },
      err.status as Parameters<typeof c.json>[1],
    );
  }

  if (isStatusError(err)) {
    return c.json(
      { success: false, statusCode: err.status, message: err.message },
      err.status as Parameters<typeof c.json>[1],
    );
  }

  /* ----------------------------------
     400 – Bad Request
  ---------------------------------- */
  if (err.name === "SyntaxError") {
    return c.json(
      {
        success: false,
        statusCode: 400,
        message: "Invalid JSON request body"
      },
      400
    );
  }

  /* ----------------------------------
     500 – Internal Server Error
  ---------------------------------- */
  return c.json(
    {
      success: false,
      statusCode: 500,
      message: "Internal Server Error"
    },
    500
  );
};
