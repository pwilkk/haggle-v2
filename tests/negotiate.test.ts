import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http";
import { AgentMove, NegotiationEvent, type Listing, type Offer } from "@/lib/schemas";
import { readNdjson } from "@/lib/client/stream";
import { privateListing } from "./fixtures";

const db = vi.hoisted(() => ({
  countNegotiations: vi.fn(),
  getRequest: vi.fn(),
  getListingPrivate: vi.fn(),
  lockListing: vi.fn(),
  releaseListing: vi.fn(),
  createNegotiation: vi.fn(),
  finishNegotiation: vi.fn(),
  acceptNegotiation: vi.fn(),
  walkAwayNegotiation: vi.fn(),
}));

const llm = vi.hoisted(() => ({
  completeJSON: vi.fn(),
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return { ...actual, ...db };
});
vi.mock("@/lib/llm", () => llm);

import { POST as accept } from "@/app/api/accept/route";
import { POST as negotiate } from "@/app/api/negotiate/route";
import { POST as walkAway } from "@/app/api/walk-away/route";

const SESSION = "b7e20000-0000-4000-8000-000000000001";
const OTHER = "c8f30000-0000-4000-8000-000000000002";
const PERSONA = "quick-sale persona token that must stay on the server";
const PREFERENCE = "secret-pref-token";

function requestRow(maxPrice: number | null, included = true) {
  return {
    id: "req-1",
    sessionId: SESSION,
    bundle: null,
    status: maxPrice == null ? "gathering" : "ready",
    items: [
      {
        category: "shoes",
        included,
        attributes: { type: "sport", colour: "black", size: "8" },
        preferences: [PREFERENCE],
        maxPrice,
      },
    ],
  };
}

function listingBundle(overrides: Partial<Listing> = {}) {
  const listing = { ...privateListing("f-am90-8-used"), ...overrides };
  return {
    listing,
    seller: {
      id: listing.sellerId,
      name: "Tom",
      type: "private" as const,
      persona: PERSONA,
    },
  };
}

function post(handler: (req: Request) => Promise<Response>, url: string, body: unknown) {
  return handler(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

function negotiateBody(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: SESSION,
    requestId: "req-1",
    category: "shoes",
    listingId: "f-am90-8-used",
    ...overrides,
  };
}

async function eventsOf(res: Response): Promise<{ events: NegotiationEvent[]; raw: string }> {
  const raw = await res.text();
  const replay = new Response(raw, { headers: { "content-type": res.headers.get("content-type") ?? "" } });
  const events: NegotiationEvent[] = [];
  await readNdjson(replay, (event) => events.push(NegotiationEvent.parse(event)));
  return { events, raw };
}

beforeEach(() => {
  db.countNegotiations.mockReset();
  db.getRequest.mockReset();
  db.getListingPrivate.mockReset();
  db.lockListing.mockReset();
  db.releaseListing.mockReset();
  db.createNegotiation.mockReset();
  db.finishNegotiation.mockReset();
  db.acceptNegotiation.mockReset();
  db.walkAwayNegotiation.mockReset();
  llm.completeJSON.mockReset();

  db.countNegotiations.mockResolvedValue(0);
  db.getRequest.mockResolvedValue(requestRow(120));
  db.getListingPrivate.mockResolvedValue(listingBundle());
  db.lockListing.mockResolvedValue(true);
  db.releaseListing.mockResolvedValue(undefined);
  db.createNegotiation.mockResolvedValue("neg-1");
  db.finishNegotiation.mockResolvedValue(undefined);
  llm.completeJSON.mockResolvedValue({ action: "accept", price: 90, message: "Deal at £90." });
});

describe("POST /api/negotiate", () => {
  it("streams one start, the turns, and one end, with no private fields", async () => {
    const res = await post(negotiate, "http://localhost/api/negotiate", negotiateBody());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    expect(res.headers.get("cache-control")).toBe("no-store");

    const { events, raw } = await eventsOf(res);
    expect(events[0]).toMatchObject({ type: "start", negotiationId: "neg-1" });
    expect(events.filter((event) => event.type === "start")).toHaveLength(1);
    expect(events.filter((event) => event.type === "end")).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: "end", status: "agreed", finalPrice: 90, reason: "accepted" });
    const turns = events.filter((event) => event.type === "turn");
    expect(turns.map((event) => (event.type === "turn" ? event.n : 0))).toEqual([1, 2]);
    expect(raw).not.toContain("floorPrice");
    expect(raw).not.toContain("maxPrice");
    expect(raw).not.toContain("persona");
    expect(raw).not.toContain(PERSONA);
    expect(raw).not.toContain(PREFERENCE);
    expect(raw).not.toContain("120");
    expect(raw).not.toContain("70");

    const systems = llm.completeJSON.mock.calls.map((call) => {
      const messages = call[1] as Array<{ content: string }>;
      return messages[0]?.content ?? "";
    });
    const buyerSystem = systems.find((text) => text.includes("buying agent"));
    const sellerSystem = systems.find((text) => text.includes("selling agent"));
    expect(buyerSystem).toContain("£120");
    expect(buyerSystem).toContain(PREFERENCE);
    expect(buyerSystem).not.toContain(PERSONA);
    expect(buyerSystem).not.toContain("£70");
    expect(sellerSystem).toContain("£70");
    expect(sellerSystem).toContain(PERSONA);
    expect(sellerSystem).not.toContain("£120");
    expect(sellerSystem).not.toContain(PREFERENCE);
    expect(llm.completeJSON).toHaveBeenCalledWith(AgentMove, expect.any(Array), { temperature: 0 });

    expect(db.lockListing).toHaveBeenCalledTimes(2);
    expect(db.releaseListing).not.toHaveBeenCalled();
    expect(db.finishNegotiation).toHaveBeenCalledWith(
      "neg-1",
      expect.objectContaining({ status: "agreed", finalPrice: 90 }),
    );
  });

  it("releases the lock when the haggle fails", async () => {
    db.getRequest.mockResolvedValue(requestRow(50));
    llm.completeJSON.mockResolvedValue({ action: "offer", price: null, message: "I'll stay." });
    const res = await post(negotiate, "http://localhost/api/negotiate", negotiateBody());
    const { events } = await eventsOf(res);
    expect(events.at(-1)).toMatchObject({ type: "end", status: "failed", finalPrice: null, reason: "max_turns" });
    expect(db.lockListing).toHaveBeenCalledTimes(1);
    expect(db.releaseListing).toHaveBeenCalledWith("f-am90-8-used", SESSION);
    const turns = db.finishNegotiation.mock.calls[0]?.[1].turns as Offer[];
    expect(turns.every((turn) => (turn.from === "buyer_agent" ? turn.price <= 50 : turn.price >= 70))).toBe(true);
  }, 20_000);

  it("finishes the row and releases the lock when the run crashes", async () => {
    db.finishNegotiation.mockRejectedValueOnce(new Error("db write failed"));
    const res = await post(negotiate, "http://localhost/api/negotiate", negotiateBody());
    const { events } = await eventsOf(res);
    expect(events.some((event) => event.type === "end")).toBe(false);
    expect(events.at(-1)).toEqual({ type: "error", message: "Negotiation interrupted" });
    expect(db.finishNegotiation).toHaveBeenLastCalledWith(
      "neg-1",
      expect.objectContaining({ status: "failed", finalPrice: null }),
    );
    expect(db.releaseListing).toHaveBeenCalledWith("f-am90-8-used", SESSION);
  });

  it("returns 429 before taking the lock on the 11th negotiation", async () => {
    db.countNegotiations.mockResolvedValue(10);
    const res = await post(negotiate, "http://localhost/api/negotiate", negotiateBody());
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Negotiation limit reached for this session" });
    expect(db.lockListing).not.toHaveBeenCalled();
    expect(db.createNegotiation).not.toHaveBeenCalled();
  });

  it("returns 409 when the listing is sold or busy, and 404 when it is missing", async () => {
    db.getListingPrivate.mockResolvedValue(listingBundle({ status: "sold" }));
    const sold = await post(negotiate, "http://localhost/api/negotiate", negotiateBody());
    expect(sold.status).toBe(409);
    expect(await sold.json()).toEqual({ error: "Listing sold" });

    db.getListingPrivate.mockResolvedValue(listingBundle());
    db.lockListing.mockResolvedValue(false);
    const busy = await post(negotiate, "http://localhost/api/negotiate", negotiateBody({ sessionId: OTHER }));
    expect(busy.status).toBe(409);
    expect(await busy.json()).toEqual({ error: "Listing busy" });
    expect(db.createNegotiation).not.toHaveBeenCalled();

    db.getListingPrivate.mockResolvedValue(null);
    const missing = await post(negotiate, "http://localhost/api/negotiate", negotiateBody());
    expect(missing.status).toBe(404);
  });

  it("returns 409 when the item is not ready and 400 when the category does not match", async () => {
    db.getRequest.mockResolvedValue(requestRow(null));
    const unready = await post(negotiate, "http://localhost/api/negotiate", negotiateBody());
    expect(unready.status).toBe(409);
    expect(await unready.json()).toEqual({ error: "Item not ready" });
    expect(db.lockListing).not.toHaveBeenCalled();

    db.getRequest.mockResolvedValue(requestRow(80));
    db.getListingPrivate.mockResolvedValue(listingBundle({ category: "bike" }));
    const mismatch = await post(negotiate, "http://localhost/api/negotiate", negotiateBody());
    expect(mismatch.status).toBe(400);
    expect(db.lockListing).not.toHaveBeenCalled();
  });

  it("releases the lock when the negotiation row cannot be created", async () => {
    db.createNegotiation.mockRejectedValue(new Error("insert failed"));
    const res = await post(negotiate, "http://localhost/api/negotiate", negotiateBody());
    expect(res.status).toBe(500);
    expect(db.releaseListing).toHaveBeenCalledWith("f-am90-8-used", SESSION);
  });

  it("returns 404 for an unknown request and 400 for a bad body", async () => {
    db.getRequest.mockResolvedValue(null);
    const missing = await post(negotiate, "http://localhost/api/negotiate", negotiateBody());
    expect(missing.status).toBe(404);
    expect(db.lockListing).not.toHaveBeenCalled();

    const bad = await post(negotiate, "http://localhost/api/negotiate", "{");
    expect(bad.status).toBe(400);
  });
});

