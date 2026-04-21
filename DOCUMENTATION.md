# Task Miller — Full Documentation

---

## What Is This Project?

This is a **multi-tenant Task Management REST API** built with **Hono + TypeScript + PostgreSQL**.

Think of it like a simplified **Jira or Asana** — companies (organizations) can sign up, create projects, assign developers to those projects, create tasks inside projects, and track the progress of those tasks.

Multiple companies can use the same platform at the same time, but each company's data is **completely private and isolated** from others.

---

## Real-World Scenario

> A software company signs up. The platform owner (Superadmin) creates an Organization for them and assigns a Manager (Admin). The Admin adds developers to the team, creates projects, and assigns tasks to developers. Developers log in, see only their assigned tasks, and update the status as they work.

---

## Tech Stack

| Layer          | Technology              |
| -------------- | ----------------------- |
| Language       | TypeScript              |
| Framework      | Hono (Node.js)          |
| Database       | PostgreSQL               |
| ORM            | Drizzle ORM             |
| Authentication | JWT + bcrypt + OTP Email |
| Email          | Brevo SMTP API          |
| File Storage   | AWS S3 / Backblaze B2   |
| Validation     | Valibot                 |

---

## Who Can Use This System? (3 Roles)

### 1. Superadmin
The **platform owner**. There is only one (or very few). Not tied to any organization. Controls the entire platform.

### 2. Admin
A **company manager**. Belongs to exactly one organization. Manages their team and projects inside their org.

### 3. Developer
A **team member**. Belongs to exactly one organization. Can only see and work on tasks assigned to them.

---

## Role Comparison — Who Can Do What

### Authentication (All Roles)

| Action                        | Superadmin | Admin | Developer |
| ----------------------------- | ---------- | ----- | --------- |
| Register account              | yes        | yes   | yes       |
| Login with password           | yes        | yes   | yes       |
| Login with OTP (email code)   | yes        | yes   | yes       |
| Refresh access token          | yes        | yes   | yes       |
| Logout                        | yes        | yes   | yes       |

---

### Organizations

| Action                              | Superadmin    | Admin          | Developer |
| ----------------------------------- | ------------- | -------------- | --------- |
| Create an organization              | yes           | no             | no        |
| List all organizations              | yes           | no             | no        |
| View organization details           | yes (any org) | yes (own only) | no        |
| Create + assign an Admin to an org  | yes           | no             | no        |
| Add existing Admin to an org        | yes           | no             | no        |
| Create + assign a Developer to org  | no            | yes            | no        |
| Add existing Developer to org       | no            | yes            | no        |
| Remove a member from org            | yes           | yes (own org)  | no        |

---

### Users

| Action                        | Superadmin    | Admin         | Developer     |
| ----------------------------- | ------------- | ------------- | ------------- |
| List users                    | yes (all)     | yes (own org) | yes (own org) |
| View user details             | yes (any)     | yes (own org) | yes (own org) |
| Update own profile            | yes           | yes           | yes           |
| Activate / Deactivate a user  | yes           | yes (own org) | no            |

---

### Projects

| Action                                    | Superadmin | Admin         | Developer        |
| ----------------------------------------- | ---------- | ------------- | ---------------- |
| Create project                            | yes        | yes (own org) | no               |
| List projects                             | yes (all)  | yes (own org) | yes (assigned only) |
| View project details                      | yes        | yes (own org) | yes (assigned only) |
| Update project (title, status, members)   | yes        | yes (own org) | no               |
| Delete project (soft delete)              | yes        | yes (own org) | no               |

> A project can only be deleted if ALL its tasks are completed.

---

### Tasks

| Action                                    | Superadmin | Admin         | Developer           |
| ----------------------------------------- | ---------- | ------------- | ------------------- |
| Create task                               | yes        | yes (own org) | no                  |
| List tasks                                | yes (all)  | yes (own org) | yes (assigned only) |
| View task details                         | yes        | yes (own org) | yes (assigned only) |
| Update task (title, priority, assignees)  | yes        | yes (own org) | no                  |
| Update task status only                   | yes        | yes           | yes (assigned only) |
| Delete task (soft delete)                 | yes        | yes (own org) | no                  |

