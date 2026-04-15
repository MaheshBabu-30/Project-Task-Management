import { object, optional, number, boolean, pipe, minValue, maxValue } from "valibot";

export const notificationQuerySchema = object({
  page: optional(pipe(number(), minValue(1, "Page must be >= 1"), maxValue(10000, "Page must be <= 10000"))),
  limit: optional(pipe(number(), minValue(1, "Limit must be >= 1"), maxValue(100, "Limit must be <= 100"))),
  unread: optional(boolean()),
});
