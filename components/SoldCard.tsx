import { AgentBlock } from "./Bubbles";

export function SoldCard({ title, price, saved }: { title: string; price: number; saved: number }) {
  return (
    <AgentBlock>
      <div className="max-w-[80%] rounded-2xl rounded-tl-md border border-slate-200 bg-white px-4 py-3 shadow-xs">
        <div className="mb-1">
          <span className="rounded-md bg-emerald-600 px-2 py-0.5 text-[11px] font-bold tracking-wide text-white uppercase">
            Sold
          </span>
        </div>
        Deal done. You bought <span className="font-semibold">{title}</span> for{" "}
        <span className="font-semibold">£{price}</span>{" "}
        <span className="font-medium whitespace-nowrap text-emerald-600">(saved £{saved})</span>.
      </div>
    </AgentBlock>
  );
}
