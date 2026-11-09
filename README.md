# Logistik Casa Dreamland / BELIA-BAYA

Aplikasi web React + Vite + TypeScript. Autentikasi, database PostgreSQL, dan penyimpanan foto menggunakan Supabase.

## Setup lokal
1. Buat/siapkan project Supabase.
2. Untuk database baru, jalankan `supabase/schema.sql`, lalu jalankan `supabase/migrations/202611040003_prevent_duplicate_inventory_movements.sql`, `supabase/migrations/202611050002_allow_negative_stock_balance.sql`, dan `supabase/migrations/202611080004_reset_stock_percentage_on_incoming.sql` secara berurutan. `schema.sql` sudah memuat struktur terbaru; dua migrasi tengah memasang RPC transaksi dan aturan stok negatif, sedangkan migrasi terakhir mengaktifkan perhitungan dasar 100% setiap penerimaan.
3. Untuk database yang sudah berjalan, baca `README-REVISI.md` dan jalankan hanya migrasi yang belum diterapkan sesuai kondisi schema/database Anda. Jangan menjalankan ulang migrasi lama secara membabi buta.
4. Salin `.env.example` menjadi `.env.local`, lalu isi `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY` dengan URL dan anon/publishable key project.
5. Jalankan `npm install`, `npm run build`, lalu `npm run dev`.

Jangan pernah memasukkan `service_role` key atau secret key ke frontend atau variabel berawalan `VITE_`.

## Deploy ke Vercel
1. Push source project ke repository Git.
2. Import repository di Vercel dan pilih framework Vite.
3. Build Command: `npm run build`; Output Directory: `dist`.
4. Tambahkan `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY` pada Environment Variables Vercel.
5. Tambahkan domain Vercel pada URL/redirect yang diizinkan di Supabase Auth, lalu deploy.

## Modul aplikasi
- Dashboard, ringkasan stok, peringatan persediaan, Abaikan, dan Noted.
- Detail Stok untuk Grup dengan tombol X untuk menghapus peringatan dari daftar Noted tanpa memindahkannya ke daftar diabaikan.
- Detail Pergerakan Stok dengan pilihan Total sekarang dan Total keseluruhan.
- Master Kode Material & Alat; status aktif ditentukan otomatis oleh isian satuan.
- Transaksi Barang Masuk dan Barang Keluar multi-item melalui RPC.
- Stok Gudang, koreksi stok, persentase tersisa (dasar 100% di-reset dari sisa sebelumnya + barang datang pada setiap penerimaan), dan detail riwayat pergerakan.
- Monitoring bulanan dalam lima periode.
- Dokumentasi foto Barang Masuk per transaksi.

## Keamanan dan catatan operasional
- RLS diaktifkan pada tabel database. View `stock_balances` memakai `security_invoker` agar kebijakan RLS tabel sumber diterapkan untuk pengguna yang menjalankan query.
- Posting transaksi dilakukan melalui RPC agar header, detail, dan movement dicatat secara atomik.
- Foto disimpan di bucket privat `incoming-evidence` dan diakses menggunakan signed URL.
- Barang Keluar dapat menghasilkan stok negatif sesuai migrasi yang dipasang. Stok negatif perlu ditindaklanjuti dengan pemeriksaan fisik gudang.
- Status Noted/Abaikan disimpan pada browser masing-masing melalui `localStorage`, belum disinkronkan antar perangkat.
- Lihat `AUDIT-FITUR.md` untuk hasil audit source dan batasan pengujian.
- Uji transaksi, RLS, dan Storage pada project Supabase sebelum digunakan operasional.
