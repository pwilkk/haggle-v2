import type { Category, ListingView, MatchCard, RequestItem } from "./schemas";

export const STRETCH = 1.3; // above maxPrice × 1.3 the card is tagged over budget
export const SHOW_STRETCH = 1.5; // above maxPrice × 1.5 the listing is hidden
export const TOP_N = 5;

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");

export function match(item: RequestItem, category: Category, listings: ListingView[]): MatchCard[] {
  if (!item.included || item.maxPrice === null) return [];
  const max = item.maxPrice;
  return listings
    .filter((l) => l.category === category.id && l.status === "active")
    .filter((l) =>
      category.required.every((k) => {
        const want = norm(item.attributes[k]);
        return want !== "" && want === norm(l.attributes[k]);
      }),
    )
    .filter((l) => l.askingPrice <= max * SHOW_STRETCH)
    .map((l) => {
      const hay = norm(`${l.title} ${Object.values(l.attributes).join(" ")}`);
      const matchedPreferences = item.preferences.filter((p) => {
        const needle = norm(p);
        return needle !== "" && hay.includes(needle);
      });
      const optionalHits = category.optional.filter((k) => {
        const want = norm(item.attributes[k]);
        return want !== "" && want === norm(l.attributes[k]);
      }).length;
      return {
        card: { ...l, overBudget: l.askingPrice > max * STRETCH, matchedPreferences },
        score: optionalHits + matchedPreferences.length,
      };
    })
    .sort(
      (a, b) => b.score - a.score || a.card.askingPrice - b.card.askingPrice || a.card.id.localeCompare(b.card.id),
    )
    .slice(0, TOP_N)
    .map((x) => x.card);
}
