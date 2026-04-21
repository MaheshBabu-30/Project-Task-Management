import { object, string, optional, number, minValue, maxValue, pipe, picklist, minLength, maxLength, trim, nonEmpty } from "valibot";

export const createCommentSchema = object({
  body: pipe(string(), trim(), nonEmpty("Comment cannot be empty"), minLength(1, "Comment cannot be empty"), maxLength(2000, "Comment too long")),
  parentCommentId: optional(string()),
});

export const updateCommentSchema = object({
  body: pipe(string(), trim(), nonEmpty("Comment cannot be empty"), minLength(1, "Comment cannot be empty"), maxLength(2000, "Comment too long")),
});

export const commentQuerySchema = object({
  page: optional(pipe(number(), minValue(1, "Page must be >= 1"), maxValue(500, "Page must be <= 500"))),
  limit: optional(pipe(number(), minValue(1, "Limit must be >= 1"), maxValue(100, "Limit must be <= 100"))),
  order: optional(picklist(["asc", "desc"] as const)),
  authorId: optional(string()),
});
