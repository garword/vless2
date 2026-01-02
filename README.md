# VLESS Manager Bot

Bot Telegram untuk manajemen VLESS Cloudflare Workers, mendukung Multi-Account, Rotasi, dan Wildcard.

## 🚀 Fitur Utama
- **Generasi VLESS/Clash Config**: Mendukung metode WS, SNI, dan Wildcard.
- **Monitoring Otomatis (Feeder)**: Worker khusus yang mengecek status proxy setiap 5 menit dan mengirim notifikasi jika Down.
- **Multi-Akun Cloudflare**: Load balancing deployment ke banyak akun.
- **Manajemen User**: Member bisa tambah akun CF sendiri (terisolasi).
- **Auto Wildcard & SSL**: Support binding custom domain dan wildcard routing `*.domain/*` secara otomatis.
- **Admin Tools**: Hapus proxy, list akun, cek statistik.

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
   - `ADMIN_IDS`: ID Telegram Admin (pisahkan koma jika banyak).
   
2. Deploy:
```bash
vercel --prod
```

### 3. Setup Webhook Telegram
Setelah deploy, set webhook bot ke URL Vercel:
```
https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<PROJECT>.vercel.app/api/webhook
```

### 4. Setup Monitoring (Otomatis)
Fitur monitoring sekarang bisa di-setup langsung dari bot!
1. Buka Bot -> **Admin Menu** -> **Akun CF Feeder**.
2. Masukkan Kredensial Akun Cloudflare (Bisa akun terpisah).
3. Masukkan ID Channel Telegram untuk notifikasi.
4. Bot akan otomatis:
   - Deploy worker `vless-monitor-feeder`.
   - Mengatur Cron Job (5 Menit).
   - Menghubungkan Feeder dengan Bot utama.

## ❓ FAQ
**Q: Apakah Vercel Gratis bisa 24/7?**
A: **BISA.** Vercel menggunakan sistem Webhook, jadi bot "tidur" saat tidak ada chat, tidak memakan resource server terus menerus. Untuk monitoring yang harus jalan terus, kita menggunakan **Cloudflare Cron Triggers** (juga gratis) yang memanggil API bot. Jadi, kombinasi ini 100% aman untuk paket Vercel Hobby.

## 📂 Struktur Project
- `api/webhook.ts`: Entry point bot.
- `src/bot/handlers.ts`: Logika utama bot.
- `src/bot/menus.ts`: Layout tombol.
- `src/lib/cloudflare.ts`: Helper API CF.

## 📤 Panduan Upload ke GitHub

Jika Anda ingin menyimpan kode ini di GitHub dan melakukan deployment otomatis:

### 1. Buat Repository Baru
Buat repository kosong di [GitHub](https://github.com/new). Jangan centang "Add a README" atau "gitignore".

### 2. Upload Kode dari Terminal
Buka terminal di folder project ini, lalu jalankan perintah berikut (ganti `USERNAME` dan `REPO` dengan milik Anda):

```bash
# 1. Inisialisasi Git (jika belum)
git init

# 2. Tambahkan semua file (kecuali yang ada di .gitignore)
git add .

# 3. Simpan perubahan (Commit)
git commit -m "Upload source code bot vless"

# 4. Hubungkan ke GitHub (Ganti URL di bawah!)
git remote add origin https://github.com/USERNAME/NAMA-REPO.git

# 5. Ganti nama branch utama ke 'main' (standar baru)
git branch -M main

# 6. Upload (Push)
git push -u origin main
```

### 3. Integrasi Vercel (Opsional)
Jika Anda ingin setiap update di GitHub otomatis ter-deploy ke Vercel:
1. Buka Dashboard Vercel -> Project Settings -> Git.
2. Hubungkan repository GitHub yang baru Anda buat.
3. Setiap kali Anda `git push`, Vercel akan otomatis melakukan build & deploy ulang.
