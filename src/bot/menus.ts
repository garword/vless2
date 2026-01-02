import { Menu } from "@grammyjs/menu";
import { InlineKeyboard } from "grammy";

// Main Menu
export const mainMenuKeyboard = new InlineKeyboard()
    .text("🧪 Cek IP Proxy", "action_check_ip").row()
    .text("🌐 Buat VLESS", "action_create_vless").text("🎲 VLESS Random", "action_random_vless").row()
    .text("📄 List VLESS", "action_list_vless").text("📊 All Status", "action_all_status").row()
    .text("🔍 Cek Status VLESS", "action_check_status_vless").text("🌍 List Wildcard", "action_list_wildcard").row()
    .text("🔗 Get Sub Link", "action_get_sub_link").text("📈 Data Pemakaian", "action_usage_data").row()
    .text("💝 Donasi", "action_donate").text("🛠 Admin Menu", "action_admin_menu");

// Injection Method Menu (WS, SNI, WILDCARD)
export const methodKeyboard = new InlineKeyboard()
    .text("WS", "method_ws").text("SNI", "method_sni").row()
    .text("WILDCARD", "method_wildcard").row()
    .text("⬅️ Kembali", "menu_main");

// Admin Menu (New Structure)
export const adminKeyboard = new InlineKeyboard()
    .text("⚙️ Pengaturan API CF", "admin_cf_settings").row()
    .text("➕ Add Proxy", "admin_add_proxy").text("🗑 Del Proxy", "admin_del_proxy").row()
    .text("📊 Statistik & Monitor", "admin_stats").row()
    .text("⬅️ Kembali", "menu_main");

// Sub-menu: CF Settings
export const cfSettingsKeyboard = new InlineKeyboard()
    .text("🔐 Akun CF VPN", "admin_list_cf_vpn").row()
    .text("📡 Akun CF Feeder", "admin_cf_feeder").row()
    .text("📥 Tambah Akun Baru", "admin_add_cf_account").row()
    .text("⬅️ Kembali", "action_admin_menu");

// Sub Link Menu
export const subLinkTypeKeyboard = new InlineKeyboard()
    .text("VLESS", "sub_type_vless").text("CLASH", "sub_type_clash").row()
    .text("⬅️ Kembali", "menu_main");

export const subLinkMethodKeyboard = new InlineKeyboard()
    .text("WS", "sub_method_ws").text("SNI", "sub_method_sni").row()
    .text("WILDCARD", "sub_method_wildcard").row()
    .text("⬅️ Kembali", "menu_main");

// Dynamic Generators
export function generateServerListKeyboard(servers: { country: string, flag: string, name: string, subdomain: string }[]) {
    const kb = new InlineKeyboard();
    servers.forEach((s) => {
        kb.text(`(${s.country}) ${s.name} ${s.flag}`, `select_server_${s.subdomain}`).row();
    });
    kb.text("⬅️ Kembali", "menu_main");
    return kb;
}

export function generateWildcardListKeyboard(subdomains: string[]) {
    const kb = new InlineKeyboard();
    subdomains.forEach((s) => {
        kb.text(s, `select_wildcard_${s}`).row();
    });
    kb.text("⬅️ Kembali", "menu_main");
    return kb;
}

export const backToMainKeyboard = new InlineKeyboard().text("⬅️ Kembali", "menu_main");
