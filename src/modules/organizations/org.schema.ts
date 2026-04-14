import { object, string, pipe, regex, minLength, maxLength, uuid } from "valibot";

// Create a new organization (SUPERADMIN only)
export const createOrgSchema = object({
  name: pipe(string(), minLength(2, "Organization name must be at least 2 characters"), maxLength(200, "Organization name must be at most 200 characters")),
  slug: pipe(
    string(),
    minLength(2, "Slug must be at least 2 characters"),
    maxLength(100, "Slug must be at most 100 characters"),
    regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase alphanumeric with hyphens only (e.g. my-org)")
  ),
});

// Assign admin or add developer — just needs a userId (UUID)
export const addMemberSchema = object({
  userId: pipe(string("userId is required"), uuid("Invalid user ID format")),
});
