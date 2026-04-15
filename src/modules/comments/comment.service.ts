import { db } from "../../config/db.js";
import { comments, tasks, projects, taskAssignees } from "../../../drizzle/schema.js";
import { eq, and, isNull, asc, desc, count } from "drizzle-orm";
import { AppError } from "../../utils/errors.js";
import { createNotification } from "../notifications/notification.service.js";

type User = { userId: string; role: string; orgId?: string };

// ─── Verify task access ───────────────────────────────────────────────────────

const verifyTaskAccess = async (taskId: string, user: User) => {
  const [task] = await db
    .select({ id: tasks.id, projectId: tasks.projectId })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), isNull(tasks.deletedAt)));

  if (!task) throw new AppError("Task not found", 404);

  if (user.role !== "superadmin") {
    if (!user.orgId) throw new AppError("No organization assigned", 403);

    const [project] = await db
      .select({ orgId: projects.orgId })
      .from(projects)
      .where(eq(projects.id, task.projectId));

    if (project?.orgId !== user.orgId) throw new AppError("Access denied", 403);

    if (user.role === "developer") {
      const [assigned] = await db
        .select()
        .from(taskAssignees)
        .where(and(eq(taskAssignees.taskId, taskId), eq(taskAssignees.userId, user.userId)));
      if (!assigned) throw new AppError("Access denied. Task not assigned to you.", 403);
    }
  }

  return task;
};

// ─── List Comments ────────────────────────────────────────────────────────────

export const getComments = async (
  taskId: string,
  user: User,
  query: { page?: number; limit?: number; order?: string }
) => {
  await verifyTaskAccess(taskId, user);

  const { page = 1, limit = 20, order = "asc" } = query;
  const offset = (page - 1) * limit;

  const whereCondition = and(eq(comments.taskId, taskId), isNull(comments.deletedAt));

  const [data, countResult] = await Promise.all([
    db
      .select()
      .from(comments)
      .where(whereCondition)
      .orderBy(order === "desc" ? desc(comments.createdAt) : asc(comments.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(comments).where(whereCondition),
  ]);

  return { data, totalRecords: countResult[0]?.total ?? 0 };
};

// ─── Create Comment ───────────────────────────────────────────────────────────

export const createComment = async (taskId: string, body: string, user: User) => {
  await verifyTaskAccess(taskId, user);

  const [comment] = await db
    .insert(comments)
    .values({ taskId, authorId: user.userId, body })
    .returning();

  // Notify all task assignees except the commenter (fire-and-forget)
  db.select({ userId: taskAssignees.userId })
    .from(taskAssignees)
    .where(eq(taskAssignees.taskId, taskId))
    .then((assignees) => {
      for (const assignee of assignees) {
        if (assignee.userId === user.userId) continue; // skip the commenter
        createNotification({
          userId: assignee.userId,
          type: "comment_added",
          title: "New comment on your task",
          body: `${body.slice(0, 100)}${body.length > 100 ? "..." : ""}`,
          entityType: "task",
          entityId: taskId,
        }).catch(console.error);
      }
    })
    .catch(console.error);

  return comment;
};

// ─── Update Comment ───────────────────────────────────────────────────────────

export const updateComment = async (commentId: string, body: string, user: User) => {
  const [comment] = await db
    .select()
    .from(comments)
    .where(and(eq(comments.id, commentId), isNull(comments.deletedAt)));

  if (!comment) throw new AppError("Comment not found", 404);

  // Verify requester still has access to the task (prevents cross-org edits)
  await verifyTaskAccess(comment.taskId, user);

  // Only the author can edit their own comment
  if (comment.authorId !== user.userId) {
    throw new AppError("You can only edit your own comments", 403);
  }

  const [updated] = await db
    .update(comments)
    .set({ body, updatedAt: new Date() })
    .where(eq(comments.id, commentId))
    .returning();

  return updated;
};

// ─── Delete Comment ───────────────────────────────────────────────────────────

export const deleteComment = async (commentId: string, user: User) => {
  const [comment] = await db
    .select()
    .from(comments)
    .where(and(eq(comments.id, commentId), isNull(comments.deletedAt)));

  if (!comment) throw new AppError("Comment not found", 404);

  // Verify requester has access to the task (prevents cross-org IDOR for admins)
  await verifyTaskAccess(comment.taskId, user);

  // Author can delete their own; admin can delete any within their org
  if (user.role !== "admin" && user.role !== "superadmin" && comment.authorId !== user.userId) {
    throw new AppError("You can only delete your own comments", 403);
  }

  await db
    .update(comments)
    .set({ deletedAt: new Date() })
    .where(eq(comments.id, commentId));

  return { message: "Comment deleted successfully" };
};
