// TODO: connect to /api/reports/totals-by-chair when the report endpoint is ready.
// Shows a placeholder table structure matching the expected data shape.

const CHAIRS = ['F1', 'F2', 'F3', 'F4', 'F5'];
const PLANS = ['5m', '10m', '15m', '20m', '30m'];

export function TotalsByChairTable() {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-800">
      {/* Scrollable table */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-slate-700 bg-slate-700/50">
              <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Fauteuil
              </th>
              <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Sessions
              </th>
              {PLANS.map((p) => (
                <th
                  key={p}
                  className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-400"
                >
                  {p}
                </th>
              ))}
              <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Hors règle
              </th>
              <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Total DH
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/40">
            {CHAIRS.map((chair) => (
              <tr key={chair} className="transition-colors hover:bg-slate-700/20">
                <td className="px-4 py-3 font-semibold text-white">{chair}</td>
                <td className="px-4 py-3 text-right text-slate-600">—</td>
                {PLANS.map((p) => (
                  <td key={p} className="px-4 py-3 text-right text-slate-600">
                    —
                  </td>
                ))}
                <td className="px-4 py-3 text-right text-slate-600">—</td>
                <td className="px-4 py-3 text-right text-slate-600">—</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-700 bg-slate-700/30">
              <td className="px-4 py-3 font-bold text-slate-300">Total</td>
              <td className="px-4 py-3 text-right text-slate-600">—</td>
              {PLANS.map((p) => (
                <td key={p} className="px-4 py-3 text-right text-slate-600">
                  —
                </td>
              ))}
              <td className="px-4 py-3 text-right text-slate-600">—</td>
              <td className="px-4 py-3 text-right text-slate-600">—</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="border-t border-slate-700/50 px-4 py-3 text-center">
        <p className="text-xs text-slate-600">
          Les totaux par fauteuil seront disponibles après activation des rapports.
        </p>
      </div>
    </div>
  );
}
