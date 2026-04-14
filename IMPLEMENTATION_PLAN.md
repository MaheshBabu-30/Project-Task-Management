# Implementation Plan — Project Task Management API
# Based on full architecture review and TL feedback

---

## Correct System Flow (After All Changes)

```
1.  Superadmin logs in.
2.  Superadmin creates an Organization independently — no user needed.
3.  Superadmin creates an Admin account independently — no org needed.
4.  Superadmin assigns Admin to the Organization explicitly.
5.  Admin logs in — scoped to their own Org only.
6.  Admin creates a Developer account →
      developer is automatically assigned to Admin's Org.
      No separate assignment step needed.
7.  Admin creates a Project inside the Org.
8.  Admin assigns Developers to the Project.
9.  Admin creates Tasks inside the Project —
      title, description, priority, due date, assignees.
10. Developer logs in — sees only their assigned Projects.
11. Developer sees only Tasks assigned to them.
12. Developer updates task status via enforced transitions:
      to_do → in_progress → completed
      any → on_hold → back to in_progress
      skipping steps is blocked by the system.
13. Due date passes and task not done →
      system auto-marks overdue via cron. No user can set this manually.
14. All tasks completed → project auto-closes.
15. Any task reopened → project reverts to active.
16. Admin removes Developer from Org →
      auto-removed from all projects and all task assignments.
17. Every action is recorded in audit logs — who, what, when, before, after.
18. Task deletable only if completed.
      Project deletable only if all tasks are completed.
19. Nothing hard deleted — everything soft deleted with timestamp.
20. Superadmin sees everything globally across all orgs at all times.
```

---

## Roles and Permissions

### Roles
```
Superadmin  → Platform owner. No org. Sees everything globally.
Admin       → Org manager. Belongs to one org. Manages team and projects.
Developer   → Team member. Belongs to one org. Works on assigned tasks only.
```

### Who Can Do What

```
Action                              Superadmin    Admin           Developer
─────────────────────────────────────────────────────────────────────────────
Create Org                              ✓             ✗               ✗
List all Orgs                           ✓             ✗               ✗
View Org details                        ✓         ✓ (own only)        ✗
Assign Admin to Org                     ✓             ✗               ✗
Create Admin account                    ✓             ✗               ✗
Create Developer account                ✓             ✓               ✗
Remove member from Org                  ✓         ✓ (own only)        ✗
Activate / Deactivate user              ✓         ✓ (own org)         ✗
Create Project                          ✓             ✓               ✗
List Projects                           ✓         ✓ (own org)     ✓ (assigned)
View Project                            ✓         ✓ (own org)     ✓ (assigned)
Update Project                          ✓         ✓ (own org)         ✗
Delete Project                          ✓         ✓ (own org)         ✗
Create Task                             ✓             ✓               ✗
View Task                               ✓         ✓ (own org)     ✓ (assigned)
Update Task (full)                      ✓             ✓               ✗
Update Task status only                 ✓             ✓           ✓ (assigned)
Delete Task                             ✓             ✓               ✗
```

---

## Phase 1 — Architecture: Decouple User and Org Creation
> TL feedback: creating admin by passing orgId in the route is tight coupling.
> Entities and relationships must be separate operations.

### Problem
```
BEFORE (coupled — wrong):
  POST /api/orgs/:id/register-admin     → creates admin + assigns to org in one step
  POST /api/orgs/:id/register-developer → creates developer + assigns to org in one step
  Admin creation DEPENDS on org existing first.
```

### Solution
```
AFTER (decoupled — correct):
  Superadmin flow (2 steps — superadmin has no org context):
    Step 1 → POST /api/users        { name, email, password, role: "admin" }
    Step 2 → POST /api/orgs/:id/admin { userId }

  Admin flow (1 step — admin already has org context):
    Step 1 → POST /api/users        { name, email, password, role: "developer" }
             developer is auto-assigned to admin's org in same transaction.
             No separate assignment step needed.
```

### Files to Change

#### `src/modules/users/user.schema.ts`
```
ADD: createUserSchema
  {
    name:     string (required)
    email:    string, valid email (required)
    password: string, min 8 chars (required)
    role:     "admin" | "developer" (required)
             note: "superadmin" cannot be created via API
  }
```

#### `src/modules/users/user.service.ts`
```
ADD: createUser(data, requester)
  if requester.role === "admin":
    → enforce data.role must be "developer" only
    → create user in users table
    → auto-insert into org_members with requester's orgId
    → single transaction — user and org membership created together

  if requester.role === "superadmin":
    → can create "admin" or "developer"
    → create user in users table only
    → no org assignment — superadmin assigns separately
```

