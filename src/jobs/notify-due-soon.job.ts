import { db } from "../config/db.js";
import { tasks, taskAssignees } from "../../drizzle/schema.js";
import { and, isNull, eq, inArray, notInArray } from "drizzle-orm";
import { createNotification } from "../modules/notifications/notification.service.js";

/**
 * Notifies assignees of tasks that are due within the next 24 hours.
 * Run this on a cron schedule — e.g. every hour.
 */
export const notifyDueSoonTasks = async () => {
  const now = new Date();

  // Tomorrow's date string "YYYY-MM-DD"
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split("T")[0]!;

  // Find tasks due exactly tomorrow (not yet overdue, not completed or on_hold)
  const dueSoonTasks = await db
    .select({ id: tasks.id, title: tasks.title })
    .from(tasks)
    .where(
      and(
        isNull(tasks.deletedAt),
        eq(tasks.dueDate, tomorrowStr),
        notInArray(tasks.status, ["completed", "overdue", "on_hold"])
      )
    );

  if (dueSoonTasks.length === 0) {
    console.log("[notify-due-soon] No tasks due tomorrow.");
    return 0;
  }

  console.log(`[notify-due-soon] ${dueSoonTasks.length} task(s) due tomorrow.`);

  const taskIds = dueSoonTasks.map((t) => t.id);
  const taskTitleMap = Object.fromEntries(dueSoonTasks.map((t) => [t.id, t.title]));

  // Get all assignees for these tasks
  const assignees = await db
    .select({ userId: taskAssignees.userId, taskId: taskAssignees.taskId })
    .from(taskAssignees)
    .where(inArray(taskAssignees.taskId, taskIds));

  // Notify each assignee (fire-and-forget)
  for (const assignee of assignees) {
    const title = taskTitleMap[assignee.taskId] ?? "a task";
    createNotification({
      userId: assignee.userId,
      type: "task_overdue",
      title: "Task due tomorrow",
      body: `"${title}" is due tomorrow. Make sure to complete it on time.`,
      entityType: "task",
      entityId: assignee.taskId,
    }).catch(console.error);
  }

  return assignees.length;
};
