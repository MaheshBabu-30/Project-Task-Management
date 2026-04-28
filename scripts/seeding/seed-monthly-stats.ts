import "dotenv/config";
import { db } from "../../src/config/db.js";
import { organizations, projects, orgMembers, tasks, taskAssignees } from "../../src/db/schema/index.js";
import { eq, and, isNull } from "drizzle-orm";

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Returns a Date N days before the given date string
const daysBefore = (dateStr: string, days: number): Date => {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - days);
  return d;
};

// ─── Task definitions per month ───────────────────────────────────────────────

const FEBRUARY_COMPLETED = [
  { title: "[Feb] Finalise API contracts",        dueDate: "2026-02-05", createdAt: daysBefore("2026-02-05", 7), completedAt: new Date("2026-02-05T10:00:00Z") },
  { title: "[Feb] Set up staging environment",    dueDate: "2026-02-09", createdAt: daysBefore("2026-02-09", 7), completedAt: new Date("2026-02-09T14:00:00Z") },
  { title: "[Feb] Database migration v1",         dueDate: "2026-02-13", createdAt: daysBefore("2026-02-13", 7), completedAt: new Date("2026-02-13T11:30:00Z") },
  { title: "[Feb] Auth module code review",       dueDate: "2026-02-19", createdAt: daysBefore("2026-02-19", 7), completedAt: new Date("2026-02-19T16:00:00Z") },
  { title: "[Feb] Deploy hotfix to production",   dueDate: "2026-02-24", createdAt: daysBefore("2026-02-24", 7), completedAt: new Date("2026-02-24T09:00:00Z") },
];

const MARCH_COMPLETED = [
  { title: "[Mar] Refactor task service",         dueDate: "2026-03-04", createdAt: daysBefore("2026-03-04", 7), completedAt: new Date("2026-03-04T10:00:00Z") },
  { title: "[Mar] Write integration tests",       dueDate: "2026-03-12", createdAt: daysBefore("2026-03-12", 7), completedAt: new Date("2026-03-12T15:00:00Z") },
  { title: "[Mar] Release v1.2.0",                dueDate: "2026-03-21", createdAt: daysBefore("2026-03-21", 7), completedAt: new Date("2026-03-21T12:00:00Z") },
];

const MARCH_OVERDUE = [
  { title: "[Mar] Update API documentation",      dueDate: "2026-03-08", createdAt: daysBefore("2026-03-08", 7) },
  { title: "[Mar] Performance audit report",      dueDate: "2026-03-15", createdAt: daysBefore("2026-03-15", 7) },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

const seed = async () => {
  console.log("📅 Seeding monthly stats (Feb/Mar 2026)...\n");

  try {
    const allOrgs = await db
      .select({ id: organizations.id, slug: organizations.slug })
      .from(organizations)
      .where(isNull(organizations.deletedAt));

    if (allOrgs.length === 0) {
      console.log("⚠️  No organizations found. Run the main seed first.");
      process.exit(0);
    }

    console.log(`🏢 Found ${allOrgs.length} organization(s)\n`);

    for (const org of allOrgs) {
      console.log(`   🔧 ${org.slug}`);

      // Pick the first active project in this org
      const [project] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.orgId, org.id), isNull(projects.deletedAt)))
        .limit(1);

      if (!project) {
        console.log(`      ⚠️  No project found — skipping\n`);
        continue;
      }

      // Get admin as task creator
      const [adminMember] = await db
        .select({ userId: orgMembers.userId })
        .from(orgMembers)
        .where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.role, "admin")))
        .limit(1);

      // Get 2 members for assignees
      const members = await db
        .select({ userId: orgMembers.userId })
        .from(orgMembers)
        .where(eq(orgMembers.orgId, org.id))
        .limit(2);

      const createdBy = adminMember?.userId ?? members[0]?.userId;
      const assigneeIds = members.map((m) => m.userId);

      if (!createdBy) {
        console.log(`      ⚠️  No members found — skipping\n`);
        continue;
      }

      let inserted = 0;

      // ── February: 5 completed ───────────────────────────────────────────────
      for (const t of FEBRUARY_COMPLETED) {
        const [existing] = await db
          .select({ id: tasks.id })
          .from(tasks)
          .where(and(eq(tasks.projectId, project.id), eq(tasks.title, t.title), isNull(tasks.deletedAt)))
          .limit(1);

        if (existing) continue;

        const [row] = await db
          .insert(tasks)
          .values({
            projectId: project.id,
            title: t.title,
            status: "completed",
            priority: "medium",
            dueDate: new Date(t.dueDate),
            createdBy,
            completedAt: t.completedAt,
            createdAt: t.createdAt,
            updatedAt: t.completedAt,
          })
          .returning({ id: tasks.id });

        for (const userId of assigneeIds) {
          await db
            .insert(taskAssignees)
            .values({ taskId: row.id, userId, assignedBy: createdBy })
            .onConflictDoNothing();
        }

        inserted++;
      }

      // ── March: 3 completed ─────────────────────────────────────────────────
      for (const t of MARCH_COMPLETED) {
        const [existing] = await db
          .select({ id: tasks.id })
          .from(tasks)
          .where(and(eq(tasks.projectId, project.id), eq(tasks.title, t.title), isNull(tasks.deletedAt)))
          .limit(1);

        if (existing) continue;

        const [row] = await db
          .insert(tasks)
          .values({
            projectId: project.id,
            title: t.title,
            status: "completed",
            priority: "medium",
            dueDate: new Date(t.dueDate),
            createdBy,
            completedAt: t.completedAt,
            createdAt: t.createdAt,
            updatedAt: t.completedAt,
          })
          .returning({ id: tasks.id });

        for (const userId of assigneeIds) {
          await db
            .insert(taskAssignees)
            .values({ taskId: row.id, userId, assignedBy: createdBy })
            .onConflictDoNothing();
        }

        inserted++;
      }

      // ── March: 2 overdue ───────────────────────────────────────────────────
      for (const t of MARCH_OVERDUE) {
        const [existing] = await db
          .select({ id: tasks.id })
          .from(tasks)
          .where(and(eq(tasks.projectId, project.id), eq(tasks.title, t.title), isNull(tasks.deletedAt)))
          .limit(1);

        if (existing) continue;

        const [row] = await db
          .insert(tasks)
          .values({
            projectId: project.id,
            title: t.title,
            status: "overdue",
            priority: "high",
            dueDate: new Date(t.dueDate),
            createdBy,
            createdAt: t.createdAt,
            updatedAt: t.createdAt,
          })
          .returning({ id: tasks.id });

        for (const userId of assigneeIds) {
          await db
            .insert(taskAssignees)
            .values({ taskId: row.id, userId, assignedBy: createdBy })
            .onConflictDoNothing();
        }

        inserted++;
      }

      console.log(`      ✅ ${inserted} task(s) inserted (${10 - inserted} already existed)\n`);
    }

    console.log("✅ Monthly stats seed completed!\n");
    console.log("   Feb 2026 → 5 completed");
    console.log("   Mar 2026 → 3 completed, 2 overdue");
    process.exit(0);
  } catch (error) {
    console.error("❌ Seed failed:", error);
    process.exit(1);
  }
};

seed();