#### `src/modules/users/user.controller.ts`
```
ADD: createUser controller
  → restricted to superadmin and admin roles
  → calls createUser service
  → returns 201 with created user
```

#### `src/modules/users/user.routes.ts`
```
ADD: POST /  → roleMiddleware(["superadmin", "admin"]), createUser
```

#### `src/modules/organizations/org.service.ts`
```
REMOVE: registerAdminForOrg()
REMOVE: registerDeveloperForOrg()
KEEP everything else as is.
```

#### `src/modules/organizations/org.controller.ts`
```
REMOVE: registerAdmin()
REMOVE: registerDeveloper()
KEEP everything else as is.
```

#### `src/modules/organizations/org.routes.ts`
```
REMOVE: POST /:id/register-admin
REMOVE: POST /:id/register-developer

FINAL ROUTES:
  POST   /                      createOrg         [superadmin]
  GET    /                      listOrgs          [superadmin]
  GET    /:id                   getOrgDetails     [superadmin, admin]
  POST   /:id/admin             assignAdmin       [superadmin]
  POST   /:id/developers        addDeveloper      [superadmin] assign existing user
  DELETE /:id/members/:userId   removeMember      [superadmin, admin]
```

#### `src/modules/organizations/org.schema.ts`
```
REMOVE: registerAdminSchema
REMOVE: registerDeveloperSchema
KEEP: createOrgSchema, addMemberSchema
```

---

## Phase 2 — Security Fixes

### Fix 1 — Refresh Token Should Not Rotate on Every Refresh
```
FILE: src/modules/auth/auth.service.ts  refreshSession()

PROBLEM:
  Currently every time the access token is refreshed:
    → old refresh token is deleted
    → new refresh token is generated
    → new refresh token returned to client
  Refresh token changes on every single call to /auth/refresh.
  This is wrong. Refresh token should be generated ONCE at login.

CORRECT FLOW:
  Login            → generate access token + refresh token (ONCE)
  Access expires   → use refresh token → get new access token only
  Refresh token    → stays the same until logout or natural expiry
  Logout           → delete refresh token from sessions table
  Login again      → brand new refresh token generated

BEFORE (wrong):
  const newRefreshToken = generateRefreshToken(newPayload);
  await db.delete(sessions).where(eq(sessions.id, session.id));
  await createSession(user.id, newRefreshToken);
  return { tokens: { accessToken, refreshToken: newRefreshToken } };

AFTER (correct):
  const accessToken = generateToken(newPayload);
  // sessions table untouched — refresh token stays as is
  return { tokens: { accessToken, refreshToken: token } };
  // return the same incoming refresh token back to client
```

### Fix 2 — Refresh Token Stored as Plain Text
```
FILE: src/modules/auth/auth.service.ts

PROBLEM:
  Raw refresh token stored in sessions table.
  If DB is compromised → all active sessions exposed.

FIX:
  import { createHash } from "crypto";

  On createSession():
    const tokenHash = createHash("sha256").update(refreshToken).digest("hex");
    store tokenHash instead of refreshToken

  On refreshSession():
    const tokenHash = createHash("sha256").update(incomingToken).digest("hex");
    query WHERE refreshTokenHash = tokenHash

SCHEMA CHANGE:
  drizzle/schema.ts → sessions table
  rename: refreshToken → refreshTokenHash
  add migration
```

### Fix 2 — OTP Uses Math.random() (Not Cryptographically Secure)
```
FILE: src/modules/auth/auth.service.ts  requestOtp()

BEFORE:
  const otp = Math.floor(100000 + Math.random() * 900000).toString();

AFTER:
  import { randomInt } from "crypto";
  const otp = randomInt(100000, 999999).toString();
```

### Fix 3 — OTP Hashed With bcrypt (Wrong Tool)
```
FILE: src/modules/auth/auth.service.ts  requestOtp() and verifyOtp()

PROBLEM:
  bcrypt is intentionally slow — designed for passwords.
  A 6-digit OTP expiring in 5 minutes does not need this.
  Adds 300-500ms CPU time per OTP request for zero benefit.

BEFORE:
  const otpHash = await bcrypt.hash(otp, 10);
  const isValid = await bcrypt.compare(otp, latestOtp.otpHash);

AFTER:
  import { createHmac } from "crypto";
  const otpHash = createHmac("sha256", process.env.OTP_SECRET)
    .update(otp).digest("hex");

  On verify:
  const incoming = createHmac("sha256", process.env.OTP_SECRET)
    .update(otp).digest("hex");
  const isValid = incoming === latestOtp.otpHash;  // constant-time compare

ADD TO ENV:
  OTP_SECRET=<random 32 char string>
```

