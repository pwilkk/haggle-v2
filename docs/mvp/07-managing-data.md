# 07 · Managing data: sellers, listings, categories, bundles

**Owner:** Workstream A (writes the doc and the health-check queries); used by anyone curating the live marketplace.
**Depends on:** 02 (schema).
**Exposes:** the procedures and SQL below. No code, no admin UI.

## The one rule

**All marketplace data is edited directly in Supabase** (Table Editor or SQL editor) on the live project. There is no admin UI, no redeploy, no code change. Every API route reads the DB on every request with no caching, so an edit shows up on the **next chat message** (an open chat picks it up on its next turn).

What needs code instead: negotiation rules, matching rules, abuse caps, UI. What never needs code: new sellers, listings, categories, fields, bundles, prices, personas.

## Data conventions (the app relies on these)

| Thing | Rule |
|---|---|
| Ids | Short lower-case slugs for `categories`, `bundles`, `accounts` (`'running-shoes'`, `'nike-store'`). Listing ids can be anything; omit to get a UUID. |
| Money | Whole pounds, integers. `floor_price ≤ asking_price` (enforced). |
| `floor_price` | The seller's private lowest price. Never shown to buyers; only the seller agent sees it. |
| `persona` | Free text that sets the seller agent's tone and pace. "wants a quick sale" / "flexible" → concedes fast; "firm on price" → small steps. |
| `categories.required` | Fields the buyer agent asks for **and** that must match a listing exactly. Keep it to 1–3 fields. `'{}'` is allowed (everything in the category matches on budget). |
| `categories.optional` | Fields used only for ranking (brand, model, condition…). |
| `listings.attributes` | JSON object. Keys = the category's field names, spelled exactly (`colour` ≠ `color`). Values = lower-case strings (`"8"`, `"black"`). The app lower-cases anyway, but keep it tidy. **Every required field must be present or the listing never matches.** Extra keys (e.g. `condition` on glasses) are harmless and show as chips. |
| `bundles.description` | Plain sentence the buyer agent uses to decide when a goal is this bundle ("For someone who wants to start running…"). Also shown on the checklist card. |
| `bundles.category_ids` | Array of category ids, in display order. Unknown ids are ignored. |
| `listings.status` | `active` or `sold`. **Sold is final** (below). |
| `listings.busy_until`, `busy_session_id` | The app's busy lock (below). Leave them empty when inserting; don't edit by hand except to clear a stuck lock. |

## Sold is final

When a visitor clicks **Accept deal**, `/api/accept` sets that listing to `sold`, permanently, for everyone. Nothing sets it back to `active` and there is no demo mode. To keep the marketplace stocked, **insert new listings** (or new sellers). The example seed never re-activates sold rows either (`on conflict do nothing`).

## Busy lock

When a visitor taps **Negotiate**, the app sets `busy_until` (now + 2 min) and `busy_session_id` on that listing so nobody else can haggle for it at the same time. The lock is cleared when the negotiation fails, the visitor walks away or accepts, and otherwise just expires. Busy listings still show in other visitors' matches, marked "Busy". You never need to touch these columns; if you want to free a listing right away:

```sql
update listings set busy_until = null, busy_session_id = null where id = 'l-tom-am90-8';

-- Listings currently busy
select id, title, busy_until from listings where busy_until > now();
```

## Table Editor (no SQL)

1. Supabase dashboard → **Table Editor** → pick the table → **Insert row**.
2. Arrays (`required`, `optional`, `category_ids`): enter as `{type,size,colour}`.
3. JSON (`attributes`): `{"type":"sport","size":"8","colour":"black"}`.
4. Save. Send a chat message in the app: the change is live.

Insert order when starting from scratch: `categories` → `accounts` → `listings` (listings reference both) → `bundles`.

## SQL recipes (SQL editor)

### Sellers

```sql
-- Add a seller
insert into accounts (id, name, type, persona) values
  ('sole-swap', 'Sole Swap', 'private', 'Student clearing out trainers before moving. Wants a quick sale, very flexible.');

-- Change a seller's negotiation style (takes effect on the next negotiation)
update accounts set persona = 'Firm on price, only small discounts, mentions original receipt.' where id = 'sole-swap';

-- Remove a seller AND all their listings (and those listings' negotiations): cascades
delete from accounts where id = 'sole-swap';
```

### Listings

