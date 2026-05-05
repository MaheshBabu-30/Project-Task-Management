import { parse, picklist, pipe, string, trim, email as emailValidator } from "valibot";
import type { AppContext } from "../../types/hono.types.js";
import { uuidSchema } from "../../helpers/validators.js";
import { importTasksBodySchema, importProjectBodySchema, importOrgBodySchema, importUsersBodySchema } from "./data-transfer.schema.js";
import {
  exportAllOrganizations,
  exportProjects,
  exportTasks,
  exportUsers,
  exportFull,
  importTasksIntoProject,
  importProjectIntoOrg,
  importOrganization,
  importUsersIntoOrg,
} from "./data-transfer.service.js";
import { successResponse } from "../../utils/response.js";
import { taskStatusEnum, taskPriorityEnum } from "../../db/schema/index.js";
import type { TaskStatus, TaskPriority } from "../../types/task.types.js";
import { BadRequestException, ForbiddenException } from "../../exceptions/index.js";

// ─── Unified Export ───────────────────────────────────────────────────────────
//
// GET /export
//   ?type=organizations|projects|tasks|users|full   (default: full)
//   ?orgId=UUID                                      (required for all except type=organizations)
//   ?projectId=UUID                                  (scope to project)
//   ?taskId=UUID                                     (scope to task — type=tasks and type=users only)
//   ?status=...  ?priority=...  ?assigneeEmail=...   (type=tasks only)

export const exportHandler = async (c: AppContext) => {
  const user = c.get("user");

  const rawType = c.req.query("type") ?? "full";
  const type = parse(
    picklist(["organizations", "projects", "tasks", "users", "full"] as const, "type must be one of: organizations, projects, tasks, users, full"),
    rawType,
  );

  // type=organizations — no orgId needed, superadmin check is in the service
  if (type === "organizations") {
    const data = await exportAllOrganizations(user);
    c.header("Content-Disposition", `attachment; filename="organizations.json"`);
    return c.json(data);
  }

  // All other types require orgId
  const rawOrgId = c.req.query("orgId");
  if (!rawOrgId) throw new BadRequestException("orgId query param is required");
  const orgId = parse(uuidSchema("orgId"), rawOrgId);

  const rawProjectId = c.req.query("projectId");
  const projectId = rawProjectId ? parse(uuidSchema("projectId"), rawProjectId) : undefined;

  if (type === "projects") {
    const data = await exportProjects(orgId, user, { projectId });
    c.header("Content-Disposition", `attachment; filename="projects-org-${orgId}.json"`);
    return c.json(data);
  }

  if (type === "tasks") {
    const rawTaskId = c.req.query("taskId");
    const taskId = rawTaskId ? parse(uuidSchema("taskId"), rawTaskId) : undefined;
    const rawStatus = c.req.query("status");
    const rawPriority = c.req.query("priority");
    const rawAssigneeEmail = c.req.query("assigneeEmail");
    const status = rawStatus ? (parse(picklist(taskStatusEnum.enumValues, "Invalid status value"), rawStatus) as TaskStatus) : undefined;
    const priority = rawPriority ? (parse(picklist(taskPriorityEnum.enumValues, "Invalid priority value"), rawPriority) as TaskPriority) : undefined;
    const assigneeEmail = rawAssigneeEmail ? parse(pipe(string(), trim(), emailValidator("Invalid assigneeEmail")), rawAssigneeEmail) : undefined;

    const data = await exportTasks(orgId, user, { projectId, taskId, status, priority, assigneeEmail });
    const filename = taskId ? `tasks-task-${taskId}.json` : projectId ? `tasks-project-${projectId}.json` : `tasks-org-${orgId}.json`;
    c.header("Content-Disposition", `attachment; filename="${filename}"`);
    return c.json(data);
  }

  if (type === "users") {
    const rawTaskId = c.req.query("taskId");
    const taskId = rawTaskId ? parse(uuidSchema("taskId"), rawTaskId) : undefined;
    const data = await exportUsers(orgId, user, { projectId, taskId });
    const filename = taskId ? `users-task-${taskId}.json` : projectId ? `users-project-${projectId}.json` : `users-org-${orgId}.json`;
    c.header("Content-Disposition", `attachment; filename="${filename}"`);
    return c.json(data);
  }

  // type === "full"
  const data = await exportFull(orgId, user, { projectId });
  const filename = projectId ? `project-${projectId}.json` : `org-${orgId}.json`;
  c.header("Content-Disposition", `attachment; filename="${filename}"`);
  return c.json(data);
};

