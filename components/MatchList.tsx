import type { BuyerRequest, ChatResponse, ItemMatches, MatchCard } from "@/lib/schemas";
import { letterOf, titleValue } from "./format";

export function MatchList({
  matches,
  request,
  catalog,
  busyIds = [],
  soldIds = [],
  negotiating = false,
  onNegotiate,
}: {
  matches: ItemMatches[];
  request: BuyerRequest | null;
  catalog: ChatResponse["catalog"] | null;
  busyIds?: string[];
  soldIds?: string[];
  negotiating?: boolean;
  onNegotiate?: (card: MatchCard, category: string) => void;
}) {
  const bundled = Boolean(request?.bundle);
  return (
    <div className="mt-3 space-y-4">
      {matches.map((group) => {
        const label = catalog?.categories.find((category) => category.id === group.category)?.label ?? group.category;
        const preferences = request?.items.find((item) => item.category === group.category)?.preferences ?? [];
        return (
          <section key={group.category} className="space-y-2.5 pt-1">
            {bundled ? <h3 className="text-sm font-semibold text-slate-700">{label}</h3> : null}
            {group.listings.length === 0 ? (
              <p className="text-sm text-slate-500">No matches for {label} right now.</p>
            ) : (
              group.listings.map((listing, index) => (
                <MatchRow
                  key={listing.id}
                  card={listing}
                  best={index === 0}
                  letter={letterOf(label)}
                  preferences={preferences}
                  busy={listing.busy || busyIds.includes(listing.id)}
                  sold={listing.status === "sold" || soldIds.includes(listing.id)}
                  negotiating={negotiating}
                  onNegotiate={onNegotiate ? () => onNegotiate(listing, group.category) : undefined}
                />
              ))
            )}
          </section>
        );
      })}
    </div>
  );
}

function MatchRow({
  card,
  best,
  letter,
  preferences,
  busy,
  sold,
  negotiating,
  onNegotiate,
}: {
  card: MatchCard;
  best: boolean;
  letter: string;
  preferences: string[];
  busy: boolean;
  sold: boolean;
  negotiating: boolean;
  onNegotiate?: () => void;
}) {
  const condition = card.attributes.condition;
  return (
    <div
      className={`relative flex items-center gap-3 rounded-2xl bg-white p-3 ${
        best ? "border-2 border-brand-500 shadow-md shadow-brand-100" : "border border-slate-200 shadow-xs"
      }`}
    >
      {best ? (
        <span className="absolute -top-2.5 left-4 rounded-full bg-brand-600 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-white uppercase">
          Best match
        </span>
      ) : null}
      <div className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-slate-100 text-lg font-semibold text-slate-500">
        {letter}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold break-words text-slate-900">{card.title}</div>
        <div className="mt-0.5 text-xs text-slate-500">
          {card.sellerName} · {card.sellerType === "private" ? "private seller" : "brand"}
        </div>
        <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
          {condition ? <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">{titleValue(condition)}</span> : null}
          {preferences.map((preference) =>
            card.matchedPreferences.includes(preference) ? (
              <span key={preference} className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">
                {titleValue(preference)} ✓
              </span>
            ) : (
              <span key={preference} className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">
                Not {titleValue(preference)}
              </span>
            ),
          )}
          {card.overBudget ? (
            <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700">Over budget</span>
          ) : null}
          {busy ? (
            <span className="rounded bg-slate-200 px-1.5 py-0.5 font-medium text-slate-600" title="Someone is haggling for this one">
              Busy
            </span>
          ) : null}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-xs text-slate-400">asking</div>
        <div className="text-lg leading-tight font-bold text-slate-900">£{card.askingPrice}</div>
        {sold ? (
          <div className="mt-1.5 text-sm font-semibold text-slate-400">Sold</div>
        ) : (
          <button
            type="button"
            disabled={negotiating || !onNegotiate}
            onClick={onNegotiate}
            className={`mt-1.5 rounded-lg px-3 py-1.5 text-sm ${
              best ? "bg-brand-600 font-semibold text-white hover:bg-brand-700" : "border border-slate-200 font-medium text-slate-600"
            } disabled:cursor-not-allowed disabled:opacity-50`}
          >
            Negotiate
          </button>
        )}
      </div>
    </div>
  );
}
