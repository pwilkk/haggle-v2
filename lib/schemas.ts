import { z } from "zod";

// ---------- app rules (code, not data) ----------
export const MAX_TURNS = 6; // negotiation: total turns, seller opens, alternate
export const AUTO_AGREE_GAP = 2; // negotiation: £ gap that triggers split-the-difference
export const MAX_MESSAGE_CHARS = 500; // abuse cap: one user message
export const MAX_MESSAGES = 30; // abuse cap: chat history length per request (≈15 user turns)
export const MAX_NEGOTIATIONS_PER_SESSION = 10; // abuse cap: negotiations per sessionId

export const Id = z.string().min(1);
export const SessionId = z.uuid();
export const Price = z.number().int().positive(); // whole £
export const Attributes = z.record(z.string(), z.string());

// ---------- catalog (DB rows, public) ----------
export const Category = z.object({
  id: Id, // "shoes"
  label: z.string(), // "Shoes"
  required: z.array(z.string()), // ["type","size","colour"]: asked for, and must match exactly
  optional: z.array(z.string()), // ["brand","model","condition"]: ranking only
});

export const Bundle = z.object({
  id: Id, // "cycling"
  label: z.string(), // "Cycling starter kit"
  description: z.string(), // tells the agent when to use it + card subtitle
  categoryIds: z.array(Id), // ["bike","helmet","jacket","glasses"]
});

export const Catalog = z.object({ categories: z.array(Category), bundles: z.array(Bundle) });

// ---------- sellers (DB rows) ----------
export const Account = z.object({
  // every account row is a seller
  id: Id, // "tom"
  name: z.string(), // "Tom"
  type: z.enum(["brand", "private"]),
  persona: z.string(), // negotiation style. Server-only (seller agent prompt).
});

// ---------- buyer request ----------
export const RequestItem = z.object({
  category: Id,
  included: z.boolean(), // false = user unticked it (bundle); ignored by match/ready
  attributes: Attributes, // gathered fields, normalised
  preferences: z.array(z.string()), // nice-to-haves, lower-case, e.g. ["nike air max"]
  maxPrice: Price.nullable(), // PRIVATE (see §6). One per item, bundles too. null = not asked/answered yet
});

export const BuyerRequest = z.object({
  id: Id,
  sessionId: SessionId,
  bundle: Id.nullable(), // bundle id or null for a single-item request
  items: z.array(RequestItem),
  status: z.enum(["gathering", "ready"]), // ready = every included item has required fields + maxPrice
});

export const MissingItem = z.object({
  category: Id,
  fields: z.array(z.string()), // attribute keys and/or "maxPrice"; included items only, non-empty only
});

// What the extraction LLM call returns (03). lib/request.ts validates it against the catalog.
export const IntakeDraft = z.object({
  bundle: z.string().nullable(),
  dropped: z.array(z.string()), // bundle items the user said they don't need ("I have a helmet")
  items: z.array(
    z.object({
      category: z.string(),
      attributes: Attributes,
      preferences: z.array(z.string()),
      maxPrice: z.number().nullable(),
    }),
  ),
});

// ---------- listings ----------
export const Listing = z.object({
  // SERVER-ONLY shape (has floorPrice)
  id: Id,
  sellerId: Id,
  category: Id,
  title: z.string(), // "Used Nike Air Max 90, black, UK 8"
  attributes: Attributes,
  askingPrice: Price,
  floorPrice: Price, // PRIVATE (see §6)
  status: z.enum(["active", "sold"]),
});

export const ListingView = Listing.omit({ floorPrice: true }).extend({
  // safe for the browser
  sellerName: z.string(),
  sellerType: z.enum(["brand", "private"]),
  busy: z.boolean(), // locked by ANOTHER session's live negotiation (§5). Lock owner id never exposed
});

export const MatchCard = ListingView.extend({
  overBudget: z.boolean(), // askingPrice > maxPrice * STRETCH (04)
  matchedPreferences: z.array(z.string()),
});

export const ItemMatches = z.object({ category: Id, listings: z.array(MatchCard) }); // ranked, max 5, may be empty

// ---------- negotiation ----------
export const Side = z.enum(["buyer_agent", "seller_agent"]);

