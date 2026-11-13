-- BELIA-BAYA: hitung persentase stok dari total penambahan barang.
-- 100% = total barang yang pernah ditambahkan (Barang Masuk + koreksi tambah stok).
-- Sisa (%) = stok bersih / total penambahan * 100.
-- Jika tidak ada penambahan, persentase ditampilkan 0%.
-- Migrasi ini tidak menghapus transaksi, rincian transaksi, atau riwayat pergerakan stok.

-- Pertahankan view dan hak akses yang sudah ada; ganti nama kolom terakhir
-- sebelum mengganti definisinya agar tidak perlu menjatuhkan view.
alter view public.stock_balances rename column stock_reference to incoming_total;

-- Total penambahan dihitung dari IN dan OPENING.
-- Stok bersih tetap menghitung OUT dan REVERSAL sebagai pengurangan.
create or replace view public.stock_balances as
select
  i.id as item_id,
  i.code,
  i.name,
  i.category,
  i.unit,
  coalesce(sum(case
    when m.movement_type in ('IN', 'OPENING') then m.quantity
    when m.movement_type in ('OUT', 'REVERSAL') then -m.quantity
    else 0
  end), 0)::numeric(18,3) as stock,
  coalesce(sum(case
    when m.movement_type in ('IN', 'OPENING') then m.quantity
    else 0
  end), 0)::numeric(18,3) as incoming_total,
  coalesce(sum(case
    when m.movement_type in ('OUT', 'REVERSAL') then m.quantity
    else 0
  end), 0)::numeric(18,3) as outgoing_total
from public.items i
left join public.inventory_movements m on m.item_id = i.id
group by i.id, i.code, i.name, i.category, i.unit;

alter table public.items
  drop column if exists stock_reference;

comment on view public.stock_balances is
  'Saldo stok bersih, total penambahan, dan total pengeluaran. Persentase UI = stock / incoming_total * 100; jika belum ada penambahan tetapi ada pengeluaran, tampilkan -100%; tanpa pergerakan tampilkan 0%.';
