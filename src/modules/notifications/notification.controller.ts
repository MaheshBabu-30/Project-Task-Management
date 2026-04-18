import { parse } from "valibot";
import type { AppContext } from "../../types/hono.types.js";
import { notificationQuerySchema } from "./notification.schema.js";
import { uuidSchema } from "../../helpers/validators.js";
import { getNotifications, markNotificationRead, markAllNotificationsRead } from "./notification.service.js";
import { successResponse } from "../../utils/response.js";
import { buildPagination } from "../../helpers/pagination.js";

export const listNotifications = async (c: AppContext) => {
  const user = c.get("user");
  const rawQuery = c.req.query();

  const query = parse(notificationQuerySchema, {
    ...rawQuery,
    page: rawQuery.page ? Number(rawQuery.page) : 1,
    limit: rawQuery.limit ? Number(rawQuery.limit) : 20,
    unread: rawQuery.unread === "true" ? true : rawQuery.unread === "false" ? false : undefined,
    type: rawQuery.type,
    order: rawQuery.order,
  });

  const { data, totalRecords } = await getNotifications(user.userId, query);

  const pagination = buildPagination({
    page: query.page as number,
    limit: query.limit as number,
    totalRecords,
  });

  return successResponse(c, { notifications: data, pagination });
};

export const markOneRead = async (c: AppContext) => {
  const user = c.get("user");
  const id = parse(uuidSchema("Notification ID"), c.req.param("id"));

  const result = await markNotificationRead(id, user.userId);
  return successResponse(c, result);
};

export const markAllRead = async (c: AppContext) => {
  const user = c.get("user");
  const result = await markAllNotificationsRead(user.userId);
  return successResponse(c, result);
};
