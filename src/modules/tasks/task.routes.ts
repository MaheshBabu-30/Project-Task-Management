import { Hono } from "hono";
import { create, update, list, remove } from "./task.controller.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";

const router = new Hono();

router.use(authMiddleware);

router.post("/", create);
router.put("/:id", update);
router.delete("/:id", remove);
router.get("/", list);

export default router;
