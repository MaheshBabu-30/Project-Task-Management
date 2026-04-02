import { parse } from "valibot";
import type { Context } from "hono";
import { userQuerySchema } from "./user.schema.js";
import { getUsers } from "./user.service.js";
import { successResponse } from "../../utils/response.js";
import { buildPagination } from "../../utils/pagination.js";

export const listUsers = async (c: Context) => {
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
