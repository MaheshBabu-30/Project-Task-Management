import { parse } from "valibot";
import type { AppContext } from "../../types/hono.types.js";
import { createCommentSchema, updateCommentSchema, commentQuerySchema } from "./comment.schema.js";
import { uuidSchema } from "../../helpers/validators.js";
import { getComments, createComment, updateComment, deleteComment } from "./comment.service.js";
import { successResponse } from "../../utils/response.js";
import { buildPagination } from "../../helpers/pagination.js";

export const listComments = async (c: AppContext) => {
  const user = c.get("user");
  const taskId = parse(uuidSchema("Task ID"), c.req.param("taskId"));
  const rawQuery = c.req.query();

  const query = parse(commentQuerySchema, rawQuery);

  const { data, totalRecords } = await getComments(taskId, user, query);

  const pagination = buildPagination({
    page: query.page,
    limit: query.limit,
    totalRecords,
  });

  return successResponse(c, { comments: data, pagination });
};

export const addComment = async (c: AppContext) => {
  const user = c.get("user");
  const taskId = parse(uuidSchema("Task ID"), c.req.param("taskId"));
  const body = await c.req.json();
  const { body: text, parentCommentId } = parse(createCommentSchema, body);

  const parentId = parentCommentId
    ? parse(uuidSchema("Parent Comment ID"), parentCommentId)
    : undefined;

  const comment = await createComment(taskId, text, user, parentId);
  return successResponse(c, comment, 201);
};

export const editComment = async (c: AppContext) => {
  const user = c.get("user");
  const commentId = parse(uuidSchema("Comment ID"), c.req.param("commentId"));
  const body = await c.req.json();
  const { body: text } = parse(updateCommentSchema, body);

  const updated = await updateComment(commentId, text, user);
  return successResponse(c, updated);
};

export const removeComment = async (c: AppContext) => {
  const user = c.get("user");
  const commentId = parse(uuidSchema("Comment ID"), c.req.param("commentId"));

  const result = await deleteComment(commentId, user);
  return successResponse(c, result);
};
