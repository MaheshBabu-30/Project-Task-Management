import { Hono } from "hono";
import { loginUserAccount, refreshUserSession, requestLoginOtp, verifyLoginOtp, logoutUserAccount } from "./auth.controller.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { rateLimiter } from "../../middlewares/rate-limit.middleware.js";

const router = new Hono();

// 20 attempts per minute per IP for sensitive auth endpoints
const authRateLimit = rateLimiter({ windowMs: 60_000, max: 20, message: "Too many auth attempts. Please try again in a minute." });

router.post("/login", authRateLimit, loginUserAccount);
router.post("/refresh", authRateLimit, refreshUserSession);
router.post("/request-otp", authRateLimit, requestLoginOtp);
router.post("/verify-otp", authRateLimit, verifyLoginOtp);
router.post("/logout", authMiddleware, logoutUserAccount);




export default router;
