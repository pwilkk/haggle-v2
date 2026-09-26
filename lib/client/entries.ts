import type { BuyerRequest, ChatMessage, ChatResponse, ItemMatches, MissingItem } from "@/lib/schemas";

export type ChatEntry =
  | { kind: "user"; text: string }
  | { kind: "agent"; text: string; error?: boolean }
  | { kind: "request" }
  | { kind: "status"; sellersAsked: number }
  | { kind: "matches"; matches: ItemMatches[] };

export type Transcript = {
  entries: ChatEntry[];
  messages: ChatMessage[];
  requestId: string | null;
  request: BuyerRequest | null;
  missing: MissingItem[];
  catalog: ChatResponse["catalog"] | null;
  excluded: string[];
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
  };
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
    entries: entriesAfterReply(state.entries, response),
    messages: [...state.messages, { role: "assistant", content: response.reply }],
    requestId: response.requestId,
    request: response.request,
    missing: response.missing,
    catalog: response.catalog,
    excluded: response.request.items.filter((item) => !item.included).map((item) => item.category),
  };
}
