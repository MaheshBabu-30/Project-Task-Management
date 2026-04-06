import { Hono } from "hono";
import { createNewTask, updateTaskDetails, getTasksList, deleteTaskRecord, getDeletedTasksList } from "./task.controller.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { roleMiddleware } from "../../middlewares/role.middleware.js";

const router = new Hono();

router.use(authMiddleware);

router.post("/", createNewTask);
router.get("/", getTasksList);
router.get("/deleted", roleMiddleware(["ADMIN"]), getDeletedTasksList);
router.put("/:id", updateTaskDetails);
router.delete("/:id", deleteTaskRecord);

export default router;
