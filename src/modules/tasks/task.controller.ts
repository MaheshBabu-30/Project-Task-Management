import { parse } from "valibot";
import type { AppContext } from "../../types/hono.types.js";
import { createTaskSchema, updateTaskSchema, taskQuerySchema, updateTaskStatusSchema } from "./task.schema.js";
import { uuidSchema } from "../../helpers/validators.js";
import {
  createTask,
  updateTask,
  updateTaskStatus,
  getTasks,
  getTaskById,
  getTaskSnapshot,
  getTaskOrgId,
  softDeleteTask,
} from "./task.service.js";
import { successResponse } from "../../utils/response.js";
import { buildPagination } from "../../helpers/pagination.js";
import { createAuditLog } from "../audit-logs/audit-log.service.js";
import { catchError } from "../../utils/logger.js";

const getIp = (c: AppContext) =>
  c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? undefined;

// ─── Create Task (ADMIN only) ───────────────────────────────────────────────

export const createNewTask = async (c: AppContext) => {
  const user = c.get("user");
  const body = await c.req.json();
  const data = parse(createTaskSchema, body);

  const task = await createTask({
    ...data,
    createdBy: user.userId,
    requesterOrgId: user.role !== "superadmin" ? user.orgId : undefined,
  });
  const [afterSnap, taskOrgId] = await Promise.all([
    getTaskSnapshot(task.id),
    user.orgId ? Promise.resolve(user.orgId) : getTaskOrgId(task.id),
  ]);

  createAuditLog({
    orgId: taskOrgId,
    actorId: user.userId,
    action: "task.created",
    entityType: "task",
    entityId: task.id,
    after: afterSnap ?? undefined,
    ipAddress: getIp(c),
  }).catch(catchError("task.controller:auditLog"));

  return successResponse(c, task, 201);
};

// ─── List Tasks (Scoped) ──────────────────────────────────────────────────────

export const getTasksList = async (c: AppContext) => {
  const user = c.get("user");
  const rawQuery = c.req.query();

  const query = parse(taskQuerySchema, rawQuery);

  const { data, totalRecords, stats } = await getTasks(query, user);

  const pagination = buildPagination({
    page: query.page,
    limit: query.limit,
    totalRecords,
  });

  return successResponse(c, {
    tasks: data,
    stats,
    pagination,
  });
};

// ─── Get Task Details ─────────────────────────────────────────────────────────

export const getTaskDetails = async (c: AppContext) => {
  const user = c.get("user");
  const id = parse(uuidSchema("Task ID"), c.req.param("id"));

  const task = await getTaskById(id, user);
  return successResponse(c, task);
};

// ─── Update Task ──────────────────────────────────────────────────────────────
// admin/superadmin: can update all fields
// developer: can only update status

export const updateTaskDetails = async (c: AppContext) => {
  const user = c.get("user");
  const id = parse(uuidSchema("Task ID"), c.req.param("id"));
  const body = await c.req.json();

  if (user.role === "developer") {
    // Developer: only status update allowed
    const { status } = parse(updateTaskStatusSchema, body);

    const [existing, taskOrgId] = await Promise.all([
      getTaskSnapshot(id),
      user.orgId ? Promise.resolve(user.orgId) : getTaskOrgId(id),
    ]);
    const updated = await updateTaskStatus(id, status, user);
    const afterSnap = await getTaskSnapshot(id);

    createAuditLog({
      orgId: taskOrgId,
      actorId: user.userId,
      action: "task.status_updated",
      entityType: "task",
      entityId: id,
      before: existing ?? undefined,
      after: afterSnap ?? undefined,
      ipAddress: getIp(c),
    }).catch(catchError("task.controller:auditLog"));

    return successResponse(c, updated);
  }

  // Admin / Superadmin: full update
  const data = parse(updateTaskSchema, body);
  const [existing, taskOrgId] = await Promise.all([
    getTaskSnapshot(id),
    user.orgId ? Promise.resolve(user.orgId) : getTaskOrgId(id),
  ]);
  const updated = await updateTask(id, data, user.orgId);
  const afterSnap = await getTaskSnapshot(id);

  createAuditLog({
    orgId: taskOrgId,
    actorId: user.userId,
    action: "task.updated",
    entityType: "task",
    entityId: id,
    before: existing ?? undefined,
    after: afterSnap ?? undefined,
    ipAddress: getIp(c),
  }).catch(catchError("task.controller:auditLog"));

  return successResponse(c, updated);
};

// ─── Soft Delete Task (ADMIN only) ──────────────────────────────────────────

export const deleteTaskRecord = async (c: AppContext) => {
  const user = c.get("user");
  const id = parse(uuidSchema("Task ID"), c.req.param("id"));
  const [existing, taskOrgId] = await Promise.all([
    getTaskSnapshot(id),
    user.orgId ? Promise.resolve(user.orgId) : getTaskOrgId(id),
  ]);
  const result = await softDeleteTask(id, user.orgId);

  createAuditLog({
    orgId: taskOrgId,
    actorId: user.userId,
    action: "task.deleted",
    entityType: "task",
    entityId: id,
    before: existing ?? undefined,
    ipAddress: getIp(c),
  }).catch(catchError("task.controller:auditLog"));

  return successResponse(c, result);
};
