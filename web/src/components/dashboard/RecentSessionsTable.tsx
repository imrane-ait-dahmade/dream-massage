// TODO: connect to /api/reports/sessions (global sessions endpoint) when ready.
// Per-chair sessions are available at /api/chairs/:id/sessions — see chair detail page.

const COLS = ['Fauteuil', 'Début', 'Fin', 'Durée', 'Classe', 'Prix', 'Correction'];

export function RecentSessionsTable() {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-800">
      <div className="border-b border-slate-700 px-4 py-3">
        <h3 className="text-sm font-bold text-white">Sessions récentes</h3>
        <p className="mt-0.5 text-xs text-slate-500">
          Toutes fauteuils confondus
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-slate-700 bg-slate-700/30">
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
                {/* TODO: connect to /api/reports/sessions once global session endpoint exists */}
                <p className="text-sm text-slate-600">Aucune session récente</p>
                <p className="mt-1 text-xs text-slate-700">
                  Les sessions globales seront disponibles après activation des rapports.
                </p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
