import { db } from "../../config/db.js";
import { notifications } from "../../../drizzle/schema.js";
import { eq, and, isNull, desc, count } from "drizzle-orm";
import { AppError } from "../../utils/errors.js";

// ─── Create Notification (internal helper) ────────────────────────────────────

export const createNotification = async (data: {
  userId: string;
  type: "task_assigned" | "task_due_soon" | "task_overdue" | "task_completed" | "comment_added" | "member_removed";
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
}) => {
  const [notification] = await db.insert(notifications).values(data).returning();
  return notification;
};

// ─── List Notifications for Current User ─────────────────────────────────────

export const getNotifications = async (
  userId: string,
  query: { page?: number; limit?: number; unread?: boolean }
) => {
  const { page = 1, limit = 20, unread } = query;
  const offset = (page - 1) * limit;

  const filters = [eq(notifications.userId, userId)];
  if (unread === true) filters.push(isNull(notifications.readAt));

  const whereCondition = and(...filters);

  const [data, countResult] = await Promise.all([
    db
      .select()
      .from(notifications)
      .where(whereCondition)
      .orderBy(desc(notifications.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(notifications).where(whereCondition),
  ]);

  return { data, totalRecords: countResult[0]?.total ?? 0 };
};

// ─── Mark One as Read ─────────────────────────────────────────────────────────

export const markNotificationRead = async (notificationId: string, userId: string) => {
  const [notification] = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)));

  if (!notification) throw new AppError("Notification not found", 404);
  if (notification.readAt) return notification; // already read

  const [updated] = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(eq(notifications.id, notificationId))
    .returning();

  return updated;
};

// ─── Mark All as Read ─────────────────────────────────────────────────────────

export const markAllNotificationsRead = async (userId: string) => {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));

  return { message: "All notifications marked as read" };
};
