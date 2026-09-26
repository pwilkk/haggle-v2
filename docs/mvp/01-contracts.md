# 01 · Contracts: write first, then frozen

> **Status: FROZEN once hour 0 is over.** Every workstream codes against this file. To change a type, route, table or event shape: tell the other two first, change this doc in the same commit, fix every caller.

**Owner:** everyone, together in hour 0 (A types it up).
**Depends on:** nothing.
**Exposes:** `lib/schemas.ts` (types + app limits), the 4 API routes' request/response shapes, the listing busy lock, the NDJSON event format, the session rule and the privacy rule.

## 0. Conventions

- **No marketplace data in code.** Sellers, listings, categories (with required/optional fields) and bundles are rows in Supabase, loaded at request time (02). Code only contains *rules* (matching, negotiation limits, abuse caps). A category or bundle added in the DB works on the next chat message, no redeploy.
- Category and bundle ids are plain strings (`"shoes"`, `"cycling"`), validated against the rows loaded from the DB, not a TS enum.
- Money is **whole pounds (GBP) as integers** everywhere: DB, TS, prompts, UI. `Math.round` any LLM number before using it.
- Attribute keys are snake_case and must be one of the category's `required`/`optional` fields. Values are **lower-case trimmed strings** (`"8"`, `"black"`, `"nike"`).
- DB columns are snake_case; TS/JSON is camelCase. Mapping happens only in `lib/db.ts`.
- One item per category per request. Items are identified by `category`, never by array index.
- Every browser is an **anonymous buyer**: a random UUID `sessionId` kept in `localStorage` and sent in every request body. No accounts, no auth.
- **No chat history.** The conversation lives only in React state; a refresh starts a fresh chat, and "New chat" is a plain reset. The only thing in `localStorage` is the `sessionId` (for abuse caps and lock ownership). The client sends the full `messages` array each turn; the only server state is the `requests` / `negotiations` rows.
- **Budgets are per item.** Every included item gets its own `maxPrice`, bundles included (the agent asks "most you'd pay for the bike? the helmet? …"). No kit-level budget, no splitting.
- **One negotiation at a time**, always started by the user tapping **Negotiate** on a match card. No automatic or parallel negotiations.

## 1. Schemas and limits: `lib/schemas.ts`

Zod 4. Types are `z.infer` of these; don't hand-write duplicates.

