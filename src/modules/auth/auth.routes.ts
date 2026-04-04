import { Hono } from "hono";
import { register, login, refresh, requestOtpVerify, otpVerify, logout } from "./auth.controller.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";

const router = new Hono();

router.post("/register", register);
router.post("/login", login);
router.post("/refresh", refresh);
router.post("/request-otp", requestOtpVerify);
router.post("/verify-otp", otpVerify);
router.post("/logout", authMiddleware, logout);




export default router;
