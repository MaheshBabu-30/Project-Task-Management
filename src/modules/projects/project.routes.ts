import { Hono } from "hono";
import { create, list, update, remove, getById } from "./project.controller.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { roleMiddleware } from "../../middlewares/role.middleware.js";

const router = new Hono();

router.use(authMiddleware);

router.post("/", roleMiddleware(["ADMIN"]), create);
router.get("/", list);
router.get("/:id", getById);
router.put("/:id", roleMiddleware(["ADMIN"]), update);
router.delete("/:id", roleMiddleware(["ADMIN"]), remove);

export default router;
