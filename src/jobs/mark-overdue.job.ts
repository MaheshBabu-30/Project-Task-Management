import { db } from "../config/db.js";
import { tasks, taskAssignees } from "../db/schema/index.js";
import { and, isNull, lt, notInArray, inArray } from "drizzle-orm";
import { createNotification } from "../modules/notifications/notification.service.js";
import { logger, catchError } from "../utils/logger.js";

/**
 * Marks tasks as overdue if their due date has passed and they are not
 * completed or already overdue. on_hold tasks are included — if a paused
 * task crosses its due date it becomes overdue immediately.
 *
 * Run this on a cron schedule — e.g. every hour.
 * No user or admin can manually set status to "overdue" via API.
 */
export const markOverdueTasks = async () => {
  const now = new Date();
  const todayStr = now.toISOString().split("T")[0]!; // "YYYY-MM-DD"

  const result = await db
    .update(tasks)
    .set({ status: "overdue", updatedAt: now })
    .where(
      and(
        isNull(tasks.deletedAt),
        lt(tasks.dueDate, todayStr),
        notInArray(tasks.status, ["completed", "overdue"])
      )
    )
    .returning({ id: tasks.id, title: tasks.title });

  logger.info(`Marked ${result.length} task(s) as overdue`, "mark-overdue");

  // Notify assignees of each overdue task (fire-and-forget)
  if (result.length > 0) {
    const taskIds = result.map((t) => t.id);
    const taskTitleMap = Object.fromEntries(result.map((t) => [t.id, t.title]));

    db.select({ userId: taskAssignees.userId, taskId: taskAssignees.taskId })
      .from(taskAssignees)
      .where(inArray(taskAssignees.taskId, taskIds))
      .then((assignees) => {
        for (const assignee of assignees) {
          const title = taskTitleMap[assignee.taskId] ?? "a task";
          createNotification({
            userId: assignee.userId,
            type: "task_overdue",
            title: "Task is overdue",
            body: `"${title}" has passed its due date and is now overdue.`,
            entityType: "task",
            entityId: assignee.taskId,
          }).catch(catchError("mark-overdue:notify"));
        }
      })
      .catch(catchError("mark-overdue:assignees"));
  }

  return result.length;
};
