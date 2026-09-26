export function fieldLabel(key: string): string {
  if (key === "maxPrice") return "Budget";
  return key.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function missingName(key: string): string {
  if (key === "maxPrice") return "budget";
  return key.replace(/_/g, " ");
}

export function titleValue(value: string): string {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const NAMED_COLOURS = new Set([
  "black",
  "white",
  "red",
  "blue",
  "green",
  "yellow",
  "orange",
  "purple",
  "pink",
  "brown",
  "grey",
  "gray",
  "navy",
  "beige",
  "gold",
  "silver",
]);

export function isCssColor(value: string): boolean {
  const colour = value.trim().toLowerCase();
  return NAMED_COLOURS.has(colour) || /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(colour);
}

export function letterOf(label: string): string {
  const letter = label.trim().charAt(0).toUpperCase();
  return letter || "?";
}

export function gaps(item: { attributes: Record<string, string>; maxPrice: number | null }, required: string[]): string[] {
  const fields = required.filter((key) => !item.attributes[key]);
  if (item.maxPrice == null) fields.push("maxPrice");
  return fields;
}
