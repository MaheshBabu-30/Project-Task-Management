import { db } from "../../config/db.js";
import { projects, tasks, taskAssignments } from "../../../drizzle/schema.js";
import { eq, ilike, and, asc, desc, inArray, notInArray } from "drizzle-orm";
import { AppError } from "../../utils/errors.js";

export const createProject = async ({ name, description, createdBy }: typeof projects.$inferInsert) => {
  const [newProject] = await db.insert(projects).values({ name, description, createdBy })
    .returning();
  return newProject;
};

export const getProjects = async (query: Record<string, any>, user?: { userId: number; role: string }) => {
  const { id, name, createdBy, page = 1, limit = 10, sortBy = "id", order = "asc", showDeleted = false } = query;

  const filters = [eq(projects.deleted, showDeleted)];

  if (id) filters.push(eq(projects.id, Number(id)));
  if (name) filters.push(ilike(projects.name, `%${name}%`));
  if (createdBy) filters.push(eq(projects.createdBy, Number(createdBy)));

  if (user && user.role === "DEVELOPER") {
    // Developers see only projects where they have assigned tasks
    const userTasks = await db
      .select({ projectId: tasks.projectId })
      .from(taskAssignments)
      .innerJoin(tasks, eq(taskAssignments.taskId, tasks.id))
      .where(eq(taskAssignments.userId, user.userId));
    
    const projectIds = userTasks.map(t => t.projectId).filter((id): id is number => id !== null);
    if (projectIds.length === 0) return { data: [], totalRecords: 0 };
    filters.push(inArray(projects.id, projectIds));
  }

  const whereCondition = filters.length > 0 ? and(...filters) : undefined;
  const offset = (page - 1) * limit;

  // 📋 Column Mapping for Sorting
  const columnMap: Record<string, any> = {
    id: projects.id,
    name: projects.name,
    createdBy: projects.createdBy,
    createdAt: projects.createdAt
  };

  const orderColumn = columnMap[sortBy] || projects.id;
  const orderDirection = order === "desc" ? desc(orderColumn) : asc(orderColumn);

  const data = await db
    .select()
    .from(projects)
    .where(whereCondition)
    .orderBy(orderDirection)
    .limit(limit)
    .offset(offset);

  const totalResult = await db
    .select({ id: projects.id })
    .from(projects)
    .where(whereCondition);

  return { data, totalRecords: totalResult.length };
};

export const getProjectById = async (id: number, includeTasks: boolean = false) => {
  const [project] = await db.select().from(projects).where(and(eq(projects.id, id), eq(projects.deleted, false)));
  if (!project) return null;

  if (includeTasks) {
    const projectTasks = await db.select().from(tasks).where(and(eq(tasks.projectId, id), eq(tasks.deleted, false)));
    return { ...project, tasks: projectTasks };
  }
  return project;
};

export const updateProject = async (id: number, data: Partial<typeof projects.$inferInsert>) => {
  const [updated] = await db.update(projects).set(data).where(eq(projects.id, id)).returning();
  return updated;
};

export const deleteProject = async (id: number) => {
  const [project] = await db.select().from(projects).where(eq(projects.id, id));
  if (!project) throw new AppError("Project not found", 404);

  // 🔎 Guard check: All tasks must be COMPLETED
  const pendingTasks = await db
    .select()
    .from(tasks)
    .where(and(
      eq(tasks.projectId, id),
      eq(tasks.deleted, false),
      notInArray(tasks.status, ["COMPLETED"])
    ));

  if (pendingTasks.length > 0) {
    throw new AppError(`Cannot delete project. There are still ${pendingTasks.length} pending tasks.`, 400);
  }

  await db.transaction(async (tx) => {
    // Soft delete the project
    await tx.update(projects).set({ deleted: true, deletedAt: new Date() }).where(eq(projects.id, id));
    // Soft delete its tasks as well
    await tx.update(tasks).set({ deleted: true, deletedAt: new Date() }).where(eq(tasks.projectId, id));
  });

  return { message: "Project and all its tasks deleted successfully" };
};
