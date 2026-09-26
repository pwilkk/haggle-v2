export function Header({ onNewChat }: { onNewChat: () => void }) {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-5">
        <div className="flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">H</div>
          <span className="text-lg font-bold tracking-tight text-slate-900">Haggle</span>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={onNewChat} className="text-sm text-slate-500 hover:text-slate-800">
            New chat
          </button>
          <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white py-1 pr-3 pl-1 shadow-xs">
            <div className="grid h-6 w-6 place-items-center rounded-full bg-slate-800 text-[11px] font-semibold text-white">
              Y
            </div>
            <span className="text-sm font-medium text-slate-700">
              You <span className="font-normal text-slate-400">(buyer)</span>
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
