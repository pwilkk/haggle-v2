# 02 · Data: Supabase schema, example seed, data access

**Owner:** Workstream A.
**Depends on:** 01.
**Exposes:** `supabase/schema.sql`, `supabase/seed.example.sql`, `lib/db.ts` (the only file that talks to Supabase), `lib/http.ts` (tiny error helper).

## Rules

- Six tables: `categories`, `bundles`, `accounts` (sellers), `listings`, `requests`, `negotiations`. Nothing else.
- **All marketplace data lives in the DB.** No category, bundle, seller or listing is hard-coded anywhere in `app/` or `lib/`. The app must boot and work (with "no matches") on an empty catalogue.
- **Live reads.** Every route calls `lib/db.ts` on every request. No module-level memo, no `globalThis` cache, no `use cache`, no `unstable_cache`. See 00 "Live data" for the Next.js 16 notes.
- Access **only** from Next.js server code via `@supabase/supabase-js` with `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. No Supabase Auth, no anon key, no `NEXT_PUBLIC_SUPABASE_*`, no browser client.
- RLS enabled with **no policies**: the public/anon key reads nothing; the service-role key bypasses RLS.
- `lib/db.ts` starts with `import "server-only";` so an accidental client import fails the build.
- Only `getListingPrivate()` selects `floor_price` and `persona`. Every other listing query uses an explicit public column list (never `select("*")` on `listings` or `accounts`).
- Humans edit catalogue data directly in Supabase (Table Editor or SQL), see 07.
- **Sold is final.** `/api/accept` sets `listings.status='sold'` for everyone, permanently. Nothing in the app (or the example seed) ever sets it back to `active`; supply is replenished by inserting new listings/sellers.

## Setup (once per Supabase project)

1. Create a Supabase project (pick a region near your Vercel region, e.g. London). Copy the Project URL and the `service_role` key (Settings → API; a newer `sb_secret_…` secret key also works with supabase-js) into `.env.local` and Vercel (08).
2. SQL editor → paste `supabase/schema.sql` → Run. Safe to re-run (`if not exists`).
3. **Optional:** SQL editor → paste `supabase/seed.example.sql` → Run to get the example catalogue. Code does not depend on it.
4. Check: `select count(*) from categories;` (5 with the example seed), `select count(*) from listings;` (26).

## `supabase/schema.sql`

```sql
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

-- Lock the tables from the public Data API. No policies on purpose: only the service-role key (server) can read/write.
alter table categories   enable row level security;
alter table bundles      enable row level security;
alter table accounts     enable row level security;
alter table listings     enable row level security;
alter table requests     enable row level security;
alter table negotiations enable row level security;
```

## `supabase/seed.example.sql` (OPTIONAL example data)

> **Example starter dataset, not a dependency.** Nothing in the code refers to these ids, names or prices. Use it to have something to play with; edit or delete freely (07). Every insert is `on conflict (id) do nothing`, so re-running it only re-creates example rows you deleted; it never overwrites your edits and **never re-activates a sold listing** (sold is final, see 07).

What it gives you: a shoes request `{type: sport, colour: black, size: 8}` with budget £80 matches exactly three listings (Tom £90, Nike Store £120 shown "over budget", Anna £85), with four shoe sellers ("Asked 4 seller agents…"); the rest of the shoes are near misses on size, colour or type. A `cycling` bundle (bike, helmet, jacket, glasses) is stocked in M/L across Cycle Hub (brand) and Anna (private).

```sql
-- ===================== EXAMPLE DATA (optional) =====================
insert into categories (id, label, required, optional) values
  ('shoes',   'Shoes',   '{type,size,colour}', '{brand,model,condition}'),
  ('bike',    'Bike',    '{type,frame_size}',  '{brand,condition}'),
  ('helmet',  'Helmet',  '{size}',             '{brand,colour}'),
  ('jacket',  'Jacket',  '{size}',             '{colour,brand}'),
  ('glasses', 'Glasses', '{}',                 '{brand}')
on conflict (id) do nothing;

insert into bundles (id, label, description, category_ids) values
  ('cycling', 'Cycling starter kit',
   'For someone who wants to start cycling / get into cycling / needs a cycling kit: bike, helmet, jacket and glasses.',
   '{bike,helmet,jacket,glasses}')
on conflict (id) do nothing;

