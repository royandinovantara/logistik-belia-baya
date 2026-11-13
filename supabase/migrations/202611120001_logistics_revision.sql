-- Revisi Logistik BELIA-BAYA 2026-11-12
-- Idempotent: tabel, indeks, policy, dan fungsi dapat diterapkan ulang.

create table if not exists public.stock_alert_dismissals (
  item_id uuid primary key references public.items(id) on delete cascade,
  dismissed_by uuid references auth.users(id),
  dismissed_at timestamptz not null default now()
);
alter table public.stock_alert_dismissals enable row level security;
drop policy if exists "stock alert dismissals read authenticated" on public.stock_alert_dismissals;
create policy "stock alert dismissals read authenticated" on public.stock_alert_dismissals
  for select to authenticated using (true);
drop policy if exists "stock alert dismissals insert authenticated" on public.stock_alert_dismissals;
create policy "stock alert dismissals insert authenticated" on public.stock_alert_dismissals
  for insert to authenticated with check (true);
grant select, insert on public.stock_alert_dismissals to authenticated;

create table if not exists public.material_orders (
 id uuid primary key default gen_random_uuid(),
 om_no text not null,
 project text not null check (project in ('BAYA','BELIA')),
 order_date date not null,
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now()
);
create unique index if not exists material_orders_project_om_uidx
 on public.material_orders(project, lower(btrim(om_no)));
create table if not exists public.material_order_lines (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.material_orders(id) on delete cascade,
 item_id uuid not null references public.items(id),
 planned_quantity numeric(18,3) not null check(planned_quantity > 0),
 unit text not null,
 note text
);
create index if not exists material_order_lines_order_idx on public.material_order_lines(order_id);
alter table public.material_orders enable row level security;
alter table public.material_order_lines enable row level security;
drop policy if exists "material orders read authenticated" on public.material_orders;
create policy "material orders read authenticated" on public.material_orders for select to authenticated using(true);
drop policy if exists "material orders admin manage" on public.material_orders;
create policy "material orders admin manage" on public.material_orders for all to authenticated using(public.is_admin()) with check(public.is_admin());
drop policy if exists "material order lines read authenticated" on public.material_order_lines;
create policy "material order lines read authenticated" on public.material_order_lines for select to authenticated using(true);
drop policy if exists "material order lines admin manage" on public.material_order_lines;
create policy "material order lines admin manage" on public.material_order_lines for all to authenticated using(public.is_admin()) with check(public.is_admin());
grant select, insert, update, delete on public.material_orders, public.material_order_lines to authenticated;

