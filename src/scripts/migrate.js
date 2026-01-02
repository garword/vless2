
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
const fs = require("fs");
const { createClient } = require("@libsql/client");

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

console.log("Loaded Keys:", Object.keys(process.env).filter(k => k.startsWith("TURSO")));

if (!url || !authToken) {
    console.error("❌ TURSO_DATABASE_URL or TURSO_AUTH_TOKEN not found in .env");
    process.exit(1);
}

const db = createClient({ url, authToken });

async function migrate() {
    try {
        const schemaPath = path.resolve(__dirname, "../../schema.sql");
        console.log(`📂 Reading schema from: ${schemaPath}`);

        const sql = fs.readFileSync(schemaPath, "utf8");

        console.log("🚀 Executing Schema on Turso...");

        // LibSQL client support executeMultiple for multiple statements
        await db.executeMultiple(sql);

        console.log("✅ Migration Success! Database is up to date.");
    } catch (e) {
        console.error("❌ Migration Failed:", e);
        process.exit(1);
    }
}

migrate();
