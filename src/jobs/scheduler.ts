import cron from "node-cron";
import { markOverdueTasks } from "./mark-overdue.job.js";
import { notifyDueSoonTasks } from "./notify-due-soon.job.js";
import { logger } from "../utils/logger.js";

export const startScheduler = () => {
  cron.schedule("0 * * * *", async () => {
    logger.info("Running mark-overdue job", "scheduler");
    try {
      const count = await markOverdueTasks();
      logger.info(`mark-overdue done — ${count} task(s) updated`, "scheduler");
    } catch (err) {
      logger.error("mark-overdue job failed", err, "scheduler");
    }
  });

  cron.schedule("0 8 * * *", async () => {
    logger.info("Running notify-due-soon job", "scheduler");
    try {
      const count = await notifyDueSoonTasks();
      logger.info(`notify-due-soon done — ${count} notification(s) sent`, "scheduler");
    } catch (err) {
      logger.error("notify-due-soon job failed", err, "scheduler");
    }
  });

  logger.info("All cron jobs scheduled", "scheduler");
};