insert into accounts (id, name, type, persona) values
  ('tom',          'Tom',          'private', 'Private seller who wants a quick sale. Friendly and casual, concedes in big steps, happy to close fast once the offer is reasonable.'),
  ('nike-store',   'Nike Store',   'brand',   'Official Nike store. Firm on price: small concessions only, stresses authenticity, warranty and free returns.'),
  ('adidas-store', 'Adidas Store', 'brand',   'Official Adidas store. Polite, modest discounts, mentions new-season stock.'),
  ('anna',         'Anna',         'private', 'Casual private seller clearing out her wardrobe and garage. Flexible and chatty, likes to meet people halfway.'),
  ('cycle-hub',    'Cycle Hub',    'brand',   'Local bike shop. Fair but firm: small discounts, mentions the free first service and fitting.')
on conflict (id) do nothing;

insert into listings (id, seller_id, category, title, attributes, asking_price, floor_price) values
  -- shoes that match {sport, black, 8}
  ('l-tom-am90-8',          'tom',          'shoes', 'Used Nike Air Max 90, black, UK 8',
     '{"type":"sport","size":"8","colour":"black","brand":"nike","model":"air max 90","condition":"used"}',         90,  70),
  ('l-nike-am90-8',         'nike-store',   'shoes', 'New Nike Air Max 90, black, UK 8',
     '{"type":"sport","size":"8","colour":"black","brand":"nike","model":"air max 90","condition":"new"}',         120, 105),
  ('l-anna-ultraboost-8',   'anna',         'shoes', 'Adidas Ultraboost, black, UK 8',
     '{"type":"sport","size":"8","colour":"black","brand":"adidas","model":"ultraboost","condition":"used"}',      85,  68),
  -- shoes: near misses
  ('l-anna-gazelle-8',      'anna',         'shoes', 'Adidas Gazelle, white, UK 8',
     '{"type":"casual","size":"8","colour":"white","brand":"adidas","model":"gazelle","condition":"used"}',        55,  45),
  ('l-tom-am90-10',         'tom',          'shoes', 'Used Nike Air Max 90, black, UK 10',
     '{"type":"sport","size":"10","colour":"black","brand":"nike","model":"air max 90","condition":"used"}',       80,  60),
  ('l-tom-revolution-8',    'tom',          'shoes', 'Used Nike Revolution 6, blue, UK 8',
     '{"type":"sport","size":"8","colour":"blue","brand":"nike","model":"revolution 6","condition":"used"}',       30,  20),
  ('l-nike-am270-8',        'nike-store',   'shoes', 'New Nike Air Max 270, white, UK 8',
     '{"type":"sport","size":"8","colour":"white","brand":"nike","model":"air max 270","condition":"new"}',        140, 125),
  ('l-nike-pegasus-9',      'nike-store',   'shoes', 'New Nike Pegasus 41, black, UK 9',
     '{"type":"sport","size":"9","colour":"black","brand":"nike","model":"pegasus 41","condition":"new"}',         125, 110),
  ('l-nike-af1-8',          'nike-store',   'shoes', 'New Nike Air Force 1, black, UK 8',
     '{"type":"casual","size":"8","colour":"black","brand":"nike","model":"air force 1","condition":"new"}',       110, 95),
  ('l-adidas-ultraboost-9', 'adidas-store', 'shoes', 'New Adidas Ultraboost Light, black, UK 9',
     '{"type":"sport","size":"9","colour":"black","brand":"adidas","model":"ultraboost light","condition":"new"}', 150, 130),
  ('l-adidas-samba-8',      'adidas-store', 'shoes', 'New Adidas Samba, white, UK 8',
     '{"type":"casual","size":"8","colour":"white","brand":"adidas","model":"samba","condition":"new"}',          90,  80),
  ('l-adidas-runfalcon-8',  'adidas-store', 'shoes', 'New Adidas Runfalcon 5, grey, UK 8',
     '{"type":"sport","size":"8","colour":"grey","brand":"adidas","model":"runfalcon 5","condition":"new"}',       55,  48),
  -- bikes
  ('l-hub-boardman-l',      'cycle-hub', 'bike', 'New Boardman HYB 8.6 hybrid bike, L frame',
     '{"type":"hybrid","frame_size":"l","brand":"boardman","condition":"new"}',     650, 560),
  ('l-hub-boardman-m',      'cycle-hub', 'bike', 'New Boardman HYB 8.6 hybrid bike, M frame',
     '{"type":"hybrid","frame_size":"m","brand":"boardman","condition":"new"}',     650, 560),
  ('l-hub-allez-l',         'cycle-hub', 'bike', 'New Specialized Allez road bike, L frame',
     '{"type":"road","frame_size":"l","brand":"specialized","condition":"new"}',    900, 780),
  ('l-anna-carrera-l',      'anna',      'bike', 'Used Carrera Subway hybrid bike, L frame',
     '{"type":"hybrid","frame_size":"l","brand":"carrera","condition":"used"}',     280, 220),
  ('l-anna-trek-m',         'anna',      'bike', 'Used Trek Domane AL 2 road bike, M frame',
     '{"type":"road","frame_size":"m","brand":"trek","condition":"used"}',          450, 380),
  -- helmets
  ('l-hub-giro-m',          'cycle-hub', 'helmet', 'New Giro Register MIPS helmet, M, black',
     '{"size":"m","colour":"black","brand":"giro","condition":"new"}',              55,  45),
  ('l-hub-giro-l',          'cycle-hub', 'helmet', 'New Giro Register MIPS helmet, L, black',
     '{"size":"l","colour":"black","brand":"giro","condition":"new"}',              55,  45),
  ('l-anna-align-l',        'anna',      'helmet', 'Used Specialized Align helmet, L, white',
     '{"size":"l","colour":"white","brand":"specialized","condition":"used"}',      25,  18),
  -- jackets
  ('l-hub-dhb-l',           'cycle-hub', 'jacket', 'New dhb hi-vis waterproof cycling jacket, L, yellow',
     '{"size":"l","colour":"yellow","brand":"dhb","condition":"new"}',              70,  55),
  ('l-hub-dhb-m',           'cycle-hub', 'jacket', 'New dhb waterproof cycling jacket, M, black',
     '{"size":"m","colour":"black","brand":"dhb","condition":"new"}',               70,  55),
  ('l-anna-altura-l',       'anna',      'jacket', 'Used Altura Nightvision jacket, L, yellow',
     '{"size":"l","colour":"yellow","brand":"altura","condition":"used"}',          35,  25),
  -- glasses
  ('l-hub-oakley',          'cycle-hub', 'glasses', 'New Oakley Sutro Lite cycling glasses',
     '{"brand":"oakley","condition":"new"}',                                        120, 100),
  ('l-hub-tifosi',          'cycle-hub', 'glasses', 'New Tifosi Swank glasses, clear/tinted lenses',
     '{"brand":"tifosi","condition":"new"}',                                        30,  24),
  ('l-anna-rockrider',      'anna',      'glasses', 'Used Rockrider cycling glasses',
     '{"brand":"rockrider","condition":"used"}',                                    12,  8)
