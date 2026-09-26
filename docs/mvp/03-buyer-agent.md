# 03 · Buyer agent: intake chat and `POST /api/chat`

**Owner:** Workstream B (`lib/llm.ts`, `lib/agents/buyer.ts`, `app/api/chat/route.ts`). Workstream A owns `lib/request.ts` (pure logic, specified here) and its tests.
**Depends on:** 01 (schemas), 02 (`loadCatalog`, `listActiveListingViews`, `getRequest`, `saveRequest`), 04 (`match`).
**Exposes:** `POST /api/chat` (`ChatBody` → `ChatResponse`); `lib/llm.ts` (`MODEL`, `llm`, `completeJSON`, `completeText`) also used by 05.

## What it does

Turns "I want black sport shoes" or "I want to start cycling" into a structured `BuyerRequest`, asking **only for missing required fields and the budget**, using whatever categories and bundles are in the DB right now. When every ticked item is complete it runs the matcher and returns match cards in the same response.

Design: the request is **re-derived every turn** from the full transcript (+ previous draft for stability) by one JSON extraction call; code then validates it against the live catalogue, computes what's missing, and decides whether to match; a second call writes the short reply. Missing-field logic is code, not prompt.

```
POST /api/chat
  ├─ caps: last message is user and ≤ MAX_MESSAGE_CHARS (else 400); messages ≤ MAX_MESSAGES (else 429)
  ├─ [catalog, listings, prev] = loadCatalog(), listActiveListingViews(sessionId), getRequest(requestId, sessionId)   ← live, every turn
  ├─ vocab   = fieldVocab(catalog, listings)                      (A, request.ts)
  ├─ draft   = extractDraft(messages, catalog, vocab, prev)       (B, buyer.ts, completeJSON, temp 0)
  ├─ {request, missing} = buildRequest(draft, ctx)                (A, request.ts)
  ├─ saved   = saveRequest(request)
  ├─ if shouldMatch(prev, saved): matches = included items → match(item, category, listings); sellersAsked
  ├─ reply   = writeReply(...)                                    (B, buyer.ts, completeText)
  └─ 200 ChatResponse
```

## `lib/llm.ts` (B), port from the previous repo

**Reuse note:** the previous repo's `lib/llm.ts` already worked against xAI (OpenAI client with `baseURL` pointed at xAI, a small tool-calling loop `runAgent`, and `completeJSON` using `response_format: { type: "json_object" }`). Port the client and `completeJSON`; add `completeText`. `runAgent` isn't needed by this MVP (no tools); don't port it unless you find a use.

```ts
import OpenAI from "openai";
export const MODEL = process.env.XAI_MODEL || "grok-4.7";          // the ONLY place the model id lives
export const llm = new OpenAI({
  apiKey: process.env.XAI_API_KEY,
  baseURL: process.env.XAI_BASE_URL || "https://api.x.ai/v1",
  timeout: 20_000, maxRetries: 1,
});

export async function completeJSON<T>(schema: z.ZodType<T>, messages: ChatCompletionMessageParam[],
  opts?: { temperature?: number }): Promise<T>;
  // temperature default 0; response_format json_object; JSON.parse + schema.safeParse;
  // on parse/validation failure retry ONCE with the Zod error appended as a user message; then throw HttpError(502).
  // The prompt must say "JSON" and show the shape: use z.toJSONSchema(schema) (Zod 4).

export async function completeText(messages: ChatCompletionMessageParam[], opts?: { temperature?: number }): Promise<string>;
  // default temperature 0.3, trimmed content; throw HttpError(502) on failure.
```

If the model rejects `temperature`, drop the param inside `llm.ts` (one place). `npm i openai zod`.

## `lib/request.ts` (A), pure, no I/O, unit-tested

```ts
export type Vocab = Record<string, Record<string, string[]>>;   // categoryId → field → known values

export function fieldVocab(catalog: Catalog, listings: ListingView[]): Vocab;
  // distinct lower-case values per (category, required|optional field) across active listings, max 15 per field, sorted.

export function buildRequest(draft: IntakeDraft, ctx: {
  catalog: Catalog; excluded: string[]; prev: BuyerRequest | null; sessionId: string;
}): { request: Omit<BuyerRequest, "id"> & { id: string | null }; missing: MissingItem[] };

export function shouldMatch(prev: BuyerRequest | null, next: BuyerRequest): boolean;
  // next.status === "ready" && (prev?.status !== "ready" || JSON of prev's included items !== next's)

```

