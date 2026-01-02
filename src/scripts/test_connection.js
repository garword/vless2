
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
const { createClient } = require("@libsql/client");

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

console.log("Testing Connection to:", url);

if (!url || !authToken) {
    console.error("❌ Missing Credentials in .env");
    process.exit(1);
}

const db = createClient({ url, authToken });

async function test() {
    try {
        const start = Date.now();
        const res = await db.execute("SELECT 1 as val");
        const duration = Date.now() - start;

        console.log("✅ Connection Successful!");
        console.log(`⏱️ Latency: ${duration}ms`);
        console.log("📄 Result:", res.rows[0]);

        // Cek tabel
        const tables = await db.execute("SELECT name FROM sqlite_master WHERE type='table'");
        console.log("📊 Tables Found:", tables.rows.map(r => r.name).join(", "));

    } catch (e) {
        console.error("❌ Connection Failed:", e.message);
    }
}

test();
