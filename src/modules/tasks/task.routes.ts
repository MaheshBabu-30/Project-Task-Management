import { Hono } from "hono";
import { createNewTask, updateTaskDetails, getTasksList, deleteTaskRecord, getTaskDetails } from "./task.controller.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { roleMiddleware } from "../../middlewares/role.middleware.js";

const router = new Hono();

router.use(authMiddleware);

router.get("/", getTasksList);
router.get("/:id", getTaskDetails);

router.post("/", roleMiddleware(["admin", "superadmin"]), createNewTask);
router.patch("/:id", roleMiddleware(["admin", "superadmin", "developer"]), updateTaskDetails);
router.delete("/:id", roleMiddleware(["admin", "superadmin"]), deleteTaskRecord);

export default router;
