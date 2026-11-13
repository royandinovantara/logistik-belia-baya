-- PATCH: cegah pencatatan movement ganda jika trigger lama sudah membuat movement.
-- Jalankan seluruh file ini di Supabase SQL Editor.

-- Atomic posting functions for Logistik Belia-Baya.
-- Run this migration in Supabase SQL Editor after supabase/schema.sql.

create or replace function public.post_incoming_transaction(p_header jsonb, p_lines jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transaction_id uuid;
  v_line jsonb;
  v_item public.items%rowtype;
  v_quantity numeric(18,3);
  v_unit text;
  v_item_id uuid;
  v_incoming_item_id uuid;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Akses ditolak. Hanya ADMIN yang dapat mencatat barang masuk.';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception 'Daftar barang harus berupa array.';
  end if;
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'Transaksi harus memiliki minimal satu barang.';
  end if;

  insert into public.incoming_transactions(
    transaction_no, transaction_date, supplier, vehicle_no, driver_name,
    notes, created_by, status
  ) values (
    p_header->>'transaction_no', (p_header->>'transaction_date')::date,
    nullif(p_header->>'supplier',''), nullif(p_header->>'vehicle_no',''),
    nullif(p_header->>'driver_name',''), nullif(p_header->>'notes',''),
    auth.uid(), 'POSTED'
  ) returning id into v_transaction_id;

  for v_line in select value from jsonb_array_elements(p_lines) order by value->>'item_id' loop
    v_item_id := (v_line->>'item_id')::uuid;
    v_quantity := (v_line->>'quantity')::numeric;
    select * into v_item from public.items where id = v_item_id and is_active = true for update;
    if not found then raise exception 'Barang tidak ditemukan atau sudah nonaktif.'; end if;
    if v_quantity is null or v_quantity <= 0 then raise exception 'Jumlah barang harus lebih dari nol.'; end if;
    v_unit := coalesce(nullif(v_line->>'unit',''), v_item.unit);

    insert into public.incoming_items(transaction_id, item_id, quantity, unit, cost_code)
    values (v_transaction_id, v_item_id, v_quantity, v_unit, nullif(v_line->>'cost_code',''))
    returning id into v_incoming_item_id;
    insert into public.inventory_movements(item_id, movement_type, quantity, transaction_date, incoming_item_id, notes, created_by)
    values (v_item_id, 'IN', v_quantity, (p_header->>'transaction_date')::date,
      v_incoming_item_id,
      'Barang masuk ' || (p_header->>'transaction_no'), auth.uid())
    on conflict (incoming_item_id) do nothing;
  end loop;

  insert into public.audit_logs(user_id, action, table_name, record_id, details)
  values (auth.uid(), 'POST_INCOMING', 'incoming_transactions', v_transaction_id,
    jsonb_build_object('transaction_no', p_header->>'transaction_no', 'line_count', jsonb_array_length(p_lines)));
  return v_transaction_id;
end;
$$;

create or replace function public.post_outgoing_transaction(p_header jsonb, p_lines jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transaction_id uuid;
  v_line jsonb;
  v_item public.items%rowtype;
  v_quantity numeric(18,3);
  v_unit text;
  v_item_id uuid;
  v_stock numeric(18,3);
  v_outgoing_item_id uuid;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Akses ditolak. Hanya ADMIN yang dapat mencatat barang keluar.';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception 'Daftar barang harus berupa array.';
  end if;
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'Transaksi harus memiliki minimal satu barang.';
  end if;

  insert into public.outgoing_transactions(
    transaction_no, transaction_date, destination, receiver_name, driver_name,
    notes, created_by, status
  ) values (
    p_header->>'transaction_no', (p_header->>'transaction_date')::date,
    nullif(p_header->>'destination',''), nullif(p_header->>'receiver_name',''),
    nullif(p_header->>'driver_name',''), nullif(p_header->>'notes',''),
    auth.uid(), 'POSTED'
  ) returning id into v_transaction_id;

  for v_line in select value from jsonb_array_elements(p_lines) order by value->>'item_id' loop
    v_item_id := (v_line->>'item_id')::uuid;
    v_quantity := (v_line->>'quantity')::numeric;
    select * into v_item from public.items where id = v_item_id and is_active = true for update;
    if not found then raise exception 'Barang tidak ditemukan atau sudah nonaktif.'; end if;
    if v_quantity is null or v_quantity <= 0 then raise exception 'Jumlah barang harus lebih dari nol.'; end if;
    select coalesce(stock, 0) into v_stock from public.stock_balances where item_id = v_item_id;
    if coalesce(v_stock, 0) < v_quantity then
      raise exception 'Stok % tidak mencukupi. Tersedia: %, diminta: % %.', v_item.name, coalesce(v_stock,0), v_quantity, v_item.unit;
    end if;
    v_unit := coalesce(nullif(v_line->>'unit',''), v_item.unit);
    insert into public.outgoing_items(transaction_id, item_id, quantity, unit, cost_code)
    values (v_transaction_id, v_item_id, v_quantity, v_unit, nullif(v_line->>'cost_code',''))
    returning id into v_outgoing_item_id;
    insert into public.inventory_movements(item_id, movement_type, quantity, transaction_date, outgoing_item_id, notes, created_by)
    values (v_item_id, 'OUT', v_quantity, (p_header->>'transaction_date')::date,
      v_outgoing_item_id, 'Barang keluar ' || (p_header->>'transaction_no'), auth.uid())
    on conflict (outgoing_item_id) do nothing;
  end loop;

  insert into public.audit_logs(user_id, action, table_name, record_id, details)
  values (auth.uid(), 'POST_OUTGOING', 'outgoing_transactions', v_transaction_id,
    jsonb_build_object('transaction_no', p_header->>'transaction_no', 'line_count', jsonb_array_length(p_lines)));
  return v_transaction_id;
end;
$$;

create or replace function public.adjust_stock(
  p_item_id uuid, p_direction text, p_quantity numeric,
  p_date date, p_notes text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.items%rowtype;
  v_stock numeric(18,3);
  v_movement_id uuid;
  v_movement public.movement_type;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Akses ditolak. Hanya ADMIN yang dapat melakukan koreksi stok.';
  end if;
  if p_direction not in ('IN','OUT') then raise exception 'Jenis koreksi tidak valid.'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Jumlah koreksi harus lebih dari nol.'; end if;
  if nullif(trim(coalesce(p_notes,'')), '') is null then raise exception 'Alasan koreksi wajib diisi.'; end if;
  select * into v_item from public.items where id = p_item_id and is_active = true for update;
  if not found then raise exception 'Barang tidak ditemukan atau nonaktif.'; end if;
  select coalesce(stock,0) into v_stock from public.stock_balances where item_id = p_item_id;
  if p_direction = 'OUT' and coalesce(v_stock,0) < p_quantity then
    raise exception 'Stok tidak mencukupi untuk koreksi pengurangan. Stok saat ini: % %.', coalesce(v_stock,0), v_item.unit;
  end if;
  v_movement := case when p_direction = 'IN' then 'OPENING'::public.movement_type else 'REVERSAL'::public.movement_type end;
  insert into public.inventory_movements(item_id, movement_type, quantity, transaction_date, notes, created_by)
  values (p_item_id, v_movement, p_quantity, coalesce(p_date, current_date), 'KOREKSI STOK: ' || trim(p_notes), auth.uid())
  returning id into v_movement_id;
  insert into public.audit_logs(user_id, action, table_name, record_id, details)
  values (auth.uid(), 'ADJUST_STOCK', 'inventory_movements', v_movement_id,
    jsonb_build_object('item_code', v_item.code, 'direction', p_direction, 'quantity', p_quantity, 'stock_before', v_stock, 'reason', p_notes));
  return v_movement_id;
end;
$$;

revoke all on function public.post_incoming_transaction(jsonb, jsonb) from public;
revoke all on function public.post_outgoing_transaction(jsonb, jsonb) from public;
revoke all on function public.adjust_stock(uuid, text, numeric, date, text) from public;
grant execute on function public.post_incoming_transaction(jsonb, jsonb) to authenticated;
grant execute on function public.post_outgoing_transaction(jsonb, jsonb) to authenticated;
grant execute on function public.adjust_stock(uuid, text, numeric, date, text) to authenticated;
