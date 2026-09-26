import { describe, expect, it } from "vitest";
import type { Category, ListingView, RequestItem } from "@/lib/schemas";
import { match } from "@/lib/match";
import { catalog, item, listingViews } from "./fixtures";

function category(id: string): Category {
  const found = catalog.categories.find((c) => c.id === id);
  if (!found) throw new Error(`missing category ${id}`);
  return found;
}

function shoesRequest(overrides: Partial<RequestItem> = {}): RequestItem {
  return item({
    category: "shoes",
    attributes: { type: "sport", size: "8", colour: "black" },
    preferences: ["nike air max"],
    maxPrice: 80,
    ...overrides,
  });
}

const SHOE_IDS = ["f-am90-8-used", "f-am90-8-new", "f-ultraboost-8"];

describe("match", () => {
  it("ranks the three shoe matches and tags the brand listing over budget", () => {
    const cards = match(shoesRequest(), category("shoes"), listingViews);
    expect(cards.map((c) => c.id)).toEqual(SHOE_IDS);
    expect(cards.map((c) => c.overBudget)).toEqual([false, true, false]);
    expect(cards[0]?.matchedPreferences).toEqual(["nike air max"]);
  });

  it("ignores case and surrounding whitespace on required attributes", () => {
    const cards = match(
      shoesRequest({ attributes: { type: "sport", size: " 8 ", colour: "Black" } }),
      category("shoes"),
      listingViews,
    );
    expect(cards.map((c) => c.id)).toEqual(SHOE_IDS);
    expect(cards.map((c) => c.overBudget)).toEqual([false, true, false]);
    expect(cards[0]?.matchedPreferences).toEqual(["nike air max"]);
  });

  it("hides listings above 1.5× the budget", () => {
    const cards = match(shoesRequest({ maxPrice: 60 }), category("shoes"), listingViews);
    expect(cards.map((c) => c.id)).toEqual(["f-am90-8-used", "f-ultraboost-8"]);
  });

  it("drops sold listings, wrong size, wrong type or colour, and a missing required attribute", () => {
    const ids = match(shoesRequest(), category("shoes"), listingViews).map((c) => c.id);
    expect(ids).not.toContain("f-sold-8");
    expect(ids).not.toContain("f-am90-10");
    expect(ids).not.toContain("f-gazelle-8-white");
    expect(ids).not.toContain("f-no-colour-8");
  });

  it("ranks an optional attribute hit above a cheaper miss", () => {
    const cheaper: ListingView = {
      id: "f-cheap-plain",
      sellerId: "f-pat",
      sellerName: "Pat",
      sellerType: "private",
      category: "shoes",
      title: "Plain sport shoe, black, UK 8",
      attributes: { type: "sport", size: "8", colour: "black" },
      askingPrice: 70,
      status: "active",
      busy: false,
    };
    const cards = match(
      shoesRequest({
        attributes: { type: "sport", size: "8", colour: "black", brand: "adidas" },
        preferences: [],
      }),
      category("shoes"),
      [...listingViews, cheaper],
    );
    expect(cards[0]?.id).toBe("f-ultraboost-8");
  });

  it("returns every active glasses listing within 1.5× when the category has no required fields", () => {
    const cards = match(item({ category: "glasses", maxPrice: 40 }), category("glasses"), listingViews);
    const eligible = listingViews
      .filter((l) => l.category === "glasses" && l.status === "active" && l.askingPrice <= 60)
      .sort((a, b) => a.askingPrice - b.askingPrice || a.id.localeCompare(b.id));
    expect(eligible.length).toBeGreaterThan(0);
    expect(cards.map((c) => c.id)).toEqual(eligible.map((l) => l.id));
    expect(cards.every((c) => c.category === "glasses" && c.status === "active" && c.askingPrice <= 60)).toBe(true);
  });

  it("returns the five cheapest of seven otherwise identical matches", () => {
    const listings = [70, 40, 55, 90, 48, 60, 80].map((askingPrice, i) => ({
      id: `f-dup-${i}`,
      sellerId: "f-pat",
      sellerName: "Pat",
      sellerType: "private" as const,
      category: "shoes",
      title: "Plain sport shoe",
      attributes: { type: "sport", size: "8", colour: "black" },
      askingPrice,
      status: "active" as const,
      busy: false,
    }));
    const cards = match(
      item({
        category: "shoes",
        attributes: { type: "sport", size: "8", colour: "black" },
        preferences: [],
        maxPrice: 80,
      }),
      category("shoes"),
      listings,
    );
    expect(cards).toHaveLength(5);
    expect(cards.map((c) => c.askingPrice)).toEqual([40, 48, 55, 60, 70]);
  });

  it("returns nothing when the budget is missing or the item is unticked", () => {
    expect(match(item({ maxPrice: null }), category("shoes"), listingViews)).toEqual([]);
    expect(
      match(
        item({
          included: false,
          maxPrice: 80,
          attributes: { type: "sport", size: "8", colour: "black" },
        }),
        category("shoes"),
        listingViews,
      ),
    ).toEqual([]);
  });

  it("never puts floorPrice on a card", () => {
    const cards = match(shoesRequest(), category("shoes"), listingViews);
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) expect(card).not.toHaveProperty("floorPrice");
  });

  it("follows required fields from the category row", () => {
    const stricter: Category = {
      ...category("shoes"),
      required: ["type", "size", "colour", "model"],
    };
    const cards = match(
      shoesRequest({
        attributes: { type: "sport", size: "8", colour: "black", model: "air max 90" },
      }),
      stricter,
      listingViews,
    );
    expect(cards.map((c) => c.id)).toEqual(["f-am90-8-used", "f-am90-8-new"]);
  });

  it("keeps a busy listing in its normal rank", () => {
    const listings = listingViews.map((l) => (l.id === "f-am90-8-used" ? { ...l, busy: true } : l));
    const cards = match(shoesRequest(), category("shoes"), listings);
    expect(cards.map((c) => c.id)).toEqual(SHOE_IDS);
    expect(cards[0]?.busy).toBe(true);
  });
});
