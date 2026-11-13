-- Rencana Barang berdiri sendiri; tidak mengubah stok atau transaksi.
create table if not exists public.material_plans (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  planned_quantity numeric(18,3) not null check (planned_quantity > 0),
  unit text not null,
  created_at timestamptz not null default now(),
  constraint material_plans_one_active_per_item unique (item_id)
);

alter table public.material_plans enable row level security;
create policy "material plans read authenticated"
  on public.material_plans for select to authenticated using (true);
create policy "material plans admin insert"
  on public.material_plans for insert to authenticated
  with check (public.is_admin());
create policy "material plans admin update"
  on public.material_plans for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "material plans admin delete"
  on public.material_plans for delete to authenticated
  using (public.is_admin());

grant select, insert, update, delete on public.material_plans to authenticated;
