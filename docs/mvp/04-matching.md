# 04 · Matching: `lib/match.ts`

**Owner:** Workstream A.
**Depends on:** 01 (`RequestItem`, `Category`, `ListingView`, `MatchCard`). Test fixtures in `tests/fixtures.ts`.
**Exposes:** `match(item, category, listings): MatchCard[]` and the constants `STRETCH`, `SHOW_STRETCH`, `TOP_N`. Called by `/api/chat` (03).

Pure function. No LLM, no DB, no I/O. The route passes in the live category row and the live active listings, so a category or listing added in Supabase is matched on the next chat message.

## Rules

```ts
export const STRETCH = 1.3;       // negotiation room: above maxPrice × 1.3 the card is tagged "Over budget"
export const SHOW_STRETCH = 1.5;  // hard filter: listings above maxPrice × 1.5 are not shown at all
export const TOP_N = 5;

export function match(item: RequestItem, category: Category, listings: ListingView[]): MatchCard[];
```

1. If `item.maxPrice === null` or `!item.included` → `[]`.
2. Keep listings with `listing.category === category.id` and `status === "active"`.
3. **Required attributes:** for every key in `category.required`, `norm(item.attributes[key])` is non-empty and equals `norm(listing.attributes[key])`. `norm = v => String(v ?? "").trim().toLowerCase()`. A listing missing a required attribute never matches (07 has a query to find those).
4. **Price:** `askingPrice <= maxPrice × SHOW_STRETCH`.
5. **Score** = optional hits + preference hits:
   - optional hit: key in `category.optional`, the request has it, and `norm` equals the listing's.
   - preference hit: `norm(preference)` is a substring of `haystack = norm(title + " " + Object.values(attributes).join(" "))` with whitespace collapsed. Collect these as `matchedPreferences` (original preference strings).
6. **Rank:** score desc, then `askingPrice` asc, then `id` asc (stable).
7. Return the top `TOP_N` as `MatchCard = { ...listing, overBudget: askingPrice > maxPrice × STRETCH, matchedPreferences }`.

Input is `ListingView[]` (already stripped of `floorPrice` by `lib/db.ts`), so the matcher can't leak a floor even by accident. `busy` is ignored: busy listings are matched and ranked normally and carried through on the card (the UI marks them "Busy").

> **Confirmed decision (differs from the original spec).** The original rule was a hard filter at `askingPrice <= maxPrice × 1.3`, which would hide the £120 brand listing for an £80 budget that the approved mock shows with an "Over budget" tag. Agreed: show up to **1.5×**, tag **"Over budget" above 1.3×**.

Reference sketch (for precision; write your own):

```ts
const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");

export function match(item: RequestItem, category: Category, listings: ListingView[]): MatchCard[] {
  if (!item.included || item.maxPrice === null) return [];
  const max = item.maxPrice;
  return listings
    .filter(l => l.category === category.id && l.status === "active")
    .filter(l => category.required.every(k => norm(item.attributes[k]) !== "" && norm(item.attributes[k]) === norm(l.attributes[k])))
    .filter(l => l.askingPrice <= max * SHOW_STRETCH)
    .map(l => {
      const hay = norm(`${l.title} ${Object.values(l.attributes).join(" ")}`);
      const matchedPreferences = item.preferences.filter(p => norm(p) && hay.includes(norm(p)));
      const optionalHits = category.optional.filter(k => norm(item.attributes[k]) && norm(item.attributes[k]) === norm(l.attributes[k])).length;
      return { card: { ...l, overBudget: l.askingPrice > max * STRETCH, matchedPreferences }, score: optionalHits + matchedPreferences.length };
    })
    .sort((a, b) => b.score - a.score || a.card.askingPrice - b.card.askingPrice || a.card.id.localeCompare(b.card.id))
    .slice(0, TOP_N)
    .map(x => x.card);
}
```

## Fixtures: `tests/fixtures.ts` (A)

Self-contained test data, **not** read from the DB or the example seed (they may resemble each other; they don't have to stay in sync). Exports `catalog: Catalog`, `listingViews: ListingView[]`, `privateListing(id)` (a `Listing` with `floorPrice`, for 05) and an `item(overrides)` builder for `RequestItem`. Minimum content:

| id | category | attributes | asking | floor | status |
|---|---|---|---|---|---|
| `f-am90-8-used` | shoes | sport, 8, black, nike, air max 90, used | 90 | 70 | active |
| `f-am90-8-new` | shoes | sport, 8, black, nike, air max 90, new | 120 | 105 | active |
| `f-ultraboost-8` | shoes | sport, 8, black, adidas, ultraboost, used | 85 | 68 | active |
| `f-am90-10` | shoes | sport, **10**, black | 80 | 60 | active |
| `f-gazelle-8-white` | shoes | **casual**, 8, **white** | 55 | 45 | active |
| `f-sold-8` | shoes | sport, 8, black | 50 | 40 | **sold** |
| `f-no-colour-8` | shoes | sport, 8 (**no colour**) | 60 | 50 | active |

All fixture `ListingView`s have `busy: false` unless a test sets it.
| bikes ×3 | bike | hybrid, l | 500 / 600 / 700 | … | active |
| helmet, jackets ×2, glasses | helmet / jacket / glasses | … | 60 / 50, 70 / 30 | … | active |

Fixture categories: `shoes {required: type,size,colour; optional: brand,model,condition}`, `bike {type,frame_size; brand,condition}`, `helmet {size; brand,colour}`, `jacket {size; colour,brand}`, `glasses {—; brand}`; one bundle `kit` → bike, helmet, jacket, glasses.

## Tests: `tests/match.test.ts` (vitest)

| # | Input | Expect |
|---|---|---|
| 1 | shoes `{sport, 8, black}`, prefs `["nike air max"]`, max 80 | ids `[f-am90-8-used, f-am90-8-new, f-ultraboost-8]` in that order; `overBudget` false / **true** / false; first has `matchedPreferences: ["nike air max"]` |
| 2 | same with `"Black"`, `" 8 "` | same result (case/whitespace-insensitive) |
| 3 | same, max 60 | `f-am90-8-new` gone (120 > 90); others remain |
| 4 | same, max 80 | `f-sold-8`, `f-am90-10`, `f-gazelle-8-white`, `f-no-colour-8` never present |
| 5 | shoes `{sport, 8, black, brand: adidas}`, no prefs | `f-ultraboost-8` first (optional hit beats price) |
| 6 | glasses (no required fields), max 40 | every active glasses listing ≤ £60 |
| 7 | 7 identical matching listings | length 5, sorted by price |
| 8 | `maxPrice: null` or `included: false` | `[]` |
| 9 | any result | no card has a `floorPrice` key |
| 10 | category row edited in the test (add `"model"` to required) | only listings with the requested model match (proves rules come from the category row) |
| 11 | a matching listing with `busy: true` | still returned, same rank, `busy: true` on the card |

`package.json`: `"test": "vitest run"`; `vitest.config.ts` maps the `@/` alias to the repo root.

## Build steps

1. Write `tests/fixtures.ts` (also used by 03 and 05 tests).
2. Write `tests/match.test.ts` from the table, then `lib/match.ts` until green.
3. Give B the signature; B calls it from `/api/chat` per included item with that item's category row.

## Done when

- [ ] All 11 tests green with `npm test`.
- [ ] `lib/match.ts` imports nothing but types from `lib/schemas.ts`.
- [ ] With the example seed, the shoes request (sport, 8, black, "air max", £80) returns Tom, Nike Store (over budget), Anna in that order (manual check through `/api/chat`).
