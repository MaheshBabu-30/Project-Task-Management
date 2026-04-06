import { db } from "../../config/db.js";
import { tasks, projects, taskAssignments, users } from "../../../drizzle/schema.js";
import { eq, and, ilike, asc, desc, isNull, inArray } from "drizzle-orm";
import { AppError } from "../../utils/errors.js";

export const createTask = async (data: any, assignedUserIds: number[]) => {
  return await db.transaction(async (tx) => {
    // 1. Insert the task
    const [task] = await tx
      .insert(tasks)
      .values({
        ...data,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
      })
      .returning();

    if (!task) throw new AppError("Failed to create task", 500);

    // 2. Create assignments
    if (assignedUserIds.length > 0) {
      await tx.insert(taskAssignments).values(
        assignedUserIds.map((userId) => ({
          taskId: task.id,
          userId,
        }))
      );
    }

    return { ...task, assignedUserIds };
  });
};

export const getTaskById = async (id: number) => {
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.deleted, false)));

  if (!task) return null;

  // Fetch assigned users
  const assignments = await db
    .select({ userId: taskAssignments.userId })
    .from(taskAssignments)
    .where(eq(taskAssignments.taskId, id));

  return {
    ...task,
    assignedUserIds: assignments.map((a) => a.userId),
  };
};

export const updateTask = async (id: number, data: any, assignedUserIds?: number[]) => {
  return await db.transaction(async (tx) => {
    const updateData: any = { ...data };
    if (data.dueDate) updateData.dueDate = new Date(data.dueDate);

    const [updated] = await tx
      .update(tasks)
      .set(updateData)
      .where(eq(tasks.id, id))
      .returning();

    if (!updated) throw new AppError("Task not found", 404);

    // Sync assignments if provided
    if (assignedUserIds) {
      await tx.delete(taskAssignments).where(eq(taskAssignments.taskId, id));
      if (assignedUserIds.length > 0) {
        await tx.insert(taskAssignments).values(
          assignedUserIds.map((userId) => ({
            taskId: id,
            userId,
          }))
        );
      }
    }

    return updated;
  });
};

export const softDeleteTask = async (id: number) => {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
  if (!task) throw new AppError("Task not found", 404);

  if (task.status !== "COMPLETED") {
    throw new AppError("Only completed tasks can be archived", 400);
  }

  await db
    .update(tasks)
    .set({ deleted: true, deletedAt: new Date() })
    .where(eq(tasks.id, id));

  return { message: "Task deleted successfully" };
};

export const getTasks = async (query: Record<string, any>, currentUser: { role: string; userId: number }) => {
  const { id, status, priority, search, projectId, assignedUserId, page = 1, limit = 10, sortBy = "id", order = "asc", showDeleted = false } = query;

  const filters = [eq(tasks.deleted, showDeleted)];

  if (id) filters.push(eq(tasks.id, Number(id)));
  if (status) filters.push(eq(tasks.status, status));
  if (priority) filters.push(eq(tasks.priority, priority));
  if (projectId) filters.push(eq(tasks.projectId, Number(projectId)));

  // 🔍 Search title or description
  if (search) {
    filters.push(ilike(tasks.title, `%${search}%`)); 
  }

  // 🔐 Role Base Filter
  if (currentUser.role === "DEVELOPER") {
    // Developers only see tasks assigned to them
    const userAssignments = await db
      .select({ taskId: taskAssignments.taskId })
      .from(taskAssignments)
      .where(eq(taskAssignments.userId, currentUser.userId));
    
    const taskIds = userAssignments.map(a => a.taskId);
    if (taskIds.length === 0) return { data: [], totalRecords: 0 };
    filters.push(inArray(tasks.id, taskIds));
  } else if (assignedUserId) {
    // Admins can filter by a specific developer
    const userAssignments = await db
      .select({ taskId: taskAssignments.taskId })
      .from(taskAssignments)
      .where(eq(taskAssignments.userId, Number(assignedUserId)));
    
    const taskIds = userAssignments.map(a => a.taskId);
    if (taskIds.length === 0) return { data: [], totalRecords: 0 };
    filters.push(inArray(tasks.id, taskIds));
  }

  const whereCondition = filters.length > 0 ? and(...filters) : undefined;
  const offset = (page - 1) * limit;

  // 📋 Column Mapping for Sorting
  const columnMap: Record<string, any> = {
    id: tasks.id,
    title: tasks.title,
    status: tasks.status,
    priority: tasks.priority,
    dueDate: tasks.dueDate,
    createdAt: tasks.createdAt
  };

  const orderColumn = columnMap[sortBy] || tasks.id;
  const orderDirection = order === "desc" ? desc(orderColumn) : asc(orderColumn);

  const data = await db
    .select()
    .from(tasks)
    .where(whereCondition)
    .orderBy(orderDirection)
    .limit(limit)
    .offset(offset);

  // Attach assignees to each task
  const dataWithAssignees = await Promise.all(data.map(async (task) => {
    const assignments = await db
      .select({ userId: taskAssignments.userId })
      .from(taskAssignments)
      .where(eq(taskAssignments.taskId, task.id));
    return { ...task, assignedUserIds: assignments.map(a => a.userId) };
  }));

  const totalResult = await db
    .select({ count: tasks.id })
    .from(tasks)
    .where(whereCondition);

  return { data: dataWithAssignees, totalRecords: totalResult.length };
};