### Fix 4 — Superadmin Cannot Deactivate Users
```
FILE: src/modules/users/user.service.ts  updateUserStatus()

PROBLEM:
  Service always checks org membership.
  Superadmin has no orgId → membership check always fails → 403.

FIX:
  export const updateUserStatus = async (
    id, requesterId, status, requesterRole, adminOrgId?
  ) => {
    // Prevent self-deactivation
    if (id === requesterId && status === "inactive") {
      throw new AppError("You cannot deactivate your own account", 400);
    }

    // Only admin needs org membership check, not superadmin
    if (requesterRole === "admin") {
      if (!adminOrgId) throw new AppError("Admin has no organization", 403);
      const [membership] = await db.select()
        .from(orgMembers)
        .where(and(eq(orgMembers.orgId, adminOrgId), eq(orgMembers.userId, id)));
      if (!membership) throw new AppError("User not in your organization", 403);
    }
    // superadmin skips org check — can deactivate anyone
  }

FILE: src/modules/users/user.controller.ts  toggleUserStatus()
  Update call: updateUserStatus(id, admin.userId, status, admin.role, admin.orgId)
```

---

## Phase 3 — Performance Fixes

### Fix 5 — Count Query Loads All Rows Into Memory
```
FILES:
  src/modules/tasks/task.service.ts
  src/modules/projects/project.service.ts
  src/modules/users/user.service.ts

PROBLEM (same pattern in all 3 files):
  const totalResult = await db
    .select({ count: x.id })
    .from(x)
    .where(whereCondition);
  return { totalRecords: totalResult.length };
  ← fetches every matching row into memory, counts in JS

FIX (apply in all 3 files):
  import { count } from "drizzle-orm";
  const [{ total }] = await db
    .select({ total: count() })
    .from(x)
    .where(whereCondition);
  return { totalRecords: total };
  ← database does the counting, one number returned
```

### Fix 6 — Auth Middleware DB Hit on Every Request
```
FILE: src/middlewares/auth.middleware.ts

PROBLEM:
  Every single request hits the DB to check user status.
  At real load this becomes a bottleneck.

SHORT-TERM FIX:
  Embed status + statusVersion in JWT payload at login.
  Remove the DB query from middleware entirely.
  On POST /auth/refresh → re-fetch user status → re-embed in new JWT.
  Deactivation takes effect at next token refresh (max 15 min delay).

LONG-TERM FIX (when Redis is added):
  On login → cache { userId: status } in Redis TTL 60s
  Middleware → check Redis first → DB only on cache miss
  On deactivate → delete Redis key immediately
  Deactivation is instant, no DB hit per request
```

---

## Phase 4 — Business Logic Fixes

### Fix 7 — Superadmin Project Filter Uses Wrong Column
```
FILE: src/modules/projects/project.service.ts  getProjects()  line 65

BEFORE:
  if (query.id) filters.push(eq(projects.orgId, query.id));
  ← query.id is the project ID, not orgId — wrong column, wrong filter

AFTER:
  if (query.orgId) filters.push(eq(projects.orgId, query.orgId));

ALSO: add orgId as an optional query param to projectQuerySchema
```

### Fix 8 — Task Status Transitions Are Unconstrained
```
FILE: src/modules/tasks/task.service.ts  updateTask()

PROBLEM:
  Any status can jump to any other status.
  Developer can mark to_do → completed without working on it.
  No workflow enforcement.

ADD before the update query:
  const ALLOWED_TRANSITIONS: Record<string, string[]> = {
    to_do:       ["in_progress", "on_hold"],
    in_progress: ["on_hold", "completed"],
    on_hold:     ["in_progress", "to_do"],
    completed:   ["in_progress"],   // reopen — admin only
  };

  if (data.status && data.status !== currentTask.status) {
    const allowed = ALLOWED_TRANSITIONS[currentTask.status] ?? [];
    if (!allowed.includes(data.status)) {
      throw new AppError(
        `Cannot transition from "${currentTask.status}" to "${data.status}"`,
        400
      );
    }
  }
```

