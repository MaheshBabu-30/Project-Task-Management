import { object, string, optional, number, minValue, maxValue, pipe, picklist, uuid, email, minLength, maxLength, nonEmpty, regex } from "valibot";

// For creating a new user (superadmin creates admin/developer, admin creates developer only)
export const createUserSchema = object({
  name: pipe(string(), nonEmpty("Name is required"), minLength(2, "Name must be at least 2 characters"), maxLength(150, "Name must be at most 150 characters")),
  email: pipe(string(), nonEmpty("Email is required"), email("Invalid email address")),
  password: pipe(string(), nonEmpty("Password is required"), minLength(8, "Password must be at least 8 characters"), maxLength(100, "Password too long")),
  role: picklist(["admin", "developer"] as const, "Role must be admin or developer"),
});

// For updating a user's basic info
export const updateUserSchema = object({
  name: optional(pipe(string(), nonEmpty("Name cannot be empty"), minLength(2, "Name must be at least 2 characters"), maxLength(150, "Name must be at most 150 characters"))),
  phone: optional(pipe(string(), nonEmpty("Phone cannot be empty"), minLength(7, "Phone must be at least 7 characters"), maxLength(20, "Phone must be at most 20 characters"), regex(/^\+?[0-9\s\-().]+$/, "Phone number contains invalid characters"))),
  avatarUrl: optional(pipe(string(), nonEmpty("Avatar URL cannot be empty"), maxLength(500, "URL too long"))),
});

// For an admin toggling a developer's status
export const toggleUserStatusSchema = object({
  status: picklist(["active", "inactive"] as const, "Status must be active or inactive"),
});

// For searching/filtering users
export const userQuerySchema = object({
  id: optional(pipe(string(), uuid())),
  name: optional(pipe(string(), maxLength(150, "Name filter must be at most 150 characters"))),
  email: optional(pipe(string(), email("Invalid email format"), maxLength(254, "Email filter must be at most 254 characters"))),
  role: optional(picklist(["superadmin", "admin", "developer"] as const)),
  status: optional(picklist(["active", "inactive"] as const)),
  orgId: optional(pipe(string(), uuid())),
  page: optional(pipe(number(), minValue(1, "Page must be >= 1"), maxValue(10000, "Page must be <= 10000"))),
  limit: optional(pipe(number(), minValue(1, "Limit must be >= 1"), maxValue(100, "Limit must be <= 100"))),
  sortBy: optional(picklist(["name", "email", "role", "status", "createdAt"] as const)),
  order: optional(picklist(["asc", "desc"] as const)),
});