```ts
import { z } from "zod";

// ---------- app rules (code, not data) ----------
export const MAX_TURNS = 6;                      // negotiation: total turns, seller opens, alternate
export const AUTO_AGREE_GAP = 2;                 // negotiation: £ gap that triggers split-the-difference
export const MAX_MESSAGE_CHARS = 500;            // abuse cap: one user message
export const MAX_MESSAGES = 30;                  // abuse cap: chat history length per request (≈15 user turns)
export const MAX_NEGOTIATIONS_PER_SESSION = 10;  // abuse cap: negotiations per sessionId

export const Id = z.string().min(1);
export const SessionId = z.uuid();
export const Price = z.number().int().positive();          // whole £
export const Attributes = z.record(z.string(), z.string());

// ---------- catalog (DB rows, public) ----------
export const Category = z.object({
  id: Id,                                         // "shoes"
  label: z.string(),                              // "Shoes"
  required: z.array(z.string()),                  // ["type","size","colour"]: asked for, and must match exactly
  optional: z.array(z.string()),                  // ["brand","model","condition"]: ranking only
});

export const Bundle = z.object({
  id: Id,                                         // "cycling"
  label: z.string(),                              // "Cycling starter kit"
  description: z.string(),                        // tells the agent when to use it + card subtitle
  categoryIds: z.array(Id),                       // ["bike","helmet","jacket","glasses"]
});

export const Catalog = z.object({ categories: z.array(Category), bundles: z.array(Bundle) });

// ---------- sellers (DB rows) ----------
export const Account = z.object({                 // every account row is a seller
  id: Id,                                         // "tom"
  name: z.string(),                               // "Tom"
  type: z.enum(["brand", "private"]),
  persona: z.string(),                            // negotiation style. Server-only (seller agent prompt).
});

// ---------- buyer request ----------
export const RequestItem = z.object({
  category: Id,
  included: z.boolean(),                          // false = user unticked it (bundle); ignored by match/ready
  attributes: Attributes,                         // gathered fields, normalised
  preferences: z.array(z.string()),               // nice-to-haves, lower-case, e.g. ["nike air max"]
  maxPrice: Price.nullable(),                     // PRIVATE (see §6). One per item, bundles too. null = not asked/answered yet
});

export const BuyerRequest = z.object({
  id: Id,
  sessionId: SessionId,
  bundle: Id.nullable(),                          // bundle id or null for a single-item request
  items: z.array(RequestItem),
  status: z.enum(["gathering", "ready"]),         // ready = every included item has required fields + maxPrice
});

export const MissingItem = z.object({
  category: Id,
  fields: z.array(z.string()),                    // attribute keys and/or "maxPrice"; included items only, non-empty only
});

// What the extraction LLM call returns (03). lib/request.ts validates it against the catalog.
export const IntakeDraft = z.object({
  bundle: z.string().nullable(),
  dropped: z.array(z.string()),                   // bundle items the user said they don't need ("I have a helmet")
  items: z.array(z.object({
    category: z.string(),
    attributes: Attributes,
    preferences: z.array(z.string()),
    maxPrice: z.number().nullable(),
  })),
});

// ---------- listings ----------
export const Listing = z.object({                 // SERVER-ONLY shape (has floorPrice)
  id: Id,
  sellerId: Id,
  category: Id,
  title: z.string(),                              // "Used Nike Air Max 90, black, UK 8"
  attributes: Attributes,
  askingPrice: Price,
  floorPrice: Price,                              // PRIVATE (see §6)
  status: z.enum(["active", "sold"]),
});

export const ListingView = Listing.omit({ floorPrice: true }).extend({   // safe for the browser
  sellerName: z.string(),
  sellerType: z.enum(["brand", "private"]),
  busy: z.boolean(),                              // locked by ANOTHER session's live negotiation (§5). Lock owner id never exposed
});

export const MatchCard = ListingView.extend({
  overBudget: z.boolean(),                        // askingPrice > maxPrice * STRETCH (04)
  matchedPreferences: z.array(z.string()),
});

export const ItemMatches = z.object({ category: Id, listings: z.array(MatchCard) });  // ranked, max 5, may be empty

// ---------- negotiation ----------
export const Side = z.enum(["buyer_agent", "seller_agent"]);

export const AgentMove = z.object({               // what an agent (LLM or test stub) proposes
  action: z.enum(["offer", "accept"]),
  price: z.number().nullable(),                   // ignored for accept; null offer = hold previous price
  message: z.string(),
});

export const Offer = z.object({                   // what the code records after enforcing limits
  from: Side,
  action: z.enum(["offer", "accept"]),
  price: Price,                                   // always set; for accept = the other side's last price
  message: z.string(),
});

export const NegotiationStatus = z.enum(["running", "agreed", "failed", "accepted"]);
export const EndReason = z.enum(["accepted", "crossed", "midpoint", "max_turns"]);

export const Negotiation = z.object({
  id: Id,
  sessionId: SessionId,
  requestId: Id,
  category: Id,
  listingId: Id,
  turns: z.array(Offer),
  status: NegotiationStatus,
  finalPrice: Price.nullable(),
});

// ---------- API bodies ----------
export const ChatMessage = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(4000),                  // user messages additionally capped at MAX_MESSAGE_CHARS in the route
});

export const ChatBody = z.object({
  sessionId: SessionId,
  requestId: Id.nullable(),                       // null on the first message of a chat
  messages: z.array(ChatMessage).min(1),        // full text history; last = new user message. Route: > MAX_MESSAGES → 429
  excluded: z.array(Id).default([]),              // bundle rows the user unticked
});

export const ChatResponse = z.object({
  requestId: Id,
  reply: z.string(),                              // agent text bubble
  request: BuyerRequest,                          // owner's own view, includes maxPrice (see §6)
  missing: z.array(MissingItem),
  catalog: z.object({                             // labels/fields the UI needs to render this request
    categories: z.array(Category),                // only the categories used by request.items
    bundle: Bundle.nullable(),
  }),
  matches: z.array(ItemMatches).nullable(),       // non-null only when (re)matched this turn
  sellersAsked: z.number().int().nullable(),      // distinct sellers with active listings in the included categories; with matches
});

export const NegotiateBody = z.object({ sessionId: SessionId, requestId: Id, category: Id, listingId: Id });

export const NegotiationEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start"), negotiationId: Id, listing: ListingView }),
  z.object({ type: z.literal("turn"), n: z.number().int(), offer: Offer }),   // n = 1..MAX_TURNS
  z.object({ type: z.literal("end"), status: z.enum(["agreed", "failed"]), finalPrice: Price.nullable(), reason: EndReason }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);

export const AcceptBody = z.object({ sessionId: SessionId, negotiationId: Id });
export const WalkAwayBody = z.object({ sessionId: SessionId, negotiationId: Id });
export const WalkAwayResponse = z.object({ ok: z.literal(true) });
export const AcceptResponse = z.object({
  negotiationId: Id,
  status: z.literal("accepted"),
  finalPrice: Price,
  listing: ListingView,                           // status now "sold"
});

export const ApiError = z.object({ error: z.string() });

// export type X = z.infer<typeof X> for every schema above (Category, Bundle, Catalog, Account, RequestItem,
// BuyerRequest, MissingItem, IntakeDraft, Listing, ListingView, MatchCard, ItemMatches, Side, AgentMove, Offer,
// EndReason, Negotiation, ChatMessage, ChatBody, ChatResponse, NegotiateBody, NegotiationEvent, AcceptBody, AcceptResponse,
// WalkAwayBody, WalkAwayResponse).
```

