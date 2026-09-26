import { describe, expect, it } from "vitest";
import {
  applyNegotiationEvent,
  applyResponse,
  beginNegotiation,
  emptyTranscript,
  entriesAfterReply,
  markAccepted,
  markWalked,
  negotiationFailure,
} from "@/lib/client/entries";
import { fixtureChatResponses, fixtureCyclingTurns, fixtureNegotiationLines, fixtureShoesTurns } from "@/lib/client/fixtures";
import { ChatResponse, NegotiationEvent, type ListingView } from "@/lib/schemas";
import { readNdjson } from "@/lib/client/stream";

describe("chat entries", () => {
  it("puts the request card under the first question, then status, reply and matches", () => {
    let state = emptyTranscript();
    for (const turn of fixtureShoesTurns) {
      state = applyResponse(
        { ...state, entries: [...state.entries, { kind: "user", text: turn.user }], messages: [...state.messages, { role: "user", content: turn.user }] },
        turn.response,
      );
    }
    expect(state.entries.map((entry) => entry.kind)).toEqual([
      "user",
      "agent",
      "request",
      "user",
      "status",
      "agent",
      "matches",
    ]);
    expect(state.request?.status).toBe("ready");
    expect(state.messages.map((message) => message.role)).toEqual(["user", "assistant", "user", "assistant"]);
  });

  it("puts a bundle checklist after the intro and records unticked items", () => {
    const turn = fixtureCyclingTurns[0]!;
    const state = applyResponse(
      { ...emptyTranscript(), entries: [{ kind: "user", text: turn.user }], messages: [{ role: "user", content: turn.user }] },
      turn.response,
    );
    expect(state.entries.map((entry) => entry.kind)).toEqual(["user", "agent", "request"]);
    expect(state.excluded).toEqual(["helmet"]);
    expect(state.catalog?.bundle?.id).toBe("cycling");
  });

  it("does not add a second request card when matches arrive later", () => {
    const [first, second] = fixtureShoesTurns;
    const afterFirst = entriesAfterReply([{ kind: "user", text: first!.user }], first!.response);
    const afterSecond = entriesAfterReply(
      [...afterFirst, { kind: "user", text: second!.user }],
      second!.response,
    );
    expect(afterSecond.filter((entry) => entry.kind === "request")).toHaveLength(1);
  });
});

describe("client fixtures", () => {
  it("match the chat and negotiation contracts and carry no floor price", () => {
    for (const response of fixtureChatResponses) {
      expect(ChatResponse.parse(response)).toEqual(response);
    }
    expect(JSON.stringify(fixtureChatResponses)).not.toContain("floorPrice");
    expect(fixtureNegotiationLines.length).toBeGreaterThan(0);
    for (const line of fixtureNegotiationLines) {
      expect(NegotiationEvent.parse(JSON.parse(line)).type).toBeTruthy();
    }
  });
});

describe("negotiation entries", () => {
  const listing: ListingView = {
    id: "l-tom-am90-8",
    sellerId: "tom",
    sellerName: "Tom",
    sellerType: "private",
    category: "shoes",
    title: "Used Nike Air Max 90, black, UK 8",
    attributes: { condition: "used" },
    askingPrice: 90,
    status: "active",
    busy: false,
  };

  it("starts one running card and folds the stream into it", () => {
    let state = beginNegotiation(emptyTranscript(), listing, "shoes", "neg-key");
    expect(state.entries.map((entry) => entry.kind)).toEqual(["note", "negotiation"]);
    for (const line of fixtureNegotiationLines) {
      state = applyNegotiationEvent(state, "neg-key", NegotiationEvent.parse(JSON.parse(line)));
    }
    const card = state.entries.find((entry) => entry.kind === "negotiation");
    expect(card).toMatchObject({
      status: "agreed",
      finalPrice: 74,
      reason: "accepted",
      negotiationId: "9a1c0000-0000-4000-8000-000000000001",
      decision: null,
    });
    expect(card?.kind === "negotiation" ? card.turns : []).toHaveLength(5);
  });

  it("maps busy, sold and the session cap onto the card", () => {
    const started = beginNegotiation(emptyTranscript(), listing, "shoes", "neg-key");
    const busy = negotiationFailure(started, "neg-key", 409, "Listing busy", listing.id);
    expect(busy.busyIds).toEqual([listing.id]);
    expect(busy.entries.find((entry) => entry.kind === "negotiation")).toMatchObject({
      status: "error",
      error: "Someone is haggling for this one, try again shortly",
    });

    const sold = negotiationFailure(started, "neg-key", 409, "Listing sold", listing.id);
    expect(sold.soldIds).toEqual([listing.id]);
    expect(sold.entries.find((entry) => entry.kind === "negotiation")).toMatchObject({
      error: "This one has just been sold",
    });

    const capped = negotiationFailure(started, "neg-key", 429, "Negotiation limit reached for this session", listing.id);
    expect(capped.entries.find((entry) => entry.kind === "negotiation")).toMatchObject({
      error: "You've hit the negotiation limit for this session",
    });
  });

  it("records accept and walk away without dropping earlier cards", () => {
    let state = beginNegotiation(emptyTranscript(), listing, "shoes", "neg-key");
    state = applyNegotiationEvent(state, "neg-key", {
      type: "end",
      status: "agreed",
      finalPrice: 74,
      reason: "accepted",
    });
    const accepted = markAccepted(state, "neg-key");
    expect(accepted.soldIds).toEqual([listing.id]);
    expect(accepted.entries.map((entry) => entry.kind)).toEqual(["note", "negotiation", "note", "sold"]);
    expect(accepted.entries.at(-1)).toMatchObject({ kind: "sold", price: 74, saved: 16 });

    const walked = markWalked(state, "neg-key");
    expect(walked.entries.at(-1)).toMatchObject({ kind: "note", text: "You walked away" });
    expect(walked.entries.find((entry) => entry.kind === "negotiation")).toMatchObject({ decision: "walked" });
  });
});

describe("readNdjson", () => {
  it("parses lines split across chunks, including a last line with no newline", async () => {
    const seen: unknown[] = [];
    await readNdjson(stream(["{\"n\":1}\n{\"n\":", "2}\n\n", "{\"n\":3}"]), (event) => seen.push(event));
    expect(seen).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });
});

function stream(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
  );
}
