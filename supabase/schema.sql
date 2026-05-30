-- Run this in Supabase Dashboard → SQL Editor → New Query → paste → Run
-- One-time setup; idempotent (uses IF NOT EXISTS).

-- Users table — one row per Clerk user, holds credit balance
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  clerk_id text unique not null,
  email text,
  credits integer not null default 0,
  total_credits_purchased integer not null default 0,
  total_parses integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists users_clerk_id_idx on users(clerk_id);
create index if not exists users_email_idx on users(email);

-- Purchases — Stripe payment events
create table if not exists purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  stripe_session_id text unique not null,
  stripe_payment_intent text,
  pack_name text not null,
  credits integer not null,
  amount_thb integer not null,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create index if not exists purchases_user_id_idx on purchases(user_id);
create index if not exists purchases_session_idx on purchases(stripe_session_id);

-- Parse history — one row per /api/parse call (success or failure)
create table if not exists parses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  pdf_name text,
  page_count integer,
  credits_used integer not null default 0,
  scenes_count integer,
  status text not null default 'pending',
  error_message text,
  input_tokens integer,
  output_tokens integer,
  duration_ms integer,
  created_at timestamptz not null default now()
);

create index if not exists parses_user_id_idx on parses(user_id);
create index if not exists parses_created_at_idx on parses(created_at desc);

-- Updated-at trigger for users
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists users_updated_at on users;
create trigger users_updated_at
  before update on users
  for each row execute function set_updated_at();

-- RLS — service role bypasses, so we just enable RLS without policies
-- (all access goes through our Next.js API routes using service_role key)
alter table users enable row level security;
alter table purchases enable row level security;
alter table parses enable row level security;
