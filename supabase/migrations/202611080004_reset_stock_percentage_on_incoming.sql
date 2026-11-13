-- Reset the 100% reference whenever a new incoming delivery is posted.
-- New baseline = previous remaining stock + this delivery, i.e. stock immediately
-- after receipt. Existing items retain their previous cumulative baseline on upgrade.

ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS stock_percentage_base numeric(18,3) NOT NULL DEFAULT 0;

UPDATE public.items i
SET stock_percentage_base = coalesce((
  SELECT sum(CASE
    WHEN m.movement_type IN ('IN','OPENING') THEN m.quantity
    ELSE 0
  END)
  FROM public.inventory_movements m
  WHERE m.item_id = i.id
), 0)
WHERE stock_percentage_base = 0;

CREATE OR REPLACE VIEW public.stock_balances AS
SELECT
  i.id AS item_id,
  i.code,
  i.name,
  i.category,
  i.unit,
  coalesce(sum(CASE
    WHEN m.movement_type IN ('IN','OPENING') THEN m.quantity
    WHEN m.movement_type IN ('OUT','REVERSAL') THEN -m.quantity
    ELSE 0
  END), 0)::numeric(18,3) AS stock,
  coalesce(sum(CASE
    WHEN m.movement_type IN ('IN','OPENING') THEN m.quantity
    ELSE 0
  END), 0)::numeric(18,3) AS incoming_total,
  coalesce(sum(CASE
    WHEN m.movement_type IN ('OUT','REVERSAL') THEN m.quantity
    ELSE 0
  END), 0)::numeric(18,3) AS outgoing_total,
  i.stock_percentage_base
FROM public.items i
LEFT JOIN public.inventory_movements m ON m.item_id = i.id
GROUP BY i.id, i.code, i.name, i.category, i.unit, i.stock_percentage_base;

ALTER VIEW public.stock_balances SET (security_invoker = true);
GRANT SELECT ON public.stock_balances TO authenticated;

-- Keep the existing atomic transaction behavior and set the new percentage base
-- after every line has been posted. Repeated lines for one item are handled once.
CREATE OR REPLACE FUNCTION public.post_incoming_transaction(p_header jsonb, p_lines jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transaction_id uuid;
  v_line jsonb;
  v_item public.items%rowtype;
  v_quantity numeric(18,3);
  v_unit text;
  v_item_id uuid;
  v_incoming_item_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Akses ditolak. Hanya ADMIN yang dapat mencatat barang masuk.';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Daftar barang harus berupa array.';
  END IF;
  IF jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Transaksi harus memiliki minimal satu barang.';
  END IF;

  INSERT INTO public.incoming_transactions(
    transaction_no, transaction_date, supplier, vehicle_no, driver_name,
    notes, created_by, status
  ) VALUES (
    p_header->>'transaction_no', (p_header->>'transaction_date')::date,
    nullif(p_header->>'supplier',''), nullif(p_header->>'vehicle_no',''),
    nullif(p_header->>'driver_name',''), nullif(p_header->>'notes',''),
    auth.uid(), 'POSTED'
  ) RETURNING id INTO v_transaction_id;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) ORDER BY value->>'item_id' LOOP
    v_item_id := (v_line->>'item_id')::uuid;
    v_quantity := (v_line->>'quantity')::numeric;
    SELECT * INTO v_item FROM public.items WHERE id = v_item_id AND is_active = true FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Barang tidak ditemukan atau sudah nonaktif.'; END IF;
    IF v_quantity IS NULL OR v_quantity <= 0 THEN RAISE EXCEPTION 'Jumlah barang harus lebih dari nol.'; END IF;
    v_unit := coalesce(nullif(v_line->>'unit',''), v_item.unit);

    INSERT INTO public.incoming_items(transaction_id, item_id, quantity, unit, cost_code)
    VALUES (v_transaction_id, v_item_id, v_quantity, v_unit, nullif(v_line->>'cost_code',''))
    RETURNING id INTO v_incoming_item_id;
    INSERT INTO public.inventory_movements(item_id, movement_type, quantity, transaction_date, incoming_item_id, notes, created_by)
    VALUES (v_item_id, 'IN', v_quantity, (p_header->>'transaction_date')::date,
      v_incoming_item_id, 'Barang masuk ' || (p_header->>'transaction_no'), auth.uid())
    ON CONFLICT (incoming_item_id) DO NOTHING;
  END LOOP;

  FOR v_item_id IN
    SELECT DISTINCT (value->>'item_id')::uuid FROM jsonb_array_elements(p_lines)
  LOOP
    UPDATE public.items
    SET stock_percentage_base = greatest(coalesce((
      SELECT sb.stock FROM public.stock_balances sb WHERE sb.item_id = v_item_id
    ), 0), 0)
    WHERE id = v_item_id;
  END LOOP;

  INSERT INTO public.audit_logs(user_id, action, table_name, record_id, details)
  VALUES (auth.uid(), 'POST_INCOMING', 'incoming_transactions', v_transaction_id,
    jsonb_build_object('transaction_no', p_header->>'transaction_no', 'line_count', jsonb_array_length(p_lines)));
  RETURN v_transaction_id;
END;
$$;

REVOKE ALL ON FUNCTION public.post_incoming_transaction(jsonb, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.post_incoming_transaction(jsonb, jsonb) TO authenticated;
