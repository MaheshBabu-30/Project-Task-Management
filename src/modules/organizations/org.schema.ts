import { object, string, pipe, regex, minLength, email } from "valibot";

// Create a new organization (SUPERADMIN only)
export const createOrgSchema = object({
  name: pipe(string(), minLength(2, "Organization name must be at least 2 characters")),
  // slug must be lowercase alphanumeric with hyphens only e.g. "my-org-123"
  slug: pipe(
    string(),
    minLength(2, "Slug must be at least 2 characters"),
    regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase alphanumeric with hyphens only (e.g. my-org)")
  ),
});

// Assign admin or add developer — just needs a userId (UUID)
export const addMemberSchema = object({
  userId: string("userId is required"),
});

export const registerAdminSchema = object({
  name: pipe(string(), minLength(2, "Name must be at least 2 characters")),
  email: pipe(string(), email("Invalid email address")),
  password: pipe(string(), minLength(6, "Password must be at least 6 characters")),
});

export const registerDeveloperSchema = object({
  name: pipe(string(), minLength(2, "Name must be at least 2 characters")),
  email: pipe(string(), email("Invalid email address")),
  password: pipe(string(), minLength(6, "Password must be at least 6 characters")),
});