> A task can only be deleted if its status is completed.

---

### Files / Uploads

| Action                                         | Superadmin | Admin | Developer |
| ---------------------------------------------- | ---------- | ----- | --------- |
| Get pre-signed upload URL (avatars, logos etc) | yes        | yes   | yes       |

---

### Comments

| Action                    | Superadmin    | Admin         | Developer           |
| ------------------------- | ------------- | ------------- | ------------------- |
| List comments on a task   | yes           | yes (own org) | yes (assigned only) |
| Add comment to a task     | yes           | yes (own org) | yes (assigned only) |
| Edit a comment            | yes           | yes (own org) | yes (own comments only) |
| Delete a comment          | yes           | yes (own org) | yes (own comments only) |

> Only the comment author can edit. Only the author, admin, or superadmin can delete.

---

### Attachments

| Action                          | Superadmin    | Admin         | Developer           |
| ------------------------------- | ------------- | ------------- | ------------------- |
| List attachments on a task      | yes           | yes (own org) | yes (assigned only) |
| Link an attachment to a task    | yes           | yes (own org) | yes (assigned only) |
| Get attachment download URL     | yes           | yes (own org) | yes (assigned only) |
| Delete an attachment            | yes           | yes (own org) | yes (own uploads only) |

> Only the uploader, admin, or superadmin can delete an attachment.

---

### Notifications

| Action                         | Superadmin | Admin | Developer |
| ------------------------------ | ---------- | ----- | --------- |
| List own notifications         | yes        | yes   | yes       |
| Mark a notification as read    | yes        | yes   | yes       |
| Mark all notifications as read | yes        | yes   | yes       |

---

### Audit Logs

| Action          | Superadmin       | Admin          | Developer |
| --------------- | ---------------- | -------------- | --------- |
| List audit logs | yes (all orgs)   | yes (own org)  | no        |

---

## Complete API Endpoints (41 Total)

### Auth — `/api/auth`

```
POST  /register          Create a new user account
POST  /login             Login with email + password
POST  /request-otp       Request a 6-digit OTP sent to email
POST  /verify-otp        Submit the OTP to login
POST  /refresh           Get a new access token using refresh token
POST  /logout            Logout and invalidate session
```

### Users — `/api/users`

```
GET   /                  List users (scoped by role)
GET   /:id               View a user's details
PATCH /me                Update your own profile (name, phone, avatar)
PATCH /:id/status        Activate or deactivate a user [Admin+]
```

### Organizations — `/api/orgs`

```
POST   /                         Create a new organization [Superadmin]
GET    /                         List all organizations [Superadmin]
GET    /:id                      Get org details + members [Superadmin, Admin]
POST   /:id/admin                Assign existing user as admin [Superadmin]
POST   /:id/register-admin       Create + assign new admin [Superadmin]
POST   /:id/developers           Add existing developer to org [Admin]
POST   /:id/register-developer   Create + assign new developer [Admin]
DELETE /:id/members/:userId      Remove a member from org [Superadmin, Admin]
```

### Projects — `/api/projects`

```
GET    /       List projects (scoped by role)
GET    /:id    Get project details + assigned members
POST   /       Create a new project [Admin+]
PATCH  /:id    Update project details or assigned members [Admin+]
DELETE /:id    Soft delete a project [Admin+]
```

### Tasks — `/api/tasks`

```
GET    /       List tasks (scoped by role + filters)
GET    /:id    Get task details + assignees
POST   /       Create a new task [Admin+]
PATCH  /:id    Update task (full for Admin, status-only for Developer)
DELETE /:id    Soft delete a task [Admin+]
```

### Uploads — `/api/uploads`

