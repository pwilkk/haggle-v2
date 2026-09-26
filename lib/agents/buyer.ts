import "server-only";
import { z } from "zod";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { completeJSON, completeText } from "@/lib/llm";
import type { Vocab } from "@/lib/request";
import {
  IntakeDraft,
  type BuyerRequest,
  type Catalog,
  type ChatMessage,
  type ItemMatches,
  type MissingItem,
} from "@/lib/schemas";

export async function extractDraft(a: {
  messages: ChatMessage[];
  catalog: Catalog;
  vocab: Vocab;
  prev: BuyerRequest | null;
}): Promise<IntakeDraft> {
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: extractionSystem(JSON.stringify(z.toJSONSchema(IntakeDraft))) },
    {
      role: "user",
      content: [
        `CATALOG: ${JSON.stringify(publicCatalog(a.catalog))}`,
        `KNOWN_VALUES: ${JSON.stringify(a.vocab)}`,
        `PREVIOUS: ${JSON.stringify(a.prev ? previousDraft(a.prev) : null)}`,
        `CONVERSATION:\n${transcript(a.messages)}`,
      ].join("\n"),
    },
  ];
  return completeJSON(IntakeDraft, messages, { temperature: 0 });
}

export async function writeReply(a: {
  messages: ChatMessage[];
  request: BuyerRequest;
  missing: MissingItem[];
  catalog: Catalog;
  vocab: Vocab;
  matches: ItemMatches[] | null;
  firstBundleTurn: boolean;
}): Promise<string> {
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: REPLY_SYSTEM },
    {
      role: "user",
      content: [
        `STATE: ${JSON.stringify(stateView(a.request, a.missing, a.catalog))}`,
        `KNOWN_VALUES: ${JSON.stringify(a.vocab)}`,
        `MATCHES: ${JSON.stringify(matchesView(a.matches, a.catalog))}`,
        `FIRST_BUNDLE_TURN: ${a.firstBundleTurn}`,
        `CONVERSATION:\n${transcript(a.messages)}`,
      ].join("\n"),
    },
  ];
  return completeText(messages, { temperature: 0.3 });
}

function extractionSystem(schemaJson: string): string {
  return `You turn a shopper's chat into a structured shopping request for a UK marketplace.
Reply with JSON only, matching this JSON schema: ${schemaJson}

You get: CATALOG (categories with required/optional fields, bundles with descriptions),
KNOWN_VALUES (values that exist in current listings, per category and field),
PREVIOUS (last draft, may be null) and the CONVERSATION.

Rules:
- Use only category ids and bundle ids from CATALOG. If the shopper wants something not in CATALOG, leave it out.
- If the shopper's goal fits a bundle description, set "bundle" to its id and add one item per bundle category.
- Fill a field only if the shopper said it, or it is unambiguous from what they said
  (a named product that clearly implies a known value, or a standard conversion such as height → frame size
  or "UK 8" → "8"). Otherwise leave it out. Never guess.
- Prefer the exact spelling of a KNOWN_VALUE when the shopper means it. Otherwise lower-case their words.
- Only use field names from that category's required/optional lists.
- "ideally X", "preferably X", "would love X" → preferences. Hard requirements on optional fields → attributes.
- Money in whole pounds. "under £80", "max 80", "up to 80" → maxPrice of that item. Each item has its own maxPrice.
  A single total for several items ("£800 for everything") is NOT a per-item budget: leave those maxPrice values null.
- "dropped": bundle categories the shopper says they already have or don't need.
- Keep everything from PREVIOUS unless the shopper changed it.`;
}

const REPLY_SYSTEM = `You are the shopper's own buying agent in a UK marketplace. Write your next chat message.
Keep it short (max 60 words), friendly, UK English, prices in £. Plain text; a numbered list is OK. No JSON, no field ids.

You get STATE (the request: bundle, items with labels, filled fields, what's MISSING), KNOWN_VALUES, and MATCHES (or null).

- If something is MISSING: ask only for that.
  - Single item: at most 2 questions in one message ("Two quick questions: what's your UK shoe size, and what's the most you'd pay?").
  - Bundle, first time (FIRST_BUNDLE_TURN=true): one intro line ("Here's a starter kit most people need. Untick anything you already have.")
    then "To find the right matches I just need:" and a numbered list, one line per ticked item that needs something,
    including its budget ("Bike: road, gravel or hybrid, your frame size, and the most you'd pay?").
  - If the shopper gave one total for the whole bundle, thank them and ask how much of it for each item.
  - Offer 2-3 example options from KNOWN_VALUES where it helps ("road, gravel or hybrid").
- If MATCHES is non-empty: "Found N matches." then one sentence on the best one (seller name + why). For bundles, one line per item.
- If MATCHES is empty: say nothing matched and suggest one change (budget, size or colour).
- If the shopper asks for something that isn't in CATALOG: say so and list what categories you can help with.
- Never promise a price, never mention sellers' lowest prices (you don't know them).`;

function publicCatalog(catalog: Catalog) {
  return {
    categories: catalog.categories.map((category) => ({
      id: category.id,
      label: category.label,
      required: category.required,
      optional: category.optional,
    })),
    bundles: catalog.bundles.map((bundle) => ({
      id: bundle.id,
      label: bundle.label,
      description: bundle.description,
      categoryIds: bundle.categoryIds,
    })),
  };
}

function previousDraft(prev: BuyerRequest) {
  return {
    bundle: prev.bundle,
    dropped: prev.items.filter((item) => !item.included).map((item) => item.category),
    items: prev.items.map((item) => ({
      category: item.category,
      attributes: item.attributes,
      preferences: item.preferences,
      maxPrice: item.maxPrice,
    })),
  };
}

function stateView(request: BuyerRequest, missing: MissingItem[], catalog: Catalog) {
  return {
    bundle: request.bundle,
    bundleLabel: catalog.bundles.find((bundle) => bundle.id === request.bundle)?.label ?? null,
    status: request.status,
    items: request.items.map((item) => ({
      category: item.category,
      label: catalog.categories.find((category) => category.id === item.category)?.label ?? item.category,
      included: item.included,
      attributes: item.attributes,
      preferences: item.preferences,
      maxPrice: item.maxPrice,
      missing: missing.find((row) => row.category === item.category)?.fields ?? [],
    })),
    missing,
    categories: catalog.categories.map((category) => ({ id: category.id, label: category.label })),
  };
}

function matchesView(matches: ItemMatches[] | null, catalog: Catalog) {
  if (!matches) return null;
  const items = matches.map((group) => ({
    category: group.category,
    label: catalog.categories.find((category) => category.id === group.category)?.label ?? group.category,
    listings: group.listings.map((listing) => ({
      title: listing.title,
      sellerName: listing.sellerName,
      askingPrice: listing.askingPrice,
      overBudget: listing.overBudget,
    })),
  }));
  const total = items.reduce((sum, item) => sum + item.listings.length, 0);
  if (total === 0) return [];
  return { total, items };
}

function transcript(messages: ChatMessage[]): string {
  return messages.map((message) => `${message.role}: ${message.content}`).join("\n");
}
