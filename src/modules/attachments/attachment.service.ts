import { db } from "../../config/db.js";
import { attachments, tasks, projects, taskAssignees, users } from "../../../drizzle/schema.js";
import { eq, and, isNull, ilike, asc, desc, count, inArray } from "drizzle-orm";
import { AppError } from "../../utils/errors.js";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { s3Client, B2_BUCKET_NAME } from "../../config/s3.js";

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
};

// ─── Get Single Attachment (with access check) ───────────────────────────────

export const getAttachmentById = async (attachmentId: string, taskId: string, user: User) => {
  await verifyTaskAccess(taskId, user);

  const [attachment] = await db
    .select()
    .from(attachments)
    .where(and(eq(attachments.id, attachmentId), eq(attachments.taskId, taskId)));

  if (!attachment) throw new AppError("Attachment not found", 404);

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

  const validColumns: Record<string, any> = {
    id: attachments.id,
    fileName: attachments.fileName,
    fileSize: attachments.fileSize,
    createdAt: attachments.createdAt,
  };
  const orderColumn = validColumns[sortBy] ?? attachments.createdAt;
  const orderDirection = order === "desc" ? desc(orderColumn) : asc(orderColumn);

  const [rawData, countResult] = await Promise.all([
    db.select().from(attachments).where(whereCondition).orderBy(orderDirection).limit(limit).offset(offset),
    db.select({ total: count() }).from(attachments).where(whereCondition),
  ]);

  // Batch fetch uploaders
  const uploaderIds = [...new Set(rawData.map((a) => a.uploadedBy).filter(Boolean))] as string[];
  const uploadersMap: Record<string, any> = {};
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

  if (!attachment) throw new AppError("Attachment not found", 404);

  // Verify requester has access to the task this attachment belongs to (prevents cross-org IDOR)
  await verifyTaskAccess(attachment.taskId, user);

  // Only uploader or admin/superadmin can delete
  if (user.role !== "admin" && user.role !== "superadmin" && attachment.uploadedBy !== user.userId) {
    throw new AppError("You can only delete your own attachments", 403);
  }

  // Delete from S3 first
  if (B2_BUCKET_NAME) {
    try {
      await s3Client.send(new DeleteObjectCommand({
        Bucket: B2_BUCKET_NAME,
        Key: attachment.s3Key,
      }));
    } catch (err) {
      console.error("[attachment] Failed to delete S3 object:", err);
      // Continue with DB deletion even if S3 fails — log but don't block
    }
  }

  await db.delete(attachments).where(eq(attachments.id, attachmentId));

  return { message: "Attachment removed successfully", s3Key: attachment.s3Key };
};
