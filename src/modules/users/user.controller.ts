import { parse } from "valibot";
import type { Context } from "hono";
import { userQuerySchema, updateUserSchema, toggleUserStatusSchema } from "./user.schema.js";
import { getUsers, updateUserStatus, updateUserProfile, getUserById } from "./user.service.js";
import { successResponse } from "../../utils/response.js";
import { buildPagination } from "../../utils/pagination.js";

// ─── List Users (Scoped) ──────────────────────────────────────────────────────

export const getUsersList = async (c: Context) => {
  const user = c.get("user");
  const rawQuery = c.req.query();

  const query = parse(userQuerySchema, {
    ...rawQuery,
    page: rawQuery.page ? Number(rawQuery.page) : 1,
    limit: rawQuery.limit ? Number(rawQuery.limit) : 10
  });

  // Admins are scoped to their org; Superadmins see everything unless they specify orgId in query
  const { data, totalRecords } = await getUsers(query, user.orgId);

  const pagination = buildPagination({
    page: query.page as number,
    limit: query.limit as number,
    totalRecords
  });

  return successResponse(c, {
    users: data,
    pagination
  });
};

// ─── Toggle User Status (ADMIN only) ──────────────────────────────────────────

export const toggleUserStatus = async (c: Context) => {
  const admin = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json();
  const { status } = parse(toggleUserStatusSchema, body);

  if (admin.role !== "admin" && admin.role !== "superadmin") {
    return c.json({ message: "Only admins can update user status" }, 403);
  }

  // Superadmin can update anyone; Admin needs their orgId to be checked in service
  const updated = await updateUserStatus(id, status, admin.orgId);
  return successResponse(c, updated);
};

// ─── Update My Profile ────────────────────────────────────────────────────────

export const updateMe = async (c: Context) => {
  const user = c.get("user");
  const body = await c.req.json();
  const data = parse(updateUserSchema, body);

  const updated = await updateUserProfile(user.userId, data);
  return successResponse(c, updated);
};

// ─── Get User Details ─────────────────────────────────────────────────────────

export const getUserDetails = async (c: Context) => {
  const currentUser = c.get("user");
  const id = c.req.param("id");

  const user = await getUserById(id, currentUser.orgId);
  return successResponse(c, user);
};
