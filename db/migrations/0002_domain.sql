-- services, staff, clients
create table if not exists public.services(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  duration_min int not null,
  prep_min int not null default 0,
  cleanup_min int not null default 0,
  price numeric(10,2) not null default 0,
  eligible_staff jsonb not null default '[]'::jsonb
);

create table if not exists public.staff(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  color text,
  active bool not null default true,
  skills jsonb not null default '[]'::jsonb
);

create table if not exists public.clients(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  phone text,
  notes text,
  tags jsonb not null default '[]'::jsonb
);

-- shifts/time off
create table if not exists public.time_off_types(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  color text
);

create table if not exists public.shifts(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  weekday int not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  recurrence jsonb default '{}'::jsonb
);

create table if not exists public.time_off(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  start_ts timestamptz not null,
  end_ts timestamptz not null,
  type_id uuid references public.time_off_types(id)
);

-- resources (future-proof)
create table if not exists public.resources(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  type text,
  active bool not null default true
);

create table if not exists public.service_resource_requirements(
  service_id uuid not null references public.services(id) on delete cascade,
  resource_id uuid not null references public.resources(id) on delete cascade,
  qty int not null default 1,
  primary key(service_id, resource_id)
);

-- appointments
create table if not exists public.appointment_statuses(
  code text primary key,
  label text not null
);

insert into public.appointment_statuses(code,label) values
  ('tentative','Tentative'),
  ('confirmed','Confirmed'),
  ('in_progress','In Progress'),
  ('completed','Completed'),
  ('no_show','No Show'),
  ('cancelled','Cancelled')
on conflict do nothing;

create table if not exists public.appointments(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  client_id uuid references public.clients(id),
  start_ts timestamptz not null,
  end_ts timestamptz not null,
  status text not null references public.appointment_statuses(code),
  source text,
  notes text
);

create table if not exists public.appointment_items(
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  service_id uuid not null references public.services(id),
  staff_id uuid not null references public.staff(id),
  start_ts timestamptz not null,
  end_ts timestamptz not null
);

create table if not exists public.resource_locks(
  id uuid primary key default gen_random_uuid(),
  appointment_item_id uuid not null references public.appointment_items(id) on delete cascade,
  resource_id uuid not null references public.resources(id),
  start_ts timestamptz not null,
  end_ts timestamptz not null
);

-- indexes
create index if not exists idx_items_tenant_staff_start on public.appointment_items(appointment_id, staff_id, start_ts);
create index if not exists idx_appts_tenant_start on public.appointments(tenant_id, start_ts);
create index if not exists idx_clients_tenant on public.clients(tenant_id, id);
create index if not exists idx_rlocks_res_start on public.resource_locks(resource_id, start_ts);

-- exclusion constraints (prevent overlaps)
create extension if not exists btree_gist;

alter table public.appointment_items
  add column if not exists tenant_id uuid,
  alter column tenant_id set default null;

update public.appointment_items ai
  set tenant_id = a.tenant_id
  from public.appointments a
  where ai.appointment_id = a.id and ai.tenant_id is null;

alter table public.appointment_items alter column tenant_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'no_overlap_per_staff'
  ) then
    alter table public.appointment_items
      add constraint no_overlap_per_staff
      exclude using gist (
        tenant_id with =,
        staff_id with =,
        tstzrange(start_ts, end_ts) with &&
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'no_overlap_per_resource'
  ) then
    alter table public.resource_locks
      add constraint no_overlap_per_resource
      exclude using gist (
        resource_id with =,
        tstzrange(start_ts, end_ts) with &&
      );
  end if;
end $$;

-- enable RLS on new tables (reads tied to membership via tenant_id FK path)
alter table public.services enable row level security;
alter table public.staff enable row level security;
alter table public.clients enable row level security;
alter table public.time_off_types enable row level security;
alter table public.shifts enable row level security;
alter table public.time_off enable row level security;
alter table public.resources enable row level security;
alter table public.service_resource_requirements enable row level security;
alter table public.appointments enable row level security;
alter table public.appointment_items enable row level security;
alter table public.resource_locks enable row level security;
alter table public.appointment_statuses enable row level security;

-- conservative read policies (example: allow if user has membership in the tenant that owns the row)
create or replace function public.user_has_tenant(row_tenant uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from public.user_tenant_memberships m
    where m.user_id = auth.uid() and m.tenant_id = row_tenant
  );
$$;

create policy r_services on public.services for select using (public.user_has_tenant(tenant_id));
create policy r_staff on public.staff for select using (public.user_has_tenant(tenant_id));
create policy r_clients on public.clients for select using (public.user_has_tenant(tenant_id));
create policy r_ttypes on public.time_off_types for select using (public.user_has_tenant(tenant_id));
create policy r_shifts on public.shifts for select using (public.user_has_tenant(tenant_id));
create policy r_toff on public.time_off for select using (public.user_has_tenant(tenant_id));
create policy r_res on public.resources for select using (public.user_has_tenant(tenant_id));
create policy r_sreq on public.service_resource_requirements for select using (
  exists (select 1 from public.services s where s.id = service_id and public.user_has_tenant(s.tenant_id))
);
create policy r_appts on public.appointments for select using (public.user_has_tenant(tenant_id));
create policy r_items on public.appointment_items for select using (
  exists (select 1 from public.appointments a where a.id = appointment_id and public.user_has_tenant(a.tenant_id))
);
create policy r_rlocks on public.resource_locks for select using (
  exists (
    select 1 from public.appointment_items ai
    join public.appointments a on a.id = ai.appointment_id
    where ai.id = appointment_item_id and public.user_has_tenant(a.tenant_id)
  )
);
create policy r_status on public.appointment_statuses for select using (true);
