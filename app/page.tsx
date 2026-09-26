"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AgentBlock, AgentText, Note, TypingBubble, UserBubble } from "@/components/Bubbles";
import { BundleCard } from "@/components/BundleCard";
import { Composer } from "@/components/Composer";
import { Header } from "@/components/Header";
import { MatchList } from "@/components/MatchList";
import { NegotiationCard } from "@/components/NegotiationCard";
import { RequestCard } from "@/components/RequestCard";
import { SoldCard } from "@/components/SoldCard";
import { StatusLine } from "@/components/StatusLine";
import {
  applyNegotiationEvent,
  applyResponse,
  beginNegotiation,
  emptyTranscript,
  isNegotiating,
  markAccepted,
  markWalked,
  negotiationFailure,
  patchNegotiation,
  retryNegotiation,
  type ChatEntry,
  type NegotiationEntry,
  type Transcript,
} from "@/lib/client/entries";
import { getSessionId } from "@/lib/client/session";
import { readNdjson } from "@/lib/client/stream";
import {
  AcceptResponse,
  ChatResponse,
  MAX_MESSAGES,
  NegotiationEvent,
  type ChatMessage,
  type ItemMatches,
  type ListingView,
  type MatchCard,
} from "@/lib/schemas";

export default function HomePage() {
  const [draft, setDraft] = useState("");
  const [transcript, setTranscript] = useState<Transcript>(emptyTranscript);
  const [pending, setPending] = useState(false);
  const [acceptingKey, setAcceptingKey] = useState<string | null>(null);
  const epoch = useRef(0);
  const negotiatingRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const which = new URLSearchParams(window.location.search).get("fixtures");
    if (which !== "1" && which !== "shoes" && which !== "cycling") return;
    void import("@/lib/client/fixtures").then(({ fixtureCyclingTurns, fixtureShoesTurns }) => {
      const turns = which === "cycling" ? fixtureCyclingTurns : fixtureShoesTurns;
      let state = emptyTranscript();
      for (const turn of turns) {
        state = applyResponse(
          {
            ...state,
            entries: [...state.entries, { kind: "user", text: turn.user }],
            messages: [...state.messages, { role: "user", content: turn.user }],
          },
          turn.response,
        );
      }
      setTranscript(state);
    });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript.entries, pending]);

  function reset() {
    epoch.current += 1;
    negotiatingRef.current = false;
    setAcceptingKey(null);
    setDraft("");
    setPending(false);
    setTranscript(emptyTranscript());
  }

  function restore(text: string) {
    setDraft(text);
    setTranscript((state) => ({
      ...state,
      entries: [...state.entries.slice(0, -1), { kind: "agent", text: "Something went wrong, try again.", error: true }],
      messages: state.messages.slice(0, -1),
    }));
  }

  async function send() {
    const text = draft.trim();
    if (!text || pending || transcript.messages.length >= MAX_MESSAGES) return;
    const sessionId = getSessionId();
    const gen = epoch.current;
    const messages: ChatMessage[] = [...transcript.messages, { role: "user", content: text }];
    setDraft("");
    setPending(true);
    setTranscript((state) => ({
      ...state,
      entries: [...state.entries, { kind: "user", text }],
      messages,
    }));

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId,
          requestId: transcript.requestId,
          messages,
          excluded: transcript.excluded,
        }),
      });
      if (gen !== epoch.current) return;
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        if (res.status >= 500) {
          restore(text);
          return;
        }
        const message = errorText(data);
        setTranscript((state) => ({
          ...state,
          entries: [...state.entries, { kind: "agent", text: message, error: true }],
        }));
        return;
      }
      setTranscript((state) => applyResponse(state, ChatResponse.parse(data)));
    } catch {
      if (gen !== epoch.current) return;
      restore(text);
    } finally {
      if (gen === epoch.current) setPending(false);
    }
  }

  function toggleExcluded(category: string) {
    setTranscript((state) => ({
      ...state,
      excluded: state.excluded.includes(category)
        ? state.excluded.filter((id) => id !== category)
        : [...state.excluded, category],
    }));
  }

  async function negotiate(listing: ListingView, category: string, existingKey?: string) {
    if (negotiatingRef.current) return;
    if (!existingKey && isNegotiating(transcript.entries)) return;
    if (!transcript.requestId) return;
    if (listing.status === "sold" || transcript.soldIds.includes(listing.id)) return;

    const key = existingKey ?? crypto.randomUUID();
    const sessionId = getSessionId();
    const requestId = transcript.requestId;
    const gen = epoch.current;
    negotiatingRef.current = true;
    setTranscript((state) =>
      existingKey ? retryNegotiation(state, existingKey) : beginNegotiation(state, listing, category, key),
    );

    try {
      const res = await fetch("/api/negotiate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, requestId, category, listingId: listing.id }),
      });
      if (gen !== epoch.current) return;
      if (!res.ok) {
        const data: unknown = await res.json().catch(() => null);
        setTranscript((state) => negotiationFailure(state, key, res.status, errorText(data), listing.id));
        return;
      }
      await readNdjson<unknown>(res, (event) => {
        if (gen !== epoch.current) return;
        const parsed = NegotiationEvent.safeParse(event);
        if (!parsed.success) return;
        setTranscript((state) => applyNegotiationEvent(state, key, parsed.data));
      });
      if (gen !== epoch.current) return;
      setTranscript((state) => {
        const entry = state.entries.find((row) => row.kind === "negotiation" && row.key === key);
        if (entry?.kind === "negotiation" && entry.status === "running") {
          return patchNegotiation(state, key, (row) => ({
            ...row,
            status: "error",
            error: "Negotiation interrupted",
          }));
        }
        return state;
      });
    } catch {
      if (gen !== epoch.current) return;
      setTranscript((state) =>
        patchNegotiation(state, key, (row) => ({
          ...row,
          status: "error",
          error: row.error ?? "Negotiation interrupted",
        })),
      );
    } finally {
      if (gen === epoch.current) negotiatingRef.current = false;
    }
  }

  async function acceptDeal(key: string) {
    const entry = transcript.entries.find((row) => row.kind === "negotiation" && row.key === key);
    if (!entry || entry.kind !== "negotiation" || !entry.negotiationId || acceptingKey) return;
    const sessionId = getSessionId();
    const negotiationId = entry.negotiationId;
    const gen = epoch.current;
    setAcceptingKey(key);
    try {
      const res = await fetch("/api/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, negotiationId }),
      });
      if (gen !== epoch.current) return;
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const message =
          res.status === 409 && errorText(data) === "Deal expired"
            ? "This deal expired. Try negotiating again shortly."
            : errorText(data);
        setTranscript((state) => patchNegotiation(state, key, (row) => ({ ...row, error: message })));
        return;
      }
      AcceptResponse.parse(data);
      setTranscript((state) => markAccepted(state, key));
    } catch {
      if (gen !== epoch.current) return;
      setTranscript((state) =>
        patchNegotiation(state, key, (row) => ({ ...row, error: "Something went wrong, try again." })),
      );
    } finally {
      if (gen === epoch.current) setAcceptingKey(null);
    }
  }

  function walkAway(key: string) {
    const entry = transcript.entries.find((row) => row.kind === "negotiation" && row.key === key);
    if (!entry || entry.kind !== "negotiation" || !entry.negotiationId) return;
    const sessionId = getSessionId();
    const negotiationId = entry.negotiationId;
    setTranscript((state) => markWalked(state, key));
    void fetch("/api/walk-away", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, negotiationId }),
    }).catch(() => undefined);
  }

  const full = transcript.messages.length >= MAX_MESSAGES;
  const negotiating = isNegotiating(transcript.entries);

  return (
    <div className="flex min-h-screen flex-col">
      <Header onNewChat={reset} />
      <main className="flex-1">
        <div className="mx-auto max-w-2xl space-y-6 px-5 py-8">
          <Entries
            entries={transcript.entries}
            transcript={transcript}
            pending={pending}
            negotiating={negotiating}
            acceptingKey={acceptingKey}
            onToggle={toggleExcluded}
            onNegotiate={(card, category) => void negotiate(card, category)}
            onAccept={(key) => void acceptDeal(key)}
            onWalkAway={walkAway}
            onRetry={(entry) => void negotiate(entry.listing, entry.category, entry.key)}
          />
          {pending ? <TypingBubble /> : null}
          <div ref={bottomRef} />
        </div>
      </main>
      <Composer value={draft} onChange={setDraft} onSubmit={() => void send()} disabled={pending || full} full={full} />
    </div>
  );
}

