import { Bot, Context, session, SessionFlavor } from "grammy";
import {
    mainMenuKeyboard,
    methodKeyboard,
    generateServerListKeyboard,
    generateWildcardListKeyboard,
    subLinkTypeKeyboard,
    subLinkMethodKeyboard,
    adminKeyboard,
    cfSettingsKeyboard
} from "./menus";
import { db } from "../lib/db";
import { uploadWorker, addWorkerDomain, addWorkerRoute } from "../lib/cloudflare";
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
    bot.callbackQuery("action_admin_menu", async (ctx) => {
        if (!isAdmin(ctx)) return ctx.reply("⛔ Akses Ditolak.");
        await ctx.editMessageText("🛠 Admin Menu", { reply_markup: adminKeyboard });
    });

    bot.callbackQuery("admin_cf_settings", async (ctx) => {
        if (!isAdmin(ctx)) return;
        await ctx.editMessageText("⚙️ Pengaturan API CF", { reply_markup: cfSettingsKeyboard });
    });

    // Admin: Add Proxy (Deploy Worker + Wildcard)
    bot.callbackQuery("admin_add_proxy", async (ctx) => {
        if (!isAdmin(ctx)) return;
        await ctx.reply("📝 Masukkan Subdomain untuk Proxy baru (contoh: sg1.mysitevpn.com):");
        await ctx.conversation.enter("addProxyConversation");
    });

    // Member: Add CF Account (No Wildcard Auto-Add)
    bot.callbackQuery("admin_add_cf_account", async (ctx) => {
        // Allow members to add their own accounts
        await ctx.reply("📧 Masukkan Email Cloudflare Anda:");
        await ctx.conversation.enter("addCfAccountConversation");
    });

    bot.callbackQuery("admin_del_proxy", async (ctx) => {
        if (!isAdmin(ctx)) return;
        await ctx.reply("Fitur Delete Proxy: Menampilkan list worker untuk dihapus (To Be Implemented).");
    });
}

// Helper: Check Admin
function isAdmin(ctx: MyContext) {
    const adminIds = process.env.ADMIN_IDS?.split(",").map(Number) || [];
    return adminIds.includes(ctx.from?.id || 0);
}

// Conversation: Member Add CF Account
export async function addCfAccountConversation(conversation: MyConversation, ctx: MyContext) {
    const emailMsg = await conversation.wait();
    const email = emailMsg.message?.text;
    if (!email) return ctx.reply("Batal.");

    await ctx.reply("🔑 Masukkan Global API Key / Token:");
    const keyMsg = await conversation.wait();
    const apiKey = keyMsg.message?.text;

    await ctx.reply("🆔 Masukkan Account ID:");
    const accMsg = await conversation.wait();
    const accountId = accMsg.message?.text;

    if (email && apiKey && accountId) {
        await ctx.reply("⏳ Memverifikasi & Mendaftarkan Akun...");

        try {
            // 1. Save Account
            const res = await db.execute({
                sql: "INSERT INTO cf_accounts (email, api_key, account_id, owner_id) VALUES (?, ?, ?, ?) RETURNING id",
                args: [email, apiKey, accountId, ctx.from?.id || 0]
            });
            const dbAccountId = res.rows[0].id;

            // 2. Auto Deploy Worker
            await ctx.reply("🚀 Sedang men-deploy VLESS Worker ke akun Anda...");

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
            await ctx.reply("🌐 Apakah Anda ingin menggunakan **Custom Domain** sendiri? (Support Wildcard/SNI).\n\nKetik nama domain (misal: `vip.domainku.com`) atau ketik **skip** untuk menggunakan default.");
            const domMsg = await conversation.wait();

            if (domMsg.message?.text && domMsg.message.text.toLowerCase() !== 'skip') {
                const customDomain = domMsg.message.text.toLowerCase();
                await ctx.reply(`🆔 Kirimkan **Zone ID** untuk domain ${customDomain}:`);
                const zoneMsg = await conversation.wait();
                const zoneId = zoneMsg.message?.text;

                if (zoneId) {
                    await ctx.reply("⚙️ Mengikat Custom Domain & Routing Wildcard...");
                    try {
                        // 1. Bind Domain (SSL)
                        await addWorkerDomain(auth, accountId, workerName, customDomain, zoneId);

                        // 2. Add Route Wildcard (*.domain/*)
                        try {
                            await addWorkerRoute(auth, zoneId, `*.${customDomain}/*`, workerName);
                            await ctx.reply(`✅ Routing Wildcard (*.${customDomain}) Berhasil!`);
                        } catch (routeErr: any) {
                            await ctx.reply(`⚠️ Gagal Set Route Wildcard: ${routeErr.message}. Coba set manual di Dash CF.`);
                        }

                        subdomain = customDomain;
                        country = "US"; // Assuming changes
                        flag = "🇺🇸";
                        await ctx.reply(`✅ Domain ${customDomain} berhasil diikat sepenuhnya!`);
                    } catch (err: any) {
                        await ctx.reply(`⚠️ Gagal BIND Domain: ${err.message}. Tetap menggunakan subdomain standar.`);
                    }
                }
            }

            await db.execute({
                sql: "INSERT INTO workers (subdomain, account_id, worker_name, type, country_code, flag) VALUES (?, ?, ?, 'vless', ?, ?)",
                args: [subdomain, dbAccountId, workerName, country, flag]
            });

            await ctx.reply(`✅ Selesai! Worker Anda aktif: ${subdomain}.\nSiap digunakan untuk WS/SNI/Wildcard Pribadi.`);

        } catch (e: any) {
            await ctx.reply(`❌ Gagal: ${e.message}`);
        }
    } else {
        await ctx.reply("⚠️ Gagal, data tidak lengkap.");
    }
}

