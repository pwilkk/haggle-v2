import type {
  BuyerRequest,
  ChatMessage,
  ChatResponse,
  EndReason,
  ItemMatches,
  ListingView,
  MissingItem,
  NegotiationEvent,
  Offer,
} from "@/lib/schemas";

export type NegotiationEntry = {
  kind: "negotiation";
  key: string;
  category: string;
  listing: ListingView;
  negotiationId: string | null;
  turns: Offer[];
  status: "running" | "agreed" | "failed" | "error";
  finalPrice: number | null;
  reason: EndReason | null;
  error?: string;
  decision: null | "accepted" | "walked";
};

export type ChatEntry =
  | { kind: "user"; text: string }
  | { kind: "agent"; text: string; error?: boolean }
  | { kind: "request" }
  | { kind: "status"; sellersAsked: number }
  | { kind: "matches"; matches: ItemMatches[] }
  | { kind: "note"; text: string }
  | NegotiationEntry
  | { kind: "sold"; title: string; price: number; saved: number };

export type Transcript = {
  entries: ChatEntry[];
  messages: ChatMessage[];
  requestId: string | null;
  request: BuyerRequest | null;
  missing: MissingItem[];
  catalog: ChatResponse["catalog"] | null;
  excluded: string[];
  soldIds: string[];
  busyIds: string[];
};

export function emptyTranscript(): Transcript {
  return {
    entries: [],
    messages: [],
    requestId: null,
    request: null,
    missing: [],
    catalog: null,
    excluded: [],
    soldIds: [],
    busyIds: [],
  };
}

export function isNegotiating(entries: ChatEntry[]): boolean {
  return entries.some((entry) => entry.kind === "negotiation" && entry.status === "running");
}

export function entriesAfterReply(entries: ChatEntry[], response: ChatResponse): ChatEntry[] {
  const next = [...entries];
  const firstCard = !entries.some((entry) => entry.kind === "request") && response.request.items.length > 0;
  const matches = response.matches;
  if (firstCard && matches) next.push({ kind: "request" });
  if (matches) next.push({ kind: "status", sellersAsked: response.sellersAsked ?? 0 });
  next.push({ kind: "agent", text: response.reply });
  if (firstCard && !matches) next.push({ kind: "request" });
  if (matches) next.push({ kind: "matches", matches });
  return next;
}

export function applyResponse(state: Transcript, response: ChatResponse): Transcript {
  return {
    ...state,
    entries: entriesAfterReply(state.entries, response),
    messages: [...state.messages, { role: "assistant", content: response.reply }],
    requestId: response.requestId,
    request: response.request,
    missing: response.missing,
    catalog: response.catalog,
    excluded: response.request.items.filter((item) => !item.included).map((item) => item.category),
  };
}

export function beginNegotiation(state: Transcript, listing: ListingView, category: string, key: string): Transcript {
  const entry: NegotiationEntry = {
    kind: "negotiation",
    key,
    category,
    listing,
    negotiationId: null,
    turns: [],
    status: "running",
    finalPrice: null,
    reason: null,
    decision: null,
  };
  return {
    ...state,
    entries: [
      ...state.entries,
      { kind: "note", text: `You tapped Negotiate on ${listing.sellerName}'s ${listing.title}` },
      entry,
    ],
  };
}

export function retryNegotiation(state: Transcript, key: string): Transcript {
  return patchNegotiation(state, key, (entry) => ({
    ...entry,
    negotiationId: null,
    turns: [],
    status: "running",
    finalPrice: null,
    reason: null,
    error: undefined,
    decision: null,
  }));
}

export function applyNegotiationEvent(state: Transcript, key: string, event: NegotiationEvent): Transcript {
  return patchNegotiation(state, key, (entry) => {
    if (event.type === "start") return { ...entry, negotiationId: event.negotiationId, listing: event.listing };
    if (event.type === "turn") return { ...entry, turns: [...entry.turns, event.offer] };
    if (event.type === "end") {
      return { ...entry, status: event.status, finalPrice: event.finalPrice, reason: event.reason };
    }
    return { ...entry, status: "error", error: event.message };
  });
}

export function negotiationFailure(
  state: Transcript,
  key: string,
  status: number,
  serverError: string,
  listingId: string,
): Transcript {
  if (status === 409 && serverError === "Listing busy") {
    return {
      ...patchNegotiation(state, key, (entry) => ({
        ...entry,
        status: "error",
        error: "Someone is haggling for this one, try again shortly",
      })),
      busyIds: state.busyIds.includes(listingId) ? state.busyIds : [...state.busyIds, listingId],
    };
  }
  if (status === 409 && serverError === "Listing sold") {
    return {
      ...patchNegotiation(state, key, (entry) => ({
        ...entry,
        status: "error",
        error: "This one has just been sold",
      })),
      soldIds: state.soldIds.includes(listingId) ? state.soldIds : [...state.soldIds, listingId],
    };
  }
  if (status === 429) {
    return patchNegotiation(state, key, (entry) => ({
      ...entry,
      status: "error",
      error: "You've hit the negotiation limit for this session",
    }));
  }
  return patchNegotiation(state, key, (entry) => ({
    ...entry,
    status: "error",
    error: serverError || "Negotiation interrupted",
  }));
}

export function markAccepted(state: Transcript, key: string): Transcript {
  const entry = findNegotiation(state, key);
  if (!entry || entry.finalPrice == null) return state;
  const price = entry.finalPrice;
  return {
    ...state,
    soldIds: state.soldIds.includes(entry.listing.id) ? state.soldIds : [...state.soldIds, entry.listing.id],
    entries: [
      ...state.entries.map((row) =>
        row.kind === "negotiation" && row.key === key ? { ...row, decision: "accepted" as const } : row,
      ),
      { kind: "note", text: "You tapped Accept deal" },
      { kind: "sold", title: entry.listing.title, price, saved: entry.listing.askingPrice - price },
    ],
  };
}

export function markWalked(state: Transcript, key: string): Transcript {
  return {
    ...state,
    entries: [
      ...state.entries.map((row) =>
        row.kind === "negotiation" && row.key === key ? { ...row, decision: "walked" as const } : row,
      ),
      { kind: "note", text: "You walked away" },
    ],
  };
}

export function patchNegotiation(
  state: Transcript,
  key: string,
  update: (entry: NegotiationEntry) => NegotiationEntry,
): Transcript {
  return {
    ...state,
    entries: state.entries.map((entry) => (entry.kind === "negotiation" && entry.key === key ? update(entry) : entry)),
  };
}

function findNegotiation(state: Transcript, key: string): NegotiationEntry | null {
  const entry = state.entries.find((row) => row.kind === "negotiation" && row.key === key);
  return entry?.kind === "negotiation" ? entry : null;
}
