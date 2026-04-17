import { ValiError } from "valibot";
import type { ErrorHandler } from "hono";
import { BaseException } from "../exceptions/BaseException.js";
import { isStatusError } from "../exceptions/AppError.js";
import { logger } from "../utils/logger.js";
import { HttpStatus } from "../constants/httpStatus.js";
import { INVALID_JSON, INTERNAL_SERVER_ERROR } from "../constants/appMessages.js";
import type { IRespWithErrors, IRespWithMessage } from "../types/app.types.js";
import type { HttpStatusCode } from "../constants/httpStatus.js";

/**
 * Global error handler — last safety net of the application.
 * Operational errors (4xx) are logged at warn. Non-operational (5xx) are logged at error.
 */
export const errorHandler: ErrorHandler = (err, c) => {
  // BaseException covers all our custom subclasses (BadRequestException, NotFoundException, etc.)
  if (err instanceof BaseException) {
    if (err.isOperational) {
      logger.warn(err.message, "errorHandler");
    } else {
      logger.error(err.message, err, "errorHandler");
    }
    const body: IRespWithMessage = {
      success: false,
      statusCode: err.status as HttpStatusCode,
      message: err.message,
    };
    return c.json(body, err.status as Parameters<typeof c.json>[1]);
  }

  // Valibot validation errors → 422
  if (err instanceof ValiError) {
    const seen = new Set<string>();
    const errors = err.issues
      .map((issue) => ({
        field: String(issue.path?.[0]?.key ?? "unknown"),
        message: issue.message,
      }))
      .filter(({ field }) => {
        if (seen.has(field)) return false;
        seen.add(field);
        return true;
      });

    logger.warn("Validation error", "errorHandler");
    const body: IRespWithErrors = {
      success: false,
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      errors,
    };
    return c.json(body, HttpStatus.UNPROCESSABLE_ENTITY);
  }

  // Framework/library errors that carry a status
  if (isStatusError(err)) {
    logger.warn(err.message, "errorHandler");
    const body: IRespWithMessage = {
      success: false,
      statusCode: err.status as HttpStatusCode,
      message: err.message,
    };
    return c.json(body, err.status as Parameters<typeof c.json>[1]);
  }

  // Malformed JSON body
  if (err.name === "SyntaxError") {
    const body: IRespWithMessage = {
      success: false,
      statusCode: HttpStatus.BAD_REQUEST,
      message: INVALID_JSON,
    };
    return c.json(body, HttpStatus.BAD_REQUEST);
  }

  // Catch-all 500
  logger.error("Unhandled error", err, "errorHandler");
  const body: IRespWithMessage = {
    success: false,
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    message: INTERNAL_SERVER_ERROR,
  };
  return c.json(body, HttpStatus.INTERNAL_SERVER_ERROR);
};
