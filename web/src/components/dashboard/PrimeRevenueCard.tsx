'use client';

import type { HomePrimeRevenue } from '@/lib/types';
import { formatDH } from '@/lib/format';

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  data: HomePrimeRevenue | undefined;
  loading: boolean;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Row({
  label,
  value,
  highlight = false,
  muted = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between px-4 py-2.5 ${highlight ? 'bg-slate-700/30' : ''}`}
    >
      <span className={`text-xs ${muted ? 'text-slate-600' : 'text-slate-400'}`}>{label}</span>
      <span
        className={`text-sm font-semibold ${
          highlight ? 'text-white' : muted ? 'text-slate-600' : 'text-slate-300'
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <div className="h-3 w-40 animate-pulse rounded bg-slate-700" />
      <div className="h-3 w-20 animate-pulse rounded bg-slate-700" />
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PrimeRevenueCard({ data, loading }: Props) {
  const allZero =
    data &&
    data.planCommission === 0 &&
    data.targetBonus === 0 &&
    data.manualBonus === 0 &&
    data.totalPrime === 0;

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-800">
      <div className="border-b border-slate-700 px-4 py-3">
        <h3 className="text-sm font-bold text-white">Primes &amp; Recettes</h3>
        <p className="mt-0.5 text-xs text-slate-500">
          Basé sur les shifts clôturés dans la période
        </p>
      </div>

      <div className="divide-y divide-slate-700/40">
        {loading && !data ? (
          Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)
        ) : !data ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-slate-600">Aucune donnée disponible</p>
          </div>
        ) : (
          <>
            <Row label="Revenu brut (sessions)" value={formatDH(data.grossRevenue)} />
            <Row
              label="Prime par plan (commission)"
              value={data.planCommission > 0 ? formatDH(data.planCommission) : '—'}
              muted={data.planCommission === 0}
            />
            <Row
              label="Bonus objectif"
              value={data.targetBonus > 0 ? formatDH(data.targetBonus) : '—'}
              muted={data.targetBonus === 0}
            />
            <Row
              label="Bonus manuel"
              value={data.manualBonus > 0 ? formatDH(data.manualBonus) : '—'}
              muted={data.manualBonus === 0}
            />
            <Row
              label="Prime totale"
              value={formatDH(data.totalPrime)}
              highlight={data.totalPrime > 0}
              muted={data.totalPrime === 0}
            />
            <Row
              label="Recette nette (après prime)"
              value={formatDH(data.netRevenue)}
              highlight
            />
          </>
        )}
      </div>

      {/* Note when no prime rules are configured */}
      {allZero && (
        <div className="border-t border-slate-700/40 px-4 py-3">
          <p className="text-center text-xs text-slate-600">
            Les primes seront calculées après configuration complète des règles.
          </p>
        </div>
      )}
    </div>
  );
}
