import { object, string, email, minLength, pipe, length, nonEmpty } from "valibot";

export const loginSchema = object({
  email: pipe(string(), nonEmpty("Email is required"), email("Invalid email address")),
  password: pipe(string(), nonEmpty("Password is required"), minLength(8, "Password must be at least 8 characters")),
});

export const requestOtpSchema = object({
  email: pipe(string(), nonEmpty("Email is required"), email("Invalid email address")),
});

export const verifyOtpSchema = object({
  email: pipe(string(), nonEmpty("Email is required"), email("Invalid email address")),
  otp: pipe(string(), nonEmpty("OTP is required"), length(6, "OTP must be exactly 6 digits")),
});
