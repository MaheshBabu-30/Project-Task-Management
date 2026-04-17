import app from "./app.js";
import { serve } from "@hono/node-server";
import { env } from "./config/env.js";
import { startScheduler } from "./jobs/scheduler.js";

process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
  process.exit(1);
});

serve({ fetch: app.fetch, port: Number(env.PORT) || 3000, hostname: "0.0.0.0" });

console.log(`Server running on port ${env.PORT}`);

startScheduler();