function Entries({
  entries,
  transcript,
  pending,
  negotiating,
  acceptingKey,
  onToggle,
  onNegotiate,
  onAccept,
  onWalkAway,
  onRetry,
}: {
  entries: ChatEntry[];
  transcript: Transcript;
  pending: boolean;
  negotiating: boolean;
  acceptingKey: string | null;
  onToggle: (category: string) => void;
  onNegotiate: (card: MatchCard, category: string) => void;
  onAccept: (key: string) => void;
  onWalkAway: (key: string) => void;
  onRetry: (entry: NegotiationEntry) => void;
}) {
  const nodes: ReactNode[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const next = entries[i + 1];
    if (entry.kind === "agent" && next?.kind === "request") {
      nodes.push(
        <AgentBlock key={`agent-${i}`}>
          <AgentText text={entry.text} error={entry.error} />
          <div className="mt-3">
            <LiveRequest transcript={transcript} pending={pending} onToggle={onToggle} />
          </div>
        </AgentBlock>,
      );
      i += 1;
      continue;
    }
    if (entry.kind === "agent" && next?.kind === "matches") {
      nodes.push(
        <AgentBlock key={`agent-${i}`}>
          <AgentText text={entry.text} error={entry.error} />
          <Matches transcript={transcript} matches={next.matches} negotiating={negotiating} onNegotiate={onNegotiate} />
        </AgentBlock>,
      );
      i += 1;
      continue;
    }
    nodes.push(
      <Standalone
        key={entry.kind === "negotiation" ? entry.key : `${entry.kind}-${i}`}
        entry={entry}
        transcript={transcript}
        pending={pending}
        negotiating={negotiating}
        acceptingKey={acceptingKey}
        onToggle={onToggle}
        onNegotiate={onNegotiate}
        onAccept={onAccept}
        onWalkAway={onWalkAway}
        onRetry={onRetry}
      />,
    );
  }
  return nodes;
}

