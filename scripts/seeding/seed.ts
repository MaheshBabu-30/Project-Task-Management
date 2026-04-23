import "dotenv/config";
import bcrypt from "bcrypt";
import { db } from "../../src/config/db.js";
import {
  users,
  organizations,
  orgMembers,
  projects,
  projectMembers,
  tasks,
  taskAssignees,
  attachments,
  comments,
  commentMentions,
} from "../../src/db/schema.js";
import { and, eq, isNull } from "drizzle-orm";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const hashPassword = (p: string) => bcrypt.hash(p, 10);

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickN<T>(arr: T[], n: number): T[] {
  return [...arr].sort(() => Math.random() - 0.5).slice(0, Math.min(n, arr.length));
}

function without<T>(arr: T[], exclude: T): T[] {
  return arr.filter((x) => x !== exclude);
}

// ─── Counts ───────────────────────────────────────────────────────────────────

const DEVS_PER_ORG = 10;
const PROJECTS_PER_ORG = 5;
const TASKS_PER_PROJECT = 10;
const SUBTASKS_PER_TASK = 5;
const ATTACHMENTS_PER_TASK = 5;
const COMMENTS_PER_TASK = 10;
const MENTIONS_PER_COMMENT = 2;

// ─── New Orgs to Create ───────────────────────────────────────────────────────

const NEW_ORGS = [
  {
    name: "Acme Corp",
    slug: "acme-corp",
    description: "Building enterprise solutions for modern businesses",
  },
  {
    name: "Dev Studio",
    slug: "dev-studio",
    description: "Creative software development and consulting",
  },
];

// ─── Project Pool ─────────────────────────────────────────────────────────────

const PROJECT_POOL = [
  {
    title: "Website Redesign",
    description: "Redesign the company website with modern UI/UX principles and accessibility standards",
    status: "active" as const,
  },
  {
    title: "API Integration",
    description: "Integrate third-party APIs and improve backend performance with caching and optimisations",
    status: "active" as const,
  },
  {
    title: "Mobile App Development",
    description: "Build cross-platform mobile application for iOS and Android using React Native",
    status: "active" as const,
  },
  {
    title: "DevOps & Infrastructure",
    description: "Modernise CI/CD pipelines, containerise services, and migrate to cloud-native infrastructure",
    status: "active" as const,
  },
  {
    title: "Analytics Dashboard",
    description: "Build a real-time analytics dashboard with charts, filters, and exportable reports",
    status: "active" as const,
  },
];

// ─── Task Pool ────────────────────────────────────────────────────────────────

type TaskStatus = "to_do" | "in_progress" | "on_hold" | "overdue" | "completed";
type TaskPriority = "low" | "medium" | "high" | "urgent";

interface TaskTemplate {
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string;
}

const TASK_POOL: TaskTemplate[] = [
  {
    title: "Setup project infrastructure",
    description: "Initialize project structure, CI/CD pipeline, and development environment configuration",
    status: "in_progress",
    priority: "high",
    dueDate: "2026-05-15",
  },
  {
    title: "Design database schema",
    description: "Plan and implement the database schema with proper indexing, constraints, and relations",
    status: "to_do",
    priority: "medium",
    dueDate: "2026-05-30",
  },
  {
    title: "Implement authentication",
    description: "Build JWT-based authentication with refresh tokens, OTP support, and session management",
    status: "completed",
    priority: "urgent",
    dueDate: "2026-04-10",
  },
  {
    title: "Build REST API endpoints",
    description: "Implement all CRUD endpoints following REST conventions with proper validation and error handling",
    status: "in_progress",
    priority: "high",
    dueDate: "2026-05-20",
  },
  {
    title: "Create UI component library",
    description: "Build reusable UI components with Storybook documentation and accessibility support",
    status: "to_do",
    priority: "medium",
    dueDate: "2026-06-05",
  },
  {
    title: "Write unit and integration tests",
    description: "Achieve 80%+ test coverage with unit tests, integration tests, and E2E test suites",
    status: "to_do",
    priority: "medium",
    dueDate: "2026-06-15",
  },
  {
    title: "Setup monitoring and alerting",
    description: "Configure Prometheus, Grafana dashboards, and PagerDuty alerting for production observability",
    status: "on_hold",
    priority: "low",
    dueDate: "2026-06-30",
  },
  {
    title: "Implement caching layer",
    description: "Integrate Redis caching for hot data paths to reduce database load and improve response times",
    status: "to_do",
    priority: "high",
    dueDate: "2026-05-25",
  },
  {
    title: "Configure deployment pipeline",
    description: "Set up zero-downtime blue-green deployment pipeline with automated rollback capabilities",
    status: "in_progress",
    priority: "urgent",
    dueDate: "2026-05-10",
  },
  {
    title: "Conduct security audit",
    description: "Perform OWASP Top-10 security review, penetration testing, and dependency vulnerability scan",
    status: "to_do",
    priority: "urgent",
    dueDate: "2026-06-20",
  },
];

