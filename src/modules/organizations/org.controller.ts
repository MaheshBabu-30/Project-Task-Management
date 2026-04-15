import { parse } from "valibot";
import type { Context } from "hono";
import { createOrgSchema, addMemberSchema } from "./org.schema.js";
import { uuidSchema } from "../../utils/schema.js";
import {
  createOrganization,
  getAllOrganizations,
  getOrganizationById,
  assignAdminToOrg,
  addDeveloperToOrg,
  removeMemberFromOrg,
  softDeleteOrg,
} from "./org.service.js";
import { successResponse } from "../../utils/response.js";
import { createAuditLog } from "../audit-logs/audit-log.service.js";
import { createNotification } from "../notifications/notification.service.js";

const getIp = (c: Context) =>
  c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? undefined;

// ─── Create Organization (SUPERADMIN only) ────────────────────────────────────

export const createOrg = async (c: Context) => {
  const user = c.get("user");
  const body = await c.req.json();
  const data = parse(createOrgSchema, body);
  const org = await createOrganization(data);

  if (org) {
    createAuditLog({
      actorId: user.userId,
      action: "org.created",
      entityType: "organization",
      entityId: org.id,
      after: org,
      ipAddress: getIp(c),
    }).catch(console.error);
  }

  return successResponse(c, org, 201);
};

// ─── List All Organizations (SUPERADMIN only) ─────────────────────────────────

export const listOrgs = async (c: Context) => {
  const orgs = await getAllOrganizations();
  return successResponse(c, { organizations: orgs });
};

// ─── Get Organization Details (SUPERADMIN + ADMIN own org) ───────────────────

export const getOrgDetails = async (c: Context) => {
  const user = c.get("user");
  const orgId = parse(uuidSchema("Organization ID"), c.req.param("id"));

  // Admin and developer can only see their own org
  if ((user.role === "admin" || user.role === "developer") && user.orgId !== orgId) {
    return c.json({ message: "Access denied to this organization" }, 403);
  }

  const org = await getOrganizationById(orgId);
  return successResponse(c, org);
};

// ─── Assign Admin to Organization (SUPERADMIN only) ───────────────────────────

export const assignAdmin = async (c: Context) => {
  const user = c.get("user");
  const orgId = parse(uuidSchema("Organization ID"), c.req.param("id"));
  const body = await c.req.json();
  const { userId } = parse(addMemberSchema, body);

  const result = await assignAdminToOrg(orgId, userId);

  createAuditLog({
    orgId,
    actorId: user.userId,
    action: "org.admin_assigned",
    entityType: "organization",
    entityId: orgId,
    after: { userId },
    ipAddress: getIp(c),
  }).catch(console.error);

  return successResponse(c, result);
};

// ─── Add Developer to Organization (ADMIN only) ───────────────────────────────

export const addDeveloper = async (c: Context) => {
  const user = c.get("user");

  if (!user.orgId) {
    return c.json({ message: "Admin is not assigned to an organization" }, 400);
  }

  const orgId = parse(uuidSchema("Organization ID"), c.req.param("id"));
  const body = await c.req.json();
  const { userId } = parse(addMemberSchema, body);

  const member = await addDeveloperToOrg(orgId, userId, user.orgId);

  createAuditLog({
    orgId,
    actorId: user.userId,
    action: "org.developer_added",
    entityType: "organization",
    entityId: orgId,
    after: { userId },
    ipAddress: getIp(c),
  }).catch(console.error);

  return successResponse(c, member, 201);
};

// ─── Soft Delete Organization (SUPERADMIN only) ───────────────────────────────

export const deleteOrg = async (c: Context) => {
  const user = c.get("user");
  const orgId = parse(uuidSchema("Organization ID"), c.req.param("id"));
  const result = await softDeleteOrg(orgId, user.userId);

  createAuditLog({
    orgId,
    actorId: user.userId,
    action: "org.deleted",
    entityType: "organization",
    entityId: orgId,
    ipAddress: getIp(c),
  }).catch(console.error);

  return successResponse(c, result);
};

// ─── Remove Member from Organization (SUPERADMIN + ADMIN own org) ────────────

export const removeMember = async (c: Context) => {
  const user = c.get("user");
  const orgId = parse(uuidSchema("Organization ID"), c.req.param("id"));
  const userId = parse(uuidSchema("User ID"), c.req.param("userId"));

  // Admin can only remove from their own org
  if (user.role === "admin" && user.orgId !== orgId) {
    return c.json({ message: "Access denied to this organization" }, 403);
  }

  const result = await removeMemberFromOrg(orgId, userId);

  createAuditLog({
    orgId,
    actorId: user.userId,
    action: "org.member_removed",
    entityType: "organization",
    entityId: orgId,
    after: { removedUserId: userId },
    ipAddress: getIp(c),
  }).catch(console.error);

  createNotification({
    userId,
    type: "member_removed",
    title: "You have been removed from an organization",
    body: "You no longer have access to this organization's projects and tasks.",
    entityType: "organization",
    entityId: orgId,
  }).catch(console.error);

  return successResponse(c, result);
};
