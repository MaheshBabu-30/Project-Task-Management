export class AppError extends Error {
  public status: number;

  constructor(message: string, status: number = 500) {
    super(message);
    this.name = "AppError";
    this.status = status;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
