import { parse } from "valibot";
import type { Context } from "hono";
import {
  createProjectSchema,
  updateProjectSchema,
  projectQuerySchema
} from "./project.schema.js";
import { createProject, getProjects, getProjectById, updateProject, deleteProject } from "./project.service.js";
import { successResponse } from "../../utils/response.js";
import { buildPagination } from "../../utils/pagination.js";

export const createNewProject = async (c: Context) => {
  const user = c.get("user");

  if (user.role !== "ADMIN") {
    return c.json({ message: "Only admins can create projects" }, 403);
  }

  const body = await c.req.json();
  const data = parse(createProjectSchema, body);

  const project = await createProject({
    ...data,
    createdBy: user.userId
  });

  return successResponse(c, project, 201);
};

export const getProjectsList = async (c: Context) => {
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

export const getDeletedProjectsList = async (c: Context) => {
  const user = c.get("user");
  if (user.role !== "ADMIN") {
    return c.json({ message: "Only admins can view deleted projects" }, 403);
  }

  const rawQuery = c.req.query();
  const query = parse(projectQuerySchema, {
    ...rawQuery,
    page: rawQuery.page ? Number(rawQuery.page) : 1,
    limit: rawQuery.limit ? Number(rawQuery.limit) : 10,
    showDeleted: true
  });

  const { data, totalRecords } = await getProjects(query, user);

  const pagination = buildPagination({
    page: query.page,
    limit: query.limit,
    totalRecords
  });

  return successResponse(c, { projects: data, pagination });
};

export const getProjectDetails = async (c: Context) => {
  const id = Number(c.req.param("id"));
  const user = c.get("user");

  // Admin sees project with tasks
  const project = await getProjectById(id, user.role === "ADMIN");

  if (!project) {
    return c.json({ message: "Project not found" }, 404);
  }

  return successResponse(c, project);
};

export const updateProjectDetails = async (c: Context) => {
  const user = c.get("user");

  if (user.role !== "ADMIN") {
    return c.json({ message: "Only admins can update project metadata" }, 403);
  }

  const id = Number(c.req.param("id"));
  const body = await c.req.json();
  const data = parse(updateProjectSchema, body); 

  const updated = await updateProject(id, data);
  if (!updated) {
    return c.json({ message: "Project not found" }, 404);
  }

  return successResponse(c, updated);
};

export const deleteProjectRecord = async (c: Context) => {
  const user = c.get("user");

  if (user.role !== "ADMIN") {
    return c.json({ message: "Only admins can archive projects" }, 403);
  }

  const id = Number(c.req.param("id"));
  const result = await deleteProject(id);
  return successResponse(c, result);
};
