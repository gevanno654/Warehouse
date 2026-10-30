# Deployment Produksi — warehouse.gelabs.net

Dokumen ini menjelaskan persiapan direktori, environment, Compose produksi,
pemeriksaan status, migration, log, backup/restore, dan upstream aaPanel.

> Status akhir: deployment produksi selesai dan aplikasi live di
> `https://warehouse.gelabs.net` (HTTPS aktif).
> Bagian persiapan di bawah dipertahankan sebagai prosedur yang telah dijalankan;
> perintah bertanda ⛔ hanya untuk konteks fase persiapan dan tidak boleh
> dijalankan ulang tanpa persetujuan.

## 1. Prasyarat

- VPS Ubuntu 24.04, Docker Engine 29.3.0, Compose v5.1.0.
- Domain `warehouse.gelabs.net` → `103.197.188.127` (sudah mengarah, terverifikasi 6.2A).
- Port yang dipakai layanan existing: `80/443` (Nginx aaPanel), `3000` (kartar),
  `8010` (ses), `3306` (MySQL). Jangan pakai port tersebut untuk Warehouse.
- Port produksi Warehouse: `127.0.0.1:5174` (web→80), `127.0.0.1:3001` (api→3000).
  PostgreSQL hanya internal, tanpa port host.

## 2. Persiapan direktori `/opt/warehouse-receiving`

Direktori disetujui: `/opt/warehouse-receiving` (bukan `/www/wwwroot/...`).

```bash
ls -ld /opt/warehouse-receiving
cd /opt/warehouse-receiving
git remote -v
git branch --show-current   # main
git rev-parse HEAD
git status --short --branch
```

Clone awal (sudah dilakukan di 6.2B, jangan diulang tanpa alasan):

```bash
sudo mkdir -p /opt/warehouse-receiving
sudo chown gevannoyoh:gevannoyoh /opt/warehouse-receiving
git clone --branch main https://github.com/gevanno654/Warehouse.git /opt/warehouse-receiving
```

## 3. Persiapan file environment produksi

Template: `.env.production.example` (placeholder saja, aman di-commit).

```bash
cd /opt/warehouse-receiving
cp .env.production.example .env.production
chmod 600 .env.production
# Edit .env.production DI VPS dengan secret asli. Jangan commit.
# Jangan salin secret ke chat atau tool AI.
```

Hasilkan secret DI VPS (jangan di-commit, jangan dibagikan):

```bash
openssl rand -base64 32   # POSTGRES_PASSWORD
openssl rand -base64 48   # JWT_SECRET
```

Aturan pengisian:

- `POSTGRES_PASSWORD` harus sama dengan password di `DATABASE_URL`.
- Hindari karakter yang merusak parsing URL PostgreSQL (`@`, `/`, `:`, `#`, `?`,
  spasi). Bila harus dipakai, URL-encode (mis. `@` → `%40`).
- `JWT_SECRET` minimal 16 karakter (`backend/src/config/env.ts`).
- `CORS_ORIGIN=https://warehouse.gelabs.net`,
  `VITE_API_BASE_URL=https://warehouse.gelabs.net`.
- Jangan isi `DATABASE_URL_HOST`, `TEST_DATABASE_URL`, `SEED_PASSWORD`,
  `ALLOW_PROD_SEED` di produksi. `BCRYPT_ROUNDS` opsional (default 12, min 10,
  maks 15).
- Pastikan `.env.production` tidak masuk Git (`git status` tidak boleh
  menampilkannya; `.gitignore` sudah mengabaikan `.env*` kecuali template).

Wajib diisi administrator di VPS:

| Variable | Nilai |
|---|---|
| `NODE_ENV` | `production` (tetap) |
| `PORT` | `3000` (internal container) |
| `POSTGRES_USER` | `warehouse_app` |
| `POSTGRES_DB` | `warehouse_production` |
| `POSTGRES_PASSWORD` | password kuat baru, mis. `openssl rand -base64 32` |
| `DATABASE_URL` | `postgresql://warehouse_app:<PASSWORD>@db:5432/warehouse_production` |
| `CORS_ORIGIN` | `https://warehouse.gelabs.net` |
| `VITE_API_BASE_URL` | `https://warehouse.gelabs.net` |
| `JWT_SECRET` | acak kuat ≥16 char, mis. `openssl rand -base64 48` |
| `JWT_EXPIRES_IN` | `1h` (atau `30m`, `12h`, `7d`) |

Tidak dipakai di runtime produksi: `DATABASE_URL_HOST`, `TEST_DATABASE_URL`,
`SEED_PASSWORD`, `ALLOW_PROD_SEED`. `BCRYPT_ROUNDS` opsional (default 12).

## 4. Cara menjalankan Docker Compose produksi (sudah dijalankan saat deployment)

```bash
cd /opt/warehouse-receiving
docker compose -f compose.production.yml --env-file .env.production config
docker compose -f compose.production.yml --env-file .env.production up -d --build
```

Stack produksi yang berjalan: `warehouse-db-production` (healthy),
`warehouse-api-production` (healthy), `warehouse-web-production` (running).

File produksi `compose.production.yml` adalah file standalone — jangan
digabung dengan `docker-compose.yml` via multiple `-f`, karena file dev
mempublikasikan `5432/3000/5173` dan me-mount `init-test-db.sql`.

## 5. Cara memeriksa status container

```bash
docker compose -f compose.production.yml --env-file .env.production ps
docker inspect warehouse-db-production warehouse-api-production warehouse-web-production --format '{{.Name}} {{.State.Status}}'
ss -tlnp | grep -E ':5174 |:3001 '
curl -s http://127.0.0.1:3001/health
curl -s http://127.0.0.1:5174/health
```

