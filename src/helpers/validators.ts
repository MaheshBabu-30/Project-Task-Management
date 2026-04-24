import { string, pipe, uuid, unknown, transform, number, boolean, optional, minValue, maxValue } from "valibot";

export const uuidSchema = (fieldName: string = "ID") =>
  pipe(string(`${fieldName} must be a string`), uuid(`${fieldName} must be a valid UUID format`));

// HTTP query params arrive as strings — these coerce before validating so
// controllers can pass rawQuery directly without manual Number()/==="true" conversion.
export const pageSchema = optional(pipe(unknown(), transform(Number), number(), minValue(1, "Page must be >= 1"), maxValue(500, "Page must be <= 500")));
export const limitSchema = optional(pipe(unknown(), transform(Number), number(), minValue(1, "Limit must be >= 1"), maxValue(100, "Limit must be <= 100")));
export const booleanStringSchema = optional(pipe(unknown(), transform((v) => v === "true" || v === true), boolean()));
