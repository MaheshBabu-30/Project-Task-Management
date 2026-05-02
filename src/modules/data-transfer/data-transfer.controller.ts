import { parse } from "valibot";
import type { AppContext } from "../../types/hono.types.js";
import { uuidSchema } from "../../helpers/validators.js";
import { importTasksBodySchema, importProjectBodySchema } from "./data-transfer.schema.js";
import {
  exportProjectTasks,
  exportFullProject,
  exportOrgMembers,
  importTasksIntoProject,
  importProjectIntoOrg,
} from "./data-transfer.service.js";
import { successResponse } from "../../utils/response.js";

// ─── Export Tasks from Project ────────────────────────────────────────────────

export const exportProjectTasksHandler = async (c: AppContext) => {
  const user = c.get("user");
  const id = parse(uuidSchema("Project ID"), c.req.param("id"));
  const data = await exportProjectTasks(id, user);
  c.header("Content-Disposition", `attachment; filename="tasks-${id}.json"`);
  return c.json(data);
};

// ─── Export Full Project ──────────────────────────────────────────────────────

export const exportFullProjectHandler = async (c: AppContext) => {
  const user = c.get("user");
  const id = parse(uuidSchema("Project ID"), c.req.param("id"));
  const data = await exportFullProject(id, user);
  c.header("Content-Disposition", `attachment; filename="project-${id}.json"`);
  return c.json(data);
};

// ─── Export Org Members ───────────────────────────────────────────────────────

export const exportOrgMembersHandler = async (c: AppContext) => {
  const user = c.get("user");
  const id = parse(uuidSchema("Org ID"), c.req.param("id"));
  const data = await exportOrgMembers(id, user);
  c.header("Content-Disposition", `attachment; filename="members-${id}.json"`);
  return c.json(data);
};

// ─── Import Tasks into Project ────────────────────────────────────────────────

export const importProjectTasksHandler = async (c: AppContext) => {
  const user = c.get("user");
  const id = parse(uuidSchema("Project ID"), c.req.param("id"));
  const body = await c.req.json();
  const { tasks: taskList } = parse(importTasksBodySchema, body);
  const result = await importTasksIntoProject(id, taskList, user);
  return successResponse(c, result, 201);
};

// ─── Import Project into Org ──────────────────────────────────────────────────

export const importProjectHandler = async (c: AppContext) => {
  const user = c.get("user");
  const id = parse(uuidSchema("Org ID"), c.req.param("id"));
  const body = await c.req.json();
  const data = parse(importProjectBodySchema, body);
  const result = await importProjectIntoOrg(id, data, user);
  return successResponse(c, result, 201);
};
