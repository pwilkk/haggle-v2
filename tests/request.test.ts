import { describe, expect, it } from "vitest";
import type { BuyerRequest, IntakeDraft, ListingView } from "@/lib/schemas";
import { buildRequest, fieldVocab, shouldMatch } from "@/lib/request";
import { catalog, listingViews } from "./fixtures";

const SESSION = "b7e20000-0000-4000-8000-000000000001";

function ctx(overrides: { excluded?: string[]; prev?: BuyerRequest | null } = {}) {
  return { catalog, excluded: overrides.excluded ?? [], prev: overrides.prev ?? null, sessionId: SESSION };
}

function draft(overrides: Partial<IntakeDraft> = {}): IntakeDraft {
  return { bundle: null, dropped: [], items: [], ...overrides };
}

function shoesItem(overrides: Partial<IntakeDraft["items"][number]> = {}): IntakeDraft["items"][number] {
  return {
    category: "shoes",
    attributes: { type: "sport", size: "8", colour: "black" },
    preferences: [],
    maxPrice: 80,
    ...overrides,
  };
}

function saved(result: ReturnType<typeof buildRequest>, id = "req-1"): BuyerRequest {
  return { ...result.request, id: result.request.id ?? id };
}

describe("buildRequest", () => {
  it("drops an unknown category", () => {
    const result = buildRequest(
      draft({
        items: [
          { category: "boats", attributes: { hull: "wood" }, preferences: [], maxPrice: 50 },
          shoesItem(),
        ],
      }),
      ctx(),
    );
    expect(result.request.items.map((item) => item.category)).toEqual(["shoes"]);
  });

  it("drops unknown attributes and normalises values", () => {
    const result = buildRequest(
      draft({
        items: [
          shoesItem({
            attributes: { colour: "Black", size: 8, flavour: "mint", type: " Sport " } as unknown as Record<string, string>,
            preferences: [" Nike ", "nike", ""],
            maxPrice: 80.6,
          }),
        ],
      }),
      ctx(),
    );
    const item = result.request.items[0];
    expect(item?.attributes).toEqual({ colour: "black", size: "8", type: "sport" });
    expect(item?.attributes).not.toHaveProperty("flavour");
    expect(item?.preferences).toEqual(["nike"]);
    expect(item?.maxPrice).toBe(81);
  });

  it("treats a non-positive budget as missing", () => {
    const result = buildRequest(draft({ items: [shoesItem({ maxPrice: 0 })] }), ctx());
    expect(result.request.items[0]?.maxPrice).toBeNull();
    expect(result.missing[0]?.fields).toContain("maxPrice");
  });

  it("fills a partial bundle in bundle order", () => {
    const result = buildRequest(
      draft({
        bundle: "kit",
        items: [{ category: "glasses", attributes: {}, preferences: ["oakley"], maxPrice: null }],
      }),
      ctx(),
    );
    expect(result.request.bundle).toBe("kit");
    expect(result.request.items.map((item) => item.category)).toEqual(["bike", "helmet", "jacket", "glasses"]);
    expect(result.request.items[3]?.preferences).toEqual(["oakley"]);
  });

  it("keeps the last draft item when a category is repeated", () => {
    const result = buildRequest(
      draft({
        items: [shoesItem({ attributes: { colour: "white" } }), shoesItem({ attributes: { colour: "black", type: "sport", size: "8" } })],
      }),
      ctx(),
    );
    expect(result.request.items).toHaveLength(1);
    expect(result.request.items[0]?.attributes.colour).toBe("black");
  });

  it("unticking a jacket removes it from missing and still allows ready", () => {
    const result = buildRequest(draft({ bundle: "kit", items: completeKit({ jacket: 40 }) }), ctx({ excluded: ["jacket"] }));
    const jacket = result.request.items.find((item) => item.category === "jacket");
    expect(jacket?.included).toBe(false);
    expect(result.missing.map((row) => row.category)).not.toContain("jacket");
    expect(result.request.status).toBe("ready");
    expect(result.missing).toEqual([]);
  });

  it("marks a dropped helmet as not included", () => {
    const result = buildRequest(
      draft({ bundle: "kit", dropped: ["helmet"], items: completeKit() }),
      ctx(),
    );
    expect(result.request.items.find((item) => item.category === "helmet")?.included).toBe(false);
    expect(result.missing.map((row) => row.category)).not.toContain("helmet");
  });

  it("asks for a budget on every bundle item that does not have one", () => {
    const result = buildRequest(
      draft({
        bundle: "kit",
        items: completeKit().map((item) => ({ ...item, maxPrice: item.category === "bike" ? 500 : null })),
      }),
      ctx(),
    );
    expect(result.missing.find((row) => row.category === "bike")).toBeUndefined();
    for (const category of ["helmet", "jacket", "glasses"]) {
      expect(result.missing.find((row) => row.category === category)?.fields).toEqual(["maxPrice"]);
    }
    expect(result.request.status).toBe("gathering");
  });

  it("is ready when every ticked bundle item has its fields and its own budget", () => {
    const result = buildRequest(draft({ bundle: "kit", items: completeKit() }), ctx());
    expect(result.request.status).toBe("ready");
    expect(result.missing).toEqual([]);
    expect(result.request.items.every((item) => item.included && item.maxPrice != null)).toBe(true);
  });

  it("is ready when a single item has every required field and a budget", () => {
    const result = buildRequest(draft({ items: [shoesItem()] }), ctx());
    expect(result.request.status).toBe("ready");
    expect(result.missing).toEqual([]);
  });

  it("does not rematch an unchanged ready request, and does when the size changes", () => {
    const first = saved(buildRequest(draft({ items: [shoesItem()] }), ctx()));
    const same = saved(buildRequest(draft({ items: [shoesItem()] }), ctx({ prev: first })));
    expect(shouldMatch(first, same)).toBe(false);

    const resized = saved(
      buildRequest(draft({ items: [shoesItem({ attributes: { type: "sport", size: "9", colour: "black" } })] }), ctx({ prev: first })),
    );
    expect(shouldMatch(first, resized)).toBe(true);
    expect(shouldMatch(null, first)).toBe(true);
    expect(shouldMatch(first, { ...first, status: "gathering" })).toBe(false);

    const reordered: BuyerRequest = {
      ...first,
      items: first.items.map((item) => ({
        maxPrice: item.maxPrice,
        preferences: item.preferences,
        included: item.included,
        category: item.category,
        attributes: { colour: "black", type: "sport", size: "8" },
      })),
    };
    expect(shouldMatch(first, reordered)).toBe(false);
  });

  it("keeps the previous bundle when the draft names an unknown one", () => {
    const prev = saved(buildRequest(draft({ bundle: "kit", items: completeKit() }), ctx()));
    const result = buildRequest(draft({ bundle: "no-such-bundle", items: [] }), ctx({ prev }));
    expect(result.request.bundle).toBe("kit");
    expect(result.request.id).toBe(prev.id);
    expect(result.request.items.map((item) => item.category)).toEqual(["bike", "helmet", "jacket", "glasses"]);
  });
});

