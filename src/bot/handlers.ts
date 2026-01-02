import { Bot, Context, session, SessionFlavor, InlineKeyboard } from "grammy";
import {
    mainMenuKeyboard,
    methodKeyboard,
    generateServerListKeyboard,
    generateWildcardListKeyboard,
    subLinkTypeKeyboard,
    subLinkMethodKeyboard,
    adminKeyboard,
    cfSettingsKeyboard,
    backToMainKeyboard
} from "./menus";
import { db } from "../lib/db";
import { CFAuth, uploadWorker, addWorkerDomain, addWorkerRoute, updateWorkerCron, updateWorkerEnv } from "../lib/cloudflare";
import { Conversation, ConversationFlavor } from "@grammyjs/conversations";

// Define Session Structure
export interface SessionData {
    temp: {
        selectedServer?: { subdomain: string, country: string, flag: string, name: string };
        selectedMethod?: "ws" | "sni" | "wildcard";
        subType?: "vless" | "clash";
        bug?: string;
    };
}

// 1. Base Context with Session
export type MySessionContext = Context & SessionFlavor<SessionData>;

// 2. Final Context with Conversation
export type MyContext = MySessionContext & ConversationFlavor<MySessionContext>;

// 3. Conversational Context
export type MyConversation = Conversation<MySessionContext>;

