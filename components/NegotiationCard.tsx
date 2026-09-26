import type { EndReason, Offer } from "@/lib/schemas";
import { LockNote } from "./Bubbles";
import { letterOf } from "./format";

export function NegotiationCard({
  sellerName,
  title,
  askingPrice,
  maxPrice,
  turns,
  status,
  finalPrice,
  reason,
  error,
  decision,
  accepting,
  onAccept,
  onWalkAway,
  onRetry,
}: {
  sellerName: string;
  title: string;
  askingPrice: number;
  maxPrice: number | null;
  turns: Offer[];
  status: "running" | "agreed" | "failed" | "error";
  finalPrice: number | null;
  reason: EndReason | null;
  error?: string;
  decision: null | "accepted" | "walked";
  accepting: boolean;
  onAccept: () => void;
  onWalkAway: () => void;
  onRetry: () => void;
}) {
  const initial = letterOf(sellerName);
  const nextSide = turns.length % 2 === 0 ? "seller" : "buyer";

  return (
    <div className="overflow-hidden rounded-2xl rounded-tl-md border border-slate-200 bg-white shadow-xs">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-900">Negotiating with {sellerName}&apos;s agent</div>
          <div className="truncate text-xs text-slate-500">{title}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1 text-[11px] text-slate-400">
          <LockNote>Limits stay private</LockNote>
        </div>
      </div>

      <div className="space-y-3 bg-slate-50/60 px-4 py-4 text-sm">
        {turns.map((offer, index) =>
          offer.from === "seller_agent" ? (
            <SellerBubble key={index} initial={initial} sellerName={sellerName} offer={offer} />
          ) : (
            <BuyerBubble key={index} offer={offer} />
          ),
        )}
        {status === "running" ? <Typing side={nextSide} initial={initial} /> : null}
      </div>

      {turns.length > 0 ? (
        <PricePath turns={turns} finalPrice={finalPrice} agreed={status === "agreed"} trailing={status === "running"} />
      ) : null}

      {status !== "running" ? (
        <div className="p-4 pt-2">
          {status === "agreed" && finalPrice != null ? (
            <>
              <div
                className={`rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 ${
                  decision === "walked" ? "opacity-60" : ""
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div className="grid h-7 w-7 place-items-center rounded-full bg-emerald-500 text-sm text-white">✓</div>
                  <div>
                    <div className="font-semibold text-emerald-800">Agreed at £{finalPrice}</div>
                    <div className="text-xs text-emerald-700/80">
                      {decision === "walked"
                        ? "You walked away"
                        : subline(reason, turns, sellerName, askingPrice, finalPrice, maxPrice)}
                    </div>
                  </div>
                </div>
              </div>
              {decision == null && !error ? (
                <>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={onAccept}
                      disabled={accepting}
                      className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 py-2.5 font-semibold text-white shadow-xs hover:bg-emerald-700 disabled:opacity-60"
                    >
                      {accepting ? (
                        <>
                          <Spinner />
                          Accepting…
                        </>
                      ) : (
                        `Accept deal · £${finalPrice}`
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={onWalkAway}
                      disabled={accepting}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 font-medium text-slate-600 disabled:opacity-60"
                    >
                      Walk away
                    </button>
                  </div>
                  <p className="mt-2 text-center text-[11px] text-slate-400">Held for you for 2 minutes</p>
                </>
              ) : null}
              {decision == null && error ? <p className="mt-3 text-sm text-slate-600">{error}</p> : null}
            </>
          ) : null}
          {status === "failed" ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              No deal. Couldn&apos;t meet within your budget in 6 turns.
            </div>
          ) : null}
          {status === "error" ? (
            <>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                {error || "Negotiation interrupted"}
              </div>
              <button
                type="button"
                onClick={onRetry}
                className="mt-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600"
              >
                Try again
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SellerBubble({ initial, sellerName, offer }: { initial: string; sellerName: string; offer: Offer }) {
  return (
    <div className="flex items-end gap-2">
      <div className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-orange-100 text-[10px] font-bold text-orange-700">
        {initial}
      </div>
      <div className="max-w-[70%]">
        <div className="mb-0.5 text-[11px] text-slate-400">{sellerName}&apos;s agent</div>
        <div className="flex flex-wrap items-center gap-2 rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3 py-2">
          <PriceChip tone="seller" offer={offer} />
          <span className="break-words">{offer.message}</span>
        </div>
      </div>
    </div>
  );
}

function BuyerBubble({ offer }: { offer: Offer }) {
  return (
    <div className="flex items-end justify-end gap-2">
      <div className="max-w-[70%] text-right">
        <div className="mb-0.5 text-[11px] text-slate-400">Your agent</div>
        <div className="flex flex-wrap items-center justify-end gap-2 rounded-2xl rounded-br-md border border-brand-100 bg-brand-50 px-3 py-2 text-left">
          <span className="break-words">{offer.message}</span>
          <PriceChip tone="buyer" offer={offer} />
        </div>
      </div>
      <div className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-100 text-[10px] font-bold text-brand-700">
        ✦
      </div>
    </div>
  );
}

function PriceChip({ tone, offer }: { tone: "seller" | "buyer"; offer: Offer }) {
  const tick = offer.action === "accept" ? " ✓" : "";
  if (tone === "seller") {
    return (
      <span className="rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-xs font-semibold text-orange-700">
        £{offer.price}
        {tick}
      </span>
    );
  }
  return (
    <span className="rounded-full bg-brand-600 px-2 py-0.5 text-xs font-semibold text-white">
      £{offer.price}
      {tick}
    </span>
  );
}

function Typing({ side, initial }: { side: "seller" | "buyer"; initial: string }) {
  const dots = (
    <span className="inline-flex items-center gap-1 px-1" aria-hidden="true">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400 [animation-delay:150ms]" />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400 [animation-delay:300ms]" />
    </span>
  );
  if (side === "buyer") {
    return (
      <div className="flex items-end justify-end gap-2" aria-label="Your agent is replying">
        <div className="rounded-2xl rounded-br-md border border-brand-100 bg-brand-50 px-3 py-2">{dots}</div>
        <div className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-100 text-[10px] font-bold text-brand-700">
          ✦
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-end gap-2" aria-label="Seller's agent is replying">
      <div className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-orange-100 text-[10px] font-bold text-orange-700">
        {initial}
      </div>
      <div className="rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3 py-2">{dots}</div>
    </div>
  );
}

function PricePath({
  turns,
  finalPrice,
  agreed,
  trailing,
}: {
  turns: Offer[];
  finalPrice: number | null;
  agreed: boolean;
  trailing: boolean;
}) {
  const prices = turns.map((turn) => turn.price);
  if (agreed && finalPrice != null && finalPrice !== prices[prices.length - 1]) prices.push(finalPrice);
  return (
    <div
      className={`flex flex-wrap items-center gap-1.5 px-4 pt-3 text-[11px] text-slate-400 ${trailing ? "pb-4" : "pb-1"}`}
    >
      <span>Price path:</span>
      {prices.map((price, index) => {
        const last = index === prices.length - 1;
        return (
          <span key={`${price}-${index}`} className="inline-flex items-center gap-1.5">
            {index > 0 ? <span>→</span> : null}
            <span className={agreed && last ? "font-semibold text-emerald-600" : "text-slate-500"}>£{price}</span>
          </span>
        );
      })}
    </div>
  );
}

function subline(
  reason: EndReason | null,
  turns: Offer[],
  sellerName: string,
  askingPrice: number,
  finalPrice: number,
  maxPrice: number | null,
): string {
  const saved = askingPrice - finalPrice;
  const budget = maxPrice != null ? ` · within your £${maxPrice} budget` : "";
  return `${reasonText(reason, turns, sellerName)} · £${saved} below asking${budget}`;
}

function reasonText(reason: EndReason | null, turns: Offer[], sellerName: string): string {
  if (reason === "midpoint") return "Split the difference";
  if (reason === "crossed") return "Offers met";
  if (reason === "accepted") {
    const last = turns[turns.length - 1];
    return last?.from === "buyer_agent" ? "Your agent accepted" : `${sellerName}'s agent accepted`;
  }
  return "Agreed";
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".35" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
