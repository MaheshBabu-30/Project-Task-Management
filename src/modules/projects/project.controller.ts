import { parse } from "valibot";
import type { Context } from "hono";
import {
  createProjectSchema,
  projectQuerySchema
} from "./project.schema.js";
import { createProject, getProjects, getProjectById, updateProject, deleteProject } from "./project.service.js";
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

  const user = c.get("user");
  const { data, totalRecords } = await getProjects(query, user);

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

export const getById = async (c: Context) => {
  const id = Number(c.req.param("id"));
  const user = c.get("user");

  // Admin sees project with tasks
  const project = await getProjectById(id, user.role === "ADMIN");

  if (!project) {
    return c.json({ message: "Project not found" }, 404);
  }

  return successResponse(c, project);
};

export const update = async (c: Context) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json();
  const data = parse(createProjectSchema, body); // Reusing create schema for simplicity

  const updated = await updateProject(id, data);
  if (!updated) {
    return c.json({ message: "Project not found" }, 404);
  }

  return successResponse(c, updated);
};

export const remove = async (c: Context) => {
  const id = Number(c.req.param("id"));
  await deleteProject(id);
  return successResponse(c, { message: "Project deleted successfully" });
};
