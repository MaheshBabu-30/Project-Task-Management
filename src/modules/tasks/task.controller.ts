import { parse } from "valibot";
import type { Context } from "hono";
import {createTaskSchema, updateTaskSchema, taskQuerySchema} from "./task.schema.js";
import { createTask, updateTask, getTasks, getTaskById, softDeleteTask } from "./task.service.js";
import { successResponse } from "../../utils/response.js";
import { buildPagination } from "../../utils/pagination.js";
import { db } from "../../config/db.js";
import { tasks } from "../../../drizzle/schema.js";
import { eq } from "drizzle-orm";

export const createNewTask = async (c: Context) => {
  const user = c.get("user");

if (user.role !== "ADMIN") {
  return c.json(
    { message: "Only admin can create tasks" },
    403
  );
}

  const body = await c.req.json();
  const { assignedUserIds, ...taskData } = parse(createTaskSchema, body);

  const task = await createTask({
    ...taskData,
    status: "PENDING"
  }, assignedUserIds);

  return successResponse(c, task, 201);
};

export const updateTaskDetails = async (c: Context) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json();
  const { assignedUserIds, ...data } = parse(updateTaskSchema, body);

  const user = c.get("user");

  // 🔎 Fetch the task first (returns with assignedUserIds)
  const task = await getTaskById(id);

  if (!task) {
    return c.json({ message: "Task not found" }, 404);
  }

  // 👮 Admin can update everything
  if (user.role === "ADMIN") {
    const updated = await updateTask(id, data, assignedUserIds);
    return successResponse(c, updated);
  }

  // 🚫 Developer can update only status and only his assigned task
  if (user.role === "DEVELOPER") {
    if (Object.keys(data).length > 1 || (Object.keys(data).length === 1 && !data.status) || assignedUserIds) {
      return c.json(
        { message: "Developers can only update task status" },
        403
      );
    }

    if (!task.assignedUserIds.includes(user.userId)) {
      return c.json(
        { message: "You can update only your assigned tasks" },
        403
      );
    }

    const updated = await updateTask(id, data);
    return successResponse(c, updated);
  }

  return c.json({ message: "Forbidden" }, 403);
};

export const deleteTaskRecord = async (c: Context) => {
  const id = Number(c.req.param("id"));
  const user = c.get("user");

  if (user.role !== "ADMIN") {
    return c.json({ message: "Only admin can delete tasks" }, 403);
  }

  const result = await softDeleteTask(id);

  return successResponse(c, result);
};

export const getTasksList = async (c: Context) => {
  const rawQuery = c.req.query();

  const query = parse(taskQuerySchema, {
    ...rawQuery,
    page: rawQuery.page ? Number(rawQuery.page) : 1,
    limit: rawQuery.limit ? Number(rawQuery.limit) : 10
  });

  const user = c.get("user");

  const { data, totalRecords } = await getTasks(query, user);

  const pagination = buildPagination({
    page: query.page,
    limit: query.limit,
    totalRecords
  });

  return successResponse(c, {
    tasks: data,
    pagination
  });
};

export const getDeletedTasksList = async (c: Context) => {
  const user = c.get("user");
  if (user.role !== "ADMIN") {
    return c.json({ message: "Only admins can view deleted tasks" }, 403);
  }

  const rawQuery = c.req.query();
  const query = parse(taskQuerySchema, {
    ...rawQuery,
    page: rawQuery.page ? Number(rawQuery.page) : 1,
    limit: rawQuery.limit ? Number(rawQuery.limit) : 10,
    showDeleted: true
  });

  const { data, totalRecords } = await getTasks(query, user);

  const pagination = buildPagination({
    page: query.page,
    limit: query.limit,
    totalRecords
  });

  return successResponse(c, { tasks: data, pagination });
};
