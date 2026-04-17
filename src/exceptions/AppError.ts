// Re-exported for backward compatibility. Prefer specific exception subclasses from "./index.js".
export { BaseException as AppError } from "./BaseException.js";
export { BaseException } from "./BaseException.js";

export const isStatusError = (err: unknown): err is { status: number } & Error =>
  err instanceof Error &&
  "status" in err &&
  typeof (err as { status: unknown }).status === "number";
