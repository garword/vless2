import { Bot, webhookCallback, session } from "grammy";
import { conversations, createConversation } from "@grammyjs/conversations";
import { setupHandlers, inputBugConversation, addCfAccountConversation, addProxyConversation, MyContext } from "@/bot/handlers";
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

// Setup logic
setupHandlers(bot);

// Fallback
bot.command("start", (ctx) => {
    ctx.reply("Selamat datang di bot VLESS Worker.\n\nSilahkan pilih menu di bawah ini:", {
        reply_markup: mainMenuKeyboard
    });
});

export default webhookCallback(bot, "std/http");
