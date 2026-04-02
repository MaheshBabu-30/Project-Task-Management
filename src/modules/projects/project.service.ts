import { db } from "../../config/db.js";
import { projects } from "../../../drizzle/schema.js";
import { eq, ilike, and, asc, desc } from "drizzle-orm";

export const createProject = async ({ name, description, createdBy }: typeof projects.$inferInsert) => {
  const [newProject] = await db.insert(projects).values({name, description, createdBy })
    .returning();

  return newProject;
};

export const getProjects = async (query: Record<string, any>) => {
  const {id, name, createdBy, page = 1, limit = 10, sortBy = "id", order = "asc"} = query;

  const filters = [];

  if (id) filters.push(eq(projects.id, Number(id)));
  if (name) filters.push(ilike(projects.name, `%${name}%`));
  if (createdBy) filters.push(eq(projects.createdBy, Number(createdBy)));

  const whereCondition = filters.length ? and(...filters) : undefined;

  const offset = (page - 1) * limit;

  const orderColumn = (projects as any)[sortBy] || projects.id;
  const orderDirection =
    order === "desc" ? desc(orderColumn) : asc(orderColumn);

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

  const totalRecords = totalResult.length;

  return { data, totalRecords };
};