create or replace function public.save_material_order(p_header jsonb, p_lines jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_line jsonb; v_item public.items%rowtype; v_qty numeric;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Hanya ADMIN yang dapat menyimpan OM.'; end if;
 if nullif(btrim(p_header->>'om_no'),'') is null then raise exception 'No. OM wajib diisi.'; end if;
 if p_header->>'project' not in ('BAYA','BELIA') then raise exception 'Proyek tidak valid.'; end if;
 if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'OM harus memiliki minimal satu barang.'; end if;
 insert into public.material_orders(om_no,project,order_date,created_by)
 values(btrim(p_header->>'om_no'),p_header->>'project',(p_header->>'order_date')::date,auth.uid()) returning id into v_id;
 for v_line in select value from jsonb_array_elements(p_lines) loop
  select * into v_item from public.items where id=(v_line->>'item_id')::uuid and is_active and category in ('MATERIAL','ALAT');
  if not found then raise exception 'Barang tidak aktif atau tidak ditemukan.'; end if;
  v_qty := (v_line->>'planned_quantity')::numeric;
  if v_qty is null or v_qty<=0 then raise exception 'Jumlah rencana harus lebih dari nol.'; end if;
  insert into public.material_order_lines(order_id,item_id,planned_quantity,unit,note)
  values(v_id,v_item.id,v_qty,v_item.unit, nullif(btrim(v_line->>'note'),''));
 end loop;
 insert into public.audit_logs(user_id,action,table_name,record_id,details)
 values(auth.uid(),'CREATE_MATERIAL_ORDER','material_orders',v_id,jsonb_build_object('om_no',p_header->>'om_no','project',p_header->>'project','line_count',jsonb_array_length(p_lines)));
 return v_id;
end $$;

create or replace function public.delete_material_order(p_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_no text;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Hanya ADMIN yang dapat menghapus OM.'; end if;
 select om_no into v_no from public.material_orders where id=p_id for update;
 if not found then raise exception 'OM tidak ditemukan.'; end if;
 delete from public.material_orders where id=p_id;
 insert into public.audit_logs(user_id,action,table_name,record_id,details)
 values(auth.uid(),'DELETE_MATERIAL_ORDER','material_orders',p_id,jsonb_build_object('om_no',v_no));
end $$;

create or replace function public.recalculate_stock_percentage_base(p_item_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_base numeric(18,3);
begin
 select coalesce(sum(case when movement_type in ('IN','OPENING') then quantity
                          when movement_type in ('OUT','REVERSAL') then -quantity else 0 end),0)
 into v_base
 from public.inventory_movements
 where item_id=p_item_id
   and (transaction_date, id) <= (
     select transaction_date,id from public.inventory_movements
     where item_id=p_item_id and movement_type='IN'
     order by transaction_date desc,id desc limit 1
   );
 update public.items set stock_percentage_base=coalesce(v_base,0) where id=p_item_id;
end $$;

create or replace function public.delete_incoming_transaction(p_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_items uuid[]; v_no text;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Hanya ADMIN yang dapat menghapus transaksi.'; end if;
 select transaction_no into v_no from public.incoming_transactions where id=p_id for update;
 if not found then raise exception 'Transaksi barang masuk tidak ditemukan.'; end if;
 select array_agg(distinct item_id) into v_items from public.incoming_items where transaction_id=p_id;
 delete from public.inventory_movements where incoming_item_id in (select id from public.incoming_items where transaction_id=p_id);
 delete from public.incoming_items where transaction_id=p_id;
 delete from public.incoming_transactions where id=p_id;
 if v_items is not null then
  perform public.recalculate_stock_percentage_base(x) from unnest(v_items) x;
 end if;
 insert into public.audit_logs(user_id,action,table_name,record_id,details)
 values(auth.uid(),'DELETE_INCOMING','incoming_transactions',p_id,jsonb_build_object('transaction_no',v_no));
end $$;

create or replace function public.delete_outgoing_transaction(p_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_no text;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Hanya ADMIN yang dapat menghapus transaksi.'; end if;
 select transaction_no into v_no from public.outgoing_transactions where id=p_id for update;
 if not found then raise exception 'Transaksi barang keluar tidak ditemukan.'; end if;
 delete from public.inventory_movements where outgoing_item_id in (select id from public.outgoing_items where transaction_id=p_id);
 delete from public.outgoing_items where transaction_id=p_id;
 delete from public.outgoing_transactions where id=p_id;
 insert into public.audit_logs(user_id,action,table_name,record_id,details)
 values(auth.uid(),'DELETE_OUTGOING','outgoing_transactions',p_id,jsonb_build_object('transaction_no',v_no));
end $$;

create or replace function public.update_incoming_transaction(p_id uuid,p_header jsonb,p_lines jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare v_no text; v_old uuid[]; v_line jsonb; v_item public.items%rowtype; v_qty numeric; v_line_id uuid;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Hanya ADMIN yang dapat mengubah transaksi.'; end if;
 select transaction_no into v_no from public.incoming_transactions where id=p_id for update;
 if not found then raise exception 'Transaksi tidak ditemukan.'; end if;
 if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'Minimal satu barang wajib diisi.'; end if;
 select array_agg(distinct item_id) into v_old from public.incoming_items where transaction_id=p_id;
 delete from public.inventory_movements where incoming_item_id in(select id from public.incoming_items where transaction_id=p_id);
 delete from public.incoming_items where transaction_id=p_id;
 update public.incoming_transactions set transaction_date=(p_header->>'transaction_date')::date,
  supplier=nullif(p_header->>'supplier',''),vehicle_no=nullif(p_header->>'vehicle_no',''),
  driver_name=nullif(p_header->>'driver_name',''),notes=nullif(p_header->>'notes','') where id=p_id;
 for v_line in select value from jsonb_array_elements(p_lines) loop
  select * into v_item from public.items where id=(v_line->>'item_id')::uuid and is_active for update;
  if not found then raise exception 'Barang tidak aktif atau tidak ditemukan.'; end if;
  v_qty:=(v_line->>'quantity')::numeric; if v_qty is null or v_qty<=0 then raise exception 'Jumlah harus lebih dari nol.'; end if;
  insert into public.incoming_items(transaction_id,item_id,quantity,unit,cost_code)
  values(p_id,v_item.id,v_qty,coalesce(nullif(v_line->>'unit',''),v_item.unit),nullif(v_line->>'cost_code','')) returning id into v_line_id;
  insert into public.inventory_movements(item_id,movement_type,quantity,transaction_date,incoming_item_id,notes,created_by)
  values(v_item.id,'IN',v_qty,(p_header->>'transaction_date')::date,v_line_id,'Barang masuk '||v_no,auth.uid());
 end loop;
 if v_old is not null then perform public.recalculate_stock_percentage_base(x) from unnest(v_old) x; end if;
 perform public.recalculate_stock_percentage_base((v_line->>'item_id')::uuid) from jsonb_array_elements(p_lines) v_line;
 insert into public.audit_logs(user_id,action,table_name,record_id,details)
 values(auth.uid(),'UPDATE_INCOMING','incoming_transactions',p_id,jsonb_build_object('transaction_no',v_no));
end $$;

create or replace function public.update_outgoing_transaction(p_id uuid,p_header jsonb,p_lines jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare v_no text; v_line jsonb; v_item public.items%rowtype; v_qty numeric; v_line_id uuid; v_stock numeric;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Hanya ADMIN yang dapat mengubah transaksi.'; end if;
 select transaction_no into v_no from public.outgoing_transactions where id=p_id for update;
 if not found then raise exception 'Transaksi tidak ditemukan.'; end if;
 if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'Minimal satu barang wajib diisi.'; end if;
 delete from public.inventory_movements where outgoing_item_id in(select id from public.outgoing_items where transaction_id=p_id);
 delete from public.outgoing_items where transaction_id=p_id;
 update public.outgoing_transactions set transaction_date=(p_header->>'transaction_date')::date,
  destination=nullif(p_header->>'destination',''),receiver_name=nullif(p_header->>'receiver_name',''),
  driver_name=nullif(p_header->>'driver_name',''),notes=nullif(p_header->>'notes','') where id=p_id;
 for v_line in select value from jsonb_array_elements(p_lines) loop
  select * into v_item from public.items where id=(v_line->>'item_id')::uuid and is_active for update;
  if not found then raise exception 'Barang tidak aktif atau tidak ditemukan.'; end if;
  v_qty:=(v_line->>'quantity')::numeric; if v_qty is null or v_qty<=0 then raise exception 'Jumlah harus lebih dari nol.'; end if;
  select coalesce(stock,0) into v_stock from public.stock_balances where item_id=v_item.id;
  if coalesce(v_stock,0)<v_qty then raise exception 'Stok % tidak mencukupi. Tersedia %, diminta %.',v_item.name,coalesce(v_stock,0),v_qty; end if;
  insert into public.outgoing_items(transaction_id,item_id,quantity,unit,cost_code)
  values(p_id,v_item.id,v_qty,coalesce(nullif(v_line->>'unit',''),v_item.unit),nullif(v_line->>'cost_code','')) returning id into v_line_id;
  insert into public.inventory_movements(item_id,movement_type,quantity,transaction_date,outgoing_item_id,notes,created_by)
  values(v_item.id,'OUT',v_qty,(p_header->>'transaction_date')::date,v_line_id,'Barang keluar '||v_no,auth.uid());
 end loop;
 insert into public.audit_logs(user_id,action,table_name,record_id,details)
 values(auth.uid(),'UPDATE_OUTGOING','outgoing_transactions',p_id,jsonb_build_object('transaction_no',v_no));
end $$;

revoke all on function public.save_material_order(jsonb,jsonb) from public;
revoke all on function public.delete_material_order(uuid) from public;
revoke all on function public.delete_incoming_transaction(uuid) from public;
revoke all on function public.delete_outgoing_transaction(uuid) from public;
revoke all on function public.update_incoming_transaction(uuid,jsonb,jsonb) from public;
revoke all on function public.update_outgoing_transaction(uuid,jsonb,jsonb) from public;
grant execute on function public.save_material_order(jsonb,jsonb), public.delete_material_order(uuid),
 public.delete_incoming_transaction(uuid), public.delete_outgoing_transaction(uuid),
 public.update_incoming_transaction(uuid,jsonb,jsonb), public.update_outgoing_transaction(uuid,jsonb,jsonb)
 to authenticated;
