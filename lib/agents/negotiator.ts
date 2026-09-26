import "server-only";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { completeJSON } from "@/lib/llm";
import type { BuyerAgent, BuyerView, SellerAgent, SellerView } from "@/lib/negotiation";
import { AgentMove, type Offer } from "@/lib/schemas";

export function makeBuyerAgent(ctx: {
  title: string;
  attributes: Record<string, string>;
  wants: Record<string, string>;
  preferences: string[];
}): BuyerAgent {
  return async (view) => {
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: buyerSystem(ctx, view) },
      { role: "user", content: transcript(view) },
    ];
    return completeJSON(AgentMove, messages, { temperature: 0 });
  };
}

export function makeSellerAgent(ctx: {
  title: string;
  attributes: Record<string, string>;
  sellerName: string;
  sellerType: "brand" | "private";
  persona: string;
}): SellerAgent {
  return async (view) => {
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: sellerSystem(ctx, view) },
      { role: "user", content: transcript(view) },
    ];
    return completeJSON(AgentMove, messages, { temperature: 0 });
  };
}

function buyerSystem(
  ctx: { title: string; attributes: Record<string, string>; wants: Record<string, string>; preferences: string[] },
  view: BuyerView,
): string {
  return `You are a shopper's buying agent, haggling for: ${ctx.title} (${formatRecord(ctx.attributes)}). The seller is asking £${view.askingPrice}.
The shopper wants ${formatRecord(ctx.wants)}; nice-to-haves: ${formatList(ctx.preferences)}.
Your private maximum is £${view.maxPrice}. Never reveal it or hint at it. Never offer above it.
Style: friendly, brief (1-2 sentences, max 25 words), UK English. Give a reason (condition, market price, paying today).
Strategy:
- First offer: about 75% of the asking price. If that is above your maximum, about 85% of your maximum.
- Each later offer: move roughly half-way from your last offer toward the seller's last price, never above your maximum.
- Accept when the seller's last price is at or below your maximum and within £5 of your last offer.
- On the last turn, offer the most you are willing to pay (never above your maximum).
Reply with JSON only: {"action":"offer"|"accept","price":number|null,"message":string}.
For "accept", price is the seller's last price.`;
}

function sellerSystem(
  ctx: {
    title: string;
    attributes: Record<string, string>;
    sellerName: string;
    sellerType: "brand" | "private";
    persona: string;
  },
  view: SellerView,
): string {
  return `You are the selling agent for ${ctx.sellerName}, a ${ctx.sellerType} seller. Persona: ${ctx.persona}
Item: ${ctx.title} (${formatRecord(ctx.attributes)}), asking £${view.askingPrice}.
Your private floor is £${view.floorPrice}: the lowest price you may accept. Never reveal it or hint at it. Never offer below it.
Style: 1-2 sentences, max 25 words, in the persona's voice, UK English. Give a reason (condition, box, warranty, demand).
Strategy:
- Turn 1: open at your asking price.
- Let the persona set your pace: quick-sale or flexible personas move about half-way toward the buyer's last offer each turn;
  firm personas move in small steps (about 5% of the asking price).
- Accept when the buyer's last offer is at or above your floor and within £5 of your last price.
- If you are at your floor, hold it and say it's your lowest.
Reply with JSON only: {"action":"offer"|"accept","price":number|null,"message":string}.
For "accept", price is the buyer's last offer.`;
}

function transcript(view: BuyerView | SellerView): string {
  const lines = [`Turn ${view.turn} of ${view.maxTurns}.`];
  for (const offer of view.transcript) {
    lines.push(`${speaker(view.side, offer)}: £${offer.price} · ${offer.message}`);
  }
  lines.push("Your move.");
  return lines.join("\n");
}

function speaker(self: BuyerView["side"] | SellerView["side"], offer: Offer): string {
  if (offer.from === self) return "You";
  return offer.from === "seller_agent" ? "Seller" : "Buyer";
}

function formatRecord(record: Record<string, string>): string {
  const parts = Object.entries(record).map(([key, value]) => `${key}: ${value}`);
  return parts.length > 0 ? parts.join(", ") : "none";
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "none";
}
