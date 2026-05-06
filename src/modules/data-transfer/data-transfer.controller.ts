import { parse, picklist } from "valibot";
import type { AppContext } from "../../types/hono.types.js";
import { uuidSchema } from "../../helpers/validators.js";
import { importTasksBodySchema, importProjectBodySchema, importOrgBodySchema, importUsersBodySchema } from "./data-transfer.schema.js";
import {
  exportOrganizations,
  exportProjects,
  exportTasks,
  exportUsers,
  importTasksIntoProject,
  importProjectIntoOrg,
  importOrganization,
  importUsersIntoOrg,
} from "./data-transfer.service.js";
import { successResponse } from "../../utils/response.js";
import { taskStatusEnum, taskPriorityEnum, projectStatusEnum } from "../../db/schema/index.js";
import type { TaskStatus, TaskPriority } from "../../types/task.types.js";
import { BadRequestException, ForbiddenException } from "../../exceptions/index.js";
import { createAuditLog } from "../audit-logs/audit-log.service.js";
import { catchError } from "../../utils/logger.js";

// ─── Unified Export ───────────────────────────────────────────────────────────
//
// GET /export?type=organizations|projects|tasks|users
//
// superadmin → type=organizations or type=users (admins only)
//   organizations: ?id=UUID  ?name=...  ?fromDate=YYYY-MM-DD  ?toDate=YYYY-MM-DD
//   users:         ?id=UUID  ?name=...  ?status=...  ?orgId=UUID (optional)
//
// admin → type=projects|tasks|users only (org scoped from JWT)
//   projects: ?id=UUID  ?title=...  ?status=...  ?fromDate=...  ?toDate=...
//   tasks:    ?id=UUID  ?title=...  ?projectId=UUID  ?status=...  ?priority=...  ?dueDateFrom=...  ?dueDateTo=...
//   users:    ?id=UUID  ?name=...  ?status=active|inactive

export const exportHandler = async (c: AppContext) => {
  const user = c.get("user");

  const rawType = c.req.query("type");
  if (!rawType) throw new BadRequestException("type query param is required");
  const type = parse(
    picklist(["organizations", "projects", "tasks", "users"] as const, "type must be one of: organizations, projects, tasks, users"),
    rawType,
  );

  if (user.role === "superadmin" && type !== "organizations" && type !== "users")
    throw new ForbiddenException("Superadmin can only export organizations and users");
  if (user.role === "admin" && type === "organizations")
    throw new ForbiddenException("Admin cannot export organizations");

  if (type === "organizations") {
    const id = c.req.query("id") ? parse(uuidSchema("id"), c.req.query("id")!) : undefined;
    const name = c.req.query("name") ?? undefined;
    const fromDate = c.req.query("fromDate") ?? undefined;
    const toDate = c.req.query("toDate") ?? undefined;
    const data = await exportOrganizations(user, { id, name, fromDate, toDate });
    c.header("Content-Disposition", `attachment; filename="organizations.json"`);
    return successResponse(c, data);
  }

  if (type === "users") {
    const id = c.req.query("id") ? parse(uuidSchema("id"), c.req.query("id")!) : undefined;
    const name = c.req.query("name") ?? undefined;
    const rawStatus = c.req.query("status");
    const status = rawStatus ? parse(picklist(["active", "inactive"] as const, "status must be active or inactive"), rawStatus) : undefined;
    const orgId = user.role === "superadmin" && c.req.query("orgId")
      ? parse(uuidSchema("orgId"), c.req.query("orgId")!)
      : undefined;
    const data = await exportUsers(user, { id, name, status, orgId });
    if (user.role === "admin" && user.orgId) {
      createAuditLog({
        orgId: user.orgId,
        actorId: user.userId,
        action: "export.users",
        entityType: "organization",
        entityId: user.orgId,
        after: { totalUsers: data.totalUsers },
      }).catch(catchError("data-transfer.controller:auditLog"));
    }
    c.header("Content-Disposition", `attachment; filename="users.json"`);
    return successResponse(c, data);
  }

  if (!user.orgId) throw new ForbiddenException("No organization associated with your account");
  const orgId = user.orgId;

  if (type === "projects") {
    const id = c.req.query("id") ? parse(uuidSchema("id"), c.req.query("id")!) : undefined;
    const title = c.req.query("title") ?? undefined;
    const rawStatus = c.req.query("status");
    const status = rawStatus ? parse(picklist(projectStatusEnum.enumValues, "Invalid status value"), rawStatus) : undefined;
    const fromDate = c.req.query("fromDate") ?? undefined;
    const toDate = c.req.query("toDate") ?? undefined;
    const data = await exportProjects(orgId, user, { id, title, status, fromDate, toDate });
    createAuditLog({
      orgId,
      actorId: user.userId,
      action: "export.projects",
      entityType: "organization",
      entityId: orgId,
      after: { totalProjects: data.totalProjects },
    }).catch(catchError("data-transfer.controller:auditLog"));
    c.header("Content-Disposition", `attachment; filename="projects.json"`);
    return successResponse(c, data);
  }

  // type === "tasks"
  const id = c.req.query("id") ? parse(uuidSchema("id"), c.req.query("id")!) : undefined;
  const title = c.req.query("title") ?? undefined;
  const projectId = c.req.query("projectId") ? parse(uuidSchema("projectId"), c.req.query("projectId")!) : undefined;
  const rawStatus = c.req.query("status");
  const rawPriority = c.req.query("priority");
  const status = rawStatus ? (parse(picklist(taskStatusEnum.enumValues, "Invalid status value"), rawStatus) as TaskStatus) : undefined;
  const priority = rawPriority ? (parse(picklist(taskPriorityEnum.enumValues, "Invalid priority value"), rawPriority) as TaskPriority) : undefined;
  const dueDateFrom = c.req.query("dueDateFrom") ?? undefined;
  const dueDateTo = c.req.query("dueDateTo") ?? undefined;
  const data = await exportTasks(orgId, user, { id, title, projectId, status, priority, dueDateFrom, dueDateTo });
  createAuditLog({
    orgId,
    actorId: user.userId,
    action: "export.tasks",
    entityType: "organization",
    entityId: orgId,
    after: { totalTasks: data.totalTasks },
  }).catch(catchError("data-transfer.controller:auditLog"));
  c.header("Content-Disposition", `attachment; filename="tasks.json"`);
  return successResponse(c, data);
};

