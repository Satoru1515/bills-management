-- 0001_init: core schema for Bills Management.
--
-- Column names mirror the TypeScript domain types in src/lib/domain/types.ts
-- (snake_case). The allowed values of bank, currency and category must stay in
-- sync with BANKS, CURRENCIES and CATEGORIES there; a Vitest test checks it.
--
-- RLS is enabled on every table here with no policies, so nothing is reachable
-- through the API until the policies migration adds per-user access.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  -- USD -> DOP rate used to convert dollar purchases in totals; null = app default.
  usd_to_dop_rate numeric(12, 4) check (usd_to_dop_rate is null or usd_to_dop_rate > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Creates the profile when a user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- gmail_connections: one Gmail account per user
-- ---------------------------------------------------------------------------

create table public.gmail_connections (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  email text not null,
  -- AES-256-GCM ciphertext (encrypted with ENCRYPTION_KEY); never the plain token.
  refresh_token_encrypted text not null check (length(refresh_token_encrypted) > 0),
  scope text,
  -- Gmail historyId is an unsigned 64-bit integer, kept as text.
  last_history_id text check (last_history_id is null or last_history_id ~ '^[0-9]+$'),
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger gmail_connections_set_updated_at
  before update on public.gmail_connections
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- transactions
-- ---------------------------------------------------------------------------

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- Deduplication key for Gmail imports; null for manual entries.
  gmail_message_id text,
  date timestamptz not null,
  -- YYYY-MM in Dominican Republic time (-04:00), as produced by the parsers.
  month text not null check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  bank text not null
    check (bank in ('Scotiabank', 'APAP', 'Banco Santa Cruz', 'PayPal')),
  -- Last 4 digits only; never full card or account numbers.
  card_last4 text not null check (card_last4 ~ '^[0-9]{4}$'),
  amount numeric(12, 2) not null check (amount > 0),
  currency text not null check (currency in ('DOP', 'USD')),
  merchant text not null check (length(btrim(merchant)) > 0),
  kind text not null default 'consumo' check (kind in ('consumo')),
  category text not null default 'Otros'
    check (category in (
      'Supermercado', 'Combustible', 'Restaurantes', 'Viajes', 'Transporte',
      'Suscripciones', 'Entretenimiento', 'Compras online', 'Hogar', 'Salud',
      'Telecom', 'Servicios', 'Cuidado personal', 'Licores', 'Otros'
    )),
  -- Hidden from totals by the user; re-syncs never overwrite category or ignored.
  ignored boolean not null default false,
  source text not null default 'gmail' check (source in ('gmail', 'manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transactions_gmail_has_message_id
    check (source <> 'gmail' or gmail_message_id is not null),
  constraint transactions_user_gmail_message_unique unique (user_id, gmail_message_id)
);

create index transactions_user_month_idx on public.transactions (user_id, month);
create index transactions_user_date_idx on public.transactions (user_id, date desc);

create trigger transactions_set_updated_at
  before update on public.transactions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- category_rules: per-user keywords evaluated before the built-in rules
-- ---------------------------------------------------------------------------

create table public.category_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  keyword text not null check (length(btrim(keyword)) > 0),
  category text not null
    check (category in (
      'Supermercado', 'Combustible', 'Restaurantes', 'Viajes', 'Transporte',
      'Suscripciones', 'Entretenimiento', 'Compras online', 'Hogar', 'Salud',
      'Telecom', 'Servicios', 'Cuidado personal', 'Licores', 'Otros'
    )),
  created_at timestamptz not null default now()
);

create unique index category_rules_user_keyword_idx
  on public.category_rules (user_id, lower(btrim(keyword)));

-- ---------------------------------------------------------------------------
-- sync_runs: one row per Gmail sync
-- ---------------------------------------------------------------------------

create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  trigger text not null default 'manual' check (trigger in ('manual', 'cron')),
  status text not null default 'running' check (status in ('running', 'ok', 'error')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  -- Messages read from Gmail in this run.
  messages_seen integer not null default 0 check (messages_seen >= 0),
  -- New transactions stored.
  new_transactions integer not null default 0 check (new_transactions >= 0),
  -- Emails from a known sender that no parser could read ("no interpretado").
  unparsed integer not null default 0 check (unparsed >= 0),
  -- Error details: [{ "gmailMessageId": "...", "message": "..." }, ...]
  errors jsonb not null default '[]'::jsonb check (jsonb_typeof(errors) = 'array'),
  constraint sync_runs_finished_after_start
    check (finished_at is null or finished_at >= started_at)
);

create index sync_runs_user_started_idx on public.sync_runs (user_id, started_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security: deny by default until the policies migration
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.gmail_connections enable row level security;
alter table public.transactions enable row level security;
alter table public.category_rules enable row level security;
alter table public.sync_runs enable row level security;