// ─── Unified Import ───────────────────────────────────────────────────────────
//
// POST /import
//   ?type=organization|project|tasks|users   (required)
//   ?orgId=UUID                               (required for type=project and type=users)
//   ?projectId=UUID                           (required for type=tasks)
//
// Body varies by type:
//   organization → { org: {...}, projects?: [...] }
//   project      → { project: {...}, tasks?: [...] }
//   tasks        → { tasks: [...] }
//   users        → { users: [...] }

export const importHandler = async (c: AppContext) => {
  const user = c.get("user");

  const rawType = c.req.query("type");
  if (!rawType) throw new BadRequestException("type query param is required");
  const type = parse(
    picklist(["organization", "project", "tasks", "users"] as const, "type must be one of: organization, project, tasks, users"),
    rawType,
  );

  if (type === "organization") {
    if (user.role !== "superadmin") throw new ForbiddenException("Only superadmins can import organizations");
    const body = await c.req.json();
    const data = parse(importOrgBodySchema, body);
    const result = await importOrganization(data, user);
    return successResponse(c, result, 201);
  }

  if (type === "project") {
    const rawOrgId = c.req.query("orgId");
    if (!rawOrgId) throw new BadRequestException("orgId query param is required");
    const orgId = parse(uuidSchema("orgId"), rawOrgId);
    const rawTaskStatus = c.req.query("taskStatus");
    const rawTaskPriority = c.req.query("taskPriority");
    const taskStatus = rawTaskStatus ? (parse(picklist(taskStatusEnum.enumValues, "Invalid taskStatus value"), rawTaskStatus) as TaskStatus) : undefined;
    const taskPriority = rawTaskPriority ? (parse(picklist(taskPriorityEnum.enumValues, "Invalid taskPriority value"), rawTaskPriority) as TaskPriority) : undefined;
    const body = await c.req.json();
    const data = parse(importProjectBodySchema, body);
    const result = await importProjectIntoOrg(orgId, data, user, { taskStatus, taskPriority });
    return successResponse(c, result, 201);
  }

  if (type === "tasks") {
    const rawProjectId = c.req.query("projectId");
    if (!rawProjectId) throw new BadRequestException("projectId query param is required");
    const projectId = parse(uuidSchema("projectId"), rawProjectId);
    const rawStatus = c.req.query("status");
    const rawPriority = c.req.query("priority");
    const status = rawStatus ? (parse(picklist(taskStatusEnum.enumValues, "Invalid status value"), rawStatus) as TaskStatus) : undefined;
    const priority = rawPriority ? (parse(picklist(taskPriorityEnum.enumValues, "Invalid priority value"), rawPriority) as TaskPriority) : undefined;
    const body = await c.req.json();
    const { tasks: taskList } = parse(importTasksBodySchema, body);
    const result = await importTasksIntoProject(projectId, taskList, user, { status, priority });
    return successResponse(c, result, 201);
  }

  // type === "users"
  const rawOrgId = c.req.query("orgId");
  if (!rawOrgId) throw new BadRequestException("orgId query param is required");
  const orgId = parse(uuidSchema("orgId"), rawOrgId);
  const body = await c.req.json();
  const { users: userList } = parse(importUsersBodySchema, body);
  const result = await importUsersIntoOrg(orgId, userList, user);
  return successResponse(c, result, 201);
};