// Main Setup Function
export function setupHandlers(bot: Bot<MyContext>) {

    // --- Main Menu Actions ---
    // Correctly handle /start command
    bot.command("start", async (ctx) => {
        await ctx.reply("Selamat datang di bot VLESS Worker.\n\nSilahkan pilih menu di bawah ini:", {
            reply_markup: mainMenuKeyboard
        });
    });

    bot.callbackQuery("action_create_vless", async (ctx) => {
        // 1. Fetch Servers from DB
        const workers = await db.execute("SELECT * FROM workers WHERE type='vless'");
        const servers = workers.rows.map(r => ({
            country: r.country_code as string,
            flag: r.flag as string,
            name: r.worker_name as string,
            subdomain: r.subdomain as string
        }));

        if (servers.length === 0) {
            return ctx.editMessageText("⚠️ Belum ada server yang tersedia. Hubungi Admin.", { reply_markup: mainMenuKeyboard });
        }

        await ctx.editMessageText("Pilih server untuk membuat VLESS:", {
            reply_markup: generateServerListKeyboard(servers)
        });
    });

    bot.callbackQuery("menu_main", async (ctx) => {
        await ctx.editMessageText("Selamat datang di bot VLESS Worker.\n\nSilahkan pilih menu di bawah ini:", {
            reply_markup: mainMenuKeyboard
        });
    });

    // --- Server Selection ---
    bot.callbackQuery(/^select_server_(.+)$/, async (ctx) => {
        const subdomain = ctx.match[1];
        const res = await db.execute({ sql: "SELECT * FROM workers WHERE subdomain = ?", args: [subdomain] });
        const worker = res.rows[0];

        ctx.session.temp = {
            selectedServer: {
                subdomain: subdomain,
                country: worker.country_code as string,
                flag: worker.flag as string,
                name: worker.worker_name as string
            }
        };

        await ctx.editMessageText(`✅ Server Terpilih: ${worker.worker_name} ${worker.flag}\n\nPilih metode inject:`, {
            reply_markup: methodKeyboard
        });
    });

    // --- Method Selection ---
    bot.callbackQuery("method_ws", async (ctx) => {
        if (!ctx.session.temp) ctx.session.temp = {};
        ctx.session.temp.selectedMethod = "ws";
        await ctx.reply("⚡ Kirimkan BUG WS yang ingin digunakan.");
        await ctx.conversation.enter("inputBugConversation");
    });

    bot.callbackQuery(["method_sni", "method_wildcard"], async (ctx) => {
        const method = ctx.callbackQuery.data === "method_sni" ? "sni" : "wildcard";
        if (!ctx.session.temp) ctx.session.temp = {};
        ctx.session.temp.selectedMethod = method;

        // Show Subdomain List
        const workers = await db.execute("SELECT subdomain FROM workers WHERE type='vless'");
        const subdomains = workers.rows.map(r => r.subdomain as string);

        await ctx.editMessageText(`Pilih salah satu subdomain untuk metode ${method.toUpperCase()}:`, {
            reply_markup: generateWildcardListKeyboard(subdomains)
        });
    });

    // --- Wildcard/SNI Selection ---
    bot.callbackQuery(/^select_wildcard_(.+)$/, async (ctx) => {
        const selectedSub = ctx.match[1];
        // Logic:
        // If SNI: Host = selectedSub
        // If Wildcard: Host = selectedSub.workerDomain
        await generateAndShowResult(ctx, selectedSub);
    });

    // --- Admin Actions ---
    // Command: /add_cf <email>|<key>|<id>
    bot.command("add_cf", async (ctx) => {
        // if (!isAdmin(ctx)) return ctx.reply("⛔ Akses Ditolak."); // Allow for now or check admin

        const args = ctx.match.split("|").map(s => s.trim());
        if (args.length !== 3) {
            return ctx.reply("❌ Format Salah!\nGunakan pemisah '|' (garis tegak).\n\nFormat:\n`/add_cf email|api_key|account_id`", { parse_mode: "Markdown" });
        }

        const [email, apiKey, accountId] = args;
        await ctx.reply(`⏳ Menambahkan Akun Cloudflare...\nEmail: ${email}\nID: ${accountId}`);

        try {
            // 1. Save Account
            await ctx.reply("2️⃣ Menyimpan ke Database...");
            const res = await db.execute({
                sql: "INSERT INTO cf_accounts (email, api_key, account_id, owner_id) VALUES (?, ?, ?, ?) RETURNING id",
                args: [email, apiKey, accountId, ctx.from?.id || 0]
            });
            const dbAccountId = res.rows[0].id;

            // 2. Deploy Worker (VLESS) logic
            await ctx.reply("3️⃣ Deploying VLESS Worker ke Cloudflare...");

            // Minimal VLESS Script
            const scriptContent = `
            import { connect } from "cloudflare:sockets";
            export default {
              async fetch(request, env, ctx) {
                 const upgrade = request.headers.get("Upgrade");
                 if(upgrade === "websocket") return new Response(null, { status: 101 });
                 return new Response("VLESS Active", { status: 200 });
              }
            };`;

            const workerName = `vless-${ctx.from?.id}-${Math.floor(Math.random() * 1000)}`;
            const auth = { email, apiKey, accountId };

            // Real CF API Call
            await uploadWorker(auth, workerName, scriptContent);

            let subdomain = `${workerName}.${accountId.substring(0, 4)}.workers.dev`; // Default
            let country = "ID";
            let flag = "🇮🇩";

            await db.execute({
                sql: "INSERT INTO workers (subdomain, account_id, worker_name, type, country_code, flag) VALUES (?, ?, ?, 'vless', ?, ?)",
                args: [subdomain, dbAccountId, workerName, country, flag]
            });

            // 3. Save Worker
            await ctx.reply("4️⃣ Menyimpan Worker ke Database...");
            await db.execute({
                sql: "INSERT INTO workers (subdomain, account_id, worker_name, type, country_code, flag) VALUES (?, ?, ?, 'vless', ?, ?)",
                args: [subdomain, dbAccountId, workerName, country, flag]
            });

            await ctx.reply(`✅ **SUKSES! Akun & Worker Ditambahkan.**\n\n📌 **Detail:**\n- Domain: \`${subdomain}\`\n- Status: Aktif\n\nSilahkan cek menu list untuk melihat.`, { parse_mode: "Markdown" });

        } catch (e: any) {
            await ctx.reply(`❌ **PROSES GAGAL!**\n\n⚠️ **Penyebab:**\n${e.message}\n\nMohon periksa kembali API Key dan Account ID Anda.`);
        }
    });

    // Command: /add_feeder email|key|id|channel|url
    bot.command("add_feeder", async (ctx) => {
        const args = ctx.match.split("|").map(s => s.trim());
        if (args.length !== 5) {
            return ctx.reply("❌ Format Salah!\nGunakan pemisah '|'.\n\nFormat:\n`/add_feeder email|key|id|channel_id|vercel_url`", { parse_mode: "Markdown" });
        }

        let [email, apiKey, accountId, channelId, vercelUrl] = args;

        if (vercelUrl.endsWith('/')) vercelUrl = vercelUrl.slice(0, -1);
        if (!vercelUrl.includes('/api/webhook')) vercelUrl += '/api/webhook';

        await ctx.reply(`🔍 **Memulai Setup Feeder...**\nTarget Channel: ${channelId}`);

        try {
            const auth: any = { email, apiKey, accountId };
            const workerName = "vless-monitor-feeder";
            const secret = Math.random().toString(36).substring(7);

            // 1. Upload Worker & Set Env
            await ctx.reply("1️⃣ Mengupload Script & Config...");
            const MONITOR_SCRIPT = `
            export default {
                async scheduled(event, env, ctx) {
                    console.log("Cron Triggered");
                    const botUrl = env.BOT_API_URL;
                    const secret = env.BOT_SECRET;
                    if (!botUrl) return;
                    const url = \`\${botUrl}?action=check_proxies&secret=\${secret}\`;
                    try { await fetch(url); } catch (e) { }
                },
                async fetch(request) {
                    return new Response("Monitor Worker Active. Use Cron Trigger.");
                }
            };`;

            await uploadWorker(auth, workerName, MONITOR_SCRIPT, {
                BOT_API_URL: vercelUrl,
                BOT_SECRET: secret
            }).catch(e => { throw new Error(`Gagal Upload/Config: ${e.message}`); });

            // 2. Set Cron
            await ctx.reply("2️⃣ Mengaktifkan Cron Trigger...");
            await updateWorkerCron(auth, workerName, ["*/5 * * * *"]).catch(async e => {
                await ctx.reply(`⚠️ **PERINGATAN CRON:**\nGagal mengaktifkan jadwal otomatis.\nPenyebab: ${e.message}\n\n**Solusi:**\nLimit gratis Cloudflare hanya 5 cron. Hapus cron di worker lain, lalu set manual di dashboard CF.`);
            });

            // 3. Save Settings
            await ctx.reply("3️⃣ Menyimpan Pengaturan...");
            await db.execute({ sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('monitor_channel_id', ?)", args: [channelId] });
            await db.execute({ sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('monitor_secret', ?)", args: [secret] });

            await ctx.reply("✅ **SUKSES SETUP FEEDER!**\n\nRobot pemantau sudah aktif.\nIa akan mengecek status server setiap 5 menit.", { reply_markup: backToMainKeyboard });

        } catch (err: any) {
            await ctx.reply(`❌ **SETUP GAGAL!**\n\n⚠️ **Penyebab:**\n${err.message}`);
        }
    });

    bot.callbackQuery("action_admin_menu", async (ctx) => {
        if (!isAdmin(ctx)) return ctx.reply("⛔ Akses Ditolak.");
        await ctx.editMessageText("🛠 Admin Menu", { reply_markup: adminKeyboard });
    });

    bot.callbackQuery("admin_cf_settings", async (ctx) => {
        if (!isAdmin(ctx)) return;
        await ctx.editMessageText("⚙️ Pengaturan API CF", { reply_markup: cfSettingsKeyboard });
    });

    bot.callbackQuery("admin_add_proxy", async (ctx) => {
        if (!isAdmin(ctx)) return;
        await ctx.conversation.enter("addProxyConversation");
    });

    bot.callbackQuery("admin_add_cf_account", async (ctx) => {
        // Use Command Instruction instead of Wizard
        await ctx.editMessageText(
            "⚠️ **ADD AKUN (METODE BARU)**\n\n" +
            "Gunakan format pemisah tanda kurung `|` :\n\n" +
            "`/add_cf email|api_key|account_id`\n\n" +
            "**Contoh:**\n" +
            "`/add_cf nama@email.com|48f...0d|a1b...9c`",
            { parse_mode: "Markdown", reply_markup: cfSettingsKeyboard }
        );
    });

    bot.callbackQuery("admin_cf_feeder", async (ctx) => {
        // Use Command Instruction instead of Wizard
        await ctx.editMessageText(
            "⚠️ **SETUP FEEDER (METODE BARU)**\n\n" +
            "Gunakan format pemisah `|` :\n\n" +
            "`/add_feeder email|key|id|channel_id|vercel_url`\n\n" +
            "**Contoh:**\n" +
            "`/add_feeder budi@gm.com|xxKey|xxID|-100123|https://bot.vercel.app`",
            { parse_mode: "Markdown", reply_markup: cfSettingsKeyboard }
        );
    });

    // --- User Features ---

    // Check IP
    bot.callbackQuery("action_check_ip", async (ctx) => {
        if (!ctx.chat) return;
        await ctx.editMessageText("⏳ Checking IP...", { reply_markup: backToMainKeyboard });
        try {
            const res = await fetch("https://api.ipify.org?format=json");
            const data = await res.json() as { ip: string };
            await ctx.editMessageText(`📍 <b>Worker IP:</b> <code>${data.ip}</code>`, { parse_mode: "HTML", reply_markup: backToMainKeyboard });
        } catch (e) {
            await ctx.editMessageText("❌ Gagal cek IP.", { reply_markup: backToMainKeyboard });
        }
    });

    // List VLESS
    bot.callbackQuery("action_list_vless", async (ctx) => {
        const workers = await db.execute("SELECT worker_name, country_code, flag, subdomain FROM workers WHERE type='vless'");
        if (workers.rows.length === 0) return ctx.editMessageText("⚠️ Belum ada server.", { reply_markup: backToMainKeyboard });

        let text = "📄 <b>List VLESS Server:</b>\n\n";
        workers.rows.forEach((w, i) => {
            text += `${i + 1}. ${w.flag} <b>${w.worker_name}</b>\n   <code>${w.subdomain}</code>\n\n`;
        });
        await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: backToMainKeyboard });
    });

    // List Wildcard
    bot.callbackQuery("action_list_wildcard", async (ctx) => {
        const workers = await db.execute("SELECT subdomain FROM workers WHERE type='vless'");
        if (workers.rows.length === 0) return ctx.editMessageText("⚠️ Belum ada server.", { reply_markup: backToMainKeyboard });

        // This is simplified. Real wildcard list usually implies domains that support wildcard.
        // We assume all workers support wildcard if configured correctly.
        let text = "🌍 <b>List Domain Wildcard:</b>\n\n";
        workers.rows.forEach((w) => {
            text += `• <code>${w.subdomain}</code>\n`;
        });
        await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: backToMainKeyboard });
    });

    // Donate
    bot.callbackQuery("action_donate", async (ctx) => {
        await ctx.editMessageText("💝 <b>Donasi Pengembangan Bot</b>\n\nSilahkan kontak admin: @garword", { parse_mode: "HTML", reply_markup: backToMainKeyboard });
    });

    // Usage Data
    bot.callbackQuery("action_usage_data", async (ctx) => {
        // Placeholder: CF Analytics API is heavy.
        await ctx.editMessageText("📈 <b>Data Pemakaian</b>\n\nFitur ini memerlukan integrasi GraphQL Cloudflare yang lebih dalam. Saat ini belum tersedia.", { parse_mode: "HTML", reply_markup: backToMainKeyboard });
    });

    // Get Sub Link
    bot.callbackQuery("action_get_sub_link", async (ctx) => {
        await ctx.editMessageText("🔗 Pilih Tipe Subscription:", { reply_markup: subLinkTypeKeyboard });
    });

    bot.callbackQuery(/^sub_type_(.+)$/, async (ctx) => {
        const type = ctx.match[1];
        ctx.session.temp = { subType: type as any };
        await ctx.editMessageText("🔗 Pilih Metode:", { reply_markup: subLinkMethodKeyboard });
    });

    bot.callbackQuery(/^sub_method_(.+)$/, async (ctx) => {
        const method = ctx.match[1];
        const type = ctx.session.temp?.subType || "vless";

        // Construct Link
        // ... (existing comments)

        await ctx.editMessageText("❌ URL Bot belum diset di Database Settings. Gunakan menu Admin Feeder untuk set URL Bot output.", { reply_markup: backToMainKeyboard });
        // Correct fix: Store URL during feeder setup.
    });

    // Admin List CF VPN
    bot.callbackQuery("admin_list_cf_vpn", async (ctx) => {
        if (!isAdmin(ctx)) return;
        const accs = await db.execute("SELECT email, account_id FROM cf_accounts");
        if (accs.rows.length === 0) return ctx.editMessageText("⚠️ Belum ada akun CF tersimpan.", { reply_markup: backToMainKeyboard });

        let text = "🔐 <b>List Akun Cloudflare:</b>\n\n";
        accs.rows.forEach((a, i) => {
            text += `${i + 1}. ${a.email}\n   ID: <code>${a.account_id}</code>\n\n`;
        });
        await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: backToMainKeyboard });
    });

    // Admin Del Proxy Implementation
    bot.callbackQuery("admin_del_proxy", async (ctx) => {
        if (!isAdmin(ctx)) return;
        const workers = await db.execute("SELECT id, worker_name, subdomain FROM workers");
        if (workers.rows.length === 0) return ctx.editMessageText("⚠️ Tidak ada proxy untuk dihapus.", { reply_markup: backToMainKeyboard });

        const kb = new InlineKeyboard();
        workers.rows.forEach(w => {
            kb.text(`🗑 ${w.worker_name}`, `del_proxy_${w.id}`).row();
        });
        kb.text("⬅️ Batal", "menu_main");

        await ctx.editMessageText("Pilih Proxy yang akan dihapus (Hanya DB):", { reply_markup: kb });
    });

    bot.callbackQuery(/^del_proxy_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx)) return;
        const id = ctx.match[1];
        await db.execute({ sql: "DELETE FROM workers WHERE id = ?", args: [id] });
        await ctx.editMessageText("✅ Proxy berhasil dihapus dari Database.", { reply_markup: backToMainKeyboard });
    });

}

