-- Revisi Logistik Belia-Baya 12 November 2026. Idempotent; tidak mengubah tabel/migrasi lama.

create table if not exists public.stock_alert_dismissals (
  item_id uuid primary key references public.items(id) on delete cascade,
  dismissed_by uuid references auth.users(id),
  dismissed_at timestamptz not null default now()
);
alter table public.stock_alert_dismissals enable row level security;
drop policy if exists "stock alert dismissals read" on public.stock_alert_dismissals;
create policy "stock alert dismissals read" on public.stock_alert_dismissals for select to authenticated using (true);
drop policy if exists "stock alert dismissals insert" on public.stock_alert_dismissals;
create policy "stock alert dismissals insert" on public.stock_alert_dismissals for insert to authenticated with check (true);
grant select, insert on public.stock_alert_dismissals to authenticated;
revoke update, delete on public.stock_alert_dismissals from authenticated;

create table if not exists public.material_orders (
  id uuid primary key default gen_random_uuid(),
  om_no text not null,
  project text not null check (project in ('BAYA','BELIA')),
  order_date date not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create unique index if not exists material_orders_project_om_uidx on public.material_orders(project, lower(btrim(om_no)));
create table if not exists public.material_order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.material_orders(id) on delete cascade,
  item_id uuid not null references public.items(id),
  planned_quantity numeric(18,3) not null check(planned_quantity > 0),
  unit text not null,
  note text
);
alter table public.material_orders enable row level security;
alter table public.material_order_lines enable row level security;
drop policy if exists "material orders read" on public.material_orders;
create policy "material orders read" on public.material_orders for select to authenticated using(true);
drop policy if exists "material orders admin manage" on public.material_orders;
create policy "material orders admin manage" on public.material_orders for all to authenticated using(public.is_admin()) with check(public.is_admin());
drop policy if exists "material order lines read" on public.material_order_lines;
create policy "material order lines read" on public.material_order_lines for select to authenticated using(true);
drop policy if exists "material order lines admin manage" on public.material_order_lines;
create policy "material order lines admin manage" on public.material_order_lines for all to authenticated using(public.is_admin()) with check(public.is_admin());
grant select, insert, update, delete on public.material_orders, public.material_order_lines to authenticated;

create or replace function public.save_material_order(p_header jsonb, p_lines jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_line jsonb; v_item public.items%rowtype;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Hanya ADMIN yang dapat menyimpan OM.'; end if;
 if coalesce(trim(p_header->>'om_no'),'')='' then raise exception 'Nomor OM wajib diisi.'; end if;
 if p_header->>'project' not in ('BAYA','BELIA') then raise exception 'Proyek tidak valid.'; end if;
 if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'Minimal satu barang wajib diisi.'; end if;
 insert into public.material_orders(om_no,project,order_date,created_by) values(trim(p_header->>'om_no'),p_header->>'project',(p_header->>'order_date')::date,auth.uid()) returning id into v_id;
 for v_line in select value from jsonb_array_elements(p_lines) loop
  select * into v_item from public.items where id=(v_line->>'item_id')::uuid and is_active for share;
  if not found then raise exception 'Barang tidak ditemukan atau tidak aktif.'; end if;
  if (v_line->>'planned_quantity')::numeric<=0 then raise exception 'Jumlah rencana harus lebih dari nol.'; end if;
  insert into public.material_order_lines(order_id,item_id,planned_quantity,unit,note) values(v_id,v_item.id,(v_line->>'planned_quantity')::numeric,v_item.unit, nullif(v_line->>'note',''));
 end loop;
 insert into public.audit_logs(user_id,action,table_name,record_id,details) values(auth.uid(),'CREATE_MATERIAL_ORDER','material_orders',v_id,jsonb_build_object('om_no',p_header->>'om_no','project',p_header->>'project'));
 return v_id;
end $$;
revoke all on function public.save_material_order(jsonb,jsonb) from public;
grant execute on function public.save_material_order(jsonb,jsonb) to authenticated;

create or replace function public.delete_material_order(p_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_no text;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Hanya ADMIN yang dapat menghapus OM.'; end if;
 select om_no into v_no from public.material_orders where id=p_id for update;
 if not found then raise exception 'OM tidak ditemukan.'; end if;
 delete from public.material_orders where id=p_id;
 insert into public.audit_logs(user_id,action,table_name,record_id,details) values(auth.uid(),'DELETE_MATERIAL_ORDER','material_orders',p_id,jsonb_build_object('om_no',v_no));
end $$;
revoke all on function public.delete_material_order(uuid) from public;
grant execute on function public.delete_material_order(uuid) to authenticated;

create or replace function public.delete_incoming_transaction(p_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_no text; v_items uuid[]; v_item uuid;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Hanya ADMIN yang dapat menghapus transaksi.'; end if;
 select transaction_no into v_no from public.incoming_transactions where id=p_id for update;
 if not found then raise exception 'Transaksi tidak ditemukan.'; end if;
 select array_agg(distinct item_id) into v_items from public.incoming_items where transaction_id=p_id;
 delete from public.inventory_movements where incoming_item_id in(select id from public.incoming_items where transaction_id=p_id);
 delete from public.incoming_items where transaction_id=p_id;
 delete from public.incoming_transactions where id=p_id;
 foreach v_item in array coalesce(v_items, array[]::uuid[]) loop
  update public.items i set stock_percentage_base=coalesce((
   select sum(case when m.movement_type in ('IN','OPENING') then m.quantity when m.movement_type in ('OUT','REVERSAL') then -m.quantity else 0 end)
   from public.inventory_movements m
   where m.item_id=v_item and m.transaction_date <= (
    select max(m2.transaction_date) from public.inventory_movements m2 where m2.item_id=v_item and m2.movement_type='IN'
   )
  ),0) where i.id=v_item;
 end loop;
 insert into public.audit_logs(user_id,action,table_name,record_id,details) values(auth.uid(),'DELETE_INCOMING','incoming_transactions',p_id,jsonb_build_object('transaction_no',v_no));
end $$;
revoke all on function public.delete_incoming_transaction(uuid) from public;
grant execute on function public.delete_incoming_transaction(uuid) to authenticated;

create or replace function public.delete_outgoing_transaction(p_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_no text;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Hanya ADMIN yang dapat menghapus transaksi.'; end if;
 select transaction_no into v_no from public.outgoing_transactions where id=p_id for update;
 if not found then raise exception 'Transaksi tidak ditemukan.'; end if;
 delete from public.inventory_movements where outgoing_item_id in(select id from public.outgoing_items where transaction_id=p_id);
 delete from public.outgoing_items where transaction_id=p_id;
 delete from public.outgoing_transactions where id=p_id;
 insert into public.audit_logs(user_id,action,table_name,record_id,details) values(auth.uid(),'DELETE_OUTGOING','outgoing_transactions',p_id,jsonb_build_object('transaction_no',v_no));
end $$;
revoke all on function public.delete_outgoing_transaction(uuid) from public;
grant execute on function public.delete_outgoing_transaction(uuid) to authenticated;
