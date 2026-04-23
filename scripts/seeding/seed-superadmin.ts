process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
import "dotenv/config";
import bcrypt from "bcrypt";
import { db } from "../../src/config/db.js";
import { users } from "../../src/db/schema/index.js";
import { eq } from "drizzle-orm";

const SEED_EMAIL = "superadmin@taskmiller.com";
const SEED_PASSWORD = "SuperAdmin@123";

const seed = async () => {
  console.log("🌱 Seeding Superadmin...");

  try {
    // 1. Check if already exists
    const [existing] = await db
      .select()
      .from(users)
      .where(eq(users.email, SEED_EMAIL))
      .limit(1);

    if (existing) {
      console.log("ℹ️  Superadmin already exists. Skipping.");
      process.exit(0);
    }

    // 2. Hash password
    const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);

    // 3. Insert
    await db.insert(users).values({
      name: "Super Admin",
      email: SEED_EMAIL,
      passwordHash: passwordHash,
      role: "superadmin",
      status: "active",
    });

    console.log("✅ Superadmin seeded successfully!");
    console.log(`📧 Email: ${SEED_EMAIL}`);
    console.log(`🔑 Password: ${SEED_PASSWORD}`);

    process.exit(0);
  } catch (error) {
    console.error("❌ Seeding failed:", error);
    process.exit(1);
  }
};

seed();