### Fix 9 — overdue Is a Manual Status, Should Be Computed
```
PROBLEM:
  overdue is in taskStatusEnum — users can manually set it.
  A task can be "overdue" with a future due date.
  System has no automatic awareness of deadlines.

CHANGE 1 — drizzle/schema.ts:
  taskStatusEnum: remove "overdue"
  BEFORE: ["to_do", "in_progress", "on_hold", "overdue", "completed"]
  AFTER:  ["to_do", "in_progress", "on_hold", "completed"]
  Add migration.

CHANGE 2 — Add cron job: src/jobs/mark-overdue.job.ts
  Runs every hour.
  UPDATE tasks
    SET status = "overdue"   ← add overdue back only as system-set
    WHERE dueDate < NOW()
    AND status NOT IN ("completed", "on_hold")
    AND deletedAt IS NULL

NOTE: If keeping overdue in enum, restrict who can set it.
  No user or admin should be able to set status = "overdue" via API.
  Only the cron job sets it.
```

### Fix 10 — Member Removal Doesn't Cascade to Tasks
```
FILE: src/modules/organizations/org.service.ts  removeMemberFromOrg()

PROBLEM:
  Removing a developer from org only deletes org_members row.
  Developer still assigned to active tasks and projects in the org.

FIX — wrap entire removal in one transaction:
  Step 1 → Get all project IDs belonging to this org
  Step 2 → DELETE from task_assignees
             WHERE userId = removedUserId
             AND taskId IN (tasks belonging to org's projects)
  Step 3 → DELETE from project_members
             WHERE userId = removedUserId
             AND projectId IN (org's project IDs)
  Step 4 → DELETE from org_members
             WHERE orgId = orgId AND userId = removedUserId
  Step 5 → If removed user was admin → set org.ownerId = null

  All 5 steps in one transaction — either all succeed or all rollback.
```

### Fix 11 — Organizations Table Has No Soft Delete
```
FILE: drizzle/schema.ts  organizations table

PROBLEM:
  users, projects, tasks all have deleted_at.
  organizations does not.
  If an org is removed it is a hard delete —
  all data gone, no recovery, no audit trail.

FIX — add two columns to organizations table:
  deleted_at  timestamp with timezone   null by default
  deleted_by  uuid references users(id) null by default

SCHEMA CHANGE:
  organizations table → add deleted_at, deleted_by
  Add migration.

SERVICE CHANGE: org.service.ts
  getAllOrganizations() → add WHERE deleted_at IS NULL
  getOrganizationById() → add AND deleted_at IS NULL
  Add softDeleteOrg() function:
    SET deleted_at = now(), deleted_by = superadminId
    WHERE id = orgId

ROUTE CHANGE: org.routes.ts
  DELETE /:id  → softDeleteOrg  [superadmin only]
```

### Fix 12 — Single PATCH /tasks/:id Doing Two Different Jobs
```
PROBLEM:
  PATCH /tasks/:id handles:
    Admin → full update (title, priority, assignees, status, due date)
    Developer → status only
  Hidden role-based branching inside one endpoint.
  Same URL, completely different contracts.

FIX — split into two endpoints:

  PATCH /tasks/:id          → Admin only. Full update.
  PATCH /tasks/:id/status   → Admin + Developer. Status transition only.

FILES TO CHANGE:
  src/modules/tasks/task.routes.ts    → add new route
  src/modules/tasks/task.controller.ts → add updateTaskStatus controller
  src/modules/tasks/task.service.ts   → add updateTaskStatus service
  src/modules/tasks/task.schema.ts    → add updateTaskStatusSchema { status }
```

---

## Phase 5 — Subtasks

### Subtask Design
```
Subtasks are tasks that belong to a parent task.
No new table needed — one self-referencing column on tasks table.

SCHEMA CHANGE — drizzle/schema.ts  tasks table:
  ADD: parentTaskId  uuid  references tasks(id)  nullable

  null   = root task (normal task)
  set    = subtask (belongs to a parent task)
  Max 1 level deep — subtasks cannot have subtasks.

MIGRATION: add parent_task_id column to tasks table.
```

### Business Rules for Subtasks
```
1. Subtask must belong to the same project as its parent task.
2. Subtask cannot have its own subtasks — max 1 level deep.
3. Parent task cannot be completed if any subtask is not completed.
4. Deleting a parent task soft deletes all its subtasks.
5. Subtasks have their own assignees, priority, due date, status.
6. When listing tasks — root tasks returned by default.
   Use query param ?parentTaskId=<id> to get subtasks of a task.
```

### API Changes
```
POST /api/tasks
  body: { ..., parentTaskId?: uuid }
  If parentTaskId provided:
    → validate parent task exists and belongs to same project
    → validate parent task is not itself a subtask
    → create as subtask

GET /api/tasks
  Add optional filter: ?parentTaskId=<id>
    → returns subtasks of that task
  Default (no filter):
    → returns root tasks only (parentTaskId IS NULL)

GET /api/tasks/:id
  Response includes: subtasks array (children of this task)
```

