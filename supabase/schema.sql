-- CASA DREAMLAND / BELIA-BAYA | Supabase PostgreSQL
create extension if not exists pgcrypto;
do $$ begin create type public.app_role as enum ('ADMIN','ATASAN'); exception when duplicate_object then null; end $$;
do $$ begin create type public.item_category as enum ('MATERIAL','ALAT'); exception when duplicate_object then null; end $$;
do $$ begin create type public.movement_type as enum ('IN','OUT','OPENING','REVERSAL'); exception when duplicate_object then null; end $$;

create table if not exists public.profiles(
 id uuid primary key references auth.users(id) on delete cascade,
 full_name text not null default '',
 role public.app_role not null default 'ATASAN',
 created_at timestamptz not null default now()
);
create table if not exists public.projects(id uuid primary key default gen_random_uuid(),name text unique not null);
create table if not exists public.warehouses(id uuid primary key default gen_random_uuid(),name text unique not null,location text,is_active boolean not null default true);
create table if not exists public.items(
 id uuid primary key default gen_random_uuid(),code text unique not null,name text not null,
 category public.item_category not null,unit text,is_active boolean not null default true,
 stock_percentage_base numeric(18,3) not null default 0,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index if not exists items_category_idx on public.items(category);
-- Normalized unique indexes: block duplicate codes/names regardless of letter case or outer spaces.
create unique index if not exists items_code_normalized_uidx on public.items (lower(btrim(code)));
create unique index if not exists items_name_normalized_uidx on public.items (lower(btrim(name)));

create or replace function public.sync_item_active_from_unit()
returns trigger language plpgsql set search_path=public as $$
begin
  new.unit := nullif(upper(btrim(coalesce(new.unit,''))), '');
  new.is_active := new.unit is not null;
  return new;
end;
$$;
drop trigger if exists items_sync_active_from_unit on public.items;
create trigger items_sync_active_from_unit
before insert or update of unit, is_active on public.items
for each row execute function public.sync_item_active_from_unit();

create table if not exists public.incoming_transactions(
 id uuid primary key default gen_random_uuid(),transaction_no text unique not null,transaction_date date not null,
 warehouse_id uuid references public.warehouses(id),supplier text,vehicle_no text,driver_name text,notes text,
 created_by uuid references public.profiles(id),created_at timestamptz not null default now(),
 status text not null default 'POSTED' check(status in('DRAFT','POSTED','VOID'))
);
create table if not exists public.incoming_items(
 id uuid primary key default gen_random_uuid(),transaction_id uuid not null references public.incoming_transactions(id),
 item_id uuid not null references public.items(id),quantity numeric(18,3) not null check(quantity>0),
 unit text not null,cost_code text
);
create table if not exists public.outgoing_transactions(
 id uuid primary key default gen_random_uuid(),transaction_no text unique not null,transaction_date date not null,
 warehouse_id uuid references public.warehouses(id),destination text,receiver_name text,driver_name text,notes text,
 created_by uuid references public.profiles(id),created_at timestamptz not null default now(),
 status text not null default 'POSTED' check(status in('DRAFT','POSTED','VOID'))
);
create table if not exists public.outgoing_items(
 id uuid primary key default gen_random_uuid(),transaction_id uuid not null references public.outgoing_transactions(id),
 item_id uuid not null references public.items(id),quantity numeric(18,3) not null check(quantity>0),
 unit text not null,cost_code text
);
create table if not exists public.inventory_movements(
 id uuid primary key default gen_random_uuid(),item_id uuid not null references public.items(id),
 movement_type public.movement_type not null,quantity numeric(18,3) not null check(quantity>0),
 transaction_date date not null,incoming_item_id uuid unique references public.incoming_items(id),
 outgoing_item_id uuid unique references public.outgoing_items(id),notes text,
 created_by uuid references public.profiles(id),
 check((movement_type='IN' and incoming_item_id is not null and outgoing_item_id is null)
 or (movement_type='OUT' and outgoing_item_id is not null and incoming_item_id is null)
 or (movement_type in('OPENING','REVERSAL') and incoming_item_id is null and outgoing_item_id is null))
);
create index if not exists movements_item_date_idx on public.inventory_movements(item_id,transaction_date);
create table if not exists public.transaction_photos(
 id uuid primary key default gen_random_uuid(),incoming_transaction_id uuid not null references public.incoming_transactions(id) on delete cascade,
 storage_path text not null,description text,uploaded_by uuid references public.profiles(id),created_at timestamptz not null default now()
);
create table if not exists public.audit_logs(
 id uuid primary key default gen_random_uuid(),user_id uuid references public.profiles(id),action text not null,
 table_name text not null,record_id uuid,details jsonb not null default '{}'::jsonb,created_at timestamptz not null default now()
);
insert into public.projects(name) values('Casa Dreamland / Belia-Baya') on conflict do nothing;
insert into public.warehouses(name,location) values('Gudang Utama','Casa Dreamland / Belia-Baya') on conflict do nothing;

create or replace view public.stock_balances with (security_invoker = true) as
select i.id as item_id,i.code,i.name,i.category,i.unit,
coalesce(sum(case when m.movement_type in('IN','OPENING') then m.quantity when m.movement_type in('OUT','REVERSAL') then -m.quantity else 0 end),0)::numeric(18,3) as stock,
coalesce(sum(case when m.movement_type in('IN','OPENING') then m.quantity else 0 end),0)::numeric(18,3) as incoming_total,
coalesce(sum(case when m.movement_type in('OUT','REVERSAL') then m.quantity else 0 end),0)::numeric(18,3) as outgoing_total,
i.stock_percentage_base
from public.items i left join public.inventory_movements m on m.item_id=i.id
group by i.id,i.code,i.name,i.category,i.unit,i.stock_percentage_base;
grant select on public.stock_balances to authenticated;
grant select on public.items, public.inventory_movements to authenticated;

create or replace function public.current_user_role() returns public.app_role
language sql stable security definer set search_path=public
as $$ select role from public.profiles where id=auth.uid() $$;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path=public
as $$ select coalesce(public.current_user_role()='ADMIN',false) $$;

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.warehouses enable row level security;
alter table public.items enable row level security;
alter table public.incoming_transactions enable row level security;
alter table public.incoming_items enable row level security;
alter table public.outgoing_transactions enable row level security;
alter table public.outgoing_items enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.transaction_photos enable row level security;
alter table public.audit_logs enable row level security;

create policy "profile read own or admin" on public.profiles for select to authenticated using(id=auth.uid() or public.is_admin());
create policy "items read authenticated" on public.items for select to authenticated using(true);
create policy "items admin manage" on public.items for all to authenticated using(public.is_admin()) with check(public.is_admin());

do $$ declare t text; begin foreach t in array array['projects','warehouses','incoming_transactions','incoming_items','outgoing_transactions','outgoing_items','inventory_movements','transaction_photos','audit_logs'] loop
 execute format('create policy %I on public.%I for select to authenticated using(true)',t||' read authenticated',t);
 execute format('create policy %I on public.%I for all to authenticated using(public.is_admin()) with check(public.is_admin())',t||' admin manage',t);
end loop; end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('incoming-evidence','incoming-evidence',false,10485760,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
create policy "incoming photo read auth" on storage.objects for select to authenticated using(bucket_id='incoming-evidence');
create policy "incoming photo admin insert" on storage.objects for insert to authenticated with check(bucket_id='incoming-evidence' and public.is_admin());
create policy "incoming photo admin update" on storage.objects for update to authenticated using(bucket_id='incoming-evidence' and public.is_admin()) with check(bucket_id='incoming-evidence' and public.is_admin());
create policy "incoming photo admin delete" on storage.objects for delete to authenticated using(bucket_id='incoming-evidence' and public.is_admin());

-- Setelah membuat user di Authentication, masukkan UUID user admin ke profiles dengan role ADMIN.
-- Jangan pernah menaruh service_role key di frontend.
-- Posting transaksi dan validasi saldo harus dibuat melalui RPC/server-side atomic transaction
-- sebelum sistem digunakan untuk transaksi operasional sebenarnya.
