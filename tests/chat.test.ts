import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IntakeDraft, ListingView } from "@/lib/schemas";
import { HttpError } from "@/lib/http";
import { MAX_MESSAGE_CHARS, MAX_MESSAGES } from "@/lib/schemas";
import { catalog, listingViews } from "./fixtures";

const db = vi.hoisted(() => ({
  loadCatalog: vi.fn(),
  listActiveListingViews: vi.fn(),
  getRequest: vi.fn(),
  saveRequest: vi.fn(),
}));

const llm = vi.hoisted(() => ({
  completeJSON: vi.fn(),
  completeText: vi.fn(),
}));

vi.mock("@/lib/db", () => db);
vi.mock("@/lib/llm", () => llm);

import { POST } from "@/app/api/chat/route";

const SESSION = "b7e20000-0000-4000-8000-000000000001";

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

function chat(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: SESSION,
    requestId: null,
    messages: [{ role: "user", content: "I want black sport shoes" }],
    excluded: [],
    ...overrides,
  };
}

const shoesDraft: IntakeDraft = {
  bundle: null,
  dropped: [],
  items: [
    {
      category: "shoes",
      attributes: { type: "sport", size: "8", colour: "black" },
      preferences: ["nike air max"],
      maxPrice: 80,
    },
  ],
};

beforeEach(() => {
  db.loadCatalog.mockReset();
  db.listActiveListingViews.mockReset();
  db.getRequest.mockReset();
  db.saveRequest.mockReset();
  llm.completeJSON.mockReset();
  llm.completeText.mockReset();
  db.loadCatalog.mockResolvedValue(catalog);
  db.listActiveListingViews.mockResolvedValue(withFloors(listingViews));
  db.getRequest.mockResolvedValue(null);
  db.saveRequest.mockImplementation(async (row: { id: string | null }) => ({ ...row, id: row.id ?? "req-1" }));
  llm.completeJSON.mockResolvedValue(shoesDraft);
  llm.completeText.mockResolvedValue("Found 3 matches. Pat's pair is the closest fit.");
});

