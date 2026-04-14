import app from "./app.js";
import { serve } from "@hono/node-server";
import { env } from "./config/env.js";
import { startScheduler } from "./jobs/scheduler.js";

serve({fetch: app.fetch, port: Number(env.PORT) || 3000 });

console.log(`Server running on port ${env.PORT}`);

startScheduler();
