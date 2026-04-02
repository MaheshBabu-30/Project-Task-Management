import { Hono } from "hono";
import { listUsers } from "./user.controller.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { roleMiddleware } from "../../middlewares/role.middleware.js";

const router = new Hono();

router.use(authMiddleware);
router.use(roleMiddleware(["ADMIN"]));

router.get("/", listUsers);

export default router;
