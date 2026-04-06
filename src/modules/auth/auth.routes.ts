import { Hono } from "hono";
import { registerUserAccount, loginUserAccount, refreshUserSession, requestLoginOtp, verifyLoginOtp, logoutUserAccount } from "./auth.controller.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";

const router = new Hono();

router.post("/register", registerUserAccount);
router.post("/login", loginUserAccount);
router.post("/refresh", refreshUserSession);
router.post("/request-otp", requestLoginOtp);
router.post("/verify-otp", verifyLoginOtp);
router.post("/logout", authMiddleware, logoutUserAccount);




export default router;
