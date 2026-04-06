import { pgTable, foreignKey, unique, serial, integer, text, timestamp, varchar, boolean, bigint } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const sessions = pgTable("sessions", {
	id: serial().primaryKey().notNull(),
	userId: integer("user_id").notNull(),
	refreshToken: text("refresh_token").notNull(),
	deviceInfo: text("device_info"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	expiresAt: timestamp("expires_at", { mode: 'string' }).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "sessions_user_id_users_id_fk"
		}).onDelete("cascade"),
	unique("sessions_refresh_token_unique").on(table.refreshToken),
]);

export const projects = pgTable("projects", {
	id: serial().primaryKey().notNull(),
	name: varchar({ length: 150 }).notNull(),
	description: text(),
	createdBy: integer("created_by"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	deleted: boolean().default(false).notNull(),
	deletedAt: timestamp("deleted_at", { mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "projects_created_by_users_id_fk"
		}).onDelete("cascade"),
]);

export const users = pgTable("users", {
	id: serial().primaryKey().notNull(),
	name: varchar({ length: 100 }).notNull(),
	email: varchar({ length: 150 }).notNull(),
	password: text(),
	role: varchar({ length: 20 }).default('DEVELOPER').notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	isActive: boolean("is_active").default(true).notNull(),
}, (table) => [
	unique("users_email_unique").on(table.email),
]);

export const tasks = pgTable("tasks", {
	id: serial().primaryKey().notNull(),
	title: varchar({ length: 150 }).notNull(),
	description: text(),
	status: varchar({ length: 50 }).default('PENDING'),
	projectId: integer("project_id"),
	assignedTo: integer("assigned_to"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	priority: varchar({ length: 20 }).default('MEDIUM'),
	dueDate: timestamp("due_date", { mode: 'string' }),
	deleted: boolean().default(false).notNull(),
	deletedAt: timestamp("deleted_at", { mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.assignedTo],
			foreignColumns: [users.id],
			name: "tasks_assigned_to_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.projectId],
			foreignColumns: [projects.id],
			name: "tasks_project_id_projects_id_fk"
		}).onDelete("cascade"),
]);

export const otps = pgTable("otps", {
	id: serial().primaryKey().notNull(),
	email: varchar({ length: 150 }).notNull(),
	otpHash: text("otp_hash").notNull(),
	expiresAt: timestamp("expires_at", { mode: 'string' }).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
});

export const files = pgTable("files", {
	id: serial().primaryKey().notNull(),
	name: text().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	size: bigint({ mode: "number" }).notNull(),
	mimeType: text("mime_type").notNull(),
	type: text().notNull(),
	path: text().notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("files_path_unique").on(table.path),
]);

export const taskAssignments = pgTable("task_assignments", {
	id: serial().primaryKey().notNull(),
	taskId: integer("task_id").notNull(),
	userId: integer("user_id").notNull(),
	assignedAt: timestamp("assigned_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.taskId],
			foreignColumns: [tasks.id],
			name: "task_assignments_task_id_tasks_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "task_assignments_user_id_users_id_fk"
		}).onDelete("cascade"),
]);
