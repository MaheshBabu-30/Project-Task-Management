import { db } from "../../config/db.js";
import { comments, commentMentions, tasks, projects, taskAssignees, orgMembers, users } from "../../db/schema.js";
import { eq, and, isNull, isNotNull, asc, desc, count, inArray } from "drizzle-orm";
import { BadRequestException, ForbiddenException, NotFoundException, InternalServerException } from "../../exceptions/index.js";
import { TASK_NOT_FOUND, NO_ORG_ASSIGNED, ACCESS_DENIED, TASK_NOT_ASSIGNED, COMMENT_NOT_FOUND, COMMENT_EDIT_OWN, COMMENT_DELETE_OWN } from "../../constants/appMessages.js";
import { createNotification } from "../notifications/notification.service.js";
import { catchError } from "../../utils/logger.js";
import type { UserSummary, PaginationQuery } from "../../types/common.types.js";

type User = { userId: string; role: string; orgId?: string };

interface CommentQuery extends PaginationQuery {
  authorId?: string;
}

// ─── Parse @<uuid> mentions from body ────────────────────────────────────────

const parseMentionIds = (body: string): string[] => {
  const matches = body.match(/@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi) ?? [];
  return [...new Set(matches.map((m) => m.slice(1).toLowerCase()))]; // strip leading @, deduplicate
};

// ─── Verify task access ───────────────────────────────────────────────────────

const verifyTaskAccess = async (taskId: string, user: User) => {
  const [task] = await db
    .select({ id: tasks.id, projectId: tasks.projectId })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), isNull(tasks.deletedAt)));

  if (!task) throw new NotFoundException(TASK_NOT_FOUND);

  if (user.role !== "superadmin") {
    if (!user.orgId) throw new ForbiddenException(NO_ORG_ASSIGNED);

    const [project] = await db
      .select({ orgId: projects.orgId })
      .from(projects)
      .where(eq(projects.id, task.projectId));

    if (project?.orgId !== user.orgId) throw new ForbiddenException(ACCESS_DENIED);

    if (user.role === "developer") {
      const [assigned] = await db
        .select()
        .from(taskAssignees)
        .where(and(eq(taskAssignees.taskId, taskId), eq(taskAssignees.userId, user.userId)));
      if (!assigned) throw new ForbiddenException(TASK_NOT_ASSIGNED);
    }
  }

  return task;
};

// ─── Validate mentioned users have task access ────────────────────────────────

const validateMentionedUsers = async (
  mentionedIds: string[],
  projectId: string
): Promise<void> => {
  if (mentionedIds.length === 0) return;

  // Get the org that owns the project
  const [project] = await db
    .select({ orgId: projects.orgId })
    .from(projects)
    .where(eq(projects.id, projectId));

  if (!project) return;

  // Valid: org members (any role) + superadmins
  const [orgMemberRows, superadmins] = await Promise.all([
    db
      .select({ userId: orgMembers.userId })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, project.orgId), inArray(orgMembers.userId, mentionedIds))),
    db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, "superadmin"), inArray(users.id, mentionedIds))),
  ]);

  const validIds = new Set([
    ...orgMemberRows.map((r) => r.userId),
    ...superadmins.map((r) => r.id),
  ]);

  const invalid = mentionedIds.filter((id) => !validIds.has(id));
  if (invalid.length > 0) {
    throw new BadRequestException("Mentioned users must have access to this task");
  }
};

// ─── Build recursive comment tree ────────────────────────────────────────────

type RawComment = {
  id: string; taskId: string; authorId: string | null;
  parentCommentId: string | null; body: string;
  createdAt: Date | null; updatedAt: Date | null; deletedAt: Date | null;
};
type CommentNode = RawComment & { author: UserSummary | null; mentions: UserSummary[]; replies: CommentNode[] };

const buildTree = (
  all: RawComment[],
  parentId: string | null,
  authorsMap: Record<string, UserSummary>,
  mentionsMap: Record<string, UserSummary[]>
): CommentNode[] => {
  return all
    .filter((c) => c.parentCommentId === parentId)
    .map((c) => ({
      ...c,
      author: c.authorId ? (authorsMap[c.authorId] ?? null) : null,
      mentions: mentionsMap[c.id] ?? [],
      replies: buildTree(all, c.id, authorsMap, mentionsMap),
    }));
};

// ─── Collect all descendant comment IDs (recursive) ──────────────────────────

