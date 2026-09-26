# 05 · Negotiation: engine, agents, `POST /api/negotiate`, `POST /api/accept`

**Owner:** Workstream B (`lib/negotiation.ts`, `lib/agents/negotiator.ts`, `app/api/negotiate/route.ts`). Workstream A owns `app/api/accept/route.ts`, `app/api/walk-away/route.ts` and `tests/negotiation.test.ts` (written from this doc, in parallel with B).
**Depends on:** 01 (schemas, `MAX_TURNS`, `AUTO_AGREE_GAP`, `MAX_NEGOTIATIONS_PER_SESSION`), 02 (`getRequest`, `getListingPrivate`, `countNegotiations`, `lockListing`, `releaseListing`, `createNegotiation`, `finishNegotiation`, `acceptNegotiation`, `walkAwayNegotiation`), 03 (`lib/llm.ts`).
**Exposes:** `POST /api/negotiate` (NDJSON stream of `NegotiationEvent`), `POST /api/accept`, `POST /api/walk-away`, the listing busy lock usage, and the pure engine `applyMove` / `runNegotiation`.

## Shape

Limits live in **code**, not prompts. The LLM only proposes a move (`AgentMove`); `applyMove` turns it into a recorded `Offer` that can't break a limit. Agents are injected functions, so every rule is tested with stubs and no LLM.

```
runNegotiation(limits, buyerAgent, sellerAgent, onTurn)
  for n = 1..6:  side = n odd ? seller : buyer
     view  = side's view (only its own limit)          ← privacy enforced here
     move  = await agent(view)   (LLM or stub; on throw → hold)
     step  = applyMove(limits, turns, side, move)      ← all limits enforced here (pure)
     onTurn(step.offer, n)                              ← route streams {"type":"turn"}
     stop if step.status !== "running"
```

## `lib/negotiation.ts` (B), pure engine

```ts
export type Limits = { askingPrice: number; floorPrice: number; maxPrice: number };

export type BuyerView  = { side: "buyer_agent";  turn: number; maxTurns: number; askingPrice: number; maxPrice: number;   transcript: Offer[] };
export type SellerView = { side: "seller_agent"; turn: number; maxTurns: number; askingPrice: number; floorPrice: number; transcript: Offer[] };
export type BuyerAgent  = (v: BuyerView)  => Promise<AgentMove>;
export type SellerAgent = (v: SellerView) => Promise<AgentMove>;

export type Step = { offer: Offer; status: "running" | "agreed" | "failed"; finalPrice: number | null; reason: EndReason | null };
export type Result = { turns: Offer[]; status: "agreed" | "failed"; finalPrice: number | null; reason: EndReason };

export function applyMove(limits: Limits, turns: Offer[], side: Side, move: AgentMove): Step;

export async function runNegotiation(a: {
  limits: Limits; buyer: BuyerAgent; seller: SellerAgent;
  onTurn?: (offer: Offer, n: number) => void | Promise<void>;
  turnDelayMs?: number;                       // 0 in tests; ~600 in the route so humans can read along
}): Promise<Result>;
```

### `applyMove` rules (in this order)

Let `n = turns.length + 1`, `own` = this side's last price, `other` = the other side's last price, `floor`/`max` from `limits`.

