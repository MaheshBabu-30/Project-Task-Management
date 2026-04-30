import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import authRoutes from "./modules/auth/auth.routes.js";
import { errorHandler } from "./middlewares/error.middleware.js";
import userRoutes from "./modules/users/user.routes.js";
import projectRoutes from "./modules/projects/project.routes.js";
import taskRoutes from "./modules/tasks/task.routes.js";
import orgRoutes from "./modules/organizations/org.routes.js";
import uploadRoutes from "./modules/uploads/upload.routes.js";
import commentRoutes from "./modules/comments/comment.routes.js";
import attachmentRoutes from "./modules/attachments/attachment.routes.js";
import notificationRoutes from "./modules/notifications/notification.routes.js";
import auditLogRoutes from "./modules/audit-logs/audit-log.routes.js";
import dataTransferRoutes from "./modules/data-transfer/data-transfer.routes.js";
import { env } from "./config/env.js";
import { logger } from "./utils/logger.js";
import type { AppEnv } from "./types/hono.types.js";

const app = new Hono<AppEnv>();

app.use("*", secureHeaders());

app.use("*", cors({
  origin: (origin) => {
    if (env.ALLOWED_ORIGINS === "*") return origin;
    const allowed = env.ALLOWED_ORIGINS.split(",").map(o => o.trim());
    return allowed.includes(origin) ? origin : null;
  },
  credentials: true,
  allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Authorization", "Content-Type"],
}));

app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  logger.info(`${c.req.method} ${c.req.path} ${c.res.status} ${Date.now() - start}ms`, "http");
});

app.get("/", (c) => c.json({ status: "OK", message: "Task Management API is running" }));
app.get("/health", (c) => c.json({ status: "OK" }));

app.route("/api/auth", authRoutes);
app.route("/api/users", userRoutes);
app.route("/api/projects", projectRoutes);
app.route("/api/tasks", taskRoutes);
app.route("/api/orgs", orgRoutes);
app.route("/api/uploads", uploadRoutes);
app.route("/api/notifications", notificationRoutes);
app.route("/api/audit-logs", auditLogRoutes);
app.route("/api", dataTransferRoutes);

// Task sub-resources
app.route("/api/tasks/:taskId/comments", commentRoutes);
app.route("/api/tasks/:taskId/attachments", attachmentRoutes);

app.onError(errorHandler);

export default app;