const collectDescendantIds = (
  all: { id: string; parentCommentId: string | null }[],
  parentId: string
): string[] => {
  const children = all.filter((c) => c.parentCommentId === parentId);
  return children.flatMap((c) => [c.id, ...collectDescendantIds(all, c.id)]);
};

// ─── List Comments ────────────────────────────────────────────────────────────

export const getComments = async (
  taskId: string,
  user: User,
  query: CommentQuery
) => {
  await verifyTaskAccess(taskId, user);

  const { page = 1, limit = 20, order = "asc", authorId } = query;
  const offset = (page - 1) * limit;

  const topLevelConditions = [eq(comments.taskId, taskId), isNull(comments.deletedAt), isNull(comments.parentCommentId)];
  if (authorId) topLevelConditions.push(eq(comments.authorId, authorId));

  const [topLevel, countResult, allDescendants] = await Promise.all([
    db
      .select()
      .from(comments)
      .where(and(...topLevelConditions))
      .orderBy(order === "desc" ? desc(comments.createdAt) : asc(comments.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(comments).where(and(...topLevelConditions)),
    db
      .select()
      .from(comments)
      .where(and(eq(comments.taskId, taskId), isNull(comments.deletedAt), isNotNull(comments.parentCommentId)))
      .orderBy(asc(comments.createdAt)),
  ]);

  const allRows = [...topLevel, ...allDescendants];
  const allIds = allRows.map((c) => c.id);
  const authorIds = [...new Set(allRows.map((c) => c.authorId).filter(Boolean))] as string[];

  const authorsMap: Record<string, UserSummary> = {};
  const mentionsMap: Record<string, UserSummary[]> = {};

  await Promise.all([
    authorIds.length > 0
      ? db
          .select({ id: users.id, name: users.name, email: users.email, avatarUrl: users.avatarUrl })
          .from(users)
          .where(inArray(users.id, authorIds))
          .then((rows) => rows.forEach((a) => { authorsMap[a.id] = a; }))
      : Promise.resolve(),
    allIds.length > 0
      ? db
          .select({
            commentId: commentMentions.commentId,
            id: users.id,
            name: users.name,
            email: users.email,
            avatarUrl: users.avatarUrl,
          })
          .from(commentMentions)
          .innerJoin(users, eq(commentMentions.userId, users.id))
          .where(inArray(commentMentions.commentId, allIds))
          .then((rows) => {
            rows.forEach((r) => {
              if (!mentionsMap[r.commentId]) mentionsMap[r.commentId] = [];
              mentionsMap[r.commentId]!.push({ id: r.id, name: r.name, email: r.email, avatarUrl: r.avatarUrl });
            });
          })
      : Promise.resolve(),
  ]);

  const data = topLevel.map((c) => ({
    ...c,
    author: c.authorId ? (authorsMap[c.authorId] ?? null) : null,
    mentions: mentionsMap[c.id] ?? [],
    replies: buildTree(allDescendants, c.id, authorsMap, mentionsMap),
  }));

  return { data, totalRecords: countResult[0]?.total ?? 0 };
};

// ─── Create Comment ───────────────────────────────────────────────────────────

export const createComment = async (
  taskId: string,
  body: string,
  user: User,
  parentCommentId?: string,
) => {
  const task = await verifyTaskAccess(taskId, user);

  // Validate parent comment exists and belongs to same task
  let parentAuthorId: string | null = null;
  if (parentCommentId) {
    const [parent] = await db
      .select({ id: comments.id, taskId: comments.taskId, authorId: comments.authorId })
      .from(comments)
      .where(and(eq(comments.id, parentCommentId), isNull(comments.deletedAt)))
      .limit(1);

    if (!parent) throw new NotFoundException("Parent comment not found");
    if (parent.taskId !== taskId) throw new NotFoundException("Parent comment does not belong to this task");
    parentAuthorId = parent.authorId;
  }

  // Parse @<uuid> mentions from body
  const mentionedIds = parseMentionIds(body);

  // Validate mentioned users have access to the task
  if (mentionedIds.length > 0) {
    await validateMentionedUsers(mentionedIds, task.projectId);
  }

  const [comment] = await db
    .insert(comments)
    .values({ taskId, authorId: user.userId, body, parentCommentId: parentCommentId ?? null })
    .returning();

  if (!comment) throw new InternalServerException("Failed to create comment");

  // Store mentions and send mention notifications (fire-and-forget)
  if (mentionedIds.length > 0) {
    db.insert(commentMentions)
      .values(mentionedIds.map((userId) => ({ commentId: comment.id, userId })))
      .then(() => {
        for (const userId of mentionedIds) {
          if (userId === user.userId) continue;
          createNotification({
            userId,
            type: "comment_mentioned",
            title: "You were mentioned in a comment",
            body: `${body.slice(0, 100)}${body.length > 100 ? "..." : ""}`,
            entityType: "task",
            entityId: taskId,
          }).catch(catchError("createComment:mentionNotify"));
        }
      })
      .catch(catchError("createComment:insertMentions"));
  }

  // Notify parent comment author of the reply (fire-and-forget)
  if (parentAuthorId && parentAuthorId !== user.userId && !mentionedIds.includes(parentAuthorId)) {
    createNotification({
      userId: parentAuthorId,
      type: "comment_replied",
      title: "Someone replied to your comment",
      body: `${body.slice(0, 100)}${body.length > 100 ? "..." : ""}`,
      entityType: "task",
      entityId: taskId,
    }).catch(catchError("createComment:replyNotify"));
  }

  // Notify other task assignees (fire-and-forget) — skip those already notified
  db.select({ userId: taskAssignees.userId })
    .from(taskAssignees)
    .where(eq(taskAssignees.taskId, taskId))
    .then((assignees) => {
      const alreadyNotified = new Set([...mentionedIds, parentAuthorId ?? "", user.userId]);
      for (const assignee of assignees) {
        if (alreadyNotified.has(assignee.userId)) continue;
        createNotification({
          userId: assignee.userId,
          type: "comment_added",
          title: "New comment on your task",
          body: `${body.slice(0, 100)}${body.length > 100 ? "..." : ""}`,
          entityType: "task",
          entityId: taskId,
        }).catch(catchError("createComment:notify"));
      }
    })
    .catch(catchError("createComment:fetchAssignees"));

  // Fetch mentions for response
  const mentions: UserSummary[] = mentionedIds.length > 0
    ? await db
        .select({ id: users.id, name: users.name, email: users.email, avatarUrl: users.avatarUrl })
        .from(users)
        .where(inArray(users.id, mentionedIds))
    : [];

  const [author] = await db
    .select({ id: users.id, name: users.name, email: users.email, avatarUrl: users.avatarUrl })
    .from(users)
    .where(eq(users.id, user.userId));

  return { ...comment, author: author ?? null, mentions };
};

// ─── Update Comment ───────────────────────────────────────────────────────────

export const updateComment = async (commentId: string, body: string, user: User) => {
  const [comment] = await db
    .select()
    .from(comments)
    .where(and(eq(comments.id, commentId), isNull(comments.deletedAt)));

  if (!comment) throw new NotFoundException(COMMENT_NOT_FOUND);

  await verifyTaskAccess(comment.taskId, user);

  if (comment.authorId !== user.userId) throw new ForbiddenException(COMMENT_EDIT_OWN);

  const [updated] = await db
    .update(comments)
    .set({ body, updatedAt: new Date() })
    .where(eq(comments.id, commentId))
    .returning();

  if (!updated) throw new NotFoundException(COMMENT_NOT_FOUND);

  const [author] = updated.authorId
    ? await db
        .select({ id: users.id, name: users.name, email: users.email, avatarUrl: users.avatarUrl })
        .from(users)
        .where(eq(users.id, updated.authorId))
    : [null];

  return { ...updated, author: author ?? null };
};

// ─── Delete Comment ───────────────────────────────────────────────────────────

export const deleteComment = async (commentId: string, user: User) => {
  const [comment] = await db
    .select()
    .from(comments)
    .where(and(eq(comments.id, commentId), isNull(comments.deletedAt)));

  if (!comment) throw new NotFoundException(COMMENT_NOT_FOUND);

  await verifyTaskAccess(comment.taskId, user);

  if (user.role !== "admin" && user.role !== "superadmin" && comment.authorId !== user.userId) {
    throw new ForbiddenException(COMMENT_DELETE_OWN);
  }

  // Fetch all non-deleted comments for this task to find descendants
  const allTaskComments = await db
    .select({ id: comments.id, parentCommentId: comments.parentCommentId })
    .from(comments)
    .where(and(eq(comments.taskId, comment.taskId), isNull(comments.deletedAt)));

  const descendantIds = collectDescendantIds(allTaskComments, commentId);
  const idsToDelete = [commentId, ...descendantIds];

  await db
    .update(comments)
    .set({ deletedAt: new Date() })
    .where(inArray(comments.id, idsToDelete));

  return { message: `Comment and ${descendantIds.length} reply(s) deleted successfully` };
};
