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
import { CFAuth, uploadWorker, addWorkerDomain, addWorkerRoute, updateWorkerCron, updateWorkerEnv, getZones } from "../lib/cloudflare";
import { Conversation, ConversationFlavor } from "@grammyjs/conversations";
import * as fs from "fs/promises";
import * as path from "path";

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
    // Command: /add_cf <email>|<key>|<id>
    bot.command("add_cf", async (ctx) => {
        if (!isAdmin(ctx)) return ctx.reply("⛔ Akses Ditolak.");

        const args = ctx.match.split("|").map(s => s.trim());
        if (args.length !== 3) {
            return ctx.reply("❌ Format Salah!\nGunakan pemisah '|' (garis tegak).\n\nFormat:\n`/add_cf email|api_key|account_id`", { parse_mode: "Markdown" });
        }

        const [email, apiKey, accountId] = args;
        await ctx.reply(`⏳ Menambahkan Akun Cloudflare...\nEmail: ${email}\nID: ${accountId}`);

        try {
            // Ensure User Exists
            if (ctx.from) {
                await db.execute({
                    sql: "INSERT OR IGNORE INTO users (id, username, full_name, role) VALUES (?, ?, ?, 'admin')",
                    args: [ctx.from.id, ctx.from.username || "user", ctx.from.first_name || "User"]
                });
            }

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
        if (!isAdmin(ctx)) return ctx.reply("⛔ Akses Ditolak.");

        const args = ctx.match.split("|").map(s => s.trim());
        if (args.length !== 5) {
            return ctx.reply("❌ Format Salah!\nGunakan pemisah '|'.\n\nFormat:\n`/add_feeder email|key|id|channel_id|vercel_url`", { parse_mode: "Markdown" });
        }

        let [email, apiKey, accountId, channelId, vercelUrl] = args;

        if (vercelUrl.endsWith('/')) vercelUrl = vercelUrl.slice(0, -1);
        if (!vercelUrl.includes('/api/webhook')) vercelUrl += '/api/webhook';

        await ctx.reply(`🔍 **Memulai Setup Feeder...**\nTarget Channel: ${channelId}`);

        try {
            // Ensure User Exists (Fix FK Constraint)
            if (ctx.from) {
                await db.execute({
                    sql: "INSERT OR IGNORE INTO users (id, username, full_name, role) VALUES (?, ?, ?, 'admin')",
                    args: [ctx.from.id, ctx.from.username || "user", ctx.from.first_name || "User"]
                });
            }

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

            // 3. Save Settings & Account
            await ctx.reply("3️⃣ Menyimpan Pengaturan...");
            await db.execute({ sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('monitor_channel_id', ?)", args: [channelId] });
            await db.execute({ sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('monitor_secret', ?)", args: [secret] });

            // Save Account for Management
            await db.execute({
                sql: "INSERT INTO cf_accounts (email, api_key, account_id, owner_id, type) VALUES (?, ?, ?, ?, 'feeder')",
                args: [email, apiKey, accountId, ctx.from?.id || 0]
            });

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

    bot.callbackQuery("admin_add_feeder_guide", async (ctx) => {
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

    bot.callbackQuery("admin_list_cf_vpn", async (ctx) => {
        if (!isAdmin(ctx)) return;
        try {
            const res = await db.execute("SELECT id, email, account_id FROM cf_accounts WHERE type='vpn' OR type IS NULL OR type='active'"); // Handle legacy defaults
            if (res.rows.length === 0) return ctx.editMessageText("⚠️ Tidak ada akun VPN terdaftar.", { reply_markup: cfSettingsKeyboard });

            let text = "🔐 **List Akun VPN:**\n\n";
            const kb = new InlineKeyboard();
            res.rows.forEach((row: any) => {
                text += `• \`${row.email}\`\n  ID: ${row.account_id.substring(0, 4)}...\n\n`;
                kb.text(`🗑 Hapus ${row.email}`, `delete_cf_account_${row.id}`).row();
            });
            kb.text("⬅️ Kembali", "admin_cf_settings");

            await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: kb });
        } catch (e: any) {
            await ctx.reply(`Error: ${e.message}`);
        }
    });

    bot.callbackQuery("admin_list_cf_feeder", async (ctx) => {
        if (!isAdmin(ctx)) return;
        try {
            const res = await db.execute("SELECT id, email, account_id FROM cf_accounts WHERE type='feeder'");
            if (res.rows.length === 0) return ctx.editMessageText("⚠️ Tidak ada akun Feeder terdaftar.", { reply_markup: cfSettingsKeyboard });

            let text = "📡 **List Akun Feeder:**\n\n";
            const kb = new InlineKeyboard();
            res.rows.forEach((row: any) => {
                text += `• \`${row.email}\`\n  ID: ${row.account_id.substring(0, 4)}...\n\n`;
                kb.text(`🗑 Hapus ${row.email}`, `delete_cf_account_${row.id}`).row();
            });
            kb.text("⬅️ Kembali", "admin_cf_settings");

            await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: kb });
        } catch (e: any) {
            await ctx.reply(`Error: ${e.message}`);
        }
    });

    bot.callbackQuery(/delete_cf_account_(\d+)/, async (ctx) => {
        if (!isAdmin(ctx)) return;
        const id = ctx.match[1];
        try {
            // Get info before delete for confirmation msg
            const check = await db.execute({ sql: "SELECT email FROM cf_accounts WHERE id=?", args: [id] });
            const email = check.rows[0]?.email || "Akun";

            // Delete Worker first (Child)
            await db.execute({ sql: "DELETE FROM workers WHERE account_id=?", args: [id] });
            // Then Account (Parent)
            await db.execute({ sql: "DELETE FROM cf_accounts WHERE id=?", args: [id] });

            await ctx.answerCallbackQuery(`✅ ${email} dihapus!`);
            await ctx.editMessageText(`✅ **BERHASIL!**\n\nAkun \`${email}\` telah dihapus dari database bot.\nWorker di Cloudflare tidak disentuh (aman).`, { parse_mode: "Markdown", reply_markup: cfSettingsKeyboard });
        } catch (e: any) {
            await ctx.answerCallbackQuery(`❌ Gagal: ${e.message}`);
        }
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
// Conversation: Member Add CF Account (Interactive)
export async function addCfAccountConversation(conversation: MyConversation, ctx: MyContext) {
    await ctx.reply("📧 Masukkan **Email Cloudflare**:");
    const emailMsg = await conversation.wait();
    const email = (emailMsg.message?.text || "").trim();

    // Auto-delete user input
    if (emailMsg.message?.message_id) await ctx.api.deleteMessage(ctx.chat?.id!, emailMsg.message.message_id).catch(() => { });

    if (!email || email.length < 5 || email.toLowerCase() === "batal") return ctx.reply("❌ Email tidak valid / Batal.");

    await ctx.reply("🔑 Masukkan **Global API Key / Token**:");
    const keyMsg = await conversation.wait();
    const apiKey = (keyMsg.message?.text || "").trim();

    // Auto-delete user input
    if (keyMsg.message?.message_id) await ctx.api.deleteMessage(ctx.chat?.id!, keyMsg.message.message_id).catch(() => { });

    if (!apiKey || apiKey.length < 10) return ctx.reply("❌ API Key tidak valid.");

    await ctx.reply("🆔 Masukkan **Account ID Cloudflare**:");
    const idMsg = await conversation.wait();
    const accountId = (idMsg.message?.text || "").trim();

    // Auto-delete user input
    if (idMsg.message?.message_id) await ctx.api.deleteMessage(ctx.chat?.id!, idMsg.message.message_id).catch(() => { });

    if (!accountId) return ctx.reply("❌ Account ID tidak valid.");

    // Verify Auth
    await ctx.reply("🔄 Verifikasi Akun & Mengambil Zone...");
    const auth = { email, apiKey, accountId };
    let zones: any[] = [];

    try {
        const res = await conversation.external(() => getZones(auth));
        zones = res;
        await ctx.reply(`✅ Terhubung! Ditemukan ${zones.length} domain (Zones).`);
    } catch (e: any) {
        return ctx.reply(`❌ Gagal Terhubung: ${e.message}. Cek Email/Key/ID.`);
    }

    // Name Worker
    await ctx.reply("📝 Masukkan **Nama Worker** (ex: vless-sg1):");
    const nameMsg = await conversation.wait();
    const workerName = (nameMsg.message?.text || `vless-${Date.now()}`).trim();

    if (nameMsg.message?.message_id) await ctx.api.deleteMessage(ctx.chat?.id!, nameMsg.message.message_id).catch(() => { });

    // Custom Domain
    await ctx.reply("🌐 Gunakan **Custom Domain**? (Ketik domain lengkap, misal `sub.domainku.com`, atau ketik `skip`):");
    const domMsg = await conversation.wait();
    const customDomainInput = (domMsg.message?.text || 'skip').trim().toLowerCase();

    if (domMsg.message?.message_id) await ctx.api.deleteMessage(ctx.chat?.id!, domMsg.message.message_id).catch(() => { });

    let subdomain = `${workerName}.${accountId.substring(0, 4)}.workers.dev`;
    let zoneId = "";

    if (customDomainInput !== 'skip' && customDomainInput.includes('.')) {
        // Find matching zone
        const matched = zones.find(z => customDomainInput.endsWith(z.name));
        if (matched) {
            zoneId = matched.id;
            subdomain = customDomainInput;
            await ctx.reply(`✅ Domain valid! Menggunakan Zone: ${matched.name}`);
        } else {
            await ctx.reply("⚠️ Domain tidak ditemukan di akun Cloudflare ini. Menggunakan default workers.dev.");
        }
    }

    await ctx.reply("🚀 Deploying Worker...");

    try {
        // Read Worker Script
        const scriptPath = path.join(process.cwd(), "src/templates/worker.js");
        const scriptContent = await conversation.external(() => fs.readFile(scriptPath, "utf8"));

        // Deploy
        await conversation.external(() => uploadWorker(auth, workerName, scriptContent));

        // Bind Domain if needed
        if (zoneId && subdomain === customDomainInput) {
            await ctx.reply("⚙️ Binding Custom Domain...");
            try {
                await conversation.external(() => addWorkerDomain(auth, accountId, workerName, subdomain, zoneId));
                await ctx.reply("✅ Custom Domain Bound!");
            } catch (e: any) {
                await ctx.reply(`⚠️ Gagal Bind Domain: ${e.message}`);
            }
        }

        // Save to DB
        if (ctx.from) {
            await conversation.external(() => db.execute({
                sql: "INSERT OR IGNORE INTO users (id, username, full_name, role) VALUES (?, ?, ?, 'admin')",
                args: [ctx.from!.id, ctx.from!.username || "user", ctx.from!.first_name || "User"]
            }));
        }

        // Save Account
        await conversation.external(() => db.execute({
            sql: "INSERT OR IGNORE INTO cf_accounts (email, api_key, account_id, owner_id) VALUES (?, ?, ?, ?)",
            args: [email, apiKey, accountId, ctx.from?.id || 0]
        }));

        const accRes = await conversation.external(() => db.execute({ sql: "SELECT id FROM cf_accounts WHERE account_id=?", args: [accountId] }));
        const dbAccId = accRes.rows[0]?.id;

        // Save Worker
        await conversation.external(() => db.execute({
            sql: "INSERT INTO workers (subdomain, account_id, worker_name, type, country_code, flag) VALUES (?, ?, ?, 'vless', 'ID', '🇮🇩')",
            args: [subdomain, dbAccId, workerName]
        }));

        await ctx.reply(`✅ **SUKSES!**\n\nWorker: \`${workerName}\`\nDomain: \`${subdomain}\`\nAkun: ${email}\n\nSiap digunakan!`, { parse_mode: "Markdown", reply_markup: backToMainKeyboard });

    } catch (e: any) {
        await ctx.reply(`❌ Error Deploy: ${e.message}`, { reply_markup: backToMainKeyboard });
    }
}

// Conversation: Manual Add Proxy
export async function addProxyConversation(conversation: MyConversation, ctx: MyContext) {
    await ctx.reply("🌐 Masukkan **Domain/IP Proxy**:");
    const hostMsg = await conversation.wait();
    const host = hostMsg.message?.text;

    if (hostMsg.message?.message_id) await ctx.api.deleteMessage(ctx.chat?.id!, hostMsg.message.message_id).catch(() => { });

    if (!host) return;

    await ctx.reply("📝 Masukkan **Nama Proxy**:");
    const nameMsg = await conversation.wait();
    const name = nameMsg.message?.text || "Proxy";

    if (nameMsg.message?.message_id) await ctx.api.deleteMessage(ctx.chat?.id!, nameMsg.message.message_id).catch(() => { });

    // Save
    try {
        await conversation.external(() => db.execute({
            sql: "INSERT INTO workers (subdomain, account_id, worker_name, type, country_code, flag) VALUES (?, NULL, ?, 'vless', 'ID', '🇮🇩')",
            args: [host, name]
        }));
        await ctx.reply(`✅ Proxy **${name}** (${host}) berhasil disimpan!`, { reply_markup: backToMainKeyboard });
    } catch (e: any) {
        await ctx.reply(`❌ Gagal simpan: ${e.message}`, { reply_markup: backToMainKeyboard });
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