export const AgentMove = z.object({
  // what an agent (LLM or test stub) proposes
  action: z.enum(["offer", "accept"]),
  price: z.number().nullable(), // ignored for accept; null offer = hold previous price
  message: z.string(),
});

export const Offer = z.object({
  // what the code records after enforcing limits
  from: Side,
  action: z.enum(["offer", "accept"]),
  price: Price, // always set; for accept = the other side's last price
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
  content: z.string().max(4000), // user messages additionally capped at MAX_MESSAGE_CHARS in the route
});

export const ChatBody = z.object({
  sessionId: SessionId,
  requestId: Id.nullable(), // null on the first message of a chat
  messages: z.array(ChatMessage).min(1), // full text history; last = new user message. Route: > MAX_MESSAGES → 429
  excluded: z.array(Id).default([]), // bundle rows the user unticked
});

export const ChatResponse = z.object({
  requestId: Id,
  reply: z.string(), // agent text bubble
  request: BuyerRequest, // owner's own view, includes maxPrice (see §6)
  missing: z.array(MissingItem),
  catalog: z.object({
    // labels/fields the UI needs to render this request
    categories: z.array(Category), // only the categories used by request.items
    bundle: Bundle.nullable(),
  }),
  matches: z.array(ItemMatches).nullable(), // non-null only when (re)matched this turn
  sellersAsked: z.number().int().nullable(), // distinct sellers with active listings in the included categories; with matches
});

export const NegotiateBody = z.object({ sessionId: SessionId, requestId: Id, category: Id, listingId: Id });

export const NegotiationEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start"), negotiationId: Id, listing: ListingView }),
  z.object({ type: z.literal("turn"), n: z.number().int(), offer: Offer }), // n = 1..MAX_TURNS
  z.object({
    type: z.literal("end"),
    status: z.enum(["agreed", "failed"]),
    finalPrice: Price.nullable(),
    reason: EndReason,
  }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);

export const AcceptBody = z.object({ sessionId: SessionId, negotiationId: Id });
export const WalkAwayBody = z.object({ sessionId: SessionId, negotiationId: Id });
export const WalkAwayResponse = z.object({ ok: z.literal(true) });
export const AcceptResponse = z.object({
  negotiationId: Id,
  status: z.literal("accepted"),
  finalPrice: Price,
  listing: ListingView, // status now "sold"
});

export const ApiError = z.object({ error: z.string() });

export type Id = z.infer<typeof Id>;
export type SessionId = z.infer<typeof SessionId>;
export type Price = z.infer<typeof Price>;
export type Attributes = z.infer<typeof Attributes>;
export type Category = z.infer<typeof Category>;
export type Bundle = z.infer<typeof Bundle>;
export type Catalog = z.infer<typeof Catalog>;
export type Account = z.infer<typeof Account>;
export type RequestItem = z.infer<typeof RequestItem>;
export type BuyerRequest = z.infer<typeof BuyerRequest>;
export type MissingItem = z.infer<typeof MissingItem>;
export type IntakeDraft = z.infer<typeof IntakeDraft>;
export type Listing = z.infer<typeof Listing>;
export type ListingView = z.infer<typeof ListingView>;
export type MatchCard = z.infer<typeof MatchCard>;
export type ItemMatches = z.infer<typeof ItemMatches>;
export type Side = z.infer<typeof Side>;
export type AgentMove = z.infer<typeof AgentMove>;
export type Offer = z.infer<typeof Offer>;
export type NegotiationStatus = z.infer<typeof NegotiationStatus>;
export type EndReason = z.infer<typeof EndReason>;
export type Negotiation = z.infer<typeof Negotiation>;
export type ChatMessage = z.infer<typeof ChatMessage>;
export type ChatBody = z.infer<typeof ChatBody>;
export type ChatResponse = z.infer<typeof ChatResponse>;
export type NegotiateBody = z.infer<typeof NegotiateBody>;
export type NegotiationEvent = z.infer<typeof NegotiationEvent>;
export type AcceptBody = z.infer<typeof AcceptBody>;
export type AcceptResponse = z.infer<typeof AcceptResponse>;
export type WalkAwayBody = z.infer<typeof WalkAwayBody>;
export type WalkAwayResponse = z.infer<typeof WalkAwayResponse>;
export type ApiError = z.infer<typeof ApiError>;
