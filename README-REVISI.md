# Logistik BELIA-BAYA — Revisi November 2026

## Perubahan pada project
- View `stock_balances` disiapkan menggunakan `security_invoker = true` agar hak akses dan RLS pengguna yang menjalankan query ikut diterapkan.
- Status master material/alat otomatis mengikuti satuan: satuan terisi = Aktif; satuan kosong = Tidak Aktif. Barang tidak dihapus.
- Barang Tidak Aktif tidak ditampilkan pada pilihan transaksi Barang Masuk/Keluar. Validasi transaksi memeriksa tanggal, setiap baris barang, dan jumlah > 0 sebelum RPC dipanggil.
- Peringatan stok menggunakan ambang <=30%. Warna persentase: merah <=30% (termasuk negatif), kuning 31–69%, hijau 70–100%.
- Item Noted dapat dibuka untuk melihat kode, nama, stok tersedia, total masuk, total keluar, persentase tersisa, dan riwayat pergerakan stok. Peringatan dapat ditampilkan kembali.
- Baris stok di Dashboard dan Stok Gudang juga dapat dibuka untuk melihat detail pergerakan.
- Dokumentasi tetap dikelompokkan per transaksi. Validasi file foto dan penanganan kegagalan upload/pencatatan diperketat.
- Indikator proses menampilkan status pemuatan/penyimpanan dan progres jumlah foto yang berhasil diproses.

## Migrasi Supabase untuk database yang sudah berjalan
Project ini sudah memiliki migrasi terdahulu sampai revisi persentase stok. Untuk menerapkan seluruh revisi terbaru, jalankan empat file berikut satu per satu melalui Supabase SQL Editor:

1. `supabase/migrations/202611080001_security_invoker_stock_balances.sql`
2. `supabase/migrations/202611080002_item_status_from_unit.sql`
3. `supabase/migrations/202611080003_prevent_duplicate_item_code_and_name.sql`
4. `supabase/migrations/202611080004_reset_stock_percentage_on_incoming.sql`

Migrasi pertama mengatur view dan grant SELECT untuk role `authenticated`; tidak mengubah data transaksi. Migrasi kedua mengizinkan `items.unit` bernilai NULL/kosong dan membuat trigger status otomatis; tidak menghapus master barang maupun riwayat.

**Penting tentang RLS:** `security_invoker` membuat view mengikuti hak akses dan RLS pada tabel sumber. Schema project ini mendefinisikan kebijakan SELECT untuk `items` dan `inventory_movements` bagi role `authenticated`. Sebelum menjalankan migrasi di database produksi, bandingkan dengan hasil query `pg_policies` dari project Supabase Anda. Jika kebijakan aktual berbeda, jangan menambahkan kebijakan luas secara membabi buta; sesuaikan berdasarkan kebutuhan akses aplikasi.

Pemeriksaan view dan kebijakan:

