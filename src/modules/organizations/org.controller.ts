import { parse } from "valibot";
import type { AppContext } from "../../types/hono.types.js";
import { createOrgSchema, addMemberSchema, orgQuerySchema } from "./org.schema.js";
import { buildPagination } from "../../helpers/pagination.js";
import { uuidSchema } from "../../helpers/validators.js";
import { BadRequestException, ForbiddenException } from "../../exceptions/index.js";
import { ACCESS_DENIED, ADMIN_NO_ORG } from "../../constants/appMessages.js";
import {
  createOrganization,
  getAllOrganizations,
  getOrganizationById,
  assignAdminToOrg,
  addDeveloperToOrg,
  removeMemberFromOrg,
  softDeleteOrg,
  getOrgSnapshot,
} from "./org.service.js";
import { getUserSnapshot } from "../users/user.service.js";
import { successResponse } from "../../utils/response.js";
import { createAuditLog } from "../audit-logs/audit-log.service.js";
import { createNotification } from "../notifications/notification.service.js";
import { catchError } from "../../utils/logger.js";

const getIp = (c: AppContext) =>
  c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? undefined;

// ─── Create Organization (SUPERADMIN only) ────────────────────────────────────

export const createOrg = async (c: AppContext) => {
  const user = c.get("user");
  const body = await c.req.json();
  const data = parse(createOrgSchema, body);
  const org = await createOrganization(data);

  if (org) {
    getOrgSnapshot(org.id)
      .then((snap) => createAuditLog({
        orgId: org.id,
        actorId: user.userId,
        action: "org.created",
        entityType: "organization",
        entityId: org.id,
        after: snap ?? undefined,
        ipAddress: getIp(c),
      }))
      .catch(catchError("org.controller:auditLog"));
  }

  return successResponse(c, org, 201);
};

// ─── List All Organizations (SUPERADMIN only) ─────────────────────────────────

export const listOrgs = async (c: AppContext) => {
  const rawQuery = c.req.query();

  const query = parse(orgQuerySchema, rawQuery);

  const { data, totalRecords } = await getAllOrganizations(query);

  const pagination = buildPagination({
    page: query.page,
    limit: query.limit,
    totalRecords,
  });

  return successResponse(c, { organizations: data, pagination });
};

// ─── Get Organization Details (SUPERADMIN + ADMIN own org) ───────────────────

export const getOrgDetails = async (c: AppContext) => {
  const user = c.get("user");
  const orgId = parse(uuidSchema("Organization ID"), c.req.param("id"));

  // Admin and developer can only see their own org
  if ((user.role === "admin" || user.role === "developer") && user.orgId !== orgId) {
    throw new ForbiddenException(ACCESS_DENIED);
  }

  const org = await getOrganizationById(orgId);
  return successResponse(c, org);
};

// ─── Assign Admin to Organization (SUPERADMIN only) ───────────────────────────

export const assignAdmin = async (c: AppContext) => {
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
    after: { userId, userName: result.member.user.name ?? result.member.user.email },
    ipAddress: getIp(c),
  }).catch(catchError("org.controller:auditLog"));

  createNotification({
    userId,
    type: "member_added",
    title: "You have been assigned to an organization",
    body: "You have been assigned as an admin of an organization.",
    entityType: "organization",
    entityId: orgId,
  }).catch(catchError("org.controller:assignAdmin:notify"));

  return successResponse(c, result);
};

// ─── Add Developer to Organization (ADMIN only) ───────────────────────────────

export const addDeveloper = async (c: AppContext) => {
  const user = c.get("user");
  const orgId = parse(uuidSchema("Organization ID"), c.req.param("id"));

  if (user.role !== "superadmin" && !user.orgId) {
    throw new BadRequestException(ADMIN_NO_ORG);
  }

  const body = await c.req.json();
  const { userId } = parse(addMemberSchema, body);

  // user.orgId is guaranteed non-null here: the guard above throws if role !== superadmin && !orgId
  const effectiveOrgId = user.role === "superadmin" ? orgId : user.orgId!;
  const member = await addDeveloperToOrg(orgId, userId, effectiveOrgId);

  createAuditLog({
    orgId,
    actorId: user.userId,
    action: "org.developer_added",
    entityType: "organization",
    entityId: orgId,
    after: { userId, userName: member.user.name ?? member.user.email },
    ipAddress: getIp(c),
  }).catch(catchError("org.controller:auditLog"));

  createNotification({
    userId,
    type: "member_added",
    title: "You have been added to an organization",
    body: "You have been added as a developer of an organization.",
    entityType: "organization",
    entityId: orgId,
  }).catch(catchError("org.controller:addDeveloper:notify"));

  return successResponse(c, member, 201);
};

// ─── Soft Delete Organization (SUPERADMIN only) ───────────────────────────────

export const deleteOrg = async (c: AppContext) => {
  const user = c.get("user");
  const orgId = parse(uuidSchema("Organization ID"), c.req.param("id"));
  const existing = await getOrgSnapshot(orgId);
  const result = await softDeleteOrg(orgId, user.userId);

  createAuditLog({
    orgId,
    actorId: user.userId,
    action: "org.deleted",
    entityType: "organization",
    entityId: orgId,
    before: existing ?? undefined,
    ipAddress: getIp(c),
  }).catch(catchError("org.controller:auditLog"));

  return successResponse(c, result);
};

// ─── Remove Member from Organization (SUPERADMIN + ADMIN own org) ────────────

export const removeMember = async (c: AppContext) => {
  const user = c.get("user");
  const orgId = parse(uuidSchema("Organization ID"), c.req.param("id"));
  const userId = parse(uuidSchema("User ID"), c.req.param("userId"));

  // Admin can only remove from their own org
  if (user.role === "admin" && user.orgId !== orgId) {
    throw new ForbiddenException(ACCESS_DENIED);
  }

  const removedUser = await getUserSnapshot(userId);
  const result = await removeMemberFromOrg(orgId, userId);

  createAuditLog({
    orgId,
    actorId: user.userId,
    action: "org.member_removed",
    entityType: "organization",
    entityId: orgId,
    after: { removedUserId: userId, userName: removedUser?.name ?? removedUser?.email ?? userId },
    ipAddress: getIp(c),
  }).catch(catchError("org.controller:auditLog"));

  createNotification({
    userId,
    type: "member_removed",
    title: "You have been removed from an organization",
    body: "You no longer have access to this organization's projects and tasks.",
    entityType: "organization",
    entityId: orgId,
  }).catch(catchError("org.controller:removeMember:notify"));

  return successResponse(c, result);
};
