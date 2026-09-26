-- Haggle v2 schema. Idempotent: creates what's missing, never drops data.
create table if not exists categories (
  id       text primary key,                        -- slug: 'shoes'
  label    text not null,                           -- 'Shoes'
  required text[] not null default '{}',            -- fields the agent must gather; must match listing exactly
  optional text[] not null default '{}'             -- fields used for ranking only
);

create table if not exists bundles (
  id           text primary key,                    -- slug: 'cycling'
  label        text not null,                       -- 'Cycling starter kit'
  description  text not null default '',            -- tells the buyer agent when to use it; card subtitle
  category_ids text[] not null default '{}'         -- ids in categories; unknown ids are ignored by the app
);

create table if not exists accounts (                -- sellers only; buyers are anonymous sessions
  id      text primary key,                         -- slug: 'tom', 'nike-store'
  name    text not null,
  type    text not null check (type in ('brand', 'private')),
  persona text not null default ''                  -- negotiation style; server-only
);

create table if not exists listings (
  id           text primary key default gen_random_uuid()::text,
  seller_id    text not null references accounts(id) on update cascade on delete cascade,
  category     text not null references categories(id) on update cascade,   -- delete/move listings before deleting a category
  title        text not null,
  attributes   jsonb not null default '{}'::jsonb,  -- keys from the category's required/optional; lower-case string values
  asking_price integer not null check (asking_price > 0),   -- whole GBP
  floor_price  integer not null check (floor_price > 0),    -- whole GBP, PRIVATE
  status       text not null default 'active' check (status in ('active', 'sold')),
  busy_until      timestamptz,                      -- listing busy lock (01 §5): set while a session negotiates / decides
  busy_session_id text,                             -- lock owner; server-only
  created_at   timestamptz not null default now(),
  check (floor_price <= asking_price)
);
create index if not exists listings_status_category_idx on listings (status, category);

create table if not exists requests (
  id         text primary key default gen_random_uuid()::text,
  session_id text not null,                          -- anonymous browser session (UUID)
  bundle     text,                                   -- bundle id or null (no FK: bundles may be edited/deleted)
  items      jsonb not null default '[]'::jsonb,     -- RequestItem[] (camelCase JSON, includes PRIVATE maxPrice)
  status     text not null default 'gathering' check (status in ('gathering', 'ready')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists requests_session_idx on requests (session_id);

create table if not exists negotiations (
  id          text primary key default gen_random_uuid()::text,
  session_id  text not null,
  request_id  text not null references requests(id) on delete cascade,
  category    text not null,                         -- which request item (one item per category)
  listing_id  text not null references listings(id) on delete cascade,
  turns       jsonb not null default '[]'::jsonb,    -- Offer[] (camelCase JSON)
  status      text not null default 'running' check (status in ('running', 'agreed', 'failed', 'accepted')),
  final_price integer,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists negotiations_session_idx on negotiations (session_id);

-- Listing busy lock. Atomic single-statement functions using the DB clock; called via supabase.rpc() from lib/db.ts.
-- Take (or refresh your own) lock: only if active and free/expired/already yours. Returns true if you hold it.
create or replace function lock_listing(p_listing_id text, p_session_id text, p_seconds int default 120)
returns boolean language sql as $$
  with u as (
    update listings
       set busy_until = now() + make_interval(secs => p_seconds), busy_session_id = p_session_id
     where id = p_listing_id and status = 'active'
       and (busy_until is null or busy_until < now() or busy_session_id = p_session_id)
    returning 1)
  select exists (select 1 from u);
$$;

-- Release your lock (failed negotiation, crash, walk away). No-op if someone else holds it.
create or replace function release_listing(p_listing_id text, p_session_id text)
returns void language sql as $$
  update listings set busy_until = null, busy_session_id = null
   where id = p_listing_id and busy_session_id = p_session_id;
$$;

-- Sell: only the lock holder, only while active. Clears the lock. Returns true if sold.
create or replace function sell_listing(p_listing_id text, p_session_id text)
returns boolean language sql as $$
  with u as (
    update listings set status = 'sold', busy_until = null, busy_session_id = null
     where id = p_listing_id and status = 'active' and busy_session_id = p_session_id
    returning 1)
  select exists (select 1 from u);
$$;

revoke execute on function lock_listing(text, text, int), release_listing(text, text), sell_listing(text, text)
  from public, anon, authenticated;

-- Default privileges grant execute to public; the revoke above removes that. The app calls
-- these through the service role only (lib/db.ts). Idempotent if the role already has it.
grant execute on function lock_listing(text, text, int), release_listing(text, text), sell_listing(text, text)
  to service_role;

-- Lock the tables from the public Data API. No policies on purpose: only the service-role key (server) can read/write.
alter table categories   enable row level security;
alter table bundles      enable row level security;
alter table accounts     enable row level security;
alter table listings     enable row level security;
alter table requests     enable row level security;
alter table negotiations enable row level security;
