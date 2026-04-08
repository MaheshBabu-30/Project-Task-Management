import { parse } from "valibot";
import type { Context } from "hono";
import { createOrgSchema, addMemberSchema, registerAdminSchema, registerDeveloperSchema } from "./org.schema.js";
import {
  createOrganization,
  getAllOrganizations,
  getOrganizationById,
  assignAdminToOrg,
  addDeveloperToOrg,
  removeMemberFromOrg,
  registerAdminForOrg,
  registerDeveloperForOrg,
} from "./org.service.js";
import { successResponse } from "../../utils/response.js";

// ─── Create Organization (SUPERADMIN only) ────────────────────────────────────

export const createOrg = async (c: Context) => {
  const user = c.get("user");
  if (user.role !== "superadmin") {
    return c.json({ message: "Only superadmin can create organizations" }, 403);
  }

  const body = await c.req.json();
  const data = parse(createOrgSchema, body);
  const org = await createOrganization(data);
  return successResponse(c, org, 201);
};

// ─── List All Organizations (SUPERADMIN only) ─────────────────────────────────

export const listOrgs = async (c: Context) => {
  const user = c.get("user");
  if (user.role !== "superadmin") {
    return c.json({ message: "Only superadmin can view all organizations" }, 403);
  }

  const orgs = await getAllOrganizations();
  return successResponse(c, { organizations: orgs });
};

// ─── Get Organization Details ─────────────────────────────────────────────────

export const getOrgDetails = async (c: Context) => {
  const user = c.get("user");
  const orgId = c.req.param("id");

  // Admin can only see their own org
  if (user.role === "admin" && user.orgId !== orgId) {
    return c.json({ message: "Access denied to this organization" }, 403);
  }

  // Developers cannot view org details
  if (user.role === "developer") {
    return c.json({ message: "Access denied" }, 403);
  }

  const org = await getOrganizationById(orgId);
  return successResponse(c, org);
};

// ─── Assign Admin to Organization (SUPERADMIN only) ───────────────────────────

export const assignAdmin = async (c: Context) => {
  const user = c.get("user");
  if (user.role !== "superadmin") {
    return c.json({ message: "Only superadmin can assign admins to organizations" }, 403);
  }

  const orgId = c.req.param("id");
  const body = await c.req.json();
  const { userId } = parse(addMemberSchema, body);

  const result = await assignAdminToOrg(orgId, userId);
  return successResponse(c, result);
};

// ─── Add Developer to Organization (ADMIN only) ───────────────────────────────

export const addDeveloper = async (c: Context) => {
  const user = c.get("user");
  if (user.role !== "admin") {
    return c.json({ message: "Only admins can add developers to their organization" }, 403);
  }

  if (!user.orgId) {
    return c.json({ message: "Admin is not assigned to an organization" }, 400);
  }

  const orgId = c.req.param("id");
  const body = await c.req.json();
  const { userId } = parse(addMemberSchema, body);

  const member = await addDeveloperToOrg(orgId, userId, user.orgId);
  return successResponse(c, member, 201);
};

// ─── Remove Member from Organization ─────────────────────────────────────────

export const removeMember = async (c: Context) => {
  const user = c.get("user");
  const orgId = c.req.param("id");
  const userId = c.req.param("userId");

  // Superadmin can remove from any org; admin only from their own
  if (user.role === "admin" && user.orgId !== orgId) {
    return c.json({ message: "Access denied to this organization" }, 403);
  }

  if (user.role === "developer") {
    return c.json({ message: "Access denied" }, 403);
  }

  const result = await removeMemberFromOrg(orgId, userId);
  return successResponse(c, result);
};

// ─── Register & Assign Admin to Organization (SUPERADMIN only) ────────────────

export const registerAdmin = async (c: Context) => {
  const user = c.get("user");
  if (user.role !== "superadmin") {
    return c.json({ message: "Only superadmin can register admins" }, 403);
  }

  const orgId = c.req.param("id");
  const body = await c.req.json();
  const data = parse(registerAdminSchema, body);

  const result = await registerAdminForOrg(orgId, data);
  return successResponse(c, result, 201);
};

// ─── Register & Assign Developer to Organization (ADMIN only) ────────────────

export const registerDeveloper = async (c: Context) => {
  const user = c.get("user");
  if (user.role !== "admin") {
    return c.json({ message: "Only admins can register developers for their org" }, 403);
  }

  if (!user.orgId) {
    return c.json({ message: "Admin is not assigned to an organization" }, 400);
  }

  const orgId = c.req.param("id");
  const body = await c.req.json();
  const data = parse(registerDeveloperSchema, body);

  const result = await registerDeveloperForOrg(orgId, user.orgId, data);
  return successResponse(c, result, 201);
};