`buildRequest` rules, in order:
1. **Bundle:** `draft.bundle` if it's an id in `catalog.bundles`, else `prev?.bundle` (sticky), else `null`.
2. **Items:** drop items whose category isn't in `catalog.categories`; dedupe by category (last wins). If a bundle is set: add an empty item for every `bundle.categoryIds` entry that's missing, order items by the bundle's order, append any extra items after.
3. **Attributes:** keep only keys in that category's `required ∪ optional`; values `String(v).trim().toLowerCase()`; drop empty strings.
4. **Preferences:** trim, lower-case, dedupe.
5. **Included:** `false` if the category is in `ctx.excluded ∪ draft.dropped`, else `true`.
6. **maxPrice:** `Math.round(draft maxPrice)` if > 0, else `null`. One budget **per item**, bundles included. There is no kit budget and no splitting: if the shopper gives one total for several items, `maxPrice` stays `null` and the reply asks per item.
7. **Missing:** for each included item, `required` keys not in attributes, plus `"maxPrice"` if null. Only non-empty entries.
8. **Status:** `ready` iff ≥ 1 included item and `missing` is empty; else `gathering`.

Tests (`tests/request.test.ts`, fixture catalogue in `tests/fixtures.ts`, not the seed):

| Case | Expect |
|---|---|
| Draft with unknown category `"boats"` | item dropped |
| Attribute not in the category's fields (`"flavour"`) | dropped; `"Black"` → `"black"`, `8` → `"8"` |
| Draft names a bundle but lists only 1 item | all bundle categories present, in bundle order |
| `excluded: ["jacket"]` | jacket `included:false`, not in `missing`, doesn't block `ready` |
| `draft.dropped: ["helmet"]` | helmet `included:false` |
| Bundle, bike has maxPrice 500, others none | bike complete on budget; helmet/jacket/glasses each list `"maxPrice"` in `missing` |
| Bundle, every ticked item has fields + its own maxPrice | `status:"ready"` |
| All required + maxPrice present | `status:"ready"`, `missing: []` |
| Previous ready, same items again | `shouldMatch` false; change a size → true |
| Unknown bundle id, prev had a bundle | keeps prev bundle |

## `lib/agents/buyer.ts` (B)

```ts
export async function extractDraft(a: { messages: ChatMessage[]; catalog: Catalog; vocab: Vocab; prev: BuyerRequest | null }): Promise<IntakeDraft>;
export async function writeReply(a: {
  messages: ChatMessage[]; request: BuyerRequest; missing: MissingItem[]; catalog: Catalog; vocab: Vocab;
  matches: ItemMatches[] | null; firstBundleTurn: boolean;          // prev?.bundle == null && request.bundle != null
}): Promise<string>;
```

### Extraction prompt (system), `completeJSON(IntakeDraft, …, { temperature: 0 })`

```
You turn a shopper's chat into a structured shopping request for a UK marketplace.
Reply with JSON only, matching this JSON schema: {IntakeDraft JSON schema}

You get: CATALOG (categories with required/optional fields, bundles with descriptions),
KNOWN_VALUES (values that exist in current listings, per category and field),
PREVIOUS (last draft, may be null) and the CONVERSATION.

Rules:
- Use only category ids and bundle ids from CATALOG. If the shopper wants something not in CATALOG, leave it out.
- If the shopper's goal fits a bundle description, set "bundle" to its id and add one item per bundle category.
- Fill a field only if the shopper said it, or it is unambiguous from what they said
  (a named product that clearly implies a known value, or a standard conversion such as height → frame size
  or "UK 8" → "8"). Otherwise leave it out. Never guess.
- Prefer the exact spelling of a KNOWN_VALUE when the shopper means it. Otherwise lower-case their words.
- Only use field names from that category's required/optional lists.
- "ideally X", "preferably X", "would love X" → preferences. Hard requirements on optional fields → attributes.
- Money in whole pounds. "under £80", "max 80", "up to 80" → maxPrice of that item. Each item has its own maxPrice.
  A single total for several items ("£800 for everything") is NOT a per-item budget: leave those maxPrice values null.
- "dropped": bundle categories the shopper says they already have or don't need.
- Keep everything from PREVIOUS unless the shopper changed it.
```

User message: `CATALOG: {json}\nKNOWN_VALUES: {json}\nPREVIOUS: {json|null}\nCONVERSATION:\nuser: …\nassistant: …`.

The extraction step never sees listings' prices, sellers or floors; it doesn't need them.

### Reply prompt (system), `completeText(…, { temperature: 0.3 })`

