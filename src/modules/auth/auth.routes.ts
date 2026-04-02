import { Hono } from "hono";
import { register, login, refresh } from "./auth.controller.js";

const router = new Hono();

router.post("/register", register);
router.post("/login", login);
router.post("/refresh", refresh);




export default router;