```
POST  /presigned-url    Get a pre-signed URL to upload a file directly to S3/B2
```

### Comments — `/api/tasks/:taskId/comments`

```
GET     /                List comments on a task (with nested replies)
POST    /                Add a comment (supports optional parentCommentId for replies)
PATCH   /:commentId      Edit a comment (author only)
DELETE  /:commentId      Soft delete a comment (author, admin, superadmin)
```

### Attachments — `/api/tasks/:taskId/attachments`

```
GET     /                          List attachments on a task
POST    /                          Link an attachment (s3Key, fileName, mimeType, fileSize)
GET     /:attachmentId/url         Get a pre-signed S3 download URL for an attachment
DELETE  /:attachmentId             Delete an attachment
```

### Notifications — `/api/notifications`

```
GET     /           List own notifications (filterable by type, unread status)
PATCH   /:id/read   Mark a single notification as read
PATCH   /read-all   Mark all notifications as read
```

### Audit Logs — `/api/audit-logs`

```
GET  /    List audit logs (Superadmin: all orgs; Admin: own org only)
```

---

## Full System Flow (Step by Step)

```
Step 1 — Platform Setup
  Superadmin logs in
  Creates an Organization (e.g. "Acme Corp")
  Creates an Admin account and assigns them to Acme Corp

Step 2 — Organization Setup
  Admin logs into Acme Corp
  Adds developers to their team
  Creates projects (e.g. "Website Redesign")
  Assigns developers to the project

Step 3 — Task Management
  Admin creates tasks inside a project
  Sets title, description, priority (low/medium/high/urgent), due date
  Assigns one or more developers to the task
  Task starts at status: "to_do"

Step 4 — Developer Work
  Developer logs in
  Sees only their assigned projects and tasks
  Updates task status as they progress:
    to_do → in_progress → completed
    (or: on_hold / overdue)

Step 5 — Project Completion
  When ALL tasks in a project are "completed"
  The project status auto-updates to "completed"
  If any task goes back to non-completed
  Project reverts to "active"
```

---

## How Login Works (2 Methods)

### Method 1: Password Login

```
POST /api/auth/login
Body: { email, password }

Returns: accessToken + refreshToken
```

### Method 2: OTP Login (no password needed)

```
POST /api/auth/request-otp
Body: { email }
Sends a 6-digit code to your email (expires in 5 minutes)

POST /api/auth/verify-otp
Body: { email, otp }
Verifies the code and returns: accessToken + refreshToken
```

### Token System

```
accessToken   Short-lived. Used in every API request via: Authorization: Bearer <token>
refreshToken  Long-lived. Used only to get a new accessToken when it expires.
              Old token is deleted on each refresh (rotation for security).
```

---

## Database Structure (13 Tables)

```
users              All user accounts (superadmin, admin, developer)
sessions           Active login sessions (refresh tokens)
otps               Temporary OTP codes for email login
organizations      Company/team accounts
org_members        Which users belong to which org (with role)
projects           Projects inside an org
project_members    Which developers are assigned to which project
tasks              Tasks inside a project
task_assignees     Which developers are assigned to which task
comments           Comments on tasks (supports nested replies via parentCommentId)
attachments        Files linked to tasks (stored in S3/B2, metadata in DB)
notifications      In-app notifications for users (task events, comments, etc.)
audit_logs         Immutable log of all admin/superadmin actions across the platform
```

### Relationships

```
Organization
  has many  org_members (admins + developers)
  has many  projects
              has many  project_members (developers)
              has many  tasks
                          has many  task_assignees (developers)
                          has many  comments (with optional replies)
                          has many  attachments
  has many  audit_logs

User
  has many  notifications
```

---

## Status Values

### Project Status

| Status    | Meaning                           |
| --------- | --------------------------------- |
| active    | Work in progress                  |
| on_hold   | Paused temporarily                |
| completed | All tasks done (auto-set by system) |

### Task Status

