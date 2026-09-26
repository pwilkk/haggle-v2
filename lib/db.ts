import "server-only";
import { createClient } from "@supabase/supabase-js";
import {
  AcceptResponse,
  Account,
  BuyerRequest,
  Bundle,
  Catalog,
  Category,
  Listing,
  ListingView,
  Offer,
} from "./schemas";
import { HttpError } from "./http";

export const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Public listing columns: floor_price and persona deliberately absent. busy_* are read only to compute `busy`.
const LISTING_PUBLIC =
  "id, seller_id, category, title, attributes, asking_price, status, busy_until, busy_session_id, seller:accounts!inner(name, type)";

const LISTING_PRIVATE =
  "id, seller_id, category, title, attributes, asking_price, floor_price, status, seller:accounts!inner(id, name, type, persona)";

const REQUEST_COLS = "id, session_id, bundle, items, status";

export type ListingRowWithSeller = {
  id: string;
  seller_id: string;
  category: string;
  title: string;
  attributes: unknown;
  asking_price: number;
  status: "active" | "sold";
  busy_until: string | null;
  busy_session_id: string | null;
  seller: { name: string; type: "brand" | "private" } | Array<{ name: string; type: "brand" | "private" }>;
};

export async function loadCatalog(): Promise<Catalog> {
  const [categoriesResult, bundlesResult] = await Promise.all([
    supabase.from("categories").select("id, label, required, optional").order("id"),
    supabase.from("bundles").select("id, label, description, category_ids").order("id"),
  ]);
  throwIf(categoriesResult.error);
  throwIf(bundlesResult.error);

  const categories = (categoriesResult.data ?? []).map((row) => toCategory(row));
  const categoryIds = new Set(categories.map((c) => c.id));
  const bundles = (bundlesResult.data ?? []).flatMap((row) => {
    const bundle = toBundle(row, categoryIds);
    return bundle ? [bundle] : [];
  });
  return Catalog.parse({ categories, bundles });
}

export async function listActiveListingViews(sessionId: string): Promise<ListingView[]> {
  const { data, error } = await supabase.from("listings").select(LISTING_PUBLIC).eq("status", "active");
  throwIf(error);
  const views: ListingView[] = [];
  for (const row of data ?? []) {
    try {
      views.push(toListingView(row as ListingRowWithSeller, sessionId));
    } catch (e) {
      console.warn("skipping bad listing row", record(row)?.id, e);
    }
  }
  return views;
}

/** Only place that reads floor_price and persona. Used by the negotiate route. */
export async function getListingPrivate(id: string): Promise<{ listing: Listing; seller: Account } | null> {
  const { data, error } = await supabase.from("listings").select(LISTING_PRIVATE).eq("id", id).maybeSingle();
  throwIf(error);
  if (!data) return null;

  const row = record(data);
  if (!row) throw new Error(`Bad listing row ${id}`);
  const sellerRaw = Array.isArray(row.seller) ? row.seller[0] : row.seller;
  const sellerRec = record(sellerRaw);
  if (!sellerRec) throw new Error(`Listing ${id} is missing its seller`);

  const listing = Listing.safeParse({
    id: row.id,
    sellerId: row.seller_id,
    category: row.category,
    title: row.title,
    attributes: coerceAttributes(row.attributes),
    askingPrice: asNumber(row.asking_price),
    floorPrice: asNumber(row.floor_price),
    status: row.status,
  });
  const seller = Account.safeParse({
    id: sellerRec.id,
    name: sellerRec.name,
    type: sellerRec.type,
    persona: typeof sellerRec.persona === "string" ? sellerRec.persona : "",
  });
  if (!listing.success || !seller.success) throw new Error(`Bad listing row ${id}`);
  return { listing: listing.data, seller: seller.data };
}

export async function getRequest(id: string, sessionId: string): Promise<BuyerRequest | null> {
  const { data, error } = await supabase.from("requests").select(REQUEST_COLS).eq("id", id).maybeSingle();
  throwIf(error);
  if (!data) return null;
  const row = record(data);
  if (!row || row.session_id !== sessionId) return null;
  return toBuyerRequest(row);
}