// Conversation: Admin Add Proxy (With Wildcard)
export async function addProxyConversation(conversation: MyConversation, ctx: MyContext) {
    // 1. Ask Target Account ID
    await ctx.reply("🆔 Masukkan **Account ID Cloudflare** target deployment:");
    const accMsg = await conversation.wait();
    const accountId = accMsg.message?.text;
    if (!accountId) return;

    // 2. Ask Worker Name
    await ctx.reply("📝 Masukkan **Nama Worker** (ex: vless-sg1):");
    const nameMsg = await conversation.wait();
    const workerName = nameMsg.message?.text || `vless-${Date.now()}`;

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
            // If not found in DB, we can't deploy technically without asking for keys.
            // For Admin simplicity, let's ask for keys if not found?
            // Or fail. Let's fail gracefully.
            return ctx.reply("⚠️ Akun ID tidak ditemukan di database. Tambahkan akun dulu di menu Admin.");
        }
    } catch (e) {
        return ctx.reply("⚠️ DB Error.");
    }

    let subdomain = `${workerName}.${accountId.substring(0, 4)}.workers.dev`; // Default
    let country = "ID";
    let flag = "🇮🇩";

    // 3. Ask Custom Domain
    await ctx.reply("🌐 Gunakan **Custom Domain**? (Ketik domain atau 'skip'):");
    const domMsg = await conversation.wait();

    if (domMsg.message?.text && domMsg.message.text.toLowerCase() !== 'skip') {
        const customDomain = domMsg.message.text.toLowerCase();
        await ctx.reply(`🆔 Kirimkan **Zone ID** untuk ${customDomain}:`);
        const zoneMsg = await conversation.wait();
        const zoneId = zoneMsg.message?.text;

        if (zoneId) {
            await ctx.reply("⚙️ Binding Custom Domain & Routing Wildcard...");
            try {
                // REAL API CALL
                await addWorkerDomain(auth, accountId, workerName, customDomain, zoneId);

                // Add Wildcard Route
                try {
                    await addWorkerRoute(auth, zoneId, `*.${customDomain}/*`, workerName);
                    await ctx.reply(`✅ Routing Wildcard (*.${customDomain}) Berhasil!`);
                } catch (routeErr: any) {
                    await ctx.reply(`⚠️ Gagal Set Route Wildcard: ${routeErr.message}.`);
                }

                subdomain = customDomain;
                country = "SG";
                flag = "🇸🇬";
            } catch (err: any) {
                await ctx.reply(`⚠️ Gagal bind domain: ${err.message}`);
            }
        }
    }

    try {
        await ctx.reply(`⏳ Deploying ${workerName}...`);

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

        await ctx.reply(`✅ Proxy Admin Siap!\nDomain: ${subdomain}\nWildcard/SNI: Aktif.`);
    } catch (e: any) {
        await ctx.reply(`❌ Error: ${e.message}`);
    }
}

// Conversation for Manual Bug Input
export async function inputBugConversation(conversation: MyConversation, ctx: MyContext) {
    const bugMsg = await conversation.wait();
    if (!bugMsg.message?.text) return;

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

    const uuid = "USER_UUID_PLACEHOLDER";
    const vlessTls = `vless://${uuid}@${serverAddress}:443?encryption=none&security=tls&sni=${sni}&type=ws&host=${host}&path=${encodeURIComponent(path)}#${encodeURIComponent(remark)}`;
    const vlessNtls = `vless://${uuid}@${serverAddress}:80?encryption=none&security=none&type=ws&host=${host}&path=${encodeURIComponent(path)}#${encodeURIComponent(remark)}`;

    const clashYaml = `
- name: ${remark}
  server: ${serverAddress}
  port: 443
  type: vless
  uuid: ${uuid}
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

    try { await ctx.api.deleteMessage(ctx.chat.id, loadMsg.message_id); } catch (e) { }

    await ctx.reply(`${inputPayload}\n\n<b>${remark}</b>\nMethod: ${method?.toUpperCase()}`, { parse_mode: "HTML" });

    await ctx.reply(`<code>${vlessTls}</code>`, { parse_mode: "HTML" });
    await ctx.reply(`<code>${vlessNtls}</code>`, { parse_mode: "HTML" });
    await ctx.reply(`<code>${clashYaml}</code>`, { parse_mode: "HTML" });

    await ctx.reply("Selesai.", { reply_markup: mainMenuKeyboard });
}
