-- Prevent duplicate item codes and names (case-insensitive, ignoring surrounding spaces).
-- This migration intentionally stops if existing duplicates are found; clean them up first.
do $$
declare
  duplicate_codes text;
  duplicate_names text;
begin
  select string_agg(format('%s (%s data)', value, count), ', ')
    into duplicate_codes
  from (
    select lower(btrim(code)) as value, count(*) as count
    from public.items
    group by lower(btrim(code))
    having count(*) > 1
    order by lower(btrim(code))
    limit 20
  ) d;

  select string_agg(format('%s (%s data)', value, count), ', ')
    into duplicate_names
  from (
    select lower(btrim(name)) as value, count(*) as count
    from public.items
    group by lower(btrim(name))
    having count(*) > 1
    order by lower(btrim(name))
    limit 20
  ) d;

  if duplicate_codes is not null or duplicate_names is not null then
    raise exception 'Duplikasi ditemukan pada public.items. Kode: %. Nama: %. Rapikan data duplikat sebelum menjalankan migrasi ini.',
      coalesce(duplicate_codes, 'tidak ada'), coalesce(duplicate_names, 'tidak ada');
  end if;
end $$;

create unique index if not exists items_code_normalized_uidx
  on public.items (lower(btrim(code)));

create unique index if not exists items_name_normalized_uidx
  on public.items (lower(btrim(name)));