| Status      | Meaning           |
| ----------- | ----------------- |
| to_do       | Not started yet   |
| in_progress | Being worked on   |
| on_hold     | Paused            |
| overdue     | Past due date     |
| completed   | Done              |

### Task Priority

| Priority | Meaning          |
| -------- | ---------------- |
| low      | Can wait         |
| medium   | Normal priority  |
| high     | Important        |
| urgent   | Drop everything  |

---

## Security Features

| Feature         | How It Works                                                                 |
| --------------- | ---------------------------------------------------------------------------- |
| JWT Auth        | Every request needs a valid token in the Authorization header                |
| Password Hashing | bcrypt — passwords are never stored in plain text                           |
| OTP Hashing     | OTP codes are also bcrypt-hashed before saving to the database               |
| Token Rotation  | Refresh tokens are replaced on every use, old one is immediately invalidated |
| Soft Delete     | Users/Projects/Tasks are never permanently deleted — deletedAt is set instead |
| Org Isolation   | Every query is filtered by orgId — orgs can never see each other's data      |
| Role Guards     | Every route checks if the user's role is allowed to perform the action       |
| Data Scoping    | Developers only see data assigned to them specifically                        |

---

## Key Business Rules

1. A user can belong to **only one organization**
2. A project can have **multiple developers** assigned
3. A task can have **multiple developers** assigned
4. Developers can **only update task status** — not title, priority, or assignees
5. A task can only be **deleted if its status is completed**
6. A project can only be **deleted if all its tasks are completed**
7. When all tasks complete → **project status auto-updates to completed**
8. Superadmin has **no org** — they see everything globally across all organizations
9. Admins and developers are **always scoped to their own org only**
10. File uploads go **directly to S3/B2** — the server only provides a secure pre-signed URL
11. Comments support **one level of replies** — you cannot reply to a reply
12. Only the **comment author** can edit a comment; author, admin, or superadmin can delete
13. Only the **attachment uploader**, admin, or superadmin can delete an attachment
14. Attachments are limited to **10 MB** and a fixed list of allowed MIME types
15. **Notifications** are auto-generated by the system on task assignment, due-date events, and new comments
16. **Audit logs** are written automatically for all org, user, project, and task mutations — they cannot be created or deleted via the API

---

## Folder Structure

```
src/
  config/           Database, environment variables, S3 client setup
  middlewares/      Auth, role, org-scope, and error handler middleware
  modules/
    auth/           Register, login, OTP, refresh token, logout
    users/          User listing, profile update, status toggle
    organizations/  Org creation, member management
    projects/       Project CRUD and member assignment
    tasks/          Task CRUD, assignee management, status tracking
    uploads/        Pre-signed URL generation for file uploads
    comments/       Task comments with nested reply support
    attachments/    File metadata linked to tasks, S3 download URL generation
    notifications/  In-app notifications listing and read tracking
    audit-logs/     Immutable action history for admin/superadmin
  utils/            JWT helpers, AppError class, email service, response wrapper, pagination
  app.ts            Hono app setup and route registration
  server.ts         Server entry point

drizzle/
  schema.ts         All database table and enum definitions
  migrations/       Auto-generated SQL migration history
```

---

## Environment Variables Required

```
DATABASE_URL                  PostgreSQL connection string
JWT_SECRET                    Secret key for signing access tokens
REFRESH_TOKEN_SECRET          Secret key for signing refresh tokens
JWT_EXPIRES_IN                Access token lifetime (e.g. 15m)
REFRESH_TOKEN_EXPIRES_IN      Refresh token lifetime (e.g. 7d)
BREVO_API_KEY                 Brevo email service API key
B2_ENDPOINT                   Backblaze B2 / S3 endpoint URL
B2_REGION                     Storage region
B2_ACCESS_KEY_ID              Storage access key
B2_SECRET_ACCESS_KEY          Storage secret key
B2_BUCKET_NAME                Bucket name for file uploads
B2_DOWNLOAD_URL               Public download base URL
```
