
import { Bot, session } from "grammy";
import { conversations, createConversation } from "@grammyjs/conversations";
import { setupHandlers, inputBugConversation, addCfAccountConversation, addProxyConversation, addFeederConversation, MyContext } from "../bot/handlers";
import { mainMenuKeyboard } from "../bot/menus";
import * as dotenv from "dotenv";
import * as path from "path";

// Load .env
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

if (!process.env.BOT_TOKEN) {
    throw new Error("BOT_TOKEN is unset in .env");
}

const bot = new Bot<MyContext>(process.env.BOT_TOKEN);

// Middleware
bot.use(session({ initial: () => ({}) }));
bot.use(conversations());
bot.use(createConversation(inputBugConversation as any));
bot.use(createConversation(addCfAccountConversation as any));
bot.use(createConversation(addProxyConversation as any));
bot.use(createConversation(addFeederConversation as any));

// Setup Handlers
setupHandlers(bot);

// Fallback Start Command (if not in handlers, but it usually is)
bot.command("start", (ctx) => {
    ctx.reply("Selamat datang di bot VLESS Worker (Local).\n\nSilahkan pilih menu di bawah ini:", {
        reply_markup: mainMenuKeyboard
    });
});

console.log("🚀 Bot is running locally...");

bot.catch((err) => {
    console.error("⚠️ Global Error Caught:", err);
});

bot.start();
