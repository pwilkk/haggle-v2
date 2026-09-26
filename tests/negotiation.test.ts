import { describe, expect, it } from "vitest";
import {
  applyMove,
  runNegotiation,
  type BuyerAgent,
  type BuyerView,
  type Limits,
  type SellerAgent,
  type SellerView,
} from "@/lib/negotiation";
import { MAX_TURNS, type AgentMove, type Offer } from "@/lib/schemas";
import { privateListing } from "./fixtures";

const tom = privateListing("f-am90-8-used");

function limits(maxPrice: number, over: Partial<Limits> = {}): Limits {
  return {
    askingPrice: tom.askingPrice,
    floorPrice: tom.floorPrice,
    maxPrice,
    ...over,
  };
}

function move(action: AgentMove["action"], price: number | null, message = `£${price ?? "hold"}`): AgentMove {
  return { action, price, message };
}

function scripted(moves: AgentMove[]) {
  const views: Array<BuyerView | SellerView> = [];
  let i = 0;
  const agent = async (view: BuyerView | SellerView) => {
    views.push(view);
    return moves[i++] ?? move("offer", null, "hold");
  };
  return { agent, views };
}

/** Prompt strategy in code: 75% open (85% of max if that's over the cap), then half-way, accept within £5. */
const strategyBuyer: BuyerAgent = async (view) => {
  const sellerLast = lastOf(view.transcript, "seller_agent");
  const ownLast = lastOf(view.transcript, "buyer_agent");
  if (
    sellerLast != null &&
    ownLast != null &&
    sellerLast <= view.maxPrice &&
    Math.abs(sellerLast - ownLast) <= 5
  ) {
    return move("accept", sellerLast, `I'll take £${sellerLast}.`);
  }
  let price: number;
  if (view.turn === view.maxTurns) {
    price = view.maxPrice;
  } else if (ownLast == null) {
    const opening = Math.round(view.askingPrice * 0.75);
    price = opening > view.maxPrice ? Math.round(view.maxPrice * 0.85) : opening;
  } else if (sellerLast != null) {
    price = Math.round((ownLast + sellerLast) / 2);
  } else {
    price = ownLast;
  }
  price = Math.min(Math.max(1, price), view.maxPrice);
  return move("offer", price, `I can do £${price}.`);
};

/** Flexible seller: open at asking, then half-way toward the buyer, never under the floor. */
const strategySeller: SellerAgent = async (view) => {
  const buyerLast = lastOf(view.transcript, "buyer_agent");
  const ownLast = lastOf(view.transcript, "seller_agent");
  if (
    buyerLast != null &&
    ownLast != null &&
    buyerLast >= view.floorPrice &&
    Math.abs(buyerLast - ownLast) <= 5
  ) {
    return move("accept", buyerLast, `Deal at £${buyerLast}.`);
  }
  if (view.turn === 1 || ownLast == null) {
    return move("offer", view.askingPrice, `Asking £${view.askingPrice}.`);
  }
  if (buyerLast == null) return move("offer", ownLast, `Staying at £${ownLast}.`);
  const price = Math.max(view.floorPrice, Math.round((ownLast + buyerLast) / 2));
  return move("offer", price, `I can do £${price}.`);
};

function lastOf(turns: Offer[], side: Offer["from"]): number | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (turn?.from === side) return turn.price;
  }
  return null;
}

function pricesOf(turns: Offer[], side: Offer["from"]): number[] {
  return turns.filter((turn) => turn.from === side).map((turn) => turn.price);
}

