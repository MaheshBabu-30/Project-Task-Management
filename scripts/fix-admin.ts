import { db } from "../src/config/db.js";
import { users } from "../drizzle/schema.js";
import { eq } from "drizzle-orm";

const fix = async () => {
    console.log("Reactivating all inactive users...");
    const result = await db.update(users).set({ status: "active" }).where(eq(users.status, "inactive"));
    console.log("Successfully reactivated users.");
    process.exit(0);
};

fix().catch(err => {
    console.error("Error fixing users:", err);
    process.exit(1);
});