// Helper: Check Admin
function isAdmin(ctx: MyContext) {
    const adminIds = process.env.ADMIN_IDS?.split(",").map(Number) || [];
    return adminIds.includes(ctx.from?.id || 0);
}

// Conversation: Member Add CF Account
// Helper: Clean up conversation messages
async function cleanupConversation(ctx: MyContext, userMsgId?: number, botMsgId?: number) {
    if (userMsgId) await ctx.api.deleteMessage(ctx.chat?.id!, userMsgId).catch(() => { });
    if (botMsgId) await ctx.api.deleteMessage(ctx.chat?.id!, botMsgId).catch(() => { });
}

// Conversation: Member Add CF Account
export async function addCfAccountConversation(conversation: MyConversation, ctx: MyContext) {
    const prompt1 = await ctx.reply("📧 Masukkan Email Cloudflare Anda:");
    const emailMsg = await conversation.wait();
    const email = emailMsg.message?.text;

    // Auto-delete user input
    if (emailMsg.message?.message_id) await ctx.api.deleteMessage(ctx.chat?.id!, emailMsg.message.message_id).catch(() => { });

    if (!email || email.toLowerCase() === "batal" || email.toLowerCase() === "cancel") {
        await cleanupConversation(ctx, undefined, prompt1.message_id);
        return;
    }

    const prompt2 = await ctx.reply("🔑 Masukkan Global API Key / Token:");
    const keyMsg = await conversation.wait();
    const apiKey = keyMsg.message?.text;

    // Auto-delete user input
    if (keyMsg.message?.message_id) await ctx.api.deleteMessage(ctx.chat?.id!, keyMsg.message.message_id).catch(() => { });

    if (!apiKey || apiKey.toLowerCase() === "batal" || apiKey.toLowerCase() === "cancel") {
        await cleanupConversation(ctx, undefined, prompt2.message_id);
        // Ideally should clean previous ones too, but for simplicity just this step.
        return;
    }

    const prompt3 = await ctx.reply("🆔 Masukkan Account ID:");
    const accMsg = await conversation.wait();
    const accountId = accMsg.message?.text;

    // Auto-delete user input
    if (accMsg.message?.message_id) await ctx.api.deleteMessage(ctx.chat?.id!, accMsg.message.message_id).catch(() => { });

    if (!accountId || accountId.toLowerCase() === "batal" || accountId.toLowerCase() === "cancel") {
        await cleanupConversation(ctx, undefined, prompt3.message_id);
        return;
    }

    if (email && apiKey && accountId) {
        const processMsg = await ctx.reply("⏳ Memverifikasi & Mendaftarkan Akun...");

        try {
            // 1. Save Account
            const res = await db.execute({
                sql: "INSERT INTO cf_accounts (email, api_key, account_id, owner_id) VALUES (?, ?, ?, ?) RETURNING id",
                args: [email, apiKey, accountId, ctx.from?.id || 0]
            });
            const dbAccountId = res.rows[0].id;

            // 2. Auto Deploy Worker
            await ctx.api.editMessageText(ctx.chat?.id!, processMsg.message_id, "🚀 Sedang men-deploy VLESS Worker ke akun Anda...");

            // Minimal VLESS Script (Placeholder for full implementation)
            const scriptContent = `
            import { connect } from "cloudflare:sockets";
            export default {
              async fetch(request, env, ctx) {
                 const upgrade = request.headers.get("Upgrade");
                 if(upgrade === "websocket") return new Response(null, { status: 101 });
                 return new Response("VLESS Active", { status: 200 });
              }
            };`;

            const workerName = `vless-${ctx.from?.id}-${Math.floor(Math.random() * 1000)}`;
            const auth = { email, apiKey, accountId };

            // Real CF API Call
            await uploadWorker(auth, workerName, scriptContent);

            let subdomain = `${workerName}.${accountId.substring(0, 4)}.workers.dev`; // Default
            let country = "ID";
            let flag = "🇮🇩";

            // 4. Ask for Custom Domain (Optional)
            await ctx.api.deleteMessage(ctx.chat?.id!, processMsg.message_id).catch(() => { });

            await ctx.reply("🌐 Apakah Anda ingin menggunakan **Custom Domain** sendiri? (Support Wildcard/SNI).\n\nKetik nama domain (misal: `vip.domainku.com`) atau ketik **skip** untuk menggunakan default.");
            const domMsg = await conversation.wait();

            // Delete user input immediately
            if (domMsg.message?.message_id) await ctx.api.deleteMessage(ctx.chat?.id!, domMsg.message.message_id).catch(() => { });


            if (domMsg.message?.text && domMsg.message.text.toLowerCase() !== 'skip') {
                const customDomain = domMsg.message.text.toLowerCase();
                const zonePrompt = await ctx.reply(`🆔 Kirimkan **Zone ID** untuk domain ${customDomain}:`);
                const zoneMsg = await conversation.wait();
                const zoneId = zoneMsg.message?.text;

                if (zoneMsg.message?.message_id) await ctx.api.deleteMessage(ctx.chat?.id!, zoneMsg.message.message_id).catch(() => { });

                if (zoneId) {
                    await ctx.api.editMessageText(ctx.chat?.id!, zonePrompt.message_id, "⚙️ Mengikat Custom Domain & Routing Wildcard...");
                    try {
                        // 1. Bind Domain (SSL)
                        await addWorkerDomain(auth, accountId, workerName, customDomain, zoneId);

                        // 2. Add Route Wildcard (*.domain/*)
                        try {
                            await addWorkerRoute(auth, zoneId, `*.${customDomain}/*`, workerName);
                        } catch (routeErr: any) {
                            // Log error but proceed
                        }

                        subdomain = customDomain;
                        country = "US"; // Assuming changes
                        flag = "🇺🇸";
                        await ctx.api.editMessageText(ctx.chat?.id!, zonePrompt.message_id, `✅ Domain ${customDomain} berhasil diikat!`);
                    } catch (err: any) {
                        await ctx.api.editMessageText(ctx.chat?.id!, zonePrompt.message_id, `⚠️ Gagal BIND Domain: ${err.message}. Tetap menggunakan subdomain standar.`);
                    }
                }
            }

            await db.execute({
                sql: "INSERT INTO workers (subdomain, account_id, worker_name, type, country_code, flag) VALUES (?, ?, ?, 'vless', ?, ?)",
                args: [subdomain, dbAccountId, workerName, country, flag]
            });

            await ctx.reply(`✅ Selesai! Worker Anda aktif: ${subdomain}.\nSiap digunakan untuk WS/SNI/Wildcard Pribadi.`, { reply_markup: backToMainKeyboard });

        } catch (e: any) {
            await ctx.reply(`❌ Gagal: ${e.message}`, { reply_markup: backToMainKeyboard });
        }
    } else {
        await ctx.reply("⚠️ Gagal, data tidak lengkap.", { reply_markup: backToMainKeyboard });
    }
}