export async function saveRequest(r: Omit<BuyerRequest, "id"> & { id: string | null }): Promise<BuyerRequest> {
  const payload = {
    session_id: r.sessionId,
    bundle: r.bundle,
    items: r.items,
    status: r.status,
    updated_at: new Date().toISOString(),
  };

  if (r.id) {
    const { data: existing, error: lookupError } = await supabase
      .from("requests")
      .select("id, session_id")
      .eq("id", r.id)
      .maybeSingle();
    throwIf(lookupError);

    const owned = record(existing);
    if (owned && owned.session_id === r.sessionId) {
      const { data, error } = await supabase
        .from("requests")
        .update(payload)
        .eq("id", r.id)
        .eq("session_id", r.sessionId)
        .select(REQUEST_COLS)
        .single();
      throwIf(error);
      return toBuyerRequest(data);
    }
    if (!owned) {
      const { data, error } = await supabase
        .from("requests")
        .insert({ id: r.id, ...payload })
        .select(REQUEST_COLS)
        .single();
      throwIf(error);
      return toBuyerRequest(data);
    }
  }

  const { data, error } = await supabase.from("requests").insert(payload).select(REQUEST_COLS).single();
  throwIf(error);
  return toBuyerRequest(data);
}

export async function countNegotiations(sessionId: string): Promise<number> {
  const { count, error } = await supabase
    .from("negotiations")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId);
  throwIf(error);
  return count ?? 0;
}

export async function lockListing(listingId: string, sessionId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("lock_listing", {
    p_listing_id: listingId,
    p_session_id: sessionId,
  });
  throwIf(error);
  return data === true;
}

export async function releaseListing(listingId: string, sessionId: string): Promise<void> {
  const { error } = await supabase.rpc("release_listing", {
    p_listing_id: listingId,
    p_session_id: sessionId,
  });
  throwIf(error);
}

export async function createNegotiation(n: {
  sessionId: string;
  requestId: string;
  category: string;
  listingId: string;
}): Promise<string> {
  const { data, error } = await supabase
    .from("negotiations")
    .insert({
      session_id: n.sessionId,
      request_id: n.requestId,
      category: n.category,
      listing_id: n.listingId,
      turns: [],
      status: "running",
    })
    .select("id")
    .single();
  throwIf(error);
  const row = record(data);
  if (!row || typeof row.id !== "string") throw new Error("Negotiation insert did not return an id");
  return row.id;
}

