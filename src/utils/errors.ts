export class AppError extends Error {
  public status: number;

  constructor(message: string, status: number = 500) {
    super(message);
    this.name = "AppError";
    this.status = status;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

interface StatusError extends Error {
  status: number;
}

/** Type guard: true when an unknown value has a numeric `.status` property. */
export const isStatusError = (err: unknown): err is StatusError =>
  err instanceof Error &&
  "status" in err &&
  typeof (err as StatusError).status === "number";
