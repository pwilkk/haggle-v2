import { makeBuyerAgent, makeSellerAgent } from "@/lib/agents/negotiator";
import {
  countNegotiations,
  createNegotiation,
  finishNegotiation,
  getListingPrivate,
  getRequest,
  lockListing,
  publicView,
  releaseListing,
} from "@/lib/db";
import { errorResponse, HttpError } from "@/lib/http";
import { runNegotiation } from "@/lib/negotiation";
import {
  MAX_NEGOTIATIONS_PER_SESSION,
  NegotiateBody,
  type NegotiationEvent,
  type Offer,
} from "@/lib/schemas";

export const maxDuration = 60;

const TURN_DELAY_MS = 600;

export async function POST(req: Request): Promise<Response> {
  try {
    const body = NegotiateBody.parse(await readJson(req));
    if ((await countNegotiations(body.sessionId)) >= MAX_NEGOTIATIONS_PER_SESSION) {
      throw new HttpError(429, "Negotiation limit reached for this session");
    }

    const request = await getRequest(body.requestId, body.sessionId);
    if (!request) throw new HttpError(404, "Not found");
    const item = request.items.find((row) => row.category === body.category);
    if (!item?.included || item.maxPrice == null) throw new HttpError(409, "Item not ready");
    const maxPrice = item.maxPrice;
    const wants = item.attributes;
    const preferences = item.preferences;

    const privateListing = await getListingPrivate(body.listingId);
    if (!privateListing) throw new HttpError(404, "Not found");
    const { listing, seller } = privateListing;
    if (listing.status === "sold") throw new HttpError(409, "Listing sold");
    if (listing.category !== body.category) throw new HttpError(400, "Listing category does not match");

    const locked = await lockListing(listing.id, body.sessionId);
    if (!locked) throw new HttpError(409, "Listing busy");

    let negotiationId: string;
    try {
      negotiationId = await createNegotiation({
        sessionId: body.sessionId,
        requestId: body.requestId,
        category: body.category,
        listingId: listing.id,
      });
    } catch (error) {
      await releaseListing(listing.id, body.sessionId);
      throw error;
    }

    const listingView = publicView(listing, seller);
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const turns: Offer[] = [];
        let settled = false;
        const send = (event: NegotiationEvent) => {
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          } catch {
            // The visitor closed the tab. Keep going so the row is finished and the lock released.
          }
        };

        try {
          send({ type: "start", negotiationId, listing: listingView });
          const result = await runNegotiation({
            limits: {
              askingPrice: listing.askingPrice,
              floorPrice: listing.floorPrice,
              maxPrice,
            },
            buyer: makeBuyerAgent({
              title: listing.title,
              attributes: listing.attributes,
              wants,
              preferences,
            }),
            seller: makeSellerAgent({
              title: listing.title,
              attributes: listing.attributes,
              sellerName: seller.name,
              sellerType: seller.type,
              persona: seller.persona,
            }),
            turnDelayMs: TURN_DELAY_MS,
            onTurn: async (offer, n) => {
              turns.push(offer);
              send({ type: "turn", n, offer });
            },
          });
          await finishNegotiation(negotiationId, {
            turns: result.turns,
            status: result.status,
            finalPrice: result.finalPrice,
          });
          settled = true;
          if (result.status === "agreed") await lockListing(listing.id, body.sessionId);
          else await releaseListing(listing.id, body.sessionId);
          send({
            type: "end",
            status: result.status,
            finalPrice: result.finalPrice,
            reason: result.reason,
          });
        } catch (error) {
          console.error(error instanceof Error ? error.message : "negotiation failed");
          if (!settled) {
            try {
              await finishNegotiation(negotiationId, { turns, status: "failed", finalPrice: null });
            } catch (finishError) {
              console.error(finishError instanceof Error ? finishError.message : "finish failed");
            }
            try {
              await releaseListing(listing.id, body.sessionId);
            } catch (releaseError) {
              console.error(releaseError instanceof Error ? releaseError.message : "release failed");
            }
          }
          send({ type: "error", message: "Negotiation interrupted" });
        } finally {
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "Invalid request");
  }
}
