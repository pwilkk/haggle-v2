"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AgentBlock, AgentText, TypingBubble, UserBubble } from "@/components/Bubbles";
import { BundleCard } from "@/components/BundleCard";
import { Composer } from "@/components/Composer";
import { Header } from "@/components/Header";
import { MatchList } from "@/components/MatchList";
import { RequestCard } from "@/components/RequestCard";
import { StatusLine } from "@/components/StatusLine";
import { applyResponse, emptyTranscript, type ChatEntry, type Transcript } from "@/lib/client/entries";
import { getSessionId } from "@/lib/client/session";
import { ChatResponse, MAX_MESSAGES, type ChatMessage } from "@/lib/schemas";

export default function HomePage() {
  const [draft, setDraft] = useState("");
  const [transcript, setTranscript] = useState<Transcript>(emptyTranscript);
  const [pending, setPending] = useState(false);
  const epoch = useRef(0);
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

  const full = transcript.messages.length >= MAX_MESSAGES;

  return (
    <div className="flex min-h-screen flex-col">
      <Header onNewChat={reset} />
      <main className="flex-1">
        <div className="mx-auto max-w-2xl space-y-6 px-5 py-8">
          <Entries entries={transcript.entries} transcript={transcript} pending={pending} onToggle={toggleExcluded} />
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
  onToggle,
}: {
  entries: ChatEntry[];
  transcript: Transcript;
  pending: boolean;
  onToggle: (category: string) => void;
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
          <MatchList matches={next.matches} request={transcript.request} catalog={transcript.catalog} />
        </AgentBlock>,
      );
      i += 1;
      continue;
    }
    nodes.push(
      <Standalone key={`${entry.kind}-${i}`} entry={entry} transcript={transcript} pending={pending} onToggle={onToggle} />,
    );
  }
  return nodes;
}

function Standalone({
  entry,
  transcript,
  pending,
  onToggle,
}: {
  entry: ChatEntry;
  transcript: Transcript;
  pending: boolean;
  onToggle: (category: string) => void;
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
  return <MatchList matches={entry.matches} request={transcript.request} catalog={transcript.catalog} />;
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
