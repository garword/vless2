# VLESS Manager Bot

Bot Telegram untuk manajemen VLESS Cloudflare Workers, mendukung Multi-Account, Rotasi, dan Wildcard.

## 🚀 Fitur Utama
- **Generasi VLESS/Clash Config**: Mendukung metode WS, SNI, dan Wildcard.
- **Monitoring Otomatis**: Cek status node setiap 5 jam dan notif ke Channel.
- **Multi-Akun Cloudflare**: Load balancing deployment ke banyak akun.
- **Manajemen User**: Member bisa tambah akun CF sendiri (terisolasi).

## 🛠 Instalasi & Deployment

### 1. Persiapan Database (Turso)
Buat database di Turso dan dapatkan URL + Auth Token.
Jalankan skema database:
```bash
turso db shell <nama-db> < schema.sql
```

### 2. Deployment ke Vercel
Pastikan Anda sudah login ke Vercel CLI (`npm i -g vercel`).

1. Konfigurasi Environment Variables di Vercel:
   - `BOT_TOKEN`: Token dari @BotFather.
   - `TURSO_DATABASE_URL`: URL Database Turso (libsql://...).
   - `TURSO_AUTH_TOKEN`: Token Auth Turso.
   
2. Deploy:
```bash
vercel --prod
```

### 3. Setup Webhook Telegram
Setelah deploy, set webhook bot ke URL Vercel:
```
https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<PROJECT>.vercel.app/api/webhook
```

### 4. Setup Monitoring (Opsional)
Untuk mengaktifkan monitoring 24/7 (gratis via CF Cron):
1. Buka `src/templates/monitor.js`.
2. Deploy script ini ke akun Cloudflare khusus (Feeder).
3. Set Cron Trigger di Dashboard CF -> Workers -> Triggers -> Cron (e.g. `0 */5 * * *`).
4. Set Environment Variables di Worker:
   - `BOT_API_URL`: URL Vercel Anda (https://...).
   - `BOT_SECRET`: Secret key untuk keamanan (opsional).

## ❓ FAQ
**Q: Apakah Vercel Gratis bisa 24/7?**
A: **BISA.** Vercel menggunakan sistem Webhook, jadi bot "tidur" saat tidak ada chat, tidak memakan resource server terus menerus. Untuk monitoring yang harus jalan terus, kita menggunakan **Cloudflare Cron Triggers** (juga gratis) yang memanggil API bot. Jadi, kombinasi ini 100% aman untuk paket Vercel Hobby.

## 📂 Struktur Project
- `api/webhook.ts`: Entry point bot.
- `src/bot/handlers.ts`: Logika utama bot.
- `src/bot/menus.ts`: Layout tombol.
- `src/lib/cloudflare.ts`: Helper API CF.
