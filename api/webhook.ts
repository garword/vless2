import { Bot, webhookCallback, session } from "grammy";
import { conversations, createConversation } from "@grammyjs/conversations";
import { setupHandlers, inputBugConversation, addCfAccountConversation, addProxyConversation, addFeederConversation, checkProxiesAndNotify, MyContext } from "@/bot/handlers";
import { mainMenuKeyboard } from "@/bot/menus";
import * as dotenv from "dotenv";

dotenv.config();

if (!process.env.BOT_TOKEN) {
    throw new Error("BOT_TOKEN is unset");
}

const bot = new Bot<MyContext>(process.env.BOT_TOKEN);

// Middleware
bot.use(session({ initial: () => ({}) }));
bot.use(conversations());
bot.use(createConversation(inputBugConversation as any));
bot.use(createConversation(addCfAccountConversation as any));
bot.use(createConversation(addProxyConversation as any));
bot.use(createConversation(addFeederConversation as any));

// Special Action Handler (for specialized requests like Monitoring)
// Note: Webhook updates are usually POST, but we can intercept GET or specific POST payloads if needed.
// However, standard grammy webhookCallback usually expects standard updates.
// We can check query parameters if we wrap the handler or use a separate endpoint in a real server.
// Since this is Vercel `api/webhook.ts`, the default export handles the request.
// We should check the request object. But `webhookCallback` returns a standard fetch handler.
// To handle custom actions like "check_proxies", we need to wrap the callback.

const handleUpdate = webhookCallback(bot, "std/http");

export default async (req: Request) => {
    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    const secret = url.searchParams.get("secret");

    // Helper: Check Secret from DB (simple cache or db call)
    // We'll trust the db connection is ready since it's lazy loaded in handlers/db.

    if (action === "check_proxies") {
        const { db } = await import("@/lib/db"); // Import inside to ensure init
        const secRow = await db.execute("SELECT value FROM settings WHERE key = 'monitor_secret'");
        const savedSecret = secRow.rows[0]?.value as string;

        if (secret && secret === savedSecret) {
            await checkProxiesAndNotify(bot);
            return new Response("Proxies Checked", { status: 200 });
        } else {
            return new Response("Unauthorized", { status: 401 });
        }
    }

    return handleUpdate(req);
};
