import { db } from "../../config/db.js";
import { attachments, tasks, projects, taskAssignees, users } from "../../db/schema.js";
import { eq, and, isNull, ilike, asc, desc, count, inArray } from "drizzle-orm";
import { ForbiddenException, NotFoundException, InternalServerException } from "../../exceptions/index.js";
import { TASK_NOT_FOUND, NO_ORG_ASSIGNED, ACCESS_DENIED, TASK_NOT_ASSIGNED, ATTACHMENT_NOT_FOUND, ATTACHMENT_DELETE_OWN } from "../../constants/appMessages.js";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { s3Client, B2_BUCKET_NAME } from "../../config/s3.js";
import type { UserSummary } from "../../types/common.types.js";

type User = { userId: string; role: string; orgId?: string };

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
};

// ─── Get Single Attachment ────────────────────────────────────────────────────

export const getAttachmentById = async (attachmentId: string, taskId: string, user: User) => {
  await verifyTaskAccess(taskId, user);

  const [attachment] = await db
    .select()
    .from(attachments)
    .where(and(eq(attachments.id, attachmentId), eq(attachments.taskId, taskId)));

  if (!attachment) throw new NotFoundException(ATTACHMENT_NOT_FOUND);

  const [uploader] = attachment.uploadedBy
    ? await db
        .select({ id: users.id, name: users.name, email: users.email, avatarUrl: users.avatarUrl })
        .from(users)
        .where(eq(users.id, attachment.uploadedBy))
    : [null];

  return { ...attachment, uploader: uploader ?? null };
};

// ─── List Attachments ─────────────────────────────────────────────────────────

export const getAttachments = async (
  taskId: string,
  user: User,
  query?: { page?: number; limit?: number; uploadedBy?: string; mimeType?: string; sortBy?: string; order?: string }
) => {
  await verifyTaskAccess(taskId, user);

  const { page = 1, limit = 20, uploadedBy, mimeType, sortBy = "createdAt", order = "asc" } = query ?? {};
  const offset = (page - 1) * limit;

  const conditions = [eq(attachments.taskId, taskId)];
  if (uploadedBy) conditions.push(eq(attachments.uploadedBy, uploadedBy));
  if (mimeType) conditions.push(ilike(attachments.mimeType, `%${mimeType}%`));

  const whereCondition = and(...conditions);

  const validColumns = {
    id: attachments.id,
    fileName: attachments.fileName,
    fileSize: attachments.fileSize,
    createdAt: attachments.createdAt,
  } as const;
  const orderColumn = (sortBy in validColumns ? validColumns[sortBy as keyof typeof validColumns] : attachments.createdAt);
  const orderDirection = order === "desc" ? desc(orderColumn) : asc(orderColumn);

  const [rawData, countResult] = await Promise.all([
    db.select().from(attachments).where(whereCondition).orderBy(orderDirection).limit(limit).offset(offset),
    db.select({ total: count() }).from(attachments).where(whereCondition),
  ]);

  const uploaderIds = [...new Set(rawData.map((a) => a.uploadedBy).filter(Boolean))] as string[];
  const uploadersMap: Record<string, UserSummary> = {};
  if (uploaderIds.length > 0) {
    const uploaders = await db
      .select({ id: users.id, name: users.name, email: users.email, avatarUrl: users.avatarUrl })
      .from(users)
      .where(inArray(users.id, uploaderIds));
    uploaders.forEach((u) => { uploadersMap[u.id] = u; });
  }

  const data = rawData.map((a) => ({
    ...a,
    uploader: a.uploadedBy ? (uploadersMap[a.uploadedBy] ?? null) : null,
  }));

  return { data, totalRecords: countResult[0]?.total ?? 0 };
};

// ─── Link Attachment to Task ──────────────────────────────────────────────────

export const linkAttachment = async (
  taskId: string,
  data: { s3Key: string; fileName: string; mimeType: string; fileSize: number },
  user: User
) => {
  await verifyTaskAccess(taskId, user);

  const [attachment] = await db
    .insert(attachments)
    .values({ taskId, uploadedBy: user.userId, ...data })
    .returning();

  if (!attachment) throw new InternalServerException("Failed to link attachment");

  const [uploader] = await db
    .select({ id: users.id, name: users.name, email: users.email, avatarUrl: users.avatarUrl })
    .from(users)
    .where(eq(users.id, user.userId));

  return { ...attachment, uploader: uploader ?? null };
};

// ─── Delete Attachment ────────────────────────────────────────────────────────

export const removeAttachment = async (attachmentId: string, user: User) => {
  const [attachment] = await db
    .select()
    .from(attachments)
    .where(eq(attachments.id, attachmentId));

  if (!attachment) throw new NotFoundException(ATTACHMENT_NOT_FOUND);

  await verifyTaskAccess(attachment.taskId, user);

  if (user.role !== "admin" && user.role !== "superadmin" && attachment.uploadedBy !== user.userId) {
    throw new ForbiddenException(ATTACHMENT_DELETE_OWN);
  }

  if (B2_BUCKET_NAME) {
    try {
      await s3Client.send(new DeleteObjectCommand({
        Bucket: B2_BUCKET_NAME,
        Key: attachment.s3Key,
      }));
    } catch (err) {
      console.error("[attachment] Failed to delete S3 object:", err);
    }
  }

  await db.delete(attachments).where(eq(attachments.id, attachmentId));

  return { message: "Attachment deleted successfully" };
};