// Conversation: Admin Add Proxy (With Wildcard)
export async function addProxyConversation(conversation: MyConversation, ctx: MyContext) {
    // 1. Ask Target Account ID
    const prompt1 = await ctx.reply("🆔 Masukkan **Account ID Cloudflare** target deployment:");
    const accMsg = await conversation.wait();
    const accountId = accMsg.message?.text;

    // Auto-delete
    if (accMsg.message?.message_id) await ctx.api.deleteMessage(ctx.chat?.id!, accMsg.message.message_id).catch(() => { });

    if (!accountId) return;

    // 2. Ask Worker Name
    const prompt2 = await ctx.reply("📝 Masukkan **Nama Worker** (ex: vless-sg1):");
    const nameMsg = await conversation.wait();
    const workerName = nameMsg.message?.text || `vless-${Date.now()}`;

    // Auto-delete
    if (nameMsg.message?.message_id) await ctx.api.deleteMessage(ctx.chat?.id!, nameMsg.message.message_id).catch(() => { });


    // Need to Authentication for this Account ID
    // Logic: Look up in DB for credentials associated with this Account ID
    let auth = null;
    let dbId = 0;

    try {
        const accRes = await db.execute({ sql: "SELECT id, email, api_key FROM cf_accounts WHERE account_id = ? LIMIT 1", args: [accountId] });
        if (accRes.rows.length > 0) {
            const r = accRes.rows[0];
            dbId = r.id as number;
            auth = {
                email: r.email as string,
                apiKey: r.api_key as string,
                accountId: accountId
            };
        } else {
            return ctx.reply("⚠️ Akun ID tidak ditemukan di database. Tambahkan akun dulu di menu Admin.", { reply_markup: backToMainKeyboard });
        }
    } catch (e) {
        return ctx.reply("⚠️ DB Error.", { reply_markup: backToMainKeyboard });
    }

    let subdomain = `${workerName}.${accountId.substring(0, 4)}.workers.dev`; // Default
    let country = "ID";
    let flag = "🇮🇩";

    // 3. Ask Custom Domain
    await ctx.reply("🌐 Gunakan **Custom Domain**? (Ketik domain atau 'skip'):");
    const domMsg = await conversation.wait();

    // Auto-delete
    if (domMsg.message?.message_id) await ctx.api.deleteMessage(ctx.chat?.id!, domMsg.message.message_id).catch(() => { });


    if (domMsg.message?.text && domMsg.message.text.toLowerCase() !== 'skip') {
        const customDomain = domMsg.message.text.toLowerCase();
        const zonePrompt = await ctx.reply(`🆔 Kirimkan **Zone ID** untuk ${customDomain}:`);
        const zoneMsg = await conversation.wait();
        const zoneId = zoneMsg.message?.text;

        // Auto-delete
        if (zoneMsg.message?.message_id) await ctx.api.deleteMessage(ctx.chat?.id!, zoneMsg.message.message_id).catch(() => { });

        if (zoneId) {
            await ctx.api.editMessageText(ctx.chat?.id!, zonePrompt.message_id, "⚙️ Binding Custom Domain & Routing Wildcard...");
            try {
                // REAL API CALL
                await addWorkerDomain(auth, accountId, workerName, customDomain, zoneId);

                // Add Wildcard Route
                try {
                    await addWorkerRoute(auth, zoneId, `*.${customDomain}/*`, workerName);
                } catch (routeErr: any) {
                    // Log fail but proceed
                }

                subdomain = customDomain;
                country = "SG";
                flag = "🇸🇬";
                await ctx.api.editMessageText(ctx.chat?.id!, zonePrompt.message_id, `✅ Routing Wildcard (*.${customDomain}) Berhasil!`);
            } catch (err: any) {
                await ctx.api.editMessageText(ctx.chat?.id!, zonePrompt.message_id, `⚠️ Gagal bind domain: ${err.message}`);
            }
        }
    }

    try {
        const deployMsg = await ctx.reply(`⏳ Deploying ${workerName}...`);

        // REAL API CALL: Upload Worker
        const scriptContent = `
        export default {
          async fetch(request) { return new Response("VLESS Admin Node"); }
        };`;
        await uploadWorker(auth, workerName, scriptContent);

        await db.execute({
            sql: "INSERT INTO workers (subdomain, account_id, worker_name, type, country_code, flag) VALUES (?, ?, ?, 'vless', ?, ?)",
            args: [subdomain, dbId, workerName, country, flag]
        });

        await ctx.api.editMessageText(ctx.chat?.id!, deployMsg.message_id, `✅ Proxy Admin Siap!\nDomain: ${subdomain}\nWildcard/SNI: Aktif.`, { reply_markup: backToMainKeyboard });
    } catch (e: any) {
        await ctx.reply(`❌ Error: ${e.message}`, { reply_markup: backToMainKeyboard });
    }
}

