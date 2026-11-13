-- BELIA-BAYA: unit controls whether an item is active.
-- Empty unit => inactive; non-empty unit => active. Existing item records are retained.
ALTER TABLE public.items ALTER COLUMN unit DROP NOT NULL;

UPDATE public.items
SET unit = NULLIF(BTRIM(unit), ''),
    is_active = (NULLIF(BTRIM(unit), '') IS NOT NULL)
WHERE is_active IS DISTINCT FROM (NULLIF(BTRIM(unit), '') IS NOT NULL)
   OR unit IS DISTINCT FROM NULLIF(BTRIM(unit), '');

CREATE OR REPLACE FUNCTION public.sync_item_active_from_unit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.unit := NULLIF(UPPER(BTRIM(COALESCE(NEW.unit, ''))), '');
  NEW.is_active := NEW.unit IS NOT NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS items_sync_active_from_unit ON public.items;
CREATE TRIGGER items_sync_active_from_unit
BEFORE INSERT OR UPDATE OF unit, is_active ON public.items
FOR EACH ROW EXECUTE FUNCTION public.sync_item_active_from_unit();

COMMENT ON COLUMN public.items.unit IS
  'Satuan barang. NULL/kosong berarti barang Tidak Aktif; satuan terisi berarti Aktif.';
