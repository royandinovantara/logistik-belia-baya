-- BELIA-BAYA: stok acuan untuk peringatan persediaan 20%.
-- Aman dijalankan berulang kali; tidak menghapus transaksi atau riwayat.
alter table public.items
  add column if not exists stock_reference numeric(18,3) not null default 0;

comment on column public.items.stock_reference is
  'Stok acuan awal yang dianggap 100 persen untuk perhitungan peringatan stok rendah.';


-- Tambahkan stok acuan ke view persediaan tanpa mengubah kolom lama.
create or replace view public.stock_balances as
select i.id item_id,i.code,i.name,i.category,i.unit,
coalesce(sum(case when m.movement_type in('IN','OPENING') then m.quantity when m.movement_type in('OUT','REVERSAL') then -m.quantity else 0 end),0)::numeric(18,3) stock,
i.stock_reference
from public.items i left join public.inventory_movements m on m.item_id=i.id
group by i.id,i.code,i.name,i.category,i.unit,i.stock_reference;
