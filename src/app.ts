import { Hono } from "hono";
import authRoutes from "./modules/auth/auth.routes.js";
import { errorHandler } from "./middlewares/error.middleware.js";
import userRoutes from "./modules/users/user.routes.js";
import projectRoutes from "./modules/projects/project.routes.js";
import taskRoutes from "./modules/tasks/task.routes.js";

const app = new Hono();

app.get("/health", (c) => c.json({ status: "OK" }));

app.route("/api/auth", authRoutes);
app.route("/api/users", userRoutes);
app.route("/api/projects", projectRoutes);
app.route("/api/tasks", taskRoutes);


app.onError(errorHandler);

export default app;