// ─── Subtask Pool ─────────────────────────────────────────────────────────────

const SUBTASK_POOL: TaskTemplate[] = [
  {
    title: "Review requirements and acceptance criteria",
    description: "Go through the ticket requirements and confirm acceptance criteria with the product owner",
    status: "completed",
    priority: "medium",
    dueDate: "2026-04-25",
  },
  {
    title: "Create technical design document",
    description: "Draft a technical design doc covering approach, trade-offs, and implementation plan",
    status: "to_do",
    priority: "medium",
    dueDate: "2026-05-02",
  },
  {
    title: "Write implementation code",
    description: "Implement the feature according to the approved technical design",
    status: "in_progress",
    priority: "high",
    dueDate: "2026-05-08",
  },
  {
    title: "Add unit tests",
    description: "Write unit tests covering happy paths, edge cases, and error scenarios",
    status: "to_do",
    priority: "medium",
    dueDate: "2026-05-12",
  },
  {
    title: "Update API documentation",
    description: "Document new or modified endpoints in the OpenAPI spec with request/response examples",
    status: "to_do",
    priority: "low",
    dueDate: "2026-05-14",
  },
  {
    title: "Perform code review",
    description: "Review the pull request for correctness, readability, security, and test coverage",
    status: "to_do",
    priority: "medium",
    dueDate: "2026-05-16",
  },
  {
    title: "Address review feedback",
    description: "Fix all blocking comments from code review and re-request review",
    status: "to_do",
    priority: "high",
    dueDate: "2026-05-18",
  },
  {
    title: "Deploy to staging environment",
    description: "Merge the PR and trigger a deployment to the staging environment for QA validation",
    status: "to_do",
    priority: "medium",
    dueDate: "2026-05-20",
  },
  {
    title: "Validate on staging",
    description: "Manually validate the feature on staging against the acceptance criteria before release",
    status: "to_do",
    priority: "high",
    dueDate: "2026-05-22",
  },
  {
    title: "Mark as production-ready",
    description: "Final sign-off from QA and product; update ticket status and notify stakeholders",
    status: "to_do",
    priority: "low",
    dueDate: "2026-05-24",
  },
];

// ─── Comment Pool (12 unique bodies) ─────────────────────────────────────────

const COMMENT_POOL = [
  "Started working on this. Will update the team once the initial setup is done.",
  "Ran into a configuration issue. Need to revisit the environment variables before proceeding.",
  "This task is blocked by the infrastructure work. Waiting for it to complete first.",
  "PR is up for review. Please check and provide feedback at your earliest convenience.",
  "Completed the implementation. All tests are passing and it is ready for QA validation.",
  "Had a quick sync with the team. We agreed to take a slightly different approach here.",
  "Added missing edge case handling and improved error messages. Ready for another review round.",
  "Documentation has been updated alongside the code changes. Good to merge now.",
  "Found a potential performance bottleneck. Looking into optimisations before we ship this.",
  "Tested on staging and everything looks good. Waiting for final product sign-off.",
  "Pushed a fix for the flaky test. The root cause was a race condition in the async handler.",
  "Leaving this on hold until the dependent service is deployed to staging.",
];

// ─── Attachment Pool (6 unique files) ────────────────────────────────────────

const ATTACHMENT_POOL = [
  { fileName: "design-mockup.png", mimeType: "image/png", fileSize: 204800 },
  { fileName: "technical-spec.pdf", mimeType: "application/pdf", fileSize: 512000 },
  { fileName: "api-docs.md", mimeType: "text/markdown", fileSize: 8192 },
  { fileName: "schema-diagram.svg", mimeType: "image/svg+xml", fileSize: 32768 },
  { fileName: "test-results.txt", mimeType: "text/plain", fileSize: 4096 },
  { fileName: "wireframes.pdf", mimeType: "application/pdf", fileSize: 1048576 },
];

// ─── Upsert User ──────────────────────────────────────────────────────────────

async function upsertUser(data: {
  name: string;
  email: string;
  password: string;
  role: "admin" | "developer";
}): Promise<string> {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, data.email))
    .limit(1);

  if (existing) return existing.id;

  const passwordHash = await hashPassword(data.password);
  const [inserted] = await db
    .insert(users)
    .values({
      name: data.name,
      email: data.email,
      passwordHash,
      role: data.role,
      status: "active",
    })
    .returning({ id: users.id });

  return inserted.id;
}