on conflict (id) do nothing;
```

Notes: `condition` is stored on every example listing for the card chip even where it isn't a category field (glasses); extra keys are harmless. Tests do **not** use this file; they use their own fixtures (04, 05).

## `lib/db.ts` interface

```ts
import "server-only";
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Public listing columns: floor_price and persona deliberately absent. busy_* are read only to compute `busy`.
const LISTING_PUBLIC = "id, seller_id, category, title, attributes, asking_price, status, busy_until, busy_session_id, seller:accounts!inner(name, type)";

export async function loadCatalog(): Promise<Catalog>;
  // select * from categories + bundles, every call (live). Drops bundle categoryIds that aren't existing categories,
  // and bundles left with none. Lower-cases/trims field names.

export async function listActiveListingViews(sessionId: string): Promise<ListingView[]>;
  // .from("listings").select(LISTING_PUBLIC).eq("status","active") → toListingView(row, sessionId).
  // busy = busy_until > now && busy_session_id !== sessionId. busy listings are still returned (the matcher shows them).
  // All active listings: fine for a hackathon-sized catalogue (hundreds). Add .in("category", ids) if it grows.

export async function getListingPrivate(id: string): Promise<{ listing: Listing; seller: Account } | null>;
  // ONLY place that selects floor_price and persona. Used only by /api/negotiate.

export async function getRequest(id: string, sessionId: string): Promise<BuyerRequest | null>;
  // null if missing OR session_id doesn't match.

export async function saveRequest(r: Omit<BuyerRequest, "id"> & { id: string | null }): Promise<BuyerRequest>;
  // id null (or not found for this session) → insert, return new row; else update + bump updated_at.