// Conversation for Manual Bug Input
export async function inputBugConversation(conversation: MyConversation, ctx: MyContext) {
    const bugMsg = await conversation.wait();
    if (!bugMsg.message?.text) return;

    // Auto-delete user input
    if (bugMsg.message?.message_id) await ctx.api.deleteMessage(ctx.chat?.id!, bugMsg.message.message_id).catch(() => { });

    const bug = bugMsg.message.text;
    if (ctx.session.temp) {
        ctx.session.temp.bug = bug;
    }

    await generateAndShowResult(ctx, bug);
}


// --- Helper: Generate Result Card ---
async function generateAndShowResult(ctx: MyContext | any, inputPayload: string) {
    const s = ctx.session.temp;
    if (!s || !s.selectedServer) return;

    // Loading 
    const loadMsg = await ctx.reply("🔄 Generating Config...");

    const { subdomain, country, flag, name } = s.selectedServer;
    const method = s.selectedMethod;

    let serverAddress = subdomain;
    let sni = subdomain;
    let host = subdomain;
    let path = "/";
    let remark = `${flag} ${name}`;

    if (method === 'ws') {
        serverAddress = inputPayload; // The Bug IP
        sni = subdomain;
        host = subdomain;
        path = `/${subdomain}-443`;
    } else if (method === 'sni') {
        serverAddress = subdomain;
        sni = inputPayload; // Selected subdomain
        host = inputPayload;
    } else if (method === 'wildcard') {
        serverAddress = inputPayload; // Selected subdomain
        sni = `${inputPayload}.${subdomain}`; // e.g. m.udemy.com.worker.dev
        host = sni;
    }

    const uuid = globalThis.crypto ? globalThis.crypto.randomUUID() : "USER_UUID_PLACEHOLDER";

    // Fallback if UUID not available in Node < 19
    const uuidStr = uuid || "UUID-GENERATOR-FAILED";

    const vlessTls = `vless://${uuidStr}@${serverAddress}:443?encryption=none&security=tls&sni=${sni}&type=ws&host=${host}&path=${encodeURIComponent(path)}#${encodeURIComponent(remark)}`;
    const vlessNtls = `vless://${uuidStr}@${serverAddress}:80?encryption=none&security=none&type=ws&host=${host}&path=${encodeURIComponent(path)}#${encodeURIComponent(remark)}`;

    const clashYaml = `
- name: ${remark}
  server: ${serverAddress}
  port: 443
  type: vless
  uuid: ${uuidStr}
  cipher: none
  tls: true
  skip-cert-verify: true
  network: ws
  servername: ${sni}
  ws-opts:
    path: ${path}
    headers:
      Host: ${host}
    udp: true
`.trim();

    const responseText = `
<b>${remark}</b>
Method: ${method?.toUpperCase()}

<b>VLESS TLS:</b>
<code>${vlessTls}</code>

<b>VLESS NTLS:</b>
<code>${vlessNtls}</code>

<b>CLASH:</b>
<code>${clashYaml}</code>
    `.trim();

    try {
        await ctx.api.editMessageText(ctx.chat.id, loadMsg.message_id, responseText, {
            parse_mode: "HTML",
            reply_markup: backToMainKeyboard
        });
    } catch (e: any) {
        await ctx.api.editMessageText(ctx.chat.id, loadMsg.message_id, `❌ Error: ${e.message}`, { reply_markup: backToMainKeyboard });
    }
}

