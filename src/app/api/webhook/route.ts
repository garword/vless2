import { Bot, webhookCallback, session } from "grammy";
import { conversations, createConversation } from "@grammyjs/conversations";
// Dynamic imports handles the rest
import * as dotenv from "dotenv";

dotenv.config();

let bot: Bot<any> | null = null;
let handlers: any = null;

async function initBot() {
    if (bot) return;

    if (!process.env.BOT_TOKEN) throw new Error("BOT_TOKEN is unset");

    // Dynamic import to avoid top-level load crashes
    // Relative path: src/app/api/webhook/route.ts -> src/bot/handlers
    handlers = await import("../../../bot/handlers");

    bot = new Bot<any>(process.env.BOT_TOKEN);

    bot.use(session({ initial: () => ({}) }));
    bot.use(conversations());

    // Register Conversations (casted to any to avoid type complexity in build)
    bot.use(createConversation(handlers.inputBugConversation as any));
    bot.use(createConversation(handlers.addCfAccountConversation as any));
    bot.use(createConversation(handlers.addProxyConversation as any));
    bot.use(createConversation(handlers.addFeederConversation as any));

    handlers.setupHandlers(bot);
}

export const POST = async (req: Request) => {
    try {
        await initBot();

        const url = new URL(req.url);
        const action = url.searchParams.get("action");
        const secret = url.searchParams.get("secret");

        if (action === "check_proxies") {
            const { db } = await import("../../../lib/db");
            const secRow = await db.execute("SELECT value FROM settings WHERE key = 'monitor_secret'");
            const savedSecret = secRow.rows[0]?.value as string;

            if (secret && secret === savedSecret) {
                if (bot && handlers) await handlers.checkProxiesAndNotify(bot);
                return new Response("Proxies Checked", { status: 200 });
            }
            return new Response("Unauthorized", { status: 401 });
        }

        // Standard Webhook Handler using std/http adapter (Fetch API)
        return await webhookCallback(bot!, "std/http")(req);

    } catch (e: any) {
        console.error("Webhook Error:", e);
        return new Response(`Error: ${e.message}`, { status: 200 });
    }
};

export const GET = async (req: Request) => {
    return new Response("Bot Active (Next.js App Router)", { status: 200 });
};