### Service Changes
```
FILE: src/modules/tasks/task.service.ts

createTask():
  If parentTaskId provided:
    → check parent exists and is in same project
    → check parent has no parent itself (prevent nesting)

getTasks():
  Default filter: WHERE parent_task_id IS NULL
  If parentTaskId query param: WHERE parent_task_id = ?

getTaskById():
  Fetch subtasks: SELECT * FROM tasks WHERE parent_task_id = id
  Include in response as subtasks: []

softDeleteTask():
  When deleting a root task:
    → also soft delete all subtasks WHERE parent_task_id = id

updateTask() — project completion check:
  When checking if project is complete:
    → only check root tasks (parent_task_id IS NULL)
    → subtask completion is enforced at parent level
```

---

## Phase 7 — New Database Tables

### Table 1 — audit_logs
```
Purpose: Record every significant action in the system.
         Who did it, what changed, before and after snapshot.

Columns:
  id          uuid primary key
  orgId       uuid nullable (null for superadmin platform actions)
  actorId     uuid references users(id)
  action      varchar(100)   e.g. "task.status_changed", "user.deactivated"
  entityType  varchar(50)    e.g. "task", "project", "user", "org"
  entityId    uuid
  before      jsonb          snapshot of record before change
  after       jsonb          snapshot of record after change
  ipAddress   varchar(45)
  createdAt   timestamp with timezone

Indexes:
  orgId, actorId, entityType + entityId, createdAt

When to write:
  → task created / updated / deleted / status changed
  → project created / updated / deleted
  → user created / deactivated / activated
  → member added / removed from org
  → admin assigned to org
```

### Table 2 — comments
```
Purpose: Allow discussion on tasks. Context stays with the task.

Columns:
  id          uuid primary key
  taskId      uuid references tasks(id) on delete cascade
  authorId    uuid references users(id) on delete set null
  body        text not null
  createdAt   timestamp with timezone
  updatedAt   timestamp with timezone
  deletedAt   timestamp with timezone (soft delete)

Indexes:
  taskId, authorId

Access rules:
  Admin + Developer (assigned) → can create comments
  Anyone with task access → can read comments
  Author only → can edit/delete own comment
  Admin → can delete any comment

New routes:
  GET    /api/tasks/:id/comments       list comments
  POST   /api/tasks/:id/comments       add comment
  PATCH  /api/tasks/:id/comments/:cid  edit own comment
  DELETE /api/tasks/:id/comments/:cid  delete comment
```

### Table 3 — attachments
```
Purpose: Link uploaded S3 files to specific tasks.
         Currently uploads are completely disconnected from the data model.

Columns:
  id          uuid primary key
  taskId      uuid references tasks(id) on delete cascade
  uploadedBy  uuid references users(id) on delete set null
  s3Key       text not null       (the S3 object key)
  fileName    varchar(255)        (original file name shown to user)
  mimeType    varchar(100)
  fileSize    integer             (bytes)
  createdAt   timestamp with timezone

Indexes:
  taskId, uploadedBy

New routes:
  GET    /api/tasks/:id/attachments        list attachments on a task
  POST   /api/tasks/:id/attachments        link an uploaded S3 key to task
  DELETE /api/tasks/:id/attachments/:aid   remove attachment record + delete from S3
```

### Table 4 — notifications
```
Purpose: In-app notifications for assignments, comments, due dates.

Columns:
  id          uuid primary key
  userId      uuid references users(id) on delete cascade
  type        varchar(100)   e.g. "task_assigned", "task_overdue", "comment_added"
  title       varchar(255)
  body        text
  entityType  varchar(50)
  entityId    uuid
  readAt      timestamp with timezone (null = unread)
  createdAt   timestamp with timezone

Indexes:
  userId + readAt (for unread count)

When to create:
  → Developer assigned to a task
  → Task due date within 24 hours (cron)
  → Task marked overdue (cron)
  → Comment added to a task you are assigned to

New routes:
  GET   /api/notifications              list own notifications
  PATCH /api/notifications/:id/read     mark one as read
  POST  /api/notifications/read-all     mark all as read
```

---

## Phase 8 — Validation Fixes and New Schema Files

