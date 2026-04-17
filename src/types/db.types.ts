import type { InferSelectModel } from "drizzle-orm";
import type {
  users,
  sessions,
  otps,
  organizations,
  orgMembers,
  projects,
  projectMembers,
  tasks,
  taskAssignees,
  comments,
  attachments,
  notifications,
  auditLogs,
} from "../db/schema.js";

// ─── Table Map ────────────────────────────────────────────────────────────────

type TableMap = {
  users:          typeof users;
  sessions:       typeof sessions;
  otps:           typeof otps;
  organizations:  typeof organizations;
  orgMembers:     typeof orgMembers;
  projects:       typeof projects;
  projectMembers: typeof projectMembers;
  tasks:          typeof tasks;
  taskAssignees:  typeof taskAssignees;
  comments:       typeof comments;
  attachments:    typeof attachments;
  notifications:  typeof notifications;
  auditLogs:      typeof auditLogs;
};

// ─── Generic DB Record Type ───────────────────────────────────────────────────

/**
 * Infers the full row type for any table in the schema.
 * Usage: DBRecord<"users">, DBRecord<"tasks">, etc.
 */
export type DBRecord<T extends keyof TableMap> = InferSelectModel<TableMap[T]>;

// ─── Convenience Aliases ──────────────────────────────────────────────────────

export type UserRow           = DBRecord<"users">;
export type SessionRow        = DBRecord<"sessions">;
export type OtpRow            = DBRecord<"otps">;
export type OrganizationRow   = DBRecord<"organizations">;
export type OrgMemberRow      = DBRecord<"orgMembers">;
export type ProjectRow        = DBRecord<"projects">;
export type ProjectMemberRow  = DBRecord<"projectMembers">;
export type TaskRow           = DBRecord<"tasks">;
export type TaskAssigneeRow   = DBRecord<"taskAssignees">;
export type CommentRow        = DBRecord<"comments">;
export type AttachmentRow     = DBRecord<"attachments">;
export type NotificationRow   = DBRecord<"notifications">;
export type AuditLogRow       = DBRecord<"auditLogs">;
