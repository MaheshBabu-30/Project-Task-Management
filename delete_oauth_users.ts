import { db } from "./src/config/db.js";
import { users } from "./drizzle/schema.js";
import { eq } from "drizzle-orm";

async function run() {
  try {
    console.log("Deleting OAuth users...");
    const deleted = await db.delete(users).where(eq(users.authProvider, "GOOGLE")).returning();
    console.log(`Deleted ${deleted.length} users.`);
    process.exit(0);
  } catch (error) {
    console.error("Failed to delete OAuth users", error);
    process.exit(1);
  }
}

run();
