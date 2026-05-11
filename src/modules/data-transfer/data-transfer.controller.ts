import { parse, picklist } from "valibot";
import type { AppContext } from "../../types/hono.types.js";
import { uuidSchema } from "../../helpers/validators.js";
import { importTasksBodySchema, importProjectBodySchema, importOrgBodySchema, importUsersBodySchema } from "./data-transfer.schema.js";
import {
  exportOrganizations,
  exportProjects,
  exportTasks,
  exportUsers,
  importProjectIntoOrg,
  importOrganization,
  importUsersIntoOrg,
  createTaskImportJob,
  processImportJob,
  getImportJobStatus,
} from "./data-transfer.service.js";
import { successResponse } from "../../utils/response.js";
import { taskStatusEnum, taskPriorityEnum, projectStatusEnum } from "../../db/schema/index.js";
import type { TaskStatus, TaskPriority } from "../../types/task.types.js";
import { BadRequestException, ForbiddenException } from "../../exceptions/index.js";
import { createAuditLog } from "../audit-logs/audit-log.service.js";
import { catchError } from "../../utils/logger.js";
import { qstashClient, qstashReceiver } from "../../config/qstash.js";
import { env } from "../../config/env.js";

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
//   organization: body { orgs: [{name, slug, description}] }
//   users:        body { users: [{name, email}] }
//
// admin → type=project|tasks|users (org from JWT)
//   project: body { projects: [{title, description, assigneeEmails?}] }
//   tasks:   body { tasks: [{title, description, priority, dueDate, assigneeEmails?}] }  ?projectId=UUID
//   users:   body { users: [{name, email}] }
//
// tasks import is async via QStash (or sync fallback when QSTASH_TOKEN is not set).
// All other types are synchronous.

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

  // type === "tasks" — async via QStash (sync fallback if QSTASH_TOKEN not set)
  const rawProjectId = c.req.query("projectId");
  if (!rawProjectId) throw new BadRequestException("projectId query param is required");
  const projectId = parse(uuidSchema("projectId"), rawProjectId);
  const body = await c.req.json();
  const { tasks: taskList } = parse(importTasksBodySchema, body);

  const { jobId, orgId } = await createTaskImportJob(taskList, projectId, user);

  // Async path: hand off to QStash
  if (qstashClient && env.APP_BASE_URL) {
    await qstashClient.publishJSON({
      url: `${env.APP_BASE_URL}/api/import/callback`,
      body: { jobId },
      retries: 3,
    });
    return successResponse(c, { status: "queued", jobId, message: "Import queued for processing. Poll /api/import/status/:jobId for result." }, 202);
  }

  // Sync fallback (local dev — no QSTASH_TOKEN)
  const result = await processImportJob(jobId);
  createAuditLog({
    orgId,
    actorId: user.userId,
    action: "import.tasks",
    entityType: "organization",
    entityId: projectId,
    after: { jobId, imported: (result as any).tasksImported, projectId },
  }).catch(catchError("data-transfer.controller:auditLog"));
  return successResponse(c, { jobId, ...result }, 201);
};

// ─── QStash Callback ──────────────────────────────────────────────────────────
//
// POST /import/callback
// Called by QStash — no auth middleware, verified via QStash signature.

export const importCallbackHandler = async (c: AppContext) => {
  const rawBody = await c.req.text();

  if (qstashReceiver) {
    const signature = c.req.header("upstash-signature") ?? "";
    if (!signature) throw new BadRequestException("Missing QStash signature");
    try {
      await qstashReceiver.verify({ signature, body: rawBody });
    } catch {
      return c.json({ error: "Invalid QStash signature" }, 403);
    }
  }

  let parsed: { jobId?: string };
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new BadRequestException("Invalid JSON in callback body");
  }
  const { jobId } = parsed;
  if (!jobId) throw new BadRequestException("Missing jobId in callback body");

  await processImportJob(jobId);
  return c.json({ ok: true });
};

// ─── Import Job Status ────────────────────────────────────────────────────────
//
// GET /import/status/:jobId
// Auth required — admin or superadmin.

export const importStatusHandler = async (c: AppContext) => {
  const user = c.get("user");
  const jobId = c.req.param("jobId");
  parse(uuidSchema("jobId"), jobId);
  const job = await getImportJobStatus(jobId, user);
  return successResponse(c, job);
};
