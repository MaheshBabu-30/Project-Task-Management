import { db } from "../../config/db.js";
import { projects, tasks } from "../../../drizzle/schema.js";
import { eq, ilike, and, asc, desc, inArray } from "drizzle-orm";

export const createProject = async ({ name, description, createdBy }: typeof projects.$inferInsert) => {
  const [newProject] = await db.insert(projects).values({ name, description, createdBy })
    .returning();
  return newProject;
};

export const getProjects = async (query: Record<string, any>, user?: { userId: number; role: string }) => {
  const { id, name, createdBy, page = 1, limit = 10, sortBy = "id", order = "asc" } = query;

  const filters = [];

  if (id) filters.push(eq(projects.id, Number(id)));
  if (name) filters.push(ilike(projects.name, `%${name}%`));
  if (createdBy) filters.push(eq(projects.createdBy, Number(createdBy)));

  if (user && user.role === "DEVELOPER") {
    const userTasks = await db
      .select({ projectId: tasks.projectId })
      .from(tasks)
      .where(eq(tasks.assignedTo, user.userId));
    
    const projectIds = userTasks.map(t => t.projectId).filter((id): id is number => id !== null);
    if (projectIds.length === 0) return { data: [], totalRecords: 0 };
    filters.push(inArray(projects.id, projectIds));
  }

  const whereCondition = filters.length ? and(...filters) : undefined;
  const offset = (page - 1) * limit;

  const orderColumn = (projects as any)[sortBy] || projects.id;
  const orderDirection = order === "desc" ? desc(orderColumn) : asc(orderColumn);

  const data = await db
    .select()
    .from(projects)
    .where(whereCondition)
    .orderBy(orderDirection)
    .limit(limit)
    .offset(offset);

  const totalResult = await db
    .select()
    .from(projects)
    .where(whereCondition);

  return { data, totalRecords: totalResult.length };
};

export const getProjectById = async (id: number, includeTasks: boolean = false) => {
  const [project] = await db.select().from(projects).where(eq(projects.id, id));
  if (!project) return null;

  if (includeTasks) {
    const projectTasks = await db.select().from(tasks).where(eq(tasks.projectId, id));
    return { ...project, tasks: projectTasks };
  }
  return project;
};

export const updateProject = async (id: number, data: Partial<typeof projects.$inferInsert>) => {
  const [updated] = await db.update(projects).set(data).where(eq(projects.id, id)).returning();
  return updated;
};

export const deleteProject = async (id: number) => {
  await db.delete(projects).where(eq(projects.id, id));
};