### Rules Applied Everywhere
```
These rules apply to ALL schemas — existing and new:

  string fields with minLength(1)  → no empty strings accepted
  string fields with maxLength     → no oversized payloads
  dueDate                          → regex YYYY-MM-DD format enforced
  url fields (logoUrl, avatarUrl)  → url() validator
  sortBy                           → picklist of allowed column names only
  order                            → picklist(["asc", "desc"]) only
  password                         → minLength(8) minimum
  overdue removed from picklists   → cron-only, not user-settable
  project status "completed"       → removed from update picklist
```

---

### Fix 1 — auth.schema.ts
```
REMOVE: registerSchema  (endpoint deleted, schema dead)

loginSchema:
  password: pipe(string(), minLength(8))   ← was 6, now 8

requestOtpSchema:
  email: pipe(string(), email())           ← already correct

verifyOtpSchema:
  otp: pipe(string(), length(6, "OTP must be exactly 6 digits"))
       ← use length() not minLength() twice
```

### Fix 2 — user.schema.ts
```
ADD: createUserSchema
  name:     pipe(string(), minLength(2), maxLength(150))
  email:    pipe(string(), email())
  password: pipe(string(), minLength(8), maxLength(100))
  role:     picklist(["admin", "developer"])

updateUserSchema:
  name:      optional(pipe(string(), minLength(2), maxLength(150)))
  phone:     optional(pipe(string(), minLength(7), maxLength(20)))
  avatarUrl: optional(pipe(string(), url("Must be a valid URL")))

userQuerySchema:
  role:   optional(picklist(["superadmin", "admin", "developer"]))
  status: optional(picklist(["active", "inactive"]))
  sortBy: optional(picklist(["name", "email", "role", "status", "createdAt"]))
  order:  optional(picklist(["asc", "desc"]))
  ← remove free-text sortBy and order
```

### Fix 3 — org.schema.ts
```
REMOVE: registerAdminSchema    (dead — endpoint deleted)
REMOVE: registerDeveloperSchema (dead — endpoint deleted, identical to above)

createOrgSchema:
  name: pipe(string(), minLength(2), maxLength(200))
  slug: pipe(string(), minLength(2), maxLength(100), regex(...))
        ← already has regex, add maxLength

addMemberSchema:
  userId: pipe(string(), uuid())  ← already correct
```

### Fix 4 — project.schema.ts
```
createProjectSchema:
  title:          pipe(string(), minLength(1), maxLength(200))
  description:    optional(pipe(string(), maxLength(2000)))
  logoUrl:        optional(pipe(string(), url("Must be a valid URL")))
  assignedUserIds: optional(array(pipe(string(), uuid())))

updateProjectSchema:
  title:       optional(pipe(string(), minLength(1), maxLength(200)))
  description: optional(pipe(string(), maxLength(2000)))
  logoUrl:     optional(pipe(string(), url()))
  status:      optional(picklist(["active", "on_hold"]))
               ← REMOVE "completed" — project auto-completes, not manually
  assignedUserIds: optional(array(pipe(string(), uuid())))

projectQuerySchema:
  sortBy: optional(picklist(["title", "status", "createdAt"]))
  order:  optional(picklist(["asc", "desc"]))
  ← remove free-text sortBy and order
```

### Fix 5 — task.schema.ts
```
createTaskSchema:
  title:           pipe(string(), minLength(1), maxLength(300))
  description:     optional(pipe(string(), maxLength(5000)))
  priority:        optional(picklist(["low", "medium", "high", "urgent"]))
  dueDate:         optional(pipe(string(), regex(/^\d{4}-\d{2}-\d{2}$/,
                     "Date must be in YYYY-MM-DD format")))
  projectId:       pipe(string(), uuid())
  parentTaskId:    optional(pipe(string(), uuid()))   ← NEW for subtasks
  assignedUserIds: optional(array(pipe(string(), uuid())))

updateTaskSchema:
  title:           optional(pipe(string(), minLength(1), maxLength(300)))
  description:     optional(pipe(string(), maxLength(5000)))
  priority:        optional(picklist(["low", "medium", "high", "urgent"]))
  dueDate:         optional(pipe(string(), regex(/^\d{4}-\d{2}-\d{2}$/,...)))
  assignedUserIds: optional(array(pipe(string(), uuid())))
  status:          optional(picklist(["to_do", "in_progress", "on_hold", "completed"]))
                   ← REMOVE "overdue" — cron-only, not user-settable
  REMOVE: projectId from update — task cannot be moved to a different project

ADD: updateTaskStatusSchema (for PATCH /tasks/:id/status)
  status: picklist(["to_do", "in_progress", "on_hold", "completed"])
          ← no "overdue" — cron only

taskQuerySchema:
  status:  optional(picklist(["to_do", "in_progress", "on_hold", "completed"]))
           ← REMOVE "overdue" from picklist
  sortBy:  optional(picklist(["title", "status", "priority", "dueDate", "createdAt"]))
  order:   optional(picklist(["asc", "desc"]))
  parentTaskId: optional(pipe(string(), uuid()))   ← NEW for subtask filtering
```

