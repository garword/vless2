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

// ... imports
export const POST = async (req: Request) => {
    console.log("👉 [WEBHOOK] POST Request received");
    try {
        console.log("👉 [WEBHOOK] calling initBot()...");
        await initBot();
        console.log("👉 [WEBHOOK] initBot() finished. Bot instance:", !!bot);

        // Fix: req.url might be relative in some environments, so we provide a base
        const url = new URL(req.url, `https://${req.headers.get("host") || "localhost"}`);
        const action = url.searchParams.get("action");

        if (action === "check_proxies") {
            // ... (keep logic)
        }

        // Standard Webhook Handler
        console.log("👉 [WEBHOOK] Processing update with webhookCallback...");

        // Log the body for debugging
        try {
            const clone = req.clone();
            const body = await clone.json();
            console.log("👉 [WEBHOOK] Payload:", JSON.stringify(body, null, 2));
        } catch (e) { console.log("👉 [WEBHOOK] Could not parse body log"); }

        const handler = webhookCallback(bot!, "std/http");
        const result = await handler(req);
        console.log("👉 [WEBHOOK] Handler executed. Result status:", result.status);
        return result;

    } catch (e: any) {
        console.error("❌ [WEBHOOK] Error:", e);
        return new Response(`Error: ${e.message}`, { status: 200 });
    }
};

export const GET = async (req: Request) => {
    return new Response("Bot Active (Next.js App Router)", { status: 200 });
};
