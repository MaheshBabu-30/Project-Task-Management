import { object, string, optional, pipe, picklist, minLength, maxLength, trim, nonEmpty } from "valibot";
import { pageSchema, limitSchema } from "../../helpers/validators.js";

export const createCommentSchema = object({
  body: pipe(string(), trim(), nonEmpty("Comment cannot be empty"), minLength(1, "Comment cannot be empty"), maxLength(2000, "Comment too long")),
  parentCommentId: optional(string()),
});

export const updateCommentSchema = object({
  body: pipe(string(), trim(), nonEmpty("Comment cannot be empty"), minLength(1, "Comment cannot be empty"), maxLength(2000, "Comment too long")),
});

export const commentQuerySchema = object({
  page: pageSchema,
  limit: limitSchema,
  order: optional(picklist(["asc", "desc"] as const)),
  authorId: optional(string()),
});
