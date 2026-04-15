import { parse } from "valibot";
import type { Context } from "hono";
import { createCommentSchema, updateCommentSchema, commentQuerySchema } from "./comment.schema.js";
import { uuidSchema } from "../../utils/schema.js";
import { getComments, createComment, updateComment, deleteComment } from "./comment.service.js";
import { successResponse } from "../../utils/response.js";
import { buildPagination } from "../../utils/pagination.js";

export const listComments = async (c: Context) => {
  const user = c.get("user");
  const taskId = parse(uuidSchema("Task ID"), c.req.param("taskId"));
  const rawQuery = c.req.query();

  const query = parse(commentQuerySchema, {
    ...rawQuery,
    page: rawQuery.page ? Number(rawQuery.page) : 1,
    limit: rawQuery.limit ? Number(rawQuery.limit) : 20,
  });

  const { data, totalRecords } = await getComments(taskId, user, query);

  const pagination = buildPagination({
    page: query.page as number,
    limit: query.limit as number,
    totalRecords,
  });

  return successResponse(c, { comments: data, pagination });
};

export const addComment = async (c: Context) => {
  const user = c.get("user");
  const taskId = parse(uuidSchema("Task ID"), c.req.param("taskId"));
  const body = await c.req.json();
  const { body: text } = parse(createCommentSchema, body);

  const comment = await createComment(taskId, text, user);
  return successResponse(c, comment, 201);
};

export const editComment = async (c: Context) => {
  const user = c.get("user");
  const commentId = parse(uuidSchema("Comment ID"), c.req.param("commentId"));
  const body = await c.req.json();
  const { body: text } = parse(updateCommentSchema, body);

  const updated = await updateComment(commentId, text, user);
  return successResponse(c, updated);
};

export const removeComment = async (c: Context) => {
  const user = c.get("user");
  const commentId = parse(uuidSchema("Comment ID"), c.req.param("commentId"));

  const result = await deleteComment(commentId, user);
  return successResponse(c, result);
};