```sql
SELECT current_setting('server_version') AS postgres_version,
       c.relname AS view_name,
       pg_get_userbyid(c.relowner) AS owner,
       c.reloptions AS options,
       pg_get_viewdef(c.oid, true) AS definition
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'stock_balances' AND c.relkind = 'v';

SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

## Konfigurasi lokal dan Vercel
1. Salin `.env.example` menjadi `.env.local` untuk pengembangan lokal.
2. Isi `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY` (atau publishable key yang kompatibel) milik project Anda.
3. Di Vercel, masukkan kedua variabel tersebut pada Project Settings → Environment Variables.
4. Pastikan URL domain Vercel telah dimasukkan ke konfigurasi URL/redirect Supabase Auth.
5. Jangan pernah memasukkan `service_role` key atau secret key ke variabel `VITE_*` atau kode frontend.
6. Jalankan `npm install`, `npm run build`, dan `npm run dev` dari folder yang berisi `package.json`.

File `.env.local` yang digunakan pada komputer pengembang tidak disertakan dalam ZIP distribusi. Buat file tersebut sendiri dari `.env.example`.

## Catatan operasional
- Status Noted/Abaikan masih disimpan pada browser yang digunakan melalui `localStorage`, belum tersinkron antar perangkat.
- Upload foto dilakukan setelah transaksi barang masuk berhasil dicatat. Jika upload foto gagal, transaksi tetap tersimpan dan aplikasi menampilkan peringatan bahwa dokumentasi belum lengkap.
- Foto berada di bucket privat `incoming-evidence` dan dibaca melalui signed URL.
- Pengujian akhir transaksi, izin RLS, dan storage tetap perlu dilakukan pada project Supabase/Vercel Anda karena saya tidak memiliki akses untuk menjalankan perubahan pada project cloud tersebut.


## Revisi tambahan 8 November 2026

- Form tambah/edit Master Material & Alat memeriksa kode dan nama barang duplikat (tidak membedakan huruf besar/kecil dan mengabaikan spasi luar). Database dilindungi unique index melalui migrasi `202611080003_prevent_duplicate_item_code_and_name.sql`.
- Dashboard menampilkan satu tombol **Detail stok** untuk membuka tabel gabungan seluruh barang yang sudah di-Noted, berisi nomor, kode, nama material/alat, satuan, sisa stok, dan persentase.
- Pilihan barang pada form Barang Masuk, Barang Keluar, dan Koreksi Stok dapat dicari berdasarkan kode atau nama.

**Catatan migrasi:** daftar empat file di atas adalah urutan lengkap untuk database yang sudah sampai migrasi persentase stok sebelumnya. Migrasi duplikasi akan berhenti dengan pesan daftar nilai yang bermasalah bila data lama sudah memiliki kode/nama duplikat (termasuk beda kapital/spasi). Bersihkan data tersebut secara manual dan pastikan referensi transaksi tetap menunjuk ke barang yang benar sebelum mencoba lagi. Jangan menghapus atau menggabungkan master barang tanpa pemeriksaan relasi transaksi. Migrasi duplikasi akan berhenti dengan pesan daftar nilai yang bermasalah bila data lama sudah memiliki kode/nama duplikat (termasuk beda kapital/spasi). Bersihkan data tersebut secara manual dan pastikan referensi transaksi tetap menunjuk ke barang yang benar sebelum mencoba lagi. Jangan menghapus atau menggabungkan master barang tanpa pemeriksaan relasi transaksi.

**Catatan Noted:** status Noted tetap tersimpan di `localStorage` browser seperti perilaku project sebelumnya. Tabel detail menggabungkan seluruh barang Noted pada browser/perangkat yang sedang digunakan; status ini belum menjadi fitur sinkronisasi antarperangkat atau tautan publik untuk grup.


## Revisi tambahan 8 November 2026 — Dasar persentase setiap penerimaan

Migrasi `202611080004_reset_stock_percentage_on_incoming.sql` menambahkan `items.stock_percentage_base`. Ketika transaksi Barang Masuk berhasil diposting, dasar 100% untuk setiap barang disetel ke saldo setelah penerimaan (sisa sebelumnya + jumlah baru datang). Pengeluaran berikutnya menurunkan persentase terhadap dasar tersebut. Untuk data lama, migrasi mempertahankan perilaku persentase kumulatif sebelumnya sampai penerimaan baru dicatat.


## Revisi lanjutan
- Tombol X pada Detail Stok untuk Grup kini memakai status dismissed: item hilang dari daftar Noted dan tidak dipindahkan ke panel Peringatan yang diabaikan.
- Detail Pergerakan Stok dibuka pada tampilan ringkas **Total sekarang**. Pilih **Total keseluruhan** untuk melihat akumulasi barang masuk/keluar dan riwayat pergerakan lengkap.
- Persentase Stok Gudang tetap menggunakan dasar 100% dari sisa stok sebelum penerimaan ditambah jumlah penerimaan terbaru; pengeluaran mengurangi persentase dari dasar tersebut.
