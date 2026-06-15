// TODO: connect to bonus/prime rules endpoint when backend support is ready.
// Shows placeholder structure matching the expected Primes & Recettes report shape.

const COLS = ['Période', 'Total', 'Prime', 'Bonus', 'Prime totale', 'Recette'];

export function PrimeRevenueCard() {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-800">
      <div className="border-b border-slate-700 px-4 py-3">
        <h3 className="text-sm font-bold text-white">Primes &amp; Recettes</h3>
        <p className="mt-0.5 text-xs text-slate-500">
          Règles de prime non configurées
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="bg-slate-700/30">
              {COLS.map((c) => (
                <th
                  key={c}
                  className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={COLS.length} className="px-4 py-10 text-center">
                {/* TODO: implement bonus/prime calculation rules in settings, then connect here */}
                <p className="text-sm text-slate-600">À configurer</p>
                <p className="mt-1 text-xs text-slate-700">
                  Les règles de prime et recettes seront disponibles après configuration.
                </p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
