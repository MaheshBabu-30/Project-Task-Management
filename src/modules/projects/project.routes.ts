import { Hono } from "hono";
import { createNewProject, getProjectsList, getProjectDetails, updateProjectDetails, deleteProjectRecord } from "./project.controller.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { roleMiddleware } from "../../middlewares/role.middleware.js";
import type { AppEnv } from "../../types/hono.types.js";

const router = new Hono<AppEnv>();

router.use(authMiddleware);

router.get("/", getProjectsList);
router.get("/:id", getProjectDetails);

router.post("/", roleMiddleware(["admin"]), createNewProject);
router.patch("/:id", roleMiddleware(["admin"]), updateProjectDetails);
router.delete("/:id", roleMiddleware(["admin"]), deleteProjectRecord);

export default router;