// ─── Org Seeder ───────────────────────────────────────────────────────────────

async function seedOrg(org: { id: string; slug: string }) {
  // 1 admin + DEVS_PER_ORG developers scoped to this org
  const adminId = await upsertUser({
    name: `${org.slug} Admin`,
    email: `admin@${org.slug}.com`,
    password: "Admin@123",
    role: "admin",
  });

  const devIds: string[] = [];
  for (let i = 1; i <= DEVS_PER_ORG; i++) {
    const id = await upsertUser({
      name: `${org.slug} Dev ${i}`,
      email: `dev${i}@${org.slug}.com`,
      password: "Dev@1234",
      role: "developer",
    });
    devIds.push(id);
  }

  const allMemberIds = [adminId, ...devIds];

  // Register as org members (unique constraint handles duplicates)
  for (const userId of allMemberIds) {
    await db
      .insert(orgMembers)
      .values({
        orgId: org.id,
        userId,
        role: userId === adminId ? "admin" : "developer",
      })
      .onConflictDoNothing();
  }

  await seedProjects(org.id, adminId, allMemberIds);
}

// ─── Project Seeder ───────────────────────────────────────────────────────────

async function seedProjects(
  orgId: string,
  createdBy: string,
  memberIds: string[]
) {
  const existingProjects = await db
    .select({ id: projects.id, title: projects.title })
    .from(projects)
    .where(and(eq(projects.orgId, orgId), isNull(projects.deletedAt)));

  const projectsToSeed = PROJECT_POOL.slice(0, PROJECTS_PER_ORG);

  for (const template of projectsToSeed) {
    let projectId: string;
    const existing = existingProjects.find((p) => p.title === template.title);

    if (existing) {
      projectId = existing.id;
    } else {
      const [inserted] = await db
        .insert(projects)
        .values({
          orgId,
          title: template.title,
          description: template.description,
          status: template.status,
          createdBy,
        })
        .returning({ id: projects.id });
      projectId = inserted.id;
    }

    // All org members become project members
    for (const userId of memberIds) {
      await db
        .insert(projectMembers)
        .values({ projectId, userId })
        .onConflictDoNothing();
    }

    await seedTasks(projectId, createdBy, memberIds);
  }
}

// ─── Task Seeder ──────────────────────────────────────────────────────────────

async function seedTasks(
  projectId: string,
  createdBy: string,
  memberIds: string[]
) {
  const existingTasks = await db
    .select({ id: tasks.id, title: tasks.title })
    .from(tasks)
    .where(
      and(
        eq(tasks.projectId, projectId),
        isNull(tasks.parentTaskId),
        isNull(tasks.deletedAt)
      )
    );

  const tasksToSeed = TASK_POOL.slice(0, TASKS_PER_PROJECT);

  for (const template of tasksToSeed) {
    let taskId: string;
    const existing = existingTasks.find((t) => t.title === template.title);

    if (existing) {
      taskId = existing.id;
    } else {
      const [inserted] = await db
        .insert(tasks)
        .values({
          projectId,
          title: template.title,
          description: template.description,
          status: template.status,
          priority: template.priority,
          dueDate: template.dueDate,
          createdBy,
          ...(template.status === "completed" && { completedAt: new Date() }),
        })
        .returning({ id: tasks.id });
      taskId = inserted.id;
    }

    // Assign 2 project members as task assignees
    const assignees = pickN(memberIds, 2);
    for (const userId of assignees) {
      await db
        .insert(taskAssignees)
        .values({ taskId, userId, assignedBy: createdBy })
        .onConflictDoNothing();
    }

    await seedAttachments(taskId, assignees);
    await seedComments(taskId, assignees, memberIds, COMMENTS_PER_TASK);

    // Seed subtasks
    const subtaskTemplates = pickN(SUBTASK_POOL, SUBTASKS_PER_TASK);
    for (const subtask of subtaskTemplates) {
      await seedSubtask(projectId, taskId, subtask, createdBy, memberIds);
    }
  }
}

// ─── Subtask Seeder ───────────────────────────────────────────────────────────

