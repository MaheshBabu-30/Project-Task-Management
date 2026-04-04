import { parse } from "valibot";
import type { Context } from "hono";
import {createTaskSchema, updateTaskSchema, taskQuerySchema} from "./task.schema.js";
import { createTask, updateTask, getTasks, getTaskById } from "./task.service.js";
import { successResponse } from "../../utils/response.js";
import { buildPagination } from "../../utils/pagination.js";
import { db } from "../../config/db.js";
import { tasks } from "../../../drizzle/schema.js";
import { eq } from "drizzle-orm";

export const create = async (c: Context) => {
  const user = c.get("user");

if (user.role !== "ADMIN") {
  return c.json(
    { message: "Only admin can create tasks" },
    403
  );
}

  const body = await c.req.json();
  const data = parse(createTaskSchema, body);

  const task = await createTask({
    ...data,
    status: "PENDING"
  });

  return successResponse(c, task, 201);
};

export const update = async (c: Context) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json();
  const data = parse(updateTaskSchema, body);

  const user = c.get("user");

  // 🔎 Fetch the task first
  const task = await getTaskById(id);

  if (!task) {
    return c.json({ message: "Task not found" }, 404);
  }

  // 👮 Admin can update everything
  if (user.role === "ADMIN") {
    const updated = await updateTask(id, data);
    return successResponse(c, updated);
  }

  // 🚫 Developer can update only status and only his assigned task
  if (user.role === "DEVELOPER") {
    if (Object.keys(data).some((key) => key !== "status")) {
      return c.json(
        { message: "Developers can only update task status" },
        403
      );
    }

    if (task.assignedTo !== user.userId) {
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

export const remove = async (c: Context) => {
  const id = Number(c.req.param("id"));
  const user = c.get("user");

  if (user.role !== "ADMIN") {
    return c.json({ message: "Only admin can delete tasks" }, 403);
  }

  const task = await getTaskById(id);
  if (!task) {
    return c.json({ message: "Task not found" }, 404);
  }

  if (task.status !== "COMPLETED") {
    return c.json({ message: "Only completed tasks can be deleted" }, 400);
  }

  await db.delete(tasks).where(eq(tasks.id, id));

  return successResponse(c, { message: "Task deleted successfully" });
};

export const list = async (c: Context) => {
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
