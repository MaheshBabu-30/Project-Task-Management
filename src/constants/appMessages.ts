// ─── Auth ─────────────────────────────────────────────────────────────────────

export const INVALID_CREDENTIALS          = "Invalid credentials";
export const ACCOUNT_INACTIVE             = "Your account is inactive. Please contact admin.";
export const ACCOUNT_DEACTIVATED          = "Your account is deactivated. Please contact admin.";
export const ACCOUNT_DEACTIVATED_SHORT    = "Your account is deactivated.";
export const OTP_LOGIN_REQUIRED           = "This account uses OTP login. Please request a code.";
export const INVALID_REFRESH_TOKEN        = "Invalid or expired refresh token";
export const INCORRECT_CURRENT_PASSWORD   = "Current password is incorrect";
export const SAME_PASSWORD                = "New password must be different from the current password";
export const CHANGE_PASSWORD_SUCCESS      = "Password changed successfully. Please log in again.";
export const PASSWORD_RESET_OTP_SENT      = "Password reset code sent to your email";
export const RESET_PASSWORD_SUCCESS       = "Password reset successfully. Please log in with your new password.";
export const EMAIL_NOT_REGISTERED         = "This email is not registered.";
export const OTP_SECRET_NOT_CONFIGURED    = "OTP_SECRET is not configured";
export const EMAIL_SEND_FAILED            = "Failed to send verification email";
export const OTP_SENT                     = "Verification code sent to your email";
export const OTP_NOT_FOUND                = "No verification code found. Please request a new one.";
export const OTP_EXPIRED                  = "Verification code has expired. Please request a new one.";
export const OTP_TOO_MANY_ATTEMPTS        = "Too many failed attempts. Please request a new verification code.";
export const OTP_INVALID                  = "Invalid verification code";
export const OTP_ALREADY_USED             = "Verification code already used. Please request a new one.";
export const LOGOUT_SUCCESS               = "Successfully logged out";

// ─── Users ────────────────────────────────────────────────────────────────────

export const USER_NOT_FOUND               = "User not found";
export const USER_ACCOUNT_NOT_FOUND       = "User account not found";
export const USER_CREATE_FAILED           = "Failed to create user";
export const EMAIL_ALREADY_REGISTERED     = "Email already registered";
export const ADMIN_DEVELOPER_ONLY         = "Admins can only create developer accounts";
export const ADMIN_NO_ORG                 = "Admin has no organization";
export const CANNOT_DEACTIVATE_SELF       = "You cannot deactivate your own account.";
export const ADMIN_DEVELOPER_STATUS_ONLY  = "Admins can only change the status of developer accounts";
export const WRONG_ORG_USER               = "You can only manage users within your own organization";
export const USER_NOT_IN_ORG              = "User not found in your organization";

// ─── Organizations ────────────────────────────────────────────────────────────

export const ORG_NOT_FOUND                = "Organization not found";
export const ADMIN_ROLE_REQUIRED          = "User must have the 'admin' role to be assigned as org admin";
export const ADMIN_ALREADY_IN_ORG         = "This admin is already assigned to an organization. An admin can only belong to one organization.";
export const ORG_ALREADY_HAS_ADMIN        = "This organization already has an admin. An organization can only have one admin.";
export const SLUG_TAKEN                   = (slug: string) => `Slug "${slug}" is already taken. Choose a different slug.`;
export const ORG_NAME_TAKEN               = (name: string) => `Organization with name "${name}" already exists.`;
export const PROJECT_TITLE_TAKEN          = (title: string) => `Project with title "${title}" already exists in this organization.`;
export const TASK_TITLE_TAKEN             = (title: string) => `Task with title "${title}" already exists in this project.`;

// ─── Projects ─────────────────────────────────────────────────────────────────