## 2. Database tables (full SQL in 02)

| Table | Columns | Written by |
|---|---|---|
| `categories` | `id, label, required text[], optional text[]` | humans (07) |
| `bundles` | `id, label, description, category_ids text[]` | humans (07) |
| `accounts` | `id, name, type ('brand'\|'private'), persona` (sellers only) | humans (07) |
| `listings` | `id, seller_id, category, title, attributes jsonb, asking_price, floor_price, status ('active'\|'sold'), busy_until, busy_session_id, created_at` | humans (07); `status` by `/api/accept`; busy lock by `/api/negotiate`, `/api/accept`, `/api/walk-away` |
| `requests` | `id, session_id, bundle, items jsonb, status, created_at, updated_at` | `/api/chat` |
| `negotiations` | `id, session_id, request_id, category, listing_id, turns jsonb, status, final_price, created_at, updated_at` | `/api/negotiate`, `/api/accept` |

## 3. API routes

Four routes, all `POST`, JSON bodies validated with the schemas above. Errors are always `{ error: string }`:
`400` bad body / message too long · `404` unknown id **or not owned by this sessionId** · `409` wrong state (listing sold, listing busy, deal expired, negotiation not agreed) · `429` abuse cap hit · `502` LLM failed after retry · `500` anything else.

| Route | Body | Success | Owner |
|---|---|---|---|
| `POST /api/chat` | `ChatBody` | `200 ChatResponse` | B (03) |
| `POST /api/negotiate` | `NegotiateBody` | `200` stream, `Content-Type: application/x-ndjson`, lines of `NegotiationEvent` | B (05) |
| `POST /api/accept` | `AcceptBody` | `200 AcceptResponse` | A (05) |
| `POST /api/walk-away` | `WalkAwayBody` | `200 WalkAwayResponse` | A (05) |

No GET routes. The browser never talks to Supabase. All routes read the DB **live on every request** (no caching, see 00 "Live data").

### Example `POST /api/chat` response (second turn of a shoes chat, example seed data)

```json
{
  "requestId": "3f0c…",
  "reply": "Found 3 matches. Tom's pair is the closest fit, and I think he'll come down.",
  "request": {
    "id": "3f0c…", "sessionId": "b7e2…", "bundle": null, "status": "ready",
    "items": [{ "category": "shoes", "included": true,
      "attributes": { "type": "sport", "colour": "black", "size": "8" },
      "preferences": ["nike air max"], "maxPrice": 80 }]
  },
  "missing": [],
  "catalog": { "categories": [{ "id": "shoes", "label": "Shoes", "required": ["type","size","colour"], "optional": ["brand","model","condition"] }], "bundle": null },
  "sellersAsked": 4,
  "matches": [{ "category": "shoes", "listings": [
    { "id": "l-tom-am90-8", "sellerId": "tom", "sellerName": "Tom", "sellerType": "private", "category": "shoes",
      "title": "Used Nike Air Max 90, black, UK 8", "askingPrice": 90, "status": "active",
      "attributes": { "type": "sport", "size": "8", "colour": "black", "brand": "nike", "model": "air max 90", "condition": "used" },
      "busy": false, "overBudget": false, "matchedPreferences": ["nike air max"] },
    { "id": "l-nike-am90-8", "sellerName": "Nike Store", "sellerType": "brand", "askingPrice": 120, "overBudget": true, "…": "…" },
    { "id": "l-anna-ultraboost-8", "sellerName": "Anna", "sellerType": "private", "askingPrice": 85, "overBudget": false, "…": "…" }
  ]}]
}
```

## 4. NDJSON event stream (`POST /api/negotiate`)

