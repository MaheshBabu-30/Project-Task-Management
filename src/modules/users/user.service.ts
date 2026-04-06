import { db } from "../../config/db.js";
import { users } from "../../../drizzle/schema.js";
import { eq, ilike, and, asc, desc } from "drizzle-orm";

export const getUsers = async (query: Record<string, any>) => {
  const { id, name, email, role, page = 1, limit = 10, sortBy = "id", order = "asc"} = query;

  const filters = [];

  if (id) filters.push(eq(users.id, Number(id)));
  if (name) filters.push(ilike(users.name, `%${name}%`));
  if (email) filters.push(ilike(users.email, `%${email}%`));
  if (role) filters.push(eq(users.role, role));

  const whereCondition = filters.length > 0 ? and(...filters) : undefined;

  const offset = (page - 1) * limit;

  const orderColumn = (users as any)[sortBy] || users.id;
  const orderDirection = order === "desc" ? desc(orderColumn) : asc(orderColumn);

  const data = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
      createdAt: users.createdAt
    })
    .from(users)
    .where(whereCondition)
    .orderBy(orderDirection)
    .limit(limit)
    .offset(offset);

  const totalResult = await db.select({ id: users.id }).from(users).where(whereCondition);

  return { data, totalRecords: totalResult.length };
};

export const updateUserStatus = async (id: number, isActive: boolean) => {
  const [updated] = await db
    .update(users)
    .set({ isActive })
    .where(eq(users.id, id))
    .returning({
      id: users.id,
      name: users.name,
      isActive: users.isActive
    });
  
  return updated;
};
