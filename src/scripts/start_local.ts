import { Bot, session } from "grammy";
import { conversations, createConversation } from "@grammyjs/conversations";
import * as dotenv from "dotenv";
import { setupHandlers, inputBugConversation, addCfAccountConversation, addProxyConversation, addFeederConversation, MyContext } from "../bot/handlers";
import { db } from "../lib/db";

dotenv.config();

async function run() {
    console.log("🔧 Initializing Local Bot...");

    if (!process.env.BOT_TOKEN) {
        console.error("❌ Error: BOT_TOKEN is missing in .env");
        process.exit(1);
    }

    // Check DB Connection
    try {
        await db.execute("SELECT 1");
        console.log("✅ Database Connected");
    } catch (e: any) {
        console.error("❌ Database Connection Failed:", e.message);
        console.warn("⚠️ Pastikan credentials Turso di .env benar.");
    }

    const bot = new Bot<MyContext>(process.env.BOT_TOKEN);

    // Session & Conversations
    // Initialize session with 'temp' object as required by SessionData definition in handlers.ts
    bot.use(session({ initial: () => ({ temp: {} }) }));
    bot.use(conversations());

    // Register Conversations
    bot.use(createConversation(inputBugConversation));
    bot.use(createConversation(addCfAccountConversation));
    bot.use(createConversation(addProxyConversation));
    bot.use(createConversation(addFeederConversation));

    // Setup Main Handlers
    setupHandlers(bot);

    // Delete Webhook to switch to Polling
    console.log("🟡 Deleting Webhook (Disconnecting from Vercel)...");
    await bot.api.deleteWebhook();
    console.log("✅ Webhook deleted.");

    // Start Polling
    console.log("🚀 Bot is running locally! (Press Ctrl+C to stop)");
    await bot.start({
        onStart: (botInfo) => {
            console.log(`✅ Logged in as @${botInfo.username}`);
        }
    });
}

run().catch(console.error);