One JSON object per line, `\n`-terminated, in order: exactly one `start`, then 1–6 `turn`, then exactly one `end` **or** one `error`. The client must tolerate a last chunk without a trailing newline.

```
{"type":"start","negotiationId":"9a1…","listing":{"id":"l-tom-am90-8","title":"Used Nike Air Max 90, black, UK 8","sellerName":"Tom","sellerType":"private","askingPrice":90,"…":"…"}}
{"type":"turn","n":1,"offer":{"from":"seller_agent","action":"offer","price":90,"message":"Asking £90, barely worn."}}
{"type":"turn","n":2,"offer":{"from":"buyer_agent","action":"offer","price":68,"message":"Similar pairs go for less. I can do £68."}}
{"type":"turn","n":3,"offer":{"from":"seller_agent","action":"offer","price":79,"message":"Original box included. £79."}}
{"type":"turn","n":4,"offer":{"from":"buyer_agent","action":"offer","price":74,"message":"Meet me at £74 and we're done."}}
{"type":"turn","n":5,"offer":{"from":"seller_agent","action":"accept","price":74,"message":"Deal at £74."}}
{"type":"end","status":"agreed","finalPrice":74,"reason":"accepted"}
```

`reason`: `accepted` (a side accepted the other's last price, within both limits) · `crossed` (an offer met or passed the other side's last price) · `midpoint` (prices within £2, split the difference) · `max_turns` (6 turns without a deal → `failed`).

If the loop crashes after `start`, the server sends one `{"type":"error","message":"…"}` instead of `end` and marks the row `failed`. Errors before the stream starts (bad body, unknown/not-owned id, listing sold, cap hit) are normal JSON `4xx { error }` responses.

## 5. Status lifecycles

- `requests.status`: `gathering` → `ready` (drops back to `gathering` if a change leaves a field missing).
- `negotiations.status`: `running` → `agreed` | `failed`; `agreed` → `accepted` via `/api/accept`, or → `failed` via `/api/walk-away`.
- **Listing busy lock** (per listing, not per seller). Tapping **Negotiate** does one atomic update: set `busy_until = now() + 2 min`, `busy_session_id = sessionId` **only where** `status = 'active'` and (`busy_until is null` or `busy_until < now()` or it's already this session's lock). No row updated → `409 { error: "Listing busy" }` and nothing else happens. Lifecycle:
  - negotiation ends `failed` (or crashes) → the negotiate route releases the lock;
  - ends `agreed` → the route refreshes the lock to `now() + 2 min`, held for this session to decide;
  - **Accept** → sells only if `busy_session_id = sessionId` (and still `active`), clearing the lock; otherwise `409 { error: "Deal expired" }` (the lock lapsed and another session took it);
  - **Walk away** → `/api/walk-away` releases the lock and marks the negotiation `failed`;
  - anything else (tab closed, function killed) → the lock simply expires after 2 minutes.
  Busy listings still appear in matches with `busy: true`; the UI marks them "Busy". Because only the lock holder can negotiate and accept, two visitors can never both reach a deal on the same listing.
- `listings.status`: `active` → `sold` via `/api/accept`. **Sold is final, for every visitor** (shared catalogue): nothing sets it back to `active`. Supply is replenished by inserting new listings/sellers in the DB (07). No demo-mode toggle.

## 6. Session and privacy rules (everyone, every file)

**Session.** `sessionId` is a client-generated UUID. Every row in `requests`/`negotiations` stores it. A route that loads a request or negotiation must check `row.sessionId === body.sessionId` and answer `404` otherwise. It is not a secret or auth, just a partition key so visitors don't see each other's requests.

**Privacy.**
- `floorPrice` never leaves the server except inside the **seller agent's** prompt. Never in a `ListingView`, API response, NDJSON event, or the buyer agent's prompt.
- `maxPrice` never leaves the server except inside the **buyer agent's** prompt and the owning session's own `ChatResponse.request` (the visitor sees their own budget on the request card). Never in the seller agent's prompt, listing data, or NDJSON events.
- `persona` is server-only (seller agent prompt). `busy_session_id` is server-only (the browser only sees `busy: boolean`).
- Only `lib/db.ts` reads `floor_price`/`persona`, and only in `getListingPrivate()`, used only by `/api/negotiate`.
- The negotiation engine enforces the split in code: the buyer agent function receives a view without `floorPrice`; the seller agent function receives a view without `maxPrice` (tested in 05).
- The only thing that crosses sides is **offered prices and messages**. (A seller clamped at its floor reveals it by offering it; that's negotiation, not a leak.)
