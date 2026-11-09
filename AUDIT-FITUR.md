# Audit fitur Logistik BELIA-BAYA

Pemeriksaan dilakukan terhadap source code yang diterima pada 8 November 2026. Audit source tidak sama dengan pengujian langsung pada project Supabase/Vercel produksi.

## Fitur yang tersedia / diperbaiki pada source ini

- Dashboard ringkasan persediaan dan peringatan stok rendah (ambang <=30%).
- Peringatan Dashboard memiliki tindakan **Abaikan** dan **Noted**.
- Detail Stok untuk Grup menampilkan seluruh material/alat yang di-Noted; tombol **X** menghapus item dari daftar grup dan menyembunyikan peringatannya (status dismissed), tanpa memasukkannya ke panel Peringatan yang diabaikan. Status dapat dibersihkan otomatis saat stok pulih di atas 30%.
- Jika persentase stok pulih di atas 30% setelah pencatatan stok masuk, status Noted/Abaikan lama dibersihkan otomatis. Jika stok turun lagi ke <=30%, peringatan dapat muncul kembali. Peringatan yang diabaikan juga dapat dipulihkan melalui tombol **Tampilkan lagi**.
- Saat Barang Masuk berhasil dicatat, dasar 100% diperbarui menjadi sisa stok sebelum penerimaan + jumlah barang yang baru datang. Setelah itu Barang Keluar mengurangi persentase sampai penerimaan berikutnya. Contoh: sisa sebelumnya 20 + barang datang 80 = dasar 100; stok sesaat setelah penerimaan menjadi 100 (100%). Jika keluar 60, sisa 40 (40%).
- Master Material & Alat, pencarian, validasi duplikasi kode/nama, serta status aktif berdasarkan satuan.
- Transaksi masuk/keluar multi-item melalui RPC; pemilihan barang dapat dicari berdasarkan kode/nama.
- Form Barang Masuk sekarang mengirim supplier, driver, dan nomor kendaraan; Barang Keluar mengirim tujuan dan nama penerima ke database.
- Stok Gudang, koreksi stok, detail pergerakan dengan pilihan **Total sekarang** (ringkasan stok saat ini) dan **Total keseluruhan** (akumulasi masuk/keluar beserta seluruh riwayat), serta riwayat transaksi.
- Monitoring bulanan dalam lima periode.
- Arsip dokumentasi foto per transaksi, validasi JPG/PNG/WEBP dan batas 10 MB per foto, signed URL, unduh, tambah, dan hapus foto.
- Indikator loading, refresh, dan pesan kegagalan/berhasil.
- RLS, RPC security-definer dengan validasi peran, bucket foto privat, serta view stok security-invoker disediakan di SQL.

## Batasan yang masih perlu diketahui

1. Status Noted/Abaikan masih memakai `localStorage`. Status hanya tersimpan pada browser/perangkat yang sama dan belum tersinkron antar akun/perangkat. X menghapus dari daftar grup pada browser tersebut.
2. Pemeriksaan data aktual, kebijakan RLS, izin Storage, dan RPC pada Supabase produksi belum dapat dilakukan tanpa akses project tersebut.
3. Deploy Vercel belum dapat diverifikasi dari source ZIP saja.

## Pemeriksaan teknis

- Pemeriksaan TypeScript (`tsc -b`) berhasil pada source setelah perubahan.
- Build Vite belum dapat dinyatakan berhasil: folder `node_modules` dari ZIP asal tidak lengkap untuk platform Linux (binary opsional Rollup `@rollup/rollup-linux-x64-gnu` tidak tersedia). ZIP distribusi dibersihkan dari `node_modules` agar instalasi dependency dilakukan ulang secara normal dengan `npm install` pada komputer pengguna/CI.
- Pengujian transaksi end-to-end membutuhkan Supabase aktif beserta akun ADMIN/ATASAN dan data uji.

## Keamanan paket

ZIP distribusi tidak menyertakan `.env.local`, `node_modules`, atau `dist` lama. Buat `.env.local` sendiri dari `.env.example` dan isi URL serta anon/publishable key project Supabase. Jangan pernah memakai `service_role`/secret key di frontend.
