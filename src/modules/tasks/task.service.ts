import { db } from "../../config/db.js";
import { tasks, projects } from "../../../drizzle/schema.js";
import { eq, and, ilike, asc, desc } from "drizzle-orm";
import { AppError } from "../../utils/errors.js";

export const createTask = async (data: typeof tasks.$inferInsert) => {
  const [task] = await db.insert(tasks).values(data).returning();
  return task;
};

/**
 * GET TASK BY ID
 * Used for ownership & authorization checks
 */
export const getTaskById = async (id: number) => {
  const result = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, id))
    .limit(1);

  return result[0]; // undefined if not found
};



/**
 * UPDATE TASK
 * Authorization handled in controller
 */

export const updateTask = async (id: number, data: Partial<typeof tasks.$inferInsert>) => {
  const [updated] = await db
    .update(tasks)
    .set(data)
    .where(eq(tasks.id, id))
    .returning();

  if (!updated) {
    throw new AppError("Task not found", 404);
  }

  return updated;
};

export const getTasks = async (query: Record<string, any>, currentUser: { role: string; userId: number }) => {
  const { id, status, projectId, assignedTo, page = 1, limit = 10, sortBy = "id", order = "asc" } = query;

  const filters = [];

  if (id) filters.push(eq(tasks.id, Number(id)));
  if (status) filters.push(eq(tasks.status, status));
  if (projectId) filters.push(eq(tasks.projectId, Number(projectId)));
  if (assignedTo) filters.push(eq(tasks.assignedTo, Number(assignedTo)));

  // 🔐 Developer can only see their tasks
  if (currentUser.role === "DEVELOPER") {
    filters.push(eq(tasks.assignedTo, currentUser.userId));
  }

  const whereCondition = filters.length ? and(...filters) : undefined;

  const offset = (page - 1) * limit;

  const orderColumn = (tasks as any)[sortBy] || tasks.id;
  const orderDirection =
    order === "desc" ? desc(orderColumn) : asc(orderColumn);

  const data = await db.select().from(tasks).where(whereCondition).orderBy(orderDirection)
    .limit(limit)
    .offset(offset);

  const totalResult = await db
    .select()
    .from(tasks)
    .where(whereCondition);

  const totalRecords = totalResult.length;

  return { data, totalRecords };
};
