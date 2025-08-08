-- extensions
create extension if not exists pgcrypto;

-- core tables
create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tenant_time_zone text not null
);

create table if not exists public.users (
  id uuid primary key,
  email text unique not null,
  name text
);

create table if not exists public.user_tenant_memberships (
  user_id uuid not null references public.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  role text not null check (role in ('owner','admin','staff')),
  primary key (user_id, tenant_id)
);

create table if not exists public.tenant_api_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key_hash text not null,
  created_at timestamptz not null default now(),
  revoked boolean not null default false
);

-- mirror auth.users → public.users
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- enable RLS
alter table public.tenants enable row level security;
alter table public.users enable row level security;
alter table public.user_tenant_memberships enable row level security;

-- policies
create policy user_is_self on public.users
  for select using (id = auth.uid());

create policy memberships_visible_to_member on public.user_tenant_memberships
  for select using (user_id = auth.uid());

create policy tenants_visible_to_member on public.tenants
  for select using (
    exists (
      select 1 from public.user_tenant_memberships m
      where m.user_id = auth.uid()
        and m.tenant_id = tenants.id
    )
  );

-- RLS tests helper
create or replace function public.run_rls_tests()
returns table(test_name text, passed boolean)
language plpgsql
set search_path = public
as $$
declare
  u1 uuid := gen_random_uuid();
  u2 uuid := gen_random_uuid();
  t1 uuid := gen_random_uuid();
  t2 uuid := gen_random_uuid();
  cnt int;
begin
  insert into public.users(id,email,name) values (u1,'u1@example.com','U1'), (u2,'u2@example.com','U2');
  insert into public.tenants(id,name,tenant_time_zone) values (t1,'Tenant 1','UTC'), (t2,'Tenant 2','UTC');
  insert into public.user_tenant_memberships(user_id,tenant_id,role) values (u1,t1,'staff');

  perform set_config('request.jwt.claims', json_build_object('sub', u1)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into cnt from public.tenants where id = t1;
  return query select 'positive_membership_can_read', (cnt = 1);

  select count(*) into cnt from public.tenants where id = t2;
  return query select 'negative_cross_tenant_denied', (cnt = 0);

  perform set_config('request.jwt.claims', json_build_object('sub', u2)::text, true);
  select count(*) into cnt from public.tenants;
  return query select 'no_membership_sees_nothing', (cnt = 0);

  delete from public.user_tenant_memberships where tenant_id in (t1,t2);
  delete from public.tenant_api_keys where tenant_id in (t1,t2);
  delete from public.tenants where id in (t1,t2);
  delete from public.users where id in (u1,u2);
end;
$$;

-- fail if tests fail
do $$
declare r record; all_pass boolean := true;
begin
  for r in select * from public.run_rls_tests() loop
    if not r.passed then all_pass := false; end if;
  end loop;
  if not all_pass then
    raise exception 'RLS tests failed';
  end if;
end $$;
