import type { BuyerRequest, Catalog, Category, IntakeDraft, ListingView, MissingItem, RequestItem } from "./schemas";

/** categoryId → field → known values */
export type Vocab = Record<string, Record<string, string[]>>;

const MAX_VALUES = 15;

export function fieldVocab(catalog: Catalog, listings: ListingView[]): Vocab {
  const vocab: Vocab = {};
  for (const category of catalog.categories) {
    const fields = [...new Set([...category.required, ...category.optional])];
    const buckets = new Map<string, Set<string>>(fields.map((field) => [field, new Set()]));
    for (const listing of listings) {
      if (listing.category !== category.id || listing.status !== "active") continue;
      for (const field of fields) {
        const value = String(listing.attributes[field] ?? "").trim().toLowerCase();
        if (value) buckets.get(field)?.add(value);
      }
    }
    const known: Record<string, string[]> = {};
    for (const field of fields) {
      known[field] = [...(buckets.get(field) ?? [])].sort((a, b) => a.localeCompare(b)).slice(0, MAX_VALUES);
    }
    vocab[category.id] = known;
  }
  return vocab;
}

export function buildRequest(
  draft: IntakeDraft,
  ctx: { catalog: Catalog; excluded: string[]; prev: BuyerRequest | null; sessionId: string },
): { request: Omit<BuyerRequest, "id"> & { id: string | null }; missing: MissingItem[] } {
  const categories = new Map(ctx.catalog.categories.map((category) => [category.id, category]));
  const bundle = resolveBundle(draft.bundle, ctx.catalog, ctx.prev);
  const excluded = new Set([...ctx.excluded, ...draft.dropped]);

  const byCategory = new Map<string, RequestItem>();
  for (const raw of draft.items) {
    const category = categories.get(raw.category);
    if (!category) continue;
    byCategory.set(raw.category, toItem(raw, category, excluded));
  }

  const items: RequestItem[] = [];
  if (bundle.row) {
    const bundled = new Set(bundle.row.categoryIds);
    for (const categoryId of bundle.row.categoryIds) {
      const category = categories.get(categoryId);
      items.push(byCategory.get(categoryId) ?? blankItem(categoryId, category, excluded));
    }
    for (const [categoryId, item] of byCategory) {
      if (!bundled.has(categoryId)) items.push(item);
    }
  } else {
    items.push(...byCategory.values());
  }

  const missing = missingItems(items, categories);
  const status = items.some((item) => item.included) && missing.length === 0 ? "ready" : "gathering";

  return {
    request: {
      id: ctx.prev?.id ?? null,
      sessionId: ctx.sessionId,
      bundle: bundle.id,
      items,
      status,
    },
    missing,
  };
}

/** Rematch when a ready request is new or its included items changed. */
export function shouldMatch(prev: BuyerRequest | null, next: BuyerRequest): boolean {
  if (next.status !== "ready") return false;
  if (prev?.status !== "ready") return true;
  return snapshot(prev) !== snapshot(next);
}

function snapshot(request: BuyerRequest): string {
  return JSON.stringify(
    request.items
      .filter((item) => item.included)
      .map((item) => ({
        category: item.category,
        attributes: Object.fromEntries(Object.entries(item.attributes).sort(([a], [b]) => a.localeCompare(b))),
        preferences: item.preferences,
        maxPrice: item.maxPrice,
      })),
  );
}

function resolveBundle(
  draftBundle: string | null,
  catalog: Catalog,
  prev: BuyerRequest | null,
): { id: string | null; row: Catalog["bundles"][number] | null } {
  const named = draftBundle ? catalog.bundles.find((bundle) => bundle.id === draftBundle) : undefined;
  if (named) return { id: named.id, row: named };
  if (prev?.bundle) {
    return { id: prev.bundle, row: catalog.bundles.find((bundle) => bundle.id === prev.bundle) ?? null };
  }
  return { id: null, row: null };
}

function toItem(
  raw: IntakeDraft["items"][number],
  category: Category,
  excluded: Set<string>,
): RequestItem {
  return {
    category: category.id,
    included: !excluded.has(category.id),
    attributes: attributesFor(raw.attributes, category),
    preferences: preferencesFor(raw.preferences),
    maxPrice: wholePounds(raw.maxPrice),
  };
}

function blankItem(categoryId: string, category: Category | undefined, excluded: Set<string>): RequestItem {
  return {
    category: categoryId,
    included: !excluded.has(categoryId),
    attributes: attributesFor({}, category ?? { id: categoryId, label: categoryId, required: [], optional: [] }),
    preferences: [],
    maxPrice: null,
  };
}

function attributesFor(raw: Record<string, string>, category: Category): Record<string, string> {
  const allowed = new Set([...category.required, ...category.optional]);
  const out: Record<string, string> = {};
  for (const key of [...allowed].sort((a, b) => a.localeCompare(b))) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    const value = String(raw[key] ?? "").trim().toLowerCase();
    if (!value) continue;
    out[key] = value;
  }
  return out;
}

function preferencesFor(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const next = String(value ?? "").trim().toLowerCase();
    if (!next || seen.has(next)) continue;
    seen.add(next);
    out.push(next);
  }
  return out;
}

function wholePounds(value: number | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded > 0 ? rounded : null;
}

function missingItems(items: RequestItem[], categories: Map<string, Category>): MissingItem[] {
  const missing: MissingItem[] = [];
  for (const item of items) {
    if (!item.included) continue;
    const category = categories.get(item.category);
    const fields = (category?.required ?? []).filter((key) => !item.attributes[key]);
    if (item.maxPrice == null) fields.push("maxPrice");
    if (fields.length > 0) missing.push({ category: item.category, fields });
  }
  return missing;
}