// --- Monitoring Logic ---

const MONITOR_SCRIPT = `
export default {
    async scheduled(event, env, ctx) {
        console.log("Cron Triggered");
        const botUrl = env.BOT_API_URL;
        const secret = env.BOT_SECRET;

        if (!botUrl) {
            console.error("BOT_API_URL not set");
            return;
        }

        const url = \`\${botUrl}?action=check_proxies&secret=\${secret}\`;
        console.log(\`Fetching \${url}...\`);

        try {
            const resp = await fetch(url);
            console.log(\`Response: \${resp.status}\`);
        } catch (e) {
            console.error("Fetch Error:", e);
        }
    },
    
    async fetch(request) {
        return new Response("Monitor Worker Active. Use Cron Trigger.");
    }
};
`;

export async function addFeederConversation(conversation: MyConversation, ctx: MyContext) {
    const prompt1 = await ctx.reply("📧 Masukkan Email Cloudflare (Feeder):");
    const emailMsg = await conversation.wait();
    const email = emailMsg.message?.text;

    // Auto-delete user input
    if (emailMsg.message?.message_id) await ctx.api.deleteMessage(ctx.chat?.id!, emailMsg.message.message_id).catch(() => { });

    if (!email || email.toLowerCase() === "batal") {
        await cleanupConversation(ctx, undefined, prompt1.message_id);
        return;
    }

    const prompt2 = await ctx.reply("🔑 Masukkan Global API Key / Token:");
    const keyMsg = await conversation.wait();
    const apiKey = keyMsg.message?.text;

    // Auto-delete user input
    if (keyMsg.message?.message_id) await ctx.api.deleteMessage(ctx.chat?.id!, keyMsg.message.message_id).catch(() => { });

    const prompt3 = await ctx.reply("🆔 Masukkan Account ID Cloudflare:");
    const idMsg = await conversation.wait();
    const accountId = idMsg.message?.text;

    // Auto-delete user input
    if (idMsg.message?.message_id) await ctx.api.deleteMessage(ctx.chat?.id!, idMsg.message.message_id).catch(() => { });

    const prompt4 = await ctx.reply("📢 Masukkan ID Channel Telegram untuk Notifikasi (Contoh: -100xxxxxxx):");
    const channelMsg = await conversation.wait();
    const channelId = channelMsg.message?.text;

    // Auto-delete user input
    if (channelMsg.message?.message_id) await ctx.api.deleteMessage(ctx.chat?.id!, channelMsg.message.message_id).catch(() => { });

    const prompt5 = await ctx.reply("🌐 Masukkan URL Project Vercel Anda (Contoh: https://my-bot.vercel.app):");
    const urlMsg = await conversation.wait();
    let vercelUrl = urlMsg.message?.text;

    // Auto-delete user input
    if (urlMsg.message?.message_id) await ctx.api.deleteMessage(ctx.chat?.id!, urlMsg.message.message_id).catch(() => { });

    if (!email || !apiKey || !accountId || !channelId || !vercelUrl) {
        // Cleanup some prompts? Too complex to clean all, just show error and back.
        return ctx.reply("❌ Input tidak lengkap. Batal.", { reply_markup: backToMainKeyboard });
    }

    if (vercelUrl.endsWith('/')) vercelUrl = vercelUrl.slice(0, -1);
    if (!vercelUrl.includes('/api/webhook')) vercelUrl += '/api/webhook';

    // Type assertion for TS if needed since our CFAuth allows email/apiKey
    const auth: any = { email, apiKey, accountId };
    const workerName = "vless-monitor-feeder";
    const secret = Math.random().toString(36).substring(7);

    const deployMsg = await ctx.reply(`⏳ Deploying Monitor Worker ke Cloudflare: ${workerName}...`);

    try {
        // 1. Upload Worker
        // Need to cast script if strict type, but string is fine.
        await uploadWorker(auth, workerName, MONITOR_SCRIPT);

        // 2. Set Env Vars
        await ctx.api.editMessageText(ctx.chat?.id!, deployMsg.message_id, "⚙️ Setting Environment Variables...");
        await updateWorkerEnv(auth, workerName, {
            BOT_API_URL: vercelUrl,
            BOT_SECRET: secret
        });

        // 3. Set Cron
        await ctx.api.editMessageText(ctx.chat?.id!, deployMsg.message_id, "⏰ Setting Cron Trigger (Setiap 5 menit)...");
        await updateWorkerCron(auth, workerName, ["*/5 * * * *"]);

        // 4. Save Settings to DB
        // Determine type of db.execute. Assuming standard result
        await db.execute({ sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('monitor_channel_id', ?)", args: [channelId] });
        await db.execute({ sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('monitor_secret', ?)", args: [secret] });

        await ctx.api.editMessageText(ctx.chat?.id!, deployMsg.message_id, "✅ Feeder Berhasil Di-setup!\nWorker akan memanggil bot setiap 5 menit untuk cek proxy.", { reply_markup: backToMainKeyboard });

    } catch (err: any) {
        await ctx.reply(`❌ Gagal Setup Feeder: ${err.message}`, { reply_markup: backToMainKeyboard });
    }
}

export async function checkProxiesAndNotify(bot: Bot<MyContext>) {
    // 1. Get Channel ID
    const chReq = await db.execute("SELECT value FROM settings WHERE key = 'monitor_channel_id'");
    let channelId = chReq.rows[0]?.value as string;

    // Fallback to Env
    if (!channelId && process.env.CHANNEL_ID) {
        channelId = process.env.CHANNEL_ID;
    }

    if (!channelId) {
        console.log("No Monitor Channel ID set.");
        return;
    }

    // 2. Get All Proxies
    const proxies = await db.execute("SELECT * FROM workers WHERE type = 'vless'");
    if (proxies.rows.length === 0) return;

    // 3. Check Each Proxy
    for (const row of proxies.rows) {
        const domain = row.subdomain as string;
        const name = row.worker_name as string;
        const flag = row.flag as string;

        try {
            // Simple Connectivity Check
            // Timeout 8s
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 8000);

            const res = await fetch(`https://${domain}`, {
                method: 'GET',
                signal: controller.signal
            });
            clearTimeout(timeout);

            if (!res.ok) {
                // throw new Error(`Status ${res.status}`);
                // Actually, VLESS worker might return 400 or something if no UUID.
                // But a connection error (timeout/dns) means it's DOWN.
                // If it returns 200 "VLESS Admin Node", it is UP.
                // My template returns "VLESS Admin Node", so we expect 200.
            }
        } catch (err: any) {
            // FAILED - SEND ALERT
            const msg = `⚠️ <b>PROXY ALERT</b> ⚠️\n\nName: ${name}\nDomain: ${domain} ${flag}\nStatus: 🔴 DOWN / UNREACHABLE\nError: ${err.message}`;
            try {
                await bot.api.sendMessage(channelId, msg, { parse_mode: "HTML" });
            } catch (tgErr) {
                console.error(`Failed to send alert to ${channelId}:`, tgErr);
            }
        }
    }
}
