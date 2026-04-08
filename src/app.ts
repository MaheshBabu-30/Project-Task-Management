import { Hono } from "hono";
import { cors } from "hono/cors";
import authRoutes from "./modules/auth/auth.routes.js";
import { errorHandler } from "./middlewares/error.middleware.js";
import userRoutes from "./modules/users/user.routes.js";
import projectRoutes from "./modules/projects/project.routes.js";
import taskRoutes from "./modules/tasks/task.routes.js";

import orgRoutes from "./modules/organizations/org.routes.js";
import uploadRoutes from "./modules/uploads/upload.routes.js";

const app = new Hono();

app.use("*", cors());

app.get("/health", (c) => c.json({ status: "OK" }));

app.route("/api/auth", authRoutes);
app.route("/api/users", userRoutes);
app.route("/api/projects", projectRoutes);
app.route("/api/tasks", taskRoutes);
app.route("/api/orgs", orgRoutes);
app.route("/api/uploads", uploadRoutes);


app.onError(errorHandler);

export default app;