```sql
-- Add one listing
insert into listings (seller_id, category, title, attributes, asking_price, floor_price) values
  ('sole-swap', 'shoes', 'Used Nike Air Max 90, black, UK 8',
   '{"type":"sport","size":"8","colour":"black","brand":"nike","model":"air max 90","condition":"used"}', 85, 65);

-- Add several at once
insert into listings (seller_id, category, title, attributes, asking_price, floor_price) values
  ('sole-swap', 'shoes', 'Used Adidas Samba, white, UK 9', '{"type":"casual","size":"9","colour":"white","brand":"adidas","condition":"used"}', 60, 45),
  ('sole-swap', 'shoes', 'Used Nike Pegasus, black, UK 8', '{"type":"sport","size":"8","colour":"black","brand":"nike","condition":"used"}', 50, 38);

-- Reprice (floor must stay ≤ asking)
update listings set asking_price = 95, floor_price = 72 where id = 'l-tom-am90-8';

-- Restock: re-list a copy of a sold item as a NEW listing (new id; the sold one stays sold)
insert into listings (seller_id, category, title, attributes, asking_price, floor_price)
select seller_id, category, title, attributes, asking_price, floor_price
from listings where id = 'l-tom-am90-8';

-- Withdraw a listing that was never sold: delete it (its negotiations cascade)
delete from listings where id = 'l-adidas-samba-8';
```

### Categories and fields

```sql
-- New category: works in chat immediately (the agent asks for 'size' and 'colour'), once it has listings
insert into categories (id, label, required, optional) values
  ('backpack', 'Backpack', '{size,colour}', '{brand,condition}');

insert into listings (seller_id, category, title, attributes, asking_price, floor_price) values
  ('cycle-hub', 'backpack', 'Osprey commuter backpack, 20L, black', '{"size":"20l","colour":"black","brand":"osprey","condition":"new"}', 90, 75);

-- Add an optional field (safe: ranking only)
update categories set optional = array_append(optional, 'material') where id = 'shoes';

-- Add a REQUIRED field (careful: active listings without it stop matching until you fill it in)
update categories set required = array_append(required, 'width') where id = 'shoes';
update listings set attributes = attributes || '{"width":"regular"}' where category = 'shoes';

-- Remove a field
update categories set required = array_remove(required, 'width') where id = 'shoes';

-- Rename a category id (listings follow via ON UPDATE CASCADE; fix bundles by hand)
update categories set id = 'trainers', label = 'Trainers' where id = 'shoes';
update bundles set category_ids = array_replace(category_ids, 'shoes', 'trainers');

-- Delete a category: delete or move its listings first (FK), then
delete from categories where id = 'backpack';
```

### Bundles

```sql
-- New bundle: "I want to start running" now expands to these items
insert into bundles (id, label, description, category_ids) values
  ('running', 'Running starter kit',
   'For someone who wants to start running / take up jogging: running shoes, jacket and glasses.',
   '{shoes,jacket,glasses}');

-- Add / remove an item
update bundles set category_ids = array_append(category_ids, 'backpack') where id = 'cycling';
update bundles set category_ids = array_remove(category_ids, 'glasses')  where id = 'cycling';

-- Delete a bundle (existing chats keep their items; new chats no longer expand)
delete from bundles where id = 'running';
```

The shopper gives a budget per ticked bundle item (03); there are no budget weights to maintain. Stock each bundle category with a realistic spread of prices.

## Health checks (run after bulk edits)

```sql
-- Active listings missing a required field (these can never match)
select l.id, l.title, r.key as missing_field
from listings l
join categories c on c.id = l.category
cross join lateral unnest(c.required) as r(key)
where l.status = 'active' and coalesce(l.attributes ->> r.key, '') = '';

-- Attribute keys that aren't fields of the category (usually typos like "color")
select l.id, k.key
from listings l
join categories c on c.id = l.category
cross join lateral jsonb_object_keys(l.attributes) as k(key)
where not (k.key = any (c.required || c.optional));

-- Bundles pointing at categories that don't exist
select b.id, x.cat
from bundles b cross join lateral unnest(b.category_ids) as x(cat)
where not exists (select 1 from categories c where c.id = x.cat);

-- Supply per category (restock when active runs low)
select category,
       count(*) filter (where status = 'active') as active,
       count(*) filter (where status = 'sold')   as sold
from listings group by category order by category;

-- Recent deals
select n.updated_at, l.title, a.name as seller, l.asking_price, n.final_price
from negotiations n
join listings l on l.id = n.listing_id
join accounts a on a.id = l.seller_id
where n.status = 'accepted'
order by n.updated_at desc limit 20;
```

## Housekeeping

```sql
-- Drop old chat state (negotiations cascade). Catalogue data is untouched.
delete from requests where created_at < now() - interval '7 days';
```

**Full wipe (dev projects only, destroys everything incl. sold history):**

```sql
truncate table negotiations, requests, listings, bundles, accounts, categories cascade;
-- then optionally re-run supabase/seed.example.sql
```

## Done when

- [ ] Someone who hasn't read the code can add a seller + listing in the Table Editor and see it in the app's matches on their next message.
- [ ] A new category and a new bundle inserted by SQL are used by the buyer agent on the next message, no redeploy.
- [ ] Health-check queries return no rows on the live project.
