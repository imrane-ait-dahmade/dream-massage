export function ChairCardSkeleton() {
  return (
    <div className="animate-pulse overflow-hidden rounded-2xl border border-stone-100 border-l-4 border-l-stone-200 bg-white shadow-sm">
      <div className="flex items-start justify-between p-4 pb-3">
        <div className="flex-1 space-y-2">
          <div className="h-5 w-28 rounded-full bg-stone-100" />
          <div className="h-8 w-10 rounded-lg bg-stone-100" />
          <div className="h-3.5 w-24 rounded bg-stone-100" />
        </div>
        <div className="h-16 w-16 rounded-xl bg-stone-100" />
      </div>
      <div className="mx-4 border-t border-stone-100" />
      <div className="space-y-2 px-4 py-3">
        <div className="flex justify-between">
          <div className="h-4 w-16 rounded bg-stone-100" />
          <div className="h-4 w-16 rounded bg-stone-100" />
        </div>
      </div>
    </div>
  );
}
