import type { BuyerRequest, ChatResponse, RequestItem } from "@/lib/schemas";
import { LockNote } from "./Bubbles";
import { gaps, letterOf, missingName, titleValue } from "./format";

export function BundleCard({
  request,
  catalog,
  excluded,
  pending,
  onToggle,
}: {
  request: BuyerRequest;
  catalog: ChatResponse["catalog"];
  excluded: string[];
  pending: boolean;
  onToggle: (category: string) => void;
}) {
  const locked = pending || request.status === "ready";
  const selected = request.items.filter((item) => !excluded.includes(item.category));
  const missingCount = selected.reduce((sum, item) => sum + gaps(item, requiredOf(catalog, item.category)).length, 0);
  const title = catalog.bundle?.label ?? "Bundle";

  return (
    <div className="max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
      <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2">
        <div>
          <div className="text-sm font-semibold text-slate-900">{title}</div>
          <div className="text-xs text-slate-500">Bundle · {request.items.length} items</div>
        </div>
        {missingCount === 0 ? (
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
            Ready
          </span>
        ) : (
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
            {missingCount === 1 ? "1 detail missing" : `${missingCount} details missing`}
          </span>
        )}
      </div>
      <div className="divide-y divide-slate-100 border-t border-slate-100">
        {request.items.map((item) => {
          const category = catalog.categories.find((row) => row.id === item.category);
          const skipped = excluded.includes(item.category);
          const missing = gaps(item, category?.required ?? []);
          return (
            <label key={item.category} className={`flex items-center gap-3 px-4 py-2.5 ${locked ? "" : "cursor-pointer hover:bg-slate-50"}`}>
              <input
                type="checkbox"
                className="h-4 w-4 rounded accent-brand-600"
                checked={!skipped}
                disabled={locked}
                onChange={() => onToggle(item.category)}
              />
              <span className="grid h-6 w-6 place-items-center rounded-md bg-slate-100 text-xs font-semibold text-slate-600">
                {letterOf(category?.label ?? item.category)}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-sm font-medium ${skipped ? "text-slate-400" : "text-slate-900"}`}>
                  {category?.label ?? item.category}
                </span>
                <span className="block text-xs text-slate-500">{subtitle(item, missing, skipped)}</span>
              </span>
              <ItemChip skipped={skipped} missing={missing} />
            </label>
          );
        })}
      </div>
      <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-500">
        <span>
          {selected.length} of {request.items.length} selected
        </span>
        <LockNote>Budget stays private</LockNote>
      </div>
    </div>
  );
}

function subtitle(item: RequestItem, missing: string[], skipped: boolean): string {
  if (skipped) return "Skipped";
  const filled = Object.values(item.attributes).filter(Boolean).map(titleValue);
  if (item.maxPrice != null) filled.push(`up to £${item.maxPrice}`);
  if (filled.length > 0) return filled.join(" · ");
  if (missing.length > 0) return `Needs: ${missing.map(missingName).join(", ")}`;
  return "—";
}

function ItemChip({ skipped, missing }: { skipped: boolean; missing: string[] }) {
  if (skipped) {
    return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">Skipped</span>;
  }
  if (missing.length === 0) {
    return (
      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">Ready</span>
    );
  }
  if (missing.length === 1) {
    return (
      <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
        Needs {missingName(missing[0]!)}
      </span>
    );
  }
  return (
    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-700">Needs details</span>
  );
}

function requiredOf(catalog: ChatResponse["catalog"], categoryId: string): string[] {
  return catalog.categories.find((category) => category.id === categoryId)?.required ?? [];
}
