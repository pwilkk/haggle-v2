import { describe, expect, it } from "vitest";
import { applyResponse, emptyTranscript, entriesAfterReply } from "@/lib/client/entries";
import { fixtureChatResponses, fixtureCyclingTurns, fixtureNegotiationLines, fixtureShoesTurns } from "@/lib/client/fixtures";
import { ChatResponse, NegotiationEvent } from "@/lib/schemas";
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
