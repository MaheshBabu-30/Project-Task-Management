import { db } from "../../config/db.js";
import { notifications } from "../../db/schema.js";
import { eq, and, isNull, asc, desc, count } from "drizzle-orm";
import { NotFoundException } from "../../exceptions/index.js";
import type { NotificationType } from "../../constants/notification.constants.js";
import type { PaginationQuery } from "../../types/common.types.js";

interface NotificationQuery extends PaginationQuery {
  unread?: boolean;
  type?: NotificationType;
}

// ─── Create Notification (internal helper) ────────────────────────────────────

export const createNotification = async (data: {
  userId: string;
  type: NotificationType;
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
  query: NotificationQuery
) => {
  const { page = 1, limit = 20, unread, type, order = "desc" } = query;
  const offset = (page - 1) * limit;

  const filters = [eq(notifications.userId, userId)];
  if (unread === true) filters.push(isNull(notifications.readAt));
  if (type) filters.push(eq(notifications.type, type));

  const whereCondition = and(...filters);
  const orderDirection = order === "asc" ? asc(notifications.createdAt) : desc(notifications.createdAt);

  const [data, countResult, unreadResult] = await Promise.all([
    db
      .select()
      .from(notifications)
      .where(whereCondition)
      .orderBy(orderDirection)
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(notifications).where(whereCondition),
    db.select({ total: count() }).from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt))),
  ]);

  return { data, totalRecords: countResult[0]?.total ?? 0, unreadCount: unreadResult[0]?.total ?? 0 };
};

// ─── Mark One as Read ─────────────────────────────────────────────────────────

export const markNotificationRead = async (notificationId: string, userId: string) => {
  const [notification] = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)));

  if (!notification) throw new NotFoundException("Notification not found");
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
