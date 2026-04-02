import {pgTable,serial,varchar,text,integer,timestamp} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  email: varchar("email", { length: 150 }).notNull().unique(),
  password: text("password").notNull(),
  role: varchar("role", { length: 20 }).notNull().default("DEVELOPER"),
  createdAt: timestamp("created_at").defaultNow()
});

export const sessions = pgTable("sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  refreshToken: text("refresh_token").notNull().unique(),
  deviceInfo: text("device_info"),
  createdAt: timestamp("created_at").defaultNow(),
  expiresAt: timestamp("expires_at").notNull()
});

export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 150 }).notNull(),
  description: text("description"),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow()
});

export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 150 }).notNull(),
  description: text("description"),
  status: varchar("status", { length: 50 }).default("PENDING"),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
  assignedTo: integer("assigned_to").references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow()
});
