import { extractDraft, writeReply } from "@/lib/agents/buyer";
import { getRequest, listActiveListingViews, loadCatalog, saveRequest } from "@/lib/db";
import { errorResponse, HttpError } from "@/lib/http";
import { match } from "@/lib/match";
import { buildRequest, fieldVocab, shouldMatch } from "@/lib/request";
import { ChatBody, ChatResponse, MAX_MESSAGE_CHARS, MAX_MESSAGES, type ItemMatches } from "@/lib/schemas";

const EMPTY_REPLY = "The marketplace is empty right now, check back soon.";

export async function POST(request: Request) {
  try {
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      throw new HttpError(400, "Invalid request");
    }
    const body = ChatBody.parse(payload);
    const last = body.messages[body.messages.length - 1];
    if (!last || last.role !== "user") throw new HttpError(400, "The last message must be from you");
    if (last.content.length > MAX_MESSAGE_CHARS) throw new HttpError(400, "Message is too long");
    if (body.messages.length > MAX_MESSAGES) throw new HttpError(429, "This chat is full, start a new one");

    const [catalog, listings, prev] = await Promise.all([
      loadCatalog(),
      listActiveListingViews(body.sessionId),
      body.requestId ? getRequest(body.requestId, body.sessionId) : null,
    ]);

    if (catalog.categories.length === 0) {
      const saved = await saveRequest({
        id: prev?.id ?? null,
        sessionId: body.sessionId,
        bundle: null,
        items: [],
        status: "gathering",
      });
      return Response.json(
        ChatResponse.parse({
          requestId: saved.id,
          reply: EMPTY_REPLY,
          request: saved,
          missing: [],
          catalog: { categories: [], bundle: null },
          matches: null,
          sellersAsked: null,
        }),
      );
    }

    const vocab = fieldVocab(catalog, listings);
    const draft = await extractDraft({ messages: body.messages, catalog, vocab, prev });
    const { request: next, missing } = buildRequest(draft, {
      catalog,
      excluded: body.excluded,
      prev,
      sessionId: body.sessionId,
    });
    const saved = await saveRequest(next);

    let matches: ItemMatches[] | null = null;
    let sellersAsked: number | null = null;
    if (shouldMatch(prev, saved)) {
      const included = saved.items.filter((item) => item.included);
      matches = included.map((item) => {
        const category = catalog.categories.find((row) => row.id === item.category);
        return { category: item.category, listings: category ? match(item, category, listings) : [] };
      });
      const categories = new Set(included.map((item) => item.category));
      const sellers = new Set(
        listings.filter((listing) => listing.status === "active" && categories.has(listing.category)).map((listing) => listing.sellerId),
      );
      sellersAsked = sellers.size;
    }

    const reply = await writeReply({
      messages: body.messages,
      request: saved,
      missing,
      catalog,
      vocab,
      matches,
      firstBundleTurn: prev?.bundle == null && saved.bundle != null,
    });

    const used = new Set(saved.items.map((item) => item.category));
    return Response.json(
      ChatResponse.parse({
        requestId: saved.id,
        reply,
        request: saved,
        missing,
        catalog: {
          categories: catalog.categories.filter((category) => used.has(category.id)),
          bundle: saved.bundle ? (catalog.bundles.find((bundle) => bundle.id === saved.bundle) ?? null) : null,
        },
        matches,
        sellersAsked,
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
