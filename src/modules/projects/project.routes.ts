import { Hono } from "hono";
import { create, list } from "./project.controller.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { roleMiddleware } from "../../middlewares/role.middleware.js";

const router = new Hono();

router.use(authMiddleware);
router.use(roleMiddleware(["ADMIN"]));

router.post("/", create);
router.get("/", list);

export default router;
