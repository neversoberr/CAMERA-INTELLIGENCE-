create extension if not exists pgcrypto;

create table if not exists public.centres (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  city text,
  state text,
  country text not null default 'India',
  status text not null default 'pending' check (status in ('active','pending','inactive')),
  created_at timestamptz not null default now()
);

create table if not exists public.branch_connectors (
  id uuid primary key default gen_random_uuid(),
  centre_id uuid references public.centres(id) on delete set null,
  name text not null,
  device_label text,
  status text not null default 'pending' check (status in ('online','offline','pending')),
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.cameras (
  id uuid primary key default gen_random_uuid(),
  centre_id uuid references public.centres(id) on delete set null,
  connector_id uuid references public.branch_connectors(id) on delete set null,
  name text not null,
  ip_address inet,
  model text,
  serial_last4 text,
  status text not null default 'pending' check (status in ('online','offline','pending','unknown')),
  stream_profile text,
  created_at timestamptz not null default now()
);

create table if not exists public.cabins (
  id uuid primary key default gen_random_uuid(),
  centre_id uuid not null references public.centres(id) on delete cascade,
  camera_id uuid references public.cameras(id) on delete set null,
  name text not null,
  occupancy_state text not null default 'unknown' check (occupancy_state in ('occupied','vacant','unknown')),
  state_changed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.occupancy_events (
  id uuid primary key default gen_random_uuid(),
  cabin_id uuid not null references public.cabins(id) on delete cascade,
  state text not null check (state in ('occupied','vacant','unknown')),
  started_at timestamptz not null,
  ended_at timestamptz,
  confidence numeric(5,4),
  source text not null default 'ai'
);

create table if not exists public.camera_health (
  id uuid primary key default gen_random_uuid(),
  camera_id uuid not null references public.cameras(id) on delete cascade,
  status text not null check (status in ('online','offline','unknown')),
  checked_at timestamptz not null default now(),
  details text
);

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  cabin_id uuid references public.cabins(id) on delete set null,
  camera_id uuid references public.cameras(id) on delete set null,
  alert_type text not null,
  threshold_minutes integer,
  message text not null,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);

-- RLS is enabled. This starter permits authenticated reads only.
-- Add a verified admin allowlist and explicit admin-only policies before production.
alter table public.centres enable row level security;
alter table public.branch_connectors enable row level security;
alter table public.cameras enable row level security;
alter table public.cabins enable row level security;
alter table public.occupancy_events enable row level security;
alter table public.camera_health enable row level security;
alter table public.alerts enable row level security;

do $$
declare t text;
begin
  foreach t in array array['centres','branch_connectors','cameras','cabins','occupancy_events','camera_health','alerts']
  loop
    execute format('drop policy if exists "authenticated read %I" on public.%I', t, t);
    execute format('create policy "authenticated read %I" on public.%I for select to authenticated using (true)', t, t);
  end loop;
end $$;

-- Seed only the count placeholder? No real centre names are assumed.
-- Insert verified centre records after confirming the official centre list.
