import cron from "node-cron";
import { markOverdueTasks } from "./mark-overdue.job.js";
import { notifyDueSoonTasks } from "./notify-due-soon.job.js";

/**
 * Starts all background cron jobs.
 * Call this once from server.ts on startup.
 */
export const startScheduler = () => {
  // Mark overdue tasks — runs every hour at minute 0
  cron.schedule("0 * * * *", async () => {
    console.log("[scheduler] Running mark-overdue job...");
    try {
      const count = await markOverdueTasks();
      console.log(`[scheduler] mark-overdue done. ${count} task(s) updated.`);
    } catch (err) {
      console.error("[scheduler] mark-overdue job failed:", err);
    }
  });

  // Notify users of tasks due tomorrow — runs every day at 08:00
  cron.schedule("0 8 * * *", async () => {
    console.log("[scheduler] Running notify-due-soon job...");
    try {
      const count = await notifyDueSoonTasks();
      console.log(`[scheduler] notify-due-soon done. ${count} notification(s) sent.`);
    } catch (err) {
      console.error("[scheduler] notify-due-soon job failed:", err);
    }
  });

  console.log("[scheduler] All cron jobs scheduled.");
};