describe("POST /api/chat", () => {
  it("returns ranked matches and strips floor prices", async () => {
    const res = await post(chat());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reply).toBe("Found 3 matches. Pat's pair is the closest fit.");
    expect(body.request.status).toBe("ready");
    expect(body.request.items[0].preferences).toEqual(["nike air max"]);
    expect(body.missing).toEqual([]);
    expect(body.matches[0].listings.map((listing: { id: string }) => listing.id)).toEqual([
      "f-am90-8-used",
      "f-am90-8-new",
      "f-ultraboost-8",
    ]);
    expect(body.matches[0].listings.map((listing: { overBudget: boolean }) => listing.overBudget)).toEqual([
      false,
      true,
      false,
    ]);
    expect(body.sellersAsked).toBe(2);
    expect(body.catalog.categories.map((category: { id: string }) => category.id)).toEqual(["shoes"]);
    expect(body.catalog.bundle).toBeNull();
    expect(db.getRequest).not.toHaveBeenCalled();
    const text = JSON.stringify(body);
    expect(text).not.toContain("floorPrice");
    expect(text).not.toContain("41");
  });

  it("asks for the missing size and budget and does not match yet", async () => {
    llm.completeJSON.mockResolvedValue({
      bundle: null,
      dropped: [],
      items: [{ category: "shoes", attributes: { type: "sport", colour: "black" }, preferences: [], maxPrice: null }],
    });
    llm.completeText.mockResolvedValue("What's your size, and what's the most you'd pay?");
    const res = await post(chat());
    const body = await res.json();
    expect(body.request.status).toBe("gathering");
    expect(body.missing).toEqual([{ category: "shoes", fields: ["size", "maxPrice"] }]);
    expect(body.matches).toBeNull();
    expect(body.sellersAsked).toBeNull();
    expect(llm.completeText.mock.calls[0]?.[0][1].content).toContain("MATCHES: null");
  });

  it("treats another session's request id as a new request", async () => {
    const res = await post(chat({ requestId: "someone-elses" }));
    expect(res.status).toBe(200);
    expect(db.getRequest).toHaveBeenCalledWith("someone-elses", SESSION);
    expect(db.saveRequest).toHaveBeenCalledWith(expect.objectContaining({ id: null, sessionId: SESSION }));
    const body = await res.json();
    expect(body.requestId).toBe("req-1");
  });

  it("does not rematch when the ready request is unchanged", async () => {
    const first = await post(chat());
    const ready = (await first.json()).request;
    db.getRequest.mockResolvedValue(ready);
    db.saveRequest.mockImplementation(async (row: { id: string | null }) => ({ ...row, id: row.id ?? ready.id }));
    const res = await post(chat({ requestId: ready.id, messages: [
      { role: "user", content: "I want black sport shoes" },
      { role: "assistant", content: "Found 3 matches." },
      { role: "user", content: "Those look good" },
    ] }));
    const body = await res.json();
    expect(body.matches).toBeNull();
    expect(body.sellersAsked).toBeNull();
    expect(body.request.status).toBe("ready");
  });

  it("skips a dropped bundle item when matching", async () => {
    llm.completeJSON.mockResolvedValue({
      bundle: "kit",
      dropped: [],
      items: [
        { category: "bike", attributes: { type: "hybrid", frame_size: "l" }, preferences: [], maxPrice: 500 },
        { category: "helmet", attributes: { size: "m" }, preferences: [], maxPrice: 60 },
        { category: "jacket", attributes: { size: "l" }, preferences: [], maxPrice: 50 },
        { category: "glasses", attributes: {}, preferences: [], maxPrice: 30 },
      ],
    });
    const res = await post(chat({ content: undefined, messages: [{ role: "user", content: "I want to start cycling" }], excluded: ["jacket"] }));
    const body = await res.json();
    expect(body.request.status).toBe("ready");
    expect(body.request.items.find((row: { category: string }) => row.category === "jacket").included).toBe(false);
    expect(body.matches.map((group: { category: string }) => group.category)).toEqual(["bike", "helmet", "glasses"]);
    expect(body.catalog.bundle.id).toBe("kit");
    expect(llm.completeText.mock.calls[0]?.[0][1].content).toContain("FIRST_BUNDLE_TURN: true");
  });

  it("replies without the model when the catalogue is empty", async () => {
    db.loadCatalog.mockResolvedValue({ categories: [], bundles: [] });
    const res = await post(chat());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reply).toBe("The marketplace is empty right now, check back soon.");
    expect(body.request).toMatchObject({ items: [], status: "gathering" });
    expect(body.matches).toBeNull();
    expect(llm.completeJSON).not.toHaveBeenCalled();
    expect(llm.completeText).not.toHaveBeenCalled();
    expect(db.listActiveListingViews).toHaveBeenCalledWith(SESSION);
  });

  it("rejects a message over 500 characters and a chat over 30 messages", async () => {
    const tooLong = await post(chat({ messages: [{ role: "user", content: "a".repeat(MAX_MESSAGE_CHARS + 1) }] }));
    expect(tooLong.status).toBe(400);
    expect((await tooLong.json()).error).toBe("Message is too long");

    const full = await post(chat({ messages: history(MAX_MESSAGES + 1) }));
    expect(full.status).toBe(429);
    expect((await full.json()).error).toBe("This chat is full, start a new one");

    const notUser = await post(chat({ messages: [{ role: "assistant", content: "hello" }] }));
    expect(notUser.status).toBe(400);

    expect(llm.completeJSON).not.toHaveBeenCalled();
  });

  it("accepts a 500 character message and a 30 message history", async () => {
    const exact = await post(chat({ messages: [{ role: "user", content: "a".repeat(MAX_MESSAGE_CHARS) }] }));
    expect(exact.status).toBe(200);
    const thirty = await post(chat({ messages: history(MAX_MESSAGES) }));
    expect(thirty.status).toBe(200);
  });

  it("returns 400 for a bad body and 502 when the model fails", async () => {
    const invalid = await post("not-json");
    expect(invalid.status).toBe(400);
    const badSession = await post(chat({ sessionId: "nope" }));
    expect(badSession.status).toBe(400);

    llm.completeJSON.mockRejectedValue(new HttpError(502, "The buying agent failed to reply. Try again."));
    const failed = await post(chat());
    expect(failed.status).toBe(502);
    expect(db.saveRequest).not.toHaveBeenCalled();
  });

  it("allows a missing excluded list", async () => {
    const body = chat();
    delete (body as { excluded?: string[] }).excluded;
    const res = await post(body);
    expect(res.status).toBe(200);
  });
});

function history(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    role: index === count - 1 || index % 2 === 0 ? "user" : "assistant",
    content: index === count - 1 ? "hello" : "ok",
  }));
}

function withFloors(listings: ListingView[]): ListingView[] {
  return listings.map((listing) => ({ ...listing, floorPrice: 41 }) as ListingView);
}
