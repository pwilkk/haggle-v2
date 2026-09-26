import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ItemMatches } from "@/lib/schemas";

const llm = vi.hoisted(() => ({
  completeJSON: vi.fn(),
  completeText: vi.fn(),
}));

vi.mock("@/lib/llm", () => llm);

import { extractDraft, writeReply } from "@/lib/agents/buyer";
import { catalog, item, listingViews } from "./fixtures";

const messages = [{ role: "user" as const, content: "I want black sport shoes" }];

beforeEach(() => {
  llm.completeJSON.mockReset();
  llm.completeText.mockReset();
  llm.completeJSON.mockResolvedValue({ bundle: null, dropped: [], items: [] });
  llm.completeText.mockResolvedValue("Two quick questions.");
});

describe("buyer prompts", () => {
  it("asks for an IntakeDraft at temperature 0 and never sends a floor price", async () => {
    await extractDraft({
      messages,
      catalog,
      vocab: { shoes: { colour: ["black"], size: ["8"] } },
      prev: null,
    });
    expect(llm.completeJSON).toHaveBeenCalledTimes(1);
    const [schema, sent, opts] = llm.completeJSON.mock.calls[0] ?? [];
    expect(schema).toBeDefined();
    expect(opts).toEqual({ temperature: 0 });
    const system = sent[0].content as string;
    const user = sent[1].content as string;
    expect(system).toContain("Reply with JSON only, matching this JSON schema:");
    expect(system).toContain("Never guess.");
    expect(system).toContain('A single total for several items ("£800 for everything") is NOT a per-item budget');
    expect(user).toContain("CATALOG:");
    expect(user).toContain("KNOWN_VALUES:");
    expect(user).toContain("PREVIOUS: null");
    expect(user).toContain("user: I want black sport shoes");
    expect(user).not.toContain("floorPrice");
    expect(user).not.toContain("persona");
  });

  it("shows the buyer their budget and hides any floor price on a match", async () => {
    const poisoned = {
      ...listingViews[0]!,
      overBudget: false,
      matchedPreferences: ["nike air max"],
      floorPrice: 41,
    } as ItemMatches["listings"][number];
    await writeReply({
      messages,
      request: {
        id: "req-1",
        sessionId: "b7e20000-0000-4000-8000-000000000001",
        bundle: "kit",
        status: "gathering",
        items: [item({ category: "bike", maxPrice: 500 })],
      },
      missing: [{ category: "bike", fields: ["type", "frame_size"] }],
      catalog,
      vocab: {},
      matches: [{ category: "shoes", listings: [poisoned] }],
      firstBundleTurn: true,
    });
    const [sent, opts] = llm.completeText.mock.calls[0] ?? [];
    expect(opts).toEqual({ temperature: 0.3 });
    const system = sent[0].content as string;
    const user = sent[1].content as string;
    expect(system).toContain("Never promise a price, never mention sellers' lowest prices");
    expect(system).toContain("FIRST_BUNDLE_TURN=true");
    expect(user).toContain("FIRST_BUNDLE_TURN: true");
    expect(user).toContain('"maxPrice":500');
    expect(user).toContain("Used Nike Air Max 90, black, UK 8");
    expect(user).toContain('"askingPrice":90');
    expect(user).not.toContain("floorPrice");
    expect(user).not.toContain("41");
  });

  it("sends an empty match list when nothing was found", async () => {
    await writeReply({
      messages,
      request: {
        id: "req-1",
        sessionId: "b7e20000-0000-4000-8000-000000000001",
        bundle: null,
        status: "ready",
        items: [item({ category: "shoes", attributes: { type: "sport", size: "8", colour: "black" }, maxPrice: 80 })],
      },
      missing: [],
      catalog,
      vocab: {},
      matches: [{ category: "shoes", listings: [] }],
      firstBundleTurn: false,
    });
    const user = llm.completeText.mock.calls[0]?.[0][1].content as string;
    expect(user).toContain("MATCHES: []");
    expect(user).toContain("FIRST_BUNDLE_TURN: false");
  });
});