## 6. Healthcheck backend dan frontend

- Backend: `GET http://127.0.0.1:3001/health` → `{"status":"ok"}`.
  `GET http://127.0.0.1:3001/ready` → `200 {"status":"ready"}` bila DB terhubung,
  `503` bila tidak.
- Frontend: `GET http://127.0.0.1:5174/` → HTML SPA.
  `GET http://127.0.0.1:5174/health`, `/ready`, `/openapi.yaml`, `/docs`
  di-proxy ke backend (lihat `frontend/nginx.production.conf`).
- Publik (setelah proxy aaPanel + SSL aktif):
  `https://warehouse.gelabs.net/health`, `/ready`, `/api/v1/...`.

## 7. Prisma migration (sudah diterapkan saat deployment)

Perintah produksi yang telah dijalankan setelah container `db`+`api` siap:

```bash
cd /opt/warehouse-receiving
docker compose -f compose.production.yml --env-file .env.production exec api npx prisma migrate deploy
```

Dilarang: `migrate dev`, `db push`, `migrate reset`.
Migrasi yang diterapkan: `20261029072619_init`,
`20261029153544_widen_product_sku`, `20261029180000_add_document_number_sequence`.
Target DB: `warehouse_production` — bukan `warehouse_dev`/`warehouse_test`.

## 8. Log container

```bash
docker compose -f compose.production.yml --env-file .env.production logs --tail=100
docker compose -f compose.production.yml --env-file .env.production logs -f api
docker compose -f compose.production.yml --env-file .env.production logs -f web
docker compose -f compose.production.yml --env-file .env.production logs -f db
```

## 9. Backup dan restore PostgreSQL

Volume produksi: `warehouse_production_data` (nama volume Compose:
`warehouse-receiving-production_warehouse_production_data` — verifikasi via
`docker volume ls`).

Backup (logical dump, tanpa henti container):

```bash
docker exec warehouse-db-production pg_dump -U warehouse_app warehouse_production > /opt/warehouse-backup-$(date +%F).sql
```

Restore ke database kosong (fase maintenance, ⛔ bukan 6.2B):

```bash
cat /opt/warehouse-backup-<DATE>.sql | docker exec -i warehouse-db-production psql -U warehouse_app -d warehouse_production
```

Alternatif snapshot volume: hentikan stack terlebih dahulu (⛔ bukan 6.2B),
lalu backup path volume Docker.

## 10. Konfigurasi upstream aaPanel (sudah aktif, via panel)

Proxy Project `warehouse.gelabs.net` → `http://127.0.0.1:5174` (frontend produksi).
Sertifikat Let's Encrypt untuk `warehouse.gelabs.net` sudah diterbitkan via panel
dengan HTTPS aktif.

Verifikasi: `https://warehouse.gelabs.net/health` dan `/.well-known` lolos.
Jangan arahkan proxy langsung ke `api:3001` — browser harus ke frontend,
frontend mem-proxy `/api/*` ke backend internal.

## 11. Batasan operasional yang tetap berlaku

- Jangan menjalankan `migrate dev`, `db push`, atau `migrate reset`.
- Jangan membuat/menghapus/mereset/mengubah database di luar prosedur.
- Jangan menjalankan seed demo (`npm run db:seed`) di produksi.
- Jangan mengaktifkan `ALLOW_PROD_SEED=true`.
- Jangan mengubah Nginx/aaPanel, DNS, SSL, atau firewall tanpa persetujuan.
- Jangan menghentikan layanan berjalan atau menghapus image/volume/cache.
- Jangan commit dengan secret atau `.env.production` asli.

## 12. Bootstrap Supervisor pertama (sudah dijalankan saat deployment)

Status: tidak ada endpoint registrasi/pembuatan user. Satu-satunya penulis
`users` adalah seed demo (`supervisor@example.com`/`operator@example.com`),
yang ditolak di produksi kecuali `ALLOW_PROD_SEED=true`. Jangan aktifkan itu.

Implementasi: **one-time CLI interaktif**
(`backend/src/seed/bootstrap-supervisor.ts` + `backend/prisma/bootstrap-supervisor.ts`,
script `npm run db:bootstrap-supervisor`):

- Dijalankan manual di VPS setelah `migrate deploy` dan telah berhasil membuat
  satu akun Supervisor.
- Email via prompt terlihat; password + konfirmasi via prompt tersembunyi (no echo).
- Password tidak via argumen CLI, file, atau env permanen; tidak dicetak ke log;
  hanya di memori proses. Jangan simpan password bootstrap di `.env.production`.
- Hash bcrypt sama dengan login (default 12, rentang 10–15).
- Menolak bila `NODE_ENV != production`, bila sudah ada SUPERVISOR, atau bila
  email sudah terdaftar. Tidak membuat akun demo/Operator.
- Seluruh operasi DB dalam satu transaksi Prisma + `pg_advisory_xact_lock`
  (kunci `8417964523109753`); pelanggaran unik `users.email` dipetakan ke
  `BootstrapError` yang aman.
- Buat password kuat via `openssl rand -base64 32` atau password manager.

Verifikasi setelah bootstrap:

```bash
curl -s -X POST https://warehouse.gelabs.net/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"<supervisor-email>","password":"<password>"}'
```

Jangan menjalankan bootstrap ulang bila SUPERVISOR sudah ada — script akan
menolak. Gunakan login untuk verifikasi, jangan buat duplikat.
