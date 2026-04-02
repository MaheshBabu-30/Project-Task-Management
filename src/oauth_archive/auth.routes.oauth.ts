import { Hono } from "hono";
import { googleAuth, googleCallback } from "./auth.controller.oauth.js";

const router = new Hono();

router.get("/", googleAuth);
router.get("/callback", googleCallback);

export default router;