```
You are the shopper's own buying agent in a UK marketplace. Write your next chat message.
Keep it short (max 60 words), friendly, UK English, prices in £. Plain text; a numbered list is OK. No JSON, no field ids.

You get STATE (the request: bundle, items with labels, filled fields, what's MISSING), KNOWN_VALUES, and MATCHES (or null).

- If something is MISSING: ask only for that.
  - Single item: at most 2 questions in one message ("Two quick questions: what's your UK shoe size, and what's the most you'd pay?").
  - Bundle, first time (FIRST_BUNDLE_TURN=true): one intro line ("Here's a starter kit most people need. Untick anything you already have.")
    then "To find the right matches I just need:" and a numbered list, one line per ticked item that needs something,
    including its budget ("Bike: road, gravel or hybrid, your frame size, and the most you'd pay?").
  - If the shopper gave one total for the whole bundle, thank them and ask how much of it for each item.
  - Offer 2-3 example options from KNOWN_VALUES where it helps ("road, gravel or hybrid").
- If MATCHES is non-empty: "Found N matches." then one sentence on the best one (seller name + why). For bundles, one line per item.
- If MATCHES is empty: say nothing matched and suggest one change (budget, size or colour).
- If the shopper asks for something that isn't in CATALOG: say so and list what categories you can help with.
- Never promise a price, never mention sellers' lowest prices (you don't know them).
```

User message: `STATE: {request + labels + missing}\nKNOWN_VALUES: {json}\nMATCHES: {titles, sellerName, askingPrice, overBudget per item | null}\nFIRST_BUNDLE_TURN: …\nCONVERSATION: …`. The reply call may see the buyer's own budget; it never sees any floor price (listing views don't carry one).

## `app/api/chat/route.ts` (B)

Step by step:
1. `ChatBody.parse(await req.json())`. Last message must be `role:"user"` and `content.length ≤ MAX_MESSAGE_CHARS` → else 400. `messages.length > MAX_MESSAGES` → 429 "This chat is full, start a new one".
2. `Promise.all([loadCatalog(), listActiveListingViews(sessionId), requestId ? getRequest(requestId, sessionId) : null])`. A `requestId` that doesn't exist for this session is treated as a new request (not an error).
3. Empty catalogue (`catalog.categories.length === 0`): skip the LLM, save an empty request (`items: []`, `status:"gathering"`) and return it with reply "The marketplace is empty right now, check back soon."
4. `extractDraft` → `buildRequest` → `saveRequest`.
5. If `shouldMatch(prev, saved)`: for each included item, `match(item, category, listings)` (04) → `ItemMatches[]`; `sellersAsked` = distinct `sellerId` among active listings in the included categories.
6. `writeReply`.
7. Return `ChatResponse` with `catalog = { categories: those used by request.items, bundle: the bundle row or null }`.
8. Wrap everything in `try/catch → errorResponse(e)`. LLM failure after retry → 502; the UI shows a retry bubble.

No caching anywhere: it's a POST handler, it reads via `lib/db.ts` every call; don't add `use cache`.

## Build notes

1. Hour 1: port `lib/llm.ts`, run one `completeJSON` call from a scratch script to prove the key/model work.
2. Write `extractDraft` against a hand-written catalogue JSON first; check a handful of inputs by eye.
3. Until A's `request.ts` and `match.ts` land, stub `buildRequest` (pass-through) and `match` (return `[]`).
4. Wire the route; test with `curl -N -X POST localhost:3000/api/chat -H 'content-type: application/json' -d '{"sessionId":"<uuid>","requestId":null,"messages":[{"role":"user","content":"I want black sport shoes"}]}'`.
5. Add a category + bundle in Supabase (07) and confirm the next message uses it without a restart.

## Done when

With the example seed loaded (manual checks; automated tests use fixtures):
- [ ] "I want black sport shoes" → reply asks for size and budget only; request card shows shoes/sport/black with `missing: size, maxPrice`.
- [ ] "Size 8, under £80, ideally Air Max" → `status:"ready"`, `preferences:["air max"]` or similar, `matches` returned (3 listings), `sellersAsked: 4`.
- [ ] "Black shoes, size 8, ideally Nike Air Max under £100" → asks only for type (or infers sport from the model if unambiguous).
- [ ] "I want to start cycling" → `bundle:"cycling"`, 4 items, numbered questions per item covering missing fields and that item's budget.
- [ ] "£800 for the lot" → no item gets a maxPrice; the reply asks for a budget per item.
- [ ] Unticking an item (via `excluded`) removes it from `missing` and from matching.
- [ ] A new category/bundle inserted in Supabase is used on the very next message.
- [ ] Message of 501 chars → 400; 31st message → 429; another session's `requestId` → treated as a new request.
- [ ] `tests/request.test.ts` green.