function Standalone({
  entry,
  transcript,
  pending,
  negotiating,
  acceptingKey,
  onToggle,
  onNegotiate,
  onAccept,
  onWalkAway,
  onRetry,
}: {
  entry: ChatEntry;
  transcript: Transcript;
  pending: boolean;
  negotiating: boolean;
  acceptingKey: string | null;
  onToggle: (category: string) => void;
  onNegotiate: (card: MatchCard, category: string) => void;
  onAccept: (key: string) => void;
  onWalkAway: (key: string) => void;
  onRetry: (entry: NegotiationEntry) => void;
}) {
  if (entry.kind === "user") return <UserBubble text={entry.text} />;
  if (entry.kind === "agent") {
    return (
      <AgentBlock>
        <AgentText text={entry.text} error={entry.error} />
      </AgentBlock>
    );
  }
  if (entry.kind === "request") {
    return (
      <AgentBlock>
        <LiveRequest transcript={transcript} pending={pending} onToggle={onToggle} />
      </AgentBlock>
    );
  }
  if (entry.kind === "status") return <StatusLine sellersAsked={entry.sellersAsked} />;
  if (entry.kind === "note") return <Note text={entry.text} />;
  if (entry.kind === "sold") return <SoldCard title={entry.title} price={entry.price} saved={entry.saved} />;
  if (entry.kind === "negotiation") {
    const maxPrice = transcript.request?.items.find((item) => item.category === entry.category)?.maxPrice ?? null;
    return (
      <AgentBlock>
        <NegotiationCard
          sellerName={entry.listing.sellerName}
          title={entry.listing.title}
          askingPrice={entry.listing.askingPrice}
          maxPrice={maxPrice}
          turns={entry.turns}
          status={entry.status}
          finalPrice={entry.finalPrice}
          reason={entry.reason}
          error={entry.error}
          decision={entry.decision}
          accepting={acceptingKey === entry.key}
          onAccept={() => onAccept(entry.key)}
          onWalkAway={() => onWalkAway(entry.key)}
          onRetry={() => onRetry(entry)}
        />
      </AgentBlock>
    );
  }
  return <Matches transcript={transcript} matches={entry.matches} negotiating={negotiating} onNegotiate={onNegotiate} />;
}

function Matches({
  transcript,
  matches,
  negotiating,
  onNegotiate,
}: {
  transcript: Transcript;
  matches: ItemMatches[];
  negotiating: boolean;
  onNegotiate: (card: MatchCard, category: string) => void;
}) {
  return (
    <MatchList
      matches={matches}
      request={transcript.request}
      catalog={transcript.catalog}
      busyIds={transcript.busyIds}
      soldIds={transcript.soldIds}
      negotiating={negotiating}
      onNegotiate={onNegotiate}
    />
  );
}

function LiveRequest({
  transcript,
  pending,
  onToggle,
}: {
  transcript: Transcript;
  pending: boolean;
  onToggle: (category: string) => void;
}) {
  if (!transcript.request || !transcript.catalog) return null;
  if (transcript.request.bundle) {
    return (
      <BundleCard
        request={transcript.request}
        catalog={transcript.catalog}
        excluded={transcript.excluded}
        pending={pending}
        onToggle={onToggle}
      />
    );
  }
  return <RequestCard request={transcript.request} catalog={transcript.catalog} excluded={transcript.excluded} />;
}

function errorText(data: unknown): string {
  if (data && typeof data === "object" && "error" in data && typeof data.error === "string") return data.error;
  return "Something went wrong, try again.";
}
