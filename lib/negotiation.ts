import {
  AUTO_AGREE_GAP,
  MAX_TURNS,
  type AgentMove,
  type EndReason,
  type Offer,
  type Side,
} from "./schemas";

export type Limits = { askingPrice: number; floorPrice: number; maxPrice: number };

export type BuyerView = {
  side: "buyer_agent";
  turn: number;
  maxTurns: number;
  askingPrice: number;
  maxPrice: number;
  transcript: Offer[];
};
export type SellerView = {
  side: "seller_agent";
  turn: number;
  maxTurns: number;
  askingPrice: number;
  floorPrice: number;
  transcript: Offer[];
};
export type BuyerAgent = (view: BuyerView) => Promise<AgentMove>;
export type SellerAgent = (view: SellerView) => Promise<AgentMove>;

export type Step = {
  offer: Offer;
  status: "running" | "agreed" | "failed";
  finalPrice: number | null;
  reason: EndReason | null;
};
export type Result = {
  turns: Offer[];
  status: "agreed" | "failed";
  finalPrice: number | null;
  reason: EndReason;
};

const HOLD: AgentMove = {
  action: "offer",
  price: null,
  message: "Let me think… I'll stay where I am.",
};

const PRICE_IN_TEXT = /£\s?\d+(?:\.\d{1,2})?/g;

/** Turn a proposed move into a recorded offer. Limits are enforced here; the model is not trusted. */
export function applyMove(limits: Limits, turns: Offer[], side: Side, move: AgentMove): Step {
  const n = turns.length + 1;
  const own = lastPrice(turns, side);
  const other = lastPrice(turns, otherSide(side));

  if (n === 1) {
    const price = limits.askingPrice;
    const changed = roundedPrice(move.price) !== price;
    return running({
      from: side,
      action: "offer",
      price,
      message: alignMessage(move.message, price, changed),
    });
  }

  if (
    move.action === "accept" &&
    other != null &&
    limits.floorPrice <= other &&
    other <= limits.maxPrice
  ) {
    return agreed(
      { from: side, action: "accept", price: other, message: move.message },
      other,
      "accepted",
    );
  }

  const proposed = roundedPrice(move.price);
  let price = proposed ?? own ?? Math.round(Math.min(limits.maxPrice, limits.askingPrice) * 0.75);
  price = Math.max(1, price);
  if (own != null) {
    price = side === "buyer_agent" ? Math.max(price, own) : Math.min(price, own);
  }
  price = side === "buyer_agent" ? Math.min(price, limits.maxPrice) : Math.max(price, limits.floorPrice);

  if (other != null && ((side === "buyer_agent" && price >= other) || (side === "seller_agent" && price <= other))) {
    return agreed(
      {
        from: side,
        action: "accept",
        price: other,
        message: alignMessage(move.message, other, true),
      },
      other,
      "crossed",
    );
  }

  const changed = proposed == null || proposed !== price;
  const offer: Offer = {
    from: side,
    action: "offer",
    price,
    message: alignMessage(move.message, price, changed),
  };

  if (
    other != null &&
    Math.abs(price - other) <= AUTO_AGREE_GAP &&
    limits.floorPrice <= limits.maxPrice
  ) {
    const mid = clamp(Math.round((price + other) / 2), limits.floorPrice, limits.maxPrice);
    return agreed(offer, mid, "midpoint");
  }
  if (n === MAX_TURNS) return failed(offer);
  return running(offer);
}

export async function runNegotiation(a: {
  limits: Limits;
  buyer: BuyerAgent;
  seller: SellerAgent;
  onTurn?: (offer: Offer, n: number) => void | Promise<void>;
  turnDelayMs?: number;
}): Promise<Result> {
  const turns: Offer[] = [];
  let last: Step | null = null;

  for (let n = 1; n <= MAX_TURNS; n++) {
    const side: Side = n % 2 === 1 ? "seller_agent" : "buyer_agent";
    let move: AgentMove;
    try {
      move =
        side === "buyer_agent"
          ? await a.buyer(buyerView(a.limits, turns, n))
          : await a.seller(sellerView(a.limits, turns, n));
    } catch {
      move = HOLD;
    }
    const step = applyMove(a.limits, turns, side, move);
    turns.push(step.offer);
    last = step;
    await a.onTurn?.(step.offer, n);
    if (step.status !== "running") break;
    if (n < MAX_TURNS && a.turnDelayMs && a.turnDelayMs > 0) await sleep(a.turnDelayMs);
  }

  if (!last || last.status === "running" || last.reason == null) {
    throw new Error("Negotiation ended without a result");
  }
  return { turns, status: last.status, finalPrice: last.finalPrice, reason: last.reason };
}

function buyerView(limits: Limits, turns: Offer[], n: number): BuyerView {
  return {
    side: "buyer_agent",
    turn: n,
    maxTurns: MAX_TURNS,
    askingPrice: limits.askingPrice,
    maxPrice: limits.maxPrice,
    transcript: [...turns],
  };
}

function sellerView(limits: Limits, turns: Offer[], n: number): SellerView {
  return {
    side: "seller_agent",
    turn: n,
    maxTurns: MAX_TURNS,
    askingPrice: limits.askingPrice,
    floorPrice: limits.floorPrice,
    transcript: [...turns],
  };
}

function otherSide(side: Side): Side {
  return side === "buyer_agent" ? "seller_agent" : "buyer_agent";
}

function lastPrice(turns: Offer[], side: Side): number | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (turn?.from === side) return turn.price;
  }
  return null;
}

function roundedPrice(price: number | null): number | null {
  if (price == null || !Number.isFinite(price)) return null;
  return Math.round(price);
}

function alignMessage(message: string, price: number, changed: boolean): string {
  if (!changed) return message;
  return message.replace(PRICE_IN_TEXT, `£${price}`);
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

function running(offer: Offer): Step {
  return { offer, status: "running", finalPrice: null, reason: null };
}

function agreed(offer: Offer, finalPrice: number, reason: EndReason): Step {
  return { offer, status: "agreed", finalPrice, reason };
}

function failed(offer: Offer): Step {
  return { offer, status: "failed", finalPrice: null, reason: "max_turns" };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
