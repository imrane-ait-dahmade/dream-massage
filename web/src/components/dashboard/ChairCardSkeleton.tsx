export function ChairCardSkeleton() {
  return (
    <div className="animate-pulse overflow-hidden rounded-2xl border border-slate-700 border-l-4 border-l-slate-600 bg-slate-800 shadow-lg">
      <div className="p-4 pb-3 space-y-2.5">
        <div className="h-4 w-24 rounded-full bg-slate-700" />
        <div className="h-7 w-10 rounded-lg bg-slate-700" />
        <div className="h-3 w-20 rounded bg-slate-700" />
      </div>
      <div className="mx-4 border-t border-slate-700/60" />
      <div className="px-4 py-3 space-y-2">
        <div className="flex justify-between">
          <div className="h-3.5 w-14 rounded bg-slate-700" />
          <div className="h-3.5 w-14 rounded bg-slate-700" />
        </div>
      </div>
    </div>
  );
}
