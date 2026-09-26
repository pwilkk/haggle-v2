export function StatusLine({ sellersAsked }: { sellersAsked: number }) {
  return (
    <div className="flex items-center justify-center gap-2 text-xs text-slate-400">
      <span className="h-px w-10 bg-slate-200" />
      <svg className="h-3.5 w-3.5 animate-spin text-brand-500" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      Asked {sellersAsked} seller agents...
      <span className="h-px w-10 bg-slate-200" />
    </div>
  );
}
