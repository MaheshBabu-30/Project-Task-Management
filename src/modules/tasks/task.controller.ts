import { parse } from "valibot";
import type { Context } from "hono";
import { createTaskSchema, updateTaskSchema, taskQuerySchema } from "./task.schema.js";
import {
  createTask,
  updateTask,
  getTasks,
  getTaskById,
  softDeleteTask,
} from "./task.service.js";
import { successResponse } from "../../utils/response.js";
import { buildPagination } from "../../utils/pagination.js";

// ─── Create Task (ADMIN only) ───────────────────────────────────────────────

export const createNewTask = async (c: Context) => {
  const user = c.get("user");

  if (user.role !== "admin" && user.role !== "superadmin") {
    return c.json({ message: "Only admins can create tasks" }, 403);
  }

  const body = await c.req.json();
  const data = parse(createTaskSchema, body);

  const task = await createTask({
    ...data,
    createdBy: user.userId,
  });

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

  const { data, totalRecords } = await getTasks(query, user);

  const pagination = buildPagination({
    page: query.page as number,
    limit: query.limit as number,
    totalRecords,
  });

  return successResponse(c, {
    tasks: data,
    pagination,
  });
};

// ─── Get Task Details ─────────────────────────────────────────────────────────

export const getTaskDetails = async (c: Context) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const task = await getTaskById(id, user);
  return successResponse(c, task);
};

// ─── Update Task ──────────────────────────────────────────────────────────────

export const updateTaskDetails = async (c: Context) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json();
  const data = parse(updateTaskSchema, body);

  // 1. Fetch task to check ownership/assignment
  const task = await getTaskById(id, user);

  // 2. Role-based Logic
  if (user.role === "admin" || user.role === "superadmin") {
    // Admins can update everything
    const updated = await updateTask(id, data, user.orgId);
    return successResponse(c, updated);
  }

  if (user.role === "developer") {
    // Developers can ONLY update status
    const keys = Object.keys(data);
    if (keys.length > 1 || (keys.length === 1 && !data.status)) {
      return c.json({ message: "Developers can only update task status" }, 403);
    }

    const updated = await updateTask(id, { status: data.status }, user.orgId);
    return successResponse(c, updated);
  }

  return c.json({ message: "Forbidden" }, 403);
};

// ─── Soft Delete Task (ADMIN only) ──────────────────────────────────────────

export const deleteTaskRecord = async (c: Context) => {
  const user = c.get("user");
  const id = c.req.param("id");

  if (user.role !== "admin" && user.role !== "superadmin") {
    return c.json({ message: "Only admins can archive tasks" }, 403);
  }

  const result = await softDeleteTask(id, user.orgId);
  return successResponse(c, result);
};