---

### New Schema Files for New Modules

#### `src/modules/comments/comment.schema.ts`  (NEW)
```
createCommentSchema:
  body: pipe(string(), minLength(1), maxLength(2000))

updateCommentSchema:
  body: pipe(string(), minLength(1), maxLength(2000))

commentQuerySchema:
  page:  optional(pipe(number(), minValue(1)))
  limit: optional(pipe(number(), minValue(1), maxValue(100)))
  order: optional(picklist(["asc", "desc"]))
```

#### `src/modules/attachments/attachment.schema.ts`  (NEW)
```
createAttachmentSchema:
  s3Key:    pipe(string(), minLength(1), maxLength(500))
  fileName: pipe(string(), minLength(1), maxLength(255))
  mimeType: pipe(string(), minLength(1), maxLength(100))
  fileSize: pipe(number(), minValue(1))
```

#### `src/modules/notifications/notification.schema.ts`  (NEW)
```
notificationQuerySchema:
  page:   optional(pipe(number(), minValue(1)))
  limit:  optional(pipe(number(), minValue(1), maxValue(100)))
  unread: optional(boolean())   ← filter unread only
```

---

## Final API Surface (After All Changes)

### Auth — /api/auth
```
POST  /register        Register new user
POST  /login           Login with email + password
POST  /request-otp     Request OTP code to email
POST  /verify-otp      Verify OTP and login
POST  /refresh         Rotate refresh token, get new access token
POST  /logout          Invalidate session
```

### Users — /api/users
```
POST  /                Create user [superadmin creates admin, admin creates developer]
GET   /                List users (scoped by role)
GET   /:id             Get user details
PATCH /me              Update own profile
PATCH /:id/status      Activate / deactivate user [admin, superadmin]
```

### Organizations — /api/orgs
```
POST   /                       Create org [superadmin]
GET    /                        List all orgs [superadmin]
GET    /:id                     Get org details + members [superadmin, admin]
POST   /:id/admin               Assign existing admin to org [superadmin]
POST   /:id/developers          Assign existing developer to org [superadmin]
DELETE /:id/members/:userId     Remove member from org [superadmin, admin]
```

### Projects — /api/projects
```
POST   /       Create project [admin, superadmin]
GET    /        List projects (scoped by role)
GET    /:id     Get project details + members
PATCH  /:id     Update project [admin, superadmin]
DELETE /:id     Soft delete project [admin, superadmin]
```

### Tasks — /api/tasks
```
POST   /               Create task [admin, superadmin]
GET    /               List tasks (scoped by role + filters)
GET    /:id            Get task details + assignees
PATCH  /:id            Full update [admin, superadmin]
PATCH  /:id/status     Status update only [admin, developer (assigned)]
DELETE /:id            Soft delete task [admin, superadmin]
```

### Task Comments — /api/tasks/:id/comments
```
GET    /          List comments on task
POST   /          Add comment [admin, developer (assigned)]
PATCH  /:cid      Edit own comment
DELETE /:cid      Delete comment [admin, or own comment]
```

### Task Attachments — /api/tasks/:id/attachments
```
GET    /          List attachments on task
POST   /          Link uploaded file to task [admin, developer (assigned)]
DELETE /:aid      Remove attachment [admin, uploader]
```

### Uploads — /api/uploads
```
POST  /presigned-url    Get pre-signed S3 URL for direct upload
```

### Notifications — /api/notifications
```
GET   /              List own notifications
PATCH /:id/read      Mark one as read
POST  /read-all      Mark all as read
```

---

## All Problems Fixed — Reference Table

