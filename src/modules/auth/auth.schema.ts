import { object, string, email, minLength, maxLength, pipe, length } from "valibot";

export const loginSchema = object({
  email: pipe(string(), email("Invalid email address")),
  password: pipe(string(), minLength(8, "Password must be at least 8 characters")),
});

export const requestOtpSchema = object({
  email: pipe(string(), email("Invalid email address")),
});

export const verifyOtpSchema = object({
  email: pipe(string(), email("Invalid email address")),
  otp: pipe(string(), length(6, "OTP must be exactly 6 digits")),
});