describe("fieldVocab", () => {
  it("collects sorted active values per category field", () => {
    const vocab = fieldVocab(catalog, listingViews);
    expect(vocab.shoes?.colour).toEqual(["black", "white"]);
    expect(vocab.shoes?.size).toEqual(["10", "8"]);
    expect(vocab.shoes?.type).toEqual(["casual", "sport"]);
    expect(JSON.stringify(vocab)).not.toContain("floorPrice");
  });

  it("ignores sold listings and caps each field at 15 values", () => {
    const sold: ListingView = {
      ...listingViews[0]!,
      id: "sold-purple",
      status: "sold",
      attributes: { colour: "purple" },
    };
    const many: ListingView[] = Array.from({ length: 16 }, (_, index) => ({
      id: `colour-${index}`,
      sellerId: "f-pat",
      sellerName: "Pat",
      sellerType: "private" as const,
      category: "shoes",
      title: "Shoe",
      attributes: { colour: `c${String(index).padStart(2, "0")}` },
      askingPrice: 40,
      status: "active" as const,
      busy: false,
    }));
    const vocab = fieldVocab(catalog, [sold, ...many]);
    expect(vocab.shoes?.colour).not.toContain("purple");
    expect(vocab.shoes?.colour).toHaveLength(15);
    expect(vocab.shoes?.colour?.[0]).toBe("c00");
    expect(vocab.shoes?.colour).not.toContain("c15");
  });
});

function completeKit(prices: { jacket?: number } = {}): IntakeDraft["items"] {
  return [
    { category: "bike", attributes: { type: "hybrid", frame_size: "l" }, preferences: [], maxPrice: 500 },
    { category: "helmet", attributes: { size: "m" }, preferences: [], maxPrice: 60 },
    { category: "jacket", attributes: { size: "l" }, preferences: [], maxPrice: prices.jacket ?? 50 },
    { category: "glasses", attributes: {}, preferences: [], maxPrice: 30 },
  ];
}
