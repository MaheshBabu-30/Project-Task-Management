import { ValiError } from "valibot";
import type { ErrorHandler } from "hono";
import { AppError } from "../utils/errors.js";

/**
 * Global error handler
 * This is the LAST safety net of the application
 */
export const errorHandler: ErrorHandler = (err, c) => {
  console.error("❌ ERROR:", err);

  /* ----------------------------------
     422 – Validation Errors (Valibot)
  ---------------------------------- */
  if (err instanceof ValiError) {
    return c.json(
      {
        success: false,
        statusCode: 422,
        errors: err.issues.map(issue => ({
          field: issue.path?.[0]?.key || "unknown",
          message: issue.message
        }))
      },
      422
    );
  }

  /* ----------------------------------
     Custom application errors
  ---------------------------------- */
  if (err instanceof AppError || (err as any).status) {
    const status = err instanceof AppError ? err.status : (err as any).status;
    return c.json(
      {
        success: false,
        statusCode: status,
        message: err.message
      },
      status as any
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
