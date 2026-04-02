import { parse } from "valibot";
import type { Context } from "hono";
import {
  createProjectSchema,
  projectQuerySchema
} from "./project.schema.js";
import { createProject, getProjects } from "./project.service.js";
import { successResponse } from "../../utils/response.js";
import { buildPagination } from "../../utils/pagination.js";

export const create = async (c: Context) => {
  const body = await c.req.json();
  const data = parse(createProjectSchema, body);

  const user = c.get("user");

  const project = await createProject({
    ...data,
    createdBy: user.userId
  });

  return successResponse(c, project, 201);
};

export const list = async (c: Context) => {
  const rawQuery = c.req.query();

  const query = parse(projectQuerySchema, {
    ...rawQuery,
    page: rawQuery.page ? Number(rawQuery.page) : 1,
    limit: rawQuery.limit ? Number(rawQuery.limit) : 10
  });

  const { data, totalRecords } = await getProjects(query);

  const pagination = buildPagination({
    page: query.page,
    limit: query.limit,
    totalRecords
  });

  return successResponse(c, {
    projects: data,
    pagination
  });
};