export async function finishNegotiation(
  id: string,
  r: { turns: Offer[]; status: "agreed" | "failed"; finalPrice: number | null },
): Promise<void> {
  const turns = Offer.array().safeParse(r.turns);
  if (!turns.success) throw new Error(`Bad negotiation turns for ${id}`);
  const { data, error } = await supabase
    .from("negotiations")
    .update({
      turns: turns.data,
      status: r.status,
      final_price: r.finalPrice,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  throwIf(error);
  if (!data) throw new Error(`Negotiation ${id} not found`);
}

export async function acceptNegotiation(id: string, sessionId: string): Promise<AcceptResponse> {
  const row = await loadNegotiation(id);
  if (!row || row.session_id !== sessionId) throw new HttpError(404, "Not found");
  if (row.status !== "agreed" || row.final_price == null) throw new HttpError(409, "Negotiation not agreed");

  const { data: sold, error: sellError } = await supabase.rpc("sell_listing", {
    p_listing_id: row.listing_id,
    p_session_id: sessionId,
  });
  throwIf(sellError);
  if (sold !== true) throw new HttpError(409, "Deal expired");

  const { error: updateError } = await supabase
    .from("negotiations")
    .update({ status: "accepted", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("session_id", sessionId);
  throwIf(updateError);

  const { data: listingRow, error: listingError } = await supabase
    .from("listings")
    .select(LISTING_PUBLIC)
    .eq("id", row.listing_id)
    .maybeSingle();
  throwIf(listingError);
  if (!listingRow) throw new Error(`Listing ${row.listing_id} missing after sale`);

  const body = AcceptResponse.safeParse({
    negotiationId: id,
    status: "accepted",
    finalPrice: row.final_price,
    listing: toListingView(listingRow as ListingRowWithSeller, sessionId),
  });
  if (!body.success) throw new Error(`Bad accept result for ${id}`);
  return body.data;
}

export async function walkAwayNegotiation(id: string, sessionId: string): Promise<void> {
  const row = await loadNegotiation(id);
  if (!row || row.session_id !== sessionId) throw new HttpError(404, "Not found");
  await releaseListing(row.listing_id, sessionId);
  if (row.status !== "agreed") return;
  const { error } = await supabase
    .from("negotiations")
    .update({ status: "failed", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("session_id", sessionId);
  throwIf(error);
}

export function toListingView(row: ListingRowWithSeller, sessionId: string): ListingView {
  const sellerRaw = Array.isArray(row.seller) ? row.seller[0] : row.seller;
  const parsed = ListingView.safeParse({
    id: row.id,
    sellerId: row.seller_id,
    category: row.category,
    title: row.title,
    attributes: coerceAttributes(row.attributes),
    askingPrice: asNumber(row.asking_price),
    status: row.status,
    sellerName: sellerRaw?.name,
    sellerType: sellerRaw?.type,
    busy: isBusyForOther(row.busy_until, row.busy_session_id, sessionId),
  });
  if (!parsed.success) throw new Error(`Bad listing row ${row.id}: ${parsed.error.message}`);
  return parsed.data;
}

/** Strips floorPrice. busy is false because the caller holds the lock. */
export function publicView(listing: Listing, seller: Account): ListingView {
  return ListingView.parse({
    id: listing.id,
    sellerId: listing.sellerId,
    category: listing.category,
    title: listing.title,
    attributes: listing.attributes,
    askingPrice: listing.askingPrice,
    status: listing.status,
    sellerName: seller.name,
    sellerType: seller.type,
    busy: false,
  });
}

function throwIf(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

function record(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return Number.NaN;
}

function coerceAttributes(raw: unknown): Record<string, string> {
  const rec = record(raw);
  if (!rec) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(rec)) {
    if (value == null || typeof value === "object") continue;
    out[key] = String(value).trim().toLowerCase();
  }
  return out;
}

function isBusyForOther(busyUntil: unknown, busySessionId: unknown, sessionId: string): boolean {
  if (busyUntil == null) return false;
  const until = busyUntil instanceof Date ? busyUntil.getTime() : new Date(String(busyUntil)).getTime();
  if (!Number.isFinite(until) || until <= Date.now()) return false;
  return busySessionId !== sessionId;
}

function textList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v).trim()).filter((v) => v.length > 0);
}

function toCategory(row: unknown): Category {
  const r = record(row);
  if (!r) throw new Error("Bad category row");
  if (!Array.isArray(r.required) || !Array.isArray(r.optional)) {
    throw new Error(`Bad category row ${String(r.id)}: required and optional must be arrays`);
  }
  const parsed = Category.safeParse({
    id: typeof r.id === "string" ? r.id.trim() : r.id,
    label: r.label,
    required: textList(r.required).map((name) => name.toLowerCase()),
    optional: textList(r.optional).map((name) => name.toLowerCase()),
  });
  if (!parsed.success) throw new Error(`Bad category row ${String(r.id)}: ${parsed.error.message}`);
  return parsed.data;
}

function toBundle(row: unknown, categoryIds: Set<string>): Bundle | null {
  const r = record(row);
  if (!r) throw new Error("Bad bundle row");
  if (!Array.isArray(r.category_ids)) {
    throw new Error(`Bad bundle row ${String(r.id)}: category_ids must be an array`);
  }
  const ids = textList(r.category_ids).filter((id) => categoryIds.has(id));
  if (ids.length === 0) return null;
  const parsed = Bundle.safeParse({
    id: typeof r.id === "string" ? r.id.trim() : r.id,
    label: r.label,
    description: typeof r.description === "string" ? r.description : "",
    categoryIds: ids,
  });
  if (!parsed.success) throw new Error(`Bad bundle row ${String(r.id)}: ${parsed.error.message}`);
  return parsed.data;
}

function toBuyerRequest(row: unknown): BuyerRequest {
  const r = record(row);
  if (!r) throw new Error("Bad request row");
  const parsed = BuyerRequest.safeParse({
    id: r.id,
    sessionId: r.session_id,
    bundle: r.bundle ?? null,
    items: r.items ?? [],
    status: r.status,
  });
  if (!parsed.success) throw new Error(`Bad request row ${String(r.id)}: ${parsed.error.message}`);
  return parsed.data;
}

type NegotiationRow = {
  id: string;
  session_id: string;
  listing_id: string;
  status: string;
  final_price: number | null;
};

async function loadNegotiation(id: string): Promise<NegotiationRow | null> {
  const { data, error } = await supabase
    .from("negotiations")
    .select("id, session_id, listing_id, status, final_price")
    .eq("id", id)
    .maybeSingle();
  throwIf(error);
  if (!data) return null;
  const row = record(data);
  if (!row || typeof row.id !== "string" || typeof row.session_id !== "string" || typeof row.listing_id !== "string") {
    throw new Error(`Bad negotiation row ${id}`);
  }
  return {
    id: row.id,
    session_id: row.session_id,
    listing_id: row.listing_id,
    status: String(row.status),
    final_price: row.final_price == null ? null : asNumber(row.final_price),
  };
}
