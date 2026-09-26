import type { ChatResponse, MatchCard, NegotiationEvent } from "@/lib/schemas";

const sessionId = "b7e20000-0000-4000-8000-000000000001";

const shoesCategory = {
  id: "shoes",
  label: "Shoes",
  required: ["type", "size", "colour"],
  optional: ["brand", "model", "condition"],
};

const cyclingCategories = [
  { id: "bike", label: "Bike", required: ["type", "frame_size"], optional: ["brand", "condition"] },
  { id: "helmet", label: "Helmet", required: ["size"], optional: ["brand", "colour"] },
  { id: "jacket", label: "Jacket", required: ["size"], optional: ["colour", "brand"] },
  { id: "glasses", label: "Glasses", required: [] as string[], optional: ["brand"] },
];

const cyclingBundle = {
  id: "cycling",
  label: "Cycling starter kit",
  description: "Bike, helmet, jacket and glasses for someone starting out.",
  categoryIds: ["bike", "helmet", "jacket", "glasses"],
};

function card(partial: Omit<MatchCard, "status" | "busy">): MatchCard {
  return { ...partial, status: "active", busy: false };
}

const tom = card({
  id: "l-tom-am90-8",
  sellerId: "tom",
  sellerName: "Tom",
  sellerType: "private",
  category: "shoes",
  title: "Used Nike Air Max 90, black, UK 8",
  attributes: { type: "sport", size: "8", colour: "black", brand: "nike", model: "air max 90", condition: "used" },
  askingPrice: 90,
  overBudget: false,
  matchedPreferences: ["nike air max"],
});

const nike = card({
  id: "l-nike-am90-8",
  sellerId: "nike",
  sellerName: "Nike Store",
  sellerType: "brand",
  category: "shoes",
  title: "New Nike Air Max 90, black, UK 8",
  attributes: { type: "sport", size: "8", colour: "black", brand: "nike", model: "air max 90", condition: "new" },
  askingPrice: 120,
  overBudget: true,
  matchedPreferences: ["nike air max"],
});

const anna = card({
  id: "l-anna-ultraboost-8",
  sellerId: "anna",
  sellerName: "Anna",
  sellerType: "private",
  category: "shoes",
  title: "Adidas Ultraboost, black, UK 8",
  attributes: { type: "sport", size: "8", colour: "black", brand: "adidas", model: "ultraboost", condition: "used" },
  askingPrice: 85,
  overBudget: false,
  matchedPreferences: [],
});

export const fixtureShoesTurns: { user: string; response: ChatResponse }[] = [
  {
    user: "I want black sport shoes",
    response: {
      requestId: "req-shoes",
      reply: "Nice. Two quick questions: what's your UK shoe size, and what's the most you'd pay?",
      request: {
        id: "req-shoes",
        sessionId,
        bundle: null,
        status: "gathering",
        items: [
          {
            category: "shoes",
            included: true,
            attributes: { type: "sport", colour: "black" },
            preferences: [],
            maxPrice: null,
          },
        ],
      },
      missing: [{ category: "shoes", fields: ["size", "maxPrice"] }],
      catalog: { categories: [shoesCategory], bundle: null },
      matches: null,
      sellersAsked: null,
    },
  },
  {
    user: "Size 8, under £80, ideally Air Max",
    response: {
      requestId: "req-shoes",
      reply: "Found 3 matches. Tom's pair is the closest fit, and I think he'll come down.",
      request: {
        id: "req-shoes",
        sessionId,
        bundle: null,
        status: "ready",
        items: [
          {
            category: "shoes",
            included: true,
            attributes: { type: "sport", colour: "black", size: "8" },
            preferences: ["nike air max"],
            maxPrice: 80,
          },
        ],
      },
      missing: [],
      catalog: { categories: [shoesCategory], bundle: null },
      sellersAsked: 4,
      matches: [{ category: "shoes", listings: [tom, nike, anna] }],
    },
  },
];

export const fixtureCyclingTurns: { user: string; response: ChatResponse }[] = [
  {
    user: "I want to start cycling",
    response: {
      requestId: "req-cycling",
      reply: [
        "Here's a starter kit most people need. Untick anything you already have.",
        "To find the right matches I just need:",
        "1. Bike: road, gravel or hybrid, your frame size, and the most you'd pay?",
        "2. Helmet: your size, and the most you'd pay?",
        "3. Jacket: the most you'd pay?",
        "4. Glasses: the most you'd pay?",
      ].join("\n"),
      request: {
        id: "req-cycling",
        sessionId,
        bundle: "cycling",
        status: "gathering",
        items: [
          { category: "bike", included: true, attributes: {}, preferences: [], maxPrice: null },
          { category: "helmet", included: false, attributes: {}, preferences: [], maxPrice: null },
          { category: "jacket", included: true, attributes: { size: "m" }, preferences: [], maxPrice: null },
          { category: "glasses", included: true, attributes: {}, preferences: [], maxPrice: null },
        ],
      },
      missing: [
        { category: "bike", fields: ["type", "frame_size", "maxPrice"] },
        { category: "jacket", fields: ["maxPrice"] },
        { category: "glasses", fields: ["maxPrice"] },
      ],
      catalog: { categories: cyclingCategories, bundle: cyclingBundle },
      matches: null,
      sellersAsked: null,
    },
  },
];

export const fixtureChatResponses: ChatResponse[] = [
  ...fixtureShoesTurns.map((turn) => turn.response),
  ...fixtureCyclingTurns.map((turn) => turn.response),
];

const negotiationEvents: NegotiationEvent[] = [
  {
    type: "start",
    negotiationId: "9a1c0000-0000-4000-8000-000000000001",
    listing: {
      id: "l-tom-am90-8",
      sellerId: "tom",
      sellerName: "Tom",
      sellerType: "private",
      category: "shoes",
      title: "Used Nike Air Max 90, black, UK 8",
      attributes: { type: "sport", size: "8", colour: "black", brand: "nike", model: "air max 90", condition: "used" },
      askingPrice: 90,
      status: "active",
      busy: false,
    },
  },
  { type: "turn", n: 1, offer: { from: "seller_agent", action: "offer", price: 90, message: "Asking £90, barely worn." } },
  { type: "turn", n: 2, offer: { from: "buyer_agent", action: "offer", price: 68, message: "Similar pairs go for less. I can do £68." } },
  { type: "turn", n: 3, offer: { from: "seller_agent", action: "offer", price: 79, message: "Original box included. £79." } },
  { type: "turn", n: 4, offer: { from: "buyer_agent", action: "offer", price: 74, message: "Meet me at £74 and we're done." } },
  { type: "turn", n: 5, offer: { from: "seller_agent", action: "accept", price: 74, message: "Deal at £74." } },
  { type: "end", status: "agreed", finalPrice: 74, reason: "accepted" },
];

export const fixtureNegotiationLines: string[] = negotiationEvents.map((event) => JSON.stringify(event));