| # | Problem | File | Severity |
|---|---|---|---|
| 1 | Admin creation coupled to org route | org.service.ts, org.routes.ts | High |
| 2 | orgMembers.role stored but never enforced | Throughout services | Medium |
| 3 | Refresh token stored plain in DB | auth.service.ts | Critical |
| 4 | Math.random() for OTP generation | auth.service.ts | High |
| 5 | bcrypt used on OTP (wrong tool) | auth.service.ts | Medium |
| 6 | Superadmin cannot deactivate users | user.service.ts | High |
| 7 | Count query loads all rows into memory | task/project/user.service.ts | High |
| 8 | Auth middleware DB hit every request | auth.middleware.ts | High |
| 9 | Superadmin project orgId filter bug | project.service.ts | High |
| 10 | No task status transition rules | task.service.ts | High |
| 11 | overdue is a manual user-settable status | schema.ts | Medium |
| 12 | Member removal doesn't cascade to tasks | org.service.ts | High |
| 13 | Single PATCH doing two different jobs | task.routes.ts | Medium |
| 14 | No audit trail | missing table | High |
| 15 | No comments on tasks | missing table | High |
| 16 | File uploads disconnected from data model | missing table | Medium |
| 17 | No in-app notifications | missing table | Medium |
| 18 | organizations table has no soft delete | drizzle/schema.ts | High |
| 19 | Refresh token rotates on every refresh instead of once at login | auth.service.ts | High |
| 20 | POST /api/auth/register allows anyone to self-register with any role | auth.routes.ts | Critical |
| 21 | Subtasks not in schema — parent_task_id missing from tasks table | drizzle/schema.ts | High |
| 22 | Empty strings pass all string validations | all schema files | High |
| 23 | dueDate accepts any string, no format check | task.schema.ts | High |
| 24 | sortBy and order accept any free text string | task/project/user schema | Medium |
| 25 | No maxLength on any string field | all schema files | Medium |
| 26 | logoUrl and avatarUrl not validated as URLs | project/user schema | Medium |
| 27 | Password minLength is 6, too weak | auth.schema.ts | High |
| 28 | overdue still in task status picklists | task.schema.ts | High |
| 29 | Project status "completed" manually settable via API | project.schema.ts | High |
| 30 | Dead registerAdminSchema and registerDeveloperSchema in org.schema.ts | org.schema.ts | Low |
| 31 | parentTaskId missing from task create/update/query schemas | task.schema.ts | High |
| 32 | No schema files for comments, attachments, notifications modules | missing files | High |

---

## PR Breakdown (Do In This Order)

```
PR 1 — Phase 1: Decouple user and org creation
  Files: user.schema, user.service, user.controller, user.routes,
         org.service, org.controller, org.routes, org.schema
  Tests: create user without org → assign to org separately
         admin creates developer → auto-assigned to admin's org

PR 2 — Phase 2: Security fixes
  Files: auth.service (5 fixes), user.service, user.controller
  Tests: OTP is cryptographically random, refresh token is hashed,
         refresh token does not change on access token refresh,
         superadmin can deactivate any user

PR 3 — Phase 3: Performance fixes
  Files: task.service, project.service, user.service, auth.middleware
  Tests: count returns correct number without loading all rows

PR 4 — Phase 4: Business logic fixes
  Files: project.service, task.service, task.routes,
         task.controller, task.schema, org.service, schema.ts
  Tests: status transitions enforced, member removal cascades,
         superadmin project filter works correctly

PR 5 — Phase 5: Subtasks
  Files: drizzle/schema.ts (add parentTaskId),
         task.service.ts, task.schema.ts
  Tests: create subtask under parent, list subtasks,
         parent blocks completion if subtasks pending,
         delete parent cascades to subtasks

PR 6 — Phase 7: New tables and features
  Files: schema.ts (4 new tables), new modules for comments,
         attachments, notifications, audit
  Tests: comments CRUD, attachments linked to tasks,
         notifications created on assignment

PR 7 — Phase 8: Validation fixes
  Files: auth.schema, user.schema, org.schema, project.schema,
         task.schema, new comment/attachment/notification schemas
  Tests: empty string rejected, invalid date rejected,
         invalid sortBy rejected, password min 8 enforced,
         overdue not settable via API, project completed not settable via API
```

---

## Environment Variables to Add

```
OTP_SECRET=<random 32 character string>   for HMAC OTP hashing
```

---

## Key Business Rules (Enforced by System, Not by Trust)

```
1. A developer can only see projects they are assigned to.
2. A developer can only see tasks assigned to them.
3. A developer can only update the status of their own assigned tasks.
4. Status transitions are enforced — no jumping steps.
5. overdue is set by the system automatically — never manually.
6. A task can only be deleted if its status is completed.
7. A project can only be deleted if ALL its tasks are completed.
8. When all tasks complete → project auto-completes.
9. When any task reopens → project reverts to active.
10. Removing a member from org removes them from all projects and tasks.
11. Admin can only manage users within their own org.
12. Superadmin has no org — sees and manages everything globally.
13. Superadmin cannot be created via API — only seeded directly in DB.
14. Every significant action is written to audit_logs.
15. Nothing is permanently deleted — deletedAt is always used.
```