// ─── Unified Import ───────────────────────────────────────────────────────────
//
// POST /import?type=organization|project|tasks|users
//
// superadmin → type=organization or type=users
//   organization: body { org: { name, slug, description } }
//   users:        body { users: [{name, email}] }  ?orgId=UUID (required for superadmin)
//
// admin → type=project|tasks|users (org from JWT)
//   project: body { project: { title, description, assigneeEmails? } }
//   tasks:   body { tasks: [{title, description, priority, dueDate, assigneeEmails?}] }  ?projectId=UUID
//   users:   body { users: [{name, email}] }

export const importHandler = async (c: AppContext) => {
  const user = c.get("user");

  const rawType = c.req.query("type");
  if (!rawType) throw new BadRequestException("type query param is required");
  const type = parse(
    picklist(["organization", "project", "tasks", "users"] as const, "type must be one of: organization, project, tasks, users"),
    rawType,
  );

  if (user.role === "superadmin" && type !== "organization" && type !== "users")
    throw new ForbiddenException("Superadmin can only import organizations and users");
  if (user.role === "admin" && type === "organization")
    throw new ForbiddenException("Admin cannot import organizations");

  if (type === "organization") {
    const body = await c.req.json();
    const data = parse(importOrgBodySchema, body);
    const result = await importOrganization(data);
    for (const org of result.orgs) {
      createAuditLog({
        orgId: org.orgId,
        actorId: user.userId,
        action: "org.imported",
        entityType: "organization",
        entityId: org.orgId,
        after: { orgName: org.orgName, description: org.description },
      }).catch(catchError("data-transfer.controller:auditLog"));
    }
    return successResponse(c, result, 201);
  }


  if (type === "users") {
    const body = await c.req.json();
    const { users: userList } = parse(importUsersBodySchema, body);
    if (user.role === "superadmin") {
      const result = await importUsersIntoOrg(userList, user);
      return successResponse(c, result, 201);
    }
    if (!user.orgId) throw new ForbiddenException("No organization associated with your account");
    const result = await importUsersIntoOrg(userList, user, user.orgId);
    createAuditLog({
      orgId: user.orgId,
      actorId: user.userId,
      action: "import.users",
      entityType: "organization",
      entityId: user.orgId,
      after: { imported: result.imported, skipped: result.skipped },
    }).catch(catchError("data-transfer.controller:auditLog"));
    return successResponse(c, result, 201);
  }

  if (type === "project") {
    if (!user.orgId) throw new ForbiddenException("No organization associated with your account");
    const body = await c.req.json();
    const data = parse(importProjectBodySchema, body);
    const result = await importProjectIntoOrg(data, user);
    createAuditLog({
      orgId: user.orgId,
      actorId: user.userId,
      action: "import.projects",
      entityType: "organization",
      entityId: user.orgId,
      after: { imported: result.imported },
    }).catch(catchError("data-transfer.controller:auditLog"));
    return successResponse(c, result, 201);
  }

  // type === "tasks"
  const rawProjectId = c.req.query("projectId");
  if (!rawProjectId) throw new BadRequestException("projectId query param is required");
  const projectId = parse(uuidSchema("projectId"), rawProjectId);
  const body = await c.req.json();
  const { tasks: taskList } = parse(importTasksBodySchema, body);
  const result = await importTasksIntoProject(projectId, taskList, user);
  createAuditLog({
    orgId: user.orgId,
    actorId: user.userId,
    action: "import.tasks",
    entityType: "organization",
    entityId: projectId,
    after: { imported: result.tasksImported, projectId },
  }).catch(catchError("data-transfer.controller:auditLog"));
  return successResponse(c, result, 201);
};
