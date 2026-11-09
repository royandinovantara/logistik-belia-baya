# Logistik BELIA-BAYA — Revisi Rencana Barang

## Fitur Rencana Barang
- Tambahkan beberapa material secara bertahap.
- Satu material hanya dapat memiliki satu rencana aktif.
- Realisasi dihitung dari total detail transaksi Barang Masuk (`incoming_items`).
- Persentase terpenuhi dan sisa kebutuhan dihitung otomatis.
- Tombol × menghapus permanen baris pada `material_plans` saja.
- Tidak mengubah master material, stok gudang, maupun transaksi Barang Masuk/Keluar.

## Langkah penerapan database
Jalankan SQL migration berikut pada Supabase SQL Editor:
`supabase/migrations/202611090001_material_plans.sql`

Migration membuat tabel `material_plans`, foreign key ke master material, batas unik satu rencana per material, dan kebijakan RLS. Akses baca diberikan kepada pengguna terautentikasi; tambah, ubah, dan hapus hanya untuk ADMIN.

## Menjalankan project
1. Salin `.env.example` menjadi `.env.local`.
2. Isi `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY` sesuai project Supabase.
3. Jalankan `npm install`.
4. Jalankan `npm run dev` untuk pengembangan atau `npm run build` untuk build produksi.

Catatan: build TypeScript telah diperiksa. Build Vite pada lingkungan pemeriksaan ini tidak dapat diselesaikan karena paket native opsional Rollup untuk Linux tidak tersedia pada `node_modules` dari ZIP; jalankan `npm install` pada lingkungan deployment agar dependensi platform terpasang benar.
