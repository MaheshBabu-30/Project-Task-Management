import { parse } from "valibot";
import type { Context } from "hono";
import { userQuerySchema } from "./user.schema.js";
import { getUsers, updateUserStatus } from "./user.service.js";
import { successResponse } from "../../utils/response.js";
import { buildPagination } from "../../utils/pagination.js";

export const getUsersList = async (c: Context) => {
  const rawQuery = c.req.query();

  const query = parse(userQuerySchema, {
    ...rawQuery,
    page: rawQuery.page ? Number(rawQuery.page) : 1,
    limit: rawQuery.limit ? Number(rawQuery.limit) : 10
  });

  const { data, totalRecords } = await getUsers(query);

  const pagination = buildPagination({
    page: query.page,
    limit: query.limit,
    totalRecords
  });

  return successResponse(c, {
    users: data,
    pagination
  });
};

export const toggleUserStatus = async (c: Context) => {
  const id = Number(c.req.param("id"));
  const { isActive } = await c.req.json();
  const user = c.get("user");

  if (user.role !== "ADMIN") {
    return c.json({ message: "Only admins can update user status" }, 403);
  }

  const updated = await updateUserStatus(id, isActive);
  if (!updated) {
    return c.json({ message: "User not found" }, 404);
  }

  return successResponse(c, updated);
};
