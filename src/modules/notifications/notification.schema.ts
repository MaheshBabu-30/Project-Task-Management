import { object, optional, number, boolean, pipe, minValue, maxValue } from "valibot";

export const notificationQuerySchema = object({
  page: optional(pipe(number(), minValue(1))),
  limit: optional(pipe(number(), minValue(1), maxValue(100))),
  unread: optional(boolean()),
});
