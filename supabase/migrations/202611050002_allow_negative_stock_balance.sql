-- BELIA-BAYA: izinkan pencatatan Barang Keluar melebihi total penambahan.
-- Saldo dapat menjadi negatif agar selisih pencatatan lapangan tetap terlihat
-- pada kolom stok dan persentase (contoh: -20%).
-- Tetap dibatasi ADMIN, item aktif, kuantitas positif, dan satu transaksi minimal satu baris.
-- Tidak mengubah atau menghapus transaksi lama.

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
    jsonb_build_object('transaction_no', p_header->>'transaction_no', 'line_count', jsonb_array_length(p_lines), 'negative_stock_allowed', true));
  return v_transaction_id;
end;
$$;

revoke all on function public.post_outgoing_transaction(jsonb, jsonb) from public;
grant execute on function public.post_outgoing_transaction(jsonb, jsonb) to authenticated;