1. **Opening.** `n === 1` (always the seller): record `{ action: "offer", price: askingPrice }` whatever the move says. Status `running`.
2. **Accept.** If `move.action === "accept"` and `other` exists and `floor ≤ other ≤ max`: record `{ action: "accept", price: other }` → `agreed`, `finalPrice = other`, `reason: "accepted"`. Otherwise the accept is **invalid**: treat it as an offer with `move.price` (continue to 3).
3. **Proposed price.** `p = Math.round(move.price)` if not null, else hold `own`; if there is no `own` (buyer's first turn) use `Math.round(Math.min(max, askingPrice) × 0.75)`. Then `p = Math.max(1, p)`.
4. **No backtracking.** Buyer: `p = Math.max(p, own)`. Seller: `p = Math.min(p, own)`.
5. **Clamp to own limit.** Buyer: `p = Math.min(p, max)`. Seller: `p = Math.max(p, floor)`.
6. **Crossing.** Buyer with `p ≥ other`, or seller with `p ≤ other` → record `{ action: "accept", price: other }` → `agreed`, `finalPrice = other`, `reason: "crossed"`. (Always within both limits: `other` is inside its owner's limit and `p` inside ours.)
7. **Record** `{ action: "offer", price: p }`. If the code changed the price (clamp, hold, backtrack, crossing), rewrite every `£N` in `move.message` to the recorded price (`/£\s?\d+(\.\d{1,2})?/g`) so text and chip agree.
8. **Midpoint.** If `other` exists, `|p − other| ≤ AUTO_AGREE_GAP` and `floor ≤ max`: `finalPrice = clamp(Math.round((p + other) / 2), floor, max)` → `agreed`, `reason: "midpoint"`. (No overlap ⇒ never auto-agree, even if the gap is £1.)
9. **Out of turns.** Else if `n === MAX_TURNS` → `failed`, `finalPrice: null`, `reason: "max_turns"`.
10. Else `running`.

Invariants (asserted in tests): every buyer `price ≤ max`; every seller `price ≥ floor`; buyer prices never decrease; seller prices never increase; `finalPrice`, when set, is in `[floor, max]`; ≤ 6 turns.

### `runNegotiation`

- Seller on odd turns, buyer on even turns.
- Builds `BuyerView` / `SellerView` fresh each turn from `limits` + transcript. The buyer view object has **no** `floorPrice` key; the seller view has **no** `maxPrice` key.
- If an agent throws or times out: use `{ action: "offer", price: null, message: "Let me think… I'll stay where I am." }` (holds its price) and carry on. A dead LLM therefore ends in `failed`, never in a limit breach.
- Awaits `onTurn` after each step; sleeps `turnDelayMs` between turns.

## `lib/agents/negotiator.ts` (B), LLM agents

```ts
export function makeBuyerAgent(ctx: { title: string; attributes: Record<string,string>; wants: Record<string,string>; preferences: string[] }): BuyerAgent;
export function makeSellerAgent(ctx: { title: string; attributes: Record<string,string>; sellerName: string; sellerType: "brand" | "private"; persona: string }): SellerAgent;
```

Each call: `completeJSON(AgentMove, [system, user], { temperature: 0 })`. The user message is the transcript from that agent's point of view plus the turn number:

```
Turn 4 of 6.
Seller: £90 · Asking £90, barely worn.
You: £68 · Similar pairs go for less. I can do £68.
Seller: £79 · Original box included. £79.
Your move.
```

### Buyer agent system prompt

```
You are a shopper's buying agent, haggling for: {title} ({attributes}). The seller is asking £{askingPrice}.
The shopper wants {wants}; nice-to-haves: {preferences}.
Your private maximum is £{maxPrice}. Never reveal it or hint at it. Never offer above it.
Style: friendly, brief (1-2 sentences, max 25 words), UK English. Give a reason (condition, market price, paying today).
Strategy:
- First offer: about 75% of the asking price. If that is above your maximum, about 85% of your maximum.
- Each later offer: move roughly half-way from your last offer toward the seller's last price, never above your maximum.
- Accept when the seller's last price is at or below your maximum and within £5 of your last offer.
- On the last turn, offer the most you are willing to pay (never above your maximum).
Reply with JSON only: {"action":"offer"|"accept","price":number|null,"message":string}.
For "accept", price is the seller's last price.
```

### Seller agent system prompt

```
You are the selling agent for {sellerName}, a {sellerType} seller. Persona: {persona}
Item: {title} ({attributes}), asking £{askingPrice}.
Your private floor is £{floorPrice}: the lowest price you may accept. Never reveal it or hint at it. Never offer below it.
Style: 1-2 sentences, max 25 words, in the persona's voice, UK English. Give a reason (condition, box, warranty, demand).
Strategy:
- Turn 1: open at your asking price.
- Let the persona set your pace: quick-sale or flexible personas move about half-way toward the buyer's last offer each turn;
  firm personas move in small steps (about 5% of the asking price).
- Accept when the buyer's last offer is at or above your floor and within £5 of your last price.
- If you are at your floor, hold it and say it's your lowest.
Reply with JSON only: {"action":"offer"|"accept","price":number|null,"message":string}.
For "accept", price is the buyer's last offer.
```

Nothing in these prompts is marketplace data: title, attributes, seller name/type/persona and prices all come from the DB rows at request time. The buyer prompt never gets `floorPrice` or `persona`; the seller prompt never gets `maxPrice` or the buyer's preferences.

**Tuning lever (only if real runs show wandering prices):** compute the "half-way" price in code and add `Suggested next price: £X (stay within ±£3)` to the user message. Engine and tests don't change.

## `app/api/negotiate/route.ts` (B)

```ts
export const maxDuration = 60;   // Vercel: 6 LLM turns + delays can take ~20-30 s
export async function POST(req: Request): Promise<Response>;
```

Before streaming (JSON errors):
1. `NegotiateBody.parse` → 400.
2. `countNegotiations(sessionId) >= MAX_NEGOTIATIONS_PER_SESSION` → 429 "Negotiation limit reached for this session".
3. `getRequest(requestId, sessionId)` → 404. Item for `category` must be `included` with `maxPrice !== null` → else 409 "Item not ready".
4. `getListingPrivate(listingId)` → 404; `status === "sold"` → 409 "Listing sold"; `listing.category !== category` → 400.
5. **Take the busy lock:** `lockListing(listingId, sessionId)` (one atomic UPDATE, 02). `false` → `409 { error: "Listing busy" }`: another session is negotiating or deciding on this listing. Nothing is created.
6. `negotiationId = await createNegotiation({ sessionId, requestId, category, listingId })`.

Stream (`new Response(readable, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } })`):
1. `send({ type: "start", negotiationId, listing: publicView(listing, seller) })`.
2. `runNegotiation({ limits: { askingPrice, floorPrice, maxPrice: item.maxPrice }, buyer: makeBuyerAgent(...), seller: makeSellerAgent(...), onTurn: (offer, n) => send({ type: "turn", n, offer }), turnDelayMs: 600 })`.
3. `await finishNegotiation(negotiationId, result)`; then the lock: `agreed` → `lockListing(listingId, sessionId)` again (refreshes it to now + 2 min so the visitor has time to decide); `failed` → `releaseListing(listingId, sessionId)`. Then `send({ type: "end", status, finalPrice, reason })`.
4. On a crash: `finishNegotiation(id, { turns, status: "failed", finalPrice: null })`, `releaseListing(...)`, `send({ type: "error", message: "Negotiation interrupted" })`.
5. `controller.close()`. `send` = `controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"))` wrapped in try/catch: if the visitor closed the tab, keep running so the row gets finished and the lock released/refreshed. If the function is killed outright, the lock expires by itself after 2 minutes.

Never put `limits`, `floorPrice`, `maxPrice`, `persona` or the lock owner in any event. The route is a POST handler, so it is never cached (see 00 "Live data").

**One at a time per visitor.** A negotiation only starts when the user taps **Negotiate** on one match card; the UI disables every other Negotiate button while a card is `running` (06). The server doesn't add a per-session check (a stale `running` row after a crash would lock the session out); the per-session cap (429) bounds abuse.

**One visitor per listing (busy lock).** The lock is per listing, not per seller: other listings from the same seller stay negotiable. While a listing is locked, other sessions get 409 "Listing busy" on Negotiate and see it marked "Busy" in their matches (still listed). Because only the lock holder can negotiate and accept, two visitors can never both reach a deal on the same listing. Lock lifecycle summary in 01 §5.

## `app/api/accept/route.ts` (A)

1. `AcceptBody.parse` → 400.
2. `acceptNegotiation(negotiationId, sessionId)` (02): 404 unknown or other session's; 409 not `agreed`; then `sell_listing` (sells only if still `active` and `busy_session_id = sessionId`, and clears the lock). `false` → `409 { error: "Deal expired" }`: the visitor waited past the 2-minute hold and another session took the lock. Otherwise listing → `sold`, negotiation → `accepted`.
3. Return `AcceptResponse`.

**Sold is final, for everyone.** Accept permanently marks the listing `sold` in the shared catalogue; it disappears from every visitor's matches on their next message. There is no demo mode, no undo endpoint, and nothing in the app sets a listing back to `active`. Supply is replenished by inserting new sellers/listings in the DB (07). No payment, no order number: the "Sold" card is the end.

## `app/api/walk-away/route.ts` (A)

1. `WalkAwayBody.parse` → 400.
2. `walkAwayNegotiation(negotiationId, sessionId)` (02): 404 unknown or other session's; releases the listing lock; negotiation `agreed` → `failed`.
3. Return `{ ok: true }`. Idempotent: calling it twice is fine.

## Tests: `tests/negotiation.test.ts` (A, vitest, stubs only)

Helpers: `scripted(moves: AgentMove[])` returns an agent that plays moves in order (and records the views it received); `strategyBuyer` / `strategySeller` implement the prompt strategies above in plain code (75% open, half-way, accept within £5). Limits come from `tests/fixtures.ts` (`privateListing("f-am90-8-used")` → asking 90, floor 70).

| # | Setup | Expect |
|---|---|---|
| 1 | seller stub opens at £50 | turn 1 recorded at £90 (asking) |
| 2 | max 80; buyer offers £85 | recorded £80, `action:"offer"` |
| 3 | buyer at £65; seller offers £60 | recorded £70 (floor) |
| 4 | buyer 70 then 60; seller 85 then 88 | buyer 70, 70; seller 85, 85 (no backtracking) |
| 5 | seller at £90, max 80, buyer `accept` | not agreed; recorded offer ≤ £80 |
| 6 | buyer at £60, seller `accept` | not agreed; recorded offer ≥ £70 |
| 7 | seller £78, max 80, buyer `accept` | `agreed`, £78, `reason:"accepted"` |
| 8 | seller £78, max 90, buyer offers £80 | recorded as `accept` at £78, `reason:"crossed"` |
| 9 | seller £77, buyer offers £75 | `agreed` at £76, `reason:"midpoint"` |
| 10 | floor 81 > max 80: seller £81, buyer £80 | never agrees; ends `failed` |
| 11 | both stubs hold forever | exactly 6 turns, `failed`, `reason:"max_turns"`, `finalPrice:null` |
| 12 | **overlap:** asking 90, floor 70, max 80, strategy stubs | `agreed` in ≤ 5 turns, 70 ≤ price ≤ 80 (the strategies land on £74) |
| 13 | **no overlap:** asking 90, floor 70, max 60, strategy stubs | `failed`; every buyer price ≤ 60, every seller price ≥ 70 |
| 14 | any run | buyer stub never received a view with a `floorPrice` key; seller stub never one with `maxPrice` |
| 15 | buyer stub throws on turn 2 | loop continues; turn 2 is a held/opening offer within limits |
| 16 | any run | `onTurn` called once per turn, `n` = 1, 2, 3… |
| 17 | property-style: 200 random stub moves (random prices/actions) over random limits | invariants above always hold |

Trace for #12: S £90 → B £68 → S £79 → B £74 → S accept £74. Trace for #13: S £90 → B £51 → S £71 → B £60 → S £70 → B £60 → failed.

## Build steps

1. B writes `applyMove` + `runNegotiation` first (no LLM); A writes the test file from the table at the same time. Iterate until green.
2. B writes the two agents; try one real run from a scratch script with the example seed's Tom listing (asking 90, floor 70, max 80) and with max 60.
3. B writes the route; check with `curl -N -X POST localhost:3000/api/negotiate -H 'content-type: application/json' -d '{"sessionId":"…","requestId":"…","category":"shoes","listingId":"l-tom-am90-8"}'` and watch lines arrive one by one.
4. A writes `/api/accept` and `/api/walk-away`.

## Done when

- [ ] `tests/negotiation.test.ts` all green, no network.
- [ ] Real LLM, example seed: max £80 vs Tom (floor £70) agrees around £75 in 3–5 turns in most runs; max £60 ends `failed` without breaching limits; Nike Store (floor £105) vs max £80 ends `failed`.
- [ ] Turns stream one line at a time (visible delay), exactly one `start` and one `end`/`error`.
- [ ] No event contains `floorPrice`, `maxPrice` or `persona` (grep a captured stream).
- [ ] 11th negotiation in a session → 429; negotiating a sold listing → 409 "Listing sold".
- [ ] Busy lock: while session A negotiates (or holds an agreed deal), session B's Negotiate on the same listing → 409 "Listing busy"; B can negotiate another listing from the same seller. A's failed run or walk away frees it immediately; an idle agreed lock frees after 2 min.
- [ ] Accept → listing `sold` for everyone (lock cleared); A accepting after its lock lapsed and B took it → 409 "Deal expired".