describe("applyMove", () => {
  it("1. opens at the asking price whatever the seller proposes", () => {
    const step = applyMove(limits(80), [], "seller_agent", move("offer", 50, "Asking £50, barely worn."));
    expect(step.offer).toMatchObject({ from: "seller_agent", action: "offer", price: 90 });
    expect(step.offer.message).toBe("Asking £90, barely worn.");
    expect(step.status).toBe("running");
  });

  it("2. clamps a buyer offer to their maximum", () => {
    const turns = [applyMove(limits(80), [], "seller_agent", move("offer", 90)).offer];
    const step = applyMove(limits(80), turns, "buyer_agent", move("offer", 85, "I can do £85."));
    expect(step.offer).toMatchObject({ action: "offer", price: 80 });
    expect(step.offer.message).toBe("I can do £80.");
  });

  it("3. clamps a seller offer to their floor", () => {
    let turns: Offer[] = [applyMove(limits(80), [], "seller_agent", move("offer", 90)).offer];
    turns = [...turns, applyMove(limits(80), turns, "buyer_agent", move("offer", 65)).offer];
    const step = applyMove(limits(80), turns, "seller_agent", move("offer", 60, "£60 and it's yours."));
    expect(step.offer).toMatchObject({ action: "offer", price: 70 });
    expect(step.offer.message).toBe("£70 and it's yours.");
  });

  it("4. refuses backtracking on both sides", () => {
    const cap = limits(100);
    let turns: Offer[] = [];
    const play = (side: Offer["from"], price: number) => {
      const step = applyMove(cap, turns, side, move("offer", price));
      turns = [...turns, step.offer];
      return step.offer.price;
    };
    expect(play("seller_agent", 90)).toBe(90);
    expect(play("buyer_agent", 70)).toBe(70);
    expect(play("seller_agent", 85)).toBe(85);
    expect(play("buyer_agent", 60)).toBe(70);
    expect(play("seller_agent", 88)).toBe(85);
  });

  it("5. ignores a buyer accept above their maximum", () => {
    const turns = [applyMove(limits(80), [], "seller_agent", move("offer", 90)).offer];
    const step = applyMove(limits(80), turns, "buyer_agent", move("accept", 90, "I'll take £90."));
    expect(step.status).not.toBe("agreed");
    expect(step.offer.action).toBe("offer");
    expect(step.offer.price).toBeLessThanOrEqual(80);
  });

  it("6. ignores a seller accept below their floor", () => {
    let turns: Offer[] = [applyMove(limits(80), [], "seller_agent", move("offer", 90)).offer];
    turns = [...turns, applyMove(limits(80), turns, "buyer_agent", move("offer", 60)).offer];
    const step = applyMove(limits(80), turns, "seller_agent", move("accept", 60, "Deal at £60."));
    expect(step.status).not.toBe("agreed");
    expect(step.offer.action).toBe("offer");
    expect(step.offer.price).toBeGreaterThanOrEqual(70);
  });

  it("7. records a valid accept at the other side's price", () => {
    const turns: Offer[] = [{ from: "seller_agent", action: "offer", price: 78, message: "£78." }];
    const step = applyMove(limits(80), turns, "buyer_agent", move("accept", 78, "Deal at £78."));
    expect(step.status).toBe("agreed");
    expect(step.finalPrice).toBe(78);
    expect(step.reason).toBe("accepted");
    expect(step.offer).toMatchObject({ action: "accept", price: 78 });
  });

  it("8. treats a crossing offer as an accept of the other price", () => {
    const turns: Offer[] = [{ from: "seller_agent", action: "offer", price: 78, message: "£78." }];
    const step = applyMove(limits(90), turns, "buyer_agent", move("offer", 80, "I can do £80."));
    expect(step.status).toBe("agreed");
    expect(step.finalPrice).toBe(78);
    expect(step.reason).toBe("crossed");
    expect(step.offer).toMatchObject({ action: "accept", price: 78 });
    expect(step.offer.message).toBe("I can do £78.");
  });

  it("9. splits the difference when the gap is £2 and the ranges overlap", () => {
    const turns: Offer[] = [{ from: "seller_agent", action: "offer", price: 77, message: "£77." }];
    const step = applyMove(limits(80), turns, "buyer_agent", move("offer", 75, "£75."));
    expect(step.status).toBe("agreed");
    expect(step.finalPrice).toBe(76);
    expect(step.reason).toBe("midpoint");
    expect(step.offer).toMatchObject({ action: "offer", price: 75 });
  });
});