async function seedSubtask(
  projectId: string,
  parentTaskId: string,
  template: TaskTemplate,
  createdBy: string,
  memberIds: string[]
) {
  const [existing] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.projectId, projectId),
        eq(tasks.parentTaskId, parentTaskId),
        eq(tasks.title, template.title),
        isNull(tasks.deletedAt)
      )
    )
    .limit(1);

  let subtaskId: string;

  if (existing) {
    subtaskId = existing.id;
  } else {
    const [inserted] = await db
      .insert(tasks)
      .values({
        projectId,
        parentTaskId,
        title: template.title,
        description: template.description,
        status: template.status,
        priority: template.priority,
        dueDate: template.dueDate,
        createdBy,
        ...(template.status === "completed" && { completedAt: new Date() }),
      })
      .returning({ id: tasks.id });
    subtaskId = inserted.id;
  }

  // Assign 1 member to the subtask
  const assignee = pick(memberIds);
  await db
    .insert(taskAssignees)
    .values({ taskId: subtaskId, userId: assignee, assignedBy: createdBy })
    .onConflictDoNothing();

  // 1 comment with a mention on the subtask
  await seedComments(subtaskId, [assignee], memberIds, 1);
}

// ─── Attachment Seeder ────────────────────────────────────────────────────────

async function seedAttachments(taskId: string, uploaderIds: string[]) {
  const existingKeys = new Set(
    (
      await db
        .select({ s3Key: attachments.s3Key })
        .from(attachments)
        .where(eq(attachments.taskId, taskId))
    ).map((a) => a.s3Key)
  );

  for (const att of pickN(ATTACHMENT_POOL, ATTACHMENTS_PER_TASK)) {
    const s3Key = `tasks/${taskId}/${att.fileName}`;
    if (!existingKeys.has(s3Key)) {
      await db.insert(attachments).values({
        taskId,
        uploadedBy: pick(uploaderIds),
        s3Key,
        fileName: att.fileName,
        mimeType: att.mimeType,
        fileSize: att.fileSize,
      });
      existingKeys.add(s3Key);
    }
  }
}

// ─── Comment + Mention Seeder ─────────────────────────────────────────────────

async function seedComments(
  taskId: string,
  authorIds: string[],
  allMemberIds: string[],
  count: number
) {
  const existingBodies = new Set(
    (
      await db
        .select({ body: comments.body })
        .from(comments)
        .where(eq(comments.taskId, taskId))
    ).map((c) => c.body)
  );

  for (const body of pickN(COMMENT_POOL, count)) {
    if (existingBodies.has(body)) continue;

    const authorId = pick(authorIds);

    const [comment] = await db
      .insert(comments)
      .values({ taskId, authorId, body })
      .returning({ id: comments.id });

    existingBodies.add(body);

    // Mention up to MENTIONS_PER_COMMENT other members in this comment
    const mentionCandidates = without(allMemberIds, authorId);
    const mentionedUsers = pickN(mentionCandidates, MENTIONS_PER_COMMENT);
    for (const userId of mentionedUsers) {
      await db
        .insert(commentMentions)
        .values({ commentId: comment.id, userId })
        .onConflictDoNothing();
    }
  }
}

// ─── Main Orchestrator ────────────────────────────────────────────────────────

const seed = async () => {
  console.log("🌱 Starting full database seed...\n");

  try {
    // Superadmin is used as placeholder owner when creating new orgs
    const [superadmin] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, "superadmin"))
      .limit(1);

    // Insert new orgs — skip if slug already exists
    console.log("📦 Organizations");
    for (const orgData of NEW_ORGS) {
      const [existing] = await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.slug, orgData.slug))
        .limit(1);

      if (!existing) {
        await db.insert(organizations).values({
          ...orgData,
          ownerId: superadmin?.id ?? null,
        });
        console.log(`   ✅ Created: ${orgData.name}`);
      } else {
        console.log(`   ℹ️  Exists:  ${orgData.name}`);
      }
    }

    // Fetch ALL non-deleted orgs (includes orgs that existed before the seed)
    const allOrgs = await db
      .select({ id: organizations.id, slug: organizations.slug })
      .from(organizations)
      .where(isNull(organizations.deletedAt));

    console.log(`\n🏢 Seeding ${allOrgs.length} organization(s)...\n`);

    for (const org of allOrgs) {
      console.log(`   🔧 ${org.slug}`);
      await seedOrg(org);
      console.log(`      ✅ done\n`);
    }

    console.log("✅ Seed completed successfully!\n");
    console.log("📋 Credentials  (replace {slug} with the org slug):");
    console.log("   Admin:       admin@{slug}.com   →  Admin@123");
    console.log("   Dev 1–10:    devN@{slug}.com    →  Dev@1234");
    process.exit(0);
  } catch (error) {
    console.error("❌ Seed failed:", error);
    process.exit(1);
  }
};

seed();