describe("POST /api/accept", () => {
  it("returns the accept result for the lock holder", async () => {
    const body = {
      negotiationId: "neg-1",
      status: "accepted" as const,
      finalPrice: 74,
      listing: {
        id: "f-am90-8-used",
        sellerId: "f-pat",
        category: "shoes",
        title: "Used Nike Air Max 90, black, UK 8",
        attributes: { type: "sport" },
        askingPrice: 90,
        status: "sold" as const,
        sellerName: "Pat",
        sellerType: "private" as const,
        busy: false,
      },
    };
    db.acceptNegotiation.mockResolvedValue(body);
    const res = await post(accept, "http://localhost/api/accept", { sessionId: SESSION, negotiationId: "neg-1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(body);
    expect(db.acceptNegotiation).toHaveBeenCalledWith("neg-1", SESSION);
  });

  it("passes through not agreed, deal expired, and a wrong session", async () => {
    db.acceptNegotiation.mockRejectedValue(new HttpError(409, "Negotiation not agreed"));
    const unready = await post(accept, "http://localhost/api/accept", { sessionId: SESSION, negotiationId: "neg-1" });
    expect(unready.status).toBe(409);

    db.acceptNegotiation.mockRejectedValue(new HttpError(409, "Deal expired"));
    const expired = await post(accept, "http://localhost/api/accept", { sessionId: SESSION, negotiationId: "neg-1" });
    expect(expired.status).toBe(409);
    expect(await expired.json()).toEqual({ error: "Deal expired" });

    db.acceptNegotiation.mockRejectedValue(new HttpError(404, "Not found"));
    const missing = await post(accept, "http://localhost/api/accept", { sessionId: OTHER, negotiationId: "neg-1" });
    expect(missing.status).toBe(404);
  });
});

describe("POST /api/walk-away", () => {
  it("releases via the helper and returns ok", async () => {
    db.walkAwayNegotiation.mockResolvedValue(undefined);
    const res = await post(walkAway, "http://localhost/api/walk-away", {
      sessionId: SESSION,
      negotiationId: "neg-1",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(db.walkAwayNegotiation).toHaveBeenCalledWith("neg-1", SESSION);
  });

  it("returns 404 for another session's negotiation", async () => {
    db.walkAwayNegotiation.mockRejectedValue(new HttpError(404, "Not found"));
    const res = await post(walkAway, "http://localhost/api/walk-away", {
      sessionId: OTHER,
      negotiationId: "neg-1",
    });
    expect(res.status).toBe(404);
  });
});
