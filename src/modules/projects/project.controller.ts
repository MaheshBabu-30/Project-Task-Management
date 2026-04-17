import { parse } from "valibot";
import type { Context } from "hono";
import {
  createProjectSchema,
  updateProjectSchema,
  projectQuerySchema
} from "./project.schema.js";
import { uuidSchema } from "../../helpers/schema.js";
import {
  createProject,
  getProjects,
  getProjectById,
  updateProject,
  deleteProject
} from "./project.service.js";
import { successResponse } from "../../utils/response.js";
import { buildPagination } from "../../helpers/pagination.js";
import { createAuditLog } from "../audit-logs/audit-log.service.js";
import { catchError } from "../../utils/logger.js";

const getIp = (c: Context) =>
  c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? undefined;

// ─── Create Project (ADMIN only) ──────────────────────────────────────────────

export const createNewProject = async (c: Context) => {
  const user = c.get("user");
  const body = await c.req.json();
  const data = parse(createProjectSchema, body);

  // 🏛️ Logic for Implicit vs Explicit Org Assignment
  // 1. If Superadmin: they MUST provide an orgId in the body
  if (user.role === "superadmin") {
    if (!body.orgId) return c.json({ message: "Organization ID is required" }, 400);
    // Explicitly validate the body.orgId as a UUID
    const targetOrgId = parse(uuidSchema("Organization ID"), body.orgId);
    
    const project = await createProject({
      ...data,
      orgId: targetOrgId,
      createdBy: user.userId,
      assignedUserIds: body.assignedUserIds,
    });

    createAuditLog({
      orgId: targetOrgId,
      actorId: user.userId,
      action: "project.created",
      entityType: "project",
      entityId: project.id,
      after: project,
      ipAddress: getIp(c),
    }).catch(catchError("project.controller:auditLog"));

    return successResponse(c, project, 201);
  }

  // 2. If Admin: we take orgId from their Token (implicitly safe)
  if (!user.orgId) {
    return c.json({ message: "Organization affiliation missing" }, 400);
  }

  const project = await createProject({
    ...data,
    orgId: user.orgId,
    createdBy: user.userId,
    assignedUserIds: body.assignedUserIds,
  });

  createAuditLog({
    orgId: user.orgId,
    actorId: user.userId,
    action: "project.created",
    entityType: "project",
    entityId: project.id,
    after: project,
    ipAddress: getIp(c),
  }).catch(catchError("project.controller:auditLog"));

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
  const id = parse(uuidSchema("Project ID"), c.req.param("id"));

  const project = await getProjectById(id, user);
  return successResponse(c, project);
};

// ─── Update Project (ADMIN only) ──────────────────────────────────────────────

export const updateProjectDetails = async (c: Context) => {
  const user = c.get("user");
  const id = parse(uuidSchema("Project ID"), c.req.param("id"));
  const body = await c.req.json();
  const data = parse(updateProjectSchema, body);

  const updated = await updateProject(id, data, user.orgId);

  createAuditLog({
    orgId: user.orgId,
    actorId: user.userId,
    action: "project.updated",
    entityType: "project",
    entityId: id,
    after: updated,
    ipAddress: getIp(c),
  }).catch(catchError("project.controller:auditLog"));

  return successResponse(c, updated);
};

// ─── Soft Delete Project (ADMIN only) ─────────────────────────────────────────

export const deleteProjectRecord = async (c: Context) => {
  const user = c.get("user");
  const id = parse(uuidSchema("Project ID"), c.req.param("id"));
  const result = await deleteProject(id, user.orgId);

  createAuditLog({
    orgId: user.orgId,
    actorId: user.userId,
    action: "project.deleted",
    entityType: "project",
    entityId: id,
    ipAddress: getIp(c),
  }).catch(catchError("project.controller:auditLog"));

  return successResponse(c, result);
};
