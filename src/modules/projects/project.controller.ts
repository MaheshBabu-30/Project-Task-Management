import { parse } from "valibot";
import type { Context } from "hono";
import {
  createProjectSchema,
  updateProjectSchema,
  projectQuerySchema
} from "./project.schema.js";
import {
  createProject,
  getProjects,
  getProjectById,
  updateProject,
  deleteProject
} from "./project.service.js";
import { successResponse } from "../../utils/response.js";
import { buildPagination } from "../../utils/pagination.js";

// ─── Create Project (ADMIN only) ──────────────────────────────────────────────

export const createNewProject = async (c: Context) => {
  const user = c.get("user");

  if (user.role !== "admin" && user.role !== "superadmin") {
    return c.json({ message: "Only admins can create projects" }, 403);
  }

  if (!user.orgId && user.role !== "superadmin") {
    return c.json({ message: "User not assigned to an organization" }, 403);
  }

  const body = await c.req.json();
  const data = parse(createProjectSchema, body);

  const project = await createProject({
    ...data,
    orgId: user.orgId,
    createdBy: user.userId
  });

  return successResponse(c, project, 201);
};

// ─── List Projects (Scoped) ───────────────────────────────────────────────────

export const getProjectsList = async (c: Context) => {
  const user = c.get("user");
  const rawQuery = c.req.query();

  const query = parse(projectQuerySchema, {
    ...rawQuery,
    page: rawQuery.page ? Number(rawQuery.page) : 1,
    limit: rawQuery.limit ? Number(rawQuery.limit) : 10,
    showDeleted: rawQuery.showDeleted === "true"
  });

  const { data, totalRecords } = await getProjects(query, user);

  const pagination = buildPagination({
    page: query.page as number,
    limit: query.limit as number,
    totalRecords
  });

  return successResponse(c, {
    projects: data,
    pagination
  });
};

// ─── Get Project Details ───────────────────────────────────────────────────────

export const getProjectDetails = async (c: Context) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const project = await getProjectById(id, user);
  return successResponse(c, project);
};

// ─── Update Project (ADMIN only) ──────────────────────────────────────────────

export const updateProjectDetails = async (c: Context) => {
  const user = c.get("user");

  if (user.role !== "admin" && user.role !== "superadmin") {
    return c.json({ message: "Only admins can update project details" }, 403);
  }

  if (!user.orgId && user.role !== "superadmin") {
    return c.json({ message: "User not assigned to an organization" }, 403);
  }

  const id = c.req.param("id");
  const body = await c.req.json();
  const data = parse(updateProjectSchema, body);

  const updated = await updateProject(id, data, user.orgId);
  return successResponse(c, updated);
};

// ─── Soft Delete Project (ADMIN only) ─────────────────────────────────────────

export const deleteProjectRecord = async (c: Context) => {
  const user = c.get("user");

  if (user.role !== "admin" && user.role !== "superadmin") {
    return c.json({ message: "Only admins can archive projects" }, 403);
  }

  if (!user.orgId && user.role !== "superadmin") {
    return c.json({ message: "User not assigned to an organization" }, 403);
  }

  const id = c.req.param("id");
  const result = await deleteProject(id, user.orgId);
  return successResponse(c, result);
};
