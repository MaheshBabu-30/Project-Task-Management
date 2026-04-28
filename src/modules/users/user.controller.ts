import { parse } from "valibot";
import type { AppContext } from "../../types/hono.types.js";
import { userQuerySchema, updateUserSchema, toggleUserStatusSchema, createUserSchema } from "./user.schema.js";
import { uuidSchema } from "../../helpers/validators.js";
import { getUsers, updateUserStatus, updateUserProfile, getUserById, getUserSnapshot, createUser } from "./user.service.js";
import { successResponse } from "../../utils/response.js";
import { buildPagination } from "../../helpers/pagination.js";
import { createAuditLog } from "../audit-logs/audit-log.service.js";
import { catchError } from "../../utils/logger.js";

const getIp = (c: AppContext) =>
  c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? undefined;

// ─── Create User (SUPERADMIN creates admin/developer, ADMIN creates developer) ─

export const createNewUser = async (c: AppContext) => {
  const requester = c.get("user");
  const body = await c.req.json();
  const data = parse(createUserSchema, body);

  const result = await createUser(data, requester);

  createAuditLog({
    orgId: requester.orgId,
    actorId: requester.userId,
    action: "user.created",
    entityType: "user",
    entityId: result.id,
    after: result,
    ipAddress: getIp(c),
  }).catch(catchError("user.controller:auditLog"));

  return successResponse(c, result, 201);
};

// ─── List Users (Scoped) ──────────────────────────────────────────────────────

export const getUsersList = async (c: AppContext) => {
  const user = c.get("user");
  const rawQuery = c.req.query();

  const query = parse(userQuerySchema, rawQuery);

  // Admins are scoped to their org; Superadmins see everything unless they specify orgId in query
  // Developers are scoped to a specific project or task (passed as query params)
  const { data, totalRecords } = await getUsers(query, user.orgId, user.userId, user.role);

  const pagination = buildPagination({
    page: query.page,
    limit: query.limit,
    totalRecords
  });

  return successResponse(c, {
    users: data,
    pagination
  });
};

// ─── Toggle User Status (ADMIN only) ──────────────────────────────────────────

export const toggleUserStatus = async (c: AppContext) => {
  const admin = c.get("user");
  const id = parse(uuidSchema("User ID"), c.req.param("id"));
  const body = await c.req.json();
  const { status } = parse(toggleUserStatusSchema, body);
  const existing = await getUserSnapshot(id);
  const updated = await updateUserStatus(id, admin.userId, status, admin.role, admin.orgId);

  createAuditLog({
    orgId: admin.orgId,
    actorId: admin.userId,
    action: "user.status_updated",
    entityType: "user",
    entityId: id,
    before: existing ?? undefined,
    after: { status },
    ipAddress: getIp(c),
  }).catch(catchError("user.controller:auditLog"));

  return successResponse(c, updated);
};

// ─── Get My Profile ───────────────────────────────────────────────────────────

export const getMe = async (c: AppContext) => {
  const user = c.get("user");
  const profile = await getUserById(user.userId);
  return successResponse(c, profile);
};

// ─── Update My Profile ────────────────────────────────────────────────────────

export const updateMe = async (c: AppContext) => {
  const user = c.get("user");
  const body = await c.req.json();
  const data = parse(updateUserSchema, body);

  const updated = await updateUserProfile(user.userId, data);
  return successResponse(c, updated);
};

// ─── Get User Details ─────────────────────────────────────────────────────────

export const getUserDetails = async (c: AppContext) => {
  const currentUser = c.get("user");
  const id = parse(uuidSchema("User ID"), c.req.param("id"));

  const user = await getUserById(id, currentUser.orgId);
  return successResponse(c, user);
};
