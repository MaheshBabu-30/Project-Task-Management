import { parse } from "valibot";
import type { Context } from "hono";
import { createTaskSchema, updateTaskSchema, taskQuerySchema, updateTaskStatusSchema } from "./task.schema.js";
import { uuidSchema } from "../../helpers/validators.js";
import {
  createTask,
  updateTask,
  updateTaskStatus,
  getTasks,
  getTaskById,
  softDeleteTask,
} from "./task.service.js";
import { successResponse } from "../../utils/response.js";
import { buildPagination } from "../../helpers/pagination.js";
import { createAuditLog } from "../audit-logs/audit-log.service.js";
import { catchError } from "../../utils/logger.js";

const getIp = (c: Context) =>
  c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? undefined;

// ─── Create Task (ADMIN only) ───────────────────────────────────────────────

export const createNewTask = async (c: Context) => {
  const user = c.get("user");
  const body = await c.req.json();
  const data = parse(createTaskSchema, body);

  const task = await createTask({
    ...data,
    createdBy: user.userId,
    requesterOrgId: user.role !== "superadmin" ? user.orgId : undefined,
  });

  createAuditLog({
    orgId: user.orgId,
    actorId: user.userId,
    action: "task.created",
    entityType: "task",
    entityId: task.id,
    after: task,
    ipAddress: getIp(c),
  }).catch(catchError("task.controller:auditLog"));

  return successResponse(c, task, 201);
};

// ─── List Tasks (Scoped) ──────────────────────────────────────────────────────

export const getTasksList = async (c: Context) => {
  const user = c.get("user");
  const rawQuery = c.req.query();

  const query = parse(taskQuerySchema, {
    ...rawQuery,
    page: rawQuery.page ? Number(rawQuery.page) : 1,
    limit: rawQuery.limit ? Number(rawQuery.limit) : 10,
    showDeleted: rawQuery.showDeleted === "true",
  });

  const { data, totalRecords, stats } = await getTasks(query, user);

  const pagination = buildPagination({
    page: query.page as number,
    limit: query.limit as number,
    totalRecords,
  });

  return successResponse(c, {
    tasks: data,
    stats,
    pagination,
  });
};

// ─── Get Task Details ─────────────────────────────────────────────────────────

export const getTaskDetails = async (c: Context) => {
  const user = c.get("user");
  const id = parse(uuidSchema("Task ID"), c.req.param("id"));

  const task = await getTaskById(id, user);
  return successResponse(c, task);
};

// ─── Update Task ──────────────────────────────────────────────────────────────
// admin/superadmin: can update all fields
// developer: can only update status

export const updateTaskDetails = async (c: Context) => {
  const user = c.get("user");
  const id = parse(uuidSchema("Task ID"), c.req.param("id"));
  const body = await c.req.json();

  if (user.role === "developer") {
    // Developer: only status update allowed
    const { status } = parse(updateTaskStatusSchema, body);

    const updated = await updateTaskStatus(id, status, user);

    createAuditLog({
      orgId: user.orgId,
      actorId: user.userId,
      action: "task.status_updated",
      entityType: "task",
      entityId: id,
      after: { status },
      ipAddress: getIp(c),
    }).catch(catchError("task.controller:auditLog"));

    return successResponse(c, updated);
  }

  // Admin / Superadmin: full update
  const data = parse(updateTaskSchema, body);
  const updated = await updateTask(id, data, user.orgId);

  createAuditLog({
    orgId: user.orgId,
    actorId: user.userId,
    action: "task.updated",
    entityType: "task",
    entityId: id,
    after: updated,
    ipAddress: getIp(c),
  }).catch(catchError("task.controller:auditLog"));

  return successResponse(c, updated);
};

// ─── Soft Delete Task (ADMIN only) ──────────────────────────────────────────

export const deleteTaskRecord = async (c: Context) => {
  const user = c.get("user");
  const id = parse(uuidSchema("Task ID"), c.req.param("id"));
  const result = await softDeleteTask(id, user.orgId);

  createAuditLog({
    orgId: user.orgId,
    actorId: user.userId,
    action: "task.deleted",
    entityType: "task",
    entityId: id,
    ipAddress: getIp(c),
  }).catch(catchError("task.controller:auditLog"));

  return successResponse(c, result);
};