describe("runNegotiation", () => {
  it("10. never agrees when the floor is above the maximum", async () => {
    const seller = scripted([move("offer", 81), move("offer", 81), move("offer", 81)]);
    const buyer = scripted([move("offer", 80), move("offer", 80), move("offer", 80)]);
    const result = await runNegotiation({
      limits: { askingPrice: 81, floorPrice: 81, maxPrice: 80 },
      buyer: buyer.agent as BuyerAgent,
      seller: seller.agent as SellerAgent,
      turnDelayMs: 0,
    });
    expect(result.status).toBe("failed");
    expect(result.finalPrice).toBeNull();
    expect(result.reason).toBe("max_turns");
    expect(pricesOf(result.turns, "buyer_agent").every((price) => price <= 80)).toBe(true);
    expect(pricesOf(result.turns, "seller_agent").every((price) => price >= 81)).toBe(true);
  });

  it("11. stops at 6 turns when both sides hold", async () => {
    const hold = scripted([move("offer", null, "hold")]);
    const result = await runNegotiation({
      limits: limits(80),
      buyer: hold.agent as BuyerAgent,
      seller: scripted([move("offer", null, "hold")]).agent as SellerAgent,
      turnDelayMs: 0,
    });
    expect(result.turns).toHaveLength(MAX_TURNS);
    expect(result.status).toBe("failed");
    expect(result.reason).toBe("max_turns");
    expect(result.finalPrice).toBeNull();
  });

  it("12. strategy stubs agree at £74 when the ranges overlap", async () => {
    const result = await runNegotiation({
      limits: limits(80),
      buyer: strategyBuyer,
      seller: strategySeller,
      turnDelayMs: 0,
    });
    expect(result.turns.map((turn) => turn.price)).toEqual([90, 68, 79, 74, 74]);
    expect(result.turns[4]?.action).toBe("accept");
    expect(result.status).toBe("agreed");
    expect(result.finalPrice).toBe(74);
    expect(result.reason).toBe("accepted");
    expect(result.turns.length).toBeLessThanOrEqual(5);
  });

  it("13. strategy stubs fail without breaching limits when there is no overlap", async () => {
    const result = await runNegotiation({
      limits: limits(60),
      buyer: strategyBuyer,
      seller: strategySeller,
      turnDelayMs: 0,
    });
    expect(result.turns.map((turn) => turn.price)).toEqual([90, 51, 71, 60, 70, 60]);
    expect(result.status).toBe("failed");
    expect(result.finalPrice).toBeNull();
    expect(pricesOf(result.turns, "buyer_agent").every((price) => price <= 60)).toBe(true);
    expect(pricesOf(result.turns, "seller_agent").every((price) => price >= 70)).toBe(true);
  });

  it("14. gives each agent only its own limit", async () => {
    const buyer = scripted([move("offer", 60)]);
    const seller = scripted([move("offer", 90)]);
    await runNegotiation({
      limits: limits(80),
      buyer: buyer.agent as BuyerAgent,
      seller: seller.agent as SellerAgent,
      turnDelayMs: 0,
    });
    expect(buyer.views.length).toBeGreaterThan(0);
    expect(seller.views.length).toBeGreaterThan(0);
    for (const view of buyer.views) {
      expect(view.side).toBe("buyer_agent");
      expect(Object.keys(view).sort()).toEqual(
        ["askingPrice", "maxPrice", "maxTurns", "side", "transcript", "turn"].sort(),
      );
      expect("floorPrice" in view).toBe(false);
    }
    for (const view of seller.views) {
      expect(view.side).toBe("seller_agent");
      expect(Object.keys(view).sort()).toEqual(
        ["askingPrice", "floorPrice", "maxTurns", "side", "transcript", "turn"].sort(),
      );
      expect("maxPrice" in view).toBe(false);
    }
  });

  it("15. holds and carries on when the buyer agent throws", async () => {
    let calls = 0;
    const buyer: BuyerAgent = async () => {
      calls += 1;
      if (calls === 1) throw new Error("buyer down");
      return move("offer", null, "hold");
    };
    const result = await runNegotiation({
      limits: limits(80),
      buyer,
      seller: async () => move("offer", null, "hold"),
      turnDelayMs: 0,
    });
    expect(result.turns.length).toBe(MAX_TURNS);
    expect(result.turns[1]).toMatchObject({
      from: "buyer_agent",
      action: "offer",
      message: "Let me think… I'll stay where I am.",
    });
    expect(result.turns[1]?.price).toBeLessThanOrEqual(80);
    expect(result.turns[1]?.price).toBeGreaterThanOrEqual(1);
    expect(result.status).toBe("failed");
  });

  it("16. reports every turn to onTurn in order", async () => {
    const seen: number[] = [];
    const result = await runNegotiation({
      limits: limits(80),
      buyer: async () => move("offer", null, "hold"),
      seller: async () => move("offer", null, "hold"),
      turnDelayMs: 0,
      onTurn: (_offer, n) => {
        seen.push(n);
      },
    });
    expect(seen).toEqual(result.turns.map((_turn, index) => index + 1));
  });

  it("17. keeps the limit invariants across 200 random stub runs", async () => {
    const random = mulberry32(20260926);
    for (let run = 0; run < 200; run++) {
      const floor = 1 + Math.floor(random() * 120);
      const asking = floor + Math.floor(random() * 80);
      const max = 1 + Math.floor(random() * 200);
      const runLimits = { askingPrice: asking, floorPrice: floor, maxPrice: max };
      const result = await runNegotiation({
        limits: runLimits,
        buyer: async (view) => {
          expect("floorPrice" in view).toBe(false);
          if (random() < 0.05) throw new Error("buyer down");
          return randomMove(random);
        },
        seller: async (view) => {
          expect("maxPrice" in view).toBe(false);
          if (random() < 0.05) throw new Error("seller down");
          return randomMove(random);
        },
        turnDelayMs: 0,
      });
      expect(result.turns.length).toBeGreaterThan(0);
      expect(result.turns.length).toBeLessThanOrEqual(MAX_TURNS);
      let previousBuyer: number | null = null;
      let previousSeller: number | null = null;
      for (const turn of result.turns) {
        expect(turn.price).toBeGreaterThanOrEqual(1);
        if (turn.from === "buyer_agent") {
          expect(turn.price).toBeLessThanOrEqual(max);
          if (previousBuyer != null) expect(turn.price).toBeGreaterThanOrEqual(previousBuyer);
          previousBuyer = turn.price;
        } else {
          expect(turn.price).toBeGreaterThanOrEqual(floor);
          if (previousSeller != null) expect(turn.price).toBeLessThanOrEqual(previousSeller);
          previousSeller = turn.price;
        }
      }
      if (result.finalPrice != null) {
        expect(result.status).toBe("agreed");
        expect(result.finalPrice).toBeGreaterThanOrEqual(floor);
        expect(result.finalPrice).toBeLessThanOrEqual(max);
      } else {
        expect(result.status).toBe("failed");
        expect(result.reason).toBe("max_turns");
      }
    }
  });
});

function randomMove(random: () => number): AgentMove {
  const action = random() < 0.25 ? "accept" : "offer";
  const price = random() < 0.15 ? null : Math.floor(random() * 280) - 20;
  return { action, price, message: `How about £${price ?? 12}?` };
}

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
