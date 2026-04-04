import { object, string, email, minLength, pipe } from "valibot";

export const registerSchema = object({
  name: pipe(string(), minLength(2, "Name must be at least 2 characters")),
  email: pipe(string(), email("Invalid email address")),
  password: pipe(string(), minLength(6, "Password must be at least 6 characters")),
  role: string()
});

export const loginSchema = object({
  email: pipe(string(), email("Invalid email address")),
  password: pipe(string(), minLength(6, "Password must be at least 6 characters"))
});

export const requestOtpSchema = object({
  email: pipe(string(), email("Invalid email address"))
});

export const verifyOtpSchema = object({
  email: pipe(string(), email("Invalid email address")),
  otp: pipe(string(), minLength(6, "Code must be 6 digits"), minLength(6, "Code must be 6 digits")) // Changed to minLength twice to represent 6 digits
});
