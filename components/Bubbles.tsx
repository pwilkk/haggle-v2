import type { ReactNode } from "react";

export function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[75%] rounded-2xl rounded-br-md bg-brand-600 px-4 py-2.5 text-white shadow-xs break-words">
        {text}
      </div>
    </div>
  );
}

export function AgentBlock({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
        ✦
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 text-xs text-slate-400">Your agent</div>
        {children}
      </div>
    </div>
  );
}

export function AgentText({ text, error }: { text: string; error?: boolean }) {
  return (
    <div
      className={`inline-block max-w-full rounded-2xl rounded-tl-md border bg-white px-4 py-2.5 shadow-xs whitespace-pre-line ${
        error ? "border-amber-200 text-amber-800" : "border-slate-200"
      }`}
    >
      {text}
    </div>
  );
}

export function Note({ text }: { text: string }) {
  const tapped = text.match(/^(You tapped )(Negotiate|Accept deal)([\s\S]*)$/);
  return (
    <div className="flex justify-end">
      <div className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">
        {tapped ? (
          <>
            {tapped[1]}
            <span className={`font-medium ${tapped[2] === "Accept deal" ? "text-emerald-700" : "text-slate-700"}`}>
              {tapped[2]}
            </span>
            {tapped[3]}
          </>
        ) : (
          text
        )}
      </div>
    </div>
  );
}

export function TypingBubble() {
  return (
    <AgentBlock>
      <div className="inline-block rounded-2xl rounded-tl-md border border-slate-200 bg-white px-4 py-2.5 text-slate-400 shadow-xs">
        Your agent is typing…
      </div>
    </AgentBlock>
  );
}

export function LockNote({ children }: { children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path
          fillRule="evenodd"
          d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5A4.5 4.5 0 0 0 10 1Zm3 8V5.5a3 3 0 1 0-6 0V9h6Z"
          clipRule="evenodd"
        />
      </svg>
      {children}
    </span>
  );
}
