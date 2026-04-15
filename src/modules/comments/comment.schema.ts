import { object, string, optional, number, minValue, maxValue, pipe, picklist, minLength, maxLength } from "valibot";

export const createCommentSchema = object({
  body: pipe(string(), minLength(1, "Comment cannot be empty"), maxLength(2000, "Comment too long")),
});

export const updateCommentSchema = object({
  body: pipe(string(), minLength(1, "Comment cannot be empty"), maxLength(2000, "Comment too long")),
});

export const commentQuerySchema = object({
  page: optional(pipe(number(), minValue(1, "Page must be >= 1"), maxValue(10000, "Page must be <= 10000"))),
  limit: optional(pipe(number(), minValue(1, "Limit must be >= 1"), maxValue(100, "Limit must be <= 100"))),
  order: optional(picklist(["asc", "desc"] as const)),
});
