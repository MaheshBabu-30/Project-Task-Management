import { Hono } from "hono";
import { createNewProject, getProjectsList, getProjectDetails, updateProjectDetails, deleteProjectRecord } from "./project.controller.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { roleMiddleware } from "../../middlewares/role.middleware.js";

const router = new Hono();

router.use(authMiddleware);

router.get("/", getProjectsList);
router.get("/:id", getProjectDetails);

router.post("/", roleMiddleware(["admin", "superadmin"]), createNewProject);
router.patch("/:id", roleMiddleware(["admin", "superadmin"]), updateProjectDetails);
router.delete("/:id", roleMiddleware(["admin", "superadmin"]), deleteProjectRecord);

export default router;
