# Ruank WA Automation

Multi-user WhatsApp workspace untuk inbox, AI auto reply, knowledge base, grup, dan broadcast terjadwal melalui Starsender.

## Menjalankan

```powershell
npm install
Copy-Item .env.example .env
npm run db:generate
npm run db:push
npm start
```

Buka `http://localhost:3000`.

Atur `ADMIN_EMAIL`, `ADMIN_PASSWORD`, dan `ADMIN_NAME` di `.env` untuk membuat superadmin pertama. Jangan menyimpan kredensial produksi di repository.

## Konfigurasi

Starsender dan Gemini diatur per user dari **Settings > Integrasi API**. API key disimpan terenkripsi menggunakan `APP_ENCRYPTION_KEY`.

Webhook setiap user berbeda. Salin URL dari **Settings > Webhook** ke konfigurasi incoming webhook Starsender.

Atur `PUBLIC_BASE_URL` ke domain HTTPS publik aplikasi agar Starsender dapat mengambil gambar upload dan menampilkannya sebagai media WhatsApp, bukan dokumen.

## Data dan keamanan

- Data percakapan, knowledge, broadcast, dan konfigurasi terisolasi berdasarkan user.
- Login menggunakan session cookie HTTP-only.
- Password disimpan sebagai hash `scrypt`.
- Broadcast menggunakan alur draft, preview, test, schedule, retry, dan cancel.
- `app.db`, `.env`, upload, dan log tidak masuk source control.

Untuk produksi, jalankan satu instance aplikasi jika masih memakai SQLite. Gunakan PostgreSQL sebelum menjalankan beberapa instance server secara paralel.
