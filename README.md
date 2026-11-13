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


## Catatan Revisi 12 November 2026

Tambahkan dan jalankan migrasi baru `supabase/migrations/202611120001_logistics_revision.sql` melalui Supabase SQL Editor setelah migrasi sebelumnya. Migrasi ini menambahkan tabel `stock_alert_dismissals`, `material_orders`, `material_order_lines`, policy RLS, serta RPC penyimpanan/penghapusan OM dan perubahan/penghapusan transaksi. Migrasi lama dan tabel `material_plans` tidak dihapus.

### Perilaku sesi browser
Sesi autentikasi kini disimpan pada `sessionStorage` dengan `storageKey` unik per tab. Login/logout antar-tab berjalan terpisah; sesi bertahan saat tab di-refresh, tetapi hilang saat tab ditutup sehingga perlu login ulang.

### Dependency ekspor
Jalankan `npm install` untuk memasang dependency aplikasi termasuk `xlsx`, `jspdf`, dan `jspdf-autotable`. Build produksi dijalankan dengan `npm run build`.

### Catatan penerapan dan pengujian
- Pastikan bucket `incoming-evidence` tetap tersedia dan kebijakan Storage mengizinkan ADMIN menghapus foto.
- Uji penghapusan transaksi BM/BK dan validasi saldo serta persentase dasar setelah migrasi diterapkan.
- Uji penyimpanan OM, alokasi penerimaan Barang Masuk berdasarkan tanggal OM, dan salin teks proyek.
- Uji ekspor PDF/Excel untuk bulan terpilih.
- Sesi dua tab perlu diuji menggunakan satu tab ADMIN dan satu tab ATASAN.

## Catatan revisi tambahan — 12 November 2026
- Tombol **Abaikan** pada peringatan persediaan langsung menyimpan penghapusan permanen ke `stock_alert_dismissals` tanpa dialog konfirmasi. Perilaku **Noted** tetap seperti sebelumnya.
- Tombol hapus baris pada form Order Material menggunakan ikon silang (X) dan tata letak baris dirapikan agar kolom keterangan tidak bertabrakan dengan tombol.
- Persentase stok dibatasi pada rentang 0–100%: stok nol/negatif menjadi 0%; stok positif tanpa dasar persentase menjadi 100%; selain itu dihitung terhadap dasar persentase lalu dibatasi ke rentang tersebut.
- Ekspor Monitoring menggunakan rentang tanggal bulan terpilih saja. PDF dirapikan menjadi laporan landscape dengan tabel transaksi dan rekap lima periode; Excel berisi lembar **Transaksi Bulanan** dan **Rekap 5 Periode**.

## Revisi lanjutan 13 November 2026

- Rencana Barang kini menampilkan kategori MATERIAL/ALAT pada setiap hasil pencarian dan merapikan label serta ukuran input agar konsisten dengan form lain. Daftar tetap mengikuti aturan hanya barang aktif (`is_active = true`); barang ALAT yang tidak memiliki satuan akan berstatus tidak aktif sampai satuannya dilengkapi di menu Kode Material & Alat.
- Tambahkan dan jalankan migrasi `supabase/migrations/202611130001_fix_transaction_update_rpcs.sql` melalui Supabase SQL Editor untuk memasang ulang RPC edit Barang Masuk/Keluar dan memuat ulang schema cache PostgREST. Setelah SQL berhasil, tunggu beberapa detik lalu muat ulang aplikasi.

### Menjadikan stok Semen nol melalui Supabase

Jangan mengubah `stock_balances` karena itu VIEW, dan jangan mengubah `items.stock` karena saldo dihitung dari `inventory_movements`. Cara yang menjaga riwayat adalah menambahkan movement `REVERSAL` sebesar saldo bersih saat ini. Contoh berikut menargetkan kode barang `1005` (Semen); pastikan hasil SELECT benar sebelum menjalankan blok DO.

```sql
select i.id, i.code, i.name, sb.stock, i.stock_percentage_base
from public.items i
join public.stock_balances sb on sb.item_id = i.id
where i.code = '1005';

begin;
do $$
declare
  v_item_id uuid;
  v_stock numeric(18,3);
begin
  select i.id, sb.stock
    into v_item_id, v_stock
  from public.items i
  join public.stock_balances sb on sb.item_id = i.id
  where i.code = '1005' and lower(i.name) = 'semen'
  for update of i;

  if v_item_id is null then
    raise exception 'Barang Semen dengan kode 1005 tidak ditemukan.';
  end if;

  if v_stock > 0 then
    insert into public.inventory_movements
      (item_id, movement_type, quantity, transaction_date, notes)
    values
      (v_item_id, 'REVERSAL', v_stock, current_date,
       'PENYESUAIAN ADMIN: saldo Semen diatur menjadi 0');
  elsif v_stock < 0 then
    insert into public.inventory_movements
      (item_id, movement_type, quantity, transaction_date, notes)
    values
      (v_item_id, 'OPENING', abs(v_stock), current_date,
       'PENYESUAIAN ADMIN: saldo Semen diatur menjadi 0');
  end if;

  update public.items set stock_percentage_base = 0 where id = v_item_id;
  insert into public.audit_logs(action, table_name, record_id, details)
  values ('MANUAL_SET_STOCK_ZERO', 'items', v_item_id,
          jsonb_build_object('item_code','1005','stock_before',v_stock,'stock_after',0));
end $$;
commit;

select i.code, i.name, sb.stock, i.stock_percentage_base
from public.items i
join public.stock_balances sb on sb.item_id = i.id
where i.code = '1005';
```

Jalankan blok tersebut hanya jika kode `1005` memang Semen pada database Anda. Ini tidak menghapus transaksi lama; ia menambah satu pergerakan penyeimbang yang tercatat di riwayat.
