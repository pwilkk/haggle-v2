import { MAX_MESSAGE_CHARS } from "@/lib/schemas";

export function Composer({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <footer className="sticky bottom-0 z-20 bg-linear-to-t from-slate-50 via-slate-50 to-slate-50/0 pt-4 pb-5">
      <form
        className="mx-auto max-w-2xl px-5"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white py-2 pr-2 pl-4 shadow-xs">
          <input
            className="flex-1 bg-transparent text-[15px] outline-hidden placeholder:text-slate-400"
            placeholder="Tell your agent what you need..."
            maxLength={MAX_MESSAGE_CHARS}
            value={value}
            aria-label="Tell your agent what you need"
            aria-describedby="composer-limit"
            autoComplete="off"
            onChange={(event) => onChange(event.target.value)}
          />
          <span
            id="composer-limit"
            className={`shrink-0 text-[11px] tabular-nums ${value.length >= MAX_MESSAGE_CHARS ? "text-amber-600" : "text-slate-400"}`}
            aria-label={`${value.length} of ${MAX_MESSAGE_CHARS} characters`}
          >
            {value.length}/{MAX_MESSAGE_CHARS}
          </span>
          <button type="submit" className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-white" aria-label="Send">
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M3.1 2.3a.75.75 0 0 0-.99.9l1.95 6.05H10a.75.75 0 0 1 0 1.5H4.06l-1.95 6.05a.75.75 0 0 0 .99.9l14.5-6.5a.75.75 0 0 0 0-1.36L3.1 2.3Z" />
            </svg>
          </button>
        </div>
        <p className="mt-2 text-center text-[11px] text-slate-400">
          Your agent never reveals your max price. You always confirm before paying.
        </p>
      </form>
    </footer>
  );
}
