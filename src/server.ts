import app from "./app.js";
import { serve } from "@hono/node-server";
import { env } from "./config/env.js";
import { startScheduler } from "./jobs/scheduler.js";
import { logger } from "./utils/logger.js";

process.on("uncaughtException", (err) => {
  logger.error("[uncaughtException]", err, "process");
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.error("[unhandledRejection]", reason, "process");
  process.exit(1);
});

serve({ fetch: app.fetch, port: Number(env.PORT) || 3000, hostname: "0.0.0.0" }, (info) => {
  logger.info(`Server running on ${info.address}:${info.port}`, "server");
});

startScheduler();
