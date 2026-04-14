import { parse } from "valibot";
import type { Context } from "hono";
import { notificationQuerySchema } from "./notification.schema.js";
import { uuidSchema } from "../../utils/schema.js";
import { getNotifications, markNotificationRead, markAllNotificationsRead } from "./notification.service.js";
import { successResponse } from "../../utils/response.js";

export const listNotifications = async (c: Context) => {
  const user = c.get("user");
  const rawQuery = c.req.query();

  const query = parse(notificationQuerySchema, {
    ...rawQuery,
    page: rawQuery.page ? Number(rawQuery.page) : 1,
    limit: rawQuery.limit ? Number(rawQuery.limit) : 20,
    unread: rawQuery.unread === "true" ? true : rawQuery.unread === "false" ? false : undefined,
  });

  const data = await getNotifications(user.userId, query);
  return successResponse(c, { notifications: data });
};

export const markOneRead = async (c: Context) => {
  const user = c.get("user");
  const id = parse(uuidSchema("Notification ID"), c.req.param("id"));

  const result = await markNotificationRead(id, user.userId);
  return successResponse(c, result);
};

export const markAllRead = async (c: Context) => {
  const user = c.get("user");
  const result = await markAllNotificationsRead(user.userId);
  return successResponse(c, result);
};
