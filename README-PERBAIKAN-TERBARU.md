# Logistik BELIA-BAYA — Perbaikan terbaru

## Perbaikan yang dikerjakan

1. Tombol X pada **Detail Stok untuk Grup** memakai status `dismissed`. Setelah diklik, material langsung hilang dari daftar grup dan tidak masuk ke panel **Peringatan yang diabaikan**. Status ini disimpan di localStorage browser.
2. Ringkasan pergerakan stok dibuka pada mode **Total sekarang**. Pengguna dapat memilih **Total keseluruhan** untuk melihat total masuk, total keluar, persentase sisa, dan riwayat.
3. Riwayat `inventory_movements` sekarang dimuat dengan pagination 1.000 baris per permintaan sampai halaman terakhir, bukan dibatasi 5.000 baris.
4. Perhitungan persentase stok memakai `stock_percentage_base`. Fungsi transaksi barang masuk pada migrasi `202611080004_reset_stock_percentage_on_incoming.sql` menetapkan dasar baru sebesar stok tepat setelah penerimaan (sisa sebelumnya + barang datang).

## Cara memasang source yang benar

- Ekstrak ZIP ini.
- Buka folder `logistik-belia-baya` yang langsung berisi `package.json`, `src/`, dan `supabase/`. Jangan deploy folder ZIP lama atau folder proyek ganda.
- Jalankan `npm install`, lalu `npm run build`.
- Atur environment Vite sesuai `.env.example` (gunakan URL dan anon key Supabase project Anda; jangan bagikan service-role key).
- Untuk perubahan perhitungan 100%, jalankan migrasi Supabase yang belum pernah diterapkan, termasuk `202611080004_reset_stock_percentage_on_incoming.sql`, sesuai urutan timestamp. Jangan menjalankan ulang migrasi yang sudah berhasil diterapkan.

## Batasan yang perlu diketahui

- Tombol X tersimpan per browser melalui localStorage; status belum tersinkron antar akun/perangkat.
- Kode sumber tidak dapat mengubah database Supabase produksi tanpa akses project dan persetujuan pemiliknya.
- Jalankan migrasi SQL pada Supabase sebelum menguji penerimaan barang untuk memastikan dasar 100% diperbarui di database.