export async function countNegotiations(sessionId: string): Promise<number>;

export async function lockListing(listingId: string, sessionId: string): Promise<boolean>;   // rpc("lock_listing"); also used to refresh on agreed
export async function releaseListing(listingId: string, sessionId: string): Promise<void>;  // rpc("release_listing")

export async function createNegotiation(n: { sessionId: string; requestId: string; category: string; listingId: string }): Promise<string>;
  // inserts status 'running', returns id

export async function finishNegotiation(id: string, r: { turns: Offer[]; status: "agreed" | "failed"; finalPrice: number | null }): Promise<void>;

export async function acceptNegotiation(id: string, sessionId: string): Promise<AcceptResponse>;
  // 1. load negotiation → 404 if missing or session_id ≠ sessionId; 409 unless status 'agreed'
  // 2. rpc("sell_listing", { listing, session }) → false ⇒ 409 "Deal expired" (lock lapsed and another session took it, or listing gone)
  // 3. update negotiation status 'accepted'
  // 4. return { negotiationId, status: "accepted", finalPrice, listing: ListingView }

export async function walkAwayNegotiation(id: string, sessionId: string): Promise<void>;
  // load → 404 if missing/other session; releaseListing(listing, session); negotiation status 'failed' (if it was 'agreed').

export function toListingView(row: ListingRowWithSeller, sessionId: string): ListingView;   // snake → camel, computes busy, never copies floor_price/busy_session_id
export function publicView(listing: Listing, seller: Account): ListingView; // strips floorPrice, busy:false (the caller holds the lock); used by /api/negotiate's start event
```

Row mapping: `asking_price → askingPrice`, `floor_price → floorPrice`, `seller_id → sellerId`, `session_id → sessionId`, `final_price → finalPrice`, `request_id → requestId`, `listing_id → listingId`, `category_ids → categoryIds`, `seller.type → sellerType`, `seller.name → sellerName`. `items` and `turns` are stored as camelCase JSON. Attribute values from hand-edited rows: coerce to lower-case trimmed strings in `toListingView`/`getListingPrivate` (numbers → `String(n)`), so a human typing `"Black"` or `8` in the Table Editor still matches. Parse results with the Zod schemas from 01 so truly bad rows fail loudly (skip + `console.warn` a bad listing row rather than failing the whole chat).

## `lib/http.ts`

```ts
export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export function errorResponse(e: unknown): Response;  // HttpError → its status; ZodError → 400; else 500 (log it). Body: { error }
```

Every route handler: `try { … } catch (e) { return errorResponse(e); }`.

## Build steps

1. Create the Supabase project, run `schema.sql` (+ optionally `seed.example.sql`), put keys in `.env.local`.
2. `npm i @supabase/supabase-js server-only`.
3. Write `lib/db.ts` + `lib/http.ts`. Smoke test with a throwaway script (`npx tsx`) or temporary route: `loadCatalog()` returns categories/bundles; `listActiveListingViews(sessionId)` rows have no `floorPrice` key; `lockListing` twice from two session ids → true, false.
4. Edit a row in the Table Editor, call again, see the change immediately (proves no caching).
5. Hand B and C the function list above; they call nothing else.

## Done when

- [ ] `schema.sql` runs cleanly twice; `seed.example.sql` runs cleanly twice (5 categories, 1 bundle, 5 sellers, 26 listings).
- [ ] App code contains no category/bundle/seller/listing literals (grep for `"shoes"`, `"cycling"`, `"tom"` in `app/` and `lib/` finds nothing).
- [ ] `listActiveListingViews(sessionId)` → no row has `floorPrice`/`persona`/`busySessionId`; a sold listing is excluded; a listing locked by another session has `busy: true`, by this session `busy: false`.
- [ ] `getListingPrivate(id)` → has `floorPrice` and seller persona.
- [ ] `getRequest(id, otherSession)` → null.
- [ ] `lockListing` succeeds for session A, fails for session B until A releases or 2 min pass; A can refresh its own lock.
- [ ] `acceptNegotiation` sells only for the lock holder (clears the lock); after the lock lapsed and B took it → 409 "Deal expired"; wrong session → 404.
- [ ] `walkAwayNegotiation` clears the lock immediately.
- [ ] Anon key (if you try it) reads zero rows (RLS on).
