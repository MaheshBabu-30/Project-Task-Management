import { object, string, optional, number, pipe, regex, minLength, maxLength, uuid, nonEmpty, picklist, minValue, maxValue } from "valibot";

// Create a new organization (SUPERADMIN only)
export const createOrgSchema = object({
  name: pipe(string(), nonEmpty("Organization name is required"), minLength(2, "Organization name must be at least 2 characters"), maxLength(200, "Organization name must be at most 200 characters")),
  slug: pipe(
    string(),
    nonEmpty("Slug is required"),
    minLength(2, "Slug must be at least 2 characters"),
    maxLength(100, "Slug must be at most 100 characters"),
    regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase alphanumeric with hyphens only (e.g. my-org)")
  ),
});

// Assign admin or add developer — just needs a userId (UUID)
export const addMemberSchema = object({
  userId: pipe(string(), nonEmpty("userId is required"), uuid("Invalid user ID format")),
});

export const orgQuerySchema = object({
  page: optional(pipe(number(), minValue(1, "Page must be >= 1"), maxValue(500, "Page must be <= 500"))),
  limit: optional(pipe(number(), minValue(1, "Limit must be >= 1"), maxValue(100, "Limit must be <= 100"))),
  name: optional(pipe(string(), minLength(1), maxLength(200))),
  slug: optional(pipe(string(), minLength(1), maxLength(100))),
  sortBy: optional(picklist(["id", "name", "slug", "createdAt"] as const)),
  order: optional(picklist(["asc", "desc"] as const)),
});