export const PROJECT_NOT_FOUND            = "Project not found";
export const PROJECT_NOT_FOUND_OR_DENIED  = "Project not found or access denied";
export const PROJECT_CREATE_FAILED        = "Failed to create project";
export const PROJECT_NOT_MEMBER           = "Access denied. You are not a member of this project.";
export const PROJECT_WRONG_ORG            = "Project does not belong to your organization";
export const PROJECT_MEMBERS_EMPTY        = "assignedUserIds cannot be empty. Omit the field to keep current members.";
export const INVALID_PROJECT_MEMBERS      = "One or more assigned users do not belong to this organization";
export const USER_NO_ORG                  = "User not assigned to an organization";
export const PROJECT_DELETED              = "Project and associated tasks deleted successfully";
export const PROJECT_PENDING_TASKS        = (count: number) => `Cannot delete project. There are still ${count} pending tasks.`;

// ─── Tasks ────────────────────────────────────────────────────────────────────

export const TASK_NOT_FOUND               = "Task not found";
export const TASK_NOT_FOUND_OR_DENIED     = "Task not found or access denied";
export const TASK_CREATE_FAILED           = "Failed to create task";
export const TASK_DELETED                 = "Task deleted successfully";
export const TASK_NOT_ASSIGNED            = "Access denied. Task not assigned to you.";
export const ONLY_COMPLETED_CAN_DELETE    = "Only completed tasks can be deleted";
export const ONLY_ADMINS_CAN_REOPEN       = "Only admins and superadmins can reopen completed tasks";
export const ASSIGNED_USER_IDS_EMPTY      = "assignedUserIds cannot be empty. Omit the field to keep current assignees.";
export const INVALID_ASSIGNEES            = "One or more assigned users are not members of this project";
export const INVALID_SUBTASK_ASSIGNEES    = "One or more assigned users are not assigned to the parent task";
export const PARENT_TASK_NOT_FOUND        = "Parent task not found";
export const SUBTASK_WRONG_PROJECT        = "Subtask must belong to the same project as its parent";
export const SUBTASK_MAX_DEPTH            = "Cannot create a subtask of a subtask. Max 1 level deep.";
export const INVALID_STATUS_TRANSITION    = (from: string, to: string) => `Cannot transition from "${from}" to "${to}"`;
export const SUBTASK_LOCKED_BY_PARENT     = "Cannot change the status of a subtask while its parent task is completed or on hold. Update the parent task status first.";
export const INCOMPLETE_SUBTASKS          = (n: number) => `Cannot complete this task: ${n} subtask(s) are not yet completed`;

// ─── Comments ─────────────────────────────────────────────────────────────────

export const COMMENT_NOT_FOUND            = "Comment not found";
export const COMMENT_EDIT_OWN             = "You can only edit your own comments";
export const COMMENT_DELETE_OWN           = "You can only delete your own comments";

// ─── Attachments ──────────────────────────────────────────────────────────────

export const ATTACHMENT_NOT_FOUND         = "Attachment not found";
export const ATTACHMENT_DELETE_OWN        = "You can only delete your own attachments";

// ─── Uploads / Storage ────────────────────────────────────────────────────────

export const BUCKET_NOT_CONFIGURED        = "B2_BUCKET_NAME is not configured";
export const UPLOAD_URL_FAILED            = "Failed to generate upload URL";
export const DOWNLOAD_URL_FAILED          = "Failed to generate download URL";

// ─── Data Transfer ────────────────────────────────────────────────────────────

export const EXPORT_NO_TASKS                  = "No tasks found to export";
export const IMPORT_TASK_FAILED               = "Failed to create one or more tasks during import";
export const IMPORT_PROJECT_FAILED            = "Failed to create project during import";
export const IMPORT_ORG_FAILED                = "Failed to create organization during import";
export const USER_CREATE_FAILED_IMPORT        = "Failed to create one or more users during import";

// ─── General ──────────────────────────────────────────────────────────────────

export const ACCESS_DENIED                = "Access denied";
export const NO_ORG_ASSIGNED              = "No organization assigned";
export const NOT_PROJECT_MEMBER           = "You are not a member of this project";
export const INVALID_JSON                 = "Invalid JSON request body";
export const INTERNAL_SERVER_ERROR        = "Internal Server Error";
export const UNAUTHORIZED                 = "Unauthorized";
export const FORBIDDEN                    = "Forbidden";
