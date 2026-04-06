import { Hono } from "hono";
import { createNewProject, getProjectsList, updateProjectDetails, deleteProjectRecord, getProjectDetails, getDeletedProjectsList } from "./project.controller.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { roleMiddleware } from "../../middlewares/role.middleware.js";

const router = new Hono();

router.use(authMiddleware);

router.post("/", roleMiddleware(["ADMIN"]), createNewProject);
router.get("/", getProjectsList);
router.get("/deleted", roleMiddleware(["ADMIN"]), getDeletedProjectsList);
router.get("/:id", getProjectDetails);
router.put("/:id", roleMiddleware(["ADMIN"]), updateProjectDetails);
router.delete("/:id", roleMiddleware(["ADMIN"]), deleteProjectRecord);

export default router;
