import type { Catalog, Listing, ListingView, RequestItem } from "@/lib/schemas";

type FixtureListing = Listing & {
  sellerName: string;
  sellerType: "brand" | "private";
};

const pat = { sellerId: "f-pat", sellerName: "Pat", sellerType: "private" as const };
const shop = { sellerId: "f-shop", sellerName: "Brand Shop", sellerType: "brand" as const };

const rows: FixtureListing[] = [
  {
    ...pat,
    id: "f-am90-8-used",
    category: "shoes",
    title: "Used Nike Air Max 90, black, UK 8",
    attributes: {
      type: "sport",
      size: "8",
      colour: "black",
      brand: "nike",
      model: "air max 90",
      condition: "used",
    },
    askingPrice: 90,
    floorPrice: 70,
    status: "active",
  },
  {
    ...shop,
    id: "f-am90-8-new",
    category: "shoes",
    title: "New Nike Air Max 90, black, UK 8",
    attributes: {
      type: "sport",
      size: "8",
      colour: "black",
      brand: "nike",
      model: "air max 90",
      condition: "new",
    },
    askingPrice: 120,
    floorPrice: 105,
    status: "active",
  },
  {
    ...pat,
    id: "f-ultraboost-8",
    category: "shoes",
    title: "Adidas Ultraboost, black, UK 8",
    attributes: {
      type: "sport",
      size: "8",
      colour: "black",
      brand: "adidas",
      model: "ultraboost",
      condition: "used",
    },
    askingPrice: 85,
    floorPrice: 68,
    status: "active",
  },
  {
    ...pat,
    id: "f-am90-10",
    category: "shoes",
    title: "Used Nike Air Max 90, black, UK 10",
    attributes: { type: "sport", size: "10", colour: "black" },
    askingPrice: 80,
    floorPrice: 60,
    status: "active",
  },
  {
    ...pat,
    id: "f-gazelle-8-white",
    category: "shoes",
    title: "Adidas Gazelle, white, UK 8",
    attributes: { type: "casual", size: "8", colour: "white" },
    askingPrice: 55,
    floorPrice: 45,
    status: "active",
  },
  {
    ...pat,
    id: "f-sold-8",
    category: "shoes",
    title: "Sold sport shoe, black, UK 8",
    attributes: { type: "sport", size: "8", colour: "black" },
    askingPrice: 50,
    floorPrice: 40,
    status: "sold",
  },
  {
    ...pat,
    id: "f-no-colour-8",
    category: "shoes",
    title: "Sport shoe, UK 8",
    attributes: { type: "sport", size: "8" },
    askingPrice: 60,
    floorPrice: 50,
    status: "active",
  },
  {
    ...shop,
    id: "f-bike-500",
    category: "bike",
    title: "Hybrid bike, L frame",
    attributes: { type: "hybrid", frame_size: "l", brand: "boardman", condition: "new" },
    askingPrice: 500,
    floorPrice: 400,
    status: "active",
  },
  {
    ...shop,
    id: "f-bike-600",
    category: "bike",
    title: "Hybrid bike, L frame",
    attributes: { type: "hybrid", frame_size: "l", brand: "specialized", condition: "new" },
    askingPrice: 600,
    floorPrice: 480,
    status: "active",
  },
  {
    ...pat,
    id: "f-bike-700",
    category: "bike",
    title: "Hybrid bike, L frame",
    attributes: { type: "hybrid", frame_size: "l", brand: "trek", condition: "used" },
    askingPrice: 700,
    floorPrice: 560,
    status: "active",
  },
  {
    ...shop,
    id: "f-helmet",
    category: "helmet",
    title: "Helmet, M, black",
    attributes: { size: "m", brand: "giro", colour: "black" },
    askingPrice: 60,
    floorPrice: 45,
    status: "active",
  },
  {
    ...shop,
    id: "f-jacket-50",
    category: "jacket",
    title: "Cycling jacket, L, yellow",
    attributes: { size: "l", colour: "yellow", brand: "dhb" },
    askingPrice: 50,
    floorPrice: 40,
    status: "active",
  },
  {
    ...pat,
    id: "f-jacket-70",
    category: "jacket",
    title: "Cycling jacket, M, black",
    attributes: { size: "m", colour: "black", brand: "altura" },
    askingPrice: 70,
    floorPrice: 55,
    status: "active",
  },
  {
    ...shop,
    id: "f-glasses",
    category: "glasses",
    title: "Cycling glasses",
    attributes: { brand: "oakley" },
    askingPrice: 30,
    floorPrice: 20,
    status: "active",
  },
];

export const catalog: Catalog = {
  categories: [
    {
      id: "shoes",
      label: "Shoes",
      required: ["type", "size", "colour"],
      optional: ["brand", "model", "condition"],
    },
    {
      id: "bike",
      label: "Bike",
      required: ["type", "frame_size"],
      optional: ["brand", "condition"],
    },
    { id: "helmet", label: "Helmet", required: ["size"], optional: ["brand", "colour"] },
    { id: "jacket", label: "Jacket", required: ["size"], optional: ["colour", "brand"] },
    { id: "glasses", label: "Glasses", required: [], optional: ["brand"] },
  ],
  bundles: [
    {
      id: "kit",
      label: "Starter kit",
      description: "Bike, helmet, jacket and glasses.",
      categoryIds: ["bike", "helmet", "jacket", "glasses"],
    },
  ],
};

export const listingViews: ListingView[] = rows.map((row) => ({
  id: row.id,
  sellerId: row.sellerId,
  category: row.category,
  title: row.title,
  attributes: row.attributes,
  askingPrice: row.askingPrice,
  status: row.status,
  sellerName: row.sellerName,
  sellerType: row.sellerType,
  busy: false,
}));

export function privateListing(id: string): Listing {
  const row = rows.find((r) => r.id === id);
  if (!row) throw new Error(`Unknown fixture listing: ${id}`);
  return {
    id: row.id,
    sellerId: row.sellerId,
    category: row.category,
    title: row.title,
    attributes: row.attributes,
    askingPrice: row.askingPrice,
    floorPrice: row.floorPrice,
    status: row.status,
  };
}

export function item(overrides: Partial<RequestItem> = {}): RequestItem {
  return {
    category: "shoes",
    included: true,
    attributes: {},
    preferences: [],
    maxPrice: null,
    ...overrides,
  };
}
