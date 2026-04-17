export class BaseException extends Error {
  public readonly status: number;
  /**
   * true  → expected, user-facing error (4xx). Log at warn level.
   * false → unexpected programmer/system error (5xx). Log at error level, alert on-call.
   */
  public readonly isOperational: boolean;
  /** Optional structured context for debugging (not sent to clients). */
  public readonly errData?: Record<string, unknown>;

  constructor(
    message: string,
    status: number,
    isOperational = true,
    errData?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.isOperational = isOperational;
    this.errData = errData;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
