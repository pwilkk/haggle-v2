import { Fragment } from "react";
import type { BuyerRequest, ChatResponse } from "@/lib/schemas";
import { LockNote } from "./Bubbles";
import { fieldLabel, gaps, isCssColor, missingName, titleValue } from "./format";

export function RequestCard({
  request,
  catalog,
  excluded,
}: {
  request: BuyerRequest;
  catalog: ChatResponse["catalog"];
  excluded: string[];
}) {
  const open = request.items.filter((item) => !excluded.includes(item.category));
  const names = open.flatMap((item) => gaps(item, requiredOf(catalog, item.category))).map(missingName);

  return (
    <div className="max-w-md overflow-hidden rounded-2xl rounded-tl-md border border-slate-200 bg-white shadow-xs">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="text-sm font-semibold text-slate-900">Your request</div>
        {names.length === 0 ? (
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
            Complete
          </span>
        ) : (
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
            Missing: {names.join(", ")}
          </span>
        )}
      </div>
      <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 px-4 pb-3 text-sm">
        {request.items.map((item) => {
          const category = catalog.categories.find((row) => row.id === item.category);
          const optional = new Set(category?.optional ?? []);
          return (
            <Fragment key={item.category}>
              <dt className="text-slate-500">Item</dt>
              <dd className="font-medium">{category?.label ?? item.category}</dd>
              {(category?.required ?? []).map((key) => (
                <Field key={`${item.category}-${key}`} label={fieldLabel(key)} value={item.attributes[key]} />
              ))}
              {Object.entries(item.attributes)
                .filter(([key]) => optional.has(key))
                .map(([key, value]) => (
                  <Field key={`${item.category}-${key}`} label={fieldLabel(key)} value={value} />
                ))}
              <dt className="text-slate-500">Preference</dt>
              <dd className="font-medium">{item.preferences.length > 0 ? item.preferences.map(titleValue).join(", ") : "—"}</dd>
              <dt className="text-slate-500">Budget</dt>
              <dd className="font-medium">{item.maxPrice == null ? "—" : `Up to £${item.maxPrice}`}</dd>
            </Fragment>
          );
        })}
      </dl>
      <div className="flex items-center gap-1.5 border-t border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-500">
        <LockNote>Budget is private, never shared with sellers</LockNote>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | undefined }) {
  return (
    <>
      <dt className="text-slate-500">{label}</dt>
      <dd className="flex items-center gap-1.5 font-medium">
        {value && isCssColor(value) ? (
          <span className="inline-block h-3 w-3 rounded-full ring-1 ring-slate-200" style={{ backgroundColor: value }} />
        ) : null}
        {value ? titleValue(value) : "—"}
      </dd>
    </>
  );
}

function requiredOf(catalog: ChatResponse["catalog"], categoryId: string): string[] {
  return catalog.categories.find((category) => category.id === categoryId)?.required ?? [];
}
